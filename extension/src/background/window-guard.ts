// Etapa 6 (RF10-RF14): mantém, por conversa ativa, o horário da última
// mensagem do lead e agenda o lembrete de 24h via chrome.alarms +
// chrome.notifications. Roda no service worker (único lugar com
// chrome.alarms/chrome.notifications em MV3).
//
// Limitação conhecida: o HubSpot não expõe um timestamp absoluto fácil de
// parsear por mensagem (o seletor `mensagem_hora` é só o texto exibido, ex.
// "14:32", sem data). Por isso "ultimaMsgLeadEm" é o instante em que a
// extensão OBSERVOU a mensagem do lead pela primeira vez, não
// necessariamente o instante exato em que o WhatsApp a recebeu. Se o
// atendente ativar o copiloto bem depois da mensagem ter chegado, o
// lembrete conta a partir da ativação — fica mais permissivo do que
// deveria. Corrigir isso exigiria calibrar o parsing de `mensagem_hora`
// contra o DOM real, o que não foi feito ainda.
import { getConfigCached } from "../lib/config-cache";
import { isBusinessTime, reminderSchedule, type Feriado } from "../lib/business-hours";
import type { Autor, ConfigRemota, ConversaExtraida } from "../lib/types";

const STORAGE_KEY = "janelas_24h";

export interface EstadoJanela {
  threadId: string;
  ultimaMsgLeadTexto: string;
  ultimaMsgLeadEm: number; // epoch ms
  ultimoAutor: Autor;
  dispensadoEm: number | null;
}

type Estados = Record<string, EstadoJanela>;

async function lerEstados(): Promise<Estados> {
  const { [STORAGE_KEY]: estados } = (await chrome.storage.local.get(STORAGE_KEY)) as {
    [STORAGE_KEY]?: Estados;
  };
  return estados ?? {};
}

async function salvarEstados(estados: Estados): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: estados });
}

function nomeAlarme(threadId: string): string {
  return `lembrete-24h:${threadId}`;
}

async function agendarOuDisparar(estado: EstadoJanela, config: ConfigRemota): Promise<void> {
  await chrome.alarms.clear(nomeAlarme(estado.threadId));
  if (estado.dispensadoEm !== null) return;

  const agenda = reminderSchedule(
    new Date(estado.ultimaMsgLeadEm),
    { expediente: config.expediente, lembrete_antecedencia_min: config.lembrete_antecedencia_min },
    config.feriados as Feriado[],
  );
  if (agenda.semJanelaUtil || !agenda.notificarEm) return;

  const quando = agenda.notificarEm.getTime();
  if (quando <= Date.now()) {
    await dispararNotificacao(estado.threadId);
    return;
  }
  chrome.alarms.create(nomeAlarme(estado.threadId), { when: quando });
}

async function dispararNotificacao(threadId: string): Promise<void> {
  chrome.notifications.create(`copiloto-24h:${threadId}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icon128.png"),
    title: "Janela de 24h fechando",
    message: "Uma conversa ativa está perto de fechar a janela de 24h do WhatsApp.",
    priority: 2,
  });
  await atualizarBadge();
}

async function atualizarBadge(): Promise<void> {
  const estados = await lerEstados();
  const config = await getConfigCached();
  let contador = 0;
  for (const estado of Object.values(estados)) {
    if (estado.dispensadoEm !== null) continue;
    const agenda = reminderSchedule(
      new Date(estado.ultimaMsgLeadEm),
      { expediente: config.expediente, lembrete_antecedencia_min: config.lembrete_antecedencia_min },
      config.feriados as Feriado[],
    );
    if (!agenda.semJanelaUtil && agenda.notificarEm && agenda.notificarEm.getTime() <= Date.now()) {
      contador++;
    }
  }
  chrome.action.setBadgeText({ text: contador > 0 ? String(contador) : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#e5484d" });
}

/** RF10/RF14: chamado a cada `conversa-atualizada` recebida de uma conversa ativa. */
export async function processarConversaParaJanela(conversa: ConversaExtraida): Promise<void> {
  if (conversa.mensagens.length === 0) return;
  const ultima = conversa.mensagens[conversa.mensagens.length - 1];
  const estados = await lerEstados();
  const atual = estados[conversa.threadId];

  if (ultima.autor === "lead") {
    if (!atual || atual.ultimaMsgLeadTexto !== ultima.texto) {
      // Mensagem nova do lead (ou primeira observação) — a janela reinicia (RF14).
      estados[conversa.threadId] = {
        threadId: conversa.threadId,
        ultimaMsgLeadTexto: ultima.texto,
        ultimaMsgLeadEm: Date.now(),
        ultimoAutor: "lead",
        dispensadoEm: null,
      };
    } else {
      estados[conversa.threadId] = { ...atual, ultimoAutor: "lead" };
    }
  } else if (atual) {
    estados[conversa.threadId] = { ...atual, ultimoAutor: "atendente" };
  } else {
    // Atendente já respondeu antes de existir qualquer registro de mensagem
    // do lead nesta sessão da extensão — nada para agendar ainda.
    return;
  }

  await salvarEstados(estados);
  const config = await getConfigCached();
  await agendarOuDisparar(estados[conversa.threadId], config);
  await atualizarBadge();
}

/** RF14: dispensar o lembrete (ação do atendente no painel). */
export async function dispensarLembrete(threadId: string): Promise<void> {
  const estados = await lerEstados();
  if (!estados[threadId]) return;
  estados[threadId] = { ...estados[threadId], dispensadoEm: Date.now() };
  await salvarEstados(estados);
  await chrome.alarms.clear(nomeAlarme(threadId));
  await atualizarBadge();
}

/** RF14: some quando a conversa é desativada. */
export async function desativarJanela(threadId: string): Promise<void> {
  const estados = await lerEstados();
  if (estados[threadId]) {
    delete estados[threadId];
    await salvarEstados(estados);
  }
  await chrome.alarms.clear(nomeAlarme(threadId));
  await atualizarBadge();
}

export interface JanelaExpirando {
  threadId: string;
  ultimoAutor: Autor;
  expiraEm: string;
  foraDeExpediente: boolean;
  semJanelaUtil: boolean;
  /** RF11/RF12/RF13: já passou do ponto em que o lembrete deve aparecer no painel. */
  deveExibir: boolean;
  mensagem: string;
}

/**
 * Para o side panel: lista de todas as conversas ativas com lembrete
 * pendente (não dispensado), já com `deveExibir`/`mensagem` calculados
 * (RF11-RF13) — o painel só precisa renderizar, sem reimplementar as regras
 * de expediente.
 */
export async function listarJanelasExpirando(): Promise<JanelaExpirando[]> {
  const estados = await lerEstados();
  const config = await getConfigCached();
  const feriados = config.feriados as Feriado[];
  const agora = new Date();
  const lista: JanelaExpirando[] = [];

  for (const estado of Object.values(estados)) {
    if (estado.dispensadoEm !== null) continue;
    const agenda = reminderSchedule(
      new Date(estado.ultimaMsgLeadEm),
      { expediente: config.expediente, lembrete_antecedencia_min: config.lembrete_antecedencia_min },
      feriados,
    );

    let deveExibir = false;
    let mensagem = "";
    if (agenda.semJanelaUtil) {
      // RF13: só avisa quando o próximo expediente realmente começar.
      deveExibir = isBusinessTime(agora, config.expediente, feriados);
      mensagem = "Essa janela vai expirar sem nenhum horário de expediente no meio — provavelmente vai precisar de um template do WhatsApp.";
    } else if (agenda.notificarEm) {
      deveExibir = agora.getTime() >= agenda.notificarEm.getTime();
      mensagem = agenda.foraDeExpediente
        ? "Expira fora do expediente — considere responder antes do fim do dia."
        : "Janela de 24h perto de fechar.";
    }

    lista.push({
      threadId: estado.threadId,
      ultimoAutor: estado.ultimoAutor,
      expiraEm: agenda.expiraEm.toISOString(),
      foraDeExpediente: agenda.foraDeExpediente,
      semJanelaUtil: agenda.semJanelaUtil,
      deveExibir,
      mensagem,
    });
  }
  return lista.sort((a, b) => a.expiraEm.localeCompare(b.expiraEm));
}

export function registrarListenersJanela(): void {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (!alarm.name.startsWith("lembrete-24h:")) return;
    const threadId = alarm.name.slice("lembrete-24h:".length);
    dispararNotificacao(threadId).catch(console.error);
  });

  chrome.notifications.onClicked.addListener((notificationId) => {
    if (!notificationId.startsWith("copiloto-24h:")) return;
    const threadId = notificationId.slice("copiloto-24h:".length);
    chrome.tabs.query({ url: "https://app.hubspot.com/*" }).then((tabs) => {
      const aba = tabs.find((t) => t.url?.includes(`/inbox/${threadId}`));
      if (aba?.id) chrome.tabs.update(aba.id, { active: true });
    });
  });
}
