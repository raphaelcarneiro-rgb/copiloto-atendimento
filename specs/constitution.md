# Constitution — Copiloto de Atendimento Infnet

Princípios inegociáveis. Specs, planos, tarefas e código devem respeitá-los. Qualquer exceção exige mudar este documento primeiro (ver Governança).

## 1. Fundamentado ou nada
Toda afirmação factual (preço, duração, reconhecimento MEC, datas, grade, convênio) precisa de fonte recuperada da base. Sem fonte, a resposta é "não encontrei na base, confirme com a coordenação". Números e datas vêm apenas de tabelas estruturadas (`facts`, `feriados`), nunca de texto livre.

## 2. Humano no controle
A extensão nunca envia mensagem. Ela só sugere, lembra, copia ou insere no campo de resposta; o consultor decide e envia.

## 3. Opt-in por conversa
Nenhum conteúdo de conversa é lido ou sai do navegador sem ativação explícita do consultor naquela conversa.

## 4. Mínimo de dados pessoais (LGPD)
- Telefone, e-mail e CPF são mascarados no cliente antes de qualquer envio.
- O banco não guarda conversas; guarda apenas pergunta mascarada de lacunas, propostas mascaradas, metadados e hash da conversa.
- Registros de uso, lacunas e propostas são apagados após 18 meses.

## 5. Simplicidade
Um único backend (Supabase). Nenhum servidor próprio. A extensão não contém chaves de API; chaves ficam em segredos das Edge Functions.

## 6. Resiliência ao HubSpot
Seletores do DOM ficam em `config`, atualizáveis sem nova versão da extensão. Se a leitura falhar, a extensão avisa e degrada; nunca quebra a página.

## 7. Aprende com supervisão
A base cresce a partir das dúvidas reais, mas nada entra na base sem aprovação de um curador. Propostas não aprovadas nunca alimentam sugestões.

## 8. Custo visível
Toda chamada de IA é medida (tokens e custo) e atribuída a uma conversa e a um consultor. O gestor é alertado antes de estourar o teto mensal.

## 9. Acesso restrito
Somente contas `@infnet.edu.br` autenticadas acessam o sistema. Permissões seguem papéis (`atendente`, `curador`, `admin`) aplicados por Row Level Security no banco, nunca apenas na interface.

## Governança
- Mudanças nesta constitution são registradas com data e motivo abaixo e refletidas em `spec.md`/`plan.md`.
- Cada tarefa só é concluída quando seu critério de aceite em `tasks.md` é verificado.

### Histórico
- 2026-09-13: versão inicial (plano v4 aprovado por Raphael Carneiro).
