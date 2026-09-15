create extension if not exists unaccent;

-- RF do header do copiloto (pedido do Raphael, 2026-09-15): mostrar o %
-- de desconto de convênio da empresa associada no cabeçalho do side panel.
-- Os dados de convênio vêm de uma planilha ingerida como chunks de texto
-- (sources.categoria = 'convenios'), não de `facts` estruturado — por isso
-- essa função faz o parsing determinístico do texto já ingerido (nunca
-- inventa/estima um percentual). Match por nome é "fuzzy" (substring de
-- qualquer palavra >=4 letras, sem acento) porque o nome da empresa no
-- CRM (HubSpot) pode não bater 100% com o nome na planilha de convênios
-- (ex.: "Binario Cloud" no HubSpot vs "Binário.Net" na planilha).
create or replace function public.buscar_convenio_empresa(p_empresa text)
returns table(empresa text, dominio text, nivel text, desconto_pct int, valido_ate date, status text)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with entradas as (
    select
      (m)[1] as empresa,
      (m)[2] as dominio,
      (m)[3] as nivel,
      (m)[4]::int as desconto_pct,
      to_date((m)[6], 'DD/MM/YYYY') as valido_ate,
      (m)[7] as status
    from chunks c
    join documents d on d.id = c.document_id
    join sources s on s.id = d.source_id
    cross join lateral regexp_matches(
      c.conteudo,
      'Empresa conveniada: (.+?)\. Domínio: (.+?)\. Nível do convênio: (.+?)\. Desconto do convênio: (\d+)%\. Convênio vigente desde ([0-9/]+)\. Válido até ([0-9/]+)\. Status: (\w+)\.',
      'g'
    ) as m
    where s.categoria = 'convenios' and s.ativo
  ),
  candidato as (
    select unaccent(lower(trim(p_empresa))) as alvo
  )
  select e.empresa, e.dominio, e.nivel, e.desconto_pct, e.valido_ate, e.status
  from entradas e, candidato c
  where c.alvo <> ''
    and (
      unaccent(lower(e.empresa)) like '%' || c.alvo || '%'
      or c.alvo like '%' || unaccent(lower(e.empresa)) || '%'
      or exists (
        select 1 from unnest(string_to_array(c.alvo, ' ')) as palavra
        where length(palavra) >= 4 and unaccent(lower(e.empresa)) like '%' || palavra || '%'
      )
    )
  order by e.valido_ate desc nulls last
  limit 1;
$$;

revoke all on function public.buscar_convenio_empresa(text) from public;
grant execute on function public.buscar_convenio_empresa(text) to service_role;
