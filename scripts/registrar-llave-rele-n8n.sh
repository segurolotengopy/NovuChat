#!/usr/bin/env bash
# Registra en n8n la llave del relé B9 de UN cliente en la credencial Header Auth
# «AAB1 envío · <alias>», SIN mostrarla. SECO por omisión.
#
# POR QUÉ EXISTE. La sesión que opera el receptor y el relé (WAM) emite la llave del relé de cada
# cliente y la deja en un archivo de modo 600 en $XDG_RUNTIME_DIR; nadie la ve por el chat. Este es
# el CONSUMIDOR revisado de ese archivo (precedente: scripts/cargar-timbre-n8n.sh y
# scripts/rotar-ingesta.sh). NovuChat no toca el receptor, el relé ni la red de Docker: solo guarda
# la llave en su n8n para que el nodo «Enviar por el relé» del flujo del cliente la use.
#
#   ./scripts/registrar-llave-rele-n8n.sh --alias <alias> [--env .env]
#       SECO: solo GET a n8n. Dice si la credencial existe con ese nombre y tipo, si hay
#       duplicados o el nombre existe con otro tipo (aborta), cuántos flujos la citan, y si la
#       entrega es válida (existe, regular, propia, modo 600, una línea, forma de la llave). No
#       imprime la llave, ni su longitud, ni el id completo.
#   ./scripts/registrar-llave-rele-n8n.sh --alias <alias> --aplicar --confirmo produccion [--env .env]
#       1. respalda el estado de la credencial (id, nombre, tipo, flujos que la citan; SIN valor);
#       2. ACTUALIZA EN EL LUGAR (PATCH por id; nunca borra y crea: un flujo la cita por id) con
#          `Authorization: Bearer <llave>`; la llave va del archivo al cuerpo del pedido dentro de
#          un solo proceso, sin pasar por argumentos, pantalla, registros ni otro archivo;
#       3. relee (por nombre, tipo e id) y cuenta que sigue habiendo exactamente una;
#       4. solo si todo coincide, BORRA el archivo de entrega. Si algo falla lo CONSERVA.
#
# LA CREDENCIAL tiene que EXISTIR ya (httpHeaderAuth, nombre exacto «AAB1 envío · <alias>»; puede
# tener el valor inerte `Bearer INERTE-NO-ENVIAR` que dejó cargar-timbre-n8n.sh). Si no existe, hay
# duplicados o el nombre pertenece a otro tipo, se aborta sin escribir. ÚNICA EXCEPCIÓN: el alias de
# la línea de ensayo (ALIAS_CREA_SI_FALTA, ensayo01), cuya credencial se CREA (POST) si no existe.
#
# LA ENTREGA (confirmada con WAM): $XDG_RUNTIME_DIR/llave-rele-<alias>, modo 600, UNA línea con la
# llave sola, sin salto final, de la forma aab1e_<wabaId>_<64 hexadecimales> (REGEX_LLAVE, abajo). Se
# abre sin seguir enlaces y debe ser un archivo regular y propio. Si la forma no calza solo se dice
# «forma inválida»: nunca se muestra ni un fragmento de la llave ni el wabaId.
#
# ALIAS. Solo los de la lista cerrada ALIAS_PERMITIDOS (los de los flujos Flujos/experimental/rroca-*
# más el de ensayo); cualquier otro se niega.
#
# LÍMITE HONESTO. La API pública de n8n no devuelve el valor de una credencial, así que la relectura
# comprueba nombre, tipo e id (y que la escritura respondió 200), no el contenido de la cabecera. Que
# la llave sirva se prueba con un envío real por el relé, que corresponde a la sesión de WAM.
#
# N8N_BASE_URL tiene que ser https:// (sin redirecciones ni proxies) y XDG_RUNTIME_DIR del usuario, modo 700.
# ÚNICA EXCEPCIÓN, SOLO PARA PRUEBAS con un n8n falso: RELE_PERMITIR_HTTP_LOCAL=1 admite http://127.0.0.1:<puerto>
# (no sale de la máquina), y solo se respeta si el --env está bajo el directorio temporal (${TMPDIR:-/tmp});
# si no, se ignora. No es para producción.
#
# AUTO-PROTECCIÓN. Con --aplicar, si la credencial existe pero NINGÚN flujo la cita (salvo el alias de
# ensayo) se aborta con salida 3 sin escribir: dejar la llave en una credencial que ningún flujo usa no
# sirve de nada (p. ej. un alias duplicado del receptor, evy/emma frente a cliente08/cliente07).
#
# LA CLAVE DE LA API DE N8N. Sale de --env (solo N8N_BASE_URL y N8N_API_KEY, leídos como datos, sin
# ejecutar el archivo; con --aplicar exige que sea del usuario y de modo 600). Viaja en una cabecera
# dentro del proceso Python (la lee del --env, no por el entorno), nunca por argumentos ni pantalla.
#
# Salida: 0 hecho y comprobado, o seco sin hallazgos · 1 seco con algo pendiente (entrega ausente o
# inválida) · 2 uso, salvaguarda o validación previa (nada escrito) · 3 error de ejecución o respuesta
# inesperada de n8n (puede haber escrito; la entrega se conserva).
set -euo pipefail
unset N8N_BASE_URL N8N_API_KEY RELE_ENV RELE_ALIAS RELE_ENTREGA RELE_APLICAR RELE_RESPALDO_DIR RELE_NOMBRE RELE_CABECERA RELE_PREFIJO RELE_REGEX RELE_CREA

# ---- Constantes (parametrizables) -------------------------------------------------------------
ALIAS_PERMITIDOS="evy emma ruben antonio cliente07 cliente08 qtaco cliente03 ensayo01"   # nombres de Flujos/experimental/rroca-* y la línea de ensayo
ALIAS_CREA_SI_FALTA="ensayo01"                         # solo estos pueden crear la credencial
PREFIJO_ENTREGA="llave-rele-"                          # $XDG_RUNTIME_DIR/<prefijo><alias>
PREFIJO_NOMBRE="AAB1 envío · "                         # nombre de la credencial = prefijo + alias
NOMBRE_CABECERA="Authorization"                        # cabecera que se envía al relé
ESQUEMA_CABECERA="Bearer "                             # valor = esquema + llave
REGEX_LLAVE='aab1e_[0-9]{1,30}_[0-9a-f]{64}'           # forma de la llave (confirmada con WAM)
# -------------------------------------------------------------------------------------------------

ESTE="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
ayuda() { awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$ESTE"; }
ALIAS=""; ENV_FILE=".env"; APLICAR=0; CONFIRMO=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --alias)    [[ $# -ge 2 ]] || { echo "✗ --alias necesita un valor" >&2; exit 2; }; ALIAS="$2"; shift 2 ;;
    --env)      [[ $# -ge 2 ]] || { echo "✗ --env necesita un valor" >&2; exit 2; }; ENV_FILE="$2"; shift 2 ;;
    --aplicar)  APLICAR=1; shift ;;
    --confirmo) [[ $# -ge 2 ]] || { echo "✗ --confirmo necesita un valor" >&2; exit 2; }; CONFIRMO="$2"; shift 2 ;;
    -h|--help)  ayuda; exit 0 ;;
    *) echo "✗ Opción desconocida: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$ALIAS" ]] || { echo "✗ Falta --alias" >&2; exit 2; }
[[ "$ALIAS" =~ ^[a-z][a-z0-9]{1,29}$ ]] || { echo "✗ --alias fuera de forma" >&2; exit 2; }
PERMITIDO=0; for a in $ALIAS_PERMITIDOS; do [[ "$a" == "$ALIAS" ]] && PERMITIDO=1; done
(( PERMITIDO )) || { echo "✗ --alias no es de un cliente conocido (permitidos: $ALIAS_PERMITIDOS)" >&2; exit 2; }
CREA=0; for a in $ALIAS_CREA_SI_FALTA; do [[ "$a" == "$ALIAS" ]] && CREA=1; done
if (( APLICAR )); then
  [[ "$CONFIRMO" == "produccion" ]] || { echo "✗ --aplicar exige --confirmo produccion" >&2; exit 2; }
elif [[ -n "$CONFIRMO" ]]; then echo "✗ --confirmo solo va con --aplicar" >&2; exit 2; fi
[[ -n "${XDG_RUNTIME_DIR:-}" && -d "$XDG_RUNTIME_DIR" && ! -L "$XDG_RUNTIME_DIR" ]] || { echo "✗ XDG_RUNTIME_DIR no está definido o no es un directorio" >&2; exit 2; }
[[ -O "$XDG_RUNTIME_DIR" && "$(stat -c %a "$XDG_RUNTIME_DIR")" == "700" ]] || { echo "✗ XDG_RUNTIME_DIR debe ser del usuario y de modo 700" >&2; exit 2; }
[[ -f "$ENV_FILE" ]] || { echo "✗ No existe --env" >&2; exit 2; }
if (( APLICAR )); then
  [[ -O "$ENV_FILE" && "$(stat -c %a "$ENV_FILE")" == "600" ]] || { echo "✗ Con --aplicar, --env debe ser del usuario y de modo 600" >&2; exit 2; }
fi
valor_env() { grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true; }
N8N_BASE_URL="$(valor_env N8N_BASE_URL)"
# La excepción http local solo vale para pruebas: el --env debe estar bajo el directorio temporal.
if [[ -n "${RELE_PERMITIR_HTTP_LOCAL:-}" ]]; then
  _tmp="$(realpath -e -- "${TMPDIR:-/tmp}" 2>/dev/null || true)"; _env="$(realpath -e -- "$ENV_FILE" 2>/dev/null || true)"
  if [[ -z "$_tmp" || -z "$_env" || "$_env" != "$_tmp"/* ]]; then unset RELE_PERMITIR_HTTP_LOCAL; fi
fi
[[ -n "$N8N_BASE_URL" ]] || { echo "✗ Falta N8N_BASE_URL en --env" >&2; exit 2; }
[[ "$N8N_BASE_URL" =~ ^https://[^/[:space:]@]+(/.*)?$ ]] || [[ -n "${RELE_PERMITIR_HTTP_LOCAL:-}" && "$N8N_BASE_URL" =~ ^http://127\.0\.0\.1:[0-9]+$ ]] \
  || { echo "✗ N8N_BASE_URL tiene que ser https://" >&2; exit 2; }

export N8N_BASE_URL RELE_APLICAR="$APLICAR" RELE_CREA="$CREA"
export RELE_ALIAS="$ALIAS" RELE_ENTREGA="$XDG_RUNTIME_DIR/${PREFIJO_ENTREGA}${ALIAS}"
export RELE_NOMBRE="${PREFIJO_NOMBRE}${ALIAS}" RELE_CABECERA="$NOMBRE_CABECERA" RELE_PREFIJO="$ESQUEMA_CABECERA"
export RELE_REGEX="$REGEX_LLAVE" RELE_RESPALDO_DIR="$XDG_RUNTIME_DIR/registrar-llave-rele-respaldos"

# La clave de la API la lee Python del --env (no pasa por el entorno ni por argumentos).
export RELE_ENV="$ENV_FILE"
exec python3 -I - <<'PY'
import json, os, re, stat, sys, time, unicodedata, urllib.error, urllib.parse, urllib.request

E = os.environ
base = E["N8N_BASE_URL"].rstrip("/") + "/api/v1"
# La clave de la API se lee aquí del --env, como datos (nunca está en el entorno de este proceso).
_clave = ""
with open(E["RELE_ENV"], encoding="utf-8") as _f:
    for _l in _f:
        if _l.startswith("N8N_API_KEY="):
            _clave = _l.rstrip("\n").split("=", 1)[1].strip().strip("\"'")
if not _clave:
    print("✗ Falta N8N_API_KEY en --env", file=sys.stderr); sys.exit(2)
H = {"X-N8N-API-KEY": _clave, "Content-Type": "application/json"}
_clave = None
# Sin redirecciones y sin proxies: la clave y la llave solo van a la URL del --env.
def _inesperado(*_a):
    # Cualquier excepción no prevista (respuesta de forma rara): sin traceback y con salida 3.
    print("✗ respuesta inesperada de n8n o error interno: se aborta (la entrega se conserva si existe)", file=sys.stderr)
    sys.stdout.flush(); os._exit(3)
sys.excepthook = _inesperado

class _SinRedireccion(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), _SinRedireccion)
NOMBRE, ENTREGA, APLICAR = E["RELE_NOMBRE"], E["RELE_ENTREGA"], E["RELE_APLICAR"] == "1"
CREA = E["RELE_CREA"] == "1"
TIPO = "httpHeaderAuth"
FORMA = re.compile(E["RELE_REGEX"])

def salir(cod, msg):
    print(msg, file=sys.stderr if cod else sys.stdout)
    sys.exit(cod)

def pedir(metodo, ruta, cuerpo=None, espera=30):
    # Nunca se imprime el cuerpo del pedido ni el de la respuesta.
    datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
    req = urllib.request.Request(base + ruta, method=metodo, headers=H, data=datos)
    try:
        with OPENER.open(req, timeout=espera) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, None
    except Exception:
        return 0, None

def paginas(ruta, espera=30):
    todas, cursor = [], None
    while True:
        r = ruta + "?limit=100" + ("&cursor=" + urllib.parse.quote(cursor, safe="") if cursor else "")
        cod, d = pedir("GET", r, None, espera)
        if cod != 200 or not isinstance(d, dict) or not isinstance(d.get("data"), list):
            salir(3, f"✗ n8n respondió {cod} o no entregó una lista al leer {ruta}")
        lote = d["data"]
        if not all(isinstance(x, dict) for x in lote):
            salir(3, f"✗ n8n entregó elementos de forma inesperada en {ruta}")
        todas += lote
        cursor = d.get("nextCursor")
        if not cursor:
            return todas

def abrir_entrega():
    """Valida la entrega SIN imprimir su contenido. Devuelve (fd, llave, (dev, ino)) o (None, motivo, None)."""
    try:
        fd = os.open(ENTREGA, os.O_RDONLY | os.O_NOFOLLOW)
    except FileNotFoundError:
        return None, "no existe el archivo de entrega", None
    except OSError:
        return None, "no se pudo abrir el archivo de entrega (¿es un enlace?)", None
    st = os.fstat(fd)
    motivo = None
    if not stat.S_ISREG(st.st_mode):
        motivo = "la entrega no es un archivo regular"
    elif st.st_uid != os.getuid():
        motivo = "la entrega no es del usuario"
    elif stat.S_IMODE(st.st_mode) != 0o600:
        motivo = "la entrega no tiene modo 600"
    elif st.st_size > 4096:
        motivo = "la entrega es demasiado grande"
    if motivo:
        os.close(fd); return None, motivo, None
    texto = os.read(fd, 4097).decode("utf-8", "replace")
    if texto.endswith("\n"):
        texto = texto[:-1]
    if "\n" in texto or "\r" in texto:
        motivo = "la entrega tiene más de una línea"
    elif not FORMA.fullmatch(texto):
        motivo = "forma inválida"
    if motivo:
        os.close(fd); return None, motivo, None
    return fd, texto, (st.st_dev, st.st_ino)

def norm(t):
    t = unicodedata.normalize("NFKC", str(t)).casefold()
    return "".join(ch for ch in t if unicodedata.category(ch) != "Cf")

# ---- Estado vivo (solo GET) ----
todas_creds = paginas("/credentials")
if any(c.get("name") != NOMBRE and norm(c.get("name", "")) == norm(NOMBRE) for c in todas_creds):
    salir(2, "✗ Hay una credencial con un nombre equivalente pero no exacto (normalizado): se aborta sin escribir")
mismas = [c for c in todas_creds if c.get("name") == NOMBRE]
exactas = [c for c in mismas if c.get("type") == TIPO]
if len(mismas) > len(exactas):
    salir(2, f"✗ Hay una credencial «{NOMBRE}» de otro tipo: se aborta sin escribir")
if len(exactas) > 1:
    salir(2, f"✗ Hay {len(exactas)} credenciales «{NOMBRE}»: se aborta sin escribir")
existe = len(exactas) == 1
cid = exactas[0].get("id") if existe else None
if existe and not (isinstance(cid, (str, int)) and not isinstance(cid, bool) and str(cid)):
    salir(3, "✗ n8n entregó la credencial sin id válido: se aborta sin escribir")

citan = []
if existe:
    for w in paginas("/workflows", 300):
        nodos = w.get("nodes") or []
        if not isinstance(nodos, list):
            salir(3, "✗ n8n entregó un flujo con nodos de forma inesperada: se aborta sin escribir")
        for n in nodos:
            cr = (n.get("credentials") or {}) if isinstance(n, dict) else None
            c = (cr.get(TIPO) or {}) if isinstance(cr, dict) else None
            if not isinstance(c, dict):
                salir(3, "✗ n8n entregó un nodo con credenciales de forma inesperada: se aborta sin escribir")
            if c.get("id") == cid or c.get("name") == NOMBRE:
                citan.append(w.get("name", "?")); break

print(f"  Credencial «{NOMBRE}» ({TIPO}): " + (f"existe (id …{str(cid)[-4:]}), citada por {len(citan)} flujo(s)" if existe else "NO existe"))

fd, llave, ident = abrir_entrega()
entrega_ok = fd is not None
print("  Entrega: " + ("válida (modo 600, una línea, forma correcta)" if entrega_ok else f"✗ {llave}"))
if not existe and not CREA:
    salir(2, "✗ La credencial tiene que existir antes (cárguela con cargar-timbre-n8n.sh): no se crea aquí")
if existe and not citan:
    print("  ⚠ Ningún flujo cita esta credencial.")
if not APLICAR:
    if entrega_ok:
        os.close(fd)
    print("  Seco: no se escribió nada. Con --aplicar --confirmo produccion se " + ("crea." if not existe else "actualiza en el lugar.")
          if entrega_ok else "  Seco: no se escribió nada; falta una entrega válida.")
    sys.exit(0 if entrega_ok else 1)
if not CREA and not citan:
    salir(3, "✗ Ningún flujo cita esta credencial: la llave quedaría sin uso. Se aborta sin escribir (la entrega se conserva)")
if not entrega_ok:
    salir(2, "✗ Sin entrega válida no se escribe nada")

# ---- Respaldo (sin valor) ----
try:
    dr = E["RELE_RESPALDO_DIR"]
    os.makedirs(dr, mode=0o700, exist_ok=True)
    os.chmod(dr, 0o700)
    ruta_resp = os.path.join(dr, f"{E['RELE_ALIAS']}-{time.strftime('%Y%m%dT%H%M%S')}.json")
    rfd = os.open(ruta_resp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(rfd, "w") as f:
        json.dump({"nombre": NOMBRE, "tipo": TIPO, "id": cid, "existiaAntes": existe, "flujosQueLaCitan": citan,
                   "nota": "estado previo sin el valor de la credencial"}, f, ensure_ascii=False, indent=1)
except OSError:
    salir(2, "✗ no se pudo escribir el respaldo: no se escribe nada")
print("  Respaldo escrito (modo 600, sin valor).")

def fallar(msg):
    salir(3, f"✗ {msg}. La entrega se CONSERVA; el respaldo previo está en el directorio de respaldos de $XDG_RUNTIME_DIR.")

# ---- Escritura ----
datos = {"name": E["RELE_CABECERA"], "value": E["RELE_PREFIJO"] + llave}
llave = None
if existe:
    cod, _ = pedir("PATCH", "/credentials/" + urllib.parse.quote(str(cid), safe=""), {"data": datos})
else:
    cod, _ = pedir("POST", "/credentials", {"name": NOMBRE, "type": TIPO, "data": datos})
datos = None
if cod not in (200, 201):
    fallar(f"n8n respondió {cod} al escribir la credencial")

# ---- Relectura ----
todas2 = paginas("/credentials")
if any(c.get("name") != NOMBRE and norm(c.get("name", "")) == norm(NOMBRE) for c in todas2):
    fallar("la relectura halló una credencial de nombre equivalente pero no exacto")
mismas2 = [c for c in todas2 if c.get("name") == NOMBRE]
if not (len(mismas2) == 1 and mismas2[0].get("type") == TIPO and (not existe or mismas2[0].get("id") == cid)):
    fallar("la relectura no encontró exactamente una credencial con el mismo nombre, tipo e id")
print("  ✓ Relectura: una sola credencial, mismo nombre y tipo" + (", mismo id" if existe else "") + " (el valor no se lee).")

# ---- Borrado de la entrega (el mismo archivo que se leyó) ----
try:
    actual = os.stat(ENTREGA, follow_symlinks=False)
    if (actual.st_dev, actual.st_ino) != ident:
        fallar("la entrega cambió mientras se procesaba")
    os.close(fd)
    os.unlink(ENTREGA)
except FileNotFoundError:
    pass
except OSError:
    fallar("no se pudo borrar la entrega")
print("  ✓ Entrega borrada. Falta probar un envío real por el relé (lo hace la sesión de WAM).")
PY
