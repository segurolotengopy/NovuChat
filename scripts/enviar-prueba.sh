#!/usr/bin/env bash
# Envía un mensaje de texto de prueba al número registrado, sin pasar por n8n.
# Aísla si el problema está en el canal de Meta o en el flujo.
# Requiere que usted le haya escrito al número en las últimas 24 h.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f .env ]] || { echo "✗ Falta .env"; exit 1; }
set -a; source .env; set +a
G="https://graph.facebook.com/${WA_GRAPH_VERSION:-v26.0}"
TEXTO="${1:-NovuChat: prueba de canal $(date +%H:%M).}"

curl -s -X POST "${G}/${WA_PHONE_ID}/messages" \
  -H "Authorization: Bearer ${WA_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"messaging_product\":\"whatsapp\",\"to\":\"${WA_TO}\",\"type\":\"text\",\"text\":{\"body\":$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$TEXTO")}}" \
  | python3 -m json.tool
