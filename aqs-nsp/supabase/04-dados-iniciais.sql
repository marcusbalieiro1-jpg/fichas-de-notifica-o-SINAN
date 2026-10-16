-- =========================================================================
-- HABE · AQS e NSP — Ferramenta de Gestão de Atividades
-- 04-dados-iniciais.sql — carga inicial
--
-- Rode depois do 03-tempo-real-agenda.sql. Idempotente: rodar de novo não
-- duplica nada e NÃO recria o que a equipe já editou ou excluiu:
--  * setores, feriados e configurações entram só se ainda não existirem
--    (pela sigla, pela data, pela chave);
--  * a equipe (chefia e adjuntos) só é cadastrada se ainda não houver
--    nenhum militar além da conta institucional;
--  * a conta institucional (administrador) é recriada se tiver sumido —
--    ela é a âncora de continuidade do sistema;
--  * as 16 atividades do plano só entram se a tabela estiver vazia.
-- Depois da carga, siga o passo a passo de implantação no topo do
-- 01-estrutura.sql (privado.vincular_usuario).
-- =========================================================================

begin;

-- ---------- setores ----------
insert into public.setores (sigla, nome, ordem) values
  ('NSP', 'Núcleo de Segurança do Paciente', 1),
  ('AQS', 'Assessoria de Qualidade e Segurança', 2)
on conflict (sigla) do nothing;

-- ---------- feriados de 2026 e 2027 (nacionais, Pará e Belém) ----------
-- Feriado no meio da semana faz o prazo "antecipar para o dia útil"
-- recuar. Cadastre os do ano seguinte todo fim de ano (o Início avisa os
-- gestores a partir de 1º de novembro).
insert into public.feriados (data, descricao) values
  ('2026-01-01', 'Confraternização Universal'),
  ('2026-04-03', 'Sexta-feira da Paixão'),
  ('2026-04-21', 'Tiradentes'),
  ('2026-05-01', 'Dia do Trabalho'),
  ('2026-08-15', 'Adesão do Pará à Independência'),
  ('2026-09-07', 'Independência do Brasil'),
  ('2026-10-12', 'Nossa Senhora Aparecida'),
  ('2026-11-02', 'Finados'),
  ('2026-11-15', 'Proclamação da República'),
  ('2026-11-20', 'Dia Nacional de Zumbi e da Consciência Negra'),
  ('2026-12-08', 'Nossa Senhora da Conceição (Belém)'),
  ('2026-12-25', 'Natal'),
  ('2027-01-01', 'Confraternização Universal'),
  ('2027-03-26', 'Sexta-feira da Paixão'),
  ('2027-04-21', 'Tiradentes'),
  ('2027-05-01', 'Dia do Trabalho'),
  ('2027-08-15', 'Adesão do Pará à Independência'),
  ('2027-09-07', 'Independência do Brasil'),
  ('2027-10-12', 'Nossa Senhora Aparecida'),
  ('2027-11-02', 'Finados'),
  ('2027-11-15', 'Proclamação da República'),
  ('2027-11-20', 'Dia Nacional de Zumbi e da Consciência Negra'),
  ('2027-12-08', 'Nossa Senhora da Conceição (Belém)'),
  ('2027-12-25', 'Natal')
on conflict (data) do nothing;

-- ---------- configurações ----------
-- Contatos institucionais em branco: o Início avisa os gestores até que
-- sejam preenchidos (Equipe → Continuidade).
insert into public.configuracoes (chave, valor) values
  ('contatos', jsonb_build_object(
     'email_institucional', '',
     'responsavel_tecnico', '',
     'telefone', '',
     'observacoes', ''))
on conflict (chave) do nothing;

-- ---------- militares ----------
-- Sem e-mail e sem usuário de acesso: o acesso de cada um é criado depois,
-- em Equipe (Edge Function admin-usuarios), e o da conta institucional
-- com privado.vincular_usuario.
do $$
declare
  v_nsp uuid;
  v_aqs uuid;
begin
  select s.id into v_nsp from public.setores s where s.sigla = 'NSP';
  select s.id into v_aqs from public.setores s where s.sigla = 'AQS';

  if not exists (select 1 from public.militares m where m.papel <> 'administrador') then
    insert into public.militares (posto, nome_guerra, papel, setor_id) values
      ('Ten', 'Letícia', 'adjunto', v_nsp),
      ('Ten', 'Wallace', 'adjunto', v_nsp),
      ('Ten', 'Balieiro', 'adjunto', v_nsp),
      ('', 'Chefia AQS/NSP', 'chefia', v_nsp);
  end if;

  if not exists (select 1 from public.militares m where m.papel = 'administrador') then
    insert into public.militares (posto, nome_guerra, papel, setor_id)
    values ('', 'AQS — conta institucional', 'administrador', v_aqs);
  end if;
end
$$;

-- ---------- as 16 atividades do plano do NSP ----------
-- data_inicio = hoje (padrão da coluna): nada é gerado para trás.
-- Os responsáveis são encontrados pelo nome de guerra; a conta
-- institucional nunca é responsável.
do $$
declare
  v_nsp uuid;
  v_item record;
  v_atividade uuid;
begin
  if exists (select 1 from public.atividades) then
    return;
  end if;

  select s.id into v_nsp from public.setores s where s.sigla = 'NSP';

  for v_item in
    select *
      from (values
        (1, 'Verificar o SIGADAER e os retornos das notificações',
            'Verificação diária do SIGADAER e dos retornos das notificações.',
            'recorrente', 'diaria_util', null::int, null::int, 'normal', array['Letícia']),
        (2, 'Analisar as notificações recebidas e encaminhar ao responsável',
            'Analisar as notificações recebidas e encaminhar ao responsável para elaboração do plano de ação.',
            'sob_demanda', null, null, null, 'normal', array['Letícia']),
        (3, 'Notificar no NOTIVISA',
            'Lançar no NOTIVISA, mensalmente, as notificações do período.',
            'recorrente', 'mensal', null, 31, 'normal', array['Letícia']),
        (4, 'Salvar os retornos das notificações na pasta do setor',
            'Arquivar na pasta do setor os retornos das notificações.',
            'recorrente', 'semanal', 5, null, 'normal', array['Letícia']),
        (5, 'Realizar auditoria cirúrgica',
            'Auditoria de cirurgia segura, uma vez por semana.',
            'recorrente', 'semanal', 5, null, 'normal', array['Wallace']),
        (6, 'Realizar auditoria de identificação do paciente',
            'Auditoria do protocolo de identificação, uma vez por semana.',
            'recorrente', 'semanal', 5, null, 'normal', array['Wallace']),
        (7, 'Acompanhar as observações de higienização das mãos',
            'Acompanhar as observações de higienização das mãos e estimular o grupo de observadores.',
            'recorrente', 'mensal', null, 31, 'normal', array['Balieiro']),
        (8, 'Auditar LPP, queda e SBAR dos pacientes baixados no mês',
            'Auditar lesão por pressão (LPP), quedas e a comunicação SBAR de todos os pacientes baixados no mês.',
            'recorrente', 'mensal', null, 10, 'normal', array['Balieiro']),
        (9, 'Revisar o protocolo de identificação e o protocolo de flebite',
            'Incluir no protocolo de identificação as alterações de pulseiras e etiquetas e revisar o protocolo de flebite.',
            'pontual', null, null, null, 'normal', array['Balieiro']),
        (10, 'Acompanhar as auditorias mensais do HEMOPA e os relatórios',
            'Acompanhar as auditorias mensais do HEMOPA e os respectivos relatórios.',
            'recorrente', 'mensal', null, 31, 'normal', array['Balieiro']),
        (11, 'Realizar treinamentos e orientações',
            'Treinamentos e orientações conforme o cronograma ou a demanda.',
            'sob_demanda', null, null, null, 'normal', array['Letícia']),
        (12, 'Reunião com os anestesistas',
            'Etapa única, não recorrente.',
            'pontual', null, null, null, 'normal', array['Letícia', 'Balieiro']),
        (13, 'Apresentação de indicadores e despacho com a chefia',
            'Fazer a apresentação de indicadores no layout previsto e despachar com a chefia até o dia 15 de cada mês.',
            'recorrente', 'mensal', null, 15, 'alta', array['Balieiro']),
        (14, 'Apresentar os indicadores mensais',
            'Apresentação mensal dos indicadores. Responsável a confirmar.',
            'recorrente', 'mensal', null, 31, 'normal', array['Chefia AQS/NSP']),
        (15, 'Encaminhar os dados mensais da CGC',
            'Salvar os dados mensais na planilha da CGC até o dia 05 de cada mês.',
            'recorrente', 'mensal', null, 5, 'alta', array['Balieiro']),
        (16, 'Analisar incidentes conforme a demanda',
            'Analisar os incidentes de acordo com a demanda de ocorrência.',
            'sob_demanda', null, null, null, 'normal', array['Letícia', 'Balieiro'])
      ) as t(ordem, titulo, descricao, tipo, periodicidade, dia_semana, dia_mes, prioridade, responsaveis)
     order by t.ordem
  loop
    insert into public.atividades (
      ordem, titulo, descricao, setor_id, tipo, periodicidade, dia_semana, dia_mes,
      antecipar_dia_util, prioridade)
    values (
      v_item.ordem, v_item.titulo, v_item.descricao, v_nsp, v_item.tipo, v_item.periodicidade,
      v_item.dia_semana, v_item.dia_mes, true, v_item.prioridade)
    returning id into v_atividade;

    insert into public.atividade_responsaveis (atividade_id, militar_id)
    select v_atividade, m.id
      from public.militares m
     where m.nome_guerra = any (v_item.responsaveis)
       and m.papel <> 'administrador'
    on conflict do nothing;
  end loop;
end
$$;

-- ---------- ocorrências iniciais ----------
-- Gera a janela atual de todas as recorrentes e os avisos de prazo.
select privado.rotina_diaria() as ocorrencias_geradas;

commit;
