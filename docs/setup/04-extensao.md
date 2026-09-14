# Extensão — build local e calibração dos seletores do HubSpot

## Build

```
cd extension
npm install
npm run build
```

Isso gera `extension/dist/`. No Chrome: `chrome://extensions` → ative o "Modo
do desenvolvedor" → "Carregar sem compactação" → selecione `extension/dist`.

Para desenvolvimento com recarregamento automático: `npm run dev` (Vite +
CRXJS), depois carregue a pasta `extension/dist` normalmente — o CRXJS
atualiza o bundle sozinho a cada mudança.

`npm run test` roda os testes unitários do parser da conversa
(`src/content/parse-conversa.test.ts`) contra uma fixture sintética em
`extension/fixtures/`.

## Por que a extensão ainda não lê conversas de verdade

O leitor do DOM (`src/content/hubspot-reader.ts`) é 100% guiado por
`config.seletores_hubspot` (tabela `config` no Supabase, hoje `{}` — vazio).
Isso é proposital: ainda **não inspecionamos o HTML real** de uma conversa no
inbox do HubSpot, então não temos como saber os nomes de classe/atributos
certos sem arriscar inventar algo que hoje "parece plausível" e amanhã está
errado — o que violaria o princípio de "seletores DOM ficam num config
remoto, atualizável sem publicar nova versão" (constitution §6) logo na
origem: um seletor chutado não é mais confiável que um hardcoded.

Enquanto `seletores_hubspot` estiver vazio, a extensão:
- injeta o botão flutuante "Ativar copiloto" normalmente (não depende de
  seletor nenhum, é sempre fixo no canto da tela);
- ao ativar, detecta que os seletores não estão calibrados e mostra no side
  panel "Não consegui ler esta conversa" em vez de travar ou inventar dados.

## Como calibrar (precisa de alguém logado no HubSpot)

1. Abra uma conversa qualquer em `app.hubspot.com/live-messages/.../inbox/...`.
2. Abra o DevTools (F12) → aba Elements.
3. Clique com o botão direito numa mensagem do lead → "Inspecionar".
4. Identifique:
   - o elemento que envolve **todas** as mensagens (rolável) → `container_mensagens`;
   - o elemento de **cada bolha** de mensagem → `mensagem`;
   - dentro da bolha, o elemento do **texto** → `mensagem_texto`;
   - uma classe/atributo que só aparece nas bolhas **do contato** (não do
     atendente) → `mensagem_autor_lead`;
   - (opcional) o elemento do **horário** → `mensagem_hora`.
5. Grave em `config.seletores_hubspot` (SQL ou dashboard do Supabase):
   ```sql
   update public.config
   set valor = '{
     "container_mensagens": "...",
     "mensagem": "...",
     "mensagem_texto": "...",
     "mensagem_autor_lead": "...",
     "mensagem_hora": "..."
   }'::jsonb
   where chave = 'seletores_hubspot';
   ```
6. Recarregue a extensão (ela busca `/config` a cada 15 min, ou reabra o side
   panel para forçar).

Alternativa: se o Raphael abrir uma conversa de teste na aba do navegador
integrado desta sessão (Browser pane), dá pra inspecionar o DOM real junto e
preencher isso com o time — sem precisar chutar nada.

## Login (OAuth da extensão)

`chrome.identity.launchWebAuthFlow` ainda não foi ligado ao Supabase Auth
nesta etapa — a extensão hoje chama as Edge Functions com a anon key pública
(mesma usada pelo `pg_cron`) quando não há sessão. Antes de ligar o login de
verdade, é preciso cadastrar a URL de redirect da extensão
(`https://<ID-DA-EXTENSAO>.chromiumapp.org/`) em Supabase → Authentication →
URL Configuration → Redirect URLs. O ID da extensão só existe depois de
carregá-la pela primeira vez (`chrome://extensions`) — por isso isso ficou
para depois de o Raphael carregar o build local.
