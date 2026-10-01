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
#   ./scripts/webhook-meta.sh --ver-meta --env-cliente <.env.x>
#       SOLO LEE: muestra a qué URL apunta hoy el webhook de la app del
#       entorno. Existe (24/09/2026) porque una app de Meta tiene UNA sola URL
#       de webhook: darla de alta en una app que ya atiende a otro producto le
#       quita el webhook a ese producto. Se mira antes de --alta-meta.
#   ./scripts/webhook-meta.sh --ver-waba --env-cliente <.env.x>
#       SOLO LEE: qué apps están suscritas a la WABA del entorno y si alguna
#       tiene una URL propia (`override_callback_uri`).
#   ./scripts/webhook-meta.sh --alta-waba --webhook-id <uuid> --env-cliente <.env.x>
#       EL WEBHOOK A NIVEL DE WABA (24/09/2026, Tech Provider). Meta permite que
#       UNA WABA tenga su propia URL por encima de la de la app
#       (POST /{WABA}/subscribed_apps con override_callback_uri y verify_token;
#       la app tiene que estar ya suscrita a la WABA). Solo van por ahí los
#       mensajes de esa WABA; los eventos de plantillas y de cuenta siguen a la
#       URL de la app. Meta verifica la URL con el mismo desafío: el rodeo
#       --preparar / --cerrar aplica igual. Usa WA_TOKEN y WABA_ID del entorno.
#       Se escribió pensando en AAB1-WA-Prod; desde el receptor de clientes
#       (28/09) eso está PROHIBIDO: la URL de una WABA suscrita a esa app es el
#       destino del receptor, y la cambia solo WhatsApp-Modular (prohibición 5).
#
# APPS AJENAS (prohibiciones 5 y 7 de CLAUDE.md; revisión de seguridad del
# PR #264). --alta-meta y --alta-waba escriben con la app que traiga el .env,
# y el comando no la nombra: un .env con el WA_APP_ID de AAB1-WA-Prod
# reescribiría el webhook de toda esa app (tumba el OTP de SeguroLoTengo y el
# receptor de clientes). El gancho de acciones sensibles no lo puede ver. Antes
# de cualquier POST, `negar_app_ajena` (scripts/lib/apps-ajenas.sh, compartida
# con verificar-meta.sh) corta en dos capas: la huella del id (sin red) y el
# nombre que devuelve Graph. Si Graph no contesta nombre e id, también corta:
# sin saber qué app es, no se escribe.
#
# NINGÚN SECRETO EN LOS ARGUMENTOS DE CURL (revisión de seguridad del #265,
# LOW-B): ahí los ve cualquier usuario de la máquina en `ps`. El token y el
# app access token van por la entrada estándar (`curl_token`, `-H @-`); el
# verify token, dentro de un cuerpo escrito en un directorio privado (700) que
# se borra al salir; la clave de n8n, también por la entrada estándar.
#
# Lee N8N_BASE_URL y N8N_API_KEY de .env (o --env-n8n). No imprime valores.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1

# El candado de apps ajenas (huellas, nombres, negar_app_ajena), ANTES de
# cargar cualquier .env: queda readonly y un .env no lo puede redefinir.
# shellcheck source=scripts/lib/apps-ajenas.sh
source scripts/lib/apps-ajenas.sh

# Los cuerpos con el verify token, en un directorio 700 que se borra al salir.
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

MODO=""; WH=""; FID=""; ENV_N8N=".env"; ENV_CLIENTE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --preparar)    MODO="preparar"; shift ;;
    --cerrar)      MODO="cerrar"; shift ;;
    --probar)      MODO="probar"; shift ;;
    --alta-meta)   MODO="alta-meta"; shift ;;
    --ver-meta)    MODO="ver-meta"; shift ;;
    --ver-waba)    MODO="ver-waba"; shift ;;
    --alta-waba)   MODO="alta-waba"; shift ;;
    --webhook-id)  WH="$2"; shift 2 ;;
    --flujo-id)    FID="$2"; shift 2 ;;
    --env-n8n)     ENV_N8N="$2"; shift 2 ;;
    --env-cliente) ENV_CLIENTE="$2"; shift 2 ;;
    *) echo "Argumento desconocido: $1" >&2; exit 2 ;;
  esac
done

# --ver-waba y --alta-waba: la suscripción de la WABA, con el token de usuario
# de sistema del entorno. Lo que se imprime: app, campos y URL propia; nunca
# el token ni el verify token.
if [ "$MODO" = "ver-waba" ] || [ "$MODO" = "alta-waba" ]; then
  [ -n "$ENV_CLIENTE" ] && [ -f "$ENV_CLIENTE" ] || { echo "Uso: --ver-waba|--alta-waba --env-cliente <.env.x> [--webhook-id <uuid>]" >&2; exit 2; }
  [ -f "$ENV_N8N" ] || { echo "✗ Falta $ENV_N8N" >&2; exit 1; }
  set -a
  # shellcheck disable=SC1090  # ruta variable: la elige un argumento
  source "$ENV_N8N"
  # shellcheck disable=SC1090  # ruta variable: la elige un argumento
  source "$ENV_CLIENTE"
  set +a
  : "${WA_TOKEN:?}" "${WABA_ID:?}" "${WA_APP_ID:?}"
  G="https://graph.facebook.com/${WA_GRAPH_VERSION:-v26.0}"
  mostrar_waba() {
    curl_token -s --max-time 30 "$G/$WABA_ID/subscribed_apps" \
      | python3 -c "
import json,sys; d=json.load(sys.stdin)
if 'error' in d: print('  ERROR:', d['error'].get('message')); sys.exit(1)
if not d.get('data'): print('  (ninguna app suscrita a esta WABA)')
for s in d.get('data',[]):
    a=s.get('whatsapp_business_api_data',{})
    print('  app', a.get('name','?'), '…'+str(a.get('id',''))[-4:], '· URL propia de la WABA:', s.get('override_callback_uri') or '(ninguna: usa la de la app)')"
  }
  if [ "$MODO" = "ver-waba" ]; then
    echo "Apps suscritas a la WABA …${WABA_ID: -4}:"; mostrar_waba; exit 0
  fi
  [ -n "$WH" ] || { echo "✗ --alta-waba necesita --webhook-id" >&2; exit 2; }
  : "${N8N_BASE_URL:?}"
  VT="${META_VERIFY_TOKEN:-}"; [ -n "$VT" ] || { echo "✗ Falta META_VERIFY_TOKEN en el entorno" >&2; exit 2; }
  URL="${N8N_BASE_URL%/}/webhook/$WH/webhook"
  negar_app_ajena "$WA_APP_ID" token
  echo "Webhook PROPIO de la WABA …${WABA_ID: -4} (la URL de la app …${WA_APP_ID: -4} no se toca):"
  echo "  override_callback_uri: $URL"
  # El verify token pasa a python por el entorno (/proc/<pid>/environ es solo
  # del dueño; los argumentos, de todos) y el cuerpo, por un archivo.
  URL="$URL" VT="$VT" python3 -c "import json,os; print(json.dumps({'override_callback_uri': os.environ['URL'], 'verify_token': os.environ['VT']}))" > "$TMP/cuerpo.json"
  R=$(curl_token -s --max-time 60 -X POST "$G/$WABA_ID/subscribed_apps" \
        -H "Content-Type: application/json" --data-binary @"$TMP/cuerpo.json")
  echo "  respuesta: $R"
  echo "Suscripciones vigentes de la WABA:"; mostrar_waba
  exit 0
fi

# --ver-meta: el GET de suscripciones de la app, con el app access token
# APPID|APPSECRET del .env del cliente. No escribe nada y no imprime valores:
# solo la URL de devolución de llamada, si está activa y qué campos tiene.
if [ "$MODO" = "ver-meta" ]; then
  [ -n "$ENV_CLIENTE" ] && [ -f "$ENV_CLIENTE" ] || { echo "Uso: --ver-meta --env-cliente <.env.x>" >&2; exit 2; }
  set -a
  # shellcheck disable=SC1090  # ruta variable: la elige un argumento
  source "$ENV_CLIENTE"
  set +a
  : "${WA_APP_ID:?}" "${WA_APP_SECRET:?WA_APP_SECRET no está en $ENV_CLIENTE: sin él no hay app access token}"
  G="https://graph.facebook.com/${WA_GRAPH_VERSION:-v26.0}"
  echo "Suscripciones de webhook de la app …${WA_APP_ID: -4}:"
  command curl -s --max-time 30 -H @- "$G/$WA_APP_ID/subscriptions" <<<"Authorization: Bearer ${WA_APP_ID}|${WA_APP_SECRET}" \
    | python3 -c "
import json,sys; d=json.load(sys.stdin)
if 'error' in d: print('  ERROR:', d['error'].get('message')); sys.exit(1)
if not d.get('data'): print('  (ninguna: la app no tiene webhook dado de alta)')
for s in d.get('data',[]): print('  ', s.get('object'), '→', s.get('callback_url'), '· activo:', s.get('active'), '· campos:', [f.get('name') for f in s.get('fields',[])])"
  exit 0
fi

# --alta-meta: registra la URL en la APP por la Graph API, sin pasar por la
# pantalla de Meta (que el 18/09 contestaba «#1004 An error occurred» sin
# siquiera llamar a la URL). Usa el app access token APPID|APPSECRET, que sale
# del .env del cliente y no se imprime. El verify token va en META_VERIFY_TOKEN.
if [ "$MODO" = "alta-meta" ]; then
  [ -n "$WH" ] && [ -n "$ENV_CLIENTE" ] && [ -f "$ENV_CLIENTE" ] || { echo "Uso: --alta-meta --webhook-id <uuid> --env-cliente <.env.x>" >&2; exit 2; }
  [ -f "$ENV_N8N" ] || { echo "✗ Falta $ENV_N8N" >&2; exit 1; }
  set -a
  # shellcheck disable=SC1090  # ruta variable: la elige un argumento
  source "$ENV_N8N"
  # shellcheck disable=SC1090  # ruta variable: la elige un argumento
  source "$ENV_CLIENTE"
  set +a
  : "${N8N_BASE_URL:?}" "${WA_APP_ID:?}" "${WA_APP_SECRET:?}"
  VT="${META_VERIFY_TOKEN:-}"; [ -n "$VT" ] || { echo "✗ Falta META_VERIFY_TOKEN en el entorno" >&2; exit 2; }
  URL="${N8N_BASE_URL%/}/webhook/$WH/webhook"
  G="https://graph.facebook.com/${WA_GRAPH_VERSION:-v26.0}"
  negar_app_ajena "$WA_APP_ID" app
  echo "Alta del webhook en la app …${WA_APP_ID: -4}:"
  echo "  callback_url: $URL"
  echo "  fields: messages, account_update"
  # El app access token va en la cabecera, leída de la entrada estándar, y el
  # verify token en el cuerpo, en un archivo: en los argumentos de curl se
  # verían en `ps` (revisión de seguridad del #265). --data-binary manda el
  # mismo application/x-www-form-urlencoded que --data-urlencode.
  URL="$URL" VT="$VT" python3 -c "import os,sys,urllib.parse; sys.stdout.write(urllib.parse.urlencode({'object': 'whatsapp_business_account', 'callback_url': os.environ['URL'], 'verify_token': os.environ['VT'], 'fields': 'messages,account_update'}))" > "$TMP/cuerpo.txt"
  R=$(command curl -s --max-time 60 -X POST "$G/$WA_APP_ID/subscriptions" -H @- \
        --data-binary @"$TMP/cuerpo.txt" \
        <<<"Authorization: Bearer ${WA_APP_ID}|${WA_APP_SECRET}")
  echo "  respuesta: $R"
  echo "Suscripciones vigentes de la app:"
  command curl -s --max-time 30 -H @- "$G/$WA_APP_ID/subscriptions" <<<"Authorization: Bearer ${WA_APP_ID}|${WA_APP_SECRET}" \
    | python3 -c "
import json,sys; d=json.load(sys.stdin)
for s in d.get('data',[]): print('  ', s.get('object'), '→', s.get('callback_url'), '· activo:', s.get('active'), '· campos:', [f.get('name') for f in s.get('fields',[])])
if 'error' in d: print('  ERROR:', d['error'].get('message'))"
  exit 0
fi
[ -n "$MODO" ] && [ -n "$WH" ] || { echo "Uso: --preparar|--cerrar|--probar --webhook-id <uuid> [--flujo-id <id>]" >&2; exit 2; }
[ -f "$ENV_N8N" ] || { echo "✗ Falta $ENV_N8N" >&2; exit 1; }
set -a
# shellcheck disable=SC1090  # ruta variable: la elige un argumento
source "$ENV_N8N"
set +a
: "${N8N_BASE_URL:?}" "${N8N_API_KEY:?}"
BASE="${N8N_BASE_URL%/}"; API="$BASE/api/v1"
URL="$BASE/webhook/$WH/webhook"
NOMBRE_TMP="TEMPORAL desafío Meta $WH"

api() { # metodo ruta [cuerpo] — la clave de n8n, por la entrada estándar
  if [ $# -ge 3 ]; then
    curl -s --max-time 60 -X "$1" -H @- -H "Content-Type: application/json" -d "$3" "$API$2" <<<"X-N8N-API-KEY: $N8N_API_KEY"
  else
    curl -s --max-time 60 -X "$1" -H @- "$API$2" <<<"X-N8N-API-KEY: $N8N_API_KEY"
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
