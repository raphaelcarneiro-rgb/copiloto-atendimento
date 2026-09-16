/** SHA-256 hex genérico — usado tanto pro thread_hash quanto pra chave do cache de transcrição de áudio. */
export async function sha256Hex(texto: string): Promise<string> {
  const bytes = new TextEncoder().encode(texto);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Hash do threadId antes de mandar pro backend (usage_logs.thread_hash) —
// serve só para agrupar custo por conversa nos relatórios (RF21), não
// precisa (nem deve) guardar o id bruto do HubSpot em texto puro.
export function hashThreadId(threadId: string): Promise<string> {
  return sha256Hex(threadId);
}
