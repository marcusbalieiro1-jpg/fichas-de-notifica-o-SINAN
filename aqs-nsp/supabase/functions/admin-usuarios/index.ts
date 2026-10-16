/* =========================================================================
   HABE · AQS e NSP — Edge Function "admin-usuarios" (Deno, Supabase)
   Liga a lógica (logica.ts) ao Supabase de verdade. Quem chama é a tela
   Equipe, via Api.adminUsuario (assets/js/api-supabase.js).

   IMPLANTAÇÃO (uma vez, e de novo sempre que este arquivo ou logica.ts
   mudar) — com a Supabase CLI, na pasta aqs-nsp:
     supabase login
     supabase link --project-ref <ref-do-projeto>
     supabase secrets set ORIGEM_PERMITIDA=https://endereco-do-site-da-ferramenta
     supabase functions deploy admin-usuarios --no-verify-jwt
   (Sem a CLI: Painel → Edge Functions → Deploy a new function → editor,
   nome "admin-usuarios", colando index.ts e logica.ts; o segredo vai em
   Edge Functions → Secrets.)

   * ORIGEM_PERMITIDA: endereço(s) de onde a ferramenta é aberta, sem barra
     no fim, separados por vírgula (ex.: https://habe-aqs-nsp.pages.dev e
     um endereço de teste). Sem ele, nenhum navegador consegue usar a função — de
     propósito. Mudou o endereço do site? Atualize o segredo.
   * --no-verify-jwt: a própria função confere o token do chamador
     (auth.getUser) e o papel dele no banco; desligar a verificação do
     gateway evita que a pré-verificação de CORS (OPTIONS, que não leva
     token) seja barrada e funciona com as chaves de assinatura novas do
     Supabase.
   * SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY são
     fornecidas pelo próprio Supabase a toda Edge Function. Se um dia o
     projeto deixar de fornecer as chaves no formato antigo (só as novas
     sb_publishable_…/sb_secret_…), crie os segredos AQS_CHAVE_PUBLICA e
     AQS_CHAVE_SERVICO com essas chaves: a função passa a usá-los
     (docs/IMPLANTACAO.md explica). A service role
     NUNCA sai daqui: ela ignora a RLS, por isso cada ação é conferida pela
     lógica antes de ser executada.
   * As GRAVAÇÕES em public.militares (ligar o login, desativar, reativar,
     trocar o e-mail, excluir) usam o token de QUEM CHAMOU, não a service
     role: assim a RLS e os gatilhos valem de novo com a identidade real e a
     auditoria genérica do banco registra o gestor que fez a mudança (com a
     service role ela ficaria sem autor). A service role fica só para o
     Auth (auth.admin.*), as leituras de conferência e a linha ADMIN:<ação>
     da auditoria (authenticated não grava em auditoria).
   ========================================================================= */

import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { tratarRequisicao } from './logica.ts';
import type { AtributosUsuario, Dependencias, FatorMfa, LinhaAuditoria, Militar, UsuarioToken } from './logica.ts';

const URL_SUPABASE = Deno.env.get('SUPABASE_URL') ?? '';
/* As variáveis padrão vêm primeiro; os segredos AQS_* são o plano B para
   projetos que só têm as chaves novas (ver o comentário do topo). */
const CHAVE_ANON = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('AQS_CHAVE_PUBLICA') || '';
const CHAVE_SERVICO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('AQS_CHAVE_SERVICO') || '';
const ORIGEM_PERMITIDA = Deno.env.get('ORIGEM_PERMITIDA') ?? '';

/* Corpo maior que isto não é um pedido legítimo desta função. */
const TAMANHO_MAXIMO_CORPO = 16 * 1024;

const COLUNAS_MILITAR = 'id, usuario_id, posto, nome_guerra, email, papel, ativo';

const OPCOES_AUTH = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

const configurada = !!(URL_SUPABASE && CHAVE_SERVICO);

const admin = configurada
  ? createClient(URL_SUPABASE, CHAVE_SERVICO, { auth: OPCOES_AUTH })
  : null;

function servico() {
  if (!admin) { throw new Error('SUPABASE_URL ou a chave de serviço (SUPABASE_SERVICE_ROLE_KEY/AQS_CHAVE_SERVICO) ausente no ambiente da função.'); }
  return admin;
}

/* Erros do supabase-js viram exceções com code/status/message preservados
   — é por eles que a lógica reconhece trava, e-mail duplicado etc. */
function lancar(erro: unknown): never {
  if (erro instanceof Error) { throw erro; }
  const e = erro as { message?: string; code?: string; status?: number; details?: string; hint?: string };
  const falha = new Error(e?.message || 'Erro desconhecido do Supabase.') as Error & Record<string, unknown>;
  falha.code = e?.code;
  falha.status = e?.status;
  falha.details = e?.details;
  falha.hint = e?.hint;
  throw falha;
}

/* Payload do JWT (já validado pelo Auth em getUser) — só para ler "aal". */
function payloadDoToken(token: string): Record<string, unknown> | null {
  try {
    const parte = token.split('.')[1] || '';
    const base64 = parte.replace(/-/g, '+').replace(/_/g, '/');
    const completo = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(completo), function (c) { return c.charCodeAt(0); });
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (_) {
    return null;
  }
}

async function militarOnde(coluna: string, valor: string): Promise<Militar | null> {
  const { data, error } = await servico().from('militares').select(COLUNAS_MILITAR).eq(coluna, valor).maybeSingle();
  if (error) { lancar(error); }
  return (data as Militar | null) ?? null;
}

/* Cliente com o token do chamador (chave pública + Authorization): o banco
   enxerga o gestor logado. Sem a chave pública no ambiente (não deveria
   acontecer), cai na service role — a lógica já conferiu tudo, só a
   auditoria genérica fica sem autor. */
function clienteDoChamador(token: string | null) {
  if (!token || !CHAVE_ANON || !URL_SUPABASE) { return servico(); }
  return createClient(URL_SUPABASE, CHAVE_ANON, {
    auth: OPCOES_AUTH,
    global: { headers: { Authorization: 'Bearer ' + token } }
  });
}

function tokenDe(autorizacao: string | null): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(autorizacao || '');
  return m ? m[1] : null;
}

/* Dependências de UMA requisição (o cliente de gravação leva o token de
   quem chamou). */
function criarDeps(token: string | null): Dependencias {
  let gravador: ReturnType<typeof servico> | null = null;
  function gravacao() {
    if (!gravador) { gravador = clienteDoChamador(token); }
    return gravador;
  }
  return {
    origemPermitida: ORIGEM_PERMITIDA,
    erroDeConfiguracao: configurada ? null
      : 'A função admin-usuarios está sem a chave de serviço (SUPABASE_SERVICE_ROLE_KEY). Implante-a de ' +
        'novo pelo Supabase ou crie o segredo AQS_CHAVE_SERVICO com a chave secreta do projeto — ' +
        'veja docs/IMPLANTACAO.md.',

    async usuarioDoToken(token: string): Promise<UsuarioToken | null> {
      /* Cliente com o token do chamador, como pede o Supabase; o token vai
         também explícito para getUser (não há sessão guardada aqui). */
      const cliente = createClient(URL_SUPABASE, CHAVE_ANON || CHAVE_SERVICO, {
        auth: OPCOES_AUTH,
        global: { headers: { Authorization: 'Bearer ' + token } }
      });
      const { data, error } = await cliente.auth.getUser(token);
      if (error) {
        const status = Number((error as { status?: number }).status) || 0;
        /* 4xx = token inválido, expirado ou de sessão encerrada. */
        if (status >= 400 && status < 500) { return null; }
        lancar(error);
      }
      if (!data || !data.user) { return null; }
      const payload = payloadDoToken(token);
      return {
        id: data.user.id,
        email: data.user.email ?? null,
        aal: payload && typeof payload.aal === 'string' ? payload.aal : null
      };
    },

    militarPorUsuario(usuarioId: string) { return militarOnde('usuario_id', usuarioId); },
    militarPorId(id: string) { return militarOnde('id', id); },
    militarPorEmail(email: string) { return militarOnde('email', email); },

    async atualizarMilitar(id: string, campos: Record<string, unknown>, opcoes?: { exigirSemAcesso?: boolean }) {
      let consulta = gravacao().from('militares').update(campos).eq('id', id);
      if (opcoes && opcoes.exigirSemAcesso) { consulta = consulta.is('usuario_id', null); }
      const { data, error } = await consulta.select('id');
      if (error) { lancar(error); }
      return Array.isArray(data) && data.length > 0;
    },

    async excluirMilitar(id: string) {
      const { data, error } = await gravacao().from('militares').delete().eq('id', id).select('id');
      if (error) { lancar(error); }
      return Array.isArray(data) && data.length > 0;
    },

    async criarUsuario(dados: { email: string; senha: string }) {
      const { data, error } = await servico().auth.admin.createUser({
        email: dados.email,
        password: dados.senha,
        email_confirm: true
      });
      if (error) { lancar(error); }
      if (!data || !data.user) { throw new Error('O Supabase não devolveu o usuário criado.'); }
      return { id: data.user.id };
    },

    async atualizarUsuario(id: string, atributos: AtributosUsuario) {
      const mudancas: Record<string, unknown> = {};
      if (atributos.senha !== undefined) { mudancas.password = atributos.senha; }
      if (atributos.email !== undefined) { mudancas.email = atributos.email; mudancas.email_confirm = true; }
      if (atributos.banimento !== undefined) { mudancas.ban_duration = atributos.banimento; }
      const { error } = await servico().auth.admin.updateUserById(id, mudancas);
      if (error) { lancar(error); }
    },

    async excluirUsuario(id: string) {
      const { error } = await servico().auth.admin.deleteUser(id);
      if (error) { lancar(error); }
    },

    async listarFatores(usuarioId: string): Promise<FatorMfa[]> {
      const { data, error } = await servico().auth.admin.mfa.listFactors({ userId: usuarioId });
      if (error) { lancar(error); }
      const fatores = (data && (data as { factors?: FatorMfa[] }).factors) || [];
      return fatores.map(function (f) { return { id: f.id, status: f.status, factor_type: f.factor_type }; });
    },

    async excluirFator(usuarioId: string, fatorId: string) {
      const { error } = await servico().auth.admin.mfa.deleteFactor({ id: fatorId, userId: usuarioId });
      if (error) { lancar(error); }
    },

    async registrarAuditoria(linha: LinhaAuditoria) {
      const { error } = await servico().from('auditoria').insert(linha);
      if (error) { lancar(error); }
    },

    registrarErro(contexto: string, erro: unknown) {
      const e = erro as { message?: string; code?: string; status?: number };
      console.error('[admin-usuarios] ' + contexto + ':', e?.code ?? '', e?.status ?? '', e?.message ?? String(erro));
    }
  };
}

Deno.serve(async function (req: Request): Promise<Response> {
  let corpo: unknown = null;
  if (req.method === 'POST') {
    try {
      const textoCorpo = await req.text();
      if (textoCorpo.length <= TAMANHO_MAXIMO_CORPO) { corpo = JSON.parse(textoCorpo); }
    } catch (_) {
      corpo = null; /* JSON inválido: a lógica responde 400 */
    }
  }

  const autorizacao = req.headers.get('Authorization');
  const resposta = await tratarRequisicao({
    metodo: req.method,
    origem: req.headers.get('Origin'),
    autorizacao: autorizacao,
    corpo: corpo
  }, criarDeps(tokenDe(autorizacao)));

  return new Response(resposta.corpo === null ? null : JSON.stringify(resposta.corpo), {
    status: resposta.status,
    headers: resposta.cabecalhos
  });
});
