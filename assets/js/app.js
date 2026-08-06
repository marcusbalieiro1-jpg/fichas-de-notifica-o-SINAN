/* =========================================================================
   HABE SINAN — inicialização, navegação entre páginas e trava do Núcleo
   ========================================================================= */

var App = (function () {
  'use strict';

  var ROTA_PADRAO = 'inicio';
  var ROTAS_RESTRITAS = ['solicitacoes', 'relatorios', 'medicos', 'config'];
  var CHAVE_DESTRAVA = 'habe_sinan_nucleo_liberado';

  /* ---------- endereço ---------- */

  function lerRota() {
    var bruto = window.location.hash.replace(/^#\/?/, '');
    var partes = bruto.split('?');
    var nome = partes[0] || ROTA_PADRAO;
    var parametros = {};

    if (partes[1]) {
      partes[1].split('&').forEach(function (par) {
        var kv = par.split('=');
        parametros[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
      });
    }
    if (!Paginas[nome]) { nome = ROTA_PADRAO; }
    return { nome: nome, parametros: parametros };
  }

  /* ---------- trava por PIN ---------- */

  function precisaDestravar(rota) {
    var config = Armazenamento.obterConfig();
    if (!config.pinNucleo) { return false; }
    if (ROTAS_RESTRITAS.indexOf(rota) < 0) { return false; }
    return window.sessionStorage.getItem(CHAVE_DESTRAVA) !== '1';
  }

  function telaDestrava(elemento, rota, parametros) {
    elemento.innerHTML = '' +
      '<div class="cartao" style="max-width:440px;margin:2.5rem auto;text-align:center">' +
        '<img class="brasao--destrava" src="assets/img/logo-habe.svg" alt="">' +
        '<h1 style="font-size:1.25rem;margin-top:.6rem">Área do Núcleo de Epidemiologia</h1>' +
        '<p style="color:var(--texto-suave);font-size:.9rem">' +
          'Informe o PIN para consultar solicitações, relatórios e cadastros.</p>' +
        '<div class="campo" style="text-align:left">' +
          '<label for="campoPin">PIN de acesso</label>' +
          '<input type="password" id="campoPin" inputmode="numeric" autocomplete="off" autofocus>' +
          '<div class="campo__erro">PIN incorreto.</div>' +
        '</div>' +
        '<button class="botao botao--bloco botao--grande" id="botaoDestravar" type="button">' +
          'Entrar</button>' +
        '<p style="margin:.9rem 0 0"><a href="#/fichas">← Voltar ao sumário de fichas</a></p>' +
      '</div>';

    function tentar() {
      var campo = U.$('#campoPin', elemento);
      if (campo.value === Armazenamento.obterConfig().pinNucleo) {
        window.sessionStorage.setItem(CHAVE_DESTRAVA, '1');
        Paginas[rota].render(elemento, parametros);
        atualizarContadores();
      } else {
        campo.closest('.campo').classList.add('campo--invalido');
        campo.select();
      }
    }

    U.$('#botaoDestravar', elemento).addEventListener('click', tentar);
    U.$('#campoPin', elemento).addEventListener('keydown', function (evento) {
      if (evento.key === 'Enter') { tentar(); }
    });
  }

  /* ---------- navegação ---------- */

  function navegar() {
    var rota = lerRota();
    U.fecharPainel();

    /* Esvazia as páginas inativas: além de liberar memória, evita que dois
       formulários ocultos disputem o mesmo id de campo. */
    U.$$('.pagina').forEach(function (secao) {
      secao.classList.add('oculto');
      if (secao.id !== 'pagina-' + rota.nome) { secao.innerHTML = ''; }
    });
    U.$$('.navegacao a').forEach(function (link) {
      link.classList.toggle('ativo', link.getAttribute('data-rota') === rota.nome);
    });

    var elemento = U.$('#pagina-' + rota.nome);
    if (!elemento) { window.location.hash = '#/' + ROTA_PADRAO; return; }
    elemento.classList.remove('oculto');

    try {
      if (precisaDestravar(rota.nome)) {
        telaDestrava(elemento, rota.nome, rota.parametros);
      } else {
        Paginas[rota.nome].render(elemento, rota.parametros);
      }
    } catch (erro) {
      console.error(erro);
      elemento.innerHTML = '<div class="aviso aviso--urgente"><span class="aviso__icone">⚠</span>' +
        '<div><strong>Falha ao montar a página</strong>' + U.esc(erro.message) + '</div></div>';
    }

    window.scrollTo({ top: 0 });
  }

  /* ---------- tema ---------- */

  function aplicarTema(tema) {
    document.documentElement.setAttribute('data-tema', tema);
    var botao = U.$('#botaoTema');
    if (botao) { botao.classList.toggle('botao-icone--ativo', tema === 'escuro'); }
  }

  function alternarTema() {
    var config = Armazenamento.obterConfig();
    var novo = config.tema === 'escuro' ? 'claro' : 'escuro';
    Armazenamento.salvarConfig({ tema: novo });
    aplicarTema(novo);
  }

  /* ---------- identidade e contadores ---------- */

  function aplicarIdentidade() {
    var config = Armazenamento.obterConfig();
    var rodape = U.$('#rodapeUnidade');
    if (rodape) { rodape.textContent = config.unidade + ' · ' + config.setor; }

    var revisao = U.$('#rodapeRevisao');
    if (revisao) {
      revisao.innerHTML =
        'Catálogo versão ' + U.esc(HABE_CATALOGO.revisao.versao) +
        ', atualizado em ' + U.formatarData(HABE_CATALOGO.revisao.atualizadoEm) + ' · ' +
        HABE_CATALOGO.fichas.length + ' fichas · ' +
        (Armazenamento.modoCompartilhado()
          ? 'modo compartilhado'
          : 'modo local (dados apenas neste computador)') +
        '<br><span style="font-size:.78rem">' + U.esc(HABE_CATALOGO.revisao.baseNormativa) + '</span>';
    }
  }

  function atualizarContadores() {
    var selo = U.$('#contadorPendentes');
    if (!selo) { return; }
    Armazenamento.listarSolicitacoes().then(function (lista) {
      var pendentes = (lista || []).filter(function (s) {
        return (s.anexos || []).length === 0 && (s.status || 'aguardando') !== 'encerrada';
      }).length;
      selo.textContent = pendentes;
      selo.classList.toggle('oculto', pendentes === 0);
    }).catch(function () {
      selo.classList.add('oculto');
    });
  }

  /* ---------- inicialização ---------- */

  function iniciar() {
    aplicarTema(Armazenamento.obterConfig().tema);
    aplicarIdentidade();

    U.$('#botaoTema').addEventListener('click', alternarTema);
    U.$('#botaoImprimir').addEventListener('click', function () { window.print(); });

    window.addEventListener('hashchange', navegar);

    /* Clicar num link para a rota em que já se está não dispara 'hashchange'.
       Sem isto, o médico que acabou de registrar uma solicitação clicaria em
       "Solicitar ficha" e continuaria vendo o comprovante anterior. */
    document.addEventListener('click', function (evento) {
      var link = evento.target.closest('a[href^="#/"]');
      if (!link) { return; }
      if (link.getAttribute('href') === window.location.hash) {
        evento.preventDefault();
        navegar();
      }
    });

    if (!window.location.hash) { window.location.hash = '#/' + ROTA_PADRAO; }
    navegar();
    atualizarContadores();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }

  return {
    navegar: navegar,
    aplicarIdentidade: aplicarIdentidade,
    atualizarContadores: atualizarContadores
  };
})();
