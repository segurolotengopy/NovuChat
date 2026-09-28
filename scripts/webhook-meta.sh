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
# de cualquier POST, `negar_app_ajena` corta en dos capas: la huella del id
# (sin red) y el nombre que devuelve Graph. Si Graph no contesta un nombre,
# también corta: sin saber qué app es, no se escribe.
#
# Lee N8N_BASE_URL y N8N_API_KEY de .env (o --env-n8n). No imprime valores.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1

# Nombres de apps de WhatsApp-Modular, por fragmento normalizado (minúsculas,
# solo letras y dígitos): «aab1» cubre AAB1-WA-Prod y cualquier otra app de
# AAB1; «segurolotengo», la app de demostración «Demo SeguroLo Tengo». Ninguna
# app de NovuChat se llama así (NovuChat-Demo-A, NovuChat-Asistente…).
APPS_AJENAS_FRAGMENTOS="aab1 segurolotengo"
# sha256 del id de cada app ajena, sin el id: el repositorio es público. El id
# de una app no es un secreto (viaja en el client_id del registro insertado),
# así que la huella no esconde nada: evita publicarlo y sirve cuando Graph no
# está. NOVUCHAT_APPS_AJENAS_HUELLAS_EXTRA solo puede AGREGAR huellas (la usa
# la suite, que no tiene los ids reales).
APPS_AJENAS_HUELLAS="
"

# huella_ajena <app-id>: 0 si el sha256 del id está en la lista.
huella_ajena() {
  local h
  h=$(python3 -c 'import hashlib,sys; print(hashlib.sha256(sys.argv[1].strip().encode()).hexdigest())' "$1")
  # shellcheck disable=SC2086  # sin comillas a propósito: una huella por palabra
  case " $(echo $APPS_AJENAS_HUELLAS ${NOVUCHAT_APPS_AJENAS_HUELLAS_EXTRA:-}) " in *" $h "*) return 0 ;; esac
  return 1
}

# negar_app_ajena <app-id> app|token: sale con error si la app es ajena por
# huella (antes de tocar la red) o por nombre, si Graph contestó un error o no
# trajo nombre, o si el id que contestó no es el del entorno.
#   app   → GET /{app-id}?fields=id,name con el app access token (--alta-meta)
#   token → GET /app?fields=id,name con WA_TOKEN: la app que Meta suscribe en
#           POST /{WABA}/subscribed_apps es la del token, no la del .env
negar_app_ajena() {
  local id="$1" modo="$2" json v
  if huella_ajena "$id"; then
    echo "✗ La app …${id: -4} es de WhatsApp-Modular (huella): NovuChat no escribe su webhook (CLAUDE.md, prohibiciones 5 y 7)" >&2
    exit 3
  fi
  if [ "$modo" = "token" ]; then
    json=$(curl -s --max-time 30 "$G/app?fields=id,name" -H "Authorization: Bearer ${WA_TOKEN}" || true)
  else
    json=$(curl -s --max-time 30 "$G/$id?fields=id,name&access_token=${id}|${WA_APP_SECRET}" || true)
  fi
  v=$(printf '%s' "$json" | python3 -c '
import json,re,sys
id_env, fragmentos = sys.argv[1], sys.argv[2].split()
try: d = json.loads(sys.stdin.read() or "{}")
except ValueError: print("error Graph no devolvió JSON"); sys.exit()
if not isinstance(d, dict) or "error" in d:
    print("error", (d.get("error") or {}).get("message", "?") if isinstance(d, dict) else "?"); sys.exit()
nombre = str(d.get("name") or "")
if not nombre: print("error Graph no devolvió el nombre de la app"); sys.exit()
if d.get("id") and str(d["id"]) != id_env: print("distinta", nombre); sys.exit()
plano = re.sub(r"[^a-z0-9]", "", nombre.lower())
print("ajena" if any(f in plano for f in fragmentos) else "propia", nombre)' "$id" "$APPS_AJENAS_FRAGMENTOS")
  case "$v" in
    propia\ *) echo "  app: ${v#propia } (…${id: -4})" ;;
    ajena\ *)
      echo "✗ La app «${v#ajena }» es de WhatsApp-Modular: NovuChat no escribe su webhook (CLAUDE.md, prohibiciones 5 y 7)" >&2
      exit 3 ;;
    distinta\ *)
      echo "✗ El token es de la app «${v#distinta }», no de la …${id: -4} del entorno: se corta sin escribir" >&2
      exit 3 ;;
    *)
      echo "✗ No se pudo saber qué app es la …${id: -4} (${v#error }): sin eso no se escribe su webhook" >&2
      exit 3 ;;
  esac
}

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
    curl -s --max-time 30 "$G/$WABA_ID/subscribed_apps" -H "Authorization: Bearer ${WA_TOKEN}" \
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
  R=$(curl -s --max-time 60 -X POST "$G/$WABA_ID/subscribed_apps" \
        -H "Authorization: Bearer ${WA_TOKEN}" -H "Content-Type: application/json" \
        -d "$(python3 -c "import json,sys; print(json.dumps({'override_callback_uri': sys.argv[1], 'verify_token': sys.argv[2]}))" "$URL" "$VT")")
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
  curl -s --max-time 30 "$G/$WA_APP_ID/subscriptions?access_token=${WA_APP_ID}|${WA_APP_SECRET}" \
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
set -a
# shellcheck disable=SC1090  # ruta variable: la elige un argumento
source "$ENV_N8N"
set +a
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
