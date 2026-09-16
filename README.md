# Copiloto de Atendimento Infnet

Extensão Chrome que apoia os consultores comerciais da Infnet no inbox de conversas do HubSpot. Quando o consultor ativa o copiloto numa conversa, a extensão:
- sugere o script da etapa e respostas fundamentadas numa base de conhecimento controlada, com citação das fontes;
- lê nota de voz do WhatsApp (transcrição automática) e mensagens de imagem/arquivo (marcador, sem OCR);
- mostra nome, empresa, estado e convênio do lead no cabeçalho (via API do HubSpot), com contagem regressiva da janela de 24h;
- sugere follow-up quando o lead fica sem responder;
- registra as dúvidas que a base não cobre, para curadoria humana aprovar antes de virarem FAQ;
- mede o custo de cada chamada de IA, com relatório e alerta por e-mail pro gestor.

Um portal web separado (`admin-portal/`) deixa o admin cadastrar conteúdo novo pro RAG e ajustar o tom das sugestões sem precisar de SQL ou deploy.

O projeto segue **Spec Driven Development**: toda mudança começa em `specs/`. `specs/001-copiloto/tasks.md` é o changelog completo, dia a dia, de tudo que foi implementado, testado ao vivo e corrigido.

## Estrutura

```
specs/
  constitution.md              princípios inegociáveis
  001-copiloto/
    spec.md                    o quê e por quê (histórias, requisitos, aceite)
    plan.md                    como (arquitetura, dados, segurança)
    tasks.md                   changelog completo, tarefa a tarefa
    contracts/                 JSON Schema de referência da saída da IA
supabase/
  migrations/                  SQL versionado (rodar em ordem, ou via conector)
  functions/                   Edge Functions (suggest, ask, ingest, fontes, admin-config, ...)
  verify/                      consultas de verificação
docs/
  setup/                       guias de configuração (contas, secrets, seletores)
  manual/                      manual de instalação e uso para o atendente
extension/                     Chrome MV3 — leitor do HubSpot, side panel
admin-portal/                  portal web (login) — conteúdo do RAG + prompts editáveis
admin/                         páginas locais (token colado) — Curadoria e Relatórios
evals/                         perguntas-ouro pra medir alucinação
```

## Status

Etapas 1–12 concluídas e validadas ao vivo no HubSpot real. Etapa 13 (auto-update da extensão) está desenhada mas não iniciada — ver `specs/001-copiloto/tasks.md` para o detalhe de cada uma, achados reais e bugs corrigidos.

| Etapa | Descrição | Status |
|---|---|---|
| 1 | Fundação: specs, banco, RLS, login @infnet.edu.br | ✅ concluída |
| 2 | Ingestão (Sheets, PDF, URL, lista de URLs) | ✅ concluída |
| 3 | Recuperação híbrida + evals | ✅ concluída |
| 4 | Suggest / Ask (OpenAI) com custo | ✅ concluída |
| 5 | Extensão v0 + login | ✅ concluída |
| 6 | Lembrete da janela de 24h | ✅ concluída |
| 7 | Integração painel ↔ IA | ✅ concluída |
| 8 | Ciclo de aprendizado (lacunas → curadoria → FAQ) | ✅ concluída |
| 9 | Custo e relatórios | ✅ concluída |
| 10 | Evals + piloto | ✅ concluída a parte automatizável (piloto real com pessoas ainda não rodou) |
| 11 | Distribuição (Drive + manual) | ✅ concluída |
| 12 | Portal admin (conteúdo + prompts editáveis) | ✅ implementado — falta publicar (GitHub + Vercel) |
| 13 | Distribuição com auto-update | ⏳ planejada, não iniciada |

## Começando

1. Siga [docs/setup/01-supabase.md](docs/setup/01-supabase.md) para criar o projeto Supabase e o login Google (referência — já feito no projeto atual).
2. Rode os arquivos de `supabase/migrations/` em ordem, ou aplique pelo conector do Supabase.
3. Confira com `supabase/verify/verificacao_etapa1.sql`.
4. Ao cadastrar planilhas como fonte de dados, siga [docs/setup/02-planilhas-fonte.md](docs/setup/02-planilhas-fonte.md) — ou, pra arquivo/URL avulsa, use o portal admin ([docs/setup/07-portal-admin.md](docs/setup/07-portal-admin.md)).
5. Pra rodar a extensão localmente, veja [docs/setup/04-extensao.md](docs/setup/04-extensao.md). Pra instalar como atendente, veja [docs/manual/README.md](docs/manual/README.md).
