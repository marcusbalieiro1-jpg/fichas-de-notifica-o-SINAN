/* =========================================================================
   HABE SINAN — página de consulta (urgência e ambulatórios)
   -------------------------------------------------------------------------
   Aplicação enxuta, com duas telas: o sumário alfabético das fichas e a
   orientação de como notificar. Não depende da camada de armazenamento nem
   do gerador de QR Code — de propósito: quanto menos esta página souber
   fazer, menos ela pode expor.

   A preferência de tema é a única coisa que ela grava, e num único campo.
   ========================================================================= */

var Paginas = Paginas || {};

/* ---------------------------------------------------------------------
   Tela: como notificar
   --------------------------------------------------------------------- */
Paginas.notificar = (function () {
  'use strict';

  function cartaoPrazo(chave) {
    var meta = HABE_CATALOGO.classificacoes[chave];
    var borda = meta.cor === 'urgente' ? 'var(--urgente)'
              : meta.cor === 'atencao' ? 'var(--atencao)' : 'var(--azul)';
    var simbolo = chave === 'imediata' ? '⏱' : chave === 'condicional' ? '⚠' : '📅';

    return '<div class="cartao" style="margin:0;border-left:5px solid ' + borda + '">' +
      '<div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.5rem">' +
        '<span class="ponto ponto--' + meta.cor + '"></span>' +
        '<strong>' + simbolo + ' ' + U.esc(meta.rotulo) + '</strong>' +
      '</div>' +
      '<p style="margin:0 0 .5rem"><span class="selo selo--' + meta.cor + '">' +
        U.esc(meta.prazo) + '</span></p>' +
      '<p style="margin:0;font-size:.88rem;color:var(--texto-suave)">' +
        U.esc(meta.descricao) + '</p>' +
    '</div>';
  }

  function render(elemento) {
    var u = U.unidade();
    var contato = U.comoChamarNucleo();

    elemento.innerHTML = '' +
      '<div class="pagina__cabecalho">' +
        '<h1 id="t-notificar">Como notificar</h1>' +
        '<p>O que fazer, na ordem, quando o caso for de notificação compulsória.</p>' +
      '</div>' +

      '<div class="aviso aviso--urgente">' +
        '<span class="aviso__icone">☎</span>' +
        '<div>' +
          '<strong>Agravo em vermelho: ligue para o ' + U.esc(u.setor || 'Núcleo') + ' agora</strong>' +
          (contato ? 'Contato: <strong>' + U.esc(contato) + '</strong>. ' : '') +
          'A contagem das 24 horas começa na <em>suspeita</em> — não espere resultado de ' +
          'exame, e não conte com a ficha em papel para dar o aviso.' +
        '</div>' +
      '</div>' +

      '<div class="cartao">' +
        '<h2 style="font-size:1.05rem">Os cinco passos</h2>' +
        '<ol style="padding-left:1.2rem;line-height:1.9;margin:0">' +
          '<li><strong>Identifique o agravo</strong> em <a href="#/fichas">Fichas A–Z</a>. ' +
              'Pode buscar pelo nome popular — <em>catapora</em>, <em>calazar</em> — ou pelo CID.</li>' +
          '<li><strong>Confira a cor.</strong> Vermelho é 24 horas; laranja é semanal, mas vira ' +
              '24 horas nas situações descritas na própria ficha; azul é semanal.</li>' +
          '<li><strong>Se for vermelho, ligue.</strong> Antes de qualquer papel.</li>' +
          '<li><strong>Baixe e preencha</strong> a ficha, com letra legível e sem abreviar o ' +
              'nome do paciente.</li>' +
          '<li><strong>Assine e encaminhe</strong> ao ' + U.esc(u.setor || 'Núcleo de Epidemiologia') +
              '. É o Núcleo que lança no Sinan e responde pelos prazos junto à vigilância.</li>' +
        '</ol>' +
      '</div>' +

      '<div class="cartao">' +
        '<h2 style="font-size:1.05rem">Como identificar o prazo</h2>' +
        '<div class="grade grade--3" style="margin-top:.8rem">' +
          cartaoPrazo('imediata') + cartaoPrazo('condicional') + cartaoPrazo('semanal') +
        '</div>' +
      '</div>' +

      '<div class="cartao">' +
        '<h2 style="font-size:1.05rem">' + U.esc(u.setor || 'Núcleo de Epidemiologia') + '</h2>' +
        (contato || u.horario
          ? '<dl class="dados-lista">' +
              (u.ramal ? '<div><dt>Ramal</dt><dd>' + U.esc(u.ramal) + '</dd></div>' : '') +
              (u.plantao ? '<div><dt>Plantão</dt><dd>' + U.esc(u.plantao) + '</dd></div>' : '') +
              (u.email ? '<div><dt>E-mail</dt><dd>' + U.esc(u.email) + '</dd></div>' : '') +
              (u.horario ? '<div><dt>Horário</dt><dd>' + U.esc(u.horario) + '</dd></div>' : '') +
            '</dl>'
          : '') +
        /* O horário sozinho não serve: sem telefone, a página manda ligar sem
           dizer para onde. O aviso depende do contato, não do horário. */
        (contato ? ''
          : '<div class="aviso aviso--atencao" style="margin:0"><span class="aviso__icone">✎</span>' +
            '<div><strong>Contato ainda não cadastrado</strong>' +
            'O ramal e o telefone de plantão do Núcleo precisam ser preenchidos em ' +
            '<code>assets/js/dados-fichas.js</code>, no bloco <code>unidade</code>, ' +
            'antes de distribuir esta página aos consultórios.</div></div>') +
      '</div>' +

      '<div class="cartao" style="background:var(--fundo)">' +
        '<h2 style="font-size:1rem">Três lembretes</h2>' +
        '<ul style="padding-left:1.2rem;line-height:1.8;margin:0;font-size:.93rem">' +
          '<li>Notifica-se a <strong>suspeita</strong>, não a confirmação.</li>' +
          '<li>Na dúvida sobre qual ficha usar, escolha a <strong>notificação individual</strong> ' +
              '(a ficha genérica do Sinan) e avise o Núcleo — melhor notificar a mais.</li>' +
          '<li>Notificação compulsória independe de autorização do paciente ou de boletim de ' +
              'ocorrência.</li>' +
        '</ul>' +
      '</div>';
  }

  return { render: render };
})();

/* ---------------------------------------------------------------------
   Aplicação
   --------------------------------------------------------------------- */
var App = (function () {
  'use strict';

  var ROTA_PADRAO = 'fichas';
  var CHAVE_TEMA = 'habe_sinan_tema';

  /* ---------- tema ---------- */

  function temaGuardado() {
    try { return window.localStorage.getItem(CHAVE_TEMA) || ''; } catch (e) { return ''; }
  }

  function temaEfetivo() {
    var escolhido = temaGuardado();
    if (escolhido === 'claro' || escolhido === 'escuro') { return escolhido; }
    var doVisualizador = document.documentElement.getAttribute('data-theme');
    if (doVisualizador === 'dark') { return 'escuro'; }
    if (doVisualizador === 'light') { return 'claro'; }
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
      ? 'escuro' : 'claro';
  }

  function aplicarTema() {
    var tema = temaEfetivo();
    document.documentElement.setAttribute('data-tema', tema);
    var botao = U.$('#botaoTema');
    if (botao) { botao.classList.toggle('botao-icone--ativo', tema === 'escuro'); }
  }

  function alternarTema() {
    var novo = document.documentElement.getAttribute('data-tema') === 'escuro' ? 'claro' : 'escuro';
    try { window.localStorage.setItem(CHAVE_TEMA, novo); } catch (e) { /* modo privado */ }
    aplicarTema();
  }

  function seguirTemaDoAmbiente() {
    function reaplicar() {
      var escolhido = temaGuardado();
      if (escolhido !== 'claro' && escolhido !== 'escuro') { aplicarTema(); }
    }
    if (window.matchMedia) {
      var consulta = window.matchMedia('(prefers-color-scheme: dark)');
      if (consulta.addEventListener) { consulta.addEventListener('change', reaplicar); }
    }
    if (window.MutationObserver) {
      new window.MutationObserver(reaplicar).observe(document.documentElement,
        { attributes: true, attributeFilter: ['data-theme'] });
    }
  }

  /* ---------- navegação ---------- */

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

  function navegar() {
    var rota = lerRota();
    U.fecharPainel();

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
      Paginas[rota.nome].render(elemento, rota.parametros);
    } catch (erro) {
      console.error(erro);
      elemento.innerHTML = '<div class="aviso aviso--urgente"><span class="aviso__icone">⚠</span>' +
        '<div><strong>Falha ao montar a página</strong>' + U.esc(erro.message) + '</div></div>';
    }

    window.scrollTo({ top: 0 });
  }

  /* ---------- rodapé ---------- */

  function aplicarIdentidade() {
    var u = U.unidade();

    var titulo = U.$('#rodapeUnidade');
    if (titulo) {
      titulo.textContent = (u.nome || '') + (u.setor ? ' · ' + u.setor : '');
    }

    var revisao = U.$('#rodapeRevisao');
    if (revisao) {
      revisao.innerHTML =
        HABE_CATALOGO.fichas.length + ' agravos catalogados · catálogo versão ' +
        U.esc(HABE_CATALOGO.revisao.versao) + ', de ' +
        U.formatarData(HABE_CATALOGO.revisao.atualizadoEm) +
        '<br><span style="font-size:.78rem">' + U.esc(HABE_CATALOGO.revisao.baseNormativa) + '</span>';
    }

    var contato = U.$('#rodapeContato');
    if (contato) {
      var comoChamar = U.comoChamarNucleo();
      contato.innerHTML = comoChamar
        ? 'Notificação imediata deve ser comunicada por telefone: <strong>' +
          U.esc(comoChamar) + '</strong>.'
        : 'Notificação imediata deve ser comunicada por telefone ao ' +
          U.esc(u.setor || 'Núcleo de Epidemiologia') + ', além do registro da ficha.';
    }
  }

  /* ---------- inicialização ---------- */

  function iniciar() {
    aplicarTema();
    seguirTemaDoAmbiente();
    aplicarIdentidade();

    U.$('#botaoTema').addEventListener('click', alternarTema);
    U.$('#botaoImprimir').addEventListener('click', function () { window.print(); });

    window.addEventListener('hashchange', navegar);
    document.addEventListener('click', function (evento) {
      var link = evento.target.closest('a[href^="#/"]');
      if (link && link.getAttribute('href') === window.location.hash) {
        evento.preventDefault();
        navegar();
      }
    });

    if (!window.location.hash) { window.location.hash = '#/' + ROTA_PADRAO; }
    navegar();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }

  return { navegar: navegar, aplicarIdentidade: aplicarIdentidade };
})();
