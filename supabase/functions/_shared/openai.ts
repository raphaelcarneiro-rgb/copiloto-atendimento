// Cliente mínimo da API de embeddings da OpenAI (ver plan.md — Embeddings).

export interface EmbeddingResult {
  embeddings: number[][];
  promptTokens: number;
}

const EMBEDDING_MODEL = "text-embedding-3-small";
const MAX_BATCH = 64;

export async function embedTexts(texts: string[]): Promise<EmbeddingResult> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY não configurada (Secret da Edge Function).");
  }
  if (texts.length === 0) return { embeddings: [], promptTokens: 0 };

  const embeddings: number[][] = [];
  let promptTokens = 0;

  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    const batch = texts.slice(i, i + MAX_BATCH);
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: batch }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI embeddings falhou (${res.status}): ${await res.text()}`);
    }
    const data = await res.json();
    for (const item of data.data) embeddings.push(item.embedding);
    promptTokens += data.usage?.prompt_tokens ?? 0;
  }

  return { embeddings, promptTokens };
}

export { EMBEDDING_MODEL };
