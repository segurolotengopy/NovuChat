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
#
# NO imprime el contenido de los mensajes salvo que se pida un nodo concreto:
# por ahi pasan conversaciones de clientes finales.
set -euo pipefail

cd "$(dirname "$0")/.."
N=10; SOLO_ERROR=0; ID=""; NODO=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --n)     N="${2:?}"; shift 2 ;;
    --error) SOLO_ERROR=1; shift ;;
    --id)    ID="${2:?}"; shift 2 ;;
    --nodo)  NODO="${2:?}"; shift 2 ;;
    -h|--help) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Opcion desconocida: $1" >&2; exit 2 ;;
  esac
done

[[ -f .env ]] || { echo "✗ Falta .env"; exit 1; }
set -a; . ./.env; set +a
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

ID="$ID" NODO="$NODO" python3 - "$TMP" <<'PY'
import json, os, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
uno, nodo_pedido = os.environ.get("ID", ""), os.environ.get("NODO", "")
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
