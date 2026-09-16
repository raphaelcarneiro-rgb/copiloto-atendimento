// Baixa o áudio de uma nota de voz do HubSpot com a sessão logada do
// atendente (`credentials: "include"`) e converte pra base64, formato
// aceito pela Edge Function `transcrever-audio` — o backend não tem como
// baixar essa URL sozinho (exige o login do atendente no HubSpot).
//
// Roda no service worker (background/service-worker.ts), não no content
// script: a URL do arquivo normalmente é de um subdomínio diferente do
// HubSpot (ex.: api-na1.hubspot.com vs. app.hubspot.com de onde o content
// script roda) — um fetch cross-origin do content script cairia no CORS da
// página. Um fetch do service worker, com `host_permissions` cobrindo esse
// domínio, contorna isso (é tratado como requisição da extensão, não da
// página). Por isso esta função evita APIs de DOM (sem `FileReader`/`Audio`,
// que não existem no service worker).
export interface AudioBaixado {
  base64: string;
  mimeType: string;
}

export async function baixarAudioComoBase64(url: string): Promise<AudioBaixado | null> {
  try {
    const res = await fetch(url, { credentials: "include" });
    // Log mantido de propósito (não é temporário): foi o que permitiu
    // diagnosticar, em 2026-09-15, um bug real de CORS num domínio de
    // redirecionamento fora de `host_permissions` (a URL é um
    // "signed-url-redirect" do HubSpot que redireciona pra um domínio de
    // CDN diferente) — corrigido, mas o log continua útil pra qualquer
    // problema parecido no futuro (ex.: HubSpot trocar de domínio de novo).
    console.log("[copiloto] baixarAudioComoBase64:", url, "→ status", res.status, "url final", res.url);
    if (!res.ok) {
      console.error("[copiloto] download de áudio falhou com status", res.status, await res.text().catch(() => "(sem corpo)"));
      return null;
    }
    const buffer = await res.arrayBuffer();
    const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() || "audio/ogg";
    console.log("[copiloto] áudio baixado com sucesso:", buffer.byteLength, "bytes,", mimeType);
    return { base64: arrayBufferParaBase64(buffer), mimeType };
  } catch (err) {
    console.error("[copiloto] baixarAudioComoBase64 lançou uma exceção (provável CORS/rede):", err);
    return null;
  }
}

function arrayBufferParaBase64(buffer: ArrayBuffer): string {
  let binario = "";
  const bytes = new Uint8Array(buffer);
  const TAMANHO_BLOCO = 0x8000; // evita estourar o limite de argumentos de String.fromCharCode em áudios grandes
  for (let i = 0; i < bytes.length; i += TAMANHO_BLOCO) {
    binario += String.fromCharCode(...bytes.subarray(i, i + TAMANHO_BLOCO));
  }
  return btoa(binario);
}
