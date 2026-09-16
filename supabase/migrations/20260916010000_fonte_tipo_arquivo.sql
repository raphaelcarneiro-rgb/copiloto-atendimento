-- Etapa 12 — novo tipo de fonte para upload direto de arquivo (PDF/TXT/MD)
-- via portal admin (pedido do Raphael, 2026-09-16). Precisa ser sua própria
-- migration: Postgres não deixa usar um valor de enum recém-criado na mesma
-- transação em que ele foi adicionado.
alter type public.source_tipo add value if not exists 'arquivo';
