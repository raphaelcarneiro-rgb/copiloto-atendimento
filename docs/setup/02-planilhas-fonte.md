# Setup 02 — Acesso do copiloto às planilhas (domain-wide delegation)

Guia para o **admin** (Raphael) sobre como o copiloto lê planilhas do Google Sheets como fonte de dados (etapa 2 — Ingestão).

## Como funciona (decisão final)

~~Inicialmente a ideia era compartilhar cada planilha manualmente com uma conta de serviço externa (`copiloto-sheets-reader@copiloto-atendimento.iam.gserviceaccount.com`).~~ Essa abordagem **não funcionou de forma confiável**: o Google passou a reverter silenciosamente compartilhamentos novos com essa identidade externa (mecanismo de proteção do Workspace/anti-abuso), mesmo com as configurações de compartilhamento externo liberadas no Admin Console.

**Solução adotada: delegação em todo o domínio (domain-wide delegation).**

A conta de serviço `copiloto-sheets-reader` foi autorizada, no Admin Console da Infnet, a **agir como se fosse o usuário `raphael.carneiro@infnet.edu.br`** (via "impersonation"), só para o escopo de leitura de planilhas:

```
https://www.googleapis.com/auth/spreadsheets.readonly
```

Configuração feita em 2026-09-13 em **Segurança → Controle de dados e acesso → Controles de API → Delegação em todo o domínio**:

| Nome | ID do cliente | Escopos |
|---|---|---|
| Copiloto de Atendimento | `102223072074030067145` | `.../auth/spreadsheets.readonly`, `.../auth/drive.readonly` |

> O escopo de Drive foi adicionado depois do teste inicial: a leitura do Manual de Boas Práticas (Google Doc, exportado via Drive API) falhava com `unauthorized_client` só com o escopo de planilhas. Os dois escopos ficam na mesma entrada do Client ID, separados por vírgula.

### O que isso significa na prática
- **Nenhuma planilha precisa ser compartilhada manualmente** com a conta de serviço.
- O copiloto enxerga qualquer planilha que **raphael.carneiro@infnet.edu.br já tenha acesso** (como proprietário, editor ou leitor) — bastando que a URL/ID da planilha seja cadastrado como fonte (tabela `sources`).
- O acesso é **somente leitura**. O copiloto nunca escreve nas planilhas.
- Se amanhã quisermos que o copiloto leia uma planilha que só outra pessoa tem acesso (ex.: Thayana), soluções possíveis: (a) compartilhar essa planilha com o Raphael também, ou (b) trocar o usuário impersonado (`subject`) na credencial da Edge Function.

## Implementação (etapa 2 — Ingestão)

Ao implementar a Edge Function `ingest` para Google Sheets, a biblioteca cliente do Google (`googleapis` ou `google-auth-library`) deve gerar o token JWT da conta de serviço com o campo `subject` (também chamado de `sub` ou "impersonated user") preenchido com:

```
raphael.carneiro@infnet.edu.br
```

A chave privada da conta de serviço (arquivo JSON baixado no Cloud Console) fica guardada como Secret na Edge Function, nunca em texto plano no repositório ou em planilhas.

## Planilhas cadastradas como fonte (atualizado 2026-09-16)

| Planilha | Uso | Status |
|---|---|---|
| Manual de Boas Práticas — Atendimento B2B WhatsApp (v3) | Playbook comercial (extração de texto do Google Doc) | ativa, sincronizando |
| Calendário das faculdades Infnet e ECDD | Datas de início de turmas + descoberta automática das páginas de curso (coluna "Mais Informações") | ativa, sincronizando |
| B2B \| Empresas Conveniadas (2023 em diante) | Lista de empresas conveniadas, incluindo % de desconto | ativa, sincronizando |
| Calendário Infnet — Feriados | Lembrete de 24h (RF10–RF14) | ativa — criada em 2026-09-14 (`1bu0o0d8fZKLhJuIc73CvTeDwrSO-5Tp6POX8CZyH0Hw`), **fonte única de verdade** — substituiu o seed manual da migration `20260913000700_seed_inicial.sql` |
| Copiloto \| Páginas Institucionais | Lista dedicada de URLs institucionais (convênio, admissão, sobre, como funciona) | ativa — 8 páginas indexadas |

Desde a Etapa 12 (2026-09-16), fontes do tipo arquivo (PDF/TXT/MD) ou URL avulsa também podem ser cadastradas direto pelo **portal admin** (`admin-portal/`, ver [07-portal-admin.md](07-portal-admin.md)), sem precisar de SQL manual nem de pedir pra mim. Planilhas do Google Sheets continuam precisando de cadastro manual em `sources` (domain-wide delegation, ver seção acima) — o portal não cobre esse tipo ainda.

## Como pegar o ID de uma planilha

É o trecho entre `/d/` e `/edit` na URL:
```
https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit
                                        └────────── ID ──────────┘
```

Quando uma nova planilha for identificada como fonte, avise para que seja cadastrada em `public.sources` (`tipo = 'sheet'`). A sincronização roda a cada 15 minutos depois de cadastrada (RF08).

## Adicionando uma coluna nova numa planilha já cadastrada

O parser (`supabase/functions/ingest/parsers.ts`) só lê as colunas que conhece pelo nome do cabeçalho — uma coluna nova na planilha não aparece na base sozinha, precisa de uma pequena mudança de código:

1. Adicione a coluna na planilha, com um nome de cabeçalho claro (ex.: "% Desconto Convênio").
2. Avise o nome exato do cabeçalho — o parser normaliza (minúsculas, sem acento) mas precisa saber a chave.
3. O código é ajustado para ler essa coluna e incluir no texto do chunk (nunca em `facts` para valores que não sejam curso/data — hoje só `calendario_cursos` e `feriados` alimentam `facts`; `convenios` vira só chunk, mas ainda assim é dado estruturado, não texto livre inventado).
4. Redeploy do `ingest` + forçar uma sincronização (`POST /ingest {"source_id": "..."}`) — do contrário só reflete na próxima edição real da planilha, porque a sincronização normal só reprocessa quando o **conteúdo da planilha** muda, não quando o código muda.

Exemplo real (2026-09-14): coluna "% Desconto Convênio" adicionada à planilha de convênios para o copiloto responder sobre desconto. Achado no caminho: a célula já vinha com "%" na string (ex. "10%"), e o código também acrescentava um — corrigido para não duplicar.

## Páginas de curso indexadas automaticamente via o calendário

A planilha "Calendário das faculdades Infnet e ECDD" já tinha uma coluna "Mais Informações" com um link "Clique Aqui" por curso — decidimos (2026-09-14) usar essa planilha como **fonte oficial da lista de páginas de curso**, em vez de criar uma planilha separada só para isso.

Como funciona:
- O texto da célula ("Clique Aqui") não é a URL — é só o rótulo de um link do tipo `=HYPERLINK(url, texto)`. A API de valores (`values.get`) não devolve isso; foi preciso usar `spreadsheets.get` com `includeGridData=true` para pegar o `hyperlink` de cada célula (`_shared/google_sheets.ts::getSheetHyperlinksGrid`).
- Cada curso com link vira (ou atualiza) sozinho uma fonte `tipo='url'`, `categoria='pagina_curso'` em `sources` — sem precisar de SQL manual.
- O pipeline de URL que já existia (`ingestUrlSource`) busca a página, extrai o texto (confirmado: páginas de curso são HTML estático, não SPA — extração limpa, sem JavaScript) e reindexa sozinho a cada 15 min, só quando o conteúdo realmente mudar.
- Curso removido da planilha → a fonte correspondente é desativada (não apagada) — para de aparecer em buscas (`match_chunks` filtra por `sources.ativo`), mas o histórico fica no banco.

**Na prática, para o admin:** um curso novo = uma linha nova na planilha, com link na coluna "Mais Informações". Em até ~30 min (dois ciclos de 15 min: um para registrar a fonte, outro para buscar o conteúdo) o copiloto já responde sobre ele com base na página real — disciplinas, descrição, tudo. Atualizar a página no site também atualiza o copiloto sozinho, sem nenhuma ação manual.
