/* =========================================================================
   HABE SINAN — funções utilitárias compartilhadas entre as páginas
   ========================================================================= */

var U = (function () {
  'use strict';

  /* ---------- DOM ---------- */

  function $(seletor, contexto) {
    return (contexto || document).querySelector(seletor);
  }

  function $$(seletor, contexto) {
    return Array.prototype.slice.call((contexto || document).querySelectorAll(seletor));
  }

  /* Escapa texto para inserção segura em HTML. */
  function esc(valor) {
    if (valor === null || valor === undefined) { return ''; }
    return String(valor)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* Remove acentos e coloca em minúsculas — usado na busca. */
  function normalizar(texto) {
    return String(texto || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  /* ---------- datas ---------- */

  function hoje() {
    var d = new Date();
    return d.getFullYear() + '-' +
           String(d.getMonth() + 1).padStart(2, '0') + '-' +
           String(d.getDate()).padStart(2, '0');
  }

  /* Converte 'AAAA-MM-DD' em Date local (evita o deslocamento de fuso do ISO). */
  function paraData(texto) {
    if (!texto) { return null; }
    if (texto.length === 10) {
      var p = texto.split('-');
      return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    }
    return new Date(texto);
  }

  function formatarData(texto) {
    var d = paraData(texto);
    if (!d || isNaN(d.getTime())) { return '—'; }
    return String(d.getDate()).padStart(2, '0') + '/' +
           String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
  }

  function formatarDataHora(iso) {
    if (!iso) { return '—'; }
    var d = new Date(iso);
    if (isNaN(d.getTime())) { return '—'; }
    return formatarData(iso) + ' às ' +
           String(d.getHours()).padStart(2, '0') + ':' +
           String(d.getMinutes()).padStart(2, '0');
  }

  /* Semana epidemiológica brasileira: inicia no domingo; a SE 1 é a primeira
     semana do ano com quatro ou mais dias em janeiro. */
  function semanaEpidemiologica(texto) {
    var data = paraData(texto);
    if (!data || isNaN(data.getTime())) { return null; }

    function inicioSe1(ano) {
      var primeiro = new Date(ano, 0, 1);
      var domingo = new Date(ano, 0, 1 - primeiro.getDay());
      /* Se a semana iniciada nesse domingo tem menos de 4 dias em janeiro,
         a SE 1 começa no domingo seguinte. */
      if (primeiro.getDay() > 3) { domingo.setDate(domingo.getDate() + 7); }
      return domingo;
    }

    var ano = data.getFullYear();
    var inicio = inicioSe1(ano);
    if (data < inicio) { ano -= 1; inicio = inicioSe1(ano); }

    var proximoInicio = inicioSe1(ano + 1);
    if (data >= proximoInicio) { ano += 1; inicio = proximoInicio; }

    var semana = Math.floor((data - inicio) / (7 * 24 * 60 * 60 * 1000)) + 1;
    return { ano: ano, semana: semana, rotulo: 'SE ' + String(semana).padStart(2, '0') + '/' + ano };
  }

  function competencia(texto) {
    var d = paraData(texto);
    if (!d || isNaN(d.getTime())) { return '—'; }
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
               'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  function competenciaPorExtenso(chave) {
    if (!chave || chave.indexOf('-') < 0) { return chave; }
    var p = chave.split('-');
    return MESES[Number(p[1]) - 1] + '/' + p[0];
  }

  /* ---------- classificação das fichas ---------- */

  function corDaClassificacao(classificacao) {
    var meta = HABE_CATALOGO.classificacoes[classificacao];
    return meta ? meta.cor : 'padrao';
  }

  function rotuloDaClassificacao(classificacao) {
    var meta = HABE_CATALOGO.classificacoes[classificacao];
    return meta ? meta.rotulo : classificacao;
  }

  function prazoDaClassificacao(classificacao) {
    var meta = HABE_CATALOGO.classificacoes[classificacao];
    return meta ? meta.prazo : '';
  }

  function seloClassificacao(ficha) {
    var cor = corDaClassificacao(ficha.classificacao);
    var simbolo = ficha.classificacao === 'imediata' ? '⏱'
                : ficha.classificacao === 'condicional' ? '⚠' : '📅';
    return '<span class="selo selo--' + cor + '">' + simbolo + ' ' +
           esc(rotuloDaClassificacao(ficha.classificacao)) + '</span>';
  }

  /* Prazo-limite concreto a partir da data de atendimento. */
  function prazoLimite(ficha, dataAtendimento) {
    var base = paraData(dataAtendimento) || new Date();
    var limite = new Date(base.getTime());
    if (ficha.classificacao === 'imediata') {
      limite.setDate(limite.getDate() + 1);
      return { data: limite, texto: 'até ' + formatarData(limite.toISOString()) + ' (24 horas)' };
    }
    limite.setDate(limite.getDate() + 7);
    return { data: limite, texto: 'até ' + formatarData(limite.toISOString()) + ' (7 dias)' };
  }

  function destinoNome(id) {
    for (var i = 0; i < HABE_CATALOGO.destinos.length; i++) {
      if (HABE_CATALOGO.destinos[i].id === id) { return HABE_CATALOGO.destinos[i].nome; }
    }
    return id || '—';
  }

  function destinoSigla(id) {
    for (var i = 0; i < HABE_CATALOGO.destinos.length; i++) {
      if (HABE_CATALOGO.destinos[i].id === id) { return HABE_CATALOGO.destinos[i].sigla; }
    }
    return '—';
  }

  /* ---------- avisos flutuantes ---------- */

  function torrada(mensagem, tipo, duracao) {
    var caixa = $('#avisosFlutuantes');
    if (!caixa) { return; }
    var item = document.createElement('div');
    item.className = 'torrada' + (tipo ? ' torrada--' + tipo : '');
    item.textContent = mensagem;
    caixa.appendChild(item);
    window.setTimeout(function () {
      item.style.transition = 'opacity .3s';
      item.style.opacity = '0';
      window.setTimeout(function () { item.remove(); }, 300);
    }, duracao || 4200);
  }

  /* ---------- painel lateral ---------- */

  function abrirPainel(titulo, corpoHtml, aoMontar) {
    var raiz = $('#painelDetalhe');
    raiz.innerHTML =
      '<div class="sobreposicao" id="sobreposicaoPainel">' +
        '<div class="painel" role="dialog" aria-modal="true" aria-label="' + esc(titulo) + '">' +
          '<div class="painel__cabecalho">' +
            '<h2 style="flex:1 1 auto">' + titulo + '</h2>' +
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
    document.body.style.overflow = 'hidden';

    if (typeof aoMontar === 'function') { aoMontar(raiz); }
  }

  function escFecha(evento) {
    if (evento.key === 'Escape') { fecharPainel(); }
  }

  function fecharPainel() {
    $('#painelDetalhe').innerHTML = '';
    document.body.style.overflow = '';
    document.removeEventListener('keydown', escFecha);
  }

  /* ---------- downloads ---------- */

  function baixarConteudo(nomeArquivo, conteudo, tipoMime) {
    var blob = (conteudo instanceof Blob) ? conteudo : new Blob([conteudo], { type: tipoMime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = nomeArquivo;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  /* Nome de arquivo previsível: FICHA_DENGUE_PRONT-12345_2026-08-06.pdf */
  function nomeArquivoFicha(ficha, solicitacao) {
    var pedaco = normalizar(ficha.nome).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').toUpperCase();
    var prontuario = (solicitacao && solicitacao.pacienteProntuario)
      ? '_PRONT-' + String(solicitacao.pacienteProntuario).replace(/[^\w-]/g, '') : '';
    var data = (solicitacao && solicitacao.dataAtendimento) ? '_' + solicitacao.dataAtendimento : '';
    return 'FICHA_' + pedaco + prontuario + data + '.pdf';
  }

  /* Entrega a ficha: prioriza o acervo local; se não houver, usa o link
     oficial do Ministério da Saúde. Devolve uma Promise com o desfecho. */
  function entregarFicha(ficha, solicitacao) {
    var nome = nomeArquivoFicha(ficha, solicitacao);

    /* Aberto por file:// — o navegador bloqueia fetch, então não há como saber
       de antemão se o PDF existe. O link vai para uma aba nova: se o arquivo
       estiver lá, baixa; se não estiver, o erro fica contido nessa aba em vez
       de derrubar o sistema, que é o que aconteceria navegando a própria
       página para um arquivo inexistente. */
    if (window.location.protocol === 'file:') {
      var a = document.createElement('a');
      a.href = ficha.arquivo;
      a.download = nome;
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      return Promise.resolve({ origem: 'local-sem-verificacao', nome: nome,
                               arquivo: ficha.arquivo });
    }

    return fetch(ficha.arquivo, { cache: 'no-store' })
      .then(function (resposta) {
        if (!resposta.ok) { throw new Error('sem acervo local'); }
        return resposta.blob();
      })
      .then(function (blob) {
        if (blob.size < 1024) { throw new Error('arquivo inválido'); }
        baixarConteudo(nome, blob, 'application/pdf');
        return { origem: 'local', nome: nome };
      })
      .catch(function () {
        if (ficha.urlOficial) {
          window.open(ficha.urlOficial, '_blank', 'noopener');
          return { origem: 'oficial', url: ficha.urlOficial };
        }
        window.open(HABE_CATALOGO.revisao.portalSinan, '_blank', 'noopener');
        return { origem: 'portal', url: HABE_CATALOGO.revisao.portalSinan };
      });
  }

  /* ---------- CSV ---------- */

  function paraCsv(linhas) {
    return linhas.map(function (linha) {
      return linha.map(function (celula) {
        var texto = (celula === null || celula === undefined) ? '' : String(celula);
        return '"' + texto.replace(/"/g, '""') + '"';
      }).join(';');
    }).join('\r\n');
  }

  function baixarCsv(nomeArquivo, linhas) {
    /* BOM para o Excel reconhecer o UTF-8. */
    baixarConteudo(nomeArquivo, '﻿' + paraCsv(linhas), 'text/csv;charset=utf-8');
  }

  /* ---------- leitura de arquivos ---------- */

  function lerArquivoBase64(arquivo) {
    return new Promise(function (resolver, rejeitar) {
      var leitor = new FileReader();
      leitor.onload = function () {
        var resultado = String(leitor.result);
        resolver(resultado.slice(resultado.indexOf(',') + 1));
      };
      leitor.onerror = function () { rejeitar(new Error('Não foi possível ler o arquivo.')); };
      leitor.readAsDataURL(arquivo);
    });
  }

  /* Reduz fotos grandes antes do envio, mantendo a legibilidade do documento. */
  function comprimirImagem(arquivo, larguraMaxima) {
    larguraMaxima = larguraMaxima || 2000;
    return new Promise(function (resolver) {
      if (arquivo.type.indexOf('image/') !== 0) { return resolver(null); }
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
        resolver(canvas.toDataURL('image/jpeg', 0.86).split(',')[1]);
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

  /* ---------- diversos ---------- */

  function ordenarPorNome(a, b) {
    return String(a.nome).localeCompare(String(b.nome), 'pt-BR', { sensitivity: 'base' });
  }

  /* Primeira letra do nome, sem acento — usada no sumário alfabético. */
  function inicial(nome) {
    var n = normalizar(nome).replace(/^[^a-z0-9]+/, '');
    var c = n.charAt(0).toUpperCase();
    return /[A-Z]/.test(c) ? c : '#';
  }

  return {
    $: $, $$: $$, esc: esc, normalizar: normalizar,
    hoje: hoje, paraData: paraData, formatarData: formatarData, formatarDataHora: formatarDataHora,
    semanaEpidemiologica: semanaEpidemiologica, competencia: competencia,
    competenciaPorExtenso: competenciaPorExtenso,
    corDaClassificacao: corDaClassificacao, rotuloDaClassificacao: rotuloDaClassificacao,
    prazoDaClassificacao: prazoDaClassificacao, seloClassificacao: seloClassificacao,
    prazoLimite: prazoLimite, destinoNome: destinoNome, destinoSigla: destinoSigla,
    torrada: torrada, abrirPainel: abrirPainel, fecharPainel: fecharPainel,
    baixarConteudo: baixarConteudo, nomeArquivoFicha: nomeArquivoFicha, entregarFicha: entregarFicha,
    paraCsv: paraCsv, baixarCsv: baixarCsv,
    lerArquivoBase64: lerArquivoBase64, comprimirImagem: comprimirImagem,
    formatarTamanho: formatarTamanho,
    ordenarPorNome: ordenarPorNome, inicial: inicial
  };
})();
