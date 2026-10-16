/* =========================================================================
   HABE · AQS e NSP — Edge Function "admin-usuarios": LÓGICA
   Criação de acesso, redefinição de senha, desativação/reativação, remoção
   do segundo fator, troca de e-mail e exclusão de militares — tudo o que
   exige a chave service_role do Supabase e por isso NÃO pode rodar no
   navegador. Ver docs/ARQUITETURA.md (§3 "Papéis e continuidade" e §6
   "adminUsuario").

   Este arquivo é lógica pura: não importa nada do Deno nem do supabase-js.
   Tudo o que fala com o mundo (Auth, tabelas, relógio, sorteio) chega por
   "deps" — o index.ts liga ao Supabase de verdade e o teste
   (testes/edge-logica.mjs) liga a dependências falsas. Por isso o
   TypeScript aqui usa só sintaxe "apagável" (interfaces e anotações, sem
   enum, namespace nem parameter properties): o Node 22 roda este arquivo
   direto, removendo os tipos.

   Regras de segurança (a ordem importa):
    1. CORS só para as origens de ORIGEM_PERMITIDA (lista separada por
       vírgula; '*' só se alguém escrever '*' de propósito). Sem
       configuração, nenhum navegador consegue chamar a função.
    2. Só POST.
    3. Token válido (401), militar ATIVO com papel chefia ou administrador
       (403) e, se esse usuário tem segundo fator, sessão confirmada com ele
       (aal2) — senha vazada sozinha não administra usuários.
    4. Militar-alvo administrador (a conta institucional da AQS) só por
       administrador: a chefia não consegue derrubar a âncora de
       continuidade do sistema.
    5. Ninguém desativa nem exclui a si mesmo.
    6. A trava anti-bloqueio do banco (gatilho de militares) vale também
       aqui: se a mudança deixaria o sistema sem gestor com acesso, o banco
       recusa e a função devolve 409 sem mexer no Auth.
   Cada ação bem-sucedida vai para a auditoria (tabela 'auth.users',
   operação 'ADMIN:<ação>', registro = id do militar) — NUNCA com a senha.
   ========================================================================= */

/* ---------- tipos ---------- */

export interface Militar {
  id: string;
  usuario_id: string | null;
  posto?: string | null;
  nome_guerra?: string | null;
  email: string | null;
  papel: string;
  ativo: boolean;
}

export interface UsuarioToken {
  id: string;
  email?: string | null;
  /* Nível de garantia da sessão (claim "aal" do JWT): 'aal1' ou 'aal2'. */
  aal?: string | null;
}

export interface FatorMfa {
  id: string;
  status?: string | null;
  factor_type?: string | null;
}

export interface LinhaAuditoria {
  militar_id: string | null;
  militar_nome: string | null;
  usuario_id: string | null;
  tabela: string;
  operacao: string;
  registro_id: string | null;
  antes: Record<string, unknown> | null;
  depois: Record<string, unknown> | null;
}

export interface AtributosUsuario {
  senha?: string;
  email?: string;
  /* Duração do banimento no formato do Supabase ('876000h' ≈ 100 anos; 'none' desfaz). */
  banimento?: string;
}

export interface Dependencias {
  /* Segredo ORIGEM_PERMITIDA: 'https://a.exemplo,https://b.exemplo' (ou '*'). */
  origemPermitida: string | null | undefined;
  /* null = token inválido/expirado; lança erro = Auth fora do ar. */
  usuarioDoToken(token: string): Promise<UsuarioToken | null>;
  militarPorUsuario(usuarioId: string): Promise<Militar | null>;
  militarPorId(id: string): Promise<Militar | null>;
  militarPorEmail(email: string): Promise<Militar | null>;
  /* true = alguma linha foi alterada. exigirSemAcesso: só altera se
     usuario_id ainda for nulo (dois gestores criando o mesmo acesso). */
  atualizarMilitar(id: string, campos: Record<string, unknown>, opcoes?: { exigirSemAcesso?: boolean }): Promise<boolean>;
  /* true = a linha existia e foi apagada. Erro do gatilho (trava) é lançado. */
  excluirMilitar(id: string): Promise<boolean>;
  criarUsuario(dados: { email: string; senha: string }): Promise<{ id: string }>;
  atualizarUsuario(id: string, atributos: AtributosUsuario): Promise<void>;
  excluirUsuario(id: string): Promise<void>;
  listarFatores(usuarioId: string): Promise<FatorMfa[]>;
  excluirFator(usuarioId: string, fatorId: string): Promise<void>;
  registrarAuditoria(linha: LinhaAuditoria): Promise<void>;
  /* Mensagem para o caso de a função estar implantada sem as variáveis do
     Supabase: responde 500 com ela (com CORS, para a tela mostrar). */
  erroDeConfiguracao?: string | null;
  /* Opcionais (o teste injeta; em produção valem os padrões). */
  bytesAleatorios?(quantidade: number): Uint8Array;
  registrarErro?(contexto: string, erro: unknown): void;
}

export interface Requisicao {
  metodo: string;
  origem: string | null | undefined;
  autorizacao: string | null | undefined;
  corpo: unknown;
}

export interface Resposta {
  status: number;
  corpo: Record<string, unknown> | null;
  cabecalhos: Record<string, string>;
}

type Acao = 'criar' | 'redefinir_senha' | 'desativar' | 'reativar' | 'remover_mfa' | 'alterar_email' | 'excluir';

interface Pedido {
  acao: Acao;
  militar_id: string;
  email: string | null;
}

/* ---------- constantes ---------- */

export const ACOES: Acao[] = ['criar', 'redefinir_senha', 'desativar', 'reativar', 'remover_mfa', 'alterar_email', 'excluir'];

const PAPEIS_GESTOR = ['chefia', 'administrador'];
const BANIMENTO_PERMANENTE = '876000h';
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* Mensagem do gatilho de militares (a mesma de Regras.MENSAGEM_TRAVA). */
const INICIO_TRAVA = 'É preciso manter ao menos uma conta de chefia ou administrador';

const MSG = {
  origem: 'Origem não permitida para a função admin-usuarios.',
  semConfiguracao: 'A função admin-usuarios não está configurada: defina o segredo ORIGEM_PERMITIDA ' +
    '(endereço do site da ferramenta) no Supabase — veja docs/CONTINUIDADE.md.',
  metodo: 'Método não permitido. Use POST.',
  sessao: 'Sua sessão expirou. Entre novamente.',
  authFora: 'Não foi possível validar a sua sessão agora. Tente de novo em instantes.',
  soGestor: 'Apenas a chefia ou a conta institucional da AQS (administrador) podem administrar usuários.',
  exigeMfa: 'Para administrar usuários, entre com o segundo fator (código do aplicativo autenticador) ' +
    'e tente de novo.',
  soAdministrador: 'Apenas a conta de administrador (conta institucional da AQS) pode criar, alterar ou ' +
    'excluir contas de administrador.',
  corpo: 'Pedido inválido: envie JSON com "acao" e "militar_id".',
  acao: 'Ação desconhecida. Use: ' + ACOES.join(', ') + '.',
  militarId: 'Pedido inválido: "militar_id" deve ser o identificador (uuid) de um militar.',
  naoEncontrado: 'Militar não encontrado. O cadastro pode ter sido excluído — atualize a página.',
  desativarSiMesmo: 'Você não pode desativar o seu próprio acesso.',
  excluirSiMesmo: 'Você não pode excluir o seu próprio cadastro.',
  emailInvalido: 'E-mail inválido. Confira o endereço digitado.',
  emailEmUsoMilitar: 'Este e-mail já está em uso por outro militar.',
  emailEmUsoAuth: 'Já existe um usuário de acesso com este e-mail. Se ele sobrou de um cadastro excluído, ' +
    'apague-o no painel do Supabase (Authentication → Users) ou use outro e-mail.',
  semAcesso: 'Este militar ainda não tem acesso. Use "Criar acesso".',
  usuarioSumiu: 'O usuário de acesso deste militar não existe mais no Supabase (Authentication → Users). ' +
    'Peça ao responsável técnico para religá-lo (privado.vincular_usuario) ou crie um acesso novo.',
  interno: 'Erro interno no serviço de administração de usuários. Tente de novo; se persistir, avise o ' +
    'responsável técnico (docs/CONTINUIDADE.md).'
};

/* ---------- utilidades ---------- */

function texto(valor: unknown): string {
  return (valor === null || valor === undefined) ? '' : String(valor);
}

function codigoDe(erro: unknown): string {
  return texto((erro as { code?: unknown } | null)?.code);
}

function statusDe(erro: unknown): number {
  return Number((erro as { status?: unknown } | null)?.status) || 0;
}

function mensagemDe(erro: unknown): string {
  if (erro instanceof Error) { return erro.message; }
  return texto((erro as { message?: unknown } | null)?.message) || texto(erro);
}

/* Detalhe técnico curto para as mensagens de falha: ajuda quem for
   diagnosticar sem despejar pilhas de chamada na tela. */
function detalhe(erro: unknown): string {
  const m = mensagemDe(erro).replace(/\s+/g, ' ').trim();
  return m ? ' (detalhe: ' + m.slice(0, 200) + ')' : '';
}

function eEmailExistente(erro: unknown): boolean {
  const c = codigoDe(erro);
  if (c === 'email_exists' || c === 'user_already_exists' || c === 'identity_already_exists') { return true; }
  return statusDe(erro) === 422 && /already (been )?registered|already exists/i.test(mensagemDe(erro));
}

function eUsuarioInexistente(erro: unknown): boolean {
  return codigoDe(erro) === 'user_not_found' || statusDe(erro) === 404;
}

function eTrava(erro: unknown): boolean {
  return mensagemDe(erro).indexOf(INICIO_TRAVA) >= 0;
}

function eUnicidade(erro: unknown): boolean {
  return codigoDe(erro) === '23505';
}

function eViolacaoDeCheck(erro: unknown): boolean {
  return codigoDe(erro) === '23514';
}

function eGestor(m: Militar | null): boolean {
  return !!m && m.ativo === true && PAPEIS_GESTOR.indexOf(m.papel) >= 0;
}

function nomeMilitar(m: Militar): string {
  const nome = (texto(m.posto) + ' ' + texto(m.nome_guerra)).replace(/\s+/g, ' ').trim();
  return nome || texto(m.email) || m.id;
}

/* O que vai para a auditoria sobre o militar — nada de senha. */
function resumo(m: Militar): Record<string, unknown> {
  return {
    id: m.id, posto: m.posto ?? null, nome_guerra: m.nome_guerra ?? null, email: m.email,
    papel: m.papel, ativo: m.ativo, usuario_id: m.usuario_id
  };
}

function normalizarEmail(valor: unknown): string {
  return texto(valor).trim().toLowerCase();
}

function emailValido(email: string): boolean {
  return email.length > 0 && email.length <= 254 && RE_EMAIL.test(email);
}

function normalizarOrigem(valor: unknown): string {
  return texto(valor).trim().replace(/\/+$/, '');
}

function registrarErro(deps: Dependencias, contexto: string, erro: unknown): void {
  try {
    if (deps.registrarErro) { deps.registrarErro(contexto, erro); }
    else { console.error('[admin-usuarios] ' + contexto, erro); }
  } catch (_) {
    /* registrar nunca derruba a resposta */
  }
}

/* ---------- senha temporária ---------- */

/* Sem caracteres que se confundem ao ditar ou ler (0/O/o, 1/l/I). Um
   símbolo é sempre incluído porque o projeto pode ser configurado para
   exigi-lo (Authentication → Policies → Password requirements); os
   escolhidos são fáceis de digitar no celular. */
const MAIUSCULAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MINUSCULAS = 'abcdefghijkmnpqrstuvwxyz';
const NUMEROS = '23456789';
const SIMBOLOS = '@#%+=';
const ALFANUMERICOS = MAIUSCULAS + MINUSCULAS + NUMEROS;
export const TAMANHO_SENHA = 14;

function bytesPadrao(quantidade: number): Uint8Array {
  const bytes = new Uint8Array(quantidade);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/* Índices sorteados sem viés em [0, n): descarta os bytes acima do maior
   múltiplo de n (amostragem por rejeição), em vez de usar o resto puro. */
function sortearIndices(n: number, quantidade: number, fonte: (n: number) => Uint8Array): number[] {
  const limite = 256 - (256 % n);
  const saida: number[] = [];
  let voltas = 0;
  while (saida.length < quantidade) {
    voltas += 1;
    if (voltas > 1000) { throw new Error('Fonte de números aleatórios inutilizável.'); }
    const lote = fonte(Math.max(16, quantidade * 2));
    for (let i = 0; i < lote.length && saida.length < quantidade; i += 1) {
      if (lote[i] < limite) { saida.push(lote[i] % n); }
    }
  }
  return saida;
}

function sortear(alfabeto: string, quantidade: number, fonte: (n: number) => Uint8Array): string {
  return sortearIndices(alfabeto.length, quantidade, fonte).map(function (i) { return alfabeto.charAt(i); }).join('');
}

/* 14 caracteres (13 letras/números + 1 símbolo em posição sorteada), com
   ao menos uma maiúscula, uma minúscula e um número. Atende a
   Regras.validarSenha (o militar a troca no primeiro acesso). */
export function gerarSenhaTemporaria(fonte?: (n: number) => Uint8Array): string {
  const sorteio = fonte || bytesPadrao;
  for (let tentativa = 0; tentativa < 200; tentativa += 1) {
    const base = sortear(ALFANUMERICOS, TAMANHO_SENHA - 1, sorteio);
    if (!/[A-Z]/.test(base) || !/[a-z]/.test(base) || !/[0-9]/.test(base)) { continue; }
    const simbolo = sortear(SIMBOLOS, 1, sorteio);
    const posicao = sortearIndices(TAMANHO_SENHA, 1, sorteio)[0];
    return base.slice(0, posicao) + simbolo + base.slice(posicao);
  }
  throw new Error('Não foi possível gerar uma senha temporária.');
}

/* ---------- respostas e CORS ---------- */

const CABECALHOS_BASE: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff'
};

function listaDeOrigens(config: string | null | undefined): string[] {
  return texto(config).split(',').map(normalizarOrigem).filter(function (o) { return o.length > 0; });
}

function cabecalhosCors(origem: string, permitidas: string[]): Record<string, string> | null {
  const comuns: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-region, x-retry-count',
    'Access-Control-Max-Age': '86400'
  };
  if (permitidas.indexOf('*') >= 0) {
    return Object.assign({ 'Access-Control-Allow-Origin': '*' }, comuns);
  }
  if (origem && permitidas.indexOf(origem) >= 0) {
    return Object.assign({ 'Access-Control-Allow-Origin': origem, 'Vary': 'Origin' }, comuns);
  }
  return null;
}

function responder(status: number, cabecalhos: Record<string, string>, corpo: Record<string, unknown>): Resposta {
  return { status: status, corpo: corpo, cabecalhos: Object.assign({}, cabecalhos) };
}

function erro(status: number, cabecalhos: Record<string, string>, mensagem: string): Resposta {
  return responder(status, cabecalhos, { ok: false, erro: mensagem });
}

/* ---------- validação do pedido ---------- */

function lerPedido(corpo: unknown): Pedido | string {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) { return MSG.corpo; }
  const c = corpo as Record<string, unknown>;
  const acao = texto(c.acao).trim();
  if (ACOES.indexOf(acao as Acao) < 0) { return acao ? MSG.acao : MSG.corpo; }
  const militarId = texto(c.militar_id).trim();
  if (!RE_UUID.test(militarId)) { return MSG.militarId; }
  const email = (c.email === undefined || c.email === null || texto(c.email).trim() === '')
    ? null : normalizarEmail(c.email);
  return { acao: acao as Acao, militar_id: militarId.toLowerCase(), email: email };
}

/* ---------- ponto de entrada ---------- */

export async function tratarRequisicao(req: Requisicao, deps: Dependencias): Promise<Resposta> {
  const permitidas = listaDeOrigens(deps.origemPermitida);
  const origem = normalizarOrigem(req.origem);
  const cors = cabecalhosCors(origem, permitidas);

  /* Navegador de origem não autorizada: recusa já aqui, sem cabeçalhos de
     CORS (o navegador nem entrega a resposta à página). Pedido sem Origin
     não vem de navegador — segue, e o token decide. */
  if (origem && !cors) {
    return erro(403, CABECALHOS_BASE, permitidas.length ? MSG.origem : MSG.semConfiguracao);
  }
  const cabecalhos: Record<string, string> = Object.assign({}, CABECALHOS_BASE, cors || {});
  const metodo = texto(req.metodo).toUpperCase();

  if (metodo === 'OPTIONS') {
    return { status: 204, corpo: null, cabecalhos: Object.assign({}, cors || {}) };
  }
  if (metodo !== 'POST') {
    return erro(405, Object.assign({ 'Allow': 'POST, OPTIONS' }, cabecalhos), MSG.metodo);
  }
  if (deps.erroDeConfiguracao) {
    registrarErro(deps, 'configuração', deps.erroDeConfiguracao);
    return erro(500, cabecalhos, deps.erroDeConfiguracao);
  }

  try {
    return await processar(req, deps, cabecalhos);
  } catch (e) {
    registrarErro(deps, 'erro inesperado', e);
    return erro(500, cabecalhos, MSG.interno);
  }
}

async function processar(req: Requisicao, deps: Dependencias, cab: Record<string, string>): Promise<Resposta> {
  /* 1. quem chama */
  const m = /^Bearer\s+(\S+)\s*$/i.exec(texto(req.autorizacao));
  if (!m) { return erro(401, cab, MSG.sessao); }

  let usuario: UsuarioToken | null;
  try {
    usuario = await deps.usuarioDoToken(m[1]);
  } catch (e) {
    registrarErro(deps, 'validação do token', e);
    return erro(503, cab, MSG.authFora);
  }
  if (!usuario || !usuario.id) { return erro(401, cab, MSG.sessao); }

  const chamador = await deps.militarPorUsuario(usuario.id);
  if (!chamador || !eGestor(chamador)) { return erro(403, cab, MSG.soGestor); }

  /* Quem tem segundo fator precisa ter entrado com ele. */
  let fatoresChamador: FatorMfa[];
  try {
    fatoresChamador = await deps.listarFatores(usuario.id);
  } catch (e) {
    registrarErro(deps, 'fatores do chamador', e);
    return erro(503, cab, MSG.authFora);
  }
  const temFator = (fatoresChamador || []).some(function (f) { return f && f.status === 'verified'; });
  if (temFator && usuario.aal !== 'aal2') { return erro(403, cab, MSG.exigeMfa); }

  /* 2. o quê */
  const pedido = lerPedido(req.corpo);
  if (typeof pedido === 'string') { return erro(400, cab, pedido); }

  const alvo = await deps.militarPorId(pedido.militar_id);
  if (!alvo) { return erro(404, cab, MSG.naoEncontrado); }
  if (alvo.papel === 'administrador' && chamador.papel !== 'administrador') {
    return erro(403, cab, MSG.soAdministrador);
  }
  if (pedido.acao === 'desativar' && alvo.id === chamador.id) { return erro(403, cab, MSG.desativarSiMesmo); }
  if (pedido.acao === 'excluir' && alvo.id === chamador.id) { return erro(403, cab, MSG.excluirSiMesmo); }

  const ctx: Contexto = { deps: deps, cab: cab, chamador: chamador, usuario: usuario, alvo: alvo, pedido: pedido };
  switch (pedido.acao) {
    case 'criar': return await criar(ctx);
    case 'redefinir_senha': return await redefinirSenha(ctx);
    case 'desativar': return await desativar(ctx);
    case 'reativar': return await reativar(ctx);
    case 'remover_mfa': return await removerMfa(ctx);
    case 'alterar_email': return await alterarEmail(ctx);
    case 'excluir': return await excluir(ctx);
  }
  return erro(400, cab, MSG.acao);
}

interface Contexto {
  deps: Dependencias;
  cab: Record<string, string>;
  chamador: Militar;
  usuario: UsuarioToken;
  alvo: Militar;
  pedido: Pedido;
}

/* ---------- auditoria ---------- */

/* Operação "natural" sobre auth.users, usada se o banco ainda recusar o
   formato 'ADMIN:<ação>' (check de auditoria.operacao mais antigo): a
   ação continua registrada em depois.acao. */
function operacaoNatural(acao: Acao): string {
  if (acao === 'criar') { return 'INSERT'; }
  if (acao === 'excluir') { return 'DELETE'; }
  return 'UPDATE';
}

async function auditar(ctx: Contexto, antes: Record<string, unknown> | null, depois: Record<string, unknown>): Promise<void> {
  const linha: LinhaAuditoria = {
    militar_id: ctx.chamador.id,
    militar_nome: nomeMilitar(ctx.chamador),
    usuario_id: ctx.usuario.id,
    tabela: 'auth.users',
    operacao: 'ADMIN:' + ctx.pedido.acao,
    registro_id: ctx.alvo.id,
    antes: antes,
    depois: Object.assign({ acao: 'ADMIN:' + ctx.pedido.acao }, depois)
  };
  try {
    await ctx.deps.registrarAuditoria(linha);
  } catch (e) {
    if (eViolacaoDeCheck(e)) {
      try {
        await ctx.deps.registrarAuditoria(Object.assign({}, linha, { operacao: operacaoNatural(ctx.pedido.acao) }));
        return;
      } catch (e2) {
        registrarErro(ctx.deps, 'auditoria (formato alternativo)', e2);
        return;
      }
    }
    /* A ação já aconteceu: falha de auditoria é registrada no log da
       função, mas não desfaz nem esconde o resultado. */
    registrarErro(ctx.deps, 'auditoria', e);
  }
}

/* ---------- ações ---------- */

async function criar(ctx: Contexto): Promise<Resposta> {
  const { deps, cab, alvo, pedido } = ctx;
  if (!alvo.ativo) { return erro(409, cab, 'Reative o cadastro antes de criar o acesso.'); }
  if (alvo.usuario_id) {
    return erro(409, cab, 'Este militar já tem acesso. Se ele esqueceu a senha, use "Redefinir senha".');
  }
  const email = pedido.email || normalizarEmail(alvo.email);
  if (!email) { return erro(400, cab, 'Cadastre o e-mail do militar antes de criar o acesso.'); }
  if (!emailValido(email)) { return erro(400, cab, MSG.emailInvalido); }
  if (email !== normalizarEmail(alvo.email)) {
    const outro = await deps.militarPorEmail(email);
    if (outro && outro.id !== alvo.id) { return erro(409, cab, MSG.emailEmUsoMilitar); }
  }

  const senha = gerarSenhaTemporaria(deps.bytesAleatorios ? deps.bytesAleatorios.bind(deps) : undefined);
  let novo: { id: string };
  try {
    novo = await deps.criarUsuario({ email: email, senha: senha });
  } catch (e) {
    if (eEmailExistente(e)) { return erro(409, cab, MSG.emailEmUsoAuth); }
    registrarErro(deps, 'criar usuário', e);
    return erro(500, cab, 'Não foi possível criar o usuário de acesso' + detalhe(e) + '.');
  }

  /* Liga o usuário ao cadastro. Se não der, apaga o usuário recém-criado:
     um login solto, sem militar, só confundiria (e ocuparia o e-mail). */
  let vinculou = false;
  let falhaVinculo: unknown = null;
  try {
    vinculou = await deps.atualizarMilitar(alvo.id,
      { usuario_id: novo.id, email: email, deve_trocar_senha: true }, { exigirSemAcesso: true });
  } catch (e) {
    falhaVinculo = e;
  }
  if (!vinculou) {
    let sobrou = '';
    try {
      await deps.excluirUsuario(novo.id);
    } catch (e2) {
      registrarErro(deps, 'desfazer criação do usuário', e2);
      sobrou = ' Atenção: o usuário de acesso criado (' + email + ') não pôde ser removido — apague-o no ' +
        'painel do Supabase (Authentication → Users).';
    }
    if (falhaVinculo && eUnicidade(falhaVinculo)) { return erro(409, cab, MSG.emailEmUsoMilitar + sobrou); }
    if (falhaVinculo) {
      registrarErro(deps, 'vincular usuário ao militar', falhaVinculo);
      return erro(500, cab, 'Não foi possível vincular o acesso ao cadastro' + detalhe(falhaVinculo) + '.' + sobrou);
    }
    return erro(409, cab, 'O cadastro mudou enquanto o acesso era criado (outro gestor pode ter criado o acesso ' +
      'ou excluído o militar). Atualize a página e confira.' + sobrou);
  }

  await auditar(ctx, resumo(alvo), { usuario_id: novo.id, email: email, deve_trocar_senha: true });
  return responder(200, cab, { ok: true, senha_temporaria: senha, email: email });
}

async function redefinirSenha(ctx: Contexto): Promise<Resposta> {
  const { deps, cab, alvo } = ctx;
  if (!alvo.usuario_id) { return erro(400, cab, MSG.semAcesso); }
  const senha = gerarSenhaTemporaria(deps.bytesAleatorios ? deps.bytesAleatorios.bind(deps) : undefined);
  try {
    await deps.atualizarUsuario(alvo.usuario_id, { senha: senha });
  } catch (e) {
    if (eUsuarioInexistente(e)) { return erro(409, cab, MSG.usuarioSumiu); }
    registrarErro(deps, 'redefinir senha', e);
    return erro(500, cab, 'Não foi possível redefinir a senha' + detalhe(e) + '.');
  }
  try {
    await deps.atualizarMilitar(alvo.id, { deve_trocar_senha: true });
  } catch (e) {
    /* A senha nova já vale; só a troca obrigatória no próximo acesso não
       ficou marcada. Informa sem esconder a senha gerada. */
    registrarErro(deps, 'marcar troca de senha', e);
    await auditar(ctx, resumo(alvo), { deve_trocar_senha: false, falha: 'marcar troca obrigatória' });
    return responder(200, cab, {
      ok: true, senha_temporaria: senha,
      aviso: 'A senha foi redefinida, mas não foi possível exigir a troca no próximo acesso. Peça ao militar ' +
        'para trocá-la em "Minha conta".'
    });
  }
  await auditar(ctx, resumo(alvo), { deve_trocar_senha: true });
  return responder(200, cab, { ok: true, senha_temporaria: senha });
}

async function desativar(ctx: Contexto): Promise<Resposta> {
  const { deps, cab, alvo } = ctx;
  /* Primeiro o banco: é ele que aplica a trava anti-bloqueio. Recusou,
     nada mudou (nem no Auth). E desativar no banco já corta o acesso aos
     dados na hora (todas as políticas exigem cadastro ativo). */
  let alterou: boolean;
  try {
    alterou = await deps.atualizarMilitar(alvo.id, { ativo: false });
  } catch (e) {
    if (eTrava(e)) { return erro(409, cab, mensagemDe(e)); }
    registrarErro(deps, 'desativar militar', e);
    return erro(500, cab, 'Não foi possível desativar o cadastro' + detalhe(e) + '.');
  }
  if (!alterou) { return erro(404, cab, MSG.naoEncontrado); }

  let aviso = '';
  if (alvo.usuario_id) {
    try {
      await deps.atualizarUsuario(alvo.usuario_id, { banimento: BANIMENTO_PERMANENTE });
    } catch (e) {
      if (!eUsuarioInexistente(e)) {
        registrarErro(deps, 'bloquear login', e);
        aviso = 'O cadastro foi desativado e o acesso aos dados já está bloqueado, mas o login não pôde ser ' +
          'bloqueado no Supabase' + detalhe(e) + '. Tente "Desativar" de novo mais tarde.';
      }
    }
  }
  await auditar(ctx, resumo(alvo), { ativo: false, login_bloqueado: !aviso && !!alvo.usuario_id });
  return responder(200, cab, aviso ? { ok: true, aviso: aviso } : { ok: true });
}

async function reativar(ctx: Contexto): Promise<Resposta> {
  const { deps, cab, alvo } = ctx;
  /* Primeiro o Auth: se o desbloqueio falhar, nada mudou e basta tentar de
     novo. (Desbloqueado com o cadastro ainda inativo, o militar entra mas
     não vê nada — inofensivo.) */
  if (alvo.usuario_id) {
    try {
      await deps.atualizarUsuario(alvo.usuario_id, { banimento: 'none' });
    } catch (e) {
      if (eUsuarioInexistente(e)) { return erro(409, cab, MSG.usuarioSumiu); }
      registrarErro(deps, 'desbloquear login', e);
      return erro(502, cab, 'Não foi possível desbloquear o login no Supabase' + detalhe(e) +
        '. Nada foi alterado; tente de novo.');
    }
  }
  let alterou: boolean;
  try {
    alterou = await deps.atualizarMilitar(alvo.id, { ativo: true });
  } catch (e) {
    registrarErro(deps, 'reativar militar', e);
    return erro(500, cab, 'Não foi possível reativar o cadastro' + detalhe(e) + '.');
  }
  if (!alterou) { return erro(404, cab, MSG.naoEncontrado); }
  await auditar(ctx, resumo(alvo), { ativo: true });
  return responder(200, cab, { ok: true });
}

async function removerMfa(ctx: Contexto): Promise<Resposta> {
  const { deps, cab, alvo } = ctx;
  if (!alvo.usuario_id) { return erro(400, cab, 'Este militar ainda não tem acesso.'); }
  let fatores: FatorMfa[];
  try {
    fatores = await deps.listarFatores(alvo.usuario_id);
  } catch (e) {
    if (eUsuarioInexistente(e)) { return erro(409, cab, MSG.usuarioSumiu); }
    registrarErro(deps, 'listar fatores', e);
    return erro(500, cab, 'Não foi possível consultar o segundo fator' + detalhe(e) + '.');
  }
  let removidos = 0;
  for (const fator of fatores || []) {
    try {
      await deps.excluirFator(alvo.usuario_id, fator.id);
      removidos += 1;
    } catch (e) {
      registrarErro(deps, 'remover fator', e);
      await auditar(ctx, resumo(alvo), { fatores_removidos: removidos, falha: true });
      return erro(500, cab, 'Não foi possível remover todos os fatores (' + removidos + ' de ' +
        fatores.length + ' removidos)' + detalhe(e) + '. Tente de novo.');
    }
  }
  await auditar(ctx, resumo(alvo), { fatores_removidos: removidos });
  return responder(200, cab, removidos
    ? { ok: true, removidos: removidos }
    : { ok: true, removidos: 0, aviso: 'Este militar não tinha segundo fator cadastrado.' });
}

async function alterarEmail(ctx: Contexto): Promise<Resposta> {
  const { deps, cab, alvo, pedido } = ctx;
  if (!alvo.usuario_id) {
    return erro(400, cab, 'Este militar ainda não tem acesso: altere o e-mail no próprio cadastro.');
  }
  const email = pedido.email || '';
  if (!email) { return erro(400, cab, 'Informe o novo e-mail.'); }
  if (!emailValido(email)) { return erro(400, cab, MSG.emailInvalido); }
  const anterior = normalizarEmail(alvo.email);
  if (email === anterior) { return erro(400, cab, 'O novo e-mail é igual ao atual.'); }
  const outro = await deps.militarPorEmail(email);
  if (outro && outro.id !== alvo.id) { return erro(409, cab, MSG.emailEmUsoMilitar); }

  try {
    await deps.atualizarUsuario(alvo.usuario_id, { email: email });
  } catch (e) {
    if (eEmailExistente(e)) { return erro(409, cab, MSG.emailEmUsoAuth); }
    if (eUsuarioInexistente(e)) { return erro(409, cab, MSG.usuarioSumiu); }
    registrarErro(deps, 'alterar e-mail no Auth', e);
    return erro(500, cab, 'Não foi possível alterar o e-mail de acesso' + detalhe(e) + '.');
  }
  try {
    const alterou = await deps.atualizarMilitar(alvo.id, { email: email });
    if (!alterou) { throw new Error('cadastro não encontrado'); }
  } catch (e) {
    /* Desfaz no Auth para os dois lados não ficarem diferentes. */
    let desfez = true;
    if (anterior) {
      try { await deps.atualizarUsuario(alvo.usuario_id, { email: anterior }); } catch (e2) {
        desfez = false;
        registrarErro(deps, 'desfazer e-mail no Auth', e2);
      }
    }
    const resto = desfez ? '' : ' Atenção: o login passou a ser ' + email + ', mas o cadastro continua com ' +
      anterior + ' — tente de novo para igualar os dois.';
    if (eUnicidade(e)) { return erro(409, cab, MSG.emailEmUsoMilitar + resto); }
    registrarErro(deps, 'alterar e-mail no cadastro', e);
    return erro(500, cab, 'Não foi possível gravar o novo e-mail no cadastro' + detalhe(e) + '.' + resto);
  }
  await auditar(ctx, resumo(alvo), { email: email });
  return responder(200, cab, { ok: true, email: email });
}

async function excluir(ctx: Contexto): Promise<Resposta> {
  const { deps, cab, alvo } = ctx;
  /* Primeiro a linha de militares: o gatilho aplica a trava anti-bloqueio
     e, se recusar, o Auth fica intocado. Apagada a linha, o acesso já está
     cortado (não há mais militar ligado ao usuário) e o histórico fica com
     os nomes gravados nas colunas *_nome. */
  let apagou: boolean;
  try {
    apagou = await deps.excluirMilitar(alvo.id);
  } catch (e) {
    if (eTrava(e)) { return erro(409, cab, mensagemDe(e)); }
    registrarErro(deps, 'excluir militar', e);
    return erro(500, cab, 'Não foi possível excluir o cadastro' + detalhe(e) + '.');
  }
  if (!apagou) { return erro(404, cab, MSG.naoEncontrado); }

  let aviso = '';
  let authRemovido = false;
  if (alvo.usuario_id) {
    try {
      await deps.excluirUsuario(alvo.usuario_id);
      authRemovido = true;
    } catch (e) {
      if (eUsuarioInexistente(e)) {
        authRemovido = true;
      } else {
        registrarErro(deps, 'excluir usuário do Auth', e);
        aviso = 'O cadastro foi excluído e o acesso já está cortado, mas o usuário de login (' +
          (alvo.email || alvo.usuario_id) + ') não pôde ser apagado do Supabase' + detalhe(e) +
          '. Apague-o no painel (Authentication → Users).';
      }
    }
  }
  await auditar(ctx, resumo(alvo), { excluido: true, usuario_auth_removido: authRemovido });
  return responder(200, cab, aviso ? { ok: true, aviso: aviso } : { ok: true });
}
