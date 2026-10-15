/* =========================================================================
   HABE – AQS e NSP — configuração da implantação
   Preencha com os dados do SEU projeto Supabase (Painel → Project Settings
   → API). A chave "anon"/"publishable" é pública por natureza: quem protege
   os dados são as regras de acesso (RLS) do banco. NUNCA coloque aqui a
   chave "service_role"/"secret".
   ========================================================================= */

var AQS_CONFIG = {
  SUPABASE_URL: 'https://SEU-PROJETO.supabase.co',
  SUPABASE_ANON_KEY: 'COLE-AQUI-A-CHAVE-ANON',

  /* Sai sozinho depois deste tempo sem uso (minutos). */
  INATIVIDADE_MINUTOS: 30,

  /* Tamanho máximo de cada arquivo de evidência. Deve ser igual ao limite
     configurado no bucket "evidencias" do Supabase. */
  LIMITE_ARQUIVO_MB: 20,

  NOME_SISTEMA: 'HABE · AQS e NSP',
  SUBTITULO: 'Ferramenta de Gestão de Atividades',
  ORGANIZACAO: 'Hospital de Aeronáutica de Belém'
};
