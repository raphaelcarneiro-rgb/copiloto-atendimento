-- Etapa 9 (RF21/RF22): pg_cron pra cost-alert (a cada hora, checa 80%/100%
-- do teto e nunca repete o mesmo alerta no mesmo mes — dedup em
-- cost_alerts) e limpeza mensal por retencao (usage_logs, knowledge_gaps
-- descartadas e gap_proposals mais velhos que config.retencao_meses).

select cron.schedule(
  'cost-alert-hora',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://trtmyuqatmhvikfbqmkv.supabase.co/functions/v1/cost-alert',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRydG15dXFhdG1odmlrZmJxbWt2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzMzA0NTUsImV4cCI6MjEwNDkwNjQ1NX0.A1Wj9uzSgYxngeFBXAa-mtP9Xx4QMwl1r2a0F8VjiLU'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

create or replace function public.limpar_retencao() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  meses int;
  corte timestamptz;
begin
  select (valor #>> '{}')::int into meses from public.config where chave = 'retencao_meses';
  if meses is null then
    meses := 18;
  end if;
  corte := now() - (meses || ' months')::interval;

  delete from public.usage_logs where criado_em < corte;
  delete from public.gap_proposals where criado_em < corte;
  delete from public.knowledge_gaps where status = 'descartada' and coalesce(resolvido_em, ultima_vez) < corte;
end;
$$;

select cron.schedule(
  'retencao-mensal',
  '30 3 1 * *', -- dia 1 de cada mes, 03:30 (baixo trafego)
  $$ select public.limpar_retencao(); $$
);
