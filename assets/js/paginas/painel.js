/* =========================================================================
   HABE SINAN — painel do Núcleo Hospitalar de Epidemiologia
   -------------------------------------------------------------------------
   Primeira tela de quem opera o registro: o que está pendente, o movimento
   do mês e o caminho mais curto para o que se faz todo dia.
   ========================================================================= */

var Paginas = Paginas || {};

Paginas.painel = (function () {
  'use strict';

  /* Notificação cujo prazo terminou sem que a ficha tenha sido recebida. */
  function estaAtrasada(registro) {
    if ((registro.anexos || []).length > 0) { return false; }
    if ((registro.status || 'aguardando') === 'encerrada') { return false; }
    var limite = U.prazoLimite({ classificacao: registro.classificacaoEfetiva },
                               registro.dataAtendimento);
    return limite.data < new Date();
  }

  function render(elemento) {
    var u = U.unidade();

    elemento.innerHTML = '' +
      '<div class="pagina__cabecalho">' +
        '<h1 id="t-painel">Painel do Núcleo</h1>' +
        '<p>' + U.esc(u.setor || 'Núcleo Hospitalar de Epidemiologia') + ' · ' +
           U.esc(u.nome || '') + '</p>' +
      '</div>' +

      '<div id="alertaAtrasos"></div>' +

      '<div class="grade grade--3" style="margin-bottom:1.2rem">' +
        '<a class="botao botao--grande botao--bloco" href="#/registrar">' +
          '📋 Registrar notificação</a>' +
        '<a class="botao botao--grande botao--bloco botao--secundario" href="#/notificacoes">' +
          '🗂 Ver notificações</a>' +
        '<a class="botao botao--grande botao--bloco botao--secundario" href="#/relatorios">' +
          '📊 Relatórios</a>' +
      '</div>' +

      '<div class="grade grade--4" style="margin-bottom:1.2rem">' +
        '<div class="indicador indicador--padrao">' +
          '<div class="indicador__rotulo">Registros no mês</div>' +
          '<div class="indicador__valor" id="painelMes">—</div>' +
          '<div class="indicador__nota">competência corrente</div>' +
        '</div>' +
        '<div class="indicador indicador--urgente">' +
          '<div class="indicador__rotulo">De notificação imediata</div>' +
          '<div class="indicador__valor" id="painelImediatas">—</div>' +
          '<div class="indicador__nota">no mês</div>' +
        '</div>' +
        '<div class="indicador indicador--atencao">' +
          '<div class="indicador__rotulo">Sem ficha digitalizada</div>' +
          '<div class="indicador__valor" id="painelPendentes">—</div>' +
          '<div class="indicador__nota">aguardando anexo</div>' +
        '</div>' +
        '<div class="indicador indicador--sucesso">' +
          '<div class="indicador__rotulo">Total registrado</div>' +
          '<div class="indicador__valor" id="painelTotal">—</div>' +
          '<div class="indicador__nota">desde o início</div>' +
        '</div>' +
      '</div>' +

      '<div class="cartao">' +
        '<div class="cartao__titulo">' +
          '<h2 style="font-size:1.05rem">Últimos registros</h2>' +
          '<a class="botao botao--pequeno botao--secundario" href="#/notificacoes">Ver todos</a>' +
        '</div>' +
        '<div id="painelUltimos"></div>' +
      '</div>' +

      '<div class="cartao">' +
        '<h2 style="font-size:1.05rem">Consulta rápida do prazo</h2>' +
        '<p style="font-size:.88rem;color:var(--texto-suave)">' +
          'A mesma busca que os médicos usam. Útil para conferir a classificação de um ' +
          'agravo antes de lançar o registro.</p>' +
        '<div class="busca-fichas" style="margin:0">' +
          '<label class="so-leitor-tela" for="buscaPainel">Buscar ficha</label>' +
          '<input type="search" id="buscaPainel" ' +
                 'placeholder="Buscar agravo por nome, sinônimo ou CID — ex.: dengue, catapora, A90">' +
        '</div>' +
        '<div id="resultadoBuscaPainel" style="margin-top:.8rem"></div>' +
      '</div>' +

      '<div class="cartao" style="background:var(--fundo)">' +
        '<h2 style="font-size:1rem">Página dos médicos assistentes</h2>' +
        '<p style="font-size:.9rem;margin-bottom:.7rem">' +
          'A urgência e os ambulatórios usam uma página separada, só de consulta e ' +
          'download — sem nenhum dado de paciente. É essa que vai no QR Code e nos ' +
          'atalhos dos consultórios.</p>' +
        '<div style="display:flex;gap:.5rem;flex-wrap:wrap">' +
          '<a class="botao botao--secundario botao--pequeno" href="index.html" target="_blank" ' +
             'rel="noopener">🔗 Abrir a página de consulta</a>' +
          '<a class="botao botao--secundario botao--pequeno" href="#/acesso">' +
             '📱 Gerar QR Code e cartaz</a>' +
        '</div>' +
      '</div>';

    /* Busca rápida */
    var campo = U.$('#buscaPainel', elemento);
    var saida = U.$('#resultadoBuscaPainel', elemento);
    campo.addEventListener('input', function () {
      var termo = campo.value.trim();
      if (termo.length < 2) { saida.innerHTML = ''; return; }
      var achados = Paginas.fichas.filtrar(termo).slice(0, 6);
      saida.innerHTML = achados.length
        ? '<div class="lista-fichas">' + achados.map(Paginas.fichas.itemHtml).join('') + '</div>'
        : '<p style="color:var(--texto-suave);margin:0">Nenhuma ficha encontrada.</p>';
    });

    elemento.addEventListener('click', function (evento) {
      var alvo = evento.target.closest('[data-ficha]');
      if (alvo) { Paginas.fichas.abrirDetalhe(alvo.getAttribute('data-ficha')); }
    });

    /* Números e listas */
    Armazenamento.listarSolicitacoes().then(function (lista) {
      lista = lista || [];
      var mesAtual = U.competencia(U.hoje());
      var doMes = lista.filter(function (r) { return U.competencia(r.dataAtendimento) === mesAtual; });
      var pendentes = lista.filter(function (r) {
        return (r.anexos || []).length === 0 && (r.status || 'aguardando') !== 'encerrada';
      });
      var atrasadas = lista.filter(estaAtrasada);

      U.$('#painelMes', elemento).textContent = doMes.length;
      U.$('#painelImediatas', elemento).textContent =
        doMes.filter(function (r) { return r.classificacaoEfetiva === 'imediata'; }).length;
      U.$('#painelPendentes', elemento).textContent = pendentes.length;
      U.$('#painelTotal', elemento).textContent = lista.length;

      if (atrasadas.length) {
        U.$('#alertaAtrasos', elemento).innerHTML =
          '<div class="aviso aviso--urgente"><span class="aviso__icone">⏰</span><div>' +
            '<strong>' + atrasadas.length + ' notificaç' +
            (atrasadas.length === 1 ? 'ão passou' : 'ões passaram') +
            ' do prazo sem a ficha digitalizada</strong>' +
            'O prazo regulamentar já venceu e não há anexo no registro. ' +
            '<a href="#/notificacoes">Ver na lista de notificações →</a>' +
          '</div></div>';
      }

      var ultimos = lista.slice(0, 5);
      U.$('#painelUltimos', elemento).innerHTML = ultimos.length === 0
        ? '<p style="color:var(--texto-suave);margin:0">Nenhuma notificação registrada ainda. ' +
          'Comece por <a href="#/registrar">Registrar notificação</a>.</p>'
        : '<div class="tabela-rolagem"><table class="tabela"><thead><tr>' +
            '<th>Protocolo</th><th>Agravo</th><th>Paciente</th><th>Atendimento</th><th>Ficha</th>' +
          '</tr></thead><tbody>' +
          ultimos.map(function (r) {
            var imediata = r.classificacaoEfetiva === 'imediata';
            return '<tr>' +
              '<td style="font-family:Consolas,monospace">' + U.esc(r.protocolo) + '</td>' +
              '<td><span class="ponto ponto--' + (imediata ? 'urgente' : 'padrao') + '"></span> ' +
                U.esc(r.fichaNome) + '</td>' +
              '<td>' + U.esc(r.pacienteNome) + '</td>' +
              '<td>' + U.formatarData(r.dataAtendimento) + '</td>' +
              '<td>' + ((r.anexos || []).length
                ? '<span class="selo selo--sucesso">📎 anexada</span>'
                : '<span class="selo selo--atencao">pendente</span>') + '</td>' +
            '</tr>';
          }).join('') +
          '</tbody></table></div>';
    }).catch(function (erro) {
      U.$('#painelUltimos', elemento).innerHTML =
        '<div class="aviso aviso--urgente"><span class="aviso__icone">⚠</span><div>' +
        U.esc(erro.message) + '</div></div>';
    });
  }

  return { render: render };
})();
