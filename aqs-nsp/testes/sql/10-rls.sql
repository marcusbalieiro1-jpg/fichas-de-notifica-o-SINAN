-- =========================================================================
-- HABE · AQS e NSP — testes de acesso (RLS, grants, gatilhos e RPCs)
--
-- Roda sobre o banco carregado com 00-stub + supabase/01..04 (veja
-- testes/executar-sql.sh). Tudo acontece numa única transação desfeita no
-- fim: o banco volta ao estado da carga inicial.
--
-- Cada usuário é simulado como o PostgREST do Supabase faz: o papel
-- "authenticated" e o crachá (JWT) em request.jwt.claims. Atualização ou
-- exclusão barrada pela RLS NÃO dá erro (só não acha a linha): por isso
-- conferimos a quantidade de linhas afetadas. Inclusão barrada dá erro
-- 42501. A primeira verificação que falhar interrompe o arquivo com a
-- mensagem "FALHOU: ...".
-- =========================================================================

\set ON_ERROR_STOP 1
\o /dev/null
set client_min_messages = warning;

begin;

-- =========================================================================
-- Auxiliares de teste (somem no rollback)
-- =========================================================================
create schema testes;
grant usage on schema testes to public;
create sequence testes.verificacoes;
grant usage, select on sequence testes.verificacoes to public;

create function testes.afirmar(p_condicao boolean, p_mensagem text)
returns void language plpgsql as $$
begin
  if p_condicao is distinct from true then
    raise exception 'FALHOU: %', p_mensagem;
  end if;
  perform nextval('testes.verificacoes');
end
$$;

-- Executa p_sql e exige o erro p_codigo (e, se dado, um trecho da mensagem).
create function testes.espera_erro(p_sql text, p_codigo text, p_mensagem text, p_trecho text default null)
returns void language plpgsql as $$
declare
  v_estado text;
  v_texto text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_estado = returned_sqlstate, v_texto = message_text;
  end;
  if v_estado is null then
    raise exception 'FALHOU: % — deveria dar erro % e funcionou', p_mensagem, p_codigo;
  end if;
  if v_estado <> p_codigo then
    raise exception 'FALHOU: % — esperado erro %, veio % (%)', p_mensagem, p_codigo, v_estado, v_texto;
  end if;
  if p_trecho is not null and position(p_trecho in v_texto) = 0 then
    raise exception 'FALHOU: % — a mensagem deveria conter "%", veio "%"', p_mensagem, p_trecho, v_texto;
  end if;
  perform nextval('testes.verificacoes');
end
$$;

-- Linhas afetadas por um insert/update/delete (a RLS filtra em silêncio).
create function testes.linhas(p_sql text)
returns bigint language plpgsql as $$
declare
  v_quantidade bigint;
begin
  execute p_sql;
  get diagnostics v_quantidade = row_count;
  return v_quantidade;
end
$$;

create function testes.contar(p_sql text)
returns bigint language plpgsql as $$
declare
  v_quantidade bigint;
begin
  execute format('select count(*) from (%s) as x', p_sql) into v_quantidade;
  return v_quantidade;
end
$$;

-- Troca de identidade dentro da transação (vale até o rollback).
create function testes.como(p_usuario uuid)
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims',
                     json_build_object('sub', p_usuario, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end
$$;

-- Mesmo crachá, com o nível da sessão (aal1 = só senha; aal2 = senha e
-- código do segundo fator).
create function testes.como_aal(p_usuario uuid, p_aal text)
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims',
                     json_build_object('sub', p_usuario, 'role', 'authenticated', 'aal', p_aal)::text, true);
  execute 'set local role authenticated';
end
$$;

create function testes.como_anon()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
end
$$;

-- Dono do banco sem usuário logado (SQL Editor / service role / cron).
create function testes.como_dono()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end
$$;

grant execute on all functions in schema testes to public;

-- =========================================================================
-- Massa de teste: usuários do Auth ligados aos militares da carga inicial
-- =========================================================================
\set u_leticia 'a0000000-0000-4000-8000-000000000001'
\set u_wallace 'a0000000-0000-4000-8000-000000000002'
\set u_balieiro 'a0000000-0000-4000-8000-000000000003'
\set u_chefia 'a0000000-0000-4000-8000-000000000004'
\set u_admin 'a0000000-0000-4000-8000-000000000005'
\set u_sem 'a0000000-0000-4000-8000-000000000006'
\set u_chefia2 'a0000000-0000-4000-8000-000000000007'

insert into auth.users (id, email) values
  (:'u_leticia', 'leticia@teste.local'),
  (:'u_wallace', 'wallace@teste.local'),
  (:'u_balieiro', 'balieiro@teste.local'),
  (:'u_chefia', 'chefia@teste.local'),
  (:'u_admin', 'AQS.Institucional@Teste.Local'),
  (:'u_sem', 'sem-cadastro@teste.local'),
  (:'u_chefia2', 'chefia2@teste.local');

select
  max(id::text) filter (where nome_guerra = 'Letícia') as m_leticia,
  max(id::text) filter (where nome_guerra = 'Wallace') as m_wallace,
  max(id::text) filter (where nome_guerra = 'Balieiro') as m_balieiro,
  max(id::text) filter (where nome_guerra = 'Chefia AQS/NSP') as m_chefia,
  max(id::text) filter (where papel = 'administrador') as m_admin
from public.militares \gset

update public.militares set usuario_id = :'u_leticia', email = 'Leticia@Teste.Local ' where id = :'m_leticia';
update public.militares set usuario_id = :'u_wallace', email = 'wallace@teste.local' where id = :'m_wallace';
update public.militares set usuario_id = :'u_balieiro', email = 'balieiro@teste.local' where id = :'m_balieiro';
update public.militares set usuario_id = :'u_chefia', email = 'chefia@teste.local' where id = :'m_chefia';

\echo '-- vincular_usuario (implantação da conta institucional)'
select privado.vincular_usuario('  aqs.institucional@teste.local ');
select testes.afirmar(
  (select usuario_id = :'u_admin' and email = 'aqs.institucional@teste.local' and ativo and not deve_trocar_senha
     from public.militares where id = :'m_admin'),
  'vincular_usuario liga o e-mail à conta institucional (administrador), em minúsculas, sem troca obrigatória');
select testes.afirmar(
  (select email = 'leticia@teste.local' from public.militares where id = :'m_leticia'),
  'e-mail de militar é gravado em minúsculas e sem espaços');
select testes.espera_erro($$select privado.vincular_usuario('ninguem@teste.local')$$, 'P0002',
  'vincular_usuario recusa e-mail sem usuário no Auth', 'Authentication');

\echo '-- vincular_usuario (recuperação de emergência)'
savepoint emergencia;
-- "Ninguém sabe a senha da conta institucional": novo usuário no Auth,
-- religado à mesma conta; o usuário antigo fica sem cadastro.
insert into auth.users (id, email) values ('a0000000-0000-4000-8000-0000000000aa', 'aqs.nova@teste.local');
select privado.vincular_usuario('aqs.nova@teste.local');
select testes.afirmar(
  (select usuario_id = 'a0000000-0000-4000-8000-0000000000aa' and email = 'aqs.nova@teste.local'
     from public.militares where id = :'m_admin'),
  'vincular_usuario troca o usuário da conta institucional');
select testes.afirmar(not exists (select 1 from public.militares where usuario_id = :'u_admin'),
  'o usuário antigo da conta institucional fica sem cadastro');
-- Devolver o acesso a outra pessoa: o usuário sai de um cadastro e vai
-- para o outro na mesma transação (unicidade conferida no fim).
select privado.vincular_usuario('chefia@teste.local', :'m_wallace');
select testes.afirmar(
  (select usuario_id = :'u_chefia' and email = 'chefia@teste.local' and ativo
     from public.militares where id = :'m_wallace'),
  'vincular_usuario move o usuário para o militar indicado');
select testes.afirmar(
  (select usuario_id is null and email is null from public.militares where id = :'m_chefia'),
  'o cadastro antigo perde o usuário e o e-mail');
rollback to savepoint emergencia;

savepoint emergencia_trava;
-- Mover o login do único gestor com acesso para um adjunto travaria o
-- sistema: a trava anti-bloqueio recusa e nada muda.
update public.militares set usuario_id = null where id = :'m_admin';
select testes.espera_erro(format($$select privado.vincular_usuario('chefia@teste.local', %L)$$, :'m_balieiro'), 'P0001',
  'vincular_usuario respeita a trava anti-bloqueio');
select testes.afirmar((select usuario_id = :'u_chefia' from public.militares where id = :'m_chefia'),
  'recusado, o login continua com a chefia');
rollback to savepoint emergencia_trava;

savepoint emergencia_recria;
-- A conta institucional foi apagada: vincular_usuario a recria.
delete from public.militares where id = :'m_admin';
select privado.vincular_usuario('aqs.institucional@teste.local');
select testes.afirmar(
  (select count(*) = 1 and bool_and(usuario_id = :'u_admin' and ativo and nome_guerra = 'AQS — conta institucional')
     from public.militares where papel = 'administrador'),
  'vincular_usuario recria a conta institucional que sumiu');
rollback to savepoint emergencia_recria;

select
  max(id::text) filter (where ordem = 1) as a1,
  max(id::text) filter (where ordem = 2) as a2,
  max(id::text) filter (where ordem = 5) as a5,
  max(id::text) filter (where ordem = 9) as a9,
  max(id::text) filter (where ordem = 14) as a14
from public.atividades \gset

-- A diária de hoje existe se hoje for dia útil; em fim de semana/feriado o
-- teste cria uma igual, para não depender do dia em que roda.
insert into public.ocorrencias (atividade_id, referencia, prazo)
values (:'a1', 'D' || to_char(public.hoje_belem(), 'YYYY-MM-DD'), public.hoje_belem())
on conflict (atividade_id, referencia) do nothing;
select id as oc_leticia from public.ocorrencias where atividade_id = :'a1' and referencia = 'D' || to_char(public.hoje_belem(), 'YYYY-MM-DD') \gset
select id as oc_wallace from public.ocorrencias where atividade_id = :'a5' order by prazo limit 1 \gset

-- Um arquivo no Storage para provar que anon/sem cadastro não o enxergam.
insert into storage.objects (bucket_id, name, owner_id)
values ('evidencias', :'a1' || '/geral/fixo-relatorio.pdf', :'u_leticia');

select count(*) as total_ocorrencias from public.ocorrencias \gset

-- =========================================================================
\echo '-- anon (sem login) não acessa nada'
-- =========================================================================
select testes.como_anon();
select testes.espera_erro(format('select 1 from public.%I limit 1', t), '42501', 'anon não lê ' || t)
  from unnest(array['setores', 'militares', 'atividades', 'atividade_responsaveis', 'ocorrencias',
                    'evidencias', 'comentarios', 'avisos', 'avisos_destinatarios', 'avisos_ciencia',
                    'notificacoes', 'feriados', 'configuracoes', 'auditoria', 'v_ocorrencias']) as t;
select testes.espera_erro('insert into public.comentarios (atividade_id, texto) values (gen_random_uuid(), ''x'')',
  '42501', 'anon não grava');
select testes.espera_erro('select public.meu_perfil()', '42501', 'anon não chama meu_perfil');
select testes.espera_erro('select public.gerar_ocorrencias()', '42501', 'anon não chama gerar_ocorrencias');
select testes.espera_erro($$select public.salvar_atividade('{}'::jsonb)$$, '42501', 'anon não chama salvar_atividade');
select testes.espera_erro('select public.transferir_chefia(null, null)', '42501', 'anon não chama transferir_chefia');
select testes.espera_erro('select public.hoje_belem()', '42501', 'anon não chama hoje_belem');
select testes.espera_erro('select privado.eh_ativo()', '42501', 'anon não usa o schema privado');
select testes.afirmar(testes.contar('select 1 from storage.objects') = 0, 'anon não lista arquivos do Storage');
select testes.espera_erro(format($$insert into storage.objects (bucket_id, name) values ('evidencias', %L)$$,
  :'a1' || '/geral/anon.pdf'), '42501', 'anon não envia arquivo');

-- =========================================================================
\echo '-- usuário do Auth sem militar vinculado não lê nada'
-- =========================================================================
select testes.como(:'u_sem');
select testes.afirmar(testes.contar(format('select 1 from public.%I', t)) = 0, 'sem cadastro não lê ' || t)
  from unnest(array['setores', 'militares', 'atividades', 'atividade_responsaveis', 'ocorrencias',
                    'evidencias', 'comentarios', 'avisos', 'avisos_destinatarios', 'avisos_ciencia',
                    'notificacoes', 'feriados', 'configuracoes', 'auditoria', 'v_ocorrencias']) as t;
select testes.afirmar(testes.contar('select 1 from storage.objects') = 0, 'sem cadastro não lista o Storage');
select testes.espera_erro('select public.meu_perfil()', '42501', 'meu_perfil sem cadastro', 'sem_cadastro');
select testes.espera_erro('select public.gerar_ocorrencias()', '42501', 'gerar_ocorrencias sem cadastro');
select testes.espera_erro($$select public.salvar_atividade('{"titulo":"Teste","tipo":"pontual"}'::jsonb)$$,
  '42501', 'salvar_atividade sem cadastro');
select testes.espera_erro('select public.confirmar_troca_senha()', '42501', 'confirmar_troca_senha sem cadastro');

-- =========================================================================
\echo '-- adjunto: leitura'
-- =========================================================================
select testes.como(:'u_leticia');
select testes.afirmar(testes.contar('select 1 from public.atividades') = 16, 'adjunto lê as atividades de todos');
select testes.afirmar(testes.contar('select 1 from public.militares') = 5, 'adjunto lê a equipe');
select testes.afirmar(testes.contar('select 1 from public.ocorrencias') = :total_ocorrencias,
  'adjunto lê todas as ocorrências');
select testes.afirmar(testes.contar('select 1 from public.v_ocorrencias') = :total_ocorrencias,
  'adjunto lê a view v_ocorrencias inteira');
select testes.afirmar(
  (select responsaveis = array[:'m_leticia'::uuid] and atividade_tipo = 'recorrente'
          and data_ref = public.hoje_belem() and not atrasada and qtd_evidencias = 0
     from public.v_ocorrencias where id = :'oc_leticia'),
  'v_ocorrencias traz responsáveis, tipo, data_ref e contadores');
select testes.afirmar(testes.contar('select 1 from public.auditoria') = 0, 'adjunto não lê a auditoria');
select testes.afirmar(testes.contar('select 1 from storage.objects') = 1, 'adjunto lista os arquivos de evidência');

-- =========================================================================
\echo '-- meu_perfil e troca de senha'
-- =========================================================================
select testes.afirmar((public.meu_perfil()).id = :'m_leticia', 'meu_perfil devolve o próprio cadastro');
select testes.como_dono();
select testes.afirmar((select ultimo_acesso is not null from public.militares where id = :'m_leticia'),
  'meu_perfil registra ultimo_acesso');
select testes.afirmar(
  not exists (select 1 from public.auditoria where tabela = 'militares' and registro_id = :'m_leticia'
                and operacao = 'UPDATE' and (depois ->> 'ultimo_acesso') is not null
                and (antes ->> 'ultimo_acesso') is null),
  'o registro de último acesso não enche a auditoria');
select testes.como(:'u_leticia');
select public.confirmar_troca_senha();
select testes.afirmar((public.meu_perfil()).deve_trocar_senha = false, 'confirmar_troca_senha desliga a troca obrigatória');

-- =========================================================================
\echo '-- adjunto: ocorrências'
-- =========================================================================
select testes.afirmar(testes.linhas(format(
  $$update public.ocorrencias set observacao = 'intrometida' where id = %L$$, :'oc_wallace')) = 0,
  'adjunto não atualiza ocorrência de atividade alheia');
select testes.afirmar(testes.linhas(format(
  $$update public.ocorrencias set status = 'em_andamento', observacao = 'começando' where id = %L$$, :'oc_leticia')) = 1,
  'adjunto atualiza a própria ocorrência');
select testes.afirmar((select iniciada_em is not null from public.ocorrencias where id = :'oc_leticia'),
  'iniciada_em é carimbada ao ir para em_andamento');
select testes.espera_erro(format('update public.ocorrencias set prazo = prazo + 1 where id = %L', :'oc_leticia'),
  '42501', 'adjunto não muda o prazo da ocorrência', 'Apenas a chefia');
select testes.espera_erro(format($$update public.ocorrencias set referencia = 'X1' where id = %L$$, :'oc_leticia'),
  '42501', 'adjunto não muda a referência da ocorrência');
select testes.espera_erro(format('update public.ocorrencias set atividade_id = %L where id = %L', :'a2', :'oc_leticia'),
  '42501', 'adjunto não move a ocorrência para outra atividade');
select testes.afirmar(testes.linhas(format(
  $$update public.ocorrencias set concluida_em = '2020-01-01', concluida_por = %L, criado_por = %L,
           criado_em = '2020-01-01', iniciada_em = '2020-01-01' where id = %L$$,
  :'m_wallace', :'m_wallace', :'oc_leticia')) = 1, 'atualização com carimbos forjados é aceita…');
select testes.afirmar(
  (select concluida_em is null and concluida_por is null and criado_por is null
          and criado_em > '2025-01-01' and iniciada_em > '2025-01-01'
     from public.ocorrencias where id = :'oc_leticia'),
  '…mas os carimbos e a autoria forjados são ignorados');
select testes.espera_erro(format($$update public.ocorrencias set status = 'nao_se_aplica' where id = %L$$, :'oc_leticia'),
  '23514', 'não se aplica exige justificativa', 'justificativa');
select testes.espera_erro(format($$update public.ocorrencias set status = 'nao_se_aplica', justificativa = '   ' where id = %L$$, :'oc_leticia'),
  '23514', 'justificativa em branco não vale');
select testes.afirmar(testes.linhas(format(
  $$update public.ocorrencias set status = 'nao_se_aplica', justificativa = 'Sistema fora do ar' where id = %L$$, :'oc_leticia')) = 1,
  'não se aplica com justificativa é aceito');
select testes.afirmar(testes.linhas(format(
  $$update public.ocorrencias set status = 'concluida' where id = %L$$, :'oc_leticia')) = 1, 'adjunto conclui a própria ocorrência');
select testes.afirmar(
  (select concluida_em is not null and concluida_por = :'m_leticia' and concluida_por_nome = 'Ten Letícia'
     from public.ocorrencias where id = :'oc_leticia'),
  'concluir carimba concluida_em, concluida_por e o nome');
select testes.afirmar(
  (select concluida_no_prazo from public.v_ocorrencias where id = :'oc_leticia'),
  'v_ocorrencias marca concluida_no_prazo');
select testes.afirmar(testes.linhas(format(
  $$update public.ocorrencias set status = 'pendente' where id = %L$$, :'oc_leticia')) = 1, 'adjunto reabre a ocorrência');
select testes.afirmar(
  (select concluida_em is null and concluida_por is null and concluida_por_nome is null and iniciada_em is null
     from public.ocorrencias where id = :'oc_leticia'),
  'reabrir limpa os carimbos de conclusão e de início');
select testes.afirmar(testes.linhas(format('delete from public.ocorrencias where id = %L', :'oc_leticia')) = 0,
  'adjunto não exclui ocorrência');
-- Registrar execução (sob demanda): só na atividade sob demanda da qual é responsável.
select testes.afirmar(testes.linhas(format(
  $$insert into public.ocorrencias (atividade_id, referencia, titulo_execucao, status, criado_por)
    values (%L, 'R-forjada', 'Notificação 2026/041', 'concluida', %L)$$, :'a2', :'m_wallace')) = 1,
  'adjunto registra execução de atividade sob demanda sua');
select testes.afirmar(
  (select referencia is null and criado_por = :'m_leticia' and concluida_por = :'m_leticia'
          and concluida_por_nome = 'Ten Letícia'
     from public.ocorrencias where titulo_execucao = 'Notificação 2026/041'),
  'execução registrada: sem referência, autoria e conclusão do próprio adjunto');
-- Execução feita há 5 dias e registrada hoje: é registro de algo já feito,
-- conta como "no prazo" (não penaliza quem registra depois).
select testes.afirmar(testes.linhas(format(
  $$insert into public.ocorrencias (atividade_id, titulo_execucao, prazo, status)
    values (%L, 'Notificação 2026/039', public.hoje_belem() - 5, 'concluida')$$, :'a2')) = 1,
  'adjunto registra execução já feita, com a data em que ocorreu');
select testes.afirmar(
  (select concluida_no_prazo and not atrasada from public.v_ocorrencias where titulo_execucao = 'Notificação 2026/039'),
  'execução registrada já concluída conta como no prazo, mesmo com data passada');
select testes.espera_erro(format(
  $$insert into public.ocorrencias (atividade_id, referencia, prazo) values (%L, 'X-1', public.hoje_belem())$$, :'a1'),
  '42501', 'adjunto não cria ocorrência de atividade recorrente');
select testes.como(:'u_wallace');
select testes.espera_erro(format(
  $$insert into public.ocorrencias (atividade_id, titulo_execucao) values (%L, 'intromissão')$$, :'a2'),
  '42501', 'adjunto não registra execução em atividade sob demanda alheia');
select testes.como(:'u_chefia');
select testes.afirmar(testes.linhas(format(
  'update public.ocorrencias set prazo = prazo + 1 where id = %L', :'oc_wallace')) = 1, 'chefia muda o prazo');
select testes.afirmar(testes.linhas(format(
  $$update public.ocorrencias set prazo = prazo - 1, observacao = 'ajuste da chefia' where id = %L$$, :'oc_wallace')) = 1,
  'chefia atualiza ocorrência de qualquer atividade');

-- =========================================================================
\echo '-- avisos e ciência'
-- =========================================================================
insert into public.avisos (titulo, mensagem, para_todos) values ('Aviso geral', 'Reunião às 10h', true)
  returning id as av_todos \gset
insert into public.avisos (titulo, para_todos, criado_por) values ('Para a Letícia', false, :'m_wallace')
  returning id as av_leticia \gset
insert into public.avisos_destinatarios (aviso_id, militar_id) values (:'av_leticia', :'m_leticia');
insert into public.avisos (titulo, para_todos) values ('Para o Wallace', false) returning id as av_wallace \gset
insert into public.avisos_destinatarios (aviso_id, militar_id) values (:'av_wallace', :'m_wallace');
select testes.afirmar(
  (select criado_por = :'m_chefia' and criado_por_nome = 'Chefia AQS/NSP' from public.avisos where id = :'av_leticia'),
  'aviso grava o autor real (não o enviado) e o nome-instantâneo');
select testes.como(:'u_leticia');
select testes.espera_erro($$insert into public.avisos (titulo) values ('Aviso do adjunto')$$, '42501', 'adjunto não cria aviso');
select testes.afirmar(testes.contar(format('select 1 from public.avisos where id in (%L, %L, %L)',
  :'av_todos', :'av_leticia', :'av_wallace')) = 2, 'adjunto vê o aviso para todos e o dirigido a ele');
select testes.afirmar(testes.contar(format('select 1 from public.avisos where id = %L', :'av_wallace')) = 0,
  'adjunto não vê aviso dirigido a outro');
select testes.afirmar(testes.linhas(format($$update public.avisos set titulo = 'mudei' where id = %L$$, :'av_todos')) = 0,
  'adjunto não altera aviso');
select testes.afirmar(testes.linhas(format('delete from public.avisos where id = %L', :'av_todos')) = 0,
  'adjunto não exclui aviso');
select testes.espera_erro(format('insert into public.avisos_destinatarios values (%L, %L)', :'av_wallace', :'m_leticia'),
  '42501', 'adjunto não se inclui como destinatário');
insert into public.avisos_ciencia (aviso_id, militar_id, ciente_em) values (:'av_todos', :'m_leticia', '2020-01-01');
insert into public.avisos_ciencia (aviso_id, militar_id) values (:'av_leticia', :'m_leticia');
select testes.afirmar((select ciente_em > '2025-01-01' from public.avisos_ciencia
                        where aviso_id = :'av_todos' and militar_id = :'m_leticia'), 'ciente_em é a hora real');
select testes.espera_erro(format('insert into public.avisos_ciencia (aviso_id, militar_id) values (%L, %L)',
  :'av_todos', :'m_wallace'), '42501', 'ciência só da própria pessoa');
select testes.espera_erro(format('insert into public.avisos_ciencia (aviso_id, militar_id) values (%L, %L)',
  :'av_wallace', :'m_leticia'), '42501', 'ciência só de aviso visível');
select testes.como(:'u_wallace');
insert into public.avisos_ciencia (aviso_id, militar_id) values (:'av_todos', :'m_wallace');
select testes.afirmar(testes.contar('select 1 from public.avisos_ciencia') = 1, 'adjunto só lê a própria ciência');
select testes.como(:'u_chefia');
select testes.afirmar(testes.contar('select 1 from public.avisos_ciencia') = 3, 'chefia lê todas as ciências');
select testes.afirmar(testes.contar(format('select 1 from public.avisos where id in (%L, %L, %L)',
  :'av_todos', :'av_leticia', :'av_wallace')) = 3, 'chefia vê todos os avisos');
select testes.como_dono();
select testes.afirmar(
  (select count(*) = 4 and bool_and(titulo = 'Novo aviso: Aviso geral' and mensagem = 'Reunião às 10h')
          and count(*) filter (where destinatario_id = :'m_chefia') = 0
          and count(*) filter (where destinatario_id = :'m_admin') = 1
     from public.notificacoes where aviso_id = :'av_todos'),
  'aviso para todos notifica todos os ativos (inclusive a conta institucional), menos o autor');
select testes.afirmar(
  (select array_agg(destinatario_id) = array[:'m_leticia'::uuid] from public.notificacoes where aviso_id = :'av_leticia'),
  'aviso dirigido notifica só o destinatário');
select testes.afirmar(
  (select array_agg(destinatario_id) = array[:'m_wallace'::uuid] from public.notificacoes where aviso_id = :'av_wallace'),
  'cada aviso dirigido notifica o seu destinatário');

-- =========================================================================
\echo '-- auditoria'
-- =========================================================================
select testes.como(:'u_leticia');
select testes.afirmar(testes.contar('select 1 from public.auditoria') = 0, 'adjunto não lê auditoria');
select testes.como(:'u_chefia');
select testes.afirmar(testes.contar('select 1 from public.auditoria') > 0, 'chefia lê auditoria');
select testes.afirmar(
  (select militar_id = :'m_chefia' and militar_nome = 'Chefia AQS/NSP' and usuario_id = :'u_chefia'
          and operacao = 'INSERT' and depois ->> 'titulo' = 'Aviso geral'
     from public.auditoria where tabela = 'avisos' and registro_id = :'av_todos'),
  'auditoria registra quem, o quê e o conteúdo');
select testes.afirmar(
  exists (select 1 from public.auditoria where tabela = 'ocorrencias' and operacao = 'UPDATE'
            and registro_id = :'oc_leticia' and militar_nome = 'Ten Letícia'),
  'auditoria registra a atualização da ocorrência pelo adjunto');
select testes.espera_erro('delete from public.auditoria', '42501', 'nem a chefia apaga a auditoria');
select testes.espera_erro($$update public.auditoria set tabela = 'x'$$, '42501', 'nem a chefia altera a auditoria');
select testes.espera_erro($$insert into public.auditoria (tabela, operacao) values ('x', 'INSERT')$$,
  '42501', 'ninguém grava auditoria pela API');
-- A Edge Function admin-usuarios (service role) grava as ações de acesso
-- como 'ADMIN:<ação>'; outros textos continuam recusados.
select testes.como_dono();
select testes.afirmar(testes.linhas(format(
  $$insert into public.auditoria (militar_id, tabela, operacao, registro_id, depois)
    values (%L, 'auth.users', 'ADMIN:criar', %L, '{"acao": "ADMIN:criar"}')$$, :'m_chefia', :'m_wallace')) = 1,
  'auditoria aceita a operação ADMIN:<ação> da Edge Function');
select testes.espera_erro($$insert into public.auditoria (tabela, operacao) values ('x', 'DROP')$$,
  '23514', 'auditoria recusa operação fora do padrão');
select testes.espera_erro($$insert into public.auditoria (tabela, operacao) values ('x', 'ADMIN:Criar Acesso')$$,
  '23514', 'ADMIN: só com o nome da ação em minúsculas');

-- =========================================================================
\echo '-- adjunto não altera militares'
-- =========================================================================
select testes.como(:'u_leticia');
select testes.afirmar(testes.linhas(format($$update public.militares set papel = 'chefia' where id = %L$$, :'m_leticia')) = 0,
  'adjunto não muda o próprio papel');
select testes.afirmar(testes.linhas(format($$update public.militares set nome_guerra = 'X' where id = %L$$, :'m_wallace')) = 0,
  'adjunto não altera outro militar');
select testes.espera_erro($$insert into public.militares (nome_guerra) values ('Intruso')$$, '42501', 'adjunto não cria militar');
select testes.afirmar(testes.linhas(format('delete from public.militares where id = %L', :'m_wallace')) = 0,
  'adjunto não exclui militar');

-- =========================================================================
\echo '-- configurações, setores e feriados'
-- =========================================================================
select testes.afirmar(testes.contar('select 1 from public.configuracoes') >= 1, 'ativo lê configurações');
select testes.afirmar(testes.linhas($$update public.configuracoes set valor = '{}' where chave = 'contatos'$$) = 0,
  'adjunto não altera configurações');
select testes.espera_erro($$insert into public.configuracoes (chave, valor) values ('teste', '{}')$$, '42501',
  'adjunto não cria configuração');
select testes.espera_erro($$insert into public.setores (sigla, nome) values ('XYZ', 'Setor X')$$, '42501',
  'adjunto não cria setor');
select testes.espera_erro($$insert into public.feriados (data, descricao) values ('2027-06-03', 'Corpus Christi')$$,
  '42501', 'adjunto não cria feriado');
select testes.como(:'u_chefia');
select testes.afirmar(testes.linhas($$update public.configuracoes set valor = jsonb_set(valor, '{telefone}', '"(91) 3204-0000"')
  where chave = 'contatos'$$) = 1, 'chefia altera configurações');
insert into public.configuracoes (chave, valor) values ('ultimo_backup', '{"em":"2026-10-15T12:00:00Z","por_nome":"Chefia"}')
  on conflict (chave) do update set valor = excluded.valor;
select testes.afirmar(
  (select count(*) = 2 and bool_and(atualizado_por = :'m_chefia') from public.configuracoes
    where chave in ('contatos', 'ultimo_backup')),
  'configurações gravam quem alterou (upsert do gestor funciona)');
insert into public.setores (sigla, nome) values (' tst ', 'Setor de teste');
select testes.afirmar(exists (select 1 from public.setores where sigla = 'TST'), 'chefia cria setor (sigla normalizada)');
select testes.espera_erro($$delete from public.setores where sigla = 'NSP'$$, 'P0001',
  'setor em uso não é excluído', 'Mude-os de setor');
select testes.afirmar(testes.linhas($$delete from public.setores where sigla = 'TST'$$) = 1, 'chefia exclui setor sem uso');
insert into public.feriados (data, descricao) values ('2027-05-27', 'Corpus Christi');
select testes.afirmar(testes.linhas($$delete from public.feriados where data = '2027-05-27'$$) = 1, 'chefia gerencia feriados');

-- =========================================================================
\echo '-- comentários e notificações de comentário'
-- =========================================================================
select testes.como(:'u_wallace');
insert into public.comentarios (atividade_id, ocorrencia_id, autor_id, texto, autor_nome, autor_papel)
values (:'a1', :'oc_leticia', :'m_wallace', 'Comentário do Wallace', 'Forjado', 'chefia')
returning id as com_wallace \gset
select testes.afirmar(
  (select autor_nome = 'Ten Wallace' and autor_papel = 'adjunto' from public.comentarios where id = :'com_wallace'),
  'comentário de qualquer ativo; nome e papel do autor vêm do cadastro');
select testes.espera_erro(format($$insert into public.comentarios (atividade_id, autor_id, texto) values (%L, %L, 'em nome de outro')$$,
  :'a1', :'m_leticia'), '42501', 'ninguém comenta em nome de outro');
select testes.espera_erro(format($$insert into public.comentarios (atividade_id, ocorrencia_id, autor_id, texto) values (%L, %L, %L, 'x')$$,
  :'a1', :'oc_wallace', :'m_wallace'), '22023', 'ocorrência precisa ser da atividade do comentário');
select testes.como_dono();
select testes.afirmar(
  (select array_agg(destinatario_id order by destinatario_id) = (select array_agg(x order by x) from unnest(array[:'m_leticia'::uuid, :'m_chefia'::uuid]) x)
          and bool_and(titulo = 'Novo comentário' and tipo = 'comentario' and ocorrencia_id = :'oc_leticia')
     from public.notificacoes where tipo = 'comentario' and atividade_id = :'a1'),
  'comentário notifica responsáveis e chefia, não o autor nem a conta institucional');
select testes.como(:'u_chefia');
insert into public.comentarios (atividade_id, autor_id, texto) values (:'a5', :'m_chefia', 'Comentário da chefia')
returning id as com_chefia \gset
select testes.como_dono();
select testes.afirmar(
  (select array_agg(destinatario_id) = array[:'m_wallace'::uuid] and bool_and(titulo = 'Novo comentário da chefia')
     from public.notificacoes where tipo = 'comentario' and atividade_id = :'a5'),
  'comentário da chefia notifica o responsável com o título próprio');
select testes.como(:'u_leticia');
insert into public.comentarios (atividade_id, autor_id, texto) values (:'a1', :'m_leticia', 'Comentário da Letícia')
returning id as com_leticia \gset
select testes.afirmar(testes.linhas(format('delete from public.comentarios where id = %L', :'com_wallace')) = 0,
  'adjunto não exclui comentário alheio');
select testes.espera_erro(format($$update public.comentarios set texto = 'editado' where id = %L$$, :'com_leticia'),
  '42501', 'comentário não tem edição');
select testes.como(:'u_wallace');
select testes.afirmar(testes.linhas(format('delete from public.comentarios where id = %L', :'com_wallace')) = 1,
  'autor exclui o próprio comentário');
select testes.como(:'u_chefia');
select testes.afirmar(testes.linhas(format('delete from public.comentarios where id = %L', :'com_chefia')) = 1,
  'chefia exclui comentário');

-- =========================================================================
\echo '-- evidências e Storage'
-- =========================================================================
select testes.como(:'u_leticia');
insert into public.evidencias (atividade_id, ocorrencia_id, storage_path, nome, mime, tamanho, enviado_por, enviado_por_nome)
values (:'a1', :'oc_leticia', :'a1' || '/' || :'oc_leticia' || '/x1-relatorio.pdf', 'relatorio.pdf', 'application/pdf', 1024,
        :'m_leticia', 'Forjado')
returning id as ev_leticia \gset
select testes.afirmar((select enviado_por_nome = 'Ten Letícia' from public.evidencias where id = :'ev_leticia'),
  'responsável envia evidência; nome-instantâneo do cadastro');
select testes.afirmar((select qtd_evidencias = 1 from public.v_ocorrencias where id = :'oc_leticia'),
  'v_ocorrencias conta as evidências');
select testes.espera_erro(format($$insert into public.evidencias (atividade_id, storage_path, nome, enviado_por)
  values (%L, %L, 'x.pdf', %L)$$, :'a1', :'a1' || '/geral/x2.pdf', :'m_wallace'), '42501', 'enviado_por precisa ser o próprio');
select testes.espera_erro(format($$insert into public.evidencias (atividade_id, storage_path, nome, enviado_por)
  values (%L, %L, 'x.pdf', %L)$$, :'a5', :'a5' || '/geral/x3.pdf', :'m_leticia'), '42501', 'não-responsável não envia evidência');
select testes.espera_erro(format($$insert into public.evidencias (atividade_id, storage_path, nome, enviado_por)
  values (%L, %L, 'x.pdf', %L)$$, :'a1', :'a5' || '/geral/x4.pdf', :'m_leticia'), '22023',
  'caminho do arquivo precisa começar pela atividade');
insert into storage.objects (bucket_id, name, owner_id) values ('evidencias', :'a1' || '/geral/x5-ata.pdf', :'u_leticia');
select testes.espera_erro(format($$insert into storage.objects (bucket_id, name, owner_id) values ('evidencias', %L, %L)$$,
  :'a5' || '/geral/x6.pdf', :'u_leticia'), '42501', 'Storage: não envia para pasta de atividade alheia');
select testes.espera_erro(format($$insert into storage.objects (bucket_id, name, owner_id) values ('evidencias', %L, %L)$$,
  'lixo/x7.pdf', :'u_leticia'), '42501', 'Storage: 1ª pasta precisa ser uma atividade');
select testes.espera_erro(format($$insert into storage.objects (bucket_id, name, owner_id) values ('evidencias', %L, %L)$$,
  'x8.pdf', :'u_leticia'), '42501', 'Storage: arquivo fora de pasta é recusado');
select testes.espera_erro(format($$insert into storage.objects (bucket_id, name, owner_id) values ('evidencias', %L, %L)$$,
  gen_random_uuid()::text || '/geral/x9.pdf', :'u_leticia'), '42501', 'Storage: atividade inexistente é recusada');
select testes.afirmar(testes.linhas(format($$update storage.objects set name = name || '.bak' where owner_id = %L$$, :'u_leticia')) = 0,
  'Storage: ninguém substitui arquivo (sem UPDATE)');
select testes.como(:'u_wallace');
select testes.afirmar(testes.contar($$select 1 from storage.objects where bucket_id = 'evidencias'$$) = 2,
  'Storage: todo ativo lê as evidências');
select testes.afirmar(testes.linhas(format($$delete from storage.objects where name = %L$$, :'a1' || '/geral/x5-ata.pdf')) = 0,
  'Storage: quem não enviou não exclui');
select testes.afirmar(testes.linhas(format('delete from public.evidencias where id = %L', :'ev_leticia')) = 0,
  'quem não enviou não exclui a evidência');
select testes.como(:'u_leticia');
select testes.afirmar(testes.linhas(format($$delete from storage.objects where name = %L$$, :'a1' || '/geral/x5-ata.pdf')) = 1,
  'Storage: dono exclui o próprio arquivo');
select testes.como(:'u_chefia');
insert into storage.objects (bucket_id, name, owner_id) values ('evidencias', :'a5' || '/geral/x10.pdf', :'u_chefia');
select testes.afirmar(testes.linhas(format($$delete from storage.objects where name = %L$$, :'a1' || '/geral/fixo-relatorio.pdf')) = 1,
  'Storage: chefia exclui qualquer arquivo');

-- =========================================================================
\echo '-- salvar_atividade'
-- =========================================================================
select testes.como(:'u_leticia');
select public.salvar_atividade(jsonb_build_object(
  'titulo', 'Revisar POP de quedas', 'tipo', 'pontual', 'prazo', '2026-10-30',
  'responsaveis', jsonb_build_array(:'m_leticia'))) as at_pontual \gset
select testes.afirmar(
  (select criado_por = :'m_leticia' and ordem = 17 and setor_id is null and ativa and antecipar_dia_util
     from public.atividades where id = :'at_pontual'),
  'adjunto cria pontual sendo responsável (ordem = máx + 1)');
select testes.afirmar(
  (select count(*) = 1 and min(referencia) = 'P' and min(prazo) = '2026-10-30' and min(criado_por::text) = :'m_leticia'
     from public.ocorrencias where atividade_id = :'at_pontual'),
  'pontual nasce com a ocorrência única P no prazo');
select public.salvar_atividade(jsonb_build_object(
  'titulo', 'Treinamento extra', 'tipo', 'sob_demanda', 'responsaveis', jsonb_build_array(:'m_leticia', :'m_balieiro')))
  as at_demanda \gset
select testes.afirmar(testes.contar(format('select 1 from public.ocorrencias where atividade_id = %L', :'at_demanda')) = 0,
  'adjunto cria sob demanda (sem ocorrência automática)');
select testes.espera_erro(format($$select public.salvar_atividade(%L::jsonb)$$, jsonb_build_object(
  'titulo', 'Sem mim', 'tipo', 'pontual', 'responsaveis', jsonb_build_array(:'m_wallace'))), '42501',
  'adjunto precisa se incluir como responsável', 'Inclua você mesmo');
select testes.espera_erro(format($$select public.salvar_atividade(%L::jsonb)$$, jsonb_build_object(
  'titulo', 'Recorrente do adjunto', 'tipo', 'recorrente', 'periodicidade', 'semanal', 'dia_semana', 3,
  'responsaveis', jsonb_build_array(:'m_leticia'))), '42501', 'adjunto não cria recorrente',
  'Apenas a chefia pode criar atividades recorrentes.');
select testes.espera_erro(format($$select public.salvar_atividade(%L::jsonb)$$, jsonb_build_object(
  'id', :'a5', 'titulo', 'Tomando a do Wallace')), '42501', 'adjunto não edita atividade alheia');
select testes.espera_erro(format($$select public.salvar_atividade(%L::jsonb)$$, jsonb_build_object(
  'id', :'at_pontual', 'responsaveis', jsonb_build_array(:'m_leticia', :'m_wallace'))), '42501',
  'adjunto não altera responsáveis', 'responsáveis');
select testes.espera_erro(format($$select public.salvar_atividade(%L::jsonb)$$, jsonb_build_object(
  'id', :'at_pontual', 'tipo', 'recorrente', 'periodicidade', 'mensal', 'dia_mes', 10)), '42501',
  'adjunto não transforma atividade em recorrente');
select public.salvar_atividade(jsonb_build_object(
  'id', :'at_pontual', 'descricao', 'Com a equipe de enfermagem', 'prazo', '2026-11-05',
  'responsaveis', jsonb_build_array(:'m_leticia')));
select testes.afirmar(
  (select a.descricao = 'Com a equipe de enfermagem' and a.titulo = 'Revisar POP de quedas' and o.prazo = '2026-11-05'
     from public.atividades a join public.ocorrencias o on o.atividade_id = a.id and o.referencia = 'P'
    where a.id = :'at_pontual'),
  'adjunto edita a própria atividade (mesmos responsáveis) e o prazo da P acompanha');
select testes.espera_erro($$select public.salvar_atividade('{"titulo":"ab","tipo":"pontual","responsaveis":[]}'::jsonb)$$,
  '22023', 'título curto é recusado', 'título');
select testes.espera_erro($$select public.salvar_atividade('{"titulo":"Abc","tipo":"pontual","prazo":"30/10/2026"}'::jsonb)$$,
  '22023', 'data em formato errado é recusada', 'AAAA-MM-DD');
select testes.espera_erro($$select public.salvar_atividade('{"id":"nao-e-uuid","titulo":"Abc"}'::jsonb)$$,
  '22023', 'id inválido é recusado');
select testes.espera_erro(format($$select public.salvar_atividade(%L::jsonb)$$, jsonb_build_object(
  'titulo', 'Sem responsáveis', 'tipo', 'pontual', 'responsaveis', '[]'::jsonb)), '22023', 'exige ao menos 1 responsável');

select testes.como(:'u_chefia');
select public.salvar_atividade(jsonb_build_object(
  'titulo', 'Auditoria de prontuário', 'tipo', 'recorrente', 'periodicidade', 'semanal', 'dia_semana', 3,
  'prioridade', 'alta', 'setor_id', (select id from public.setores where sigla = 'NSP'),
  'responsaveis', jsonb_build_array(:'m_wallace'))) as at_chefia \gset
select testes.afirmar(testes.contar(format('select 1 from public.ocorrencias where atividade_id = %L', :'at_chefia')) >= 3,
  'chefia cria recorrente e as ocorrências são geradas');
select testes.como_dono();
select testes.afirmar(
  (select count(*) = 1 and bool_and(titulo = 'Nova missão atribuída' and mensagem = 'Auditoria de prontuário')
     from public.notificacoes where tipo = 'atribuicao' and atividade_id = :'at_chefia' and destinatario_id = :'m_wallace'),
  'atribuição notifica o novo responsável');
select testes.como(:'u_chefia');
select public.salvar_atividade(jsonb_build_object(
  'id', :'at_chefia', 'responsaveis', jsonb_build_array(:'m_wallace', :'m_balieiro', :'m_chefia')));
select testes.afirmar(
  (select array_agg(militar_id order by militar_id) =
          (select array_agg(x order by x) from unnest(array[:'m_wallace'::uuid, :'m_balieiro'::uuid, :'m_chefia'::uuid]) x)
     from public.atividade_responsaveis where atividade_id = :'at_chefia'),
  'chefia altera os responsáveis');
select testes.como_dono();
select testes.afirmar(
  (select count(*) filter (where destinatario_id = :'m_balieiro') = 1
          and count(*) filter (where destinatario_id = :'m_chefia') = 0
          and count(*) filter (where destinatario_id = :'m_wallace') = 1
     from public.notificacoes where tipo = 'atribuicao' and atividade_id = :'at_chefia'),
  'só quem entrou é notificado; quem se incluiu não');
select testes.como(:'u_chefia');
select public.salvar_atividade(jsonb_build_object('id', :'a5', 'titulo', 'Realizar auditoria cirúrgica (protocolo OMS)'));
select testes.afirmar((select titulo = 'Realizar auditoria cirúrgica (protocolo OMS)' from public.atividades where id = :'a5'),
  'chefia edita qualquer atividade');
select testes.espera_erro(format($$select public.salvar_atividade(%L::jsonb)$$, jsonb_build_object(
  'titulo', 'Para a conta institucional', 'tipo', 'pontual', 'responsaveis', jsonb_build_array(:'m_admin'))), '22023',
  'a conta institucional não recebe missões', 'não recebe missões');
select testes.espera_erro(format($$select public.salvar_atividade(%L::jsonb)$$, jsonb_build_object(
  'titulo', 'Semanal sem dia', 'tipo', 'recorrente', 'periodicidade', 'semanal',
  'responsaveis', jsonb_build_array(:'m_wallace'))), '22023', 'semanal exige dia da semana', 'dia da semana');
select testes.espera_erro(format($$select public.salvar_atividade(%L::jsonb)$$, jsonb_build_object(
  'titulo', 'Recorrente sem regra', 'tipo', 'recorrente', 'responsaveis', jsonb_build_array(:'m_wallace'))), '22023',
  'recorrente exige periodicidade', 'periodicidade');
select testes.espera_erro(format($$select public.salvar_atividade(%L::jsonb)$$, jsonb_build_object(
  'titulo', 'Trimestral sem mês', 'tipo', 'recorrente', 'periodicidade', 'trimestral', 'dia_mes', 10,
  'responsaveis', jsonb_build_array(:'m_wallace'))), '22023', 'trimestral exige mês de início', 'mês de início');
select testes.espera_erro(format($$select public.salvar_atividade(%L::jsonb)$$, jsonb_build_object(
  'id', gen_random_uuid(), 'titulo', 'Fantasma')), 'P0002', 'atividade inexistente', 'não encontrada');

select testes.como(:'u_admin');
select public.salvar_atividade(jsonb_build_object(
  'titulo', 'Relatório da AQS', 'tipo', 'recorrente', 'periodicidade', 'mensal', 'dia_mes', 20,
  'responsaveis', jsonb_build_array(:'m_balieiro'))) as at_admin \gset
select public.salvar_atividade(jsonb_build_object('id', :'at_admin', 'exige_evidencia', true, 'prioridade', 'urgente'));
select testes.afirmar(
  (select exige_evidencia and prioridade = 'urgente' and criado_por = :'m_admin' from public.atividades where id = :'at_admin'),
  'administrador cria e edita atividades');

-- =========================================================================
\echo '-- atividades: escrita direta bloqueada'
-- =========================================================================
select testes.como(:'u_leticia');
select testes.afirmar(testes.linhas(format('delete from public.atividades where id = %L', :'a1')) = 0,
  'adjunto não exclui atividade');
select testes.espera_erro($$insert into public.atividades (titulo, tipo) values ('Direto', 'pontual')$$, '42501',
  'ninguém cria atividade fora da RPC');
select testes.espera_erro(format($$update public.atividades set titulo = 'Direto' where id = %L$$, :'a1'), '42501',
  'ninguém altera atividade fora da RPC');
select testes.espera_erro(format('insert into public.atividade_responsaveis values (%L, %L)', :'a5', :'m_leticia'), '42501',
  'ninguém se atribui fora da RPC');
select testes.espera_erro(format('delete from public.atividade_responsaveis where atividade_id = %L', :'a1'), '42501',
  'ninguém remove responsável fora da RPC');
select testes.como(:'u_chefia');
select testes.afirmar(testes.linhas(format('delete from public.atividades where id = %L', :'at_demanda')) = 1,
  'chefia exclui atividade');

-- =========================================================================
\echo '-- notificações: cada um só as suas'
-- =========================================================================
select testes.como_dono();
select count(*) as notif_wallace from public.notificacoes where destinatario_id = :'m_wallace' \gset
select testes.como(:'u_wallace');
select testes.afirmar(:notif_wallace > 0 and testes.contar('select 1 from public.notificacoes') = :notif_wallace,
  'cada um lê só as próprias notificações');
select testes.afirmar(testes.linhas('update public.notificacoes set lida = true') = :notif_wallace,
  'marca as próprias como lidas');
select testes.espera_erro($$update public.notificacoes set titulo = 'mudei'$$, '42501', 'notificação: só a coluna lida muda');
select testes.espera_erro(format($$insert into public.notificacoes (destinatario_id, tipo, titulo) values (%L, 'aviso', 'falsa')$$,
  :'m_leticia'), '42501', 'ninguém cria notificação pela API');
select testes.afirmar(testes.linhas(format('delete from public.notificacoes where destinatario_id = %L', :'m_leticia')) = 0,
  'ninguém apaga notificação alheia');
select testes.afirmar(testes.linhas('delete from public.notificacoes') = :notif_wallace, 'apaga as próprias notificações');

-- =========================================================================
\echo '-- gestão de usuários'
-- =========================================================================
select testes.como(:'u_chefia');
insert into public.militares (posto, nome_guerra, email, papel) values ('Sgt', 'Novato', 'NOVATO@teste.local', 'adjunto')
  returning id as m_novo \gset
select testes.afirmar(testes.linhas(format($$update public.militares set posto = '1S' where id = %L$$, :'m_novo')) = 1,
  'chefia altera adjunto');
select testes.afirmar(testes.linhas(format('delete from public.militares where id = %L', :'m_novo')) = 1,
  'chefia exclui adjunto');
insert into public.militares (posto, nome_guerra, papel) values ('Maj', 'Chefe Dois', 'chefia') returning id as m_chefe2 \gset
select testes.afirmar(testes.linhas(format($$update public.militares set posto = 'Ten Cel' where id = %L$$, :'m_chefe2')) = 1,
  'chefia altera outra chefia');
select testes.afirmar(testes.linhas(format('delete from public.militares where id = %L', :'m_chefe2')) = 1,
  'chefia exclui outra chefia');
select testes.espera_erro($$insert into public.militares (nome_guerra, papel) values ('Outro admin', 'administrador')$$,
  '42501', 'chefia não cria administrador');
select testes.afirmar(testes.linhas(format($$update public.militares set nome_completo = 'X' where id = %L$$, :'m_admin')) = 0,
  'chefia não altera a conta de administrador');
select testes.espera_erro(format($$update public.militares set papel = 'administrador' where id = %L$$, :'m_wallace'), '42501',
  'chefia não promove ninguém a administrador');
select testes.afirmar(testes.linhas(format('delete from public.militares where id = %L', :'m_admin')) = 0,
  'chefia não exclui a conta de administrador');
select testes.afirmar(testes.linhas(format('delete from public.militares where id = %L', :'m_chefia')) = 0,
  'ninguém exclui a si mesmo (chefia)');
select testes.espera_erro(format('update public.militares set ativo = false where id = %L', :'m_chefia'), '42501',
  'ninguém desativa o próprio acesso', 'próprio acesso');

select testes.como(:'u_admin');
select testes.afirmar(testes.linhas(format($$update public.militares set nome_completo = 'Chefe do NSP' where id = %L$$, :'m_chefia')) = 1,
  'administrador altera a chefia');
select testes.afirmar(testes.linhas(format('delete from public.militares where id = %L', :'m_admin')) = 0,
  'ninguém exclui a si mesmo (administrador)');
select testes.afirmar(testes.linhas(format($$update public.militares set posto = 'Cap' where id = %L$$, :'m_admin')) = 1,
  'administrador altera a própria conta');
savepoint exclui_chefia;
select testes.afirmar(testes.linhas(format('delete from public.militares where id = %L', :'m_chefia')) = 1,
  'administrador exclui a chefia');
rollback to savepoint exclui_chefia;

\echo '-- trava anti-bloqueio'
savepoint trava;
-- Sem usuário (como a Edge Function com service role): a trava vale igual.
select testes.como_dono();
update public.militares set usuario_id = null where id = :'m_admin';
select testes.espera_erro(format('update public.militares set ativo = false where id = %L', :'m_chefia'), 'P0001',
  'a última chefia com acesso não é desativada', 'ao menos uma conta de chefia ou administrador');
select testes.espera_erro(format($$update public.militares set papel = 'adjunto' where id = %L$$, :'m_chefia'), 'P0001',
  'a última chefia com acesso não é rebaixada');
select testes.espera_erro(format('update public.militares set usuario_id = null where id = %L', :'m_chefia'), 'P0001',
  'a última chefia não perde o acesso');
select testes.espera_erro(format('delete from public.militares where id = %L', :'m_chefia'), 'P0001',
  'a última chefia com acesso não é excluída');
select testes.espera_erro(format('delete from auth.users where id = %L', :'u_chefia'), 'P0001',
  'nem apagando o usuário do Auth some o último gestor');
insert into public.militares (posto, nome_guerra, papel, usuario_id) values ('Maj', 'Nova Chefia', 'chefia', :'u_chefia2');
select testes.afirmar(testes.linhas(format('update public.militares set ativo = false where id = %L', :'m_chefia')) = 1,
  'com outro gestor com acesso, a chefia antiga pode ser desativada');
rollback to savepoint trava;

savepoint trava_usuario;
select testes.como_dono();
update public.militares set usuario_id = null where id = :'m_chefia';
select testes.como(:'u_admin');
select testes.espera_erro(format($$update public.militares set papel = 'adjunto' where id = %L$$, :'m_admin'), 'P0001',
  'o último gestor não se rebaixa', 'ao menos uma conta');
select testes.afirmar(testes.linhas(format($$update public.militares set papel = 'administrador' where id = %L$$, :'m_admin')) = 1,
  'mudança que mantém o gestor passa pela trava');
rollback to savepoint trava_usuario;

savepoint trava_lote;
select testes.como_dono();
select testes.espera_erro($$update public.militares set ativo = false where papel in ('chefia', 'administrador')$$, 'P0001',
  'desativar todos os gestores de uma vez é recusado');
rollback to savepoint trava_lote;

-- =========================================================================
\echo '-- passagem de chefia'
-- =========================================================================
select testes.como(:'u_leticia');
select testes.espera_erro(format('select public.transferir_chefia(%L, %L)', :'m_chefia', :'m_leticia'), '42501',
  'adjunto não faz passagem de chefia');
savepoint passagem;
select testes.como(:'u_chefia');
select public.transferir_chefia(:'m_chefia', :'m_balieiro', 'adjunto', true);
select testes.como_dono();
select testes.afirmar((select papel = 'chefia' and ativo from public.militares where id = :'m_balieiro'),
  'quem assume vira chefia');
select testes.afirmar((select papel = 'adjunto' from public.militares where id = :'m_chefia'),
  'quem sai passa a adjunto');
select testes.afirmar(
  (select array_agg(militar_id) = array[:'m_balieiro'::uuid] from public.atividade_responsaveis where atividade_id = :'a14'),
  'as responsabilidades da chefia antiga passam para a nova');
select testes.afirmar(
  exists (select 1 from public.notificacoes where tipo = 'atribuicao' and atividade_id = :'a14' and destinatario_id = :'m_balieiro'),
  'a nova chefia é notificada das missões recebidas');
select testes.como(:'u_balieiro');
select testes.afirmar(testes.contar('select 1 from public.auditoria') > 0, 'a nova chefia já administra (lê auditoria)');
rollback to savepoint passagem;

savepoint passagem_erros;
select testes.como(:'u_chefia');
select testes.espera_erro(format('select public.transferir_chefia(%L, %L)', :'m_chefia', :'m_admin'), '22023',
  'a conta institucional não assume a chefia');
select testes.espera_erro(format('select public.transferir_chefia(%L, %L)', :'m_wallace', :'m_balieiro'), '22023',
  'origem precisa ser chefia');
select testes.espera_erro(format('select public.transferir_chefia(%L, %L)', :'m_chefia', :'m_chefia'), '22023',
  'origem e destino diferentes');
select testes.espera_erro(format('select public.transferir_chefia(%L, %L, %L)', :'m_chefia', :'m_wallace', 'administrador'), '22023',
  'papel anterior só adjunto ou chefia');
select testes.espera_erro(format('select public.transferir_chefia(null, %L)', gen_random_uuid()), 'P0002',
  'destino inexistente');
-- Sem nenhum outro gestor com acesso, passar a chefia a quem ainda não tem
-- login travaria o sistema: recusa e não muda nada.
select testes.como_dono();
update public.militares set usuario_id = null where id = :'m_admin';
insert into public.militares (posto, nome_guerra) values ('Cap', 'Sem Acesso') returning id as m_sem_acesso \gset
select testes.como(:'u_chefia');
select testes.espera_erro(format('select public.transferir_chefia(%L, %L)', :'m_chefia', :'m_sem_acesso'), 'P0001',
  'passagem respeita a trava anti-bloqueio');
select testes.afirmar((select papel = 'adjunto' from public.militares where id = :'m_sem_acesso'),
  'passagem recusada não muda nada');
select public.transferir_chefia(null, :'m_wallace', 'adjunto', true);
select testes.afirmar((select papel = 'chefia' from public.militares where id = :'m_wallace'),
  'passagem sem chefia de origem só promove');
rollback to savepoint passagem_erros;

-- =========================================================================
\echo '-- militar desativado perde todo acesso'
-- =========================================================================
savepoint desativado;
select testes.como(:'u_chefia');
select testes.afirmar(testes.linhas(format('update public.militares set ativo = false where id = %L', :'m_wallace')) = 1,
  'chefia desativa adjunto');
select testes.como(:'u_wallace');
select testes.afirmar(testes.contar(format('select 1 from public.%I', t)) = 0, 'desativado não lê ' || t)
  from unnest(array['setores', 'militares', 'atividades', 'atividade_responsaveis', 'ocorrencias',
                    'evidencias', 'comentarios', 'avisos', 'avisos_destinatarios', 'avisos_ciencia',
                    'notificacoes', 'feriados', 'configuracoes', 'auditoria', 'v_ocorrencias']) as t;
select testes.afirmar(testes.contar('select 1 from storage.objects') = 0, 'desativado não lê o Storage');
select testes.espera_erro('select public.meu_perfil()', '42501', 'desativado: meu_perfil falha', 'sem_cadastro');
select testes.espera_erro('select public.gerar_ocorrencias()', '42501', 'desativado não gera ocorrências');
select testes.espera_erro(format($$insert into public.comentarios (atividade_id, autor_id, texto) values (%L, %L, 'x')$$,
  :'a5', :'m_wallace'), '42501', 'desativado não comenta');
select testes.afirmar(testes.linhas(format($$update public.ocorrencias set observacao = 'x' where id = %L$$, :'oc_wallace')) = 0,
  'desativado não atualiza a própria ocorrência');
rollback to savepoint desativado;

-- =========================================================================
\echo '-- segundo fator exigido de quem o cadastrou'
-- =========================================================================
savepoint segundo_fator;
select testes.como_dono();
insert into auth.mfa_factors (id, user_id, factor_type, status)
values ('f0000000-0000-4000-8000-000000000001', :'u_chefia', 'totp', 'verified');
-- Só a senha (sessão aal1): a chefia com TOTP não é reconhecida.
select testes.como(:'u_chefia');
select testes.afirmar(testes.contar(format('select 1 from public.%I', t)) = 0, 'sem o código (aal1) não lê ' || t)
  from unnest(array['setores', 'militares', 'atividades', 'ocorrencias', 'avisos', 'auditoria',
                    'notificacoes', 'v_ocorrencias']) as t;
select testes.afirmar(testes.contar('select 1 from storage.objects') = 0, 'sem o código não lê o Storage');
select testes.espera_erro('select public.meu_perfil()', '42501', 'meu_perfil exige o segundo fator', 'segundo fator');
select testes.espera_erro('select public.confirmar_troca_senha()', '42501', 'troca de senha exige o segundo fator');
select testes.espera_erro(format($$select public.salvar_atividade(jsonb_build_object(
  'titulo', 'Sem o código', 'tipo', 'sob_demanda', 'responsaveis', jsonb_build_array(%L)))$$, :'m_wallace'),
  '42501', 'salvar_atividade exige o segundo fator');
select testes.espera_erro(format($$select public.transferir_chefia(%L, %L)$$, :'m_chefia', :'m_wallace'),
  '42501', 'passagem de chefia exige o segundo fator');
select testes.espera_erro($$insert into public.avisos (titulo) values ('Sem o código')$$,
  '42501', 'sem o código não publica aviso');
select testes.afirmar(testes.linhas(format('update public.militares set papel = %L where id = %L', 'chefia', :'m_wallace')) = 0,
  'sem o código não altera militares');
-- Com o código (aal2), tudo volta ao normal.
select testes.como_aal(:'u_chefia', 'aal2');
select testes.afirmar(testes.contar('select 1 from public.militares') > 0, 'com o código (aal2) a chefia lê');
select testes.afirmar((select id = :'m_chefia' from public.meu_perfil()), 'com o código, meu_perfil funciona');
select testes.afirmar(testes.contar('select 1 from public.auditoria') > 0, 'com o código, a chefia lê a auditoria');
-- Fator só iniciado (não confirmado) não exige nada.
select testes.como_dono();
update auth.mfa_factors set status = 'unverified' where user_id = :'u_chefia';
select testes.como(:'u_chefia');
select testes.afirmar(testes.contar('select 1 from public.militares') > 0, 'fator não confirmado não muda o acesso');
-- Quem não tem fator não é afetado.
select testes.como(:'u_wallace');
select testes.afirmar(testes.contar('select 1 from public.militares') > 0, 'adjunto sem segundo fator entra só com a senha');
rollback to savepoint segundo_fator;

-- =========================================================================
\echo '-- excluir militar preserva o histórico'
-- =========================================================================
select testes.como(:'u_leticia');
select testes.afirmar(testes.linhas(format($$update public.ocorrencias set status = 'concluida' where id = %L$$, :'oc_leticia')) = 1,
  'Letícia conclui a ocorrência antes de sair');
select testes.como(:'u_chefia');
select testes.afirmar(testes.linhas(format('delete from public.militares where id = %L', :'m_leticia')) = 1,
  'chefia exclui o cadastro da Letícia');
select testes.como_dono();
select testes.afirmar(
  (select autor_id is null and autor_nome = 'Ten Letícia' and autor_papel = 'adjunto'
     from public.comentarios where id = :'com_leticia'),
  'comentário fica, com autor nulo e o nome no instantâneo');
select testes.afirmar(
  (select enviado_por is null and enviado_por_nome = 'Ten Letícia' from public.evidencias where id = :'ev_leticia'),
  'evidência fica, com o nome no instantâneo');
select testes.afirmar(
  (select status = 'concluida' and concluida_por is null and concluida_por_nome = 'Ten Letícia' and concluida_em is not null
     from public.ocorrencias where id = :'oc_leticia'),
  'ocorrência concluída fica, com o nome de quem concluiu');
select testes.afirmar(
  (select criado_por is null from public.atividades where id = :'at_pontual'),
  'atividade criada por ela fica, com criado_por nulo');
select testes.afirmar(
  (select criado_por is null and concluida_por is null and concluida_por_nome = 'Ten Letícia'
     from public.ocorrencias where titulo_execucao = 'Notificação 2026/041'),
  'execução registrada por ela fica');
select testes.afirmar(not exists (select 1 from public.atividade_responsaveis where militar_id = :'m_leticia'),
  'as responsabilidades dela são apagadas');
select testes.afirmar(not exists (select 1 from public.notificacoes where destinatario_id = :'m_leticia'),
  'as notificações dela são apagadas');
select testes.afirmar(not exists (select 1 from public.avisos_ciencia where militar_id = :'m_leticia'),
  'as ciências dela são apagadas');
select testes.afirmar(
  exists (select 1 from public.auditoria where tabela = 'militares' and operacao = 'DELETE' and registro_id = :'m_leticia'
            and militar_id = :'m_chefia' and antes ->> 'nome_guerra' = 'Letícia'),
  'a exclusão fica na auditoria com o cadastro antigo');
select testes.afirmar(
  exists (select 1 from public.auditoria where tabela = 'ocorrencias' and operacao = 'UPDATE'
            and registro_id = :'oc_leticia' and militar_nome = 'Ten Letícia'),
  'a auditoria antiga mantém o nome de quem fez');

-- =========================================================================
\echo '-- gerar_ocorrencias pelo app'
-- =========================================================================
select testes.como(:'u_wallace');
select public.gerar_ocorrencias() as primeira \gset
select testes.afirmar(public.gerar_ocorrencias() = 0, 'gerar_ocorrencias é idempotente');

\o
\pset tuples_only on
\pset format unaligned
select '   ' || last_value || ' verificações de acesso passaram' from testes.verificacoes;
rollback;
