// Edge Function `config` (Etapa 5 — RF22 e apoio a RF10-RF14).
// Devolve à extensão só o que ela precisa para funcionar sem embutir nada
// sensível no bundle: seletores DOM do HubSpot (calibráveis sem publicar
// nova versão), expediente, antecedência do lembrete, versão mínima e os
// feriados dos próximos 12 meses.
//
// GET /config

import { createServiceClient, getConfig } from "../_shared/db.ts";

Deno.serve(async (req: Request) => {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "use GET" }), { status: 405 });
  }

  const db = createServiceClient();

  try {
    const [seletoresHubspot, expediente, lembreteAntecedenciaMin, versaoMinima, versaoAtual] =
      await Promise.all([
        getConfig(db, "seletores_hubspot"),
        getConfig(db, "expediente"),
        getConfig(db, "lembrete_antecedencia_min"),
        getConfig(db, "versao_minima"),
        getConfig(db, "versao_atual"),
      ]);

    const hoje = new Date();
    const daqui12meses = new Date(hoje);
    daqui12meses.setFullYear(daqui12meses.getFullYear() + 1);

    const { data: feriados, error: feriadosErr } = await db
      .from("feriados")
      .select("data, nome, tipo, conta_como_folga")
      .gte("data", hoje.toISOString().slice(0, 10))
      .lte("data", daqui12meses.toISOString().slice(0, 10))
      .order("data", { ascending: true });
    if (feriadosErr) throw new Error(`feriados falhou: ${feriadosErr.message}`);

    return new Response(
      JSON.stringify({
        seletores_hubspot: seletoresHubspot,
        expediente,
        lembrete_antecedencia_min: lembreteAntecedenciaMin,
        versao_minima: versaoMinima,
        versao_atual: versaoAtual,
        feriados: feriados ?? [],
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: mensagem }), { status: 500 });
  }
});
