-- =========================================================================
-- HABE · AQS e NSP — Ferramenta de Gestão de Atividades
-- 01-estrutura.sql — tabelas, view, funções, RPCs e gatilhos
--
-- Ordem de execução no Supabase (SQL Editor, como dono do projeto):
--   01-estrutura.sql → 02-seguranca.sql → 03-tempo-real-agenda.sql →
--   04-dados-iniciais.sql
-- Todos são REEXECUTÁVEIS: rodar de novo atualiza funções, gatilhos e
-- políticas sem apagar dados (create or replace / if not exists /
-- drop trigger if exists). O contrato de nomes está em
-- docs/ARQUITETURA.md, seção 3.
--
-- -------------------------------------------------------------------------
-- IMPLANTAÇÃO E RECUPERAÇÃO DE ACESSO — privado.vincular_usuario
-- -------------------------------------------------------------------------
-- O primeiro acesso não pode ser criado pela própria ferramenta (ainda
-- não há ninguém logado para criá-lo). Por isso existe a conta
-- institucional da AQS (papel "administrador"), criada pelo
-- 04-dados-iniciais.sql, e a função privado.vincular_usuario, que liga um
-- usuário do Supabase Auth a um cadastro de militar. Ela só roda no SQL
-- Editor (dono do projeto): nenhum usuário do sistema consegue chamá-la.
--
-- Implantação (uma vez):
--   1. Rode os scripts 01 a 04 no SQL Editor.
--   2. Authentication → Users → Add user → Create new user: informe o
--      e-mail INSTITUCIONAL da AQS (não um e-mail pessoal), uma senha forte
--      e marque "Auto Confirm User".
--   3. No SQL Editor:
--        select privado.vincular_usuario('e-mail-institucional@da.aqs');
--      (sem o 2º parâmetro, liga à conta institucional "administrador").
--   4. Entre na ferramenta com esse e-mail e cadastre/dê acesso à chefia e
--      aos adjuntos em Equipe. Guarde a senha da conta institucional no
--      cofre/caderno de senhas da AQS — ela é a chave reserva do sistema.
--
-- Emergência — "perdemos todos os acessos de gestor" (chefia saiu, senha
-- esquecida, ninguém consegue administrar):
--   a) A conta institucional existe, mas ninguém sabe a senha:
--      Authentication → Users → (e-mail institucional) → "Send password
--      recovery" — ou crie um usuário novo (passo 2 acima, com outro
--      e-mail institucional) e rode:
--        select privado.vincular_usuario('novo-email-institucional@da.aqs');
--      O usuário antigo é desligado do cadastro e o novo assume.
--   b) O celular do 2º fator (TOTP) da conta institucional se perdeu:
--        delete from auth.mfa_factors
--         where user_id = (select id from auth.users
--                           where email = 'e-mail-institucional@da.aqs');
--   c) Devolver o acesso a uma chefia específica (o usuário dela já existe
--      em Authentication → Users):
--        select privado.vincular_usuario('chefe@exemplo.mil.br',
--          (select id from public.militares where nome_guerra = 'Fulano'));
--      Depois, entre na ferramenta e confira o papel em Equipe.
-- Nada disso apaga histórico. O manual completo está em
-- docs/CONTINUIDADE.md.
-- =========================================================================

create schema if not exists privado;
comment on schema privado is
  'Funções internas da ferramenta AQS/NSP. Não é exposto pela API REST.';

-- Data de hoje no fuso de Belém. O servidor do Supabase roda em UTC: entre
-- 21h e meia-noite de Belém, now()::date já seria "amanhã".
create or replace function public.hoje_belem()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'America/Belem')::date
$$;

-- =========================================================================
-- TABELAS
-- RLS é ligada aqui mesmo, logo após cada criação: entre este arquivo e o
-- 02-seguranca.sql nenhuma tabela fica aberta (sem política, a RLS nega).
-- =========================================================================

create table if not exists public.setores (
  id uuid primary key default gen_random_uuid(),
  sigla text not null,
  nome text not null,
  cor text not null default '#1b5aa8',
  ordem int not null default 0,
  criado_em timestamptz not null default now(),
  constraint setores_sigla_unica unique (sigla),
  constraint setores_sigla_tamanho check (char_length(btrim(sigla)) between 1 and 20),
  constraint setores_nome_tamanho check (char_length(btrim(nome)) between 1 and 200),
  constraint setores_cor_hexadecimal check (cor ~ '^#[0-9a-fA-F]{6}$')
);
alter table public.setores enable row level security;

create table if not exists public.militares (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid references auth.users (id) on delete set null,
  posto text not null default '',
  nome_guerra text not null,
  nome_completo text,
  email text,
  setor_id uuid references public.setores (id),
  papel text not null default 'adjunto',
  ativo boolean not null default true,
  deve_trocar_senha boolean not null default true,
  ultimo_acesso timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  -- Adiável: privado.vincular_usuario troca o usuário de cadastro dentro da
  -- mesma transação sem esbarrar na duplicidade momentânea.
  constraint militares_usuario_unico unique (usuario_id) deferrable initially immediate,
  constraint militares_email_unico unique (email),
  constraint militares_papel_valido check (papel in ('administrador', 'chefia', 'adjunto')),
  constraint militares_posto_tamanho check (char_length(posto) <= 30),
  constraint militares_nome_guerra_tamanho check (char_length(btrim(nome_guerra)) between 1 and 80),
  constraint militares_nome_completo_tamanho check (nome_completo is null or char_length(nome_completo) <= 200),
  constraint militares_email_valido check (
    email is null or (email = lower(email) and email ~ '^[^@[:space:]]+@[^@[:space:]]+$' and char_length(email) <= 254)
  )
);
alter table public.militares enable row level security;

create table if not exists public.atividades (
  id uuid primary key default gen_random_uuid(),
  ordem int not null,
  titulo text not null,
  descricao text not null default '',
  setor_id uuid references public.setores (id),
  tipo text not null,
  periodicidade text,
  dia_semana int,
  dia_mes int,
  mes_inicio int,
  prazo date,
  antecipar_dia_util boolean not null default true,
  prioridade text not null default 'normal',
  exige_evidencia boolean not null default false,
  ativa boolean not null default true,
  data_inicio date not null default public.hoje_belem(),
  criado_por uuid references public.militares (id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint atividades_titulo_tamanho check (char_length(btrim(titulo)) between 3 and 200),
  constraint atividades_descricao_tamanho check (char_length(descricao) <= 10000),
  constraint atividades_tipo_valido check (tipo in ('recorrente', 'pontual', 'sob_demanda')),
  constraint atividades_periodicidade_valida check (
    periodicidade is null
    or periodicidade in ('diaria_util', 'semanal', 'mensal', 'trimestral', 'semestral', 'anual')
  ),
  constraint atividades_dia_semana_valido check (dia_semana between 1 and 7),
  constraint atividades_dia_mes_valido check (dia_mes between 1 and 31),
  constraint atividades_mes_inicio_valido check (mes_inicio between 1 and 12),
  constraint atividades_prioridade_valida check (prioridade in ('baixa', 'normal', 'alta', 'urgente')),
  constraint atividades_recorrente_exige_periodicidade check (tipo <> 'recorrente' or periodicidade is not null),
  constraint atividades_semanal_exige_dia_semana check (periodicidade is distinct from 'semanal' or dia_semana is not null),
  constraint atividades_mensal_exige_dia_mes check (
    periodicidade is null or periodicidade not in ('mensal', 'trimestral', 'semestral', 'anual') or dia_mes is not null
  ),
  constraint atividades_ciclo_exige_mes_inicio check (
    periodicidade is null or periodicidade not in ('trimestral', 'semestral', 'anual') or mes_inicio is not null
  ),
  constraint atividades_nao_recorrente_sem_periodicidade check (tipo = 'recorrente' or periodicidade is null)
);
alter table public.atividades enable row level security;

create table if not exists public.atividade_responsaveis (
  atividade_id uuid not null references public.atividades (id) on delete cascade,
  militar_id uuid not null references public.militares (id) on delete cascade,
  primary key (atividade_id, militar_id)
);
alter table public.atividade_responsaveis enable row level security;

create table if not exists public.ocorrencias (
  id uuid primary key default gen_random_uuid(),
  atividade_id uuid not null references public.atividades (id) on delete cascade,
  referencia text,
  titulo_execucao text,
  prazo date,
  status text not null default 'pendente',
  observacao text not null default '',
  justificativa text,
  iniciada_em timestamptz,
  concluida_em timestamptz,
  concluida_por uuid references public.militares (id) on delete set null,
  concluida_por_nome text,
  criado_por uuid references public.militares (id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint ocorrencias_atividade_referencia_unica unique (atividade_id, referencia),
  constraint ocorrencias_status_valido check (status in ('pendente', 'em_andamento', 'concluida', 'nao_se_aplica')),
  constraint ocorrencias_nao_se_aplica_exige_justificativa check (
    status <> 'nao_se_aplica' or char_length(btrim(coalesce(justificativa, ''))) > 0
  ),
  constraint ocorrencias_referencia_tamanho check (referencia is null or char_length(referencia) between 1 and 40),
  constraint ocorrencias_titulo_execucao_tamanho check (titulo_execucao is null or char_length(titulo_execucao) <= 200),
  constraint ocorrencias_observacao_tamanho check (char_length(observacao) <= 10000),
  constraint ocorrencias_justificativa_tamanho check (justificativa is null or char_length(justificativa) <= 4000)
);
alter table public.ocorrencias enable row level security;

create table if not exists public.evidencias (
  id uuid primary key default gen_random_uuid(),
  atividade_id uuid not null references public.atividades (id) on delete cascade,
  ocorrencia_id uuid references public.ocorrencias (id) on delete cascade,
  storage_path text not null,
  nome text not null,
  mime text not null default 'application/octet-stream',
  tamanho bigint not null default 0,
  descricao text not null default '',
  enviado_por uuid references public.militares (id) on delete set null,
  enviado_por_nome text,
  enviado_em timestamptz not null default now(),
  constraint evidencias_storage_path_unico unique (storage_path),
  constraint evidencias_storage_path_tamanho check (char_length(storage_path) between 1 and 600),
  constraint evidencias_nome_tamanho check (char_length(btrim(nome)) between 1 and 255),
  constraint evidencias_mime_tamanho check (char_length(mime) <= 200),
  constraint evidencias_tamanho_valido check (tamanho >= 0),
  constraint evidencias_descricao_tamanho check (char_length(descricao) <= 2000)
);
alter table public.evidencias enable row level security;

create table if not exists public.comentarios (
  id uuid primary key default gen_random_uuid(),
  atividade_id uuid not null references public.atividades (id) on delete cascade,
  ocorrencia_id uuid references public.ocorrencias (id) on delete cascade,
  autor_id uuid references public.militares (id) on delete set null,
  autor_nome text,
  autor_papel text,
  texto text not null,
  criado_em timestamptz not null default now(),
  constraint comentarios_texto_tamanho check (char_length(texto) between 1 and 4000 and btrim(texto) <> '')
);
alter table public.comentarios enable row level security;

create table if not exists public.avisos (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  mensagem text not null default '',
  nivel text not null default 'informativo',
  para_todos boolean not null default true,
  prazo date,
  atividade_id uuid references public.atividades (id) on delete set null,
  fixado boolean not null default false,
  expira_em date,
  criado_por uuid references public.militares (id) on delete set null,
  criado_por_nome text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint avisos_titulo_tamanho check (char_length(btrim(titulo)) between 1 and 200),
  constraint avisos_mensagem_tamanho check (char_length(mensagem) <= 10000),
  constraint avisos_nivel_valido check (nivel in ('informativo', 'importante', 'urgente'))
);
alter table public.avisos enable row level security;

create table if not exists public.avisos_destinatarios (
  aviso_id uuid not null references public.avisos (id) on delete cascade,
  militar_id uuid not null references public.militares (id) on delete cascade,
  primary key (aviso_id, militar_id)
);
alter table public.avisos_destinatarios enable row level security;

create table if not exists public.avisos_ciencia (
  aviso_id uuid not null references public.avisos (id) on delete cascade,
  militar_id uuid not null references public.militares (id) on delete cascade,
  ciente_em timestamptz not null default now(),
  primary key (aviso_id, militar_id)
);
alter table public.avisos_ciencia enable row level security;

-- As referências apagam a notificação junto: um aviso de algo que não
-- existe mais só levaria a um link quebrado.
create table if not exists public.notificacoes (
  id uuid primary key default gen_random_uuid(),
  destinatario_id uuid not null references public.militares (id) on delete cascade,
  tipo text not null,
  titulo text not null,
  mensagem text not null default '',
  atividade_id uuid references public.atividades (id) on delete cascade,
  ocorrencia_id uuid references public.ocorrencias (id) on delete cascade,
  aviso_id uuid references public.avisos (id) on delete cascade,
  lida boolean not null default false,
  criado_em timestamptz not null default now(),
  constraint notificacoes_tipo_valido check (tipo in ('atribuicao', 'comentario', 'aviso', 'prazo'))
);
alter table public.notificacoes enable row level security;

create table if not exists public.feriados (
  data date primary key,
  descricao text not null,
  constraint feriados_descricao_tamanho check (char_length(btrim(descricao)) between 1 and 120)
);
alter table public.feriados enable row level security;

create table if not exists public.configuracoes (
  chave text primary key,
  valor jsonb not null,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references public.militares (id) on delete set null,
  constraint configuracoes_chave_valida check (chave ~ '^[a-z][a-z0-9_]{0,59}$')
);
alter table public.configuracoes enable row level security;

-- Sem FK em militar_id de propósito: a trilha de auditoria precisa
-- sobreviver à exclusão do militar (o nome fica em militar_nome).
create table if not exists public.auditoria (
  id bigserial primary key,
  quando timestamptz not null default now(),
  militar_id uuid,
  militar_nome text,
  usuario_id uuid,
  tabela text not null,
  operacao text not null,
  registro_id text,
  antes jsonb,
  depois jsonb,
  constraint auditoria_operacao_valida check (
    operacao in ('INSERT', 'UPDATE', 'DELETE') or operacao ~ '^ADMIN:[a-z_]{1,40}$'
  )
);
alter table public.auditoria enable row level security;

-- 'ADMIN:<ação>' = ações de acesso feitas pela Edge Function admin-usuarios
-- (criar acesso, redefinir senha, desativar…). Recriado aqui para valer
-- também em bancos criados por uma versão anterior deste arquivo (o
-- "create table if not exists" acima não mexe em tabela existente).
alter table public.auditoria drop constraint if exists auditoria_operacao_valida;
alter table public.auditoria add constraint auditoria_operacao_valida check (
  operacao in ('INSERT', 'UPDATE', 'DELETE') or operacao ~ '^ADMIN:[a-z_]{1,40}$'
);

-- ---------- índices das consultas principais ----------
create index if not exists ocorrencias_prazo_idx on public.ocorrencias (prazo);
create index if not exists ocorrencias_atividade_idx on public.ocorrencias (atividade_id);
create index if not exists ocorrencias_abertas_prazo_idx on public.ocorrencias (prazo)
  where status in ('pendente', 'em_andamento');
create index if not exists ocorrencias_concluida_por_idx on public.ocorrencias (concluida_por);
create index if not exists ocorrencias_criado_por_idx on public.ocorrencias (criado_por);
create index if not exists atividade_responsaveis_militar_idx on public.atividade_responsaveis (militar_id);
create index if not exists atividades_criado_por_idx on public.atividades (criado_por);
create index if not exists notificacoes_destinatario_lida_idx on public.notificacoes (destinatario_id, lida);
create index if not exists notificacoes_destinatario_criado_idx on public.notificacoes (destinatario_id, criado_em desc);
create index if not exists notificacoes_ocorrencia_idx on public.notificacoes (ocorrencia_id);
create index if not exists notificacoes_atividade_idx on public.notificacoes (atividade_id);
create index if not exists notificacoes_aviso_idx on public.notificacoes (aviso_id);
create index if not exists evidencias_ocorrencia_idx on public.evidencias (ocorrencia_id);
create index if not exists evidencias_atividade_idx on public.evidencias (atividade_id);
create index if not exists evidencias_enviado_por_idx on public.evidencias (enviado_por);
create index if not exists comentarios_atividade_idx on public.comentarios (atividade_id);
create index if not exists comentarios_ocorrencia_idx on public.comentarios (ocorrencia_id);
create index if not exists comentarios_autor_idx on public.comentarios (autor_id);
create index if not exists avisos_criado_por_idx on public.avisos (criado_por);
create index if not exists avisos_atividade_idx on public.avisos (atividade_id);
create index if not exists avisos_destinatarios_militar_idx on public.avisos_destinatarios (militar_id);
create index if not exists avisos_ciencia_militar_idx on public.avisos_ciencia (militar_id);
create index if not exists militares_setor_idx on public.militares (setor_id);
create index if not exists atividades_setor_idx on public.atividades (setor_id);
create index if not exists configuracoes_atualizado_por_idx on public.configuracoes (atualizado_por);
create index if not exists auditoria_quando_idx on public.auditoria (quando desc);
create index if not exists auditoria_tabela_quando_idx on public.auditoria (tabela, quando desc);

-- =========================================================================
-- FUNÇÕES AUXILIARES (schema privado)
-- SECURITY DEFINER com search_path vazio: leem as tabelas sem passar pela
-- RLS (senão as políticas que as usam entrariam em recursão) e não podem
-- ser enganadas por objetos homônimos em outro schema.
-- =========================================================================

-- Segundo fator: quem cadastrou um aplicativo autenticador (fator TOTP
-- verificado) só é reconhecido com a sessão confirmada pelo código (claim
-- "aal" = 'aal2' no JWT). Sem isso, quem descobrisse só a senha de um
-- gestor leria e gravaria pela API REST, pulando a tela do código. Quem
-- não ativou o segundo fator segue só com a senha (a ativação é opcional,
-- recomendada para gestores). Vale em todas as políticas e RPCs porque
-- está em meu_militar_id, eh_gestor e eh_administrador.
create or replace function privado.mfa_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      or not exists (
           select 1
             from auth.mfa_factors f
            where f.user_id = auth.uid()
              and f.status = 'verified'
         )
$$;

-- Militar ATIVO ligado ao usuário logado (nulo se não houver, ou se a
-- sessão ainda não passou pelo segundo fator exigido). É a base de todas
-- as políticas: desativar o cadastro corta o acesso na hora.
create or replace function privado.meu_militar_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id
    from public.militares m
   where m.usuario_id = auth.uid()
     and m.ativo
     and privado.mfa_ok()
   limit 1
$$;

create or replace function privado.eh_ativo()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select privado.meu_militar_id() is not null
$$;

-- "Gestor" = chefia ou administrador (conta institucional da AQS).
create or replace function privado.eh_gestor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.militares m
     where m.usuario_id = auth.uid()
       and m.ativo
       and m.papel in ('chefia', 'administrador')
  )
  and privado.mfa_ok()
$$;

create or replace function privado.eh_administrador()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.militares m
     where m.usuario_id = auth.uid()
       and m.ativo
       and m.papel = 'administrador'
  )
  and privado.mfa_ok()
$$;

create or replace function privado.eh_responsavel(p_atividade uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.atividade_responsaveis r
     where r.atividade_id = p_atividade
       and r.militar_id = privado.meu_militar_id()
  )
$$;

-- Posto + nome de guerra, sem espaços sobrando (igual a Regras.nomeMilitar).
-- É o texto gravado nos instantâneos *_nome.
create or replace function privado.nome_militar(p_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
           nullif(btrim(regexp_replace(m.posto || ' ' || m.nome_guerra, '\s+', ' ', 'g')), ''),
           m.email
         )
    from public.militares m
   where m.id = p_id
$$;

-- Política de envio ao Storage: a 1ª pasta do caminho é o id da atividade.
-- Texto que não é uuid nega em vez de estourar erro de conversão.
create or replace function privado.pode_enviar_evidencia(p_pasta text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_atividade uuid;
begin
  if p_pasta is null
     or p_pasta !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_atividade := p_pasta::uuid;
  if not exists (select 1 from public.atividades a where a.id = v_atividade) then
    return false;
  end if;
  return privado.eh_gestor() or privado.eh_responsavel(v_atividade);
end
$$;

-- Texto curto para notificações: espaços normalizados e reticências.
create or replace function privado.resumir(p_texto text, p_maximo int)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when p_texto is null then ''
           when char_length(regexp_replace(btrim(p_texto), '\s+', ' ', 'g')) <= p_maximo
             then regexp_replace(btrim(p_texto), '\s+', ' ', 'g')
           else left(regexp_replace(btrim(p_texto), '\s+', ' ', 'g'), p_maximo - 1) || '…'
         end
$$;

-- ---------- leitura validada do JSON de salvar_atividade ----------
-- Mensagens claras em vez do "invalid input syntax" do PostgreSQL.

create or replace function privado.json_texto(p jsonb, p_chave text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when p -> p_chave is null or jsonb_typeof(p -> p_chave) = 'null' then null
           else p ->> p_chave
         end
$$;

create or replace function privado.json_inteiro(p jsonb, p_chave text, p_rotulo text)
returns int
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_texto text := btrim(privado.json_texto(p, p_chave));
begin
  if v_texto is null or v_texto = '' then
    return null;
  end if;
  if v_texto !~ '^-?[0-9]{1,9}(\.0+)?$' then
    raise exception 'Valor inválido para %: "%".', p_rotulo, left(v_texto, 40)
      using errcode = '22023';
  end if;
  return v_texto::numeric::int;
end
$$;

create or replace function privado.json_data(p jsonb, p_chave text, p_rotulo text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_texto text := btrim(privado.json_texto(p, p_chave));
begin
  if v_texto is null or v_texto = '' then
    return null;
  end if;
  if v_texto !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then
    raise exception 'Data inválida para %: "%". Use o formato AAAA-MM-DD.', p_rotulo, left(v_texto, 40)
      using errcode = '22023';
  end if;
  begin
    return to_date(left(v_texto, 10), 'YYYY-MM-DD');
  exception when others then
    raise exception 'Data inválida para %: "%".', p_rotulo, left(v_texto, 40)
      using errcode = '22023';
  end;
end
$$;

create or replace function privado.json_uuid(p jsonb, p_chave text, p_rotulo text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_texto text := btrim(privado.json_texto(p, p_chave));
begin
  if v_texto is null or v_texto = '' then
    return null;
  end if;
  if v_texto !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Identificador inválido para %.', p_rotulo using errcode = '22023';
  end if;
  return v_texto::uuid;
end
$$;

create or replace function privado.json_booleano(p jsonb, p_chave text, p_rotulo text, p_padrao boolean)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_texto text := lower(btrim(privado.json_texto(p, p_chave)));
begin
  if v_texto is null or v_texto = '' then
    return p_padrao;
  end if;
  if v_texto in ('true', 't', '1', 'sim') then
    return true;
  end if;
  if v_texto in ('false', 'f', '0', 'nao', 'não') then
    return false;
  end if;
  raise exception 'Valor inválido para % (use verdadeiro ou falso).', p_rotulo using errcode = '22023';
end
$$;

-- =========================================================================
-- RECORRÊNCIA (ARQUITETURA §4) — espelho EXATO de Recorrencia.datas
-- (assets/js/recorrencia.js). Mudou aqui, mude lá e rode
-- testes/paridade-recorrencia.mjs.
-- =========================================================================

-- Dia útil = segunda a sexta fora da lista de feriados.
create or replace function privado.eh_dia_util(p_dia date, p_feriados date[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select extract(isodow from p_dia) <= 5
     and not (p_dia = any (coalesce(p_feriados, '{}'::date[])))
$$;

-- Recua um dia por vez até cair num dia útil. O limite de 400 passos
-- (igual ao LIMITE_RECUO do JS) só importaria com uma tabela de feriados
-- absurda; evita laço infinito.
create or replace function privado.antecipar_dia_util(p_dia date, p_feriados date[])
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_dia date := p_dia;
  v_passos int := 0;
begin
  if v_dia is null then
    return null;
  end if;
  while not privado.eh_dia_util(v_dia, p_feriados) and v_passos < 400 loop
    v_dia := v_dia - 1;
    v_passos := v_passos + 1;
  end loop;
  return v_dia;
end
$$;

-- Lista {referencia, prazo} de uma regra no intervalo [p_de, p_ate],
-- ordenada por prazo e referência. Inclusão pelo PRAZO FINAL (já
-- antecipado); por isso semanas/meses são percorridos de um período antes
-- de p_de até um depois de p_ate (ex.: a sexta 01/01/2027 é feriado e o
-- prazo da semana 2026-W53 vira 31/12/2026).
-- As conversões para timestamp SEM fuso tornam date_trunc/to_char imunes
-- ao fuso da sessão.
create or replace function privado.datas_ocorrencia(
  p_periodicidade text,
  p_dia_semana int,
  p_dia_mes int,
  p_mes_inicio int,
  p_antecipar boolean,
  p_de date,
  p_ate date
)
returns table (referencia text, prazo date)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_feriados date[];
  v_antecipa boolean := coalesce(p_antecipar, true);
  v_referencias text[] := '{}';
  v_prazos date[] := '{}';
  v_dia date;
  v_segunda date;
  v_ultima_segunda date;
  v_mes date;
  v_ultimo_mes date;
  v_numero_mes int;
  v_alvo date;
  v_final date;
  v_prefixo text;
begin
  if p_de is null or p_ate is null or p_de > p_ate then
    return;
  end if;

  select coalesce(array_agg(f.data), '{}'::date[]) into v_feriados from public.feriados f;

  if p_periodicidade = 'diaria_util' then
    -- Só dias úteis geram ocorrência; a antecipação não se aplica.
    v_dia := p_de;
    while v_dia <= p_ate loop
      if privado.eh_dia_util(v_dia, v_feriados) then
        v_referencias := v_referencias || ('D' || to_char(v_dia::timestamp, 'YYYY-MM-DD'));
        v_prazos := v_prazos || v_dia;
      end if;
      v_dia := v_dia + 1;
    end loop;

  elsif p_periodicidade = 'semanal' then
    if p_dia_semana is null or p_dia_semana not between 1 and 7 then
      return;
    end if;
    v_segunda := date_trunc('week', (p_de - 7)::timestamp)::date;
    v_ultima_segunda := date_trunc('week', (p_ate + 7)::timestamp)::date;
    while v_segunda <= v_ultima_segunda loop
      v_alvo := v_segunda + (p_dia_semana - 1);
      v_final := case when v_antecipa then privado.antecipar_dia_util(v_alvo, v_feriados) else v_alvo end;
      if v_final between p_de and p_ate then
        v_referencias := v_referencias
          || ('S' || to_char(v_segunda::timestamp, 'IYYY') || '-W' || to_char(v_segunda::timestamp, 'IW'));
        v_prazos := v_prazos || v_final;
      end if;
      v_segunda := v_segunda + 7;
    end loop;

  elsif p_periodicidade in ('mensal', 'trimestral', 'semestral', 'anual') then
    if p_dia_mes is null or p_dia_mes not between 1 and 31 then
      return;
    end if;
    if p_periodicidade <> 'mensal' and (p_mes_inicio is null or p_mes_inicio not between 1 and 12) then
      return;
    end if;
    v_prefixo := case p_periodicidade
                   when 'mensal' then 'M'
                   when 'trimestral' then 'T'
                   when 'semestral' then 'H'
                   else 'A'
                 end;
    v_mes := (date_trunc('month', p_de::timestamp) - interval '1 month')::date;
    v_ultimo_mes := (date_trunc('month', p_ate::timestamp) + interval '1 month')::date;
    while v_mes <= v_ultimo_mes loop
      v_numero_mes := extract(month from v_mes)::int;
      if p_periodicidade = 'mensal'
         or (p_periodicidade = 'trimestral' and (v_numero_mes - p_mes_inicio) % 3 = 0)
         or (p_periodicidade = 'semestral' and (v_numero_mes - p_mes_inicio) % 6 = 0)
         or (p_periodicidade = 'anual' and v_numero_mes = p_mes_inicio) then
        -- dia_mes 31 = último dia do mês; 29/30 também caem no último dia
        -- nos meses mais curtos.
        v_alvo := v_mes + (least(p_dia_mes,
                    extract(day from (v_mes + interval '1 month' - interval '1 day'))::int) - 1);
        v_final := case when v_antecipa then privado.antecipar_dia_util(v_alvo, v_feriados) else v_alvo end;
        if v_final between p_de and p_ate then
          v_referencias := v_referencias || (v_prefixo || to_char(v_mes::timestamp, 'YYYY-MM'));
          v_prazos := v_prazos || v_final;
        end if;
      end if;
      v_mes := (v_mes + interval '1 month')::date;
    end loop;

  else
    return;
  end if;

  -- collate "C": mesma comparação por código de caractere do sort do JS.
  return query
    select t.ref, t.dia
      from unnest(v_referencias, v_prazos) as t(ref, dia)
     order by t.dia, t.ref collate "C";
end
$$;

-- Gera (sem duplicar) as ocorrências de UMA atividade recorrente ativa na
-- janela de §4: de = maior(data_inicio, hoje − 45); até = hoje (diária)
-- ou hoje + 31 (demais). Devolve quantas inseriu.
create or replace function privado.gerar_ocorrencias_atividade(p_atividade uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_atividade public.atividades%rowtype;
  v_hoje date := public.hoje_belem();
  v_de date;
  v_ate date;
  v_quantidade int;
begin
  select * into v_atividade from public.atividades a where a.id = p_atividade;
  if not found or not v_atividade.ativa or v_atividade.tipo <> 'recorrente' then
    return 0;
  end if;

  v_de := greatest(v_atividade.data_inicio, v_hoje - 45);
  v_ate := case when v_atividade.periodicidade = 'diaria_util' then v_hoje else v_hoje + 31 end;
  if v_de > v_ate then
    return 0;
  end if;

  insert into public.ocorrencias (atividade_id, referencia, prazo)
  select v_atividade.id, d.referencia, d.prazo
    from privado.datas_ocorrencia(
           v_atividade.periodicidade, v_atividade.dia_semana, v_atividade.dia_mes,
           v_atividade.mes_inicio, v_atividade.antecipar_dia_util, v_de, v_ate) d
  on conflict (atividade_id, referencia) do nothing;

  get diagnostics v_quantidade = row_count;
  return v_quantidade;
end
$$;

create or replace function privado.gerar_todas()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_atividade record;
  v_total int := 0;
begin
  for v_atividade in
    select a.id from public.atividades a
     where a.ativa and a.tipo = 'recorrente'
     order by a.ordem, a.id
  loop
    v_total := v_total + privado.gerar_ocorrencias_atividade(v_atividade.id);
  end loop;
  return v_total;
end
$$;

-- Avisa os responsáveis (ativos) das ocorrências abertas que vencem hoje ou
-- amanhã — no máximo uma notificação por ocorrência, pessoa e dia.
-- A trava consultiva evita duplicar quando o agendamento e um login rodam
-- ao mesmo tempo.
create or replace function privado.notificar_prazos()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hoje date := public.hoje_belem();
  v_quantidade int;
begin
  perform pg_advisory_xact_lock(hashtext('aqs-nsp:notificar-prazos'));

  insert into public.notificacoes (destinatario_id, tipo, titulo, mensagem, atividade_id, ocorrencia_id)
  select r.militar_id,
         'prazo',
         case when o.prazo = v_hoje then 'Prazo hoje' else 'Prazo amanhã' end,
         privado.resumir(a.titulo || coalesce(' — ' || o.titulo_execucao, ''), 200),
         o.atividade_id,
         o.id
    from public.ocorrencias o
    join public.atividades a on a.id = o.atividade_id and a.ativa
    join public.atividade_responsaveis r on r.atividade_id = o.atividade_id
    join public.militares m on m.id = r.militar_id and m.ativo
   where o.status in ('pendente', 'em_andamento')
     and o.prazo between v_hoje and v_hoje + 1
     and not exists (
           select 1
             from public.notificacoes n
            where n.tipo = 'prazo'
              and n.ocorrencia_id = o.id
              and n.destinatario_id = r.militar_id
              and (n.criado_em at time zone 'America/Belem')::date = v_hoje
         );

  get diagnostics v_quantidade = row_count;
  return v_quantidade;
end
$$;

-- Rotina do pg_cron (00:05 de Belém): gera as ocorrências, avisa os prazos
-- e apaga notificações já lidas com mais de 180 dias (a tabela não cresce
-- para sempre; o histórico das atividades fica nas próprias tabelas).
create or replace function privado.rotina_diaria()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_geradas int;
begin
  v_geradas := privado.gerar_todas();
  perform privado.notificar_prazos();
  delete from public.notificacoes n
   where n.lida
     and n.criado_em < now() - interval '180 days';
  return v_geradas;
end
$$;

-- Implantação e recuperação de emergência (ver o topo deste arquivo).
-- Liga o usuário do Auth com o e-mail informado ao militar indicado — por
-- padrão, à conta institucional (papel administrador) —, reativa o
-- cadastro, grava o e-mail e dispensa a troca obrigatória de senha.
-- Se esse usuário estava ligado a outro cadastro, ele é desligado de lá.
create or replace function privado.vincular_usuario(p_email text, p_militar uuid default null)
returns public.militares
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_usuario uuid;
  v_militar uuid := p_militar;
  v_linha public.militares%rowtype;
begin
  if v_email = '' then
    raise exception 'Informe o e-mail do usuário (o mesmo cadastrado em Authentication → Users).'
      using errcode = '22023';
  end if;

  select u.id into v_usuario
    from auth.users u
   where lower(u.email) = v_email
   order by u.id
   limit 1;
  if v_usuario is null then
    raise exception 'Não há usuário com o e-mail % em Authentication → Users. Crie-o primeiro (Add user → Create new user) e rode de novo.', v_email
      using errcode = 'P0002';
  end if;

  if v_militar is null then
    select m.id into v_militar
      from public.militares m
     where m.papel = 'administrador'
     order by m.ativo desc, m.criado_em, m.id
     limit 1;
    if v_militar is null then
      -- Ninguém deveria ter apagado a conta institucional, mas a
      -- recuperação não pode depender disso: recria-a.
      insert into public.militares (posto, nome_guerra, papel, setor_id, ativo)
      values ('', 'AQS — conta institucional', 'administrador',
              (select s.id from public.setores s where s.sigla = 'AQS'), true)
      returning id into v_militar;
    end if;
  elsif not exists (select 1 from public.militares m where m.id = v_militar) then
    raise exception 'Militar % não encontrado.', v_militar using errcode = 'P0002';
  end if;

  -- O e-mail é único: tira-o de outro cadastro que o tenha.
  update public.militares m
     set email = null
   where m.email = v_email
     and m.id <> v_militar;

  -- Liga primeiro o cadastro de destino e só depois desliga o usuário do
  -- cadastro antigo; a unicidade de usuario_id é conferida no fim. Assim a
  -- trava anti-bloqueio enxerga o destino já com acesso.
  set constraints public.militares_usuario_unico deferred;

  update public.militares m
     set usuario_id = v_usuario,
         email = v_email,
         ativo = true,
         deve_trocar_senha = false
   where m.id = v_militar;

  update public.militares m
     set usuario_id = null
   where m.usuario_id = v_usuario
     and m.id <> v_militar;

  set constraints public.militares_usuario_unico immediate;

  select * into v_linha from public.militares m where m.id = v_militar;
  raise notice 'Usuário % ligado a "%" (papel %). Já é possível entrar na ferramenta.',
    v_email, privado.nome_militar(v_linha.id), v_linha.papel;
  return v_linha;
end
$$;

-- =========================================================================
-- VIEW v_ocorrencias — com security_invoker: quem consulta passa pela RLS
-- de ocorrencias, atividades, evidencias e comentarios.
-- =========================================================================

create or replace view public.v_ocorrencias
with (security_invoker = true)
as
select
  o.id,
  o.atividade_id,
  o.referencia,
  o.titulo_execucao,
  o.prazo,
  o.status,
  o.observacao,
  o.justificativa,
  o.iniciada_em,
  o.concluida_em,
  o.concluida_por,
  o.concluida_por_nome,
  o.criado_por,
  o.criado_em,
  o.atualizado_em,
  a.titulo as atividade_titulo,
  a.tipo as atividade_tipo,
  a.periodicidade,
  a.prioridade,
  a.setor_id,
  a.exige_evidencia,
  coalesce(
    (select array_agg(r.militar_id order by r.militar_id)
       from public.atividade_responsaveis r
      where r.atividade_id = o.atividade_id),
    '{}'::uuid[]
  ) as responsaveis,
  coalesce(o.prazo, (o.criado_em at time zone 'America/Belem')::date) as data_ref,
  coalesce(o.status in ('pendente', 'em_andamento') and o.prazo < public.hoje_belem(), false) as atrasada,
  -- Registro de algo já feito (a ocorrência nasceu concluída: "Registrar
  -- execução" sob demanda, com a data em que ocorreu) não tem prazo a
  -- cumprir — conta como no prazo. Na inserção, criado_em e concluida_em
  -- recebem o mesmo now() da transação.
  coalesce(
    o.status = 'concluida'
    and (o.prazo is null
         or (o.concluida_em at time zone 'America/Belem')::date <= o.prazo
         or o.concluida_em = o.criado_em),
    false
  ) as concluida_no_prazo,
  (select count(*) from public.evidencias e where e.ocorrencia_id = o.id)::int as qtd_evidencias,
  (select count(*) from public.comentarios c where c.ocorrencia_id = o.id)::int as qtd_comentarios
from public.ocorrencias o
join public.atividades a on a.id = o.atividade_id;

-- =========================================================================
-- GATILHOS
--
-- "Chamada direta do cliente" = current_user 'authenticated' (o PostgREST
-- troca para esse papel em cada requisição). Dentro de funções SECURITY
-- DEFINER, nas ações das chaves estrangeiras (on delete set null/cascade)
-- e no SQL Editor, current_user é o dono das tabelas — operações internas
-- e confiáveis. Por isso os gatilhos que dependem disso são SECURITY
-- INVOKER: só eles enxergam quem de fato executou o comando.
-- =========================================================================

-- ---------- atualizado_em ----------
create or replace function privado.tg_atualizado_em()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em := now();
  return new;
end
$$;

drop trigger if exists militares_atualizado_em on public.militares;
create trigger militares_atualizado_em
  before update on public.militares
  for each row execute function privado.tg_atualizado_em();

drop trigger if exists atividades_atualizado_em on public.atividades;
create trigger atividades_atualizado_em
  before update on public.atividades
  for each row execute function privado.tg_atualizado_em();

drop trigger if exists ocorrencias_atualizado_em on public.ocorrencias;
create trigger ocorrencias_atualizado_em
  before update on public.ocorrencias
  for each row execute function privado.tg_atualizado_em();

drop trigger if exists avisos_atualizado_em on public.avisos;
create trigger avisos_atualizado_em
  before update on public.avisos
  for each row execute function privado.tg_atualizado_em();

-- ---------- setores ----------
create or replace function privado.tg_setores_antes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.militares m where m.setor_id = old.id)
       or exists (select 1 from public.atividades a where a.setor_id = old.id) then
      raise exception 'O setor % ainda tem militares ou atividades vinculados. Mude-os de setor antes de excluí-lo.', old.sigla
        using errcode = 'P0001';
    end if;
    return old;
  end if;
  new.sigla := upper(btrim(new.sigla));
  new.nome := btrim(new.nome);
  new.cor := coalesce(nullif(btrim(new.cor), ''), '#1b5aa8');
  return new;
end
$$;

drop trigger if exists setores_antes on public.setores;
create trigger setores_antes
  before insert or update or delete on public.setores
  for each row execute function privado.tg_setores_antes();

-- ---------- feriados ----------
create or replace function privado.tg_feriados_antes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.descricao := btrim(new.descricao);
  return new;
end
$$;

drop trigger if exists feriados_antes on public.feriados;
create trigger feriados_antes
  before insert or update on public.feriados
  for each row execute function privado.tg_feriados_antes();

-- ---------- militares: normalização, proteção do administrador e trava ----------
-- Regras (ARQUITETURA §3, "Papéis e continuidade"):
--  * só um administrador cria/altera/exclui linha com papel administrador
--    (antes ou depois da mudança) — reforço da RLS; não vale quando não há
--    usuário (Edge Function com service role, SQL Editor), que confere à parte;
--  * ninguém exclui o próprio cadastro nem desativa o próprio acesso;
--  * trava anti-bloqueio: nenhuma operação pode deixar o sistema sem ao
--    menos um gestor (chefia/administrador) ativo e com usuario_id. Vale
--    para todos, inclusive service role e SQL Editor. Só é avaliada quando
--    a linha alterada ERA um gestor com acesso e deixa de ser (na carga
--    inicial ainda não há logins).
create or replace function privado.tg_militares_antes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_eu uuid;
  v_era_gestor boolean;
  v_continua_gestor boolean;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    new.email := nullif(lower(btrim(new.email)), '');
    new.posto := btrim(coalesce(new.posto, ''));
    new.nome_guerra := btrim(new.nome_guerra);
    new.nome_completo := nullif(btrim(new.nome_completo), '');
  end if;

  if auth.uid() is not null then
    if not privado.eh_administrador()
       and ((tg_op <> 'INSERT' and old.papel = 'administrador')
            or (tg_op <> 'DELETE' and new.papel = 'administrador')) then
      raise exception 'Apenas a conta de administrador (conta institucional da AQS) pode criar, alterar ou excluir contas de administrador.'
        using errcode = '42501';
    end if;

    v_eu := privado.meu_militar_id();
    if tg_op = 'DELETE' and old.id = v_eu then
      raise exception 'Você não pode excluir o seu próprio cadastro.' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and old.id = v_eu and old.ativo and not new.ativo then
      raise exception 'Você não pode desativar o seu próprio acesso.' using errcode = '42501';
    end if;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    v_era_gestor := old.papel in ('chefia', 'administrador') and old.ativo and old.usuario_id is not null;
    v_continua_gestor := tg_op = 'UPDATE'
                         and new.papel in ('chefia', 'administrador')
                         and new.ativo
                         and new.usuario_id is not null;
    if v_era_gestor and not coalesce(v_continua_gestor, false) then
      -- Serializa as mudanças de gestores: duas transações simultâneas não
      -- conseguem, cada uma, rebaixar "o outro" e deixar o sistema sem ninguém.
      perform pg_advisory_xact_lock(hashtext('aqs-nsp:gestores'));
      if not exists (
        select 1
          from public.militares m
         where m.id <> old.id
           and m.papel in ('chefia', 'administrador')
           and m.ativo
           and m.usuario_id is not null
      ) then
        raise exception 'É preciso manter ao menos uma conta de chefia ou administrador ativa e com acesso.'
          using errcode = 'P0001',
                hint = 'Dê acesso a outra chefia ou à conta institucional da AQS antes desta mudança.';
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

drop trigger if exists militares_antes on public.militares;
create trigger militares_antes
  before insert or update or delete on public.militares
  for each row execute function privado.tg_militares_antes();

-- ---------- atividades: normalização e número no plano ----------
-- Zera os campos que não valem para o tipo/periodicidade (o check da
-- tabela recusaria a combinação) e numera a atividade nova no fim do plano.
create or replace function privado.tg_atividades_antes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.titulo := btrim(new.titulo);
  new.descricao := coalesce(new.descricao, '');

  if new.tipo is distinct from 'recorrente' then
    new.periodicidade := null;
    new.dia_semana := null;
    new.dia_mes := null;
    new.mes_inicio := null;
  elsif new.periodicidade = 'diaria_util' then
    new.dia_semana := null;
    new.dia_mes := null;
    new.mes_inicio := null;
  elsif new.periodicidade = 'semanal' then
    new.dia_mes := null;
    new.mes_inicio := null;
  elsif new.periodicidade = 'mensal' then
    new.dia_semana := null;
    new.mes_inicio := null;
  elsif new.periodicidade in ('trimestral', 'semestral', 'anual') then
    new.dia_semana := null;
  end if;

  if new.tipo is distinct from 'pontual' then
    new.prazo := null;
  end if;

  if new.ordem is null then
    if tg_op = 'UPDATE' then
      new.ordem := old.ordem;
    else
      select coalesce(max(a.ordem), 0) + 1 into new.ordem from public.atividades a;
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists atividades_antes on public.atividades;
create trigger atividades_antes
  before insert or update on public.atividades
  for each row execute function privado.tg_atividades_antes();

-- ---------- atividades pontuais: ocorrência única 'P' ----------
-- Atividade pontual ativa tem exatamente uma ocorrência, referência 'P',
-- com o mesmo prazo da atividade enquanto não estiver concluída.
-- Deixou de ser pontual ativa: a 'P' sai se ainda estiver pendente, sem
-- evidência nem comentário, e sem prazo vencido (vencida fica como histórico).
create or replace function privado.tg_atividades_pontual()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.tipo = 'pontual' and new.ativa then
    insert into public.ocorrencias (atividade_id, referencia, prazo, criado_por)
    values (new.id, 'P', new.prazo, new.criado_por)
    on conflict (atividade_id, referencia) do nothing;

    if tg_op = 'UPDATE' then
      update public.ocorrencias o
         set prazo = new.prazo
       where o.atividade_id = new.id
         and o.referencia = 'P'
         and o.status in ('pendente', 'em_andamento')
         and o.prazo is distinct from new.prazo;
    end if;
  elsif tg_op = 'UPDATE' and old.tipo = 'pontual' and old.ativa then
    delete from public.ocorrencias o
     where o.atividade_id = new.id
       and o.referencia = 'P'
       and o.status = 'pendente'
       and (o.prazo is null or o.prazo >= public.hoje_belem())
       and not exists (select 1 from public.evidencias e where e.ocorrencia_id = o.id)
       and not exists (select 1 from public.comentarios c where c.ocorrencia_id = o.id);
  end if;
  return null;
end
$$;

drop trigger if exists atividades_pontual on public.atividades;
create trigger atividades_pontual
  after insert or update on public.atividades
  for each row execute function privado.tg_atividades_pontual();

-- ---------- ocorrências: carimbos e campos protegidos ----------
-- * iniciada_em: carimbada ao ir para em_andamento (mantém o 1º início);
--   limpa ao voltar para pendente.
-- * concluida_em / concluida_por / concluida_por_nome: carimbados ao ir
--   para concluida; limpos ao sair de concluida.
-- * Na chamada direta do cliente: carimbos e autoria não aceitam valores
--   enviados, e só gestor muda atividade_id, referencia ou prazo.
-- * "Não se aplica" exige justificativa (o check da tabela é a rede de
--   segurança; aqui a mensagem é clara).
create or replace function privado.tg_ocorrencias_antes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_cliente boolean := current_user in ('authenticated', 'anon');
  v_eu uuid;
begin
  new.observacao := coalesce(new.observacao, '');
  new.justificativa := nullif(btrim(new.justificativa), '');
  new.titulo_execucao := nullif(btrim(new.titulo_execucao), '');

  if new.status = 'nao_se_aplica' and new.justificativa is null then
    raise exception 'Informe a justificativa para marcar como "não se aplica".' using errcode = '23514';
  end if;

  if v_cliente then
    v_eu := privado.meu_militar_id();
  end if;

  if tg_op = 'INSERT' then
    if v_cliente then
      new.criado_por := v_eu;
      new.criado_em := now();
      new.iniciada_em := null;
      new.concluida_em := null;
      new.concluida_por := null;
      new.concluida_por_nome := null;
      -- Execução registrada por adjunto (sob demanda) não tem referência.
      if not privado.eh_gestor() then
        new.referencia := null;
      end if;
    end if;

    if new.status = 'em_andamento' then
      new.iniciada_em := coalesce(new.iniciada_em, now());
    elsif new.status = 'pendente' then
      new.iniciada_em := null;
    end if;

    if new.status = 'concluida' then
      new.concluida_em := coalesce(new.concluida_em, now());
      new.concluida_por := coalesce(new.concluida_por, privado.meu_militar_id());
      new.concluida_por_nome := coalesce(new.concluida_por_nome, privado.nome_militar(new.concluida_por));
    else
      new.concluida_em := null;
      new.concluida_por := null;
      new.concluida_por_nome := null;
    end if;
    return new;
  end if;

  -- UPDATE
  if v_cliente then
    if (new.atividade_id is distinct from old.atividade_id
        or new.referencia is distinct from old.referencia
        or new.prazo is distinct from old.prazo)
       and not privado.eh_gestor() then
      raise exception 'Apenas a chefia pode alterar o prazo, a referência ou a atividade de uma ocorrência.'
        using errcode = '42501';
    end if;
    new.criado_por := old.criado_por;
    new.criado_em := old.criado_em;
    new.iniciada_em := old.iniciada_em;
    new.concluida_em := old.concluida_em;
    new.concluida_por := old.concluida_por;
    new.concluida_por_nome := old.concluida_por_nome;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'em_andamento' then
      new.iniciada_em := coalesce(new.iniciada_em, now());
    elsif new.status = 'pendente' then
      new.iniciada_em := null;
    end if;

    if new.status = 'concluida' then
      new.concluida_em := coalesce(new.concluida_em, now());
      new.concluida_por := coalesce(new.concluida_por, privado.meu_militar_id());
      new.concluida_por_nome := privado.nome_militar(new.concluida_por);
    elsif old.status = 'concluida' then
      new.concluida_em := null;
      new.concluida_por := null;
      new.concluida_por_nome := null;
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists ocorrencias_antes on public.ocorrencias;
create trigger ocorrencias_antes
  before insert or update on public.ocorrencias
  for each row execute function privado.tg_ocorrencias_antes();

-- ---------- evidências: instantâneo do nome e coerência ----------
create or replace function privado.tg_evidencias_antes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_cliente boolean := current_user in ('authenticated', 'anon');
begin
  new.descricao := coalesce(new.descricao, '');
  new.mime := coalesce(nullif(btrim(new.mime), ''), 'application/octet-stream');
  new.tamanho := coalesce(new.tamanho, 0);

  if new.ocorrencia_id is not null and not exists (
       select 1 from public.ocorrencias o
        where o.id = new.ocorrencia_id and o.atividade_id = new.atividade_id) then
    raise exception 'A ocorrência informada não pertence a esta atividade.' using errcode = '22023';
  end if;

  if v_cliente then
    new.enviado_em := now();
    -- Caminho no Storage: {atividade_id}/{ocorrencia_id ou 'geral'}/{arquivo}.
    if split_part(new.storage_path, '/', 1) <> new.atividade_id::text then
      raise exception 'O caminho do arquivo não corresponde à atividade.' using errcode = '22023';
    end if;
  end if;

  if new.enviado_por is not null then
    new.enviado_por_nome := privado.nome_militar(new.enviado_por);
  end if;
  return new;
end
$$;

drop trigger if exists evidencias_antes on public.evidencias;
create trigger evidencias_antes
  before insert on public.evidencias
  for each row execute function privado.tg_evidencias_antes();

-- ---------- comentários: instantâneos de nome e papel ----------
create or replace function privado.tg_comentarios_antes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_cliente boolean := current_user in ('authenticated', 'anon');
begin
  if new.ocorrencia_id is not null and not exists (
       select 1 from public.ocorrencias o
        where o.id = new.ocorrencia_id and o.atividade_id = new.atividade_id) then
    raise exception 'A ocorrência informada não pertence a esta atividade.' using errcode = '22023';
  end if;

  if v_cliente then
    new.criado_em := now();
  end if;

  if new.autor_id is not null then
    new.autor_nome := privado.nome_militar(new.autor_id);
    select m.papel into new.autor_papel from public.militares m where m.id = new.autor_id;
  end if;
  return new;
end
$$;

drop trigger if exists comentarios_antes on public.comentarios;
create trigger comentarios_antes
  before insert on public.comentarios
  for each row execute function privado.tg_comentarios_antes();

-- ---------- avisos: autoria e instantâneo ----------
create or replace function privado.tg_avisos_antes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_cliente boolean := current_user in ('authenticated', 'anon');
begin
  new.titulo := btrim(new.titulo);
  new.mensagem := coalesce(new.mensagem, '');

  if tg_op = 'INSERT' then
    if v_cliente then
      new.criado_por := privado.meu_militar_id();
      new.criado_em := now();
    end if;
    if new.criado_por is not null then
      new.criado_por_nome := privado.nome_militar(new.criado_por);
    end if;
  elsif v_cliente then
    new.criado_por := old.criado_por;
    new.criado_por_nome := old.criado_por_nome;
    new.criado_em := old.criado_em;
  end if;
  return new;
end
$$;

drop trigger if exists avisos_antes on public.avisos;
create trigger avisos_antes
  before insert or update on public.avisos
  for each row execute function privado.tg_avisos_antes();

-- ---------- ciência de aviso: hora real ----------
create or replace function privado.tg_avisos_ciencia_antes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.ciente_em := now();
  end if;
  return new;
end
$$;

drop trigger if exists avisos_ciencia_antes on public.avisos_ciencia;
create trigger avisos_ciencia_antes
  before insert on public.avisos_ciencia
  for each row execute function privado.tg_avisos_ciencia_antes();

-- ---------- configurações: quem e quando ----------
create or replace function privado.tg_configuracoes_antes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.atualizado_por := privado.meu_militar_id();
  end if;
  new.atualizado_em := now();
  return new;
end
$$;

drop trigger if exists configuracoes_antes on public.configuracoes;
create trigger configuracoes_antes
  before insert or update on public.configuracoes
  for each row execute function privado.tg_configuracoes_antes();

-- ---------- notificações ----------

-- Nova missão: avisa o militar incluído como responsável, exceto quando
-- foi ele mesmo quem se incluiu. Sem usuário logado (carga inicial, SQL
-- Editor) não notifica: não há quem tenha atribuído.
create or replace function privado.tg_notificar_atribuicao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or new.militar_id is not distinct from privado.meu_militar_id() then
    return null;
  end if;

  insert into public.notificacoes (destinatario_id, tipo, titulo, mensagem, atividade_id)
  select new.militar_id, 'atribuicao', 'Nova missão atribuída', privado.resumir(a.titulo, 200), a.id
    from public.atividades a
    join public.militares m on m.id = new.militar_id and m.ativo
   where a.id = new.atividade_id;
  return null;
end
$$;

drop trigger if exists atividade_responsaveis_notificar on public.atividade_responsaveis;
create trigger atividade_responsaveis_notificar
  after insert on public.atividade_responsaveis
  for each row execute function privado.tg_notificar_atribuicao();

-- Comentário: avisa os responsáveis da atividade e as chefias ativas (não
-- a conta institucional), exceto o autor.
create or replace function privado.tg_notificar_comentario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_titulo text;
  v_atividade text;
begin
  select a.titulo into v_atividade from public.atividades a where a.id = new.atividade_id;
  v_titulo := case new.autor_papel
                when 'chefia' then 'Novo comentário da chefia'
                when 'administrador' then 'Novo comentário da AQS'
                else 'Novo comentário'
              end;

  insert into public.notificacoes (destinatario_id, tipo, titulo, mensagem, atividade_id, ocorrencia_id)
  select m.id,
         'comentario',
         v_titulo,
         privado.resumir(coalesce(new.autor_nome, 'Comentário') || ' em "' || coalesce(v_atividade, '') || '": ' || new.texto, 240),
         new.atividade_id,
         new.ocorrencia_id
    from public.militares m
   where m.ativo
     and m.id is distinct from new.autor_id
     and (m.papel = 'chefia'
          or exists (select 1 from public.atividade_responsaveis r
                      where r.atividade_id = new.atividade_id and r.militar_id = m.id));
  return null;
end
$$;

drop trigger if exists comentarios_notificar on public.comentarios;
create trigger comentarios_notificar
  after insert on public.comentarios
  for each row execute function privado.tg_notificar_comentario();

-- Aviso para todos: avisa todos os ativos, exceto o autor. Aviso dirigido
-- é notificado conforme os destinatários são gravados (gatilho seguinte).
-- Um aviso dirigido que passa a ser "para todos" avisa quem ainda não sabia.
create or replace function privado.tg_notificar_aviso()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.para_todos and (tg_op = 'INSERT' or not old.para_todos) then
    insert into public.notificacoes (destinatario_id, tipo, titulo, mensagem, aviso_id, atividade_id)
    select m.id,
           'aviso',
           privado.resumir('Novo aviso: ' || new.titulo, 200),
           privado.resumir(new.mensagem, 240),
           new.id,
           new.atividade_id
      from public.militares m
     where m.ativo
       and m.id is distinct from new.criado_por
       and not exists (select 1 from public.notificacoes n
                        where n.aviso_id = new.id and n.destinatario_id = m.id and n.tipo = 'aviso');
  end if;
  return null;
end
$$;

drop trigger if exists avisos_notificar on public.avisos;
create trigger avisos_notificar
  after insert or update of para_todos on public.avisos
  for each row execute function privado.tg_notificar_aviso();

create or replace function privado.tg_notificar_aviso_destinatario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notificacoes (destinatario_id, tipo, titulo, mensagem, aviso_id, atividade_id)
  select new.militar_id,
         'aviso',
         privado.resumir('Novo aviso: ' || v.titulo, 200),
         privado.resumir(v.mensagem, 240),
         v.id,
         v.atividade_id
    from public.avisos v
    join public.militares m on m.id = new.militar_id and m.ativo
   where v.id = new.aviso_id
     and not v.para_todos
     and new.militar_id is distinct from v.criado_por
     and not exists (select 1 from public.notificacoes n
                      where n.aviso_id = v.id and n.destinatario_id = new.militar_id and n.tipo = 'aviso');
  return null;
end
$$;

drop trigger if exists avisos_destinatarios_notificar on public.avisos_destinatarios;
create trigger avisos_destinatarios_notificar
  after insert on public.avisos_destinatarios
  for each row execute function privado.tg_notificar_aviso_destinatario();

-- ---------- auditoria genérica ----------
-- Grava quem (militar e nome no momento), quando, o quê, antes e depois.
-- Argumentos do gatilho = colunas da chave (padrão: id); chave composta
-- vira texto "a:b". Atualizações que só mexem em atualizado_em/
-- ultimo_acesso (ex.: cada login em meu_perfil) não são registradas.
create or replace function privado.tg_auditar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes jsonb;
  v_depois jsonb;
  v_linha jsonb;
  v_registro text;
  v_militar uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_antes := to_jsonb(old);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_depois := to_jsonb(new);
  end if;
  if tg_op = 'UPDATE'
     and (v_antes - array['atualizado_em', 'ultimo_acesso']) = (v_depois - array['atualizado_em', 'ultimo_acesso']) then
    return null;
  end if;

  v_linha := coalesce(v_depois, v_antes);
  if tg_nargs = 0 then
    v_registro := v_linha ->> 'id';
  else
    select string_agg(v_linha ->> t.coluna, ':' order by t.posicao)
      into v_registro
      from unnest(tg_argv) with ordinality as t(coluna, posicao);
  end if;

  v_militar := privado.meu_militar_id();
  insert into public.auditoria (militar_id, militar_nome, usuario_id, tabela, operacao, registro_id, antes, depois)
  values (v_militar, privado.nome_militar(v_militar), auth.uid(), tg_table_name, tg_op, v_registro, v_antes, v_depois);
  return null;
end
$$;

drop trigger if exists setores_auditoria on public.setores;
create trigger setores_auditoria
  after insert or update or delete on public.setores
  for each row execute function privado.tg_auditar();

drop trigger if exists militares_auditoria on public.militares;
create trigger militares_auditoria
  after insert or update or delete on public.militares
  for each row execute function privado.tg_auditar();

drop trigger if exists atividades_auditoria on public.atividades;
create trigger atividades_auditoria
  after insert or update or delete on public.atividades
  for each row execute function privado.tg_auditar();

drop trigger if exists atividade_responsaveis_auditoria on public.atividade_responsaveis;
create trigger atividade_responsaveis_auditoria
  after insert or update or delete on public.atividade_responsaveis
  for each row execute function privado.tg_auditar('atividade_id', 'militar_id');

drop trigger if exists ocorrencias_auditoria on public.ocorrencias;
create trigger ocorrencias_auditoria
  after insert or update or delete on public.ocorrencias
  for each row execute function privado.tg_auditar();

drop trigger if exists evidencias_auditoria on public.evidencias;
create trigger evidencias_auditoria
  after insert or update or delete on public.evidencias
  for each row execute function privado.tg_auditar();

drop trigger if exists comentarios_auditoria on public.comentarios;
create trigger comentarios_auditoria
  after insert or update or delete on public.comentarios
  for each row execute function privado.tg_auditar();

drop trigger if exists avisos_auditoria on public.avisos;
create trigger avisos_auditoria
  after insert or update or delete on public.avisos
  for each row execute function privado.tg_auditar();

drop trigger if exists feriados_auditoria on public.feriados;
create trigger feriados_auditoria
  after insert or update or delete on public.feriados
  for each row execute function privado.tg_auditar('data');

drop trigger if exists configuracoes_auditoria on public.configuracoes;
create trigger configuracoes_auditoria
  after insert or update or delete on public.configuracoes
  for each row execute function privado.tg_auditar('chave');

-- =========================================================================
-- RPCs PÚBLICAS (expostas pela API; execute só para authenticated — 02)
-- =========================================================================

-- Perfil do militar logado. Registra o último acesso (no máximo uma vez
-- por minuto: cada abertura do app chama esta função, e cada gravação em
-- militares é transmitida em tempo real a todos).
create or replace function public.meu_perfil()
returns public.militares
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_linha public.militares%rowtype;
begin
  if auth.uid() is null then
    raise exception 'sem_cadastro' using errcode = '42501';
  end if;
  if not privado.mfa_ok() then
    raise exception 'Confirme o código do aplicativo autenticador (segundo fator) para continuar.'
      using errcode = '42501';
  end if;

  update public.militares m
     set ultimo_acesso = now()
   where m.usuario_id = auth.uid()
     and m.ativo
     and (m.ultimo_acesso is null or m.ultimo_acesso < now() - interval '1 minute');

  select * into v_linha
    from public.militares m
   where m.usuario_id = auth.uid()
     and m.ativo;
  if not found then
    raise exception 'sem_cadastro' using errcode = '42501',
      hint = 'Seu usuário não está vinculado a um cadastro ativo. Procure a chefia ou a AQS.';
  end if;
  return v_linha;
end
$$;

create or replace function public.confirmar_troca_senha()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not privado.mfa_ok() then
    raise exception 'Confirme o código do aplicativo autenticador (segundo fator) para continuar.'
      using errcode = '42501';
  end if;
  update public.militares m
     set deve_trocar_senha = false
   where m.usuario_id = auth.uid()
     and m.ativo;
  if not found then
    raise exception 'sem_cadastro' using errcode = '42501';
  end if;
end
$$;

-- Cria/atualiza a atividade e seus responsáveis de forma atômica
-- (ARQUITETURA §3). Chaves ausentes no JSON mantêm o valor atual (na
-- edição) ou o padrão (na criação); chaves presentes com null limpam.
-- Arquivar (ativa → false) encerra como "não se aplica" o que estava em
-- aberto.
-- Erros: 42501 = sem permissão; 22023 = dado inválido; P0002 = não encontrado.
create or replace function public.salvar_atividade(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_eu uuid := privado.meu_militar_id();
  v_gestor boolean := privado.eh_gestor();
  v_hoje date := public.hoje_belem();
  v_id uuid;
  v_existe boolean := false;
  v_antiga public.atividades%rowtype;
  v_nova public.atividades%rowtype;
  v_responsaveis uuid[];
  v_responsaveis_antigos uuid[] := '{}';
  v_responsaveis_informados boolean;
  v_novos uuid[];
  v_regra_mudou boolean := false;
begin
  if v_eu is null then
    raise exception 'Seu usuário não está vinculado a um cadastro ativo.' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Dados da atividade inválidos.' using errcode = '22023';
  end if;

  v_id := privado.json_uuid(p, 'id', 'a atividade');
  if v_id is not null then
    select * into v_antiga from public.atividades a where a.id = v_id for update;
    if not found then
      raise exception 'Atividade não encontrada (pode ter sido excluída).' using errcode = 'P0002';
    end if;
    v_existe := true;
    v_nova := v_antiga;
    select coalesce(array_agg(r.militar_id order by r.militar_id), '{}')
      into v_responsaveis_antigos
      from public.atividade_responsaveis r
     where r.atividade_id = v_id;
  else
    v_nova.descricao := '';
    v_nova.antecipar_dia_util := true;
    v_nova.prioridade := 'normal';
    v_nova.exige_evidencia := false;
    v_nova.ativa := true;
    v_nova.data_inicio := v_hoje;
  end if;

  -- ---------- leitura dos campos ----------
  if p ? 'ordem' then
    v_nova.ordem := coalesce(privado.json_inteiro(p, 'ordem', 'a ordem'), v_antiga.ordem);
  end if;
  if p ? 'titulo' then
    v_nova.titulo := btrim(coalesce(privado.json_texto(p, 'titulo'), ''));
  end if;
  if p ? 'descricao' then
    v_nova.descricao := coalesce(privado.json_texto(p, 'descricao'), '');
  end if;
  if p ? 'setor_id' then
    v_nova.setor_id := privado.json_uuid(p, 'setor_id', 'o setor');
  end if;
  if p ? 'tipo' then
    v_nova.tipo := btrim(privado.json_texto(p, 'tipo'));
  end if;
  if p ? 'periodicidade' then
    v_nova.periodicidade := nullif(btrim(privado.json_texto(p, 'periodicidade')), '');
  end if;
  if p ? 'dia_semana' then
    v_nova.dia_semana := privado.json_inteiro(p, 'dia_semana', 'o dia da semana');
  end if;
  if p ? 'dia_mes' then
    v_nova.dia_mes := privado.json_inteiro(p, 'dia_mes', 'o dia do mês');
  end if;
  if p ? 'mes_inicio' then
    v_nova.mes_inicio := privado.json_inteiro(p, 'mes_inicio', 'o mês de início');
  end if;
  if p ? 'prazo' then
    v_nova.prazo := privado.json_data(p, 'prazo', 'o prazo');
  end if;
  if p ? 'antecipar_dia_util' then
    v_nova.antecipar_dia_util := privado.json_booleano(p, 'antecipar_dia_util', 'antecipar para o dia útil', true);
  end if;
  if p ? 'prioridade' then
    v_nova.prioridade := coalesce(nullif(btrim(privado.json_texto(p, 'prioridade')), ''), 'normal');
  end if;
  if p ? 'exige_evidencia' then
    v_nova.exige_evidencia := privado.json_booleano(p, 'exige_evidencia', 'exige evidência', false);
  end if;
  if p ? 'ativa' then
    v_nova.ativa := privado.json_booleano(p, 'ativa', 'ativa', true);
  end if;
  if p ? 'data_inicio' then
    v_nova.data_inicio := coalesce(privado.json_data(p, 'data_inicio', 'a data de início'),
                                   v_antiga.data_inicio, v_hoje);
  end if;

  -- ---------- validação ----------
  if v_nova.titulo is null or char_length(v_nova.titulo) not between 3 and 200 then
    raise exception 'O título deve ter entre 3 e 200 caracteres.' using errcode = '22023';
  end if;
  if char_length(v_nova.descricao) > 10000 then
    raise exception 'A descrição pode ter no máximo 10.000 caracteres.' using errcode = '22023';
  end if;
  if v_nova.tipo is null or v_nova.tipo not in ('recorrente', 'pontual', 'sob_demanda') then
    raise exception 'Tipo de atividade inválido (use recorrente, pontual ou sob demanda).' using errcode = '22023';
  end if;
  if v_nova.prioridade not in ('baixa', 'normal', 'alta', 'urgente') then
    raise exception 'Prioridade inválida (use baixa, normal, alta ou urgente).' using errcode = '22023';
  end if;

  if v_nova.tipo = 'recorrente' then
    if v_nova.periodicidade is null
       or v_nova.periodicidade not in ('diaria_util', 'semanal', 'mensal', 'trimestral', 'semestral', 'anual') then
      raise exception 'Informe a periodicidade da atividade recorrente.' using errcode = '22023';
    end if;
    if v_nova.periodicidade = 'semanal'
       and (v_nova.dia_semana is null or v_nova.dia_semana not between 1 and 7) then
      raise exception 'Informe o dia da semana (1 = segunda … 7 = domingo).' using errcode = '22023';
    end if;
    if v_nova.periodicidade in ('mensal', 'trimestral', 'semestral', 'anual')
       and (v_nova.dia_mes is null or v_nova.dia_mes not between 1 and 31) then
      raise exception 'Informe o dia do mês (1 a 31; 31 = último dia do mês).' using errcode = '22023';
    end if;
    if v_nova.periodicidade in ('trimestral', 'semestral', 'anual')
       and (v_nova.mes_inicio is null or v_nova.mes_inicio not between 1 and 12) then
      raise exception 'Informe o mês de início do ciclo (1 a 12).' using errcode = '22023';
    end if;
  end if;

  if v_nova.setor_id is not null
     and not exists (select 1 from public.setores s where s.id = v_nova.setor_id) then
    raise exception 'Setor não encontrado.' using errcode = '22023';
  end if;

  -- ---------- responsáveis ----------
  v_responsaveis_informados := p ? 'responsaveis';
  if v_responsaveis_informados then
    if jsonb_typeof(p -> 'responsaveis') is distinct from 'array' then
      raise exception 'A lista de responsáveis é inválida.' using errcode = '22023';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p -> 'responsaveis') e(valor)
       where jsonb_typeof(e.valor) <> 'string'
          or (e.valor #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ) then
      raise exception 'A lista de responsáveis contém um identificador inválido.' using errcode = '22023';
    end if;
    select coalesce(array_agg(distinct (e.valor #>> '{}')::uuid order by (e.valor #>> '{}')::uuid), '{}')
      into v_responsaveis
      from jsonb_array_elements(p -> 'responsaveis') e(valor);
    if cardinality(v_responsaveis) = 0 then
      raise exception 'Informe ao menos um responsável.' using errcode = '22023';
    end if;
  elsif v_existe then
    v_responsaveis := v_responsaveis_antigos;
  else
    raise exception 'Informe ao menos um responsável.' using errcode = '22023';
  end if;

  -- ---------- permissões ----------
  if not v_gestor then
    if not v_existe then
      if v_nova.tipo not in ('pontual', 'sob_demanda') then
        raise exception 'Apenas a chefia pode criar atividades recorrentes.' using errcode = '42501';
      end if;
      if not (v_eu = any (v_responsaveis)) then
        raise exception 'Inclua você mesmo entre os responsáveis da nova atividade.' using errcode = '42501';
      end if;
    else
      if not (v_eu = any (v_responsaveis_antigos)) then
        raise exception 'Apenas a chefia ou os responsáveis podem editar esta atividade.' using errcode = '42501';
      end if;
      if v_responsaveis is distinct from v_responsaveis_antigos then
        raise exception 'Apenas a chefia pode alterar os responsáveis de uma atividade.' using errcode = '42501';
      end if;
      if v_nova.tipo = 'recorrente' and v_antiga.tipo <> 'recorrente' then
        raise exception 'Apenas a chefia pode transformar uma atividade em recorrente.' using errcode = '42501';
      end if;
    end if;
  end if;

  -- Quem entra agora precisa existir, estar ativo e não ser a conta
  -- institucional (que não recebe missões). Quem já estava pode ficar.
  select coalesce(array_agg(r.id), '{}') into v_novos
    from unnest(v_responsaveis) as r(id)
   where not (r.id = any (v_responsaveis_antigos));
  if exists (select 1 from unnest(v_novos) r(id)
              where not exists (select 1 from public.militares m where m.id = r.id)) then
    raise exception 'Responsável não encontrado (o cadastro pode ter sido excluído).' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_novos) r(id)
               join public.militares m on m.id = r.id
              where m.papel = 'administrador') then
    raise exception 'A conta institucional (administrador) não recebe missões; escolha um militar da equipe.'
      using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_novos) r(id)
               join public.militares m on m.id = r.id
              where not m.ativo) then
    raise exception 'Não é possível atribuir a atividade a um militar desativado.' using errcode = '22023';
  end if;

  -- ---------- gravação ----------
  if v_existe then
    v_regra_mudou :=
      (v_nova.tipo, v_nova.periodicidade, v_nova.dia_semana, v_nova.dia_mes, v_nova.mes_inicio,
       v_nova.antecipar_dia_util, v_nova.ativa, v_nova.data_inicio)
      is distinct from
      (v_antiga.tipo, v_antiga.periodicidade, v_antiga.dia_semana, v_antiga.dia_mes, v_antiga.mes_inicio,
       v_antiga.antecipar_dia_util, v_antiga.ativa, v_antiga.data_inicio);

    update public.atividades a
       set ordem = v_nova.ordem,
           titulo = v_nova.titulo,
           descricao = v_nova.descricao,
           setor_id = v_nova.setor_id,
           tipo = v_nova.tipo,
           periodicidade = v_nova.periodicidade,
           dia_semana = v_nova.dia_semana,
           dia_mes = v_nova.dia_mes,
           mes_inicio = v_nova.mes_inicio,
           prazo = v_nova.prazo,
           antecipar_dia_util = v_nova.antecipar_dia_util,
           prioridade = v_nova.prioridade,
           exige_evidencia = v_nova.exige_evidencia,
           ativa = v_nova.ativa,
           data_inicio = v_nova.data_inicio
     where a.id = v_id;
  else
    insert into public.atividades (
      ordem, titulo, descricao, setor_id, tipo, periodicidade, dia_semana, dia_mes, mes_inicio,
      prazo, antecipar_dia_util, prioridade, exige_evidencia, ativa, data_inicio, criado_por)
    values (
      v_nova.ordem, v_nova.titulo, v_nova.descricao, v_nova.setor_id, v_nova.tipo, v_nova.periodicidade,
      v_nova.dia_semana, v_nova.dia_mes, v_nova.mes_inicio, v_nova.prazo, v_nova.antecipar_dia_util,
      v_nova.prioridade, v_nova.exige_evidencia, v_nova.ativa, v_nova.data_inicio, v_eu)
    returning id into v_id;
  end if;

  if v_responsaveis_informados then
    delete from public.atividade_responsaveis r
     where r.atividade_id = v_id
       and not (r.militar_id = any (v_responsaveis));
    insert into public.atividade_responsaveis (atividade_id, militar_id)
    select v_id, r.id from unnest(v_responsaveis) as r(id)
    on conflict do nothing;
  end if;

  -- Regra de agenda mudou: as ocorrências recorrentes FUTURAS ainda
  -- pendentes e sem evidência/comentário saem e são geradas de novo pela
  -- regra nova. As que já têm trabalho registrado ficam como estão. A 'P'
  -- das pontuais é tratada pelo gatilho atividades_pontual.
  if v_existe and v_regra_mudou then
    delete from public.ocorrencias o
     where o.atividade_id = v_id
       and o.status = 'pendente'
       and o.prazo >= v_hoje
       and o.referencia is not null
       and o.referencia <> 'P'
       and not exists (select 1 from public.evidencias e where e.ocorrencia_id = o.id)
       and not exists (select 1 from public.comentarios c where c.ocorrencia_id = o.id);
  end if;

  -- Arquivada agora: o que ainda estava em aberto (vencidas, ou futuras que
  -- já tinham trabalho registrado) passa a "não se aplica", com a
  -- justificativa. Sem isso ficaria "atrasado" para sempre, cobrando uma
  -- atividade que ninguém mais executa, e Início, Quadro e Relatórios não
  -- bateriam. Reativar não reabre essas (a chefia reabre uma a uma, se for
  -- o caso); as futuras voltam a ser geradas pela regra.
  if v_existe and v_antiga.ativa and not v_nova.ativa then
    update public.ocorrencias o
       set status = 'nao_se_aplica',
           justificativa = 'Atividade arquivada em ' || to_char(v_hoje::timestamp, 'DD/MM/YYYY') ||
                           coalesce(' por ' || privado.nome_militar(v_eu), '') || '.'
     where o.atividade_id = v_id
       and o.status in ('pendente', 'em_andamento');
  end if;

  perform privado.gerar_ocorrencias_atividade(v_id);
  perform privado.notificar_prazos();
  return v_id;
end
$$;

-- Idempotente; qualquer usuário ativo pode chamar (o app chama após o login).
create or replace function public.gerar_ocorrencias()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quantidade int;
begin
  if not privado.eh_ativo() then
    raise exception 'Seu usuário não está vinculado a um cadastro ativo.' using errcode = '42501';
  end if;
  v_quantidade := privado.gerar_todas();
  perform privado.notificar_prazos();
  return v_quantidade;
end
$$;

-- Passagem de chefia guiada (ARQUITETURA §3). Atômica: ou tudo, ou nada.
-- p_para vira chefia (reativado se preciso); p_de (nulo quando não há
-- chefia) passa a p_papel_anterior; com p_transferir_atividades, as
-- responsabilidades de p_de em atividades ATIVAS passam para p_para.
-- A trava anti-bloqueio continua valendo (gatilho de militares).
create or replace function public.transferir_chefia(
  p_de uuid,
  p_para uuid,
  p_papel_anterior text default 'adjunto',
  p_transferir_atividades boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_papel_anterior text := coalesce(nullif(btrim(p_papel_anterior), ''), 'adjunto');
  v_de public.militares%rowtype;
  v_para public.militares%rowtype;
begin
  if not privado.eh_gestor() then
    raise exception 'Apenas a chefia ou a conta institucional da AQS podem fazer a passagem de chefia.'
      using errcode = '42501';
  end if;
  if p_para is null then
    raise exception 'Escolha o militar que vai assumir a chefia.' using errcode = '22023';
  end if;
  if v_papel_anterior not in ('adjunto', 'chefia') then
    raise exception 'Quem deixa a chefia passa a "adjunto" ou continua como "chefia".' using errcode = '22023';
  end if;
  if p_de is not null and p_de = p_para then
    raise exception 'Quem deixa e quem assume a chefia precisam ser militares diferentes.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('aqs-nsp:gestores'));

  select * into v_para from public.militares m where m.id = p_para for update;
  if not found then
    raise exception 'O militar escolhido para assumir a chefia não foi encontrado.' using errcode = 'P0002';
  end if;
  if v_para.papel = 'administrador' then
    raise exception 'A conta institucional (administrador) não assume a chefia; escolha um militar da equipe.'
      using errcode = '22023';
  end if;

  if p_de is not null then
    select * into v_de from public.militares m where m.id = p_de for update;
    if not found then
      raise exception 'O militar que deixa a chefia não foi encontrado.' using errcode = 'P0002';
    end if;
    if v_de.papel <> 'chefia' then
      raise exception '% não está com o papel de chefia.', privado.nome_militar(p_de) using errcode = '22023';
    end if;
  end if;

  -- Promove antes de rebaixar: a trava anti-bloqueio já enxerga a nova chefia.
  update public.militares m
     set papel = 'chefia',
         ativo = true
   where m.id = p_para;

  if p_de is not null then
    if v_papel_anterior <> 'chefia' then
      update public.militares m
         set papel = v_papel_anterior
       where m.id = p_de;
    end if;

    if coalesce(p_transferir_atividades, true) then
      insert into public.atividade_responsaveis (atividade_id, militar_id)
      select r.atividade_id, p_para
        from public.atividade_responsaveis r
        join public.atividades a on a.id = r.atividade_id and a.ativa
       where r.militar_id = p_de
      on conflict do nothing;

      delete from public.atividade_responsaveis r
       using public.atividades a
       where a.id = r.atividade_id
         and a.ativa
         and r.militar_id = p_de;
    end if;
  end if;
end
$$;
