#!/usr/bin/env node
/* =========================================================================
   HABE – AQS e NSP — testes unitários de Regras e Recorrencia
   Uso: node testes/regras.mjs   (a partir da pasta aqs-nsp)

   Carrega regras.js e recorrencia.js num vm do Node, como o navegador os
   carregaria (globais var, sem módulos), com um window e um AQS_CONFIG
   mínimos — e sem document: se algum dos dois tocar no DOM ao carregar,
   o teste já falha aí.
   ========================================================================= */

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function carregar(contexto, arquivo) {
  const caminho = path.join(raiz, arquivo);
  vm.runInContext(fs.readFileSync(caminho, 'utf8'), contexto, { filename: caminho });
}

const contexto = vm.createContext({ console, AQS_CONFIG: { LIMITE_ARQUIVO_MB: 20 } });
contexto.window = contexto;
carregar(contexto, 'assets/js/regras.js');
carregar(contexto, 'assets/js/recorrencia.js');
const { Regras, Recorrencia } = contexto;

/* ---------- mini-executor ---------- */

let aprovados = 0;
const falhas = [];

function teste(nome, fn) {
  try {
    fn();
    aprovados += 1;
  } catch (erro) {
    falhas.push({ nome, erro });
  }
}

/* Objetos do vm têm outro Object.prototype: compara pelo conteúdo. */
function igual(atual, esperado, mensagem) {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(atual)), esperado, mensagem);
}

const FERIADOS = [
  '2026-01-01', '2026-04-03', '2026-04-21', '2026-05-01', '2026-08-15', '2026-09-07', '2026-10-12',
  '2026-11-02', '2026-11-15', '2026-11-20', '2026-12-08', '2026-12-25',
  '2027-01-01', '2027-03-26', '2027-04-21', '2027-05-01', '2027-08-15', '2027-09-07', '2027-10-12',
  '2027-11-02', '2027-11-15', '2027-11-20', '2027-12-08', '2027-12-25'
];
const MAPA_FERIADOS = Object.fromEntries(FERIADOS.map((d) => [d, true]));
const HOJE = '2026-10-15';

function rec(campos) {
  return Object.assign({ tipo: 'recorrente', antecipar_dia_util: true, ativa: true }, campos);
}

/* Prazo de uma referência dentro de uma lista de datas. */
function prazoDe(lista, referencia) {
  const item = lista.find((x) => x.referencia === referencia);
  return item ? item.prazo : undefined;
}

/* =========================================================================
   Recorrencia
   ========================================================================= */

teste('carrega sem tocar em document e expõe a API do contrato', () => {
  for (const nome of ['datas', 'proximas', 'eDiaUtil', 'antecipar', 'semanaIso']) {
    assert.equal(typeof Recorrencia[nome], 'function', 'Recorrencia.' + nome);
  }
  assert.equal(typeof contexto.Paginas, 'object', 'var Paginas declarado em regras.js');
});

teste('diária útil pula fim de semana e o feriado de 12/10/2026', () => {
  const a = rec({ periodicidade: 'diaria_util' });
  igual(Recorrencia.datas(a, '2026-10-08', '2026-10-16', MAPA_FERIADOS), [
    { referencia: 'D2026-10-08', prazo: '2026-10-08' },
    { referencia: 'D2026-10-09', prazo: '2026-10-09' },
    { referencia: 'D2026-10-13', prazo: '2026-10-13' },
    { referencia: 'D2026-10-14', prazo: '2026-10-14' },
    { referencia: 'D2026-10-15', prazo: '2026-10-15' },
    { referencia: 'D2026-10-16', prazo: '2026-10-16' }
  ]);
});

teste('diária útil não antecipa nem quando antecipar_dia_util = false', () => {
  const a = rec({ periodicidade: 'diaria_util', antecipar_dia_util: false });
  igual(Recorrencia.datas(a, '2026-10-10', '2026-10-12', MAPA_FERIADOS), []);
});

teste('feriados aceitos como mapa, lista de textos ou lista de objetos', () => {
  const a = rec({ periodicidade: 'diaria_util' });
  const porMapa = Recorrencia.datas(a, '2026-10-12', '2026-10-13', MAPA_FERIADOS);
  const porLista = Recorrencia.datas(a, '2026-10-12', '2026-10-13', FERIADOS);
  const porObjetos = Recorrencia.datas(a, '2026-10-12', '2026-10-13', FERIADOS.map((data) => ({ data })));
  igual(porMapa, [{ referencia: 'D2026-10-13', prazo: '2026-10-13' }]);
  igual(porLista, JSON.parse(JSON.stringify(porMapa)));
  igual(porObjetos, JSON.parse(JSON.stringify(porMapa)));
});

teste('semanal: 2026-W53 (sexta 01/01/2027, feriado) é antecipada para 31/12/2026', () => {
  const a = rec({ periodicidade: 'semanal', dia_semana: 5 });
  const dez = Recorrencia.datas(a, '2026-12-01', '2026-12-31', MAPA_FERIADOS);
  igual(dez.map((x) => x.referencia), ['S2026-W49', 'S2026-W50', 'S2026-W51', 'S2026-W52', 'S2026-W53']);
  assert.equal(prazoDe(dez, 'S2026-W52'), '2026-12-24', 'Natal (sexta) antecipa para quinta');
  assert.equal(prazoDe(dez, 'S2026-W53'), '2026-12-31');
  /* O mesmo período não aparece de novo em janeiro. */
  const jan = Recorrencia.datas(a, '2027-01-01', '2027-01-15', MAPA_FERIADOS);
  igual(jan, [
    { referencia: 'S2027-W01', prazo: '2027-01-08' },
    { referencia: 'S2027-W02', prazo: '2027-01-15' }
  ]);
});

teste('semanal sem antecipar mantém a sexta-feira feriado', () => {
  const a = rec({ periodicidade: 'semanal', dia_semana: 5, antecipar_dia_util: false });
  const lista = Recorrencia.datas(a, '2026-12-28', '2027-01-03', MAPA_FERIADOS);
  igual(lista, [{ referencia: 'S2026-W53', prazo: '2027-01-01' }]);
});

teste('semanal no domingo antecipa para sexta; semana ISO na referência', () => {
  const a = rec({ periodicidade: 'semanal', dia_semana: 7 });
  igual(Recorrencia.datas(a, '2026-10-12', '2026-10-18', MAPA_FERIADOS),
    [{ referencia: 'S2026-W42', prazo: '2026-10-16' }]);
});

teste('mensal dia 31 = último dia (útil) do mês: fev/2027, abr/2027 e fev/2028', () => {
  const a = rec({ periodicidade: 'mensal', dia_mes: 31 });
  const lista = Recorrencia.datas(a, '2027-01-01', '2028-03-31', MAPA_FERIADOS);
  assert.equal(prazoDe(lista, 'M2027-02'), '2027-02-26', '28/02/2027 é domingo');
  assert.equal(prazoDe(lista, 'M2027-04'), '2027-04-30');
  assert.equal(prazoDe(lista, 'M2028-02'), '2028-02-29', '2028 é bissexto');
  assert.equal(prazoDe(lista, 'M2027-07'), '2027-07-30', '31/07/2027 é sábado');
  assert.equal(lista.length, 15);
});

teste('mensal dia 31 sem antecipar fica no último dia do calendário', () => {
  const a = rec({ periodicidade: 'mensal', dia_mes: 31, antecipar_dia_util: false });
  const lista = Recorrencia.datas(a, '2027-02-01', '2027-02-28', MAPA_FERIADOS);
  igual(lista, [{ referencia: 'M2027-02', prazo: '2027-02-28' }]);
});

teste('mensal dia 5 em sábado (05/12/2026) antecipa para 04/12/2026', () => {
  const a = rec({ periodicidade: 'mensal', dia_mes: 5 });
  igual(Recorrencia.datas(a, '2026-12-01', '2026-12-31', MAPA_FERIADOS),
    [{ referencia: 'M2026-12', prazo: '2026-12-04' }]);
});

teste('mensal dia 15 de nov/2026 (domingo e feriado) vai para sexta 13/11', () => {
  const a = rec({ periodicidade: 'mensal', dia_mes: 15 });
  const lista = Recorrencia.datas(a, '2026-11-01', '2026-11-30', MAPA_FERIADOS);
  igual(lista, [{ referencia: 'M2026-11', prazo: '2026-11-13' }]);
});

teste('sem antecipar: dia 15 de nov/2026 permanece 15/11', () => {
  const a = rec({ periodicidade: 'mensal', dia_mes: 15, antecipar_dia_util: false });
  igual(Recorrencia.datas(a, '2026-11-01', '2026-11-30', MAPA_FERIADOS),
    [{ referencia: 'M2026-11', prazo: '2026-11-15' }]);
});

teste('inclusão pelo prazo final: antecipação traz o período seguinte para dentro', () => {
  /* 01/01/2027 é feriado (sexta): o prazo de jan/2027 vira 31/12/2026. */
  const a = rec({ periodicidade: 'mensal', dia_mes: 1 });
  igual(Recorrencia.datas(a, '2026-12-01', '2026-12-31', MAPA_FERIADOS), [
    { referencia: 'M2026-12', prazo: '2026-12-01' },
    { referencia: 'M2027-01', prazo: '2026-12-31' }
  ]);
  igual(Recorrencia.datas(a, '2027-01-01', '2027-01-31', MAPA_FERIADOS), []);
  /* e o período cujo prazo antecipado sai do intervalo não entra */
  const quinze = rec({ periodicidade: 'mensal', dia_mes: 15 });
  igual(Recorrencia.datas(quinze, '2026-11-14', '2026-11-30', MAPA_FERIADOS), []);
  igual(Recorrencia.datas(quinze, '2026-11-13', '2026-11-13', MAPA_FERIADOS),
    [{ referencia: 'M2026-11', prazo: '2026-11-13' }]);
});

teste('semanal: segunda-feira feriado logo após o fim do intervalo é antecipada para dentro', () => {
  /* 07/09/2026 (segunda) é feriado: o prazo da semana 37 recua para sexta 04/09,
     que é o último dia do intervalo — só aparece percorrendo uma semana a mais. */
  const a = rec({ periodicidade: 'semanal', dia_semana: 1 });
  igual(Recorrencia.datas(a, '2026-08-31', '2026-09-04', MAPA_FERIADOS), [
    { referencia: 'S2026-W36', prazo: '2026-08-31' },
    { referencia: 'S2026-W37', prazo: '2026-09-04' }
  ]);
  igual(Recorrencia.datas(a, '2026-09-05', '2026-09-13', MAPA_FERIADOS), []);
});

teste('trimestral a partir de janeiro, dia 10', () => {
  const a = rec({ periodicidade: 'trimestral', dia_mes: 10, mes_inicio: 1 });
  igual(Recorrencia.datas(a, '2026-01-01', '2026-12-31', MAPA_FERIADOS), [
    { referencia: 'T2026-01', prazo: '2026-01-09' },
    { referencia: 'T2026-04', prazo: '2026-04-10' },
    { referencia: 'T2026-07', prazo: '2026-07-10' },
    { referencia: 'T2026-10', prazo: '2026-10-09' }
  ]);
  /* mes_inicio 11: ciclo nov, fev, mai, ago */
  const b = rec({ periodicidade: 'trimestral', dia_mes: 31, mes_inicio: 11 });
  igual(Recorrencia.datas(b, '2027-01-01', '2027-12-31', MAPA_FERIADOS).map((x) => x.referencia),
    ['T2027-02', 'T2027-05', 'T2027-08', 'T2027-11']);
});

teste('semestral (mar/set) e anual (mar)', () => {
  const s = rec({ periodicidade: 'semestral', dia_mes: 30, mes_inicio: 3 });
  igual(Recorrencia.datas(s, '2026-01-01', '2027-12-31', MAPA_FERIADOS), [
    { referencia: 'H2026-03', prazo: '2026-03-30' },
    { referencia: 'H2026-09', prazo: '2026-09-30' },
    { referencia: 'H2027-03', prazo: '2027-03-30' },
    { referencia: 'H2027-09', prazo: '2027-09-30' }
  ]);
  const a = rec({ periodicidade: 'anual', dia_mes: 26, mes_inicio: 3 });
  igual(Recorrencia.datas(a, '2026-01-01', '2027-12-31', MAPA_FERIADOS), [
    { referencia: 'A2026-03', prazo: '2026-03-26' },
    { referencia: 'A2027-03', prazo: '2027-03-25' }
  ], '26/03/2027 é Sexta-feira da Paixão');
});

teste('regras incompletas ou atividade não recorrente não geram nada', () => {
  igual(Recorrencia.datas(rec({ periodicidade: 'semanal' }), '2026-01-01', '2026-12-31', []), []);
  igual(Recorrencia.datas(rec({ periodicidade: 'mensal' }), '2026-01-01', '2026-12-31', []), []);
  igual(Recorrencia.datas(rec({ periodicidade: 'anual', dia_mes: 5 }), '2026-01-01', '2026-12-31', []), []);
  igual(Recorrencia.datas({ tipo: 'pontual', prazo: '2026-10-30' }, '2026-01-01', '2026-12-31', []), []);
  igual(Recorrencia.datas(rec({ periodicidade: 'mensal', dia_mes: 5 }), '2026-12-31', '2026-01-01', []), []);
  igual(Recorrencia.datas(rec({ periodicidade: 'mensal', dia_mes: 5 }), '2026-02-30', '2026-03-31', []), []);
});

teste('saída ordenada por prazo', () => {
  const a = rec({ periodicidade: 'semanal', dia_semana: 3 });
  const lista = Recorrencia.datas(a, '2026-01-01', '2027-12-31', MAPA_FERIADOS);
  const ordenada = [...lista].sort((x, y) => (x.prazo < y.prazo ? -1 : x.prazo > y.prazo ? 1 : 0));
  igual(lista, JSON.parse(JSON.stringify(ordenada)));
  assert.equal(new Set(lista.map((x) => x.referencia)).size, lista.length, 'referências únicas');
});

teste('proximas: as n seguintes a partir de hoje', () => {
  const a = rec({ periodicidade: 'mensal', dia_mes: 15, data_inicio: '2026-08-01' });
  igual(Recorrencia.proximas(a, 3, HOJE, MAPA_FERIADOS), [
    { referencia: 'M2026-10', prazo: '2026-10-15' },
    { referencia: 'M2026-11', prazo: '2026-11-13' },
    { referencia: 'M2026-12', prazo: '2026-12-15' }
  ]);
  /* início no futuro: conta a partir dele */
  const b = rec({ periodicidade: 'semanal', dia_semana: 5, data_inicio: '2026-11-01' });
  assert.equal(Recorrencia.proximas(b, 1, HOJE, MAPA_FERIADOS)[0].prazo, '2026-11-06');
  const d = rec({ periodicidade: 'diaria_util' });
  assert.equal(Recorrencia.proximas(d, 20, '2026-12-20', MAPA_FERIADOS).length, 20);
  igual(Recorrencia.proximas({ tipo: 'sob_demanda' }, 3, HOJE, MAPA_FERIADOS), []);
  const anual = rec({ periodicidade: 'anual', dia_mes: 1, mes_inicio: 2 });
  igual(Recorrencia.proximas(anual, 2, HOJE, MAPA_FERIADOS).map((x) => x.referencia), ['A2027-02', 'A2028-02']);
});

teste('eDiaUtil, antecipar e semanaIso', () => {
  assert.equal(Recorrencia.eDiaUtil('2026-10-15', MAPA_FERIADOS), true);
  assert.equal(Recorrencia.eDiaUtil('2026-10-12', MAPA_FERIADOS), false);
  assert.equal(Recorrencia.eDiaUtil('2026-10-17', MAPA_FERIADOS), false);
  assert.equal(Recorrencia.antecipar('2026-11-15', MAPA_FERIADOS), '2026-11-13');
  assert.equal(Recorrencia.antecipar('2027-01-01', MAPA_FERIADOS), '2026-12-31');
  assert.equal(Recorrencia.antecipar('2026-10-15', MAPA_FERIADOS), '2026-10-15');
  igual(Recorrencia.semanaIso('2026-12-31'), { ano: 2026, semana: 53 });
  igual(Recorrencia.semanaIso('2027-01-03'), { ano: 2026, semana: 53 });
  igual(Recorrencia.semanaIso('2027-01-04'), { ano: 2027, semana: 1 });
  igual(Recorrencia.semanaIso('2026-01-01'), { ano: 2026, semana: 1 });
  igual(Recorrencia.semanaIso('2026-10-15'), { ano: 2026, semana: 42 });
  igual(Recorrencia.semanaIso('2024-12-30'), { ano: 2025, semana: 1 });
});

teste('janelaGeracao segue §4 (45 dias para trás; hoje ou hoje + 31)', () => {
  igual(Recorrencia.janelaGeracao(rec({ periodicidade: 'mensal', data_inicio: '2026-01-01' }), HOJE),
    { de: '2026-08-31', ate: '2026-11-15' });
  igual(Recorrencia.janelaGeracao(rec({ periodicidade: 'diaria_util', data_inicio: '2026-10-01' }), HOJE),
    { de: '2026-10-01', ate: '2026-10-15' });
});

teste('não depende do fuso do computador (TZ alterado em tempo de execução)', () => {
  const antes = process.env.TZ;
  const a = rec({ periodicidade: 'semanal', dia_semana: 5 });
  const base = JSON.stringify(Recorrencia.datas(a, '2026-01-01', '2027-12-31', MAPA_FERIADOS));
  for (const tz of ['Pacific/Kiritimati', 'America/Los_Angeles', 'Asia/Tokyo', 'UTC']) {
    process.env.TZ = tz;
    assert.equal(JSON.stringify(Recorrencia.datas(a, '2026-01-01', '2027-12-31', MAPA_FERIADOS)), base, tz);
  }
  process.env.TZ = antes;
  if (antes === undefined) { delete process.env.TZ; }
});

/* =========================================================================
   Regras
   ========================================================================= */

const adjunto = { id: 'm-souza', papel: 'adjunto', ativo: true, posto: 'Ten', nome_guerra: 'Souza', usuario_id: 'u1' };
const outroAdjunto = { id: 'm-costa', papel: 'adjunto', ativo: true, posto: 'Ten', nome_guerra: 'Costa', usuario_id: 'u2' };
const chefia = { id: 'm-chefia', papel: 'chefia', ativo: true, posto: 'Maj', nome_guerra: 'Chefia NSP', usuario_id: 'u3' };
const admin = { id: 'm-aqs', papel: 'administrador', ativo: true, posto: '', nome_guerra: 'AQS — conta institucional', usuario_id: 'u4' };
const chefiaInativa = Object.assign({}, chefia, { id: 'm-chefia-velha', ativo: false });

teste('rótulos e constantes do contrato', () => {
  assert.equal(Regras.ROTULOS.papel.administrador, 'Administrador (conta institucional AQS)');
  assert.equal(Regras.ROTULOS.papel.chefia, 'Chefia');
  assert.equal(Regras.ROTULOS.papel.adjunto, 'Adjunto');
  assert.equal(Regras.ROTULOS.status.atrasada, 'Atrasada');
  for (const grupo of ['papel', 'tipo', 'periodicidade', 'prioridade', 'status', 'nivel', 'notificacao']) {
    assert.equal(typeof Regras.ROTULOS[grupo], 'object', grupo);
  }
  assert.equal(Regras.TIPOS_ARQUIVO.pdf, 'application/pdf');
  assert.equal(Object.keys(Regras.TIPOS_ARQUIVO).length, 15);
  assert.ok(Regras.ACCEPT.includes('.docx') && Regras.ACCEPT.includes('.png') && !Regras.ACCEPT.includes('.exe'));
});

teste('nomeMilitar e nomesResponsaveis', () => {
  assert.equal(Regras.nomeMilitar({ posto: '1º Ten', nome_guerra: 'Lima' }), '1º Ten Lima');
  assert.equal(Regras.nomeMilitar({ posto: '', nome_guerra: 'Chefia AQS/NSP' }), 'Chefia AQS/NSP');
  assert.equal(Regras.nomeMilitar({ posto: '  Ten ', nome_guerra: ' Souza  ' }), 'Ten Souza');
  assert.equal(Regras.nomeMilitar(null), '—');
  const mapa = { 'm-souza': adjunto, 'm-costa': outroAdjunto };
  assert.equal(Regras.nomesResponsaveis(['m-souza', 'm-costa'], mapa), 'Ten Souza, Ten Costa');
  assert.equal(Regras.nomesResponsaveis(['m-costa'], [adjunto, outroAdjunto]), 'Ten Costa');
  assert.equal(Regras.nomesResponsaveis([], mapa), 'Sem responsável');
  assert.equal(Regras.nomesResponsaveis(['x'], mapa), 'Militar não encontrado');
});

teste('papéis: eChefia, eAdministrador, eGestor, eResponsavel', () => {
  assert.equal(Regras.eChefia(chefia), true);
  assert.equal(Regras.eChefia(admin), false);
  assert.equal(Regras.eChefia(chefiaInativa), true, 'eChefia olha só o papel');
  assert.equal(Regras.eAdministrador(admin), true);
  assert.equal(Regras.eGestor(chefia), true);
  assert.equal(Regras.eGestor(admin), true);
  assert.equal(Regras.eGestor(adjunto), false);
  assert.equal(Regras.eGestor(chefiaInativa), false, 'gestor precisa estar ativo');
  assert.equal(Regras.eGestor(null), false);
  assert.equal(Regras.eResponsavel(adjunto, { responsaveis: ['m-souza'] }), true);
  assert.equal(Regras.eResponsavel(adjunto, { responsaveis: ['m-costa'] }), false);
  assert.equal(Regras.eResponsavel(adjunto, { responsaveis: null }), false);
  assert.equal(Regras.eResponsavel(Object.assign({}, adjunto, { ativo: false }), { responsaveis: ['m-souza'] }), false);
});

teste('permissões de atividades e ocorrências (espelho da RLS e do RPC)', () => {
  const minha = { tipo: 'sob_demanda', responsaveis: ['m-souza'] };
  const alheia = { tipo: 'recorrente', responsaveis: ['m-costa'] };
  const pontualMinha = { tipo: 'pontual', responsaveis: ['m-souza'] };
  for (const gestor of [chefia, admin]) {
    assert.equal(Regras.podeEditarAtividade(gestor, alheia), true);
    assert.equal(Regras.podeCriarAtividade(gestor, 'recorrente'), true);
    assert.equal(Regras.podeAlterarResponsaveis(gestor), true);
    assert.equal(Regras.podeAtualizarOcorrencia(gestor, alheia), true);
    assert.equal(Regras.podeRegistrarExecucao(gestor, alheia), true);
    assert.equal(Regras.podeEnviarEvidencia(gestor, alheia), true);
    assert.equal(Regras.podeExcluirEvidencia(gestor, { enviado_por: 'outro' }), true);
    assert.equal(Regras.podeExcluirComentario(gestor, { autor_id: 'outro' }), true);
    assert.equal(Regras.podePublicarAviso(gestor), true);
    assert.equal(Regras.podeVerAuditoria(gestor), true);
  }
  assert.equal(Regras.podeEditarAtividade(adjunto, minha), true);
  assert.equal(Regras.podeEditarAtividade(adjunto, alheia), false);
  assert.equal(Regras.podeCriarAtividade(adjunto, 'pontual'), true);
  assert.equal(Regras.podeCriarAtividade(adjunto, 'sob_demanda'), true);
  assert.equal(Regras.podeCriarAtividade(adjunto, 'recorrente'), false);
  assert.equal(Regras.podeCriarAtividade(adjunto), true);
  assert.equal(Regras.podeCriarAtividade(Object.assign({}, adjunto, { ativo: false }), 'pontual'), false);
  assert.equal(Regras.podeAlterarResponsaveis(adjunto), false);
  assert.equal(Regras.podeAtualizarOcorrencia(adjunto, { responsaveis: ['m-souza'] }), true);
  assert.equal(Regras.podeAtualizarOcorrencia(adjunto, { responsaveis: ['m-costa'] }), false);
  assert.equal(Regras.podeAlterarPrazoOcorrencia(adjunto), false);
  assert.equal(Regras.podeExcluirOcorrencia(adjunto), false);
  assert.equal(Regras.podeRegistrarExecucao(adjunto, minha), true);
  assert.equal(Regras.podeRegistrarExecucao(adjunto, pontualMinha), false, 'só sob demanda');
  assert.equal(Regras.podeRegistrarExecucao(outroAdjunto, minha), false);
  assert.equal(Regras.podeEnviarEvidencia(adjunto, minha), true);
  assert.equal(Regras.podeEnviarEvidencia(adjunto, alheia), false);
  assert.equal(Regras.podeExcluirEvidencia(adjunto, { enviado_por: 'm-souza' }), true);
  assert.equal(Regras.podeExcluirEvidencia(adjunto, { enviado_por: 'm-costa' }), false);
  assert.equal(Regras.podeExcluirEvidencia(adjunto, { enviado_por: null }), false, 'autor excluído');
  assert.equal(Regras.podeExcluirComentario(adjunto, { autor_id: 'm-souza' }), true);
  assert.equal(Regras.podeExcluirComentario(adjunto, { autor_id: null }), false);
  assert.equal(Regras.podeComentar(adjunto), true);
  assert.equal(Regras.podePublicarAviso(adjunto), false);
  assert.equal(Regras.podeVerAuditoria(adjunto), false);
  assert.equal(Regras.podeExcluirAtividade(adjunto), false);
  assert.equal(Regras.podeEditarAtividade(chefiaInativa, alheia), false, 'inativo não pode nada');
});

teste('tiposPermitidos e podeAssumirChefia (espelho de salvar_atividade e transferir_chefia)', () => {
  igual(Regras.tiposPermitidos(chefia, null), ['recorrente', 'pontual', 'sob_demanda']);
  igual(Regras.tiposPermitidos(admin, { id: 'a', tipo: 'pontual' }), ['recorrente', 'pontual', 'sob_demanda']);
  igual(Regras.tiposPermitidos(adjunto, null), ['pontual', 'sob_demanda']);
  igual(Regras.tiposPermitidos(adjunto, { id: 'a', tipo: 'sob_demanda' }), ['pontual', 'sob_demanda']);
  igual(Regras.tiposPermitidos(adjunto, { id: 'a', tipo: 'recorrente' }), ['recorrente', 'pontual', 'sob_demanda']);
  igual(Regras.tiposPermitidos(Object.assign({}, adjunto, { ativo: false }), null), []);
  assert.equal(Regras.podeAssumirChefia(outroAdjunto), true);
  assert.equal(Regras.podeAssumirChefia(chefiaInativa), true);
  assert.equal(Regras.podeAssumirChefia(admin), false);
  assert.equal(Regras.podeAssumirChefia(null), false);
});

teste('avisos visíveis: gestor, para todos ou destinatário', () => {
  const restrito = { para_todos: false, destinatarios: ['m-costa'] };
  assert.equal(Regras.podeVerAviso(adjunto, { para_todos: true }), true);
  assert.equal(Regras.podeVerAviso(adjunto, restrito), false);
  assert.equal(Regras.podeVerAviso(outroAdjunto, restrito), true);
  assert.equal(Regras.podeVerAviso(admin, restrito), true);
  assert.equal(Regras.podeVerAviso(Object.assign({}, outroAdjunto, { ativo: false }), restrito), false);
});

teste('gestão de usuários: só administrador mexe em administrador; ninguém exclui a si mesmo', () => {
  assert.equal(Regras.podeGerenciarUsuarios(chefia), true);
  assert.equal(Regras.podeGerenciarUsuarios(admin), true);
  assert.equal(Regras.podeGerenciarUsuarios(adjunto), false);
  assert.equal(Regras.podeGerenciarMilitar(chefia, outroAdjunto), true);
  assert.equal(Regras.podeGerenciarMilitar(chefia, chefiaInativa), true, 'gestor altera inclusive a chefia');
  assert.equal(Regras.podeGerenciarMilitar(chefia, outroAdjunto, 'chefia'), true);
  assert.equal(Regras.podeGerenciarMilitar(chefia, admin), false, 'chefia não derruba a conta institucional');
  assert.equal(Regras.podeGerenciarMilitar(chefia, outroAdjunto, 'administrador'), false);
  assert.equal(Regras.podeGerenciarMilitar(chefia, null, 'administrador'), false);
  assert.equal(Regras.podeGerenciarMilitar(chefia, null, 'adjunto'), true, 'cadastro novo');
  assert.equal(Regras.podeGerenciarMilitar(admin, admin), true);
  assert.equal(Regras.podeGerenciarMilitar(admin, chefia, 'administrador'), true);
  assert.equal(Regras.podeGerenciarMilitar(adjunto, outroAdjunto), false);
  assert.equal(Regras.podeGerenciarMilitar(chefiaInativa, outroAdjunto), false);
  assert.equal(Regras.podeExcluirMilitar(chefia, outroAdjunto), true);
  assert.equal(Regras.podeExcluirMilitar(chefia, chefia), false);
  assert.equal(Regras.podeExcluirMilitar(admin, admin), false);
  assert.equal(Regras.podeExcluirMilitar(chefia, admin), false);
  assert.equal(Regras.podeExcluirMilitar(admin, chefia), true);
  assert.equal(Regras.podeDesativarMilitar(chefia, chefia), false);
});

teste('militaresAtribuiveis exclui a conta institucional e os inativos', () => {
  const lista = Regras.militaresAtribuiveis([adjunto, outroAdjunto, chefia, admin, chefiaInativa]);
  igual(lista.map((m) => m.id), ['m-souza', 'm-costa', 'm-chefia']);
});

teste('trava anti-bloqueio (espelho do gatilho de militares)', () => {
  const todos = [adjunto, chefia, admin];
  assert.equal(Regras.gestoresComAcesso(todos).length, 2);
  const semAcesso = Object.assign({}, chefia, { usuario_id: null });
  assert.equal(Regras.gestoresComAcesso([semAcesso]).length, 0);
  /* desativar a chefia com o administrador ativo: pode */
  assert.equal(Regras.violaTravaGestor(chefia, [adjunto, Object.assign({}, chefia, { ativo: false }), admin]), null);
  /* rebaixar o único gestor: não pode */
  assert.equal(Regras.violaTravaGestor(chefia, [adjunto, Object.assign({}, chefia, { papel: 'adjunto' })]),
    'É preciso manter ao menos uma conta de chefia ou administrador ativa e com acesso.');
  /* excluir o último gestor: não pode */
  assert.equal(Regras.violaTravaGestor(admin, [adjunto]), Regras.MENSAGEM_TRAVA);
  /* linha alterada não era gestor com acesso (carga inicial): a trava não vale */
  assert.equal(Regras.violaTravaGestor(semAcesso, [adjunto]), null);
  assert.equal(Regras.violaTravaGestor(adjunto, [Object.assign({}, adjunto, { ativo: false })]), null);
});

function baseContinuidade() {
  return {
    militar: chefia,
    hoje: HOJE,
    militares: [
      Object.assign({}, adjunto, { ultimo_acesso: '2026-10-14T12:00:00Z' }),
      Object.assign({}, outroAdjunto, { ultimo_acesso: '2026-10-14T12:00:00Z' }),
      Object.assign({}, chefia, { ultimo_acesso: '2026-10-15T11:00:00Z' }),
      Object.assign({}, admin, { ultimo_acesso: '2026-10-10T11:00:00Z' })
    ],
    atividades: [
      { id: 'a1', titulo: 'Verificar o SIGADAER', ativa: true, responsaveis: ['m-souza'] },
      { id: 'a2', titulo: 'Arquivada', ativa: false, responsaveis: [] }
    ],
    feriados: FERIADOS.map((data) => ({ data, descricao: 'x' })),
    configuracoes: {
      contatos: { email_institucional: 'aqs@fab.mil.br', responsavel_tecnico: 'Ten X', telefone: 'Ramal 1', observacoes: '' },
      ultimo_backup: { em: '2026-10-01T15:00:00Z', por_nome: 'Maj Chefia NSP' }
    }
  };
}

teste('alertasContinuidade: tudo em ordem ⇒ nenhum alerta; adjunto nunca vê', () => {
  igual(Regras.alertasContinuidade(baseContinuidade()), []);
  const paraAdjunto = Object.assign(baseContinuidade(), { militar: adjunto, configuracoes: {} });
  igual(Regras.alertasContinuidade(paraAdjunto), []);
});

teste('alertasContinuidade: cada situação de (a) a (g)', () => {
  const titulos = (dados) => Regras.alertasContinuidade(dados).map((x) => x.nivel + ':' + x.titulo);

  const semAdmin = baseContinuidade();
  semAdmin.militares = semAdmin.militares.filter((m) => m.papel !== 'administrador');
  const a = Regras.alertasContinuidade(semAdmin);
  assert.equal(a[0].nivel, 'urgente', '(a) é o mais grave e vem primeiro');
  assert.match(a[0].titulo, /administrador/);
  assert.ok(a.some((x) => /Só há uma conta/.test(x.titulo)), '(b) um gestor só');
  for (const alerta of a) {
    assert.deepEqual(Object.keys(alerta).sort(), ['link', 'nivel', 'texto', 'titulo']);
    assert.match(alerta.link, /^#\//);
  }

  const orfa = baseContinuidade();
  orfa.atividades.push({ id: 'a3', titulo: 'Auditoria cirúrgica', ativa: true, responsaveis: ['m-excluido'] });
  orfa.atividades.push({ id: 'a4', titulo: 'Só do administrador', ativa: true, responsaveis: ['m-aqs'] });
  const c = Regras.alertasContinuidade(orfa);
  assert.equal(c.length, 1);
  assert.equal(c[0].titulo, '2 atividades sem responsável', '(c)');
  assert.match(c[0].texto, /Auditoria cirúrgica/);

  const novembro = baseContinuidade();
  novembro.hoje = '2027-11-01';
  novembro.configuracoes.ultimo_backup.em = '2027-10-30T12:00:00Z';
  novembro.militares.forEach((m) => { m.ultimo_acesso = '2027-10-30T12:00:00Z'; });
  assert.ok(titulos(novembro).includes('atencao:Cadastre os feriados de 2028'), '(d)');
  const outubro = Object.assign(baseContinuidade(), { hoje: '2027-10-31' });
  outubro.configuracoes.ultimo_backup.em = '2027-10-30T12:00:00Z';
  outubro.militares.forEach((m) => { m.ultimo_acesso = '2027-10-30T12:00:00Z'; });
  igual(Regras.alertasContinuidade(outubro), [], 'antes de 1º/11 não alerta');

  const backupVelho = baseContinuidade();
  backupVelho.configuracoes.ultimo_backup.em = '2026-09-05T12:00:00Z';
  assert.ok(titulos(backupVelho).includes('atencao:Cópia de segurança desatualizada'), '(e) 40 dias');
  backupVelho.configuracoes.ultimo_backup.em = '2026-09-10T12:00:00Z';
  igual(Regras.alertasContinuidade(backupVelho), [], '35 dias ainda não alerta');
  const semBackup = baseContinuidade();
  delete semBackup.configuracoes.ultimo_backup;
  assert.ok(titulos(semBackup).includes('atencao:Nenhuma cópia de segurança registrada'), '(e) nunca');

  const semContatos = baseContinuidade();
  semContatos.configuracoes.contatos = { email_institucional: 'aqs@fab.mil.br', responsavel_tecnico: ' ' };
  const f = Regras.alertasContinuidade(semContatos);
  assert.equal(f.length, 1);
  assert.equal(f[0].nivel, 'info');
  assert.match(f[0].texto, /responsável técnico e telefone\/ramal/, '(f)');

  const esquecido = baseContinuidade();
  esquecido.militares[1].ultimo_acesso = '2026-07-01T12:00:00Z';
  esquecido.militares.push({ id: 'm-novo', papel: 'adjunto', ativo: true, usuario_id: 'u9', posto: 'Ten',
    nome_guerra: 'Nunca Entrou', ultimo_acesso: null, criado_em: '2026-05-01T12:00:00Z' });
  esquecido.militares.push({ id: 'm-sem-login', papel: 'adjunto', ativo: true, usuario_id: null, posto: 'Ten',
    nome_guerra: 'Sem Login', ultimo_acesso: null, criado_em: '2026-01-01T12:00:00Z' });
  const g = Regras.alertasContinuidade(esquecido);
  assert.equal(g.length, 1);
  assert.equal(g[0].titulo, '2 acessos sem uso há mais de 90 dias', '(g)');
  assert.match(g[0].texto, /Ten Costa e Ten Nunca Entrou/);
});

teste('estaAtrasada e statusEfetivo', () => {
  assert.equal(Regras.estaAtrasada({ status: 'pendente', prazo: '2026-10-14' }, HOJE), true);
  assert.equal(Regras.estaAtrasada({ status: 'em_andamento', prazo: '2026-10-14' }, HOJE), true);
  assert.equal(Regras.estaAtrasada({ status: 'pendente', prazo: HOJE }, HOJE), false, 'vence hoje não é atraso');
  assert.equal(Regras.estaAtrasada({ status: 'concluida', prazo: '2026-10-01' }, HOJE), false);
  assert.equal(Regras.estaAtrasada({ status: 'pendente', prazo: null }, HOJE), false);
  assert.equal(Regras.statusEfetivo({ status: 'pendente', prazo: '2026-10-01' }, HOJE), 'atrasada');
  assert.equal(Regras.statusEfetivo({ status: 'nao_se_aplica', prazo: '2026-10-01' }, HOJE), 'nao_se_aplica');
  assert.equal(Regras.statusEfetivo({ status: 'em_andamento', prazo: '2026-10-20' }, HOJE), 'em_andamento');
});

teste('conformidade: universo, concluídas, no prazo, atrasadas, abertas e percentual', () => {
  const lista = [
    { status: 'concluida', prazo: '2026-10-10', concluida_em: '2026-10-10T20:00:00Z' },   /* 17h em Belém: no prazo */
    { status: 'concluida', prazo: '2026-10-10', concluida_em: '2026-10-11T02:30:00Z' },   /* 23h30 do dia 10 em Belém */
    { status: 'concluida', prazo: '2026-10-10', concluida_em: '2026-10-11T13:00:00Z' },   /* dia 11: fora do prazo */
    { status: 'concluida', prazo: '2026-10-30', concluida_em: '2026-10-14T13:00:00Z' },   /* adiantada: conta */
    { status: 'concluida', prazo: null, concluida_em: '2026-10-14T13:00:00Z' },           /* sob demanda */
    { status: 'pendente', prazo: '2026-10-09' },                                          /* atrasada */
    { status: 'em_andamento', prazo: HOJE },                                              /* vence hoje: aberta */
    { status: 'pendente', prazo: '2026-10-20' },                                          /* futura: fora */
    { status: 'nao_se_aplica', prazo: '2026-10-01', justificativa: 'x' },                 /* fora */
    { status: 'pendente', prazo: null }                                                   /* sem prazo: entra */
  ];
  igual(Regras.conformidade(lista, HOJE),
    { universo: 8, concluidas: 5, no_prazo: 4, atrasadas: 1, abertas: 3, percentual: 63 });
  igual(Regras.conformidade([], HOJE),
    { universo: 0, concluidas: 0, no_prazo: 0, atrasadas: 0, abertas: 0, percentual: null });
  /* usa concluida_no_prazo da view quando vem pronta */
  igual(Regras.conformidade([{ status: 'concluida', prazo: '2026-10-10', concluida_no_prazo: false,
    concluida_em: '2026-10-09T12:00:00Z' }], HOJE).no_prazo, 0);
});

teste('validarArquivo', () => {
  const mb = 1048576;
  assert.equal(Regras.validarArquivo({ name: 'Relatorio.PDF', size: 1000, type: 'application/pdf' }), null);
  assert.equal(Regras.validarArquivo({ name: 'foto.jpeg', size: 20 * mb }), null, 'exatamente 20 MB pode');
  assert.match(Regras.validarArquivo({ name: 'foto.jpg', size: 20 * mb + 1 }), /limite é de 20 MB/);
  assert.match(Regras.validarArquivo({ name: 'foto.jpg', size: 6 * mb }, 5), /limite é de 5 MB/);
  assert.match(Regras.validarArquivo({ name: 'virus.exe', size: 10 }), /não permitido \(\.exe\)/);
  assert.match(Regras.validarArquivo({ name: 'sem-extensao', size: 10 }), /não permitido/);
  assert.match(Regras.validarArquivo({ name: 'planilha.xlsm', size: 10 }), /não permitido/);
  assert.match(Regras.validarArquivo({ name: 'vazio.txt', size: 0 }), /vazio/);
  assert.match(Regras.validarArquivo(null), /Selecione/);
  assert.match(Regras.validarArquivo({ name: 'a'.repeat(201) + '.pdf', size: 10 }), /muito longo/);
  /* AQS_CONFIG.LIMITE_ARQUIVO_MB vale quando não se passa o limite */
  contexto.AQS_CONFIG.LIMITE_ARQUIVO_MB = 2;
  try {
    assert.match(Regras.validarArquivo({ name: 'a.pdf', size: 3 * mb }), /limite é de 2 MB/);
  } finally {
    contexto.AQS_CONFIG.LIMITE_ARQUIVO_MB = 20;
  }
});

teste('validarSenha', () => {
  assert.equal(Regras.validarSenha('Segura2026!'), null);
  assert.equal(Regras.validarSenha('abcdefghi1'), null, '10 caracteres');
  assert.match(Regras.validarSenha('abc1'), /10 caracteres/);
  assert.match(Regras.validarSenha('somenteletras'), /número/);
  assert.match(Regras.validarSenha('1234567890'), /letra/);
  assert.match(Regras.validarSenha(''), /Informe/);
  assert.match(Regras.validarSenha(' comespaco1'), /espaço/);
  assert.match(Regras.validarSenha('a1' + 'é'.repeat(40)), /longa demais/);
});

teste('validarEmail', () => {
  assert.equal(Regras.validarEmail('aqs@fab.mil.br'), null);
  assert.match(Regras.validarEmail('sem-arroba'), /inválido/);
  assert.match(Regras.validarEmail(''), /Informe/);
});

teste('mimeDe usa a extensão quando o tipo vem vazio ou genérico', () => {
  assert.equal(Regras.mimeDe({ name: 'a.csv', type: 'application/vnd.ms-excel' }), 'text/csv');
  assert.equal(Regras.mimeDe({ name: 'a.docx', type: '' }), Regras.TIPOS_ARQUIVO.docx);
  assert.equal(Regras.mimeDe({ name: 'a.PNG', type: 'application/octet-stream' }), 'image/png');
  assert.equal(Regras.mimeDe({ name: 'a.bin', type: 'application/x-foo' }), 'application/x-foo');
  assert.equal(Regras.mimeDe({ name: 'a.bin', type: '' }), 'application/octet-stream');
});

teste('rotuloReferencia', () => {
  assert.equal(Regras.rotuloReferencia({ referencia: 'M2026-10' }), 'Out/2026');
  assert.equal(Regras.rotuloReferencia({ referencia: 'S2026-W42' }), 'Semana 42/2026');
  assert.equal(Regras.rotuloReferencia({ referencia: 'D2026-10-15' }), '15/10/2026');
  assert.equal(Regras.rotuloReferencia({ referencia: 'T2026-10' }), 'Trimestre de out/2026');
  assert.equal(Regras.rotuloReferencia({ referencia: 'H2026-07' }), 'Semestre de jul/2026');
  assert.equal(Regras.rotuloReferencia({ referencia: 'A2027-03' }), 'Ano 2027');
  assert.equal(Regras.rotuloReferencia({ referencia: 'P' }), 'Única');
  assert.equal(Regras.rotuloReferencia('M2027-01'), 'Jan/2027');
  assert.equal(Regras.rotuloReferencia({ referencia: null, titulo_execucao: 'Incidente 2026/037 — queda no leito' }),
    'Incidente 2026/037 — queda no leito');
  assert.equal(Regras.rotuloReferencia({ referencia: null, titulo_execucao: '', data_ref: '2026-10-02' }),
    'Execução de 02/10/2026');
  assert.equal(Regras.rotuloReferencia({ referencia: null, criado_em: '2026-10-03T02:00:00Z' }),
    'Execução de 02/10/2026', 'data em Belém, não em UTC');
});

teste('descreverRegra', () => {
  assert.equal(Regras.descreverRegra({ tipo: 'recorrente', periodicidade: 'mensal', dia_mes: 15, antecipar_dia_util: false }),
    'Mensal, até o dia 15');
  assert.equal(Regras.descreverRegra({ tipo: 'recorrente', periodicidade: 'mensal', dia_mes: 15 }),
    'Mensal, até o dia 15 (antecipa se não for dia útil)');
  assert.equal(Regras.descreverRegra({ tipo: 'recorrente', periodicidade: 'mensal', dia_mes: 31, antecipar_dia_util: true }),
    'Mensal, até o último dia do mês (último dia útil)');
  assert.equal(Regras.descreverRegra({ tipo: 'recorrente', periodicidade: 'semanal', dia_semana: 5, antecipar_dia_util: false }),
    'Semanal, às sextas-feiras');
  assert.equal(Regras.descreverRegra({ tipo: 'recorrente', periodicidade: 'diaria_util' }), 'Diária (dias úteis)');
  assert.equal(Regras.descreverRegra({ tipo: 'pontual', prazo: '2026-10-30' }), 'Pontual — prazo 30/10/2026');
  assert.equal(Regras.descreverRegra({ tipo: 'pontual', prazo: null }), 'Pontual — sem prazo definido');
  assert.equal(Regras.descreverRegra({ tipo: 'sob_demanda' }), 'Sob demanda');
  assert.equal(Regras.descreverRegra({ tipo: 'recorrente', periodicidade: 'trimestral', dia_mes: 10, mes_inicio: 1,
    antecipar_dia_util: false }), 'Trimestral (jan, abr, jul e out), até o dia 10');
  assert.equal(Regras.descreverRegra({ tipo: 'recorrente', periodicidade: 'semestral', dia_mes: 31, mes_inicio: 9,
    antecipar_dia_util: false }), 'Semestral (mar e set), até o último dia do mês');
  assert.equal(Regras.descreverRegra({ tipo: 'recorrente', periodicidade: 'anual', dia_mes: 1, mes_inicio: 3,
    antecipar_dia_util: false }), 'Anual, em março, até o dia 1');
});

teste('selos: classe só para valores conhecidos e texto escapado', () => {
  assert.equal(Regras.seloStatus('atrasada'), '<span class="selo selo--atrasada">Atrasada</span>');
  assert.equal(Regras.seloStatus('em_andamento'), '<span class="selo selo--em_andamento">Em andamento</span>');
  assert.equal(Regras.seloPrioridade('alta'), '<span class="selo selo--prio-alta">Alta</span>');
  assert.equal(Regras.seloNivel('urgente'), '<span class="selo selo--nivel-urgente">Urgente</span>');
  assert.equal(Regras.seloTipo('sob_demanda'), '<span class="selo selo--tipo-sob_demanda">Sob demanda</span>');
  const malicioso = Regras.seloStatus('"><img src=x onerror=alert(1)>');
  assert.ok(!malicioso.includes('<img'), 'escapa o valor desconhecido');
  assert.match(malicioso, /selo--neutro/);
  assert.match(Regras.seloStatus('constructor'), /selo--neutro/, 'propriedade herdada não vira classe');
});

teste('rotuloPapelAutor', () => {
  assert.equal(Regras.rotuloPapelAutor('chefia'), 'CHEFIA');
  assert.equal(Regras.rotuloPapelAutor('administrador'), 'AQS');
  assert.equal(Regras.rotuloPapelAutor('adjunto'), '');
});

/* ---------- resultado ---------- */

for (const f of falhas) {
  console.error('✗ ' + f.nome + '\n    ' + String(f.erro && f.erro.stack || f.erro).split('\n').slice(0, 6).join('\n    '));
}
console.log((falhas.length ? '✗' : '✓') + ' regras.mjs: ' + aprovados + ' aprovados, ' + falhas.length + ' com falha');
process.exitCode = falhas.length ? 1 : 0;
