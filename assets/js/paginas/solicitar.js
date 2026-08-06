/* =========================================================================
   HABE SINAN — solicitação de ficha pelo médico assistente
   -------------------------------------------------------------------------
   Ao concluir, o sistema:
     1. registra a solicitação (agravo, atendimento, paciente, destino, médico);
     2. entrega automaticamente o PDF da ficha correta;
     3. emite um comprovante com número de protocolo, que acompanha a ficha
        preenchida até o Núcleo de Epidemiologia.
   ========================================================================= */

var Paginas = Paginas || {};

Paginas.solicitar = (function () {
  'use strict';

  var fichaEscolhida = null;
  var medicos = [];

  /* ---------- avisos de prazo ---------- */

  function painelPrazo(ficha) {
    if (!ficha) {
      return '<div class="aviso"><span class="aviso__icone">👆</span><div>' +
             '<strong>Escolha o agravo acima</strong>' +
             'O prazo de notificação e as orientações aparecem aqui assim que a ficha for ' +
             'selecionada.</div></div>';
    }

    var meta = HABE_CATALOGO.classificacoes[ficha.classificacao];
    var cor = U.corDaClassificacao(ficha.classificacao);
    var html = '' +
      '<div class="aviso aviso--' + (cor === 'padrao' ? '' : cor) + '">' +
        '<span class="aviso__icone">' +
          (ficha.classificacao === 'imediata' ? '⏱' : ficha.classificacao === 'condicional' ? '⚠' : '📅') +
        '</span>' +
        '<div>' +
          '<strong>' + U.esc(ficha.nome) + ' — ' + U.esc(meta.rotulo) + ' (' + U.esc(meta.prazo) + ')</strong>' +
          U.esc(meta.descricao) +
        '</div>' +
      '</div>';

    if (ficha.classificacao === 'condicional') {
      html += '' +
        '<div class="cartao" style="border-color:var(--atencao-borda);background:var(--atencao-bg)">' +
          '<h3 style="font-size:.95rem;margin-bottom:.5rem">Verifique o gatilho de notificação imediata</h3>' +
          '<p style="margin-bottom:.7rem;font-size:.9rem">' + U.esc(ficha.gatilhoImediato) + '</p>' +
          '<label class="opcao" style="background:var(--superficie)">' +
            '<input type="checkbox" id="gatilhoAplicado">' +
            '<span class="opcao__texto"><strong>Sim, esta situação se aplica ao caso</strong>' +
              '<small>Marcando esta opção, a solicitação passa a constar como ' +
              'NOTIFICAÇÃO IMEDIATA (24 horas).</small></span>' +
          '</label>' +
        '</div>';
    }

    if (ficha.observacao) {
      html += '<p style="font-size:.88rem;color:var(--texto-suave);margin-bottom:1rem">' +
              '<strong>Orientação:</strong> ' + U.esc(ficha.observacao) + '</p>';
    }
    return html;
  }

  function atualizarPainelPrazo(elemento) {
    U.$('#painelPrazo', elemento).innerHTML = painelPrazo(fichaEscolhida);
  }

  /* ---------- cadastro rápido de médico ---------- */

  function abrirCadastroMedico(aoSalvar) {
    U.abrirPainel('Cadastro do médico solicitante',
      '<p style="color:var(--texto-suave);font-size:.9rem">' +
        'O cadastro é feito uma única vez. Nas próximas solicitações basta escolher o nome na lista.</p>' +
      '<form id="formMedicoRapido">' +
        '<div class="campo"><label for="mrNome">Nome completo <span class="obrigatorio">*</span></label>' +
          '<input type="text" id="mrNome" required autocomplete="name"></div>' +
        '<div class="grade grade--2" style="gap:0 1rem">' +
          '<div class="campo"><label for="mrCrm">CRM <span class="obrigatorio">*</span></label>' +
            '<input type="text" id="mrCrm" required inputmode="numeric" placeholder="somente números"></div>' +
          '<div class="campo"><label for="mrUf">UF do CRM</label>' +
            '<input type="text" id="mrUf" maxlength="2" placeholder="PA" style="text-transform:uppercase"></div>' +
        '</div>' +
        '<div class="campo"><label for="mrEspecialidade">Especialidade</label>' +
          '<input type="text" id="mrEspecialidade" placeholder="ex.: Clínica Médica"></div>' +
        '<div class="campo"><label for="mrSetor">Setor de atuação</label>' +
          '<input type="text" id="mrSetor" placeholder="ex.: Pronto Atendimento, UI1, UTI"></div>' +
        '<div class="grade grade--2" style="gap:0 1rem">' +
          '<div class="campo"><label for="mrTelefone">Telefone de contato</label>' +
            '<input type="tel" id="mrTelefone" placeholder="(91) 90000-0000"></div>' +
          '<div class="campo"><label for="mrEmail">E-mail</label>' +
            '<input type="email" id="mrEmail"></div>' +
        '</div>' +
        '<button class="botao botao--bloco botao--grande" type="submit">Salvar cadastro</button>' +
      '</form>',
      function () {
        U.$('#formMedicoRapido').addEventListener('submit', function (evento) {
          evento.preventDefault();
          var medico = {
            nome: U.$('#mrNome').value.trim(),
            crm: U.$('#mrCrm').value.trim(),
            uf: U.$('#mrUf').value.trim().toUpperCase(),
            especialidade: U.$('#mrEspecialidade').value.trim(),
            setor: U.$('#mrSetor').value.trim(),
            telefone: U.$('#mrTelefone').value.trim(),
            email: U.$('#mrEmail').value.trim(),
            ativo: true
          };
          Armazenamento.salvarMedico(medico).then(function (salvo) {
            U.fecharPainel();
            U.torrada('Médico cadastrado: ' + salvo.nome, 'sucesso');
            aoSalvar(salvo);
          }).catch(function (erro) { U.torrada(erro.message, 'erro'); });
        });
      });
  }

  function preencherMedicos(elemento, selecionarId) {
    var select = U.$('#campoMedico', elemento);
    return Armazenamento.listarMedicos().then(function (lista) {
      medicos = lista.filter(function (m) { return m.ativo !== false; });
      select.innerHTML =
        '<option value="">— selecione —</option>' +
        medicos.map(function (m) {
          return '<option value="' + U.esc(m.id) + '">' + U.esc(m.nome) +
                 ' — CRM ' + U.esc(m.crm) + (m.uf ? '/' + U.esc(m.uf) : '') + '</option>';
        }).join('') +
        '<option value="__novo__">➕ Cadastrar novo médico…</option>';
      if (selecionarId) { select.value = selecionarId; }
    });
  }

  /* ---------- comprovante ---------- */

  function mostrarComprovante(elemento, solicitacao, ficha, desfechoDownload) {
    var imediata = solicitacao.classificacaoEfetiva === 'imediata';
    var prazo = U.prazoLimite({ classificacao: solicitacao.classificacaoEfetiva },
                              solicitacao.dataAtendimento);

    elemento.innerHTML = '' +
      '<div class="pagina__cabecalho nao-imprimir">' +
        '<h1>Solicitação registrada</h1>' +
        '<p>Guarde o protocolo abaixo e anexe este comprovante à ficha preenchida.</p>' +
      '</div>' +

      (desfechoDownload.origem === 'local'
        ? '<div class="aviso aviso--sucesso nao-imprimir"><span class="aviso__icone">⬇</span><div>' +
            '<strong>Ficha baixada automaticamente</strong>Arquivo <code>' +
            U.esc(desfechoDownload.nome) + '</code> — verifique a pasta de downloads do computador.</div></div>'
        : '<div class="aviso aviso--atencao nao-imprimir"><span class="aviso__icone">🔗</span><div>' +
            '<strong>Ficha não encontrada no acervo local</strong>' +
            'Foi aberta a versão do portal oficial em outra aba. Avise o Núcleo de Epidemiologia ' +
            'para que o arquivo seja incluído no acervo.</div></div>') +

      (imediata
        ? '<div class="aviso aviso--urgente"><span class="aviso__icone">⏱</span><div>' +
            '<strong>NOTIFICAÇÃO IMEDIATA — comunique agora, por telefone</strong>' +
            'Prazo ' + U.esc(prazo.texto) + '. A comunicação verbal ao Núcleo de Epidemiologia ' +
            'não pode esperar a entrega da ficha em papel.</div></div>'
        : '') +

      '<div class="comprovante" id="areaComprovante">' +
        '<div class="comprovante__cabecalho">' +
          '<img class="brasao--comprovante" src="assets/img/logo-habe.svg" alt="">' +
          '<div style="flex:1 1 auto">' +
            '<strong style="font-size:1.05rem">HABE SINAN — Comprovante de solicitação de ficha</strong><br>' +
            '<span style="font-size:.85rem;color:var(--texto-suave)">' +
              U.esc(Armazenamento.obterConfig().unidade) + ' · ' +
              U.esc(Armazenamento.obterConfig().setor) + '</span>' +
          '</div>' +
          '<div style="text-align:right">' +
            '<div style="font-size:.72rem;color:var(--texto-suave);text-transform:uppercase">Protocolo</div>' +
            '<div class="comprovante__protocolo">' + U.esc(solicitacao.protocolo) + '</div>' +
          '</div>' +
        '</div>' +

        '<p style="margin-bottom:.9rem">' +
          '<span class="selo selo--' + (imediata ? 'urgente' : U.corDaClassificacao(ficha.classificacao)) + '">' +
            (imediata ? '⏱ NOTIFICAÇÃO IMEDIATA — 24 HORAS' :
             U.esc(U.rotuloDaClassificacao(ficha.classificacao)) + ' — ' +
             U.esc(U.prazoDaClassificacao(ficha.classificacao))) +
          '</span>' +
        '</p>' +

        '<dl class="dados-lista">' +
          '<div><dt>Agravo / ficha</dt><dd>' + U.esc(ficha.nome) + '</dd></div>' +
          '<div><dt>CID-10</dt><dd>' + U.esc(ficha.cid10) + '</dd></div>' +
          '<div><dt>Data do atendimento</dt><dd>' + U.formatarData(solicitacao.dataAtendimento) +
            ' (' + U.esc((U.semanaEpidemiologica(solicitacao.dataAtendimento) || {}).rotulo || '—') + ')</dd></div>' +
          '<div><dt>Prazo para notificar</dt><dd>' + U.esc(prazo.texto) + '</dd></div>' +
          '<div><dt>Paciente</dt><dd>' + U.esc(solicitacao.pacienteNome) + '</dd></div>' +
          '<div><dt>Prontuário</dt><dd>' + U.esc(solicitacao.pacienteProntuario) + '</dd></div>' +
          '<div><dt>Destino do paciente</dt><dd>' + U.esc(U.destinoNome(solicitacao.destino)) + '</dd></div>' +
          '<div><dt>Médico solicitante</dt><dd>' + U.esc(solicitacao.medicoNome) +
            ' — CRM ' + U.esc(solicitacao.medicoCrm) + '</dd></div>' +
          '<div><dt>Registrado em</dt><dd>' + U.formatarDataHora(solicitacao.criadoEm) + '</dd></div>' +
        '</dl>' +

        (solicitacao.observacao
          ? '<p style="margin-top:.9rem"><strong>Observações:</strong> ' +
            U.esc(solicitacao.observacao) + '</p>' : '') +

        '<p style="margin-top:1rem;padding-top:.8rem;border-top:1px dashed var(--borda);' +
          'font-size:.82rem;color:var(--texto-suave)">' +
          'Devolva a ficha preenchida e assinada ao Núcleo de Epidemiologia, ou anexe a ' +
          'digitalização a este protocolo no próprio sistema. Assinatura do médico: ' +
          '_________________________________________</p>' +
      '</div>' +

      '<div class="grade grade--3 nao-imprimir" style="margin-top:1.2rem">' +
        '<button class="botao" id="botaoImprimirComprovante">🖨 Imprimir comprovante</button>' +
        '<button class="botao botao--secundario" id="botaoBaixarNovamente">⬇ Baixar a ficha novamente</button>' +
        '<a class="botao botao--secundario" href="#/solicitar">➕ Nova solicitação</a>' +
      '</div>';

    U.$('#botaoImprimirComprovante', elemento).addEventListener('click', function () { window.print(); });
    U.$('#botaoBaixarNovamente', elemento).addEventListener('click', function () {
      U.entregarFicha(ficha, solicitacao);
    });
  }

  /* ---------- página ---------- */

  function render(elemento, parametros) {
    fichaEscolhida = (parametros && parametros.ficha) ? HABE_CATALOGO.porId[parametros.ficha] : null;

    var opcoesFichas = HABE_CATALOGO.fichas.slice().sort(U.ordenarPorNome).map(function (f) {
      var marca = f.classificacao === 'imediata' ? '⏱ ' : f.classificacao === 'condicional' ? '⚠ ' : '';
      return '<option value="' + U.esc(f.id) + '">' + marca + U.esc(f.nome) + '</option>';
    }).join('');

    var opcoesDestino = HABE_CATALOGO.destinos.map(function (d) {
      return '' +
        '<label class="opcao">' +
          '<input type="radio" name="destino" value="' + U.esc(d.id) + '" required>' +
          '<span class="opcao__texto"><strong>' + U.esc(d.nome) + '</strong>' +
            '<small>Sigla no relatório: ' + U.esc(d.sigla) + '</small></span>' +
        '</label>';
    }).join('');

    elemento.innerHTML = '' +
      '<div class="pagina__cabecalho">' +
        '<h1 id="t-solicitar">Solicitar ficha de notificação</h1>' +
        '<p>Preencha os dados do atendimento. A ficha correta será baixada automaticamente ao final.</p>' +
      '</div>' +

      '<form id="formSolicitacao" novalidate>' +

        '<div class="cartao">' +
          '<h2 style="font-size:1.05rem">1 · Qual ficha você precisa?</h2>' +
          '<div class="campo">' +
            '<label for="campoFicha">Agravo / doença <span class="obrigatorio">*</span>' +
              '<span class="campo__dica">Digite para filtrar. ⏱ indica notificação imediata (24 h); ' +
              '⚠ indica prazo semanal com gatilho imediato.</span></label>' +
            '<select id="campoFicha" required>' +
              '<option value="">— selecione o agravo —</option>' + opcoesFichas +
            '</select>' +
            '<div class="campo__erro">Selecione o agravo correspondente ao caso.</div>' +
          '</div>' +
          '<p style="margin:0"><a href="#/fichas">Não encontrou? Consulte o sumário completo A–Z →</a></p>' +
        '</div>' +

        '<div id="painelPrazo"></div>' +

        '<div class="cartao">' +
          '<h2 style="font-size:1.05rem">2 · Dados do atendimento</h2>' +
          '<div class="grade grade--2" style="gap:0 1rem">' +
            '<div class="campo">' +
              '<label for="campoData">Data do atendimento <span class="obrigatorio">*</span></label>' +
              '<input type="date" id="campoData" required max="' + U.hoje() + '" value="' + U.hoje() + '">' +
              '<div class="campo__erro">Informe a data do atendimento (não pode ser futura).</div>' +
            '</div>' +
            '<div class="campo">' +
              '<label for="campoProntuario">Prontuário no sistema interno <span class="obrigatorio">*</span>' +
                '<span class="campo__dica">Número do paciente no sistema do hospital.</span></label>' +
              '<input type="text" id="campoProntuario" required autocomplete="off">' +
              '<div class="campo__erro">Informe o número do prontuário.</div>' +
            '</div>' +
          '</div>' +
          '<div class="campo">' +
            '<label for="campoPaciente">Nome completo do paciente <span class="obrigatorio">*</span></label>' +
            '<input type="text" id="campoPaciente" required autocomplete="off">' +
            '<div class="campo__erro">Informe o nome completo, sem abreviaturas.</div>' +
          '</div>' +
          '<div class="campo">' +
            '<label>Destino do paciente <span class="obrigatorio">*</span></label>' +
            '<div class="opcoes">' + opcoesDestino + '</div>' +
            '<div class="campo__erro">Selecione o destino do paciente após o atendimento.</div>' +
          '</div>' +
        '</div>' +

        '<div class="cartao">' +
          '<h2 style="font-size:1.05rem">3 · Médico solicitante</h2>' +
          '<div class="campo">' +
            '<label for="campoMedico">Identificação <span class="obrigatorio">*</span></label>' +
            '<select id="campoMedico" required><option value="">carregando…</option></select>' +
            '<div class="campo__erro">Selecione o médico solicitante ou faça o cadastro.</div>' +
          '</div>' +
          '<div class="campo">' +
            '<label for="campoObservacao">Observações (opcional)' +
              '<span class="campo__dica">Informação clínica relevante para a vigilância — ' +
              'ex.: vínculo epidemiológico, viagem recente, contato com animais.</span></label>' +
            '<textarea id="campoObservacao"></textarea>' +
          '</div>' +
        '</div>' +

        '<button class="botao botao--grande botao--bloco" type="submit" id="botaoEnviar">' +
          '✅ Registrar e baixar a ficha</button>' +
        '<p style="text-align:center;font-size:.83rem;color:var(--texto-suave);margin-top:.7rem">' +
          'Os dados ficam disponíveis ao Núcleo de Epidemiologia. Trate-os conforme a Lei Geral ' +
          'de Proteção de Dados e o sigilo profissional.</p>' +
      '</form>';

    var select = U.$('#campoFicha', elemento);
    if (fichaEscolhida) { select.value = fichaEscolhida.id; }
    atualizarPainelPrazo(elemento);

    select.addEventListener('change', function () {
      fichaEscolhida = HABE_CATALOGO.porId[select.value] || null;
      atualizarPainelPrazo(elemento);
    });

    var selectMedico = U.$('#campoMedico', elemento);
    preencherMedicos(elemento);
    selectMedico.addEventListener('change', function () {
      if (selectMedico.value === '__novo__') {
        selectMedico.value = '';
        abrirCadastroMedico(function (salvo) { preencherMedicos(elemento, salvo.id); });
      }
    });

    U.$('#formSolicitacao', elemento).addEventListener('submit', function (evento) {
      evento.preventDefault();
      enviar(elemento);
    });
  }

  /* ---------- validação e gravação ---------- */

  function marcar(campo, invalido) {
    var caixa = campo.closest('.campo');
    if (caixa) { caixa.classList.toggle('campo--invalido', invalido); }
    return !invalido;
  }

  function enviar(elemento) {
    var campoFicha = U.$('#campoFicha', elemento);
    var campoData = U.$('#campoData', elemento);
    var campoPaciente = U.$('#campoPaciente', elemento);
    var campoProntuario = U.$('#campoProntuario', elemento);
    var campoMedico = U.$('#campoMedico', elemento);
    var destinoMarcado = U.$('input[name="destino"]:checked', elemento);

    var ok = true;
    ok = marcar(campoFicha, !campoFicha.value) && ok;
    ok = marcar(campoData, !campoData.value || campoData.value > U.hoje()) && ok;
    ok = marcar(campoPaciente, campoPaciente.value.trim().length < 5) && ok;
    ok = marcar(campoProntuario, campoProntuario.value.trim().length < 1) && ok;
    ok = marcar(campoMedico, !campoMedico.value || campoMedico.value === '__novo__') && ok;

    var caixaDestino = destinoMarcado ? null : U.$('input[name="destino"]', elemento).closest('.campo');
    if (caixaDestino) { caixaDestino.classList.add('campo--invalido'); ok = false; }
    else if (destinoMarcado) {
      destinoMarcado.closest('.campo').classList.remove('campo--invalido');
    }

    if (!ok) {
      U.torrada('Verifique os campos destacados em vermelho.', 'erro');
      var primeiro = U.$('.campo--invalido', elemento);
      if (primeiro) { primeiro.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      return;
    }

    var ficha = HABE_CATALOGO.porId[campoFicha.value];
    var medico = medicos.filter(function (m) { return m.id === campoMedico.value; })[0] || {};
    var gatilho = U.$('#gatilhoAplicado', elemento);
    var gatilhoAplicado = !!(gatilho && gatilho.checked);

    var solicitacao = {
      fichaId: ficha.id,
      fichaNome: ficha.nome,
      fichaGrupo: ficha.grupo,
      classificacao: ficha.classificacao,
      classificacaoEfetiva: (ficha.classificacao === 'imediata' || gatilhoAplicado)
        ? 'imediata' : ficha.classificacao,
      gatilhoAplicado: gatilhoAplicado,
      dataAtendimento: campoData.value,
      semanaEpidemiologica: (U.semanaEpidemiologica(campoData.value) || {}).rotulo || '',
      pacienteNome: campoPaciente.value.trim(),
      pacienteProntuario: campoProntuario.value.trim(),
      destino: destinoMarcado.value,
      medicoId: medico.id || '',
      medicoNome: medico.nome || '',
      medicoCrm: (medico.crm || '') + (medico.uf ? '/' + medico.uf : ''),
      medicoSetor: medico.setor || '',
      observacao: U.$('#campoObservacao', elemento).value.trim(),
      status: 'aguardando'
    };

    var botao = U.$('#botaoEnviar', elemento);
    botao.disabled = true;
    botao.textContent = 'Registrando…';

    Armazenamento.salvarSolicitacao(solicitacao)
      .then(function (salva) {
        return U.entregarFicha(ficha, salva).then(function (desfecho) {
          mostrarComprovante(elemento, salva, ficha, desfecho);
          window.scrollTo({ top: 0, behavior: 'smooth' });
          App.atualizarContadores();
        });
      })
      .catch(function (erro) {
        botao.disabled = false;
        botao.textContent = '✅ Registrar e baixar a ficha';
        U.torrada(erro.message, 'erro', 9000);
      });
  }

  return { render: render };
})();
