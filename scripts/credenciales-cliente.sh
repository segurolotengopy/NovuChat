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
#
# --venta (flujo de «Venta mínima», p. ej. Q'Taco, 04/10/2026). Además de la de Graph
# crea, SI FALTAN, las otras dos que ese flujo declara y que ningún otro script crea:
#     httpHeaderAuth  «<nombre que declaran los nodos de ingesta>»   Authorization: Bearer <secreto del alias>
#     whatsAppApi     «<nombre que declaran los nodos whatsApp>»     accessToken + businessAccountId
#   Uso:  --venta --ingesta-secreto INGESTA_<ALIAS> --ingesta-version N
#   (el alias y la versión los da `asignar-numero`/`rotar-ingesta.sh`). `--cliente` tiene que tener
#   la grafía exacta del nombre de Graph del JSON (p. ej. «Q'Taco», no «QTACO»). Pide WABA_ID en el
#   .env del cliente. NUNCA modifica una credencial existente (solo crea las que faltan) y nunca
#   imprime un valor. El valor de ingesta se lee SOLO con --aplicar, del Secret Manager con las
#   credenciales aisladas del proyecto, y viaja a python por el entorno, no por la línea de comandos.
#   No crea ningún Trigger ni pide WA_APP_SECRET: no sirve para flujos de agenda ni de captación.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1

CLIENTE=""; ENV_CLIENTE=""; FLUJO=""; ENV_N8N=".env"; APLICAR=0
VENTA=0; INGESTA_SECRETO=""; INGESTA_VERSION=""
while [ $# -gt 0 ]; do
  case "$1" in
    --cliente)     CLIENTE="$2"; shift 2 ;;
    --env-cliente) ENV_CLIENTE="$2"; shift 2 ;;
    --flujo)       FLUJO="$2"; shift 2 ;;
    --env-n8n)     ENV_N8N="$2"; shift 2 ;;
    --venta)       VENTA=1; shift ;;
    --ingesta-secreto) INGESTA_SECRETO="${2:?}"; shift 2 ;;
    --ingesta-version) INGESTA_VERSION="${2:?}"; shift 2 ;;
    --aplicar)     APLICAR=1; shift ;;
    *) echo "Argumento desconocido: $1" >&2; exit 2 ;;
  esac
done
[ -n "$CLIENTE" ] && [ -f "$ENV_CLIENTE" ] && [ -f "$FLUJO" ] && [ -f "$ENV_N8N" ] \
  || { echo "Uso: --cliente NOMBRE --env-cliente <.env.x> --flujo <.local.json> [--venta --ingesta-secreto INGESTA_X --ingesta-version N] [--aplicar]" >&2; exit 2; }
[[ "$FLUJO" == *.local.json ]] || { echo "✗ El flujo tiene que ser el .local.json preparado" >&2; exit 1; }
if [ "$VENTA" = 0 ] && { [ -n "$INGESTA_SECRETO" ] || [ -n "$INGESTA_VERSION" ]; }; then
  echo "✗ --ingesta-secreto y --ingesta-version solo valen con --venta" >&2; exit 2
fi
if [ "$VENTA" = 1 ]; then
  # Con `bash -x` la traza imprimiría los valores (WA_TOKEN al leer el .env y el secreto): se niega ANTES de
  # leer nada (revisión de seguridad del PR #398, L1).
  case "$-" in *x*) echo "✗ No corra este script con -x: la traza mostraría los secretos" >&2; exit 2 ;; esac
  [[ "$INGESTA_SECRETO" =~ ^INGESTA_[A-Z0-9]+$ ]] || { echo "✗ --ingesta-secreto tiene que ser INGESTA_<ALIAS>" >&2; exit 2; }
  [[ "$INGESTA_VERSION" =~ ^[0-9]+$ ]] || { echo "✗ --ingesta-version tiene que ser un número" >&2; exit 2; }
fi

set -a
# shellcheck disable=SC1090  # ruta variable: la elige un argumento
source "$ENV_N8N"
# shellcheck disable=SC1090  # ruta variable: la elige un argumento
source "$ENV_CLIENTE"
set +a
: "${N8N_BASE_URL:?}" "${N8N_API_KEY:?}" "${WA_TOKEN:?}"
[ "$VENTA" = 0 ] || : "${WABA_ID:?con --venta el .env del cliente tiene que traer WABA_ID}"

# El valor de ingesta: SOLO con --aplicar y --venta. Sale del Secret Manager con las credenciales
# aisladas del proyecto (igual que rotar-ingesta.sh) y se comprueba su forma sin mostrarlo. El
# centinela «x» evita que la sustitución de comandos se coma un salto de línea final que hay que detectar.
INGESTA_VALOR=""
if [ "$VENTA" = 1 ] && [ "$APLICAR" = 1 ]; then
  # El proyecto es el de la consola, fijo (no se toma del entorno: PR #398, L3); se dice cuál secreto se lee, sin su valor.
  PROYECTO_SECRETO="novuchat-demo"
  export CLOUDSDK_CONFIG="${CLOUDSDK_CONFIG:-$HOME/.config/gcloud-novuchat-prod}"
  unset CLOUDSDK_ACTIVE_CONFIG_NAME
  echo "• Se lee el secreto $INGESTA_SECRETO (versión $INGESTA_VERSION) del proyecto $PROYECTO_SECRETO; el valor no se muestra."
  crudo="$(gcloud secrets versions access "$INGESTA_VERSION" --secret="$INGESTA_SECRETO" --project "$PROYECTO_SECRETO"; printf x)"
  crudo="${crudo%x}"
  # 64 caracteres hexadecimales y sin salto de línea (igual que `rotar-ingesta.sh verificar`, PR #398, L2).
  [[ "$crudo" =~ ^[0-9a-f]{64}$ ]] || { echo "✗ El secreto de ingesta no son 64 caracteres hexadecimales sin salto de línea" >&2; exit 1; }
  INGESTA_VALOR="$crudo"; unset crudo
fi

export CLIENTE FLUJO APLICAR N8N_BASE_URL N8N_API_KEY WA_TOKEN VENTA INGESTA_VALOR
[ "$VENTA" = 0 ] || export WABA_ID
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
venta = os.environ.get("VENTA") == "1"
if venta and rta.get("nextCursor"):
    print(f"{ROJO}✗ La lista de credenciales de n8n viene partida (nextCursor): no se crea nada para no duplicar{FIN}"); sys.exit(1)
por_nombre = {c["name"]: c for c in lista}

nombre_graph = f"Graph WhatsApp {cliente.title()} (Bearer)"

# --venta: los nombres de las otras dos credenciales los declara el JSON (no se inventan), y se
# validan ANTES de crear nada: un solo nombre de ingesta (distinto del de Graph) y un solo nombre
# whatsAppApi (mirando todos los nodos: `Descargar medio` es un httpRequest con whatsAppApi).
extra = []  # (nombre, tipo, datos) que se crearían si faltan
if venta:
    flujo0 = json.load(open(ruta, encoding="utf-8"))
    def nombres(tipo):
        return sorted({c.get("name", "") for n in flujo0["nodes"] for t, c in (n.get("credentials") or {}).items()
                       if t == tipo and c.get("name")})
    ingestas = [x for x in nombres("httpHeaderAuth") if x != nombre_graph]
    envios = nombres("whatsAppApi")
    if len(ingestas) != 1 or len(envios) != 1:
        print(f"{ROJO}✗ El JSON tiene que declarar UN nombre de ingesta (distinto del de Graph «{nombre_graph}») y UN nombre whatsAppApi: ingesta={ingestas} envío={envios}{FIN}"); sys.exit(1)
    if len({nombre_graph, ingestas[0], envios[0]}) != 3:
        print(f"{ROJO}✗ Los tres nombres de credencial tienen que ser distintos{FIN}"); sys.exit(1)
    extra = [(ingestas[0], "httpHeaderAuth", lambda: {"name": "Authorization", "value": "Bearer " + os.environ["INGESTA_VALOR"]}),
             (envios[0], "whatsAppApi", lambda: {"accessToken": os.environ["WA_TOKEN"], "businessAccountId": os.environ["WABA_ID"]})]
    # M1 (revisión del PR #398): cada nombre del JSON tiene que ser DE ESTE CLIENTE; si no, una credencial
    # existente de otro cliente se reutilizaría en silencio y el flujo quedaría con la credencial ajena.
    for nombre in (ingestas[0], envios[0]):
        if cliente.lower() not in nombre.lower():
            print(f"{ROJO}✗ El nombre de credencial «{nombre}» del JSON no nombra al cliente «{cliente}»: no se crea ni se reutiliza nada{FIN}"); sys.exit(1)
    # L4: el tipo de la de Graph también se comprueba ANTES de crear nada.
    e = por_nombre.get(nombre_graph)
    if e and e["type"] != "httpHeaderAuth":
        print(f"{ROJO}✗ «{nombre_graph}» ya existe con otro tipo ({e['type']}): no se toca{FIN}"); sys.exit(1)
    for nombre, tipo, _ in extra:
        e = por_nombre.get(nombre)
        if e and e["type"] != tipo:
            print(f"{ROJO}✗ «{nombre}» ya existe con otro tipo ({e['type']}): no se toca{FIN}"); sys.exit(1)
    if len([c for c in lista if c["name"] in {nombre_graph, ingestas[0], envios[0]}]) != len({c["name"] for c in lista if c["name"] in {nombre_graph, ingestas[0], envios[0]}}):
        print(f"{ROJO}✗ Hay credenciales repetidas con alguno de esos nombres: no se crea nada{FIN}"); sys.exit(1)

if nombre_graph in por_nombre:
    print(f"{GRIS}= {nombre_graph} ya existe{FIN}")
else:
    print(f"{VERDE}+ {nombre_graph}  (httpHeaderAuth){FIN}" + ("" if aplicar else "  (se crearía)"))
    if aplicar:
        cod, rta = llamar("POST", "/credentials", {"name": nombre_graph, "type": "httpHeaderAuth",
                          "data": {"name": "Authorization", "value": "Bearer " + os.environ["WA_TOKEN"]}})
        if cod not in (200, 201): print(f"{ROJO}✗ POST /credentials → {cod}: {rta.get('message', rta)}{FIN}"); sys.exit(1)
        por_nombre[nombre_graph] = {"id": rta["id"], "name": nombre_graph, "type": "httpHeaderAuth"}
    elif venta:
        por_nombre[nombre_graph] = {"id": "(seco)", "name": nombre_graph, "type": "httpHeaderAuth"}

for nombre, tipo, datos in extra:
    if nombre in por_nombre:
        print(f"{GRIS}= {nombre} ya existe, id {por_nombre[nombre].get('id')} (no se modifica){FIN}")
        continue
    print(f"{VERDE}+ {nombre}  ({tipo}){FIN}" + ("" if aplicar else "  (se crearía)"))
    if aplicar:
        cod, rta = llamar("POST", "/credentials", {"name": nombre, "type": tipo, "data": datos()})
        if cod not in (200, 201):
            m = rta.get("message", "") if isinstance(rta, dict) else ""
            print(f"{ROJO}✗ POST /credentials → {cod}: {m if isinstance(m, str) else ''}{FIN}"); sys.exit(1)
        por_nombre[nombre] = {"id": rta["id"], "name": nombre, "type": tipo}
    else:
        por_nombre[nombre] = {"id": "(seco)", "name": nombre, "type": tipo}

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
