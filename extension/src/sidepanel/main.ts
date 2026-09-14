// Side panel v0 (etapa 5): só exibe a conversa extraída pelo content script.
// Sem IA ainda — isso entra na etapa 7 (integração com suggest/ask).
import { getConfigCached, versaoMenorQue } from "../lib/config-cache";
import type { ConversaExtraida, MensagemRuntime } from "../lib/types";

const EXTENSAO_VERSAO = chrome.runtime.getManifest().version;

const threadIdEl = document.getElementById("thread-id")!;
const conversaEl = document.getElementById("conversa")!;
const bannerVersaoEl = document.getElementById("banner-versao")!;
const bannerSeletoresEl = document.getElementById("banner-seletores")!;
const bannerInativoEl = document.getElementById("banner-inativo")!;

function renderConversa(conversa: ConversaExtraida) {
  bannerInativoEl.hidden = true;
  bannerSeletoresEl.hidden = true;
  threadIdEl.textContent = `Conversa #${conversa.threadId}`;
  conversaEl.innerHTML = "";
  for (const msg of conversa.mensagens) {
    const div = document.createElement("div");
    div.className = `msg msg-${msg.autor}`;
    const texto = document.createElement("span");
    texto.textContent = msg.texto;
    div.appendChild(texto);
    if (msg.hora) {
      const hora = document.createElement("span");
      hora.className = "msg-hora";
      hora.textContent = msg.hora;
      div.appendChild(hora);
    }
    conversaEl.appendChild(div);
  }
}

function renderSeletoresNaoCalibrados(threadId: string) {
  threadIdEl.textContent = `Conversa #${threadId}`;
  bannerInativoEl.hidden = true;
  bannerSeletoresEl.hidden = false;
  conversaEl.innerHTML = "";
}

chrome.runtime.onMessage.addListener((msg: MensagemRuntime) => {
  if (msg.tipo === "conversa-atualizada") renderConversa(msg.conversa);
  if (msg.tipo === "seletores-nao-calibrados") renderSeletoresNaoCalibrados(msg.threadId);
});

async function checarVersao() {
  try {
    const config = await getConfigCached();
    if (versaoMenorQue(EXTENSAO_VERSAO, config.versao_minima)) {
      bannerVersaoEl.hidden = false;
      bannerVersaoEl.textContent = `Esta versão (${EXTENSAO_VERSAO}) está desatualizada — mínima exigida é ${config.versao_minima}. Baixe a versão mais recente com o admin.`;
    }
  } catch (err) {
    console.error("Falha ao checar versão:", err);
  }
}

checarVersao();

// Pede ao content script da aba ativa que reenvie o estado atual, para o
// painel não ficar em branco se for aberto depois da conversa já carregada.
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (tab?.id) {
    chrome.tabs
      .sendMessage(tab.id, { tipo: "pedir-estado", threadId: "" } satisfies MensagemRuntime)
      .catch(() => {
        // Aba não é do HubSpot ou content script ainda não carregou — sem problema.
      });
  }
});
