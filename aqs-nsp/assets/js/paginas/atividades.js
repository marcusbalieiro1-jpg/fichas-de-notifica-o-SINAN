/* =========================================================================
   HABE – AQS e NSP — Atividades: lista e formulário
   Paginas.atividades: a lista de todas as atividades (o "cadastro" do que a
     equipe faz), com busca, filtros por tipo, responsável e setor e o
     próximo prazo em aberto de cada uma. Tabela no computador, cartões no
     celular. Clicar abre o detalhe (Detalhe.abrirAtividade).
   FormAtividade.abrir(atividade | null, valoresIniciais?, opcoes?): o
     formulário de criação/edição, num painel largo. É usado também pelo
     detalhe ("Editar") e pelos avisos ("Criar missão a partir deste
     aviso"). opcoes.voltar(id): chamada depois de salvar, arquivar,
     reativar ou cancelar (não depois de excluir) — o Detalhe a usa para
     reabrir a atividade, devolvendo o militar ao ponto onde estava.

   As permissões vêm de Regras (espelho do RPC salvar_atividade e da RLS):
   o adjunto cria só atividades pontuais ou sob demanda em que ele mesmo é
   responsável e, ao editar, não mexe nos responsáveis. Aqui isso só
   orienta a tela — quem recusa de verdade é o banco.
   Ver docs/ARQUITETURA.md, seções 3, 4, 5 e 6.
   ========================================================================= */

var FormAtividade = (function () {
  'use strict';

  var MIN_TITULO = 3;
  var MAX_TITULO = 200;
  var MAX_DESCRICAO = 10000;
  var MAX_ORDEM = 99999;
  var QTD_PREVIA = 5;

  var PERIODICIDADES = ['diaria_util', 'semanal', 'mensal', 'trimestral', 'semestral', 'anual'];
  var COM_DIA_MES = ['mensal', 'trimestral', 'semestral', 'anual'];
  var INTERVALO_CICLO = { trimestral: 3, semestral: 6, anual: 12 };
  var PRIORIDADES = ['baixa', 'normal', 'alta', 'urgente'];

  /* Os três tipos, como opções grandes: o rótulo sozinho não explica a
     diferença para quem cadastra pela primeira vez. */
  var TIPOS = [
    { valor: 'recorrente', icone: 'recarregar', titulo: 'Recorrente',
      texto: 'Repete-se sozinha (diária, semanal, mensal…). O sistema cria cada prazo automaticamente.' },
    { valor: 'sob_demanda', icone: 'caixa', titulo: 'Sob demanda',
      texto: 'Feita quando surge a necessidade (ex.: cada notificação recebida). Cada execução é registrada na hora.' },
    { valor: 'pontual', icone: 'missao', titulo: 'Pontual',
      texto: 'Uma entrega única, com prazo (ex.: revisar um protocolo).' }
  ];

  /* Dia da semana ISO (1 = segunda … 7 = domingo), como no banco. */
  var DIAS_ISO = ['', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira',
                  'sábado', 'domingo'];

  /* Cada abertura ganha um número: respostas que chegam depois de o
     painel ter sido fechado ou trocado são descartadas. */
  var seq = 0;

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

  function opcao(valor, rotulo, selecionado) {
    return '<option value="' + U.esc(valor) + '"' + (selecionado ? ' selected' : '') + '>' + U.esc(rotulo) + '</option>';
  }

  function maiuscula(texto) {
    texto = String(texto || '');
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }

  function juntarNomes(nomes) {
    if (nomes.length <= 1) { return nomes.join(''); }
    return nomes.slice(0, -1).join(', ') + ' e ' + nomes[nomes.length - 1];
  }

  /* 'sexta-feira, 16/10/2026' (aritmética de calendário, sem fuso). */
  function dataLonga(data) {
    var ds = Recorrencia.diaSemana(data);
    return (ds ? DIAS_ISO[ds] + ', ' : '') + U.formatarData(data);
  }

  function inteiro(valor) {
    var n = Number(valor);
    return (valor === '' || valor === null || valor === undefined || !isFinite(n)) ? null : Math.floor(n);
  }

  /* Nome do feriado cadastrado numa data (para explicar a antecipação). */
  function nomeFeriado(ctx, data) {
    var f = achar(ctx.ref.listaFeriados || [], function (x) { return x && x.data === data; });
    return f ? f.descricao : null;
  }

  /* Por que um dia não é útil: o feriado ou o dia da semana. */
  function motivoNaoUtil(ctx, data) {
    var feriado = nomeFeriado(ctx, data);
    if (feriado) { return 'feriado: ' + feriado; }
    return DIAS_ISO[Recorrencia.diaSemana(data)] || 'dia não útil';
  }

  function mesesDoCiclo(mesInicio, intervalo) {
    var meses = [];
    for (var mes = 1; mes <= 12; mes += 1) {
      if (((mes - mesInicio) % intervalo + intervalo) % intervalo === 0) { meses.push(U.MESES[mes - 1]); }
    }
    return meses;
  }

  /* ---------- valores iniciais ---------- */

  /* Campos do formulário a partir da atividade (edição), dos valores
     iniciais (ex.: aviso → missão) ou dos padrões. Os campos de regra que
     não se aplicam ao tipo atual ganham padrões sensatos, para que trocar o
     tipo no formulário já mostre algo preenchido. */
  function valoresBase(ctx, iniciais) {
    var hoje = ctx.hoje;
    var eu = ctx.eu;
    var setorDoMilitar = (eu.setor_id && temPropria(ctx.ref.mapaSetores, eu.setor_id)) ? eu.setor_id : null;
    var b = {
      titulo: '', descricao: '', setor_id: setorDoMilitar, ordem: null,
      tipo: ctx.gestor ? null : 'pontual',
      periodicidade: 'mensal', dia_semana: 5, dia_mes: 31, mes_inicio: Number(hoje.slice(5, 7)),
      prazo: null, antecipar_dia_util: true, prioridade: 'normal', exige_evidencia: false,
      data_inicio: hoje, responsaveis: ctx.gestor ? [] : [eu.id], ativa: true
    };
    var a = ctx.existente;
    if (a) {
      ['titulo', 'descricao', 'setor_id', 'ordem', 'tipo', 'prazo', 'prioridade', 'data_inicio'].forEach(function (k) {
        if (a[k] !== null && a[k] !== undefined) { b[k] = a[k]; }
      });
      if (a.setor_id === null) { b.setor_id = null; }
      if (a.periodicidade) { b.periodicidade = a.periodicidade; }
      if (a.dia_semana) { b.dia_semana = Number(a.dia_semana); }
      if (a.dia_mes) { b.dia_mes = Number(a.dia_mes); }
      if (a.mes_inicio) { b.mes_inicio = Number(a.mes_inicio); }
      b.antecipar_dia_util = a.antecipar_dia_util !== false;
      b.exige_evidencia = !!a.exige_evidencia;
      b.ativa = a.ativa !== false;
      b.responsaveis = (a.responsaveis || []).slice();
      return b;
    }
    iniciais = iniciais || {};
    ['titulo', 'descricao', 'prazo', 'data_inicio'].forEach(function (k) {
      if (typeof iniciais[k] === 'string') { b[k] = iniciais[k]; }
    });
    if (temPropria(iniciais, 'setor_id')) { b.setor_id = iniciais.setor_id || null; }
    if (contem(['recorrente', 'pontual', 'sob_demanda'], iniciais.tipo) && contem(ctx.tipos, iniciais.tipo)) {
      b.tipo = iniciais.tipo;
    }
    if (contem(PERIODICIDADES, iniciais.periodicidade)) { b.periodicidade = iniciais.periodicidade; }
    if (contem(PRIORIDADES, iniciais.prioridade)) { b.prioridade = iniciais.prioridade; }
    if (typeof iniciais.exige_evidencia === 'boolean') { b.exige_evidencia = iniciais.exige_evidencia; }
    if (Array.isArray(iniciais.responsaveis) && ctx.gestor) { b.responsaveis = iniciais.responsaveis.slice(); }
    if (b.prazo && !Recorrencia.dataValida(b.prazo)) { b.prazo = null; }
    if (!Recorrencia.dataValida(b.data_inicio)) { b.data_inicio = hoje; }
    return b;
  }

  /* ---------- HTML do formulário ---------- */

  function campoHtml(id, rotuloHtml, controleHtml, dicaHtml, classeExtra) {
    return '<div class="campo' + (classeExtra ? ' ' + classeExtra : '') + '" id="' + id + 'Campo">' +
      '<label for="' + id + '">' + rotuloHtml + '</label>' +
      controleHtml +
      (dicaHtml !== null ? '<span class="campo__dica" id="' + id + 'Dica">' + dicaHtml + '</span>' : '') +
      '<div class="campo__erro" id="' + id + 'Erro" role="alert"></div>' +
    '</div>';
  }

  function tiposHtml(ctx, b) {
    var bloqueadoTipo = function (valor) { return !contem(ctx.tipos, valor); };
    /* Tipo que o militar não pode escolher nem aparece (o adjunto não vê
       "Recorrente" ao criar). Exceção: o tipo atual da atividade, se por
       algum motivo não for permitido, fica visível e travado — sem ele o
       formulário não mostraria o que está gravado. */
    var html = TIPOS.filter(function (t) {
      return !bloqueadoTipo(t.valor) || b.tipo === t.valor;
    }).map(function (t) {
      var desabilitado = bloqueadoTipo(t.valor);
      return '<label class="opcao opcao--tipo' + (desabilitado ? ' opcao--desabilitada' : '') + '">' +
        '<input type="radio" name="faTipo" value="' + t.valor + '"' + (b.tipo === t.valor ? ' checked' : '') +
          (desabilitado ? ' disabled' : '') + '>' +
        '<span class="opcao__icone">' + icone(t.icone) + '</span>' +
        '<span class="opcao__texto"><strong>' + U.esc(t.titulo) + '</strong><small>' + U.esc(t.texto) + '</small></span>' +
      '</label>';
    }).join('');
    var nota = '';
    if (!ctx.gestor && bloqueadoTipo('recorrente')) {
      nota = '<p class="campo__dica mt-1">Atividades recorrentes são definidas pela chefia. Você pode criar ' +
        'atividades pontuais ou sob demanda em que seja responsável.</p>';
    }
    return '<fieldset class="campo campo--grupo" id="faTipoCampo">' +
      '<legend>Tipo <span class="obrigatorio">*</span></legend>' +
      '<div class="opcoes opcoes--tipo">' + html + '</div>' + nota +
      '<div class="campo__erro" id="faTipoErro" role="alert"></div>' +
    '</fieldset>';
  }

  function regraRecorrenteHtml(b) {
    var periodicidades = PERIODICIDADES.map(function (p) {
      return opcao(p, Regras.ROTULOS.periodicidade[p], b.periodicidade === p);
    }).join('');
    var dias = '';
    for (var d = 1; d <= 7; d += 1) { dias += opcao(String(d), maiuscula(DIAS_ISO[d]), Number(b.dia_semana) === d); }
    var diasMes = '';
    for (var dm = 1; dm <= 30; dm += 1) { diasMes += opcao(String(dm), 'Dia ' + dm, Number(b.dia_mes) === dm); }
    diasMes += opcao('31', 'Último dia do mês', Number(b.dia_mes) >= 31);
    var meses = U.MESES.map(function (nome, i) { return opcao(String(i + 1), maiuscula(nome), Number(b.mes_inicio) === i + 1); }).join('');

    return '<div class="form-atividade__bloco" id="faBlocoRecorrente">' +
      '<h3 class="form-atividade__subtitulo">' + icone('recarregar') + 'Regra de repetição</h3>' +
      '<div class="grade-form">' +
        campoHtml('faPeriodicidade', 'Periodicidade <span class="obrigatorio">*</span>',
          '<select id="faPeriodicidade">' + periodicidades + '</select>', '') +
        campoHtml('faDiaSemana', 'Dia da semana <span class="obrigatorio">*</span>',
          '<select id="faDiaSemana">' + dias + '</select>', 'O prazo de cada semana cai neste dia.') +
        campoHtml('faDiaMes', 'Até o dia <span class="obrigatorio">*</span>',
          '<select id="faDiaMes">' + diasMes + '</select>', '') +
        campoHtml('faMesInicio', 'Mês de início do ciclo <span class="obrigatorio">*</span>',
          '<select id="faMesInicio">' + meses + '</select>', '') +
        campoHtml('faDataInicio', 'Gera prazos a partir de <span class="obrigatorio">*</span>',
          '<input type="date" id="faDataInicio" value="' + U.esc(b.data_inicio || '') + '">',
          'Nenhum prazo anterior a esta data é criado.') +
      '</div>' +
      '<label class="marcar marcar--linha" id="faAnteciparCampo">' +
        '<input type="checkbox" id="faAntecipar"' + (b.antecipar_dia_util ? ' checked' : '') + '>' +
        '<span class="marcar__texto"><strong>Se cair em fim de semana ou feriado, antecipar para o dia útil anterior</strong>' +
          '<small>Recomendado: o prazo nunca vence num dia em que ninguém está no setor.</small></span>' +
      '</label>' +
    '</div>';
  }

  function regraPontualHtml(b) {
    return '<div class="form-atividade__bloco" id="faBlocoPontual">' +
      '<h3 class="form-atividade__subtitulo">' + icone('missao') + 'Prazo da entrega</h3>' +
      campoHtml('faPrazo', 'Prazo', '<input type="date" id="faPrazo" value="' + U.esc(b.prazo || '') + '">',
        'Deixe em branco se ainda não houver prazo definido.', 'campo--estreito') +
    '</div>';
  }

  function regraSobDemandaHtml() {
    return '<div class="form-atividade__bloco" id="faBlocoDemanda">' +
      '<h3 class="form-atividade__subtitulo">' + icone('caixa') + 'Como funciona</h3>' +
      '<p class="texto-pequeno mb-0">Não há prazos automáticos. Cada vez que a demanda surgir, o responsável usa ' +
        '<strong>"Registrar execução"</strong> no detalhe da atividade, com um título (ex.: "Notificação 2026/041"), ' +
        'a data e as evidências.</p>' +
    '</div>';
  }

  function prioridadeHtml(b) {
    return '<fieldset class="campo campo--grupo" id="faPrioridadeCampo">' +
      '<legend>Prioridade</legend>' +
      '<div class="pilulas">' + PRIORIDADES.map(function (p) {
        return '<label class="pilula pilula--' + p + '"><input type="radio" name="faPrioridade" value="' + p + '"' +
          (b.prioridade === p ? ' checked' : '') + '><span>' + U.esc(Regras.ROTULOS.prioridade[p]) + '</span></label>';
      }).join('') + '</div>' +
    '</fieldset>';
  }

  /* Responsáveis: os militares que recebem missões (ativos, sem a conta
     institucional) e, se a atividade já tiver, também quem foi desativado
     depois — aparece marcado, para não sumir calado ao salvar. */
  function responsaveisHtml(ctx, b) {
    var eu = ctx.eu;
    var mapa = ctx.ref.mapaMilitares || {};
    var lista = Regras.militaresAtribuiveis(ctx.ref.militares).slice();
    b.responsaveis.forEach(function (id) {
      if (!achar(lista, function (m) { return m.id === id; }) && temPropria(mapa, id)) { lista.push(mapa[id]); }
    });
    lista.sort(function (a, c) { return U.ordenarTexto(Regras.nomeMilitar(a), Regras.nomeMilitar(c)); });

    var nota = '';
    if (ctx.travaResp) {
      nota = '<div class="aviso aviso--atencao mt-1"><span class="aviso__icone">' + icone('cadeado') + '</span><div>' +
        'Somente a chefia altera os responsáveis de uma atividade. Se for preciso incluir ou retirar alguém, ' +
        'peça à chefia ou à AQS.</div></div>';
    } else if (ctx.adjuntoCriando) {
      nota = '<p class="campo__dica mt-1">Você fica como responsável pela atividade que criar. Pode incluir colegas também.</p>';
    }

    var itens = lista.map(function (m) {
      var marcado = contem(b.responsaveis, m.id);
      var euMesmo = m.id === eu.id;
      var travado = ctx.travaResp || (ctx.adjuntoCriando && euMesmo);
      var setor = m.setor_id && temPropria(ctx.ref.mapaSetores, m.setor_id) ? ctx.ref.mapaSetores[m.setor_id].sigla : '';
      var extras = [];
      if (setor) { extras.push(setor); }
      extras.push(Regras.ROTULOS.papel[m.papel] || m.papel);
      if (m.ativo === false) { extras.push('desativado'); }
      if (m.papel === 'administrador') { extras.push('não recebe missões'); }
      return '<label class="marcar' + (travado ? ' marcar--travado' : '') + (m.ativo === false ? ' marcar--inativo' : '') + '">' +
        '<input type="checkbox" name="faResponsavel" value="' + U.esc(m.id) + '"' + (marcado ? ' checked' : '') +
          (travado ? ' disabled' : '') + '>' +
        '<span class="marcar__texto"><strong>' + U.esc(Regras.nomeMilitar(m)) + (euMesmo ? ' <em>(você)</em>' : '') + '</strong>' +
          '<small>' + U.esc(extras.join(' · ')) + '</small></span>' +
      '</label>';
    }).join('');

    if (!lista.length) {
      itens = '<p class="texto-suave texto-pequeno mb-0">Nenhum militar ativo cadastrado para receber missões. ' +
        'Cadastre a equipe em <a href="#/equipe">Equipe</a>.</p>';
    }

    return '<fieldset class="campo campo--grupo" id="faResponsaveisCampo">' +
      '<legend>Responsáveis <span class="obrigatorio">*</span></legend>' +
      '<div class="lista-marcar">' + itens + '</div>' + nota +
      '<div class="campo__erro" id="faResponsaveisErro" role="alert"></div>' +
    '</fieldset>';
  }

  function formularioHtml(ctx, b) {
    var a = ctx.existente;
    var setores = '<option value="">Sem setor</option>' + (ctx.ref.setores || []).map(function (s) {
      return opcao(s.id, s.sigla + ' — ' + s.nome, b.setor_id === s.id);
    }).join('');
    var proximoNumero = (ctx.atividades || []).reduce(function (max, x) { return Math.max(max, Number(x.ordem) || 0); }, 0) + 1;

    var topo = '';
    if (a && a.ativa === false) {
      topo = '<div class="aviso aviso--atencao"><span class="aviso__icone">' + icone('caixa') + '</span><div>' +
        '<strong>Atividade arquivada</strong>Ela não gera novas ocorrências e não aparece nas listas de trabalho. ' +
        (ctx.gestor ? 'Use "Reativar", no rodapé, para voltar a cobrá-la.' : 'Só a chefia pode reativá-la.') + '</div></div>';
    }

    return '<form class="form-atividade" id="faForm" novalidate>' + topo +
      '<div class="form-atividade__colunas">' +
        '<div class="form-atividade__principal">' +
          campoHtml('faTitulo', 'Título <span class="obrigatorio">*</span>',
            '<input type="text" id="faTitulo" maxlength="' + MAX_TITULO + '" autocomplete="off" value="' + U.esc(b.titulo) + '">',
            'Comece por um verbo: "Auditar…", "Notificar…", "Revisar…".') +
          campoHtml('faDescricao', 'Detalhamento',
            '<textarea id="faDescricao" rows="4" maxlength="' + MAX_DESCRICAO + '">' + U.esc(b.descricao) + '</textarea>',
            'O que fazer, como e onde registrar. Aparece no plano de atividades.') +
          '<div class="grade-form">' +
            campoHtml('faSetor', 'Setor', '<select id="faSetor">' + setores + '</select>', '') +
            campoHtml('faOrdem', 'Nº no plano',
              '<input type="number" id="faOrdem" min="1" max="' + MAX_ORDEM + '" step="1" inputmode="numeric" ' +
                'placeholder="' + (a ? '' : 'automático (' + proximoNumero + ')') + '" value="' + U.esc(b.ordem === null ? '' : b.ordem) + '">',
              a ? 'Posição da atividade no plano.' : 'Em branco: recebe o próximo número (' + proximoNumero + ').') +
          '</div>' +
          tiposHtml(ctx, b) +
          '<p class="texto-suave texto-pequeno oculto" id="faSemTipo">Escolha o tipo para definir os prazos.</p>' +
          regraRecorrenteHtml(b) +
          regraPontualHtml(b) +
          regraSobDemandaHtml() +
        '</div>' +
        '<div class="form-atividade__lateral">' +
          prioridadeHtml(b) +
          '<label class="marcar marcar--linha">' +
            '<input type="checkbox" id="faEvidencia"' + (b.exige_evidencia ? ' checked' : '') + '>' +
            '<span class="marcar__texto"><strong>Exige evidência para concluir</strong>' +
              '<small>A missão só pode ser marcada como concluída com ao menos um arquivo anexado.</small></span>' +
          '</label>' +
          responsaveisHtml(ctx, b) +
          '<section class="previa-prazos" aria-labelledby="faPreviaTitulo">' +
            '<h3 class="previa-prazos__titulo" id="faPreviaTitulo">' + icone('relogio') + 'Prévia dos próximos prazos</h3>' +
            '<div id="faPrevia" aria-live="polite"></div>' +
          '</section>' +
        '</div>' +
      '</div>' +
      '<div id="faErroGeral"></div>' +
      rodapeHtml(ctx) +
    '</form>';
  }

  function rodapeHtml(ctx) {
    var a = ctx.existente;
    var esquerda = '';
    if (a && ctx.gestor) {
      esquerda = (a.ativa === false
          ? '<button type="button" class="botao botao--secundario" data-fa-acao="reativar">Reativar</button>'
          : '<button type="button" class="botao botao--secundario" data-fa-acao="arquivar">Arquivar</button>') +
        '<button type="button" class="botao botao--perigo-secundario" data-fa-acao="excluir">Excluir</button>';
    }
    return '<div class="form-rodape">' +
      '<div class="form-rodape__lado">' + esquerda + '</div>' +
      '<div class="form-rodape__lado form-rodape__lado--direita">' +
        '<button type="button" class="botao botao--secundario" data-fa-acao="cancelar">Cancelar</button>' +
        '<button type="submit" class="botao" id="faSalvar">' + (a ? 'Salvar alterações' : 'Criar atividade') + '</button>' +
      '</div>' +
    '</div>';
  }

  /* ---------- leitura, validação e envio ---------- */

  function el(ctx, id) { return U.$('#' + id, ctx.painel); }

  function valorRadio(ctx, nome) {
    var marcado = U.$('input[name="' + nome + '"]:checked', ctx.painel);
    return marcado ? marcado.value : null;
  }

  function lerDados(ctx) {
    var tipo = valorRadio(ctx, 'faTipo');
    var d = {
      titulo: el(ctx, 'faTitulo').value.trim(),
      descricao: el(ctx, 'faDescricao').value,
      setor_id: el(ctx, 'faSetor').value || null,
      ordem: el(ctx, 'faOrdem').value.trim(),
      tipo: tipo,
      periodicidade: null, dia_semana: null, dia_mes: null, mes_inicio: null, prazo: null,
      antecipar_dia_util: !!el(ctx, 'faAntecipar').checked,
      prioridade: valorRadio(ctx, 'faPrioridade') || 'normal',
      exige_evidencia: !!el(ctx, 'faEvidencia').checked,
      data_inicio: el(ctx, 'faDataInicio').value || null,
      responsaveis: U.$$('input[name="faResponsavel"]:checked', ctx.painel).map(function (c) { return c.value; })
    };
    if (tipo === 'recorrente') {
      d.periodicidade = el(ctx, 'faPeriodicidade').value;
      if (d.periodicidade === 'semanal') { d.dia_semana = inteiro(el(ctx, 'faDiaSemana').value); }
      if (contem(COM_DIA_MES, d.periodicidade)) { d.dia_mes = inteiro(el(ctx, 'faDiaMes').value); }
      if (temPropria(INTERVALO_CICLO, d.periodicidade)) { d.mes_inicio = inteiro(el(ctx, 'faMesInicio').value); }
    } else if (tipo === 'pontual') {
      d.prazo = el(ctx, 'faPrazo').value || null;
    }
    return d;
  }

  /* Devolve [{ campo, mensagem }] na ordem em que os campos aparecem. */
  function validar(ctx, d) {
    var erros = [];
    function erro(campo, mensagem) { erros.push({ campo: campo, mensagem: mensagem }); }

    if (!d.titulo) { erro('faTitulo', 'Informe o título da atividade.'); }
    else if (d.titulo.length < MIN_TITULO) { erro('faTitulo', 'O título precisa ter ao menos ' + MIN_TITULO + ' caracteres.'); }
    else if (d.titulo.length > MAX_TITULO) { erro('faTitulo', 'O título pode ter no máximo ' + MAX_TITULO + ' caracteres.'); }
    if (d.descricao.length > MAX_DESCRICAO) {
      erro('faDescricao', 'O detalhamento pode ter no máximo ' + MAX_DESCRICAO.toLocaleString('pt-BR') + ' caracteres.');
    }
    if (d.ordem !== '') {
      var n = Number(d.ordem);
      if (!/^\d+$/.test(d.ordem) || n < 1 || n > MAX_ORDEM) { erro('faOrdem', 'Use um número inteiro de 1 a ' + MAX_ORDEM + '.'); }
    }
    if (!d.tipo) {
      erro('faTipo', 'Escolha o tipo da atividade.');
    } else if (!contem(ctx.tipos, d.tipo)) {
      erro('faTipo', 'Somente a chefia pode criar ou transformar uma atividade em recorrente.');
    }
    if (d.tipo === 'recorrente') {
      if (!contem(PERIODICIDADES, d.periodicidade)) { erro('faPeriodicidade', 'Escolha a periodicidade.'); }
      if (d.periodicidade === 'semanal' && !(d.dia_semana >= 1 && d.dia_semana <= 7)) { erro('faDiaSemana', 'Escolha o dia da semana.'); }
      if (contem(COM_DIA_MES, d.periodicidade) && !(d.dia_mes >= 1 && d.dia_mes <= 31)) { erro('faDiaMes', 'Escolha o dia do mês.'); }
      if (temPropria(INTERVALO_CICLO, d.periodicidade) && !(d.mes_inicio >= 1 && d.mes_inicio <= 12)) {
        erro('faMesInicio', 'Escolha o mês de início do ciclo.');
      }
      if (!Recorrencia.dataValida(d.data_inicio)) { erro('faDataInicio', 'Informe uma data válida.'); }
    }
    if (d.tipo === 'pontual' && d.prazo && !Recorrencia.dataValida(d.prazo)) {
      erro('faPrazo', 'Informe uma data válida (ou deixe em branco).');
    }
    if (!ctx.travaResp && !d.responsaveis.length) {
      erro('faResponsaveis', 'Escolha ao menos um responsável.');
    }
    if (ctx.adjuntoCriando && !contem(d.responsaveis, ctx.eu.id)) {
      erro('faResponsaveis', 'Você precisa estar entre os responsáveis da atividade que criar.');
    }
    return erros;
  }

  function limparErros(ctx) {
    U.$$('.campo--invalido', ctx.painel).forEach(function (c) { c.classList.remove('campo--invalido'); });
    U.$$('.campo__erro', ctx.painel).forEach(function (e) { e.textContent = ''; });
    el(ctx, 'faErroGeral').innerHTML = '';
  }

  function mostrarErros(ctx, erros) {
    erros.forEach(function (e) {
      var campo = el(ctx, e.campo + 'Campo');
      var caixa = el(ctx, e.campo + 'Erro');
      if (campo) { campo.classList.add('campo--invalido'); }
      if (caixa && !caixa.textContent) { caixa.textContent = e.mensagem; }
    });
    var primeiro = erros.length ? el(ctx, erros[0].campo + 'Campo') : null;
    if (primeiro) {
      var foco = U.$('input:not([disabled]), select, textarea', primeiro);
      try { primeiro.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* navegador antigo */ }
      if (foco) { try { foco.focus({ preventScroll: true }); } catch (e2) { foco.focus(); } }
    }
  }

  function erroGeral(ctx, mensagem) {
    el(ctx, 'faErroGeral').innerHTML = '<div class="aviso aviso--urgente mt-2" role="alert"><span class="aviso__icone">' +
      icone('alerta') + '</span><div><strong>Não foi possível salvar</strong>' + U.esc(mensagem) + '</div></div>';
  }

  function payload(ctx, d) {
    var a = ctx.existente;
    var p = {
      titulo: d.titulo,
      descricao: d.descricao,
      setor_id: d.setor_id,
      ordem: d.ordem === '' ? null : Number(d.ordem),
      tipo: d.tipo,
      periodicidade: d.periodicidade,
      dia_semana: d.dia_semana,
      dia_mes: d.dia_mes,
      mes_inicio: d.mes_inicio,
      prazo: d.prazo,
      antecipar_dia_util: d.antecipar_dia_util,
      prioridade: d.prioridade,
      exige_evidencia: d.exige_evidencia,
      ativa: a ? a.ativa !== false : true,
      /* Só a recorrente usa a data de início; nas demais vale a já gravada
         (mudar a data também "muda a regra" e regeneraria ocorrências). */
      data_inicio: (d.tipo === 'recorrente' && Recorrencia.dataValida(d.data_inicio))
        ? d.data_inicio : ((a && a.data_inicio) || ctx.hoje),
      /* O adjunto não altera responsáveis: manda exatamente a lista atual. */
      responsaveis: ctx.travaResp ? (a.responsaveis || []).slice() : d.responsaveis
    };
    if (a) { p.id = a.id; }
    return p;
  }

  /* Dados da atividade como estão gravados (arquivar/reativar não leva as
     mudanças ainda não salvas do formulário). */
  function payloadGravado(a, ativa) {
    return {
      id: a.id, ordem: a.ordem, titulo: a.titulo, descricao: a.descricao || '', setor_id: a.setor_id || null,
      tipo: a.tipo, periodicidade: a.periodicidade || null, dia_semana: a.dia_semana || null,
      dia_mes: a.dia_mes || null, mes_inicio: a.mes_inicio || null, prazo: a.prazo || null,
      antecipar_dia_util: a.antecipar_dia_util !== false, prioridade: a.prioridade || 'normal',
      exige_evidencia: !!a.exige_evidencia, ativa: ativa, data_inicio: a.data_inicio || null,
      responsaveis: (a.responsaveis || []).slice()
    };
  }

  function ocupado(botao, sim) {
    if (!botao || !document.body.contains(botao)) { return; }
    botao.disabled = !!sim;
    if (sim) { botao.setAttribute('aria-busy', 'true'); } else { botao.removeAttribute('aria-busy'); }
  }

  function enviar(ctx) {
    if (ctx.enviando) { return; }
    limparErros(ctx);
    var d = lerDados(ctx);
    var erros = validar(ctx, d);
    if (erros.length) {
      mostrarErros(ctx, erros);
      return;
    }
    var botao = el(ctx, 'faSalvar');
    ctx.enviando = true;
    ocupado(botao, true);
    Api.salvarAtividade(payload(ctx, d)).then(function (id) {
      ctx.enviando = false;
      U.torrada(ctx.existente ? 'Alterações salvas.' : 'Atividade criada.', 'sucesso');
      var estavaAberto = vigente(ctx);
      if (estavaAberto) { U.fecharPainel(); }
      App.recarregar(['atividades', 'ocorrencias']);
      if (estavaAberto) { voltar(ctx, id || (ctx.existente && ctx.existente.id)); }
    }).catch(function (erro) {
      ctx.enviando = false;
      if (!vigente(ctx)) { U.falha(erro); return; }
      ocupado(botao, false);
      erroGeral(ctx, U.erroTexto(erro));
      var caixa = el(ctx, 'faErroGeral');
      try { caixa.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* navegador antigo */ }
    });
  }

  function arquivarOuReativar(ctx, ativa, botao) {
    var a = ctx.existente;
    var pergunta = ativa
      ? 'Reativar a atividade "' + a.titulo + '"?\n\nEla volta a gerar ocorrências conforme a regra e a aparecer nas listas de trabalho.'
      : 'Arquivar a atividade "' + a.titulo + '"?\n\nEla deixa de gerar novas ocorrências e sai das listas de trabalho. ' +
        'As ocorrências futuras ainda pendentes (sem evidências nem comentários) são removidas, e as que estavam em ' +
        'aberto passam a "não se aplica", com a justificativa do arquivamento — nada fica cobrando como atrasado. ' +
        'O histórico é mantido e você pode reativá-la depois.';
    if (formularioMudou(ctx)) {
      pergunta += '\n\nAs alterações ainda não salvas neste formulário serão descartadas.';
    }
    if (!U.confirmar(pergunta)) { return; }
    ocupado(botao, true);
    Api.salvarAtividade(payloadGravado(a, ativa)).then(function () {
      U.torrada(ativa ? 'Atividade reativada.' : 'Atividade arquivada.', 'sucesso');
      var estavaAberto = vigente(ctx);
      if (estavaAberto) { U.fecharPainel(); }
      App.recarregar(['atividades', 'ocorrencias']);
      if (estavaAberto) { voltar(ctx, a.id); }
    }).catch(function (erro) {
      ocupado(botao, false);
      U.falha(erro);
    });
  }

  function excluir(ctx, botao) {
    var a = ctx.existente;
    ocupado(botao, true);
    Promise.all([
      Api.listarOcorrencias({ atividade_id: a.id }),
      Api.listarEvidencias({ atividade_id: a.id }),
      Api.listarComentarios({ atividade_id: a.id })
    ]).then(function (r) {
      ocupado(botao, false);
      if (!vigente(ctx)) { return; }
      var ocorrencias = (r[0] || []).filter(function (oc) { return oc.atividade_id === a.id; });
      var evidencias = (r[1] || []).filter(function (ev) { return ev.atividade_id === a.id; });
      var comentarios = (r[2] || []).filter(function (c) { return c.atividade_id === a.id; });
      if (!U.confirmar('Excluir DEFINITIVAMENTE a atividade "' + a.titulo + '"?\n\n' +
          'Isso apaga também tudo o que pertence a ela:\n' +
          '• ' + plural(ocorrencias.length, 'ocorrência (execução)', 'ocorrências (execuções)') + '\n' +
          '• ' + plural(evidencias.length, 'evidência (arquivo)', 'evidências (arquivos)') + '\n' +
          '• ' + plural(comentarios.length, 'comentário', 'comentários') + '\n\n' +
          'Não há como desfazer. Se a intenção é só parar de cobrar, use "Arquivar".')) { return; }
      ocupado(botao, true);
      return Api.excluirAtividade(a.id).then(function () {
        U.torrada('Atividade excluída.', 'sucesso');
        if (vigente(ctx)) { U.fecharPainel(); }
        App.recarregar(['atividades', 'ocorrencias', 'evidencias', 'comentarios']);
      });
    }).catch(function (erro) {
      ocupado(botao, false);
      U.falha(erro);
    });
  }

  /* Devolve o militar à tela de onde abriu o formulário (opcoes.voltar). */
  function voltar(ctx, id) {
    if (!ctx.voltar) { return; }
    try { ctx.voltar(id || null); } catch (erro) { U.falha(erro); }
  }

  /* Houve alguma mudança em relação ao que foi aberto? */
  function formularioMudou(ctx) {
    var atual = JSON.stringify(payload(ctx, lerDados(ctx)));
    return atual !== ctx.inicialSerializado;
  }

  /* ---------- atualização ao vivo do formulário ---------- */

  function mostrar(ctx, id, sim) {
    var alvo = el(ctx, id);
    if (alvo) { alvo.classList.toggle('oculto', !sim); }
  }

  function atualizarRegra(ctx) {
    var tipo = valorRadio(ctx, 'faTipo');
    var periodicidade = el(ctx, 'faPeriodicidade').value;
    mostrar(ctx, 'faSemTipo', !tipo);
    mostrar(ctx, 'faBlocoRecorrente', tipo === 'recorrente');
    mostrar(ctx, 'faBlocoPontual', tipo === 'pontual');
    mostrar(ctx, 'faBlocoDemanda', tipo === 'sob_demanda');
    mostrar(ctx, 'faDiaSemanaCampo', periodicidade === 'semanal');
    mostrar(ctx, 'faDiaMesCampo', contem(COM_DIA_MES, periodicidade));
    mostrar(ctx, 'faMesInicioCampo', temPropria(INTERVALO_CICLO, periodicidade));
    /* Na diária só dias úteis geram prazo: não há o que antecipar. */
    mostrar(ctx, 'faAnteciparCampo', periodicidade !== 'diaria_util');

    el(ctx, 'faPeriodicidadeDica').textContent = {
      diaria_util: 'Um prazo para cada dia útil (segunda a sexta, sem feriados).',
      semanal: 'Um prazo por semana.',
      mensal: 'Um prazo por mês.',
      trimestral: 'Um prazo a cada três meses.',
      semestral: 'Um prazo a cada seis meses.',
      anual: 'Um prazo por ano.'
    }[periodicidade] || '';

    var diaMes = inteiro(el(ctx, 'faDiaMes').value);
    el(ctx, 'faDiaMesDica').textContent = diaMes >= 31 ? 'Sempre o último dia de cada mês.'
      : (diaMes >= 29 ? 'Nos meses mais curtos, o prazo cai no último dia do mês.' : '');

    var intervalo = INTERVALO_CICLO[periodicidade];
    var mesInicio = inteiro(el(ctx, 'faMesInicio').value) || 1;
    el(ctx, 'faMesInicioDica').textContent = intervalo === 12 ? 'Prazo uma vez por ano, em ' + U.MESES[mesInicio - 1] + '.'
      : (intervalo ? 'Prazos em ' + juntarNomes(mesesDoCiclo(mesInicio, intervalo)) + '.' : '');

    atualizarDicaPrazo(ctx);
  }

  /* Pontual: avisa (sem impedir) prazo passado ou em dia não útil. */
  function atualizarDicaPrazo(ctx) {
    var dica = el(ctx, 'faPrazoDica');
    var prazo = el(ctx, 'faPrazo').value;
    dica.classList.remove('campo__dica--atencao');
    if (!prazo || !Recorrencia.dataValida(prazo)) {
      dica.textContent = 'Deixe em branco se ainda não houver prazo definido.';
      return;
    }
    var avisos = [];
    if (prazo < ctx.hoje) { avisos.push('o prazo já passou — a missão já nasce atrasada'); }
    if (!Recorrencia.eDiaUtil(prazo, ctx.ref.feriados)) { avisos.push(U.formatarData(prazo) + ' não é dia útil (' + motivoNaoUtil(ctx, prazo) + ')'); }
    if (avisos.length) {
      dica.textContent = 'Atenção: ' + avisos.join('; ') + '.';
      dica.classList.add('campo__dica--atencao');
    } else {
      dica.textContent = maiuscula(dataLonga(prazo)) + ' · ' + U.descreverPrazo(prazo, ctx.hoje) + '.';
    }
  }

  /* Data "nominal" de uma referência (antes de antecipar), para explicar
     na prévia por que o prazo caiu antes. */
  function dataNominal(d, referencia) {
    var m = /^([MTHA])(\d{4})-(\d{2})$/.exec(referencia || '');
    if (m) {
      var ano = Number(m[2]), mes = Number(m[3]);
      var dia = Math.min(Number(d.dia_mes) || 1, Recorrencia.ultimoDiaDoMes(ano, mes));
      return m[2] + '-' + m[3] + '-' + (dia < 10 ? '0' : '') + dia;
    }
    var s = /^S(\d{4})-W(\d{2})$/.exec(referencia || '');
    if (s) {
      /* Segunda-feira da semana 1 = a da semana que contém 4 de janeiro. */
      var quatro = s[1] + '-01-04';
      var segunda1 = Recorrencia.somarDias(quatro, 1 - Recorrencia.diaSemana(quatro));
      return Recorrencia.somarDias(segunda1, (Number(s[2]) - 1) * 7 + (Number(d.dia_semana) || 1) - 1);
    }
    return null;
  }

  function atualizarPrevia(ctx) {
    var caixa = el(ctx, 'faPrevia');
    var d = lerDados(ctx);
    if (!d.tipo) {
      caixa.innerHTML = '<p class="texto-suave texto-pequeno mb-0">Escolha o tipo da atividade para ver os prazos.</p>';
      return;
    }
    if (d.tipo === 'sob_demanda') {
      caixa.innerHTML = '<p class="texto-suave texto-pequeno mb-0">Sem prazos automáticos: cada execução é registrada ' +
        'quando a demanda surgir.</p>';
      return;
    }
    if (d.tipo === 'pontual') {
      caixa.innerHTML = d.prazo && Recorrencia.dataValida(d.prazo)
        ? '<ol class="previa-prazos__lista"><li><span class="previa-prazos__data">' + U.esc(maiuscula(dataLonga(d.prazo))) +
            '</span><span class="previa-prazos__ref">Entrega única · ' + U.esc(U.descreverPrazo(d.prazo, ctx.hoje)) + '</span></li></ol>'
        : '<p class="texto-suave texto-pequeno mb-0">Sem prazo definido: a missão fica em aberto até ser concluída.</p>';
      return;
    }
    if (!Recorrencia.dataValida(d.data_inicio)) {
      caixa.innerHTML = '<p class="texto-suave texto-pequeno mb-0">Informe a data de início para ver os prazos.</p>';
      return;
    }
    var regra = {
      tipo: 'recorrente', periodicidade: d.periodicidade, dia_semana: d.dia_semana, dia_mes: d.dia_mes,
      mes_inicio: d.mes_inicio, antecipar_dia_util: d.antecipar_dia_util, data_inicio: d.data_inicio
    };
    var lista = [];
    try { lista = Recorrencia.proximas(regra, QTD_PREVIA, ctx.hoje, ctx.ref.feriados || {}); } catch (e) { lista = []; }
    if (!lista.length) {
      caixa.innerHTML = '<p class="texto-suave texto-pequeno mb-0">Complete a regra para ver os próximos prazos.</p>';
      return;
    }
    caixa.innerHTML = '<p class="previa-prazos__regra">' + U.esc(Regras.descreverRegra(regra)) + '</p>' +
      '<ol class="previa-prazos__lista">' + lista.map(function (item) {
        var nominal = dataNominal(d, item.referencia);
        var nota = '';
        if (nominal && nominal !== item.prazo) {
          nota = '<span class="previa-prazos__nota">antecipado de ' + U.esc(U.formatarDataCurta(nominal)) +
            ' (' + U.esc(motivoNaoUtil(ctx, nominal)) + ')</span>';
        }
        return '<li><span class="previa-prazos__data">' + U.esc(maiuscula(dataLonga(item.prazo))) + '</span>' +
          '<span class="previa-prazos__ref">' + U.esc(Regras.rotuloReferencia(item.referencia)) + '</span>' + nota + '</li>';
      }).join('') + '</ol>';
  }

  function atualizar(ctx) {
    atualizarRegra(ctx);
    atualizarPrevia(ctx);
  }

  /* ---------- abertura ---------- */

  function vigente(ctx) {
    return ctx.seq === seq && !!ctx.painel && document.body.contains(ctx.painel);
  }

  function ligar(ctx) {
    var form = el(ctx, 'faForm');
    var redesenhar = U.adiar(function () { if (vigente(ctx)) { atualizar(ctx); } }, 60);
    form.addEventListener('input', function (evento) {
      limparErroDoCampo(evento.target);
      redesenhar();
    });
    form.addEventListener('change', function (evento) {
      limparErroDoCampo(evento.target);
      redesenhar();
    });
    form.addEventListener('submit', function (evento) {
      evento.preventDefault();
      enviar(ctx);
    });
    form.addEventListener('click', function (evento) {
      var botao = evento.target.closest ? evento.target.closest('[data-fa-acao]') : null;
      if (!botao) { return; }
      var acao = botao.getAttribute('data-fa-acao');
      if (acao === 'cancelar') {
        if (formularioMudou(ctx) && !U.confirmar('Descartar as alterações feitas neste formulário?')) { return; }
        U.fecharPainel();
        voltar(ctx, ctx.existente && ctx.existente.id);
      } else if (acao === 'arquivar') {
        arquivarOuReativar(ctx, false, botao);
      } else if (acao === 'reativar') {
        arquivarOuReativar(ctx, true, botao);
      } else if (acao === 'excluir') {
        excluir(ctx, botao);
      }
    });
  }

  function limparErroDoCampo(alvo) {
    if (!alvo || !alvo.closest) { return; }
    var campo = alvo.closest('.campo');
    if (campo && campo.classList.contains('campo--invalido')) {
      campo.classList.remove('campo--invalido');
      var caixa = U.$('.campo__erro', campo);
      if (caixa) { caixa.textContent = ''; }
    }
  }

  function montar(ctx, iniciais) {
    var corpo = U.$('.painel__corpo', ctx.painel);
    var b = valoresBase(ctx, iniciais);
    corpo.innerHTML = formularioHtml(ctx, b);
    ligar(ctx);
    atualizar(ctx);
    ctx.inicialSerializado = JSON.stringify(payload(ctx, lerDados(ctx)));
    /* No computador o cursor já vai para o título de uma atividade nova;
       no celular isso abriria o teclado por cima do formulário. */
    if (!ctx.existente && window.innerWidth >= 720) {
      var titulo = el(ctx, 'faTitulo');
      try { titulo.focus({ preventScroll: true }); } catch (e) { titulo.focus(); }
    }
  }

  function falhaAoCarregar(ctx, erro, tentar) {
    var corpo = U.$('.painel__corpo', ctx.painel);
    corpo.innerHTML = '<div class="aviso aviso--urgente" role="alert"><span class="aviso__icone">' + icone('alerta') +
      '</span><div><strong>Não foi possível abrir o formulário</strong>' + U.esc(U.erroTexto(erro)) + '</div></div>' +
      '<div class="acoes"><button type="button" class="botao botao--secundario" data-fa-tentar>Tentar novamente</button></div>';
    U.$('[data-fa-tentar]', corpo).addEventListener('click', tentar);
  }

  /* atividade: a da lista (com .responsaveis) para editar, ou null para
     criar. valoresIniciais (só na criação): { tipo, titulo, descricao,
     prazo, prioridade, setor_id, periodicidade, responsaveis, … }. */
  function abrir(atividade, valoresIniciais, opcoes) {
    var eu = (typeof App !== 'undefined' && App && typeof App.militar === 'function') ? App.militar() : null;
    if (!eu) { return; }
    var existente = !!(atividade && atividade.id);
    if (existente && !Regras.podeEditarAtividade(eu, atividade)) {
      U.torrada('Somente a chefia ou os responsáveis podem editar esta atividade.', 'erro');
      return;
    }
    if (!existente && !Regras.podeCriarAtividade(eu)) {
      U.torrada('Você não tem permissão para criar atividades.', 'erro');
      return;
    }

    seq += 1;
    var ctx = { seq: seq, eu: eu, gestor: Regras.eGestor(eu), hoje: U.hojeBelem(), enviando: false,
      voltar: (opcoes && typeof opcoes.voltar === 'function') ? opcoes.voltar : null };
    U.abrirPainel(existente ? 'Editar atividade' : 'Nova atividade',
      '<div class="carregando" role="status">Carregando o formulário…</div>', function (painel) {
        ctx.painel = painel;
      }, { largo: true });
    App.aoAtualizarPainel(null);

    function carregar() {
      var corpo = U.$('.painel__corpo', ctx.painel);
      if (corpo) { corpo.innerHTML = '<div class="carregando" role="status">Carregando o formulário…</div>'; }
      Promise.all([Api.referencias(), Api.listarAtividades()]).then(function (r) {
        if (!vigente(ctx)) { return; }
        ctx.ref = r[0];
        ctx.atividades = r[1] || [];
        if (existente) {
          /* A versão mais recente (o objeto recebido pode estar velho). */
          ctx.existente = achar(ctx.atividades, function (a) { return a.id === atividade.id; });
          if (!ctx.existente) {
            var erro = new Error('Esta atividade não existe mais. Ela pode ter sido excluída — atualize a página.');
            falhaAoCarregar(ctx, erro, carregar);
            return;
          }
          if (!Regras.podeEditarAtividade(eu, ctx.existente)) {
            falhaAoCarregar(ctx, new Error('Você não é mais responsável por esta atividade; somente a chefia pode editá-la.'), carregar);
            return;
          }
        } else {
          ctx.existente = null;
        }
        ctx.tipos = typeof Regras.tiposPermitidos === 'function'
          ? Regras.tiposPermitidos(eu, ctx.existente)
          : ['recorrente', 'pontual', 'sob_demanda'].filter(function (t) { return Regras.podeCriarAtividade(eu, t); });
        ctx.travaResp = !!ctx.existente && !Regras.podeAlterarResponsaveis(eu);
        ctx.adjuntoCriando = !ctx.existente && !ctx.gestor;
        montar(ctx, valoresIniciais);
      }).catch(function (erro) {
        if (!vigente(ctx)) { return; }
        falhaAoCarregar(ctx, erro, carregar);
      });
    }
    carregar();
  }

  return { abrir: abrir };
})();


Paginas.atividades = (function () {
  'use strict';

  var CHAVE_FILTROS = 'aqs_atividades_filtros';
  /* Tabelas cuja mudança muda o que esta lista mostra. */
  var TABELAS = ['atividades', 'atividade_responsaveis', 'ocorrencias', 'militares', 'setores'];
  var CHIPS = [
    { valor: 'todas', rotulo: 'Todas' },
    { valor: 'recorrente', rotulo: 'Recorrentes' },
    { valor: 'sob_demanda', rotulo: 'Sob demanda' },
    { valor: 'pontual', rotulo: 'Pontuais' },
    { valor: 'arquivadas', rotulo: 'Arquivadas' }
  ];
  var ID_VALIDO = /^[0-9A-Za-z_-]{1,64}$/;

  var geracao = 0;
  var carga = 0;
  var filtros = null;
  /* Últimos dados buscados: { ref, atividades, proximos, hoje } */
  var dados = null;

  /* ---------- auxiliares ---------- */

  function icone(nome) {
    return '<svg class="icone" aria-hidden="true" focusable="false"><use href="#i-' + nome + '"></use></svg>';
  }

  function temPropria(objeto, chave) {
    return !!objeto && Object.prototype.hasOwnProperty.call(objeto, chave);
  }

  function plural(n, singular, varios) {
    return n + ' ' + (n === 1 ? singular : varios);
  }

  function contem(lista, valor) {
    return Array.isArray(lista) && lista.indexOf(valor) >= 0;
  }

  function vigente(el, minhaGeracao, minhaCarga) {
    return minhaGeracao === geracao && (minhaCarga === undefined || minhaCarga === carga) &&
      !!App.militar() && !el.classList.contains('oculto') && !!U.$('.pagina-atividades', el);
  }

  /* ---------- filtros (lembrados na aba do navegador) ---------- */

  function filtrosPadrao() {
    return { busca: '', chip: 'todas', responsavel: '', setor: '' };
  }

  function lerFiltros(params) {
    var f = filtrosPadrao();
    try {
      var salvo = JSON.parse(window.sessionStorage.getItem(CHAVE_FILTROS) || 'null');
      if (salvo && typeof salvo === 'object') {
        if (typeof salvo.busca === 'string') { f.busca = salvo.busca.slice(0, 120); }
        if (CHIPS.some(function (c) { return c.valor === salvo.chip; })) { f.chip = salvo.chip; }
        if (typeof salvo.responsavel === 'string' && (salvo.responsavel === 'sem' || ID_VALIDO.test(salvo.responsavel))) {
          f.responsavel = salvo.responsavel;
        }
        if (typeof salvo.setor === 'string' && (salvo.setor === 'sem' || ID_VALIDO.test(salvo.setor))) { f.setor = salvo.setor; }
      }
    } catch (e) { /* sem armazenamento: padrões */ }
    /* O endereço manda (links do Início, por exemplo). */
    if (params.responsavel && (params.responsavel === 'sem' || ID_VALIDO.test(params.responsavel))) {
      f.responsavel = params.responsavel;
      f.chip = 'todas';
    }
    if (params.setor && (params.setor === 'sem' || ID_VALIDO.test(params.setor))) { f.setor = params.setor; }
    if (params.tipo && CHIPS.some(function (c) { return c.valor === params.tipo; })) { f.chip = params.tipo; }
    return f;
  }

  function gravarFiltros() {
    try { window.sessionStorage.setItem(CHAVE_FILTROS, JSON.stringify(filtros)); } catch (e) { /* vale só agora */ }
  }

  /* ---------- montagem ---------- */

  function cabecalhoHtml(eu) {
    var podeCriar = Regras.podeCriarAtividade(eu);
    return '<div class="pagina__cabecalho pagina__cabecalho--acoes">' +
      '<div><h1>Atividades</h1>' +
        '<p>O que o NSP e a AQS fazem, com que frequência e por quem. Clique numa atividade para ver o detalhe.</p></div>' +
      '<div class="acoes acoes--topo">' +
        '<a class="botao botao--secundario" href="#/plano">' + icone('plano') + 'Ver o plano</a>' +
        (podeCriar ? '<button type="button" class="botao" data-acao="nova">+ Nova atividade</button>' : '') +
      '</div>' +
    '</div>' +
    (podeCriar && !Regras.eGestor(eu)
      ? '<p class="texto-pequeno texto-suave">Você pode criar atividades pontuais ou sob demanda em que seja responsável. ' +
        'As recorrentes são definidas pela chefia.</p>' : '');
  }

  function filtrosHtml() {
    return '<div class="cartao filtros-gestao">' +
      '<div class="busca-gestao">' +
        '<input type="search" id="atvBusca" autocomplete="off" maxlength="120" ' +
          'placeholder="Buscar atividade" aria-label="Buscar atividades por título, detalhamento, responsável ou nº" value="' +
          U.esc(filtros.busca) + '">' +
      '</div>' +
      '<div class="filtros filtros--gestao" role="group" aria-label="Tipo de atividade">' +
        CHIPS.map(function (c) {
          var ativo = filtros.chip === c.valor;
          return '<button type="button" class="filtro' + (ativo ? ' filtro--ativo' : '') + '" data-chip="' + c.valor +
            '" aria-pressed="' + (ativo ? 'true' : 'false') + '">' + U.esc(c.rotulo) +
            ' <span class="filtro__contagem" data-contagem="' + c.valor + '"></span></button>';
        }).join('') +
      '</div>' +
      '<div class="filtros-gestao__selecoes">' +
        '<label class="campo campo--compacto"><span class="campo__rotulo">Responsável</span>' +
          '<select id="atvResponsavel"><option value="">Todos</option></select></label>' +
        '<label class="campo campo--compacto"><span class="campo__rotulo">Setor</span>' +
          '<select id="atvSetor"><option value="">Todos</option></select></label>' +
        '<button type="button" class="botao botao--texto botao--pequeno" data-acao="limpar">Limpar filtros</button>' +
      '</div>' +
    '</div>';
  }

  function render(el, params) {
    geracao += 1;
    filtros = lerFiltros(params || {});
    dados = null;
    var eu = App.militar();
    el.innerHTML = '<div class="pagina-atividades">' +
      cabecalhoHtml(eu) +
      filtrosHtml() +
      '<p class="resumo-lista" id="atvResumo" aria-live="polite"></p>' +
      '<div id="atvLista"><div class="carregando" role="status">Carregando as atividades…</div></div>' +
    '</div>';
    ligar(el);
    carregar(el);
  }

  function aoVivo(el, params, tabelas) {
    if (Array.isArray(tabelas) && !tabelas.some(function (t) { return contem(TABELAS, t); })) { return; }
    if (!U.$('.pagina-atividades', el) || !filtros) { render(el, params); return; }
    carregar(el);
  }

  function carregar(el) {
    var minhaGeracao = geracao;
    var minhaCarga = ++carga;
    Promise.all([
      Api.referencias(),
      Api.listarAtividades(),
      Api.listarOcorrencias({ somenteAbertas: true })
    ]).then(function (r) {
      if (!vigente(el, minhaGeracao, minhaCarga)) { return; }
      dados = {
        ref: r[0],
        atividades: r[1] || [],
        proximos: proximosPrazos(r[2] || []),
        hoje: U.hojeBelem()
      };
      preencherSelecoes(el);
      desenhar(el);
    }).catch(function (erro) {
      if (!vigente(el, minhaGeracao, minhaCarga)) { return; }
      U.falha(erro);
      var lista = U.$('#atvLista', el);
      if (dados) { return; } /* mantém o que já estava na tela */
      lista.innerHTML = '<div class="aviso aviso--urgente" role="alert"><span class="aviso__icone">' + icone('alerta') +
        '</span><div><strong>Não foi possível carregar as atividades</strong>' + U.esc(U.erroTexto(erro)) + '</div></div>' +
        '<div class="acoes"><button type="button" class="botao botao--secundario" data-acao="tentar">Tentar novamente</button></div>';
    });
  }

  /* { atividade_id: { prazo (o mais antigo em aberto), abertas, semPrazo } } */
  function proximosPrazos(abertas) {
    var mapa = {};
    abertas.forEach(function (oc) {
      if (oc.status !== 'pendente' && oc.status !== 'em_andamento') { return; }
      var item = mapa[oc.atividade_id] || (mapa[oc.atividade_id] = { prazo: null, abertas: 0, semPrazo: 0 });
      item.abertas += 1;
      if (!oc.prazo) { item.semPrazo += 1; return; }
      var prazo = String(oc.prazo).slice(0, 10);
      if (!item.prazo || prazo < item.prazo) { item.prazo = prazo; }
    });
    return mapa;
  }

  /* Militares que recebem missões (para "sem responsável"). */
  function mapaAtribuiveis() {
    var mapa = {};
    Regras.militaresAtribuiveis(dados.ref.militares).forEach(function (m) { mapa[m.id] = true; });
    return mapa;
  }

  function preencherSelecoes(el) {
    var ref = dados.ref;
    var selResp = U.$('#atvResponsavel', el);
    var selSetor = U.$('#atvSetor', el);
    var naLista = {};
    var militares = Regras.militaresAtribuiveis(ref.militares).slice();
    militares.forEach(function (m) { naLista[m.id] = true; });
    /* Desativados que ainda constam como responsáveis também filtram. */
    dados.atividades.forEach(function (a) {
      (a.responsaveis || []).forEach(function (id) {
        if (!naLista[id] && temPropria(ref.mapaMilitares, id)) { naLista[id] = true; militares.push(ref.mapaMilitares[id]); }
      });
    });
    militares.sort(function (a, b) { return U.ordenarTexto(Regras.nomeMilitar(a), Regras.nomeMilitar(b)); });
    if (filtros.responsavel && filtros.responsavel !== 'sem' && !naLista[filtros.responsavel]) { filtros.responsavel = ''; }
    selResp.innerHTML = '<option value="">Todos</option><option value="sem"' + (filtros.responsavel === 'sem' ? ' selected' : '') +
      '>Sem responsável</option>' + militares.map(function (m) {
        return '<option value="' + U.esc(m.id) + '"' + (filtros.responsavel === m.id ? ' selected' : '') + '>' +
          U.esc(Regras.nomeMilitar(m) + (m.ativo === false ? ' (desativado)' : '')) + '</option>';
      }).join('');

    if (filtros.setor && filtros.setor !== 'sem' && !temPropria(ref.mapaSetores, filtros.setor)) { filtros.setor = ''; }
    selSetor.innerHTML = '<option value="">Todos</option><option value="sem"' + (filtros.setor === 'sem' ? ' selected' : '') +
      '>Sem setor</option>' + (ref.setores || []).map(function (s) {
        return '<option value="' + U.esc(s.id) + '"' + (filtros.setor === s.id ? ' selected' : '') + '>' +
          U.esc(s.sigla + ' — ' + s.nome) + '</option>';
      }).join('');
  }

  function textoDeBusca(a) {
    var ref = dados.ref;
    var setor = a.setor_id && temPropria(ref.mapaSetores, a.setor_id) ? ref.mapaSetores[a.setor_id] : null;
    return U.normalizar([
      a.ordem, a.titulo, a.descricao, setor ? setor.sigla + ' ' + setor.nome : '',
      Regras.nomesResponsaveis(a.responsaveis, ref.mapaMilitares), Regras.descreverRegra(a),
      Regras.ROTULOS.tipo[a.tipo] || ''
    ].join(' '));
  }

  function noChip(a, chip) {
    if (chip === 'arquivadas') { return a.ativa === false; }
    if (a.ativa === false) { return false; }
    return chip === 'todas' || a.tipo === chip;
  }

  function filtrar() {
    var atribuiveis = mapaAtribuiveis();
    var termos = U.normalizar(filtros.busca).split(/\s+/).filter(Boolean);
    return dados.atividades.filter(function (a) {
      if (!noChip(a, filtros.chip)) { return false; }
      if (filtros.responsavel === 'sem') {
        if ((a.responsaveis || []).some(function (id) { return atribuiveis[id]; })) { return false; }
      } else if (filtros.responsavel && !contem(a.responsaveis, filtros.responsavel)) {
        return false;
      }
      if (filtros.setor === 'sem' && a.setor_id) { return false; }
      if (filtros.setor && filtros.setor !== 'sem' && a.setor_id !== filtros.setor) { return false; }
      if (termos.length) {
        var texto = textoDeBusca(a);
        if (!termos.every(function (t) { return texto.indexOf(t) >= 0; })) { return false; }
      }
      return true;
    }).sort(function (a, b) {
      var oa = Number(a.ordem) || 0, ob = Number(b.ordem) || 0;
      if (oa !== ob) { return oa - ob; }
      return U.ordenarTexto(a.titulo, b.titulo);
    });
  }

  function filtrosAtivos() {
    return !!(filtros.busca.trim() || filtros.responsavel || filtros.setor || filtros.chip !== 'todas');
  }

  /* ---------- peças de cada item ---------- */

  function chipsHtml(a) {
    var ref = dados.ref;
    var eu = App.militar();
    var ids = a.responsaveis || [];
    if (!ids.length) { return '<span class="chips"><span class="chip chip--vazio">Sem responsável</span></span>'; }
    return '<span class="chips">' + ids.map(function (id) {
      var m = temPropria(ref.mapaMilitares, id) ? ref.mapaMilitares[id] : null;
      var nome = m ? Regras.nomeMilitar(m) : 'Militar não encontrado';
      var classe = 'chip' + (eu && id === eu.id ? ' chip--eu' : '') + (m && m.ativo === false ? ' chip--desativado' : '');
      return '<span class="' + classe + '" title="' + U.esc(nome + (m && m.ativo === false ? ' (desativado)' : '')) + '">' +
        U.esc(nome) + '</span>';
    }).join('') + '</span>';
  }

  function setorHtml(a) {
    var ref = dados.ref;
    var s = a.setor_id && temPropria(ref.mapaSetores, a.setor_id) ? ref.mapaSetores[a.setor_id] : null;
    if (!s) { return '<span class="texto-suave">—</span>'; }
    return '<span class="sigla-setor" title="' + U.esc(s.nome) + '">' + U.esc(s.sigla) + '</span>';
  }

  /* Próximo prazo em aberto (a ocorrência aberta mais antiga). */
  function prazoHtml(a) {
    if (a.ativa === false) { return '<span class="texto-suave">Arquivada</span>'; }
    var info = dados.proximos[a.id];
    if (!info || !info.abertas) {
      return '<span class="texto-suave">' + (a.tipo === 'sob_demanda' ? 'Quando houver demanda' : 'Nada em aberto') + '</span>';
    }
    var extra = info.abertas > 1 ? '<small class="prazo-gestao__extra">' + U.esc(plural(info.abertas, 'em aberto', 'em aberto')) + '</small>' : '';
    if (!info.prazo) {
      return '<span class="prazo-gestao">Em aberto, sem prazo' + extra + '</span>';
    }
    var dias = U.diasEntre(dados.hoje, info.prazo);
    var classe = dias < 0 ? ' prazo-gestao--atrasado' : (dias === 0 ? ' prazo-gestao--hoje' : (dias <= 3 ? ' prazo-gestao--proximo' : ''));
    return '<span class="prazo-gestao' + classe + '">' +
      '<strong>' + U.esc(U.formatarData(info.prazo)) + '</strong>' +
      '<small>' + U.esc(U.descreverPrazo(info.prazo, dados.hoje)) + '</small>' + extra +
    '</span>';
  }

  function linhaHtml(a) {
    var id = U.esc(a.id);
    return '<tr class="linha-clicavel' + (a.ativa === false ? ' linha-clicavel--arquivada' : '') + '" data-atividade="' + id + '">' +
      '<td class="col-numero">' + U.esc(a.ordem === null || a.ordem === undefined ? '—' : a.ordem) + '</td>' +
      '<td class="col-titulo"><button type="button" class="link-titulo" data-atividade="' + id + '">' + U.esc(a.titulo) + '</button>' +
        '<span class="linha-regra">' + U.esc(Regras.descreverRegra(a)) + '</span>' +
        (a.ativa === false ? ' <span class="selo selo--neutro selo--pequeno">Arquivada</span>' : '') +
        (a.exige_evidencia ? ' <span class="selo selo--neutro selo--pequeno" title="Exige evidência para concluir">Evidência</span>' : '') +
      '</td>' +
      '<td>' + Regras.seloTipo(a.tipo) + '</td>' +
      '<td class="col-responsaveis">' + chipsHtml(a) + '</td>' +
      '<td>' + setorHtml(a) + '</td>' +
      '<td>' + Regras.seloPrioridade(a.prioridade) + '</td>' +
      '<td class="col-prazo">' + prazoHtml(a) + '</td>' +
    '</tr>';
  }

  function cartaoHtml(a) {
    var id = U.esc(a.id);
    return '<li class="cartao-item' + (a.ativa === false ? ' cartao-item--arquivado' : '') + '" data-atividade="' + id + '">' +
      '<div class="cartao-item__topo">' +
        '<span class="numero-ordem">' + U.esc(a.ordem === null || a.ordem === undefined ? '—' : a.ordem) + '</span>' +
        '<button type="button" class="cartao-item__titulo" data-atividade="' + id + '">' + U.esc(a.titulo) + '</button>' +
      '</div>' +
      '<div class="cartao-item__selos">' + Regras.seloTipo(a.tipo) + Regras.seloPrioridade(a.prioridade) +
        (a.ativa === false ? '<span class="selo selo--neutro">Arquivada</span>' : '') +
        (a.exige_evidencia ? '<span class="selo selo--neutro">Exige evidência</span>' : '') + '</div>' +
      '<p class="cartao-item__linha">' + U.esc(Regras.descreverRegra(a)) + '</p>' +
      '<div class="cartao-item__linha">' + chipsHtml(a) + '</div>' +
      '<div class="cartao-item__rodape">' + setorHtml(a) + prazoHtml(a) + '</div>' +
    '</li>';
  }

  /* ---------- desenho ---------- */

  function atualizarContagens(el) {
    CHIPS.forEach(function (c) {
      var n = dados.atividades.filter(function (a) { return noChip(a, c.valor); }).length;
      var alvo = U.$('[data-contagem="' + c.valor + '"]', el);
      if (alvo) { alvo.textContent = '(' + n + ')'; }
    });
  }

  function desenhar(el) {
    if (!dados) { return; }
    var lista = U.$('#atvLista', el);
    var resumo = U.$('#atvResumo', el);
    var eu = App.militar();
    atualizarContagens(el);
    var ativas = dados.atividades.filter(function (a) { return a.ativa !== false; }).length;
    var arquivadas = dados.atividades.length - ativas;

    if (!dados.atividades.length) {
      resumo.textContent = '';
      lista.innerHTML = '<div class="vazio"><span class="vazio__icone">' + icone('atividades') + '</span>' +
        '<strong>Nenhuma atividade cadastrada</strong>' +
        '<p>Cadastre as atividades do setor: as recorrentes geram os prazos sozinhas; as pontuais e sob demanda ' +
          'registram entregas e execuções.</p>' +
        (Regras.podeCriarAtividade(eu) ? '<button type="button" class="botao" data-acao="nova">+ Nova atividade</button>' : '') +
      '</div>';
      return;
    }

    var visiveis = filtrar();
    resumo.textContent = plural(ativas, 'atividade ativa', 'atividades ativas') +
      (arquivadas ? ' · ' + plural(arquivadas, 'arquivada', 'arquivadas') : '') +
      (filtrosAtivos() ? ' · mostrando ' + visiveis.length : '');

    if (!visiveis.length) {
      lista.innerHTML = '<div class="vazio"><span class="vazio__icone">' + icone('caixa') + '</span>' +
        '<strong>Nenhuma atividade encontrada</strong>' +
        '<p>' + (filtros.chip === 'arquivadas' && !arquivadas ? 'Não há atividades arquivadas.'
          : 'Nenhuma atividade atende aos filtros escolhidos.') + '</p>' +
        (filtrosAtivos() ? '<button type="button" class="botao botao--secundario" data-acao="limpar">Limpar filtros</button>' : '') +
      '</div>';
      return;
    }

    lista.innerHTML =
      '<div class="cartao cartao--tabela so-computador">' +
        '<div class="tabela-rolagem"><table class="tabela tabela--gestao">' +
          '<caption class="so-leitor-tela">Atividades</caption>' +
          '<thead><tr><th scope="col" class="col-numero">Nº</th><th scope="col">Atividade</th><th scope="col">Tipo</th>' +
            '<th scope="col">Responsáveis</th><th scope="col">Setor</th><th scope="col">Prioridade</th>' +
            '<th scope="col">Próximo prazo</th></tr></thead>' +
          '<tbody>' + visiveis.map(linhaHtml).join('') + '</tbody>' +
        '</table></div>' +
      '</div>' +
      '<ul class="lista-cartoes so-celular">' + visiveis.map(cartaoHtml).join('') + '</ul>';
  }

  /* ---------- eventos ---------- */

  function abrirDetalhe(id) {
    if (!id || !ID_VALIDO.test(id)) { return; }
    if (typeof Detalhe === 'undefined' || !Detalhe) {
      U.torrada('Não foi possível abrir o detalhe: o módulo não carregou. Recarregue a página.', 'erro');
      return;
    }
    Detalhe.abrirAtividade(id);
  }

  function limpar(el) {
    filtros = filtrosPadrao();
    gravarFiltros();
    U.$('#atvBusca', el).value = '';
    U.$$('[data-chip]', el).forEach(function (b) {
      var ativo = b.getAttribute('data-chip') === 'todas';
      b.classList.toggle('filtro--ativo', ativo);
      b.setAttribute('aria-pressed', ativo ? 'true' : 'false');
    });
    if (dados) { preencherSelecoes(el); }
    desenhar(el);
  }

  function ligar(el) {
    var raiz = U.$('.pagina-atividades', el);
    var redesenharBusca = U.adiar(function () { desenhar(el); }, 150);

    raiz.addEventListener('click', function (evento) {
      var alvo = evento.target;
      if (!alvo || !alvo.closest) { return; }
      var acao = alvo.closest('[data-acao]');
      if (acao) {
        var qual = acao.getAttribute('data-acao');
        if (qual === 'nova') { FormAtividade.abrir(null); }
        else if (qual === 'limpar') { limpar(el); }
        else if (qual === 'tentar') { U.$('#atvLista', el).innerHTML = '<div class="carregando" role="status">Carregando…</div>'; carregar(el); }
        return;
      }
      var chip = alvo.closest('[data-chip]');
      if (chip) {
        filtros.chip = chip.getAttribute('data-chip');
        gravarFiltros();
        U.$$('[data-chip]', el).forEach(function (b) {
          var ativo = b === chip;
          b.classList.toggle('filtro--ativo', ativo);
          b.setAttribute('aria-pressed', ativo ? 'true' : 'false');
        });
        desenhar(el);
        return;
      }
      if (alvo.closest('a')) { return; }
      var item = alvo.closest('[data-atividade]');
      if (item) { abrirDetalhe(item.getAttribute('data-atividade')); }
    });

    raiz.addEventListener('input', function (evento) {
      if (evento.target && evento.target.id === 'atvBusca') {
        filtros.busca = evento.target.value.slice(0, 120);
        gravarFiltros();
        redesenharBusca();
      }
    });

    raiz.addEventListener('change', function (evento) {
      var alvo = evento.target;
      if (!alvo) { return; }
      if (alvo.id === 'atvResponsavel') { filtros.responsavel = alvo.value; }
      else if (alvo.id === 'atvSetor') { filtros.setor = alvo.value; }
      else { return; }
      gravarFiltros();
      desenhar(el);
    });
  }

  return {
    titulo: 'Atividades',
    render: render,
    aoVivo: aoVivo
  };
})();
