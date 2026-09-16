// Content script (RF01-RF04). Só roda em app.hubspot.com/live-messages/*
// (ver manifest.json). Nunca lê nem envia nada antes de o atendente clicar
// em "Ativar copiloto" para aquela conversa específica (RF03).
import { getConfigCached, seletoresCalibrados } from "../lib/config-cache";
import { maskPII } from "../lib/pii";
import { buscarContextoLead, transcreverAudio } from "../lib/api";
import { hashThreadId, sha256Hex } from "../lib/hash";
import {
  extrairConversa,
  extrairEmpresaAssociada,
  extrairEstadoLead,
  extrairNomeLead,
  extrairThreadId,
} from "./parse-conversa";
import { inserirNoComposer } from "./composer";
import type {
  AtivacaoState,
  BaixarAudioResponse,
  ConfigRemota,
  ConversaExtraida,
  ConvenioInfo,
  InserirTextoRequest,
  InserirTextoResponse,
  MensagemExtraida,
  MensagemRuntime,
} from "../lib/types";

interface ContextoLead {
  nomeLead: string | null;
  estadoLead: string | null;
  empresaAssociada: string | null;
  convenio: ConvenioInfo | null;
}

// Cache por threadId: contato/empresa raramente mudam no meio de uma
// conversa, e sem isso toda checagem do `MutationObserver` (a cada
// mensagem nova) bateria de novo na API do HubSpot à toa.
const contextoLeadCache = new Map<string, ContextoLead>();

/**
 * Nome/estado/empresa/convênio vêm da API do HubSpot (`contexto-lead`),
 * não da tela — achado real (2026-09-15): o texto do cabeçalho da
 * conversa às vezes reflete um campo de texto livre do contato ("Nome da
 * empresa"), não a Empresa de fato associada via CRM. Se a API falhar
 * (rede, token do Private App não configurado etc.), cai de volta pra
 * leitura do DOM — pior qualidade, mas nunca quebra o painel.
 */
async function resolverContextoLead(
  threadId: string,
  config: ConfigRemota,
  doc: Document,
): Promise<ContextoLead> {
  const cacheHit = contextoLeadCache.get(threadId);
  if (cacheHit) return cacheHit;

  try {
    const resp = await buscarContextoLead(threadId);
    if (resp.encontrado) {
      const contexto: ContextoLead = {
        nomeLead: resp.nome ?? null,
        estadoLead: resp.estado ?? null,
        empresaAssociada: resp.empresa ?? null,
        convenio: resp.convenio ?? null,
      };
      contextoLeadCache.set(threadId, contexto);
      return contexto;
    }
  } catch (err) {
    console.error("buscarContextoLead() falhou, usando leitura do DOM como fallback:", err);
  }

  // Fallback: extração antiga via DOM (seletores calibrados, mas não
  // confiável pro nome da empresa — ver comentário acima).
  return {
    nomeLead: extrairNomeLead(doc, config.seletores_hubspot.nome_lead),
    estadoLead: extrairEstadoLead(doc, config.seletores_hubspot.estado_lead),
    empresaAssociada: extrairEmpresaAssociada(doc, config.seletores_hubspot.empresa_associada),
    convenio: null,
  };
}

// Cache de transcrições por URL de áudio, persistido em chrome.storage.local
// (não um Map em memória — achado real, 2026-09-15: um Map se perde toda
// vez que o content script recarrega — reload da extensão, navegação,
// reabrir a conversa — e a mesma nota de voz era transcrita de novo, gerando
// inclusive um texto DIFERENTE do anterior (o modelo não é 100%
// determinístico), o que confundia mais do que ajudava). Chave: hash da
// URL do áudio (a URL em si tem parâmetros de assinatura longos, hash evita
// isso e não guarda o token assinado em texto puro no storage).
const CACHE_TRANSCRICOES_KEY = "transcricoes_audio_cache";
type CacheTranscricoes = Record<string, string>;

async function lerCacheTranscricoes(): Promise<CacheTranscricoes> {
  const { [CACHE_TRANSCRICOES_KEY]: cache } = (await chrome.storage.local.get(CACHE_TRANSCRICOES_KEY)) as {
    [CACHE_TRANSCRICOES_KEY]?: CacheTranscricoes;
  };
  return cache ?? {};
}

async function obterTranscricaoCache(audioUrl: string): Promise<string | null> {
  const chave = await sha256Hex(audioUrl);
  const cache = await lerCacheTranscricoes();
  return cache[chave] ?? null;
}

async function definirTranscricaoCache(audioUrl: string, texto: string): Promise<void> {
  const chave = await sha256Hex(audioUrl);
  const cache = await lerCacheTranscricoes();
  cache[chave] = texto;
  await chrome.storage.local.set({ [CACHE_TRANSCRICOES_KEY]: cache });
}

/** Pedido do Raphael, 2026-09-15: opção manual de mandar transcrever de novo quando a transcrição saiu ruim. */
async function removerTranscricaoCache(audioUrl: string): Promise<void> {
  const chave = await sha256Hex(audioUrl);
  const cache = await lerCacheTranscricoes();
  delete cache[chave];
  await chrome.storage.local.set({ [CACHE_TRANSCRICOES_KEY]: cache });
}

/**
 * O download em si roda no service worker, não aqui — a URL do áudio
 * costuma ser de outro subdomínio do HubSpot (ex.: api-na1.hubspot.com), e
 * um fetch cross-origin feito pelo content script cairia no CORS da própria
 * página do HubSpot. O service worker, com `host_permissions`, contorna
 * isso (ver lib/audio.ts e background/service-worker.ts).
 */
function pedirDownloadDeAudio(url: string): Promise<BaixarAudioResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { tipo: "baixar-audio", url } satisfies MensagemRuntime,
      (resposta: BaixarAudioResponse | undefined) => {
        resolve(chrome.runtime.lastError || !resposta ? { ok: false } : resposta);
      },
    );
  });
}

async function resolverTexto(m: MensagemExtraida, threadHash: string): Promise<string> {
  if (!m.audioUrl) return m.texto;

  const cacheHit = await obterTranscricaoCache(m.audioUrl);
  if (cacheHit) return cacheHit;

  const audio = await pedirDownloadDeAudio(m.audioUrl);
  if (!audio.ok) return "[Áudio enviado — não consegui baixar pra transcrever]";

  try {
    const { texto } = await transcreverAudio({
      audioBase64: audio.base64,
      mimeType: audio.mimeType,
      threadHash,
    });
    const textoFinal = texto.trim() || "[Áudio enviado — transcrição veio vazia]";
    await definirTranscricaoCache(m.audioUrl, textoFinal);
    return textoFinal;
  } catch (err) {
    console.error("transcreverAudio() falhou:", err);
    return "[Áudio enviado — não consegui transcrever agora]";
  }
}

const BOTAO_ID = "copiloto-ativar-btn";
let observer: MutationObserver | null = null;
let threadIdAtual: string | null = null;

function injetarBotaoFlutuante(): HTMLButtonElement {
  const existente = document.getElementById(BOTAO_ID) as HTMLButtonElement | null;
  if (existente) return existente;

  const botao = document.createElement("button");
  botao.id = BOTAO_ID;
  botao.textContent = "Ativar copiloto";
  Object.assign(botao.style, {
    position: "fixed",
    bottom: "24px",
    right: "24px",
    zIndex: "999999",
    padding: "10px 16px",
    borderRadius: "999px",
    border: "none",
    background: "#00a4bd",
    color: "#fff",
    fontFamily: "sans-serif",
    fontSize: "13px",
    fontWeight: "600",
    cursor: "pointer",
    boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(botao);
  return botao;
}

async function atualizarBotao(botao: HTMLButtonElement, threadId: string) {
  const { ativacao_por_thread } = (await chrome.storage.local.get("ativacao_por_thread")) as {
    ativacao_por_thread?: AtivacaoState;
  };
  const ativo = ativacao_por_thread?.[threadId] ?? false;
  botao.textContent = ativo ? "Copiloto ativo — clique para desativar" : "Ativar copiloto";
  botao.style.background = ativo ? "#00bda5" : "#00a4bd";
}

async function alternarAtivacao(threadId: string) {
  const { ativacao_por_thread } = (await chrome.storage.local.get("ativacao_por_thread")) as {
    ativacao_por_thread?: AtivacaoState;
  };
  const estado = ativacao_por_thread ?? {};
  const novoValor = !(estado[threadId] ?? false);
  estado[threadId] = novoValor;
  await chrome.storage.local.set({ ativacao_por_thread: estado });
  chrome.runtime.sendMessage({
    tipo: "ativacao-mudou",
    threadId,
    ativo: novoValor,
  } satisfies MensagemRuntime);
}

async function estaAtiva(threadId: string): Promise<boolean> {
  const { ativacao_por_thread } = (await chrome.storage.local.get("ativacao_por_thread")) as {
    ativacao_por_thread?: AtivacaoState;
  };
  return ativacao_por_thread?.[threadId] ?? false;
}

function debounce<Args extends unknown[]>(fn: (...args: Args) => void, ms: number) {
  let handle: ReturnType<typeof setTimeout> | undefined;
  return (...args: Args) => {
    clearTimeout(handle);
    handle = setTimeout(() => fn(...args), ms);
  };
}

async function processarConversa(threadId: string) {
  if (!(await estaAtiva(threadId))) return; // RF03: conversa não ativa não é lida

  const config = await getConfigCached();
  if (!seletoresCalibrados(config)) {
    chrome.runtime.sendMessage({
      tipo: "seletores-nao-calibrados",
      threadId,
    } satisfies MensagemRuntime);
    return;
  }

  const container = document.querySelector(config.seletores_hubspot.container_mensagens!);
  if (!container) {
    chrome.runtime.sendMessage({
      tipo: "seletores-nao-calibrados",
      threadId,
    } satisfies MensagemRuntime);
    return;
  }

  const threadHash = await hashThreadId(threadId);
  const brutas = extrairConversa(container, config.seletores_hubspot as never);
  const mensagens = await Promise.all(
    brutas.map(async (m) => ({
      autor: m.autor,
      texto: maskPII(await resolverTexto(m, threadHash)), // RF04: mascara antes de qualquer envio/armazenamento
      hora: m.hora,
      // Pedido do Raphael, 2026-09-15: marca no painel que o texto veio de
      // uma nota de voz transcrita (pode ter erro de reconhecimento), não
      // foi digitado pelo lead/atendente. `audioUrl` some antes de ir pro
      // backend (api.ts::suggest() remove esse campo), só serve aqui pro
      // side panel poder pedir uma retranscrição dessa nota específica.
      viaAudio: Boolean(m.audioUrl),
      audioUrl: m.audioUrl ?? null,
    })),
  );

  const contexto = await resolverContextoLead(threadId, config, document);

  const conversa: ConversaExtraida = {
    threadId,
    mensagens,
    extraidoEm: new Date().toISOString(),
    ...contexto,
  };
  chrome.runtime.sendMessage({ tipo: "conversa-atualizada", conversa } satisfies MensagemRuntime);
}

const processarConversaComDebounce = debounce(processarConversa, 2000); // RF02: debounce de 2s

function observarContainer(threadId: string) {
  observer?.disconnect();

  getConfigCached().then((config) => {
    if (!seletoresCalibrados(config)) return;
    const container = document.querySelector(config.seletores_hubspot.container_mensagens!);
    if (!container) return;

    observer = new MutationObserver(() => processarConversaComDebounce(threadId));
    // A lista de mensagens é virtualizada e recicla os mesmos nós de DOM ao
    // invés de sempre inserir/remover (achado real testando com o Raphael:
    // uma mensagem nova do lead não disparava childList). Por isso observa
    // também mudança de texto (characterData) e atributos, não só filhos.
    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });
  });
}

async function iniciarParaThread(threadId: string) {
  threadIdAtual = threadId;
  const botao = injetarBotaoFlutuante();
  await atualizarBotao(botao, threadId);

  botao.onclick = async () => {
    await alternarAtivacao(threadId);
    await atualizarBotao(botao, threadId);
    if (await estaAtiva(threadId)) {
      observarContainer(threadId);
      processarConversaComDebounce(threadId);
    } else {
      observer?.disconnect();
    }
  };

  if (await estaAtiva(threadId)) {
    observarContainer(threadId);
    processarConversaComDebounce(threadId);
  }
}

function verificarUrl() {
  const threadId = extrairThreadId(location.href);
  if (!threadId) {
    document.getElementById(BOTAO_ID)?.remove();
    observer?.disconnect();
    threadIdAtual = null;
    return;
  }
  if (threadId !== threadIdAtual) {
    iniciarParaThread(threadId);
  }
}

// O HubSpot é uma SPA: a URL muda sem recarregar a página.
new MutationObserver(() => verificarUrl()).observe(document.body, {
  childList: true,
  subtree: true,
});
verificarUrl();

chrome.runtime.onMessage.addListener(
  (
    msg: MensagemRuntime | InserirTextoRequest,
    _sender,
    sendResponse: (resposta: InserirTextoResponse) => void,
  ) => {
    if (msg.tipo === "pedir-estado" && threadIdAtual) {
      processarConversa(threadIdAtual);
      return;
    }
    if (msg.tipo === "retranscrever-audio" && threadIdAtual) {
      removerTranscricaoCache(msg.audioUrl).then(() => processarConversa(threadIdAtual!));
      return;
    }
    if (msg.tipo === "inserir-texto") {
      getConfigCached().then((config) => {
        sendResponse(inserirNoComposer(msg.texto, config.seletores_hubspot));
      });
      return true; // mantém o canal aberto para a resposta assíncrona
    }
  },
);
