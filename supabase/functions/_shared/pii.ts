// Mascaramento defensivo de PII (RF04, constitution §4). O plano prevê isso
// principalmente no lado da extensão (`extension/src/lib/pii.ts`, mesma
// lógica, duplicada de propósito); esta versão roda no backend como segunda
// camada, para qualquer texto que vire lacuna registrada (nunca deve reter
// telefone/e-mail/CPF do lead).

const RE_EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const RE_CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
// Telefones BR: (11) 91234-5678, 11 91234-5678, 11912345678, +55 11 91234-5678
const RE_TELEFONE = /(?:\+?55\s?)?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}\b/g;

export function maskPII(text: string): string {
  return text
    .replace(RE_EMAIL, "[e-mail removido]")
    .replace(RE_CPF, "[cpf removido]")
    .replace(RE_TELEFONE, "[telefone removido]");
}
