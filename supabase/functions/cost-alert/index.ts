// Edge Function `cost-alert` (Etapa 9 — RF21). Roda via pg_cron a cada
// hora. Olha `vw_custo_mensal` (já calcula % do teto e projeção — criada
// na fundação) para o mês corrente e, se cruzar 80% ou 100% do teto
// (config.alertas_custo) pela primeira vez naquele mês, avisa o gestor por
// e-mail e grava em `cost_alerts` pra nunca mandar o mesmo alerta duas
// vezes no mesmo mês.
//
// Envio de e-mail via Gmail, reaproveitando a MESMA conta de serviço com
// domain-wide delegation já usada pra ler Google Sheets/Drive (ver
// _shared/google_auth.ts) — impersona GOOGLE_IMPERSONATED_USER e manda o
// e-mail em nome dele via Gmail API. Precisa que um admin do Workspace:
//   1. habilite a Gmail API no mesmo projeto do Google Cloud da conta de
//      serviço já existente;
//   2. adicione o escopo gmail.send à delegação em todo o domínio dessa
//      conta de serviço (Admin Console → Segurança → Controle de dados e
//      acesso → Delegação em todo o domínio, mesmo Client ID já autorizado
//      pra Sheets, só adicionar o escopo).
// Sem isso, a função ainda registra o alerta em `cost_alerts` (não perde o
// gatilho) mas não envia e-mail — só loga o erro do Gmail.

import { createServiceClient, getConfig } from "../_shared/db.ts";
import { getGoogleAccessToken, SCOPE_GMAIL_SEND } from "../_shared/google_auth.ts";
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

function base64UrlEncodeUtf8(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function enviarEmail(destinatario: string, assunto: string, corpo: string): Promise<{ enviado: boolean; motivo?: string }> {
  let token: string;
  try {
    token = await getGoogleAccessToken([SCOPE_GMAIL_SEND]);
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : String(err);
    console.warn(`cost-alert: não consegui obter token do Gmail — alerta registrado mas e-mail NÃO enviado (${mensagem}).`);
    return { enviado: false, motivo: mensagem };
  }

  // Assunto com caracteres não-ASCII precisa de encoded-word (RFC 2047).
  const assuntoCodificado = `=?UTF-8?B?${btoa(unescape(encodeURIComponent(assunto)))}?=`;
  const mime = [
    `To: ${destinatario}`,
    `Subject: ${assuntoCodificado}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    corpo,
  ].join("\r\n");

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: base64UrlEncodeUtf8(mime) }),
  });
  if (!res.ok) {
    const texto = await res.text();
    console.error(`cost-alert: envio de e-mail falhou (${res.status}): ${texto}`);
    return { enviado: false, motivo: `Gmail respondeu ${res.status}: ${texto.slice(0, 200)}` };
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
