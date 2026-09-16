-- Corrige achado real testando `buscar_preco_curso` (2026-09-16): o match
-- "qualquer palavra ≥4 letras em comum" (mesma técnica de
-- buscar_convenio_empresa) é permissivo demais aqui porque o catálogo de
-- cursos repete palavras genéricas ("engenharia", "desenvolvimento",
-- "sistemas") em dezenas de produtos diferentes — "MBA em Engenharia de
-- Software com Java" casou com "Engenharia de Dados" só por compartilhar
-- "engenharia". Convênio (nome de empresa) não tinha esse problema porque
-- nomes de empresa não repetem palavra-base entre si.
--
-- Correção: em vez de "qualquer palavra em comum", exige que TODAS as
-- palavras significativas (≥4 letras) da pergunta apareçam no produto —
-- e prioriza correspondência exata/substring sobre esse critério mais
-- fraco quando os dois batem.
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
  produtos_distintos as (
    select distinct produto from public.precos_cursos
  ),
  produtos_casados as (
    select
      pd.produto,
      case
        when unaccent(lower(pd.produto)) = c.alvo then 0
        when unaccent(lower(pd.produto)) like '%' || c.alvo || '%'
          or c.alvo like '%' || unaccent(lower(pd.produto)) || '%' then 1
        else 2
      end as rank
    from produtos_distintos pd, candidato c
    where c.alvo <> ''
      and (
        unaccent(lower(pd.produto)) like '%' || c.alvo || '%'
        or c.alvo like '%' || unaccent(lower(pd.produto)) || '%'
        or (
          (select count(*) from unnest(string_to_array(c.alvo, ' ')) p where length(p) >= 4) > 0
          and not exists (
            select 1 from unnest(string_to_array(c.alvo, ' ')) as palavra
            where length(palavra) >= 4 and unaccent(lower(pd.produto)) not like '%' || palavra || '%'
          )
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
      m.rank,
      row_number() over (partition by pc.produto order by pc.semana desc) as rn
    from public.precos_cursos pc
    join produtos_casados m on m.produto = pc.produto
    where pc.semana <= p_data
  )
  select produto, programa, valor_final, valor_final_rj, semana as semana_vigente
  from candidatos_com_semana
  where rn = 1
  order by rank asc, length(produto) asc
  limit 1;
$$;

revoke all on function public.buscar_preco_curso(text, date) from public;
grant execute on function public.buscar_preco_curso(text, date) to service_role;
