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

### Extensão (Chrome MV3, TypeScript + Vite) — `extension/` — **construída e testada ao vivo no HubSpot real desde 2026-09-14**
| Módulo | Responsabilidade | Status |
|---|---|---|
| `manifest.json` | `side_panel`, `background` (service worker), `content_scripts` em `app.hubspot.com/live-messages/*`; `key` RSA fixa para ID estável | ✅ |
| `content/hubspot-reader.ts` | `threadId` da URL (regex); `MutationObserver` nas mensagens (`childList`+`characterData`+`attributes` — a lista do HubSpot é virtualizada e recicla nós) → `{autor, texto, hora}`; injeta botão flutuante "Ativar copiloto" (`position:fixed`, sem depender de seletor) | ✅ |
| `content/composer.ts` | Insere texto no campo de resposta via `document.execCommand('insertText', ...)` (ProseMirror não aceita `.textContent` direto) | ✅ |
| `sidepanel/` | Conversa extraída, sugestões automáticas (etapa do roteiro, script, perguntas, lacunas), chat livre (`ask`), feedback | ✅ |
| `background/service-worker.ts` | Abre o side panel; retransmite mensagens do content script pro side panel (que não recebe `onMessage` de aba diretamente) | ✅ (parcial — `window-guard`/alarms da etapa 6 ainda não existem) |
| `lib/business-hours.ts` | `isBusinessTime`, `lastBusinessMomentBefore`, `reminderSchedule` (funções puras) | ⏳ etapa 6 |
| `lib/pii.ts`, `lib/hash.ts` | Mascaramento de telefone/e-mail/CPF; hash SHA-256 do `threadId` (nunca envia o id real do HubSpot ao backend) | ✅ |
| `lib/api.ts` | Cliente das Edge Functions com a anon key pública; JWT de usuário anexado quando existir sessão (`chrome.identity.launchWebAuthFlow` ainda não conectado — funciona hoje sem login, RLS aberta pela anon key) | ✅ (parcial — login real adiado) |

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

**Acesso ao Google Sheets:** via *domain-wide delegation* (não compartilhamento manual por arquivo — ver [docs/setup/02-planilhas-fonte.md](../../docs/setup/02-planilhas-fonte.md) para o histórico da decisão). A conta de serviço `copiloto-sheets-reader` está autorizada no Admin Console da Infnet (Client ID `102223072074030067145`, escopo `spreadsheets.readonly`) a impersonar `raphael.carneiro@infnet.edu.br`. A Edge Function `ingest` gera o JWT da conta de serviço com `subject = raphael.carneiro@infnet.edu.br`, o que dá acesso de leitura a qualquer planilha que esse usuário já tenha, sem precisar compartilhar cada arquivo individualmente.

**Edge Functions** (etapas 2–9):
- `config`: seletores, expediente, antecedência, feriados dos próximos 12 meses, versões. CORS habilitado (`_shared/cors.ts`) — chamada direto do content script/side panel, então precisa responder `OPTIONS` sem exigir JWT.
- `suggest` (implementado 2026-09-14) / `ask` (implementado):
  1. embute a(s) mensagem(ns) sem resposta e busca híbrida (vetor + FTS, RRF) — `suggest` roda uma busca por **cada** mensagem do lead ainda sem resposta (não só a última nem todas juntas num embedding só — ver "achados" no `tasks.md`, etapa 8) mais uma busca do contexto amplo, e junta os candidatos por `chunk_id`/maior similaridade;
  2. `facts`/`feriados` (hoje só `feriados` é consultado de fato; preço de curso ainda não está em `facts` — ver "Dívida" abaixo);
  3. prompt com prefixo estável, incluindo o roteiro completo do `playbook` no `suggest`;
  4. saída JSON Schema — `suggest` também classifica `etapa_atual`, restrito por `enum` às etapas reais da tabela `playbook`; o texto do script devolvido vem sempre da tabela, nunca do LLM;
  5. validação de citações (RF06);
  6. registro de lacunas;
  7. `usage_logs` (retorna `usage_log_id` para o `feedback` linkar).
- `feedback` (implementado): `POST {usage_log_id, aceita?, feedback?, feedback_motivo?}` — atualiza a linha correspondente em `usage_logs` (sem tabela nova).
- `gaps`: propostas (atendente); fila, classificação e aprovação (curador). **Não implementado ainda** (etapa 8 restante).
- `ingest`: Sheets (service account), PDF (Storage), URL, FAQ → `facts`/`feriados`/`chunks`; só reprocessa quando o hash muda. Ganhou um caminho genérico de **lista de URLs** (`sources.categoria = 'lista_urls'`, planilha só com colunas URL/Nome) que registra/desativa uma `source` tipo `url` por linha — reaproveitado também para as páginas de curso descobertas automaticamente a partir do link "Mais Informações" da planilha de calendário (via `spreadsheets.get?includeGridData=true`, porque `values.get` só devolve o texto visível da fórmula `HYPERLINK`, não a URL real).
- `cost-alert`: e-mail ao gestor em 80% e 100% do teto, uma vez por limiar/mês (`cost_alerts`). **Não implementado ainda** (etapa 9).

**pg_cron:** (`ingest-fontes-15min` já em produção; os demais entram nas etapas indicadas)
- Sheets, feriados e FAQ: a cada 15 min — **em produção** desde 2026-09-14, chama `ingest` via `pg_net.http_post` com a anon key pública (não é segredo) e timeout de 120s.
- URLs e PDFs: hoje sincronizados no mesmo job de 15 min (dataset pequeno); separar para diário se o volume crescer.
- FAQs vencidas: diariamente (etapa 8).
- `cost-alert`: a cada hora (etapa 9).
- Retenção de 18 meses: mensalmente (etapa 9).

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

## Recuperação (busca híbrida)
- **`match_chunks(query_embedding, query_text, match_count, filtro)`**: função SQL que combina similaridade vetorial (pgvector, `<=>`, cosseno) com busca textual (`tsvector` em português) via Reciprocal Rank Fusion (k=60). Filtra por fontes ativas e aceita um filtro opcional por metadados (contenção jsonb, ex.: `{"curso": "..."}`).
- **Edge Function `search`** (`supabase/functions/search`): recebe uma pergunta em texto livre, gera o embedding e chama `match_chunks`. É a mesma lógica que `suggest`/`ask` (etapa 4) vão usar internamente antes de montar o prompt.
- **`config.limiar_relevancia` = 0.32**, calibrado com `evals/perguntas.json` (16 perguntas-ouro): perguntas relevantes tiveram similaridade top1 entre 0,41 e 0,83; perguntas fora do domínio, entre 0,22 e 0,23.
- **Evals de recuperação:** `npm run eval` roda `evals/run.mjs`, que chama a função `search` via HTTP para cada pergunta-ouro e verifica se a informação esperada aparece em algum dos top-8 resultados (não só no 1º — é o que o LLM vai ver como contexto).

## Ask (US3) e Suggest (US2) — implementados
- **Edge Function `ask`** (`supabase/functions/ask`): recebe `{pergunta, thread_hash?}`, mascara PII, embute a pergunta, chama `match_chunks`, monta um prompt com os trechos numerados **só por `chunk_id`** (sem índice de posição — ver "Achado" abaixo) e chama `chatJSON` com o modelo de `config.modelos.chat`. Valida as citações contra o conjunto recuperado nesta mesma chamada (RF06); se a similaridade do melhor trecho já estiver abaixo de `limiar_relevancia`, nem chama o LLM. Quando não encontra resposta, registra lacuna deduplicada por embedding (RF16, `limiar_dedup`).
- **Edge Function `suggest`** (`supabase/functions/suggest`, implementada 2026-09-14 — mais cedo do que planejado, ver `tasks.md` etapa 8): reaproveita toda a infraestrutura do `ask` (`match_chunks`, `chatJSON`, validação de citações, `registrarLacuna` extraída para `_shared/lacunas.ts`, `usage_logs`). Diferenças:
  - considera **todas** as mensagens consecutivas do lead sem resposta no fim da conversa (RF02/US2 — "ver tudo que não foi respondido"), não só a última;
  - busca cada mensagem sem resposta **individualmente** (mais o contexto amplo das últimas 6 mensagens), e junta os resultados por `chunk_id`/maior similaridade — uma única busca com todas as mensagens juntas dilui o embedding quando o lead manda vários assuntos em sequência (ex.: "trabalho na empresa X" + "quanto fica o curso Y com desconto");
  - classifica `etapa_atual` restrita por `enum` às etapas reais da tabela `playbook` (nunca livre) e devolve `script_etapa` sempre com o texto real da tabela, nunca escrito pelo LLM — separa "qual etapa" (classificação, baixo risco) de "conteúdo do script" (precisa ser fundamentado, mesmo padrão anti-alucinação do resto do sistema);
  - o `playbook` foi populado com o roteiro comercial real de 6 passos do "Manual de Boas Práticas — Atendimento B2B WhatsApp" fornecido pelo Raphael (descoberta, qualificação da empresa, apresentação do curso e preço, tratamento de objeção, fechamento, follow-up), não necessariamente nessa ordem;
  - o prompt instrui o modelo a usar dados já coletados na conversa (inclusive por mensagens automáticas/chatbot) para enriquecer a resposta em vez de perguntar de novo.
- **Adapter `chatJSON`** (`_shared/openai.ts`): chat completions com `response_format: json_schema, strict: true`. Omite `temperature` quando não informado — `gpt-5.6-luna` só aceita o valor padrão.
- **Achado (citação errada com resposta certa):** numerar os trechos com dois números juntos (`[1] chunk_id=8`) faz o modelo às vezes citar a posição em vez do chunk_id de verdade — uma citação que "existe" no conjunto recuperado (passa no RF06) mas não é a fonte real da resposta. Corrigido: o prompt usa só `chunk_id=N`, um único número por trecho.
- **Achado (limiar_dedup):** duas paráfrases reais da mesma pergunta deram 0,783 de similaridade — o valor inicial (0,90) nunca deduplicaria. Recalibrado para 0,75.
- **Dívida de arquitetura (RF07):** a spec exige que preço/valor/data venham só de `facts`/`feriados`, nunca de texto livre. Hoje o preço dos cursos ainda não está em `facts` — está em chunks de texto (inclusive os valores hipotéticos temporários usados enquanto a planilha real não chega, ver `tasks.md` etapa 8). Quando a planilha oficial de preços for cadastrada, ela deve popular `facts` (não só `chunks`), e o prompt de `suggest`/`ask` deve puxar de lá para o cálculo final — hoje o LLM soma percentual de desconto sobre o texto do chunk, o que funciona mas não é a garantia estrutural que o RF07 pede.
- **Streaming:** adiado — resposta estruturada (JSON Schema) complica streaming incremental (validação só é possível com o JSON completo); com a extensão em uso real, latência ainda não apareceu como problema.

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

## Feriados
A tabela `feriados` é sincronizada da planilha "Calendário Infnet — Feriados" (Google Sheet no Drive do Raphael, cadastrada como fonte tipo `sheet`/categoria `feriados`). A cada sync, o `ingest` **substitui a tabela inteira** (não é incremental) — é a fonte única de verdade; editar a planilha e aguardar até 15 min é o único jeito de atualizar feriados.

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
| Dado de teste/placeholder aparecendo numa conversa real | Fontes de teste marcadas com `sources.categoria` distinto (nunca visível ao LLM) para rastreio; ainda assim, um caso real apareceu numa conversa de teste do Raphael no HubSpot (2026-09-14) com preço hipotético calculado corretamente sobre um dado falso — reforça que dado de preço só pode ser tratado como confiável depois de vir de `facts`, populado pela planilha oficial (ver dívida do RF07 acima) |
