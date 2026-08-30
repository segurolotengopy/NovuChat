#!/usr/bin/env bash
# Sube el QR de demostración a la Cloud API y devuelve un media ID (30 días).
# Evita tener que publicar la imagen en una URL pública (Demo B).
# El media ID queda ligado al número que lo sube.
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1
[[ -f .env ]] || { echo "✗ Falta .env"; exit 1; }
set -a; source .env; set +a
IMG="${1:-Demo-Recursos/qr-demo.png}"
[[ -f "$IMG" ]] || { echo "✗ No existe $IMG"; exit 1; }

curl -s -X POST "https://graph.facebook.com/${WA_GRAPH_VERSION:-v26.0}/${WA_PHONE_ID}/media" \
  -H "Authorization: Bearer ${WA_TOKEN}" \
  -F "messaging_product=whatsapp" \
  -F "file=@${IMG};type=image/png" | python3 -m json.tool

echo
echo "Pegue el id en el nodo 'Enviar QR (imagen DEMO)' cambiando el origen de Link a ID."
