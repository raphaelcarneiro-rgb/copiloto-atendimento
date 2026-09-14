// Edge Function `feedback` (Etapa 7 — US5).
// Anexa o feedback do atendente (aceitou/copiou a sugestão, thumbs up/down)
// a uma chamada já registrada em `usage_logs`. Não cria linha nova — só
// atualiza a que `ask`/`suggest` devolveu como `usage_log_id`.
//
// POST { usage_log_id: number, aceita?: boolean, feedback?: "positivo"|"negativo", feedback_motivo?: string }

import { createServiceClient } from "../_shared/db.ts";
import { jsonComCors, respondCorsPreflight } from "../_shared/cors.ts";

interface FeedbackBody {
  usage_log_id?: number;
  aceita?: boolean;
  feedback?: "positivo" | "negativo";
  feedback_motivo?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return respondCorsPreflight();
  if (req.method !== "POST") {
    return jsonComCors({ error: "use POST" }, { status: 405 });
  }

  let body: FeedbackBody;
  try {
    body = await req.json();
  } catch {
    return jsonComCors({ error: "corpo JSON inválido" }, { status: 400 });
  }

  if (!body.usage_log_id) {
    return jsonComCors({ error: "campo 'usage_log_id' é obrigatório" }, { status: 400 });
  }
  if (body.feedback && !["positivo", "negativo"].includes(body.feedback)) {
    return jsonComCors({ error: "'feedback' deve ser 'positivo' ou 'negativo'" }, { status: 400 });
  }

  const atualizacao: Record<string, unknown> = {};
  if (body.aceita !== undefined) atualizacao.aceita = body.aceita;
  if (body.feedback !== undefined) atualizacao.feedback = body.feedback;
  if (body.feedback_motivo !== undefined) atualizacao.feedback_motivo = body.feedback_motivo;

  if (Object.keys(atualizacao).length === 0) {
    return jsonComCors({ error: "nada para atualizar (aceita/feedback/feedback_motivo)" }, { status: 400 });
  }

  const db = createServiceClient();

  try {
    const { error } = await db.from("usage_logs").update(atualizacao).eq("id", body.usage_log_id);
    if (error) throw new Error(error.message);
    return jsonComCors({ ok: true });
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : String(err);
    return jsonComCors({ error: mensagem }, { status: 500 });
  }
});
