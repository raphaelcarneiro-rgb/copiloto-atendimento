-- Etapa 4: RF16 (dedup de lacunas). Calibrado com um teste real em
-- 2026-09-14: duas paráfrases da mesma pergunta ("a Infnet aceita
-- pagamento com criptomoeda dogecoin?" / "vocês aceitam pagar com
-- dogecoin?") deram 0.783 de similaridade. 0.90 e 0.80 nunca
-- deduplicariam esse caso real; 0.75 dá uma margem de segurança abaixo
-- do valor medido. Revisar com mais dados reais na etapa 8 (curadoria).
update public.config
set valor = '0.75', descricao = 'Similaridade p/ agrupar lacunas parecidas (RF16). Calibrado em 2026-09-14: paráfrase real deu 0.783; 0.90 e 0.80 eram severos demais. Revisar na etapa 8.'
where chave = 'limiar_dedup';
