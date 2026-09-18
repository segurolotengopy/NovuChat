#!/usr/bin/env bash
# =============================================================================
# webhook-meta.sh — el rodeo para dar de alta el webhook de un cliente en Meta.
#
# POR QUÉ EXISTE (memoria del 16/09/2026, alta de Platinum). Meta solo acepta
# una URL de webhook si un GET con hub.mode, hub.verify_token y hub.challenge
# devuelve ESE challenge y nada más. El nodo WhatsApp Trigger de n8n 2.36.5
# contesta {"message":"Webhook call received"} y Meta rechaza con
# «(#2201) response does not match challenge». GUIA-META-NOVUCHAT.md §9.3 dice
# lo contrario y es falso.
#
# EL RODEO. Durante unos segundos, la MISMA ruta la atiende un flujo temporal
# de dos nodos: Webhook (GET, responseNode) → Respond to Webhook (el
# challenge). Con el alta hecha en Meta, se borra el temporal y se activa el
# flujo del cliente. Meta no vuelve a verificar mientras la URL no cambie.
#
#   ./scripts/webhook-meta.sh --preparar --webhook-id <uuid> --flujo-id <id>
#       crea y activa el temporal; el flujo del cliente queda inactivo
#   ./scripts/webhook-meta.sh --cerrar   --webhook-id <uuid> --flujo-id <id>
#       borra el temporal y activa el flujo del cliente
#   ./scripts/webhook-meta.sh --probar   --webhook-id <uuid>
#       hace el GET que hace Meta y muestra qué contesta la ruta
#
# Lee N8N_BASE_URL y N8N_API_KEY de .env (o --env-n8n). No imprime valores.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1

MODO=""; WH=""; FID=""; ENV_N8N=".env"; ENV_CLIENTE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --preparar)    MODO="preparar"; shift ;;
    --cerrar)      MODO="cerrar"; shift ;;
    --probar)      MODO="probar"; shift ;;
    --alta-meta)   MODO="alta-meta"; shift ;;
    --webhook-id)  WH="$2"; shift 2 ;;
    --flujo-id)    FID="$2"; shift 2 ;;
    --env-n8n)     ENV_N8N="$2"; shift 2 ;;
    --env-cliente) ENV_CLIENTE="$2"; shift 2 ;;
    *) echo "Argumento desconocido: $1" >&2; exit 2 ;;
  esac
done

# --alta-meta: registra la URL en la APP por la Graph API, sin pasar por la
# pantalla de Meta (que el 18/09 contestaba «#1004 An error occurred» sin
# siquiera llamar a la URL). Usa el app access token APPID|APPSECRET, que sale
# del .env del cliente y no se imprime. El verify token va en META_VERIFY_TOKEN.
if [ "$MODO" = "alta-meta" ]; then
  [ -n "$WH" ] && [ -n "$ENV_CLIENTE" ] && [ -f "$ENV_CLIENTE" ] || { echo "Uso: --alta-meta --webhook-id <uuid> --env-cliente <.env.x>" >&2; exit 2; }
  [ -f "$ENV_N8N" ] || { echo "✗ Falta $ENV_N8N" >&2; exit 1; }
  set -a; . "$ENV_N8N"; . "$ENV_CLIENTE"; set +a
  : "${N8N_BASE_URL:?}" "${WA_APP_ID:?}" "${WA_APP_SECRET:?}"
  VT="${META_VERIFY_TOKEN:-}"; [ -n "$VT" ] || { echo "✗ Falta META_VERIFY_TOKEN en el entorno" >&2; exit 2; }
  URL="${N8N_BASE_URL%/}/webhook/$WH/webhook"
  G="https://graph.facebook.com/${WA_GRAPH_VERSION:-v26.0}"
  echo "Alta del webhook en la app …${WA_APP_ID: -4}:"
  echo "  callback_url: $URL"
  echo "  fields: messages, account_update"
  R=$(curl -s --max-time 60 -X POST "$G/$WA_APP_ID/subscriptions" \
        --data-urlencode "object=whatsapp_business_account" \
        --data-urlencode "callback_url=$URL" \
        --data-urlencode "verify_token=$VT" \
        --data-urlencode "fields=messages,account_update" \
        --data-urlencode "access_token=${WA_APP_ID}|${WA_APP_SECRET}")
  echo "  respuesta: $R"
  echo "Suscripciones vigentes de la app:"
  curl -s --max-time 30 "$G/$WA_APP_ID/subscriptions?access_token=${WA_APP_ID}|${WA_APP_SECRET}" \
    | python3 -c "
import json,sys; d=json.load(sys.stdin)
for s in d.get('data',[]): print('  ', s.get('object'), '→', s.get('callback_url'), '· activo:', s.get('active'), '· campos:', [f.get('name') for f in s.get('fields',[])])
if 'error' in d: print('  ERROR:', d['error'].get('message'))"
  exit 0
fi
[ -n "$MODO" ] && [ -n "$WH" ] || { echo "Uso: --preparar|--cerrar|--probar --webhook-id <uuid> [--flujo-id <id>]" >&2; exit 2; }
[ -f "$ENV_N8N" ] || { echo "✗ Falta $ENV_N8N" >&2; exit 1; }
set -a; . "$ENV_N8N"; set +a
: "${N8N_BASE_URL:?}" "${N8N_API_KEY:?}"
BASE="${N8N_BASE_URL%/}"; API="$BASE/api/v1"
URL="$BASE/webhook/$WH/webhook"
NOMBRE_TMP="TEMPORAL desafío Meta $WH"

api() { # metodo ruta [cuerpo]
  if [ $# -ge 3 ]; then
    curl -s --max-time 60 -X "$1" -H "X-N8N-API-KEY: $N8N_API_KEY" -H "Content-Type: application/json" -d "$3" "$API$2"
  else
    curl -s --max-time 60 -X "$1" -H "X-N8N-API-KEY: $N8N_API_KEY" "$API$2"
  fi
}
id_temporal() { api GET "/workflows?limit=250" | python3 -c "
import json,sys; d=json.load(sys.stdin).get('data',[])
print(next((w['id'] for w in d if w['name']=='$NOMBRE_TMP'),''))"; }
probar() {
  echo "GET $URL?hub.mode=subscribe&hub.verify_token=x&hub.challenge=12345"
  R=$(curl -s --max-time 20 -w '\n%{http_code}' "$URL?hub.mode=subscribe&hub.verify_token=x&hub.challenge=12345" || true)
  echo "  código: $(echo "$R" | tail -1) · cuerpo: $(echo "$R" | head -1)"
  [ "$(echo "$R" | head -1)" = "12345" ] && echo "  ✓ la ruta devuelve el desafío: Meta va a aceptar la URL" || echo "  ✗ no devuelve el desafío tal cual"
}

case "$MODO" in
  probar) probar ;;
  preparar)
    [ -n "$FID" ] || { echo "✗ --flujo-id es obligatorio" >&2; exit 2; }
    ACT=$(api GET "/workflows/$FID" | python3 -c "import json,sys; print(json.load(sys.stdin).get('active'))")
    [ "$ACT" = "False" ] || { echo "✗ El flujo del cliente $FID está activo o no existe (active=$ACT): la ruta no está libre" >&2; exit 1; }
    if [ -n "$(id_temporal)" ]; then echo "= El temporal ya existe"; else
      CUERPO=$(python3 - <<PY
import json
print(json.dumps({
 "name": "$NOMBRE_TMP",
 "nodes": [
  {"parameters": {"httpMethod": "GET", "path": "$WH/webhook", "responseMode": "responseNode", "options": {}},
   "id": "wh-tmp-1", "name": "Webhook", "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [0, 0],
   "webhookId": "$WH"},
  {"parameters": {"respondWith": "text", "responseBody": "={{ \$json.query[\"hub.challenge\"] }}", "options": {}},
   "id": "wh-tmp-2", "name": "Respond to Webhook", "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1.1, "position": [300, 0]}
 ],
 "connections": {"Webhook": {"main": [[{"node": "Respond to Webhook", "type": "main", "index": 0}]]}},
 "settings": {"executionOrder": "v1"}
}))
PY
)
      TID=$(api POST "/workflows" "$CUERPO" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id') or ('ERROR: '+str(d)))")
      case "$TID" in ERROR*) echo "✗ $TID" >&2; exit 1 ;; esac
      echo "+ Temporal creado: $TID"
    fi
    TID=$(id_temporal)
    api POST "/workflows/$TID/activate" >/dev/null && echo "✓ Temporal ACTIVO en la ruta del cliente"
    sleep 2; probar
    echo; echo "AHORA, en Meta (WhatsApp → Configuración → Webhook → Editar):"
    echo "  URL de devolución de llamada: $URL"
    echo "  Token de verificación: el que inventó Andres (cualquiera: el temporal no lo comprueba)"
    echo "  Verificar y guardar → Administrar → suscribir messages (y account_update)."
    echo "Después: $0 --cerrar --webhook-id $WH --flujo-id $FID"
    ;;
  cerrar)
    [ -n "$FID" ] || { echo "✗ --flujo-id es obligatorio" >&2; exit 2; }
    TID=$(id_temporal)
    if [ -n "$TID" ]; then
      api POST "/workflows/$TID/deactivate" >/dev/null || true
      api DELETE "/workflows/$TID" >/dev/null && echo "- Temporal $TID borrado"
    else echo "= No había temporal"; fi
    api POST "/workflows/$FID/activate" | python3 -c "
import json,sys; d=json.load(sys.stdin)
print('✓ Flujo del cliente ACTIVO:', d.get('name')) if d.get('active') else print('✗ No se activó:', d.get('message', d))"
    sleep 2; probar
    echo "(Que ahora NO devuelva el desafío es lo esperado: Meta ya no lo pide mientras la URL no cambie.)"
    ;;
esac
