/* =========================================================================
   HABE – AQS e NSP — dados fictícios do modo demonstração
   Monta, a partir da data de hoje, um estado completo e realista do banco
   (as mesmas tabelas e campos de ARQUITETURA §3): os setores, militares,
   feriados e as 16 atividades da carga inicial, com algumas semanas de
   histórico — execuções concluídas (umas fora do prazo), algumas atrasadas,
   evidências (só metadados), comentários, avisos, notificações e auditoria.

   É determinístico: o mesmo "hoje" gera sempre o mesmo estado (sorteios com
   semente fixa), para a demonstração ser reproduzível e testável.
   Nada aqui é dado real: os e-mails são @demo.local e os nomes completos
   ficam em branco de propósito.

   Depende de Recorrencia e Regras (carregados antes). Não toca em document
   nem em window: também roda no Node (testes/contrato-api.mjs).
   ========================================================================= */

var DadosDemo = (function () {
  'use strict';

  var VERSAO_ESTADO = 3;

  /* ---------- sorteio com semente (mulberry32) ---------- */

  function criarSorteio(semente) {
    var a = semente >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* uuid v4 no formato do Postgres, a partir de um sorteio próprio (assim
     acrescentar um sorteio de dados não muda todos os ids). */
  function criarGeradorIds(semente) {
    var sorteio = criarSorteio(semente);
    return function () {
      var h = '';
      for (var i = 0; i < 32; i += 1) { h += Math.floor(sorteio() * 16).toString(16); }
      var variante = (8 + Math.floor(sorteio() * 4)).toString(16);
      return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-' +
        variante + h.slice(17, 20) + '-' + h.slice(20, 32);
    };
  }

  /* ---------- datas (calendário puro; Belém é UTC−3 o ano todo) ---------- */

  function doisDigitos(n) { return (n < 10 ? '0' : '') + n; }

  function somar(data, dias) { return Recorrencia.somarDias(data, dias); }

  /* Instante (timestamptz em ISO/UTC) de uma data e hora de Belém. */
  function instante(data, hora, minuto) {
    var p = String(data).split('-');
    return new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]),
                             (hora || 0) + 3, minuto || 0)).toISOString();
  }

  function dataDoInstante(iso) { return Regras.dataBelem(iso); }

  function maior(a, b) { return a > b ? a : b; }
  function menor(a, b) { return a < b ? a : b; }

  /* Próximo dia útil a partir de 'data' (inclusive) — prazos de pontuais
     não caem em fim de semana nem feriado. */
  function proximoDiaUtil(data, feriados) {
    var d = data;
    for (var i = 0; i < 15 && !Recorrencia.eDiaUtil(d, feriados); i += 1) { d = somar(d, 1); }
    return d;
  }

  /* ---------- feriados (os mesmos da carga inicial) ---------- */

  /* Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano). */
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
    return ano + '-' + doisDigitos(mes) + '-' + doisDigitos(dia);
  }

  function feriadosDoAno(ano) {
    return [
      { data: ano + '-01-01', descricao: 'Confraternização Universal' },
      { data: somar(pascoa(ano), -2), descricao: 'Sexta-feira da Paixão' },
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

  /* 2026 e 2027 (como a carga inicial) e, se a demonstração for aberta em
     outro ano, também o ano corrente e o seguinte. */
  function montarFeriados(hoje) {
    var anoHoje = Number(hoje.slice(0, 4));
    var anos = [2026, 2027, anoHoje, anoHoje + 1].filter(function (ano, i, lista) {
      return lista.indexOf(ano) === i;
    }).sort();
    var lista = [];
    anos.forEach(function (ano) { lista = lista.concat(feriadosDoAno(ano)); });
    lista.sort(function (a, b) { return a.data < b.data ? -1 : 1; });
    return lista;
  }

  /* ---------- textos de notificação (os mesmos usados por ApiDemo) ---------- */

  /* Igual a privado.resumir do banco: tira os espaços das pontas, junta os
     espaços internos e corta com reticências. */
  function resumir(texto, maximo) {
    var t = String(texto === null || texto === undefined ? '' : texto)
      .replace(/^ +| +$/g, '').replace(/\s+/g, ' ');
    return t.length <= maximo ? t : t.slice(0, maximo - 1) + '…';
  }

  var TITULO_COMENTARIO = { chefia: 'Novo comentário da chefia', administrador: 'Novo comentário da AQS' };

  /* { titulo, mensagem } de cada tipo de notificação — os mesmos textos dos
     gatilhos do banco (supabase/01-estrutura.sql), para a demonstração
     mostrar exatamente o que o sistema real mostra. */
  function textoNotificacao(tipo, d) {
    d = d || {};
    if (tipo === 'atribuicao') {
      return { titulo: 'Nova missão atribuída', mensagem: resumir(d.atividade_titulo, 200) };
    }
    if (tipo === 'comentario') {
      return {
        titulo: TITULO_COMENTARIO[d.autor_papel] || 'Novo comentário',
        mensagem: resumir((d.autor_nome || 'Comentário') + ' em "' + (d.atividade_titulo || '') + '": ' + d.texto, 240)
      };
    }
    if (tipo === 'aviso') {
      return { titulo: resumir('Novo aviso: ' + d.aviso_titulo, 200), mensagem: resumir(d.mensagem, 240) };
    }
    /* prazo */
    return {
      titulo: d.prazo === d.hoje ? 'Prazo hoje' : 'Prazo amanhã',
      mensagem: resumir(d.atividade_titulo + (d.titulo_execucao ? ' — ' + d.titulo_execucao : ''), 200)
    };
  }

  /* ---------- plano de atividades (a carga inicial) ---------- */

  var PLANO = [
    { titulo: 'Verificar o SIGADAER e os retornos das notificações',
      descricao: 'Verificação diária do SIGADAER e dos retornos das notificações.',
      tipo: 'recorrente', periodicidade: 'diaria_util', resp: ['leticia'] },
    { titulo: 'Analisar as notificações recebidas e encaminhar ao responsável',
      descricao: 'Analisar as notificações recebidas e encaminhar ao responsável para elaboração do plano de ação.',
      tipo: 'sob_demanda', resp: ['leticia'] },
    { titulo: 'Notificar no NOTIVISA',
      descricao: 'Lançar no NOTIVISA, mensalmente, as notificações do período.',
      tipo: 'recorrente', periodicidade: 'mensal', dia_mes: 31, resp: ['leticia'] },
    { titulo: 'Salvar os retornos das notificações na pasta do setor',
      descricao: 'Arquivar na pasta do setor os retornos das notificações.',
      tipo: 'recorrente', periodicidade: 'semanal', dia_semana: 5, resp: ['leticia'] },
    { titulo: 'Realizar auditoria cirúrgica',
      descricao: 'Auditoria de cirurgia segura, uma vez por semana.',
      tipo: 'recorrente', periodicidade: 'semanal', dia_semana: 5, resp: ['wallace'] },
    { titulo: 'Realizar auditoria de identificação do paciente',
      descricao: 'Auditoria do protocolo de identificação, uma vez por semana.',
      tipo: 'recorrente', periodicidade: 'semanal', dia_semana: 5, resp: ['wallace'] },
    { titulo: 'Acompanhar as observações de higienização das mãos',
      descricao: 'Acompanhar as observações de higienização das mãos e estimular o grupo de observadores.',
      tipo: 'recorrente', periodicidade: 'mensal', dia_mes: 31, resp: ['balieiro'] },
    { titulo: 'Auditar LPP, queda e SBAR dos pacientes baixados no mês',
      descricao: 'Auditar lesão por pressão (LPP), quedas e a comunicação SBAR de todos os pacientes baixados no mês.',
      tipo: 'recorrente', periodicidade: 'mensal', dia_mes: 10, resp: ['balieiro'] },
    { titulo: 'Revisar o protocolo de identificação e o protocolo de flebite',
      descricao: 'Incluir no protocolo de identificação as alterações de pulseiras e etiquetas e revisar o protocolo de flebite.',
      tipo: 'pontual', prazoDias: 10, resp: ['balieiro'] },
    { titulo: 'Acompanhar as auditorias mensais do HEMOPA e os relatórios',
      descricao: 'Acompanhar as auditorias mensais do HEMOPA e os respectivos relatórios.',
      tipo: 'recorrente', periodicidade: 'mensal', dia_mes: 31, resp: ['balieiro'] },
    { titulo: 'Realizar treinamentos e orientações',
      descricao: 'Treinamentos e orientações conforme o cronograma ou a demanda.',
      tipo: 'sob_demanda', resp: ['leticia'] },
    { titulo: 'Reunião com os anestesistas',
      descricao: 'Etapa única, não recorrente.',
      tipo: 'pontual', prazoDias: 3, resp: ['leticia', 'balieiro'] },
    { titulo: 'Apresentação de indicadores e despacho com a chefia',
      descricao: 'Fazer a apresentação de indicadores no layout previsto e despachar com a chefia até o dia 15 de cada mês.',
      tipo: 'recorrente', periodicidade: 'mensal', dia_mes: 15, prioridade: 'alta', resp: ['balieiro'] },
    { titulo: 'Apresentar os indicadores mensais',
      descricao: 'Apresentação mensal dos indicadores. Responsável a confirmar.',
      tipo: 'recorrente', periodicidade: 'mensal', dia_mes: 31, resp: ['chefia'] },
    { titulo: 'Encaminhar os dados mensais da CGC',
      descricao: 'Salvar os dados mensais na planilha da CGC até o dia 05 de cada mês.',
      tipo: 'recorrente', periodicidade: 'mensal', dia_mes: 5, prioridade: 'alta', resp: ['balieiro'] },
    { titulo: 'Analisar incidentes conforme a demanda',
      descricao: 'Analisar os incidentes de acordo com a demanda de ocorrência.',
      tipo: 'sob_demanda', resp: ['leticia', 'balieiro'] }
  ];

  /* Observações de exemplo por nº da atividade (usadas em parte das concluídas). */
  var OBSERVACOES = {
    1: ['Sem pendências no SIGADAER.', 'Dois retornos recebidos e arquivados.', 'Retorno da Farmácia registrado.'],
    3: ['Notificações do mês lançadas no NOTIVISA.', 'Lançamentos conferidos com a planilha do setor.'],
    4: ['Retornos da semana salvos na pasta do setor.'],
    5: ['Checklist aplicado em 12 cirurgias; 1 não conformidade (pausa cirúrgica).', 'Sem não conformidades na semana.'],
    6: ['Auditadas 30 pulseiras; 2 com dados ilegíveis — setor orientado.', '100% de conformidade na Clínica Médica.'],
    7: ['Observações do mês consolidadas; adesão de 78%.', 'Grupo de observadores orientado.'],
    8: ['Auditados os prontuários dos pacientes de alta do mês.'],
    10: ['Relatório do HEMOPA recebido e arquivado.'],
    13: ['Indicadores apresentados e despacho realizado com a chefia.'],
    14: ['Indicadores apresentados na reunião da Direção.'],
    15: ['Planilha da CGC preenchida e enviada.']
  };

  /* Últimas ocorrências vencidas que ficam em aberto (atrasadas): ao
     menos uma de cada adjunto. */
  var ATRASADAS = { 1: 'pendente', 4: 'pendente', 6: 'em_andamento', 8: 'pendente' };

  /* "Não se aplica": nº da atividade → [posições entre as vencidas, justificativa]. */
  var NAO_SE_APLICA = {
    1: [[7, 22], 'SIGADAER fora do ar durante todo o expediente (manutenção do sistema).'],
    5: [[3], 'Centro cirúrgico sem cirurgias eletivas na semana (manutenção da autoclave).']
  };

  /* ---------- montagem ---------- */

  function criarEstadoInicial(hoje) {
    if (!Recorrencia.dataValida(hoje)) { throw new Error('Data inválida para a demonstração: ' + hoje); }

    var sorteio = criarSorteio(20261015);
    var novoId = criarGeradorIds(1954);
    var ano = hoje.slice(0, 4);
    var inicioPlano = somar(hoje, -75);

    function escolher(lista) { return lista[Math.floor(sorteio() * lista.length)]; }
    function inteiro(min, max) { return min + Math.floor(sorteio() * (max - min + 1)); }

    var estado = {
      versao: VERSAO_ESTADO,
      criado_para: hoje,
      setores: [], militares: [], feriados: montarFeriados(hoje),
      atividades: [], atividade_responsaveis: [], ocorrencias: [],
      evidencias: [], comentarios: [], avisos: [], avisos_destinatarios: [],
      avisos_ciencia: [], notificacoes: [], configuracoes: [], auditoria: [],
      usuarios: [], seq_auditoria: 0
    };

    var feriadosMapa = Recorrencia.normalizarFeriados(estado.feriados);

    /* O histórico cai em dias úteis, como no expediente real (nada de
       comentário da chefia num domingo): diaUtilAtras(n) é o n-ésimo dia
       útil antes de hoje; diaUtilAte(d) recua d até um dia útil. */
    function diaUtilAtras(n) {
      var d = hoje, contados = 0;
      while (contados < n) {
        d = somar(d, -1);
        if (Recorrencia.eDiaUtil(d, feriadosMapa)) { contados += 1; }
      }
      return d;
    }
    function diaUtilAte(d) { return Recorrencia.antecipar(d, feriadosMapa); }

    /* Implantação: cadastros 90 dias atrás; o plano foi lançado no último
       dia útil antes de começar a valer (data_inicio = hoje − 75). */
    var dataImplantacao = diaUtilAte(somar(hoje, -90));
    var dataLancamentoPlano = diaUtilAte(somar(inicioPlano, -1));

    /* ----- setores ----- */
    var setorNsp = { id: novoId(), sigla: 'NSP', nome: 'Núcleo de Segurança do Paciente',
                     cor: '#1b5aa8', ordem: 1, criado_em: instante(dataImplantacao, 8, 0) };
    var setorAqs = { id: novoId(), sigla: 'AQS', nome: 'Assessoria de Qualidade e Segurança',
                     cor: '#0b2f5c', ordem: 2, criado_em: instante(dataImplantacao, 8, 0) };
    estado.setores.push(setorNsp, setorAqs);

    /* ----- militares e usuários de acesso ----- */
    var M = {};
    function militar(chave, posto, nomeGuerra, email, setor, papel, diasUltimoAcesso, hora) {
      var usuarioId = novoId();
      var m = {
        id: novoId(), usuario_id: usuarioId, posto: posto, nome_guerra: nomeGuerra,
        nome_completo: null, email: email, setor_id: setor.id, papel: papel, ativo: true,
        deve_trocar_senha: false,
        ultimo_acesso: instante(diaUtilAtras(diasUltimoAcesso), hora, 12),
        criado_em: instante(dataImplantacao, 8, 5), atualizado_em: instante(dataImplantacao, 8, 5)
      };
      estado.militares.push(m);
      estado.usuarios.push({ id: usuarioId, email: email, mfa: [] });
      M[chave] = m;
      return m;
    }
    militar('aqs', '', 'AQS — conta institucional', 'aqs@demo.local', setorAqs, 'administrador', 3, 10);
    militar('chefia', 'Maj', 'Chefia NSP', 'chefia@demo.local', setorNsp, 'chefia', 1, 9);
    militar('leticia', 'Ten', 'Letícia', 'leticia@demo.local', setorNsp, 'adjunto', 1, 8);
    militar('wallace', 'Ten', 'Wallace', 'wallace@demo.local', setorNsp, 'adjunto', 1, 8);
    militar('balieiro', 'Ten', 'Balieiro', 'balieiro@demo.local', setorNsp, 'adjunto', 1, 7);

    function nome(chaveOuMilitar) {
      return Regras.nomeMilitar(typeof chaveOuMilitar === 'string' ? M[chaveOuMilitar] : chaveOuMilitar);
    }

    /* ----- notificações (ajudante) ----- */
    function notificar(destinatario, tipo, textos, refs, quando, lida) {
      estado.notificacoes.push({
        id: novoId(), destinatario_id: destinatario.id, tipo: tipo,
        titulo: textos.titulo, mensagem: textos.mensagem,
        atividade_id: refs.atividade_id || null, ocorrencia_id: refs.ocorrencia_id || null,
        aviso_id: refs.aviso_id || null, lida: !!lida, criado_em: quando
      });
    }

    /* Lida se tiver mais de dois dias (ninguém deixa o sino acumular tanto). */
    function lidaPorIdade(quando) {
      return Recorrencia.diasEntre(dataDoInstante(quando), hoje) > 2;
    }

    /* ----- atividades e responsáveis ----- */
    var A = {};
    PLANO.forEach(function (p, i) {
      var numero = i + 1;
      var prazo = null;
      if (p.tipo === 'pontual') { prazo = proximoDiaUtil(somar(hoje, p.prazoDias), feriadosMapa); }
      var criadoEm = instante(dataLancamentoPlano, 8, 30 + i);
      var a = {
        id: novoId(), ordem: numero, titulo: p.titulo, descricao: p.descricao, setor_id: setorNsp.id,
        tipo: p.tipo, periodicidade: p.periodicidade || null,
        dia_semana: p.dia_semana || null, dia_mes: p.dia_mes || null, mes_inicio: null,
        prazo: prazo, antecipar_dia_util: true, prioridade: p.prioridade || 'normal',
        exige_evidencia: false, ativa: true, data_inicio: inicioPlano,
        criado_por: M.chefia.id, criado_em: criadoEm, atualizado_em: criadoEm
      };
      estado.atividades.push(a);
      A[numero] = a;
      a.__resp = p.resp.map(function (chave) { return M[chave]; });
      a.__resp.forEach(function (m) {
        estado.atividade_responsaveis.push({ atividade_id: a.id, militar_id: m.id });
        if (m.id !== M.chefia.id) {
          notificar(m, 'atribuicao',
            textoNotificacao('atribuicao', { atividade_titulo: a.titulo }),
            { atividade_id: a.id }, criadoEm, true);
        }
      });
    });

    /* ----- ocorrências ----- */
    var ocorrenciasPorAtividade = {};

    function novaOcorrencia(a, campos) {
      var oc = {
        id: novoId(), atividade_id: a.id, referencia: null, titulo_execucao: null, prazo: null,
        status: 'pendente', observacao: '', justificativa: null, iniciada_em: null,
        concluida_em: null, concluida_por: null, concluida_por_nome: null, criado_por: null,
        criado_em: null, atualizado_em: null
      };
      Object.keys(campos).forEach(function (k) { oc[k] = campos[k]; });
      if (!oc.atualizado_em) { oc.atualizado_em = oc.concluida_em || oc.iniciada_em || oc.criado_em; }
      estado.ocorrencias.push(oc);
      (ocorrenciasPorAtividade[a.ordem] = ocorrenciasPorAtividade[a.ordem] || []).push(oc);
      return oc;
    }

    function concluir(oc, militarAutor, data, hora, minuto) {
      oc.status = 'concluida';
      oc.concluida_em = instante(data, hora, minuto);
      oc.concluida_por = militarAutor.id;
      oc.concluida_por_nome = nome(militarAutor);
      oc.atualizado_em = oc.concluida_em;
    }

    /* Data em que gerar_ocorrencias() criou a ocorrência: até 31 dias antes
       do prazo (no mesmo dia, na diária), nunca antes do início do plano. */
    function dataCriacao(a, prazo) {
      var antes = a.periodicidade === 'diaria_util' ? prazo : somar(prazo, -31);
      return maior(antes, inicioPlano);
    }

    estado.atividades.forEach(function (a) {
      if (a.tipo !== 'recorrente') { return; }
      var numero = a.ordem;
      var ate = a.periodicidade === 'diaria_util' ? hoje : somar(hoje, 31);
      var lista = Recorrencia.datas(a, a.data_inicio, ate, feriadosMapa);
      var vencidas = lista.filter(function (d) { return d.prazo < hoje; });
      var ultimaVencida = vencidas.length ? vencidas[vencidas.length - 1].referencia : null;
      var primeiraFutura = null;
      var nsa = NAO_SE_APLICA[numero];
      var posicaoVencida = -1;

      lista.forEach(function (d) {
        var criadoData = dataCriacao(a, d.prazo);
        /* gerar_ocorrencias() roda às 00:05 (pg_cron) */
        var criadoEm = instante(criadoData, 0, 5);
        var oc = novaOcorrencia(a, { referencia: d.referencia, prazo: d.prazo, criado_em: criadoEm });
        var autor = a.__resp.length > 1 ? escolher(a.__resp) : a.__resp[0];

        if (d.prazo < hoje) {
          posicaoVencida += 1;
          if (d.referencia === ultimaVencida && ATRASADAS[numero]) {
            if (ATRASADAS[numero] === 'em_andamento') {
              oc.status = 'em_andamento';
              oc.iniciada_em = instante(maior(diaUtilAte(somar(d.prazo, -1)), criadoData), 9, 20);
              oc.atualizado_em = oc.iniciada_em;
            }
            return;
          }
          if (nsa && nsa[0].indexOf(posicaoVencida) >= 0) {
            oc.status = 'nao_se_aplica';
            oc.justificativa = nsa[1];
            oc.atualizado_em = instante(d.prazo, 16, 40);
            return;
          }
          /* ~10% concluídas fora do prazo (1 a 3 dias úteis depois, sempre
             antes de hoje); as demais no dia do prazo ou alguns dias antes. */
          var dataConclusao = null;
          if (sorteio() < 0.09) {
            var atrasada = proximoDiaUtil(somar(d.prazo, inteiro(1, 3)), feriadosMapa);
            if (atrasada < hoje) { dataConclusao = atrasada; }
          }
          if (!dataConclusao) {
            var folga = a.periodicidade === 'diaria_util' ? 0
              : (a.periodicidade === 'semanal' ? inteiro(0, 2) : inteiro(0, 4));
            dataConclusao = diaUtilAte(somar(d.prazo, -folga));
            if (dataConclusao < criadoData) { dataConclusao = d.prazo; }
          }
          if (a.periodicidade !== 'diaria_util' && sorteio() < 0.5) {
            var dataInicio = diaUtilAte(somar(dataConclusao, -inteiro(1, 3)));
            if (dataInicio < criadoData) { dataInicio = dataConclusao; }
            oc.iniciada_em = instante(dataInicio, inteiro(7, 8), inteiro(0, 59));
          }
          concluir(oc, autor, dataConclusao, inteiro(8, 16), inteiro(0, 59));
          if (OBSERVACOES[numero] && sorteio() < 0.35) { oc.observacao = escolher(OBSERVACOES[numero]); }
          return;
        }

        /* Vence hoje ou depois. */
        if (primeiraFutura === null) {
          primeiraFutura = d.referencia;
          if (numero === 13 || numero === 7 || numero === 5) {
            oc.status = 'em_andamento';
            oc.iniciada_em = instante(maior(diaUtilAtras(2), criadoData), 10, 15);
            oc.atualizado_em = oc.iniciada_em;
            if (numero === 13) { oc.observacao = 'Slides em montagem; faltam os dados de quedas.'; }
          } else if (numero === 10 && criadoData <= diaUtilAtras(1)) {
            /* Concluída adiantada: também conta na conformidade. */
            concluir(oc, autor, diaUtilAtras(1), 15, 5);
            oc.observacao = 'Relatório do HEMOPA do mês já recebido e conferido.';
          }
        }
      });
    });

    /* Pontuais: a ocorrência única 'P', criada junto com a atividade. */
    var oc9 = novaOcorrencia(A[9], {
      referencia: 'P', prazo: A[9].prazo, status: 'em_andamento',
      criado_em: instante(dataLancamentoPlano, 8, 50), criado_por: M.chefia.id,
      iniciada_em: instante(diaUtilAtras(5), 9, 0),
      observacao: 'Minuta em revisão com a Enfermagem.'
    });
    var oc12 = novaOcorrencia(A[12], {
      referencia: 'P', prazo: A[12].prazo, criado_em: instante(dataLancamentoPlano, 8, 51), criado_por: M.chefia.id
    });

    /* Sob demanda: execuções registradas pelos responsáveis ("Registrar
       execução"). Sem status em 'extra', é registrada já concluída. */
    function execucao(a, autor, titulo, diasUteisAtras, hora, extra) {
      var dataCriado = diaUtilAtras(diasUteisAtras);
      var campos = { titulo_execucao: titulo, criado_por: autor.id, criado_em: instante(dataCriado, hora, 10) };
      Object.keys(extra || {}).forEach(function (k) { campos[k] = extra[k]; });
      var oc = novaOcorrencia(a, campos);
      if (!extra || !extra.status) { concluir(oc, autor, dataCriado, hora, 40); }
      return oc;
    }
    var exNot112 = execucao(A[2], M.leticia, 'Notificação ' + ano + '/112 — erro de medicação (encaminhada à Clínica Médica)', 14, 10);
    execucao(A[2], M.leticia, 'Notificação ' + ano + '/118 — flebite (encaminhada à Enfermagem)', 7, 14);
    execucao(A[2], M.leticia, 'Notificação ' + ano + '/121 — falha na identificação do paciente', 2, 11, {
      status: 'em_andamento', prazo: proximoDiaUtil(somar(hoje, 5), feriadosMapa),
      iniciada_em: instante(diaUtilAtras(2), 11, 15), observacao: 'Aguardando o relato do setor.'
    });
    var exTreinoUti = execucao(A[11], M.leticia, 'Treinamento: higiene das mãos — UTI', 21, 9);
    execucao(A[11], M.leticia, 'Orientação: identificação do paciente — Pediatria', 9, 15);
    execucao(A[11], M.leticia, 'Treinamento: prevenção de quedas — Clínica Médica', 1, 16, {
      status: 'pendente', prazo: proximoDiaUtil(somar(hoje, 8), feriadosMapa),
      observacao: 'Agendado com a supervisão de Enfermagem.'
    });
    var exIncidente037 = execucao(A[16], M.balieiro, 'Incidente ' + ano + '/037 — queda no leito', 18, 10);
    var exIncidente041 = execucao(A[16], M.leticia, 'Incidente ' + ano + '/041 — troca de pulseira de identificação', 3, 9, {
      status: 'em_andamento', prazo: proximoDiaUtil(somar(hoje, 5), feriadosMapa),
      iniciada_em: instante(diaUtilAtras(3), 9, 30)
    });
    exNot112.observacao = 'Plano de ação solicitado à Clínica Médica.';

    /* ----- evidências (só metadados; o conteúdo é fictício) ----- */
    function nomeArquivoSeguro(nomeArquivo) {
      return String(nomeArquivo).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9._-]+/g, '-');
    }

    function evidencia(oc, a, nomeArquivo, tamanho, autor, quando, descricao) {
      var id = novoId();
      var ext = Regras.extensaoDe(nomeArquivo);
      estado.evidencias.push({
        id: id, atividade_id: a.id, ocorrencia_id: oc ? oc.id : null,
        storage_path: a.id + '/' + (oc ? oc.id : 'geral') + '/' + id + '-' + nomeArquivoSeguro(nomeArquivo),
        nome: nomeArquivo, mime: Regras.TIPOS_ARQUIVO[ext] || 'application/octet-stream',
        tamanho: tamanho, descricao: descricao || '', enviado_por: autor.id,
        enviado_por_nome: nome(autor), enviado_em: quando
      });
    }

    function minutosAntes(iso, minutos) {
      return new Date(new Date(iso).getTime() - minutos * 60000).toISOString();
    }

    function mesAnterior(referenciaMensal) {
      var a = Number(referenciaMensal.slice(1, 5)), m = Number(referenciaMensal.slice(6, 8)) - 1;
      if (m === 0) { m = 12; a -= 1; }
      return { ano: a, mes: m };
    }

    var MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto',
                 'setembro', 'outubro', 'novembro', 'dezembro'];
    var MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

    function concluidas(numero) {
      return (ocorrenciasPorAtividade[numero] || []).filter(function (oc) { return oc.status === 'concluida'; });
    }
    function ultimaConcluidaVencida(numero) {
      var lista = concluidas(numero).filter(function (oc) { return oc.prazo && oc.prazo < hoje; });
      return lista.length ? lista[lista.length - 1] : null;
    }

    /* Apresentação de indicadores: um arquivo por mês concluído (o mês
       apresentado é o anterior ao da referência). */
    concluidas(13).forEach(function (oc) {
      var ref = mesAnterior(oc.referencia);
      evidencia(oc, A[13], 'Indicadores-' + MESES[ref.mes - 1] + '-' + ref.ano + '.pptx',
        2340112 + inteiro(0, 400000), M.balieiro, minutosAntes(oc.concluida_em, 12),
        'Apresentação no layout previsto.');
    });
    /* A do mês corrente, ainda em andamento, já tem a versão preliminar. */
    (ocorrenciasPorAtividade[13] || []).filter(function (oc) { return oc.status === 'em_andamento'; })
      .forEach(function (oc) {
        var ref = mesAnterior(oc.referencia);
        evidencia(oc, A[13], 'Indicadores-' + MESES[ref.mes - 1] + '-' + ref.ano + '.pptx',
          2518337, M.balieiro, instante(maior(diaUtilAtras(1), dataDoInstante(oc.iniciada_em)), 17, 45),
          'Versão preliminar para o despacho com a chefia.');
      });
    /* CGC: planilha do mês anterior, entregue até o dia 05. */
    concluidas(15).forEach(function (oc) {
      var ref = mesAnterior(oc.referencia);
      evidencia(oc, A[15], 'Planilha-CGC-' + MESES_ABREV[ref.mes - 1] + ref.ano + '.xlsx',
        84213 + inteiro(0, 9000), M.balieiro, minutosAntes(oc.concluida_em, 8), '');
    });
    var ultimaCirurgica = ultimaConcluidaVencida(5);
    if (ultimaCirurgica) {
      evidencia(ultimaCirurgica, A[5], 'Auditoria-cirurgica-' + ultimaCirurgica.referencia.slice(6).replace('W', 'S') + '.pdf',
        412876, M.wallace, minutosAntes(ultimaCirurgica.concluida_em, 15), 'Checklist de cirurgia segura consolidado.');
    }
    var ultimaIdentificacao = ultimaConcluidaVencida(6);
    if (ultimaIdentificacao) {
      evidencia(ultimaIdentificacao, A[6], 'Auditoria-identificacao-' + ultimaIdentificacao.referencia.slice(6).replace('W', 'S') + '.pdf',
        298433, M.wallace, minutosAntes(ultimaIdentificacao.concluida_em, 20), '');
    }
    var ultimoNotivisa = ultimaConcluidaVencida(3);
    if (ultimoNotivisa) {
      var refNotivisa = ultimoNotivisa.referencia.slice(1);
      evidencia(ultimoNotivisa, A[3], 'Comprovante-NOTIVISA-' + MESES_ABREV[Number(refNotivisa.slice(5, 7)) - 1] +
        refNotivisa.slice(0, 4) + '.pdf', 156002, M.leticia, minutosAntes(ultimoNotivisa.concluida_em, 5),
        'Comprovantes de envio do período.');
    }
    evidencia(null, A[12], 'Ata-reuniao-anestesistas.docx', 48211, M.balieiro,
      instante(diaUtilAtras(2), 14, 20), 'Ata da última reunião com a Anestesiologia (referência para a pauta).');
    evidencia(oc9, A[9], 'Minuta-protocolo-identificacao-v2.docx', 97654, M.balieiro,
      instante(diaUtilAtras(4), 15, 25), 'Minuta com as novas pulseiras e etiquetas.');
    evidencia(exTreinoUti, A[11], 'Lista-presenca-higiene-maos-UTI.pdf', 211340, M.leticia,
      minutosAntes(exTreinoUti.concluida_em, 3), 'Lista de presença assinada.');
    evidencia(exIncidente037, A[16], 'Analise-incidente-037-queda.pdf', 187520, M.balieiro,
      minutosAntes(exIncidente037.concluida_em, 6), 'Análise de causa raiz e plano de ação.');

    /* ----- comentários ----- */
    function comentar(a, oc, autor, texto, quando) {
      var c = {
        id: novoId(), atividade_id: a.id, ocorrencia_id: oc ? oc.id : null,
        autor_id: autor.id, autor_nome: nome(autor), autor_papel: autor.papel,
        texto: texto, criado_em: quando
      };
      estado.comentarios.push(c);
      /* Mesma regra do gatilho: responsáveis e chefias ativas, menos o autor. */
      var destinos = {};
      a.__resp.forEach(function (m) { destinos[m.id] = m; });
      estado.militares.forEach(function (m) { if (m.ativo && m.papel === 'chefia') { destinos[m.id] = m; } });
      delete destinos[autor.id];
      Object.keys(destinos).forEach(function (id) {
        notificar(destinos[id], 'comentario',
          textoNotificacao('comentario', { autor_nome: c.autor_nome, autor_papel: c.autor_papel,
            atividade_titulo: a.titulo, texto: texto }),
          { atividade_id: a.id, ocorrencia_id: c.ocorrencia_id }, quando, lidaPorIdade(quando));
      });
      return c;
    }

    function ultimaDe(numero, status) {
      var lista = (ocorrenciasPorAtividade[numero] || []).filter(function (oc) {
        return oc.prazo && oc.prazo < hoje && (!status || oc.status === status);
      });
      return lista.length ? lista[lista.length - 1] : null;
    }

    var ontem = diaUtilAtras(1);
    var atrasadaWallace = ultimaDe(6, 'em_andamento');
    if (atrasadaWallace) {
      comentar(A[6], atrasadaWallace, M.chefia,
        'Ten Wallace, a auditoria de identificação desta semana ainda está em aberto. Consegue concluir até amanhã?',
        instante(maior(ontem, atrasadaWallace.prazo), 10, 20));
      comentar(A[6], atrasadaWallace, M.wallace,
        'Sim, senhor. Falta consolidar os dados da Clínica Cirúrgica; concluo amanhã cedo.',
        instante(maior(ontem, atrasadaWallace.prazo), 11, 2));
    }
    var indicadoresAnterior = ultimaConcluidaVencida(13);
    if (indicadoresAnterior) {
      var dataApresentacao = dataDoInstante(indicadoresAnterior.concluida_em);
      var dataElogio = maior(menor(proximoDiaUtil(somar(dataApresentacao, 1), feriadosMapa), ontem), dataApresentacao);
      comentar(A[13], indicadoresAnterior, M.chefia,
        'Excelente apresentação, Ten Balieiro. Indicadores claros e no layout previsto. Parabéns!',
        instante(dataElogio, dataElogio === dataApresentacao ? 17 : 14, dataElogio === dataApresentacao ? 20 : 5));
    }
    if (ultimoNotivisa) {
      comentar(A[3], ultimoNotivisa, M.leticia,
        'Lançadas 14 notificações no NOTIVISA. Duas aguardam retorno do setor para complementação.',
        new Date(new Date(ultimoNotivisa.concluida_em).getTime() + 4 * 60000).toISOString());
    }
    var atrasadaBalieiro = ultimaDe(8, 'pendente');
    if (atrasadaBalieiro) {
      comentar(A[8], atrasadaBalieiro, M.balieiro,
        'Aguardando a lista de altas do SAME para fechar a auditoria do mês.',
        instante(maior(diaUtilAtras(2), atrasadaBalieiro.prazo), 16, 10));
    }
    comentar(A[9], oc9, M.balieiro,
      'Minuta com as alterações de pulseiras e etiquetas enviada à Enfermagem para validação.',
      instante(diaUtilAtras(4), 15, 30));
    comentar(A[9], oc9, M.chefia,
      'Ótimo. Inclua também a etiqueta de alergia na revisão.',
      instante(diaUtilAtras(3), 9, 10));
    comentar(A[12], oc12, M.chefia,
      'Agendem com a Anestesiologia e confirmem a sala. Pauta: checklist de cirurgia segura e notificações do centro cirúrgico.',
      instante(diaUtilAtras(2), 8, 50));
    comentar(A[16], exIncidente037, M.balieiro,
      'Plano de ação recebido da Clínica Médica; acompanharemos a instalação das grades nos leitos.',
      instante(diaUtilAtras(17), 11, 0));
    comentar(A[16], exIncidente041, M.leticia,
      'Setor notificado; aguardando o relato da equipe do plantão noturno.',
      instante(diaUtilAtras(2), 8, 35));

    /* ----- avisos, destinatários e ciências ----- */
    function aviso(campos, destinatarios, autor) {
      var av = {
        id: novoId(), titulo: '', mensagem: '', nivel: 'informativo', para_todos: true, prazo: null,
        atividade_id: null, fixado: false, expira_em: null, criado_por: autor.id,
        criado_por_nome: nome(autor), criado_em: null, atualizado_em: null
      };
      Object.keys(campos).forEach(function (k) { av[k] = campos[k]; });
      av.atualizado_em = av.criado_em;
      estado.avisos.push(av);
      var alvos;
      if (av.para_todos) {
        alvos = estado.militares.filter(function (m) { return m.ativo; });
      } else {
        alvos = destinatarios;
        destinatarios.forEach(function (m) {
          estado.avisos_destinatarios.push({ aviso_id: av.id, militar_id: m.id });
        });
      }
      alvos.forEach(function (m) {
        if (m.id === autor.id) { return; }
        notificar(m, 'aviso',
          textoNotificacao('aviso', { nivel: av.nivel, aviso_titulo: av.titulo, mensagem: av.mensagem }),
          { aviso_id: av.id, atividade_id: av.atividade_id }, av.criado_em, false);
      });
      return av;
    }

    function ciencia(av, m, quando) {
      estado.avisos_ciencia.push({ aviso_id: av.id, militar_id: m.id, ciente_em: quando });
      /* Quem deu ciência já viu a notificação. */
      estado.notificacoes.forEach(function (n) {
        if (n.aviso_id === av.id && n.destinatario_id === m.id) { n.lida = true; }
      });
    }

    var proximaCgc = Recorrencia.proximas(A[15], 1, hoje, feriadosMapa)[0];
    var avisoCgc = aviso({
      titulo: 'Prazo da CGC: dia 05',
      mensagem: 'Os dados mensais da CGC devem estar salvos na planilha até o dia 05 de cada mês. ' +
        'Quem depender de informações de outros setores, solicite com antecedência.',
      nivel: 'urgente', para_todos: true, prazo: proximaCgc ? proximaCgc.prazo : null,
      atividade_id: A[15].id, fixado: true, criado_em: instante(diaUtilAtras(5), 8, 10)
    }, null, M.chefia);
    var avisoProtocolo = aviso({
      titulo: 'Revisão do protocolo de identificação',
      mensagem: 'Incluir as alterações de pulseiras e etiquetas e revisar o protocolo de flebite.\n' +
        'Enviem a minuta para validação da chefia antes do prazo.',
      nivel: 'importante', para_todos: false, prazo: A[9].prazo, atividade_id: A[9].id,
      criado_em: instante(diaUtilAtras(4), 9, 0)
    }, [M.balieiro, M.wallace], M.chefia);
    var avisoBoasVindas = aviso({
      titulo: 'Bem-vindos à ferramenta de gestão de atividades',
      mensagem: 'As missões do NSP passam a ser registradas aqui. Anexem as evidências na própria ' +
        'ocorrência e usem os comentários para tirar dúvidas. Problemas de acesso: AQS.',
      nivel: 'informativo', para_todos: true, expira_em: somar(hoje, 14),
      criado_em: instante(diaUtilAtras(2), 14, 0)
    }, null, M.aqs);

    ciencia(avisoCgc, M.leticia, instante(diaUtilAtras(5), 9, 30));
    ciencia(avisoCgc, M.balieiro, instante(diaUtilAtras(4), 8, 0));
    ciencia(avisoProtocolo, M.balieiro, instante(diaUtilAtras(4), 10, 0));
    /* A Ten Letícia ainda não deu ciência do aviso de boas-vindas: quem abre
       a demonstração como adjunta já vê, no Início, um aviso com "Ciente". */
    ciencia(avisoBoasVindas, M.chefia, instante(diaUtilAtras(2), 16, 0));

    /* ----- notificações de prazo (as de hoje, como o cron das 00:05) ----- */
    var amanha = somar(hoje, 1);
    var respPorAtividade = {};
    estado.atividades.forEach(function (a) { respPorAtividade[a.id] = a.__resp; });
    var atividadePorId = {};
    estado.atividades.forEach(function (a) { atividadePorId[a.id] = a; });
    estado.ocorrencias.forEach(function (oc) {
      if ((oc.status !== 'pendente' && oc.status !== 'em_andamento') || !oc.prazo) { return; }
      if (oc.prazo !== hoje && oc.prazo !== amanha) { return; }
      var a = atividadePorId[oc.atividade_id];
      respPorAtividade[a.id].forEach(function (m) {
        notificar(m, 'prazo',
          textoNotificacao('prazo', { prazo: oc.prazo, hoje: hoje, atividade_titulo: a.titulo,
            titulo_execucao: oc.titulo_execucao }),
          { atividade_id: a.id, ocorrencia_id: oc.id }, instante(hoje, 0, 5), false);
      });
    });

    /* ----- configurações ----- */
    estado.configuracoes.push({
      chave: 'contatos',
      valor: {
        email_institucional: 'aqs@demo.local',
        responsavel_tecnico: 'Ten Balieiro (NSP) — até a passagem da função',
        telefone: 'Ramal 0000 (fictício)',
        observacoes: 'Dados de exemplo da demonstração. No sistema real, use o e-mail e o ramal ' +
          'institucionais da AQS, nunca os de uma pessoa.'
      },
      atualizado_em: instante(diaUtilAte(somar(hoje, -60)), 10, 0), atualizado_por: M.aqs.id
    });
    estado.configuracoes.push({
      chave: 'ultimo_backup',
      valor: { em: instante(somar(hoje, -40), 16, 20), por_nome: nome('chefia') },
      atualizado_em: instante(somar(hoje, -40), 16, 20), atualizado_por: M.chefia.id
    });

    /* ----- auditoria (pequeno histórico) ----- */
    function auditar(quando, autor, tabela, operacao, registroId, antes, depois) {
      estado.auditoria.push({
        id: 0, quando: quando, militar_id: autor ? autor.id : null,
        militar_nome: autor ? nome(autor) : null, usuario_id: autor ? autor.usuario_id : null,
        tabela: tabela, operacao: operacao, registro_id: String(registroId),
        antes: antes || null, depois: depois || null
      });
    }
    function copia(obj, campos) {
      var r = {};
      campos.forEach(function (c) { r[c] = obj[c]; });
      return r;
    }
    auditar(setorNsp.criado_em, null, 'setores', 'INSERT', setorNsp.id, null, copia(setorNsp, ['sigla', 'nome']));
    auditar(setorAqs.criado_em, null, 'setores', 'INSERT', setorAqs.id, null, copia(setorAqs, ['sigla', 'nome']));
    auditar(M.aqs.criado_em, null, 'militares', 'INSERT', M.aqs.id, null,
      copia(M.aqs, ['posto', 'nome_guerra', 'email', 'papel']));
    auditar(instante(diaUtilAte(somar(hoje, -89)), 9, 0), M.aqs, 'militares', 'UPDATE', M.leticia.id,
      { usuario_id: null }, { usuario_id: M.leticia.usuario_id });
    auditar(A[13].criado_em, M.chefia, 'atividades', 'INSERT', A[13].id, null,
      copia(A[13], ['ordem', 'titulo', 'tipo', 'periodicidade', 'dia_mes']));
    auditar(instante(diaUtilAte(somar(hoje, -60)), 10, 0), M.aqs, 'configuracoes', 'INSERT', 'contatos', null,
      { chave: 'contatos' });
    auditar(instante(diaUtilAte(somar(hoje, -50)), 11, 30), M.chefia, 'atividades', 'UPDATE', A[13].id,
      { prioridade: 'normal' }, { prioridade: 'alta' });
    auditar(instante(somar(hoje, -40), 16, 20), M.chefia, 'configuracoes', 'UPDATE', 'ultimo_backup',
      null, { chave: 'ultimo_backup' });
    auditar(avisoCgc.criado_em, M.chefia, 'avisos', 'INSERT', avisoCgc.id, null,
      copia(avisoCgc, ['titulo', 'nivel', 'para_todos']));
    auditar(avisoProtocolo.criado_em, M.chefia, 'avisos', 'INSERT', avisoProtocolo.id, null,
      copia(avisoProtocolo, ['titulo', 'nivel', 'para_todos']));
    auditar(oc9.iniciada_em, M.balieiro, 'ocorrencias', 'UPDATE', oc9.id,
      { status: 'pendente' }, { status: 'em_andamento' });
    auditar(instante(diaUtilAtras(2), 8, 40), M.leticia, 'comentarios', 'DELETE', novoId(),
      { texto: 'Comentário duplicado (enviado duas vezes).' }, null);
    auditar(avisoBoasVindas.criado_em, M.aqs, 'avisos', 'INSERT', avisoBoasVindas.id, null,
      copia(avisoBoasVindas, ['titulo', 'nivel', 'para_todos']));
    estado.auditoria.sort(function (a, b) { return a.quando < b.quando ? -1 : (a.quando > b.quando ? 1 : 0); });
    estado.auditoria.forEach(function (r, i) { r.id = i + 1; });
    estado.seq_auditoria = estado.auditoria.length;

    /* ----- limpeza: tira os campos auxiliares ----- */
    estado.atividades.forEach(function (a) { delete a.__resp; });
    estado.notificacoes.sort(function (a, b) { return a.criado_em < b.criado_em ? -1 : (a.criado_em > b.criado_em ? 1 : 0); });

    return estado;
  }

  return {
    VERSAO_ESTADO: VERSAO_ESTADO,
    criarEstadoInicial: criarEstadoInicial,
    textoNotificacao: textoNotificacao,
    feriadosDoAno: feriadosDoAno,
    resumir: resumir
  };
})();
