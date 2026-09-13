-- Etapa 1 · 0700 — dados iniciais
-- Idempotente: não sobrescreve valores já editados pelo admin.
-- CONFERIR antes de produção: preços da OpenAI (platform.openai.com/pricing) e cotação do dólar.

insert into public.config (chave, valor, descricao) values
  ('dominio_permitido',        '"infnet.edu.br"',                                   'Único domínio de e-mail aceito no login'),
  ('admin_emails',             '["raphael.carneiro@infnet.edu.br"]',                'E-mails que nascem com papel admin'),
  ('email_gestor',             '"raphael.carneiro@infnet.edu.br"',                  'Destinatário dos alertas de custo'),
  ('expediente',               '{"dias": [1, 2, 3, 4, 5], "inicio": "09:00", "fim": "19:00", "fuso": "America/Sao_Paulo"}', 'Seg–sex, almoço incluso'),
  ('lembrete_antecedencia_min','120',                                               'Antecedência do lembrete da janela de 24h'),
  ('modelos',                  '{"chat": "gpt-5-mini", "classificacao": "gpt-5-nano", "embedding": "text-embedding-3-small"}', 'Modelos OpenAI por uso (conferir disponibilidade)'),
  ('embedding_dimensoes',      '1536',                                              'Deve bater com vector(1536) em chunks e knowledge_gaps'),
  ('limiar_relevancia',        '0.35',                                              'Similaridade mínima para considerar um trecho relevante (calibrar na etapa 3)'),
  ('limiar_dedup',             '0.90',                                              'Similaridade para agrupar lacunas'),
  ('limiar_destaque_lacuna',   '5',                                                 'Ocorrências para destacar lacuna na curadoria'),
  ('cotacao_usd_brl',          '5.40',                                              'Cotação usada no custo em R$ (atualizar mensalmente)'),
  ('teto_custo_mensal_brl',    '100',                                               'Teto mensal de custo de IA'),
  ('alertas_custo',            '[0.8, 1.0]',                                        'Frações do teto que disparam alerta'),
  ('retencao_meses',           '18',                                                'Retenção de usage_logs, lacunas e propostas'),
  ('versao_minima',            '"0.1.0"',                                           'Abaixo desta versão a extensão se desativa'),
  ('versao_atual',             '"0.1.0"',                                           'Versão publicada no Drive'),
  ('link_pasta_drive',         '""',                                                'Pasta do Google Drive com o zip e o manual'),
  ('seletores_hubspot',        '{}',                                                'Seletores CSS do inbox (preenchidos na etapa 5)')
on conflict (chave) do nothing;

-- Preços em US$ por 1M de tokens (referência pública da OpenAI; conferir)
insert into public.precos_modelo (modelo, vigente_desde, usd_por_1m_entrada, usd_por_1m_saida, usd_por_1m_cache) values
  ('gpt-5-mini',             '2026-09-01', 0.250000, 2.000000, 0.025000),
  ('gpt-5-nano',             '2026-09-01', 0.050000, 0.400000, 0.005000),
  ('text-embedding-3-small', '2026-09-01', 0.020000, 0.000000, null)
on conflict (modelo, vigente_desde) do nothing;

-- Calendário inicial (depois passa a vir da planilha "Calendário Infnet")
insert into public.feriados (data, nome, tipo, conta_como_folga, observacao) values
  ('2026-10-12', 'Nossa Senhora Aparecida',                      'nacional',      true, null),
  ('2026-10-15', 'Dia do Professor',                             'institucional', true, null),
  ('2026-11-02', 'Finados',                                      'nacional',      true, null),
  ('2026-11-15', 'Proclamação da República',                     'nacional',      true, 'domingo'),
  ('2026-11-20', 'Dia Nacional de Zumbi e da Consciência Negra', 'nacional',      true, null),
  ('2026-12-25', 'Natal',                                        'nacional',      true, null),
  ('2027-01-01', 'Confraternização Universal',                   'nacional',      true, null),
  ('2027-01-20', 'São Sebastião',                                'municipal',     true, 'Rio de Janeiro'),
  ('2027-02-08', 'Carnaval (segunda-feira)',                     'facultativo',   true, null),
  ('2027-02-09', 'Carnaval (terça-feira)',                       'estadual',      true, 'RJ'),
  ('2027-02-10', 'Quarta-feira de Cinzas',                       'institucional', true, 'Retorno na quinta-feira'),
  ('2027-03-26', 'Sexta-feira Santa',                            'nacional',      true, null),
  ('2027-04-21', 'Tiradentes',                                   'nacional',      true, null),
  ('2027-04-23', 'São Jorge',                                    'estadual',      true, 'RJ'),
  ('2027-05-01', 'Dia do Trabalho',                              'nacional',      true, 'sábado'),
  ('2027-05-27', 'Corpus Christi',                               'facultativo',   true, null),
  ('2027-09-07', 'Independência do Brasil',                      'nacional',      true, null),
  ('2027-10-12', 'Nossa Senhora Aparecida',                      'nacional',      true, null),
  ('2027-10-15', 'Dia do Professor',                             'institucional', true, null),
  ('2027-11-02', 'Finados',                                      'nacional',      true, null),
  ('2027-11-15', 'Proclamação da República',                     'nacional',      true, null),
  ('2027-11-20', 'Dia Nacional de Zumbi e da Consciência Negra', 'nacional',      true, 'sábado'),
  ('2027-12-25', 'Natal',                                        'nacional',      true, 'sábado')
on conflict (data, nome) do nothing;
