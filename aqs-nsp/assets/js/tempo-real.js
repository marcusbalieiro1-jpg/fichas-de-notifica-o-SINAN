/* =========================================================================
   HABE – AQS e NSP — tempo real e ressincronização
   Mantém as telas em dia sem o militar precisar recarregar a página:
   * Api.assinarMudancas avisa {tabela, evento} a cada mudança no banco que
     o militar pode ver (o Realtime do Supabase respeita a RLS). As mudanças
     que chegam juntas (uma gravação mexe em várias tabelas) são agrupadas
     numa janela de 300 ms e viram UMA chamada a App.recarregar(tabelas).
   * Mudança em notificações atualiza o sino e mostra uma torrada com o
     título da notificação nova.
   * O canal do Realtime pode cair sem avisar (celular dormindo, troca de
     rede): ao voltar para a aba e a cada 5 minutos, ressincroniza tudo.
   A demonstração não tem outros usuários: assinarMudancas nunca dispara,
   mas a ressincronização periódica funciona igual.
   Ver docs/ARQUITETURA.md, seção 7.
   ========================================================================= */

var TempoReal = (function () {
  'use strict';

  var JANELA_MS = 300;
  var INTERVALO_MS = 5 * 60 * 1000;
  /* Voltar para a aba em menos que isto (trocar de aba e voltar) não
     ressincroniza de novo: o Realtime ainda está de pé. */
  var INTERVALO_MINIMO_MS = 20000;
  var LIMITE_NOTIFICACOES = 15;

  var ativo = false;
  var cancelarAssinatura = null;
  var pendentes = {};
  var temporizador = null;
  var intervalo = null;
  var ultimaRessincronizacao = 0;
  /* ids das notificações já vistas nesta sessão (null = ainda não semeado):
     só as que não estão aqui viram torrada. */
  var conhecidas = null;
  var consultaNotificacoes = 0;

  /* ---------- notificações novas ---------- */

  function verificarNotificacoes(semToast) {
    if (!ativo) { return; }
    var seq = ++consultaNotificacoes;
    Api.listarNotificacoes({ limite: LIMITE_NOTIFICACOES }).then(function (lista) {
      if (!ativo || seq !== consultaNotificacoes) { return; }
      lista = lista || [];
      var primeiraVez = conhecidas === null;
      var vistas = conhecidas || {};
      var novas = lista.filter(function (n) { return n && !n.lida && !vistas[n.id]; });
      lista.forEach(function (n) { if (n && n.id) { vistas[n.id] = true; } });
      conhecidas = vistas;
      if (primeiraVez || semToast || !novas.length) { return; }
      /* A lista vem da mais recente para a mais antiga. */
      var texto = novas[0].titulo || 'Nova notificação';
      if (novas.length > 1) {
        texto += ' (e mais ' + (novas.length - 1) + (novas.length > 2 ? ' novas)' : ' nova)');
      }
      U.torrada('🔔 ' + texto, '', 6500);
    }).catch(function (erro) {
      console.warn('Não foi possível consultar as notificações agora.', erro);
    });
  }

  /* ---------- mudanças agrupadas ---------- */

  function receber(mudanca) {
    if (!ativo || !mudanca || !mudanca.tabela) { return; }
    pendentes[String(mudanca.tabela)] = true;
    /* Janela fixa (não reinicia a cada evento): uma rajada contínua de
       mudanças não adia a atualização para sempre. */
    if (!temporizador) { temporizador = window.setTimeout(descarregar, JANELA_MS); }
  }

  function descarregar() {
    temporizador = null;
    if (!ativo) { pendentes = {}; return; }
    var tabelas = Object.keys(pendentes);
    pendentes = {};
    if (!tabelas.length) { return; }

    var temNotificacoes = tabelas.indexOf('notificacoes') >= 0;
    var outras = tabelas.filter(function (t) { return t !== 'notificacoes'; });
    if (outras.length) { App.recarregar(outras); }
    if (temNotificacoes) {
      App.atualizarContadores();
      verificarNotificacoes(false);
    }
  }

  /* ---------- ressincronização ---------- */

  function ressincronizar() {
    if (!ativo) { return; }
    ultimaRessincronizacao = Date.now();
    App.recarregar();
    verificarNotificacoes(false);
  }

  function aoMudarVisibilidade() {
    if (!ativo || document.visibilityState !== 'visible') { return; }
    if (Date.now() - ultimaRessincronizacao < INTERVALO_MINIMO_MS) { return; }
    /* Depois dos demais tratadores do mesmo evento: se a Sessao encerrar
       por inatividade agora, "ativo" já estará falso. */
    window.setTimeout(ressincronizar, 0);
  }

  function aoIntervalo() {
    /* Aba escondida não gasta rede: ressincroniza quando voltar. */
    if (document.visibilityState === 'hidden') { return; }
    ressincronizar();
  }

  function aoVoltarConexao() {
    window.setTimeout(ressincronizar, 1000);
  }

  /* ---------- ciclo ---------- */

  function iniciar() {
    parar();
    ativo = true;
    ultimaRessincronizacao = Date.now();
    try {
      cancelarAssinatura = Api.assinarMudancas(receber);
    } catch (erro) {
      /* Sem tempo real a ferramenta continua funcionando: só depende da
         ressincronização periódica. */
      console.error('Tempo real indisponível:', erro);
      cancelarAssinatura = null;
    }
    document.addEventListener('visibilitychange', aoMudarVisibilidade);
    window.addEventListener('online', aoVoltarConexao);
    intervalo = window.setInterval(aoIntervalo, INTERVALO_MS);
    verificarNotificacoes(true);
  }

  function parar() {
    ativo = false;
    if (typeof cancelarAssinatura === 'function') {
      try { cancelarAssinatura(); } catch (erro) { console.error(erro); }
    }
    cancelarAssinatura = null;
    window.clearTimeout(temporizador);
    temporizador = null;
    window.clearInterval(intervalo);
    intervalo = null;
    pendentes = {};
    conhecidas = null;
    consultaNotificacoes += 1;
    document.removeEventListener('visibilitychange', aoMudarVisibilidade);
    window.removeEventListener('online', aoVoltarConexao);
  }

  return {
    iniciar: iniciar,
    parar: parar,
    /* Para o App e os testes: força uma ressincronização imediata. */
    ressincronizar: ressincronizar
  };
})();
