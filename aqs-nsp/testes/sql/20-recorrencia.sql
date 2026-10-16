-- =========================================================================
-- HABE · AQS e NSP — testes da recorrência (ARQUITETURA §4)
--
-- 1) privado.datas_ocorrencia direto, com datas fixas e os feriados da
--    carga inicial (2026–2027). Os valores esperados foram conferidos à mão
--    no calendário; a mesma regra existe em assets/js/recorrencia.js e o
--    teste de paridade (testes/paridade-recorrencia.mjs) compara as duas.
-- 2) gerar_ocorrencias / salvar_atividade sobre o banco carregado, com
--    datas relativas a hoje_belem() (o teste vale em qualquer dia).
-- Tudo numa transação desfeita no fim.
-- =========================================================================

\set ON_ERROR_STOP 1
\o /dev/null
set client_min_messages = warning;

begin;

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

-- Compara a lista gerada com a esperada ('REF=AAAA-MM-DD;REF=...').
create function testes.datas_iguais(p_obtido text, p_esperado text, p_mensagem text)
returns void language plpgsql as $$
begin
  if p_obtido is distinct from p_esperado then
    raise exception 'FALHOU: % — esperado [%], veio [%]', p_mensagem, p_esperado, coalesce(p_obtido, '(nada)');
  end if;
  perform nextval('testes.verificacoes');
end
$$;

-- Atalho: a saída de datas_ocorrencia como texto, na ordem devolvida.
create function testes.datas(p_periodicidade text, p_dia_semana int, p_dia_mes int, p_mes_inicio int,
                             p_antecipar boolean, p_de date, p_ate date)
returns text language sql as $$
  select string_agg(d.referencia || '=' || to_char(d.prazo, 'YYYY-MM-DD'), ';')
    from privado.datas_ocorrencia(p_periodicidade, p_dia_semana, p_dia_mes, p_mes_inicio,
                                  p_antecipar, p_de, p_ate) d
$$;

create function testes.como(p_usuario uuid)
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims',
                     json_build_object('sub', p_usuario, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end
$$;

create function testes.como_dono()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end
$$;

grant execute on all functions in schema testes to public;

-- =========================================================================
\echo '-- datas_ocorrencia: diária (dias úteis)'
-- =========================================================================
-- 09/10/2026 sex · 10–11 fim de semana · 12 feriado (N. Sra. Aparecida) ·
-- 13–16 ter–sex · 17–18 fim de semana · 19 seg.
select testes.datas_iguais(
  testes.datas('diaria_util', null, null, null, true, '2026-10-09', '2026-10-19'),
  'D2026-10-09=2026-10-09;D2026-10-13=2026-10-13;D2026-10-14=2026-10-14;D2026-10-15=2026-10-15;'
  || 'D2026-10-16=2026-10-16;D2026-10-19=2026-10-19',
  'diária pula sábado, domingo e o feriado de 12/10');
select testes.datas_iguais(
  testes.datas('diaria_util', null, null, null, false, '2026-10-10', '2026-10-12'),
  null, 'diária não gera nada num intervalo só de fim de semana e feriado (antecipar não se aplica)');

-- =========================================================================
\echo '-- datas_ocorrencia: semanal'
-- =========================================================================
-- Semana ISO 2026-W53 = 28/12/2026 a 03/01/2027; a sexta 01/01/2027 é
-- feriado ⇒ antecipa para quinta 31/12/2026, referência S2026-W53.
select testes.datas_iguais(
  testes.datas('semanal', 5, null, null, true, '2026-12-28', '2027-01-03'),
  'S2026-W53=2026-12-31', 'semanal sexta na 2026-W53 antecipa para 31/12');
select testes.datas_iguais(
  testes.datas('semanal', 5, null, null, true, '2026-12-31', '2026-12-31'),
  'S2026-W53=2026-12-31', 'inclusão pelo prazo final: intervalo de um dia acha a semana antecipada');
select testes.datas_iguais(
  testes.datas('semanal', 5, null, null, true, '2027-01-01', '2027-01-08'),
  'S2027-W01=2027-01-08', 'a W53 antecipada fica fora de um intervalo que começa em 01/01');
select testes.datas_iguais(
  testes.datas('semanal', 5, null, null, false, '2026-12-28', '2027-01-03'),
  'S2026-W53=2027-01-01', 'sem antecipar, a semanal mantém a sexta-feriado');
select testes.datas_iguais(
  testes.datas('semanal', 1, null, null, true, '2026-10-05', '2026-10-25'),
  'S2026-W41=2026-10-05;S2026-W42=2026-10-09;S2026-W43=2026-10-19',
  'segunda 12/10 (feriado) antecipa para a sexta 09/10, da semana anterior, sem perder a referência W42');
select testes.datas_iguais(
  testes.datas('semanal', 7, null, null, true, '2026-10-12', '2026-10-18'),
  'S2026-W42=2026-10-16', 'domingo antecipa para a sexta da mesma semana');
select testes.datas_iguais(
  testes.datas('semanal', null, null, null, true, '2026-10-01', '2026-10-31'),
  null, 'semanal sem dia da semana não gera nada');
select testes.datas_iguais(
  testes.datas('semanal', 8, null, null, true, '2026-10-01', '2026-10-31'),
  null, 'dia da semana fora de 1..7 não gera nada');

-- =========================================================================
\echo '-- datas_ocorrencia: mensal'
-- =========================================================================
select testes.datas_iguais(
  (select string_agg(x, ';') from unnest(string_to_array(
     testes.datas('mensal', null, 31, null, false, '2027-01-01', '2028-03-31'), ';')) x
    where x like 'M2027-02=%' or x like 'M2027-04=%' or x like 'M2028-02=%'),
  'M2027-02=2027-02-28;M2027-04=2027-04-30;M2028-02=2028-02-29',
  'dia 31 = último dia: fev/2027 (28), abr/2027 (30), fev/2028 (29, bissexto)');
select testes.datas_iguais(
  (select string_agg(x, ';') from unnest(string_to_array(
     testes.datas('mensal', null, 31, null, true, '2027-01-01', '2028-03-31'), ';')) x
    where x like 'M2027-02=%' or x like 'M2027-04=%' or x like 'M2028-02=%'),
  'M2027-02=2027-02-26;M2027-04=2027-04-30;M2028-02=2028-02-29',
  'último dia útil: 28/02/2027 é domingo ⇒ 26/02');
select testes.afirmar(
  (select count(*) = 15 from privado.datas_ocorrencia('mensal', null, 31, null, true, '2027-01-01', '2028-03-31')),
  'mensal gera uma por mês (15 meses)');
select testes.datas_iguais(
  testes.datas('mensal', null, 5, null, true, '2026-12-01', '2026-12-31'),
  'M2026-12=2026-12-04', 'dia 5 num sábado (05/12/2026) antecipa para sexta 04/12');
select testes.datas_iguais(
  testes.datas('mensal', null, 15, null, true, '2026-11-01', '2026-11-30'),
  'M2026-11=2026-11-13', '15/11/2026 é domingo e feriado; sábado 14 não é útil ⇒ sexta 13');
select testes.datas_iguais(
  testes.datas('mensal', null, 15, null, false, '2026-11-01', '2026-11-30'),
  'M2026-11=2026-11-15', 'sem antecipar mantém a data nominal');
select testes.datas_iguais(
  testes.datas('mensal', null, 1, null, true, '2026-12-31', '2026-12-31'),
  'M2027-01=2026-12-31', 'antecipação que cruza o mês: 01/01/2027 (feriado) ⇒ 31/12/2026, referência de janeiro');
select testes.datas_iguais(
  testes.datas('mensal', null, 1, null, true, '2027-01-01', '2027-01-31'),
  null, 'e o mesmo período não aparece de novo em janeiro');
select testes.datas_iguais(
  testes.datas('mensal', null, 0, null, true, '2026-10-01', '2026-12-31'),
  null, 'dia do mês fora de 1..31 não gera nada');

-- =========================================================================
\echo '-- datas_ocorrencia: trimestral, semestral, anual'
-- =========================================================================
select testes.datas_iguais(
  testes.datas('trimestral', null, 5, 1, true, '2027-01-01', '2027-12-31'),
  'T2027-01=2027-01-05;T2027-04=2027-04-05;T2027-07=2027-07-05;T2027-10=2027-10-05',
  'trimestral com mes_inicio 1 só gera jan/abr/jul/out');
select testes.datas_iguais(
  testes.datas('trimestral', null, 5, 4, true, '2027-01-01', '2027-12-31'),
  'T2027-01=2027-01-05;T2027-04=2027-04-05;T2027-07=2027-07-05;T2027-10=2027-10-05',
  'trimestral com mes_inicio 4 cai nos mesmos meses (ciclo de 3)');
select testes.datas_iguais(
  testes.datas('trimestral', null, 10, 2, false, '2027-01-01', '2027-12-31'),
  'T2027-02=2027-02-10;T2027-05=2027-05-10;T2027-08=2027-08-10;T2027-11=2027-11-10',
  'trimestral com mes_inicio 2: fev/mai/ago/nov');
select testes.datas_iguais(
  testes.datas('semestral', null, 20, 3, true, '2027-01-01', '2027-12-31'),
  'H2027-03=2027-03-19;H2027-09=2027-09-20',
  'semestral mar/set; 20/03/2027 é sábado ⇒ 19/03');
select testes.datas_iguais(
  testes.datas('anual', null, 31, 3, true, '2026-10-15', '2027-12-31'),
  'A2027-03=2027-03-31', 'anual: só março');
select testes.datas_iguais(
  testes.datas('anual', null, 29, 2, false, '2027-01-01', '2028-12-31'),
  'A2027-02=2027-02-28;A2028-02=2028-02-29', 'anual dia 29 de fevereiro cai no último dia nos anos comuns');
select testes.datas_iguais(
  testes.datas('trimestral', null, 5, null, true, '2027-01-01', '2027-12-31'),
  null, 'trimestral sem mês de início não gera nada');
select testes.datas_iguais(
  testes.datas('quinzenal', null, 5, 1, true, '2027-01-01', '2027-12-31'),
  null, 'periodicidade desconhecida não gera nada');
select testes.datas_iguais(
  testes.datas('mensal', null, 5, null, true, '2027-02-01', '2027-01-01'),
  null, 'intervalo invertido não gera nada');

-- =========================================================================
\echo '-- datas_ocorrencia: ordem e feriados novos'
-- =========================================================================
select testes.afirmar(
  (select bool_and(d.prazo >= coalesce(d.anterior, d.prazo))
     from (select x.prazo, lag(x.prazo) over () as anterior
             from privado.datas_ocorrencia('semanal', 3, null, null, true, '2026-01-01', '2027-12-31') x) d),
  'saída ordenada por prazo');
insert into public.feriados (data, descricao) values ('2026-10-16', 'Feriado de teste');
select testes.datas_iguais(
  testes.datas('semanal', 5, null, null, true, '2026-10-12', '2026-10-18'),
  'S2026-W42=2026-10-15', 'feriado cadastrado passa a valer na hora');
delete from public.feriados where data = '2026-10-16';

-- =========================================================================
\echo '-- gerar_ocorrencias: janela e idempotência'
-- =========================================================================
\set u_chefia 'b0000000-0000-4000-8000-000000000004'
\set u_wallace 'b0000000-0000-4000-8000-000000000002'
insert into auth.users (id, email) values (:'u_chefia', 'chefia@teste.local'), (:'u_wallace', 'wallace@teste.local');
select
  max(id::text) filter (where nome_guerra = 'Chefia AQS/NSP') as m_chefia,
  max(id::text) filter (where nome_guerra = 'Wallace') as m_wallace
from public.militares \gset
update public.militares set usuario_id = :'u_chefia' where id = :'m_chefia';
update public.militares set usuario_id = :'u_wallace' where id = :'m_wallace';

select testes.como(:'u_wallace');
select count(*) as antes from public.ocorrencias \gset
select public.gerar_ocorrencias() as geradas_1 \gset
select public.gerar_ocorrencias() as geradas_2 \gset
select testes.afirmar(:geradas_2 = 0, 'rodar gerar_ocorrencias 2x não duplica (2ª chamada gera 0)');
select testes.afirmar((select count(*) from public.ocorrencias) = :antes + :geradas_1,
  'gerar_ocorrencias devolve a quantidade inserida');
select testes.como_dono();
select testes.afirmar(privado.rotina_diaria() = 0, 'a rotina diária também é idempotente');
select testes.afirmar(
  not exists (select 1 from public.ocorrencias o join public.atividades a on a.id = o.atividade_id
               where a.tipo = 'recorrente'
               group by o.atividade_id, o.referencia having count(*) > 1),
  'nenhuma referência repetida por atividade');
select testes.afirmar(
  not exists (select 1 from public.ocorrencias o join public.atividades a on a.id = o.atividade_id
               where a.periodicidade = 'diaria_util' and o.prazo > public.hoje_belem()),
  'diária: nada depois de hoje');
select testes.afirmar(
  not exists (select 1 from public.ocorrencias o join public.atividades a on a.id = o.atividade_id
               where a.tipo = 'recorrente' and o.prazo > public.hoje_belem() + 31),
  'demais: nada depois de hoje + 31');
select testes.afirmar(
  not exists (select 1 from public.ocorrencias o join public.atividades a on a.id = o.atividade_id
               where a.tipo = 'recorrente' and o.prazo < a.data_inicio),
  'nada antes de data_inicio');
select testes.afirmar(
  (select count(*) >= 1 from public.ocorrencias o join public.atividades a on a.id = o.atividade_id
    where a.ordem = 13
      and o.referencia in ('M' || to_char(public.hoje_belem(), 'YYYY-MM'),
                           'M' || to_char(public.hoje_belem() + 31, 'YYYY-MM'))),
  'a mensal do dia 15 tem a ocorrência do mês corrente ou do seguinte');

-- Atividades novas com data_inicio no passado e no futuro (pela RPC, como
-- a chefia faria na tela).
select testes.como(:'u_chefia');
select public.salvar_atividade(jsonb_build_object(
  'titulo', 'Diária antiga', 'tipo', 'recorrente', 'periodicidade', 'diaria_util',
  'data_inicio', public.hoje_belem() - 60, 'responsaveis', jsonb_build_array(:'m_wallace'))) as at_diaria \gset
select public.salvar_atividade(jsonb_build_object(
  'titulo', 'Semanal futura', 'tipo', 'recorrente', 'periodicidade', 'semanal', 'dia_semana', 2,
  'data_inicio', public.hoje_belem() + 10, 'responsaveis', jsonb_build_array(:'m_wallace'))) as at_futura \gset
select public.salvar_atividade(jsonb_build_object(
  'titulo', 'Anual distante', 'tipo', 'recorrente', 'periodicidade', 'anual', 'dia_mes', 10, 'mes_inicio', 1,
  'data_inicio', public.hoje_belem() + 40, 'responsaveis', jsonb_build_array(:'m_wallace'))) as at_distante \gset
select testes.como_dono();
select testes.afirmar(
  (select min(prazo) >= public.hoje_belem() - 45 and max(prazo) <= public.hoje_belem() and count(*) >= 25
          and bool_and(extract(isodow from prazo) <= 5)
          and bool_and(not exists (select 1 from public.feriados f where f.data = o.prazo))
          and bool_and(referencia = 'D' || to_char(prazo, 'YYYY-MM-DD'))
     from public.ocorrencias o where atividade_id = :'at_diaria'),
  'diária com início antigo: só os últimos 45 dias, só dias úteis, até hoje');
select testes.afirmar(
  (select count(*) >= 2 and min(prazo) >= public.hoje_belem() + 10 and max(prazo) <= public.hoje_belem() + 31
     from public.ocorrencias where atividade_id = :'at_futura'),
  'semanal com início futuro: começa no início e vai até hoje + 31');
select testes.afirmar(
  (select count(*) = 0 from public.ocorrencias where atividade_id = :'at_distante'),
  'início além da janela: nada gerado ainda');

-- =========================================================================
\echo '-- pontual: ocorrência única P que acompanha o prazo'
-- =========================================================================
select testes.como(:'u_chefia');
select public.salvar_atividade(jsonb_build_object(
  'titulo', 'Pontual de teste', 'tipo', 'pontual', 'prazo', public.hoje_belem() + 5,
  'responsaveis', jsonb_build_array(:'m_wallace'))) as at_pontual \gset
select testes.afirmar(
  (select count(*) = 1 and min(referencia) = 'P' and min(prazo) = public.hoje_belem() + 5
     from public.ocorrencias where atividade_id = :'at_pontual'),
  'pontual gera uma única ocorrência P com o prazo');
select public.salvar_atividade(jsonb_build_object('id', :'at_pontual', 'prazo', public.hoje_belem() + 7));
select testes.afirmar(
  (select count(*) = 1 and min(prazo) = public.hoje_belem() + 7 from public.ocorrencias where atividade_id = :'at_pontual'),
  'mudar o prazo da pontual move o prazo da P');
select public.salvar_atividade(jsonb_build_object('id', :'at_pontual', 'prazo', null));
select testes.afirmar(
  (select count(*) = 1 and min(prazo) is null from public.ocorrencias where atividade_id = :'at_pontual'),
  'tirar o prazo da pontual deixa a P sem prazo');
select public.salvar_atividade(jsonb_build_object('id', :'at_pontual', 'prazo', public.hoje_belem() + 7));
update public.ocorrencias set status = 'concluida' where atividade_id = :'at_pontual';
select public.salvar_atividade(jsonb_build_object('id', :'at_pontual', 'prazo', public.hoje_belem() + 9));
select testes.afirmar(
  (select count(*) = 1 and min(prazo) = public.hoje_belem() + 7 and min(status) = 'concluida'
     from public.ocorrencias where atividade_id = :'at_pontual'),
  'P concluída não acompanha mais o prazo da atividade');
select public.salvar_atividade(jsonb_build_object(
  'titulo', 'Pontual que vira sob demanda', 'tipo', 'pontual', 'responsaveis', jsonb_build_array(:'m_wallace'))) as at_muda \gset
select public.salvar_atividade(jsonb_build_object('id', :'at_muda', 'tipo', 'sob_demanda'));
select testes.afirmar(
  (select count(*) = 0 from public.ocorrencias where atividade_id = :'at_muda'),
  'pontual que vira sob demanda perde a P pendente e vazia');
select public.salvar_atividade(jsonb_build_object('id', :'at_muda', 'tipo', 'pontual', 'prazo', public.hoje_belem() + 3));
select testes.afirmar(
  (select count(*) = 1 and min(prazo) = public.hoje_belem() + 3 from public.ocorrencias where atividade_id = :'at_muda'),
  'e volta a ter a P ao voltar a ser pontual');
select public.salvar_atividade(jsonb_build_object('id', :'at_muda', 'ativa', false));
select testes.afirmar(
  (select count(*) = 0 from public.ocorrencias where atividade_id = :'at_muda'),
  'arquivar a pontual remove a P pendente futura');

-- =========================================================================
\echo '-- mudança de regra: só as futuras pendentes e vazias são refeitas'
-- =========================================================================
select public.salvar_atividade(jsonb_build_object(
  'titulo', 'Semanal que muda de dia', 'tipo', 'recorrente', 'periodicidade', 'semanal', 'dia_semana', 5,
  'data_inicio', public.hoje_belem() - 20, 'responsaveis', jsonb_build_array(:'m_wallace'))) as at_regra \gset
select testes.como_dono();
select count(*) as regra_passadas from public.ocorrencias
 where atividade_id = :'at_regra' and prazo < public.hoje_belem() \gset
-- Uma passada pendente, uma futura com comentário, uma com evidência e
-- uma em andamento; o resto das futuras fica pendente e vazio.
select id as oc_passada from public.ocorrencias
 where atividade_id = :'at_regra' and prazo < public.hoje_belem() order by prazo limit 1 \gset
select id as oc_comentada, prazo as prazo_comentada from public.ocorrencias
 where atividade_id = :'at_regra' and prazo >= public.hoje_belem() order by prazo limit 1 offset 0 \gset
select id as oc_com_evidencia, prazo as prazo_evidencia from public.ocorrencias
 where atividade_id = :'at_regra' and prazo >= public.hoje_belem() order by prazo limit 1 offset 1 \gset
select id as oc_andamento, prazo as prazo_andamento from public.ocorrencias
 where atividade_id = :'at_regra' and prazo >= public.hoje_belem() order by prazo limit 1 offset 2 \gset
insert into public.comentarios (atividade_id, ocorrencia_id, autor_id, texto)
values (:'at_regra', :'oc_comentada', :'m_wallace', 'Já comecei a separar o material');
insert into public.evidencias (atividade_id, ocorrencia_id, storage_path, nome, enviado_por)
values (:'at_regra', :'oc_com_evidencia', :'at_regra' || '/' || :'oc_com_evidencia' || '/r-planilha.xlsx', 'planilha.xlsx', :'m_wallace');
update public.ocorrencias set status = 'em_andamento' where id = :'oc_andamento';

select testes.como(:'u_chefia');
select public.salvar_atividade(jsonb_build_object('id', :'at_regra', 'dia_semana', 4));
select testes.como_dono();
select testes.afirmar(
  (select extract(isodow from prazo) = 5 and status = 'pendente' from public.ocorrencias where id = :'oc_passada'),
  'a passada pendente fica como estava (histórico)');
select testes.afirmar(
  (select prazo = :'prazo_comentada' from public.ocorrencias where id = :'oc_comentada'),
  'a futura com comentário fica');
select testes.afirmar(
  (select prazo = :'prazo_evidencia' from public.ocorrencias where id = :'oc_com_evidencia'),
  'a futura com evidência fica');
select testes.afirmar(
  (select prazo = :'prazo_andamento' and status = 'em_andamento' from public.ocorrencias where id = :'oc_andamento'),
  'a futura em andamento fica');
-- As futuras refeitas são exatamente as da regra nova (quinta-feira) na
-- janela, menos as semanas que ficaram com a ocorrência antiga.
select testes.afirmar(
  (select coalesce(array_agg(o.referencia || '=' || o.prazo order by o.referencia), '{}')
     from public.ocorrencias o
    where o.atividade_id = :'at_regra' and o.prazo >= public.hoje_belem()
      and o.id not in (:'oc_comentada', :'oc_com_evidencia', :'oc_andamento'))
  =
  (select coalesce(array_agg(d.referencia || '=' || d.prazo order by d.referencia), '{}')
     from privado.datas_ocorrencia('semanal', 4, null, null, true, public.hoje_belem(), public.hoje_belem() + 31) d
    where d.referencia not in (select o.referencia from public.ocorrencias o
                                where o.id in (:'oc_comentada', :'oc_com_evidencia', :'oc_andamento'))),
  'as demais futuras foram refeitas pela regra nova (quinta-feira)');
select testes.afirmar(
  (select count(*) >= 2 from public.ocorrencias
    where atividade_id = :'at_regra' and prazo >= public.hoje_belem() and extract(isodow from prazo) = 4),
  'há ocorrências futuras na quinta-feira');
select testes.afirmar(
  (select count(*) = :regra_passadas from public.ocorrencias
    where atividade_id = :'at_regra' and prazo < public.hoje_belem()),
  'as passadas não mudam');
select testes.afirmar(
  not exists (select 1 from public.ocorrencias where atividade_id = :'at_regra'
               group by referencia having count(*) > 1),
  'sem referência duplicada depois de refazer');

select testes.como(:'u_chefia');
select public.salvar_atividade(jsonb_build_object('id', :'at_regra', 'ativa', false));
select testes.como_dono();
select testes.afirmar(
  (select count(*) = 0 from public.ocorrencias
    where atividade_id = :'at_regra' and prazo >= public.hoje_belem()
      and id not in (:'oc_comentada', :'oc_com_evidencia', :'oc_andamento')),
  'arquivar apaga as futuras pendentes e vazias');
select testes.afirmar(
  (select count(*) = 3 from public.ocorrencias
    where id in (:'oc_comentada', :'oc_com_evidencia', :'oc_andamento'))
  and (select count(*) = :regra_passadas from public.ocorrencias
        where atividade_id = :'at_regra' and prazo < public.hoje_belem()),
  'arquivar preserva as passadas e as que já têm trabalho registrado');
select testes.afirmar(
  not exists (select 1 from public.ocorrencias
               where atividade_id = :'at_regra' and status in ('pendente', 'em_andamento')),
  'arquivar encerra o que estava em aberto: nada fica "atrasado" cobrando a atividade arquivada');
select testes.afirmar(
  (select status = 'nao_se_aplica' and justificativa like 'Atividade arquivada em __/__/____ por %'
     from public.ocorrencias where id = :'oc_passada'),
  'a passada pendente vira "não se aplica", com a justificativa do arquivamento');
select testes.afirmar(
  (select status = 'nao_se_aplica' from public.ocorrencias where id = :'oc_andamento'),
  'a futura em andamento também é encerrada');
select testes.afirmar(privado.gerar_ocorrencias_atividade(:'at_regra') = 0, 'atividade arquivada não gera ocorrências');

-- =========================================================================
\echo '-- avisos de prazo'
-- =========================================================================
-- Pontuais criadas pelo dono (sem usuário: sem aviso de atribuição), com
-- prazo hoje, amanhã e depois de amanhã, e uma já concluída para hoje.
select testes.como_dono();
select id as m_balieiro from public.militares where nome_guerra = 'Balieiro' \gset
insert into public.atividades (titulo, tipo, prazo) values
  ('Prazo de teste hoje', 'pontual', public.hoje_belem()),
  ('Prazo de teste amanhã', 'pontual', public.hoje_belem() + 1),
  ('Prazo de teste depois', 'pontual', public.hoje_belem() + 2),
  ('Prazo de teste concluída', 'pontual', public.hoje_belem());
insert into public.atividade_responsaveis (atividade_id, militar_id)
select a.id, m.id from public.atividades a cross join public.militares m
 where a.titulo like 'Prazo de teste %' and m.nome_guerra in ('Wallace', 'Balieiro');
update public.ocorrencias o set status = 'concluida'
  from public.atividades a where a.id = o.atividade_id and a.titulo = 'Prazo de teste concluída';
update public.militares set ativo = false where id = :'m_balieiro';
select testes.afirmar(
  not exists (select 1 from public.notificacoes n join public.atividades a on a.id = n.atividade_id
               where a.titulo like 'Prazo de teste %' and n.tipo = 'atribuicao'),
  'carga pelo dono (sem usuário) não gera aviso de atribuição');
select privado.notificar_prazos() as avisos_prazo \gset
select testes.afirmar(:avisos_prazo >= 2, 'notificar_prazos devolve quantos avisos criou');
select testes.afirmar(
  (select string_agg(a.titulo || ':' || n.titulo, ',' order by a.titulo)
     from public.notificacoes n join public.atividades a on a.id = n.atividade_id
    where n.tipo = 'prazo' and a.titulo like 'Prazo de teste %' and n.destinatario_id = :'m_wallace')
  = 'Prazo de teste amanhã:Prazo amanhã,Prazo de teste hoje:Prazo hoje',
  '"Prazo hoje" e "Prazo amanhã" só para as abertas que vencem hoje/amanhã');
select testes.afirmar(
  not exists (select 1 from public.notificacoes n join public.atividades a on a.id = n.atividade_id
               where n.tipo = 'prazo' and a.titulo like 'Prazo de teste %' and n.destinatario_id = :'m_balieiro'),
  'militar desativado não recebe aviso de prazo');
select testes.afirmar(privado.notificar_prazos() = 0, 'avisos de prazo: no máximo um por ocorrência, pessoa e dia');
select testes.afirmar(
  (select count(*) = 1 from public.notificacoes n join public.atividades a on a.id = n.atividade_id
    where n.tipo = 'prazo' and a.titulo = 'Prazo de teste hoje' and n.destinatario_id = :'m_wallace'),
  'rodar de novo no mesmo dia não repete o aviso');

\o
\pset tuples_only on
\pset format unaligned
select '   ' || last_value || ' verificações de recorrência passaram' from testes.verificacoes;
rollback;
