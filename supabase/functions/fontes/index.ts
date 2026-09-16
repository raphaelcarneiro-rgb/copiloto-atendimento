// Edge Function `fontes` (Etapa 12 — portal admin, pedido do Raphael
// 2026-09-16). CRUD de `public.sources` pro portal web cadastrar conteúdo
// (arquivo PDF/TXT/MD via Storage, ou URL) sem precisar de SQL manual.
// Admin-only (mesmo padrão de `relatorios/index.ts`), via `resolverChamador`
// — a service role usada aqui ignora RLS, então o papel tem que ser
// verificado explicitamente.
//
// GET               → lista as fontes (mais recentes primeiro)
// POST {tipo, ref|storage_path, nome, categoria} → cria a fonte e já dispara
//   a ingestão dela (chama a Edge Function `ingest` com {source_id}, sem
//   esperar o cron de 15 min — feedback na hora pro admin)
// PATCH {id, ativo} → ativa/desativa
// DELETE {id}       → remove (cascade já cuida de documents/chunks)

import { createServiceClient } from "../_shared/db.ts";
import { jsonComCors, respondCorsPreflight } from "../_shared/cors.ts";
import { resolverChamador } from "../_shared/auth_context.ts";

const TIPOS_PERMITIDOS = new Set(["arquivo", "url"]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return respondCorsPreflight();

  const db = createServiceClient();
  const chamador = await resolverChamador(db, req);
  if (!chamador || chamador.papel !== "admin") {
    return jsonComCors({ error: "acesso restrito a admin — faça login (RF09)" }, { status: 403 });
  }

  if (req.method === "GET") {
    const { data, error } = await db
      .from("sources")
      .select("id, tipo, ref, nome, categoria, ativo, status, erro, ultima_sync, criado_em")
      .order("criado_em", { ascending: false });
    if (error) return jsonComCors({ error: error.message }, { status: 500 });
    return jsonComCors({ fontes: data ?? [] });
  }

  if (req.method === "POST") {
    let body: { tipo?: string; ref?: string; storage_path?: string; nome?: string; categoria?: string };
    try {
      body = await req.json();
    } catch {
      return jsonComCors({ error: "corpo JSON inválido" }, { status: 400 });
    }

    if (!body.tipo || !TIPOS_PERMITIDOS.has(body.tipo)) {
      return jsonComCors({ error: `tipo deve ser um de: ${[...TIPOS_PERMITIDOS].join(", ")}` }, { status: 400 });
    }
    if (!body.nome?.trim()) {
      return jsonComCors({ error: "campo 'nome' é obrigatório" }, { status: 400 });
    }

    let ref: string;
    if (body.tipo === "arquivo") {
      if (!body.storage_path?.trim()) {
        return jsonComCors({ error: "campo 'storage_path' é obrigatório para tipo='arquivo'" }, { status: 400 });
      }
      // storage_path vem do upload direto do navegador pro bucket
      // "fontes-pdf" (RLS admin-only) — aqui só registramos a referência.
      ref = `storage:fontes-pdf/${body.storage_path.replace(/^\/+/, "")}`;
    } else {
      if (!body.ref?.trim()) {
        return jsonComCors({ error: "campo 'ref' (URL) é obrigatório para tipo='url'" }, { status: 400 });
      }
      ref = body.ref.trim();
    }

    const { data: novaFonte, error: insertErr } = await db
      .from("sources")
      .insert({ tipo: body.tipo, ref, nome: body.nome.trim(), categoria: body.categoria?.trim() || null })
      .select("id, tipo, ref, nome, categoria, ativo, status")
      .single();
    if (insertErr) return jsonComCors({ error: insertErr.message }, { status: 500 });

    // Dispara a ingestão na hora, reaproveitando a mesma Edge Function do
    // cron (`ingest`, já aceita {source_id} pra sincronizar uma fonte só) —
    // evita esperar os 15 min do agendamento pro admin ver o resultado.
    let ingestao: unknown = null;
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const auth = req.headers.get("Authorization");
      const res = await fetch(`${supabaseUrl}/functions/v1/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
        body: JSON.stringify({ source_id: novaFonte.id }),
      });
      ingestao = await res.json();
    } catch (err) {
      ingestao = { error: err instanceof Error ? err.message : String(err) };
    }

    return jsonComCors({ fonte: novaFonte, ingestao });
  }

  if (req.method === "PATCH") {
    let body: { id?: string; ativo?: boolean };
    try {
      body = await req.json();
    } catch {
      return jsonComCors({ error: "corpo JSON inválido" }, { status: 400 });
    }
    if (!body.id || typeof body.ativo !== "boolean") {
      return jsonComCors({ error: "campos 'id' e 'ativo' são obrigatórios" }, { status: 400 });
    }
    const { error } = await db.from("sources").update({ ativo: body.ativo }).eq("id", body.id);
    if (error) return jsonComCors({ error: error.message }, { status: 500 });
    return jsonComCors({ ok: true });
  }

  if (req.method === "DELETE") {
    let body: { id?: string };
    try {
      body = await req.json();
    } catch {
      return jsonComCors({ error: "corpo JSON inválido" }, { status: 400 });
    }
    if (!body.id) return jsonComCors({ error: "campo 'id' é obrigatório" }, { status: 400 });

    // Remove o arquivo do Storage também, quando aplicável (ref="storage:bucket/path").
    const { data: fonte } = await db.from("sources").select("ref").eq("id", body.id).single();
    if (fonte?.ref?.startsWith("storage:")) {
      const [bucket, ...pathParts] = fonte.ref.replace(/^storage:/, "").split("/");
      if (bucket && pathParts.length > 0) {
        await db.storage.from(bucket).remove([pathParts.join("/")]);
      }
    }

    // `documents`/`chunks` já têm `on delete cascade` a partir de `sources`.
    const { error } = await db.from("sources").delete().eq("id", body.id);
    if (error) return jsonComCors({ error: error.message }, { status: 500 });
    return jsonComCors({ ok: true });
  }

  return jsonComCors({ error: "use GET, POST, PATCH ou DELETE" }, { status: 405 });
});
