/* =========================================================================
   HABE – AQS e NSP — regras compartilhadas (funções puras)
   Usadas pelas telas (o que mostrar, que botão habilitar) e pela
   demonstração (ApiDemo), que imita o banco com elas. As permissões aqui
   são o ESPELHO das políticas RLS e das RPCs do banco (ARQUITETURA §3):
   na tela elas só escondem o que não pode ser feito; quem barra de verdade
   é sempre o banco. Mudou uma política? Mude aqui também.
   Ver docs/ARQUITETURA.md, seção 5.

   Não toca em document nem em window ao carregar: o arquivo também roda
   no Node (testes/regras.mjs), dentro de um vm.
   ========================================================================= */

/* Registro das páginas: cada paginas/*.js acrescenta Paginas.<rota>.
   Declarado aqui porque regras.js é carregado antes de todas elas. */
var Paginas = (typeof window !== 'undefined' && window.Paginas) || {};

var Regras = (function () {
  'use strict';

  var FUSO = 'America/Belem';

  /* ---------- rótulos ---------- */

  var ROTULOS = {
    papel: { chefia: 'Chefia', adjunto: 'Adjunto' },
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

  var MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  var MESES_EXTENSO = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
                       'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  var DIAS_SEMANA_PLURAL = ['', 'às segundas-feiras', 'às terças-feiras', 'às quartas-feiras',
                            'às quintas-feiras', 'às sextas-feiras', 'aos sábados', 'aos domingos'];

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

  var ACCEPT = Object.keys(TIPOS_ARQUIVO).map(function (ext) { return '.' + ext; }).join(',');

  var LIMITE_PADRAO_MB = 20;

  /* ---------- auxiliares ---------- */

  function esc(valor) {
    if (valor === null || valor === undefined) { return ''; }
    return String(valor)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function doisDigitos(n) { return (n < 10 ? '0' : '') + n; }

  function contem(lista, valor) {
    return Array.isArray(lista) && lista.indexOf(valor) >= 0;
  }

  function formatarData(texto) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(texto || ''));
    return m ? m[3] + '/' + m[2] + '/' + m[1] : '—';
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
    if (!ext || !TIPOS_ARQUIVO.hasOwnProperty(ext)) {
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

  /* Tipo MIME do arquivo. Quando a extensão é conhecida, vale o tipo da
     lista: navegadores mandam vazio, 'application/octet-stream' ou variantes
     ('text/x-csv', 'application/vnd.ms-excel' para .csv) que o bucket
     recusaria, e o tipo canônico também é o que volta no download. */
  function mimeDe(arquivo) {
    if (!arquivo) { return 'application/octet-stream'; }
    var ext = extensaoDe(arquivo.name);
    if (ext && TIPOS_ARQUIVO.hasOwnProperty(ext)) { return TIPOS_ARQUIVO[ext]; }
    return arquivo.type || 'application/octet-stream';
  }

  /* ---------- militares ---------- */

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
      return mapa[id] ? nomeMilitar(mapa[id]) : 'Militar não encontrado';
    });
    return nomes.length ? nomes.join(', ') : 'Sem responsável';
  }

  /* "ativo" das políticas RLS: desativar corta o acesso na hora. */
  function eAtivo(m) {
    return !!(m && m.id && m.ativo !== false);
  }

  function eChefia(m) {
    return eAtivo(m) && m.papel === 'chefia';
  }

  /* atividadeOuOcorrencia precisa trazer .responsaveis (listarAtividades e
     v_ocorrencias trazem). */
  function eResponsavel(m, atividadeOuOcorrencia) {
    return eAtivo(m) && !!atividadeOuOcorrencia && contem(atividadeOuOcorrencia.responsaveis, m.id);
  }

  /* ---------- permissões (espelho da RLS e das RPCs) ---------- */

  /* salvar_atividade: chefia edita tudo; adjunto, só as suas. */
  function podeEditarAtividade(m, atividade) {
    return eChefia(m) || eResponsavel(m, atividade);
  }

  /* salvar_atividade: adjunto cria só pontual ou sob demanda (e precisa se
     incluir como responsável — conferido no envio). Sem tipo: pode criar algo? */
  function podeCriarAtividade(m, tipo) {
    if (eChefia(m)) { return true; }
    if (!eAtivo(m)) { return false; }
    if (tipo === undefined || tipo === null || tipo === '') { return true; }
    return tipo === 'pontual' || tipo === 'sob_demanda';
  }

  function podeAlterarResponsaveis(m) {
    return eChefia(m);
  }

  function podeExcluirAtividade(m) {
    return eChefia(m);
  }

  /* ocorrencias UPDATE: chefia ou responsável. */
  function podeAtualizarOcorrencia(m, ocorrencia) {
    return eChefia(m) || eResponsavel(m, ocorrencia);
  }

  /* O gatilho impede que não-chefia mude atividade_id, referencia e prazo. */
  function podeAlterarPrazoOcorrencia(m) {
    return eChefia(m);
  }

  function podeExcluirOcorrencia(m) {
    return eChefia(m);
  }

  /* ocorrencias INSERT: chefia; ou responsável quando a atividade é sob demanda. */
  function podeRegistrarExecucao(m, atividade) {
    if (eChefia(m)) { return true; }
    return !!atividade && atividade.tipo === 'sob_demanda' && eResponsavel(m, atividade);
  }

  /* evidencias INSERT (e Storage INSERT): chefia ou responsável pela atividade. */
  function podeEnviarEvidencia(m, atividade) {
    return eChefia(m) || eResponsavel(m, atividade);
  }

  /* evidencias DELETE: chefia ou quem enviou. */
  function podeExcluirEvidencia(m, evidencia) {
    if (eChefia(m)) { return true; }
    return eAtivo(m) && !!evidencia && evidencia.enviado_por === m.id;
  }

  /* comentarios INSERT: qualquer ativo (como autor). */
  function podeComentar(m) {
    return eAtivo(m);
  }

  /* comentarios DELETE: autor ou chefia. */
  function podeExcluirComentario(m, comentario) {
    if (eChefia(m)) { return true; }
    return eAtivo(m) && !!comentario && comentario.autor_id === m.id;
  }

  function podePublicarAviso(m) {
    return eChefia(m);
  }

  /* avisos SELECT: chefia, para_todos, ou sou destinatário. */
  function podeVerAviso(m, aviso) {
    if (!eAtivo(m) || !aviso) { return false; }
    if (eChefia(m) || aviso.para_todos) { return true; }
    return contem(aviso.destinatarios, m.id);
  }

  /* setores, feriados, militares (escrita) e auditoria: só a chefia. */
  function podeGerenciarEquipe(m) {
    return eChefia(m);
  }

  function podeVerAuditoria(m) {
    return eChefia(m);
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

  /* ---------- descrições ---------- */

  function nomeMes(mes) {
    return MESES_EXTENSO[(Number(mes) || 1) - 1] || '';
  }

  /* Meses do ciclo a partir do mês de início: trimestral 1 → jan, abr, jul, out. */
  function mesesDoCiclo(mesInicio, intervalo) {
    var meses = [];
    for (var mes = 1; mes <= 12; mes += 1) {
      if ((mes - mesInicio) % intervalo === 0) { meses.push(MESES_ABREV[mes - 1]); }
    }
    if (meses.length <= 1) { return meses.join(''); }
    return meses.slice(0, -1).join(', ') + ' e ' + meses[meses.length - 1];
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

    return ROTULOS.tipo[atividade.tipo] || '—';
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
    if (!rotulos.hasOwnProperty(valor)) {
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
    TIPOS_ARQUIVO: TIPOS_ARQUIVO,
    ACCEPT: ACCEPT,
    validarArquivo: validarArquivo,
    validarSenha: validarSenha,
    mimeDe: mimeDe,
    extensaoDe: extensaoDe,
    nomeMilitar: nomeMilitar,
    nomesResponsaveis: nomesResponsaveis,
    eAtivo: eAtivo,
    eChefia: eChefia,
    eResponsavel: eResponsavel,
    podeEditarAtividade: podeEditarAtividade,
    podeCriarAtividade: podeCriarAtividade,
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
    estaAberta: estaAberta,
    estaAtrasada: estaAtrasada,
    statusEfetivo: statusEfetivo,
    concluidaNoPrazo: concluidaNoPrazo,
    conformidade: conformidade,
    descreverRegra: descreverRegra,
    rotuloReferencia: rotuloReferencia,
    dataBelem: dataBelem,
    hojeBelem: hojeBelem,
    seloStatus: seloStatus,
    seloPrioridade: seloPrioridade,
    seloNivel: seloNivel,
    seloTipo: seloTipo
  };
})();
