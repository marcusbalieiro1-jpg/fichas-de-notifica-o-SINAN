-- =========================================================================
-- HABE · AQS e NSP — Ferramenta de Gestão de Atividades
-- 03-tempo-real-agenda.sql — tempo real (Realtime) e rotina diária (pg_cron)
--
-- Rode depois do 02-seguranca.sql. Reexecutável. Os blocos não falham
-- quando a publicação ou o pg_cron não existem (teste local): avisam e
-- seguem.
-- =========================================================================

-- ---------- Realtime ----------
-- As telas assinam mudanças destas tabelas (Api.assinarMudancas). O
-- Realtime do Supabase respeita a RLS: cada um só recebe o que pode ler.
-- Ficam de fora auditoria, configuracoes, feriados e avisos_destinatarios
-- (lidos sob demanda).
do $$
declare
  v_tabela text;
  v_todas boolean;
begin
  select p.puballtables into v_todas
    from pg_publication p
   where p.pubname = 'supabase_realtime';

  if not found then
    raise notice 'Publicação supabase_realtime não existe: tempo real não configurado (normal fora do Supabase).';
    return;
  end if;
  if v_todas then
    raise notice 'A publicação supabase_realtime já inclui todas as tabelas.';
    return;
  end if;

  foreach v_tabela in array array[
    'ocorrencias', 'comentarios', 'evidencias', 'atividades', 'atividade_responsaveis',
    'avisos', 'avisos_ciencia', 'notificacoes', 'militares', 'setores'
  ] loop
    if not exists (
      select 1 from pg_publication_tables t
       where t.pubname = 'supabase_realtime'
         and t.schemaname = 'public'
         and t.tablename = v_tabela
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_tabela);
    end if;
  end loop;
end
$$;

-- ---------- pg_cron: rotina diária às 00:05 de Belém ----------
-- '5 3 * * *' em UTC = 00:05 em Belém (UTC−3, sem horário de verão).
-- privado.rotina_diaria() gera as ocorrências da janela, avisa os prazos de
-- hoje/amanhã e limpa notificações lidas antigas. O app também gera ao
-- entrar (gerar_ocorrencias), então um dia sem cron não perde nada.
-- No Supabase, se a criação da extensão falhar por permissão, ative-a em
-- Database → Extensions → pg_cron e rode este arquivo de novo.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
      begin
        execute 'create extension if not exists pg_cron with schema pg_catalog';
      exception when others then
        raise notice 'Não foi possível criar a extensão pg_cron (%). Ative-a em Database → Extensions → pg_cron e rode este arquivo de novo.', sqlerrm;
      end;
    end if;
  end if;

  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron indisponível: a rotina diária não foi agendada (normal fora do Supabase). O app gera as ocorrências a cada login.';
    return;
  end if;

  -- Remove o agendamento anterior com o mesmo nome (se houver) e recria,
  -- para que mudanças de horário/comando neste arquivo valham ao reexecutar.
  execute $sql$
    select cron.unschedule(j.jobid) from cron.job j where j.jobname = 'aqs-rotina-diaria'
  $sql$;
  execute $sql$
    select cron.schedule('aqs-rotina-diaria', '5 3 * * *', 'select privado.rotina_diaria()')
  $sql$;
  raise notice 'Rotina diária agendada: aqs-rotina-diaria (00:05 de Belém).';
end
$$;
