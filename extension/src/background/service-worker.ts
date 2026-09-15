// Service worker (MV3). Abre o side panel, repassa mensagens do content
// script pra ele, e mantém o lembrete de janela de 24h (etapa 6, RF10-RF14).
import type { BaixarAudioResponse, MensagemRuntime } from "../lib/types";
import { baixarAudioComoBase64 } from "../lib/audio";
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

chrome.runtime.onMessage.addListener(
  (msg: MensagemRuntime, sender, sendResponse: (resposta: BaixarAudioResponse) => void) => {
    // `baixar-audio` não é repassada ao side panel nem envolve as janelas de
    // 24h — é só o content script pedindo pro service worker baixar o
    // arquivo (precisa rodar aqui: a URL costuma ser de outro subdomínio do
    // HubSpot, e um fetch cross-origin do service worker, com
    // `host_permissions`, não esbarra no CORS da página como o do content
    // script esbarraria — ver lib/audio.ts).
    if (msg.tipo === "baixar-audio") {
      baixarAudioComoBase64(msg.url).then((resultado) => {
        sendResponse(resultado ? { ok: true, ...resultado } : { ok: false });
      });
      return true; // mantém o canal aberto para a resposta assíncrona
    }

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
  },
);
