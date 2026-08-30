#!/usr/bin/env bash
# Envia una PLANTILLA de WhatsApp al numero registrado, sin pasar por n8n.
#
# Sirve para comprobar el unico camino que permite escribirle a alguien fuera
# de la ventana de 24 horas, que es de lo que dependen los recordatorios. Una
# plantilla aprobada se puede enviar en cualquier momento; un texto libre, no.
#
#   ./scripts/enviar-plantilla.sh                       # hello_world, en_US
#   ./scripts/enviar-plantilla.sh recordatorio_cita_manana es Ana Manicure 15:30
#
# Los parametros posicionales despues del idioma rellenan las variables del
# cuerpo de la plantilla, en orden.
set -euo pipefail

cd "$(dirname "$0")/.."
[[ -f .env ]] || { echo "✗ Falta .env"; exit 1; }
set -a; . ./.env; set +a
: "${WA_TOKEN:?Falta WA_TOKEN}"; : "${WA_PHONE_ID:?Falta WA_PHONE_ID}"; : "${WA_TO:?Falta WA_TO}"
G="https://graph.facebook.com/${WA_GRAPH_VERSION:-v26.0}"

PLANTILLA="${1:-hello_world}"
IDIOMA="${2:-en_US}"
shift 2 2>/dev/null || shift $#

PLANTILLA="$PLANTILLA" IDIOMA="$IDIOMA" WA_TO="$WA_TO" python3 - "$@" > /tmp/plantilla.json <<'PY'
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

echo "Enviando plantilla '${PLANTILLA}' (${IDIOMA})…"
curl -s -X POST "${G}/${WA_PHONE_ID}/messages" \
  -H "Authorization: Bearer ${WA_TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary @/tmp/plantilla.json | python3 -m json.tool
rm -f /tmp/plantilla.json
