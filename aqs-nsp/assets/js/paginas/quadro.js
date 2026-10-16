/* =========================================================================
   HABE – AQS e NSP — Quadro
   As missões em três colunas (A fazer · Em andamento · Concluídas) ou no
   calendário do mês. No celular, as colunas viram abas e o calendário vira
   uma agenda em lista — nada de rolagem horizontal.

   Filtros: Minhas/Todas, responsável, setor, período e "ocultar diárias
   já encerradas de dias anteriores" (ligado por padrão: a diária de ontem
   já feita só enche a tela; a ATRASADA continua à vista). Filtros e modo ficam lembrados na aba (sessionStorage) e
   podem vir no endereço, ex. #/quadro?responsavel=ID&periodo=atrasadas
   (link das "Pendências da equipe" no Início). responsavel=sem mostra as
   missões sem responsável.

   Em qualquer período, as missões ATRASADAS e as em aberto sem prazo
   continuam em "A fazer"/"Em andamento": o período decide o horizonte, não
   esconde o que já devia estar feito.
   Ver docs/ARQUITETURA.md, seções 2, 4, 5 e 7.
   ========================================================================= */

Paginas.quadro = (function () {
  'use strict';

  var CHAVE_ESTADO = 'aqs_quadro_estado';
  var TABELAS = ['ocorrencias', 'atividades', 'atividade_responsaveis', 'evidencias', 'comentarios',
                 'militares', 'setores', 'feriados'];
  var PERIODOS = [
    { valor: 'semana', rotulo: 'Esta semana' },
    { valor: 'mes', rotulo: 'Este mês' },
    { valor: '30dias', rotulo: 'Próximos 30 dias' },
    { valor: 'atrasadas', rotulo: 'Somente atrasadas' }
  ];
  var COLUNAS = [
    { valor: 'afazer', rotulo: 'A fazer', icone: 'relogio' },
    { valor: 'andamento', rotulo: 'Em andamento', icone: 'missao' },
    { valor: 'concluidas', rotulo: 'Concluídas', icone: 'check' }
  ];
  var LOTE_CONCLUIDAS = 30;
  var ITENS_POR_DIA = 3;
  var DIAS_ABREV = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  var ID_VALIDO = /^[0-9A-Za-z_-]{1,64}$/;

  var geracao = 0;
  var carga = 0;
  var estado = null;
  /* Últimos dados buscados: { chave, ref, ocorrencias, porId } */
  var cache = null;
  /* Filtros abertos no celular (começam recolhidos a cada visita). */
  var filtrosAbertos = false;

  /* ---------- auxiliares ---------- */

  function icone(nome) {
    return '<svg class="icone" aria-hidden="true" focusable="false"><use href="#i-' + nome + '"></use></svg>';
  }

  function contem(lista, valor) {
    return Array.isArray(lista) && lista.indexOf(valor) >= 0;
  }

  function plural(n, singular, varios) {
    return n + ' ' + (n === 1 ? singular : varios);
  }

  function vigente(el, minhaGeracao, minhaCarga) {
    return minhaGeracao === geracao && (minhaCarga === undefined || minhaCarga === carga) &&
      !!App.militar() && !el.classList.contains('oculto') && !!U.$('.quadro-pagina', el);
  }

  function mesDe(data) { return String(data).slice(0, 7); }

  function primeiroDoMes(mes) { return mes + '-01'; }

  function ultimoDoMes(mes) {
    var p = mes.split('-');
    return mes + '-' + String(Recorrencia.ultimoDiaDoMes(Number(p[0]), Number(p[1]))).replace(/^(\d)$/, '0$1');
  }

  function somarMeses(mes, n) {
    var p = mes.split('-');
    var indice = Number(p[0]) * 12 + Number(p[1]) - 1 + n;
    var ano = Math.floor(indice / 12);
    var m = indice % 12 + 1;
    return ano + '-' + (m < 10 ? '0' : '') + m;
  }

  function diaDaSemana(data) { return U.paraData(data).getDay(); }

  function maiuscula(texto) {
    texto = String(texto || '');
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }

  function tituloMes(mes) { return maiuscula(U.mesPorExtenso(mes)); }

  function dataLonga(data) {
    var d = U.paraData(data);
    return maiuscula(U.DIAS_SEMANA[d.getDay()]) + ', ' + d.getDate() + ' de ' + U.MESES[d.getMonth()];
  }

  /* ---------- estado dos filtros ---------- */

  function padrao(eu) {
    return {
      modo: 'quadro',
      escopo: (Regras.eGestor(eu) || Regras.eAdministrador(eu)) ? 'todas' : 'minhas',
      responsavel: '',
      setor: '',
      periodo: 'mes',
      ocultarDiarias: true,
      coluna: 'afazer',
      mes: mesDe(U.hojeBelem()),
      dia: null,
      limiteConcluidas: LOTE_CONCLUIDAS
    };
  }

  /* Uma chave por militar: quem entrar depois na mesma aba (computador
     compartilhado) não herda os filtros de outra pessoa. */
  function chaveEstado() {
    var eu = App.militar();
    return CHAVE_ESTADO + ':' + (eu && eu.id ? eu.id : 'anonimo');
  }

  function lerEstado(eu) {
    var base = padrao(eu);
    try {
      var salvo = JSON.parse(window.sessionStorage.getItem(chaveEstado()) || 'null');
      if (salvo && typeof salvo === 'object') {
        if (salvo.modo === 'quadro' || salvo.modo === 'calendario') { base.modo = salvo.modo; }
        if (salvo.escopo === 'minhas' || salvo.escopo === 'todas') { base.escopo = salvo.escopo; }
        if (typeof salvo.responsavel === 'string' && (salvo.responsavel === '' || ID_VALIDO.test(salvo.responsavel))) {
          base.responsavel = salvo.responsavel;
        }
        if (typeof salvo.setor === 'string' && (salvo.setor === '' || ID_VALIDO.test(salvo.setor))) { base.setor = salvo.setor; }
        if (PERIODOS.some(function (p) { return p.valor === salvo.periodo; })) { base.periodo = salvo.periodo; }
        if (typeof salvo.ocultarDiarias === 'boolean') { base.ocultarDiarias = salvo.ocultarDiarias; }
        if (COLUNAS.some(function (c) { return c.valor === salvo.coluna; })) { base.coluna = salvo.coluna; }
        if (typeof salvo.mes === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(salvo.mes)) { base.mes = salvo.mes; }
        if (typeof salvo.dia === 'string' && Recorrencia.dataValida(salvo.dia)) { base.dia = salvo.dia; }
      }
    } catch (e) { /* armazenamento indisponível ou corrompido: padrão */ }
    /* A conta institucional não recebe missões: "Minhas" seria sempre vazio. */
    if (Regras.eAdministrador(eu)) { base.escopo = 'todas'; }
    return base;
  }

  function gravarEstado() {
    try { window.sessionStorage.setItem(chaveEstado(), JSON.stringify(estado)); } catch (e) { /* só nesta visita */ }
  }

  /* Parâmetros do endereço valem sobre o que estava lembrado. */
  function aplicarParametros(params, eu) {
    params = params || {};
    var veioPeriodo = false;
    if (params.responsavel !== undefined) {
      var r = String(params.responsavel);
      if (r === '' || ID_VALIDO.test(r)) {
        estado.responsavel = r;
        if (r) { estado.escopo = 'todas'; }
      }
    }
    if (params.setor !== undefined && (params.setor === '' || ID_VALIDO.test(String(params.setor)))) {
      estado.setor = String(params.setor);
    }
    if (PERIODOS.some(function (p) { return p.valor === params.periodo; })) {
      estado.periodo = params.periodo;
      veioPeriodo = true;
    }
    if ((params.escopo === 'minhas' || params.escopo === 'todas') && !(params.responsavel && params.escopo === 'minhas')) {
      estado.escopo = Regras.eAdministrador(eu) ? 'todas' : params.escopo;
      if (estado.escopo === 'minhas') { estado.responsavel = ''; }
    }
    if (params.modo === 'quadro' || params.modo === 'calendario') {
      estado.modo = params.modo;
    } else if (veioPeriodo) {
      estado.modo = 'quadro';
    }
    if (typeof params.mes === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(params.mes)) { estado.mes = params.mes; }
    if (params.diarias === '0' || params.diarias === '1') { estado.ocultarDiarias = params.diarias === '0'; }
    if (veioPeriodo && estado.periodo === 'atrasadas') { estado.coluna = 'afazer'; }
  }

  function filtrosAlterados(eu) {
    var p = padrao(eu);
    return estado.escopo !== p.escopo || estado.responsavel !== '' || estado.setor !== '' ||
      estado.periodo !== p.periodo || estado.ocultarDiarias !== p.ocultarDiarias;
  }

  /* ---------- janela de datas ---------- */

  function janelaDoPeriodo(hoje) {
    if (estado.periodo === 'semana') {
      var domingo = U.somarDias(hoje, -diaDaSemana(hoje));
      return { de: domingo, ate: U.somarDias(domingo, 6) };
    }
    if (estado.periodo === '30dias') { return { de: hoje, ate: U.somarDias(hoje, 30) }; }
    if (estado.periodo === 'atrasadas') { return null; }
    var mes = mesDe(hoje);
    return { de: primeiroDoMes(mes), ate: ultimoDoMes(mes) };
  }

  /* Grade do calendário: do domingo antes do dia 1º ao sábado depois do
     último dia (semanas completas). */
  function janelaDoCalendario() {
    var inicio = primeiroDoMes(estado.mes);
    var fim = ultimoDoMes(estado.mes);
    return { de: U.somarDias(inicio, -diaDaSemana(inicio)), ate: U.somarDias(fim, 6 - diaDaSemana(fim)) };
  }

  function janelaNecessaria(hoje) {
    return estado.modo === 'calendario' ? janelaDoCalendario() : janelaDoPeriodo(hoje);
  }

  /* ---------- render e carga ---------- */

  function render(el, params) {
    geracao += 1;
    filtrosAbertos = false;
    var eu = App.militar();
    estado = lerEstado(eu);
    aplicarParametros(params, eu);
    gravarEstado();
    cache = null;
    el.innerHTML =
      '<div class="quadro-pagina">' +
        '<div class="pagina__cabecalho pagina__cabecalho--acoes">' +
          '<div><h1>Quadro</h1><p>As missões por situação ou no calendário do mês.</p></div>' +
          '<div class="segmentado" role="group" aria-label="Modo de exibição">' +
            '<button type="button" class="segmentado__opcao" data-modo="quadro" aria-pressed="false">' + icone('quadro') + 'Quadro</button>' +
            '<button type="button" class="segmentado__opcao" data-modo="calendario" aria-pressed="false">' + icone('plano') + 'Calendário</button>' +
          '</div>' +
        '</div>' +
        '<div class="cartao filtros-quadro" id="quadroFiltros"><div class="carregando carregando--inline">Carregando os filtros…</div></div>' +
        '<div id="quadroConteudo"><div class="carregando" role="status">Carregando…</div></div>' +
      '</div>';
    marcarModo(el);
    ligar(el, U.$('.quadro-pagina', el));
    carregar(el, true);
  }

  function aoVivo(el, params, tabelas) {
    if (Array.isArray(tabelas) && tabelas.length && !tabelas.some(function (t) { return contem(TABELAS, t); })) { return; }
    if (!estado || !U.$('.quadro-pagina', el)) { render(el, params); return; }
    carregar(el, true);
  }

  /* forcar: busca mesmo que a janela não tenha mudado (atualização). */
  function carregar(el, forcar) {
    var hoje = U.hojeBelem();
    var janela = janelaNecessaria(hoje);
    var comAbertas = estado.modo === 'quadro';
    var chave = estado.modo + '|' + (janela ? janela.de + '|' + janela.ate : 'abertas') + '|' + hoje;
    if (!forcar && cache && cache.chave === chave) { desenhar(el); return; }

    var minhaGeracao = geracao;
    var minhaCarga = ++carga;
    if (!cache) {
      var conteudo = U.$('#quadroConteudo', el);
      if (conteudo) { conteudo.innerHTML = '<div class="carregando" role="status">Carregando…</div>'; }
    } else {
      U.$('.quadro-pagina', el).classList.add('quadro-pagina--atualizando');
    }

    Promise.all([
      Api.referencias(),
      Api.listarAtividades(),
      janela ? Api.listarOcorrencias({ de: janela.de, ate: janela.ate }) : Promise.resolve([]),
      comAbertas ? Api.listarOcorrencias({ somenteAbertas: true }) : Promise.resolve([])
    ]).then(function (r) {
      if (!vigente(el, minhaGeracao, minhaCarga)) { return; }
      var arquivadas = {};
      (r[1] || []).forEach(function (a) { if (a.ativa === false) { arquivadas[a.id] = true; } });
      var porId = {};
      var lista = [];
      (r[2] || []).concat(r[3] || []).forEach(function (oc) {
        if (!oc || porId[oc.id]) { return; }
        /* Abertas de atividade arquivada: ninguém vai mais cumpri-las. */
        if (arquivadas[oc.atividade_id] && Regras.estaAberta(oc)) { return; }
        porId[oc.id] = oc;
        lista.push(oc);
      });
      /* Os selects são refeitos na primeira carga e quando militares ou
         setores mudaram (Api.referencias devolve um objeto novo). */
      var refAnterior = cache ? cache.ref : null;
      cache = { chave: chave, ref: r[0], ocorrencias: lista, porId: porId, janela: janela, hoje: hoje };
      if (!refAnterior || refAnterior !== r[0] || !U.$('#quadroResponsavel', el)) { desenharFiltros(el); }
      desenhar(el);
    }).catch(function (erro) {
      if (!vigente(el, minhaGeracao, minhaCarga)) { return; }
      U.$('.quadro-pagina', el).classList.remove('quadro-pagina--atualizando');
      if (cache && cache.chave === chave) {
        console.warn('Quadro não atualizado agora.', erro);
        return;
      }
      U.falha(erro);
      var conteudo = U.$('#quadroConteudo', el);
      if (conteudo) {
        conteudo.innerHTML = '<div class="aviso aviso--urgente" role="alert"><span class="aviso__icone">' + icone('alerta') + '</span>' +
          '<div><strong>Não foi possível carregar as missões.</strong>' + U.esc(U.erroTexto(erro)) + '</div></div>' +
          '<div class="acoes"><button type="button" class="botao botao--secundario" data-acao="recarregar-pagina">' +
            icone('recarregar') + 'Tentar novamente</button></div>';
      }
      var filtros = U.$('#quadroFiltros', el);
      if (filtros && !U.$('#quadroResponsavel', filtros)) { filtros.classList.add('oculto'); }
    });
  }

  /* ---------- filtros ---------- */

  function desenharFiltros(el) {
    var caixa = U.$('#quadroFiltros', el);
    if (!caixa || !cache) { return; }
    caixa.classList.remove('oculto');
    var eu = App.militar();
    var ref = cache.ref;
    var adm = Regras.eAdministrador(eu);
    var atribuiveis = Regras.militaresAtribuiveis(ref.militares).slice().sort(function (a, b) {
      return U.ordenarTexto(Regras.nomeMilitar(a), Regras.nomeMilitar(b));
    });
    var opcoesResp = '<option value="">Todos</option>' + atribuiveis.map(function (m) {
      return '<option value="' + U.esc(m.id) + '">' + U.esc(Regras.nomeMilitar(m)) + (m.id === eu.id ? ' (você)' : '') + '</option>';
    }).join('');
    /* Filtro vindo do endereço para alguém fora da lista (inativo). */
    if (estado.responsavel && estado.responsavel !== 'sem' && !atribuiveis.some(function (m) { return m.id === estado.responsavel; })) {
      var outro = ref.mapaMilitares[estado.responsavel];
      opcoesResp += '<option value="' + U.esc(estado.responsavel) + '">' +
        U.esc(outro ? Regras.nomeMilitar(outro) + (outro.ativo === false ? ' (inativo)' : '') : 'Militar não encontrado') + '</option>';
    }
    opcoesResp += '<option value="sem">Sem responsável</option>';

    var setores = (ref.setores || []).slice().sort(function (a, b) {
      return ((a.ordem || 0) - (b.ordem || 0)) || U.ordenarTexto(a.sigla, b.sigla);
    });
    var opcoesSetor = '<option value="">Todos</option>' + setores.map(function (s) {
      return '<option value="' + U.esc(s.id) + '">' + U.esc(s.sigla + ' — ' + s.nome) + '</option>';
    }).join('');

    /* No celular os filtros ficam recolhidos atrás do botão "Filtros" (com
       o número dos que estão em uso): sem isso, a primeira tela inteira
       seria de filtros e nenhuma missão. No computador o botão some e tudo
       fica sempre à vista (regras em telas-operacao.css). */
    caixa.classList.toggle('filtros-quadro--recolhido', !filtrosAbertos);
    caixa.innerHTML =
      '<div class="filtros-quadro__linha filtros-quadro__linha--topo">' +
        (adm ? '' :
          '<div class="segmentado segmentado--pequeno" role="group" aria-label="De quem são as missões">' +
            '<button type="button" class="segmentado__opcao" data-escopo="minhas" aria-pressed="false">Minhas</button>' +
            '<button type="button" class="segmentado__opcao" data-escopo="todas" aria-pressed="false">Todas</button>' +
          '</div>') +
        '<button type="button" class="botao botao--secundario botao--pequeno filtros-quadro__alternar" data-acao="alternar-filtros" ' +
          'aria-controls="quadroFiltros" aria-expanded="' + (filtrosAbertos ? 'true' : 'false') + '">' + icone('relatorios') +
          'Filtros<span class="contador contador--urgente oculto" id="quadroQtdFiltros">0</span></button>' +
        '<div class="filtros-quadro__campo filtros-quadro__recolhivel">' +
          '<label for="quadroResponsavel">Responsável</label>' +
          '<select id="quadroResponsavel">' + opcoesResp + '</select>' +
        '</div>' +
        '<div class="filtros-quadro__campo filtros-quadro__recolhivel">' +
          '<label for="quadroSetor">Setor</label>' +
          '<select id="quadroSetor">' + opcoesSetor + '</select>' +
        '</div>' +
      '</div>' +
      '<div class="filtros-quadro__linha filtros-quadro__recolhivel" id="quadroPeriodos">' +
        '<div class="filtros mb-0" role="group" aria-label="Período">' + PERIODOS.map(function (p) {
          return '<button type="button" class="filtro' + (p.valor === 'atrasadas' ? ' filtro--urgente' : '') +
            '" data-periodo="' + p.valor + '" aria-pressed="false">' + U.esc(p.rotulo) + '</button>';
        }).join('') + '</div>' +
      '</div>' +
      '<div class="filtros-quadro__linha filtros-quadro__linha--rodape">' +
        '<label class="interruptor filtros-quadro__recolhivel" for="quadroOcultarDiarias">' +
          '<input type="checkbox" id="quadroOcultarDiarias">' +
          '<span class="interruptor__trilho" aria-hidden="true"></span>' +
          '<span>Ocultar diárias já encerradas de dias anteriores</span>' +
        '</label>' +
        '<span class="filtros-quadro__resumo" id="quadroResumo" aria-live="polite"></span>' +
        '<button type="button" class="botao botao--texto botao--pequeno oculto" data-acao="limpar-filtros">' +
          icone('fechar') + 'Limpar filtros</button>' +
      '</div>';
    marcarFiltros(el);
  }

  function marcarModo(el) {
    U.$$('[data-modo]', el).forEach(function (b) {
      var ativo = b.getAttribute('data-modo') === estado.modo;
      b.classList.toggle('segmentado__opcao--ativa', ativo);
      b.setAttribute('aria-pressed', ativo ? 'true' : 'false');
    });
  }

  function marcarFiltros(el) {
    var eu = App.militar();
    var escopoEfetivo = estado.responsavel ? '' : estado.escopo;
    U.$$('[data-escopo]', el).forEach(function (b) {
      var ativo = b.getAttribute('data-escopo') === escopoEfetivo;
      b.classList.toggle('segmentado__opcao--ativa', ativo);
      b.setAttribute('aria-pressed', ativo ? 'true' : 'false');
    });
    var resp = U.$('#quadroResponsavel', el);
    if (resp) { resp.value = estado.responsavel; if (resp.value !== estado.responsavel) { resp.value = ''; } }
    var setor = U.$('#quadroSetor', el);
    if (setor) { setor.value = estado.setor; if (setor.value !== estado.setor) { setor.value = ''; } }
    U.$$('[data-periodo]', el).forEach(function (b) {
      var ativo = b.getAttribute('data-periodo') === estado.periodo;
      b.classList.toggle('filtro--ativo', ativo);
      b.setAttribute('aria-pressed', ativo ? 'true' : 'false');
    });
    var periodos = U.$('#quadroPeriodos', el);
    if (periodos) { periodos.classList.toggle('oculto', estado.modo === 'calendario'); }
    var diarias = U.$('#quadroOcultarDiarias', el);
    if (diarias) { diarias.checked = !!estado.ocultarDiarias; }
    var limpar = U.$('[data-acao="limpar-filtros"]', el);
    if (limpar) { limpar.classList.toggle('oculto', !filtrosAlterados(eu)); }
    var qtd = U.$('#quadroQtdFiltros', el);
    if (qtd) {
      var n = filtrosRecolhidosEmUso(eu);
      qtd.textContent = String(n);
      qtd.classList.toggle('oculto', n === 0);
      var botao = qtd.parentNode;
      botao.setAttribute('aria-label', 'Filtros' + (n ? ' (' + n + (n === 1 ? ' em uso)' : ' em uso)') : ''));
    }
  }

  /* Quantos dos filtros que ficam recolhidos no celular estão diferentes do
     padrão (o período só conta no modo quadro: no calendário ele some). */
  function filtrosRecolhidosEmUso(eu) {
    var p = padrao(eu);
    var n = 0;
    if (estado.responsavel) { n += 1; }
    if (estado.setor) { n += 1; }
    if (estado.modo === 'quadro' && estado.periodo !== p.periodo) { n += 1; }
    if (estado.ocultarDiarias !== p.ocultarDiarias) { n += 1; }
    return n;
  }

  /* ---------- filtragem ---------- */

  function filtrar(lista, hoje) {
    var eu = App.militar();
    return lista.filter(function (oc) {
      var resp = oc.responsaveis || [];
      if (estado.responsavel === 'sem') {
        if (resp.length) { return false; }
      } else if (estado.responsavel) {
        if (!contem(resp, estado.responsavel)) { return false; }
      } else if (estado.escopo === 'minhas' && !contem(resp, eu.id)) {
        return false;
      }
      if (estado.setor && oc.setor_id !== estado.setor) { return false; }
      /* Só somem as diárias de dias anteriores JÁ ENCERRADAS (concluídas ou
         "não se aplica"): a diária atrasada continua à vista — é pendência
         real, e o Início e o filtro "Somente atrasadas" contam com ela. */
      if (estado.ocultarDiarias && oc.periodicidade === 'diaria_util' && oc.prazo && oc.prazo < hoje &&
          !Regras.estaAberta(oc)) { return false; }
      return true;
    });
  }

  function passaPeriodo(oc, janela, hoje) {
    if (estado.periodo === 'atrasadas') { return Regras.estaAtrasada(oc, hoje); }
    var dataRef = String(oc.data_ref || oc.prazo || '');
    if (dataRef >= janela.de && dataRef <= janela.ate) { return true; }
    if (Regras.estaAberta(oc)) { return !oc.prazo || oc.prazo < janela.de; }
    if (oc.status === 'concluida') {
      var conclusao = Regras.dataBelem(oc.concluida_em);
      return !!conclusao && conclusao >= janela.de && conclusao <= janela.ate;
    }
    return false;
  }

  function contexto(hoje) {
    return { hoje: hoje, eu: App.militar(), mapaMilitares: cache.ref.mapaMilitares, mapaSetores: cache.ref.mapaSetores };
  }

  /* ---------- desenho ---------- */

  function desenhar(el) {
    if (!cache) { return; }
    U.$('.quadro-pagina', el).classList.remove('quadro-pagina--atualizando');
    marcarModo(el);
    marcarFiltros(el);
    var hoje = U.hojeBelem();
    if (estado.modo === 'calendario') { desenharCalendario(el, hoje); } else { desenharQuadro(el, hoje); }
    U.aplicarLarguras(el);
  }

  function instanteConclusao(oc) {
    return String(oc.status === 'concluida' ? (oc.concluida_em || oc.atualizado_em || '') : (oc.atualizado_em || oc.criado_em || ''));
  }

  function desenharQuadro(el, hoje) {
    var conteudo = U.$('#quadroConteudo', el);
    if (!conteudo) { return; }
    var janela = janelaDoPeriodo(hoje);
    var lista = filtrar(cache.ocorrencias, hoje).filter(function (oc) { return passaPeriodo(oc, janela, hoje); });
    var colunas = { afazer: [], andamento: [], concluidas: [] };
    lista.forEach(function (oc) {
      if (oc.status === 'pendente') { colunas.afazer.push(oc); }
      else if (oc.status === 'em_andamento') { colunas.andamento.push(oc); }
      else { colunas.concluidas.push(oc); }
    });
    colunas.afazer.sort(Detalhe.compararAbertas);
    colunas.andamento.sort(Detalhe.compararAbertas);
    colunas.concluidas.sort(function (a, b) {
      /* Concluídas antes das "não se aplica"; as mais recentes primeiro. */
      var na = a.status === 'nao_se_aplica' ? 1 : 0;
      var nb = b.status === 'nao_se_aplica' ? 1 : 0;
      if (na !== nb) { return na - nb; }
      var ia = instanteConclusao(a), ib = instanteConclusao(b);
      return ia === ib ? 0 : (ia < ib ? 1 : -1);
    });

    var atrasadas = colunas.afazer.concat(colunas.andamento).filter(function (oc) { return Regras.estaAtrasada(oc, hoje); }).length;
    var resumo = U.$('#quadroResumo', el);
    if (resumo) {
      resumo.textContent = plural(lista.length, 'missão', 'missões') +
        (atrasadas ? ' · ' + plural(atrasadas, 'atrasada', 'atrasadas') : '');
      resumo.classList.toggle('filtros-quadro__resumo--alerta', atrasadas > 0);
    }

    var ctx = contexto(hoje);
    var variosSetores = !estado.setor && (cache.ref.setores || []).length > 1;
    var limite = estado.limiteConcluidas || LOTE_CONCLUIDAS;

    function vazioHtml(coluna) {
      if (estado.periodo === 'atrasadas') {
        return coluna === 'afazer' && !lista.length ? 'Nenhuma missão atrasada. Tudo em dia! ✈' : 'Nenhuma atrasada aqui.';
      }
      if (coluna === 'afazer') {
        return lista.length ? 'Nada a fazer neste período. ✈' : 'Nenhuma missão com estes filtros.';
      }
      if (coluna === 'andamento') { return 'Nenhuma missão em andamento.'; }
      return 'Nenhuma missão concluída neste período.';
    }

    var abas = '<div class="segmentado segmentado--bloco quadro-abas so-celular" role="group" aria-label="Coluna do quadro">' +
      COLUNAS.map(function (c) {
        var ativo = estado.coluna === c.valor;
        var n = colunas[c.valor].length;
        return '<button type="button" class="segmentado__opcao' + (ativo ? ' segmentado__opcao--ativa' : '') + '" data-coluna="' + c.valor +
          '" aria-pressed="' + (ativo ? 'true' : 'false') + '">' + U.esc(c.rotulo) +
          ' <span class="contador' + (c.valor === 'afazer' && atrasadas ? ' contador--urgente' : ' contador--neutro') + '">' + n + '</span></button>';
      }).join('') + '</div>';

    var html = abas + '<div class="quadro">' + COLUNAS.map(function (c) {
      var itens = colunas[c.valor];
      var visiveis = c.valor === 'concluidas' ? itens.slice(0, limite) : itens;
      var atrasadasColuna = c.valor === 'concluidas' ? 0 : itens.filter(function (oc) { return Regras.estaAtrasada(oc, hoje); }).length;
      return '<section class="quadro__coluna quadro__coluna--' + c.valor + (estado.coluna === c.valor ? ' quadro__coluna--ativa' : '') + '" ' +
          'aria-labelledby="quadroColuna-' + c.valor + '">' +
        '<header class="quadro__cabecalho">' +
          '<h2 id="quadroColuna-' + c.valor + '">' + icone(c.icone) + U.esc(c.rotulo) + '</h2>' +
          (atrasadasColuna ? '<span class="quadro__alerta">' + plural(atrasadasColuna, 'atrasada', 'atrasadas') + '</span>' : '') +
          '<span class="contador contador--neutro">' + itens.length + '</span>' +
        '</header>' +
        '<div class="quadro__lista">' +
          (visiveis.length
            ? visiveis.map(function (oc) {
                return Detalhe.cartaoMissaoHtml(oc, ctx, { acoes: true, mostrarSetor: variosSetores });
              }).join('')
            : '<p class="quadro__vazio">' + U.esc(vazioHtml(c.valor)) + '</p>') +
          (itens.length > visiveis.length
            ? '<button type="button" class="botao botao--texto botao--pequeno botao--bloco" data-acao="mais-concluidas">' +
              'Mostrar mais ' + Math.min(LOTE_CONCLUIDAS, itens.length - visiveis.length) + ' de ' + (itens.length - visiveis.length) + '</button>'
            : '') +
        '</div>' +
      '</section>';
    }).join('') + '</div>';

    conteudo.innerHTML = html;
  }

  function ordenarDoDia(a, b, hoje) {
    function peso(oc) {
      var s = Regras.statusEfetivo(oc, hoje);
      return s === 'atrasada' ? 0 : (s === 'em_andamento' ? 1 : (s === 'pendente' ? 2 : (s === 'concluida' ? 3 : 4)));
    }
    var pa = peso(a), pb = peso(b);
    if (pa !== pb) { return pa - pb; }
    return Detalhe.compararAbertas(a, b);
  }

  function desenharCalendario(el, hoje) {
    var conteudo = U.$('#quadroConteudo', el);
    if (!conteudo) { return; }
    var janela = janelaDoCalendario();
    var feriados = {};
    (cache.ref.listaFeriados || []).forEach(function (f) { if (f && f.data) { feriados[f.data] = f.descricao || 'Feriado'; } });
    Object.keys(cache.ref.feriados || {}).forEach(function (data) { if (!feriados[data]) { feriados[data] = 'Feriado'; } });

    var lista = filtrar(cache.ocorrencias, hoje).filter(function (oc) {
      var dataRef = String(oc.data_ref || oc.prazo || '');
      return dataRef >= janela.de && dataRef <= janela.ate;
    });
    var porDia = U.agrupar(lista, function (oc) { return String(oc.data_ref || oc.prazo); });
    Object.keys(porDia).forEach(function (dia) { porDia[dia].sort(function (a, b) { return ordenarDoDia(a, b, hoje); }); });

    var noMes = lista.filter(function (oc) { return mesDe(oc.data_ref || oc.prazo) === estado.mes; });
    var atrasadas = noMes.filter(function (oc) { return Regras.estaAtrasada(oc, hoje); }).length;
    var resumo = U.$('#quadroResumo', el);
    if (resumo) {
      resumo.textContent = plural(noMes.length, 'missão', 'missões') + ' em ' + U.mesPorExtenso(estado.mes) +
        (atrasadas ? ' · ' + plural(atrasadas, 'atrasada', 'atrasadas') : '');
      resumo.classList.toggle('filtros-quadro__resumo--alerta', atrasadas > 0);
    }

    if (estado.dia && (estado.dia < janela.de || estado.dia > janela.ate)) { estado.dia = null; }
    if (!estado.dia && mesDe(hoje) === estado.mes) { estado.dia = hoje; }

    var barra =
      '<div class="calendario-barra">' +
        '<button type="button" class="botao-navegacao" data-mes="anterior" aria-label="Mês anterior" title="Mês anterior">‹</button>' +
        '<h2 class="calendario-barra__titulo" aria-live="polite">' + U.esc(tituloMes(estado.mes)) + '</h2>' +
        '<button type="button" class="botao-navegacao" data-mes="proximo" aria-label="Próximo mês" title="Próximo mês">›</button>' +
        '<button type="button" class="botao botao--secundario botao--pequeno calendario-barra__hoje" data-mes="hoje"' +
          (mesDe(hoje) === estado.mes && estado.dia === hoje ? ' disabled' : '') + '>Hoje</button>' +
      '</div>';

    /* Grade (computador) */
    var celulas = DIAS_ABREV.map(function (d, i) {
      return '<div class="calendario__cabecalho' + (i === 0 || i === 6 ? ' calendario__cabecalho--fim' : '') + '" aria-hidden="true">' + d + '</div>';
    }).join('');
    for (var dia = janela.de; dia <= janela.ate; dia = U.somarDias(dia, 1)) {
      celulas += celulaHtml(dia, porDia[dia] || [], feriados[dia], hoje);
    }
    var grade = '<div class="calendario so-computador"><div class="calendario__grade">' + celulas + '</div></div>';

    var diaSelecionado = estado.dia
      ? '<section class="calendario-dia so-computador" aria-live="polite">' + listaDoDiaHtml(estado.dia, porDia[estado.dia] || [], feriados[estado.dia], hoje) + '</section>'
      : '<p class="calendario-dia calendario-dia--dica so-computador texto-suave">Clique num dia para ver as missões.</p>';

    conteudo.innerHTML = barra + grade + diaSelecionado + agendaHtml(porDia, feriados, hoje);
  }

  function celulaHtml(dia, itens, feriado, hoje) {
    var d = U.paraData(dia);
    var semana = d.getDay();
    var classes = 'calendario__dia';
    if (mesDe(dia) !== estado.mes) { classes += ' calendario__dia--fora'; }
    if (dia === hoje) { classes += ' calendario__dia--hoje'; }
    if (feriado) { classes += ' calendario__dia--feriado'; }
    if (semana === 0 || semana === 6) { classes += ' calendario__dia--fim'; }
    if (dia === estado.dia) { classes += ' calendario__dia--selecionado'; }
    var atrasadas = itens.filter(function (oc) { return Regras.estaAtrasada(oc, hoje); }).length;
    var rotulo = dataLonga(dia) + (feriado ? ', feriado: ' + feriado : '') + ', ' +
      (itens.length ? plural(itens.length, 'missão', 'missões') : 'nenhuma missão') +
      (atrasadas ? ', ' + plural(atrasadas, 'atrasada', 'atrasadas') : '');
    var visiveis = itens.slice(0, ITENS_POR_DIA);
    return '<div class="' + classes + '" data-dia="' + dia + '">' +
      '<button type="button" class="calendario__numero" data-selecionar-dia="' + dia + '" aria-label="' + U.esc(rotulo) + '"' +
        (dia === estado.dia ? ' aria-pressed="true"' : ' aria-pressed="false"') + '>' + d.getDate() + '</button>' +
      (feriado ? '<span class="calendario__feriado" title="' + U.esc(feriado) + '">' + U.esc(feriado) + '</span>' : '') +
      (visiveis.length ? '<ul class="calendario__itens">' + visiveis.map(function (oc) {
        var efetivo = Regras.statusEfetivo(oc, hoje);
        var execucao = String(oc.titulo_execucao || '').trim();
        var titulo = oc.atividade_titulo + (execucao ? ' — ' + execucao : '');
        return '<li><button type="button" class="calendario__item calendario__item--' + U.esc(efetivo) + '" ' +
          'data-abrir-ocorrencia="' + U.esc(oc.id) + '" title="' + U.esc(titulo + ' · ' + (Regras.ROTULOS.status[efetivo] || '')) + '">' +
          U.esc(titulo) + '</button></li>';
      }).join('') + '</ul>' : '') +
      (itens.length > visiveis.length
        ? '<button type="button" class="calendario__mais" data-selecionar-dia="' + dia + '" aria-label="' +
          U.esc('Mais ' + (itens.length - visiveis.length) + ' missões em ' + dataLonga(dia)) + '">+' + (itens.length - visiveis.length) + '</button>'
        : '') +
    '</div>';
  }

  function listaDoDiaHtml(dia, itens, feriado, hoje) {
    var ctx = contexto(hoje);
    return '<div class="calendario-dia__cabecalho">' +
        '<h3>' + U.esc(dataLonga(dia)) + (dia === hoje ? ' <span class="selo selo--padrao">Hoje</span>' : '') + '</h3>' +
        (feriado ? '<span class="selo selo--atencao">Feriado · ' + U.esc(feriado) + '</span>' : '') +
        '<span class="texto-suave texto-pequeno">' + (itens.length ? plural(itens.length, 'missão', 'missões') : '') + '</span>' +
      '</div>' +
      (itens.length
        ? '<div class="lista-missoes lista-missoes--grade">' + itens.map(function (oc) {
            return Detalhe.cartaoMissaoHtml(oc, ctx, { acoes: true, mostrarStatus: true });
          }).join('') + '</div>'
        : '<p class="texto-suave mb-0">Nenhuma missão neste dia' + (estado.ocultarDiarias && dia < hoje ? ' (as diárias já encerradas de dias anteriores estão ocultas)' : '') + '.</p>');
  }

  /* Agenda (celular): só os dias do mês com missões, o dia de hoje e os
     feriados, um embaixo do outro. */
  function agendaHtml(porDia, feriados, hoje) {
    var ctx = contexto(hoje);
    var inicio = primeiroDoMes(estado.mes);
    var fim = ultimoDoMes(estado.mes);
    var blocos = [];
    for (var dia = inicio; dia <= fim; dia = U.somarDias(dia, 1)) {
      var itens = porDia[dia] || [];
      if (!itens.length && dia !== hoje && !feriados[dia]) { continue; }
      var d = U.paraData(dia);
      blocos.push('<section class="agenda__dia' + (dia === hoje ? ' agenda__dia--hoje' : '') + (feriados[dia] ? ' agenda__dia--feriado' : '') + '">' +
        '<h3 class="agenda__data">' +
          '<span class="agenda__numero">' + d.getDate() + '</span>' +
          '<span class="agenda__semana">' + U.esc(maiuscula(U.DIAS_SEMANA[d.getDay()])) +
            (dia === hoje ? ' <span class="selo selo--padrao">Hoje</span>' : '') +
            (feriados[dia] ? '<small>Feriado · ' + U.esc(feriados[dia]) + '</small>' : '') +
          '</span>' +
        '</h3>' +
        (itens.length
          ? '<div class="lista-missoes">' + itens.map(function (oc) {
              return Detalhe.cartaoMissaoHtml(oc, ctx, { acoes: true, mostrarStatus: true, compacto: true });
            }).join('') + '</div>'
          : '<p class="agenda__vazio">Nada previsto.</p>') +
      '</section>');
    }
    return '<div class="agenda so-celular">' + (blocos.length ? blocos.join('')
      : '<div class="vazio"><span class="vazio__icone">' + icone('plano') + '</span><strong>Nenhuma missão em ' +
        U.esc(U.mesPorExtenso(estado.mes)) + '</strong><p>Ajuste os filtros ou navegue pelos meses.</p></div>') + '</div>';
  }

  /* ---------- eventos ---------- */

  function mudou(el, recarregarDados) {
    gravarEstado();
    if (recarregarDados) { carregar(el, false); } else { desenhar(el); }
  }

  function ligar(el, raiz) {
    if (!raiz) { return; }

    raiz.addEventListener('click', function (evento) {
      if (Detalhe.tratarClique(evento, function (id) { return cache && cache.porId[id] ? cache.porId[id] : null; })) { return; }
      var alvo = evento.target;
      if (!alvo || !alvo.closest || !estado) { return; }

      var modo = alvo.closest('[data-modo]');
      if (modo) {
        var novo = modo.getAttribute('data-modo');
        if (novo !== estado.modo) { estado.modo = novo; mudou(el, true); }
        return;
      }
      var escopo = alvo.closest('[data-escopo]');
      if (escopo) {
        estado.escopo = escopo.getAttribute('data-escopo') === 'minhas' ? 'minhas' : 'todas';
        estado.responsavel = '';
        mudou(el, false);
        return;
      }
      var periodo = alvo.closest('[data-periodo]');
      if (periodo) {
        var p = periodo.getAttribute('data-periodo');
        if (p !== estado.periodo) {
          estado.periodo = p;
          estado.limiteConcluidas = LOTE_CONCLUIDAS;
          if (p === 'atrasadas') { estado.coluna = 'afazer'; }
          mudou(el, true);
        }
        return;
      }
      var coluna = alvo.closest('[data-coluna]');
      if (coluna) {
        estado.coluna = coluna.getAttribute('data-coluna');
        mudou(el, false);
        return;
      }
      var mes = alvo.closest('[data-mes]');
      if (mes) {
        var qual = mes.getAttribute('data-mes');
        var hoje = U.hojeBelem();
        if (qual === 'anterior') { estado.mes = somarMeses(estado.mes, -1); estado.dia = null; }
        else if (qual === 'proximo') { estado.mes = somarMeses(estado.mes, 1); estado.dia = null; }
        else { estado.mes = mesDe(hoje); estado.dia = hoje; }
        mudou(el, true);
        return;
      }
      var selecionar = alvo.closest('[data-selecionar-dia]');
      var celula = selecionar ? null : alvo.closest('.calendario__dia');
      if (selecionar || celula) {
        var dia = selecionar ? selecionar.getAttribute('data-selecionar-dia') : celula.getAttribute('data-dia');
        if (Recorrencia.dataValida(dia)) {
          estado.dia = dia;
          if (mesDe(dia) !== estado.mes) { estado.mes = mesDe(dia); mudou(el, true); } else { mudou(el, false); }
          var lista = U.$('.calendario-dia', el);
          if (lista && selecionar && selecionar.classList.contains('calendario__mais')) {
            try { lista.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { /* navegador antigo */ }
          }
        }
        return;
      }
      if (alvo.closest('[data-acao="mais-concluidas"]')) {
        estado.limiteConcluidas = (estado.limiteConcluidas || LOTE_CONCLUIDAS) + LOTE_CONCLUIDAS;
        desenhar(el);
        return;
      }
      var alternar = alvo.closest('[data-acao="alternar-filtros"]');
      if (alternar) {
        filtrosAbertos = !filtrosAbertos;
        var caixa = U.$('#quadroFiltros', el);
        if (caixa) { caixa.classList.toggle('filtros-quadro--recolhido', !filtrosAbertos); }
        alternar.setAttribute('aria-expanded', filtrosAbertos ? 'true' : 'false');
        return;
      }
      if (alvo.closest('[data-acao="limpar-filtros"]')) {
        var p0 = padrao(App.militar());
        estado.escopo = p0.escopo;
        estado.responsavel = '';
        estado.setor = '';
        estado.periodo = p0.periodo;
        estado.ocultarDiarias = p0.ocultarDiarias;
        estado.limiteConcluidas = LOTE_CONCLUIDAS;
        mudou(el, true);
      }
    });

    raiz.addEventListener('change', function (evento) {
      var alvo = evento.target;
      if (!estado || !alvo) { return; }
      if (alvo.id === 'quadroResponsavel') {
        estado.responsavel = alvo.value;
        estado.escopo = alvo.value ? 'todas' : estado.escopo;
        mudou(el, false);
      } else if (alvo.id === 'quadroSetor') {
        estado.setor = alvo.value;
        mudou(el, false);
      } else if (alvo.id === 'quadroOcultarDiarias') {
        estado.ocultarDiarias = !!alvo.checked;
        mudou(el, false);
      }
    });
  }

  return {
    titulo: 'Quadro',
    render: render,
    aoVivo: aoVivo
  };
})();
