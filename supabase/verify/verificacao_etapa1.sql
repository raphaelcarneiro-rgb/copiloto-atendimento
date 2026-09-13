-- Verificação da Etapa 1 (somente leitura). Rode cada bloco no SQL Editor.

-- 1. Todas as tabelas públicas devem ter RLS ativo (esperado: 15 linhas, rls_ativo = true)
select c.relname as tabela, c.relrowsecurity as rls_ativo
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by 1;

-- 2. Policies por tabela
select tablename, count(*) as policies, string_agg(cmd, ', ' order by cmd) as comandos
from pg_policies
where schemaname = 'public'
group by tablename
order by tablename;

-- 3. Triggers em auth.users (esperado: bloquear_dominio_externo e criar_profile)
select tgname
from pg_trigger
where tgrelid = 'auth.users'::regclass and not tgisinternal
order by tgname;

-- 4. Configuração e calendário (esperado: 18 chaves; 23 feriados de 2026-10-12 a 2027-12-25)
select chave, valor from public.config order by chave;
select count(*) as feriados, min(data) as primeiro, max(data) as ultimo from public.feriados;

-- 5. Cálculo de custo com gpt-5.6-luna (após a migration 0800)
--    a) esperado 0.00248 → (6000×0,20 + 4000×0,02 + 1000×1,20) / 1M
--    b) esperado 0.00258 → (4000×0,20 + 4000×0,02 + 2000×0,25 + 1000×1,20) / 1M
select public.custo_estimado_usd('gpt-5.6-luna', 10000, 1000, 4000)       as a_custo_usd,
       public.custo_estimado_usd('gpt-5.6-luna', 10000, 1000, 4000, 2000) as b_custo_usd_com_cache_escrita;

-- 6. Domínio permitido (esperado: infnet.edu.br)
select public.dominio_permitido();

-- 7. Depois do primeiro login: perfis criados (Raphael deve ser admin)
select email, nome, papel, ativo, criado_em from public.profiles order by criado_em;
