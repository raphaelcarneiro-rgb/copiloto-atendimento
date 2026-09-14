// Side panel (etapa 5: conversa extraída; etapa 7: pergunta livre ao
// copiloto — US3). O copiloto nunca envia nada sozinho: só sugere, o
// atendente decide copiar ou inserir (constitution §2).
import { getConfigCached, versaoMenorQue } from "../lib/config-cache";
import { ask, enviarFeedback, suggest } from "../lib/api";
import type { AskResponse, SuggestResponse } from "../lib/api";
import { hashThreadId } from "../lib/hash";
import { maskPII } from "../lib/pii";
import { extrairThreadId } from "../content/parse-conversa";
import type {
  ConversaExtraida,
  InserirTextoRequest,
  InserirTextoResponse,
  MensagemRuntime,
} from "../lib/types";

type Confianca = "alta" | "media" | "baixa";
type Fontes = Array<{ chunk_id: number; trecho: string | null }>;

const EXTENSAO_VERSAO = chrome.runtime.getManifest().version;

const threadIdEl = document.getElementById("thread-id")!;
const conversaEl = document.getElementById("conversa")!;
const bannerVersaoEl = document.getElementById("banner-versao")!;
const bannerSeletoresEl = document.getElementById("banner-seletores")!;
const bannerInativoEl = document.getElementById("banner-inativo")!;
const askHistoricoEl = document.getElementById("ask-historico")!;
const askFormEl = document.getElementById("ask-form") as HTMLFormElement;
const askInputEl = document.getElementById("ask-input") as HTMLTextAreaElement;
const askEnviarEl = document.getElementById("ask-enviar") as HTMLButtonElement;
const suggestStatusEl = document.getElementById("suggest-status")!;
const suggestResultadoEl = document.getElementById("suggest-resultado")!;

let threadIdAtual: string | null = null;
let ultimaMensagemSugerida: string | null = null; // dedupe: threadId+texto da última msg do lead já processada

function renderConversa(conversa: ConversaExtraida) {
  bannerInativoEl.hidden = true;
  bannerSeletoresEl.hidden = true;
  threadIdEl.textContent = `Conversa #${conversa.threadId}`;
  threadIdAtual = conversa.threadId;
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

  dispararSuggestSeNecessario(conversa);
}

function renderSeletoresNaoCalibrados(threadId: string) {
  threadIdEl.textContent = `Conversa #${threadId}`;
  threadIdAtual = threadId;
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

async function abaAtivaId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

// Pede ao content script da aba ativa que reenvie o estado atual, para o
// painel não ficar em branco se for aberto depois da conversa já carregada.
// Também é aqui que descobrimos o threadId quando ainda não veio nenhuma
// mensagem "conversa-atualizada" (ex.: seletores não calibrados, ou
// copiloto desativado — perguntar ao copiloto não depende disso).
(async () => {
  const tabId = await abaAtivaId();
  if (!tabId) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab?.url) {
    const id = extrairThreadId(tab.url);
    if (id) {
      threadIdAtual = id;
      threadIdEl.textContent = `Conversa #${id}`;
    }
  }
  chrome.tabs
    .sendMessage(tabId, { tipo: "pedir-estado", threadId: "" } satisfies MensagemRuntime)
    .catch(() => {
      // Aba não é do HubSpot ou content script ainda não carregou — sem problema.
    });
})();

// --- Sugestões automáticas (US2) ---------------------------------------
// Dispara sozinho quando a última mensagem da conversa extraída é do lead
// (RF02) — o atendente não precisa perguntar nada. Versão v1 sem
// classificação de etapa do playbook (ver comentário no topo de
// supabase/functions/suggest/index.ts).

function criarCardAcaoResposta(
  texto: string,
  usageLogId: number | null,
): { el: HTMLElement; statusEl: HTMLElement } {
  const acoes = document.createElement("div");
  acoes.className = "ask-acoes";

  const statusEl = document.createElement("span");
  statusEl.className = "ask-status";

  const btnCopiar = document.createElement("button");
  btnCopiar.type = "button";
  btnCopiar.textContent = "Copiar";
  btnCopiar.onclick = async () => {
    try {
      await navigator.clipboard.writeText(texto);
      btnCopiar.textContent = "Copiado ✓";
      setTimeout(() => (btnCopiar.textContent = "Copiar"), 2000);
    } catch {
      statusEl.textContent = "Não consegui copiar.";
    }
  };

  const btnInserir = document.createElement("button");
  btnInserir.type = "button";
  btnInserir.textContent = "Inserir na conversa";
  btnInserir.onclick = () => inserirNaConversa(texto, statusEl, btnInserir);

  acoes.append(btnCopiar, btnInserir, statusEl);

  const wrapper = document.createElement("div");
  wrapper.appendChild(acoes);
  wrapper.appendChild(criarBotoesFeedback(usageLogId));
  return { el: wrapper, statusEl };
}

function renderSugestoes(resposta: SuggestResponse) {
  suggestStatusEl.hidden = true;
  suggestResultadoEl.innerHTML = "";

  if (resposta.sugestoes.length === 0) {
    const vazio = document.createElement("p");
    vazio.className = "ask-nao-encontrado";
    vazio.textContent =
      resposta.lacunas.length > 0
        ? "Não encontrei fundamento na base para responder — dúvida registrada para curadoria."
        : "Nada a sugerir para a última mensagem.";
    suggestResultadoEl.appendChild(vazio);
  }

  for (const s of resposta.sugestoes) {
    const bloco = document.createElement("div");
    bloco.className = "ask-resposta";

    const texto = document.createElement("p");
    texto.textContent = s.texto;
    bloco.appendChild(texto);
    bloco.appendChild(criarBadgeConfianca(resposta.confianca));

    const fontesEl = criarBlocoFontes(s.fontes);
    if (fontesEl) bloco.appendChild(fontesEl);

    const { el } = criarCardAcaoResposta(s.texto, resposta.usage_log_id);
    bloco.appendChild(el);
    suggestResultadoEl.appendChild(bloco);
  }

  if (resposta.perguntas_para_lead.length > 0) {
    const box = document.createElement("div");
    box.className = "suggest-perguntas";
    const titulo = document.createElement("p");
    titulo.className = "suggest-perguntas-titulo";
    titulo.textContent = "Perguntas de esclarecimento:";
    box.appendChild(titulo);
    for (const pergunta of resposta.perguntas_para_lead) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = pergunta;
      const statusEl = document.createElement("span");
      statusEl.className = "ask-status";
      btn.onclick = () => inserirNaConversa(pergunta, statusEl, btn);
      box.appendChild(btn);
    }
    suggestResultadoEl.appendChild(box);
  }
}

async function dispararSuggestSeNecessario(conversa: ConversaExtraida) {
  const ultima = conversa.mensagens[conversa.mensagens.length - 1];
  if (!ultima || ultima.autor !== "lead") return; // RF02: só reage a mensagem nova do lead

  const chave = `${conversa.threadId}::${ultima.texto}`;
  if (chave === ultimaMensagemSugerida) return; // já processamos essa mensagem
  ultimaMensagemSugerida = chave;

  suggestStatusEl.hidden = false;
  suggestStatusEl.textContent = "Buscando sugestões…";
  suggestResultadoEl.innerHTML = "";

  try {
    const threadHash = await hashThreadId(conversa.threadId);
    const resposta = await suggest(conversa.mensagens, threadHash);
    renderSugestoes(resposta);
  } catch (err) {
    suggestStatusEl.hidden = false;
    suggestStatusEl.textContent = "Não consegui buscar sugestões agora.";
    console.error("suggest() falhou:", err);
  }
}

// --- Pergunte ao copiloto (US3) ---------------------------------------

const RÓTULOS_CONFIANCA: Record<Confianca, string> = {
  alta: "confiança alta",
  media: "confiança média",
  baixa: "confiança baixa",
};

function criarBadgeConfianca(confianca: Confianca): HTMLElement {
  const span = document.createElement("span");
  span.className = `badge badge-${confianca}`;
  span.textContent = RÓTULOS_CONFIANCA[confianca];
  return span;
}

function criarBlocoFontes(fontes: Fontes): HTMLElement | null {
  if (fontes.length === 0) return null;
  const details = document.createElement("details");
  details.className = "fontes";
  const summary = document.createElement("summary");
  summary.textContent = `${fontes.length} fonte(s)`;
  details.appendChild(summary);
  for (const f of fontes) {
    const p = document.createElement("p");
    p.className = "fonte-trecho";
    p.textContent = f.trecho ?? "(trecho indisponível)";
    details.appendChild(p);
  }
  return details;
}

async function inserirNaConversa(texto: string, statusEl: HTMLElement, botao: HTMLButtonElement) {
  const tabId = await abaAtivaId();
  if (!tabId) {
    statusEl.textContent = "Não encontrei a aba do HubSpot.";
    return;
  }
  try {
    const resposta = (await chrome.tabs.sendMessage(tabId, {
      tipo: "inserir-texto",
      texto,
    } satisfies InserirTextoRequest)) as InserirTextoResponse;
    if (resposta.ok) {
      // Feedback visual no próprio botão, não só num texto pequeno ao lado
      // — achado real testando: passava despercebido que já tinha inserido.
      botao.textContent = "Inserido ✓";
      botao.disabled = true;
      statusEl.textContent = "";
    } else if (resposta.motivo === "composer-nao-calibrado") {
      statusEl.textContent = "Campo de resposta ainda não calibrado — use copiar.";
    } else {
      statusEl.textContent = "Não encontrei o campo de resposta na tela — use copiar.";
    }
  } catch {
    statusEl.textContent = "Não consegui inserir — abra uma conversa do HubSpot e tente de novo.";
  }
}

function criarBotoesFeedback(usageLogId: number | null): HTMLElement {
  const div = document.createElement("div");
  div.className = "feedback";
  if (usageLogId === null) return div; // nada para vincular o feedback

  const positivo = document.createElement("button");
  positivo.type = "button";
  positivo.textContent = "👍";
  const negativo = document.createElement("button");
  negativo.type = "button";
  negativo.textContent = "👎";

  const enviar = async (valor: "positivo" | "negativo") => {
    positivo.disabled = true;
    negativo.disabled = true;
    (valor === "positivo" ? positivo : negativo).classList.add("feedback-selecionado");
    try {
      await enviarFeedback({ usageLogId, feedback: valor, aceita: valor === "positivo" });
    } catch (err) {
      console.error("Falha ao enviar feedback:", err);
    }
  };

  positivo.onclick = () => enviar("positivo");
  negativo.onclick = () => enviar("negativo");
  div.append(positivo, negativo);
  return div;
}

function renderRespostaAsk(resposta: AskResponse) {
  const bloco = document.createElement("div");
  bloco.className = "ask-resposta";

  const texto = document.createElement("p");
  texto.textContent = resposta.resposta;
  bloco.appendChild(texto);

  bloco.appendChild(criarBadgeConfianca(resposta.confianca));

  const fontesEl = criarBlocoFontes(resposta.fontes);
  if (fontesEl) bloco.appendChild(fontesEl);

  if (!resposta.encontrado) {
    // Sem fonte, sem copiar/inserir: o texto aqui é só o aviso padrão de
    // "não sei" (constitution §1) — deixar copiar/inserir sugeria que essa
    // frase de fallback era uma resposta pronta para mandar ao lead, o que
    // não é a intenção (achado real testando com o Raphael).
    const aviso = document.createElement("p");
    aviso.className = "ask-nao-encontrado";
    aviso.textContent = "Não encontrado na base — a dúvida foi registrada para curadoria.";
    bloco.appendChild(aviso);
    bloco.appendChild(criarBotoesFeedback(resposta.usage_log_id));
    askHistoricoEl.appendChild(bloco);
    askHistoricoEl.scrollTop = askHistoricoEl.scrollHeight;
    return;
  }

  const acoes = document.createElement("div");
  acoes.className = "ask-acoes";

  const statusEl = document.createElement("span");
  statusEl.className = "ask-status";

  const btnCopiar = document.createElement("button");
  btnCopiar.type = "button";
  btnCopiar.textContent = "Copiar";
  btnCopiar.onclick = async () => {
    try {
      await navigator.clipboard.writeText(resposta.resposta);
      btnCopiar.textContent = "Copiado ✓";
      setTimeout(() => (btnCopiar.textContent = "Copiar"), 2000);
    } catch {
      statusEl.textContent = "Não consegui copiar.";
    }
  };

  const btnInserir = document.createElement("button");
  btnInserir.type = "button";
  btnInserir.textContent = "Inserir na conversa";
  btnInserir.onclick = () => inserirNaConversa(resposta.resposta, statusEl, btnInserir);

  acoes.append(btnCopiar, btnInserir, statusEl);
  bloco.appendChild(acoes);
  bloco.appendChild(criarBotoesFeedback(resposta.usage_log_id));

  askHistoricoEl.appendChild(bloco);
  askHistoricoEl.scrollTop = askHistoricoEl.scrollHeight;
}

askFormEl.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const perguntaOriginal = askInputEl.value.trim();
  if (!perguntaOriginal) return;

  // Mascara no cliente antes de sair do navegador (RF04, defesa em
  // profundidade — o backend também mascara).
  const pergunta = maskPII(perguntaOriginal);

  const perguntaEl = document.createElement("p");
  perguntaEl.className = "ask-pergunta";
  perguntaEl.textContent = pergunta;
  askHistoricoEl.appendChild(perguntaEl);

  askInputEl.value = "";
  askInputEl.disabled = true;
  askEnviarEl.disabled = true;

  try {
    const threadHash = threadIdAtual ? await hashThreadId(threadIdAtual) : undefined;
    const resposta = await ask(pergunta, threadHash);
    renderRespostaAsk(resposta);
  } catch (err) {
    const erroEl = document.createElement("p");
    erroEl.className = "ask-erro";
    erroEl.textContent = "Não consegui buscar uma resposta agora. Tente de novo em instantes.";
    askHistoricoEl.appendChild(erroEl);
    console.error("ask() falhou:", err);
  } finally {
    askInputEl.disabled = false;
    askEnviarEl.disabled = false;
    askInputEl.focus();
  }
});
