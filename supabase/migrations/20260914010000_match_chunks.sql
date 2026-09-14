-- Etapa 3 — busca híbrida (RF05/RF06 dependem disto): combina similaridade
-- vetorial (pgvector, embedding cosine) com busca textual (tsvector em
-- português) via Reciprocal Rank Fusion (RRF), constante k=60 (valor usual
-- na literatura de IR, pouco sensível a ajuste fino).
--
-- Filtra por fontes ativas e, opcionalmente, por um filtro de metadados
-- (contenção jsonb) — ex.: {"curso": "MBA em Engenharia de Dados..."}.

create or replace function public.match_chunks(
  query_embedding extensions.vector(1536),
  query_text text default '',
  match_count integer default 8,
  filtro jsonb default '{}'::jsonb
)
returns table (
  chunk_id bigint,
  document_id uuid,
  conteudo text,
  metadados jsonb,
  similaridade double precision,
  rrf_score double precision
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with vetor as (
    select c.id,
           row_number() over (order by c.embedding <=> query_embedding) as rank,
           1 - (c.embedding <=> query_embedding) as similaridade
    from public.chunks c
    join public.documents d on d.id = c.document_id
    join public.sources s on s.id = d.source_id
    where s.ativo
      and c.embedding is not null
      and (filtro = '{}'::jsonb or c.metadados @> filtro)
    order by c.embedding <=> query_embedding
    limit greatest(match_count * 4, 40)
  ),
  texto as (
    select c.id,
           row_number() over (
             order by ts_rank_cd(c.fts, websearch_to_tsquery('portuguese', query_text)) desc
           ) as rank
    from public.chunks c
    join public.documents d on d.id = c.document_id
    join public.sources s on s.id = d.source_id
    where s.ativo
      and query_text is not null and btrim(query_text) <> ''
      and c.fts @@ websearch_to_tsquery('portuguese', query_text)
      and (filtro = '{}'::jsonb or c.metadados @> filtro)
    order by rank
    limit greatest(match_count * 4, 40)
  ),
  fundido as (
    select coalesce(v.id, t.id) as id,
           coalesce(1.0 / (60 + v.rank), 0) + coalesce(1.0 / (60 + t.rank), 0) as rrf_score,
           v.similaridade
    from vetor v
    full outer join texto t on t.id = v.id
  )
  select
    c.id as chunk_id,
    c.document_id,
    c.conteudo,
    c.metadados,
    coalesce(f.similaridade, 0)::double precision as similaridade,
    f.rrf_score::double precision
  from fundido f
  join public.chunks c on c.id = f.id
  order by f.rrf_score desc
  limit match_count
$$;

revoke execute on function public.match_chunks(extensions.vector, text, integer, jsonb) from public, anon;
grant execute on function public.match_chunks(extensions.vector, text, integer, jsonb) to authenticated, service_role;
