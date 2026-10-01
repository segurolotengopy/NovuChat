#!/usr/bin/env bash
# Sube el QR de demostración a la Cloud API y devuelve un media ID (30 días).
# Evita tener que publicar la imagen en una URL pública (Demo B).
# El media ID queda ligado al número que lo sube.
#
# APPS AJENAS (prohibiciones 5 y 7; revisión de seguridad del #265): antes de
# subir, `negar_app_ajena` corta si el token es de una app ajena o si no se
# sabe de qué app es. El token va por la entrada estándar, no en los
# argumentos de curl.
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1
ENV_FILE=".env"
while [[ "${1:-}" == --env* ]]; do
  case "$1" in
    --env)   ENV_FILE="${2:?--env necesita un archivo}"; shift 2 ;;
    --env=*) ENV_FILE="${1#*=}"; shift ;;
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
: "${WA_TOKEN:?Falta WA_TOKEN}"; : "${WA_PHONE_ID:?Falta WA_PHONE_ID}"
G="https://graph.facebook.com/${WA_GRAPH_VERSION:-v26.0}"
IMG="${1:-Demo-Recursos/qr-demo.png}"
[[ -f "$IMG" ]] || { echo "✗ No existe $IMG"; exit 1; }

negar_app_ajena "${WA_APP_ID:-}" numero
echo "Subiendo con el numero ${WA_PHONE_ID} (entorno ${ENV_FILE})."
echo "El media ID queda LIGADO a ese numero: otro no podra enviarlo."
echo
curl_token -s -X POST "${G}/${WA_PHONE_ID}/media" \
  -F "messaging_product=whatsapp" \
  -F "file=@${IMG};type=image/png" | python3 -m json.tool

echo
echo "Pegue el id en el nodo 'Enviar QR (imagen DEMO)' cambiando el origen de Link a ID."
