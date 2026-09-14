# Manual — Copiloto de Atendimento (Infnet)

Guia rápido para instalar e usar a extensão no Chrome. Leva menos de 10
minutos. Nenhum passo aqui exige acesso técnico além do Chrome em si.

## O que o copiloto faz

- Quando você ativa o copiloto numa conversa do inbox do HubSpot, ele lê a
  conversa e sugere respostas fundamentadas na base de conhecimento da
  Infnet (cursos, preços, convênios, roteiro comercial).
- Ele **nunca envia mensagem sozinho** — só sugere. Você decide copiar,
  inserir no campo de resposta, ou ignorar.
- Se ele não souber responder algo com segurança, ele diz isso claramente
  em vez de inventar.

## Instalação

1. Baixe o arquivo `copiloto-infnet-vX.Y.Z.zip` da pasta compartilhada do
   Google Drive (link com o gestor).
2. Descompacte numa pasta fixa do seu computador (não vale ficar na pasta
   de Downloads — se você mover ou apagar a pasta depois, a extensão para
   de funcionar). Sugestão: `Documentos\CopilotoInfnet\`.
3. No Chrome, acesse `chrome://extensions`.
4. Ligue o **Modo do desenvolvedor** (canto superior direito).
5. Clique em **Carregar sem compactação** e escolha a pasta onde você
   descompactou o zip (a pasta que tem o `manifest.json` dentro, não o
   zip em si).
6. Fixe o ícone do Copiloto na barra do Chrome (ícone de peça de quebra-
   cabeça → alfinete ao lado do nome da extensão).

Pronto — não precisa de login por enquanto (isso ainda está sendo
implementado; a extensão funciona sem conta própria nesta fase).

## Como usar

1. Abra uma conversa no inbox do HubSpot (`app.hubspot.com/live-messages/...`).
2. Clique no botão **"Ativar copiloto"** que aparece flutuando no canto
   inferior direito da tela.
3. Abra o painel lateral do Chrome (ícone da extensão, ou `Ctrl+Shift+.`
   dependendo da sua configuração) para ver:
   - a conversa extraída;
   - sugestões automáticas assim que o lead manda mensagem nova, já
     identificando em qual etapa do roteiro comercial a conversa está;
   - um campo para perguntar livremente ("tem desconto pro convênio X?").
4. Em cada sugestão: **Copiar** (pra colar você mesmo) ou **Inserir na
   conversa** (coloca direto no campo de resposta do HubSpot — você ainda
   decide quando mandar).
5. Dê 👍/👎 nas sugestões — isso ajuda a melhorar o sistema com o tempo.
6. Se aparecer um aviso de **janela de 24h fechando**, isso significa que
   a última mensagem do lead foi há quase 24h e o WhatsApp vai deixar de
   aceitar mensagem de texto livre depois disso (só template). Responda
   antes, se der.
7. Para desativar numa conversa, clique de novo no mesmo botão flutuante.

## Se algo não funcionar

- **"Não consegui ler esta conversa":** avise o admin — os seletores do
  HubSpot podem ter mudado e precisam ser recalibrados (não é algo que
  você resolve sozinho).
- **Aviso de versão desatualizada:** baixe a versão mais nova da mesma
  pasta do Drive e repita a instalação (substitua a pasta antiga).
- **Extension context invalidated" no console:** normal depois de
  atualizar a extensão — dê um F5 completo na aba do HubSpot que já
  estava aberta.

## Atualizar para uma versão nova

1. Baixe o zip novo da pasta do Drive.
2. Descompacte substituindo a pasta antiga (ou apague a antiga e crie de
   novo no mesmo lugar).
3. Em `chrome://extensions`, clique em **Recarregar** no card do
   Copiloto de Atendimento.
4. Dê F5 nas abas do HubSpot que já estavam abertas.
