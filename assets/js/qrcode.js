/* =========================================================================
   HABE SINAN — gerador de QR Code
   -------------------------------------------------------------------------
   Implementação própria e enxuta do padrão ISO/IEC 18004, suficiente para
   codificar endereços de internet. Não depende de nenhuma biblioteca
   externa, portanto funciona com o computador desconectado.

   Escopo: modo byte (UTF-8), nível de correção de erro M (~15%),
   versões 1 a 6 (até 106 bytes) — folgado para qualquer URL de intranet
   ou do GitHub Pages.

   Uso:  QRCodeHABE.desenhar(canvas, "https://exemplo.org", { escala: 6 });
   ========================================================================= */

var QRCodeHABE = (function () {
  'use strict';

  /* ---------- Campo de Galois GF(256), polinômio primitivo 0x11D ---------- */
  var EXP = new Array(512);
  var LOG = new Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) { x ^= 0x11D; }
    }
    for (var j = 255; j < 512; j++) { EXP[j] = EXP[j - 255]; }
  })();

  function multiplicar(a, b) {
    if (a === 0 || b === 0) { return 0; }
    return EXP[LOG[a] + LOG[b]];
  }

  /* Polinômio gerador de grau `grau`, coeficientes em ordem decrescente. */
  function polinomioGerador(grau) {
    var p = [1];
    for (var i = 0; i < grau; i++) {
      var novo = [];
      for (var k = 0; k <= p.length; k++) { novo[k] = 0; }
      for (var j = 0; j < p.length; j++) {
        novo[j] ^= p[j];
        novo[j + 1] ^= multiplicar(p[j], EXP[i]);
      }
      p = novo;
    }
    return p;
  }

  /* Códigos de correção de erro (resto da divisão polinomial). */
  function correcaoErro(dados, quantidade) {
    var gerador = polinomioGerador(quantidade);
    var resto = dados.slice();
    for (var z = 0; z < quantidade; z++) { resto.push(0); }
    for (var i = 0; i < dados.length; i++) {
      var coeficiente = resto[i];
      if (coeficiente === 0) { continue; }
      for (var j = 0; j < gerador.length; j++) {
        resto[i + j] ^= multiplicar(gerador[j], coeficiente);
      }
    }
    return resto.slice(dados.length);
  }

  /* ---------- Tabelas do padrão (nível M, versões 1 a 6) ----------
     Cada entrada: [ totalDeCodewords, blocos: [ [total, dados], ... ] ] */
  var VERSOES = {
    1: { blocos: [[26, 16]], capacidade: 14, alinhamento: null },
    2: { blocos: [[44, 28]], capacidade: 26, alinhamento: 18 },
    3: { blocos: [[70, 44]], capacidade: 42, alinhamento: 22 },
    4: { blocos: [[50, 32], [50, 32]], capacidade: 62, alinhamento: 26 },
    5: { blocos: [[67, 43], [67, 43]], capacidade: 84, alinhamento: 30 },
    6: { blocos: [[43, 27], [43, 27], [43, 27], [43, 27]], capacidade: 106, alinhamento: 34 }
  };

  var G15 = 0x537;        // polinômio gerador BCH(15,5)
  var G15_MASCARA = 0x5412;
  var NIVEL_M = 0;        // indicador de nível de correção M

  function grauBCH(valor) {
    var grau = 0;
    while (valor !== 0) { grau++; valor >>>= 1; }
    return grau;
  }

  function infoFormato(mascara) {
    var dados = (NIVEL_M << 3) | mascara;
    var d = dados << 10;
    while (grauBCH(d) - grauBCH(G15) >= 0) {
      d ^= (G15 << (grauBCH(d) - grauBCH(G15)));
    }
    return ((dados << 10) | d) ^ G15_MASCARA;
  }

  /* ---------- Texto para bytes UTF-8 ---------- */
  function paraUtf8(texto) {
    var bytes = [];
    for (var i = 0; i < texto.length; i++) {
      var c = texto.charCodeAt(i);
      if (c < 0x80) {
        bytes.push(c);
      } else if (c < 0x800) {
        bytes.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
      } else if (c < 0xD800 || c >= 0xE000) {
        bytes.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
      } else {
        /* Par substituto (emoji e afins). */
        i++;
        var cp = 0x10000 + (((c & 0x3FF) << 10) | (texto.charCodeAt(i) & 0x3FF));
        bytes.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F),
                   0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
      }
    }
    return bytes;
  }

  /* ---------- Máscaras ---------- */
  function aplicarMascara(padrao, i, j) {
    switch (padrao) {
      case 0: return (i + j) % 2 === 0;
      case 1: return i % 2 === 0;
      case 2: return j % 3 === 0;
      case 3: return (i + j) % 3 === 0;
      case 4: return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
      case 5: return ((i * j) % 2) + ((i * j) % 3) === 0;
      case 6: return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0;
      case 7: return (((i + j) % 2) + ((i * j) % 3)) % 2 === 0;
      default: return false;
    }
  }

  /* ---------- Penalidade (escolha da melhor máscara) ---------- */
  function penalidade(modulos, tamanho) {
    var total = 0;
    var i, j, r, c;

    /* Regra 1 — sequências de 5 ou mais módulos iguais. */
    for (i = 0; i < tamanho; i++) {
      for (j = 0; j < tamanho; j++) {
        var iguais = 0;
        var atual = modulos[i][j];
        for (r = -1; r <= 1; r++) {
          if (i + r < 0 || i + r >= tamanho) { continue; }
          for (c = -1; c <= 1; c++) {
            if (j + c < 0 || j + c >= tamanho) { continue; }
            if (r === 0 && c === 0) { continue; }
            if (atual === modulos[i + r][j + c]) { iguais++; }
          }
        }
        if (iguais > 5) { total += (3 + iguais - 5); }
      }
    }

    /* Regra 2 — blocos 2x2 de mesma cor. */
    for (i = 0; i < tamanho - 1; i++) {
      for (j = 0; j < tamanho - 1; j++) {
        var contador = 0;
        if (modulos[i][j]) { contador++; }
        if (modulos[i + 1][j]) { contador++; }
        if (modulos[i][j + 1]) { contador++; }
        if (modulos[i + 1][j + 1]) { contador++; }
        if (contador === 0 || contador === 4) { total += 3; }
      }
    }

    /* Regra 3 — padrão 1:1:3:1:1 semelhante ao localizador. */
    for (i = 0; i < tamanho; i++) {
      for (j = 0; j < tamanho - 6; j++) {
        if (modulos[i][j] && !modulos[i][j + 1] && modulos[i][j + 2] &&
            modulos[i][j + 3] && modulos[i][j + 4] && !modulos[i][j + 5] &&
            modulos[i][j + 6]) { total += 40; }
      }
    }
    for (j = 0; j < tamanho; j++) {
      for (i = 0; i < tamanho - 6; i++) {
        if (modulos[i][j] && !modulos[i + 1][j] && modulos[i + 2][j] &&
            modulos[i + 3][j] && modulos[i + 4][j] && !modulos[i + 5][j] &&
            modulos[i + 6][j]) { total += 40; }
      }
    }

    /* Regra 4 — desequilíbrio entre módulos claros e escuros. */
    var escuros = 0;
    for (i = 0; i < tamanho; i++) {
      for (j = 0; j < tamanho; j++) { if (modulos[i][j]) { escuros++; } }
    }
    var proporcao = Math.abs(100 * escuros / (tamanho * tamanho) - 50) / 5;
    total += Math.floor(proporcao) * 10;

    return total;
  }

  /* ---------- Montagem da matriz ---------- */
  function montarMatriz(versao, dados, mascara) {
    var tamanho = versao * 4 + 17;
    var modulos = [];
    var i, j, r, c;

    for (i = 0; i < tamanho; i++) {
      modulos[i] = [];
      for (j = 0; j < tamanho; j++) { modulos[i][j] = null; }
    }

    /* Localizadores (finder patterns) e separadores. */
    function localizador(linha, coluna) {
      for (r = -1; r <= 7; r++) {
        if (linha + r < 0 || linha + r >= tamanho) { continue; }
        for (c = -1; c <= 7; c++) {
          if (coluna + c < 0 || coluna + c >= tamanho) { continue; }
          modulos[linha + r][coluna + c] =
            (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
            (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
            (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        }
      }
    }
    localizador(0, 0);
    localizador(tamanho - 7, 0);
    localizador(0, tamanho - 7);

    /* Padrão de alinhamento (versões 2 a 6: um único, no canto inferior direito). */
    var pa = VERSOES[versao].alinhamento;
    if (pa !== null) {
      for (r = -2; r <= 2; r++) {
        for (c = -2; c <= 2; c++) {
          modulos[pa + r][pa + c] =
            (r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0));
        }
      }
    }

    /* Padrões de sincronismo (timing). */
    for (r = 8; r < tamanho - 8; r++) {
      if (modulos[r][6] === null) { modulos[r][6] = (r % 2 === 0); }
    }
    for (c = 8; c < tamanho - 8; c++) {
      if (modulos[6][c] === null) { modulos[6][c] = (c % 2 === 0); }
    }

    /* Informação de formato. */
    var bits = infoFormato(mascara);
    for (i = 0; i < 15; i++) {
      var aceso = ((bits >> i) & 1) === 1;
      if (i < 6) { modulos[i][8] = aceso; }
      else if (i < 8) { modulos[i + 1][8] = aceso; }
      else { modulos[tamanho - 15 + i][8] = aceso; }

      if (i < 8) { modulos[8][tamanho - i - 1] = aceso; }
      else if (i < 9) { modulos[8][15 - i - 1 + 1] = aceso; }
      else { modulos[8][15 - i - 1] = aceso; }
    }
    modulos[tamanho - 8][8] = true;   /* módulo escuro fixo */

    /* Preenchimento em zigue-zague, da direita para a esquerda. */
    var incremento = -1;
    var linha = tamanho - 1;
    var indiceBit = 7;
    var indiceByte = 0;

    for (var coluna = tamanho - 1; coluna > 0; coluna -= 2) {
      if (coluna === 6) { coluna--; }
      while (true) {
        for (var k = 0; k < 2; k++) {
          if (modulos[linha][coluna - k] !== null) { continue; }
          var escuro = false;
          if (indiceByte < dados.length) {
            escuro = ((dados[indiceByte] >>> indiceBit) & 1) === 1;
          }
          if (aplicarMascara(mascara, linha, coluna - k)) { escuro = !escuro; }
          modulos[linha][coluna - k] = escuro;
          indiceBit--;
          if (indiceBit === -1) { indiceByte++; indiceBit = 7; }
        }
        linha += incremento;
        if (linha < 0 || linha >= tamanho) {
          linha -= incremento;
          incremento = -incremento;
          break;
        }
      }
    }

    return modulos;
  }

  /* ---------- Codificação completa ---------- */
  function codificar(texto) {
    var bytes = paraUtf8(texto);

    var versao = null;
    for (var v = 1; v <= 6; v++) {
      if (bytes.length <= VERSOES[v].capacidade) { versao = v; break; }
    }
    if (versao === null) {
      throw new Error('Texto longo demais para o QR Code (máximo de ' +
                      VERSOES[6].capacidade + ' bytes). Use um endereço mais curto.');
    }

    var especificacao = VERSOES[versao];
    var totalDados = 0;
    var b;
    for (b = 0; b < especificacao.blocos.length; b++) {
      totalDados += especificacao.blocos[b][1];
    }

    /* Fluxo de bits: modo byte (0100) + contagem (8 bits) + dados. */
    var fluxo = [];
    function escreverBits(valor, quantidade) {
      for (var i = quantidade - 1; i >= 0; i--) { fluxo.push((valor >>> i) & 1); }
    }
    escreverBits(4, 4);
    escreverBits(bytes.length, 8);
    for (var i = 0; i < bytes.length; i++) { escreverBits(bytes[i], 8); }

    /* Terminador e alinhamento em bytes. */
    var limite = totalDados * 8;
    for (var t = 0; t < 4 && fluxo.length < limite; t++) { fluxo.push(0); }
    while (fluxo.length % 8 !== 0) { fluxo.push(0); }

    var codewords = [];
    for (var p = 0; p < fluxo.length; p += 8) {
      var byte = 0;
      for (var q = 0; q < 8; q++) { byte = (byte << 1) | fluxo[p + q]; }
      codewords.push(byte);
    }
    /* Bytes de preenchimento alternados, conforme o padrão. */
    var preenchimento = [0xEC, 0x11];
    var indice = 0;
    while (codewords.length < totalDados) {
      codewords.push(preenchimento[indice++ % 2]);
    }

    /* Divisão em blocos, cálculo da correção de erro e intercalação. */
    var blocosDados = [];
    var blocosCorrecao = [];
    var deslocamento = 0;
    var maiorDados = 0;
    var maiorCorrecao = 0;

    for (b = 0; b < especificacao.blocos.length; b++) {
      var totalBloco = especificacao.blocos[b][0];
      var dadosBloco = especificacao.blocos[b][1];
      var qtdCorrecao = totalBloco - dadosBloco;

      blocosDados[b] = codewords.slice(deslocamento, deslocamento + dadosBloco);
      deslocamento += dadosBloco;
      blocosCorrecao[b] = correcaoErro(blocosDados[b], qtdCorrecao);

      maiorDados = Math.max(maiorDados, dadosBloco);
      maiorCorrecao = Math.max(maiorCorrecao, qtdCorrecao);
    }

    var intercalado = [];
    for (i = 0; i < maiorDados; i++) {
      for (b = 0; b < blocosDados.length; b++) {
        if (i < blocosDados[b].length) { intercalado.push(blocosDados[b][i]); }
      }
    }
    for (i = 0; i < maiorCorrecao; i++) {
      for (b = 0; b < blocosCorrecao.length; b++) {
        if (i < blocosCorrecao[b].length) { intercalado.push(blocosCorrecao[b][i]); }
      }
    }

    /* Escolha da máscara com menor penalidade. */
    var tamanho = versao * 4 + 17;
    var melhor = null;
    var menorPenalidade = Infinity;
    for (var m = 0; m < 8; m++) {
      var candidata = montarMatriz(versao, intercalado, m);
      var pontos = penalidade(candidata, tamanho);
      if (pontos < menorPenalidade) { menorPenalidade = pontos; melhor = candidata; }
    }

    return { modulos: melhor, tamanho: tamanho, versao: versao };
  }

  /* ---------- Desenho em <canvas> ---------- */
  function desenhar(canvas, texto, opcoes) {
    opcoes = opcoes || {};
    var escala = opcoes.escala || 6;
    var margem = opcoes.margem === undefined ? 4 : opcoes.margem;   /* zona silenciosa */
    var corEscura = opcoes.corEscura || '#0b2f5c';
    var corClara = opcoes.corClara || '#ffffff';

    var qr = codificar(texto);
    var lado = (qr.tamanho + margem * 2) * escala;

    canvas.width = lado;
    canvas.height = lado;

    var ctx = canvas.getContext('2d');
    ctx.fillStyle = corClara;
    ctx.fillRect(0, 0, lado, lado);
    ctx.fillStyle = corEscura;

    for (var i = 0; i < qr.tamanho; i++) {
      for (var j = 0; j < qr.tamanho; j++) {
        if (qr.modulos[i][j]) {
          ctx.fillRect((j + margem) * escala, (i + margem) * escala, escala, escala);
        }
      }
    }
    return qr;
  }

  return { codificar: codificar, desenhar: desenhar };
})();
