-- Achado real (Raphael, 2026-09-15): o link do cabeçalho da conversa
-- ("de {empresa}"/"Cargo @ {empresa}") às vezes reflete um campo de texto
-- livre do CONTATO ("Nome da empresa"), não a Empresa de verdade associada
-- via CRM — testado com um contato onde os dois divergiam (cabeçalho dizia
-- "Stefanini", a Empresa associada de verdade era "Theós Sistemas"). Troca
-- pro chicklet da seção "Empresas" da barra lateral, que reflete a
-- associação real (mesmo HTML real já usado pra calibrar isso antes).
update config
set valor = valor || jsonb_build_object('empresa_associada', '[data-test-id="company-chicklet-title-link"]')
where chave = 'seletores_hubspot';
