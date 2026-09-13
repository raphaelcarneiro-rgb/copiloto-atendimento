-- Etapa 1 · 0300 — ciclo de aprendizado e custo
-- Spec: RF15–RF21 · Constitution §7, §8

-- Lacunas da base (perguntas mascaradas, sem o restante da conversa)
create table public.knowledge_gaps (
  id uuid primary key default gen_random_uuid(),
  pergunta_mascarada text not null,
  embedding extensions.vector(1536),
  curso text,
  etapa text,
  contagem integer not null default 1 check (contagem > 0),
  status public.gap_status not null default 'aberta',
  usuarios_ids uuid[] not null default '{}',
  fonte_existente text,
  notas_curador text,
  primeira_vez timestamptz not null default now(),
  ultima_vez timestamptz not null default now(),
  resolvido_em timestamptz,
  resolvido_por uuid references public.profiles (user_id) on delete set null
);

create index knowledge_gaps_status_contagem_idx on public.knowledge_gaps (status, contagem desc);
create index knowledge_gaps_resolvido_por_idx on public.knowledge_gaps (resolvido_por);
create index knowledge_gaps_embedding_idx on public.knowledge_gaps using hnsw (embedding extensions.vector_cosine_ops);

-- Respostas propostas pelos atendentes
create table public.gap_proposals (
  id uuid primary key default gen_random_uuid(),
  gap_id uuid not null references public.knowledge_gaps (id) on delete cascade,
  user_id uuid default auth.uid() references public.profiles (user_id) on delete set null,
  resposta_mascarada text not null,
  fonte_url text,
  origem public.gap_origem not null,
  criado_em timestamptz not null default now()
);

create index gap_proposals_gap_id_idx on public.gap_proposals (gap_id);
create index gap_proposals_user_id_idx on public.gap_proposals (user_id);

-- Conhecimento aprovado pelo curador (vira fonte tipo 'faq' na ingestão)
create table public.faq_curada (
  id uuid primary key default gen_random_uuid(),
  gap_id uuid references public.knowledge_gaps (id) on delete set null,
  pergunta text not null,
  resposta text not null,
  fontes text[] not null default '{}',
  curador_id uuid default auth.uid() references public.profiles (user_id) on delete set null,
  aprovado_em timestamptz not null default now(),
  valido_ate date,
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now()
);

create index faq_curada_gap_id_idx on public.faq_curada (gap_id);
create index faq_curada_curador_id_idx on public.faq_curada (curador_id);

create trigger faq_curada_atualizado_em
  before update on public.faq_curada
  for each row execute function public.set_atualizado_em();

-- Tabela de preços da OpenAI (US$ por 1 milhão de tokens)
create table public.precos_modelo (
  modelo text not null,
  vigente_desde date not null,
  usd_por_1m_entrada numeric(12, 6) not null,
  usd_por_1m_saida numeric(12, 6) not null default 0,
  usd_por_1m_cache numeric(12, 6),
  primary key (modelo, vigente_desde)
);

-- Custo estimado de uma chamada com o preço vigente na data
create or replace function public.custo_estimado_usd(
  p_modelo text,
  p_tokens_entrada integer,
  p_tokens_saida integer,
  p_tokens_cache integer default 0,
  p_dia date default (now() at time zone 'America/Sao_Paulo')::date
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select (
      greatest(p_tokens_entrada - p_tokens_cache, 0) * p.usd_por_1m_entrada
    + p_tokens_cache * coalesce(p.usd_por_1m_cache, p.usd_por_1m_entrada)
    + p_tokens_saida * p.usd_por_1m_saida
  ) / 1000000.0
  from public.precos_modelo p
  where p.modelo = p_modelo
    and p.vigente_desde <= p_dia
  order by p.vigente_desde desc
  limit 1
$$;

revoke execute on function public.custo_estimado_usd(text, integer, integer, integer, date) from public, anon;
grant execute on function public.custo_estimado_usd(text, integer, integer, integer, date) to authenticated, service_role;

-- Uso e custo por chamada de IA (sem texto da conversa)
create table public.usage_logs (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles (user_id) on delete set null,
  thread_hash text,
  tipo_chamada public.tipo_chamada not null,
  modelo text not null,
  tokens_entrada integer not null default 0 check (tokens_entrada >= 0),
  tokens_saida integer not null default 0 check (tokens_saida >= 0),
  tokens_cache integer not null default 0 check (tokens_cache >= 0),
  custo_usd numeric(14, 8),
  custo_brl numeric(14, 6),
  latencia_ms integer,
  etapa text,
  aceita boolean,
  feedback public.feedback_valor,
  feedback_motivo text,
  criado_em timestamptz not null default now()
);

comment on column public.usage_logs.tokens_entrada is 'Total de tokens de entrada, incluindo os servidos do cache (tokens_cache).';
comment on column public.usage_logs.custo_brl is 'Convertido com config.cotacao_usd_brl no momento do registro.';

create index usage_logs_criado_em_idx on public.usage_logs (criado_em);
create index usage_logs_user_criado_em_idx on public.usage_logs (user_id, criado_em);
create index usage_logs_thread_hash_idx on public.usage_logs (thread_hash);

create or replace function public.calcular_custo_usage()
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

-- Alertas de teto já enviados (um por limiar por mês)
create table public.cost_alerts (
  mes date not null,
  limiar numeric(4, 2) not null,
  custo_brl numeric(14, 6) not null,
  enviado_em timestamptz not null default now(),
  primary key (mes, limiar)
);
