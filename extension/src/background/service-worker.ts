// Service worker (MV3). Etapa 5: só abre o side panel e repassa mensagens
// do content script para ele. O lembrete de janela de 24h (alarms,
// notifications) entra na etapa 6.
import type { MensagemRuntime } from "../lib/types";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});

// Repassa a mensagem do content script (aba do HubSpot) para o side panel,
// que roda num contexto separado e não recebe onMessage do content script
// diretamente.
chrome.runtime.onMessage.addListener((msg: MensagemRuntime, sender) => {
  if (sender.tab) {
    chrome.runtime.sendMessage(msg).catch(() => {
      // Side panel pode estar fechado — sem problema, é só descartar.
    });
  }
});
