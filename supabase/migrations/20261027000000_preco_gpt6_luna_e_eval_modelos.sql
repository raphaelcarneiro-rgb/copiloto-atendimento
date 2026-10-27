-- Preço do gpt-6-luna e lista de modelos liberados para o eval do `suggest`.
-- Fonte: tabela de preços OpenAI (Standard, contexto curto) enviada pelo Raphael em 2026-10-27.
-- Preço de contexto longo não veio no print: fica nulo (o cálculo usa o curto).

insert into public.precos_modelo (
  modelo, vigente_desde,
  usd_por_1m_entrada, usd_por_1m_cache, usd_por_1m_cache_escrita, usd_por_1m_saida
) values
  ('gpt-6-luna', '2026-10-01', 0.10, 0.01, 0.125, 0.50)
on conflict (modelo, vigente_desde) do update set
  usd_por_1m_entrada = excluded.usd_por_1m_entrada,
  usd_por_1m_cache = excluded.usd_por_1m_cache,
  usd_por_1m_cache_escrita = excluded.usd_por_1m_cache_escrita,
  usd_por_1m_saida = excluded.usd_por_1m_saida;

-- `suggest` só aceita trocar o modelo por chamada (campo `modelo`, usado por
-- evals/suggest.mjs) se ele estiver nesta lista. Não muda o modelo de produção.
update public.config
set valor = valor || '{"eval_permitidos": ["gpt-5.6-luna", "gpt-6-luna"]}'::jsonb
where chave = 'modelos';
