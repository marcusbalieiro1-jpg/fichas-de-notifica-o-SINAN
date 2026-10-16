/* =========================================================================
   HABE – AQS e NSP — Início
   A primeira tela de quem entra: a saudação, o que exige atenção agora
   (alertas de continuidade para os gestores, avisos sem ciência), os
   indicadores, as missões de hoje e dos próximos dias, e um lado lúdico —
   o placar do mês por militar, a medalha de "missão cumprida" e as
   sequências das atividades diárias.

   "Minhas / Equipe": o adjunto abre nas suas missões; a chefia, na equipe.
   A conta institucional (administrador) não recebe missões, então abre
   sempre na equipe e não mostra a alternância.

   Busca as ocorrências de (início do mês − 45 dias) até (hoje + 31) e,
   além delas, todas as que estão em aberto: uma missão esquecida há meses
   é justamente a que mais precisa aparecer aqui.
   Ver docs/ARQUITETURA.md, seções 2, 5 e 7.
   ========================================================================= */

Paginas.inicio = (function () {
  'use strict';

  var CHAVE_VISAO = 'aqs_inicio_visao';
  /* Mudanças nestas tabelas mexem em algo desta tela (notificações e
     auditoria, não). */
  var TABELAS = ['ocorrencias', 'atividades', 'atividade_responsaveis', 'evidencias', 'comentarios',
                 'avisos', 'avisos_ciencia', 'avisos_destinatarios', 'militares', 'setores', 'feriados',
                 'configuracoes'];
  var MAX_HOJE = 8;
  var MAX_PROXIMOS = 8;
  var MAX_AVISOS = 3;
  var MAX_ALERTAS = 3;
  var LIMITE_SEQUENCIA = 400;

  /* geracao: cresce a cada render (descarta respostas de uma montagem
     anterior); carga: cresce a cada busca (vale só a mais recente). */
  var geracao = 0;
  var carga = 0;
  var estado = { dados: null, visao: 'minhas', alertasAbertos: false };

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

  function lerSessao(chave) {
    try { return window.sessionStorage.getItem(chave); } catch (e) { return null; }
  }

  function gravarSessao(chave, valor) {
    try { window.sessionStorage.setItem(chave, valor); } catch (e) { /* vale só nesta visita */ }
  }

  /* Hora atual em Belém (0–23), para a saudação. */
  function horaBelem() {
    try {
      var texto = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Belem', hour: '2-digit', hourCycle: 'h23' })
        .format(new Date());
      var h = parseInt(texto, 10);
      if (isFinite(h)) { return h % 24; }
    } catch (e) { /* cai na conta fixa: Belém é UTC−3 o ano todo */ }
    return (new Date().getUTCHours() + 21) % 24;
  }

  function saudacao() {
    var h = horaBelem();
    if (h >= 5 && h < 12) { return 'Bom dia'; }
    if (h >= 12 && h < 18) { return 'Boa tarde'; }
    return 'Boa noite';
  }

  /* 'Quinta-feira, 15 de outubro de 2026' */
  function dataPorExtenso(data) {
    var d = U.paraData(data);
    var dia = U.DIAS_SEMANA[d.getDay()];
    return dia.charAt(0).toUpperCase() + dia.slice(1) + ', ' + d.getDate() + ' de ' + U.MESES[d.getMonth()] +
      ' de ' + d.getFullYear();
  }

  function diaCurto(data) {
    var d = U.paraData(data);
    return { numero: d.getDate(), semana: U.DIAS_SEMANA[d.getDay()].slice(0, 3) };
  }

  function eAdministrador(eu) { return !!eu && Regras.eAdministrador(eu); }

  /* Uma chave por militar: o próximo a entrar na mesma aba não herda a
     escolha de outra pessoa. */
  function chaveVisao() {
    var eu = App.militar();
    return CHAVE_VISAO + ':' + (eu && eu.id ? eu.id : 'anonimo');
  }

  function visaoInicial(eu) {
    if (eAdministrador(eu)) { return 'equipe'; }
    var salva = lerSessao(chaveVisao());
    if (salva === 'minhas' || salva === 'equipe') { return salva; }
    return Regras.eGestor(eu) ? 'equipe' : 'minhas';
  }

  function vigente(el, minhaGeracao, minhaCarga) {
    return minhaGeracao === geracao && (minhaCarga === undefined || minhaCarga === carga) &&
      !!App.militar() && !el.classList.contains('oculto') && !!U.$('.inicio', el);
  }

  function linkQuadro(periodo, visao) {
    return '#/quadro?periodo=' + periodo + '&escopo=' + (visao === 'equipe' ? 'todas' : 'minhas');
  }

  /* ---------- esqueleto ---------- */

  function esqueleto(eu) {
    var adm = eAdministrador(eu);
    return '<div class="inicio">' +
      '<section class="saudacao" aria-labelledby="inicioSaudacao">' +
        '<div class="saudacao__texto">' +
          '<p class="saudacao__data" id="inicioData"></p>' +
          '<h1 class="saudacao__titulo" id="inicioSaudacao"></h1>' +
          '<p class="saudacao__resumo" id="inicioResumo">Carregando o seu dia…</p>' +
        '</div>' +
        (adm ? '<p class="saudacao__papel">' + icone('escudo') + 'Conta institucional · visão da equipe</p>'
          : '<div class="segmentado segmentado--escuro" role="group" aria-label="Mostrar as missões">' +
              '<button type="button" class="segmentado__opcao" data-visao="minhas" aria-pressed="false">Minhas</button>' +
              '<button type="button" class="segmentado__opcao" data-visao="equipe" aria-pressed="false">Equipe</button>' +
            '</div>') +
      '</section>' +

      '<div id="inicioContinuidade"></div>' +
      '<div id="inicioAvisos"></div>' +

      '<div class="grade grade--4 inicio__indicadores" id="inicioIndicadores">' +
        ['Atrasadas', 'Vencem hoje', 'Próximos 7 dias', 'Concluídas no mês'].map(function (r) {
          return '<div class="indicador indicador--padrao"><div class="indicador__rotulo">' + r + '</div>' +
            '<div class="indicador__valor">—</div><div class="indicador__nota">&nbsp;</div></div>';
        }).join('') +
      '</div>' +

      '<div class="inicio__colunas">' +
        '<div class="inicio__principal">' +
          '<section class="cartao cartao--destaque" aria-labelledby="inicioHojeTitulo">' +
            '<div class="cartao__titulo"><h2 id="inicioHojeTitulo">' + icone('missao') + 'Minhas missões de hoje</h2>' +
              '<a class="botao botao--texto botao--pequeno" href="#/quadro">Abrir o quadro</a></div>' +
            '<div id="inicioHoje"><div class="carregando" role="status">Carregando…</div></div>' +
          '</section>' +
          '<section class="cartao" aria-labelledby="inicioProximosTitulo">' +
            '<div class="cartao__titulo"><h2 id="inicioProximosTitulo">' + icone('plano') + 'Próximos 7 dias</h2></div>' +
            '<div id="inicioProximos"><div class="carregando" role="status">Carregando…</div></div>' +
          '</section>' +
          '<section class="cartao oculto" id="inicioSequenciasCartao" aria-labelledby="inicioSequenciasTitulo">' +
            '<div class="cartao__titulo"><h2 id="inicioSequenciasTitulo"><span aria-hidden="true">🔥</span> Sequências</h2>' +
              '<span class="texto-pequeno texto-suave">atividades diárias</span></div>' +
            '<div id="inicioSequencias"></div>' +
          '</section>' +
        '</div>' +
        '<div class="inicio__lateral">' +
          '<section class="cartao oculto" id="inicioPendenciasCartao" aria-labelledby="inicioPendenciasTitulo">' +
            '<div class="cartao__titulo"><h2 id="inicioPendenciasTitulo">' + icone('equipe') + 'Pendências da equipe</h2></div>' +
            '<div id="inicioPendencias"></div>' +
          '</section>' +
          '<section class="cartao placar-cartao" aria-labelledby="inicioPlacarTitulo">' +
            '<div class="cartao__titulo"><h2 id="inicioPlacarTitulo">' + icone('relatorios') + 'Placar do mês</h2></div>' +
            '<div id="inicioPlacar"><div class="carregando" role="status">Carregando…</div></div>' +
          '</section>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* ---------- render e carga ---------- */

  function render(el) {
    geracao += 1;
    var eu = App.militar();
    estado.dados = null;
    estado.alertasAbertos = false;
    estado.visao = visaoInicial(eu);
    el.innerHTML = esqueleto(eu);
    desenharSaudacao(el, eu);
    marcarVisao(el);
    ligar(el, U.$('.inicio', el));
    carregar(el);
  }

  /* Atualização ao vivo: busca de novo e redesenha só os dados, sem
     "Carregando…" (a tela não pisca nem perde a rolagem). */
  function aoVivo(el, params, tabelas) {
    if (Array.isArray(tabelas) && tabelas.length && !tabelas.some(function (t) { return contem(TABELAS, t); })) { return; }
    if (!U.$('.inicio', el)) { render(el); return; }
    carregar(el);
  }

  function carregar(el) {
    var minhaGeracao = geracao;
    var minhaCarga = ++carga;
    var eu = App.militar();
    var hoje = U.hojeBelem();
    var inicioMes = hoje.slice(0, 8) + '01';
    var de = U.somarDias(inicioMes, -45);
    var ate = U.somarDias(hoje, 31);
    var gestor = Regras.eGestor(eu);

    Promise.all([
      Api.referencias(),
      Api.listarOcorrencias({ de: de, ate: ate }),
      Api.listarOcorrencias({ somenteAbertas: true }),
      Api.listarAtividades(),
      /* Avisos e configurações não derrubam a tela se falharem. */
      Api.listarAvisos({}).catch(function (erro) { console.warn('Avisos indisponíveis agora.', erro); return null; }),
      gestor ? Api.obterConfiguracoes().catch(function (erro) {
        console.warn('Configurações indisponíveis agora.', erro);
        return null;
      }) : Promise.resolve(null)
    ]).then(function (r) {
      if (!vigente(el, minhaGeracao, minhaCarga)) { return; }
      var atividades = r[3] || [];
      var arquivadas = {};
      atividades.forEach(function (a) { if (a.ativa === false) { arquivadas[a.id] = true; } });

      /* Janela + todas as abertas, sem repetir. As abertas de atividades
         arquivadas ficam de fora: ninguém vai mais cumpri-las. */
      var porId = {};
      var lista = [];
      (r[1] || []).concat(r[2] || []).forEach(function (oc) {
        if (!oc || porId[oc.id]) { return; }
        if (arquivadas[oc.atividade_id] && Regras.estaAberta(oc)) { return; }
        porId[oc.id] = oc;
        lista.push(oc);
      });

      estado.dados = {
        eu: App.militar(), hoje: hoje, de: de, ref: r[0], ocorrencias: lista, porId: porId,
        atividades: atividades, avisos: r[4], configuracoes: r[5], gestor: gestor
      };
      desenhar(el);
    }).catch(function (erro) {
      if (!vigente(el, minhaGeracao, minhaCarga)) { return; }
      if (estado.dados) {
        /* Já há dados na tela: mantém e só registra a falha da atualização. */
        console.warn('Início não atualizado agora.', erro);
        return;
      }
      U.falha(erro);
      var hojeEl = U.$('#inicioHoje', el);
      if (hojeEl) {
        hojeEl.innerHTML = '<div class="aviso aviso--urgente" role="alert"><span class="aviso__icone">' + icone('alerta') + '</span>' +
          '<div><strong>Não foi possível carregar as missões.</strong>' + U.esc(U.erroTexto(erro)) + '</div></div>' +
          '<div class="acoes"><button type="button" class="botao botao--secundario" data-acao="recarregar-pagina">' +
            icone('recarregar') + 'Tentar novamente</button></div>';
      }
      ['#inicioProximos', '#inicioPlacar'].forEach(function (seletor) {
        var regiao = U.$(seletor, el);
        if (regiao) { regiao.innerHTML = '<p class="texto-suave texto-pequeno mb-0">Indisponível no momento.</p>'; }
      });
      var resumo = U.$('#inicioResumo', el);
      if (resumo) { resumo.textContent = 'Não foi possível carregar as missões agora.'; }
    });
  }

  /* ---------- desenho ---------- */

  function desenharSaudacao(el, eu) {
    var hoje = U.hojeBelem();
    var nome = eAdministrador(eu) ? 'AQS' : Regras.nomeMilitar(eu);
    U.$('#inicioData', el).textContent = dataPorExtenso(hoje);
    U.$('#inicioSaudacao', el).textContent = saudacao() + ', ' + nome;
  }

  function marcarVisao(el) {
    U.$$('[data-visao]', el).forEach(function (b) {
      var ativo = b.getAttribute('data-visao') === estado.visao;
      b.classList.toggle('segmentado__opcao--ativa', ativo);
      b.setAttribute('aria-pressed', ativo ? 'true' : 'false');
    });
    var titulo = U.$('#inicioHojeTitulo', el);
    if (titulo) {
      titulo.innerHTML = icone('missao') + (estado.visao === 'equipe' ? 'Missões da equipe para hoje' : 'Minhas missões de hoje');
    }
  }

  function contexto(d) {
    return { hoje: d.hoje, eu: d.eu, mapaMilitares: d.ref.mapaMilitares, mapaSetores: d.ref.mapaSetores };
  }

  function doEscopo(d) {
    if (estado.visao === 'equipe') { return d.ocorrencias; }
    return d.ocorrencias.filter(function (oc) { return contem(oc.responsaveis, d.eu.id); });
  }

  function desenhar(el) {
    var d = estado.dados;
    if (!d) { return; }
    var eu = d.eu;
    var hoje = d.hoje;
    var escopo = doEscopo(d);
    var abertas = escopo.filter(Regras.estaAberta);
    var em7 = U.somarDias(hoje, 7);
    var mes = hoje.slice(0, 7);

    var atrasadas = abertas.filter(function (oc) { return oc.prazo && oc.prazo < hoje; });
    var deHoje = abertas.filter(function (oc) { return oc.prazo === hoje; });
    var proximas = abertas.filter(function (oc) { return oc.prazo && oc.prazo > hoje && oc.prazo <= em7; });
    var concluidasMes = escopo.filter(function (oc) {
      return oc.status === 'concluida' && String(Regras.dataBelem(oc.concluida_em) || '').slice(0, 7) === mes;
    });
    var semPrazo = abertas.filter(function (oc) { return !oc.prazo; });

    desenharSaudacao(el, eu);
    marcarVisao(el);
    desenharResumo(el, atrasadas.length, deHoje.length);
    desenharContinuidade(el, d);
    desenharAvisos(el, d);
    desenharIndicadores(el, atrasadas.length, deHoje.length, proximas.length, concluidasMes.length);
    desenharHoje(el, d, atrasadas.concat(deHoje).sort(Detalhe.compararAbertas), semPrazo.length, proximas);
    desenharProximos(el, d, proximas.sort(Detalhe.compararAbertas));
    desenharSequencias(el, d, escopo);
    desenharPendencias(el, d);
    desenharPlacar(el, d);
    U.aplicarLarguras(el);
  }

  function desenharResumo(el, nAtrasadas, nHoje) {
    var resumo = U.$('#inicioResumo', el);
    if (!resumo) { return; }
    var equipe = estado.visao === 'equipe';
    var total = nAtrasadas + nHoje;
    var texto;
    if (!total) {
      texto = equipe ? 'A equipe está em dia: nenhuma missão atrasada ou vencendo hoje.' : 'Você está em dia: nenhuma missão atrasada ou vencendo hoje.';
    } else {
      texto = (equipe ? 'A equipe tem ' : 'Você tem ') + plural(total, 'missão', 'missões') + ' para hoje' +
        (nAtrasadas ? ', ' + (nAtrasadas === 1 ? '1 delas atrasada' : nAtrasadas + ' delas atrasadas') : '') + '.';
    }
    resumo.textContent = texto;
  }

  /* Alertas de continuidade: no topo, só para gestores. */
  function desenharContinuidade(el, d) {
    var caixa = U.$('#inicioContinuidade', el);
    if (!caixa) { return; }
    if (!d.gestor || !d.configuracoes) { caixa.innerHTML = ''; return; }
    var alertas = Regras.alertasContinuidade({
      militares: d.ref.militares,
      atividades: d.atividades,
      feriados: d.ref.listaFeriados || Object.keys(d.ref.feriados || {}),
      configuracoes: d.configuracoes,
      hoje: d.hoje,
      militar: d.eu
    });
    if (!alertas.length) { caixa.innerHTML = ''; return; }
    var visiveis = estado.alertasAbertos ? alertas : alertas.slice(0, MAX_ALERTAS);
    var classes = { urgente: 'aviso--urgente', atencao: 'aviso--atencao', info: '' };
    var simbolos = { urgente: 'alerta', atencao: 'alerta', info: 'info' };
    caixa.innerHTML =
      '<section class="continuidade" aria-labelledby="inicioContinuidadeTitulo">' +
        '<h2 class="titulo-secao" id="inicioContinuidadeTitulo">' + icone('escudo') + 'Continuidade da ferramenta</h2>' +
        '<div class="continuidade__lista">' + visiveis.map(function (a) {
          var nivel = Object.prototype.hasOwnProperty.call(classes, a.nivel) ? a.nivel : 'info';
          var link = /^#\/[a-z]/.test(String(a.link || '')) ? a.link : '';
          return '<article class="aviso alerta-continuidade alerta-continuidade--' + nivel + (classes[nivel] ? ' ' + classes[nivel] : '') + '">' +
            '<span class="aviso__icone">' + icone(simbolos[nivel]) + '</span>' +
            '<div class="cresce"><strong>' + U.esc(a.titulo) + '</strong>' +
              '<span class="alerta-continuidade__texto">' + U.esc(a.texto) + '</span>' +
              (link ? '<a class="alerta-continuidade__link" href="' + U.esc(link) + '">Resolver →</a>' : '') +
            '</div>' +
          '</article>';
        }).join('') + '</div>' +
        (alertas.length > visiveis.length
          ? '<button type="button" class="botao botao--texto botao--pequeno" data-acao="mais-alertas">' +
            'Mostrar mais ' + (alertas.length - visiveis.length) + '</button>'
          : '') +
      '</section>';
  }

  function avisosPendentes(d) {
    var hoje = d.hoje;
    var eu = d.eu;
    return (d.avisos || []).filter(function (av) {
      if (!av || av.ciente_por_mim) { return false; }
      if (av.expira_em && av.expira_em < hoje) { return false; }
      if (av.criado_por && av.criado_por === eu.id) { return false; }
      if (!Regras.podeVerAviso(eu, av)) { return false; }
      return !!av.para_todos || contem(av.destinatarios, eu.id);
    });
  }

  function desenharAvisos(el, d) {
    var caixa = U.$('#inicioAvisos', el);
    if (!caixa) { return; }
    var lista = avisosPendentes(d);
    if (!lista.length) { caixa.innerHTML = ''; return; }
    var classes = { urgente: 'aviso--urgente', importante: 'aviso--atencao', informativo: '' };
    caixa.innerHTML =
      '<section class="avisos-inicio" aria-labelledby="inicioAvisosTitulo">' +
        '<div class="avisos-inicio__cabecalho">' +
          '<h2 class="titulo-secao mb-0" id="inicioAvisosTitulo">' + icone('avisos') + 'Avisos para você ' +
            '<span class="contador">' + lista.length + '</span></h2>' +
          '<a class="botao botao--texto botao--pequeno" href="#/avisos">Ver todos os avisos</a>' +
        '</div>' +
        lista.slice(0, MAX_AVISOS).map(function (av) {
          var nivel = Object.prototype.hasOwnProperty.call(classes, av.nivel) ? av.nivel : 'informativo';
          var autor = av.criado_por && d.ref.mapaMilitares[av.criado_por]
            ? Regras.nomeMilitar(d.ref.mapaMilitares[av.criado_por]) : (av.criado_por_nome || 'Chefia');
          return '<article class="aviso aviso-inicio aviso-inicio--' + nivel + (classes[nivel] ? ' ' + classes[nivel] : '') + '">' +
            '<span class="aviso__icone">' + icone('avisos') + '</span>' +
            '<div class="cresce">' +
              '<div class="aviso-inicio__topo">' +
                (av.fixado ? '<span class="aviso-inicio__fixado" title="Aviso fixado">📌</span>' : '') +
                Regras.seloNivel(nivel) +
                '<h3 class="aviso-inicio__titulo">' + U.esc(av.titulo) + '</h3>' +
              '</div>' +
              (String(av.mensagem || '').trim() ? '<div class="aviso-inicio__mensagem">' + U.escMultilinha(av.mensagem) + '</div>' : '') +
              '<div class="aviso-inicio__meta">' + U.esc(autor) + ' · ' +
                '<time datetime="' + U.esc(av.criado_em) + '" title="' + U.esc(U.formatarDataHora(av.criado_em)) + '">' +
                U.esc(U.tempoRelativo(av.criado_em)) + '</time>' +
                (av.prazo ? ' · <strong class="aviso-inicio__prazo">Prazo: ' + U.esc(U.formatarData(av.prazo)) + '</strong>' : '') +
              '</div>' +
              '<div class="acoes acoes--topo mt-1">' +
                '<button type="button" class="botao botao--pequeno" data-ciente="' + U.esc(av.id) + '">' + icone('check') + 'Ciente</button>' +
                (av.atividade_id ? '<button type="button" class="botao botao--secundario botao--pequeno" data-abrir-atividade="' +
                  U.esc(av.atividade_id) + '">Ver a atividade</button>' : '') +
              '</div>' +
            '</div>' +
          '</article>';
        }).join('') +
        (lista.length > MAX_AVISOS
          ? '<p class="texto-pequeno texto-suave mb-0">E mais ' + (lista.length - MAX_AVISOS) +
            ' — <a href="#/avisos">ver todos os avisos</a>.</p>'
          : '') +
      '</section>';
  }

  function desenharIndicadores(el, nAtrasadas, nHoje, nProximas, nConcluidas) {
    var caixa = U.$('#inicioIndicadores', el);
    if (!caixa) { return; }
    var v = estado.visao;
    var de = v === 'equipe' ? 'da equipe' : 'suas';
    function indicador(classe, rotulo, valor, nota, href) {
      return '<a class="indicador indicador--' + classe + ' indicador--link" href="' + U.esc(href) + '">' +
        '<div class="indicador__rotulo">' + U.esc(rotulo) + '</div>' +
        '<div class="indicador__valor">' + valor + '</div>' +
        '<div class="indicador__nota">' + U.esc(nota) + '</div>' +
      '</a>';
    }
    caixa.innerHTML =
      indicador(nAtrasadas ? 'urgente' : 'sucesso', 'Atrasadas', nAtrasadas,
        nAtrasadas ? 'prazo vencido — ' + de : 'nenhuma — muito bem!', linkQuadro('atrasadas', v)) +
      indicador('atencao', 'Vencem hoje', nHoje, nHoje ? 'conclua até o fim do expediente' : 'nada para hoje', linkQuadro('semana', v)) +
      indicador('padrao', 'Próximos 7 dias', nProximas, 'a partir de amanhã', linkQuadro('30dias', v)) +
      indicador('sucesso', 'Concluídas no mês', nConcluidas, U.mesPorExtenso(U.hojeBelem().slice(0, 7)), linkQuadro('mes', v));
  }

  function desenharHoje(el, d, lista, nSemPrazo, proximas) {
    var caixa = U.$('#inicioHoje', el);
    if (!caixa) { return; }
    var ctx = contexto(d);
    var equipe = estado.visao === 'equipe';
    var html;
    if (!lista.length) {
      var proxima = proximas.length ? proximas.slice().sort(Detalhe.compararAbertas)[0] : null;
      html = '<div class="vazio vazio--festa"><span class="vazio__icone" aria-hidden="true">✈</span>' +
        '<strong>Tudo em dia! ✈</strong>' +
        '<p>' + (equipe ? 'Nenhuma missão da equipe atrasada ou com prazo hoje.' : 'Nenhuma missão sua atrasada ou com prazo hoje.') +
        (proxima ? ' A próxima: <strong>' + U.esc(proxima.atividade_titulo) + '</strong> (' +
          U.esc(U.descreverPrazo(proxima.prazo, d.hoje).toLowerCase()) + ').' : '') + '</p></div>';
    } else {
      html = '<div class="lista-missoes">' + lista.slice(0, MAX_HOJE).map(function (oc) {
        return Detalhe.cartaoMissaoHtml(oc, ctx, { acoes: true, mostrarStatus: true, compacto: true });
      }).join('') + '</div>';
      if (lista.length > MAX_HOJE) {
        html += '<p class="mt-1 mb-0"><a href="' + U.esc(linkQuadro('semana', estado.visao)) + '">Ver todas no quadro (' +
          lista.length + ')</a></p>';
      }
    }
    if (nSemPrazo) {
      html += '<p class="texto-pequeno texto-suave mt-1 mb-0">Também em aberto, sem prazo: ' + nSemPrazo + ' — ' +
        '<a href="' + U.esc(linkQuadro('mes', estado.visao)) + '">ver no quadro</a>.</p>';
    }
    caixa.innerHTML = html;
  }

  function desenharProximos(el, d, lista) {
    var caixa = U.$('#inicioProximos', el);
    if (!caixa) { return; }
    var equipe = estado.visao === 'equipe';
    if (!lista.length) {
      caixa.innerHTML = '<p class="texto-suave mb-0">Nenhum prazo nos próximos 7 dias.</p>';
      return;
    }
    caixa.innerHTML = '<ul class="agenda-curta">' + lista.slice(0, MAX_PROXIMOS).map(function (oc) {
      var dia = diaCurto(oc.prazo);
      var execucao = String(oc.titulo_execucao || '').trim();
      var referencia = Regras.rotuloReferencia(oc);
      return '<li><button type="button" class="agenda-curta__item" data-abrir-ocorrencia="' + U.esc(oc.id) + '">' +
        '<span class="agenda-curta__data"><strong>' + dia.numero + '</strong><small>' + U.esc(dia.semana) + '</small></span>' +
        '<span class="agenda-curta__corpo">' +
          '<span class="agenda-curta__titulo">' + U.esc(oc.atividade_titulo) + (execucao ? ' — ' + U.esc(execucao) : '') + '</span>' +
          '<span class="agenda-curta__meta">' + (referencia !== execucao ? U.esc(referencia) + ' · ' : '') +
            U.esc(U.descreverPrazo(oc.prazo, d.hoje)) +
            (oc.status === 'em_andamento' ? ' · em andamento' : '') + '</span>' +
          (equipe ? Detalhe.chipsResponsaveis(oc.responsaveis, d.ref.mapaMilitares, d.eu.id) : '') +
        '</span>' +
        (oc.prioridade === 'alta' || oc.prioridade === 'urgente' ? Regras.seloPrioridade(oc.prioridade) : '') +
      '</button></li>';
    }).join('') + '</ul>' +
    (lista.length > MAX_PROXIMOS
      ? '<p class="mt-1 mb-0 texto-pequeno"><a href="' + U.esc(linkQuadro('30dias', estado.visao)) + '">E mais ' +
        (lista.length - MAX_PROXIMOS) + ' no quadro</a></p>'
      : '');
  }

  /* Sequência de uma atividade diária: dias úteis seguidos com a
     ocorrência concluída, contando de hoje se a de hoje já foi feita, senão
     de ontem (o dia ainda não acabou). "Não se aplica" não quebra nem soma. */
  function calcularSequencia(ocorrencias, hoje, inicioDados, feriados) {
    var porData = {};
    ocorrencias.forEach(function (oc) { if (oc.prazo) { porData[oc.prazo] = oc; } });
    var deHoje = porData[hoje] || null;
    var hojeFeita = !!deHoje && deHoje.status === 'concluida';
    var dia = hojeFeita ? hoje : U.somarDias(hoje, -1);
    var total = 0;
    var noLimite = false;
    for (var passos = 0; passos < LIMITE_SEQUENCIA; passos += 1) {
      if (dia < inicioDados) { noLimite = total > 0; break; }
      if (!Recorrencia.eDiaUtil(dia, feriados)) { dia = U.somarDias(dia, -1); continue; }
      var oc = porData[dia];
      if (!oc) { break; }
      if (oc.status === 'concluida') { total += 1; }
      else if (oc.status !== 'nao_se_aplica') { break; }
      dia = U.somarDias(dia, -1);
    }
    return {
      total: total, noLimite: noLimite, hojeFeita: hojeFeita,
      hojePendente: !!deHoje && Regras.estaAberta(deHoje)
    };
  }

  function desenharSequencias(el, d, escopo) {
    var cartao = U.$('#inicioSequenciasCartao', el);
    var caixa = U.$('#inicioSequencias', el);
    if (!cartao || !caixa) { return; }
    var diarias = escopo.filter(function (oc) { return oc.periodicidade === 'diaria_util' && oc.referencia; });
    var grupos = U.agrupar(diarias, function (oc) { return oc.atividade_id; });
    var recentes = U.somarDias(d.hoje, -7);
    var itens = Object.keys(grupos).filter(function (id) {
      /* Só as diárias vivas (com ocorrência nos últimos dias). */
      return grupos[id].some(function (oc) { return oc.prazo >= recentes; });
    }).map(function (id) {
      var lista = grupos[id];
      var s = calcularSequencia(lista, d.hoje, d.de, d.ref.feriados);
      s.titulo = lista[0].atividade_titulo;
      s.responsaveis = lista[lista.length - 1].responsaveis;
      return s;
    }).sort(function (a, b) {
      if (a.total !== b.total) { return b.total - a.total; }
      return U.ordenarTexto(a.titulo, b.titulo);
    });
    cartao.classList.toggle('oculto', !itens.length);
    if (!itens.length) { caixa.innerHTML = ''; return; }
    var equipe = estado.visao === 'equipe';
    caixa.innerHTML = '<ul class="sequencias">' + itens.map(function (s) {
      var ativa = s.total > 0;
      var texto;
      if (ativa) {
        texto = (s.total === 1 ? 'dia útil concluído' : 'dias úteis seguidos concluídos') +
          (s.hojeFeita ? ' · <span class="texto-sucesso">✓ a de hoje já foi feita</span>'
            : (s.hojePendente ? ' · conclua a de hoje para chegar a ' + (s.total + 1) + (s.noLimite ? '+' : '') : ''));
      } else {
        texto = s.hojePendente ? 'conclua a de hoje para começar uma sequência' : 'nenhuma sequência ativa';
      }
      return '<li class="sequencia' + (ativa ? ' sequencia--ativa' : ' sequencia--zerada') + '">' +
        '<span class="sequencia__marcador" aria-hidden="true">🔥</span>' +
        '<span class="sequencia__numero">' + s.total + (s.noLimite ? '+' : '') + '</span>' +
        '<span class="sequencia__texto">' +
          '<strong>' + U.esc(s.titulo) + '</strong>' +
          '<small>' + texto + '</small>' +
          (equipe ? Detalhe.chipsResponsaveis(s.responsaveis, d.ref.mapaMilitares, d.eu.id) : '') +
        '</span>' +
      '</li>';
    }).join('') + '</ul>';
  }

  /* Gestores: atrasadas por militar (sempre da equipe inteira), com o
     atalho para o quadro já filtrado. */
  function desenharPendencias(el, d) {
    var cartao = U.$('#inicioPendenciasCartao', el);
    var caixa = U.$('#inicioPendencias', el);
    if (!cartao || !caixa) { return; }
    cartao.classList.toggle('oculto', !d.gestor);
    if (!d.gestor) { caixa.innerHTML = ''; return; }
    var atrasadas = d.ocorrencias.filter(function (oc) { return Regras.estaAtrasada(oc, d.hoje); });
    var militares = Regras.militaresAtribuiveis(d.ref.militares);
    var atribuiveis = {};
    militares.forEach(function (m) { atribuiveis[m.id] = true; });
    var linhas = militares.map(function (m) {
      return {
        id: m.id, nome: Regras.nomeMilitar(m),
        total: atrasadas.filter(function (oc) { return contem(oc.responsaveis, m.id); }).length
      };
    }).sort(function (a, b) { return (b.total - a.total) || U.ordenarTexto(a.nome, b.nome); });
    var semResponsavel = atrasadas.filter(function (oc) {
      return !(oc.responsaveis || []).some(function (id) { return atribuiveis[id]; });
    }).length;

    if (!linhas.length && !semResponsavel) {
      caixa.innerHTML = '<p class="texto-suave mb-0">Nenhum militar cadastrado para receber missões.</p>';
      return;
    }
    function linha(id, nome, total, classeExtra) {
      return '<li class="pendencia' + (total ? ' pendencia--atrasada' : ' pendencia--em-dia') + (classeExtra || '') + '">' +
        '<span class="pendencia__nome">' + U.esc(nome) + '</span>' +
        (total
          ? '<a class="pendencia__link" href="#/quadro?responsavel=' + encodeURIComponent(id) + '&amp;periodo=atrasadas" ' +
              'aria-label="' + U.esc('Ver as ' + total + ' atrasadas de ' + nome + ' no quadro') + '">' +
              '<span class="contador contador--urgente">' + total + '</span> ' + (total === 1 ? 'atrasada' : 'atrasadas') + ' →</a>'
          : '<span class="pendencia__ok">✓ em dia</span>') +
      '</li>';
    }
    caixa.innerHTML =
      '<p class="texto-pequeno texto-suave mt-0">' + (atrasadas.length
        ? plural(atrasadas.length, 'missão atrasada', 'missões atrasadas') + ' na equipe.'
        : 'Nenhuma missão atrasada na equipe. 👏') + '</p>' +
      '<ul class="pendencias">' +
        linhas.map(function (l) { return linha(l.id, l.nome, l.total); }).join('') +
        (semResponsavel ? linha('sem', 'Sem responsável', semResponsavel, ' pendencia--sem-responsavel') : '') +
      '</ul>';
  }

  /* Placar do mês: cumprimento (Regras.conformidade) por militar e por
     setor. A conta institucional não aparece (militaresAtribuiveis). */
  function desenharPlacar(el, d) {
    var caixa = U.$('#inicioPlacar', el);
    if (!caixa) { return; }
    var mes = d.hoje.slice(0, 7);
    var doMes = d.ocorrencias.filter(function (oc) { return String(oc.data_ref || '').slice(0, 7) === mes; });
    var militares = Regras.militaresAtribuiveis(d.ref.militares).slice().sort(function (a, b) {
      return U.ordenarTexto(Regras.nomeMilitar(a), Regras.nomeMilitar(b));
    });
    var titulo = U.$('#inicioPlacarTitulo', el);
    if (titulo) {
      var nomeMes = U.MESES[Number(mes.slice(5, 7)) - 1];
      titulo.innerHTML = icone('relatorios') + 'Placar de ' + U.esc(nomeMes);
    }
    if (!militares.length) {
      caixa.innerHTML = '<p class="texto-suave mb-0">Nenhum militar cadastrado para receber missões.</p>';
      return;
    }

    var aneis = militares.map(function (m) {
      var conf = Regras.conformidade(doMes.filter(function (oc) { return contem(oc.responsaveis, m.id); }), d.hoje);
      var completo = conf.universo > 0 && conf.percentual === 100;
      var eu = m.id === d.eu.id;
      var detalhe = conf.universo
        ? conf.concluidas + ' de ' + conf.universo + (conf.atrasadas ? ' · ' + plural(conf.atrasadas, 'atrasada', 'atrasadas') : '')
        : 'nada vencido ainda';
      return '<li class="placar__item' + (eu ? ' placar__item--eu' : '') + (completo ? ' placar__item--completo' : '') + '">' +
        U.anelProgresso(conf.percentual || 0, Regras.nomeMilitar(m) + (eu ? ' (você)' : ''), conf.universo ? '' : 'anel--vazio') +
        '<span class="placar__detalhe">' + U.esc(detalhe) + '</span>' +
        (completo ? '<span class="placar__medalha" title="100% das missões vencidas no mês cumpridas">🏅 Missão cumprida</span>' : '') +
      '</li>';
    }).join('');

    var setores = (d.ref.setores || []).slice().sort(function (a, b) {
      return ((a.ordem || 0) - (b.ordem || 0)) || U.ordenarTexto(a.sigla, b.sigla);
    }).map(function (s) {
      var conf = Regras.conformidade(doMes.filter(function (oc) { return oc.setor_id === s.id; }), d.hoje);
      return { setor: s, conf: conf };
    }).filter(function (x) { return x.conf.universo > 0; });

    var barras = setores.length
      ? '<h3 class="placar__subtitulo">Por setor</h3>' + setores.map(function (x) {
          var p = x.conf.percentual || 0;
          var classe = p >= 90 ? 'sucesso' : (p >= 70 ? 'padrao' : (p >= 40 ? 'atencao' : 'urgente'));
          return '<div class="barra-linha placar__barra" title="' + U.esc(x.setor.nome + ': ' + x.conf.concluidas + ' de ' + x.conf.universo) + '">' +
            '<span class="barra-linha__rotulo">' + U.esc(x.setor.sigla) + '</span>' +
            '<span class="barra-linha__trilho"><span class="barra-linha__preenchimento barra-linha__preenchimento--' + classe +
              '" data-largura="' + p + '"></span></span>' +
            '<span class="barra-linha__valor">' + p + '%</span>' +
          '</div>';
        }).join('')
      : '';

    caixa.innerHTML =
      '<p class="texto-pequeno texto-suave mt-0">Missões vencidas no mês e já cumpridas (concluir adiantado também conta).</p>' +
      '<ul class="placar">' + aneis + '</ul>' + barras;
  }

  /* ---------- eventos ---------- */

  function ligar(el, raiz) {
    if (!raiz) { return; }
    raiz.addEventListener('click', function (evento) {
      var d = estado.dados;
      if (Detalhe.tratarClique(evento, function (id) { return d && d.porId[id] ? d.porId[id] : null; })) { return; }
      var alvo = evento.target;
      if (!alvo || !alvo.closest) { return; }

      var visao = alvo.closest('[data-visao]');
      if (visao) {
        var nova = visao.getAttribute('data-visao');
        if (nova !== estado.visao && (nova === 'minhas' || nova === 'equipe')) {
          estado.visao = nova;
          gravarSessao(chaveVisao(), nova);
          if (estado.dados) { desenhar(el); } else { marcarVisao(el); }
        }
        return;
      }

      var ciente = alvo.closest('[data-ciente]');
      if (ciente && !ciente.disabled) {
        var id = ciente.getAttribute('data-ciente');
        ciente.disabled = true;
        ciente.setAttribute('aria-busy', 'true');
        Api.darCiencia(id).then(function () {
          U.torrada('Ciência registrada.', 'sucesso');
          if (estado.dados && estado.dados.avisos) {
            estado.dados.avisos.forEach(function (av) { if (av.id === id) { av.ciente_por_mim = true; } });
            desenharAvisos(el, estado.dados);
          }
          App.atualizarContadores();
        }).catch(function (erro) {
          U.falha(erro);
          if (document.body.contains(ciente)) { ciente.disabled = false; ciente.removeAttribute('aria-busy'); }
        });
        return;
      }

      if (alvo.closest('[data-acao="mais-alertas"]')) {
        estado.alertasAbertos = true;
        if (estado.dados) { desenharContinuidade(el, estado.dados); }
      }
    });
  }

  return {
    titulo: 'Início',
    render: render,
    aoVivo: aoVivo
  };
})();
