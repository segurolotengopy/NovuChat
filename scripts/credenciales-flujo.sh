#!/usr/bin/env bash
# Muestra, nodo por nodo, QUÉ credencial (tipo, id y nombre) usa un flujo vivo
# en n8n. Nunca valores: la API pública no los devuelve, y este script no los
# pide. Sirve para comprobar, después de importar, que ningún nodo quedó con
# la credencial de otro cliente (memoria del 15/09/2026: la de ingesta quedó
# en los nodos que envían a Meta) y para comparar dos flujos entre sí.
#
#   ./scripts/credenciales-flujo.sh --env .env.platinum
#   ./scripts/credenciales-flujo.sh --env .env --flujo-id d78q7JmKIYVn4YkL
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1
ENV_FILE=".env"; FID=""
while [ $# -gt 0 ]; do
  case "$1" in
    --env)      ENV_FILE="$2"; shift 2 ;;
    --flujo-id) FID="$2"; shift 2 ;;
    *) echo "Argumento desconocido: $1" >&2; exit 2 ;;
  esac
done
[ -f "$ENV_FILE" ] || { echo "✗ Falta $ENV_FILE" >&2; exit 1; }
set -a
# shellcheck disable=SC1090  # ruta variable: la elige un argumento
source "$ENV_FILE"
set +a
: "${N8N_BASE_URL:?}" "${N8N_API_KEY:?}"
FID="${FID:-${N8N_WORKFLOW_ID:?Falta --flujo-id o N8N_WORKFLOW_ID}}"
curl -s --max-time 30 -H "X-N8N-API-KEY: $N8N_API_KEY" "${N8N_BASE_URL%/}/api/v1/workflows/$FID" | python3 -c "
import json, sys
w = json.load(sys.stdin)
if 'nodes' not in w: print('✗', w.get('message', w)); sys.exit(1)
print(f\"{w['name']}  ·  activo: {w.get('active')}  ·  {len(w['nodes'])} nodos\")
for n in w['nodes']:
    for tipo, c in (n.get('credentials') or {}).items():
        print(f\"  {n['name']:<32} {tipo:<26} id={c.get('id','')}  «{c.get('name','')}»\")
"
