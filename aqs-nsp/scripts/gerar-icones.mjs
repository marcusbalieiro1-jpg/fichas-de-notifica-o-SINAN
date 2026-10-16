#!/usr/bin/env node
/* =========================================================================
   HABE – AQS e NSP — gera os ícones do aplicativo a partir do brasão
   Uso (na pasta aqs-nsp):   node scripts/gerar-icones.mjs

   Desenha o brasão (assets/img/logo-habe.svg) centralizado sobre o fundo
   azul-marinho (#0b2f5c) num Chromium sem janela (Playwright) e salva:
     assets/img/icone-192.png        192×192  ícone do app (Android/desktop)
     assets/img/icone-512.png        512×512  "maskable": o brasão fica dentro
                                              do círculo seguro (80% central),
                                              então nenhum recorte o corta
     assets/img/apple-touch-icon.png 180×180  iPhone/iPad (o iOS arredonda)
     assets/img/favicon-32.png        32×32   aba do navegador
   Rode de novo sempre que o brasão (logo-habe.svg) mudar.

   Precisa do Playwright com o Chromium. Procura, nesta ordem: a pasta da
   variável PLAYWRIGHT_DIR, /opt/node-tools/node_modules/playwright e
   node_modules/playwright do projeto (npm i -D playwright &&
   npx playwright install chromium).
   ========================================================================= */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pastaImg = path.join(raiz, 'assets', 'img');
const arquivoBrasao = path.join(pastaImg, 'logo-habe.svg');

const AZUL_MARINHO = '#0b2f5c';
const AZUL_MEDIO = '#164b8a';
const DOURADO = '#d99a1f';

/* alturaBrasao: fração do lado ocupada pela altura do brasão (proporção 5:6).
   No maskable, 58% de altura deixa a meia-diagonal do retângulo do brasão
   (≈ 0,38 do lado) dentro do raio seguro de 0,40 do lado. */
const ICONES = [
  { arquivo: 'icone-192.png', lado: 192, alturaBrasao: 0.70, cantos: 0.22, aro: true, sombra: true },
  { arquivo: 'icone-512.png', lado: 512, alturaBrasao: 0.58, cantos: 0, aro: false, sombra: true },
  { arquivo: 'apple-touch-icon.png', lado: 180, alturaBrasao: 0.72, cantos: 0, aro: false, sombra: true },
  { arquivo: 'favicon-32.png', lado: 32, alturaBrasao: 0.90, cantos: 0.2, aro: false, sombra: false }
];

function carregarPlaywright() {
  const exigir = createRequire(import.meta.url);
  const candidatos = [
    process.env.PLAYWRIGHT_DIR,
    '/opt/node-tools/node_modules/playwright',
    path.join(raiz, 'node_modules', 'playwright')
  ].filter(Boolean);
  for (const pasta of candidatos) {
    if (fs.existsSync(pasta)) { return exigir(pasta); }
  }
  try {
    return exigir('playwright');
  } catch {
    throw new Error('Playwright não encontrado. Instale com "npm i -D playwright" e ' +
      '"npx playwright install chromium", ou indique a pasta em PLAYWRIGHT_DIR.');
  }
}

function paginaDoIcone(icone, brasaoBase64) {
  const { lado } = icone;
  const raio = Math.round(lado * icone.cantos);
  const altura = Math.round(lado * icone.alturaBrasao);
  const aro = icone.aro
    ? `box-shadow: inset 0 0 0 ${Math.max(2, Math.round(lado * 0.022))}px ${DOURADO};`
    : '';
  const sombra = icone.sombra
    ? `filter: drop-shadow(0 ${(lado * 0.012).toFixed(1)}px ${(lado * 0.025).toFixed(1)}px rgba(0,0,0,.35));`
    : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; width: ${lado}px; height: ${lado}px; background: transparent; overflow: hidden; }
    .fundo {
      width: ${lado}px; height: ${lado}px; box-sizing: border-box; border-radius: ${raio}px;
      display: flex; align-items: center; justify-content: center;
      background: radial-gradient(circle at 50% 32%, ${AZUL_MEDIO} 0%, ${AZUL_MARINHO} 68%);
      ${aro}
    }
    img { display: block; height: ${altura}px; width: auto; ${sombra} }
  </style></head><body><div class="fundo"><img alt="" src="data:image/svg+xml;base64,${brasaoBase64}"></div></body></html>`;
}

/* Largura e altura gravadas no cabeçalho IHDR do PNG. */
function dimensoesPng(arquivo) {
  const b = fs.readFileSync(arquivo);
  const assinatura = '89504e470d0a1a0a';
  if (b.subarray(0, 8).toString('hex') !== assinatura) { throw new Error(arquivo + ' não é PNG'); }
  return { largura: b.readUInt32BE(16), altura: b.readUInt32BE(20), bytes: b.length };
}

async function principal() {
  if (!fs.existsSync(arquivoBrasao)) { throw new Error('Brasão não encontrado: ' + arquivoBrasao); }
  const brasaoBase64 = fs.readFileSync(arquivoBrasao).toString('base64');
  const { chromium } = carregarPlaywright();
  const navegador = await chromium.launch();
  try {
    for (const icone of ICONES) {
      const pagina = await navegador.newPage({
        viewport: { width: icone.lado, height: icone.lado },
        deviceScaleFactor: 1
      });
      await pagina.setContent(paginaDoIcone(icone, brasaoBase64));
      await pagina.waitForFunction(() => {
        const img = document.images[0];
        return img && img.complete && img.naturalWidth > 0;
      });
      const destino = path.join(pastaImg, icone.arquivo);
      await pagina.screenshot({
        path: destino,
        omitBackground: true,
        clip: { x: 0, y: 0, width: icone.lado, height: icone.lado }
      });
      await pagina.close();
      const d = dimensoesPng(destino);
      if (d.largura !== icone.lado || d.altura !== icone.lado) {
        throw new Error(`${icone.arquivo}: saiu ${d.largura}×${d.altura}, esperado ${icone.lado}×${icone.lado}`);
      }
      console.log(`✓ assets/img/${icone.arquivo}  ${d.largura}×${d.altura}  (${(d.bytes / 1024).toFixed(1)} KB)`);
    }
  } finally {
    await navegador.close();
  }
}

principal().catch((erro) => {
  console.error('Falha ao gerar os ícones:', erro.message || erro);
  process.exit(1);
});
