#!/usr/bin/env bash
# Verifica, SIN MOSTRAR NI GUARDAR NINGÚN VALOR, la entrada de un comercio en el secreto NOVUTIENDA_CONFIRMAR
# (la que usa `confirmarPedidoExterno` para firmar el pedido de WhatsApp hacia NovuTienda).
#
#   ./scripts/verificar-secreto-novutienda.sh --tenant casa-bermejo --host novutienda-sitio-stg.web.app \
#       [--huella 454f6d22] [--proyecto <id>]
#
# Imprime SOLO «SÍ» o «NO» por punto:
#   1. el JSON del secreto es válido y trae la clave del comercio;
#   2. la entrada solo lleva las claves permitidas (baseUrl, firmaSecreto, bearer), como exige `destinoDeNovuTienda`;
#   3. baseUrl es https, sin usuario, clave, query ni fragmento;
#   4. su host es EXACTAMENTE el indicado en --host (el que NovuTienda verificó por su lado);
#   5. firmaSecreto tiene 8 caracteres o más;
#   6. con --huella: los primeros 8 hexadecimales de sha256(firmaSecreto) coinciden con la huella dada por NovuTienda
#      (la huella es un resumen unidireccional de 8 hexadecimales: no es el valor y no lo revela).
# El valor viaja de `gcloud` a python por una tubería: nunca a un archivo, a un argumento ni a la pantalla. Solo lee.
# Salida: 0 si todos los puntos pedidos son SÍ; 1 si alguno es NO; 2 por uso.
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1

TENANT=""; HOST=""; HUELLA=""; PROYECTO="${NOVUCHAT_PROYECTO_CONSOLA:-novuchat-demo}"
while [ $# -gt 0 ]; do
  case "$1" in
    --tenant)   TENANT="${2:?}"; shift 2 ;;
    --host)     HOST="${2:?}"; shift 2 ;;
    --huella)   HUELLA="${2:?}"; shift 2 ;;
    --proyecto) PROYECTO="${2:?}"; shift 2 ;;
    -h|--help)  sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "✗ Opción desconocida: $1" >&2; exit 2 ;;
  esac
done
[[ "$TENANT" =~ ^[a-z0-9][a-z0-9-]{2,59}$ ]] || { echo "✗ --tenant: id de comercio" >&2; exit 2; }
[[ "$HOST" =~ ^[a-z0-9.-]{3,253}$ ]] || { echo "✗ --host: nombre de host" >&2; exit 2; }
[[ -z "$HUELLA" || "$HUELLA" =~ ^[0-9a-f]{8}$ ]] || { echo "✗ --huella: 8 hexadecimales" >&2; exit 2; }

export CLOUDSDK_CONFIG="${CLOUDSDK_CONFIG:-$HOME/.config/gcloud-novuchat-prod}"
# El stderr de gcloud se descarta: no debe nombrar el proyecto ni el secreto.
gcloud secrets versions access latest --secret=NOVUTIENDA_CONFIRMAR --project "$PROYECTO" 2>/dev/null \
  | TENANT="$TENANT" HOST="$HOST" HUELLA="$HUELLA" python3 -I -c '
import sys, os, json, hashlib
from urllib.parse import urlparse
raw = sys.stdin.read()
sn = lambda b: "SÍ" if b else "NO"
resultados = []
try:
    m = json.loads(raw)
except Exception:
    print("1. JSON del secreto válido: NO"); sys.exit(1)
t = m.get(os.environ["TENANT"]) if isinstance(m, dict) else None
ok = isinstance(t, dict)
print("1. JSON válido y clave del comercio presente:", sn(ok)); resultados.append(ok)
if not ok: sys.exit(1)
c = set(t) <= {"baseUrl", "firmaSecreto", "bearer"}
print("2. solo claves permitidas (baseUrl, firmaSecreto, bearer):", sn(c)); resultados.append(c)
u = urlparse(str(t.get("baseUrl", "")))
h = u.scheme == "https" and not u.username and not u.password and not u.query and not u.fragment and bool(u.hostname)
print("3. baseUrl https sin usuario, clave, query ni fragmento:", sn(h)); resultados.append(h)
d = u.hostname == os.environ["HOST"]
print("4. host igual al verificado por NovuTienda:", sn(d)); resultados.append(d)
f = t.get("firmaSecreto", "")
l = isinstance(f, str) and len(f) >= 8
print("5. firmaSecreto de 8 caracteres o más:", sn(l)); resultados.append(l)
if os.environ["HUELLA"]:
    x = l and hashlib.sha256(f.encode()).hexdigest()[:8] == os.environ["HUELLA"]
    print("6. huella sha256[:8] de la firma coincide con la de NovuTienda:", sn(x)); resultados.append(x)
sys.exit(0 if all(resultados) else 1)
'
