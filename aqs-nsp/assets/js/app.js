/* =========================================================================
   HABE – AQS e NSP — aplicativo: tema, identidade, navegação, contadores,
   notificações e atualização ao vivo
   Último script da página: quando ele roda, todas as páginas (Paginas.*),
   o Detalhe, a Sessao e o TempoReal já existem.
   Ver docs/ARQUITETURA.md, seções 2 e 7.

   Ciclo:
     Sessao.iniciar(aoEntrar, aoSair)
     aoEntrar(militar): cabeçalho + menus do papel, TempoReal.iniciar(),
       roteador por hash, contadores e geração de ocorrências em segundo plano
     aoSair(motivo): para o tempo real, fecha painel e menus e APAGA páginas,
       cabeçalho e contadores — nenhum dado sensível fica no DOM.

   Endereços: #/rota?param=valor. Rotas desconhecidas caem em #/inicio.
   ?ocorrencia=ID e ?atividade=ID (em qualquer rota) abrem o painel de
   detalhe depois de montar a página; ao fechar o painel, o parâmetro sai
   do endereço (history.replaceState, sem recarregar nada).
   ========================================================================= */

var App = (function () {
  'use strict';

  var ROTA_PADRAO = 'inicio';
  var ROTAS = ['inicio', 'quadro', 'atividades', 'avisos', 'relatorios', 'plano', 'equipe', 'conta'];
  /* Rotas que, no celular, ficam no menu "Mais" (o botão fica aceso nelas). */
  var ROTAS_DO_MAIS = ['relatorios', 'plano', 'equipe', 'conta'];
  var PARAMETROS_DO_PAINEL = ['ocorrencia', 'atividade'];
  var TABELAS_REFERENCIA = ['militares', 'setores', 'feriados'];
  var TABELAS_DOS_CONTADORES = ['notificacoes', 'avisos', 'avisos_ciencia', 'avisos_destinatarios'];
  var CHAVE_TEMA = 'aqs_tema';
  var LARGURA_CELULAR = 720;
  var TITULO_BASE = 'HABE · AQS e NSP';
  var NOME_ADMINISTRADOR = 'AQS — conta institucional';

  /* Usado só se a página não declarar o próprio título. */
  var TITULOS = {
    inicio: 'Início', quadro: 'Quadro', atividades: 'Atividades', avisos: 'Avisos',
    relatorios: 'Relatórios', plano: 'Plano de Atividades', equipe: 'Equipe', conta: 'Minha conta'
  };

  var ICONE_NOTIFICACAO = { atribuicao: 'missao', comentario: 'comentario', aviso: 'avisos', prazo: 'relogio' };

  /* ---------- estado ---------- */

  var militarAtual = null;
  /* Cresce a cada entrada/saída: respostas que chegam depois de uma troca
     de sessão são descartadas (nunca pintam dados de outra sessão). */
  var geracao = 0;
  var funcaoPainel = null;
  var renderizada = { nome: null, chave: null, parametros: {} };
  var recargaAdiada = null;     /* { elemento, tabelas (null = todas), ouvinte } */
  var detalhePendente = false;
  var notificacoesDoMenu = [];
  var seqContadores = 0;
  var seqMenu = 0;

  /* ---------- auxiliares ---------- */

  function icone(nome) {
    return '<svg class="icone" aria-hidden="true" focusable="false"><use href="#i-' + nome + '"></use></svg>';
  }

  function modoDemo() {
    return typeof Api !== 'undefined' && !!Api && Api.modo === 'demo';
  }

  /* Título da aba; na demonstração, marcado para não se confundir com o
     sistema oficial aberto em outra aba. */
  function tituloDaAba(pagina) {
    return (modoDemo() ? '[Demonstração] ' : '') + (pagina ? pagina + ' · ' + TITULO_BASE : TITULO_BASE + ' — Gestão de Atividades');
  }

  function copiar(objeto) {
    var copia = {};
    Object.keys(objeto || {}).forEach(function (k) { copia[k] = objeto[k]; });
    return copia;
  }

  function contemAlguma(lista, procuradas) {
    return procuradas.some(function (t) { return lista.indexOf(t) >= 0; });
  }

  function celular() {
    return window.innerWidth < LARGURA_CELULAR;
  }

  function erroPaginaHtml(titulo, texto) {
    return '<div class="pagina-erro">' +
      '<div class="aviso aviso--urgente" role="alert"><span class="aviso__icone">' + icone('alerta') + '</span>' +
        '<div><strong>' + U.esc(titulo) + '</strong>' + U.esc(texto) + '</div></div>' +
      '<div class="acoes"><button type="button" class="botao botao--secundario" data-acao="recarregar-pagina">' +
        'Tentar novamente</button></div>' +
    '</div>';
  }

  /* Nome e papel como aparecem no cabeçalho. A conta institucional tem
     nome fixo: não é uma pessoa. */
  function identidade(m) {
    var adm = Regras.eAdministrador(m);
    var nome = adm ? NOME_ADMINISTRADOR : Regras.nomeMilitar(m);
    var papel = adm ? 'Administrador' : (Regras.ROTULOS.papel[m.papel] || 'Militar');
    var classe = 'avatar' + (adm ? ' avatar--administrador' : (m.papel === 'adjunto' ? ' avatar--adjunto' : ''));
    return { nome: nome, papel: papel, iniciais: Sessao.iniciais(nome, adm), classeAvatar: classe };
  }

  /* ---------- tema ---------- */

  function lerPreferenciaTema() {
    try {
      var valor = window.localStorage.getItem(CHAVE_TEMA);
      return (valor === 'claro' || valor === 'escuro') ? valor : 'automatico';
    } catch (e) {
      return 'automatico';
    }
  }

  /* 'claro' e 'escuro' são escolhas explícitas. 'automatico' acompanha o
     ambiente: o tema do sistema operacional ou, quando a página está
     embutida num visualizador, o dele (data-theme), como no HABE SINAN. */
  function temaEfetivo(preferencia) {
    if (preferencia === 'claro' || preferencia === 'escuro') { return preferencia; }
    var doVisualizador = document.documentElement.getAttribute('data-theme');
    if (doVisualizador === 'dark') { return 'escuro'; }
    if (doVisualizador === 'light') { return 'claro'; }
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'escuro' : 'claro';
  }

  function aplicarTema(preferencia) {
    var tema = temaEfetivo(preferencia);
    document.documentElement.setAttribute('data-tema', tema);
    var botao = document.getElementById('botaoTema');
    if (botao) {
      var rotulo = tema === 'escuro' ? 'Mudar para o tema claro' : 'Mudar para o tema escuro';
      botao.setAttribute('aria-label', rotulo);
      botao.title = rotulo;
    }
    return tema;
  }

  function definirTema(preferencia) {
    var p = (preferencia === 'claro' || preferencia === 'escuro') ? preferencia : 'automatico';
    try { window.localStorage.setItem(CHAVE_TEMA, p); } catch (e) { /* vale só nesta visita */ }
    aplicarTema(p);
    return p;
  }

  function alternarTema() {
    var atual = document.documentElement.getAttribute('data-tema');
    definirTema(atual === 'escuro' ? 'claro' : 'escuro');
  }

  function seguirTemaDoAmbiente() {
    function reaplicar() {
      if (lerPreferenciaTema() === 'automatico') { aplicarTema('automatico'); }
    }
    if (window.matchMedia) {
      var consulta = window.matchMedia('(prefers-color-scheme: dark)');
      if (consulta.addEventListener) { consulta.addEventListener('change', reaplicar); }
      else if (consulta.addListener) { consulta.addListener(reaplicar); }
    }
    if (window.MutationObserver) {
      new window.MutationObserver(reaplicar).observe(document.documentElement,
        { attributes: true, attributeFilter: ['data-theme'] });
    }
    /* Escolha feita em outra aba vale nesta também. */
    window.addEventListener('storage', function (evento) {
      if (evento.key === CHAVE_TEMA) { aplicarTema(lerPreferenciaTema()); }
    });
  }

  /* ---------- endereço ---------- */

  function lerRota() {
    var bruto = window.location.hash.replace(/^#\/?/, '');
    var i = bruto.indexOf('?');
    var nome = i >= 0 ? bruto.slice(0, i) : bruto;
    var consulta = i >= 0 ? bruto.slice(i + 1) : '';
    var parametros = {};
    consulta.split('&').forEach(function (par) {
      if (!par) { return; }
      var j = par.indexOf('=');
      try {
        var chave = decodeURIComponent(j >= 0 ? par.slice(0, j) : par);
        var valor = decodeURIComponent(j >= 0 ? par.slice(j + 1) : '');
        if (chave && chave !== '__proto__' && chave !== 'constructor' && chave !== 'prototype') {
          parametros[chave] = valor;
        }
      } catch (e) { /* parâmetro malformado: ignorado */ }
    });
    if (ROTAS.indexOf(nome) < 0) { nome = ROTA_PADRAO; }
    return { nome: nome, parametros: parametros };
  }

  /* Identifica "a mesma página": rota + parâmetros, sem os do painel. */
  function chaveDaRota(rota) {
    var chaves = Object.keys(rota.parametros).filter(function (k) {
      return PARAMETROS_DO_PAINEL.indexOf(k) < 0;
    }).sort();
    return rota.nome + '?' + chaves.map(function (k) { return k + '=' + rota.parametros[k]; }).join('&');
  }

  function substituirEndereco(hash) {
    try {
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search + hash);
    } catch (e) {
      window.location.replace(hash);
    }
  }

  /* Tira ?ocorrencia/?atividade do endereço sem disparar navegação. */
  function removerParametrosDoPainel() {
    var rota = lerRota();
    var tinha = PARAMETROS_DO_PAINEL.some(function (k) {
      return Object.prototype.hasOwnProperty.call(rota.parametros, k);
    });
    if (!tinha || !/^#\//.test(window.location.hash)) { return; }
    var resto = Object.keys(rota.parametros).filter(function (k) {
      return PARAMETROS_DO_PAINEL.indexOf(k) < 0;
    }).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(rota.parametros[k]);
    });
    substituirEndereco('#/' + rota.nome + (resto.length ? '?' + resto.join('&') : ''));
  }

  function temParametroDePainel(hash) {
    return /[?&](ocorrencia|atividade)=/.test(String(hash || ''));
  }

  /* ---------- navegação ---------- */

  function marcarAbaAtiva(nome) {
    U.$$('.navegacao a[data-rota], .barra-inferior__item[data-rota], .menu-mais__item[data-rota]').forEach(function (link) {
      var ativo = link.getAttribute('data-rota') === nome;
      if (link.classList.contains('barra-inferior__item')) {
        link.classList.toggle('barra-inferior__item--ativo', ativo);
      } else if (link.classList.contains('menu-mais__item')) {
        link.classList.toggle('menu-mais__item--ativo', ativo);
      } else {
        link.classList.toggle('ativo', ativo);
      }
      if (ativo) { link.setAttribute('aria-current', 'page'); } else { link.removeAttribute('aria-current'); }
    });
    var mais = document.getElementById('botaoMais');
    if (mais) { mais.classList.toggle('barra-inferior__item--ativo', ROTAS_DO_MAIS.indexOf(nome) >= 0); }
  }

  function tituloDaPagina(nome) {
    var pagina = Paginas[nome];
    return (pagina && pagina.titulo) || TITULOS[nome] || 'Início';
  }

  function renderizarPagina(nome, elemento, parametros) {
    var pagina = Paginas[nome];
    if (!pagina || typeof pagina.render !== 'function') {
      elemento.innerHTML = erroPaginaHtml('Página indisponível',
        'O módulo desta página não foi carregado. Recarregue a página; se o problema continuar, avise a AQS.');
      return;
    }
    try {
      pagina.render(elemento, copiar(parametros));
    } catch (erro) {
      console.error(erro);
      elemento.innerHTML = erroPaginaHtml('Falha ao montar a página', U.erroTexto(erro));
    }
  }

  function abrirDetalheDoEndereco(rota) {
    var tipo = rota.parametros.ocorrencia ? 'ocorrencia' : (rota.parametros.atividade ? 'atividade' : null);
    if (!tipo) { return; }
    var id = String(rota.parametros[tipo]);
    if (!/^[0-9A-Za-z_-]{1,64}$/.test(id)) {
      U.torrada('Endereço inválido: o item indicado não existe.', 'erro');
      removerParametrosDoPainel();
      return;
    }
    if (typeof Detalhe === 'undefined' || !Detalhe) {
      U.torrada('Não foi possível abrir o detalhe: o módulo não carregou. Recarregue a página.', 'erro');
      return;
    }
    detalhePendente = true;
    var minhaGeracao = geracao;
    /* Depois do render (a página já começou a montar por trás do painel). */
    window.setTimeout(function () {
      detalhePendente = false;
      if (!militarAtual || minhaGeracao !== geracao) { return; }
      try {
        if (tipo === 'ocorrencia') { Detalhe.abrirOcorrencia(id); } else { Detalhe.abrirAtividade(id); }
      } catch (erro) {
        U.falha(erro);
      }
    }, 0);
  }

  /* opcoes.forcar: remonta mesmo que seja a página já aberta;
     opcoes.semFoco: não move o foco para o conteúdo. */
  function navegar(opcoes) {
    if (!militarAtual) { return; }
    opcoes = opcoes || {};
    var rota = lerRota();
    var elemento = document.getElementById('pagina-' + rota.nome);
    if (!elemento) { return; }
    var chave = chaveDaRota(rota);
    var mesmaPagina = !opcoes.forcar && renderizada.chave === chave &&
      !elemento.classList.contains('oculto') && elemento.childNodes.length > 0;

    fecharMenuNotificacoes(false);
    fecharMenuMais(false);

    if (!mesmaPagina) {
      U.fecharPainel();
      cancelarRecargaAdiada();
      /* Esvazia as páginas inativas: libera memória, evita ids repetidos
         entre formulários ocultos e não deixa dado esquecido no DOM. */
      U.$$('.pagina').forEach(function (secao) {
        secao.classList.add('oculto');
        if (secao !== elemento) { secao.innerHTML = ''; }
      });
      marcarAbaAtiva(rota.nome);
      document.title = tituloDaAba(tituloDaPagina(rota.nome));
      elemento.classList.remove('oculto');
      elemento.style.minHeight = '';
      renderizada = { nome: rota.nome, chave: chave, parametros: copiar(rota.parametros) };
      renderizarPagina(rota.nome, elemento, rota.parametros);
      window.scrollTo(0, 0);
      if (!opcoes.semFoco) {
        var principal = document.getElementById('conteudo');
        if (principal) {
          try { principal.focus({ preventScroll: true }); } catch (e) { /* navegador antigo: sem foco */ }
        }
      }
    }
    abrirDetalheDoEndereco(rota);
  }

  function ir(hash) {
    var alvo = String(hash || '').trim();
    if (alvo.charAt(0) !== '#') { alvo = '#' + alvo; }
    if (alvo.indexOf('#/') !== 0) { alvo = '#/' + alvo.slice(1); }
    if (alvo === window.location.hash) { navegar(); } else { window.location.hash = alvo; }
  }

  /* Rota de destino para abrir um painel sem trocar de página. */
  function rotaAtual() {
    return renderizada.nome || ROTA_PADRAO;
  }

  /* ---------- atualização ao vivo ---------- */

  function campoEmEdicao(elemento) {
    var ativo = document.activeElement;
    if (!ativo || !elemento.contains(ativo)) { return false; }
    return /^(INPUT|SELECT|TEXTAREA)$/.test(ativo.tagName) || ativo.isContentEditable;
  }

  function cancelarRecargaAdiada() {
    if (recargaAdiada && recargaAdiada.elemento) {
      recargaAdiada.elemento.removeEventListener('focusout', recargaAdiada.ouvinte);
    }
    recargaAdiada = null;
  }

  function juntarTabelas(a, b) {
    if (a === null || b === null) { return null; }
    var todas = a.slice();
    b.forEach(function (t) { if (todas.indexOf(t) < 0) { todas.push(t); } });
    return todas;
  }

  /* Alguém está digitando na página: guarda a recarga para quando o foco
     sair dos campos (focusout + conferência no próximo ciclo, porque o foco
     pode só estar passando de um campo para outro). */
  function adiarRecarga(elemento, tabelas) {
    if (recargaAdiada && recargaAdiada.elemento === elemento) {
      recargaAdiada.tabelas = juntarTabelas(recargaAdiada.tabelas, tabelas);
      return;
    }
    cancelarRecargaAdiada();
    var minhaGeracao = geracao;
    var registro = { elemento: elemento, tabelas: tabelas, ouvinte: null };
    registro.ouvinte = function () {
      window.setTimeout(function () {
        if (recargaAdiada !== registro) { return; }
        if (!militarAtual || minhaGeracao !== geracao) { cancelarRecargaAdiada(); return; }
        if (campoEmEdicao(elemento)) { return; }
        var pendentes = registro.tabelas;
        cancelarRecargaAdiada();
        recarregarPagina(pendentes);
      }, 0);
    };
    elemento.addEventListener('focusout', registro.ouvinte);
    recargaAdiada = registro;
  }

  function recarregarPagina(tabelas) {
    var nome = renderizada.nome;
    if (!nome || !militarAtual) { return; }
    var pagina = Paginas[nome];
    if (!pagina || pagina.aoVivo === false) { return; }
    var elemento = document.getElementById('pagina-' + nome);
    if (!elemento || elemento.classList.contains('oculto')) { return; }
    if (campoEmEdicao(elemento)) { adiarRecarga(elemento, tabelas); return; }

    /* Extensão do contrato: aoVivo pode ser uma função (atualização parcial,
       sem remontar a página inteira). */
    if (typeof pagina.aoVivo === 'function') {
      try { pagina.aoVivo(elemento, copiar(renderizada.parametros), tabelas); } catch (erro) { console.error(erro); }
      return;
    }
    /* Segura a altura atual enquanto a página remonta: a rolagem não pula
       para o topo a cada atualização. */
    elemento.style.minHeight = elemento.offsetHeight + 'px';
    renderizarPagina(nome, elemento, renderizada.parametros);
    var minhaGeracao = geracao;
    window.setTimeout(function () {
      if (minhaGeracao === geracao) { elemento.style.minHeight = ''; }
    }, 1500);
  }

  /* O próprio cadastro mudou? (papel, nome, desativação ou exclusão feitos
     por um gestor em outro aparelho). Lê da lista de militares — leitura
     pura; meu_perfil() grava o último acesso e geraria mais eventos. */
  function conferirMeuCadastro() {
    var minhaGeracao = geracao;
    function valida() { return !!militarAtual && minhaGeracao === geracao; }
    Api.referencias().then(function (ref) {
      if (!valida()) { return null; }
      var atual = ref && ref.mapaMilitares ? ref.mapaMilitares[militarAtual.id] : null;
      if (atual && atual.ativo !== false) { aplicarPerfilAtualizado(atual); return null; }
      /* Sumiu da lista ou ficou inativo: confirma pelo perfil antes de
         derrubar a sessão (uma lista vazia por falha momentânea não basta). */
      return Api.meuPerfil().then(function (perfil) {
        if (!valida()) { return; }
        if (perfil && perfil.id === militarAtual.id && perfil.ativo !== false) {
          aplicarPerfilAtualizado(perfil);
        } else {
          Sessao.sair('desativado');
        }
      }, function (erro) {
        if (!valida()) { return; }
        var texto = U.erroTexto(erro);
        /* Segundo fator ativado em outro aparelho: esta sessão (só com a
           senha) deixou de valer no banco — entra de novo, com o código. */
        if (/segundo fator/i.test(texto)) { Sessao.sair('saiu'); }
        else if (/cadastro|vinculad|desativad/i.test(texto)) { Sessao.sair('desativado'); }
      });
    }).catch(function (erro) {
      console.warn('Não foi possível conferir o cadastro agora.', erro);
    });
  }

  function aplicarPerfilAtualizado(novo) {
    var antes = militarAtual;
    var mesclado = copiar(antes);
    Object.keys(novo).forEach(function (k) { mesclado[k] = novo[k]; });
    militarAtual = mesclado;
    var mudouPapel = antes.papel !== mesclado.papel;
    if (mudouPapel || Regras.nomeMilitar(antes) !== Regras.nomeMilitar(mesclado)) { montarIdentidade(); }
    if (mudouPapel) {
      U.torrada('Seu papel no sistema passou a ser: ' + identidade(mesclado).papel + '. As telas foram atualizadas.',
        'atencao', 8000);
      U.fecharPainel();
      navegar({ forcar: true, semFoco: true });
    }
  }

  /* tabelas: lista de tabelas que mudaram; vazia/ausente = tudo. */
  function recarregar(tabelas) {
    if (!militarAtual) { return; }
    var lista = (Array.isArray(tabelas) && tabelas.length) ? tabelas.slice() : null;

    if (!lista || contemAlguma(lista, TABELAS_REFERENCIA)) { Api.invalidarReferencias(); }
    if (!lista || lista.indexOf('militares') >= 0) { conferirMeuCadastro(); }

    if (funcaoPainel && U.painelAberto()) {
      try { funcaoPainel(lista); } catch (erro) { console.error(erro); }
    }
    recarregarPagina(lista);
    if (!lista || contemAlguma(lista, TABELAS_DOS_CONTADORES)) { atualizarContadores(); }
  }

  function aoAtualizarPainel(fn) {
    funcaoPainel = (typeof fn === 'function') ? fn : null;
  }

  /* Painel fechado (por quem quer que seja): a função registrada deixa de
     valer e ?ocorrencia/?atividade saem do endereço. */
  function observarPainel() {
    var raiz = document.getElementById('painelDetalhe');
    if (!raiz || !window.MutationObserver) { return; }
    new window.MutationObserver(function () {
      if (U.painelAberto()) { return; }
      funcaoPainel = null;
      if (!detalhePendente) { removerParametrosDoPainel(); }
    }).observe(raiz, { childList: true });
  }

  /* ---------- contadores ---------- */

  function mostrarContadorSino(n) {
    var contador = document.getElementById('contadorSino');
    var botao = document.getElementById('botaoSino');
    if (contador) {
      contador.textContent = n > 99 ? '99+' : String(n);
      contador.classList.toggle('oculto', !(n > 0));
    }
    if (botao) {
      var rotulo = n > 0 ? 'Notificações: ' + n + (n === 1 ? ' não lida' : ' não lidas') : 'Notificações (nenhuma não lida)';
      botao.setAttribute('aria-label', rotulo);
      botao.title = rotulo;
    }
    /* Número no ícone do aplicativo instalado (onde o navegador permitir). */
    try {
      if (n > 0 && navigator.setAppBadge) {
        navigator.setAppBadge(n).catch(function () {});
      } else if (navigator.clearAppBadge) {
        navigator.clearAppBadge().catch(function () {});
      }
    } catch (e) { /* recurso indisponível */ }
  }

  function mostrarContadorAvisos(n) {
    U.$$('[data-contador="avisos"]').forEach(function (el) {
      el.textContent = n > 99 ? '99+' : String(n);
      el.classList.toggle('oculto', !(n > 0));
      el.title = n + (n === 1 ? ' aviso aguardando a sua ciência' : ' avisos aguardando a sua ciência');
    });
  }

  /* Avisos ativos dirigidos a mim (para todos ou como destinatário) que
     ainda não receberam a minha ciência. Os gestores enxergam todos os
     avisos, mas o contador só conta os que são para eles; o autor não
     precisa dar ciência no próprio aviso. */
  function contarAvisosPendentes(lista, eu) {
    var hoje = U.hojeBelem();
    return (lista || []).filter(function (av) {
      if (!av || av.ciente_por_mim) { return false; }
      if (av.expira_em && av.expira_em < hoje) { return false; }
      if (av.criado_por && av.criado_por === eu.id) { return false; }
      if (!Regras.podeVerAviso(eu, av)) { return false; }
      return !!av.para_todos || (av.destinatarios || []).indexOf(eu.id) >= 0;
    }).length;
  }

  function atualizarContadores() {
    if (!militarAtual) { return Promise.resolve(); }
    var seq = ++seqContadores;
    var minhaGeracao = geracao;
    var eu = militarAtual;
    function valida() { return !!militarAtual && minhaGeracao === geracao && seq === seqContadores; }
    function avisar(erro) { console.warn('Contador não atualizado agora.', erro); }
    return Promise.all([
      Api.contarNaoLidas().then(function (n) {
        if (valida()) { mostrarContadorSino(Math.max(0, Number(n) || 0)); }
      }).catch(avisar),
      Api.listarAvisos({}).then(function (lista) {
        if (valida()) { mostrarContadorAvisos(contarAvisosPendentes(lista, eu)); }
      }).catch(avisar)
    ]);
  }

  /* ---------- menu de notificações (sino) ---------- */

  function menuNotificacoes() { return document.getElementById('menuNotificacoes'); }

  function menuNotificacoesAberto() {
    var menu = menuNotificacoes();
    return !!menu && !menu.classList.contains('oculto');
  }

  function posicionarMenuNotificacoes() {
    var menu = menuNotificacoes();
    if (!menu) { return; }
    if (celular()) {
      var cabecalho = document.querySelector('.cabecalho');
      var base = cabecalho ? cabecalho.getBoundingClientRect().bottom : 64;
      menu.style.top = Math.round(base + 6) + 'px';
    } else {
      menu.style.top = '';
    }
  }

  function cabecalhoMenuHtml(naoLidas) {
    return '<div class="menu-notificacoes__cabecalho">' +
      '<h2>Notificações' + (naoLidas > 0 ? ' <span class="contador contador--urgente">' + naoLidas + '</span>' : '') + '</h2>' +
      '<div class="flex gap-1 flex--sem-quebra">' +
        '<button type="button" class="botao botao--texto botao--pequeno" data-acao="marcar-todas" ' +
          'aria-label="Marcar todas como lidas"' + (naoLidas > 0 ? '' : ' disabled') + '>' +
          '<span class="sem-quebra">Marcar todas<span class="so-computador"> como lidas</span></span></button>' +
        '<button type="button" class="painel__fechar" data-acao="fechar" aria-label="Fechar as notificações">' +
          icone('fechar') + '</button>' +
      '</div>' +
    '</div>';
  }

  function itemNotificacaoHtml(n) {
    var tipo = Object.prototype.hasOwnProperty.call(ICONE_NOTIFICACAO, n.tipo) ? n.tipo : 'atribuicao';
    var rotuloTipo = Regras.ROTULOS.notificacao[tipo] || 'Notificação';
    return '<li><button type="button" class="notificacao-item' + (n.lida ? '' : ' notificacao-item--nao-lida') +
        '" data-id="' + U.esc(n.id) + '">' +
      '<span class="notificacao-item__icone notificacao-item__icone--' + tipo + '">' + icone(ICONE_NOTIFICACAO[tipo]) + '</span>' +
      '<span class="notificacao-item__corpo">' +
        (n.lida ? '' : '<span class="so-leitor-tela">Não lida: </span>') +
        '<span class="notificacao-item__titulo">' + U.esc(n.titulo || rotuloTipo) + '</span>' +
        (n.mensagem ? '<span class="notificacao-item__mensagem">' + U.esc(n.mensagem) + '</span>' : '') +
        '<span class="notificacao-item__tempo">' + U.esc(rotuloTipo) + ' · ' +
          '<time datetime="' + U.esc(n.criado_em) + '" title="' + U.esc(U.formatarDataHora(n.criado_em)) + '">' +
          U.esc(U.tempoRelativo(n.criado_em)) + '</time></span>' +
      '</span>' +
    '</button></li>';
  }

  function desenharNotificacoes(lista) {
    var menu = menuNotificacoes();
    var naoLidas = lista.filter(function (n) { return !n.lida; }).length;
    if (!lista.length) {
      menu.innerHTML = cabecalhoMenuHtml(0) +
        '<div class="menu-notificacoes__estado">' +
          '<span class="vazio__icone">' + icone('caixa') + '</span>' +
          '<strong>Nenhuma notificação</strong>' +
          '<p>Aqui aparecem novas missões, comentários, avisos e prazos que vencem hoje ou amanhã.</p>' +
        '</div>';
      return;
    }
    menu.innerHTML = cabecalhoMenuHtml(naoLidas) +
      '<ul class="menu-notificacoes__lista">' + lista.map(itemNotificacaoHtml).join('') + '</ul>' +
      '<div class="menu-notificacoes__rodape">' +
        (lista.length === 1 ? '1 notificação' : 'As ' + lista.length + ' notificações mais recentes') +
      '</div>';
  }

  function carregarNotificacoes() {
    var menu = menuNotificacoes();
    var seq = ++seqMenu;
    var minhaGeracao = geracao;
    menu.innerHTML = cabecalhoMenuHtml(0) +
      '<div class="menu-notificacoes__estado"><span class="carregando carregando--inline">Carregando…</span></div>';
    Api.listarNotificacoes({ limite: 30 }).then(function (lista) {
      if (seq !== seqMenu || minhaGeracao !== geracao || !menuNotificacoesAberto()) { return; }
      notificacoesDoMenu = lista || [];
      desenharNotificacoes(notificacoesDoMenu);
    }).catch(function (erro) {
      if (seq !== seqMenu || minhaGeracao !== geracao || !menuNotificacoesAberto()) { return; }
      menu.innerHTML = cabecalhoMenuHtml(0) +
        '<div class="menu-notificacoes__estado">' +
          '<div class="aviso aviso--urgente"><span class="aviso__icone">' + icone('alerta') + '</span>' +
            '<div>' + U.esc(U.erroTexto(erro)) + '</div></div>' +
          '<button type="button" class="botao botao--secundario botao--pequeno" data-acao="tentar">Tentar novamente</button>' +
        '</div>';
    });
  }

  function abrirMenuNotificacoes() {
    if (!militarAtual) { return; }
    fecharMenuMais(false);
    var menu = menuNotificacoes();
    menu.classList.remove('oculto');
    document.getElementById('botaoSino').setAttribute('aria-expanded', 'true');
    posicionarMenuNotificacoes();
    carregarNotificacoes();
  }

  function fecharMenuNotificacoes(devolverFoco) {
    var menu = menuNotificacoes();
    if (!menu || menu.classList.contains('oculto')) { return; }
    seqMenu += 1;
    menu.classList.add('oculto');
    menu.innerHTML = '';
    notificacoesDoMenu = [];
    var botao = document.getElementById('botaoSino');
    botao.setAttribute('aria-expanded', 'false');
    if (devolverFoco) { botao.focus(); }
  }

  /* Para onde leva uma notificação: aviso ⇒ Avisos; ocorrência/atividade ⇒
     o painel de detalhe, sobre a página em que o militar já está. */
  function destinoDaNotificacao(n) {
    if (n.tipo === 'aviso') { return '#/avisos'; }
    if (n.ocorrencia_id) { return '#/' + rotaAtual() + '?ocorrencia=' + encodeURIComponent(n.ocorrencia_id); }
    if (n.atividade_id) { return '#/' + rotaAtual() + '?atividade=' + encodeURIComponent(n.atividade_id); }
    return null;
  }

  function abrirNotificacao(n) {
    fecharMenuNotificacoes(false);
    if (!n.lida) {
      Api.marcarNotificacoesLidas([n.id]).then(function () {
        atualizarContadores();
      }).catch(function (erro) { console.warn(erro); });
    }
    var destino = destinoDaNotificacao(n);
    if (destino) {
      ir(destino);
    } else {
      U.torrada('O item desta notificação não existe mais (foi excluído).', 'atencao');
    }
  }

  function aoClicarNoMenuNotificacoes(evento) {
    var alvo = evento.target;
    var acao = alvo.closest('[data-acao]');
    if (acao) {
      var qual = acao.getAttribute('data-acao');
      if (qual === 'fechar') { fecharMenuNotificacoes(true); return; }
      if (qual === 'tentar') { carregarNotificacoes(); return; }
      if (qual === 'marcar-todas') {
        acao.disabled = true;
        Api.marcarNotificacoesLidas(null).then(function () {
          atualizarContadores();
          if (menuNotificacoesAberto()) { carregarNotificacoes(); }
        }).catch(function (erro) {
          acao.disabled = false;
          U.falha(erro);
        });
        return;
      }
    }
    var item = alvo.closest('.notificacao-item');
    if (!item) { return; }
    var id = item.getAttribute('data-id');
    var n = null;
    notificacoesDoMenu.forEach(function (x) { if (x.id === id) { n = x; } });
    if (n) { abrirNotificacao(n); }
  }

  /* ---------- menu "Mais" (celular) ---------- */

  function menuMaisAberto() {
    var menu = document.getElementById('menuMais');
    return !!menu && !menu.classList.contains('oculto');
  }

  function abrirMenuMais() {
    if (!militarAtual) { return; }
    fecharMenuNotificacoes(false);
    document.getElementById('menuMais').classList.remove('oculto');
    document.getElementById('menuMaisFundo').classList.remove('oculto');
    document.getElementById('botaoMais').setAttribute('aria-expanded', 'true');
    var primeiro = U.$('#menuMais .menu-mais__item');
    if (primeiro) {
      try { primeiro.focus({ preventScroll: true }); } catch (e) { primeiro.focus(); }
    }
  }

  function fecharMenuMais(devolverFoco) {
    if (!menuMaisAberto()) { return; }
    document.getElementById('menuMais').classList.add('oculto');
    document.getElementById('menuMaisFundo').classList.add('oculto');
    var botao = document.getElementById('botaoMais');
    botao.setAttribute('aria-expanded', 'false');
    if (devolverFoco) { botao.focus(); }
  }

  /* ---------- identidade (cabeçalho e menu Mais) ---------- */

  function montarIdentidade() {
    var m = militarAtual;
    if (!m) { return; }
    var id = identidade(m);
    var rotuloCompleto = id.nome + ' · ' + id.papel;
    var avatar = '<span class="' + id.classeAvatar + '" aria-hidden="true">' + U.esc(id.iniciais) + '</span>';

    var chip = document.getElementById('usuarioChip');
    if (chip) {
      chip.innerHTML = avatar +
        '<span class="usuario-chip__texto">' +
          '<span class="usuario-chip__nome">' + U.esc(id.nome) + '</span>' +
          '<span class="usuario-chip__papel">' + U.esc(id.papel) + '</span>' +
        '</span>';
      chip.title = rotuloCompleto + ' — Minha conta';
      chip.setAttribute('aria-label', 'Minha conta — ' + rotuloCompleto);
    }
    var noMenu = document.getElementById('menuMaisIdentidade');
    if (noMenu) {
      noMenu.innerHTML = avatar + '<div class="cresce"><strong>' + U.esc(id.nome) + '</strong><small>' +
        U.esc(id.papel) + '</small></div>';
    }

    /* Classes do papel no <body>: .so-gestor e afins podem esconder o que
       não se aplica (só aparência — quem barra de verdade é o banco). */
    var corpo = document.body.classList;
    corpo.toggle('e-gestor', Regras.eGestor(m));
    corpo.toggle('papel-administrador', m.papel === 'administrador');
    corpo.toggle('papel-chefia', m.papel === 'chefia');
    corpo.toggle('papel-adjunto', m.papel === 'adjunto');
  }

  function limparIdentidade() {
    ['usuarioChip', 'menuMaisIdentidade'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) { el.innerHTML = ''; el.removeAttribute('title'); el.removeAttribute('aria-label'); }
    });
    document.body.classList.remove('e-gestor', 'papel-administrador', 'papel-chefia', 'papel-adjunto');
  }

  function aplicarTextosFixos() {
    var nome = document.getElementById('cabecalhoNome');
    var subtitulo = document.getElementById('cabecalhoSubtitulo');
    if (typeof AQS_CONFIG !== 'undefined' && AQS_CONFIG) {
      if (nome && AQS_CONFIG.NOME_SISTEMA) { nome.textContent = AQS_CONFIG.NOME_SISTEMA; }
      if (subtitulo && AQS_CONFIG.SUBTITULO) { subtitulo.textContent = AQS_CONFIG.SUBTITULO; }
    }
    var modo = document.getElementById('rodapeModo');
    if (modo) {
      var demo = modoDemo();
      modo.textContent = demo
        ? 'Ambiente de demonstração — dados fictícios; nada é gravado em servidor.'
        : 'Ambiente oficial.';
      modo.classList.toggle('rodape__modo--demo', demo);
    }
  }

  /* Rodapé do papel: quem imprimiu e quando (preenchido na hora de imprimir). */
  function prepararImpressao() {
    var rodape = document.getElementById('rodapeImpressao');
    if (!rodape) { return; }
    if (!militarAtual) { rodape.textContent = ''; return; }
    rodape.textContent = 'Impresso em ' + U.formatarDataHora(new Date().toISOString()) + ' por ' +
      identidade(militarAtual).nome + ' · ' + TITULO_BASE + ' — documento de uso interno; ' +
      'informações protegidas pela LGPD.';
  }

  /* ---------- entrada e saída ---------- */

  function gerarOcorrenciasEmSegundoPlano() {
    var minhaGeracao = geracao;
    Api.gerarOcorrencias().then(function (inseridas) {
      if (!militarAtual || minhaGeracao !== geracao) { return; }
      if (typeof inseridas === 'number' && inseridas === 0) {
        /* Nada novo; os prazos de hoje/amanhã podem ter gerado notificações. */
        atualizarContadores();
        return;
      }
      recarregar(['ocorrencias', 'notificacoes']);
    }).catch(function (erro) {
      /* Não impede o uso: a rotina diária do banco também gera. */
      console.warn('Não foi possível gerar as ocorrências agora.', erro);
    });
  }

  function aoEntrar(militar) {
    geracao += 1;
    militarAtual = copiar(militar);
    renderizada = { nome: null, chave: null, parametros: {} };
    funcaoPainel = null;
    montarIdentidade();
    aplicarTextosFixos();
    document.getElementById('telaApp').classList.remove('oculto');
    if (!/^#\//.test(window.location.hash)) { substituirEndereco('#/' + ROTA_PADRAO); }
    try { TempoReal.iniciar(); } catch (erro) { console.error(erro); }
    navegar({ forcar: true });
    atualizarContadores();
    gerarOcorrenciasEmSegundoPlano();
  }

  /* Preferências de tela guardadas na aba (filtros, período, modo do
     quadro). Podem conter ids de militares e o que o último usuário estava
     olhando: saem junto com a sessão, para o próximo login começar limpo. */
  var PREFIXOS_PREFERENCIAS = ['aqs_quadro_estado', 'aqs_inicio_visao', 'aqs_atividades_filtros',
    'aqs_plano_filtros', 'aqs_relatorios_periodo'];

  function limparPreferenciasDaAba() {
    try {
      var s = window.sessionStorage;
      if (!s) { return; }
      var apagar = [];
      for (var i = 0; i < s.length; i += 1) {
        var chave = s.key(i);
        if (chave && PREFIXOS_PREFERENCIAS.some(function (p) { return chave.indexOf(p) === 0; })) { apagar.push(chave); }
      }
      apagar.forEach(function (chave) { s.removeItem(chave); });
    } catch (e) { /* armazenamento bloqueado: não há o que limpar */ }
  }

  function aoSair() {
    geracao += 1;
    militarAtual = null;
    limparPreferenciasDaAba();
    funcaoPainel = null;
    cancelarRecargaAdiada();
    renderizada = { nome: null, chave: null, parametros: {} };
    try { TempoReal.parar(); } catch (erro) { console.error(erro); }
    fecharMenuNotificacoes(false);
    fecharMenuMais(false);
    U.fecharPainel();
    U.$$('.pagina').forEach(function (secao) {
      secao.innerHTML = '';
      secao.classList.add('oculto');
      secao.style.minHeight = '';
    });
    limparIdentidade();
    mostrarContadorSino(0);
    mostrarContadorAvisos(0);
    marcarAbaAtiva('');
    try { Api.invalidarReferencias(); } catch (erro) { console.error(erro); }
    /* Torradas podem trazer títulos de notificações: também saem. */
    var flutuantes = document.getElementById('avisosFlutuantes');
    if (flutuantes) { flutuantes.innerHTML = ''; }
    var rodape = document.getElementById('rodapeImpressao');
    if (rodape) { rodape.textContent = ''; }
    document.body.classList.remove('sem-rolagem');
    document.getElementById('telaApp').classList.add('oculto');
    document.title = tituloDaAba('');
    /* Quem entrar depois (outro militar no mesmo computador) começa no
       Início — não na página nem no ?ocorrencia= de quem saiu. */
    if (window.location.hash) { substituirEndereco('#/' + ROTA_PADRAO); }
  }

  /* ---------- demonstração ---------- */

  function ligarFaixaDemo() {
    var botao = document.getElementById('botaoReiniciarDemo');
    if (!botao) { return; }
    var podeReiniciar = modoDemo() && window.ApiDemo && typeof window.ApiDemo.reiniciar === 'function';
    if (!podeReiniciar) { botao.classList.add('oculto'); return; }
    botao.addEventListener('click', function () {
      if (!U.confirmar('Reiniciar a demonstração?\n\nTudo o que foi feito nesta demonstração será descartado e ' +
        'os dados fictícios voltarão ao estado inicial.')) { return; }
      botao.disabled = true;
      Promise.resolve(window.ApiDemo.reiniciar()).catch(function (erro) {
        console.error(erro);
      }).then(function () {
        window.location.replace(window.location.pathname + window.location.search);
      });
    });
  }

  /* ---------- inicialização ---------- */

  function ligarEventos() {
    window.addEventListener('hashchange', function () { navegar(); });

    /* Clicar no link da página em que já se está não dispara 'hashchange':
       remonta a página (o "atualizar" natural de quem clica na aba). */
    document.addEventListener('click', function (evento) {
      if (evento.defaultPrevented || evento.button !== 0 || evento.ctrlKey || evento.metaKey ||
          evento.shiftKey || evento.altKey) { return; }
      var link = evento.target.closest ? evento.target.closest('a[href^="#/"]') : null;
      if (!link) { return; }
      if (link.closest('#menuMais')) { fecharMenuMais(false); }
      var href = link.getAttribute('href');
      if (href === window.location.hash) {
        evento.preventDefault();
        navegar({ forcar: !temParametroDePainel(href) });
      }
    });

    /* Clique fora fecha os menus suspensos. */
    document.addEventListener('click', function (evento) {
      var alvo = evento.target;
      if (!alvo || !alvo.closest) { return; }
      if (menuNotificacoesAberto() && !alvo.closest('.sino-envoltorio')) { fecharMenuNotificacoes(false); }
      if (menuMaisAberto() && !alvo.closest('#menuMais') && !alvo.closest('#botaoMais')) { fecharMenuMais(false); }
    }, true);

    document.addEventListener('keydown', function (evento) {
      if (evento.key !== 'Escape') { return; }
      if (menuNotificacoesAberto()) { fecharMenuNotificacoes(true); }
      if (menuMaisAberto()) { fecharMenuMais(true); }
    });

    window.addEventListener('resize', U.adiar(function () {
      if (menuNotificacoesAberto()) { posicionarMenuNotificacoes(); }
      if (!celular()) { fecharMenuMais(false); }
    }, 120));

    document.getElementById('botaoSino').addEventListener('click', function () {
      if (menuNotificacoesAberto()) { fecharMenuNotificacoes(false); } else { abrirMenuNotificacoes(); }
    });
    menuNotificacoes().addEventListener('click', aoClicarNoMenuNotificacoes);

    document.getElementById('botaoMais').addEventListener('click', function () {
      if (menuMaisAberto()) { fecharMenuMais(false); } else { abrirMenuMais(); }
    });
    document.getElementById('menuMaisFundo').addEventListener('click', function () { fecharMenuMais(false); });

    document.getElementById('botaoTema').addEventListener('click', alternarTema);
    document.getElementById('botaoSair').addEventListener('click', function () { Sessao.sair('usuario'); });
    document.getElementById('botaoSairMais').addEventListener('click', function () {
      fecharMenuMais(false);
      Sessao.sair('usuario');
    });

    /* "Tentar novamente" das mensagens de falha ao montar uma página. */
    document.getElementById('conteudo').addEventListener('click', function (evento) {
      var botao = evento.target.closest ? evento.target.closest('[data-acao="recarregar-pagina"]') : null;
      if (botao) { navegar({ forcar: true }); }
    });

    window.addEventListener('beforeprint', prepararImpressao);
  }

  /* Tema já na carga do script, antes de qualquer tela aparecer. */
  aplicarTema(lerPreferenciaTema());

  function iniciar() {
    seguirTemaDoAmbiente();
    aplicarTextosFixos();
    observarPainel();
    ligarEventos();
    ligarFaixaDemo();
    document.title = tituloDaAba('');
    Sessao.iniciar(aoEntrar, aoSair);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }

  return {
    navegar: function () { navegar(); },
    ir: ir,
    recarregar: recarregar,
    aoAtualizarPainel: aoAtualizarPainel,
    atualizarContadores: atualizarContadores,
    militar: function () { return militarAtual ? copiar(militarAtual) : null; },
    /* "Chefia" no sentido do contrato: quem pode administrar (gestor =
       chefia ou administrador, ativo). */
    eChefia: function () { return Regras.eGestor(militarAtual); },
    eGestor: function () { return Regras.eGestor(militarAtual); },
    eAdministrador: function () { return !!militarAtual && Regras.eAdministrador(militarAtual); },
    /* Tema: 'automatico' | 'claro' | 'escuro' (usado por Minha conta). */
    preferenciaTema: lerPreferenciaTema,
    definirTema: definirTema
  };
})();
