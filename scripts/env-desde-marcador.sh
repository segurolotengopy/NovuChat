#!/usr/bin/env bash
# Copia el valor de UNA fila de CONFIGURACION.local.md a UNA variable de un .env,
# SIN MOSTRAR NUNCA EL VALOR (ni en pantalla, ni en errores, ni en argumentos de procesos).
#
# Existe porque el ensayo del chat de NovuChat (`flujo-de-prueba.mjs --sobre-demo-a
# --conservar-crm`) exige PLANILLA_PROSPECTOS_ID_NOVUCHAT en el .env, y su valor vive en
# la fila de CONFIGURACION.local.md, que ningun agente puede leer. Andres autoriza y
# Claude opera: este script lo corre Claude con el «si» de Andres.
#
#   ./scripts/env-desde-marcador.sh --env <.env> --variable NOMBRE --marcador REEMPLAZAR_X \
#       [--local <CONFIGURACION.local.md>] [--aplicar]
#
# Seco por omision: dice que haria (nunca el valor). Con --aplicar agrega la linea
# NOMBRE=valor al final del .env, o la completa si ya existe vacia; el resto del archivo
# queda byte a byte igual. Antes deja un respaldo 600 `<env>.respaldo-AAAAMMDD-HHMMSS`
# (creado sin heredar el modo del original) y el .env queda en 600.
#
# Reglas duras:
#  - Solo variables y marcadores de las listas cerradas de abajo (ampliarlas es un cambio revisado).
#  - El marcador debe estar en UNA sola fila de la tabla (`${REEMPLAZAR_X}` o `REEMPLAZAR_X`, en comillas
#    invertidas); 0 o mas de 1 falla. El valor debe ser atomico (solo letras, digitos, guion y guion bajo).
#  - Si la variable ya existe con otro valor, NO se pisa (falla). Con el mismo valor: «ya estaba».
#  - El .env debe ser archivo comun. Decision sobre enlaces simbolicos: se acepta uno solo si
#    resuelve a un archivo comun del mismo usuario; el respaldo y el temporal van junto al
#    archivo REAL y el enlace se conserva (no se reemplaza por un archivo comun).
#  - Los respaldos `<env>.respaldo-*` NO se borran solos: quedan junto al archivo real (con el valor
#    anterior) y los retira una persona cuando ya no hagan falta.
#  - El valor viaja a Python por el entorno, nunca por argumentos.
# Salida: 0 bien (o ya estaba); 1 se nego por una regla; 2 mal uso.
set -uo pipefail
umask 077
set +x

# Listas cerradas. Para ampliar, agregue el nombre separado por un espacio.
VARIABLES_PERMITIDAS="PLANILLA_PROSPECTOS_ID_NOVUCHAT"
MARCADORES_PERMITIDOS="REEMPLAZAR_PLANILLA_PROSPECTOS_ID"

uso() { sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; }
die() { echo "✗ $*" >&2; exit 2; }

ENV_ARCHIVO=""; VARIABLE=""; MARCADOR=""; LOCAL="${CONFIG_LOCAL:-$HOME/NovuChat/CONFIGURACION.local.md}"; APLICAR=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)       [[ -n "${2:-}" ]] || die "--env necesita un archivo"; ENV_ARCHIVO="$2"; shift 2 ;;
    --variable)  [[ -n "${2:-}" ]] || die "--variable necesita un nombre"; VARIABLE="$2"; shift 2 ;;
    --marcador)  [[ -n "${2:-}" ]] || die "--marcador necesita un nombre"; MARCADOR="$2"; shift 2 ;;
    --local)     [[ -n "${2:-}" ]] || die "--local necesita una ruta"; LOCAL="$2"; shift 2 ;;
    --aplicar)   APLICAR=1; shift ;;
    -h|--help)   uso; exit 0 ;;
    *) die "Opcion desconocida: $1" ;;
  esac
done
[[ -n "$ENV_ARCHIVO" && -n "$VARIABLE" && -n "$MARCADOR" ]] || die "Faltan --env, --variable o --marcador"
[[ " $VARIABLES_PERMITIDAS " == *" $VARIABLE "* ]] || die "La variable no esta en la lista permitida"
[[ " $MARCADORES_PERMITIDOS " == *" $MARCADOR "* ]] || die "El marcador no esta en la lista permitida"

export ENV_ARCHIVO VARIABLE MARCADOR LOCAL APLICAR
exec python3 -I - <<'PY'
import os, re, sys, stat, signal, time

def niega(msg, codigo=1):
    print("✗ " + msg, file=sys.stderr)
    sys.exit(codigo)

env_arg, variable = os.environ["ENV_ARCHIVO"], os.environ["VARIABLE"]
marcador, local = os.environ["MARCADOR"], os.environ["LOCAL"]
aplicar = os.environ["APLICAR"] == "1"

def archivo_comun(ruta, nombre):
    # Enlace simbolico: solo si resuelve a un archivo comun del mismo usuario.
    real = os.path.realpath(ruta)
    try:
        st = os.stat(real)
    except OSError:
        niega(f"No existe {nombre}")
    if not stat.S_ISREG(st.st_mode):
        niega(f"{nombre} no es un archivo comun")
    if st.st_uid != os.geteuid():
        niega(f"{nombre} no es del usuario actual")
    return real

real_local = archivo_comun(local, "el archivo de valores locales")
real_env = archivo_comun(env_arg, "el .env")

# --- valor de la fila del marcador ------------------------------------------
ATOMICO = re.compile(r'[A-Za-z0-9_-]+')
fila = re.compile(r'^\|\s*`(?:\$\{)?([A-Z0-9_]+)\}?`\s*\|([^|]*)\|')
filas = []
try:
    with open(real_local, encoding="utf-8") as f:
        for linea in f:
            m = fila.match(linea)
            if m and m.group(1) == marcador:
                filas.append((m.group(2).strip().strip("`").strip(), "pendiente" in linea.lower()))
except (UnicodeDecodeError, OSError):
    niega("No se pudo leer el archivo de valores locales (codificacion invalida o ilegible)")
if len(filas) == 0:
    niega("El marcador no esta en la tabla")
if len(filas) > 1:
    niega(f"El marcador esta en {len(filas)} filas (debe ser una sola)")
valor, pendiente = filas[0]
if not valor or pendiente:
    niega("La fila del marcador esta vacia o marcada como pendiente")
if not ATOMICO.fullmatch(valor):
    niega("El valor de la fila no es atomico (solo letras, digitos, guion y guion bajo): lo resuelve una persona")

# --- .env: una sola asignacion a lo sumo, sin export ------------------------
with open(real_env, "rb") as f:
    datos = f.read()
lineas = datos.splitlines(keepends=True)
asig = re.compile(rb'^\s*(export\s+)?' + re.escape(variable.encode()) + rb'\s*=')
idx = [i for i, l in enumerate(lineas) if asig.match(l)]
if len(idx) > 1:
    niega(f"El .env trae {len(idx)} asignaciones de {variable} (debe ser una sola)")
accion = "agregar"
if idx:
    l = lineas[idx[0]]
    if re.match(rb'^\s*export\s', l):
        niega(f"El .env usa export en {variable} (no soportado)")
    actual = l.split(b"=", 1)[1].rstrip(b"\r\n").strip()
    if len(actual) >= 2 and actual[:1] == actual[-1:] and actual[:1] in (b'"', b"'"):
        actual = actual[1:-1]
    if actual == b"":
        accion = "completar"
    elif actual == valor.encode():
        print(f"✓ {variable} ya estaba con ese valor: no se toca nada.")
        sys.exit(0)
    else:
        niega(f"{variable} ya existe con otro valor: no se pisa")

if not aplicar:
    print(f"Seco: {accion} {variable} en el .env con el valor de {marcador} (valor no mostrado). Repita con --aplicar.")
    sys.exit(0)

# --- escritura: respaldo 600, temporal 600 junto al archivo real, reemplazo atomico
dirr = os.path.dirname(real_env)
sello = time.strftime("%Y%m%d-%H%M%S")
resp, n = f"{real_env}.respaldo-{sello}", 1
while os.path.exists(resp):
    resp = f"{real_env}.respaldo-{sello}-{n}"; n += 1
fd = os.open(resp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "wb") as g:
    g.write(datos)
os.chmod(resp, 0o600)

nuevo = f"{variable}={valor}\n".encode()
if accion == "completar":
    l = lineas[idx[0]]
    fin = l[len(l.rstrip(b"\r\n")):]
    sangria = re.match(rb'^\s*', l).group(0)
    lineas[idx[0]] = sangria + nuevo.rstrip(b"\n") + (fin or b"\n")
else:
    if lineas and not lineas[-1].endswith(b"\n"):
        lineas[-1] += b"\n"
    lineas.append(nuevo)

tmp = os.path.join(dirr, f".env-desde-marcador.{os.getpid()}")
signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
try:
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as g:
        g.write(b"".join(lineas))
    os.chmod(tmp, 0o600)
    os.replace(tmp, real_env)
except Exception:
    niega("No se pudo escribir el .env (queda como estaba)")
finally:
    # Tambien ante Ctrl-C o SIGTERM: nunca queda el temporal.
    try: os.unlink(tmp)
    except OSError: pass
os.chmod(real_env, 0o600)
print(f"✓ {variable} {'completada' if accion == 'completar' else 'agregada'} (valor no mostrado). Respaldo 600: {os.path.basename(resp)}")
PY
