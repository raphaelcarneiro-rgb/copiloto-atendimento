// RF09: identifica o usuário real por trás de um Bearer token (quando
// existe) e o papel dele em `profiles`. Complementa a RLS que já existe
// desde a fundação (papel_atual/eh_membro/eh_curador/eh_admin) — essas
// Edge Functions usam a service role internamente (bypassa RLS por
// design, igual todas as outras do projeto), então a checagem de papel
// para ações sensíveis (curadoria, relatórios) precisa acontecer aqui,
// explicitamente, e não só confiar na RLS do Postgres.
import type { createServiceClient } from "./db.ts";

type Db = ReturnType<typeof createServiceClient>;

export type Papel = "atendente" | "curador" | "admin";

export interface ContextoChamador {
  userId: string;
  email: string;
  papel: Papel;
}

/**
 * Extrai o Bearer token do request e, se for um JWT de usuário real
 * (não a anon key pública), resolve o perfil dele. Devolve `null` quando
 * não há usuário autenticado (chamada só com a anon key) — chamador
 * decide se isso é permitido ou não para a ação em questão.
 */
export async function resolverChamador(db: Db, req: Request): Promise<ContextoChamador | null> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice("Bearer ".length);

  const { data: userData, error: userErr } = await db.auth.getUser(token);
  if (userErr || !userData?.user) return null; // anon key ou token inválido

  const { data: perfil, error: perfilErr } = await db
    .from("profiles")
    .select("papel, ativo, email")
    .eq("user_id", userData.user.id)
    .single();
  if (perfilErr || !perfil || !perfil.ativo) return null;

  return { userId: userData.user.id, email: perfil.email, papel: perfil.papel as Papel };
}
