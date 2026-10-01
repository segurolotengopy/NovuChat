#!/usr/bin/env bash
# Envia una PLANTILLA de WhatsApp al numero registrado, sin pasar por n8n.
#
# Sirve para comprobar el unico camino que permite escribirle a alguien fuera
# de la ventana de 24 horas, que es de lo que dependen los recordatorios. Una
# plantilla aprobada se puede enviar en cualquier momento; un texto libre, no.
#
#   ./scripts/enviar-plantilla.sh                       # hello_world, en_US
#   ./scripts/enviar-plantilla.sh recordatorio_cita_manana es Ana Manicure 15:30
#   ./scripts/enviar-plantilla.sh --env .env.x hello_world en_US
#
# Los parametros posicionales despues del idioma rellenan las variables del
# cuerpo de la plantilla, en orden.
#
# APPS AJENAS (prohibiciones 5 y 7; revision de seguridad del #265): antes de
# mandar, `negar_app_ajena` corta si el token es de una app ajena o si no se
# sabe de que app es. El token va por la entrada estandar, no en los
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
case "$ENV_FILE" in /*) . "$ENV_FILE" ;; *) . "./$ENV_FILE" ;; esac
set +a
: "${WA_TOKEN:?Falta WA_TOKEN}"; : "${WA_PHONE_ID:?Falta WA_PHONE_ID}"; : "${WA_TO:?Falta WA_TO}"
G="https://graph.facebook.com/${WA_GRAPH_VERSION:-v26.0}"

PLANTILLA="${1:-hello_world}"
IDIOMA="${2:-en_US}"
shift 2 2>/dev/null || shift $#

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
PLANTILLA="$PLANTILLA" IDIOMA="$IDIOMA" WA_TO="$WA_TO" python3 - "$@" > "$TMP/plantilla.json" <<'PY'
import json, os, sys
variables = sys.argv[1:]
cuerpo = {
    "messaging_product": "whatsapp",
    "to": os.environ["WA_TO"],
    "type": "template",
    "template": {
        "name": os.environ["PLANTILLA"],
        "language": {"code": os.environ["IDIOMA"]},
    },
}
if variables:
    cuerpo["template"]["components"] = [{
        "type": "body",
        "parameters": [{"type": "text", "text": v} for v in variables],
    }]
print(json.dumps(cuerpo, ensure_ascii=False))
PY

negar_app_ajena "${WA_APP_ID:-}" numero
echo "Enviando plantilla '${PLANTILLA}' (${IDIOMA})…"
curl_token -s -X POST "${G}/${WA_PHONE_ID}/messages" \
  -H "Content-Type: application/json" \
  --data-binary @"$TMP/plantilla.json" | python3 -m json.tool
