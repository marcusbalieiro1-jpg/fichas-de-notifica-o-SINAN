/* =========================================================================
   HABE SINAN — relatórios de fichas solicitadas
   -------------------------------------------------------------------------
   Levantamento quantitativo por período (mês e semana epidemiológica),
   por agravo, por prazo de notificação, por destino do paciente e por
   médico solicitante.
   ========================================================================= */

var Paginas = Paginas || {};

Paginas.relatorios = (function () {
  'use strict';

  var cache = [];
  var periodo = { de: '', ate: '' };

  /* ---------- agregações ---------- */

  function noPeriodo() {
    return cache.filter(function (s) {
      if (periodo.de && s.dataAtendimento < periodo.de) { return false; }
      if (periodo.ate && s.dataAtendimento > periodo.ate) { return false; }
      return true;
    });
  }

  function agrupar(lista, obterChave) {
    var mapa = {};
    lista.forEach(function (s) {
      var chave = obterChave(s);
      if (chave === null || chave === undefined || chave === '') { chave = '(não informado)'; }
      mapa[chave] = (mapa[chave] || 0) + 1;
    });
    return mapa;
  }

  function ordenarPorQuantidade(mapa) {
    return Object.keys(mapa)
      .map(function (chave) { return { chave: chave, total: mapa[chave] }; })
      .sort(function (a, b) { return b.total - a.total || a.chave.localeCompare(b.chave, 'pt-BR'); });
  }

  /* ---------- desenho ---------- */

  function barras(itens, corPorChave) {
    if (itens.length === 0) {
      return '<p style="color:var(--texto-suave);margin:0">Sem dados no período selecionado.</p>';
    }
    var maximo = itens[0].total || 1;
    return itens.map(function (item) {
      var cor = corPorChave ? corPorChave(item.chave) : '';
      return '' +
        '<div class="barra-linha">' +
          '<span class="barra-linha__rotulo" title="' + U.esc(item.chave) + '">' +
            U.esc(item.chave) + '</span>' +
          '<span class="barra-linha__trilho">' +
            '<span class="barra-linha__preenchimento' + (cor ? ' barra-linha__preenchimento--' + cor : '') +
              '" style="width:' + Math.max(2, Math.round(item.total / maximo * 100)) + '%"></span>' +
          '</span>' +
          '<span class="barra-linha__valor">' + item.total + '</span>' +
        '</div>';
    }).join('');
  }

  function tabelaPeriodos(lista) {
    var porMes = agrupar(lista, function (s) { return U.competencia(s.dataAtendimento); });
    var chaves = Object.keys(porMes).sort().reverse();
    if (chaves.length === 0) {
      return '<p style="color:var(--texto-suave)">Sem dados no período selecionado.</p>';
    }

    var linhas = chaves.map(function (chave) {
      var doMes = lista.filter(function (s) { return U.competencia(s.dataAtendimento) === chave; });
      var imediatas = doMes.filter(function (s) { return s.classificacaoEfetiva === 'imediata'; }).length;
      var comAnexo = doMes.filter(function (s) { return (s.anexos || []).length > 0; }).length;
      var percentual = doMes.length ? Math.round(comAnexo / doMes.length * 100) : 0;

      return '<tr>' +
        '<td><strong>' + U.esc(U.competenciaPorExtenso(chave)) + '</strong></td>' +
        '<td style="text-align:right">' + doMes.length + '</td>' +
        '<td style="text-align:right;color:var(--urgente);font-weight:700">' + imediatas + '</td>' +
        '<td style="text-align:right">' + (doMes.length - imediatas) + '</td>' +
        '<td style="text-align:right">' + comAnexo + ' <small style="color:var(--texto-suave)">(' +
          percentual + '%)</small></td>' +
      '</tr>';
    }).join('');

    return '<div class="tabela-rolagem"><table class="tabela">' +
      '<thead><tr><th>Mês de competência</th><th style="text-align:right">Total</th>' +
      '<th style="text-align:right">Imediatas</th><th style="text-align:right">Semanais</th>' +
      '<th style="text-align:right">Fichas devolvidas</th></tr></thead>' +
      '<tbody>' + linhas + '</tbody></table></div>';
  }

  function tabelaSemanas(lista) {
    var porSemana = {};
    lista.forEach(function (s) {
      var se = s.semanaEpidemiologica || (U.semanaEpidemiologica(s.dataAtendimento) || {}).rotulo;
      if (!se) { return; }
      if (!porSemana[se]) { porSemana[se] = { total: 0, imediatas: 0 }; }
      porSemana[se].total += 1;
      if (s.classificacaoEfetiva === 'imediata') { porSemana[se].imediatas += 1; }
    });

    var chaves = Object.keys(porSemana).sort(function (a, b) {
      /* 'SE 07/2026' -> ordena por ano e depois por semana. */
      var pa = a.match(/SE (\d+)\/(\d+)/), pb = b.match(/SE (\d+)\/(\d+)/);
      if (!pa || !pb) { return a.localeCompare(b); }
      return (pb[2] - pa[2]) || (pb[1] - pa[1]);
    }).slice(0, 20);

    if (chaves.length === 0) {
      return '<p style="color:var(--texto-suave)">Sem dados no período selecionado.</p>';
    }

    return '<div class="tabela-rolagem"><table class="tabela">' +
      '<thead><tr><th>Semana epidemiológica</th><th style="text-align:right">Solicitações</th>' +
      '<th style="text-align:right">Imediatas</th></tr></thead><tbody>' +
      chaves.map(function (chave) {
        return '<tr><td><strong>' + U.esc(chave) + '</strong></td>' +
          '<td style="text-align:right">' + porSemana[chave].total + '</td>' +
          '<td style="text-align:right;color:var(--urgente);font-weight:700">' +
            porSemana[chave].imediatas + '</td></tr>';
      }).join('') +
      '</tbody></table></div>' +
      '<p style="font-size:.8rem;color:var(--texto-suave);margin:.6rem 0 0">' +
      'Exibindo as 20 semanas epidemiológicas mais recentes do período.</p>';
  }

  /* ---------- exportação ---------- */

  function exportarConsolidado() {
    var lista = noPeriodo();
    var linhas = [['HABE SINAN — Consolidado de fichas solicitadas']];
    linhas.push(['Período', (periodo.de ? U.formatarData(periodo.de) : 'início'),
                 'a', (periodo.ate ? U.formatarData(periodo.ate) : 'hoje')]);
    linhas.push(['Gerado em', U.formatarDataHora(new Date().toISOString())]);
    linhas.push([]);

    function bloco(titulo, itens) {
      linhas.push([titulo, 'Quantidade']);
      itens.forEach(function (i) { linhas.push([i.chave, i.total]); });
      linhas.push([]);
    }

    bloco('Por agravo', ordenarPorQuantidade(agrupar(lista, function (s) { return s.fichaNome; })));
    bloco('Por mês de competência',
      ordenarPorQuantidade(agrupar(lista, function (s) {
        return U.competenciaPorExtenso(U.competencia(s.dataAtendimento));
      })));
    bloco('Por semana epidemiológica',
      ordenarPorQuantidade(agrupar(lista, function (s) { return s.semanaEpidemiologica; })));
    bloco('Por prazo de notificação',
      ordenarPorQuantidade(agrupar(lista, function (s) {
        return s.classificacaoEfetiva === 'imediata' ? 'Imediata (24 h)' : 'Semanal (7 dias)';
      })));
    bloco('Por destino do paciente',
      ordenarPorQuantidade(agrupar(lista, function (s) { return U.destinoNome(s.destino); })));
    bloco('Por médico solicitante',
      ordenarPorQuantidade(agrupar(lista, function (s) { return s.medicoNome; })));
    bloco('Por grupo de agravos',
      ordenarPorQuantidade(agrupar(lista, function (s) { return s.fichaGrupo; })));

    U.baixarCsv('habe-sinan-relatorio-' + U.hoje() + '.csv', linhas);
    U.torrada('Relatório exportado.', 'sucesso');
  }

  /* ---------- página ---------- */

  function desenhar(elemento) {
    var lista = noPeriodo();
    var imediatas = lista.filter(function (s) { return s.classificacaoEfetiva === 'imediata'; }).length;
    var comAnexo = lista.filter(function (s) { return (s.anexos || []).length > 0; }).length;
    var devolucao = lista.length ? Math.round(comAnexo / lista.length * 100) : 0;

    U.$('#indicadoresRelatorio', elemento).innerHTML = '' +
      '<div class="indicador indicador--padrao">' +
        '<div class="indicador__rotulo">Fichas solicitadas</div>' +
        '<div class="indicador__valor">' + lista.length + '</div>' +
        '<div class="indicador__nota">no período selecionado</div></div>' +
      '<div class="indicador indicador--urgente">' +
        '<div class="indicador__rotulo">Notificação imediata</div>' +
        '<div class="indicador__valor">' + imediatas + '</div>' +
        '<div class="indicador__nota">' +
          (lista.length ? Math.round(imediatas / lista.length * 100) : 0) + '% do total</div></div>' +
      '<div class="indicador indicador--atencao">' +
        '<div class="indicador__rotulo">Notificação semanal</div>' +
        '<div class="indicador__valor">' + (lista.length - imediatas) + '</div>' +
        '<div class="indicador__nota">prazo de 7 dias</div></div>' +
      '<div class="indicador indicador--sucesso">' +
        '<div class="indicador__rotulo">Fichas devolvidas</div>' +
        '<div class="indicador__valor">' + devolucao + '%</div>' +
        '<div class="indicador__nota">' + comAnexo + ' de ' + lista.length +
          ' com digitalização anexada</div></div>';

    U.$('#porPeriodo', elemento).innerHTML = tabelaPeriodos(lista);
    U.$('#porSemana', elemento).innerHTML = tabelaSemanas(lista);

    U.$('#porAgravo', elemento).innerHTML = barras(
      ordenarPorQuantidade(agrupar(lista, function (s) { return s.fichaNome; })).slice(0, 15),
      function (nome) {
        var s = lista.filter(function (x) { return x.fichaNome === nome; })[0];
        return (s && s.classificacaoEfetiva === 'imediata') ? 'urgente' : '';
      });

    U.$('#porGrupo', elemento).innerHTML = barras(
      ordenarPorQuantidade(agrupar(lista, function (s) { return s.fichaGrupo; })));

    U.$('#porDestino', elemento).innerHTML = barras(
      ordenarPorQuantidade(agrupar(lista, function (s) { return U.destinoNome(s.destino); })));

    U.$('#porMedico', elemento).innerHTML = barras(
      ordenarPorQuantidade(agrupar(lista, function (s) { return s.medicoNome; })).slice(0, 15));

    U.$('#rotuloPeriodo', elemento).textContent =
      (periodo.de ? U.formatarData(periodo.de) : 'início dos registros') + ' até ' +
      (periodo.ate ? U.formatarData(periodo.ate) : 'hoje');
  }

  function aplicarAtalho(chave) {
    var agora = new Date();
    if (chave === 'mes') {
      periodo.de = agora.getFullYear() + '-' + String(agora.getMonth() + 1).padStart(2, '0') + '-01';
      periodo.ate = U.hoje();
    } else if (chave === '30dias') {
      var trinta = new Date(agora.getTime() - 29 * 86400000);
      periodo.de = trinta.getFullYear() + '-' + String(trinta.getMonth() + 1).padStart(2, '0') +
                   '-' + String(trinta.getDate()).padStart(2, '0');
      periodo.ate = U.hoje();
    } else if (chave === 'ano') {
      periodo.de = agora.getFullYear() + '-01-01';
      periodo.ate = U.hoje();
    } else {
      periodo.de = '';
      periodo.ate = '';
    }
  }

  function render(elemento) {
    elemento.innerHTML = '' +
      '<div class="pagina__cabecalho">' +
        '<h1 id="t-relatorios">Relatórios</h1>' +
        '<p>Levantamento das fichas solicitadas por período, agravo, prazo, destino e médico.</p>' +
      '</div>' +

      '<div class="cartao nao-imprimir">' +
        '<div class="filtros" style="margin-bottom:.8rem">' +
          '<button class="filtro" data-atalho="mes" type="button">Este mês</button>' +
          '<button class="filtro" data-atalho="30dias" type="button">Últimos 30 dias</button>' +
          '<button class="filtro" data-atalho="ano" type="button">Este ano</button>' +
          '<button class="filtro filtro--ativo" data-atalho="tudo" type="button">Todo o histórico</button>' +
        '</div>' +
        '<div class="grade grade--3" style="gap:.7rem 1rem">' +
          '<div class="campo" style="margin:0"><label for="relDe">Data inicial</label>' +
            '<input type="date" id="relDe"></div>' +
          '<div class="campo" style="margin:0"><label for="relAte">Data final</label>' +
            '<input type="date" id="relAte"></div>' +
          '<div class="campo" style="margin:0;display:flex;align-items:flex-end;gap:.5rem">' +
            '<button class="botao botao--bloco" id="botaoExportarRelatorio" type="button">' +
              '⬇ Exportar CSV</button>' +
            '<button class="botao botao--secundario" id="botaoImprimirRelatorio" type="button" ' +
              'title="Imprimir">🖨</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<p style="font-size:.9rem;color:var(--texto-suave);margin-bottom:.8rem">' +
        'Período analisado: <strong id="rotuloPeriodo"></strong></p>' +

      '<div class="grade grade--4" id="indicadoresRelatorio" style="margin-bottom:1.2rem"></div>' +

      '<div class="cartao"><h2 style="font-size:1.05rem">Solicitações por mês de competência</h2>' +
        '<div id="porPeriodo"></div></div>' +

      '<div class="cartao"><h2 style="font-size:1.05rem">Solicitações por semana epidemiológica</h2>' +
        '<div id="porSemana"></div></div>' +

      '<div class="grade grade--2">' +
        '<div class="cartao"><h2 style="font-size:1.05rem">Agravos mais solicitados</h2>' +
          '<p style="font-size:.83rem;color:var(--texto-suave)">Barras em vermelho indicam ' +
            'agravos de notificação imediata.</p>' +
          '<div id="porAgravo"></div></div>' +
        '<div class="cartao"><h2 style="font-size:1.05rem">Por grupo de agravos</h2>' +
          '<div id="porGrupo"></div></div>' +
        '<div class="cartao"><h2 style="font-size:1.05rem">Destino do paciente</h2>' +
          '<div id="porDestino"></div></div>' +
        '<div class="cartao"><h2 style="font-size:1.05rem">Médicos solicitantes</h2>' +
          '<div id="porMedico"></div></div>' +
      '</div>';

    U.$$('[data-atalho]', elemento).forEach(function (botao) {
      botao.addEventListener('click', function () {
        U.$$('[data-atalho]', elemento).forEach(function (b) { b.classList.remove('filtro--ativo'); });
        botao.classList.add('filtro--ativo');
        aplicarAtalho(botao.getAttribute('data-atalho'));
        U.$('#relDe', elemento).value = periodo.de;
        U.$('#relAte', elemento).value = periodo.ate;
        desenhar(elemento);
      });
    });

    ['relDe', 'relAte'].forEach(function (id) {
      U.$('#' + id, elemento).addEventListener('change', function () {
        periodo.de = U.$('#relDe', elemento).value;
        periodo.ate = U.$('#relAte', elemento).value;
        U.$$('[data-atalho]', elemento).forEach(function (b) { b.classList.remove('filtro--ativo'); });
        desenhar(elemento);
      });
    });

    U.$('#botaoExportarRelatorio', elemento).addEventListener('click', exportarConsolidado);
    U.$('#botaoImprimirRelatorio', elemento).addEventListener('click', function () { window.print(); });

    U.$('#relDe', elemento).value = periodo.de;
    U.$('#relAte', elemento).value = periodo.ate;

    Armazenamento.listarSolicitacoes().then(function (lista) {
      cache = lista || [];
      desenhar(elemento);
    }).catch(function (erro) {
      U.$('#indicadoresRelatorio', elemento).innerHTML =
        '<div class="aviso aviso--urgente"><span class="aviso__icone">⚠</span><div>' +
        U.esc(erro.message) + '</div></div>';
    });
  }

  return { render: render };
})();
