// Mesmo padrão da extensão (extension/src/lib/supabase-config.ts): a anon
// key é pública por design do Supabase (a proteção real é RLS +
// resolverChamador nas Edge Functions), então não há problema em embutir
// isso no bundle publicado.
export const SUPABASE_URL = "https://trtmyuqatmhvikfbqmkv.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRydG15dXFhdG1odmlrZmJxbWt2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzMzA0NTUsImV4cCI6MjEwNDkwNjQ1NX0.A1Wj9uzSgYxngeFBXAa-mtP9Xx4QMwl1r2a0F8VjiLU";
