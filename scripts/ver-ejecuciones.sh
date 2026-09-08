#!/usr/bin/env bash
# Consulta las ejecuciones de un flujo por la API de n8n, sin abrir el navegador.
#
# Existe porque diagnosticar a ciegas cuesta caro: cada vez que algo fallo hubo
# que pedirle a una persona que abriera n8n, encontrara la ejecucion y sacara
# una captura. Con la clave de API ya cargada, eso se resuelve solo.
#
#   ./scripts/ver-ejecuciones.sh                    # ultimas 10, resumen
#   ./scripts/ver-ejecuciones.sh --error            # solo las fallidas
#   ./scripts/ver-ejecuciones.sh --n 25             # cuantas traer
#   ./scripts/ver-ejecuciones.sh --id 123           # una, nodo por nodo
#   ./scripts/ver-ejecuciones.sh --id 123 --nodo agendar_cita   # un nodo
#   ./scripts/ver-ejecuciones.sh --id 123 --tokens   # uso de tokens del modelo,
#                                                    # incluidos los cacheados, y
#                                                    # el encabezado X-NovuChat-Cache
#
# NO imprime el contenido de los mensajes salvo que se pida un nodo concreto:
# por ahi pasan conversaciones de clientes finales.
set -euo pipefail

cd "$(dirname "$0")/.." || exit 1
N=10; SOLO_ERROR=0; ID=""; NODO=""; TOKENS=0; ENV_FILE=".env"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --n)     N="${2:?}"; shift 2 ;;
    --error) SOLO_ERROR=1; shift ;;
    --id)    ID="${2:?}"; shift 2 ;;
    --nodo)  NODO="${2:?}"; shift 2 ;;
    --tokens) TOKENS=1; shift ;;
    --env)   ENV_FILE="${2:?--env necesita un archivo}"; shift 2 ;;
    --env=*) ENV_FILE="${1#*=}"; shift ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Opcion desconocida: $1" >&2; exit 2 ;;
  esac
done

[[ -f "$ENV_FILE" ]] || { echo "✗ Falta $ENV_FILE"; exit 1; }
set -a
# shellcheck disable=SC1090  # ruta variable: la elige --env
. "./$ENV_FILE"
set +a
: "${N8N_API_KEY:?Falta N8N_API_KEY}"
: "${N8N_BASE_URL:?Falta N8N_BASE_URL}"
: "${N8N_WORKFLOW_ID:?Falta N8N_WORKFLOW_ID}"
API="${N8N_BASE_URL%/}/api/v1"

TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT

if [[ -n "$ID" ]]; then
  URL="${API}/executions/${ID}?includeData=true"
else
  URL="${API}/executions?workflowId=${N8N_WORKFLOW_ID}&limit=${N}&includeData=true"
  [[ $SOLO_ERROR -eq 1 ]] && URL="${URL}&status=error"
fi

COD=$(curl -s --max-time 40 -o "$TMP" -w '%{http_code}' \
      -H "X-N8N-API-KEY: ${N8N_API_KEY}" "$URL" || echo 000)
if [[ "$COD" != "200" ]]; then
  printf '\033[1;31m✗ HTTP %s\033[0m\n' "$COD"; head -c 300 "$TMP"; echo; exit 1
fi

ID="$ID" NODO="$NODO" TOKENS="$TOKENS" python3 - "$TMP" <<'PY'
import json, os, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
uno, nodo_pedido = os.environ.get("ID", ""), os.environ.get("NODO", "")
tokens = os.environ.get("TOKENS", "0") == "1"

CLAVES_DE_USO = ("token", "cache", "usage", "x-novuchat-cache")

def buscar_uso(obj, ruta="", hallados=None, prof=0):
    """Recorre la salida de un nodo y junta todo lo que hable de tokens o de cache.

    Sirve para VERIFICAR la cache del prefijo del prompt sin adivinar como
    nombra cada proveedor el conteo (Gemini: cachedContentTokenCount /
    cache_read; Anthropic: cache_read_input_tokens) ni como lo guarda n8n.
    Si no aparece ningun campo de cache, es que el proveedor no lo informo o
    n8n no lo conservo: eso tambien es un dato."""
    if hallados is None:
        hallados = []
    if prof > 12:
        return hallados
    if isinstance(obj, dict):
        for k, v in obj.items():
            kl = str(k).lower()
            if any(c in kl for c in CLAVES_DE_USO) and not isinstance(v, (dict, list)):
                hallados.append((f"{ruta}.{k}".lstrip("."), v))
            elif any(c in kl for c in CLAVES_DE_USO) and isinstance(v, dict):
                for k2, v2 in v.items():
                    if not isinstance(v2, (dict, list)):
                        hallados.append((f"{ruta}.{k}.{k2}".lstrip("."), v2))
                buscar_uso(v, f"{ruta}.{k}", hallados, prof + 1)
            else:
                buscar_uso(v, f"{ruta}.{k}", hallados, prof + 1)
    elif isinstance(obj, list):
        for i, v in enumerate(obj[:5]):
            buscar_uso(v, f"{ruta}[{i}]", hallados, prof + 1)
    return hallados
V, R, A, G, FIN = "\033[1;32m", "\033[1;31m", "\033[1;33m", "\033[0;90m", "\033[0m"

def error_de(datos):
    """Primer error real que aparezca en la corrida, con su nodo."""
    for nombre, corridas in ((datos or {}).get("resultData", {}).get("runData", {}) or {}).items():
        for c in corridas or []:
            e = c.get("error")
            if e:
                msg = e.get("message") or e.get("description") or "sin mensaje"
                return nombre, str(msg).split("\n")[0][:150]
    err = (datos or {}).get("resultData", {}).get("error")
    if err:
        return err.get("node", {}).get("name", "?"), str(err.get("message", ""))[:150]
    return None, None

def resumen(e):
    est = "error" if e.get("status") == "error" or e.get("stoppedAt") is None else e.get("status", "?")
    c = R if est == "error" else V
    ini = str(e.get("startedAt", ""))[:19].replace("T", " ")
    print(f"  {c}{est:<8}{FIN} #{e.get('id'):<7} {ini}")
    nodo, msg = error_de(e.get("data"))
    if nodo:
        print(f"           {R}↳ {nodo}: {msg}{FIN}")

if uno:
    e = d
    print(f"Ejecución #{e.get('id')} · {e.get('status')} · {str(e.get('startedAt',''))[:19].replace('T',' ')}\n")
    run = (e.get("data") or {}).get("resultData", {}).get("runData", {}) or {}
    for nombre, corridas in run.items():
        if nodo_pedido and nombre != nodo_pedido:
            continue
        for i, c in enumerate(corridas or []):
            ms = c.get("executionTime", "?")
            err = c.get("error")
            marca = f"{R}ERROR{FIN}" if err else f"{V}ok{FIN}"
            print(f"  {marca} {nombre}" + (f" (corrida {i+1})" if len(corridas) > 1 else "") + f"  {G}{ms} ms{FIN}")
            if err:
                print(f"      {R}{str(err.get('message','')).splitlines()[0][:220]}{FIN}")
                if err.get("description"):
                    print(f"      {G}{str(err['description'])[:220]}{FIN}")
            if tokens:
                vistos = set()
                for ruta, v in buscar_uso(c.get("data") or {}):
                    if (ruta, str(v)) in vistos:
                        continue
                    vistos.add((ruta, str(v)))
                    print(f"      {A}{ruta} = {v}{FIN}")
            if nodo_pedido:
                salida = ((c.get("data") or {}).get("main") or [[]])[0]
                print(f"      {G}items de salida: {len(salida)}{FIN}")
                for it in (salida or [])[:3]:
                    print(f"      {G}{json.dumps(it.get('json', {}), ensure_ascii=False)[:400]}{FIN}")
    if not run:
        print(f"  {A}Sin datos de nodos (¿ejecución sin guardar datos?){FIN}")
else:
    ejecuciones = d.get("data", [])
    if not ejecuciones:
        print(f"{A}Sin ejecuciones que coincidan.{FIN}")
    else:
        print(f"{len(ejecuciones)} ejecución(es), de la más reciente a la más vieja:\n")
        for e in ejecuciones:
            resumen(e)
        print(f"\n{G}Detalle de una:  ./scripts/ver-ejecuciones.sh --id <numero>{FIN}")
PY
