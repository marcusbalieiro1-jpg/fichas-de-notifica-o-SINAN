#!/usr/bin/env node
/* =========================================================================
   HABE – AQS e NSP — paridade da recorrência: JS × SQL
   Uso: node testes/paridade-recorrencia.mjs   (a partir da pasta aqs-nsp)

   Compara Recorrencia.datas (assets/js/recorrencia.js) com a função
   privado.datas_ocorrencia do banco, para todas as periodicidades ×
   dia_semana 1..7 × dia_mes {1,5,10,15,28,29,30,31} × antecipar {sim,não}
   × mes_inicio {1,2,3} (quando aplicável), de 2026-01-01 a 2027-12-31,
   com os feriados cadastrados no banco (public.feriados).

   Conexão, nesta ordem:
     1. AQS_PG_AMBIENTE=/caminho/arquivo (linhas VAR=valor ou export VAR=valor);
     2. o arquivo de ambiente gravado por testes/executar-sql.sh --manter
        (lido do próprio script; hoje, $AQS_PG_BASE/conexao.env, padrão
        /tmp/aqs-nsp-pg/conexao.env);
     3. PGHOST/PGPORT/PGDATABASE/PGUSER(/PGPASSWORD) do ambiente.
   Banco indisponível ⇒ "PULADO: banco indisponível" e código 0 (ou falha,
   com AQS_EXIGIR_BANCO=1).

   Tudo vai numa única chamada ao psql (um arquivo SQL com a consulta
   inteira), para ser rápido. A assinatura da função é descoberta no
   catálogo (pg_proc) e os argumentos são passados por nome.
   ========================================================================= */

import vm from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DE = '2026-01-01';
const ATE = '2027-12-31';

/* AQS_EXIGIR_BANCO=1 (usado por testes/executar.sh, que acabou de subir o
   banco): sem banco é falha, não "pulado" — senão a paridade deixaria de
   ser conferida sem ninguém perceber. */
function pular(motivo) {
  if (process.env.AQS_EXIGIR_BANCO === '1') {
    console.error('✗ paridade-recorrencia.mjs: ' + motivo + ' (AQS_EXIGIR_BANCO=1)');
    process.exit(1);
  }
  console.log('PULADO: ' + motivo);
  process.exit(0);
}

function falhar(mensagem) {
  console.error('✗ paridade-recorrencia.mjs: ' + mensagem);
  process.exit(1);
}

/* ---------- conexão ---------- */

/* Lê VAR=valor / export VAR=valor (aspas simples ou duplas opcionais). */
function lerArquivoAmbiente(arquivo) {
  const vars = {};
  for (const linha of fs.readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)=(.*)$/.exec(linha);
    if (!m) { continue; }
    let valor = m[2].trim();
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
      valor = valor.slice(1, -1);
    }
    vars[m[1]] = valor;
  }
  return vars;
}

/* Caminhos de arquivo de ambiente citados em executar-sql.sh. O script é de
   outro módulo: lemos só literais e as variáveis mais comuns ($RAIZ,
   $DIR, $(dirname "$0"), $TMPDIR, $HOME), sem executar nada dele. */
function candidatosDoScript() {
  const script = path.join(raiz, 'testes', 'executar-sql.sh');
  if (!fs.existsSync(script)) { return []; }
  const texto = fs.readFileSync(script, 'utf8');
  const dirScript = path.dirname(script);
  const substituicoes = {
    RAIZ: raiz, AQS: raiz, PASTA: dirScript, DIR: dirScript, AQUI: dirScript, TESTES: dirScript,
    SCRIPT_DIR: dirScript, DIR_SCRIPT: dirScript, TMPDIR: os.tmpdir(), HOME: os.homedir()
  };
  /* variáveis atribuídas no próprio script com valor literal ou derivado */
  for (const m of texto.matchAll(/^\s*(?:readonly\s+|local\s+)?([A-Z_][A-Z0-9_]*)=["']?([^"'\n;]+)["']?/gm)) {
    let valor = m[2].trim()
      .replace(/\$\(\s*cd\s+"?\$\(\s*dirname\s+"?\$\{?(0|BASH_SOURCE\[0\])\}?"?\s*\)"?\s*(&&\s*pwd\s*)?\)/g, dirScript)
      .replace(/\$\(\s*dirname\s+"?\$\{?(0|BASH_SOURCE\[0\])\}?"?\s*\)/g, dirScript);
    valor = valor.replace(/\$\{?([A-Z_][A-Z0-9_]*)(?::-([^}]*))?\}?/g, (_, nome, padrao) => {
      if (substituicoes[nome] !== undefined) { return substituicoes[nome]; }
      if (process.env[nome]) { return process.env[nome]; }
      return padrao !== undefined ? padrao : '\u0000';
    });
    if (!valor.includes('\u0000') && !valor.includes('$(')) { substituicoes[m[1]] = valor; }
  }
  const candidatos = new Set();
  for (const [nome, valor] of Object.entries(substituicoes)) {
    if (/AMBIENTE|ENV|CONEXAO/.test(nome) && /[\\/]/.test(valor)) {
      candidatos.add(path.isAbsolute(valor) ? valor : path.resolve(dirScript, valor));
    }
  }
  for (const m of texto.matchAll(/["']?([\w./${}-]*(?:\.env|ambiente[\w.-]*))["']?/g)) {
    const valor = m[1].replace(/\$\{?([A-Z_][A-Z0-9_]*)\}?/g, (_, nome) => (substituicoes[nome] !== undefined ? substituicoes[nome] : '\u0000'));
    if (!valor.includes('\u0000') && /[\\/]/.test(valor)) {
      candidatos.add(path.isAbsolute(valor) ? valor : path.resolve(dirScript, valor));
    }
  }
  return [...candidatos];
}

function ambienteDeConexao() {
  const base = { ...process.env };
  const arquivos = [];
  if (process.env.AQS_PG_AMBIENTE) { arquivos.push(process.env.AQS_PG_AMBIENTE); }
  arquivos.push(...candidatosDoScript());
  /* O caminho documentado em executar-sql.sh (--manter), caso a leitura do
     script acima não o encontre. */
  arquivos.push(path.join(process.env.AQS_PG_BASE || '/tmp/aqs-nsp-pg', 'conexao.env'));
  for (const arquivo of arquivos) {
    try {
      if (fs.existsSync(arquivo) && fs.statSync(arquivo).isFile()) {
        const vars = lerArquivoAmbiente(arquivo);
        if (Object.keys(vars).some((k) => k.startsWith('PG') || k === 'DATABASE_URL')) {
          if (vars.DATABASE_URL && !vars.PGDATABASE) { vars.PGDATABASE = vars.DATABASE_URL; }
          return { env: { ...base, ...vars }, origem: arquivo };
        }
      }
    } catch (e) { /* tenta o próximo */ }
  }
  if (process.env.PGHOST || process.env.PGPORT || process.env.PGDATABASE || process.env.PGUSER) {
    return { env: base, origem: 'variáveis PG* do ambiente' };
  }
  return null;
}

function acharPsql() {
  const pastas = (process.env.PATH || '').split(path.delimiter).concat(['/usr/lib/postgresql/16/bin', '/usr/bin']);
  for (const pasta of pastas) {
    const candidato = path.join(pasta, 'psql');
    try { fs.accessSync(candidato, fs.constants.X_OK); return candidato; } catch (e) { /* segue */ }
  }
  return null;
}

const psql = acharPsql();
if (!psql) { pular('banco indisponível (psql não encontrado)'); }
const conexao = ambienteDeConexao();
if (!conexao) { pular('banco indisponível (sem arquivo de ambiente de executar-sql.sh nem PGHOST/PGDATABASE)'); }

/* Uma chamada ao psql: devolve stdout ou lança com a mensagem do banco. */
function consultar(sql) {
  const arquivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aqs-paridade-')), 'consulta.sql');
  fs.writeFileSync(arquivo, sql);
  try {
    const r = spawnSync(psql, ['-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-f', arquivo], {
      env: conexao.env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 120000
    });
    if (r.error) { throw r.error; }
    if (r.status !== 0) { throw new Error((r.stderr || r.stdout || 'psql falhou').trim()); }
    return r.stdout;
  } finally {
    fs.rmSync(path.dirname(arquivo), { recursive: true, force: true });
  }
}

/* ---------- descoberta da função ---------- */

/* Erros de conexão (servidor parado, socket ausente, senha, banco/papel
   inexistente) contam como "banco indisponível", não como falha. */
const SEM_BANCO = /could not connect|connection to server|Connection refused|No such file or directory|timeout expired|password authentication failed|database ".*" does not exist|role ".*" does not exist|could not translate host name/i;

let catalogo;
try {
  catalogo = JSON.parse(consultar(`
    select coalesce(json_agg(json_build_object(
      'assinatura', p.oid::regprocedure::text,
      'nomes', p.proargnames,
      'modos', p.proargmodes,
      'tipos', (select array_agg(format_type(t, null) order by o)
                from unnest(coalesce(p.proallargtypes, p.proargtypes::oid[])) with ordinality as x(t, o)),
      'padroes', p.pronargdefaults,
      'qtd_entrada', p.pronargs
    )), '[]'::json)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'privado' and p.proname = 'datas_ocorrencia';`).trim() || '[]');
} catch (erro) {
  if (SEM_BANCO.test(erro.message)) { pular('banco indisponível (' + erro.message.split('\n')[0] + ')'); }
  falhar('erro ao consultar o catálogo: ' + erro.message);
}

if (!catalogo.length) {
  falhar('a função privado.datas_ocorrencia não existe no banco (' + conexao.origem + '). Aplique supabase/*.sql antes.');
}
if (catalogo.length > 1) {
  falhar('há mais de uma privado.datas_ocorrencia (sobrecarga): ' + catalogo.map((f) => f.assinatura).join(' | '));
}
const funcao = catalogo[0];
const nomes = funcao.nomes || [];
const modos = funcao.modos || nomes.map(() => 'i');
const tipos = funcao.tipos || [];
const entradas = [];
const saidas = [];
nomes.forEach((nome, i) => {
  const modo = modos[i] || 'i';
  if (modo === 'i' || modo === 'b' || modo === 'v') { entradas.push({ nome, tipo: tipos[i], indice: entradas.length }); }
  if (modo === 'o' || modo === 'b' || modo === 't') { saidas.push({ nome, tipo: tipos[i] }); }
});
if (!nomes.length && funcao.qtd_entrada) {
  falhar('os parâmetros de privado.datas_ocorrencia não têm nome (' + funcao.assinatura + '); não dá para montar a chamada.');
}

/* Expressão SQL de cada parâmetro, a partir das colunas do caso (c.*). */
const JSON_ATIVIDADE = `jsonb_build_object('tipo', 'recorrente', 'periodicidade', c.periodicidade,
  'dia_semana', c.dia_semana, 'dia_mes', c.dia_mes, 'mes_inicio', c.mes_inicio,
  'antecipar_dia_util', c.antecipar, 'ativa', true, 'data_inicio', '${DE}'::date, 'titulo', 'paridade')`;

function expressaoDe(param) {
  const n = String(param.nome).toLowerCase().replace(/^_+|^p_|^a_|^v_/, '');
  const t = String(param.tipo).toLowerCase();
  if (/(^|\.)atividades$/.test(t)) { return `jsonb_populate_record(null::${param.tipo}, ${JSON_ATIVIDADE})`; }
  if (t === 'jsonb' || t === 'json') { return `${JSON_ATIVIDADE}::${t}`; }
  if (/periodicidade/.test(n)) { return 'c.periodicidade'; }
  if (/dia_semana|diasemana/.test(n)) { return 'c.dia_semana'; }
  if (/dia_mes|diames/.test(n)) { return 'c.dia_mes'; }
  if (/mes_inicio|mesinicio/.test(n)) { return 'c.mes_inicio'; }
  if (/antecip/.test(n)) { return 'c.antecipar'; }
  if (/^tipo$/.test(n)) { return "'recorrente'"; }
  if (/feriado/.test(n)) {
    return t.endsWith('[]') ? '(select coalesce(array_agg(data), \'{}\') from public.feriados)' : null;
  }
  if (/^(de|desde|inicio|data_inicio|ini|data_de|dt_de|periodo_inicio)$/.test(n)) { return `'${DE}'::date`; }
  if (/^(ate|até|fim|data_fim|data_ate|dt_ate|periodo_fim)$/.test(n)) { return `'${ATE}'::date`; }
  return null;
}

const argumentos = [];
for (const param of entradas) {
  const expr = expressaoDe(param);
  const temPadrao = param.indice >= entradas.length - (funcao.padroes || 0);
  if (expr === null) {
    if (temPadrao) { continue; }
    falhar('não sei o que passar no parâmetro "' + param.nome + '" (' + param.tipo + ') de ' + funcao.assinatura);
  }
  argumentos.push(`"${param.nome}" => ${expr}`);
}

const colunaRef = (saidas.find((s) => s.nome === 'referencia') || saidas.find((s) => s.tipo === 'text') || {}).nome;
const colunaPrazo = (saidas.find((s) => s.nome === 'prazo') || saidas.find((s) => s.tipo === 'date') || {}).nome;
if (!colunaRef || !colunaPrazo) {
  falhar('a saída de ' + funcao.assinatura + ' não tem colunas de referência (text) e prazo (date).');
}

/* ---------- casos ---------- */

const DIAS_MES = [1, 5, 10, 15, 28, 29, 30, 31];
const casos = [];
for (const antecipar of [true, false]) {
  casos.push({ periodicidade: 'diaria_util', dia_semana: null, dia_mes: null, mes_inicio: null, antecipar });
  for (let ds = 1; ds <= 7; ds += 1) {
    casos.push({ periodicidade: 'semanal', dia_semana: ds, dia_mes: null, mes_inicio: null, antecipar });
  }
  for (const dm of DIAS_MES) {
    casos.push({ periodicidade: 'mensal', dia_semana: null, dia_mes: dm, mes_inicio: null, antecipar });
    for (const per of ['trimestral', 'semestral', 'anual']) {
      for (const mi of [1, 2, 3]) {
        casos.push({ periodicidade: per, dia_semana: null, dia_mes: dm, mes_inicio: mi, antecipar });
      }
    }
  }
}
casos.forEach((c, i) => { c.id = i + 1; });

const sqlNum = (v) => (v === null ? 'null::int' : String(v) + '::int');
const valores = casos.map((c) =>
  `(${c.id}, '${c.periodicidade}'::text, ${sqlNum(c.dia_semana)}, ${sqlNum(c.dia_mes)}, ${sqlNum(c.mes_inicio)}, ${c.antecipar})`
).join(',\n  ');

const sql = `
with casos(id, periodicidade, dia_semana, dia_mes, mes_inicio, antecipar) as (values
  ${valores}
)
select json_build_object(
  'feriados', (select coalesce(json_agg(to_char(data, 'YYYY-MM-DD') order by data), '[]'::json) from public.feriados),
  'linhas', (select coalesce(json_agg(json_build_array(c.id, r."${colunaRef}", to_char(r."${colunaPrazo}", 'YYYY-MM-DD'))), '[]'::json)
             from casos c
             cross join lateral privado.datas_ocorrencia(${argumentos.join(', ')}) r
             where r."${colunaPrazo}" between '${DE}'::date and '${ATE}'::date)
);`;

let resultado;
try {
  resultado = JSON.parse(consultar(sql).trim());
} catch (erro) {
  falhar('erro ao chamar ' + funcao.assinatura + ':\n' + erro.message);
}

/* ---------- comparação ---------- */

const contexto = vm.createContext({ console });
contexto.window = contexto;
vm.runInContext(fs.readFileSync(path.join(raiz, 'assets/js/recorrencia.js'), 'utf8'), contexto);
const { Recorrencia } = contexto;

const doBanco = new Map(casos.map((c) => [c.id, []]));
for (const [id, referencia, prazo] of resultado.linhas) { doBanco.get(id).push({ referencia, prazo }); }

const ordenar = (lista) => lista.slice().sort((a, b) =>
  (a.prazo < b.prazo ? -1 : a.prazo > b.prazo ? 1 : a.referencia < b.referencia ? -1 : a.referencia > b.referencia ? 1 : 0));

let divergentes = 0;
let totalLinhas = 0;
for (const c of casos) {
  const atividade = { tipo: 'recorrente', periodicidade: c.periodicidade, dia_semana: c.dia_semana,
    dia_mes: c.dia_mes, mes_inicio: c.mes_inicio, antecipar_dia_util: c.antecipar };
  const js = ordenar(JSON.parse(JSON.stringify(Recorrencia.datas(atividade, DE, ATE, resultado.feriados))));
  const banco = ordenar(doBanco.get(c.id));
  totalLinhas += js.length;
  const a = JSON.stringify(js), b = JSON.stringify(banco);
  if (a !== b) {
    divergentes += 1;
    if (divergentes <= 10) {
      const soJs = js.filter((x) => !banco.some((y) => y.referencia === x.referencia && y.prazo === x.prazo));
      const soBanco = banco.filter((x) => !js.some((y) => y.referencia === x.referencia && y.prazo === x.prazo));
      console.error('✗ ' + JSON.stringify(atividade) + '\n    só no JS: ' + JSON.stringify(soJs.slice(0, 5)) +
        '\n    só no SQL: ' + JSON.stringify(soBanco.slice(0, 5)));
    }
  }
}

if (!resultado.feriados.length) {
  console.warn('  atenção: public.feriados está vazia — a comparação não exercitou a antecipação por feriado.');
}

if (divergentes) {
  falhar(divergentes + ' de ' + casos.length + ' casos divergem entre Recorrencia.datas e ' + funcao.assinatura + '.');
}
console.log('✓ paridade-recorrencia.mjs: ' + casos.length + ' casos, ' + totalLinhas + ' datas idênticas entre JS e SQL (' +
  funcao.assinatura + '; ' + resultado.feriados.length + ' feriados; conexão: ' + conexao.origem + ')');
