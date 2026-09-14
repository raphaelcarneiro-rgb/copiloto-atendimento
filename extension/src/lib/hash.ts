// Hash do threadId antes de mandar pro backend (usage_logs.thread_hash) —
// serve só para agrupar custo por conversa nos relatórios (RF21), não
// precisa (nem deve) guardar o id bruto do HubSpot em texto puro.
export async function hashThreadId(threadId: string): Promise<string> {
  const bytes = new TextEncoder().encode(threadId);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
