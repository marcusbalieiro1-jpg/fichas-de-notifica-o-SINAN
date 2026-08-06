/**
 * =========================================================================
 * HABE SINAN — servidor do modo compartilhado
 * -------------------------------------------------------------------------
 * Google Apps Script que grava as solicitações numa planilha Google e os
 * anexos (fichas preenchidas e digitalizadas) numa pasta do Google Drive.
 *
 * Publicação: ver backend/apps-script/README.md
 * =========================================================================
 */

/* ------------------------------------------------------------------ */
/* CONFIGURAÇÃO — ajuste estes três valores antes de publicar          */
/* ------------------------------------------------------------------ */

/** Chave compartilhada. Troque por um valor longo e informe o MESMO valor
 *  no campo "Chave compartilhada" das Configurações do HABE SINAN. */
var CHAVE = 'troque-esta-chave-por-um-valor-longo-e-aleatorio';

/** ID da planilha (o trecho entre /d/ e /edit na URL). Deixe vazio para
 *  usar a planilha à qual este script está vinculado. */
var ID_PLANILHA = '';

/** ID da pasta do Drive onde ficarão as fichas digitalizadas.
 *  Deixe vazio para o script criar a pasta "HABE SINAN - Anexos". */
var ID_PASTA_ANEXOS = '';

/* ------------------------------------------------------------------ */

var ABA_SOLICITACOES = 'Solicitacoes';
var ABA_MEDICOS = 'Medicos';
var ABA_SEQUENCIA = 'Sequencia';

var COLUNAS_SOLICITACAO = [
  'id', 'protocolo', 'criadoEm', 'atualizadoEm', 'status',
  'fichaId', 'fichaNome', 'fichaGrupo', 'classificacao', 'classificacaoEfetiva',
  'gatilhoAplicado', 'dataAtendimento', 'semanaEpidemiologica',
  'pacienteNome', 'pacienteProntuario', 'destino',
  'medicoId', 'medicoNome', 'medicoCrm', 'medicoSetor',
  'observacao', 'anexos'
];

var COLUNAS_MEDICO = [
  'id', 'nome', 'crm', 'uf', 'especialidade', 'setor',
  'telefone', 'email', 'ativo', 'criadoEm'
];

/* ================================================================== */
/* Ponto de entrada                                                    */
/* ================================================================== */

function doPost(e) {
  try {
    var pedido = JSON.parse(e.postData.contents);

    if (pedido.chave !== CHAVE) {
      return responder(false, null, 'Chave compartilhada incorreta.');
    }

    var dados = pedido.dados || {};

    switch (pedido.acao) {
      case 'ping':                  return responder(true, { versao: 'HABE SINAN 1.0', hora: new Date().toISOString() });
      case 'listarSolicitacoes':    return responder(true, listarSolicitacoes());
      case 'salvarSolicitacao':     return responder(true, salvarSolicitacao(dados));
      case 'atualizarSolicitacao':  return responder(true, atualizarSolicitacao(dados.id, dados.alteracoes));
      case 'removerSolicitacao':    return responder(true, removerSolicitacao(dados.id));
      case 'enviarAnexo':           return responder(true, enviarAnexo(dados.id, dados.arquivo));
      case 'removerAnexo':          return responder(true, removerAnexo(dados.id, dados.anexoId));
      case 'listarMedicos':         return responder(true, listarMedicos());
      case 'salvarMedico':          return responder(true, salvarMedico(dados));
      case 'removerMedico':         return responder(true, removerMedico(dados.id));
      default:                      return responder(false, null, 'Ação desconhecida: ' + pedido.acao);
    }
  } catch (erro) {
    return responder(false, null, erro.message);
  }
}

/** Verificação rápida pelo navegador. */
function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({
      ok: true,
      servico: 'HABE SINAN',
      mensagem: 'Servidor ativo. As operações usam POST.'
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

function responder(ok, dados, erro) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: ok, dados: dados || null, erro: erro || null }))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ================================================================== */
/* Planilha                                                            */
/* ================================================================== */

function planilha() {
  return ID_PLANILHA ? SpreadsheetApp.openById(ID_PLANILHA) : SpreadsheetApp.getActiveSpreadsheet();
}

function aba(nome, colunas) {
  var arquivo = planilha();
  var folha = arquivo.getSheetByName(nome);
  if (!folha) {
    folha = arquivo.insertSheet(nome);
    folha.appendRow(colunas);
    folha.setFrozenRows(1);
    folha.getRange(1, 1, 1, colunas.length).setFontWeight('bold');
  }
  return folha;
}

function lerTudo(folha, colunas) {
  var valores = folha.getDataRange().getValues();
  var registros = [];
  for (var i = 1; i < valores.length; i++) {
    if (!valores[i][0]) { continue; }
    var registro = {};
    for (var c = 0; c < colunas.length; c++) {
      registro[colunas[c]] = valores[i][c];
    }
    registros.push(registro);
  }
  return registros;
}

function localizarLinha(folha, id) {
  var ids = folha.getRange(1, 1, Math.max(folha.getLastRow(), 1), 1).getValues();
  for (var i = 1; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) { return i + 1; }
  }
  return -1;
}

function paraLinha(registro, colunas) {
  return colunas.map(function (coluna) {
    var valor = registro[coluna];
    if (valor === undefined || valor === null) { return ''; }
    if (typeof valor === 'object') { return JSON.stringify(valor); }
    return valor;
  });
}

/* ================================================================== */
/* Solicitações                                                        */
/* ================================================================== */

function listarSolicitacoes() {
  var registros = lerTudo(aba(ABA_SOLICITACOES, COLUNAS_SOLICITACAO), COLUNAS_SOLICITACAO);
  registros.forEach(function (r) {
    try { r.anexos = r.anexos ? JSON.parse(r.anexos) : []; }
    catch (e) { r.anexos = []; }
    r.gatilhoAplicado = (r.gatilhoAplicado === true || r.gatilhoAplicado === 'true');
    r.dataAtendimento = normalizarData(r.dataAtendimento);
    r.criadoEm = normalizarIso(r.criadoEm);
  });
  return registros.sort(function (a, b) {
    return String(b.criadoEm).localeCompare(String(a.criadoEm));
  });
}

/** Datas voltam da planilha como objeto Date — o cliente espera AAAA-MM-DD. */
function normalizarData(valor) {
  if (valor instanceof Date) {
    return Utilities.formatDate(valor, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(valor || '');
}

function normalizarIso(valor) {
  if (valor instanceof Date) { return valor.toISOString(); }
  return String(valor || '');
}

function proximoProtocolo() {
  var trava = LockService.getScriptLock();
  trava.waitLock(20000);
  try {
    var folha = aba(ABA_SEQUENCIA, ['ano', 'numero']);
    var ano = new Date().getFullYear();
    var valores = folha.getDataRange().getValues();
    var linha = -1;
    var numero = 0;

    for (var i = 1; i < valores.length; i++) {
      if (Number(valores[i][0]) === ano) { linha = i + 1; numero = Number(valores[i][1]); break; }
    }
    numero += 1;

    if (linha === -1) { folha.appendRow([ano, numero]); }
    else { folha.getRange(linha, 2).setValue(numero); }

    return 'HABE-' + ano + '-' + ('0000' + numero).slice(-4);
  } finally {
    trava.releaseLock();
  }
}

function salvarSolicitacao(solicitacao) {
  var folha = aba(ABA_SOLICITACOES, COLUNAS_SOLICITACAO);
  solicitacao.id = solicitacao.id || Utilities.getUuid();
  solicitacao.protocolo = solicitacao.protocolo || proximoProtocolo();
  solicitacao.criadoEm = solicitacao.criadoEm || new Date().toISOString();
  solicitacao.atualizadoEm = solicitacao.criadoEm;
  solicitacao.status = solicitacao.status || 'aguardando';
  solicitacao.anexos = solicitacao.anexos || [];

  folha.appendRow(paraLinha(solicitacao, COLUNAS_SOLICITACAO));
  return solicitacao;
}

function atualizarSolicitacao(id, alteracoes) {
  var folha = aba(ABA_SOLICITACOES, COLUNAS_SOLICITACAO);
  var linha = localizarLinha(folha, id);
  if (linha < 0) { throw new Error('Solicitação não encontrada.'); }

  var atual = folha.getRange(linha, 1, 1, COLUNAS_SOLICITACAO.length).getValues()[0];
  var registro = {};
  COLUNAS_SOLICITACAO.forEach(function (coluna, indice) { registro[coluna] = atual[indice]; });

  try { registro.anexos = registro.anexos ? JSON.parse(registro.anexos) : []; }
  catch (e) { registro.anexos = []; }

  Object.keys(alteracoes || {}).forEach(function (chave) { registro[chave] = alteracoes[chave]; });
  registro.atualizadoEm = new Date().toISOString();

  folha.getRange(linha, 1, 1, COLUNAS_SOLICITACAO.length)
       .setValues([paraLinha(registro, COLUNAS_SOLICITACAO)]);
  return registro;
}

function removerSolicitacao(id) {
  var folha = aba(ABA_SOLICITACOES, COLUNAS_SOLICITACAO);
  var linha = localizarLinha(folha, id);
  if (linha < 0) { throw new Error('Solicitação não encontrada.'); }

  /* Remove também os arquivos do Drive vinculados à solicitação. */
  var bruto = folha.getRange(linha, COLUNAS_SOLICITACAO.indexOf('anexos') + 1).getValue();
  try {
    (JSON.parse(bruto || '[]')).forEach(function (anexo) {
      if (anexo.driveId) {
        try { DriveApp.getFileById(anexo.driveId).setTrashed(true); } catch (e) {}
      }
    });
  } catch (e) {}

  folha.deleteRow(linha);
  return true;
}

/* ================================================================== */
/* Anexos no Drive                                                     */
/* ================================================================== */

function pastaAnexos() {
  if (ID_PASTA_ANEXOS) { return DriveApp.getFolderById(ID_PASTA_ANEXOS); }
  var existentes = DriveApp.getFoldersByName('HABE SINAN - Anexos');
  return existentes.hasNext() ? existentes.next() : DriveApp.createFolder('HABE SINAN - Anexos');
}

function enviarAnexo(idSolicitacao, arquivo) {
  var folha = aba(ABA_SOLICITACOES, COLUNAS_SOLICITACAO);
  var linha = localizarLinha(folha, idSolicitacao);
  if (linha < 0) { throw new Error('Solicitação não encontrada.'); }

  var protocolo = folha.getRange(linha, COLUNAS_SOLICITACAO.indexOf('protocolo') + 1).getValue();
  var blob = Utilities.newBlob(
    Utilities.base64Decode(arquivo.conteudoBase64),
    arquivo.tipo || 'application/octet-stream',
    protocolo + ' - ' + arquivo.nome
  );

  var salvo = pastaAnexos().createFile(blob);

  var colunaAnexos = COLUNAS_SOLICITACAO.indexOf('anexos') + 1;
  var lista;
  try { lista = JSON.parse(folha.getRange(linha, colunaAnexos).getValue() || '[]'); }
  catch (e) { lista = []; }

  lista.push({
    id: Utilities.getUuid(),
    nome: arquivo.nome,
    tipo: arquivo.tipo,
    tamanho: arquivo.tamanho,
    driveId: salvo.getId(),
    url: 'https://drive.google.com/file/d/' + salvo.getId() + '/view',
    enviadoEm: new Date().toISOString()
  });

  folha.getRange(linha, colunaAnexos).setValue(JSON.stringify(lista));
  folha.getRange(linha, COLUNAS_SOLICITACAO.indexOf('status') + 1).setValue('recebida');
  folha.getRange(linha, COLUNAS_SOLICITACAO.indexOf('atualizadoEm') + 1)
       .setValue(new Date().toISOString());

  return { id: idSolicitacao, anexos: lista };
}

function removerAnexo(idSolicitacao, idAnexo) {
  var folha = aba(ABA_SOLICITACOES, COLUNAS_SOLICITACAO);
  var linha = localizarLinha(folha, idSolicitacao);
  if (linha < 0) { throw new Error('Solicitação não encontrada.'); }

  var colunaAnexos = COLUNAS_SOLICITACAO.indexOf('anexos') + 1;
  var lista;
  try { lista = JSON.parse(folha.getRange(linha, colunaAnexos).getValue() || '[]'); }
  catch (e) { lista = []; }

  var restantes = lista.filter(function (anexo) {
    if (anexo.id === idAnexo) {
      if (anexo.driveId) {
        try { DriveApp.getFileById(anexo.driveId).setTrashed(true); } catch (e) {}
      }
      return false;
    }
    return true;
  });

  folha.getRange(linha, colunaAnexos).setValue(JSON.stringify(restantes));
  if (restantes.length === 0) {
    folha.getRange(linha, COLUNAS_SOLICITACAO.indexOf('status') + 1).setValue('aguardando');
  }
  return { id: idSolicitacao, anexos: restantes };
}

/* ================================================================== */
/* Médicos                                                             */
/* ================================================================== */

function listarMedicos() {
  var registros = lerTudo(aba(ABA_MEDICOS, COLUNAS_MEDICO), COLUNAS_MEDICO);
  registros.forEach(function (r) {
    r.ativo = !(r.ativo === false || r.ativo === 'false' || r.ativo === 'FALSE');
    r.criadoEm = normalizarIso(r.criadoEm);
  });
  return registros.sort(function (a, b) { return String(a.nome).localeCompare(String(b.nome)); });
}

function salvarMedico(medico) {
  var folha = aba(ABA_MEDICOS, COLUNAS_MEDICO);

  if (medico.id) {
    var linha = localizarLinha(folha, medico.id);
    if (linha > 0) {
      folha.getRange(linha, 1, 1, COLUNAS_MEDICO.length)
           .setValues([paraLinha(medico, COLUNAS_MEDICO)]);
      return medico;
    }
  }

  medico.id = medico.id || Utilities.getUuid();
  medico.criadoEm = medico.criadoEm || new Date().toISOString();
  if (medico.ativo === undefined) { medico.ativo = true; }
  folha.appendRow(paraLinha(medico, COLUNAS_MEDICO));
  return medico;
}

function removerMedico(id) {
  var folha = aba(ABA_MEDICOS, COLUNAS_MEDICO);
  var linha = localizarLinha(folha, id);
  if (linha < 0) { throw new Error('Cadastro não encontrado.'); }
  folha.deleteRow(linha);
  return true;
}

/* ================================================================== */
/* Utilitário: cria as abas na primeira execução (rode manualmente)     */
/* ================================================================== */

function prepararPlanilha() {
  aba(ABA_SOLICITACOES, COLUNAS_SOLICITACAO);
  aba(ABA_MEDICOS, COLUNAS_MEDICO);
  aba(ABA_SEQUENCIA, ['ano', 'numero']);
  pastaAnexos();
  Logger.log('Planilha e pasta de anexos preparadas.');
}
