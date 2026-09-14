// Service worker (MV3). Abre o side panel, repassa mensagens do content
// script pra ele, e mantém o lembrete de janela de 24h (etapa 6, RF10-RF14).
import type { MensagemRuntime } from "../lib/types";
import {
  desativarJanela,
  dispensarLembrete,
  processarConversaParaJanela,
  registrarListenersJanela,
} from "./window-guard";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});

registrarListenersJanela();

chrome.runtime.onMessage.addListener((msg: MensagemRuntime, sender) => {
  // Repassa a mensagem do content script (aba do HubSpot) para o side panel,
  // que roda num contexto separado e não recebe onMessage do content script
  // diretamente.
  if (sender.tab) {
    chrome.runtime.sendMessage(msg).catch(() => {
      // Side panel pode estar fechado — sem problema, é só descartar.
    });
  }

  if (msg.tipo === "conversa-atualizada") {
    processarConversaParaJanela(msg.conversa).catch(console.error);
  } else if (msg.tipo === "ativacao-mudou" && !msg.ativo) {
    desativarJanela(msg.threadId).catch(console.error);
  } else if (msg.tipo === "dispensar-lembrete-24h") {
    dispensarLembrete(msg.threadId).catch(console.error);
  }
});
