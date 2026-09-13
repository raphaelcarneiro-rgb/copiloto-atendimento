-- Etapa 2 · 1000 — cadastro das 3 primeiras fontes (Google Sheets/Docs)
-- Acesso via domain-wide delegation (ver docs/setup/02-planilhas-fonte.md);
-- nenhuma precisa ser compartilhada manualmente com a conta de serviço.
--
-- `ref` para tipo='sheet' é o ID da planilha.
-- `ref` para tipo='pdf' usa o prefixo "gdoc:" quando a fonte é um Google Doc
-- lido via Drive API (export text/plain), em vez de um PDF no Storage.

insert into public.sources (tipo, ref, nome, categoria, ativo) values
  ('sheet', '1OXUG0_dE8E8C4O-n0X8yXjcC9pJBU_bHLj09j9q_Ow0', 'Calendário das faculdades Infnet e ECDD', 'calendario_cursos', true),
  ('sheet', '110YUAP5qPXIM_w3kPvNo3X6kUDX-fJNbmi1uHhB4wYA', 'B2B | Empresas Conveniadas (2023 em diante)', 'convenios', true),
  ('pdf',   'gdoc:1izqCNg5buD6F7ty7euSdp3wEclXB1IV8mINgmFdJcf0', 'Manual de Boas Práticas — Atendimento B2B WhatsApp (v3)', 'playbook', true)
on conflict (tipo, ref) do nothing;
