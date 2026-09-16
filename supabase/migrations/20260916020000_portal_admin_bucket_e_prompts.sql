-- Etapa 12/13 — bucket público de auto-update da extensão (usado só na
-- Etapa 13, preparado aqui) e prompts editáveis via portal admin (Etapa 12).
-- Pedido do Raphael, 2026-09-16.

-- Bucket público: hospeda updates.xml + o .crx assinado (Etapa 13). Público
-- de propósito — é o próprio mecanismo de auto-update do Chrome que precisa
-- buscar esses arquivos sem nenhuma autenticação.
insert into storage.buckets (id, name, public)
values ('extension-updates', 'extension-updates', true)
on conflict (id) do nothing;

create policy extension_updates_public_select on storage.objects
  for select to public
  using (bucket_id = 'extension-updates');

create policy extension_updates_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'extension-updates' and (select public.eh_admin()));

create policy extension_updates_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'extension-updates' and (select public.eh_admin()));

create policy extension_updates_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'extension-updates' and (select public.eh_admin()));

-- Rastreabilidade: quem editou um prompt pela última vez.
alter table public.config add column if not exists atualizado_por uuid references auth.users(id);

-- Trechos de prompt editáveis pelo portal admin (Edge Function `admin-config`),
-- com o texto atual do código como valor inicial — não muda nenhum
-- comportamento no dia do deploy. O núcleo anti-alucinação (citação por
-- chunk_id, JSON Schema, validação RF06, filtro de incerteza PADRAO_INCERTEZA)
-- continua fixo no código de propósito (Constitution §1) — não é exposto aqui.
insert into public.config (chave, valor, descricao) values
  (
    'prompt_tom_geral',
    to_jsonb('Seja direto e objetivo, em português do Brasil, como uma mensagem de WhatsApp de atendimento comercial.'::text),
    'Tom geral, usado no fim do prompt tanto do suggest quanto do ask.'
  ),
  (
    'prompt_suggest_abertura_resposta',
    to_jsonb('Você vê a conversa recente. Uma ou mais mensagens do FINAL da conversa são do lead e ainda não foram respondidas — tente cobrir TODAS elas na mesma sugestão, quando fizer sentido, não só a última.'::text),
    'Instrução de abertura do suggest no modo "resposta" (reagindo a mensagem do lead).'
  ),
  (
    'prompt_suggest_abertura_followup',
    to_jsonb('Você vê a conversa recente. O ATENDENTE mandou a última mensagem e o lead ainda não respondeu — sua tarefa é sugerir de 1 a 2 mensagens curtas de FOLLOW-UP (reengajamento), não uma resposta a uma pergunta nova. Não repita a mesma pergunta/mensagem já enviada; ofereça algo levemente diferente pra reengajar (ex.: reforçar um benefício já discutido, perguntar objetivamente se ficou alguma dúvida, retomar o próximo passo natural do roteiro). NUNCA invente prazo, desconto ou urgência que não esteja fundamentada nos trechos do contexto ou já dita na conversa.'::text),
    'Instrução de abertura do suggest no modo "follow_up".'
  ),
  (
    'prompt_suggest_fechamento_resposta',
    to_jsonb('Se nenhuma mensagem do lead pedir informação (ex.: só um agradecimento), devolva a lista de sugestões vazia.'::text),
    'Instrução final do suggest no modo "resposta".'
  ),
  (
    'prompt_suggest_fechamento_followup',
    to_jsonb('Sempre gere pelo menos 1 sugestão de follow-up nesse modo, mesmo que a última mensagem do lead pareça encerrar o assunto (ex.: um agradecimento) — o objetivo aqui é reengajar quem parou de responder.'::text),
    'Instrução final do suggest no modo "follow_up".'
  ),
  (
    'prompt_ask_instrucoes',
    to_jsonb('Nunca invente preço, data, duração ou qualquer dado — use apenas o que está escrito nos trechos.'::text),
    'Instrução extra específica do ask, além do núcleo fixo no código.'
  )
on conflict (chave) do nothing;
