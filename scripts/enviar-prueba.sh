#!/usr/bin/env bash
# Envía un mensaje de texto de prueba al número registrado, sin pasar por n8n.
# Aísla si el problema está en el canal de Meta o en el flujo.
# Requiere que usted le haya escrito al número en las últimas 24 h.
#
#   ./scripts/enviar-prueba.sh                     # entorno .env (Demo A)
#   ./scripts/enviar-prueba.sh --env .env.x "texto"
#
# APPS AJENAS (prohibiciones 5 y 7; revisión de seguridad del #265): antes de
# mandar, `negar_app_ajena` corta si el token es de una app ajena o si no se
# sabe de qué app es. El token va por la entrada estándar, no en los
# argumentos de curl.
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1
ENV_FILE=".env"
while [[ "${1:-}" == --env* ]]; do
  case "$1" in
    --env)   ENV_FILE="${2:?--env necesita un archivo}"; shift 2 ;;
    --env=*) ENV_FILE="${1#*=}"; shift ;;
    *) echo "Opcion desconocida: $1" >&2; exit 2 ;;
  esac
done
[[ -f "$ENV_FILE" ]] || { echo "✗ Falta $ENV_FILE"; exit 1; }
# El candado de apps ajenas, ANTES del .env: queda readonly.
# shellcheck source=scripts/lib/apps-ajenas.sh
source scripts/lib/apps-ajenas.sh
set -a
# shellcheck disable=SC1090  # ruta variable: la elige --env
case "$ENV_FILE" in /*) source "$ENV_FILE" ;; *) source "./$ENV_FILE" ;; esac
set +a
: "${WA_TOKEN:?Falta WA_TOKEN}"; : "${WA_PHONE_ID:?Falta WA_PHONE_ID}"; : "${WA_TO:?Falta WA_TO}"
G="https://graph.facebook.com/${WA_GRAPH_VERSION:-v26.0}"
TEXTO="${1:-NovuChat: prueba de canal $(date +%H:%M).}"

negar_app_ajena "${WA_APP_ID:-}" numero
curl_token -s -X POST "${G}/${WA_PHONE_ID}/messages" \
  -H "Content-Type: application/json" \
  -d "{\"messaging_product\":\"whatsapp\",\"to\":\"${WA_TO}\",\"type\":\"text\",\"text\":{\"body\":$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$TEXTO")}}" \
  | python3 -m json.tool
