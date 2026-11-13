#!/usr/bin/env bash
# =============================================================================
# reponer-numero-demo-a.sh — repone en el `.env` del DEMO A el número de
# WhatsApp (phone id, WABA, token y destinatarios) cuando Meta lo dio de baja
# y se creó uno nuevo en la misma app NovuChat-Demo-A. NUNCA MUESTRA UN VALOR.
#
# POR QUÉ EXISTE (13/11/2026). El número de prueba del Demo A dejó de existir en
# Meta y Andres pidió uno nuevo en la misma app. Ningún script cambiaba esas
# variables en un `.env` que YA las tiene: `completar-env.sh` solo llena
# vacías, `env-desde-marcador.sh` tiene una lista cerrada de una sola
# variable, y `configurar-cliente.sh` / `configurar-demo-b.sh` escriben otro
# archivo y piden el token en una terminal. Es una herramienta para REPONER un
# demo caído, no una funcionalidad: se corre pocas veces.
#
# QUÉ CAMBIA, y solo esto, en el `.env` del Demo A:
#   WA_TOKEN  WA_PHONE_ID  WABA_ID  WA_TO  WA_TEST_NUMBER
# El resto del archivo (N8N_API_KEY, WA_APP_ID, WA_APP_SECRET, comentarios,
# orden) queda byte a byte igual. Una línea REEMPLAZADA se reescribe entera: un
# comentario en esa misma línea se pierde (está en el respaldo). Solo los secretos
# (token) nunca van en argumentos; los ids sí viajan en la URL de curl y en el
# argv de python (el candado común hace lo mismo: un id no es una credencial). WA_TO y WA_TEST_NUMBER son opcionales: vacío
# = no se toca esa variable.
#
# CÓMO ENTRAN LOS VALORES. Nunca por argumento (se verían en `ps`) ni
# impresos. Por un prompt oculto (`read -s`) si hay terminal, o por la entrada
# estándar (una línea por valor, en este orden) si no la hay:
#   1 token · 2 phone id · 3 WABA id · 4 destinatario (opcional) · 5 número visible (opcional)
# Tras cada id el script muestra SOLO sus últimos 4 dígitos, para confirmar.
#
#   ./scripts/reponer-numero-demo-a.sh [--env .env]                  # SECO: valida y no escribe
#   ./scripts/reponer-numero-demo-a.sh [--env .env] --aplicar        # pide los últimos 4 del phone id
#   ... --aplicar --confirmo 7237                                    # sin terminal: los últimos 4 por argumento
#
# SECO POR OMISIÓN. Hace TODAS las comprobaciones (incluidas las lecturas a Graph,
# que no escriben) y dice qué cambiaría, sin escribir nada.
#
# CERROJOS (cada uno con una prueba que lo niega: admin/pruebas/core/reponer-numero-demo-a.test.ts):
#   · el archivo se llama `.env`, es común, del usuario, sin `export` ni asignaciones
#     repetidas de esas variables, y trae un WA_APP_ID con forma de id (no es el del Demo A si no);
#   · el token es de ESA app (el WA_APP_ID del `.env`), y esa app se llama
#     NovuChat-Demo-A: un token de otra app, o de una app de WhatsApp-Modular, se niega;
#   · el número no es de WhatsApp-Modular (huella y nombre visible) y la WABA tampoco (solo huella; el candado
#     común `scripts/lib/apps-ajenas.sh`, prohibiciones 5 y 7 de CLAUDE.md);
#   · la WABA nueva contiene el phone id nuevo, según Graph, con ese token;
#   · phone id o WABA no coinciden con los de ningún otro `.env.*` de la carpeta
#     (salvo `.env.recordatorios`, que es del mismo Demo A): señal de pegar el de otro cliente;
#   · forma de cada valor validada ANTES de escribir; nada se escribe si algo falla;
#   · respaldo `.env.respaldo-AAAAMMDD-HHMMSS` en modo 600 (nunca se borra solo), temporal
#     600 junto al archivo real, reemplazo atómico, `.env` en 600, y lectura de vuelta.
# DESHACER: copiar el respaldo de vuelta sobre el `.env` (modo 600).
# Salidas: 0 bien (o seco sin problemas) · 1 se negó por una regla · 2 mal uso · 3 el candado de apps ajenas.
# =============================================================================
set -uo pipefail
set +x
umask 077
# Los patrones de dígitos y letras son ASCII, no los del idioma (en es_BO un cero de ancho completo pasaría por [0-9]).
export LC_ALL=C

# Una ruta relativa de --env se cuenta desde donde se corre el script, no desde la raíz del repositorio.
DONDE="$PWD"
cd "$(dirname "$0")/.." || exit 2

# El candado de apps ajenas, ANTES de leer nada: queda `readonly`.
# shellcheck source=scripts/lib/apps-ajenas.sh
source scripts/lib/apps-ajenas.sh

ENV_ARCHIVO=".env"; APLICAR=0; CONFIRMO=""
die() { echo "✗ $*" >&2; exit 1; }
uso() { awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "$0"; exit "${1:-0}"; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)      [[ -n "${2:-}" ]] || { echo "✗ --env necesita un archivo" >&2; exit 2; }; ENV_ARCHIVO="$2"; shift 2 ;;
    --aplicar)  APLICAR=1; shift ;;
    --confirmo) [[ "${2:-}" =~ ^[0-9]{4}$ ]] || { echo "✗ --confirmo necesita los 4 últimos dígitos del phone id" >&2; exit 2; }; CONFIRMO="$2"; shift 2 ;;
    -h|--help)  uso 0 ;;
    *) echo "✗ Argumento desconocido: $1" >&2; exit 2 ;;
  esac
done
[[ "$ENV_ARCHIVO" == /* ]] || ENV_ARCHIVO="$DONDE/$ENV_ARCHIVO"
# Se llama .env él Y su destino real: un enlace .env -> .env.cliente editaría el archivo de otro.
[[ "$(basename "$ENV_ARCHIVO")" == ".env" && "$(basename "$(realpath "$ENV_ARCHIVO" 2>/dev/null)")" == ".env" ]] || die "El archivo se debe llamar .env (es el del Demo A), y no ser un enlace a otro archivo. Los demás entornos tienen su propio script"
[[ -f "$ENV_ARCHIVO" ]] || die "No existe $ENV_ARCHIVO"

# --- 1. El .env como DATOS (no se hace `source`): ¿es el del Demo A? ----------
# Imprime el WA_APP_ID y sale distinto de 0 si el archivo no sirve.
APP_DEL_ENV="$(ENV_ARCHIVO="$ENV_ARCHIVO" python3 -I - <<'PY'
import os, re, stat, sys
ruta = os.environ["ENV_ARCHIVO"]
real = os.path.realpath(ruta)
try:
    st = os.stat(real)
except OSError:
    print("no existe", file=sys.stderr); sys.exit(1)
if not stat.S_ISREG(st.st_mode) or st.st_uid != os.geteuid():
    print("no es un archivo común del usuario", file=sys.stderr); sys.exit(1)
VARS = ("WA_TOKEN", "WA_PHONE_ID", "WABA_ID", "WA_TO", "WA_TEST_NUMBER")
try:
    lineas = open(real, encoding="utf-8").read().splitlines()
except (UnicodeDecodeError, OSError):
    print("no se pudo leer (codificación inválida)", file=sys.stderr); sys.exit(1)
cuenta = {v: 0 for v in VARS + ("WA_APP_ID",)}
app = ""
for l in lineas:
    m = re.match(r'^\s*(export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$', l)
    if not m or m.group(2) not in cuenta:
        continue
    if m.group(1):
        print("usa export en " + m.group(2) + " (no soportado)", file=sys.stderr); sys.exit(1)
    cuenta[m.group(2)] += 1
    if m.group(2) == "WA_APP_ID":
        app = m.group(3).strip().strip("\"'").strip()
rep = [v for v, n in cuenta.items() if n > 1]
if rep:
    print("asignaciones repetidas de " + ", ".join(rep), file=sys.stderr); sys.exit(1)
if not re.fullmatch(r'[1-9][0-9]{9,20}', app):
    print("no trae un WA_APP_ID con forma de id: no parece el .env del Demo A", file=sys.stderr); sys.exit(1)
print(app)
PY
)" || die "El $ENV_ARCHIVO no sirve para reponer el Demo A (arriba el motivo)"

# --- 2. Los valores nuevos: oculto o por la entrada estándar ------------------
# pedir <variable> <rótulo> <regex> <forma> <oculto: si|no> <opcional: si|no>
pedir() {
  local v="" etiqueta="$2"
  if [[ -t 0 ]]; then
    if [[ "$5" == "si" ]]; then read -r -s -p "  $etiqueta: " v || true; echo >&2
    else read -r -p "  $etiqueta: " v || true; fi
  else
    # `read` devuelve 1 si la última línea no trae salto final, aunque haya leído el valor: no se descarta.
    IFS= read -r v || true
  fi
  v="$(printf '%s' "$v" | tr -d '[:space:]')"
  if [[ "$1" == "WA_TO" || "$1" == "WA_TEST_NUMBER" ]]; then v="${v//[+-]/}"; fi
  if [[ -z "$v" ]]; then
    [[ "$6" == "si" ]] && { printf -v "$1" '%s' ""; echo "     (vacío: no se toca)" >&2; return 0; }
    die "Falta $etiqueta"
  fi
  [[ "$v" =~ $3 ]] || die "$etiqueta no tiene la forma esperada ($4). No se escribió nada"
  printf -v "$1" '%s' "$v"
  case "$1" in WA_PHONE_ID|WABA_ID|WA_TO|WA_TEST_NUMBER) echo "     …${v: -4}" >&2 ;; esac
}
echo "Valores del número nuevo del Demo A (los secretos no se muestran)." >&2
pedir WA_TOKEN       "Token (usuario de sistema)"          '^EAA[A-Za-z0-9_-]{50,}$' "empieza con EAA"            si no
pedir WA_PHONE_ID    "WA_PHONE_ID"                          '^[1-9][0-9]{9,20}$'       "solo dígitos, 10 a 21"      no no
pedir WABA_ID        "WABA_ID"                              '^[1-9][0-9]{9,20}$'       "solo dígitos, 10 a 21"      no no
pedir WA_TO          "Destinatario WA_TO (opcional)"        '^[0-9]{8,15}$'            "solo dígitos, 8 a 15"       no si
pedir WA_TEST_NUMBER "Número visible (opcional)"            '^[0-9]{8,15}$'            "solo dígitos, 8 a 15"       no si
[[ "$WA_PHONE_ID" != "$WABA_ID" ]] || die "WA_PHONE_ID y WABA_ID son iguales: son dos ids distintos. No se escribió nada"

# --- 3. Contra los demás entornos de la carpeta -------------------------------
DIR_ENV="$(dirname "$(realpath "$ENV_ARCHIVO")")"
NV_PHONE="$WA_PHONE_ID" NV_WABA="$WABA_ID" DIR_ENV="$DIR_ENV" python3 -I - <<'PY' || exit 1
import glob, os, re, sys
phone, waba, d = os.environ["NV_PHONE"], os.environ["NV_WABA"], os.environ["DIR_ENV"]
choque = []
for f in sorted(glob.glob(os.path.join(d, ".env.*"))):
    n = os.path.basename(f)
    # Copias y plantillas no cuentan; `.env.recordatorios` es del MISMO Demo A.
    if n in (".env.example", ".env.recordatorios") or "respaldo" in n or n.endswith((".local.json", ".bak")):
        continue
    try:
        for l in open(f, encoding="utf-8").read().splitlines():
            m = re.match(r'^\s*(?:export\s+)?(WA_PHONE_ID|WABA_ID)\s*=(.*)$', l)
            if not m: continue
            v = m.group(2).strip().strip("\"'").strip()
            if (m.group(1) == "WA_PHONE_ID" and v == phone) or (m.group(1) == "WABA_ID" and v == waba):
                choque.append(f"{n} ({m.group(1)})")
    except (OSError, UnicodeDecodeError):
        # Falla CERRADO: un entorno que no se puede leer no se puede descartar.
        choque.append(f"{n} (no se pudo leer)")
if choque:
    print("✗ Ese id ya pertenece a otro entorno: " + ", ".join(choque) + ". No es el del Demo A; no se escribió nada.", file=sys.stderr)
    sys.exit(1)
print("  ✓ phone id y WABA distintos de los de los demás entornos")
PY

# --- 4. Graph (solo lectura): ¿el token es de NovuChat-Demo-A y ve el número? --
export WA_TOKEN WA_PHONE_ID WABA_ID
WA_APP_ID="$APP_DEL_ENV"; export WA_APP_ID
G="https://graph.facebook.com/${WA_GRAPH_VERSION:-v26.0}"
echo "== Comprobaciones contra Meta (solo lectura) =="
negar_app_ajena "$WA_APP_ID" token      # la app dueña del token es la del .env; ni la app ni la WABA son de WhatsApp-Modular
negar_app_ajena "$WA_APP_ID" numero     # el número no es de WhatsApp-Modular (huella y nombre visible)
NOMBRE_APP="$(curl_token -s --max-time 30 "$G/app?fields=id,name" | python3 -I -c '
import json, re, sys, unicodedata
try: d = json.loads(sys.stdin.read() or "{}")
except ValueError: d = {}
n = str(d.get("name") or "") if isinstance(d, dict) else ""
p = re.sub(r"[^a-z0-9]", "", "".join(c for c in unicodedata.normalize("NFKD", n) if not unicodedata.combining(c)).casefold())
print("si" if p == "novuchatdemoa" else "no")' || echo error)"
[[ "$NOMBRE_APP" == "si" ]] || die "El token no es de una app llamada NovuChat-Demo-A: este .env no es el del Demo A (o Graph no contestó). No se escribió nada"
echo "  ✓ la app del token se llama NovuChat-Demo-A"
VISTO="$(curl_token -s --max-time 30 "$G/$WABA_ID/phone_numbers?fields=id" | NV_PHONE="$WA_PHONE_ID" python3 -I -c '
import json, os, sys
try: d = json.loads(sys.stdin.read() or "{}")
except ValueError: d = {}
ids = [str(x.get("id")) for x in (d.get("data") or []) if isinstance(x, dict)] if isinstance(d, dict) else []
print("si" if os.environ["NV_PHONE"] in ids else "no")' || echo error)"
[[ "$VISTO" == "si" ]] || die "Con ese token, la WABA …${WABA_ID: -4} no lista el número …${WA_PHONE_ID: -4} (¿falta agregar la WABA como activo del usuario de sistema?). No se escribió nada"
echo "  ✓ la WABA …${WABA_ID: -4} contiene el número …${WA_PHONE_ID: -4}"

echo
echo "Cambiaría en $ENV_ARCHIVO: WA_TOKEN, WA_PHONE_ID (…${WA_PHONE_ID: -4}), WABA_ID (…${WABA_ID: -4})$([[ -n "$WA_TO" ]] && echo ", WA_TO (…${WA_TO: -4})")$([[ -n "$WA_TEST_NUMBER" ]] && echo ", WA_TEST_NUMBER (…${WA_TEST_NUMBER: -4})") (valores no mostrados)."
if [[ $APLICAR -eq 0 ]]; then
  echo "Seco: no se escribió nada. Repita con --aplicar."
  exit 0
fi

# --- 5. Confirmación: los últimos 4 del phone id -------------------------------
if [[ -z "$CONFIRMO" ]]; then
  if [[ -t 0 ]]; then read -r -p "Para aplicar, escriba los últimos 4 dígitos del WA_PHONE_ID: " CONFIRMO || true
  else die "Sin terminal, --aplicar exige --confirmo con los últimos 4 dígitos del phone id. No se escribió nada"; fi
fi
[[ "$CONFIRMO" == "${WA_PHONE_ID: -4}" ]] || die "La confirmación no coincide. No se escribió nada"

# --- 6. Escritura: respaldo 600, temporal 600, reemplazo atómico, lectura de vuelta
export ENV_ARCHIVO WA_TO WA_TEST_NUMBER
exec python3 -I - <<'PY'
import os, re, signal, sys, time

def niega(msg):
    print("✗ " + msg, file=sys.stderr); sys.exit(1)

ruta = os.path.realpath(os.environ["ENV_ARCHIVO"])
nuevos = {k: os.environ.get(k, "") for k in ("WA_TOKEN", "WA_PHONE_ID", "WABA_ID", "WA_TO", "WA_TEST_NUMBER")}
nuevos = {k: v for k, v in nuevos.items() if v}
datos = open(ruta, "rb").read()
lineas = datos.splitlines(keepends=True)

sello = time.strftime("%Y%m%d-%H%M%S")
resp, n = f"{ruta}.respaldo-{sello}", 1
while os.path.exists(resp):
    resp = f"{ruta}.respaldo-{sello}-{n}"; n += 1
fd = os.open(resp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "wb") as g:
    g.write(datos)
os.chmod(resp, 0o600)

hecho = []
# El fin de línea del archivo (CRLF si la primera línea lo trae): lo que se agrega lo respeta.
eol = b"\r\n" if lineas and lineas[0].endswith(b"\r\n") else b"\n"
for var, valor in nuevos.items():
    patron = re.compile(rb'^(\s*)' + re.escape(var.encode()) + rb'\s*=')
    idx = [i for i, l in enumerate(lineas) if patron.match(l)]
    nueva = f"{var}={valor}".encode()
    if idx:
        l = lineas[idx[0]]
        fin = l[len(l.rstrip(b"\r\n")):] or eol
        sangria = patron.match(l).group(1)
        lineas[idx[0]] = sangria + nueva + fin
        hecho.append((var, "cambiada"))
    else:
        if lineas and not lineas[-1].endswith(b"\n"):
            lineas[-1] += eol
        lineas.append(nueva + eol)
        hecho.append((var, "agregada"))

dirr = os.path.dirname(ruta)
tmp = os.path.join(dirr, f".reponer-numero-demo-a.{os.getpid()}")
signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
creado = False
try:
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    creado = True
    with os.fdopen(fd, "wb") as g:
        g.write(b"".join(lineas))
        g.flush()
        os.fsync(g.fileno())  # que un corte de luz no deje el .env vacío
    os.chmod(tmp, 0o600)
    os.replace(tmp, ruta)
except Exception:
    niega("No se pudo escribir el .env (queda como estaba)")
finally:
    # Solo se borra el temporal que creó ESTE proceso.
    if creado:
        try: os.unlink(tmp)
        except OSError: pass
os.chmod(ruta, 0o600)

# Lectura de vuelta: cada variable quedó con su valor y UNA sola asignación.
leido = open(ruta, encoding="utf-8").read().splitlines()
for var, valor in nuevos.items():
    ocurrencias = [l for l in leido if re.match(r'^\s*' + re.escape(var) + r'\s*=', l)]
    if len(ocurrencias) != 1 or ocurrencias[0].split("=", 1)[1].strip() != valor:
        niega(f"Lectura de vuelta: {var} no quedó como se esperaba. Restaure el respaldo {os.path.basename(resp)}")
for var, que in hecho:
    print(f"✓ {var} {que} (valor no mostrado)")
print(f"Respaldo 600: {os.path.basename(resp)}. Deshacer: copiarlo de vuelta sobre {os.path.basename(ruta)} (modo 600).")
PY
