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
#   ./scripts/ver-ejecuciones.sh --id 123 --nodo 'Normalizar entrada' --campos tipo,esComprobante
#
# NO imprime el contenido de los mensajes salvo que se pida un nodo concreto:
# por ahi pasan conversaciones de clientes finales.
set -euo pipefail

cd "$(dirname "$0")/.." || exit 1
N=10; SOLO_ERROR=0; ID=""; NODO=""; CAMPOS=""; ENV_FILE=".env"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --n)     N="${2:?}"; shift 2 ;;
    --error) SOLO_ERROR=1; shift ;;
    --id)    ID="${2:?}"; shift 2 ;;
    --nodo)  NODO="${2:?}"; shift 2 ;;
    --campos) CAMPOS="${2:?--campos necesita una lista separada por comas}"; shift 2 ;;
    --env)   ENV_FILE="${2:?--env necesita un archivo}"; shift 2 ;;
    --env=*) ENV_FILE="${1#*=}"; shift ;;
    -h|--help) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
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

# LA LISTA NO PIDE LOS DATOS (2026-09-23). `includeData=true` en la lista trae
# el contenido de CADA ejecucion: con un flujo de 96 nodos son ~270 kB por
# ejecucion, y pedir 40 son 12,7 MB que no entran en ningun `--max-time`
# razonable. Se pedia solo para poder nombrar el nodo que fallo en el resumen.
# Ahora la lista viene pelada —rapida y de tamano fijo— y el detalle se busca
# UNA POR UNA, solo para las que fallaron, que son las pocas que importan.
if [[ -n "$ID" ]]; then
  URL="${API}/executions/${ID}?includeData=true"
else
  URL="${API}/executions?workflowId=${N8N_WORKFLOW_ID}&limit=${N}"
  [[ $SOLO_ERROR -eq 1 ]] && URL="${URL}&status=error"
fi

# EL CODIGO DE CURL Y EL CODIGO HTTP SON DOS COSAS (2026-09-23). Antes esto
# decia `... || echo 000`, que dentro de `$( )` no REEMPLAZA el valor: lo
# CONCATENA. Con un HTTP 200 y un curl que terminaba mal, COD valia «200000»,
# el script moria diciendo «HTTP 200000» y el motivo real —que es el que
# importa— no se imprimia nunca. Costo una tarde de diagnostico a ciegas.
#
# Y LA LISTA PIDE LOS DATOS DE CADA EJECUCION. Con `includeData=true`, una sola
# ejecucion de un flujo de 96 nodos pesa ~270 kB: veinte son 5 MB y el
# `--max-time` de 40 s se quedaba corto. El tiempo sube y se explica aparte,
# porque el sintoma (una lista vacia) no se parece a la causa (un timeout).
SALIDA=0
COD=$(curl -sS --max-time 180 -o "$TMP" -w '%{http_code}' \
      -H "X-N8N-API-KEY: ${N8N_API_KEY}" "$URL") || SALIDA=$?
if [[ "$SALIDA" -ne 0 ]]; then
  printf '\033[1;31m✗ curl terminó con %s\033[0m (HTTP %s)\n' "$SALIDA" "${COD:-sin código}"
  [[ "$SALIDA" -eq 28 ]] && printf '  Se agotó el tiempo. Probá con --n más chico: la lista trae los datos de cada ejecución.\n'
  head -c 300 "$TMP"; echo; exit 1
fi
if [[ "$COD" != "200" ]]; then
  printf '\033[1;31m✗ HTTP %s\033[0m\n' "$COD"; head -c 300 "$TMP"; echo; exit 1
fi

# EL DETALLE, SOLO DE LAS QUE FALLARON. La lista ya no trae datos, asi que el
# nodo que reventó se busca de a una. Son pocas, y si fueran muchas el limite
# de `--n` ya acota el gasto.
DETALLES="$(mktemp -d)"; trap 'rm -f "$TMP"; rm -rf "$DETALLES"' EXIT
if [[ -z "$ID" ]]; then
  for FALLIDA in $(python3 -c '
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
for e in d.get("data", []):
    if e.get("status") == "error" or e.get("stoppedAt") is None:
        print(e.get("id"))
' "$TMP"); do
    curl -sS --max-time 60 -o "$DETALLES/${FALLIDA}.json" \
      -H "X-N8N-API-KEY: ${N8N_API_KEY}" \
      "${API}/executions/${FALLIDA}?includeData=true" || true
  done
fi

ID="$ID" NODO="$NODO" CAMPOS="$CAMPOS" DETALLES="$DETALLES" python3 - "$TMP" <<'PY'
import json, os, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
uno, nodo_pedido = os.environ.get("ID", ""), os.environ.get("NODO", "")
# --campos a,b,c: solo esas claves de cada item, completas. El recorte de 400
# caracteres dejaba afuera justo los campos que deciden una rama (20/09/2026),
# y pedir solo algunos imprime MENOS contenido del cliente, no mas.
campos = [c.strip() for c in os.environ.get("CAMPOS", "").split(",") if c.strip()]
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
    # La lista viene sin datos: el detalle de una fallida se bajó aparte.
    datos = e.get("data")
    if datos is None:
        ruta = os.path.join(os.environ.get("DETALLES", ""), f"{e.get('id')}.json")
        if os.path.isfile(ruta):
            try:
                datos = (json.load(open(ruta, encoding="utf-8")) or {}).get("data")
            except (ValueError, OSError):
                datos = None
    nodo, msg = error_de(datos)
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
                    j = it.get('json', {})
                    if campos:
                        print(f"      {G}{json.dumps({k: j.get(k, '(no está)') for k in campos}, ensure_ascii=False)}{FIN}")
                    else:
                        print(f"      {G}{json.dumps(j, ensure_ascii=False)[:400]}{FIN}")
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
