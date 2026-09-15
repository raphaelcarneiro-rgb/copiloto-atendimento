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
    let texto = textoEl?.textContent?.trim();

    // Achado real (2026-09-15): mensagem só com imagem/arquivo (ex.: print
    // de desconto que o atendente manda pro lead) não tem texto nenhum em
    // `mensagem_texto` — antes disso a bolha inteira era descartada e o
    // copiloto "esquecia" que aquela troca aconteceu. Não lemos o conteúdo
    // do anexo (isso exigiria OCR/visão, decisão em aberto), só marcamos
    // que ele existiu, pra não perder a mensagem da conversa.
    if (!texto && seletores.mensagem_anexo) {
      const anexoEl = bolha.querySelector(seletores.mensagem_anexo);
      if (anexoEl) {
        const ehImagem = anexoEl.querySelector('img, [data-test-id="inline-image"]') !== null;
        texto = ehImagem
          ? "[Imagem enviada — conteúdo não lido pelo copiloto]"
          : "[Arquivo enviado — conteúdo não lido pelo copiloto]";
      }
    }

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
 * Extrai o texto de um elemento único do `document` (não do container de
 * mensagens) a partir de um seletor opcional vindo de `/config`. Usado para
 * os dados do painel de contato do HubSpot (empresa, nome, estado) que só
 * servem pra exibição no cabeçalho do side panel — nunca chegam a fazer
 * parte da conversa mascarada. Sem seletor calibrado ou elemento ausente
 * (contato sem esse dado), `null` — nunca é erro.
 */
function extrairTextoDoPainel(doc: ParentNode, seletor?: string): string | null {
  if (!seletor) return null;
  const el = doc.querySelector(seletor);
  return el?.textContent?.trim() || null;
}

/** Empresa já associada ao contato no CRM (painel lateral do HubSpot). */
export function extrairEmpresaAssociada(doc: ParentNode, seletorEmpresaAssociada?: string): string | null {
  return extrairTextoDoPainel(doc, seletorEmpresaAssociada);
}

/** Nome do contato/lead da conversa ativa. */
export function extrairNomeLead(doc: ParentNode, seletorNomeLead?: string): string | null {
  return extrairTextoDoPainel(doc, seletorNomeLead);
}

/** Estado/Região do contato. */
export function extrairEstadoLead(doc: ParentNode, seletorEstadoLead?: string): string | null {
  return extrairTextoDoPainel(doc, seletorEstadoLead);
}
