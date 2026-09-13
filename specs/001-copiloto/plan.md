# Plan 001 — Copiloto de Atendimento

Como a [spec](spec.md) será construída. Mudanças de arquitetura atualizam este arquivo antes do código.

## Arquitetura

```
[HubSpot inbox] ──content script (só se ativo)──► [Side Panel React] ◄── [Service worker: window-guard]
                                                         │ JWT Supabase
                                                         ▼
                              [Edge Functions: config / suggest / ask / gaps / ingest / cost-alert]
                                     │                                 │
                                     ▼                                 ▼
             [Postgres: pgvector + FTS + tabelas estruturadas + RLS]   [OpenAI: chat + embeddings]
                                     ▲
                    [pg_cron] ── Sheets / PDF / URL / FAQ curada
                                     ▲
                        [Página admin: Curadoria + Relatórios]
```

## Componentes

### Extensão (Chrome MV3, TypeScript + Vite) — `extension/`
| Módulo | Responsabilidade |
|---|---|
| `manifest.json` | `side_panel`, `storage`, `identity`, `alarms`, `notifications`; hosts: `app.hubspot.com` e a URL do Supabase; `key` fixa para ID estável |
| `content/hubspot-reader.ts` | `threadId` da URL; `MutationObserver` nas mensagens → `{autor, texto, hora}`; detecta tarja de 24h; injeta "Ativar copiloto"; seletores de `/config` |
| `content/composer.ts` | Insere texto no campo de resposta |
| `sidepanel/` | Etapa, script, sugestões, chat livre, janelas expirando, lacunas, avisos de versão |
| `background/window-guard.ts` | Estado das conversas ativas, `chrome.alarms`, notificações, badge |
| `lib/business-hours.ts` | `isBusinessTime`, `lastBusinessMomentBefore`, `reminderSchedule` (funções puras) |
| `lib/pii.ts` | Mascaramento de telefone, e-mail, CPF |
| `lib/api.ts` | Cliente autenticado (Supabase Auth via `chrome.identity.launchWebAuthFlow`) |

### Backend (Supabase) — `supabase/`
**Modelo de dados** (migrations em `supabase/migrations/`):

| Grupo | Tabelas |
|---|---|
| Acesso | `profiles` (papel, ativo) |
| Configuração | `config` (chave → jsonb) |
| Base de conhecimento | `sources`, `documents`, `chunks` (vector 1536 + tsvector português), `facts`, `feriados`, `playbook`, `objections` |
| Aprendizado | `knowledge_gaps`, `gap_proposals`, `faq_curada` |
| Custo | `precos_modelo`, `usage_logs`, `cost_alerts` |
| Relatórios (views) | `vw_custo_por_conversa`, `vw_custo_por_atendente`, `vw_custo_diario`, `vw_custo_mensal`, `vw_lacunas_abertas` |

**Edge Functions** (etapas 2–9):
- `config`: seletores, expediente, antecedência, feriados dos próximos 12 meses, versões.
- `suggest` / `ask`:
  1. classificação da etapa (modelo barato);
  2. busca híbrida (vetor + FTS, RRF, top 8);
  3. `facts`/`feriados`;
  4. prompt com prefixo estável;
  5. saída JSON Schema;
  6. validação de citações;
  7. registro de lacunas;
  8. `usage_logs`.
- `gaps`: propostas (atendente); fila, classificação e aprovação (curador).
- `ingest`: Sheets (service account), PDF (Storage), URL, FAQ → `facts`/`feriados`/`chunks`; só reprocessa quando o hash muda.
- `cost-alert`: e-mail ao gestor em 80% e 100% do teto, uma vez por limiar/mês (`cost_alerts`).

**pg_cron:**
- Sheets e FAQ: a cada 15 min.
- URLs e PDFs: diariamente.
- FAQs vencidas: diariamente.
- `cost-alert`: a cada hora.
- Retenção de 18 meses: mensalmente.

## Segurança e acesso
- **Login:** Google OAuth via Supabase Auth, com três camadas:
  1. app OAuth do Google Cloud do tipo **Internal** (só contas do Workspace Infnet);
  2. trigger `before insert or update of email on auth.users` que rejeita domínios diferentes de `config.dominio_permitido`;
  3. `check` de domínio em `profiles.email`.
- **Perfil:** criado por trigger no primeiro login. E-mails em `config.admin_emails` nascem `admin`; os demais nascem `atendente`.
- **RLS em todas as tabelas públicas.** Funções auxiliares `security definer` com `search_path` vazio: `papel_atual()`, `eh_membro()`, `eh_curador()`, `eh_admin()`.

| Tabela | Leitura | Escrita |
|---|---|---|
| `profiles` | própria linha; admin todas | admin (papel/ativo) |
| `config`, `sources`, `documents`, `chunks`, `facts`, `feriados`, `playbook`, `objections` | membros | admin |
| `knowledge_gaps` | membros | insert membros; update curador; delete admin |
| `gap_proposals` | própria ou curador | insert do próprio usuário; update/delete curador |
| `faq_curada` | membros | curador |
| `precos_modelo`, `cost_alerts` | admin | admin |
| `usage_logs` | admin | insert do próprio usuário; update/delete admin |

- Views com `security_invoker = true`: herdam a RLS, então custo só é visível para admin.
- Edge Functions usam a service role apenas no servidor; a chave da OpenAI fica em segredo das funções.

## Custo
- **Modelos do MVP:** `gpt-5.6-luna` para chat e classificação (US$ 0,20 entrada / 0,02 cache / 0,25 escrita em cache / 1,20 saída por 1M tokens). `gpt-5.6-terra` fica como alternativa, se os evals exigirem. Embeddings: `text-embedding-3-small`.
- **Estimativa:** uma sugestão com ~6k tokens de entrada e ~500 de saída custa ~US$ 0,0018 no luna, contra ~US$ 0,018 no terra. O teto de R$ 100 comporta dezenas de milhares de sugestões no luna e ~1 mil no terra.
- `usage_logs.tokens_entrada` inclui os tokens lidos do cache (`tokens_cache`) e os gravados em cache (`tokens_cache_escrita`).
- O trigger `usage_logs_custo` calcula `custo_usd` com `custo_estimado_usd()` (preço vigente na data; contexto longo quando `limite_contexto_curto_tokens` estiver definido) e `custo_brl` com a cotação de `config` no momento do registro.
- Não usamos endpoints de residência de dados (acréscimo de 10%) nem Fast mode.
- **Economia:**
  - modelo barato para classificação;
  - top 8 chunks;
  - prefixo de prompt estável (cache);
  - reprocessar só em mensagem do lead;
  - embeddings só quando o hash muda.

## Embeddings
Referência: guia "Vector embeddings" da OpenAI (cópia recebida em 2026-09-13).
- **Modelo:** `text-embedding-3-small`, 1536 dimensões por padrão, igual a `vector(1536)` no banco.
- **Preço confirmado:** 62.500 páginas de ~800 tokens por US$ 1, ou seja, US$ 0,02 por 1M tokens (bate com `precos_modelo`).
- **Tamanho máximo:** 8.192 tokens por texto. Nossos chunks de ~800 tokens ficam bem abaixo. Contagem de tokens com o encoding `cl100k_base`.
- **Chamadas em lote:** enviar vários chunks num único request (input em array). `usage.prompt_tokens` vai para `usage_logs.tokens_entrada`.
- **Vetores normalizados (norma 1):** similaridade de cosseno e produto interno dão o mesmo ranking. Mantemos `vector_cosine_ops` pela clareza; trocar para `vector_ip_ops` é otimização possível se a base crescer.
- **Parâmetro `dimensions`:** não reduzir por enquanto. Com ~6 KB por chunk, 10 mil chunks ocupam ~60 MB, dentro do plano Free (500 MB).
- **Limite de conhecimento:** os modelos v3 não conhecem fatos posteriores a set/2021. Pouco impacto na busca, mas siglas ou nomes de cursos novos podem casar pior; a busca full-text (FTS) cobre esse caso na busca híbrida.
- **Uso extra que avaliaremos:** classificar a etapa da conversa sem gastar chamada de chat, comparando o embedding das últimas mensagens com as descrições das etapas do playbook ("zero-shot"). Só adotar se os evals mostrarem acurácia equivalente à do `gpt-5.6-luna`.

## Lembrete de 24h (regras de cálculo)
- Expediente: dias 1–5, 09:00–19:00, sem pausa de almoço, excluindo `feriados.conta_como_folga`.
- `ultimoMomentoUtil` = maior instante de expediente ≤ `expiraEm`. Se for anterior a `ultimaMsgLead`, a conversa fica "sem janela útil".
- Notificação em `min(expiraEm, ultimoMomentoUtil) − 120 min`, nunca antes de `ultimaMsgLead`.

## Distribuição
- Build gera `copiloto-infnet-vX.Y.Z.zip`, publicado na pasta do Google Drive da equipe.
- Manual em `docs/manual`.
- `config.versao_minima`/`versao_atual` controlam os avisos de atualização.

## Riscos
| Risco | Mitigação |
|---|---|
| HubSpot muda o DOM | Seletores remotos + aviso de degradação + fixture de teste |
| Alucinação | Validação de citações, dados estruturados, evals na CI |
| Estouro de custo | Medição por chamada, alertas 80/100%, cache e debounce |
| Projeto Supabase Free pausado por inatividade | Uso diário no piloto; migrar para Pro se necessário |
| Preço/cotação desatualizados | `precos_modelo` e `cotacao_usd_brl` editáveis pelo admin; conferência mensal com o painel da OpenAI |
