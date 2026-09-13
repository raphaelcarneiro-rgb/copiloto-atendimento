-- Etapa 1 · 0400 — login restrito a @infnet.edu.br e criação de perfil
-- Spec: RF09 · Constitution §9
-- Camadas: (1) app OAuth Google "Internal", (2) este trigger, (3) check em profiles.email

create or replace function public.dominio_permitido()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(coalesce(public.config_valor('dominio_permitido') #>> '{}', 'infnet.edu.br'))
$$;

-- Recusa criação (ou troca de e-mail) de usuários fora do domínio
create or replace function public.auth_bloquear_dominio_externo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is null or lower(split_part(new.email, '@', 2)) <> public.dominio_permitido() then
    raise exception 'Acesso restrito a contas @%', public.dominio_permitido()
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger bloquear_dominio_externo
  before insert or update of email on auth.users
  for each row execute function public.auth_bloquear_dominio_externo();

-- Cria o perfil no primeiro login; e-mails em config.admin_emails nascem admin
create or replace function public.auth_criar_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin boolean;
begin
  select exists (
    select 1
    from jsonb_array_elements_text(coalesce(public.config_valor('admin_emails'), '[]'::jsonb)) as e(email)
    where lower(e.email) = lower(new.email)
  ) into v_admin;

  insert into public.profiles (user_id, email, nome, papel)
  values (
    new.id,
    lower(new.email),
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)
    ),
    case when v_admin then 'admin'::public.papel else 'atendente'::public.papel end
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create trigger criar_profile
  after insert on auth.users
  for each row execute function public.auth_criar_profile();

revoke execute on function public.dominio_permitido() from public, anon;
revoke execute on function public.auth_bloquear_dominio_externo() from public, anon, authenticated;
revoke execute on function public.auth_criar_profile() from public, anon, authenticated;
