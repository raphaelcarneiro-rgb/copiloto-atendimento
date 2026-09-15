update config
set valor = valor || jsonb_build_object(
  'nome_lead', '[data-test-id="known-contact-info-highlight"]',
  'estado_lead', '[data-selenium-test="property-input-state"]'
)
where chave = 'seletores_hubspot';
