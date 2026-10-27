-- Troca o modelo de chat e de classificação para gpt-6-luna (decisão do Raphael, 2026-10-27).
-- Eval do suggest (evals/suggest.mjs, 15 casos dos prints x 3 repetições): gpt-5.6-luna 44/45,
-- gpt-6-luna 43/45, custo médio por sugestão US$ 0,0017 -> US$ 0,0009 (-48%).
-- Para voltar: trocar "chat"/"classificacao" pelo valor de "chat_anterior" (só config, sem deploy).

update public.config
set valor = valor || '{"chat": "gpt-6-luna", "classificacao": "gpt-6-luna", "chat_anterior": "gpt-5.6-luna"}'::jsonb,
    descricao = 'Modelos OpenAI por uso. chat_anterior = modelo para voltar se o gpt-6-luna piorar. eval_permitidos = modelos aceitos no campo "modelo" do suggest (evals/suggest.mjs).'
where chave = 'modelos';
