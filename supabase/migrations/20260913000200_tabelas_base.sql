-- Etapa 1 · 0200 — acesso e base de conhecimento
-- Spec: RF07, RF08, RF09 · Constitution §1, §9

-- Perfis (1:1 com auth.users, criados por trigger na migration 0400)
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  nome text,
  papel public.papel not null default 'atendente',
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint profiles_email_dominio check (lower(email) like '%@infnet.edu.br')
);

create trigger profiles_atualizado_em
  before update on public.profiles
  for each row execute function public.set_atualizado_em();

-- Fontes da base (Google Sheets, PDF, URL, FAQ curada)
create table public.sources (
  id uuid primary key default gen_random_uuid(),
  tipo public.source_tipo not null,
  ref text not null,
  nome text not null,
  categoria text,
  ativo boolean not null default true,
  status public.sync_status not null default 'pendente',
  erro text,
  hash text,
  ultima_sync timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (tipo, ref)
);

create trigger sources_atualizado_em
  before update on public.sources
  for each row execute function public.set_atualizado_em();

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources (id) on delete cascade,
  titulo text,
  url text,
  hash text,
  versao integer not null default 1,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index documents_source_id_idx on public.documents (source_id);

create trigger documents_atualizado_em
  before update on public.documents
  for each row execute function public.set_atualizado_em();

-- Trechos indexados para busca híbrida (vetor + full-text em português)
create table public.chunks (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.documents (id) on delete cascade,
  ordem integer not null default 0,
  conteudo text not null,
  metadados jsonb not null default '{}'::jsonb,
  embedding extensions.vector(1536),
  fts tsvector generated always as (to_tsvector('portuguese'::regconfig, conteudo)) stored,
  criado_em timestamptz not null default now()
);

create index chunks_document_id_idx on public.chunks (document_id);
create index chunks_embedding_idx on public.chunks using hnsw (embedding extensions.vector_cosine_ops);
create index chunks_fts_idx on public.chunks using gin (fts);
create index chunks_metadados_idx on public.chunks using gin (metadados);

-- Fatos exatos vindos de planilhas (preço, duração, carga horária, MEC...)
create table public.facts (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources (id) on delete cascade,
  curso text not null,
  atributo text not null,
  valor text not null,
  unidade text,
  vigencia_inicio date,
  vigencia_fim date,
  criado_em timestamptz not null default now(),
  constraint facts_vigencia check (vigencia_inicio is null or vigencia_fim is null or vigencia_fim >= vigencia_inicio)
);

create index facts_source_id_idx on public.facts (source_id);
create index facts_curso_atributo_idx on public.facts (lower(curso), atributo);

-- Calendário (planilha "Calendário Infnet"); usado no lembrete de 24h
create table public.feriados (
  id bigint generated always as identity primary key,
  data date not null,
  nome text not null,
  tipo public.feriado_tipo not null,
  conta_como_folga boolean not null default true,
  observacao text,
  source_id uuid references public.sources (id) on delete set null,
  criado_em timestamptz not null default now(),
  unique (data, nome)
);

create index feriados_data_folga_idx on public.feriados (data) where conta_como_folga;
create index feriados_source_id_idx on public.feriados (source_id);

-- Roteiro comercial por etapa
create table public.playbook (
  etapa text primary key,
  ordem integer not null default 0,
  objetivo text,
  script text not null,
  perguntas_chave text[] not null default '{}',
  transicoes text[] not null default '{}',
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now()
);

create trigger playbook_atualizado_em
  before update on public.playbook
  for each row execute function public.set_atualizado_em();

create table public.objections (
  id uuid primary key default gen_random_uuid(),
  gatilho text not null,
  resposta_base text not null,
  fontes text[] not null default '{}',
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create trigger objections_atualizado_em
  before update on public.objections
  for each row execute function public.set_atualizado_em();
