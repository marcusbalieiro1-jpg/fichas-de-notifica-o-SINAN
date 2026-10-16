/* =========================================================================
   HABE – AQS e NSP — página "Minha conta"
   Perfil (somente leitura: quem mantém o cadastro são os gestores, em
   Equipe), troca de senha, verificação em duas etapas (TOTP), tema e
   "sair de todos os dispositivos".

   A verificação em duas etapas da conta institucional da AQS merece
   cuidado especial: se o aplicativo autenticador ficar no celular pessoal
   de quem sair do HABE, a conta que garante a continuidade fica trancada.
   Por isso a página orienta a guardar a chave de configuração conforme o
   manual de continuidade (docs/CONTINUIDADE.md).
   ========================================================================= */

Paginas.conta = (function () {
  'use strict';

  /* Cresce a cada render: respostas atrasadas de um render anterior (ou de
     outra sessão) não escrevem na página. */
  var geracao = 0;

  function icone(nome) {
    return '<svg class="icone" aria-hidden="true" focusable="false"><use href="#i-' + nome + '"></use></svg>';
  }

  function aviso(tipo, simbolo, titulo, textoHtml) {
    return '<div class="aviso' + (tipo ? ' aviso--' + tipo : '') + '">' +
      '<span class="aviso__icone">' + icone(simbolo) + '</span>' +
      '<div>' + (titulo ? '<strong>' + U.esc(titulo) + '</strong>' : '') + textoHtml + '</div>' +
    '</div>';
  }

  function vigente(minhaGeracao, el) {
    return minhaGeracao === geracao && !!App.militar() && !el.classList.contains('oculto');
  }

  /* ---------- perfil ---------- */

  function perfilHtml(eu, ref) {
    var adm = Regras.eAdministrador(eu);
    var nome = adm ? 'AQS — conta institucional' : Regras.nomeMilitar(eu);
    var papel = Regras.ROTULOS.papel[eu.papel] || eu.papel || '—';
    var setor = ref && ref.mapaSetores ? ref.mapaSetores[eu.setor_id] : null;
    var classeAvatar = 'avatar avatar--grande' + (adm ? ' avatar--administrador' : (eu.papel === 'adjunto' ? ' avatar--adjunto' : ''));
    var seloPapel = '<span class="selo selo--papel-' + (Regras.ROTULOS.papel[eu.papel] ? eu.papel : 'adjunto') + '">' +
      U.esc(adm ? 'Administrador' : papel) + '</span>';

    function dado(rotulo, valor, vazio) {
      return '<div><dt>' + U.esc(rotulo) + '</dt><dd class="quebra-palavra">' +
        (valor ? U.esc(valor) : '<span class="texto-suave">' + U.esc(vazio || 'Não informado') + '</span>') + '</dd></div>';
    }

    var html =
      '<div class="perfil-cartao__topo">' +
        '<span class="' + classeAvatar + '" aria-hidden="true">' + U.esc(Sessao.iniciais(nome, adm)) + '</span>' +
        '<div class="cresce"><h2>' + U.esc(nome) + '</h2>' +
          '<div class="flex gap-1">' + seloPapel +
            (eu.ativo === false ? '<span class="selo selo--urgente">Inativo</span>' : '<span class="selo selo--sucesso">Acesso ativo</span>') +
          '</div>' +
        '</div>' +
      '</div>' +
      '<dl class="dados-lista">' +
        dado('Posto', eu.posto, adm ? 'Não se aplica (conta institucional)' : 'Não informado') +
        dado('Nome de guerra', eu.nome_guerra) +
        dado('Nome completo', eu.nome_completo) +
        dado('E-mail de acesso', eu.email) +
        dado('Setor', setor ? (setor.sigla + ' — ' + setor.nome) : '', eu.setor_id ? 'Setor não encontrado' : 'Sem setor') +
        dado('Papel', papel) +
        dado('Último acesso registrado', eu.ultimo_acesso ? U.formatarDataHora(eu.ultimo_acesso) : '', 'Sem registro') +
      '</dl>' +
      '<p class="texto-pequeno texto-suave mt-2 mb-0">' +
        (Regras.eGestor(eu)
          ? 'Os dados cadastrais são mantidos em <a href="#/equipe">Equipe</a> — inclusive os seus.'
          : 'Os seus dados cadastrais são mantidos pela chefia ou pela AQS. Se algo estiver errado, peça a correção.') +
      '</p>';

    if (adm) {
      html += '<div class="mt-2">' + aviso('atencao', 'escudo', 'Conta institucional — âncora de continuidade',
        'Esta conta garante que a ferramenta continue administrável quando chefes, adjuntos ou o responsável ' +
        'técnico mudarem. A senha deve ficar sob a guarda da AQS (e não de uma pessoa), registrada conforme o ' +
        'manual de continuidade (<code>docs/CONTINUIDADE.md</code>). Use-a só para administrar — as missões ' +
        'ficam com os militares.') + '</div>';
    }
    return html;
  }

  function desenharPerfil(caixa, eu, ref) {
    caixa.innerHTML = perfilHtml(eu, ref);
  }

  /* Atualização ao vivo: só o cartão do perfil é refeito (os formulários de
     senha e do segundo fator ficam intactos enquanto o militar os usa). */
  function atualizarPerfil(el) {
    var caixa = U.$('#contaPerfil', el);
    if (!caixa) { return; }
    var minhaGeracao = geracao;
    Api.referencias().then(function (ref) {
      if (!vigente(minhaGeracao, el)) { return; }
      var eu = App.militar();
      var atual = ref && ref.mapaMilitares ? ref.mapaMilitares[eu.id] : null;
      desenharPerfil(caixa, atual ? mesclar(eu, atual) : eu, ref);
    }).catch(function (erro) {
      console.warn('Perfil não atualizado agora.', erro);
    });
  }

  function mesclar(a, b) {
    var r = {};
    Object.keys(a || {}).forEach(function (k) { r[k] = a[k]; });
    Object.keys(b || {}).forEach(function (k) { r[k] = b[k]; });
    return r;
  }

  /* ---------- senha ---------- */

  function senhaHtml(eu) {
    return '<div class="cartao__titulo"><h2>' + icone('chave') + 'Trocar a senha</h2></div>' +
      '<form id="formContaSenha" method="post" action="#" novalidate>' +
        '<input type="email" class="oculto" autocomplete="username" value="' + U.esc(eu.email || '') + '" ' +
          'readonly tabindex="-1" aria-hidden="true">' +
        Sessao.campoSenhaHtml('contaSenhaNova', 'Nova senha', 'new-password') +
        Sessao.requisitosSenhaHtml('contaSenhaRequisitos') +
        Sessao.campoSenhaHtml('contaSenhaConfirmacao', 'Confirme a nova senha', 'new-password') +
        '<div id="contaSenhaErro"></div>' +
        '<button type="submit" class="botao" id="contaSenhaSalvar">Salvar a nova senha</button>' +
      '</form>' +
      '<p class="texto-pequeno texto-suave mt-2 mb-0">Trocar a senha não desconecta os outros aparelhos. ' +
        'Se suspeitar de uso indevido, use também "Sair de todos os dispositivos", abaixo.</p>';
  }

  function ligarSenha(caixa) {
    var form = U.$('#formContaSenha', caixa);
    var campoNova = U.$('#contaSenhaNova', caixa);
    var campoConfirmacao = U.$('#contaSenhaConfirmacao', caixa);
    var lista = U.$('#contaSenhaRequisitos', caixa);
    var botao = U.$('#contaSenhaSalvar', caixa);
    var caixaErro = U.$('#contaSenhaErro', caixa);
    var enviando = false;

    Sessao.ligarMostrarSenha(caixa);
    Sessao.ligarRequisitos(campoNova, campoConfirmacao, lista);
    Sessao.limparErroAoEditar(caixaErro, [campoNova, campoConfirmacao]);

    function erro(mensagem) {
      caixaErro.innerHTML = mensagem ? aviso('urgente', 'alerta', '', U.esc(mensagem)) : '';
    }

    form.addEventListener('submit', function (evento) {
      evento.preventDefault();
      if (enviando) { return; }
      var nova = campoNova.value;
      var problema = Sessao.validarNovaSenha(nova, campoConfirmacao.value);
      if (problema) {
        erro(problema);
        (Regras.validarSenha(nova) ? campoNova : campoConfirmacao).focus();
        return;
      }
      erro('');
      enviando = true;
      botao.disabled = true;
      botao.textContent = 'Salvando…';
      var envio = Api.trocarSenha(nova);
      nova = null;
      envio.then(function () {
        campoNova.value = '';
        campoConfirmacao.value = '';
        Sessao.ocultarSenhas(caixa);
        Sessao.avaliarRequisitos(lista, '', '');
        U.torrada('Senha alterada com sucesso.', 'sucesso');
      }).catch(function (e) {
        erro(U.erroTexto(e));
      }).then(function () {
        enviando = false;
        botao.disabled = false;
        botao.textContent = 'Salvar a nova senha';
      });
    });
  }

  /* ---------- verificação em duas etapas ---------- */

  var EXPLICACAO_MFA =
    '<p class="texto-pequeno">Além da senha, o sistema passa a pedir um código de 6 números que muda a cada ' +
    '30 segundos, gerado no celular por um aplicativo autenticador gratuito — <strong>Google Authenticator</strong> ' +
    'ou <strong>Microsoft Authenticator</strong>. Mesmo que alguém descubra a sua senha, não entra sem o seu celular.</p>';

  /* Só imagens em data URI viram src (a CSP também só permite 'self' e
     data:). O Supabase devolve o SVG sem codificar ("data:image/svg+xml;
     utf-8,<svg …>"): recodifica para que '#' e espaços não quebrem a URL. */
  function normalizarQr(qr) {
    var texto = String(qr || '').trim();
    if (!/^data:image\/(svg\+xml|png|jpeg|gif|webp)[;,]/i.test(texto)) { return null; }
    var virgula = texto.indexOf(',');
    if (virgula < 0) { return null; }
    var cabecalho = texto.slice(0, virgula + 1);
    if (/^data:image\/svg\+xml/i.test(texto) && !/;base64,$/i.test(cabecalho)) {
      var corpo = texto.slice(virgula + 1);
      try { corpo = decodeURIComponent(corpo); } catch (e) { /* já vinha cru */ }
      return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(corpo);
    }
    return texto;
  }

  function agruparSegredo(segredo) {
    return String(segredo || '').replace(/\s+/g, '').replace(/(.{4})(?=.)/g, '$1 ');
  }

  function carregarMfa(caixa, el) {
    var minhaGeracao = geracao;
    caixa.innerHTML = '<div class="carregando">Consultando a verificação em duas etapas…</div>';
    Api.mfaFatores().then(function (fatores) {
      if (!vigente(minhaGeracao, el)) { return; }
      desenharMfa(caixa, el, fatores || []);
    }).catch(function (erro) {
      if (!vigente(minhaGeracao, el)) { return; }
      caixa.innerHTML = aviso('urgente', 'alerta', 'Não foi possível consultar a verificação em duas etapas',
        U.esc(U.erroTexto(erro))) +
        '<button type="button" class="botao botao--secundario botao--pequeno" data-acao="mfa-tentar">Tentar novamente</button>';
      U.$('[data-acao="mfa-tentar"]', caixa).addEventListener('click', function () { carregarMfa(caixa, el); });
    });
  }

  function desenharMfa(caixa, el, fatores) {
    var eu = App.militar();
    var verificados = fatores.filter(function (f) { return f.status === 'verified'; });
    var pendentes = fatores.filter(function (f) { return f.status !== 'verified'; });
    var html = '';

    if (verificados.length) {
      html += '<div class="situacao-mfa"><span class="selo selo--sucesso">' + icone('check') + 'Ativada</span>' +
        '<span class="texto-pequeno texto-suave">Ao entrar, o sistema pede o código do aplicativo autenticador.</span></div>';
      html += verificados.map(function (f) {
        return '<div class="fator-item"><span class="cresce">' + icone('escudo') + ' Aplicativo autenticador' +
          (f.criado_em ? ' · cadastrado em ' + U.esc(U.formatarData(Regras.dataBelem(f.criado_em))) : '') + '</span>' +
          '<button type="button" class="botao botao--perigo-secundario botao--pequeno" data-remover="' + U.esc(f.id) + '" ' +
            'data-verificado="1">Remover</button></div>';
      }).join('');
      html += '<p class="texto-pequeno texto-suave mb-0">Trocou ou perdeu o celular? Um gestor pode remover a verificação ' +
        'da sua conta (Equipe); depois é só cadastrar de novo aqui.</p>';
    } else {
      html += '<div class="situacao-mfa"><span class="selo selo--neutro">Desativada</span></div>' + EXPLICACAO_MFA;
      if (Regras.eAdministrador(eu)) {
        html += aviso('atencao', 'alerta', 'Conta institucional',
          'Se ativar aqui, cadastre o aplicativo num <strong>celular institucional</strong> da AQS, ou guarde a ' +
          '<strong>chave de configuração</strong> em envelope lacrado sob a guarda da AQS (separado da senha), ' +
          'conforme <code>docs/CONTINUIDADE.md</code>. Nunca deixe a única cópia no celular pessoal de alguém.');
      } else if (Regras.eGestor(eu)) {
        html += aviso('', 'info', 'Recomendado para gestores',
          'Contas de chefia administram usuários e atividades: ative a verificação em duas etapas.');
      }
      if (pendentes.length) {
        html += pendentes.map(function (f) {
          return '<div class="fator-item"><span class="cresce texto-suave">Cadastro iniciado e não concluído' +
            (f.criado_em ? ' em ' + U.esc(U.formatarData(Regras.dataBelem(f.criado_em))) : '') + '</span>' +
            '<button type="button" class="botao botao--secundario botao--pequeno" data-remover="' + U.esc(f.id) + '">' +
              'Descartar</button></div>';
        }).join('');
      }
      html += '<button type="button" class="botao" data-acao="mfa-ativar">' + icone('escudo') +
        'Ativar a verificação em duas etapas</button>';
    }
    caixa.innerHTML = html;

    var ativar = U.$('[data-acao="mfa-ativar"]', caixa);
    if (ativar) {
      ativar.addEventListener('click', function () { iniciarCadastro(caixa, el, ativar); });
    }
    U.$$('[data-remover]', caixa).forEach(function (botao) {
      botao.addEventListener('click', function () {
        var verificado = botao.getAttribute('data-verificado') === '1';
        if (verificado && !U.confirmar('Remover a verificação em duas etapas?\n\n' +
          'A sua conta ficará protegida só pela senha. Você pode ativá-la de novo quando quiser.')) { return; }
        botao.disabled = true;
        Api.mfaRemover(botao.getAttribute('data-remover')).then(function () {
          if (verificado) { U.torrada('Verificação em duas etapas removida.', 'sucesso'); }
          carregarMfa(caixa, el);
        }).catch(function (erro) {
          botao.disabled = false;
          U.falha(erro);
        });
      });
    });
  }

  function iniciarCadastro(caixa, el, botao) {
    var minhaGeracao = geracao;
    botao.disabled = true;
    botao.textContent = 'Preparando…';
    Api.mfaIniciarCadastro().then(function (dados) {
      if (!vigente(minhaGeracao, el)) {
        /* O militar saiu da página: não deixa cadastro pela metade. */
        if (dados && dados.fator_id) { Api.mfaRemover(dados.fator_id).catch(function () {}); }
        return;
      }
      desenharCadastro(caixa, el, dados || {});
    }).catch(function (erro) {
      U.falha(erro);
      if (vigente(minhaGeracao, el)) { carregarMfa(caixa, el); }
    });
  }

  function desenharCadastro(caixa, el, dados) {
    var fatorId = dados.fator_id;
    var segredo = String(dados.segredo || '');
    caixa.innerHTML =
      '<ol class="passos-mfa">' +
        '<li><strong>Instale um aplicativo autenticador</strong> no celular (Google Authenticator ou Microsoft ' +
          'Authenticator, gratuitos na loja do aparelho).</li>' +
        '<li><strong>No aplicativo, adicione uma conta</strong> e leia o QR code abaixo. Se não conseguir ler, ' +
          'escolha "inserir chave de configuração" e digite a chave.</li>' +
        '<li><strong>Digite o código de 6 números</strong> que o aplicativo mostrar e confirme.</li>' +
      '</ol>' +
      '<div class="mfa-cadastro">' +
        '<div class="qr-mfa" id="contaQr"></div>' +
        '<div class="mfa-cadastro__chave">' +
          '<strong>Chave de configuração</strong>' +
          '<code class="segredo-mfa" id="contaSegredo"></code>' +
          '<button type="button" class="botao botao--secundario botao--pequeno" data-acao="copiar-chave">' +
            icone('copiar') + 'Copiar a chave</button>' +
          '<p class="texto-pequeno texto-suave mt-1 mb-0">Não compartilhe esta chave: quem a tiver gera os seus códigos.</p>' +
        '</div>' +
      '</div>' +
      '<form id="formContaMfa" method="post" action="#" novalidate>' +
        '<div class="campo">' +
          '<label for="contaMfaCodigo">Código de 6 números</label>' +
          '<input type="text" class="campo-codigo" id="contaMfaCodigo" inputmode="numeric" pattern="[0-9]*" ' +
            'autocomplete="one-time-code" placeholder="000000" required>' +
        '</div>' +
        '<div id="contaMfaErro"></div>' +
        '<div class="acoes mt-0">' +
          '<button type="submit" class="botao" id="contaMfaConfirmar">Confirmar e ativar</button>' +
          '<button type="button" class="botao botao--secundario" data-acao="mfa-cancelar">Cancelar</button>' +
        '</div>' +
      '</form>';

    /* QR e segredo entram pelo DOM (src e textContent), nunca como HTML. */
    var caixaQr = U.$('#contaQr', caixa);
    var src = normalizarQr(dados.qr_code);
    if (src) {
      var img = document.createElement('img');
      var sistema = (typeof AQS_CONFIG !== 'undefined' && AQS_CONFIG && AQS_CONFIG.NOME_SISTEMA) || 'o sistema';
      img.alt = 'QR code para cadastrar ' + sistema + ' no aplicativo autenticador';
      img.width = 184;
      img.height = 184;
      img.src = src;
      caixaQr.appendChild(img);
    } else {
      caixaQr.classList.add('oculto');
    }
    U.$('#contaSegredo', caixa).textContent = agruparSegredo(segredo) || '—';

    var campo = U.$('#contaMfaCodigo', caixa);
    var botao = U.$('#contaMfaConfirmar', caixa);
    var caixaErro = U.$('#contaMfaErro', caixa);
    var enviando = false;

    function erro(mensagem) {
      caixaErro.innerHTML = mensagem ? aviso('urgente', 'alerta', '', U.esc(mensagem)) : '';
    }

    function confirmar() {
      if (enviando) { return; }
      var codigo = campo.value.replace(/\D/g, '');
      if (codigo.length !== 6) {
        erro('Digite os 6 números mostrados no aplicativo autenticador.');
        campo.focus();
        return;
      }
      erro('');
      enviando = true;
      botao.disabled = true;
      botao.textContent = 'Conferindo…';
      Api.mfaConfirmarCadastro(fatorId, codigo).then(function () {
        segredo = '';
        U.torrada('Verificação em duas etapas ativada. Nos próximos acessos o sistema pedirá o código.', 'sucesso', 6500);
        carregarMfa(caixa, el);
      }).catch(function (e) {
        enviando = false;
        botao.disabled = false;
        botao.textContent = 'Confirmar e ativar';
        campo.value = '';
        erro(U.erroTexto(e));
        campo.focus();
      });
    }

    campo.addEventListener('input', function () {
      var limpo = campo.value.replace(/\D/g, '').slice(0, 6);
      if (campo.value !== limpo) { campo.value = limpo; }
    });
    Sessao.limparErroAoEditar(caixaErro, [campo]);
    U.$('#formContaMfa', caixa).addEventListener('submit', function (evento) {
      evento.preventDefault();
      confirmar();
    });
    U.$('[data-acao="mfa-cancelar"]', caixa).addEventListener('click', function () {
      segredo = '';
      caixa.innerHTML = '<div class="carregando">Cancelando…</div>';
      /* Descarta o fator não confirmado: não fica cadastro pela metade. */
      Api.mfaRemover(fatorId).catch(function (e) { console.warn(e); }).then(function () { carregarMfa(caixa, el); });
    });
    U.$('[data-acao="copiar-chave"]', caixa).addEventListener('click', function () {
      var texto = segredo.replace(/\s+/g, '');
      if (!texto) { return; }
      var copia = (navigator.clipboard && navigator.clipboard.writeText)
        ? navigator.clipboard.writeText(texto)
        : Promise.reject(new Error('Área de transferência indisponível.'));
      copia.then(function () {
        U.torrada('Chave copiada. Cole no aplicativo autenticador e depois apague-a da área de transferência.', 'sucesso');
      }).catch(function () {
        /* Sem acesso à área de transferência: seleciona para o Ctrl+C. */
        var alvo = U.$('#contaSegredo', caixa);
        var faixa = document.createRange();
        faixa.selectNodeContents(alvo);
        var selecao = window.getSelection();
        selecao.removeAllRanges();
        selecao.addRange(faixa);
        U.torrada('Chave selecionada: use Ctrl+C (ou "Copiar") para copiá-la.', 'atencao');
      });
    });

    try { campo.focus({ preventScroll: true }); } catch (e) { campo.focus(); }
  }

  /* ---------- aparência ---------- */

  var TEMAS = [
    { valor: 'automatico', titulo: 'Automático', texto: 'Acompanha o tema do aparelho (claro de dia, escuro à noite, se configurado).' },
    { valor: 'claro', titulo: 'Claro', texto: 'Fundo claro, ideal para ambientes iluminados.' },
    { valor: 'escuro', titulo: 'Escuro', texto: 'Fundo escuro, mais confortável à noite e no plantão.' }
  ];

  function temaHtml() {
    var atual = App.preferenciaTema();
    return '<div class="cartao__titulo"><h2>' + icone('tema') + 'Aparência</h2></div>' +
      '<fieldset class="opcoes" id="contaTema">' +
        '<legend class="so-leitor-tela">Tema</legend>' +
        TEMAS.map(function (t) {
          return '<label class="opcao"><input type="radio" name="contaTema" value="' + t.valor + '"' +
            (t.valor === atual ? ' checked' : '') + '>' +
            '<span class="opcao__texto"><strong>' + U.esc(t.titulo) + '</strong><small>' + U.esc(t.texto) + '</small></span></label>';
        }).join('') +
      '</fieldset>' +
      '<p class="texto-pequeno texto-suave mt-1 mb-0">A escolha vale para este aparelho e navegador.</p>';
  }

  function ligarTema(caixa) {
    U.$$('input[name="contaTema"]', caixa).forEach(function (radio) {
      radio.addEventListener('change', function () {
        if (radio.checked) { App.definirTema(radio.value); }
      });
    });
  }

  /* ---------- sessões ---------- */

  function sessoesHtml() {
    var minutos = Sessao.limiteInatividadeMinutos();
    return '<div class="cartao__titulo"><h2>' + icone('dispositivos') + 'Sessões e segurança</h2></div>' +
      '<p class="texto-pequeno">Por segurança, o sistema sai sozinho depois de <strong>' + minutos +
        ' minutos</strong> sem uso. Em computador compartilhado, saia sempre ao terminar.</p>' +
      '<p class="texto-pequeno">"Sair de todos os dispositivos" encerra a sessão neste aparelho e em todos os outros ' +
        'em que você entrou (celular, outro computador). Use se esqueceu o sistema aberto em algum lugar ou se ' +
        'suspeitar de uso indevido — e troque a senha em seguida.</p>' +
      '<button type="button" class="botao botao--perigo-secundario" data-acao="sair-todos">' + icone('sair') +
        'Sair de todos os dispositivos</button>';
  }

  function ligarSessoes(caixa) {
    U.$('[data-acao="sair-todos"]', caixa).addEventListener('click', function () {
      if (!U.confirmar('Sair de todos os dispositivos?\n\nA sessão será encerrada neste e em todos os outros ' +
        'aparelhos. Será preciso entrar de novo.')) { return; }
      Sessao.sair('todos');
    });
  }

  /* ---------- página ---------- */

  function render(el) {
    geracao += 1;
    var minhaGeracao = geracao;
    var eu = App.militar();
    if (!eu) { el.innerHTML = ''; return; }

    el.innerHTML =
      '<header class="pagina__cabecalho"><h1>Minha conta</h1>' +
        '<p>Seus dados de acesso, senha, verificação em duas etapas e preferências deste aparelho.</p></header>' +
      '<section class="cartao cartao--destaque" id="contaPerfil" aria-label="Perfil"><div class="carregando">Carregando…</div></section>' +
      '<div class="grade grade--largas">' +
        '<section class="cartao" id="contaSenha" aria-label="Senha"></section>' +
        '<section class="cartao" aria-label="Verificação em duas etapas">' +
          '<div class="cartao__titulo"><h2>' + icone('escudo') + 'Verificação em duas etapas</h2></div>' +
          '<div id="contaMfa"></div>' +
        '</section>' +
        '<section class="cartao" id="contaAparencia" aria-label="Aparência"></section>' +
        '<section class="cartao" id="contaSessoes" aria-label="Sessões e segurança"></section>' +
      '</div>';

    var caixaSenha = U.$('#contaSenha', el);
    caixaSenha.innerHTML = senhaHtml(eu);
    ligarSenha(caixaSenha);

    var caixaTema = U.$('#contaAparencia', el);
    caixaTema.innerHTML = temaHtml();
    ligarTema(caixaTema);

    var caixaSessoes = U.$('#contaSessoes', el);
    caixaSessoes.innerHTML = sessoesHtml();
    ligarSessoes(caixaSessoes);

    carregarMfa(U.$('#contaMfa', el), el);

    var caixaPerfil = U.$('#contaPerfil', el);
    Api.referencias().then(function (ref) {
      if (!vigente(minhaGeracao, el)) { return; }
      var atual = ref && ref.mapaMilitares ? ref.mapaMilitares[eu.id] : null;
      desenharPerfil(caixaPerfil, atual ? mesclar(eu, atual) : eu, ref);
    }).catch(function (erro) {
      if (!vigente(minhaGeracao, el)) { return; }
      /* Sem as referências, mostra o que o perfil já trouxe (sem o nome do setor). */
      console.warn(erro);
      desenharPerfil(caixaPerfil, eu, null);
    });

    U.aplicarLarguras(el);
  }

  return {
    titulo: 'Minha conta',
    render: render,
    /* Função (extensão do contrato, tratada por App.recarregar): quando
       militares/setores mudam, refaz só o cartão do perfil — sem apagar uma
       senha sendo digitada nem o QR code de um cadastro em andamento. */
    aoVivo: function (el, params, tabelas) {
      if (!tabelas || tabelas.indexOf('militares') >= 0 || tabelas.indexOf('setores') >= 0) { atualizarPerfil(el); }
    }
  };
})();
