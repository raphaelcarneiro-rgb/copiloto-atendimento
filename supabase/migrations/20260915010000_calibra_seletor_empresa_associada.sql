update config
set valor = valor || jsonb_build_object('empresa_associada', '[data-test-id="inbox-header-company-link"]')
where chave = 'seletores_hubspot';
