-- =========================================================================
-- HABE · AQS e NSP — imitação MÍNIMA do Supabase para testar o banco local
--
-- NÃO RODE NO SUPABASE. Este arquivo só existe para os testes locais
-- (testes/executar-sql.sh): cria, num PostgreSQL comum, o pedaço do
-- Supabase de que os scripts supabase/*.sql dependem:
--   * os papéis anon, authenticated e service_role;
--   * auth.users, auth.mfa_factors e as funções auth.uid(), auth.jwt() e
--     auth.role(), que leem o "crachá" (JWT) da requisição em
--     request.jwt.claims — é assim que o PostgREST do Supabase informa ao
--     banco quem está chamando;
--   * storage.buckets, storage.objects (com RLS ligada) e
--     storage.foldername();
--   * a publicação supabase_realtime, vazia.
--
-- Os privilégios imitam os do Supabase de propósito: anon e authenticated
-- recebem ALL nas tabelas de public por privilégio padrão. Assim, quem
-- bloqueia o acesso nos testes é de fato o que os nossos scripts fazem
-- (revoke + RLS), e não a falta de grant do ambiente de teste.
-- =========================================================================

-- ---------- papéis ----------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    -- No Supabase a service_role ignora a RLS (bypassrls).
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

-- ---------- privilégios padrão do schema public (como no Supabase) ----------
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- ---------- auth ----------
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  banned_until timestamptz
);
-- Bancos de teste criados antes desta coluna existir.
alter table auth.users add column if not exists banned_until timestamptz;

-- Mesma lógica do Supabase: aceita o formato antigo (request.jwt.claim.sub)
-- e o atual (request.jwt.claims, JSON com o crachá inteiro).
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role() returns text
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

create or replace function auth.jwt() returns jsonb
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

grant execute on function auth.uid(), auth.role(), auth.jwt() to anon, authenticated, service_role;

-- Fatores do segundo fator (TOTP). No Supabase, status é o enum
-- auth.factor_status ('unverified' | 'verified'); aqui, texto.
create table if not exists auth.mfa_factors (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  factor_type text not null default 'totp',
  status text not null default 'unverified'
);

-- ---------- storage ----------
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  owner_id text,
  created_at timestamptz default now()
);

alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;

grant all on storage.buckets to anon, authenticated, service_role;
grant all on storage.objects to anon, authenticated, service_role;

-- As pastas do caminho, sem o nome do arquivo:
-- 'a/b/arquivo.pdf' → {a,b}. Igual à função do Supabase.
create or replace function storage.foldername(name text) returns text[]
language plpgsql immutable
as $$
declare
  _partes text[];
begin
  select string_to_array(name, '/') into _partes;
  return _partes[1:array_length(_partes, 1) - 1];
end
$$;

grant execute on function storage.foldername(text) to anon, authenticated, service_role;

-- ---------- tempo real ----------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;
