// Edge Function `notificacoes` (RF20 — "sua dúvida agora tem resposta").
// GET, autenticado: devolve as lacunas que o usuário logado perguntou
// (registradas em `knowledge_gaps.usuarios_ids` por `ask`/`suggest` quando
// há login) e que já foram aprovadas como FAQ, com a resposta.
//
// Sem paginação/estado de "já visto" no servidor — o side panel guarda em
// chrome.storage.local o horário da última checagem e manda em
// ?desde=<ISO>; a Edge Function só filtra por `resolvido_em`. Simples e
// evita mais uma tabela só pra marcar leitura.
//
// Requer login (RF09): sem usuário real não tem como saber quais lacunas
// são "suas", então essa função não tem fallback pra anon key.
import { createServiceClient } from "../_shared/db.ts";
import { jsonComCors, respondCorsPreflight } from "../_shared/cors.ts";
import { resolverChamador } from "../_shared/auth_context.ts";

interface GapAprovada {
  id: string;
  pergunta_mascarada: string;
  resolvido_em: string | null;
}

interface FaqRow {
  gap_id: string;
  pergunta: string;
  resposta: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return respondCorsPreflight();
  if (req.method !== "GET") return jsonComCors({ error: "use GET" }, { status: 405 });

  const db = createServiceClient();
  const chamador = await resolverChamador(db, req);
  if (!chamador) {
    return jsonComCors({ error: "é preciso estar logado pra ver notificações (RF09)" }, { status: 401 });
  }

  const desde = new URL(req.url).searchParams.get("desde");

  let query = db
    .from("knowledge_gaps")
    .select("id, pergunta_mascarada, resolvido_em")
    .eq("status", "aprovada")
    .contains("usuarios_ids", [chamador.userId])
    .order("resolvido_em", { ascending: false })
    .limit(20);
  if (desde) query = query.gt("resolvido_em", desde);

  const { data: gapsData, error: gapsErr } = await query;
  if (gapsErr) return jsonComCors({ error: gapsErr.message }, { status: 500 });

  const gaps = (gapsData ?? []) as GapAprovada[];
  if (gaps.length === 0) return jsonComCors({ notificacoes: [] });

  const { data: faqsData, error: faqErr } = await db
    .from("faq_curada")
    .select("gap_id, pergunta, resposta")
    .in(
      "gap_id",
      gaps.map((g) => g.id),
    );
  if (faqErr) return jsonComCors({ error: faqErr.message }, { status: 500 });

  const faqPorGap = new Map((faqsData as FaqRow[] | null)?.map((f) => [f.gap_id, f]) ?? []);

  const notificacoes = gaps.map((g) => ({
    gap_id: g.id,
    pergunta_mascarada: g.pergunta_mascarada,
    resolvido_em: g.resolvido_em,
    resposta: faqPorGap.get(g.id)?.resposta ?? null,
  }));

  return jsonComCors({ notificacoes });
});
