# Arquitetura — HABE · AQS e NSP · Ferramenta de Gestão de Atividades

Documento de referência para quem mantém o código. É o **contrato** entre o
banco (SQL), a camada de API (JS) e as telas. Mudou um, atualize aqui.

Tudo em português (código, comentários, textos). JavaScript em ES5 com
módulos IIFE (`var Modulo = (function () { 'use strict'; ... })();`),
Promises, sem módulos ES, sem etapa de compilação — o mesmo estilo do HABE SINAN.

---

## 1. Visão geral

```
navegador (index.html)                         Supabase (São Paulo)
┌──────────────────────────────────┐           ┌──────────────────────────────┐
│ páginas (assets/js/paginas/*.js) │           │ Auth (e-mail+senha, TOTP)    │
│   ↓ usam                         │           │ Postgres + RLS (supabase/*.sql)│
│ Api (api.js, fachada)            │──HTTPS──▶ │ Storage: bucket privado      │
│   ↓ delega a                     │           │   "evidencias"               │
│ ApiSupabase (api-supabase.js)    │◀──WSS──── │ Realtime (postgres_changes)  │
│   ou ApiDemo (api-demo.js)       │           │ Edge Function admin-usuarios │
└──────────────────────────────────┘           └──────────────────────────────┘
```

* `index.html` — o sistema real (Supabase).
* `demo.html` — modo demonstração: mesmo código de telas, mas com `ApiDemo`
  (dados fictícios em memória/sessionStorage, sem rede). Faixa vermelha
  "MODO DEMONSTRAÇÃO" sempre visível.

### Papéis e continuidade (decisão do usuário)

* `adjunto` — executa e registra as suas missões.
* `chefia` — tudo o que o adjunto faz + gestão de atividades, avisos e **usuários**.
* `administrador` — a **conta institucional da AQS** (e-mail institucional, não pessoal). Tem todos
  os poderes da chefia e é a âncora de continuidade: existe para que a ferramenta continue
  administrável quando chefes, adjuntos ou o responsável técnico mudarem. Não recebe missões
  (não aparece nas listas de responsáveis, no placar nem nos relatórios por militar).
* **Gestor** = chefia **ou** administrador. Em todo o contrato, "gestor" é quem pode administrar.
* Gestores **incluem, alteram (inclusive o papel), desativam e excluem** qualquer militar, inclusive
  a chefia. Exceção: só um administrador cria, altera, desativa, exclui ou redefine a senha de uma
  conta de administrador (a chefia não consegue derrubar a conta institucional).
* Trava anti-bloqueio: nenhuma operação pode deixar o sistema sem **ao menos uma conta de gestor
  ativa e com acesso** (`ativo` e `usuario_id` não nulo).
* Excluir um militar preserva o histórico: as colunas de autoria passam a nulo e os nomes ficam
  gravados nas colunas `*_nome` (instantâneo no momento do registro).
* Passagem de chefia guiada (RPC `transferir_chefia`), alertas de continuidade no Início para os
  gestores e o manual `docs/CONTINUIDADE.md` (o que fazer quando alguém sai).
* Segundo fator (TOTP): opcional, recomendado para gestores. Quem o ativou só é reconhecido pelo
  banco com a sessão confirmada pelo código (`aal2`) — `privado.mfa_ok()` está dentro de
  `meu_militar_id`, `eh_gestor` e `eh_administrador`, então vale em todas as políticas e RPCs (senha
  vazada sozinha não lê nem grava nada pela API REST). A Edge Function exige o mesmo dos gestores.
* Implantação e emergência (ninguém mais consegue administrar): `privado.vincular_usuario` no SQL
  Editor — passo a passo em `docs/IMPLANTACAO.md` e `docs/CONTINUIDADE.md`.

### Ordem de carga dos scripts

`index.html`:
```
assets/vendor/supabase.js
assets/js/config.js
assets/js/util.js
assets/js/regras.js
assets/js/recorrencia.js
assets/js/api-supabase.js
assets/js/api.js
assets/js/sessao.js
assets/js/tempo-real.js
assets/js/paginas/detalhe.js      (define o global Detalhe, usado por várias páginas)
assets/js/paginas/inicio.js
assets/js/paginas/quadro.js
assets/js/paginas/atividades.js
assets/js/paginas/avisos.js
assets/js/paginas/relatorios.js
assets/js/paginas/plano.js
assets/js/paginas/equipe.js
assets/js/paginas/conta.js
assets/js/app.js                  (último: inicia tudo)
```
`demo.html`: igual, trocando `assets/vendor/supabase.js` e
`assets/js/api-supabase.js` por `assets/js/dados-demo.js` e
`assets/js/api-demo.js` (nessa ordem, no lugar de api-supabase.js).

Folhas de estilo (ambas as páginas): `assets/css/base.css` (cópia do SINAN),
`assets/css/aqs.css` (casca e componentes comuns),
`assets/css/telas-operacao.css` (início, quadro, detalhe/calendário),
`assets/css/telas-gestao.css` (atividades, avisos, relatórios, plano, equipe, conta).

### CSP (sem exceções)

`script-src 'self'` e `style-src 'self'`: **nenhum** `<script>` inline,
nenhum `onclick=""`, **nenhum `style="..."`** em HTML (nem em strings
montadas para `innerHTML`). Use classes; para valores dinâmicos use o CSSOM
(`el.style.x = ...`, permitido) ou `data-largura="NN"` + `U.aplicarLarguras(raiz)`.
SVG pode usar atributos de apresentação (`stroke-dasharray="..."`).
Exceção única: o arquivo Word (.doc) gerado para download pode ter estilos
inline — ele não é renderizado pela página.

---

## 2. Globais disponíveis no navegador

| Global | Arquivo | Para quê |
|---|---|---|
| `AQS_CONFIG` | config.js | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `INATIVIDADE_MINUTOS` (30), `LIMITE_ARQUIVO_MB` (20), `NOME_SISTEMA`, `SUBTITULO`, `ORGANIZACAO`, `CONTATO_SUPORTE` (texto exibido na tela de login: a quem recorrer para senha/acesso) |
| `U` | util.js | DOM (`$`, `$$`), `esc`, `escMultilinha`, datas no fuso de Belém (`hojeBelem`, `paraData`, `paraTexto`, `somarDias`, `diasEntre`, `formatarData`, `formatarDataCurta`, `formatarDataHora`, `tempoRelativo`, `mesPorExtenso`, `descreverPrazo`, `MESES`, `DIAS_SEMANA`), `torrada(msg, tipo)`, `falha(erro)`, `abrirPainel(tituloHtml, corpoHtml, aoMontar(painelEl), {largo, aoFechar})`, `fecharPainel`, `painelAberto`, `confirmar`, `baixarConteudo`, `abrirBlob`, `baixarCsv`, `comprimirImagem(file)→Promise<File|null>`, `formatarTamanho`, `iconeArquivo`, `nomeSeguro`, `uuid`, `agrupar`, `ordenarTexto`, `adiar`, `anelProgresso(pct, rotulo)`, `aplicarLarguras(raiz)` |
| `Regras` | regras.js | regras puras compartilhadas (UI e ApiDemo) — §5 |
| `Recorrencia` | recorrencia.js | geração de datas, espelho exato da função SQL — §4 |
| `ApiSupabase` / `ApiDemo` | api-*.js | adaptadores; **as páginas nunca os usam diretamente** |
| `Api` | api.js | fachada: valida o adaptador e expõe os métodos — §6 |
| `Sessao` | sessao.js | login, troca de senha, MFA, inatividade — §7 |
| `TempoReal` | tempo-real.js | assinatura de mudanças e ressincronização — §7 |
| `Paginas` | paginas/*.js | `Paginas.<rota> = { titulo, render(el, params), aoVivo? }` |
| `Detalhe` | paginas/detalhe.js | `Detalhe.abrirOcorrencia(id)`, `Detalhe.abrirAtividade(id)`; peças usadas por Início e Quadro: `cartaoMissaoHtml(oc, ctx, opcoes)`, `acaoRapida(oc, acao, botao)`, `tratarClique(evento, buscar)`, `compararAbertas`, `seloPrazo(oc, hoje)`, `chipsResponsaveis(ids, mapa, euId)` |
| `FormAtividade` | paginas/atividades.js | `FormAtividade.abrir(atividade \| null, valoresIniciais?, opcoes?)` — formulário de criação/edição (usado por Detalhe e Avisos); `opcoes.voltar(id)` é chamada depois de salvar, arquivar, reativar ou cancelar (o Detalhe reabre a atividade) |
| `App` | app.js | `App.navegar()`, `App.ir(hash)`, `App.recarregar(tabelas?)`, `App.aoAtualizarPainel(fn)`, `App.atualizarContadores()`, `App.militar()` (perfil logado), `App.eChefia()` (= `Regras.eGestor`), `App.eGestor()`, `App.eAdministrador()`, `App.preferenciaTema()`, `App.definirTema('automatico'\|'claro'\|'escuro')` |

`Paginas` é declarado em `regras.js` como `var Paginas = window.Paginas || {};`
para existir antes de qualquer página.

---

## 3. Modelo de dados (Postgres, schema `public`)

Convenções: chaves `uuid default gen_random_uuid()`; datas de calendário em
`date` (fuso America/Belem); instantes em `timestamptz`. Os objetos JS têm
**exatamente os mesmos nomes de campo** das colunas (snake_case).

Função de data: `public.hoje_belem() returns date` =
`(now() at time zone 'America/Belem')::date`.

### Enumerações (colunas `text` com `check`)
* `papel`: `administrador` | `chefia` | `adjunto`
* `tipo` (atividade): `recorrente` | `pontual` | `sob_demanda`
* `periodicidade`: `diaria_util` | `semanal` | `mensal` | `trimestral` | `semestral` | `anual` (só quando `tipo = 'recorrente'`; senão `null`)
* `prioridade`: `baixa` | `normal` | `alta` | `urgente`
* `status` (ocorrência): `pendente` | `em_andamento` | `concluida` | `nao_se_aplica`
* `nivel` (aviso): `informativo` | `importante` | `urgente`
* `tipo` (notificação): `atribuicao` | `comentario` | `aviso` | `prazo`

### Tabelas

**setores** — `id`, `sigla` (único), `nome`, `cor` (default `'#1b5aa8'`), `ordem` int default 0, `criado_em`.

**militares** — `id`, `usuario_id` uuid único nulo → `auth.users(id)` on delete set null,
`posto` text not null default `''` (ex.: `1º Ten`, `Cap`, `Maj`), `nome_guerra` not null,
`nome_completo` text, `email` text (único quando não nulo, sempre minúsculo),
`setor_id` → setores, `papel` default `'adjunto'`, `ativo` bool default true,
`deve_trocar_senha` bool default true, `ultimo_acesso` timestamptz,
`criado_em`, `atualizado_em`. A unicidade de `usuario_id` é `deferrable initially immediate` (exigido por
`vincular_usuario`): não use `usuario_id` como alvo de `on conflict`/upsert.
Gatilho também em INSERT (normalização, proteção do administrador); ninguém exclui o próprio cadastro
nem desativa o próprio acesso.
Gatilho (BEFORE UPDATE/DELETE): impede a operação se, depois dela, não restar nenhum gestor
(papel chefia ou administrador) `ativo` e com `usuario_id` não nulo — mensagem:
'É preciso manter ao menos uma conta de chefia ou administrador ativa e com acesso.'
(Na carga inicial ainda não há logins; a trava só vale quando a linha alterada era um gestor com acesso.)

**atividades** — `id`, `ordem` int (nº no plano; default = max+1),
`titulo` not null (3..200), `descricao` text default `''`, `setor_id` → setores,
`tipo`, `periodicidade`, `dia_semana` int 1..7 (ISO: 1=segunda … 5=sexta),
`dia_mes` int 1..31 (31 = último dia do mês), `mes_inicio` int 1..12 (âncora de
trimestral/semestral/anual), `prazo` date (só pontual; nulo = sem prazo),
`antecipar_dia_util` bool default true, `prioridade` default `'normal'`,
`exige_evidencia` bool default false, `ativa` bool default true,
`data_inicio` date default `hoje_belem()`, `criado_por` → militares on delete set null,
`criado_em`, `atualizado_em`.
Checks: recorrente ⇒ periodicidade não nula; semanal ⇒ dia_semana; mensal/trimestral/semestral/anual ⇒ dia_mes;
trimestral/semestral/anual ⇒ mes_inicio; não recorrente ⇒ periodicidade nula.

**atividade_responsaveis** — `atividade_id` → atividades on delete cascade, `militar_id` → militares on delete cascade; PK dupla.
(Excluir um militar pode deixar atividades sem responsável — o Início avisa os gestores.)

**ocorrencias** (cada execução/período de uma atividade) — `id`,
`atividade_id` → atividades on delete cascade, `referencia` text nulo
(ver §4; nulo para execuções sob demanda), `titulo_execucao` text nulo
(ex.: "Incidente 2026/041"), `prazo` date nulo, `status` default `'pendente'`,
`observacao` text default `''`, `justificativa` text nulo,
`iniciada_em`, `concluida_em` timestamptz, `concluida_por` → militares on delete set null,
`concluida_por_nome` text (instantâneo do nome, gravado pelo gatilho), `criado_por` → militares nulo
on delete set null, `criado_em`, `atualizado_em`.
`unique (atividade_id, referencia)`. Check: `nao_se_aplica` exige justificativa não vazia.
Gatilho: carimba `iniciada_em` (ao ir para em_andamento), `concluida_em`/`concluida_por`
(ao ir para concluida; limpa ao sair) e impede que não-chefia altere
`atividade_id`, `referencia` ou `prazo`.

**v_ocorrencias** (view, `with (security_invoker = true)`) — todas as colunas de
ocorrencias + `atividade_titulo`, `atividade_tipo`, `periodicidade`, `prioridade`,
`setor_id`, `exige_evidencia`, `responsaveis` uuid[] (vazio se nenhum),
`data_ref` date = `coalesce(prazo, (criado_em at time zone 'America/Belem')::date)`,
`atrasada` bool = status em (pendente, em_andamento) e prazo < hoje_belem(),
`concluida_no_prazo` bool = status concluida e (prazo nulo, ou data de conclusão em Belém <= prazo, ou
`concluida_em = criado_em` — a ocorrência nasceu concluída: execução registrada depois de feita, com a
data em que ocorreu, não tem prazo a cumprir),
`qtd_evidencias` int, `qtd_comentarios` int.

**evidencias** — `id`, `atividade_id` not null → atividades on delete cascade,
`ocorrencia_id` nulo → ocorrencias on delete cascade, `storage_path` único,
`nome`, `mime`, `tamanho` bigint, `descricao` text default `''`,
`enviado_por` → militares on delete set null, `enviado_por_nome` text (instantâneo), `enviado_em`.

**comentarios** — `id`, `atividade_id` not null → cascade, `ocorrencia_id` nulo → cascade,
`autor_id` → militares on delete set null, `autor_nome` text e `autor_papel` text (instantâneos,
gravados pelo gatilho na inserção), `texto` not null (1..4000), `criado_em`. Sem edição.

**avisos** — `id`, `titulo` not null, `mensagem` text default `''`, `nivel` default `'informativo'`,
`para_todos` bool default true, `prazo` date nulo, `atividade_id` nulo → atividades on delete set null,
`fixado` bool default false, `expira_em` date nulo, `criado_por` → militares on delete set null,
`criado_por_nome` text (instantâneo), `criado_em`, `atualizado_em`.

**avisos_destinatarios** — `aviso_id` → cascade, `militar_id` → cascade; PK dupla (só usada quando `para_todos = false`).

**avisos_ciencia** — `aviso_id` → cascade, `militar_id` → cascade, `ciente_em` default now(); PK dupla.

**notificacoes** — `id`, `destinatario_id` → militares on delete cascade, `tipo`, `titulo`, `mensagem`,
`atividade_id`, `ocorrencia_id`, `aviso_id` (nulos; → atividades/ocorrencias/avisos on delete cascade),
`lida` bool default false, `criado_em`. `privado.rotina_diaria()` apaga as lidas com mais de 180 dias.
Dar ciência de um aviso (`Api.darCiencia`) marca como lida a notificação dele.
Preenchida só por gatilhos/funções SECURITY DEFINER:
* inserção em atividade_responsaveis → `atribuicao` para o militar (exceto se ele mesmo fez);
* inserção em comentarios → `comentario` para responsáveis da atividade e chefias ativas (não o administrador), exceto o autor;
* inserção em avisos → `aviso` para os destinatários (ou todos os ativos), exceto o autor
  (destinatários inseridos depois do aviso também são notificados — gatilho em avisos_destinatarios);
* `privado.notificar_prazos()` (diária + dentro de `gerar_ocorrencias`) → `prazo` para os responsáveis de
  ocorrências abertas com prazo hoje ou amanhã, no máximo uma por ocorrência por dia.

**feriados** — `data` date PK, `descricao`.

**configuracoes** — `chave` text PK, `valor` jsonb not null, `atualizado_em`, `atualizado_por` → militares
on delete set null. Chaves usadas: `contatos` (`{ email_institucional, responsavel_tecnico, telefone,
observacoes }`), `ultimo_backup` (`{ em, por_nome }`, gravado por `Api.exportarTudo`).

**auditoria** — `id` bigserial, `quando` timestamptz default now(), `militar_id` uuid nulo (sem FK),
`militar_nome` text (instantâneo),
`usuario_id` uuid nulo, `tabela`, `operacao` (INSERT/UPDATE/DELETE, ou `ADMIN:<ação>` — check
`^ADMIN:[a-z_]{1,40}$`), `registro_id` text, `antes` jsonb, `depois` jsonb. Gatilho genérico AFTER em:
setores, militares, atividades, atividade_responsaveis, ocorrencias, evidencias, comentarios, avisos,
feriados, configuracoes (atualizações que só mudam `atualizado_em`/`ultimo_acesso` não são gravadas).
A Edge Function `admin-usuarios` grava cada ação de acesso como `tabela = 'auth.users'`,
`operacao = 'ADMIN:<ação>'`, `registro_id` = id do militar, `depois.acao = 'ADMIN:<ação>'` — nunca a senha.

### Funções auxiliares (schema `privado`, não exposto pela API REST)
SECURITY DEFINER, STABLE, `set search_path = ''`, usadas nas políticas como
`(select privado.eh_gestor())`:
* `privado.mfa_ok() → bool` (sessão `aal2`, ou o usuário não tem fator TOTP verificado em `auth.mfa_factors`)
* `privado.meu_militar_id() → uuid` (militar ativo ligado a `auth.uid()` e com `mfa_ok()`; nulo se não houver)
* `privado.eh_ativo() → bool`
* `privado.eh_gestor() → bool` (ativo, papel chefia ou administrador, e `mfa_ok()`) — usada onde o contrato diz "gestor"
* `privado.eh_administrador() → bool` (ativo, papel administrador, e `mfa_ok()`)
* `privado.eh_responsavel(atividade uuid) → bool`
* `privado.datas_ocorrencia(...)` e `privado.notificar_prazos()` — §4
* `privado.vincular_usuario(email text, militar uuid default null)` — implantação e **recuperação de
  emergência** (rodada no SQL Editor pelo dono do projeto): liga o usuário do Auth com esse e-mail ao
  militar indicado — por padrão, à conta institucional (papel administrador) — reativa-o e grava o e-mail.
* `privado.nome_militar(id uuid) → text` (posto + nome de guerra; usado nos instantâneos)
* outros auxiliares internos: `pode_enviar_evidencia(pasta)` (política do Storage), `resumir`, `json_*`
  (leitura validada do JSON de `salvar_atividade`), `eh_dia_util`, `antecipar_dia_util`,
  `gerar_ocorrencias_atividade`, `gerar_todas`, `rotina_diaria` (pg_cron).

### RPCs públicas (expostas; `grant execute ... to authenticated`, revogado de anon)
* `meu_perfil() → militares` — registra `ultimo_acesso = now()` (no máximo 1×/minuto) e devolve a linha do
  militar logado (erro `'sem_cadastro'` se não houver militar ativo ligado ao usuário; erro 42501
  "Confirme o código do aplicativo autenticador (segundo fator)…" se faltar o `aal2`).
* `confirmar_troca_senha() → void` — `deve_trocar_senha = false` para o próprio militar.
* `salvar_atividade(p jsonb) → uuid` — cria/atualiza a atividade e seus responsáveis de forma atômica.
  `p`: `{id?, ordem?, titulo, descricao, setor_id, tipo, periodicidade, dia_semana, dia_mes, mes_inicio,
  prazo, antecipar_dia_util, prioridade, exige_evidencia, ativa, data_inicio, responsaveis: [militar_id]}`.
  Permissões: gestor tudo. Adjunto: **criar** só `pontual` ou `sob_demanda` incluindo a si mesmo
  em `responsaveis`; **editar** só atividades em que é responsável e sem alterar `responsaveis`
  (lista diferente ⇒ erro). Se mudar regra de agenda/`ativa`/`data_inicio`: apaga ocorrências futuras
  (prazo >= hoje) ainda `pendente` sem evidências nem comentários e regenera. Para `pontual`, mantém a
  ocorrência única `P` com o mesmo prazo (se ainda não concluída). **Arquivar** (`ativa` true → false)
  passa a `nao_se_aplica` tudo o que ainda estava em aberto, com a justificativa
  "Atividade arquivada em DD/MM/AAAA por …" (nada fica "atrasado" cobrando a atividade arquivada).
  Também recusa: adjunto transformando atividade em recorrente; responsável novo inativo ou
  administrador. Chave ausente no JSON mantém o valor (edição) ou o padrão (criação); presente com
  null/'' limpa; sem `responsaveis` na edição, o conjunto fica como está.
  Erros: 42501 sem permissão; 22023 dado inválido; P0002 não encontrado (mensagens prontas).
* `gerar_ocorrencias() → int` — idempotente; qualquer usuário ativo pode chamar.
* `transferir_chefia(p_de uuid, p_para uuid, p_papel_anterior text default 'adjunto', p_transferir_atividades boolean default true) → void`
  — só gestor. `p_para` vira `chefia` (e é reativado se preciso); `p_de` (pode ser nulo quando não há
  chefia) passa a `p_papel_anterior` (`adjunto` ou `chefia` para manter); com `p_transferir_atividades`,
  as responsabilidades de `p_de` em atividades ativas passam para `p_para`. Atômica; respeita a trava
  anti-bloqueio. Desativar/excluir o antigo chefe é feito depois, pelas ações de acesso.
* (As demais operações são INSERT/UPDATE/DELETE diretos, protegidos por RLS.)

### Regras de acesso (RLS — todas `to authenticated`; anon sem nenhum acesso)
"ativo" = `privado.eh_ativo()` (vale em TODAS as políticas: desativar corta o acesso na hora).

| tabela | select | insert | update | delete |
|---|---|---|---|---|
| setores, feriados, configuracoes | ativo | gestor | gestor | gestor |
| militares | ativo | gestor (¹) | gestor (¹) | gestor (¹), nunca a si mesmo |
| atividades | ativo | via RPC | via RPC | gestor |
| atividade_responsaveis | ativo | via RPC | — | via RPC |
| ocorrencias | ativo | gestor; ou responsável quando a atividade é `sob_demanda` | gestor ou responsável | gestor |
| evidencias | ativo | (gestor ou responsável) e `enviado_por` = eu | — | gestor ou quem enviou |
| comentarios | ativo | ativo e `autor_id` = eu | — | autor ou gestor |
| avisos | gestor, `para_todos`, ou sou destinatário | gestor | gestor | gestor |
| avisos_destinatarios | ativo | gestor | — | gestor |
| avisos_ciencia | gestor ou a própria linha | eu, aviso visível | — | — |
| notificacoes | as minhas | (gatilhos) | as minhas (`lida`) | as minhas |
| auditoria | gestor | (gatilhos) | — | — |

(¹) Linhas com `papel = 'administrador'` (antes ou depois da mudança) só por administrador.
Todas as mudanças passam pela trava anti-bloqueio.

**Storage**: bucket privado `evidencias`, limite 20 MB, tipos permitidos:
pdf, doc, docx, xls, xlsx, ppt, pptx, odt, ods, odp, jpg/jpeg, png, txt, csv.
Caminho: `{atividade_id}/{ocorrencia_id ou 'geral'}/{uuid}-{nome-seguro}`.
Políticas em `storage.objects` (bucket `evidencias`): SELECT ativo; INSERT ativo e (gestor ou
responsável pela atividade da 1ª pasta); DELETE gestor ou dono (`owner_id = auth.uid()::text`);
UPDATE nenhum.

---

## 4. Ocorrências e recorrência

Somente atividades `ativa` e `tipo = 'recorrente'` geram ocorrências automáticas.
A mesma regra existe em SQL (`privado.datas_ocorrencia`) e em JS
(`Recorrencia.datas`) — **saída idêntica**, conferida por `testes/paridade-recorrencia.mjs`.

**Dia útil**: segunda a sexta que não esteja em `feriados`.
**Antecipar**: se `antecipar_dia_util`, enquanto o prazo não for dia útil, recua um dia.

Para uma atividade e um intervalo `[de, ate]`, a lista de `{referencia, prazo}`:

* `diaria_util` — cada dia útil `d` do intervalo: `referencia = 'D' || d` (ex. `D2026-10-15`), prazo `d`.
  (A antecipação não se aplica: só dias úteis geram ocorrência.)
* `semanal` — para cada semana ISO: alvo = segunda-feira da semana + (`dia_semana` − 1) dias;
  prazo = alvo (antecipado se for o caso); `referencia = 'S' || ano_iso || '-W' || semana_iso com 2 dígitos`
  (ex. `S2026-W42`; atenção: 2026 tem semana 53).
* `mensal` / `trimestral` / `semestral` / `anual` — para cada mês `m` do calendário em que
  (`mensal`: todo mês; `trimestral`: (m − mes_inicio) mod 3 = 0; `semestral`: mod 6 = 0;
  `anual`: m = mes_inicio): alvo = dia `least(dia_mes, último dia do mês)`; prazo = alvo (antecipado);
  `referencia` = prefixo || `'AAAA-MM'` do mês nominal, prefixos `M`, `T`, `H`, `A`
  (ex. `M2026-10`, `T2027-01`, `H2026-07`, `A2027-03`).
* Inclusão: a ocorrência entra se o **prazo final** (após antecipar) estiver em `[de, ate]`.
  Para não perder períodos cuja antecipação cai dentro do intervalo, percorrer meses/semanas a
  partir de um período antes de `de` até um período depois de `ate`.

`gerar_ocorrencias()`: para cada atividade recorrente ativa,
`de = greatest(data_inicio, hoje − 45)`, `ate = hoje` para `diaria_util` e `hoje + 31` para as demais;
insere com `on conflict (atividade_id, referencia) do nothing`; depois chama `notificar_prazos()`.
Agendada pelo pg_cron às 00:05 de Belém (`5 3 * * *` UTC) e chamada também pelo app após o login.

`pontual`: gatilho AFTER INSERT cria uma ocorrência `referencia = 'P'`, prazo = `atividades.prazo`.
`sob_demanda`: nada automático; "Registrar execução" insere uma ocorrência (`referencia` nula,
`titulo_execucao` livre, prazo opcional, status normalmente `concluida`).

---

## 5. `Regras` (regras.js) — funções puras

* `Regras.ROTULOS` — `{ papel, tipo, periodicidade, prioridade, status, nivel, notificacao }` (papel:
  administrador → 'Administrador (conta institucional AQS)', chefia → 'Chefia', adjunto → 'Adjunto'), cada um
  `{ valor: 'Rótulo' }`. Status efetivo inclui `atrasada: 'Atrasada'`.
* `Regras.TIPOS_ARQUIVO` — `{ extensao: mime }` permitido; `Regras.ACCEPT` (string para `<input accept>`).
* `Regras.validarArquivo(file, limiteMb?) → null | 'mensagem'`.
* `Regras.validarSenha(s) → null | 'mensagem'` (mín. 10 caracteres, ao menos 1 letra e 1 número).
* `Regras.nomeMilitar(m) → '1º Ten Balieiro'` (posto + nome de guerra, sem espaços sobrando).
* `Regras.nomesResponsaveis(ids, mapaMilitares) → 'Ten Letícia, Ten Balieiro'`.
* `Regras.eChefia(m)` (papel chefia), `Regras.eAdministrador(m)` (papel administrador),
  `Regras.eGestor(m)` (chefia ou administrador, e ativo), `Regras.eResponsavel(m, atividadeOuOcorrencia)`
  (usa `.responsaveis`). **Todas as permissões "de chefia" usam `eGestor`.**
* `Regras.podeGerenciarUsuarios(m)`; `Regras.podeGerenciarMilitar(m, alvo, novoPapel?)` (gestor; se o alvo
  for ou passar a ser administrador, só administrador); `Regras.podeExcluirMilitar(m, alvo)` (idem e nunca a si mesmo).
* `Regras.militaresAtribuiveis(militares) → militares ativos com papel ≠ administrador` (listas de responsáveis, placar, relatórios por militar).
* `Regras.alertasContinuidade({ militares, atividades, feriados (lista), configuracoes, hoje }) → [{ nivel: 'urgente'|'atencao'|'info', titulo, texto, link }]`
  — só para gestores, mostrados no Início: (a) nenhuma conta de administrador ativa com acesso;
  (b) só um gestor ativo com acesso ("cadastre um segundo"); (c) atividades ativas sem responsável;
  (d) a partir de 1º de novembro, nenhum feriado cadastrado para o ano seguinte; (e) último backup
  (`configuracoes.ultimo_backup.em`) há mais de 35 dias ou nunca; (f) contatos institucionais não
  preenchidos; (g) militar com acesso que não entra há mais de 90 dias (revisar/desativar).
* `Regras.podeEditarAtividade(m, atividade)`, `Regras.podeCriarAtividade(m, tipo)`,
  `Regras.podeAlterarResponsaveis(m)`, `Regras.podeAtualizarOcorrencia(m, oc)`,
  `Regras.podeRegistrarExecucao(m, atividade)`, `Regras.podeEnviarEvidencia(m, atividade)`,
  `Regras.podeExcluirEvidencia(m, ev)`, `Regras.podeExcluirComentario(m, c)`,
  `Regras.podePublicarAviso(m)`, `Regras.podeVerAviso(m, aviso)`.
* `Regras.estaAtrasada(oc, hoje)`, `Regras.statusEfetivo(oc, hoje) → status | 'atrasada'`.
* `Regras.conformidade(ocorrencias, hoje) → { universo, concluidas, no_prazo, atrasadas, abertas, percentual }`
  — universo = ocorrências com status ≠ nao_se_aplica e (prazo <= hoje, ou sem prazo, ou concluídas);
  percentual = round(100 × concluidas / universo), `null` se universo = 0.
* `Regras.descreverRegra(atividade) → 'Mensal, até o dia 15'`, `'Semanal, às sextas-feiras'`,
  `'Diária (dias úteis)'`, `'Pontual — prazo 30/10/2026'`, `'Sob demanda'`,
  acrescentando `' (último dia útil)'`/`' (antecipa se não for dia útil)'` conforme o caso.
* `Regras.rotuloReferencia(oc) → 'Out/2026'` (M), `'Semana 42/2026'` (S), `'15/10/2026'` (D),
  `'Trimestre de out/2026'` (T), `'Semestre de jul/2026'` (H), `'Ano 2027'` (A), `'Única'` (P),
  ou `titulo_execucao`/data para execuções sob demanda.
* `Regras.mimeDe(file) → mime` (usa a extensão quando `file.type` vier vazio ou genérico).
* HTML de selos (usam classes de aqs.css): `Regras.seloStatus(statusEfetivo)`,
  `Regras.seloPrioridade(p)`, `Regras.seloNivel(n)`, `Regras.seloTipo(tipo)`.
* Extras (espelho de regras do banco que a tela antecipa): `MENSAGEM_TRAVA`, `violaTravaGestor(antes,
  militares)`, `gestoresComAcesso`, `eGestorComAcesso`, `eAtivo`, `validarEmail`, `podeDesativarMilitar`,
  `podeAssumirChefia` (a conta institucional não assume), `tiposPermitidos(m, atividade)` (adjunto: só
  pontual/sob demanda ao criar; o formulário nem mostra "Recorrente"), `rotuloPapelAutor(papel) →
  'CHEFIA'|'AQS'|''`, `podeComentar`, `podeExcluirAtividade`, `podeExcluirOcorrencia`,
  `podeAlterarPrazoOcorrencia`, `podeGerenciarEquipe`, `podeVerAuditoria`, `estaAberta`,
  `concluidaNoPrazo` (igual à coluna da view), `dataBelem`, `diasEntre`, `extensaoDe`, `STATUS_ABERTOS`.
  Em `Recorrencia`: `janelaGeracao`, `somarDias`, `diasEntre`, `diaSemana`, `dataValida`,
  `ultimoDiaDoMes`, `normalizarFeriados`.

## `Recorrencia` (recorrencia.js)
* `Recorrencia.datas(atividade, de, ate, feriados) → [{referencia, prazo}]` (ordenado por prazo;
  `feriados` é um objeto `{ 'AAAA-MM-DD': true }` ou array de strings).
* `Recorrencia.proximas(atividade, n, hoje, feriados) → [{referencia, prazo}]` (as n próximas a partir de hoje).
* `Recorrencia.eDiaUtil(data, feriados)`, `Recorrencia.antecipar(data, feriados)`, `Recorrencia.semanaIso(data) → {ano, semana}`.

---

## 6. API (`Api`, api.js) — todas devolvem Promise

Erros: `Error` com mensagem em português pronta para exibir (`U.falha(erro)`).
Objetos com os mesmos nomes de campos do banco.

**Sessão**
* `iniciar()` · `sessaoAtual() → {usuario_id, email} | null` · `aoMudarSessao(cb(evento: 'entrou'|'saiu')) → cancelar()`
* `entrar(email, senha, lembrar) → { precisaMfa: bool }` · `verificarMfa(codigo)`
* `sair(todosDispositivos?)` · `meuPerfil() → Militar` (erro "Seu usuário não está vinculado a um cadastro ativo…")
* `trocarSenha(nova)` (atualiza a senha e chama `confirmar_troca_senha`)
* `mfaFatores() → [{id, status, criado_em}]` · `mfaIniciarCadastro() → {fator_id, qr_code (data URI SVG), segredo}`
* `mfaConfirmarCadastro(fator_id, codigo)` · `mfaRemover(fator_id)`

**Referências** (cache na fachada)
* `referencias() → { setores, militares, mapaSetores: {id: setor}, mapaMilitares: {id: militar}, feriados: {data: true} }`
* `invalidarReferencias()` (síncrona)
* `listarSetores()` · `salvarSetor(s)` · `excluirSetor(id)`
* `listarMilitares() → [Militar]` (todos, inclusive inativos)
* `salvarMilitar(m) → Militar` (campos: id?, posto, nome_guerra, nome_completo, email, setor_id, papel, ativo;
  com acesso já criado, o e-mail só muda por `adminUsuario('alterar_email', …)`)
* `excluirMilitar(id)` — via Edge Function (`adminUsuario('excluir', id)`): apaga o cadastro e o usuário de acesso
* `transferirChefia({ de, para, papel_anterior, transferir_atividades })` (RPC `transferir_chefia`)
* `obterConfiguracoes() → { chave: valor }` · `salvarConfiguracao(chave, valor)` (gestor)
* `adminUsuario(acao, militar_id, extra?) → { senha_temporaria?, aviso?, email?, removidos? }` — `aviso` traz
  o que não deu para fazer no Auth (a tela mostra). acao: `criar` | `redefinir_senha` |
  `desativar` | `reativar` | `remover_mfa` | `alterar_email` (extra.email) | `excluir` (Edge Function
  `admin-usuarios`). Chamador: gestor ativo; contas de administrador só por administrador; ninguém
  desativa/exclui a si mesmo; a trava anti-bloqueio do banco vale (erro 409 com a mensagem do banco).
  `excluir` apaga primeiro a linha de militares (se a trava recusar, nada muda) e depois o usuário do Auth.
  Para militar COM login, desativar/reativar é por aqui (também bloqueia/desbloqueia o login); sem login,
  pelo campo `ativo` de `salvarMilitar`. As gravações em `militares` da função usam o token de quem
  chamou (RLS e auditoria com a identidade real); a service role fica só para `auth.admin.*`.
  Senha temporária: 14 caracteres (maiúscula, minúscula, número e um símbolo de `@#%+=`).
* `listarFeriados() → [{data, descricao}]` · `salvarFeriado(f)` (aceita `f.data_original` para trocar a data) ·
  `excluirFeriado(data)`. `referencias()` também traz `listaFeriados: [{data, descricao}]`.

**Atividades**
* `listarAtividades() → [Atividade & { responsaveis: [militar_id] }]` (todas, inclusive arquivadas), ordenadas por `ordem`
* `salvarAtividade(dados) → id` (RPC `salvar_atividade`)
* `excluirAtividade(id)` (chefia; remove antes os arquivos do Storage)
* `gerarOcorrencias() → int`

**Ocorrências** (linhas de `v_ocorrencias`)
* `listarOcorrencias({ de?, ate?, atividade_id?, somenteAbertas? }) → [VOcorrencia]`
  — `de`/`ate` filtram por `data_ref`; `somenteAbertas` = status pendente/em_andamento (ignora datas
  se `de`/`ate` não forem dados). Ordenadas por `data_ref`.
* `obterOcorrencia(id) → VOcorrencia`
* `criarOcorrencia({atividade_id, titulo_execucao, prazo, status, observacao}) → VOcorrencia`
* `atualizarOcorrencia(id, campos) → VOcorrencia` (campos ⊂ status, observacao, justificativa, titulo_execucao, prazo)
* `excluirOcorrencia(id)`

**Evidências**
* `listarEvidencias({ atividade_id?, ocorrencia_id? }) → [Evidencia]` (mais recentes primeiro)
* `enviarEvidencia({ atividade_id, ocorrencia_id, arquivo: File, descricao }) → Evidencia`
  (valida com `Regras.validarArquivo`; envia o objeto, depois grava a linha; se a linha falhar, remove o objeto)
* `baixarEvidencia(evidencia) → Blob` · `excluirEvidencia(evidencia)`

**Comentários**
* `listarComentarios({ atividade_id, ocorrencia_id? }) → [Comentario]` (mais antigos primeiro;
  com `ocorrencia_id`, só os daquela ocorrência)
* `comentar({ atividade_id, ocorrencia_id, texto }) → Comentario` · `excluirComentario(id)`

**Avisos**
* `listarAvisos({ incluirExpirados? }) → [Aviso & { destinatarios: [id], ciencias: [{militar_id, ciente_em}], ciente_por_mim: bool }]`
  (mais recentes primeiro; fixados antes). Expirado = `expira_em < hoje`.
* `salvarAviso(aviso & { destinatarios }) → Aviso` · `excluirAviso(id)` · `darCiencia(aviso_id)` (também marca
  como lida a notificação do aviso)

**Notificações**
* `listarNotificacoes({ limite? = 30 }) → [Notificacao]` (mais recentes primeiro)
* `contarNaoLidas() → int` · `marcarNotificacoesLidas(ids | null)` (null = todas)

**Chefia**
* `listarAuditoria({ limite? = 200, tabela? }) → [RegistroAuditoria]`
* `exportarTudo() → { sistema, origem: 'supabase'|'demonstracao', gerado_em, gerado_por, observacao,
  tabelas: { setores, militares, feriados, atividades, atividade_responsaveis, ocorrencias, evidencias,
  comentarios, avisos, avisos_destinatarios, avisos_ciencia, notificacoes, configuracoes, auditoria } }`
  (sem conteúdo de arquivos; nada do Auth); grava `configuracoes.ultimo_backup = { em, por_nome }` só
  depois de ler tudo.

**Tempo real**
* `assinarMudancas(cb({ tabela, evento })) → cancelar()` (demo: nunca dispara). Canal único com as 10 tabelas
  da publicação (03-tempo-real-agenda.sql); notificações filtradas pelo militar logado; depois de uma
  queda, reassina com espera crescente (1 s … 60 s) e emite `{ tabela, evento: 'RESSINCRONIZAR' }`
  para todas, exceto notificações.

A fachada (`api.js`) mantém a lista canônica `Api.METODOS`; ao carregar, verifica que o
adaptador presente implementa todos e falha alto se faltar algum. `Api.modo` é `'supabase'` ou `'demo'`.

---

## 7. Casca (app.js, sessao.js, tempo-real.js)

* `index.html` tem `#telaAcesso` (login, troca de senha, MFA, configuração pendente) e `#telaApp`
  (cabeçalho, navegação, `<main class="conteudo">` com uma `<section class="pagina oculto" id="pagina-ROTA">`
  por rota, rodapé), `#painelDetalhe` e `#avisosFlutuantes`.
* Rotas: `inicio` (padrão), `quadro`, `atividades`, `avisos`, `relatorios`, `plano`, `equipe`, `conta`.
  Parâmetros `?ocorrencia=ID` e `?atividade=ID` em qualquer rota abrem o painel de detalhe (ao fechar o
  painel, a casca tira o parâmetro do endereço). Quadro: `escopo=minhas|todas`, `responsavel=ID|sem`,
  `setor=ID`, `periodo=semana|mes|30dias|atrasadas`, `modo=quadro|calendario`, `mes=AAAA-MM`,
  `diarias=0|1`. Equipe: `aba=militares|chefia|setores|feriados|continuidade|auditoria` (aceita
  `passagem`). Atividades: `tipo`, `responsavel` (`sem`), `setor`.
* Ao sair, a casca apaga páginas, cabeçalho, menus, torradas, as preferências de tela guardadas na aba
  (`aqs_quadro_estado:*`, `aqs_inicio_visao:*`, `aqs_atividades_filtros`, `aqs_plano_filtros`,
  `aqs_relatorios_periodo`) e volta o endereço para `#/inicio` — quem entra depois começa limpo.
* Navegação: abas no cabeçalho (≥ 720 px); barra inferior no celular (Início, Quadro, Avisos,
  Atividades, Mais → Relatórios, Plano, Equipe, Minha conta, Sair). Equipe aparece para todos
  (somente leitura para adjuntos).
* Cabeçalho: brasão, "HABE · AQS e NSP" / "Ferramenta de Gestão de Atividades", nome do militar logado,
  sino com contador (lista de notificações em painel suspenso), botão de tema, botão sair.
* `App.recarregar(tabelas)`: invalida referências se `militares`/`setores`/`feriados` mudaram; chama a
  função registrada por `App.aoAtualizarPainel(fn)` se o painel estiver aberto; re-renderiza a página
  atual se `Paginas[rota].aoVivo !== false` **e** o foco não estiver num campo de formulário da página
  (nesse caso, adia até o campo perder o foco). Extensão: `aoVivo` pode ser uma função
  `(el, params, tabelas)` que atualiza só o necessário, sem remontar (preserva filtros e rascunhos).
* `TempoReal`: `Api.assinarMudancas` → adia 300 ms → `App.recarregar(tabelas)`; ressincroniza ao
  voltar a aba/tela (`visibilitychange`) e a cada 5 min; mudança em `notificacoes` atualiza o sino e
  mostra uma torrada.
* Painel lateral: **quem abre um painel** (`U.abrirPainel`) chama logo em seguida
  `App.aoAtualizarPainel(fn ou null)` — `fn` recarrega o conteúdo do painel quando chegam mudanças
  (detalhe); formulários passam `null` para não serem apagados enquanto o usuário digita.
  `App.recarregar` só chama a função registrada se `U.painelAberto()`.
* Equipe (gestores): abas Militares | Passagem de chefia | Setores | Feriados | Continuidade | Auditoria.
  "Continuidade" mostra e edita `configuracoes.contatos`, o último backup (com o botão Exportar tudo),
  a lista de gestores com acesso e o resumo do plano de continuidade (docs/CONTINUIDADE.md).
* Comentários e avisos mostram o selo do papel do autor: 'CHEFIA' (chefia) ou 'AQS' (administrador).
* Demonstração: `ApiDemo.usuariosDemo() → [{email, nome, papel}]` (fora do contrato `METODOS`) alimenta
  os botões "Entrar como …" da tela de login do `demo.html`; qualquer senha não vazia é aceita.
* `Sessao`: inatividade (`AQS_CONFIG.INATIVIDADE_MINUTOS`) ⇒ sai e avisa; "lembrar neste dispositivo"
  decide localStorage × sessionStorage para o token; troca de senha obrigatória quando
  `deve_trocar_senha`; segundo fator quando houver TOTP.
* Página: `Paginas.x = { titulo: 'Quadro', render: function (el, params) {...} }`. `render` mostra
  "Carregando…", busca dados via `Api`, monta HTML com `U.esc`, liga eventos com `addEventListener`
  e chama `U.aplicarLarguras(el)`. Erros: `U.falha(erro)` e mensagem no próprio `el`.

## 8. Classes CSS comuns (aqs.css) — além das de base.css
`.cartao`, `.botao*`, `.campo*`, `.selo*`, `.indicador*`, `.tabela`, `.aviso*`, `.filtro*`,
`.zona-anexo`, `.lista-anexos`, `.anexo-item*`, `.barra-linha*`, `.painel*`, `.torrada*`,
`.grade--2/3/4`, `.dados-lista`, `.oculto` já existem em base.css. aqs.css acrescenta:
* casca: `.tela-acesso`, `.cartao-acesso`, `.faixa-demo`, `.usuario-chip`, `.sino`, `.sino__contador`,
  `.menu-notificacoes`, `.notificacao-item(--nao-lida)`, `.barra-inferior`, `.barra-inferior__item(--ativo)`,
  `.menu-mais`, `.sem-rolagem`, `.painel__titulo`, `.painel--largo`, `.rodape`.
* componentes: `.anel` (+ `--completo/--bom/--medio/--baixo`, `__numero`, `__rotulo`, `__trilho`, `__valor`),
  `.abas` / `.aba` / `.aba--ativa`, `.vazio` (estado vazio com ícone), `.carregando`, `.acoes` (linha de botões),
  `.chip` (responsável), `.medalha`, `.contador` (badge numérico), `.texto-suave`, `.texto-pequeno`,
  `.mt-0/.mt-1/.mt-2/.mb-0/.mb-1`, `.alinhar-direita`, `.flex`, `.flex--entre`, `.flex--centro`, `.gap-1`,
  `.cresce`, `.barra-progresso` + `.barra-progresso__preenchimento` (largura via data-largura).
* selos: `.selo--pendente`, `.selo--em_andamento`, `.selo--concluida`, `.selo--nao_se_aplica`,
  `.selo--atrasada`, `.selo--prio-baixa/normal/alta/urgente`, `.selo--nivel-informativo/importante/urgente`,
  `.selo--tipo-recorrente/pontual/sob_demanda`.
* impressão: `.cabecalho-impressao` (só aparece no papel), `.rodape-impressao`, `.nao-imprimir`.
  A casca imprime o próprio cabeçalho/rodapé institucional; se a página trouxer os seus, os da casca somem.
* extras de aqs.css: `.titulo-secao`, `.botao--texto`, `.botao--perigo-secundario`, `.avatar(--grande/
  --administrador/--adjunto)`, `.selo--chefia`/`.selo--aqs` (autor), `.selo--papel-*`, `.chip--eu`,
  `.contador--urgente/--neutro`, `.so-gestor`, `.so-celular`, `.so-computador`, `.sem-quebra`. Ícones:
  `<svg class="icone" aria-hidden="true"><use href="#i-NOME"></use></svg>` (sprite em index/demo.html).
* No máximo 3 torradas à vista (as mais antigas saem; erros por último).
* celular (< 720 px): painel em tela cheia, barra inferior fixa, conteúdo com espaço inferior.
