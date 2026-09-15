update config
set valor = valor || jsonb_build_object('mensagem_anexo', '[data-test-id="file-attachment-wrapper"]')
where chave = 'seletores_hubspot';
