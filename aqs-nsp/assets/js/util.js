/* =========================================================================
   HABE – AQS e NSP — funções utilitárias compartilhadas entre as páginas
   (adaptado do HABE SINAN; sem estilos inline, por causa da CSP)
   ========================================================================= */

var U = (function () {
  'use strict';

  var FUSO = 'America/Belem';

  /* ---------- DOM ---------- */

  function $(seletor, contexto) {
    return (contexto || document).querySelector(seletor);
  }

  function $$(seletor, contexto) {
    return Array.prototype.slice.call((contexto || document).querySelectorAll(seletor));
  }

  /* Escapa texto para inserção segura em HTML. Todo dado vindo do banco ou
     do usuário passa por aqui antes de entrar num innerHTML. */
  function esc(valor) {
    if (valor === null || valor === undefined) { return ''; }
    return String(valor)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* Texto com quebras de linha preservadas (comentários, detalhamento). */
  function escMultilinha(valor) {
    return esc(valor).replace(/\r?\n/g, '<br>');
  }

  /* Remove acentos e coloca em minúsculas — usado na busca. */
  function normalizar(texto) {
    return String(texto || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
  }

  /* A CSP não permite style="" em HTML montado por innerHTML. Larguras de
     barras de progresso vão em data-largura="0..100" e são aplicadas aqui,
     pelo CSSOM, que a CSP permite. Chamar depois de cada renderização. */
  function aplicarLarguras(raiz) {
    $$('[data-largura]', raiz || document).forEach(function (el) {
      var v = Math.max(0, Math.min(100, Number(el.getAttribute('data-largura')) || 0));
      el.style.width = v + '%';
    });
  }

  /* ---------- datas (sempre no fuso de Belém, nunca no do aparelho) ---------- */

  function doisDigitos(n) { return String(n).padStart(2, '0'); }

  /* 'AAAA-MM-DD' de hoje em Belém. */
  function hojeBelem() {
    var partes = new Intl.DateTimeFormat('en-CA', {
      timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    var m = {};
    partes.forEach(function (p) { m[p.type] = p.value; });
    return m.year + '-' + m.month + '-' + m.day;
  }

  /* Converte 'AAAA-MM-DD' em Date local ao meio-dia (evita deslocamento de fuso). */
  function paraData(texto) {
    if (!texto) { return null; }
    if (String(texto).length === 10) {
      var p = String(texto).split('-');
      return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12);
    }
    return new Date(texto);
  }

  function paraTexto(data) {
    return data.getFullYear() + '-' + doisDigitos(data.getMonth() + 1) + '-' + doisDigitos(data.getDate());
  }

  function somarDias(texto, dias) {
    var d = paraData(texto);
    d.setDate(d.getDate() + dias);
    return paraTexto(d);
  }

  /* Diferença em dias (b - a) entre duas datas 'AAAA-MM-DD'. */
  function diasEntre(a, b) {
    return Math.round((paraData(b) - paraData(a)) / 86400000);
  }

  function formatarData(texto) {
    var d = paraData(texto);
    if (!d || isNaN(d.getTime())) { return '—'; }
    return doisDigitos(d.getDate()) + '/' + doisDigitos(d.getMonth() + 1) + '/' + d.getFullYear();
  }

  function formatarDataCurta(texto) {
    var d = paraData(texto);
    if (!d || isNaN(d.getTime())) { return '—'; }
    return doisDigitos(d.getDate()) + '/' + doisDigitos(d.getMonth() + 1);
  }

  /* Data e hora de um timestamptz, exibidas no fuso de Belém. */
  function formatarDataHora(iso) {
    if (!iso) { return '—'; }
    var d = new Date(iso);
    if (isNaN(d.getTime())) { return '—'; }
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }).format(d).replace(',', ' às');
  }

  /* "há 5 min", "há 2 h", "ontem", "12/10". */
  function tempoRelativo(iso) {
    if (!iso) { return ''; }
    var seg = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (seg < 60) { return 'agora'; }
    if (seg < 3600) { return 'há ' + Math.floor(seg / 60) + ' min'; }
    if (seg < 86400) { return 'há ' + Math.floor(seg / 3600) + ' h'; }
    if (seg < 172800) { return 'ontem'; }
    return formatarDataHora(iso).slice(0, 5);
  }

  var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
               'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  var DIAS_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira',
                     'quinta-feira', 'sexta-feira', 'sábado'];

  /* 'AAAA-MM' → 'outubro de 2026' */
  function mesPorExtenso(chave) {
    var p = String(chave || '').split('-');
    if (p.length < 2) { return chave || ''; }
    return MESES[Number(p[1]) - 1] + ' de ' + p[0];
  }

  /* 'Prazo hoje', 'Vence amanhã', 'Vence em 3 dias', 'Atrasada há 2 dias'. */
  function descreverPrazo(prazo, hoje) {
    if (!prazo) { return 'Sem prazo'; }
    var d = diasEntre(hoje || hojeBelem(), prazo);
    if (d === 0) { return 'Prazo hoje'; }
    if (d === 1) { return 'Vence amanhã'; }
    if (d > 1) { return 'Vence em ' + d + ' dias'; }
    if (d === -1) { return 'Atrasada há 1 dia'; }
    return 'Atrasada há ' + (-d) + ' dias';
  }

  /* ---------- avisos flutuantes ---------- */

  function torrada(mensagem, tipo, duracao) {
    var caixa = $('#avisosFlutuantes');
    if (!caixa) { return; }
    var item = document.createElement('div');
    item.className = 'torrada' + (tipo ? ' torrada--' + tipo : '');
    item.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
    item.textContent = mensagem;
    caixa.appendChild(item);
    window.setTimeout(function () {
      item.style.transition = 'opacity .3s';
      item.style.opacity = '0';
      window.setTimeout(function () { item.remove(); }, 300);
    }, duracao || 4200);
  }

  /* Mensagem de erro amigável a partir de qualquer exceção. */
  function erroTexto(erro) {
    if (!erro) { return 'Erro desconhecido.'; }
    return erro.message || String(erro);
  }

  function falha(erro) {
    console.error(erro);
    torrada(erroTexto(erro), 'erro', 7000);
  }

  /* ---------- painel lateral (vira tela cheia no celular, via CSS) ---------- */

  var aoFecharPainel = null;

  function abrirPainel(tituloHtml, corpoHtml, aoMontar, opcoes) {
    var raiz = $('#painelDetalhe');
    opcoes = opcoes || {};
    raiz.innerHTML =
      '<div class="sobreposicao" id="sobreposicaoPainel">' +
        '<div class="painel' + (opcoes.largo ? ' painel--largo' : '') + '" role="dialog" aria-modal="true">' +
          '<div class="painel__cabecalho">' +
            '<h2 class="painel__titulo">' + tituloHtml + '</h2>' +
            '<button class="painel__fechar" type="button" aria-label="Fechar">×</button>' +
          '</div>' +
          '<div class="painel__corpo">' + corpoHtml + '</div>' +
        '</div>' +
      '</div>';

    var sobreposicao = $('#sobreposicaoPainel');
    sobreposicao.addEventListener('click', function (evento) {
      if (evento.target === sobreposicao) { fecharPainel(); }
    });
    $('.painel__fechar', raiz).addEventListener('click', fecharPainel);
    document.addEventListener('keydown', escFecha);
    document.body.classList.add('sem-rolagem');
    aoFecharPainel = opcoes.aoFechar || null;

    if (typeof aoMontar === 'function') { aoMontar($('.painel', raiz)); }
    aplicarLarguras(raiz);
  }

  function escFecha(evento) {
    if (evento.key === 'Escape') { fecharPainel(); }
  }

  function painelAberto() {
    var raiz = $('#painelDetalhe');
    return !!(raiz && raiz.firstChild);
  }

  function fecharPainel() {
    var raiz = $('#painelDetalhe');
    if (!raiz || !raiz.firstChild) { return; }
    raiz.innerHTML = '';
    document.body.classList.remove('sem-rolagem');
    document.removeEventListener('keydown', escFecha);
    var cb = aoFecharPainel;
    aoFecharPainel = null;
    if (typeof cb === 'function') { cb(); }
  }

  /* Confirmação simples (window.confirm é suficiente e acessível). */
  function confirmar(mensagem) {
    return window.confirm(mensagem);
  }

  /* ---------- downloads ---------- */

  function baixarConteudo(nomeArquivo, conteudo, tipoMime) {
    var blob = (conteudo instanceof Blob) ? conteudo
      : new Blob([conteudo], { type: tipoMime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = nomeArquivo;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  /* Abre um Blob numa aba nova (PDF e imagens); os demais tipos são baixados. */
  function abrirBlob(nomeArquivo, blob) {
    var visualizavel = /^(application\/pdf|image\/|text\/plain)/.test(blob.type || '');
    if (!visualizavel) { return baixarConteudo(nomeArquivo, blob); }
    var url = URL.createObjectURL(blob);
    /* Sem 'noopener' nos parâmetros: com ele window.open sempre devolve null
       e não daria para saber se o navegador bloqueou a aba. */
    var janela = window.open(url, '_blank');
    if (janela) { janela.opener = null; } else { baixarConteudo(nomeArquivo, blob); }
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  /* ---------- CSV ---------- */

  function paraCsv(linhas) {
    return linhas.map(function (linha) {
      return linha.map(function (celula) {
        var texto = (celula === null || celula === undefined) ? '' : String(celula);
        /* Neutraliza fórmulas (=, +, -, @) para o Excel não executá-las. */
        if (/^[=+\-@\t\r]/.test(texto)) { texto = "'" + texto; }
        return '"' + texto.replace(/"/g, '""') + '"';
      }).join(';');
    }).join('\r\n');
  }

  function baixarCsv(nomeArquivo, linhas) {
    /* BOM para o Excel reconhecer o UTF-8. */
    baixarConteudo(nomeArquivo, '﻿' + paraCsv(linhas), 'text/csv;charset=utf-8');
  }

  /* ---------- arquivos ---------- */

  /* Reduz fotos grandes antes do envio, mantendo a legibilidade do documento.
     Devolve uma Promise de File (JPEG) ou null quando não há o que reduzir. */
  function comprimirImagem(arquivo, larguraMaxima) {
    larguraMaxima = larguraMaxima || 2000;
    return new Promise(function (resolver) {
      if (!arquivo.type || arquivo.type.indexOf('image/') !== 0 || arquivo.type === 'image/gif') {
        return resolver(null);
      }
      var url = URL.createObjectURL(arquivo);
      var img = new Image();
      img.onload = function () {
        var escala = Math.min(1, larguraMaxima / Math.max(img.width, img.height));
        if (escala >= 1 && arquivo.size < 1200000) { URL.revokeObjectURL(url); return resolver(null); }
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * escala);
        canvas.height = Math.round(img.height * escala);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob(function (blob) {
          if (!blob) { return resolver(null); }
          var nome = arquivo.name.replace(/\.[^.]+$/, '') + '.jpg';
          try {
            resolver(new File([blob], nome, { type: 'image/jpeg' }));
          } catch (e) {
            blob.name = nome;
            resolver(blob);
          }
        }, 'image/jpeg', 0.86);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolver(null); };
      img.src = url;
    });
  }

  function formatarTamanho(bytes) {
    if (!bytes && bytes !== 0) { return '—'; }
    if (bytes < 1024) { return bytes + ' B'; }
    if (bytes < 1048576) { return (bytes / 1024).toFixed(0) + ' KB'; }
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  /* Ícone por tipo de arquivo, para a lista de evidências. */
  function iconeArquivo(mime, nome) {
    var n = String(nome || '').toLowerCase();
    if (/pdf/.test(mime) || /\.pdf$/.test(n)) { return '📕'; }
    if (/word|opendocument\.text/.test(mime) || /\.(docx?|odt)$/.test(n)) { return '📘'; }
    if (/presentation|powerpoint/.test(mime) || /\.(pptx?|odp)$/.test(n)) { return '📙'; }
    if (/sheet|excel|csv/.test(mime) || /\.(xlsx?|ods|csv)$/.test(n)) { return '📗'; }
    if (/^image\//.test(mime)) { return '🖼'; }
    return '📄';
  }

  /* Nome seguro para o caminho no Storage: sem acentos, espaços ou barras. */
  function nomeSeguro(nome) {
    var base = normalizar(nome).replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-')
      .replace(/-\./g, '.').replace(/^[-.]+|[-.]+$/g, '');
    return (base || 'arquivo').slice(0, 80);
  }

  /* ---------- diversos ---------- */

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) { return window.crypto.randomUUID(); }
    var b = new Uint8Array(16);
    window.crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  /* Agrupa uma lista por chave: { chave: [itens] }. */
  function agrupar(lista, funcaoChave) {
    var grupos = {};
    (lista || []).forEach(function (item) {
      var k = funcaoChave(item);
      (grupos[k] = grupos[k] || []).push(item);
    });
    return grupos;
  }

  function ordenarTexto(a, b) {
    return String(a).localeCompare(String(b), 'pt-BR', { sensitivity: 'base' });
  }

  /* Adia a execução até que as chamadas parem por 'espera' ms. */
  function adiar(funcao, espera) {
    var temporizador = null;
    return function () {
      var args = arguments, ctx = this;
      window.clearTimeout(temporizador);
      temporizador = window.setTimeout(function () { funcao.apply(ctx, args); }, espera);
    };
  }

  /* Anel de progresso em SVG (sem style inline: tudo por atributos). */
  function anelProgresso(percentual, rotulo, classeExtra) {
    var p = Math.max(0, Math.min(100, Math.round(percentual || 0)));
    var r = 34, c = 2 * Math.PI * r;
    var cheio = (c * p / 100).toFixed(1);
    var classe = p >= 100 ? 'anel--completo' : (p >= 70 ? 'anel--bom' : (p >= 40 ? 'anel--medio' : 'anel--baixo'));
    return '<div class="anel ' + classe + (classeExtra ? ' ' + classeExtra : '') + '">' +
      '<svg viewBox="0 0 80 80" width="80" height="80" aria-hidden="true">' +
        '<circle class="anel__trilho" cx="40" cy="40" r="' + r + '" fill="none" stroke-width="8"></circle>' +
        '<circle class="anel__valor" cx="40" cy="40" r="' + r + '" fill="none" stroke-width="8" ' +
          'stroke-linecap="round" transform="rotate(-90 40 40)" ' +
          'stroke-dasharray="' + cheio + ' ' + c.toFixed(1) + '"></circle>' +
      '</svg>' +
      '<span class="anel__numero">' + p + '%</span>' +
      (rotulo ? '<span class="anel__rotulo">' + esc(rotulo) + '</span>' : '') +
    '</div>';
  }

  return {
    $: $, $$: $$, esc: esc, escMultilinha: escMultilinha, normalizar: normalizar,
    aplicarLarguras: aplicarLarguras,
    hojeBelem: hojeBelem, paraData: paraData, paraTexto: paraTexto, somarDias: somarDias,
    diasEntre: diasEntre, formatarData: formatarData, formatarDataCurta: formatarDataCurta,
    formatarDataHora: formatarDataHora, tempoRelativo: tempoRelativo,
    MESES: MESES, DIAS_SEMANA: DIAS_SEMANA, mesPorExtenso: mesPorExtenso,
    descreverPrazo: descreverPrazo,
    torrada: torrada, erroTexto: erroTexto, falha: falha,
    abrirPainel: abrirPainel, fecharPainel: fecharPainel, painelAberto: painelAberto,
    confirmar: confirmar,
    baixarConteudo: baixarConteudo, abrirBlob: abrirBlob,
    paraCsv: paraCsv, baixarCsv: baixarCsv,
    comprimirImagem: comprimirImagem, formatarTamanho: formatarTamanho,
    iconeArquivo: iconeArquivo, nomeSeguro: nomeSeguro,
    uuid: uuid, agrupar: agrupar, ordenarTexto: ordenarTexto, adiar: adiar,
    anelProgresso: anelProgresso
  };
})();
