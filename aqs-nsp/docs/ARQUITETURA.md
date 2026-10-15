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
| `AQS_CONFIG` | config.js | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `INATIVIDADE_MINUTOS` (30), `LIMITE_ARQUIVO_MB` (20), `NOME_SISTEMA`, `SUBTITULO`, `ORGANIZACAO` |
| `U` | util.js | DOM (`$`, `$$`), `esc`, `escMultilinha`, datas no fuso de Belém (`hojeBelem`, `paraData`, `paraTexto`, `somarDias`, `diasEntre`, `formatarData`, `formatarDataCurta`, `formatarDataHora`, `tempoRelativo`, `mesPorExtenso`, `descreverPrazo`, `MESES`, `DIAS_SEMANA`), `torrada(msg, tipo)`, `falha(erro)`, `abrirPainel(tituloHtml, corpoHtml, aoMontar(painelEl), {largo, aoFechar})`, `fecharPainel`, `painelAberto`, `confirmar`, `baixarConteudo`, `abrirBlob`, `baixarCsv`, `comprimirImagem(file)→Promise<File|null>`, `formatarTamanho`, `iconeArquivo`, `nomeSeguro`, `uuid`, `agrupar`, `ordenarTexto`, `adiar`, `anelProgresso(pct, rotulo)`, `aplicarLarguras(raiz)` |
| `Regras` | regras.js | regras puras compartilhadas (UI e ApiDemo) — §5 |
| `Recorrencia` | recorrencia.js | geração de datas, espelho exato da função SQL — §4 |
| `ApiSupabase` / `ApiDemo` | api-*.js | adaptadores; **as páginas nunca os usam diretamente** |
| `Api` | api.js | fachada: valida o adaptador e expõe os métodos — §6 |
| `Sessao` | sessao.js | login, troca de senha, MFA, inatividade — §7 |
| `TempoReal` | tempo-real.js | assinatura de mudanças e ressincronização — §7 |
| `Paginas` | paginas/*.js | `Paginas.<rota> = { titulo, render(el, params), aoVivo? }` |
| `Detalhe` | paginas/detalhe.js | `Detalhe.abrirOcorrencia(id)`, `Detalhe.abrirAtividade(id)` |
| `FormAtividade` | paginas/atividades.js | `FormAtividade.abrir(atividade \| null, valoresIniciais?)` — formulário de criação/edição (usado por Detalhe e Avisos) |
| `App` | app.js | `App.navegar()`, `App.ir(hash)`, `App.recarregar(tabelas?)`, `App.aoAtualizarPainel(fn)`, `App.atualizarContadores()`, `App.militar()` (perfil logado), `App.eChefia()` |

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
* `papel`: `chefia` | `adjunto`
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
`criado_em`, `atualizado_em`.
Gatilho: impede que a última chefia ativa deixe de ser chefia ou seja desativada/excluída.

**atividades** — `id`, `ordem` int (nº no plano; default = max+1),
`titulo` not null (3..200), `descricao` text default `''`, `setor_id` → setores,
`tipo`, `periodicidade`, `dia_semana` int 1..7 (ISO: 1=segunda … 5=sexta),
`dia_mes` int 1..31 (31 = último dia do mês), `mes_inicio` int 1..12 (âncora de
trimestral/semestral/anual), `prazo` date (só pontual; nulo = sem prazo),
`antecipar_dia_util` bool default true, `prioridade` default `'normal'`,
`exige_evidencia` bool default false, `ativa` bool default true,
`data_inicio` date default `hoje_belem()`, `criado_por` → militares,
`criado_em`, `atualizado_em`.
Checks: recorrente ⇒ periodicidade não nula; semanal ⇒ dia_semana; mensal/trimestral/semestral/anual ⇒ dia_mes;
trimestral/semestral/anual ⇒ mes_inicio; não recorrente ⇒ periodicidade nula.

**atividade_responsaveis** — `atividade_id` → atividades on delete cascade, `militar_id` → militares; PK dupla.

**ocorrencias** (cada execução/período de uma atividade) — `id`,
`atividade_id` → atividades on delete cascade, `referencia` text nulo
(ver §4; nulo para execuções sob demanda), `titulo_execucao` text nulo
(ex.: "Incidente 2026/041"), `prazo` date nulo, `status` default `'pendente'`,
`observacao` text default `''`, `justificativa` text nulo,
`iniciada_em`, `concluida_em` timestamptz, `concluida_por` → militares,
`criado_por` → militares nulo, `criado_em`, `atualizado_em`.
`unique (atividade_id, referencia)`. Check: `nao_se_aplica` exige justificativa não vazia.
Gatilho: carimba `iniciada_em` (ao ir para em_andamento), `concluida_em`/`concluida_por`
(ao ir para concluida; limpa ao sair) e impede que não-chefia altere
`atividade_id`, `referencia` ou `prazo`.

**v_ocorrencias** (view, `with (security_invoker = true)`) — todas as colunas de
ocorrencias + `atividade_titulo`, `atividade_tipo`, `periodicidade`, `prioridade`,
`setor_id`, `exige_evidencia`, `responsaveis` uuid[] (vazio se nenhum),
`data_ref` date = `coalesce(prazo, (criado_em at time zone 'America/Belem')::date)`,
`atrasada` bool = status em (pendente, em_andamento) e prazo < hoje_belem(),
`concluida_no_prazo` bool = status concluida e (prazo nulo ou data de conclusão em Belém <= prazo),
`qtd_evidencias` int, `qtd_comentarios` int.

**evidencias** — `id`, `atividade_id` not null → atividades on delete cascade,
`ocorrencia_id` nulo → ocorrencias on delete cascade, `storage_path` único,
`nome`, `mime`, `tamanho` bigint, `descricao` text default `''`,
`enviado_por` → militares, `enviado_em`.

**comentarios** — `id`, `atividade_id` not null → cascade, `ocorrencia_id` nulo → cascade,
`autor_id` → militares, `texto` not null (1..4000), `criado_em`. Sem edição.

**avisos** — `id`, `titulo` not null, `mensagem` text default `''`, `nivel` default `'informativo'`,
`para_todos` bool default true, `prazo` date nulo, `atividade_id` nulo → atividades on delete set null,
`fixado` bool default false, `expira_em` date nulo, `criado_por` → militares, `criado_em`, `atualizado_em`.

**avisos_destinatarios** — `aviso_id` → cascade, `militar_id`; PK dupla (só usada quando `para_todos = false`).

**avisos_ciencia** — `aviso_id` → cascade, `militar_id`, `ciente_em` default now(); PK dupla.

**notificacoes** — `id`, `destinatario_id` → militares, `tipo`, `titulo`, `mensagem`,
`atividade_id`, `ocorrencia_id`, `aviso_id` (nulos), `lida` bool default false, `criado_em`.
Preenchida só por gatilhos/funções SECURITY DEFINER:
* inserção em atividade_responsaveis → `atribuicao` para o militar (exceto se ele mesmo fez);
* inserção em comentarios → `comentario` para responsáveis da atividade e chefias ativas, exceto o autor;
* inserção em avisos → `aviso` para os destinatários (ou todos os ativos), exceto o autor
  (destinatários inseridos depois do aviso também são notificados — gatilho em avisos_destinatarios);
* `privado.notificar_prazos()` (diária + dentro de `gerar_ocorrencias`) → `prazo` para os responsáveis de
  ocorrências abertas com prazo hoje ou amanhã, no máximo uma por ocorrência por dia.

**feriados** — `data` date PK, `descricao`.

**auditoria** — `id` bigserial, `quando` timestamptz default now(), `militar_id` uuid nulo,
`usuario_id` uuid nulo, `tabela`, `operacao` (INSERT/UPDATE/DELETE), `registro_id` text,
`antes` jsonb, `depois` jsonb. Gatilho genérico AFTER em: setores, militares, atividades,
atividade_responsaveis, ocorrencias, evidencias, comentarios, avisos, feriados.

### Funções auxiliares (schema `privado`, não exposto pela API REST)
SECURITY DEFINER, STABLE, `set search_path = ''`, usadas nas políticas como
`(select privado.eh_chefia())`:
* `privado.meu_militar_id() → uuid` (militar ativo ligado a `auth.uid()`; nulo se não houver)
* `privado.eh_ativo() → bool`
* `privado.eh_chefia() → bool` (ativo e papel chefia)
* `privado.eh_responsavel(atividade uuid) → bool`
* `privado.datas_ocorrencia(...)` e `privado.notificar_prazos()` — §4
* `privado.vincular_usuario(email text, militar uuid default null)` — para a implantação (ligar a 1ª chefia)

### RPCs públicas (expostas; `grant execute ... to authenticated`, revogado de anon)
* `meu_perfil() → militares` — registra `ultimo_acesso = now()` e devolve a linha do militar logado
  (erro `'sem_cadastro'` se não houver militar ativo ligado ao usuário).
* `confirmar_troca_senha() → void` — `deve_trocar_senha = false` para o próprio militar.
* `salvar_atividade(p jsonb) → uuid` — cria/atualiza a atividade e seus responsáveis de forma atômica.
  `p`: `{id?, ordem?, titulo, descricao, setor_id, tipo, periodicidade, dia_semana, dia_mes, mes_inicio,
  prazo, antecipar_dia_util, prioridade, exige_evidencia, ativa, data_inicio, responsaveis: [militar_id]}`.
  Permissões: chefia tudo. Adjunto: **criar** só `pontual` ou `sob_demanda` incluindo a si mesmo
  em `responsaveis`; **editar** só atividades em que é responsável e sem alterar `responsaveis`
  (lista diferente ⇒ erro). Se mudar regra de agenda/`ativa`/`data_inicio`: apaga ocorrências futuras
  (prazo >= hoje) ainda `pendente` sem evidências nem comentários e regenera. Para `pontual`, mantém a
  ocorrência única `P` com o mesmo prazo (se ainda não concluída).
* `gerar_ocorrencias() → int` — idempotente; qualquer usuário ativo pode chamar.
* (As demais operações são INSERT/UPDATE/DELETE diretos, protegidos por RLS.)

### Regras de acesso (RLS — todas `to authenticated`; anon sem nenhum acesso)
"ativo" = `privado.eh_ativo()` (vale em TODAS as políticas: desativar corta o acesso na hora).

| tabela | select | insert | update | delete |
|---|---|---|---|---|
| setores, feriados | ativo | chefia | chefia | chefia |
| militares | ativo | chefia | chefia | — (desativar) |
| atividades | ativo | via RPC | via RPC | chefia |
| atividade_responsaveis | ativo | via RPC | — | via RPC |
| ocorrencias | ativo | chefia; ou responsável quando a atividade é `sob_demanda` | chefia ou responsável | chefia |
| evidencias | ativo | (chefia ou responsável) e `enviado_por` = eu | — | chefia ou quem enviou |
| comentarios | ativo | ativo e `autor_id` = eu | — | autor ou chefia |
| avisos | chefia, `para_todos`, ou sou destinatário | chefia | chefia | chefia |
| avisos_destinatarios | ativo | chefia | — | chefia |
| avisos_ciencia | chefia ou a própria linha | eu, aviso visível | — | — |
| notificacoes | as minhas | (gatilhos) | as minhas (`lida`) | as minhas |
| auditoria | chefia | (gatilhos) | — | — |

**Storage**: bucket privado `evidencias`, limite 20 MB, tipos permitidos:
pdf, doc, docx, xls, xlsx, ppt, pptx, odt, ods, odp, jpg/jpeg, png, txt, csv.
Caminho: `{atividade_id}/{ocorrencia_id ou 'geral'}/{uuid}-{nome-seguro}`.
Políticas em `storage.objects` (bucket `evidencias`): SELECT ativo; INSERT ativo e (chefia ou
responsável pela atividade da 1ª pasta); DELETE chefia ou dono (`owner_id = auth.uid()::text`);
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

* `Regras.ROTULOS` — `{ papel, tipo, periodicidade, prioridade, status, nivel, notificacao }`, cada um
  `{ valor: 'Rótulo' }`. Status efetivo inclui `atrasada: 'Atrasada'`.
* `Regras.TIPOS_ARQUIVO` — `{ extensao: mime }` permitido; `Regras.ACCEPT` (string para `<input accept>`).
* `Regras.validarArquivo(file, limiteMb?) → null | 'mensagem'`.
* `Regras.validarSenha(s) → null | 'mensagem'` (mín. 10 caracteres, ao menos 1 letra e 1 número).
* `Regras.nomeMilitar(m) → '1º Ten Balieiro'` (posto + nome de guerra, sem espaços sobrando).
* `Regras.nomesResponsaveis(ids, mapaMilitares) → 'Ten Letícia, Ten Balieiro'`.
* `Regras.eChefia(m)`, `Regras.eResponsavel(m, atividadeOuOcorrencia)` (usa `.responsaveis`).
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
* `salvarMilitar(m) → Militar` (campos: id?, posto, nome_guerra, nome_completo, email, setor_id, papel, ativo)
* `adminUsuario(acao, militar_id, extra?) → { senha_temporaria? }` — acao: `criar` | `redefinir_senha` |
  `desativar` | `reativar` | `remover_mfa` (Edge Function `admin-usuarios`)
* `listarFeriados() → [{data, descricao}]` · `salvarFeriado(f)` · `excluirFeriado(data)`

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
* `salvarAviso(aviso & { destinatarios }) → Aviso` · `excluirAviso(id)` · `darCiencia(aviso_id)`

**Notificações**
* `listarNotificacoes({ limite? = 30 }) → [Notificacao]` (mais recentes primeiro)
* `contarNaoLidas() → int` · `marcarNotificacoesLidas(ids | null)` (null = todas)

**Chefia**
* `listarAuditoria({ limite? = 200, tabela? }) → [RegistroAuditoria]`
* `exportarTudo() → objeto JSON com todas as tabelas (sem conteúdo de arquivos)`

**Tempo real**
* `assinarMudancas(cb({ tabela, evento })) → cancelar()` (demo: nunca dispara)

A fachada (`api.js`) mantém a lista canônica `Api.METODOS`; ao carregar, verifica que o
adaptador presente implementa todos e falha alto se faltar algum. `Api.modo` é `'supabase'` ou `'demo'`.

---

## 7. Casca (app.js, sessao.js, tempo-real.js)

* `index.html` tem `#telaAcesso` (login, troca de senha, MFA, configuração pendente) e `#telaApp`
  (cabeçalho, navegação, `<main class="conteudo">` com uma `<section class="pagina oculto" id="pagina-ROTA">`
  por rota, rodapé), `#painelDetalhe` e `#avisosFlutuantes`.
* Rotas: `inicio` (padrão), `quadro`, `atividades`, `avisos`, `relatorios`, `plano`, `equipe`, `conta`.
  Parâmetros `?ocorrencia=ID` e `?atividade=ID` em qualquer rota abrem o painel de detalhe.
* Navegação: abas no cabeçalho (≥ 720 px); barra inferior no celular (Início, Quadro, Avisos,
  Atividades, Mais → Relatórios, Plano, Equipe, Minha conta, Sair). Equipe aparece para todos
  (somente leitura para adjuntos).
* Cabeçalho: brasão, "HABE · AQS e NSP" / "Ferramenta de Gestão de Atividades", nome do militar logado,
  sino com contador (lista de notificações em painel suspenso), botão de tema, botão sair.
* `App.recarregar(tabelas)`: invalida referências se `militares`/`setores`/`feriados` mudaram; chama a
  função registrada por `App.aoAtualizarPainel(fn)` se o painel estiver aberto; re-renderiza a página
  atual se `Paginas[rota].aoVivo !== false` **e** o foco não estiver num campo de formulário da página
  (nesse caso, adia até o campo perder o foco).
* `TempoReal`: `Api.assinarMudancas` → adia 300 ms → `App.recarregar(tabelas)`; ressincroniza ao
  voltar a aba/tela (`visibilitychange`) e a cada 5 min; mudança em `notificacoes` atualiza o sino e
  mostra uma torrada.
* Painel lateral: **quem abre um painel** (`U.abrirPainel`) chama logo em seguida
  `App.aoAtualizarPainel(fn ou null)` — `fn` recarrega o conteúdo do painel quando chegam mudanças
  (detalhe); formulários passam `null` para não serem apagados enquanto o usuário digita.
  `App.recarregar` só chama a função registrada se `U.painelAberto()`.
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
* celular (< 720 px): painel em tela cheia, barra inferior fixa, conteúdo com espaço inferior.
