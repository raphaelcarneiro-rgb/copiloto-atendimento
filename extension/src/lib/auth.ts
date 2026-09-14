// RF09: login real via Google OAuth, restrito a @infnet.edu.br. Usa
// chrome.identity.launchWebAuthFlow contra o endpoint hospedado de OAuth
// do Supabase Auth (/auth/v1/authorize) — sem biblioteca de cliente
// Supabase, só fetch, igual ao resto da extensão.
//
// Pré-requisitos que NÃO dependem de código (alguém com acesso aos
// consoles precisa fazer isso manualmente, uma vez):
//   1. Google Cloud Console: um OAuth Client ID (tipo "Web application")
//      com origem/redirect autorizado para
//      https://<SUPABASE_PROJECT_REF>.supabase.co/auth/v1/callback,
//      configurado como "Internal" (só contas do Workspace Infnet).
//   2. Supabase Dashboard → Authentication → Providers → Google: colar o
//      Client ID/Secret de (1).
//   3. Supabase Dashboard → Authentication → URL Configuration → Redirect
//      URLs: adicionar a URL que `chrome.identity.getRedirectURL()`
//      devolve nesta extensão (determinística a partir da "key" fixa do
//      manifest.json — ver docs/setup/04-extensao.md para o valor já
//      calculado).
// Sem isso, `login()` abre a janela do Google mas o Supabase rejeita o
// callback.
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./supabase-config";

const STORAGE_KEY = "supabase_session";

export interface SessaoUsuario {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
  usuario: { id: string; email: string };
}

export async function getSessao(): Promise<SessaoUsuario | null> {
  const { [STORAGE_KEY]: sessao } = (await chrome.storage.local.get(STORAGE_KEY)) as {
    [STORAGE_KEY]?: SessaoUsuario;
  };
  if (!sessao) return null;
  if (sessao.expires_at - 60_000 > Date.now()) return sessao;
  return renovarSessao(sessao.refresh_token);
}

async function renovarSessao(refreshToken: string): Promise<SessaoUsuario | null> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) {
    await chrome.storage.local.remove(STORAGE_KEY);
    return null;
  }
  const data = await res.json();
  return salvarSessao(data);
}

async function salvarSessao(data: {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: { id: string; email: string };
}): Promise<SessaoUsuario> {
  const sessao: SessaoUsuario = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    usuario: { id: data.user.id, email: data.user.email },
  };
  await chrome.storage.local.set({ [STORAGE_KEY]: sessao });
  return sessao;
}

function parseFragmento(url: string): Record<string, string> {
  const hash = new URL(url).hash.replace(/^#/, "");
  return Object.fromEntries(new URLSearchParams(hash));
}

/** Abre a janela de login do Google (via Supabase Auth) e salva a sessão. */
export async function login(): Promise<SessaoUsuario> {
  const redirectUrl = chrome.identity.getRedirectURL();
  const authUrl =
    `${SUPABASE_URL}/auth/v1/authorize?provider=google` +
    `&redirect_to=${encodeURIComponent(redirectUrl)}`;

  const resultUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
  if (!resultUrl) throw new Error("Login cancelado.");

  const params = parseFragmento(resultUrl);
  if (params.error) {
    throw new Error(params.error_description ?? params.error);
  }
  if (!params.access_token) {
    throw new Error("Resposta de login sem access_token — verifique se o provedor Google está configurado no Supabase Auth.");
  }

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${params.access_token}` },
  });
  if (!userRes.ok) throw new Error("Não consegui confirmar o usuário logado.");
  const user = await userRes.json();

  return salvarSessao({
    access_token: params.access_token,
    refresh_token: params.refresh_token,
    expires_in: Number(params.expires_in ?? 3600),
    user: { id: user.id, email: user.email },
  });
}

export async function logout(): Promise<void> {
  const sessao = await getSessao();
  await chrome.storage.local.remove(STORAGE_KEY);
  if (!sessao) return;
  await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${sessao.access_token}` },
  }).catch(() => {
    // best-effort — a sessão local já foi removida de qualquer forma.
  });
}
