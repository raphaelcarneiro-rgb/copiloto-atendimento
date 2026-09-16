-- Etapa 14 — mesma técnica de match fuzzy de `buscar_convenio_empresa`
-- (20260915020000_funcao_buscar_convenio_empresa.sql: unaccent + substring +
-- palavra com ≥4 letras), mas contra a coluna `produto` de uma tabela
-- estruturada direto, não regex em texto de chunk. Nunca devolve `valor`/
-- `valor_rj` (base) — só os finais, que é tudo que pode ser mostrado ao
-- lead (Constitution §1, pedido explícito do Raphael 2026-09-16).
--
-- "Vigente": entre as linhas do produto casado, pega a de maior `semana`
-- que já começou (<= p_data) — a planilha já tem semanas futuras
-- cadastradas com antecedência, então nunca usar a semana mais recente do
-- arquivo, sempre a mais recente que já é válida na data da consulta.
create or replace function public.buscar_preco_curso(p_produto text, p_data date default current_date)
returns table (
  produto_encontrado text,
  programa text,
  valor_final numeric,
  valor_final_rj numeric,
  semana_vigente date
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with candidato as (
    select unaccent(lower(trim(p_produto))) as alvo
  ),
  produtos_casados as (
    select distinct pc.produto
    from public.precos_cursos pc, candidato c
    where c.alvo <> ''
      and (
        unaccent(lower(pc.produto)) like '%' || c.alvo || '%'
        or c.alvo like '%' || unaccent(lower(pc.produto)) || '%'
        or exists (
          select 1 from unnest(string_to_array(c.alvo, ' ')) as palavra
          where length(palavra) >= 4 and unaccent(lower(pc.produto)) like '%' || palavra || '%'
        )
      )
  ),
  candidatos_com_semana as (
    select
      pc.produto,
      pc.programa,
      pc.valor_final,
      pc.valor_final_rj,
      pc.semana,
      row_number() over (partition by pc.produto order by pc.semana desc) as rn
    from public.precos_cursos pc
    join produtos_casados m on m.produto = pc.produto
    where pc.semana <= p_data
  )
  select produto, programa, valor_final, valor_final_rj, semana as semana_vigente
  from candidatos_com_semana
  where rn = 1
  order by length(produto) asc
  limit 1;
$$;

revoke all on function public.buscar_preco_curso(text, date) from public;
grant execute on function public.buscar_preco_curso(text, date) to service_role;
