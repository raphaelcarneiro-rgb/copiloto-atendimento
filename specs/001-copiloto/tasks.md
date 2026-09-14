# Tasks 001 — Copiloto de Atendimento

Legenda: `[x]` feito · `[ ]` a fazer · `[~]` depende do usuário

## Etapa 1 — Fundação
Requisitos: RF09, RF21 (estrutura), RF22 (config), constitution §4, §9.

- [x] 1.1 Artefatos SDD: constitution, spec, plan, tasks, contrato da sugestão
- [x] 1.2 Migration 0100: extensão `vector`, tipos enum, `config`, `config_valor()`
- [x] 1.3 Migration 0200: `profiles`, `sources`, `documents`, `chunks`, `facts`, `feriados`, `playbook`, `objections`
- [x] 1.4 Migration 0300: `knowledge_gaps`, `gap_proposals`, `faq_curada`, `precos_modelo`, `usage_logs` (+ cálculo de custo), `cost_alerts`
- [x] 1.5 Migration 0400: bloqueio de domínio e criação de perfil em `auth.users`
- [x] 1.6 Migration 0500: funções de papel + RLS em todas as tabelas
- [x] 1.7 Migration 0600: views de relatório (`security_invoker`)
- [x] 1.8 Migration 0700: seed de `config`, `precos_modelo` e `feriados`
- [x] 1.9 Script de verificação e guia de setup
- [x] 1.9b Migration 0800: preços OpenAI de set/2026 (cache write, contexto longo) e modelos `gpt-5.6-luna`
- [x] 1.10 Projeto `copiloto-atendimento` (ref `trtmyuqatmhvikfbqmkv`, org Infnet, sa-east-1). Migrations 0100–0700 rodadas pelo SQL Editor; 0800 aplicada pelo conector em 2026-09-13. Validado: 15 tabelas com RLS, 58 policies, 2 triggers em auth.users, 5 views, 18 configs, 23 feriados, custo 0.00248/0.00258, trigger de custo gravando US$ e R$
- [x] 1.10b Security Advisor: sobram apenas avisos aceitos (funções de papel e `config_valor` usadas pela RLS; `rls_auto_enable` é o event trigger de RLS automática do próprio Supabase)
- [x] 1.11 Google OAuth: projeto `copiloto-atendimento` no Google Cloud, público Interno, escopos `openid`/`email`/`profile`, cliente Web com callback do Supabase; provider Google ativo e Email desativado. Validado em 2026-09-13: login de raphael.carneiro@infnet.edu.br criou `profiles` como `admin`; nenhum usuário fora do domínio em `auth.users`
- [x] 1.12 Conector Supabase autorizado na organização Infnet (aplicar migrations, consultar e rodar advisors)

**Aceite da etapa 1**
- `verificacao_etapa1.sql`: todas as tabelas públicas com RLS ativo; 2 triggers em `auth.users`; `config` e `feriados` populados; `custo_estimado_usd('gpt-5-mini', 10000, 1000, 4000)` = 0.0036.
- Login com conta `@infnet.edu.br` cria `profiles` (Raphael como `admin`).
- Login com conta de outro domínio é recusado e não cria usuário.
- Security Advisor do Supabase sem alertas críticos.

## Etapa 2 — Ingestão ✅ fechada em 2026-09-14
- [x] Acesso ao Sheets/Drive via domain-wide delegation (Admin Console → Client ID `102223072074030067145`, escopos `spreadsheets.readonly` + `drive.readonly`, impersonando raphael.carneiro@infnet.edu.br) — ver [docs/setup/02-planilhas-fonte.md](../../docs/setup/02-planilhas-fonte.md)
- [x] Migration `documents_source_id_key` (um documento por fonte)
- [x] Edge Function `ingest` implantada (`supabase/functions/ingest`), com JWT RS256 próprio (sem SDK) para o Google e hash por fonte (RF08: só reprocessa quando muda). Parsers/handlers por tipo de fonte:
  - `sheet` + categoria `calendario_cursos` → `facts` (data/frequência/horário) + 1 chunk por curso
  - `sheet` + categoria `convenios` → chunks agrupados de 20 em 20 empresas
  - `sheet` + categoria `feriados` → substitui `public.feriados` por completo a cada sync (fonte única de verdade) + 1 chunk resumo
  - `pdf` com `ref="gdoc:<id>"` → exporta Google Doc via Drive API → chunking por parágrafo
  - `pdf` com `ref="storage:<bucket>/<path>"` → baixa do Supabase Storage (bucket privado `fontes-pdf`) → extrai texto com `unpdf` → chunking
  - `url` → busca a página, limpa o HTML, chunking
  - Chunking: ~800 tokens com 100 de sobreposição, contagem real via `gpt-tokenizer` (cl100k_base); embeddings em lote na OpenAI com custo registrado em `usage_logs`
- [x] Planilha "Calendário Infnet — Feriados" criada no Drive do Raphael (`1bu0o0d8fZKLhJuIc73CvTeDwrSO-5Tp6POX8CZyH0Hw`) com os 23 feriados existentes; virou a fonte oficial (RF14) — o seed manual da migration 0700 foi substituído
- [x] `pg_cron` + `pg_net` habilitadas; job `ingest-fontes-15min` agendado (`*/15 * * * *`), chamando a função com a anon key pública (não é segredo) e timeout de 120s
- [x] Bucket privado `fontes-pdf` no Storage, com RLS restrita a admin
- [x] Validado de ponta a ponta em 2026-09-14: 5/5 fontes `ok` (calendário de cursos, convênios, manual, feriados, + teste de URL descartável) — 115 facts de cursos, 23 feriados, 55 chunks, custo total < US$ 0,001
  - Correções encontradas no caminho: import `npm:gpt-tokenizer` sem subcaminho `/cl100k_base` (não resolvia no runtime); `.trim()` no `GOOGLE_IMPERSONATED_USER` (valor colado com tab quebrava a impersonação); escopo `drive.readonly` que faltava na delegação; API do Google Drive precisou ser ativada no Cloud Console
- [~] PDF do Storage implementado mas **não testado com arquivo real** (nenhum PDF foi enviado ainda) — validar assim que houver um PDF de verdade para subir ao bucket `fontes-pdf`
- [ ] Fonte `url` real (institucional) ainda não cadastrada em produção — só testada com uma URL descartável; cadastrar quando houver uma página específica da Infnet que valha a pena indexar

## Etapa 3 — Recuperação ✅ fechada em 2026-09-14
- [x] Função SQL `match_chunks` (busca híbrida: vetor pgvector + full-text `tsvector` em português, fundidos por RRF k=60; filtra por fontes ativas e por metadados via contenção jsonb)
  - Achado de implementação: `set search_path = 'a, b'` **entre aspas** vira um único nome de schema literal, não dois — quebra silenciosamente a resolução de operadores do pgvector. A sintaxe certa é sem aspas: `set search_path = a, b`.
- [x] Edge Function `search` (`supabase/functions/search`): embute a pergunta e chama `match_chunks` — usada pelos evals hoje, e será a base de `suggest`/`ask` na etapa 4
- [x] `evals/perguntas.json` (16 perguntas-ouro: 4 calendário, 3 convênios, 3 feriados, 4 playbook, 2 negativas fora do domínio) + `evals/run.mjs` (runner em Node, `npm run eval`)
- [x] Calibrado `limiar_relevancia` = 0.32 com dados reais: relevantes ficaram em 0.41–0.83 de similaridade; fora do domínio, 0.22–0.23 — boa separação
- [x] Resultado: 16/16 perguntas passaram (checando se a informação aparece em algum dos top-8 resultados, não só no 1º — é isso que a etapa 4 vai mandar como contexto para o LLM)
- [~] Comparar classificação de etapa por embedding (zero-shot) vs. `gpt-5.6-luna` — **adiado para a etapa 4**: a tabela `playbook` ainda está vazia (o Manual foi ingerido como texto corrido, não estruturado por etapa do funil), então não há "etapas" para classificar ainda. Revisitar quando o playbook por etapa existir.

## Etapa 4 — Ask ✅ (parcial — `suggest` adiado) fechada em 2026-09-14
- [x] Adapter OpenAI de chat com saída estruturada (`_shared/openai.ts::chatJSON`, JSON Schema com `strict: true`)
- [x] Edge Function `ask` (US3): busca híbrida → `facts` embutidos nos próprios chunks → prompt com contexto numerado por `chunk_id` → LLM (`gpt-5.6-luna`) → validação de citações (RF06) → registro de lacuna deduplicada (RF15/RF16) → `usage_logs` com custo (RF21)
- [x] `contracts/ask.schema.json`: `{resposta, fontes, encontrado, confianca}`
- [x] PII mascarado no backend antes de qualquer persistência (`_shared/pii.ts`) — defesa adicional; a extensão (etapa 5) também vai mascarar antes de sair do navegador
- [x] Validado com 6 cenários reais: pergunta objetiva (calendário), pergunta do playbook, pergunta fora da base (lacuna registrada), dedup de lacunas, PII mascarada antes de salvar
- [ ] Streaming — **adiado**: resposta estruturada (JSON Schema) hoje é validada de uma vez só; dá pra fazer streaming do texto puro depois com custo de perder a validação incremental. Baixa prioridade sem a extensão (etapa 5) para consumir.
- [~] `suggest` (US2, auto-sugestão a partir da conversa inteira, com classificação de etapa do playbook) — **adiado para depois da etapa 5/6**: precisa de conversas reais vindas da extensão e de um playbook estruturado por etapa (hoje só existe o Manual como texto corrido). A infraestrutura (`match_chunks`, `chatJSON`, validação de citações, lacunas, custo) já está pronta e será reaproveitada.

**3 bugs reais encontrados e corrigidos testando de ponta a ponta:**
1. `gpt-5.6-luna` rejeita `temperature` customizada (só aceita o padrão) — corrigido tornando o campo opcional no adapter.
2. **Citação errada mesmo com resposta certa:** o prompt numerava os trechos com `[1] (chunk_id=8) ...`, e o modelo citava o `[1]` (posição) em vez do `chunk_id=8` real — uma citação "válida" (existe no conjunto recuperado) mas que aponta pro trecho errado. RF06 não pega esse caso (só verifica se o ID existe, não se é o certo). Corrigido removendo a numeração dupla do prompt — só o `chunk_id` aparece, sem índice de posição.
3. **Limiar de dedup de lacunas era severo demais na prática:** duas perguntas com o mesmo sentido ("aceita dogecoin?" / "aceitam pagar com dogecoin?") tiveram só 0,783 de similaridade real — bem abaixo dos 0,90 do seed inicial. Recalibrado para 0,75 com base nesse teste real; revisar com mais dados na etapa 8.

## Etapa 5 — Extensão v0 ✅ (parcial — login e calibração real adiados) fechada em 2026-09-13
- [x] `extension/`: Vite + TS + MV3 (`@crxjs/vite-plugin`) com `key` fixa gerada localmente (par RSA real via `node:crypto`, não um valor inventado — chave privada em `extension/dev-key.pem`, fora do bundle)
- [x] Nova Edge Function `config` (RF22 + apoio a RF10-RF14): devolve `seletores_hubspot`, `expediente`, `lembrete_antecedencia_min`, `versao_minima`/`versao_atual` e feriados dos próximos 12 meses. Testada de verdade contra o projeto.
- [x] Leitor do DOM (`src/content/hubspot-reader.ts` + `src/content/parse-conversa.ts`): extrai `threadId` da URL (regex, documentado no plan), observa o container de mensagens via `MutationObserver` com debounce de 2s (RF02), só processa se a conversa estiver ativa (RF03), mascara PII antes de repassar ao side panel (RF04)
- [x] Botão flutuante "Ativar copiloto" — fixo no canto da tela, não depende de nenhum seletor calibrado (mais resiliente que injetar perto de uma barra de ferramentas do HubSpot)
- [x] Side panel v0 (`src/sidepanel/`): mostra a conversa extraída, aviso "não consegui ler esta conversa" quando os seletores não estão calibrados, aviso de versão abaixo da mínima (RF22)
- [x] Testes unitários do parser (`vitest` + `jsdom`, 5/5 passando) contra fixture sintética em `extension/fixtures/` — achado real: `querySelector` não pega a classe da própria bolha (`.from-visitor`), só de descendentes; corrigido checando `matches()` também
- [x] Build de produção validado (`npm run build` → `extension/dist/`, carregável via "Carregar sem compactação")
- [x] Seletores de produção calibrados em 2026-09-14 inspecionando uma conversa real de WhatsApp no inbox (thread 11173394035, portal 6010218), pelo Browser pane desta sessão — nunca chutamos valores. Achado bom: o HubSpot expõe `data-test-id` estáveis (`primary-message-visitor`, `primary-message-agent`, `primary-message-AUTOMATED`, `primary-message-content`, `sender-header-content-timestamp`, `virtualParentRef`), não depende das classes CSS geradas por styled-components (essas mudam a cada deploy). Validado ao vivo: 13/13 mensagens extraídas na ordem certa, autor e hora corretos. Ver migration `20260914030000_calibra_seletores_hubspot.sql`. Achado adicional: a lista é **virtualizada** (`virtualParentRef`) — só o trecho perto da área visível fica no DOM; aceitável para v0 (reagir a mensagens novas, RF02), mas não dá pra extrair o histórico inteiro de conversas longas de uma vez.
- [~] Login Google via `launchWebAuthFlow` — implementado o suficiente para funcionar sem sessão (usa a anon key pública, mesma do `pg_cron`), mas a ligação real com Supabase Auth depende de cadastrar a URL de redirect da extensão no dashboard **depois** que ela for carregada pela primeira vez (o ID da extensão só existe nesse momento) — ver docs/setup/04-extensao.md

**Achado de ferramenta (Supabase MCP):** `deploy_edge_function` só resolve `import "../_shared/x.ts"` do entrypoint se o arquivo compartilhado for enviado com o nome `"../_shared/x.ts"` (prefixo `../` literal) — `"_shared/x.ts"` falha silenciosamente com "module not found" mesmo apontando pro mesmo caminho final. Documentado aqui para não perder tempo de novo.

## Etapa 6 — Lembrete de janela (RF10–RF14)
- [ ] `business-hours.ts` + testes (casos da spec, incluindo quarta-feira de cinzas)
- [ ] `window-guard.ts` com alarms, notificações e badge

## Etapa 7 — Integração
- [ ] Painel ↔ suggest/ask; copiar/inserir; aviso de 24h; feedback

## Etapa 8 — Ciclo de aprendizado (RF15–RF20)
- [ ] Propostas no painel; Edge Function `gaps`; tela de Curadoria; publicação de FAQ; avisos; inclusão em evals

## Etapa 9 — Custo e relatórios (RF21–RF22)
- [ ] Página de Relatórios sobre as views; `cost-alert` por e-mail; limpeza de retenção

## Etapa 10 — Evals + piloto
- [ ] Rodar evals; piloto com 2 atendentes por 1 semana; medir lacunas, aceite e custo médio

## Etapa 11 — Distribuição
- [ ] Script de build/zip; pasta no Drive; manual de instalação e uso

## Dependências externas
- [~] Material comercial: roteiro por etapa, objeções, planilhas de preço/convênio (Raphael)
