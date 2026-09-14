// CORS para Edge Functions chamadas direto do navegador (extensão rodando
// no content script/side panel, origem https://app.hubspot.com ou
// chrome-extension://...). Sem isso o preflight OPTIONS falha e o fetch
// nunca chega na função (Supabase pula a verificação de JWT só para
// OPTIONS, mas quem responde os headers de CORS é a própria função).
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function respondCorsPreflight(): Response {
  return new Response(null, { headers: CORS_HEADERS });
}

export function jsonComCors(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS, ...init?.headers },
  });
}
