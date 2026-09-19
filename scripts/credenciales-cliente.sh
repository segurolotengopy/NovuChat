#!/usr/bin/env bash
# =============================================================================
# credenciales-cliente.sh — asegura en n8n las credenciales de un cliente y
# deja un JSON preparado con los ids resueltos, para publicarlo sin que ningún
# nodo quede con credencial «por nombre» y sin id.
#
# POR QUÉ. `publicar-flujo.sh` injerta las credenciales del flujo VIVO sobre el
# JSON por nombre de nodo. Un nodo NUEVO (que no existe en el flujo vivo) llega
# con {id: '', name: '…'} y n8n no lo resuelve solo: queda sin credencial y el
# envío falla en producción. Este script resuelve por NOMBRE contra la lista de
# credenciales de la instancia (la API devuelve id, nombre y tipo, nunca
# valores) y crea la que falte para el envío por la Graph API:
#     httpHeaderAuth  «Graph WhatsApp <Cliente> (Bearer)»  Authorization: Bearer <token>
#
# SE CORRE EN LA TERMINAL DE UNA PERSONA: lee el token del .env del cliente.
#
#   ./scripts/credenciales-cliente.sh --cliente BELLIDO \
#       --env-cliente ~/NovuChat/.env.bellido \
#       --flujo Flujos/bellido-agendamiento.local.json [--aplicar]
#
# Sin --aplicar: informa qué crearía y qué nodos quedarían resueltos.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1

CLIENTE=""; ENV_CLIENTE=""; FLUJO=""; ENV_N8N=".env"; APLICAR=0
while [ $# -gt 0 ]; do
  case "$1" in
    --cliente)     CLIENTE="$2"; shift 2 ;;
    --env-cliente) ENV_CLIENTE="$2"; shift 2 ;;
    --flujo)       FLUJO="$2"; shift 2 ;;
    --env-n8n)     ENV_N8N="$2"; shift 2 ;;
    --aplicar)     APLICAR=1; shift ;;
    *) echo "Argumento desconocido: $1" >&2; exit 2 ;;
  esac
done
[ -n "$CLIENTE" ] && [ -f "$ENV_CLIENTE" ] && [ -f "$FLUJO" ] && [ -f "$ENV_N8N" ] \
  || { echo "Uso: --cliente NOMBRE --env-cliente <.env.x> --flujo <.local.json> [--aplicar]" >&2; exit 2; }
[[ "$FLUJO" == *.local.json ]] || { echo "✗ El flujo tiene que ser el .local.json preparado" >&2; exit 1; }

set -a
# shellcheck disable=SC1090  # ruta variable: la elige un argumento
source "$ENV_N8N"
# shellcheck disable=SC1090  # ruta variable: la elige un argumento
source "$ENV_CLIENTE"
set +a
: "${N8N_BASE_URL:?}" "${N8N_API_KEY:?}" "${WA_TOKEN:?}"

export CLIENTE FLUJO APLICAR N8N_BASE_URL N8N_API_KEY WA_TOKEN
python3 - <<'PY'
import json, os, sys, urllib.request, urllib.error
VERDE, ROJO, GRIS, FIN = "\033[1;32m", "\033[1;31m", "\033[0;90m", "\033[0m"
api = os.environ["N8N_BASE_URL"].rstrip("/") + "/api/v1"; key = os.environ["N8N_API_KEY"]
cliente = os.environ["CLIENTE"]; aplicar = os.environ["APLICAR"] == "1"; ruta = os.environ["FLUJO"]
def llamar(metodo, r, cuerpo=None):
    datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
    req = urllib.request.Request(api + r, data=datos, method=metodo,
        headers={"X-N8N-API-KEY": key, "Content-Type": "application/json", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as x: return x.status, json.loads(x.read() or b"{}")
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
cod, rta = llamar("GET", "/credentials?limit=250")
if cod != 200: print(f"{ROJO}✗ GET /credentials → {cod}{FIN}"); sys.exit(1)
lista = rta.get("data", [])
por_nombre = {c["name"]: c for c in lista}

nombre_graph = f"Graph WhatsApp {cliente.title()} (Bearer)"
if nombre_graph in por_nombre:
    print(f"{GRIS}= {nombre_graph} ya existe{FIN}")
else:
    print(f"{VERDE}+ {nombre_graph}  (httpHeaderAuth){FIN}" + ("" if aplicar else "  (se crearía)"))
    if aplicar:
        cod, rta = llamar("POST", "/credentials", {"name": nombre_graph, "type": "httpHeaderAuth",
                          "data": {"name": "Authorization", "value": "Bearer " + os.environ["WA_TOKEN"]}})
        if cod not in (200, 201): print(f"{ROJO}✗ POST /credentials → {cod}: {rta.get('message', rta)}{FIN}"); sys.exit(1)
        por_nombre[nombre_graph] = {"id": rta["id"], "name": nombre_graph, "type": "httpHeaderAuth"}

por_tipo = {}
for c in lista: por_tipo.setdefault(c["type"], []).append(c)

flujo = json.load(open(ruta, encoding="utf-8"))
faltan = []; resueltos = 0
for n in flujo["nodes"]:
    for tipo, c in (n.get("credentials") or {}).items():
        if c.get("id"): continue
        nombre = c.get("name", "")
        e = por_nombre.get(nombre) if nombre else None
        # Sin nombre (las compartidas: Calendar, Gemini) se resuelve por TIPO,
        # solo si en la instancia hay exactamente una de ese tipo.
        if not nombre and len(por_tipo.get(tipo, [])) == 1: e = por_tipo[tipo][0]
        if not e or e["type"] != tipo: faltan.append(f"{n['name']} → {tipo} «{nombre}»"); continue
        c["id"] = e["id"]; c["name"] = e["name"]; resueltos += 1
        print(f"  {n['name']:<32} ← {e['name']}  (id resuelto)")
if faltan:
    print(f"{ROJO}✗ Sin credencial en la instancia:{FIN}"); [print("   ", f) for f in faltan]; sys.exit(1)
if aplicar:
    json.dump(flujo, open(ruta, "w", encoding="utf-8"), ensure_ascii=False, indent=2); open(ruta, "a").write("\n")
    print(f"{VERDE}✓ {resueltos} credencial(es) resueltas por id en {ruta}{FIN}")
else:
    print(f"{GRIS}Seco: {resueltos} se resolverían. Agregue --aplicar.{FIN}")
PY
