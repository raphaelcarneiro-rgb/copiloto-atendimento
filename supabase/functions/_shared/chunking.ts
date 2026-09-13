// Divide texto em blocos de ~800 tokens com 100 de sobreposição (RF conforme
// plan.md, seção "Backend Supabase — Edge Functions"). Contagem de tokens
// real via cl100k_base (mesma codificação usada pelos modelos de embedding),
// conforme o guia de embeddings da OpenAI.
import { encode } from "npm:gpt-tokenizer@2.9.0/cl100k_base";

const TARGET_TOKENS = 800;
const OVERLAP_TOKENS = 100;

/** Separa por parágrafos (linha em branco) ou por "-----" (usado no Manual). */
function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n|\n-{3,}\n/g)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export function chunkText(text: string): string[] {
  const paragraphs = splitIntoParagraphs(text);
  const chunks: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  const flush = () => {
    if (current.length === 0) return;
    chunks.push(current.join("\n\n"));
    // sobreposição: mantém o(s) último(s) parágrafo(s) até ~OVERLAP_TOKENS
    let overlapTokens = 0;
    const kept: string[] = [];
    for (let i = current.length - 1; i >= 0; i--) {
      const t = encode(current[i]).length;
      if (overlapTokens + t > OVERLAP_TOKENS && kept.length > 0) break;
      kept.unshift(current[i]);
      overlapTokens += t;
    }
    current = kept;
    currentTokens = overlapTokens;
  };

  for (const paragraph of paragraphs) {
    const paragraphTokens = encode(paragraph).length;

    if (paragraphTokens > TARGET_TOKENS * 1.5) {
      // parágrafo isolado muito grande: quebra em sentenças
      const sentences = paragraph.split(/(?<=[.!?])\s+/);
      for (const sentence of sentences) {
        const sentenceTokens = encode(sentence).length;
        if (currentTokens + sentenceTokens > TARGET_TOKENS) flush();
        current.push(sentence);
        currentTokens += sentenceTokens;
      }
      continue;
    }

    if (currentTokens + paragraphTokens > TARGET_TOKENS && current.length > 0) {
      flush();
    }
    current.push(paragraph);
    currentTokens += paragraphTokens;
  }
  if (current.length > 0) chunks.push(current.join("\n\n"));

  return chunks.filter((c) => c.trim().length > 0);
}

export function countTokens(text: string): number {
  return encode(text).length;
}
