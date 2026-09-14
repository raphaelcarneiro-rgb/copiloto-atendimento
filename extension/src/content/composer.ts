// Insere texto no campo de resposta do HubSpot (RF: "inserir na conversa").
// O composer é um editor rich-text (ProseMirror, confirmado inspecionando o
// inbox real — data-test-id="rte-content"), não um <textarea> simples.
// Setar `.textContent` direto não atualiza o estado interno do ProseMirror
// nem dispara os listeners que ele usa para saber que o conteúdo mudou —
// por isso usamos `execCommand('insertText', ...)`, que gera os eventos de
// input nativos que o editor já escuta.
import type { InserirTextoResponse, SeletorComposer } from "../lib/types";

export function inserirNoComposer(
  texto: string,
  seletores: Partial<SeletorComposer>,
): InserirTextoResponse {
  if (!seletores.composer_texto) {
    return { ok: false, motivo: "composer-nao-calibrado" };
  }

  const campo = document.querySelector<HTMLElement>(seletores.composer_texto);
  if (!campo) {
    return { ok: false, motivo: "composer-nao-encontrado" };
  }

  campo.focus();
  document.execCommand("selectAll", false);
  document.execCommand("insertText", false, texto);
  return { ok: true };
}
