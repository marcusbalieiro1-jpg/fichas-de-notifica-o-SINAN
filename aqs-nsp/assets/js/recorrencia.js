/* =========================================================================
   HABE – AQS e NSP — recorrência das atividades
   Gera as datas (referência + prazo) de cada período de uma atividade
   recorrente. É o ESPELHO EXATO da função SQL privado.datas_ocorrencia:
   mesmas referências, mesmo critério de inclusão, mesma antecipação. Quem
   mexer numa precisa mexer na outra e rodar testes/paridade-recorrencia.mjs.
   Ver docs/ARQUITETURA.md, seção 4.

   Todas as datas são texto 'AAAA-MM-DD' (datas de calendário, como o tipo
   date do Postgres). Por dentro, cada data vira um número inteiro de dias
   desde 1970-01-01 calculado com Date.UTC: assim nada depende do fuso nem
   do horário de verão do aparelho em que a página roda.
   ========================================================================= */

var Recorrencia = (function () {
  'use strict';

  var MS_DIA = 86400000;

  /* Proteção contra laço infinito ao antecipar (só aconteceria com uma
     tabela de feriados absurda, cobrindo meses seguidos). */
  var LIMITE_RECUO = 400;

  var PREFIXOS = { mensal: 'M', trimestral: 'T', semestral: 'H', anual: 'A' };

  /* Tamanho aproximado de um período, em dias — só para dimensionar a
     janela de busca de proximas(). */
  var PASSO_DIAS = {
    diaria_util: 7, semanal: 7, mensal: 31, trimestral: 92, semestral: 184, anual: 366
  };

  /* ---------- aritmética de calendário ---------- */

  function doisDigitos(n) { return (n < 10 ? '0' : '') + n; }

  /* 'AAAA-MM-DD' → nº de dias desde 1970-01-01, ou null se a data for
     inválida (inclusive 2026-02-30, que o Date.UTC "corrigiria" calado). */
  function paraDia(texto) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(texto === null || texto === undefined ? '' : texto).slice(0, 10));
    if (!m) { return null; }
    var ano = Number(m[1]), mes = Number(m[2]), dia = Number(m[3]);
    if (mes < 1 || mes > 12 || dia < 1 || dia > ultimoDiaDoMes(ano, mes)) { return null; }
    return Math.round(Date.UTC(ano, mes - 1, dia) / MS_DIA);
  }

  function paraTexto(dia) {
    var d = new Date(dia * MS_DIA);
    return d.getUTCFullYear() + '-' + doisDigitos(d.getUTCMonth() + 1) + '-' + doisDigitos(d.getUTCDate());
  }

  function diaDe(ano, mes, dia) {
    return Math.round(Date.UTC(ano, mes - 1, dia) / MS_DIA);
  }

  /* Dia 0 de mês+1 é o último dia do mês (o Date.UTC faz a conta de
     fevereiro e dos anos bissextos). */
  function ultimoDiaDoMes(ano, mes) {
    return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  }

  /* Dia da semana ISO: 1 = segunda … 7 = domingo. 1970-01-01 foi quinta (4). */
  function diaSemanaDe(dia) {
    return (((dia % 7) + 7 + 3) % 7) + 1;
  }

  function anoDe(dia) { return new Date(dia * MS_DIA).getUTCFullYear(); }
  function mesDe(dia) { return new Date(dia * MS_DIA).getUTCMonth() + 1; }

  /* Semana ISO 8601: a semana pertence ao ano da sua quinta-feira. */
  function semanaIsoDe(dia) {
    var quinta = dia - diaSemanaDe(dia) + 4;
    var ano = anoDe(quinta);
    return { ano: ano, semana: Math.floor((quinta - diaDe(ano, 1, 1)) / 7) + 1 };
  }

  /* ---------- feriados e dia útil ---------- */

  /* Aceita { 'AAAA-MM-DD': true }, ['AAAA-MM-DD', ...] ou [{ data: ... }]
     (o formato de listarFeriados), e devolve sempre o objeto-mapa. */
  function normalizarFeriados(feriados) {
    if (!feriados) { return {}; }
    if (Array.isArray(feriados)) {
      var mapa = {};
      feriados.forEach(function (f) {
        var data = (f && typeof f === 'object') ? f.data : f;
        if (data) { mapa[String(data).slice(0, 10)] = true; }
      });
      return mapa;
    }
    return feriados;
  }

  /* Dia útil = segunda a sexta que não esteja na tabela de feriados. */
  function eDiaUtilDia(dia, mapa) {
    return diaSemanaDe(dia) <= 5 && !mapa[paraTexto(dia)];
  }

  /* Recua um dia por vez até cair num dia útil. */
  function anteciparDia(dia, mapa) {
    var passos = 0;
    while (!eDiaUtilDia(dia, mapa) && passos < LIMITE_RECUO) {
      dia -= 1;
      passos += 1;
    }
    return dia;
  }

  function inteiroEntre(valor, minimo, maximo) {
    if (valor === null || valor === undefined || valor === '') { return null; }
    var n = Number(valor);
    if (!isFinite(n) || Math.floor(n) !== n || n < minimo || n > maximo) { return null; }
    return n;
  }

  /* ---------- geração ---------- */

  /* Lista de { referencia, prazo } da atividade com prazo final em [de, ate].
     Não olha 'ativa' nem 'data_inicio': quem chama decide a janela (ver
     janelaGeracao) — igual à função SQL, que só recebe a regra e o intervalo. */
  function datas(atividade, de, ate, feriados) {
    if (!atividade) { return []; }
    if (atividade.tipo && atividade.tipo !== 'recorrente') { return []; }

    var inicio = paraDia(de);
    var fim = paraDia(ate);
    if (inicio === null || fim === null || inicio > fim) { return []; }

    var mapa = normalizarFeriados(feriados);
    /* A coluna é not null default true; ausente aqui conta como o padrão. */
    var antecipa = atividade.antecipar_dia_util !== false;
    var periodicidade = atividade.periodicidade;
    var lista = [];
    var dia;

    function incluir(referencia, prazo) {
      if (prazo >= inicio && prazo <= fim) {
        lista.push({ referencia: referencia, prazo: paraTexto(prazo) });
      }
    }

    if (periodicidade === 'diaria_util') {
      /* Só dias úteis geram ocorrência; a antecipação não se aplica. */
      for (dia = inicio; dia <= fim; dia += 1) {
        if (eDiaUtilDia(dia, mapa)) { incluir('D' + paraTexto(dia), dia); }
      }

    } else if (periodicidade === 'semanal') {
      var diaDaSemana = inteiroEntre(atividade.dia_semana, 1, 7);
      if (diaDaSemana === null) { return []; }
      /* Uma semana antes de 'de' até uma depois de 'ate': o alvo da semana
         seguinte a 'ate' pode ser antecipado para dentro do intervalo
         (ex.: sexta 01/01/2027 vira 31/12/2026). */
      var primeiraSegunda = (inicio - 7) - diaSemanaDe(inicio - 7) + 1;
      var ultimaSegunda = (fim + 7) - diaSemanaDe(fim + 7) + 1;
      for (var segunda = primeiraSegunda; segunda <= ultimaSegunda; segunda += 7) {
        var alvo = segunda + diaDaSemana - 1;
        var semana = semanaIsoDe(segunda);
        incluir('S' + semana.ano + '-W' + doisDigitos(semana.semana),
                antecipa ? anteciparDia(alvo, mapa) : alvo);
      }

    } else if (PREFIXOS[periodicidade]) {
      var diaMes = inteiroEntre(atividade.dia_mes, 1, 31);
      if (diaMes === null) { return []; }
      var mesInicio = null;
      if (periodicidade !== 'mensal') {
        mesInicio = inteiroEntre(atividade.mes_inicio, 1, 12);
        if (mesInicio === null) { return []; }
      }
      /* Meses contados como ano*12 + (mês-1), do mês anterior a 'de' ao
         mês seguinte a 'ate' (mesmo motivo da semana extra acima). */
      var primeiroMes = anoDe(inicio) * 12 + mesDe(inicio) - 1 - 1;
      var ultimoMes = anoDe(fim) * 12 + mesDe(fim) - 1 + 1;
      for (var indice = primeiroMes; indice <= ultimoMes; indice += 1) {
        var ano = Math.floor(indice / 12);
        var mes = indice % 12 + 1;
        if (periodicidade === 'trimestral' && (mes - mesInicio) % 3 !== 0) { continue; }
        if (periodicidade === 'semestral' && (mes - mesInicio) % 6 !== 0) { continue; }
        if (periodicidade === 'anual' && mes !== mesInicio) { continue; }
        /* dia_mes 31 = último dia do mês; 29/30 também caem no último dia
           nos meses mais curtos. */
        var alvoMes = diaDe(ano, mes, Math.min(diaMes, ultimoDiaDoMes(ano, mes)));
        incluir(PREFIXOS[periodicidade] + ano + '-' + doisDigitos(mes),
                antecipa ? anteciparDia(alvoMes, mapa) : alvoMes);
      }

    } else {
      return [];
    }

    lista.sort(function (a, b) {
      if (a.prazo !== b.prazo) { return a.prazo < b.prazo ? -1 : 1; }
      return a.referencia < b.referencia ? -1 : (a.referencia > b.referencia ? 1 : 0);
    });
    return lista;
  }

  /* As n próximas ocorrências com prazo a partir de hoje (ou do início da
     atividade, se for futuro). Usada nas prévias do formulário e do detalhe. */
  function proximas(atividade, n, hoje, feriados) {
    n = Math.max(1, Math.floor(Number(n) || 5));
    if (!atividade || (atividade.tipo && atividade.tipo !== 'recorrente')) { return []; }
    var passo = PASSO_DIAS[atividade.periodicidade];
    var diaHoje = paraDia(hoje);
    if (!passo || diaHoje === null) { return []; }

    var inicio = diaHoje;
    var diaInicioAtividade = paraDia(atividade.data_inicio);
    if (diaInicioAtividade !== null && diaInicioAtividade > inicio) { inicio = diaInicioAtividade; }

    var mapa = normalizarFeriados(feriados);
    var janela = passo * (n + 1) + 31;
    var resultado = [];
    /* Feriados só "comem" dias na diária; ainda assim, se a primeira janela
       não bastar, dobra algumas vezes antes de desistir. */
    for (var tentativa = 0; tentativa < 6; tentativa += 1) {
      resultado = datas(atividade, paraTexto(inicio), paraTexto(inicio + janela), mapa);
      if (resultado.length >= n) { break; }
      janela *= 2;
    }
    return resultado.slice(0, n);
  }

  /* Janela usada por gerar_ocorrencias() (ARQUITETURA §4):
     de = maior(data_inicio, hoje − 45); ate = hoje (diária) ou hoje + 31. */
  function janelaGeracao(atividade, hoje) {
    var diaHoje = paraDia(hoje);
    if (diaHoje === null) { return null; }
    var de = diaHoje - 45;
    var diaInicioAtividade = paraDia(atividade && atividade.data_inicio);
    if (diaInicioAtividade !== null && diaInicioAtividade > de) { de = diaInicioAtividade; }
    var ate = (atividade && atividade.periodicidade === 'diaria_util') ? diaHoje : diaHoje + 31;
    return { de: paraTexto(de), ate: paraTexto(ate) };
  }

  /* ---------- versões públicas (texto 'AAAA-MM-DD') ---------- */

  function eDiaUtil(data, feriados) {
    var dia = paraDia(data);
    return dia !== null && eDiaUtilDia(dia, normalizarFeriados(feriados));
  }

  function antecipar(data, feriados) {
    var dia = paraDia(data);
    if (dia === null) { return null; }
    return paraTexto(anteciparDia(dia, normalizarFeriados(feriados)));
  }

  function semanaIso(data) {
    var dia = paraDia(data);
    return dia === null ? null : semanaIsoDe(dia);
  }

  function somarDias(data, dias) {
    var dia = paraDia(data);
    return dia === null ? null : paraTexto(dia + Math.round(Number(dias) || 0));
  }

  /* Diferença em dias (b − a). */
  function diasEntre(a, b) {
    var da = paraDia(a), db = paraDia(b);
    return (da === null || db === null) ? null : db - da;
  }

  function diaSemana(data) {
    var dia = paraDia(data);
    return dia === null ? null : diaSemanaDe(dia);
  }

  function dataValida(data) {
    return typeof data === 'string' && data.length === 10 && paraDia(data) !== null;
  }

  return {
    datas: datas,
    proximas: proximas,
    janelaGeracao: janelaGeracao,
    eDiaUtil: eDiaUtil,
    antecipar: antecipar,
    semanaIso: semanaIso,
    /* auxiliares de calendário, sem fuso (usados também pela demonstração) */
    somarDias: somarDias,
    diasEntre: diasEntre,
    diaSemana: diaSemana,
    dataValida: dataValida,
    ultimoDiaDoMes: ultimoDiaDoMes,
    normalizarFeriados: normalizarFeriados
  };
})();
