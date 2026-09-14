// Constantes do projeto Supabase, compartilhadas entre api.ts e auth.ts
// (evita import circular entre os dois). A anon key é pública por design
// do Supabase (equivalente a uma chave de projeto, não a um segredo — o
// mesmo valor já é usado pelo job pg_cron).
export const SUPABASE_URL = "https://trtmyuqatmhvikfbqmkv.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRydG15dXFhdG1odmlrZmJxbWt2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzMzA0NTUsImV4cCI6MjEwNDkwNjQ1NX0.A1Wj9uzSgYxngeFBXAa-mtP9Xx4QMwl1r2a0F8VjiLU";
