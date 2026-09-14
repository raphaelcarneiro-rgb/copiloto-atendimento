// Edge Function `search` (Etapa 3 — Recuperação).
// Gera o embedding da pergunta e chama `match_chunks` (busca híbrida:
// vetor + full-text, fundidas por RRF). Serve para os evals de recuperação
// e, mais adiante, é a mesma lógica que `suggest`/`ask` (etapa 4) vão usar
// internamente.
//
// POST { query: string, match_count?: number, filtro?: object }

import { createServiceClient } from "../_shared/db.ts";
import { embedTexts } from "../_shared/openai.ts";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "use POST" }), { status: 405 });
  }

  let body: { query?: string; match_count?: number; filtro?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "corpo JSON inválido" }), { status: 400 });
  }

  const query = body.query?.trim();
  if (!query) {
    return new Response(JSON.stringify({ error: "campo 'query' é obrigatório" }), { status: 400 });
  }

  const db = createServiceClient();

  try {
    const { embeddings, promptTokens } = await embedTexts([query]);
    const { data, error } = await db.rpc("match_chunks", {
      query_embedding: embeddings[0],
      query_text: query,
      match_count: body.match_count ?? 8,
      filtro: body.filtro ?? {},
    });

    if (error) throw new Error(`match_chunks falhou: ${error.message}`);

    return new Response(
      JSON.stringify({ query, tokens_embedding: promptTokens, resultados: data }, null, 2),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: mensagem }), { status: 500 });
  }
});
