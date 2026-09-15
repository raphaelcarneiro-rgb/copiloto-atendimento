// Extração pura da conversa a partir do DOM. Não depende de nenhuma API do
// Chrome — só de `SeletoresMensagens` (vindos de /config) e de um Element.
// Isso permite testar a lógica de parsing contra uma fixture HTML sem
// precisar simular o runtime da extensão.
import type { Autor, MensagemExtraida, SeletoresMensagens } from "../lib/types";

export function extrairConversa(
  container: ParentNode,
  seletores: SeletoresMensagens,
): MensagemExtraida[] {
  const bolhas = container.querySelectorAll(seletores.mensagem);
  const mensagens: MensagemExtraida[] = [];

  for (const bolha of Array.from(bolhas)) {
    const textoEl = bolha.querySelector(seletores.mensagem_texto);
    const texto = textoEl?.textContent?.trim();
    if (!texto) continue;

    // O marcador de "é do lead" pode estar na própria bolha (ex.: classe
    // `.from-visitor` na div da mensagem) ou num elemento dentro dela —
    // por isso checa os dois, não só descendentes via querySelector.
    const bolhaEl = bolha as Element;
    const ehLead =
      typeof bolhaEl.matches === "function" && bolhaEl.matches(seletores.mensagem_autor_lead)
        ? true
        : bolha.querySelector(seletores.mensagem_autor_lead) !== null;
    const autor: Autor = ehLead ? "lead" : "atendente";

    let hora: string | null = null;
    if (seletores.mensagem_hora) {
      const horaEl = bolha.querySelector(seletores.mensagem_hora);
      hora = horaEl?.textContent?.trim() ?? horaEl?.getAttribute("datetime") ?? null;
    }

    mensagens.push({ autor, texto, hora });
  }

  return mensagens;
}

/** URL real: app.hubspot.com/live-messages/{portal}/inbox/{threadId} (ver plan.md). */
const THREAD_URL_RE = /\/live-messages\/\d+\/inbox\/(\d+)/;

export function extrairThreadId(url: string): string | null {
  return url.match(THREAD_URL_RE)?.[1] ?? null;
}

/**
 * Empresa já associada ao contato no CRM (painel lateral do HubSpot).
 * `document` inteiro, não o container de mensagens — o painel de contato
 * fica fora dele. Sem seletor calibrado ou sem empresa associada, `null`
 * (não é erro — nem todo contato tem empresa vinculada).
 */
export function extrairEmpresaAssociada(doc: ParentNode, seletorEmpresaAssociada?: string): string | null {
  if (!seletorEmpresaAssociada) return null;
  const el = doc.querySelector(seletorEmpresaAssociada);
  return el?.textContent?.trim() || null;
}
