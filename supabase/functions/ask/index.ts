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
import { registrarLacuna } from "../_shared/lacunas.ts";
import { resolverChamador } from "../_shared/auth_context.ts";
import { INSTRUCAO_FORMATACAO_WHATSAPP } from "../_shared/formatacao.ts";
import {
  blocoCursoIdentificado,
  extrairCursosCandidatos,
  identificarCursoCitado,
  montarBlocoPrecoOficial,
} from "../_shared/precos.ts";

// Maior que o antigo padrão (8): os evals da etapa 10 (2026-09-14)
// mostraram que perguntas sobre uma empresa de convênio específica às
// vezes não apareciam no top-8 porque competem com ~200 outras empresas
// espalhadas em ~10 chunks, mais dezenas de cursos — o mesmo tipo de
// achado que já tinha motivado o `suggest` a subir seu match_count.
const MATCH_COUNT_PADRAO = 16;

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

function buildSystemPrompt(tomGeral: string, instrucoesAsk: string): string {
  // `tomGeral` e `instrucoesAsk` vêm do `config` (Etapa 12, editável pelo
  // portal admin sem deploy) — o restante (núcleo anti-alucinação: citação
  // por chunk_id, "encontrado":false, RF06) fica fixo no código de
  // propósito (Constitution §1).
  return [
    "Você é o copiloto de atendimento comercial da Faculdade Infnet.",
    "Responda SOMENTE com base nos trechos numerados fornecidos no contexto.",
    instrucoesAsk,
    'Se a resposta não estiver clara nos trechos, defina "encontrado": false e responda algo como "Não encontrei essa informação na base — confirme com a coordenação.".',
    'No campo "fontes", cite o(s) valor(es) exato(s) de chunk_id (o número depois de "chunk_id=" antes do trecho) que você realmente usou para montar a resposta — nunca invente ou adivinhe um chunk_id, copie exatamente o que está escrito no contexto.',
    "Se a mensagem do usuário trouxer um bloco \"DADOS OFICIAIS DE PREÇO\", esse é o ÚNICO lugar de onde um preço de curso pode vir — use exatamente esses números (nunca recalcule, arredonde diferente ou invente outra forma de pagamento). Se não houver esse bloco para o curso perguntado, NÃO informe nenhum preço — defina \"encontrado\": false. Uma resposta de preço baseada só nesse bloco (sem chunk_id) é válida, não precisa de outra fonte.",
    tomGeral,
    INSTRUCAO_FORMATACAO_WHATSAPP,
  ].join(" ");
}

function buildUserPrompt(pergunta: string, chunks: ChunkResultado[], blocoPrecoOficial: string): string {
  // Um único número por trecho (chunk_id) — nada de índice de posição junto,
  // que na prática o modelo confundia com o chunk_id de verdade e citava a
  // fonte errada mesmo respondendo com o dado certo (achado em teste real).
  const contexto = chunks
    .map((c) => `--- chunk_id=${c.chunk_id} ---\n${c.conteudo}`)
    .join("\n\n");
  return (
    `Contexto recuperado da base de conhecimento (cite pelo chunk_id exato indicado antes de cada trecho):\n\n${contexto}` +
    blocoPrecoOficial +
    `\n\nPergunta do atendente: ${pergunta}`
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return respondCorsPreflight();
  if (req.method !== "POST") {
    return jsonComCors({ error: "use POST" }, { status: 405 });
  }

  let body: {
    pergunta?: string;
    thread_hash?: string;
    match_count?: number;
    empresa_associada?: string;
    estado_lead?: string;
  };
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
  // Etapa 14 (2026-09-16): mesmo dado que o suggest já recebe — empresa
  // associada (pro convênio) e estado do lead (pra escolher a coluna de
  // preço certa). Opcionais: o ask pode ser chamado sem contexto de
  // conversa nenhum.
  const empresaAssociada = body.empresa_associada?.trim() || null;
  const estadoLead = body.estado_lead?.trim().toUpperCase() || null;

  const db = createServiceClient();
  // RF20: opcional — quem não fez login (ainda comum) continua funcionando
  // normalmente, só sem ficar registrado pra receber aviso de FAQ aprovada.
  const chamador = await resolverChamador(db, req);

  try {
    const [limiarRelevancia, limiarDedup, modelos, tomGeral, instrucoesAsk] = await Promise.all([
      getConfig(db, "limiar_relevancia") as Promise<number>,
      getConfig(db, "limiar_dedup") as Promise<number>,
      getConfig(db, "modelos") as Promise<{ chat: string }>,
      getConfig(db, "prompt_tom_geral") as Promise<string>,
      getConfig(db, "prompt_ask_instrucoes") as Promise<string>,
    ]);

    const { embeddings, promptTokens: tokensEmbeddingPergunta } = await embedTexts([pergunta]);
    const perguntaEmbedding = embeddings[0];

    const { data: chunksData, error: matchErr } = await db.rpc("match_chunks", {
      query_embedding: perguntaEmbedding,
      query_text: pergunta,
      match_count: body.match_count ?? MATCH_COUNT_PADRAO,
      filtro: {},
    });
    if (matchErr) throw new Error(`match_chunks falhou: ${matchErr.message}`);

    const chunks = (chunksData ?? []) as ChunkResultado[];
    const idsRecuperados = new Set(chunks.map((c) => c.chunk_id));
    const melhorSimilaridade = chunks[0]?.similaridade ?? 0;

    // Etapa 14: mesma detecção determinística de preço que o `suggest` usa
    // — ver `_shared/precos.ts`.
    const cursoIdentificado = await identificarCursoCitado(db, [pergunta]);
    const cursosCandidatos = [
      ...new Set([...(cursoIdentificado ? [cursoIdentificado] : []), ...extrairCursosCandidatos(chunks)]),
    ].slice(0, 2);
    const { bloco: blocoPrecoOficial, injetado: precoOficialInjetado } = await montarBlocoPrecoOficial(
      db,
      cursosCandidatos,
      empresaAssociada,
      estadoLead,
      chunks,
    );

    let resultado: AskLLMOutput;
    let tokensPromptChat = 0;
    let tokensCompletion = 0;
    let tokensCache = 0;

    if (!precoOficialInjetado && (chunks.length === 0 || melhorSimilaridade < limiarRelevancia)) {
      // Sem trechos minimamente relevantes (e sem preço oficial pra essa
      // pergunta): nem vale chamar o modelo de chat.
      resultado = {
        resposta: "Não encontrei essa informação na base — confirme com a coordenação.",
        fontes: [],
        encontrado: false,
        confianca: "baixa",
      };
    } else {
      const chat = await chatJSON<AskLLMOutput>({
        model: modelos.chat,
        system: buildSystemPrompt(tomGeral, instrucoesAsk),
        user: buildUserPrompt(pergunta, chunks, blocoCursoIdentificado(cursoIdentificado) + blocoPrecoOficial),
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
      // NESTA requisição. Exceção: uma resposta fundamentada só no bloco de
      // preço oficial (sem chunk_id nenhum) continua válida.
      const fontesValidas = resultado.fontes.filter((id) => idsRecuperados.has(id));
      const houveFonteInvalida = fontesValidas.length !== resultado.fontes.length;
      resultado.fontes = fontesValidas;
      if (houveFonteInvalida) {
        resultado.confianca = "baixa";
        if (fontesValidas.length === 0 && !precoOficialInjetado) resultado.encontrado = false;
      }
    }

    // RF15/RF16
    let lacunaRegistrada = false;
    if (!resultado.encontrado) {
      const r = await registrarLacuna(db, pergunta, perguntaEmbedding, limiarDedup, chamador?.userId ?? null);
      lacunaRegistrada = r.registrada;
    }

    const usageLogId = await logUsage(db, {
      tipoChamada: "ask",
      modelo: modelos.chat,
      tokensEntrada: tokensPromptChat + tokensEmbeddingPergunta,
      tokensSaida: tokensCompletion,
      tokensCache,
      threadHash: body.thread_hash ?? null,
      userId: chamador?.userId ?? null,
    });

    // Trecho completo, não truncado: um chunk pode agrupar várias empresas/
    // cursos (ex.: convênios, 20 por chunk) e um corte fixo em N caracteres
    // quase sempre mostra a linha errada para quem está tentando verificar a
    // citação — indo contra o próprio motivo de existir o campo `fontes`.
    const fontesDetalhadas = resultado.fontes.map((id) => {
      const c = chunks.find((ch) => ch.chunk_id === id);
      return { chunk_id: id, trecho: c?.conteudo ?? null };
    });

    return jsonComCors({
      resposta: resultado.resposta,
      encontrado: resultado.encontrado,
      confianca: resultado.confianca,
      fontes: fontesDetalhadas,
      lacuna_registrada: lacunaRegistrada,
      usage_log_id: usageLogId,
    });
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : String(err);
    return jsonComCors({ error: mensagem }, { status: 500 });
  }
});
