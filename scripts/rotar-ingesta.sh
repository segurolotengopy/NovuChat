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
#   ./scripts/rotar-ingesta.sh probar --secreto INGESTA_CLIENTE01 --version 2 --env .env.novuchat
#       Hace el MISMO pedido que el nodo «Traer configuración» del flujo, con esa
#       clave: comprueba de punta a punta que el servidor la acepta y qué oferta
#       devuelve. No escribe nada. Solo informa conteos, nunca el valor.
#
#   ./scripts/rotar-ingesta.sh n8n --secreto INGESTA_CLIENTE01 --version 2 \
#       --credencial "NovuChat ingesta (alias del número)" --env .env.novuchat [--aplicar]
#       Carga `Bearer <valor>` en esa credencial Header Auth de n8n por la API.
#       Sin --aplicar solo comprueba que la credencial exista y sea única.
#
#   ./scripts/rotar-ingesta.sh crear --secreto INGESTA_CLIENTE05 --version 1 \
#       --credencial "NovuChat ingesta (Ruben)" --proyecto <proyecto de la consola> \
#       --env .env.novuchat [--aplicar]
#       CREA en n8n (API pública) la credencial Header Auth (name del header
#       `Authorization`, valor `Bearer <valor>`) cuando NO existe, para un cliente
#       real nuevo. Seco por omisión: comprueba la forma del secreto (64 hexadecimales,
#       sin salto; sin imprimirlo), que NO exista ya una credencial con ese nombre
#       (de cualquier tipo) y qué se crearía. Con --aplicar crea una sola vez, relee
#       y confirma que existe, es única y de tipo httpHeaderAuth. Si ya existe, o hay
#       duplicadas, se niega sin escribir (para cargar el valor en una existente, modo n8n).
#       El nombre debe ser «NovuChat ingesta (<alias>)». --proyecto es obligatorio
#       (los secretos de clientes reales viven en el proyecto de la consola) y no se imprime.
#
# Credenciales de gcloud: las aisladas del proyecto (CLOUDSDK_CONFIG propio).
# El valor viaja de gcloud a python por una tubería y de python a la API de n8n
# en el cuerpo del pedido; nunca se imprime.
set -euo pipefail

cd "$(dirname "$0")/.." || exit 1

MODO="${1:-}"; shift || true
SECRETO=""; VERSION=""; CREDENCIAL=""; ENV_FILE=".env"; APLICAR=0; PROYECTO_EXPLICITO=0
PROYECTO="${PROYECTO:-novuchat-demo}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --secreto)    SECRETO="${2:?}"; shift 2 ;;
    --version)    VERSION="${2:?}"; shift 2 ;;
    --credencial) CREDENCIAL="${2:?}"; shift 2 ;;
    --env)        ENV_FILE="${2:?}"; shift 2 ;;
    --proyecto)   PROYECTO="${2:?}"; PROYECTO_EXPLICITO=1; shift 2 ;;
    --aplicar)    APLICAR=1; shift ;;
    -h|--help)    sed -n '2,35p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Opción desconocida: $1" >&2; exit 2 ;;
  esac
done

[[ "$SECRETO" =~ ^INGESTA_[A-Z0-9]+$ ]] || { echo "✗ --secreto tiene que ser INGESTA_<ALIAS>" >&2; exit 2; }
[[ "$VERSION" =~ ^[0-9]+$ ]] || { echo "✗ --version tiene que ser un número (la que imprimió 'versions add')" >&2; exit 2; }

if [[ "$MODO" == "crear" ]]; then
  [[ $PROYECTO_EXPLICITO -eq 1 && -n "$PROYECTO" ]] || { echo "✗ crear exige --proyecto (sin valor por omisión)" >&2; exit 2; }
  [[ -n "$CREDENCIAL" ]] || { echo "✗ falta --credencial" >&2; exit 2; }
  [[ "$CREDENCIAL" =~ ^NovuChat\ ingesta\ \([A-Za-z0-9_-]+\)$ ]] || { echo "✗ --credencial tiene que ser «NovuChat ingesta (<alias>)»" >&2; exit 2; }
fi

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
# Sin la cadena de dígitos literal: el control de saneo del repositorio público
# la lee como una secuencia larga de dígitos.
hexa = len(v) > 0 and all(48 <= c <= 57 or 97 <= c <= 102 for c in v)
print("  %d bytes · termina en salto de línea: %s · solo hexadecimal: %s" % (len(v), salto, hexa))
sys.exit(0 if len(v) == 64 and not salto and hexa else 1)
' && echo "  ✓ versión $VERSION de $SECRETO: forma correcta" \
      || { echo "  ✗ versión $VERSION de $SECRETO: forma incorrecta (hay que crear otra versión, ver el procedimiento §Paso 3-4)"; exit 1; }
    ;;
  probar)
    [[ -f "$ENV_FILE" ]] || { echo "✗ no existe $ENV_FILE" >&2; exit 1; }
    set -a
    # shellcheck disable=SC1090  # ruta variable: la elige --env
    . "./$ENV_FILE"
    set +a
    : "${WA_PHONE_ID:?Falta WA_PHONE_ID en el entorno}"
    URL="${URL_CONFIG:-https://us-east1-novuchat-demo.cloudfunctions.net/configuracionFlujo}"
    leer_valor | URL="$URL" python3 -c '
import json, os, sys, urllib.request, urllib.error
valor = sys.stdin.buffer.read().decode().strip()
cuerpo = json.dumps({"telefono": ""}).encode()
req = urllib.request.Request(os.environ["URL"], data=cuerpo, method="POST", headers={
    "Authorization": "Bearer " + valor,
    "X-NovuChat-Numero": os.environ["WA_PHONE_ID"],
    "Content-Type": "application/json",
})
del valor
try:
    r = urllib.request.urlopen(req, timeout=60)
    d = json.load(r)
except urllib.error.HTTPError as e:
    print("  ✗ el servidor respondió %s: la clave no sirve o el número no está asignado" % e.code)
    sys.exit(1)
onb = d.get("onboarding") or {}
voz = d.get("voz") or {}
print("  ✓ el servidor aceptó la clave (HTTP %s), comercio %s, flujo %s" % (r.status, d.get("tenantId"), d.get("flujo")))
print("    nombre del asistente: %r · emojis: %r" % (voz.get("nombreAsistente"), voz.get("nivelEmojis")))
print("    oferta: %d rubros · %d planes · %d cargos únicos · %d aclaraciones · archivo: %s"
      % (len(onb.get("rubros") or []), len(onb.get("planes") or []), len(onb.get("cargosUnicos") or []),
         len(onb.get("aclaraciones") or []), bool(onb.get("archivoPlanes"))))
print("    claves de onboarding: %s" % sorted(onb.keys()))
'
    ;;
  n8n)
    [[ -n "$CREDENCIAL" ]] || { echo "✗ falta --credencial" >&2; exit 2; }
    [[ -f "$ENV_FILE" ]] || { echo "✗ no existe $ENV_FILE" >&2; exit 1; }
    set -a
    # shellcheck disable=SC1090  # ruta variable: la elige --env
    . "./$ENV_FILE"
    set +a
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
  crear)
    [[ -f "$ENV_FILE" ]] || { echo "✗ no existe $ENV_FILE" >&2; exit 1; }
    set -a
    # shellcheck disable=SC1090  # ruta variable: la elige --env
    . "./$ENV_FILE"
    set +a
    : "${N8N_API_KEY:?Falta N8N_API_KEY}"; : "${N8N_BASE_URL:?Falta N8N_BASE_URL}"
    # El valor se lee siempre (el seco comprueba su forma) y va solo por la tubería.
    # El stderr de gcloud se descarta: no debe nombrar el proyecto ni el secreto.
    { leer_valor 2>/dev/null || true; } | APLICAR="$APLICAR" CREDENCIAL="$CREDENCIAL" python3 -c '
import json, os, sys, urllib.request, urllib.error
base = os.environ["N8N_BASE_URL"].rstrip("/") + "/api/v1"
H = {"X-N8N-API-KEY": os.environ["N8N_API_KEY"], "Content-Type": "application/json"}
def pedir(metodo, ruta, cuerpo=None):
    req = urllib.request.Request(base + ruta, method=metodo, headers=H,
                                 data=json.dumps(cuerpo).encode() if cuerpo is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, None
    except Exception:
        return 0, None
def listar():
    codigo, d = pedir("GET", "/credentials?limit=250")
    if codigo != 200 or not isinstance(d, dict):
        print(f"  ✗ n8n no devolvió la lista de credenciales (HTTP {codigo})")
        sys.exit(1)
    return d.get("data", [])
nombre = os.environ["CREDENCIAL"]
valor = sys.stdin.buffer.read().decode("utf-8", "replace")
if not (len(valor) == 64 and all(c in "0123456789abcdef" for c in valor)):
    print("  ✗ el secreto no tiene la forma esperada (64 hexadecimales, sin salto) o no se pudo leer: no se escribe nada")
    sys.exit(1)
print("  ✓ el secreto tiene la forma esperada")
mismas = [c for c in listar() if c.get("name") == nombre]
if mismas:
    print(f"  ✗ ya hay {len(mismas)} credencial(es) llamadas «{nombre}»: no se crea nada (para cargar el valor en una existente, modo n8n)")
    sys.exit(1)
print(f"  ✓ no existe ninguna credencial «{nombre}»")
print("  Se crearía: tipo httpHeaderAuth, header «Authorization», valor «Bearer <secreto>»")
if os.environ["APLICAR"] != "1":
    print("  Diagnóstico solamente: no se escribió nada. Agrega --aplicar.")
    sys.exit(0)
codigo, _ = pedir("POST", "/credentials", {"name": nombre, "type": "httpHeaderAuth",
                                           "data": {"name": "Authorization", "value": "Bearer " + valor}})
del valor
if codigo not in (200, 201):
    print(f"  ✗ n8n respondió {codigo} al crear la credencial")
    sys.exit(1)
tras = [c for c in listar() if c.get("name") == nombre]
if len(tras) != 1 or tras[0].get("type") != "httpHeaderAuth":
    print(f"  ✗ tras crear, se hallaron {len(tras)} credenciales «{nombre}» (tiene que haber una de tipo httpHeaderAuth): revisar en n8n")
    sys.exit(1)
cid = str(tras[0].get("id"))
print(f"  ✓ credencial «{nombre}» creada, única y de tipo httpHeaderAuth (id …{cid[-4:]})")
'
    ;;
  *)
    echo "Uso: $0 verificar|n8n|crear --secreto INGESTA_<ALIAS> --version <N> [...]  (ver --help)" >&2; exit 2 ;;
esac
