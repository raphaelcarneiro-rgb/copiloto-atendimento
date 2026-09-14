// Cliente das Edge Functions do Supabase. A anon key é pública por design do
// Supabase (equivalente a uma chave de projeto, não a um segredo — o mesmo
// valor já é usado pelo job pg_cron); a autorização de verdade vem do RLS e
// do JWT do usuário logado, que é anexado aqui quando existir.
import type { ConfigRemota } from "./types";

const SUPABASE_URL = "https://trtmyuqatmhvikfbqmkv.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRydG15dXFhdG1odmlrZmJxbWt2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzMzA0NTUsImV4cCI6MjEwNDkwNjQ1NX0.A1Wj9uzSgYxngeFBXAa-mtP9Xx4QMwl1r2a0F8VjiLU";

async function getUserJwt(): Promise<string | null> {
  const { supabase_session } = await chrome.storage.local.get("supabase_session");
  return supabase_session?.access_token ?? null;
}

async function callFunction<T>(path: string, init?: RequestInit): Promise<T> {
  const jwt = await getUserJwt();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${jwt ?? SUPABASE_ANON_KEY}`,
      ...init?.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`${path} falhou (${res.status}): ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export function fetchConfig(): Promise<ConfigRemota> {
  return callFunction<ConfigRemota>("config", { method: "GET" });
}

export function ask(pergunta: string, threadHash?: string) {
  return callFunction("ask", {
    method: "POST",
    body: JSON.stringify({ pergunta, thread_hash: threadHash }),
  });
}
