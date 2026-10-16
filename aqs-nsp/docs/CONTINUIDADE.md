# Plano de continuidade — HABE · AQS e NSP · Ferramenta de Gestão de Atividades

Este documento garante que a ferramenta **continue funcionando e
administrável** quando mudarem a chefia, os adjuntos ou o responsável
técnico. Guarde uma cópia impressa na pasta da AQS, junto com a tabela da
[seção 10](#10-responsáveis-e-revisões) preenchida.

Quem implanta a ferramenta pela primeira vez deve seguir antes o
[guia de implantação](IMPLANTACAO.md). O uso do dia a dia está no
[manual do usuário](MANUAL.md).

---

## Sumário

1. [Princípio: nada depende de uma pessoa](#1-princípio-nada-depende-de-uma-pessoa)
2. [O que pertence a quem](#2-o-que-pertence-a-quem)
3. [Guarda das credenciais](#3-guarda-das-credenciais)
4. [Papéis na ferramenta e a trava anti-bloqueio](#4-papéis-na-ferramenta-e-a-trava-anti-bloqueio)
5. [Checklists de mudança de pessoal](#5-checklists-de-mudança-de-pessoal)
6. [Rotinas](#6-rotinas)
7. [Mensagens de erro e o que fazer](#7-mensagens-de-erro-e-o-que-fazer)
8. [Emergências](#8-emergências)
9. [Pequenas mudanças sem programador e o que exige alguém técnico](#9-pequenas-mudanças-sem-programador-e-o-que-exige-alguém-técnico)
10. [Responsáveis e revisões](#10-responsáveis-e-revisões)

---

## 1. Princípio: nada depende de uma pessoa

- **Tudo é da AQS, não de pessoas.** O código (GitHub), o banco e os
  arquivos (Supabase), o site (Cloudflare Pages ou Netlify) e a conta
  institucional dentro da ferramenta estão em nome do **e-mail institucional
  da AQS**.
- **Sempre duas pessoas.** Cada serviço tem ao menos duas pessoas capazes de
  entrar: a conta institucional (com a senha no cofre) e um segundo membro.
- **Sempre dois gestores com acesso** dentro da ferramenta: a conta
  institucional da AQS **e** ao menos uma chefia. O sistema impede remover o
  último (trava anti-bloqueio).
- **Senhas no cofre, não na cabeça.** O que só uma pessoa sabe se perde
  quando ela sai.
- **O histórico não se perde.** Excluir um militar apaga o cadastro e o
  login, mas os registros dele (execuções, comentários, arquivos, avisos)
  continuam com o nome gravado.
- **A ferramenta avisa.** Os gestores veem no **Início** e em **Equipe →
  Continuidade** os alertas: falta de conta institucional, um gestor só,
  atividade sem responsável, feriados do ano seguinte, cópia de segurança
  atrasada, contatos em branco e acessos sem uso há mais de 90 dias.

---

## 2. O que pertence a quem

Preencha a coluna "Segunda pessoa" e mantenha-a atualizada (seção 10).

| Recurso | Para que serve | Titular (dono) | Segunda pessoa com acesso | Onde fica a senha |
|---|---|---|---|---|
| **E-mail institucional da AQS** | Recebe confirmações e recuperações de senha de todos os serviços | AQS | Chefia da AQS | Cofre |
| **GitHub** (repositório) | Guarda o código e o histórico de mudanças | Conta GitHub da AQS (e-mail institucional) | Colaborador do repositório | Cofre (senha + códigos de recuperação do 2FA) |
| **Supabase** (organização `HABE AQS`, projeto `habe-aqs-nsp`) | Banco de dados, arquivos, logins, Edge Function | Conta Supabase do e-mail institucional (Owner) | 2º membro "Owner" da organização | Cofre (senha da conta, 2FA e **senha do banco**) |
| **Hospedagem** (Cloudflare Pages ou Netlify) | Publica o site | Conta do e-mail institucional | 2º membro da conta | Cofre |
| **Conta institucional na ferramenta** (papel administrador) | Chave reserva para administrar tudo, inclusive a chefia | E-mail institucional da AQS | Quem tem acesso ao cofre | Cofre (senha) + **envelope separado** com a chave do 2FA, ou celular institucional |
| **Celular institucional** (se houver) | Aplicativo autenticador da conta institucional e das contas dos serviços | AQS | — | Senha de desbloqueio no cofre |
| **Endereço próprio** (se houver) | Domínio do site | Seção de TI | — | — |

Endereços atuais (preencha):

- Site da ferramenta: `https://______________________________`
- Projeto Supabase: `https://______________.supabase.co`
- Repositório: `https://github.com/______________/______________`

---

## 3. Guarda das credenciais

**O que guardar:**

1. Senha do e-mail institucional da AQS.
2. GitHub: usuário, senha e **códigos de recuperação** (recovery codes).
3. Supabase: senha da conta, códigos de recuperação do 2FA e a **senha do
   banco de dados** (gerada na criação do projeto).
4. Hospedagem: senha e códigos de recuperação.
5. Conta institucional na ferramenta: senha.
6. **Chave de configuração do 2FA** da conta institucional na ferramenta
   (aparece em Minha conta ao ativar a verificação em duas etapas) — em
   **envelope separado** da senha.

**Onde guardar** (escolha um e registre na seção 10):

- **Envelope lacrado** no cofre da AQS, assinado no lacre por quem o fechou,
  com data; ou
- **Arquivo do KeePassXC** (gerenciador de senhas gratuito) na pasta da AQS
  na rede do HABE, com a senha-mestra em envelope lacrado no cofre.

**Regras:**

- Nunca envie senha por WhatsApp, e-mail ou mensagem. Nunca deixe a única
  cópia no celular pessoal de alguém.
- Abrir o envelope é um ato registrado: anote data, quem abriu e por quê
  (livro ou termo), e **troque as senhas** expostas depois do uso.
- **Troque as senhas a cada passagem de função** de quem as conhecia
  (chefia da AQS, responsável técnico) e refaça os envelopes.
- Nunca escreva senha neste documento, no repositório, em Equipe →
  Continuidade ou em planilha comum.

**Ficha para o envelope** (imprima e preencha à mão):

```
FICHA DE CREDENCIAIS — FERRAMENTA AQS/NSP          Envelope nº ____
Serviço: ______________________________________________
Endereço: _____________________________________________
Usuário / e-mail: ______________________________________
Senha: ________________________________________________
Códigos de recuperação / chave 2FA: ____________________
_______________________________________________________
Fechado em ___/___/______ por _________________________ (posto/nome)
Testemunha: ___________________________________________
```

---

## 4. Papéis na ferramenta e a trava anti-bloqueio

| O que pode fazer | Adjunto | Chefia | Administrador (conta institucional AQS) |
|---|:-:|:-:|:-:|
| Ver missões, atividades, avisos, relatórios, plano e a equipe | ✓ | ✓ | ✓ |
| Cumprir as próprias missões, anexar evidências, comentar | ✓ | ✓ | ✓ |
| Criar atividade **pontual** ou **sob demanda** em que é responsável | ✓ | ✓ | ✓ |
| Criar atividade recorrente, mudar responsáveis, arquivar e excluir atividades | — | ✓ | ✓ |
| Publicar avisos e acompanhar a ciência | — | ✓ | ✓ |
| Incluir, alterar (inclusive o papel), desativar e **excluir** militares — inclusive a chefia | — | ✓ | ✓ |
| Criar acesso, redefinir senha, remover 2FA, trocar e-mail de login | — | ✓ | ✓ |
| Passagem de chefia | — | ✓ | ✓ |
| Setores, feriados, contatos, auditoria, cópia de segurança | — | ✓ | ✓ |
| Mexer numa conta de **administrador** | — | — | ✓ |
| Receber missões, aparecer no placar e nos relatórios por militar | ✓ | ✓ | — |

**Gestor** = chefia **ou** administrador.

**A conta institucional (administrador)** existe para a continuidade: tem os
poderes da chefia, mas **não recebe missões** e **só outro administrador** a
altera, desativa, exclui ou redefine a senha dela — a chefia não consegue
derrubá-la. Use-a só para administrar.

**Trava anti-bloqueio.** O banco recusa qualquer operação que deixaria o
sistema **sem nenhuma conta de chefia ou administrador ativa e com acesso**.
A mensagem é:

> *É preciso manter ao menos uma conta de chefia ou administrador ativa e
> com acesso.*

O que fazer: **dê acesso a outro gestor primeiro** (crie o acesso da nova
chefia, ou confirme que a conta institucional entra) e só depois rebaixe,
desative ou exclua o anterior. Ninguém desativa nem exclui o próprio
cadastro: peça a outro gestor.

**Desativar × excluir:**

| | Desativar | Excluir |
|---|---|---|
| Quando usar | Afastamento temporário (curso, missão, licença), dúvida | Saída definitiva do setor ou do HABE |
| Login | Bloqueado na hora | Apagado |
| Cadastro | Fica (aparece em "Desativados") | Apagado |
| Histórico (execuções, comentários, arquivos) | Intacto | Intacto, com o nome gravado |
| Atividades em que é responsável | Continuam com ele — reatribua | Ele sai delas — **reatribua antes** |
| Volta atrás? | Sim ("Reativar") | Não (cadastre de novo) |

---

## 5. Checklists de mudança de pessoal

### 5.1 Passagem de chefia

Feita por um gestor (a chefia que sai, ou a conta institucional) em
**Equipe → Passagem de chefia**. O assistente tem quatro passos:

1. **Quem sai** — a chefia atual, ou "Nenhuma — a chefia está vaga" (quando
   o antigo chefe já foi excluído ou não havia chefia).
2. **Quem assume** — um militar da lista ou "+ Cadastrar um novo militar".
3. **O que acontece com quem sai** — passa a adjunto, continua como chefia
   (transição), será desativado ou será excluído; e se as **atividades
   ativas** dele passam para quem assume.
4. **Confirmar** — mostra o resumo; tudo é feito de uma vez.

Checklist:

- [ ] Antes: o novo chefe tem e-mail funcional cadastrado (ou cadastre-o no
      passo 2 do assistente).
- [ ] Fazer a passagem no assistente.
- [ ] Se o novo chefe ainda não tem login: Equipe → Militares → ele →
      **"Criar acesso"** e entregar a senha temporária pessoalmente.
- [ ] O novo chefe entra, cria a senha e ativa a **verificação em duas
      etapas** (Minha conta).
- [ ] Preencher o **nome completo** do novo chefe (vai na assinatura do
      Plano de Atividades).
- [ ] Se o antigo chefe ficou como "chefia" na transição, rebaixá-lo depois
      (Equipe → ele → papel "Adjunto"), ou desativá-lo/excluí-lo quando sair.
      Quem faz é o novo chefe ou a conta institucional (ninguém remove a si
      mesmo).
- [ ] Conferir no **Início** que não há alerta de continuidade.
- [ ] Atualizar **Equipe → Continuidade → Contatos** se mudou o ramal ou o
      responsável técnico.
- [ ] Se o antigo chefe conhecia senhas do cofre (e-mail institucional,
      Supabase, conta institucional): **trocar as senhas** e refazer os
      envelopes (seção 3).
- [ ] Revisar avisos fixados e atividades criadas pelo antigo chefe.

### 5.2 Chegada de um novo adjunto

- [ ] Equipe → **"+ Novo militar"**: posto, nome de guerra, nome completo,
      e-mail funcional, setor, papel **Adjunto** → "Cadastrar militar".
- [ ] **"Criar acesso"** → entregar a senha temporária pessoalmente.
- [ ] No primeiro acesso, ele cria a senha; recomende ativar o 2FA.
- [ ] Atribuir atividades: Atividades → atividade → "Editar" → responsáveis.
- [ ] Apresentar o [manual do usuário](MANUAL.md) (ou treinar no
      `demo.html`, que usa dados fictícios).

### 5.3 Saída de um adjunto

- [ ] Equipe → Militares → ele → **"Gerenciar"** → seção "Atividades sob
      responsabilidade" → **"Reatribuir"** para outro militar. As missões em
      aberto dessas atividades passam a aparecer para o novo responsável.
- [ ] Saída temporária: **"Desativar"**. Saída definitiva: **"Excluir
      definitivamente"** (o histórico fica com o nome dele).
- [ ] Conferir no Início que não há "atividade sem responsável".

### 5.4 Saída do responsável técnico

Hoje o responsável técnico é quem implantou a ferramenta (na implantação,
o Ten Balieiro). Antes de ele sair do HABE — de preferência **com o
sucessor ao lado**:

- [ ] **GitHub:** o repositório pertence à conta institucional da AQS
      ([IMPLANTACAO.md, passo 1](IMPLANTACAO.md#1-conta-github-institucional-e-o-repositório)).
      Se ainda estiver na conta pessoal dele, **transfira agora**. Depois,
      remova a conta pessoal dele dos colaboradores ("Settings" →
      "Collaborators") e inclua o sucessor.
- [ ] **Supabase:** o dono da organização é o e-mail institucional. Convide
      o sucessor como "Owner" **antes** de remover a conta pessoal do
      responsável que sai (Organização → "Team"). Confira que restam ao
      menos dois donos.
- [ ] **Hospedagem:** mesmo procedimento (conta do e-mail institucional;
      remover acessos pessoais; incluir o sucessor).
- [ ] **Trocar as senhas** que ele conhecia: e-mail institucional, GitHub,
      Supabase (conta e **senha do banco**: "Project Settings" → "Database"
      → "Reset database password"), hospedagem e a conta institucional na
      ferramenta. Recadastrar o 2FA da conta institucional (nova chave em
      envelope novo). Refazer os envelopes.
- [ ] **Na ferramenta:** reatribuir as atividades dele e desativar ou excluir
      o cadastro (5.3).
- [ ] **Equipe → Continuidade:** atualizar "Responsável técnico atual" e
      os demais contatos.
- [ ] **`config.js`:** se `CONTATO_SUPORTE` citava o nome ou o ramal dele,
      corrigir (seção 9.1).
- [ ] Repassar este documento com o sucessor e preencher a seção 10.
- [ ] (Recomendado, com apoio técnico) se houver qualquer dúvida sobre a
      chave secreta do Supabase ter sido copiada, **renovar as chaves** em
      "Project Settings" → "API Keys" e atualizar a chave pública no
      `config.js`.

### 5.5 Mudança do e-mail institucional da AQS

- [ ] Na ferramenta, a conta institucional entra e usa Equipe → (conta
      institucional) → **"Alterar e-mail de acesso"**; depois atualiza
      Equipe → Continuidade.
- [ ] Trocar o e-mail das contas do GitHub, do Supabase e da hospedagem (nas
      configurações de perfil de cada serviço).
- [ ] Atualizar `CONTATO_SUPORTE` no `config.js`.

---

## 6. Rotinas

**Diária (todos)**
- Entrar, conferir o **Início** (missões de hoje, avisos sem ciência) e
  registrar o que foi feito, com as evidências.

**Diária (gestores)**
- Olhar o bloco **"Continuidade da ferramenta"** do Início e as
  **"Pendências da equipe"**.

**Mensal (um gestor — sugestão: na primeira semana do mês)**
- [ ] **Equipe → Continuidade → "Exportar tudo (JSON)"** (ou Relatórios →
      "Exportar tudo"). Guarde o arquivo
      `Copia-de-seguranca-AQS-NSP-AAAA-MM-DD.json` na **pasta da AQS na rede
      do HABE** — nunca em computador pessoal, pendrive particular ou e-mail.
      Mantenha ao menos as 12 últimas.
- [ ] Conferir o consumo no Supabase (organização → "Usage"), em especial o
      Storage (limite de 1 GB no plano gratuito).
- [ ] Ver em Equipe → Auditoria se há algo estranho (ações fora do horário,
      contas desconhecidas).

> O JSON traz **todas as tabelas** (missões, comentários, avisos, equipe,
> auditoria), mas **não o conteúdo dos arquivos** de evidência, que ficam no
> Storage do Supabase. Ele serve para consulta e para um técnico reconstruir
> o banco se for preciso; não há botão de "importar".

**Anual**
- [ ] **Novembro:** Equipe → Feriados → **"Incluir os feriados padrão de
      <ano seguinte>"** e acrescentar os pontos facultativos sem expediente.
      (O Início avisa os gestores a partir de 1º de novembro.)
- [ ] **Dezembro:** revisar a equipe (Equipe → Militares): desativar ou
      excluir quem saiu; o Início aponta acessos sem uso há mais de 90 dias.
- [ ] **Janeiro:** revisar o **Plano de Atividades** com a chefia
      (Atividades: arquivar o que acabou, criar o que começou; Plano →
      imprimir para aprovação).
- [ ] **Uma vez por ano:** testar a chave reserva — entrar na ferramenta com
      a conta institucional (senha + código) e entrar no Supabase com a conta
      institucional. Registrar na seção 10.
- [ ] Revisar este documento e a tabela da seção 10.

**Em recessos de mais de uma semana:** alguém entra na ferramenta ao menos
uma vez por semana, para o Supabase gratuito não pausar o projeto (8.2).

---

## 7. Mensagens de erro e o que fazer

| Mensagem (ou parte dela) | O que significa | O que fazer |
|---|---|---|
| **"Configuração pendente"** (tela de login) | `config.js` ainda com os valores-modelo | [IMPLANTACAO.md, passo 6](IMPLANTACAO.md#6-ligar-o-site-ao-banco-configjs). |
| **"Sem conexão com o servidor"** | Internet do aparelho caiu, ou o projeto do Supabase foi **pausado** | Teste outra página; se só a ferramenta falha, veja 8.2. |
| **"Seu acesso foi desativado…"** / **"Acesso desativado. Procure a chefia."** | Um gestor desativou o cadastro | Um gestor reativa em Equipe → "Reativar". |
| **"Seu usuário não está vinculado a um cadastro ativo"** | O login existe, mas não está ligado a um militar ativo | Um gestor confere o cadastro; se for a conta institucional, receita R4 (8.1). |
| **"E-mail ou senha incorretos"** | Senha errada | Um gestor usa "Redefinir senha" (a do administrador, só outro administrador ou a receita R2). |
| **"Muitas tentativas"** | Proteção contra adivinhação de senha | Aguarde alguns minutos. |
| **"É preciso manter ao menos uma conta de chefia ou administrador ativa e com acesso"** | Trava anti-bloqueio | Dê acesso a outro gestor antes (seção 4). |
| **"Apenas a conta de administrador (conta institucional da AQS) pode…"** | A chefia tentou mexer na conta institucional | Entre com a conta institucional. |
| **"Para administrar usuários, entre com o segundo fator…"** / **"confirme o segundo fator"** | O gestor tem 2FA, mas a sessão foi aberta sem o código | Saia e entre de novo, digitando o código. |
| **"Já existe um usuário de acesso com este e-mail"** | Sobrou um login antigo no Supabase com esse e-mail | O dono do Supabase apaga-o em "Authentication" → "Users" (se não for de ninguém da equipe) ou use outro e-mail. |
| **"O usuário de acesso deste militar não existe mais no Supabase"** | O login foi apagado direto no painel | Crie um acesso novo ("Criar acesso") ou religue com a receita R5 (8.1). |
| **"O serviço de administração de usuários (Edge Function admin-usuarios) não está implantado"** | A função não foi publicada (ou foi apagada) | [IMPLANTACAO.md, passo 8](IMPLANTACAO.md#8-serviço-de-usuários-edge-function-admin-usuarios). |
| **"Não foi possível falar com o serviço de administração de usuários"** ou **"Origem não permitida"** | O endereço do site não está no segredo `ORIGEM_PERMITIDA`, ou a função está com "Verify JWT" ligado | Conferir o segredo (endereço exato, sem barra no fim) e desligar "Enforce JWT verification" na função (passo 8). |
| **"A função admin-usuarios não está configurada: defina o segredo ORIGEM_PERMITIDA"** | Falta o segredo | Passo 8, item 7. |
| **"…está sem as variáveis SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY"** | O Supabase não entregou à função a chave interna | Publicar a função de novo; em "Project Settings" → "API Keys", confirmar que as chaves "legacy" (anon/service_role) estão ativas. Persistindo, acionar um técnico. |
| **"O segundo fator (aplicativo autenticador) está desligado no Supabase"** | TOTP desligado em Authentication | Ligar em "Authentication" → "Multi-Factor" → TOTP ([passo 5](IMPLANTACAO.md#5-login-regras-de-acesso)). |
| **"O banco de dados não está com a estrutura esperada por esta versão da ferramenta"** | O site foi atualizado e o banco não | Rodar de novo, na ordem, os scripts `supabase/01` a `04` no SQL Editor ([passo 3](IMPLANTACAO.md#3-banco-de-dados-rodar-os-scripts-01-a-04)). Não apaga dados. |
| **"Código inválido ou expirado"** (2FA) | Relógio do celular errado ou código vencido | Acertar a hora automática do celular e digitar o código atual. |

---

## 8. Emergências

As receitas com SQL são feitas pelo **dono do projeto no Supabase** (conta
do e-mail institucional ou o 2º membro), em **"SQL Editor" → "New query"**:
cole, **troque os valores entre aspas** marcados com `←` e clique em "Run".
Nenhuma delas apaga o histórico.

### 8.1 Perdemos o acesso de todos os gestores

Sintoma: ninguém consegue entrar como chefia nem como conta institucional
(senha esquecida, chefe saiu sem passar a função, celular do 2FA perdido).

**Primeiro: alguém ainda entra no Supabase?**

- **Sim** → siga as receitas abaixo.
- **Não** → recupere a conta do Supabase pelo e-mail institucional
  (supabase.com → "Sign in" → "Forgot password"; o e-mail chega na caixa
  da AQS). Se o 2FA da conta do Supabase também se perdeu, use os códigos de
  recuperação do cofre; sem eles, só o suporte do Supabase (formulário de
  suporte no site) — por isso a organização deve ter **dois donos**.

**R1 — Diagnóstico: quem tem acesso de gestor?**

```sql
select m.id, m.posto, m.nome_guerra, m.papel, m.ativo, m.email,
       m.usuario_id is not null as tem_login,
       u.banned_until as login_bloqueado_ate,
       u.last_sign_in_at as ultimo_login
  from public.militares m
  left join auth.users u on u.id = m.usuario_id
 where m.papel in ('chefia', 'administrador')
 order by m.papel, m.nome_guerra;
```

**R2 — Ninguém sabe a senha da conta institucional** (o login existe em
"Authentication" → "Users"). Define uma senha provisória, desbloqueia o
login, religa-o à conta institucional e obriga a criar senha nova no
primeiro acesso. **Use só com o e-mail da conta institucional** (para outra
pessoa, ver R5):

```sql
do $$
declare
  v_email text := 'aqs.habe@exemplo.mil.br';  -- ← e-mail institucional da AQS
  v_senha text := 'Provisoria2026aqs';        -- ← senha provisória (10+ caracteres, letras e números)
  v_usuario uuid;
begin
  select u.id into v_usuario from auth.users u where lower(u.email) = lower(v_email);
  if v_usuario is null then
    raise exception 'Não há login com o e-mail % em Authentication → Users. Use a receita R4.', v_email;
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(v_senha, extensions.gen_salt('bf')),
         banned_until = null
   where id = v_usuario;
  perform privado.vincular_usuario(v_email);
  update public.militares set deve_trocar_senha = true where usuario_id = v_usuario;
  raise notice 'Pronto: entre com % e a senha provisória; a ferramenta pedirá uma senha nova.', v_email;
end
$$;
```

Depois: entre na ferramenta, crie a senha nova, guarde-a no cofre e **apague
esta consulta** do SQL Editor (ela contém a senha provisória).
*Se aparecer "function extensions.crypt does not exist", rode antes*
`create extension if not exists pgcrypto with schema extensions;` *e repita.*

**R3 — O celular do 2FA da conta institucional se perdeu** (e não há o
envelope com a chave de configuração):

```sql
delete from auth.mfa_factors
 where user_id = (select u.id from auth.users u
                   where lower(u.email) = lower('aqs.habe@exemplo.mil.br'));  -- ← e-mail
```

Depois: entre só com a senha e **cadastre o 2FA de novo** (Minha conta),
guardando a nova chave em envelope.

**R4 — O login da conta institucional não existe** (foi apagado) **ou o
e-mail institucional mudou:**

1. "Authentication" → "Users" → **"Add user" → "Create new user"**: e-mail
   institucional, senha forte, **"Auto Confirm User"** marcado.
2. No SQL Editor:

   ```sql
   select privado.vincular_usuario('aqs.habe@exemplo.mil.br');  -- ← e-mail
   ```

   Liga o login à conta institucional (se ela tiver sumido do banco, é
   recriada), reativa o cadastro e grava o e-mail. Um login antigo ligado a
   ela é desligado.

**R5 — Devolver o acesso a uma chefia específica** (o login dela existe em
"Authentication" → "Users"):

```sql
-- 1) Descubra o "id" do cadastro dela:
select id, posto, nome_guerra, papel, ativo, email from public.militares order by nome_guerra;

-- 2) Ligue o login ao cadastro, garanta o papel e desbloqueie o login:
select privado.vincular_usuario('chefe@exemplo.mil.br',              -- ← e-mail de login dela
                                '00000000-0000-0000-0000-000000000000'); -- ← id do passo 1
update public.militares set papel = 'chefia'
 where id = '00000000-0000-0000-0000-000000000000';                   -- ← o mesmo id
update auth.users set banned_until = null
 where lower(email) = lower('chefe@exemplo.mil.br');                  -- ← o mesmo e-mail
```

Se ela também esqueceu a senha: **não use a R2** (a R2 é só para a conta
institucional — ela liga o login ao cadastro de administrador). Recupere
primeiro a conta institucional (R2 ou R4), entre com ela e use, em Equipe →
a chefia → **"Redefinir senha"**.

**Depois de qualquer receita:** entrar na ferramenta, conferir **Equipe →
Continuidade** (gestores com acesso), registrar o ocorrido (data, quem, por
quê) e, se o envelope foi aberto, trocar as senhas (seção 3).

### 8.2 O projeto foi pausado

Sintoma: todos veem "Sem conexão com o servidor"; no painel do Supabase o
projeto aparece como **"Paused"**. Acontece no plano gratuito após 7 dias
sem uso.

1. O dono entra em supabase.com → abre o projeto → **"Restore project"**.
2. Aguarde alguns minutos até o projeto ficar "Healthy"/ativo.
3. Abra a ferramenta e entre: as missões dos dias parados são geradas no
   primeiro login (a ferramenta recupera até 45 dias para trás).
4. Projeto pausado há muito tempo (cerca de 90 dias, na regra do Supabase em
   2025) pode não ter mais o botão de restaurar — por isso: uso semanal nos
   recessos e cópia mensal (seção 6).

### 8.3 Suspeita de vazamento

Exemplos: senha anotada à vista, celular perdido sem bloqueio, alguém
entrou com a conta de outro, ação estranha na auditoria.

1. **Cortar o acesso na hora:** Equipe → militar → **"Desativar"**. O acesso
   aos dados é cortado imediatamente e o login é bloqueado. (Se for a
   conta institucional, use a receita R2 para trocar a senha.)
2. **Trocar a senha e o 2FA:** com o militar presente, **"Reativar"** →
   **"Redefinir senha"** (entregar a temporária pessoalmente) → **"Remover
   2FA"** se o celular se perdeu.
3. **Encerrar as sessões:** o militar entra, cria a senha nova e usa
   **Minha conta → "Sair de todos os dispositivos"**; depois entra de novo e
   recadastra o 2FA. Um técnico pode encerrar as sessões pelo SQL Editor:

   ```sql
   delete from auth.sessions
    where user_id = (select u.id from auth.users u
                      where lower(u.email) = lower('militar@exemplo.mil.br'));  -- ← e-mail
   ```

4. **Consultar a auditoria:** Equipe → **Auditoria** mostra cada inclusão,
   alteração e exclusão, com nome, data e hora (inclusive criação de
   acessos e mudanças de papel). No Supabase, **"Logs" → "Auth"** mostra os
   logins com horário e endereço IP — no plano gratuito esses registros
   duram pouco (cerca de 1 dia): aja rápido e salve o que importar.
5. **Se um gestor foi comprometido:** conferir na auditoria se foram criados
   acessos, mudados papéis ou excluídos registros, e desfazer.
6. **Se a conta do Supabase ou a chave secreta foram expostas:** trocar a
   senha da conta, conferir os membros ("Team"), conferir a lista de logins
   ("Authentication" → "Users"), trocar a senha do banco e, com apoio
   técnico, **renovar as chaves** ("Project Settings" → "API Keys") e
   atualizar o `config.js`.
7. **Comunicar** a chefia, a Seção de TI e o encarregado de proteção de
   dados do HABE. Incidentes com dados pessoais podem ter de ser
   comunicados à ANPD em prazo curto (Resolução CD/ANPD nº 15/2024) — quem
   decide é o encarregado.

### 8.4 Arquivo ou texto com dado de paciente enviado por engano

A ferramenta **não pode** guardar dados de pacientes. Se isso acontecer:

1. **Na ferramenta, imediatamente:**
   - arquivo: abra a missão → Evidências → **"Excluir"** (quem enviou ou um
     gestor). O arquivo é apagado do Storage;
   - comentário: **"Excluir"** no comentário (autor ou gestor);
   - observação, justificativa ou título de execução: edite e salve sem o
     dado;
   - aviso: um gestor edita ou exclui.
2. **Apagar os rastros** (um gestor, com o dono do Supabase). A auditoria e
   as notificações guardam cópia do texto e do **nome** do arquivo (nunca o
   conteúdo). No SQL Editor, use em `TRECHO` a menor parte possível que
   identifique o dado indevido (ex.: parte do nome do arquivo) — evite
   digitar o nome completo do paciente:

   ```sql
   -- a) Localizar (troque TRECHO nas linhas marcadas):
   select 'auditoria' as onde, a.id::text as id, a.quando as quando, a.tabela as tipo, a.operacao as detalhe
     from public.auditoria a
    where a.antes::text ilike '%TRECHO%' or a.depois::text ilike '%TRECHO%'          -- ←
   union all
   select 'notificacoes', n.id::text, n.criado_em, n.tipo, n.titulo
     from public.notificacoes n
    where n.titulo ilike '%TRECHO%' or n.mensagem ilike '%TRECHO%'                   -- ←
   union all
   select 'comentarios', c.id::text, c.criado_em, 'comentário', left(c.texto, 60)
     from public.comentarios c
    where c.texto ilike '%TRECHO%'                                                   -- ←
   union all
   select 'ocorrencias', o.id::text, o.atualizado_em, 'execução', left(o.observacao, 60)
     from public.ocorrencias o
    where o.observacao ilike '%TRECHO%' or o.justificativa ilike '%TRECHO%'
       or o.titulo_execucao ilike '%TRECHO%'                                          -- ←
   union all
   select 'evidencias', e.id::text, e.enviado_em, 'arquivo', e.nome
     from public.evidencias e
    where e.nome ilike '%TRECHO%' or e.descricao ilike '%TRECHO%'                     -- ←
   union all
   select 'avisos', v.id::text, v.criado_em, 'aviso', v.titulo
     from public.avisos v
    where v.titulo ilike '%TRECHO%' or v.mensagem ilike '%TRECHO%'                    -- ←
   order by 3;
   ```

   Linhas em `comentarios`, `ocorrencias`, `evidencias` ou `avisos` significam
   que o item 1 ainda não foi feito: faça-o pela ferramenta e repita a busca.
   Quando só restarem `auditoria` e `notificacoes`:

   ```sql
   -- b) Apagar os rastros e registrar a limpeza (sem repetir o dado):
   delete from public.auditoria
    where antes::text ilike '%TRECHO%' or depois::text ilike '%TRECHO%';             -- ←
   delete from public.notificacoes
    where titulo ilike '%TRECHO%' or mensagem ilike '%TRECHO%';                      -- ←
   insert into public.auditoria (tabela, operacao, depois)
   values ('auditoria', 'DELETE',
           jsonb_build_object('motivo', 'Remoção de dado de paciente enviado por engano',
                              'registro', 'Termo/documento nº ____'));               -- ←
   ```

   Rode a busca (a) de novo: não deve sobrar nenhuma linha. Depois **apague
   estas consultas** do SQL Editor (elas contêm o trecho procurado).
3. **Storage:** no Supabase, "Storage" → `evidencias` → confira que o
   arquivo não está mais na pasta da atividade.
4. **Cópias de segurança:** se um "Exportar tudo" foi feito entre o envio e
   a remoção, o JSON contém o texto/nome do arquivo (não o conteúdo). Gere
   uma cópia nova e elimine a antiga, conforme orientação do encarregado de
   dados.
5. **Registrar e comunicar** à chefia e ao encarregado de proteção de dados
   do HABE (data, o que aconteceu, o que foi feito — sem repetir o dado).
6. Relembrar a equipe: nos títulos, use o número da notificação ("Incidente
   2026/041"); anexe relatórios consolidados ou fotos com os dados cobertos.

### 8.5 O endereço do site mudou

- [ ] Atualizar o segredo `ORIGEM_PERMITIDA` da Edge Function
      ([passo 8](IMPLANTACAO.md#8-serviço-de-usuários-edge-function-admin-usuarios)).
- [ ] Atualizar "Authentication" → "URL Configuration" → "Site URL".
- [ ] Avisar a equipe: quem instalou a ferramenta na tela inicial do celular
      precisa instalar de novo pelo endereço novo.

---

## 9. Pequenas mudanças sem programador e o que exige alguém técnico

### 9.1 Pelo GitHub, sem programar: o `config.js`

No GitHub (conta institucional) → `aqs-nsp/assets/js/config.js` → lápis
**"Edit this file"** → altere **só o texto entre aspas** (ou o número) →
**"Commit changes"**. A hospedagem publica sozinha em 1 a 2 minutos.

| Item | Para quê |
|---|---|
| `CONTATO_SUPORTE` | Texto da tela de login: a quem recorrer para senha e acesso. Use contato **institucional**. |
| `NOME_SISTEMA`, `SUBTITULO`, `ORGANIZACAO` | Nomes exibidos na tela de login. |
| `INATIVIDADE_MINUTOS` | Minutos sem uso até a saída automática (padrão 30). |
| `LIMITE_ARQUIVO_MB` | Tamanho máximo de cada anexo. Mudou aqui? Mude também no bucket `evidencias` (passo 4 da implantação). |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Só mudam se o projeto do Supabase mudar ou as chaves forem renovadas. |

Cuidado: mantenha as aspas simples e a vírgula no fim de cada linha. Se o
site parar de abrir depois de uma edição, desfaça-a: no GitHub, abra o
arquivo → **"History"** → a versão anterior → copie o conteúdo de volta.

### 9.2 Pela própria ferramenta (gestores)

- **Atividades:** criar, editar (regra de repetição, prazos, prioridade,
  responsáveis, "exige evidência"), arquivar, reativar e excluir.
- **Equipe:** militares, papéis, acessos, passagem de chefia.
- **Setores** e **feriados** (Equipe → Setores / Feriados).
- **Avisos.**
- **Contatos institucionais** (Equipe → Continuidade).

### 9.3 O que exige alguém técnico

- Mudar telas, textos fixos das telas, regras ou cálculos (arquivos
  `assets/js/`) e estilos (`assets/css/`).
- Mudar o banco (arquivos `supabase/*.sql`): sempre editando os scripts,
  rodando os testes e depois rodando os scripts de novo no SQL Editor.
- Mudar a Edge Function (`supabase/functions/admin-usuarios/`) e publicá-la.
- Restaurar dados a partir de uma cópia JSON (não há botão de importar).
- Renovar chaves do Supabase, mudar a CSP, usar endereço próprio.
- Atualizar a biblioteca do Supabase (`assets/vendor/supabase.js`).
- Levar a ferramenta para outro provedor ou para a infraestrutura do HABE.

**Para o técnico:** leia primeiro [ARQUITETURA.md](ARQUITETURA.md) (o
contrato entre banco, API e telas) e o [README](../README.md#testes); rode
os testes antes e depois de qualquer mudança. Regras que não podem ser
quebradas: a chave secreta (service_role) nunca vai para o navegador;
nenhum script ou estilo embutido no HTML (a CSP bloqueia); todo dado do
usuário entra nas telas escapado.

---

## 10. Responsáveis e revisões

Preencha à mão na cópia impressa (ou edite este arquivo no GitHub). Revise
a cada passagem de função e ao menos uma vez por ano.

| Item | Responsável (posto/nome/função) | Última revisão | Próxima revisão | Visto |
|---|---|---|---|---|
| Responsável técnico da ferramenta | | | | |
| Titular do e-mail institucional da AQS | | | | |
| Envelope: senha da conta institucional na ferramenta | | | | |
| Envelope: chave do 2FA da conta institucional | | | | |
| GitHub — conta institucional e colaborador | | | | |
| Supabase — donos da organização (2) | | | | |
| Hospedagem — titular e 2º membro | | | | |
| Teste anual da chave reserva (conta institucional) | | | | |
| Cópia de segurança mensal (última feita em) | | | | |
| Feriados do ano seguinte cadastrados | | | | |
| Revisão anual da equipe e dos acessos | | | | |
| Revisão anual do Plano de Atividades | | | | |
| Consulta à Seção de TI / LGPD (documento nº) | | | | |
| Conferência pós-implantação (IMPLANTACAO, passo 10) | | | | |
| Revisão deste documento | | | | |
