/* =========================================================================
   HABE – AQS e NSP — regras compartilhadas (funções puras)
   Usadas pelas telas (o que mostrar, que botão habilitar) e pela
   demonstração (ApiDemo), que imita o banco com elas. As permissões aqui
   são o ESPELHO das políticas RLS e das RPCs do banco (ARQUITETURA §3):
   na tela elas só escondem o que não pode ser feito; quem barra de verdade
   é sempre o banco. Mudou uma política? Mude aqui também.
   Ver docs/ARQUITETURA.md, seção 5.

   Papéis: adjunto, chefia e administrador (a conta institucional da AQS).
   "Gestor" = chefia OU administrador, ativo. Toda permissão que o contrato
   chama "de chefia" usa eGestor — é isso que mantém a ferramenta
   administrável quando a chefia muda ou o responsável técnico sai.

   Não toca em document nem em window ao carregar: o arquivo também roda
   no Node (testes/regras.mjs), dentro de um vm.
   ========================================================================= */

/* Registro das páginas: cada paginas/*.js acrescenta Paginas.<rota>.
   Declarado aqui porque regras.js é carregado antes de todas elas. */
var Paginas = (typeof window !== 'undefined' && window.Paginas) || {};

var Regras = (function () {
  'use strict';

  var FUSO = 'America/Belem';
  var MS_DIA = 86400000;

  /* ---------- rótulos ---------- */

  var ROTULOS = {
    papel: {
      administrador: 'Administrador (conta institucional AQS)',
      chefia: 'Chefia',
      adjunto: 'Adjunto'
    },
    tipo: { recorrente: 'Recorrente', pontual: 'Pontual', sob_demanda: 'Sob demanda' },
    periodicidade: {
      diaria_util: 'Diária (dias úteis)', semanal: 'Semanal', mensal: 'Mensal',
      trimestral: 'Trimestral', semestral: 'Semestral', anual: 'Anual'
    },
    prioridade: { baixa: 'Baixa', normal: 'Normal', alta: 'Alta', urgente: 'Urgente' },
    status: {
      pendente: 'Pendente', em_andamento: 'Em andamento', concluida: 'Concluída',
      nao_se_aplica: 'Não se aplica', atrasada: 'Atrasada'
    },
    nivel: { informativo: 'Informativo', importante: 'Importante', urgente: 'Urgente' },
    notificacao: { atribuicao: 'Atribuição', comentario: 'Comentário', aviso: 'Aviso', prazo: 'Prazo' }
  };

  var STATUS_ABERTOS = ['pendente', 'em_andamento'];
  var PAPEIS_GESTOR = ['chefia', 'administrador'];

  /* Mensagem da trava anti-bloqueio — a MESMA do gatilho do banco, para a
     demonstração e o sistema real dizerem a mesma coisa. */
  var MENSAGEM_TRAVA = 'É preciso manter ao menos uma conta de chefia ou administrador ativa e com acesso.';

  var MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  var MESES_EXTENSO = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
                       'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  var DIAS_SEMANA_PLURAL = ['', 'às segundas-feiras', 'às terças-feiras', 'às quartas-feiras',
                            'às quintas-feiras', 'às sextas-feiras', 'aos sábados', 'aos domingos'];

  /* Prazos dos alertas de continuidade (dias). */
  var DIAS_ALERTA_BACKUP = 35;
  var DIAS_ALERTA_SEM_ACESSO = 90;

  /* ---------- arquivos de evidência ---------- */

  /* Extensão → tipo MIME. A MESMA lista vai no bucket "evidencias" do
     Storage (allowed_mime_types); um tipo fora dela é recusado lá. */
  var TIPOS_ARQUIVO = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    odt: 'application/vnd.oasis.opendocument.text',
    ods: 'application/vnd.oasis.opendocument.spreadsheet',
    odp: 'application/vnd.oasis.opendocument.presentation',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    txt: 'text/plain',
    csv: 'text/csv'
  };

  /* Para o atributo accept do <input type="file">: extensões E tipos, porque
     alguns celulares só filtram pelo tipo MIME. */
  var ACCEPT = Object.keys(TIPOS_ARQUIVO).map(function (ext) { return '.' + ext; })
    .concat(Object.keys(TIPOS_ARQUIVO).map(function (ext) { return TIPOS_ARQUIVO[ext]; })
      .filter(function (mime, i, lista) { return lista.indexOf(mime) === i; }))
    .join(',');

  var LIMITE_PADRAO_MB = 20;

  /* ---------- auxiliares ---------- */

  function esc(valor) {
    if (valor === null || valor === undefined) { return ''; }
    return String(valor)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function contem(lista, valor) {
    return Array.isArray(lista) && lista.indexOf(valor) >= 0;
  }

  function temPropria(objeto, chave) {
    return Object.prototype.hasOwnProperty.call(objeto, chave);
  }

  function formatarData(texto) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(texto || ''));
    return m ? m[3] + '/' + m[2] + '/' + m[1] : '—';
  }

  /* 'AAAA-MM-DD' → nº de dias desde 1970-01-01 (aritmética de calendário,
     sem fuso), ou null se não for uma data. */
  function diaNumero(texto) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(texto || ''));
    if (!m) { return null; }
    return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / MS_DIA);
  }

  /* Diferença em dias de calendário (b − a); null se alguma não for data. */
  function diasEntre(a, b) {
    var da = diaNumero(a), db = diaNumero(b);
    return (da === null || db === null) ? null : db - da;
  }

  /* O formatador do Intl é caro de criar; um só para o arquivo inteiro. */
  var formatadorBelem = null;

  /* Data de calendário em Belém ('AAAA-MM-DD') de um instante (timestamptz).
     Belém não tem horário de verão (UTC−3); se o Intl faltar, usa a conta fixa. */
  function dataBelem(instante) {
    if (!instante) { return null; }
    var d = (instante instanceof Date) ? instante : new Date(instante);
    if (isNaN(d.getTime())) { return null; }
    try {
      if (!formatadorBelem) {
        formatadorBelem = new Intl.DateTimeFormat('en-CA', {
          timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit'
        });
      }
      var partes = {};
      formatadorBelem.formatToParts(d).forEach(function (p) { partes[p.type] = p.value; });
      if (partes.year && partes.month && partes.day) {
        return partes.year + '-' + partes.month + '-' + partes.day;
      }
    } catch (e) { /* cai na conta fixa abaixo */ }
    return new Date(d.getTime() - 3 * 3600000).toISOString().slice(0, 10);
  }

  /* Hoje em Belém. As telas passam U.hojeBelem(); este é só o padrão. */
  function hojeBelem() {
    if (typeof U !== 'undefined' && U && typeof U.hojeBelem === 'function') { return U.hojeBelem(); }
    return dataBelem(new Date());
  }

  /* ---------- validações ---------- */

  function extensaoDe(nome) {
    var m = /\.([^.\/\\]+)$/.exec(String(nome || ''));
    return m ? m[1].toLowerCase() : '';
  }

  function limiteConfigurado() {
    if (typeof AQS_CONFIG !== 'undefined' && AQS_CONFIG && Number(AQS_CONFIG.LIMITE_ARQUIVO_MB) > 0) {
      return Number(AQS_CONFIG.LIMITE_ARQUIVO_MB);
    }
    return LIMITE_PADRAO_MB;
  }

  function formatarMb(bytes) {
    return (bytes / 1048576).toFixed(1).replace('.', ',') + ' MB';
  }

  /* null se o arquivo pode ser enviado; senão a mensagem para o usuário. */
  function validarArquivo(arquivo, limiteMb) {
    if (!arquivo) { return 'Selecione um arquivo.'; }
    var nome = String(arquivo.name || '');
    if (!nome.trim()) { return 'O arquivo precisa ter um nome.'; }
    if (nome.length > 200) { return 'O nome do arquivo é muito longo (máximo de 200 caracteres). Renomeie e tente de novo.'; }
    var ext = extensaoDe(nome);
    if (!ext || !temPropria(TIPOS_ARQUIVO, ext)) {
      return 'Tipo de arquivo não permitido' + (ext ? ' (.' + ext + ')' : '') +
        '. Envie PDF, Word, Excel, PowerPoint, OpenDocument, imagem JPG ou PNG, TXT ou CSV.';
    }
    var tamanho = Number(arquivo.size);
    if (!isFinite(tamanho) || tamanho <= 0) { return 'O arquivo está vazio.'; }
    var limite = Number(limiteMb) > 0 ? Number(limiteMb) : limiteConfigurado();
    /* MB binário (1024 × 1024), o mesmo do limite do bucket no Storage. */
    if (tamanho > limite * 1048576) {
      return 'O arquivo tem ' + formatarMb(tamanho) + '; o limite é de ' + limite + ' MB por arquivo.';
    }
    return null;
  }

  /* Tamanho em bytes UTF-8: o Supabase Auth recusa senhas acima de 72 bytes. */
  function bytesUtf8(texto) {
    var total = 0;
    for (var i = 0; i < texto.length; i += 1) {
      var c = texto.charCodeAt(i);
      if (c < 0x80) { total += 1; }
      else if (c < 0x800) { total += 2; }
      else if (c >= 0xd800 && c <= 0xdbff) { total += 4; i += 1; }
      else { total += 3; }
    }
    return total;
  }

  function validarSenha(senha) {
    if (typeof senha !== 'string' || !senha) { return 'Informe a senha.'; }
    if (senha.length < 10) { return 'A senha deve ter ao menos 10 caracteres.'; }
    if (bytesUtf8(senha) > 72) { return 'A senha é longa demais (máximo de 72 caracteres).'; }
    if (/^\s|\s$/.test(senha)) { return 'A senha não pode começar nem terminar com espaço.'; }
    if (!/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(senha)) { return 'A senha deve ter ao menos uma letra.'; }
    if (!/[0-9]/.test(senha)) { return 'A senha deve ter ao menos um número.'; }
    return null;
  }

  /* E-mail no formato que o Auth aceita (validação de formulário; quem
     confere de verdade é o Supabase). */
  function validarEmail(email) {
    var texto = String(email || '').trim();
    if (!texto) { return 'Informe o e-mail.'; }
    if (texto.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(texto)) {
      return 'E-mail inválido. Confira o endereço digitado.';
    }
    return null;
  }

  /* Tipo MIME do arquivo. Quando a extensão é conhecida, vale o tipo da
     lista: navegadores mandam vazio, 'application/octet-stream' ou variantes
     ('text/x-csv', 'application/vnd.ms-excel' para .csv) que o bucket
     recusaria, e o tipo canônico também é o que volta no download. */
  function mimeDe(arquivo) {
    if (!arquivo) { return 'application/octet-stream'; }
    var ext = extensaoDe(arquivo.name);
    if (ext && temPropria(TIPOS_ARQUIVO, ext)) { return TIPOS_ARQUIVO[ext]; }
    return arquivo.type || 'application/octet-stream';
  }

  /* ---------- militares e papéis ---------- */

  function nomeMilitar(m) {
    if (!m) { return '—'; }
    var nome = (String(m.posto || '') + ' ' + String(m.nome_guerra || '')).replace(/\s+/g, ' ').trim();
    return nome || String(m.email || '—');
  }

  /* Aceita o mapa { id: militar } de Api.referencias() ou uma lista. */
  function nomesResponsaveis(ids, mapaMilitares) {
    var mapa = mapaMilitares || {};
    if (Array.isArray(mapa)) {
      var indice = {};
      mapa.forEach(function (m) { if (m && m.id) { indice[m.id] = m; } });
      mapa = indice;
    }
    var nomes = (ids || []).map(function (id) {
      return temPropria(mapa, id) ? nomeMilitar(mapa[id]) : 'Militar não encontrado';
    });
    return nomes.length ? nomes.join(', ') : 'Sem responsável';
  }

  /* "ativo" das políticas RLS (privado.eh_ativo): desativar corta o acesso
     na hora. Exige id porque só um cadastro gravado pode estar logado. */
  function eAtivo(m) {
    return !!(m && m.id && m.ativo !== false);
  }

  /* Só o papel (vale também para exibir cadastros inativos). */
  function eChefia(m) {
    return !!m && m.papel === 'chefia';
  }

  function eAdministrador(m) {
    return !!m && m.papel === 'administrador';
  }

  /* Gestor = chefia ou administrador, ativo (privado.eh_gestor). */
  function eGestor(m) {
    return eAtivo(m) && contem(PAPEIS_GESTOR, m.papel);
  }

  /* atividadeOuOcorrencia precisa trazer .responsaveis (listarAtividades e
     v_ocorrencias trazem). */
  function eResponsavel(m, atividadeOuOcorrencia) {
    return eAtivo(m) && !!atividadeOuOcorrencia && contem(atividadeOuOcorrencia.responsaveis, m.id);
  }

  /* Gestor que consegue entrar: ativo e com usuário de acesso ligado. É a
     conta que a trava anti-bloqueio protege. */
  function eGestorComAcesso(m) {
    return !!m && m.ativo !== false && !!m.usuario_id && contem(PAPEIS_GESTOR, m.papel);
  }

  function gestoresComAcesso(militares) {
    return (militares || []).filter(eGestorComAcesso);
  }

  /* Espelho do gatilho de militares: recusa a operação se a linha alterada
     ERA um gestor com acesso e, depois dela, não sobra nenhum. 'depois' é a
     lista completa de militares como ficaria (sem a linha, se excluída).
     null = pode; senão a mensagem do banco. */
  function violaTravaGestor(linhaAntes, militaresDepois) {
    if (!eGestorComAcesso(linhaAntes)) { return null; }
    return gestoresComAcesso(militaresDepois).length ? null : MENSAGEM_TRAVA;
  }

  /* Militares que recebem missões: ativos e que não sejam a conta
     institucional (listas de responsáveis, placar, relatórios por militar). */
  function militaresAtribuiveis(militares) {
    return (militares || []).filter(function (m) {
      return !!m && m.ativo !== false && m.papel !== 'administrador';
    });
  }

  /* Selo de autoria em comentários e avisos: 'CHEFIA' ou 'AQS'; vazio para
     adjunto. Recebe o papel (autor_papel é instantâneo do momento). */
  function rotuloPapelAutor(papel) {
    if (papel === 'chefia') { return 'CHEFIA'; }
    if (papel === 'administrador') { return 'AQS'; }
    return '';
  }

  /* ---------- permissões (espelho da RLS e das RPCs) ---------- */

  /* salvar_atividade: gestor edita tudo; adjunto, só as suas. */
  function podeEditarAtividade(m, atividade) {
    return eGestor(m) || eResponsavel(m, atividade);
  }

  /* salvar_atividade: adjunto cria só pontual ou sob demanda (e precisa se
     incluir como responsável — conferido no envio). Sem tipo: pode criar
     alguma coisa? */
  function podeCriarAtividade(m, tipo) {
    if (eGestor(m)) { return true; }
    if (!eAtivo(m)) { return false; }
    if (tipo === undefined || tipo === null || tipo === '') { return true; }
    return tipo === 'pontual' || tipo === 'sob_demanda';
  }

  /* Tipos que o formulário de atividade pode oferecer: gestor, todos;
     adjunto cria só pontual/sob demanda e não transforma uma atividade em
     recorrente (salvar_atividade recusa) — a que já é recorrente pode
     continuar sendo. */
  function tiposPermitidos(m, atividade) {
    if (eGestor(m)) { return ['recorrente', 'pontual', 'sob_demanda']; }
    if (!eAtivo(m)) { return []; }
    if (atividade && atividade.id && atividade.tipo === 'recorrente') { return ['recorrente', 'pontual', 'sob_demanda']; }
    return ['pontual', 'sob_demanda'];
  }

  function podeAlterarResponsaveis(m) {
    return eGestor(m);
  }

  function podeExcluirAtividade(m) {
    return eGestor(m);
  }

  /* ocorrencias UPDATE: gestor ou responsável. */
  function podeAtualizarOcorrencia(m, ocorrencia) {
    return eGestor(m) || eResponsavel(m, ocorrencia);
  }

  /* O gatilho impede que não-gestor mude atividade_id, referencia e prazo. */
  function podeAlterarPrazoOcorrencia(m) {
    return eGestor(m);
  }

  function podeExcluirOcorrencia(m) {
    return eGestor(m);
  }

  /* ocorrencias INSERT: gestor; ou responsável quando a atividade é sob demanda. */
  function podeRegistrarExecucao(m, atividade) {
    if (eGestor(m)) { return true; }
    return !!atividade && atividade.tipo === 'sob_demanda' && eResponsavel(m, atividade);
  }

  /* evidencias INSERT (e Storage INSERT): gestor ou responsável pela atividade. */
  function podeEnviarEvidencia(m, atividade) {
    return eGestor(m) || eResponsavel(m, atividade);
  }

  /* evidencias DELETE: gestor ou quem enviou. */
  function podeExcluirEvidencia(m, evidencia) {
    if (eGestor(m)) { return true; }
    return eAtivo(m) && !!evidencia && !!evidencia.enviado_por && evidencia.enviado_por === m.id;
  }

  /* comentarios INSERT: qualquer ativo (como autor). */
  function podeComentar(m) {
    return eAtivo(m);
  }

  /* comentarios DELETE: autor ou gestor. */
  function podeExcluirComentario(m, comentario) {
    if (eGestor(m)) { return true; }
    return eAtivo(m) && !!comentario && !!comentario.autor_id && comentario.autor_id === m.id;
  }

  function podePublicarAviso(m) {
    return eGestor(m);
  }

  /* avisos SELECT: gestor, para_todos, ou sou destinatário. */
  function podeVerAviso(m, aviso) {
    if (!eAtivo(m) || !aviso) { return false; }
    if (eGestor(m) || aviso.para_todos) { return true; }
    return contem(aviso.destinatarios, m.id);
  }

  /* setores, feriados, configurações, auditoria e exportação: gestor. */
  function podeGerenciarEquipe(m) {
    return eGestor(m);
  }

  function podeVerAuditoria(m) {
    return eGestor(m);
  }

  /* militares INSERT/UPDATE/DELETE e as ações de acesso: gestor. */
  function podeGerenciarUsuarios(m) {
    return eGestor(m);
  }

  /* (¹) da tabela de RLS: linhas com papel administrador — antes OU depois
     da mudança — só por administrador. alvo nulo = cadastro novo;
     novoPapel ausente = o papel não muda. Assim a chefia não consegue
     derrubar nem "rebaixar" a conta institucional. */
  function podeGerenciarMilitar(m, alvo, novoPapel) {
    if (!eGestor(m)) { return false; }
    var envolveAdministrador = eAdministrador(alvo) || novoPapel === 'administrador';
    return envolveAdministrador ? eAdministrador(m) : true;
  }

  /* Idem, e nunca a si mesmo (delete da RLS e a Edge Function). */
  function podeExcluirMilitar(m, alvo) {
    return !!alvo && podeGerenciarMilitar(m, alvo) && alvo.id !== m.id;
  }

  /* transferir_chefia: a conta institucional não assume a chefia (nem
     recebe missões); qualquer outro militar pode — inativo é reativado. */
  function podeAssumirChefia(alvo) {
    return !!alvo && !!alvo.id && alvo.papel !== 'administrador';
  }

  /* desativar (adminUsuario): mesmas regras de excluir. */
  function podeDesativarMilitar(m, alvo) {
    return podeExcluirMilitar(m, alvo);
  }

  /* ---------- situação das ocorrências ---------- */

  function estaAberta(oc) {
    return !!oc && contem(STATUS_ABERTOS, oc.status);
  }

  /* Igual à coluna atrasada de v_ocorrencias. */
  function estaAtrasada(oc, hoje) {
    if (!estaAberta(oc) || !oc.prazo) { return false; }
    return String(oc.prazo).slice(0, 10) < (hoje || hojeBelem());
  }

  function statusEfetivo(oc, hoje) {
    if (!oc) { return 'pendente'; }
    return estaAtrasada(oc, hoje) ? 'atrasada' : oc.status;
  }

  /* Igual à coluna concluida_no_prazo de v_ocorrencias (usa a da view
     quando vier pronta). */
  function concluidaNoPrazo(oc) {
    if (!oc || oc.status !== 'concluida') { return false; }
    if (typeof oc.concluida_no_prazo === 'boolean') { return oc.concluida_no_prazo; }
    if (!oc.prazo) { return true; }
    /* Nasceu concluída (execução registrada depois de feita): não havia
       prazo a cumprir. */
    if (oc.concluida_em && oc.concluida_em === oc.criado_em) { return true; }
    var data = dataBelem(oc.concluida_em);
    return !!data && data <= String(oc.prazo).slice(0, 10);
  }

  /* Universo = o que já deveria estar feito: status ≠ não se aplica e
     (prazo até hoje, sem prazo, ou já concluída — concluir adiantado conta).
     abertas = universo − concluídas (inclui as atrasadas e as que vencem hoje). */
  function conformidade(ocorrencias, hoje) {
    hoje = hoje || hojeBelem();
    var r = { universo: 0, concluidas: 0, no_prazo: 0, atrasadas: 0, abertas: 0, percentual: null };
    (ocorrencias || []).forEach(function (oc) {
      if (!oc || oc.status === 'nao_se_aplica') { return; }
      var prazo = oc.prazo ? String(oc.prazo).slice(0, 10) : null;
      if (!(prazo === null || prazo <= hoje || oc.status === 'concluida')) { return; }
      r.universo += 1;
      if (oc.status === 'concluida') {
        r.concluidas += 1;
        if (concluidaNoPrazo(oc)) { r.no_prazo += 1; }
      } else {
        r.abertas += 1;
        if (estaAtrasada(oc, hoje)) { r.atrasadas += 1; }
      }
    });
    r.percentual = r.universo ? Math.round(100 * r.concluidas / r.universo) : null;
    return r;
  }

  /* ---------- alertas de continuidade (Início, só para gestores) ---------- */

  var PESO_NIVEL = { urgente: 0, atencao: 1, info: 2 };

  function anoDe(texto) { return Number(String(texto || '').slice(0, 4)) || 0; }

  function listaDeFeriados(feriados) {
    if (!feriados) { return []; }
    if (Array.isArray(feriados)) {
      return feriados.map(function (f) { return (f && typeof f === 'object') ? f.data : f; })
        .filter(Boolean).map(String);
    }
    return Object.keys(feriados);
  }

  function juntarNomes(nomes) {
    if (nomes.length <= 1) { return nomes.join(''); }
    return nomes.slice(0, -1).join(', ') + ' e ' + nomes[nomes.length - 1];
  }

  /* Recebe { militares, atividades (com .responsaveis), feriados (lista de
     listarFeriados), configuracoes ({ chave: valor }), hoje, militar? } e
     devolve [{ nivel, titulo, texto, link }] do mais grave ao mais leve.
     Se 'militar' (o logado) vier e não for gestor, devolve []. Os links são
     rotas do app; a aba é um parâmetro que a página Equipe entende. */
  function alertasContinuidade(dados) {
    dados = dados || {};
    if (dados.militar && !eGestor(dados.militar)) { return []; }
    var militares = dados.militares || [];
    var atividades = dados.atividades || [];
    var config = dados.configuracoes || {};
    var hoje = String(dados.hoje || hojeBelem()).slice(0, 10);
    var alertas = [];

    var gestores = gestoresComAcesso(militares);
    var administradores = gestores.filter(eAdministrador);

    /* (a) sem a conta institucional, a administração fica presa a pessoas. */
    if (!administradores.length) {
      alertas.push({
        nivel: 'urgente',
        titulo: 'Nenhuma conta institucional de administrador ativa',
        texto: 'Não há conta de administrador (e-mail institucional da AQS) ativa e com acesso. ' +
          'É ela que mantém a ferramenta administrável quando chefes ou o responsável técnico saem do HABE. ' +
          'Cadastre a conta institucional e crie o acesso dela em Equipe → Militares ' +
          '(passo a passo em docs/CONTINUIDADE.md).',
        link: '#/equipe?aba=militares'
      });
    }

    /* (b) um gestor só = um ponto único de falha. */
    if (gestores.length === 1) {
      alertas.push({
        nivel: 'atencao',
        titulo: 'Só há uma conta de gestão com acesso',
        texto: nomeMilitar(gestores[0]) + ' é a única conta de chefia ou administrador ativa e com acesso. ' +
          'Cadastre um segundo gestor para não perder a administração se essa pessoa sair, ' +
          'esquecer a senha ou perder o celular do segundo fator.',
        link: '#/equipe?aba=militares'
      });
    }

    /* (c) atividade ativa sem nenhum responsável ativo — acontece quando
       alguém é excluído ou desativado e ninguém herdou as missões. */
    var atribuiveis = {};
    militaresAtribuiveis(militares).forEach(function (m) { atribuiveis[m.id] = true; });
    var orfas = atividades.filter(function (a) {
      if (!a || a.ativa === false) { return false; }
      return !(a.responsaveis || []).some(function (id) { return atribuiveis[id]; });
    });
    if (orfas.length) {
      var exemplos = orfas.slice(0, 3).map(function (a) { return '"' + a.titulo + '"'; });
      alertas.push({
        nivel: 'atencao',
        titulo: orfas.length === 1 ? '1 atividade sem responsável'
          : orfas.length + ' atividades sem responsável',
        texto: 'Atividades ativas sem nenhum militar ativo como responsável: ' + juntarNomes(exemplos) +
          (orfas.length > 3 ? ' e mais ' + (orfas.length - 3) : '') +
          '. Ninguém será cobrado por elas até que um responsável seja definido.',
        link: '#/atividades'
      });
    }

    /* (d) sem feriados do ano seguinte, os prazos de janeiro caem em feriado. */
    if (hoje.slice(5) >= '11-01') {
      var proximoAno = anoDe(hoje) + 1;
      var temFeriado = listaDeFeriados(dados.feriados).some(function (data) {
        return anoDe(data) === proximoAno;
      });
      if (!temFeriado) {
        alertas.push({
          nivel: 'atencao',
          titulo: 'Cadastre os feriados de ' + proximoAno,
          texto: 'Não há nenhum feriado de ' + proximoAno + ' cadastrado. Sem eles, os prazos que caírem ' +
            'em feriados não serão antecipados para o dia útil anterior.',
          link: '#/equipe?aba=feriados'
        });
      }
    }

    /* (e) backup periódico: a cópia fora do Supabase é o seguro contra perda. */
    var backup = config.ultimo_backup;
    var dataBackup = backup && backup.em ? dataBelem(backup.em) : null;
    if (!dataBackup) {
      alertas.push({
        nivel: 'atencao',
        titulo: 'Nenhuma cópia de segurança registrada',
        texto: 'Ainda não foi feita nenhuma exportação completa dos dados. Use "Exportar tudo" ' +
          'em Equipe → Continuidade e guarde o arquivo na pasta da AQS.',
        link: '#/equipe?aba=continuidade'
      });
    } else {
      var diasBackup = diasEntre(dataBackup, hoje);
      if (diasBackup > DIAS_ALERTA_BACKUP) {
        alertas.push({
          nivel: 'atencao',
          titulo: 'Cópia de segurança desatualizada',
          texto: 'A última exportação completa foi há ' + diasBackup + ' dias (' + formatarData(dataBackup) +
            (backup.por_nome ? ', por ' + backup.por_nome : '') + '). Faça uma nova em Equipe → Continuidade ' +
            'e guarde o arquivo na pasta da AQS.',
          link: '#/equipe?aba=continuidade'
        });
      }
    }

    /* (f) contatos institucionais: a quem recorrer quando ninguém souber. */
    var contatos = config.contatos || {};
    var faltando = [];
    if (!String(contatos.email_institucional || '').trim()) { faltando.push('e-mail institucional'); }
    if (!String(contatos.responsavel_tecnico || '').trim()) { faltando.push('responsável técnico'); }
    if (!String(contatos.telefone || '').trim()) { faltando.push('telefone/ramal'); }
    if (faltando.length) {
      alertas.push({
        nivel: 'info',
        titulo: 'Contatos institucionais incompletos',
        texto: 'Preencha ' + juntarNomes(faltando) + ' em Equipe → Continuidade. É o que orienta ' +
          'quem assumir a ferramenta no futuro.',
        link: '#/equipe?aba=continuidade'
      });
    }

    /* (g) acesso esquecido: quem saiu do setor e continua com login. */
    var esquecidos = militares.filter(function (m) {
      if (!m || m.ativo === false || !m.usuario_id) { return false; }
      var referencia = dataBelem(m.ultimo_acesso || m.criado_em);
      var dias = referencia ? diasEntre(referencia, hoje) : null;
      return dias !== null && dias > DIAS_ALERTA_SEM_ACESSO;
    });
    if (esquecidos.length) {
      alertas.push({
        nivel: 'info',
        titulo: esquecidos.length === 1 ? '1 acesso sem uso há mais de ' + DIAS_ALERTA_SEM_ACESSO + ' dias'
          : esquecidos.length + ' acessos sem uso há mais de ' + DIAS_ALERTA_SEM_ACESSO + ' dias',
        texto: juntarNomes(esquecidos.map(nomeMilitar)) + (esquecidos.length === 1 ? ' não entra' : ' não entram') +
          ' há mais de ' + DIAS_ALERTA_SEM_ACESSO + ' dias. Se não fazem mais parte da equipe, ' +
          'desative ou exclua o acesso.',
        link: '#/equipe?aba=militares'
      });
    }

    alertas.sort(function (a, b) { return PESO_NIVEL[a.nivel] - PESO_NIVEL[b.nivel]; });
    return alertas;
  }

  /* ---------- descrições ---------- */

  function nomeMes(mes) {
    return MESES_EXTENSO[(Number(mes) || 1) - 1] || '';
  }

  /* Meses do ciclo a partir do mês de início: trimestral 1 → jan, abr, jul e out. */
  function mesesDoCiclo(mesInicio, intervalo) {
    var meses = [];
    for (var mes = 1; mes <= 12; mes += 1) {
      if (((mes - mesInicio) % intervalo + intervalo) % intervalo === 0) { meses.push(MESES_ABREV[mes - 1]); }
    }
    return juntarNomes(meses);
  }

  /* 'Mensal, até o dia 15 (antecipa se não for dia útil)', 'Semanal, às
     sextas-feiras', 'Diária (dias úteis)', 'Pontual — prazo 30/10/2026'… */
  function descreverRegra(atividade) {
    if (!atividade) { return ''; }
    if (atividade.tipo === 'sob_demanda') { return 'Sob demanda'; }
    if (atividade.tipo === 'pontual') {
      return atividade.prazo ? 'Pontual — prazo ' + formatarData(atividade.prazo) : 'Pontual — sem prazo definido';
    }

    var antecipa = atividade.antecipar_dia_util !== false;
    var p = atividade.periodicidade;
    if (p === 'diaria_util') { return 'Diária (dias úteis)'; }

    if (p === 'semanal') {
      var ds = Number(atividade.dia_semana);
      var texto = 'Semanal' + (DIAS_SEMANA_PLURAL[ds] ? ', ' + DIAS_SEMANA_PLURAL[ds] : '');
      return texto + (antecipa ? ' (antecipa se não for dia útil)' : '');
    }

    if (p === 'mensal' || p === 'trimestral' || p === 'semestral' || p === 'anual') {
      var dm = Number(atividade.dia_mes);
      var mi = Number(atividade.mes_inicio) || 1;
      var base;
      if (p === 'mensal') { base = 'Mensal'; }
      else if (p === 'trimestral') { base = 'Trimestral (' + mesesDoCiclo(mi, 3) + ')'; }
      else if (p === 'semestral') { base = 'Semestral (' + mesesDoCiclo(mi, 6) + ')'; }
      else { base = 'Anual, em ' + nomeMes(mi); }

      if (dm >= 31) {
        return base + ', até o último dia do mês' + (antecipa ? ' (último dia útil)' : '');
      }
      return base + (dm ? ', até o dia ' + dm : '') + (antecipa ? ' (antecipa se não for dia útil)' : '');
    }

    return temPropria(ROTULOS.tipo, atividade.tipo) ? ROTULOS.tipo[atividade.tipo] : '—';
  }

  /* 'Out/2026', 'Semana 42/2026', '15/10/2026', 'Trimestre de out/2026',
     'Semestre de jul/2026', 'Ano 2027', 'Única'; sob demanda: o título da
     execução ou a data. Aceita a ocorrência ou só o texto da referência. */
  function rotuloReferencia(oc) {
    var ref = (typeof oc === 'string') ? oc : (oc && oc.referencia);
    var m;
    if (ref) {
      if (ref === 'P') { return 'Única'; }
      if ((m = /^D(\d{4}-\d{2}-\d{2})$/.exec(ref))) { return formatarData(m[1]); }
      if ((m = /^S(\d{4})-W(\d{2})$/.exec(ref))) { return 'Semana ' + m[2] + '/' + m[1]; }
      if ((m = /^([MTHA])(\d{4})-(\d{2})$/.exec(ref))) {
        var abrev = MESES_ABREV[Number(m[3]) - 1] || m[3];
        if (m[1] === 'M') { return abrev.charAt(0).toUpperCase() + abrev.slice(1) + '/' + m[2]; }
        if (m[1] === 'T') { return 'Trimestre de ' + abrev + '/' + m[2]; }
        if (m[1] === 'H') { return 'Semestre de ' + abrev + '/' + m[2]; }
        return 'Ano ' + m[2];
      }
      return String(ref);
    }
    if (!oc || typeof oc !== 'object') { return 'Execução'; }
    var titulo = String(oc.titulo_execucao || '').trim();
    if (titulo) { return titulo; }
    var data = oc.data_ref || oc.prazo || dataBelem(oc.criado_em);
    return data ? 'Execução de ' + formatarData(data) : 'Execução';
  }

  /* ---------- selos (classes de aqs.css) ---------- */

  /* Valor desconhecido nunca vira classe: evita injeção de classe/atributo. */
  function selo(grupo, prefixoClasse, valor) {
    var rotulos = ROTULOS[grupo];
    if (typeof valor !== 'string' || !temPropria(rotulos, valor)) {
      return '<span class="selo selo--neutro">' + esc(valor || '—') + '</span>';
    }
    return '<span class="selo selo--' + prefixoClasse + valor + '">' + esc(rotulos[valor]) + '</span>';
  }

  function seloStatus(status) { return selo('status', '', status); }
  function seloPrioridade(prioridade) { return selo('prioridade', 'prio-', prioridade); }
  function seloNivel(nivel) { return selo('nivel', 'nivel-', nivel); }
  function seloTipo(tipo) { return selo('tipo', 'tipo-', tipo); }

  return {
    ROTULOS: ROTULOS,
    STATUS_ABERTOS: STATUS_ABERTOS,
    MENSAGEM_TRAVA: MENSAGEM_TRAVA,
    TIPOS_ARQUIVO: TIPOS_ARQUIVO,
    ACCEPT: ACCEPT,
    validarArquivo: validarArquivo,
    validarSenha: validarSenha,
    validarEmail: validarEmail,
    mimeDe: mimeDe,
    extensaoDe: extensaoDe,
    nomeMilitar: nomeMilitar,
    nomesResponsaveis: nomesResponsaveis,
    eAtivo: eAtivo,
    eChefia: eChefia,
    eAdministrador: eAdministrador,
    eGestor: eGestor,
    eResponsavel: eResponsavel,
    eGestorComAcesso: eGestorComAcesso,
    gestoresComAcesso: gestoresComAcesso,
    violaTravaGestor: violaTravaGestor,
    militaresAtribuiveis: militaresAtribuiveis,
    rotuloPapelAutor: rotuloPapelAutor,
    podeEditarAtividade: podeEditarAtividade,
    podeCriarAtividade: podeCriarAtividade,
    tiposPermitidos: tiposPermitidos,
    podeAlterarResponsaveis: podeAlterarResponsaveis,
    podeExcluirAtividade: podeExcluirAtividade,
    podeAtualizarOcorrencia: podeAtualizarOcorrencia,
    podeAlterarPrazoOcorrencia: podeAlterarPrazoOcorrencia,
    podeExcluirOcorrencia: podeExcluirOcorrencia,
    podeRegistrarExecucao: podeRegistrarExecucao,
    podeEnviarEvidencia: podeEnviarEvidencia,
    podeExcluirEvidencia: podeExcluirEvidencia,
    podeComentar: podeComentar,
    podeExcluirComentario: podeExcluirComentario,
    podePublicarAviso: podePublicarAviso,
    podeVerAviso: podeVerAviso,
    podeGerenciarEquipe: podeGerenciarEquipe,
    podeVerAuditoria: podeVerAuditoria,
    podeGerenciarUsuarios: podeGerenciarUsuarios,
    podeGerenciarMilitar: podeGerenciarMilitar,
    podeExcluirMilitar: podeExcluirMilitar,
    podeDesativarMilitar: podeDesativarMilitar,
    podeAssumirChefia: podeAssumirChefia,
    alertasContinuidade: alertasContinuidade,
    estaAberta: estaAberta,
    estaAtrasada: estaAtrasada,
    statusEfetivo: statusEfetivo,
    concluidaNoPrazo: concluidaNoPrazo,
    conformidade: conformidade,
    descreverRegra: descreverRegra,
    rotuloReferencia: rotuloReferencia,
    dataBelem: dataBelem,
    hojeBelem: hojeBelem,
    diasEntre: diasEntre,
    seloStatus: seloStatus,
    seloPrioridade: seloPrioridade,
    seloNivel: seloNivel,
    seloTipo: seloTipo
  };
})();
