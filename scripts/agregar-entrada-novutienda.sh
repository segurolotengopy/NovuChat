#!/usr/bin/env bash
# Agrega o reemplaza la entrada de UN comercio en el secreto NOVUTIENDA_CONFIRMAR (la que usa `confirmarPedidoExterno`),
# SIN MOSTRAR NI GUARDAR NINGÚN VALOR, conservando las demás entradas y sin destruir la versión anterior.
#
#   ./scripts/agregar-entrada-novutienda.sh --tenant casa-bermejo --host <host de NovuTienda> --archivo ~/CLAUDE_DESCARGAS/<archivo>.json [--proyecto <id>] [--aplicar]
#   ./scripts/agregar-entrada-novutienda.sh --tenant casa-bermejo --revertir <N> [--aplicar]   (agrega una versión nueva con el contenido de la N)
#
# El archivo (permisos 600, dueño el usuario actual, dentro de ~/CLAUDE_DESCARGAS) trae el objeto de ESE comercio:
# {"baseUrl":"https://…","firmaSecreto":"…","bearer":"…"(opcional)}. Se valida con la MISMA regla que `destinoDeNovuTienda`
# (confirmarExterno.ts) y que `verificar-secreto-novutienda.sh`: solo esas tres claves; baseUrl https de hasta 2048 caracteres, con
# puerto válido y sin usuario, clave, query ni fragmento; firmaSecreto y bearer, de 8 caracteres o más.
#
# SECO por omisión: imprime solo «NUEVA» o «REEMPLAZA la existente», cuántas otras entradas se conservan y el resultado de cada
# validación (SÍ/NO). Con --aplicar crea una versión NUEVA del secreto (`versions add`): la anterior sigue ahí, habilitada, y se imprime
# su número: para volver atrás se usa --revertir <N> (agrega una versión nueva con el contenido de la N; NUNCA se deshabilita una versión: una Function redesplegada queda atada a su número y fallaría para todos los comercios). Al final relee la versión nueva y comprueba, sin imprimir valores, que la
# entrada quedó y que las demás se conservaron idénticas.
#
# El valor viaja entre procesos por tuberías y por la memoria del shell: nunca a un argumento, a un archivo temporal ni a la pantalla.
# Este script NO borra el archivo de entrada: lo borra quien lo corre, después de verificar.
# Salida: 0 bien; 1 validación fallida (no se escribió nada); 2 uso; 3 gcloud no pudo leer o escribir;
#         4 la versión se creó pero la relectura no coincide (volver atrás con --revertir <anterior>).
set -euo pipefail
set +x   # un SHELLOPTS heredado con xtrace imprimiría el secreto por stderr
unset SHELLOPTS BASHOPTS 2>/dev/null || true
cd "$(dirname "$0")/.." || exit 1

TENANT=""; ARCHIVO=""; HOST=""; REVERTIR=""; APLICAR=0; PROYECTO="${NOVUCHAT_PROYECTO_CONSOLA:-novuchat-demo}"
while [ $# -gt 0 ]; do
  case "$1" in
    --tenant|--archivo|--proyecto|--host|--revertir)
      [ $# -ge 2 ] || { echo "✗ $1 requiere un valor" >&2; exit 2; }
      case "$1" in --tenant) TENANT="$2" ;; --archivo) ARCHIVO="$2" ;; --proyecto) PROYECTO="$2" ;; --host) HOST="$2" ;; --revertir) REVERTIR="$2" ;; esac
      shift 2 ;;
    --aplicar) APLICAR=1; shift ;;
    -h|--help) sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "✗ Opción desconocida: $1" >&2; exit 2 ;;
  esac
done
[[ "$TENANT" =~ ^[a-z0-9][a-z0-9-]{2,59}$ ]] || { echo "✗ --tenant: id de comercio" >&2; exit 2; }
[[ "$PROYECTO" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || { echo "✗ --proyecto: id de proyecto inválido" >&2; exit 2; }
if [ -n "$REVERTIR" ]; then
  [[ "$REVERTIR" =~ ^[0-9]+$ ]] || { echo "✗ --revertir: número de versión" >&2; exit 2; }
  [ -z "$ARCHIVO" ] || { echo "✗ --revertir no lleva --archivo" >&2; exit 2; }
else
[ -n "$ARCHIVO" ] || { echo "✗ falta --archivo" >&2; exit 2; }
[[ "$HOST" =~ ^[a-z0-9.-]{3,253}$ ]] || { echo "✗ --host: el host esperado de la baseUrl (el que verificó NovuTienda)" >&2; exit 2; }
[[ "${HOST##*.}" =~ ^([0-9]+|0[xX][0-9a-fA-F]*)$ ]] && { echo "✗ --host: la última etiqueta no puede ser numérica" >&2; exit 2; }
# El archivo: normal (no enlace), del usuario, 600 y dentro de ~/CLAUDE_DESCARGAS (ahí entregan las sesiones; nada de /tmp ni del repo).
[ -f "$ARCHIVO" ] && [ ! -L "$ARCHIVO" ] || { echo "✗ el archivo no existe o es un enlace" >&2; exit 2; }
RUTA="$(realpath -e -- "$ARCHIVO")"
case "$RUTA" in "$HOME"/CLAUDE_DESCARGAS/*) ;; *) echo "✗ el archivo tiene que estar dentro de ~/CLAUDE_DESCARGAS" >&2; exit 2 ;; esac
[ "$(stat -c '%a %u %h' -- "$RUTA")" = "600 $(id -u) 1" ] || { echo "✗ el archivo tiene que tener permisos 600, ser del usuario actual y no tener enlaces duros" >&2; exit 2; }
fi

# Ver verificar-secreto-novutienda.sh: gcloud escribe en texto plano lo que imprime en $CLOUDSDK_CONFIG/logs, y heredar CLOUDSDK_* cambiaría de cuenta.
CONFIG_GCLOUD="${CLOUDSDK_CONFIG:-$HOME/.config/gcloud-novuchat-prod}"
for v in "${!CLOUDSDK_@}"; do unset "$v"; done
export CLOUDSDK_CONFIG="$CONFIG_GCLOUD"
export CLOUDSDK_CORE_DISABLE_FILE_LOGGING=true

# Lógica común (python -I). El archivo de entrada se lee UNA vez en bash y llega por la variable de entorno ENTRADA (no por argumento ni reabierto).
# Modo «fusionar»: lee el secreto por stdin; imprime el JSON fusionado por stdout y el informe (sin valores) por stderr.
# Modo «comprobar»: lee la versión NUEVA por stdin y compara, por huella, contra lo esperado. «huella» y «copiar» son auxiliares.
# Decodificación ESTRICTA: un byte que no es UTF-8 aborta en vez de alterarse en silencio.
PY='
import sys, os, json, hashlib
from urllib.parse import urlparse
modo, tenant = sys.argv[1], sys.argv[2]
host = os.environ.get("HOST", "")
sn = lambda b: "SÍ" if b else "NO"
def _no(c): raise ValueError(c)
def cargar(raw): return json.loads(raw.decode("utf-8"), parse_constant=_no)  # JSON.parse rechaza NaN e Infinity; utf-8 estricto
def u16(s): return len(s.encode("utf-16-le", "surrogatepass")) // 2
def huella(o): return hashlib.sha256(json.dumps(o, sort_keys=True, ensure_ascii=False).encode("utf-8", "surrogatepass")).hexdigest()
def validar(t):
    ok = isinstance(t, dict)
    r = [("la entrada es un objeto", ok)]
    if not ok: return r
    r.append(("solo claves permitidas (baseUrl, firmaSecreto, bearer)", set(t) <= {"baseUrl", "firmaSecreto", "bearer"}))
    bu = t.get("baseUrl"); h = d = False
    try:
        if isinstance(bu, str) and u16(bu) <= 2048:
            u = urlparse(bu); u.port
            h = u.scheme == "https" and not u.username and not u.password and not u.query and not u.fragment and bool(u.hostname)
            d = u.hostname == host
    except Exception:
        h = d = False
    r.append(("baseUrl texto https, puerto válido, sin usuario, clave, query ni fragmento", h))
    r.append(("host de la baseUrl igual al indicado en --host", d))
    f = t.get("firmaSecreto"); r.append(("firmaSecreto texto de 8 caracteres o más", isinstance(f, str) and u16(f) >= 8))
    r.append(("bearer ausente, o texto de 8 caracteres o más", "bearer" not in t or (isinstance(t["bearer"], str) and u16(t["bearer"]) >= 8)))
    return r
try:
    actual = cargar(sys.stdin.buffer.read())
except Exception:
    print("✗ el JSON del secreto no es válido (o no es UTF-8): no se toca", file=sys.stderr); sys.exit(1)
if not isinstance(actual, dict):
    print("✗ el secreto no es un objeto: no se toca", file=sys.stderr); sys.exit(1)
if modo == "copiar":
    sys.exit(0)
if modo == "huella":
    print(huella({k: v for k, v in actual.items() if k != tenant})); sys.exit(0)
try:
    nueva = cargar(os.environ.get("ENTRADA", "").encode("utf-8", "surrogateescape"))
except Exception:
    print("✗ el archivo no es un JSON válido (o no es UTF-8)", file=sys.stderr); sys.exit(1)
if modo == "fusionar":
    res = validar(nueva)
    for n, ok in res: print("  " + n + ":", sn(ok), file=sys.stderr)
    if not all(ok for _, ok in res): sys.exit(1)
    print("  la entrada de «" + tenant + "» es " + ("REEMPLAZA la existente" if tenant in actual else "NUEVA") + "; otras entradas conservadas: " + str(len([k for k in actual if k != tenant])), file=sys.stderr)
    fus = dict(actual); fus[tenant] = nueva
    sys.stdout.write(json.dumps(fus, ensure_ascii=False))
else:
    ok1 = actual.get(tenant) == nueva
    ok2 = huella({k: v for k, v in actual.items() if k != tenant}) == os.environ.get("HUELLA_OTRAS", "")
    print("  la entrada de «" + tenant + "» quedó idéntica a la del archivo:", sn(ok1), file=sys.stderr)
    print("  las demás entradas se conservaron idénticas:", sn(ok2), file=sys.stderr)
    sys.exit(0 if ok1 and ok2 else 1)
'
# Los errores de gcloud se descartan: no deben nombrar el proyecto ni el secreto.
leer() { gcloud secrets versions access "$1" --secret=NOVUTIENDA_CONFIRMAR --project "$PROYECTO" 2>/dev/null; }
vigente() { gcloud secrets versions list NOVUTIENDA_CONFIRMAR --project "$PROYECTO" --filter='state=ENABLED' --sort-by='~createTime' --limit=1 --format='value(name)' 2>/dev/null || true; }
agregar() { printf '%s' "$1" | gcloud secrets versions add NOVUTIENDA_CONFIRMAR --project "$PROYECTO" --data-file=- --format='value(name)' 2>/dev/null; }
AVISO_REDESPLEGAR="OJO: la Function confirmarPedidoExterno fija el número de versión del secreto al DESPLEGAR; hasta el próximo despliegue sigue con la versión anterior. Este script no la toca."

# La base de la fusión es EXACTAMENTE la versión que se imprime como «anterior» (se fija el número primero y se lee ESA versión).
ANTERIOR="$(vigente)"
[[ "$ANTERIOR" =~ ^[0-9]+$ ]] || { echo "✗ no se pudo identificar la versión vigente del secreto (gcloud: ¿sin sesión o sin permiso?)"; exit 3; }
set +e
ACTUAL="$(leer "$ANTERIOR")"; EST_LEER=$?
set -e
if [ "$EST_LEER" -ne 0 ] || [ -z "$ACTUAL" ]; then echo "✗ no se pudo leer el secreto"; exit 3; fi

if [ -n "$REVERTIR" ]; then
  # Volver atrás = AGREGAR una versión nueva con el contenido de la N pedida (nunca deshabilitar: una Function ya redesplegada queda atada a su número y fallaría para todos los comercios).
  set +e
  ANTIGUA="$(leer "$REVERTIR")"; EST_LEER=$?
  printf '%s' "$ANTIGUA" | python3 -I -c "$PY" copiar x; EST_PY=$?
  set -e
  if [ "$EST_LEER" -ne 0 ] || [ -z "$ANTIGUA" ] || [ "$EST_PY" -ne 0 ]; then echo "✗ la versión $REVERTIR no se pudo leer o no es un objeto JSON válido: no se escribió nada"; exit 1; fi
  if [ "$APLICAR" -ne 1 ]; then echo "Seco: se agregaría una versión nueva con el contenido de la $REVERTIR (hoy vigente: $ANTERIOR). Con --aplicar se crea."; exit 0; fi
  [ "$(vigente)" = "$ANTERIOR" ] || { echo "✗ el secreto cambió mientras se preparaba (ya no es la $ANTERIOR): no se escribió nada"; exit 1; }
  set +e; NUEVA="$(agregar "$ANTIGUA")"; EST_ADD=$?; set -e
  if [ "$EST_ADD" -ne 0 ] || ! [[ "$NUEVA" =~ ([0-9]+)$ ]]; then echo "✗ gcloud no confirmó la versión nueva: revisar la lista de versiones antes de reintentar"; exit 3; fi
  echo "Versión nueva creada: ${BASH_REMATCH[1]} con el contenido de la $REVERTIR. $AVISO_REDESPLEGAR"
  exit 0
fi

set +e
ENTRADA="$(cat -- "$RUTA")"; EST_CAT=$?
set -e
[ "$EST_CAT" -eq 0 ] && [ -n "$ENTRADA" ] || { echo "✗ no se pudo leer el archivo de entrada" >&2; exit 2; }
set +e
FUSIONADO="$(printf '%s' "$ACTUAL" | ENTRADA="$ENTRADA" HOST="$HOST" python3 -I -c "$PY" fusionar "$TENANT")"; EST_PY=$?
set -e
if [ "$EST_PY" -ne 0 ] || [ -z "$FUSIONADO" ]; then echo "✗ validación fallida: no se escribió nada"; exit 1; fi
if [ "$APLICAR" -ne 1 ]; then echo "Seco: no se escribió nada (base: versión $ANTERIOR). Con --aplicar se crea una versión nueva del secreto."; exit 0; fi

# La huella de «las demás entradas» se calcula del secreto ACTUAL (antes de escribir) para compararla con la versión nueva.
set +e
HUELLA_OTRAS="$(printf '%s' "$ACTUAL" | python3 -I -c "$PY" huella "$TENANT")"; EST_H=$?
set -e
[ "$EST_H" -eq 0 ] && [ -n "$HUELLA_OTRAS" ] || { echo "✗ no se pudo calcular la huella de las demás entradas: no se escribió nada"; exit 3; }

# Sin escrituras simultáneas: si la versión vigente ya no es la leída, otro la cambió y su entrada se perdería.
[ "$(vigente)" = "$ANTERIOR" ] || { echo "✗ el secreto cambió mientras se preparaba (ya no es la $ANTERIOR): no se escribió nada"; exit 1; }
# La versión anterior NO se destruye ni se deshabilita: `versions add` solo agrega una nueva.
set +e; NUEVA="$(agregar "$FUSIONADO")"; EST_ADD=$?; set -e
if [ "$EST_ADD" -ne 0 ] || ! [[ "$NUEVA" =~ ([0-9]+)$ ]]; then echo "✗ gcloud no confirmó la versión nueva: revisar la lista de versiones antes de reintentar"; exit 3; fi
NUEVA="${BASH_REMATCH[1]}"
echo "Versión nueva creada: $NUEVA (la anterior, $ANTERIOR, sigue habilitada; para volver atrás: --revertir $ANTERIOR, que agrega una versión nueva con su contenido)"
set +e
RELEIDO="$(leer "$NUEVA")"; EST_LEER=$?
set -e
if [ "$EST_LEER" -ne 0 ] || [ -z "$RELEIDO" ]; then echo "✗ no se pudo releer la versión nueva: volver atrás con --revertir $ANTERIOR"; exit 4; fi
set +e
printf '%s' "$RELEIDO" | ENTRADA="$ENTRADA" HUELLA_OTRAS="$HUELLA_OTRAS" python3 -I -c "$PY" comprobar "$TENANT"; EST_PY=$?
set -e
if [ "$EST_PY" -ne 0 ]; then echo "✗ la relectura no coincide: volver atrás con --revertir $ANTERIOR"; exit 4; fi
echo "Listo. $AVISO_REDESPLEGAR Falta correr verificar-secreto-novutienda.sh, redesplegar la Function y borrar el archivo de entrada."
