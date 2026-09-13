-- Etapa 1 · 0800 — preços OpenAI (tabela de set/2026) e modelos do MVP
-- Motivo: a tabela atual cobra "cache writes" e tem faixa de "long context".
-- Spec: RF21 · Fonte: platform.openai.com/pricing (Standard), consultada em 2026-09-13

-- 1. Novas colunas de preço
alter table public.precos_modelo
  add column usd_por_1m_cache_escrita       numeric(12, 6),
  add column usd_por_1m_entrada_longo       numeric(12, 6),
  add column usd_por_1m_cache_longo         numeric(12, 6),
  add column usd_por_1m_cache_escrita_longo numeric(12, 6),
  add column usd_por_1m_saida_longo         numeric(12, 6),
  add column limite_contexto_curto_tokens   integer;

comment on column public.precos_modelo.limite_contexto_curto_tokens is
  'Acima deste total de tokens de entrada aplica-se o preço de contexto longo. Nulo = sempre contexto curto.';

-- 2. Tokens de escrita em cache no uso
alter table public.usage_logs
  add column tokens_cache_escrita integer not null default 0 check (tokens_cache_escrita >= 0);

comment on column public.usage_logs.tokens_entrada is
  'Total de tokens de entrada, incluindo os lidos do cache (tokens_cache) e os gravados em cache (tokens_cache_escrita).';

-- 3. Recria cálculo de custo com cache write e contexto longo
drop trigger usage_logs_custo on public.usage_logs;
drop function public.calcular_custo_usage();
drop function public.custo_estimado_usd(text, integer, integer, integer, date);

create function public.custo_estimado_usd(
  p_modelo text,
  p_tokens_entrada integer,
  p_tokens_saida integer,
  p_tokens_cache integer default 0,
  p_tokens_cache_escrita integer default 0,
  p_dia date default (now() at time zone 'America/Sao_Paulo')::date
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select (
      greatest(p_tokens_entrada - p_tokens_cache - p_tokens_cache_escrita, 0)
        * case when x.longo then coalesce(x.usd_por_1m_entrada_longo, x.usd_por_1m_entrada) else x.usd_por_1m_entrada end
    + p_tokens_cache
        * case when x.longo then coalesce(x.usd_por_1m_cache_longo, x.usd_por_1m_cache, x.usd_por_1m_entrada)
               else coalesce(x.usd_por_1m_cache, x.usd_por_1m_entrada) end
    + p_tokens_cache_escrita
        * case when x.longo then coalesce(x.usd_por_1m_cache_escrita_longo, x.usd_por_1m_cache_escrita, x.usd_por_1m_entrada)
               else coalesce(x.usd_por_1m_cache_escrita, x.usd_por_1m_entrada) end
    + p_tokens_saida
        * case when x.longo then coalesce(x.usd_por_1m_saida_longo, x.usd_por_1m_saida) else x.usd_por_1m_saida end
  ) / 1000000.0
  from (
    select
      p.*,
      (p.limite_contexto_curto_tokens is not null and p_tokens_entrada > p.limite_contexto_curto_tokens) as longo
    from public.precos_modelo p
    where p.modelo = p_modelo
      and p.vigente_desde <= p_dia
    order by p.vigente_desde desc
    limit 1
  ) x
$$;

revoke execute on function public.custo_estimado_usd(text, integer, integer, integer, integer, date) from public, anon;
grant execute on function public.custo_estimado_usd(text, integer, integer, integer, integer, date) to authenticated, service_role;

create function public.calcular_custo_usage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cotacao numeric;
begin
  if new.custo_usd is null then
    new.custo_usd := public.custo_estimado_usd(
      new.modelo,
      new.tokens_entrada,
      new.tokens_saida,
      new.tokens_cache,
      new.tokens_cache_escrita,
      (new.criado_em at time zone 'America/Sao_Paulo')::date
    );
  end if;

  if new.custo_usd is not null and new.custo_brl is null then
    v_cotacao := (public.config_valor('cotacao_usd_brl') #>> '{}')::numeric;
    if v_cotacao is not null then
      new.custo_brl := new.custo_usd * v_cotacao;
    end if;
  end if;

  return new;
end;
$$;

create trigger usage_logs_custo
  before insert on public.usage_logs
  for each row execute function public.calcular_custo_usage();

-- 4. Preços: remove os valores provisórios e grava a tabela Standard de set/2026
delete from public.precos_modelo where modelo in ('gpt-5-mini', 'gpt-5-nano');

insert into public.precos_modelo (
  modelo, vigente_desde,
  usd_por_1m_entrada, usd_por_1m_cache, usd_por_1m_cache_escrita, usd_por_1m_saida,
  usd_por_1m_entrada_longo, usd_por_1m_cache_longo, usd_por_1m_cache_escrita_longo, usd_por_1m_saida_longo
) values
  ('gpt-6-astra',  '2026-09-01', 10.00, 1.00, 12.50, 50.00, 20.00, 2.00, 25.00, 75.00),
  ('gpt-5.6-sol',  '2026-09-01',  4.00, 0.40,  5.00, 20.00,  8.00, 0.80, 10.00, 30.00),
  ('gpt-5.6-terra','2026-09-01',  2.00, 0.20,  2.50, 12.00,  4.00, 0.40,  5.00, 18.00),
  ('gpt-5.6-luna', '2026-09-01',  0.20, 0.02,  0.25,  1.20,  0.40, 0.04,  0.50,  1.80)
on conflict (modelo, vigente_desde) do update set
  usd_por_1m_entrada = excluded.usd_por_1m_entrada,
  usd_por_1m_cache = excluded.usd_por_1m_cache,
  usd_por_1m_cache_escrita = excluded.usd_por_1m_cache_escrita,
  usd_por_1m_saida = excluded.usd_por_1m_saida,
  usd_por_1m_entrada_longo = excluded.usd_por_1m_entrada_longo,
  usd_por_1m_cache_longo = excluded.usd_por_1m_cache_longo,
  usd_por_1m_cache_escrita_longo = excluded.usd_por_1m_cache_escrita_longo,
  usd_por_1m_saida_longo = excluded.usd_por_1m_saida_longo;

-- 5. Modelos do MVP: luna em tudo (cabe no teto de R$ 100/mês); terra fica como opção
update public.config
set valor = '{"chat": "gpt-5.6-luna", "classificacao": "gpt-5.6-luna", "embedding": "text-embedding-3-small", "chat_alternativo": "gpt-5.6-terra"}'::jsonb,
    descricao = 'Modelos OpenAI por uso. Trocar chat para gpt-5.6-terra só se os evals exigirem.'
where chave = 'modelos';
