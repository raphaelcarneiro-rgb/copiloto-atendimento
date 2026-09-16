// Side panel (etapa 5: conversa extraída; etapa 7: pergunta livre ao
// copiloto — US3). O copiloto nunca envia nada sozinho: só sugere, o
// atendente decide copiar ou inserir (constitution §2).
import { getConfigCached, versaoMenorQue } from "../lib/config-cache";
import { ask, buscarConvenio, enviarFeedback, listarNotificacoes, suggest } from "../lib/api";
import type { AskResponse, SuggestResponse } from "../lib/api";
import { hashThreadId } from "../lib/hash";
import { maskPII } from "../lib/pii";
import { extrairThreadId } from "../content/parse-conversa";
import { listarJanelasExpirando, type JanelaExpirando } from "../background/window-guard";
import { getSessao, login, logout } from "../lib/auth";
import type {
  ConversaExtraida,
  ConvenioInfo,
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
const authAreaEl = document.getElementById("auth-area")!;
const secaoNotificacoesEl = document.getElementById("secao-notificacoes")!;
const notificacoesEl = document.getElementById("notificacoes")!;
const banner24hEl = document.getElementById("banner-24h")!;
const secaoJanelas24hEl = document.getElementById("secao-janelas-24h")!;
const janelas24hEl = document.getElementById("janelas-24h")!;
const cabecalhoLeadEl = document.getElementById("cabecalho-lead")!;
const leadNomeEl = document.getElementById("lead-nome")!;
const leadEmpresaEl = document.getElementById("lead-empresa")!;
const leadEstadoEl = document.getElementById("lead-estado")!;
const leadConvenioEl = document.getElementById("lead-convenio")!;
const leadJanelaEl = document.getElementById("lead-janela")!;
const secaoFollowupEl = document.getElementById("secao-followup")!;
const followupQuandoEl = document.getElementById("followup-quando")!;
const followupAvaliarBtn = document.getElementById("followup-avaliar") as HTMLButtonElement;
const followupStatusEl = document.getElementById("followup-status")!;
const followupResultadoEl = document.getElementById("followup-resultado")!;

let threadIdAtual: string | null = null;
let ultimaEmpresaConvenioConsultada: string | null = null; // evita rebuscar convênio a cada mensagem nova
let ultimaMensagemSugerida: string | null = null; // dedupe: threadId+texto da última msg do lead já processada
let conversaAtual: ConversaExtraida | null = null; // pra "Sugerir follow-up" poder reusar mensagens/empresa sem reextrair

function setItem(el: HTMLElement, texto: string | null) {
  if (!texto) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.textContent = texto;
}

function aplicarConvenio(convenio: ConvenioInfo) {
  cabecalhoLeadEl.hidden = false;
  leadConvenioEl.classList.toggle("cabecalho-convenio-ok", convenio.encontrado);
  leadConvenioEl.classList.toggle("cabecalho-convenio-nao", !convenio.encontrado);
  setItem(
    leadConvenioEl,
    convenio.encontrado ? `Convênio: ${convenio.desconto_pct}% (${convenio.empresa_convenio})` : "Sem convênio localizado",
  );
}

async function renderCabecalhoLead(conversa: ConversaExtraida) {
  setItem(leadNomeEl, conversa.nomeLead);
  setItem(leadEmpresaEl, conversa.empresaAssociada ? `Empresa: ${conversa.empresaAssociada}` : null);
  setItem(leadEstadoEl, conversa.estadoLead ? `Estado: ${conversa.estadoLead}` : null);
  cabecalhoLeadEl.hidden = !(conversa.nomeLead || conversa.empresaAssociada || conversa.estadoLead || !leadJanelaEl.hidden);

  // `contexto-lead` (API do HubSpot, ver hubspot-reader.ts) já resolve o
  // convênio junto — só busca aqui de novo se ele não veio (fallback de
  // DOM, quando a API do HubSpot falhou).
  if (conversa.convenio) {
    ultimaEmpresaConvenioConsultada = conversa.empresaAssociada;
    aplicarConvenio(conversa.convenio);
    return;
  }

  if (!conversa.empresaAssociada) {
    leadConvenioEl.hidden = true;
    ultimaEmpresaConvenioConsultada = null;
    return;
  }
  if (conversa.empresaAssociada === ultimaEmpresaConvenioConsultada) return; // já consultado pra essa empresa
  ultimaEmpresaConvenioConsultada = conversa.empresaAssociada;

  try {
    const convenio = await buscarConvenio(conversa.empresaAssociada);
    if (ultimaEmpresaConvenioConsultada !== conversa.empresaAssociada) return; // conversa trocou enquanto buscava
    aplicarConvenio(convenio);
  } catch (err) {
    console.error("buscarConvenio() falhou:", err);
    leadConvenioEl.hidden = true;
  }
}

function renderConversa(conversa: ConversaExtraida) {
  bannerInativoEl.hidden = true;
  bannerSeletoresEl.hidden = true;
  threadIdEl.textContent = `Conversa #${conversa.threadId}`;
  threadIdAtual = conversa.threadId;
  conversaAtual = conversa;
  renderCabecalhoLead(conversa);
  conversaEl.innerHTML = "";
  for (const msg of conversa.mensagens) {
    const div = document.createElement("div");
    div.className = `msg msg-${msg.autor}`;
    if (msg.viaAudio) {
      const linhaAudio = document.createElement("div");
      linhaAudio.className = "msg-tag-audio-linha";
      const tagAudio = document.createElement("span");
      tagAudio.className = "msg-tag-audio";
      tagAudio.title = "Transcrito de uma nota de voz — pode ter erro de reconhecimento";
      tagAudio.textContent = "🎙️ Áudio";
      linhaAudio.appendChild(tagAudio);
      if (msg.audioUrl) {
        const btnRetranscrever = document.createElement("button");
        btnRetranscrever.type = "button";
        btnRetranscrever.className = "btn-retranscrever";
        btnRetranscrever.textContent = "🔁 Retranscrever";
        btnRetranscrever.title = "Transcrição saiu errada? Manda ouvir de novo.";
        btnRetranscrever.onclick = () => retranscreverAudio(msg.audioUrl!, btnRetranscrever);
        linhaAudio.appendChild(btnRetranscrever);
      }
      div.appendChild(linhaAudio);
    }
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

  atualizarSecaoFollowup(conversa);
  dispararSuggestSeNecessario(conversa);
}

/**
 * Pedido do Raphael, 2026-09-15: transcrição de áudio às vezes sai errada
 * (o modelo não é 100% determinístico) — em vez de re-transcrever sempre
 * (gastando de novo à toa), deixa manual: o atendente pede quando percebe
 * que ficou ruim. O content script invalida o cache dessa nota de voz
 * específica e reprocessa a conversa, que chega de volta via
 * "conversa-atualizada" (mesmo listener de sempre).
 */
async function retranscreverAudio(audioUrl: string, botao: HTMLButtonElement) {
  const tabId = await abaAtivaId();
  if (!tabId) return;
  botao.disabled = true;
  botao.textContent = "Retranscrevendo…";
  try {
    await chrome.tabs.sendMessage(tabId, { tipo: "retranscrever-audio", audioUrl } satisfies MensagemRuntime);
  } catch (err) {
    console.error("retranscrever-audio falhou:", err);
    botao.disabled = false;
    botao.textContent = "🔁 Retranscrever";
  }
}

function renderSeletoresNaoCalibrados(threadId: string) {
  threadIdEl.textContent = `Conversa #${threadId}`;
  threadIdAtual = threadId;
  bannerInativoEl.hidden = true;
  bannerSeletoresEl.hidden = false;
  cabecalhoLeadEl.hidden = true;
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

// --- Login (RF09) ------------------------------------------------------
// Enquanto o provedor Google não estiver configurado no Supabase Auth, a
// extensão continua funcionando sem login (anon key pública) — ver
// docs/setup/04-extensao.md. Fazer login passa a anexar o JWT do usuário
// nas chamadas (api.ts), o que habilita RLS por papel real no backend.

async function renderAuthArea() {
  const sessao = await getSessao();
  authAreaEl.innerHTML = "";
  if (sessao) {
    const email = document.createElement("span");
    email.className = "auth-email";
    email.textContent = sessao.usuario.email;

    // admin/curadoria.html e admin/relatorios.html rodam como arquivo local,
    // sem OAuth próprio — colar esse token ali é o jeito de elas mandarem um
    // usuário real (curador/admin) em vez da anon key pública. Fica como
    // ícone discreto porque só o curador/admin precisa usar isso no dia a dia.
    const btnToken = document.createElement("button");
    btnToken.type = "button";
    btnToken.className = "auth-icon-btn";
    btnToken.title = "Copiar token (pra colar em admin/curadoria.html ou admin/relatorios.html)";
    btnToken.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1"></rect><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path></svg>';
    btnToken.onclick = async () => {
      await navigator.clipboard.writeText(sessao.access_token);
      const original = btnToken.title;
      btnToken.title = "Copiado ✓";
      setTimeout(() => (btnToken.title = original), 2000);
    };

    const btnSair = document.createElement("button");
    btnSair.type = "button";
    btnSair.className = "auth-icon-btn";
    btnSair.title = "Sair";
    btnSair.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>';
    btnSair.onclick = async () => {
      await logout();
      renderAuthArea();
    };
    authAreaEl.append(email, btnToken, btnSair);
  } else {
    const btnEntrar = document.createElement("button");
    btnEntrar.type = "button";
    btnEntrar.textContent = "Entrar com Google";
    btnEntrar.onclick = async () => {
      btnEntrar.disabled = true;
      btnEntrar.textContent = "Entrando…";
      try {
        await login();
        renderAuthArea();
      } catch (err) {
        btnEntrar.disabled = false;
        btnEntrar.textContent = "Entrar com Google";
        console.error("login() falhou:", err);
        alert(`Não consegui entrar: ${err instanceof Error ? err.message : err}`);
      }
    };
    authAreaEl.append(btnEntrar);
  }
}

renderAuthArea();

// --- Notificações de FAQ aprovada (RF20) --------------------------------
// Só faz sentido logado (a Edge Function precisa saber quem é "você" pra
// filtrar as lacunas que VOCÊ perguntou). "Vistas" fica local — mais
// simples que sincronizar timestamp de leitura com o servidor.
const NOTIFICACOES_VISTAS_KEY = "notificacoes_vistas";

async function marcarComoVista(gapId: string) {
  const { [NOTIFICACOES_VISTAS_KEY]: vistas } = (await chrome.storage.local.get(NOTIFICACOES_VISTAS_KEY)) as {
    [NOTIFICACOES_VISTAS_KEY]?: string[];
  };
  await chrome.storage.local.set({ [NOTIFICACOES_VISTAS_KEY]: [...(vistas ?? []), gapId] });
}

async function atualizarNotificacoes() {
  const sessao = await getSessao();
  if (!sessao) {
    secaoNotificacoesEl.hidden = true;
    return;
  }

  let lista;
  try {
    lista = await listarNotificacoes();
  } catch (err) {
    console.error("listarNotificacoes() falhou:", err);
    return;
  }

  const { [NOTIFICACOES_VISTAS_KEY]: vistas } = (await chrome.storage.local.get(NOTIFICACOES_VISTAS_KEY)) as {
    [NOTIFICACOES_VISTAS_KEY]?: string[];
  };
  const vistasSet = new Set(vistas ?? []);
  const pendentes = lista.filter((n) => !vistasSet.has(n.gap_id));

  if (pendentes.length === 0) {
    secaoNotificacoesEl.hidden = true;
    return;
  }
  secaoNotificacoesEl.hidden = false;
  notificacoesEl.innerHTML = "";
  for (const n of pendentes) {
    const item = document.createElement("div");
    item.className = "notificacao-item";
    const texto = document.createElement("p");
    const forte = document.createElement("strong");
    forte.textContent = "Sua dúvida agora tem resposta: ";
    texto.appendChild(forte);
    texto.appendChild(document.createTextNode(`"${n.pergunta_mascarada}"${n.resposta ? ` — ${n.resposta}` : ""}`));
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Entendi";
    btn.onclick = async () => {
      await marcarComoVista(n.gap_id);
      item.remove();
      if (!notificacoesEl.children.length) secaoNotificacoesEl.hidden = true;
    };
    item.append(texto, btn);
    notificacoesEl.appendChild(item);
  }
}

atualizarNotificacoes();
setInterval(atualizarNotificacoes, 30_000);

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

// --- Lembrete de janela de 24h (etapa 6, RF10-RF14) --------------------

function formatarHorario(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

async function dispensar24h(threadId: string) {
  chrome.runtime.sendMessage({ tipo: "dispensar-lembrete-24h", threadId } satisfies MensagemRuntime);
  await atualizarJanelas24h();
}

/** Chip do cabeçalho: "Encerra em Xh Ymin" — sempre visível, não só perto de fechar (isso é o banner abaixo). */
function formatarContagemRegressiva(janela: JanelaExpirando | undefined): string | null {
  if (!janela) return null;
  if (janela.semJanelaUtil) return "Sem janela útil (24h)";

  const restanteMs = new Date(janela.expiraEm).getTime() - Date.now();
  if (restanteMs <= 0) return "Janela de 24h encerrada";

  const horas = Math.floor(restanteMs / (60 * 60 * 1000));
  const minutos = Math.floor((restanteMs % (60 * 60 * 1000)) / (60 * 1000));
  const tempo = horas > 0 ? `${horas}h${minutos > 0 ? ` ${minutos}min` : ""}` : `${minutos}min`;
  return `Encerra em ${tempo}`;
}

async function atualizarJanelas24h() {
  const lista = await listarJanelasExpirando();
  const visiveis = lista.filter((j) => j.deveExibir);

  // Chip no cabeçalho do side panel (pedido do Raphael, 2026-09-15): tempo
  // até a janela de 24h da conversa aberta fechar, sempre visível — não só
  // quando está perto de fechar (isso é o banner abaixo, com antecedência
  // configurável).
  const janelaDaConversaAtual = threadIdAtual ? lista.find((j) => j.threadId === threadIdAtual) : undefined;
  setItem(leadJanelaEl, formatarContagemRegressiva(janelaDaConversaAtual));
  if (!leadJanelaEl.hidden) cabecalhoLeadEl.hidden = false;

  // Banner específico da conversa aberta agora no painel.
  const daConversaAtual = threadIdAtual ? visiveis.find((j) => j.threadId === threadIdAtual) : undefined;
  if (daConversaAtual) {
    banner24hEl.hidden = false;
    banner24hEl.innerHTML = "";
    const texto = document.createElement("span");
    texto.textContent = `${daConversaAtual.mensagem} (expira ${formatarHorario(daConversaAtual.expiraEm)}, última msg foi do ${daConversaAtual.ultimoAutor === "lead" ? "lead" : "atendente"}). `;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Dispensar";
    btn.onclick = () => dispensar24h(daConversaAtual.threadId);
    banner24hEl.append(texto, btn);
  } else {
    banner24hEl.hidden = true;
  }

  // Lista geral — todas as conversas ativas com lembrete pendente, mesmo as
  // que não são a aba aberta agora (US8: gestão de várias conversas).
  const outras = visiveis;
  if (outras.length === 0) {
    secaoJanelas24hEl.hidden = true;
    return;
  }
  secaoJanelas24hEl.hidden = false;
  janelas24hEl.innerHTML = "";
  for (const j of outras) {
    const item = document.createElement("div");
    item.className = "janela-item";
    const texto = document.createElement("span");
    texto.textContent = `Conversa #${j.threadId} — ${j.mensagem} (expira ${formatarHorario(j.expiraEm)})`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Dispensar";
    btn.onclick = () => dispensar24h(j.threadId);
    item.append(texto, btn);
    janelas24hEl.appendChild(item);
  }
}

atualizarJanelas24h();
setInterval(atualizarJanelas24h, 30_000);

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

const RÓTULOS_ETAPA: Record<string, string> = {
  descoberta: "Descoberta",
  qualificacao_empresa: "Qualificação da empresa",
  apresentacao_curso_preco: "Apresentação do curso e preço",
  tratamento_objecao: "Tratamento de objeção",
  fechamento: "Fechamento",
  follow_up: "Follow-up",
};

function renderSugestoes(resposta: SuggestResponse, resultadoEl: HTMLElement, statusEl: HTMLElement) {
  statusEl.hidden = true;
  resultadoEl.innerHTML = "";

  if (resposta.etapa) {
    const etapaEl = document.createElement("p");
    etapaEl.className = "suggest-etapa";
    etapaEl.textContent = `Etapa do roteiro: ${RÓTULOS_ETAPA[resposta.etapa] ?? resposta.etapa}`;
    resultadoEl.appendChild(etapaEl);
  }

  if (resposta.sugestoes.length === 0) {
    const vazio = document.createElement("p");
    vazio.className = "ask-nao-encontrado";
    vazio.textContent =
      resposta.lacunas.length > 0
        ? "Não encontrei fundamento na base para responder — dúvida registrada para curadoria."
        : "Nada a sugerir para a última mensagem.";
    resultadoEl.appendChild(vazio);
  }

  for (const s of resposta.sugestoes) {
    const bloco = document.createElement("div");
    bloco.className = "ask-resposta";

    const texto = document.createElement("p");
    renderTextoFormatado(texto, s.texto);
    bloco.appendChild(texto);
    bloco.appendChild(criarBadgeConfianca(resposta.confianca));

    const fontesEl = criarBlocoFontes(s.fontes);
    if (fontesEl) bloco.appendChild(fontesEl);

    const { el } = criarCardAcaoResposta(s.texto, resposta.usage_log_id);
    bloco.appendChild(el);
    resultadoEl.appendChild(bloco);
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
      const statusEl2 = document.createElement("span");
      statusEl2.className = "ask-status";
      btn.onclick = () => inserirNaConversa(pergunta, statusEl2, btn);
      box.appendChild(btn);
    }
    resultadoEl.appendChild(box);
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
    const resposta = await suggest(conversa.mensagens, threadHash, conversa.empresaAssociada);
    renderSugestoes(resposta, suggestResultadoEl, suggestStatusEl);
  } catch (err) {
    suggestStatusEl.hidden = false;
    suggestStatusEl.textContent = "Não consegui buscar sugestões agora.";
    console.error("suggest() falhou:", err);
  }
}

// --- Follow-up quando o lead para de responder (pedido do Raphael, 2026-09-15) ---
// Diferente das sugestões automáticas (RF02, reage só a mensagem nova do
// lead), isso é sempre uma ação manual do atendente — não queremos chamar o
// LLM sozinho toda vez que a última mensagem for do atendente (ia disparar
// de novo a cada re-render do MutationObserver, sem nenhuma msg nova).

function descreverQuandoFollowup(janela: JanelaExpirando | undefined): string {
  if (!janela) {
    return "Sem informação da janela de 24h ainda — mande quando fizer sentido pra conversa.";
  }
  if (janela.semJanelaUtil) {
    return "Essa janela de 24h vai fechar sem nenhum horário de expediente no meio — pode mandar agora, mas depois de fechar só vai dar pra reengajar com um template do WhatsApp.";
  }
  const expira = formatarHorario(janela.expiraEm);
  return janela.foraDeExpediente
    ? `Pode mandar agora — a janela de 24h expira ${expira}, fora do seu expediente, então vale a pena não deixar pra depois.`
    : `Pode mandar a qualquer momento até ${expira}, quando a janela de 24h desta conversa fecha.`;
}

async function atualizarSecaoFollowup(conversa: ConversaExtraida) {
  const ultima = conversa.mensagens[conversa.mensagens.length - 1];
  if (!ultima || ultima.autor !== "atendente") {
    secaoFollowupEl.hidden = true;
    followupResultadoEl.innerHTML = "";
    return;
  }
  secaoFollowupEl.hidden = false;
  followupResultadoEl.innerHTML = "";
  followupStatusEl.hidden = true;
  followupAvaliarBtn.disabled = false;
  followupAvaliarBtn.textContent = "Sugerir follow-up";

  try {
    const lista = await listarJanelasExpirando();
    const janela = lista.find((j) => j.threadId === conversa.threadId);
    followupQuandoEl.textContent = descreverQuandoFollowup(janela);
  } catch (err) {
    console.error("listarJanelasExpirando() falhou (follow-up):", err);
    followupQuandoEl.textContent = "";
  }
}

followupAvaliarBtn.addEventListener("click", async () => {
  if (!conversaAtual) return;
  followupAvaliarBtn.disabled = true;
  followupAvaliarBtn.textContent = "Avaliando…";
  followupStatusEl.hidden = false;
  followupStatusEl.textContent = "Buscando sugestões de follow-up…";
  followupResultadoEl.innerHTML = "";

  try {
    const threadHash = await hashThreadId(conversaAtual.threadId);
    const resposta = await suggest(conversaAtual.mensagens, threadHash, conversaAtual.empresaAssociada, "follow_up");
    renderSugestoes(resposta, followupResultadoEl, followupStatusEl);
  } catch (err) {
    followupStatusEl.hidden = false;
    followupStatusEl.textContent = "Não consegui avaliar o follow-up agora.";
    console.error("suggest(follow_up) falhou:", err);
  } finally {
    followupAvaliarBtn.disabled = false;
    followupAvaliarBtn.textContent = "Sugerir follow-up";
  }
});

// --- Pergunte ao copiloto (US3) ---------------------------------------

const RÓTULOS_CONFIANCA: Record<Confianca, string> = {
  alta: "confiança alta",
  media: "confiança média",
  baixa: "confiança baixa",
};

/**
 * Renderiza o texto sugerido (formatado pro WhatsApp, ver
 * supabase/functions/_shared/formatacao.ts) dentro de `container`: `\n`
 * vira quebra de linha visível e `*trecho*` vira negrito — só na PRÉVIA.
 * O texto copiado/inserido no HubSpot continua sendo a string crua (com
 * asteriscos e \n literais), que é o que o WhatsApp precisa pra formatar
 * do lado do lead. Constrói por nós de texto/elementos (nunca innerHTML
 * com o texto do modelo) pra não abrir brecha de injeção.
 */
function renderTextoFormatado(container: HTMLElement, texto: string) {
  const linhas = texto.split("\n");
  linhas.forEach((linha, i) => {
    const partes = linha.split(/(\*[^*]+\*)/g);
    for (const parte of partes) {
      if (parte.startsWith("*") && parte.endsWith("*") && parte.length > 2) {
        const strong = document.createElement("strong");
        strong.textContent = parte.slice(1, -1);
        container.appendChild(strong);
      } else if (parte) {
        container.appendChild(document.createTextNode(parte));
      }
    }
    if (i < linhas.length - 1) container.appendChild(document.createElement("br"));
  });
}

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
  renderTextoFormatado(texto, resposta.resposta);
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
