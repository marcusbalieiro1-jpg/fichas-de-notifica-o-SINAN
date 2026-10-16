/* =========================================================================
   HABE – AQS e NSP — Plano de Atividades
   O "documento" do plano, sempre gerado do banco: não existe um arquivo
   do plano para ficar desatualizado. Quem muda o plano muda as
   atividades (#/atividades); esta página só as apresenta no formato do
   documento institucional — recorrentes e permanentes, sob demanda e
   pontuais —, com filtro por setor e a opção de incluir as arquivadas.

   Saídas: imprimir / salvar em PDF (A4, cabeçalho com o brasão), baixar em
   Word (.doc — HTML com o cabeçalho do Office, que o Word abre e edita) e
   baixar a planilha (CSV). O .doc leva estilos INLINE: ele não é exibido
   por esta página, então a CSP não se aplica a ele (ARQUITETURA §1, CSP).
   Ver docs/ARQUITETURA.md, seções 3, 5 e 6.
   ========================================================================= */

Paginas.plano = (function () {
  'use strict';

  var CHAVE_FILTROS = 'aqs_plano_filtros';
  var TABELAS = ['atividades', 'atividade_responsaveis', 'ocorrencias', 'militares', 'setores'];
  /* Acima disso, a situação das pontuais vem de uma consulta só (todas as
     ocorrências) em vez de uma por atividade. */
  var LIMITE_CONSULTAS = 25;
  var ID_VALIDO = /^[0-9A-Za-z_-]{1,64}$/;
  var LOCAL = 'Belém';
  var CARGO_CHEFIA = 'Chefia da Assessoria de Qualidade e Segurança / Núcleo de Segurança do Paciente';

  var SECOES = [
    { tipo: 'recorrente', titulo: '1. Atividades recorrentes e permanentes',
      vazio: 'Nenhuma atividade recorrente cadastrada.' },
    { tipo: 'sob_demanda', titulo: '2. Atividades sob demanda',
      vazio: 'Nenhuma atividade sob demanda cadastrada.' },
    { tipo: 'pontual', titulo: '3. Atividades pontuais',
      vazio: 'Nenhuma atividade pontual cadastrada.' }
  ];

  var geracao = 0;
  var carga = 0;
  var filtros = null;  /* { setor, arquivadas } */
  /* Últimos dados: { atividades, ref, situacoes: { atividade_id: VOcorrencia }, hoje } */
  var dados = null;

  /* ---------- auxiliares ---------- */

  function icone(nome) {
    return '<svg class="icone" aria-hidden="true" focusable="false"><use href="#i-' + nome + '"></use></svg>';
  }

  function temPropria(objeto, chave) {
    return !!objeto && Object.prototype.hasOwnProperty.call(objeto, chave);
  }

  function contem(lista, valor) {
    return Array.isArray(lista) && lista.indexOf(valor) >= 0;
  }

  function vigente(el, minhaGeracao, minhaCarga) {
    return minhaGeracao === geracao && (minhaCarga === undefined || minhaCarga === carga) &&
      !!App.militar() && !el.classList.contains('oculto') && !!U.$('.pagina-plano', el);
  }

  function dataPorExtenso(data) {
    var p = String(data).split('-');
    return Number(p[2]) + ' de ' + U.MESES[Number(p[1]) - 1] + ' de ' + p[0];
  }

  /* ---------- filtros ---------- */

  function lerFiltros(params) {
    var f = { setor: '', arquivadas: false };
    try {
      var salvo = JSON.parse(window.sessionStorage.getItem(CHAVE_FILTROS) || 'null');
      if (salvo && typeof salvo === 'object') {
        if (typeof salvo.setor === 'string' && (salvo.setor === 'sem' || ID_VALIDO.test(salvo.setor))) { f.setor = salvo.setor; }
        f.arquivadas = salvo.arquivadas === true;
      }
    } catch (e) { /* sem armazenamento: padrões */ }
    if (params && params.setor && (params.setor === 'sem' || ID_VALIDO.test(params.setor))) { f.setor = params.setor; }
    return f;
  }

  function gravarFiltros() {
    try { window.sessionStorage.setItem(CHAVE_FILTROS, JSON.stringify(filtros)); } catch (e) { /* vale só agora */ }
  }

  /* ---------- modelo do documento (tela, Word e CSV usam o mesmo) ---------- */

  function setorDe(id) {
    return id && temPropria(dados.ref.mapaSetores, id) ? dados.ref.mapaSetores[id] : null;
  }

  function regraTexto(a) {
    var texto = Regras.descreverRegra(a);
    if (a.tipo === 'recorrente' && a.data_inicio && a.data_inicio > dados.hoje) {
      texto += ' — a partir de ' + U.formatarData(a.data_inicio);
    }
    return texto;
  }

  /* Situação de uma pontual pela sua ocorrência única ('P'). */
  function situacao(a) {
    if (a.ativa === false) { return { texto: 'Arquivada', classe: 'neutro' }; }
    var oc = dados.situacoes[a.id];
    if (!oc) { return { texto: '—', classe: 'neutro' }; }
    var status = Regras.statusEfetivo(oc, dados.hoje);
    if (status === 'concluida') {
      var quando = oc.concluida_em ? U.formatarDataHora(oc.concluida_em).slice(0, 10) : '';
      return { texto: 'Concluída' + (quando ? ' em ' + quando : ''), classe: 'concluida', status: status };
    }
    return { texto: Regras.ROTULOS.status[status] || status, classe: status, status: status };
  }

  function chefias() {
    return (dados.ref.militares || []).filter(function (m) { return m && m.ativo !== false && m.papel === 'chefia'; })
      .sort(function (a, b) { return U.ordenarTexto(Regras.nomeMilitar(a), Regras.nomeMilitar(b)); });
  }

  /* 'FULANO DE TAL – Maj' (nome completo, se houver), como nas assinaturas. */
  function nomeAssinatura(m) {
    var completo = String(m.nome_completo || '').trim();
    if (completo) { return completo.toUpperCase() + (m.posto ? ' – ' + m.posto : ''); }
    return Regras.nomeMilitar(m);
  }

  function modelo() {
    var visiveis = dados.atividades.filter(function (a) {
      if (!filtros.arquivadas && a.ativa === false) { return false; }
      if (filtros.setor === 'sem') { return !a.setor_id; }
      if (filtros.setor) { return a.setor_id === filtros.setor; }
      return true;
    }).sort(function (a, b) {
      var oa = Number(a.ordem) || 0, ob = Number(b.ordem) || 0;
      return (oa - ob) || U.ordenarTexto(a.titulo, b.titulo);
    });
    var ultima = null;
    visiveis.forEach(function (a) {
      var t = a.atualizado_em || a.criado_em;
      if (t && (!ultima || t > ultima)) { ultima = t; }
    });
    var setor = filtros.setor && filtros.setor !== 'sem' ? setorDe(filtros.setor) : null;
    return {
      secoes: SECOES.map(function (s) {
        return {
          tipo: s.tipo, titulo: s.titulo, vazio: s.vazio,
          itens: visiveis.filter(function (a) { return a.tipo === s.tipo; }).map(function (a) {
            return {
              atividade: a,
              numero: a.ordem === null || a.ordem === undefined ? '—' : String(a.ordem),
              titulo: a.titulo,
              detalhamento: String(a.descricao || ''),
              regra: regraTexto(a),
              prazo: a.prazo ? U.formatarData(a.prazo) : 'Sem prazo definido',
              situacao: s.tipo === 'pontual' ? situacao(a) : null,
              responsaveis: Regras.nomesResponsaveis(a.responsaveis, dados.ref.mapaMilitares),
              arquivada: a.ativa === false
            };
          })
        };
      }),
      total: visiveis.length,
      atualizadoEm: ultima ? U.formatarDataHora(ultima).slice(0, 10) : U.formatarData(dados.hoje),
      filtroSetor: filtros.setor === 'sem' ? 'Atividades sem setor' : (setor ? 'Setor: ' + setor.sigla + ' — ' + setor.nome : ''),
      incluiArquivadas: filtros.arquivadas,
      dataExtenso: dataPorExtenso(dados.hoje),
      chefias: chefias()
    };
  }

  /* ---------- página ---------- */

  function render(el, params) {
    geracao += 1;
    dados = null;
    filtros = lerFiltros(params);
    var eu = App.militar();
    var gestor = Regras.eGestor(eu);
    el.innerHTML = '<div class="pagina-plano">' +
      '<div class="pagina__cabecalho pagina__cabecalho--acoes nao-imprimir">' +
        '<div><h1>Plano de Atividades</h1>' +
          '<p>Gerado do cadastro de atividades — está sempre atualizado. Para mudar o plano, edite as atividades.</p></div>' +
        '<div class="acoes acoes--topo">' +
          '<a class="botao botao--secundario" href="#/atividades">' + icone('atividades') + (gestor ? 'Editar atividades' : 'Ver atividades') + '</a>' +
          '<button type="button" class="botao botao--secundario" data-acao="imprimir">Imprimir / PDF</button>' +
          '<button type="button" class="botao botao--secundario" data-acao="word">Baixar Word (.doc)</button>' +
          '<button type="button" class="botao botao--secundario" data-acao="csv">Baixar planilha (CSV)</button>' +
        '</div>' +
      '</div>' +
      '<div class="cartao filtros-gestao filtros-gestao--linha nao-imprimir">' +
        '<label class="campo campo--compacto"><span class="campo__rotulo">Setor</span>' +
          '<select id="planoSetor"><option value="">Todos os setores</option></select></label>' +
        '<label class="marcar marcar--linha marcar--compacto">' +
          '<input type="checkbox" id="planoArquivadas"' + (filtros.arquivadas ? ' checked' : '') + '>' +
          '<span class="marcar__texto"><strong>Incluir arquivadas</strong></span></label>' +
        '<span class="texto-pequeno texto-suave cresce alinhar-direita" id="planoResumo"></span>' +
      '</div>' +
      '<div id="planoDocumento"><div class="carregando" role="status">Montando o plano…</div></div>' +
      '<div class="rodape-impressao" data-rodape-plano></div>' +
    '</div>';
    ligar(el);
    carregar(el);
  }

  function aoVivo(el, params, tabelas) {
    if (Array.isArray(tabelas) && !tabelas.some(function (t) { return contem(TABELAS, t); })) { return; }
    if (!U.$('.pagina-plano', el) || !filtros) { render(el, params); return; }
    carregar(el);
  }

  /* Ocorrência que define a situação de cada pontual: a 'P' (a única
     gerada pelo banco) ou, na falta dela, a mais recente. */
  function buscarSituacoes(atividades) {
    var pontuais = atividades.filter(function (a) { return a.tipo === 'pontual'; });
    if (!pontuais.length) { return Promise.resolve({}); }
    var ids = {};
    pontuais.forEach(function (a) { ids[a.id] = true; });
    var consulta = pontuais.length <= LIMITE_CONSULTAS
      ? Promise.all(pontuais.map(function (a) { return Api.listarOcorrencias({ atividade_id: a.id }); })).then(function (listas) {
        return listas.reduce(function (todas, l) { return todas.concat(l || []); }, []);
      })
      : Api.listarOcorrencias({});
    return consulta.then(function (lista) {
      var mapa = {};
      (lista || []).forEach(function (oc) {
        if (!ids[oc.atividade_id]) { return; }
        var atual = mapa[oc.atividade_id];
        if (!atual || (oc.referencia === 'P' && atual.referencia !== 'P') ||
            (oc.referencia === atual.referencia && String(oc.criado_em) > String(atual.criado_em))) {
          mapa[oc.atividade_id] = oc;
        }
      });
      return mapa;
    });
  }

  function carregar(el) {
    var minhaGeracao = geracao;
    var minhaCarga = ++carga;
    var base;
    Promise.all([Api.listarAtividades(), Api.referencias()]).then(function (r) {
      base = r;
      return buscarSituacoes(r[0] || []);
    }).then(function (situacoes) {
      if (!vigente(el, minhaGeracao, minhaCarga)) { return; }
      dados = { atividades: base[0] || [], ref: base[1], situacoes: situacoes, hoje: U.hojeBelem() };
      preencherSetores(el);
      desenhar(el);
    }).catch(function (erro) {
      if (!vigente(el, minhaGeracao, minhaCarga)) { return; }
      U.falha(erro);
      if (dados) { return; }
      U.$('#planoDocumento', el).innerHTML = '<div class="aviso aviso--urgente" role="alert"><span class="aviso__icone">' +
        icone('alerta') + '</span><div><strong>Não foi possível montar o plano</strong>' + U.esc(U.erroTexto(erro)) +
        '</div></div><div class="acoes nao-imprimir"><button type="button" class="botao botao--secundario" data-acao="tentar">' +
        'Tentar novamente</button></div>';
    });
  }

  function preencherSetores(el) {
    var sel = U.$('#planoSetor', el);
    var setores = dados.ref.setores || [];
    if (filtros.setor && filtros.setor !== 'sem' && !temPropria(dados.ref.mapaSetores, filtros.setor)) { filtros.setor = ''; }
    sel.innerHTML = '<option value="">Todos os setores</option>' + setores.map(function (s) {
      return '<option value="' + U.esc(s.id) + '"' + (filtros.setor === s.id ? ' selected' : '') + '>' +
        U.esc(s.sigla + ' — ' + s.nome) + '</option>';
    }).join('') + '<option value="sem"' + (filtros.setor === 'sem' ? ' selected' : '') + '>Sem setor</option>';
  }

  /* ---------- documento na tela ---------- */

  function celula(rotulo, html, classe) {
    return '<td data-rotulo="' + U.esc(rotulo) + '"' + (classe ? ' class="' + classe + '"' : '') + '>' + html + '</td>';
  }

  function secaoHtml(secao) {
    var pontual = secao.tipo === 'pontual';
    var colunas = pontual
      ? ['Nº', 'Atividade', 'Detalhamento', 'Prazo', 'Situação', 'Responsável']
      : ['Nº', 'Atividade', 'Detalhamento', 'Periodicidade / prazo', 'Responsável'];
    var corpo;
    if (!secao.itens.length) {
      corpo = '<tr><td colspan="' + colunas.length + '" class="tabela__vazia">' + U.esc(secao.vazio) + '</td></tr>';
    } else {
      corpo = secao.itens.map(function (item) {
        var titulo = '<strong>' + U.esc(item.titulo) + '</strong>' +
          (item.arquivada ? ' <span class="selo selo--neutro selo--pequeno">Arquivada</span>' : '');
        var detalhamento = item.detalhamento.trim() ? U.escMultilinha(item.detalhamento) : '<span class="texto-suave">—</span>';
        var linha = '<tr class="linha-clicavel' + (item.arquivada ? ' linha-clicavel--arquivada' : '') +
            '" data-atividade="' + U.esc(item.atividade.id) + '" tabindex="0" title="Abrir o detalhe da atividade">' +
          celula('Nº', U.esc(item.numero), 'col-numero') +
          celula('Atividade', titulo, 'col-principal') +
          celula('Detalhamento', detalhamento, 'col-detalhamento');
        if (pontual) {
          linha += celula('Prazo', U.esc(item.prazo)) +
            celula('Situação', '<span class="situacao-plano situacao-plano--' + U.esc(item.situacao.classe) + '">' +
              U.esc(item.situacao.texto) + '</span>');
        } else {
          linha += celula('Periodicidade / prazo', U.esc(item.regra));
        }
        return linha + celula('Responsável', U.esc(item.responsaveis)) + '</tr>';
      }).join('');
    }
    return '<section class="documento-plano__secao">' +
      '<h3 class="documento-plano__secao-titulo">' + U.esc(secao.titulo) + '</h3>' +
      '<div class="tabela-rolagem"><table class="tabela-documento tabela-cartoes">' +
        '<thead><tr>' + colunas.map(function (c) { return '<th scope="col">' + U.esc(c) + '</th>'; }).join('') + '</tr></thead>' +
        '<tbody>' + corpo + '</tbody>' +
      '</table></div>' +
    '</section>';
  }

  function assinaturaHtml(m) {
    var lista = m.chefias.length ? m.chefias : [null];
    return '<footer class="documento-plano__assinatura">' +
      '<p class="documento-plano__local">' + U.esc(LOCAL + ', ' + m.dataExtenso + '.') + '</p>' +
      '<div class="documento-plano__assinantes">' + lista.map(function (c) {
        return '<div class="documento-plano__assinante">' +
          '<span class="documento-plano__linha" aria-hidden="true"></span>' +
          '<strong>' + U.esc(c ? nomeAssinatura(c) : '') + '</strong>' +
          '<span>' + U.esc(CARGO_CHEFIA) + '</span>' +
        '</div>';
      }).join('') + '</div>' +
    '</footer>';
  }

  function documentoHtml(m) {
    return '<article class="documento-plano" aria-label="Plano de Atividades">' +
      '<header class="documento-plano__cabecalho">' +
        '<img class="documento-plano__brasao" src="assets/img/logo-habe.svg" alt="Brasão do Hospital de Aeronáutica de Belém" width="60" height="72">' +
        '<p class="documento-plano__orgao">COMANDO DA AERONÁUTICA</p>' +
        '<p class="documento-plano__orgao">HOSPITAL DE AERONÁUTICA DE BELÉM</p>' +
        '<p class="documento-plano__setor">ASSESSORIA DE QUALIDADE E SEGURANÇA · NÚCLEO DE SEGURANÇA DO PACIENTE</p>' +
        '<h2 class="documento-plano__titulo">PLANO DE ATIVIDADES</h2>' +
        '<p class="documento-plano__data">Atualizado em ' + U.esc(m.atualizadoEm) +
          (m.filtroSetor ? ' · ' + U.esc(m.filtroSetor) : '') +
          (m.incluiArquivadas ? ' · inclui atividades arquivadas' : '') + '</p>' +
      '</header>' +
      m.secoes.map(secaoHtml).join('') +
      assinaturaHtml(m) +
    '</article>';
  }

  function desenhar(el) {
    if (!dados) { return; }
    var m = modelo();
    var resumo = U.$('#planoResumo', el);
    resumo.textContent = m.total === 1 ? '1 atividade no plano' : m.total + ' atividades no plano';
    var caixa = U.$('#planoDocumento', el);
    if (!dados.atividades.length) {
      caixa.innerHTML = '<div class="vazio"><span class="vazio__icone">' + icone('plano') + '</span>' +
        '<strong>O plano ainda está vazio</strong>' +
        '<p>O plano é montado a partir das atividades cadastradas. Cadastre as atividades do setor e ele aparece aqui, ' +
          'pronto para imprimir.</p>' +
        '<a class="botao" href="#/atividades">Ir para Atividades</a></div>';
      return;
    }
    caixa.innerHTML = documentoHtml(m);
  }

  /* ---------- Word (.doc) ---------- */

  /* Estilos INLINE de propósito: o Word não lê folhas de estilo externas e
     o arquivo não é renderizado por esta página (a CSP não se aplica). */
  var W = {
    corpo: 'font-family:Arial,sans-serif;font-size:11pt;color:#000;',
    centro: 'text-align:center;margin:0;font-family:Arial,sans-serif;font-size:11pt;font-weight:bold;',
    titulo: 'text-align:center;margin:14pt 0 4pt;font-family:Arial,sans-serif;font-size:14pt;font-weight:bold;',
    data: 'text-align:center;margin:0 0 14pt;font-family:Arial,sans-serif;font-size:10pt;',
    secao: 'margin:14pt 0 6pt;font-family:Arial,sans-serif;font-size:12pt;font-weight:bold;',
    tabela: 'border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:11pt;',
    th: 'border:1px solid #000;padding:4pt;background:#d9e2f3;font-weight:bold;text-align:left;vertical-align:top;',
    td: 'border:1px solid #000;padding:4pt;vertical-align:top;',
    tdNum: 'border:1px solid #000;padding:4pt;vertical-align:top;text-align:center;width:28pt;',
    assinatura: 'text-align:center;margin:0;font-family:Arial,sans-serif;font-size:11pt;',
    local: 'text-align:right;margin:24pt 0 36pt;font-family:Arial,sans-serif;font-size:11pt;'
  };

  function docSecao(secao) {
    var pontual = secao.tipo === 'pontual';
    var colunas = pontual
      ? ['Nº', 'Atividade', 'Detalhamento', 'Prazo', 'Situação', 'Responsável']
      : ['Nº', 'Atividade', 'Detalhamento', 'Periodicidade / prazo', 'Responsável'];
    var linhas = !secao.itens.length
      ? '<tr><td colspan="' + colunas.length + '" style="' + W.td + 'text-align:center;font-style:italic;">' + U.esc(secao.vazio) + '</td></tr>'
      : secao.itens.map(function (item) {
        var linha = '<tr>' +
          '<td style="' + W.tdNum + '">' + U.esc(item.numero) + '</td>' +
          '<td style="' + W.td + '"><b>' + U.esc(item.titulo) + '</b>' + (item.arquivada ? ' <i>(arquivada)</i>' : '') + '</td>' +
          '<td style="' + W.td + '">' + (item.detalhamento.trim() ? U.escMultilinha(item.detalhamento) : '—') + '</td>';
        if (pontual) {
          linha += '<td style="' + W.td + '">' + U.esc(item.prazo) + '</td><td style="' + W.td + '">' + U.esc(item.situacao.texto) + '</td>';
        } else {
          linha += '<td style="' + W.td + '">' + U.esc(item.regra) + '</td>';
        }
        return linha + '<td style="' + W.td + '">' + U.esc(item.responsaveis) + '</td></tr>';
      }).join('');
    return '<p style="' + W.secao + '">' + U.esc(secao.titulo) + '</p>' +
      '<table style="' + W.tabela + '" cellspacing="0" cellpadding="0">' +
        '<thead><tr>' + colunas.map(function (c) { return '<th style="' + W.th + '">' + U.esc(c) + '</th>'; }).join('') + '</tr></thead>' +
        '<tbody>' + linhas + '</tbody>' +
      '</table>';
  }

  function documentoWord(m) {
    var assinantes = (m.chefias.length ? m.chefias : [null]).map(function (c) {
      return '<p style="' + W.assinatura + 'margin-top:30pt;">______________________________________</p>' +
        '<p style="' + W.assinatura + 'font-weight:bold;">' + U.esc(c ? nomeAssinatura(c) : '') + '</p>' +
        '<p style="' + W.assinatura + '">' + U.esc(CARGO_CHEFIA) + '</p>';
    }).join('');
    return '﻿<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" ' +
        'xmlns="http://www.w3.org/TR/REC-html40">' +
      '<head><meta charset="utf-8"><meta http-equiv="Content-Type" content="text/html; charset=utf-8">' +
        '<title>Plano de Atividades — AQS e NSP</title>' +
        '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom>' +
          '<w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->' +
        '<style>@page Secao1 { size: 21cm 29.7cm; margin: 2cm 1.5cm 2cm 2cm; } div.Secao1 { page: Secao1; } ' +
          'body { font-family: Arial, sans-serif; font-size: 11pt; } table { border-collapse: collapse; } ' +
          'td, th { border: 1px solid #000; }</style>' +
      '</head>' +
      '<body style="' + W.corpo + '"><div class="Secao1">' +
        '<p style="' + W.centro + '">COMANDO DA AERONÁUTICA</p>' +
        '<p style="' + W.centro + '">HOSPITAL DE AERONÁUTICA DE BELÉM</p>' +
        '<p style="' + W.centro + 'font-weight:normal;font-size:10pt;">ASSESSORIA DE QUALIDADE E SEGURANÇA · NÚCLEO DE SEGURANÇA DO PACIENTE</p>' +
        '<p style="' + W.titulo + '">PLANO DE ATIVIDADES</p>' +
        '<p style="' + W.data + '">Atualizado em ' + U.esc(m.atualizadoEm) +
          (m.filtroSetor ? ' · ' + U.esc(m.filtroSetor) : '') + (m.incluiArquivadas ? ' · inclui atividades arquivadas' : '') + '</p>' +
        m.secoes.map(docSecao).join('') +
        '<p style="' + W.local + '">' + U.esc(LOCAL + ', ' + m.dataExtenso + '.') + '</p>' +
        assinantes +
      '</div></body></html>';
  }

  function baixarWord() {
    if (!dados) { U.torrada('Aguarde o plano terminar de carregar.', 'atencao'); return; }
    U.baixarConteudo('Plano-de-Atividades-NSP-' + dados.hoje + '.doc', documentoWord(modelo()), 'application/msword');
    U.torrada('Plano baixado em Word. Abra no Word ou no LibreOffice para editar ou imprimir.', 'sucesso', 6000);
  }

  /* ---------- planilha (CSV) ---------- */

  function baixarCsv() {
    if (!dados) { U.torrada('Aguarde o plano terminar de carregar.', 'atencao'); return; }
    var m = modelo();
    var linhas = [['Seção', 'Nº', 'Atividade', 'Detalhamento', 'Periodicidade / prazo', 'Situação', 'Responsável', 'Setor',
      'Prioridade', 'Exige evidência', 'Arquivada']];
    m.secoes.forEach(function (secao) {
      secao.itens.forEach(function (item) {
        var a = item.atividade;
        var setor = setorDe(a.setor_id);
        linhas.push([
          secao.titulo.replace(/^\d+\.\s*/, ''), item.numero === '—' ? '' : item.numero, item.titulo, item.detalhamento,
          secao.tipo === 'pontual' ? 'Prazo: ' + item.prazo : item.regra,
          item.situacao ? item.situacao.texto : '', item.responsaveis, setor ? setor.sigla : '',
          Regras.ROTULOS.prioridade[a.prioridade] || a.prioridade || '', a.exige_evidencia ? 'Sim' : 'Não',
          item.arquivada ? 'Sim' : 'Não'
        ]);
      });
    });
    U.baixarCsv('Plano-de-Atividades-NSP-' + dados.hoje + '.csv', linhas);
    U.torrada('Planilha do plano baixada.', 'sucesso');
  }

  /* Rodapé do papel: quem imprimiu e quando (preenchido na hora). */
  function prepararRodape() {
    var rodape = U.$('#pagina-plano [data-rodape-plano]');
    var eu = App.militar();
    if (!rodape || !eu) { return; }
    rodape.textContent = 'Impresso por ' + Regras.nomeMilitar(eu) + ' em ' + U.formatarDataHora(new Date().toISOString()) +
      ' — documento de uso interno.';
  }

  window.addEventListener('beforeprint', prepararRodape);

  /* ---------- eventos ---------- */

  function abrirDetalhe(id) {
    if (!id || !ID_VALIDO.test(id)) { return; }
    if (typeof Detalhe === 'undefined' || !Detalhe) {
      U.torrada('Não foi possível abrir o detalhe: o módulo não carregou. Recarregue a página.', 'erro');
      return;
    }
    Detalhe.abrirAtividade(id);
  }

  function ligar(el) {
    var raiz = U.$('.pagina-plano', el);
    raiz.addEventListener('click', function (evento) {
      var alvo = evento.target;
      if (!alvo || !alvo.closest) { return; }
      var acao = alvo.closest('[data-acao]');
      if (acao) {
        var qual = acao.getAttribute('data-acao');
        if (qual === 'imprimir') {
          if (!dados) { U.torrada('Aguarde o plano terminar de carregar.', 'atencao'); return; }
          prepararRodape();
          window.print();
        } else if (qual === 'word') { baixarWord(); }
        else if (qual === 'csv') { baixarCsv(); }
        else if (qual === 'tentar') { carregar(el); }
        return;
      }
      var linha = alvo.closest('tr[data-atividade]');
      if (linha) { abrirDetalhe(linha.getAttribute('data-atividade')); }
    });
    raiz.addEventListener('keydown', function (evento) {
      if (evento.key !== 'Enter' && evento.key !== ' ') { return; }
      var linha = evento.target && evento.target.closest ? evento.target.closest('tr[data-atividade]') : null;
      if (linha && evento.target === linha) {
        evento.preventDefault();
        abrirDetalhe(linha.getAttribute('data-atividade'));
      }
    });
    raiz.addEventListener('change', function (evento) {
      var alvo = evento.target;
      if (!alvo) { return; }
      if (alvo.id === 'planoSetor') { filtros.setor = alvo.value; }
      else if (alvo.id === 'planoArquivadas') { filtros.arquivadas = !!alvo.checked; }
      else { return; }
      gravarFiltros();
      desenhar(el);
    });
  }

  return {
    titulo: 'Plano de Atividades',
    render: render,
    aoVivo: aoVivo
  };
})();
