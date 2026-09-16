// Instrução de formatação compartilhada entre `suggest` e `ask` (pedido do
// Raphael, 2026-09-15): o texto sugerido vai direto pro WhatsApp (via
// "Inserir na conversa" ou colado manualmente) — por isso pede a sintaxe de
// formatação DO PRÓPRIO WhatsApp (*negrito*, quebra de linha dupla entre
// assuntos), não markdown de verdade, que apareceria como asteriscos/
// cardinais literais pro lead.
export const INSTRUCAO_FORMATACAO_WHATSAPP =
  "Formate o texto pensando em como ele aparece no WhatsApp, não como markdown: quando a mensagem falar de mais de um assunto (ex.: valor + convênio + próximo passo), separe cada assunto com uma linha em branco entre eles (uma quebra de linha dupla). Use *um asterisco de cada lado* (é assim que o WhatsApp exibe negrito) pra destacar as partes mais importantes — valor final, prazo, nome do curso — e a pergunta de esclarecimento/fechamento, se ela estiver dentro do próprio texto. NUNCA use markdown de verdade (sem **, sem #, sem listas com -/*), só a sintaxe simples do WhatsApp.";
