// Content script (RF01-RF04). Só roda em app.hubspot.com/live-messages/*
// (ver manifest.json). Nunca lê nem envia nada antes de o atendente clicar
// em "Ativar copiloto" para aquela conversa específica (RF03).
import { getConfigCached, seletoresCalibrados } from "../lib/config-cache";
import { maskPII } from "../lib/pii";
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
  ConversaExtraida,
  InserirTextoRequest,
  InserirTextoResponse,
  MensagemRuntime,
} from "../lib/types";

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

  const mensagens = extrairConversa(container, config.seletores_hubspot as never).map((m) => ({
    ...m,
    texto: maskPII(m.texto), // RF04: mascara antes de qualquer envio/armazenamento
  }));

  const conversa: ConversaExtraida = {
    threadId,
    mensagens,
    extraidoEm: new Date().toISOString(),
    empresaAssociada: extrairEmpresaAssociada(document, config.seletores_hubspot.empresa_associada),
    nomeLead: extrairNomeLead(document, config.seletores_hubspot.nome_lead),
    estadoLead: extrairEstadoLead(document, config.seletores_hubspot.estado_lead),
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
    if (msg.tipo === "inserir-texto") {
      getConfigCached().then((config) => {
        sendResponse(inserirNoComposer(msg.texto, config.seletores_hubspot));
      });
      return true; // mantém o canal aberto para a resposta assíncrona
    }
  },
);
