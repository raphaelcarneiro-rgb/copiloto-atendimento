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
  const { error } = await db.from("usage_logs").insert({
    user_id: null,
    thread_hash: null,
    tipo_chamada: "embedding",
    modelo: params.modelo,
    tokens_entrada: params.tokensEntrada,
    tokens_saida: 0,
    etapa: params.etapa,
  });
  if (error) console.error("Falha ao registrar usage_logs:", error.message);
}
