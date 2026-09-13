-- Etapa 1 · 0600 — views de relatório (custo e lacunas)
-- Spec: RF18, RF21 · security_invoker = true: a RLS de usage_logs vale (só admin vê custo)

create view public.vw_custo_por_conversa
with (security_invoker = true) as
select
  u.thread_hash,
  u.user_id,
  p.nome as atendente,
  min(u.criado_em) as inicio,
  max(u.criado_em) as fim,
  count(*) as chamadas,
  sum(u.tokens_entrada) as tokens_entrada,
  sum(u.tokens_saida) as tokens_saida,
  sum(u.tokens_cache) as tokens_cache,
  round(sum(u.custo_usd), 6) as custo_usd,
  round(sum(u.custo_brl), 4) as custo_brl,
  count(*) filter (where u.custo_usd is null) as chamadas_sem_preco
from public.usage_logs u
left join public.profiles p on p.user_id = u.user_id
where u.thread_hash is not null
group by u.thread_hash, u.user_id, p.nome;

create view public.vw_custo_por_atendente
with (security_invoker = true) as
select
  date_trunc('month', u.criado_em at time zone 'America/Sao_Paulo')::date as mes,
  u.user_id,
  coalesce(p.nome, 'sistema') as atendente,
  p.email,
  count(distinct u.thread_hash) as conversas,
  count(*) as chamadas,
  round(coalesce(sum(u.custo_brl), 0), 4) as custo_brl,
  round(sum(u.custo_brl) / nullif(count(distinct u.thread_hash), 0), 4) as custo_medio_conversa_brl
from public.usage_logs u
left join public.profiles p on p.user_id = u.user_id
group by 1, u.user_id, p.nome, p.email;

create view public.vw_custo_diario
with (security_invoker = true) as
select
  (u.criado_em at time zone 'America/Sao_Paulo')::date as dia,
  u.tipo_chamada,
  u.modelo,
  count(*) as chamadas,
  sum(u.tokens_entrada) as tokens_entrada,
  sum(u.tokens_saida) as tokens_saida,
  sum(u.tokens_cache) as tokens_cache,
  round(coalesce(sum(u.custo_usd), 0), 6) as custo_usd,
  round(coalesce(sum(u.custo_brl), 0), 4) as custo_brl
from public.usage_logs u
group by 1, u.tipo_chamada, u.modelo;

create view public.vw_custo_mensal
with (security_invoker = true) as
with mensal as (
  select
    date_trunc('month', u.criado_em at time zone 'America/Sao_Paulo')::date as mes,
    count(distinct u.thread_hash) as conversas,
    count(*) as chamadas,
    coalesce(sum(u.custo_brl), 0) as custo_brl
  from public.usage_logs u
  group by 1
),
parametros as (
  select
    coalesce((public.config_valor('teto_custo_mensal_brl') #>> '{}')::numeric, 0) as teto,
    (now() at time zone 'America/Sao_Paulo')::date as hoje
)
select
  m.mes,
  m.conversas,
  m.chamadas,
  round(m.custo_brl, 4) as custo_brl,
  round(m.custo_brl / nullif(m.conversas, 0), 4) as custo_medio_conversa_brl,
  pr.teto as teto_brl,
  round(100 * m.custo_brl / nullif(pr.teto, 0), 1) as pct_teto,
  case
    when m.mes = date_trunc('month', pr.hoje::timestamp)::date then
      round(
        m.custo_brl / extract(day from pr.hoje::timestamp)
          * extract(day from (m.mes::timestamp + interval '1 month' - interval '1 day')),
        4)
    else round(m.custo_brl, 4)
  end as projecao_mes_brl
from mensal m
cross join parametros pr;

create view public.vw_lacunas_abertas
with (security_invoker = true) as
select
  g.id,
  g.pergunta_mascarada,
  g.curso,
  g.etapa,
  g.contagem,
  g.status,
  g.primeira_vez,
  g.ultima_vez,
  (select count(*) from public.gap_proposals gp where gp.gap_id = g.id) as propostas,
  g.contagem >= coalesce((public.config_valor('limiar_destaque_lacuna') #>> '{}')::integer, 5) as destaque
from public.knowledge_gaps g
where g.status in ('aberta', 'em_curadoria')
order by destaque desc, g.contagem desc, g.ultima_vez desc;

revoke all on
  public.vw_custo_por_conversa, public.vw_custo_por_atendente, public.vw_custo_diario,
  public.vw_custo_mensal, public.vw_lacunas_abertas
from anon;
