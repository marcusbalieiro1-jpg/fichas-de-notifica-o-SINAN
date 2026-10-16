# Implantação — HABE · AQS e NSP · Ferramenta de Gestão de Atividades

Passo a passo para colocar a ferramenta no ar **do zero**, com tudo em nome
da **AQS** e nada em conta pessoal. Foi escrito para militares de saúde,
não para programadores: siga os passos na ordem, marcando cada item.

> **Regra de ouro:** todas as contas (GitHub, Supabase, hospedagem e a conta
> institucional dentro da ferramenta) são criadas com o **e-mail
> institucional da AQS**. Assim a ferramenta continua funcionando e
> administrável quando chefes, adjuntos ou o responsável técnico saírem do
> HABE. O plano completo está em [CONTINUIDADE.md](CONTINUIDADE.md).

Nos exemplos abaixo, `aqs.habe@exemplo.mil.br` e `habe-aqs-nsp` são
**exemplos**: troque pelo e-mail institucional real e pelo nome escolhido.

---

## Sumário

| Passo | O quê | Onde | Tempo |
|---|---|---|---|
| 0 | [Antes de começar](#0-antes-de-começar) | — | 10 min |
| 1 | [Conta GitHub institucional e o repositório](#1-conta-github-institucional-e-o-repositório) | github.com | 20 min |
| 2 | [Organização e projeto no Supabase](#2-organização-e-projeto-no-supabase) | supabase.com | 15 min |
| 3 | [Banco de dados: rodar os scripts 01 a 04](#3-banco-de-dados-rodar-os-scripts-01-a-04) | Supabase → SQL Editor | 15 min |
| 4 | [Arquivos: conferir o bucket privado](#4-arquivos-conferir-o-bucket-privado) | Supabase → Storage | 5 min |
| 5 | [Login: regras de acesso](#5-login-regras-de-acesso) | Supabase → Authentication | 10 min |
| 6 | [Ligar o site ao banco: `config.js`](#6-ligar-o-site-ao-banco-configjs) | github.com | 10 min |
| 7 | [Publicar o site (Cloudflare Pages ou Netlify)](#7-publicar-o-site-cloudflare-pages-ou-netlify) | cloudflare.com / netlify.com | 20 min |
| 8 | [Serviço de usuários: Edge Function `admin-usuarios`](#8-serviço-de-usuários-edge-function-admin-usuarios) | Supabase → Edge Functions | 15 min |
| 9 | [Conta institucional e cadastro da equipe](#9-conta-institucional-e-cadastro-da-equipe) | Supabase e a ferramenta | 30 min |
| 10 | [Roteiro de conferência](#10-roteiro-de-conferência-pós-implantação) | a ferramenta, dois aparelhos | 40 min |
| 11 | [Custos e limites do plano gratuito](#11-custos-e-limites-do-plano-gratuito) | — | leitura |
| 12 | [Normas institucionais e LGPD](#12-normas-institucionais-e-lgpd) | Seção de TI do HABE | antes de usar com dados reais |

A ordem foi pensada para que cada passo use o resultado do anterior: o
endereço do site só existe depois do passo 7, e o serviço de usuários
(passo 8) precisa desse endereço.

---

## 0. Antes de começar

### O que você precisa

- [ ] **Autorização para usar serviço em nuvem** — leia o [passo 12](#12-normas-institucionais-e-lgpd)
      e consulte a Seção de TI do HABE. Até lá, use só a demonstração
      (`demo.html`) ou dados fictícios.
- [ ] **E-mail institucional da AQS**, com acesso à caixa de entrada (chegam
      nele as confirmações de conta e as recuperações de senha dos serviços).
- [ ] **Um cofre de senhas da AQS**: envelope lacrado guardado no cofre do
      setor, ou um arquivo do KeePassXC (gerenciador de senhas gratuito) na
      pasta da AQS na rede, com a senha-mestra em envelope. Detalhes em
      [CONTINUIDADE.md → Guarda das credenciais](CONTINUIDADE.md#3-guarda-das-credenciais).
- [ ] **Um celular para o segundo fator** da conta institucional — de
      preferência um celular **institucional** da AQS — com um aplicativo
      autenticador gratuito (Google Authenticator ou Microsoft Authenticator).
- [ ] **Uma segunda pessoa** (militar da AQS ou a chefia) que também terá
      acesso aos serviços. Nada pode depender de uma pessoa só.
- [ ] Um computador com navegador atualizado (Chrome, Edge ou Firefox) e,
      para o passo 10, um celular.

### Palavras que aparecem neste guia

| Termo | O que é |
|---|---|
| **GitHub** | Site que guarda o "arquivo-mestre" da ferramenta (o código) e o histórico de cada mudança. |
| **Repositório** | A pasta do projeto dentro do GitHub. A ferramenta fica na subpasta `aqs-nsp/`. |
| **Supabase** | Serviço em nuvem que guarda os dados (banco de dados), os arquivos anexados e controla os logins. Fica em São Paulo. |
| **SQL Editor** | Tela do Supabase onde se cola e executa um "script" (texto com comandos para o banco). |
| **Edge Function** | Pequeno programa que roda dentro do Supabase. A nossa (`admin-usuarios`) cria logins e redefine senhas — coisas que o navegador não pode fazer com segurança. |
| **Hospedagem** | Serviço que publica as páginas da ferramenta num endereço `https://` (Cloudflare Pages ou Netlify). |
| **Chave pública (anon / publishable)** | Identifica o projeto do Supabase. Pode ficar no site: sozinha, não abre nada. |
| **Chave secreta (service_role / secret)** | Chave-mestra do Supabase. **Nunca** sai do painel do Supabase, nunca vai para o site, e-mail ou mensagem. |
| **RLS** | Regras do banco que decidem, registro por registro, o que cada militar pode ver e alterar. É o que protege os dados. |
| **2FA / TOTP** | Verificação em duas etapas: além da senha, o código de 6 números do aplicativo autenticador. |
| **Gestor** | Na ferramenta, a chefia **ou** a conta institucional da AQS (papel "administrador"). |

> Os painéis do GitHub, do Supabase e da hospedagem são em inglês e mudam
> de tempos em tempos. Os nomes de botões aparecem aqui **entre aspas, em
> inglês**, como estão na tela. Se um botão mudou de lugar, procure pelo
> nome.

---

## 1. Conta GitHub institucional e o repositório

O código da ferramenta está hoje num repositório do GitHub em conta
pessoal. O objetivo deste passo é que ele passe a pertencer à conta da AQS.

### 1.1 Criar a conta institucional

1. Acesse **github.com/signup** e crie a conta com o **e-mail institucional
   da AQS**. Sugestão de nome de usuário: `habe-aqs`.
2. Confirme o e-mail (o GitHub manda um código para a caixa institucional).
3. Ative a verificação em duas etapas, que o GitHub exige:
   **foto do perfil → "Settings" → "Password and authentication" →
   "Enable two-factor authentication"** → escolha "Authenticator app" e leia
   o QR code com o celular institucional.
4. O GitHub mostra os **códigos de recuperação** ("recovery codes"). Baixe-os
   e guarde-os no cofre junto com a senha. Sem eles, perder o celular pode
   significar perder a conta.

### 1.2 Trazer o repositório para a conta institucional

**Opção A — transferência (recomendada).** Feita por quem é dono hoje (o
responsável técnico atual):

1. No repositório, clique em **"Settings"** (engrenagem, no alto).
2. Desça até o fim, na área vermelha **"Danger Zone"**, e clique em
   **"Transfer"** (ou "Transfer ownership").
3. Em **"New owner"**, digite o nome da conta institucional (ex.: `habe-aqs`)
   e, para confirmar, o nome do repositório. Clique em
   **"I understand, transfer this repository"**.
4. A conta institucional recebe um e-mail e precisa **aceitar a
   transferência** (o convite vale por pouco tempo — aceite no mesmo dia):
   entre na caixa institucional e clique no link.
5. Pronto: o repositório agora é `github.com/habe-aqs/<nome-do-repositório>`.
   O endereço antigo redireciona para o novo.

> A transferência leva o repositório inteiro — inclusive o HABE SINAN, o
> outro sistema que mora na raiz. Isso é desejável: ambos são do HABE.

**Opção B — o dono atual não está disponível.**

- Se o repositório for **público**: entre com a conta institucional, abra o
  repositório e clique em **"Fork"** → escolha a conta institucional como
  dono → **"Create fork"**. A cópia fica ligada ao original (e pública);
  serve, mas passa a haver duas versões — a oficial é a da conta
  institucional, e isso deve ser registrado.
- Em qualquer caso: no repositório original, **"Code" → "Download ZIP"**;
  na conta institucional, **"New repository"** (marque **"Private"**) e
  envie os arquivos com **"Add file" → "Upload files"**, arrastando as
  pastas descompactadas.

### 1.3 Deixar o repositório privado e dar acesso a uma segunda pessoa

1. **"Settings" → "General" → "Danger Zone" → "Change repository
   visibility" → "Make private"**. O código não tem senha nenhuma, mas tem
   nomes da equipe e informações internas: não há motivo para ser público.
   (A hospedagem do passo 7 funciona com repositório privado.)
2. **"Settings" → "Collaborators" → "Add people"**: convide a segunda
   pessoa (a conta GitHub dela). Ela poderá ajudar na manutenção, mas não
   transferir nem apagar o repositório.
3. Confira que a **versão aprovada da ferramenta está na branch principal**
   (normalmente `main`): na página do repositório, a pasta `aqs-nsp/` deve
   aparecer quando a seleção de branch, no alto à esquerda, mostra `main`.
4. Anote no cofre: usuário, senha e códigos de recuperação do GitHub.

---

## 2. Organização e projeto no Supabase

### 2.1 Conta

1. Acesse **supabase.com** → **"Start your project"** → **"Sign up"** com o
   **e-mail institucional** e uma senha forte (crie a conta por e-mail e
   senha, não pelo botão do GitHub: assim as duas contas ficam
   independentes).
2. Confirme o e-mail na caixa institucional.
3. Ative a verificação em duas etapas da conta: **ícone do perfil →
   "Account preferences"/"Security" → "Multi-factor authentication"**, com o
   celular institucional. Guarde senha e instruções no cofre.

### 2.2 Organização

1. **"New organization"**: nome `HABE AQS`, tipo à escolha (por exemplo
   "Company" ou "N/A"), plano **"Free"** → **"Create organization"**.

### 2.3 Projeto

1. **"New project"** dentro da organização `HABE AQS`:
   - **Project name:** `habe-aqs-nsp`.
   - **Database Password:** clique em **"Generate a password"**, copie e
     guarde **no cofre** antes de continuar. É a senha do banco; a ferramenta
     não a usa no dia a dia, mas um técnico pode precisar dela.
   - **Region:** **"South America (São Paulo)"**. Os dados ficam no Brasil.
   - Demais opções: deixe como vieram (Data API ligada, esquema `public`).
2. **"Create new project"**. Leva cerca de 2 minutos.

### 2.4 Segundo membro

1. **Organização → "Team"** (ou "Settings" → "Team") → **"Invite member"**.
2. Informe o e-mail da segunda pessoa (militar da AQS ou a chefia) e o papel
   **"Owner"** (dono). Ela aceita pelo e-mail recebido.
3. Com dois donos, se uma das contas ficar inacessível, a outra mantém o
   projeto. Na troca de função, convide o sucessor **antes** de remover quem
   sai (ver [CONTINUIDADE.md](CONTINUIDADE.md)).

---

## 3. Banco de dados: rodar os scripts 01 a 04

Os quatro arquivos da pasta `aqs-nsp/supabase/` criam tudo: tabelas, regras
de acesso, rotina diária e os dados iniciais (setores NSP e AQS, feriados de
2026 e 2027, a equipe inicial e as 16 atividades do plano do NSP).

1. No GitHub (conta institucional), abra `aqs-nsp/supabase/01-estrutura.sql`
   e clique no botão **"Copy raw file"** (ícone de duas folhas, à direita,
   acima do texto). O arquivo inteiro vai para a área de transferência.
2. No Supabase, menu lateral **"SQL Editor"** → **"+" / "New query"** → cole
   (Ctrl+V) → **"Run"** (ou Ctrl+Enter).
3. Se aparecer o alerta **"Potential issue detected… destructive
   operation"**, é esperado (os scripts recriam regras com segurança):
   clique em **"Run this query"**.
4. Resultado esperado: **"Success. No rows returned"**.
5. Repita, **nesta ordem**, com `02-seguranca.sql`, `03-tempo-real-agenda.sql`
   e `04-dados-iniciais.sql` (uma consulta nova para cada um).
   - O `03` pode avisar que não conseguiu ativar o **pg_cron** (a rotina das
     00:05). Nesse caso: menu **"Database" → "Extensions"** → procure
     `pg_cron` → ligue → rode o `03` de novo.
   - O `04` termina mostrando uma linha `ocorrencias_geradas` com um número.

Os quatro scripts podem ser rodados de novo a qualquer momento (por exemplo,
numa atualização da ferramenta): eles **não apagam nem duplicam** dados.

### O que conferir depois

Cole cada consulta abaixo numa consulta nova do SQL Editor e rode.

**a) Contagem dos dados iniciais:**

```sql
select
  (select count(*) from public.setores)       as setores,        -- esperado: 2
  (select count(*) from public.militares)     as militares,      -- esperado: 5
  (select count(*) from public.atividades)    as atividades,     -- esperado: 16
  (select count(*) from public.feriados)      as feriados,       -- esperado: 24
  (select count(*) from public.configuracoes) as configuracoes,  -- esperado: 1
  (select count(*) from public.ocorrencias) > 0 as ha_ocorrencias; -- esperado: true
```

Os 5 militares iniciais são: Ten Letícia, Ten Wallace e Ten Balieiro
(adjuntos), "Chefia AQS/NSP" (a chefia, a ser corrigida no passo 9) e
"AQS — conta institucional" (administrador). Nenhum tem login ainda.

**b) Proteção ligada em todas as tabelas** (a coluna `rls_ligada` deve
ser `true` em todas as 14 linhas):

```sql
select c.relname as tabela, c.relrowsecurity as rls_ligada
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
 order by 1;
```

**c) Rotina diária agendada** (esperado: uma linha `aqs-rotina-diaria`,
`5 3 * * *`, ativa):

```sql
select jobname, schedule, active from cron.job;
```

**d) Esquemas expostos.** Em **"Project Settings" → "Data API"**, o campo
"Exposed schemas" deve listar `public` (e, se vier, `graphql_public`) —
**nunca** `privado`. O esquema `privado` guarda funções internas e de
recuperação e não deve ser alcançável pela internet.

**e) (Opcional) Assistente de segurança.** **"Advisors" → "Security
Advisor"**: não deve haver item vermelho ("ERROR"). Avisos sobre recursos do
plano pago (ex.: "Leaked Password Protection") podem ser ignorados. Se
aparecer algo vermelho, registre e peça a um técnico para avaliar antes do
uso com dados reais.

---

## 4. Arquivos: conferir o bucket privado

As evidências (PDF, Word, Excel, PowerPoint, fotos…) ficam num "bucket"
(pasta) do Supabase chamado `evidencias`, criado pelo script `02`.

1. Menu **"Storage"**: o bucket `evidencias` deve aparecer **sem** o selo
   "Public".
2. Nos três pontinhos do bucket → **"Edit bucket"**, confira:
   - **"Public bucket": desligado.** Nunca ligue: tornaria qualquer arquivo
     acessível a quem tivesse o endereço.
   - **"Restrict file upload size": 20 MB** (igual a `LIMITE_ARQUIVO_MB` do
     `config.js`).
   - **"Allowed MIME types":** a lista de tipos permitidos (PDF, Word, Excel,
     PowerPoint, OpenDocument, JPG, PNG, TXT e CSV).
3. Em **"Storage" → "Policies"**, devem existir três regras para o bucket:
   `aqs_evidencias_leitura`, `aqs_evidencias_envio` e
   `aqs_evidencias_exclusao`. Não crie outras.

> Mudou o limite de tamanho? Altere nos **dois** lugares: no bucket e em
> `LIMITE_ARQUIVO_MB` do `config.js` (passo 6). No plano gratuito, o máximo
> por arquivo é 50 MB.

---

## 5. Login: regras de acesso

Menu **"Authentication"** do Supabase. Os nomes das seções variam com a
versão do painel ("Sign In / Providers", "Policies", "Attack Protection",
"Multi-Factor", "Sessions"); procure pelos campos abaixo.

1. **Cadastro fechado.** Em **"Sign In / Providers"** → **"User Signups"**:
   **desligue "Allow new users to sign up"** e salve. Ninguém se cadastra
   sozinho: só os gestores criam acessos, pela tela Equipe.
2. **Login por e-mail ligado.** O provedor **"Email"** deve continuar
   **ligado** (é o login da ferramenta). Os demais provedores (Google,
   telefone etc.) ficam desligados.
3. **Senha mínima.** Em **"Minimum password length"**, coloque **10**; em
   **"Password Requirements"**, escolha **"Letters and digits"** (letras e
   números). É a mesma regra que a ferramenta mostra na tela.
4. **Verificação em duas etapas.** Em **"Multi-Factor"**, deixe **"TOTP (App
   Authenticator)" ligado** ("Enabled"). O SMS ("Phone") fica desligado.
5. **Duração da sessão.**
   - No plano gratuito, mantenha a validade do token de acesso no padrão
     (**3600 segundos**) e deixe ligada a opção de detectar e revogar
     "refresh tokens" comprometidos (padrão).
   - A própria ferramenta encerra a sessão após **30 minutos sem uso**
     (`INATIVIDADE_MINUTOS` no `config.js`) e só mantém o login depois de
     fechar o navegador se o militar marcar "Lembrar neste dispositivo".
   - No plano pago (Pro), dá para limitar também no servidor: **"Sessions"
     → "Time-box user sessions"** (ex.: 12 horas) e **"Inactivity timeout"**
     (ex.: 8 horas). **Não** ligue "Single session per user": a equipe usa
     celular e computador.
6. **Não mexa** em "Secure password change" (deixe desligado) nem nos
   modelos de e-mail. A ferramenta **não usa e-mail** para nada: senhas são
   criadas e redefinidas pelos gestores na tela Equipe. Por isso, não use
   os botões "Send password recovery" ou "Send magic link" do painel — os
   links não funcionam com a ferramenta.

---

## 6. Ligar o site ao banco: `config.js`

O arquivo `aqs-nsp/assets/js/config.js` diz ao site qual projeto do
Supabase usar. Enquanto não for preenchido, o site mostra a tela
"Configuração pendente".

1. No Supabase, copie:
   - **Project URL** — em **"Project Settings" → "Data API"** (ou no botão
     **"Connect"**, no alto). Formato: `https://abcdefgh.supabase.co`.
   - **Chave pública** — em **"Project Settings" → "API Keys"**: a
     **"Publishable key"** (começa com `sb_publishable_`) **ou**, na aba
     "Legacy API keys", a **"anon public"** (começa com `eyJ`). Qualquer uma
     das duas funciona.
   - **Nunca** copie a "secret" (`sb_secret_…`) nem a "service_role".
2. No GitHub (conta institucional), abra `aqs-nsp/assets/js/config.js` e
   clique no **lápis ("Edit this file")**.
3. Troque **somente o que está entre aspas**:

   ```js
   SUPABASE_URL: 'https://abcdefgh.supabase.co',
   SUPABASE_ANON_KEY: 'sb_publishable_xxxxxxxxxxxxxxxxxxxx',
   ...
   CONTATO_SUPORTE: 'AQS — aqs.habe@exemplo.mil.br · ramal 0000',
   ```

   - `CONTATO_SUPORTE` aparece na tela de login ("Esqueceu a senha?
     Procure: …"). Use o contato **institucional** da AQS (e-mail e ramal),
     nunca o de uma pessoa.
   - `INATIVIDADE_MINUTOS` (30) e `LIMITE_ARQUIVO_MB` (20) podem ficar como
     estão.
4. **"Commit changes…"** → mensagem "Liga a ferramenta ao Supabase" →
   **"Commit directly to the main branch"** → **"Commit changes"**.

> **Por que a chave pode ficar no site?** Ela é pública por natureza: quem
> abre o site a recebe de qualquer jeito. O que protege os dados são as
> regras do banco (RLS), que recusam tudo a quem não fez login — e o login
> só existe para quem um gestor cadastrou.

---

## 7. Publicar o site (Cloudflare Pages ou Netlify)

O site é feito só de arquivos prontos (HTML, CSS e JavaScript): **não há
"build"** (compilação). A hospedagem publica a pasta `aqs-nsp/` e aplica os
cabeçalhos de segurança do arquivo `aqs-nsp/_headers`.

### Por que não o GitHub Pages?

O GitHub Pages até exibiria as páginas, mas **ignora o arquivo `_headers`**.
Sem ele, o site perde proteções importantes: a proibição de ser embutido em
outro site (`frame-ancestors`/`X-Frame-Options`, contra golpes de "clique
falso"), a política de permissões, o HSTS próprio e o `Cache-Control:
no-store` das páginas (nada guardado no disco de computador compartilhado).
Além disso, publicar a partir de repositório privado exige plano pago, e
uma correção pode levar minutos para chegar a todos por causa do cache.
Cloudflare Pages e Netlify aplicam o `_headers` e são gratuitos.

> O repositório usa o GitHub Pages **apenas para a demonstração**
> (`demo.html`, dados fictícios, sem rede). Isso não muda a recomendação
> acima para a versão real, que guarda dados do NSP.

### Opção A — Cloudflare Pages (recomendada)

1. **dash.cloudflare.com/sign-up** → conta com o **e-mail institucional**;
   confirme o e-mail; ative a verificação em duas etapas (**"My Profile" →
   "Authentication"**); guarde no cofre.
2. **"Workers & Pages" → "Create"** → aba **"Pages"** → **"Import an
   existing Git repository"** (ou "Connect to Git"). Se o painel oferecer
   primeiro "Workers", procure o link "Looking to deploy Pages? Get started".
3. **"Connect GitHub"** → autorize o aplicativo da Cloudflare **na conta
   institucional** (pode limitar ao repositório da ferramenta) → escolha o
   repositório → **"Begin setup"**.
4. Preencha:
   - **Project name:** `habe-aqs-nsp` → o endereço será
     `https://habe-aqs-nsp.pages.dev`.
   - **Production branch:** `main`.
   - **Framework preset:** `None`.
   - **Build command:** deixe **em branco** (se o painel exigir algo, use
     `exit 0`).
   - **Build output directory:** `aqs-nsp`.
   - **Root directory (advanced):** deixe em branco.
5. **"Save and Deploy"**. Em 1 a 2 minutos o site está no ar.
6. Daqui em diante, **cada alteração gravada no GitHub (branch `main`) é
   publicada sozinha** em 1 a 2 minutos.

### Opção B — Netlify

1. **app.netlify.com/signup** → **"Sign up with email"** com o **e-mail
   institucional**; confirme; ative a verificação em duas etapas
   (**"User settings" → "Security"**); guarde no cofre.
2. **"Add new project"** (ou "Add new site") → **"Import an existing
   project"** → **"GitHub"** → autorize na conta institucional → escolha o
   repositório.
3. Preencha:
   - **Branch to deploy:** `main`.
   - **Base directory:** em branco.
   - **Build command:** em branco.
   - **Publish directory:** `aqs-nsp`.
4. **"Deploy"**. Depois, em **"Site configuration" → "Change site name"**,
   escolha `habe-aqs-nsp` → endereço `https://habe-aqs-nsp.netlify.app`.

### Plano B sem GitHub (qualquer das duas)

Cloudflare ("Upload assets") e Netlify ("Deploy manually", arrastar a
pasta) aceitam o envio direto da pasta `aqs-nsp`. Funciona, mas **cada
mudança exige reenviar a pasta** — por isso a ligação com o GitHub é a
recomendada.

### Conferir a publicação

1. Abra `https://<endereço>/demo.html`: deve aparecer a demonstração (faixa
   vermelha "MODO DEMONSTRAÇÃO").
2. Abra `https://<endereço>/`: deve aparecer a **tela de login** com o
   brasão. Se aparecer "Configuração pendente", o `config.js` (passo 6) não
   foi preenchido ou não está na branch `main`.
3. **Cabeçalhos de segurança:** com o site aberto, tecle **F12** → aba
   **"Network"/"Rede"** → recarregue (F5) → clique na primeira linha (o
   documento) → **"Response Headers"**. Devem aparecer
   `content-security-policy` (terminando em `frame-ancestors 'none'`),
   `x-frame-options: DENY`, `strict-transport-security` e
   `cache-control: no-store`. Se não aparecerem, a pasta publicada não é a
   `aqs-nsp` (revise o item "Build output directory"/"Publish directory").
4. Anote o endereço no cofre e em **Equipe → Continuidade** (passo 9).
5. Volte ao Supabase: **"Authentication" → "URL Configuration" → "Site
   URL"** = o endereço do site (ex.: `https://habe-aqs-nsp.pages.dev`) →
   "Save".

> **Endereço próprio** (ex.: `aqs.habe…mil.br`): é possível nas duas
> hospedagens ("Custom domains"), mas depende da Seção de TI (domínio e
> DNS). Se o banco do Supabase também ganhar endereço próprio, um técnico
> precisa ajustar a CSP em `index.html` e `_headers`.

---

## 8. Serviço de usuários: Edge Function `admin-usuarios`

É o programa que **cria acessos, redefine senhas, desativa, reativa,
remove o segundo fator, troca o e-mail de login e exclui militares** a
pedido da tela Equipe. Só ele usa a chave secreta do Supabase — que nunca
sai do servidor — e confere, a cada pedido, se quem pede é um gestor ativo.

O código está em `aqs-nsp/supabase/functions/admin-usuarios/` (dois
arquivos: `index.ts` e `logica.ts`).

### Opção A — pelo painel (sem instalar nada)

1. Supabase → **"Edge Functions"** → **"Deploy a new function"** → **"Via
   Editor"**.
2. Nome da função: **`admin-usuarios`** (exatamente assim).
3. O editor abre com um exemplo em `index.ts`: **apague tudo** e cole o
   conteúdo de `aqs-nsp/supabase/functions/admin-usuarios/index.ts` (no
   GitHub, "Copy raw file").
4. No editor, **adicione um arquivo** ("+"/"Add file") chamado
   **`logica.ts`** e cole nele o conteúdo de `logica.ts`.
5. **"Deploy function"**. Aguarde a confirmação.
6. Abra a função → **"Details"/"Settings"** → **desligue "Enforce JWT
   verification"** ("Verify JWT") → salve. A função confere o login de quem
   chama por conta própria, com mais rigor; a verificação do painel
   bloquearia o navegador antes disso.
7. **Segredo `ORIGEM_PERMITIDA`:** **"Edge Functions" → "Secrets"** (ou
   "Manage secrets") → **"Add new secret"**:
   - **Name:** `ORIGEM_PERMITIDA`
   - **Value:** o endereço do site, **sem barra no fim** — ex.:
     `https://habe-aqs-nsp.pages.dev`. Para mais de um endereço, separe por
     vírgula, sem espaços: `https://habe-aqs-nsp.pages.dev,https://aqs.exemplo.mil.br`.
   - Salve. Sem esse segredo, **nenhum** navegador consegue usar a função —
     de propósito: só o site oficial administra usuários.
   - Um técnico que teste a ferramenta no próprio computador pode
     acrescentar temporariamente `http://localhost:8080` à lista — e deve
     retirá-lo ao terminar.

### Opção B — pela linha de comando (para quem já usa)

Na pasta `aqs-nsp` de uma cópia do repositório, com Node.js instalado:

```bash
npx supabase login                                   # abre o navegador: entre com a conta institucional
npx supabase link --project-ref <ref-do-projeto>     # o "abcdefgh" de https://abcdefgh.supabase.co (pede a senha do banco, no cofre)
npx supabase secrets set ORIGEM_PERMITIDA=https://habe-aqs-nsp.pages.dev
npx supabase functions deploy admin-usuarios --no-verify-jwt
```

### Se a função disser que está "sem a chave de serviço"

O Supabase entrega à função, sozinho, as chaves do projeto
(`SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY`). Se um dia o projeto só
tiver as **chaves novas** e a função reclamar que falta a chave de serviço:

1. **"Project Settings" → "API Keys"**: copie a chave **publishable**
   (`sb_publishable_…`) e a chave **secret** (`sb_secret_…`).
2. **"Edge Functions" → "Secrets"** → crie dois segredos:
   `AQS_CHAVE_PUBLICA` (a publishable) e `AQS_CHAVE_SERVICO` (a secret).
3. Publique a função de novo. A chave secreta fica **só** nesse segredo —
   nunca no `config.js`, no repositório ou em mensagens.

### Quando refazer este passo

- **O endereço do site mudou:** atualize o segredo `ORIGEM_PERMITIDA`.
- **Os arquivos `index.ts` ou `logica.ts` mudaram** numa atualização: publique
  a função de novo (mesmo procedimento; na opção A, edite a função existente
  e clique em "Deploy").

O teste real da função acontece no passo 9 ("Criar acesso").

---

## 9. Conta institucional e cadastro da equipe

O primeiro login não pode ser criado pela própria ferramenta (ainda não há
ninguém dentro dela para criá-lo). Por isso ele é feito no painel do
Supabase e ligado à **conta institucional da AQS** (papel administrador),
que já existe no banco desde o script `04`.

### 9.1 Criar o login da conta institucional

1. Supabase → **"Authentication" → "Users" → "Add user" → "Create new
   user"**.
2. **Email:** o e-mail institucional da AQS. **Password:** uma senha forte
   (16 caracteres ou mais, com letras e números). Marque **"Auto Confirm
   User"**. **"Create user"**.
3. Guarde a senha **no cofre agora**.

### 9.2 Ligar o login ao cadastro da conta institucional

No **SQL Editor**, troque o e-mail e rode:

```sql
select privado.vincular_usuario('aqs.habe@exemplo.mil.br');
```

O resultado é uma linha com `nome_guerra` "AQS — conta institucional",
`papel` `administrador`, `ativo` `true` e o e-mail preenchido. Se aparecer
"Não há usuário com o e-mail…", confira a grafia (o e-mail tem de ser
idêntico ao do item 9.1).

### 9.3 Primeiro acesso e segundo fator

1. Abra o site e entre com o e-mail institucional e a senha. A tela
   **Início** mostra alertas de continuidade (só um gestor com acesso,
   contatos em branco, nenhuma cópia de segurança) — eles somem à medida
   que você conclui os itens abaixo.
2. **Minha conta → "Ativar a verificação em duas etapas"**:
   - leia o QR code com o aplicativo autenticador do **celular
     institucional**;
   - **copie a "chave de configuração"** mostrada ao lado do QR code e
     guarde-a em **envelope lacrado separado da senha** (é com ela que se
     recadastra o código num celular novo);
   - digite o código de 6 números e confirme.
3. Saia e entre de novo, agora com o código de 6 números. A partir daqui,
   **administrar usuários exige ter entrado com o código**.

### 9.4 Contatos institucionais

**Equipe → aba Continuidade → Contatos institucionais**: preencha o e-mail
institucional da AQS, o responsável técnico atual (posto, nome, setor), o
telefone/ramal e, em Observações, **onde ficam o cofre de senhas e a pasta
das cópias de segurança** (sem escrever senha nenhuma). **"Salvar
contatos"**.

### 9.5 Chefia e adjuntos

Os cadastros iniciais são um ponto de partida. Em **Equipe → Militares**:

1. **Corrija a chefia:** "Chefia AQS/NSP" → **"Gerenciar"** → preencha posto,
   nome de guerra, **nome completo** (vai na assinatura do Plano de
   Atividades) e o **e-mail funcional** → **"Salvar alterações"**.
2. **Revise os adjuntos** (Ten Letícia, Ten Wallace, Ten Balieiro): posto,
   nome completo, e-mail. Para quem não for mais da equipe, use
   **"Reatribuir"** (passa as atividades a outro militar) e depois
   **"Excluir definitivamente"**.
3. **Inclua quem faltar:** **"+ Novo militar"** → preencha → papel
   **Adjunto** ou **Chefia** → **"Cadastrar militar"**.
4. **Crie o acesso de cada um:** no cadastro, **"Criar acesso"** → aparece
   uma **senha temporária, uma única vez**. Entregue-a **pessoalmente** (ou
   por telefone), nunca por WhatsApp ou e-mail. No primeiro login o militar
   é obrigado a criar a própria senha.
5. Peça à chefia que ative a **verificação em duas etapas** (Minha conta).
   Com a chefia e a conta institucional com acesso, o alerta "Só há uma
   conta de gestão com acesso" desaparece.

### 9.6 Ajustes finais

1. **Equipe → Feriados:** confira os feriados do ano corrente e do próximo.
   Inclua os pontos facultativos em que o setor não tem expediente (ex.:
   Carnaval, Corpus Christi, segunda-feira do Círio) — prazos que caem
   neles são antecipados para o dia útil anterior.
2. **Atividades:** revise as 16 atividades do plano (responsáveis, dias,
   prioridades). A tela mostra a **prévia dos próximos prazos** antes de
   salvar.
3. **Equipe → Continuidade → "Exportar tudo (JSON)"**: faça a primeira cópia
   de segurança e guarde o arquivo na pasta da AQS.

---

## 10. Roteiro de conferência pós-implantação

Faça com **dois aparelhos** (um computador e um celular) e uma segunda
pessoa, se possível. Para não usar dados reais, crie um **militar de
teste**: Equipe → "+ Novo militar" → nome de guerra `Teste`, papel
Adjunto, e-mail fictício `teste.implantacao@exemplo.mil.br` (não é preciso
que o e-mail exista: a ferramenta não envia e-mail) → "Criar acesso".
Atribua a ele uma atividade pontual de teste.

| # | Teste | Como | Resultado esperado | ✓ |
|---|---|---|---|---|
| 1 | Acesso sem login | Abra o site numa janela anônima. | Só a tela de login; nenhum dado. | ☐ |
| 2 | Banco fechado para quem não entrou | No navegador, abra `https://<ref>.supabase.co/rest/v1/militares?select=*&apikey=<chave pública>` | Uma mensagem de erro (em geral `permission denied for table militares`, código 42501). **Nenhum nome aparece.** | ☐ |
| 3 | Arquivos fechados | Abra `https://<ref>.supabase.co/storage/v1/object/public/evidencias/teste.pdf` | Erro (bucket não é público). | ☐ |
| 4 | Login da conta institucional com 2FA | Entre com o e-mail institucional. | Pede o código de 6 números; depois abre o Início. | ☐ |
| 5 | Troca de senha obrigatória | No celular, entre como `Teste` com a senha temporária. | Tela "Crie a sua senha"; senhas fracas são recusadas (menos de 10 caracteres, sem número). Depois abre o Início. | ☐ |
| 6 | 2FA do militar | Como `Teste`: Minha conta → ativar; saia e entre. | Pede o código. No computador, Equipe → Teste → "Remover 2FA" volta a entrar só com senha. | ☐ |
| 7 | Envio e download de PDF, Word e PowerPoint | Como `Teste`, abra a missão de teste → Evidências → anexe um `.pdf`, um `.docx` e um `.pptx`. Depois clique em "Abrir" em cada um. | Os três aparecem na lista com o nome de quem enviou; cada um abre (ou é baixado) íntegro. | ☐ |
| 8 | Tipos e tamanho recusados | Tente anexar um `.zip` ou `.exe` e um arquivo de mais de 20 MB. | Recusados com mensagem clara. | ☐ |
| 9 | Foto pelo celular | No celular: "📷 Fotografar documento". | A foto é reduzida e anexada. | ☐ |
| 10 | Tempo real | Computador (conta institucional) e celular (`Teste`) abertos na missão de teste. Comente **no computador**; depois marque "Em andamento" **no celular**. | O comentário aparece no celular em poucos segundos, sem recarregar, e o sino do celular conta +1. A mudança de situação aparece no computador. | ☐ |
| 11 | Usuário desativado | Com `Teste` aberto no celular: no computador, Equipe → Teste → "Desativar". No celular, toque em algo (ou saia e volte à aba); depois tente entrar de novo. | Os dados deixam de ser entregues na hora; o celular volta ao login com o aviso "Seu acesso foi desativado…"; o novo login é recusado ("Acesso desativado"). Reative em seguida para continuar os testes. | ☐ |
| 12 | Trava anti-bloqueio | Como conta institucional, abra o próprio cadastro em Equipe. | Não há opção de desativar nem excluir a si mesmo. | ☐ |
| 13 | Celular (390 px) | Navegue pelas telas no celular. | Barra inferior (Início, Quadro, Avisos, Atividades, Mais); nada "vaza" para os lados. | ☐ |
| 14 | Instalar na tela inicial | Android (Chrome): menu ⋮ → "Instalar app"/"Adicionar à tela inicial". iPhone (Safari): Compartilhar → "Adicionar à Tela de Início". | Ícone com o brasão; abre em tela cheia. | ☐ |
| 15 | Impressão | Plano → "Imprimir / PDF" e "Baixar Word (.doc)". | Documento com o brasão e a assinatura da chefia; o Word abre e edita. | ☐ |
| 16 | Auditoria | Equipe → Auditoria. | Constam as ações dos testes, com o nome de quem fez. | ☐ |
| 17 | Cabeçalhos de segurança | Ver o passo 7, "Conferir a publicação", item 3. | Cabeçalhos presentes. | ☐ |
| 18 | Inatividade (opcional) | Deixe o site aberto sem uso por 30 minutos. | Aviso 1 minuto antes; depois a sessão é encerrada. | ☐ |

**Ao terminar:** exclua os arquivos de teste, e o militar `Teste` (Equipe →
Teste → "Excluir definitivamente" — apaga o cadastro e o login). Registre a
data da conferência na tabela final de [CONTINUIDADE.md](CONTINUIDADE.md#10-responsáveis-e-revisões).

---

## 11. Custos e limites do plano gratuito

Valores conferidos na época da redação (2025–2026). **Confirme em
supabase.com/pricing antes de decidir** — os planos mudam.

**Supabase (plano Free):**

| Item | Limite aproximado | Para esta ferramenta |
|---|---|---|
| Banco de dados | 500 MB | Folga de anos: o banco guarda só texto. |
| Arquivos (Storage) | 1 GB no total; até 50 MB por arquivo | É o que mais cresce. 1 GB ≈ 200 PDFs de 5 MB ou milhares de fotos reduzidas. |
| Tráfego de saída | alguns GB por mês | Suficiente para uma equipe pequena. |
| Usuários ativos | dezenas de milhares | Sem preocupação. |
| Projetos gratuitos | 2 por conta | Use um para a ferramenta. |

**Atenção a três características do plano gratuito:**

1. **Pausa após 7 dias sem uso.** Se ninguém usar a ferramenta por uma
   semana (ex.: recesso de fim de ano), o Supabase **pausa o projeto**: o
   site mostra "Sem conexão com o servidor". Os dados **não se perdem**; o
   dono restaura pelo painel ("Restore project") em poucos minutos — passo
   a passo em [CONTINUIDADE.md](CONTINUIDADE.md#82-o-projeto-foi-pausado).
   A rotina automática das 00:05 **não** conta como uso. Em recessos,
   combine que alguém entre na ferramenta ao menos uma vez por semana.
   Projeto pausado por muito tempo (cerca de 90 dias) pode não ser mais
   restaurável pelo botão.
2. **Sem cópia de segurança automática.** O plano gratuito não guarda
   cópias do banco. Por isso a ferramenta tem o botão **"Exportar tudo
   (JSON)"** e o Início cobra a exportação mensal. Os **arquivos de
   evidência não entram** nesse JSON: eles ficam no Storage do Supabase.
3. **Sem recursos de sessão no servidor** (tempo máximo de sessão,
   inatividade) e sem bloqueio de senhas vazadas — a ferramenta compensa em
   parte com a saída por inatividade.

**Onde ver o consumo:** organização no Supabase → **"Usage"**.

**Hospedagem e GitHub:** os planos gratuitos do Cloudflare Pages, do
Netlify e do GitHub (com repositório privado) atendem com folga um site de
uso interno como este.

**Quando considerar o plano pago (Supabase Pro — em 2025, US$ 25 por mês
por organização):**

- quando os registros passarem a ter valor de documento oficial e perder um
  dia de trabalho for inaceitável (o Pro faz cópia diária automática, guardada
  por 7 dias);
- quando o Storage passar de ~70% de 1 GB;
- se as pausas por falta de uso começarem a atrapalhar;
- se a Seção de TI exigir controles de sessão no servidor.

O pagamento é em dólar, com cartão internacional: verifique antes, com a
Seção de TI e o setor financeiro, se há meio institucional de pagamento —
ou se é o caso de levar a ferramenta para a infraestrutura do próprio HABE
(trabalho para um técnico; ver [CONTINUIDADE.md](CONTINUIDADE.md#9-pequenas-mudanças-sem-programador-e-o-que-exige-alguém-técnico)).

---

## 12. Normas institucionais e LGPD

**Antes de usar com dados reais**, leve à **Seção de TI do HABE** (e, por
ela, ao que o COMAER determinar) as perguntas abaixo, e guarde a resposta
(despacho, parecer ou e-mail) na pasta da AQS:

1. **Uso de serviço em nuvem comercial** para dados administrativos do
   setor: Supabase (banco e arquivos em São Paulo), Cloudflare ou Netlify
   (páginas, distribuídas mundialmente) e GitHub (código, nos EUA). A
   administração pública federal tem regras próprias para computação em
   nuvem (por exemplo, a Instrução Normativa GSI/PR nº 5/2021) e o COMAER
   pode ter normas internas sobre segurança da informação — a Seção de TI
   indica quais se aplicam.
2. **LGPD (Lei nº 13.709/2018):** a ferramenta guarda **dados pessoais dos
   militares da equipe** (nome, e-mail funcional, registros de acesso e de
   atividade). Confirme com o **encarregado de proteção de dados** do HABE
   como registrar esse tratamento.
3. **Dados de pacientes: não.** A ferramenta **não foi feita para dados de
   saúde de pacientes** (dados pessoais sensíveis, art. 11 da LGPD) nem
   para informação classificada. As telas avisam: não anexe documentos com
   identificação de pacientes; use relatórios consolidados, planilhas sem
   nomes ou fotos com os dados cobertos; nos títulos, use o número da
   notificação ("Incidente 2026/041"), nunca o nome do paciente. Se algo
   assim for enviado por engano, siga
   [CONTINUIDADE.md → Dado de paciente enviado por engano](CONTINUIDADE.md#84-arquivo-ou-texto-com-dado-de-paciente-enviado-por-engano).
4. **Quem pode ter acesso** (só militares da AQS/NSP) e por quanto tempo os
   registros devem ser mantidos.

Enquanto a resposta não vier, use apenas a demonstração (`demo.html`) ou
dados fictícios.

---

*Documentos relacionados:* [README](../README.md) ·
[Manual do usuário](MANUAL.md) · [Plano de continuidade](CONTINUIDADE.md) ·
[Arquitetura (para técnicos)](ARQUITETURA.md)
