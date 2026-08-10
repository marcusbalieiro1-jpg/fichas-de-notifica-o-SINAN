/* =========================================================================
   HABE SINAN — configurações, backup e informações do catálogo
   ========================================================================= */

var Paginas = Paginas || {};

Paginas.config = (function () {
  'use strict';

  function render(elemento) {
    var config = Armazenamento.obterConfig();
    var revisao = HABE_CATALOGO.revisao;

    elemento.innerHTML = '' +
      '<div class="pagina__cabecalho">' +
        '<h1 id="t-config">Configurações</h1>' +
        '<p>Ajustes do sistema, cópia de segurança e situação do catálogo de fichas.</p>' +
      '</div>' +

      /* ---- identificação ---- */
      '<div class="cartao">' +
        '<h2 style="font-size:1.05rem">Identificação da unidade</h2>' +
        '<p style="font-size:.88rem;color:var(--texto-suave)">' +
          'Estes dados ficam em <code>assets/js/dados-fichas.js</code>, no bloco ' +
          '<code>unidade</code>, e não nas configurações do navegador — assim as duas ' +
          'páginas mostram o mesmo contato em qualquer computador, sem configurar máquina ' +
          'por máquina.</p>' +
        '<dl class="dados-lista" style="margin-bottom:1rem">' +
          '<div><dt>Unidade</dt><dd>' + U.esc(U.unidade().nome || '—') + '</dd></div>' +
          '<div><dt>Setor</dt><dd>' + U.esc(U.unidade().setor || '—') + '</dd></div>' +
          '<div><dt>Ramal</dt><dd>' + U.esc(U.unidade().ramal || '') +
            (U.unidade().ramal ? '' : '<span style="color:var(--urgente)">não cadastrado</span>') +
          '</dd></div>' +
          '<div><dt>Plantão</dt><dd>' + U.esc(U.unidade().plantao || '') +
            (U.unidade().plantao ? '' : '<span style="color:var(--urgente)">não cadastrado</span>') +
          '</dd></div>' +
        '</dl>' +
        (U.comoChamarNucleo() ? '' :
          '<div class="aviso aviso--atencao"><span class="aviso__icone">☎</span><div>' +
          '<strong>Contato do Núcleo ainda não cadastrado</strong>' +
          'Sem ramal nem telefone de plantão, a página dos médicos manda ligar para o Núcleo ' +
          'sem dizer para onde. Preencha antes de distribuir os cartazes.</div></div>') +
        '<div class="campo"><label for="cfgEndereco">Endereço público da página de consulta' +
          '<span class="campo__dica">Usado no QR Code e no atalho. Deixe em branco para ' +
          'deduzir do endereço em uso.</span></label>' +
          '<input type="text" id="cfgEndereco" value="' + U.esc(config.enderecoPublico) + '" ' +
            'placeholder="http://intranet.habe/sinan/index.html"></div>' +
      '</div>' +

      /* ---- armazenamento ---- */
      '<div class="cartao">' +
        '<h2 style="font-size:1.05rem">Onde os dados ficam gravados</h2>' +
        '<div class="opcoes" style="margin-bottom:1rem">' +
          '<label class="opcao"><input type="radio" name="modo" value="local"' +
            (config.modo === 'local' ? ' checked' : '') + '>' +
            '<span class="opcao__texto"><strong>Somente neste computador</strong>' +
            '<small>Funciona sem internet e sem servidor. Os dados NÃO são vistos pelos ' +
            'outros computadores.</small></span></label>' +
          '<label class="opcao"><input type="radio" name="modo" value="compartilhado"' +
            (config.modo === 'compartilhado' ? ' checked' : '') + '>' +
            '<span class="opcao__texto"><strong>Compartilhado (planilha Google + Drive)</strong>' +
            '<small>Todos os computadores enxergam as mesmas solicitações. Exige a publicação ' +
            'do Web App descrito em backend/apps-script.</small></span></label>' +
        '</div>' +
        '<div id="camposRemotos"' + (config.modo === 'compartilhado' ? '' : ' class="oculto"') + '>' +
          '<div class="campo"><label for="cfgEndpoint">Endereço do Web App' +
            '<span class="campo__dica">Termina em <code>/exec</code>.</span></label>' +
            '<input type="text" id="cfgEndpoint" value="' + U.esc(config.endpoint) + '" ' +
              'placeholder="https://script.google.com/macros/s/…/exec"></div>' +
          '<div class="campo"><label for="cfgChave">Chave compartilhada' +
            '<span class="campo__dica">A mesma definida na constante CHAVE do Codigo.gs.</span></label>' +
            '<input type="password" id="cfgChave" value="' + U.esc(config.chave) + '"></div>' +
          '<button class="botao botao--secundario" id="botaoTestar" type="button">' +
            '🔌 Testar conexão</button>' +
          '<p id="resultadoTeste" style="margin:.7rem 0 0"></p>' +
        '</div>' +
      '</div>' +

      /* ---- preferências ---- */
      '<div class="cartao">' +
        '<h2 style="font-size:1.05rem">Preferências</h2>' +
        '<div class="grade grade--2" style="gap:0 1rem">' +
          '<div class="campo"><label for="cfgAnexo">Tamanho máximo por anexo (MB)</label>' +
            '<input type="number" id="cfgAnexo" min="1" max="50" ' +
              'value="' + U.esc(config.tamanhoMaximoAnexoMb) + '"></div>' +
          '<div class="campo"><label for="cfgPin">PIN da área do Núcleo' +
            '<span class="campo__dica">Se preenchido, será pedido para abrir Solicitações, ' +
            'Relatórios, Médicos e Configurações.</span></label>' +
            '<input type="password" id="cfgPin" value="' + U.esc(config.pinNucleo) + '" ' +
              'placeholder="deixe em branco para não exigir"></div>' +
        '</div>' +
        '<div class="aviso aviso--atencao" style="margin-bottom:0">' +
          '<span class="aviso__icone">🔒</span><div>' +
            '<strong>O PIN é uma barreira de conveniência, não uma senha de segurança.</strong>' +
            'Ele apenas evita que a área do Núcleo seja aberta por engano em um computador ' +
            'de consultório. A proteção real dos dados de pacientes depende do controle de ' +
            'acesso da rede do hospital e das permissões da planilha compartilhada.' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<button class="botao botao--grande botao--bloco" id="botaoSalvarConfig" type="button">' +
        '💾 Salvar configurações</button>' +

      /* ---- backup ---- */
      '<div class="cartao" style="margin-top:1.2rem">' +
        '<h2 style="font-size:1.05rem">Cópia de segurança</h2>' +
        '<p style="font-size:.9rem;color:var(--texto-suave)">' +
          'No modo “somente neste computador”, os dados vivem apenas no navegador. ' +
          'Limpar o histórico do navegador apaga tudo — exporte um backup periodicamente.</p>' +
        '<div style="display:flex;gap:.5rem;flex-wrap:wrap">' +
          '<button class="botao" id="botaoExportarBackup" type="button">⬇ Exportar backup (JSON)</button>' +
          '<button class="botao botao--secundario" id="botaoImportarBackup" type="button">' +
            '⬆ Restaurar backup</button>' +
          '<input type="file" id="arquivoBackup" accept="application/json" class="oculto">' +
          '<button class="botao botao--perigo" id="botaoLimpar" type="button">' +
            '🗑 Apagar todos os dados locais</button>' +
        '</div>' +
      '</div>' +

      /* ---- catálogo ---- */
      '<div class="cartao">' +
        '<h2 style="font-size:1.05rem">Catálogo de fichas</h2>' +
        '<dl class="dados-lista" style="margin-bottom:1rem">' +
          '<div><dt>Versão do catálogo</dt><dd>' + U.esc(revisao.versao) + '</dd></div>' +
          '<div><dt>Atualizado em</dt><dd>' + U.formatarData(revisao.atualizadoEm) + '</dd></div>' +
          '<div><dt>Fichas catalogadas</dt><dd>' + HABE_CATALOGO.fichas.length + '</dd></div>' +
          '<div><dt>Conferido por</dt><dd>' +
            (revisao.conferidoPor ? U.esc(revisao.conferidoPor) +
              ' em ' + U.formatarData(revisao.conferidoEm)
             : '<span style="color:var(--urgente)">conferência pendente</span>') + '</dd></div>' +
        '</dl>' +
        '<p style="font-size:.88rem"><strong>Base normativa:</strong> ' + U.esc(revisao.baseNormativa) + '</p>' +
        (revisao.conferidoPor
          ? ''
          : '<div class="aviso aviso--atencao"><span class="aviso__icone">📋</span><div>' +
              '<strong>Conferência normativa pendente</strong>' +
              'Antes de usar em produção, valide agravo por agravo a coluna de periodicidade ' +
              'contra a portaria vigente. O roteiro está em ' +
              '<code>docs/CONFERENCIA-NORMATIVA.md</code>, e as alterações são feitas em ' +
              '<code>assets/js/dados-fichas.js</code>.</div></div>') +
        '<button class="botao botao--secundario" id="botaoExportarCatalogo" type="button">' +
          '⬇ Exportar catálogo para conferência (CSV)</button>' +
      '</div>';

    /* ---------- eventos ---------- */

    U.$$('input[name="modo"]', elemento).forEach(function (radio) {
      radio.addEventListener('change', function () {
        U.$('#camposRemotos', elemento).classList.toggle('oculto', radio.value !== 'compartilhado');
      });
    });

    U.$('#botaoSalvarConfig', elemento).addEventListener('click', function () {
      var modo = U.$('input[name="modo"]:checked', elemento).value;
      var endpoint = U.$('#cfgEndpoint', elemento).value.trim();
      if (modo === 'compartilhado' && !endpoint) {
        U.torrada('Informe o endereço do Web App para usar o modo compartilhado.', 'erro');
        return;
      }
      Armazenamento.salvarConfig({
        modo: modo,
        endpoint: endpoint,
        chave: U.$('#cfgChave', elemento).value,
        enderecoPublico: U.$('#cfgEndereco', elemento).value.trim(),
        pinNucleo: U.$('#cfgPin', elemento).value.trim(),
        tamanhoMaximoAnexoMb: Number(U.$('#cfgAnexo', elemento).value) || 10
      });
      U.torrada('Configurações salvas.', 'sucesso');
      App.aplicarIdentidade();
    });

    var testar = U.$('#botaoTestar', elemento);
    if (testar) {
      testar.addEventListener('click', function () {
        var saida = U.$('#resultadoTeste', elemento);
        saida.innerHTML = 'Testando…';
        /* Grava antes de testar, para o teste usar os valores da tela. */
        Armazenamento.salvarConfig({
          modo: 'compartilhado',
          endpoint: U.$('#cfgEndpoint', elemento).value.trim(),
          chave: U.$('#cfgChave', elemento).value
        });
        Armazenamento.testarConexao().then(function (dados) {
          saida.innerHTML = '<span class="selo selo--sucesso">✓ Conectado — ' +
                            U.esc((dados && dados.versao) || 'servidor respondeu') + '</span>';
        }).catch(function (erro) {
          saida.innerHTML = '<span class="selo selo--urgente">' + U.esc(erro.message) + '</span>';
        });
      });
    }

    U.$('#botaoExportarBackup', elemento).addEventListener('click', function () {
      Armazenamento.exportarTudo().then(function (pacote) {
        U.baixarConteudo('habe-sinan-backup-' + U.hoje() + '.json',
                         JSON.stringify(pacote, null, 2), 'application/json');
        U.torrada('Backup exportado.', 'sucesso');
      }).catch(function (erro) { U.torrada(erro.message, 'erro'); });
    });

    U.$('#botaoImportarBackup', elemento).addEventListener('click', function () {
      U.$('#arquivoBackup', elemento).click();
    });

    U.$('#arquivoBackup', elemento).addEventListener('change', function () {
      var arquivo = this.files[0];
      if (!arquivo) { return; }
      if (!window.confirm('Restaurar o backup substitui TODAS as solicitações e cadastros ' +
                          'gravados neste computador. Deseja continuar?')) { return; }
      var leitor = new FileReader();
      leitor.onload = function () {
        try {
          Armazenamento.importarLocal(JSON.parse(String(leitor.result))).then(function () {
            U.torrada('Backup restaurado.', 'sucesso');
            App.atualizarContadores();
          }).catch(function (erro) { U.torrada(erro.message, 'erro'); });
        } catch (e) {
          U.torrada('Arquivo inválido: ' + e.message, 'erro');
        }
      };
      leitor.readAsText(arquivo);
    });

    U.$('#botaoLimpar', elemento).addEventListener('click', function () {
      if (!window.confirm('Apagar TODAS as solicitações, anexos e cadastros gravados neste ' +
                          'computador?\nExporte um backup antes. Esta ação não pode ser desfeita.')) {
        return;
      }
      if (!window.confirm('Confirme novamente: os dados locais serão apagados definitivamente.')) {
        return;
      }
      Armazenamento.limparLocal().then(function () {
        U.torrada('Dados locais apagados.', 'sucesso');
        App.atualizarContadores();
      });
    });

    U.$('#botaoExportarCatalogo', elemento).addEventListener('click', function () {
      var linhas = [['Agravo', 'Grupo', 'CID-10', 'Classificação', 'Prazo',
                     'Gatilho de imediatidade', 'Arquivo local', 'Link oficial',
                     'Link conferido', 'Observação']];
      HABE_CATALOGO.fichas.slice().sort(U.ordenarPorNome).forEach(function (f) {
        linhas.push([f.nome, f.grupo, f.cid10, U.rotuloDaClassificacao(f.classificacao),
                     U.prazoDaClassificacao(f.classificacao), f.gatilhoImediato || '',
                     f.arquivo, f.urlOficial || '', f.urlVerificada ? 'sim' : 'não',
                     f.observacao || '']);
      });
      U.baixarCsv('habe-sinan-catalogo-' + U.hoje() + '.csv', linhas);
      U.torrada('Catálogo exportado para conferência.', 'sucesso');
    });
  }

  return { render: render };
})();
