// Mascaramento no cliente (RF04, constitution §4): nada de PII deve sair do
// navegador. Mesmo padrão do backend (supabase/functions/_shared/pii.ts) —
// duplicado de propósito, não importado, porque um lado é bundle de
// extensão e o outro roda em Deno.
const RE_EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const RE_CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const RE_TELEFONE = /(?:\+?55\s?)?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}\b/g;

export function maskPII(texto: string): string {
  return texto
    .replace(RE_EMAIL, "[e-mail removido]")
    .replace(RE_CPF, "[cpf removido]")
    .replace(RE_TELEFONE, "[telefone removido]");
}
