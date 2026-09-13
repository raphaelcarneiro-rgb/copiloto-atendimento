# Setup 02 — Compartilhar planilhas com o copiloto

Guia para o **admin** (Raphael) liberar uma planilha do Google Sheets como fonte de dados do copiloto (etapa 2 — Ingestão). Sem esse compartilhamento, a Edge Function `ingest` não consegue ler a planilha.

## Conta de serviço

O copiloto lê planilhas por meio de uma conta de serviço do Google Cloud, criada no projeto `copiloto-atendimento`:

```
copiloto-sheets-reader@copiloto-atendimento.iam.gserviceaccount.com
```

Esse e-mail não é secreto — é só um identificador. A chave privada dessa conta fica guardada nos Secrets do Supabase, nunca em planilhas ou documentos.

## Como compartilhar uma planilha

1. Abra a planilha no Google Sheets (ex.: "Calendário Infnet", planilha de preços, planilha de convênios).
2. Clique em **Compartilhar** (canto superior direito).
3. Em "Adicionar pessoas e grupos", cole o e-mail:
   ```
   copiloto-sheets-reader@copiloto-atendimento.iam.gserviceaccount.com
   ```
4. No papel de acesso, deixe como **Leitor** (o copiloto nunca precisa escrever na planilha).
5. Desmarque "Notificar pessoas" (é uma conta de serviço, não lê e-mail).
6. Clique em **Enviar** (ou **Compartilhar**).

## Planilhas que devem ser compartilhadas

| Planilha | Uso | Status |
|---|---|---|
| Calendário Infnet | Feriados (lembrete de 24h) | a criar/compartilhar |
| Preços e convênios | Valores de cursos, descontos | a criar/compartilhar |
| Roteiro/objeções (se em planilha) | Playbook comercial | a definir formato |

Atualize esta tabela conforme novas planilhas forem cadastradas como fonte (ver `sources` no banco).

## Depois de compartilhar

Avise para que o `id` (URL) da planilha seja cadastrado na tabela `public.sources` (`tipo = 'sheet'`, `ref` = ID da planilha). A sincronização roda a cada 15 minutos depois de cadastrada (RF08).

Para pegar o ID da planilha: é o trecho entre `/d/` e `/edit` na URL, por exemplo:
```
https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit
                                        └────────── ID ──────────┘
```
