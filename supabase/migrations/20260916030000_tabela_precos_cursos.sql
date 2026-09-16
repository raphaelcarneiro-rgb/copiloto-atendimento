-- Etapa 14 — preço oficial de PGL/GRL, determinístico (pedido do Raphael,
-- 2026-09-16). Planilha real confirmada via API do Google Sheets (nunca
-- chutada): spreadsheet 1Azgidfab9z6uUauKd6UpFMONQYPwPADGMmNVCXDGGMg, aba
-- "apoio-valores-2" (gid 1025708788), colunas literais
-- @search_key/@semana/@programa/@produto/@codigo/@valor/@cupom/@codcupom/
-- @valor_final/@codigo_rj/@valor_rj/@cupom_rj/@codcupom_rj/@valor_final_rj.
--
-- Tabela estruturada de propósito (RF07, Constitution §1): NUNCA vira chunk
-- de texto — só é acessível pela função determinística
-- `buscar_preco_curso()` (próxima migration). Isso garante que preço nunca
-- passa por busca vetorial nem por conta feita pelo LLM.
create table public.precos_cursos (
  id bigint generated always as identity primary key,
  source_id uuid references public.sources (id) on delete cascade,
  search_key text,
  semana date not null,
  programa text not null,
  produto text not null,
  codigo text,
  valor numeric(12, 2),
  cupom_pct numeric(5, 2),
  codcupom text,
  valor_final numeric(12, 2),
  codigo_rj text,
  valor_rj numeric(12, 2),
  cupom_rj_pct numeric(5, 2),
  codcupom_rj text,
  valor_final_rj numeric(12, 2),
  criado_em timestamptz not null default now()
);

create index precos_cursos_produto_semana_idx on public.precos_cursos (produto, semana desc);
create index precos_cursos_source_id_idx on public.precos_cursos (source_id);

-- Formas de pagamento (Raphael, 2026-09-16): multiplicadores fixos sobre
-- valor_final/valor_final_rj. Fica em tabela (não hardcoded no código) pra
-- poder ajustar sem deploy, mesmo espírito de `precos_modelo`/`config`.
create table public.formas_pagamento_cursos (
  id bigint generated always as identity primary key,
  programa text not null,
  forma text not null,
  descricao text not null,
  parcelas integer not null,
  multiplicador numeric(6, 4) not null,
  ordem integer not null default 0,
  ativo boolean not null default true
);

insert into public.formas_pagamento_cursos (programa, forma, descricao, parcelas, multiplicador, ordem) values
  ('PGL', 'pix', 'Pix (à vista)', 1, 0.9200, 1),
  ('PGL', 'cartao_18x', 'Cartão de crédito parcelado em 18x', 18, 1.0450, 2),
  ('PGL', 'cartao_12x', 'Cartão de crédito parcelado em 12x', 12, 0.9500, 3),
  ('PGL', 'cartao_recorrente_13x', 'Cartão de crédito recorrente em 13x', 13, 1.0000, 4),
  ('PGL', 'boleto_13x', 'Boleto bancário em 13x', 13, 1.0000, 5),
  ('GRL', 'mensalidade', 'Mensalidade (boleto)', 1, 1.0000, 1);

alter table public.precos_cursos           enable row level security;
alter table public.formas_pagamento_cursos enable row level security;
revoke all on public.precos_cursos, public.formas_pagamento_cursos from anon;

do $$
declare
  t text;
begin
  foreach t in array array['precos_cursos', 'formas_pagamento_cursos'] loop
    execute format(
      'create policy %1$s_select_membro on public.%1$I for select to authenticated using ((select public.eh_membro()))', t);
    execute format(
      'create policy %1$s_insert_admin on public.%1$I for insert to authenticated with check ((select public.eh_admin()))', t);
    execute format(
      'create policy %1$s_update_admin on public.%1$I for update to authenticated using ((select public.eh_admin())) with check ((select public.eh_admin()))', t);
    execute format(
      'create policy %1$s_delete_admin on public.%1$I for delete to authenticated using ((select public.eh_admin()))', t);
  end loop;
end;
$$;
