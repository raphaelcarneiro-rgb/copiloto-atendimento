-- RF08: fontes ativas sincronizadas a cada 15 minutos.
-- O Bearer usado é a "anon key" pública do projeto (não é segredo — é a
-- mesma chave usada em qualquer app cliente). A função ingest usa a
-- service_role internamente (Secrets da Edge Function), não a role do
-- chamador; verify_jwt só exige QUALQUER JWT válido do projeto.
select cron.schedule(
  'ingest-fontes-15min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://trtmyuqatmhvikfbqmkv.supabase.co/functions/v1/ingest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRydG15dXFhdG1odmlrZmJxbWt2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzMzA0NTUsImV4cCI6MjEwNDkwNjQ1NX0.A1Wj9uzSgYxngeFBXAa-mtP9Xx4QMwl1r2a0F8VjiLU'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
