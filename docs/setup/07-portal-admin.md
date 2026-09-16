# Portal admin (Etapa 12) — o que já existe e o que falta configurar

Pedido do Raphael (2026-09-16): uma interface web pública, com login, pra
(1) subir conteúdo novo pro RAG (PDF/TXT/MD ou URL) sem SQL manual e (2)
editar os trechos de prompt seguros de expor (tom, abertura, fechamento) sem
precisar de deploy de código. Fica em `admin-portal/`, restrito a `admin`
(mesmo papel que já cadastra fontes no spec, US6).

## O que já existe (código, testado)

- **Backend:**
  - Novo tipo de fonte `arquivo` (`source_tipo`), aceito pelo `ingest`
    generalizado (`ingestArquivoStorage`): PDF (mesma extração de sempre)
    ou TXT/MD (texto puro, sem lib nenhuma).
  - Nova Edge Function `fontes` (admin-only): lista/cria/ativa-desativa/
    exclui fontes, e dispara a ingestão na hora (chama `ingest` com
    `{source_id}`, sem esperar os 15 min do cron).
  - Nova Edge Function `admin-config` (admin-only): lista/edita só os 6
    trechos de prompt na allowlist (`prompt_tom_geral`,
    `prompt_suggest_abertura_resposta`, `prompt_suggest_abertura_followup`,
    `prompt_suggest_fechamento_resposta`, `prompt_suggest_fechamento_followup`,
    `prompt_ask_instrucoes`) — o núcleo anti-alucinação (citação por
    chunk_id, JSON Schema, validação RF06, filtro de incerteza) continua
    fixo no código, de propósito (Constitution §1).
  - `suggest`/`ask` já leem esses 6 trechos do `config` a cada chamada —
    uma edição no portal vale na próxima mensagem, sem novo deploy.
  - Bucket público `extension-updates` já criado (usado só na Etapa 13).
- **Frontend (`admin-portal/`):** Vite + TS puro (sem framework, sem SDK do
  Supabase — só `fetch`, mesmo estilo do resto do projeto). Login via
  redirect clássico do Supabase Auth (mais simples que o hack
  `chrome.identity` da extensão, porque aqui existe uma origem HTTPS de
  verdade). Testado local (`npm run dev` em `admin-portal/`): o botão
  "Entrar com Google" abre a tela de login real do Google.

## O que falta (passos manuais, fora do meu alcance)

### 1. Registrar a URL local pra testar

1. [Authentication → URL Configuration](https://supabase.com/dashboard/project/trtmyuqatmhvikfbqmkv/auth/url-configuration) → **Redirect URLs**.
2. Adicione:
   ```
   http://localhost:5173
   ```
3. Rode `npm install && npm run dev` dentro de `admin-portal/`, abra
   `http://localhost:5173`, clique "Entrar com Google" com uma conta
   `@infnet.edu.br` que já seja `admin` (hoje só o Raphael).

### 2. Colocar o portal no ar (GitHub + Vercel)

Você mencionou já ter conta de GitHub/Vercel de outro projeto (`maqb2b`) —
dá pra reaproveitar a MESMA CONTA sem problema, desde que sejam um
**repositório novo** e um **projeto Vercel novo**, sem nada compartilhado
com o `maqb2b` (nenhum código, variável de ambiente ou domínio em comum).

1. Criar um repositório novo (privado) no GitHub e subir este projeto:
   ```bash
   git remote add origin <URL do repositório novo>
   git push -u origin master
   ```
2. No painel do Vercel: **New Project** → importar esse repositório →
   em **Root Directory**, apontar para `admin-portal` → framework preset
   "Vite" (detecta sozinho) → Deploy.
3. Depois do primeiro deploy, pegar a URL que o Vercel gerou (algo como
   `https://copiloto-infnet-admin.vercel.app`) e repetir o passo 1 acima
   (Redirect URLs do Supabase), adicionando essa URL também.
4. A cada novo `git push` na branch principal, o Vercel publica sozinho —
   não precisa repetir nada disso depois da primeira vez.

### 3. Testar de ponta a ponta

1. Abrir a URL do Vercel, logar com `@infnet.edu.br` (admin).
2. Aba **Conteúdo**: subir um `.md` de teste pequeno, confirmar que aparece
   na tabela com status `ok` e depois excluir (o botão "Excluir" já limpa
   o arquivo do Storage e os chunks indexados).
3. Aba **Prompts**: editar um dos 6 campos, salvar, e no dia a dia (ou via
   `ask`/`suggest` na extensão) confirmar que a mudança realmente influencia
   a próxima sugestão gerada.

## Fora de escopo por enquanto

- `admin/curadoria.html` e `admin/relatorios.html` continuam como páginas
  locais separadas (arquivo, sem login real) — migrá-las pra este mesmo
  portal é um upgrade natural, mas não foi pedido nesta rodada.
- Distribuição da extensão com auto-update (Etapa 13) é um documento à
  parte (`docs/setup/06-distribuicao-auto-update.md`, quando essa etapa for
  implementada).
