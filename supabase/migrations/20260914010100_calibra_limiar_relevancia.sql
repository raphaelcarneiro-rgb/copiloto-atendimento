-- Etapa 3: calibrado com 16 perguntas-ouro (evals/perguntas.json, 2026-09-14).
-- Similaridade top1 de perguntas relevantes variou 0.412–0.832; perguntas
-- fora do domínio ficaram em 0.216–0.228. 0.32 é o ponto médio entre os
-- dois grupos, com boa margem de segurança dos dois lados.
update public.config
set valor = '0.32', descricao = 'Similaridade mínima p/ trecho relevante. Calibrado com evals/perguntas.json em 2026-09-14 (relevantes: 0.41–0.83; fora do domínio: 0.22–0.23).'
where chave = 'limiar_relevancia';
