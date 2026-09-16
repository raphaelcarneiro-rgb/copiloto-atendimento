# Setup 03 — Segredos e teste da função `ingest`

A função `ingest` (Etapa 2) já está implantada no projeto Supabase (`trtmyuqatmhvikfbqmkv`). Faltam 3 segredos para ela funcionar.

## 1. Cadastrar os Secrets

No dashboard do Supabase: **Edge Functions → Secrets** (ou **Project Settings → Edge Functions**). Os segredos são compartilhados por todas as funções do projeto.

| Nome | Valor |
|---|---|
| `OPENAI_API_KEY` | sua chave da OpenAI |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | conteúdo **completo** do arquivo JSON baixado no Cloud Console (Setup 01, passo "Gerar a chave da conta de serviço") — cole o JSON inteiro como uma linha só |
| `GOOGLE_IMPERSONATED_USER` | `raphael.carneiro@infnet.edu.br` |

Nunca cole esses valores no chat com o Claude — só no dashboard do Supabase.

## 2. Testar manualmente

A função exige autenticação (`verify_jwt=true`). Para testar como admin, use a **service_role key** do projeto (Project Settings → API → `service_role` — secreta, não compartilhe).

```bash
curl -X POST "https://trtmyuqatmhvikfbqmkv.supabase.co/functions/v1/ingest" \
  -H "Authorization: Bearer SUA_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{}"
```

Resposta esperada (resumida):
```json
{
  "results": [
    { "source": "Calendário das faculdades Infnet e ECDD", "status": "ok", "chunks": 35, "facts": 90 },
    { "source": "B2B | Empresas Conveniadas (2023 em diante)", "status": "ok", "chunks": 8 },
    { "source": "Manual de Boas Práticas — Atendimento B2B WhatsApp (v3)", "status": "ok", "chunks": 4 }
  ]
}
```

Rodar de novo imediatamente deve retornar `"status": "sem_alteracao"` para as três (nada mudou desde a última sincronização).

## 3. Onde conferir o resultado

No SQL Editor do Supabase:
```sql
select nome, status, erro, ultima_sync from public.sources order by nome;
select count(*) from public.chunks;
select curso, atributo, valor from public.facts order by curso, atributo limit 20;
select tipo_chamada, modelo, tokens_entrada, custo_usd, custo_brl from public.usage_logs order by criado_em desc limit 10;
```

## Se der erro

- **"GOOGLE_SERVICE_ACCOUNT_KEY não é um JSON válido"**: o valor colado no Secret não é o JSON completo, ou tem quebras de linha problemáticas. Copie o arquivo `.json` inteiro, sem editar.
- **"Falha ao obter token Google (403)"**: a delegação em todo o domínio (Setup 01) não está configurada, ou o escopo cadastrado no Admin Console não bate exatamente com `https://www.googleapis.com/auth/spreadsheets.readonly` ou `.../drive.readonly`. Duas delegações são necessárias: uma para cada escopo, ou uma única entrada com os dois escopos separados por vírgula.
- **"planilha sem abas" / "nenhum curso encontrado"**: a estrutura da planilha mudou. O parser está em `supabase/functions/ingest/parsers.ts`.

## Agendamento automático (já em produção)

A função roda sozinha a cada 15 minutos via `pg_cron` (job `ingest-fontes-15min`). Para conferir:
```sql
select jobid, jobname, schedule, active from cron.job;
select * from net._http_response order by created desc limit 5; -- últimas chamadas HTTP do pg_net
```
Não é preciso mais chamar manualmente — só use o `curl` acima para depurar um erro específico.

## Fontes suportadas hoje (atualizado 2026-09-16)

| Tipo | `ref` | Uso |
|---|---|---|
| `sheet` | ID da planilha | categoria `calendario_cursos`, `convenios`, `feriados` ou `lista_urls` |
| `pdf` | `gdoc:<id do Google Doc>` | exporta o Doc como texto via Drive API |
| `pdf` | `storage:<bucket>/<caminho>` | baixa do bucket privado `fontes-pdf` e extrai texto (`unpdf`) — **ainda sem teste com um arquivo PDF real enviado** (nenhum PDF de verdade chegou ao bucket até agora) |
| `arquivo` (Etapa 12) | `storage:fontes-pdf/<caminho>` | PDF, TXT ou MD, decidido pela extensão do arquivo — cadastrado pelo **portal admin** (`admin-portal/`), não precisa mais de SQL manual nem de mim |
| `url` | a URL | busca a página e limpa o HTML |
| `faq` | (sem `ref` de arquivo) | gerada automaticamente quando o curador aprova uma lacuna como FAQ (`gaps` → `faq_curada`) — nunca cadastrada manualmente |

**Pra adicionar um PDF/TXT/MD hoje, use o portal admin** (mais simples, dispara a indexação na hora) em vez do `insert` manual abaixo — mas o caminho manual continua funcionando, útil pra depurar:
```sql
insert into public.sources (tipo, ref, nome, categoria) values
  ('arquivo', 'storage:fontes-pdf/nome-do-arquivo.pdf', 'Nome legível', 'categoria-livre');
-- depois, force a indexação sem esperar o cron de 15 min:
-- POST /functions/v1/ingest {"source_id": "<id gerado acima>"}
```
