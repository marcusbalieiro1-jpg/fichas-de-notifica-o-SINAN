/* =========================================================================
   HABE – AQS e NSP — Relatórios
   Cumprimento das missões num período: indicadores gerais, por militar,
   por setor e por atividade, e a lista das atrasadas em aberto. Exporta CSV
   (resumo por atividade e lista detalhada de ocorrências), imprime / salva
   em PDF com cabeçalho institucional e, para os gestores, gera a cópia de
   segurança completa (JSON).

   Conta como no resto do sistema (Regras.conformidade):
   * previstas = ocorrências do período, menos as "não se aplica";
   * % de cumprimento = concluídas ÷ as que já venceram (prazo até hoje, sem
     prazo ou já concluídas) — o que ainda está no prazo não pesa contra;
   * % no prazo = concluídas dentro do prazo ÷ as que já venceram.
   O período filtra pela data de referência da ocorrência (o prazo; ou o
   dia do registro, nas execuções sem prazo). A atribuição por militar usa
   os responsáveis ATUAIS de cada atividade: uma ocorrência com dois
   responsáveis conta para os dois.
   Ver docs/ARQUITETURA.md, seções 4, 5 e 6.
   ========================================================================= */

Paginas.relatorios = (function () {
  'use strict';

  var CHAVE_PERIODO = 'aqs_relatorios_periodo';
  var TABELAS = ['ocorrencias', 'atividades', 'atividade_responsaveis', 'militares', 'setores'];
  var PERIODOS = [
    { valor: 'mes', rotulo: 'Este mês' },
    { valor: 'mes_anterior', rotulo: 'Mês anterior' },
    { valor: 'tres_meses', rotulo: 'Últimos 3 meses' },
    { valor: 'ano', rotulo: 'Este ano' },
    { valor: 'personalizado', rotulo: 'Personalizado' }
  ];
  var MAX_DIAS = 1100; /* ~3 anos: mais que isso pesa no navegador */
  var ID_VALIDO = /^[0-9A-Za-z_-]{1,64}$/;

  var geracao = 0;
  var carga = 0;
  var periodo = null;   /* { tipo, de, ate } — de/ate só no personalizado */
  /* Últimos dados: { intervalo, ocorrencias, anteriores, ref, atividades, hoje } */
  var dados = null;

  /* ---------- auxiliares ---------- */

  function icone(nome) {
    return '<svg class="icone" aria-hidden="true" focusable="false"><use href="#i-' + nome + '"></use></svg>';
  }

  function temPropria(objeto, chave) {
    return !!objeto && Object.prototype.hasOwnProperty.call(objeto, chave);
  }

  function contem(lista, valor) {
    return Array.isArray(lista) && lista.indexOf(valor) >= 0;
  }

  function plural(n, singular, varios) {
    return n + ' ' + (n === 1 ? singular : varios);
  }

  function maiuscula(texto) {
    texto = String(texto || '');
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }

  function vigente(el, minhaGeracao, minhaCarga) {
    return minhaGeracao === geracao && (minhaCarga === undefined || minhaCarga === carga) &&
      !!App.militar() && !el.classList.contains('oculto') && !!U.$('.pagina-relatorios', el);
  }

  function doisDigitos(n) { return (n < 10 ? '0' : '') + n; }

  function primeiroDia(ano, mes) { return ano + '-' + doisDigitos(mes) + '-01'; }

  function ultimoDia(ano, mes) {
    return ano + '-' + doisDigitos(mes) + '-' + doisDigitos(Recorrencia.ultimoDiaDoMes(ano, mes));
  }

  /* Mês deslocado: (2026, 10, −2) → { ano: 2026, mes: 8 }. */
  function somarMeses(ano, mes, n) {
    var indice = ano * 12 + (mes - 1) + n;
    return { ano: Math.floor(indice / 12), mes: indice % 12 + 1 };
  }

  function porcentagem(valor) {
    return (valor === null || valor === undefined) ? '—' : valor + '%';
  }

  /* ---------- período ---------- */

  function periodoPadrao() { return { tipo: 'mes', de: '', ate: '' }; }

  function lerPeriodo() {
    var p = periodoPadrao();
    try {
      var salvo = JSON.parse(window.sessionStorage.getItem(CHAVE_PERIODO) || 'null');
      if (salvo && PERIODOS.some(function (x) { return x.valor === salvo.tipo; })) {
        p.tipo = salvo.tipo;
        if (Recorrencia.dataValida(salvo.de)) { p.de = salvo.de; }
        if (Recorrencia.dataValida(salvo.ate)) { p.ate = salvo.ate; }
      }
    } catch (e) { /* sem armazenamento: padrão */ }
    if (p.tipo === 'personalizado' && !(p.de && p.ate && p.de <= p.ate)) { p.tipo = 'mes'; }
    return p;
  }

  function gravarPeriodo() {
    try { window.sessionStorage.setItem(CHAVE_PERIODO, JSON.stringify(periodo)); } catch (e) { /* vale só agora */ }
  }

  /* { de, ate, rotulo } do período escolhido, a partir de hoje (Belém). */
  function intervalo(p, hoje) {
    var ano = Number(hoje.slice(0, 4));
    var mes = Number(hoje.slice(5, 7));
    if (p.tipo === 'mes_anterior') {
      var ant = somarMeses(ano, mes, -1);
      return { de: primeiroDia(ant.ano, ant.mes), ate: ultimoDia(ant.ano, ant.mes),
               rotulo: maiuscula(U.mesPorExtenso(ant.ano + '-' + doisDigitos(ant.mes))) };
    }
    if (p.tipo === 'tres_meses') {
      var ini = somarMeses(ano, mes, -2);
      return { de: primeiroDia(ini.ano, ini.mes), ate: ultimoDia(ano, mes),
               rotulo: maiuscula(U.MESES[ini.mes - 1]) + (ini.ano !== ano ? ' de ' + ini.ano : '') + ' a ' +
                 U.mesPorExtenso(ano + '-' + doisDigitos(mes)) };
    }
    if (p.tipo === 'ano') {
      return { de: ano + '-01-01', ate: ano + '-12-31', rotulo: 'Ano de ' + ano };
    }
    if (p.tipo === 'personalizado' && p.de && p.ate) {
      return { de: p.de, ate: p.ate, rotulo: U.formatarData(p.de) + ' a ' + U.formatarData(p.ate) };
    }
    return { de: primeiroDia(ano, mes), ate: ultimoDia(ano, mes), rotulo: maiuscula(U.mesPorExtenso(ano + '-' + doisDigitos(mes))) };
  }

  function descricaoIntervalo(iv) {
    return iv.rotulo + ' (' + U.formatarData(iv.de) + ' a ' + U.formatarData(iv.ate) + ')';
  }

  /* ---------- contas ---------- */

  function estatisticas(ocorrencias, hoje) {
    var c = Regras.conformidade(ocorrencias, hoje);
    var previstas = ocorrencias.filter(function (oc) { return oc.status !== 'nao_se_aplica'; }).length;
    return {
      previstas: previstas,
      nao_se_aplica: ocorrencias.length - previstas,
      universo: c.universo,
      concluidas: c.concluidas,
      no_prazo: c.no_prazo,
      atrasadas: c.atrasadas,
      percentual: c.percentual,
      pct_prazo: c.universo ? Math.round(100 * c.no_prazo / c.universo) : null
    };
  }

  function agruparPorMilitar(d) {
    var ref = d.ref;
    var grupos = {};
    var ordem = [];
    function grupo(id) {
      if (!grupos[id]) { grupos[id] = []; ordem.push(id); }
      return grupos[id];
    }
    Regras.militaresAtribuiveis(ref.militares).forEach(function (m) { grupo(m.id); });
    var semResponsavel = [];
    d.ocorrencias.forEach(function (oc) {
      var ids = Array.isArray(oc.responsaveis) ? oc.responsaveis : [];
      if (!ids.length) { semResponsavel.push(oc); return; }
      ids.forEach(function (id) { grupo(id).push(oc); });
    });
    var linhas = ordem.map(function (id) {
      var m = temPropria(ref.mapaMilitares, id) ? ref.mapaMilitares[id] : null;
      var nome = m ? Regras.nomeMilitar(m) + (m.ativo === false ? ' (desativado)' : '') : 'Militar não encontrado';
      return { chave: id, rotulo: nome, stats: estatisticas(grupos[id], d.hoje) };
    });
    linhas.sort(function (a, b) { return U.ordenarTexto(a.rotulo, b.rotulo); });
    if (semResponsavel.length) {
      linhas.push({ chave: 'sem', rotulo: 'Sem responsável', stats: estatisticas(semResponsavel, d.hoje), especial: true });
    }
    return linhas;
  }

  function agruparPorSetor(d) {
    var ref = d.ref;
    var grupos = U.agrupar(d.ocorrencias, function (oc) { return oc.setor_id || 'sem'; });
    var linhas = Object.keys(grupos).map(function (id) {
      var s = id !== 'sem' && temPropria(ref.mapaSetores, id) ? ref.mapaSetores[id] : null;
      return {
        chave: id,
        rotulo: s ? s.sigla + ' — ' + s.nome : (id === 'sem' ? 'Sem setor' : 'Setor excluído'),
        ordem: s ? Number(s.ordem) || 0 : 9999,
        stats: estatisticas(grupos[id], d.hoje)
      };
    });
    linhas.sort(function (a, b) { return (a.ordem - b.ordem) || U.ordenarTexto(a.rotulo, b.rotulo); });
    return linhas;
  }

  function agruparPorAtividade(d) {
    var mapa = {};
    d.atividades.forEach(function (a) { mapa[a.id] = a; });
    var grupos = U.agrupar(d.ocorrencias, function (oc) { return oc.atividade_id; });
    var linhas = Object.keys(grupos).map(function (id) {
      var a = mapa[id] || null;
      var primeira = grupos[id][0];
      return {
        chave: id,
        atividade: a,
        ordem: a ? Number(a.ordem) || 0 : 99999,
        rotulo: a ? a.titulo : (primeira.atividade_titulo || 'Atividade'),
        stats: estatisticas(grupos[id], d.hoje)
      };
    });
    linhas.sort(function (a, b) { return (a.ordem - b.ordem) || U.ordenarTexto(a.rotulo, b.rotulo); });
    return linhas;
  }

  function atrasadas(lista, hoje) {
    return lista.filter(function (oc) { return Regras.estaAtrasada(oc, hoje); }).sort(function (a, b) {
      return String(a.prazo) < String(b.prazo) ? -1 : (String(a.prazo) > String(b.prazo) ? 1 : 0);
    });
  }

  /* ---------- página ---------- */

  function cabecalhoImpressaoHtml() {
    return '<div class="cabecalho-impressao cabecalho-impressao--documento">' +
      '<img src="assets/img/logo-habe.svg" alt="" width="45" height="54">' +
      '<div>' +
        '<strong>COMANDO DA AERONÁUTICA — HOSPITAL DE AERONÁUTICA DE BELÉM</strong>' +
        '<span>AQS e NSP — Relatório de Atividades</span>' +
        '<span id="relPeriodoImpressao"></span>' +
      '</div>' +
    '</div>';
  }

  function render(el) {
    geracao += 1;
    dados = null;
    periodo = lerPeriodo();
    var eu = App.militar();
    var gestor = Regras.eGestor(eu);
    el.innerHTML = '<div class="pagina-relatorios">' +
      cabecalhoImpressaoHtml() +
      '<div class="pagina__cabecalho pagina__cabecalho--acoes nao-imprimir">' +
        '<div><h1>Relatórios</h1><p>Cumprimento das missões no período: geral, por militar, por setor e por atividade.</p></div>' +
        '<div class="acoes acoes--topo">' +
          '<button type="button" class="botao botao--secundario" data-acao="imprimir">Imprimir / Salvar PDF</button>' +
          (gestor ? '<button type="button" class="botao botao--secundario" data-acao="exportar" ' +
            'title="Cópia de segurança de todas as tabelas (sem os arquivos de evidência)">Exportar tudo (JSON)</button>' : '') +
        '</div>' +
      '</div>' +
      '<div class="cartao filtros-gestao nao-imprimir">' +
        '<div class="segmentos" role="group" aria-label="Período do relatório">' +
          PERIODOS.map(function (p) {
            var ativo = periodo.tipo === p.valor;
            return '<button type="button" class="segmentos__opcao' + (ativo ? ' segmentos__opcao--ativa' : '') +
              '" data-periodo="' + p.valor + '" aria-pressed="' + (ativo ? 'true' : 'false') + '">' + U.esc(p.rotulo) + '</button>';
          }).join('') +
        '</div>' +
        '<form class="periodo-personalizado' + (periodo.tipo === 'personalizado' ? '' : ' oculto') + '" id="relPersonalizado" novalidate>' +
          '<label class="campo campo--compacto"><span class="campo__rotulo">De</span>' +
            '<input type="date" id="relDe" value="' + U.esc(periodo.de) + '"></label>' +
          '<label class="campo campo--compacto"><span class="campo__rotulo">Até</span>' +
            '<input type="date" id="relAte" value="' + U.esc(periodo.ate) + '"></label>' +
          '<button type="submit" class="botao botao--pequeno">Aplicar</button>' +
          '<p class="campo__erro-livre" id="relPeriodoErro" role="alert"></p>' +
        '</form>' +
        '<div class="acoes acoes--exportar">' +
          '<button type="button" class="botao botao--secundario botao--pequeno" data-acao="csv-resumo">CSV — resumo por atividade</button>' +
          '<button type="button" class="botao botao--secundario botao--pequeno" data-acao="csv-detalhado">CSV — ocorrências (detalhado)</button>' +
        '</div>' +
      '</div>' +
      '<p class="relatorio-periodo" id="relPeriodo"></p>' +
      '<div id="relConteudo"><div class="carregando" role="status">Calculando o relatório…</div></div>' +
      '<div class="rodape-impressao" data-rodape-relatorio></div>' +
    '</div>';
    ligar(el);
    carregar(el);
  }

  function aoVivo(el, params, tabelas) {
    if (Array.isArray(tabelas) && !tabelas.some(function (t) { return contem(TABELAS, t); })) { return; }
    if (!U.$('.pagina-relatorios', el) || !periodo) { render(el, params); return; }
    carregar(el);
  }

  function carregar(el) {
    var minhaGeracao = geracao;
    var minhaCarga = ++carga;
    var hoje = U.hojeBelem();
    var iv = intervalo(periodo, hoje);
    U.$('#relPeriodo', el).textContent = 'Período: ' + descricaoIntervalo(iv);
    U.$('#relPeriodoImpressao', el).textContent = 'Período: ' + descricaoIntervalo(iv);
    Promise.all([
      Api.listarOcorrencias({ de: iv.de, ate: iv.ate }),
      Api.referencias(),
      Api.listarAtividades(),
      Api.listarOcorrencias({ somenteAbertas: true })
    ]).then(function (r) {
      if (!vigente(el, minhaGeracao, minhaCarga)) { return; }
      /* Mesmo critério do Início e do Quadro: as missões ainda em aberto de
         uma atividade arquivada saem das contas — ninguém vai mais cumpri-las,
         e contá-las como atrasadas para sempre distorceria o cumprimento. As
         já concluídas continuam no histórico. */
      var arquivadas = {};
      (r[2] || []).forEach(function (a) { if (a.ativa === false) { arquivadas[a.id] = true; } });
      function valeParaContas(oc) {
        return !(arquivadas[oc.atividade_id] && Regras.estaAberta(oc));
      }
      var ocorrencias = (r[0] || []).filter(function (oc) {
        var ref = String(oc.data_ref || oc.prazo || '').slice(0, 10);
        return valeParaContas(oc) && (!ref || (ref >= iv.de && ref <= iv.ate));
      });
      /* Atrasadas que vêm de antes do período e continuam em aberto. */
      var anteriores = atrasadas((r[3] || []).filter(function (oc) {
        return valeParaContas(oc) && String(oc.data_ref || oc.prazo || '').slice(0, 10) < iv.de;
      }), hoje);
      dados = { intervalo: iv, ocorrencias: ocorrencias, anteriores: anteriores, ref: r[1], atividades: r[2] || [], hoje: hoje };
      desenhar(el);
    }).catch(function (erro) {
      if (!vigente(el, minhaGeracao, minhaCarga)) { return; }
      U.falha(erro);
      U.$('#relConteudo', el).innerHTML = '<div class="aviso aviso--urgente" role="alert"><span class="aviso__icone">' +
        icone('alerta') + '</span><div><strong>Não foi possível montar o relatório</strong>' + U.esc(U.erroTexto(erro)) +
        '</div></div><div class="acoes nao-imprimir"><button type="button" class="botao botao--secundario" data-acao="tentar">' +
        'Tentar novamente</button></div>';
    });
  }

  /* ---------- desenho ---------- */

  function indicadorHtml(classe, rotulo, valor, nota) {
    return '<div class="indicador ' + classe + '">' +
      '<div class="indicador__rotulo">' + U.esc(rotulo) + '</div>' +
      '<div class="indicador__valor">' + U.esc(valor) + '</div>' +
      (nota ? '<div class="indicador__nota">' + U.esc(nota) + '</div>' : '') +
    '</div>';
  }

  function classeBarra(pct) {
    if (pct === null || pct === undefined) { return ''; }
    if (pct >= 90) { return ' barra-linha__preenchimento--otimo'; }
    if (pct < 50) { return ' barra-linha__preenchimento--urgente'; }
    if (pct < 75) { return ' barra-linha__preenchimento--atencao'; }
    return '';
  }

  function barrasHtml(linhas, rotuloGrupo) {
    var comDados = linhas.filter(function (l) { return l.stats.previstas > 0 || l.stats.concluidas > 0; });
    if (!comDados.length) { return ''; }
    return '<div class="barras-relatorio" role="list" aria-label="% de cumprimento ' + U.esc(rotuloGrupo) + '">' +
      comDados.map(function (l) {
        var pct = l.stats.percentual;
        return '<div class="barra-linha" role="listitem">' +
          '<span class="barra-linha__rotulo" title="' + U.esc(l.rotulo) + '">' + U.esc(l.rotulo) + '</span>' +
          '<div class="barra-linha__trilho"><div class="barra-linha__preenchimento' + classeBarra(pct) +
            '" data-largura="' + (pct === null ? 0 : pct) + '"></div></div>' +
          '<span class="barra-linha__valor">' + U.esc(porcentagem(pct)) + '</span>' +
        '</div>';
      }).join('') +
    '</div>';
  }

  /* Tabela que vira cartões no celular (cada célula leva o rótulo). */
  function tabelaHtml(legenda, colunas, linhas, opcoes) {
    opcoes = opcoes || {};
    return '<div class="tabela-rolagem"><table class="tabela tabela--gestao tabela-cartoes' +
        (opcoes.clicavel ? ' tabela--clicavel' : '') + (opcoes.estatisticas ? ' tabela-estatisticas' : '') + '">' +
      '<caption class="so-leitor-tela">' + U.esc(legenda) + '</caption>' +
      '<thead><tr>' + colunas.map(function (c) {
        return '<th scope="col"' + (c.numero ? ' class="col-numerica"' : '') + '>' + U.esc(c.rotulo) + '</th>';
      }).join('') + '</tr></thead>' +
      '<tbody>' + linhas.join('') + '</tbody>' +
      (opcoes.rodape ? '<tfoot>' + opcoes.rodape + '</tfoot>' : '') +
    '</table></div>';
  }

  function celula(rotulo, conteudoHtml, numero, classeExtra) {
    return '<td data-rotulo="' + U.esc(rotulo) + '" class="' + (numero ? 'col-numerica' : '') + (classeExtra ? ' ' + classeExtra : '') + '">' +
      conteudoHtml + '</td>';
  }

  var COLUNAS_STATS = [
    { rotulo: 'Previstas', numero: true }, { rotulo: 'Concluídas', numero: true },
    { rotulo: 'No prazo', numero: true }, { rotulo: 'Atrasadas', numero: true }, { rotulo: '% cumprimento', numero: true }
  ];

  /* 'col-estatistica': no celular, os cinco números ficam lado a lado, como
     um placar (telas-gestao.css), em vez de um por linha. */
  function celulasStats(s) {
    return celula('Previstas', String(s.previstas), true, 'col-estatistica') +
      celula('Concluídas', String(s.concluidas), true, 'col-estatistica') +
      celula('No prazo', String(s.no_prazo), true, 'col-estatistica') +
      celula('Atrasadas', s.atrasadas ? '<strong class="texto-urgente-gestao">' + s.atrasadas + '</strong>' : '0', true, 'col-estatistica') +
      celula('% cumprim.', '<strong>' + U.esc(porcentagem(s.percentual)) + '</strong>', true, 'col-estatistica');
  }

  function secaoGrupoHtml(titulo, iconeNome, linhas, rotuloColuna, vazio) {
    var corpo;
    if (!linhas.length) {
      corpo = '<p class="texto-suave texto-pequeno mb-0">' + U.esc(vazio) + '</p>';
    } else {
      corpo = barrasHtml(linhas, titulo.toLowerCase()) +
        tabelaHtml(titulo, [{ rotulo: rotuloColuna }].concat(COLUNAS_STATS), linhas.map(function (l) {
          return '<tr' + (l.especial ? ' class="linha-destaque"' : '') + '>' +
            celula(rotuloColuna, '<strong>' + U.esc(l.rotulo) + '</strong>', false, 'col-principal') +
            celulasStats(l.stats) + '</tr>';
        }), { estatisticas: true });
    }
    return '<section class="cartao secao-relatorio">' +
      '<div class="cartao__titulo"><h2>' + icone(iconeNome) + U.esc(titulo) + '</h2></div>' + corpo +
    '</section>';
  }

  function secaoAtividadesHtml(linhas) {
    var corpo = !linhas.length ? '<p class="texto-suave texto-pequeno mb-0">Nenhuma atividade com ocorrências no período.</p>'
      : tabelaHtml('Por atividade', [{ rotulo: 'Nº', numero: true }, { rotulo: 'Atividade' }].concat(COLUNAS_STATS),
        linhas.map(function (l) {
          var a = l.atividade;
          return '<tr>' +
            celula('Nº', a && a.ordem !== null && a.ordem !== undefined ? U.esc(a.ordem) : '—', true, 'col-ordem') +
            celula('Atividade', (a && a.ordem !== null && a.ordem !== undefined
                ? '<span class="so-celular texto-suave">' + U.esc(a.ordem) + '. </span>' : '') +
              '<strong>' + U.esc(l.rotulo) + '</strong>' +
              (a ? '<span class="linha-regra">' + U.esc(Regras.descreverRegra(a)) + '</span>' : ''), false, 'col-principal') +
            celulasStats(l.stats) + '</tr>';
        }), { estatisticas: true });
    return '<section class="cartao secao-relatorio">' +
      '<div class="cartao__titulo"><h2>' + icone('atividades') + 'Por atividade</h2></div>' + corpo + '</section>';
  }

  function secaoAtrasadasHtml(lista, d) {
    var mapa = d.ref.mapaMilitares || {};
    var corpo;
    if (!lista.length) {
      corpo = '<p class="texto-sucesso-gestao texto-pequeno mb-0">' + icone('check') + 'Nenhuma missão atrasada em aberto no período.</p>';
    } else {
      corpo = tabelaHtml('Atrasadas em aberto', [
        { rotulo: 'Missão' }, { rotulo: 'Referência' }, { rotulo: 'Prazo' }, { rotulo: 'Dias de atraso', numero: true },
        { rotulo: 'Responsáveis' }
      ], lista.map(function (oc) {
        var dias = U.diasEntre(oc.prazo, d.hoje);
        return '<tr class="linha-clicavel" data-ocorrencia="' + U.esc(oc.id) + '">' +
          celula('Missão', '<button type="button" class="link-titulo" data-ocorrencia="' + U.esc(oc.id) + '">' +
            U.esc(oc.atividade_titulo || 'Atividade') + '</button>' +
            (oc.titulo_execucao ? '<span class="linha-regra">' + U.esc(oc.titulo_execucao) + '</span>' : ''), false, 'col-principal') +
          celula('Referência', U.esc(Regras.rotuloReferencia(oc))) +
          celula('Prazo', U.esc(U.formatarData(oc.prazo))) +
          celula('Dias de atraso', '<strong class="texto-urgente-gestao">' + dias + '</strong>', true) +
          celula('Responsáveis', U.esc(Regras.nomesResponsaveis(oc.responsaveis, mapa))) +
        '</tr>';
      }), { clicavel: true });
    }
    var anteriores = d.anteriores.length
      ? '<p class="texto-pequeno mt-1 mb-0">' + icone('alerta') + ' Além destas, ' +
          U.esc(plural(d.anteriores.length, 'missão atrasada de antes do período continua', 'missões atrasadas de antes do período continuam')) +
          ' em aberto (desde ' + U.esc(U.formatarData(d.anteriores[0].prazo)) + ').</p>'
      : '';
    return '<section class="cartao secao-relatorio">' +
      '<div class="cartao__titulo"><h2>' + icone('relogio') + 'Atrasadas em aberto</h2>' +
        (lista.length ? '<span class="contador contador--urgente">' + lista.length + '</span>' : '') + '</div>' +
      corpo + anteriores + '</section>';
  }

  function desenhar(el) {
    var d = dados;
    if (!d) { return; }
    var caixa = U.$('#relConteudo', el);
    var geral = estatisticas(d.ocorrencias, d.hoje);
    var lista = atrasadas(d.ocorrencias, d.hoje);

    var indicadores = '<div class="indicadores-relatorio">' +
      indicadorHtml('indicador--padrao', 'Previstas', String(geral.previstas),
        geral.nao_se_aplica ? plural(geral.nao_se_aplica, 'marcada "não se aplica"', 'marcadas "não se aplica"') : 'no período') +
      indicadorHtml('indicador--sucesso', 'Concluídas', String(geral.concluidas), plural(geral.no_prazo, 'no prazo', 'no prazo')) +
      indicadorHtml(geral.percentual === null ? 'indicador--padrao' : (geral.percentual >= 75 ? 'indicador--sucesso' : (geral.percentual >= 50 ? 'indicador--atencao' : 'indicador--urgente')),
        '% cumprimento', porcentagem(geral.percentual),
        geral.universo ? 'de ' + plural(geral.universo, 'já vencida', 'já vencidas') : 'nada vencido ainda') +
      indicadorHtml('indicador--padrao', '% no prazo', porcentagem(geral.pct_prazo), 'concluídas dentro do prazo') +
      indicadorHtml(lista.length ? 'indicador--urgente' : 'indicador--sucesso', 'Atrasadas em aberto', String(lista.length),
        d.anteriores.length ? '+ ' + d.anteriores.length + ' de antes do período' : 'no período') +
    '</div>';

    if (!d.ocorrencias.length) {
      caixa.innerHTML = indicadores +
        '<div class="vazio"><span class="vazio__icone">' + icone('relatorios') + '</span>' +
          '<strong>Nenhuma ocorrência no período</strong>' +
          '<p>Não há missões com prazo (ou execuções registradas) entre ' + U.esc(U.formatarData(d.intervalo.de)) + ' e ' +
            U.esc(U.formatarData(d.intervalo.ate)) + '. Escolha outro período.</p></div>' +
        (d.anteriores.length ? secaoAtrasadasHtml([], d) : '');
      return;
    }

    caixa.innerHTML = indicadores +
      secaoGrupoHtml('Por militar', 'equipe', agruparPorMilitar(d), 'Militar', 'Nenhum militar com missões no período.') +
      secaoGrupoHtml('Por setor', 'quadro', agruparPorSetor(d), 'Setor', 'Nenhum setor com missões no período.') +
      secaoAtividadesHtml(agruparPorAtividade(d)) +
      secaoAtrasadasHtml(lista, d) +
      '<aside class="nota-relatorio">' +
        '<strong>Como ler:</strong> <em>previstas</em> são as ocorrências do período (sem as "não se aplica"); ' +
        '<em>% de cumprimento</em> = concluídas ÷ as que já venceram (prazo até hoje, sem prazo ou já concluídas) — ' +
        'missões ainda dentro do prazo não reduzem o percentual; <em>no prazo</em> = concluídas até a data do prazo. ' +
        'Uma missão com dois responsáveis conta para os dois; vale a lista atual de responsáveis de cada atividade.' +
      '</aside>';
    U.aplicarLarguras(caixa);
  }

  /* ---------- exportações ---------- */

  function sufixoArquivo() {
    return dados.intervalo.de + '_a_' + dados.intervalo.ate;
  }

  function nomeSetor(id) {
    var s = id && temPropria(dados.ref.mapaSetores, id) ? dados.ref.mapaSetores[id] : null;
    return s ? s.sigla : '';
  }

  function csvResumo() {
    if (!dados) { return; }
    var linhas = agruparPorAtividade(dados);
    var cabecalho = [['AQS e NSP — Relatório de Atividades (resumo por atividade)'],
      ['Período', descricaoIntervalo(dados.intervalo)],
      ['Gerado em', U.formatarDataHora(new Date().toISOString())],
      []];
    var corpo = [['Nº', 'Atividade', 'Tipo', 'Regra', 'Setor', 'Responsáveis', 'Previstas', 'Concluídas', 'No prazo',
      'Atrasadas em aberto', 'Não se aplica', '% cumprimento', '% no prazo']];
    linhas.forEach(function (l) {
      var a = l.atividade;
      corpo.push([
        a && a.ordem !== null && a.ordem !== undefined ? a.ordem : '', l.rotulo,
        a ? (Regras.ROTULOS.tipo[a.tipo] || a.tipo) : '', a ? Regras.descreverRegra(a) : '',
        a ? nomeSetor(a.setor_id) : '', a ? Regras.nomesResponsaveis(a.responsaveis, dados.ref.mapaMilitares) : '',
        l.stats.previstas, l.stats.concluidas, l.stats.no_prazo, l.stats.atrasadas, l.stats.nao_se_aplica,
        l.stats.percentual === null ? '' : l.stats.percentual, l.stats.pct_prazo === null ? '' : l.stats.pct_prazo
      ]);
    });
    var g = estatisticas(dados.ocorrencias, dados.hoje);
    corpo.push(['', 'TOTAL', '', '', '', '', g.previstas, g.concluidas, g.no_prazo, g.atrasadas, g.nao_se_aplica,
      g.percentual === null ? '' : g.percentual, g.pct_prazo === null ? '' : g.pct_prazo]);
    U.baixarCsv('Relatorio-NSP-resumo-' + sufixoArquivo() + '.csv', cabecalho.concat(corpo));
    U.torrada('Planilha do resumo baixada.', 'sucesso');
  }

  function csvDetalhado() {
    if (!dados) { return; }
    var mapaAtividades = {};
    dados.atividades.forEach(function (a) { mapaAtividades[a.id] = a; });
    var mapa = dados.ref.mapaMilitares || {};
    var linhas = [['Nº', 'Atividade', 'Tipo', 'Setor', 'Referência', 'Execução', 'Prazo', 'Situação', 'Concluída em',
      'Concluída por', 'No prazo', 'Responsáveis', 'Observação', 'Justificativa', 'Evidências', 'Comentários']];
    dados.ocorrencias.forEach(function (oc) {
      var a = mapaAtividades[oc.atividade_id];
      var status = Regras.statusEfetivo(oc, dados.hoje);
      var concluidaPor = oc.concluida_por && temPropria(mapa, oc.concluida_por)
        ? Regras.nomeMilitar(mapa[oc.concluida_por]) : (oc.concluida_por_nome || '');
      linhas.push([
        a && a.ordem !== null && a.ordem !== undefined ? a.ordem : '', oc.atividade_titulo || (a ? a.titulo : ''),
        Regras.ROTULOS.tipo[oc.atividade_tipo] || oc.atividade_tipo || '', nomeSetor(oc.setor_id),
        Regras.rotuloReferencia(oc), oc.titulo_execucao || '', oc.prazo ? U.formatarData(oc.prazo) : '',
        Regras.ROTULOS.status[status] || status, oc.concluida_em ? U.formatarDataHora(oc.concluida_em) : '',
        oc.status === 'concluida' ? concluidaPor : '',
        oc.status === 'concluida' ? (Regras.concluidaNoPrazo ? (Regras.concluidaNoPrazo(oc) ? 'Sim' : 'Não') : (oc.concluida_no_prazo ? 'Sim' : 'Não')) : '',
        Regras.nomesResponsaveis(oc.responsaveis, mapa), oc.observacao || '', oc.justificativa || '',
        Number(oc.qtd_evidencias) || 0, Number(oc.qtd_comentarios) || 0
      ]);
    });
    U.baixarCsv('Relatorio-NSP-ocorrencias-' + sufixoArquivo() + '.csv', linhas);
    U.torrada('Planilha das ocorrências baixada (' + plural(dados.ocorrencias.length, 'linha', 'linhas') + ').', 'sucesso');
  }

  function exportarTudo(botao) {
    if (!U.confirmar('Gerar a cópia de segurança completa?\n\nO arquivo (JSON) traz todas as tabelas do sistema — inclusive ' +
        'dados da equipe —, sem o conteúdo dos arquivos de evidência. Guarde-o na pasta da AQS, nunca em computador ' +
        'pessoal ou e-mail particular.')) { return; }
    botao.disabled = true;
    botao.setAttribute('aria-busy', 'true');
    Api.exportarTudo().then(function (copia) {
      var hoje = U.hojeBelem();
      U.baixarConteudo('Copia-de-seguranca-AQS-NSP-' + hoje + '.json', JSON.stringify(copia, null, 2),
        'application/json;charset=utf-8');
      U.torrada('Cópia de segurança gerada. Guarde o arquivo na pasta da AQS.', 'sucesso', 7000);
      App.recarregar(['configuracoes']);
    }).catch(function (erro) {
      U.falha(erro);
    }).then(function () {
      if (document.body.contains(botao)) { botao.disabled = false; botao.removeAttribute('aria-busy'); }
    });
  }

  /* Rodapé do papel: quem imprimiu e quando (preenchido na hora). */
  function prepararRodape() {
    var rodape = U.$('#pagina-relatorios [data-rodape-relatorio]');
    var eu = App.militar();
    if (!rodape || !eu) { return; }
    rodape.textContent = 'Impresso por ' + Regras.nomeMilitar(eu) + ' em ' + U.formatarDataHora(new Date().toISOString()) +
      ' — documento de uso interno.';
  }

  window.addEventListener('beforeprint', prepararRodape);

  /* ---------- eventos ---------- */

  function aplicarPersonalizado(el) {
    var de = U.$('#relDe', el).value;
    var ate = U.$('#relAte', el).value;
    var erro = U.$('#relPeriodoErro', el);
    var problema = null;
    if (!Recorrencia.dataValida(de) || !Recorrencia.dataValida(ate)) { problema = 'Informe as duas datas.'; }
    else if (de > ate) { problema = 'A data inicial precisa ser anterior à final.'; }
    else if (Recorrencia.diasEntre(de, ate) > MAX_DIAS) { problema = 'Escolha um período de até 3 anos.'; }
    erro.textContent = problema || '';
    if (problema) { return; }
    periodo = { tipo: 'personalizado', de: de, ate: ate };
    gravarPeriodo();
    U.$('#relConteudo', el).innerHTML = '<div class="carregando" role="status">Calculando o relatório…</div>';
    carregar(el);
  }

  function ligar(el) {
    var raiz = U.$('.pagina-relatorios', el);
    raiz.addEventListener('click', function (evento) {
      var alvo = evento.target;
      if (!alvo || !alvo.closest) { return; }
      var botaoPeriodo = alvo.closest('[data-periodo]');
      if (botaoPeriodo) {
        var tipo = botaoPeriodo.getAttribute('data-periodo');
        U.$$('[data-periodo]', el).forEach(function (b) {
          var ativo = b === botaoPeriodo;
          b.classList.toggle('segmentos__opcao--ativa', ativo);
          b.setAttribute('aria-pressed', ativo ? 'true' : 'false');
        });
        var form = U.$('#relPersonalizado', el);
        form.classList.toggle('oculto', tipo !== 'personalizado');
        if (tipo === 'personalizado') {
          var iv = intervalo(periodo, U.hojeBelem());
          if (!U.$('#relDe', el).value) { U.$('#relDe', el).value = iv.de; }
          if (!U.$('#relAte', el).value) { U.$('#relAte', el).value = iv.ate; }
          U.$('#relDe', el).focus();
          return;
        }
        periodo = { tipo: tipo, de: periodo.de, ate: periodo.ate };
        gravarPeriodo();
        U.$('#relConteudo', el).innerHTML = '<div class="carregando" role="status">Calculando o relatório…</div>';
        carregar(el);
        return;
      }
      var acao = alvo.closest('[data-acao]');
      if (acao) {
        var qual = acao.getAttribute('data-acao');
        if (qual === 'imprimir') { prepararRodape(); window.print(); }
        else if (qual === 'exportar') { exportarTudo(acao); }
        else if (qual === 'csv-resumo') { if (dados) { csvResumo(); } else { U.torrada('Aguarde o relatório terminar de carregar.', 'atencao'); } }
        else if (qual === 'csv-detalhado') { if (dados) { csvDetalhado(); } else { U.torrada('Aguarde o relatório terminar de carregar.', 'atencao'); } }
        else if (qual === 'tentar') { carregar(el); }
        return;
      }
      var linha = alvo.closest('[data-ocorrencia]');
      if (linha) {
        var id = linha.getAttribute('data-ocorrencia');
        if (ID_VALIDO.test(id) && typeof Detalhe !== 'undefined' && Detalhe) { Detalhe.abrirOcorrencia(id); }
      }
    });
    U.$('#relPersonalizado', el).addEventListener('submit', function (evento) {
      evento.preventDefault();
      aplicarPersonalizado(el);
    });
  }

  return {
    titulo: 'Relatórios',
    render: render,
    aoVivo: aoVivo
  };
})();
