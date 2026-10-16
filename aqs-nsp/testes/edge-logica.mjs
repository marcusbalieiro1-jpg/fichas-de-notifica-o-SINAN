#!/usr/bin/env node
/* =========================================================================
   HABE – AQS e NSP — testes da lógica da Edge Function admin-usuarios
   Uso: node testes/edge-logica.mjs   (a partir da pasta aqs-nsp)

   Importa supabase/functions/admin-usuarios/logica.ts direto: o Node
   22.18+ remove os tipos do TypeScript sozinho (por isso a lógica usa só
   sintaxe "apagável"). Em Node 22.6 a 22.17 rode com
     node --experimental-strip-types testes/edge-logica.mjs

   As dependências (Auth, tabelas militares e auditoria) são falsas, em
   memória, mas imitam o que importa do Supabase: a trava anti-bloqueio do
   gatilho de militares, o e-mail único do Auth (erro email_exists) e do
   cadastro (23505) e o check de auditoria.operacao. Cada chamada fica
   registrada para conferir a ORDEM das operações (ex.: excluir apaga a
   linha de militares antes do usuário do Auth).
   ========================================================================= */

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arquivoLogica = path.join(raiz, 'supabase', 'functions', 'admin-usuarios', 'logica.ts');

let logica;
try {
  logica = await import(pathToFileURL(arquivoLogica).href);
} catch (erro) {
  console.error('Não foi possível importar logica.ts: ' + erro.message);
  console.error('Use Node 22.18+ ou rode: node --experimental-strip-types testes/edge-logica.mjs');
  process.exit(1);
}
const { tratarRequisicao, gerarSenhaTemporaria, TAMANHO_SENHA } = logica;

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

/* ---------- mundo falso ---------- */

const ORIGEM = 'https://aqs.habe.exemplo';
const TRAVA = 'É preciso manter ao menos uma conta de chefia ou administrador ativa e com acesso.';

const IDS = {
  admin: '00000000-0000-4000-8000-000000000001',
  chefia: '00000000-0000-4000-8000-000000000002',
  adjunto: '00000000-0000-4000-8000-000000000003',
  novato: '00000000-0000-4000-8000-000000000004',
  inativo: '00000000-0000-4000-8000-000000000005',
  chefia2: '00000000-0000-4000-8000-000000000006',
  inexistente: '00000000-0000-4000-8000-0000000000ff'
};

function erroComCodigo(mensagem, extra) {
  return Object.assign(new Error(mensagem), extra);
}

/* Estado inicial: conta institucional (admin), uma chefia, um adjunto com
   acesso, um militar sem acesso (novato), um inativo sem acesso e uma
   segunda chefia SEM acesso. Tokens: 'tk-<chave>' → usuário 'u-<chave>'. */
function criarMundo(ajustes = {}) {
  const militares = new Map();
  const usuarios = new Map();
  const fatores = new Map();
  const auditoria = [];
  const chamadas = [];
  let seq = 0;

  function addMilitar(chave, campos) {
    militares.set(IDS[chave], Object.assign({
      id: IDS[chave], usuario_id: null, posto: '1º Ten', nome_guerra: chave, email: null,
      papel: 'adjunto', ativo: true, deve_trocar_senha: true
    }, campos));
  }
  function addUsuario(chave, email) {
    usuarios.set('u-' + chave, { id: 'u-' + chave, email, banimento: null, senha: 'antiga' });
    return 'u-' + chave;
  }

  addMilitar('admin', { posto: '', nome_guerra: 'AQS — conta institucional', papel: 'administrador',
    email: 'aqs@habe.exemplo', usuario_id: addUsuario('admin', 'aqs@habe.exemplo') });
  addMilitar('chefia', { posto: 'Maj', nome_guerra: 'Chefe', papel: 'chefia',
    email: 'chefe@habe.exemplo', usuario_id: addUsuario('chefia', 'chefe@habe.exemplo') });
  addMilitar('adjunto', { nome_guerra: 'Adjunta', email: 'adjunta@habe.exemplo',
    usuario_id: addUsuario('adjunto', 'adjunta@habe.exemplo') });
  addMilitar('novato', { nome_guerra: 'Novato', email: 'Novato@HABE.exemplo' });
  addMilitar('inativo', { nome_guerra: 'Inativo', email: 'inativo@habe.exemplo', ativo: false });
  addMilitar('chefia2', { posto: 'Cap', nome_guerra: 'Subchefe', papel: 'chefia', email: 'sub@habe.exemplo' });

  const tokens = {
    'tk-admin': { id: 'u-admin', aal: 'aal1' },
    'tk-chefia': { id: 'u-chefia', aal: 'aal1' },
    'tk-adjunto': { id: 'u-adjunto', aal: 'aal1' },
    'tk-chefia-aal2': { id: 'u-chefia', aal: 'aal2' }
  };

  const gestorComAcesso = (m) => m && ['chefia', 'administrador'].includes(m.papel) && m.ativo && !!m.usuario_id;

  /* Imita o gatilho militares_antes: a linha ERA gestor com acesso e,
     depois, não sobra nenhum ⇒ P0001 com a mensagem do banco. */
  function conferirTrava(antes, depoisLista) {
    if (!gestorComAcesso(antes)) { return; }
    if (!depoisLista.some(gestorComAcesso)) {
      throw erroComCodigo(TRAVA, { code: 'P0001', hint: 'Dê acesso a outra chefia…' });
    }
  }

  const copia = (x) => (x ? JSON.parse(JSON.stringify(x)) : null);

  const deps = {
    origemPermitida: ORIGEM,
    async usuarioDoToken(token) {
      chamadas.push(['usuarioDoToken', token]);
      if (ajustes.authFora) { throw erroComCodigo('fetch failed', { status: 0 }); }
      return tokens[token] ? Object.assign({}, tokens[token]) : null;
    },
    async militarPorUsuario(uid) {
      return copia([...militares.values()].find((m) => m.usuario_id === uid));
    },
    async militarPorId(id) { return copia(militares.get(id)); },
    async militarPorEmail(email) { return copia([...militares.values()].find((m) => m.email === email)); },
    async atualizarMilitar(id, campos, opcoes = {}) {
      chamadas.push(['atualizarMilitar', id, Object.assign({}, campos), Object.assign({}, opcoes)]);
      if (ajustes.falhaVinculo && campos.usuario_id) { throw erroComCodigo('falha simulada no banco', { code: 'XX000' }); }
      const atual = militares.get(id);
      if (!atual) { return false; }
      if (opcoes.exigirSemAcesso && atual.usuario_id) { return false; }
      if (campos.email && [...militares.values()].some((m) => m.id !== id && m.email === campos.email)) {
        throw erroComCodigo('duplicate key value violates unique constraint "militares_email_unico"', { code: '23505' });
      }
      const depois = Object.assign({}, atual, campos);
      conferirTrava(atual, [...militares.values()].map((m) => (m.id === id ? depois : m)));
      militares.set(id, depois);
      return true;
    },
    async excluirMilitar(id) {
      chamadas.push(['excluirMilitar', id]);
      const atual = militares.get(id);
      if (!atual) { return false; }
      conferirTrava(atual, [...militares.values()].filter((m) => m.id !== id));
      militares.delete(id);
      return true;
    },
    async criarUsuario({ email, senha }) {
      chamadas.push(['criarUsuario', email]);
      if ([...usuarios.values()].some((u) => u.email === email)) {
        throw erroComCodigo('A user with this email address has already been registered', { status: 422, code: 'email_exists' });
      }
      seq += 1;
      const id = 'u-novo-' + seq;
      usuarios.set(id, { id, email, banimento: null, senha, email_confirmado: true });
      return { id };
    },
    async atualizarUsuario(id, atributos) {
      chamadas.push(['atualizarUsuario', id, Object.keys(atributos).sort()]);
      if (ajustes.falhaBanimento && atributos.banimento) { throw erroComCodigo('Auth indisponível', { status: 500 }); }
      const u = usuarios.get(id);
      if (!u) { throw erroComCodigo('User not found', { status: 404, code: 'user_not_found' }); }
      if (atributos.email && [...usuarios.values()].some((x) => x.id !== id && x.email === atributos.email)) {
        throw erroComCodigo('A user with this email address has already been registered', { status: 422, code: 'email_exists' });
      }
      if (atributos.senha !== undefined) { u.senha = atributos.senha; }
      if (atributos.email !== undefined) { u.email = atributos.email; }
      if (atributos.banimento !== undefined) { u.banimento = atributos.banimento; }
    },
    async excluirUsuario(id) {
      chamadas.push(['excluirUsuario', id]);
      if (ajustes.falhaExcluirAuth) { throw erroComCodigo('Auth indisponível', { status: 500 }); }
      if (!usuarios.delete(id)) { throw erroComCodigo('User not found', { status: 404, code: 'user_not_found' }); }
    },
    async listarFatores(uid) {
      return (fatores.get(uid) || []).map((f) => Object.assign({}, f));
    },
    async excluirFator(uid, fid) {
      chamadas.push(['excluirFator', uid, fid]);
      fatores.set(uid, (fatores.get(uid) || []).filter((f) => f.id !== fid));
    },
    async registrarAuditoria(linha) {
      chamadas.push(['registrarAuditoria', linha.operacao]);
      /* check antigo de auditoria.operacao (só INSERT/UPDATE/DELETE) */
      if (ajustes.checkAntigoAuditoria && !['INSERT', 'UPDATE', 'DELETE'].includes(linha.operacao)) {
        throw erroComCodigo('new row for relation "auditoria" violates check constraint "auditoria_operacao_valida"', { code: '23514' });
      }
      auditoria.push(JSON.parse(JSON.stringify(linha)));
    },
    registrarErro() { /* silencioso no teste */ }
  };
  Object.assign(deps, ajustes.deps || {});
  return { deps, militares, usuarios, fatores, auditoria, chamadas, tokens };
}

function pedir(mundo, { token = 'tk-chefia', metodo = 'POST', origem = ORIGEM, corpo } = {}) {
  return tratarRequisicao({
    metodo,
    origem,
    autorizacao: token === null ? null : 'Bearer ' + token,
    corpo
  }, mundo.deps);
}

const corpoDe = (acao, chave, extra = {}) => Object.assign({ acao, militar_id: IDS[chave] }, extra);

function confereSenha(senha) {
  assert.equal(typeof senha, 'string');
  assert.equal(senha.length, TAMANHO_SENHA, 'senha com ' + TAMANHO_SENHA + ' caracteres');
  assert.equal(TAMANHO_SENHA, 14);
  assert.match(senha, /[A-Z]/, 'maiúscula');
  assert.match(senha, /[a-z]/, 'minúscula');
  assert.match(senha, /[0-9]/, 'número');
  assert.doesNotMatch(senha, /[0O1lI\s]/, 'sem caracteres ambíguos nem espaço');
}

/* =========================================================================
   CORS, método e autenticação
   ========================================================================= */

await teste('OPTIONS da origem permitida: 204 com CORS restrito à origem', async () => {
  const r = await pedir(criarMundo(), { metodo: 'OPTIONS', token: null });
  assert.equal(r.status, 204);
  assert.equal(r.corpo, null);
  assert.equal(r.cabecalhos['Access-Control-Allow-Origin'], ORIGEM);
  assert.equal(r.cabecalhos['Vary'], 'Origin');
  assert.match(r.cabecalhos['Access-Control-Allow-Methods'], /POST/);
  assert.match(r.cabecalhos['Access-Control-Allow-Headers'], /authorization/);
  assert.match(r.cabecalhos['Access-Control-Allow-Headers'], /apikey/);
});

await teste('lista de origens separada por vírgula (com espaços e barra final)', async () => {
  const mundo = criarMundo();
  mundo.deps.origemPermitida = ' https://outra.exemplo , ' + ORIGEM + '/ ';
  const r = await pedir(mundo, { metodo: 'OPTIONS', token: null });
  assert.equal(r.status, 204);
  assert.equal(r.cabecalhos['Access-Control-Allow-Origin'], ORIGEM);
});

await teste('origem não permitida: 403 sem cabeçalhos de CORS (POST e OPTIONS)', async () => {
  const mundo = criarMundo();
  for (const metodo of ['OPTIONS', 'POST']) {
    const r = await pedir(mundo, { metodo, origem: 'https://site-malicioso.exemplo', corpo: corpoDe('criar', 'novato') });
    assert.equal(r.status, 403, metodo);
    assert.equal(r.cabecalhos['Access-Control-Allow-Origin'], undefined);
    assert.equal(r.corpo.ok, false);
  }
  assert.equal(mundo.chamadas.length, 0, 'nem validou token');
});

await teste('sem ORIGEM_PERMITIDA configurada, nenhum navegador passa; "*" só se configurado', async () => {
  const mundo = criarMundo();
  mundo.deps.origemPermitida = '';
  const r = await pedir(mundo, { metodo: 'OPTIONS', token: null });
  assert.equal(r.status, 403);
  assert.match(r.corpo.erro, /ORIGEM_PERMITIDA/);
  mundo.deps.origemPermitida = '*';
  const r2 = await pedir(mundo, { metodo: 'OPTIONS', token: null, origem: 'https://qualquer.exemplo' });
  assert.equal(r2.status, 204);
  assert.equal(r2.cabecalhos['Access-Control-Allow-Origin'], '*');
});

await teste('pedido sem Origin (fora do navegador) segue e depende do token', async () => {
  const mundo = criarMundo();
  const r = await pedir(mundo, { origem: null, token: null, corpo: corpoDe('criar', 'novato') });
  assert.equal(r.status, 401);
  assert.equal(r.cabecalhos['Access-Control-Allow-Origin'], undefined);
});

await teste('só POST: GET devolve 405 com Allow', async () => {
  const r = await pedir(criarMundo(), { metodo: 'GET' });
  assert.equal(r.status, 405);
  assert.equal(r.cabecalhos['Allow'], 'POST, OPTIONS');
  assert.equal(r.cabecalhos['Access-Control-Allow-Origin'], ORIGEM);
});

await teste('respostas JSON sem cache', async () => {
  const r = await pedir(criarMundo(), { token: null, corpo: corpoDe('criar', 'novato') });
  assert.match(r.cabecalhos['Content-Type'], /application\/json/);
  assert.equal(r.cabecalhos['Cache-Control'], 'no-store');
});

await teste('sem token ou token inválido: 401', async () => {
  const mundo = criarMundo();
  const r1 = await pedir(mundo, { token: null, corpo: corpoDe('criar', 'novato') });
  assert.equal(r1.status, 401);
  assert.equal(r1.corpo.ok, false);
  assert.match(r1.corpo.erro, /sessão/i);
  const r2 = await pedir(mundo, { token: 'tk-forjado', corpo: corpoDe('criar', 'novato') });
  assert.equal(r2.status, 401);
  const r3 = await tratarRequisicao({ metodo: 'POST', origem: ORIGEM, autorizacao: 'Basic abc', corpo: {} }, mundo.deps);
  assert.equal(r3.status, 401);
});

await teste('Auth fora do ar ao validar o token: 503 (não confunde com sessão expirada)', async () => {
  const r = await pedir(criarMundo({ authFora: true }), { corpo: corpoDe('criar', 'novato') });
  assert.equal(r.status, 503);
});

await teste('quem não é chefia nem administrador: 403 (e nada muda)', async () => {
  const mundo = criarMundo();
  const r = await pedir(mundo, { token: 'tk-adjunto', corpo: corpoDe('criar', 'novato') });
  assert.equal(r.status, 403);
  assert.match(r.corpo.erro, /chefia ou a conta institucional/);
  assert.equal(mundo.militares.get(IDS.novato).usuario_id, null);
  assert.ok(!mundo.chamadas.some((c) => c[0] === 'criarUsuario'));
});

await teste('chefia desativada não administra (403)', async () => {
  const mundo = criarMundo();
  mundo.militares.get(IDS.chefia).ativo = false;
  const r = await pedir(mundo, { corpo: corpoDe('criar', 'novato') });
  assert.equal(r.status, 403);
});

await teste('gestor com segundo fator precisa de sessão aal2', async () => {
  const mundo = criarMundo();
  mundo.fatores.set('u-chefia', [{ id: 'f1', status: 'verified', factor_type: 'totp' }]);
  const r = await pedir(mundo, { token: 'tk-chefia', corpo: corpoDe('criar', 'novato') });
  assert.equal(r.status, 403);
  assert.match(r.corpo.erro, /segundo fator/);
  const r2 = await pedir(mundo, { token: 'tk-chefia-aal2', corpo: corpoDe('criar', 'novato') });
  assert.equal(r2.status, 200, JSON.stringify(r2.corpo));
  /* fator não verificado (cadastro abandonado) não exige aal2 */
  const mundo3 = criarMundo();
  mundo3.fatores.set('u-chefia', [{ id: 'f2', status: 'unverified', factor_type: 'totp' }]);
  const r3 = await pedir(mundo3, { corpo: corpoDe('criar', 'novato') });
  assert.equal(r3.status, 200);
});

await teste('corpo inválido: 400 (JSON ausente, ação desconhecida, militar_id que não é uuid)', async () => {
  const mundo = criarMundo();
  for (const corpo of [null, 'texto', [], {}, { acao: 'apagar_tudo', militar_id: IDS.novato }, { acao: 'criar', militar_id: '1 or 1=1' }]) {
    const r = await pedir(mundo, { corpo });
    assert.equal(r.status, 400, JSON.stringify(corpo));
    assert.equal(r.corpo.ok, false);
  }
});

await teste('militar inexistente: 404', async () => {
  const r = await pedir(criarMundo(), { corpo: { acao: 'criar', militar_id: IDS.inexistente } });
  assert.equal(r.status, 404);
});

await teste('função sem configuração do Supabase: 500 com mensagem útil e CORS', async () => {
  const mundo = criarMundo();
  mundo.deps.erroDeConfiguracao = 'Sem SUPABASE_URL.';
  const r = await pedir(mundo, { corpo: corpoDe('criar', 'novato') });
  assert.equal(r.status, 500);
  assert.equal(r.corpo.erro, 'Sem SUPABASE_URL.');
  assert.equal(r.cabecalhos['Access-Control-Allow-Origin'], ORIGEM);
});

/* =========================================================================
   criar
   ========================================================================= */

await teste('chefia cria o acesso: senha temporária forte, vínculo, e-mail minúsculo e troca obrigatória', async () => {
  const mundo = criarMundo();
  mundo.militares.get(IDS.novato).deve_trocar_senha = false;
  const r = await pedir(mundo, { corpo: corpoDe('criar', 'novato') });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.equal(r.corpo.ok, true);
  confereSenha(r.corpo.senha_temporaria);
  const m = mundo.militares.get(IDS.novato);
  assert.ok(m.usuario_id && m.usuario_id.startsWith('u-novo-'), 'usuario_id vinculado');
  assert.equal(m.email, 'novato@habe.exemplo');
  assert.equal(m.deve_trocar_senha, true);
  const u = mundo.usuarios.get(m.usuario_id);
  assert.equal(u.email, 'novato@habe.exemplo');
  assert.equal(u.senha, r.corpo.senha_temporaria);
  const vinculo = mundo.chamadas.find((c) => c[0] === 'atualizarMilitar');
  assert.deepEqual(vinculo[3], { exigirSemAcesso: true }, 'vínculo só se ainda sem acesso');
});

await teste('criar com extra.email define o e-mail do cadastro', async () => {
  const mundo = criarMundo();
  const r = await pedir(mundo, { corpo: corpoDe('criar', 'novato', { email: '  Novo.Endereco@HABE.exemplo ' }) });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.equal(mundo.militares.get(IDS.novato).email, 'novo.endereco@habe.exemplo');
  assert.equal(r.corpo.email, 'novo.endereco@habe.exemplo');
});

await teste('criar: e-mail já usado por outro militar (409) ou inválido (400)', async () => {
  const mundo = criarMundo();
  const r = await pedir(mundo, { corpo: corpoDe('criar', 'novato', { email: 'adjunta@habe.exemplo' }) });
  assert.equal(r.status, 409);
  const r2 = await pedir(mundo, { corpo: corpoDe('criar', 'novato', { email: 'sem-arroba' }) });
  assert.equal(r2.status, 400);
  assert.ok(!mundo.chamadas.some((c) => c[0] === 'criarUsuario'));
});

await teste('criar: e-mail já cadastrado no Auth devolve 409 e o cadastro fica como estava', async () => {
  const mundo = criarMundo();
  mundo.usuarios.set('u-orfao', { id: 'u-orfao', email: 'novato@habe.exemplo' });
  const r = await pedir(mundo, { corpo: corpoDe('criar', 'novato') });
  assert.equal(r.status, 409);
  assert.match(r.corpo.erro, /Já existe um usuário de acesso com este e-mail/);
  assert.equal(mundo.militares.get(IDS.novato).usuario_id, null);
  assert.equal(mundo.auditoria.length, 0);
});

await teste('criar: se o vínculo falha, o usuário recém-criado é apagado (rollback)', async () => {
  const mundo = criarMundo({ falhaVinculo: true });
  const antes = mundo.usuarios.size;
  const r = await pedir(mundo, { corpo: corpoDe('criar', 'novato') });
  assert.equal(r.status, 500);
  assert.equal(r.corpo.ok, false);
  assert.equal(r.corpo.senha_temporaria, undefined, 'não devolve senha de acesso desfeito');
  assert.equal(mundo.usuarios.size, antes, 'usuário do Auth removido');
  const nomes = mundo.chamadas.map((c) => c[0]);
  assert.ok(nomes.indexOf('criarUsuario') < nomes.indexOf('excluirUsuario'));
  assert.equal(mundo.militares.get(IDS.novato).usuario_id, null);
});

await teste('criar: corrida com outro gestor (já vinculado) desfaz o usuário e devolve 409', async () => {
  const mundo = criarMundo();
  const original = mundo.deps.atualizarMilitar;
  mundo.deps.atualizarMilitar = async (id, campos, opcoes) => {
    mundo.militares.get(IDS.novato).usuario_id = 'u-de-outro-gestor';
    return original(id, campos, opcoes);
  };
  const r = await pedir(mundo, { corpo: corpoDe('criar', 'novato') });
  assert.equal(r.status, 409);
  assert.ok(mundo.chamadas.some((c) => c[0] === 'excluirUsuario'));
});

await teste('criar: militar que já tem acesso, desativado ou sem e-mail', async () => {
  const mundo = criarMundo();
  assert.equal((await pedir(mundo, { corpo: corpoDe('criar', 'adjunto') })).status, 409);
  assert.equal((await pedir(mundo, { corpo: corpoDe('criar', 'inativo') })).status, 409);
  mundo.militares.get(IDS.novato).email = null;
  const r = await pedir(mundo, { corpo: corpoDe('criar', 'novato') });
  assert.equal(r.status, 400);
  assert.match(r.corpo.erro, /e-mail/);
});

/* =========================================================================
   papéis, a si mesmo e a conta institucional
   ========================================================================= */

await teste('ninguém desativa nem exclui a si mesmo (403)', async () => {
  const mundo = criarMundo();
  const r1 = await pedir(mundo, { corpo: corpoDe('desativar', 'chefia') });
  assert.equal(r1.status, 403);
  assert.match(r1.corpo.erro, /próprio acesso/);
  const r2 = await pedir(mundo, { corpo: corpoDe('excluir', 'chefia') });
  assert.equal(r2.status, 403);
  assert.match(r2.corpo.erro, /próprio cadastro/);
  const r3 = await pedir(mundo, { token: 'tk-admin', corpo: corpoDe('excluir', 'admin') });
  assert.equal(r3.status, 403);
  assert.ok(mundo.militares.has(IDS.chefia) && mundo.militares.get(IDS.chefia).ativo);
  assert.ok(!mundo.chamadas.some((c) => c[0] === 'excluirMilitar' || c[0] === 'atualizarMilitar'));
});

await teste('chefia não mexe na conta de administrador (403 em todas as ações)', async () => {
  const mundo = criarMundo();
  for (const acao of ['redefinir_senha', 'desativar', 'reativar', 'remover_mfa', 'excluir']) {
    const r = await pedir(mundo, { corpo: corpoDe(acao, 'admin') });
    assert.equal(r.status, 403, acao);
    assert.match(r.corpo.erro, /conta institucional da AQS/);
  }
  const r = await pedir(mundo, { corpo: corpoDe('alterar_email', 'admin', { email: 'x@habe.exemplo' }) });
  assert.equal(r.status, 403);
  assert.equal(mundo.militares.get(IDS.admin).ativo, true);
  assert.equal(mundo.usuarios.get('u-admin').senha, 'antiga');
});

await teste('administrador mexe na chefia (ok): redefine a senha e desativa', async () => {
  const mundo = criarMundo();
  const r1 = await pedir(mundo, { token: 'tk-admin', corpo: corpoDe('redefinir_senha', 'chefia') });
  assert.equal(r1.status, 200, JSON.stringify(r1.corpo));
  confereSenha(r1.corpo.senha_temporaria);
  assert.equal(mundo.usuarios.get('u-chefia').senha, r1.corpo.senha_temporaria);
  const r2 = await pedir(mundo, { token: 'tk-admin', corpo: corpoDe('desativar', 'chefia') });
  assert.equal(r2.status, 200, JSON.stringify(r2.corpo));
  assert.equal(mundo.militares.get(IDS.chefia).ativo, false);
  assert.equal(mundo.usuarios.get('u-chefia').banimento, '876000h');
});

await teste('administrador gerencia outra conta de administrador', async () => {
  const mundo = criarMundo();
  mundo.militares.set(IDS.novato, Object.assign(mundo.militares.get(IDS.novato), { papel: 'administrador' }));
  const r = await pedir(mundo, { token: 'tk-admin', corpo: corpoDe('criar', 'novato') });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
});

/* =========================================================================
   redefinir, desativar, reativar, remover_mfa, alterar_email
   ========================================================================= */

await teste('redefinir_senha sem usuario_id: 400; com acesso: nova senha e troca obrigatória', async () => {
  const mundo = criarMundo();
  const r1 = await pedir(mundo, { corpo: corpoDe('redefinir_senha', 'novato') });
  assert.equal(r1.status, 400);
  assert.match(r1.corpo.erro, /Criar acesso/);
  mundo.militares.get(IDS.adjunto).deve_trocar_senha = false;
  const r2 = await pedir(mundo, { corpo: corpoDe('redefinir_senha', 'adjunto') });
  assert.equal(r2.status, 200);
  confereSenha(r2.corpo.senha_temporaria);
  assert.equal(mundo.militares.get(IDS.adjunto).deve_trocar_senha, true);
  assert.notEqual(mundo.usuarios.get('u-adjunto').senha, 'antiga');
});

await teste('desativar: banco primeiro (ativo = false), depois bloqueia o login', async () => {
  const mundo = criarMundo();
  const r = await pedir(mundo, { corpo: corpoDe('desativar', 'adjunto') });
  assert.equal(r.status, 200);
  assert.equal(mundo.militares.get(IDS.adjunto).ativo, false);
  assert.equal(mundo.usuarios.get('u-adjunto').banimento, '876000h');
  const nomes = mundo.chamadas.map((c) => c[0]);
  assert.ok(nomes.indexOf('atualizarMilitar') < nomes.indexOf('atualizarUsuario'));
});

/* A trava só dispara de verdade numa corrida: dois gestores mexendo um no
   outro ao mesmo tempo (quem chama foi validado como gestor, mas perdeu o
   acesso antes da gravação). O gatilho falso de militares recusa como o
   real. */
function prepararCorrida(mundo) {
  mundo.militares.get(IDS.admin).usuario_id = null; /* conta institucional sem acesso */
  mundo.militares.get(IDS.chefia2).usuario_id = 'u-chefia2';
  mundo.usuarios.set('u-chefia2', { id: 'u-chefia2', email: 'sub@habe.exemplo', banimento: null });
  mundo.tokens['tk-chefia2'] = { id: 'u-chefia2', aal: 'aal1' };
  const original = mundo.deps.militarPorUsuario;
  mundo.deps.militarPorUsuario = async (uid) => {
    const m = await original(uid);
    mundo.militares.get(IDS.chefia2).ativo = false; /* o "outro pedido" desativou chefia2 */
    return m;
  };
}

await teste('desativar o último gestor com acesso: 409 com a mensagem do banco e Auth intocado', async () => {
  const mundo = criarMundo();
  prepararCorrida(mundo);
  const r = await pedir(mundo, { token: 'tk-chefia2', corpo: corpoDe('desativar', 'chefia') });
  assert.equal(r.status, 409, JSON.stringify(r.corpo));
  assert.equal(r.corpo.erro, TRAVA);
  assert.equal(mundo.militares.get(IDS.chefia).ativo, true);
  assert.equal(mundo.usuarios.get('u-chefia').banimento, null, 'login não foi bloqueado');
  assert.equal(mundo.auditoria.length, 0);
});

await teste('desativar: falha ao bloquear o login vira aviso (acesso aos dados já cortado)', async () => {
  const mundo = criarMundo({ falhaBanimento: true });
  const r = await pedir(mundo, { corpo: corpoDe('desativar', 'adjunto') });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.ok, true);
  assert.match(r.corpo.aviso, /não pôde ser bloqueado/);
  assert.equal(mundo.militares.get(IDS.adjunto).ativo, false);
});

await teste('reativar: desbloqueia o login primeiro e só então ativa o cadastro', async () => {
  const mundo = criarMundo();
  mundo.militares.get(IDS.adjunto).ativo = false;
  mundo.usuarios.get('u-adjunto').banimento = '876000h';
  const r = await pedir(mundo, { corpo: corpoDe('reativar', 'adjunto') });
  assert.equal(r.status, 200);
  assert.equal(mundo.militares.get(IDS.adjunto).ativo, true);
  assert.equal(mundo.usuarios.get('u-adjunto').banimento, 'none');
  const nomes = mundo.chamadas.map((c) => c[0]);
  assert.ok(nomes.indexOf('atualizarUsuario') < nomes.indexOf('atualizarMilitar'));
  /* falha no desbloqueio: nada muda */
  const mundo2 = criarMundo({ falhaBanimento: true });
  mundo2.militares.get(IDS.adjunto).ativo = false;
  const r2 = await pedir(mundo2, { corpo: corpoDe('reativar', 'adjunto') });
  assert.equal(r2.status, 502);
  assert.equal(mundo2.militares.get(IDS.adjunto).ativo, false);
});

await teste('remover_mfa apaga todos os fatores do militar', async () => {
  const mundo = criarMundo();
  mundo.fatores.set('u-adjunto', [{ id: 'f1', status: 'verified' }, { id: 'f2', status: 'unverified' }]);
  const r = await pedir(mundo, { corpo: corpoDe('remover_mfa', 'adjunto') });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.removidos, 2);
  assert.deepEqual(mundo.fatores.get('u-adjunto'), []);
  const r2 = await pedir(mundo, { corpo: corpoDe('remover_mfa', 'novato') });
  assert.equal(r2.status, 400);
});

await teste('alterar_email: Auth e cadastro com o e-mail novo (minúsculo)', async () => {
  const mundo = criarMundo();
  const r = await pedir(mundo, { corpo: corpoDe('alterar_email', 'adjunto', { email: 'Souza.Nova@HABE.exemplo' }) });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.equal(mundo.usuarios.get('u-adjunto').email, 'souza.nova@habe.exemplo');
  assert.equal(mundo.militares.get(IDS.adjunto).email, 'souza.nova@habe.exemplo');
  const auth = mundo.chamadas.find((c) => c[0] === 'atualizarUsuario');
  assert.deepEqual(auth[2], ['email']);
});

await teste('alterar_email: e-mail já usado (409), sem acesso (400), igual ou vazio (400)', async () => {
  const mundo = criarMundo();
  assert.equal((await pedir(mundo, { corpo: corpoDe('alterar_email', 'adjunto', { email: 'chefe@habe.exemplo' }) })).status, 409);
  mundo.usuarios.set('u-solto', { id: 'u-solto', email: 'solto@habe.exemplo' });
  const r = await pedir(mundo, { corpo: corpoDe('alterar_email', 'adjunto', { email: 'solto@habe.exemplo' }) });
  assert.equal(r.status, 409);
  assert.equal(mundo.militares.get(IDS.adjunto).email, 'adjunta@habe.exemplo');
  assert.equal((await pedir(mundo, { corpo: corpoDe('alterar_email', 'novato', { email: 'n@habe.exemplo' }) })).status, 400);
  assert.equal((await pedir(mundo, { corpo: corpoDe('alterar_email', 'adjunto', { email: 'adjunta@habe.exemplo' }) })).status, 400);
  assert.equal((await pedir(mundo, { corpo: corpoDe('alterar_email', 'adjunto') })).status, 400);
});

await teste('alterar_email: falha no cadastro desfaz o e-mail no Auth', async () => {
  const mundo = criarMundo();
  mundo.deps.atualizarMilitar = async () => { throw erroComCodigo('falha simulada', { code: 'XX000' }); };
  const r = await pedir(mundo, { corpo: corpoDe('alterar_email', 'adjunto', { email: 'novo@habe.exemplo' }) });
  assert.equal(r.status, 500);
  assert.equal(mundo.usuarios.get('u-adjunto').email, 'adjunta@habe.exemplo');
});

/* =========================================================================
   excluir
   ========================================================================= */

await teste('excluir com a trava do banco: 409 com a mensagem do banco e Auth intocado', async () => {
  const mundo = criarMundo();
  prepararCorrida(mundo);
  const r = await pedir(mundo, { token: 'tk-chefia2', corpo: corpoDe('excluir', 'chefia') });
  assert.equal(r.status, 409, JSON.stringify(r.corpo));
  assert.equal(r.corpo.erro, TRAVA);
  assert.ok(mundo.militares.has(IDS.chefia), 'linha continua');
  assert.ok(mundo.usuarios.has('u-chefia'), 'usuário do Auth continua');
  assert.ok(!mundo.chamadas.some((c) => c[0] === 'excluirUsuario'), 'nem tentou apagar do Auth');
  assert.equal(mundo.auditoria.length, 0);
});

await teste('excluir com sucesso: apaga a linha de militares e DEPOIS o usuário do Auth', async () => {
  const mundo = criarMundo();
  const r = await pedir(mundo, { corpo: corpoDe('excluir', 'adjunto') });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.deepEqual(r.corpo, { ok: true });
  assert.ok(!mundo.militares.has(IDS.adjunto));
  assert.ok(!mundo.usuarios.has('u-adjunto'));
  const nomes = mundo.chamadas.map((c) => c[0]).filter((n) => n === 'excluirMilitar' || n === 'excluirUsuario');
  assert.deepEqual(nomes, ['excluirMilitar', 'excluirUsuario']);
});

await teste('excluir militar sem acesso não chama o Auth', async () => {
  const mundo = criarMundo();
  const r = await pedir(mundo, { corpo: corpoDe('excluir', 'novato') });
  assert.equal(r.status, 200);
  assert.ok(!mundo.chamadas.some((c) => c[0] === 'excluirUsuario'));
});

await teste('excluir: falha ao apagar do Auth é informada, mas o cadastro já foi excluído', async () => {
  const mundo = criarMundo({ falhaExcluirAuth: true });
  const r = await pedir(mundo, { corpo: corpoDe('excluir', 'adjunto') });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.ok, true);
  assert.match(r.corpo.aviso, /Authentication → Users/);
  assert.ok(!mundo.militares.has(IDS.adjunto));
  assert.equal(mundo.auditoria.at(-1).depois.usuario_auth_removido, false);
});

await teste('chefia exclui outra chefia (passagem de chefia concluída)', async () => {
  const mundo = criarMundo();
  const r = await pedir(mundo, { corpo: corpoDe('excluir', 'chefia2') });
  assert.equal(r.status, 200);
  assert.ok(!mundo.militares.has(IDS.chefia2));
});

/* =========================================================================
   auditoria
   ========================================================================= */

await teste('auditoria de cada ação: auth.users, ADMIN:<ação>, militar-alvo, autor — e NUNCA a senha', async () => {
  const mundo = criarMundo();
  const senhas = [];
  const r1 = await pedir(mundo, { corpo: corpoDe('criar', 'novato') });
  senhas.push(r1.corpo.senha_temporaria);
  const r2 = await pedir(mundo, { corpo: corpoDe('redefinir_senha', 'adjunto') });
  senhas.push(r2.corpo.senha_temporaria);
  await pedir(mundo, { corpo: corpoDe('desativar', 'adjunto') });
  await pedir(mundo, { corpo: corpoDe('reativar', 'adjunto') });
  await pedir(mundo, { corpo: corpoDe('alterar_email', 'adjunto', { email: 'outra@habe.exemplo' }) });
  await pedir(mundo, { corpo: corpoDe('remover_mfa', 'adjunto') });
  await pedir(mundo, { corpo: corpoDe('excluir', 'adjunto') });

  assert.deepEqual(mundo.auditoria.map((a) => a.operacao), [
    'ADMIN:criar', 'ADMIN:redefinir_senha', 'ADMIN:desativar', 'ADMIN:reativar',
    'ADMIN:alterar_email', 'ADMIN:remover_mfa', 'ADMIN:excluir'
  ]);
  for (const a of mundo.auditoria) {
    assert.equal(a.tabela, 'auth.users');
    assert.equal(a.militar_id, IDS.chefia);
    assert.equal(a.militar_nome, 'Maj Chefe');
    assert.equal(a.usuario_id, 'u-chefia');
  }
  assert.equal(mundo.auditoria[0].registro_id, IDS.novato);
  assert.equal(mundo.auditoria[1].registro_id, IDS.adjunto);
  const tudo = JSON.stringify(mundo.auditoria);
  for (const s of senhas) {
    assert.ok(s && !tudo.includes(s), 'senha temporária fora da auditoria');
  }
  const chaves = [];
  (function coletar(x) {
    if (x && typeof x === 'object') { for (const [k, v] of Object.entries(x)) { chaves.push(k); coletar(v); } }
  })(mundo.auditoria);
  assert.deepEqual(chaves.filter((k) => /^(senha|password|senha_temporaria|nova_senha)$/i.test(k)), [], 'nenhum campo de senha');
  assert.ok(!tudo.includes('antiga'));
});

await teste('auditoria com o check antigo de operacao: registra em INSERT/UPDATE/DELETE com a ação em depois', async () => {
  const mundo = criarMundo({ checkAntigoAuditoria: true });
  await pedir(mundo, { corpo: corpoDe('criar', 'novato') });
  await pedir(mundo, { corpo: corpoDe('desativar', 'adjunto') });
  await pedir(mundo, { corpo: corpoDe('excluir', 'novato') });
  assert.deepEqual(mundo.auditoria.map((a) => [a.operacao, a.depois.acao]), [
    ['INSERT', 'ADMIN:criar'], ['UPDATE', 'ADMIN:desativar'], ['DELETE', 'ADMIN:excluir']
  ]);
});

await teste('falha na auditoria não desfaz nem esconde a ação', async () => {
  const mundo = criarMundo();
  mundo.deps.registrarAuditoria = async () => { throw new Error('auditoria fora'); };
  const r = await pedir(mundo, { corpo: corpoDe('criar', 'novato') });
  assert.equal(r.status, 200);
  confereSenha(r.corpo.senha_temporaria);
});

await teste('erro inesperado vira 500 genérico (sem pilha na resposta)', async () => {
  const mundo = criarMundo();
  mundo.deps.militarPorId = async () => { throw new Error('conexão com o banco caiu'); };
  const r = await pedir(mundo, { corpo: corpoDe('criar', 'novato') });
  assert.equal(r.status, 500);
  assert.equal(r.corpo.ok, false);
  assert.doesNotMatch(r.corpo.erro, /at |\.ts:/);
});

/* =========================================================================
   senha temporária
   ========================================================================= */

await teste('gerarSenhaTemporaria: 2000 senhas com as classes exigidas, sem ambíguos, todas diferentes', async () => {
  const vistas = new Set();
  for (let i = 0; i < 2000; i += 1) {
    const s = gerarSenhaTemporaria();
    confereSenha(s);
    assert.match(s, /^[A-Za-z0-9@#%+=]+$/);
    assert.equal((s.match(/[@#%+=]/g) || []).length, 1, 'exatamente um símbolo');
    vistas.add(s);
  }
  assert.equal(vistas.size, 2000);
});

await teste('gerarSenhaTemporaria usa a fonte injetada (crypto.getRandomValues em produção)', async () => {
  let pedidos = 0;
  let semente = 7;
  const fonte = (n) => {
    pedidos += 1;
    const b = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) { semente = (semente * 1103515245 + 12345) >>> 0; b[i] = semente >>> 24; }
    return b;
  };
  const s1 = gerarSenhaTemporaria(fonte);
  confereSenha(s1);
  assert.ok(pedidos > 0);
  semente = 7;
  assert.equal(gerarSenhaTemporaria(fonte), s1, 'determinística com a mesma fonte');
  /* fonte que só devolve bytes acima do limite de rejeição: não trava */
  assert.throws(() => gerarSenhaTemporaria((n) => new Uint8Array(n).fill(255)));
});

/* ---------- resultado ---------- */

if (falhas.length) {
  for (const f of falhas) {
    console.error('✗ ' + f.nome);
    console.error('  ' + (f.erro && f.erro.stack ? f.erro.stack.split("\n").slice(0, 30).join('\n  ') : f.erro));
  }
  console.error('\n' + falhas.length + ' falha(s), ' + aprovados + ' aprovado(s) — edge-logica');
  process.exit(1);
}
console.log('✓ edge-logica: ' + aprovados + ' testes aprovados');
