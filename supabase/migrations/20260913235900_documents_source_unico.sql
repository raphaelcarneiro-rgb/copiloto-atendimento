-- Etapa 2 · 0900 — um documento por fonte (MVP)
-- Simplifica a reingestão: cada fonte tem exatamente um `documents`, cujos
-- chunks são substituídos por completo quando o hash da fonte muda.

alter table public.documents
  add constraint documents_source_id_key unique (source_id);
