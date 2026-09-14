-- Etapa 2 — feriados passam a vir da planilha "Calendário Infnet — Feriados"
-- (criada em 2026-09-14 no Drive do Raphael), não mais do seed manual.
insert into public.sources (tipo, ref, nome, categoria, ativo) values
  ('sheet', '1bu0o0d8fZKLhJuIc73CvTeDwrSO-5Tp6POX8CZyH0Hw', 'Calendário Infnet — Feriados', 'feriados', true)
on conflict (tipo, ref) do nothing;
