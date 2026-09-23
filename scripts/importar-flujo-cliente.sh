#!/usr/bin/env bash
# =============================================================================
# importar-flujo-cliente.sh — crea en n8n, por la API pública, las credenciales
# propias de un cliente y su flujo, con las credenciales YA ASIGNADAS nodo por
# nodo. Ningún valor se muestra ni pasa por el portapapeles de una persona.
#
# POR QUÉ EXISTE (memoria del 15/09/2026, alta de NovuChat): al importar por la
# interfaz, n8n asigna sola la única credencial de un tipo a TODOS los nodos de
# ese tipo; la de ingesta quedó en los nodos que envían a Meta y el secreto de
# ingesta viajó a Meta tres veces. Y cada credencial la pegaba una persona a
# mano, con el nombre libre: `publicar-flujo.sh` empareja por NOMBRE, así que
# un nombre distinto al del JSON rompe la actualización siguiente.
#
# QUÉ HACE
#   1. lee N8N_BASE_URL y N8N_API_KEY del .env de la instancia, y del
#      .env.<cliente> el App ID, App Secret, token y WABA;
#   2. lee el secreto del alias de ingesta con gcloud (nunca lo imprime);
#   3. crea (o reutiliza, si ya existe con ese nombre) tres credenciales:
#        whatsAppTriggerApi  «WhatsApp Trigger <Cliente>»
#        whatsAppApi         «<nombre que el JSON declara en los nodos de envío>»
#        httpHeaderAuth      «<nombre que el JSON declara en los nodos HTTP>»
#      y localiza las compartidas por tipo: Google Calendar OAuth2 y Gemini;
#   4. injerta {id, name} en cada nodo según su tipo y crea el flujo, INACTIVO;
#   5. informa el id del flujo y la URL de producción del webhook.
#
# SE CORRE EN LA TERMINAL DE UNA PERSONA: lee el valor de un secreto. En seco
# (por defecto) muestra el plan y no escribe nada. --aplicar escribe.
#
#   ./scripts/importar-flujo-cliente.sh --cliente BELLIDO \
#       --flujo Flujos/bellido-agendamiento.local.json \
#       --env-cliente ~/NovuChat/.env.bellido --alias cliente03 [--aplicar]
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1

CLIENTE=""; FLUJO=""; ENV_CLIENTE=""; ALIAS=""; APLICAR=0
ENV_N8N=".env"; PROYECTO="${GCP_PROYECTO_CONSOLA:-novuchat-demo}"
while [ $# -gt 0 ]; do
  case "$1" in
    --cliente)     CLIENTE="$2"; shift 2 ;;
    --flujo)       FLUJO="$2"; shift 2 ;;
    --env-cliente) ENV_CLIENTE="$2"; shift 2 ;;
    --env-n8n)     ENV_N8N="$2"; shift 2 ;;
    --alias)       ALIAS="$2"; shift 2 ;;
    --proyecto)    PROYECTO="$2"; shift 2 ;;
    --aplicar)     APLICAR=1; shift ;;
    *) echo "Argumento desconocido: $1" >&2; exit 2 ;;
  esac
done
[ -n "$CLIENTE" ] && [ -n "$FLUJO" ] && [ -n "$ENV_CLIENTE" ] && [ -n "$ALIAS" ] \
  || { echo "Uso: --cliente NOMBRE --flujo <.local.json> --env-cliente <.env.x> --alias clienteNN [--aplicar]" >&2; exit 2; }
[ -f "$FLUJO" ] || { echo "✗ No existe $FLUJO (¿corriste preparar-import.sh?)" >&2; exit 1; }
[[ "$FLUJO" == *.local.json ]] || { echo "✗ El flujo tiene que ser el .local.json preparado, no el versionado" >&2; exit 1; }
[ -f "$ENV_N8N" ] && [ -f "$ENV_CLIENTE" ] || { echo "✗ Falta $ENV_N8N o $ENV_CLIENTE" >&2; exit 1; }

set -a
# shellcheck disable=SC1090  # ruta variable: la elige un argumento
source "$ENV_N8N"
# shellcheck disable=SC1090  # ruta variable: la elige un argumento
source "$ENV_CLIENTE"
set +a
: "${N8N_BASE_URL:?}" "${N8N_API_KEY:?}" "${WA_APP_ID:?}" "${WA_TOKEN:?}" "${WABA_ID:?}"
[ -n "${WA_APP_SECRET:-}" ] || { echo "✗ WA_APP_SECRET no está en $ENV_CLIENTE: el disparador lo necesita" >&2; exit 1; }

ALIAS_MAY="$(printf '%s' "$ALIAS" | tr '[:lower:]' '[:upper:]')"
export CLOUDSDK_CONFIG="${CLOUDSDK_CONFIG:-$HOME/.config/gcloud-novuchat-prod}"; unset CLOUDSDK_ACTIVE_CONFIG_NAME
INGESTA="$(gcloud secrets versions access latest --secret="INGESTA_${ALIAS_MAY}" --project "$PROYECTO" 2>/dev/null)" \
  || { echo "✗ No pude leer el secreto INGESTA_${ALIAS_MAY} en $PROYECTO" >&2; exit 1; }
[ -n "$INGESTA" ] || { echo "✗ El secreto INGESTA_${ALIAS_MAY} está vacío" >&2; exit 1; }

export CLIENTE FLUJO APLICAR INGESTA N8N_BASE_URL N8N_API_KEY WA_APP_ID WA_APP_SECRET WA_TOKEN WABA_ID
python3 - <<'PY'
import json, os, sys, urllib.request, urllib.error

VERDE, ROJO, GRIS, FIN = "\033[1;32m", "\033[1;31m", "\033[0;90m", "\033[0m"
api = os.environ["N8N_BASE_URL"].rstrip("/") + "/api/v1"
key = os.environ["N8N_API_KEY"]
cliente = os.environ["CLIENTE"]; aplicar = os.environ["APLICAR"] == "1"
flujo = json.load(open(os.environ["FLUJO"], encoding="utf-8"))

def llamar(metodo, ruta, cuerpo=None):
    datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
    req = urllib.request.Request(api + ruta, data=datos, method=metodo,
        headers={"X-N8N-API-KEY": key, "Content-Type": "application/json", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r: return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")

# --- 1. credenciales que ya existen, por nombre y tipo (la API no devuelve valores) ---
cod, rta = llamar("GET", "/credentials?limit=250")
if cod != 200: print(f"{ROJO}✗ GET /credentials → {cod}: {rta}{FIN}"); sys.exit(1)
existentes = rta.get("data", rta if isinstance(rta, list) else [])
por_nombre = {c["name"]: c for c in existentes}
por_tipo = {}
for c in existentes: por_tipo.setdefault(c["type"], []).append(c)

# --- 2. nombres que el JSON declara para las credenciales propias del cliente ---
def nombres_de(tipo):
    return sorted({n["credentials"][tipo]["name"] for n in flujo["nodes"]
                   if n.get("credentials", {}).get(tipo, {}).get("name")})
nom_envio = nombres_de("whatsAppApi"); nom_ingesta = nombres_de("httpHeaderAuth")
if len(nom_envio) != 1 or len(nom_ingesta) != 1:
    print(f"{ROJO}✗ El JSON tiene que declarar UN nombre de envío y UNO de ingesta: {nom_envio} / {nom_ingesta}{FIN}"); sys.exit(1)
nom_envio, nom_ingesta = nom_envio[0], nom_ingesta[0]
nom_trigger = f"WhatsApp Trigger {cliente.title()}"

propias = [
  # (nombre, tipo, datos)  — los datos nunca se imprimen
  (nom_trigger, "whatsAppTriggerApi", {"clientId": os.environ["WA_APP_ID"], "clientSecret": os.environ["WA_APP_SECRET"]}),
  (nom_envio,   "whatsAppApi",        {"accessToken": os.environ["WA_TOKEN"], "businessAccountId": os.environ["WABA_ID"]}),
  (nom_ingesta, "httpHeaderAuth",     {"name": "Authorization", "value": "Bearer " + os.environ["INGESTA"]}),
]

# --- 3. las compartidas: una sola por tipo, o se pide a mano ---
compartidas = {}
for tipo, rotulo in [("googleCalendarOAuth2Api", "Google Calendar OAuth2"), ("googlePalmApi", "Google Gemini")]:
    lista = por_tipo.get(tipo, [])
    if len(lista) == 1: compartidas[tipo] = lista[0]
    else:
        print(f"{ROJO}✗ {rotulo}: hay {len(lista)} credencial(es) de tipo {tipo}; hace falta exactamente una{FIN}")
        for c in lista: print(f"    · {c['name']}")
        sys.exit(1)

print(f"Cliente : {cliente}\nFlujo   : {flujo['name']} ({len(flujo['nodes'])} nodos)\nn8n     : {api}\n")
print("Credenciales propias:")
ids = {}
for nombre, tipo, datos in propias:
    if nombre in por_nombre:
        c = por_nombre[nombre]
        if c["type"] != tipo: print(f"  {ROJO}✗ «{nombre}» existe con OTRO tipo ({c['type']}){FIN}"); sys.exit(1)
        print(f"  {GRIS}= {nombre}  ({tipo}) ya existe, se reutiliza{FIN}"); ids[tipo] = {"id": c["id"], "name": nombre}
    else:
        print(f"  {VERDE}+ {nombre}  ({tipo}){FIN}" + ("" if aplicar else "  (se crearía)"))
        if aplicar:
            cod, rta = llamar("POST", "/credentials", {"name": nombre, "type": tipo, "data": datos})
            if cod not in (200, 201): print(f"  {ROJO}✗ POST /credentials → {cod}: {rta.get('message', rta)}{FIN}"); sys.exit(1)
            ids[tipo] = {"id": rta["id"], "name": nombre}
print("Credenciales compartidas:")
for tipo, c in compartidas.items():
    print(f"  {GRIS}= {c['name']}  ({tipo}){FIN}"); ids[tipo] = {"id": c["id"], "name": c["name"]}

# --- 4. injertar por tipo de nodo ---
TIPO_POR_NODO = {
  "n8n-nodes-base.whatsAppTrigger": "whatsAppTriggerApi",
  "n8n-nodes-base.whatsApp": "whatsAppApi",
  "n8n-nodes-base.httpRequest": "httpHeaderAuth",
  # EL DISPARADOR DEL CARRITO (22/09/2026). Un flujo de venta tiene un segundo
  # disparador, el nodo Webhook que recibe el carrito del catálogo web, y se
  # autentica con la MISMA credencial de cabecera que la ingesta. Sin esta fila
  # el nodo entraba sin credencial y n8n contestaba 500 a `despertarFlujo`: el
  # pedido del cliente quedaba guardado y sin respuesta, que es el síntoma más
  # caro de todos porque nadie lo ve hasta que el cliente reclama.
  #
  # Va SIN la condición de `genericAuthType` de más abajo: el nodo Webhook no
  # tiene ese parámetro —declara `authentication: "headerAuth"`— así que la
  # condición lo descartaría.
  "n8n-nodes-base.webhook": "httpHeaderAuth",
  "n8n-nodes-base.googleCalendar": "googleCalendarOAuth2Api",
  "n8n-nodes-base.googleCalendarTool": "googleCalendarOAuth2Api",
  "@n8n/n8n-nodes-langchain.lmChatGoogleGemini": "googlePalmApi",
}
def aplica(n):
    tipo = TIPO_POR_NODO.get(n["type"])
    if not tipo: return None
    # La condición es solo para los nodos que ELIGEN entre credencial genérica y
    # predefinida (`httpRequest`). El Webhook no elige: su `headerAuth` ya es la
    # de cabecera, y exigirle `genericAuthType` lo dejaría sin credencial.
    if tipo == "httpHeaderAuth" and n["type"] != "n8n-nodes-base.webhook" \
       and n.get("parameters", {}).get("genericAuthType") != "httpHeaderAuth": return None
    return tipo
print("\nAsignación nodo por nodo:")
for n in flujo["nodes"]:
    tipo = aplica(n)
    if not tipo: continue
    if aplicar and tipo not in ids: print(f"  {ROJO}✗ sin credencial para {n['name']}{FIN}"); sys.exit(1)
    if aplicar: n["credentials"] = {tipo: ids[tipo]}
    print(f"  {n['name']:<32} → {tipo}: {ids.get(tipo, {}).get('name', '(seco)')}")

# --- 5. crear el flujo, inactivo ---
cuerpo = {"name": flujo["name"], "nodes": flujo["nodes"], "connections": flujo["connections"],
          "settings": flujo.get("settings", {})}
if not aplicar:
    print(f"\n{GRIS}Seco: no se escribió nada. Agregue --aplicar.{FIN}"); sys.exit(0)
cod, rta = llamar("POST", "/workflows", cuerpo)
if cod not in (200, 201): print(f"{ROJO}✗ POST /workflows → {cod}: {rta.get('message', rta)}{FIN}"); sys.exit(1)
wid = rta["id"]
cod, vivo = llamar("GET", f"/workflows/{wid}")
trig = next((n for n in vivo["nodes"] if n["type"] == "n8n-nodes-base.whatsAppTrigger"), {})
wh = trig.get("webhookId", "")
faltan = [n["name"] for n in vivo["nodes"] if aplica(n) and not n.get("credentials")]
print(f"\n{VERDE}✓ Flujo creado, INACTIVO: id {wid}{FIN}")
print(f"  webhookId del disparador: {wh or '(no asignado todavía)'}")
if wh: print(f"  URL de producción: {os.environ['N8N_BASE_URL'].rstrip('/')}/webhook/{wh}/webhook")
print(f"  Trigger On: {trig.get('parameters', {}).get('updates')}")
print(f"  Nodos sin credencial tras releer: {faltan or 'ninguno ✓'}")
print(f"\nSIGUE: anotar N8N_WORKFLOW_ID={wid} y N8N_WEBHOOK_PATH en el .env del cliente; el rodeo del")
print("desafío de Meta (flujo temporal) y recién entonces activar este flujo.")
PY
