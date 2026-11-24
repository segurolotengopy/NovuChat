#!/usr/bin/env bash
# Los pasos de NUBE de PRODUCCIÓN del secreto NOVUTIENDA_CATALOGO (el que lee `fuenteExterna.ts` del módulo catalogo-web),
# EN SECO por omisión, sin que el token pase por la pantalla, el historial, un archivo del repositorio ni el modelo.
# Calcado de `nube-novutienda.sh` (salvaguardas, proyecto, gcloud aislado) y de `agregar-entrada-novutienda.sh` (fusión).
#
# El secreto es UN mapa { "<tenantId>": { "baseUrl": "https://…", "bearer": "…" } }. De lo que entrega NovuTienda
# ({baseUrl, endpoint, token}) se guarda SOLO {baseUrl, bearer: <token>}: el endpoint no se guarda, el código lo arma.
#
#   ./scripts/nube-novutienda-catalogo.sh
#       SECO: diagnóstico de (a) la condición IAM del prefijo NOVUTIENDA_ (solo se COMPRUEBA; se edita con
#       `nube-novutienda.sh`), (b) si el secreto existe, (c) si sa-functions tiene secretAccessor. No escribe.
#   ./scripts/nube-novutienda-catalogo.sh --aplicar --confirmo produccion
#       Crea NOVUTIENDA_CATALOGO con `{}` si no existe (la Function falla CERRADO), da secretAccessor a sa-functions
#       solo sobre ese secreto, relee y comprueba. Si la condición IAM no cubre el prefijo, se detiene sin escribir.
#   ./scripts/nube-novutienda-catalogo.sh --cargar <archivo> --tenant <id> --host <host> [--huella <8 hex>] [--aplicar --confirmo produccion]
#       Fusiona la entrada del comercio en el mapa vigente SIN mostrar valores. El archivo es el JSON {baseUrl,endpoint,token}
#       de NovuTienda: dentro de ~/CLAUDE_DESCARGAS, regular (no enlace), del usuario, modo 600 y un solo enlace duro.
#       Se valida sin imprimir contenido: baseUrl https, puerto 443 o ausente, sin usuario/clave/query/fragmento, hostname
#       igual a --host, endpoint que empieza con /api/novuchat/v1/catalogo, token de 8 caracteres o más, claves exactas
#       {baseUrl,endpoint,token}; con --huella, sha256(token)[:8] debe coincidir. Fija el número de versión, lee ESA versión,
#       comprueba que siga vigente antes de escribir, AGREGA una versión (la anterior no se destruye ni se deshabilita),
#       relee y compara la entrada y las demás por huella. Con éxito, y solo con éxito, BORRA el archivo de entrada.
#   ./scripts/nube-novutienda-catalogo.sh --revertir <N> [--aplicar --confirmo produccion]
#       Agrega una versión nueva con el contenido de la versión N (nunca deshabilita una versión).
#
# UN DETALLE QUE IMPORTA. firebase-tools FIJA el número de versión del secreto al desplegar: tras --cargar o --revertir hay
# que REDESPLEGAR las Functions que declaran NOVUTIENDA_CATALOGO; hasta entonces siguen con la versión anterior.
#
# El proyecto: el quota_project_id de las credenciales de gcloud (CLOUDSDK_CONFIG, por omisión ~/.config/gcloud-novuchat-prod;
# cualquier otra CLOUDSDK_* se descarta). Con --aplicar, GCP_PROJECT_ID_PROD tiene que estar y ser igual. El id NUNCA se imprime.
# Todo valor viaja por tuberías y variables de shell; a python3 -I, por variables de entorno solo de ese proceso (nunca
# exportadas, nunca argumentos, nunca archivos temporales).
#
# Salida: 0 bien (o nada que hacer) · 1 pendiente (seco) o validación fallida · 2 uso o salvaguarda (nada escrito) ·
#         3 gcloud no pudo leer o escribir · 4 la versión se creó pero la relectura no coincide (--revertir <anterior>).
#
# Contra producción: con el «sí» de Andres, seco primero (.github/DESPLIEGUE-FIREBASE.md).
set -euo pipefail
case "$-" in *x*) echo "✗ xtrace activo (bash -x o SHELLOPTS=xtrace): imprimiría el token. No se escribió nada." >&2; exit 2 ;; esac
[[ "${SHELLOPTS:-}" != *xtrace* ]] || { echo "✗ SHELLOPTS=xtrace en el entorno: imprimiría el token. No se escribió nada." >&2; exit 2; }
set +x
# Una variable heredada (y exportada) con el nombre de las que llevan valores iría al entorno de gcloud: se desexporta y se descarta.
export -n ENTRADA ACTUAL FUSIONADO RELEIDO ANTIGUA HUELLA_OTRAS ESPERADO 2>/dev/null || true
unset ENTRADA ACTUAL FUSIONADO RELEIDO ANTIGUA HUELLA_OTRAS ESPERADO
ESTE="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$ESTE")/.." || exit 1

ayuda() { awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$ESTE"; }

readonly PREFIJO="NOVUTIENDA_"
readonly SECRETO="NOVUTIENDA_CATALOGO"

APLICAR=0; CONFIRMO=""; MODO="preparar"; ARCHIVO=""; TENANT=""; HOST=""; HUELLA=""; REVERTIR=""
fijar_modo() { [[ "$MODO" == preparar ]] || { echo "✗ Un solo modo a la vez (--cargar o --revertir)" >&2; exit 2; }; MODO="$1"; }
necesita() { [[ $# -ge 2 ]] || { echo "✗ $1 requiere un valor" >&2; exit 2; }; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --aplicar)    APLICAR=1; shift ;;
    --confirmo)   necesita "$@"; CONFIRMO="$2"; shift 2 ;;
    --confirmo=*) CONFIRMO="${1#*=}"; shift ;;
    --cargar)     necesita "$@"; fijar_modo cargar; ARCHIVO="$2"; shift 2 ;;
    --revertir)   necesita "$@"; fijar_modo revertir; REVERTIR="$2"; shift 2 ;;
    --tenant)     necesita "$@"; TENANT="$2"; shift 2 ;;
    --host)       necesita "$@"; HOST="$2"; shift 2 ;;
    --huella)     necesita "$@"; HUELLA="$2"; shift 2 ;;
    -h|--help)    ayuda; exit 0 ;;
    *) echo "✗ Opción desconocida (ver --help)" >&2; exit 2 ;;
  esac
done
if (( APLICAR )) && [[ "$CONFIRMO" != "produccion" ]]; then
  echo "✗ --aplicar exige --confirmo produccion (escrito a mano). No se escribió nada." >&2; exit 2
fi
if [[ "$MODO" != cargar && ( -n "$TENANT" || -n "$HOST" || -n "$HUELLA" ) ]]; then
  echo "✗ --tenant, --host y --huella solo van con --cargar" >&2; exit 2
fi
[[ -n "${HOME:-}" ]] || { echo "✗ HOME no está definido" >&2; exit 2; }

ENTRADA=""
if [[ "$MODO" == revertir ]]; then
  [[ "$REVERTIR" =~ ^[0-9]+$ ]] || { echo "✗ --revertir: número de versión" >&2; exit 2; }
fi
if [[ "$MODO" == cargar ]]; then
  [[ "$TENANT" =~ ^[a-z0-9][a-z0-9-]{2,59}$ ]] || { echo "✗ --tenant: id de comercio (minúsculas, dígitos y guiones)" >&2; exit 2; }
  [[ "$HOST" =~ ^[a-z0-9.-]{3,253}$ ]] || { echo "✗ --host: el host esperado de la baseUrl (el que verificó NovuTienda)" >&2; exit 2; }
  [[ "${HOST##*.}" =~ ^([0-9]+|0[xX][0-9a-fA-F]*)$ ]] && { echo "✗ --host: la última etiqueta no puede ser numérica" >&2; exit 2; }
  [[ -z "$HUELLA" || "$HUELLA" =~ ^[0-9a-f]{8}$ ]] || { echo "✗ --huella: 8 dígitos hexadecimales en minúscula" >&2; exit 2; }
  [[ -n "$ARCHIVO" && "$ARCHIVO" != *..* ]] || { echo "✗ --cargar: ruta del archivo (sin ..)" >&2; exit 2; }
  # El archivo: regular (no enlace), del usuario, 600, un solo enlace duro y dentro de ~/CLAUDE_DESCARGAS (nada de /tmp ni del repo).
  [[ -f "$ARCHIVO" && ! -L "$ARCHIVO" ]] || { echo "✗ el archivo no existe o es un enlace" >&2; exit 2; }
  BASE_ENTREGA="$(realpath -e -- "$HOME/CLAUDE_DESCARGAS" 2>/dev/null || true)"
  [[ -n "$BASE_ENTREGA" ]] || { echo "✗ no existe ~/CLAUDE_DESCARGAS" >&2; exit 2; }
  # La carpeta de entrega: del usuario y sin escritura para el grupo ni para otros (nadie más puede cambiar el archivo por otro).
  read -r MODO_DIR UID_DIR < <(stat -c '%a %u' -- "$BASE_ENTREGA")
  { [[ "$UID_DIR" == "$(id -u)" ]] && (( (8#$MODO_DIR & 8#022) == 0 )); } \
    || { echo "✗ ~/CLAUDE_DESCARGAS tiene que ser del usuario y sin escritura para el grupo ni para otros" >&2; exit 2; }
  RUTA="$(realpath -e -- "$ARCHIVO")"
  [[ "$RUTA" == "$BASE_ENTREGA"/* ]] || { echo "✗ el archivo tiene que estar dentro de ~/CLAUDE_DESCARGAS" >&2; exit 2; }
  # Se abre UNA vez: todo lo demás (stat y lectura) va sobre ese descriptor, no sobre la ruta (sin carrera entre revisar y leer).
  exec 3<"$RUTA" || { echo "✗ no se pudo abrir el archivo" >&2; exit 2; }
  [[ "$(stat -L -c '%a %u %h' /proc/self/fd/3)" == "600 $(id -u) 1" ]] \
    || { echo "✗ el archivo tiene que ser del usuario actual, de modo 600 y sin enlaces duros" >&2; exit 2; }
  [[ -f /proc/self/fd/3 && "$(stat -L -c '%s' /proc/self/fd/3)" -le 16384 ]] || { echo "✗ el archivo no es regular o es demasiado grande" >&2; exit 2; }
  INODO="$(stat -L -c '%d:%i' /proc/self/fd/3)"
  set +e; ENTRADA="$(cat <&3)"; EST_CAT=$?; set -e
  exec 3<&-
  [[ "$EST_CAT" -eq 0 && -n "$ENTRADA" ]] || { echo "✗ no se pudo leer el archivo de entrada" >&2; exit 2; }
fi

# Lógica común (python -I). Los valores llegan por variables de entorno SOLO de ese proceso; los informes no llevan valores.
# Modos: validar (sin stdin) · fusionar (stdin: mapa vigente; stdout: mapa fusionado) · huella (huella de las demás entradas) ·
# comprobar (stdin: versión nueva) · copiar (stdin debe ser un objeto JSON) · igual (stdin igual a ESPERADO).
# Decodificación ESTRICTA: un byte que no es UTF-8, una clave repetida, NaN o Infinity abortan en vez de alterarse en silencio.
PY='
import sys, os, json, hashlib, re
from urllib.parse import urlparse
sn = lambda b: "SÍ" if b else "NO"
def _no(c): raise ValueError(c)
def _pares(p):
    d = {}
    for k, v in p:
        if k in d: raise ValueError("clave repetida")
        d[k] = v
    return d
def cargar(raw): return json.loads(raw.decode("utf-8"), parse_constant=_no, object_pairs_hook=_pares)
def deentorno(n): return os.environ.get(n, "").encode("utf-8", "surrogateescape")
def huella(o): return hashlib.sha256(json.dumps(o, sort_keys=True, ensure_ascii=True).encode("ascii")).hexdigest()
def u16(s): return len(s.encode("utf-16-le", "surrogatepass")) // 2
def validar(t, host, hu):
    ok = isinstance(t, dict)
    r = [("el archivo es un objeto", ok)]
    if not ok: return r, None
    r.append(("claves exactas {baseUrl, endpoint, token}", set(t) == {"baseUrl", "endpoint", "token"}))
    bu = t.get("baseUrl"); h = p = d = False
    try:
        if isinstance(bu, str) and u16(bu) <= 2048:
            u = urlparse(bu); pt = u.port
            h = bu == bu.strip() and not re.search(r"[\x00-\x1f\x7f]", bu) and u.scheme == "https" and not u.username and not u.password and not u.query and not u.fragment and bool(u.hostname)
            p = pt in (None, 443)
            d = u.hostname == host
    except Exception:
        h = p = d = False
    r.append(("baseUrl texto https, sin espacios ni caracteres de control, sin usuario, clave, query ni fragmento", h))
    r.append(("puerto 443 o ausente", p))
    r.append(("host de la baseUrl igual al indicado en --host", d))
    e = t.get("endpoint"); r.append(("endpoint empieza con /api/novuchat/v1/catalogo", isinstance(e, str) and e.startswith("/api/novuchat/v1/catalogo")))
    tk = t.get("token"); tok = isinstance(tk, str) and re.fullmatch(r"[\x21-\x7e]{8,512}", tk) is not None
    r.append(("token de 8 a 512 caracteres ASCII visibles, sin espacios", tok))
    if hu:
        try: hok = tok and hashlib.sha256(tk.encode("utf-8")).hexdigest()[:8] == hu
        except Exception: hok = False
        r.append(("huella del token igual a --huella", hok))
    return r, ({"baseUrl": bu, "bearer": tk} if all(x for _, x in r) else None)
def main():
    modo, tenant = sys.argv[1], sys.argv[2]
    if modo == "validar":
        try: t = cargar(deentorno("ENTRADA"))
        except Exception:
            print("✗ el archivo no es un JSON válido (o no es UTF-8, o repite claves)", file=sys.stderr); sys.exit(1)
        res, ent = validar(t, os.environ.get("HOST", ""), os.environ.get("HUELLA", ""))
        for n, ok in res: print("  " + n + ":", sn(ok), file=sys.stderr)
        sys.exit(0 if ent is not None else 1)
    try: actual = cargar(sys.stdin.buffer.read())
    except Exception:
        print("✗ el JSON del secreto no es válido (o no es UTF-8): no se toca", file=sys.stderr); sys.exit(1)
    if not isinstance(actual, dict):
        print("✗ el secreto no es un objeto: no se toca", file=sys.stderr); sys.exit(1)
    if modo == "copiar": sys.exit(0)
    if modo == "huella":
        print(huella({k: v for k, v in actual.items() if k != tenant})); sys.exit(0)
    if modo == "igual":
        try: sys.exit(0 if cargar(deentorno("ESPERADO")) == actual else 1)
        except Exception: sys.exit(1)
    t = cargar(deentorno("ENTRADA"))
    ent = validar(t, os.environ.get("HOST", ""), os.environ.get("HUELLA", ""))[1]
    if ent is None:
        print("✗ la entrada no valida", file=sys.stderr); sys.exit(1)
    if modo == "fusionar":
        print("  la entrada de «" + tenant + "» es " + ("REEMPLAZA la existente" if tenant in actual else "NUEVA") + "; otras entradas conservadas: " + str(len([k for k in actual if k != tenant])), file=sys.stderr)
        fus = dict(actual); fus[tenant] = ent
        sys.stdout.write(json.dumps(fus, ensure_ascii=True))
    else:
        ok1 = actual.get(tenant) == ent
        ok2 = huella({k: v for k, v in actual.items() if k != tenant}) == os.environ.get("HUELLA_OTRAS", "")
        print("  la entrada de «" + tenant + "» quedó idéntica a la del archivo: " + sn(ok1), file=sys.stderr)
        print("  las demás entradas se conservaron idénticas: " + sn(ok2), file=sys.stderr)
        sys.exit(0 if ok1 and ok2 else 1)
try:
    main()
except SystemExit:
    raise
except Exception:
    print("✗ error interno de validación (sin detalle, para no mostrar valores)", file=sys.stderr); sys.exit(1)
'

# La entrada se valida ANTES de tocar gcloud: una entrada mala no necesita nube.
if [[ "$MODO" == cargar ]]; then
  echo "Validación de la entrada (sin imprimir valores)"
  set +e
  ENTRADA="$ENTRADA" HOST="$HOST" HUELLA="$HUELLA" python3 -I -c "$PY" validar "$TENANT"; EST_V=$?
  set -e
  [[ "$EST_V" -eq 0 ]] || { echo "✗ validación fallida: no se escribió nada" >&2; exit 1; }
fi

# --- El proyecto, sin imprimirlo ----------------------------------------------
export CLOUDSDK_CONFIG="${CLOUDSDK_CONFIG:-$HOME/.config/gcloud-novuchat-prod}"
for v in "${!CLOUDSDK_@}"; do [[ $v == CLOUDSDK_CONFIG ]] || unset "$v"; done
export CLOUDSDK_CORE_DISABLE_FILE_LOGGING=true   # gcloud escribe en texto plano lo que imprime en $CLOUDSDK_CONFIG/logs
ADC="$CLOUDSDK_CONFIG/application_default_credentials.json"
P=""
if [[ -r "$ADC" ]]; then
  P="$(grep -o '"quota_project_id": *"[^"]*"' "$ADC" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/' | head -n 1 || true)"
fi
[[ -n "$P" ]] || { echo "✗ No encuentro el proyecto en las credenciales de gcloud (quota_project_id)" >&2; exit 2; }
[[ "$P" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || { echo "✗ El proyecto de las credenciales no tiene la forma de un id de Google Cloud" >&2; exit 2; }
if (( APLICAR )) && [[ -z "${GCP_PROJECT_ID_PROD:-}" ]]; then
  echo "✗ --aplicar exige GCP_PROJECT_ID_PROD en el entorno, igual al proyecto de las credenciales (doble llave). No se escribió nada." >&2; exit 2
fi
if [[ -n "${GCP_PROJECT_ID_PROD:-}" && "$GCP_PROJECT_ID_PROD" != "$P" ]]; then
  echo "✗ GCP_PROJECT_ID_PROD no coincide con el proyecto de las credenciales: no se sigue" >&2; exit 2
fi
if [[ -n "${GCP_PROJECT_ID_STAGING:-}" && "$GCP_PROJECT_ID_STAGING" == "$P" ]]; then
  echo "✗ GCP_PROJECT_ID_STAGING coincide con el proyecto de las credenciales (producción): no se sigue" >&2; exit 2
fi

V=$'\e[32m'; A=$'\e[33m'; R=$'\e[31m'; F=$'\e[0m'
ok()    { echo "  ${V}✓${F} $*"; }
nota()  { echo "  ${A}·${F} $*"; }
falla() { echo "  ${R}✗${F} $*" >&2; }
hacer() { if (( APLICAR )); then echo "  → $*"; else echo "  (haría) $*"; fi; }

# Directorio de trabajo de modo 700, SOLO para los errores de gcloud (nunca un valor). Se borra al salir.
BASE_TMP="${TMPDIR:-/tmp}"
if [[ -n "${XDG_RUNTIME_DIR:-}" && -d "$XDG_RUNTIME_DIR" && -O "$XDG_RUNTIME_DIR" && "$(stat -c '%a' "$XDG_RUNTIME_DIR" 2>/dev/null)" == "700" ]]; then
  BASE_TMP="$XDG_RUNTIME_DIR"
fi
WORK="$(mktemp -d "$BASE_TMP/nube-novutienda-catalogo.XXXXXX")"
chmod 700 "$WORK"
ERR="$WORK/err"; : >"$ERR"
trap 'rm -rf "$WORK"' EXIT

# Lo que gcloud dice al fallar puede traer el id, el número o una cuenta: se tapan.
sanear() {
  local t; t="$(cat "$ERR")"
  t="${t//"$P"/<proyecto>}"
  printf '%s\n' "$t" | sed -E 's/[0-9]{6,}/<número>/g; s/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/<cuenta>/g' \
    | head -c 2000 | head -n 4 | sed 's/^/      /' >&2 || true
}
gc() { gcloud --project "$P" --quiet "$@"; }

N="$(gc projects describe "$P" --format='value(projectNumber)' 2>"$ERR")" || { falla "no pude leer el número del proyecto:"; sanear; exit 3; }
[[ "$N" =~ ^[0-9]+$ ]] || { falla "el número del proyecto no tiene la forma esperada"; exit 3; }
SA_FN="sa-functions@${P}.iam.gserviceaccount.com"
SA_DEP="sa-deploy-prod@${P}.iam.gserviceaccount.com"

if (( APLICAR )); then ESTADO="APLICANDO"; else ESTADO="seco (no escribe)"; fi
echo "Entorno: produccion  ·  secreto ${SECRETO}  ·  modo ${MODO}  ·  ${ESTADO}"
(( ! APLICAR )) || nota "producción: solo con el «sí» de Andres, a cualquier hora, y después del seco"
echo

secreto_existe() { gc secrets describe "$SECRETO" >/dev/null 2>"$ERR"; }
tiene_accessor() {
  gc secrets get-iam-policy "$SECRETO" --format=json 2>/dev/null | python3 -I -c '
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if any(b["role"] == "roles/secretmanager.secretAccessor" and "serviceAccount:" + sys.argv[1] in b["members"] for b in d.get("bindings", [])) else 1)' "$SA_FN"
}
# Solo se COMPRUEBA la condición del prefijo; editarla es de `nube-novutienda.sh`.
iam_cubre_prefijo() {
  local pol
  pol="$(gc projects get-iam-policy "$P" --format=json 2>"$ERR")" || { falla "no pude leer la política del proyecto:"; sanear; exit 3; }
  printf '%s' "$pol" | python3 -I -c '
import json, sys
d = json.load(sys.stdin); n, sa, pre = sys.argv[1:4]
cl = "resource.name.startsWith(\"projects/%s/secrets/%s\")" % (n, pre)
for b in d.get("bindings", []):
    c = b.get("condition") or {}
    if b.get("role", "").endswith("/desplegadorSecretos") and "serviceAccount:" + sa in b.get("members", []) and c.get("title") == "secretos-de-las-functions" and cl in c.get("expression", ""):
        sys.exit(0)
sys.exit(1)' "$N" "$SA_DEP" "$PREFIJO"
}
# Los errores de gcloud que acompañan a un valor se descartan: no deben nombrar el proyecto ni el secreto.
leer()    { gc secrets versions access "$1" --secret="$SECRETO" 2>/dev/null; }
vigente() { gc secrets versions list "$SECRETO" --filter='state=ENABLED' --sort-by='~createTime' --limit=1 --format='value(name)' 2>/dev/null || true; }
agregar() { printf '%s' "$1" | gc secrets versions add "$SECRETO" --data-file=- --format='value(name)' 2>/dev/null; }
AVISO_REDESPLEGAR="OJO: hay que REDESPLEGAR las Functions que declaran ${SECRETO}: firebase-tools fija el número de versión al desplegar y hasta entonces siguen con la anterior."

# --- Modo preparar ------------------------------------------------------------
if [[ "$MODO" == preparar ]]; then
  PENDIENTES=0; BLOQUEO=0
  echo "1. Condición de IAM del prefijo ${PREFIJO} (solo se comprueba)"
  if iam_cubre_prefijo; then ok "la cuenta de despliegue cubre ${PREFIJO}"
  else nota "la condición NO cubre ${PREFIJO}: se arregla con ./scripts/nube-novutienda.sh (este script no edita IAM)"; PENDIENTES=$((PENDIENTES + 1)); BLOQUEO=1; fi
  if (( APLICAR && BLOQUEO )); then falla "sin la condición IAM el despliegue fallaría: no se escribió nada"; exit 1; fi
  echo "2. El secreto"
  EXISTE=0
  if secreto_existe; then EXISTE=1; ok "${SECRETO} existe"
  else
    nota "${SECRETO} no existe"; PENDIENTES=$((PENDIENTES + 1))
    hacer "crear ${SECRETO} con el mapa vacío {} (la Function falla cerrado hasta cargar una entrada)"
    if (( APLICAR )); then
      printf '{}' | gc secrets create "$SECRETO" --replication-policy=automatic --data-file=- >/dev/null 2>"$ERR" \
        || { falla "no pude crear ${SECRETO}:"; sanear; exit 3; }
      EXISTE=1; ok "${SECRETO} creado"
    fi
  fi
  echo "3. Acceso de sa-functions"
  if (( EXISTE )) && tiene_accessor; then ok "sa-functions puede leer ${SECRETO}"
  else
    nota "sa-functions no puede leer ${SECRETO}"; hacer "dar secretAccessor sobre ${SECRETO} (solo ese secreto) a sa-functions"; PENDIENTES=$((PENDIENTES + 1))
    if (( APLICAR )); then
      gc secrets add-iam-policy-binding "$SECRETO" --member="serviceAccount:$SA_FN" --role=roles/secretmanager.secretAccessor >/dev/null 2>"$ERR" \
        || { falla "no pude dar el acceso a ${SECRETO}:"; sanear; exit 3; }
      ok "acceso concedido"
    fi
  fi
  if (( APLICAR )); then
    echo "Comprobación (relectura)"
    secreto_existe || { falla "al releer, ${SECRETO} no existe"; exit 3; }
    tiene_accessor || { falla "al releer, sa-functions NO puede leer ${SECRETO}"; exit 3; }
    ok "el secreto existe y sa-functions puede leerlo: escrito y comprobado"
    exit 0
  fi
  if (( PENDIENTES )); then echo; echo "Diagnóstico: ${PENDIENTES} paso(s) pendiente(s); no se escribió nada. Con --aplicar --confirmo produccion se hace lo marcado «(haría)»."; exit 1; fi
  echo; echo "Diagnóstico: no falta nada."; exit 0
fi

# --- Modos que escriben versiones: el secreto tiene que existir ----------------
secreto_existe || { falla "${SECRETO} no existe: corra primero el paso a paso sin opciones (con --aplicar --confirmo produccion)"; exit 3; }
if (( APLICAR )) && ! iam_cubre_prefijo; then falla "la condición IAM no cubre ${PREFIJO} (ver el diagnóstico): no se escribió nada"; exit 1; fi

# La base es EXACTAMENTE la versión que se imprime como «anterior»: se fija el número primero y se lee ESA versión.
ANTERIOR="$(vigente)"
[[ "$ANTERIOR" =~ ^[0-9]+$ ]] || { falla "no pude identificar la versión vigente del secreto (¿sin sesión o sin permiso?)"; exit 3; }
set +e; ACTUAL="$(leer "$ANTERIOR")"; EST_LEER=$?; set -e
[[ "$EST_LEER" -eq 0 && -n "$ACTUAL" ]] || { falla "no pude leer la versión vigente del secreto"; exit 3; }
printf '%s' "$ACTUAL" | python3 -I -c "$PY" copiar x || { falla "la versión vigente no es un objeto JSON válido: no se toca"; exit 1; }

if [[ "$MODO" == revertir ]]; then
  set +e; ANTIGUA="$(leer "$REVERTIR")"; EST_LEER=$?; set -e
  if [[ "$EST_LEER" -ne 0 || -z "$ANTIGUA" ]] || ! printf '%s' "$ANTIGUA" | python3 -I -c "$PY" copiar x; then
    falla "la versión ${REVERTIR} no se pudo leer o no es un objeto JSON válido: no se escribió nada"; exit 1
  fi
  hacer "agregar una versión nueva con el contenido de la ${REVERTIR} (hoy vigente: ${ANTERIOR}); nunca se deshabilita una versión"
  if (( ! APLICAR )); then echo; echo "Seco: no se escribió nada. Con --aplicar --confirmo produccion se crea."; exit 1; fi
  [[ "$(vigente)" == "$ANTERIOR" ]] || { falla "el secreto cambió mientras se preparaba (ya no es la ${ANTERIOR}): no se escribió nada"; exit 1; }
  set +e; NUEVA="$(agregar "$ANTIGUA")"; EST_ADD=$?; set -e
  if [[ "$EST_ADD" -ne 0 ]] || ! [[ "$NUEVA" =~ ([0-9]+)$ ]]; then falla "gcloud no confirmó la versión nueva: revise la lista de versiones antes de reintentar"; exit 3; fi
  NUEVA="${BASH_REMATCH[1]}"
  (( 10#$NUEVA == 10#$ANTERIOR + 1 )) || { falla "la versión nueva no es la siguiente a la ${ANTERIOR}: alguien escribió a la vez; revise las versiones y use --revertir <la correcta>"; exit 4; }
  ok "versión nueva ${NUEVA} con el contenido de la ${REVERTIR}"
  set +e; RELEIDO="$(leer "$NUEVA")"; EST_LEER=$?; set -e
  [[ "$EST_LEER" -eq 0 && -n "$RELEIDO" ]] || { falla "no pude releer la versión nueva: revise el secreto"; exit 4; }
  if ! printf '%s' "$RELEIDO" | ESPERADO="$ANTIGUA" python3 -I -c "$PY" igual x; then falla "la relectura no coincide con la versión ${REVERTIR}"; exit 4; fi
  ok "relectura: la versión nueva es idéntica a la ${REVERTIR}"
  nota "$AVISO_REDESPLEGAR"
  exit 0
fi

# --- Modo cargar --------------------------------------------------------------
echo "Fusión con el mapa vigente (base: versión ${ANTERIOR})"
set +e
FUSIONADO="$(printf '%s' "$ACTUAL" | ENTRADA="$ENTRADA" HOST="$HOST" HUELLA="$HUELLA" python3 -I -c "$PY" fusionar "$TENANT")"; EST_PY=$?
set -e
[[ "$EST_PY" -eq 0 && -n "$FUSIONADO" ]] || { falla "la fusión falló: no se escribió nada"; exit 1; }
if tiene_accessor; then ok "sa-functions puede leer ${SECRETO}"; else nota "sa-functions todavía NO puede leer ${SECRETO} (paso a paso sin opciones)"; fi
hacer "agregar una versión nueva de ${SECRETO} con la entrada de «${TENANT}» (la anterior no se destruye) y borrar el archivo de entrada"
if (( ! APLICAR )); then echo; echo "Seco: no se escribió nada ni se borró el archivo. Con --aplicar --confirmo produccion se carga."; exit 1; fi

# La huella de «las demás entradas» se calcula del mapa ACTUAL, antes de escribir, para compararla con la versión nueva.
set +e; HUELLA_OTRAS="$(printf '%s' "$ACTUAL" | python3 -I -c "$PY" huella "$TENANT")"; EST_H=$?; set -e
[[ "$EST_H" -eq 0 && -n "$HUELLA_OTRAS" ]] || { falla "no pude calcular la huella de las demás entradas: no se escribió nada"; exit 3; }
# Sin escrituras simultáneas: si la versión vigente ya no es la leída, otro la cambió y su entrada se perdería.
[[ "$(vigente)" == "$ANTERIOR" ]] || { falla "el secreto cambió mientras se preparaba (ya no es la ${ANTERIOR}): no se escribió nada"; exit 1; }
set +e; NUEVA="$(agregar "$FUSIONADO")"; EST_ADD=$?; set -e
if [[ "$EST_ADD" -ne 0 ]] || ! [[ "$NUEVA" =~ ([0-9]+)$ ]]; then falla "gcloud no confirmó la versión nueva (el archivo se conserva): revise la lista de versiones antes de reintentar"; exit 3; fi
NUEVA="${BASH_REMATCH[1]}"
(( 10#$NUEVA == 10#$ANTERIOR + 1 )) || { falla "la versión nueva no es la siguiente a la ${ANTERIOR}: alguien escribió a la vez (el archivo se conserva): revise las versiones; para volver atrás, --revertir ${ANTERIOR}"; exit 4; }
ok "versión nueva ${NUEVA} (la anterior, ${ANTERIOR}, sigue habilitada; para volver atrás: --revertir ${ANTERIOR})"
set +e; RELEIDO="$(leer "$NUEVA")"; EST_LEER=$?; set -e
[[ "$EST_LEER" -eq 0 && -n "$RELEIDO" ]] || { falla "no pude releer la versión nueva (el archivo se conserva): volver atrás con --revertir ${ANTERIOR}"; exit 4; }
set +e
printf '%s' "$RELEIDO" | ENTRADA="$ENTRADA" HOST="$HOST" HUELLA="$HUELLA" HUELLA_OTRAS="$HUELLA_OTRAS" python3 -I -c "$PY" comprobar "$TENANT"; EST_PY=$?
set -e
[[ "$EST_PY" -eq 0 ]] || { falla "la relectura no coincide (el archivo se conserva): volver atrás con --revertir ${ANTERIOR}"; exit 4; }
# Solo se borra si la ruta sigue siendo el MISMO archivo que se validó y leyó (no un reemplazo hecho entretanto).
if [[ ! -L "$RUTA" && "$(stat -c '%d:%i' -- "$RUTA" 2>/dev/null || true)" == "$INODO" ]]; then
  if rm -f -- "$RUTA"; then ok "archivo de entrada borrado"; else nota "no pude borrar el archivo de entrada: bórrelo a mano"; fi
else nota "la ruta ya no es el archivo que se leyó: NO lo borro; revise ~/CLAUDE_DESCARGAS a mano"; fi
nota "$AVISO_REDESPLEGAR"
exit 0
