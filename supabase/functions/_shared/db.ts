import { createClient } from "npm:@supabase/supabase-js@2.45.4";

/**
 * Cliente com a service role: ignora RLS. Só deve ser usado dentro de Edge
 * Functions, nunca exposto ao navegador.
 */
export function createServiceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes (fornecidas pelo runtime).");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function logEmbeddingUsage(
  db: ReturnType<typeof createServiceClient>,
  params: { modelo: string; tokensEntrada: number; etapa: string },
) {
  return logUsage(db, {
    tipoChamada: "embedding",
    modelo: params.modelo,
    tokensEntrada: params.tokensEntrada,
    tokensSaida: 0,
    etapa: params.etapa,
  });
}

export async function logUsage(
  db: ReturnType<typeof createServiceClient>,
  params: {
    tipoChamada: "classificacao" | "suggest" | "ask" | "embedding" | "ingest";
    modelo: string;
    tokensEntrada: number;
    tokensSaida: number;
    tokensCache?: number;
    threadHash?: string | null;
    userId?: string | null;
    etapa?: string | null;
    aceita?: boolean | null;
  },
) {
  const { error } = await db.from("usage_logs").insert({
    user_id: params.userId ?? null,
    thread_hash: params.threadHash ?? null,
    tipo_chamada: params.tipoChamada,
    modelo: params.modelo,
    tokens_entrada: params.tokensEntrada,
    tokens_saida: params.tokensSaida,
    tokens_cache: params.tokensCache ?? 0,
    etapa: params.etapa ?? null,
    aceita: params.aceita ?? null,
  });
  if (error) console.error("Falha ao registrar usage_logs:", error.message);
}

export async function getConfig(
  db: ReturnType<typeof createServiceClient>,
  chave: string,
): Promise<unknown> {
  const { data, error } = await db.from("config").select("valor").eq("chave", chave).single();
  if (error) throw new Error(`config["${chave}"] não encontrada: ${error.message}`);
  return data.valor;
}
