-- Etapa 5: RF22 / constitution §6. Seletores calibrados inspecionando uma
-- conversa real de WhatsApp no inbox (thread 11173394035, portal 6010218)
-- em 2026-09-14. Usam `data-test-id`, não classes CSS geradas por
-- styled-components (essas mudam a cada deploy do HubSpot; os
-- `data-test-id` são atributos de teste internos do HubSpot, muito mais
-- estáveis).
--
-- Confirmado nessa conversa: `virtualParentRef` é uma lista VIRTUALIZADA —
-- só as mensagens perto da área visível ficam no DOM. Para conversas longas,
-- o leitor só vê um trecho recente, não o histórico inteiro. Aceitável para
-- v0 (o objetivo é reagir a mensagens novas, RF02), mas registrar aqui para
-- não reaparecer como "bug" mais tarde.
update public.config
set valor = '{
  "container_mensagens": "[data-test-id=\"virtualParentRef\"]",
  "mensagem": "[data-test-id=\"primary-message-visitor\"], [data-test-id=\"primary-message-agent\"], [data-test-id=\"primary-message-AUTOMATED\"]",
  "mensagem_texto": "[data-test-id=\"primary-message-content\"]",
  "mensagem_autor_lead": "[data-test-id=\"primary-message-visitor\"]",
  "mensagem_hora": "[data-test-id=\"sender-header-content-timestamp\"]"
}'::jsonb,
    descricao = 'Calibrado em 2026-09-14 inspecionando uma conversa real de WhatsApp (thread 11173394035). Usa data-test-id do HubSpot, não classes CSS geradas (essas mudam a cada deploy). Revisar se o HubSpot atualizar o inbox e os data-test-id sumirem.'
where chave = 'seletores_hubspot';
