// Edge Function `ingest` (Etapa 2 — spec RF08, plan.md "Backend Supabase —
// Edge Functions"). Sincroniza as fontes ativas em `public.sources`:
//   - tipo='sheet'      → lê via Google Sheets API (domain-wide delegation)
//   - tipo='pdf' com ref="gdoc:<id>"     → exporta um Google Doc (Drive API)
//   - tipo='pdf' com ref="storage:<bkt>/<path>" → baixa do Supabase Storage
//   - tipo='url'        → busca a página e limpa o HTML
// Cada fonte tem um único `documents`; ao mudar o hash, os `chunks` são
// substituídos por completo (RF08: reprocessa só quando o hash muda).
//
// Chamada: POST, autenticado (verify_jwt=true). Sem corpo obrigatório.
// Corpo opcional: {"source_id": "uuid"} para sincronizar uma fonte só.

import { createServiceClient, logEmbeddingUsage } from "../_shared/db.ts";
import {
  getGoogleAccessToken,
  SCOPE_DRIVE_READONLY,
  SCOPE_SHEETS_READONLY,
} from "../_shared/google_auth.ts";
import { getSheetValues, listSheetTabs } from "../_shared/google_sheets.ts";
import { exportGoogleDocAsText } from "../_shared/google_drive.ts";
import { sha256Hex } from "../_shared/hash.ts";
import { chunkText } from "../_shared/chunking.ts";
import { EMBEDDING_MODEL, embedTexts } from "../_shared/openai.ts";
import { extractPdfText } from "../_shared/pdf.ts";
import { fetchUrlAsText } from "../_shared/html.ts";
import {
  convenioParaTexto,
  feriadosParaTexto,
  parseCalendarioCursos,
  parseConvenios,
  parseFeriados,
} from "./parsers.ts";

type Db = ReturnType<typeof createServiceClient>;

interface SourceRow {
  id: string;
  tipo: "sheet" | "pdf" | "url" | "faq";
  ref: string;
  nome: string;
  categoria: string | null;
}

interface SyncResult {
  source: string;
  status: "ok" | "sem_alteracao" | "erro";
  chunks?: number;
  facts?: number;
  mensagem?: string;
}

interface ChunkInput {
  conteudo: string;
  metadados: Record<string, unknown>;
}

/**
 * Garante um `documents` para a fonte e, se o hash mudou, substitui todos os
 * chunks e gera novos embeddings. Retorna null quando nada mudou.
 */
async function syncDocumentChunks(
  db: Db,
  source: SourceRow,
  rawHashInput: string,
  chunkInputs: ChunkInput[],
): Promise<{ chunks: number } | null> {
  const hash = await sha256Hex(rawHashInput);

  const { data: existingSource, error: sourceErr } = await db
    .from("sources")
    .select("hash")
    .eq("id", source.id)
    .single();
  if (sourceErr) throw new Error(`sources.select falhou: ${sourceErr.message}`);

  if (existingSource?.hash === hash) {
    await db
      .from("sources")
      .update({ ultima_sync: new Date().toISOString(), status: "ok", erro: null })
      .eq("id", source.id);
    return null;
  }

  const { data: doc, error: docErr } = await db
    .from("documents")
    .upsert(
      { source_id: source.id, titulo: source.nome, hash },
      { onConflict: "source_id" },
    )
    .select("id, versao")
    .single();
  if (docErr) throw new Error(`documents.upsert falhou: ${docErr.message}`);

  const { error: deleteErr } = await db.from("chunks").delete().eq("document_id", doc.id);
  if (deleteErr) throw new Error(`chunks.delete falhou: ${deleteErr.message}`);

  if (chunkInputs.length > 0) {
    const { embeddings, promptTokens } = await embedTexts(chunkInputs.map((c) => c.conteudo));
    const rows = chunkInputs.map((c, i) => ({
      document_id: doc.id,
      ordem: i,
      conteudo: c.conteudo,
      metadados: c.metadados,
      embedding: embeddings[i],
    }));
    const { error: insertErr } = await db.from("chunks").insert(rows);
    if (insertErr) throw new Error(`chunks.insert falhou: ${insertErr.message}`);

    await logEmbeddingUsage(db, {
      modelo: EMBEDDING_MODEL,
      tokensEntrada: promptTokens,
      etapa: `ingest:${source.categoria ?? source.tipo}`,
    });
  }

  await db
    .from("documents")
    .update({ versao: (doc.versao ?? 1) + (existingSource?.hash ? 1 : 0) })
    .eq("id", doc.id);

  await db
    .from("sources")
    .update({ hash, ultima_sync: new Date().toISOString(), status: "ok", erro: null })
    .eq("id", source.id);

  return { chunks: chunkInputs.length };
}

async function replaceFactsForSource(
  db: Db,
  sourceId: string,
  facts: { curso: string; atributo: string; valor: string }[],
) {
  const { error: deleteErr } = await db.from("facts").delete().eq("source_id", sourceId);
  if (deleteErr) throw new Error(`facts.delete falhou: ${deleteErr.message}`);
  if (facts.length === 0) return;
  const { error: insertErr } = await db
    .from("facts")
    .insert(facts.map((f) => ({ ...f, source_id: sourceId })));
  if (insertErr) throw new Error(`facts.insert falhou: ${insertErr.message}`);
}

async function ingestCalendarioCursos(db: Db, source: SourceRow): Promise<SyncResult> {
  const token = await getGoogleAccessToken([SCOPE_SHEETS_READONLY]);
  const tabs = await listSheetTabs(token, source.ref);
  if (tabs.length === 0) throw new Error("planilha sem abas");

  const rows = await getSheetValues(token, source.ref, tabs[0].title);
  const cursos = parseCalendarioCursos(rows);
  if (cursos.length === 0) throw new Error("nenhum curso encontrado — verifique o layout da aba");

  const facts = cursos.flatMap((c) => {
    const items: { curso: string; atributo: string; valor: string }[] = [];
    if (c.dataInicio) items.push({ curso: c.curso, atributo: "data_inicio", valor: c.dataInicio });
    if (c.frequencia) items.push({ curso: c.curso, atributo: "frequencia", valor: c.frequencia });
    if (c.horario) items.push({ curso: c.curso, atributo: "horario", valor: c.horario });
    return items;
  });

  const chunkInputs: ChunkInput[] = cursos.map((c) => ({
    conteudo: [
      `Curso: ${c.curso}.`,
      c.grupo ? `Categoria: ${c.grupo}.` : "",
      c.dataInicio ? `Início previsto: ${c.dataInicio}.` : "",
      c.frequencia ? `Frequência: ${c.frequencia}.` : "",
      c.horario ? `Horário: ${c.horario}.` : "",
    ]
      .filter(Boolean)
      .join(" "),
    metadados: { curso: c.curso, vertical: c.grupo, tipo: "calendario_cursos" },
  }));

  const rawHashInput = JSON.stringify(cursos);
  const synced = await syncDocumentChunks(db, source, rawHashInput, chunkInputs);
  await replaceFactsForSource(db, source.id, facts);

  if (!synced) return { source: source.nome, status: "sem_alteracao" };
  return { source: source.nome, status: "ok", chunks: synced.chunks, facts: facts.length };
}

async function ingestConvenios(db: Db, source: SourceRow): Promise<SyncResult> {
  const token = await getGoogleAccessToken([SCOPE_SHEETS_READONLY]);
  const tabs = await listSheetTabs(token, source.ref);
  if (tabs.length === 0) throw new Error("planilha sem abas");

  const rows = await getSheetValues(token, source.ref, tabs[0].title);
  const empresas = parseConvenios(rows);
  if (empresas.length === 0) throw new Error("nenhuma empresa encontrada — verifique o layout da aba");

  // Agrupa várias empresas por chunk (custo de embedding menor; ainda bem
  // localizável por busca híbrida).
  const GRUPO = 20;
  const chunkInputs: ChunkInput[] = [];
  for (let i = 0; i < empresas.length; i += GRUPO) {
    const grupo = empresas.slice(i, i + GRUPO);
    chunkInputs.push({
      conteudo: grupo.map(convenioParaTexto).join("\n"),
      metadados: { tipo: "convenio", empresas: grupo.map((e) => e.empresa) },
    });
  }

  const rawHashInput = JSON.stringify(empresas);
  const synced = await syncDocumentChunks(db, source, rawHashInput, chunkInputs);

  if (!synced) return { source: source.nome, status: "sem_alteracao" };
  return { source: source.nome, status: "ok", chunks: synced.chunks };
}

/** Substitui TODOS os feriados pelos da planilha (fonte única de verdade). */
async function replaceAllFeriados(
  db: Db,
  sourceId: string,
  feriados: { data: string; nome: string; tipo: string; contaComoFolga: boolean; observacao: string }[],
) {
  const { error: deleteErr } = await db.from("feriados").delete().neq("id", -1);
  if (deleteErr) throw new Error(`feriados.delete falhou: ${deleteErr.message}`);
  if (feriados.length === 0) return;
  const { error: insertErr } = await db.from("feriados").insert(
    feriados.map((f) => ({
      data: f.data,
      nome: f.nome,
      tipo: f.tipo,
      conta_como_folga: f.contaComoFolga,
      observacao: f.observacao || null,
      source_id: sourceId,
    })),
  );
  if (insertErr) throw new Error(`feriados.insert falhou: ${insertErr.message}`);
}

async function ingestFeriados(db: Db, source: SourceRow): Promise<SyncResult> {
  const token = await getGoogleAccessToken([SCOPE_SHEETS_READONLY]);
  const tabs = await listSheetTabs(token, source.ref);
  if (tabs.length === 0) throw new Error("planilha sem abas");

  const rows = await getSheetValues(token, source.ref, tabs[0].title);
  const feriados = parseFeriados(rows);
  if (feriados.length === 0) throw new Error("nenhum feriado encontrado — verifique o layout da aba");

  const chunkInputs: ChunkInput[] = [{ conteudo: feriadosParaTexto(feriados), metadados: { tipo: "feriados" } }];
  const rawHashInput = JSON.stringify(feriados);
  const synced = await syncDocumentChunks(db, source, rawHashInput, chunkInputs);

  // Sempre reflete a planilha por completo (dataset pequeno; garante que
  // remoções na planilha também removam o feriado do banco).
  await replaceAllFeriados(db, source.id, feriados);

  if (!synced) return { source: source.nome, status: "sem_alteracao" };
  return { source: source.nome, status: "ok", chunks: synced.chunks, facts: feriados.length };
}

async function ingestGoogleDoc(db: Db, source: SourceRow, fileId: string): Promise<SyncResult> {
  const token = await getGoogleAccessToken([SCOPE_DRIVE_READONLY]);
  const text = await exportGoogleDocAsText(token, fileId);
  if (!text.trim()) throw new Error("documento vazio");

  const chunks = chunkText(text);
  const chunkInputs: ChunkInput[] = chunks.map((c) => ({
    conteudo: c,
    metadados: { tipo: source.categoria ?? "documento" },
  }));

  const synced = await syncDocumentChunks(db, source, text, chunkInputs);
  if (!synced) return { source: source.nome, status: "sem_alteracao" };
  return { source: source.nome, status: "ok", chunks: synced.chunks };
}

/** `ref` no formato "storage:<bucket>/<caminho/arquivo.pdf>". */
async function ingestPdfStorage(db: Db, source: SourceRow, storageRef: string): Promise<SyncResult> {
  const [bucket, ...pathParts] = storageRef.split("/");
  const path = pathParts.join("/");
  if (!bucket || !path) throw new Error(`ref inválida para PDF do Storage: "${source.ref}"`);

  const { data: file, error: downloadErr } = await db.storage.from(bucket).download(path);
  if (downloadErr) throw new Error(`Storage download falhou: ${downloadErr.message}`);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = await extractPdfText(bytes);
  if (!text.trim()) throw new Error("PDF sem texto extraível (pode ser digitalizado sem OCR)");

  const chunks = chunkText(text);
  const chunkInputs: ChunkInput[] = chunks.map((c) => ({
    conteudo: c,
    metadados: { tipo: source.categoria ?? "pdf" },
  }));

  const synced = await syncDocumentChunks(db, source, text, chunkInputs);
  if (!synced) return { source: source.nome, status: "sem_alteracao" };
  return { source: source.nome, status: "ok", chunks: synced.chunks };
}

async function ingestUrlSource(db: Db, source: SourceRow): Promise<SyncResult> {
  const text = await fetchUrlAsText(source.ref);
  if (!text.trim()) throw new Error("página sem texto extraível");

  const chunks = chunkText(text);
  const chunkInputs: ChunkInput[] = chunks.map((c) => ({
    conteudo: c,
    metadados: { tipo: source.categoria ?? "url", url: source.ref },
  }));

  const synced = await syncDocumentChunks(db, source, text, chunkInputs);
  if (!synced) return { source: source.nome, status: "sem_alteracao" };
  return { source: source.nome, status: "ok", chunks: synced.chunks };
}

async function ingestSource(db: Db, source: SourceRow): Promise<SyncResult> {
  if (source.tipo === "sheet") {
    switch (source.categoria) {
      case "calendario_cursos":
        return ingestCalendarioCursos(db, source);
      case "convenios":
        return ingestConvenios(db, source);
      case "feriados":
        return ingestFeriados(db, source);
      default:
        throw new Error(`categoria de planilha não suportada: ${source.categoria ?? "(vazia)"}`);
    }
  }

  if (source.tipo === "pdf") {
    if (source.ref.startsWith("gdoc:")) {
      return ingestGoogleDoc(db, source, source.ref.replace(/^gdoc:/, ""));
    }
    if (source.ref.startsWith("storage:")) {
      return ingestPdfStorage(db, source, source.ref.replace(/^storage:/, ""));
    }
    throw new Error(`ref de PDF deve começar com "gdoc:" ou "storage:": "${source.ref}"`);
  }

  if (source.tipo === "url") {
    return ingestUrlSource(db, source);
  }

  throw new Error(`tipo de fonte não suportado: ${source.tipo}`);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "use POST" }), { status: 405 });
  }

  const db = createServiceClient();
  let sourceIdFilter: string | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    sourceIdFilter = body?.source_id;
  } catch {
    // corpo vazio é aceitável
  }

  let query = db.from("sources").select("id, tipo, ref, nome, categoria").eq("ativo", true);
  if (sourceIdFilter) query = query.eq("id", sourceIdFilter);
  const { data: sources, error } = await query;

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const results: SyncResult[] = [];
  for (const source of (sources ?? []) as SourceRow[]) {
    try {
      results.push(await ingestSource(db, source));
    } catch (err) {
      const mensagem = err instanceof Error ? err.message : String(err);
      await db
        .from("sources")
        .update({ status: "erro", erro: mensagem, ultima_sync: new Date().toISOString() })
        .eq("id", source.id);
      results.push({ source: source.nome, status: "erro", mensagem });
    }
  }

  return new Response(JSON.stringify({ results }, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
});
