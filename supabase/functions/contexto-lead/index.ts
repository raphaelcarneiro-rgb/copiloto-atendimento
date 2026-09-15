// Edge Function `contexto-lead` (pedido do Raphael, 2026-09-15): dado o
// threadId da conversa, devolve nome/cargo/estado/empresa do lead direto
// da API do HubSpot (CRM real), não da tela. Corrige um bug real: o texto
// do cabeçalho da conversa às vezes reflete o campo de texto livre "Nome
// da empresa" do Contato, não a Empresa de fato associada via CRM — foi
// visto ao vivo um contato com "Nome da empresa"="Stefanini" mas Empresa
// associada de verdade = "Theós Sistemas" (a que tem convênio).
//
// Já aproveita pra resolver o convênio da empresa encontrada (mesma
// função SQL usada pelo endpoint `convenio`), evitando um round-trip
// extra do side panel.
import { createServiceClient } from "../_shared/db.ts";
import { jsonComCors, respondCorsPreflight } from "../_shared/cors.ts";
import { buscarContextoLead } from "../_shared/hubspot.ts";

interface ConvenioRow {
  empresa: string;
  desconto_pct: number;
  nivel: string | null;
  valido_ate: string | null;
  status: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return respondCorsPreflight();
  if (req.method !== "GET") return jsonComCors({ error: "use GET" }, { status: 405 });

  const threadId = new URL(req.url).searchParams.get("thread_id");
  if (!threadId) return jsonComCors({ error: "thread_id é obrigatório" }, { status: 400 });

  let contexto;
  try {
    contexto = await buscarContextoLead(threadId);
  } catch (err) {
    console.error("buscarContextoLead falhou:", err);
    return jsonComCors({ error: "falha ao consultar a API do HubSpot" }, { status: 502 });
  }

  if (!contexto) return jsonComCors({ encontrado: false });

  const db = createServiceClient();
  let convenio: Record<string, unknown> = { encontrado: false };
  if (contexto.empresa) {
    const { data } = await db.rpc("buscar_convenio_empresa", { p_empresa: contexto.empresa });
    const row = (data as ConvenioRow[] | null)?.[0];
    if (row) {
      convenio = {
        encontrado: true,
        empresa_convenio: row.empresa,
        desconto_pct: row.desconto_pct,
        nivel: row.nivel,
        valido_ate: row.valido_ate,
        status: row.status,
      };
    }
  }

  return jsonComCors({
    encontrado: true,
    nome: contexto.nome,
    cargo: contexto.cargo,
    estado: contexto.estado,
    empresa: contexto.empresa,
    convenio,
  });
});
