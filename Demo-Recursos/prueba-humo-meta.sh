#!/usr/bin/env bash
# ============================================================================
# NovuChat — Prueba de humo del número de Meta (Bloques 2-4 de la guía)
# Verifica desde la terminal que el número de prueba envía mensajes, ANTES
# de conectar n8n. No usa n8n ni toca los flujos.
#
# USO:
#   1. Copie este archivo junto a un archivo  .env.meta  (NO versionar) con:
#        WA_TOKEN=EAAxxxx...          # temporal (24 h) o permanente (Bloque 4)
#        WA_PHONE_ID=109xxxxxxxxxxx   # PHONE_NUMBER_ID del Bloque 2
#        WA_TO=59170000000            # destinatario registrado, SOLO dígitos
#        WA_GRAPH_VERSION=v26.0
#   2. chmod +x prueba-humo-meta.sh && ./prueba-humo-meta.sh
#
# El .env.meta vive junto al gestor de contraseñas, nunca en Git
# (criterio D-15). Este script no imprime el token.
# ============================================================================
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${DIR}/.env.meta"
[[ -f "$ENV_FILE" ]] || { echo "✗ Falta ${ENV_FILE} (ver cabecera del script)"; exit 1; }
set -a
# shellcheck disable=SC1090  # ruta variable: es el objetivo del script
source "$ENV_FILE"
set +a

for v in WA_TOKEN WA_PHONE_ID WA_TO; do
  [[ -n "${!v:-}" ]] || { echo "✗ Falta la variable $v en .env.meta"; exit 1; }
done
WA_GRAPH_VERSION="${WA_GRAPH_VERSION:-v26.0}"

[[ "$WA_TO" =~ ^[0-9]+$ ]] || { echo "✗ WA_TO debe ser solo dígitos, sin '+' (#100)"; exit 1; }

URL="https://graph.facebook.com/${WA_GRAPH_VERSION}/${WA_PHONE_ID}/messages"
echo "→ Endpoint: ${URL}"
echo "→ Destinatario: ${WA_TO}"
echo

echo "== Prueba 1: plantilla hello_world (siempre permitida en el número de prueba) =="
R1=$(curl -sS -X POST "$URL" \
  -H "Authorization: Bearer ${WA_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"messaging_product":"whatsapp","to":"'"${WA_TO}"'","type":"template",
       "template":{"name":"hello_world","language":{"code":"en_US"}}}')
echo "$R1" | python3 -m json.tool || echo "$R1"
echo "$R1" | grep -q '"message_status"\|"messages"' \
  && echo "✓ Aceptado por Meta — revise que llegó al celular" \
  || { echo "✗ Revise el error de arriba (tabla del Bloque 3 de la guía)"; exit 1; }
echo

echo "== Prueba 2: texto libre (requiere ventana de 24 h abierta) =="
echo "   Primero envíe cualquier mensaje DESDE el celular ${WA_TO} al número de"
echo "   prueba (eso abre la ventana). Enter para continuar, Ctrl+C para saltar."
read -r
R2=$(curl -sS -X POST "$URL" \
  -H "Authorization: Bearer ${WA_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"messaging_product":"whatsapp","to":"'"${WA_TO}"'","type":"text",
       "text":{"body":"NovuChat: prueba de humo OK — texto libre dentro de la ventana de servicio."}}')
echo "$R2" | python3 -m json.tool || echo "$R2"
if echo "$R2" | grep -q '131047'; then
  echo "✗ (#131047) La ventana de 24 h no está abierta: escriba primero desde el celular."
elif echo "$R2" | grep -q '"messages"'; then
  echo "✓ Texto libre aceptado — la cadena completa del demo funciona."
fi
echo
echo "Siguiente paso: Bloque 5 de GUIA-META-NOVUCHAT.md (credenciales en n8n)."
