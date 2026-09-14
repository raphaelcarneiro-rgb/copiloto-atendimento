// Extração de texto de PDF (fontes tipo='pdf' com ref="storage:<path>").
// unpdf é uma casca fina sobre o pdf.js pensada para runtimes serverless/edge
// (sem dependências nativas), compatível com o npm: do Deno.
import { extractText, getDocumentProxy } from "npm:unpdf@0.12.1";

export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}
