-- =========================================================================
-- HABE · AQS e NSP — Ferramenta de Gestão de Atividades
-- 02-seguranca.sql — privilégios, RLS (Row Level Security) e Storage
--
-- Rode depois do 01-estrutura.sql. Reexecutável: refaz grants e políticas
-- do zero a cada execução (as políticas antigas das nossas tabelas são
-- apagadas antes, para que o resultado seja exatamente o deste arquivo).
--
-- Princípios (ARQUITETURA §3, "Regras de acesso"):
--  * anon (quem não fez login) não tem NENHUM acesso: nem tabela, nem view,
--    nem função. A chave anon publicada no config.js não abre nada.
--  * authenticated recebe só os privilégios que alguma política usa; a RLS
--    decide linha a linha. "Ativo" vale em TODAS as políticas: desativar o
--    cadastro corta o acesso na hora, mesmo com sessão aberta.
--  * Os auxiliares de privado são chamados como (select privado.f()) para
--    o PostgreSQL avaliá-los uma vez por consulta, não uma vez por linha.
-- =========================================================================

-- ---------- anon: nada ----------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on schema privado from public, anon;

-- Objetos criados no futuro em public pelo dono também nascem sem acesso
-- para anon (o Supabase concede tudo a anon por padrão).
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

-- ---------- authenticated: o mínimo de cada tabela ----------
revoke all on
  public.setores, public.militares, public.atividades, public.atividade_responsaveis,
  public.ocorrencias, public.evidencias, public.comentarios, public.avisos,
  public.avisos_destinatarios, public.avisos_ciencia, public.notificacoes,
  public.feriados, public.configuracoes, public.auditoria, public.v_ocorrencias
from authenticated;
revoke all on all sequences in schema public from authenticated;

grant select, insert, update, delete on public.setores to authenticated;
grant select, insert, update, delete on public.feriados to authenticated;
grant select, insert, update, delete on public.configuracoes to authenticated;
grant select, insert, update, delete on public.militares to authenticated;
-- atividades e responsáveis: escrita só pela RPC salvar_atividade.
grant select, delete on public.atividades to authenticated;
grant select on public.atividade_responsaveis to authenticated;
grant select, insert, update, delete on public.ocorrencias to authenticated;
grant select, insert, delete on public.evidencias to authenticated;
grant select, insert, delete on public.comentarios to authenticated;
grant select, insert, update, delete on public.avisos to authenticated;
grant select, insert, delete on public.avisos_destinatarios to authenticated;
grant select, insert on public.avisos_ciencia to authenticated;
-- notificações: só marcar como lida (coluna lida) e apagar as próprias.
grant select, delete on public.notificacoes to authenticated;
grant update (lida) on public.notificacoes to authenticated;
grant select on public.auditoria to authenticated;
grant select on public.v_ocorrencias to authenticated;

-- ---------- funções ----------
-- Funções nascem executáveis por PUBLIC; aqui fica só quem precisa.
revoke all on function public.hoje_belem() from public, anon;
revoke all on function public.meu_perfil() from public, anon;
revoke all on function public.confirmar_troca_senha() from public, anon;
revoke all on function public.salvar_atividade(jsonb) from public, anon;
revoke all on function public.gerar_ocorrencias() from public, anon;
revoke all on function public.transferir_chefia(uuid, uuid, text, boolean) from public, anon;

grant execute on function public.hoje_belem() to authenticated, service_role;
grant execute on function public.meu_perfil() to authenticated, service_role;
grant execute on function public.confirmar_troca_senha() to authenticated, service_role;
grant execute on function public.salvar_atividade(jsonb) to authenticated, service_role;
grant execute on function public.gerar_ocorrencias() to authenticated, service_role;
grant execute on function public.transferir_chefia(uuid, uuid, text, boolean) to authenticated, service_role;

-- privado: ninguém executa nada, exceto os auxiliares que as políticas e
-- os gatilhos SECURITY INVOKER chamam. vincular_usuario, rotina_diaria,
-- gerar_todas, notificar_prazos etc. ficam só para o dono (SQL Editor e
-- pg_cron). O schema privado não é exposto pela API REST.
revoke all on all functions in schema privado from public, anon, authenticated, service_role;
grant usage on schema privado to authenticated, service_role;
grant execute on function
  privado.meu_militar_id(),
  privado.eh_ativo(),
  privado.eh_gestor(),
  privado.eh_administrador(),
  privado.eh_responsavel(uuid),
  privado.pode_enviar_evidencia(text),
  privado.nome_militar(uuid)
to authenticated, service_role;

-- =========================================================================
-- RLS — liga em todas as tabelas e recria as políticas
-- =========================================================================

do $$
declare
  v_tabela text;
  v_politica record;
begin
  foreach v_tabela in array array[
    'setores', 'militares', 'atividades', 'atividade_responsaveis', 'ocorrencias',
    'evidencias', 'comentarios', 'avisos', 'avisos_destinatarios', 'avisos_ciencia',
    'notificacoes', 'feriados', 'configuracoes', 'auditoria'
  ] loop
    execute format('alter table public.%I enable row level security', v_tabela);
    for v_politica in
      select p.policyname from pg_policies p
       where p.schemaname = 'public' and p.tablename = v_tabela
    loop
      execute format('drop policy %I on public.%I', v_politica.policyname, v_tabela);
    end loop;
  end loop;
end
$$;

-- ---------- setores, feriados, configurações: ativo lê; gestor grava ----------
create policy setores_leitura on public.setores
  for select to authenticated
  using ((select privado.eh_ativo()));
create policy setores_inclusao on public.setores
  for insert to authenticated
  with check ((select privado.eh_gestor()));
create policy setores_alteracao on public.setores
  for update to authenticated
  using ((select privado.eh_gestor()))
  with check ((select privado.eh_gestor()));
create policy setores_exclusao on public.setores
  for delete to authenticated
  using ((select privado.eh_gestor()));

create policy feriados_leitura on public.feriados
  for select to authenticated
  using ((select privado.eh_ativo()));
create policy feriados_inclusao on public.feriados
  for insert to authenticated
  with check ((select privado.eh_gestor()));
create policy feriados_alteracao on public.feriados
  for update to authenticated
  using ((select privado.eh_gestor()))
  with check ((select privado.eh_gestor()));
create policy feriados_exclusao on public.feriados
  for delete to authenticated
  using ((select privado.eh_gestor()));

create policy configuracoes_leitura on public.configuracoes
  for select to authenticated
  using ((select privado.eh_ativo()));
create policy configuracoes_inclusao on public.configuracoes
  for insert to authenticated
  with check ((select privado.eh_gestor()));
create policy configuracoes_alteracao on public.configuracoes
  for update to authenticated
  using ((select privado.eh_gestor()))
  with check ((select privado.eh_gestor()));
create policy configuracoes_exclusao on public.configuracoes
  for delete to authenticated
  using ((select privado.eh_gestor()));

-- ---------- militares ----------
-- Gestor inclui, altera e exclui qualquer militar — mas linha com papel
-- administrador (antes OU depois da mudança) só por administrador, e
-- ninguém exclui a si mesmo. O gatilho militares_antes repete essas regras
-- e aplica a trava anti-bloqueio.
create policy militares_leitura on public.militares
  for select to authenticated
  using ((select privado.eh_ativo()));
create policy militares_inclusao on public.militares
  for insert to authenticated
  with check (
    (select privado.eh_gestor())
    and (papel <> 'administrador' or (select privado.eh_administrador()))
  );
create policy militares_alteracao on public.militares
  for update to authenticated
  using (
    (select privado.eh_gestor())
    and (papel <> 'administrador' or (select privado.eh_administrador()))
  )
  with check (
    (select privado.eh_gestor())
    and (papel <> 'administrador' or (select privado.eh_administrador()))
  );
create policy militares_exclusao on public.militares
  for delete to authenticated
  using (
    (select privado.eh_gestor())
    and id <> (select privado.meu_militar_id())
    and (papel <> 'administrador' or (select privado.eh_administrador()))
  );

-- ---------- atividades (escrita pela RPC salvar_atividade) ----------
create policy atividades_leitura on public.atividades
  for select to authenticated
  using ((select privado.eh_ativo()));
create policy atividades_exclusao on public.atividades
  for delete to authenticated
  using ((select privado.eh_gestor()));

create policy atividade_responsaveis_leitura on public.atividade_responsaveis
  for select to authenticated
  using ((select privado.eh_ativo()));

-- ---------- ocorrências ----------
create policy ocorrencias_leitura on public.ocorrencias
  for select to authenticated
  using ((select privado.eh_ativo()));
-- Adjunto só registra execução de atividade sob demanda pela qual responde.
create policy ocorrencias_inclusao on public.ocorrencias
  for insert to authenticated
  with check (
    (select privado.eh_gestor())
    or (
      privado.eh_responsavel(atividade_id)
      and exists (select 1 from public.atividades a
                   where a.id = ocorrencias.atividade_id and a.tipo = 'sob_demanda')
    )
  );
create policy ocorrencias_alteracao on public.ocorrencias
  for update to authenticated
  using ((select privado.eh_gestor()) or privado.eh_responsavel(atividade_id))
  with check ((select privado.eh_gestor()) or privado.eh_responsavel(atividade_id));
create policy ocorrencias_exclusao on public.ocorrencias
  for delete to authenticated
  using ((select privado.eh_gestor()));

-- ---------- evidências ----------
create policy evidencias_leitura on public.evidencias
  for select to authenticated
  using ((select privado.eh_ativo()));
create policy evidencias_inclusao on public.evidencias
  for insert to authenticated
  with check (
    ((select privado.eh_gestor()) or privado.eh_responsavel(atividade_id))
    and enviado_por = (select privado.meu_militar_id())
  );
create policy evidencias_exclusao on public.evidencias
  for delete to authenticated
  using (
    (select privado.eh_gestor())
    or enviado_por = (select privado.meu_militar_id())
  );

-- ---------- comentários (sem edição) ----------
create policy comentarios_leitura on public.comentarios
  for select to authenticated
  using ((select privado.eh_ativo()));
create policy comentarios_inclusao on public.comentarios
  for insert to authenticated
  with check (
    (select privado.eh_ativo())
    and autor_id = (select privado.meu_militar_id())
  );
create policy comentarios_exclusao on public.comentarios
  for delete to authenticated
  using (
    (select privado.eh_gestor())
    or autor_id = (select privado.meu_militar_id())
  );

-- ---------- avisos ----------
create policy avisos_leitura on public.avisos
  for select to authenticated
  using (
    (select privado.eh_gestor())
    or ((select privado.eh_ativo()) and para_todos)
    or exists (
      select 1 from public.avisos_destinatarios d
       where d.aviso_id = avisos.id
         and d.militar_id = (select privado.meu_militar_id())
    )
  );
create policy avisos_inclusao on public.avisos
  for insert to authenticated
  with check ((select privado.eh_gestor()));
create policy avisos_alteracao on public.avisos
  for update to authenticated
  using ((select privado.eh_gestor()))
  with check ((select privado.eh_gestor()));
create policy avisos_exclusao on public.avisos
  for delete to authenticated
  using ((select privado.eh_gestor()));

create policy avisos_destinatarios_leitura on public.avisos_destinatarios
  for select to authenticated
  using ((select privado.eh_ativo()));
create policy avisos_destinatarios_inclusao on public.avisos_destinatarios
  for insert to authenticated
  with check ((select privado.eh_gestor()));
create policy avisos_destinatarios_exclusao on public.avisos_destinatarios
  for delete to authenticated
  using ((select privado.eh_gestor()));

-- Ciência: cada um registra a sua, e só de aviso que consegue ver (o
-- exists abaixo passa pela RLS de avisos).
create policy avisos_ciencia_leitura on public.avisos_ciencia
  for select to authenticated
  using (
    (select privado.eh_gestor())
    or militar_id = (select privado.meu_militar_id())
  );
create policy avisos_ciencia_inclusao on public.avisos_ciencia
  for insert to authenticated
  with check (
    militar_id = (select privado.meu_militar_id())
    and exists (select 1 from public.avisos a where a.id = avisos_ciencia.aviso_id)
  );

-- ---------- notificações: cada um só as suas (inclusão só por gatilhos) ----------
create policy notificacoes_leitura on public.notificacoes
  for select to authenticated
  using (destinatario_id = (select privado.meu_militar_id()));
create policy notificacoes_alteracao on public.notificacoes
  for update to authenticated
  using (destinatario_id = (select privado.meu_militar_id()))
  with check (destinatario_id = (select privado.meu_militar_id()));
create policy notificacoes_exclusao on public.notificacoes
  for delete to authenticated
  using (destinatario_id = (select privado.meu_militar_id()));

-- ---------- auditoria: só gestor lê (inclusão só por gatilho) ----------
create policy auditoria_leitura on public.auditoria
  for select to authenticated
  using ((select privado.eh_gestor()));

-- =========================================================================
-- STORAGE — bucket privado "evidencias"
-- Caminho: {atividade_id}/{ocorrencia_id ou 'geral'}/{uuid}-{nome-seguro}
-- =========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'evidencias',
  'evidencias',
  false,
  20971520, -- 20 MB (igual a AQS_CONFIG.LIMITE_ARQUIVO_MB)
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.oasis.opendocument.presentation',
    'image/jpeg',
    'image/png',
    'text/plain',
    'text/csv'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Só as nossas políticas são recriadas; outras de storage.objects ficam.
drop policy if exists aqs_evidencias_leitura on storage.objects;
drop policy if exists aqs_evidencias_envio on storage.objects;
drop policy if exists aqs_evidencias_exclusao on storage.objects;

create policy aqs_evidencias_leitura on storage.objects
  for select to authenticated
  using (
    bucket_id = 'evidencias'
    and (select privado.eh_ativo())
  );

-- A 1ª pasta é o id da atividade: só gestor ou responsável por ela envia.
create policy aqs_evidencias_envio on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'evidencias'
    and (select privado.eh_ativo())
    and privado.pode_enviar_evidencia((storage.foldername(name))[1])
  );

-- Sem política de UPDATE: arquivo enviado não é substituído; exclui-se e
-- envia-se outro (fica na auditoria da tabela evidencias).
create policy aqs_evidencias_exclusao on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'evidencias'
    and (select privado.eh_ativo())
    and ((select privado.eh_gestor()) or owner_id = (select auth.uid())::text)
  );
