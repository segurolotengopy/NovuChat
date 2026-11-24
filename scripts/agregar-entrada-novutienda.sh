#!/usr/bin/env bash
# Agrega o reemplaza la entrada de UN comercio en el secreto NOVUTIENDA_CONFIRMAR (la que usa `confirmarPedidoExterno`),
# SIN MOSTRAR NI GUARDAR NINGÚN VALOR, conservando las demás entradas y sin destruir la versión anterior.
#
#   ./scripts/agregar-entrada-novutienda.sh --tenant casa-bermejo --archivo ~/CLAUDE_DESCARGAS/<archivo>.json [--proyecto <id>] [--aplicar]
#
# El archivo (permisos 600, dueño el usuario actual, dentro de ~/CLAUDE_DESCARGAS) trae el objeto de ESE comercio:
# {"baseUrl":"https://…","firmaSecreto":"…","bearer":"…"(opcional)}. Se valida con la MISMA regla que `destinoDeNovuTienda`
# (confirmarExterno.ts) y que `verificar-secreto-novutienda.sh`: solo esas tres claves; baseUrl https de hasta 2048 caracteres, con
# puerto válido y sin usuario, clave, query ni fragmento; firmaSecreto y bearer, de 8 caracteres o más.
#
# SECO por omisión: imprime solo «NUEVA» o «REEMPLAZA la existente», cuántas otras entradas se conservan y el resultado de cada
# validación (SÍ/NO). Con --aplicar crea una versión NUEVA del secreto (`versions add`): la anterior sigue ahí, habilitada, y se imprime
# su número para poder volver atrás (deshabilitar la nueva). Al final relee la versión nueva y comprueba, sin imprimir valores, que la
# entrada quedó y que las demás se conservaron idénticas.
#
# El valor viaja entre procesos por tuberías y por la memoria del shell: nunca a un argumento, a un archivo temporal ni a la pantalla.
# Este script NO borra el archivo de entrada: lo borra quien lo corre, después de verificar.
# Salida: 0 bien; 1 validación fallida (no se escribió nada); 2 uso; 3 gcloud no pudo leer o escribir;
#         4 la versión se creó pero la relectura no coincide (revertir deshabilitando la versión nueva).
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1

TENANT=""; ARCHIVO=""; APLICAR=0; PROYECTO="${NOVUCHAT_PROYECTO_CONSOLA:-novuchat-demo}"
while [ $# -gt 0 ]; do
  case "$1" in
    --tenant|--archivo|--proyecto)
      [ $# -ge 2 ] || { echo "✗ $1 requiere un valor" >&2; exit 2; }
      case "$1" in --tenant) TENANT="$2" ;; --archivo) ARCHIVO="$2" ;; --proyecto) PROYECTO="$2" ;; esac
      shift 2 ;;
    --aplicar) APLICAR=1; shift ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "✗ Opción desconocida: $1" >&2; exit 2 ;;
  esac
done
[[ "$TENANT" =~ ^[a-z0-9][a-z0-9-]{2,59}$ ]] || { echo "✗ --tenant: id de comercio" >&2; exit 2; }
[[ "$PROYECTO" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || { echo "✗ --proyecto: id de proyecto inválido" >&2; exit 2; }
[ -n "$ARCHIVO" ] || { echo "✗ falta --archivo" >&2; exit 2; }
# El archivo: normal (no enlace), del usuario, 600 y dentro de ~/CLAUDE_DESCARGAS (ahí entregan las sesiones; nada de /tmp ni del repo).
[ -f "$ARCHIVO" ] && [ ! -L "$ARCHIVO" ] || { echo "✗ el archivo no existe o es un enlace" >&2; exit 2; }
RUTA="$(realpath -e -- "$ARCHIVO")"
case "$RUTA" in "$HOME"/CLAUDE_DESCARGAS/*) ;; *) echo "✗ el archivo tiene que estar dentro de ~/CLAUDE_DESCARGAS" >&2; exit 2 ;; esac
[ "$(stat -c '%a %u' -- "$RUTA")" = "600 $(id -u)" ] || { echo "✗ el archivo tiene que tener permisos 600 y ser del usuario actual" >&2; exit 2; }

# Ver verificar-secreto-novutienda.sh: gcloud escribe en texto plano lo que imprime en $CLOUDSDK_CONFIG/logs, y heredar CLOUDSDK_* cambiaría de cuenta.
CONFIG_GCLOUD="${CLOUDSDK_CONFIG:-$HOME/.config/gcloud-novuchat-prod}"
for v in "${!CLOUDSDK_@}"; do unset "$v"; done
export CLOUDSDK_CONFIG="$CONFIG_GCLOUD"
export CLOUDSDK_CORE_DISABLE_FILE_LOGGING=true

# Lógica común (python -I). Modo «fusionar»: lee el secreto por stdin y el archivo por argv; imprime el JSON fusionado por stdout y
# el informe (sin valores) por stderr. Modo «comprobar»: lee la versión NUEVA por stdin y compara, por huella, contra lo esperado.
PY='
import sys, os, json, hashlib
from urllib.parse import urlparse
modo, tenant, ruta = sys.argv[1], sys.argv[2], sys.argv[3]
sn = lambda b: "SÍ" if b else "NO"
def _no(c): raise ValueError(c)
def cargar(raw): return json.loads(raw, parse_constant=_no)  # JSON.parse rechaza NaN e Infinity
def u16(s): return len(s.encode("utf-16-le", "surrogatepass")) // 2
def huella(o): return hashlib.sha256(json.dumps(o, sort_keys=True, ensure_ascii=False).encode("utf-8", "surrogatepass")).hexdigest()
def validar(t):
    ok = isinstance(t, dict)
    r = [("el archivo trae un objeto", ok)]
    if not ok: return r
    r.append(("solo claves permitidas (baseUrl, firmaSecreto, bearer)", set(t) <= {"baseUrl", "firmaSecreto", "bearer"}))
    bu = t.get("baseUrl"); h = False
    try:
        if isinstance(bu, str) and u16(bu) <= 2048:
            u = urlparse(bu); u.port
            h = u.scheme == "https" and not u.username and not u.password and not u.query and not u.fragment and bool(u.hostname)
    except Exception:
        h = False
    r.append(("baseUrl texto https, puerto válido, sin usuario, clave, query ni fragmento", h))
    f = t.get("firmaSecreto"); r.append(("firmaSecreto texto de 8 caracteres o más", isinstance(f, str) and u16(f) >= 8))
    r.append(("bearer ausente, o texto de 8 caracteres o más", "bearer" not in t or (isinstance(t["bearer"], str) and u16(t["bearer"]) >= 8)))
    return r
try:
    actual = cargar(sys.stdin.buffer.read().decode("utf-8", "replace"))
except Exception:
    print("✗ el JSON del secreto no es válido: no se toca", file=sys.stderr); sys.exit(1)
if not isinstance(actual, dict):
    print("✗ el secreto no es un objeto: no se toca", file=sys.stderr); sys.exit(1)
try:
    with open(ruta, "rb") as fh: nueva = cargar(fh.read().decode("utf-8", "replace"))
except Exception:
    print("✗ el archivo no es un JSON válido", file=sys.stderr); sys.exit(1)
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
leer() { gcloud secrets versions access "${1:-latest}" --secret=NOVUTIENDA_CONFIRMAR --project "$PROYECTO" 2>/dev/null; }

# El secreto actual se lee a la memoria del shell (el estado de gcloud se ve directo) y de ahí pasa por tubería a python.
set +e
ACTUAL="$(leer latest)"; EST_LEER=$?
set -e
if [ "$EST_LEER" -ne 0 ] || [ -z "$ACTUAL" ]; then echo "✗ no se pudo leer el secreto (gcloud: ¿sin sesión, sin permiso o secreto inexistente?)"; exit 3; fi
set +e
FUSIONADO="$(printf '%s' "$ACTUAL" | python3 -I -c "$PY" fusionar "$TENANT" "$RUTA")"; EST_PY=$?
set -e
if [ "$EST_PY" -ne 0 ] || [ -z "$FUSIONADO" ]; then echo "✗ validación fallida: no se escribió nada"; exit 1; fi
if [ "$APLICAR" -ne 1 ]; then echo "Seco: no se escribió nada. Con --aplicar se crea una versión nueva del secreto."; exit 0; fi

# La huella de «las demás entradas» se calcula del secreto ACTUAL (antes de escribir) para compararla con la versión nueva.
set +e
HUELLA_OTRAS="$(printf '%s' "$ACTUAL" | TENANT="$TENANT" python3 -I -c '
import sys, json, hashlib, os
a = json.loads(sys.stdin.buffer.read().decode("utf-8", "replace"))
o = {k: v for k, v in a.items() if k != os.environ["TENANT"]}
print(hashlib.sha256(json.dumps(o, sort_keys=True, ensure_ascii=False).encode("utf-8", "surrogatepass")).hexdigest())')"; EST_H=$?
set -e
[ "$EST_H" -eq 0 ] && [ -n "$HUELLA_OTRAS" ] || { echo "✗ no se pudo calcular la huella de las demás entradas: no se escribió nada"; exit 3; }
ANTERIOR="$(gcloud secrets versions list NOVUTIENDA_CONFIRMAR --project "$PROYECTO" --filter='state=ENABLED' --sort-by='~createTime' --limit=1 --format='value(name)' 2>/dev/null || true)"
[[ "$ANTERIOR" =~ ^[0-9]+$ ]] || { echo "✗ no se pudo identificar la versión anterior: no se escribió nada"; exit 3; }

# La versión anterior NO se destruye ni se deshabilita: `versions add` solo agrega una nueva.
set +e
NUEVA="$(printf '%s' "$FUSIONADO" | gcloud secrets versions add NOVUTIENDA_CONFIRMAR --project "$PROYECTO" --data-file=- --format='value(name)' 2>/dev/null)"
ESTADO_ADD=$?
set -e
if [ "$ESTADO_ADD" -ne 0 ] || ! [[ "$NUEVA" =~ ([0-9]+)$ ]]; then echo "✗ gcloud no confirmó la versión nueva: revisar la lista de versiones antes de reintentar"; exit 3; fi
NUEVA="${BASH_REMATCH[1]}"
echo "Versión nueva creada: $NUEVA (la anterior, $ANTERIOR, sigue habilitada; para volver atrás se deshabilita la $NUEVA)"
set +e
RELEIDO="$(leer "$NUEVA")"; EST_LEER=$?
set -e
if [ "$EST_LEER" -ne 0 ] || [ -z "$RELEIDO" ]; then echo "✗ no se pudo releer la versión nueva: REVERTIR deshabilitando la versión $NUEVA (la $ANTERIOR sigue habilitada)"; exit 4; fi
set +e
printf '%s' "$RELEIDO" | HUELLA_OTRAS="$HUELLA_OTRAS" python3 -I -c "$PY" comprobar "$TENANT" "$RUTA"; EST_PY=$?
set -e
if [ "$EST_PY" -ne 0 ]; then echo "✗ la relectura no coincide: REVERTIR deshabilitando la versión $NUEVA (la $ANTERIOR sigue habilitada)"; exit 4; fi
echo "Listo. Falta correr verificar-secreto-novutienda.sh y borrar el archivo de entrada."
