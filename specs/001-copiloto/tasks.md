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

## Etapa 2 — Ingestão
- [x] Acesso ao Sheets via domain-wide delegation configurado (Admin Console → Client ID `102223072074030067145`, escopo `spreadsheets.readonly`, impersonando raphael.carneiro@infnet.edu.br) — ver [docs/setup/02-planilhas-fonte.md](../../docs/setup/02-planilhas-fonte.md)
- [x] Migration `documents_source_id_key` (um documento por fonte) e seed das 3 fontes iniciais (`calendario_cursos`, `convenios`, `playbook`)
- [x] Edge Function `ingest` implantada (`supabase/functions/ingest`): JWT RS256 próprio (sem SDK) para o token do Google com `subject` impersonado; parsers dedicados para o Calendário (→ `facts` + chunks) e Empresas Conveniadas (→ chunks agrupados de 20 em 20); exportação do Manual (Google Doc) via Drive API → chunking por parágrafo (~800 tokens, 100 de sobreposição, contagem real via `gpt-tokenizer`/cl100k_base); embeddings em lote na OpenAI com registro em `usage_logs`
- [x] Secrets configurados e primeira sincronização validada (2026-09-14): 3/3 fontes `ok`, 115 facts, 54 chunks, custo ~US$ 0,0004
  - Correções feitas no caminho: import `npm:gpt-tokenizer` sem subcaminho `/cl100k_base` (não resolvia no runtime); `.trim()` no `GOOGLE_IMPERSONATED_USER` (valor colado com tab causava "Invalid impersonation sub field"); escopo `drive.readonly` somado ao `spreadsheets.readonly` na delegação (Google Doc do Manual precisa de Drive, não só Sheets); API do Google Drive ativada no Cloud Console (só a do Sheets estava ativa)
- [ ] `pg_cron`/`pg_net` chamando `ingest` a cada 15 min (RF08) — depende do passo acima estar validado
- [ ] PDF de verdade no Storage (`ref="storage:<path>"`) e fontes tipo `url` — ainda não implementados; hoje só `sheet` e `pdf` com `ref="gdoc:"`
- [ ] Planilha própria de feriados (fonte estruturada) — feriados hoje só existem via seed manual (migration 0700)
- [ ] PDF de verdade no Storage e URL → chunks (~800 tokens, sobreposição 100), contando tokens com `cl100k_base` — código de `chunkText` já pronto e reaproveitável
- [ ] `pg_cron` + `pg_net`: Sheets a cada 15 min, PDF/URL diariamente
- [ ] Registro de custo de embeddings em `usage_logs`
- [ ] Planilha "Calendário Infnet" como fonte de `feriados`

## Etapa 3 — Recuperação
- [ ] Função SQL `match_chunks` (vetor + FTS + RRF, filtro por metadados)
- [ ] Calibrar `limiar_relevancia`
- [ ] Comparar nos evals: classificação de etapa por embedding (zero-shot) vs. `gpt-5.6-luna`
- [ ] `evals/` com perguntas-ouro e runner

## Etapa 4 — Suggest / Ask
- [ ] Adapter OpenAI com uso de tokens
- [ ] Prompt com prefixo estável, JSON Schema, temperatura baixa
- [ ] Validação de citações (RF06), registro de lacunas (RF15/RF16)
- [ ] Streaming e `usage_logs`

## Etapa 5 — Extensão v0
- [ ] Vite + TS + MV3 com `key` fixa
- [ ] Login Google via `launchWebAuthFlow`
- [ ] Leitor do DOM com seletores remotos + fixture HTML
- [ ] Botão "Ativar copiloto", side panel mostrando a conversa extraída
- [ ] Checagem de versão (RF22)

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
