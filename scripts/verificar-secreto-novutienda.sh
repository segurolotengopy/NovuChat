#!/usr/bin/env bash
# Verifica, SIN MOSTRAR NI GUARDAR NINGÚN VALOR, la entrada de un comercio en el secreto NOVUTIENDA_CONFIRMAR
# (la que usa `confirmarPedidoExterno` para firmar el pedido de WhatsApp hacia NovuTienda).
#
#   ./scripts/verificar-secreto-novutienda.sh --tenant casa-bermejo --host novutienda-sitio-stg.web.app \
#       [--huella <8 hexadecimales>] [--proyecto <id>]
#
# Imprime SOLO «SÍ» o «NO» por punto, con la MISMA regla que `destinoDeNovuTienda` (confirmarExterno.ts):
#   1. el JSON del secreto es válido y trae la clave del comercio;
#   2. la entrada solo lleva las claves permitidas (baseUrl, firmaSecreto, bearer);
#   3. baseUrl es texto de hasta 2048 caracteres, https, con puerto válido, sin usuario, clave, query ni fragmento;
#   4. su host es EXACTAMENTE el indicado en --host (el que NovuTienda verificó por su lado);
#   5. firmaSecreto es texto de 8 caracteres o más;
#   6. bearer, si existe, es texto de 8 caracteres o más;
#   7. con --huella: los primeros 8 hexadecimales de sha256(firmaSecreto) coinciden con la huella dada por NovuTienda
#      (resumen unidireccional de 8 hexadecimales: no es el valor y no lo revela).
# El valor viaja de `gcloud` a python por una tubería: nunca a un archivo, a un argumento ni a la pantalla. Solo lee.
# Salida: 0 si todos los puntos pedidos son SÍ; 1 si alguno es NO; 2 por uso; 3 si gcloud no pudo leer el secreto.
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1

TENANT=""; HOST=""; HUELLA=""; PROYECTO="${NOVUCHAT_PROYECTO_CONSOLA:-novuchat-demo}"
while [ $# -gt 0 ]; do
  case "$1" in
    --tenant|--host|--huella|--proyecto)
      [ $# -ge 2 ] || { echo "✗ $1 requiere un valor" >&2; exit 2; }
      case "$1" in --tenant) TENANT="$2" ;; --host) HOST="$2" ;; --huella) HUELLA="$2" ;; --proyecto) PROYECTO="$2" ;; esac
      shift 2 ;;
    -h|--help)  sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "✗ Opción desconocida: $1" >&2; exit 2 ;;
  esac
done
[[ "$TENANT" =~ ^[a-z0-9][a-z0-9-]{2,59}$ ]] || { echo "✗ --tenant: id de comercio" >&2; exit 2; }
[[ "$HOST" =~ ^[a-z0-9.-]{3,253}$ ]] || { echo "✗ --host: nombre de host" >&2; exit 2; }
# WHATWG trata como dirección IPv4 todo host cuya última etiqueta es numérica (o 0x…): esos nombres no se aceptan como --host.
[[ "${HOST##*.}" =~ ^([0-9]+|0[xX][0-9a-fA-F]*)$ ]] && { echo "✗ --host: la última etiqueta no puede ser numérica" >&2; exit 2; }
[[ -z "$HUELLA" || "$HUELLA" =~ ^[0-9a-f]{8}$ ]] || { echo "✗ --huella: 8 hexadecimales" >&2; exit 2; }
[[ "$PROYECTO" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || { echo "✗ --proyecto: id de proyecto inválido" >&2; exit 2; }

# gcloud escribe en TEXTO PLANO todo lo que imprime en `$CLOUDSDK_CONFIG/logs/` (revisión de seguridad, 23/11/2026): sin desactivar ese log el
# valor del secreto quedaría en disco. Se limpian las variables CLOUDSDK_* heredadas (otra cuenta, otro log HTTP) y se desactiva el log en archivo.
CONFIG_GCLOUD="${CLOUDSDK_CONFIG:-$HOME/.config/gcloud-novuchat-prod}"
for v in "${!CLOUDSDK_@}"; do unset "$v"; done
export CLOUDSDK_CONFIG="$CONFIG_GCLOUD"
export CLOUDSDK_CORE_DISABLE_FILE_LOGGING=true
# El stderr de gcloud se descarta: no debe nombrar el proyecto ni el secreto. Los estados de las dos etapas se leen aparte
# para distinguir «gcloud no pudo leer» (3) de «el secreto no cumple» (1).
set +e
gcloud secrets versions access latest --secret=NOVUTIENDA_CONFIRMAR --project "$PROYECTO" 2>/dev/null \
  | TENANT="$TENANT" HOST="$HOST" HUELLA="$HUELLA" python3 -I -c '
import sys, os, json, hashlib
from urllib.parse import urlparse
try:
    raw = sys.stdin.buffer.read().decode("utf-8", "replace")
except Exception:
    raw = ""
sn = lambda b: "SÍ" if b else "NO"
resultados = []
try:
    def _no(c): raise ValueError(c)
    m = json.loads(raw, parse_constant=_no)  # JSON.parse rechaza NaN e Infinity: se rechazan igual
except Exception:
    print("1. JSON del secreto válido y clave del comercio presente: NO"); sys.exit(1)
t = m.get(os.environ["TENANT"]) if isinstance(m, dict) else None
ok = isinstance(t, dict)
print("1. JSON válido y clave del comercio presente:", sn(ok)); resultados.append(ok)
if not ok: sys.exit(1)
c = set(t) <= {"baseUrl", "firmaSecreto", "bearer"}
print("2. solo claves permitidas (baseUrl, firmaSecreto, bearer):", sn(c)); resultados.append(c)
bu = t.get("baseUrl")
h = d = False
try:
    if isinstance(bu, str) and len(bu.encode("utf-16-le", "surrogatepass")) // 2 <= 2048:
        u = urlparse(bu)
        u.port  # un puerto inválido lanza ValueError
        h = u.scheme == "https" and not u.username and not u.password and not u.query and not u.fragment and bool(u.hostname)
        d = u.hostname == os.environ["HOST"]
except Exception:
    h = d = False
print("3. baseUrl texto https, puerto válido, sin usuario, clave, query ni fragmento:", sn(h)); resultados.append(h)
print("4. host igual al verificado por NovuTienda:", sn(d)); resultados.append(d)
f = t.get("firmaSecreto")
l = isinstance(f, str) and len(f.encode("utf-16-le", "surrogatepass")) // 2 >= 8
print("5. firmaSecreto texto de 8 caracteres o más:", sn(l)); resultados.append(l)
b = "bearer" not in t or (isinstance(t["bearer"], str) and len(t["bearer"].encode("utf-16-le", "surrogatepass")) // 2 >= 8)
print("6. bearer ausente, o texto de 8 caracteres o más:", sn(b)); resultados.append(b)
if os.environ["HUELLA"]:
    try:
        x = l and hashlib.sha256(f.encode("utf-8", "surrogatepass")).hexdigest()[:8] == os.environ["HUELLA"]
    except Exception:
        x = False
    print("7. huella sha256[:8] de la firma coincide con la de NovuTienda:", sn(x)); resultados.append(x)
sys.exit(0 if all(resultados) else 1)
'
ESTADOS=("${PIPESTATUS[@]}")
set -e
if [ "${ESTADOS[0]}" -ne 0 ]; then echo "✗ no se pudo leer el secreto (gcloud: ¿sin sesión, sin permiso o secreto inexistente?)"; exit 3; fi
exit "${ESTADOS[1]}"
