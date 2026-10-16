/* =========================================================================
   HABE – AQS e NSP — adaptador de API do MODO DEMONSTRAÇÃO
   Implementa todos os métodos de Api.METODOS (ARQUITETURA §6) sobre um
   estado fictício (DadosDemo), sem rede nenhuma. Imita o banco: as mesmas
   permissões da RLS e das RPCs (via Regras), os carimbos de status dos
   gatilhos, as notificações, a auditoria, a trava anti-bloqueio e o efeito
   de excluir um militar (nomes preservados no histórico).

   Persistência: o estado vai para o sessionStorage ('aqs_demo_estado') a
   cada gravação, para sobreviver a um recarregamento da aba; se o
   navegador recusar (modo privado, cota), segue só na memória. Os arquivos
   enviados ficam só na memória da página. Nada sai do navegador.

   Toda gravação roda numa "transação": se der erro no meio, o estado volta
   a ser o de antes — como no Postgres.
   ========================================================================= */

var ApiDemo = (function () {
  'use strict';

  var CHAVE_ESTADO = 'aqs_demo_estado';
  var CHAVE_SESSAO = 'aqs_demo_sessao';

  /* Atraso artificial, para a demonstração "parecer" rede (e para as telas
     mostrarem os estados de carregamento). */
  var atrasoMs = 120;

  var MSG = {
    semPermissao: 'Você não tem permissão para esta ação.',
    semSessao: 'Sua sessão terminou. Entre novamente.',
    semCadastro: 'Seu usuário não está vinculado a um cadastro ativo. Procure a chefia do NSP ou a AQS.',
    soAdministrador: 'Apenas a conta de administrador (conta institucional da AQS) pode criar, alterar ou ' +
      'excluir contas de administrador.',
    credenciais: 'E-mail ou senha incorretos.'
  };

  var PERIODICIDADES = ['diaria_util', 'semanal', 'mensal', 'trimestral', 'semestral', 'anual'];
  var COM_DIA_MES = ['mensal', 'trimestral', 'semestral', 'anual'];
  var COM_MES_INICIO = ['trimestral', 'semestral', 'anual'];
  /* "Regra de agenda" do RPC salvar_atividade (o prazo da pontual é tratado
     à parte, pelo gatilho da ocorrência 'P'). */
  var CAMPOS_AGENDA = ['tipo', 'periodicidade', 'dia_semana', 'dia_mes', 'mes_inicio',
                       'antecipar_dia_util', 'ativa', 'data_inicio'];
  var CAMPOS_OCORRENCIA_EDITAVEIS = ['status', 'observacao', 'justificativa', 'titulo_execucao', 'prazo'];

  var estado = null;          /* o "banco" */
  var sessao = null;          /* { usuario_id, email } */
  var mfaPendente = null;     /* login feito, aguardando o código do segundo fator */
  var arquivos = {};          /* storage_path → Blob/File enviados nesta página */
  var ouvintesSessao = [];

  /* ---------- infraestrutura ---------- */

  var ambienteGlobal = (typeof window !== 'undefined') ? window : {};

  function armazenamento() {
    try { return ambienteGlobal.sessionStorage || null; } catch (e) { return null; }
  }

  function lerJson(chave) {
    try {
      var s = armazenamento();
      var conteudo = s ? s.getItem(chave) : null;
      return conteudo ? JSON.parse(conteudo) : null;
    } catch (e) {
      return null;
    }
  }

  function gravarJson(chave, valor) {
    try {
      var s = armazenamento();
      if (!s) { return; }
      if (valor === null) { s.removeItem(chave); } else { s.setItem(chave, JSON.stringify(valor)); }
    } catch (e) {
      /* Cota estourada ou armazenamento bloqueado: a demonstração segue só na memória. */
    }
  }

  function erro(mensagem) { return new Error(mensagem); }

  function clonar(valor) {
    return (valor === undefined) ? undefined : JSON.parse(JSON.stringify(valor));
  }

  function hoje() {
    if (typeof U !== 'undefined' && U && typeof U.hojeBelem === 'function') { return U.hojeBelem(); }
    return Regras.hojeBelem();
  }

  function agora() { return new Date().toISOString(); }

  function novoId() {
    if (typeof U !== 'undefined' && U && typeof U.uuid === 'function') { return U.uuid(); }
    var h = '';
    for (var i = 0; i < 32; i += 1) { h += Math.floor(Math.random() * 16).toString(16); }
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-a' + h.slice(17, 20) + '-' + h.slice(20);
  }

  function achar(lista, teste) {
    for (var i = 0; i < lista.length; i += 1) { if (teste(lista[i])) { return lista[i]; } }
    return null;
  }

  function remover(lista, teste) {
    for (var i = lista.length - 1; i >= 0; i -= 1) { if (teste(lista[i])) { lista.splice(i, 1); } }
  }

  function texto(valor) { return (valor === null || valor === undefined) ? '' : String(valor); }

  function textoOuNulo(valor) {
    var t = texto(valor).trim();
    return t ? t : null;
  }

  function dataOuNulo(valor, rotulo) {
    if (valor === null || valor === undefined || valor === '') { return null; }
    var d = String(valor).slice(0, 10);
    if (!Recorrencia.dataValida(d)) { throw erro((rotulo || 'A data') + ' é inválida.'); }
    return d;
  }

  function inteiroOuNulo(valor, minimo, maximo, mensagem) {
    if (valor === null || valor === undefined || valor === '') { return null; }
    var n = Number(valor);
    if (!isFinite(n) || Math.floor(n) !== n || n < minimo || n > maximo) { throw erro(mensagem); }
    return n;
  }

  function idsUnicos(lista) {
    var vistos = {};
    return (Array.isArray(lista) ? lista : []).filter(function (id) {
      if (!id || vistos[id]) { return false; }
      vistos[id] = true;
      return true;
    }).map(String);
  }

  function mesmoConjunto(a, b) {
    if (a.length !== b.length) { return false; }
    var mapa = {};
    a.forEach(function (x) { mapa[x] = true; });
    return b.every(function (x) { return mapa[x]; });
  }

  function ordenarPor(lista, chaves) {
    return lista.sort(function (x, y) {
      for (var i = 0; i < chaves.length; i += 1) {
        var c = chaves[i], desc = c.charAt(0) === '-', campo = desc ? c.slice(1) : c;
        var a = x[campo], b = y[campo];
        if (a === b) { continue; }
        if (a === null || a === undefined) { return desc ? 1 : -1; }
        if (b === null || b === undefined) { return desc ? -1 : 1; }
        var r = a < b ? -1 : 1;
        return desc ? -r : r;
      }
      return 0;
    });
  }

  /* ---------- estado ---------- */

  function estadoValido(e) {
    return !!e && e.versao === DadosDemo.VERSAO_ESTADO && Array.isArray(e.militares) &&
      Array.isArray(e.ocorrencias) && Array.isArray(e.usuarios);
  }

  function carregarEstado() {
    if (estado) { return; }
    var salvo = lerJson(CHAVE_ESTADO);
    if (estadoValido(salvo)) {
      estado = salvo;
    } else {
      estado = DadosDemo.criarEstadoInicial(hoje());
      persistir();
    }
    if (!estado.evidencias_enviadas) { estado.evidencias_enviadas = {}; }
  }

  function persistir() { gravarJson(CHAVE_ESTADO, estado); }

  /* Grava atômica: erro no meio ⇒ nada muda. */
  function transacao(fn) {
    var copia = JSON.stringify(estado);
    try {
      var resultado = fn();
      persistir();
      return resultado;
    } catch (e) {
      estado = JSON.parse(copia);
      throw e;
    }
  }

  function atrasar(fn) {
    return new Promise(function (resolver, rejeitar) {
      setTimeout(function () {
        try { resolver(fn()); } catch (e) { rejeitar(e); }
      }, atrasoMs);
    });
  }

  function leitura(fn) {
    return atrasar(function () { carregarEstado(); return clonar(fn()); });
  }

  function escrita(fn) {
    return atrasar(function () { carregarEstado(); return clonar(transacao(fn)); });
  }

  /* ---------- sessão e identidade ---------- */

  function emitirSessao(evento) {
    var lista = ouvintesSessao.slice();
    setTimeout(function () {
      lista.forEach(function (cb) {
        try { cb(evento); } catch (e) { if (typeof console !== 'undefined') { console.error(e); } }
      });
    }, 0);
  }

  function usuarioPorId(id) {
    return achar(estado.usuarios, function (u) { return u.id === id; });
  }

  function definirSessao(usuario) {
    sessao = { usuario_id: usuario.id, email: usuario.email };
    gravarJson(CHAVE_SESSAO, sessao);
  }

  function limparSessao() {
    sessao = null;
    mfaPendente = null;
    gravarJson(CHAVE_SESSAO, null);
  }

  /* A sessão guardada só vale se o usuário de acesso ainda existir (pode
     ter sido excluído por um gestor em outra conta da demonstração). */
  function restaurarSessao() {
    if (sessao) { return; }
    var salva = lerJson(CHAVE_SESSAO);
    if (salva && salva.usuario_id && usuarioPorId(salva.usuario_id)) {
      sessao = { usuario_id: salva.usuario_id, email: usuarioPorId(salva.usuario_id).email };
    }
  }

  /* Não mexe em mfaPendente: uma tela que consulte algo durante o login
     em duas etapas não pode derrubar o código que está para ser digitado. */
  function exigirSessao() {
    restaurarSessao();
    if (!sessao || !usuarioPorId(sessao.usuario_id)) {
      sessao = null;
      gravarJson(CHAVE_SESSAO, null);
      throw erro(MSG.semSessao);
    }
    return sessao;
  }

  /* privado.meu_militar_id(): o militar ATIVO ligado ao usuário logado. */
  function eu() {
    var s = exigirSessao();
    var m = achar(estado.militares, function (x) { return x.usuario_id === s.usuario_id && x.ativo; });
    if (!m) { throw erro(MSG.semCadastro); }
    return m;
  }

  function exigirGestor() {
    var m = eu();
    if (!Regras.eGestor(m)) { throw erro(MSG.semPermissao); }
    return m;
  }

  /* Para a auditoria: quem fez (null fora de sessão). */
  function autorAtual() {
    if (!sessao) { return null; }
    return achar(estado.militares, function (x) { return x.usuario_id === sessao.usuario_id; });
  }

  /* ---------- auditoria e notificações ---------- */

  function auditar(tabela, operacao, registroId, antes, depois) {
    var autor = autorAtual();
    estado.seq_auditoria = (estado.seq_auditoria || 0) + 1;
    estado.auditoria.push({
      id: estado.seq_auditoria, quando: agora(),
      militar_id: autor ? autor.id : null, militar_nome: autor ? Regras.nomeMilitar(autor) : null,
      usuario_id: sessao ? sessao.usuario_id : null,
      tabela: tabela, operacao: operacao, registro_id: String(registroId),
      antes: antes ? clonar(antes) : null, depois: depois ? clonar(depois) : null
    });
  }

  function notificar(destinatarioId, tipo, dadosTexto, refs) {
    var textos = DadosDemo.textoNotificacao(tipo, dadosTexto);
    estado.notificacoes.push({
      id: novoId(), destinatario_id: destinatarioId, tipo: tipo,
      titulo: textos.titulo, mensagem: textos.mensagem,
      atividade_id: refs.atividade_id || null, ocorrencia_id: refs.ocorrencia_id || null,
      aviso_id: refs.aviso_id || null, lida: false, criado_em: agora()
    });
  }

  /* tg_notificar_atribuicao: o militar incluído (ativo) é avisado, salvo
     quando foi ele mesmo quem se incluiu. */
  function notificarAtribuicao(militarId, atividade, autor) {
    var alvo = militarPorId(militarId);
    if (!alvo || !alvo.ativo || (autor && autor.id === militarId)) { return; }
    notificar(militarId, 'atribuicao', { atividade_titulo: atividade.titulo }, { atividade_id: atividade.id });
  }

  /* Auditoria de atividade_responsaveis: chave composta "atividade:militar". */
  function auditarResponsavel(operacao, atividadeId, militarId) {
    var linha = { atividade_id: atividadeId, militar_id: militarId };
    auditar('atividade_responsaveis', operacao, atividadeId + ':' + militarId,
      operacao === 'DELETE' ? linha : null, operacao === 'INSERT' ? linha : null);
  }

  /* ---------- consultas internas ---------- */

  function militarPorId(id) {
    return achar(estado.militares, function (m) { return m.id === id; });
  }

  function atividadePorId(id) {
    return achar(estado.atividades, function (a) { return a.id === id; });
  }

  function ocorrenciaPorId(id) {
    return achar(estado.ocorrencias, function (o) { return o.id === id; });
  }

  function responsaveisDe(atividadeId) {
    return estado.atividade_responsaveis.filter(function (r) { return r.atividade_id === atividadeId; })
      .map(function (r) { return r.militar_id; });
  }

  function indiceResponsaveis() {
    var mapa = {};
    estado.atividade_responsaveis.forEach(function (r) {
      (mapa[r.atividade_id] = mapa[r.atividade_id] || []).push(r.militar_id);
    });
    return mapa;
  }

  function atividadeCompleta(a, indice) {
    var r = clonar(a);
    r.responsaveis = indice ? (indice[a.id] || []).slice() : responsaveisDe(a.id);
    return r;
  }

  function feriadosMapa() { return Recorrencia.normalizarFeriados(estado.feriados); }

  function contarPor(lista, campo) {
    var mapa = {};
    lista.forEach(function (x) { if (x[campo]) { mapa[x[campo]] = (mapa[x[campo]] || 0) + 1; } });
    return mapa;
  }

  /* Uma linha de v_ocorrencias. */
  function linhaView(oc, ctx) {
    ctx = ctx || contextoView();
    var a = ctx.atividades[oc.atividade_id];
    var r = clonar(oc);
    r.atividade_titulo = a ? a.titulo : '';
    r.atividade_tipo = a ? a.tipo : null;
    r.periodicidade = a ? a.periodicidade : null;
    r.prioridade = a ? a.prioridade : 'normal';
    r.setor_id = a ? a.setor_id : null;
    r.exige_evidencia = a ? !!a.exige_evidencia : false;
    r.responsaveis = (ctx.responsaveis[oc.atividade_id] || []).slice();
    r.data_ref = oc.prazo || Regras.dataBelem(oc.criado_em);
    r.atrasada = Regras.estaAtrasada(oc, ctx.hoje);
    r.concluida_no_prazo = oc.status === 'concluida' &&
      (!oc.prazo || (Regras.dataBelem(oc.concluida_em) || '9999-12-31') <= oc.prazo ||
       oc.concluida_em === oc.criado_em);
    r.qtd_evidencias = ctx.evidencias[oc.id] || 0;
    r.qtd_comentarios = ctx.comentarios[oc.id] || 0;
    return r;
  }

  function contextoView() {
    var atividades = {};
    estado.atividades.forEach(function (a) { atividades[a.id] = a; });
    return {
      hoje: hoje(),
      atividades: atividades,
      responsaveis: indiceResponsaveis(),
      evidencias: contarPor(estado.evidencias, 'ocorrencia_id'),
      comentarios: contarPor(estado.comentarios, 'ocorrencia_id')
    };
  }

  function exigirAtividade(id) {
    var a = atividadePorId(id);
    if (!a) { throw erro('Atividade não encontrada. Ela pode ter sido excluída — atualize a página.'); }
    return a;
  }

  function exigirOcorrencia(id) {
    var oc = ocorrenciaPorId(id);
    if (!oc) { throw erro('Ocorrência não encontrada. Ela pode ter sido excluída — atualize a página.'); }
    return oc;
  }

  function exigirMilitar(id) {
    var m = militarPorId(id);
    if (!m) { throw erro('Militar não encontrado. O cadastro pode ter sido excluído — atualize a página.'); }
    return m;
  }

  /* ---------- gatilhos imitados ---------- */

  /* Carimbos do gatilho de ocorrencias (tg_ocorrencias_antes), na transição
     de status: iniciada_em ao ir para em_andamento (mantém o 1º início) e
     limpa ao voltar para pendente; conclusão carimbada ao concluir e limpa
     ao sair de concluída. statusAnterior nulo = inserção. */
  function carimbarStatus(oc, statusAnterior, autor) {
    if (oc.status === statusAnterior) { return; }
    if (oc.status === 'em_andamento') { oc.iniciada_em = oc.iniciada_em || agora(); }
    if (oc.status === 'pendente') { oc.iniciada_em = null; }
    if (oc.status === 'concluida') {
      oc.concluida_em = agora();
      oc.concluida_por = autor ? autor.id : null;
      oc.concluida_por_nome = autor ? Regras.nomeMilitar(autor) : null;
    } else if (statusAnterior === 'concluida') {
      oc.concluida_em = null;
      oc.concluida_por = null;
      oc.concluida_por_nome = null;
    }
  }

  function validarStatus(status, justificativa) {
    if (!Object.prototype.hasOwnProperty.call(Regras.ROTULOS.status, status) || status === 'atrasada') {
      throw erro('Situação inválida.');
    }
    if (status === 'nao_se_aplica' && !texto(justificativa).trim()) {
      throw erro('Informe a justificativa para marcar como "não se aplica".');
    }
    if (texto(justificativa).length > 4000) {
      throw erro('A justificativa pode ter no máximo 4.000 caracteres.');
    }
  }

  function inserirOcorrencia(campos, autor) {
    var instante = agora();
    var oc = {
      id: novoId(), atividade_id: campos.atividade_id, referencia: campos.referencia || null,
      titulo_execucao: campos.titulo_execucao || null, prazo: campos.prazo || null,
      status: 'pendente', observacao: campos.observacao || '', justificativa: campos.justificativa || null,
      iniciada_em: null, concluida_em: null, concluida_por: null, concluida_por_nome: null,
      criado_por: Object.prototype.hasOwnProperty.call(campos, 'criado_por') ? campos.criado_por : (autor ? autor.id : null),
      criado_em: instante, atualizado_em: instante
    };
    oc.status = campos.status || 'pendente';
    carimbarStatus(oc, null, autor);
    /* Como o now() da transação no banco: nascida concluída, criado_em e
       concluida_em são o mesmo instante (v_ocorrencias trata isso como
       registro de algo já feito — "no prazo"). */
    if (oc.concluida_em) { oc.concluida_em = instante; }
    if (oc.iniciada_em) { oc.iniciada_em = instante; }
    estado.ocorrencias.push(oc);
    auditar('ocorrencias', 'INSERT', oc.id, null, oc);
    return oc;
  }

  /* gerar_ocorrencias() para UMA atividade: janela de §4, sem duplicar
     (on conflict (atividade_id, referencia) do nothing). */
  function gerarParaAtividade(a, mapaFeriados) {
    if (!a.ativa || a.tipo !== 'recorrente') { return 0; }
    var janela = Recorrencia.janelaGeracao(a, hoje());
    if (!janela) { return 0; }
    var existentes = {};
    estado.ocorrencias.forEach(function (oc) {
      if (oc.atividade_id === a.id && oc.referencia) { existentes[oc.referencia] = true; }
    });
    var criadas = 0;
    Recorrencia.datas(a, janela.de, janela.ate, mapaFeriados).forEach(function (d) {
      if (existentes[d.referencia]) { return; }
      inserirOcorrencia({ atividade_id: a.id, referencia: d.referencia, prazo: d.prazo }, null);
      existentes[d.referencia] = true;
      criadas += 1;
    });
    return criadas;
  }

  /* privado.notificar_prazos(): responsáveis de ocorrências abertas com
     prazo hoje ou amanhã, no máximo uma por ocorrência por dia. */
  function notificarPrazos() {
    var dia = hoje();
    var amanha = Recorrencia.somarDias(dia, 1);
    var jaAvisados = {};
    estado.notificacoes.forEach(function (n) {
      if (n.tipo === 'prazo' && n.ocorrencia_id && Regras.dataBelem(n.criado_em) === dia) {
        jaAvisados[n.ocorrencia_id + '|' + n.destinatario_id] = true;
      }
    });
    var indice = indiceResponsaveis();
    estado.ocorrencias.forEach(function (oc) {
      if (!Regras.estaAberta(oc) || (oc.prazo !== dia && oc.prazo !== amanha)) { return; }
      var a = atividadePorId(oc.atividade_id);
      if (!a || !a.ativa) { return; }
      (indice[a.id] || []).forEach(function (militarId) {
        var m = militarPorId(militarId);
        if (!m || !m.ativo || jaAvisados[oc.id + '|' + militarId]) { return; }
        jaAvisados[oc.id + '|' + militarId] = true;
        notificar(militarId, 'prazo',
          { prazo: oc.prazo, hoje: dia, atividade_titulo: a.titulo, titulo_execucao: oc.titulo_execucao },
          { atividade_id: a.id, ocorrencia_id: oc.id });
      });
    });
  }

  /* Remove arquivos (memória) e linhas de evidência que casam com o teste. */
  function removerEvidencias(teste) {
    estado.evidencias.filter(teste).forEach(function (ev) {
      delete arquivos[ev.storage_path];
      delete estado.evidencias_enviadas[ev.id];
    });
    remover(estado.evidencias, teste);
  }

  /* Notificações que apontam para um registro apagado perdem o vínculo
     (o texto continua no sino). */
  function desvincularNotificacoes(campo, valor) {
    estado.notificacoes.forEach(function (n) { if (n[campo] === valor) { n[campo] = null; } });
  }

  function apagarOcorrencia(oc) {
    removerEvidencias(function (ev) { return ev.ocorrencia_id === oc.id; });
    remover(estado.comentarios, function (c) { return c.ocorrencia_id === oc.id; });
    desvincularNotificacoes('ocorrencia_id', oc.id);
    remover(estado.ocorrencias, function (o) { return o.id === oc.id; });
    auditar('ocorrencias', 'DELETE', oc.id, oc, null);
  }

  /* ---------- sessão (métodos) ---------- */

  function iniciar() {
    carregarEstado();
    restaurarSessao();
    return Promise.resolve(sessao ? { usuario_id: sessao.usuario_id, email: sessao.email } : null);
  }

  function sessaoAtual() {
    carregarEstado();
    restaurarSessao();
    if (sessao && !usuarioPorId(sessao.usuario_id)) {
      sessao = null;
      gravarJson(CHAVE_SESSAO, null);
    }
    return Promise.resolve(sessao ? { usuario_id: sessao.usuario_id, email: sessao.email } : null);
  }

  function aoMudarSessao(cb) {
    if (typeof cb !== 'function') { return function () {}; }
    ouvintesSessao.push(cb);
    return function cancelar() {
      ouvintesSessao = ouvintesSessao.filter(function (x) { return x !== cb; });
    };
  }

  /* Qualquer senha não vazia é aceita para os e-mails cadastrados na
     demonstração. "lembrar" não muda nada aqui: a sessão da demonstração
     fica sempre só nesta aba (sessionStorage). */
  function entrar(email, senha) {
    return atrasar(function () {
      carregarEstado();
      var e = texto(email).trim().toLowerCase();
      if (!e || !texto(senha)) { throw erro('Informe o e-mail e a senha.'); }
      var usuario = achar(estado.usuarios, function (u) { return u.email === e; });
      if (!usuario) { throw erro(MSG.credenciais); }
      var m = achar(estado.militares, function (x) { return x.usuario_id === usuario.id; });
      if (m && !m.ativo) { throw erro('Este acesso está desativado. Procure a chefia do NSP ou a AQS.'); }
      var temFator = (usuario.mfa || []).some(function (f) { return f.status === 'verified'; });
      limparSessao();
      if (temFator) {
        /* Só vira sessão depois do código: até lá nenhum dado é acessível. */
        mfaPendente = { id: usuario.id, email: usuario.email };
        return { precisaMfa: true };
      }
      definirSessao(usuario);
      emitirSessao('entrou');
      return { precisaMfa: false };
    });
  }

  function verificarMfa(codigo) {
    return atrasar(function () {
      carregarEstado();
      if (!mfaPendente) { throw erro('Entre com e-mail e senha antes de informar o código.'); }
      if (!/^\d{6}$/.test(texto(codigo).trim())) {
        throw erro('Código inválido. Digite os 6 números mostrados no aplicativo autenticador.');
      }
      var usuario = usuarioPorId(mfaPendente.id);
      mfaPendente = null;
      if (!usuario) { throw erro(MSG.semSessao); }
      definirSessao(usuario);
      emitirSessao('entrou');
    });
  }

  function sair() {
    return atrasar(function () {
      var tinha = !!sessao;
      limparSessao();
      if (tinha) { emitirSessao('saiu'); }
    });
  }

  function meuPerfil() {
    return atrasar(function () {
      carregarEstado();
      exigirSessao();
      var m = achar(estado.militares, function (x) { return x.usuario_id === sessao.usuario_id; });
      if (!m || !m.ativo) { throw erro(MSG.semCadastro); }
      /* meu_perfil() registra o último acesso no máximo uma vez por minuto
         (e o banco não audita essa atualização). */
      if (!m.ultimo_acesso || Date.now() - Date.parse(m.ultimo_acesso) > 60000) {
        m.ultimo_acesso = agora();
        persistir();
      }
      return clonar(m);
    });
  }

  function trocarSenha(nova) {
    return escrita(function () {
      var problema = Regras.validarSenha(nova);
      if (problema) { throw erro(problema); }
      var m = eu();
      if (m.deve_trocar_senha) {
        var antes = { deve_trocar_senha: true };
        m.deve_trocar_senha = false;
        m.atualizado_em = agora();
        auditar('militares', 'UPDATE', m.id, antes, { deve_trocar_senha: false });
      }
    });
  }

  /* ---------- segundo fator (simulado) ---------- */

  function usuarioLogado() {
    var s = exigirSessao();
    return usuarioPorId(s.usuario_id);
  }

  function mfaFatores() {
    return leitura(function () {
      return (usuarioLogado().mfa || []).map(function (f) {
        return { id: f.id, status: f.status, criado_em: f.criado_em };
      });
    });
  }

  /* QR fictício (não leva a lugar nenhum): três quadros de canto e um
     padrão derivado do segredo, só para a tela ficar com cara de real. */
  function qrFicticio(segredo) {
    var n = 25, tam = 8, partes = [];
    var semente = 0;
    for (var i = 0; i < segredo.length; i += 1) { semente = (semente * 31 + segredo.charCodeAt(i)) >>> 0; }
    function proximo() {
      semente = (semente * 1103515245 + 12345) >>> 0;
      return (semente >>> 16) & 1;
    }
    function quadro(x, y) {
      partes.push('<rect x="' + x * tam + '" y="' + y * tam + '" width="' + 7 * tam + '" height="' + 7 * tam + '" fill="#0b2f5c"/>');
      partes.push('<rect x="' + (x + 1) * tam + '" y="' + (y + 1) * tam + '" width="' + 5 * tam + '" height="' + 5 * tam + '" fill="#fff"/>');
      partes.push('<rect x="' + (x + 2) * tam + '" y="' + (y + 2) * tam + '" width="' + 3 * tam + '" height="' + 3 * tam + '" fill="#0b2f5c"/>');
    }
    function emQuadro(x, y) {
      return (x < 8 && y < 8) || (x >= n - 8 && y < 8) || (x < 8 && y >= n - 8);
    }
    for (var y = 0; y < n; y += 1) {
      for (var x = 0; x < n; x += 1) {
        if (!emQuadro(x, y) && proximo()) {
          partes.push('<rect x="' + x * tam + '" y="' + y * tam + '" width="' + tam + '" height="' + tam + '" fill="#0b2f5c"/>');
        }
      }
    }
    quadro(0, 0); quadro(n - 7, 0); quadro(0, n - 7);
    var lado = n * tam;
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-16 -16 ' + (lado + 32) + ' ' + (lado + 32) +
      '" width="200" height="200"><rect x="-16" y="-16" width="' + (lado + 32) + '" height="' + (lado + 32) +
      '" fill="#fff"/>' + partes.join('') + '</svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function segredoFicticio() {
    var alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', s = '';
    for (var i = 0; i < 32; i += 1) { s += alfabeto.charAt(Math.floor(Math.random() * 32)); }
    return s;
  }

  function mfaIniciarCadastro() {
    return escrita(function () {
      eu();
      var usuario = usuarioLogado();
      usuario.mfa = (usuario.mfa || []).filter(function (f) { return f.status === 'verified'; });
      var segredo = segredoFicticio();
      var fator = { id: novoId(), status: 'unverified', criado_em: agora() };
      usuario.mfa.push(fator);
      return { fator_id: fator.id, qr_code: qrFicticio(segredo), segredo: segredo };
    });
  }

  function mfaConfirmarCadastro(fatorId, codigo) {
    return escrita(function () {
      eu();
      var fator = achar(usuarioLogado().mfa || [], function (f) { return f.id === fatorId; });
      if (!fator) { throw erro('Cadastro do segundo fator não encontrado. Comece de novo.'); }
      if (!/^\d{6}$/.test(texto(codigo).trim())) {
        throw erro('Código inválido. Digite os 6 números mostrados no aplicativo autenticador.');
      }
      fator.status = 'verified';
    });
  }

  function mfaRemover(fatorId) {
    return escrita(function () {
      eu();
      var usuario = usuarioLogado();
      var antes = (usuario.mfa || []).length;
      usuario.mfa = (usuario.mfa || []).filter(function (f) { return f.id !== fatorId; });
      if (usuario.mfa.length === antes) { throw erro('Segundo fator não encontrado.'); }
    });
  }

  /* ---------- setores ---------- */

  function listarSetores() {
    return leitura(function () {
      eu();
      return ordenarPor(estado.setores.slice(), ['ordem', 'sigla']);
    });
  }

  function salvarSetor(dados) {
    return escrita(function () {
      exigirGestor();
      dados = dados || {};
      var existente = dados.id ? achar(estado.setores, function (s) { return s.id === dados.id; }) : null;
      if (dados.id && !existente) { throw erro('Setor não encontrado.'); }
      var sigla = texto(dados.sigla).trim().toUpperCase();
      var nome = texto(dados.nome).trim();
      if (!sigla || sigla.length > 15) { throw erro('Informe a sigla do setor (até 15 caracteres).'); }
      if (!nome) { throw erro('Informe o nome do setor.'); }
      if (achar(estado.setores, function (s) { return s.sigla === sigla && (!existente || s.id !== existente.id); })) {
        throw erro('Já existe um setor com a sigla ' + sigla + '.');
      }
      var cor = /^#[0-9a-fA-F]{6}$/.test(texto(dados.cor)) ? texto(dados.cor) : (existente ? existente.cor : '#1b5aa8');
      var ordem = inteiroOuNulo(dados.ordem, -9999, 9999, 'A ordem deve ser um número inteiro.');
      var registro = existente || { id: novoId(), criado_em: agora() };
      var antes = existente ? clonar(existente) : null;
      registro.sigla = sigla;
      registro.nome = nome;
      registro.cor = cor;
      registro.ordem = ordem === null ? (existente ? existente.ordem : 0) : ordem;
      if (!existente) { estado.setores.push(registro); }
      auditar('setores', existente ? 'UPDATE' : 'INSERT', registro.id, antes, registro);
      return registro;
    });
  }

  function excluirSetor(id) {
    return escrita(function () {
      exigirGestor();
      var setor = achar(estado.setores, function (s) { return s.id === id; });
      if (!setor) { throw erro('Setor não encontrado.'); }
      var emUso = estado.militares.some(function (m) { return m.setor_id === id; }) ||
        estado.atividades.some(function (a) { return a.setor_id === id; });
      if (emUso) { throw erro('Este setor tem militares ou atividades vinculados e não pode ser excluído.'); }
      remover(estado.setores, function (s) { return s.id === id; });
      auditar('setores', 'DELETE', id, setor, null);
    });
  }

  /* ---------- militares e acessos ---------- */

  function listarMilitares() {
    return leitura(function () {
      eu();
      return estado.militares.slice().sort(function (a, b) {
        return Regras.nomeMilitar(a).localeCompare(Regras.nomeMilitar(b), 'pt-BR', { sensitivity: 'base' });
      });
    });
  }

  function emailEmUso(email, militarId) {
    return estado.militares.some(function (m) { return m.email === email && m.id !== militarId; });
  }

  function exigirTrava(linhaAntes) {
    var problema = Regras.violaTravaGestor(linhaAntes, estado.militares);
    if (problema) { throw erro(problema); }
  }

  function salvarMilitar(dados) {
    return escrita(function () {
      var m = exigirGestor();
      dados = dados || {};
      var existente = dados.id ? militarPorId(dados.id) : null;
      if (dados.id && !existente) { throw erro('Militar não encontrado. O cadastro pode ter sido excluído — atualize a página.'); }
      var papel = (dados.papel === undefined || dados.papel === null || dados.papel === '')
        ? (existente ? existente.papel : 'adjunto') : dados.papel;
      if (!Object.prototype.hasOwnProperty.call(Regras.ROTULOS.papel, papel)) { throw erro('Papel inválido.'); }
      if (!Regras.podeGerenciarMilitar(m, existente, papel)) {
        throw erro((Regras.eAdministrador(existente) || papel === 'administrador') ? MSG.soAdministrador : MSG.semPermissao);
      }

      var nomeGuerra = texto(dados.nome_guerra).trim();
      if (!nomeGuerra) { throw erro('Informe o nome de guerra.'); }
      if (nomeGuerra.length > 60) { throw erro('O nome de guerra pode ter no máximo 60 caracteres.'); }
      var posto = texto(dados.posto).trim();
      if (posto.length > 30) { throw erro('O posto pode ter no máximo 30 caracteres.'); }

      var email = texto(dados.email).trim().toLowerCase() || null;
      if (email) {
        var problemaEmail = Regras.validarEmail(email);
        if (problemaEmail) { throw erro(problemaEmail); }
        if (emailEmUso(email, existente ? existente.id : null)) { throw erro('Já existe um militar cadastrado com este e-mail.'); }
      }
      if (existente && existente.usuario_id && email !== existente.email) {
        throw erro('Este militar já tem acesso ao sistema. Para mudar o e-mail, use "Alterar e-mail de acesso".');
      }

      var setorId = dados.setor_id || null;
      if (setorId && !achar(estado.setores, function (s) { return s.id === setorId; })) {
        throw erro('Setor não encontrado.');
      }

      var ativo = (dados.ativo === undefined || dados.ativo === null) ? (existente ? existente.ativo : true) : !!dados.ativo;
      if (existente && existente.id === m.id && existente.ativo && !ativo) {
        throw erro('Você não pode desativar o seu próprio acesso.');
      }

      var antes = existente ? clonar(existente) : null;
      var registro = existente || {
        id: novoId(), usuario_id: null, deve_trocar_senha: true, ultimo_acesso: null, criado_em: agora()
      };
      registro.posto = posto;
      registro.nome_guerra = nomeGuerra;
      registro.nome_completo = textoOuNulo(dados.nome_completo);
      registro.email = email;
      registro.setor_id = setorId;
      registro.papel = papel;
      registro.ativo = ativo;
      registro.atualizado_em = agora();
      if (!existente) { estado.militares.push(registro); }

      exigirTrava(antes);
      auditar('militares', existente ? 'UPDATE' : 'INSERT', registro.id, antes, registro);
      return registro;
    });
  }

  /* Senha temporária fictícia (atende a Regras.validarSenha). */
  /* Mesmo formato da Edge Function (logica.ts): 14 caracteres — 13 letras e
     números sem os que se confundem (0/O, 1/l/I), com ao menos uma
     maiúscula, uma minúscula e um número, e 1 símbolo em posição sorteada. */
  var SENHA_ALFANUMERICOS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  var SENHA_SIMBOLOS = '@#%+=';

  function sortearIndice(n) {
    try {
      if (window.crypto && window.crypto.getRandomValues) {
        var limite = 256 - (256 % n);
        var byte = new Uint8Array(1);
        do { window.crypto.getRandomValues(byte); } while (byte[0] >= limite);
        return byte[0] % n;
      }
    } catch (e) { /* sem crypto: sorteio comum (é só a demonstração) */ }
    return Math.floor(Math.random() * n);
  }

  function senhaTemporaria() {
    var base;
    do {
      base = '';
      for (var i = 0; i < 13; i += 1) { base += SENHA_ALFANUMERICOS.charAt(sortearIndice(SENHA_ALFANUMERICOS.length)); }
    } while (!/[A-Z]/.test(base) || !/[a-z]/.test(base) || !/[0-9]/.test(base));
    var posicao = sortearIndice(14);
    return base.slice(0, posicao) + SENHA_SIMBOLOS.charAt(sortearIndice(SENHA_SIMBOLOS.length)) + base.slice(posicao);
  }

  /* A linha 'ADMIN:<ação>' que a Edge Function grava em auditoria (tabela
     'auth.users'), nunca com a senha. */
  function auditarAcaoDeAcesso(acao, alvoAntes, depois) {
    var resumo = {
      id: alvoAntes.id, posto: alvoAntes.posto, nome_guerra: alvoAntes.nome_guerra, email: alvoAntes.email,
      papel: alvoAntes.papel, ativo: alvoAntes.ativo, usuario_id: alvoAntes.usuario_id
    };
    var dados = { acao: 'ADMIN:' + acao };
    Object.keys(depois || {}).forEach(function (k) { dados[k] = depois[k]; });
    auditar('auth.users', 'ADMIN:' + acao, alvoAntes.id, resumo, dados);
  }

  /* Efeito de "delete from militares" no banco: autoria vira nulo (os
     nomes ficam nas colunas *_nome), responsabilidades, notificações,
     ciências e destinatários somem; depois o usuário do Auth é apagado. */
  function excluirMilitarDoEstado(alvo) {
    var id = alvo.id;
    estado.comentarios.forEach(function (c) { if (c.autor_id === id) { c.autor_id = null; } });
    estado.evidencias.forEach(function (ev) { if (ev.enviado_por === id) { ev.enviado_por = null; } });
    estado.ocorrencias.forEach(function (oc) {
      if (oc.concluida_por === id) { oc.concluida_por = null; }
      if (oc.criado_por === id) { oc.criado_por = null; }
    });
    estado.atividades.forEach(function (a) { if (a.criado_por === id) { a.criado_por = null; } });
    estado.avisos.forEach(function (av) { if (av.criado_por === id) { av.criado_por = null; } });
    estado.configuracoes.forEach(function (c) { if (c.atualizado_por === id) { c.atualizado_por = null; } });
    remover(estado.atividade_responsaveis, function (r) { return r.militar_id === id; });
    remover(estado.notificacoes, function (n) { return n.destinatario_id === id; });
    remover(estado.avisos_ciencia, function (c) { return c.militar_id === id; });
    remover(estado.avisos_destinatarios, function (d) { return d.militar_id === id; });
    remover(estado.militares, function (m) { return m.id === id; });
    exigirTrava(alvo);
    if (alvo.usuario_id) { remover(estado.usuarios, function (u) { return u.id === alvo.usuario_id; }); }
    auditar('militares', 'DELETE', id, alvo, null);
  }

  /* Edge Function admin-usuarios. */
  function adminUsuario(acao, militarId, extra) {
    return escrita(function () {
      var m = exigirGestor();
      var alvo = exigirMilitar(militarId);
      if (!Regras.podeGerenciarMilitar(m, alvo)) { throw erro(MSG.soAdministrador); }
      extra = extra || {};
      var antes = clonar(alvo);
      var usuario = alvo.usuario_id ? usuarioPorId(alvo.usuario_id) : null;
      var senha;
      var resposta = {};
      var registro = {};

      /* Mensagens iguais às da Edge Function admin-usuarios (logica.ts). */
      switch (acao) {
        case 'criar':
          if (!alvo.ativo) { throw erro('Reative o cadastro antes de criar o acesso.'); }
          if (alvo.usuario_id) { throw erro('Este militar já tem acesso. Se ele esqueceu a senha, use "Redefinir senha".'); }
          if (!alvo.email) { throw erro('Cadastre o e-mail do militar antes de criar o acesso.'); }
          if (achar(estado.usuarios, function (u) { return u.email === alvo.email; })) {
            throw erro('Já existe um usuário de acesso com este e-mail. Se ele sobrou de um cadastro excluído, ' +
              'apague-o no painel do Supabase (Authentication → Users) ou use outro e-mail.');
          }
          usuario = { id: novoId(), email: alvo.email, mfa: [] };
          estado.usuarios.push(usuario);
          alvo.usuario_id = usuario.id;
          alvo.deve_trocar_senha = true;
          senha = senhaTemporaria();
          resposta = { senha_temporaria: senha, email: alvo.email };
          registro = { usuario_id: usuario.id, email: alvo.email, deve_trocar_senha: true };
          break;

        case 'redefinir_senha':
          if (!usuario) { throw erro('Este militar ainda não tem acesso. Use "Criar acesso".'); }
          alvo.deve_trocar_senha = true;
          senha = senhaTemporaria();
          resposta = { senha_temporaria: senha };
          registro = { deve_trocar_senha: true };
          break;

        case 'desativar':
          if (alvo.id === m.id) { throw erro('Você não pode desativar o seu próprio acesso.'); }
          alvo.ativo = false;
          registro = { ativo: false, login_bloqueado: !!usuario };
          break;

        case 'reativar':
          alvo.ativo = true;
          registro = { ativo: true };
          break;

        case 'remover_mfa':
          if (!usuario) { throw erro('Este militar ainda não tem acesso.'); }
          var removidos = (usuario.mfa || []).length;
          usuario.mfa = [];
          resposta = removidos ? { removidos: removidos }
            : { removidos: 0, aviso: 'Este militar não tinha segundo fator cadastrado.' };
          registro = { fatores_removidos: removidos };
          break;

        case 'alterar_email':
          if (!usuario) { throw erro('Este militar ainda não tem acesso: altere o e-mail no próprio cadastro.'); }
          var email = texto(extra.email).trim().toLowerCase();
          if (!email) { throw erro('Informe o novo e-mail.'); }
          var problema = Regras.validarEmail(email);
          if (problema) { throw erro(problema); }
          if (email === alvo.email) { throw erro('O novo e-mail é igual ao atual.'); }
          if (emailEmUso(email, alvo.id)) { throw erro('Este e-mail já está em uso por outro militar.'); }
          if (achar(estado.usuarios, function (u) { return u.email === email && u.id !== usuario.id; })) {
            throw erro('Já existe um usuário de acesso com este e-mail. Se ele sobrou de um cadastro excluído, ' +
              'apague-o no painel do Supabase (Authentication → Users) ou use outro e-mail.');
          }
          alvo.email = email;
          usuario.email = email;
          if (sessao && sessao.usuario_id === usuario.id) { definirSessao(usuario); }
          resposta = { email: email };
          registro = { email: email };
          break;

        case 'excluir':
          if (alvo.id === m.id) { throw erro('Você não pode excluir o seu próprio cadastro.'); }
          excluirMilitarDoEstado(alvo);
          auditarAcaoDeAcesso('excluir', antes, { excluido: true, usuario_auth_removido: !!antes.usuario_id });
          return {};

        default:
          throw erro('Ação desconhecida. Use: criar, redefinir_senha, desativar, reativar, remover_mfa, ' +
            'alterar_email, excluir.');
      }

      alvo.atualizado_em = agora();
      exigirTrava(antes);
      if (acao !== 'remover_mfa') { auditar('militares', 'UPDATE', alvo.id, antes, alvo); }
      auditarAcaoDeAcesso(acao, antes, registro);
      return resposta;
    });
  }

  function excluirMilitar(id) {
    return adminUsuario('excluir', id);
  }

  /* RPC transferir_chefia: atômica (a transação desfaz tudo se a trava
     recusar). Promove antes de rebaixar, para a trava já enxergar a nova
     chefia. */
  function transferirChefia(opcoes) {
    return escrita(function () {
      var m = eu();
      if (!Regras.eGestor(m)) {
        throw erro('Apenas a chefia ou a conta institucional da AQS podem fazer a passagem de chefia.');
      }
      opcoes = opcoes || {};
      var papelAnterior = texto(opcoes.papel_anterior).trim() || 'adjunto';
      if (!opcoes.para) { throw erro('Escolha o militar que vai assumir a chefia.'); }
      if (papelAnterior !== 'adjunto' && papelAnterior !== 'chefia') {
        throw erro('Quem deixa a chefia passa a "adjunto" ou continua como "chefia".');
      }
      if (opcoes.de && opcoes.de === opcoes.para) {
        throw erro('Quem deixa e quem assume a chefia precisam ser militares diferentes.');
      }
      var para = militarPorId(opcoes.para);
      if (!para) { throw erro('O militar escolhido para assumir a chefia não foi encontrado.'); }
      if (para.papel === 'administrador') {
        throw erro('A conta institucional (administrador) não assume a chefia; escolha um militar da equipe.');
      }
      var de = null;
      if (opcoes.de) {
        de = militarPorId(opcoes.de);
        if (!de) { throw erro('O militar que deixa a chefia não foi encontrado.'); }
        if (de.papel !== 'chefia') { throw erro(Regras.nomeMilitar(de) + ' não está com o papel de chefia.'); }
      }
      var transferir = opcoes.transferir_atividades !== false;

      var antesPara = clonar(para);
      para.papel = 'chefia';
      para.ativo = true;
      if (antesPara.papel !== para.papel || antesPara.ativo !== para.ativo) {
        para.atualizado_em = agora();
        auditar('militares', 'UPDATE', para.id, antesPara, para);
      }

      if (de) {
        if (papelAnterior !== 'chefia') {
          var antesDe = clonar(de);
          de.papel = papelAnterior;
          de.atualizado_em = agora();
          exigirTrava(antesDe);
          auditar('militares', 'UPDATE', de.id, antesDe, de);
        }
        if (transferir) {
          estado.atividades.forEach(function (a) {
            if (!a.ativa) { return; }
            var resp = responsaveisDe(a.id);
            if (resp.indexOf(de.id) < 0) { return; }
            if (resp.indexOf(para.id) < 0) {
              estado.atividade_responsaveis.push({ atividade_id: a.id, militar_id: para.id });
              auditarResponsavel('INSERT', a.id, para.id);
              notificarAtribuicao(para.id, a, m);
            }
            remover(estado.atividade_responsaveis, function (r) { return r.atividade_id === a.id && r.militar_id === de.id; });
            auditarResponsavel('DELETE', a.id, de.id);
          });
        }
      }
    });
  }

  /* ---------- feriados e configurações ---------- */

  function listarFeriados() {
    return leitura(function () {
      eu();
      return ordenarPor(estado.feriados.slice(), ['data']);
    });
  }

  /* Insere ou atualiza pela data. 'data_original' permite corrigir a data
     de um feriado já cadastrado. */
  function salvarFeriado(f) {
    return escrita(function () {
      exigirGestor();
      f = f || {};
      var data = dataOuNulo(f.data, 'A data do feriado');
      if (!data) { throw erro('Informe a data do feriado.'); }
      var descricao = texto(f.descricao).trim();
      if (!descricao) { throw erro('Informe a descrição do feriado.'); }
      var original = f.data_original ? String(f.data_original).slice(0, 10) : null;
      if (original && original !== data) {
        if (achar(estado.feriados, function (x) { return x.data === data; })) {
          throw erro('Já existe um feriado cadastrado nesta data.');
        }
        var velho = achar(estado.feriados, function (x) { return x.data === original; });
        if (velho) {
          remover(estado.feriados, function (x) { return x.data === original; });
          auditar('feriados', 'DELETE', original, velho, null);
        }
      }
      var existente = achar(estado.feriados, function (x) { return x.data === data; });
      var antes = existente ? clonar(existente) : null;
      var registro = existente || { data: data };
      registro.descricao = descricao;
      if (!existente) { estado.feriados.push(registro); }
      auditar('feriados', existente ? 'UPDATE' : 'INSERT', data, antes, registro);
      return registro;
    });
  }

  function excluirFeriado(data) {
    return escrita(function () {
      exigirGestor();
      var d = String(data || '').slice(0, 10);
      var existente = achar(estado.feriados, function (x) { return x.data === d; });
      if (!existente) { throw erro('Feriado não encontrado.'); }
      remover(estado.feriados, function (x) { return x.data === d; });
      auditar('feriados', 'DELETE', d, existente, null);
    });
  }

  function mapaConfiguracoes() {
    var mapa = {};
    estado.configuracoes.forEach(function (c) { mapa[c.chave] = c.valor; });
    return mapa;
  }

  function obterConfiguracoes() {
    return leitura(function () {
      eu();
      return mapaConfiguracoes();
    });
  }

  function gravarConfiguracao(chave, valor, autor) {
    var existente = achar(estado.configuracoes, function (c) { return c.chave === chave; });
    var antes = existente ? clonar(existente) : null;
    var registro = existente || { chave: chave };
    registro.valor = clonar(valor);
    registro.atualizado_em = agora();
    registro.atualizado_por = autor ? autor.id : null;
    if (!existente) { estado.configuracoes.push(registro); }
    auditar('configuracoes', existente ? 'UPDATE' : 'INSERT', chave, antes, registro);
    return registro;
  }

  function salvarConfiguracao(chave, valor) {
    return escrita(function () {
      var m = exigirGestor();
      if (!/^[a-z][a-z0-9_]{0,49}$/.test(texto(chave))) { throw erro('Chave de configuração inválida.'); }
      if (valor === undefined || valor === null) { throw erro('Informe o valor da configuração.'); }
      gravarConfiguracao(chave, valor, m);
      return clonar(valor);
    });
  }

  /* ---------- atividades ---------- */

  function listarAtividades() {
    return leitura(function () {
      eu();
      var indice = indiceResponsaveis();
      return ordenarPor(estado.atividades.slice(), ['ordem', 'criado_em']).map(function (a) {
        return atividadeCompleta(a, indice);
      });
    });
  }

  function tem(dados, chave) {
    return Object.prototype.hasOwnProperty.call(dados, chave) && dados[chave] !== undefined;
  }

  /* Inteiro lido do formulário: vazio = nulo; o intervalo é validado depois. */
  function inteiroLido(valor, mensagem) {
    if (valor === null || valor === '') { return null; }
    var n = Number(valor);
    if (!isFinite(n) || Math.floor(n) !== n) { throw erro(mensagem); }
    return n;
  }

  function entre(n, minimo, maximo) { return n !== null && n >= minimo && n <= maximo; }

  /* Monta a atividade como o RPC salvar_atividade: chave ausente mantém o
     valor atual (edição) ou o padrão (criação); chave presente com nulo
     limpa. Valida com as mesmas mensagens e normaliza como o gatilho
     atividades_antes (zera o que não vale para o tipo/periodicidade). */
  function montarAtividade(dados, existente) {
    var dia = hoje();
    var a = existente ? clonar(existente) : {
      ordem: null, titulo: null, descricao: '', setor_id: null, tipo: null, periodicidade: null,
      dia_semana: null, dia_mes: null, mes_inicio: null, prazo: null, antecipar_dia_util: true,
      prioridade: 'normal', exige_evidencia: false, ativa: true, data_inicio: dia
    };
    if (tem(dados, 'ordem')) {
      var ordem = inteiroLido(dados.ordem, 'O número no plano deve ser um número inteiro.');
      a.ordem = ordem === null ? (existente ? existente.ordem : null) : ordem;
    }
    if (tem(dados, 'titulo')) { a.titulo = texto(dados.titulo).trim(); }
    if (tem(dados, 'descricao')) { a.descricao = texto(dados.descricao); }
    if (tem(dados, 'setor_id')) { a.setor_id = dados.setor_id || null; }
    if (tem(dados, 'tipo')) { a.tipo = texto(dados.tipo).trim() || null; }
    if (tem(dados, 'periodicidade')) { a.periodicidade = texto(dados.periodicidade).trim() || null; }
    if (tem(dados, 'dia_semana')) { a.dia_semana = inteiroLido(dados.dia_semana, 'Informe o dia da semana (1 = segunda … 7 = domingo).'); }
    if (tem(dados, 'dia_mes')) { a.dia_mes = inteiroLido(dados.dia_mes, 'Informe o dia do mês (1 a 31; 31 = último dia do mês).'); }
    if (tem(dados, 'mes_inicio')) { a.mes_inicio = inteiroLido(dados.mes_inicio, 'Informe o mês de início do ciclo (1 a 12).'); }
    if (tem(dados, 'prazo')) { a.prazo = dataOuNulo(dados.prazo, 'O prazo'); }
    if (tem(dados, 'antecipar_dia_util')) { a.antecipar_dia_util = dados.antecipar_dia_util === null ? true : !!dados.antecipar_dia_util; }
    if (tem(dados, 'prioridade')) { a.prioridade = texto(dados.prioridade).trim() || 'normal'; }
    if (tem(dados, 'exige_evidencia')) { a.exige_evidencia = dados.exige_evidencia === null ? false : !!dados.exige_evidencia; }
    if (tem(dados, 'ativa')) { a.ativa = dados.ativa === null ? true : !!dados.ativa; }
    if (tem(dados, 'data_inicio')) {
      a.data_inicio = dataOuNulo(dados.data_inicio, 'A data de início') || (existente ? existente.data_inicio : dia);
    }

    if (!a.titulo || a.titulo.length < 3 || a.titulo.length > 200) { throw erro('O título deve ter entre 3 e 200 caracteres.'); }
    if (a.descricao.length > 10000) { throw erro('A descrição pode ter no máximo 10.000 caracteres.'); }
    if (['recorrente', 'pontual', 'sob_demanda'].indexOf(a.tipo) < 0) {
      throw erro('Tipo de atividade inválido (use recorrente, pontual ou sob demanda).');
    }
    if (['baixa', 'normal', 'alta', 'urgente'].indexOf(a.prioridade) < 0) {
      throw erro('Prioridade inválida (use baixa, normal, alta ou urgente).');
    }
    if (a.tipo === 'recorrente') {
      if (PERIODICIDADES.indexOf(a.periodicidade) < 0) { throw erro('Informe a periodicidade da atividade recorrente.'); }
      if (a.periodicidade === 'semanal' && !entre(a.dia_semana, 1, 7)) {
        throw erro('Informe o dia da semana (1 = segunda … 7 = domingo).');
      }
      if (COM_DIA_MES.indexOf(a.periodicidade) >= 0 && !entre(a.dia_mes, 1, 31)) {
        throw erro('Informe o dia do mês (1 a 31; 31 = último dia do mês).');
      }
      if (COM_MES_INICIO.indexOf(a.periodicidade) >= 0 && !entre(a.mes_inicio, 1, 12)) {
        throw erro('Informe o mês de início do ciclo (1 a 12).');
      }
    }
    if (a.setor_id && !achar(estado.setores, function (x) { return x.id === a.setor_id; })) {
      throw erro('Setor não encontrado.');
    }

    if (a.tipo !== 'recorrente') {
      a.periodicidade = null; a.dia_semana = null; a.dia_mes = null; a.mes_inicio = null;
    } else if (a.periodicidade === 'diaria_util') {
      a.dia_semana = null; a.dia_mes = null; a.mes_inicio = null;
    } else if (a.periodicidade === 'semanal') {
      a.dia_mes = null; a.mes_inicio = null;
    } else if (a.periodicidade === 'mensal') {
      a.dia_semana = null; a.mes_inicio = null;
    } else {
      a.dia_semana = null;
    }
    if (a.tipo !== 'pontual') { a.prazo = null; }
    if (a.ordem === null || a.ordem === undefined) {
      a.ordem = existente ? existente.ordem : estado.atividades.reduce(function (max, x) {
        return Math.max(max, Number(x.ordem) || 0);
      }, 0) + 1;
    }
    return a;
  }

  /* Gatilho atividades_pontual: pontual ativa tem exatamente uma ocorrência
     'P' com o prazo da atividade enquanto aberta; deixou de ser pontual
     ativa, a 'P' sai se ainda estiver pendente, intocada e não vencida. */
  function gatilhoPontual(nova, antiga) {
    var unica = achar(estado.ocorrencias, function (oc) { return oc.atividade_id === nova.id && oc.referencia === 'P'; });
    if (nova.tipo === 'pontual' && nova.ativa) {
      if (!unica) {
        inserirOcorrencia({ atividade_id: nova.id, referencia: 'P', prazo: nova.prazo, criado_por: nova.criado_por }, null);
      } else if (antiga && Regras.estaAberta(unica) && unica.prazo !== nova.prazo) {
        var antesUnica = clonar(unica);
        unica.prazo = nova.prazo;
        unica.atualizado_em = agora();
        auditar('ocorrencias', 'UPDATE', unica.id, antesUnica, unica);
      }
    } else if (antiga && antiga.tipo === 'pontual' && antiga.ativa && unica && unica.status === 'pendente' &&
               (!unica.prazo || unica.prazo >= hoje()) && !ocorrenciaTocada(unica.id)) {
      apagarOcorrencia(unica);
    }
  }

  /* Ocorrência com trabalho registrado (evidência ou comentário). */
  function ocorrenciaTocada(id) {
    return estado.evidencias.some(function (ev) { return ev.ocorrencia_id === id; }) ||
      estado.comentarios.some(function (c) { return c.ocorrencia_id === id; });
  }

  /* RPC salvar_atividade — mesmas validações, permissões e mensagens. */
  function salvarAtividade(dados) {
    return escrita(function () {
      var m = eu();
      dados = dados || {};
      var gestor = Regras.eGestor(m);
      var existente = dados.id ? atividadePorId(dados.id) : null;
      if (dados.id && !existente) { throw erro('Atividade não encontrada (pode ter sido excluída).'); }
      var nova = montarAtividade(dados, existente);

      var antigos = existente ? responsaveisDe(existente.id) : [];
      var informados = tem(dados, 'responsaveis');
      var resp;
      if (informados) {
        if (!Array.isArray(dados.responsaveis)) { throw erro('A lista de responsáveis é inválida.'); }
        resp = idsUnicos(dados.responsaveis);
        if (!resp.length) { throw erro('Informe ao menos um responsável.'); }
      } else if (existente) {
        resp = antigos.slice();
      } else {
        throw erro('Informe ao menos um responsável.');
      }

      if (!gestor) {
        if (!existente) {
          if (nova.tipo !== 'pontual' && nova.tipo !== 'sob_demanda') {
            throw erro('Apenas a chefia pode criar atividades recorrentes.');
          }
          if (resp.indexOf(m.id) < 0) { throw erro('Inclua você mesmo entre os responsáveis da nova atividade.'); }
        } else {
          if (antigos.indexOf(m.id) < 0) { throw erro('Apenas a chefia ou os responsáveis podem editar esta atividade.'); }
          if (!mesmoConjunto(antigos, resp)) { throw erro('Apenas a chefia pode alterar os responsáveis de uma atividade.'); }
          if (nova.tipo === 'recorrente' && existente.tipo !== 'recorrente') {
            throw erro('Apenas a chefia pode transformar uma atividade em recorrente.');
          }
        }
      }

      /* Quem entra agora precisa existir, estar ativo e não ser a conta
         institucional (que não recebe missões). Quem já estava pode ficar. */
      var novos = resp.filter(function (id) { return antigos.indexOf(id) < 0; });
      novos.forEach(function (id) {
        if (!militarPorId(id)) { throw erro('Responsável não encontrado (o cadastro pode ter sido excluído).'); }
      });
      novos.forEach(function (id) {
        if (militarPorId(id).papel === 'administrador') {
          throw erro('A conta institucional (administrador) não recebe missões; escolha um militar da equipe.');
        }
      });
      novos.forEach(function (id) {
        if (!militarPorId(id).ativo) { throw erro('Não é possível atribuir a atividade a um militar desativado.'); }
      });

      var registro, antes = null, regraMudou = false;
      if (existente) {
        antes = clonar(existente);
        regraMudou = CAMPOS_AGENDA.some(function (c) { return existente[c] !== nova[c]; });
        registro = existente;
        Object.keys(nova).forEach(function (k) { registro[k] = nova[k]; });
        var mudou = Object.keys(nova).some(function (k) { return k !== 'atualizado_em' && antes[k] !== registro[k]; });
        if (mudou) {
          registro.atualizado_em = agora();
          auditar('atividades', 'UPDATE', registro.id, antes, registro);
        }
      } else {
        registro = nova;
        registro.id = novoId();
        registro.criado_por = m.id;
        registro.criado_em = agora();
        registro.atualizado_em = registro.criado_em;
        estado.atividades.push(registro);
        auditar('atividades', 'INSERT', registro.id, null, registro);
      }
      gatilhoPontual(registro, antes);

      if (informados) {
        antigos.forEach(function (id) {
          if (resp.indexOf(id) >= 0) { return; }
          remover(estado.atividade_responsaveis, function (r) { return r.atividade_id === registro.id && r.militar_id === id; });
          auditarResponsavel('DELETE', registro.id, id);
        });
        novos.forEach(function (id) {
          estado.atividade_responsaveis.push({ atividade_id: registro.id, militar_id: id });
          auditarResponsavel('INSERT', registro.id, id);
          notificarAtribuicao(id, registro, m);
        });
      }

      /* Regra de agenda mudou: as recorrentes FUTURAS ainda pendentes e sem
         evidência/comentário saem e são geradas de novo pela regra nova. */
      if (existente && regraMudou) {
        var dia = hoje();
        estado.ocorrencias.filter(function (oc) {
          return oc.atividade_id === registro.id && oc.status === 'pendente' && oc.prazo && oc.prazo >= dia &&
            oc.referencia && oc.referencia !== 'P' && !ocorrenciaTocada(oc.id);
        }).forEach(apagarOcorrencia);
      }

      /* Arquivada agora: o que estava em aberto vira "não se aplica", com a
         justificativa (como salvar_atividade no banco). */
      if (existente && antes.ativa && !registro.ativa) {
        var justificativa = 'Atividade arquivada em ' + U.formatarData(hoje()) + ' por ' + Regras.nomeMilitar(m) + '.';
        estado.ocorrencias.filter(function (oc) {
          return oc.atividade_id === registro.id && Regras.estaAberta(oc);
        }).forEach(function (oc) {
          var anterior = clonar(oc);
          oc.status = 'nao_se_aplica';
          oc.justificativa = justificativa;
          oc.atualizado_em = agora();
          auditar('ocorrencias', 'UPDATE', oc.id, anterior, oc);
        });
      }

      gerarParaAtividade(registro, feriadosMapa());
      notificarPrazos();
      return registro.id;
    });
  }

  function excluirAtividade(id) {
    return escrita(function () {
      exigirGestor();
      var a = exigirAtividade(id);
      removerEvidencias(function (ev) { return ev.atividade_id === id; });
      remover(estado.comentarios, function (c) { return c.atividade_id === id; });
      estado.ocorrencias.filter(function (oc) { return oc.atividade_id === id; }).forEach(function (oc) {
        desvincularNotificacoes('ocorrencia_id', oc.id);
      });
      remover(estado.ocorrencias, function (oc) { return oc.atividade_id === id; });
      remover(estado.atividade_responsaveis, function (r) { return r.atividade_id === id; });
      estado.avisos.forEach(function (av) { if (av.atividade_id === id) { av.atividade_id = null; } });
      desvincularNotificacoes('atividade_id', id);
      remover(estado.atividades, function (x) { return x.id === id; });
      auditar('atividades', 'DELETE', id, a, null);
    });
  }

  function gerarOcorrencias() {
    return escrita(function () {
      eu();
      var mapa = feriadosMapa();
      var total = 0;
      estado.atividades.forEach(function (a) { total += gerarParaAtividade(a, mapa); });
      notificarPrazos();
      return total;
    });
  }

  /* ---------- ocorrências ---------- */

  function listarOcorrencias(filtro) {
    return leitura(function () {
      eu();
      filtro = filtro || {};
      var ctx = contextoView();
      var linhas = estado.ocorrencias.filter(function (oc) {
        if (filtro.atividade_id && oc.atividade_id !== filtro.atividade_id) { return false; }
        if (filtro.somenteAbertas && !Regras.estaAberta(oc)) { return false; }
        return true;
      }).map(function (oc) { return linhaView(oc, ctx); }).filter(function (r) {
        if (filtro.de && r.data_ref < String(filtro.de).slice(0, 10)) { return false; }
        if (filtro.ate && r.data_ref > String(filtro.ate).slice(0, 10)) { return false; }
        return true;
      });
      linhas.forEach(function (r) { r.__ordem = (ctx.atividades[r.atividade_id] || {}).ordem || 0; });
      ordenarPor(linhas, ['data_ref', '__ordem', 'criado_em']);
      linhas.forEach(function (r) { delete r.__ordem; });
      return linhas;
    });
  }

  function obterOcorrencia(id) {
    return leitura(function () {
      eu();
      return linhaView(exigirOcorrencia(id));
    });
  }

  function criarOcorrencia(dados) {
    return escrita(function () {
      var m = eu();
      dados = dados || {};
      var a = exigirAtividade(dados.atividade_id);
      if (!Regras.podeRegistrarExecucao(m, atividadeCompleta(a))) { throw erro(MSG.semPermissao); }
      var status = dados.status || 'pendente';
      validarStatus(status, dados.justificativa);
      var tituloExecucao = textoOuNulo(dados.titulo_execucao);
      if (tituloExecucao && tituloExecucao.length > 200) { throw erro('O título da execução pode ter no máximo 200 caracteres.'); }
      var observacao = texto(dados.observacao);
      if (observacao.length > 10000) { throw erro('A observação pode ter no máximo 10.000 caracteres.'); }
      var oc = inserirOcorrencia({
        atividade_id: a.id, referencia: null, titulo_execucao: tituloExecucao,
        prazo: dataOuNulo(dados.prazo, 'O prazo'), status: status, observacao: observacao,
        justificativa: textoOuNulo(dados.justificativa)
      }, m);
      return linhaView(oc);
    });
  }

  function atualizarOcorrencia(id, campos) {
    return escrita(function () {
      var m = eu();
      campos = campos || {};
      var oc = exigirOcorrencia(id);
      if (!Regras.podeAtualizarOcorrencia(m, linhaView(oc))) { throw erro(MSG.semPermissao); }
      var antes = clonar(oc);
      var mudou = {};
      CAMPOS_OCORRENCIA_EDITAVEIS.forEach(function (c) {
        if (Object.prototype.hasOwnProperty.call(campos, c)) { mudou[c] = campos[c]; }
      });

      if (Object.prototype.hasOwnProperty.call(mudou, 'prazo')) {
        var novoPrazo = dataOuNulo(mudou.prazo, 'O prazo');
        if (novoPrazo !== oc.prazo && !Regras.podeAlterarPrazoOcorrencia(m)) {
          throw erro('Apenas a chefia pode alterar o prazo, a referência ou a atividade de uma ocorrência.');
        }
        oc.prazo = novoPrazo;
      }
      if (Object.prototype.hasOwnProperty.call(mudou, 'observacao')) {
        oc.observacao = texto(mudou.observacao);
        if (oc.observacao.length > 10000) { throw erro('A observação pode ter no máximo 10.000 caracteres.'); }
      }
      if (Object.prototype.hasOwnProperty.call(mudou, 'justificativa')) { oc.justificativa = textoOuNulo(mudou.justificativa); }
      if (Object.prototype.hasOwnProperty.call(mudou, 'titulo_execucao')) {
        oc.titulo_execucao = textoOuNulo(mudou.titulo_execucao);
        if (oc.titulo_execucao && oc.titulo_execucao.length > 200) {
          throw erro('O título da execução pode ter no máximo 200 caracteres.');
        }
      }
      if (Object.prototype.hasOwnProperty.call(mudou, 'status')) { oc.status = mudou.status; }
      validarStatus(oc.status, oc.justificativa);
      carimbarStatus(oc, antes.status, m);
      oc.atualizado_em = agora();
      auditar('ocorrencias', 'UPDATE', oc.id, antes, oc);
      return linhaView(oc);
    });
  }

  function excluirOcorrencia(id) {
    return escrita(function () {
      exigirGestor();
      apagarOcorrencia(exigirOcorrencia(id));
    });
  }

  /* ---------- evidências ---------- */

  function listarEvidencias(filtro) {
    return leitura(function () {
      eu();
      filtro = filtro || {};
      var lista = estado.evidencias.filter(function (ev) {
        if (filtro.atividade_id && ev.atividade_id !== filtro.atividade_id) { return false; }
        if (filtro.ocorrencia_id && ev.ocorrencia_id !== filtro.ocorrencia_id) { return false; }
        return true;
      });
      return ordenarPor(lista, ['-enviado_em']);
    });
  }

  function nomeSeguro(nome) {
    if (typeof U !== 'undefined' && U && typeof U.nomeSeguro === 'function') { return U.nomeSeguro(nome); }
    return String(nome || 'arquivo').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 80) || 'arquivo';
  }

  function enviarEvidencia(dados) {
    return escrita(function () {
      var m = eu();
      dados = dados || {};
      var a = exigirAtividade(dados.atividade_id);
      var oc = null;
      if (dados.ocorrencia_id) {
        oc = exigirOcorrencia(dados.ocorrencia_id);
        if (oc.atividade_id !== a.id) { throw erro('A ocorrência informada não pertence a esta atividade.'); }
      }
      var problema = Regras.validarArquivo(dados.arquivo);
      if (problema) { throw erro(problema); }
      if (!Regras.podeEnviarEvidencia(m, atividadeCompleta(a))) { throw erro(MSG.semPermissao); }
      var descricao = texto(dados.descricao).trim();
      if (descricao.length > 500) { throw erro('A descrição pode ter no máximo 500 caracteres.'); }

      var id = novoId();
      var caminho = a.id + '/' + (oc ? oc.id : 'geral') + '/' + id + '-' + nomeSeguro(dados.arquivo.name);
      var linha = {
        id: id, atividade_id: a.id, ocorrencia_id: oc ? oc.id : null, storage_path: caminho,
        nome: String(dados.arquivo.name), mime: Regras.mimeDe(dados.arquivo), tamanho: Number(dados.arquivo.size),
        descricao: descricao, enviado_por: m.id, enviado_por_nome: Regras.nomeMilitar(m), enviado_em: agora()
      };
      arquivos[caminho] = dados.arquivo;
      estado.evidencias.push(linha);
      estado.evidencias_enviadas[id] = true;
      auditar('evidencias', 'INSERT', id, null, linha);
      return linha;
    });
  }

  function acharEvidencia(evidencia) {
    var id = (evidencia && typeof evidencia === 'object') ? evidencia.id : evidencia;
    var ev = achar(estado.evidencias, function (x) { return x.id === id; });
    if (!ev) { throw erro('Evidência não encontrada. Ela pode ter sido excluída — atualize a página.'); }
    return ev;
  }

  function baixarEvidencia(evidencia) {
    return atrasar(function () {
      carregarEstado();
      eu();
      var ev = acharEvidencia(evidencia);
      var guardado = arquivos[ev.storage_path];
      if (guardado) {
        return (guardado.type === ev.mime) ? guardado : new Blob([guardado], { type: ev.mime });
      }
      var linhas = [
        'HABE · AQS e NSP — MODO DEMONSTRAÇÃO',
        '',
        estado.evidencias_enviadas[ev.id]
          ? 'Este arquivo foi enviado nesta demonstração, mas o conteúdo fica só na memória da página ' +
            'e se perdeu quando a página foi recarregada.'
          : 'Esta é uma evidência fictícia: na demonstração existem apenas os dados do arquivo, não o conteúdo.',
        '',
        'Arquivo: ' + ev.nome,
        'Tamanho informado: ' + ev.tamanho + ' bytes',
        'Enviado por: ' + (ev.enviado_por_nome || '—'),
        'Enviado em: ' + ev.enviado_em,
        '',
        'No sistema real, o download devolve o arquivo original, guardado no armazenamento privado do Supabase.'
      ];
      return new Blob([linhas.join('\r\n')], { type: 'text/plain;charset=utf-8' });
    });
  }

  function excluirEvidencia(evidencia) {
    return escrita(function () {
      var m = eu();
      var ev = acharEvidencia(evidencia);
      if (!Regras.podeExcluirEvidencia(m, ev)) { throw erro(MSG.semPermissao); }
      removerEvidencias(function (x) { return x.id === ev.id; });
      auditar('evidencias', 'DELETE', ev.id, ev, null);
    });
  }

  /* ---------- comentários ---------- */

  function listarComentarios(filtro) {
    return leitura(function () {
      eu();
      filtro = filtro || {};
      var lista = estado.comentarios.filter(function (c) {
        if (filtro.atividade_id && c.atividade_id !== filtro.atividade_id) { return false; }
        if (filtro.ocorrencia_id && c.ocorrencia_id !== filtro.ocorrencia_id) { return false; }
        return true;
      });
      return ordenarPor(lista, ['criado_em']);
    });
  }

  function comentar(dados) {
    return escrita(function () {
      var m = eu();
      dados = dados || {};
      var a = exigirAtividade(dados.atividade_id);
      var oc = null;
      if (dados.ocorrencia_id) {
        oc = exigirOcorrencia(dados.ocorrencia_id);
        if (oc.atividade_id !== a.id) { throw erro('A ocorrência informada não pertence a esta atividade.'); }
      }
      var conteudo = texto(dados.texto).trim();
      if (!conteudo) { throw erro('Escreva o comentário antes de enviar.'); }
      if (conteudo.length > 4000) { throw erro('O comentário pode ter no máximo 4000 caracteres.'); }
      var c = {
        id: novoId(), atividade_id: a.id, ocorrencia_id: oc ? oc.id : null, autor_id: m.id,
        autor_nome: Regras.nomeMilitar(m), autor_papel: m.papel, texto: conteudo, criado_em: agora()
      };
      estado.comentarios.push(c);
      auditar('comentarios', 'INSERT', c.id, null, c);

      /* tg_notificar_comentario: responsáveis e chefias ativos (não a conta
         institucional, salvo se for responsável), menos o autor. */
      var responsaveis = responsaveisDe(a.id);
      estado.militares.forEach(function (x) {
        if (!x.ativo || x.id === m.id) { return; }
        if (x.papel !== 'chefia' && responsaveis.indexOf(x.id) < 0) { return; }
        notificar(x.id, 'comentario',
          { autor_nome: c.autor_nome, autor_papel: c.autor_papel, atividade_titulo: a.titulo, texto: conteudo },
          { atividade_id: a.id, ocorrencia_id: c.ocorrencia_id });
      });
      return c;
    });
  }

  function excluirComentario(id) {
    return escrita(function () {
      var m = eu();
      var c = achar(estado.comentarios, function (x) { return x.id === id; });
      if (!c) { throw erro('Comentário não encontrado. Ele pode ter sido excluído — atualize a página.'); }
      if (!Regras.podeExcluirComentario(m, c)) { throw erro(MSG.semPermissao); }
      remover(estado.comentarios, function (x) { return x.id === id; });
      auditar('comentarios', 'DELETE', id, c, null);
    });
  }

  /* ---------- avisos ---------- */

  function destinatariosDe(avisoId) {
    return estado.avisos_destinatarios.filter(function (d) { return d.aviso_id === avisoId; })
      .map(function (d) { return d.militar_id; });
  }

  function avisoCompleto(av, m) {
    var r = clonar(av);
    r.destinatarios = destinatariosDe(av.id);
    /* RLS de avisos_ciencia: gestor vê todas; os demais, só a própria. */
    r.ciencias = estado.avisos_ciencia.filter(function (c) {
      return c.aviso_id === av.id && (Regras.eGestor(m) || c.militar_id === m.id);
    }).map(function (c) { return { militar_id: c.militar_id, ciente_em: c.ciente_em }; });
    r.ciente_por_mim = r.ciencias.some(function (c) { return c.militar_id === m.id; });
    return r;
  }

  function listarAvisos(filtro) {
    return leitura(function () {
      var m = eu();
      filtro = filtro || {};
      var dia = hoje();
      var lista = estado.avisos.map(function (av) { return avisoCompleto(av, m); }).filter(function (av) {
        if (!Regras.podeVerAviso(m, av)) { return false; }
        if (!filtro.incluirExpirados && av.expira_em && av.expira_em < dia) { return false; }
        return true;
      });
      lista.forEach(function (av) { av.__fixado = av.fixado ? 1 : 0; });
      ordenarPor(lista, ['-__fixado', '-criado_em']);
      lista.forEach(function (av) { delete av.__fixado; });
      return lista;
    });
  }

  function salvarAviso(dados) {
    return escrita(function () {
      var m = exigirGestor();
      dados = dados || {};
      var existente = dados.id ? achar(estado.avisos, function (x) { return x.id === dados.id; }) : null;
      if (dados.id && !existente) { throw erro('Aviso não encontrado. Ele pode ter sido excluído — atualize a página.'); }
      var titulo = texto(dados.titulo).trim();
      if (!titulo) { throw erro('Informe o título do aviso.'); }
      if (titulo.length > 200) { throw erro('O título do aviso pode ter no máximo 200 caracteres.'); }
      var mensagem = texto(dados.mensagem);
      if (mensagem.length > 10000) { throw erro('A mensagem pode ter no máximo 10.000 caracteres.'); }
      var nivel = dados.nivel || 'informativo';
      if (!Object.prototype.hasOwnProperty.call(Regras.ROTULOS.nivel, nivel)) { throw erro('Nível do aviso inválido.'); }
      var paraTodos = (dados.para_todos === undefined || dados.para_todos === null) ? true : !!dados.para_todos;
      var destinatarios = paraTodos ? [] : idsUnicos(dados.destinatarios);
      if (!paraTodos && !destinatarios.length) {
        throw erro('Escolha ao menos um destinatário ou marque o aviso como "para todos".');
      }
      destinatarios.forEach(function (id) {
        if (!militarPorId(id)) { throw erro('Destinatário não encontrado (o cadastro pode ter sido excluído).'); }
      });
      var atividadeId = dados.atividade_id || null;
      if (atividadeId) { exigirAtividade(atividadeId); }

      var antes = existente ? clonar(existente) : null;
      var av = existente || {
        id: novoId(), criado_por: m.id, criado_por_nome: Regras.nomeMilitar(m), criado_em: agora()
      };
      av.titulo = titulo;
      av.mensagem = mensagem;
      av.nivel = nivel;
      av.para_todos = paraTodos;
      av.prazo = dataOuNulo(dados.prazo, 'O prazo');
      av.atividade_id = atividadeId;
      av.fixado = !!dados.fixado;
      av.expira_em = dataOuNulo(dados.expira_em, 'A data de expiração');
      av.atualizado_em = agora();
      if (!existente) { estado.avisos.push(av); }
      auditar('avisos', existente ? 'UPDATE' : 'INSERT', av.id, antes, av);

      /* Gatilhos de notificação: cada militar ativo (menos o autor do aviso)
         recebe no máximo uma notificação por aviso. "Para todos" avisa todos
         na criação ou quando um aviso dirigido passa a ser para todos; num
         aviso dirigido, cada destinatário incluído é avisado. */
      function avisar(militarId) {
        var alvo = militarPorId(militarId);
        if (!alvo || !alvo.ativo || militarId === av.criado_por) { return; }
        if (achar(estado.notificacoes, function (n) {
          return n.tipo === 'aviso' && n.aviso_id === av.id && n.destinatario_id === militarId;
        })) { return; }
        notificar(militarId, 'aviso', { aviso_titulo: av.titulo, mensagem: av.mensagem },
          { aviso_id: av.id, atividade_id: av.atividade_id });
      }
      if (paraTodos && (!existente || !antes.para_todos)) {
        estado.militares.forEach(function (x) { avisar(x.id); });
      }
      var atuais = existente ? destinatariosDe(av.id) : [];
      atuais.forEach(function (id) {
        if (destinatarios.indexOf(id) >= 0) { return; }
        remover(estado.avisos_destinatarios, function (d) { return d.aviso_id === av.id && d.militar_id === id; });
      });
      destinatarios.forEach(function (id) {
        if (atuais.indexOf(id) >= 0) { return; }
        estado.avisos_destinatarios.push({ aviso_id: av.id, militar_id: id });
        if (!paraTodos) { avisar(id); }
      });
      return avisoCompleto(av, m);
    });
  }

  function excluirAviso(id) {
    return escrita(function () {
      exigirGestor();
      var av = achar(estado.avisos, function (x) { return x.id === id; });
      if (!av) { throw erro('Aviso não encontrado. Ele pode ter sido excluído — atualize a página.'); }
      remover(estado.avisos_destinatarios, function (d) { return d.aviso_id === id; });
      remover(estado.avisos_ciencia, function (c) { return c.aviso_id === id; });
      desvincularNotificacoes('aviso_id', id);
      remover(estado.avisos, function (x) { return x.id === id; });
      auditar('avisos', 'DELETE', id, av, null);
    });
  }

  function darCiencia(avisoId) {
    return escrita(function () {
      var m = eu();
      var av = achar(estado.avisos, function (x) { return x.id === avisoId; });
      if (!av || !Regras.podeVerAviso(m, avisoCompleto(av, m))) { throw erro('Aviso não encontrado.'); }
      var ja = achar(estado.avisos_ciencia, function (c) { return c.aviso_id === avisoId && c.militar_id === m.id; });
      if (!ja) { estado.avisos_ciencia.push({ aviso_id: avisoId, militar_id: m.id, ciente_em: agora() }); }
      /* Quem deu ciência já leu: a notificação do aviso sai do sino. */
      minhasNotificacoes(m).forEach(function (n) { if (n.aviso_id === avisoId) { n.lida = true; } });
    });
  }

  /* ---------- notificações ---------- */

  function minhasNotificacoes(m) {
    return estado.notificacoes.filter(function (n) { return n.destinatario_id === m.id; });
  }

  function listarNotificacoes(opcoes) {
    return leitura(function () {
      var m = eu();
      var limite = Math.max(1, Math.floor(Number(opcoes && opcoes.limite) || 30));
      return ordenarPor(minhasNotificacoes(m), ['-criado_em']).slice(0, limite);
    });
  }

  function contarNaoLidas() {
    return leitura(function () {
      var m = eu();
      return minhasNotificacoes(m).filter(function (n) { return !n.lida; }).length;
    });
  }

  function marcarNotificacoesLidas(ids) {
    return escrita(function () {
      var m = eu();
      var alvo = Array.isArray(ids) ? ids : null;
      minhasNotificacoes(m).forEach(function (n) {
        if (!alvo || alvo.indexOf(n.id) >= 0) { n.lida = true; }
      });
    });
  }

  /* ---------- gestão: auditoria e exportação ---------- */

  function listarAuditoria(opcoes) {
    return leitura(function () {
      exigirGestor();
      opcoes = opcoes || {};
      var limite = Math.max(1, Math.floor(Number(opcoes.limite) || 200));
      var lista = estado.auditoria.filter(function (r) { return !opcoes.tabela || r.tabela === opcoes.tabela; });
      return ordenarPor(lista, ['-id']).slice(0, limite);
    });
  }

  var TABELAS_EXPORTADAS = ['setores', 'militares', 'feriados', 'atividades', 'atividade_responsaveis',
    'ocorrencias', 'evidencias', 'comentarios', 'avisos', 'avisos_destinatarios', 'avisos_ciencia',
    'notificacoes', 'configuracoes', 'auditoria'];

  function exportarTudo() {
    return escrita(function () {
      var m = exigirGestor();
      var quando = agora();
      gravarConfiguracao('ultimo_backup', { em: quando, por_nome: Regras.nomeMilitar(m) }, m);
      var tabelas = {};
      TABELAS_EXPORTADAS.forEach(function (t) { tabelas[t] = clonar(estado[t]); });
      return {
        sistema: 'HABE · AQS e NSP — Ferramenta de Gestão de Atividades',
        origem: 'demonstracao',
        gerado_em: quando,
        gerado_por: Regras.nomeMilitar(m),
        observacao: 'Cópia de todas as tabelas, sem o conteúdo dos arquivos de evidência.',
        tabelas: tabelas
      };
    });
  }

  /* A demonstração não tem outros usuários conectados: nada a avisar. */
  function assinarMudancas() {
    return function cancelar() {};
  }

  /* ---------- extras da demonstração (fora de Api.METODOS) ---------- */

  var ORDEM_PAPEL = { chefia: 0, adjunto: 1, administrador: 2 };

  /* Contas para os botões "Entrar como …" da tela de login do demo.html. */
  function usuariosDemo() {
    carregarEstado();
    return estado.militares.filter(function (m) { return m.ativo && m.usuario_id && m.email; })
      .sort(function (a, b) {
        return (ORDEM_PAPEL[a.papel] - ORDEM_PAPEL[b.papel]) ||
          Regras.nomeMilitar(a).localeCompare(Regras.nomeMilitar(b), 'pt-BR');
      })
      .map(function (m) { return { email: m.email, nome: Regras.nomeMilitar(m), papel: m.papel }; });
  }

  /* Volta ao estado inicial (e sai da sessão, que pode não existir mais). */
  function reiniciar() {
    estado = DadosDemo.criarEstadoInicial(hoje());
    estado.evidencias_enviadas = {};
    arquivos = {};
    persistir();
    var tinha = !!sessao;
    limparSessao();
    if (tinha) { emitirSessao('saiu'); }
    return Promise.resolve();
  }

  /* Só para os testes automatizados: zera o atraso artificial. */
  function definirAtraso(ms) {
    atrasoMs = Math.max(0, Number(ms) || 0);
  }

  return {
    /* sessão */
    iniciar: iniciar, sessaoAtual: sessaoAtual, aoMudarSessao: aoMudarSessao, entrar: entrar,
    verificarMfa: verificarMfa, sair: sair, meuPerfil: meuPerfil, trocarSenha: trocarSenha,
    mfaFatores: mfaFatores, mfaIniciarCadastro: mfaIniciarCadastro,
    mfaConfirmarCadastro: mfaConfirmarCadastro, mfaRemover: mfaRemover,
    /* referências */
    listarSetores: listarSetores, salvarSetor: salvarSetor, excluirSetor: excluirSetor,
    listarMilitares: listarMilitares, salvarMilitar: salvarMilitar, excluirMilitar: excluirMilitar,
    adminUsuario: adminUsuario, transferirChefia: transferirChefia,
    listarFeriados: listarFeriados, salvarFeriado: salvarFeriado, excluirFeriado: excluirFeriado,
    obterConfiguracoes: obterConfiguracoes, salvarConfiguracao: salvarConfiguracao,
    /* atividades */
    listarAtividades: listarAtividades, salvarAtividade: salvarAtividade,
    excluirAtividade: excluirAtividade, gerarOcorrencias: gerarOcorrencias,
    /* ocorrências */
    listarOcorrencias: listarOcorrencias, obterOcorrencia: obterOcorrencia,
    criarOcorrencia: criarOcorrencia, atualizarOcorrencia: atualizarOcorrencia,
    excluirOcorrencia: excluirOcorrencia,
    /* evidências */
    listarEvidencias: listarEvidencias, enviarEvidencia: enviarEvidencia,
    baixarEvidencia: baixarEvidencia, excluirEvidencia: excluirEvidencia,
    /* comentários */
    listarComentarios: listarComentarios, comentar: comentar, excluirComentario: excluirComentario,
    /* avisos */
    listarAvisos: listarAvisos, salvarAviso: salvarAviso, excluirAviso: excluirAviso, darCiencia: darCiencia,
    /* notificações */
    listarNotificacoes: listarNotificacoes, contarNaoLidas: contarNaoLidas,
    marcarNotificacoesLidas: marcarNotificacoesLidas,
    /* gestão */
    listarAuditoria: listarAuditoria, exportarTudo: exportarTudo,
    /* tempo real */
    assinarMudancas: assinarMudancas,
    /* extras da demonstração */
    usuariosDemo: usuariosDemo,
    reiniciar: reiniciar,
    definirAtraso: definirAtraso
  };
})();
