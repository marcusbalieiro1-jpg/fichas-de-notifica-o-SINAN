#!/usr/bin/env bash
# =========================================================================
# HABE · AQS e NSP — TODOS os testes da ferramenta, em sequência
#
#   1. banco (PostgreSQL local): testes/executar-sql.sh --manter
#      (estrutura, RLS, gatilhos, RPCs, recorrência; deixa o banco no ar)
#   2. node testes/regras.mjs            regras puras e recorrência (JS)
#   3. node testes/contrato-api.mjs      fachada Api + modo demonstração
#   4. node testes/api-supabase.mjs      adaptador real com Supabase falso
#   5. node testes/paridade-recorrencia.mjs   JS × SQL, no banco do passo 1
#   6. node testes/edge-logica.mjs       lógica da Edge Function admin-usuarios
#   7. node testes/e2e-demo.mjs          navegador de verdade (Playwright),
#                                        computador e celular, CSP rígida
#   8. testes/executar-sql.sh --parar    SEMPRE (trap), mesmo com falha
#
# Uso (na pasta aqs-nsp ou de qualquer lugar):
#   testes/executar.sh                  roda tudo
#   AQS_CAPTURAS=/pasta testes/executar.sh   onde o e2e grava as capturas
#   AQS_E2E_ARGS=--docs testes/executar.sh   o e2e também atualiza docs/capturas
#
# Requisitos: Node 22, PostgreSQL 16 (PGBIN, padrão /usr/lib/postgresql/16/bin)
# e psql; Playwright + Chromium e http-server para o e2e (ver o topo de
# testes/e2e-demo.mjs). Como root, o PostgreSQL roda como o usuário
# "postgres" (executar-sql.sh cuida disso).
#
# Código de saída: 0 = tudo passou; 1 = alguma etapa falhou.
# =========================================================================
set -uo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/.." && pwd)"
cd "$RAIZ" || exit 1

BASE_PG="${AQS_PG_BASE:-/tmp/aqs-nsp-pg}"
export AQS_PG_BASE="$BASE_PG"

declare -a RESUMO=()
FALHAS=0
INICIO_GERAL=$(date +%s)

parar_banco() {
  "$AQUI/executar-sql.sh" --parar >/dev/null 2>&1 || true
}
# O banco de testes nunca fica no ar depois daqui — nem com falha, nem com
# Ctrl+C.
trap parar_banco EXIT
trap 'echo; echo "Interrompido."; exit 130' INT TERM

etapa() {
  local nome="$1"
  shift
  local inicio fim codigo
  echo
  echo "=================================================================="
  echo "== $nome"
  echo "=================================================================="
  inicio=$(date +%s)
  "$@"
  codigo=$?
  fim=$(date +%s)
  if [ "$codigo" -eq 0 ]; then
    RESUMO+=("ok     $nome ($((fim - inicio)) s)")
  else
    RESUMO+=("FALHA  $nome (código $codigo, $((fim - inicio)) s)")
    FALHAS=$((FALHAS + 1))
  fi
}

# Node 22.6 a 22.17 só removem os tipos do TypeScript (logica.ts) com a
# flag; do 22.18 em diante é o padrão.
FLAG_TS=""
if [ "$(node -p 'process.features.typescript || ""' 2>/dev/null)" = "" ]; then
  FLAG_TS="--experimental-strip-types"
fi

etapa "banco: executar-sql.sh --manter" "$AQUI/executar-sql.sh" --manter

# A paridade usa o banco que acabou de subir; sem ele, é falha (não "pulado").
export AQS_EXIGIR_BANCO=1
if [ -f "$BASE_PG/conexao.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$BASE_PG/conexao.env"
  set +a
fi

etapa "regras.mjs" node testes/regras.mjs
etapa "contrato-api.mjs" node testes/contrato-api.mjs
etapa "api-supabase.mjs" node testes/api-supabase.mjs
etapa "paridade-recorrencia.mjs" node testes/paridade-recorrencia.mjs
# shellcheck disable=SC2086
etapa "edge-logica.mjs${FLAG_TS:+ ($FLAG_TS)}" node $FLAG_TS testes/edge-logica.mjs
# shellcheck disable=SC2086
etapa "e2e-demo.mjs" node testes/e2e-demo.mjs ${AQS_E2E_ARGS:-}

etapa "banco: executar-sql.sh --parar" "$AQUI/executar-sql.sh" --parar

echo
echo "=================================================================="
echo "== Resumo ($(($(date +%s) - INICIO_GERAL)) s)"
echo "=================================================================="
for linha in "${RESUMO[@]}"; do
  echo "   $linha"
done
echo
if [ "$FALHAS" -eq 0 ]; then
  echo "OK — todas as ${#RESUMO[@]} etapas passaram."
  exit 0
fi
echo "FALHA — $FALHAS de ${#RESUMO[@]} etapas falharam (veja acima)."
exit 1
