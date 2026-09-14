-- Etapa 2 — bucket privado para PDFs enviados como fonte (ref="storage:<path>")
insert into storage.buckets (id, name, public)
values ('fontes-pdf', 'fontes-pdf', false)
on conflict (id) do nothing;

-- Só admin gerencia; leitura também restrita a admin (a Edge Function usa
-- a service role, que ignora RLS).
create policy fontes_pdf_admin_select on storage.objects
  for select to authenticated
  using (bucket_id = 'fontes-pdf' and (select public.eh_admin()));

create policy fontes_pdf_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'fontes-pdf' and (select public.eh_admin()));

create policy fontes_pdf_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'fontes-pdf' and (select public.eh_admin()));

create policy fontes_pdf_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'fontes-pdf' and (select public.eh_admin()));
