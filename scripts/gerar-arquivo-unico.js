#!/usr/bin/env node
/* =========================================================================
   HABE SINAN — gera a versão de arquivo único
   -------------------------------------------------------------------------
   Junta o HTML, o CSS, todos os scripts e o brasão num único arquivo .html,
   sem nenhuma dependência externa. Serve para:

     · distribuir por pasta de rede ou pen drive;
     · abrir com dois cliques, sem servidor e sem internet;
     · publicar rapidamente para demonstração.

   Uso, a partir da raiz do projeto:
       node scripts/gerar-arquivo-unico.js

   Produz, para cada uma das duas páginas:
       HABE-SINAN-consulta.html   a dos médicos (urgência e ambulatórios)
       HABE-SINAN-nucleo.html     a do Núcleo de Epidemiologia
       build/*-publicavel.html    o mesmo conteúdo sem <!DOCTYPE>/<html>/
                                  <head>/<body>, para publicação embutida

   Atenção ao distribuir: o arquivo do Núcleo guarda dados de paciente no
   navegador em que for aberto. Ele não vai para consultório.

   Refaça sempre que alterar o catálogo, o CSS ou qualquer script — o arquivo
   único é uma cópia congelada, não acompanha as mudanças sozinho.

   As fichas em PDF continuam FORA do arquivo: coloque a pasta fichas/ ao lado
   dele para que o download automático funcione offline.
   ========================================================================= */

'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const PASTA_BUILD = path.join(RAIZ, 'build');

const PAGINAS = [
  { entrada: 'index.html',  completa: 'HABE-SINAN-consulta.html', embutida: 'consulta-publicavel.html' },
  { entrada: 'nucleo.html', completa: 'HABE-SINAN-nucleo.html',   embutida: 'nucleo-publicavel.html' }
];

const CAMINHO_BRASAO = 'assets/img/logo-habe.svg';

function ler(relativo) {
  return fs.readFileSync(path.join(RAIZ, relativo), 'utf8');
}

/* Impede que uma sequência "</script>" dentro do código encerre a tag. */
function protegerScript(codigo) {
  return codigo.replace(/<\/script>/gi, '<\\/script>');
}

function montar(pagina) {
  let html = ler(pagina.entrada);

  /* ---- brasão como data URI ---- */
  const brasao = ler(CAMINHO_BRASAO);
  const brasaoUri = 'data:image/svg+xml;base64,' + Buffer.from(brasao, 'utf8').toString('base64');

  /* ---- folha de estilo ---- */
  let css = null;
  html = html.replace(/[ \t]*<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>\s*/i,
    function (_, href) {
      css = ler(href);
      return '<style>\n' + css + '\n</style>\n';
    });
  if (css === null) { throw new Error(pagina.entrada + ': não encontrei a folha de estilo.'); }

  /* ---- scripts, na mesma ordem em que aparecem ---- */
  const scripts = [];
  html = html.replace(/[ \t]*<script\s+src=["']([^"']+)["']\s*><\/script>\s*/gi,
    function (_, src) {
      scripts.push(src);
      return '<script>\n' + protegerScript(ler(src)) + '\n</script>\n';
    });
  if (scripts.length === 0) { throw new Error(pagina.entrada + ': não encontrei scripts externos.'); }

  /* ---- a outra página passa a ser o arquivo único correspondente ---- */
  PAGINAS.forEach(function (outra) {
    if (outra.entrada !== pagina.entrada) {
      html = html.split('"' + outra.entrada + '"').join('"' + outra.completa + '"');
    }
  });

  /* ---- brasão: no HTML e dentro dos scripts já embutidos ---- */
  const ocorrencias = (html.match(new RegExp(CAMINHO_BRASAO, 'g')) || []).length;
  html = html.split(CAMINHO_BRASAO).join(brasaoUri);

  const carimbo = '<!-- Gerado por scripts/gerar-arquivo-unico.js em ' +
                  new Date().toISOString().slice(0, 10) + '. Não edite este arquivo: ' +
                  'altere o projeto e gere de novo. -->\n';
  fs.writeFileSync(path.join(RAIZ, pagina.completa), carimbo + html);

  /* ---- versão para publicação embutida ---- */
  const tituloM = html.match(/<title>([\s\S]*?)<\/title>/i);
  const corpoM = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const estilos = (html.match(/<style>[\s\S]*?<\/style>/gi) || []).join('\n');
  if (!corpoM) { throw new Error(pagina.entrada + ': não consegui isolar o corpo do documento.'); }

  if (!fs.existsSync(PASTA_BUILD)) { fs.mkdirSync(PASTA_BUILD, { recursive: true }); }
  fs.writeFileSync(path.join(PASTA_BUILD, pagina.embutida),
    '<title>' + (tituloM ? tituloM[1] : 'HABE SINAN') + '</title>\n' +
    estilos + '\n' + corpoM[1].trim() + '\n');

  const problemas = [];
  if (/<link[^>]*stylesheet/i.test(html)) { problemas.push('sobrou <link rel=stylesheet>'); }
  if (/<script\s+src=/i.test(html)) { problemas.push('sobrou <script src=>'); }
  if (html.indexOf(CAMINHO_BRASAO) >= 0) { problemas.push('sobrou referência ao brasão'); }

  return { scripts: scripts.length, css: css.length, brasoes: ocorrencias, problemas: problemas };
}

function principal() {
  let falhou = false;

  PAGINAS.forEach(function (pagina) {
    const r = montar(pagina);
    const tamanho = (fs.statSync(path.join(RAIZ, pagina.completa)).size / 1024).toFixed(0);
    console.log(pagina.completa + ' — ' + tamanho + ' KB · ' + r.scripts + ' scripts · ' +
                (r.css / 1024).toFixed(0) + ' KB de CSS · ' + r.brasoes + ' brasões embutidos');
    if (r.problemas.length) {
      console.error('  ATENÇÃO: ' + r.problemas.join('; '));
      falhou = true;
    }
  });

  console.log('\nO arquivo do Núcleo contém dados de paciente: não distribua a consultórios.');
  if (falhou) { process.exit(1); }
}

principal();
