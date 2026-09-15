// Edge Function `convenio` (pedido do Raphael, 2026-09-15): dado a empresa
// já associada ao contato no HubSpot, devolve o % de desconto de convênio
// pra mostrar no cabeçalho do side panel. Não usa LLM — chama a função SQL
// `buscar_convenio_empresa`, que faz parsing determinístico do texto já
// ingerido da planilha de convênios (nunca inventa/estima o percentual).
// Sem match: `encontrado: false`, o painel mostra "sem convênio localizado"
// em vez de qualquer suposição.
import { createServiceClient } from "../_shared/db.ts";
import { jsonComCors, respondCorsPreflight } from "../_shared/cors.ts";

interface ConvenioRow {
  empresa: string;
  dominio: string | null;
  nivel: string | null;
  desconto_pct: number;
  valido_ate: string | null;
  status: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return respondCorsPreflight();
  if (req.method !== "GET") return jsonComCors({ error: "use GET" }, { status: 405 });

  const empresa = new URL(req.url).searchParams.get("empresa")?.trim();
  if (!empresa) return jsonComCors({ error: "parâmetro ?empresa= é obrigatório" }, { status: 400 });

  const db = createServiceClient();
  const { data, error } = await db.rpc("buscar_convenio_empresa", { p_empresa: empresa });
  if (error) return jsonComCors({ error: error.message }, { status: 500 });

  const row = (data as ConvenioRow[] | null)?.[0];
  if (!row) return jsonComCors({ encontrado: false });

  return jsonComCors({
    encontrado: true,
    empresa_convenio: row.empresa,
    desconto_pct: row.desconto_pct,
    nivel: row.nivel,
    valido_ate: row.valido_ate,
    status: row.status,
  });
});
