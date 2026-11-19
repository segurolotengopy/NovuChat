#!/usr/bin/env bash
# Crea en n8n, por la API pública, la credencial Header Auth del CATÁLOGO de NovuTienda
# de un comercio (p. ej. «NovuTienda catálogo (Casa Bermejo prueba)»): `Authorization: Bearer <token>`,
# leyendo el token de un ARCHIVO local de modo 600 que entrega la sesión de NovuTienda. Seco por
# omisión. El valor NO se imprime, NO viaja en argumentos ni en el entorno de ningún proceso y
# NO se escribe en otro archivo.
#
# POR QUÉ EXISTE. Andres autoriza y Claude opera: el token del catálogo no pasa por un chat. Es el
# gemelo de `scripts/rotar-ingesta.sh crear` (que crea la credencial de INGESTA desde Secret Manager;
# usarlo para `INGESTA_CLIENTE10`) para un token que llega por archivo. NO toca el token de WhatsApp
# (Graph), que es de WhatsApp-Modular, ni modifica una credencial existente.
#
#   ./scripts/cargar-credencial-catalogo.sh --nombre "NovuTienda catálogo (Casa Bermejo prueba)" \
#       --archivo <ruta del archivo del token> [--env .env.<ref>] [--conservar]
#       SECO: comprueba el archivo (modo 600, no es un enlace, una sola línea de 8 a 512 caracteres
#       imprimibles, sin imprimirlo), que n8n responde y que NO existe una credencial con ese nombre
#       (de cualquier tipo, recorriendo todas las páginas). No escribe nada.
#   ... --aplicar --confirmo "<el mismo nombre>"
#       CREA una sola vez, relee y comprueba que existe, es única y de tipo httpHeaderAuth. Solo si
#       todo coincide BORRA el archivo del token (salvo --conservar). Si algo falla, el archivo se
#       CONSERVA. Si el pedido de creación falla o se agota, sale 3: verificar en n8n antes de reintentar.
#
# Se niega (sale 2, sin llamar a n8n) si falta el nombre o el archivo, si el nombre no tiene la forma
# «NovuTienda catálogo (<comercio>)» o si --aplicar viene sin --confirmo igual al nombre. Si ya existe
# una credencial con ese nombre, se niega (sale 1) sin escribir: no hay --forzar, porque dos credenciales
# con el mismo nombre dejan ambiguo el flujo que las resuelve por nombre.
# La llave de la API de n8n se lee del archivo --env (N8N_API_KEY, N8N_BASE_URL), sin imprimirla.
set -euo pipefail

cd "$(dirname "$0")/.." || exit 1

NOMBRE=""; ARCHIVO=""; ENV_FILE=".env"; APLICAR=0; CONSERVAR=0; CONFIRMO=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --nombre)    [[ $# -ge 2 ]] || { echo "✗ --nombre necesita un valor" >&2; exit 2; }; NOMBRE="$2"; shift 2 ;;
    --archivo)   [[ $# -ge 2 ]] || { echo "✗ --archivo necesita un valor" >&2; exit 2; }; ARCHIVO="$2"; shift 2 ;;
    --env)       [[ $# -ge 2 ]] || { echo "✗ --env necesita un valor" >&2; exit 2; }; ENV_FILE="$2"; shift 2 ;;
    --confirmo)  [[ $# -ge 2 ]] || { echo "✗ --confirmo necesita un valor" >&2; exit 2; }; CONFIRMO="$2"; shift 2 ;;
    --aplicar)   APLICAR=1; shift ;;
    --conservar) CONSERVAR=1; shift ;;
    -h|--help)   sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Opción desconocida: ${1%%=*}" >&2; exit 2 ;;
  esac
done

[[ -n "$NOMBRE" ]] || { echo "✗ falta --nombre" >&2; exit 2; }
[[ -n "$ARCHIVO" ]] || { echo "✗ falta --archivo (la ruta del archivo con el token)" >&2; exit 2; }
[[ "$NOMBRE" =~ ^NovuTienda\ catálogo\ \([A-Za-z0-9\ _-]+\)$ ]] || { echo "✗ --nombre tiene que ser «NovuTienda catálogo (<comercio>)»" >&2; exit 2; }
if [[ $APLICAR -eq 1 ]]; then
  [[ "$CONFIRMO" == "$NOMBRE" ]] || { echo "✗ --aplicar exige --confirmo \"$NOMBRE\" (igual al nombre pedido)" >&2; exit 2; }
fi
[[ -f "$ENV_FILE" ]] || { echo "✗ no existe $ENV_FILE" >&2; exit 1; }
set -a
# shellcheck disable=SC1090  # ruta variable: la elige --env
. "./$ENV_FILE"
set +a
: "${N8N_API_KEY:?Falta N8N_API_KEY}"; : "${N8N_BASE_URL:?Falta N8N_BASE_URL}"

# El token lo lee SOLO python, del archivo (nunca por argumentos ni por el entorno).
APLICAR="$APLICAR" CONSERVAR="$CONSERVAR" NOMBRE="$NOMBRE" ARCHIVO="$ARCHIVO" python3 -c '
import json, os, stat, sys, urllib.parse, urllib.request, urllib.error
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
    # Recorre todas las páginas (nextCursor): un duplicado en la segunda no puede pasar inadvertido.
    todas, cursor = [], None
    while True:
        ruta = "/credentials?limit=100" + ("&cursor=" + urllib.parse.quote(cursor, safe="") if cursor else "")
        codigo, d = pedir("GET", ruta)
        if codigo != 200 or not isinstance(d, dict):
            print(f"  ✗ n8n no devolvió la lista de credenciales (HTTP {codigo}): no se escribe nada; el archivo del token se conserva")
            sys.exit(1)
        todas += d.get("data", [])
        cursor = d.get("nextCursor")
        if not cursor:
            return todas
nombre = os.environ["NOMBRE"]
ruta_archivo = os.environ["ARCHIVO"]
aplicar = os.environ["APLICAR"] == "1"
conservar = os.environ["CONSERVAR"] == "1"
# 1. El archivo: existe, no es un enlace, modo 600, es del usuario, tamaño razonable.
try:
    st = os.lstat(ruta_archivo)
except OSError:
    print("  ✗ no se puede leer el archivo del token (no existe o no hay permiso): no se escribe nada")
    sys.exit(1)
if not stat.S_ISREG(st.st_mode):
    print("  ✗ el archivo del token no es un archivo regular (¿un enlace?): no se escribe nada")
    sys.exit(1)
if st.st_uid != os.getuid() or (st.st_mode & 0o077) != 0:
    print("  ✗ el archivo del token tiene que ser del usuario y de modo 600: no se escribe nada")
    sys.exit(1)
if st.st_size < 8 or st.st_size > 513:
    print("  ✗ el archivo del token no tiene el largo esperado (8 a 512 caracteres): no se escribe nada")
    sys.exit(1)
fd = os.open(ruta_archivo, os.O_RDONLY | os.O_NOFOLLOW)
try:
    crudo = os.read(fd, 1024)
finally:
    os.close(fd)
valor = crudo.decode("utf-8", "replace")
if valor.endswith("\n"):
    valor = valor[:-1]
if not (8 <= len(valor) <= 512 and all(33 <= ord(c) < 127 for c in valor)):
    print("  ✗ el contenido del archivo no tiene la forma de un token (una sola línea, sin espacios, solo ASCII imprimible): no se escribe nada")
    sys.exit(1)
print(f"  ✓ el archivo del token tiene la forma esperada ({len(valor)} caracteres, modo 600)")
# 2. n8n: no existe ya una credencial con ese nombre (de cualquier tipo).
mismas = [c for c in listar() if c.get("name") == nombre]
if mismas:
    print(f"  ✗ ya hay {len(mismas)} credencial(es) llamadas «{nombre}»: no se crea nada; el archivo del token se conserva")
    sys.exit(1)
print(f"  ✓ no existe ninguna credencial «{nombre}»")
print("  Se crearía: tipo httpHeaderAuth, header «Authorization», valor «Bearer <token>»")
if not aplicar:
    print("  Diagnóstico solamente: no se escribió nada. Agrega --aplicar --confirmo \"<nombre>\".")
    sys.exit(0)
# 3. Crear una sola vez.
codigo, _ = pedir("POST", "/credentials", {"name": nombre, "type": "httpHeaderAuth",
                                           "data": {"name": "Authorization", "value": "Bearer " + valor}})
del valor, crudo
if codigo not in (200, 201):
    print(f"  ✗ el pedido de creación falló (HTTP {codigo}; 0 = error de red o tiempo agotado): verificar en n8n antes de reintentar, porque la credencial pudo crearse; el archivo del token se conserva")
    sys.exit(3)
tras = [c for c in listar() if c.get("name") == nombre]
if len(tras) != 1 or tras[0].get("type") != "httpHeaderAuth":
    print(f"  ✗ tras crear, se hallaron {len(tras)} credenciales «{nombre}» (tiene que haber una de tipo httpHeaderAuth): revisar en n8n; el archivo del token se conserva")
    sys.exit(1)
cid = str(tras[0].get("id"))
print(f"  ✓ credencial «{nombre}» creada, única y de tipo httpHeaderAuth (id …{cid[-4:]})")
if conservar:
    print("  El archivo del token se conserva (--conservar).")
else:
    try:
        os.unlink(ruta_archivo)
        print("  ✓ archivo del token borrado")
    except OSError:
        print("  ! no se pudo borrar el archivo del token: bórralo a mano")
        sys.exit(1)
'
