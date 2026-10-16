/* =========================================================================
   HABE – AQS e NSP — Avisos
   O mural da chefia: comunicados para toda a equipe ou para militares
   escolhidos, com nível (informativo, importante, urgente), prazo opcional,
   atividade vinculada e "ciência" de cada destinatário.

   Todos veem os avisos dirigidos a eles e dão ciência ("Ciente"). Os
   gestores (chefia ou conta institucional) publicam, editam e excluem,
   acompanham quem ainda não deu ciência e podem transformar um aviso numa
   missão pontual (FormAtividade). Abas: Ativos | Expirados (expira_em
   anterior a hoje). Os fixados vêm primeiro; o urgente aparece em destaque.

   As permissões vêm de Regras (espelho da RLS de avisos): aqui só
   escondem botões — quem barra de verdade é o banco.
   Ver docs/ARQUITETURA.md, seções 3, 5 e 6.
   ========================================================================= */

Paginas.avisos = (function () {
  'use strict';

  var TABELAS = ['avisos', 'avisos_ciencia', 'avisos_destinatarios', 'militares', 'atividades'];
  var MAX_TITULO = 200;
  var MAX_MENSAGEM = 10000; /* igual ao check do banco */
  var NIVEIS = [
    { valor: 'informativo', texto: 'Para conhecimento da equipe.' },
    { valor: 'importante', texto: 'Pede atenção: algo muda na rotina ou há prazo.' },
    { valor: 'urgente', texto: 'Exige ação imediata. Aparece em destaque, no topo.' }
  ];
  var PESO_NIVEL = { urgente: 0, importante: 1, informativo: 2 };
  var ID_VALIDO = /^[0-9A-Za-z_-]{1,64}$/;

  var geracao = 0;
  var carga = 0;
  var aba = 'ativos';
  /* Últimos dados: { avisos, ref, atividades, mapaAtividades, hoje, eu } */
  var dados = null;
  var seqFormulario = 0;

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

  function achar(lista, teste) {
    for (var i = 0; i < (lista || []).length; i += 1) { if (teste(lista[i])) { return lista[i]; } }
    return null;
  }

  function plural(n, singular, varios) {
    return n + ' ' + (n === 1 ? singular : varios);
  }

  function juntarNomes(nomes) {
    if (nomes.length <= 1) { return nomes.join(''); }
    return nomes.slice(0, -1).join(', ') + ' e ' + nomes[nomes.length - 1];
  }

  function vigente(el, minhaGeracao, minhaCarga) {
    return minhaGeracao === geracao && (minhaCarga === undefined || minhaCarga === carga) &&
      !!App.militar() && !el.classList.contains('oculto') && !!U.$('.pagina-avisos', el);
  }

  function nivelValido(nivel) {
    return temPropria(PESO_NIVEL, nivel) ? nivel : 'informativo';
  }

  function expirado(av, hoje) {
    return !!av.expira_em && String(av.expira_em).slice(0, 10) < hoje;
  }

  /* Autor: o cadastro atual, se ainda existir; senão o nome gravado no
     aviso (o militar foi excluído depois). */
  function autorDe(av, mapa) {
    var m = av.criado_por && temPropria(mapa, av.criado_por) ? mapa[av.criado_por] : null;
    if (m) { return { nome: Regras.nomeMilitar(m), papel: m.papel }; }
    return { nome: String(av.criado_por_nome || '').trim() || '(militar excluído)', papel: null };
  }

  function seloPapelAutor(papel) {
    var rotulo = Regras.rotuloPapelAutor ? Regras.rotuloPapelAutor(papel)
      : (papel === 'chefia' ? 'CHEFIA' : (papel === 'administrador' ? 'AQS' : ''));
    if (!rotulo) { return ''; }
    return ' <span class="selo selo--pequeno ' + (papel === 'administrador' ? 'selo--aqs' : 'selo--chefia') + '">' +
      U.esc(rotulo) + '</span>';
  }

  /* Quem deve dar ciência: os destinatários ativos (para todos = a equipe
     ativa, sem a conta institucional), menos o próprio autor. */
  function publicoDoAviso(av, militares) {
    return (militares || []).filter(function (m) {
      if (!m || m.ativo === false || m.id === av.criado_por) { return false; }
      if (av.para_todos) { return m.papel !== 'administrador'; }
      return contem(av.destinatarios, m.id);
    }).sort(function (a, b) { return U.ordenarTexto(Regras.nomeMilitar(a), Regras.nomeMilitar(b)); });
  }

  function ordenar(lista) {
    return lista.slice().sort(function (a, b) {
      if (!!a.fixado !== !!b.fixado) { return a.fixado ? -1 : 1; }
      var pa = PESO_NIVEL[nivelValido(a.nivel)], pb = PESO_NIVEL[nivelValido(b.nivel)];
      if (pa !== pb) { return pa - pb; }
      return String(b.criado_em || '') < String(a.criado_em || '') ? -1 : (String(b.criado_em || '') > String(a.criado_em || '') ? 1 : 0);
    });
  }

  /* Aviso que pede a MINHA ciência (mesma regra do contador do App). */
  function pedeMinhaCiencia(av, eu) {
    if (av.criado_por && av.criado_por === eu.id) { return false; }
    return !!av.para_todos || contem(av.destinatarios, eu.id);
  }

  /* ---------- página ---------- */

  function render(el, params) {
    geracao += 1;
    dados = null;
    if (params && (params.aba === 'expirados' || params.aba === 'ativos')) { aba = params.aba; }
    var eu = App.militar();
    var gestor = Regras.podePublicarAviso(eu);
    el.innerHTML = '<div class="pagina-avisos">' +
      '<div class="pagina__cabecalho pagina__cabecalho--acoes">' +
        '<div><h1>Avisos</h1><p>Comunicados da chefia e da AQS para a equipe. Ao ler, registre a sua ciência.</p></div>' +
        (gestor ? '<div class="acoes acoes--topo"><button type="button" class="botao" data-acao="novo">+ Novo aviso</button></div>' : '') +
      '</div>' +
      '<div class="abas" role="group" aria-label="Avisos ativos ou expirados">' +
        '<button type="button" class="aba" data-aba="ativos">Ativos <span class="contador contador--neutro" data-contagem="ativos">0</span></button>' +
        '<button type="button" class="aba" data-aba="expirados">Expirados <span class="contador contador--neutro" data-contagem="expirados">0</span></button>' +
      '</div>' +
      '<div id="avsResumo"></div>' +
      '<div id="avsLista"><div class="carregando" role="status">Carregando os avisos…</div></div>' +
    '</div>';
    marcarAba(el);
    ligar(el);
    carregar(el);
  }

  function aoVivo(el, params, tabelas) {
    if (Array.isArray(tabelas) && !tabelas.some(function (t) { return contem(TABELAS, t); })) { return; }
    if (!U.$('.pagina-avisos', el)) { render(el, params); return; }
    carregar(el);
  }

  function marcarAba(el) {
    U.$$('[data-aba]', el).forEach(function (b) {
      var ativa = b.getAttribute('data-aba') === aba;
      b.classList.toggle('aba--ativa', ativa);
      b.setAttribute('aria-pressed', ativa ? 'true' : 'false');
    });
  }

  function carregar(el) {
    var minhaGeracao = geracao;
    var minhaCarga = ++carga;
    Promise.all([
      Api.listarAvisos({ incluirExpirados: true }),
      Api.referencias(),
      Api.listarAtividades()
    ]).then(function (r) {
      if (!vigente(el, minhaGeracao, minhaCarga)) { return; }
      var mapaAtividades = {};
      (r[2] || []).forEach(function (a) { mapaAtividades[a.id] = a; });
      dados = {
        avisos: r[0] || [],
        ref: r[1],
        atividades: r[2] || [],
        mapaAtividades: mapaAtividades,
        hoje: U.hojeBelem(),
        eu: App.militar()
      };
      desenhar(el);
    }).catch(function (erro) {
      if (!vigente(el, minhaGeracao, minhaCarga)) { return; }
      U.falha(erro);
      if (dados) { return; }
      U.$('#avsLista', el).innerHTML = '<div class="aviso aviso--urgente" role="alert"><span class="aviso__icone">' +
        icone('alerta') + '</span><div><strong>Não foi possível carregar os avisos</strong>' + U.esc(U.erroTexto(erro)) +
        '</div></div><div class="acoes"><button type="button" class="botao botao--secundario" data-acao="tentar">' +
        'Tentar novamente</button></div>';
    });
  }

  /* ---------- cartão do aviso ---------- */

  function cienciaHtml(av, d) {
    var eu = d.eu;
    if (av.criado_por && av.criado_por === eu.id) {
      return '<span class="texto-suave texto-pequeno">Você publicou este aviso.</span>';
    }
    if (!pedeMinhaCiencia(av, eu)) {
      return '<span class="texto-suave texto-pequeno">Não é dirigido a você.</span>';
    }
    if (av.ciente_por_mim) {
      var minha = achar(av.ciencias, function (c) { return c.militar_id === eu.id; });
      return '<span class="ciente-registrado">' + icone('check') + 'Ciente' +
        (minha && minha.ciente_em ? ' em ' + U.esc(U.formatarDataHora(minha.ciente_em)) : '') + '</span>';
    }
    return '<button type="button" class="botao botao--sucesso" data-acao="ciente" data-id="' + U.esc(av.id) + '">' +
      icone('check') + 'Ciente</button>';
  }

  /* Acompanhamento da ciência (gestores): x de y, quem falta e quem já deu. */
  function acompanhamentoHtml(av, d) {
    var mapa = d.ref.mapaMilitares || {};
    var publico = publicoDoAviso(av, d.ref.militares);
    var cientes = {};
    (av.ciencias || []).forEach(function (c) { cientes[c.militar_id] = c.ciente_em; });
    var feitos = publico.filter(function (m) { return temPropria(cientes, m.id); });
    var faltam = publico.filter(function (m) { return !temPropria(cientes, m.id); });
    var pct = publico.length ? Math.round(100 * feitos.length / publico.length) : 0;
    var classeBarra = pct >= 100 ? ' barra-progresso__preenchimento--sucesso' : (pct < 50 ? ' barra-progresso__preenchimento--atencao' : '');

    var faltamHtml = '';
    if (!publico.length) {
      faltamHtml = '<p class="texto-pequeno texto-suave mb-0">Nenhum destinatário ativo.</p>';
    } else if (!faltam.length) {
      faltamHtml = '<p class="texto-pequeno texto-sucesso-gestao mb-0">' + icone('check') + 'Todos os destinatários deram ciência.</p>';
    } else {
      faltamHtml = '<p class="texto-pequeno mb-0"><strong>Faltam:</strong> ' + U.esc(juntarNomes(faltam.map(function (m) {
        return Regras.nomeMilitar(m) + (m.usuario_id ? '' : ' (sem acesso ao sistema)');
      }))) + '</p>';
    }

    /* Ciências de quem não está mais no público (excluído, desativado ou
       retirado dos destinatários) aparecem na lista, marcadas. */
    var todas = (av.ciencias || []).slice().sort(function (a, b) {
      return String(a.ciente_em || '') < String(b.ciente_em || '') ? -1 : 1;
    });
    var quemDeu = todas.length
      ? '<details class="detalhes-gestao"><summary>Quem já deu ciência (' + todas.length + ')</summary><ul class="lista-simples">' +
          todas.map(function (c) {
            var m = temPropria(mapa, c.militar_id) ? mapa[c.militar_id] : null;
            var foraDoPublico = !achar(publico, function (x) { return x.id === c.militar_id; });
            return '<li><strong>' + U.esc(m ? Regras.nomeMilitar(m) : '(militar excluído)') + '</strong> — ' +
              U.esc(U.formatarDataHora(c.ciente_em)) + (foraDoPublico ? ' <span class="texto-suave">(fora da lista atual)</span>' : '') + '</li>';
          }).join('') + '</ul></details>'
      : '';

    return '<div class="ciencia-resumo">' +
      '<div class="ciencia-resumo__topo"><strong>Ciência: ' + feitos.length + ' de ' + publico.length + '</strong>' +
        '<span class="texto-suave texto-pequeno">' + (publico.length ? pct + '%' : '—') + '</span></div>' +
      '<div class="barra-progresso"><div class="barra-progresso__preenchimento' + classeBarra + '" data-largura="' + pct + '"></div></div>' +
      faltamHtml + quemDeu +
    '</div>';
  }

  function avisoHtml(av, d) {
    var eu = d.eu;
    var gestor = Regras.podePublicarAviso(eu);
    var nivel = nivelValido(av.nivel);
    var venceu = expirado(av, d.hoje);
    var pendente = !venceu && pedeMinhaCiencia(av, eu) && !av.ciente_por_mim;
    var autor = autorDe(av, d.ref.mapaMilitares || {});
    var atividade = av.atividade_id && temPropria(d.mapaAtividades, av.atividade_id) ? d.mapaAtividades[av.atividade_id] : null;

    var destinatarios = av.para_todos ? 'Toda a equipe' : juntarNomes((av.destinatarios || []).map(function (id) {
      return temPropria(d.ref.mapaMilitares, id) ? Regras.nomeMilitar(d.ref.mapaMilitares[id]) : '(militar excluído)';
    })) || '—';

    var dadosLista = [];
    if (av.prazo) {
      var dias = U.diasEntre(d.hoje, av.prazo);
      dadosLista.push('<div><dt>Prazo</dt><dd><strong' + (dias < 0 ? ' class="texto-urgente-gestao"' : '') + '>' +
        U.esc(U.formatarData(av.prazo)) + '</strong> <span class="texto-suave">· ' + U.esc(U.descreverPrazo(av.prazo, d.hoje)) + '</span></dd></div>');
    }
    if (atividade) {
      dadosLista.push('<div><dt>Atividade</dt><dd><a href="#/avisos?atividade=' + encodeURIComponent(atividade.id) + '">' +
        U.esc((atividade.ordem ? atividade.ordem + '. ' : '') + atividade.titulo) + '</a></dd></div>');
    }
    dadosLista.push('<div><dt>Para</dt><dd>' + U.esc(destinatarios) + '</dd></div>');
    if (av.expira_em) {
      dadosLista.push('<div><dt>' + (venceu ? 'Expirou em' : 'Expira em') + '</dt><dd>' + U.esc(U.formatarData(av.expira_em)) + '</dd></div>');
    }

    var gestao = '';
    if (gestor) {
      gestao = '<div class="aviso-cartao__gestao">' + acompanhamentoHtml(av, d) +
        '<div class="acoes acoes--compactas">' +
          '<button type="button" class="botao botao--secundario botao--pequeno" data-acao="editar" data-id="' + U.esc(av.id) + '">Editar</button>' +
          (Regras.podeCriarAtividade(eu, 'pontual')
            ? '<button type="button" class="botao botao--secundario botao--pequeno" data-acao="missao" data-id="' + U.esc(av.id) + '">' +
                icone('missao') + 'Criar missão a partir deste aviso</button>' : '') +
          '<button type="button" class="botao botao--perigo-secundario botao--pequeno" data-acao="excluir" data-id="' + U.esc(av.id) + '">Excluir</button>' +
        '</div>' +
      '</div>';
    }

    return '<article class="aviso-cartao aviso-cartao--' + nivel + (av.fixado ? ' aviso-cartao--fixado' : '') +
        (pendente ? ' aviso-cartao--pendente' : '') + (venceu ? ' aviso-cartao--expirado' : '') + '">' +
      '<header class="aviso-cartao__topo">' +
        '<div class="aviso-cartao__selos">' + Regras.seloNivel(nivel) +
          (av.fixado ? '<span class="selo selo--neutro" title="Fixado no topo">📌 Fixado</span>' : '') +
          (venceu ? '<span class="selo selo--neutro">Expirado</span>' : '') +
          (pendente ? '<span class="selo selo--atencao">Aguardando a sua ciência</span>' : '') +
        '</div>' +
        '<h2 class="aviso-cartao__titulo">' + U.esc(av.titulo) + '</h2>' +
      '</header>' +
      (String(av.mensagem || '').trim() ? '<div class="aviso-cartao__mensagem">' + U.escMultilinha(av.mensagem) + '</div>' : '') +
      '<dl class="aviso-cartao__dados">' + dadosLista.join('') + '</dl>' +
      '<footer class="aviso-cartao__rodape">' +
        '<span class="aviso-cartao__autor">Por <strong>' + U.esc(autor.nome) + '</strong>' + seloPapelAutor(autor.papel) +
          ' · <time datetime="' + U.esc(av.criado_em) + '">' + U.esc(U.formatarDataHora(av.criado_em)) + '</time></span>' +
        '<span class="aviso-cartao__ciencia">' + cienciaHtml(av, d) + '</span>' +
      '</footer>' +
      gestao +
    '</article>';
  }

  /* ---------- desenho ---------- */

  function desenhar(el) {
    if (!dados) { return; }
    var d = dados;
    var ativos = ordenar(d.avisos.filter(function (av) { return !expirado(av, d.hoje); }));
    var expirados = d.avisos.filter(function (av) { return expirado(av, d.hoje); }).sort(function (a, b) {
      return String(b.expira_em) < String(a.expira_em) ? -1 : (String(b.expira_em) > String(a.expira_em) ? 1 : 0);
    });
    var contagemAtivos = U.$('[data-contagem="ativos"]', el);
    var contagemExpirados = U.$('[data-contagem="expirados"]', el);
    if (contagemAtivos) { contagemAtivos.textContent = String(ativos.length); }
    if (contagemExpirados) { contagemExpirados.textContent = String(expirados.length); }

    var pendentes = ativos.filter(function (av) { return pedeMinhaCiencia(av, d.eu) && !av.ciente_por_mim; }).length;
    U.$('#avsResumo', el).innerHTML = (aba === 'ativos' && pendentes)
      ? '<div class="aviso aviso--atencao"><span class="aviso__icone">' + icone('avisos') + '</span><div>' +
          '<strong>' + U.esc(plural(pendentes, 'aviso aguarda', 'avisos aguardam')) + ' a sua ciência</strong>' +
          'Leia e toque em "Ciente" em cada um.</div></div>'
      : '';

    var lista = aba === 'ativos' ? ativos : expirados;
    var caixa = U.$('#avsLista', el);
    if (!lista.length) {
      var gestor = Regras.podePublicarAviso(d.eu);
      caixa.innerHTML = '<div class="vazio"><span class="vazio__icone">' + icone(aba === 'ativos' ? 'avisos' : 'caixa') + '</span>' +
        '<strong>' + (aba === 'ativos' ? 'Nenhum aviso ativo' : 'Nenhum aviso expirado') + '</strong>' +
        '<p>' + (aba === 'ativos'
          ? (gestor ? 'Publique um aviso para comunicar algo à equipe e acompanhar quem deu ciência.'
            : 'Quando a chefia ou a AQS publicar um comunicado, ele aparece aqui.')
          : 'Os avisos com data de expiração vencida ficam guardados aqui.') + '</p>' +
        (aba === 'ativos' && gestor ? '<button type="button" class="botao" data-acao="novo">+ Novo aviso</button>' : '') +
      '</div>';
      return;
    }
    caixa.innerHTML = '<div class="lista-avisos">' + lista.map(function (av) { return avisoHtml(av, d); }).join('') + '</div>';
    U.aplicarLarguras(caixa);
  }

  /* ---------- ações ---------- */

  function avisoPorId(id) {
    return dados ? achar(dados.avisos, function (av) { return av.id === id; }) : null;
  }

  function darCiencia(botao, id) {
    botao.disabled = true;
    botao.setAttribute('aria-busy', 'true');
    Api.darCiencia(id).then(function () {
      U.torrada('Ciência registrada.', 'sucesso');
      App.recarregar(['avisos_ciencia']);
    }).catch(function (erro) {
      U.falha(erro);
      if (document.body.contains(botao)) { botao.disabled = false; botao.removeAttribute('aria-busy'); }
    });
  }

  function excluir(botao, av) {
    var qtd = (av.ciencias || []).length;
    if (!U.confirmar('Excluir o aviso "' + av.titulo + '"?\n\nEle some para toda a equipe' +
        (qtd ? ', junto com o registro de ciência (' + plural(qtd, 'militar', 'militares') + ')' : '') +
        '. Não há como desfazer.\n\nSe a intenção é só tirá-lo da lista, edite e defina uma data de expiração.')) { return; }
    botao.disabled = true;
    Api.excluirAviso(av.id).then(function () {
      U.torrada('Aviso excluído.', 'sucesso');
      App.recarregar(['avisos', 'avisos_ciencia', 'avisos_destinatarios']);
    }).catch(function (erro) {
      U.falha(erro);
      if (document.body.contains(botao)) { botao.disabled = false; }
    });
  }

  function criarMissao(av) {
    if (typeof FormAtividade === 'undefined' || !FormAtividade || typeof FormAtividade.abrir !== 'function') {
      U.torrada('O formulário de atividades não carregou. Recarregue a página.', 'erro');
      return;
    }
    var prioridade = av.nivel === 'urgente' ? 'urgente' : (av.nivel === 'importante' ? 'alta' : 'normal');
    var iniciais = {
      tipo: 'pontual',
      titulo: String(av.titulo || '').slice(0, 200),
      descricao: String(av.mensagem || ''),
      prazo: av.prazo || null,
      prioridade: prioridade
    };
    /* Aviso dirigido: quem o recebeu já vem marcado como responsável. */
    if (!av.para_todos && dados) {
      var atribuiveis = {};
      Regras.militaresAtribuiveis(dados.ref.militares).forEach(function (m) { atribuiveis[m.id] = true; });
      iniciais.responsaveis = (av.destinatarios || []).filter(function (id) { return atribuiveis[id]; });
    }
    FormAtividade.abrir(null, iniciais);
  }

  function ligar(el) {
    var raiz = U.$('.pagina-avisos', el);
    raiz.addEventListener('click', function (evento) {
      var alvo = evento.target;
      if (!alvo || !alvo.closest) { return; }
      var botaoAba = alvo.closest('[data-aba]');
      if (botaoAba) {
        aba = botaoAba.getAttribute('data-aba') === 'expirados' ? 'expirados' : 'ativos';
        marcarAba(el);
        desenhar(el);
        return;
      }
      var acao = alvo.closest('[data-acao]');
      if (!acao) { return; }
      var qual = acao.getAttribute('data-acao');
      var id = acao.getAttribute('data-id');
      if (qual === 'novo') { abrirFormulario(null); return; }
      if (qual === 'tentar') {
        U.$('#avsLista', el).innerHTML = '<div class="carregando" role="status">Carregando…</div>';
        carregar(el);
        return;
      }
      if (!id || !ID_VALIDO.test(id)) { return; }
      var av = avisoPorId(id);
      if (qual === 'ciente') { darCiencia(acao, id); return; }
      if (!av) { U.torrada('Este aviso não existe mais. Atualize a página.', 'atencao'); return; }
      if (qual === 'editar') { abrirFormulario(av); }
      else if (qual === 'excluir') { excluir(acao, av); }
      else if (qual === 'missao') { criarMissao(av); }
    });
  }

  /* ---------- formulário (painel) ---------- */

  function campoHtml(id, rotuloHtml, controleHtml, dicaHtml) {
    return '<div class="campo" id="' + id + 'Campo">' +
      '<label for="' + id + '">' + rotuloHtml + '</label>' + controleHtml +
      (dicaHtml !== null ? '<span class="campo__dica" id="' + id + 'Dica">' + dicaHtml + '</span>' : '') +
      '<div class="campo__erro" id="' + id + 'Erro" role="alert"></div>' +
    '</div>';
  }

  function formularioHtml(av, ref, atividades, eu) {
    var nivel = av ? nivelValido(av.nivel) : 'informativo';
    var paraTodos = av ? av.para_todos !== false : true;
    var destinatarios = av ? (av.destinatarios || []) : [];
    var militares = Regras.militaresAtribuiveis(ref.militares).slice();
    /* Destinatários já gravados que não estão mais na lista (desativados)
       continuam visíveis e marcados. */
    destinatarios.forEach(function (id) {
      if (!achar(militares, function (m) { return m.id === id; }) && temPropria(ref.mapaMilitares, id)) {
        militares.push(ref.mapaMilitares[id]);
      }
    });
    militares.sort(function (a, b) { return U.ordenarTexto(Regras.nomeMilitar(a), Regras.nomeMilitar(b)); });

    var opcoesAtividade = '<option value="">Nenhuma</option>' + atividades.filter(function (a) {
      return a.ativa !== false || (av && av.atividade_id === a.id);
    }).map(function (a) {
      return '<option value="' + U.esc(a.id) + '"' + (av && av.atividade_id === a.id ? ' selected' : '') + '>' +
        U.esc((a.ordem ? a.ordem + '. ' : '') + a.titulo + (a.ativa === false ? ' (arquivada)' : '')) + '</option>';
    }).join('');

    return '<form id="avForm" class="form-aviso" novalidate>' +
      campoHtml('avTitulo', 'Título <span class="obrigatorio">*</span>',
        '<input type="text" id="avTitulo" maxlength="' + MAX_TITULO + '" autocomplete="off" value="' + U.esc(av ? av.titulo : '') + '">', null) +
      campoHtml('avMensagem', 'Mensagem',
        '<textarea id="avMensagem" rows="5" maxlength="' + MAX_MENSAGEM + '">' + U.esc(av ? av.mensagem : '') + '</textarea>',
        '<span id="avMensagemContagem">0</span> de ' + MAX_MENSAGEM + ' caracteres.') +
      '<fieldset class="campo campo--grupo" id="avNivelCampo"><legend>Nível</legend>' +
        '<div class="opcoes opcoes--nivel">' + NIVEIS.map(function (n) {
          return '<label class="opcao opcao--nivel-' + n.valor + '"><input type="radio" name="avNivel" value="' + n.valor + '"' +
            (nivel === n.valor ? ' checked' : '') + '><span class="opcao__texto"><strong>' +
            U.esc(Regras.ROTULOS.nivel[n.valor]) + '</strong><small>' + U.esc(n.texto) + '</small></span></label>';
        }).join('') + '</div></fieldset>' +
      '<fieldset class="campo campo--grupo" id="avDestinatariosCampo"><legend>Destinatários</legend>' +
        '<div class="pilulas">' +
          '<label class="pilula"><input type="radio" name="avPara" value="todos"' + (paraTodos ? ' checked' : '') + '><span>Toda a equipe</span></label>' +
          '<label class="pilula"><input type="radio" name="avPara" value="escolhidos"' + (paraTodos ? '' : ' checked') + '><span>Militares escolhidos</span></label>' +
        '</div>' +
        '<div class="lista-marcar mt-1' + (paraTodos ? ' oculto' : '') + '" id="avListaDestinatarios">' +
          (militares.length ? militares.map(function (m) {
            return '<label class="marcar' + (m.ativo === false ? ' marcar--inativo' : '') + '">' +
              '<input type="checkbox" name="avDestinatario" value="' + U.esc(m.id) + '"' + (contem(destinatarios, m.id) ? ' checked' : '') + '>' +
              '<span class="marcar__texto"><strong>' + U.esc(Regras.nomeMilitar(m)) + (m.id === eu.id ? ' <em>(você)</em>' : '') + '</strong>' +
              '<small>' + U.esc((Regras.ROTULOS.papel[m.papel] || m.papel) + (m.ativo === false ? ' · desativado' : '') +
                (m.usuario_id ? '' : ' · sem acesso ao sistema')) + '</small></span></label>';
          }).join('') : '<p class="texto-suave texto-pequeno mb-0">Nenhum militar ativo cadastrado.</p>') +
        '</div>' +
        '<span class="campo__dica">"Toda a equipe" alcança todos os militares ativos, inclusive os cadastrados depois.</span>' +
        '<div class="campo__erro" id="avDestinatariosErro" role="alert"></div>' +
      '</fieldset>' +
      '<div class="grade-form">' +
        campoHtml('avPrazo', 'Prazo para a equipe', '<input type="date" id="avPrazo" value="' + U.esc(av && av.prazo ? av.prazo : '') + '">',
          'Opcional: até quando algo deve ser feito.') +
        campoHtml('avExpira', 'Expira em', '<input type="date" id="avExpira" value="' + U.esc(av && av.expira_em ? av.expira_em : '') + '">',
          'Opcional: depois desta data o aviso vai para "Expirados".') +
      '</div>' +
      campoHtml('avAtividade', 'Atividade vinculada', '<select id="avAtividade">' + opcoesAtividade + '</select>',
        'Opcional: o aviso mostra um atalho para o detalhe da atividade.') +
      '<label class="marcar marcar--linha"><input type="checkbox" id="avFixado"' + (av && av.fixado ? ' checked' : '') + '>' +
        '<span class="marcar__texto"><strong>Fixar no topo</strong><small>Aparece antes dos demais avisos até ser desafixado ou expirar.</small></span></label>' +
      (av ? '' : '<p class="texto-pequeno texto-suave">Ao publicar, os destinatários recebem uma notificação.</p>') +
      '<div id="avErroGeral"></div>' +
      '<div class="form-rodape">' +
        '<div class="form-rodape__lado"></div>' +
        '<div class="form-rodape__lado form-rodape__lado--direita">' +
          '<button type="button" class="botao botao--secundario" data-av-acao="cancelar">Cancelar</button>' +
          '<button type="submit" class="botao" id="avSalvar">' + (av ? 'Salvar alterações' : 'Publicar aviso') + '</button>' +
        '</div>' +
      '</div>' +
    '</form>';
  }

  function abrirFormulario(av) {
    var eu = App.militar();
    if (!Regras.podePublicarAviso(eu)) {
      U.torrada('Somente a chefia ou a AQS publicam avisos.', 'erro');
      return;
    }
    seqFormulario += 1;
    var meu = seqFormulario;
    var painel = null;
    U.abrirPainel(av ? 'Editar aviso' : 'Novo aviso', '<div class="carregando" role="status">Carregando…</div>',
      function (p) { painel = p; });
    App.aoAtualizarPainel(null);

    function valido() { return meu === seqFormulario && !!painel && document.body.contains(painel); }

    Promise.all([Api.referencias(), Api.listarAtividades()]).then(function (r) {
      if (!valido()) { return; }
      var corpo = U.$('.painel__corpo', painel);
      corpo.innerHTML = formularioHtml(av, r[0], r[1] || [], eu);
      ligarFormulario(painel, av, valido);
      if (!av && window.innerWidth >= 720) {
        var titulo = U.$('#avTitulo', painel);
        try { titulo.focus({ preventScroll: true }); } catch (e) { titulo.focus(); }
      }
    }).catch(function (erro) {
      if (!valido()) { return; }
      U.$('.painel__corpo', painel).innerHTML = '<div class="aviso aviso--urgente" role="alert"><span class="aviso__icone">' +
        icone('alerta') + '</span><div><strong>Não foi possível abrir o formulário</strong>' + U.esc(U.erroTexto(erro)) + '</div></div>';
    });
  }

  function ligarFormulario(painel, av, valido) {
    var form = U.$('#avForm', painel);
    var mensagem = U.$('#avMensagem', painel);
    var contagem = U.$('#avMensagemContagem', painel);
    var lista = U.$('#avListaDestinatarios', painel);
    var botao = U.$('#avSalvar', painel);
    var hoje = U.hojeBelem();
    var enviando = false;

    function atualizarContagem() { contagem.textContent = String(mensagem.value.length); }
    atualizarContagem();

    function paraTodos() {
      var marcado = U.$('input[name="avPara"]:checked', form);
      return !marcado || marcado.value === 'todos';
    }

    function erroCampo(id, texto) {
      var campo = U.$('#' + id + 'Campo', form);
      var caixa = U.$('#' + id + 'Erro', form);
      if (campo) { campo.classList.toggle('campo--invalido', !!texto); }
      if (caixa) { caixa.textContent = texto || ''; }
    }

    form.addEventListener('input', function (evento) {
      if (evento.target === mensagem) { atualizarContagem(); }
      var campo = evento.target.closest ? evento.target.closest('.campo') : null;
      if (campo && campo.classList.contains('campo--invalido')) {
        campo.classList.remove('campo--invalido');
        var caixa = U.$('.campo__erro', campo);
        if (caixa) { caixa.textContent = ''; }
      }
    });
    form.addEventListener('change', function (evento) {
      if (evento.target && evento.target.name === 'avPara') {
        lista.classList.toggle('oculto', paraTodos());
        erroCampo('avDestinatarios', '');
      }
      if (evento.target && evento.target.name === 'avDestinatario') { erroCampo('avDestinatarios', ''); }
    });
    form.addEventListener('click', function (evento) {
      var b = evento.target.closest ? evento.target.closest('[data-av-acao="cancelar"]') : null;
      if (b) { U.fecharPainel(); }
    });

    form.addEventListener('submit', function (evento) {
      evento.preventDefault();
      if (enviando) { return; }
      U.$('#avErroGeral', form).innerHTML = '';
      var titulo = U.$('#avTitulo', form).value.trim();
      var texto = mensagem.value;
      var nivelMarcado = U.$('input[name="avNivel"]:checked', form);
      var todos = paraTodos();
      var escolhidos = U.$$('input[name="avDestinatario"]:checked', form).map(function (c) { return c.value; });
      var prazo = U.$('#avPrazo', form).value || null;
      var expira = U.$('#avExpira', form).value || null;
      var erros = [];

      if (!titulo) { erros.push(['avTitulo', 'Informe o título do aviso.']); }
      else if (titulo.length > MAX_TITULO) { erros.push(['avTitulo', 'O título pode ter no máximo ' + MAX_TITULO + ' caracteres.']); }
      if (texto.length > MAX_MENSAGEM) { erros.push(['avMensagem', 'A mensagem pode ter no máximo ' + MAX_MENSAGEM + ' caracteres.']); }
      if (!todos && !escolhidos.length) { erros.push(['avDestinatarios', 'Escolha ao menos um militar, ou envie para toda a equipe.']); }
      if (prazo && !Recorrencia.dataValida(prazo)) { erros.push(['avPrazo', 'Informe uma data válida (ou deixe em branco).']); }
      if (expira && !Recorrencia.dataValida(expira)) { erros.push(['avExpira', 'Informe uma data válida (ou deixe em branco).']); }
      else if (expira && !av && expira < hoje) { erros.push(['avExpira', 'Escolha hoje ou uma data futura: o aviso já nasceria expirado.']); }

      ['avTitulo', 'avMensagem', 'avDestinatarios', 'avPrazo', 'avExpira'].forEach(function (id) { erroCampo(id, ''); });
      if (erros.length) {
        erros.forEach(function (e) { erroCampo(e[0], e[1]); });
        var primeiro = U.$('#' + erros[0][0] + 'Campo', form);
        if (primeiro) {
          try { primeiro.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e2) { /* navegador antigo */ }
          var foco = U.$('input, textarea, select', primeiro);
          if (foco) { try { foco.focus({ preventScroll: true }); } catch (e3) { foco.focus(); } }
        }
        return;
      }
      if (av && expira && expira < hoje && !(av.expira_em && av.expira_em < hoje) &&
          !U.confirmar('Com esta data de expiração o aviso sai da lista de ativos e vai para "Expirados". Continuar?')) { return; }

      var dadosAviso = {
        titulo: titulo,
        mensagem: texto,
        nivel: nivelMarcado ? nivelMarcado.value : 'informativo',
        para_todos: todos,
        destinatarios: todos ? [] : escolhidos,
        prazo: prazo,
        atividade_id: U.$('#avAtividade', form).value || null,
        fixado: !!U.$('#avFixado', form).checked,
        expira_em: expira
      };
      if (av) { dadosAviso.id = av.id; }

      enviando = true;
      botao.disabled = true;
      botao.setAttribute('aria-busy', 'true');
      Api.salvarAviso(dadosAviso).then(function () {
        enviando = false;
        U.torrada(av ? 'Aviso atualizado.' : 'Aviso publicado. Os destinatários foram notificados.', 'sucesso');
        if (valido()) { U.fecharPainel(); }
        App.recarregar(['avisos', 'avisos_destinatarios']);
      }).catch(function (erro) {
        enviando = false;
        if (!valido()) { U.falha(erro); return; }
        botao.disabled = false;
        botao.removeAttribute('aria-busy');
        U.$('#avErroGeral', form).innerHTML = '<div class="aviso aviso--urgente mt-2" role="alert"><span class="aviso__icone">' +
          icone('alerta') + '</span><div><strong>Não foi possível salvar</strong>' + U.esc(U.erroTexto(erro)) + '</div></div>';
      });
    });
  }

  return {
    titulo: 'Avisos',
    render: render,
    aoVivo: aoVivo
  };
})();
