#!/usr/bin/env bash
# =========================================================================
# HABE · AQS e NSP — testes do banco num PostgreSQL 16 local
#
# Sobe um PostgreSQL descartável, carrega a imitação mínima do Supabase
# (testes/sql/00-stub-supabase.sql) e os scripts reais supabase/01..04 —
# DUAS vezes, para provar que são reexecutáveis —, e roda os testes de
# acesso (10-rls.sql) e de recorrência (20-recorrencia.sql).
#
# Uso:
#   testes/executar-sql.sh            roda tudo e desliga o servidor no fim
#   testes/executar-sql.sh --manter   roda tudo e deixa o servidor no ar,
#                                     gravando a conexão em
#                                     /tmp/aqs-nsp-pg/conexao.env (para o
#                                     teste de paridade JS × SQL:
#                                     set -a; . /tmp/aqs-nsp-pg/conexao.env)
#   testes/executar-sql.sh --parar    desliga o servidor e apaga o cluster
#
# Variáveis opcionais: AQS_PG_BASE (pasta do cluster, padrão
# /tmp/aqs-nsp-pg), AQS_PG_PORTA (padrão 54329), PGBIN (binários do
# PostgreSQL, padrão /usr/lib/postgresql/16/bin).
#
# Código de saída: 0 = tudo passou; 1 = alguma falha; 2 = uso incorreto.
# Funciona chamado como root (o servidor roda como o usuário "postgres",
# porque o PostgreSQL se recusa a rodar como root) ou como usuário comum.
# =========================================================================
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
BASE="${AQS_PG_BASE:-/tmp/aqs-nsp-pg}"
DADOS="$BASE/dados"
PORTA="${AQS_PG_PORTA:-54329}"
BANCO="aqs"
ARQ_CONEXAO="$BASE/conexao.env"
LOG_SERVIDOR="$BASE/servidor.log"

MODO="testar"
case "${1:-}" in
  ''|--testar) MODO="testar" ;;
  --manter) MODO="manter" ;;
  --parar) MODO="parar" ;;
  -h|--ajuda)
    sed -n '3,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 0 ;;
  *)
    echo "Opção desconhecida: $1 (use --manter, --parar ou nada)" >&2
    exit 2 ;;
esac

# Trava contra um "rm -rf" desastroso se alguém apontar AQS_PG_BASE para
# um lugar indevido.
case "$BASE" in
  /tmp/?*|/var/tmp/?*) ;;
  *)
    echo "AQS_PG_BASE precisa ficar em /tmp ou /var/tmp (recebido: $BASE)" >&2
    exit 2 ;;
esac

# O PostgreSQL não roda como root: quando o script é chamado como root,
# initdb e pg_ctl rodam como o usuário de sistema "postgres".
DONO=""
if [ "$(id -u)" -eq 0 ]; then
  DONO="postgres"
fi

como_dono() {
  if [ -n "$DONO" ]; then
    runuser -u "$DONO" -- "$@"
  else
    "$@"
  fi
}

servidor_no_ar() {
  [ -f "$DADOS/postmaster.pid" ] && como_dono "$PGBIN/pg_ctl" -D "$DADOS" status >/dev/null 2>&1
}

parar() {
  if [ -d "$DADOS" ] && servidor_no_ar; then
    como_dono "$PGBIN/pg_ctl" -D "$DADOS" -m fast -w stop >/dev/null || true
  fi
  rm -rf "$BASE"
}

subir() {
  mkdir -p "$BASE"
  if [ -n "$DONO" ]; then
    chown "$DONO" "$BASE"
  fi
  chmod 755 "$BASE"

  # Fuso UTC como no Supabase: os testes provam que as datas usam o fuso
  # de Belém por conta própria (hoje_belem), não o do servidor.
  como_dono "$PGBIN/initdb" -D "$DADOS" -U postgres --auth=trust \
    --encoding=UTF8 --locale=C.UTF-8 >/dev/null
  como_dono "$PGBIN/pg_ctl" -D "$DADOS" -l "$LOG_SERVIDOR" -w \
    -o "-p $PORTA -k $BASE -c listen_addresses='' -c timezone=UTC -c wal_level=logical" start >/dev/null
}

export PGHOST="$BASE" PGPORT="$PORTA" PGUSER="postgres"

rodar_sql() {
  # -X: ignora ~/.psqlrc; ON_ERROR_STOP: o primeiro erro interrompe o arquivo
  # e devolve código diferente de zero.
  psql -X -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$1"
}

# Carga dos scripts: a saída (avisos do PostgreSQL, resultado do select
# final do 04) só aparece se der erro.
carregar_sql() {
  local registro="$BASE/carga.log"
  if PGOPTIONS="-c client_min_messages=warning" psql -X -q -v ON_ERROR_STOP=1 -d "$BANCO" -f "$1" >"$registro" 2>&1; then
    return 0
  fi
  sed 's/^/     /' "$registro"
  return 1
}

consulta() {
  psql -X -q -t -A -v ON_ERROR_STOP=1 -d "$BANCO" -c "$1"
}

if [ "$MODO" = "parar" ]; then
  parar
  echo "Servidor de testes desligado e $BASE apagado."
  exit 0
fi

if [ ! -x "$PGBIN/initdb" ]; then
  echo "FALHA: PostgreSQL não encontrado em $PGBIN (defina PGBIN)." >&2
  exit 1
fi

# Reexecutável: derruba o que tiver sobrado de uma execução anterior.
parar
if [ "$MODO" = "testar" ]; then
  trap parar EXIT
fi

echo "== Subindo PostgreSQL de testes (porta $PORTA, pasta $BASE)"
subir
psql -X -q -d postgres -c "create database $BANCO" >/dev/null

SCRIPTS=(
  "$RAIZ/supabase/01-estrutura.sql"
  "$RAIZ/supabase/02-seguranca.sql"
  "$RAIZ/supabase/03-tempo-real-agenda.sql"
  "$RAIZ/supabase/04-dados-iniciais.sql"
)

CONTAGEM_SQL="select (select count(*) from public.setores) || '/' ||
  (select count(*) from public.militares) || '/' ||
  (select count(*) from public.atividades) || '/' ||
  (select count(*) from public.atividade_responsaveis) || '/' ||
  (select count(*) from public.feriados) || '/' ||
  (select count(*) from public.configuracoes) || '/' ||
  (select count(*) from public.ocorrencias)"

falhas=0

echo "== Carregando a imitação do Supabase"
if ! carregar_sql "$AQUI/sql/00-stub-supabase.sql"; then
  echo "FALHA ao carregar 00-stub-supabase.sql"
  exit 1
fi

for passada in 1 2; do
  echo "== Carregando os scripts do banco (passada $passada de 2)"
  for arquivo in "${SCRIPTS[@]}"; do
    echo "   - $(basename "$arquivo")"
    if ! carregar_sql "$arquivo"; then
      echo "FALHA ao carregar $(basename "$arquivo") na passada $passada"
      exit 1
    fi
  done
  if [ "$passada" -eq 1 ]; then
    contagem_1="$(consulta "$CONTAGEM_SQL")"
    echo "   contagem setores/militares/atividades/responsáveis/feriados/configurações/ocorrências: $contagem_1"
  else
    contagem_2="$(consulta "$CONTAGEM_SQL")"
    if [ "$contagem_1" = "$contagem_2" ]; then
      echo "   ok - reexecução não duplicou nada ($contagem_2)"
    else
      echo "   FALHA - a reexecução mudou as contagens: $contagem_1 → $contagem_2"
      falhas=$((falhas + 1))
    fi
  fi
done

for teste in "$AQUI/sql/10-rls.sql" "$AQUI/sql/20-recorrencia.sql"; do
  echo "== Testes: $(basename "$teste")"
  if rodar_sql "$teste"; then
    echo "   ok - $(basename "$teste")"
  else
    echo "   FALHA - $(basename "$teste")"
    falhas=$((falhas + 1))
  fi
done

if [ "$MODO" = "manter" ]; then
  {
    echo "PGHOST=$BASE"
    echo "PGPORT=$PORTA"
    echo "PGDATABASE=$BANCO"
    echo "PGUSER=postgres"
  } > "$ARQ_CONEXAO"
  chmod 644 "$ARQ_CONEXAO"
  echo "== Servidor mantido no ar. Conexão gravada em $ARQ_CONEXAO:"
  sed 's/^/   /' "$ARQ_CONEXAO"
  echo "   (para desligar: $0 --parar)"
fi

echo
if [ "$falhas" -eq 0 ]; then
  echo "OK — todos os testes do banco passaram."
  exit 0
fi
echo "FALHA — $falhas etapa(s) com erro (veja acima)."
exit 1
