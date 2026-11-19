#!/usr/bin/env bash
# Crea en n8n, por la API pública, la credencial Header Auth «Entrada de prueba <Comercio>»
# (p. ej. «Entrada de prueba Casa Bermejo»): la clave con la que se autentican los mensajes SIMULADOS
# que entran por la «Entrada de prueba» del flujo de prueba de un comercio (`Authorization: Bearer <clave>`).
#
# ESTE SCRIPT GENERA LA CLAVE: 32 bytes de `os.urandom`, en base64url. La clave se escribe SOLO en un
# archivo local de modo 600 y se envía a n8n; NO se imprime, NO viaja en argumentos ni en el entorno de
# ningún proceso. QUIEN LA LEE ES QUIEN LANZA LA PRUEBA (lee ese archivo y manda la cabecera); el archivo
# se conserva hasta que esa persona lo borre. No es un token de WhatsApp ni de NovuTienda: solo abre la
# entrada de prueba, que no existe en la variante de producción.
#
# Gemelo de `scripts/cargar-credencial-catalogo.sh` (que carga un token que ya existe, desde un archivo).
#
#   ./scripts/crear-credencial-entrada-prueba.sh --nombre "Entrada de prueba Casa Bermejo" \
#       --archivo <ruta NUEVA del archivo de la clave> [--env .env.<ref>]
#       SECO: comprueba que la carpeta del archivo es del usuario y de modo 700 (nunca un /tmp compartido),
#       que el archivo NO existe, que n8n responde y que NO existe una credencial con ese nombre (de
#       cualquier tipo, recorriendo todas las páginas). No escribe nada.
#   ... --aplicar --confirmo "<el mismo nombre>"
#       GENERA la clave, crea el archivo (O_EXCL, sin seguir enlaces, modo 600) y SOLO ENTONCES crea la
#       credencial, una sola vez; relee y comprueba que existe, es única y de tipo httpHeaderAuth.
#       El archivo SIEMPRE se conserva. Si el pedido de creación falla o se agota, sale 3: verificar en n8n
#       antes de reintentar (la credencial pudo crearse y el archivo tiene la clave).
#
# Se niega (sale 2, sin llamar a n8n) si falta el nombre o el archivo, si el nombre no tiene la forma
# «Entrada de prueba <Comercio>» o si --aplicar viene sin --confirmo igual al nombre. Si ya existe una
# credencial con ese nombre, o el archivo, se niega (sale 1) sin escribir: no hay --forzar.
# La llave de la API de n8n se lee del archivo --env (solo N8N_API_KEY y N8N_BASE_URL; el archivo NO se ejecuta),
# sin imprimirla. No sigue redirecciones, no usa proxies y exige https salvo 127.0.0.1/localhost.
# --archivo y --env pueden ser relativos: se resuelven contra el directorio desde donde se llama.
set -euo pipefail

# Las rutas relativas se resuelven contra el directorio de quien llama, ANTES de entrar a la raíz del repositorio.
ORIGEN="$PWD"
absoluta() { case "$1" in /*) printf '%s' "$1" ;; *) printf '%s/%s' "$ORIGEN" "$1" ;; esac; }

cd "$(dirname "$0")/.." || exit 1

NOMBRE=""; ARCHIVO=""; ENV_FILE=""; APLICAR=0; CONFIRMO=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --nombre)    [[ $# -ge 2 ]] || { echo "✗ --nombre necesita un valor" >&2; exit 2; }; NOMBRE="$2"; shift 2 ;;
    --archivo)   [[ $# -ge 2 ]] || { echo "✗ --archivo necesita un valor" >&2; exit 2; }; ARCHIVO="$2"; shift 2 ;;
    --env)       [[ $# -ge 2 ]] || { echo "✗ --env necesita un valor" >&2; exit 2; }; ENV_FILE="$2"; shift 2 ;;
    --confirmo)  [[ $# -ge 2 ]] || { echo "✗ --confirmo necesita un valor" >&2; exit 2; }; CONFIRMO="$2"; shift 2 ;;
    --aplicar)   APLICAR=1; shift ;;
    -h|--help)   sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Opción desconocida: ${1%%=*}" >&2; exit 2 ;;
  esac
done

[[ -n "$NOMBRE" ]] || { echo "✗ falta --nombre" >&2; exit 2; }
[[ -n "$ARCHIVO" ]] || { echo "✗ falta --archivo (la ruta NUEVA donde se guardará la clave)" >&2; exit 2; }
ARCHIVO="$(absoluta "$ARCHIVO")"
if [[ -n "$ENV_FILE" ]]; then ENV_FILE="$(absoluta "$ENV_FILE")"; else ENV_FILE="$PWD/.env"; fi
[[ "$NOMBRE" =~ ^Entrada\ de\ prueba\ [A-Za-z0-9][A-Za-z0-9\ _-]*$ ]] || { echo "✗ --nombre tiene que ser «Entrada de prueba <Comercio>»" >&2; exit 2; }
if [[ $APLICAR -eq 1 ]]; then
  [[ "$CONFIRMO" == "$NOMBRE" ]] || { echo "✗ --aplicar exige --confirmo \"$NOMBRE\" (igual al nombre pedido)" >&2; exit 2; }
fi
[[ -f "$ENV_FILE" ]] || { echo "✗ no existe el archivo --env" >&2; exit 1; }

# La clave la genera y la maneja SOLO python (nunca por argumentos ni por el entorno).
APLICAR="$APLICAR" NOMBRE="$NOMBRE" ARCHIVO="$ARCHIVO" ENV_FILE="$ENV_FILE" python3 -c '
import base64, json, os, re, stat, sys, urllib.parse, urllib.request, urllib.error
# 0. El archivo --env NO se ejecuta: solo se leen N8N_API_KEY y N8N_BASE_URL (KEY=VALOR, con comillas y export opcionales).
claves = {}
try:
    with open(os.environ["ENV_FILE"], encoding="utf-8") as f:
        for linea in f:
            m = re.match(r"^\s*(?:export\s+)?(N8N_API_KEY|N8N_BASE_URL)=(.*?)\s*$", linea)
            if m:
                v = m.group(2)
                if len(v) >= 2 and v[0] == v[-1] and v[0] in ("\"", chr(39)):
                    v = v[1:-1]
                claves[m.group(1)] = v
except OSError:
    print("  ✗ no se puede leer el archivo --env")
    sys.exit(1)
if not claves.get("N8N_API_KEY") or not claves.get("N8N_BASE_URL"):
    print("  ✗ el archivo --env no trae N8N_API_KEY y N8N_BASE_URL")
    sys.exit(1)
url_base = claves["N8N_BASE_URL"].rstrip("/")
partes = urllib.parse.urlsplit(url_base)
if partes.scheme != "https" and not (partes.scheme == "http" and partes.hostname in ("127.0.0.1", "localhost")):
    print("  ✗ N8N_BASE_URL tiene que ser https (solo 127.0.0.1 o localhost pueden ir sin cifrar): no se envía la llave")
    sys.exit(1)
base = url_base + "/api/v1"
H = {"X-N8N-API-KEY": claves["N8N_API_KEY"], "Content-Type": "application/json"}
class SinRedireccion(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None
# Sin proxies del entorno y sin seguir redirecciones: la llave solo viaja al servidor indicado.
abrir = urllib.request.build_opener(urllib.request.ProxyHandler({}), SinRedireccion()).open
def pedir(metodo, ruta, cuerpo=None):
    req = urllib.request.Request(base + ruta, method=metodo, headers=H,
                                 data=json.dumps(cuerpo).encode() if cuerpo is not None else None)
    try:
        with abrir(req, timeout=30) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, None
    except Exception:
        return 0, None
def listar(tras_crear=False):
    # Recorre todas las páginas (nextCursor): un duplicado en la segunda no puede pasar inadvertido.
    todas, cursor = [], None
    while True:
        ruta = "/credentials?limit=100" + ("&cursor=" + urllib.parse.quote(cursor, safe="") if cursor else "")
        codigo, d = pedir("GET", ruta)
        if codigo != 200 or not isinstance(d, dict):
            if tras_crear:
                print(f"  ✗ la relectura falló (HTTP {codigo}): la credencial pudo crearse: verificar en n8n antes de reintentar; el archivo de la clave se conserva")
                sys.exit(3)
            print(f"  ✗ n8n no devolvió la lista de credenciales (HTTP {codigo}): no se escribe nada")
            sys.exit(1)
        todas += d.get("data", [])
        cursor = d.get("nextCursor")
        if not cursor:
            return todas
nombre = os.environ["NOMBRE"]
ruta_archivo = os.environ["ARCHIVO"]
aplicar = os.environ["APLICAR"] == "1"
# 1. La CARPETA del archivo: se abre sin seguir enlaces y se valida sobre el descriptor (no sobre la ruta): es un directorio,
#    del usuario y de modo 700. Nunca un /tmp compartido. El archivo se crea RELATIVO a ese descriptor (sin comprobar y luego abrir).
carpeta, nombre_archivo = os.path.split(ruta_archivo)
if not carpeta or not nombre_archivo or nombre_archivo in (".", ".."):
    print("  ✗ --archivo tiene que ser una ruta de archivo con su carpeta: no se escribe nada")
    sys.exit(1)
try:
    dfd = os.open(carpeta, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
except OSError:
    print("  ✗ no se puede abrir la carpeta del archivo (no existe, no hay permiso o es un enlace): no se escribe nada")
    sys.exit(1)
st = os.fstat(dfd)
if not stat.S_ISDIR(st.st_mode) or st.st_uid != os.getuid() or (st.st_mode & 0o077) != 0:
    print("  ✗ la carpeta del archivo tiene que ser del usuario y de modo 700 (no una carpeta compartida): no se escribe nada")
    sys.exit(1)
print("  ✓ la carpeta del archivo es del usuario y de modo 700")
# 2. n8n: no existe ya una credencial con ese nombre (de cualquier tipo).
mismas = [c for c in listar() if c.get("name") == nombre]
if mismas:
    print(f"  ✗ ya hay {len(mismas)} credencial(es) llamadas «{nombre}»: no se crea nada ni se genera la clave")
    sys.exit(1)
print(f"  ✓ no existe ninguna credencial «{nombre}»")
if not aplicar:
    try:
        os.stat(nombre_archivo, dir_fd=dfd, follow_symlinks=False)
        print("  ✗ el archivo de la clave ya existe: no se sobrescribe")
        sys.exit(1)
    except FileNotFoundError:
        pass
    print("  Se generaría una clave aleatoria de 32 bytes (base64url), se guardaría en el archivo (modo 600)")
    print("  y se crearía: tipo httpHeaderAuth, header «Authorization», valor «Bearer <clave>».")
    print("  Diagnóstico solamente: no se escribió nada. Agrega --aplicar --confirmo \"<nombre>\".")
    sys.exit(0)
# 3. Generar la clave y guardarla ANTES de enviarla: O_EXCL (no pisa nada), sin seguir enlaces, modo 600.
clave = base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip("=")
try:
    fd = os.open(nombre_archivo, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=dfd)
except FileExistsError:
    print("  ✗ el archivo de la clave ya existe: no se sobrescribe ni se crea nada en n8n")
    sys.exit(1)
except OSError:
    print("  ✗ no se pudo crear el archivo de la clave: no se crea nada en n8n")
    sys.exit(1)
try:
    os.fchmod(fd, 0o600)
    os.write(fd, clave.encode())
    os.fsync(fd)
finally:
    os.close(fd)
print("  ✓ clave generada y guardada en el archivo (modo 600; no se imprime)")
# 4. Crear la credencial una sola vez.
codigo, _ = pedir("POST", "/credentials", {"name": nombre, "type": "httpHeaderAuth",
                                           "data": {"name": "Authorization", "value": "Bearer " + clave}})
del clave
if codigo not in (200, 201):
    print(f"  ✗ el pedido de creación falló (HTTP {codigo}; 0 = error de red o tiempo agotado): verificar en n8n antes de reintentar, porque la credencial pudo crearse; el archivo de la clave se conserva")
    sys.exit(3)
tras = [c for c in listar(True) if c.get("name") == nombre]
if len(tras) != 1 or tras[0].get("type") != "httpHeaderAuth":
    print(f"  ✗ tras crear, se hallaron {len(tras)} credenciales «{nombre}» (tiene que haber una de tipo httpHeaderAuth): la credencial pudo crearse: verificar en n8n; el archivo de la clave se conserva")
    sys.exit(3)
cid = str(tras[0].get("id"))
print(f"  ✓ credencial «{nombre}» creada, única y de tipo httpHeaderAuth (id …{cid[-4:]})")
print("  El archivo de la clave se conserva: quien lance la prueba lo lee y lo borra al terminar.")
'
