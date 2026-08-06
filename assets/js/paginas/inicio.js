/* =========================================================================
   HABE SINAN — página inicial
   ========================================================================= */

var Paginas = Paginas || {};

Paginas.inicio = (function () {
  'use strict';

  function contarPorClassificacao(classificacao) {
    return HABE_CATALOGO.fichas.filter(function (f) {
      return f.classificacao === classificacao;
    }).length;
  }

  function legenda() {
    var itens = ['imediata', 'condicional', 'semanal'].map(function (chave) {
      var meta = HABE_CATALOGO.classificacoes[chave];
      return '' +
        '<div class="cartao" style="margin:0;border-left:5px solid var(--' +
          (meta.cor === 'urgente' ? 'urgente' : meta.cor === 'atencao' ? 'atencao' : 'azul') + ')">' +
          '<div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.4rem">' +
            '<span class="ponto ponto--' + meta.cor + '"></span>' +
            '<strong>' + U.esc(meta.rotulo) + '</strong>' +
          '</div>' +
          '<p style="margin:0 0 .4rem"><span class="selo selo--' + meta.cor + '">' +
            U.esc(meta.prazo) + '</span></p>' +
          '<p style="margin:0;font-size:.87rem;color:var(--texto-suave)">' +
            U.esc(meta.descricao) + '</p>' +
        '</div>';
    }).join('');
    return '<div class="grade grade--3">' + itens + '</div>';
  }

  function atalhosImediatas() {
    var imediatas = HABE_CATALOGO.fichas
      .filter(function (f) { return f.classificacao === 'imediata'; })
      .sort(U.ordenarPorNome);

    return imediatas.map(function (f) {
      return '<button class="filtro filtro--ativo filtro--urgente" data-ficha="' + U.esc(f.id) + '" ' +
             'style="font-weight:600" title="Abrir a ficha de ' + U.esc(f.nome) + '">' +
             U.esc(f.nome) + '</button>';
    }).join('');
  }

  function render(elemento) {
    var config = Armazenamento.obterConfig();

    elemento.innerHTML = '' +
      '<div class="pagina__cabecalho">' +
        '<h1 id="t-inicio">Fichas de notificação compulsória</h1>' +
        '<p>' + U.esc(config.unidade) + ' · ' + U.esc(config.setor) + '</p>' +
      '</div>' +

      '<div class="aviso aviso--urgente nao-imprimir">' +
        '<span class="aviso__icone">⏱</span>' +
        '<div>' +
          '<strong>Notificação imediata é em até 24 horas — e por telefone.</strong>' +
          'Nos agravos marcados em vermelho, comunique o Núcleo de Epidemiologia assim que ' +
          'houver <em>suspeita</em>, sem aguardar exame confirmatório. O preenchimento da ficha ' +
          'não substitui a comunicação imediata.' +
        '</div>' +
      '</div>' +

      '<div class="grade grade--2" style="margin-bottom:1.2rem">' +
        '<a class="botao botao--grande botao--bloco" href="#/solicitar">📄 Solicitar uma ficha</a>' +
        '<a class="botao botao--grande botao--bloco botao--secundario" href="#/fichas">🔤 Ver o sumário A–Z</a>' +
      '</div>' +

      '<div class="cartao">' +
        '<div class="busca-fichas" style="margin:0">' +
          '<label class="so-leitor-tela" for="buscaRapida">Buscar ficha</label>' +
          '<input type="search" id="buscaRapida" ' +
                 'placeholder="Buscar ficha por doença, sinônimo ou CID — ex.: dengue, catapora, A90">' +
        '</div>' +
        '<div id="resultadoBuscaRapida" style="margin-top:.8rem"></div>' +
      '</div>' +

      '<div class="grade grade--4" style="margin-bottom:1.2rem">' +
        '<div class="indicador indicador--padrao">' +
          '<div class="indicador__rotulo">Fichas no acervo</div>' +
          '<div class="indicador__valor">' + HABE_CATALOGO.fichas.length + '</div>' +
          '<div class="indicador__nota">agravos catalogados</div>' +
        '</div>' +
        '<div class="indicador indicador--urgente">' +
          '<div class="indicador__rotulo">Notificação imediata</div>' +
          '<div class="indicador__valor">' + contarPorClassificacao('imediata') + '</div>' +
          '<div class="indicador__nota">prazo de 24 horas</div>' +
        '</div>' +
        '<div class="indicador indicador--atencao">' +
          '<div class="indicador__rotulo">Com gatilho imediato</div>' +
          '<div class="indicador__valor">' + contarPorClassificacao('condicional') + '</div>' +
          '<div class="indicador__nota">semanal, exceto em situações específicas</div>' +
        '</div>' +
        '<div class="indicador indicador--sucesso">' +
          '<div class="indicador__rotulo">Solicitações no mês</div>' +
          '<div class="indicador__valor" id="indicadorMes">—</div>' +
          '<div class="indicador__nota" id="indicadorPendentes">carregando…</div>' +
        '</div>' +
      '</div>' +

      '<div class="cartao">' +
        '<div class="cartao__titulo">' +
          '<h2>Acesso direto às fichas de notificação imediata</h2>' +
          '<span class="selo selo--urgente">⏱ 24 horas</span>' +
        '</div>' +
        '<div class="filtros">' + atalhosImediatas() + '</div>' +
      '</div>' +

      '<div class="cartao">' +
        '<h2 style="margin-bottom:.9rem">Como identificar o prazo</h2>' +
        legenda() +
      '</div>';

    /* Busca rápida */
    var campo = U.$('#buscaRapida', elemento);
    var saida = U.$('#resultadoBuscaRapida', elemento);

    campo.addEventListener('input', function () {
      var termo = U.normalizar(campo.value.trim());
      if (termo.length < 2) { saida.innerHTML = ''; return; }

      var achados = Paginas.fichas.filtrar(termo).slice(0, 8);
      if (achados.length === 0) {
        saida.innerHTML = '<p style="color:var(--texto-suave);margin:0">' +
          'Nenhuma ficha encontrada. Consulte o sumário completo ou fale com o Núcleo de Epidemiologia.</p>';
        return;
      }
      saida.innerHTML = '<div class="lista-fichas">' +
        achados.map(Paginas.fichas.itemHtml).join('') + '</div>';
    });

    /* Abre o detalhe ao clicar em qualquer item com data-ficha */
    elemento.addEventListener('click', function (evento) {
      var alvo = evento.target.closest('[data-ficha]');
      if (!alvo) { return; }
      Paginas.fichas.abrirDetalhe(alvo.getAttribute('data-ficha'));
    });

    /* Indicadores dependentes dos dados gravados */
    Armazenamento.listarSolicitacoes().then(function (lista) {
      var mesAtual = U.competencia(U.hoje());
      var doMes = lista.filter(function (s) { return U.competencia(s.dataAtendimento) === mesAtual; });
      var pendentes = lista.filter(function (s) { return !s.anexos || s.anexos.length === 0; });

      U.$('#indicadorMes', elemento).textContent = doMes.length;
      U.$('#indicadorPendentes', elemento).textContent =
        pendentes.length + ' aguardando ficha digitalizada';
    }).catch(function (erro) {
      U.$('#indicadorMes', elemento).textContent = '—';
      U.$('#indicadorPendentes', elemento).textContent = erro.message;
    });
  }

  return { render: render };
})();
