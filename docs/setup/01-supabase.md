# Setup 01 — Projeto Supabase e login Google

> Concluído desde 2026-09-13 (projeto `copiloto-atendimento`, ref `trtmyuqatmhvikfbqmkv`). Mantido como referência de como o projeto foi criado originalmente — útil se precisar recriar em outro ambiente. Nunca cole senhas, `service_role key` ou Client Secret no chat.

## 1. Criar o projeto
1. Acesse [supabase.com/dashboard](https://supabase.com/dashboard) e entre com sua conta.
2. **New project**:
   - **Organization:** a sua (ou crie "Infnet").
   - **Name:** `copiloto-atendimento`.
   - **Database Password:** gere uma senha forte e guarde no seu gerenciador de senhas.
   - **Region:** `South America (São Paulo)`.
   - **Plan:** Free serve para o piloto. Projetos Free pausam após ~7 dias sem uso; se isso atrapalhar, mude para Pro.
3. Aguarde o projeto ficar pronto (~2 min).
4. Anote o **Project ref**: é o trecho `xxxx` em `https://xxxx.supabase.co`, visível em Project Settings → General.

## 2. Rodar os SQLs

**Como foi feito de verdade:** as migrations iniciais (as 7 abaixo) foram
rodadas manualmente pelo SQL Editor. A partir da etapa 2, toda migration
nova (já são mais de 25 em `supabase/migrations/`, uma por decisão/achado
real do projeto) foi aplicada direto pelo conector do Supabase disponível
nesta sessão do Claude Code (passo 5 abaixo) — mais rápido e sem risco de
rodar na ordem errada. Só rode manualmente pelo SQL Editor se estiver
recriando o projeto do zero sem o conector disponível.

1. No menu lateral, abra **SQL Editor** → **New query**.
2. Rode os arquivos de `supabase/migrations/` **em ordem cronológica pelo nome do arquivo** (o prefixo `YYYYMMDDHHMMSS` já garante a ordem certa), um de cada vez (copiar, colar, **Run**). As 7 primeiras:

| # | Arquivo | O que faz |
|---|---|---|
| 1 | `20260913000100_extensoes_tipos_config.sql` | pgvector, tipos, tabela `config` |
| 2 | `20260913000200_tabelas_base.sql` | perfis e base de conhecimento |
| 3 | `20260913000300_aprendizado_custo.sql` | lacunas, FAQ, preços, uso e custo |
| 4 | `20260913000400_auth_dominio.sql` | bloqueio de domínio e criação de perfil |
| 5 | `20260913000500_rls.sql` | papéis e permissões |
| 6 | `20260913000600_views_relatorios.sql` | relatórios de custo e lacunas |
| 7 | `20260913000700_seed_inicial.sql` | configurações, preços e feriados |

Depois dessas, continue com todos os arquivos seguintes na pasta, na ordem do nome — cada um documenta no cabeçalho o que faz e por quê.

3. Cada arquivo deve terminar com "Success. No rows returned".
   - Se um arquivo falhar, **não rode os seguintes**. Verifique a mensagem de erro.
   - Migrations que criam tabelas/tipos (a maioria) não podem ser rodadas duas vezes.
4. Rode os blocos de `supabase/verify/verificacao_etapa1.sql` e confira os valores esperados indicados nos comentários.

## 3. Login Google restrito à Infnet
### 3.1 Google Cloud (conta @infnet.edu.br)
1. Acesse [console.cloud.google.com](https://console.cloud.google.com) e crie o projeto **Copiloto Atendimento**.
2. **APIs e serviços → Tela de permissão OAuth** (Google Auth Platform → Branding/Público):
   - **Tipo de usuário: Interno.** Isso limita o login às contas do Google Workspace da Infnet.
   - Nome do app: `Copiloto de Atendimento Infnet`; e-mail de suporte: o seu.
   - Escopos: `openid`, `email`, `profile` (padrão).
3. **Credenciais → Criar credenciais → ID do cliente OAuth**:
   - Tipo: **Aplicativo da Web**.
   - **URIs de redirecionamento autorizados:** `https://<project-ref>.supabase.co/auth/v1/callback`
4. Copie o **Client ID** e o **Client Secret**. Eles vão só para o Supabase, não para o chat.

### 3.2 Supabase
1. **Authentication → Sign In / Providers → Google** → Enable.
2. Cole o Client ID e o Client Secret → **Save**.
3. **Authentication → Sign In / Providers**: desative **Email** (signup por e-mail/senha) e deixe só Google.
4. **Authentication → URL Configuration → Redirect URLs**: cadastre uma entrada por "lugar que faz login" — a extensão (`https://<id-da-extensão>.chromiumapp.org/`, ver [05-login-google.md](05-login-google.md)) e, desde a Etapa 12, o portal admin (`http://localhost:5173` em dev, a URL do Vercel em produção — ver [07-portal-admin.md](07-portal-admin.md)).

## 4. Testar o login
1. No navegador, abra (troque `<project-ref>`):
   `https://<project-ref>.supabase.co/auth/v1/authorize?provider=google`
2. Entre com **raphael.carneiro@infnet.edu.br**. O redirecionamento final pode dar erro de página, e isso é esperado: ainda não há app.
3. Confira:
   - **Authentication → Users**: seu usuário aparece.
   - SQL Editor: `select email, papel from public.profiles;` → seu e-mail como `admin`.
4. Teste negativo: repita com uma conta Gmail pessoal. O Google deve bloquear (app Interno); se passar, o banco recusa com "Acesso restrito a contas @infnet.edu.br" e nenhum usuário é criado.

## 5. Conectar o Claude ao projeto (feito, referência)
O conector do Supabase está autorizado na organização Infnet desde a fundação, com acesso ao projeto `copiloto-atendimento` (ref `trtmyuqatmhvikfbqmkv`). Se precisar reconectar (nova máquina, conector revogado, projeto novo):
1. Garanta que o conector está autorizado na mesma conta/organização onde o projeto foi criado.
2. Confirme o `project ref` visível em Project Settings → General — toda migration/consulta feita por aqui usa esse id.
3. Recomendação mantida: autorize o conector só para essa organização/projeto, não para a conta inteira.
