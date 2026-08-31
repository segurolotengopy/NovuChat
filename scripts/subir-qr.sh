#!/usr/bin/env bash
# Sube el QR de demostración a la Cloud API y devuelve un media ID (30 días).
# Evita tener que publicar la imagen en una URL pública (Demo B).
# El media ID queda ligado al número que lo sube.
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
set -a
# shellcheck disable=SC1090  # ruta variable: la elige --env
source "./$ENV_FILE"
set +a
IMG="${1:-Demo-Recursos/qr-demo.png}"
[[ -f "$IMG" ]] || { echo "✗ No existe $IMG"; exit 1; }

echo "Subiendo con el numero ${WA_PHONE_ID} (entorno ${ENV_FILE})."
echo "El media ID queda LIGADO a ese numero: otro no podra enviarlo."
echo
curl -s -X POST "https://graph.facebook.com/${WA_GRAPH_VERSION:-v26.0}/${WA_PHONE_ID}/media" \
  -H "Authorization: Bearer ${WA_TOKEN}" \
  -F "messaging_product=whatsapp" \
  -F "file=@${IMG};type=image/png" | python3 -m json.tool

echo
echo "Pegue el id en el nodo 'Enviar QR (imagen DEMO)' cambiando el origen de Link a ID."
