-- Etapa 8 (adiantada): roteiro comercial estruturado por etapa, fornecido
-- pelo Raphael em 2026-09-14 (Manual de Boas Práticas — Atendimento B2B
-- WhatsApp, 6 passos). Isso é o que faltava para `suggest` classificar a
-- etapa de verdade em vez do placeholder "nao_classificado" — a
-- classificação (`etapa_atual`) é feita pelo LLM lendo a conversa, mas
-- restrita aos valores reais desta tabela (enum no JSON Schema), e o texto
-- do script devolvido ao atendente vem sempre desta tabela, nunca
-- inventado pelo modelo.
--
-- Ordem sugerida, mas não obrigatória — o Raphael foi explícito: "não
-- necessariamente nessa ordem, mas sempre que um atendimento iniciar,
-- precisamos tentar seguir esse roteiro".
insert into public.playbook (etapa, ordem, objetivo, script, perguntas_chave, transicoes) values
(
  'descoberta', 1,
  'Entender quem é a pessoa e qual o momento dela.',
  'Descubra quem é a pessoa e qual o momento dela: o que ela busca, se já conhece a Infnet, se está comparando opções, se tem urgência.',
  array['Como posso te chamar?', 'O que te trouxe até aqui hoje?', 'Você já conhecia a Infnet?'],
  array['qualificacao_empresa', 'apresentacao_curso_preco']
),
(
  'qualificacao_empresa', 2,
  'Coletar nome da empresa, nível de convênio e desconto de direito.',
  'Pergunte em qual empresa a pessoa trabalha e confirme o nível de convênio dela na base — isso define o desconto de direito antes de apresentar qualquer preço.',
  array['Em qual empresa você trabalha?', 'Essa empresa tem convênio com a Infnet?'],
  array['apresentacao_curso_preco']
),
(
  'apresentacao_curso_preco', 3,
  'Apresentar o curso e o preço completo, em texto, com valor final calculado.',
  'Apresente o curso de forma completa, em texto, com o valor final já calculado (considerando o desconto de convênio, se houver) — nunca deixe o cálculo para o lead fazer.',
  array['Você tem alguma dúvida sobre o conteúdo do curso?', 'O valor está dentro do que você esperava?'],
  array['tratamento_objecao', 'fechamento']
),
(
  'tratamento_objecao', 4,
  'Tratar objeções sempre oferecendo uma saída, nunca só um "não".',
  'Ao receber uma objeção, nunca responda só com uma negativa — sempre ofereça uma saída (outra condição, outro prazo, encaminhar para quem resolve).',
  array['O que especificamente te preocupa nessa decisão?', 'Se resolvermos esse ponto, você seguiria com a matrícula?'],
  array['fechamento', 'follow_up']
),
(
  'fechamento', 5,
  'Fazer um pedido direto e explícito de fechamento.',
  'Feche com um pedido direto e explícito — não deixe a decisão apenas implícita, peça a confirmação da matrícula claramente.',
  array['Posso seguir com sua matrícula agora?', 'Vamos confirmar sua vaga?'],
  array['follow_up']
),
(
  'follow_up', 6,
  'Retomar o que ficou em aberto.',
  'No follow-up, retome exatamente o que ficou em aberto na última troca — não comece do zero.',
  array['Ficou alguma dúvida sobre o que conversamos?', 'Conseguiu pensar sobre a proposta?'],
  array['tratamento_objecao', 'fechamento']
)
on conflict (etapa) do update set
  ordem = excluded.ordem,
  objetivo = excluded.objetivo,
  script = excluded.script,
  perguntas_chave = excluded.perguntas_chave,
  transicoes = excluded.transicoes;
