# Login real (RF09) — configurado e testado (2026-09-14)

> Este guia documenta como o login foi configurado. Todos os passos abaixo já foram feitos e validados ao vivo (Raphael logou com `raphael.carneiro@infnet.edu.br`, criou `profiles` com `papel: admin`). Mantido como referência para reconfigurar em outro ambiente/projeto Supabase, ou se o provedor Google precisar ser reautorizado.

## O que já existe (código, testado)

- **Backend (desde a fundação, etapa 1):** trigger que rejeita contas fora
  de `@infnet.edu.br`, criação automática de `profiles` no primeiro login
  (papel `admin` se o e-mail estiver em `config.admin_emails`, senão
  `atendente`), e RLS completa por papel (`papel_atual`, `eh_membro`,
  `eh_curador`, `eh_admin`) em todas as tabelas.
- **Extensão:** `lib/auth.ts` — `login()` abre a janela do Google via
  `chrome.identity.launchWebAuthFlow` contra o endpoint hospedado do
  Supabase Auth, salva a sessão (`access_token`/`refresh_token`) em
  `chrome.storage.local`, com renovação automática quando expira.
  `lib/api.ts` já anexa esse token em toda chamada às Edge Functions
  quando existe uma sessão — sem login, continua caindo na anon key
  pública (comportamento de hoje, nada quebra).
- **Side panel:** botão "Entrar com Google" / e-mail + "Sair" no
  cabeçalho.
- **Backend:** `supabase/functions/_shared/auth_context.ts` — resolve o
  usuário e papel reais a partir do token; usado por `gaps`, `relatorios`,
  `fontes` e `admin-config` pra exigir `curador`/`admin` de verdade
  (ver nota no fim).

## Passos manuais já concluídos (referência, não repetir)

### 1. Google Cloud Console — criar o OAuth Client ID

No mesmo projeto do Google Cloud onde já existe a conta de serviço
`copiloto-sheets-reader`:

1. **APIs e Serviços → Tela de consentimento OAuth**: tipo **Interno**
   (restringe a contas do Workspace Infnet — não aparece pra ninguém de
   fora do domínio).
2. **APIs e Serviços → Credenciais → Criar credenciais → ID do cliente
   OAuth**, tipo **Aplicativo da Web**.
3. Em **URIs de redirecionamento autorizados**, adicione:
   ```
   https://trtmyuqatmhvikfbqmkv.supabase.co/auth/v1/callback
   ```
4. Copie o **Client ID** e o **Client Secret** gerados.

### 2. Supabase Dashboard — ativar o provedor Google

1. [Authentication → Providers → Google](https://supabase.com/dashboard/project/trtmyuqatmhvikfbqmkv/auth/providers).
2. Ative, cole o Client ID e o Client Secret do passo 1.

### 3. Supabase Dashboard — registrar a URL de redirect da extensão

1. [Authentication → URL Configuration](https://supabase.com/dashboard/project/trtmyuqatmhvikfbqmkv/auth/url-configuration) → **Redirect URLs**.
2. Adicione exatamente:
   ```
   https://jjmgolbihcfannlmalhmklmfcpoeahcm.chromiumapp.org/
   ```
   Esse valor é determinístico a partir da `key` fixa em `manifest.json`
   — não muda entre builds, então só precisa cadastrar uma vez. (Calculado
   com `crypto.createPublicKey` + SHA-256 sobre a chave pública, mesmo
   algoritmo que o Chrome usa pra gerar o ID da extensão — dá pra
   conferir carregando a extensão de verdade em `chrome://extensions` e
   comparando o ID mostrado lá.)

### 4. Testar

1. Carregue a extensão (ou recarregue se já estava carregada).
2. Abra o side panel, clique em "Entrar com Google".
3. Deve abrir uma janela de login do Google — faça login com uma conta
   `@infnet.edu.br`. Qualquer outro domínio é rejeitado pelo trigger do
   banco (RF09).
4. Se dar certo, o cabeçalho passa a mostrar seu e-mail + botão "Sair".

## Decisão resolvida: `gaps`/`relatorios` já exigem login de verdade

Depois do teste de login confirmado (2026-09-14), `gaps` (GET/classificar/
aprovar exigem `curador`/`admin`; proposta exige qualquer membro
autenticado) e `relatorios` (exige `admin`) passaram a rejeitar a anon key
sozinha — testado com `curl`/PowerShell, os dois devolvem 403 sem um JWT de
usuário real. `admin/curadoria.html` e `admin/relatorios.html` (páginas
locais, sem OAuth próprio) ganharam um campo "Colar token de acesso" —
o token é copiado do side panel da extensão (botão de ícone ao lado de
"Sair") e colado uma vez, fica salvo em `localStorage` daquele navegador.

O portal admin novo (`admin-portal/`, Etapa 12, ver
[07-portal-admin.md](07-portal-admin.md)) resolve isso de um jeito melhor
para os casos de uso que cobre (conteúdo e prompts): login OAuth de
verdade, sem precisar copiar token nenhum. `curadoria`/`relatorios`
continuam com o fluxo de token colado por enquanto — migrá-los pro mesmo
portal é um upgrade natural, ainda não feito.
