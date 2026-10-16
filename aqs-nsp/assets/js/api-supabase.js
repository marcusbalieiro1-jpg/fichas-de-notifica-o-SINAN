/* =========================================================================
   HABE – AQS e NSP — adaptador de API do SISTEMA REAL (Supabase)
   Implementa todos os métodos de Api.METODOS (docs/ARQUITETURA.md §6)
   sobre o supabase-js 2.118.0 incorporado em assets/vendor/supabase.js
   (global window.supabase). As páginas nunca usam este arquivo direto:
   falam com a fachada Api (api.js).

   Quem protege os dados é o banco (RLS, gatilhos e RPCs de supabase/*.sql)
   e a Edge Function admin-usuarios; aqui só se traduz o contrato da
   ferramenta para as chamadas do Supabase e os erros do Supabase para
   mensagens em português prontas para a tela. Algumas conferências locais
   (ex.: quem pode mexer na conta institucional) existem só para dar uma
   mensagem clara — o banco confere de novo.

   Sessão: o token fica no localStorage quando o militar marca "lembrar
   neste dispositivo" (preferência 'aqs_lembrar' = '1'); senão, no
   sessionStorage (some ao fechar a aba). Todo acesso ao armazenamento do
   navegador é protegido: em modo privado ou com o armazenamento bloqueado,
   a sessão segue só na memória da página.

   Nada é feito ao carregar o arquivo: o cliente do Supabase só é criado em
   iniciar() (ou na primeira chamada), depois de conferida a configuração.
   ========================================================================= */

var ApiSupabase = (function () {
  'use strict';

  var CHAVE_SESSAO = 'aqs-nsp-sessao';
  var CHAVE_LEMBRAR = 'aqs_lembrar';
  var BUCKET = 'evidencias';
  var FUNCAO_ADMIN = 'admin-usuarios';
  var CANAL = 'aqs-mudancas';
  var NOME_FATOR = 'HABE AQS-NSP';

  /* O PostgREST devolve no máximo "Max rows" linhas por requisição (1000
     no Supabase). As listagens que crescem buscam em páginas até acabar. */
  var TAMANHO_PAGINA = 1000;
  /* Lotes da remoção de arquivos e dos filtros "in" (URL curta). */
  var LOTE = 100;
  var ESPERA_MAXIMA_MS = 60000;

  /* Tabelas assinadas no tempo real (as mesmas da publicação em
     supabase/03-tempo-real-agenda.sql). */
  var TABELAS_TEMPO_REAL = ['ocorrencias', 'comentarios', 'evidencias', 'atividades', 'atividade_responsaveis',
    'avisos', 'avisos_ciencia', 'militares', 'setores', 'notificacoes'];

  /* Cópia completa (exportarTudo): tabela e ordem estável para paginar. */
  var TABELAS_EXPORTADAS = [
    ['setores', ['id']], ['militares', ['id']], ['feriados', ['data']], ['atividades', ['id']],
    ['atividade_responsaveis', ['atividade_id', 'militar_id']], ['ocorrencias', ['id']], ['evidencias', ['id']],
    ['comentarios', ['id']], ['avisos', ['id']], ['avisos_destinatarios', ['aviso_id', 'militar_id']],
    ['avisos_ciencia', ['aviso_id', 'militar_id']], ['notificacoes', ['id']], ['configuracoes', ['chave']],
    ['auditoria', ['id']]
  ];

  var STATUS_VALIDOS = ['pendente', 'em_andamento', 'concluida', 'nao_se_aplica'];
  var CAMPOS_OCORRENCIA = ['status', 'observacao', 'justificativa', 'titulo_execucao', 'prazo'];
  var CAMPOS_ATIVIDADE = ['id', 'ordem', 'titulo', 'descricao', 'setor_id', 'tipo', 'periodicidade', 'dia_semana',
    'dia_mes', 'mes_inicio', 'prazo', 'antecipar_dia_util', 'prioridade', 'exige_evidencia', 'ativa',
    'data_inicio', 'responsaveis'];

  var MSG = {
    semConexao: 'Sem conexão com o servidor. Verifique a internet.',
    servidor: 'O servidor do Supabase não respondeu como esperado. Tente de novo em instantes.',
    demorou: 'O servidor demorou demais para responder. Tente de novo.',
    credenciais: 'E-mail ou senha incorretos.',
    banido: 'Acesso desativado. Procure a chefia.',
    tentativas: 'Muitas tentativas. Aguarde alguns minutos.',
    sessaoExpirada: 'Sua sessão expirou. Entre novamente.',
    semCadastro: 'Seu usuário não está vinculado a um cadastro ativo. Procure a chefia do NSP ou a AQS.',
    semPermissao: 'Você não tem permissão para esta ação.',
    duplicado: 'Já existe um registro com esses dados.',
    naoEncontrado: 'Registro não encontrado. Ele pode ter sido excluído — atualize a página.',
    semEfeito: 'Nada foi alterado: o registro não existe mais ou você não tem permissão para mexer nele. ' +
      'Atualize a página.',
    soAdministrador: 'Apenas a conta de administrador (conta institucional da AQS) pode criar, alterar ou ' +
      'excluir contas de administrador.',
    exigeSegundoFator: 'Por segurança, confirme o segundo fator: saia, entre de novo informando o código do ' +
      'aplicativo autenticador e repita a ação.',
    codigoInvalido: 'Código inválido ou expirado. Confira se o relógio do celular está certo e digite o ' +
      'código que aparece agora no aplicativo.',
    codigoFormato: 'Código inválido. Digite os 6 números mostrados no aplicativo autenticador.',
    bancoDesatualizado: 'O banco de dados não está com a estrutura esperada por esta versão da ferramenta. ' +
      'O responsável técnico deve rodar de novo os scripts da pasta supabase/ (veja docs/CONTINUIDADE.md).',
    funcaoAusente: 'O serviço de administração de usuários (Edge Function admin-usuarios) não está implantado ' +
      'no Supabase. Veja docs/CONTINUIDADE.md.',
    funcaoInacessivel: 'Não foi possível falar com o serviço de administração de usuários. Verifique a ' +
      'internet; se persistir, o responsável técnico deve conferir a implantação da Edge Function ' +
      'admin-usuarios e o segredo ORIGEM_PERMITIDA (docs/CONTINUIDADE.md).',
    configuracao: 'Configuração pendente: preencha SUPABASE_URL e SUPABASE_ANON_KEY em assets/js/config.js ' +
      '(Painel do Supabase → Project Settings → API).',
    biblioteca: 'A biblioteca do Supabase (assets/vendor/supabase.js) não foi carregada. Recarregue a página.'
  };

  /* Restrições únicas conhecidas → mensagem específica. */
  var MSG_UNICAS = {
    setores_sigla_unica: 'Já existe um setor com esta sigla.',
    militares_email_unico: 'Já existe um militar cadastrado com este e-mail.',
    militares_usuario_unico: 'Este usuário de acesso já está vinculado a outro militar.',
    feriados_pkey: 'Já existe um feriado cadastrado nesta data.',
    ocorrencias_atividade_referencia_unica: 'Já existe uma ocorrência desta atividade para este período.',
    evidencias_storage_path_unico: 'Este arquivo já foi registrado. Envie de novo.',
    avisos_ciencia_pkey: 'A ciência deste aviso já foi registrada.'
  };

  /* Checks conhecidos → o "detalhe" de 'Dados inválidos: …'. */
  var DETALHES_CHECK = {
    setores_sigla_tamanho: 'a sigla deve ter de 1 a 20 caracteres.',
    setores_nome_tamanho: 'o nome do setor deve ter de 1 a 200 caracteres.',
    setores_cor_hexadecimal: 'a cor deve estar no formato #RRGGBB.',
    militares_papel_valido: 'papel inválido (use adjunto, chefia ou administrador).',
    militares_posto_tamanho: 'o posto pode ter no máximo 30 caracteres.',
    militares_nome_guerra_tamanho: 'o nome de guerra deve ter de 1 a 80 caracteres.',
    militares_nome_completo_tamanho: 'o nome completo pode ter no máximo 200 caracteres.',
    militares_email_valido: 'e-mail inválido.',
    atividades_titulo_tamanho: 'o título deve ter entre 3 e 200 caracteres.',
    atividades_descricao_tamanho: 'a descrição pode ter no máximo 10.000 caracteres.',
    ocorrencias_status_valido: 'situação inválida.',
    ocorrencias_nao_se_aplica_exige_justificativa: 'informe a justificativa para marcar como "não se aplica".',
    ocorrencias_titulo_execucao_tamanho: 'o título da execução pode ter no máximo 200 caracteres.',
    ocorrencias_observacao_tamanho: 'a observação pode ter no máximo 10.000 caracteres.',
    ocorrencias_justificativa_tamanho: 'a justificativa pode ter no máximo 4.000 caracteres.',
    evidencias_nome_tamanho: 'o nome do arquivo deve ter de 1 a 255 caracteres.',
    evidencias_descricao_tamanho: 'a descrição pode ter no máximo 2.000 caracteres.',
    comentarios_texto_tamanho: 'o comentário deve ter de 1 a 4.000 caracteres.',
    avisos_titulo_tamanho: 'o título do aviso deve ter de 1 a 200 caracteres.',
    avisos_mensagem_tamanho: 'a mensagem pode ter no máximo 10.000 caracteres.',
    avisos_nivel_valido: 'nível do aviso inválido.',
    feriados_descricao_tamanho: 'a descrição do feriado deve ter de 1 a 120 caracteres.',
    configuracoes_chave_valida: 'chave de configuração inválida.'
  };

  /* ---------- estado ---------- */

  var cliente = null;
  var clienteUsaLocal = null;
  var assinaturaAuth = null;
  var militarAtual = null;
  var perfilDesatualizado = false;
  var perfilPendente = null;
  /* 'desconhecido' | 'entrou' | 'mfa' (falta o 2º fator) | 'saiu' */
  var estadoSessao = 'desconhecido';
  var ouvintesSessao = [];
  var tempoReal = {
    assinantes: [], canal: null, ativo: false, geracao: 0, tentativas: 0, temporizador: null, houveFalha: false
  };

  /* ---------- utilidades ---------- */

  function texto(valor) { return (valor === null || valor === undefined) ? '' : String(valor); }

  function textoOuNulo(valor) {
    var t = texto(valor).trim();
    return t ? t : null;
  }

  function temPropria(objeto, chave) {
    return !!objeto && Object.prototype.hasOwnProperty.call(objeto, chave);
  }

  function copiar(valor) {
    return (valor === undefined || valor === null) ? valor : JSON.parse(JSON.stringify(valor));
  }

  function idsUnicos(lista) {
    var vistos = {};
    return (Array.isArray(lista) ? lista : []).filter(function (id) {
      if (!id || vistos[id]) { return false; }
      vistos[id] = true;
      return true;
    }).map(String);
  }

  function emLotes(lista, tamanho) {
    var lotes = [];
    for (var i = 0; i < lista.length; i += tamanho) { lotes.push(lista.slice(i, i + tamanho)); }
    return lotes;
  }

  /* Executa as funções (que devolvem Promise) uma depois da outra. */
  function emSequencia(itens, fn) {
    return itens.reduce(function (anterior, item) {
      return anterior.then(function () { return fn(item); });
    }, Promise.resolve());
  }

  function dataOuNulo(valor, rotulo) {
    if (valor === null || valor === undefined || valor === '') { return null; }
    var d = String(valor).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { throw erroAqs((rotulo || 'A data') + ' é inválida.'); }
    return d;
  }

  function hoje() { return U.hojeBelem(); }

  function agoraIso() { return new Date().toISOString(); }

  function registrarAviso(contexto, erro) {
    if (typeof console !== 'undefined' && console.warn) { console.warn('[ApiSupabase] ' + contexto, erro); }
  }

  /* ---------- erros ---------- */

  function erroAqs(mensagem, codigo, original) {
    var e = new Error(mensagem);
    e.aqs = true;
    if (codigo) { e.codigo = codigo; }
    if (original !== undefined) { e.original = original; }
    return e;
  }

  function eFalhaDeRede(erro, status) {
    if (!erro) { return false; }
    var nome = texto(erro.name);
    var msg = texto(erro.message);
    if (nome === 'FunctionsFetchError') { return true; }
    if (nome === 'AuthRetryableFetchError' && !(Number(erro.status) >= 500)) { return true; }
    if (/Failed to fetch|NetworkError|Load failed|fetch failed|Network request failed|ERR_INTERNET|ERR_NETWORK/i.test(msg)) {
      return true;
    }
    if (nome === 'StorageUnknownError' && erro.originalError) { return eFalhaDeRede(erro.originalError); }
    return status === 0 && !texto(erro.code) && /FetchError|TypeError/i.test(msg);
  }

  function nomeRestricao(msg) {
    var m = /constraint "([^"]+)"/.exec(texto(msg));
    return m ? m[1] : '';
  }

  /* Erros do Storage (upload, download, remoção). */
  function traduzirStorage(erro, status) {
    var msg = texto(erro.message);
    var sc = texto(erro.statusCode);
    var codigo = texto(erro.code);
    var st = Number(erro.status || status) || Number(sc) || 0;
    if (/bucket not found/i.test(msg)) {
      return erroAqs('O armazenamento de evidências ("' + BUCKET + '") não existe no Supabase. ' +
        'O responsável técnico deve rodar supabase/02-seguranca.sql.', 'storage', erro);
    }
    if (st === 413 || codigo === 'EntityTooLarge' || /maximum allowed size|too large/i.test(msg)) {
      var limite = (window.AQS_CONFIG && AQS_CONFIG.LIMITE_ARQUIVO_MB) || 20;
      return erroAqs('O arquivo é maior que o limite de ' + limite + ' MB.', 'storage', erro);
    }
    if (codigo === 'InvalidMimeType' || /mime type/i.test(msg)) {
      return erroAqs('Tipo de arquivo não permitido pelo armazenamento.', 'storage', erro);
    }
    if (st === 409 || codigo === 'ResourceAlreadyExists' || /already exists/i.test(msg)) {
      return erroAqs('Já existe um arquivo com este nome. Envie de novo.', 'storage', erro);
    }
    if (st === 404 || codigo === 'NoSuchKey' || /not found/i.test(msg)) {
      return erroAqs('Arquivo não encontrado no armazenamento. Ele pode ter sido excluído.', 'storage', erro);
    }
    if (st === 401 || /jwt/i.test(msg)) { return erroAqs(MSG.sessaoExpirada, 'sessao', erro); }
    if (st === 403 || codigo === 'AccessDenied' || /row-level security|unauthorized|permission/i.test(msg)) {
      return erroAqs(MSG.semPermissao, 'permissao', erro);
    }
    if (st >= 500) { return erroAqs(MSG.servidor, 'servidor', erro); }
    return erroAqs('Falha no armazenamento de arquivos' + (msg ? ': ' + msg : '.'), 'storage', erro);
  }

  /* Qualquer erro do supabase-js (Auth, PostgREST, Storage, Functions) →
     Error com mensagem em português. Mensagens dos raise exception do
     nosso SQL (já em português) passam como vieram. */
  function traduzirErro(erro, status) {
    if (!erro) { return erroAqs('Erro desconhecido.'); }
    if (erro.aqs) { return erro; }
    var codigo = texto(erro.code);
    var msg = texto(erro.message || (typeof erro === 'string' ? erro : ''));
    var nome = texto(erro.name);
    var st = Number(erro.status || status) || 0;

    if (eFalhaDeRede(erro, status)) { return erroAqs(MSG.semConexao, 'rede', erro); }
    if (nome === 'AbortError' || (!codigo && /AbortError|aborted/i.test(msg))) {
      return erroAqs(MSG.demorou, 'rede', erro);
    }
    if (msg === 'sem_cadastro') { return erroAqs(MSG.semCadastro, 'sem_cadastro', erro); }

    /* --- Auth --- */
    if (codigo === 'invalid_credentials' || /invalid login credentials/i.test(msg)) {
      return erroAqs(MSG.credenciais, codigo || 'invalid_credentials', erro);
    }
    if (codigo === 'user_banned' || /user is banned/i.test(msg)) { return erroAqs(MSG.banido, 'user_banned', erro); }
    if (codigo === 'over_request_rate_limit' || codigo === 'over_email_send_rate_limit' || st === 429) {
      return erroAqs(MSG.tentativas, 'limite', erro);
    }
    if (codigo === 'email_not_confirmed') {
      return erroAqs('O e-mail deste acesso ainda não foi confirmado. Procure a chefia ou a AQS.', codigo, erro);
    }
    if (codigo === 'weak_password' || nome === 'AuthWeakPasswordError') {
      return erroAqs('Senha fraca para as regras do servidor: use uma senha mais longa, misturando letras ' +
        'maiúsculas, minúsculas, números e símbolos.', 'weak_password', erro);
    }
    if (codigo === 'same_password') { return erroAqs('A nova senha precisa ser diferente da atual.', codigo, erro); }
    if (codigo === 'reauthentication_needed') {
      return erroAqs('Por segurança, saia e entre de novo antes de trocar a senha.', codigo, erro);
    }
    if (codigo === 'insufficient_aal' || /AAL2 required/i.test(msg)) {
      return erroAqs(MSG.exigeSegundoFator, 'insufficient_aal', erro);
    }
    if (codigo === 'mfa_verification_failed' || codigo === 'mfa_verification_rejected' ||
        codigo === 'mfa_challenge_expired' || /invalid totp code/i.test(msg)) {
      return erroAqs(MSG.codigoInvalido, codigo || 'mfa_verification_failed', erro);
    }
    if (codigo === 'mfa_factor_not_found') {
      return erroAqs('Autenticador não encontrado. Ele pode ter sido removido — comece de novo.', codigo, erro);
    }
    if (codigo === 'too_many_enrolled_mfa_factors') {
      return erroAqs('Limite de autenticadores atingido. Remova um dos cadastrados antes de incluir outro.', codigo, erro);
    }
    if (/^mfa_.*_not_enabled$/.test(codigo)) {
      return erroAqs('O segundo fator (aplicativo autenticador) está desligado no Supabase. O responsável ' +
        'técnico deve ativá-lo em Authentication → Multi-Factor (docs/CONTINUIDADE.md).', codigo, erro);
    }
    if (nome === 'AuthSessionMissingError' || nome === 'AuthInvalidJwtError' || codigo === 'invalid_jwt' ||
        codigo === 'session_not_found' || codigo === 'session_expired' ||
        codigo === 'refresh_token_not_found' || codigo === 'refresh_token_already_used' || codigo === 'bad_jwt' ||
        codigo === 'PGRST301' || codigo === 'PGRST302' || codigo === 'PGRST303' || /jwt expired|invalid jwt/i.test(msg)) {
      return erroAqs(MSG.sessaoExpirada, 'sessao', erro);
    }

    /* --- Postgres / PostgREST --- */
    if (codigo === '42501') {
      if (/row-level security|permission denied/i.test(msg)) {
        return erroAqs(MSG.semPermissao, 'permissao', erro);
      }
      return erroAqs(msg, codigo, erro);
    }
    if (codigo === '23505') {
      return erroAqs(MSG_UNICAS[nomeRestricao(msg)] || MSG.duplicado, codigo, erro);
    }
    if (codigo === '23514') {
      if (/violates check constraint/i.test(msg)) {
        var restricao = nomeRestricao(msg);
        var det = DETALHES_CHECK[restricao] || ('regra "' + (restricao || 'desconhecida') + '" do banco.');
        return erroAqs('Dados inválidos: ' + det, codigo, erro);
      }
      return erroAqs(msg, codigo, erro);
    }
    if (codigo === '23503') {
      return erroAqs(/still referenced/i.test(texto(erro.details) + msg)
        ? 'Este registro está ligado a outros dados e não pode ser excluído.'
        : 'Dados inválidos: um registro relacionado não existe mais. Atualize a página.', codigo, erro);
    }
    if (codigo === '23502') {
      var coluna = /column "([^"]+)"/.exec(msg);
      return erroAqs('Dados inválidos: falta preencher um campo obrigatório' + (coluna ? ' (' + coluna[1] + ')' : '') + '.',
        codigo, erro);
    }
    if (codigo === '22P02' || codigo === '22007' || codigo === '22008' || codigo === '22003' || codigo === '22001') {
      return erroAqs('Dados inválidos: valor em formato incorreto.', codigo, erro);
    }
    if (codigo === 'P0001' || codigo === 'P0002' || codigo === '22023') { return erroAqs(msg, codigo, erro); }
    if (codigo === 'PGRST116') { return erroAqs(MSG.naoEncontrado, codigo, erro); }
    if (/^PGRST2\d\d$/.test(codigo) || codigo === '42P01' || codigo === '42883' || codigo === '42703') {
      return erroAqs(MSG.bancoDesatualizado, codigo, erro);
    }

    /* --- Storage --- */
    if (erro.__isStorageError || /^Storage/.test(nome)) { return traduzirStorage(erro, status); }

    if (st === 401) { return erroAqs(MSG.sessaoExpirada, 'sessao', erro); }
    if (st === 403) { return erroAqs(MSG.semPermissao, 'permissao', erro); }
    if (st >= 500) { return erroAqs(MSG.servidor, 'servidor', erro); }
    return erroAqs(msg ? 'Erro inesperado: ' + msg : 'Erro inesperado no servidor.', codigo || 'desconhecido', erro);
  }

  /* Falta de permissão com a sessão vencida aparece como "sem permissão"
     (a requisição sai como anônima). Confere antes de responder. */
  function falhar(erro, status) {
    var traduzido = traduzirErro(erro, status);
    if (traduzido.codigo === 'permissao' && cliente) {
      return Promise.resolve(cliente.auth.getSession()).then(function (r) {
        var sessao = r && r.data && r.data.session;
        throw sessao ? traduzido : erroAqs(MSG.sessaoExpirada, 'sessao', erro);
      }, function () { throw traduzido; });
    }
    return Promise.reject(traduzido);
  }

  /* Resposta { data, error, count, status } do supabase-js → a própria
     resposta, ou rejeição com o erro traduzido. */
  function executar(consulta) {
    return Promise.resolve(consulta).then(function (r) {
      if (r && r.error) { return falhar(r.error, r.status); }
      return r || {};
    }, function (e) {
      return falhar(e);
    });
  }

  function dados(consulta) {
    return executar(consulta).then(function (r) { return r.data; });
  }

  /* update/delete com .select(): nenhuma linha = sem permissão (a RLS
     esconde a linha) ou registro já apagado. */
  function exigirLinhas(linhas, mensagem) {
    if (!Array.isArray(linhas) || !linhas.length) { throw erroAqs(mensagem || MSG.semEfeito, 'sem_efeito'); }
    return linhas;
  }

  /* Busca em páginas (.range) até acabar. "montar" devolve uma consulta
     NOVA a cada chamada, já com filtros e uma ordem estável (terminando
     numa chave única, senão as páginas podem repetir ou pular linhas).
     A 1ª página pede a contagem exata, que diz quando parar mesmo que o
     projeto tenha um "Max rows" menor que TAMANHO_PAGINA. */
  function buscarTudo(montar, limite) {
    var todas = [];
    var total = null;
    var maximo = limite > 0 ? limite : Infinity;
    function pagina(inicio) {
      var quantos = Math.min(TAMANHO_PAGINA, maximo - inicio);
      var consulta = montar(inicio === 0 ? { count: 'exact' } : undefined).range(inicio, inicio + quantos - 1);
      return executar(consulta).then(function (r) {
        var linhas = r.data || [];
        if (inicio === 0 && typeof r.count === 'number') { total = r.count; }
        todas = todas.concat(linhas);
        var fim = !linhas.length || todas.length >= maximo ||
          (total !== null ? todas.length >= total : linhas.length < quantos);
        return fim ? todas : pagina(todas.length);
      });
    }
    return pagina(0);
  }

  function ordenar(consulta, colunas) {
    colunas.forEach(function (c) {
      var desc = c.charAt(0) === '-';
      consulta = consulta.order(desc ? c.slice(1) : c, { ascending: !desc });
    });
    return consulta;
  }

  /* ---------- armazenamento do navegador ---------- */

  var memoria = {};
  var armazenamentoMemoria = {
    getItem: function (k) { return temPropria(memoria, k) ? memoria[k] : null; },
    setItem: function (k, v) { memoria[k] = String(v); },
    removeItem: function (k) { delete memoria[k]; }
  };

  function armazenamentoNativo(nome) {
    try {
      var s = window[nome];
      if (!s) { return null; }
      var teste = '__aqs_teste__';
      s.setItem(teste, '1');
      s.removeItem(teste);
      return s;
    } catch (e) {
      return null;
    }
  }

  /* Cada operação protegida: se o navegador recusar no meio do uso (cota,
     bloqueio), cai para a memória em vez de quebrar o login. */
  function protegido(nativo) {
    if (!nativo) { return armazenamentoMemoria; }
    return {
      getItem: function (k) {
        try { return nativo.getItem(k); } catch (e) { return armazenamentoMemoria.getItem(k); }
      },
      setItem: function (k, v) {
        try { nativo.setItem(k, v); } catch (e) { armazenamentoMemoria.setItem(k, v); }
      },
      removeItem: function (k) {
        try { nativo.removeItem(k); } catch (e) { /* segue */ }
        armazenamentoMemoria.removeItem(k);
      }
    };
  }

  function lerLembrar() {
    try {
      var s = window.localStorage;
      return !!s && s.getItem(CHAVE_LEMBRAR) === '1';
    } catch (e) {
      return false;
    }
  }

  function gravarLembrar(lembrar) {
    try {
      if (window.localStorage) { window.localStorage.setItem(CHAVE_LEMBRAR, lembrar ? '1' : '0'); }
    } catch (e) {
      /* sem armazenamento: vale só para esta página */
    }
  }

  /* Apaga o token guardado num dos armazenamentos (usado antes de cada
     login: só fica o token da sessão nova, onde o militar escolheu). */
  function limparSessaoGuardada(nome) {
    try {
      var s = window[nome];
      if (!s) { return; }
      [CHAVE_SESSAO, CHAVE_SESSAO + '-user', CHAVE_SESSAO + '-code-verifier'].forEach(function (k) {
        s.removeItem(k);
      });
    } catch (e) {
      /* armazenamento bloqueado: não há o que limpar */
    }
  }

  /* ---------- cliente ---------- */

  function configuracaoPendente() {
    var c = window.AQS_CONFIG || {};
    var url = texto(c.SUPABASE_URL).trim();
    var chave = texto(c.SUPABASE_ANON_KEY).trim();
    return !/^https?:\/\/\S+$/i.test(url) || /SEU-PROJETO/i.test(url) || !chave || /COLE-AQUI/i.test(chave);
  }

  function criarCliente() {
    if (configuracaoPendente()) { throw erroAqs(MSG.configuracao, 'configuracao_pendente'); }
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      throw erroAqs(MSG.biblioteca, 'biblioteca_ausente');
    }
    clienteUsaLocal = lerLembrar();
    var nativo = armazenamentoNativo(clienteUsaLocal ? 'localStorage' : 'sessionStorage');
    cliente = window.supabase.createClient(texto(AQS_CONFIG.SUPABASE_URL).trim().replace(/\/+$/, ''),
      texto(AQS_CONFIG.SUPABASE_ANON_KEY).trim(), {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          storageKey: CHAVE_SESSAO,
          storage: protegido(nativo)
        }
      });
    var r = cliente.auth.onAuthStateChange(aoEventoAuth);
    assinaturaAuth = r && r.data && r.data.subscription;
    return cliente;
  }

  function obterCliente() {
    return cliente || criarCliente();
  }

  function descartarCliente() {
    if (!cliente) { return; }
    encerrarCanal();
    try { if (assinaturaAuth) { assinaturaAuth.unsubscribe(); } } catch (e) { /* segue */ }
    try { cliente.auth.stopAutoRefresh(); } catch (e) { /* segue */ }
    try { cliente.removeAllChannels(); } catch (e) { /* segue */ }
    assinaturaAuth = null;
    cliente = null;
  }

  /* ---------- sessão ---------- */

  /* Lê o payload do JWT de acesso (só para o nível do segundo fator; quem
     valida o token é o servidor). */
  function payloadDoToken(token) {
    try {
      var parte = texto(token).split('.')[1] || '';
      var base64 = parte.replace(/-/g, '+').replace(/_/g, '/');
      while (base64.length % 4) { base64 += '='; }
      var binario = window.atob(base64);
      var codificado = '';
      for (var i = 0; i < binario.length; i += 1) {
        codificado += '%' + ('0' + binario.charCodeAt(i).toString(16)).slice(-2);
      }
      return JSON.parse(decodeURIComponent(codificado));
    } catch (e) {
      return null;
    }
  }

  /* Sessão completa = sem segundo fator, ou com ele já confirmado (aal2).
     Feito sem chamar o Auth porque roda dentro do onAuthStateChange, onde
     outra chamada ao Auth travaria esperando a mesma fila. */
  function sessaoCompleta(sessao) {
    if (!sessao || !sessao.access_token) { return false; }
    var fatores = (sessao.user && sessao.user.factors) || [];
    var temFator = fatores.some(function (f) { return f && f.status === 'verified'; });
    if (!temFator) { return true; }
    var payload = payloadDoToken(sessao.access_token);
    return !!payload && payload.aal === 'aal2';
  }

  function emitirSessao(evento) {
    var lista = ouvintesSessao.slice();
    /* Fora do callback do Auth: quem ouve vai chamar a API, e o Auth ainda
       está com a fila ocupada enquanto o callback roda. */
    window.setTimeout(function () {
      lista.forEach(function (cb) {
        try { cb(evento); } catch (e) { if (typeof console !== 'undefined') { console.error(e); } }
      });
    }, 0);
  }

  /* O Auth repete SIGNED_IN (ao voltar à aba, em outra aba…): só avisa as
     telas nas MUDANÇAS de estado. Login que ainda espera o código do
     segundo fator não conta como "entrou". A sessão restaurada ao abrir a
     página (estado ainda 'desconhecido') também não: quem abre a página
     descobre a sessão por iniciar(). */
  function aoEventoAuth(evento, sessao) {
    if (evento === 'INITIAL_SESSION') {
      if (estadoSessao === 'desconhecido') {
        estadoSessao = sessaoCompleta(sessao) ? 'entrou' : (sessao ? 'mfa' : 'saiu');
      }
      return;
    }
    if (evento === 'SIGNED_OUT') {
      var estava = estadoSessao;
      estadoSessao = 'saiu';
      militarAtual = null;
      perfilPendente = null;
      encerrarCanal();
      if (estava === 'entrou') { emitirSessao('saiu'); }
      return;
    }
    if (evento === 'SIGNED_IN' || evento === 'MFA_CHALLENGE_VERIFIED' || evento === 'TOKEN_REFRESHED' ||
        evento === 'USER_UPDATED') {
      if (!sessao) { return; }
      if (sessaoCompleta(sessao)) {
        var antes = estadoSessao;
        estadoSessao = 'entrou';
        if (antes !== 'entrou') {
          if (antes !== 'desconhecido') { emitirSessao('entrou'); }
          if (tempoReal.assinantes.length && !tempoReal.ativo) { window.setTimeout(montarCanal, 0); }
        }
      } else if (estadoSessao !== 'entrou') {
        estadoSessao = 'mfa';
      }
    }
  }

  function resumoSessao(sessao) {
    return { usuario_id: sessao.user.id, email: sessao.user.email || null };
  }

  function sessaoAtual() {
    var c = obterCliente();
    return Promise.resolve(c.auth.getSession()).then(function (r) {
      var sessao = r && r.data && r.data.session;
      if (!sessao || !sessao.user) { return null; }
      return Promise.resolve(c.auth.mfa.getAuthenticatorAssuranceLevel()).then(function (n) {
        var nivel = n && n.data;
        if (nivel && nivel.currentLevel === 'aal1' && nivel.nextLevel === 'aal2') { return null; }
        return resumoSessao(sessao);
      }, function () {
        return sessaoCompleta(sessao) ? resumoSessao(sessao) : null;
      });
    }, function (e) {
      throw traduzirErro(e);
    });
  }

  function iniciar() {
    obterCliente();
    return sessaoAtual().then(function (s) {
      if (estadoSessao === 'desconhecido') { estadoSessao = s ? 'entrou' : 'saiu'; }
      return s;
    });
  }

  function aoMudarSessao(cb) {
    if (typeof cb !== 'function') { return function () {}; }
    ouvintesSessao.push(cb);
    return function cancelar() {
      ouvintesSessao = ouvintesSessao.filter(function (x) { return x !== cb; });
    };
  }

  function entrar(email, senha, lembrar) {
    var e = texto(email).trim().toLowerCase();
    if (!e || !texto(senha)) { return Promise.reject(erroAqs('Informe o e-mail e a senha.')); }
    var querLocal = !!lembrar;
    gravarLembrar(querLocal);
    /* O armazenamento do token é escolhido ao criar o cliente: mudou a
       escolha, recria-o ANTES do login. E nenhum token antigo sobra em
       lugar nenhum: "não lembrar" não deixa sessão esquecida no aparelho,
       e o cliente recriado não restaura uma sessão velha no meio do login. */
    if (cliente && clienteUsaLocal !== querLocal) { descartarCliente(); }
    limparSessaoGuardada('sessionStorage');
    limparSessaoGuardada('localStorage');
    var c = obterCliente();
    militarAtual = null;
    perfilPendente = null;
    return executar(c.auth.signInWithPassword({ email: e, password: String(senha) })).then(function () {
      return executar(c.auth.mfa.getAuthenticatorAssuranceLevel());
    }).then(function (r) {
      var nivel = r.data || {};
      var precisaMfa = nivel.currentLevel === 'aal1' && nivel.nextLevel === 'aal2';
      if (precisaMfa) { estadoSessao = 'mfa'; }
      return { precisaMfa: precisaMfa };
    });
  }

  function fatorTotpVerificado(lista) {
    var todos = (lista && lista.data && lista.data.all) || [];
    for (var i = 0; i < todos.length; i += 1) {
      if (todos[i].factor_type === 'totp' && todos[i].status === 'verified') { return todos[i]; }
    }
    return null;
  }

  function validarCodigo(codigo) {
    var c = texto(codigo).replace(/\s+/g, '');
    if (!/^\d{6}$/.test(c)) { throw erroAqs(MSG.codigoFormato, 'codigo'); }
    return c;
  }

  function verificarMfa(codigo) {
    var c = obterCliente();
    var limpo = validarCodigo(codigo);
    return executar(c.auth.mfa.listFactors()).then(function (r) {
      var fator = fatorTotpVerificado(r);
      if (!fator) { throw erroAqs('Nenhum aplicativo autenticador está cadastrado para esta conta.', 'sem_fator'); }
      return executar(c.auth.mfa.challengeAndVerify({ factorId: fator.id, code: limpo }));
    }).then(function () {
      return undefined;
    });
  }

  function sair(todosDispositivos) {
    var c = cliente;
    encerrarCanal();
    militarAtual = null;
    perfilPendente = null;
    if (!c) { return Promise.resolve(); }
    return Promise.resolve(c.auth.signOut({ scope: todosDispositivos ? 'global' : 'local' })).then(function (r) {
      /* O supabase-js já apagou a sessão deste aparelho mesmo com erro. */
      if (r && r.error && todosDispositivos) {
        var t = traduzirErro(r.error);
        throw erroAqs('Você saiu deste aparelho, mas não foi possível encerrar a sessão nos outros (' +
          t.message.replace(/\.$/, '') + '). Entre e tente "sair de todos" de novo.', t.codigo, r.error);
      }
    }, function (e) {
      if (todosDispositivos) { throw traduzirErro(e); }
    });
  }

  function meuPerfil() {
    var c = obterCliente();
    perfilPendente = executar(c.rpc('meu_perfil')).then(function (r) {
      var m = Array.isArray(r.data) ? r.data[0] : r.data;
      if (!m || !m.id) { throw erroAqs(MSG.semCadastro, 'sem_cadastro'); }
      militarAtual = m;
      perfilDesatualizado = false;
      perfilPendente = null;
      return copiar(m);
    }, function (e) {
      perfilPendente = null;
      if (e && e.codigo === 'sem_cadastro') { militarAtual = null; }
      throw e;
    });
    return perfilPendente;
  }

  /* O militar logado (id para autoria e para o filtro do tempo real). */
  function garantirMilitar() {
    if (militarAtual && !perfilDesatualizado) { return Promise.resolve(militarAtual); }
    if (perfilPendente) { return perfilPendente.then(function () { return militarAtual; }); }
    return meuPerfil().then(function () { return militarAtual; });
  }

  function trocarSenha(nova) {
    var problema = Regras.validarSenha(nova);
    if (problema) { return Promise.reject(erroAqs(problema, 'senha')); }
    var c = obterCliente();
    return executar(c.auth.updateUser({ password: nova })).then(function () {
      return executar(c.rpc('confirmar_troca_senha'));
    }).then(function () {
      if (militarAtual) { militarAtual.deve_trocar_senha = false; }
    });
  }

  /* ---------- segundo fator (TOTP) ---------- */

  function fatoresTotp(r) {
    return ((r && r.data && r.data.all) || []).filter(function (f) { return f && f.factor_type === 'totp'; });
  }

  function mfaFatores() {
    var c = obterCliente();
    return executar(c.auth.mfa.listFactors()).then(function (r) {
      return fatoresTotp(r).map(function (f) {
        return { id: f.id, status: f.status, criado_em: f.created_at || null };
      });
    });
  }

  /* O Auth devolve 'data:image/svg+xml;utf-8,<svg…>' sem codificar; um
     '#' no SVG cortaria a imagem. Recodifica como data URI válido. */
  function normalizarQr(qr) {
    var t = texto(qr);
    var virgula = t.indexOf(',');
    if (t.indexOf('data:') === 0 && virgula > 0) {
      var corpo = t.slice(virgula + 1);
      return /^\s*</.test(corpo) ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(corpo) : t;
    }
    return /^\s*</.test(t) ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(t) : t;
  }

  function mfaIniciarCadastro() {
    var c = obterCliente();
    return executar(c.auth.mfa.listFactors()).then(function (r) {
      var totp = fatoresTotp(r);
      /* Cadastro anterior abandonado (QR lido pela metade): remove antes. */
      var pendentes = totp.filter(function (f) { return f.status !== 'verified'; });
      var nomesEmUso = {};
      totp.forEach(function (f) { if (f.status === 'verified') { nomesEmUso[texto(f.friendly_name)] = true; } });
      var nome = NOME_FATOR;
      for (var n = 2; nomesEmUso[nome]; n += 1) { nome = NOME_FATOR + ' (' + n + ')'; }
      return emSequencia(pendentes, function (f) {
        return executar(c.auth.mfa.unenroll({ factorId: f.id }));
      }).then(function () {
        return executar(c.auth.mfa.enroll({ factorType: 'totp', friendlyName: nome, issuer: NOME_FATOR }));
      });
    }).then(function (r) {
      var d = r.data || {};
      var totp = d.totp || {};
      return { fator_id: d.id, qr_code: normalizarQr(totp.qr_code), segredo: totp.secret || '' };
    });
  }

  function mfaConfirmarCadastro(fatorId, codigo) {
    if (!fatorId) { return Promise.reject(erroAqs('Cadastro do segundo fator não encontrado. Comece de novo.')); }
    var limpo = validarCodigo(codigo);
    var c = obterCliente();
    return executar(c.auth.mfa.challengeAndVerify({ factorId: fatorId, code: limpo })).then(function () {
      return undefined;
    });
  }

  function mfaRemover(fatorId) {
    if (!fatorId) { return Promise.reject(erroAqs('Segundo fator não encontrado.')); }
    var c = obterCliente();
    return Promise.resolve(c.auth.mfa.unenroll({ factorId: fatorId })).then(function (r) {
      if (r && r.error) {
        var t = traduzirErro(r.error, r.status);
        if (t.codigo === 'insufficient_aal') {
          throw erroAqs('Para remover o autenticador, saia, entre de novo informando o código do aplicativo ' +
            '(segundo fator) e tente outra vez. Se perdeu o celular, peça à chefia ou à AQS para remover o ' +
            'segundo fator da sua conta.', 'insufficient_aal', r.error);
        }
        throw t;
      }
    }, function (e) { throw traduzirErro(e); });
  }

  /* ---------- setores ---------- */

  function listarSetores() {
    var c = obterCliente();
    return buscarTudo(function (o) {
      return ordenar(c.from('setores').select('*', o), ['ordem', 'sigla', 'id']);
    });
  }

  function salvarSetor(s) {
    s = s || {};
    var sigla = texto(s.sigla).trim().toUpperCase();
    var nome = texto(s.nome).trim();
    if (!sigla || sigla.length > 15) { return Promise.reject(erroAqs('Informe a sigla do setor (até 15 caracteres).')); }
    if (!nome) { return Promise.reject(erroAqs('Informe o nome do setor.')); }
    var linha = { sigla: sigla, nome: nome };
    if (/^#[0-9a-fA-F]{6}$/.test(texto(s.cor))) { linha.cor = s.cor; }
    if (s.ordem !== undefined && s.ordem !== null && s.ordem !== '') {
      var ordem = Number(s.ordem);
      if (!isFinite(ordem) || Math.floor(ordem) !== ordem) {
        return Promise.reject(erroAqs('A ordem deve ser um número inteiro.'));
      }
      linha.ordem = ordem;
    }
    var c = obterCliente();
    var consulta = s.id
      ? c.from('setores').update(linha).eq('id', s.id).select()
      : c.from('setores').insert(linha).select();
    return dados(consulta).then(function (linhas) {
      return exigirLinhas(linhas, s.id ? 'Setor não encontrado (ou sem permissão). Atualize a página.' : null)[0];
    });
  }

  function excluirSetor(id) {
    var c = obterCliente();
    return dados(c.from('setores').delete().eq('id', id).select('id')).then(function (linhas) {
      exigirLinhas(linhas, 'Setor não encontrado (ou sem permissão). Atualize a página.');
    });
  }

  /* ---------- militares ---------- */

  function nomeOrdenavel(m) { return Regras.nomeMilitar(m); }

  function listarMilitares() {
    var c = obterCliente();
    return buscarTudo(function (o) {
      return c.from('militares').select('*', o).order('id');
    }).then(function (lista) {
      return lista.sort(function (a, b) {
        return nomeOrdenavel(a).localeCompare(nomeOrdenavel(b), 'pt-BR', { sensitivity: 'base' });
      });
    });
  }

  function buscarMilitar(id) {
    var c = obterCliente();
    return dados(c.from('militares').select('*').eq('id', id).limit(1)).then(function (linhas) {
      return (linhas && linhas[0]) || null;
    });
  }

  /* Perfil recém-lido: as conferências de papel não podem usar um papel
     antigo (a chefia pode ter mudado há pouco). */
  function perfilAtualizado() {
    return meuPerfil().then(function () { return militarAtual; });
  }

  function salvarMilitar(dadosMilitar) {
    var d = dadosMilitar || {};
    var nomeGuerra = texto(d.nome_guerra).trim();
    var posto = texto(d.posto).trim();
    var email = texto(d.email).trim().toLowerCase() || null;
    if (!nomeGuerra) { return Promise.reject(erroAqs('Informe o nome de guerra.')); }
    if (nomeGuerra.length > 80) { return Promise.reject(erroAqs('O nome de guerra pode ter no máximo 80 caracteres.')); }
    if (posto.length > 30) { return Promise.reject(erroAqs('O posto pode ter no máximo 30 caracteres.')); }
    if (email) {
      var problemaEmail = Regras.validarEmail(email);
      if (problemaEmail) { return Promise.reject(erroAqs(problemaEmail)); }
    }
    var c = obterCliente();
    return Promise.all([perfilAtualizado(), d.id ? buscarMilitar(d.id) : Promise.resolve(null)]).then(function (r) {
      var eu = r[0];
      var existente = r[1];
      if (d.id && !existente) {
        throw erroAqs('Militar não encontrado. O cadastro pode ter sido excluído — atualize a página.');
      }
      var papel = (d.papel === undefined || d.papel === null || d.papel === '')
        ? (existente ? existente.papel : 'adjunto') : d.papel;
      if (!temPropria(Regras.ROTULOS.papel, papel)) { throw erroAqs('Papel inválido.'); }
      if (!Regras.podeGerenciarMilitar(eu, existente, papel)) {
        throw erroAqs((Regras.eAdministrador(existente) || papel === 'administrador') ? MSG.soAdministrador : MSG.semPermissao,
          'permissao');
      }
      if (existente && existente.usuario_id && email !== existente.email) {
        throw erroAqs('Este militar já tem acesso ao sistema. Para mudar o e-mail, use "Alterar e-mail de acesso".');
      }
      var ativo = (d.ativo === undefined || d.ativo === null) ? (existente ? existente.ativo : true) : !!d.ativo;
      if (existente && existente.id === eu.id && existente.ativo && !ativo) {
        throw erroAqs('Você não pode desativar o seu próprio acesso.');
      }
      var linha = {
        posto: posto, nome_guerra: nomeGuerra, nome_completo: textoOuNulo(d.nome_completo), email: email,
        setor_id: d.setor_id || null, papel: papel, ativo: ativo
      };
      var consulta = existente
        ? c.from('militares').update(linha).eq('id', existente.id).select()
        : c.from('militares').insert(linha).select();
      return dados(consulta);
    }).then(function (linhas) {
      var salvo = exigirLinhas(linhas)[0];
      if (militarAtual && salvo.id === militarAtual.id) { militarAtual = salvo; }
      return copiar(salvo);
    });
  }

  /* Edge Function admin-usuarios. Em erro HTTP, a mensagem vem do corpo
     JSON { erro } que a própria função escreveu em português. */
  function adminUsuario(acao, militarId, extra) {
    var c = obterCliente();
    var corpo = Object.assign({ acao: acao, militar_id: militarId }, extra || {});
    return Promise.resolve(c.functions.invoke(FUNCAO_ADMIN, { body: corpo })).then(function (r) {
      if (r && r.error) { return erroDaFuncao(r.error); }
      var resposta = r ? r.data : null;
      if (typeof resposta === 'string') {
        try { resposta = JSON.parse(resposta); } catch (e) { resposta = null; }
      }
      if (!resposta || typeof resposta !== 'object') {
        throw erroAqs('Resposta inesperada do serviço de administração de usuários.', 'funcao');
      }
      if (resposta.ok === false) { throw erroAqs(texto(resposta.erro) || 'Falha na administração de usuários.', 'funcao'); }
      var saida = {};
      ['senha_temporaria', 'aviso', 'email', 'removidos'].forEach(function (k) {
        if (resposta[k] !== undefined) { saida[k] = resposta[k]; }
      });
      if (militarAtual && militarAtual.id === militarId) { perfilDesatualizado = true; }
      return saida;
    }, function (e) {
      return erroDaFuncao(e);
    });
  }

  function erroDaFuncao(erro) {
    var nome = texto(erro && erro.name);
    if (nome === 'FunctionsFetchError') { return Promise.reject(erroAqs(MSG.funcaoInacessivel, 'rede', erro)); }
    if (nome === 'FunctionsRelayError') {
      return Promise.reject(erroAqs('O Supabase não conseguiu executar o serviço de administração de usuários. ' +
        'Tente de novo em instantes.', 'funcao', erro));
    }
    var resposta = erro && erro.context;
    if (nome === 'FunctionsHttpError' && resposta) {
      var status = Number(resposta.status) || 0;
      var leitura;
      try {
        leitura = Promise.resolve(typeof resposta.json === 'function' ? resposta.json() : null);
      } catch (e) {
        leitura = Promise.resolve(null);
      }
      return leitura.then(function (j) { return j; }, function () { return null; }).then(function (j) {
        if (j && j.erro) { throw erroAqs(texto(j.erro), 'funcao_' + status, erro); }
        if (status === 404) { throw erroAqs(MSG.funcaoAusente, 'funcao_404', erro); }
        if (status === 401) { throw erroAqs(MSG.sessaoExpirada, 'sessao', erro); }
        if (status === 403) { throw erroAqs(MSG.semPermissao, 'permissao', erro); }
        if (status === 429) { throw erroAqs(MSG.tentativas, 'limite', erro); }
        throw erroAqs('O serviço de administração de usuários falhou (HTTP ' + (status || '?') + '). ' +
          'Tente de novo; se persistir, avise o responsável técnico.', 'funcao_' + status, erro);
      });
    }
    return Promise.reject(traduzirErro(erro));
  }

  function excluirMilitar(id) {
    return adminUsuario('excluir', id);
  }

  function transferirChefia(opcoes) {
    var o = opcoes || {};
    if (!o.para) { return Promise.reject(erroAqs('Escolha o militar que vai assumir a chefia.')); }
    var c = obterCliente();
    return executar(c.rpc('transferir_chefia', {
      p_de: o.de || null,
      p_para: o.para,
      p_papel_anterior: o.papel_anterior || 'adjunto',
      p_transferir_atividades: o.transferir_atividades !== false
    })).then(function () {
      perfilDesatualizado = true;
      return undefined;
    });
  }

  /* ---------- feriados e configurações ---------- */

  function listarFeriados() {
    var c = obterCliente();
    return buscarTudo(function (o) { return c.from('feriados').select('*', o).order('data'); });
  }

  /* Insere ou atualiza pela data; 'data_original' corrige a data de um
     feriado já cadastrado. */
  function salvarFeriado(f) {
    f = f || {};
    var data;
    try { data = dataOuNulo(f.data, 'A data do feriado'); } catch (e) { return Promise.reject(e); }
    if (!data) { return Promise.reject(erroAqs('Informe a data do feriado.')); }
    var descricao = texto(f.descricao).trim();
    if (!descricao) { return Promise.reject(erroAqs('Informe a descrição do feriado.')); }
    var original = f.data_original ? String(f.data_original).slice(0, 10) : null;
    var c = obterCliente();
    var linha = { data: data, descricao: descricao };
    var upsert = function () {
      return dados(c.from('feriados').upsert(linha, { onConflict: 'data' }).select());
    };
    var passo = (original && original !== data)
      ? dados(c.from('feriados').update(linha).eq('data', original).select()).then(function (linhas) {
        return (linhas && linhas.length) ? linhas : upsert();
      })
      : upsert();
    return passo.then(function (linhas) { return exigirLinhas(linhas)[0]; });
  }

  function excluirFeriado(data) {
    var c = obterCliente();
    var d = String(data || '').slice(0, 10);
    return dados(c.from('feriados').delete().eq('data', d).select('data')).then(function (linhas) {
      exigirLinhas(linhas, 'Feriado não encontrado (ou sem permissão). Atualize a página.');
    });
  }

  function obterConfiguracoes() {
    var c = obterCliente();
    return buscarTudo(function (o) { return c.from('configuracoes').select('chave, valor', o).order('chave'); })
      .then(function (linhas) {
        var mapa = {};
        linhas.forEach(function (l) { mapa[l.chave] = l.valor; });
        return mapa;
      });
  }

  function salvarConfiguracao(chave, valor) {
    if (!/^[a-z][a-z0-9_]{0,49}$/.test(texto(chave))) { return Promise.reject(erroAqs('Chave de configuração inválida.')); }
    if (valor === undefined || valor === null) { return Promise.reject(erroAqs('Informe o valor da configuração.')); }
    var c = obterCliente();
    return dados(c.from('configuracoes').upsert({ chave: chave, valor: valor }, { onConflict: 'chave' }).select('valor'))
      .then(function (linhas) {
        return exigirLinhas(linhas)[0].valor;
      });
  }

  /* ---------- atividades ---------- */

  function listarAtividades() {
    var c = obterCliente();
    return buscarTudo(function (o) {
      return ordenar(c.from('atividades').select('*, atividade_responsaveis(militar_id)', o), ['ordem', 'criado_em', 'id']);
    }).then(function (linhas) {
      return linhas.map(function (a) {
        a.responsaveis = (a.atividade_responsaveis || []).map(function (r) { return r.militar_id; });
        delete a.atividade_responsaveis;
        return a;
      });
    });
  }

  function salvarAtividade(dadosAtividade) {
    var d = dadosAtividade || {};
    var p = {};
    CAMPOS_ATIVIDADE.forEach(function (k) {
      if (temPropria(d, k) && d[k] !== undefined) { p[k] = d[k]; }
    });
    var c = obterCliente();
    return dados(c.rpc('salvar_atividade', { p: p }));
  }

  /* Remove do Storage, em lotes, os arquivos destas evidências. O Storage
     não acusa erro para caminhos que já não existem. */
  function removerArquivos(caminhos) {
    var c = obterCliente();
    return emSequencia(emLotes(caminhos, LOTE), function (lote) {
      return executar(c.storage.from(BUCKET).remove(lote));
    });
  }

  function caminhosDasEvidencias(campo, valor) {
    var c = obterCliente();
    return buscarTudo(function (o) {
      return c.from('evidencias').select('id, storage_path', o).eq(campo, valor).order('id');
    }).then(function (linhas) {
      return linhas.map(function (l) { return l.storage_path; }).filter(Boolean);
    });
  }

  function exigirGestor() {
    return perfilAtualizado().then(function (eu) {
      if (!Regras.eGestor(eu)) { throw erroAqs(MSG.semPermissao, 'permissao'); }
      return eu;
    });
  }

  /* Os arquivos saem antes: apagada a atividade, as linhas de evidência
     somem em cascata e ninguém mais saberia quais objetos remover. */
  function excluirAtividade(id) {
    var c = obterCliente();
    return exigirGestor().then(function () {
      return caminhosDasEvidencias('atividade_id', id);
    }).then(removerArquivos).then(function () {
      return dados(c.from('atividades').delete().eq('id', id).select('id'));
    }).then(function (linhas) {
      exigirLinhas(linhas, 'Atividade não encontrada (ou sem permissão). Atualize a página.');
    });
  }

  function gerarOcorrencias() {
    var c = obterCliente();
    return dados(c.rpc('gerar_ocorrencias')).then(function (n) { return Number(n) || 0; });
  }

  /* ---------- ocorrências (v_ocorrencias) ---------- */

  function listarOcorrencias(filtro) {
    var f = filtro || {};
    var c = obterCliente();
    return buscarTudo(function (o) {
      var q = c.from('v_ocorrencias').select('*', o);
      if (f.atividade_id) { q = q.eq('atividade_id', f.atividade_id); }
      if (f.somenteAbertas) { q = q.in('status', ['pendente', 'em_andamento']); }
      if (f.de) { q = q.gte('data_ref', String(f.de).slice(0, 10)); }
      if (f.ate) { q = q.lte('data_ref', String(f.ate).slice(0, 10)); }
      return ordenar(q, ['data_ref', 'criado_em', 'id']);
    });
  }

  function obterOcorrencia(id) {
    var c = obterCliente();
    return dados(c.from('v_ocorrencias').select('*').eq('id', id).limit(1)).then(function (linhas) {
      if (!linhas || !linhas.length) {
        throw erroAqs('Ocorrência não encontrada. Ela pode ter sido excluída — atualize a página.', 'nao_encontrado');
      }
      return linhas[0];
    });
  }

  function validarStatus(status, justificativa) {
    if (STATUS_VALIDOS.indexOf(status) < 0) { throw erroAqs('Situação inválida.'); }
    if (status === 'nao_se_aplica' && !texto(justificativa).trim()) {
      throw erroAqs('Informe a justificativa para marcar como "não se aplica".');
    }
  }

  function criarOcorrencia(d) {
    d = d || {};
    if (!d.atividade_id) { return Promise.reject(erroAqs('Informe a atividade.')); }
    var status = d.status || 'pendente';
    var linha;
    try {
      validarStatus(status, d.justificativa);
      linha = {
        atividade_id: d.atividade_id,
        titulo_execucao: textoOuNulo(d.titulo_execucao),
        prazo: dataOuNulo(d.prazo, 'O prazo'),
        status: status,
        observacao: texto(d.observacao)
      };
      if (temPropria(d, 'justificativa')) { linha.justificativa = textoOuNulo(d.justificativa); }
    } catch (e) {
      return Promise.reject(e);
    }
    var c = obterCliente();
    return garantirMilitar().then(function (eu) {
      linha.criado_por = eu.id;
      return dados(c.from('ocorrencias').insert(linha).select('id'));
    }).then(function (linhas) {
      return obterOcorrencia(exigirLinhas(linhas)[0].id);
    });
  }

  function atualizarOcorrencia(id, campos) {
    campos = campos || {};
    var mudancas = {};
    try {
      CAMPOS_OCORRENCIA.forEach(function (k) {
        if (!temPropria(campos, k) || campos[k] === undefined) { return; }
        if (k === 'prazo') { mudancas.prazo = dataOuNulo(campos.prazo, 'O prazo'); }
        else if (k === 'observacao') { mudancas.observacao = texto(campos.observacao); }
        else if (k === 'status') {
          if (STATUS_VALIDOS.indexOf(campos.status) < 0) { throw erroAqs('Situação inválida.'); }
          mudancas.status = campos.status;
        } else { mudancas[k] = textoOuNulo(campos[k]); }
      });
      if (mudancas.status === 'nao_se_aplica' && temPropria(mudancas, 'justificativa') && !mudancas.justificativa) {
        throw erroAqs('Informe a justificativa para marcar como "não se aplica".');
      }
    } catch (e) {
      return Promise.reject(e);
    }
    if (!Object.keys(mudancas).length) { return obterOcorrencia(id); }
    var c = obterCliente();
    return dados(c.from('ocorrencias').update(mudancas).eq('id', id).select('id')).then(function (linhas) {
      exigirLinhas(linhas);
      return obterOcorrencia(id);
    });
  }

  function excluirOcorrencia(id) {
    var c = obterCliente();
    return exigirGestor().then(function () {
      return caminhosDasEvidencias('ocorrencia_id', id);
    }).then(removerArquivos).then(function () {
      return dados(c.from('ocorrencias').delete().eq('id', id).select('id'));
    }).then(function (linhas) {
      exigirLinhas(linhas, 'Ocorrência não encontrada (ou sem permissão). Atualize a página.');
    });
  }

  /* ---------- evidências ---------- */

  function listarEvidencias(filtro) {
    var f = filtro || {};
    var c = obterCliente();
    return buscarTudo(function (o) {
      var q = c.from('evidencias').select('*', o);
      if (f.atividade_id) { q = q.eq('atividade_id', f.atividade_id); }
      if (f.ocorrencia_id) { q = q.eq('ocorrencia_id', f.ocorrencia_id); }
      return ordenar(q, ['-enviado_em', 'id']);
    });
  }

  /* Envia o arquivo e depois grava a linha. Se a linha falhar (sem
     permissão, ocorrência apagada…), o arquivo é removido: não fica objeto
     órfão no Storage. */
  function enviarEvidencia(d) {
    d = d || {};
    var arquivo = d.arquivo;
    if (!d.atividade_id) { return Promise.reject(erroAqs('Informe a atividade.')); }
    var problema = Regras.validarArquivo(arquivo);
    if (problema) { return Promise.reject(erroAqs(problema, 'arquivo')); }
    var descricao = texto(d.descricao).trim();
    if (descricao.length > 500) { return Promise.reject(erroAqs('A descrição pode ter no máximo 500 caracteres.')); }
    var c = obterCliente();
    var caminho = d.atividade_id + '/' + (d.ocorrencia_id || 'geral') + '/' + U.uuid() + '-' + U.nomeSeguro(arquivo.name);
    var mime = Regras.mimeDe(arquivo);
    /* Com File/Blob o supabase-js envia multipart e o Storage grava o tipo
       DO PRÓPRIO Blob (a opção contentType é ignorada). Navegadores dão
       tipo vazio ou genérico a .csv, .odt etc., que o bucket recusaria:
       reembala com o tipo canônico (sem copiar o conteúdo). */
    var corpo = (arquivo.type === mime) ? arquivo : new Blob([arquivo], { type: mime });
    var eu;
    return garantirMilitar().then(function (m) {
      eu = m;
      return executar(c.storage.from(BUCKET).upload(caminho, corpo, {
        contentType: mime, upsert: false, cacheControl: '0'
      }));
    }).then(function () {
      return executar(c.from('evidencias').insert({
        atividade_id: d.atividade_id,
        ocorrencia_id: d.ocorrencia_id || null,
        storage_path: caminho,
        nome: String(arquivo.name),
        mime: mime,
        tamanho: Number(arquivo.size) || 0,
        descricao: descricao,
        enviado_por: eu.id
      }).select()).then(function (r) {
        return exigirLinhas(r.data)[0];
      }, function (erroLinha) {
        return Promise.resolve(c.storage.from(BUCKET).remove([caminho])).then(function (rr) {
          if (rr && rr.error) { registrarAviso('arquivo órfão no Storage: ' + caminho, rr.error); }
          throw erroLinha;
        }, function (e) {
          registrarAviso('arquivo órfão no Storage: ' + caminho, e);
          throw erroLinha;
        });
      });
    });
  }

  function acharEvidencia(evidencia) {
    if (evidencia && typeof evidencia === 'object' && evidencia.storage_path) { return Promise.resolve(evidencia); }
    var id = (evidencia && typeof evidencia === 'object') ? evidencia.id : evidencia;
    var c = obterCliente();
    return dados(c.from('evidencias').select('*').eq('id', id).limit(1)).then(function (linhas) {
      if (!linhas || !linhas.length) {
        throw erroAqs('Evidência não encontrada. Ela pode ter sido excluída — atualize a página.', 'nao_encontrado');
      }
      return linhas[0];
    });
  }

  function baixarEvidencia(evidencia) {
    var c = obterCliente();
    var ev;
    return acharEvidencia(evidencia).then(function (e) {
      ev = e;
      return dados(c.storage.from(BUCKET).download(ev.storage_path));
    }).then(function (blob) {
      if (!blob) { throw erroAqs('O arquivo veio vazio do armazenamento.'); }
      /* O tipo que vale é o registrado (o Storage pode devolver genérico),
         para o navegador abrir PDF e imagem direto. */
      return (ev.mime && blob.type !== ev.mime) ? new Blob([blob], { type: ev.mime }) : blob;
    });
  }

  /* A linha sai primeiro (é ela que a RLS confere); depois o arquivo. Se o
     arquivo não sair, fica só registrado no console — a evidência já não
     aparece para ninguém. */
  function excluirEvidencia(evidencia) {
    var c = obterCliente();
    var ev;
    return acharEvidencia(evidencia).then(function (e) {
      ev = e;
      return dados(c.from('evidencias').delete().eq('id', ev.id).select('id'));
    }).then(function (linhas) {
      exigirLinhas(linhas, 'Evidência não encontrada ou sem permissão para excluí-la. Atualize a página.');
      return Promise.resolve(c.storage.from(BUCKET).remove([ev.storage_path])).then(function (r) {
        if (r && r.error) { registrarAviso('arquivo não removido do Storage: ' + ev.storage_path, r.error); }
      }, function (e) {
        registrarAviso('arquivo não removido do Storage: ' + ev.storage_path, e);
      });
    });
  }

  /* ---------- comentários ---------- */

  function listarComentarios(filtro) {
    var f = filtro || {};
    var c = obterCliente();
    return buscarTudo(function (o) {
      var q = c.from('comentarios').select('*', o);
      if (f.atividade_id) { q = q.eq('atividade_id', f.atividade_id); }
      if (f.ocorrencia_id) { q = q.eq('ocorrencia_id', f.ocorrencia_id); }
      return ordenar(q, ['criado_em', 'id']);
    });
  }

  function comentar(d) {
    d = d || {};
    var conteudo = texto(d.texto).trim();
    if (!d.atividade_id) { return Promise.reject(erroAqs('Informe a atividade.')); }
    if (!conteudo) { return Promise.reject(erroAqs('Escreva o comentário antes de enviar.')); }
    if (conteudo.length > 4000) { return Promise.reject(erroAqs('O comentário pode ter no máximo 4000 caracteres.')); }
    var c = obterCliente();
    return garantirMilitar().then(function (eu) {
      return dados(c.from('comentarios').insert({
        atividade_id: d.atividade_id, ocorrencia_id: d.ocorrencia_id || null, autor_id: eu.id, texto: conteudo
      }).select());
    }).then(function (linhas) {
      return exigirLinhas(linhas)[0];
    });
  }

  function excluirComentario(id) {
    var c = obterCliente();
    return dados(c.from('comentarios').delete().eq('id', id).select('id')).then(function (linhas) {
      exigirLinhas(linhas, 'Comentário não encontrado ou sem permissão para excluí-lo. Atualize a página.');
    });
  }

  /* ---------- avisos ---------- */

  var SELECAO_AVISO = '*, avisos_destinatarios(militar_id), avisos_ciencia(militar_id, ciente_em)';

  function montarAviso(linha, eu) {
    linha.destinatarios = (linha.avisos_destinatarios || []).map(function (d) { return d.militar_id; });
    linha.ciencias = (linha.avisos_ciencia || []).map(function (x) {
      return { militar_id: x.militar_id, ciente_em: x.ciente_em };
    });
    linha.ciente_por_mim = !!eu && linha.ciencias.some(function (x) { return x.militar_id === eu.id; });
    delete linha.avisos_destinatarios;
    delete linha.avisos_ciencia;
    return linha;
  }

  function listarAvisos(filtro) {
    var f = filtro || {};
    var c = obterCliente();
    return garantirMilitar().then(function (eu) {
      return buscarTudo(function (o) {
        var q = c.from('avisos').select(SELECAO_AVISO, o);
        if (!f.incluirExpirados) { q = q.or('expira_em.is.null,expira_em.gte.' + hoje()); }
        return ordenar(q, ['-fixado', '-criado_em', 'id']);
      }).then(function (linhas) {
        return linhas.map(function (l) { return montarAviso(l, eu); });
      });
    });
  }

  function obterAviso(id, eu) {
    var c = obterCliente();
    return dados(c.from('avisos').select(SELECAO_AVISO).eq('id', id).limit(1)).then(function (linhas) {
      return montarAviso(exigirLinhas(linhas, MSG.naoEncontrado)[0], eu);
    });
  }

  /* Troca só a diferença: quem continua não é notificado de novo. */
  function sincronizarDestinatarios(avisoId, desejados) {
    var c = obterCliente();
    return dados(c.from('avisos_destinatarios').select('militar_id').eq('aviso_id', avisoId)).then(function (linhas) {
      var atuais = (linhas || []).map(function (l) { return l.militar_id; });
      var sair = atuais.filter(function (id) { return desejados.indexOf(id) < 0; });
      var entrar = desejados.filter(function (id) { return atuais.indexOf(id) < 0; });
      return emSequencia(emLotes(sair, LOTE), function (lote) {
        return executar(c.from('avisos_destinatarios').delete().eq('aviso_id', avisoId).in('militar_id', lote));
      }).then(function () {
        if (!entrar.length) { return null; }
        return executar(c.from('avisos_destinatarios').insert(entrar.map(function (id) {
          return { aviso_id: avisoId, militar_id: id };
        })));
      });
    });
  }

  function salvarAviso(d) {
    d = d || {};
    var titulo = texto(d.titulo).trim();
    var mensagem = texto(d.mensagem);
    var nivel = d.nivel || 'informativo';
    var paraTodos = (d.para_todos === undefined || d.para_todos === null) ? true : !!d.para_todos;
    var destinatarios = paraTodos ? [] : idsUnicos(d.destinatarios);
    var linha;
    try {
      if (!titulo) { throw erroAqs('Informe o título do aviso.'); }
      if (titulo.length > 200) { throw erroAqs('O título do aviso pode ter no máximo 200 caracteres.'); }
      if (mensagem.length > 10000) { throw erroAqs('A mensagem pode ter no máximo 10.000 caracteres.'); }
      if (!temPropria(Regras.ROTULOS.nivel, nivel)) { throw erroAqs('Nível do aviso inválido.'); }
      if (!paraTodos && !destinatarios.length) {
        throw erroAqs('Escolha ao menos um destinatário ou marque o aviso como "para todos".');
      }
      linha = {
        titulo: titulo, mensagem: mensagem, nivel: nivel, para_todos: paraTodos,
        prazo: dataOuNulo(d.prazo, 'O prazo'), atividade_id: d.atividade_id || null, fixado: !!d.fixado,
        expira_em: dataOuNulo(d.expira_em, 'A data de expiração')
      };
    } catch (e) {
      return Promise.reject(e);
    }
    var c = obterCliente();
    var eu;
    var novo = !d.id;
    var avisoId = d.id || null;
    return garantirMilitar().then(function (m) {
      eu = m;
      var consulta = novo
        ? c.from('avisos').insert(Object.assign({ criado_por: eu.id }, linha)).select('id')
        : c.from('avisos').update(linha).eq('id', d.id).select('id');
      return dados(consulta);
    }).then(function (linhas) {
      avisoId = exigirLinhas(linhas)[0].id;
      return sincronizarDestinatarios(avisoId, destinatarios).then(null, function (erroDest) {
        /* Aviso novo sem os destinatários pedidos não pode ficar publicado
           pela metade: desfaz e informa. */
        if (!novo) { throw erroDest; }
        return executar(c.from('avisos').delete().eq('id', avisoId)).then(function () { throw erroDest; },
          function () { throw erroDest; });
      });
    }).then(function () {
      return obterAviso(avisoId, eu);
    });
  }

  function excluirAviso(id) {
    var c = obterCliente();
    return dados(c.from('avisos').delete().eq('id', id).select('id')).then(function (linhas) {
      exigirLinhas(linhas, 'Aviso não encontrado (ou sem permissão). Atualize a página.');
    });
  }

  function darCiencia(avisoId) {
    var c = obterCliente();
    var eu;
    return garantirMilitar().then(function (m) {
      eu = m;
      return Promise.resolve(c.from('avisos_ciencia').insert({ aviso_id: avisoId, militar_id: eu.id }));
    }).then(function (r) {
      /* Ciência já registrada (outra aba, clique duplo): está tudo certo. */
      if (r && r.error && texto(r.error.code) !== '23505') { return falhar(r.error, r.status); }
      /* Quem deu ciência já leu: a notificação do aviso sai do sino. Só a
         coluna "lida" das próprias notificações (grant de coluna + RLS);
         se falhar, a ciência — que é o que importa — já está gravada. */
      return Promise.resolve(c.from('notificacoes').update({ lida: true })
        .eq('destinatario_id', eu.id).eq('aviso_id', avisoId).eq('lida', false)).then(function (rr) {
        if (rr && rr.error) { registrarAviso('notificação do aviso não marcada como lida', rr.error); }
      }, function (e) {
        registrarAviso('notificação do aviso não marcada como lida', e);
      });
    }).then(function () { return undefined; });
  }

  /* ---------- notificações ---------- */

  function listarNotificacoes(opcoes) {
    var limite = Math.max(1, Math.floor(Number(opcoes && opcoes.limite) || 30));
    var c = obterCliente();
    return garantirMilitar().then(function (eu) {
      return buscarTudo(function (o) {
        return ordenar(c.from('notificacoes').select('*', o).eq('destinatario_id', eu.id), ['-criado_em', '-id']);
      }, limite);
    });
  }

  function contarNaoLidas() {
    var c = obterCliente();
    return garantirMilitar().then(function (eu) {
      return executar(c.from('notificacoes').select('id', { count: 'exact', head: true })
        .eq('destinatario_id', eu.id).eq('lida', false));
    }).then(function (r) {
      return Number(r.count) || 0;
    });
  }

  function marcarNotificacoesLidas(ids) {
    var c = obterCliente();
    var lista = Array.isArray(ids) ? idsUnicos(ids) : null;
    if (lista && !lista.length) { return Promise.resolve(); }
    return garantirMilitar().then(function (eu) {
      var base = function () {
        return c.from('notificacoes').update({ lida: true }).eq('destinatario_id', eu.id).eq('lida', false);
      };
      if (!lista) { return executar(base()); }
      return emSequencia(emLotes(lista, LOTE), function (lote) { return executar(base().in('id', lote)); });
    }).then(function () { return undefined; });
  }

  /* ---------- gestão: auditoria e exportação ---------- */

  function listarAuditoria(opcoes) {
    var o = opcoes || {};
    var limite = Math.max(1, Math.floor(Number(o.limite) || 200));
    var c = obterCliente();
    return buscarTudo(function (op) {
      var q = c.from('auditoria').select('*', op);
      if (o.tabela) { q = q.eq('tabela', o.tabela); }
      return q.order('id', { ascending: false });
    }, limite);
  }

  /* Cópia de todas as tabelas (o que a RLS deixa o gestor ler; sem o
     conteúdo dos arquivos). Só depois de tudo lido grava o último backup —
     exportação que falhou não conta como backup. */
  function exportarTudo() {
    var c = obterCliente();
    var eu;
    var tabelas = {};
    return exigirGestor().then(function (m) {
      eu = m;
      return emSequencia(TABELAS_EXPORTADAS, function (par) {
        return buscarTudo(function (o) {
          return ordenar(c.from(par[0]).select('*', o), par[1]);
        }).then(function (linhas) { tabelas[par[0]] = linhas; });
      });
    }).then(function () {
      var quando = agoraIso();
      var valor = { em: quando, por_nome: Regras.nomeMilitar(eu) };
      return dados(c.from('configuracoes').upsert({ chave: 'ultimo_backup', valor: valor }, { onConflict: 'chave' })
        .select()).then(function (linhas) {
        var gravada = (linhas && linhas[0]) || { chave: 'ultimo_backup', valor: valor };
        tabelas.configuracoes = (tabelas.configuracoes || []).filter(function (l) { return l.chave !== 'ultimo_backup'; })
          .concat([gravada]);
        return {
          sistema: (window.AQS_CONFIG && AQS_CONFIG.NOME_SISTEMA ? AQS_CONFIG.NOME_SISTEMA : 'HABE · AQS e NSP') +
            ' — ' + (window.AQS_CONFIG && AQS_CONFIG.SUBTITULO ? AQS_CONFIG.SUBTITULO : 'Ferramenta de Gestão de Atividades'),
          origem: 'supabase',
          versao_formato: 1,
          gerado_em: quando,
          gerado_por: Regras.nomeMilitar(eu),
          observacao: 'Cópia de todas as tabelas, sem o conteúdo dos arquivos de evidência (que ficam no ' +
            'armazenamento "' + BUCKET + '" do Supabase).',
          tabelas: tabelas
        };
      });
    });
  }

  /* ---------- tempo real ---------- */

  function distribuir(tabela, evento) {
    if (tabela === 'militares') { perfilDesatualizado = true; }
    tempoReal.assinantes.slice().forEach(function (cb) {
      try { cb({ tabela: tabela, evento: evento }); } catch (e) { if (typeof console !== 'undefined') { console.error(e); } }
    });
  }

  /* Depois de uma queda, o que mudou nesse meio-tempo não chegou: avisa as
     telas para recarregarem (evento sintético 'RESSINCRONIZAR'). O sino
     fica de fora para não mostrar "nova notificação" falsa. */
  function ressincronizar() {
    TABELAS_TEMPO_REAL.forEach(function (t) {
      if (t !== 'notificacoes') { distribuir(t, 'RESSINCRONIZAR'); }
    });
  }

  function cancelarReassinatura() {
    if (tempoReal.temporizador) {
      window.clearTimeout(tempoReal.temporizador);
      tempoReal.temporizador = null;
    }
  }

  function removerCanal(canal) {
    if (!canal || !cliente) { return Promise.resolve(); }
    var c = cliente;
    return Promise.resolve().then(function () { return c.removeChannel(canal); }).then(null, function (e) {
      registrarAviso('falha ao fechar o canal de tempo real', e);
    });
  }

  function encerrarCanal() {
    cancelarReassinatura();
    tempoReal.geracao += 1; /* ignora o CLOSED do canal que está saindo */
    tempoReal.ativo = false;
    tempoReal.tentativas = 0;
    tempoReal.houveFalha = false;
    var antigo = tempoReal.canal;
    tempoReal.canal = null;
    return removerCanal(antigo);
  }

  function existeCanal(c, nome) {
    try {
      return (c.getChannels() || []).some(function (ch) { return ch && ch.topic === 'realtime:' + nome; });
    } catch (e) {
      return false;
    }
  }

  function montarCanal() {
    cancelarReassinatura();
    if (!tempoReal.assinantes.length || !cliente) { tempoReal.ativo = false; return; }
    tempoReal.ativo = true;
    var geracao = ++tempoReal.geracao;
    garantirMilitar().then(function (eu) {
      if (geracao !== tempoReal.geracao || !tempoReal.assinantes.length || !cliente) { return; }
      var c = cliente;
      /* Um canal antigo que não fechou direito ainda ocupa o nome. */
      var nome = existeCanal(c, CANAL) ? CANAL + '-' + geracao : CANAL;
      var canal = c.channel(nome);
      TABELAS_TEMPO_REAL.forEach(function (tabela) {
        var filtro = { event: '*', schema: 'public', table: tabela };
        if (tabela === 'notificacoes') { filtro.filter = 'destinatario_id=eq.' + eu.id; }
        canal = canal.on('postgres_changes', filtro, function (carga) {
          distribuir(tabela, carga && carga.eventType ? carga.eventType : '*');
        });
      });
      tempoReal.canal = canal;
      canal.subscribe(function (status, erro) { aoStatusCanal(geracao, status, erro); });
    }).then(null, function (e) {
      if (geracao !== tempoReal.geracao) { return; }
      tempoReal.ativo = false;
      /* Sem sessão: monta de novo quando entrar. Com sessão (rede), insiste. */
      if (estadoSessao === 'entrou' && e && e.codigo !== 'sem_cadastro') { agendarReassinatura(geracao); }
    });
  }

  function aoStatusCanal(geracao, status, erro) {
    if (geracao !== tempoReal.geracao) { return; }
    if (status === 'SUBSCRIBED') {
      /* Recuperou-se sozinho (o realtime-js também tenta): dispensa a
         reassinatura que estava agendada. */
      cancelarReassinatura();
      var reconectou = tempoReal.houveFalha;
      tempoReal.tentativas = 0;
      tempoReal.houveFalha = false;
      if (reconectou) { ressincronizar(); }
      return;
    }
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      if (erro) { registrarAviso('tempo real: ' + status, erro); }
      agendarReassinatura(geracao);
    }
  }

  /* Espera crescente: 1 s, 2 s, 4 s… até 60 s entre tentativas. */
  function agendarReassinatura(geracao) {
    if (tempoReal.temporizador || geracao !== tempoReal.geracao) { return; }
    tempoReal.houveFalha = true;
    tempoReal.tentativas += 1;
    var espera = Math.min(ESPERA_MAXIMA_MS, 1000 * Math.pow(2, tempoReal.tentativas - 1));
    tempoReal.temporizador = window.setTimeout(function () {
      tempoReal.temporizador = null;
      if (geracao !== tempoReal.geracao || !tempoReal.assinantes.length) { return; }
      var antigo = tempoReal.canal;
      tempoReal.canal = null;
      tempoReal.geracao += 1;
      var tentativas = tempoReal.tentativas;
      removerCanal(antigo).then(function () {
        if (!tempoReal.assinantes.length) { return; }
        montarCanal();
        tempoReal.tentativas = tentativas;
        tempoReal.houveFalha = true;
      });
    }, espera);
  }

  function assinarMudancas(cb) {
    if (typeof cb !== 'function') { return function () {}; }
    tempoReal.assinantes.push(cb);
    if (!tempoReal.ativo) {
      try { obterCliente(); } catch (e) { registrarAviso('tempo real indisponível', e); }
      montarCanal();
    }
    var cancelado = false;
    return function cancelar() {
      if (cancelado) { return; }
      cancelado = true;
      tempoReal.assinantes = tempoReal.assinantes.filter(function (x) { return x !== cb; });
      if (!tempoReal.assinantes.length) { encerrarCanal(); }
    };
  }

  /* ---------- exportação do módulo ---------- */

  /* Toda função pública devolve Promise: erro síncrono vira rejeição já
     traduzida (as páginas só usam .catch). */
  function seguro(fn) {
    return function () {
      try {
        return Promise.resolve(fn.apply(null, arguments)).then(null, function (e) { throw traduzirErro(e); });
      } catch (e) {
        return Promise.reject(traduzirErro(e));
      }
    };
  }

  var metodos = {
    /* sessão */
    iniciar: iniciar, sessaoAtual: sessaoAtual, entrar: entrar, verificarMfa: verificarMfa, sair: sair,
    meuPerfil: meuPerfil, trocarSenha: trocarSenha,
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
    listarAuditoria: listarAuditoria, exportarTudo: exportarTudo
  };

  var publico = {};
  Object.keys(metodos).forEach(function (nome) { publico[nome] = seguro(metodos[nome]); });
  /* Estes dois devolvem a função de cancelar, não uma Promise. */
  publico.aoMudarSessao = aoMudarSessao;
  publico.assinarMudancas = assinarMudancas;
  /* Para os testes automatizados (fora de Api.METODOS). */
  publico.traduzirErro = traduzirErro;
  return publico;
})();
