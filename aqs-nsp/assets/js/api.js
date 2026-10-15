/* =========================================================================
   HABE – AQS e NSP — fachada da API
   As páginas falam só com "Api". Por trás dela fica o adaptador real
   (ApiSupabase, em index.html) ou o de demonstração (ApiDemo, em demo.html).
   A lista METODOS é o contrato: se o adaptador carregado não implementar
   algum método, o sistema para logo na abertura, em vez de falhar no meio
   do uso. Ver docs/ARQUITETURA.md, seção 6.
   ========================================================================= */

var Api = (function () {
  'use strict';

  var METODOS = [
    /* sessão */
    'iniciar', 'sessaoAtual', 'aoMudarSessao', 'entrar', 'verificarMfa', 'sair',
    'meuPerfil', 'trocarSenha',
    'mfaFatores', 'mfaIniciarCadastro', 'mfaConfirmarCadastro', 'mfaRemover',
    /* referências */
    'listarSetores', 'salvarSetor', 'excluirSetor',
    'listarMilitares', 'salvarMilitar', 'adminUsuario',
    'listarFeriados', 'salvarFeriado', 'excluirFeriado',
    /* atividades */
    'listarAtividades', 'salvarAtividade', 'excluirAtividade', 'gerarOcorrencias',
    /* ocorrências */
    'listarOcorrencias', 'obterOcorrencia', 'criarOcorrencia', 'atualizarOcorrencia',
    'excluirOcorrencia',
    /* evidências */
    'listarEvidencias', 'enviarEvidencia', 'baixarEvidencia', 'excluirEvidencia',
    /* comentários */
    'listarComentarios', 'comentar', 'excluirComentario',
    /* avisos */
    'listarAvisos', 'salvarAviso', 'excluirAviso', 'darCiencia',
    /* notificações */
    'listarNotificacoes', 'contarNaoLidas', 'marcarNotificacoesLidas',
    /* chefia */
    'listarAuditoria', 'exportarTudo',
    /* tempo real */
    'assinarMudancas'
  ];

  var adaptador = window.ApiDemo || window.ApiSupabase;
  var modo = window.ApiDemo ? 'demo' : 'supabase';

  if (!adaptador) {
    throw new Error('Nenhum adaptador de API foi carregado (ApiSupabase ou ApiDemo).');
  }

  var faltando = METODOS.filter(function (nome) { return typeof adaptador[nome] !== 'function'; });
  if (faltando.length) {
    throw new Error('Adaptador de API incompleto (' + modo + '): faltam ' + faltando.join(', '));
  }

  var api = { METODOS: METODOS.slice(), modo: modo };

  /* Repassa cada método, garantindo que o retorno seja sempre uma Promise
     e que exceções síncronas virem rejeição (as páginas só usam .catch). */
  METODOS.forEach(function (nome) {
    api[nome] = function () {
      var args = arguments;
      if (nome === 'aoMudarSessao' || nome === 'assinarMudancas') {
        return adaptador[nome].apply(adaptador, args); /* devolvem a função de cancelar */
      }
      try {
        return Promise.resolve(adaptador[nome].apply(adaptador, args));
      } catch (erro) {
        return Promise.reject(erro);
      }
    };
  });

  /* Toda gravação que mexe nas tabelas de referência derruba o cache. */
  ['salvarSetor', 'excluirSetor', 'salvarMilitar', 'adminUsuario',
   'salvarFeriado', 'excluirFeriado'].forEach(function (nome) {
    var original = api[nome];
    api[nome] = function () {
      return original.apply(null, arguments).then(function (resultado) {
        invalidarReferencias();
        return resultado;
      });
    };
  });

  /* ---------- cache das tabelas de referência ---------- */

  var cacheReferencias = null;

  function indexar(lista, chave) {
    var mapa = {};
    (lista || []).forEach(function (item) { mapa[item[chave]] = item; });
    return mapa;
  }

  function referencias() {
    if (!cacheReferencias) {
      cacheReferencias = Promise.all([
        api.listarSetores(), api.listarMilitares(), api.listarFeriados()
      ]).then(function (r) {
        var feriados = {};
        (r[2] || []).forEach(function (f) { feriados[f.data] = true; });
        return {
          setores: r[0] || [],
          militares: r[1] || [],
          mapaSetores: indexar(r[0], 'id'),
          mapaMilitares: indexar(r[1], 'id'),
          feriados: feriados,
          listaFeriados: r[2] || []
        };
      }).catch(function (erro) {
        cacheReferencias = null;
        throw erro;
      });
    }
    return cacheReferencias;
  }

  function invalidarReferencias() {
    cacheReferencias = null;
  }

  api.referencias = referencias;
  api.invalidarReferencias = invalidarReferencias;

  return api;
})();
