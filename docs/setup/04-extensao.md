# Extensão — build local e seletores do HubSpot

> Atualizado 2026-09-16. Os seletores do HubSpot já foram calibrados com HTML real desde 2026-09-14 (a extensão lê conversas de verdade) — a seção abaixo virou "como recalibrar se o HubSpot mudar o DOM", não mais "como calibrar pela primeira vez".

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

## Seletores do HubSpot: calibrados, guiados por `config` remoto

O leitor do DOM (`src/content/hubspot-reader.ts`) é 100% guiado por
`config.seletores_hubspot` (tabela `config` no Supabase) — nunca hardcoded
no código da extensão, exatamente para poder recalibrar sem publicar nova
versão (constitution §6). Calibrado com HTML real desde 2026-09-14 (thread
`11173394035`, portal `6010218`), inspecionado ao vivo, nunca chutado.

Chaves hoje cadastradas em `config.seletores_hubspot` (ver as migrations
`20260914030000_calibra_seletores_hubspot.sql` em diante para o histórico
completo de calibração/correção):
- `container_mensagens`, `mensagem`, `mensagem_texto`, `mensagem_autor_lead`,
  `mensagem_hora` — leitura da conversa. O HubSpot expõe `data-test-id`
  estáveis (`primary-message-visitor`, `primary-message-agent`,
  `primary-message-content`, etc.) que não dependem das classes CSS geradas
  por styled-components (essas mudam a cada deploy do HubSpot).
- `mensagem_anexo` — detecta bolha só-imagem/arquivo (vira um marcador de
  texto, sem OCR) e o elemento `<audio><source>` de notas de voz (vira
  transcrição, ver `docs/manual` e `tasks.md` etapa "Transcrição de áudio").
- `composer` (via `content/composer.ts`) — campo de resposta (ProseMirror)
  onde o texto é inserido.
- **Nome/empresa/estado do lead e o convênio da empresa NÃO vêm mais de
  seletor de DOM** — desde 2026-09-15 vêm da API REST do HubSpot
  (`_shared/hubspot.ts::buscarContextoLead`, Private App token), porque um
  seletor de DOM (o campo de texto livre "Nome da empresa" do Contato)
  provou divergir da associação real de Empresa no CRM. Os seletores de DOM
  antigos (`empresa_associada`, `nome_lead`, `estado_lead`) continuam
  cadastrados em `config` só como **fallback** — usados automaticamente se
  a chamada à API do HubSpot falhar (token não configurado, rede etc.).

A lista de mensagens do HubSpot é **virtualizada** (só o trecho perto da
área visível fica no DOM, e os mesmos nós são reciclados em vez de
recriados) — por isso o `MutationObserver` escuta `childList` **e**
`characterData`/`attributes`, não só inserção/remoção de elementos.

## Como recalibrar (se o HubSpot mudar o DOM)

Se a extensão passar a mostrar "Não consegui ler esta conversa" (o aviso
que aparece quando um seletor para de bater com nada), recalibrar:

1. Abra uma conversa qualquer em `app.hubspot.com/live-messages/.../inbox/...`.
2. Abra o DevTools (F12) → aba Elements → inspecione o elemento que parou
   de funcionar. Prefira `data-test-id`/`data-selenium-test` (mais estáveis)
   a classes CSS.
3. Atualize a chave correspondente em `config.seletores_hubspot`:
   ```sql
   update public.config
   set valor = valor || jsonb_build_object('mensagem_texto', 'novo-seletor-aqui')
   where chave = 'seletores_hubspot';
   ```
   (`||` faz merge — atualiza só a chave indicada, preserva as outras.)
4. Recarregue a extensão (ela busca `/config` periodicamente, ou reabra o
   side panel para forçar).

Nunca chute um seletor "que parece plausível" — sempre confira contra HTML
real de uma conversa (pode ser feito junto com alguém logado no HubSpot,
inclusive pelo Browser pane de uma sessão do Claude Code).

## Login (OAuth da extensão)

Implementado em `src/lib/auth.ts` (`chrome.identity.launchWebAuthFlow` contra
o Supabase Auth) e **testado de ponta a ponta** (Raphael logou com
`@infnet.edu.br`, perfil criado como `admin`). Configuração externa
(Google Cloud Console + Supabase Dashboard) documentada em
[05-login-google.md](05-login-google.md), incluindo o ID da extensão já
calculado (`jjmgolbihcfannlmalhmklmfcpoeahcm`, determinístico a partir da
`key` fixa do manifest).
