/* =========================================================================
   HABE SINAN — sumário alfabético das fichas
   ========================================================================= */

var Paginas = Paginas || {};

Paginas.fichas = (function () {
  'use strict';

  var estado = { termo: '', filtro: 'todas' };

  /* ---------- busca ---------- */

  function textoIndexado(ficha) {
    return U.normalizar([
      ficha.nome,
      ficha.grupo,
      ficha.cid10,
      (ficha.sinonimos || []).join(' '),
      ficha.observacao
    ].join(' '));
  }

  function filtrar(termo, filtro) {
    var alvo = U.normalizar(termo || '');
    return HABE_CATALOGO.fichas.filter(function (ficha) {
      if (filtro && filtro !== 'todas') {
        if (filtro === 'imediata' && ficha.classificacao !== 'imediata') { return false; }
        if (filtro === 'condicional' && ficha.classificacao !== 'condicional') { return false; }
        if (filtro === 'semanal' && ficha.classificacao !== 'semanal') { return false; }
        if (filtro.indexOf('grupo:') === 0 && ficha.grupo !== filtro.slice(6)) { return false; }
      }
      if (!alvo) { return true; }
      return textoIndexado(ficha).indexOf(alvo) >= 0;
    }).sort(U.ordenarPorNome);
  }

  /* ---------- fragmentos de HTML ---------- */

  function itemHtml(ficha) {
    var cor = U.corDaClassificacao(ficha.classificacao);
    var classeItem = cor === 'urgente' ? ' ficha-item--urgente'
                   : cor === 'atencao' ? ' ficha-item--atencao' : '';

    return '' +
      '<button type="button" class="ficha-item' + classeItem + '" data-ficha="' + U.esc(ficha.id) + '">' +
        '<span class="ponto ponto--' + cor + '"></span>' +
        '<span class="ficha-item__corpo">' +
          '<span class="ficha-item__nome">' + U.esc(ficha.nome) + '</span>' +
          '<span class="ficha-item__meta">' +
            U.esc(ficha.grupo) + ' · CID-10 ' + U.esc(ficha.cid10) + ' · ' +
            U.esc(U.prazoDaClassificacao(ficha.classificacao)) +
          '</span>' +
        '</span>' +
        U.seloClassificacao(ficha) +
        '<span class="ficha-item__seta" aria-hidden="true">›</span>' +
      '</button>';
  }

  function grupos() {
    var nomes = {};
    HABE_CATALOGO.fichas.forEach(function (f) { nomes[f.grupo] = true; });
    return Object.keys(nomes).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
  }

  /* ---------- detalhe ---------- */

  function abrirDetalhe(id) {
    var ficha = HABE_CATALOGO.porId[id];
    if (!ficha) { return; }

    var cor = U.corDaClassificacao(ficha.classificacao);
    var meta = HABE_CATALOGO.classificacoes[ficha.classificacao];

    var corpo = '' +
      '<div class="aviso aviso--' + (cor === 'padrao' ? '' : cor) + '">' +
        '<span class="aviso__icone">' +
          (ficha.classificacao === 'imediata' ? '⏱' : ficha.classificacao === 'condicional' ? '⚠' : '📅') +
        '</span>' +
        '<div>' +
          '<strong>' + U.esc(meta.rotulo) + ' — ' + U.esc(meta.prazo) + '</strong>' +
          U.esc(meta.descricao) +
        '</div>' +
      '</div>' +

      (ficha.gatilhoImediato
        ? '<div class="aviso aviso--urgente">' +
            '<span class="aviso__icone">⏱</span>' +
            '<div><strong>Quando o prazo vira 24 horas</strong>' + U.esc(ficha.gatilhoImediato) + '</div>' +
          '</div>'
        : '') +

      '<dl class="dados-lista" style="margin:0 0 1rem">' +
        '<div><dt>Grupo</dt><dd>' + U.esc(ficha.grupo) + '</dd></div>' +
        '<div><dt>CID-10</dt><dd>' + U.esc(ficha.cid10) + '</dd></div>' +
      '</dl>' +

      (ficha.observacao
        ? '<div class="cartao" style="background:var(--fundo)">' +
            '<h3 style="font-size:.95rem">Orientação operacional</h3>' +
            '<p style="margin:0">' + U.esc(ficha.observacao) + '</p>' +
          '</div>'
        : '') +

      '<div style="display:grid;gap:.5rem;margin-top:1rem">' +
        '<button class="botao botao--grande" id="botaoBaixarFicha">⬇ Baixar a ficha</button>' +
        (U.perfilNucleo()
          ? '<button class="botao botao--secundario" id="botaoRegistrarDaFicha">' +
              '📋 Registrar uma notificação com esta ficha</button>'
          : '') +
        (ficha.urlOficial
          ? '<a class="botao botao--secundario" href="' + U.esc(ficha.urlOficial) + '" ' +
              'target="_blank" rel="noopener">🔗 Abrir no portal do Ministério da Saúde</a>'
          : '<a class="botao botao--secundario" href="' + U.esc(HABE_CATALOGO.revisao.portalSinan) + '" ' +
              'target="_blank" rel="noopener">🔗 Procurar no portal do Sinan</a>') +
      '</div>' +

      (U.perfilNucleo() ? '' : U.blocoContato(ficha.classificacao === 'imediata')) +

      '<p style="font-size:.8rem;color:var(--texto-suave);margin-top:1rem">' +
        'Arquivo no acervo local: <code>' + U.esc(ficha.arquivo) + '</code>' +
        (ficha.urlVerificada ? '' :
          '<br>Link oficial ainda não conferido — o sistema entrega o arquivo do acervo local ' +
          'e, na falta dele, direciona para o portal do Sinan.') +
      '</p>';

    U.abrirPainel(U.esc(ficha.nome), corpo, function () {
      U.$('#botaoBaixarFicha').addEventListener('click', function () {
        U.entregarFicha(ficha, null).then(function (desfecho) {
          if (desfecho.origem === 'local') {
            U.torrada('Ficha baixada: ' + desfecho.nome, 'sucesso');
          } else if (desfecho.origem === 'local-sem-verificacao') {
            U.torrada('Download solicitado: ' + desfecho.nome +
                      '. Se nada baixar, a ficha ainda não está no acervo.');
          } else {
            U.torrada('Ficha ainda não incluída no acervo local — abrindo a versão oficial.', 'atencao');
          }
        });
      });

      var registrar = U.$('#botaoRegistrarDaFicha');
      if (registrar) {
        registrar.addEventListener('click', function () {
          U.fecharPainel();
          window.location.hash = '#/registrar?ficha=' + encodeURIComponent(ficha.id);
        });
      }
    });
  }

  /* ---------- página ---------- */

  function desenharLista(elemento) {
    var achadas = filtrar(estado.termo, estado.filtro);
    var saida = U.$('#listaSumario', elemento);
    var navegacaoLetras = U.$('#alfabeto', elemento);

    /* Barra de letras */
    var letrasPresentes = {};
    achadas.forEach(function (f) { letrasPresentes[U.inicial(f.nome)] = true; });
    var alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    navegacaoLetras.innerHTML = alfabeto.map(function (letra) {
      var ativa = !!letrasPresentes[letra];
      return '<button type="button" data-letra="' + letra + '"' + (ativa ? '' : ' disabled') +
             ' title="Ir para a letra ' + letra + '">' + letra + '</button>';
    }).join('');

    if (achadas.length === 0) {
      saida.innerHTML = '<div class="tabela__vazia">' +
        'Nenhuma ficha corresponde à busca. Tente outro termo ou limpe os filtros.<br>' +
        'Se o agravo não estiver no acervo, use a <strong>ficha de notificação individual</strong> ' +
        'e avise o Núcleo de Epidemiologia.</div>';
      U.$('#resumoSumario', elemento).textContent = '0 fichas';
      return;
    }

    var porLetra = {};
    achadas.forEach(function (ficha) {
      var letra = U.inicial(ficha.nome);
      (porLetra[letra] = porLetra[letra] || []).push(ficha);
    });

    saida.innerHTML = Object.keys(porLetra).sort().map(function (letra) {
      var itens = porLetra[letra];
      var imediatas = itens.filter(function (f) { return f.classificacao === 'imediata'; }).length;
      return '' +
        '<div class="grupo-letra" id="letra-' + letra + '">' +
          '<span>' + letra + '</span>' +
          '<small>' + itens.length + (itens.length === 1 ? ' ficha' : ' fichas') +
            (imediatas ? ' · <strong style="color:var(--urgente)">' + imediatas +
                         ' de notificação imediata</strong>' : '') +
          '</small>' +
        '</div>' +
        '<div class="lista-fichas">' + itens.map(itemHtml).join('') + '</div>';
    }).join('');

    var totalImediatas = achadas.filter(function (f) { return f.classificacao === 'imediata'; }).length;
    U.$('#resumoSumario', elemento).innerHTML =
      achadas.length + ' fichas · <strong style="color:var(--urgente)">' +
      totalImediatas + ' de notificação imediata</strong>';
  }

  function render(elemento, parametros) {
    estado.termo = '';
    estado.filtro = 'todas';

    var opcoesGrupo = grupos().map(function (g) {
      return '<option value="grupo:' + U.esc(g) + '">' + U.esc(g) + '</option>';
    }).join('');

    elemento.innerHTML = '' +
      '<div class="pagina__cabecalho">' +
        '<h1 id="t-fichas">Sumário de fichas — ordem alfabética</h1>' +
        '<p>As fichas de <strong>notificação imediata</strong> aparecem destacadas em vermelho, ' +
           'com o selo ⏱ e barra lateral. As de prazo semanal seguem em azul.</p>' +
      '</div>' +

      '<div class="cartao nao-imprimir">' +
        '<div class="busca-fichas">' +
          '<label class="so-leitor-tela" for="buscaSumario">Buscar ficha</label>' +
          '<input type="search" id="buscaSumario" ' +
                 'placeholder="Buscar por doença, sinônimo popular ou CID — ex.: catapora, calazar, A90">' +
        '</div>' +
        '<div class="filtros">' +
          '<button class="filtro filtro--ativo" data-filtro="todas">Todas</button>' +
          '<button class="filtro" data-filtro="imediata">⏱ Imediatas (24 h)</button>' +
          '<button class="filtro" data-filtro="condicional">⚠ Com gatilho imediato</button>' +
          '<button class="filtro" data-filtro="semanal">📅 Semanais (7 dias)</button>' +
          '<select id="filtroGrupo" style="width:auto;padding:.38rem .6rem;font-size:.84rem">' +
            '<option value="">Todos os grupos</option>' + opcoesGrupo +
          '</select>' +
        '</div>' +
        '<div class="alfabeto" id="alfabeto"></div>' +
        '<p style="margin:0;font-size:.87rem;color:var(--texto-suave)" id="resumoSumario"></p>' +
      '</div>' +

      '<div id="listaSumario"></div>';

    var campoBusca = U.$('#buscaSumario', elemento);
    campoBusca.addEventListener('input', function () {
      estado.termo = campoBusca.value;
      desenharLista(elemento);
    });

    U.$$('.filtro[data-filtro]', elemento).forEach(function (botao) {
      botao.addEventListener('click', function () {
        U.$$('.filtro[data-filtro]', elemento).forEach(function (b) {
          b.classList.remove('filtro--ativo', 'filtro--urgente', 'filtro--atencao');
        });
        var valor = botao.getAttribute('data-filtro');
        botao.classList.add('filtro--ativo');
        if (valor === 'imediata') { botao.classList.add('filtro--urgente'); }
        if (valor === 'condicional') { botao.classList.add('filtro--atencao'); }
        U.$('#filtroGrupo', elemento).value = '';
        estado.filtro = valor;
        desenharLista(elemento);
      });
    });

    U.$('#filtroGrupo', elemento).addEventListener('change', function () {
      estado.filtro = this.value || 'todas';
      U.$$('.filtro[data-filtro]', elemento).forEach(function (b) {
        b.classList.remove('filtro--ativo', 'filtro--urgente', 'filtro--atencao');
      });
      if (!this.value) { U.$('.filtro[data-filtro="todas"]', elemento).classList.add('filtro--ativo'); }
      desenharLista(elemento);
    });

    elemento.addEventListener('click', function (evento) {
      var letra = evento.target.closest('[data-letra]');
      if (letra && !letra.disabled) {
        var destino = U.$('#letra-' + letra.getAttribute('data-letra'), elemento);
        if (destino) { destino.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
        return;
      }
      var item = evento.target.closest('[data-ficha]');
      if (item) { abrirDetalhe(item.getAttribute('data-ficha')); }
    });

    desenharLista(elemento);

    /* Abertura direta via #/fichas?ficha=id */
    if (parametros && parametros.ficha) { abrirDetalhe(parametros.ficha); }
  }

  return {
    render: render,
    filtrar: filtrar,
    itemHtml: itemHtml,
    abrirDetalhe: abrirDetalhe
  };
})();
