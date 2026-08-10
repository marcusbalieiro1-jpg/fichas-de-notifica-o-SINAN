/* =========================================================================
   HABE SINAN — Catálogo de fichas de notificação
   -------------------------------------------------------------------------
   Este é o ÚNICO arquivo que precisa ser editado para manter o acervo em dia.

   Campos de cada ficha
   --------------------
   id          Identificador interno (minúsculo, sem acento, sem espaço).
   nome        Nome do agravo/doença como aparecerá no sumário.
   grupo       Agrupamento temático (usado nos filtros e relatórios).
   cid10       CID-10 principal, quando aplicável.
   classificacao
               'imediata'    -> notificação compulsória IMEDIATA (até 24 h).
               'condicional' -> semanal em regra, MAS imediata em situações
                                específicas (descritas em gatilhoImediato).
               'semanal'     -> notificação compulsória semanal (até 7 dias).
   prazo       Texto curto exibido ao médico.
   gatilhoImediato
               Quando a ficha for 'condicional', descreve exatamente em que
               situação o prazo passa a ser de 24 h.
   sinonimos   Termos alternativos usados apenas pela busca.
   arquivo     Caminho do PDF no acervo local (pasta fichas/). É o que o
               sistema entrega no download automático.
   urlOficial  Endereço do PDF no portal do Ministério da Saúde.
   urlVerificada
               true  -> link conferido manualmente e funcionando.
               false -> link ainda não conferido; o sistema não o apresenta
                        como oficial e direciona para o portal do Sinan.
   observacao  Nota operacional exibida na ficha.

   Conferência normativa: ver docs/CONFERENCIA-NORMATIVA.md antes de usar
   em produção. A coluna `classificacao` reproduz a Lista Nacional de
   Notificação Compulsória (Anexo 1 do Anexo V da Portaria de Consolidação
   GM/MS nº 4/2017, com as alterações posteriores) e deve ser revalidada a
   cada nova portaria.
   ========================================================================= */

var HABE_CATALOGO = {

  /* Metadados da revisão do catálogo — exibidos no rodapé do sistema. */
  revisao: {
    versao: '1.0',
    baseNormativa: 'Portaria de Consolidação GM/MS nº 4/2017, Anexo 1 do Anexo V, ' +
                   'com as alterações introduzidas até a Portaria GM/MS nº 11.211, de 13/05/2026',
    atualizadoEm: '2026-08-06',
    conferidoPor: '',            // preencher após a conferência do Núcleo de Epidemiologia
    conferidoEm: '',             // data da conferência (AAAA-MM-DD)
    portalSinan: 'https://portalsinan.saude.gov.br/notificacoes'
  },

  /* ---------------------------------------------------------------------
     IDENTIFICAÇÃO DA UNIDADE
     Fica aqui, e não nas configurações do navegador, para que as duas
     páginas — a de consulta e a do Núcleo — mostrem o mesmo contato em
     qualquer computador, sem precisar configurar máquina por máquina.
     PREENCHA O RAMAL E O PLANTÃO antes de distribuir aos consultórios.
     --------------------------------------------------------------------- */
  unidade: {
    nome: 'Hospital de Aeronáutica de Belém',
    sigla: 'HABE',
    setor: 'Núcleo Hospitalar de Epidemiologia',
    siglaSetor: 'NHE',
    ramal: '',                   // ex.: '4137' — aparece nos avisos de notificação imediata
    plantao: '',                 // ex.: '(91) 90000-0000'
    email: '',
    horario: 'Segunda a sexta, das 8h às 17h'
  },

  /* Destinos possíveis do paciente após o atendimento. */
  destinos: [
    { id: 'domicilio', nome: 'Tratamento em domicílio', sigla: 'DOM' },
    { id: 'ui1',       nome: 'Internação — Unidade de Internação 1 (UI1)', sigla: 'UI1' },
    { id: 'ui2',       nome: 'Internação — Unidade de Internação 2 (UI2)', sigla: 'UI2' },
    { id: 'uti',       nome: 'Internação — Unidade de Terapia Intensiva (UTI)', sigla: 'UTI' }
  ],

  /* Legenda das classificações. */
  classificacoes: {
    imediata: {
      rotulo: 'Notificação IMEDIATA',
      prazo: 'até 24 horas',
      descricao: 'Notificar em até 24 horas a partir da suspeita inicial, por telefone, ' +
                 'e-mail ou formulário eletrônico, à Secretaria Municipal de Saúde, à ' +
                 'Secretaria Estadual e ao Ministério da Saúde, sem aguardar confirmação.',
      cor: 'urgente'
    },
    condicional: {
      rotulo: 'Semanal com gatilho imediato',
      prazo: 'até 7 dias — 24 h em situações específicas',
      descricao: 'Em regra a notificação é semanal, mas passa a ser imediata (24 h) nas ' +
                 'situações descritas na ficha. Confira o gatilho antes de definir o prazo.',
      cor: 'atencao'
    },
    semanal: {
      rotulo: 'Notificação semanal',
      prazo: 'até 7 dias',
      descricao: 'Registrar a notificação em até 7 dias a partir da suspeita, inserindo-a ' +
                 'no Sinan dentro da semana epidemiológica correspondente.',
      cor: 'padrao'
    }
  },

  /* ---------------------------------------------------------------------
     ACERVO DE FICHAS
     Ordem irrelevante: o sumário é montado alfabeticamente pelo sistema.
     --------------------------------------------------------------------- */
  fichas: [

    /* ---------- Notificação IMEDIATA (24 h) ---------- */
    {
      id: 'acidente-material-biologico',
      nome: 'Acidente de trabalho com exposição a material biológico',
      grupo: 'Saúde do trabalhador',
      cid10: 'Z20.9',
      classificacao: 'semanal',
      sinonimos: ['perfurocortante', 'agulha', 'exposição ocupacional', 'material biologico'],
      arquivo: 'fichas/acidente-material-biologico.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Notificar todo acidente com exposição a sangue ou fluidos corpóreos, ' +
                  'independentemente de o profissional ser servidor, militar ou terceirizado.'
    },
    {
      id: 'acidente-trabalho-grave',
      nome: 'Acidente de trabalho grave, fatal ou em crianças e adolescentes',
      grupo: 'Saúde do trabalhador',
      cid10: 'Y96',
      classificacao: 'semanal',
      sinonimos: ['acidente típico', 'acidente de trajeto', 'mutilação', 'óbito no trabalho'],
      arquivo: 'fichas/acidente-trabalho-grave.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Inclui acidentes com mutilação e todo acidente de trabalho envolvendo ' +
                  'menores de 18 anos.'
    },
    {
      id: 'acidente-animais-peconhentos',
      nome: 'Acidente por animais peçonhentos',
      grupo: 'Zoonoses e acidentes',
      cid10: 'X20-X29',
      classificacao: 'semanal',
      sinonimos: ['serpente', 'cobra', 'escorpião', 'aranha', 'lagarta', 'abelha', 'ofidismo'],
      arquivo: 'fichas/acidente-animais-peconhentos.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Registrar o tipo de animal, o tempo decorrido e a soroterapia administrada.'
    },
    {
      id: 'antraz-carbunculo',
      nome: 'Antraz pneumônico (carbúnculo)',
      grupo: 'Agentes de disseminação intencional',
      cid10: 'A22.1',
      classificacao: 'imediata',
      sinonimos: ['bacillus anthracis', 'carbunculo', 'bioterrorismo'],
      arquivo: 'fichas/antraz-carbunculo.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Agente de possível disseminação intencional. Comunicar imediatamente à ' +
                  'vigilância e à direção do hospital.'
    },
    {
      id: 'atendimento-antirrabico',
      nome: 'Atendimento antirrábico humano (profilaxia)',
      grupo: 'Zoonoses e acidentes',
      cid10: 'Z20.3',
      classificacao: 'semanal',
      sinonimos: ['mordedura', 'cão', 'gato', 'morcego', 'raiva profilaxia', 'antirrabica'],
      arquivo: 'fichas/atendimento-antirrabico.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Notificar todo atendimento por exposição a animal potencialmente ' +
                  'transmissor da raiva, mesmo sem indicação de vacina.'
    },
    {
      id: 'botulismo',
      nome: 'Botulismo',
      grupo: 'Doenças transmitidas por alimentos',
      cid10: 'A05.1',
      classificacao: 'imediata',
      sinonimos: ['clostridium botulinum', 'toxina botulinica', 'conserva'],
      arquivo: 'fichas/botulismo.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Todo caso suspeito é de notificação imediata. Preservar o alimento suspeito.'
    },
    {
      id: 'cancer-relacionado-trabalho',
      nome: 'Câncer relacionado ao trabalho',
      grupo: 'Saúde do trabalhador',
      cid10: 'C00-C97',
      classificacao: 'semanal',
      sinonimos: ['neoplasia ocupacional', 'benzeno', 'amianto', 'asbesto'],
      arquivo: 'fichas/cancer-relacionado-trabalho.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Descrever a exposição ocupacional e o tempo de latência.'
    },
    {
      id: 'chikungunya',
      nome: 'Chikungunya',
      grupo: 'Arboviroses',
      cid10: 'A92.0',
      classificacao: 'condicional',
      gatilhoImediato: 'Óbito suspeito ou confirmado por chikungunya: notificação IMEDIATA (24 h).',
      sinonimos: ['chikungunya', 'febre chikungunya', 'artralgia', 'arbovirose'],
      arquivo: 'fichas/dengue-chikungunya.pdf',
      urlOficial: 'https://portalsinan.saude.gov.br/images/documentos/Agravos/Dengue/Ficha_DENGCHIK_FINAL.pdf',
      urlVerificada: true,
      observacao: 'Utiliza a ficha única de notificação/investigação de Dengue e Chikungunya.'
    },
    {
      id: 'colera',
      nome: 'Cólera',
      grupo: 'Doenças transmitidas por alimentos',
      cid10: 'A00',
      classificacao: 'imediata',
      sinonimos: ['vibrio cholerae', 'diarreia aquosa', 'agua de arroz'],
      arquivo: 'fichas/colera.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Coletar amostra de fezes antes do início da antibioticoterapia.'
    },
    {
      id: 'coqueluche',
      nome: 'Coqueluche',
      grupo: 'Imunopreveníveis',
      cid10: 'A37',
      classificacao: 'imediata',
      sinonimos: ['bordetella pertussis', 'tosse comprida', 'pertussis', 'guincho'],
      arquivo: 'fichas/coqueluche.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Coletar swab de nasofaringe antes do antibiótico e avaliar quimioprofilaxia ' +
                  'dos contatos.'
    },
    {
      id: 'dengue',
      nome: 'Dengue',
      grupo: 'Arboviroses',
      cid10: 'A90',
      classificacao: 'condicional',
      gatilhoImediato: 'Óbito suspeito ou confirmado por dengue: notificação IMEDIATA (24 h).',
      sinonimos: ['dengue classica', 'dengue grave', 'aedes', 'arbovirose', 'prova do laco'],
      arquivo: 'fichas/dengue-chikungunya.pdf',
      urlOficial: 'https://portalsinan.saude.gov.br/images/documentos/Agravos/Dengue/Ficha_DENGCHIK_FINAL.pdf',
      urlVerificada: true,
      observacao: 'Ficha única de Dengue e Chikungunya. Classificar o caso segundo os sinais de alarme.'
    },
    {
      id: 'dermatoses-ocupacionais',
      nome: 'Dermatoses ocupacionais',
      grupo: 'Saúde do trabalhador',
      cid10: 'L23-L25',
      classificacao: 'semanal',
      sinonimos: ['dermatite de contato', 'eczema ocupacional'],
      arquivo: 'fichas/dermatoses-ocupacionais.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Registrar o agente químico ou físico envolvido.'
    },
    {
      id: 'difteria',
      nome: 'Difteria',
      grupo: 'Imunopreveníveis',
      cid10: 'A36',
      classificacao: 'imediata',
      sinonimos: ['corynebacterium diphtheriae', 'crupe', 'placa pseudomembranosa'],
      arquivo: 'fichas/difteria.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Periodicidade alterada para IMEDIATA. Avaliar soro antidiftérico e ' +
                  'quimioprofilaxia dos comunicantes.'
    },
    {
      id: 'doenca-chagas-aguda',
      nome: 'Doença de Chagas aguda',
      grupo: 'Doenças transmitidas por vetores',
      cid10: 'B57.1',
      classificacao: 'imediata',
      sinonimos: ['trypanosoma cruzi', 'barbeiro', 'chagas', 'acai', 'sinal de romana'],
      arquivo: 'fichas/doenca-chagas-aguda.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Na Amazônia, investigar transmissão oral por alimentos (açaí, bacaba, caldo de cana).'
    },
    {
      id: 'doenca-chagas-cronica',
      nome: 'Doença de Chagas crônica',
      grupo: 'Doenças transmitidas por vetores',
      cid10: 'B57.2',
      classificacao: 'semanal',
      sinonimos: ['chagas cronica', 'cardiopatia chagasica', 'megacolon'],
      arquivo: 'fichas/doenca-chagas-cronica.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Notificação de casos crônicos confirmados por sorologia.'
    },
    {
      id: 'doenca-meningococica',
      nome: 'Doença meningocócica',
      grupo: 'Meningites',
      cid10: 'A39',
      classificacao: 'imediata',
      sinonimos: ['neisseria meningitidis', 'meningococo', 'meningococcemia', 'purpura'],
      arquivo: 'fichas/meningite.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Utiliza a ficha de Meningite. Quimioprofilaxia dos contatos em até 48 h.'
    },
    {
      id: 'doencas-febris-hemorragicas',
      nome: 'Doenças febris hemorrágicas emergentes e reemergentes',
      grupo: 'Emergências em saúde pública',
      cid10: 'A96-A99',
      classificacao: 'imediata',
      sinonimos: ['ebola', 'marburg', 'lassa', 'arenavirus', 'febre purpurica brasileira'],
      arquivo: 'fichas/doencas-febris-hemorragicas.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Instituir precaução de contato e gotículas e acionar a vigilância antes ' +
                  'de qualquer transferência.'
    },
    {
      id: 'doencas-relacionadas-trabalho',
      nome: 'Doenças relacionadas ao trabalho (demais agravos)',
      grupo: 'Saúde do trabalhador',
      cid10: 'Z57',
      classificacao: 'semanal',
      sinonimos: ['doenca ocupacional', 'nexo causal', 'trabalho'],
      arquivo: 'fichas/doencas-relacionadas-trabalho.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Usar quando não houver ficha específica para o agravo ocupacional.'
    },
    {
      id: 'esporotricose',
      nome: 'Esporotricose humana',
      grupo: 'Zoonoses e acidentes',
      cid10: 'B42',
      classificacao: 'semanal',
      sinonimos: ['sporothrix', 'gato', 'micose', 'lesao nodular'],
      arquivo: 'fichas/esporotricose.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Investigar contato com felinos doentes.'
    },
    {
      id: 'esquistossomose',
      nome: 'Esquistossomose',
      grupo: 'Doenças transmitidas por vetores',
      cid10: 'B65',
      classificacao: 'semanal',
      sinonimos: ['schistosoma mansoni', 'barriga d agua', 'caramujo'],
      arquivo: 'fichas/esquistossomose.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Registrar contato com coleções hídricas e a procedência do paciente.'
    },
    {
      id: 'esavi',
      nome: 'Evento adverso grave pós-vacinação (ESAVI)',
      grupo: 'Imunopreveníveis',
      cid10: 'T88.1',
      classificacao: 'imediata',
      sinonimos: ['eapv', 'esavi', 'evento adverso vacina', 'reacao vacinal'],
      arquivo: 'fichas/esavi.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Eventos graves, óbitos e erros de imunização são de notificação imediata. ' +
                  'Registrar lote e fabricante do imunobiológico.'
    },
    {
      id: 'evento-saude-publica',
      nome: 'Evento de saúde pública (ESP) que constitua ameaça à saúde pública',
      grupo: 'Emergências em saúde pública',
      cid10: '—',
      classificacao: 'imediata',
      sinonimos: ['esp', 'surto', 'agregado de casos', 'evento inusitado', 'emergencia'],
      arquivo: 'fichas/evento-saude-publica.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Inclui surtos, agregados de casos e agravos inusitados. Notificar mesmo ' +
                  'sem diagnóstico definido.'
    },
    {
      id: 'febre-amarela',
      nome: 'Febre amarela',
      grupo: 'Arboviroses',
      cid10: 'A95',
      classificacao: 'imediata',
      sinonimos: ['febre amarela silvestre', 'icterohemorragica', 'macaco', 'haemagogus'],
      arquivo: 'fichas/febre-amarela.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Todo caso suspeito é imediato. Verificar situação vacinal e deslocamentos ' +
                  'nos 15 dias anteriores.'
    },
    {
      id: 'febre-nilo-ocidental',
      nome: 'Febre do Nilo Ocidental e outras arboviroses de importância em saúde pública',
      grupo: 'Arboviroses',
      cid10: 'A92.3',
      classificacao: 'imediata',
      sinonimos: ['west nile', 'nilo ocidental', 'encefalite arboviral', 'mayaro'],
      arquivo: 'fichas/febre-nilo-ocidental.pdf',
      urlOficial: 'https://portalsinan.saude.gov.br/images/documentos/Agravos/Febre_do_Nilo/FEBRE_DO_NILO.pdf',
      urlVerificada: true,
      observacao: 'Abrange arboviroses emergentes sem ficha própria.'
    },
    {
      id: 'febre-oropouche',
      nome: 'Febre do Oropouche',
      grupo: 'Arboviroses',
      cid10: 'A93.0',
      classificacao: 'condicional',
      gatilhoImediato: 'Óbito, caso em gestante, anomalia congênita ou óbito fetal associados ' +
                       'ao Oropouche: notificação IMEDIATA (24 h).',
      sinonimos: ['oropouche', 'maruim', 'culicoides', 'arbovirose amazonica'],
      arquivo: 'fichas/febre-oropouche.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Agravo de alta relevância na região amazônica. Investigar exposição a maruim.'
    },
    {
      id: 'febre-maculosa',
      nome: 'Febre maculosa e outras riquetsioses',
      grupo: 'Zoonoses e acidentes',
      cid10: 'A77',
      classificacao: 'imediata',
      sinonimos: ['rickettsia', 'carrapato', 'estrela', 'maculosa', 'riquetsiose'],
      arquivo: 'fichas/febre-maculosa.pdf',
      urlOficial: 'https://portalsinan.saude.gov.br/images/documentos/Agravos/Febre%20Maculosa/Febre_Maculosa_v5.pdf',
      urlVerificada: true,
      observacao: 'Iniciar doxiciclina na suspeita clínica, sem aguardar confirmação laboratorial.'
    },
    {
      id: 'febre-tifoide',
      nome: 'Febre tifoide',
      grupo: 'Doenças transmitidas por alimentos',
      cid10: 'A01.0',
      classificacao: 'imediata',
      sinonimos: ['salmonella typhi', 'tifo', 'febre entérica'],
      arquivo: 'fichas/febre-tifoide.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Coletar hemocultura antes do antibiótico e investigar a fonte de água/alimento.'
    },
    {
      id: 'hanseniase',
      nome: 'Hanseníase',
      grupo: 'Doenças crônicas transmissíveis',
      cid10: 'A30',
      classificacao: 'semanal',
      sinonimos: ['lepra', 'mycobacterium leprae', 'mancha hipocromica', 'neurite'],
      arquivo: 'fichas/hanseniase.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Classificar em paucibacilar ou multibacilar e avaliar o grau de incapacidade física.'
    },
    {
      id: 'hantavirose',
      nome: 'Hantavirose',
      grupo: 'Zoonoses e acidentes',
      cid10: 'B33.4',
      classificacao: 'imediata',
      sinonimos: ['hantavirus', 'roedor', 'sindrome cardiopulmonar', 'ratos'],
      arquivo: 'fichas/hantavirose.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Investigar exposição a roedores silvestres nos 60 dias anteriores.'
    },
    {
      id: 'hepatites-virais',
      nome: 'Hepatites virais',
      grupo: 'Doenças crônicas transmissíveis',
      cid10: 'B15-B19',
      classificacao: 'semanal',
      sinonimos: ['hepatite a', 'hepatite b', 'hepatite c', 'hepatite d', 'hepatite e', 'ictericia'],
      arquivo: 'fichas/hepatites-virais.pdf',
      urlOficial: 'https://portalsinan.saude.gov.br/images/documentos/Agravos/Hepatites_Virais/Ficha_Hepatites_Virais.pdf',
      urlVerificada: true,
      observacao: 'Preencher os marcadores sorológicos disponíveis no momento da notificação.'
    },
    {
      id: 'hiv-aids-adulto',
      nome: 'HIV/aids — adulto e criança',
      grupo: 'IST e HIV',
      cid10: 'B20-B24',
      classificacao: 'semanal',
      sinonimos: ['aids', 'hiv', 'sida', 'imunodeficiencia', 'cd4', 'carga viral'],
      arquivo: 'fichas/hiv-aids.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Sigilo reforçado: envelope lacrado e entrega direta ao Núcleo de Epidemiologia.'
    },
    {
      id: 'hiv-gestante',
      nome: 'HIV em gestante, parturiente, puérpera e criança exposta',
      grupo: 'IST e HIV',
      cid10: 'Z21',
      classificacao: 'semanal',
      sinonimos: ['hiv gestante', 'transmissao vertical', 'crianca exposta', 'puerpera'],
      arquivo: 'fichas/hiv-gestante.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Registrar profilaxia antirretroviral da mãe e do recém-nascido.'
    },
    {
      id: 'influenza-novo-subtipo',
      nome: 'Influenza humana produzida por novo subtipo viral',
      grupo: 'Respiratórias',
      cid10: 'J09',
      classificacao: 'imediata',
      sinonimos: ['influenza pandemica', 'gripe aviaria', 'h5n1', 'novo subtipo', 'h7n9'],
      arquivo: 'fichas/influenza-novo-subtipo.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Investigar contato com aves ou suínos e histórico de viagem. Precaução ' +
                  'respiratória imediata.'
    },
    {
      id: 'intoxicacao-exogena',
      nome: 'Intoxicação exógena',
      grupo: 'Agravos ambientais e químicos',
      cid10: 'T36-T65',
      classificacao: 'semanal',
      sinonimos: ['envenenamento', 'agrotoxico', 'medicamento', 'raticida', 'chumbinho',
                  'tentativa de suicidio', 'intoxicacao'],
      arquivo: 'fichas/intoxicacao-exogena.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Se a intoxicação for por tentativa de autoextermínio, notificar TAMBÉM a ' +
                  'ficha de Violência interpessoal/autoprovocada (imediata em 24 h).'
    },
    {
      id: 'leishmaniose-tegumentar',
      nome: 'Leishmaniose tegumentar americana',
      grupo: 'Doenças transmitidas por vetores',
      cid10: 'B55.1',
      classificacao: 'semanal',
      sinonimos: ['ltа', 'ulcera de bauru', 'ferida brava', 'flebotomineo', 'leishmaniose cutanea'],
      arquivo: 'fichas/leishmaniose-tegumentar.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Registrar a forma clínica (cutânea, mucosa ou cutâneo-mucosa).'
    },
    {
      id: 'leishmaniose-visceral',
      nome: 'Leishmaniose visceral',
      grupo: 'Doenças transmitidas por vetores',
      cid10: 'B55.0',
      classificacao: 'semanal',
      sinonimos: ['calazar', 'leishmania chagasi', 'hepatoesplenomegalia', 'lv'],
      arquivo: 'fichas/leishmaniose-visceral.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Atenção aos sinais de gravidade; letalidade elevada em menores de 1 ano e idosos.'
    },
    {
      id: 'leptospirose',
      nome: 'Leptospirose',
      grupo: 'Zoonoses e acidentes',
      cid10: 'A27',
      classificacao: 'semanal',
      sinonimos: ['leptospira', 'enchente', 'rato', 'sindrome de weil', 'mialgia panturrilha'],
      arquivo: 'fichas/leptospirose.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Investigar contato com água ou lama de enchente nos 30 dias anteriores.'
    },
    {
      id: 'ler-dort',
      nome: 'LER/DORT — lesões por esforços repetitivos',
      grupo: 'Saúde do trabalhador',
      cid10: 'M65-M79',
      classificacao: 'semanal',
      sinonimos: ['ler', 'dort', 'tendinite', 'esforco repetitivo', 'tunel do carpo'],
      arquivo: 'fichas/ler-dort.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Descrever a atividade laboral e o tempo de exposição.'
    },
    {
      id: 'malaria',
      nome: 'Malária',
      grupo: 'Doenças transmitidas por vetores',
      cid10: 'B50-B54',
      classificacao: 'condicional',
      gatilhoImediato: 'Caso de malária na região EXTRA-AMAZÔNICA e óbito por malária: ' +
                       'notificação IMEDIATA (24 h). Na região amazônica, a notificação é semanal.',
      sinonimos: ['plasmodium', 'falciparum', 'vivax', 'anopheles', 'gota espessa', 'maleita'],
      arquivo: 'fichas/malaria.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Belém integra a região amazônica: notificação semanal via Sivep-Malária, ' +
                  'salvo óbito. Confirmar o fluxo vigente com o Núcleo de Epidemiologia.'
    },
    {
      id: 'meningites',
      nome: 'Meningites (demais etiologias)',
      grupo: 'Meningites',
      cid10: 'G00-G03',
      classificacao: 'semanal',
      sinonimos: ['meningite bacteriana', 'meningite viral', 'liquor', 'rigidez de nuca'],
      arquivo: 'fichas/meningite.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Se houver suspeita de doença meningocócica, o prazo passa a ser IMEDIATO.'
    },
    {
      id: 'mpox',
      nome: 'Mpox (varíola dos macacos)',
      grupo: 'Emergências em saúde pública',
      cid10: 'B04',
      classificacao: 'imediata',
      sinonimos: ['monkeypox', 'variola dos macacos', 'mpox', 'lesao vesiculopustulosa'],
      arquivo: 'fichas/mpox.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Isolamento de contato e gotículas. Coletar swab das lesões.'
    },
    {
      id: 'obito-materno',
      nome: 'Óbito materno',
      grupo: 'Vigilância de óbitos',
      cid10: 'O95',
      classificacao: 'imediata',
      sinonimos: ['morte materna', 'obito gestante', 'puerperio', 'mortalidade materna'],
      arquivo: 'fichas/obito-materno.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Todo óbito de mulher em idade fértil (10 a 49 anos) deve ser investigado.'
    },
    {
      id: 'obito-infantil-fetal',
      nome: 'Óbito infantil e fetal',
      grupo: 'Vigilância de óbitos',
      cid10: 'P95',
      classificacao: 'imediata',
      sinonimos: ['natimorto', 'obito neonatal', 'mortalidade infantil', 'obito fetal'],
      arquivo: 'fichas/obito-infantil-fetal.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Investigação obrigatória de óbitos fetais e de menores de 1 ano.'
    },
    {
      id: 'pair',
      nome: 'PAIR — perda auditiva induzida por ruído',
      grupo: 'Saúde do trabalhador',
      cid10: 'H83.3',
      classificacao: 'semanal',
      sinonimos: ['pair', 'surdez ocupacional', 'ruido', 'audiometria'],
      arquivo: 'fichas/pair.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Anexar a audiometria e o histórico de exposição a ruído ocupacional.'
    },
    {
      id: 'paralisia-flacida-aguda',
      nome: 'Paralisia flácida aguda / poliomielite',
      grupo: 'Imunopreveníveis',
      cid10: 'A80',
      classificacao: 'imediata',
      sinonimos: ['pfa', 'polio', 'poliomielite', 'paralisia flacida', 'guillain barre'],
      arquivo: 'fichas/paralisia-flacida-aguda.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Toda PFA em menor de 15 anos é notificação imediata. Coletar duas amostras ' +
                  'de fezes nos primeiros 14 dias do déficit.'
    },
    {
      id: 'parotidite',
      nome: 'Parotidite infecciosa (caxumba)',
      grupo: 'Imunopreveníveis',
      cid10: 'B26',
      classificacao: 'imediata',
      sinonimos: ['caxumba', 'papeira', 'parotidite', 'orquite'],
      arquivo: 'fichas/parotidite.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Agravo incluído na Lista Nacional com exigência de notificação imediata. ' +
                  'Verificar situação vacinal (tríplice viral).'
    },
    {
      id: 'peste',
      nome: 'Peste',
      grupo: 'Zoonoses e acidentes',
      cid10: 'A20',
      classificacao: 'imediata',
      sinonimos: ['yersinia pestis', 'peste bubonica', 'peste pneumonica', 'bubao'],
      arquivo: 'fichas/peste.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Isolamento respiratório na suspeita de peste pneumônica.'
    },
    {
      id: 'pneumoconioses',
      nome: 'Pneumoconioses relacionadas ao trabalho',
      grupo: 'Saúde do trabalhador',
      cid10: 'J60-J65',
      classificacao: 'semanal',
      sinonimos: ['silicose', 'asbestose', 'antracose', 'poeira mineral'],
      arquivo: 'fichas/pneumoconioses.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Anexar a radiografia de tórax e a história ocupacional.'
    },
    {
      id: 'raiva-humana',
      nome: 'Raiva humana',
      grupo: 'Zoonoses e acidentes',
      cid10: 'A82',
      classificacao: 'imediata',
      sinonimos: ['raiva', 'hidrofobia', 'lyssavirus', 'encefalite rabica'],
      arquivo: 'fichas/raiva-humana.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Caso humano suspeito: notificação imediata. Para exposição sem doença, ' +
                  'usar a ficha de Atendimento antirrábico.'
    },
    {
      id: 'rubeola',
      nome: 'Rubéola',
      grupo: 'Doenças exantemáticas',
      cid10: 'B06',
      classificacao: 'imediata',
      sinonimos: ['rubeola', 'exantema', 'linfadenopatia retroauricular'],
      arquivo: 'fichas/doencas-exantematicas.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Ficha única de doenças exantemáticas (sarampo/rubéola). Coletar sorologia ' +
                  'e swab na primeira oportunidade.'
    },
    {
      id: 'sarampo',
      nome: 'Sarampo',
      grupo: 'Doenças exantemáticas',
      cid10: 'B05',
      classificacao: 'imediata',
      sinonimos: ['sarampo', 'morbili', 'koplik', 'exantema maculopapular'],
      arquivo: 'fichas/doencas-exantematicas.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Ficha única de doenças exantemáticas. Isolamento aéreo e bloqueio vacinal ' +
                  'dos contatos em até 72 h.'
    },
    {
      id: 'sifilis-adquirida',
      nome: 'Sífilis adquirida',
      grupo: 'IST e HIV',
      cid10: 'A53.9',
      classificacao: 'semanal',
      sinonimos: ['sifilis', 'treponema pallidum', 'vdrl', 'cancro duro'],
      arquivo: 'fichas/sifilis-adquirida.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Registrar titulação do teste não treponêmico e o esquema de penicilina.'
    },
    {
      id: 'sifilis-congenita',
      nome: 'Sífilis congênita',
      grupo: 'IST e HIV',
      cid10: 'A50',
      classificacao: 'semanal',
      sinonimos: ['sifilis congenita', 'recem nascido', 'transmissao vertical'],
      arquivo: 'fichas/sifilis-congenita.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Notificar todo recém-nascido de mãe com sífilis não tratada ou tratada ' +
                  'inadequadamente.'
    },
    {
      id: 'sifilis-gestante',
      nome: 'Sífilis em gestante',
      grupo: 'IST e HIV',
      cid10: 'O98.1',
      classificacao: 'semanal',
      sinonimos: ['sifilis gestante', 'pre natal', 'vdrl gestante'],
      arquivo: 'fichas/sifilis-gestante.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Registrar a idade gestacional no diagnóstico e o tratamento da parceria sexual.'
    },
    {
      id: 'sindrome-congenita-zika',
      nome: 'Síndrome congênita associada à infecção pelo vírus Zika',
      grupo: 'Arboviroses',
      cid10: 'P35.4',
      classificacao: 'imediata',
      sinonimos: ['microcefalia', 'zika congenito', 'anomalia congenita', 'sindrome congenita'],
      arquivo: 'fichas/sindrome-congenita-zika.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Notificação imediata de anomalias congênitas possivelmente relacionadas a ' +
                  'infecções durante a gestação.'
    },
    {
      id: 'srag',
      nome: 'Síndrome respiratória aguda grave (SRAG)',
      grupo: 'Respiratórias',
      cid10: 'J06.9',
      classificacao: 'imediata',
      sinonimos: ['srag', 'sindrome respiratoria aguda grave', 'saturacao', 'dispneia',
                  'influenza', 'covid', 'sars-cov-2', 'sindrome gripal'],
      arquivo: 'fichas/srag.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Todo caso hospitalizado de SRAG e todo óbito por SRAG são de notificação ' +
                  'imediata, incluindo os casos confirmados de covid-19. Coletar swab ' +
                  'nasofaríngeo até o 7º dia de sintomas.'
    },
    {
      id: 'tetano-acidental',
      nome: 'Tétano acidental',
      grupo: 'Imunopreveníveis',
      cid10: 'A35',
      classificacao: 'imediata',
      sinonimos: ['tetano', 'trismo', 'clostridium tetani', 'ferimento'],
      arquivo: 'fichas/tetano-acidental.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Periodicidade alterada para IMEDIATA. Verificar profilaxia (vacina e soro).'
    },
    {
      id: 'tetano-neonatal',
      nome: 'Tétano neonatal',
      grupo: 'Imunopreveníveis',
      cid10: 'A33',
      classificacao: 'imediata',
      sinonimos: ['tetano neonatal', 'mal de sete dias', 'recem nascido'],
      arquivo: 'fichas/tetano-neonatal.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Todo caso suspeito em menor de 28 dias é notificação imediata.'
    },
    {
      id: 'toxoplasmose-congenita',
      nome: 'Toxoplasmose congênita e gestacional',
      grupo: 'Vigilância materno-infantil',
      cid10: 'P37.1',
      classificacao: 'semanal',
      sinonimos: ['toxoplasma gondii', 'toxoplasmose', 'igm gestante', 'coriorretinite'],
      arquivo: 'fichas/toxoplasmose-congenita.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Registrar sorologias maternas e do recém-nascido.'
    },
    {
      id: 'tracoma',
      nome: 'Tracoma',
      grupo: 'Doenças crônicas transmissíveis',
      cid10: 'A71',
      classificacao: 'semanal',
      sinonimos: ['chlamydia trachomatis', 'tracoma', 'triquiase', 'conjuntivite folicular'],
      arquivo: 'fichas/tracoma.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Classificar a forma clínica conforme o exame externo ocular.'
    },
    {
      id: 'transtornos-mentais-trabalho',
      nome: 'Transtornos mentais relacionados ao trabalho',
      grupo: 'Saúde do trabalhador',
      cid10: 'F00-F99',
      classificacao: 'semanal',
      sinonimos: ['burnout', 'assedio moral', 'estresse ocupacional', 'depressao trabalho'],
      arquivo: 'fichas/transtornos-mentais-trabalho.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Descrever a organização do trabalho e os fatores psicossociais envolvidos.'
    },
    {
      id: 'tuberculose',
      nome: 'Tuberculose',
      grupo: 'Doenças crônicas transmissíveis',
      cid10: 'A15-A19',
      classificacao: 'semanal',
      sinonimos: ['tb', 'bacilo de koch', 'baar', 'teste rapido molecular', 'tosse cronica'],
      arquivo: 'fichas/tuberculose.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Notificar todo caso novo, recidiva e reingresso após abandono. Investigar ' +
                  'os contatos intradomiciliares.'
    },
    {
      id: 'tularemia',
      nome: 'Tularemia',
      grupo: 'Agentes de disseminação intencional',
      cid10: 'A21',
      classificacao: 'imediata',
      sinonimos: ['francisella tularensis', 'tularemia', 'bioterrorismo'],
      arquivo: 'fichas/tularemia.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Agente de possível disseminação intencional.'
    },
    {
      id: 'varicela',
      nome: 'Varicela (catapora)',
      grupo: 'Doenças exantemáticas',
      cid10: 'B01',
      classificacao: 'condicional',
      gatilhoImediato: 'Caso grave internado, óbito por varicela ou surto: notificação ' +
                       'IMEDIATA (24 h).',
      sinonimos: ['catapora', 'varicela', 'vesicula', 'herpes zoster'],
      arquivo: 'fichas/varicela.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Casos leves e isolados não exigem notificação individual; surtos, sim.'
    },
    {
      id: 'variola',
      nome: 'Varíola',
      grupo: 'Agentes de disseminação intencional',
      cid10: 'B03',
      classificacao: 'imediata',
      sinonimos: ['variola', 'smallpox', 'bioterrorismo', 'orthopoxvirus'],
      arquivo: 'fichas/variola.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Doença erradicada: qualquer suspeita configura emergência de saúde pública ' +
                  'de importância internacional.'
    },
    {
      id: 'violencia-interpessoal',
      nome: 'Violência interpessoal e autoprovocada',
      grupo: 'Violências e causas externas',
      cid10: 'Y09',
      classificacao: 'condicional',
      gatilhoImediato: 'Violência SEXUAL e TENTATIVA DE SUICÍDIO: notificação IMEDIATA (24 h). ' +
                       'Demais violências: semanal.',
      sinonimos: ['violencia domestica', 'estupro', 'tentativa de suicidio', 'autoextermínio',
                  'maus tratos', 'negligencia', 'violencia sexual', 'agressao'],
      arquivo: 'fichas/violencia-interpessoal.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Notificação obrigatória independentemente de boletim de ocorrência. ' +
                  'Em casos de criança, adolescente, idoso ou pessoa com deficiência, ' +
                  'comunicar também o Conselho Tutelar ou a autoridade competente.'
    },
    {
      id: 'zika',
      nome: 'Zika (doença aguda pelo vírus Zika)',
      grupo: 'Arboviroses',
      cid10: 'A92.5',
      classificacao: 'condicional',
      gatilhoImediato: 'Caso em GESTANTE e ÓBITO por Zika: notificação IMEDIATA (24 h).',
      sinonimos: ['zika', 'zikv', 'exantema pruriginoso', 'conjuntivite nao purulenta'],
      arquivo: 'fichas/zika.pdf',
      urlOficial: null,
      urlVerificada: false,
      observacao: 'Sempre questionar a possibilidade de gestação em mulheres em idade fértil.'
    },

    /* ---------- Fichas de uso geral ---------- */
    {
      id: 'notificacao-individual',
      nome: 'Notificação individual (ficha genérica do Sinan)',
      grupo: 'Fichas de uso geral',
      cid10: '—',
      classificacao: 'semanal',
      sinonimos: ['ficha branca', 'notificacao individual', 'generica', 'sinan net'],
      arquivo: 'fichas/notificacao-individual.pdf',
      urlOficial: 'https://portalsinan.saude.gov.br/images/documentos/Agravos/NINDIV/Notificacao_Individual_v5.pdf',
      urlVerificada: true,
      observacao: 'Usar quando o agravo não possuir ficha específica ou por orientação do ' +
                  'Núcleo de Epidemiologia.'
    },
    {
      id: 'ficha-conclusao',
      nome: 'Ficha de conclusão (encerramento de caso)',
      grupo: 'Fichas de uso geral',
      cid10: '—',
      classificacao: 'semanal',
      sinonimos: ['conclusao', 'encerramento', 'fechamento de caso'],
      arquivo: 'fichas/ficha-conclusao.pdf',
      urlOficial: 'https://portalsinan.saude.gov.br/images/documentos/Agravos/NINDIV/Ficha_conclusao_v5.pdf',
      urlVerificada: true,
      observacao: 'Complementa a notificação individual para encerramento do caso.'
    }
  ]
};

/* Índice auxiliar por id, montado uma única vez. */
HABE_CATALOGO.porId = (function () {
  var mapa = {};
  for (var i = 0; i < HABE_CATALOGO.fichas.length; i++) {
    mapa[HABE_CATALOGO.fichas[i].id] = HABE_CATALOGO.fichas[i];
  }
  return mapa;
})();
