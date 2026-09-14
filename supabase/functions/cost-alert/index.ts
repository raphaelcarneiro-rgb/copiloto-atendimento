// Edge Function `cost-alert` (Etapa 9 — RF21). Roda via pg_cron a cada
// hora. Olha `vw_custo_mensal` (já calcula % do teto e projeção — criada
// na fundação) para o mês corrente e, se cruzar 80% ou 100% do teto
// (config.alertas_custo) pela primeira vez naquele mês, avisa o gestor por
// e-mail e grava em `cost_alerts` pra nunca mandar o mesmo alerta duas
// vezes no mesmo mês.
//
// Envio de e-mail via Resend (precisa da secret RESEND_API_KEY, que este
// projeto ainda NÃO tem configurada até onde eu sei — não posso confirmar
// nem fabricar isso). Sem a secret, a função ainda registra o alerta em
// `cost_alerts` (pra não perder o gatilho) mas não envia e-mail nenhum —
// só loga um aviso. Isso precisa ser resolvido com uma chave de API real.

import { createServiceClient, getConfig } from "../_shared/db.ts";
import { jsonComCors, respondCorsPreflight } from "../_shared/cors.ts";

type Db = ReturnType<typeof createServiceClient>;

interface CustoMensalRow {
  mes: string;
  conversas: number;
  chamadas: number;
  custo_brl: number;
  custo_medio_conversa_brl: number | null;
  teto_brl: number;
  pct_teto: number | null;
  projecao_mes_brl: number;
}

async function enviarEmail(destinatario: string, assunto: string, corpo: string): Promise<{ enviado: boolean; motivo?: string }> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.warn("cost-alert: RESEND_API_KEY ausente — alerta registrado mas e-mail NÃO enviado.");
    return { enviado: false, motivo: "RESEND_API_KEY não configurada (Secret da Edge Function)" };
  }
  const remetente = Deno.env.get("RESEND_FROM") ?? "onboarding@resend.dev";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: remetente, to: [destinatario], subject: assunto, text: corpo }),
  });
  if (!res.ok) {
    const texto = await res.text();
    console.error(`cost-alert: envio de e-mail falhou (${res.status}): ${texto}`);
    return { enviado: false, motivo: `Resend respondeu ${res.status}` };
  }
  return { enviado: true };
}

async function verificarCusto(db: Db): Promise<Response> {
  const [emailGestor, alertasCusto] = await Promise.all([
    getConfig(db, "email_gestor") as Promise<string>,
    getConfig(db, "alertas_custo") as Promise<number[]>, // ex.: [0.8, 1]
  ]);

  const mesAtual = new Date().toISOString().slice(0, 7) + "-01"; // "YYYY-MM-01"
  const { data: linha, error } = await db
    .from("vw_custo_mensal")
    .select("*")
    .eq("mes", mesAtual)
    .maybeSingle();
  if (error) return jsonComCors({ error: error.message }, { status: 500 });
  if (!linha) return jsonComCors({ ok: true, mensagem: "sem uso registrado neste mês ainda" });

  const custo = linha as CustoMensalRow;
  const fracaoAtual = custo.teto_brl > 0 ? custo.custo_brl / custo.teto_brl : 0;

  const resultados: Array<{ limiar: number; disparado: boolean; email?: { enviado: boolean; motivo?: string } }> = [];

  for (const limiar of alertasCusto) {
    if (fracaoAtual < limiar) {
      resultados.push({ limiar, disparado: false });
      continue;
    }
    const { data: jaEnviado } = await db
      .from("cost_alerts")
      .select("mes")
      .eq("mes", mesAtual)
      .eq("limiar", limiar)
      .maybeSingle();
    if (jaEnviado) {
      resultados.push({ limiar, disparado: false }); // já avisado neste mês, não repete
      continue;
    }

    const percentualTexto = `${Math.round(limiar * 100)}%`;
    const assunto = `[Copiloto Infnet] Custo de IA atingiu ${percentualTexto} do teto mensal`;
    const corpo = [
      `O custo de IA do Copiloto de Atendimento atingiu ${percentualTexto} do teto mensal de R$ ${custo.teto_brl.toFixed(2)}.`,
      `Custo até agora: R$ ${custo.custo_brl.toFixed(2)} (${custo.chamadas} chamadas, ${custo.conversas} conversas).`,
      `Projeção para o mês inteiro: R$ ${custo.projecao_mes_brl.toFixed(2)}.`,
    ].join("\n");

    const email = await enviarEmail(emailGestor, assunto, corpo);
    await db.from("cost_alerts").insert({ mes: mesAtual, limiar, custo_brl: custo.custo_brl, enviado_em: new Date().toISOString() });
    resultados.push({ limiar, disparado: true, email });
  }

  return jsonComCors({ ok: true, mes: mesAtual, custo_brl: custo.custo_brl, teto_brl: custo.teto_brl, pct_teto: custo.pct_teto, resultados });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return respondCorsPreflight();
  const db = createServiceClient();
  try {
    return await verificarCusto(db);
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : String(err);
    return jsonComCors({ error: mensagem }, { status: 500 });
  }
});
