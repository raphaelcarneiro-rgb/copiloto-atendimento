// Edge Function `ask` (Etapa 4 — US3, RF05–RF07, RF15–RF16).
// Responde uma pergunta livre do atendente, fundamentada só nos trechos
// recuperados nesta mesma requisição (RF06: citação fora desse conjunto é
// invalidada). Registra o custo da chamada (RF21) e, quando a base não
// cobre a pergunta, registra uma lacuna (RF15), deduplicada por
// similaridade de embedding (RF16).
//
// POST { pergunta: string, thread_hash?: string, match_count?: number }

import { createServiceClient, getConfig, logUsage } from "../_shared/db.ts";
import { chatJSON, embedTexts } from "../_shared/openai.ts";
import { maskPII } from "../_shared/pii.ts";
import { jsonComCors, respondCorsPreflight } from "../_shared/cors.ts";

type Db = ReturnType<typeof createServiceClient>;

interface ChunkResultado {
  chunk_id: number;
  document_id: string;
  conteudo: string;
  metadados: Record<string, unknown>;
  similaridade: number;
  rrf_score: number;
}

interface AskLLMOutput {
  resposta: string;
  fontes: number[];
  encontrado: boolean;
  confianca: "alta" | "media" | "baixa";
}

const ASK_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["resposta", "fontes", "encontrado", "confianca"],
  properties: {
    resposta: { type: "string" },
    fontes: { type: "array", items: { type: "integer" } },
    encontrado: { type: "boolean" },
    confianca: { type: "string", enum: ["alta", "media", "baixa"] },
  },
} as const;

function buildSystemPrompt(): string {
  return [
    "Você é o copiloto de atendimento comercial da Faculdade Infnet.",
    "Responda SOMENTE com base nos trechos numerados fornecidos no contexto.",
    "Nunca invente preço, data, duração ou qualquer dado — use apenas o que está escrito nos trechos.",
    'Se a resposta não estiver clara nos trechos, defina "encontrado": false e responda algo como "Não encontrei essa informação na base — confirme com a coordenação.".',
'No campo "fontes", cite o(s) valor(es) exato(s) de chunk_id (o número depois de "chunk_id=" antes do trecho) que você realmente usou para montar a resposta — nunca invente ou adivinhe um chunk_id, copie exatamente o que está escrito no contexto.',
    "Seja direto e objetivo, em português do Brasil, como uma mensagem de WhatsApp de atendimento comercial.",
  ].join(" ");
}

function buildUserPrompt(pergunta: string, chunks: ChunkResultado[]): string {
  // Um único número por trecho (chunk_id) — nada de índice de posição junto,
  // que na prática o modelo confundia com o chunk_id de verdade e citava a
  // fonte errada mesmo respondendo com o dado certo (achado em teste real).
  const contexto = chunks
    .map((c) => `--- chunk_id=${c.chunk_id} ---\n${c.conteudo}`)
    .join("\n\n");
  return `Contexto recuperado da base de conhecimento (cite pelo chunk_id exato indicado antes de cada trecho):\n\n${contexto}\n\nPergunta do atendente: ${pergunta}`;
}

async function registrarLacuna(
  db: Db,
  perguntaMascarada: string,
  embedding: number[],
  limiarDedup: number,
): Promise<{ registrada: boolean; gapId: string | null }> {
  const { data: similar, error: matchErr } = await db.rpc("match_gap_similar", {
    query_embedding: embedding,
    limiar: limiarDedup,
  });
  if (matchErr) {
    console.error("match_gap_similar falhou:", matchErr.message);
    return { registrada: false, gapId: null };
  }

  if (similar && similar.length > 0) {
    const gapId = similar[0].id;
    // Sem função dedicada de incremento atômico: leitura + escrita. O
    // volume esperado (uma pergunta por vez, via ask) não gera concorrência
    // real; se isso mudar, trocar por um `update ... set contagem = contagem + 1`.
    const { data: atual } = await db.from("knowledge_gaps").select("contagem").eq("id", gapId).single();
    await db
      .from("knowledge_gaps")
      .update({ contagem: (atual?.contagem ?? 1) + 1, ultima_vez: new Date().toISOString() })
      .eq("id", gapId);
    return { registrada: true, gapId };
  }

  const { data: novo, error: insErr } = await db
    .from("knowledge_gaps")
    .insert({ pergunta_mascarada: perguntaMascarada, embedding })
    .select("id")
    .single();
  if (insErr) {
    console.error("knowledge_gaps.insert falhou:", insErr.message);
    return { registrada: false, gapId: null };
  }
  return { registrada: true, gapId: novo.id };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return respondCorsPreflight();
  if (req.method !== "POST") {
    return jsonComCors({ error: "use POST" }, { status: 405 });
  }

  let body: { pergunta?: string; thread_hash?: string; match_count?: number };
  try {
    body = await req.json();
  } catch {
    return jsonComCors({ error: "corpo JSON inválido" }, { status: 400 });
  }

  const perguntaOriginal = body.pergunta?.trim();
  if (!perguntaOriginal) {
    return jsonComCors({ error: "campo 'pergunta' é obrigatório" }, { status: 400 });
  }
  const pergunta = maskPII(perguntaOriginal);

  const db = createServiceClient();

  try {
    const [limiarRelevancia, limiarDedup, modelos] = await Promise.all([
      getConfig(db, "limiar_relevancia") as Promise<number>,
      getConfig(db, "limiar_dedup") as Promise<number>,
      getConfig(db, "modelos") as Promise<{ chat: string }>,
    ]);

    const { embeddings, promptTokens: tokensEmbeddingPergunta } = await embedTexts([pergunta]);
    const perguntaEmbedding = embeddings[0];

    const { data: chunksData, error: matchErr } = await db.rpc("match_chunks", {
      query_embedding: perguntaEmbedding,
      query_text: pergunta,
      match_count: body.match_count ?? 8,
      filtro: {},
    });
    if (matchErr) throw new Error(`match_chunks falhou: ${matchErr.message}`);

    const chunks = (chunksData ?? []) as ChunkResultado[];
    const idsRecuperados = new Set(chunks.map((c) => c.chunk_id));
    const melhorSimilaridade = chunks[0]?.similaridade ?? 0;

    let resultado: AskLLMOutput;
    let tokensPromptChat = 0;
    let tokensCompletion = 0;
    let tokensCache = 0;

    if (chunks.length === 0 || melhorSimilaridade < limiarRelevancia) {
      // Sem trechos minimamente relevantes: nem vale chamar o modelo de chat.
      resultado = {
        resposta: "Não encontrei essa informação na base — confirme com a coordenação.",
        fontes: [],
        encontrado: false,
        confianca: "baixa",
      };
    } else {
      const chat = await chatJSON<AskLLMOutput>({
        model: modelos.chat,
        system: buildSystemPrompt(),
        user: buildUserPrompt(pergunta, chunks),
        schemaName: "ask_response",
        schema: ASK_JSON_SCHEMA,
        // sem "temperature": gpt-5.6-luna só aceita o valor padrão (ver
        // _shared/openai.ts). A saída estruturada já reduz variação.
      });
      resultado = chat.content;
      tokensPromptChat = chat.promptTokens;
      tokensCompletion = chat.completionTokens;
      tokensCache = chat.cachedTokens;

      // RF06: descarta citações que não pertencem ao conjunto recuperado
      // NESTA requisição.
      const fontesValidas = resultado.fontes.filter((id) => idsRecuperados.has(id));
      const houveFonteInvalida = fontesValidas.length !== resultado.fontes.length;
      resultado.fontes = fontesValidas;
      if (houveFonteInvalida) {
        resultado.confianca = "baixa";
        if (fontesValidas.length === 0) resultado.encontrado = false;
      }
    }

    // RF15/RF16
    let lacunaRegistrada = false;
    if (!resultado.encontrado) {
      const r = await registrarLacuna(db, pergunta, perguntaEmbedding, limiarDedup);
      lacunaRegistrada = r.registrada;
    }

    await logUsage(db, {
      tipoChamada: "ask",
      modelo: modelos.chat,
      tokensEntrada: tokensPromptChat + tokensEmbeddingPergunta,
      tokensSaida: tokensCompletion,
      tokensCache,
      threadHash: body.thread_hash ?? null,
    });

    const fontesDetalhadas = resultado.fontes.map((id) => {
      const c = chunks.find((ch) => ch.chunk_id === id);
      return { chunk_id: id, trecho: c?.conteudo?.slice(0, 200) ?? null };
    });

    return jsonComCors({
      resposta: resultado.resposta,
      encontrado: resultado.encontrado,
      confianca: resultado.confianca,
      fontes: fontesDetalhadas,
      lacuna_registrada: lacunaRegistrada,
    });
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : String(err);
    return jsonComCors({ error: mensagem }, { status: 500 });
  }
});
