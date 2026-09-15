update config
set valor = valor || jsonb_build_object('transcricao', 'gpt-4o-mini-transcribe')
where chave = 'modelos';
