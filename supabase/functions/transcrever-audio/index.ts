// Edge Function `transcrever-audio` (pedido do Raphael, 2026-09-15): notas
// de voz do WhatsApp (via HubSpot) hoje só viram um marcador "[Áudio
// enviado]" na conversa extraída — essa função transcreve de verdade com
// gpt-4o-mini-transcribe (confirmado com o Raphael: mais barato entre os
// modelos não-realtime, ~US$0,003/min).
//
// O backend não consegue baixar o áudio sozinho — a URL do arquivo no
// HubSpot exige a sessão logada do navegador. Por isso o content script
// baixa o áudio (fetch com credentials) e manda os bytes em base64 aqui.
import { createServiceClient, getConfig, logUsage } from "../_shared/db.ts";
import { jsonComCors, respondCorsPreflight } from "../_shared/cors.ts";
import { resolverChamador } from "../_shared/auth_context.ts";
import { transcreverAudio } from "../_shared/openai.ts";
import { maskPII } from "../_shared/pii.ts";

interface ModelosConfig {
  transcricao?: string;
  [k: string]: unknown;
}

interface RequestBody {
  audio_base64?: string;
  mime_type?: string;
  /** Duração em segundos, opcional — usado só se a API não devolver `usage` por token. */
  duracao_seg?: number;
  thread_hash?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return respondCorsPreflight();
  if (req.method !== "POST") return jsonComCors({ error: "use POST" }, { status: 405 });

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonComCors({ error: "JSON inválido" }, { status: 400 });
  }
  if (!body.audio_base64 || !body.mime_type) {
    return jsonComCors({ error: "audio_base64 e mime_type são obrigatórios" }, { status: 400 });
  }

  const db = createServiceClient();
  const chamador = await resolverChamador(db, req); // soft, mesmo padrão de ask/suggest — não exige login

  const modelos = (await getConfig(db, "modelos")) as ModelosConfig;
  const modelo = modelos.transcricao ?? "gpt-4o-mini-transcribe";

  let audioBytes: Uint8Array;
  try {
    audioBytes = Uint8Array.from(atob(body.audio_base64), (c) => c.charCodeAt(0));
  } catch {
    return jsonComCors({ error: "audio_base64 inválido" }, { status: 400 });
  }

  let resultado;
  try {
    resultado = await transcreverAudio({ audioBytes, mimeType: body.mime_type, modelo });
  } catch (err) {
    console.error("transcreverAudio falhou:", err);
    return jsonComCors({ error: "falha ao transcrever áudio" }, { status: 502 });
  }

  const texto = maskPII(resultado.texto); // RF04, defesa em profundidade (a extensão já mascara também)

  // Custo: se a API devolveu tokens de verdade, o trigger do banco calcula
  // pelo preço por token (mesmo caminho de suggest/ask). Sem isso, estima
  // pela duração informada pelo cliente.
  let custoUsdOverride: number | null = null;
  if (resultado.tokensEntrada === 0 && resultado.tokensSaida === 0 && body.duracao_seg) {
    const { data: preco } = await db
      .from("precos_modelo")
      .select("usd_por_minuto")
      .eq("modelo", modelo)
      .lte("vigente_desde", new Date().toISOString().slice(0, 10))
      .order("vigente_desde", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (preco?.usd_por_minuto) {
      custoUsdOverride = (body.duracao_seg / 60) * Number(preco.usd_por_minuto);
    }
  }

  await logUsage(db, {
    tipoChamada: "transcricao",
    modelo,
    tokensEntrada: resultado.tokensEntrada,
    tokensSaida: resultado.tokensSaida,
    threadHash: body.thread_hash ?? null,
    userId: chamador?.userId ?? null,
    custoUsdOverride,
  });

  return jsonComCors({ texto });
});
