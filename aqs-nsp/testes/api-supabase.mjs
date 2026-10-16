#!/usr/bin/env node
/* =========================================================================
   HABE – AQS e NSP — testes do adaptador real (assets/js/api-supabase.js)
   Uso: node testes/api-supabase.mjs   (a partir da pasta aqs-nsp)

   Não há Supabase de verdade aqui: num vm do Node (como o navegador
   carregaria: config, util, regras, recorrencia, api-supabase, api.js) o
   window.supabase é FALSO e registra cada cadeia de chamadas — from/select/
   eq/gte/lte/in/order/range/insert/update/delete/upsert, rpc, storage,
   functions, auth e canais do tempo real. Cada teste define o que o
   "servidor" responde e confere o que o adaptador pediu e devolveu:
   filtros, caminhos de arquivo, ordem das operações e a tradução dos erros
   para português.
   ========================================================================= */

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const js = (nome) => path.join(raiz, 'assets', 'js', nome);

/* ---------- mini-executor ---------- */

let aprovados = 0;
const falhas = [];

async function teste(nome, fn) {
  try {
    await fn();
    aprovados += 1;
  } catch (erro) {
    falhas.push({ nome, erro });
  }
}

/* Objetos do vm têm outros protótipos: compara pelo conteúdo. */
const json = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
function igual(atual, esperado, mensagem) {
  assert.deepStrictEqual(json(atual), esperado, mensagem);
}
const esperar = (ms = 0) => new Promise((r) => setTimeout(r, ms));

async function rejeita(promessa, padrao, mensagem) {
  let erro = null;
  try { await promessa; } catch (e) { erro = e; }
  assert.ok(erro, (mensagem || 'devia rejeitar') + ' (resolveu)');
  if (padrao instanceof RegExp) { assert.match(erro.message, padrao, mensagem); }
  else if (typeof padrao === 'string') { assert.equal(erro.message, padrao, mensagem); }
  return erro;
}

/* ---------- armazenamento e JWT falsos ---------- */

function criarArmazenamento() {
  const dados = new Map();
  return {
    getItem: (k) => (dados.has(k) ? dados.get(k) : null),
    setItem: (k, v) => { dados.set(k, String(v)); },
    removeItem: (k) => { dados.delete(k); },
    clear: () => dados.clear(),
    _dados: dados
  };
}

function token(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return b64({ alg: 'HS256' }) + '.' + b64(payload) + '.assinatura';
}

function sessao({ aal = 'aal1', fatores = [], id = 'u-1', email = 'leticia@habe.exemplo' } = {}) {
  return { access_token: token({ sub: id, aal }), user: { id, email, factors: fatores } };
}

const FATOR_OK = { id: 'f-ok', factor_type: 'totp', status: 'verified', friendly_name: 'HABE AQS-NSP', created_at: '2026-10-01T10:00:00Z' };

/* ---------- supabase falso ---------- */

const METODOS_CONSULTA = ['select', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is', 'or', 'not', 'match', 'filter',
  'order', 'range', 'limit', 'insert', 'update', 'delete', 'upsert', 'single', 'maybeSingle'];

function criarSupabaseFalso() {
  const s = {
    clientes: [],
    consultas: [],
    sessao: null,
    fatores: [],
    aal: { currentLevel: null, nextLevel: null, currentAuthenticationMethods: [] },
    auth: [],                 /* chamadas ao Auth: [metodo, args] */
    canais: [],
    /* "servidor": devolve { data, error, count, status } para cada consulta */
    responder: () => ({ data: [], error: null }),
    respostaLogin: null,
    erroUnenroll: null,
    erroVerify: null,
    erroUpdateUser: null
  };

  function consulta(alvo, cadeiaInicial) {
    const c = { alvo, cadeia: cadeiaInicial ? [cadeiaInicial] : [] };
    s.consultas.push(c);
    const b = {};
    for (const m of METODOS_CONSULTA) {
      b[m] = (...args) => { c.cadeia.push([m, ...args]); return b; };
    }
    b.then = (ok, falha) => Promise.resolve().then(() => s.responder(c)).then(ok, falha);
    return b;
  }

  function emitir(cliente, evento, sess) {
    for (const cb of cliente._ouvintes.slice()) { cb(evento, sess); }
  }

  function novoCliente(url, chave, opcoes) {
    const cliente = {
      url, chave, opcoes, _ouvintes: [], _canais: [],
      from: (tabela) => consulta('from:' + tabela),
      rpc: (nome, params) => consulta('rpc:' + nome, ['rpc', params]),
      storage: {
        from: (bucket) => ({
          upload: (...args) => consulta('storage:' + bucket + ':upload', ['upload', ...args]),
          download: (...args) => consulta('storage:' + bucket + ':download', ['download', ...args]),
          remove: (...args) => consulta('storage:' + bucket + ':remove', ['remove', ...args])
        })
      },
      functions: {
        invoke: (nome, op) => consulta('functions:' + nome, ['invoke', op])
      },
      channel(nome) {
        const canal = {
          topic: 'realtime:' + nome, nome, ligacoes: [], removido: false, statusCb: null,
          on(tipo, filtro, cb) { canal.ligacoes.push({ tipo, filtro, cb }); return canal; },
          subscribe(cb) { canal.statusCb = cb; return canal; }
        };
        cliente._canais.push(canal);
        s.canais.push(canal);
        return canal;
      },
      getChannels: () => cliente._canais.filter((c) => !c.removido),
      removeChannel: async (canal) => { canal.removido = true; return 'ok'; },
      removeAllChannels: async () => { cliente._canais.forEach((c) => { c.removido = true; }); return []; },
      auth: {
        onAuthStateChange(cb) {
          cliente._ouvintes.push(cb);
          return { data: { subscription: { unsubscribe() { cliente._ouvintes = cliente._ouvintes.filter((x) => x !== cb); } } } };
        },
        async getSession() { s.auth.push(['getSession']); return { data: { session: s.sessao }, error: null }; },
        async signInWithPassword(cred) {
          s.auth.push(['signInWithPassword', cred]);
          if (s.respostaLogin) { return s.respostaLogin; }
          s.sessao = sessao({ fatores: s.fatores, aal: 'aal1' });
          emitir(cliente, 'SIGNED_IN', s.sessao);
          return { data: { session: s.sessao, user: s.sessao.user }, error: null };
        },
        async signOut(op) {
          s.auth.push(['signOut', op]);
          s.sessao = null;
          emitir(cliente, 'SIGNED_OUT', null);
          return { error: s.erroSignOut || null };
        },
        async updateUser(attrs) {
          s.auth.push(['updateUser', attrs]);
          return { data: { user: {} }, error: s.erroUpdateUser };
        },
        stopAutoRefresh() { s.auth.push(['stopAutoRefresh']); },
        mfa: {
          async getAuthenticatorAssuranceLevel() { s.auth.push(['aal']); return { data: s.aal, error: null }; },
          async listFactors() {
            s.auth.push(['listFactors']);
            return { data: { all: s.fatores.slice(), totp: s.fatores.filter((f) => f.status === 'verified') }, error: null };
          },
          async enroll(p) {
            s.auth.push(['enroll', p]);
            return { data: { id: 'f-novo', type: 'totp', friendly_name: p.friendlyName,
              totp: { qr_code: 'data:image/svg+xml;utf-8,<svg fill="#0b2f5c"></svg>', secret: 'SEGREDOBASE32', uri: 'otpauth://x' } }, error: null };
          },
          async challengeAndVerify(p) {
            s.auth.push(['challengeAndVerify', p]);
            if (s.erroVerify) { return { data: null, error: s.erroVerify }; }
            s.aal = { currentLevel: 'aal2', nextLevel: 'aal2' };
            s.sessao = sessao({ fatores: s.fatores, aal: 'aal2' });
            emitir(cliente, 'MFA_CHALLENGE_VERIFIED', s.sessao);
            return { data: {}, error: null };
          },
          async unenroll(p) {
            s.auth.push(['unenroll', p]);
            return s.erroUnenroll ? { data: null, error: s.erroUnenroll } : { data: { id: p.factorId }, error: null };
          }
        }
      }
    };
    return cliente;
  }

  s.createClient = (url, chave, opcoes) => {
    const c = novoCliente(url, chave, opcoes);
    s.clientes.push(c);
    return c;
  };
  s.cliente = () => s.clientes[s.clientes.length - 1];
  s.emitir = (evento, sess) => emitir(s.cliente(), evento, sess);
  s.de = (alvo) => s.consultas.filter((c) => c.alvo === alvo);
  return s;
}

/* Argumentos de cada chamada "metodo" numa cadeia. */
const args = (c, metodo) => c.cadeia.filter((x) => x[0] === metodo).map((x) => json(x.slice(1)));

/* ---------- ambiente ---------- */

const ORDEM = ['config.js', 'util.js', 'regras.js', 'recorrencia.js', 'api-supabase.js', 'api.js'];
const MILITAR = { id: 'm-1', usuario_id: 'u-1', posto: '1º Ten', nome_guerra: 'Letícia', email: 'leticia@habe.exemplo',
  papel: 'adjunto', ativo: true, deve_trocar_senha: false };
const CHEFE = Object.assign({}, MILITAR, { id: 'm-chefe', posto: 'Maj', nome_guerra: 'Chefe', papel: 'chefia' });

function montar({ configurado = true, lembrar = null, perfil = MILITAR } = {}) {
  const sb = criarSupabaseFalso();
  const temporizadores = [];
  const localStorage = criarArmazenamento();
  const sessionStorage = criarArmazenamento();
  if (lembrar !== null) { localStorage.setItem('aqs_lembrar', lembrar); }
  /* avisos do adaptador (console.warn) ficam guardados, sem poluir a saída */
  const avisos = [];
  const consoleQuieto = { log: console.log, error: console.error, warn: (...a) => avisos.push(a) };
  const ctx = vm.createContext({
    console: consoleQuieto, crypto: globalThis.crypto, atob, Blob, File, TextEncoder, TextDecoder, URL,
    localStorage, sessionStorage,
    /* espera ≥ 1 s (reassinatura do tempo real) fica guardada para o
       teste disparar; as curtas rodam de verdade */
    setTimeout: (fn, ms) => {
      if (ms >= 1000) { temporizadores.push({ fn, ms }); return temporizadores.length; }
      return setTimeout(fn, ms);
    },
    clearTimeout: (id) => {
      if (typeof id === 'number' && temporizadores[id - 1]) { temporizadores[id - 1].cancelado = true; return; }
      clearTimeout(id);
    },
    setInterval, clearInterval
  });
  ctx.window = ctx;
  ctx.supabase = { createClient: sb.createClient };
  vm.runInContext(fs.readFileSync(js('config.js'), 'utf8'), ctx, { filename: 'config.js' });
  if (configurado) {
    ctx.AQS_CONFIG.SUPABASE_URL = 'https://exemplo-teste.supabase.co/';
    ctx.AQS_CONFIG.SUPABASE_ANON_KEY = 'chave-anon-de-teste';
  }
  for (const nome of ORDEM.slice(1)) {
    vm.runInContext(fs.readFileSync(js(nome), 'utf8'), ctx, { filename: nome });
  }
  /* servidor padrão: meu_perfil devolve o militar; o resto, vazio */
  sb.padrao = (c) => {
    if (c.alvo === 'rpc:meu_perfil') { return { data: Object.assign({}, sb.perfil), error: null }; }
    return { data: [], error: null, count: 0 };
  };
  sb.perfil = perfil;
  sb.responder = sb.padrao;
  return { sb, ctx, A: ctx.ApiSupabase, Api: ctx.Api, temporizadores, localStorage, sessionStorage, avisos };
}

/* Responde por alvo; o que não estiver no mapa cai no padrão. */
function servidor(amb, mapa) {
  amb.sb.responder = (c) => {
    const r = mapa[c.alvo];
    if (r === undefined) { return amb.sb.padrao(c); }
    return typeof r === 'function' ? r(c) : r;
  };
}

/* =========================================================================
   carga e contrato
   ========================================================================= */

await teste('carrega sem criar cliente e implementa todos os Api.METODOS', async () => {
  const amb = montar();
  assert.equal(amb.sb.clientes.length, 0, 'nenhum cliente ao carregar');
  const faltando = json(amb.Api.METODOS).filter((m) => typeof amb.A[m] !== 'function');
  igual(faltando, []);
  assert.equal(amb.Api.modo, 'supabase');
});

await teste('config.js com os valores de exemplo: iniciar rejeita com "configuração pendente"', async () => {
  const amb = montar({ configurado: false });
  const erro = await rejeita(amb.A.iniciar(), /Configuração pendente.*config\.js/);
  assert.equal(erro.codigo, 'configuracao_pendente');
  assert.equal(amb.sb.clientes.length, 0);
  /* qualquer outro método também, sem lançar síncrono */
  await rejeita(amb.A.listarSetores(), /Configuração pendente/);
});

await teste('iniciar: cliente com as opções de auth do contrato, token no sessionStorage por padrão', async () => {
  const amb = montar();
  const r = await amb.A.iniciar();
  assert.equal(r, null);
  assert.equal(amb.sb.clientes.length, 1);
  const c = amb.sb.cliente();
  assert.equal(c.url, 'https://exemplo-teste.supabase.co');
  assert.equal(c.chave, 'chave-anon-de-teste');
  const auth = c.opcoes.auth;
  assert.equal(auth.persistSession, true);
  assert.equal(auth.autoRefreshToken, true);
  assert.equal(auth.detectSessionInUrl, false);
  assert.equal(auth.storageKey, 'aqs-nsp-sessao');
  auth.storage.setItem('aqs-nsp-sessao', 'x');
  assert.equal(amb.sessionStorage.getItem('aqs-nsp-sessao'), 'x');
  assert.equal(amb.localStorage.getItem('aqs-nsp-sessao'), null);
});

await teste('preferência aqs_lembrar = "1" guarda o token no localStorage', async () => {
  const amb = montar({ lembrar: '1' });
  await amb.A.iniciar();
  amb.sb.cliente().opcoes.auth.storage.setItem('aqs-nsp-sessao', 'y');
  assert.equal(amb.localStorage.getItem('aqs-nsp-sessao'), 'y');
});

await teste('armazenamento bloqueado (modo privado): segue na memória sem quebrar', async () => {
  const amb = montar();
  const bloqueado = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); },
    removeItem() { throw new Error('SecurityError'); } };
  amb.ctx.sessionStorage = bloqueado;
  amb.ctx.localStorage = bloqueado;
  await amb.A.iniciar();
  const st = amb.sb.cliente().opcoes.auth.storage;
  st.setItem('aqs-nsp-sessao', 'z');
  assert.equal(st.getItem('aqs-nsp-sessao'), 'z');
  const r = await amb.A.entrar('a@b.exemplo', 'senha', true);
  igual(r, { precisaMfa: false });
});

await teste('iniciar com sessão completa devolve { usuario_id, email }; com 2º fator pendente, null', async () => {
  const amb = montar();
  amb.sb.sessao = sessao();
  igual(await amb.A.iniciar(), { usuario_id: 'u-1', email: 'leticia@habe.exemplo' });
  amb.sb.aal = { currentLevel: 'aal1', nextLevel: 'aal2' };
  amb.sb.sessao = sessao({ fatores: [FATOR_OK] });
  assert.equal(await amb.A.sessaoAtual(), null);
});

/* =========================================================================
   entrar, MFA e eventos de sessão
   ========================================================================= */

await teste('entrar: e-mail normalizado, preferência gravada e cliente recriado ANTES do login quando muda o armazenamento', async () => {
  const amb = montar();
  await amb.A.iniciar();
  amb.localStorage.setItem('aqs-nsp-sessao', 'velha');
  amb.sessionStorage.setItem('aqs-nsp-sessao', 'velha');
  const r = await amb.A.entrar('  Leticia@HABE.exemplo ', 'Senha12345', true);
  igual(r, { precisaMfa: false });
  assert.equal(amb.localStorage.getItem('aqs_lembrar'), '1');
  assert.equal(amb.sb.clientes.length, 2, 'cliente novo com localStorage');
  assert.equal(amb.sessionStorage.getItem('aqs-nsp-sessao'), null, 'token do outro armazenamento apagado');
  const login = amb.sb.auth.find((x) => x[0] === 'signInWithPassword');
  igual(login[1], { email: 'leticia@habe.exemplo', password: 'Senha12345' });
  assert.ok(amb.sb.clientes[0]._ouvintes.length === 0, 'ouvinte do cliente antigo desligado');
  /* mesma escolha: não recria */
  await amb.A.entrar('leticia@habe.exemplo', 'Senha12345', true);
  assert.equal(amb.sb.clientes.length, 2);
  /* sem lembrar: volta ao sessionStorage e apaga o token lembrado */
  amb.localStorage.setItem('aqs-nsp-sessao', 'lembrada');
  await amb.A.entrar('leticia@habe.exemplo', 'Senha12345', false);
  assert.equal(amb.sb.clientes.length, 3);
  assert.equal(amb.localStorage.getItem('aqs_lembrar'), '0');
  assert.equal(amb.localStorage.getItem('aqs-nsp-sessao'), null);
});

await teste('entrar com segundo fator: precisaMfa; verificarMfa usa o TOTP verificado', async () => {
  const amb = montar();
  amb.sb.fatores = [{ id: 'f-pendente', factor_type: 'totp', status: 'unverified' }, FATOR_OK];
  amb.sb.aal = { currentLevel: 'aal1', nextLevel: 'aal2' };
  igual(await amb.A.entrar('leticia@habe.exemplo', 'Senha12345', false), { precisaMfa: true });
  await rejeita(amb.A.verificarMfa('12a456'), /6 números/);
  assert.ok(!amb.sb.auth.some((x) => x[0] === 'challengeAndVerify'), 'formato inválido nem chega ao servidor');
  await amb.A.verificarMfa(' 123 456 ');
  const v = amb.sb.auth.find((x) => x[0] === 'challengeAndVerify');
  igual(v[1], { factorId: 'f-ok', code: '123456' });
  amb.sb.erroVerify = { name: 'AuthApiError', status: 422, code: 'mfa_verification_failed', message: 'Invalid TOTP code entered' };
  await rejeita(amb.A.verificarMfa('000000'), /Código inválido ou expirado/);
});

await teste('entrar: mensagens de credenciais, banimento, excesso de tentativas e rede', async () => {
  const casos = [
    [{ name: 'AuthApiError', status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' }, 'E-mail ou senha incorretos.'],
    [{ name: 'AuthApiError', status: 400, code: 'user_banned', message: 'User is banned' }, 'Acesso desativado. Procure a chefia.'],
    [{ name: 'AuthApiError', status: 429, code: 'over_request_rate_limit', message: 'Request rate limit reached' }, 'Muitas tentativas. Aguarde alguns minutos.'],
    [{ name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' }, 'Sem conexão com o servidor. Verifique a internet.']
  ];
  for (const [erro, mensagem] of casos) {
    const amb = montar();
    amb.sb.respostaLogin = { data: { session: null, user: null }, error: erro };
    await rejeita(amb.A.entrar('a@b.exemplo', 'x', false), mensagem, erro.code || erro.name);
  }
  const amb = montar();
  await rejeita(amb.A.entrar('', 'x'), /Informe o e-mail e a senha/);
});

await teste('aoMudarSessao: só mudanças reais; 2º fator pendente não é "entrou"; sessão restaurada ao abrir não avisa', async () => {
  const amb = montar();
  const eventos = [];
  amb.A.aoMudarSessao((e) => eventos.push(e));
  amb.sb.sessao = sessao();
  await amb.A.iniciar();
  amb.sb.emitir('SIGNED_IN', amb.sb.sessao); /* volta à aba: repetido */
  await esperar(5);
  igual(eventos, [], 'sessão restaurada / SIGNED_IN repetido não avisam');
  amb.sb.emitir('SIGNED_OUT', null);
  await esperar(5);
  igual(eventos, ['saiu']);
  /* login com 2º fator: nada até o código */
  amb.sb.emitir('SIGNED_IN', sessao({ fatores: [FATOR_OK], aal: 'aal1' }));
  await esperar(5);
  igual(eventos, ['saiu']);
  amb.sb.emitir('MFA_CHALLENGE_VERIFIED', sessao({ fatores: [FATOR_OK], aal: 'aal2' }));
  amb.sb.emitir('TOKEN_REFRESHED', sessao({ fatores: [FATOR_OK], aal: 'aal2' }));
  await esperar(5);
  igual(eventos, ['saiu', 'entrou']);
  const cancelar = amb.A.aoMudarSessao(() => eventos.push('outro'));
  cancelar();
  amb.sb.emitir('SIGNED_OUT', null);
  await esperar(5);
  igual(eventos, ['saiu', 'entrou', 'saiu']);
});

await teste('sair: escopo local ou global e o canal de tempo real é removido', async () => {
  const amb = montar();
  amb.sb.sessao = sessao();
  await amb.A.iniciar();
  amb.A.assinarMudancas(() => {});
  await esperar(5);
  const canal = amb.sb.canais[0];
  await amb.A.sair(false);
  igual(amb.sb.auth.filter((x) => x[0] === 'signOut').map((x) => x[1]), [{ scope: 'local' }]);
  assert.equal(canal.removido, true);
  await amb.A.sair(true);
  igual(amb.sb.auth.filter((x) => x[0] === 'signOut').map((x) => x[1]).at(-1), { scope: 'global' });
});

await teste('meuPerfil: rpc meu_perfil; sem_cadastro vira a mensagem do contrato', async () => {
  const amb = montar();
  const m = await amb.A.meuPerfil();
  assert.equal(m.id, 'm-1');
  assert.equal(amb.sb.de('rpc:meu_perfil').length, 1);
  servidor(amb, { 'rpc:meu_perfil': { data: null, error: { code: '42501', message: 'sem_cadastro', hint: 'Seu usuário…' } } });
  await rejeita(amb.A.meuPerfil(), /^Seu usuário não está vinculado a um cadastro ativo/);
});

await teste('trocarSenha: valida, atualiza no Auth e confirma no banco', async () => {
  const amb = montar();
  await rejeita(amb.A.trocarSenha('curta1'), /10 caracteres/);
  assert.ok(!amb.sb.auth.some((x) => x[0] === 'updateUser'));
  await amb.A.trocarSenha('NovaSenha2026');
  igual(amb.sb.auth.find((x) => x[0] === 'updateUser')[1], { password: 'NovaSenha2026' });
  assert.equal(amb.sb.de('rpc:confirmar_troca_senha').length, 1);
  amb.sb.erroUpdateUser = { name: 'AuthApiError', status: 422, code: 'same_password', message: 'New password should be different' };
  await rejeita(amb.A.trocarSenha('NovaSenha2026'), /diferente da atual/);
});

await teste('MFA: listar, iniciar (remove pendente, nome do fator, QR codificado), confirmar e remover', async () => {
  const amb = montar();
  amb.sb.fatores = [FATOR_OK, { id: 'f-abandonado', factor_type: 'totp', status: 'unverified', created_at: 'x' },
    { id: 'f-tel', factor_type: 'phone', status: 'verified' }];
  igual(await amb.A.mfaFatores(), [
    { id: 'f-ok', status: 'verified', criado_em: '2026-10-01T10:00:00Z' },
    { id: 'f-abandonado', status: 'unverified', criado_em: 'x' }
  ]);
  const r = await amb.A.mfaIniciarCadastro();
  igual(amb.sb.auth.filter((x) => x[0] === 'unenroll').map((x) => x[1]), [{ factorId: 'f-abandonado' }]);
  const enroll = amb.sb.auth.find((x) => x[0] === 'enroll')[1];
  assert.equal(enroll.factorType, 'totp');
  assert.equal(enroll.friendlyName, 'HABE AQS-NSP (2)', 'nome livre (o 1º já está em uso)');
  assert.equal(r.fator_id, 'f-novo');
  assert.equal(r.segredo, 'SEGREDOBASE32');
  assert.ok(r.qr_code.startsWith('data:image/svg+xml;charset=utf-8,%3Csvg'), r.qr_code);
  assert.ok(!r.qr_code.includes('#'), 'o # do SVG não corta o data URI');
  await amb.A.mfaConfirmarCadastro('f-novo', '654321');
  igual(amb.sb.auth.filter((x) => x[0] === 'challengeAndVerify').at(-1)[1], { factorId: 'f-novo', code: '654321' });
  amb.sb.erroUnenroll = { name: 'AuthApiError', status: 422, code: 'insufficient_aal', message: 'AAL2 required to unenroll verified factor' };
  await rejeita(amb.A.mfaRemover('f-ok'), /entre de novo informando o código/);
});

/* =========================================================================
   consultas
   ========================================================================= */

await teste('listarOcorrencias monta os filtros sobre v_ocorrencias', async () => {
  const amb = montar();
  await amb.A.listarOcorrencias({ de: '2026-10-01', ate: '2026-10-31T00:00:00', atividade_id: 'a-1', somenteAbertas: true });
  const c = amb.sb.de('from:v_ocorrencias')[0];
  igual(args(c, 'select'), [['*', { count: 'exact' }]]);
  igual(args(c, 'eq'), [['atividade_id', 'a-1']]);
  igual(args(c, 'in'), [['status', ['pendente', 'em_andamento']]]);
  igual(args(c, 'gte'), [['data_ref', '2026-10-01']]);
  igual(args(c, 'lte'), [['data_ref', '2026-10-31']]);
  igual(args(c, 'order'), [['data_ref', { ascending: true }], ['criado_em', { ascending: true }], ['id', { ascending: true }]]);
  igual(args(c, 'range'), [[0, 999]]);
  /* sem filtros: nenhum filtro de data nem de status */
  await amb.A.listarOcorrencias({});
  const c2 = amb.sb.de('from:v_ocorrencias')[1];
  igual([args(c2, 'eq'), args(c2, 'in'), args(c2, 'gte'), args(c2, 'lte')], [[], [], [], []]);
});

await teste('paginação: busca em páginas com .range até completar a contagem', async () => {
  const amb = montar();
  const linhas = Array.from({ length: 1500 }, (_, i) => ({ id: 'o' + i }));
  servidor(amb, {
    'from:v_ocorrencias': (c) => {
      const [ini, fim] = args(c, 'range')[0];
      return { data: linhas.slice(ini, fim + 1), error: null, count: c.cadeia[0][2] ? 1500 : null };
    }
  });
  const r = await amb.A.listarOcorrencias({});
  assert.equal(r.length, 1500);
  igual(amb.sb.de('from:v_ocorrencias').map((c) => args(c, 'range')[0]), [[0, 999], [1000, 1999]]);
  /* projeto com "Max rows" menor (500): a contagem garante que nada se perde */
  servidor(amb, {
    'from:setores': (c) => {
      const [ini] = args(c, 'range')[0];
      return { data: linhas.slice(ini, ini + 500), error: null, count: c.cadeia[0][2] ? 1500 : null };
    }
  });
  assert.equal((await amb.A.listarSetores()).length, 1500);
});

await teste('obterOcorrencia: inexistente ⇒ mensagem clara', async () => {
  const amb = montar();
  await rejeita(amb.A.obterOcorrencia('x'), /Ocorrência não encontrada/);
  const c = amb.sb.de('from:v_ocorrencias')[0];
  igual(args(c, 'eq'), [['id', 'x']]);
});

await teste('listarAtividades: responsáveis embutidos viram lista de ids, por ordem', async () => {
  const amb = montar();
  servidor(amb, {
    'from:atividades': { data: [{ id: 'a1', ordem: 1, titulo: 'Reunião', atividade_responsaveis: [{ militar_id: 'm-1' }, { militar_id: 'm-2' }] },
      { id: 'a2', ordem: 2, titulo: 'Relatório', atividade_responsaveis: [] }], error: null, count: 2 }
  });
  const r = await amb.A.listarAtividades();
  igual(r, [{ id: 'a1', ordem: 1, titulo: 'Reunião', responsaveis: ['m-1', 'm-2'] },
    { id: 'a2', ordem: 2, titulo: 'Relatório', responsaveis: [] }]);
  const c = amb.sb.de('from:atividades')[0];
  igual(args(c, 'select')[0][0], '*, atividade_responsaveis(militar_id)');
  igual(args(c, 'order')[0], ['ordem', { ascending: true }]);
});

await teste('salvarAtividade chama rpc("salvar_atividade", { p }) só com os campos do contrato', async () => {
  const amb = montar();
  servidor(amb, { 'rpc:salvar_atividade': { data: 'a-nova', error: null } });
  const id = await amb.A.salvarAtividade({
    titulo: 'Auditoria de prontuários', tipo: 'recorrente', periodicidade: 'mensal', dia_mes: 15, mes_inicio: null,
    responsaveis: ['m-1'], setor_id: '', lixo: 'ignorar', atividade_responsaveis: [], prazo: undefined
  });
  assert.equal(id, 'a-nova');
  const c = amb.sb.de('rpc:salvar_atividade')[0];
  igual(c.cadeia[0], ['rpc', { p: { titulo: 'Auditoria de prontuários', setor_id: '', tipo: 'recorrente',
    periodicidade: 'mensal', dia_mes: 15, mes_inicio: null, responsaveis: ['m-1'] } }]);
});

await teste('atualizarOcorrencia: só campos permitidos; nenhuma linha alterada ⇒ mensagem de "nada alterado"', async () => {
  const amb = montar();
  servidor(amb, {
    'from:ocorrencias': { data: [{ id: 'o1' }], error: null },
    'from:v_ocorrencias': { data: [{ id: 'o1', status: 'concluida' }], error: null }
  });
  const r = await amb.A.atualizarOcorrencia('o1', { status: 'concluida', observacao: 'ok', prazo: '', atividade_id: 'hack', referencia: 'X' });
  assert.equal(r.status, 'concluida');
  igual(args(amb.sb.de('from:ocorrencias')[0], 'update'), [[{ status: 'concluida', observacao: 'ok', prazo: null }]]);
  servidor(amb, { 'from:ocorrencias': { data: [], error: null } });
  await rejeita(amb.A.atualizarOcorrencia('o1', { observacao: 'x' }), /Nada foi alterado/);
  await rejeita(amb.A.atualizarOcorrencia('o1', { status: 'nao_se_aplica', justificativa: ' ' }), /justificativa/);
});

await teste('criarOcorrencia grava criado_por do militar logado e devolve a linha da view', async () => {
  const amb = montar();
  servidor(amb, {
    'from:ocorrencias': { data: [{ id: 'o9' }], error: null },
    'from:v_ocorrencias': { data: [{ id: 'o9', titulo_execucao: 'Incidente 2026/041' }], error: null }
  });
  const r = await amb.A.criarOcorrencia({ atividade_id: 'a1', titulo_execucao: ' Incidente 2026/041 ', status: 'concluida' });
  assert.equal(r.id, 'o9');
  igual(args(amb.sb.de('from:ocorrencias')[0], 'insert'), [[{ atividade_id: 'a1', titulo_execucao: 'Incidente 2026/041',
    prazo: null, status: 'concluida', observacao: '', criado_por: 'm-1' }]]);
});

/* =========================================================================
   evidências
   ========================================================================= */

function arquivo(nome, tipo = 'application/pdf', tamanho = 2048) {
  return new File([new Uint8Array(tamanho)], nome, { type: tipo });
}

await teste('enviarEvidencia: caminho {atividade}/{ocorrência|geral}/{uuid}-{nome seguro}, upload e linha', async () => {
  const amb = montar();
  servidor(amb, { 'from:evidencias': (c) => ({ data: [Object.assign({ id: 'e1' }, args(c, 'insert')[0][0])], error: null }) });
  const r = await amb.A.enviarEvidencia({ atividade_id: 'a1', ocorrencia_id: 'o1', arquivo: arquivo('Relatório Final (v2).PDF', ''), descricao: ' ata ' });
  const up = amb.sb.de('storage:evidencias:upload')[0].cadeia[0];
  assert.match(up[1], /^a1\/o1\/[0-9a-f-]{36}-relatorio-final-v2\.pdf$/);
  igual(json(up[3]), { contentType: 'application/pdf', upsert: false, cacheControl: '0' });
  /* o navegador deu tipo vazio: o corpo enviado leva o tipo canônico (o
     Storage grava o tipo do Blob, não a opção contentType) */
  assert.equal(up[2].type, 'application/pdf');
  assert.equal(up[2].size, 2048);
  assert.equal(r.storage_path, up[1]);
  assert.equal(r.enviado_por, 'm-1');
  assert.equal(r.mime, 'application/pdf');
  assert.equal(r.nome, 'Relatório Final (v2).PDF');
  assert.equal(r.tamanho, 2048);
  assert.equal(r.descricao, 'ata');
  const foto = arquivo('foto.jpg', 'image/jpeg');
  await amb.A.enviarEvidencia({ atividade_id: 'a1', arquivo: foto });
  const up2 = amb.sb.de('storage:evidencias:upload')[1].cadeia[0];
  assert.match(up2[1], /^a1\/geral\//);
  assert.equal(up2[2], foto, 'tipo já certo: envia o próprio arquivo');
  await amb.A.enviarEvidencia({ atividade_id: 'a1', arquivo: arquivo('planilha.csv', 'application/vnd.ms-excel') });
  assert.equal(amb.sb.de('storage:evidencias:upload')[2].cadeia[0][2].type, 'text/csv');
  assert.equal(amb.sb.de('storage:evidencias:remove').length, 0);
});

await teste('enviarEvidencia: se a linha falhar, o objeto enviado é removido e o erro é traduzido', async () => {
  const amb = montar();
  servidor(amb, { 'from:evidencias': { data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "evidencias"' } } });
  amb.sb.sessao = sessao();
  await rejeita(amb.A.enviarEvidencia({ atividade_id: 'a1', ocorrencia_id: null, arquivo: arquivo('a.pdf') }),
    'Você não tem permissão para esta ação.');
  const caminho = amb.sb.de('storage:evidencias:upload')[0].cadeia[0][1];
  igual(amb.sb.de('storage:evidencias:remove').map((c) => c.cadeia[0][1]), [[caminho]]);
});

await teste('enviarEvidencia: arquivo inválido nem sobe; falha no upload não grava linha', async () => {
  const amb = montar();
  await rejeita(amb.A.enviarEvidencia({ atividade_id: 'a1', arquivo: arquivo('virus.exe') }), /Tipo de arquivo não permitido/);
  assert.equal(amb.sb.de('storage:evidencias:upload').length, 0);
  servidor(amb, { 'storage:evidencias:upload': { data: null, error: { name: 'StorageApiError', __isStorageError: true, status: 413, statusCode: '413', message: 'The object exceeded the maximum allowed size' } } });
  await rejeita(amb.A.enviarEvidencia({ atividade_id: 'a1', arquivo: arquivo('a.pdf') }), /maior que o limite de 20 MB/);
  assert.equal(amb.sb.de('from:evidencias').length, 0);
});

await teste('baixarEvidencia devolve o Blob com o tipo registrado; excluirEvidencia apaga a linha e depois o objeto', async () => {
  const amb = montar();
  servidor(amb, {
    'storage:evidencias:download': { data: new Blob(['%PDF'], { type: 'application/octet-stream' }), error: null },
    'from:evidencias': { data: [{ id: 'e1' }], error: null }
  });
  const ev = { id: 'e1', storage_path: 'a1/geral/u-a.pdf', mime: 'application/pdf' };
  const blob = await amb.A.baixarEvidencia(ev);
  assert.equal(blob.type, 'application/pdf');
  assert.equal(await blob.text(), '%PDF');
  await amb.A.excluirEvidencia(ev);
  const ordem = amb.sb.consultas.map((c) => c.alvo).filter((a) => a === 'from:evidencias' || a === 'storage:evidencias:remove');
  igual(ordem, ['from:evidencias', 'storage:evidencias:remove']);
  igual(args(amb.sb.de('from:evidencias')[0], 'delete'), [[]]);
  servidor(amb, { 'from:evidencias': { data: [], error: null } });
  await rejeita(amb.A.excluirEvidencia(ev), /sem permissão/);
});

await teste('excluirAtividade: remove os arquivos em lotes de 100 e só então apaga a atividade (gestor)', async () => {
  const amb = montar({ perfil: CHEFE });
  const evs = Array.from({ length: 250 }, (_, i) => ({ id: 'e' + i, storage_path: 'a1/geral/' + i + '.pdf' }));
  servidor(amb, {
    'from:evidencias': { data: evs, error: null, count: 250 },
    'from:atividades': { data: [{ id: 'a1' }], error: null }
  });
  await amb.A.excluirAtividade('a1');
  const lotes = amb.sb.de('storage:evidencias:remove').map((c) => c.cadeia[0][1].length);
  igual(lotes, [100, 100, 50]);
  const alvos = amb.sb.consultas.map((c) => c.alvo);
  assert.ok(alvos.lastIndexOf('storage:evidencias:remove') < alvos.indexOf('from:atividades'), 'arquivos antes da atividade');
  igual(args(amb.sb.de('from:evidencias')[0], 'eq'), [['atividade_id', 'a1']]);
  /* adjunto: nada é apagado */
  const amb2 = montar();
  await rejeita(amb2.A.excluirAtividade('a1'), 'Você não tem permissão para esta ação.');
  assert.equal(amb2.sb.de('storage:evidencias:remove').length + amb2.sb.de('from:atividades').length, 0);
});

/* =========================================================================
   militares, administração de usuários e configurações
   ========================================================================= */

await teste('adminUsuario chama a Edge Function admin-usuarios com { acao, militar_id, ...extra }', async () => {
  const amb = montar({ perfil: CHEFE });
  servidor(amb, { 'functions:admin-usuarios': { data: { ok: true, senha_temporaria: 'Abc#defgh2345k' }, error: null } });
  const r = await amb.A.adminUsuario('criar', 'm-9', { email: 'novo@habe.exemplo' });
  igual(r, { senha_temporaria: 'Abc#defgh2345k' });
  igual(amb.sb.de('functions:admin-usuarios')[0].cadeia[0][1], { body: { acao: 'criar', militar_id: 'm-9', email: 'novo@habe.exemplo' } });
  await amb.A.excluirMilitar('m-9');
  igual(amb.sb.de('functions:admin-usuarios')[1].cadeia[0][1], { body: { acao: 'excluir', militar_id: 'm-9' } });
});

await teste('adminUsuario: erro HTTP lê { erro } do corpo; sem corpo, mensagem pelo status; falha de rede', async () => {
  const amb = montar({ perfil: CHEFE });
  const httpErro = (status, corpo) => ({
    name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code',
    context: { status, json: async () => { if (corpo === undefined) { throw new SyntaxError('sem JSON'); } return corpo; } }
  });
  const TRAVA = 'É preciso manter ao menos uma conta de chefia ou administrador ativa e com acesso.';
  servidor(amb, { 'functions:admin-usuarios': { data: null, error: httpErro(409, { ok: false, erro: TRAVA }) } });
  await rejeita(amb.A.adminUsuario('excluir', 'm-2'), TRAVA);
  servidor(amb, { 'functions:admin-usuarios': { data: null, error: httpErro(404) } });
  await rejeita(amb.A.adminUsuario('criar', 'm-2'), /não está implantado/);
  servidor(amb, { 'functions:admin-usuarios': { data: null, error: httpErro(401, { msg: 'Invalid JWT' }) } });
  await rejeita(amb.A.adminUsuario('criar', 'm-2'), 'Sua sessão expirou. Entre novamente.');
  servidor(amb, { 'functions:admin-usuarios': { data: null, error: { name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function' } } });
  await rejeita(amb.A.adminUsuario('criar', 'm-2'), /ORIGEM_PERMITIDA/);
  servidor(amb, { 'functions:admin-usuarios': { data: { ok: false, erro: 'Recusado.' }, error: null } });
  await rejeita(amb.A.adminUsuario('criar', 'm-2'), 'Recusado.');
  servidor(amb, { 'functions:admin-usuarios': { data: { ok: true, aviso: 'Apague no painel.' }, error: null } });
  igual(await amb.A.adminUsuario('excluir', 'm-2'), { aviso: 'Apague no painel.' });
});

await teste('salvarMilitar: chefia não mexe na conta institucional; e-mail de quem tem acesso só pela Edge Function', async () => {
  const amb = montar({ perfil: CHEFE });
  const admin = { id: 'm-adm', usuario_id: 'u-adm', papel: 'administrador', ativo: true, nome_guerra: 'AQS', email: 'aqs@habe.exemplo' };
  const comAcesso = { id: 'm-1', usuario_id: 'u-1', papel: 'adjunto', ativo: true, nome_guerra: 'Letícia', email: 'leticia@habe.exemplo' };
  servidor(amb, { 'from:militares': (c) => {
    const id = (args(c, 'eq')[0] || [])[1];
    if (args(c, 'update').length || args(c, 'insert').length) { return { data: [Object.assign({ id: id || 'm-novo' }, (args(c, 'update')[0] || args(c, 'insert')[0])[0])], error: null }; }
    return { data: id === 'm-adm' ? [admin] : [comAcesso], error: null };
  } });
  await rejeita(amb.A.salvarMilitar({ id: 'm-adm', nome_guerra: 'AQS', papel: 'administrador' }), /conta institucional da AQS/);
  await rejeita(amb.A.salvarMilitar({ nome_guerra: 'Novo', papel: 'administrador' }), /conta institucional da AQS/);
  await rejeita(amb.A.salvarMilitar({ id: 'm-1', nome_guerra: 'Letícia', email: 'outro@habe.exemplo' }), /Alterar e-mail de acesso/);
  const salvo = await amb.A.salvarMilitar({ id: 'm-1', posto: ' 1º Ten ', nome_guerra: 'Letícia', email: 'LETICIA@habe.exemplo', papel: 'chefia' });
  assert.equal(salvo.papel, 'chefia');
  const upd = amb.sb.de('from:militares').find((c) => args(c, 'update').length);
  igual(args(upd, 'update')[0][0], { posto: '1º Ten', nome_guerra: 'Letícia', nome_completo: null,
    email: 'leticia@habe.exemplo', setor_id: null, papel: 'chefia', ativo: true });
});

await teste('transferirChefia chama rpc("transferir_chefia") com os parâmetros p_*', async () => {
  const amb = montar({ perfil: CHEFE });
  await amb.A.transferirChefia({ de: 'm-chefe', para: 'm-1', papel_anterior: 'adjunto', transferir_atividades: false });
  igual(amb.sb.de('rpc:transferir_chefia')[0].cadeia[0], ['rpc', { p_de: 'm-chefe', p_para: 'm-1', p_papel_anterior: 'adjunto', p_transferir_atividades: false }]);
  await amb.A.transferirChefia({ para: 'm-1' });
  igual(amb.sb.de('rpc:transferir_chefia')[1].cadeia[0][1], { p_de: null, p_para: 'm-1', p_papel_anterior: 'adjunto', p_transferir_atividades: true });
});

await teste('configurações: objeto { chave: valor } e upsert pela chave', async () => {
  const amb = montar({ perfil: CHEFE });
  servidor(amb, { 'from:configuracoes': (c) => (args(c, 'upsert').length
    ? { data: [{ valor: args(c, 'upsert')[0][0].valor }], error: null }
    : { data: [{ chave: 'contatos', valor: { telefone: '1234' } }, { chave: 'ultimo_backup', valor: { em: 'x' } }], error: null, count: 2 }) });
  igual(await amb.A.obterConfiguracoes(), { contatos: { telefone: '1234' }, ultimo_backup: { em: 'x' } });
  igual(await amb.A.salvarConfiguracao('contatos', { telefone: '5678' }), { telefone: '5678' });
  const up = amb.sb.de('from:configuracoes').at(-1);
  igual(args(up, 'upsert'), [[{ chave: 'contatos', valor: { telefone: '5678' } }, { onConflict: 'chave' }]]);
  await rejeita(amb.A.salvarConfiguracao('Chave Ruim', 1), /inválida/);
});

await teste('feriados: upsert pela data; corrigir a data atualiza a linha original', async () => {
  const amb = montar({ perfil: CHEFE });
  servidor(amb, { 'from:feriados': (c) => ({ data: [{ data: '2026-11-20', descricao: 'Consciência Negra' }], error: null }) });
  await amb.A.salvarFeriado({ data: '2026-11-20', descricao: ' Consciência Negra ' });
  igual(args(amb.sb.de('from:feriados')[0], 'upsert'), [[{ data: '2026-11-20', descricao: 'Consciência Negra' }, { onConflict: 'data' }]]);
  await amb.A.salvarFeriado({ data: '2026-11-20', data_original: '2026-11-19', descricao: 'Consciência Negra' });
  const c = amb.sb.de('from:feriados')[1];
  igual([args(c, 'update'), args(c, 'eq')], [[[{ data: '2026-11-20', descricao: 'Consciência Negra' }]], [['data', '2026-11-19']]]);
  await rejeita(amb.A.salvarFeriado({ data: '20/11/2026', descricao: 'x' }), /inválida/);
});

await teste('exportarTudo: lê todas as tabelas e grava configuracoes.ultimo_backup = { em, por_nome }', async () => {
  const amb = montar({ perfil: CHEFE });
  servidor(amb, {
    'from:militares': { data: [{ id: 'm-chefe' }], error: null, count: 1 },
    'from:configuracoes': (c) => (args(c, 'upsert').length
      ? { data: [{ chave: 'ultimo_backup', valor: args(c, 'upsert')[0][0].valor }], error: null }
      : { data: [{ chave: 'contatos', valor: {} }, { chave: 'ultimo_backup', valor: { em: 'antigo' } }], error: null, count: 2 })
  });
  const r = await amb.A.exportarTudo();
  const tabelas = ['setores', 'militares', 'feriados', 'atividades', 'atividade_responsaveis', 'ocorrencias', 'evidencias',
    'comentarios', 'avisos', 'avisos_destinatarios', 'avisos_ciencia', 'notificacoes', 'configuracoes', 'auditoria'];
  igual(Object.keys(r.tabelas).sort(), tabelas.slice().sort());
  assert.ok(r.gerado_em && !isNaN(Date.parse(r.gerado_em)));
  assert.equal(r.gerado_por, 'Maj Chefe');
  const up = amb.sb.de('from:configuracoes').find((c) => args(c, 'upsert').length);
  const valor = args(up, 'upsert')[0][0];
  assert.equal(valor.chave, 'ultimo_backup');
  igual(valor.valor, { em: r.gerado_em, por_nome: 'Maj Chefe' });
  igual(r.tabelas.configuracoes.map((l) => l.chave), ['contatos', 'ultimo_backup']);
  igual(r.tabelas.configuracoes[1].valor, { em: r.gerado_em, por_nome: 'Maj Chefe' });
  /* a gravação vem depois de todas as leituras */
  const alvos = amb.sb.consultas.map((c) => c.alvo);
  assert.equal(alvos.indexOf('from:auditoria') < amb.sb.consultas.indexOf(up), true);
});

/* =========================================================================
   avisos e notificações
   ========================================================================= */

await teste('listarAvisos: sem expirados (hoje em Belém), fixados primeiro, destinatários e ciências', async () => {
  const amb = montar();
  servidor(amb, { 'from:avisos': { data: [{ id: 'av1', titulo: 'Reunião', fixado: true,
    avisos_destinatarios: [{ militar_id: 'm-1' }], avisos_ciencia: [{ militar_id: 'm-1', ciente_em: '2026-10-15T12:00:00Z' }] },
  { id: 'av2', titulo: 'Escala', fixado: false, avisos_destinatarios: [], avisos_ciencia: [] }], error: null, count: 2 } });
  const r = await amb.A.listarAvisos();
  igual(r, [
    { id: 'av1', titulo: 'Reunião', fixado: true, destinatarios: ['m-1'], ciencias: [{ militar_id: 'm-1', ciente_em: '2026-10-15T12:00:00Z' }], ciente_por_mim: true },
    { id: 'av2', titulo: 'Escala', fixado: false, destinatarios: [], ciencias: [], ciente_por_mim: false }
  ]);
  const c = amb.sb.de('from:avisos')[0];
  igual(args(c, 'select')[0][0], '*, avisos_destinatarios(militar_id), avisos_ciencia(militar_id, ciente_em)');
  igual(args(c, 'or'), [['expira_em.is.null,expira_em.gte.' + amb.ctx.U.hojeBelem()]]);
  igual(args(c, 'order').slice(0, 2), [['fixado', { ascending: false }], ['criado_em', { ascending: false }]]);
  await amb.A.listarAvisos({ incluirExpirados: true });
  igual(args(amb.sb.de('from:avisos')[1], 'or'), []);
});

await teste('salvarAviso: cria com destinatários; se eles falham, o aviso novo é desfeito', async () => {
  const amb = montar({ perfil: CHEFE });
  servidor(amb, {
    'from:avisos': (c) => ({ data: [{ id: 'av9', titulo: 'T', avisos_destinatarios: [{ militar_id: 'm-1' }], avisos_ciencia: [] }], error: null }),
    'from:avisos_destinatarios': (c) => (args(c, 'select').length ? { data: [], error: null } : { data: null, error: null })
  });
  const r = await amb.A.salvarAviso({ titulo: 'T', para_todos: false, destinatarios: ['m-1', 'm-1', ''] });
  igual(r.destinatarios, ['m-1']);
  const ins = amb.sb.de('from:avisos_destinatarios').find((c) => args(c, 'insert').length);
  igual(args(ins, 'insert'), [[[{ aviso_id: 'av9', militar_id: 'm-1' }]]]);
  igual(args(amb.sb.de('from:avisos')[0], 'insert')[0][0].criado_por, 'm-chefe');
  await rejeita(amb.A.salvarAviso({ titulo: 'T', para_todos: false, destinatarios: [] }), /ao menos um destinatário/);
  servidor(amb, {
    'from:avisos': (c) => ({ data: [{ id: 'av10' }], error: null }),
    'from:avisos_destinatarios': (c) => (args(c, 'select').length ? { data: [], error: null }
      : { data: null, error: { code: '23503', message: 'insert or update on table violates foreign key constraint', details: 'Key is not present' } })
  });
  const antes = amb.sb.de('from:avisos').length;
  await rejeita(amb.A.salvarAviso({ titulo: 'T2', para_todos: false, destinatarios: ['m-x'] }), /não existe mais/);
  const depois = amb.sb.de('from:avisos').slice(antes);
  assert.ok(depois.some((c) => args(c, 'delete').length && json(args(c, 'eq')[0]).join() === 'id,av10'), 'aviso novo apagado');
});

await teste('darCiencia: ciência repetida (23505) não é erro', async () => {
  const amb = montar();
  servidor(amb, { 'from:avisos_ciencia': { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "avisos_ciencia_pkey"' } } });
  await amb.A.darCiencia('av1');
  igual(args(amb.sb.de('from:avisos_ciencia')[0], 'insert'), [[{ aviso_id: 'av1', militar_id: 'm-1' }]]);
  // A notificação do aviso sai do sino: só "lida", só as minhas, só deste aviso.
  const marcar = amb.sb.de('from:notificacoes').find((c) => args(c, 'update').length);
  assert.ok(marcar, 'darCiencia marca a notificação do aviso como lida');
  igual(args(marcar, 'update'), [[{ lida: true }]]);
  igual(json(args(marcar, 'eq')), [['destinatario_id', 'm-1'], ['aviso_id', 'av1'], ['lida', false]]);
});

await teste('notificações: contar não lidas (head), listar com limite e marcar como lidas', async () => {
  const amb = montar();
  servidor(amb, { 'from:notificacoes': (c) => {
    const sel = args(c, 'select')[0];
    if (sel && sel[1] && sel[1].head) { return { data: null, error: null, count: 7 }; }
    return { data: sel ? [{ id: 'n1' }] : null, error: null, count: sel ? 1 : null };
  } });
  assert.equal(await amb.A.contarNaoLidas(), 7);
  const cont = amb.sb.de('from:notificacoes')[0];
  igual(args(cont, 'select'), [['id', { count: 'exact', head: true }]]);
  igual(args(cont, 'eq'), [['destinatario_id', 'm-1'], ['lida', false]]);
  await amb.A.listarNotificacoes({ limite: 5 });
  igual(args(amb.sb.de('from:notificacoes')[1], 'range'), [[0, 4]]);
  await amb.A.marcarNotificacoesLidas(null);
  const todas = amb.sb.de('from:notificacoes')[2];
  igual([args(todas, 'update'), args(todas, 'eq'), args(todas, 'in')], [[[{ lida: true }]], [['destinatario_id', 'm-1'], ['lida', false]], []]);
  await amb.A.marcarNotificacoesLidas(['n1', 'n2']);
  igual(args(amb.sb.de('from:notificacoes')[3], 'in'), [['id', ['n1', 'n2']]]);
  const total = amb.sb.de('from:notificacoes').length;
  await amb.A.marcarNotificacoesLidas([]);
  assert.equal(amb.sb.de('from:notificacoes').length, total, 'lista vazia não chama o servidor');
});

/* =========================================================================
   tradução de erros
   ========================================================================= */

await teste('tradução de erros do banco, do PostgREST e da rede', async () => {
  const { A } = montar();
  const t = (e, st) => A.traduzirErro(e, st).message;
  assert.equal(t({ code: '42501', message: 'new row violates row-level security policy for table "avisos"' }), 'Você não tem permissão para esta ação.');
  assert.equal(t({ code: '42501', message: 'permission denied for table militares' }), 'Você não tem permissão para esta ação.');
  assert.equal(t({ code: '42501', message: 'Apenas a chefia pode alterar os responsáveis de uma atividade.' }),
    'Apenas a chefia pode alterar os responsáveis de uma atividade.');
  assert.equal(t({ code: '42501', message: 'sem_cadastro' }), 'Seu usuário não está vinculado a um cadastro ativo. Procure a chefia do NSP ou a AQS.');
  assert.equal(t({ code: '23505', message: 'duplicate key value violates unique constraint "x_qualquer"' }), 'Já existe um registro com esses dados.');
  assert.equal(t({ code: '23505', message: 'duplicate key value violates unique constraint "setores_sigla_unica"' }), 'Já existe um setor com esta sigla.');
  assert.equal(t({ code: '23514', message: 'new row for relation "atividades" violates check constraint "atividades_titulo_tamanho"', details: 'Failing row contains (…)' }),
    'Dados inválidos: o título deve ter entre 3 e 200 caracteres.');
  assert.equal(t({ code: '23514', message: 'new row for relation "x" violates check constraint "x_nova_regra"' }), 'Dados inválidos: regra "x_nova_regra" do banco.');
  assert.equal(t({ code: '23514', message: 'Informe a justificativa para marcar como "não se aplica".' }), 'Informe a justificativa para marcar como "não se aplica".');
  assert.equal(t({ code: 'P0001', message: 'É preciso manter ao menos uma conta de chefia ou administrador ativa e com acesso.' }),
    'É preciso manter ao menos uma conta de chefia ou administrador ativa e com acesso.');
  assert.equal(t({ code: '22023', message: 'Informe ao menos um responsável.' }), 'Informe ao menos um responsável.');
  assert.equal(t({ code: 'PGRST301', message: 'JWT expired' }), 'Sua sessão expirou. Entre novamente.');
  assert.equal(t({ code: '', message: 'JWT expired' }, 401), 'Sua sessão expirou. Entre novamente.');
  assert.equal(t({ code: '', message: 'TypeError: Failed to fetch', details: '' }, 0), 'Sem conexão com o servidor. Verifique a internet.');
  assert.equal(t({ name: 'AuthRetryableFetchError', status: 0, message: 'Load failed' }), 'Sem conexão com o servidor. Verifique a internet.');
  assert.match(t({ code: 'PGRST202', message: 'Could not find the function public.salvar_atividade(p) in the schema cache' }), /scripts da pasta supabase/);
  assert.match(t({ code: '23503', message: 'update or delete on table "setores" violates foreign key constraint', details: 'Key (id)=(x) is still referenced from table "militares".' }),
    /ligado a outros dados/);
  assert.match(t({ name: 'StorageApiError', __isStorageError: true, status: 400, statusCode: '404', message: 'Object not found' }), /Arquivo não encontrado/);
  assert.match(t({ name: 'StorageApiError', __isStorageError: true, status: 400, statusCode: '403', message: 'new row violates row-level security policy' }), /permissão/);
  assert.match(t({ code: 'XX000', message: 'algo estranho' }, 500), /não respondeu como esperado/);
  assert.match(t({ code: 'ZZ999', message: 'nunca visto' }, 400), /^Erro inesperado: nunca visto$/);
  const e = A.traduzirErro({ code: '42501', message: 'permission denied for table x' });
  assert.equal(e.codigo, 'permissao');
  assert.equal(A.traduzirErro(e), e, 'erro já traduzido passa direto');
});

await teste('sem permissão com a sessão vencida vira "sessão expirou"', async () => {
  const amb = montar();
  servidor(amb, { 'from:setores': { data: null, error: { code: '42501', message: 'permission denied for table setores' }, status: 401 } });
  amb.sb.sessao = null;
  await amb.A.iniciar();
  await rejeita(amb.A.listarSetores(), 'Sua sessão expirou. Entre novamente.');
  amb.sb.sessao = sessao();
  await rejeita(amb.A.listarSetores(), 'Você não tem permissão para esta ação.');
});

/* =========================================================================
   tempo real
   ========================================================================= */

await teste('assinarMudancas: um canal "aqs-mudancas" com as 10 tabelas e o filtro das minhas notificações', async () => {
  const amb = montar();
  amb.sb.sessao = sessao();
  await amb.A.iniciar();
  const recebidos = [];
  const cancelar = amb.Api.assinarMudancas((m) => recebidos.push(json(m)));
  await esperar(5);
  assert.equal(amb.sb.canais.length, 1);
  const canal = amb.sb.canais[0];
  assert.equal(canal.nome, 'aqs-mudancas');
  igual(canal.ligacoes.map((l) => l.tipo), Array(10).fill('postgres_changes'));
  igual(canal.ligacoes.map((l) => l.filtro.table), ['ocorrencias', 'comentarios', 'evidencias', 'atividades',
    'atividade_responsaveis', 'avisos', 'avisos_ciencia', 'militares', 'setores', 'notificacoes']);
  for (const l of canal.ligacoes) {
    assert.equal(l.filtro.event, '*');
    assert.equal(l.filtro.schema, 'public');
  }
  igual(canal.ligacoes.filter((l) => l.filtro.filter).map((l) => [l.filtro.table, l.filtro.filter]),
    [['notificacoes', 'destinatario_id=eq.m-1']]);
  canal.ligacoes[0].cb({ eventType: 'UPDATE', new: { id: 'o1' } });
  canal.ligacoes[9].cb({ eventType: 'INSERT' });
  igual(recebidos, [{ tabela: 'ocorrencias', evento: 'UPDATE' }, { tabela: 'notificacoes', evento: 'INSERT' }]);
  /* segundo assinante reaproveita o mesmo canal */
  const cancelar2 = amb.A.assinarMudancas(() => {});
  await esperar(5);
  assert.equal(amb.sb.canais.length, 1);
  cancelar2();
  assert.equal(canal.removido, false, 'ainda há assinante');
  cancelar();
  await esperar(5);
  assert.equal(canal.removido, true, 'último cancelamento remove o canal');
  cancelar();
});

await teste('tempo real: reassina com espera crescente (máx. 60 s) e ressincroniza ao voltar', async () => {
  const amb = montar();
  amb.sb.sessao = sessao();
  await amb.A.iniciar();
  const recebidos = [];
  amb.A.assinarMudancas((m) => recebidos.push(json(m)));
  await esperar(5);
  amb.sb.canais[0].statusCb('SUBSCRIBED');
  const esperas = [];
  for (let i = 0; i < 9; i += 1) {
    const canal = amb.sb.canais.at(-1);
    canal.statusCb(i % 3 === 0 ? 'CHANNEL_ERROR' : (i % 3 === 1 ? 'TIMED_OUT' : 'CLOSED'), new Error('queda'));
    const t = amb.temporizadores.at(-1);
    esperas.push(t.ms);
    t.fn();
    await esperar(5);
    assert.equal(canal.removido, true, 'canal antigo removido antes de reassinar');
  }
  igual(esperas, [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
  assert.equal(amb.sb.canais.length, 10);
  /* status do canal velho (já descartado) não agenda nada */
  const qtd = amb.temporizadores.length;
  amb.sb.canais[0].statusCb('CLOSED');
  assert.equal(amb.temporizadores.length, qtd);
  /* reconectou: avisa as telas para recarregar (sem notificação falsa) */
  amb.sb.canais.at(-1).statusCb('SUBSCRIBED');
  const sinteticos = recebidos.filter((r) => r.evento === 'RESSINCRONIZAR').map((r) => r.tabela);
  assert.equal(sinteticos.length, 9);
  assert.ok(!sinteticos.includes('notificacoes'));
  /* depois de estabilizar, a próxima queda volta a esperar 1 s */
  amb.sb.canais.at(-1).statusCb('CHANNEL_ERROR');
  assert.equal(amb.temporizadores.at(-1).ms, 1000);
});

await teste('tempo real assinado antes do login monta o canal ao entrar', async () => {
  const amb = montar();
  await amb.A.iniciar();
  servidor(amb, { 'rpc:meu_perfil': { data: null, error: { code: '42501', message: 'sem_cadastro' } } });
  amb.A.assinarMudancas(() => {});
  await esperar(5);
  assert.equal(amb.sb.canais.length, 0, 'sem sessão, sem canal');
  assert.equal(amb.temporizadores.length, 0, 'nem fica tentando');
  servidor(amb, {});
  amb.sb.emitir('SIGNED_IN', sessao());
  await esperar(10);
  assert.equal(amb.sb.canais.length, 1);
});

/* =========================================================================
   com o supabase-js REAL (assets/vendor/supabase.js) e fetch falso
   Confere as requisições HTTP que a biblioteca de verdade gera a partir
   das chamadas do adaptador — pega uso errado da API do supabase-js e
   mudanças de comportamento se a versão incorporada for trocada.
   ========================================================================= */

function montarReal() {
  const pedidos = [];
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const estado = { aal: 'aal1', fatores: [] };
  const UID = 'aaaaaaaa-0000-4000-8000-000000000001';
  const usuario = () => ({ id: UID, email: 'chefe@habe.exemplo', aud: 'authenticated', role: 'authenticated',
    factors: estado.fatores, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' });
  const sessaoHttp = () => ({ access_token: b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: UID, aal: estado.aal,
    exp: 4102444800, session_id: 's', role: 'authenticated' }) + '.YXNz', token_type: 'bearer', expires_in: 3600,
    expires_at: 4102444800, refresh_token: 'r', user: usuario() });
  const J = (o, status = 200, extra = {}) => new Response(o === null ? null : JSON.stringify(o),
    { status, headers: Object.assign({ 'Content-Type': 'application/json' }, extra) });
  const ctx = vm.createContext({
    console: { log() {}, error() {}, warn() {} }, setTimeout, clearTimeout, setInterval, clearInterval,
    URL, URLSearchParams, Headers, Request, Response, Blob, File, FormData, AbortController, TextEncoder, TextDecoder,
    crypto: globalThis.crypto, atob, btoa, structuredClone,
    WebSocket: class { constructor(u) { this.url = u; this.readyState = 0; } close() {} send() {} },
    localStorage: criarArmazenamento(), sessionStorage: criarArmazenamento(),
    navigator: { userAgent: 'teste' }, location: { href: 'https://aqs.habe.exemplo/' },
    fetch: async (url, op = {}) => {
      const u = new URL(String(url));
      const m = op.method || 'GET';
      const pedido = { metodo: m, caminho: u.pathname, busca: decodeURIComponent(u.search), cabecalhos: Object.fromEntries(new Headers(op.headers || {}).entries()), corpo: op.body };
      pedidos.push(pedido);
      const p = u.pathname;
      if (p === '/auth/v1/token') { return J(sessaoHttp()); }
      if (p === '/auth/v1/user') { return J(usuario()); }
      if (/\/challenge$/.test(p)) { return J({ id: 'ch-1', type: 'totp', expires_at: 4102444800 }); }
      if (/\/verify$/.test(p)) { estado.aal = 'aal2'; return J(sessaoHttp()); }
      if (p === '/rest/v1/rpc/meu_perfil') { return J({ id: 'm-chefe', usuario_id: UID, papel: 'chefia', ativo: true, posto: 'Maj', nome_guerra: 'Chefe' }); }
      if (p.startsWith('/functions/v1/')) { return J({ ok: false, erro: 'Recusado pela função.' }, 409); }
      if (p.startsWith('/storage/v1/object/evidencias/') && m === 'POST') { return J({ Id: 'o', Key: 'evidencias/x' }); }
      if (p === '/rest/v1/evidencias' && m === 'POST') {
        return J({ code: '42501', message: 'new row violates row-level security policy for table "evidencias"', details: null, hint: null }, 403);
      }
      if (p === '/storage/v1/object/evidencias' && m === 'DELETE') { return J([]); }
      if (m === 'HEAD') { return new Response(null, { status: 200, headers: { 'Content-Range': '*/3' } }); }
      return J([], 200, { 'Content-Range': '*/0' });
    }
  });
  ctx.window = ctx;
  ctx.self = ctx;
  const arquivos = ['assets/vendor/supabase.js', 'assets/js/config.js', 'assets/js/util.js', 'assets/js/regras.js',
    'assets/js/recorrencia.js', 'assets/js/api-supabase.js', 'assets/js/api.js'];
  for (const f of arquivos) { vm.runInContext(fs.readFileSync(path.join(raiz, f), 'utf8'), ctx, { filename: f }); }
  ctx.AQS_CONFIG.SUPABASE_URL = 'https://projeto-teste.supabase.co';
  ctx.AQS_CONFIG.SUPABASE_ANON_KEY = 'chave-anon-de-teste';
  return { ctx, Api: ctx.Api, pedidos, estado };
}

await teste('supabase-js real: login, 2º fator e sessão (requisições ao Auth)', async () => {
  const r = montarReal();
  const eventos = [];
  r.Api.aoMudarSessao((e) => eventos.push(e));
  assert.equal(await r.Api.iniciar(), null);
  r.estado.fatores = [{ id: 'bbbbbbbb-0000-4000-8000-000000000001', factor_type: 'totp', status: 'verified', friendly_name: 'HABE AQS-NSP' }];
  igual(await r.Api.entrar(' Chefe@HABE.exemplo ', 'Senha12345', true), { precisaMfa: true });
  const login = r.pedidos.find((p) => p.caminho === '/auth/v1/token');
  assert.equal(login.busca, '?grant_type=password');
  assert.equal(JSON.parse(login.corpo).email, 'chefe@habe.exemplo');
  assert.equal(await r.Api.sessaoAtual(), null, '2º fator pendente');
  await r.Api.verificarMfa('123456');
  assert.ok(r.pedidos.some((p) => p.caminho === '/auth/v1/factors/bbbbbbbb-0000-4000-8000-000000000001/verify'));
  igual(await r.Api.sessaoAtual(), { usuario_id: 'aaaaaaaa-0000-4000-8000-000000000001', email: 'chefe@habe.exemplo' });
  assert.ok(r.ctx.localStorage.getItem('aqs-nsp-sessao'), 'lembrar ⇒ token no localStorage');
  await esperar(10);
  igual(eventos, ['entrou']);
});

await teste('supabase-js real: filtros, paginação, contagem e RPCs viram a URL certa no PostgREST', async () => {
  const r = montarReal();
  await r.Api.entrar('chefe@habe.exemplo', 'Senha12345', false);
  await r.Api.listarOcorrencias({ de: '2026-10-01', ate: '2026-10-31', atividade_id: 'a-1', somenteAbertas: true });
  const oc = r.pedidos.find((p) => p.caminho === '/rest/v1/v_ocorrencias');
  assert.equal(oc.busca, '?select=*&atividade_id=eq.a-1&status=in.(pendente,em_andamento)&data_ref=gte.2026-10-01' +
    '&data_ref=lte.2026-10-31&order=data_ref.asc,criado_em.asc,id.asc&offset=0&limit=1000');
  assert.equal(oc.cabecalhos.prefer, 'count=exact');
  await r.Api.listarAvisos({});
  const av = r.pedidos.find((p) => p.caminho === '/rest/v1/avisos');
  assert.ok(av.busca.includes('or=(expira_em.is.null,expira_em.gte.' + r.ctx.U.hojeBelem() + ')'), av.busca);
  assert.ok(av.busca.includes('order=fixado.desc,criado_em.desc,id.asc'));
  assert.equal(await r.Api.contarNaoLidas(), 3);
  assert.equal(r.pedidos.find((p) => p.caminho === '/rest/v1/notificacoes').metodo, 'HEAD');
  await r.Api.salvarAtividade({ titulo: 'Auditoria', responsaveis: ['m-1'] });
  igual(JSON.parse(r.pedidos.find((p) => p.caminho === '/rest/v1/rpc/salvar_atividade').corpo), { p: { titulo: 'Auditoria', responsaveis: ['m-1'] } });
  await r.Api.transferirChefia({ para: 'm-2' });
  igual(JSON.parse(r.pedidos.find((p) => p.caminho === '/rest/v1/rpc/transferir_chefia').corpo),
    { p_de: null, p_para: 'm-2', p_papel_anterior: 'adjunto', p_transferir_atividades: true });
});

await teste('supabase-js real: upload multipart com o tipo canônico e remoção do objeto se a linha falhar', async () => {
  const r = montarReal();
  await r.Api.entrar('chefe@habe.exemplo', 'Senha12345', false);
  const arq = new File([new Uint8Array(10)], 'Planilha Índices.csv', { type: '' });
  await rejeita(r.Api.enviarEvidencia({ atividade_id: 'a-1', ocorrencia_id: null, arquivo: arq }), 'Você não tem permissão para esta ação.');
  const up = r.pedidos.find((p) => p.caminho.startsWith('/storage/v1/object/evidencias/'));
  assert.match(up.caminho, /^\/storage\/v1\/object\/evidencias\/a-1\/geral\/[0-9a-f-]{36}-planilha-indices\.csv$/);
  assert.equal(up.cabecalhos['x-upsert'], 'false');
  const partes = [];
  up.corpo.forEach((v, k) => partes.push([k, typeof v === 'string' ? v : 'Blob:' + v.type]));
  igual(partes, [['cacheControl', '0'], ['', 'Blob:text/csv']]);
  const remocao = r.pedidos.find((p) => p.caminho === '/storage/v1/object/evidencias' && p.metodo === 'DELETE');
  igual(JSON.parse(remocao.corpo), { prefixes: [up.caminho.replace('/storage/v1/object/evidencias/', '')] });
});

await teste('supabase-js real: Edge Function recebe o corpo e o erro 409 vem do JSON { erro }', async () => {
  const r = montarReal();
  await r.Api.entrar('chefe@habe.exemplo', 'Senha12345', false);
  await rejeita(r.Api.adminUsuario('alterar_email', 'm-9', { email: 'novo@habe.exemplo' }), 'Recusado pela função.');
  const f = r.pedidos.find((p) => p.caminho === '/functions/v1/admin-usuarios');
  assert.equal(f.metodo, 'POST');
  igual(JSON.parse(f.corpo), { acao: 'alterar_email', militar_id: 'm-9', email: 'novo@habe.exemplo' });
  assert.match(f.cabecalhos.authorization, /^Bearer ey/);
});

/* ---------- resultado ---------- */

if (falhas.length) {
  for (const f of falhas) {
    console.error('✗ ' + f.nome);
    console.error('  ' + (f.erro && f.erro.stack ? f.erro.stack.split("\n").slice(0, 30).join('\n  ') : f.erro));
  }
  console.error('\n' + falhas.length + ' falha(s), ' + aprovados + ' aprovado(s) — api-supabase');
  process.exit(1);
}
console.log('✓ api-supabase: ' + aprovados + ' testes aprovados');
