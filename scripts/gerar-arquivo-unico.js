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

   Produz:
       HABE-SINAN.html            arquivo completo, abre com dois cliques
       build/pagina-publicavel.html   mesmo conteúdo, sem <!DOCTYPE>/<html>/
                                      <head>/<body>, para publicação embutida

   Refaça sempre que alterar o catálogo, o CSS ou qualquer script — o arquivo
   único é uma cópia congelada, não acompanha as mudanças sozinho.

   As fichas em PDF continuam FORA do arquivo: coloque a pasta fichas/ ao lado
   dele para que o download automático funcione offline.
   ========================================================================= */

'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const ENTRADA = path.join(RAIZ, 'index.html');
const SAIDA_COMPLETA = path.join(RAIZ, 'HABE-SINAN.html');
const PASTA_BUILD = path.join(RAIZ, 'build');
const SAIDA_EMBUTIDA = path.join(PASTA_BUILD, 'pagina-publicavel.html');

const CAMINHO_BRASAO = 'assets/img/logo-habe.svg';

function ler(relativo) {
  return fs.readFileSync(path.join(RAIZ, relativo), 'utf8');
}

/* Impede que uma sequência "</script>" dentro do código encerre a tag. */
function protegerScript(codigo) {
  return codigo.replace(/<\/script>/gi, '<\\/script>');
}

function principal() {
  let html = ler('index.html');

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
  if (css === null) { throw new Error('Não encontrei a folha de estilo em index.html.'); }

  /* ---- scripts, na mesma ordem em que aparecem ---- */
  const scripts = [];
  html = html.replace(/[ \t]*<script\s+src=["']([^"']+)["']\s*><\/script>\s*/gi,
    function (_, src) {
      scripts.push(src);
      return '<script>\n' + protegerScript(ler(src)) + '\n</script>\n';
    });
  if (scripts.length === 0) { throw new Error('Não encontrei scripts externos em index.html.'); }

  /* ---- brasão: no HTML e dentro dos scripts já embutidos ---- */
  const ocorrencias = (html.match(new RegExp(CAMINHO_BRASAO, 'g')) || []).length;
  html = html.split(CAMINHO_BRASAO).join(brasaoUri);

  /* ---- versão completa ---- */
  const carimbo = '<!-- Gerado por scripts/gerar-arquivo-unico.js em ' +
                  new Date().toISOString().slice(0, 10) + '. Não edite este arquivo: ' +
                  'altere o projeto e gere de novo. -->\n';
  fs.writeFileSync(SAIDA_COMPLETA, carimbo + html);

  /* ---- versão para publicação embutida ----
     Remove o esqueleto do documento, preservando <title>, <style> e o corpo. */
  const tituloM = html.match(/<title>([\s\S]*?)<\/title>/i);
  const corpoM = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const estilos = (html.match(/<style>[\s\S]*?<\/style>/gi) || []).join('\n');
  if (!corpoM) { throw new Error('Não consegui isolar o corpo do documento.'); }

  const embutida =
    '<title>' + (tituloM ? tituloM[1] : 'HABE SINAN') + '</title>\n' +
    estilos + '\n' +
    /* A página assume o tema por conta própria; o atributo data-tema fica na
       raiz do documento, que existe igualmente quando embutida. */
    corpoM[1].trim() + '\n';

  if (!fs.existsSync(PASTA_BUILD)) { fs.mkdirSync(PASTA_BUILD, { recursive: true }); }
  fs.writeFileSync(SAIDA_EMBUTIDA, embutida);

  /* ---- conferências ---- */
  const problemas = [];
  if (/<link[^>]*stylesheet/i.test(html)) { problemas.push('sobrou <link rel=stylesheet>'); }
  if (/<script\s+src=/i.test(html)) { problemas.push('sobrou <script src=>'); }
  if (html.indexOf(CAMINHO_BRASAO) >= 0) { problemas.push('sobrou referência ao brasão'); }

  console.log('Arquivo único gerado.\n');
  console.log('  ' + path.relative(RAIZ, SAIDA_COMPLETA) + ' — ' +
              (fs.statSync(SAIDA_COMPLETA).size / 1024).toFixed(0) + ' KB');
  console.log('  ' + path.relative(RAIZ, SAIDA_EMBUTIDA) + ' — ' +
              (fs.statSync(SAIDA_EMBUTIDA).size / 1024).toFixed(0) + ' KB');
  console.log('\n  ' + scripts.length + ' scripts embutidos, ' +
              (css.length / 1024).toFixed(0) + ' KB de CSS, ' +
              ocorrencias + ' referências ao brasão convertidas.');

  if (problemas.length) {
    console.error('\nATENÇÃO: ' + problemas.join('; '));
    process.exit(1);
  }
}

principal();
