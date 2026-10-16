/* =========================================================================
   HABE – AQS e NSP — detalhe da missão e da atividade (painel lateral)
   Detalhe.abrirOcorrencia(id): uma execução (ocorrência) — situação,
     observação, evidências e comentários. É onde o adjunto "cumpre a
     missão" e anexa a prova do que fez.
   Detalhe.abrirAtividade(id): a atividade inteira — regra, responsáveis,
     próximos prazos, histórico, comentários gerais e todas as evidências,
     com as ações de edição, registro de execução, arquivamento e exclusão.

   O painel se atualiza sozinho (App.aoAtualizarPainel) quando chegam
   mudanças, mas NUNCA apaga o que o militar está digitando: o campo de
   comentário, a justificativa e o formulário de execução ficam fora das
   regiões redesenhadas, e a observação só é trocada se não tiver sido
   mexida. Ver docs/ARQUITETURA.md, seções 2, 5, 6 e 7.

   Além do contrato, expõe peças usadas por Início e Quadro, para que o
   cartão de missão e os botões rápidos sejam idênticos nas duas telas:
   Detalhe.cartaoMissaoHtml, Detalhe.acaoRapida, Detalhe.tratarClique,
   Detalhe.compararAbertas, Detalhe.seloPrazo e Detalhe.chipsResponsaveis.

   As permissões vêm de Regras.pode* (espelho da RLS): aqui elas só
   escondem o que não pode ser feito — quem barra de verdade é o banco.
   ========================================================================= */

var Detalhe = (function () {
  'use strict';

  var PESO_PRIORIDADE = { urgente: 0, alta: 1, normal: 2, baixa: 3 };
  /* Os mesmos limites dos checks do banco (01-estrutura.sql). */
  var LIMITE_TEXTO = 4000;          /* comentário */
  var LIMITE_OBSERVACAO = 10000;
  var LIMITE_JUSTIFICATIVA = 4000;
  var LIMITE_TITULO_EXECUCAO = 200;
  var HISTORICO_INICIAL = 10;
  var PROXIMOS_PRAZOS = 5;

  var SITUACOES = [
    { valor: 'pendente', rotulo: 'Pendente', icone: 'relogio' },
    { valor: 'em_andamento', rotulo: 'Em andamento', icone: 'missao' },
    { valor: 'concluida', rotulo: 'Concluída', icone: 'check' },
    { valor: 'nao_se_aplica', rotulo: 'Não se aplica', icone: 'fechar' }
  ];

  var MENSAGEM_LGPD = 'Não anexe documentos com identificação de pacientes (LGPD).';

  /* Cada painel aberto ganha um registro próprio; respostas que chegam
     depois de o painel ter sido trocado ou fechado são descartadas. */
  var seqPainel = 0;
  var atual = null;

  /* ---------- auxiliares ---------- */

  function icone(nome) {
    return '<svg class="icone" aria-hidden="true" focusable="false"><use href="#i-' + nome + '"></use></svg>';
  }

  function contem(lista, valor) {
    return Array.isArray(lista) && lista.indexOf(valor) >= 0;
  }

  function temPropria(objeto, chave) {
    return !!objeto && Object.prototype.hasOwnProperty.call(objeto, chave);
  }

  function militarLogado() {
    return (typeof App !== 'undefined' && App && typeof App.militar === 'function') ? App.militar() : null;
  }

  function achar(lista, teste) {
    for (var i = 0; i < (lista || []).length; i += 1) { if (teste(lista[i])) { return lista[i]; } }
    return null;
  }

  function plural(n, singular, varios) {
    return n + ' ' + (n === 1 ? singular : varios);
  }

  /* Erro de "não existe mais" (excluída por outra pessoa) — os dois
     adaptadores usam essa redação; o Supabase também marca o código. */
  function eNaoEncontrado(erro) {
    return !!erro && (erro.codigo === 'nao_encontrado' || /não encontrad/i.test(U.erroTexto(erro)));
  }

  /* Nome de quem fez algo: o cadastro atual, se ainda existir; senão o
     instantâneo gravado no registro (o militar foi excluído). */
  function nomePorId(id, mapa, instantaneo) {
    if (id && temPropria(mapa, id)) { return Regras.nomeMilitar(mapa[id]); }
    var texto = String(instantaneo || '').trim();
    return texto || '(militar excluído)';
  }

  /* 'Sexta, 30/10/2026' */
  function dataPorExtensoCurta(data) {
    var d = U.paraData(data);
    if (!d || isNaN(d.getTime())) { return '—'; }
    var dia = U.DIAS_SEMANA[d.getDay()].replace('-feira', '');
    return dia.charAt(0).toUpperCase() + dia.slice(1) + ', ' + U.formatarData(data);
  }

  /* ---------- peças compartilhadas (Início e Quadro) ---------- */

  /* Ordem de trabalho: prazo mais antigo primeiro (as atrasadas vêm na
     frente por consequência), sem prazo por último; empate pela prioridade. */
  function compararAbertas(a, b) {
    var pa = a.prazo || '9999-12-31';
    var pb = b.prazo || '9999-12-31';
    if (pa !== pb) { return pa < pb ? -1 : 1; }
    var wa = temPropria(PESO_PRIORIDADE, a.prioridade) ? PESO_PRIORIDADE[a.prioridade] : 2;
    var wb = temPropria(PESO_PRIORIDADE, b.prioridade) ? PESO_PRIORIDADE[b.prioridade] : 2;
    if (wa !== wb) { return wa - wb; }
    return U.ordenarTexto(a.atividade_titulo || '', b.atividade_titulo || '');
  }

  function chipsResponsaveis(ids, mapa, euId) {
    ids = Array.isArray(ids) ? ids : [];
    if (!ids.length) {
      return '<span class="chips"><span class="chip chip--sem-responsavel">Sem responsável</span></span>';
    }
    return '<span class="chips">' + ids.map(function (id) {
      var m = temPropria(mapa, id) ? mapa[id] : null;
      var nome = m ? Regras.nomeMilitar(m) : 'Militar não encontrado';
      var inativo = !!m && m.ativo === false;
      var eu = !!euId && id === euId;
      return '<span class="chip' + (eu ? ' chip--eu' : '') + (inativo ? ' chip--inativo' : '') + '" title="' +
        U.esc(nome + (inativo ? ' (inativo)' : '') + (eu ? ' — você' : '')) + '">' +
        U.esc(nome) + (inativo ? ' (inativo)' : '') + '</span>';
    }).join('') + '</span>';
  }

  /* Selo do prazo de uma ocorrência: atrasada em vermelho, hoje em âmbar,
     próximos dias em azul; concluída mostra o dia da conclusão. */
  function seloPrazo(oc, hoje) {
    if (oc.status === 'concluida') {
      var dia = Regras.dataBelem(oc.concluida_em);
      return '<span class="selo selo--concluida" title="' + U.esc(oc.concluida_em ? 'Concluída em ' + U.formatarDataHora(oc.concluida_em) : 'Concluída') + '">' +
        '✓ ' + (dia ? 'Concluída em ' + U.esc(U.formatarDataCurta(dia)) : 'Concluída') + '</span>';
    }
    if (oc.status === 'nao_se_aplica') { return Regras.seloStatus('nao_se_aplica'); }
    if (!oc.prazo) { return '<span class="selo selo--neutro">Sem prazo</span>'; }
    var d = U.diasEntre(hoje, oc.prazo);
    var classe = d < 0 ? 'selo--atrasada' : (d === 0 ? 'selo--atencao' : (d <= 3 ? 'selo--padrao' : 'selo--neutro'));
    return '<span class="selo ' + classe + '" title="Prazo: ' + U.esc(U.formatarData(oc.prazo)) + '">' +
      U.esc(U.descreverPrazo(oc.prazo, hoje)) + '</span>';
  }

  function acoesRapidasHtml(oc, ctx) {
    if (!ctx.eu || !Regras.podeAtualizarOcorrencia(ctx.eu, oc)) { return ''; }
    var titulo = oc.atividade_titulo || 'missão';
    function botao(acao, rotulo, classe, simbolo) {
      return '<button type="button" class="botao botao--pequeno ' + classe + '" data-acao-rapida="' + acao + '" ' +
        'data-oc="' + U.esc(oc.id) + '" aria-label="' + U.esc(rotulo + ': ' + titulo) + '">' +
        icone(simbolo) + rotulo + '</button>';
    }
    var botoes = [];
    if (oc.status === 'pendente') { botoes.push(botao('iniciar', 'Iniciar', 'botao--secundario', 'missao')); }
    if (Regras.estaAberta(oc)) { botoes.push(botao('concluir', 'Concluir', 'botao--sucesso', 'check')); }
    if (oc.status === 'concluida' || oc.status === 'nao_se_aplica') {
      botoes.push(botao('reabrir', 'Reabrir', 'botao--texto', 'recarregar'));
    }
    return botoes.length ? '<div class="missao__acoes">' + botoes.join('') + '</div>' : '';
  }

  /* Cartão de uma missão (linha de v_ocorrencias).
     ctx: { hoje, eu, mapaMilitares, mapaSetores }
     opcoes: { acoes, mostrarStatus, mostrarSetor, compacto } */
  function cartaoMissaoHtml(oc, ctx, opcoes) {
    opcoes = opcoes || {};
    var efetivo = Regras.statusEfetivo(oc, ctx.hoje);
    var classes = 'missao missao--' + (temPropria(Regras.ROTULOS.status, efetivo) ? efetivo : 'pendente');
    if (efetivo !== 'atrasada' && Regras.estaAberta(oc) && oc.prazo === ctx.hoje) { classes += ' missao--hoje'; }
    if (opcoes.compacto) { classes += ' missao--compacta'; }

    var titulo = oc.atividade_titulo || 'Atividade';
    var execucao = String(oc.titulo_execucao || '').trim();
    var referencia = Regras.rotuloReferencia(oc);
    if (execucao && referencia === execucao) { referencia = ''; }

    var setor = (opcoes.mostrarSetor && oc.setor_id && temPropria(ctx.mapaSetores, oc.setor_id))
      ? ctx.mapaSetores[oc.setor_id].sigla : '';

    var qe = Number(oc.qtd_evidencias) || 0;
    var qc = Number(oc.qtd_comentarios) || 0;
    var contagens = '';
    if (qe > 0 || (oc.exige_evidencia && Regras.estaAberta(oc))) {
      var falta = qe === 0;
      contagens += '<span class="missao__contagem' + (falta ? ' missao__contagem--falta' : '') + '" title="' +
        (falta ? 'Exige evidência — nenhuma anexada ainda' : plural(qe, 'evidência anexada', 'evidências anexadas')) + '">' +
        '<span aria-hidden="true">📎</span> ' + qe +
        '<span class="so-leitor-tela">' + (falta ? ' evidências (exige evidência)' : (qe === 1 ? ' evidência' : ' evidências')) + '</span></span>';
    }
    if (qc > 0) {
      contagens += '<span class="missao__contagem" title="' + plural(qc, 'comentário', 'comentários') + '">' +
        '<span aria-hidden="true">💬</span> ' + qc +
        '<span class="so-leitor-tela">' + (qc === 1 ? ' comentário' : ' comentários') + '</span></span>';
    }

    var selos = '';
    if (oc.prioridade && oc.prioridade !== 'normal') { selos += Regras.seloPrioridade(oc.prioridade); }
    if (opcoes.mostrarStatus && oc.status === 'em_andamento') { selos += Regras.seloStatus('em_andamento'); }

    return '<article class="' + classes + '" data-oc="' + U.esc(oc.id) + '">' +
      '<div class="missao__topo">' +
        '<button type="button" class="missao__abrir" data-abrir-ocorrencia="' + U.esc(oc.id) + '">' +
          U.esc(titulo) + '</button>' +
        (selos ? '<span class="missao__selos">' + selos + '</span>' : '') +
      '</div>' +
      (execucao ? '<div class="missao__execucao">' + U.esc(execucao) + '</div>' : '') +
      '<div class="missao__meta">' +
        (referencia ? '<span class="missao__referencia">' + U.esc(referencia) + '</span>' : '') +
        (setor ? '<span class="missao__setor">' + U.esc(setor) + '</span>' : '') +
        seloPrazo(oc, ctx.hoje) +
      '</div>' +
      '<div class="missao__rodape">' +
        chipsResponsaveis(oc.responsaveis, ctx.mapaMilitares, ctx.eu ? ctx.eu.id : null) +
        (contagens ? '<span class="missao__contagens">' + contagens + '</span>' : '') +
      '</div>' +
      (opcoes.acoes ? acoesRapidasHtml(oc, ctx) : '') +
    '</article>';
  }

  /* Botões rápidos (Iniciar / Concluir / Reabrir). Devolve a ocorrência
     atualizada, ou null se o militar desistiu ou deu erro (já avisado). */
  function acaoRapida(oc, acao, botao) {
    var campos;
    var mensagem;
    if (acao === 'iniciar') {
      campos = { status: 'em_andamento' };
      mensagem = 'Missão iniciada.';
    } else if (acao === 'concluir') {
      if (oc.exige_evidencia && !(Number(oc.qtd_evidencias) > 0) &&
          !U.confirmar('A atividade "' + (oc.atividade_titulo || '') + '" exige evidência e nenhum arquivo foi ' +
            'anexado a esta execução.\n\nConcluir mesmo assim? (Você pode anexar depois, no detalhe da missão.)')) {
        return Promise.resolve(null);
      }
      campos = { status: 'concluida' };
      mensagem = 'Missão cumprida! ✓';
    } else if (acao === 'reabrir') {
      campos = { status: 'pendente' };
      /* A justificativa de "não se aplica" deixa de valer ao reabrir. */
      if (oc.status === 'nao_se_aplica') { campos.justificativa = null; }
      mensagem = 'Missão reaberta.';
    } else {
      return Promise.resolve(null);
    }
    if (botao) { botao.disabled = true; botao.setAttribute('aria-busy', 'true'); }
    return Api.atualizarOcorrencia(oc.id, campos).then(function (nova) {
      U.torrada(mensagem, 'sucesso');
      App.recarregar(['ocorrencias']);
      return nova;
    }).catch(function (erro) {
      U.falha(erro);
      if (botao && document.body.contains(botao)) { botao.disabled = false; botao.removeAttribute('aria-busy'); }
      return null;
    });
  }

  /* Clique delegado nas listas de missões: botão rápido, abrir ocorrência
     ou abrir atividade. buscar(id) devolve a ocorrência já carregada pela
     página. Devolve true se tratou o clique. */
  function tratarClique(evento, buscar) {
    var alvo = evento.target;
    if (!alvo || !alvo.closest) { return false; }
    var rapida = alvo.closest('[data-acao-rapida]');
    if (rapida) {
      evento.preventDefault();
      var oc = typeof buscar === 'function' ? buscar(rapida.getAttribute('data-oc')) : null;
      if (oc && !rapida.disabled) { acaoRapida(oc, rapida.getAttribute('data-acao-rapida'), rapida); }
      return true;
    }
    var abrir = alvo.closest('[data-abrir-ocorrencia]');
    if (abrir) {
      evento.preventDefault();
      abrirOcorrencia(abrir.getAttribute('data-abrir-ocorrencia'));
      return true;
    }
    var atividade = alvo.closest('[data-abrir-atividade]');
    if (atividade) {
      evento.preventDefault();
      abrirAtividade(atividade.getAttribute('data-abrir-atividade'));
      return true;
    }
    return false;
  }

  /* ---------- painel: ciclo de vida ---------- */

  function novoPainel(tipo, id) {
    seqPainel += 1;
    var registro = { tipo: tipo, id: String(id), seq: seqPainel, painel: null, montado: false, carga: 0, dados: null };
    atual = registro;
    U.abrirPainel('<span class="texto-suave">Carregando…</span>',
      '<div class="carregando" role="status">Carregando…</div>',
      function (painel) { registro.painel = painel; },
      { aoFechar: function () { if (atual === registro) { atual = null; } } });
    /* "Tentar novamente" e "Fechar" valem mesmo quando o conteúdo nunca
       chegou a ser montado (falha na primeira carga). */
    if (registro.painel) {
      registro.painel.addEventListener('click', function (evento) {
        var botao = evento.target && evento.target.closest ? evento.target.closest('[data-det-acao]') : null;
        if (!botao) { return; }
        var qual = botao.getAttribute('data-det-acao');
        if (qual === 'tentar' && typeof registro.tentar === 'function') {
          var corpo = corpoDe(registro);
          if (corpo) { corpo.innerHTML = '<div class="carregando" role="status">Carregando…</div>'; }
          registro.tentar();
        } else if (qual === 'fechar') {
          U.fecharPainel();
        }
      });
    }
    return registro;
  }

  /* O painel ainda é este? (outro painel — formulário, outra missão — pode
     ter tomado o lugar, ou a sessão pode ter acabado.) */
  function vigente(registro) {
    return atual === registro && !!registro.painel && document.body.contains(registro.painel) && !!militarLogado();
  }

  function corpoDe(registro) { return U.$('.painel__corpo', registro.painel); }

  function definirTitulo(registro, html) {
    var titulo = U.$('.painel__titulo', registro.painel);
    if (titulo) { titulo.innerHTML = html; }
  }

  function regiao(registro, id) { return registro.painel ? registro.painel.querySelector('#' + id) : null; }

  function preencher(registro, id, html) {
    var el = regiao(registro, id);
    if (el) { el.innerHTML = html; U.aplicarLarguras(el); }
    return el;
  }

  function erroCargaHtml(texto) {
    return '<div class="aviso aviso--urgente" role="alert"><span class="aviso__icone">' + icone('alerta') + '</span>' +
      '<div><strong>Não foi possível carregar.</strong>' + U.esc(texto) + '</div></div>' +
      '<div class="acoes"><button type="button" class="botao botao--secundario" data-det-acao="tentar">' +
        icone('recarregar') + 'Tentar novamente</button></div>';
  }

  /* O registro foi excluído enquanto o painel estava aberto. */
  function mostrarRemovido(registro, texto) {
    registro.montado = false;
    registro.dados = null;
    var corpo = corpoDe(registro);
    if (!corpo) { return; }
    corpo.innerHTML = '<div class="vazio"><span class="vazio__icone">' + icone('caixa') + '</span>' +
      '<strong>Não existe mais</strong><p>' + U.esc(texto) + '</p>' +
      '<button type="button" class="botao botao--secundario" data-det-acao="fechar">Fechar</button></div>';
  }

  function falhaNaCarga(registro, erro, recarregar) {
    if (registro.montado) {
      if (eNaoEncontrado(erro)) {
        mostrarRemovido(registro, registro.tipo === 'ocorrencia'
          ? 'Esta missão foi excluída por outra pessoa enquanto estava aberta.'
          : 'Esta atividade foi excluída por outra pessoa enquanto estava aberta.');
      } else {
        /* Falha momentânea numa atualização: mantém o que já está na tela. */
        console.warn('Detalhe não atualizado agora.', erro);
      }
      return;
    }
    registro.tentar = recarregar;
    definirTitulo(registro, registro.tipo === 'ocorrencia' ? 'Missão' : 'Atividade');
    var corpo = corpoDe(registro);
    if (corpo) { corpo.innerHTML = erroCargaHtml(U.erroTexto(erro)); }
  }

  /* ---------- blocos comuns: dados, evidências, comentários ---------- */

  function dado(rotulo, valorHtml, classe) {
    return '<div' + (classe ? ' class="' + classe + '"' : '') + '><dt>' + U.esc(rotulo) + '</dt><dd>' + valorHtml + '</dd></div>';
  }

  function textoSuave(texto) { return '<span class="texto-suave">' + U.esc(texto) + '</span>'; }

  function nomeSetor(setorId, mapaSetores) {
    if (!setorId) { return textoSuave('Sem setor'); }
    var s = temPropria(mapaSetores, setorId) ? mapaSetores[setorId] : null;
    return s ? U.esc(s.sigla + ' — ' + s.nome) : textoSuave('Setor não encontrado');
  }

  function responsaveisDetalheHtml(ids, ref, eu) {
    if (!ids || !ids.length) { return '<span class="selo selo--urgente">Sem responsável</span>'; }
    return chipsResponsaveis(ids, ref.mapaMilitares, eu ? eu.id : null);
  }

  function evidenciaHtml(ev, ctx, rotuloOcorrencia) {
    var autor = nomePorId(ev.enviado_por, ctx.mapaMilitares, ev.enviado_por_nome);
    var pode = Regras.podeExcluirEvidencia(ctx.eu, ev);
    return '<li class="anexo-item evidencia">' +
      '<span class="evidencia__icone" aria-hidden="true">' + U.iconeArquivo(ev.mime || '', ev.nome) + '</span>' +
      '<div class="evidencia__info">' +
        '<span class="evidencia__nome" title="' + U.esc(ev.nome) + '">' + U.esc(ev.nome) + '</span>' +
        '<span class="evidencia__meta">' + U.esc(U.formatarTamanho(Number(ev.tamanho))) + ' · ' + U.esc(autor) + ' · ' +
          '<time datetime="' + U.esc(ev.enviado_em) + '" title="' + U.esc(U.formatarDataHora(ev.enviado_em)) + '">' +
          U.esc(U.formatarDataHora(ev.enviado_em)) + '</time>' +
          (rotuloOcorrencia ? ' · ' + rotuloOcorrencia : '') +
        '</span>' +
        (ev.descricao ? '<span class="evidencia__descricao">' + U.esc(ev.descricao) + '</span>' : '') +
      '</div>' +
      '<div class="evidencia__acoes">' +
        '<button type="button" class="botao botao--secundario botao--pequeno" data-abrir-evidencia="' + U.esc(ev.id) + '" ' +
          'aria-label="' + U.esc('Abrir ' + ev.nome) + '">Abrir</button>' +
        (pode ? '<button type="button" class="botao botao--perigo-secundario botao--pequeno" data-excluir-evidencia="' +
          U.esc(ev.id) + '" aria-label="' + U.esc('Excluir ' + ev.nome) + '">Excluir</button>' : '') +
      '</div>' +
    '</li>';
  }

  function listaEvidenciasHtml(lista, ctx, rotuloDe, vazio) {
    if (!lista.length) {
      return '<li class="evidencia-vazia">' + icone('caixa') + '<span>' + U.esc(vazio) + '</span></li>';
    }
    return lista.map(function (ev) { return evidenciaHtml(ev, ctx, rotuloDe ? rotuloDe(ev) : ''); }).join('');
  }

  function comentarioHtml(c, ctx) {
    var selo = Regras.rotuloPapelAutor(c.autor_papel);
    var autor = nomePorId(c.autor_id, ctx.mapaMilitares, c.autor_nome);
    var excluido = !c.autor_id || !temPropria(ctx.mapaMilitares, c.autor_id);
    var meu = !!ctx.eu && !!c.autor_id && c.autor_id === ctx.eu.id;
    var pode = Regras.podeExcluirComentario(ctx.eu, c);
    return '<article class="comentario' + (selo ? ' comentario--chefia' : '') + (meu ? ' comentario--meu' : '') + '">' +
      '<header class="comentario__cabecalho">' +
        '<span class="comentario__autor"' + (excluido ? ' title="Cadastro excluído — nome registrado no momento do comentário"' : '') + '>' +
          U.esc(autor) + '</span>' +
        (selo ? '<span class="selo selo--pequeno ' + (c.autor_papel === 'administrador' ? 'selo--aqs' : 'selo--chefia') + '">' +
          U.esc(selo) + '</span>' : '') +
        '<time class="comentario__tempo" datetime="' + U.esc(c.criado_em) + '" title="' + U.esc(U.formatarDataHora(c.criado_em)) + '">' +
          U.esc(U.tempoRelativo(c.criado_em)) + '</time>' +
        (pode ? '<button type="button" class="comentario__excluir" data-excluir-comentario="' + U.esc(c.id) + '" ' +
          'aria-label="Excluir este comentário" title="Excluir este comentário">' + icone('fechar') + '</button>' : '') +
      '</header>' +
      '<div class="comentario__texto">' + U.escMultilinha(c.texto) + '</div>' +
    '</article>';
  }

  function listaComentariosHtml(lista, ctx, vazio) {
    if (!lista.length) {
      return '<p class="comentarios__vazio">' + icone('comentario') + U.esc(vazio) + '</p>';
    }
    return lista.map(function (c) { return comentarioHtml(c, ctx); }).join('');
  }

  function novoComentarioHtml(placeholder) {
    return '<form class="comentario-novo" id="detComentarioForm" method="post" action="#" novalidate>' +
      '<label class="so-leitor-tela" for="detComentarioTexto">Novo comentário</label>' +
      '<textarea id="detComentarioTexto" rows="3" maxlength="' + LIMITE_TEXTO + '" placeholder="' + U.esc(placeholder) + '"></textarea>' +
      '<div class="comentario-novo__rodape">' +
        '<span class="texto-pequeno texto-suave">Visível para toda a equipe<span class="so-computador"> · ' +
          '<kbd>Ctrl</kbd>+<kbd>Enter</kbd> envia</span></span>' +
        '<button type="submit" class="botao botao--pequeno" id="detComentarioEnviar">' + icone('comentario') + 'Enviar</button>' +
      '</div>' +
    '</form>';
  }

  function secao(titulo, simbolo, conteudo, extraTitulo, id) {
    return '<section class="detalhe-secao"' + (id ? ' id="' + id + '"' : '') + '>' +
      '<div class="detalhe-secao__cabecalho"><h3 class="detalhe-secao__titulo">' + icone(simbolo) + U.esc(titulo) +
        (extraTitulo || '') + '</h3></div>' +
      conteudo +
    '</section>';
  }

  /* ---------- ações comuns (delegadas no painel) ---------- */

  function abrirEvidencia(registro, botao) {
    var id = botao.getAttribute('data-abrir-evidencia');
    var ev = registro.dados ? achar(registro.dados.evidencias, function (x) { return x.id === id; }) : null;
    if (!ev) { U.torrada('Arquivo não encontrado. Ele pode ter sido excluído.', 'erro'); return; }
    var rotulo = botao.textContent;
    botao.disabled = true;
    botao.textContent = 'Abrindo…';
    Api.baixarEvidencia(ev).then(function (blob) {
      U.abrirBlob(ev.nome, blob);
    }).catch(U.falha).then(function () {
      if (document.body.contains(botao)) { botao.disabled = false; botao.textContent = rotulo; }
    });
  }

  function excluirEvidencia(registro, botao) {
    var id = botao.getAttribute('data-excluir-evidencia');
    var ev = registro.dados ? achar(registro.dados.evidencias, function (x) { return x.id === id; }) : null;
    if (!ev) { return; }
    if (!U.confirmar('Excluir o arquivo "' + ev.nome + '"?\n\nEle será apagado do armazenamento e não há como desfazer.')) { return; }
    botao.disabled = true;
    Api.excluirEvidencia(ev).then(function () {
      U.torrada('Arquivo excluído.', 'sucesso');
      App.recarregar(['evidencias']);
    }).catch(function (erro) {
      U.falha(erro);
      if (document.body.contains(botao)) { botao.disabled = false; }
    });
  }

  function excluirComentario(botao) {
    var id = botao.getAttribute('data-excluir-comentario');
    if (!U.confirmar('Excluir este comentário?\n\nEle some para toda a equipe e não há como desfazer.')) { return; }
    botao.disabled = true;
    Api.excluirComentario(id).then(function () {
      U.torrada('Comentário excluído.', 'sucesso');
      App.recarregar(['comentarios']);
    }).catch(function (erro) {
      U.falha(erro);
      if (document.body.contains(botao)) { botao.disabled = false; }
    });
  }

  /* Campo de comentário: Enviar ou Ctrl/Cmd+Enter. O texto só é limpo
     depois que o banco aceitou. */
  function ligarComentario(registro, alvo) {
    var form = regiao(registro, 'detComentarioForm');
    if (!form) { return; }
    var campo = U.$('#detComentarioTexto', form);
    var botao = U.$('#detComentarioEnviar', form);
    var enviando = false;

    function enviar() {
      if (enviando) { return; }
      var destino = registro.dados ? alvo() : null;
      if (!destino) { return; }
      var texto = campo.value.trim();
      if (!texto) {
        U.torrada('Escreva o comentário antes de enviar.', 'atencao');
        campo.focus();
        return;
      }
      if (texto.length > LIMITE_TEXTO) {
        U.torrada('O comentário pode ter no máximo ' + LIMITE_TEXTO + ' caracteres.', 'erro');
        return;
      }
      enviando = true;
      botao.disabled = true;
      botao.setAttribute('aria-busy', 'true');
      Api.comentar({ atividade_id: destino.atividade_id, ocorrencia_id: destino.ocorrencia_id, texto: texto }).then(function () {
        if (document.body.contains(campo)) { campo.value = ''; }
        U.torrada('Comentário enviado.', 'sucesso');
        App.recarregar(['comentarios']);
      }).catch(U.falha).then(function () {
        enviando = false;
        if (document.body.contains(botao)) { botao.disabled = false; botao.removeAttribute('aria-busy'); }
      });
    }

    form.addEventListener('submit', function (evento) { evento.preventDefault(); enviar(); });
    campo.addEventListener('keydown', function (evento) {
      if (evento.key === 'Enter' && (evento.ctrlKey || evento.metaKey)) {
        evento.preventDefault();
        enviar();
      }
    });
  }

  /* ---------- ocorrência ---------- */

  function abrirOcorrencia(id) {
    if (!id) { return; }
    var registro = novoPainel('ocorrencia', id);
    App.aoAtualizarPainel(function () { carregarOcorrencia(registro); });
    carregarOcorrencia(registro);
  }

  function carregarOcorrencia(registro) {
    var carga = ++registro.carga;
    Api.obterOcorrencia(registro.id).then(function (oc) {
      if (!oc || !oc.id) { throw new Error('Missão não encontrada. Ela pode ter sido excluída — atualize a página.'); }
      return Promise.all([
        oc,
        Api.referencias(),
        Api.listarAtividades(),
        Api.listarEvidencias({ ocorrencia_id: oc.id }),
        Api.listarComentarios({ atividade_id: oc.atividade_id, ocorrencia_id: oc.id })
      ]);
    }).then(function (r) {
      if (!vigente(registro) || carga !== registro.carga) { return; }
      var oc = r[0];
      registro.dados = {
        oc: oc,
        ref: r[1],
        atividade: achar(r[2], function (a) { return a.id === oc.atividade_id; }),
        evidencias: (r[3] || []).filter(function (ev) { return ev.ocorrencia_id === oc.id; }),
        comentarios: (r[4] || []).filter(function (c) { return c.ocorrencia_id === oc.id; }),
        hoje: U.hojeBelem(),
        eu: militarLogado()
      };
      if (!registro.montado) { montarOcorrencia(registro); }
      atualizarOcorrencia(registro);
    }).catch(function (erro) {
      if (!vigente(registro) || carga !== registro.carga) { return; }
      falhaNaCarga(registro, erro, function () { carregarOcorrencia(registro); });
    });
  }

  function montarOcorrencia(registro) {
    var corpo = corpoDe(registro);
    if (!corpo) { return; }
    registro.montado = true;
    registro.enviandoArquivos = false;
    corpo.innerHTML =
      '<div class="detalhe detalhe--ocorrencia">' +
        '<div class="detalhe__topo" id="detTopo"></div>' +
        '<dl class="dados-lista detalhe__dados" id="detDados"></dl>' +
        '<div id="detDescricao"></div>' +

        secao('Situação', 'missao',
          '<div id="detSituacao"></div>' +
          '<div class="justificativa oculto" id="detJustificativa">' +
            '<div class="campo mb-0">' +
              '<label for="detJustificativaTexto">Por que não se aplica? <span class="obrigatorio">*</span>' +
                '<span class="campo__dica">Fica registrado no histórico e aparece nos relatórios.</span></label>' +
              '<textarea id="detJustificativaTexto" rows="3" maxlength="' + LIMITE_JUSTIFICATIVA + '" ' +
                'placeholder="Ex.: sistema fora do ar durante todo o expediente."></textarea>' +
              '<div class="campo__erro">Informe a justificativa.</div>' +
            '</div>' +
            '<div class="acoes acoes--direita">' +
              '<button type="button" class="botao botao--texto botao--pequeno" data-det-acao="cancelar-justificativa">Cancelar</button>' +
              '<button type="button" class="botao botao--pequeno" data-det-acao="confirmar-justificativa">Confirmar "não se aplica"</button>' +
            '</div>' +
          '</div>') +

        secao('Observação', 'comentario',
          '<div id="detObservacaoLeitura" class="detalhe__observacao oculto"></div>' +
          '<div id="detObservacaoEdicao" class="oculto">' +
            '<label class="so-leitor-tela" for="detObservacao">Observação</label>' +
            '<textarea id="detObservacao" rows="3" maxlength="' + LIMITE_OBSERVACAO + '" ' +
              'placeholder="O que foi feito, números, pendências, onde está o documento…"></textarea>' +
            '<div class="acoes acoes--direita mt-1">' +
              '<span class="texto-pequeno texto-suave cresce" id="detObservacaoEstado"></span>' +
              '<button type="button" class="botao botao--pequeno" id="detObservacaoSalvar" disabled>Salvar observação</button>' +
            '</div>' +
          '</div>') +

        secao('Evidências', 'caixa',
          '<div class="aviso aviso--atencao aviso--lgpd"><span class="aviso__icone">' + icone('cadeado') + '</span>' +
            '<div><strong>' + U.esc(MENSAGEM_LGPD) + '</strong>Use relatórios consolidados, planilhas sem nomes ou ' +
            'fotos com os dados pessoais cobertos.</div></div>' +
          '<div id="detAnexar" class="oculto">' +
            '<label class="zona-anexo" id="detZona" for="detArquivo">' +
              '<span class="zona-anexo__icone" aria-hidden="true">📎</span>' +
              '<strong>Arraste os arquivos para cá ou toque para escolher</strong>' +
              '<span class="zona-anexo__dica">PDF, Word, Excel, PowerPoint, OpenDocument, JPG, PNG, TXT ou CSV · ' +
                '<span class="sem-quebra">até ' + U.esc(String((typeof AQS_CONFIG !== 'undefined' && AQS_CONFIG.LIMITE_ARQUIVO_MB) || 20)) +
                ' MB cada</span></span>' +
            '</label>' +
            '<input type="file" id="detArquivo" class="so-leitor-tela" multiple accept="' + U.esc(Regras.ACCEPT) + '">' +
            '<label class="botao botao--secundario botao--bloco so-celular mt-1" for="detFoto">📷 Fotografar documento</label>' +
            '<input type="file" id="detFoto" class="so-leitor-tela" accept="image/*" capture="environment">' +
            '<div class="envio-progresso oculto" id="detProgresso" role="status" aria-live="polite">' +
              '<span class="envio-progresso__texto" id="detProgressoTexto"></span>' +
              '<div class="barra-progresso"><div class="barra-progresso__preenchimento" id="detProgressoBarra" data-largura="0"></div></div>' +
            '</div>' +
          '</div>' +
          '<p class="texto-pequeno texto-suave oculto" id="detSemAnexo">Só os responsáveis por esta missão e a chefia ' +
            'anexam evidências.</p>' +
          '<ul class="lista-anexos lista-evidencias" id="detEvidencias"></ul>',
          ' <span class="contador contador--neutro" id="detQtdEvidencias">0</span>') +

        secao('Comentários', 'comentario',
          '<div class="comentarios" id="detComentarios"></div>' +
          novoComentarioHtml('Escreva um comentário para a equipe…'),
          ' <span class="contador contador--neutro" id="detQtdComentarios">0</span>') +

        '<div class="acoes detalhe__rodape" id="detRodape"></div>' +
      '</div>';

    ligarOcorrencia(registro);
    var fechar = U.$('.painel__fechar', registro.painel);
    if (fechar) { try { fechar.focus({ preventScroll: true }); } catch (e) { fechar.focus(); } }
  }

  function atualizarOcorrencia(registro) {
    var d = registro.dados;
    var oc = d.oc;
    var ref = d.ref;
    var eu = d.eu;
    var hoje = d.hoje;
    var ctx = { hoje: hoje, eu: eu, mapaMilitares: ref.mapaMilitares, mapaSetores: ref.mapaSetores };
    var efetivo = Regras.statusEfetivo(oc, hoje);
    var pode = Regras.podeAtualizarOcorrencia(eu, oc);
    var atividade = d.atividade;

    definirTitulo(registro, U.esc(oc.atividade_titulo || 'Missão') +
      (oc.titulo_execucao ? '<span class="detalhe__titulo-execucao"> — ' + U.esc(oc.titulo_execucao) + '</span>' : ''));

    /* Sob demanda, o rótulo seria o próprio título da execução, que já está
       no cabeçalho: aqui vai a data. */
    var referencia = oc.referencia ? Regras.rotuloReferencia(oc)
      : 'Execução de ' + U.formatarData(oc.data_ref || oc.prazo || Regras.dataBelem(oc.criado_em));
    preencher(registro, 'detTopo',
      '<span class="detalhe__referencia">' + icone('plano') + U.esc(referencia) + '</span>' +
      '<span class="detalhe__selos">' + Regras.seloStatus(efetivo) + Regras.seloPrioridade(oc.prioridade || 'normal') +
        Regras.seloTipo(oc.atividade_tipo) +
        (oc.exige_evidencia ? '<span class="selo selo--atencao" title="A conclusão pede ao menos um arquivo anexado">📎 Exige evidência</span>' : '') +
      '</span>');

    /* Prazo: em aberto, quanto falta; concluída, se foi no prazo. */
    var prazoHtml;
    if (!oc.prazo) {
      prazoHtml = textoSuave('Sem prazo');
    } else if (oc.status === 'concluida') {
      prazoHtml = U.esc(U.formatarData(oc.prazo)) + ' · ' + (Regras.concluidaNoPrazo(oc)
        ? '<span class="texto-sucesso">cumprida no prazo</span>' : '<span class="texto-urgente">concluída fora do prazo</span>');
    } else if (oc.status === 'nao_se_aplica') {
      prazoHtml = U.esc(U.formatarData(oc.prazo));
    } else {
      prazoHtml = U.esc(U.formatarData(oc.prazo)) + ' · <span class="' +
        (efetivo === 'atrasada' ? 'texto-urgente' : (oc.prazo === hoje ? 'texto-atencao' : 'texto-suave')) + '">' +
        U.esc(U.descreverPrazo(oc.prazo, hoje)) + '</span>';
    }

    /* Pares lado a lado (prazo/setor, regra/início) e os responsáveis na
       linha inteira: não sobra buraco na grade. */
    var dados = [
      dado('Prazo', prazoHtml),
      dado('Setor', nomeSetor(oc.setor_id, ref.mapaSetores)),
      dado('Responsáveis', responsaveisDetalheHtml(oc.responsaveis, ref, eu), 'detalhe__dado-largo'),
      dado('Regra', U.esc(atividade ? Regras.descreverRegra(atividade) : (Regras.ROTULOS.tipo[oc.atividade_tipo] || '—')))
    ];
    if (oc.iniciada_em && oc.status !== 'pendente') {
      dados.push(dado('Iniciada em', U.esc(U.formatarDataHora(oc.iniciada_em))));
    }
    if (oc.status === 'concluida') {
      dados.push(dado('Concluída por', U.esc(oc.concluida_por_nome || nomePorId(oc.concluida_por, ref.mapaMilitares, ''))));
      dados.push(dado('Concluída em', U.esc(U.formatarDataHora(oc.concluida_em))));
    }
    if (oc.status === 'nao_se_aplica' && oc.justificativa) {
      dados.push(dado('Justificativa (não se aplica)', U.escMultilinha(oc.justificativa), 'detalhe__dado-largo'));
    }
    if (!oc.referencia && oc.criado_por !== undefined) {
      dados.push(dado('Registrada por', U.esc(oc.criado_por ? nomePorId(oc.criado_por, ref.mapaMilitares, '') : 'Sistema') +
        (oc.criado_em ? ' · ' + U.esc(U.formatarDataHora(oc.criado_em)) : '')));
    }
    preencher(registro, 'detDados', dados.join(''));

    preencher(registro, 'detDescricao', atividade && String(atividade.descricao || '').trim()
      ? '<div class="detalhe__descricao">' + U.escMultilinha(atividade.descricao) + '</div>' : '');

    /* Situação */
    var situacao;
    if (pode) {
      situacao = '<div class="situacao" role="group" aria-label="Situação da missão">' + SITUACOES.map(function (s) {
        var ativa = oc.status === s.valor;
        return '<button type="button" class="situacao__botao situacao__botao--' + s.valor + (ativa ? ' situacao__botao--ativa' : '') +
          '" data-situacao="' + s.valor + '" aria-pressed="' + (ativa ? 'true' : 'false') + '">' +
          icone(s.icone) + '<span>' + U.esc(s.rotulo) + '</span></button>';
      }).join('') + '</div>' +
      (efetivo === 'atrasada'
        ? '<p class="texto-pequeno texto-urgente mt-1 mb-0">' + icone('alerta') + ' Prazo vencido: conclua a missão ou, se ela não se aplica, justifique.</p>'
        : '');
    } else {
      situacao = '<p class="mb-1">' + Regras.seloStatus(efetivo) + '</p>' +
        '<p class="texto-pequeno texto-suave mb-0">Somente os responsáveis por esta missão e a chefia alteram a situação.</p>';
      var caixa = regiao(registro, 'detJustificativa');
      if (caixa) { caixa.classList.add('oculto'); }
    }
    preencher(registro, 'detSituacao', situacao);

    /* Observação: troca o texto só se o militar não estiver mexendo nele. */
    var leitura = regiao(registro, 'detObservacaoLeitura');
    var edicao = regiao(registro, 'detObservacaoEdicao');
    var campoObs = regiao(registro, 'detObservacao');
    var observacao = String(oc.observacao || '');
    if (pode) {
      leitura.classList.add('oculto');
      edicao.classList.remove('oculto');
      var original = campoObs.getAttribute('data-original');
      var mexido = original !== null && campoObs.value !== original;
      if (!mexido && document.activeElement !== campoObs) {
        campoObs.value = observacao;
        campoObs.setAttribute('data-original', observacao);
        regiao(registro, 'detObservacaoSalvar').disabled = true;
      } else if (original !== observacao && mexido) {
        regiao(registro, 'detObservacaoEstado').textContent = 'Atenção: a observação foi alterada por outra pessoa enquanto você editava.';
      }
    } else {
      edicao.classList.add('oculto');
      leitura.classList.remove('oculto');
      leitura.innerHTML = observacao.trim() ? U.escMultilinha(observacao) : textoSuave('Sem observação.');
    }

    /* Evidências */
    var podeAnexar = Regras.podeEnviarEvidencia(eu, oc);
    regiao(registro, 'detAnexar').classList.toggle('oculto', !podeAnexar);
    regiao(registro, 'detSemAnexo').classList.toggle('oculto', podeAnexar);
    preencher(registro, 'detQtdEvidencias', String(d.evidencias.length));
    preencher(registro, 'detEvidencias', listaEvidenciasHtml(d.evidencias, ctx, null,
      oc.exige_evidencia ? 'Nenhum arquivo anexado — esta atividade exige evidência.' : 'Nenhum arquivo anexado.'));

    /* Comentários */
    preencher(registro, 'detQtdComentarios', String(d.comentarios.length));
    preencher(registro, 'detComentarios', listaComentariosHtml(d.comentarios, ctx,
      'Nenhum comentário ainda. Use o campo abaixo para registrar dúvidas, combinados e orientações.'));

    /* Rodapé: ir à atividade; a chefia pode apagar uma execução sob demanda
       lançada por engano (as recorrentes voltariam a ser geradas). */
    var rodape = '<button type="button" class="botao botao--secundario" data-abrir-atividade="' + U.esc(oc.atividade_id) + '">' +
      icone('atividades') + 'Ver a atividade completa</button>';
    if (Regras.podeExcluirOcorrencia(eu) && !oc.referencia) {
      rodape += '<button type="button" class="botao botao--perigo-secundario" data-det-acao="excluir-execucao">' +
        'Excluir esta execução</button>';
    }
    preencher(registro, 'detRodape', rodape);
  }

  function mudarSituacao(registro, status, justificativa, botao) {
    var d = registro.dados;
    if (!d) { return; }
    var oc = d.oc;
    if (status === oc.status && status !== 'nao_se_aplica') { return; }
    if (status === 'concluida' && oc.exige_evidencia && !d.evidencias.length &&
        !U.confirmar('Esta atividade exige evidência e nenhum arquivo foi anexado a esta execução.\n\n' +
          'Concluir mesmo assim? (Você pode anexar depois.)')) {
      return;
    }
    var campos = { status: status };
    if (status === 'nao_se_aplica') { campos.justificativa = justificativa; }
    else if (oc.status === 'nao_se_aplica') { campos.justificativa = null; }

    var botoes = U.$$('[data-situacao]', registro.painel);
    botoes.forEach(function (b) { b.disabled = true; });
    if (botao) { botao.setAttribute('aria-busy', 'true'); }
    Api.atualizarOcorrencia(oc.id, campos).then(function () {
      var mensagens = {
        pendente: 'Missão marcada como pendente.',
        em_andamento: 'Missão em andamento.',
        concluida: 'Missão cumprida! ✓',
        nao_se_aplica: 'Registrado: não se aplica.'
      };
      U.torrada(mensagens[status] || 'Situação atualizada.', 'sucesso');
      if (status === 'nao_se_aplica' && vigente(registro)) {
        var texto = regiao(registro, 'detJustificativaTexto');
        if (texto) { texto.value = ''; }
        regiao(registro, 'detJustificativa').classList.add('oculto');
      }
      App.recarregar(['ocorrencias']);
    }).catch(function (erro) {
      U.falha(erro);
      botoes.forEach(function (b) { if (document.body.contains(b)) { b.disabled = false; b.removeAttribute('aria-busy'); } });
    });
  }

  function salvarObservacao(registro) {
    var campo = regiao(registro, 'detObservacao');
    var botao = regiao(registro, 'detObservacaoSalvar');
    var estado = regiao(registro, 'detObservacaoEstado');
    if (!campo || !registro.dados) { return; }
    var texto = campo.value;
    if (texto.length > LIMITE_OBSERVACAO) { U.torrada('A observação pode ter no máximo ' + LIMITE_OBSERVACAO.toLocaleString('pt-BR') + ' caracteres.', 'erro'); return; }
    botao.disabled = true;
    botao.setAttribute('aria-busy', 'true');
    Api.atualizarOcorrencia(registro.dados.oc.id, { observacao: texto }).then(function (nova) {
      var gravado = nova && typeof nova.observacao === 'string' ? nova.observacao : texto;
      if (document.body.contains(campo)) {
        campo.setAttribute('data-original', gravado);
        if (campo.value === texto) { campo.value = gravado; }
        estado.textContent = 'Observação salva.';
      }
      U.torrada('Observação salva.', 'sucesso');
      App.recarregar(['ocorrencias']);
    }).catch(function (erro) {
      U.falha(erro);
      if (document.body.contains(botao)) { botao.disabled = false; }
    }).then(function () {
      if (document.body.contains(botao)) { botao.removeAttribute('aria-busy'); }
    });
  }

  function excluirExecucao(registro, botao) {
    var oc = registro.dados && registro.dados.oc;
    if (!oc) { return; }
    var nome = (oc.atividade_titulo || 'atividade') + ' — ' + Regras.rotuloReferencia(oc);
    if (!U.confirmar('Excluir a execução "' + nome + '"?\n\nAs evidências (' + registro.dados.evidencias.length +
        ') e os comentários (' + registro.dados.comentarios.length + ') desta execução também serão apagados. ' +
        'Não há como desfazer.')) { return; }
    botao.disabled = true;
    Api.excluirOcorrencia(oc.id).then(function () {
      U.torrada('Execução excluída.', 'sucesso');
      if (vigente(registro)) { U.fecharPainel(); }
      App.recarregar(['ocorrencias']);
    }).catch(function (erro) {
      U.falha(erro);
      if (document.body.contains(botao)) { botao.disabled = false; }
    });
  }

  /* ---------- envio de evidências ---------- */

  /* Fotos grandes são reduzidas antes (U.comprimirImagem também converte
     formatos que o navegador consegue abrir, como HEIC no iPhone, em JPEG);
     a validação vem depois, sobre o arquivo que vai de fato. */
  function prepararArquivo(arquivo) {
    var imagem = /^image\//.test(arquivo.type || '');
    var reduzir = imagem ? U.comprimirImagem(arquivo) : Promise.resolve(null);
    return reduzir.then(function (reduzido) {
      var final = reduzido || arquivo;
      var problema = Regras.validarArquivo(final);
      if (problema) { throw new Error('"' + arquivo.name + '": ' + problema); }
      return final;
    });
  }

  function mostrarProgresso(registro, texto, percentual) {
    var caixa = regiao(registro, 'detProgresso');
    if (!caixa) { return; }
    if (texto === null) { caixa.classList.add('oculto'); return; }
    caixa.classList.remove('oculto');
    regiao(registro, 'detProgressoTexto').textContent = texto;
    var barra = regiao(registro, 'detProgressoBarra');
    barra.setAttribute('data-largura', String(Math.round(percentual)));
    U.aplicarLarguras(caixa);
  }

  function enviarArquivos(registro, lista) {
    var arquivos = Array.prototype.slice.call(lista || []);
    if (!arquivos.length || !registro.dados) { return; }
    if (registro.enviandoArquivos) {
      U.torrada('Aguarde: ainda há arquivos sendo enviados.', 'atencao');
      return;
    }
    var oc = registro.dados.oc;
    var total = arquivos.length;
    var enviados = 0;
    var falhas = [];
    var zona = regiao(registro, 'detZona');
    registro.enviandoArquivos = true;
    if (zona) { zona.classList.add('zona-anexo--ocupada'); }

    function proximo(i) {
      if (i >= total) { return Promise.resolve(); }
      var arquivo = arquivos[i];
      var rotulo = 'Enviando ' + (i + 1) + ' de ' + total + ': ' + arquivo.name + '…';
      if (vigente(registro)) { mostrarProgresso(registro, rotulo, (i / total) * 100); }
      U.torrada(rotulo, '', 2500);
      return prepararArquivo(arquivo).then(function (final) {
        return Api.enviarEvidencia({ atividade_id: oc.atividade_id, ocorrencia_id: oc.id, arquivo: final, descricao: '' });
      }).then(function () {
        enviados += 1;
      }).catch(function (erro) {
        var texto = U.erroTexto(erro);
        falhas.push(texto.indexOf(arquivo.name) >= 0 ? texto : '"' + arquivo.name + '": ' + texto);
      }).then(function () { return proximo(i + 1); });
    }

    proximo(0).then(function () {
      registro.enviandoArquivos = false;
      if (vigente(registro)) {
        mostrarProgresso(registro, null);
        var z = regiao(registro, 'detZona');
        if (z) { z.classList.remove('zona-anexo--ocupada'); }
      }
      if (enviados) {
        U.torrada(enviados === 1 ? '1 arquivo anexado.' : enviados + ' arquivos anexados.', 'sucesso');
        App.recarregar(['evidencias']);
      }
      falhas.forEach(function (texto) { U.torrada('Não enviado — ' + texto, 'erro', 9000); });
    });
  }

  function ligarAnexos(registro) {
    var zona = regiao(registro, 'detZona');
    var entrada = regiao(registro, 'detArquivo');
    var foto = regiao(registro, 'detFoto');
    if (!zona || !entrada) { return; }

    function aoEscolher(evento) {
      var campo = evento.target;
      var lista = Array.prototype.slice.call(campo.files || []);
      campo.value = '';   /* permite escolher o mesmo arquivo de novo */
      enviarArquivos(registro, lista);
    }
    entrada.addEventListener('change', aoEscolher);
    if (foto) { foto.addEventListener('change', aoEscolher); }

    var profundidade = 0;
    zona.addEventListener('dragenter', function (evento) {
      evento.preventDefault();
      profundidade += 1;
      zona.classList.add('zona-anexo--sobre');
    });
    zona.addEventListener('dragover', function (evento) {
      evento.preventDefault();
      if (evento.dataTransfer) { evento.dataTransfer.dropEffect = 'copy'; }
    });
    zona.addEventListener('dragleave', function () {
      profundidade = Math.max(0, profundidade - 1);
      if (!profundidade) { zona.classList.remove('zona-anexo--sobre'); }
    });
    zona.addEventListener('drop', function (evento) {
      evento.preventDefault();
      profundidade = 0;
      zona.classList.remove('zona-anexo--sobre');
      var arquivos = evento.dataTransfer ? evento.dataTransfer.files : null;
      if (arquivos && arquivos.length) { enviarArquivos(registro, arquivos); }
    });
  }

  function ligarOcorrencia(registro) {
    var painel = registro.painel;

    painel.addEventListener('click', function (evento) {
      var alvo = evento.target;
      if (!alvo || !alvo.closest || !registro.montado) { return; }

      var situacao = alvo.closest('[data-situacao]');
      if (situacao && !situacao.disabled) {
        var valor = situacao.getAttribute('data-situacao');
        var caixa = regiao(registro, 'detJustificativa');
        if (valor === 'nao_se_aplica') {
          caixa.classList.remove('oculto');
          var texto = regiao(registro, 'detJustificativaTexto');
          if (!texto.value && registro.dados && registro.dados.oc.justificativa) { texto.value = registro.dados.oc.justificativa; }
          texto.focus();
          return;
        }
        caixa.classList.add('oculto');
        mudarSituacao(registro, valor, null, situacao);
        return;
      }

      var acao = alvo.closest('[data-det-acao]');
      if (acao) {
        var qual = acao.getAttribute('data-det-acao');
        if (qual === 'cancelar-justificativa') {
          regiao(registro, 'detJustificativa').classList.add('oculto');
        } else if (qual === 'confirmar-justificativa') {
          var campo = regiao(registro, 'detJustificativaTexto');
          var envoltorio = campo.closest('.campo');
          var justificativa = campo.value.trim();
          envoltorio.classList.toggle('campo--invalido', !justificativa);
          if (!justificativa) { campo.focus(); return; }
          mudarSituacao(registro, 'nao_se_aplica', justificativa, acao);
        } else if (qual === 'excluir-execucao') {
          excluirExecucao(registro, acao);
        }
        return;
      }

      var abrirEv = alvo.closest('[data-abrir-evidencia]');
      if (abrirEv) { abrirEvidencia(registro, abrirEv); return; }
      var excluirEv = alvo.closest('[data-excluir-evidencia]');
      if (excluirEv) { excluirEvidencia(registro, excluirEv); return; }
      var excluirCom = alvo.closest('[data-excluir-comentario]');
      if (excluirCom) { excluirComentario(excluirCom); return; }
      var atividade = alvo.closest('[data-abrir-atividade]');
      if (atividade) { abrirAtividade(atividade.getAttribute('data-abrir-atividade')); }
    });

    var campoObs = regiao(registro, 'detObservacao');
    var salvar = regiao(registro, 'detObservacaoSalvar');
    campoObs.addEventListener('input', function () {
      var original = campoObs.getAttribute('data-original') || '';
      salvar.disabled = campoObs.value === original;
      regiao(registro, 'detObservacaoEstado').textContent = campoObs.value === original ? '' : 'Alterações não salvas.';
    });
    salvar.addEventListener('click', function () { salvarObservacao(registro); });

    var justificativa = regiao(registro, 'detJustificativaTexto');
    justificativa.addEventListener('input', function () {
      if (justificativa.value.trim()) { justificativa.closest('.campo').classList.remove('campo--invalido'); }
    });

    ligarAnexos(registro);
    ligarComentario(registro, function () {
      var oc = registro.dados.oc;
      return { atividade_id: oc.atividade_id, ocorrencia_id: oc.id };
    });
  }

  /* ---------- atividade ---------- */

  function abrirAtividade(id) {
    if (!id) { return; }
    var registro = novoPainel('atividade', id);
    registro.historicoCompleto = false;
    App.aoAtualizarPainel(function () { carregarAtividade(registro); });
    carregarAtividade(registro);
  }

  function carregarAtividade(registro) {
    var carga = ++registro.carga;
    Promise.all([
      Api.listarAtividades(),
      Api.referencias(),
      Api.listarOcorrencias({ atividade_id: registro.id }),
      Api.listarEvidencias({ atividade_id: registro.id }),
      Api.listarComentarios({ atividade_id: registro.id })
    ]).then(function (r) {
      if (!vigente(registro) || carga !== registro.carga) { return; }
      var atividade = achar(r[0], function (a) { return a.id === registro.id; });
      if (!atividade) {
        var erro = new Error('Atividade não encontrada. Ela pode ter sido excluída — atualize a página.');
        erro.codigo = 'nao_encontrado';
        throw erro;
      }
      var ocorrencias = (r[2] || []).filter(function (oc) { return oc.atividade_id === atividade.id; });
      registro.dados = {
        atividade: atividade,
        ref: r[1],
        ocorrencias: ocorrencias,
        evidencias: (r[3] || []).filter(function (ev) { return ev.atividade_id === atividade.id; }),
        /* Comentários gerais: os que não pertencem a uma execução. */
        comentarios: (r[4] || []).filter(function (c) { return c.atividade_id === atividade.id && !c.ocorrencia_id; }),
        hoje: U.hojeBelem(),
        eu: militarLogado()
      };
      if (!registro.montado) { montarAtividade(registro); }
      atualizarAtividade(registro);
    }).catch(function (erro) {
      if (!vigente(registro) || carga !== registro.carga) { return; }
      if (!registro.montado && eNaoEncontrado(erro)) {
        definirTitulo(registro, 'Atividade');
        mostrarRemovido(registro, 'Esta atividade não existe mais. Ela pode ter sido excluída pela chefia.');
        return;
      }
      falhaNaCarga(registro, erro, function () { carregarAtividade(registro); });
    });
  }

  function montarAtividade(registro) {
    var corpo = corpoDe(registro);
    if (!corpo) { return; }
    registro.montado = true;
    var hoje = U.hojeBelem();
    corpo.innerHTML =
      '<div class="detalhe detalhe--atividade">' +
        '<div class="detalhe__topo" id="detTopo"></div>' +
        '<dl class="dados-lista detalhe__dados" id="detDados"></dl>' +
        '<div id="detDescricao"></div>' +
        '<div class="acoes detalhe__acoes" id="detAcoes"></div>' +

        '<form class="execucao-form oculto" id="detExecucaoForm" method="post" action="#" novalidate>' +
          '<h3 class="execucao-form__titulo">' + icone('check') + 'Registrar execução</h3>' +
          '<fieldset class="opcoes execucao-form__situacao">' +
            '<legend class="so-leitor-tela">Situação da execução</legend>' +
            '<label class="opcao opcao--compacta"><input type="radio" name="detExecucaoSituacao" value="concluida" checked>' +
              '<span class="opcao__texto"><strong>Já executada</strong><small>Registra como concluída.</small></span></label>' +
            '<label class="opcao opcao--compacta"><input type="radio" name="detExecucaoSituacao" value="pendente">' +
              '<span class="opcao__texto"><strong>A fazer</strong><small>Fica pendente, com prazo.</small></span></label>' +
          '</fieldset>' +
          '<div class="campo">' +
            '<label for="detExecucaoTitulo">Título da execução <span class="campo__dica">Opcional. Ex.: Incidente 2026/041, ' +
              'Treinamento da Clínica Médica.</span></label>' +
            '<input type="text" id="detExecucaoTitulo" maxlength="' + LIMITE_TITULO_EXECUCAO + '" autocomplete="off">' +
          '</div>' +
          '<div class="campo">' +
            '<label for="detExecucaoData" id="detExecucaoDataRotulo">Data da execução <span class="obrigatorio">*</span></label>' +
            '<input type="date" id="detExecucaoData" value="' + U.esc(hoje) + '" max="' + U.esc(hoje) + '" required>' +
            '<div class="campo__erro" id="detExecucaoDataErro">Informe a data.</div>' +
          '</div>' +
          '<div class="campo">' +
            '<label for="detExecucaoObservacao">Observação <span class="campo__dica">Opcional.</span></label>' +
            '<textarea id="detExecucaoObservacao" rows="2" maxlength="' + LIMITE_OBSERVACAO + '"></textarea>' +
          '</div>' +
          '<p class="texto-pequeno texto-suave mb-0">Depois de registrar, a execução abre para você anexar as evidências.</p>' +
          '<div class="acoes acoes--direita">' +
            '<button type="button" class="botao botao--texto" data-det-acao="cancelar-execucao">Cancelar</button>' +
            '<button type="submit" class="botao" id="detExecucaoSalvar">Registrar</button>' +
          '</div>' +
        '</form>' +

        '<div id="detCumprimento"></div>' +
        '<div id="detProximos"></div>' +
        secao('Histórico', 'relogio', '<div id="detHistorico"></div>') +
        secao('Comentários gerais', 'comentario',
          '<p class="texto-pequeno texto-suave">Combinados sobre a atividade como um todo. Os comentários de cada ' +
            'execução ficam na própria execução.</p>' +
          '<div class="comentarios" id="detComentarios"></div>' +
          novoComentarioHtml('Comentário sobre a atividade…'),
          ' <span class="contador contador--neutro" id="detQtdComentarios">0</span>') +
        secao('Todas as evidências', 'caixa',
          '<div class="aviso aviso--atencao aviso--lgpd"><span class="aviso__icone">' + icone('cadeado') + '</span>' +
            '<div><strong>' + U.esc(MENSAGEM_LGPD) + '</strong>Para anexar, abra a execução correspondente no histórico.</div></div>' +
          '<ul class="lista-anexos lista-evidencias" id="detEvidencias"></ul>',
          ' <span class="contador contador--neutro" id="detQtdEvidencias">0</span>') +
      '</div>';

    ligarAtividade(registro);
    var fechar = U.$('.painel__fechar', registro.painel);
    if (fechar) { try { fechar.focus({ preventScroll: true }); } catch (e) { fechar.focus(); } }
  }

  function linhaHistoricoHtml(oc, ctx) {
    var efetivo = Regras.statusEfetivo(oc, ctx.hoje);
    var execucao = String(oc.titulo_execucao || '').trim();
    var referencia = Regras.rotuloReferencia(oc);
    var qe = Number(oc.qtd_evidencias) || 0;
    var qc = Number(oc.qtd_comentarios) || 0;
    return '<li><button type="button" class="historico__item historico__item--' + U.esc(efetivo) + '" data-abrir-ocorrencia="' + U.esc(oc.id) + '">' +
      '<span class="historico__referencia">' + U.esc(referencia) +
        (execucao && execucao !== referencia ? '<small>' + U.esc(execucao) + '</small>' : '') +
      '</span>' +
      '<span class="historico__info">' +
        (qe ? '<span class="historico__contagem" title="' + plural(qe, 'evidência', 'evidências') + '">📎 ' + qe + '</span>' : '') +
        (qc ? '<span class="historico__contagem" title="' + plural(qc, 'comentário', 'comentários') + '">💬 ' + qc + '</span>' : '') +
        seloPrazo(oc, ctx.hoje) +
      '</span>' +
    '</button></li>';
  }

  function atualizarAtividade(registro) {
    var d = registro.dados;
    var a = d.atividade;
    var ref = d.ref;
    var eu = d.eu;
    var hoje = d.hoje;
    var ctx = { hoje: hoje, eu: eu, mapaMilitares: ref.mapaMilitares, mapaSetores: ref.mapaSetores };
    var gestor = Regras.eGestor(eu);

    definirTitulo(registro, U.esc(a.titulo));

    preencher(registro, 'detTopo',
      '<span class="detalhe__referencia">' + icone('atividades') + 'Atividade nº ' + U.esc(String(a.ordem || '—')) + '</span>' +
      '<span class="detalhe__selos">' + Regras.seloTipo(a.tipo) + Regras.seloPrioridade(a.prioridade || 'normal') +
        (a.ativa === false ? '<span class="selo selo--neutro">Arquivada</span>' : '') +
        (a.exige_evidencia ? '<span class="selo selo--atencao">📎 Exige evidência</span>' : '') +
      '</span>');

    var dados = [
      dado('Regra', U.esc(Regras.descreverRegra(a)), 'detalhe__dado-largo'),
      dado('Setor', nomeSetor(a.setor_id, ref.mapaSetores)),
      dado('Criada por', U.esc(a.criado_por ? nomePorId(a.criado_por, ref.mapaMilitares, '') : '—') +
        (a.criado_em ? ' · ' + U.esc(U.formatarData(Regras.dataBelem(a.criado_em))) : ''))
    ];
    if (a.tipo === 'recorrente' && a.data_inicio) { dados.push(dado('Vale a partir de', U.esc(U.formatarData(a.data_inicio)))); }
    dados.push(dado('Responsáveis', responsaveisDetalheHtml(a.responsaveis, ref, eu), 'detalhe__dado-largo'));
    preencher(registro, 'detDados', dados.join(''));

    preencher(registro, 'detDescricao', String(a.descricao || '').trim()
      ? '<div class="detalhe__descricao">' + U.escMultilinha(a.descricao) + '</div>'
      : '<p class="texto-suave texto-pequeno">Sem descrição.</p>');

    if (a.ativa === false) {
      U.$('#detDescricao', registro.painel).insertAdjacentHTML('beforeend',
        '<div class="aviso"><span class="aviso__icone">' + icone('info') + '</span><div><strong>Atividade arquivada</strong>' +
        'Não gera novas ocorrências nem aparece nas listas de trabalho. O histórico continua disponível.</div></div>');
    }

    /* Ações */
    var acoes = [];
    if (Regras.podeEditarAtividade(eu, a)) {
      acoes.push('<button type="button" class="botao botao--secundario" data-det-acao="editar">' + icone('atividades') + 'Editar</button>');
    }
    if (a.tipo === 'sob_demanda' && a.ativa !== false && Regras.podeRegistrarExecucao(eu, a)) {
      acoes.push('<button type="button" class="botao" data-det-acao="registrar">' + icone('check') + 'Registrar execução</button>');
    }
    if (gestor && Regras.podeExcluirAtividade(eu)) {
      acoes.push(a.ativa === false
        ? '<button type="button" class="botao botao--secundario" data-det-acao="reativar">' + icone('recarregar') + 'Reativar</button>'
        : '<button type="button" class="botao botao--secundario" data-det-acao="arquivar">' + icone('caixa') + 'Arquivar</button>');
      acoes.push('<button type="button" class="botao botao--perigo-secundario" data-det-acao="excluir-atividade">Excluir</button>');
    }
    preencher(registro, 'detAcoes', acoes.join(''));
    regiao(registro, 'detAcoes').classList.toggle('oculto', !acoes.length);
    if (!(a.tipo === 'sob_demanda' && a.ativa !== false && Regras.podeRegistrarExecucao(eu, a))) {
      regiao(registro, 'detExecucaoForm').classList.add('oculto');
    }

    /* Cumprimento (o mesmo critério dos relatórios) */
    var conf = Regras.conformidade(d.ocorrencias, hoje);
    preencher(registro, 'detCumprimento', conf.universo
      ? '<div class="cumprimento">' + U.anelProgresso(conf.percentual, 'cumprimento') +
          '<div class="cumprimento__texto"><strong>' + plural(conf.concluidas, 'execução concluída', 'execuções concluídas') +
            ' de ' + conf.universo + '</strong>' +
            '<span>' + plural(conf.no_prazo, 'no prazo', 'no prazo') + (conf.atrasadas ? ' · <span class="texto-urgente">' +
              plural(conf.atrasadas, 'atrasada', 'atrasadas') + '</span>' : '') +
              (conf.abertas - conf.atrasadas > 0 ? ' · ' + plural(conf.abertas - conf.atrasadas, 'em aberto', 'em aberto') : '') +
            '</span>' +
            '<small class="texto-suave">Considera as execuções já vencidas (ou concluídas); “não se aplica” fica de fora.</small>' +
          '</div>' +
        '</div>'
      : '');

    /* Próximos prazos (recorrentes ativas): calculados pela regra; os que
       já existem no banco abrem a ocorrência. */
    var proximosHtml = '';
    if (a.tipo === 'recorrente' && a.ativa !== false) {
      var porReferencia = {};
      d.ocorrencias.forEach(function (oc) { if (oc.referencia) { porReferencia[oc.referencia] = oc; } });
      var proximos = Recorrencia.proximas(a, PROXIMOS_PRAZOS, hoje, ref.feriados);
      proximosHtml = secao('Próximos prazos', 'plano', proximos.length
        ? '<ul class="proximos-prazos">' + proximos.map(function (p) {
            var oc = porReferencia[p.referencia];
            var conteudo = '<span class="proximos-prazos__data">' + U.esc(dataPorExtensoCurta(p.prazo)) + '</span>' +
              '<span class="proximos-prazos__referencia">' + U.esc(Regras.rotuloReferencia(p.referencia)) + '</span>' +
              '<span class="proximos-prazos__falta">' + U.esc(oc && oc.status === 'concluida' ? 'concluída'
                : (oc && oc.status === 'nao_se_aplica' ? 'não se aplica' : U.descreverPrazo(p.prazo, hoje))) + '</span>';
            return '<li>' + (oc
              ? '<button type="button" class="proximos-prazos__item" data-abrir-ocorrencia="' + U.esc(oc.id) + '">' + conteudo + '</button>'
              : '<span class="proximos-prazos__item proximos-prazos__item--futuro">' + conteudo + '</span>') + '</li>';
          }).join('') + '</ul>'
        : '<p class="texto-suave texto-pequeno mb-0">Nenhum prazo calculado para os próximos meses.</p>');
    } else if (a.tipo === 'pontual') {
      proximosHtml = secao('Prazo', 'plano', '<p class="mb-0">' + (a.prazo
        ? U.esc(dataPorExtensoCurta(a.prazo)) + ' · <span class="texto-suave">' + U.esc(U.descreverPrazo(a.prazo, hoje)) + '</span>'
        : textoSuave('Sem prazo definido')) + '</p>');
    }
    preencher(registro, 'detProximos', proximosHtml);

    /* Histórico: recorrentes mostram até hoje (o futuro está acima); as
       demais mostram tudo. Mais recentes primeiro. */
    var historico = d.ocorrencias.filter(function (oc) {
      return a.tipo !== 'recorrente' || String(oc.data_ref || oc.prazo || '') <= hoje;
    }).sort(function (x, y) {
      var dx = String(x.data_ref || ''), dy = String(y.data_ref || '');
      if (dx !== dy) { return dx < dy ? 1 : -1; }
      return String(x.criado_em || '') < String(y.criado_em || '') ? 1 : -1;
    });
    var visiveis = registro.historicoCompleto ? historico : historico.slice(0, HISTORICO_INICIAL);
    preencher(registro, 'detHistorico', historico.length
      ? '<ul class="historico">' + visiveis.map(function (oc) { return linhaHistoricoHtml(oc, ctx); }).join('') + '</ul>' +
        (historico.length > visiveis.length
          ? '<button type="button" class="botao botao--texto botao--pequeno mt-1" data-det-acao="historico-completo">' +
            'Mostrar todas (' + historico.length + ')</button>'
          : '')
      : '<p class="texto-suave texto-pequeno mb-0">' + (a.tipo === 'sob_demanda'
        ? 'Nenhuma execução registrada ainda.' + (Regras.podeRegistrarExecucao(eu, a) ? ' Use “Registrar execução”.' : '')
        : 'Nenhuma execução até hoje.') + '</p>');

    /* Comentários gerais */
    preencher(registro, 'detQtdComentarios', String(d.comentarios.length));
    preencher(registro, 'detComentarios', listaComentariosHtml(d.comentarios, ctx, 'Nenhum comentário geral ainda.'));

    /* Evidências de todas as execuções, com o rótulo da execução. */
    var porId = {};
    d.ocorrencias.forEach(function (oc) { porId[oc.id] = oc; });
    preencher(registro, 'detQtdEvidencias', String(d.evidencias.length));
    preencher(registro, 'detEvidencias', listaEvidenciasHtml(d.evidencias, ctx, function (ev) {
      if (!ev.ocorrencia_id) { return '<span class="texto-suave">geral</span>'; }
      var oc = porId[ev.ocorrencia_id];
      return oc ? '<button type="button" class="link-botao" data-abrir-ocorrencia="' + U.esc(oc.id) + '">' +
        U.esc(Regras.rotuloReferencia(oc)) + '</button>' : '';
    }, 'Nenhum arquivo anexado nas execuções desta atividade.'));
  }

  function payloadAtividade(a, ativa) {
    return {
      id: a.id, ordem: a.ordem, titulo: a.titulo, descricao: a.descricao || '', setor_id: a.setor_id || null,
      tipo: a.tipo, periodicidade: a.periodicidade || null, dia_semana: a.dia_semana || null,
      dia_mes: a.dia_mes || null, mes_inicio: a.mes_inicio || null, prazo: a.prazo || null,
      antecipar_dia_util: a.antecipar_dia_util !== false, prioridade: a.prioridade || 'normal',
      exige_evidencia: !!a.exige_evidencia, ativa: ativa, data_inicio: a.data_inicio || null,
      responsaveis: (a.responsaveis || []).slice()
    };
  }

  function arquivarOuReativar(registro, ativa, botao) {
    var a = registro.dados && registro.dados.atividade;
    if (!a) { return; }
    var pergunta = ativa
      ? 'Reativar a atividade "' + a.titulo + '"?\n\nEla volta a gerar ocorrências conforme a regra e a aparecer nas listas de trabalho.'
      : 'Arquivar a atividade "' + a.titulo + '"?\n\nEla deixa de gerar novas ocorrências e sai das listas de trabalho. ' +
        'As ocorrências futuras ainda pendentes (sem evidências nem comentários) são removidas; o histórico é mantido. ' +
        'Você pode reativá-la depois.';
    if (!U.confirmar(pergunta)) { return; }
    botao.disabled = true;
    Api.salvarAtividade(payloadAtividade(a, ativa)).then(function () {
      U.torrada(ativa ? 'Atividade reativada.' : 'Atividade arquivada.', 'sucesso');
      App.recarregar(['atividades', 'ocorrencias']);
    }).catch(function (erro) {
      U.falha(erro);
      if (document.body.contains(botao)) { botao.disabled = false; }
    });
  }

  function excluirAtividade(registro, botao) {
    var d = registro.dados;
    if (!d) { return; }
    var a = d.atividade;
    var totalComentarios = d.comentarios.length + d.ocorrencias.reduce(function (soma, oc) {
      return soma + (Number(oc.qtd_comentarios) || 0);
    }, 0);
    if (!U.confirmar('Excluir DEFINITIVAMENTE a atividade "' + a.titulo + '"?\n\n' +
        'Isso apaga também tudo o que pertence a ela:\n' +
        '• ' + plural(d.ocorrencias.length, 'ocorrência (execução)', 'ocorrências (execuções)') + '\n' +
        '• ' + plural(d.evidencias.length, 'evidência (arquivo)', 'evidências (arquivos)') + '\n' +
        '• ' + plural(totalComentarios, 'comentário', 'comentários') + '\n\n' +
        'Não há como desfazer. Se a intenção é só parar de cobrar, use "Arquivar".')) { return; }
    botao.disabled = true;
    Api.excluirAtividade(a.id).then(function () {
      U.torrada('Atividade excluída.', 'sucesso');
      if (vigente(registro)) { U.fecharPainel(); }
      App.recarregar(['atividades', 'ocorrencias', 'evidencias', 'comentarios']);
    }).catch(function (erro) {
      U.falha(erro);
      if (document.body.contains(botao)) { botao.disabled = false; }
    });
  }

  function editarAtividade(registro) {
    var a = registro.dados && registro.dados.atividade;
    if (!a) { return; }
    if (typeof FormAtividade === 'undefined' || !FormAtividade || typeof FormAtividade.abrir !== 'function') {
      U.torrada('O formulário de atividades não carregou. Recarregue a página.', 'erro');
      return;
    }
    /* Salvou, arquivou ou cancelou: volta para o detalhe da atividade. */
    FormAtividade.abrir(a, null, {
      voltar: function (id) { if (id) { abrirAtividade(id); } }
    });
  }

  /* Formulário "Registrar execução": já executada (concluída, data até
     hoje) ou a fazer (pendente, com prazo). */
  function ligarExecucao(registro) {
    var form = regiao(registro, 'detExecucaoForm');
    var campoData = regiao(registro, 'detExecucaoData');
    var rotuloData = regiao(registro, 'detExecucaoDataRotulo');
    var erroData = regiao(registro, 'detExecucaoDataErro');
    var botao = regiao(registro, 'detExecucaoSalvar');

    function situacaoEscolhida() {
      var marcado = U.$('input[name="detExecucaoSituacao"]:checked', form);
      return marcado ? marcado.value : 'concluida';
    }

    function ajustarData() {
      var hoje = U.hojeBelem();
      if (situacaoEscolhida() === 'concluida') {
        rotuloData.innerHTML = 'Data da execução <span class="obrigatorio">*</span>';
        campoData.max = hoje;
        campoData.removeAttribute('min');
        if (campoData.value > hoje) { campoData.value = hoje; }
      } else {
        rotuloData.innerHTML = 'Prazo <span class="obrigatorio">*</span>';
        campoData.removeAttribute('max');
      }
    }

    U.$$('input[name="detExecucaoSituacao"]', form).forEach(function (r) { r.addEventListener('change', ajustarData); });

    form.addEventListener('submit', function (evento) {
      evento.preventDefault();
      var a = registro.dados && registro.dados.atividade;
      if (!a) { return; }
      var status = situacaoEscolhida();
      var data = campoData.value;
      var hoje = U.hojeBelem();
      var problema = null;
      if (!data || !Recorrencia.dataValida(data)) { problema = 'Informe uma data válida.'; }
      else if (status === 'concluida' && data > hoje) { problema = 'A data da execução não pode estar no futuro.'; }
      erroData.textContent = problema || '';
      campoData.closest('.campo').classList.toggle('campo--invalido', !!problema);
      if (problema) { campoData.focus(); return; }

      var titulo = regiao(registro, 'detExecucaoTitulo').value.trim();
      var observacao = regiao(registro, 'detExecucaoObservacao').value;
      botao.disabled = true;
      botao.setAttribute('aria-busy', 'true');
      Api.criarOcorrencia({
        atividade_id: a.id, titulo_execucao: titulo || null, prazo: data, status: status, observacao: observacao
      }).then(function (nova) {
        U.torrada(status === 'concluida' ? 'Execução registrada. Agora anexe as evidências.' : 'Execução registrada como pendente.', 'sucesso');
        if (nova && nova.id) { abrirOcorrencia(nova.id); }
        App.recarregar(['ocorrencias']);
      }).catch(function (erro) {
        U.falha(erro);
        if (document.body.contains(botao)) { botao.disabled = false; botao.removeAttribute('aria-busy'); }
      });
    });
  }

  function ligarAtividade(registro) {
    var painel = registro.painel;
    painel.addEventListener('click', function (evento) {
      var alvo = evento.target;
      if (!alvo || !alvo.closest) { return; }
      var acao = alvo.closest('[data-det-acao]');
      if (acao) {
        var qual = acao.getAttribute('data-det-acao');
        if (!registro.montado) { return; }
        if (qual === 'editar') {
          editarAtividade(registro);
        } else if (qual === 'registrar') {
          var form = regiao(registro, 'detExecucaoForm');
          form.classList.remove('oculto');
          var campo = regiao(registro, 'detExecucaoTitulo');
          try { form.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* navegador antigo */ }
          campo.focus({ preventScroll: true });
        } else if (qual === 'cancelar-execucao') {
          regiao(registro, 'detExecucaoForm').classList.add('oculto');
        } else if (qual === 'arquivar') {
          arquivarOuReativar(registro, false, acao);
        } else if (qual === 'reativar') {
          arquivarOuReativar(registro, true, acao);
        } else if (qual === 'excluir-atividade') {
          excluirAtividade(registro, acao);
        } else if (qual === 'historico-completo') {
          registro.historicoCompleto = true;
          if (registro.dados) { atualizarAtividade(registro); }
        }
        return;
      }
      if (!registro.montado) { return; }
      var abrirOc = alvo.closest('[data-abrir-ocorrencia]');
      if (abrirOc) { abrirOcorrencia(abrirOc.getAttribute('data-abrir-ocorrencia')); return; }
      var abrirEv = alvo.closest('[data-abrir-evidencia]');
      if (abrirEv) { abrirEvidencia(registro, abrirEv); return; }
      var excluirEv = alvo.closest('[data-excluir-evidencia]');
      if (excluirEv) { excluirEvidencia(registro, excluirEv); return; }
      var excluirCom = alvo.closest('[data-excluir-comentario]');
      if (excluirCom) { excluirComentario(excluirCom); }
    });

    ligarExecucao(registro);
    ligarComentario(registro, function () {
      return { atividade_id: registro.dados.atividade.id, ocorrencia_id: null };
    });
  }

  return {
    abrirOcorrencia: abrirOcorrencia,
    abrirAtividade: abrirAtividade,
    /* peças compartilhadas com Início e Quadro (extensão do contrato) */
    cartaoMissaoHtml: cartaoMissaoHtml,
    acaoRapida: acaoRapida,
    tratarClique: tratarClique,
    compararAbertas: compararAbertas,
    seloPrazo: seloPrazo,
    chipsResponsaveis: chipsResponsaveis
  };
})();
