// Edge Function `admin-config` (Etapa 12 — portal admin, pedido do Raphael
// 2026-09-16). Permite editar, sem deploy de código, só os TRECHOS DE PROMPT
// deliberadamente seguros de expor (tom, abertura, fechamento) — nunca o
// núcleo anti-alucinação (citação por chunk_id, JSON Schema, validação RF06,
// filtro de incerteza), que continua fixo no código de `suggest`/`ask`
// (Constitution §1). Por isso a allowlist abaixo é fechada: `chave` fora
// dela é sempre rejeitada, mesmo que já exista em `config` para outra
// finalidade (ex.: `limiar_relevancia` NUNCA é editável por aqui).
//
// Admin-only via `resolverChamador` (mesmo padrão de `relatorios/index.ts`).
//
// GET                  → lista as chaves editáveis com valor e descrição atuais
// PATCH {chave, valor} → atualiza uma chave (precisa estar na allowlist)

import { createServiceClient } from "../_shared/db.ts";
import { jsonComCors, respondCorsPreflight } from "../_shared/cors.ts";
import { resolverChamador } from "../_shared/auth_context.ts";

const CHAVES_EDITAVEIS = new Set([
  "prompt_tom_geral",
  "prompt_suggest_abertura_resposta",
  "prompt_suggest_abertura_followup",
  "prompt_suggest_fechamento_resposta",
  "prompt_suggest_fechamento_followup",
  "prompt_ask_instrucoes",
]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return respondCorsPreflight();

  const db = createServiceClient();
  const chamador = await resolverChamador(db, req);
  if (!chamador || chamador.papel !== "admin") {
    return jsonComCors({ error: "acesso restrito a admin — faça login (RF09)" }, { status: 403 });
  }

  if (req.method === "GET") {
    const { data, error } = await db
      .from("config")
      .select("chave, valor, descricao, atualizado_em, atualizado_por")
      .in("chave", [...CHAVES_EDITAVEIS])
      .order("chave");
    if (error) return jsonComCors({ error: error.message }, { status: 500 });
    return jsonComCors({ prompts: data ?? [] });
  }

  if (req.method === "PATCH") {
    let body: { chave?: string; valor?: string };
    try {
      body = await req.json();
    } catch {
      return jsonComCors({ error: "corpo JSON inválido" }, { status: 400 });
    }
    if (!body.chave || !CHAVES_EDITAVEIS.has(body.chave)) {
      return jsonComCors(
        { error: `'chave' deve ser uma de: ${[...CHAVES_EDITAVEIS].join(", ")}` },
        { status: 400 },
      );
    }
    if (typeof body.valor !== "string" || !body.valor.trim()) {
      return jsonComCors({ error: "campo 'valor' (texto) é obrigatório" }, { status: 400 });
    }

    const { error } = await db
      .from("config")
      .update({ valor: body.valor, atualizado_por: chamador.userId })
      .eq("chave", body.chave);
    if (error) return jsonComCors({ error: error.message }, { status: 500 });
    return jsonComCors({ ok: true });
  }

  return jsonComCors({ error: "use GET ou PATCH" }, { status: 405 });
});
