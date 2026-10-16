/* =========================================================================
   HABE – AQS e NSP — sessão: acesso, segundo fator, troca obrigatória de
   senha e saída por inatividade
   Dono da #telaAcesso. O aplicativo (#telaApp) é do App: Sessao só avisa
   quando alguém entrou (aoEntrar(militar)) e quando saiu (aoSair(motivo)).
   Ver docs/ARQUITETURA.md, seção 7.

   Fluxo ao abrir a página:
     config.js ainda com os valores-modelo? ⇒ "Configuração pendente"
     Api.iniciar() ⇒ Api.sessaoAtual()
       sem sessão ⇒ login (e, se houver TOTP, o código de 6 números)
       com sessão ⇒ Api.meuPerfil()
         deve_trocar_senha ⇒ troca obrigatória
         sem cadastro ativo ⇒ Api.sair() e a mensagem
         pronto ⇒ aoEntrar(militar)

   Segurança:
   * A senha só existe dentro do tratador do formulário (variável local) e
     no campo, que é limpo logo depois de cada tentativa; a tela de acesso
     inteira é apagada do DOM ao entrar.
   * Cinco falhas seguidas travam o botão por 30 s (marcado na aba, para
     sobreviver a um recarregamento). É só um freio na tela: quem limita de
     verdade as tentativas é o Supabase Auth.
   * Sem uso por AQS_CONFIG.INATIVIDADE_MINUTOS ⇒ sai sozinho. O instante
     do último uso é compartilhado entre as abas (localStorage), para uma
     aba esquecida não derrubar a sessão que está em uso na outra.
   ========================================================================= */

var Sessao = (function () {
  'use strict';

  var CHAVE_FALHAS = 'aqs_login_falhas';
  var CHAVE_ATIVIDADE = 'aqs_ultima_atividade';
  var MAX_FALHAS = 5;
  var BLOQUEIO_MS = 30000;
  var AVISO_ANTES_MS = 60000;
  var VERIFICAR_A_CADA_MS = 15000;
  var GRAVAR_ATIVIDADE_A_CADA_MS = 15000;
  var EVENTOS_ATIVIDADE = ['pointerdown', 'keydown', 'touchstart', 'scroll'];

  /* O que dizer na tela de login depois de cada tipo de saída. */
  var SAIDAS = {
    usuario:     { tipo: 'sucesso', texto: 'Você saiu do sistema.' },
    todos:       { tipo: 'sucesso', texto: 'Você saiu de todos os dispositivos. Para continuar, entre novamente.' },
    inatividade: { tipo: 'atencao', texto: 'Sessão encerrada por inatividade.' },
    saiu:        { tipo: 'atencao', texto: 'Sua sessão foi encerrada. Entre novamente.' },
    desativado:  { tipo: 'urgente', texto: 'Seu acesso foi desativado ou o seu cadastro foi alterado. ' +
                   'Procure a chefia do NSP ou a AQS.' }
  };

  var PAPEIS_DEMO = {
    administrador: 'Conta institucional da AQS — administra tudo, inclusive a chefia',
    chefia: 'Gerencia atividades, avisos e a equipe',
    adjunto: 'Executa e registra as suas missões'
  };

  var aoEntrarCb = null;
  var aoSairCb = null;
  /* 'inicio' (abrindo) | 'acesso' (telas de acesso) | 'app' | 'saindo' */
  var estado = 'inicio';
  var telaAtual = '';
  var ocupado = false;
  var temporizadorBloqueio = null;
  var cancelarOuvinteSessao = null;

  /* ---------- auxiliares ---------- */

  function cfg(chave) {
    return (typeof AQS_CONFIG !== 'undefined' && AQS_CONFIG && AQS_CONFIG[chave]) || '';
  }

  function contatoSuporte() {
    return cfg('CONTATO_SUPORTE') || 'a chefia do NSP ou a AQS';
  }

  function icone(nome) {
    return '<svg class="icone" aria-hidden="true" focusable="false"><use href="#i-' + nome + '"></use></svg>';
  }

  function armazenamentoAba() {
    try { return window.sessionStorage; } catch (e) { return null; }
  }

  function armazenamentoLocal() {
    try { return window.localStorage; } catch (e) { return null; }
  }

  function lerJsonAba(chave) {
    try {
      var s = armazenamentoAba();
      var bruto = s ? s.getItem(chave) : null;
      return bruto ? JSON.parse(bruto) : null;
    } catch (e) {
      return null;
    }
  }

  function gravarJsonAba(chave, valor) {
    try {
      var s = armazenamentoAba();
      if (!s) { return; }
      if (valor === null) { s.removeItem(chave); } else { s.setItem(chave, JSON.stringify(valor)); }
    } catch (e) { /* armazenamento bloqueado: o freio vale só enquanto a página estiver aberta */ }
  }

  function modoDemo() {
    return typeof Api !== 'undefined' && Api && Api.modo === 'demo';
  }

  function tela() {
    return document.getElementById('telaAcesso');
  }

  function avisoHtml(tipo, titulo, textoHtml) {
    var simbolo = tipo === 'urgente' ? 'alerta' : (tipo === 'sucesso' ? 'check' : (tipo === 'atencao' ? 'relogio' : 'info'));
    return '<div class="aviso' + (tipo ? ' aviso--' + tipo : '') + '" role="' + (tipo === 'urgente' ? 'alert' : 'status') + '">' +
      '<span class="aviso__icone">' + icone(simbolo) + '</span>' +
      '<div>' + (titulo ? '<strong>' + U.esc(titulo) + '</strong>' : '') + textoHtml + '</div>' +
    '</div>';
  }

  function marcaHtml(semOrganizacao) {
    return '<div class="cartao-acesso__marca">' +
      '<img class="cartao-acesso__brasao" src="assets/img/logo-habe.svg" ' +
        'alt="Brasão do Hospital de Aeronáutica de Belém" width="100" height="120">' +
      '<h1 class="cartao-acesso__titulo">' + U.esc(cfg('NOME_SISTEMA') || 'HABE · AQS e NSP') + '</h1>' +
      '<p class="cartao-acesso__subtitulo">' + U.esc(cfg('SUBTITULO') || 'Ferramenta de Gestão de Atividades') + '</p>' +
      (semOrganizacao ? '' :
        '<p class="cartao-acesso__organizacao">' + U.esc(cfg('ORGANIZACAO') || 'Hospital de Aeronáutica de Belém') + '</p>') +
    '</div>';
  }

  function rodapeHtml() {
    return '<p class="cartao-acesso__rodape">' + icone('cadeado') +
      'Acesso restrito a militares cadastrados. As ações são registradas.</p>';
  }

  /* Troca o conteúdo da tela de acesso (e garante que o aplicativo está
     escondido). Devolve o cartão, para ligar os eventos. */
  function mostrar(nomeTela, corpoHtml, opcoes) {
    opcoes = opcoes || {};
    var raiz = tela();
    if (!raiz) { return null; }
    telaAtual = nomeTela;
    var app = document.getElementById('telaApp');
    if (app) { app.classList.add('oculto'); }
    document.body.classList.add('em-acesso');
    raiz.classList.remove('oculto');
    raiz.innerHTML =
      '<div class="cartao-acesso' + (opcoes.largo ? ' cartao-acesso--largo' : '') + '">' +
        marcaHtml(opcoes.semOrganizacao) + corpoHtml + (opcoes.semRodape ? '' : rodapeHtml()) +
      '</div>';
    return raiz.firstChild;
  }

  function carregando(texto) {
    mostrar('carregando', '<div class="carregando" role="status">' + U.esc(texto || 'Carregando…') + '</div>',
      { semRodape: true });
  }

  /* Coloca o foco no primeiro campo — só com mouse/teclado: no celular,
     abrir o teclado sozinho esconde metade da tela. */
  function focar(campo) {
    if (!campo) { return; }
    var ponteiroFino = !!(window.matchMedia && window.matchMedia('(pointer: fine)').matches);
    if (ponteiroFino) {
      try { campo.focus({ preventScroll: true }); } catch (e) { campo.focus(); }
    }
  }

  function mostrarErro(caixa, mensagem) {
    if (!caixa) { return; }
    caixa.innerHTML = mensagem ? avisoHtml('urgente', '', U.esc(mensagem)) : '';
  }

  /* Apaga a mensagem de erro assim que o militar mexe num dos campos: um
     erro antigo ao lado do campo já corrigido só confunde. */
  function limparErroAoEditar(caixa, campos) {
    campos.forEach(function (campo) {
      campo.addEventListener('input', function () {
        if (caixa && caixa.firstChild) { caixa.innerHTML = ''; }
      });
    });
  }

  function definirOcupado(botao, sim, textoOcupado) {
    ocupado = !!sim;
    if (!botao) { return; }
    if (!botao.getAttribute('data-texto')) { botao.setAttribute('data-texto', botao.textContent); }
    botao.disabled = !!sim;
    botao.setAttribute('aria-busy', sim ? 'true' : 'false');
    botao.textContent = sim ? (textoOcupado || 'Aguarde…') : botao.getAttribute('data-texto');
  }

  /* Mensagens de erro que significam "não há (mais) cadastro ativo ou
     sessão válida": nesses casos não adianta tentar de novo — sai e volta
     ao login. Os demais erros (rede, servidor) oferecem "Tentar novamente". */
  function eErroDeCadastroOuSessao(erro) {
    var texto = U.erroTexto(erro);
    return /sem_cadastro|cadastro|vinculad|desativad|segundo fator|sess[aã]o (terminou|expirou|encerrada)|entre novamente|jwt|n[aã]o autenticad/i
      .test(texto);
  }

  /* ---------- campos de senha (compartilhados com Minha conta) ---------- */

  var REQUISITOS = [
    { chave: 'tamanho', texto: 'Ao menos 10 caracteres' },
    { chave: 'letra', texto: 'Ao menos uma letra' },
    { chave: 'numero', texto: 'Ao menos um número' },
    { chave: 'espacos', texto: 'Sem espaço no início ou no fim' },
    { chave: 'confere', texto: 'Confirmação igual à nova senha' }
  ];

  /* Campo de senha com o botão Mostrar/Ocultar. */
  function campoSenhaHtml(id, rotulo, autocomplete, dica) {
    return '<div class="campo">' +
      '<label for="' + id + '">' + U.esc(rotulo) +
        (dica ? '<span class="campo__dica">' + U.esc(dica) + '</span>' : '') + '</label>' +
      '<div class="campo-senha">' +
        '<input type="password" id="' + id + '" autocomplete="' + autocomplete + '" ' +
          'autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="72" required>' +
        '<button type="button" class="campo-senha__alternar" data-alvo="' + id + '" ' +
          'aria-controls="' + id + '" aria-pressed="false">Mostrar</button>' +
      '</div>' +
    '</div>';
  }

  function requisitosSenhaHtml(id) {
    return '<ul class="lista-requisitos" id="' + id + '" aria-label="Requisitos da senha">' +
      REQUISITOS.map(function (r) {
        return '<li data-requisito="' + r.chave + '">' + U.esc(r.texto) + '</li>';
      }).join('') +
    '</ul>';
  }

  function dicasSenhaHtml() {
    return '<ul class="lista-dicas">' +
      '<li>Uma frase curta fica fácil de lembrar e difícil de adivinhar (ex.: três palavras e um número).</li>' +
      '<li>Não reaproveite a senha do e-mail, do banco ou de outros sistemas.</li>' +
      '<li>Não use nome, data de nascimento, SARAM ou o nome do setor.</li>' +
      '<li>Não compartilhe a sua senha — nem com a chefia. Cada acesso é registrado em seu nome.</li>' +
    '</ul>';
  }

  /* Liga os botões Mostrar/Ocultar dentro de raiz. */
  function ligarMostrarSenha(raiz) {
    U.$$('.campo-senha__alternar', raiz).forEach(function (botao) {
      botao.addEventListener('click', function () {
        var campo = document.getElementById(botao.getAttribute('data-alvo'));
        if (!campo) { return; }
        var mostrarTexto = campo.type === 'password';
        campo.type = mostrarTexto ? 'text' : 'password';
        botao.textContent = mostrarTexto ? 'Ocultar' : 'Mostrar';
        botao.setAttribute('aria-pressed', mostrarTexto ? 'true' : 'false');
        botao.setAttribute('aria-label', mostrarTexto ? 'Ocultar a senha' : 'Mostrar a senha');
        try { campo.focus({ preventScroll: true }); } catch (e) { campo.focus(); }
      });
    });
  }

  /* Volta todos os campos de senha de raiz a "oculto" (antes de limpar). */
  function ocultarSenhas(raiz) {
    U.$$('.campo-senha__alternar', raiz).forEach(function (botao) {
      var campo = document.getElementById(botao.getAttribute('data-alvo'));
      if (campo) { campo.type = 'password'; }
      botao.textContent = 'Mostrar';
      botao.setAttribute('aria-pressed', 'false');
    });
  }

  function avaliarRequisitos(lista, nova, confirmacao) {
    if (!lista) { return; }
    nova = nova || '';
    var ok = {
      tamanho: nova.length >= 10,
      letra: /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(nova),
      numero: /[0-9]/.test(nova),
      espacos: nova.length > 0 && !/^\s|\s$/.test(nova),
      confere: nova.length > 0 && nova === (confirmacao || '')
    };
    U.$$('[data-requisito]', lista).forEach(function (item) {
      item.classList.toggle('requisito--ok', !!ok[item.getAttribute('data-requisito')]);
    });
  }

  /* Liga a lista de requisitos aos dois campos (atualiza a cada tecla). */
  function ligarRequisitos(campoNova, campoConfirmacao, lista) {
    function atualizar() { avaliarRequisitos(lista, campoNova.value, campoConfirmacao.value); }
    campoNova.addEventListener('input', atualizar);
    campoConfirmacao.addEventListener('input', atualizar);
    atualizar();
  }

  /* null se a nova senha pode ser usada; senão a mensagem. A regra de
     verdade é Regras.validarSenha (a mesma da demonstração). */
  function validarNovaSenha(nova, confirmacao) {
    var problema = Regras.validarSenha(nova);
    if (problema) { return problema; }
    if (nova !== confirmacao) { return 'A confirmação não confere com a nova senha. Digite a mesma senha nos dois campos.'; }
    return null;
  }

  /* ---------- freio de tentativas ---------- */

  function lerFalhas() {
    var f = lerJsonAba(CHAVE_FALHAS) || {};
    return { n: Number(f.n) || 0, ate: Number(f.ate) || 0 };
  }

  /* Falha de rede não é tentativa de senha: não conta para a trava (sem
     internet, o militar não pode ficar travado por insistir). */
  function eFalhaDeRede(erro) {
    return /conex[aã]o|internet|n[aã]o respondeu|demorou|failed to fetch|network/i.test(U.erroTexto(erro));
  }

  function registrarFalha(erro) {
    if (erro && eFalhaDeRede(erro)) { return; }
    var f = lerFalhas();
    f.n += 1;
    if (f.n >= MAX_FALHAS) {
      f.n = 0;
      f.ate = Date.now() + BLOQUEIO_MS;
    }
    gravarJsonAba(CHAVE_FALHAS, f);
  }

  function zerarFalhas() {
    gravarJsonAba(CHAVE_FALHAS, null);
  }

  function bloqueadoAte() {
    var ate = lerFalhas().ate;
    /* Um "até" absurdo (relógio mexido) não pode travar para sempre. */
    if (ate > Date.now() + BLOQUEIO_MS) { return Date.now() + BLOQUEIO_MS; }
    return ate;
  }

  /* Mostra a contagem regressiva no botão enquanto durar a trava. */
  function aplicarBloqueio(botao, textoNormal) {
    window.clearTimeout(temporizadorBloqueio);
    if (!botao || !document.body.contains(botao)) { return; }
    var restante = bloqueadoAte() - Date.now();
    if (restante > 0) {
      botao.disabled = true;
      botao.textContent = 'Muitas tentativas — aguarde ' + Math.ceil(restante / 1000) + ' s';
      temporizadorBloqueio = window.setTimeout(function () { aplicarBloqueio(botao, textoNormal); }, 1000);
    } else if (!ocupado) {
      botao.disabled = false;
      botao.textContent = textoNormal;
    }
  }

  /* ---------- telas ---------- */

  function telaErroCarga(detalhe) {
    var corpo = mostrar('erro-carga',
      '<h2 class="cartao-acesso__etapa">' + icone('alerta') + 'Não foi possível iniciar o sistema</h2>' +
      '<p class="cartao-acesso__texto">Um dos arquivos do sistema não carregou — conexão instável ou ' +
        'publicação incompleta. Recarregue a página. Se o problema continuar, procure: <strong>' +
        U.esc(contatoSuporte()) + '</strong>.</p>' +
      (detalhe ? '<p class="texto-pequeno texto-suave">Detalhe técnico: ' + U.esc(detalhe) + '</p>' : '') +
      '<button type="button" class="botao botao--bloco botao--grande" id="acessoRecarregar">Recarregar a página</button>',
      { semOrganizacao: true });
    if (!corpo) { return; }
    U.$('#acessoRecarregar', corpo).addEventListener('click', function () { window.location.reload(); });
  }

  /* Campos de config.js que ainda estão com o texto-modelo. */
  var DESCRICAO_CONFIG = {
    SUPABASE_URL: 'o endereço do projeto Supabase (Project URL, algo como https://abcdefgh.supabase.co)',
    SUPABASE_ANON_KEY: 'a chave pública do projeto ("anon" ou "publishable")'
  };

  function configuracaoPendente() {
    var faltas = [];
    var c = (typeof AQS_CONFIG !== 'undefined' && AQS_CONFIG) || {};
    ['SUPABASE_URL', 'SUPABASE_ANON_KEY'].forEach(function (chave) {
      if (!c[chave] || !String(c[chave]).trim()) { faltas.push(chave); }
    });
    Object.keys(c).forEach(function (chave) {
      var valor = c[chave];
      if (typeof valor === 'string' && /SEU-PROJETO|COLE-AQUI/i.test(valor) && faltas.indexOf(chave) < 0) {
        faltas.push(chave);
      }
    });
    return faltas;
  }

  function telaConfiguracaoPendente(faltas) {
    mostrar('configuracao',
      '<h2 class="cartao-acesso__etapa">' + icone('alerta') + 'Configuração pendente</h2>' +
      '<p class="cartao-acesso__texto">Este é o endereço do sistema oficial, mas ele ainda não foi ligado ao ' +
        'banco de dados (Supabase). Falta preencher, no arquivo <code>assets/js/config.js</code>:</p>' +
      '<ul class="lista-passos">' + faltas.map(function (chave) {
        return '<li><code>' + U.esc(chave) + '</code>' +
          (DESCRICAO_CONFIG[chave] ? ' — ' + U.esc(DESCRICAO_CONFIG[chave]) : ' — ainda com o texto-modelo') + '</li>';
      }).join('') + '</ul>' +
      '<p class="texto-pequeno">Onde encontrar: painel do Supabase → <strong>Project Settings → API</strong>. ' +
        'Use somente a chave pública; <strong>nunca</strong> a chave "service_role"/"secret".</p>' +
      '<p class="texto-pequeno">O passo a passo completo (criar o projeto, rodar os arquivos SQL, publicar a ' +
        'página e cadastrar a conta institucional da AQS) está em <code>docs/IMPLANTACAO.md</code>.</p>' +
      '<a class="botao botao--bloco botao--grande" href="demo.html">Conhecer a ferramenta no modo demonstração</a>' +
      '<p class="formulario-acesso__ajuda">A demonstração usa dados fictícios e não grava nada em servidor.</p>',
      { largo: true });
  }

  function telaErroConexao(erro) {
    var corpo = mostrar('erro-conexao',
      '<h2 class="cartao-acesso__etapa">' + icone('alerta') + 'Sem conexão com o servidor</h2>' +
      avisoHtml('urgente', '', U.esc(U.erroTexto(erro))) +
      '<p class="cartao-acesso__texto">Confira a internet do aparelho e tente de novo. Se o problema continuar, ' +
        'procure: <strong>' + U.esc(contatoSuporte()) + '</strong>.</p>' +
      '<button type="button" class="botao botao--bloco botao--grande" id="acessoTentar">Tentar novamente</button>',
      { semOrganizacao: true });
    if (!corpo) { return; }
    U.$('#acessoTentar', corpo).addEventListener('click', abrir);
  }

  function telaLogin(mensagem) {
    estado = 'acesso';
    var demo = modoDemo();
    var usuariosDemo = [];
    if (demo && window.ApiDemo && typeof window.ApiDemo.usuariosDemo === 'function') {
      try { usuariosDemo = window.ApiDemo.usuariosDemo() || []; } catch (e) { usuariosDemo = []; }
    }

    var blocoDemo = '';
    if (usuariosDemo.length) {
      blocoDemo =
        '<div class="entrar-como">' +
          '<p class="entrar-como__titulo">Demonstração — escolha um perfil</p>' +
          '<div class="entrar-como__lista">' + usuariosDemo.map(function (u, i) {
            var adm = u.papel === 'administrador';
            var nome = adm ? 'AQS — conta institucional' : u.nome;
            var rotulo = adm ? 'Administrador' : (Regras.ROTULOS.papel[u.papel] || u.papel);
            return '<button type="button" class="entrar-como__botao" data-indice="' + i + '">' +
              '<span class="avatar' + (adm ? ' avatar--administrador' : (u.papel === 'adjunto' ? ' avatar--adjunto' : '')) + '">' +
                U.esc(iniciais(nome, adm)) + '</span>' +
              '<span class="entrar-como__texto"><strong>Entrar como ' + U.esc(nome) + '</strong>' +
                '<small>' + U.esc(rotulo) + (PAPEIS_DEMO[u.papel] ? ' · ' + U.esc(PAPEIS_DEMO[u.papel]) : '') + '</small></span>' +
            '</button>';
          }).join('') + '</div>' +
        '</div>' +
        '<p class="separador-texto">ou entre com e-mail e senha</p>';
    }

    var corpo = mostrar('login',
      blocoDemo +
      '<form class="formulario-acesso" id="formLogin" method="post" action="#" novalidate>' +
        (mensagem ? avisoHtml(mensagem.tipo, '', U.esc(mensagem.texto)) : '') +
        '<div class="campo">' +
          '<label for="acessoEmail">E-mail</label>' +
          '<input type="email" id="acessoEmail" name="email" autocomplete="username" inputmode="email" ' +
            'autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="254" required>' +
        '</div>' +
        campoSenhaHtml('acessoSenha', 'Senha', 'current-password') +
        '<label class="opcao opcao--compacta" for="acessoLembrar">' +
          '<input type="checkbox" id="acessoLembrar">' +
          '<span class="opcao__texto"><strong>Lembrar neste dispositivo</strong>' +
            '<small>Continua conectado depois de fechar o navegador. ' +
            'Não marque em computador compartilhado (enfermaria, recepção, sala de reunião).</small></span>' +
        '</label>' +
        '<div id="acessoErro"></div>' +
        '<button type="submit" class="botao botao--bloco botao--grande" id="acessoEntrar">Entrar</button>' +
        '<p class="formulario-acesso__ajuda">Esqueceu a senha? Procure: <strong>' + U.esc(contatoSuporte()) + '</strong></p>' +
        (usuariosDemo.length ? '<p class="formulario-acesso__ajuda">Na demonstração, qualquer senha serve para os ' +
          'e-mails <strong>@demo.local</strong>.</p>' : '') +
      '</form>');
    if (!corpo) { return; }

    var form = U.$('#formLogin', corpo);
    var campoEmail = U.$('#acessoEmail', corpo);
    var campoSenha = U.$('#acessoSenha', corpo);
    var campoLembrar = U.$('#acessoLembrar', corpo);
    var botao = U.$('#acessoEntrar', corpo);
    var caixaErro = U.$('#acessoErro', corpo);

    ligarMostrarSenha(corpo);
    limparErroAoEditar(caixaErro, [campoEmail, campoSenha]);
    aplicarBloqueio(botao, 'Entrar');

    function concluirLogin(resultado) {
      zerarFalhas();
      if (resultado && resultado.precisaMfa) { telaMfa(); } else { carregarPerfil(); }
    }

    form.addEventListener('submit', function (evento) {
      evento.preventDefault();
      if (ocupado || bloqueadoAte() > Date.now()) { return; }
      var email = campoEmail.value.trim().toLowerCase();
      var senha = campoSenha.value;
      var problema = !email ? 'Informe o e-mail.' : (Regras.validarEmail(email) || (senha ? null : 'Informe a senha.'));
      if (problema) {
        mostrarErro(caixaErro, problema);
        focar(!email || Regras.validarEmail(email) ? campoEmail : campoSenha);
        return;
      }
      mostrarErro(caixaErro, '');
      definirOcupado(botao, true, 'Entrando…');
      var tentativa = Api.entrar(email, senha, !!campoLembrar.checked);
      senha = null;
      /* then(sucesso, falha): um erro DEPOIS do login certo não pode contar
         como tentativa de senha errada. */
      tentativa.then(function (resultado) {
        campoSenha.value = '';
        definirOcupado(botao, false);
        concluirLogin(resultado);
      }, function (erro) {
        campoSenha.value = '';
        ocultarSenhas(corpo);
        definirOcupado(botao, false);
        registrarFalha(erro);
        mostrarErro(caixaErro, U.erroTexto(erro));
        aplicarBloqueio(botao, 'Entrar');
        if (bloqueadoAte() <= Date.now()) { focar(campoSenha); }
      });
    });

    U.$$('.entrar-como__botao', corpo).forEach(function (b) {
      b.addEventListener('click', function () {
        if (ocupado) { return; }
        var u = usuariosDemo[Number(b.getAttribute('data-indice'))];
        if (!u) { return; }
        U.$$('.entrar-como__botao', corpo).forEach(function (x) { x.disabled = true; });
        definirOcupado(botao, true, 'Entrando…');
        Api.entrar(u.email, 'demonstracao', false).then(function (resultado) {
          definirOcupado(botao, false);
          concluirLogin(resultado);
        }).catch(function (erro) {
          definirOcupado(botao, false);
          U.$$('.entrar-como__botao', corpo).forEach(function (x) { x.disabled = false; });
          mostrarErro(caixaErro, U.erroTexto(erro));
        });
      });
    });

    if (!usuariosDemo.length) { focar(campoEmail); }
  }

  function telaMfa() {
    estado = 'acesso';
    var corpo = mostrar('mfa',
      '<form class="formulario-acesso" id="formMfa" method="post" action="#" novalidate>' +
        '<h2 class="cartao-acesso__etapa">' + icone('escudo') + 'Verificação em duas etapas</h2>' +
        '<p class="cartao-acesso__texto">Abra o aplicativo autenticador no seu celular (Google Authenticator, ' +
          'Microsoft Authenticator ou similar) e digite o código de 6 números de <strong>' +
          U.esc(cfg('NOME_SISTEMA') || 'HABE · AQS e NSP') + '</strong>.</p>' +
        '<div class="campo">' +
          '<label for="acessoCodigo">Código de 6 números</label>' +
          '<input type="text" class="campo-codigo" id="acessoCodigo" inputmode="numeric" pattern="[0-9]*" ' +
            'autocomplete="one-time-code" placeholder="000000" required>' +
        '</div>' +
        '<div id="mfaErro"></div>' +
        '<button type="submit" class="botao botao--bloco botao--grande" id="mfaConfirmar">Confirmar</button>' +
        '<button type="button" class="botao botao--secundario botao--bloco" id="mfaVoltar">Voltar e entrar com outra conta</button>' +
        '<p class="formulario-acesso__ajuda">Perdeu ou trocou o celular? Procure: <strong>' + U.esc(contatoSuporte()) +
          '</strong> — um gestor pode remover a verificação da sua conta.</p>' +
      '</form>');
    if (!corpo) { return; }

    var form = U.$('#formMfa', corpo);
    var campo = U.$('#acessoCodigo', corpo);
    var botao = U.$('#mfaConfirmar', corpo);
    var caixaErro = U.$('#mfaErro', corpo);

    aplicarBloqueio(botao, 'Confirmar');
    limparErroAoEditar(caixaErro, [campo]);

    function enviar() {
      if (ocupado || bloqueadoAte() > Date.now()) { return; }
      var codigo = campo.value.replace(/\D/g, '');
      if (codigo.length !== 6) {
        mostrarErro(caixaErro, 'Digite os 6 números mostrados no aplicativo autenticador.');
        focar(campo);
        return;
      }
      mostrarErro(caixaErro, '');
      definirOcupado(botao, true, 'Conferindo…');
      Api.verificarMfa(codigo).then(function () {
        zerarFalhas();
        definirOcupado(botao, false);
        carregarPerfil();
      }, function (erro) {
        definirOcupado(botao, false);
        registrarFalha(erro);
        campo.value = '';
        mostrarErro(caixaErro, U.erroTexto(erro));
        aplicarBloqueio(botao, 'Confirmar');
        if (bloqueadoAte() <= Date.now()) { focar(campo); }
      });
    }

    campo.addEventListener('input', function () {
      var limpo = campo.value.replace(/\D/g, '').slice(0, 6);
      if (campo.value !== limpo) { campo.value = limpo; }
      /* Os 6 números digitados (ou colados) já bastam: envia sozinho. */
      if (limpo.length === 6) { enviar(); }
    });
    form.addEventListener('submit', function (evento) {
      evento.preventDefault();
      enviar();
    });
    U.$('#mfaVoltar', corpo).addEventListener('click', function () {
      if (ocupado) { return; }
      telaAtual = 'voltando';
      carregando('Saindo…');
      Api.sair().catch(function (erro) { console.error(erro); }).then(function () { telaLogin(); });
    });

    try { campo.focus({ preventScroll: true }); } catch (e) { campo.focus(); }
  }

  function telaTrocaObrigatoria(militar) {
    estado = 'acesso';
    var nome = Regras.eAdministrador(militar) ? 'AQS — conta institucional' : Regras.nomeMilitar(militar);
    var corpo = mostrar('troca',
      '<form class="formulario-acesso" id="formTroca" method="post" action="#" novalidate>' +
        '<h2 class="cartao-acesso__etapa">' + icone('chave') + 'Crie a sua senha</h2>' +
        '<p class="cartao-acesso__texto">Olá, <strong>' + U.esc(nome) + '</strong>. Este é o seu primeiro acesso ' +
          '(ou a sua senha foi redefinida por um gestor). Antes de continuar, crie uma senha pessoal.</p>' +
        /* Campo de usuário oculto: ajuda o gerenciador de senhas do navegador
           a guardar a nova senha para o e-mail certo. */
        '<input type="email" class="oculto" autocomplete="username" value="' + U.esc(militar.email || '') + '" ' +
          'readonly tabindex="-1" aria-hidden="true">' +
        campoSenhaHtml('trocaNova', 'Nova senha', 'new-password') +
        requisitosSenhaHtml('trocaRequisitos') +
        campoSenhaHtml('trocaConfirmacao', 'Confirme a nova senha', 'new-password') +
        dicasSenhaHtml() +
        '<div id="trocaErro"></div>' +
        '<button type="submit" class="botao botao--bloco botao--grande" id="trocaSalvar">Salvar a senha e entrar</button>' +
        '<button type="button" class="botao botao--secundario botao--bloco" id="trocaSair">Sair</button>' +
      '</form>', { largo: true });
    if (!corpo) { return; }

    var form = U.$('#formTroca', corpo);
    var campoNova = U.$('#trocaNova', corpo);
    var campoConfirmacao = U.$('#trocaConfirmacao', corpo);
    var botao = U.$('#trocaSalvar', corpo);
    var caixaErro = U.$('#trocaErro', corpo);

    ligarMostrarSenha(corpo);
    ligarRequisitos(campoNova, campoConfirmacao, U.$('#trocaRequisitos', corpo));
    limparErroAoEditar(caixaErro, [campoNova, campoConfirmacao]);

    form.addEventListener('submit', function (evento) {
      evento.preventDefault();
      if (ocupado) { return; }
      var nova = campoNova.value;
      var problema = validarNovaSenha(nova, campoConfirmacao.value);
      if (problema) {
        mostrarErro(caixaErro, problema);
        focar(Regras.validarSenha(nova) ? campoNova : campoConfirmacao);
        return;
      }
      mostrarErro(caixaErro, '');
      definirOcupado(botao, true, 'Salvando…');
      var envio = Api.trocarSenha(nova);
      nova = null;
      envio.then(function () {
        campoNova.value = '';
        campoConfirmacao.value = '';
        definirOcupado(botao, false);
        U.torrada('Senha criada. Bem-vindo(a)!', 'sucesso');
        /* A senha acabou de ser trocada: mesmo que o perfil relido ainda
           viesse com a marca antiga, não se pede a troca de novo. */
        carregarPerfil(true);
      }).catch(function (erro) {
        definirOcupado(botao, false);
        mostrarErro(caixaErro, U.erroTexto(erro));
        if (eErroDeCadastroOuSessao(erro)) {
          campoNova.value = '';
          campoConfirmacao.value = '';
        }
      });
    });

    U.$('#trocaSair', corpo).addEventListener('click', function () {
      if (ocupado) { return; }
      campoNova.value = '';
      campoConfirmacao.value = '';
      telaAtual = 'voltando';
      carregando('Saindo…');
      Api.sair().catch(function (erro) { console.error(erro); }).then(function () { telaLogin(SAIDAS.usuario); });
    });

    focar(campoNova);
  }

  function telaErroPerfil(erro) {
    estado = 'acesso';
    var corpo = mostrar('erro-perfil',
      '<h2 class="cartao-acesso__etapa">' + icone('alerta') + 'Não foi possível carregar o seu perfil</h2>' +
      avisoHtml('urgente', '', U.esc(U.erroTexto(erro))) +
      '<p class="cartao-acesso__texto">Pode ser a conexão. Tente novamente; se continuar, saia e procure: <strong>' +
        U.esc(contatoSuporte()) + '</strong>.</p>' +
      '<button type="button" class="botao botao--bloco botao--grande" id="perfilTentar">Tentar novamente</button>' +
      '<button type="button" class="botao botao--secundario botao--bloco mt-1" id="perfilSair">Sair</button>');
    if (!corpo) { return; }
    U.$('#perfilTentar', corpo).addEventListener('click', function () { carregarPerfil(); });
    U.$('#perfilSair', corpo).addEventListener('click', function () {
      telaAtual = 'voltando';
      carregando('Saindo…');
      Api.sair().catch(function (e) { console.error(e); }).then(function () { telaLogin(SAIDAS.usuario); });
    });
  }

  /* ---------- perfil e entrada no aplicativo ---------- */

  /* Postos e graduações que abrem o nome ("1º Ten Lima", "Maj Fulano"):
     ficam de fora das iniciais do avatar. */
  var POSTOS = /^(?:\d+º\s*)?(?:ten(?:ente)?(?:[\s-]cel)?|tc|cap(?:it[aã]o)?|maj(?:or)?|cel|brig|asp|so|[123]º?\s*sgt|[123]s|sgt|cb|s[12]|sd)\.?\s+/i;

  /* Iniciais para o avatar: 'Ten Souza' → 'L'; 'Maj Chefia NSP' → 'CN';
     a conta institucional é sempre 'AQS'. */
  function iniciais(nome, administrador) {
    if (administrador) { return 'AQS'; }
    var palavras = String(nome || '').trim().replace(POSTOS, '').split(/\s+/).filter(Boolean);
    var letras = palavras.slice(0, 2).map(function (p) { return p.charAt(0); }).join('');
    return (letras || '?').toUpperCase();
  }

  function carregarPerfil(senhaRecemTrocada) {
    estado = 'acesso';
    carregando('Carregando o seu perfil…');
    return Api.meuPerfil().then(function (militar) {
      if (!militar || !militar.id) {
        throw new Error('Seu usuário não está vinculado a um cadastro ativo. Procure a chefia do NSP ou a AQS.');
      }
      if (senhaRecemTrocada) { militar.deve_trocar_senha = false; }
      if (militar.deve_trocar_senha) { telaTrocaObrigatoria(militar); return; }
      entrarNoApp(militar);
    }).catch(function (erro) {
      if (eErroDeCadastroOuSessao(erro)) {
        telaAtual = 'voltando';
        Api.sair().catch(function (e) { console.error(e); }).then(function () {
          telaLogin({ tipo: 'urgente', texto: U.erroTexto(erro) });
        });
      } else {
        console.error(erro);
        telaErroPerfil(erro);
      }
    });
  }

  function entrarNoApp(militar) {
    estado = 'app';
    telaAtual = '';
    var raiz = tela();
    if (raiz) {
      raiz.innerHTML = '';
      raiz.classList.add('oculto');
    }
    document.body.classList.remove('em-acesso');
    iniciarMonitor();
    if (typeof aoEntrarCb === 'function') {
      try {
        aoEntrarCb(militar);
      } catch (erro) {
        console.error(erro);
        U.falha(erro);
      }
    }
  }

  /* ---------- saída ---------- */

  var saidaEmCurso = null;

  /* Encerra a sessão: primeiro limpa a tela (o App apaga tudo o que é dado
     em aoSair), depois avisa o servidor e mostra o login com a mensagem. */
  function encerrar(motivo) {
    if (saidaEmCurso) { return saidaEmCurso; }
    var estavaNoApp = estado === 'app';
    estado = 'saindo';
    pararMonitor();
    if (estavaNoApp && typeof aoSairCb === 'function') {
      try { aoSairCb(motivo); } catch (erro) { console.error(erro); }
    }
    carregando('Saindo…');

    var todos = motivo === 'todos';
    var mensagem = SAIDAS[motivo] || SAIDAS.saiu;
    saidaEmCurso = Promise.resolve().then(function () {
      return Api.sair(todos);
    }).catch(function (erro) {
      console.error(erro);
      if (!todos) { return; }
      /* Não deu para encerrar nos outros aparelhos (rede?): ao menos este
         sai, e o militar fica sabendo que precisa tentar de novo. O
         adaptador do Supabase já explica isso na própria mensagem. */
      var texto = U.erroTexto(erro);
      mensagem = {
        tipo: 'urgente',
        texto: /outros/i.test(texto) ? texto
          : 'Esta sessão foi encerrada, mas não foi possível encerrar as dos outros dispositivos (' +
            texto.replace(/\.$/, '') + '). Entre novamente e repita "Sair de todos os dispositivos".'
      };
      return Api.sair(false).catch(function (e) { console.error(e); });
    }).then(function () {
      saidaEmCurso = null;
      telaLogin(mensagem);
    });
    return saidaEmCurso;
  }

  /* Saída pedida pelo próprio aplicativo: 'usuario' (botão Sair), 'todos'
     (sair de todos os dispositivos), 'inatividade', 'desativado' ou 'saiu'
     (a sessão deixou de valer — ex.: segundo fator ativado em outro
     aparelho). */
  function sair(motivo) {
    return encerrar(motivo || 'usuario');
  }

  /* A sessão acabou por fora (expirou, saiu em outra aba, foi revogada). */
  function aoMudarSessao(evento) {
    if (evento !== 'saiu') { return; }
    if (estado === 'app') {
      encerrar('saiu');
    } else if (estado === 'acesso' && (telaAtual === 'troca' || telaAtual === 'erro-perfil' || telaAtual === 'mfa')) {
      telaLogin(SAIDAS.saiu);
    }
  }

  /* ---------- inatividade ---------- */

  var ultimaAtividade = 0;
  var ultimaGravacao = 0;
  var verificador = null;
  var avisado = false;
  var monitorando = false;

  function limiteInatividadeMs() {
    var minutos = Number(cfg('INATIVIDADE_MINUTOS'));
    if (!isFinite(minutos) || minutos < 1) { minutos = 30; }
    return minutos * 60000;
  }

  function atividadeCompartilhada() {
    try {
      var s = armazenamentoLocal();
      var valor = s ? Number(s.getItem(CHAVE_ATIVIDADE)) : 0;
      /* Um instante no futuro (relógio de outra aba adiantado?) não vale. */
      return (isFinite(valor) && valor <= Date.now()) ? valor : 0;
    } catch (e) {
      return 0;
    }
  }

  function registrarAtividade() {
    var agora = Date.now();
    ultimaAtividade = agora;
    avisado = false;
    if (agora - ultimaGravacao >= GRAVAR_ATIVIDADE_A_CADA_MS) {
      ultimaGravacao = agora;
      try {
        var s = armazenamentoLocal();
        if (s) { s.setItem(CHAVE_ATIVIDADE, String(agora)); }
      } catch (e) { /* sem armazenamento: vale só a atividade desta aba */ }
    }
  }

  function verificarInatividade() {
    if (estado !== 'app' || !monitorando) { return; }
    var ultima = Math.max(ultimaAtividade, atividadeCompartilhada());
    var parado = Date.now() - ultima;
    var limite = limiteInatividadeMs();
    if (parado >= limite) {
      encerrar('inatividade');
      return;
    }
    if (!avisado && limite - parado <= AVISO_ANTES_MS) {
      avisado = true;
      U.torrada('Sem uso há algum tempo: a sessão será encerrada em menos de 1 minuto. ' +
        'Toque na tela ou use o teclado para continuar.', 'atencao', 12000);
    }
  }

  function aoVoltarParaPagina() {
    if (document.visibilityState === 'visible') { verificarInatividade(); }
  }

  function iniciarMonitor() {
    pararMonitor();
    monitorando = true;
    ultimaGravacao = 0;
    registrarAtividade();
    EVENTOS_ATIVIDADE.forEach(function (nome) {
      document.addEventListener(nome, registrarAtividade, { capture: true, passive: true });
    });
    document.addEventListener('visibilitychange', aoVoltarParaPagina);
    window.addEventListener('pageshow', verificarInatividade);
    window.addEventListener('focus', verificarInatividade);
    verificador = window.setInterval(verificarInatividade, VERIFICAR_A_CADA_MS);
  }

  function pararMonitor() {
    monitorando = false;
    window.clearInterval(verificador);
    verificador = null;
    EVENTOS_ATIVIDADE.forEach(function (nome) {
      document.removeEventListener(nome, registrarAtividade, { capture: true, passive: true });
    });
    document.removeEventListener('visibilitychange', aoVoltarParaPagina);
    window.removeEventListener('pageshow', verificarInatividade);
    window.removeEventListener('focus', verificarInatividade);
  }

  /* ---------- abertura ---------- */

  var apiIniciada = false;

  function abrir() {
    estado = 'inicio';
    carregando('Conectando…');
    Promise.resolve().then(function () {
      /* "Tentar novamente" depois de uma falha de rede não recria o cliente. */
      return apiIniciada ? null : Api.iniciar();
    }).then(function () {
      apiIniciada = true;
      return Api.sessaoAtual();
    }).then(function (sessao) {
      if (!sessao) { telaLogin(); return; }
      /* Adaptador que sinaliza login pela metade (senha certa, código do
         segundo fator ainda não informado): pede o código. */
      if (sessao.precisaMfa) { telaMfa(); return; }
      carregarPerfil();
    }).catch(function (erro) {
      console.error(erro);
      telaErroConexao(erro);
    });
  }

  function iniciar(aoEntrar, aoSair) {
    aoEntrarCb = aoEntrar;
    aoSairCb = aoSair;

    if (!tela()) { return; }
    if (typeof U === 'undefined' || typeof Regras === 'undefined') {
      /* Sem util/regras não há nem como escapar texto: mensagem fixa. */
      tela().textContent = 'Não foi possível iniciar o sistema: arquivos incompletos. Recarregue a página.';
      return;
    }
    if (typeof AQS_CONFIG === 'undefined') {
      telaErroCarga('assets/js/config.js não carregou.');
      return;
    }
    /* A configuração só importa no sistema real; a demonstração não usa rede. */
    var demo = !!window.ApiDemo;
    if (!demo) {
      var faltas = configuracaoPendente();
      if (faltas.length) {
        telaConfiguracaoPendente(faltas);
        return;
      }
    }
    if (typeof Api === 'undefined') {
      telaErroCarga('a camada de acesso aos dados (Api) não foi carregada.');
      return;
    }

    if (!cancelarOuvinteSessao) {
      try {
        cancelarOuvinteSessao = Api.aoMudarSessao(aoMudarSessao);
      } catch (erro) {
        console.error(erro);
      }
    }
    abrir();
  }

  return {
    iniciar: iniciar,
    sair: sair,
    /* Ajudantes de formulário de senha, usados também por Minha conta. */
    campoSenhaHtml: campoSenhaHtml,
    requisitosSenhaHtml: requisitosSenhaHtml,
    dicasSenhaHtml: dicasSenhaHtml,
    ligarMostrarSenha: ligarMostrarSenha,
    ocultarSenhas: ocultarSenhas,
    ligarRequisitos: ligarRequisitos,
    avaliarRequisitos: avaliarRequisitos,
    validarNovaSenha: validarNovaSenha,
    limparErroAoEditar: limparErroAoEditar,
    iniciais: iniciais,
    limiteInatividadeMinutos: function () { return Math.round(limiteInatividadeMs() / 60000); }
  };
})();
