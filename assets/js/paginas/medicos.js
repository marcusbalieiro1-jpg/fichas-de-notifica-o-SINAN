/* =========================================================================
   HABE SINAN — cadastro dos médicos solicitantes
   ========================================================================= */

var Paginas = Paginas || {};

Paginas.medicos = (function () {
  'use strict';

  var cache = [];
  var solicitacoes = [];

  function contarSolicitacoes(medicoId) {
    return solicitacoes.filter(function (s) { return s.medicoId === medicoId; }).length;
  }

  function ultimaSolicitacao(medicoId) {
    var dele = solicitacoes.filter(function (s) { return s.medicoId === medicoId; })
      .sort(function (a, b) { return String(b.criadoEm).localeCompare(String(a.criadoEm)); });
    return dele.length ? U.formatarData(dele[0].dataAtendimento) : '—';
  }

  /* ---------- formulário ---------- */

  function abrirFormulario(medico, elemento) {
    var m = medico || {};
    var titulo = m.id ? 'Editar cadastro' : 'Novo médico solicitante';

    U.abrirPainel(titulo,
      '<form id="formMedico">' +
        '<div class="campo"><label for="mNome">Nome completo <span class="obrigatorio">*</span></label>' +
          '<input type="text" id="mNome" required value="' + U.esc(m.nome || '') + '"></div>' +
        '<div class="grade grade--2" style="gap:0 1rem">' +
          '<div class="campo"><label for="mCrm">CRM <span class="obrigatorio">*</span></label>' +
            '<input type="text" id="mCrm" required value="' + U.esc(m.crm || '') + '"></div>' +
          '<div class="campo"><label for="mUf">UF do CRM</label>' +
            '<input type="text" id="mUf" maxlength="2" style="text-transform:uppercase" ' +
              'value="' + U.esc(m.uf || '') + '" placeholder="PA"></div>' +
        '</div>' +
        '<div class="grade grade--2" style="gap:0 1rem">' +
          '<div class="campo"><label for="mEspecialidade">Especialidade</label>' +
            '<input type="text" id="mEspecialidade" value="' + U.esc(m.especialidade || '') + '"></div>' +
          '<div class="campo"><label for="mSetor">Setor de atuação</label>' +
            '<input type="text" id="mSetor" value="' + U.esc(m.setor || '') + '" ' +
              'placeholder="Pronto Atendimento, UI1, UI2, UTI…"></div>' +
        '</div>' +
        '<div class="grade grade--2" style="gap:0 1rem">' +
          '<div class="campo"><label for="mTelefone">Telefone</label>' +
            '<input type="tel" id="mTelefone" value="' + U.esc(m.telefone || '') + '"></div>' +
          '<div class="campo"><label for="mEmail">E-mail</label>' +
            '<input type="email" id="mEmail" value="' + U.esc(m.email || '') + '"></div>' +
        '</div>' +
        '<div class="campo">' +
          '<label class="opcao"><input type="checkbox" id="mAtivo"' +
            (m.ativo === false ? '' : ' checked') + '>' +
            '<span class="opcao__texto"><strong>Cadastro ativo</strong>' +
            '<small>Cadastros inativos deixam de aparecer na lista de solicitação, ' +
            'mas o histórico é preservado.</small></span></label>' +
        '</div>' +
        '<button class="botao botao--bloco botao--grande" type="submit">Salvar</button>' +
      '</form>',
      function () {
        U.$('#formMedico').addEventListener('submit', function (evento) {
          evento.preventDefault();
          var nome = U.$('#mNome').value.trim();
          var crm = U.$('#mCrm').value.trim();
          if (nome.length < 5 || !crm) {
            U.torrada('Informe o nome completo e o CRM.', 'erro');
            return;
          }
          var registro = {
            id: m.id,
            nome: nome,
            crm: crm,
            uf: U.$('#mUf').value.trim().toUpperCase(),
            especialidade: U.$('#mEspecialidade').value.trim(),
            setor: U.$('#mSetor').value.trim(),
            telefone: U.$('#mTelefone').value.trim(),
            email: U.$('#mEmail').value.trim(),
            ativo: U.$('#mAtivo').checked,
            criadoEm: m.criadoEm
          };
          Armazenamento.salvarMedico(registro).then(function () {
            U.fecharPainel();
            U.torrada('Cadastro salvo.', 'sucesso');
            carregar(elemento);
          }).catch(function (erro) { U.torrada(erro.message, 'erro'); });
        });
      });
  }

  /* ---------- tabela ---------- */

  function desenhar(elemento) {
    var termo = U.normalizar(U.$('#buscaMedico', elemento).value);
    var lista = cache.filter(function (m) {
      if (!termo) { return true; }
      return U.normalizar([m.nome, m.crm, m.especialidade, m.setor].join(' ')).indexOf(termo) >= 0;
    }).sort(U.ordenarPorNome);

    var corpo = U.$('#corpoMedicos', elemento);
    if (lista.length === 0) {
      corpo.innerHTML = '<tr><td colspan="6" class="tabela__vazia">' +
        (cache.length === 0
          ? 'Nenhum médico cadastrado. Use o botão “Novo médico” acima — ' +
            'o cadastro também pode ser feito na hora da primeira solicitação.'
          : 'Nenhum cadastro corresponde à busca.') + '</td></tr>';
    } else {
      corpo.innerHTML = lista.map(function (m) {
        return '<tr data-id="' + U.esc(m.id) + '" style="cursor:pointer">' +
          '<td><strong>' + U.esc(m.nome) + '</strong>' +
            (m.ativo === false ? ' <span class="selo selo--neutro">inativo</span>' : '') +
            (m.especialidade ? '<br><small style="color:var(--texto-suave)">' +
              U.esc(m.especialidade) + '</small>' : '') + '</td>' +
          '<td>' + U.esc(m.crm) + (m.uf ? '/' + U.esc(m.uf) : '') + '</td>' +
          '<td>' + U.esc(m.setor || '—') + '</td>' +
          '<td>' + U.esc(m.telefone || m.email || '—') + '</td>' +
          '<td style="text-align:right"><strong>' + contarSolicitacoes(m.id) + '</strong></td>' +
          '<td>' + ultimaSolicitacao(m.id) + '</td>' +
        '</tr>';
      }).join('');
    }

    var ativos = cache.filter(function (m) { return m.ativo !== false; }).length;
    U.$('#resumoMedicos', elemento).innerHTML =
      '<strong>' + cache.length + '</strong> cadastros · <strong>' + ativos + '</strong> ativos';
  }

  function carregar(elemento) {
    return Promise.all([Armazenamento.listarMedicos(), Armazenamento.listarSolicitacoes()])
      .then(function (resultados) {
        cache = resultados[0] || [];
        solicitacoes = resultados[1] || [];
        desenhar(elemento);
      })
      .catch(function (erro) {
        U.$('#corpoMedicos', elemento).innerHTML =
          '<tr><td colspan="6" class="tabela__vazia">' + U.esc(erro.message) + '</td></tr>';
      });
  }

  function exportar() {
    var linhas = [['Nome', 'CRM', 'UF', 'Especialidade', 'Setor', 'Telefone', 'E-mail',
                   'Situação', 'Solicitações', 'Última solicitação', 'Cadastrado em']];
    cache.slice().sort(U.ordenarPorNome).forEach(function (m) {
      linhas.push([m.nome, m.crm, m.uf, m.especialidade, m.setor, m.telefone, m.email,
                   m.ativo === false ? 'Inativo' : 'Ativo',
                   contarSolicitacoes(m.id), ultimaSolicitacao(m.id),
                   U.formatarDataHora(m.criadoEm)]);
    });
    U.baixarCsv('habe-sinan-medicos-' + U.hoje() + '.csv', linhas);
    U.torrada('Cadastro exportado.', 'sucesso');
  }

  /* ---------- página ---------- */

  function render(elemento) {
    elemento.innerHTML = '' +
      '<div class="pagina__cabecalho">' +
        '<h1 id="t-medicos">Médicos solicitantes</h1>' +
        '<p>Cadastro breve, feito uma única vez. Depois disso, basta escolher o nome ' +
           'na hora de solicitar a ficha.</p>' +
      '</div>' +

      '<div class="cartao nao-imprimir">' +
        '<div class="cartao__titulo">' +
          '<div class="busca-fichas" style="flex:1 1 260px;margin:0">' +
            '<label class="so-leitor-tela" for="buscaMedico">Buscar médico</label>' +
            '<input type="search" id="buscaMedico" placeholder="Buscar por nome, CRM, setor…">' +
          '</div>' +
          '<div style="display:flex;gap:.5rem">' +
            '<button class="botao" id="botaoNovoMedico" type="button">➕ Novo médico</button>' +
            '<button class="botao botao--secundario" id="botaoExportarMedicos" type="button">' +
              '⬇ CSV</button>' +
          '</div>' +
        '</div>' +
        '<p style="margin:0;font-size:.88rem;color:var(--texto-suave)" id="resumoMedicos"></p>' +
      '</div>' +

      '<div class="cartao" style="padding:0;overflow:hidden">' +
        '<div class="tabela-rolagem">' +
          '<table class="tabela">' +
            '<thead><tr><th>Nome</th><th>CRM</th><th>Setor</th><th>Contato</th>' +
              '<th style="text-align:right">Solicitações</th><th>Última</th></tr></thead>' +
            '<tbody id="corpoMedicos">' +
              '<tr><td colspan="6" class="tabela__vazia">Carregando…</td></tr></tbody>' +
          '</table>' +
        '</div>' +
      '</div>' +

      '<p style="font-size:.83rem;color:var(--texto-suave)">' +
        'Clique em qualquer linha para editar o cadastro.</p>';

    U.$('#buscaMedico', elemento).addEventListener('input', function () { desenhar(elemento); });
    U.$('#botaoNovoMedico', elemento).addEventListener('click', function () {
      abrirFormulario(null, elemento);
    });
    U.$('#botaoExportarMedicos', elemento).addEventListener('click', exportar);
    U.$('#corpoMedicos', elemento).addEventListener('click', function (evento) {
      var tr = evento.target.closest('tr[data-id]');
      if (!tr) { return; }
      var medico = cache.filter(function (m) { return m.id === tr.getAttribute('data-id'); })[0];
      if (medico) { abrirFormulario(medico, elemento); }
    });

    carregar(elemento);
  }

  return { render: render };
})();
