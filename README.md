# Copiloto de Atendimento Infnet

Extensão Chrome que apoia os consultores comerciais da Infnet no inbox de conversas do HubSpot. Quando o consultor ativa o copiloto numa conversa, a extensão:
- sugere o script da etapa e respostas fundamentadas numa base de conhecimento controlada;
- lembra quando a janela de 24h do WhatsApp está para fechar;
- registra as dúvidas que a base não cobre, para curadoria.

O projeto segue **Spec Driven Development**: toda mudança começa em `specs/`.

## Estrutura

```
specs/
  constitution.md              princípios inegociáveis
  001-copiloto/
    spec.md                    o quê e por quê (histórias, requisitos, aceite)
    plan.md                    como (arquitetura, dados, segurança)
    tasks.md                   tarefas ordenadas e status
    contracts/                 JSON Schema e contratos de API
supabase/
  migrations/                  SQL versionado (rodar em ordem)
  verify/                      consultas de verificação
docs/
  setup/                       guias de configuração
extension/                     (etapa 5) Chrome MV3
admin/                         (etapa 8/9) Curadoria e Relatórios
evals/                         (etapa 3) perguntas-ouro
```

## Status

| Etapa | Descrição | Status |
|---|---|---|
| 1 | Fundação: specs, banco, RLS, login @infnet.edu.br | em andamento |
| 2 | Ingestão (Sheets, PDF, URL) | a fazer |
| 3 | Recuperação híbrida + evals | a fazer |
| 4 | Suggest (OpenAI) com custo | a fazer |
| 5 | Extensão v0 | a fazer |
| 6 | Lembrete da janela de 24h | a fazer |
| 7 | Integração painel ↔ IA | a fazer |
| 8 | Ciclo de aprendizado | a fazer |
| 9 | Custo e relatórios | a fazer |
| 10 | Evals + piloto | a fazer |
| 11 | Distribuição (Drive + manual) | a fazer |

## Começando

1. Siga [docs/setup/01-supabase.md](docs/setup/01-supabase.md) para criar o projeto Supabase e o login Google.
2. Rode os arquivos de `supabase/migrations/` em ordem.
3. Confira com `supabase/verify/verificacao_etapa1.sql`.
