#!/usr/bin/env node
/* =========================================================================
   HABE SINAN — baixa as fichas oficiais para o acervo local (pasta fichas/)
   -------------------------------------------------------------------------
   Lê os endereços declarados em assets/js/dados-fichas.js e grava cada PDF
   com o nome esperado pelo sistema. Fichas sem link cadastrado são listadas
   ao final, para busca manual no portal do Sinan.

   Uso:
       node scripts/baixar-fichas.js              baixa o que estiver faltando
       node scripts/baixar-fichas.js --forcar     rebaixa tudo
       node scripts/baixar-fichas.js --listar     só mostra a situação atual

   Requer apenas o Node.js (versão 18 ou superior) e acesso à internet.
   Rode a partir da RAIZ do projeto.
   ========================================================================= */

'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const CATALOGO = path.join(RAIZ, 'assets', 'js', 'dados-fichas.js');
const PASTA = path.join(RAIZ, 'fichas');

const forcar = process.argv.includes('--forcar');
const apenasListar = process.argv.includes('--listar');

/* ---------- carrega o catálogo ---------- */

if (!fs.existsSync(CATALOGO)) {
  console.error('Não encontrei ' + CATALOGO + '. Rode este script a partir da raiz do projeto.');
  process.exit(1);
}

const contexto = {};
new Function('globalThis', fs.readFileSync(CATALOGO, 'utf8') +
             '\nglobalThis.__catalogo = HABE_CATALOGO;').call(contexto, contexto);
const catalogo = contexto.__catalogo;

/* Uma mesma ficha pode servir a vários agravos (ex.: Dengue e Chikungunya). */
const arquivos = new Map();
catalogo.fichas.forEach(function (ficha) {
  const nome = path.basename(ficha.arquivo);
  if (!arquivos.has(nome)) {
    arquivos.set(nome, { nome: nome, url: ficha.urlOficial, agravos: [], verificada: ficha.urlVerificada });
  }
  const registro = arquivos.get(nome);
  registro.agravos.push(ficha.nome);
  if (!registro.url && ficha.urlOficial) { registro.url = ficha.urlOficial; }
});

/* ---------- relatório de situação ---------- */

function tamanhoLocal(nome) {
  try { return fs.statSync(path.join(PASTA, nome)).size; } catch (e) { return null; }
}

function situacao() {
  const presentes = [];
  const faltando = [];
  const semLink = [];

  arquivos.forEach(function (item) {
    const tamanho = tamanhoLocal(item.nome);
    if (tamanho !== null && tamanho > 1024) { presentes.push(item); }
    else if (item.url) { faltando.push(item); }
    else { semLink.push(item); }
  });

  return { presentes: presentes, faltando: faltando, semLink: semLink };
}

function imprimirSituacao() {
  const s = situacao();
  console.log('\nAcervo local (pasta fichas/)');
  console.log('  presentes .......... ' + s.presentes.length);
  console.log('  com link, ausentes . ' + s.faltando.length);
  console.log('  sem link cadastrado  ' + s.semLink.length);
  console.log('  total de arquivos .. ' + arquivos.size +
              ' para ' + catalogo.fichas.length + ' agravos\n');

  if (s.semLink.length) {
    console.log('Fichas que precisam ser baixadas manualmente em ' + catalogo.revisao.portalSinan + ':');
    s.semLink.sort((a, b) => a.nome.localeCompare(b.nome)).forEach(function (item) {
      console.log('  ' + item.nome.padEnd(42) + item.agravos.join('; '));
    });
    console.log('\nSalve cada arquivo na pasta fichas/ com exatamente o nome indicado acima.\n');
  }
}

/* ---------- download ---------- */

async function baixar(item) {
  const destino = path.join(PASTA, item.nome);
  const resposta = await fetch(item.url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HABE-SINAN/1.0)' }
  });

  if (!resposta.ok) {
    throw new Error('HTTP ' + resposta.status);
  }

  const tipo = resposta.headers.get('content-type') || '';
  const dados = Buffer.from(await resposta.arrayBuffer());

  if (dados.length < 1024) { throw new Error('arquivo muito pequeno (' + dados.length + ' bytes)'); }
  if (dados.slice(0, 4).toString() !== '%PDF' && tipo.indexOf('pdf') < 0) {
    throw new Error('o servidor não devolveu um PDF (content-type: ' + tipo + ')');
  }

  fs.writeFileSync(destino, dados);
  return dados.length;
}

async function principal() {
  if (!fs.existsSync(PASTA)) { fs.mkdirSync(PASTA, { recursive: true }); }

  if (apenasListar) { imprimirSituacao(); return; }

  const alvos = [];
  arquivos.forEach(function (item) {
    if (!item.url) { return; }
    const tamanho = tamanhoLocal(item.nome);
    if (forcar || tamanho === null || tamanho <= 1024) { alvos.push(item); }
  });

  if (alvos.length === 0) {
    console.log('Nada a baixar: todas as fichas com link cadastrado já estão no acervo.');
  } else {
    console.log('Baixando ' + alvos.length + ' ficha(s)…\n');
    let sucessos = 0;
    for (const item of alvos) {
      process.stdout.write('  ' + item.nome.padEnd(42));
      try {
        const bytes = await baixar(item);
        console.log('OK (' + Math.round(bytes / 1024) + ' KB)');
        sucessos++;
      } catch (erro) {
        console.log('FALHOU — ' + erro.message);
      }
    }
    console.log('\n' + sucessos + ' de ' + alvos.length + ' ficha(s) baixadas.');
  }

  imprimirSituacao();
}

principal().catch(function (erro) {
  console.error('\nErro inesperado: ' + erro.message);
  process.exit(1);
});
