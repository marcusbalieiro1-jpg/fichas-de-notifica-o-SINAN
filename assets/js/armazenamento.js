/* =========================================================================
   HABE SINAN — camada de armazenamento
   -------------------------------------------------------------------------
   O sistema funciona em dois modos, escolhidos na aba "Configurações":

   1. LOCAL (padrão)
      Tudo fica gravado no próprio navegador (localStorage). Não exige
      servidor nem internet, mas os dados NÃO são compartilhados entre
      computadores. Serve para teste, para um posto único e como plano de
      contingência quando a rede cai.

   2. COMPARTILHADO
      Os dados vão para uma planilha Google e os anexos para uma pasta do
      Google Drive, por meio de um Web App do Google Apps Script. Todos os
      computadores enxergam as mesmas solicitações. O código do servidor
      está em backend/apps-script/Codigo.gs.

   Toda a API devolve Promises.
   ========================================================================= */

var Armazenamento = (function () {
  'use strict';

  var CHAVES = {
    config: 'habe_sinan_config',
    solicitacoes: 'habe_sinan_solicitacoes',
    medicos: 'habe_sinan_medicos',
    sequencia: 'habe_sinan_sequencia'
  };

  var CONFIG_PADRAO = {
    modo: 'local',                 // 'local' | 'compartilhado'
    endpoint: '',                  // URL do Web App do Apps Script
    chave: '',                     // chave compartilhada exigida pelo Web App
    unidade: 'Hospital de Aeronáutica de Belém',
    setor: 'Núcleo de Epidemiologia',
    enderecoPublico: '',           // URL do sistema, usada no QR Code
    pinNucleo: '',                 // PIN de acesso à área do Núcleo
    tema: 'claro',
    tamanhoMaximoAnexoMb: 10
  };

  /* ---------- utilitários ---------- */

  function lerJson(chave, padrao) {
    try {
      var bruto = window.localStorage.getItem(chave);
      return bruto ? JSON.parse(bruto) : padrao;
    } catch (e) {
      console.warn('Falha ao ler ' + chave, e);
      return padrao;
    }
  }

  function gravarJson(chave, valor) {
    try {
      window.localStorage.setItem(chave, JSON.stringify(valor));
      return true;
    } catch (e) {
      console.error('Falha ao gravar ' + chave, e);
      throw new Error('Não foi possível gravar os dados no navegador. ' +
                      'O armazenamento local pode estar cheio — exporte um backup ' +
                      'e limpe os registros antigos.');
    }
  }

  function gerarId() {
    return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* ---------- configuração (sempre local) ---------- */

  function obterConfig() {
    var salva = lerJson(CHAVES.config, {});
    var config = {};
    for (var k in CONFIG_PADRAO) {
      if (Object.prototype.hasOwnProperty.call(CONFIG_PADRAO, k)) {
        config[k] = (salva[k] === undefined) ? CONFIG_PADRAO[k] : salva[k];
      }
    }
    return config;
  }

  function salvarConfig(parcial) {
    var config = obterConfig();
    for (var k in parcial) {
      if (Object.prototype.hasOwnProperty.call(parcial, k)) { config[k] = parcial[k]; }
    }
    gravarJson(CHAVES.config, config);
    return config;
  }

  function modoCompartilhado() {
    var c = obterConfig();
    return c.modo === 'compartilhado' && !!c.endpoint;
  }

  /* ---------- comunicação com o Web App ---------- */

  function chamarRemoto(acao, dados) {
    var config = obterConfig();
    var corpo = { acao: acao, chave: config.chave, dados: dados || {} };

    /* Content-Type text/plain evita a requisição de verificação prévia
       (preflight), que o Apps Script não responde. */
    return fetch(config.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(corpo),
      redirect: 'follow'
    }).then(function (resposta) {
      if (!resposta.ok) {
        throw new Error('O servidor respondeu com o código ' + resposta.status + '.');
      }
      return resposta.json();
    }).then(function (json) {
      if (!json || json.ok !== true) {
        throw new Error((json && json.erro) || 'Resposta inválida do servidor.');
      }
      return json.dados;
    }).catch(function (erro) {
      throw new Error('Falha na comunicação com o servidor compartilhado: ' +
                      erro.message + ' Verifique o endereço em Configurações ou ' +
                      'volte temporariamente ao modo local.');
    });
  }

  /* ---------- protocolo ---------- */

  function proximoProtocolo() {
    var ano = new Date().getFullYear();
    var sequencia = lerJson(CHAVES.sequencia, { ano: ano, numero: 0 });
    if (sequencia.ano !== ano) { sequencia = { ano: ano, numero: 0 }; }
    sequencia.numero += 1;
    gravarJson(CHAVES.sequencia, sequencia);
    var numero = String(sequencia.numero);
    while (numero.length < 4) { numero = '0' + numero; }
    return 'HABE-' + ano + '-' + numero;
  }

  /* ---------- solicitações ---------- */

  function listarSolicitacoes() {
    if (modoCompartilhado()) {
      return chamarRemoto('listarSolicitacoes');
    }
    return Promise.resolve(lerJson(CHAVES.solicitacoes, []));
  }

  function salvarSolicitacao(solicitacao) {
    solicitacao.id = solicitacao.id || gerarId();
    solicitacao.criadoEm = solicitacao.criadoEm || new Date().toISOString();
    solicitacao.status = solicitacao.status || 'aguardando';
    solicitacao.anexos = solicitacao.anexos || [];

    if (modoCompartilhado()) {
      return chamarRemoto('salvarSolicitacao', solicitacao);
    }
    solicitacao.protocolo = solicitacao.protocolo || proximoProtocolo();
    var lista = lerJson(CHAVES.solicitacoes, []);
    lista.unshift(solicitacao);
    gravarJson(CHAVES.solicitacoes, lista);
    return Promise.resolve(solicitacao);
  }

  function atualizarSolicitacao(id, alteracoes) {
    if (modoCompartilhado()) {
      return chamarRemoto('atualizarSolicitacao', { id: id, alteracoes: alteracoes });
    }
    var lista = lerJson(CHAVES.solicitacoes, []);
    var atualizada = null;
    for (var i = 0; i < lista.length; i++) {
      if (lista[i].id === id) {
        for (var k in alteracoes) {
          if (Object.prototype.hasOwnProperty.call(alteracoes, k)) {
            lista[i][k] = alteracoes[k];
          }
        }
        lista[i].atualizadoEm = new Date().toISOString();
        atualizada = lista[i];
        break;
      }
    }
    if (!atualizada) { return Promise.reject(new Error('Solicitação não encontrada.')); }
    gravarJson(CHAVES.solicitacoes, lista);
    return Promise.resolve(atualizada);
  }

  function removerSolicitacao(id) {
    if (modoCompartilhado()) {
      return chamarRemoto('removerSolicitacao', { id: id });
    }
    var lista = lerJson(CHAVES.solicitacoes, []);
    var restantes = lista.filter(function (s) { return s.id !== id; });
    gravarJson(CHAVES.solicitacoes, restantes);
    return Promise.resolve(true);
  }

  /* ---------- anexos (ficha preenchida e digitalizada) ---------- */

  /* arquivo: { nome, tipo, tamanho, conteudoBase64 } */
  function enviarAnexo(solicitacaoId, arquivo) {
    if (modoCompartilhado()) {
      return chamarRemoto('enviarAnexo', { id: solicitacaoId, arquivo: arquivo });
    }
    var lista = lerJson(CHAVES.solicitacoes, []);
    for (var i = 0; i < lista.length; i++) {
      if (lista[i].id === solicitacaoId) {
        lista[i].anexos = lista[i].anexos || [];
        lista[i].anexos.push({
          id: gerarId(),
          nome: arquivo.nome,
          tipo: arquivo.tipo,
          tamanho: arquivo.tamanho,
          conteudo: 'data:' + arquivo.tipo + ';base64,' + arquivo.conteudoBase64,
          enviadoEm: new Date().toISOString()
        });
        lista[i].status = 'recebida';
        lista[i].atualizadoEm = new Date().toISOString();
        gravarJson(CHAVES.solicitacoes, lista);
        return Promise.resolve(lista[i]);
      }
    }
    return Promise.reject(new Error('Solicitação não encontrada.'));
  }

  function removerAnexo(solicitacaoId, anexoId) {
    if (modoCompartilhado()) {
      return chamarRemoto('removerAnexo', { id: solicitacaoId, anexoId: anexoId });
    }
    var lista = lerJson(CHAVES.solicitacoes, []);
    for (var i = 0; i < lista.length; i++) {
      if (lista[i].id === solicitacaoId) {
        lista[i].anexos = (lista[i].anexos || []).filter(function (a) { return a.id !== anexoId; });
        if (lista[i].anexos.length === 0 && lista[i].status === 'recebida') {
          lista[i].status = 'aguardando';
        }
        gravarJson(CHAVES.solicitacoes, lista);
        return Promise.resolve(lista[i]);
      }
    }
    return Promise.reject(new Error('Solicitação não encontrada.'));
  }

  /* ---------- médicos ---------- */

  function listarMedicos() {
    if (modoCompartilhado()) {
      return chamarRemoto('listarMedicos');
    }
    return Promise.resolve(lerJson(CHAVES.medicos, []));
  }

  function salvarMedico(medico) {
    if (modoCompartilhado()) {
      return chamarRemoto('salvarMedico', medico);
    }
    var lista = lerJson(CHAVES.medicos, []);
    if (medico.id) {
      for (var i = 0; i < lista.length; i++) {
        if (lista[i].id === medico.id) { lista[i] = medico; break; }
      }
    } else {
      medico.id = gerarId();
      medico.criadoEm = new Date().toISOString();
      lista.push(medico);
    }
    lista.sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });
    gravarJson(CHAVES.medicos, lista);
    return Promise.resolve(medico);
  }

  function removerMedico(id) {
    if (modoCompartilhado()) {
      return chamarRemoto('removerMedico', { id: id });
    }
    var lista = lerJson(CHAVES.medicos, []);
    gravarJson(CHAVES.medicos, lista.filter(function (m) { return m.id !== id; }));
    return Promise.resolve(true);
  }

  /* ---------- backup ---------- */

  function exportarTudo() {
    return Promise.all([listarSolicitacoes(), listarMedicos()])
      .then(function (resultados) {
        return {
          sistema: 'HABE SINAN',
          exportadoEm: new Date().toISOString(),
          config: obterConfig(),
          solicitacoes: resultados[0],
          medicos: resultados[1]
        };
      });
  }

  /* Restaura um backup no armazenamento LOCAL. Substitui o conteúdo atual. */
  function importarLocal(pacote) {
    if (!pacote || pacote.sistema !== 'HABE SINAN') {
      return Promise.reject(new Error('Arquivo de backup não reconhecido.'));
    }
    gravarJson(CHAVES.solicitacoes, pacote.solicitacoes || []);
    gravarJson(CHAVES.medicos, pacote.medicos || []);
    return Promise.resolve(true);
  }

  function limparLocal() {
    window.localStorage.removeItem(CHAVES.solicitacoes);
    window.localStorage.removeItem(CHAVES.medicos);
    window.localStorage.removeItem(CHAVES.sequencia);
    return Promise.resolve(true);
  }

  function testarConexao() {
    return chamarRemoto('ping');
  }

  return {
    obterConfig: obterConfig,
    salvarConfig: salvarConfig,
    modoCompartilhado: modoCompartilhado,
    testarConexao: testarConexao,

    listarSolicitacoes: listarSolicitacoes,
    salvarSolicitacao: salvarSolicitacao,
    atualizarSolicitacao: atualizarSolicitacao,
    removerSolicitacao: removerSolicitacao,

    enviarAnexo: enviarAnexo,
    removerAnexo: removerAnexo,

    listarMedicos: listarMedicos,
    salvarMedico: salvarMedico,
    removerMedico: removerMedico,

    exportarTudo: exportarTudo,
    importarLocal: importarLocal,
    limparLocal: limparLocal,

    gerarId: gerarId
  };
})();
