// Edge Function `suggest` (Etapa 8 (adiantada) — US2, RF05-RF07, RF15-RF16).
// Sugere automaticamente até 3 respostas para a última mensagem do lead,
// fundamentadas só nos trechos recuperados nesta mesma requisição (RF06).
// Reaproveita toda a infraestrutura de `ask` (busca híbrida, chatJSON,
// validação de citações, lacunas, custo).
//
// Versão v1, deliberadamente sem classificação de etapa do playbook: o
// Manual de Boas Práticas hoje só existe como texto corrido (etapa 2), não
// dividido por etapa da conversa — não dava pra fingir uma classificação
// sem dado real por trás. `etapa`/`script_etapa` ficam com valor fixo até
// o playbook estruturado existir (ver contracts/suggestion.schema.json).
//
// POST { mensagens: {autor: "lead"|"atendente", texto: string, hora: string|null}[], thread_hash?: string, match_count?: number }

import { createServiceClient, getConfig, logUsage } from "../_shared/db.ts";
import { chatJSON, embedTexts } from "../_shared/openai.ts";
import { maskPII } from "../_shared/pii.ts";
import { jsonComCors, respondCorsPreflight } from "../_shared/cors.ts";
import { registrarLacuna } from "../_shared/lacunas.ts";

interface MensagemEntrada {
  autor: "lead" | "atendente";
  texto: string;
  hora: string | null;
}

interface ChunkResultado {
  chunk_id: number;
  document_id: string;
  conteudo: string;
  metadados: Record<string, unknown>;
  similaridade: number;
  rrf_score: number;
}

interface SugestaoLLM {
  texto: string;
  fontes: number[];
}

interface SuggestLLMOutput {
  sugestoes: SugestaoLLM[];
  perguntas_para_lead: string[];
  lacunas: string[];
  confianca: "alta" | "media" | "baixa";
}

const SUGGEST_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["sugestoes", "perguntas_para_lead", "lacunas", "confianca"],
  properties: {
    sugestoes: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["texto", "fontes"],
        properties: {
          texto: { type: "string" },
          fontes: { type: "array", items: { type: "integer" } },
        },
      },
    },
    perguntas_para_lead: { type: "array", items: { type: "string" } },
    lacunas: { type: "array", items: { type: "string" } },
    confianca: { type: "string", enum: ["alta", "media", "baixa"] },
  },
} as const;

function buildSystemPrompt(): string {
  return [
    "Você é o copiloto de atendimento comercial da Faculdade Infnet, ajudando um atendente humano a responder um lead pelo WhatsApp.",
    "Você vê a conversa recente; a última mensagem é do lead e ainda não foi respondida.",
    "Sugira até 3 respostas curtas e diretas que o atendente poderia mandar — cada uma fundamentada SOMENTE nos trechos numerados do contexto.",
    "Nunca invente preço, data, duração ou qualquer dado. Se a base não tiver informação suficiente para responder com segurança a algum ponto da mensagem do lead, NÃO crie uma sugestão para esse ponto — em vez disso, descreva a dúvida em 'lacunas'.",
    'No campo "fontes" de cada sugestão, cite o(s) valor(es) exato(s) de chunk_id (o número depois de "chunk_id=" antes do trecho) — nunca invente ou adivinhe um chunk_id.',
    "Em 'perguntas_para_lead', sugira até 2 perguntas de esclarecimento que ajudem a entender melhor a necessidade do lead — essas não precisam de fonte, são só perguntas.",
    "Se a última mensagem do lead não pedir nenhuma informação (ex.: só um agradecimento), devolva 'sugestoes' vazio.",
    "Seja direto e objetivo, em português do Brasil, como uma mensagem de WhatsApp de atendimento comercial.",
  ].join(" ");
}

function buildUserPrompt(mensagens: MensagemEntrada[], chunks: ChunkResultado[]): string {
  const conversa = mensagens
    .map((m) => `${m.autor === "lead" ? "Lead" : "Atendente"}: ${m.texto}`)
    .join("\n");
  const contexto = chunks
    .map((c) => `--- chunk_id=${c.chunk_id} ---\n${c.conteudo}`)
    .join("\n\n");
  return (
    `Conversa recente (a última mensagem é do lead, ainda sem resposta):\n${conversa}\n\n` +
    `Contexto recuperado da base de conhecimento (cite pelo chunk_id exato indicado antes de cada trecho):\n\n${contexto}`
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return respondCorsPreflight();
  if (req.method !== "POST") {
    return jsonComCors({ error: "use POST" }, { status: 405 });
  }

  let body: { mensagens?: MensagemEntrada[]; thread_hash?: string; match_count?: number };
  try {
    body = await req.json();
  } catch {
    return jsonComCors({ error: "corpo JSON inválido" }, { status: 400 });
  }

  if (!body.mensagens || body.mensagens.length === 0) {
    return jsonComCors({ error: "campo 'mensagens' é obrigatório e não pode ser vazio" }, { status: 400 });
  }

  // RF04: mascara PII em toda a conversa antes de qualquer processamento.
  const mensagens = body.mensagens.map((m) => ({ ...m, texto: maskPII(m.texto) }));

  const ultimaDoLead = [...mensagens].reverse().find((m) => m.autor === "lead");
  if (!ultimaDoLead) {
    return jsonComCors(
      { error: "nenhuma mensagem do lead encontrada na conversa — nada para sugerir" },
      { status: 400 },
    );
  }

  const db = createServiceClient();

  try {
    const [limiarRelevancia, limiarDedup, modelos] = await Promise.all([
      getConfig(db, "limiar_relevancia") as Promise<number>,
      getConfig(db, "limiar_dedup") as Promise<number>,
      getConfig(db, "modelos") as Promise<{ chat: string }>,
    ]);

    // Busca em duas versões, sempre as duas, e depois JUNTA os resultados
    // (não escolhe uma) — três achados reais, cada um invalidando a
    // correção anterior:
    // 1) só a última mensagem falha quando o assunto (ex.: nome do curso)
    //    foi mencionado numa mensagem anterior ("quando começa a turma?"
    //    sozinho não recupera nada com similaridade boa) → precisa do
    //    contexto mais amplo.
    // 2) incluir mensagens anteriores por padrão falha quando elas são
    //    sobre OUTRO assunto — uma pergunta autossuficiente sobre desconto
    //    de convênio não foi encontrada porque a janela de contexto vinha
    //    carregada com uma troca anterior sobre data de turma de um curso
    //    diferente, que diluiu o embedding → precisa da busca estreita.
    // 3) "tenta as duas, fica com a que tiver maior similaridade no topo"
    //    (a correção anterior) ainda falhava: a busca ampla, diluída,
    //    pontuou 0.63 num chunk ERRADO (curso de Java), enquanto a busca
    //    estreita tinha o chunk CERTO (convênio da Theós) mas só a 0.48 —
    //    escolher "a lista toda com maior nota no topo" descartava o chunk
    //    certo mesmo ele estando disponível. A correção real é não
    //    escolher uma lista inteira: junta as duas (união, maior
    //    similaridade por chunk_id) e deixa o LLM (com RF06 validando
    //    depois) decidir o que usar dentre os candidatos das duas buscas.
    let tokensEmbeddingPergunta = 0;

    async function buscar(consultaTexto: string) {
      const { embeddings, promptTokens } = await embedTexts([consultaTexto]);
      tokensEmbeddingPergunta += promptTokens;
      const { data, error } = await db.rpc("match_chunks", {
        query_embedding: embeddings[0],
        query_text: consultaTexto,
        match_count: body.match_count ?? 8,
        filtro: {},
      });
      if (error) throw new Error(`match_chunks falhou: ${error.message}`);
      return (data ?? []) as ChunkResultado[];
    }

    const JANELA_CONTEXTO = 6;
    const contextoRecente = mensagens
      .slice(-JANELA_CONTEXTO)
      .map((m) => m.texto)
      .join(" \n ");

    const [chunksEstreita, chunksAmpla] =
      contextoRecente === ultimaDoLead.texto
        ? [await buscar(ultimaDoLead.texto), []]
        : await Promise.all([buscar(ultimaDoLead.texto), buscar(contextoRecente)]);

    // Pega o topo de CADA busca antes de juntar — não junta tudo e trunca
    // pela nota geral. Achado real: a busca ampla pontua mais alto em geral
    // (frase mais longa tende a ter cosseno maior contra qualquer chunk
    // razoavelmente parecido), então um corte único pelas 8 melhores da
    // união inteira deixava as 8 vagas todas para a busca ampla — e o chunk
    // certo, que só a busca estreita achou (nota mais baixa, mas era o
    // certo), ficava de fora.
    const METADE = Math.ceil((body.match_count ?? 8) / 2);
    const melhorPorChunk = new Map<number, ChunkResultado>();
    for (const c of [...chunksEstreita.slice(0, METADE), ...chunksAmpla.slice(0, METADE)]) {
      const atual = melhorPorChunk.get(c.chunk_id);
      if (!atual || c.similaridade > atual.similaridade) melhorPorChunk.set(c.chunk_id, c);
    }
    const chunks = [...melhorPorChunk.values()].sort((a, b) => b.similaridade - a.similaridade);

    const idsRecuperados = new Set(chunks.map((c) => c.chunk_id));
    const melhorSimilaridade = chunks[0]?.similaridade ?? 0;

    let resultado: SuggestLLMOutput;
    let tokensPromptChat = 0;
    let tokensCompletion = 0;
    let tokensCache = 0;

    if (chunks.length === 0 || melhorSimilaridade < limiarRelevancia) {
      // Sem trechos minimamente relevantes: nem vale chamar o modelo de
      // chat — não tem como fundamentar nada (constitution §1).
      resultado = {
        sugestoes: [],
        perguntas_para_lead: [],
        lacunas: [ultimaDoLead.texto],
        confianca: "baixa",
      };
    } else {
      const chat = await chatJSON<SuggestLLMOutput>({
        model: modelos.chat,
        system: buildSystemPrompt(),
        user: buildUserPrompt(mensagens, chunks),
        schemaName: "suggest_response",
        schema: SUGGEST_JSON_SCHEMA,
      });
      resultado = chat.content;
      tokensPromptChat = chat.promptTokens;
      tokensCompletion = chat.completionTokens;
      tokensCache = chat.cachedTokens;

      // RF06: descarta citações que não pertencem ao conjunto recuperado
      // NESTA requisição. Uma sugestão sem nenhuma fonte válida não é uma
      // sugestão fundamentada — vira lacuna em vez de aparecer pro
      // atendente como resposta pronta.
      const sugestoesValidas: SugestaoLLM[] = [];
      const lacunasExtras: string[] = [];
      let houveFonteInvalida = false;
      for (const s of resultado.sugestoes) {
        const fontesValidas = s.fontes.filter((id) => idsRecuperados.has(id));
        if (fontesValidas.length !== s.fontes.length) houveFonteInvalida = true;
        if (fontesValidas.length === 0) {
          lacunasExtras.push(s.texto);
        } else {
          sugestoesValidas.push({ texto: s.texto, fontes: fontesValidas });
        }
      }
      resultado.sugestoes = sugestoesValidas;
      resultado.lacunas = [...resultado.lacunas, ...lacunasExtras];
      if (houveFonteInvalida) resultado.confianca = "baixa";
    }

    // RF15/RF16: cada lacuna reportada pelo LLM vira (ou reforça) uma
    // entrada em knowledge_gaps — mesmo mecanismo de dedup do `ask`.
    let lacunaRegistrada = false;
    for (const lacuna of resultado.lacunas) {
      const { embeddings: lacunaEmbeddings } = await embedTexts([lacuna]);
      const r = await registrarLacuna(db, lacuna, lacunaEmbeddings[0], limiarDedup);
      if (r.registrada) lacunaRegistrada = true;
    }

    const usageLogId = await logUsage(db, {
      tipoChamada: "suggest",
      modelo: modelos.chat,
      tokensEntrada: tokensPromptChat + tokensEmbeddingPergunta,
      tokensSaida: tokensCompletion,
      tokensCache,
      threadHash: body.thread_hash ?? null,
    });

    const sugestoesDetalhadas = resultado.sugestoes.map((s) => ({
      texto: s.texto,
      fontes: s.fontes.map((id) => {
        const c = chunks.find((ch) => ch.chunk_id === id);
        return { chunk_id: id, trecho: c?.conteudo ?? null };
      }),
    }));

    return jsonComCors({
      // Fixo até existir um playbook estruturado por etapa (ver comentário
      // no topo do arquivo) — não é uma classificação real, só um placeholder
      // consistente com contracts/suggestion.schema.json.
      etapa: "nao_classificado",
      script_etapa: "",
      sugestoes: sugestoesDetalhadas,
      perguntas_para_lead: resultado.perguntas_para_lead,
      alertas: [],
      lacunas: resultado.lacunas,
      confianca: resultado.confianca,
      lacuna_registrada: lacunaRegistrada,
      usage_log_id: usageLogId,
    });
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : String(err);
    return jsonComCors({ error: mensagem }, { status: 500 });
  }
});
