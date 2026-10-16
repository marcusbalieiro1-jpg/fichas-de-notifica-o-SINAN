#!/usr/bin/env node
/* =========================================================================
   HABE – AQS e NSP — teste do contrato da API (ARQUITETURA §6)
   Uso: node testes/contrato-api.mjs   (a partir da pasta aqs-nsp)

   1. Num vm com window/sessionStorage/Blob/File de mentira, carrega util,
      regras, recorrencia, dados-demo, api-demo e api.js (a ordem do
      demo.html) e confere que a fachada aceita o adaptador.
   2. Se api-supabase.js existir, carrega-o com um window.supabase falso e
      confere que implementa todos os Api.METODOS.
   3. Exercita a demonstração de ponta a ponta, conferindo os formatos de
      §6 e as regras de papéis e continuidade (gestor, administrador, trava
      anti-bloqueio, passagem de chefia, exclusão preservando o histórico).
   ========================================================================= */

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const js = (nome) => path.join(raiz, 'assets', 'js', nome);

/* ---------- ambiente de navegador mínimo ---------- */

function criarArmazenamento() {
  const dados = new Map();
  return {
    getItem: (k) => (dados.has(k) ? dados.get(k) : null),
    setItem: (k, v) => { dados.set(k, String(v)); },
    removeItem: (k) => { dados.delete(k); },
    clear: () => dados.clear(),
    key: (i) => [...dados.keys()][i] ?? null,
    get length() { return dados.size; },
    _dados: dados
  };
}

function criarContexto(extras = {}) {
  const ctx = vm.createContext({
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    Blob, File, crypto: globalThis.crypto, TextEncoder, TextDecoder, URL,
    sessionStorage: extras.sessionStorage || criarArmazenamento(),
    localStorage: criarArmazenamento(),
    ...extras
  });
  ctx.window = ctx;
  return ctx;
}

function carregar(ctx, arquivo) {
  vm.runInContext(fs.readFileSync(arquivo, 'utf8'), ctx, { filename: arquivo });
}

const ORDEM_DEMO = ['config.js', 'util.js', 'regras.js', 'recorrencia.js', 'dados-demo.js', 'api-demo.js', 'api.js'];

function montarDemo(sessionStorage) {
  const ctx = criarContexto({ sessionStorage });
  for (const arquivo of ORDEM_DEMO) { carregar(ctx, js(arquivo)); }
  return ctx;
}

/* ---------- mini-executor ---------- */

let aprovados = 0;
const falhas = [];
let etapaAtual = '';

async function etapa(nome, fn) {
  etapaAtual = nome;
  try {
    await fn();
    aprovados += 1;
  } catch (erro) {
    falhas.push({ nome, erro });
  }
}

const json = (x) => JSON.parse(JSON.stringify(x));

async function rejeita(promessa, padrao, mensagem) {
  let erro = null;
  try { await promessa; } catch (e) { erro = e; }
  assert.ok(erro, (mensagem || 'deveria falhar') + ' [' + etapaAtual + ']');
  assert.equal(typeof erro.message, 'string');
  if (padrao) { assert.match(erro.message, padrao, mensagem); }
  return erro;
}

function temCampos(objeto, campos, rotulo) {
  assert.ok(objeto && typeof objeto === 'object', rotulo + ': objeto esperado');
  const faltando = campos.filter((c) => !Object.prototype.hasOwnProperty.call(objeto, c));
  assert.deepEqual(faltando, [], rotulo + ': campos ausentes');
}

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

/* Formatos de §3/§6 */
const CAMPOS = {
  setor: ['id', 'sigla', 'nome', 'cor', 'ordem', 'criado_em'],
  militar: ['id', 'usuario_id', 'posto', 'nome_guerra', 'nome_completo', 'email', 'setor_id', 'papel', 'ativo',
    'deve_trocar_senha', 'ultimo_acesso', 'criado_em', 'atualizado_em'],
  atividade: ['id', 'ordem', 'titulo', 'descricao', 'setor_id', 'tipo', 'periodicidade', 'dia_semana', 'dia_mes',
    'mes_inicio', 'prazo', 'antecipar_dia_util', 'prioridade', 'exige_evidencia', 'ativa', 'data_inicio',
    'criado_por', 'criado_em', 'atualizado_em', 'responsaveis'],
  vocorrencia: ['id', 'atividade_id', 'referencia', 'titulo_execucao', 'prazo', 'status', 'observacao',
    'justificativa', 'iniciada_em', 'concluida_em', 'concluida_por', 'concluida_por_nome', 'criado_por',
    'criado_em', 'atualizado_em', 'atividade_titulo', 'atividade_tipo', 'periodicidade', 'prioridade',
    'setor_id', 'exige_evidencia', 'responsaveis', 'data_ref', 'atrasada', 'concluida_no_prazo',
    'qtd_evidencias', 'qtd_comentarios'],
  evidencia: ['id', 'atividade_id', 'ocorrencia_id', 'storage_path', 'nome', 'mime', 'tamanho', 'descricao',
    'enviado_por', 'enviado_por_nome', 'enviado_em'],
  comentario: ['id', 'atividade_id', 'ocorrencia_id', 'autor_id', 'autor_nome', 'autor_papel', 'texto', 'criado_em'],
  aviso: ['id', 'titulo', 'mensagem', 'nivel', 'para_todos', 'prazo', 'atividade_id', 'fixado', 'expira_em',
    'criado_por', 'criado_por_nome', 'criado_em', 'atualizado_em', 'destinatarios', 'ciencias', 'ciente_por_mim'],
  notificacao: ['id', 'destinatario_id', 'tipo', 'titulo', 'mensagem', 'atividade_id', 'ocorrencia_id', 'aviso_id',
    'lida', 'criado_em'],
  auditoria: ['id', 'quando', 'militar_id', 'militar_nome', 'usuario_id', 'tabela', 'operacao', 'registro_id',
    'antes', 'depois'],
  feriado: ['data', 'descricao']
};

/* =========================================================================
   1. fachada + adaptador de demonstração
   ========================================================================= */

const armazenamento = criarArmazenamento();
const ctx = montarDemo(armazenamento);
const { Api, ApiDemo, Regras, U } = ctx;
const hoje = U.hojeBelem();

await etapa('a fachada aceita o ApiDemo e expõe todos os METODOS', async () => {
  assert.equal(Api.modo, 'demo');
  assert.ok(Array.isArray(Api.METODOS) && Api.METODOS.length >= 50);
  for (const nome of Api.METODOS) {
    assert.equal(typeof ApiDemo[nome], 'function', 'ApiDemo.' + nome);
    assert.equal(typeof Api[nome], 'function', 'Api.' + nome);
  }
  assert.equal(typeof Api.referencias, 'function');
  assert.equal(typeof Api.invalidarReferencias, 'function');
  assert.equal(typeof ApiDemo.usuariosDemo, 'function');
  assert.equal(typeof ApiDemo.reiniciar, 'function');
});

await etapa('a fachada recusa um adaptador incompleto', async () => {
  const outro = criarContexto();
  outro.ApiDemo = { iniciar() {} };
  assert.throws(() => carregar(outro, js('api.js')), /incompleto/);
});

ApiDemo.definirAtraso(0);

/* =========================================================================
   2. adaptador Supabase (se já existir)
   ========================================================================= */

await etapa('api-supabase.js implementa todos os METODOS (com window.supabase falso)', async () => {
  /* AQS_API_SUPABASE permite apontar outro arquivo (usado para testar este próprio teste). */
  const arquivo = process.env.AQS_API_SUPABASE || js('api-supabase.js');
  if (!fs.existsSync(arquivo)) {
    console.log('  (pulado: assets/js/api-supabase.js ainda não existe)');
    return;
  }
  /* Cliente "buraco negro": qualquer propriedade ou chamada devolve outro
     igual; nunca é thenable, para não travar awaits no carregamento. */
  function falso() {
    const alvo = function () {};
    return new Proxy(alvo, {
      get(_, prop) {
        if (prop === 'then') { return undefined; }
        if (prop === Symbol.toPrimitive) { return () => ''; }
        if (prop === Symbol.iterator || prop === Symbol.asyncIterator) { return undefined; }
        if (prop === 'prototype') { return alvo.prototype; }
        return falso();
      },
      apply() { return falso(); }
    });
  }
  let clientesCriados = 0;
  const c2 = criarContexto({
    location: { href: 'https://exemplo.local/index.html', origin: 'https://exemplo.local', hash: '', pathname: '/index.html' },
    navigator: { userAgent: 'teste', language: 'pt-BR' },
    document: { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible',
      querySelector: () => null, querySelectorAll: () => [], getElementById: () => null }
  });
  c2.supabase = { createClient: () => { clientesCriados += 1; return falso(); } };
  carregar(c2, js('config.js'));
  /* valores com cara de reais: o adaptador pode recusar os de exemplo do config.js */
  c2.AQS_CONFIG.SUPABASE_URL = 'https://exemplo-teste.supabase.co';
  c2.AQS_CONFIG.SUPABASE_ANON_KEY = 'chave-anon-de-teste';
  for (const nome of ['util.js', 'regras.js', 'recorrencia.js']) { carregar(c2, js(nome)); }
  carregar(c2, arquivo);
  assert.ok(clientesCriados <= 1, 'um único cliente Supabase');
  assert.ok(c2.ApiSupabase, 'global ApiSupabase');
  const faltando = json(Api.METODOS).filter((m) => typeof c2.ApiSupabase[m] !== 'function');
  assert.deepEqual(faltando, [], 'métodos ausentes em ApiSupabase');
  carregar(c2, js('api.js'));
  assert.equal(c2.Api.modo, 'supabase');
});

/* =========================================================================
   3. demonstração de ponta a ponta
   ========================================================================= */

const eventosSessao = [];
let ids = {};

await etapa('estado inicial da demonstração: determinístico e com os dados pedidos', async () => {
  const { DadosDemo, Recorrencia } = ctx;
  const e1 = json(DadosDemo.criarEstadoInicial('2026-10-15'));
  const e2 = json(DadosDemo.criarEstadoInicial('2026-10-15'));
  assert.deepEqual(e1, e2, 'mesma data ⇒ mesmo estado');
  assert.equal(e1.atividades.length, 16);
  assert.deepEqual(e1.setores.map((s) => s.sigla), ['NSP', 'AQS']);
  assert.equal(e1.feriados.length, 24);
  const porEmail = Object.fromEntries(e1.militares.map((m) => [m.email, m]));
  assert.equal(porEmail['aqs@demo.local'].papel, 'administrador');
  assert.equal(porEmail['aqs@demo.local'].nome_guerra, 'AQS — conta institucional');
  assert.equal(e1.setores.find((s) => s.id === porEmail['aqs@demo.local'].setor_id).sigla, 'AQS');
  assert.equal(porEmail['chefia@demo.local'].posto, 'Maj');
  assert.equal(porEmail['chefia@demo.local'].nome_guerra, 'Chefia NSP');
  const recorrentes = e1.atividades.filter((a) => a.tipo === 'recorrente');
  assert.ok(recorrentes.every((a) => a.data_inicio === '2026-08-01'), 'data_inicio = hoje − 75');
  const prazos = e1.atividades.filter((a) => a.tipo === 'pontual').map((a) => [a.ordem, a.prazo]);
  assert.deepEqual(prazos, [[9, '2026-10-26'], [12, '2026-10-19']], 'hoje+10 e hoje+3, no dia útil seguinte');
  const titulos = e1.ocorrencias.map((o) => o.titulo_execucao).filter(Boolean);
  assert.ok(titulos.includes('Incidente 2026/037 — queda no leito'));
  assert.ok(titulos.includes('Treinamento: higiene das mãos — UTI'));
  const nomes = e1.evidencias.map((ev) => ev.nome);
  for (const n of ['Indicadores-setembro-2026.pptx', 'Auditoria-cirurgica-S41.pdf', 'Planilha-CGC-set2026.xlsx',
    'Ata-reuniao-anestesistas.docx']) { assert.ok(nomes.includes(n), n); }
  assert.equal(e1.avisos.length, 3);
  const urgente = e1.avisos.find((a) => a.nivel === 'urgente');
  assert.ok(urgente.fixado && urgente.para_todos && urgente.prazo === '2026-11-05');
  assert.ok(e1.avisos.some((a) => a.nivel === 'importante' && a.prazo && !a.para_todos));
  assert.ok(e1.avisos.some((a) => a.nivel === 'informativo' && a.para_todos));
  assert.ok(e1.avisos_ciencia.length > 0 && e1.avisos_ciencia.length < 3 * 5, 'ciências parciais');
  for (const m of e1.militares) {
    assert.ok(e1.notificacoes.some((n) => n.destinatario_id === m.id), 'notificação para ' + m.email);
  }
  assert.ok(e1.comentarios.some((c) => c.autor_papel === 'chefia' && /Consegue concluir/.test(c.texto)), 'cobrança');
  assert.ok(e1.comentarios.some((c) => c.autor_papel === 'chefia' && /Parabéns/.test(c.texto)), 'elogio');
  const config = Object.fromEntries(e1.configuracoes.map((c) => [c.chave, c.valor]));
  assert.equal(Recorrencia.diasEntre(ctx.Regras.dataBelem(config.ultimo_backup.em), '2026-10-15'), 40);
  assert.ok(config.contatos.email_institucional && config.contatos.telefone && config.contatos.responsavel_tecnico);
  assert.ok(e1.auditoria.length >= 5);
  /* qualquer data gera um estado coerente (fevereiro bissexto, virada de ano) */
  for (const d of ['2026-10-15', '2027-01-04', '2028-02-29', '2026-12-31', '2027-05-03']) {
    const e = json(DadosDemo.criarEstadoInicial(d));
    /* ações de pessoas (concluir, comentar, enviar, publicar, dar ciência) caem em dias úteis */
    const feriadosE = e.feriados.map((f) => f.data);
    const instantes = [].concat(
      e.ocorrencias.map((o) => o.concluida_em), e.ocorrencias.map((o) => o.iniciada_em),
      e.comentarios.map((c) => c.criado_em), e.evidencias.map((v) => v.enviado_em),
      e.avisos.map((a) => a.criado_em), e.avisos_ciencia.map((c) => c.ciente_em),
      e.atividades.map((a) => a.criado_em)).filter(Boolean);
    const foraDoExpediente = instantes.filter((i) => !Recorrencia.eDiaUtil(ctx.Regras.dataBelem(i), feriadosE));
    assert.deepEqual(foraDoExpediente, [], d + ': registros em fim de semana/feriado');
    const abertasVencidas = e.ocorrencias.filter((o) => (o.status === 'pendente' || o.status === 'em_andamento') && o.prazo && o.prazo < d);
    assert.ok(abertasVencidas.length >= 3 && abertasVencidas.length <= 4, d + ': ' + abertasVencidas.length + ' atrasadas');
    assert.ok(e.ocorrencias.every((o) => !o.concluida_em || o.concluida_em <= new Date(Date.parse(d + 'T23:59:59-03:00')).toISOString()), d);
  }
});

await etapa('usuariosDemo e sessão inicial vazia', async () => {
  const usuarios = json(ApiDemo.usuariosDemo());
  assert.deepEqual(usuarios.map((u) => u.email).sort(),
    ['aqs@demo.local', 'balieiro@demo.local', 'chefia@demo.local', 'leticia@demo.local', 'wallace@demo.local']);
  for (const u of usuarios) { temCampos(u, ['email', 'nome', 'papel'], 'usuariosDemo'); }
  assert.equal(usuarios.find((u) => u.email === 'aqs@demo.local').papel, 'administrador');
  assert.equal(usuarios.find((u) => u.email === 'chefia@demo.local').nome, 'Maj Chefia NSP');
  assert.equal(await Api.iniciar(), null);
  assert.equal(await Api.sessaoAtual(), null);
  const cancelar = Api.aoMudarSessao((evento) => eventosSessao.push(evento));
  assert.equal(typeof cancelar, 'function');
  await rejeita(Api.listarOcorrencias({}), /sessão terminou/i, 'sem sessão não lê nada');
  await rejeita(Api.entrar('leticia@demo.local', ''), /Informe/);
  await rejeita(Api.entrar('ninguem@demo.local', 'x'), /incorretos/);
});

async function entrarComo(email) {
  await Api.sair();
  const r = await Api.entrar(email, 'qualquer-senha');
  assert.deepEqual(json(r), { precisaMfa: false });
  Api.invalidarReferencias();
  return json(await Api.meuPerfil());
}

let leticia, chefia, ref, ocsLeticia;

await etapa('Ten Letícia entra; perfil, referências e configurações no formato', async () => {
  leticia = await entrarComo('leticia@demo.local');
  temCampos(leticia, CAMPOS.militar, 'meuPerfil');
  assert.equal(Regras.nomeMilitar(leticia), 'Ten Letícia');
  assert.equal(leticia.papel, 'adjunto');
  await pausa(5);
  assert.ok(eventosSessao.includes('entrou'), 'aoMudarSessao recebeu "entrou"');
  const sessao = json(await Api.sessaoAtual());
  assert.deepEqual(Object.keys(sessao).sort(), ['email', 'usuario_id']);
  assert.equal(sessao.email, 'leticia@demo.local');

  assert.equal(typeof await Api.gerarOcorrencias(), 'number');
  ref = await Api.referencias();
  temCampos(ref, ['setores', 'militares', 'mapaSetores', 'mapaMilitares', 'feriados'], 'referencias');
  assert.equal(ref.setores.length, 2);
  ref.setores.forEach((s) => temCampos(s, CAMPOS.setor, 'setor'));
  assert.equal(ref.militares.length, 5);
  ref.militares.forEach((m) => temCampos(m, CAMPOS.militar, 'militar'));
  assert.equal(ref.feriados[hoje.slice(0, 4) + '-12-25'], true);
  (await Api.listarFeriados()).forEach((f) => temCampos(f, CAMPOS.feriado, 'feriado'));
  ids = Object.fromEntries(json(ref.militares).map((m) => [m.email.split('@')[0], m.id]));

  const config = json(await Api.obterConfiguracoes());
  temCampos(config, ['contatos', 'ultimo_backup'], 'configuracoes');
  temCampos(config.contatos, ['email_institucional', 'responsavel_tecnico', 'telefone', 'observacoes'], 'contatos');
  temCampos(config.ultimo_backup, ['em', 'por_nome'], 'ultimo_backup');
});

let atividades;

await etapa('atividades: as 16 da carga, com responsáveis, ordenadas', async () => {
  atividades = json(await Api.listarAtividades());
  assert.equal(atividades.length, 16);
  atividades.forEach((a) => temCampos(a, CAMPOS.atividade, 'atividade'));
  assert.deepEqual(atividades.map((a) => a.ordem), Array.from({ length: 16 }, (_, i) => i + 1));
  const a14 = atividades[13];
  assert.equal(a14.titulo, 'Apresentar os indicadores mensais');
  assert.deepEqual(a14.responsaveis, [ids.chefia]);
  assert.deepEqual(atividades[11].responsaveis.sort(), [ids.balieiro, ids.leticia].sort());
  assert.ok(atividades.every((a) => a.antecipar_dia_util === true));
  assert.equal(atividades[12].prioridade, 'alta');
  assert.equal(atividades[14].prioridade, 'alta');
});

await etapa('ocorrências (v_ocorrencias): campos, ordenação, atrasadas de cada adjunto', async () => {
  const todas = json(await Api.listarOcorrencias({}));
  assert.ok(todas.length > 100);
  todas.forEach((o) => temCampos(o, CAMPOS.vocorrencia, 'v_ocorrencias'));
  for (let i = 1; i < todas.length; i += 1) { assert.ok(todas[i - 1].data_ref <= todas[i].data_ref, 'ordenadas por data_ref'); }
  const atrasadas = todas.filter((o) => o.atrasada);
  assert.ok(atrasadas.length >= 3 && atrasadas.length <= 4, 'três ou quatro atrasadas: ' + atrasadas.length);
  for (const quem of ['leticia', 'wallace', 'balieiro']) {
    assert.ok(atrasadas.some((o) => o.responsaveis.includes(ids[quem])), 'atrasada de ' + quem);
  }
  const abertas = json(await Api.listarOcorrencias({ somenteAbertas: true }));
  assert.ok(abertas.every((o) => o.status === 'pendente' || o.status === 'em_andamento'));
  const janela = json(await Api.listarOcorrencias({ de: hoje, ate: hoje }));
  assert.ok(janela.length >= 1 && janela.every((o) => o.data_ref === hoje));
  const conf = Regras.conformidade(todas, hoje);
  assert.ok(conf.percentual >= 80 && conf.percentual < 100, 'conformidade realista: ' + conf.percentual);
  const umaAtividade = json(await Api.listarOcorrencias({ atividade_id: atividades[0].id }));
  assert.ok(umaAtividade.length > 30 && umaAtividade.every((o) => o.atividade_id === atividades[0].id));
  ocsLeticia = abertas.filter((o) => o.responsaveis.includes(leticia.id));
  assert.ok(ocsLeticia.length > 0);
});

let ocConcluida, evidenciaEnviada, comentario;

await etapa('Letícia conclui uma ocorrência; carimbos do gatilho', async () => {
  const alvo = ocsLeticia.find((o) => o.status === 'pendente');
  const r = json(await Api.atualizarOcorrencia(alvo.id, { status: 'concluida', observacao: 'Feito pelo teste.' }));
  temCampos(r, CAMPOS.vocorrencia, 'atualizarOcorrencia');
  assert.equal(r.status, 'concluida');
  assert.equal(r.concluida_por, leticia.id);
  assert.equal(r.concluida_por_nome, 'Ten Letícia');
  assert.ok(r.concluida_em && Date.now() - Date.parse(r.concluida_em) < 60000);
  assert.equal(r.atrasada, false);
  ocConcluida = r;
  /* reabrir limpa o carimbo; concluir de novo carimba outra vez */
  const reaberta = json(await Api.atualizarOcorrencia(alvo.id, { status: 'em_andamento' }));
  assert.equal(reaberta.concluida_em, null);
  assert.equal(reaberta.concluida_por, null);
  assert.ok(reaberta.iniciada_em);
  ocConcluida = json(await Api.atualizarOcorrencia(alvo.id, { status: 'concluida' }));
  assert.equal(ocConcluida.concluida_por, leticia.id);
  await rejeita(Api.atualizarOcorrencia(alvo.id, { prazo: '2030-01-01' }), /Apenas a chefia pode alterar o prazo/, 'adjunto não muda prazo');
  /* voltar para pendente limpa o início (gatilho) */
  const iniciada = json(await Api.atualizarOcorrencia(alvo.id, { status: 'em_andamento' }));
  assert.ok(iniciada.iniciada_em && iniciada.concluida_em === null);
  assert.equal(json(await Api.atualizarOcorrencia(alvo.id, { status: 'pendente' })).iniciada_em, null);
  ocConcluida = json(await Api.atualizarOcorrencia(alvo.id, { status: 'concluida' }));
  await rejeita(Api.atualizarOcorrencia(alvo.id, { status: 'nao_se_aplica', justificativa: ' ' }), /justificativa/);
  const deWallace = (await Api.listarOcorrencias({ somenteAbertas: true })).find((o) => !o.responsaveis.includes(leticia.id));
  await rejeita(Api.atualizarOcorrencia(deWallace.id, { status: 'concluida' }), /permissão/);
  await rejeita(Api.excluirOcorrencia(alvo.id), /permissão/);
});

await etapa('Letícia envia, baixa e não consegue enviar arquivo proibido', async () => {
  const arquivo = new File(['conteúdo do relatório'], 'Relatório final.pdf', { type: '' });
  evidenciaEnviada = json(await Api.enviarEvidencia({
    atividade_id: ocConcluida.atividade_id, ocorrencia_id: ocConcluida.id, arquivo, descricao: 'Teste'
  }));
  temCampos(evidenciaEnviada, CAMPOS.evidencia, 'evidencia');
  assert.equal(evidenciaEnviada.mime, 'application/pdf');
  assert.equal(evidenciaEnviada.enviado_por, leticia.id);
  assert.equal(evidenciaEnviada.enviado_por_nome, 'Ten Letícia');
  assert.match(evidenciaEnviada.storage_path,
    new RegExp('^' + ocConcluida.atividade_id + '/' + ocConcluida.id + '/[0-9a-f-]{36}-relatorio-final\\.pdf$'));
  const blob = await Api.baixarEvidencia(evidenciaEnviada);
  assert.equal(await blob.text(), 'conteúdo do relatório');
  assert.equal(blob.type, 'application/pdf');
  const lista = json(await Api.listarEvidencias({ ocorrencia_id: ocConcluida.id }));
  assert.equal(lista.length, 1);
  assert.equal(json(await Api.obterOcorrencia(ocConcluida.id)).qtd_evidencias, 1);
  await rejeita(Api.enviarEvidencia({ atividade_id: ocConcluida.atividade_id, ocorrencia_id: ocConcluida.id,
    arquivo: new File(['x'], 'virus.exe'), descricao: '' }), /não permitido/);
  const atividadeAlheia = atividades.find((a) => a.responsaveis.length === 1 && a.responsaveis[0] === ids.wallace);
  await rejeita(Api.enviarEvidencia({ atividade_id: atividadeAlheia.id, ocorrencia_id: null,
    arquivo: new File(['x'], 'a.pdf'), descricao: '' }), /permissão/);
  /* evidência fictícia: devolve um texto explicando a demonstração */
  const todas = json(await Api.listarEvidencias({}));
  const ficticia = todas.find((e) => e.nome === 'Ata-reuniao-anestesistas.docx');
  assert.ok(ficticia, 'evidência fictícia da carga');
  const textoFicticio = await (await Api.baixarEvidencia(ficticia)).text();
  assert.match(textoFicticio, /DEMONSTRAÇÃO/);
  for (let i = 1; i < todas.length; i += 1) { assert.ok(todas[i - 1].enviado_em >= todas[i].enviado_em, 'mais recentes primeiro'); }
});

await etapa('Letícia comenta; ordem e filtro dos comentários', async () => {
  comentario = json(await Api.comentar({ atividade_id: ocConcluida.atividade_id, ocorrencia_id: ocConcluida.id,
    texto: '  Concluído, chefe.  ' }));
  temCampos(comentario, CAMPOS.comentario, 'comentario');
  assert.equal(comentario.texto, 'Concluído, chefe.');
  assert.equal(comentario.autor_nome, 'Ten Letícia');
  assert.equal(comentario.autor_papel, 'adjunto');
  await rejeita(Api.comentar({ atividade_id: ocConcluida.atividade_id, texto: '   ' }), /Escreva/);
  const lista = json(await Api.listarComentarios({ atividade_id: ocConcluida.atividade_id, ocorrencia_id: ocConcluida.id }));
  assert.equal(lista[lista.length - 1].id, comentario.id);
  for (let i = 1; i < lista.length; i += 1) { assert.ok(lista[i - 1].criado_em <= lista[i].criado_em, 'mais antigos primeiro'); }
});

await etapa('adjunto: não publica aviso, vê só os avisos dele, ciência só a própria', async () => {
  await rejeita(Api.salvarAviso({ titulo: 'Tentativa', mensagem: '', nivel: 'informativo', para_todos: true }),
    /Você não tem permissão para esta ação\./);
  const avisos = json(await Api.listarAvisos({}));
  avisos.forEach((a) => temCampos(a, CAMPOS.aviso, 'aviso'));
  assert.equal(avisos.length, 2, 'o importante é só para Balieiro e Wallace');
  assert.equal(avisos[0].fixado, true, 'fixados primeiro');
  assert.equal(avisos[0].nivel, 'urgente');
  assert.ok(avisos.every((a) => a.ciencias.every((c) => c.militar_id === leticia.id)), 'RLS da ciência');
  assert.equal(avisos.find((a) => a.fixado).ciente_por_mim, true, 'ciente do aviso fixado');
  assert.equal(avisos.find((a) => !a.fixado).ciente_por_mim, false, 'boas-vindas ainda sem a ciência dela');
});

await etapa('adjunto: cria só pontual/sob demanda incluindo a si; não muda responsáveis', async () => {
  const base = { titulo: 'Atividade de teste', descricao: '', setor_id: ref.setores[0].id, prioridade: 'normal',
    antecipar_dia_util: true, exige_evidencia: false, ativa: true };
  await rejeita(Api.salvarAtividade({ ...base, tipo: 'recorrente', periodicidade: 'mensal', dia_mes: 5,
    responsaveis: [leticia.id] }), /Apenas a chefia pode criar atividades recorrentes/);
  await rejeita(Api.salvarAtividade({ ...base, tipo: 'pontual', responsaveis: [ids.wallace] }), /Inclua você mesmo/);
  await rejeita(Api.salvarAtividade({ ...base, tipo: 'pontual', responsaveis: [] }), /ao menos um responsável/);
  await rejeita(Api.salvarAtividade({ ...base, tipo: 'pontual' }), /ao menos um responsável/);
  const id = await Api.salvarAtividade({ ...base, tipo: 'pontual', prazo: '2030-01-10', responsaveis: [leticia.id] });
  assert.equal(typeof id, 'string');
  const criada = json(await Api.listarAtividades()).find((a) => a.id === id);
  assert.equal(criada.ordem, 17);
  assert.equal(criada.criado_por, leticia.id);
  const unica = json(await Api.listarOcorrencias({ atividade_id: id }));
  assert.equal(unica.length, 1, 'pontual cria a ocorrência P');
  assert.equal(unica[0].referencia, 'P');
  assert.equal(unica[0].prazo, '2030-01-10');
  await Api.salvarAtividade({ ...criada, prazo: '2030-02-01' });
  assert.equal(json(await Api.listarOcorrencias({ atividade_id: id }))[0].prazo, '2030-02-01', 'P acompanha o prazo');
  await rejeita(Api.salvarAtividade({ ...criada, responsaveis: [leticia.id, ids.wallace] }),
    /Apenas a chefia pode alterar os responsáveis/);
  await rejeita(Api.salvarAtividade({ ...criada, tipo: 'recorrente', periodicidade: 'mensal', dia_mes: 5 }),
    /transformar uma atividade em recorrente/);
  const deWallace = atividades.find((a) => a.responsaveis[0] === ids.wallace);
  await rejeita(Api.salvarAtividade({ ...deWallace, titulo: 'Mudado' }), /Apenas a chefia ou os responsáveis/);
  /* chave ausente mantém o valor: editar só o título preserva o resto */
  await Api.salvarAtividade({ id, titulo: 'Atividade de teste (editada)' });
  const editada = json(await Api.listarAtividades()).find((a) => a.id === id);
  assert.equal(editada.titulo, 'Atividade de teste (editada)');
  assert.equal(editada.prazo, '2030-02-01');
  assert.deepEqual(editada.responsaveis, [leticia.id]);
  /* deixar de ser pontual apaga a 'P' intocada e não vencida */
  await Api.salvarAtividade({ id, tipo: 'sob_demanda' });
  assert.deepEqual(json(await Api.listarOcorrencias({ atividade_id: id })), []);
  assert.equal(json(await Api.listarAtividades()).find((a) => a.id === id).prazo, null, 'prazo só vale para pontual');
  await rejeita(Api.excluirAtividade(id), /permissão/);
  /* registrar execução sob demanda */
  const incidentes = atividades[15];
  const exec = json(await Api.criarOcorrencia({ atividade_id: incidentes.id, titulo_execucao: 'Incidente teste',
    prazo: null, status: 'concluida', observacao: '' }));
  temCampos(exec, CAMPOS.vocorrencia, 'criarOcorrencia');
  assert.equal(exec.referencia, null);
  assert.equal(exec.concluida_por, leticia.id);
  assert.equal(exec.data_ref, hoje);
  assert.equal(exec.concluida_no_prazo, true);
  await rejeita(Api.criarOcorrencia({ atividade_id: atividades[0].id, titulo_execucao: 'x', status: 'concluida' }),
    /permissão/, 'recorrente não aceita execução avulsa de adjunto');
  await rejeita(Api.listarAuditoria({}), /permissão/);
  await rejeita(Api.exportarTudo(), /permissão/);
  await rejeita(Api.salvarMilitar({ posto: 'Ten', nome_guerra: 'Intruso', papel: 'chefia' }), /permissão/);
});

await etapa('Letícia sai; chefia entra e recebe a notificação do comentário', async () => {
  await Api.sair();
  await pausa(5);
  assert.ok(eventosSessao.includes('saiu'));
  assert.equal(await Api.sessaoAtual(), null);
  chefia = await entrarComo('chefia@demo.local');
  assert.equal(chefia.papel, 'chefia');
  const notificacoes = json(await Api.listarNotificacoes({}));
  notificacoes.forEach((n) => temCampos(n, CAMPOS.notificacao, 'notificacao'));
  assert.ok(notificacoes.length <= 30);
  const doComentario = notificacoes.find((n) => n.tipo === 'comentario' && n.ocorrencia_id === ocConcluida.id);
  assert.ok(doComentario, 'gatilho de comentário notifica a chefia');
  assert.equal(doComentario.titulo, 'Novo comentário');
  assert.match(doComentario.mensagem, /^Ten Letícia em ".+": Concluído, chefe\.$/);
  assert.equal(doComentario.lida, false);
  const naoLidas = await Api.contarNaoLidas();
  assert.equal(typeof naoLidas, 'number');
  await Api.marcarNotificacoesLidas([doComentario.id]);
  assert.equal(await Api.contarNaoLidas(), naoLidas - 1);
  for (let i = 1; i < notificacoes.length; i += 1) { assert.ok(notificacoes[i - 1].criado_em >= notificacoes[i].criado_em); }
  assert.equal(json(await Api.listarNotificacoes({ limite: 2 })).length, 2);
});

let avisoNovo;

await etapa('chefia publica aviso para Ten Wallace ⇒ notificação e ciência', async () => {
  avisoNovo = json(await Api.salvarAviso({ titulo: 'Entregar auditoria', mensagem: 'Até sexta.', nivel: 'importante',
    para_todos: false, destinatarios: [ids.wallace], prazo: null, atividade_id: null, fixado: false, expira_em: null }));
  temCampos(avisoNovo, CAMPOS.aviso, 'salvarAviso');
  assert.deepEqual(avisoNovo.destinatarios, [ids.wallace]);
  assert.equal(avisoNovo.criado_por_nome, 'Maj Chefia NSP');
  assert.equal(avisoNovo.ciente_por_mim, false);
  await rejeita(Api.salvarAviso({ titulo: 'Sem destino', para_todos: false, destinatarios: [] }), /destinatário/);

  await entrarComo('wallace@demo.local');
  const notif = json(await Api.listarNotificacoes({})).find((n) => n.aviso_id === avisoNovo.id);
  assert.ok(notif, 'Wallace foi notificado');
  assert.equal(notif.tipo, 'aviso');
  const visiveis = json(await Api.listarAvisos({}));
  assert.ok(visiveis.some((a) => a.id === avisoNovo.id));
  await Api.darCiencia(avisoNovo.id);
  await Api.darCiencia(avisoNovo.id); /* idempotente */
  const depois = json(await Api.listarAvisos({})).find((a) => a.id === avisoNovo.id);
  assert.equal(depois.ciente_por_mim, true);
  assert.equal(depois.ciencias.length, 1);

  await entrarComo('balieiro@demo.local');
  assert.ok(!json(await Api.listarAvisos({})).some((a) => a.id === avisoNovo.id), 'Balieiro não vê');
  assert.ok(!json(await Api.listarNotificacoes({})).some((n) => n.aviso_id === avisoNovo.id));
  await rejeita(Api.darCiencia(avisoNovo.id), /não encontrado/);

  await entrarComo('chefia@demo.local');
  const visto = json(await Api.listarAvisos({})).find((a) => a.id === avisoNovo.id);
  assert.deepEqual(visto.ciencias.map((c) => c.militar_id), [ids.wallace], 'gestor vê todas as ciências');
  /* aviso dirigido que passa a ser para todos avisa quem ainda não sabia (uma vez só) */
  const dirigido = json(await Api.salvarAviso({ titulo: 'Só Letícia', mensagem: 'x', para_todos: false,
    destinatarios: [ids.leticia] }));
  await Api.salvarAviso({ ...dirigido, para_todos: true });
  await Api.salvarAviso({ ...dirigido, para_todos: true, titulo: 'Só Letícia (corrigido)' });
  await entrarComo('balieiro@demo.local');
  assert.equal(json(await Api.listarNotificacoes({ limite: 100 })).filter((n) => n.aviso_id === dirigido.id).length, 1);
  await entrarComo('leticia@demo.local');
  const daLeticia = json(await Api.listarNotificacoes({ limite: 100 })).filter((n) => n.aviso_id === dirigido.id);
  assert.equal(daLeticia.length, 1, 'sem duplicar para quem já tinha sido avisada');
  assert.equal(daLeticia[0].titulo, 'Novo aviso: Só Letícia');
  await entrarComo('chefia@demo.local');
  await Api.excluirAviso(dirigido.id);
  const expirado = json(await Api.salvarAviso({ titulo: 'Velho', mensagem: '', nivel: 'informativo', para_todos: true,
    expira_em: '2020-01-01' }));
  assert.ok(!json(await Api.listarAvisos({})).some((a) => a.id === expirado.id), 'expirado some');
  assert.ok(json(await Api.listarAvisos({ incluirExpirados: true })).some((a) => a.id === expirado.id));
  await Api.excluirAviso(expirado.id);
});

await etapa('chefia não derruba a conta institucional; ninguém exclui a si mesmo', async () => {
  await rejeita(Api.adminUsuario('excluir', ids.aqs), /administrador/);
  await rejeita(Api.excluirMilitar(ids.aqs), /administrador/);
  await rejeita(Api.adminUsuario('desativar', ids.aqs), /administrador/);
  await rejeita(Api.adminUsuario('redefinir_senha', ids.aqs), /administrador/);
  const aqs = json(await Api.listarMilitares()).find((m) => m.id === ids.aqs);
  await rejeita(Api.salvarMilitar({ ...aqs, nome_guerra: 'Outro nome' }), /administrador/);
  const balieiro = json(await Api.listarMilitares()).find((m) => m.id === ids.balieiro);
  await rejeita(Api.salvarMilitar({ ...balieiro, papel: 'administrador' }), /administrador/,
    'chefia não promove a administrador');
  await rejeita(Api.adminUsuario('excluir', chefia.id), /próprio/);
  await rejeita(Api.adminUsuario('desativar', chefia.id), /próprio/);
  await rejeita(Api.salvarMilitar({ ...chefia, ativo: false }), /próprio/);
  await rejeita(Api.adminUsuario('qualquer', ids.balieiro), /desconhecida/);
  const ainda = json(await Api.listarMilitares()).find((m) => m.id === ids.aqs);
  assert.equal(ainda.ativo, true);
});

let novoChefe, senhaTemporaria;

await etapa('chefia cadastra militar, cria acesso, passa a chefia e vira adjunto', async () => {
  novoChefe = json(await Api.salvarMilitar({ posto: 'Cap', nome_guerra: 'Novo Chefe', nome_completo: '',
    email: '  Novo.Chefe@Demo.Local ', setor_id: ref.setores[0].id, papel: 'adjunto', ativo: true }));
  temCampos(novoChefe, CAMPOS.militar, 'salvarMilitar');
  assert.equal(novoChefe.email, 'novo.chefe@demo.local', 'e-mail sempre minúsculo');
  assert.equal(novoChefe.usuario_id, null);
  assert.equal(novoChefe.deve_trocar_senha, true);
  await rejeita(Api.salvarMilitar({ posto: 'Ten', nome_guerra: 'Repetido', email: 'novo.chefe@demo.local' }), /e-mail/);
  const acesso = json(await Api.adminUsuario('criar', novoChefe.id));
  senhaTemporaria = acesso.senha_temporaria;
  assert.equal(typeof senhaTemporaria, 'string');
  assert.equal(Regras.validarSenha(senhaTemporaria), null, 'senha temporária válida');
  /* Mesmo formato da Edge Function: 14 caracteres, maiúscula, minúscula,
     número e um símbolo; e a ação fica na auditoria sem a senha. */
  assert.ok(/^(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9])(?=.*[@#%+=])[A-Za-z0-9@#%+=]{14}$/.test(senhaTemporaria), 'formato da senha');
  assert.equal(acesso.email, 'novo.chefe@demo.local');
  await rejeita(Api.adminUsuario('criar', novoChefe.id), /já tem acesso/);
  const comAcesso = json(await Api.listarMilitares()).find((m) => m.id === novoChefe.id);
  assert.ok(comAcesso.usuario_id);
  await rejeita(Api.salvarMilitar({ ...comAcesso, email: 'outro@demo.local' }), /Alterar e-mail/);
  /* Igual à Edge Function: devolve o e-mail gravado. */
  assert.deepEqual(json(await Api.adminUsuario('alterar_email', novoChefe.id, { email: 'Novo.Chefe2@demo.local' })),
    { email: 'novo.chefe2@demo.local' });
  await rejeita(Api.adminUsuario('alterar_email', novoChefe.id, { email: 'novo.chefe2@demo.local' }), /igual ao atual/);
  assert.equal(json(await Api.listarMilitares()).find((m) => m.id === novoChefe.id).email, 'novo.chefe2@demo.local');
  await rejeita(Api.adminUsuario('alterar_email', novoChefe.id, { email: 'leticia@demo.local' }), /em uso/);
  assert.equal(typeof json(await Api.adminUsuario('redefinir_senha', novoChefe.id)).senha_temporaria, 'string');

  await rejeita(Api.transferirChefia({ de: chefia.id, para: ids.aqs }), /não assume a chefia/);
  await rejeita(Api.transferirChefia({ de: ids.leticia, para: novoChefe.id }), /não está com o papel de chefia/);
  await rejeita(Api.transferirChefia({ de: chefia.id, para: chefia.id }), /militares diferentes/);
  await rejeita(Api.transferirChefia({ de: chefia.id, para: novoChefe.id, papel_anterior: 'administrador' }), /adjunto/);
  await Api.transferirChefia({ de: chefia.id, para: novoChefe.id, papel_anterior: 'adjunto', transferir_atividades: true });
  const militares = json(await Api.listarMilitares());
  assert.equal(militares.find((m) => m.id === novoChefe.id).papel, 'chefia');
  assert.equal(militares.find((m) => m.id === chefia.id).papel, 'adjunto');
  const a14 = json(await Api.listarAtividades())[13];
  assert.deepEqual(a14.responsaveis, [novoChefe.id], 'responsabilidades passaram ao novo chefe');
  const perfil = json(await Api.meuPerfil());
  assert.equal(perfil.papel, 'adjunto');
  await rejeita(Api.salvarAviso({ titulo: 'Já não posso', para_todos: true }), /permissão/, 'rebaixada a adjunto');
  await rejeita(Api.transferirChefia({ de: novoChefe.id, para: chefia.id }), /passagem de chefia/);
});

await etapa('novo chefe entra com troca de senha obrigatória e recebe atribuição', async () => {
  await Api.sair();
  await rejeita(Api.entrar('novo.chefe@demo.local', 'x'), /incorretos/, 'e-mail antigo não vale mais');
  const r = json(await Api.entrar('novo.chefe2@demo.local', senhaTemporaria));
  assert.equal(r.precisaMfa, false);
  const perfil = json(await Api.meuPerfil());
  assert.equal(perfil.deve_trocar_senha, true);
  await rejeita(Api.trocarSenha('curta1'), /10 caracteres/);
  await Api.trocarSenha('NovaSenha2026');
  assert.equal(json(await Api.meuPerfil()).deve_trocar_senha, false);
  const notif = json(await Api.listarNotificacoes({}));
  assert.ok(notif.some((n) => n.tipo === 'atribuicao' && /indicadores mensais/.test(n.mensagem)));
  assert.ok(Regras.eGestor(perfil));
  const usuarios = json(ApiDemo.usuariosDemo());
  assert.ok(usuarios.some((u) => u.email === 'novo.chefe2@demo.local' && u.papel === 'chefia'));
});

await etapa('chefia edita a agenda de uma recorrente ⇒ ocorrências futuras regeneradas', async () => {
  const cgc = json(await Api.listarAtividades())[14];
  const antes = json(await Api.listarOcorrencias({ atividade_id: cgc.id }));
  const futurasAntes = antes.filter((o) => o.prazo >= hoje && o.status === 'pendente');
  assert.ok(futurasAntes.length >= 1);
  const nova = { ...cgc, dia_mes: 10 };
  await Api.salvarAtividade(nova);
  const depois = json(await Api.listarOcorrencias({ atividade_id: cgc.id }));
  for (const o of futurasAntes) {
    assert.ok(!depois.some((x) => x.id === o.id), 'futura intocada foi apagada: ' + o.referencia);
  }
  /* As regeneradas são exatamente as da nova regra dentro da janela de §4,
     menos os períodos que já tinham ocorrência mantida. */
  const feriados = (await Api.referencias()).feriados;
  const mantidas = new Set(antes.filter((o) => !futurasAntes.some((f) => f.id === o.id)).map((o) => o.referencia));
  const janela = ctx.Recorrencia.janelaGeracao(nova, hoje);
  const esperadas = json(ctx.Recorrencia.datas(nova, janela.de, janela.ate, feriados))
    .filter((d) => !mantidas.has(d.referencia));
  const novas = depois.filter((o) => !antes.some((x) => x.id === o.id))
    .map((o) => ({ referencia: o.referencia, prazo: o.prazo }));
  assert.deepEqual(novas, esperadas);
  assert.ok(antes.filter((o) => o.prazo < hoje).every((o) => depois.some((x) => x.id === o.id && x.prazo === o.prazo)),
    'passadas intocadas');
  await rejeita(Api.salvarAtividade({ ...cgc, dia_mes: 40 }), /1 a 31/);
  await rejeita(Api.salvarAtividade({ ...cgc, responsaveis: [...cgc.responsaveis, ids.aqs] }), /não recebe missões/);
  const temporario = json(await Api.salvarMilitar({ posto: 'Sgt', nome_guerra: 'Temporário', setor_id: ref.setores[0].id }));
  await Api.adminUsuario('desativar', temporario.id);
  await rejeita(Api.salvarAtividade({ ...cgc, responsaveis: [...cgc.responsaveis, temporario.id] }), /desativado/);
  await Api.excluirMilitar(temporario.id);
  await rejeita(Api.salvarAtividade({ ...cgc, titulo: 'ab' }), /entre 3 e 200/);
  await rejeita(Api.salvarAtividade({ ...cgc, periodicidade: 'trimestral', mes_inicio: null }), /mês de início/);
  /* arquivar apaga as futuras intocadas, encerra como "não se aplica" o
     que estava em aberto (com a justificativa) e não gera mais nada */
  const abertasAntes = json(await Api.listarOcorrencias({ atividade_id: cgc.id }))
    .filter((o) => o.status === 'pendente' || o.status === 'em_andamento');
  await Api.salvarAtividade({ ...nova, ativa: false });
  assert.equal(await Api.gerarOcorrencias(), 0);
  const arquivada = json(await Api.listarOcorrencias({ atividade_id: cgc.id }));
  assert.ok(!arquivada.some((o) => o.prazo >= hoje && o.status === 'pendente' && o.qtd_evidencias === 0 && o.qtd_comentarios === 0));
  assert.ok(!arquivada.some((o) => o.status === 'pendente' || o.status === 'em_andamento'), 'nada fica em aberto');
  const encerradas = arquivada.filter((o) => abertasAntes.some((a) => a.id === o.id));
  assert.ok(encerradas.every((o) => o.status === 'nao_se_aplica' && /^Atividade arquivada em \d\d\/\d\d\/\d{4} por /.test(o.justificativa)),
    'as que estavam em aberto viram "não se aplica" com a justificativa do arquivamento');
  await Api.salvarAtividade({ ...nova, ativa: true });
});

await etapa('administrador exclui um adjunto: histórico mantém o nome', async () => {
  await entrarComo('aqs@demo.local');
  const comentariosAntes = json(await Api.listarComentarios({ atividade_id: atividades[5].id }));
  const deWallace = comentariosAntes.filter((c) => c.autor_id === ids.wallace);
  assert.ok(deWallace.length >= 1, 'Wallace tem comentário na carga');
  await Api.excluirMilitar(ids.wallace);
  const militares = json(await Api.listarMilitares());
  assert.ok(!militares.some((m) => m.id === ids.wallace));
  const comentariosDepois = json(await Api.listarComentarios({ atividade_id: atividades[5].id }));
  for (const c of deWallace) {
    const agora = comentariosDepois.find((x) => x.id === c.id);
    assert.ok(agora, 'comentário continua');
    assert.equal(agora.autor_id, null);
    assert.equal(agora.autor_nome, 'Ten Wallace');
  }
  const evidencias = json(await Api.listarEvidencias({ atividade_id: atividades[4].id }));
  assert.ok(evidencias.some((e) => e.enviado_por === null && e.enviado_por_nome === 'Ten Wallace'));
  const concluidas = json(await Api.listarOcorrencias({ atividade_id: atividades[4].id }))
    .filter((o) => o.status === 'concluida');
  assert.ok(concluidas.length && concluidas.every((o) => o.concluida_por === null && o.concluida_por_nome === 'Ten Wallace'));
  const ativs = json(await Api.listarAtividades());
  assert.deepEqual(ativs[4].responsaveis, []);
  assert.deepEqual(ativs[5].responsaveis, []);
  const aviso = json(await Api.listarAvisos({})).find((a) => a.id === avisoNovo.id);
  assert.deepEqual(aviso.destinatarios, [], 'destinatário removido');
  assert.deepEqual(aviso.ciencias, [], 'ciência removida');
  await rejeita(Api.entrar('wallace@demo.local', 'x'), /incorretos/, 'acesso apagado');
});

await etapa('alertas de continuidade a partir da API', async () => {
  const [militares, ativs, feriados, config] = await Promise.all([Api.listarMilitares(), Api.listarAtividades(),
    Api.listarFeriados(), Api.obterConfiguracoes()]);
  const perfil = json(await Api.meuPerfil());
  const alertas = json(Regras.alertasContinuidade({ militar: perfil, militares, atividades: ativs, feriados,
    configuracoes: config, hoje }));
  assert.ok(alertas.some((a) => /2 atividades sem responsável/.test(a.titulo)), 'atividades órfãs');
  assert.ok(alertas.some((a) => /Cópia de segurança desatualizada/.test(a.titulo)), 'backup de 40 dias');
  assert.ok(!alertas.some((a) => a.nivel === 'urgente'), 'há administrador');
});

await etapa('exportarTudo grava ultimo_backup; auditoria no formato', async () => {
  const copia = json(await Api.exportarTudo());
  temCampos(copia, ['gerado_em', 'gerado_por', 'tabelas'], 'exportarTudo');
  for (const t of ['setores', 'militares', 'atividades', 'atividade_responsaveis', 'ocorrencias', 'evidencias',
    'comentarios', 'avisos', 'avisos_destinatarios', 'avisos_ciencia', 'feriados', 'configuracoes', 'auditoria']) {
    assert.ok(Array.isArray(copia.tabelas[t]), 'tabela ' + t);
  }
  assert.ok(!('usuarios' in copia.tabelas), 'nada do Auth na exportação');
  const config = json(await Api.obterConfiguracoes());
  assert.equal(Regras.dataBelem(config.ultimo_backup.em), hoje);
  assert.equal(config.ultimo_backup.por_nome, 'AQS — conta institucional');
  const auditoria = json(await Api.listarAuditoria({ limite: 10 }));
  assert.equal(auditoria.length, 10);
  auditoria.forEach((r) => temCampos(r, CAMPOS.auditoria, 'auditoria'));
  for (let i = 1; i < auditoria.length; i += 1) { assert.ok(auditoria[i - 1].id > auditoria[i].id); }
  const exclusao = json(await Api.listarAuditoria({ tabela: 'militares' })).find((r) => r.operacao === 'DELETE' && r.registro_id === ids.wallace);
  assert.ok(exclusao && exclusao.antes.nome_guerra === 'Wallace' && exclusao.militar_nome === 'AQS — conta institucional');
  /* Ações de acesso: linha 'ADMIN:<ação>' em auth.users, como a Edge Function — sem a senha. */
  const acessos = json(await Api.listarAuditoria({ tabela: 'auth.users', limite: 500 }));
  const criacao = acessos.find((r) => r.operacao === 'ADMIN:criar' && r.registro_id === novoChefe.id);
  assert.ok(criacao && criacao.depois.acao === 'ADMIN:criar' && criacao.depois.deve_trocar_senha === true, 'ADMIN:criar auditado');
  assert.ok(!JSON.stringify(acessos).includes(senhaTemporaria), 'a senha temporária nunca vai para a auditoria');
  assert.ok(acessos.some((r) => r.operacao === 'ADMIN:excluir' && r.registro_id === ids.wallace), 'ADMIN:excluir auditado');
});

await etapa('trava anti-bloqueio', async () => {
  /* administrador desativa o novo chefe e a antiga chefia (já adjunta): sobra só ele */
  await Api.adminUsuario('desativar', novoChefe.id);
  const eu = json(await Api.meuPerfil());
  await rejeita(Api.salvarMilitar({ ...eu, papel: 'adjunto' }), /É preciso manter ao menos uma conta de chefia ou administrador ativa e com acesso\./);
  await rejeita(Api.adminUsuario('excluir', eu.id), /próprio/);
  const aindaAdmin = json(await Api.meuPerfil());
  assert.equal(aindaAdmin.papel, 'administrador', 'nada mudou depois do erro');
  /* transferir a chefia para quem não tem acesso e rebaixar... */
  await Api.adminUsuario('reativar', novoChefe.id);
  await Api.transferirChefia({ de: null, para: ids.balieiro, papel_anterior: 'adjunto' });
  const militares = json(await Api.listarMilitares());
  assert.equal(militares.find((m) => m.id === ids.balieiro).papel, 'chefia');
  assert.equal(militares.find((m) => m.id === novoChefe.id).papel, 'chefia', 'de nulo não rebaixa ninguém');
  /* a chefia (com acesso) pode ser desativada porque o administrador fica */
  await Api.adminUsuario('desativar', novoChefe.id);
  /* setor em uso não pode ser excluído */
  await rejeita(Api.excluirSetor(ref.setores[0].id), /vinculados/);
});

await etapa('segundo fator simulado', async () => {
  await entrarComo('leticia@demo.local');
  assert.deepEqual(json(await Api.mfaFatores()), []);
  const cadastro = json(await Api.mfaIniciarCadastro());
  temCampos(cadastro, ['fator_id', 'qr_code', 'segredo'], 'mfaIniciarCadastro');
  assert.match(cadastro.qr_code, /^data:image\/svg\+xml/);
  await rejeita(Api.mfaConfirmarCadastro(cadastro.fator_id, '12345'), /Código inválido/);
  await Api.mfaConfirmarCadastro(cadastro.fator_id, '123456');
  const fatores = json(await Api.mfaFatores());
  assert.equal(fatores.length, 1);
  temCampos(fatores[0], ['id', 'status', 'criado_em'], 'mfaFatores');
  assert.equal(fatores[0].status, 'verified');
  await Api.sair();
  assert.deepEqual(json(await Api.entrar('leticia@demo.local', 'x')), { precisaMfa: true });
  assert.equal(await Api.sessaoAtual(), null, 'sem sessão antes do código');
  await rejeita(Api.meuPerfil(), /sessão/i);
  await rejeita(Api.verificarMfa('abc'), /Código inválido/);
  await Api.verificarMfa('654321');
  assert.equal(json(await Api.meuPerfil()).id, leticia.id);
  await Api.mfaRemover(fatores[0].id);
  assert.deepEqual(json(await Api.mfaFatores()), []);
});

await etapa('estado persiste no sessionStorage e sobrevive a um recarregamento', async () => {
  const salvo = armazenamento.getItem('aqs_demo_estado');
  assert.ok(salvo && JSON.parse(salvo).militares.every((m) => m.id !== ids.wallace));
  const ctx2 = montarDemo(armazenamento);
  ctx2.ApiDemo.definirAtraso(0);
  const sessao = json(await ctx2.Api.iniciar());
  assert.equal(sessao.email, 'leticia@demo.local', 'sessão restaurada');
  const militares = json(await ctx2.Api.listarMilitares());
  assert.ok(!militares.some((m) => m.id === ids.wallace));
  /* arquivo enviado não sobrevive ao recarregamento: o download explica */
  const ev = json(await ctx2.Api.listarEvidencias({})).find((e) => e.id === evidenciaEnviada.id);
  const texto = await (await ctx2.Api.baixarEvidencia(ev)).text();
  assert.match(texto, /recarregada/);
});

await etapa('sessionStorage indisponível: segue só na memória', async () => {
  const quebrado = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); },
    removeItem() { throw new Error('bloqueado'); } };
  const ctx3 = montarDemo(quebrado);
  ctx3.ApiDemo.definirAtraso(0);
  assert.equal(await ctx3.Api.iniciar(), null);
  await ctx3.Api.entrar('balieiro@demo.local', 'x');
  assert.equal(json(await ctx3.Api.meuPerfil()).nome_guerra, 'Balieiro');
  assert.equal((await ctx3.Api.listarAtividades()).length, 16);
});

await etapa('reiniciar restaura o estado inicial e encerra a sessão', async () => {
  await ApiDemo.reiniciar();
  assert.equal(await Api.sessaoAtual(), null);
  await entrarComo('chefia@demo.local');
  const militares = json(await Api.listarMilitares());
  assert.equal(militares.length, 5);
  assert.ok(militares.some((m) => m.id === ids.wallace));
  assert.equal(militares.find((m) => m.id === chefia.id).papel, 'chefia');
  assert.equal(await Api.gerarOcorrencias(), 0, 'carga já está completa');
  const depois = await Api.gerarOcorrencias();
  assert.equal(depois, 0, 'idempotente');
});

await etapa('atraso artificial de ~120 ms', async () => {
  ApiDemo.definirAtraso(120);
  const inicio = Date.now();
  await Api.listarSetores();
  assert.ok(Date.now() - inicio >= 100);
  assert.equal(typeof Api.assinarMudancas(() => {}), 'function');
});

/* ---------- resultado ---------- */

for (const f of falhas) {
  console.error('✗ ' + f.nome + '\n    ' + String(f.erro && f.erro.stack || f.erro).split('\n').slice(0, 8).join('\n    '));
}
console.log((falhas.length ? '✗' : '✓') + ' contrato-api.mjs: ' + aprovados + ' etapas aprovadas, ' + falhas.length + ' com falha');
process.exitCode = falhas.length ? 1 : 0;
