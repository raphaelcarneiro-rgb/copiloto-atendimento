// Edge Function `suggest` (Etapa 8 (adiantada) — US2, RF05-RF07, RF15-RF16).
// Sugere automaticamente até 3 respostas para as mensagens do lead ainda
// sem resposta, fundamentadas só nos trechos recuperados nesta mesma
// requisição (RF06). Reaproveita toda a infraestrutura de `ask` (busca
// híbrida, chatJSON, validação de citações, lacunas, custo).
//
// Classificação de etapa (RF05, US1): o LLM identifica qual etapa do
// roteiro comercial (tabela `playbook`, 6 passos fornecidos pelo Raphael em
// 2026-09-14) melhor descreve o momento da conversa — mas só pode escolher
// entre as etapas que realmente existem na tabela (enum no JSON Schema,
// construído a partir do banco). O texto do script devolvido ao atendente
// (`script_etapa`) vem sempre da tabela, nunca é escrito pelo modelo —
// classificar "qual etapa" não é uma afirmação factual sobre a Infnet, mas
// o CONTEÚDO do script precisa ser o real, senão vira a mesma alucinação
// que o projeto existe para evitar.
//
// POST { mensagens: {autor: "lead"|"atendente", texto: string, hora: string|null}[], thread_hash?: string, match_count?: number }

import { createServiceClient, getConfig, logUsage } from "../_shared/db.ts";
import { chatJSON, embedTexts } from "../_shared/openai.ts";
import { maskPII } from "../_shared/pii.ts";
import { jsonComCors, respondCorsPreflight } from "../_shared/cors.ts";
import { registrarLacuna } from "../_shared/lacunas.ts";
import { resolverChamador } from "../_shared/auth_context.ts";
import { INSTRUCAO_FORMATACAO_WHATSAPP } from "../_shared/formatacao.ts";

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

interface PlaybookRow {
  etapa: string;
  ordem: number;
  objetivo: string | null;
  script: string;
  perguntas_chave: string[];
}

interface SugestaoLLM {
  texto: string;
  fontes: number[];
}

// Maior que o padrão do `ask` (8): `suggest` frequentemente precisa de
// vários fatos ao mesmo tempo (curso + preço + nível de convênio), e cada
// um desses concorre por vaga nas metades da busca estreita/ampla — achado
// real testando o cálculo de preço com desconto (etapa 8, 2026-09-14).
const MATCH_COUNT_PADRAO = 12;

// Rede de segurança além da instrução no prompt (achado real, 2026-09-14:
// o modelo às vezes respondia a maior parte da pergunta certo, mas
// deixava vazar uma frase de incerteza dentro do MEIO da sugestão, tipo
// "no momento não tenho informação de X" — texto que não devia ir pro
// lead nunca, faz o atendente parecer despreparado). Se aparecer, a
// sugestão inteira vira lacuna em vez de arriscar deixar passar.
const PADRAO_INCERTEZA =
  /n[ãa]o tenho (essa )?informa[çc][ãa]o|n[ãa]o tenho certeza|no momento,? n[ãa]o (sei|tenho)|n[ãa]o sei informar|posso verificar (essa|isso|essa possibilidade)|vou verificar e (te )?retorno|n[ãa]o consigo confirmar/i;

interface SuggestLLMOutput {
  etapa_atual: string;
  sugestoes: SugestaoLLM[];
  perguntas_para_lead: string[];
  lacunas: string[];
  confianca: "alta" | "media" | "baixa";
}

function buildSchema(etapasValidas: string[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["etapa_atual", "sugestoes", "perguntas_para_lead", "lacunas", "confianca"],
    properties: {
      etapa_atual: { type: "string", enum: etapasValidas },
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
}

interface PromptsEditaveis {
  tomGeral: string;
  aberturaResposta: string;
  aberturaFollowup: string;
  fechamentoResposta: string;
  fechamentoFollowup: string;
}

function buildSystemPrompt(
  playbook: PlaybookRow[],
  empresaAssociada: string | null,
  modo: "resposta" | "follow_up",
  prompts: PromptsEditaveis,
): string {
  const roteiro = playbook
    .sort((a, b) => a.ordem - b.ordem)
    .map(
      (p) =>
        `- "${p.etapa}": ${p.objetivo ?? ""}${
          p.perguntas_chave.length > 0 ? ` (perguntas-chave: ${p.perguntas_chave.join(" / ")})` : ""
        }`,
    )
    .join("\n");

  // Trechos abaixo (abertura/fechamento/tom) vêm do `config` — editáveis
  // pelo portal admin sem deploy (Etapa 12). O restante (RF06, formato de
  // citação, filtro de incerteza, JSON Schema) fica fixo no código de
  // propósito — é o núcleo anti-alucinação (Constitution §1).
  const instrucaoAbertura = modo === "follow_up" ? prompts.aberturaFollowup : prompts.aberturaResposta;

  return [
    "Você é o copiloto de atendimento comercial da Faculdade Infnet, ajudando um atendente humano a responder um lead pelo WhatsApp.",
    instrucaoAbertura,
    "Sugira até 3 respostas curtas e diretas que o atendente poderia mandar — cada uma fundamentada SOMENTE nos trechos numerados do contexto.",
    "Nunca invente preço, data, duração ou qualquer dado. Se a base não tiver informação suficiente para responder com segurança a algum ponto, NÃO crie uma sugestão para esse ponto — em vez disso, descreva a dúvida em 'lacunas'.",
    "IMPORTANTE: cada texto em 'sugestoes' é a mensagem EXATA que o atendente vai colar e mandar pro lead — nunca escreva, dentro dela, frases dirigidas ao atendente ou que expõem incerteza pro lead, como 'não tenho essa informação', 'no momento não sei', 'vou verificar e te retorno', 'posso confirmar isso pra você'. Isso faz o atendente (que pode saber a resposta de cabeça) parecer despreparado na frente do cliente. Se a pergunta tem uma parte que você responde com confiança e outra que não, responda SÓ a parte confiável na sugestão (se ela ainda fizer sentido sozinha) e jogue a parte sem fundamento inteira em 'lacunas' — nunca misture as duas coisas numa única mensagem.",
    'No campo "fontes" de cada sugestão, cite o(s) valor(es) exato(s) de chunk_id (o número depois de "chunk_id=" antes do trecho) — nunca invente ou adivinhe um chunk_id.',
    "\n\nRoteiro comercial da Infnet, em 6 etapas (não necessariamente nessa ordem, mas todo atendimento deve tentar passar por elas):\n" +
      roteiro,
    "\nEm 'etapa_atual', identifique qual dessas etapas melhor descreve o momento AGORA da conversa (use exatamente uma das chaves entre aspas acima, ex.: \"descoberta\").",
    "Se alguma informação de uma etapa anterior ainda não foi coletada (ex.: nome da empresa, nível de convênio) e isso ajudaria a responder melhor, inclua a pergunta correspondente em 'perguntas_para_lead' — mas só se ainda não tiver sido perguntada ou respondida na conversa.",
    "Se a conversa já trouxe dados como empresa, convênio ou interesse específico (inclusive de mensagens automáticas/chatbot), USE esses dados para enriquecer a sugestão (ex.: já calcular o desconto do convênio certo) em vez de perguntar de novo.",
    empresaAssociada
      ? `A empresa do lead JÁ está associada no CRM do HubSpot: "${empresaAssociada}". NUNCA pergunte o nome da empresa em 'perguntas_para_lead' nem na sugestão — ela já é conhecida. Use esse nome pra procurar o convênio dela nos trechos do contexto e responder/calcular o desconto diretamente; se não achar essa empresa nos trechos recuperados, registre a dúvida em 'lacunas' (não pergunte de novo o nome, pergunte outra coisa se precisar, tipo confirmar o convênio com a coordenação).`
      : "",
    modo === "follow_up" ? prompts.fechamentoFollowup : prompts.fechamentoResposta,
    prompts.tomGeral,
    INSTRUCAO_FORMATACAO_WHATSAPP,
  ].join(" ");
}

function buildUserPrompt(
  mensagens: MensagemEntrada[],
  chunks: ChunkResultado[],
  empresaAssociada: string | null,
  modo: "resposta" | "follow_up",
): string {
  const conversa = mensagens
    .map((m) => `${m.autor === "lead" ? "Lead" : "Atendente"}: ${m.texto}`)
    .join("\n");
  const contexto = chunks
    .map((c) => `--- chunk_id=${c.chunk_id} ---\n${c.conteudo}`)
    .join("\n\n");
  const linhaEmpresa = empresaAssociada
    ? `Empresa do lead (já associada no CRM, não precisa perguntar): ${empresaAssociada}\n\n`
    : "";
  const linhaConversa =
    modo === "follow_up"
      ? `Conversa completa (o ATENDENTE mandou a última mensagem e o lead ainda não respondeu):\n${conversa}\n\n`
      : `Conversa completa (as últimas mensagens do lead, se houver mais de uma seguida, ainda não têm resposta):\n${conversa}\n\n`;
  return (
    linhaEmpresa +
    linhaConversa +
    `Contexto recuperado da base de conhecimento (cite pelo chunk_id exato indicado antes de cada trecho):\n\n${contexto}`
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return respondCorsPreflight();
  if (req.method !== "POST") {
    return jsonComCors({ error: "use POST" }, { status: 405 });
  }

  let body: {
    mensagens?: MensagemEntrada[];
    thread_hash?: string;
    match_count?: number;
    empresa_associada?: string;
    modo?: "resposta" | "follow_up";
  };
  try {
    body = await req.json();
  } catch {
    return jsonComCors({ error: "corpo JSON inválido" }, { status: 400 });
  }

  if (!body.mensagens || body.mensagens.length === 0) {
    return jsonComCors({ error: "campo 'mensagens' é obrigatório e não pode ser vazio" }, { status: 400 });
  }

  const modo: "resposta" | "follow_up" = body.modo === "follow_up" ? "follow_up" : "resposta";

  // RF04: mascara PII em toda a conversa antes de qualquer processamento.
  const mensagens = body.mensagens.map((m) => ({ ...m, texto: maskPII(m.texto) }));

  // "resposta" (padrão): pega TODAS as mensagens do lead no final da
  // conversa, não só a última — numa sequência Lead/Lead/Lead sem resposta
  // do atendente entre elas, todas contam como pendentes.
  // "follow_up" (pedido do Raphael, 2026-09-15): o ATENDENTE mandou a
  // última mensagem e o lead sumiu — o foco de busca vira essa última
  // mensagem do atendente (o que ficou sem resposta), não uma pergunta do lead.
  let mensagensNaoRespondidas: MensagemEntrada[];
  if (modo === "follow_up") {
    const ultima = mensagens[mensagens.length - 1];
    if (!ultima || ultima.autor !== "atendente") {
      return jsonComCors(
        { error: "modo 'follow_up' exige que a última mensagem da conversa seja do atendente" },
        { status: 400 },
      );
    }
    mensagensNaoRespondidas = [ultima];
  } else {
    mensagensNaoRespondidas = [];
    for (let i = mensagens.length - 1; i >= 0; i--) {
      if (mensagens[i].autor !== "lead") break;
      mensagensNaoRespondidas.unshift(mensagens[i]);
    }
    if (mensagensNaoRespondidas.length === 0) {
      return jsonComCors(
        { error: "nenhuma mensagem do lead sem resposta encontrada — nada para sugerir" },
        { status: 400 },
      );
    }
  }
  const textoNaoRespondido = mensagensNaoRespondidas.map((m) => m.texto).join(" \n ");
  // RF (pedido do Raphael, 2026-09-15): a empresa do lead já pode estar
  // associada no CRM (painel do contato no HubSpot) — nesse caso o
  // suggest nunca deve perguntar de novo, e usa o nome direto pra buscar
  // o convênio dela.
  const empresaAssociada = body.empresa_associada?.trim() || null;

  const db = createServiceClient();
  // RF20: opcional — sem login (ainda comum) continua funcionando normal,
  // só sem ficar registrado pra receber aviso de FAQ aprovada.
  const chamador = await resolverChamador(db, req);

  try {
    const [
      limiarRelevancia,
      limiarDedup,
      modelos,
      playbookResult,
      tomGeral,
      aberturaResposta,
      aberturaFollowup,
      fechamentoResposta,
      fechamentoFollowup,
    ] = await Promise.all([
      getConfig(db, "limiar_relevancia") as Promise<number>,
      getConfig(db, "limiar_dedup") as Promise<number>,
      getConfig(db, "modelos") as Promise<{ chat: string }>,
      db
        .from("playbook")
        .select("etapa, ordem, objetivo, script, perguntas_chave")
        .eq("ativo", true) as unknown as Promise<{ data: PlaybookRow[] | null; error: { message: string } | null }>,
      getConfig(db, "prompt_tom_geral") as Promise<string>,
      getConfig(db, "prompt_suggest_abertura_resposta") as Promise<string>,
      getConfig(db, "prompt_suggest_abertura_followup") as Promise<string>,
      getConfig(db, "prompt_suggest_fechamento_resposta") as Promise<string>,
      getConfig(db, "prompt_suggest_fechamento_followup") as Promise<string>,
    ]);
    if (playbookResult.error) throw new Error(`playbook.select falhou: ${playbookResult.error.message}`);
    const playbook = playbookResult.data ?? [];
    if (playbook.length === 0) throw new Error("tabela playbook está vazia — cadastre as etapas primeiro");
    const etapasValidas = playbook.map((p) => p.etapa);
    const prompts: PromptsEditaveis = {
      tomGeral,
      aberturaResposta,
      aberturaFollowup,
      fechamentoResposta,
      fechamentoFollowup,
    };

    let tokensEmbeddingPergunta = 0;

    async function buscar(consultaTexto: string) {
      const { embeddings, promptTokens } = await embedTexts([consultaTexto]);
      tokensEmbeddingPergunta += promptTokens;
      const { data, error } = await db.rpc("match_chunks", {
        query_embedding: embeddings[0],
        query_text: consultaTexto,
        match_count: body.match_count ?? MATCH_COUNT_PADRAO,
        filtro: {},
      });
      if (error) throw new Error(`match_chunks falhou: ${error.message}`);
      return (data ?? []) as ChunkResultado[];
    }

    // Busca em duas versões, sempre as duas, e depois JUNTA os resultados
    // (não escolhe uma) — três achados reais, cada um invalidando a
    // correção anterior:
    // 1) só a(s) mensagem(ns) sem resposta falha quando o assunto (ex.:
    //    nome do curso) foi mencionado numa mensagem anterior já respondida
    //    → precisa do contexto mais amplo.
    // 2) incluir mensagens anteriores por padrão falha quando elas são
    //    sobre OUTRO assunto — dilui o embedding → precisa da busca
    //    estreita (só o que está pendente).
    // 3) "tenta as duas, fica com a que tiver maior similaridade no topo"
    //    também falhava: a busca ampla, diluída, pode pontuar mais alto num
    //    chunk ERRADO do que a busca estreita pontua no chunk CERTO.
    // 4) juntar TODAS as mensagens não respondidas numa única busca "estreita"
    //    tem o mesmo problema do item 2 quando o lead manda várias mensagens
    //    seguidas sobre assuntos diferentes (ex.: "Trabalho na Theos" +
    //    "quanto fica o MBA com desconto") — cada fato precisa da sua própria
    //    busca, senão o embedding combinado dilui os dois. Achado real
    //    testando curso+preço+convênio juntos (etapa 8, 2026-09-14).
    // Correção: busca cada mensagem não respondida individualmente, além do
    // contexto mais amplo, pega o topo de CADA busca separadamente e junta
    // os candidatos (dedup por chunk_id, maior similaridade), deixando o LLM
    // e a validação RF06 decidirem o que é relevante.
    const JANELA_CONTEXTO = 6;
    const contextoRecente = mensagens
      .slice(-JANELA_CONTEXTO)
      .map((m) => m.texto)
      .join(" \n ");

    // A empresa associada vira uma busca própria também — o mesmo achado da
    // etapa 8 (cada fato precisa da sua consulta, senão dilui) se aplica
    // aqui: "convênio da empresa X" tem que competir sozinho pelo top da
    // busca, não só como parte da pergunta original do lead.
    const consultasIndividuais = [
      ...new Set([...mensagensNaoRespondidas.map((m) => m.texto), ...(empresaAssociada ? [`convênio da empresa ${empresaAssociada}`] : [])]),
    ];
    const [resultadosIndividuais, chunksAmpla] = await Promise.all([
      Promise.all(consultasIndividuais.map((texto) => buscar(texto))),
      contextoRecente === textoNaoRespondido ? Promise.resolve([]) : buscar(contextoRecente),
    ]);

    const matchCount = body.match_count ?? MATCH_COUNT_PADRAO;
    const fatiaPorBusca = Math.max(3, Math.ceil(matchCount / (consultasIndividuais.length + 1)));
    const melhorPorChunk = new Map<number, ChunkResultado>();
    for (const lista of [...resultadosIndividuais, chunksAmpla]) {
      for (const c of lista.slice(0, fatiaPorBusca)) {
        const atual = melhorPorChunk.get(c.chunk_id);
        if (!atual || c.similaridade > atual.similaridade) melhorPorChunk.set(c.chunk_id, c);
      }
    }
    const chunks = [...melhorPorChunk.values()].sort((a, b) => b.similaridade - a.similaridade);

    const idsRecuperados = new Set(chunks.map((c) => c.chunk_id));
    const melhorSimilaridade = chunks[0]?.similaridade ?? 0;

    let resultado: SuggestLLMOutput;
    let tokensPromptChat = 0;
    let tokensCompletion = 0;
    let tokensCache = 0;

    // Follow-up é uma mensagem de reengajamento, não uma afirmação factual
    // nova — não precisa de trecho fundamentado pra existir (ex.: "ficou
    // alguma dúvida?" não cita nada). Por isso só o modo "resposta" pula o
    // LLM quando não há contexto relevante (constitution §1 — sem
    // fundamento pra responder uma pergunta, não inventa).
    if (modo === "resposta" && (chunks.length === 0 || melhorSimilaridade < limiarRelevancia)) {
      // Sem trechos minimamente relevantes: nem vale chamar o modelo de
      // chat — não tem como fundamentar nada (constitution §1). Mesmo
      // assim precisamos de uma etapa_atual válida; "descoberta" (ordem 1)
      // é o fallback mais seguro quando não dá pra inferir nada da base.
      resultado = {
        etapa_atual: playbook.sort((a, b) => a.ordem - b.ordem)[0].etapa,
        sugestoes: [],
        perguntas_para_lead: [],
        lacunas: [textoNaoRespondido],
        confianca: "baixa",
      };
    } else {
      const chat = await chatJSON<SuggestLLMOutput>({
        model: modelos.chat,
        system: buildSystemPrompt(playbook, empresaAssociada, modo, prompts),
        user: buildUserPrompt(mensagens, chunks, empresaAssociada, modo),
        schemaName: "suggest_response",
        schema: buildSchema(etapasValidas),
      });
      resultado = chat.content;
      tokensPromptChat = chat.promptTokens;
      tokensCompletion = chat.completionTokens;
      tokensCache = chat.cachedTokens;

      // RF06: descarta citações que não pertencem ao conjunto recuperado
      // NESTA requisição. Uma sugestão sem nenhuma fonte válida não é uma
      // sugestão fundamentada — vira lacuna em vez de aparecer pro
      // atendente como resposta pronta. Exceção: follow-up é reengajamento,
      // não uma afirmação factual nova — não precisa citar nada pra ser
      // válido (ex.: "ficou alguma dúvida?" não fundamenta nada porque não
      // afirma nada nas suas próprias palavras).
      const sugestoesValidas: SugestaoLLM[] = [];
      const lacunasExtras: string[] = [];
      let houveFonteInvalida = false;
      for (const s of resultado.sugestoes) {
        const fontesValidas = s.fontes.filter((id) => idsRecuperados.has(id));
        if (fontesValidas.length !== s.fontes.length) houveFonteInvalida = true;
        if (fontesValidas.length === 0 && s.fontes.length > 0) {
          // Citou algo, mas nada bateu com o que foi recuperado — isso sim é suspeito.
          lacunasExtras.push(s.texto);
        } else if (fontesValidas.length === 0 && modo === "resposta") {
          lacunasExtras.push(s.texto);
        } else if (PADRAO_INCERTEZA.test(s.texto)) {
          // A sugestão vazou uma frase de incerteza dirigida ao lead — nunca
          // mostra isso como resposta pronta, mesmo tendo fonte válida.
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
      const r = await registrarLacuna(db, lacuna, lacunaEmbeddings[0], limiarDedup, chamador?.userId ?? null);
      if (r.registrada) lacunaRegistrada = true;
    }

    const usageLogId = await logUsage(db, {
      tipoChamada: "suggest",
      modelo: modelos.chat,
      userId: chamador?.userId ?? null,
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

    // O script devolvido é sempre o texto real da tabela `playbook` — o
    // LLM só escolhe QUAL etapa (restrito por enum), nunca escreve o
    // conteúdo do script.
    const etapaEscolhida = playbook.find((p) => p.etapa === resultado.etapa_atual);

    return jsonComCors({
      etapa: resultado.etapa_atual,
      script_etapa: etapaEscolhida?.script ?? "",
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
