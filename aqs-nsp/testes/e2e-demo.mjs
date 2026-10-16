// =========================================================================
// HABE · AQS e NSP — teste de ponta a ponta do modo demonstração
//
// Abre demo.html num Chromium de verdade (Playwright), no computador
// (1280×800) e no celular (390×844, toque), e percorre o uso real da
// ferramenta pelos três papéis:
//
//   Ten Letícia (adjunta): Início (indicadores, aviso com "Ciente"),
//     Quadro (abre a missão, inicia, conclui, anexa um PDF, comenta, abre a
//     evidência), Calendário, Atividades (cria uma pontual; não há a opção
//     "Recorrente" para ela), Avisos, Relatórios (CSV), Plano (.doc),
//     Equipe (somente leitura), Minha conta e Sair;
//   Chefia: aviso só para o Ten Wallace; cadastra um militar e cria o acesso
//     (senha temporária na tela); passa a chefia para ele (a chefia antiga
//     vira adjunta);
//   Conta institucional (aqs@demo.local, pelo formulário de login): alertas
//     de continuidade no Início; exclui uma adjunta e confere que os
//     comentários e a evidência dela continuam com o nome; Auditoria; tema
//     escuro.
//
// E confere: index.html sem configuração mostra "Configuração pendente".
//
// O teste FALHA em qualquer violação de CSP (mensagem de console e evento
// securitypolicyviolation), erro de console, erro de página, resposta HTTP
// >= 400, requisição para fora do servidor local (a demonstração não usa
// rede) e, no celular, em qualquer rota com rolagem horizontal.
//
// Uso:  node testes/e2e-demo.mjs [--docs]
//   AQS_CAPTURAS=pasta   onde gravar as capturas (padrão: <tmp>/aqs-nsp-capturas)
//   --docs               copia 4 capturas (início e quadro; computador e
//                        celular) para docs/capturas/ (PNG < 300 KB)
// Requer: Playwright em /opt/node-tools/node_modules (ou PLAYWRIGHT_DIR),
// Chromium em /opt/pw-browsers (ou PLAYWRIGHT_BROWSERS_PATH) e o
// http-server (em /opt/node22/bin, no PATH ou via HTTP_SERVER).
// Código de saída: 0 = tudo certo; 1 = alguma falha.
// =========================================================================

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PASTA_PLAYWRIGHT = process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules/';
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
const require = createRequire(PASTA_PLAYWRIGHT.endsWith('/') ? PASTA_PLAYWRIGHT : PASTA_PLAYWRIGHT + '/');
const { chromium } = require('playwright');

const CAPTURAS = path.resolve(process.env.AQS_CAPTURAS || path.join(os.tmpdir(), 'aqs-nsp-capturas'));
const CAPTURAS_REVISAO = path.join(CAPTURAS, 'paginas-inteiras');
const COPIAR_PARA_DOCS = process.argv.includes('--docs');
const LIMITE_CAPTURA_DOCS = 300 * 1024;
const TEMPO_PASSO = 15000;

const ROTAS = ['inicio', 'quadro', 'atividades', 'avisos', 'relatorios', 'plano', 'equipe', 'conta'];
const ROTAS_BARRA_INFERIOR = ['inicio', 'quadro', 'avisos', 'atividades'];
const ABAS_EQUIPE = ['militares', 'chefia', 'setores', 'feriados', 'continuidade', 'auditoria'];

const PERFIS_TELA = [
  { nome: 'computador', viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false },
  { nome: 'celular', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
];

const falhas = [];
let verificacoes = 0;
let contexto = '';

function ok(condicao, descricao) {
  verificacoes += 1;
  if (!condicao) {
    falhas.push(`[${contexto}] ${descricao}`);
    console.log(`   ✗ ${descricao}`);
  }
  return !!condicao;
}

function registrarFalha(texto) {
  falhas.push(`[${contexto}] ${texto}`);
  console.log(`   ✗ ${texto}`);
}

// ---------------------------------------------------------------- servidor

function portaLivre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function acharHttpServer() {
  const candidatos = [process.env.HTTP_SERVER, '/opt/node22/bin/http-server',
    ...(process.env.PATH || '').split(path.delimiter).map((p) => path.join(p, 'http-server'))].filter(Boolean);
  return candidatos.find((c) => { try { fs.accessSync(c, fs.constants.X_OK); return true; } catch { return false; } });
}

async function subirServidor() {
  const binario = acharHttpServer();
  if (!binario) { throw new Error('http-server não encontrado (defina HTTP_SERVER).'); }
  const porta = await portaLivre();
  // -c-1: sem cache (cada execução testa os arquivos atuais); -s: silencioso.
  const processo = spawn(binario, [RAIZ, '-p', String(porta), '-a', '127.0.0.1', '-c-1', '-s'],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  let erroServidor = '';
  processo.stderr.on('data', (d) => { erroServidor += d; });
  const base = `http://127.0.0.1:${porta}`;
  for (let i = 0; i < 100; i += 1) {
    try {
      const r = await fetch(base + '/demo.html');
      if (r.ok) { return { processo, base }; }
    } catch { /* ainda subindo */ }
    if (processo.exitCode !== null) { throw new Error('http-server saiu: ' + erroServidor); }
    await new Promise((r) => setTimeout(r, 100));
  }
  processo.kill();
  throw new Error('http-server não respondeu em 10 s.');
}

// ------------------------------------------------------------ navegador

function vigiarPagina(pagina, base) {
  const origem = new URL(base).origin;
  pagina.on('console', (m) => {
    const texto = m.text();
    if (/Content Security Policy/i.test(texto)) { registrarFalha('violação de CSP no console: ' + texto); return; }
    if (m.type() === 'error') { registrarFalha('erro no console: ' + texto); }
  });
  pagina.on('pageerror', (e) => registrarFalha('erro de página: ' + e.message));
  pagina.on('response', (r) => {
    if (r.status() >= 400) { registrarFalha(`HTTP ${r.status()} em ${r.url()}`); }
  });
  pagina.on('request', (r) => {
    const url = r.url();
    if (/^(data|blob|about):/.test(url)) { return; }
    if (new URL(url).origin !== origem) { registrarFalha('requisição para fora do servidor local: ' + url); }
  });
  pagina.on('dialog', async (d) => {
    pagina.dialogos.push(d.message());
    await d.accept();
  });
  pagina.dialogos = [];
}

async function novoContexto(navegador, base, perfil) {
  const ctx = await navegador.newContext({
    viewport: perfil.viewport,
    isMobile: perfil.isMobile,
    hasTouch: perfil.hasTouch,
    deviceScaleFactor: 1,
    locale: 'pt-BR',
    timezoneId: 'America/Belem',
    colorScheme: 'light',
    acceptDownloads: true
  });
  ctx.setDefaultTimeout(TEMPO_PASSO);
  // Toda violação de CSP vira erro de console (e fica registrada na página).
  await ctx.addInitScript(() => {
    window.__violacoesCsp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__violacoesCsp.push(e.violatedDirective + ' ' + e.blockedURI);
      console.error('Content Security Policy violada: ' + e.violatedDirective + ' — ' + (e.blockedURI || 'inline'));
    });
  });
  const pagina = await ctx.newPage();
  vigiarPagina(pagina, base);
  return { ctx, pagina };
}

// --------------------------------------------------------------- ajudantes

async function capturar(pagina, nome, perfil) {
  fs.mkdirSync(CAPTURAS_REVISAO, { recursive: true });
  await pagina.waitForTimeout(250); // animações de entrada (painel, torradas)
  const arquivo = path.join(CAPTURAS, `${perfil.nome}-${nome}.png`);
  // As torradas ("Ciência registrada." etc.) são passageiras: ficam fora da
  // foto, para a captura mostrar a tela como ela fica.
  await pagina.evaluate(() => { document.getElementById('avisosFlutuantes').style.visibility = 'hidden'; });
  await pagina.screenshot({ path: arquivo });
  await pagina.screenshot({ path: path.join(CAPTURAS_REVISAO, `${perfil.nome}-${nome}.png`), fullPage: true });
  await pagina.evaluate(() => { document.getElementById('avisosFlutuantes').style.visibility = ''; });
  return arquivo;
}

async function esperarPagina(pagina, rota) {
  await pagina.waitForFunction((r) => {
    const el = document.getElementById('pagina-' + r);
    return !!el && !el.classList.contains('oculto') && el.children.length > 0 &&
      !el.querySelector('.carregando:not(.carregando--inline)');
  }, rota);
  await pagina.waitForTimeout(150);
}

async function semRolagemHorizontal(pagina, onde) {
  const medidas = await pagina.evaluate(() => ({
    rolagem: document.documentElement.scrollWidth,
    corpo: document.body.scrollWidth,
    janela: window.innerWidth
  }));
  ok(medidas.rolagem <= medidas.janela && medidas.corpo <= medidas.janela,
    `sem rolagem horizontal em ${onde} (scrollWidth ${medidas.rolagem}/${medidas.corpo}, janela ${medidas.janela})`);
}

async function irPara(pagina, rota, perfil, parametros = '') {
  const celular = perfil.nome === 'celular';
  if (parametros) {
    await pagina.evaluate((h) => { window.location.hash = h; }, `#/${rota}${parametros}`);
  } else if (rota === 'conta' && !celular) {
    await pagina.click('#usuarioChip');
  } else if (!celular) {
    await pagina.click(`.navegacao a[data-rota="${rota}"]`);
  } else if (ROTAS_BARRA_INFERIOR.includes(rota)) {
    await pagina.click(`.barra-inferior a[data-rota="${rota}"]`);
  } else {
    await pagina.click('#botaoMais');
    await pagina.click(`#menuMais a[data-rota="${rota}"]`);
  }
  await esperarPagina(pagina, rota);
  if (celular) { await semRolagemHorizontal(pagina, `#/${rota}${parametros}`); }
}

async function entrarComo(pagina, base, textoBotao) {
  if (!/demo\.html/.test(pagina.url())) { await pagina.goto(base + '/demo.html'); }
  await pagina.waitForSelector('.entrar-como__botao');
  await pagina.locator('.entrar-como__botao', { hasText: textoBotao }).first().click();
  await pagina.waitForSelector('#telaApp:not(.oculto)');
  await esperarPagina(pagina, 'inicio');
}

async function sair(pagina, perfil) {
  if (perfil.nome === 'celular') {
    await pagina.click('#botaoMais');
    await pagina.click('#botaoSairMais');
  } else {
    await pagina.click('#botaoSair');
  }
  await pagina.waitForSelector('#formLogin');
  const restos = await pagina.evaluate(() => ({
    paginas: Array.from(document.querySelectorAll('.pagina')).map((p) => p.innerHTML.length).reduce((a, b) => a + b, 0),
    painel: document.getElementById('painelDetalhe').innerHTML.length,
    chip: document.getElementById('usuarioChip').innerHTML.length,
    preferencias: Object.keys(sessionStorage).filter((k) => /^aqs_(quadro|inicio|atividades|plano|relatorios)/.test(k))
  }));
  ok(restos.paginas === 0 && restos.painel === 0 && restos.chip === 0, 'ao sair, nenhum dado fica no DOM');
  ok(restos.preferencias.length === 0, 'ao sair, as preferências de tela da aba são apagadas');
}

// Espera um texto aparecer VISÍVEL dentro de raiz (no celular as tabelas
// do computador continuam no DOM, só escondidas).
async function esperarTexto(pagina, raiz, texto) {
  await pagina.locator(raiz).getByText(texto, { exact: false }).filter({ visible: true }).first().waitFor();
}

async function militarPorNome(pagina, nomeGuerra) {
  return pagina.evaluate((n) => Api.listarMilitares().then((l) => l.find((m) => m.nome_guerra === n) || null), nomeGuerra);
}

async function lerDownload(download) {
  const caminho = await download.path();
  return fs.readFileSync(caminho);
}

async function fecharPainel(pagina) {
  await pagina.click('#painelDetalhe .painel__fechar');
  await pagina.waitForFunction(() => !document.querySelector('#painelDetalhe .painel'));
}

// Um PDF mínimo válido (1 página em branco): o bastante para o navegador
// tratá-lo como PDF; o conteúdo é fictício.
const PDF_FALSO = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'latin1');

// ---------------------------------------------------------------- roteiro

async function roteiroAdjunta(pagina, base, perfil, estado) {
  contexto = `${perfil.nome} · Ten Letícia`;
  console.log(`== ${contexto}`);
  await pagina.goto(base + '/demo.html');
  await pagina.waitForSelector('.entrar-como__botao');
  await capturar(pagina, '00-login', perfil);
  if (perfil.nome === 'celular') { await semRolagemHorizontal(pagina, 'tela de login'); }

  await entrarComo(pagina, base, 'Ten Letícia');
  if (perfil.nome === 'celular') { await semRolagemHorizontal(pagina, '#/inicio'); }
  estado.leticia = await militarPorNome(pagina, 'Letícia');
  ok(!!estado.leticia, 'a Ten Letícia existe na demonstração');

  // Início: indicadores e aviso com "Ciente".
  ok(await pagina.locator('#inicioIndicadores a.indicador').count() === 4, 'Início mostra os 4 indicadores');
  const botaoCiente = pagina.locator('[data-ciente]').first();
  ok(await botaoCiente.count() === 1, 'Início mostra um aviso aguardando "Ciente"');
  await capturar(pagina, '01-inicio', perfil);
  const idAviso = await botaoCiente.getAttribute('data-ciente');
  await botaoCiente.click();
  await pagina.waitForFunction((id) => !document.querySelector('[data-ciente="' + id + '"]'), idAviso);
  const ciente = await pagina.evaluate((id) => Api.listarAvisos({}).then((l) => l.find((a) => a.id === id)), idAviso);
  ok(ciente && ciente.ciente_por_mim === true, '"Ciente" grava a ciência do aviso e ele sai do Início');

  // Quadro: abre uma missão, inicia, conclui, anexa, comenta, abre a evidência.
  await irPara(pagina, 'quadro', perfil);
  await pagina.waitForSelector('#quadroConteudo [data-abrir-ocorrencia]');
  await capturar(pagina, '02-quadro', perfil);
  // Filtros: no celular ficam recolhidos atrás do botão "Filtros" (as
  // missões aparecem logo na primeira tela); no computador, sempre à vista.
  if (perfil.nome === 'celular') {
    ok(await pagina.locator('#quadroResponsavel').isHidden(), 'no celular os filtros começam recolhidos');
    await pagina.click('[data-acao="alternar-filtros"]');
    ok(await pagina.locator('#quadroResponsavel').isVisible(), '"Filtros" abre responsável, setor e período');
    await semRolagemHorizontal(pagina, 'filtros abertos do quadro');
    await pagina.click('[data-acao="alternar-filtros"]');
    ok(await pagina.locator('#quadroResponsavel').isHidden(), '"Filtros" recolhe de novo');
  } else {
    ok(await pagina.locator('#quadroResponsavel').isVisible() &&
      await pagina.locator('[data-acao="alternar-filtros"]').isHidden(), 'no computador os filtros ficam sempre à vista');
  }
  const atrasadasInicio = await pagina.evaluate(() => Api.listarOcorrencias({ somenteAbertas: true })
    .then((l) => l.filter((o) => o.atrasada && o.responsaveis.includes(App.militar().id)).length));
  ok(await pagina.locator('#quadroResumo').innerText().then((t) => t.includes(atrasadasInicio + ' atrasada')),
    'o Quadro mostra todas as atrasadas (inclusive diárias de dias anteriores)');
  const alvo = await pagina.evaluate(() => Api.listarOcorrencias({ somenteAbertas: true }).then((l) => {
    const eu = App.militar().id;
    const minhas = l.filter((o) => o.responsaveis.includes(eu) && o.status === 'pendente' && o.atrasada);
    return minhas.length ? minhas[0] : null;
  }));
  ok(!!alvo, 'há uma missão atrasada e pendente da Ten Letícia');
  estado.ocorrencia = alvo.id;
  const cartao = pagina.locator(`#quadroConteudo [data-abrir-ocorrencia="${alvo.id}"]:visible`).first();
  if (await cartao.count()) {
    await cartao.click();
  } else {
    await pagina.evaluate((id) => { window.location.hash = '#/quadro?ocorrencia=' + id; }, alvo.id);
  }
  await pagina.waitForSelector('#painelDetalhe [data-situacao="em_andamento"]');
  if (perfil.nome === 'celular') { await semRolagemHorizontal(pagina, 'painel da missão'); }
  await pagina.click('#painelDetalhe [data-situacao="em_andamento"]');
  await pagina.waitForSelector('#painelDetalhe [data-situacao="em_andamento"][aria-pressed="true"]');
  await pagina.click('#painelDetalhe [data-situacao="concluida"]');
  await pagina.waitForSelector('#painelDetalhe [data-situacao="concluida"][aria-pressed="true"]');
  const concluida = await pagina.evaluate((id) => Api.obterOcorrencia(id), alvo.id);
  ok(concluida.status === 'concluida' && !!concluida.iniciada_em && concluida.concluida_por === estado.leticia.id,
    'Iniciar e Concluir gravam a situação, o início e quem concluiu');

  await pagina.setInputFiles('#detArquivo', { name: 'Relatorio-indicadores-E2E.pdf', mimeType: 'application/pdf', buffer: PDF_FALSO });
  await pagina.waitForSelector('#painelDetalhe .evidencia__nome:has-text("Relatorio-indicadores-E2E.pdf")');
  const textoComentario = 'Concluído no teste E2E <b>sem negrito</b> & "aspas".';
  await pagina.fill('#detComentarioTexto', textoComentario);
  await pagina.click('#detComentarioEnviar');
  const comentario = pagina.locator('#painelDetalhe .comentario__texto', { hasText: 'Concluído no teste E2E' });
  await comentario.waitFor();
  ok((await comentario.innerText()).includes('<b>sem negrito</b>') && await comentario.locator('b').count() === 0,
    'o comentário aparece escapado (HTML vira texto)');

  // "Abrir" a evidência: PDF abre numa aba nova (blob:) ou, se o navegador
  // preferir, é baixado.
  const resultadoAbrir = Promise.race([
    pagina.context().waitForEvent('page', { timeout: TEMPO_PASSO }).then((p) => ({ tipo: 'aba', p })),
    pagina.waitForEvent('download', { timeout: TEMPO_PASSO }).then((d) => ({ tipo: 'download', d }))
  ]);
  await pagina.locator('#painelDetalhe [data-abrir-evidencia]').first().click();
  const aberto = await resultadoAbrir;
  if (aberto.tipo === 'aba') {
    ok(aberto.p.url().startsWith('blob:'), 'a evidência abre numa aba nova com endereço blob: (sem servidor)');
    await aberto.p.close();
  } else {
    ok(/\.pdf$/.test(aberto.d.suggestedFilename()), 'a evidência é baixada como PDF');
    ok((await lerDownload(aberto.d)).subarray(0, 5).toString() === '%PDF-', 'o arquivo baixado é o PDF enviado');
  }
  await capturar(pagina, '03-detalhe', perfil);
  await fecharPainel(pagina);

  // Calendário.
  await pagina.click('[data-modo="calendario"]');
  await pagina.waitForSelector(perfil.nome === 'celular' ? '#quadroConteudo .agenda, #quadroConteudo [class*="agenda"]' : '#quadroConteudo .calendario');
  await pagina.waitForTimeout(200);
  if (perfil.nome === 'celular') { await semRolagemHorizontal(pagina, 'calendário'); }
  await capturar(pagina, '04-calendario', perfil);
  await pagina.click('[data-modo="quadro"]');

  // Atividades: cria uma pontual; não há "Recorrente" para a adjunta.
  await irPara(pagina, 'atividades', perfil);
  await capturar(pagina, '05-atividades', perfil);
  await pagina.click('#pagina-atividades [data-acao="nova"]');
  await pagina.waitForSelector('#faForm');
  ok(await pagina.locator('#faForm input[name="faTipo"][value="recorrente"]').count() === 0,
    'o formulário da adjunta não oferece o tipo Recorrente');
  ok(await pagina.locator('#faForm input[name="faTipo"]').count() === 2, 'a adjunta escolhe entre Pontual e Sob demanda');
  await pagina.locator('#faForm label', { has: pagina.locator('input[name="faTipo"][value="pontual"]') }).click();
  const tituloAtividade = 'Revisar o mural de segurança do paciente (E2E ' + perfil.nome + ')';
  await pagina.fill('#faTitulo', tituloAtividade);
  const prazo = await pagina.evaluate(() => Api.referencias()
    .then((r) => Recorrencia.antecipar(U.somarDias(U.hojeBelem(), 9), r.feriados)));
  await pagina.fill('#faPrazo', prazo);
  ok(await pagina.locator(`#faForm input[name="faResponsavel"][value="${estado.leticia.id}"]`).isChecked(),
    'a própria adjunta já vem marcada como responsável');
  if (perfil.nome === 'celular') { await semRolagemHorizontal(pagina, 'formulário de atividade'); }
  await capturar(pagina, '06-nova-atividade', perfil);
  await pagina.click('#faSalvar');
  await pagina.waitForFunction(() => !document.querySelector('#faForm'));
  await esperarTexto(pagina, '#pagina-atividades', tituloAtividade);
  const criada = await pagina.evaluate((t) => Api.listarAtividades().then((l) => l.find((a) => a.titulo === t)), tituloAtividade);
  ok(criada && criada.tipo === 'pontual' && criada.prazo === prazo && criada.responsaveis.length === 1,
    'a atividade pontual foi criada com prazo e a adjunta como responsável');

  // Avisos (adjunta não publica).
  await irPara(pagina, 'avisos', perfil);
  ok(await pagina.locator('#pagina-avisos [data-acao="novo"]').count() === 0, 'a adjunta não vê "Novo aviso"');
  await capturar(pagina, '07-avisos', perfil);

  // Relatórios: CSV.
  await irPara(pagina, 'relatorios', perfil);
  const [csv] = await Promise.all([
    pagina.waitForEvent('download'),
    pagina.click('#pagina-relatorios [data-acao="csv-resumo"]')
  ]);
  const conteudoCsv = (await lerDownload(csv)).toString('utf8');
  ok(/\.csv$/.test(csv.suggestedFilename()), 'Relatórios exporta um arquivo .csv');
  ok(conteudoCsv.charCodeAt(0) === 0xfeff && conteudoCsv.split('\n').length > 3 && /TOTAL/.test(conteudoCsv),
    'o CSV tem BOM (acentos no Excel), linhas e o TOTAL');
  await capturar(pagina, '08-relatorios', perfil);

  // Plano: .doc.
  await irPara(pagina, 'plano', perfil);
  const [doc] = await Promise.all([
    pagina.waitForEvent('download'),
    pagina.click('#pagina-plano [data-acao="word"]')
  ]);
  const conteudoDoc = (await lerDownload(doc)).toString('utf8');
  ok(/^Plano-de-Atividades-NSP-\d{4}-\d{2}-\d{2}\.doc$/.test(doc.suggestedFilename()), 'Plano baixa o .doc com o nome padrão');
  ok(/urn:schemas-microsoft-com:office:word/.test(conteudoDoc) && !/<script/i.test(conteudoDoc) &&
    /HOSPITAL DE AERONÁUTICA DE BELÉM/.test(conteudoDoc), 'o .doc é HTML do Word, institucional e sem script');
  await capturar(pagina, '09-plano', perfil);

  // Equipe: somente leitura.
  await irPara(pagina, 'equipe', perfil);
  ok(await pagina.locator('#pagina-equipe [data-eq-acao], #pagina-equipe [data-militar]').count() === 0,
    'Equipe é somente leitura para a adjunta (sem ações)');
  ok(!(await pagina.locator('#pagina-equipe').innerText()).includes('@demo.local'), 'a adjunta não vê e-mails da equipe');
  await capturar(pagina, '10-equipe', perfil);

  // Minha conta.
  await irPara(pagina, 'conta', perfil);
  await capturar(pagina, '11-conta', perfil);

  // Sino de notificações.
  await pagina.click('#botaoSino');
  await pagina.waitForSelector('#menuNotificacoes:not(.oculto) .notificacao-item, #menuNotificacoes:not(.oculto) .menu-notificacoes__estado strong');
  if (perfil.nome === 'celular') { await semRolagemHorizontal(pagina, 'menu de notificações'); }
  await capturar(pagina, '12-notificacoes', perfil);
  await pagina.keyboard.press('Escape');

  await sair(pagina, perfil);
}

async function roteiroChefia(pagina, base, perfil, estado) {
  contexto = `${perfil.nome} · Chefia`;
  console.log(`== ${contexto}`);
  await entrarComo(pagina, base, 'Chefia NSP');
  estado.chefia = await militarPorNome(pagina, 'Chefia NSP');
  const wallace = await militarPorNome(pagina, 'Wallace');

  // Aviso só para o Ten Wallace.
  await irPara(pagina, 'avisos', perfil);
  await pagina.click('#pagina-avisos [data-acao="novo"]');
  await pagina.waitForSelector('#avForm');
  const tituloAviso = 'Entregar a planilha da CGC até sexta (' + perfil.nome + ')';
  await pagina.fill('#avTitulo', tituloAviso);
  await pagina.fill('#avMensagem', 'Ten Wallace, confira os números de setembro antes de enviar.');
  await pagina.locator('#avForm label', { has: pagina.locator('input[name="avPara"][value="escolhidos"]') }).click();
  await pagina.locator('#avForm label', { has: pagina.locator(`input[name="avDestinatario"][value="${wallace.id}"]`) }).click();
  if (perfil.nome === 'celular') { await semRolagemHorizontal(pagina, 'formulário de aviso'); }
  await capturar(pagina, '13-novo-aviso', perfil);
  await pagina.click('#avSalvar');
  await pagina.waitForFunction(() => !document.querySelector('#avForm'));
  await esperarTexto(pagina, '#pagina-avisos', tituloAviso);
  const aviso = await pagina.evaluate((t) => Api.listarAvisos({}).then((l) => l.find((a) => a.titulo === t)), tituloAviso);
  ok(aviso && aviso.para_todos === false && aviso.destinatarios.length === 1 && aviso.destinatarios[0] === wallace.id,
    'o aviso foi publicado só para o Ten Wallace');
  await capturar(pagina, '14-avisos-chefia', perfil);

  // Novo militar + Criar acesso.
  await irPara(pagina, 'equipe', perfil);
  await pagina.click('#pagina-equipe [data-eq-acao="novo-militar"]');
  await pagina.waitForSelector('#mlForm');
  const nomeGuerra = perfil.nome === 'celular' ? 'Rocha' : 'Moraes';
  estado.novoChefe = nomeGuerra;
  await pagina.fill('#mlPosto', 'Maj');
  await pagina.fill('#mlNomeGuerra', nomeGuerra);
  await pagina.fill('#mlNomeCompleto', 'Fulano de Tal ' + nomeGuerra);
  await pagina.fill('#mlEmail', nomeGuerra.toLowerCase() + '@demo.local');
  await pagina.click('#mlSalvar');
  await pagina.waitForSelector('#painelDetalhe [data-ml-acao="criar"]:not([disabled])');
  await pagina.click('#painelDetalhe [data-ml-acao="criar"]');
  await pagina.waitForFunction(() => {
    const el = document.getElementById('mlSenhaValor');
    return !!el && el.textContent.length >= 10;
  });
  const senha = await pagina.textContent('#mlSenhaValor');
  ok(/^[\x21-\x7e]{12,}$/.test(senha), 'a senha temporária aparece na tela');
  const senhaEmAtributo = await pagina.evaluate((s) => Array.from(document.querySelectorAll('*'))
    .some((el) => Array.from(el.attributes).some((a) => a.value.includes(s))), senha);
  ok(!senhaEmAtributo, 'a senha temporária não fica em nenhum atributo do DOM');
  if (perfil.nome === 'celular') { await semRolagemHorizontal(pagina, 'painel do militar'); }
  await capturar(pagina, '15-senha-temporaria', perfil);
  await pagina.click('#painelDetalhe [data-ml-acao="ocultar-senha"]');
  ok(!(await pagina.evaluate((s) => document.body.innerHTML.includes(s), senha)), '"Já anotei — ocultar" tira a senha da tela');
  await fecharPainel(pagina);
  const novo = await militarPorNome(pagina, nomeGuerra);
  ok(novo && !!novo.usuario_id && novo.deve_trocar_senha === true, 'o novo militar tem acesso e a troca de senha pendente');

  // Passagem de chefia: a chefia atual vira adjunta.
  await irPara(pagina, 'equipe', perfil, '?aba=chefia');
  await pagina.waitForSelector('input[name="pcDe"]');
  await pagina.locator('.assistente label', { has: pagina.locator(`input[name="pcDe"][value="${estado.chefia.id}"]`) }).click();
  await pagina.click('[data-pc-acao="avancar"]');
  await pagina.locator('.assistente label', { has: pagina.locator(`input[name="pcPara"][value="${novo.id}"]`) }).click();
  await pagina.click('[data-pc-acao="avancar"]');
  await pagina.waitForSelector('input[name="pcDestino"][value="adjunto"]');
  ok(await pagina.locator('input[name="pcDestino"][value="adjunto"]').isChecked(), 'o padrão é a chefia antiga passar a adjunta');
  await pagina.click('[data-pc-acao="avancar"]');
  await pagina.waitForSelector('[data-pc-acao="confirmar"]');
  if (perfil.nome === 'celular') { await semRolagemHorizontal(pagina, 'passagem de chefia'); }
  await capturar(pagina, '16-passagem-chefia', perfil);
  await pagina.click('[data-pc-acao="confirmar"]');
  await pagina.waitForFunction(() => document.body.classList.contains('papel-adjunto'));
  const depois = await pagina.evaluate(() => Api.listarMilitares());
  const antigo = depois.find((m) => m.id === estado.chefia.id);
  const novoDepois = depois.find((m) => m.id === novo.id);
  ok(antigo && antigo.papel === 'adjunto' && novoDepois && novoDepois.papel === 'chefia',
    'passagem de chefia: o novo militar é a chefia e a antiga virou adjunta');
  ok(await pagina.locator('#usuarioChip', { hasText: 'Adjunto' }).count() === 1, 'o cabeçalho mostra o novo papel na hora');
  await esperarPagina(pagina, 'equipe');
  ok(await pagina.locator('#pagina-equipe [data-eq-acao="novo-militar"]').count() === 0,
    'sem o papel de gestor, as ações de gestão somem da Equipe');
  await sair(pagina, perfil);
}

async function roteiroInstitucional(pagina, base, perfil, estado) {
  contexto = `${perfil.nome} · AQS (conta institucional)`;
  console.log(`== ${contexto}`);
  await pagina.waitForSelector('#formLogin');
  await pagina.fill('#acessoEmail', 'aqs@demo.local');
  await pagina.fill('#acessoSenha', 'senha-qualquer-1');
  await pagina.click('#acessoEntrar');
  await pagina.waitForSelector('#telaApp:not(.oculto)');
  await esperarPagina(pagina, 'inicio');
  ok(await pagina.locator('#usuarioChip', { hasText: 'AQS' }).count() === 1, 'entrou como a conta institucional da AQS');

  // Alertas de continuidade.
  await pagina.waitForSelector('.alerta-continuidade');
  const alertas = await pagina.locator('.alerta-continuidade').allInnerTexts();
  ok(alertas.length >= 1 && alertas.some((t) => /backup|cópia/i.test(t)), 'Início mostra os alertas de continuidade (backup antigo)');
  await capturar(pagina, '17-inicio-institucional', perfil);

  // Exclui a Ten Letícia; o histórico mantém o nome.
  await irPara(pagina, 'equipe', perfil);
  const leticia = estado.leticia;
  await pagina.locator(`#pagina-equipe button[data-militar="${leticia.id}"]:visible`).first().click();
  await pagina.waitForSelector('#mlConfirmaNome');
  await pagina.fill('#mlConfirmaNome', 'Letícia');
  await pagina.waitForSelector('#mlExcluir:not([disabled])');
  if (perfil.nome === 'celular') { await semRolagemHorizontal(pagina, 'painel de exclusão'); }
  await pagina.click('#mlExcluir');
  await pagina.waitForFunction(() => !document.querySelector('#painelDetalhe .painel'));
  ok(!(await militarPorNome(pagina, 'Letícia')), 'a Ten Letícia foi excluída');
  await pagina.evaluate((id) => { window.location.hash = '#/quadro?ocorrencia=' + id; }, estado.ocorrencia);
  await pagina.waitForSelector('#painelDetalhe .comentario__autor');
  const autores = await pagina.locator('#painelDetalhe .comentario__autor').allInnerTexts();
  ok(autores.some((t) => t.includes('Ten Letícia')), 'o comentário da militar excluída continua com o nome dela');
  const metaEvidencia = await pagina.locator('#painelDetalhe .evidencia__meta').allInnerTexts();
  ok(metaEvidencia.some((t) => t.includes('Ten Letícia')), 'a evidência enviada por ela continua com o nome');
  const oc = await pagina.evaluate((id) => Api.obterOcorrencia(id), estado.ocorrencia);
  ok(oc.concluida_por === null && oc.concluida_por_nome === 'Ten Letícia', 'a conclusão guarda o nome e solta o vínculo');
  await capturar(pagina, '18-historico-preservado', perfil);
  await fecharPainel(pagina);

  // Auditoria.
  await irPara(pagina, 'equipe', perfil, '?aba=auditoria');
  await esperarTexto(pagina, '#pagina-equipe', 'Letícia');
  await capturar(pagina, '19-auditoria', perfil);

  // Demais abas da Equipe (rolagem no celular e capturas para revisão).
  for (const aba of ABAS_EQUIPE.filter((a) => a !== 'auditoria')) {
    await irPara(pagina, 'equipe', perfil, '?aba=' + aba);
    await capturar(pagina, '20-equipe-' + aba, perfil);
  }

  // Tema escuro.
  await irPara(pagina, perfil.nome === 'celular' ? 'quadro' : 'inicio', perfil);
  await pagina.click('#botaoTema');
  ok(await pagina.evaluate(() => document.documentElement.getAttribute('data-tema')) === 'escuro', 'o botão de tema liga o tema escuro');
  await capturar(pagina, '21-' + (perfil.nome === 'celular' ? 'quadro' : 'inicio') + '-escuro', perfil);
  // Para a revisão visual: todas as rotas no escuro (só na pasta de páginas inteiras).
  for (const rota of ROTAS) {
    await irPara(pagina, rota, perfil);
    fs.mkdirSync(CAPTURAS_REVISAO, { recursive: true });
    await pagina.screenshot({ path: path.join(CAPTURAS_REVISAO, `${perfil.nome}-escuro-${rota}.png`), fullPage: true });
  }
  await pagina.click('#botaoTema');
  ok(await pagina.evaluate(() => document.documentElement.getAttribute('data-tema')) === 'claro', 'e volta ao claro');

  // Todas as rotas, de novo, como gestor (rolagem no celular).
  for (const rota of ROTAS) { await irPara(pagina, rota, perfil); }
  await sair(pagina, perfil);
}

async function roteiroConfiguracaoPendente(navegador, base) {
  const perfil = PERFIS_TELA[0];
  contexto = 'index.html sem configuração';
  console.log(`== ${contexto}`);
  const { ctx, pagina } = await novoContexto(navegador, base, perfil);
  try {
    await pagina.goto(base + '/index.html');
    await pagina.waitForSelector('#telaAcesso :text("Configuração pendente")');
    const texto = await pagina.innerText('#telaAcesso');
    ok(/SUPABASE_URL/.test(texto) && /SUPABASE_ANON_KEY/.test(texto) && /IMPLANTACAO\.md/.test(texto),
      'a tela lista o que falta em config.js e aponta o manual de implantação');
    ok(await pagina.locator('#telaAcesso a[href="demo.html"]').count() === 1, 'oferece o modo demonstração');
    ok(await pagina.locator('#telaApp').isHidden(), 'o aplicativo não aparece sem configuração');
    await capturar(pagina, '22-configuracao-pendente', perfil);
  } finally {
    await ctx.close();
  }
}

// ------------------------------------------------------------------ main

let servidor = null;
let navegador = null;
let codigo = 0;
try {
  fs.mkdirSync(CAPTURAS, { recursive: true });
  servidor = await subirServidor();
  navegador = await chromium.launch();
  for (const perfil of PERFIS_TELA) {
    const { ctx, pagina } = await novoContexto(navegador, servidor.base, perfil);
    const estado = {};
    try {
      await roteiroAdjunta(pagina, servidor.base, perfil, estado);
      await roteiroChefia(pagina, servidor.base, perfil, estado);
      await roteiroInstitucional(pagina, servidor.base, perfil, estado);
      const violacoes = await pagina.evaluate(() => window.__violacoesCsp || []);
      ok(violacoes.length === 0, 'nenhuma violação de CSP registrada na página: ' + violacoes.join('; '));
    } catch (erro) {
      registrarFalha('o roteiro parou: ' + (erro && erro.message ? erro.message.split('\n')[0] : erro));
      try { await pagina.screenshot({ path: path.join(CAPTURAS, `${perfil.nome}-FALHA.png`), fullPage: true }); } catch { /* sem captura */ }
    } finally {
      await ctx.close();
    }
  }
  await roteiroConfiguracaoPendente(navegador, servidor.base);

  if (COPIAR_PARA_DOCS) {
    contexto = 'docs/capturas';
    const destino = path.join(RAIZ, 'docs', 'capturas');
    fs.mkdirSync(destino, { recursive: true });
    for (const [origem, nome] of [['computador-01-inicio', 'inicio-computador'], ['computador-02-quadro', 'quadro-computador'],
      ['celular-01-inicio', 'inicio-celular'], ['celular-02-quadro', 'quadro-celular']]) {
      const arquivo = path.join(CAPTURAS, origem + '.png');
      if (!ok(fs.existsSync(arquivo), 'captura ' + origem + ' existe')) { continue; }
      const tamanho = fs.statSync(arquivo).size;
      if (ok(tamanho < LIMITE_CAPTURA_DOCS, `${origem}.png tem menos de 300 KB (${Math.round(tamanho / 1024)} KB)`)) {
        fs.copyFileSync(arquivo, path.join(destino, nome + '.png'));
      }
    }
  }
} catch (erro) {
  contexto = 'infraestrutura';
  registrarFalha(erro && erro.message ? erro.message : String(erro));
} finally {
  if (navegador) { await navegador.close().catch(() => {}); }
  if (servidor) { servidor.processo.kill(); }
}

console.log('');
console.log(`Capturas: ${CAPTURAS}`);
if (falhas.length) {
  console.log(`✗ e2e-demo.mjs: ${falhas.length} falha(s) em ${verificacoes} verificações:`);
  falhas.forEach((f) => console.log('  - ' + f));
  codigo = 1;
} else {
  console.log(`✓ e2e-demo.mjs: ${verificacoes} verificações aprovadas, 0 com falha (computador 1280×800 e celular 390×844)`);
}
process.exit(codigo);
