// Cliente mínimo da API de embeddings e chat estruturado da OpenAI.

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

// ---------------------------------------------------------------------------
// Transcrição de áudio (nota de voz do WhatsApp — pedido do Raphael, 2026-09-15).
// ---------------------------------------------------------------------------

export interface TranscricaoResult {
  texto: string;
  /** Normalmente vem preenchido — confirmado ao vivo que a API devolve `usage.input_tokens`/`output_tokens` de verdade. Fica 0 só como rede de segurança (algum modelo/resposta futura sem `usage`), e nesse caso o chamador cai no fallback por duração. */
  tokensEntrada: number;
  tokensSaida: number;
}

const EXTENSAO_POR_MIME: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/webm": "webm",
  "audio/mp4": "mp4",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
};

export async function transcreverAudio(params: {
  audioBytes: Uint8Array;
  mimeType: string;
  modelo: string;
}): Promise<TranscricaoResult> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY não configurada (Secret da Edge Function).");
  }

  const extensao = EXTENSAO_POR_MIME[params.mimeType] ?? "ogg";
  const form = new FormData();
  form.append("model", params.modelo);
  form.append("file", new Blob([params.audioBytes], { type: params.mimeType }), `audio.${extensao}`);

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`OpenAI transcrição falhou (${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  if (typeof data.text !== "string") {
    throw new Error("OpenAI transcrição não retornou texto.");
  }

  return {
    texto: data.text,
    tokensEntrada: data.usage?.input_tokens ?? 0,
    tokensSaida: data.usage?.output_tokens ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Chat com saída estruturada (Structured Outputs / json_schema).
// ---------------------------------------------------------------------------

export interface ChatJSONResult<T> {
  content: T;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
}

export async function chatJSON<T>(params: {
  model: string;
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
  temperature?: number;
}): Promise<ChatJSONResult<T>> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY não configurada (Secret da Edge Function).");
  }

  // Alguns modelos (ex.: gpt-5.6-luna) só aceitam a temperatura padrão (1) —
  // omitir o campo quando não pedido explicitamente evita "unsupported_value".
  const body: Record<string, unknown> = {
    model: params.model,
    messages: [
      { role: "system", content: params.system },
      { role: "user", content: params.user },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: params.schemaName, schema: params.schema, strict: true },
    },
  };
  if (params.temperature !== undefined) body.temperature = params.temperature;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`OpenAI chat falhou (${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error("OpenAI chat não retornou conteúdo.");

  let content: T;
  try {
    content = JSON.parse(raw);
  } catch {
    throw new Error(`Resposta da OpenAI não é JSON válido: ${raw.slice(0, 200)}`);
  }

  return {
    content,
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
    cachedTokens: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
  };
}
