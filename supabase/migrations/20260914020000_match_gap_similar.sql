-- Etapa 4 — RF16: deduplicação de lacunas por similaridade de embedding.
-- Retorna a lacuna aberta/em_curadoria mais parecida acima do limiar, se
-- houver, para o `ask` incrementar a contagem em vez de criar duplicata.
create or replace function public.match_gap_similar(
  query_embedding extensions.vector(1536),
  limiar double precision default 0.90
)
returns table (id uuid, similaridade double precision)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select g.id, (1 - (g.embedding <=> query_embedding))::double precision as similaridade
  from public.knowledge_gaps g
  where g.status in ('aberta', 'em_curadoria')
    and g.embedding is not null
    and 1 - (g.embedding <=> query_embedding) >= limiar
  order by g.embedding <=> query_embedding
  limit 1
$$;

revoke execute on function public.match_gap_similar(extensions.vector, double precision) from public, anon;
grant execute on function public.match_gap_similar(extensions.vector, double precision) to authenticated, service_role;
