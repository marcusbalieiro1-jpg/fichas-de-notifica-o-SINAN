/* =========================================================================
   HABE SINAN — registro manual das notificações (Núcleo de Epidemiologia)
   -------------------------------------------------------------------------
   O médico assistente atende, consulta o prazo na página de consulta, baixa
   a ficha, preenche e encaminha ao Núcleo. É aqui que o Núcleo lança esse
   material: o agravo, o atendimento, o paciente, o destino e quem notificou.

   Guarda-se também a data em que a ficha chegou ao Núcleo — é o que permite
   medir a oportunidade da notificação, ou seja, se o prazo regulamentar foi
   cumprido.
   ========================================================================= */

var Paginas = Paginas || {};

Paginas.registrar = (function () {
  'use strict';

  var fichaEscolhida = null;
  var medicos = [];

  /* ---------- prazo do agravo escolhido ---------- */

  function painelPrazo(ficha) {
    if (!ficha) {
      return '<div class="aviso"><span class="aviso__icone">👆</span><div>' +
             '<strong>Escolha o agravo acima</strong>' +
             'O prazo e as orientações aparecem aqui assim que a ficha for selecionada.' +
             '</div></div>';
    }

    var meta = HABE_CATALOGO.classificacoes[ficha.classificacao];
    var cor = U.corDaClassificacao(ficha.classificacao);
    var html = '' +
      '<div class="aviso aviso--' + (cor === 'padrao' ? '' : cor) + '">' +
        '<span class="aviso__icone">' +
          (ficha.classificacao === 'imediata' ? '⏱' : ficha.classificacao === 'condicional' ? '⚠' : '📅') +
        '</span>' +
        '<div>' +
          '<strong>' + U.esc(ficha.nome) + ' — ' + U.esc(meta.rotulo) +
          ' (' + U.esc(meta.prazo) + ')</strong>' + U.esc(meta.descricao) +
        '</div>' +
      '</div>';

    if (ficha.classificacao === 'condicional') {
      html += '' +
        '<div class="cartao" style="border-color:var(--atencao-borda);background:var(--atencao-bg)">' +
          '<h3 style="font-size:.95rem;margin-bottom:.5rem">Gatilho de notificação imediata</h3>' +
          '<p style="margin-bottom:.7rem;font-size:.9rem">' + U.esc(ficha.gatilhoImediato) + '</p>' +
          '<label class="opcao" style="background:var(--superficie)">' +
            '<input type="checkbox" id="gatilhoAplicado">' +
            '<span class="opcao__texto"><strong>O caso se enquadra no gatilho</strong>' +
              '<small>Marque para que o registro conste como notificação imediata (24 horas) ' +
              'nos relatórios e no cálculo de prazo.</small></span>' +
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
    atualizarAvisoDePrazo(elemento);
  }

  /* Compara a data de chegada ao Núcleo com o prazo do agravo. */
  function avaliarPrazo(ficha, dataAtendimento, dataRecebimento, gatilho) {
    if (!ficha || !dataAtendimento || !dataRecebimento) { return null; }
    var classificacao = (ficha.classificacao === 'imediata' || gatilho) ? 'imediata' : 'semanal';
    var limite = U.prazoLimite({ classificacao: classificacao }, dataAtendimento);
    var chegada = U.paraData(dataRecebimento);
    return {
      classificacao: classificacao,
      limite: limite,
      dentroDoPrazo: chegada <= limite.data,
      diasDecorridos: Math.round((chegada - U.paraData(dataAtendimento)) / 86400000)
    };
  }

  function atualizarAvisoDePrazo(elemento) {
    var caixa = U.$('#avisoPrazoCumprido', elemento);
    if (!caixa) { return; }

    var dataAtendimento = U.$('#campoData', elemento).value;
    var dataRecebimento = U.$('#campoRecebimento', elemento).value;
    var gatilho = U.$('#gatilhoAplicado', elemento);
    var avaliacao = avaliarPrazo(fichaEscolhida, dataAtendimento, dataRecebimento,
                                 !!(gatilho && gatilho.checked));

    if (!avaliacao) { caixa.innerHTML = ''; return; }

    caixa.innerHTML = avaliacao.dentroDoPrazo
      ? '<div class="aviso aviso--sucesso" style="margin:0 0 1rem"><span class="aviso__icone">✓</span>' +
        '<div><strong>Dentro do prazo</strong>' +
        'A ficha chegou ao Núcleo ' + avaliacao.diasDecorridos + ' dia(s) após o atendimento; ' +
        'o prazo ia ' + U.esc(avaliacao.limite.texto) + '.</div></div>'
      : '<div class="aviso aviso--atencao" style="margin:0 0 1rem"><span class="aviso__icone">⏰</span>' +
        '<div><strong>Fora do prazo</strong>' +
        'A ficha chegou ' + avaliacao.diasDecorridos + ' dia(s) após o atendimento, e o prazo ' +
        'ia ' + U.esc(avaliacao.limite.texto) + '. O registro será feito assim mesmo e constará ' +
        'como fora do prazo nos relatórios de oportunidade.</div></div>';
  }

  /* ---------- cadastro rápido de médico ---------- */

  function abrirCadastroMedico(aoSalvar) {
    U.abrirPainel('Cadastro do médico notificante',
      '<p style="color:var(--texto-suave);font-size:.9rem">' +
        'Feito uma única vez por profissional. Nos registros seguintes basta escolher o nome.</p>' +
      '<form id="formMedicoRapido">' +
        '<div class="campo"><label for="mrNome">Nome completo <span class="obrigatorio">*</span></label>' +
          '<input type="text" id="mrNome" required autocomplete="name"></div>' +
        '<div class="grade grade--2" style="gap:0 1rem">' +
          '<div class="campo"><label for="mrCrm">CRM <span class="obrigatorio">*</span></label>' +
            '<input type="text" id="mrCrm" required inputmode="numeric"></div>' +
          '<div class="campo"><label for="mrUf">UF do CRM</label>' +
            '<input type="text" id="mrUf" maxlength="2" placeholder="PA" style="text-transform:uppercase"></div>' +
        '</div>' +
        '<div class="campo"><label for="mrEspecialidade">Especialidade</label>' +
          '<input type="text" id="mrEspecialidade" placeholder="ex.: Clínica Médica"></div>' +
        '<div class="campo"><label for="mrSetor">Setor de atuação</label>' +
          '<input type="text" id="mrSetor" placeholder="ex.: Urgência, Ambulatório, UI1, UTI"></div>' +
        '<div class="grade grade--2" style="gap:0 1rem">' +
          '<div class="campo"><label for="mrTelefone">Telefone</label>' +
            '<input type="tel" id="mrTelefone"></div>' +
          '<div class="campo"><label for="mrEmail">E-mail</label>' +
            '<input type="email" id="mrEmail"></div>' +
        '</div>' +
        '<button class="botao botao--bloco botao--grande" type="submit">Salvar cadastro</button>' +
      '</form>',
      function () {
        U.$('#formMedicoRapido').addEventListener('submit', function (evento) {
          evento.preventDefault();
          Armazenamento.salvarMedico({
            nome: U.$('#mrNome').value.trim(),
            crm: U.$('#mrCrm').value.trim(),
            uf: U.$('#mrUf').value.trim().toUpperCase(),
            especialidade: U.$('#mrEspecialidade').value.trim(),
            setor: U.$('#mrSetor').value.trim(),
            telefone: U.$('#mrTelefone').value.trim(),
            email: U.$('#mrEmail').value.trim(),
            ativo: true
          }).then(function (salvo) {
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
      medicos = (lista || []).filter(function (m) { return m.ativo !== false; });
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

  /* ---------- confirmação ---------- */

  function mostrarConfirmacao(elemento, registro, ficha) {
    var imediata = registro.classificacaoEfetiva === 'imediata';
    var prazo = U.prazoLimite({ classificacao: registro.classificacaoEfetiva },
                              registro.dataAtendimento);
    var u = U.unidade();

    elemento.innerHTML = '' +
      '<div class="pagina__cabecalho nao-imprimir">' +
        '<h1>Notificação registrada</h1>' +
        '<p>Anexe a ficha digitalizada ao protocolo para encerrar o caso.</p>' +
      '</div>' +

      (registro.dentroDoPrazo === false
        ? '<div class="aviso aviso--atencao nao-imprimir"><span class="aviso__icone">⏰</span><div>' +
          '<strong>Registrado fora do prazo</strong>' +
          'A ficha chegou ao Núcleo depois do prazo regulamentar. O caso constará assim nos ' +
          'relatórios de oportunidade — vale conversar com o setor de origem.</div></div>'
        : '') +

      '<div class="comprovante" id="areaComprovante">' +
        '<div class="comprovante__cabecalho">' +
          '<img class="brasao--comprovante" src="assets/img/logo-habe.svg" alt="">' +
          '<div style="flex:1 1 auto">' +
            '<strong style="font-size:1.05rem">HABE SINAN — Registro de notificação compulsória</strong><br>' +
            '<span style="font-size:.85rem;color:var(--texto-suave)">' +
              U.esc(u.nome || '') + ' · ' + U.esc(u.setor || '') + '</span>' +
          '</div>' +
          '<div style="text-align:right">' +
            '<div style="font-size:.72rem;color:var(--texto-suave);text-transform:uppercase">Protocolo</div>' +
            '<div class="comprovante__protocolo">' + U.esc(registro.protocolo) + '</div>' +
          '</div>' +
        '</div>' +

        '<p style="margin-bottom:.9rem">' +
          '<span class="selo selo--' + (imediata ? 'urgente' : U.corDaClassificacao(ficha.classificacao)) + '">' +
            (imediata ? '⏱ NOTIFICAÇÃO IMEDIATA — 24 HORAS'
                      : U.esc(U.rotuloDaClassificacao(ficha.classificacao)) + ' — ' +
                        U.esc(U.prazoDaClassificacao(ficha.classificacao))) +
          '</span>' +
          (registro.dentroDoPrazo === false
            ? ' <span class="selo selo--atencao">fora do prazo</span>'
            : ' <span class="selo selo--sucesso">dentro do prazo</span>') +
        '</p>' +

        '<dl class="dados-lista">' +
          '<div><dt>Agravo</dt><dd>' + U.esc(ficha.nome) + '</dd></div>' +
          '<div><dt>CID-10</dt><dd>' + U.esc(ficha.cid10) + '</dd></div>' +
          '<div><dt>Data do atendimento</dt><dd>' + U.formatarData(registro.dataAtendimento) +
            ' (' + U.esc(registro.semanaEpidemiologica || '—') + ')</dd></div>' +
          '<div><dt>Recebida no Núcleo</dt><dd>' + U.formatarData(registro.dataRecebimento) + '</dd></div>' +
          '<div><dt>Prazo regulamentar</dt><dd>' + U.esc(prazo.texto) + '</dd></div>' +
          '<div><dt>Paciente</dt><dd>' + U.esc(registro.pacienteNome) + '</dd></div>' +
          '<div><dt>Prontuário</dt><dd>' + U.esc(registro.pacienteProntuario) + '</dd></div>' +
          '<div><dt>Destino do paciente</dt><dd>' + U.esc(U.destinoNome(registro.destino)) + '</dd></div>' +
          '<div><dt>Médico notificante</dt><dd>' + U.esc(registro.medicoNome) +
            ' — CRM ' + U.esc(registro.medicoCrm) + '</dd></div>' +
          '<div><dt>Registrado em</dt><dd>' + U.formatarDataHora(registro.criadoEm) + '</dd></div>' +
        '</dl>' +

        (registro.observacao
          ? '<p style="margin-top:.9rem"><strong>Observações:</strong> ' +
            U.esc(registro.observacao) + '</p>' : '') +
      '</div>' +

      '<div class="grade grade--4 nao-imprimir" style="margin-top:1.2rem">' +
        '<a class="botao" href="#/notificacoes?abrir=' + encodeURIComponent(registro.id) + '">' +
          '📎 Anexar a ficha digitalizada</a>' +
        '<button class="botao botao--secundario" id="botaoImprimirRegistro">🖨 Imprimir</button>' +
        '<button class="botao botao--secundario" id="botaoBaixarBranco">⬇ Ficha em branco</button>' +
        '<a class="botao botao--secundario" href="#/registrar">➕ Novo registro</a>' +
      '</div>';

    U.$('#botaoImprimirRegistro', elemento).addEventListener('click', function () { window.print(); });
    U.$('#botaoBaixarBranco', elemento).addEventListener('click', function () {
      U.entregarFicha(ficha, registro);
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
      return '<label class="opcao">' +
        '<input type="radio" name="destino" value="' + U.esc(d.id) + '" required>' +
        '<span class="opcao__texto"><strong>' + U.esc(d.nome) + '</strong>' +
          '<small>Sigla no relatório: ' + U.esc(d.sigla) + '</small></span></label>';
    }).join('');

    elemento.innerHTML = '' +
      '<div class="pagina__cabecalho">' +
        '<h1 id="t-registrar">Registrar notificação</h1>' +
        '<p>Lance aqui a ficha recebida do médico assistente. Os campos reproduzem o que ' +
           'consta na ficha em papel.</p>' +
      '</div>' +

      '<form id="formRegistro" novalidate>' +

        '<div class="cartao">' +
          '<h2 style="font-size:1.05rem">1 · Agravo notificado</h2>' +
          '<div class="campo">' +
            '<label for="campoFicha">Doença ou agravo <span class="obrigatorio">*</span>' +
              '<span class="campo__dica">⏱ notificação imediata · ⚠ semanal com gatilho imediato</span></label>' +
            '<select id="campoFicha" required>' +
              '<option value="">— selecione —</option>' + opcoesFichas +
            '</select>' +
            '<div class="campo__erro">Selecione o agravo notificado.</div>' +
          '</div>' +
        '</div>' +

        '<div id="painelPrazo"></div>' +

        '<div class="cartao">' +
          '<h2 style="font-size:1.05rem">2 · Atendimento e recebimento</h2>' +
          '<div class="grade grade--2" style="gap:0 1rem">' +
            '<div class="campo">' +
              '<label for="campoData">Data do atendimento <span class="obrigatorio">*</span>' +
                '<span class="campo__dica">Como consta na ficha.</span></label>' +
              '<input type="date" id="campoData" required max="' + U.hoje() + '">' +
              '<div class="campo__erro">Informe a data do atendimento (não pode ser futura).</div>' +
            '</div>' +
            '<div class="campo">' +
              '<label for="campoRecebimento">Recebida no Núcleo em <span class="obrigatorio">*</span>' +
                '<span class="campo__dica">Data em que a ficha chegou. Serve para medir o prazo.</span></label>' +
              '<input type="date" id="campoRecebimento" required max="' + U.hoje() + '" ' +
                     'value="' + U.hoje() + '">' +
              '<div class="campo__erro">Informe a data de recebimento (não anterior ao atendimento).</div>' +
            '</div>' +
          '</div>' +
          '<div id="avisoPrazoCumprido"></div>' +
        '</div>' +

        '<div class="cartao">' +
          '<h2 style="font-size:1.05rem">3 · Paciente</h2>' +
          '<div class="campo">' +
            '<label for="campoPaciente">Nome completo <span class="obrigatorio">*</span></label>' +
            '<input type="text" id="campoPaciente" required autocomplete="off">' +
            '<div class="campo__erro">Informe o nome completo, sem abreviaturas.</div>' +
          '</div>' +
          '<div class="campo">' +
            '<label for="campoProntuario">Prontuário no sistema interno <span class="obrigatorio">*</span></label>' +
            '<input type="text" id="campoProntuario" required autocomplete="off">' +
            '<div class="campo__erro">Informe o número do prontuário.</div>' +
          '</div>' +
          '<div class="campo">' +
            '<label>Destino do paciente <span class="obrigatorio">*</span></label>' +
            '<div class="opcoes">' + opcoesDestino + '</div>' +
            '<div class="campo__erro">Selecione o destino do paciente após o atendimento.</div>' +
          '</div>' +
        '</div>' +

        '<div class="cartao">' +
          '<h2 style="font-size:1.05rem">4 · Médico notificante</h2>' +
          '<div class="campo">' +
            '<label for="campoMedico">Quem preencheu a ficha <span class="obrigatorio">*</span></label>' +
            '<select id="campoMedico" required><option value="">carregando…</option></select>' +
            '<div class="campo__erro">Selecione o médico ou faça o cadastro.</div>' +
          '</div>' +
          '<div class="campo">' +
            '<label for="campoObservacao">Observações do Núcleo (opcional)' +
              '<span class="campo__dica">Vínculo epidemiológico, pendências, contato com o setor ' +
              'de origem, número no Sinan.</span></label>' +
            '<textarea id="campoObservacao"></textarea>' +
          '</div>' +
        '</div>' +

        '<button class="botao botao--grande botao--bloco" type="submit" id="botaoRegistrar">' +
          '✅ Registrar notificação</button>' +
        '<p style="text-align:center;font-size:.83rem;color:var(--texto-suave);margin-top:.7rem">' +
          'Dados pessoais sensíveis de saúde. Trate-os conforme a Lei Geral de Proteção de ' +
          'Dados e o sigilo profissional.</p>' +
      '</form>';

    var select = U.$('#campoFicha', elemento);
    if (fichaEscolhida) { select.value = fichaEscolhida.id; }
    atualizarPainelPrazo(elemento);

    select.addEventListener('change', function () {
      fichaEscolhida = HABE_CATALOGO.porId[select.value] || null;
      atualizarPainelPrazo(elemento);
    });

    elemento.addEventListener('change', function (evento) {
      if (evento.target.id === 'campoData' || evento.target.id === 'campoRecebimento' ||
          evento.target.id === 'gatilhoAplicado') {
        atualizarAvisoDePrazo(elemento);
      }
    });

    var selectMedico = U.$('#campoMedico', elemento);
    preencherMedicos(elemento);
    selectMedico.addEventListener('change', function () {
      if (selectMedico.value === '__novo__') {
        selectMedico.value = '';
        abrirCadastroMedico(function (salvo) { preencherMedicos(elemento, salvo.id); });
      }
    });

    U.$('#formRegistro', elemento).addEventListener('submit', function (evento) {
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
    var campoRecebimento = U.$('#campoRecebimento', elemento);
    var campoPaciente = U.$('#campoPaciente', elemento);
    var campoProntuario = U.$('#campoProntuario', elemento);
    var campoMedico = U.$('#campoMedico', elemento);
    var destinoMarcado = U.$('input[name="destino"]:checked', elemento);

    var ok = true;
    ok = marcar(campoFicha, !campoFicha.value) && ok;
    ok = marcar(campoData, !campoData.value || campoData.value > U.hoje()) && ok;
    ok = marcar(campoRecebimento,
                !campoRecebimento.value || campoRecebimento.value > U.hoje() ||
                (campoData.value && campoRecebimento.value < campoData.value)) && ok;
    ok = marcar(campoPaciente, campoPaciente.value.trim().length < 5) && ok;
    ok = marcar(campoProntuario, campoProntuario.value.trim().length < 1) && ok;
    ok = marcar(campoMedico, !campoMedico.value || campoMedico.value === '__novo__') && ok;

    if (!destinoMarcado) {
      U.$('input[name="destino"]', elemento).closest('.campo').classList.add('campo--invalido');
      ok = false;
    } else {
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
    var avaliacao = avaliarPrazo(ficha, campoData.value, campoRecebimento.value, gatilhoAplicado);

    var registro = {
      fichaId: ficha.id,
      fichaNome: ficha.nome,
      fichaGrupo: ficha.grupo,
      classificacao: ficha.classificacao,
      classificacaoEfetiva: (ficha.classificacao === 'imediata' || gatilhoAplicado)
        ? 'imediata' : ficha.classificacao,
      gatilhoAplicado: gatilhoAplicado,
      dataAtendimento: campoData.value,
      dataRecebimento: campoRecebimento.value,
      dentroDoPrazo: avaliacao ? avaliacao.dentroDoPrazo : null,
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

    var botao = U.$('#botaoRegistrar', elemento);
    botao.disabled = true;
    botao.textContent = 'Registrando…';

    Armazenamento.salvarSolicitacao(registro)
      .then(function (salvo) {
        mostrarConfirmacao(elemento, salvo, ficha);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        App.atualizarContadores();
      })
      .catch(function (erro) {
        botao.disabled = false;
        botao.textContent = '✅ Registrar notificação';
        U.torrada(erro.message, 'erro', 9000);
      });
  }

  return { render: render };
})();
