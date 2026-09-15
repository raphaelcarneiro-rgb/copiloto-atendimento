-- Suporte a transcrição de áudio (pedido do Raphael, 2026-09-15): nota de
-- voz de WhatsApp hoje só vira um marcador "[Áudio enviado]" — vamos
-- transcrever de verdade com gpt-4o-mini-transcribe (mais barato entre os
-- não-realtime, ~US$0,003/min, confirmado contra a tabela oficial de preços).
alter type tipo_chamada add value if not exists 'transcricao';

-- usd_por_minuto: fallback pra quando a API não devolver `usage` com
-- contagem de tokens de áudio (formato ainda não confirmado em produção) —
-- nesse caso o custo é estimado por duração em vez de tokens.
alter table precos_modelo add column if not exists usd_por_minuto numeric;

insert into precos_modelo (modelo, vigente_desde, usd_por_1m_entrada, usd_por_1m_saida, usd_por_minuto)
values ('gpt-4o-mini-transcribe', current_date, 1.25, 5.00, 0.003)
on conflict (modelo, vigente_desde) do update
  set usd_por_1m_entrada = excluded.usd_por_1m_entrada,
      usd_por_1m_saida = excluded.usd_por_1m_saida,
      usd_por_minuto = excluded.usd_por_minuto;
