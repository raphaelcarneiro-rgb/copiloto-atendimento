// Edge Function `gaps` (Etapa 8 — US9, RF15-RF20). Fecha o ciclo de
// aprendizado supervisionado: o atendente propõe resposta para uma lacuna
// (RF17), o curador classifica (RF18) e, se aprovar como FAQ (RF18a),
// publica como fonte nova (RF19) — nunca automaticamente a partir de uma
// conversa (constitution §7).
//
// Sem rota por path: tudo em POST com {acao: ...} no corpo, mesmo padrão de
// `ask`/`suggest` — mantém consistência e evita depender de path routing do
// gateway. GET lista a fila.
//
// IMPORTANTE (limitação conhecida, sem solução ainda): não existe login real
// wired na extensão (RF09 pendente — ver plan.md). Por isso:
//   - não há como saber QUAL atendente está chamando, então `curador_id` fica
//     null nas aprovações e a notificação individual do RF20 ("sua dúvida
//     agora tem resposta") não está implementada — precisa do login antes.
//   - o endpoint não tem controle de acesso próprio (mesmo padrão de
//     `suggest`/`ask`: protegido só pela obscuridade da anon key, que já é o
//     modelo atual do projeto todo). Não é apropriado para múltiplos
//     curadores sem login real.

import { createServiceClient, getConfig } from "../_shared/db.ts";
import { embedTexts } from "../_shared/openai.ts";
import { jsonComCors, respondCorsPreflight } from "../_shared/cors.ts";

type Db = ReturnType<typeof createServiceClient>;

interface GapRow {
  id: string;
  pergunta_mascarada: string;
  curso: string | null;
  etapa: string | null;
  contagem: number;
  status: string;
  primeira_vez: string;
  ultima_vez: string;
  fonte_existente: string | null;
  notas_curador: string | null;
}

interface PropostaRow {
  id: string;
  gap_id: string;
  resposta_mascarada: string;
  fonte_url: string | null;
  origem: string;
  criado_em: string;
}

// RF19: heurística simples pra bloquear preço/data numa resposta virando FAQ.
// Não é perfeita (regex, não NLP), mas cobre os formatos mais comuns usados
// no projeto (R$, datas dd/mm/aaaa ou aaaa-mm-dd).
const PADRAO_PRECO_OU_DATA = /R\$\s?\d|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/;

async function listarFila(db: Db): Promise<Response> {
  const limiarDestaque = (await getConfig(db, "limiar_destaque_lacuna")) as number;

  const { data: gapsData, error: gapsErr } = await db
    .from("knowledge_gaps")
    .select("id, pergunta_mascarada, curso, etapa, contagem, status, primeira_vez, ultima_vez, fonte_existente, notas_curador")
    .eq("status", "aberta")
    .order("contagem", { ascending: false })
    .order("ultima_vez", { ascending: false });
  if (gapsErr) return jsonComCors({ error: gapsErr.message }, { status: 500 });

  const gaps = (gapsData ?? []) as GapRow[];
  const ids = gaps.map((g) => g.id);
  let propostasPorGap: Record<string, PropostaRow[]> = {};
  if (ids.length > 0) {
    const { data: propostas, error: propErr } = await db
      .from("gap_proposals")
      .select("id, gap_id, resposta_mascarada, fonte_url, origem, criado_em")
      .in("gap_id", ids)
      .order("criado_em", { ascending: false });
    if (propErr) return jsonComCors({ error: propErr.message }, { status: 500 });
    propostasPorGap = {};
    for (const p of (propostas ?? []) as PropostaRow[]) {
      (propostasPorGap[p.gap_id] ??= []).push(p);
    }
  }

  const fila = gaps.map((g) => ({
    ...g,
    destaque: g.contagem >= limiarDestaque,
    propostas: propostasPorGap[g.id] ?? [],
  }));

  return jsonComCors({ fila });
}

async function registrarProposta(db: Db, body: Record<string, unknown>): Promise<Response> {
  const { gap_id, resposta_mascarada, fonte_url, origem } = body as {
    gap_id?: string;
    resposta_mascarada?: string;
    fonte_url?: string;
    origem?: "resposta_consultor" | "correcao_feedback";
  };
  if (!gap_id || !resposta_mascarada) {
    return jsonComCors({ error: "gap_id e resposta_mascarada são obrigatórios" }, { status: 400 });
  }
  const { data, error } = await db
    .from("gap_proposals")
    .insert({
      gap_id,
      resposta_mascarada,
      fonte_url: fonte_url ?? null,
      origem: origem ?? "resposta_consultor",
    })
    .select("id")
    .single();
  if (error) return jsonComCors({ error: error.message }, { status: 500 });
  return jsonComCors({ ok: true, proposal_id: data.id });
}

async function classificar(db: Db, body: Record<string, unknown>): Promise<Response> {
  const { gap_id, status, notas_curador, fonte_existente } = body as {
    gap_id?: string;
    status?: "ja_existia" | "atualizar_fonte" | "descartada";
    notas_curador?: string;
    fonte_existente?: string;
  };
  if (!gap_id || !status) {
    return jsonComCors({ error: "gap_id e status são obrigatórios" }, { status: 400 });
  }
  if (!["ja_existia", "atualizar_fonte", "descartada"].includes(status)) {
    return jsonComCors(
      { error: "status deve ser 'ja_existia', 'atualizar_fonte' ou 'descartada' (use /aprovar para nova FAQ)" },
      { status: 400 },
    );
  }
  const { error } = await db
    .from("knowledge_gaps")
    .update({
      status,
      notas_curador: notas_curador ?? null,
      fonte_existente: fonte_existente ?? null,
      resolvido_em: new Date().toISOString(),
    })
    .eq("id", gap_id);
  if (error) return jsonComCors({ error: error.message }, { status: 500 });
  return jsonComCors({ ok: true });
}

async function aprovarComoFaq(db: Db, body: Record<string, unknown>): Promise<Response> {
  const { gap_id, pergunta, resposta, fontes, valido_ate } = body as {
    gap_id?: string;
    pergunta?: string;
    resposta?: string;
    fontes?: string[];
    valido_ate?: string;
  };
  if (!gap_id || !pergunta || !resposta) {
    return jsonComCors({ error: "gap_id, pergunta e resposta são obrigatórios" }, { status: 400 });
  }
  // RF19: preço, valor e data não podem virar FAQ — têm que vir de tabela
  // estruturada, não de uma resposta de curadoria digitada à mão.
  if (PADRAO_PRECO_OU_DATA.test(resposta)) {
    return jsonComCors(
      {
        error:
          "Essa resposta parece conter preço, valor ou data — isso não pode virar FAQ (RF19/RF07). Encaminhe para a planilha oficial correspondente.",
      },
      { status: 422 },
    );
  }

  const { data: faq, error: faqErr } = await db
    .from("faq_curada")
    .insert({
      gap_id,
      pergunta,
      resposta,
      fontes: fontes ?? [],
      aprovado_em: new Date().toISOString(),
      valido_ate: valido_ate ?? null,
      ativo: true,
    })
    .select("id")
    .single();
  if (faqErr) return jsonComCors({ error: faqErr.message }, { status: 500 });

  // Publica como fonte nova: um source tipo='faq' + um documento + um chunk
  // (RF19). Fluxo dedicado e simples — não reaproveita o `syncDocumentChunks`
  // do `ingest` de propósito, pra não arriscar mexer numa função que já roda
  // em produção via cron a cada 15 min por causa de uma FAQ isolada.
  const ref = `faq:${faq.id}`;
  const nomeFonte = `FAQ curada — aprovada em ${new Date().toISOString().slice(0, 10)}`;
  const { data: source, error: sourceErr } = await db
    .from("sources")
    .insert({ tipo: "faq", ref, nome: nomeFonte, categoria: "faq_curada", ativo: true, status: "ok", ultima_sync: new Date().toISOString() })
    .select("id")
    .single();
  if (sourceErr) return jsonComCors({ error: `sources.insert falhou: ${sourceErr.message}` }, { status: 500 });

  const { data: doc, error: docErr } = await db
    .from("documents")
    .insert({ source_id: source.id, titulo: nomeFonte, hash: ref })
    .select("id")
    .single();
  if (docErr) return jsonComCors({ error: `documents.insert falhou: ${docErr.message}` }, { status: 500 });

  const conteudo = `Pergunta: ${pergunta}\nResposta: ${resposta}`;
  const { embeddings } = await embedTexts([conteudo]);
  const { error: chunkErr } = await db.from("chunks").insert({
    document_id: doc.id,
    ordem: 0,
    conteudo,
    metadados: { tipo: "faq_curada", gap_id },
    embedding: embeddings[0],
  });
  if (chunkErr) return jsonComCors({ error: `chunks.insert falhou: ${chunkErr.message}` }, { status: 500 });

  await db
    .from("knowledge_gaps")
    .update({ status: "aprovada", resolvido_em: new Date().toISOString() })
    .eq("id", gap_id);

  return jsonComCors({
    ok: true,
    faq_id: faq.id,
    source_id: source.id,
    aviso: "RF20: lembre de incluir essa pergunta em evals/perguntas.json manualmente — a Edge Function não tem acesso ao repositório git.",
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return respondCorsPreflight();

  const db = createServiceClient();

  if (req.method === "GET") return listarFila(db);

  if (req.method !== "POST") {
    return jsonComCors({ error: "use GET ou POST" }, { status: 405 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonComCors({ error: "corpo JSON inválido" }, { status: 400 });
  }

  switch (body.acao) {
    case "proposta":
      return registrarProposta(db, body);
    case "classificar":
      return classificar(db, body);
    case "aprovar":
      return aprovarComoFaq(db, body);
    default:
      return jsonComCors({ error: "'acao' deve ser 'proposta', 'classificar' ou 'aprovar'" }, { status: 400 });
  }
});
