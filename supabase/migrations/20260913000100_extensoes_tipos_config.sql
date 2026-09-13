-- Etapa 1 · 0100 — extensões, tipos e configuração
-- Spec: RF09, RF21, RF22 · Plan: "Modelo de dados"

create extension if not exists vector with schema extensions;

create type public.papel as enum ('atendente', 'curador', 'admin');
create type public.source_tipo as enum ('sheet', 'pdf', 'url', 'faq');
create type public.sync_status as enum ('pendente', 'ok', 'erro');
create type public.feriado_tipo as enum ('nacional', 'estadual', 'municipal', 'institucional', 'facultativo');
create type public.gap_status as enum ('aberta', 'em_curadoria', 'aprovada', 'ja_existia', 'atualizar_fonte', 'descartada');
create type public.gap_origem as enum ('resposta_consultor', 'correcao_feedback');
create type public.tipo_chamada as enum ('classificacao', 'suggest', 'ask', 'embedding', 'ingest');
create type public.feedback_valor as enum ('positivo', 'negativo');

-- Mantém a coluna atualizado_em em dia
create or replace function public.set_atualizado_em()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

-- Parâmetros do sistema (expediente, custo, modelos, versões, seletores do HubSpot)
create table public.config (
  chave text primary key,
  valor jsonb not null,
  descricao text,
  atualizado_em timestamptz not null default now()
);

create trigger config_atualizado_em
  before update on public.config
  for each row execute function public.set_atualizado_em();

-- Leitura de config para triggers, views e Edge Functions
create or replace function public.config_valor(p_chave text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select c.valor from public.config c where c.chave = p_chave
$$;

revoke execute on function public.config_valor(text) from public, anon;
grant execute on function public.config_valor(text) to authenticated, service_role;
