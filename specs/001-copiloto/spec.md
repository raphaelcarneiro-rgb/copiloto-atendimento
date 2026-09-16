# Spec 001 — Copiloto de Atendimento

> Atualizado em 2026-09-16: US6 estendida (portal admin web, Etapa 12), RF23 novo (prompts editáveis), "fora de escopo" corrigido (áudio deixou de ser fora de escopo — implementado na etapa de qualidade pós-piloto).

- **Status:** aprovada (2026-09-13)
- **Responsável:** Raphael Carneiro (gestor, TI e curador)
- **Constitution:** [../constitution.md](../constitution.md)

## Contexto
Os consultores comerciais respondem leads pelo inbox do HubSpot (`app.hubspot.com/live-messages/{portal}/inbox/{threadId}`), principalmente via WhatsApp. Faltam dois apoios: saber o que responder em cada etapa da conversa e responder dúvidas sobre cursos, preços, convênios e regras sem garimpar vários materiais. A janela de 24h do WhatsApp também costuma expirar fora do expediente sem que o consultor perceba.

## Decisões
| Tema | Decisão |
|---|---|
| Backend | Supabase (Postgres + pgvector, Edge Functions, Auth, Storage, pg_cron) |
| LLM (MVP) | OpenAI para chat e embeddings (`text-embedding-3-small`, 1536 dims) |
| Usuários | Contas `@infnet.edu.br`; papéis atendente, curador, admin |
| Curador | Raphael Carneiro; revisão semanal; lacunas com 5+ ocorrências em destaque |
| Custo | Por conversa, consultor, dia, mês e tipo de chamada; teto R$ 100/mês; alertas em 80% e 100% |
| Retenção | 18 meses para uso/custo, lacunas e propostas |
| Expediente | Seg–sex, 09h–19h, almoço incluso; fuso America/Sao_Paulo |
| Lembrete 24h | Só conversas ativadas; 120 min de antecedência |
| Feriados | Nacionais, estaduais RJ, municipais Rio de Janeiro, 15/10; Carnaval seg–qua de cinzas; Corpus Christi |
| Distribuição | Hoje: zip numa pasta do Google Drive + manual (modo desenvolvedor). Planejado (Etapa 13): auto-update via bucket público do Supabase + política do Google Workspace, pras máquinas gerenciadas |

## Histórias de usuário
- **US1:** Como atendente, ativo o copiloto numa conversa e vejo o painel lateral com a etapa detectada e o script base.
- **US2:** Quando o lead envia mensagem nova, recebo em até ~5s de 2 a 3 respostas sugeridas com fontes.
- **US3:** Pergunto livremente ao copiloto e recebo resposta fundamentada.
- **US4:** Copio ou insiro a sugestão no campo de resposta; se a janela de 24h estiver fechada, o painel avisa e sugere template.
- **US5:** Dou feedback (positivo/negativo + motivo) em cada sugestão.
- **US6:** Como admin, cadastro fontes (arquivo PDF/TXT/MD ou URL, pelo portal web `admin-portal/`, Etapa 12), acompanho a sincronização e edito o roteiro por etapa. Também ajusto, pelo mesmo portal, os trechos de tom/abertura/fechamento do que a IA sugere, sem precisar de deploy de código.
- **US7:** Como gestor, vejo uso, aceite, lacunas e tempo de curadoria.
- **US8:** Como atendente, sou lembrado antes de a janela de 24h fechar, sobretudo quando expira fora do expediente.
- **US9:** Dúvidas que a base não cobre viram lacunas; atendentes propõem respostas; o curador aprova; o copiloto passa a responder com fonte.
- **US10:** Como gestor, acompanho custo por conversa, consultor e mês e sou alertado antes do teto.
- **US11:** Como atendente, instalo a extensão pelo Drive seguindo um manual e sou avisado de versões novas.

## Requisitos funcionais (EARS)

### Sugestões e base
- **RF01:** QUANDO o atendente clicar em "Ativar copiloto", o sistema DEVE marcar o `threadId` como ativo (local, por usuário) e abrir o side panel.
- **RF02:** ENQUANTO a conversa estiver ativa, o sistema DEVE reprocessar apenas quando a última mensagem for do lead, com debounce de 2s.
- **RF03:** SE a conversa não estiver ativa, o sistema NÃO DEVE ler nem enviar conteúdo.
- **RF04:** O sistema DEVE mascarar telefone, e-mail e CPF antes de qualquer requisição.
- **RF05:** A resposta da IA DEVE seguir [contracts/suggestion.schema.json](contracts/suggestion.schema.json).
- **RF06:** O backend DEVE marcar como "não verificada" (ou descartar) toda sugestão cujas fontes não estejam entre os chunks recuperados na requisição.
- **RF07:** Preços, valores e datas DEVEM vir exclusivamente de `facts` e `feriados`.
- **RF08:** Google Sheets DEVEM sincronizar a cada 15 min; PDFs e URLs diariamente ou sob demanda.
- **RF09:** Acesso só para usuários autenticados `@infnet.edu.br`, com papéis atribuídos pelo admin.

### Lembrete da janela de 24h
- **RF10:** ENQUANTO a conversa estiver ativa, o sistema DEVE guardar `ultimaMsgLead` e calcular `expiraEm = ultimaMsgLead + 24h` (America/Sao_Paulo).
- **RF11:** QUANDO `expiraEm` cair no expediente e faltarem ≤ 120 min, o sistema DEVE mostrar lembrete no painel e notificação do Chrome.
- **RF12:** QUANDO `expiraEm` cair fora do expediente, o sistema DEVE calcular `ultimoMomentoUtil`, destacar o lembrete desde a abertura daquele dia útil e notificar 120 min antes de `ultimoMomentoUtil`.
- **RF13:** SE não houver expediente entre `ultimaMsgLead` e `expiraEm`, o sistema DEVE marcar "expira sem janela útil" e avisar no próximo expediente que será preciso template.
- **RF14:** O lembrete DEVE indicar o autor da última mensagem, ser apenas informativo e sumir com nova mensagem do lead, dispensa ou desativação. Expediente e antecedência vêm de `config`; feriados de `feriados`.

### Ciclo de aprendizado
- **RF15:** QUANDO a busca não superar o limiar de relevância, a IA declarar "não encontrei" ou uma citação for invalidada, o sistema DEVE registrar lacuna com pergunta mascarada, curso e etapa.
- **RF16:** SE a lacuna tiver similaridade ≥ 0,90 com uma aberta, o sistema DEVE incrementar a contagem da existente.
- **RF17:** QUANDO houver lacuna e o atendente responder o lead, o painel DEVE oferecer "Usar minha resposta como proposta"; o feedback negativo também DEVE aceitar proposta. Propostas são mascaradas.
- **RF18:** O curador DEVE ter fila por frequência (5+ em destaque) e classificar: nova FAQ, já existia na fonte X, atualizar fonte oficial ou descartar.
- **RF19:** QUANDO aprovada como FAQ, a resposta DEVE ir para `faq_curada` e ser indexada em ≤ 15 min com a fonte "FAQ curada — aprovada por {curador} em {data}". Respostas com preço, valor ou data NÃO PODEM virar FAQ.
- **RF20:** Ao aprovar, o sistema DEVE incluir a pergunta nos evals, avisar os atendentes da lacuna e devolver à fila FAQs vencidas. Propostas não aprovadas NUNCA alimentam sugestões.

### Custo e operação
- **RF21:** Cada chamada à OpenAI DEVE registrar modelo, tokens de entrada/saída/cache, tipo, usuário e `thread_hash`; o custo em US$ e R$ é calculado por `precos_modelo` e pela cotação em `config`. O gestor DEVE ver custo por conversa, consultor, dia, mês e tipo, média por conversa e projeção. QUANDO o mês atingir 80% e 100% do teto, o gestor DEVE ser alertado por e-mail e no relatório. Atendentes não veem custos.
- **RF22:** A extensão DEVE comparar sua versão com `versao_minima`/`versao_atual`, avisar sobre versão nova e se desativar abaixo da mínima. O sistema DEVE apagar mensalmente registros com mais de 18 meses.

### Portal admin (Etapa 12, 2026-09-16)
- **RF23:** O sistema DEVE oferecer uma interface web (com login, restrita a `admin`) para (a) cadastrar fontes de conteúdo — arquivo PDF/TXT/MD ou URL — sem SQL manual, disparando a indexação imediatamente; e (b) editar um conjunto FECHADO de trechos de prompt (tom, abertura e fechamento das mensagens sugeridas), sem exigir deploy de código. O núcleo anti-alucinação do prompt (instrução de fundamentação, formato de citação, validação RF06, filtro de incerteza, JSON Schema) NÃO PODE ser exposto para edição por essa interface — continua fixo no código (Constitution §1).

## Requisitos não funcionais
- Latência p90 ≤ 6s até a primeira sugestão (streaming).
- Orçamento de IA do MVP: R$ 100/mês.
- Falha de leitura do DOM gera aviso, não erro na página.

## Critérios de aceite
- Evals com ≥ 50 perguntas-ouro: 0 fatos inventados; ≥ 90% corretas; ≥ 95% de "não sei" corretos fora da base.
- Lacuna → proposta → aprovação → `ask` responde com fonte "FAQ curada" em ≤ 15 min.
- Custo diário do relatório difere ≤ 5% do painel de uso da OpenAI.
- Um atendente instala e ativa a extensão sozinho em ≤ 10 min com o manual.

## Fora de escopo (v1)
Envio automático; escrita no CRM; outros canais; lembrete para conversas não ativadas; aprendizado sem curadoria; Chrome Web Store; auto-update da extensão (planejado, Etapa 13 — hoje é instalação/atualização manual via Drive).

*(Nota 2026-09-16: transcrição de áudio deixou de ser fora de escopo — implementada e validada ao vivo, ver `tasks.md`. Leitura de imagem continua fora: uma mensagem só-imagem vira um marcador genérico, "[Imagem enviada — conteúdo não lido pelo copiloto]", sem OCR.)*
