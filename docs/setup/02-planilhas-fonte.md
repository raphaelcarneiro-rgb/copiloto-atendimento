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
| Copiloto de Atendimento | `102223072074030067145` | `.../auth/spreadsheets.readonly` |

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

## Planilhas já identificadas como fonte

| Planilha | Uso | Acesso do Raphael | Status |
|---|---|---|---|
| Manual de Boas Práticas — Atendimento B2B WhatsApp (v3) | Playbook comercial (via extração de texto, não Sheets API — é um Google Doc) | proprietário | pronto para ingestão de documento |
| Calendário das faculdades Infnet e ECDD | Datas de início de turmas | proprietário | pronto para ingestão de planilha |
| B2B \| Empresas Conveniadas (2023 em diante) | Lista de empresas conveniadas | organizador (Drive Compartilhado) | pronto para ingestão de planilha |
| Calendário Infnet (feriados) | Lembrete de 24h (RF10–RF14) | a criar | pendente — ver nota abaixo |

**Nota sobre feriados:** o calendário de feriados (nacionais, RJ, 15/10) ainda precisa virar uma planilha própria (ou aba dedicada) para ser sincronizado como fonte estruturada (`feriados`). Os 23 feriados já estão no banco via seed manual (migration `20260913000700_seed_inicial.sql`); a planilha serve para facilitar manutenção contínua sem precisar de SQL.

## Como pegar o ID de uma planilha

É o trecho entre `/d/` e `/edit` na URL:
```
https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit
                                        └────────── ID ──────────┘
```

Quando uma nova planilha for identificada como fonte, avise para que seja cadastrada em `public.sources` (`tipo = 'sheet'`). A sincronização roda a cada 15 minutos depois de cadastrada (RF08).
