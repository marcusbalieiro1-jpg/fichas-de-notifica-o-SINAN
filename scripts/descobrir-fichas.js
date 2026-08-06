#!/usr/bin/env node
/* =========================================================================
   HABE SINAN — descobre os endereços oficiais das fichas no portal do Sinan
   -------------------------------------------------------------------------
   Varre o portal do Ministério da Saúde, recolhe todos os PDFs encontrados e
   PROPÕE, para cada agravo do catálogo, qual arquivo corresponde. O casamento
   é por semelhança entre o nome do agravo (mais os sinônimos) e o endereço e
   o texto do link.

   Deliberadamente NÃO grava nada por conta própria: entregar ao médico a
   ficha errada é pior do que não entregar ficha nenhuma. O script produz um
   relatório para conferência humana; a gravação só acontece com --aplicar,
   e mesmo assim apenas nas propostas de confiança alta.

   Uso, a partir da raiz do projeto:
     node scripts/descobrir-fichas.js                 varre e gera o relatório
     node scripts/descobrir-fichas.js --aplicar       grava as de confiança alta
     node scripts/descobrir-fichas.js --fonte <url>   usa outra origem (teste)
     node scripts/descobrir-fichas.js --autoteste     confere o casamento

   Requer acesso a portalsinan.saude.gov.br. Se a requisição direta for
   recusada, o script tenta de novo com o Chromium (Playwright), que costuma
   passar onde o cliente HTTP simples é barrado.
   ========================================================================= */

'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const CATALOGO = path.join(RAIZ, 'assets', 'js', 'dados-fichas.js');
const RELATORIO = path.join(RAIZ, 'fichas', 'PROPOSTAS-DE-LINKS.md');

const FONTES_PADRAO = [
  'https://portalsinan.saude.gov.br/notificacoes',
  'https://portalsinan.saude.gov.br/doencas-e-agravos'
];

const CONFIANCA_ALTA = 0.62;   /* a partir daqui --aplicar grava */
const CONFIANCA_MINIMA = 0.30; /* abaixo disso nem entra no relatório */

/* ==================== texto ==================== */

function normalizar(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_\-+.%]/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Palavras que aparecem em quase toda ficha e não ajudam a distinguir. */
const VAZIAS = new Set([
  'ficha', 'fichas', 'de', 'do', 'da', 'dos', 'das', 'e', 'ou', 'a', 'o', 'em',
  'notificacao', 'investigacao', 'individual', 'agravos', 'agravo', 'documentos',
  'images', 'portalsinan', 'saude', 'gov', 'br', 'pdf', 'sinan', 'net', 'final',
  'v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'novo', 'nova', 'https', 'http', 'www',
  'para', 'com', 'sem', 'por', 'ao', 'as', 'os', 'no', 'na'
]);

function palavras(texto) {
  return normalizar(texto).split(' ').filter(function (p) {
    return p.length >= 3 && !VAZIAS.has(p);
  });
}

/* Semelhança entre o agravo e um candidato, entre 0 e 1.
   Pesa mais o endereço do arquivo do que o texto do link: nomes de arquivo
   no portal costumam ser mais fiéis ao agravo do que o rótulo da página. */
function pontuar(ficha, candidato) {
  const alvoUrl = new Set(palavras(decodeURIComponent(candidato.url)));
  const alvoTexto = new Set(palavras(candidato.texto));

  const doNome = palavras(ficha.nome);
  const dosSinonimos = palavras((ficha.sinonimos || []).join(' '));

  if (doNome.length === 0) { return 0; }

  function cobertura(termos, conjunto) {
    if (termos.length === 0) { return 0; }
    let achados = 0;
    termos.forEach(function (termo) {
      for (const alvo of conjunto) {
        /* prefixo de 5 letras absorve plural e flexão (meningite/meningites) */
        if (alvo === termo ||
            (termo.length >= 5 && alvo.indexOf(termo.slice(0, 5)) === 0) ||
            (alvo.length >= 5 && termo.indexOf(alvo.slice(0, 5)) === 0)) {
          achados++;
          return;
        }
      }
    });
    return achados / termos.length;
  }

  const nomeNaUrl = cobertura(doNome, alvoUrl);
  const nomeNoTexto = cobertura(doNome, alvoTexto);
  const sinonimoNaUrl = cobertura(dosSinonimos, alvoUrl);

  let nota = nomeNaUrl * 0.60 + nomeNoTexto * 0.30 + sinonimoNaUrl * 0.10;

  /* Bônus quando o endereço é claramente de ficha, e não de manual,
     dicionário de dados ou instrutivo. */
  const url = normalizar(candidato.url);
  if (/\bficha\b/.test(url)) { nota += 0.06; }
  if (/dic dados|instrucional|instr|manual|caderno|analises/.test(url)) { nota -= 0.35; }

  return Math.max(0, Math.min(1, nota));
}

/* ==================== catálogo ==================== */

function carregarCatalogo() {
  const contexto = {};
  new Function('globalThis', fs.readFileSync(CATALOGO, 'utf8') +
               '\nglobalThis.__catalogo = HABE_CATALOGO;').call(contexto, contexto);
  return contexto.__catalogo;
}

/* ==================== coleta ==================== */

function absoluto(base, href) {
  try { return new URL(href, base).href; } catch (e) { return null; }
}

function extrairLinks(html, base) {
  const links = [];
  const padrao = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = padrao.exec(html)) !== null) {
    const url = absoluto(base, m[1]);
    if (!url) { continue; }
    const texto = m[2].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
                      .replace(/\s+/g, ' ').trim();
    links.push({ url: url, texto: texto });
  }
  return links;
}

async function buscar(url) {
  try {
    const resposta = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                      '(KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml'
      }
    });
    if (resposta.ok) { return await resposta.text(); }
    throw new Error('HTTP ' + resposta.status);
  } catch (erro) {
    return await buscarComNavegador(url, erro);
  }
}

/* Plano B: navegador de verdade, para portais que recusam cliente HTTP simples. */
let navegadorCompartilhado = null;
async function buscarComNavegador(url, erroAnterior) {
  let chromium;
  try {
    chromium = require('playwright').chromium;
  } catch (e) {
    try { chromium = require('/opt/node22/lib/node_modules/playwright').chromium; }
    catch (e2) { throw erroAnterior; }
  }

  if (!navegadorCompartilhado) {
    navegadorCompartilhado = await chromium.launch();
  }
  const pagina = await navegadorCompartilhado.newPage();
  try {
    await pagina.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    return await pagina.content();
  } finally {
    await pagina.close();
  }
}

/* Varre as fontes e um nível de páginas internas, recolhendo todos os PDFs. */
async function coletarPdfs(fontes, profundidade) {
  const visitadas = new Set();
  const pdfs = new Map();
  let fila = fontes.map(function (u) { return { url: u, nivel: 0 }; });

  while (fila.length) {
    const atual = fila.shift();
    if (visitadas.has(atual.url)) { continue; }
    visitadas.add(atual.url);

    let html;
    try {
      html = await buscar(atual.url);
    } catch (erro) {
      console.log('  ! ' + atual.url + ' — ' + erro.message);
      continue;
    }

    const links = extrairLinks(html, atual.url);
    let novosPdfs = 0;

    links.forEach(function (link) {
      const limpa = link.url.split('#')[0];
      if (/\.pdf(\?|$)/i.test(limpa)) {
        if (!pdfs.has(limpa)) { pdfs.set(limpa, { url: limpa, texto: link.texto }); novosPdfs++; }
        else if (link.texto && !pdfs.get(limpa).texto) { pdfs.get(limpa).texto = link.texto; }
      } else if (atual.nivel < profundidade) {
        const host = (function () { try { return new URL(limpa).host; } catch (e) { return ''; } })();
        const hostBase = (function () { try { return new URL(atual.url).host; } catch (e) { return ''; } })();
        if (host === hostBase && !visitadas.has(limpa) && !/\.(zip|exe|jpg|png|gif|doc|xls)/i.test(limpa)) {
          fila.push({ url: limpa, nivel: atual.nivel + 1 });
        }
      }
    });

    console.log('  · ' + atual.url.replace(/^https?:\/\//, '') +
                ' — ' + links.length + ' links, ' + novosPdfs + ' PDF(s) novos');
  }

  return Array.from(pdfs.values());
}

/* ==================== relatório ==================== */

function montarPropostas(catalogo, pdfs) {
  return catalogo.fichas.map(function (ficha) {
    const notas = pdfs.map(function (pdf) {
      return { pdf: pdf, nota: pontuar(ficha, pdf) };
    }).sort(function (a, b) { return b.nota - a.nota; });

    return {
      ficha: ficha,
      melhor: notas[0] && notas[0].nota >= CONFIANCA_MINIMA ? notas[0] : null,
      alternativas: notas.slice(1, 3).filter(function (n) { return n.nota >= CONFIANCA_MINIMA; })
    };
  });
}

function escreverRelatorio(propostas, totalPdfs) {
  const altas = propostas.filter(function (p) { return p.melhor && p.melhor.nota >= CONFIANCA_ALTA; });
  const baixas = propostas.filter(function (p) { return p.melhor && p.melhor.nota < CONFIANCA_ALTA; });
  const semNada = propostas.filter(function (p) { return !p.melhor; });

  let t = '# Propostas de links oficiais\n\n' +
    'Gerado por `node scripts/descobrir-fichas.js` em ' +
    new Date().toISOString().slice(0, 10) + '. ' +
    totalPdfs + ' PDFs encontrados no portal.\n\n' +
    '**Nada foi gravado no catálogo.** Confira cada linha antes de aplicar: ' +
    'entregar a ficha errada ao médico é pior do que não entregar ficha nenhuma. ' +
    'Depois de conferir, `node scripts/descobrir-fichas.js --aplicar` grava apenas ' +
    'as de confiança alta.\n\n---\n\n';

  function bloco(titulo, itens, comAlternativas) {
    t += '## ' + titulo + ' (' + itens.length + ')\n\n';
    if (itens.length === 0) { t += '_Nenhum._\n\n'; return; }
    t += '| ✓ | Agravo | Proposta | Confiança |\n|---|---|---|---|\n';
    itens.forEach(function (p) {
      t += '| ☐ | ' + p.ficha.nome + ' | [' +
           decodeURIComponent(p.melhor.pdf.url).split('/').pop() + '](' +
           p.melhor.pdf.url + ') | ' + Math.round(p.melhor.nota * 100) + '% |\n';
      if (comAlternativas) {
        p.alternativas.forEach(function (alt) {
          t += '| | ↳ _alternativa_ | [' +
               decodeURIComponent(alt.pdf.url).split('/').pop() + '](' +
               alt.pdf.url + ') | ' + Math.round(alt.nota * 100) + '% |\n';
        });
      }
    });
    t += '\n';
  }

  bloco('Confiança alta — revisar e aplicar', altas, false);
  bloco('Confiança baixa — decidir manualmente', baixas, true);

  t += '## Sem candidato no portal (' + semNada.length + ')\n\n';
  if (semNada.length === 0) { t += '_Nenhum._\n'; }
  else {
    t += 'Procure manualmente e preencha `urlOficial` no catálogo.\n\n';
    semNada.forEach(function (p) { t += '- ' + p.ficha.nome + '\n'; });
  }

  fs.writeFileSync(RELATORIO, t);
  return { altas: altas.length, baixas: baixas.length, semNada: semNada.length };
}

/* Grava urlOficial no catálogo, só nas propostas de confiança alta. */
function aplicar(propostas) {
  let fonte = fs.readFileSync(CATALOGO, 'utf8');
  let gravadas = 0;

  propostas.forEach(function (p) {
    if (!p.melhor || p.melhor.nota < CONFIANCA_ALTA) { return; }
    if (p.ficha.urlOficial) { return; }   /* nunca sobrescreve o que já existe */

    /* Localiza o bloco da ficha pelo id e troca a linha urlOficial: null. */
    const marcador = "id: '" + p.ficha.id + "'";
    const inicio = fonte.indexOf(marcador);
    if (inicio < 0) { return; }
    const fim = fonte.indexOf('\n    },', inicio);
    const bloco = fonte.slice(inicio, fim);
    if (bloco.indexOf('urlOficial: null') < 0) { return; }

    const novo = bloco
      .replace('urlOficial: null', "urlOficial: '" + p.melhor.pdf.url + "'")
      .replace('urlVerificada: false', 'urlVerificada: false');  /* só a conferência humana promove */
    fonte = fonte.slice(0, inicio) + novo + fonte.slice(fim);
    gravadas++;
  });

  fs.writeFileSync(CATALOGO, fonte);
  return gravadas;
}

/* ==================== autoteste ==================== */

function autoteste() {
  const catalogo = carregarCatalogo();
  const porId = catalogo.porId;
  let falhas = 0;

  function ok(nome, condicao, extra) {
    console.log((condicao ? '  OK   ' : '  FALHA') + ' ' + nome +
                (!condicao && extra ? '\n         ' + extra : ''));
    if (!condicao) { falhas++; }
  }

  /* Extração de links */
  const html = '<a href="/images/documentos/Agravos/Dengue/Ficha_DENGCHIK_FINAL.pdf">' +
               'Ficha de <b>Notificação</b> Dengue e Chikungunya</a>' +
               '<a href="outra-pagina">Doenças e Agravos</a>';
  const links = extrairLinks(html, 'https://portalsinan.saude.gov.br/notificacoes');
  ok('Extrai href e texto, resolvendo caminho relativo',
     links.length === 2 &&
     links[0].url === 'https://portalsinan.saude.gov.br/images/documentos/Agravos/Dengue/Ficha_DENGCHIK_FINAL.pdf' &&
     links[0].texto === 'Ficha de Notificação Dengue e Chikungunya',
     JSON.stringify(links));

  /* Casamento correto */
  const candidatos = [
    { url: 'https://p/images/documentos/Agravos/Dengue/Ficha_DENGCHIK_FINAL.pdf', texto: 'Dengue e Chikungunya' },
    { url: 'https://p/images/documentos/Agravos/Tuberculose/Ficha_Tuberculose.pdf', texto: 'Tuberculose' },
    { url: 'https://p/images/documentos/Agravos/Hanseniase/Ficha_Hanseniase.pdf', texto: 'Hanseníase' },
    { url: 'https://p/images/documentos/Agravos/Meningite/Ficha_Meningite.pdf', texto: 'Meningite' },
    { url: 'https://p/images/documentos/Agravos/Dengue/DIC_DADOS_ONLINE.pdf', texto: 'Dicionário de dados' },
    { url: 'https://p/images/documentos/Agravos/Dengue/Instrucional_DENGUE_CHIK.pdf', texto: 'Instruções de preenchimento' },
    { url: 'https://p/images/documentos/Agravos/Violencia/Ficha_Violencia.pdf', texto: 'Violência interpessoal e autoprovocada' },
    { url: 'https://p/images/documentos/Agravos/Leishmaniose_Visceral/Ficha_LV.pdf', texto: 'Leishmaniose Visceral' }
  ];

  function melhorPara(id) {
    return candidatos.map(function (c) { return { c: c, n: pontuar(porId[id], c) }; })
                     .sort(function (a, b) { return b.n - a.n; })[0];
  }

  const casos = [
    ['tuberculose', 'Ficha_Tuberculose.pdf'],
    ['hanseniase', 'Ficha_Hanseniase.pdf'],
    ['dengue', 'Ficha_DENGCHIK_FINAL.pdf'],
    ['chikungunya', 'Ficha_DENGCHIK_FINAL.pdf'],
    ['meningites', 'Ficha_Meningite.pdf'],
    ['violencia-interpessoal', 'Ficha_Violencia.pdf'],
    ['leishmaniose-visceral', 'Ficha_LV.pdf']
  ];
  casos.forEach(function (caso) {
    const melhor = melhorPara(caso[0]);
    ok('Casa "' + porId[caso[0]].nome.slice(0, 34) + '" com ' + caso[1],
       melhor.c.url.indexOf(caso[1]) > 0,
       'escolheu ' + melhor.c.url.split('/').pop() + ' (' + Math.round(melhor.n * 100) + '%)');
  });

  /* Dicionário de dados e instrutivo nunca podem vencer a ficha */
  const dengue = melhorPara('dengue');
  ok('Dicionário de dados e instrutivo perdem para a ficha',
     !/DIC_DADOS|Instrucional/.test(dengue.c.url), dengue.c.url);

  /* Agravo sem candidato não pode ser casado à força */
  const peste = melhorPara('peste');
  ok('Agravo sem candidato fica abaixo do mínimo',
     peste.n < CONFIANCA_MINIMA,
     'peste casou com ' + peste.c.url.split('/').pop() + ' a ' + Math.round(peste.n * 100) + '%');

  const botulismo = melhorPara('botulismo');
  ok('Botulismo também fica abaixo do mínimo',
     botulismo.n < CONFIANCA_MINIMA,
     'botulismo casou com ' + botulismo.c.url.split('/').pop() +
     ' a ' + Math.round(botulismo.n * 100) + '%');

  console.log(falhas === 0 ? '\n>>> AUTOTESTE PASSOU' : '\n>>> ' + falhas + ' FALHA(S)');
  return falhas === 0 ? 0 : 1;
}

/* ==================== principal ==================== */

async function principal() {
  const args = process.argv.slice(2);

  if (args.includes('--autoteste')) { process.exit(autoteste()); }

  const catalogo = carregarCatalogo();
  const indiceFonte = args.indexOf('--fonte');
  const fontes = indiceFonte >= 0 ? [args[indiceFonte + 1]] : FONTES_PADRAO;

  console.log('Varrendo o portal do Sinan…\n');
  const pdfs = await coletarPdfs(fontes, 1);

  if (navegadorCompartilhado) { await navegadorCompartilhado.close(); }

  console.log('\n' + pdfs.length + ' PDFs encontrados.');
  if (pdfs.length === 0) {
    console.log('Nenhum PDF acessível — verifique o acesso a portalsinan.saude.gov.br.');
    process.exit(1);
  }

  const propostas = montarPropostas(catalogo, pdfs);
  const resumo = escreverRelatorio(propostas, pdfs.length);

  console.log('\nRelatório: ' + path.relative(RAIZ, RELATORIO));
  console.log('  confiança alta ..... ' + resumo.altas);
  console.log('  confiança baixa .... ' + resumo.baixas);
  console.log('  sem candidato ...... ' + resumo.semNada);

  if (args.includes('--aplicar')) {
    const gravadas = aplicar(propostas);
    console.log('\n' + gravadas + ' link(s) gravados no catálogo (urlVerificada continua false ' +
                'até a conferência humana).');
  } else {
    console.log('\nConfira o relatório e rode com --aplicar para gravar as de confiança alta.');
  }
}

if (require.main === module) {
  principal().catch(function (erro) {
    console.error('Erro: ' + erro.message);
    process.exit(1);
  });
}

module.exports = { normalizar, palavras, pontuar, extrairLinks };
