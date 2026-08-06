/* =========================================================================
   HABE SINAN — acesso rápido: QR Code, cartaz e atalho de área de trabalho
   ========================================================================= */

var Paginas = Paginas || {};

Paginas.acesso = (function () {
  'use strict';

  function enderecoAtual() {
    var config = Armazenamento.obterConfig();
    if (config.enderecoPublico) { return config.enderecoPublico; }
    return window.location.href.split('#')[0];
  }

  function gerar(elemento) {
    var endereco = U.$('#campoEndereco', elemento).value.trim();
    var canvas = U.$('#telaQr', elemento);
    var aviso = U.$('#avisoQr', elemento);

    if (!endereco) {
      aviso.innerHTML = '<span style="color:var(--texto-suave)">Informe o endereço do sistema.</span>';
      return;
    }

    try {
      var qr = QRCodeHABE.desenhar(canvas, endereco, { escala: 8, margem: 4 });
      aviso.innerHTML = '<span class="selo selo--sucesso">✓ QR Code gerado — versão ' +
                        qr.versao + ', correção de erro M</span>';
      U.$('#enderecoCartaz', elemento).textContent = endereco;
    } catch (erro) {
      aviso.innerHTML = '<span class="selo selo--urgente">' + U.esc(erro.message) + '</span>';
    }
  }

  function baixarPng(elemento) {
    var canvas = U.$('#telaQr', elemento);
    canvas.toBlob(function (blob) {
      U.baixarConteudo('habe-sinan-qrcode.png', blob, 'image/png');
      U.torrada('Imagem do QR Code baixada.', 'sucesso');
    }, 'image/png');
  }

  /* Atalho de internet do Windows (.url) — arraste para a área de trabalho. */
  function baixarAtalho(elemento) {
    var endereco = U.$('#campoEndereco', elemento).value.trim();
    if (!endereco) { U.torrada('Informe o endereço antes de gerar o atalho.', 'erro'); return; }
    var conteudo = '[InternetShortcut]\r\n' +
                   'URL=' + endereco + '\r\n' +
                   'IconIndex=0\r\n';
    U.baixarConteudo('HABE SINAN.url', conteudo, 'application/internet-shortcut');
    U.torrada('Atalho baixado. Mova o arquivo para a Área de Trabalho.', 'sucesso', 7000);
  }

  function render(elemento) {
    var config = Armazenamento.obterConfig();

    elemento.innerHTML = '' +
      '<div class="pagina__cabecalho">' +
        '<h1 id="t-acesso">Acesso rápido</h1>' +
        '<p>Gere o QR Code para os consultórios e o atalho para a área de trabalho ' +
           'dos computadores de atendimento.</p>' +
      '</div>' +

      '<div class="cartao nao-imprimir">' +
        '<div class="campo">' +
          '<label for="campoEndereco">Endereço do sistema' +
            '<span class="campo__dica">É o link que o QR Code e o atalho vão abrir. ' +
            'Preenchido automaticamente com o endereço em uso.</span></label>' +
          '<input type="text" id="campoEndereco" value="' + U.esc(enderecoAtual()) + '">' +
        '</div>' +
        '<div style="display:flex;gap:.5rem;flex-wrap:wrap">' +
          '<button class="botao" id="botaoGerarQr" type="button">↻ Gerar QR Code</button>' +
          '<button class="botao botao--secundario" id="botaoBaixarPng" type="button">' +
            '⬇ Baixar QR Code (PNG)</button>' +
          '<button class="botao botao--secundario" id="botaoAtalho" type="button">' +
            '🖥 Baixar atalho para a área de trabalho</button>' +
          '<button class="botao botao--secundario" id="botaoImprimirCartaz" type="button">' +
            '🖨 Imprimir cartaz</button>' +
        '</div>' +
        '<p style="margin:.8rem 0 0" id="avisoQr"></p>' +
      '</div>' +

      /* ---- cartaz para impressão ---- */
      '<div class="cartao" id="cartaz" style="text-align:center;padding:2rem 1.5rem">' +
        '<img class="brasao--cartaz" src="assets/img/logo-habe.svg" alt="">' +
        '<h2 style="font-size:1.9rem;letter-spacing:.06em;margin:.6rem 0 .2rem">HABE SINAN</h2>' +
        '<p style="font-size:1.02rem;margin-bottom:.2rem"><strong>Fichas de notificação compulsória</strong></p>' +
        '<p style="color:var(--texto-suave);margin-bottom:1.4rem">' +
          U.esc(config.unidade) + ' · ' + U.esc(config.setor) + '</p>' +

        '<div class="qr-caixa"><canvas id="telaQr" width="300" height="300"></canvas></div>' +

        '<p style="margin:1rem 0 .3rem;font-size:1.05rem"><strong>Aponte a câmera do celular</strong></p>' +
        '<p style="font-family:Consolas,monospace;font-size:.82rem;word-break:break-all;' +
          'color:var(--texto-suave)" id="enderecoCartaz"></p>' +

        '<div style="max-width:640px;margin:1.4rem auto 0;text-align:left">' +
          '<div class="aviso aviso--urgente"><span class="aviso__icone">⏱</span><div>' +
            '<strong>Notificação IMEDIATA (24 horas)</strong>' +
            'Comunique o Núcleo de Epidemiologia por telefone assim que houver suspeita, ' +
            'sem aguardar confirmação laboratorial. No sistema, esses agravos aparecem em vermelho.' +
          '</div></div>' +
          '<div class="aviso"><span class="aviso__icone">📅</span><div>' +
            '<strong>Notificação semanal (7 dias)</strong>' +
            'Preencha a ficha e devolva ao Núcleo de Epidemiologia dentro da semana ' +
            'epidemiológica do atendimento.' +
          '</div></div>' +
        '</div>' +
      '</div>' +

      /* ---- instruções ---- */
      '<div class="grade grade--2 nao-imprimir">' +
        '<div class="cartao">' +
          '<h2 style="font-size:1.05rem">Atalho nos computadores de atendimento</h2>' +
          '<ol style="padding-left:1.2rem;font-size:.92rem;line-height:1.7">' +
            '<li>Clique em <strong>“Baixar atalho para a área de trabalho”</strong>.</li>' +
            '<li>Mova o arquivo <code>HABE SINAN.url</code> da pasta de downloads para a ' +
                '<strong>Área de Trabalho</strong>.</li>' +
            '<li>Para deixá-lo em todos os perfis do computador, cole o arquivo em ' +
                '<code>C:\\Users\\Public\\Desktop</code> (requer perfil administrador).</li>' +
            '<li>Opcional: clique com o botão direito no atalho → <strong>Propriedades</strong> → ' +
                '<strong>Alterar ícone</strong> e escolha o emblema do hospital.</li>' +
          '</ol>' +
        '</div>' +
        '<div class="cartao">' +
          '<h2 style="font-size:1.05rem">Cartaz com QR Code</h2>' +
          '<ol style="padding-left:1.2rem;font-size:.92rem;line-height:1.7">' +
            '<li>Clique em <strong>“Imprimir cartaz”</strong> e escolha papel A4.</li>' +
            '<li>Afixe nos consultórios, no pronto atendimento, nas UI1 e UI2 e na UTI.</li>' +
            '<li>Teste a leitura a cerca de 40 cm de distância antes de reproduzir em série.</li>' +
            '<li>Evite plastificar com material muito reflexivo — atrapalha a leitura.</li>' +
          '</ol>' +
        '</div>' +
      '</div>';

    U.$('#botaoGerarQr', elemento).addEventListener('click', function () { gerar(elemento); });
    U.$('#botaoBaixarPng', elemento).addEventListener('click', function () { baixarPng(elemento); });
    U.$('#botaoAtalho', elemento).addEventListener('click', function () { baixarAtalho(elemento); });
    U.$('#botaoImprimirCartaz', elemento).addEventListener('click', function () { window.print(); });
    U.$('#campoEndereco', elemento).addEventListener('change', function () { gerar(elemento); });

    gerar(elemento);
  }

  return { render: render };
})();
