// Edge Function `relatorios` (Etapa 9 — RF21/US7/US10). As views
// `vw_custo_*`/`vw_lacunas_abertas` já existem desde a fundação com
// `security_invoker = true` (RLS: só admin lê) — a chamada direta via anon
// key é bloqueada de propósito (testado: "permission denied for view
// vw_custo_mensal"). Esta função usa a service role pra ler as views e
// devolver o pacote pro painel de relatórios — mas exige um usuário
// autenticado com papel admin de verdade (RF09, ligado em 2026-09-14),
// verificado via `resolverChamador`, já que a service role bypassa a RLS.
import { createServiceClient } from "../_shared/db.ts";
import { jsonComCors, respondCorsPreflight } from "../_shared/cors.ts";
import { resolverChamador } from "../_shared/auth_context.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return respondCorsPreflight();
  if (req.method !== "GET") return jsonComCors({ error: "use GET" }, { status: 405 });

  const db = createServiceClient();
  const chamador = await resolverChamador(db, req);
  if (!chamador || chamador.papel !== "admin") {
    return jsonComCors({ error: "acesso restrito a admin — faça login (RF09)" }, { status: 403 });
  }

  const [mensal, diario, porAtendente, lacunas] = await Promise.all([
    db.from("vw_custo_mensal").select("*").order("mes", { ascending: false }).limit(6),
    db.from("vw_custo_diario").select("*").order("dia", { ascending: false }).limit(30),
    db.from("vw_custo_por_atendente").select("*"),
    db.from("vw_lacunas_abertas").select("*"),
  ]);

  const erro = mensal.error ?? diario.error ?? porAtendente.error ?? lacunas.error;
  if (erro) return jsonComCors({ error: erro.message }, { status: 500 });

  return jsonComCors({
    custo_mensal: mensal.data ?? [],
    custo_diario: diario.data ?? [],
    custo_por_atendente: porAtendente.data ?? [],
    lacunas_abertas: lacunas.data ?? [],
  });
});
