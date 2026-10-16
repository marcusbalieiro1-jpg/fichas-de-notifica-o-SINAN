/* =========================================================================
   HABE – AQS e NSP — Equipe
   Abas (a aba vem no endereço: #/equipe?aba=militares|chefia|setores|
   feriados|continuidade|auditoria):
   * Militares — todos veem a equipe; os gestores incluem, alteram
     (inclusive o papel), desativam e EXCLUEM qualquer militar, inclusive a
     chefia, e administram o acesso (criar, redefinir senha, desativar,
     reativar, remover o segundo fator, trocar o e-mail de login).
   * Passagem de chefia — assistente em quatro passos (quem sai, quem
     assume, o que acontece com quem sai, confirmar).
   * Setores, Feriados, Continuidade e Auditoria — só gestores.

   Continuidade é a razão de existir desta página: a ferramenta precisa
   continuar administrável quando chefes, adjuntos ou o responsável técnico
   saírem do HABE. Por isso: a conta institucional (papel administrador,
   e-mail institucional da AQS) só é mexida por outro administrador; a
   trava anti-bloqueio do banco impede ficar sem gestor com acesso (a tela
   explica o erro em vez de só mostrá-lo); excluir alguém preserva o
   histórico (nomes gravados nos registros) e a tela oferece passar as
   missões dele para outro militar ANTES; e a aba Continuidade junta os
   contatos institucionais, a cópia de segurança, os gestores com acesso e
   o roteiro de docs/CONTINUIDADE.md.

   Segurança: a senha temporária aparece UMA vez, escrita por textContent
   no painel, e não é guardada em variável, armazenamento nem console.
   As permissões vêm de Regras (espelho da RLS e da Edge Function
   admin-usuarios): a tela só esconde; quem barra de verdade é o servidor.
   Ver docs/ARQUITETURA.md, "Papéis e continuidade" e seções 3, 5 e 6.
   ========================================================================= */

Paginas.equipe = (function () {
  'use strict';

  var ABAS = [
    { valor: 'militares', rotulo: 'Militares', icone: 'equipe', gestor: false },
    { valor: 'chefia', rotulo: 'Passagem de chefia', icone: 'escudo', gestor: true },
    { valor: 'setores', rotulo: 'Setores', icone: 'quadro', gestor: true },
    { valor: 'feriados', rotulo: 'Feriados', icone: 'plano', gestor: true },
    { valor: 'continuidade', rotulo: 'Continuidade', icone: 'chave', gestor: true },
    { valor: 'auditoria', rotulo: 'Auditoria', icone: 'relatorios', gestor: true }
  ];
  var SINONIMOS_ABA = { passagem: 'chefia', 'passagem-de-chefia': 'chefia' };
  /* Mudanças que pedem redesenhar cada aba (a auditoria tem botão próprio
     de atualizar: ela muda a cada gravação e redesenhar sempre cansaria). */
  var TABELAS_DA_ABA = {
    militares: ['militares', 'setores', 'atividades', 'atividade_responsaveis'],
    chefia: ['militares', 'setores', 'atividades', 'atividade_responsaveis'],
    setores: ['setores', 'militares', 'atividades'],
    feriados: ['feriados'],
    continuidade: ['configuracoes', 'militares', 'atividades', 'atividade_responsaveis', 'feriados'],
    auditoria: []
  };
  var POSTOS = ['Ten Brig', 'Maj Brig', 'Brig', 'Cel', 'Ten Cel', 'Maj', 'Cap', '1º Ten', '2º Ten', 'Ten', 'Asp',
    'SO', '1S', '2S', '3S', 'Cb', 'S1', 'S2', 'Civil'];
  var PAPEIS = [
    { valor: 'adjunto', titulo: 'Adjunto', texto: 'Executa e registra as suas missões.' },
    { valor: 'chefia', titulo: 'Chefia', texto: 'Tudo o que o adjunto faz, mais a gestão de atividades, avisos e usuários.' },
    { valor: 'administrador', titulo: 'Administrador (conta institucional AQS)',
      texto: 'A conta da AQS, com o e-mail INSTITUCIONAL (nunca um pessoal). Tem os poderes da chefia, não recebe ' +
        'missões e garante que a ferramenta continue administrável quando as pessoas mudarem. Só um administrador ' +
        'cria, altera ou exclui esta conta.' }
  ];
  var ORDEM_PAPEL = { administrador: 0, chefia: 1, adjunto: 2 };
  var SITUACOES = [
    { valor: 'todos', rotulo: 'Todos' },
    { valor: 'com', rotulo: 'Com acesso' },
    { valor: 'sem', rotulo: 'Sem acesso' },
    { valor: 'desativados', rotulo: 'Desativados' }
  ];
  var TABELAS_AUDITORIA = [
    { valor: 'militares', rotulo: 'Militares' },
    { valor: 'auth.users', rotulo: 'Acessos (login)' },
    { valor: 'atividades', rotulo: 'Atividades' },
    { valor: 'atividade_responsaveis', rotulo: 'Responsáveis' },
    { valor: 'ocorrencias', rotulo: 'Ocorrências' },
    { valor: 'evidencias', rotulo: 'Evidências' },
    { valor: 'comentarios', rotulo: 'Comentários' },
    { valor: 'avisos', rotulo: 'Avisos' },
    { valor: 'setores', rotulo: 'Setores' },
    { valor: 'feriados', rotulo: 'Feriados' },
    { valor: 'configuracoes', rotulo: 'Configurações' }
  ];
  var LIMITES_AUDITORIA = [100, 200, 500];
  var ID_VALIDO = /^[0-9A-Za-z_-]{1,64}$/;
  var COR_VALIDA = /^#[0-9a-fA-F]{6}$/;
  var CAMINHO_MANUAL = 'docs/CONTINUIDADE.md';

  var geracao = 0;
  var carga = 0;
  var abaAtual = 'militares';
  var dados = null;
  var filtroMilitares = { busca: '', situacao: 'todos' };
  var anoFeriados = null;
  var rascunhoFeriado = { data: '', descricao: '', original: null };
  var rascunhoContatos = null;
  var filtroAuditoria = { tabela: '', limite: 200 };
  /* Assistente da passagem de chefia (sobrevive às atualizações ao vivo). */
  var assistente = null;
  var seqPainel = 0;

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

  function porId(lista, id) {
    return achar(lista, function (x) { return x && x.id === id; });
  }

  function indexar(lista) {
    var mapa = {};
    (lista || []).forEach(function (x) { if (x && x.id) { mapa[x.id] = x; } });
    return mapa;
  }

  function plural(n, singular, varios) {
    return n + ' ' + (n === 1 ? singular : varios);
  }

  function juntarNomes(nomes) {
    if (nomes.length <= 1) { return nomes.join(''); }
    return nomes.slice(0, -1).join(', ') + ' e ' + nomes[nomes.length - 1];
  }

  function opcao(valor, rotulo, selecionado) {
    return '<option value="' + U.esc(valor) + '"' + (selecionado ? ' selected' : '') + '>' + U.esc(rotulo) + '</option>';
  }

  function militarLogado() { return App.militar(); }

  function eGestorLogado() { return Regras.podeGerenciarUsuarios(militarLogado()); }

  function vigente(el, minhaGeracao, minhaCarga) {
    return minhaGeracao === geracao && (minhaCarga === undefined || minhaCarga === carga) &&
      !!App.militar() && !el.classList.contains('oculto') && !!U.$('.pagina-equipe', el);
  }

  function carregandoHtml(texto) {
    return '<div class="carregando" role="status">' + U.esc(texto || 'Carregando…') + '</div>';
  }

  function nomeExibido(m) {
    return m ? Regras.nomeMilitar(m) : '(militar excluído)';
  }

  function ordenarMilitares(lista) {
    return lista.slice().sort(function (a, b) {
      var ia = a.ativo === false ? 1 : 0, ib = b.ativo === false ? 1 : 0;
      if (ia !== ib) { return ia - ib; }
      var pa = temPropria(ORDEM_PAPEL, a.papel) ? ORDEM_PAPEL[a.papel] : 3;
      var pb = temPropria(ORDEM_PAPEL, b.papel) ? ORDEM_PAPEL[b.papel] : 3;
      if (pa !== pb) { return pa - pb; }
      return U.ordenarTexto(Regras.nomeMilitar(a), Regras.nomeMilitar(b));
    });
  }

  function seloPapel(m) {
    var papel = temPropria(Regras.ROTULOS.papel, m.papel) ? m.papel : 'adjunto';
    var rotulo = papel === 'administrador' ? 'Administrador' : Regras.ROTULOS.papel[papel];
    return '<span class="selo selo--papel-' + papel + '">' + U.esc(rotulo) + '</span>';
  }

  /* Situação do login: Sem acesso / Ativo / Desativado. */
  function situacaoAcesso(m) {
    if (m.ativo === false) { return { valor: 'desativado', rotulo: 'Desativado', classe: 'selo--neutro' }; }
    if (!m.usuario_id) { return { valor: 'sem', rotulo: 'Sem acesso', classe: 'selo--atencao' }; }
    return { valor: 'ativo', rotulo: 'Ativo', classe: 'selo--sucesso' };
  }

  function seloAcesso(m) {
    var s = situacaoAcesso(m);
    return '<span class="selo ' + s.classe + '">' + U.esc(s.rotulo) + '</span>';
  }

  function ultimoAcessoTexto(m) {
    if (!m.ultimo_acesso) { return m.usuario_id ? 'Nunca entrou' : '—'; }
    return U.formatarDataHora(m.ultimo_acesso);
  }

  /* Atividades ATIVAS em que o militar é responsável. */
  function atividadesDe(id, atividades) {
    return (atividades || []).filter(function (a) { return a.ativa !== false && contem(a.responsaveis, id); })
      .sort(function (a, b) { return (Number(a.ordem) || 0) - (Number(b.ordem) || 0); });
  }

  /* Mensagem de erro do servidor com a orientação do que fazer. */
  function erroHtml(titulo, erro) {
    var mensagem = U.erroTexto(erro);
    var dica = '';
    if (/ao menos uma conta de chefia ou administrador/i.test(mensagem)) {
      dica = 'O sistema nunca fica sem um gestor que consiga entrar. Antes, garanta outra conta de chefia ou de ' +
        'administrador ativa e com acesso (cadastre-a e crie o acesso dela, ou faça a Passagem de chefia).';
    } else if (/administrador/i.test(mensagem) && /(apenas|somente|só)/i.test(mensagem)) {
      dica = 'Peça a quem tem a conta institucional da AQS (papel Administrador).';
    } else if (/pr[oó]prio/i.test(mensagem)) {
      dica = 'Peça a outro gestor (outra chefia ou a conta institucional da AQS).';
    }
    return '<div class="aviso aviso--urgente" role="alert"><span class="aviso__icone">' + icone('alerta') + '</span><div>' +
      '<strong>' + U.esc(titulo) + '</strong>' + U.esc(mensagem) +
      (dica ? '<span class="aviso__dica">' + U.esc(dica) + '</span>' : '') + '</div></div>';
  }

  function ocupado(botao, sim) {
    if (!botao || !document.body.contains(botao)) { return; }
    botao.disabled = !!sim;
    if (sim) { botao.setAttribute('aria-busy', 'true'); } else { botao.removeAttribute('aria-busy'); }
  }

  /* A conta institucional não assume a chefia (nem recebe missões); qualquer
     outro militar pode — o desativado é reativado pelo transferir_chefia. */
  function podeAssumirChefia(m) {
    return !!m && !!m.id && m.papel !== 'administrador';
  }

  /* Gestor que consegue entrar (o que a trava anti-bloqueio protege). */
  function eGestorComAcesso(m) {
    return !!m && m.ativo !== false && !!m.usuario_id && (m.papel === 'chefia' || m.papel === 'administrador');
  }

  /* null se o e-mail parece válido; senão a mensagem (quem confere de
     verdade é o servidor). */
  function validarEmail(email) {
    if (typeof Regras.validarEmail === 'function') { return Regras.validarEmail(email); }
    var texto = String(email || '').trim();
    if (!texto) { return 'Informe o e-mail.'; }
    return (texto.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(texto)) ? 'E-mail inválido. Confira o endereço digitado.' : null;
  }

  /* Payload completo de uma atividade para salvar_atividade, trocando só os
     responsáveis (reatribuição e passagem de missões). */
  function payloadAtividade(a, responsaveis) {
    return {
      id: a.id, ordem: a.ordem, titulo: a.titulo, descricao: a.descricao || '', setor_id: a.setor_id || null,
      tipo: a.tipo, periodicidade: a.periodicidade || null, dia_semana: a.dia_semana || null,
      dia_mes: a.dia_mes || null, mes_inicio: a.mes_inicio || null, prazo: a.prazo || null,
      antecipar_dia_util: a.antecipar_dia_util !== false, prioridade: a.prioridade || 'normal',
      exige_evidencia: !!a.exige_evidencia, ativa: a.ativa !== false, data_inicio: a.data_inicio || null,
      responsaveis: responsaveis
    };
  }

  /* Passa as atividades de 'de' para 'para', uma a uma (cada uma é uma
     gravação atômica no banco). Resolve com { feitas, total, erro }. */
  function reatribuir(atividades, deId, paraId) {
    var feitas = 0;
    return atividades.reduce(function (p, a) {
      return p.then(function () {
        var novos = (a.responsaveis || []).filter(function (id) { return id !== deId; });
        if (novos.indexOf(paraId) < 0) { novos.push(paraId); }
        return Api.salvarAtividade(payloadAtividade(a, novos)).then(function () { feitas += 1; });
      });
    }, Promise.resolve()).then(function () {
      return { feitas: feitas, total: atividades.length, erro: null };
    }, function (erro) {
      return { feitas: feitas, total: atividades.length, erro: erro };
    });
  }

  /* ---------- página e abas ---------- */

  function normalizarAba(valor, gestor) {
    var v = String(valor || '').toLowerCase();
    if (temPropria(SINONIMOS_ABA, v)) { v = SINONIMOS_ABA[v]; }
    var aba = achar(ABAS, function (a) { return a.valor === v; });
    if (!aba || (aba.gestor && !gestor)) { return 'militares'; }
    return aba.valor;
  }

  function render(el, params) {
    geracao += 1;
    dados = null;
    var eu = militarLogado();
    var gestor = Regras.podeGerenciarUsuarios(eu);
    if (!gestor) { assistente = null; }
    abaAtual = normalizarAba(params && params.aba, gestor);

    var abas = gestor ? '<nav class="abas" aria-label="Seções da equipe">' + ABAS.map(function (a) {
      var ativa = a.valor === abaAtual;
      return '<a class="aba' + (ativa ? ' aba--ativa' : '') + '" href="#/equipe?aba=' + a.valor + '"' +
        (ativa ? ' aria-current="page"' : '') + '>' + icone(a.icone) + U.esc(a.rotulo) + '</a>';
    }).join('') + '</nav>' : '';

    el.innerHTML = '<div class="pagina-equipe">' +
      '<div class="pagina__cabecalho">' +
        '<h1>Equipe</h1>' +
        '<p>' + (gestor
          ? 'Militares e acessos, passagem de chefia, setores, feriados e a continuidade da ferramenta.'
          : 'Quem faz parte da equipe do NSP e da AQS. O cadastro é mantido pela chefia e pela AQS.') + '</p>' +
      '</div>' +
      abas +
      '<div id="eqConteudo">' + carregandoHtml() + '</div>' +
    '</div>';
    ligar(el);
    mostrarAbaAtiva(el);
    carregarAba(el);
  }

  /* No celular as abas rolam de lado: a aba aberta precisa aparecer
     (rolagem só da faixa das abas, sem mexer na página). */
  function mostrarAbaAtiva(el) {
    var faixa = U.$('.pagina-equipe .abas', el);
    var ativa = faixa ? U.$('.aba--ativa', faixa) : null;
    if (!faixa || !ativa || faixa.scrollWidth <= faixa.clientWidth) { return; }
    faixa.scrollLeft = Math.max(0, ativa.offsetLeft - faixa.offsetLeft - 24);
  }

  function aoVivo(el, params, tabelas) {
    if (!U.$('.pagina-equipe', el)) { render(el, params); return; }
    var relevantes = TABELAS_DA_ABA[abaAtual] || [];
    if (Array.isArray(tabelas) && !tabelas.some(function (t) { return contem(relevantes, t); })) { return; }
    if (!Array.isArray(tabelas) && abaAtual === 'auditoria') { return; }
    if (assistente && assistente.executando) { return; }
    carregarAba(el);
  }

  function carregarAba(el) {
    var minhaGeracao = geracao;
    var minhaCarga = ++carga;
    var aba = abaAtual;
    var consulta;
    if (aba === 'militares' || aba === 'chefia') {
      consulta = Promise.all([Api.listarMilitares(), Api.referencias(), Api.listarAtividades()]).then(function (r) {
        return { militares: r[0] || [], ref: r[1], atividades: r[2] || [] };
      });
    } else if (aba === 'setores') {
      consulta = Promise.all([Api.listarSetores(), Api.listarMilitares(), Api.listarAtividades()]).then(function (r) {
        return { setores: r[0] || [], militares: r[1] || [], atividades: r[2] || [] };
      });
    } else if (aba === 'feriados') {
      consulta = Api.listarFeriados().then(function (lista) { return { feriados: lista || [] }; });
    } else if (aba === 'continuidade') {
      consulta = Promise.all([Api.obterConfiguracoes(), Api.listarMilitares(), Api.listarAtividades(), Api.listarFeriados()])
        .then(function (r) {
          return { configuracoes: r[0] || {}, militares: r[1] || [], atividades: r[2] || [], feriados: r[3] || [] };
        });
    } else {
      consulta = Promise.all([
        Api.listarAuditoria({ limite: filtroAuditoria.limite, tabela: filtroAuditoria.tabela || undefined }),
        Api.listarMilitares(), Api.listarAtividades(), Api.listarSetores()
      ]).then(function (r) {
        return { registros: r[0] || [], militares: r[1] || [], atividades: r[2] || [], setores: r[3] || [] };
      });
    }
    consulta.then(function (d) {
      if (!vigente(el, minhaGeracao, minhaCarga) || aba !== abaAtual) { return; }
      d.hoje = U.hojeBelem();
      d.eu = militarLogado();
      dados = d;
      desenharAba(el);
    }).catch(function (erro) {
      if (!vigente(el, minhaGeracao, minhaCarga)) { return; }
      U.falha(erro);
      if (dados) { return; }
      U.$('#eqConteudo', el).innerHTML = erroHtml('Não foi possível carregar esta seção', erro) +
        '<div class="acoes"><button type="button" class="botao botao--secundario" data-eq-acao="tentar">Tentar novamente</button></div>';
    });
  }

  function desenharAba(el) {
    if (!dados) { return; }
    var caixa = U.$('#eqConteudo', el);
    if (abaAtual === 'militares') { caixa.innerHTML = militaresHtml(); }
    else if (abaAtual === 'chefia') { caixa.innerHTML = assistenteHtml(); }
    else if (abaAtual === 'setores') { caixa.innerHTML = setoresHtml(); }
    else if (abaAtual === 'feriados') { caixa.innerHTML = feriadosHtml(); }
    else if (abaAtual === 'continuidade') { caixa.innerHTML = continuidadeHtml(); }
    else { caixa.innerHTML = auditoriaHtml(); }
    aplicarCores(caixa);
    U.aplicarLarguras(caixa);
  }

  /* Amostras de cor dos setores: a cor vem do banco e entra pelo CSSOM
     (a CSP não permite style=""), só se for um #rrggbb válido. */
  function aplicarCores(raiz) {
    U.$$('[data-cor]', raiz).forEach(function (amostra) {
      var cor = amostra.getAttribute('data-cor');
      if (COR_VALIDA.test(cor)) { amostra.style.backgroundColor = cor; }
    });
  }

  /* =====================================================================
     Aba Militares
     ===================================================================== */

  function filtrarMilitares(lista, gestor) {
    var termos = U.normalizar(filtroMilitares.busca).split(/\s+/).filter(Boolean);
    return lista.filter(function (m) {
      if (!gestor && m.ativo === false) { return false; }
      var s = situacaoAcesso(m).valor;
      if (filtroMilitares.situacao === 'com' && s !== 'ativo') { return false; }
      if (filtroMilitares.situacao === 'sem' && s !== 'sem') { return false; }
      if (filtroMilitares.situacao === 'desativados' && s !== 'desativado') { return false; }
      if (termos.length) {
        var setor = m.setor_id && temPropria(dados.ref.mapaSetores, m.setor_id) ? dados.ref.mapaSetores[m.setor_id] : null;
        var texto = U.normalizar([m.posto, m.nome_guerra, m.nome_completo, gestor ? m.email : '',
          setor ? setor.sigla + ' ' + setor.nome : '', Regras.ROTULOS.papel[m.papel] || ''].join(' '));
        if (!termos.every(function (t) { return texto.indexOf(t) >= 0; })) { return false; }
      }
      return true;
    });
  }

  function setorSigla(id) {
    var s = id && dados.ref && temPropria(dados.ref.mapaSetores, id) ? dados.ref.mapaSetores[id] : null;
    return s ? '<span class="sigla-setor" title="' + U.esc(s.nome) + '">' + U.esc(s.sigla) + '</span>' : '<span class="texto-suave">—</span>';
  }

  function nomeCelulaHtml(m, gestor) {
    var eu = dados.eu;
    return '<strong class="nome-militar">' + U.esc(Regras.nomeMilitar(m)) + (m.id === eu.id ? ' <em class="texto-suave">(você)</em>' : '') + '</strong>' +
      (m.nome_completo ? '<span class="linha-regra">' + U.esc(m.nome_completo) + '</span>' : '') +
      (gestor && m.email ? '<span class="linha-regra quebra-palavra">' + U.esc(m.email) + '</span>' : '');
  }

  function militaresHtml() {
    var eu = dados.eu;
    var gestor = Regras.podeGerenciarUsuarios(eu);
    var todos = ordenarMilitares(dados.militares);

    var barra = '<div class="cartao filtros-gestao">' +
      '<div class="filtros-gestao__linha">' +
        '<div class="busca-gestao cresce"><input type="search" id="eqBusca" autocomplete="off" maxlength="80" ' +
          'placeholder="Buscar por nome, posto, setor' + (gestor ? ' ou e-mail' : '') + '" aria-label="Buscar militares" value="' +
          U.esc(filtroMilitares.busca) + '"></div>' +
        (gestor ? '<button type="button" class="botao" data-eq-acao="novo-militar">+ Novo militar</button>' : '') +
      '</div>' +
      (gestor ? '<div class="filtros filtros--gestao mb-0" role="group" aria-label="Situação do acesso">' + SITUACOES.map(function (s) {
        var ativo = filtroMilitares.situacao === s.valor;
        var n = s.valor === 'todos' ? todos.length : todos.filter(function (m) {
          var v = situacaoAcesso(m).valor;
          return (s.valor === 'com' && v === 'ativo') || (s.valor === 'sem' && v === 'sem') || (s.valor === 'desativados' && v === 'desativado');
        }).length;
        return '<button type="button" class="filtro' + (ativo ? ' filtro--ativo' : '') + '" data-situacao="' + s.valor +
          '" aria-pressed="' + (ativo ? 'true' : 'false') + '">' + U.esc(s.rotulo) + ' <span class="filtro__contagem">(' + n + ')</span></button>';
      }).join('') + '</div>' : '') +
    '</div>';
    return barra + '<div id="eqMilitaresLista">' + listaMilitaresHtml() + '</div>';
  }

  /* A lista (redesenhada sozinha durante a busca: a caixa de busca fica
     intacta, sem perder o foco nem o teclado do celular). */
  function listaMilitaresHtml() {
    var eu = dados.eu;
    var gestor = Regras.podeGerenciarUsuarios(eu);
    var todos = ordenarMilitares(dados.militares);
    var lista = filtrarMilitares(todos, gestor);
    var visiveisTotal = gestor ? todos.length : todos.filter(function (m) { return m.ativo !== false; }).length;

    if (!visiveisTotal) {
      return '<div class="vazio"><span class="vazio__icone">' + icone('equipe') + '</span><strong>Nenhum militar cadastrado</strong>' +
        '<p>' + (gestor ? 'Cadastre a equipe: cada militar precisa de um cadastro e, para entrar no sistema, de um acesso.'
          : 'A equipe ainda não foi cadastrada.') + '</p>' +
        (gestor ? '<button type="button" class="botao" data-eq-acao="novo-militar">+ Novo militar</button>' : '') + '</div>';
    }
    if (!lista.length) {
      return '<div class="vazio"><span class="vazio__icone">' + icone('caixa') + '</span><strong>Ninguém encontrado</strong>' +
        '<p>Nenhum militar atende à busca ou ao filtro escolhido.</p>' +
        '<button type="button" class="botao botao--secundario" data-eq-acao="limpar-militares">Limpar filtros</button></div>';
    }

    var cabecalho = gestor
      ? '<tr><th scope="col">Militar</th><th scope="col">Setor</th><th scope="col">Papel</th><th scope="col">Acesso</th>' +
        '<th scope="col">Último acesso</th><th scope="col"><span class="so-leitor-tela">Ações</span></th></tr>'
      : '<tr><th scope="col">Militar</th><th scope="col">Setor</th><th scope="col">Papel</th></tr>';

    var linhas = lista.map(function (m) {
      if (!gestor) {
        return '<tr><td>' + nomeCelulaHtml(m, false) + '</td><td>' + setorSigla(m.setor_id) + '</td><td>' + seloPapel(m) + '</td></tr>';
      }
      var pode = Regras.podeGerenciarMilitar(eu, m);
      return '<tr class="linha-clicavel' + (m.ativo === false ? ' linha-clicavel--arquivada' : '') + '" data-militar="' + U.esc(m.id) + '">' +
        '<td>' + nomeCelulaHtml(m, true) + '</td>' +
        '<td>' + setorSigla(m.setor_id) + '</td>' +
        '<td>' + seloPapel(m) + '</td>' +
        '<td>' + seloAcesso(m) + (m.usuario_id && m.ativo !== false && m.deve_trocar_senha
          ? '<span class="linha-regra">troca de senha pendente</span>' : '') + '</td>' +
        '<td class="texto-pequeno">' + U.esc(ultimoAcessoTexto(m)) + '</td>' +
        '<td class="alinhar-direita"><button type="button" class="botao botao--secundario botao--pequeno" data-militar="' + U.esc(m.id) + '">' +
          (pode ? 'Gerenciar' : icone('cadeado') + 'Ver') + '</button></td>' +
      '</tr>';
    }).join('');

    var cartoes = lista.map(function (m) {
      var clicavel = gestor;
      return '<li class="cartao-item' + (m.ativo === false ? ' cartao-item--arquivado' : '') + '"' +
          (clicavel ? ' data-militar="' + U.esc(m.id) + '"' : '') + '>' +
        '<div class="cartao-item__topo">' +
          (clicavel ? '<button type="button" class="cartao-item__titulo" data-militar="' + U.esc(m.id) + '">' + U.esc(Regras.nomeMilitar(m)) + '</button>'
            : '<strong class="cartao-item__titulo cartao-item__titulo--texto">' + U.esc(Regras.nomeMilitar(m)) + '</strong>') +
          (m.id === dados.eu.id ? '<em class="texto-suave texto-pequeno">(você)</em>' : '') +
        '</div>' +
        (m.nome_completo ? '<p class="cartao-item__linha">' + U.esc(m.nome_completo) + '</p>' : '') +
        (gestor && m.email ? '<p class="cartao-item__linha quebra-palavra">' + U.esc(m.email) + '</p>' : '') +
        '<div class="cartao-item__selos">' + seloPapel(m) + (gestor ? seloAcesso(m) : '') + setorSigla(m.setor_id) + '</div>' +
        (gestor ? '<p class="cartao-item__linha texto-pequeno">Último acesso: ' + U.esc(ultimoAcessoTexto(m)) + '</p>' : '') +
      '</li>';
    }).join('');

    var nota = gestor ? '' : '<p class="texto-pequeno texto-suave mt-2">Para corrigir algum dado, fale com a chefia ou com a AQS.</p>';
    return '<p class="resumo-lista">' + U.esc(plural(lista.length, 'militar', 'militares')) +
        (lista.length !== visiveisTotal ? ' de ' + visiveisTotal : '') + '</p>' +
      '<div class="cartao cartao--tabela so-computador"><div class="tabela-rolagem"><table class="tabela tabela--gestao">' +
        '<caption class="so-leitor-tela">Militares da equipe</caption><thead>' + cabecalho + '</thead><tbody>' + linhas + '</tbody>' +
      '</table></div></div>' +
      '<ul class="lista-cartoes so-celular">' + cartoes + '</ul>' + nota;
  }

  /* ---------- painel do militar ---------- */

  function campoHtml(id, rotuloHtml, controleHtml, dicaHtml) {
    return '<div class="campo" id="' + id + 'Campo">' +
      '<label for="' + id + '">' + rotuloHtml + '</label>' + controleHtml +
      (dicaHtml ? '<span class="campo__dica">' + dicaHtml + '</span>' : '') +
      '<div class="campo__erro" id="' + id + 'Erro" role="alert"></div>' +
    '</div>';
  }

  function papeisPermitidos(eu, alvo) {
    return PAPEIS.filter(function (p) {
      if (p.valor === 'administrador') { return Regras.podeGerenciarMilitar(eu, alvo, 'administrador'); }
      return true;
    });
  }

  function formularioMilitarHtml(ctx) {
    var alvo = ctx.alvo;
    var eu = ctx.eu;
    var pode = ctx.pode;
    var desab = pode ? '' : ' disabled';
    var m = alvo || { posto: '', nome_guerra: '', nome_completo: '', email: '', setor_id: eu.setor_id || null, papel: 'adjunto', ativo: true };
    var temAcesso = !!(alvo && alvo.usuario_id);
    var setores = '<option value="">Sem setor</option>' + (ctx.ref.setores || []).map(function (s) {
      return opcao(s.id, s.sigla + ' — ' + s.nome, m.setor_id === s.id);
    }).join('');
    var papeis = papeisPermitidos(eu, alvo);
    if (!achar(papeis, function (p) { return p.valor === m.papel; })) {
      papeis = papeis.concat(PAPEIS.filter(function (p) { return p.valor === m.papel; }));
    }

    return '<form id="mlForm" class="form-militar" novalidate>' +
      '<h3 class="secao-painel__titulo">' + icone('conta') + 'Dados do cadastro</h3>' +
      '<div class="grade-form">' +
        campoHtml('mlPosto', 'Posto/graduação', '<input type="text" id="mlPosto" list="mlPostos" maxlength="30" autocomplete="off" value="' +
          U.esc(m.posto || '') + '"' + desab + '><datalist id="mlPostos">' + POSTOS.map(function (p) { return '<option value="' + U.esc(p) + '">'; }).join('') +
          '</datalist>', m.papel === 'administrador' ? 'Conta institucional: pode ficar em branco.' : 'Ex.: 1º Ten, Cap, Maj.') +
        campoHtml('mlNomeGuerra', 'Nome de guerra <span class="obrigatorio">*</span>',
          '<input type="text" id="mlNomeGuerra" maxlength="80" autocomplete="off" value="' + U.esc(m.nome_guerra || '') + '"' + desab + '>', '') +
      '</div>' +
      campoHtml('mlNomeCompleto', 'Nome completo',
        '<input type="text" id="mlNomeCompleto" maxlength="200" autocomplete="off" value="' + U.esc(m.nome_completo || '') + '"' + desab + '>',
        'Usado na assinatura do plano de atividades.') +
      campoHtml('mlEmail', 'E-mail' + (temAcesso ? ' de acesso (login)' : ''),
        '<input type="email" id="mlEmail" maxlength="254" autocomplete="off" inputmode="email" value="' + U.esc(m.email || '') + '"' +
          (temAcesso || !pode ? ' disabled' : '') + '>',
        temAcesso ? 'É o login do militar. Para trocar, use "Alterar e-mail de acesso", abaixo.'
          : 'Necessário para criar o acesso. Use o e-mail funcional' + (m.papel === 'administrador' ? ' — na conta institucional, o e-mail INSTITUCIONAL da AQS' : '') + '.') +
      campoHtml('mlSetor', 'Setor', '<select id="mlSetor"' + desab + '>' + setores + '</select>', '') +
      '<fieldset class="campo campo--grupo" id="mlPapelCampo"><legend>Papel</legend>' +
        '<div class="opcoes opcoes--papel">' + papeis.map(function (p) {
          return '<label class="opcao"><input type="radio" name="mlPapel" value="' + p.valor + '"' + (m.papel === p.valor ? ' checked' : '') + desab + '>' +
            '<span class="opcao__texto"><strong>' + U.esc(p.titulo) + '</strong><small>' + U.esc(p.texto) + '</small></span></label>';
        }).join('') + '</div>' +
        '<div class="campo__erro" id="mlPapelErro" role="alert"></div>' +
      '</fieldset>' +
      (alvo && !temAcesso
        ? '<label class="marcar marcar--linha"><input type="checkbox" id="mlAtivo"' + (m.ativo !== false ? ' checked' : '') + desab + '>' +
            '<span class="marcar__texto"><strong>Cadastro ativo</strong><small>Desmarcado, o militar sai das listas de responsáveis e ' +
            'não pode receber acesso.</small></span></label>'
        : '') +
      '<div id="mlErroForm"></div>' +
      (pode ? '<div class="acoes acoes--direita">' +
        (alvo ? '' : '<button type="button" class="botao botao--secundario" data-ml-acao="cancelar">Cancelar</button>') +
        '<button type="submit" class="botao" id="mlSalvar">' + (alvo ? 'Salvar alterações' : 'Cadastrar militar') + '</button></div>' : '') +
    '</form>';
  }

  function acessoHtml(ctx) {
    var alvo = ctx.alvo;
    var eu = ctx.eu;
    var s = situacaoAcesso(alvo);
    var botoes = [];
    if (ctx.pode) {
      if (!alvo.usuario_id && alvo.ativo !== false) {
        botoes.push('<button type="button" class="botao" data-ml-acao="criar"' + (alvo.email ? '' : ' disabled') + '>' +
          icone('chave') + 'Criar acesso</button>');
      }
      if (alvo.usuario_id) {
        botoes.push('<button type="button" class="botao botao--secundario" data-ml-acao="redefinir_senha">' + icone('chave') + 'Redefinir senha</button>');
        botoes.push('<button type="button" class="botao botao--secundario" data-ml-acao="remover_mfa">' + icone('escudo') + 'Remover 2FA</button>');
        botoes.push('<button type="button" class="botao botao--secundario" data-ml-acao="mostrar-email">Alterar e-mail de acesso</button>');
        if (alvo.ativo !== false && Regras.podeExcluirMilitar(eu, alvo)) {
          botoes.push('<button type="button" class="botao botao--perigo-secundario" data-ml-acao="desativar">Desativar</button>');
        }
        if (alvo.ativo === false) {
          botoes.push('<button type="button" class="botao botao--sucesso" data-ml-acao="reativar">Reativar</button>');
        }
      }
    }
    var notas = [];
    if (ctx.pode && !alvo.usuario_id && alvo.ativo !== false && !alvo.email) {
      notas.push('Para criar o acesso, informe primeiro o e-mail no cadastro acima e salve.');
    }
    if (ctx.pode && !alvo.usuario_id && alvo.ativo === false) {
      notas.push('Cadastro desativado: marque "Cadastro ativo" e salve antes de criar o acesso.');
    }
    if (alvo.id === eu.id) {
      notas.push('Este é o seu cadastro: você não pode desativá-lo nem excluí-lo. A sua senha e o segundo fator ficam em ' +
        '<a href="#/conta">Minha conta</a>.');
    }

    return '<section class="secao-painel" aria-labelledby="mlAcessoTitulo">' +
      '<h3 class="secao-painel__titulo" id="mlAcessoTitulo">' + icone('cadeado') + 'Acesso ao sistema</h3>' +
      '<dl class="dados-lista dados-lista--compacta">' +
        '<div><dt>Situação</dt><dd>' + seloAcesso(alvo) + '</dd></div>' +
        '<div><dt>Login (e-mail)</dt><dd class="quebra-palavra">' + U.esc(alvo.usuario_id ? (alvo.email || '—') : 'Sem acesso criado') + '</dd></div>' +
        '<div><dt>Último acesso</dt><dd>' + U.esc(ultimoAcessoTexto(alvo)) + '</dd></div>' +
        (alvo.usuario_id ? '<div><dt>Troca de senha</dt><dd>' + (alvo.deve_trocar_senha ? 'Pendente (no próximo acesso)' : 'Feita') + '</dd></div>' : '') +
      '</dl>' +
      (s.valor === 'desativado' && alvo.usuario_id ? '<p class="texto-pequeno texto-suave">Desativado: não entra no sistema e não aparece nas listas de responsáveis.</p>' : '') +
      (botoes.length ? '<div class="acoes">' + botoes.join('') + '</div>' : '') +
      (ctx.pode && alvo.usuario_id ? '<form id="mlEmailForm" class="form-email oculto" novalidate>' +
        campoHtml('mlNovoEmail', 'Novo e-mail de acesso', '<input type="email" id="mlNovoEmail" maxlength="254" autocomplete="off" inputmode="email">',
          'O militar passa a entrar com este e-mail; a senha continua a mesma.') +
        '<div class="acoes acoes--topo"><button type="submit" class="botao botao--pequeno">Confirmar troca</button>' +
          '<button type="button" class="botao botao--secundario botao--pequeno" data-ml-acao="esconder-email">Cancelar</button></div>' +
      '</form>' : '') +
      (notas.length ? '<p class="texto-pequeno texto-suave mt-1 mb-0">' + notas.join(' ') + '</p>' : '') +
      '<div id="mlErroAcesso"></div>' +
    '</section>';
  }

  function missoesHtml(ctx) {
    var alvo = ctx.alvo;
    var minhas = atividadesDe(alvo.id, ctx.atividades);
    if (!minhas.length) {
      return '<section class="secao-painel"><h3 class="secao-painel__titulo">' + icone('atividades') + 'Atividades sob responsabilidade</h3>' +
        '<p class="texto-pequeno texto-suave mb-0">' + U.esc(Regras.nomeMilitar(alvo)) + ' não é responsável por nenhuma atividade ativa.</p></section>';
    }
    var candidatos = Regras.militaresAtribuiveis(ctx.militares).filter(function (m) { return m.id !== alvo.id; })
      .sort(function (a, b) { return U.ordenarTexto(Regras.nomeMilitar(a), Regras.nomeMilitar(b)); });
    var ferramenta = '';
    if (ctx.gestor && candidatos.length) {
      ferramenta = '<form id="mlReatribuirForm" class="reatribuir" novalidate>' +
        '<label class="campo campo--compacto"><span class="campo__rotulo">Passar as atividades para</span>' +
          '<select id="mlReatribuirPara"><option value="">Escolha um militar…</option>' + candidatos.map(function (m) {
            return opcao(m.id, Regras.nomeMilitar(m) + ' — ' + (Regras.ROTULOS.papel[m.papel] || m.papel), false);
          }).join('') + '</select></label>' +
        '<button type="submit" class="botao botao--secundario">Reatribuir ' + (minhas.length === 1 ? 'a atividade' : 'as ' + minhas.length + ' atividades') + '</button>' +
      '</form><div id="mlErroReatribuir"></div>';
    } else if (ctx.gestor) {
      ferramenta = '<p class="texto-pequeno texto-suave mb-0">Não há outro militar ativo para assumir as atividades.</p>';
    }
    return '<section class="secao-painel" aria-labelledby="mlMissoesTitulo">' +
      '<h3 class="secao-painel__titulo" id="mlMissoesTitulo">' + icone('atividades') + 'Atividades sob responsabilidade ' +
        '<span class="contador contador--neutro">' + minhas.length + '</span></h3>' +
      '<ul class="lista-simples lista-simples--numerada">' + minhas.map(function (a) {
        var outros = (a.responsaveis || []).filter(function (id) { return id !== alvo.id; }).length;
        return '<li><strong>' + U.esc((a.ordem ? a.ordem + '. ' : '') + a.titulo) + '</strong>' +
          (outros ? '' : ' <span class="selo selo--atencao selo--pequeno">só ele</span>') + '</li>';
      }).join('') + '</ul>' +
      ferramenta +
    '</section>';
  }

  function exclusaoHtml(ctx) {
    var alvo = ctx.alvo;
    if (!Regras.podeExcluirMilitar(ctx.eu, alvo)) {
      if (alvo.id === ctx.eu.id) {
        return '<p class="texto-pequeno texto-suave">Você não pode excluir o seu próprio cadastro. Se for sair, peça a outro gestor ' +
          '(outra chefia ou a conta institucional da AQS) — e use antes a Passagem de chefia, se for o caso.</p>';
      }
      return '';
    }
    var minhas = atividadesDe(alvo.id, ctx.atividades);
    var sozinhas = minhas.filter(function (a) { return (a.responsaveis || []).length === 1; }).length;
    return '<section class="zona-perigo" aria-labelledby="mlExcluirTitulo">' +
      '<h3 class="secao-painel__titulo" id="mlExcluirTitulo">' + icone('alerta') + 'Excluir militar</h3>' +
      '<p class="texto-pequeno">Use quando o militar deixou o setor de vez. O <strong>histórico é preservado</strong>: execuções, ' +
        'comentários, evidências e avisos continuam mostrando o nome dele, gravado no momento de cada registro. ' +
        'O cadastro e o acesso (login) são apagados.</p>' +
      (minhas.length
        ? '<div class="aviso aviso--atencao"><span class="aviso__icone">' + icone('alerta') + '</span><div>' +
            '<strong>' + U.esc(plural(minhas.length, 'atividade ativa ficará', 'atividades ativas ficarão')) + ' sem este responsável</strong>' +
            (sozinhas ? U.esc(plural(sozinhas, 'delas fica', 'delas ficam')) + ' sem ninguém. ' : '') +
            'Use "Reatribuir", acima, antes de excluir.</div></div>'
        : '') +
      (eGestorComAcesso(alvo)
        ? '<p class="texto-pequeno">É uma conta de gestão com acesso: se for a última, o sistema recusa a exclusão ' +
          '(sempre precisa restar uma).</p>' : '') +
      '<div class="campo" id="mlConfirmaCampo"><label for="mlConfirmaNome">Para confirmar, digite o nome de guerra: ' +
        '<strong class="nome-confirmacao">' + U.esc(alvo.nome_guerra) + '</strong></label>' +
        '<input type="text" id="mlConfirmaNome" autocomplete="off" spellcheck="false"></div>' +
      '<div class="acoes acoes--topo"><button type="button" class="botao botao--perigo" data-ml-acao="excluir" id="mlExcluir" disabled>' +
        'Excluir definitivamente</button></div>' +
      '<p class="texto-pequeno texto-suave mb-0">Se a saída for temporária, prefira "Desativar": nada é apagado e dá para reativar.</p>' +
      '<div id="mlErroExcluir"></div>' +
    '</section>';
  }

  function senhaHtml(alvo) {
    return '<div class="senha-temporaria" role="status" id="mlSenhaCaixa">' +
      '<strong class="senha-temporaria__titulo">' + icone('chave') + 'Senha temporária de ' + U.esc(Regras.nomeMilitar(alvo)) + '</strong>' +
      '<div class="senha-temporaria__linha">' +
        '<code class="senha-temporaria__valor" id="mlSenhaValor"></code>' +
        '<button type="button" class="botao botao--pequeno" data-ml-acao="copiar-senha">' + icone('copiar') + 'Copiar</button>' +
      '</div>' +
      '<p class="senha-temporaria__orientacao">Entregue pessoalmente. A troca será exigida no primeiro acesso.</p>' +
      '<p class="texto-pequeno mb-0">Login: <strong>' + U.esc(alvo.email || '') + '</strong>. Esta senha aparece só agora: não fica ' +
        'guardada em lugar nenhum. Não a envie por e-mail ou mensagem. Se perder, use "Redefinir senha" de novo.</p>' +
      '<div class="acoes acoes--topo mt-1"><button type="button" class="botao botao--secundario botao--pequeno" data-ml-acao="ocultar-senha">' +
        'Já anotei — ocultar</button></div>' +
    '</div>';
  }

  function cabecalhoMilitarHtml(alvo) {
    return '<div class="militar-topo">' +
      '<div class="cresce"><p class="militar-topo__nome">' + U.esc(Regras.nomeMilitar(alvo)) + '</p>' +
        (alvo.nome_completo ? '<p class="texto-pequeno texto-suave mb-0">' + U.esc(alvo.nome_completo) + '</p>' : '') + '</div>' +
      '<div class="cartao-item__selos">' + seloPapel(alvo) + seloAcesso(alvo) + '</div>' +
    '</div>';
  }

  function corpoMilitarHtml(ctx, extra) {
    var alvo = ctx.alvo;
    var html = '';
    if (extra.senha && alvo) { html += senhaHtml(alvo); }
    if (extra.mensagem) {
      html += '<div class="aviso aviso--sucesso"><span class="aviso__icone">' + icone('check') + '</span><div>' + U.esc(extra.mensagem) + '</div></div>';
    }
    if (extra.aviso) {
      html += '<div class="aviso aviso--atencao"><span class="aviso__icone">' + icone('alerta') + '</span><div>' + U.esc(extra.aviso) + '</div></div>';
    }
    if (!alvo) {
      return html + '<p class="texto-pequeno texto-suave">Depois de cadastrar, você poderá criar o acesso (login) do militar ' +
        'e ele receberá uma senha temporária.</p>' + formularioMilitarHtml(ctx);
    }
    html += cabecalhoMilitarHtml(alvo);
    if (!ctx.pode) {
      html += '<div class="aviso aviso--atencao"><span class="aviso__icone">' + icone('cadeado') + '</span><div>' +
        (Regras.eAdministrador(alvo)
          ? '<strong>Conta institucional da AQS</strong>Somente um administrador altera, desativa ou exclui esta conta — é o que ' +
            'impede que a âncora de continuidade da ferramenta seja derrubada.'
          : 'Você pode ver este cadastro, mas não alterá-lo.') + '</div></div>';
    }
    html += formularioMilitarHtml(ctx) + acessoHtml(ctx);
    if (ctx.gestor && alvo.papel !== 'administrador') { html += missoesHtml(ctx); }
    if (ctx.pode) { html += exclusaoHtml(ctx); }
    return html;
  }

  /* extra: { senha?, mensagem?, aviso? } — a senha só passa por aqui e é
     escrita por textContent; não fica em lugar nenhum depois. */
  function abrirMilitar(id, extra) {
    var eu = militarLogado();
    if (!Regras.podeGerenciarUsuarios(eu)) { return; }
    extra = extra || {};
    seqPainel += 1;
    var ctx = { seq: seqPainel, eu: eu, gestor: true, painel: null };
    U.abrirPainel(id ? 'Militar' : 'Novo militar', carregandoHtml(), function (p) { ctx.painel = p; });
    App.aoAtualizarPainel(null);

    Promise.all([Api.listarMilitares(), Api.referencias(), Api.listarAtividades()]).then(function (r) {
      if (!painelVigente(ctx)) { return; }
      ctx.militares = r[0] || [];
      ctx.ref = r[1];
      ctx.atividades = r[2] || [];
      ctx.alvo = id ? porId(ctx.militares, id) : null;
      var corpo = U.$('.painel__corpo', ctx.painel);
      if (id && !ctx.alvo) {
        corpo.innerHTML = '<div class="vazio"><span class="vazio__icone">' + icone('caixa') + '</span>' +
          '<strong>Cadastro não encontrado</strong><p>Este militar não existe mais (pode ter sido excluído por outro gestor).</p></div>';
        return;
      }
      ctx.pode = Regras.podeGerenciarMilitar(eu, ctx.alvo);
      var titulo = U.$('.painel__titulo', ctx.painel);
      if (titulo) { titulo.textContent = ctx.alvo ? Regras.nomeMilitar(ctx.alvo) : 'Novo militar'; }
      corpo.innerHTML = corpoMilitarHtml(ctx, extra);
      var caixaSenha = U.$('#mlSenhaValor', ctx.painel);
      if (caixaSenha && extra.senha) { caixaSenha.textContent = extra.senha; }
      extra = null;
      ligarPainelMilitar(ctx);
      if (!ctx.alvo && window.innerWidth >= 720) {
        var campo = U.$('#mlPosto', ctx.painel);
        try { campo.focus({ preventScroll: true }); } catch (e) { campo.focus(); }
      }
    }).catch(function (erro) {
      if (!painelVigente(ctx)) { return; }
      U.$('.painel__corpo', ctx.painel).innerHTML = erroHtml('Não foi possível abrir o cadastro', erro);
    });
  }

  function painelVigente(ctx) {
    return ctx.seq === seqPainel && !!ctx.painel && document.body.contains(ctx.painel);
  }

  function lerMilitar(ctx) {
    var p = ctx.painel;
    var papel = U.$('input[name="mlPapel"]:checked', p);
    var ativo = U.$('#mlAtivo', p);
    var alvo = ctx.alvo;
    var email = U.$('#mlEmail', p);
    return {
      posto: U.$('#mlPosto', p).value.trim(),
      nome_guerra: U.$('#mlNomeGuerra', p).value.trim(),
      nome_completo: U.$('#mlNomeCompleto', p).value.trim() || null,
      email: (alvo && alvo.usuario_id) ? alvo.email : (email.value.trim().toLowerCase() || null),
      setor_id: U.$('#mlSetor', p).value || null,
      papel: papel ? papel.value : (alvo ? alvo.papel : 'adjunto'),
      ativo: ativo ? !!ativo.checked : (alvo ? alvo.ativo !== false : true)
    };
  }

  function erroCampo(p, id, texto) {
    var campo = U.$('#' + id + 'Campo', p);
    var caixa = U.$('#' + id + 'Erro', p);
    if (campo) { campo.classList.toggle('campo--invalido', !!texto); }
    if (caixa) { caixa.textContent = texto || ''; }
  }

  function salvarMilitar(ctx) {
    var p = ctx.painel;
    var alvo = ctx.alvo;
    var eu = ctx.eu;
    var d = lerMilitar(ctx);
    var erros = [];
    if (!d.nome_guerra) { erros.push(['mlNomeGuerra', 'Informe o nome de guerra.']); }
    else if (d.nome_guerra.length > 80) { erros.push(['mlNomeGuerra', 'Use no máximo 80 caracteres.']); }
    if (d.posto.length > 30) { erros.push(['mlPosto', 'Use no máximo 30 caracteres.']); }
    if (d.email && !(alvo && alvo.usuario_id)) {
      var problema = validarEmail(d.email);
      if (problema) { erros.push(['mlEmail', problema]); }
      else if (achar(ctx.militares, function (m) { return m.email && m.email.toLowerCase() === d.email && (!alvo || m.id !== alvo.id); })) {
        erros.push(['mlEmail', 'Já existe um militar cadastrado com este e-mail.']);
      }
    }
    if (!Regras.podeGerenciarMilitar(eu, alvo, d.papel)) {
      erros.push(['mlPapel', 'Somente um administrador cria ou altera contas de administrador.']);
    }
    ['mlNomeGuerra', 'mlPosto', 'mlEmail', 'mlPapel'].forEach(function (id) { erroCampo(p, id, ''); });
    U.$('#mlErroForm', p).innerHTML = '';
    if (erros.length) {
      erros.forEach(function (e) { erroCampo(p, e[0], e[1]); });
      var primeiro = U.$('#' + erros[0][0] + 'Campo', p);
      if (primeiro) {
        try { primeiro.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e2) { /* navegador antigo */ }
        var foco = U.$('input', primeiro);
        if (foco) { foco.focus({ preventScroll: true }); }
      }
      return;
    }

    /* Mudanças que merecem uma pergunta antes. */
    if (alvo && alvo.id === eu.id && Regras.eGestor(eu) && d.papel === 'adjunto' &&
        !U.confirmar('Você vai passar o SEU papel para "Adjunto".\n\nAo salvar, você deixa de ser gestor: as telas de gestão ' +
          '(usuários, setores, auditoria…) deixam de aparecer para você. Continuar?')) { return; }
    if (d.papel === 'administrador' && (!alvo || alvo.papel !== 'administrador') &&
        !U.confirmar('Tornar este cadastro uma conta de ADMINISTRADOR (conta institucional da AQS)?\n\nEla tem todos os poderes ' +
          'da chefia, não recebe missões e só pode ser alterada por outro administrador. Use o e-mail institucional da AQS.')) { return; }
    if (alvo && alvo.papel === 'administrador' && d.papel !== 'administrador' &&
        !U.confirmar('Tirar o papel de administrador desta conta?\n\nSe ela for a única conta institucional, a ferramenta ' +
          'fica dependente de pessoas. Continuar?')) { return; }
    if (alvo && alvo.ativo !== false && d.ativo === false &&
        !U.confirmar('Desativar o cadastro de ' + Regras.nomeMilitar(alvo) + '?\n\nEle sai das listas de responsáveis. ' +
          'As atividades em que ele é responsável continuam com ele — reatribua-as se for o caso.')) { return; }

    var dadosMilitar = {
      posto: d.posto, nome_guerra: d.nome_guerra, nome_completo: d.nome_completo, email: d.email,
      setor_id: d.setor_id, papel: d.papel, ativo: d.ativo
    };
    if (alvo) { dadosMilitar.id = alvo.id; }
    var botao = U.$('#mlSalvar', p);
    ocupado(botao, true);
    Api.salvarMilitar(dadosMilitar).then(function (salvo) {
      App.recarregar(['militares']);
      if (!alvo) {
        U.torrada('Militar cadastrado.', 'sucesso');
        if (painelVigente(ctx) && salvo && salvo.id) {
          abrirMilitar(salvo.id, { mensagem: 'Cadastro criado. ' + (salvo.email
            ? 'Próximo passo: "Criar acesso", abaixo, para gerar a senha temporária.'
            : 'Para que ele entre no sistema, informe o e-mail e depois use "Criar acesso".') });
        }
        return;
      }
      U.torrada('Cadastro atualizado.', 'sucesso');
      if (painelVigente(ctx)) { abrirMilitar(alvo.id, { mensagem: 'Alterações salvas.' }); }
    }).catch(function (erro) {
      ocupado(botao, false);
      if (!painelVigente(ctx)) { U.falha(erro); return; }
      U.$('#mlErroForm', p).innerHTML = erroHtml('Não foi possível salvar', erro);
    });
  }

  var CONFIRMACOES_ACESSO = {
    criar: function (m) {
      return 'Criar o acesso de ' + Regras.nomeMilitar(m) + ' com o e-mail ' + m.email + '?\n\n' +
        'Será gerada uma senha temporária, mostrada uma única vez. A troca é exigida no primeiro acesso.';
    },
    redefinir_senha: function (m) {
      return 'Redefinir a senha de ' + Regras.nomeMilitar(m) + '?\n\nA senha atual deixa de valer na hora e uma nova senha ' +
        'temporária será mostrada uma única vez. Use quando o militar esqueceu a senha.';
    },
    remover_mfa: function (m) {
      return 'Remover a verificação em duas etapas de ' + Regras.nomeMilitar(m) + '?\n\nUse quando ele perdeu o celular do ' +
        'aplicativo autenticador. Ele entra só com a senha e pode cadastrar o segundo fator de novo em Minha conta.';
    },
    desativar: function (m) {
      return 'Desativar o acesso de ' + Regras.nomeMilitar(m) + '?\n\nEle deixa de entrar no sistema na hora e sai das listas de ' +
        'responsáveis. Nada é apagado e você pode reativar depois. As atividades em que ele é responsável continuam com ' +
        'ele — reatribua-as se for o caso.';
    },
    reativar: function (m) {
      return 'Reativar ' + Regras.nomeMilitar(m) + '?\n\nEle volta a entrar no sistema (com a senha que já tinha) e a ' +
        'aparecer nas listas de responsáveis.';
    }
  };

  var SUCESSO_ACESSO = {
    criar: 'Acesso criado.', redefinir_senha: 'Senha redefinida.', remover_mfa: 'Segundo fator removido.',
    desativar: 'Acesso desativado.', reativar: 'Acesso reativado.', alterar_email: 'E-mail de acesso alterado.'
  };

  function acaoAcesso(ctx, acao, botao, extraApi) {
    var alvo = ctx.alvo;
    if (acao !== 'alterar_email' && !U.confirmar(CONFIRMACOES_ACESSO[acao](alvo))) { return; }
    var caixaErro = U.$('#mlErroAcesso', ctx.painel);
    caixaErro.innerHTML = '';
    ocupado(botao, true);
    Api.adminUsuario(acao, alvo.id, extraApi).then(function (resultado) {
      resultado = resultado || {};
      U.torrada(SUCESSO_ACESSO[acao] || 'Feito.', 'sucesso');
      if (resultado.aviso) { U.torrada(resultado.aviso, 'atencao', 9000); }
      App.recarregar(['militares']);
      if (painelVigente(ctx)) {
        abrirMilitar(alvo.id, {
          senha: resultado.senha_temporaria || null,
          mensagem: resultado.senha_temporaria ? null : SUCESSO_ACESSO[acao],
          aviso: resultado.aviso || null
        });
      }
      resultado = null;
    }).catch(function (erro) {
      ocupado(botao, false);
      if (!painelVigente(ctx)) { U.falha(erro); return; }
      caixaErro.innerHTML = erroHtml('Não foi possível concluir a ação', erro);
      try { caixaErro.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* navegador antigo */ }
    });
  }

  function copiarSenha(ctx) {
    var codigo = U.$('#mlSenhaValor', ctx.painel);
    if (!codigo) { return; }
    function selecionar() {
      try {
        var faixa = document.createRange();
        faixa.selectNodeContents(codigo);
        var selecao = window.getSelection();
        selecao.removeAllRanges();
        selecao.addRange(faixa);
      } catch (e) { /* sem seleção programática */ }
      U.torrada('Senha selecionada: copie com Ctrl+C (no celular, toque e segure).', 'atencao', 6000);
    }
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      navigator.clipboard.writeText(codigo.textContent).then(function () {
        U.torrada('Senha copiada. Cole-a só onde for entregá-la.', 'sucesso');
      }, selecionar);
    } else {
      selecionar();
    }
  }

  function excluirMilitar(ctx, botao) {
    var alvo = ctx.alvo;
    var caixaErro = U.$('#mlErroExcluir', ctx.painel);
    caixaErro.innerHTML = '';
    ocupado(botao, true);
    Api.excluirMilitar(alvo.id).then(function (resultado) {
      U.torrada(Regras.nomeMilitar(alvo) + ' foi excluído. O histórico foi preservado.', 'sucesso', 6000);
      if (resultado && resultado.aviso) { U.torrada(resultado.aviso, 'atencao', 9000); }
      if (painelVigente(ctx)) { U.fecharPainel(); }
      App.recarregar(['militares', 'atividades', 'atividade_responsaveis']);
    }).catch(function (erro) {
      ocupado(botao, false);
      if (!painelVigente(ctx)) { U.falha(erro); return; }
      caixaErro.innerHTML = erroHtml('O militar não foi excluído', erro);
      try { caixaErro.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* navegador antigo */ }
    });
  }

  function reatribuirDoPainel(ctx, botao) {
    var alvo = ctx.alvo;
    var para = U.$('#mlReatribuirPara', ctx.painel).value;
    var caixaErro = U.$('#mlErroReatribuir', ctx.painel);
    caixaErro.innerHTML = '';
    if (!para) { caixaErro.innerHTML = '<p class="campo__erro-livre">Escolha quem vai assumir as atividades.</p>'; return; }
    var destino = porId(ctx.militares, para);
    var lista = atividadesDe(alvo.id, ctx.atividades);
    if (!U.confirmar('Passar ' + plural(lista.length, 'atividade', 'atividades') + ' de ' + Regras.nomeMilitar(alvo) + ' para ' +
        nomeExibido(destino) + '?\n\n' + lista.map(function (a) { return '• ' + a.titulo; }).join('\n') +
        '\n\n' + nomeExibido(destino) + ' será notificado de cada nova missão.')) { return; }
    ocupado(botao, true);
    reatribuir(lista, alvo.id, para).then(function (r) {
      App.recarregar(['atividades', 'atividade_responsaveis']);
      if (r.erro) {
        ocupado(botao, false);
        if (painelVigente(ctx)) {
          caixaErro.innerHTML = erroHtml('Reatribuídas ' + r.feitas + ' de ' + r.total + ' atividades', r.erro);
        } else { U.falha(r.erro); }
        return;
      }
      U.torrada(plural(r.feitas, 'atividade passou', 'atividades passaram') + ' para ' + nomeExibido(destino) + '.', 'sucesso');
      if (painelVigente(ctx)) {
        abrirMilitar(alvo.id, { mensagem: 'As atividades de ' + Regras.nomeMilitar(alvo) + ' agora estão com ' + nomeExibido(destino) + '.' });
      }
    });
  }

  function ligarPainelMilitar(ctx) {
    var p = ctx.painel;
    var form = U.$('#mlForm', p);
    if (form) {
      form.addEventListener('submit', function (evento) {
        evento.preventDefault();
        if (ctx.pode) { salvarMilitar(ctx); }
      });
      form.addEventListener('input', function (evento) {
        var campo = evento.target.closest ? evento.target.closest('.campo') : null;
        if (campo && campo.classList.contains('campo--invalido')) {
          campo.classList.remove('campo--invalido');
          var caixa = U.$('.campo__erro', campo);
          if (caixa) { caixa.textContent = ''; }
        }
      });
    }
    var formEmail = U.$('#mlEmailForm', p);
    if (formEmail) {
      formEmail.addEventListener('submit', function (evento) {
        evento.preventDefault();
        var novo = U.$('#mlNovoEmail', p).value.trim().toLowerCase();
        var problema = validarEmail(novo);
        if (!problema && ctx.alvo.email && novo === ctx.alvo.email.toLowerCase()) { problema = 'É o mesmo e-mail atual.'; }
        if (!problema && achar(ctx.militares, function (m) { return m.email && m.email.toLowerCase() === novo && m.id !== ctx.alvo.id; })) {
          problema = 'Este e-mail já está em uso por outro militar.';
        }
        erroCampo(p, 'mlNovoEmail', problema);
        if (problema) { return; }
        if (!U.confirmar('Trocar o e-mail de acesso de ' + Regras.nomeMilitar(ctx.alvo) + '?\n\nDe: ' + (ctx.alvo.email || '—') +
            '\nPara: ' + novo + '\n\nO militar passa a entrar com o novo e-mail; a senha continua a mesma.')) { return; }
        acaoAcesso(ctx, 'alterar_email', U.$('button[type="submit"]', formEmail), { email: novo });
      });
    }
    var formReatribuir = U.$('#mlReatribuirForm', p);
    if (formReatribuir) {
      formReatribuir.addEventListener('submit', function (evento) {
        evento.preventDefault();
        reatribuirDoPainel(ctx, U.$('button[type="submit"]', formReatribuir));
      });
    }
    var confirma = U.$('#mlConfirmaNome', p);
    if (confirma) {
      confirma.addEventListener('input', function () {
        var ok = U.normalizar(confirma.value.trim()) === U.normalizar(String(ctx.alvo.nome_guerra || '').trim()) && !!confirma.value.trim();
        U.$('#mlExcluir', p).disabled = !ok;
      });
    }
    p.addEventListener('click', function (evento) {
      var botao = evento.target.closest ? evento.target.closest('[data-ml-acao]') : null;
      if (!botao || !painelVigente(ctx)) { return; }
      var acao = botao.getAttribute('data-ml-acao');
      if (acao === 'cancelar') { U.fecharPainel(); }
      else if (acao === 'copiar-senha') { copiarSenha(ctx); }
      else if (acao === 'ocultar-senha') {
        var caixa = U.$('#mlSenhaCaixa', p);
        if (caixa) { caixa.remove(); }
      } else if (acao === 'mostrar-email') {
        U.$('#mlEmailForm', p).classList.remove('oculto');
        U.$('#mlNovoEmail', p).focus();
      } else if (acao === 'esconder-email') {
        U.$('#mlEmailForm', p).classList.add('oculto');
      } else if (acao === 'excluir') {
        excluirMilitar(ctx, botao);
      } else if (temPropria(CONFIRMACOES_ACESSO, acao)) {
        acaoAcesso(ctx, acao, botao);
      }
    });
  }

  /* =====================================================================
     Aba Passagem de chefia (assistente)
     ===================================================================== */

  function novoAssistente() {
    var chefes = (dados.militares || []).filter(function (m) { return m.papel === 'chefia' && m.ativo !== false; });
    return {
      passo: 1,
      de: chefes.length === 1 ? chefes[0].id : '',
      para: '',
      novo: { posto: '', nome_guerra: '', nome_completo: '', email: '', setor_id: '' },
      destino: 'adjunto',
      transferir: true,
      erros: {},
      executando: false,
      resultado: null
    };
  }

  function deMilitar() {
    return assistente.de && assistente.de !== 'nenhuma' ? porId(dados.militares, assistente.de) : null;
  }

  function paraMilitar() {
    return assistente.para && assistente.para !== 'novo' ? porId(dados.militares, assistente.para) : null;
  }

  function nomeQuemAssume() {
    if (assistente.para === 'novo') {
      return (assistente.novo.posto + ' ' + assistente.novo.nome_guerra).replace(/\s+/g, ' ').trim() || 'o novo militar';
    }
    return nomeExibido(paraMilitar());
  }

  /* Confere se o estado guardado ainda vale com os dados atuais (alguém
     pode ter excluído ou mudado um militar enquanto o assistente estava
     aberto). */
  function sanearAssistente() {
    var a = assistente;
    if (a.de && a.de !== 'nenhuma') {
      var de = porId(dados.militares, a.de);
      if (!de || de.papel !== 'chefia') { a.de = ''; if (a.passo > 1) { a.passo = 1; } }
    }
    if (a.para && a.para !== 'novo') {
      var para = porId(dados.militares, a.para);
      if (!para || !podeAssumirChefia(para) || para.id === a.de) { a.para = ''; if (a.passo > 2) { a.passo = 2; } }
    }
  }

  function passosHtml() {
    var rotulos = ['Quem sai', 'Quem assume', 'O que acontece', 'Confirmar'];
    return '<ol class="passos-assistente" aria-label="Etapas da passagem de chefia">' + rotulos.map(function (r, i) {
      var n = i + 1;
      var estado = assistente.passo > n ? 'feito' : (assistente.passo === n ? 'atual' : 'futuro');
      return '<li class="passos-assistente__item passos-assistente__item--' + estado + '"' + (estado === 'atual' ? ' aria-current="step"' : '') + '>' +
        '<span class="passos-assistente__numero">' + (estado === 'feito' ? '✓' : n) + '</span>' +
        '<span class="passos-assistente__rotulo">' + U.esc(r) + '</span></li>';
    }).join('') + '</ol>';
  }

  function opcaoRadio(nome, valor, marcado, tituloHtml, textoHtml, desabilitado) {
    return '<label class="opcao' + (desabilitado ? ' opcao--desabilitada' : '') + '"><input type="radio" name="' + nome + '" value="' + U.esc(valor) + '"' +
      (marcado ? ' checked' : '') + (desabilitado ? ' disabled' : '') + '><span class="opcao__texto"><strong>' + tituloHtml + '</strong>' +
      (textoHtml ? '<small>' + textoHtml + '</small>' : '') + '</span></label>';
  }

  function passo1Html() {
    var chefes = ordenarMilitares((dados.militares || []).filter(function (m) { return m.papel === 'chefia'; }));
    var opcoes = chefes.map(function (m) {
      return opcaoRadio('pcDe', m.id, assistente.de === m.id, U.esc(Regras.nomeMilitar(m)) + (m.id === dados.eu.id ? ' <em>(você)</em>' : ''),
        U.esc(['Chefia atual', m.ativo === false ? 'desativado' : '', m.usuario_id ? 'com acesso' : 'sem acesso'].filter(Boolean).join(' · ')));
    }).join('');
    opcoes += opcaoRadio('pcDe', 'nenhuma', assistente.de === 'nenhuma', 'Nenhuma — a chefia está vaga',
      'Use quando quem chefiava já foi excluído ou ainda não havia chefia cadastrada.');
    return '<h2 class="assistente__titulo">1. Quem deixa a chefia?</h2>' +
      '<div class="opcoes opcoes--lista">' + opcoes + '</div>' +
      '<div class="campo__erro-livre" role="alert">' + U.esc(assistente.erros.de || '') + '</div>' +
      '<div class="acoes acoes--direita"><button type="button" class="botao" data-pc-acao="avancar">Avançar</button></div>';
  }

  function passo2Html() {
    var a = assistente;
    var candidatos = ordenarMilitares((dados.militares || []).filter(function (m) {
      return podeAssumirChefia(m) && m.id !== a.de;
    }));
    var opcoes = candidatos.map(function (m) {
      var notas = [Regras.ROTULOS.papel[m.papel] || m.papel];
      if (m.papel === 'chefia') { notas.push('já é chefia'); }
      if (m.ativo === false) { notas.push('desativado — será reativado'); }
      notas.push(m.usuario_id ? 'com acesso' : 'sem acesso (crie depois)');
      return opcaoRadio('pcPara', m.id, a.para === m.id, U.esc(Regras.nomeMilitar(m)) + (m.id === dados.eu.id ? ' <em>(você)</em>' : ''),
        U.esc(notas.join(' · ')));
    }).join('');
    opcoes += opcaoRadio('pcPara', 'novo', a.para === 'novo', '+ Cadastrar um novo militar', 'Para quem chegou ao setor e ainda não tem cadastro.');
    var setores = '<option value="">Sem setor</option>' + ((dados.ref && dados.ref.setores) || []).map(function (s) {
      return opcao(s.id, s.sigla + ' — ' + s.nome, a.novo.setor_id === s.id);
    }).join('');
    var formNovo = '<div class="novo-militar' + (a.para === 'novo' ? '' : ' oculto') + '" id="pcNovo">' +
      '<div class="grade-form">' +
        '<div class="campo"><label for="pcNovoPosto">Posto/graduação</label><input type="text" id="pcNovoPosto" list="pcPostos" maxlength="30" ' +
          'autocomplete="off" data-pc-novo="posto" value="' + U.esc(a.novo.posto) + '"><datalist id="pcPostos">' +
          POSTOS.map(function (p) { return '<option value="' + U.esc(p) + '">'; }).join('') + '</datalist></div>' +
        '<div class="campo' + (a.erros.nome_guerra ? ' campo--invalido' : '') + '"><label for="pcNovoNome">Nome de guerra <span class="obrigatorio">*</span></label>' +
          '<input type="text" id="pcNovoNome" maxlength="80" autocomplete="off" data-pc-novo="nome_guerra" value="' + U.esc(a.novo.nome_guerra) + '">' +
          '<div class="campo__erro">' + U.esc(a.erros.nome_guerra || '') + '</div></div>' +
      '</div>' +
      '<div class="campo"><label for="pcNovoCompleto">Nome completo</label><input type="text" id="pcNovoCompleto" maxlength="200" autocomplete="off" ' +
        'data-pc-novo="nome_completo" value="' + U.esc(a.novo.nome_completo) + '"></div>' +
      '<div class="grade-form">' +
        '<div class="campo' + (a.erros.email ? ' campo--invalido' : '') + '"><label for="pcNovoEmail">E-mail</label>' +
          '<input type="email" id="pcNovoEmail" maxlength="254" autocomplete="off" inputmode="email" data-pc-novo="email" value="' + U.esc(a.novo.email) + '">' +
          '<span class="campo__dica">Para criar o acesso depois.</span><div class="campo__erro">' + U.esc(a.erros.email || '') + '</div></div>' +
        '<div class="campo"><label for="pcNovoSetor">Setor</label><select id="pcNovoSetor" data-pc-novo="setor_id">' + setores + '</select></div>' +
      '</div>' +
    '</div>';
    return '<h2 class="assistente__titulo">2. Quem assume a chefia?</h2>' +
      '<div class="opcoes opcoes--lista">' + opcoes + '</div>' + formNovo +
      '<div class="campo__erro-livre" role="alert">' + U.esc(a.erros.para || '') + '</div>' +
      '<p class="texto-pequeno texto-suave">A conta institucional da AQS não assume a chefia: ela não recebe missões.</p>' +
      '<div class="acoes acoes--entre"><button type="button" class="botao botao--secundario" data-pc-acao="voltar">Voltar</button>' +
        '<button type="button" class="botao" data-pc-acao="avancar">Avançar</button></div>';
  }

  function passo3Html() {
    var a = assistente;
    var de = deMilitar();
    if (!de) {
      return '<h2 class="assistente__titulo">3. O que acontece com quem sai</h2>' +
        '<p>Não há chefia anterior: nada a decidir aqui.</p>' +
        '<div class="acoes acoes--entre"><button type="button" class="botao botao--secundario" data-pc-acao="voltar">Voltar</button>' +
          '<button type="button" class="botao" data-pc-acao="avancar">Avançar</button></div>';
    }
    var nome = U.esc(Regras.nomeMilitar(de));
    var podeRetirar = Regras.podeExcluirMilitar(dados.eu, de);
    var motivo = de.id === dados.eu.id ? 'Você não pode desativar nem excluir a si mesmo: peça depois ao novo chefe ou à conta institucional.'
      : 'Sem permissão para esta conta.';
    var minhas = atividadesDe(de.id, dados.atividades);
    var transferencia = minhas.length
      ? '<label class="marcar marcar--linha mt-2"><input type="checkbox" id="pcTransferir"' + (a.transferir ? ' checked' : '') + '>' +
          '<span class="marcar__texto"><strong>' + (minhas.length === 1 ? 'Passar a atividade ativa' : 'Passar as ' + minhas.length +
          ' atividades ativas') + ' de ' + nome + ' para ' + U.esc(nomeQuemAssume()) + '</strong><small>' + U.esc(minhas.map(function (x) { return x.titulo; }).slice(0, 4).join('; ') +
          (minhas.length > 4 ? '; e mais ' + (minhas.length - 4) : '')) + '</small></span></label>'
      : '<p class="texto-pequeno texto-suave mt-2">' + nome + ' não é responsável por nenhuma atividade ativa.</p>';
    var alerta = '';
    if ((a.destino === 'excluir' || a.destino === 'desativar') && minhas.length && !a.transferir) {
      alerta = '<div class="aviso aviso--atencao mt-1"><span class="aviso__icone">' + icone('alerta') + '</span><div>' +
        'As atividades de ' + nome + ' continuarão com ' + (a.destino === 'excluir' ? 'ninguém no lugar dele (ficarão sem esse responsável)'
          : 'um militar desativado') + '. Recomendado: marque a opção de passá-las.</div></div>';
    }
    return '<h2 class="assistente__titulo">3. O que acontece com ' + nome + '?</h2>' +
      '<div class="opcoes opcoes--lista">' +
        opcaoRadio('pcDestino', 'adjunto', a.destino === 'adjunto', 'Passa a adjunto', 'Continua na equipe, executando missões.') +
        opcaoRadio('pcDestino', 'chefia', a.destino === 'chefia', 'Continua como chefia', 'Chefia compartilhada (ex.: período de transição).') +
        opcaoRadio('pcDestino', 'desativar', a.destino === 'desativar', 'Será desativado',
          podeRetirar ? 'Perde o acesso na hora; nada é apagado e dá para reativar.' : U.esc(motivo), !podeRetirar) +
        opcaoRadio('pcDestino', 'excluir', a.destino === 'excluir', 'Será excluído do sistema',
          podeRetirar ? 'Cadastro e login apagados; o histórico continua com o nome dele.' : U.esc(motivo), !podeRetirar) +
      '</div>' + transferencia + alerta +
      '<div class="acoes acoes--entre"><button type="button" class="botao botao--secundario" data-pc-acao="voltar">Voltar</button>' +
        '<button type="button" class="botao" data-pc-acao="avancar">Avançar</button></div>';
  }

  function resumoPassagem() {
    var a = assistente;
    var de = deMilitar();
    var para = paraMilitar();
    var nomePara = nomeQuemAssume();
    var itens = [];
    if (a.para === 'novo') { itens.push('O cadastro de ' + nomePara + ' será criado.'); }
    itens.push(nomePara + ' assume a chefia' + (para && para.ativo === false ? ' (e o cadastro é reativado)' : '') + '.');
    var minhas = de ? atividadesDe(de.id, dados.atividades) : [];
    if (de) {
      var nomeDe = Regras.nomeMilitar(de);
      itens.push({
        adjunto: nomeDe + ' passa a adjunto.',
        chefia: nomeDe + ' continua como chefia (chefia compartilhada).',
        desativar: nomeDe + ' passa a adjunto e é desativado (perde o acesso).',
        excluir: nomeDe + ' é excluído do sistema (o histórico é preservado com o nome dele).'
      }[a.destino]);
      if (minhas.length) {
        itens.push(a.transferir
          ? (minhas.length === 1 ? 'A atividade ativa de ' + nomeDe + ' passa para ' + nomePara + '.'
            : 'As ' + minhas.length + ' atividades ativas de ' + nomeDe + ' passam para ' + nomePara + '.')
          : 'As atividades de ' + nomeDe + ' continuam com ele' + (a.destino === 'excluir' ? ' — e ficam sem esse responsável quando ele for excluído.' : '.'));
      }
    }
    if (a.para === 'novo' || (para && !para.usuario_id)) {
      itens.push('Depois: criar o acesso de ' + nomePara + ' (ele ainda não tem login).');
    }
    return itens;
  }

  function passo4Html() {
    var a = assistente;
    var de = deMilitar();
    var euSaio = de && de.id === dados.eu.id && a.destino !== 'chefia';
    var para = paraMilitar();
    var novoSemAcesso = a.para === 'novo' || (para && !para.usuario_id);
    return '<h2 class="assistente__titulo">4. Confira e confirme</h2>' +
      '<ul class="lista-verificacao">' + resumoPassagem().map(function (t) { return '<li>' + U.esc(t) + '</li>'; }).join('') + '</ul>' +
      (euSaio ? '<div class="aviso aviso--atencao"><span class="aviso__icone">' + icone('alerta') + '</span><div>' +
        '<strong>Você deixará de ser gestor</strong>Ao confirmar, as telas de gestão deixam de aparecer para você. ' +
        'Antes, confira se os contatos institucionais (aba Continuidade) estão atualizados.' +
        /* Depois da passagem quem sai já não cria acessos: avisa enquanto
           ainda dá tempo (senão só a conta institucional ou outra chefia
           poderão criar o login de quem assume). */
        (novoSemAcesso ? ' <strong class="mt-1">' + U.esc(nomeQuemAssume()) + ' ainda não tem acesso.</strong>' +
          (a.para === 'novo'
            ? 'Depois de confirmar, só a conta institucional da AQS (ou outra chefia) poderá criar o login dele. Se preferir ' +
              'fazer isso você mesmo, volte, cadastre-o em Militares, crie o acesso e retome a passagem escolhendo-o na lista.'
            : 'Crie o acesso dele agora, em Militares → ' + U.esc(nomeQuemAssume()) + ' → "Criar acesso", e depois confirme: ' +
              'em seguida você não poderá mais fazê-lo.')
          : '') +
        '</div></div>' : '') +
      '<p class="texto-pequeno texto-suave">A passagem é gravada de uma vez (se algo falhar, nada muda) e fica registrada na auditoria.</p>' +
      '<div class="acoes acoes--entre"><button type="button" class="botao botao--secundario" data-pc-acao="voltar">Voltar</button>' +
        '<button type="button" class="botao botao--sucesso" data-pc-acao="confirmar"' + (a.executando ? ' disabled aria-busy="true"' : '') + '>' +
        icone('check') + (a.executando ? 'Executando…' : 'Confirmar a passagem de chefia') + '</button></div>';
  }

  function resultadoHtml() {
    var r = assistente.resultado;
    var para = r.paraId ? porId(dados.militares, r.paraId) : null;
    var semAcesso = para ? !para.usuario_id : r.paraSemAcesso;
    return '<h2 class="assistente__titulo">' + (r.ok ? 'Passagem de chefia concluída' : 'A passagem não foi concluída') + '</h2>' +
      '<ul class="lista-verificacao lista-verificacao--resultado">' + r.passos.map(function (p) {
        return '<li class="' + (p.ok ? 'item-ok' : 'item-falha') + '">' + U.esc(p.texto) + '</li>';
      }).join('') + '</ul>' +
      (r.erroHtml || '') +
      (r.ok ? '<h3 class="assistente__subtitulo">Próximos passos</h3><ul class="lista-simples">' +
        (semAcesso && r.paraId ? '<li>Crie o acesso de <strong>' + U.esc(para ? nomeExibido(para) : r.paraNome) + '</strong> e entregue a senha ' +
          'temporária pessoalmente. <button type="button" class="link-acao" data-pc-acao="abrir-novo">Criar o acesso agora</button></li>' : '') +
        '<li>Atualize os <a href="#/equipe?aba=continuidade">contatos institucionais</a> (responsável técnico, ramal).</li>' +
        '<li>Confira as <a href="#/atividades">atividades</a> e os responsáveis.</li>' +
      '</ul>' : '') +
      '<div class="acoes"><button type="button" class="botao botao--secundario" data-pc-acao="reiniciar">' +
        (r.ok ? 'Fazer outra passagem' : 'Recomeçar') + '</button></div>';
  }

  function assistenteHtml() {
    if (!assistente) { assistente = novoAssistente(); }
    sanearAssistente();
    var corpo;
    if (assistente.resultado) { corpo = resultadoHtml(); }
    else if (assistente.passo === 1) { corpo = passo1Html(); }
    else if (assistente.passo === 2) { corpo = passo2Html(); }
    else if (assistente.passo === 3) { corpo = passo3Html(); }
    else { corpo = passo4Html(); }
    var chefes = (dados.militares || []).filter(function (m) { return m.papel === 'chefia' && m.ativo !== false; });
    return '<div class="grade-assistente">' +
      '<div class="cartao assistente">' + (assistente.resultado ? '' : passosHtml()) + corpo + '</div>' +
      '<aside class="cartao cartao--nota">' +
        '<h3 class="secao-painel__titulo">' + icone('info') + 'Quando usar</h3>' +
        '<p class="texto-pequeno">Na troca de chefe do NSP/AQS. O assistente faz, de uma vez: promove quem assume, ' +
          'define o papel de quem sai e passa as missões dele.</p>' +
        '<p class="texto-pequeno"><strong>Chefia atual:</strong> ' + U.esc(chefes.length ? juntarNomes(chefes.map(Regras.nomeMilitar)) : 'nenhuma') + '</p>' +
        '<p class="texto-pequeno mb-0">Para só mudar o papel de alguém, use Militares → Gerenciar. Roteiro completo: <code>' +
          U.esc(CAMINHO_MANUAL) + '</code>.</p>' +
      '</aside>' +
    '</div>';
  }

  function validarPasso() {
    var a = assistente;
    a.erros = {};
    if (a.passo === 1 && !a.de) { a.erros.de = 'Escolha quem deixa a chefia (ou "Nenhuma").'; }
    if (a.passo === 2) {
      if (!a.para) { a.erros.para = 'Escolha quem assume a chefia.'; }
      if (a.para === 'novo') {
        if (!a.novo.nome_guerra.trim()) { a.erros.nome_guerra = 'Informe o nome de guerra.'; }
        var email = a.novo.email.trim().toLowerCase();
        if (email) {
          var problema = validarEmail(email);
          if (problema) { a.erros.email = problema; }
          else if (achar(dados.militares, function (m) { return m.email && m.email.toLowerCase() === email; })) {
            a.erros.email = 'Já existe um militar com este e-mail: escolha-o na lista acima.';
          }
        }
      }
    }
    if (a.passo === 3) {
      var de = deMilitar();
      if (de && (a.destino === 'desativar' || a.destino === 'excluir') && !Regras.podeExcluirMilitar(dados.eu, de)) {
        a.destino = 'adjunto';
      }
    }
    return !Object.keys(a.erros).length;
  }

  function executarPassagem(el) {
    var a = assistente;
    if (a.executando) { return; }
    var de = deMilitar();
    if (!U.confirmar('Confirmar a passagem de chefia?\n\n' + resumoPassagem().map(function (t) { return '• ' + t; }).join('\n'))) { return; }
    a.executando = true;
    desenharAba(el);
    var passos = [];
    var paraId = a.para === 'novo' ? null : a.para;
    var nomePara = nomeQuemAssume();
    var falhou = null;
    var etapa = Promise.resolve();

    if (a.para === 'novo') {
      etapa = etapa.then(function () {
        return Api.salvarMilitar({
          posto: a.novo.posto.trim(), nome_guerra: a.novo.nome_guerra.trim(), nome_completo: a.novo.nome_completo.trim() || null,
          email: a.novo.email.trim().toLowerCase() || null, setor_id: a.novo.setor_id || null, papel: 'adjunto', ativo: true
        }).then(function (m) {
          paraId = m.id;
          passos.push({ ok: true, texto: 'Cadastro de ' + nomePara + ' criado.' });
        });
      });
    }
    etapa = etapa.then(function () {
      return Api.transferirChefia({
        de: de ? de.id : null,
        para: paraId,
        papel_anterior: a.destino === 'chefia' ? 'chefia' : 'adjunto',
        transferir_atividades: !!de && a.transferir
      }).then(function () {
        passos.push({ ok: true, texto: nomePara + ' assumiu a chefia.' });
        if (de) {
          passos.push({ ok: true, texto: Regras.nomeMilitar(de) + (a.destino === 'chefia' ? ' continua como chefia.' : ' passou a adjunto.') });
          var qtd = atividadesDe(de.id, dados.atividades).length;
          if (a.transferir && qtd) { passos.push({ ok: true, texto: plural(qtd, 'atividade passou', 'atividades passaram') + ' para ' + nomePara + '.' }); }
        }
      });
    });
    if (de && (a.destino === 'desativar' || a.destino === 'excluir')) {
      etapa = etapa.then(function () {
        return Api.adminUsuario(a.destino, de.id).then(function (r) {
          passos.push({ ok: true, texto: Regras.nomeMilitar(de) + (a.destino === 'excluir' ? ' foi excluído (histórico preservado).' : ' foi desativado.') });
          if (r && r.aviso) { passos.push({ ok: true, texto: r.aviso }); }
        });
      });
    }
    etapa.catch(function (erro) {
      falhou = erro;
      var concluido = passos.length ? ' O que foi feito acima continua valendo.' : ' Nada foi alterado.';
      passos.push({ ok: false, texto: 'Interrompido: ' + U.erroTexto(erro) + concluido });
    }).then(function () {
      a.executando = false;
      a.resultado = {
        ok: !falhou, passos: passos, paraId: paraId, paraNome: nomePara,
        paraSemAcesso: a.para === 'novo',
        erroHtml: falhou ? erroHtml('Detalhe do erro', falhou) : ''
      };
      if (!falhou) { U.torrada('Passagem de chefia concluída.', 'sucesso', 6000); } else { U.falha(falhou); }
      App.recarregar(['militares', 'atividades', 'atividade_responsaveis']);
      if (U.$('.pagina-equipe', el) && abaAtual === 'chefia') { carregarAba(el); }
    });
  }

  function lerAssistente(el) {
    var a = assistente;
    var marcadoDe = U.$('input[name="pcDe"]:checked', el);
    if (marcadoDe) { a.de = marcadoDe.value; }
    var marcadoPara = U.$('input[name="pcPara"]:checked', el);
    if (marcadoPara) { a.para = marcadoPara.value; }
    var destino = U.$('input[name="pcDestino"]:checked', el);
    if (destino) { a.destino = destino.value; }
    var transferir = U.$('#pcTransferir', el);
    if (transferir) { a.transferir = !!transferir.checked; }
    U.$$('[data-pc-novo]', el).forEach(function (campo) { a.novo[campo.getAttribute('data-pc-novo')] = campo.value; });
  }

  function cliqueAssistente(el, botao) {
    var acao = botao.getAttribute('data-pc-acao');
    var a = assistente;
    if (!a) { return; }
    lerAssistente(el);
    if (acao === 'avancar') {
      if (!validarPasso()) { desenharAba(el); return; }
      a.passo = Math.min(4, a.passo + 1);
      if (a.passo === 2 && a.para && a.para === a.de) { a.para = ''; }
    } else if (acao === 'voltar') {
      a.erros = {};
      a.passo = Math.max(1, a.passo - 1);
    } else if (acao === 'confirmar') {
      executarPassagem(el);
      return;
    } else if (acao === 'reiniciar') {
      assistente = novoAssistente();
    } else if (acao === 'abrir-novo') {
      if (a.resultado && a.resultado.paraId) { abrirMilitar(a.resultado.paraId); }
      return;
    }
    desenharAba(el);
    var cartao = U.$('.assistente', el);
    if (cartao) { try { cartao.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { /* navegador antigo */ } }
  }

  /* =====================================================================
     Aba Setores
     ===================================================================== */

  function setoresHtml() {
    var setores = (dados.setores || []).slice().sort(function (a, b) {
      return ((Number(a.ordem) || 0) - (Number(b.ordem) || 0)) || U.ordenarTexto(a.sigla, b.sigla);
    });
    var topo = '<div class="flex flex--entre gap-1 mb-1"><p class="texto-pequeno texto-suave mb-0">Os setores organizam militares e ' +
      'atividades (filtros, plano e relatórios).</p><button type="button" class="botao" data-eq-acao="novo-setor">+ Novo setor</button></div>';
    if (!setores.length) {
      return topo + '<div class="vazio"><span class="vazio__icone">' + icone('quadro') + '</span><strong>Nenhum setor cadastrado</strong>' +
        '<p>Cadastre ao menos o NSP e a AQS.</p></div>';
    }
    var linhas = setores.map(function (s) {
      var militares = (dados.militares || []).filter(function (m) { return m.setor_id === s.id; }).length;
      var atividades = (dados.atividades || []).filter(function (a) { return a.setor_id === s.id; }).length;
      var emUso = militares + atividades > 0;
      return '<tr>' +
        '<td data-rotulo="Cor"><span class="amostra-cor" data-cor="' + U.esc(s.cor || '') + '" aria-hidden="true"></span>' +
          '<span class="so-leitor-tela">' + U.esc(s.cor || '') + '</span></td>' +
        '<td data-rotulo="Sigla" class="col-principal"><strong>' + U.esc(s.sigla) + '</strong></td>' +
        '<td data-rotulo="Nome">' + U.esc(s.nome) + '</td>' +
        '<td data-rotulo="Ordem" class="col-numerica">' + U.esc(s.ordem === null || s.ordem === undefined ? 0 : s.ordem) + '</td>' +
        '<td data-rotulo="Militares" class="col-numerica">' + militares + '</td>' +
        '<td data-rotulo="Atividades" class="col-numerica">' + atividades + '</td>' +
        '<td data-rotulo="Ações" class="alinhar-direita col-acoes">' +
          '<button type="button" class="botao botao--secundario botao--pequeno" data-eq-acao="editar-setor" data-id="' + U.esc(s.id) + '">Editar</button> ' +
          '<button type="button" class="botao botao--perigo-secundario botao--pequeno" data-eq-acao="excluir-setor" data-id="' + U.esc(s.id) + '"' +
            (emUso ? ' disabled title="Em uso: mova os militares e as atividades para outro setor antes"' : '') + '>Excluir</button>' +
        '</td>' +
      '</tr>';
    }).join('');
    return topo + '<div class="cartao cartao--tabela"><div class="tabela-rolagem"><table class="tabela tabela--gestao tabela-cartoes">' +
      '<caption class="so-leitor-tela">Setores</caption>' +
      '<thead><tr><th scope="col">Cor</th><th scope="col">Sigla</th><th scope="col">Nome</th><th scope="col" class="col-numerica">Ordem</th>' +
        '<th scope="col" class="col-numerica">Militares</th><th scope="col" class="col-numerica">Atividades</th>' +
        '<th scope="col"><span class="so-leitor-tela">Ações</span></th></tr></thead>' +
      '<tbody>' + linhas + '</tbody></table></div></div>' +
      '<p class="texto-pequeno texto-suave">Um setor em uso não pode ser excluído: antes, mude o setor dos militares e das atividades.</p>';
  }

  function abrirSetor(setor) {
    seqPainel += 1;
    var meu = seqPainel;
    var painel = null;
    var s = setor || { sigla: '', nome: '', cor: '#1b5aa8', ordem: '' };
    U.abrirPainel(setor ? 'Editar setor' : 'Novo setor',
      '<form id="stForm" novalidate>' +
        '<div class="grade-form">' +
          campoHtml('stSigla', 'Sigla <span class="obrigatorio">*</span>', '<input type="text" id="stSigla" maxlength="15" autocomplete="off" value="' +
            U.esc(s.sigla) + '">', 'Até 15 caracteres, ex.: NSP.') +
          campoHtml('stOrdem', 'Ordem', '<input type="number" id="stOrdem" step="1" min="-9999" max="9999" inputmode="numeric" value="' +
            U.esc(s.ordem === null || s.ordem === undefined ? '' : s.ordem) + '">', 'Posição nas listas (menor primeiro).') +
        '</div>' +
        campoHtml('stNome', 'Nome <span class="obrigatorio">*</span>', '<input type="text" id="stNome" maxlength="100" autocomplete="off" value="' +
          U.esc(s.nome) + '">', '') +
        campoHtml('stCor', 'Cor', '<input type="color" id="stCor" class="campo-cor" value="' + U.esc(COR_VALIDA.test(s.cor || '') ? s.cor : '#1b5aa8') + '">',
          'Usada para identificar o setor.') +
        '<div id="stErro"></div>' +
        '<div class="acoes acoes--direita"><button type="button" class="botao botao--secundario" data-st-acao="cancelar">Cancelar</button>' +
          '<button type="submit" class="botao" id="stSalvar">' + (setor ? 'Salvar alterações' : 'Cadastrar setor') + '</button></div>' +
      '</form>', function (p) { painel = p; });
    App.aoAtualizarPainel(null);
    var form = U.$('#stForm', painel);
    form.addEventListener('click', function (evento) {
      if (evento.target.closest && evento.target.closest('[data-st-acao="cancelar"]')) { U.fecharPainel(); }
    });
    form.addEventListener('submit', function (evento) {
      evento.preventDefault();
      var sigla = U.$('#stSigla', form).value.trim().toUpperCase();
      var nome = U.$('#stNome', form).value.trim();
      var ordem = U.$('#stOrdem', form).value.trim();
      var cor = U.$('#stCor', form).value;
      erroCampo(form, 'stSigla', !sigla ? 'Informe a sigla.' : (sigla.length > 15 ? 'Use no máximo 15 caracteres.' : ''));
      erroCampo(form, 'stNome', nome ? '' : 'Informe o nome do setor.');
      erroCampo(form, 'stOrdem', ordem && !/^-?\d+$/.test(ordem) ? 'Use um número inteiro.' : '');
      if (U.$('.campo--invalido', form)) { return; }
      var botao = U.$('#stSalvar', form);
      ocupado(botao, true);
      var dadosSetor = { sigla: sigla, nome: nome, cor: COR_VALIDA.test(cor) ? cor : '#1b5aa8', ordem: ordem === '' ? null : Number(ordem) };
      if (setor) { dadosSetor.id = setor.id; }
      Api.salvarSetor(dadosSetor).then(function () {
        U.torrada(setor ? 'Setor atualizado.' : 'Setor cadastrado.', 'sucesso');
        if (meu === seqPainel && painel && document.body.contains(painel)) { U.fecharPainel(); }
        App.recarregar(['setores']);
      }).catch(function (erro) {
        ocupado(botao, false);
        U.$('#stErro', form).innerHTML = erroHtml('Não foi possível salvar', erro);
      });
    });
    if (window.innerWidth >= 720) { U.$('#stSigla', form).focus(); }
  }

  function excluirSetor(botao, setor) {
    if (!U.confirmar('Excluir o setor ' + setor.sigla + ' — ' + setor.nome + '?')) { return; }
    ocupado(botao, true);
    Api.excluirSetor(setor.id).then(function () {
      U.torrada('Setor excluído.', 'sucesso');
      App.recarregar(['setores']);
    }).catch(function (erro) {
      ocupado(botao, false);
      U.falha(erro);
    });
  }

  /* =====================================================================
     Aba Feriados
     ===================================================================== */

  /* Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher). */
  function pascoa(ano) {
    var a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
    var d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    var g = Math.floor((b - f + 1) / 3);
    var h = (19 * a + b - d - g + 15) % 30;
    var i = Math.floor(c / 4), k = c % 4;
    var l = (32 + 2 * e + 2 * i - h - k) % 7;
    var m = Math.floor((a + 11 * h + 22 * l) / 451);
    var mes = Math.floor((h + l - 7 * m + 114) / 31);
    var dia = ((h + l - 7 * m + 114) % 31) + 1;
    return ano + '-' + (mes < 10 ? '0' : '') + mes + '-' + (dia < 10 ? '0' : '') + dia;
  }

  /* Os mesmos da carga inicial (supabase/04-dados-iniciais.sql): nacionais,
     do Pará e de Belém. Pontos facultativos (Carnaval, Corpus Christi…)
     ficam de fora: dependem do expediente definido pelo Comando. */
  function feriadosPadrao(ano) {
    return [
      { data: ano + '-01-01', descricao: 'Confraternização Universal' },
      { data: Recorrencia.somarDias(pascoa(ano), -2), descricao: 'Sexta-feira da Paixão' },
      { data: ano + '-04-21', descricao: 'Tiradentes' },
      { data: ano + '-05-01', descricao: 'Dia do Trabalho' },
      { data: ano + '-08-15', descricao: 'Adesão do Pará à Independência' },
      { data: ano + '-09-07', descricao: 'Independência do Brasil' },
      { data: ano + '-10-12', descricao: 'Nossa Senhora Aparecida' },
      { data: ano + '-11-02', descricao: 'Finados' },
      { data: ano + '-11-15', descricao: 'Proclamação da República' },
      { data: ano + '-11-20', descricao: 'Dia Nacional de Zumbi e da Consciência Negra' },
      { data: ano + '-12-08', descricao: 'Nossa Senhora da Conceição (Belém)' },
      { data: ano + '-12-25', descricao: 'Natal' }
    ];
  }

  var DIAS_ISO = ['', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado', 'domingo'];

  function feriadosHtml() {
    var hoje = dados.hoje;
    var anoHoje = Number(hoje.slice(0, 4));
    var lista = (dados.feriados || []).slice().sort(function (a, b) { return a.data < b.data ? -1 : 1; });
    var anos = {};
    anos[anoHoje] = true;
    anos[anoHoje + 1] = true;
    lista.forEach(function (f) { anos[Number(String(f.data).slice(0, 4))] = true; });
    if (!anoFeriados || !anos[anoFeriados]) { anoFeriados = anoHoje; }
    var listaAnos = Object.keys(anos).map(Number).sort();
    var doAno = lista.filter(function (f) { return Number(String(f.data).slice(0, 4)) === anoFeriados; });
    var datas = {};
    doAno.forEach(function (f) { datas[f.data] = true; });
    var faltando = feriadosPadrao(anoFeriados).filter(function (f) { return !datas[f.data]; });
    var semProximo = hoje.slice(5) >= '11-01' && !lista.some(function (f) { return Number(String(f.data).slice(0, 4)) === anoHoje + 1; });
    var r = rascunhoFeriado;

    var alerta = semProximo
      ? '<div class="aviso aviso--atencao"><span class="aviso__icone">' + icone('alerta') + '</span><div><strong>Cadastre os feriados de ' +
          (anoHoje + 1) + '</strong>Sem eles, os prazos que caírem em feriado não são antecipados para o dia útil anterior.</div></div>'
      : '';

    var form = '<form class="cartao form-feriado" id="frForm" novalidate>' +
      '<h3 class="secao-painel__titulo">' + (r.original ? 'Editar feriado de ' + U.esc(U.formatarData(r.original)) : 'Incluir feriado') + '</h3>' +
      '<div class="form-feriado__campos">' +
        '<div class="campo" id="frDataCampo"><label for="frData">Data <span class="obrigatorio">*</span></label>' +
          '<input type="date" id="frData" value="' + U.esc(r.data) + '"><div class="campo__erro" id="frDataErro" role="alert"></div></div>' +
        '<div class="campo cresce" id="frDescricaoCampo"><label for="frDescricao">Descrição <span class="obrigatorio">*</span></label>' +
          '<input type="text" id="frDescricao" maxlength="120" autocomplete="off" value="' + U.esc(r.descricao) + '" placeholder="Ex.: Círio de Nazaré (ponto facultativo)">' +
          '<div class="campo__erro" id="frDescricaoErro" role="alert"></div></div>' +
        '<div class="form-feriado__botoes">' +
          '<button type="submit" class="botao" id="frSalvar">' + (r.original ? 'Salvar' : 'Incluir') + '</button>' +
          (r.original ? '<button type="button" class="botao botao--secundario" data-eq-acao="cancelar-feriado">Cancelar</button>' : '') +
        '</div>' +
      '</div>' +
      '<div id="frErro"></div>' +
    '</form>';

    var seletor = '<div class="segmentos" role="group" aria-label="Ano">' + listaAnos.map(function (ano) {
      var ativo = ano === anoFeriados;
      return '<button type="button" class="segmentos__opcao' + (ativo ? ' segmentos__opcao--ativa' : '') + '" data-ano="' + ano +
        '" aria-pressed="' + (ativo ? 'true' : 'false') + '">' + ano + '</button>';
    }).join('') + '</div>';

    var padrao = faltando.length
      ? '<div class="aviso"><span class="aviso__icone">' + icone('info') + '</span><div>' +
          '<strong>' + (doAno.length ? (faltando.length === 1 ? 'Falta 1 feriado padrão' : 'Faltam ' + faltando.length + ' feriados padrão')
            : 'Nenhum feriado em ' + anoFeriados) + '</strong>' +
          'Os feriados nacionais, do Pará e de Belém podem ser incluídos de uma vez (' + U.esc(faltando.map(function (f) { return U.formatarDataCurta(f.data); }).join(', ')) + '). ' +
          'Pontos facultativos (Carnaval, Corpus Christi, Círio) dependem do expediente: inclua à mão, se for o caso.' +
          '<div class="acoes acoes--topo mt-1"><button type="button" class="botao botao--secundario botao--pequeno" data-eq-acao="feriados-padrao">' +
            'Incluir os feriados padrão de ' + anoFeriados + '</button></div></div></div>'
      : '';

    var tabela = !doAno.length
      ? '<div class="vazio"><span class="vazio__icone">' + icone('plano') + '</span><strong>Nenhum feriado em ' + anoFeriados + '</strong>' +
          '<p>Os prazos que caírem em feriado só são antecipados se o feriado estiver cadastrado aqui.</p></div>'
      : '<div class="cartao cartao--tabela"><div class="tabela-rolagem"><table class="tabela tabela--gestao tabela-cartoes">' +
          '<caption class="so-leitor-tela">Feriados de ' + anoFeriados + '</caption>' +
          '<thead><tr><th scope="col">Data</th><th scope="col">Dia da semana</th><th scope="col">Descrição</th>' +
            '<th scope="col"><span class="so-leitor-tela">Ações</span></th></tr></thead><tbody>' +
          doAno.map(function (f) {
            var ds = Recorrencia.diaSemana(f.data);
            var passado = f.data < hoje;
            return '<tr' + (passado ? ' class="linha-passada"' : '') + '>' +
              '<td data-rotulo="Data" class="col-principal"><strong>' + U.esc(U.formatarData(f.data)) + '</strong></td>' +
              '<td data-rotulo="Dia">' + U.esc(DIAS_ISO[ds] || '') + (ds >= 6 ? ' <span class="texto-suave texto-pequeno">(fim de semana)</span>' : '') + '</td>' +
              '<td data-rotulo="Descrição">' + U.esc(f.descricao) + '</td>' +
              '<td data-rotulo="Ações" class="alinhar-direita col-acoes">' +
                '<button type="button" class="botao botao--secundario botao--pequeno" data-eq-acao="editar-feriado" data-data="' + U.esc(f.data) + '">Editar</button> ' +
                '<button type="button" class="botao botao--perigo-secundario botao--pequeno" data-eq-acao="excluir-feriado" data-data="' + U.esc(f.data) + '">Excluir</button>' +
              '</td></tr>';
          }).join('') + '</tbody></table></div></div>';

    return alerta +
      '<p class="texto-pequeno texto-suave">Dia útil = segunda a sexta que não esteja nesta lista. Prazos que caem em feriado ou fim de ' +
        'semana são antecipados para o dia útil anterior (quando a atividade pede). Cadastre os do ano seguinte todo fim de ano.</p>' +
      form +
      '<div class="flex flex--entre gap-1 mb-1"><h3 class="titulo-secao mb-0 cresce">Feriados de ' + anoFeriados + ' (' + doAno.length + ')</h3>' + seletor + '</div>' +
      padrao + tabela;
  }

  function salvarFeriado(el) {
    var form = U.$('#frForm', el);
    var data = U.$('#frData', form).value;
    var descricao = U.$('#frDescricao', form).value.trim();
    var original = rascunhoFeriado.original;
    erroCampo(form, 'frData', Recorrencia.dataValida(data) ? '' : 'Informe a data.');
    erroCampo(form, 'frDescricao', descricao ? '' : 'Informe a descrição.');
    if (U.$('.campo--invalido', form)) { return; }
    var existente = achar(dados.feriados, function (f) { return f.data === data; });
    if (existente && data !== original) {
      erroCampo(form, 'frData', 'Já existe um feriado nesta data: ' + existente.descricao + '.');
      return;
    }
    var botao = U.$('#frSalvar', form);
    ocupado(botao, true);
    /* Mudou a data de um feriado: grava o novo e depois apaga o antigo
       (assim, se algo falhar no meio, nenhum feriado some). */
    Api.salvarFeriado({ data: data, descricao: descricao }).then(function () {
      if (original && original !== data) { return Api.excluirFeriado(original); }
      return null;
    }).then(function () {
      U.torrada(original ? 'Feriado atualizado.' : 'Feriado incluído.', 'sucesso');
      rascunhoFeriado = { data: '', descricao: '', original: null };
      anoFeriados = Number(data.slice(0, 4));
      App.recarregar(['feriados']);
    }).catch(function (erro) {
      ocupado(botao, false);
      U.$('#frErro', form).innerHTML = erroHtml('Não foi possível salvar o feriado', erro);
    });
  }

  function incluirPadrao(botao) {
    var datas = {};
    (dados.feriados || []).forEach(function (f) { datas[f.data] = true; });
    var faltando = feriadosPadrao(anoFeriados).filter(function (f) { return !datas[f.data]; });
    if (!faltando.length) { return; }
    if (!U.confirmar('Incluir ' + plural(faltando.length, 'feriado', 'feriados') + ' de ' + anoFeriados + '?\n\n' +
        faltando.map(function (f) { return '• ' + U.formatarData(f.data) + ' — ' + f.descricao; }).join('\n'))) { return; }
    ocupado(botao, true);
    var feitos = 0;
    faltando.reduce(function (p, f) {
      return p.then(function () { return Api.salvarFeriado(f).then(function () { feitos += 1; }); });
    }, Promise.resolve()).then(function () {
      U.torrada(plural(feitos, 'feriado incluído', 'feriados incluídos') + ' em ' + anoFeriados + '.', 'sucesso');
    }, function (erro) {
      U.falha(erro);
      if (feitos) { U.torrada(plural(feitos, 'feriado foi incluído', 'feriados foram incluídos') + ' antes do erro.', 'atencao'); }
    }).then(function () {
      ocupado(botao, false);
      App.recarregar(['feriados']);
    });
  }

  function excluirFeriado(botao, data) {
    var f = achar(dados.feriados, function (x) { return x.data === data; });
    if (!f || !U.confirmar('Excluir o feriado de ' + U.formatarData(data) + ' (' + f.descricao + ')?\n\n' +
        'Prazos que caírem nesse dia deixam de ser antecipados.')) { return; }
    ocupado(botao, true);
    Api.excluirFeriado(data).then(function () {
      U.torrada('Feriado excluído.', 'sucesso');
      if (rascunhoFeriado.original === data) { rascunhoFeriado = { data: '', descricao: '', original: null }; }
      App.recarregar(['feriados']);
    }).catch(function (erro) {
      ocupado(botao, false);
      U.falha(erro);
    });
  }

  /* =====================================================================
     Aba Continuidade
     ===================================================================== */

  function contatosAtuais() {
    var c = (dados.configuracoes && dados.configuracoes.contatos) || {};
    return {
      email_institucional: String(c.email_institucional || ''),
      responsavel_tecnico: String(c.responsavel_tecnico || ''),
      telefone: String(c.telefone || ''),
      observacoes: String(c.observacoes || '')
    };
  }

  function alertasHtml() {
    var alertas = [];
    try {
      alertas = Regras.alertasContinuidade({
        militares: dados.militares, atividades: dados.atividades, feriados: dados.feriados,
        configuracoes: dados.configuracoes, hoje: dados.hoje, militar: dados.eu
      }) || [];
    } catch (e) { console.error(e); }
    if (!alertas.length) {
      return '<div class="aviso aviso--sucesso"><span class="aviso__icone">' + icone('check') + '</span><div><strong>Tudo em ordem</strong>' +
        'Há conta institucional e mais de um gestor com acesso, cópia de segurança recente, contatos preenchidos e nenhuma ' +
        'atividade sem responsável.</div></div>';
    }
    var icones = { urgente: 'alerta', atencao: 'alerta', info: 'info' };
    return '<div class="alertas-gestao">' + alertas.map(function (a) {
      var nivel = temPropria(icones, a.nivel) ? a.nivel : 'info';
      var link = /^#\/[a-z]+(\?[a-z_]+=[a-z0-9_-]+)?$/i.test(String(a.link || '')) ? a.link : '';
      return '<div class="aviso alerta-gestao alerta-gestao--' + nivel + (nivel === 'urgente' ? ' aviso--urgente' : (nivel === 'atencao' ? ' aviso--atencao' : '')) + '">' +
        '<span class="aviso__icone">' + icone(icones[nivel]) + '</span><div><strong>' + U.esc(a.titulo) + '</strong>' + U.esc(a.texto) +
        (link && link !== '#/equipe?aba=continuidade' ? ' <a class="link-forte" href="' + U.esc(link) + '">Resolver</a>' : '') + '</div></div>';
    }).join('') + '</div>';
  }

  function contatosHtml() {
    var c = rascunhoContatos || contatosAtuais();
    return '<form class="cartao" id="ctForm" novalidate>' +
      '<div class="cartao__titulo"><h2>' + icone('info') + 'Contatos institucionais</h2></div>' +
      '<p class="texto-pequeno texto-suave">A quem recorrer quando ninguém souber o que fazer. Use contatos <strong>institucionais</strong> ' +
        '(e-mail e ramal da AQS), não pessoais: assim a orientação continua válida quando a equipe mudar.</p>' +
      campoHtml('ctEmail', 'E-mail institucional da AQS', '<input type="email" id="ctEmail" maxlength="254" autocomplete="off" data-ct="email_institucional" value="' +
        U.esc(c.email_institucional) + '">', 'É também o e-mail da conta de administrador e o dono dos serviços (Supabase, hospedagem).') +
      campoHtml('ctResponsavel', 'Responsável técnico atual', '<input type="text" id="ctResponsavel" maxlength="200" autocomplete="off" data-ct="responsavel_tecnico" value="' +
        U.esc(c.responsavel_tecnico) + '">', 'Quem mantém a ferramenta hoje (posto, nome, setor). Atualize na passagem da função.') +
      campoHtml('ctTelefone', 'Telefone / ramal', '<input type="tel" id="ctTelefone" maxlength="60" autocomplete="off" data-ct="telefone" value="' +
        U.esc(c.telefone) + '">', '') +
      campoHtml('ctObservacoes', 'Observações', '<textarea id="ctObservacoes" rows="4" maxlength="2000" data-ct="observacoes">' +
        U.esc(c.observacoes) + '</textarea>', 'Ex.: onde fica a pasta das cópias de segurança e o cofre de senhas da AQS.') +
      '<div id="ctErro"></div>' +
      '<div class="acoes acoes--direita">' +
        (rascunhoContatos ? '<span class="texto-pequeno texto-atencao-gestao">Alterações não salvas.</span>' +
          '<button type="button" class="botao botao--secundario" data-eq-acao="descartar-contatos">Descartar</button>' : '') +
        '<button type="submit" class="botao" id="ctSalvar">Salvar contatos</button>' +
      '</div>' +
    '</form>';
  }

  function backupHtml() {
    var b = dados.configuracoes && dados.configuracoes.ultimo_backup;
    var quando = b && b.em ? b.em : null;
    var dias = quando ? Recorrencia.diasEntre(U.formatarDataHora(quando).slice(0, 10).split('/').reverse().join('-'), dados.hoje) : null;
    var situacao = !quando
      ? '<p class="texto-urgente-gestao">Nenhuma cópia de segurança registrada.</p>'
      : '<p>Última: <strong>' + U.esc(U.formatarDataHora(quando)) + '</strong>' + (b.por_nome ? ' por ' + U.esc(b.por_nome) : '') +
        (dias !== null ? ' <span class="' + (dias > 35 ? 'texto-urgente-gestao' : 'texto-suave') + '">(há ' + U.esc(plural(dias, 'dia', 'dias')) + ')</span>' : '') + '</p>';
    return '<section class="cartao">' +
      '<div class="cartao__titulo"><h2>' + icone('caixa') + 'Cópia de segurança</h2></div>' +
      situacao +
      '<p class="texto-pequeno texto-suave">Uma vez por mês, exporte tudo e guarde o arquivo na pasta da AQS (rede do HABE) — nunca em ' +
        'computador pessoal ou e-mail particular: ele traz os dados da equipe (LGPD). Os arquivos de evidência ficam no Supabase e não ' +
        'entram no arquivo.</p>' +
      '<div class="acoes acoes--topo"><button type="button" class="botao" data-eq-acao="exportar">Exportar tudo (JSON)</button></div>' +
    '</section>';
  }

  function gestoresHtml() {
    var gestores = ordenarMilitares((dados.militares || []).filter(function (m) {
      return m.ativo !== false && (m.papel === 'chefia' || m.papel === 'administrador');
    }));
    var comAcesso = gestores.filter(function (m) { return !!m.usuario_id; });
    var temAdm = comAcesso.some(function (m) { return m.papel === 'administrador'; });
    return '<section class="cartao">' +
      '<div class="cartao__titulo"><h2>' + icone('escudo') + 'Gestores com acesso</h2>' +
        '<span class="contador' + (comAcesso.length >= 2 && temAdm ? '' : ' contador--urgente') + '">' + comAcesso.length + '</span></div>' +
      '<p class="texto-pequeno texto-suave">Quem consegue administrar a ferramenta hoje. O recomendado: a conta institucional da AQS ' +
        '<strong>e</strong> ao menos uma chefia, cada uma com acesso.</p>' +
      (gestores.length ? '<ul class="lista-gestores">' + gestores.map(function (m) {
        return '<li><div class="cresce"><strong>' + U.esc(Regras.nomeMilitar(m)) + '</strong>' +
          '<span class="linha-regra">Último acesso: ' + U.esc(ultimoAcessoTexto(m)) + '</span></div>' +
          seloPapel(m) + seloAcesso(m) + '</li>';
      }).join('') + '</ul>' : '<p class="texto-urgente-gestao">Nenhum gestor ativo.</p>') +
      '<div class="acoes acoes--topo"><a class="botao botao--secundario botao--pequeno" href="#/equipe?aba=militares">Ir para Militares</a>' +
        '<a class="botao botao--secundario botao--pequeno" href="#/equipe?aba=chefia">Passagem de chefia</a></div>' +
    '</section>';
  }

  function roteiroHtml() {
    return '<section class="cartao cartao--destaque">' +
      '<div class="cartao__titulo"><h2>' + icone('plano') + 'Plano de continuidade — resumo</h2></div>' +
      '<p class="texto-pequeno">O roteiro completo (com o passo a passo de recuperação) está no arquivo <code>' + U.esc(CAMINHO_MANUAL) +
        '</code>, junto com o código da ferramenta. Em resumo:</p>' +
      '<ol class="lista-roteiro">' +
        '<li><strong>Conta institucional:</strong> a conta de Administrador usa o e-mail institucional da AQS. A senha e a chave do ' +
          'segundo fator ficam sob a guarda da AQS (cofre/envelope lacrado), não de uma pessoa.</li>' +
        '<li><strong>Dois gestores sempre:</strong> mantenha a conta institucional e ao menos uma chefia com acesso. O sistema impede ' +
          'remover o último gestor.</li>' +
        '<li><strong>Quando alguém sair:</strong> faça a Passagem de chefia (se for o chefe), reatribua as atividades e desative ou ' +
          'exclua o acesso. O histórico fica preservado com o nome da pessoa.</li>' +
        '<li><strong>Quando o responsável técnico sair:</strong> transfira a titularidade dos serviços (Supabase, hospedagem, ' +
          'repositório do código) para o e-mail institucional e atualize os contatos acima.</li>' +
        '<li><strong>Todo mês:</strong> exporte a cópia de segurança. <strong>Todo fim de ano:</strong> cadastre os feriados do ano seguinte.</li>' +
        '<li><strong>Emergência</strong> (ninguém consegue entrar como gestor): o dono do projeto no Supabase religa a conta ' +
          'institucional pelo SQL Editor com <code>privado.vincular_usuario</code> — instruções no manual.</li>' +
      '</ol>' +
    '</section>';
  }

  function continuidadeHtml() {
    return '<h2 class="titulo-secao">Alertas</h2>' + alertasHtml() +
      '<div class="grade-continuidade">' +
        '<div class="grade-continuidade__coluna">' + contatosHtml() + backupHtml() + '</div>' +
        '<div class="grade-continuidade__coluna">' + gestoresHtml() + roteiroHtml() + '</div>' +
      '</div>';
  }

  function salvarContatos(el) {
    var form = U.$('#ctForm', el);
    var valor = {};
    U.$$('[data-ct]', form).forEach(function (campo) { valor[campo.getAttribute('data-ct')] = campo.value.trim(); });
    var problema = valor.email_institucional ? validarEmail(valor.email_institucional) : null;
    erroCampo(form, 'ctEmail', problema);
    if (problema) { U.$('#ctEmail', form).focus(); return; }
    var botao = U.$('#ctSalvar', form);
    ocupado(botao, true);
    Api.salvarConfiguracao('contatos', valor).then(function () {
      rascunhoContatos = null;
      U.torrada('Contatos institucionais salvos.', 'sucesso');
      App.recarregar(['configuracoes']);
    }).catch(function (erro) {
      ocupado(botao, false);
      U.$('#ctErro', form).innerHTML = erroHtml('Não foi possível salvar', erro);
    });
  }

  function exportarTudo(botao) {
    if (!U.confirmar('Gerar a cópia de segurança completa?\n\nO arquivo (JSON) traz todas as tabelas do sistema — inclusive dados ' +
        'da equipe —, sem o conteúdo dos arquivos de evidência. Guarde-o na pasta da AQS, nunca em computador pessoal ou ' +
        'e-mail particular.')) { return; }
    ocupado(botao, true);
    Api.exportarTudo().then(function (copia) {
      U.baixarConteudo('Copia-de-seguranca-AQS-NSP-' + U.hojeBelem() + '.json', JSON.stringify(copia, null, 2),
        'application/json;charset=utf-8');
      U.torrada('Cópia de segurança gerada. Guarde o arquivo na pasta da AQS.', 'sucesso', 7000);
      App.recarregar(['configuracoes']);
    }).catch(function (erro) {
      U.falha(erro);
    }).then(function () { ocupado(botao, false); });
  }

  /* =====================================================================
     Aba Auditoria
     ===================================================================== */

  var ROTULOS_CAMPOS = {
    titulo: 'Título', descricao: 'Descrição', setor_id: 'Setor', tipo: 'Tipo', periodicidade: 'Periodicidade',
    dia_semana: 'Dia da semana', dia_mes: 'Dia do mês', mes_inicio: 'Mês de início', prazo: 'Prazo',
    antecipar_dia_util: 'Antecipar para dia útil', prioridade: 'Prioridade', exige_evidencia: 'Exige evidência',
    ativa: 'Ativa', data_inicio: 'Início', ordem: 'Nº', posto: 'Posto', nome_guerra: 'Nome de guerra',
    nome_completo: 'Nome completo', email: 'E-mail', papel: 'Papel', ativo: 'Ativo', usuario_id: 'Acesso (login)',
    deve_trocar_senha: 'Troca de senha pendente', ultimo_acesso: 'Último acesso', status: 'Situação',
    observacao: 'Observação', justificativa: 'Justificativa', titulo_execucao: 'Execução', concluida_em: 'Concluída em',
    concluida_por: 'Concluída por', iniciada_em: 'Iniciada em', mensagem: 'Mensagem', nivel: 'Nível',
    para_todos: 'Para todos', fixado: 'Fixado', expira_em: 'Expira em', atividade_id: 'Atividade',
    ocorrencia_id: 'Ocorrência', sigla: 'Sigla', nome: 'Nome', cor: 'Cor', data: 'Data', valor: 'Valor',
    chave: 'Chave', texto: 'Texto', militar_id: 'Militar', referencia: 'Referência', mime: 'Tipo de arquivo',
    tamanho: 'Tamanho', criado_por: 'Criado por', autor_id: 'Autor', enviado_por: 'Enviado por'
  };
  /* Os instantâneos de nome (*_nome) e o papel do autor acompanham o campo
     de autoria (já mostrado com o nome): repeti-los só polui o resumo. */
  var CAMPOS_IGNORADOS = ['atualizado_em', 'criado_em', 'id', 'atualizado_por', 'concluida_por_nome',
    'enviado_por_nome', 'autor_nome', 'autor_papel', 'criado_por_nome'];
  var ROTULOS_CONFIGURACAO = {
    email_institucional: 'E-mail institucional', responsavel_tecnico: 'Responsável técnico', telefone: 'Telefone/ramal',
    observacoes: 'Observações', em: 'Data', por_nome: 'Por'
  };
  var CAMPOS_MILITAR = ['criado_por', 'concluida_por', 'militar_id', 'autor_id', 'enviado_por', 'atualizado_por', 'destinatario_id'];
  var ACOES_ADMIN = {
    criar: 'criou o acesso de', redefinir_senha: 'redefiniu a senha de', desativar: 'desativou', reativar: 'reativou',
    remover_mfa: 'removeu o segundo fator de', alterar_email: 'alterou o e-mail de acesso de', excluir: 'excluiu'
  };

  function rotuloTabela(tabela) {
    var t = achar(TABELAS_AUDITORIA, function (x) { return x.valor === tabela; });
    return t ? t.rotulo : String(tabela || '—');
  }

  function rotuloOperacao(op) {
    if (op === 'INSERT') { return { texto: 'Inclusão', classe: 'selo--sucesso' }; }
    if (op === 'UPDATE') { return { texto: 'Alteração', classe: 'selo--padrao' }; }
    if (op === 'DELETE') { return { texto: 'Exclusão', classe: 'selo--urgente' }; }
    var m = /^ADMIN:(.+)$/.exec(String(op || ''));
    if (m) { return { texto: 'Acesso', classe: 'selo--atencao' }; }
    return { texto: String(op || '—'), classe: 'selo--neutro' };
  }

  function curto(texto, max) {
    texto = String(texto).replace(/\s+/g, ' ').trim();
    return texto.length > max ? texto.slice(0, max - 1) + '…' : texto;
  }

  function formatarValor(campo, valor, ctx) {
    if (valor === null || valor === undefined || valor === '') { return '(vazio)'; }
    if (campo === 'usuario_id') { return valor ? 'com acesso' : 'sem acesso'; }
    if (typeof valor === 'boolean') { return valor ? 'Sim' : 'Não'; }
    if (contem(CAMPOS_MILITAR, campo)) { return nomeMilitarAuditoria(valor, ctx); }
    if (campo === 'setor_id') { return temPropria(ctx.setores, valor) ? ctx.setores[valor].sigla : 'setor ' + String(valor).slice(0, 8); }
    if (campo === 'atividade_id') { return temPropria(ctx.atividades, valor) ? '"' + curto(ctx.atividades[valor].titulo, 50) + '"' : 'atividade ' + String(valor).slice(0, 8); }
    if (campo === 'papel' && temPropria(Regras.ROTULOS.papel, valor)) { return Regras.ROTULOS.papel[valor]; }
    if (campo === 'tipo' && temPropria(Regras.ROTULOS.tipo, valor)) { return Regras.ROTULOS.tipo[valor]; }
    if (campo === 'periodicidade' && temPropria(Regras.ROTULOS.periodicidade, valor)) { return Regras.ROTULOS.periodicidade[valor]; }
    if (campo === 'prioridade' && temPropria(Regras.ROTULOS.prioridade, valor)) { return Regras.ROTULOS.prioridade[valor]; }
    if (campo === 'status' && temPropria(Regras.ROTULOS.status, valor)) { return Regras.ROTULOS.status[valor]; }
    if (campo === 'nivel' && temPropria(Regras.ROTULOS.nivel, valor)) { return Regras.ROTULOS.nivel[valor]; }
    if (campo === 'referencia') { return Regras.rotuloReferencia(String(valor)); }
    if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)) { return U.formatarData(valor); }
    if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(valor)) { return U.formatarDataHora(valor); }
    if (typeof valor === 'object') { return curto(JSON.stringify(valor), 80); }
    return curto(valor, 80);
  }

  /* Nome de um militar pelo id: o cadastro atual ou, se ele já foi
     excluído, o nome guardado nos próprios registros de auditoria. */
  function nomeMilitarAuditoria(id, ctx) {
    if (temPropria(ctx.militares, id)) { return Regras.nomeMilitar(ctx.militares[id]); }
    if (temPropria(ctx.historicos, id)) { return ctx.historicos[id]; }
    return '(militar excluído)';
  }

  function nomesHistoricos(registros) {
    var mapa = {};
    (registros || []).forEach(function (r) {
      if (r.militar_id && r.militar_nome && !temPropria(mapa, r.militar_id)) { mapa[r.militar_id] = r.militar_nome; }
      if (r.tabela === 'militares' || r.tabela === 'auth.users') {
        var linha = r.antes || r.depois;
        if (linha && linha.nome_guerra && r.registro_id && !temPropria(mapa, r.registro_id)) { mapa[r.registro_id] = Regras.nomeMilitar(linha); }
      }
    });
    return mapa;
  }

  /* Configuração (jsonb): o que mudou dentro do valor. */
  function diferencaConfiguracao(antes, depois) {
    antes = (antes && typeof antes === 'object') ? antes : {};
    depois = (depois && typeof depois === 'object') ? depois : {};
    return Object.keys(ROTULOS_CONFIGURACAO).concat(Object.keys(antes), Object.keys(depois)).filter(function (k, i, lista) {
      return lista.indexOf(k) === i && JSON.stringify(antes[k] === undefined ? null : antes[k]) !== JSON.stringify(depois[k] === undefined ? null : depois[k]);
    }).map(function (k) {
      var rotulo = temPropria(ROTULOS_CONFIGURACAO, k) ? ROTULOS_CONFIGURACAO[k] : k;
      function texto(v) { return (v === null || v === undefined || v === '') ? '(vazio)' : '"' + curto(typeof v === 'object' ? JSON.stringify(v) : v, 60) + '"'; }
      return rotulo + ': ' + texto(antes[k]) + ' → ' + texto(depois[k]);
    });
  }

  /* "O quê": o nome do registro (militar, atividade, setor…). */
  function descreverRegistro(r, linha, ctx) {
    linha = linha || {};
    var t = r.tabela;
    if (t === 'militares' || t === 'auth.users') {
      if (linha.nome_guerra) { return Regras.nomeMilitar(linha); }
      return nomeMilitarAuditoria(r.registro_id, ctx);
    }
    if (t === 'atividades') {
      if (linha.titulo) { return 'atividade "' + curto(linha.titulo, 60) + '"'; }
      return temPropria(ctx.atividades, r.registro_id) ? 'atividade "' + curto(ctx.atividades[r.registro_id].titulo, 60) + '"' : 'atividade';
    }
    if (t === 'atividade_responsaveis') {
      var partes = String(r.registro_id || '').split(':');
      var aid = linha.atividade_id || partes[0];
      var mid = linha.militar_id || partes[1];
      return formatarValor('militar_id', mid, ctx) + ' em ' + formatarValor('atividade_id', aid, ctx);
    }
    if (t === 'setores') { return 'setor ' + (linha.sigla || (temPropria(ctx.setores, r.registro_id) ? ctx.setores[r.registro_id].sigla : '')); }
    if (t === 'feriados') { return 'feriado de ' + U.formatarData(linha.data || r.registro_id) + (linha.descricao ? ' (' + linha.descricao + ')' : ''); }
    if (t === 'avisos') { return 'aviso' + (linha.titulo ? ' "' + curto(linha.titulo, 60) + '"' : ''); }
    if (t === 'ocorrencias') {
      var at = linha.atividade_id ? formatarValor('atividade_id', linha.atividade_id, ctx) : '';
      return 'ocorrência' + (linha.referencia ? ' ' + Regras.rotuloReferencia(String(linha.referencia)) : '') + (at ? ' de ' + at : '');
    }
    if (t === 'comentarios') { return 'comentário' + (linha.texto ? ' "' + curto(linha.texto, 50) + '"' : ''); }
    if (t === 'evidencias') { return 'evidência' + (linha.nome ? ' "' + curto(linha.nome, 50) + '"' : ''); }
    if (t === 'configuracoes') {
      var chave = linha.chave || r.registro_id;
      return chave === 'contatos' ? 'contatos institucionais' : (chave === 'ultimo_backup' ? 'registro da cópia de segurança' : 'configuração ' + chave);
    }
    return 'registro ' + String(r.registro_id || '');
  }

  function camposAlterados(antes, depois) {
    antes = antes || {};
    depois = depois || {};
    var chaves = {};
    Object.keys(antes).concat(Object.keys(depois)).forEach(function (k) { chaves[k] = true; });
    return Object.keys(chaves).filter(function (k) {
      if (contem(CAMPOS_IGNORADOS, k)) { return false; }
      return JSON.stringify(antes[k] === undefined ? null : antes[k]) !== JSON.stringify(depois[k] === undefined ? null : depois[k]);
    });
  }

  function resumoAuditoria(r, ctx) {
    var op = String(r.operacao || '');
    var admin = /^ADMIN:(.+)$/.exec(op);
    if (admin) {
      var verbo = temPropria(ACOES_ADMIN, admin[1]) ? ACOES_ADMIN[admin[1]] : 'executou "' + admin[1] + '" em';
      var extra = r.depois && r.depois.email && admin[1] === 'alterar_email' ? ' (agora ' + r.depois.email + ')' : '';
      return maiusculaInicial(verbo) + ' ' + descreverRegistro(r, r.antes || r.depois, ctx) + extra + '.';
    }
    if (op === 'INSERT') { return 'Incluiu ' + descreverRegistro(r, r.depois, ctx) + '.'; }
    if (op === 'DELETE') { return 'Excluiu ' + descreverRegistro(r, r.antes, ctx) + '.'; }
    if (op === 'UPDATE' && r.tabela === 'configuracoes') {
      var linhaCfg = r.depois || r.antes || {};
      var chave = linhaCfg.chave || r.registro_id;
      if (chave === 'ultimo_backup') {
        var valorBackup = (r.depois && r.depois.valor) || {};
        return 'Gerou a cópia de segurança completa' + (valorBackup.por_nome ? ' (por ' + valorBackup.por_nome + ')' : '') + '.';
      }
      var mudancas = diferencaConfiguracao(r.antes && r.antes.valor, r.depois && r.depois.valor);
      return maiusculaInicial(descreverRegistro(r, linhaCfg, ctx)) + (mudancas.length ? ': ' + mudancas.join('; ') + '.' : ' gravados sem mudanças.');
    }
    if (op === 'UPDATE') {
      var campos = camposAlterados(r.antes, r.depois);
      var alvo = descreverRegistro(r, r.depois || r.antes, ctx);
      if (!campos.length) { return 'Gravou ' + alvo + ' sem mudanças visíveis.'; }
      if (campos.length === 1 && campos[0] === 'ultimo_acesso') { return maiusculaInicial(alvo) + ' entrou no sistema.'; }
      var visiveis = campos.filter(function (k) { return k !== 'ultimo_acesso'; });
      return maiusculaInicial(alvo) + ': ' + visiveis.slice(0, 6).map(function (k) {
        var rotulo = temPropria(ROTULOS_CAMPOS, k) ? ROTULOS_CAMPOS[k] : k;
        if (k === 'descricao' || k === 'mensagem' || k === 'texto' || k === 'observacao') { return rotulo + ' alterado(a)'; }
        return rotulo + ': ' + formatarValor(k, (r.antes || {})[k], ctx) + ' → ' + formatarValor(k, (r.depois || {})[k], ctx);
      }).join('; ') + (visiveis.length > 6 ? '; e mais ' + (visiveis.length - 6) + ' campos' : '') + '.';
    }
    return op + ' em ' + descreverRegistro(r, r.depois || r.antes, ctx) + '.';
  }

  function maiusculaInicial(texto) {
    texto = String(texto || '');
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }

  function auditoriaHtml() {
    var ctx = {
      militares: indexar(dados.militares), atividades: indexar(dados.atividades), setores: indexar(dados.setores),
      historicos: nomesHistoricos(dados.registros)
    };
    var filtros = '<form class="cartao filtros-gestao filtros-gestao--linha" id="auForm">' +
      '<label class="campo campo--compacto"><span class="campo__rotulo">Tabela</span><select id="auTabela">' +
        opcao('', 'Todas', !filtroAuditoria.tabela) + TABELAS_AUDITORIA.map(function (t) {
          return opcao(t.valor, t.rotulo, filtroAuditoria.tabela === t.valor);
        }).join('') + '</select></label>' +
      '<label class="campo campo--compacto"><span class="campo__rotulo">Quantidade</span><select id="auLimite">' +
        LIMITES_AUDITORIA.map(function (n) { return opcao(String(n), 'Últimos ' + n, filtroAuditoria.limite === n); }).join('') + '</select></label>' +
      '<button type="button" class="botao botao--secundario botao--pequeno" data-eq-acao="atualizar-auditoria">' + icone('recarregar') + 'Atualizar</button>' +
    '</form>';
    var registros = dados.registros || [];
    if (!registros.length) {
      return filtros + '<div class="vazio"><span class="vazio__icone">' + icone('relatorios') + '</span><strong>Nenhum registro</strong>' +
        '<p>Não há registros de auditoria' + (filtroAuditoria.tabela ? ' para esta tabela' : '') + '.</p></div>';
    }
    return filtros +
      '<p class="resumo-lista">Mostrando ' + U.esc(plural(registros.length, 'registro', 'registros')) + ' (mais recentes primeiro). ' +
        'Cada inclusão, alteração e exclusão fica registrada com o nome de quem fez.</p>' +
      '<ol class="lista-auditoria">' + registros.map(function (r) {
        var op = rotuloOperacao(r.operacao);
        var quem = r.militar_nome || (r.militar_id ? nomeMilitarAuditoria(r.militar_id, ctx) : '') ||
          (r.usuario_id ? 'Usuário sem cadastro' : 'Sistema (rotina automática ou SQL Editor)');
        var detalhes = (r.antes || r.depois)
          ? '<details class="detalhes-gestao"><summary>ver detalhes</summary><div class="auditoria-json">' +
              (r.antes ? '<div><h4>Antes</h4><pre>' + U.esc(JSON.stringify(r.antes, null, 2)) + '</pre></div>' : '') +
              (r.depois ? '<div><h4>Depois</h4><pre>' + U.esc(JSON.stringify(r.depois, null, 2)) + '</pre></div>' : '') +
            '</div></details>'
          : '';
        return '<li class="auditoria-item">' +
          '<div class="auditoria-item__topo">' +
            '<time datetime="' + U.esc(r.quando) + '">' + U.esc(U.formatarDataHora(r.quando)) + '</time>' +
            '<strong>' + U.esc(quem) + '</strong>' +
            '<span class="selo selo--neutro selo--pequeno">' + U.esc(rotuloTabela(r.tabela)) + '</span>' +
            '<span class="selo selo--pequeno ' + op.classe + '">' + U.esc(op.texto) + '</span>' +
          '</div>' +
          '<p class="auditoria-item__resumo">' + U.esc(resumoAuditoria(r, ctx)) + '</p>' +
          detalhes +
        '</li>';
      }).join('') + '</ol>';
  }

  /* =====================================================================
     Eventos da página
     ===================================================================== */

  function ligar(el) {
    var raiz = U.$('.pagina-equipe', el);
    var redesenharBusca = U.adiar(function () {
      var caixa = U.$('#eqMilitaresLista', el);
      if (abaAtual !== 'militares' || !dados || !caixa) { return; }
      caixa.innerHTML = listaMilitaresHtml();
    }, 160);

    raiz.addEventListener('click', function (evento) {
      var alvo = evento.target;
      if (!alvo || !alvo.closest) { return; }
      var pc = alvo.closest('[data-pc-acao]');
      if (pc) { cliqueAssistente(el, pc); return; }
      var acao = alvo.closest('[data-eq-acao]');
      if (acao) { acaoDaPagina(el, acao); return; }
      var situacao = alvo.closest('[data-situacao]');
      if (situacao) {
        filtroMilitares.situacao = situacao.getAttribute('data-situacao');
        desenharAba(el);
        return;
      }
      var ano = alvo.closest('[data-ano]');
      if (ano) {
        anoFeriados = Number(ano.getAttribute('data-ano'));
        desenharAba(el);
        return;
      }
      if (alvo.closest('a')) { return; }
      var militar = alvo.closest('[data-militar]');
      if (militar && eGestorLogado()) {
        var id = militar.getAttribute('data-militar');
        if (ID_VALIDO.test(id)) { abrirMilitar(id); }
      }
    });

    raiz.addEventListener('input', function (evento) {
      var alvo = evento.target;
      if (!alvo) { return; }
      if (alvo.id === 'eqBusca') {
        filtroMilitares.busca = alvo.value.slice(0, 80);
        redesenharBusca();
      } else if (alvo.hasAttribute && alvo.hasAttribute('data-pc-novo') && assistente) {
        assistente.novo[alvo.getAttribute('data-pc-novo')] = alvo.value;
      } else if (alvo.hasAttribute && alvo.hasAttribute('data-ct')) {
        rascunhoContatos = rascunhoContatos || contatosAtuais();
        rascunhoContatos[alvo.getAttribute('data-ct')] = alvo.value;
      } else if (alvo.id === 'frData' || alvo.id === 'frDescricao') {
        rascunhoFeriado[alvo.id === 'frData' ? 'data' : 'descricao'] = alvo.value;
      }
      var campo = alvo.closest ? alvo.closest('.campo--invalido') : null;
      if (campo) {
        campo.classList.remove('campo--invalido');
        var caixa = U.$('.campo__erro', campo);
        if (caixa) { caixa.textContent = ''; }
      }
    });

    raiz.addEventListener('change', function (evento) {
      var alvo = evento.target;
      if (!alvo) { return; }
      if (alvo.name === 'pcPara' && assistente) {
        assistente.para = alvo.value;
        var novo = U.$('#pcNovo', el);
        if (novo) { novo.classList.toggle('oculto', alvo.value !== 'novo'); }
      } else if (alvo.name === 'pcDe' && assistente) {
        assistente.de = alvo.value;
      } else if ((alvo.name === 'pcDestino' || alvo.id === 'pcTransferir') && assistente) {
        lerAssistente(el);
        desenharAba(el);
      } else if (alvo.hasAttribute && alvo.hasAttribute('data-pc-novo') && assistente) {
        assistente.novo[alvo.getAttribute('data-pc-novo')] = alvo.value;
      } else if (alvo.id === 'auTabela' || alvo.id === 'auLimite') {
        filtroAuditoria.tabela = U.$('#auTabela', el).value;
        filtroAuditoria.limite = Number(U.$('#auLimite', el).value) || 200;
        U.$$('.lista-auditoria, .vazio, .resumo-lista', el).forEach(function (n) { n.classList.add('carregando-suave'); });
        carregarAba(el);
      }
    });

    raiz.addEventListener('submit', function (evento) {
      var form = evento.target;
      if (!form) { return; }
      if (form.id === 'frForm') { evento.preventDefault(); salvarFeriado(el); }
      else if (form.id === 'ctForm') { evento.preventDefault(); salvarContatos(el); }
      else if (form.id === 'auForm') { evento.preventDefault(); }
    });
  }

  function acaoDaPagina(el, botao) {
    var acao = botao.getAttribute('data-eq-acao');
    if (acao === 'tentar') { U.$('#eqConteudo', el).innerHTML = carregandoHtml(); carregarAba(el); return; }
    if (!eGestorLogado()) { return; }
    var id = botao.getAttribute('data-id');
    if (acao === 'novo-militar') { abrirMilitar(null); }
    else if (acao === 'limpar-militares') { filtroMilitares = { busca: '', situacao: 'todos' }; desenharAba(el); }
    else if (acao === 'novo-setor') { abrirSetor(null); }
    else if (acao === 'editar-setor' || acao === 'excluir-setor') {
      var setor = porId(dados.setores, id);
      if (!setor) { U.torrada('Este setor não existe mais. Atualize a página.', 'atencao'); return; }
      if (acao === 'editar-setor') { abrirSetor(setor); } else { excluirSetor(botao, setor); }
    } else if (acao === 'editar-feriado') {
      var data = botao.getAttribute('data-data');
      var f = achar(dados.feriados, function (x) { return x.data === data; });
      if (!f) { return; }
      rascunhoFeriado = { data: f.data, descricao: f.descricao, original: f.data };
      desenharAba(el);
      var campo = U.$('#frDescricao', el);
      if (campo) {
        try { U.$('#frForm', el).scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* navegador antigo */ }
        campo.focus({ preventScroll: true });
      }
    } else if (acao === 'cancelar-feriado') {
      rascunhoFeriado = { data: '', descricao: '', original: null };
      desenharAba(el);
    } else if (acao === 'excluir-feriado') {
      excluirFeriado(botao, botao.getAttribute('data-data'));
    } else if (acao === 'feriados-padrao') {
      incluirPadrao(botao);
    } else if (acao === 'descartar-contatos') {
      rascunhoContatos = null;
      desenharAba(el);
    } else if (acao === 'exportar') {
      exportarTudo(botao);
    } else if (acao === 'atualizar-auditoria') {
      carregarAba(el);
    }
  }

  return {
    titulo: 'Equipe',
    render: render,
    aoVivo: aoVivo
  };
})();
