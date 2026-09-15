#!/usr/bin/env bash
# Rotación del secreto de ingesta de un número, los pasos que tocan el VALOR,
# sin que el valor aparezca nunca en pantalla, en el historial ni en un archivo.
#
# Existe porque Andres autoriza y no opera: los pasos que antes le tocaban a
# una persona (comprobar el largo, pegar el valor en n8n) los hace este script,
# y lo corre Claude con su confirmación. Procedimiento completo y orden de los
# pasos: docs/produccion/rotar-secreto-ingesta.md.
#
#   ./scripts/rotar-ingesta.sh verificar --secreto INGESTA_CLIENTE01 --version 2
#       Largo del valor y si termina en salto de línea (debe ser 64 y sin salto).
#
#   ./scripts/rotar-ingesta.sh n8n --secreto INGESTA_CLIENTE01 --version 2 \
#       --credencial "NovuChat ingesta (alias del número)" --env .env.novuchat [--aplicar]
#       Carga `Bearer <valor>` en esa credencial Header Auth de n8n por la API.
#       Sin --aplicar solo comprueba que la credencial exista y sea única.
#
# Credenciales de gcloud: las aisladas del proyecto (CLOUDSDK_CONFIG propio).
# El valor viaja de gcloud a python por una tubería y de python a la API de n8n
# en el cuerpo del pedido; nunca se imprime.
set -euo pipefail

cd "$(dirname "$0")/.." || exit 1

MODO="${1:-}"; shift || true
SECRETO=""; VERSION=""; CREDENCIAL=""; ENV_FILE=".env"; APLICAR=0
PROYECTO="${PROYECTO:-novuchat-demo}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --secreto)    SECRETO="${2:?}"; shift 2 ;;
    --version)    VERSION="${2:?}"; shift 2 ;;
    --credencial) CREDENCIAL="${2:?}"; shift 2 ;;
    --env)        ENV_FILE="${2:?}"; shift 2 ;;
    --proyecto)   PROYECTO="${2:?}"; shift 2 ;;
    --aplicar)    APLICAR=1; shift ;;
    -h|--help)    sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Opción desconocida: $1" >&2; exit 2 ;;
  esac
done

[[ "$SECRETO" =~ ^INGESTA_[A-Z0-9]+$ ]] || { echo "✗ --secreto tiene que ser INGESTA_<ALIAS>" >&2; exit 2; }
[[ "$VERSION" =~ ^[0-9]+$ ]] || { echo "✗ --version tiene que ser un número (la que imprimió 'versions add')" >&2; exit 2; }

export CLOUDSDK_CONFIG="${CLOUDSDK_CONFIG:-$HOME/.config/gcloud-novuchat-prod}"
unset CLOUDSDK_ACTIVE_CONFIG_NAME

# El valor sale de acá y entra directo a python por la tubería.
leer_valor() {
  gcloud secrets versions access "$VERSION" --secret="$SECRETO" --project "$PROYECTO"
}

case "$MODO" in
  verificar)
    leer_valor | python3 -c '
import sys
v = sys.stdin.buffer.read()
salto = v.endswith(b"\n")
hexa = len(v) > 0 and all(c in b"0123456789abcdef" for c in v)
print("  %d bytes · termina en salto de línea: %s · solo hexadecimal: %s" % (len(v), salto, hexa))
sys.exit(0 if len(v) == 64 and not salto and hexa else 1)
' && echo "  ✓ versión $VERSION de $SECRETO: forma correcta" \
      || { echo "  ✗ versión $VERSION de $SECRETO: forma incorrecta (hay que crear otra versión, ver el procedimiento §Paso 3-4)"; exit 1; }
    ;;
  n8n)
    [[ -n "$CREDENCIAL" ]] || { echo "✗ falta --credencial" >&2; exit 2; }
    [[ -f "$ENV_FILE" ]] || { echo "✗ no existe $ENV_FILE" >&2; exit 1; }
    set -a; . "./$ENV_FILE"; set +a
    : "${N8N_API_KEY:?Falta N8N_API_KEY}"; : "${N8N_BASE_URL:?Falta N8N_BASE_URL}"
    # En modo diagnóstico no se lee el secreto: solo se busca la credencial.
    if [[ $APLICAR -eq 1 ]]; then FUENTE=leer_valor; else FUENTE=true; fi
    "$FUENTE" | APLICAR="$APLICAR" CREDENCIAL="$CREDENCIAL" python3 -c '
import json, os, sys, urllib.request, urllib.error
base = os.environ["N8N_BASE_URL"].rstrip("/") + "/api/v1"
H = {"X-N8N-API-KEY": os.environ["N8N_API_KEY"], "Content-Type": "application/json"}
def pedir(metodo, ruta, cuerpo=None):
    req = urllib.request.Request(base + ruta, method=metodo, headers=H,
                                 data=json.dumps(cuerpo).encode() if cuerpo is not None else None)
    try:
        return urllib.request.urlopen(req, timeout=30).status, None
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:200].decode("utf-8", "replace")
def listar():
    req = urllib.request.Request(base + "/credentials?limit=250", headers=H)
    return json.load(urllib.request.urlopen(req, timeout=30)).get("data", [])
nombre = os.environ["CREDENCIAL"]
halladas = [c for c in listar() if c.get("name") == nombre and c.get("type") == "httpHeaderAuth"]
if len(halladas) != 1:
    print(f"  ✗ credencial «{nombre}» de tipo Header Auth: {len(halladas)} encontradas (tiene que haber exactamente una)")
    sys.exit(1)
cid = halladas[0]["id"]
print(f"  credencial «{nombre}» encontrada (id …{cid[-4:]})")
if os.environ["APLICAR"] != "1":
    print("  Diagnóstico solamente: no se leyó el secreto ni se escribió nada. Agrega --aplicar.")
    sys.exit(0)
valor = sys.stdin.buffer.read().decode()
if len(valor) != 64 or valor.endswith("\n"):
    print("  ✗ el valor no tiene la forma esperada (64 caracteres, sin salto): no se escribe nada")
    sys.exit(1)
codigo, error = pedir("PATCH", f"/credentials/{cid}",
                      {"data": {"name": "Authorization", "value": "Bearer " + valor}})
del valor
if codigo != 200:
    print(f"  ✗ n8n respondió {codigo}: {error}")
    sys.exit(1)
print(f"  ✓ credencial actualizada (HTTP {codigo}). El flujo la lee en cada ejecución: no hace falta publicar.")
'
    ;;
  *)
    echo "Uso: $0 verificar|n8n --secreto INGESTA_<ALIAS> --version <N> [...]  (ver --help)" >&2; exit 2 ;;
esac
