/* =========================================================================
   HABE SINAN — notificações registradas (Núcleo de Epidemiologia)
   -------------------------------------------------------------------------
   Lista tudo o que o Núcleo lançou: acompanha a situação, anexa a ficha
   preenchida e digitalizada (PDF ou foto) e encerra o caso depois do
   lançamento no Sinan.
   ========================================================================= */

var Paginas = Paginas || {};

Paginas.notificacoes = (function () {
  'use strict';

  var cache = [];
  var filtros = {
    de: '', ate: '', status: 'todas', classificacao: 'todas',
    ficha: '', medico: '', destino: '', texto: '', prazo: 'todas'
  };

  var STATUS = {
    aguardando: { rotulo: 'Aguardando ficha', selo: 'atencao' },
    recebida:   { rotulo: 'Ficha recebida',   selo: 'padrao' },
    encerrada:  { rotulo: 'Encerrada',        selo: 'sucesso' }
  };

  /* ---------- filtragem ---------- */

  function aplicarFiltros(lista) {
    var termo = U.normalizar(filtros.texto);
    return lista.filter(function (s) {
      if (filtros.de && s.dataAtendimento < filtros.de) { return false; }
      if (filtros.ate && s.dataAtendimento > filtros.ate) { return false; }
      if (filtros.status !== 'todas' && (s.status || 'aguardando') !== filtros.status) { return false; }
      if (filtros.classificacao === 'imediata' && s.classificacaoEfetiva !== 'imediata') { return false; }
      if (filtros.classificacao === 'semanal' && s.classificacaoEfetiva === 'imediata') { return false; }
      if (filtros.ficha && s.fichaId !== filtros.ficha) { return false; }
      if (filtros.medico && s.medicoId !== filtros.medico) { return false; }
      if (filtros.destino && s.destino !== filtros.destino) { return false; }
      if (filtros.prazo === 'dentro' && s.dentroDoPrazo !== true) { return false; }
      if (filtros.prazo === 'fora' && s.dentroDoPrazo !== false) { return false; }
      if (termo) {
        var alvo = U.normalizar([s.protocolo, s.pacienteNome, s.pacienteProntuario,
                                 s.fichaNome, s.medicoNome].join(' '));
        if (alvo.indexOf(termo) < 0) { return false; }
      }
      return true;
    }).sort(function (a, b) {
      return String(b.criadoEm).localeCompare(String(a.criadoEm));
    });
  }

  /* ---------- linhas da tabela ---------- */

  function linha(s) {
    var imediata = s.classificacaoEfetiva === 'imediata';
    var status = STATUS[s.status || 'aguardando'] || STATUS.aguardando;
    var qtdAnexos = (s.anexos || []).length;

    return '' +
      '<tr data-id="' + U.esc(s.id) + '" style="cursor:pointer">' +
        '<td><strong style="font-family:Consolas,monospace">' + U.esc(s.protocolo) + '</strong><br>' +
          '<small style="color:var(--texto-suave)">' + U.formatarData(s.dataAtendimento) + '</small></td>' +
        '<td>' +
          '<span class="ponto ponto--' + (imediata ? 'urgente' : 'padrao') + '"></span> ' +
          U.esc(s.fichaNome) +
          (imediata ? '<br><span class="selo selo--urgente">⏱ 24 h</span>' : '') +
        '</td>' +
        '<td>' + U.esc(s.pacienteNome) + '<br>' +
          '<small style="color:var(--texto-suave)">Prontuário ' + U.esc(s.pacienteProntuario) + '</small></td>' +
        '<td><span class="selo selo--neutro">' + U.esc(U.destinoSigla(s.destino)) + '</span></td>' +
        '<td>' + U.esc(s.medicoNome) + '<br>' +
          '<small style="color:var(--texto-suave)">CRM ' + U.esc(s.medicoCrm) + '</small></td>' +
        '<td><span class="selo selo--' + status.selo + '">' + U.esc(status.rotulo) + '</span></td>' +
        '<td style="text-align:center">' +
          (qtdAnexos ? '📎 ' + qtdAnexos : '<span style="color:var(--texto-suave)">—</span>') + '</td>' +
      '</tr>';
  }

  function desenharTabela(elemento) {
    var lista = aplicarFiltros(cache);
    var corpo = U.$('#corpoNotificacoes', elemento);

    if (lista.length === 0) {
      corpo.innerHTML = '<tr><td colspan="7" class="tabela__vazia">' +
        (cache.length === 0
          ? 'Nenhuma notificação registrada ainda.'
          : 'Nenhuma notificação corresponde aos filtros escolhidos.') + '</td></tr>';
    } else {
      corpo.innerHTML = lista.map(linha).join('');
    }

    var imediatas = lista.filter(function (s) { return s.classificacaoEfetiva === 'imediata'; }).length;
    var pendentes = lista.filter(function (s) { return (s.anexos || []).length === 0; }).length;
    U.$('#resumoNotificacoes', elemento).innerHTML =
      '<strong>' + lista.length + '</strong> notificações · ' +
      '<strong style="color:var(--urgente)">' + imediatas + '</strong> de notificação imediata · ' +
      '<strong style="color:var(--atencao)">' + pendentes + '</strong> sem ficha digitalizada anexada';
  }

  /* ---------- detalhe e anexos ---------- */

  function htmlAnexo(anexo) {
    var ehImagem = String(anexo.tipo || '').indexOf('image/') === 0;
    var endereco = anexo.conteudo || anexo.url || '#';
    return '' +
      '<li class="anexo-item" data-anexo="' + U.esc(anexo.id) + '">' +
        (ehImagem
          ? '<img class="anexo-item__miniatura" src="' + U.esc(endereco) + '" alt="">'
          : '<span style="font-size:1.5rem">📄</span>') +
        '<span class="anexo-item__nome">' + U.esc(anexo.nome) + '<br>' +
          '<small style="color:var(--texto-suave)">' + U.formatarTamanho(anexo.tamanho) +
          ' · ' + U.formatarDataHora(anexo.enviadoEm) + '</small></span>' +
        '<a class="botao botao--pequeno botao--secundario" href="' + U.esc(endereco) + '" ' +
          'target="_blank" rel="noopener" download="' + U.esc(anexo.nome) + '">Abrir</a>' +
        '<button class="botao botao--pequeno botao--perigo" data-remover-anexo="' +
          U.esc(anexo.id) + '" type="button">Excluir</button>' +
      '</li>';
  }

  function abrirDetalhe(id, elemento) {
    var s = cache.filter(function (x) { return x.id === id; })[0];
    if (!s) { return; }

    var ficha = HABE_CATALOGO.porId[s.fichaId];
    var imediata = s.classificacaoEfetiva === 'imediata';
    var prazo = U.prazoLimite({ classificacao: s.classificacaoEfetiva }, s.dataAtendimento);
    var anexos = s.anexos || [];
    var config = Armazenamento.obterConfig();

    var corpo = '' +
      (imediata
        ? '<div class="aviso aviso--urgente"><span class="aviso__icone">⏱</span><div>' +
            '<strong>Notificação imediata — prazo ' + U.esc(prazo.texto) + '</strong>' +
            (s.gatilhoAplicado
              ? 'O médico assinalou o gatilho de imediatidade previsto para este agravo.'
              : 'Agravo de notificação compulsória imediata.') +
          '</div></div>'
        : '<div class="aviso"><span class="aviso__icone">📅</span><div>' +
            '<strong>Notificação semanal — prazo ' + U.esc(prazo.texto) + '</strong>' +
            'Registrar no Sinan dentro da semana epidemiológica correspondente.</div></div>') +

      '<dl class="dados-lista" style="margin-bottom:1rem">' +
        '<div><dt>Protocolo</dt><dd style="font-family:Consolas,monospace">' + U.esc(s.protocolo) + '</dd></div>' +
        '<div><dt>Registrado em</dt><dd>' + U.formatarDataHora(s.criadoEm) + '</dd></div>' +
        '<div><dt>Data do atendimento</dt><dd>' + U.formatarData(s.dataAtendimento) + '</dd></div>' +
        '<div><dt>Recebida no Núcleo</dt><dd>' +
          (s.dataRecebimento ? U.formatarData(s.dataRecebimento) : '—') +
          (s.dentroDoPrazo === true ? ' <span class="selo selo--sucesso">no prazo</span>' :
           s.dentroDoPrazo === false ? ' <span class="selo selo--atencao">fora do prazo</span>' : '') +
        '</dd></div>' +
        '<div><dt>Semana epidemiológica</dt><dd>' + U.esc(s.semanaEpidemiologica || '—') + '</dd></div>' +
        '<div><dt>Paciente</dt><dd>' + U.esc(s.pacienteNome) + '</dd></div>' +
        '<div><dt>Prontuário</dt><dd>' + U.esc(s.pacienteProntuario) + '</dd></div>' +
        '<div><dt>Destino</dt><dd>' + U.esc(U.destinoNome(s.destino)) + '</dd></div>' +
        '<div><dt>Médico notificante</dt><dd>' + U.esc(s.medicoNome) + ' — CRM ' + U.esc(s.medicoCrm) + '</dd></div>' +
        '<div><dt>Setor</dt><dd>' + U.esc(s.medicoSetor || '—') + '</dd></div>' +
        '<div><dt>Agravo</dt><dd>' + U.esc(s.fichaNome) + '</dd></div>' +
      '</dl>' +

      (s.observacao
        ? '<div class="cartao" style="background:var(--fundo)"><h3 style="font-size:.92rem">' +
          'Observações do Núcleo</h3><p style="margin:0">' + U.esc(s.observacao) + '</p></div>'
        : '') +

      '<div class="cartao">' +
        '<h3 style="font-size:1rem">Ficha preenchida e digitalizada</h3>' +
        '<p style="font-size:.87rem;color:var(--texto-suave)">' +
          'Anexe o PDF do escaneamento ou uma foto legível da ficha assinada. ' +
          'Limite de ' + config.tamanhoMaximoAnexoMb + ' MB por arquivo; fotos são reduzidas ' +
          'automaticamente sem perder a legibilidade.</p>' +
        '<div class="zona-anexo" id="zonaAnexo">' +
          '<strong>Clique para escolher, ou arraste os arquivos aqui</strong>' +
          '<span style="font-size:.85rem">PDF, JPG ou PNG · vários arquivos de uma vez</span>' +
        '</div>' +
        '<input type="file" id="entradaAnexo" class="oculto" multiple ' +
               'accept="application/pdf,image/jpeg,image/png,image/heic,image/*">' +
        '<ul class="lista-anexos" id="listaAnexos">' +
          (anexos.length ? anexos.map(htmlAnexo).join('')
                         : '<li style="color:var(--texto-suave);font-size:.88rem">' +
                           'Nenhum arquivo anexado até o momento.</li>') +
        '</ul>' +
      '</div>' +

      '<div class="cartao">' +
        '<h3 style="font-size:1rem">Situação</h3>' +
        '<div class="filtros" style="margin:0">' +
          Object.keys(STATUS).map(function (chave) {
            var ativo = (s.status || 'aguardando') === chave;
            return '<button class="filtro' + (ativo ? ' filtro--ativo' : '') +
                   '" data-status="' + chave + '" type="button">' +
                   U.esc(STATUS[chave].rotulo) + '</button>';
          }).join('') +
        '</div>' +
      '</div>' +

      '<div style="display:grid;gap:.5rem">' +
        (ficha ? '<button class="botao botao--secundario" id="botaoRebaixarFicha">' +
                 '⬇ Baixar novamente a ficha em branco</button>' : '') +
        '<button class="botao botao--perigo" id="botaoExcluirNotificacao">' +
          '🗑 Excluir este registro</button>' +
      '</div>';

    U.abrirPainel(U.esc(s.protocolo) + ' — ' + U.esc(s.fichaNome), corpo, function (raiz) {
      var entrada = U.$('#entradaAnexo', raiz);
      var zona = U.$('#zonaAnexo', raiz);

      zona.addEventListener('click', function () { entrada.click(); });
      zona.addEventListener('dragover', function (e) {
        e.preventDefault(); zona.classList.add('zona-anexo--sobre');
      });
      zona.addEventListener('dragleave', function () { zona.classList.remove('zona-anexo--sobre'); });
      zona.addEventListener('drop', function (e) {
        e.preventDefault();
        zona.classList.remove('zona-anexo--sobre');
        receberArquivos(e.dataTransfer.files, s, elemento);
      });
      entrada.addEventListener('change', function () {
        receberArquivos(entrada.files, s, elemento);
      });

      U.$$('[data-status]', raiz).forEach(function (botao) {
        botao.addEventListener('click', function () {
          Armazenamento.atualizarSolicitacao(s.id, { status: botao.getAttribute('data-status') })
            .then(function () {
              U.torrada('Situação atualizada.', 'sucesso');
              U.fecharPainel();
              carregar(elemento);
            })
            .catch(function (erro) { U.torrada(erro.message, 'erro'); });
        });
      });

      U.$$('[data-remover-anexo]', raiz).forEach(function (botao) {
        botao.addEventListener('click', function () {
          if (!window.confirm('Excluir definitivamente este anexo?')) { return; }
          Armazenamento.removerAnexo(s.id, botao.getAttribute('data-remover-anexo'))
            .then(function () {
              U.torrada('Anexo excluído.', 'sucesso');
              U.fecharPainel();
              carregar(elemento);
            })
            .catch(function (erro) { U.torrada(erro.message, 'erro'); });
        });
      });

      var rebaixar = U.$('#botaoRebaixarFicha', raiz);
      if (rebaixar) {
        rebaixar.addEventListener('click', function () { U.entregarFicha(ficha, s); });
      }

      U.$('#botaoExcluirNotificacao', raiz).addEventListener('click', function () {
        if (!window.confirm('Excluir a notificação ' + s.protocolo + ' e todos os seus anexos?\n' +
                            'Esta ação não pode ser desfeita.')) { return; }
        Armazenamento.removerSolicitacao(s.id).then(function () {
          U.torrada('Notificação excluída.', 'sucesso');
          U.fecharPainel();
          carregar(elemento);
        }).catch(function (erro) { U.torrada(erro.message, 'erro'); });
      });
    });
  }

  function receberArquivos(arquivos, solicitacao, elemento) {
    var config = Armazenamento.obterConfig();
    var limite = config.tamanhoMaximoAnexoMb * 1024 * 1024;
    var fila = Array.prototype.slice.call(arquivos);
    if (fila.length === 0) { return; }

    U.torrada('Enviando ' + fila.length + ' arquivo(s)…');

    var cadeia = Promise.resolve();
    fila.forEach(function (arquivo) {
      cadeia = cadeia.then(function () {
        if (arquivo.size > limite) {
          U.torrada('“' + arquivo.name + '” excede ' + config.tamanhoMaximoAnexoMb +
                    ' MB e foi ignorado.', 'erro', 7000);
          return null;
        }
        return U.comprimirImagem(arquivo).then(function (comprimido) {
          if (comprimido) {
            return {
              nome: arquivo.name.replace(/\.[^.]+$/, '') + '.jpg',
              tipo: 'image/jpeg',
              tamanho: Math.round(comprimido.length * 0.75),
              conteudoBase64: comprimido
            };
          }
          return U.lerArquivoBase64(arquivo).then(function (base64) {
            return {
              nome: arquivo.name,
              tipo: arquivo.type || 'application/octet-stream',
              tamanho: arquivo.size,
              conteudoBase64: base64
            };
          });
        }).then(function (preparado) {
          if (!preparado) { return null; }
          return Armazenamento.enviarAnexo(solicitacao.id, preparado);
        });
      });
    });

    cadeia.then(function () {
      U.torrada('Anexos gravados.', 'sucesso');
      U.fecharPainel();
      carregar(elemento);
    }).catch(function (erro) {
      U.torrada('Falha ao anexar: ' + erro.message, 'erro', 8000);
    });
  }

  /* ---------- exportação ---------- */

  function exportarCsv() {
    var lista = aplicarFiltros(cache);
    var linhas = [[
      'Protocolo', 'Data do atendimento', 'Recebida no Núcleo', 'Dentro do prazo',
      'Semana epidemiológica', 'Agravo', 'Grupo',
      'Classificação', 'Prazo aplicado', 'Paciente', 'Prontuário', 'Destino',
      'Médico notificante', 'CRM', 'Setor', 'Situação', 'Anexos', 'Observações', 'Registrado em'
    ]];
    lista.forEach(function (s) {
      linhas.push([
        s.protocolo, U.formatarData(s.dataAtendimento),
        s.dataRecebimento ? U.formatarData(s.dataRecebimento) : '',
        s.dentroDoPrazo === true ? 'sim' : s.dentroDoPrazo === false ? 'não' : '',
        s.semanaEpidemiologica,
        s.fichaNome, s.fichaGrupo, U.rotuloDaClassificacao(s.classificacao),
        s.classificacaoEfetiva === 'imediata' ? 'Imediata (24 h)' : 'Semanal (7 dias)',
        s.pacienteNome, s.pacienteProntuario, U.destinoNome(s.destino),
        s.medicoNome, s.medicoCrm, s.medicoSetor,
        (STATUS[s.status || 'aguardando'] || {}).rotulo, (s.anexos || []).length,
        s.observacao, U.formatarDataHora(s.criadoEm)
      ]);
    });
    U.baixarCsv('habe-sinan-notificacoes-' + U.hoje() + '.csv', linhas);
    U.torrada('Planilha exportada.', 'sucesso');
  }

  /* ---------- carregamento ---------- */

  function carregar(elemento) {
    return Armazenamento.listarSolicitacoes().then(function (lista) {
      cache = lista || [];
      preencherSelects(elemento);
      desenharTabela(elemento);
      App.atualizarContadores();
    }).catch(function (erro) {
      U.$('#corpoNotificacoes', elemento).innerHTML =
        '<tr><td colspan="7" class="tabela__vazia">' + U.esc(erro.message) + '</td></tr>';
    });
  }

  function preencherSelects(elemento) {
    var fichasUsadas = {};
    var medicosUsados = {};
    cache.forEach(function (s) {
      fichasUsadas[s.fichaId] = s.fichaNome;
      if (s.medicoId) { medicosUsados[s.medicoId] = s.medicoNome; }
    });

    var selectFicha = U.$('#filtroFicha', elemento);
    selectFicha.innerHTML = '<option value="">Todos os agravos</option>' +
      Object.keys(fichasUsadas).sort(function (a, b) {
        return fichasUsadas[a].localeCompare(fichasUsadas[b], 'pt-BR');
      }).map(function (id) {
        return '<option value="' + U.esc(id) + '">' + U.esc(fichasUsadas[id]) + '</option>';
      }).join('');
    selectFicha.value = filtros.ficha;

    var selectMedico = U.$('#filtroMedico', elemento);
    selectMedico.innerHTML = '<option value="">Todos os médicos</option>' +
      Object.keys(medicosUsados).sort(function (a, b) {
        return medicosUsados[a].localeCompare(medicosUsados[b], 'pt-BR');
      }).map(function (id) {
        return '<option value="' + U.esc(id) + '">' + U.esc(medicosUsados[id]) + '</option>';
      }).join('');
    selectMedico.value = filtros.medico;
  }

  /* ---------- página ---------- */

  function render(elemento, parametros) {
    elemento.innerHTML = '' +
      '<div class="pagina__cabecalho">' +
        '<h1 id="t-notificacoes">Notificações registradas</h1>' +
        '<p>Tudo o que o Núcleo lançou. Anexe a ficha digitalizada e encerre o caso depois ' +
           'do lançamento no Sinan.</p>' +
      '</div>' +

      '<div class="cartao nao-imprimir">' +
        '<div class="grade grade--4" style="gap:.7rem 1rem">' +
          '<div class="campo" style="margin:0"><label for="filtroDe">De</label>' +
            '<input type="date" id="filtroDe"></div>' +
          '<div class="campo" style="margin:0"><label for="filtroAte">Até</label>' +
            '<input type="date" id="filtroAte"></div>' +
          '<div class="campo" style="margin:0"><label for="filtroStatus">Situação</label>' +
            '<select id="filtroStatus">' +
              '<option value="todas">Todas</option>' +
              '<option value="aguardando">Aguardando ficha</option>' +
              '<option value="recebida">Ficha recebida</option>' +
              '<option value="encerrada">Encerrada</option>' +
            '</select></div>' +
          '<div class="campo" style="margin:0"><label for="filtroClassificacao">Prazo</label>' +
            '<select id="filtroClassificacao">' +
              '<option value="todas">Todos</option>' +
              '<option value="imediata">⏱ Somente imediatas</option>' +
              '<option value="semanal">📅 Somente semanais</option>' +
            '</select></div>' +
          '<div class="campo" style="margin:0"><label for="filtroFicha">Agravo</label>' +
            '<select id="filtroFicha"></select></div>' +
          '<div class="campo" style="margin:0"><label for="filtroMedico">Médico</label>' +
            '<select id="filtroMedico"></select></div>' +
          '<div class="campo" style="margin:0"><label for="filtroPrazo">Cumprimento do prazo</label>' +
            '<select id="filtroPrazo">' +
              '<option value="todas">Todos</option>' +
              '<option value="dentro">Dentro do prazo</option>' +
              '<option value="fora">Fora do prazo</option>' +
            '</select></div>' +
          '<div class="campo" style="margin:0"><label for="filtroDestino">Destino</label>' +
            '<select id="filtroDestino"><option value="">Todos</option>' +
              HABE_CATALOGO.destinos.map(function (d) {
                return '<option value="' + U.esc(d.id) + '">' + U.esc(d.nome) + '</option>';
              }).join('') +
            '</select></div>' +
          '<div class="campo" style="margin:0"><label for="filtroTexto">Busca</label>' +
            '<input type="search" id="filtroTexto" placeholder="protocolo, paciente, prontuário…"></div>' +
        '</div>' +
        '<div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.9rem">' +
          '<button class="botao botao--secundario botao--pequeno" id="botaoLimparFiltros" type="button">' +
            'Limpar filtros</button>' +
          '<button class="botao botao--secundario botao--pequeno" id="botaoAtualizar" type="button">' +
            '↻ Atualizar</button>' +
          '<button class="botao botao--pequeno" id="botaoExportarCsv" type="button">' +
            '⬇ Exportar planilha (CSV)</button>' +
        '</div>' +
      '</div>' +

      '<p style="font-size:.9rem;margin-bottom:.7rem" id="resumoNotificacoes"></p>' +

      '<div class="cartao" style="padding:0;overflow:hidden">' +
        '<div class="tabela-rolagem">' +
          '<table class="tabela">' +
            '<thead><tr>' +
              '<th>Protocolo</th><th>Agravo</th><th>Paciente</th><th>Destino</th>' +
              '<th>Médico</th><th>Situação</th><th>Anexos</th>' +
            '</tr></thead>' +
            '<tbody id="corpoNotificacoes">' +
              '<tr><td colspan="7" class="tabela__vazia">Carregando…</td></tr>' +
            '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>';

    var mapa = {
      filtroDe: 'de', filtroAte: 'ate', filtroStatus: 'status',
      filtroClassificacao: 'classificacao', filtroFicha: 'ficha',
      filtroMedico: 'medico', filtroDestino: 'destino', filtroTexto: 'texto',
      filtroPrazo: 'prazo'
    };
    Object.keys(mapa).forEach(function (idCampo) {
      var campo = U.$('#' + idCampo, elemento);
      campo.value = filtros[mapa[idCampo]];
      campo.addEventListener('input', function () {
        filtros[mapa[idCampo]] = campo.value;
        desenharTabela(elemento);
      });
      campo.addEventListener('change', function () {
        filtros[mapa[idCampo]] = campo.value;
        desenharTabela(elemento);
      });
    });

    U.$('#botaoLimparFiltros', elemento).addEventListener('click', function () {
      filtros = { de: '', ate: '', status: 'todas', classificacao: 'todas',
                  ficha: '', medico: '', destino: '', texto: '', prazo: 'todas' };
      render(elemento);
      carregar(elemento);
    });
    U.$('#botaoAtualizar', elemento).addEventListener('click', function () { carregar(elemento); });
    U.$('#botaoExportarCsv', elemento).addEventListener('click', exportarCsv);

    U.$('#corpoNotificacoes', elemento).addEventListener('click', function (evento) {
      var tr = evento.target.closest('tr[data-id]');
      if (tr) { abrirDetalhe(tr.getAttribute('data-id'), elemento); }
    });

    /* Vindo de "Anexar a ficha digitalizada", abre direto o registro recém-criado. */
    carregar(elemento).then(function () {
      if (parametros && parametros.abrir) { abrirDetalhe(parametros.abrir, elemento); }
    });
  }

  return { render: render };
})();
