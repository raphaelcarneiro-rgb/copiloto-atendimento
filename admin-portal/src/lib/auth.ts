// Login real via Google OAuth (RF09), restrito a @infnet.edu.br — mesmo
// backend/allowlist/RLS já usados pela extensão (extension/src/lib/auth.ts),
// mas aqui o fluxo é mais simples: como o portal é uma página web de
// verdade (origem HTTPS própria), usamos o redirect clássico do Supabase
// Auth (`/auth/v1/authorize` → volta pra cá com o token no fragmento da
// URL) em vez do hack `chrome.identity.launchWebAuthFlow` que a extensão
// precisa usar. Sem SDK do Supabase — só fetch, mesmo estilo do resto do
// projeto (Constitution §5).
//
// Pré-requisito manual (uma vez, no Supabase Dashboard → Authentication →
// URL Configuration → Redirect URLs): adicionar a URL onde este portal roda
// (ex.: http://localhost:5173 em dev, e o domínio Vercel em produção).
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

const STORAGE_KEY = "copiloto_admin_sessao";

export interface SessaoUsuario {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
  usuario: { id: string; email: string };
}

function lerSessaoSalva(): SessaoUsuario | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessaoUsuario;
  } catch {
    return null;
  }
}

function salvarSessaoLocal(sessao: SessaoUsuario) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessao));
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
  salvarSessaoLocal(sessao);
  return sessao;
}

async function renovarSessao(refreshToken: string): Promise<SessaoUsuario | null> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
  const data = await res.json();
  return salvarSessao(data);
}

function parseFragmento(hash: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(hash.replace(/^#/, "")));
}

/**
 * Chamada uma vez ao carregar a página: se a URL veio de volta do redirect
 * do Google/Supabase (fragmento com access_token), salva a sessão e limpa a
 * URL. Precisa rodar ANTES de qualquer `getSessao()`.
 */
async function processarCallbackLogin(): Promise<void> {
  if (!window.location.hash.includes("access_token")) return;
  const params = parseFragmento(window.location.hash);
  if (params.error) {
    console.error("Login falhou:", params.error_description ?? params.error);
    history.replaceState(null, "", window.location.pathname);
    return;
  }
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${params.access_token}` },
  });
  if (userRes.ok) {
    const user = await userRes.json();
    await salvarSessao({
      access_token: params.access_token,
      refresh_token: params.refresh_token,
      expires_in: Number(params.expires_in ?? 3600),
      user: { id: user.id, email: user.email },
    });
  }
  history.replaceState(null, "", window.location.pathname);
}

export async function getSessao(): Promise<SessaoUsuario | null> {
  await processarCallbackLogin();
  const sessao = lerSessaoSalva();
  if (!sessao) return null;
  if (sessao.expires_at - 60_000 > Date.now()) return sessao;
  return renovarSessao(sessao.refresh_token);
}

export function iniciarLogin(): void {
  const redirectTo = window.location.origin + window.location.pathname;
  const authUrl =
    `${SUPABASE_URL}/auth/v1/authorize?provider=google` + `&redirect_to=${encodeURIComponent(redirectTo)}`;
  window.location.href = authUrl;
}

export async function logout(): Promise<void> {
  const sessao = lerSessaoSalva();
  localStorage.removeItem(STORAGE_KEY);
  if (!sessao) return;
  await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${sessao.access_token}` },
  }).catch(() => {
    // best-effort — a sessão local já foi removida de qualquer forma.
  });
}
