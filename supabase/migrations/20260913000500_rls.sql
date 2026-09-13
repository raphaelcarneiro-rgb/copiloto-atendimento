-- Etapa 1 · 0500 — papéis e Row Level Security
-- Plan: "Segurança e acesso" · Constitution §9

-- Funções de papel (security definer evita recursão de RLS em profiles)
create or replace function public.papel_atual()
returns public.papel
language sql
stable
security definer
set search_path = ''
as $$
  select p.papel
  from public.profiles p
  where p.user_id = (select auth.uid())
    and p.ativo
$$;

create or replace function public.eh_membro()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.papel_atual() is not null
$$;

create or replace function public.eh_curador()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.papel_atual() in ('curador', 'admin'), false)
$$;

create or replace function public.eh_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.papel_atual() = 'admin', false)
$$;

revoke execute on function public.papel_atual() from public, anon;
revoke execute on function public.eh_membro() from public, anon;
revoke execute on function public.eh_curador() from public, anon;
revoke execute on function public.eh_admin() from public, anon;
grant execute on function public.papel_atual(), public.eh_membro(), public.eh_curador(), public.eh_admin() to authenticated;

-- RLS em todas as tabelas; anon não acessa nada
alter table public.profiles       enable row level security;
alter table public.config         enable row level security;
alter table public.sources        enable row level security;
alter table public.documents      enable row level security;
alter table public.chunks         enable row level security;
alter table public.facts          enable row level security;
alter table public.feriados       enable row level security;
alter table public.playbook       enable row level security;
alter table public.objections     enable row level security;
alter table public.knowledge_gaps enable row level security;
alter table public.gap_proposals  enable row level security;
alter table public.faq_curada     enable row level security;
alter table public.precos_modelo  enable row level security;
alter table public.usage_logs     enable row level security;
alter table public.cost_alerts    enable row level security;

revoke all on
  public.profiles, public.config, public.sources, public.documents, public.chunks,
  public.facts, public.feriados, public.playbook, public.objections,
  public.knowledge_gaps, public.gap_proposals, public.faq_curada,
  public.precos_modelo, public.usage_logs, public.cost_alerts
from anon;

-- profiles: cada um vê o próprio; admin vê e altera todos
create policy profiles_select on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.eh_admin()));

create policy profiles_update_admin on public.profiles
  for update to authenticated
  using ((select public.eh_admin()))
  with check ((select public.eh_admin()));

-- Base de conhecimento e configuração: membros leem, admin escreve
do $$
declare
  t text;
begin
  foreach t in array array['config', 'sources', 'documents', 'chunks', 'facts', 'feriados', 'playbook', 'objections'] loop
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

-- knowledge_gaps: membros leem e registram; curador trata; admin apaga
create policy knowledge_gaps_select on public.knowledge_gaps
  for select to authenticated
  using ((select public.eh_membro()));

create policy knowledge_gaps_insert on public.knowledge_gaps
  for insert to authenticated
  with check ((select public.eh_membro()));

create policy knowledge_gaps_update_curador on public.knowledge_gaps
  for update to authenticated
  using ((select public.eh_curador()))
  with check ((select public.eh_curador()));

create policy knowledge_gaps_delete_admin on public.knowledge_gaps
  for delete to authenticated
  using ((select public.eh_admin()));

-- gap_proposals: autor vê as próprias; curador vê e trata todas
create policy gap_proposals_select on public.gap_proposals
  for select to authenticated
  using (
    (select public.eh_membro())
    and (user_id = (select auth.uid()) or (select public.eh_curador()))
  );

create policy gap_proposals_insert on public.gap_proposals
  for insert to authenticated
  with check ((select public.eh_membro()) and user_id = (select auth.uid()));

create policy gap_proposals_update_curador on public.gap_proposals
  for update to authenticated
  using ((select public.eh_curador()))
  with check ((select public.eh_curador()));

create policy gap_proposals_delete_curador on public.gap_proposals
  for delete to authenticated
  using ((select public.eh_curador()));

-- faq_curada: membros leem; curador escreve
create policy faq_curada_select on public.faq_curada
  for select to authenticated
  using ((select public.eh_membro()));

create policy faq_curada_insert_curador on public.faq_curada
  for insert to authenticated
  with check ((select public.eh_curador()));

create policy faq_curada_update_curador on public.faq_curada
  for update to authenticated
  using ((select public.eh_curador()))
  with check ((select public.eh_curador()));

create policy faq_curada_delete_curador on public.faq_curada
  for delete to authenticated
  using ((select public.eh_curador()));

-- Custo: só admin lê; atendente pode registrar o próprio uso, mas não ver
do $$
declare
  t text;
begin
  foreach t in array array['precos_modelo', 'cost_alerts'] loop
    execute format(
      'create policy %1$s_select_admin on public.%1$I for select to authenticated using ((select public.eh_admin()))', t);
    execute format(
      'create policy %1$s_insert_admin on public.%1$I for insert to authenticated with check ((select public.eh_admin()))', t);
    execute format(
      'create policy %1$s_update_admin on public.%1$I for update to authenticated using ((select public.eh_admin())) with check ((select public.eh_admin()))', t);
    execute format(
      'create policy %1$s_delete_admin on public.%1$I for delete to authenticated using ((select public.eh_admin()))', t);
  end loop;
end;
$$;

create policy usage_logs_select_admin on public.usage_logs
  for select to authenticated
  using ((select public.eh_admin()));

create policy usage_logs_insert_proprio on public.usage_logs
  for insert to authenticated
  with check ((select public.eh_membro()) and user_id = (select auth.uid()));

create policy usage_logs_update_admin on public.usage_logs
  for update to authenticated
  using ((select public.eh_admin()))
  with check ((select public.eh_admin()));

create policy usage_logs_delete_admin on public.usage_logs
  for delete to authenticated
  using ((select public.eh_admin()));
