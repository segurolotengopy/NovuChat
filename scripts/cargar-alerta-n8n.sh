#!/usr/bin/env bash
# Carga en n8n, por la API, lo que necesita el flujo «NovuChat — Error de envío incierto» para AVISAR a Andres:
# la credencial Crypto «NovuChat alertas (HMAC)» (la clave con que el nodo firma) y el propio flujo con la URL de
# la Function `alertaOperativa` repuesta. SECO por omisión; ningún valor sale por la pantalla.
#
# POR QUÉ EXISTE. El flujo versionado (`Flujos/error-envio-incierto.json`) lleva el marcador (dentro del código del nodo «Armar alerta»)
# `REEMPLAZAR_URL_ALERTA_OPERATIVA` y una credencial por NOMBRE, sin id. `publicar-flujo.sh` aborta ante cualquier
# `REEMPLAZAR_` y no sabe resolver esta URL, así que este flujo NO pasa por él (decisión D3 de Andres): lo carga este
# script, calcado de `registrar-llave-rele-n8n.sh` y `cargar-timbre-n8n.sh`. La clave ALERTAS_HMAC no se entrega a ningún
# archivo (decisión D2; `nube-alertas.sh --entregar-hmac` se retiró): `gcloud secrets versions access` la lleva por TUBERÍA
# al proceso que arma el cuerpo de la llamada a n8n. No pasa por variable, argumento, archivo ni pantalla.
#
#   ./scripts/cargar-alerta-n8n.sh --credencial [--env .env]
#       SECO: dice si el secreto existe en Secret Manager y si la credencial «NovuChat alertas (HMAC)» (tipo crypto)
#       existe en n8n (solo GET; duplicados o el nombre en otro tipo abortan). No lee el valor del secreto.
#   ./scripts/cargar-alerta-n8n.sh --credencial --aplicar --confirmo produccion [--env .env]
#       Crea la credencial (POST) o la ACTUALIZA EN EL LUGAR (PATCH por id: un flujo la cita) con `hmacSecret` = el
#       valor vigente de ALERTAS_HMAC, y relee que exista exactamente una con el mismo nombre, tipo e id. La API de n8n
#       no devuelve el valor, así que la relectura no lo compara: que la firma sirva se prueba con una alerta real.
#   ./scripts/cargar-alerta-n8n.sh --flujo [--env .env]
#       SECO: resuelve la URL de la Function (`gcloud run services describe alertaoperativa`, sin imprimirla), arma el
#       flujo en memoria y dice qué haría. Solo GET.
#   ./scripts/cargar-alerta-n8n.sh --flujo --aplicar --confirmo produccion [--env .env]
#       Crea el flujo INACTIVO (POST) o lo actualiza (PUT) con el marcador repuesto EN MEMORIA y la credencial
#       asignada por NOMBRE y TIPO (si falta o está duplicada, aborta sin escribir). No lo activa ni lo desactiva; relee
#       y comprueba nombre, nodos, credenciales y URL. La Function debe estar desplegada antes (orden:
#       `nube-alertas.sh` pasos 1 a 3 -> `--cargar-resend` -> desplegar -> `--invocador` -> `--credencial` -> `--flujo`).
#       Asignar este flujo en `settings.errorWorkflow` de los flujos con relé es un paso aparte.
#
# DOBLE LLAVE de producción, como `nube-alertas.sh`: el proyecto sale del quota_project_id de las credenciales de gcloud
# (CLOUDSDK_CONFIG, por omisión ~/.config/gcloud-novuchat-prod; cualquier otra CLOUDSDK_* se descarta) y con --aplicar
# GCP_PROJECT_ID_PROD tiene que estar y ser igual. El id nunca se imprime.
#
# LA CLAVE DE LA API DE N8N sale de --env (solo N8N_BASE_URL y N8N_API_KEY, leídos como datos, sin ejecutar el
# archivo; con --aplicar exige que sea del usuario y de modo 600). N8N_BASE_URL tiene que ser https://. ÚNICA EXCEPCIÓN,
# SOLO PARA PRUEBAS con un n8n falso: ALERTA_PERMITIR_HTTP_LOCAL=1 admite http://127.0.0.1:<puerto>, y solo si el --env
# está bajo el directorio temporal (${TMPDIR:-/tmp}).
#
# Salida: 0 hecho y comprobado, o seco sin hallazgos · 1 seco con algo pendiente · 2 uso, salvaguarda o validación
# previa (nada escrito) · 3 error de ejecución o respuesta inesperada de n8n o de gcloud (puede haber escrito).
set -euo pipefail
# NUNCA con xtrace: imprimiría cada comando ya expandido.
case "$-" in *x*) echo "✗ xtrace activo (bash -x o SHELLOPTS=xtrace): imprimiría datos sensibles. No se escribió nada." >&2; exit 2 ;; esac
[[ "${SHELLOPTS:-}" != *xtrace* ]] || { echo "✗ SHELLOPTS=xtrace en el entorno: imprimiría datos sensibles. No se escribió nada." >&2; exit 2; }
set +x
unset N8N_BASE_URL N8N_API_KEY ALERTA_BASE ALERTA_ENV ALERTA_APLICAR ALERTA_FLUJO ALERTA_RESPALDO_DIR ALERTA_MODO
ESTE="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$ESTE")/.." || exit 1
ayuda() { awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$ESTE"; }

readonly SECRETO_HMAC="ALERTAS_HMAC"
readonly SERVICIO_ALERTAS="alertaoperativa"
readonly ARCHIVO_FLUJO="Flujos/error-envio-incierto.json"

MODO=""; ENV_FILE=".env"; APLICAR=0; CONFIRMO=""
fijar_modo() { [[ -z "$MODO" ]] || { echo "✗ Un solo modo a la vez (--credencial o --flujo)" >&2; exit 2; }; MODO="$1"; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --credencial) fijar_modo credencial; shift ;;
    --flujo)      fijar_modo flujo; shift ;;
    --env)        [[ $# -ge 2 ]] || { echo "✗ --env necesita un valor" >&2; exit 2; }; ENV_FILE="$2"; shift 2 ;;
    --aplicar)    APLICAR=1; shift ;;
    --confirmo)   [[ $# -ge 2 ]] || { echo "✗ --confirmo necesita un valor" >&2; exit 2; }; CONFIRMO="$2"; shift 2 ;;
    -h|--help)    ayuda; exit 0 ;;
    *) echo "✗ Opción desconocida (ver --help)" >&2; exit 2 ;;
  esac
done
[[ -n "$MODO" ]] || { echo "✗ Falta --credencial o --flujo (ver --help)" >&2; exit 2; }
if (( APLICAR )); then
  [[ "$CONFIRMO" == "produccion" ]] || { echo "✗ --aplicar exige --confirmo produccion (escrito a mano). No se escribió nada." >&2; exit 2; }
elif [[ -n "$CONFIRMO" ]]; then echo "✗ --confirmo solo va con --aplicar" >&2; exit 2; fi

[[ -f "$ENV_FILE" ]] || { echo "✗ No existe --env" >&2; exit 2; }
if (( APLICAR )); then
  [[ -O "$ENV_FILE" && "$(stat -c %a "$ENV_FILE")" == "600" ]] || { echo "✗ Con --aplicar, --env debe ser del usuario y de modo 600" >&2; exit 2; }
  d="${XDG_RUNTIME_DIR:-}"
  [[ -n "$d" && -d "$d" && ! -L "$d" && -O "$d" && "$(stat -c '%a' "$d" 2>/dev/null)" == "700" ]] \
    || { echo "✗ Con --aplicar hace falta un \$XDG_RUNTIME_DIR del usuario y de modo 700 (para el respaldo)" >&2; exit 2; }
fi
valor_env() { grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true; }
N8N_BASE_URL="$(valor_env N8N_BASE_URL)"
if [[ -n "${ALERTA_PERMITIR_HTTP_LOCAL:-}" ]]; then
  _tmp="$(realpath -e -- "${TMPDIR:-/tmp}" 2>/dev/null || true)"; _env="$(realpath -e -- "$ENV_FILE" 2>/dev/null || true)"
  if [[ -z "$_tmp" || -z "$_env" || "$_env" != "$_tmp"/* ]]; then unset ALERTA_PERMITIR_HTTP_LOCAL; fi
fi
[[ -n "$N8N_BASE_URL" ]] || { echo "✗ Falta N8N_BASE_URL en --env" >&2; exit 2; }
[[ "$N8N_BASE_URL" =~ ^https://[^/[:space:]@]+(/.*)?$ ]] || [[ -n "${ALERTA_PERMITIR_HTTP_LOCAL:-}" && "$N8N_BASE_URL" =~ ^http://127\.0\.0\.1:[0-9]+$ ]] \
  || { echo "✗ N8N_BASE_URL tiene que ser https://" >&2; exit 2; }
[[ "$MODO" != flujo || -f "$ARCHIVO_FLUJO" ]] || { echo "✗ No encuentro ${ARCHIVO_FLUJO}" >&2; exit 2; }

# --- El proyecto, sin imprimirlo (igual que nube-alertas.sh) ----------------------------------------------------
if [[ -z "${CLOUDSDK_CONFIG:-}" && -z "${HOME:-}" ]]; then
  echo "✗ Sin CLOUDSDK_CONFIG ni HOME no sé dónde están las credenciales de gcloud" >&2; exit 2
fi
export CLOUDSDK_CONFIG="${CLOUDSDK_CONFIG:-$HOME/.config/gcloud-novuchat-prod}"
for v in "${!CLOUDSDK_@}"; do [[ $v == CLOUDSDK_CONFIG ]] || unset "$v"; done
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

BASE_TMP="${TMPDIR:-/tmp}"
WORK="$(mktemp -d "$BASE_TMP/cargar-alerta-n8n.XXXXXX")"
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

# --- El programa que habla con n8n. El secreto o la URL le llegan por la ENTRADA ESTÁNDAR (tubería de gcloud). -----
read -r -d '' PROGRAMA <<'PY' || true
import json, os, re, sys, time, unicodedata, urllib.error, urllib.parse, urllib.request

E = os.environ
MODO = sys.argv[1]
APLICAR = E["ALERTA_APLICAR"] == "1"
base = E["ALERTA_BASE"].rstrip("/") + "/api/v1"
NOMBRE_CRED, TIPO_CRED = "NovuChat alertas (HMAC)", "crypto"
MARCADOR = "REEMPLAZAR_URL_ALERTA_OPERATIVA"

def _inesperado(*_a):
    print("✗ respuesta inesperada de n8n o error interno: se aborta", file=sys.stderr)
    sys.stdout.flush(); os._exit(3)
sys.excepthook = _inesperado

def salir(cod, msg):
    print(msg, file=sys.stderr if cod else sys.stdout)
    sys.exit(cod)

# La clave de la API se lee aquí del --env, como datos (nunca está en el entorno de este proceso).
_clave = ""
with open(E["ALERTA_ENV"], encoding="utf-8") as _f:
    for _l in _f:
        if _l.startswith("N8N_API_KEY="):
            _clave = _l.rstrip("\n").split("=", 1)[1].strip().strip("\"'")
if not _clave:
    salir(2, "✗ Falta N8N_API_KEY en --env")
H = {"X-N8N-API-KEY": _clave, "Content-Type": "application/json"}
_clave = None

class _SinRedireccion(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), _SinRedireccion)

def pedir(metodo, ruta, cuerpo=None, espera=30):
    # Nunca se imprime el cuerpo del pedido ni el de la respuesta.
    datos = json.dumps(cuerpo, ensure_ascii=False).encode() if cuerpo is not None else None
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

def norm(t):
    t = unicodedata.normalize("NFKC", str(t)).casefold()
    return "".join(ch for ch in t if unicodedata.category(ch) != "Cf")

def id_valido(x):
    return isinstance(x, (str, int)) and not isinstance(x, bool) and str(x) != ""

def una_por_nombre(lista, nombre, tipo=None, que="elemento"):
    """El único elemento con ese nombre (y tipo). Aborta con 2 si hay uno equivalente, de otro tipo o duplicado."""
    if any(c.get("name") != nombre and norm(c.get("name", "")) == norm(nombre) for c in lista):
        salir(2, f"✗ Hay un {que} con un nombre equivalente pero no exacto (normalizado): se aborta sin escribir")
    mismas = [c for c in lista if c.get("name") == nombre]
    exactas = [c for c in mismas if tipo is None or c.get("type") == tipo]
    if len(mismas) > len(exactas):
        salir(2, f"✗ Hay un {que} «{nombre}» de otro tipo: se aborta sin escribir")
    if len(exactas) > 1:
        salir(2, f"✗ Hay {len(exactas)} {que}s «{nombre}»: se aborta sin escribir")
    if exactas and not id_valido(exactas[0].get("id")):
        salir(3, f"✗ n8n entregó el {que} sin id válido: se aborta sin escribir")
    return exactas[0] if exactas else None

def respaldar(nombre, contenido):
    try:
        dr = E["ALERTA_RESPALDO_DIR"]
        os.makedirs(dr, mode=0o700, exist_ok=True)
        os.chmod(dr, 0o700)
        ruta = os.path.join(dr, f"{nombre}-{time.strftime('%Y%m%dT%H%M%S')}.json")
        fd = os.open(ruta, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(contenido, f, ensure_ascii=False, indent=1)
    except OSError:
        salir(2, "✗ no se pudo escribir el respaldo: no se escribe nada")
    print("  Respaldo escrito (modo 600, sin valores).")

def leer_entrada(maximo, forma, que):
    crudo = sys.stdin.buffer.read(maximo + 1).decode("utf-8", "replace")
    valor = crudo[:-1] if crudo.endswith("\n") else crudo
    if not valor:
        salir(2, f"✗ no llegó {que} desde gcloud: no se escribe nada")
    if not re.fullmatch(forma, valor):
        salir(2, f"✗ {que} no tiene la forma esperada (no se muestra): no se escribe nada")
    return valor

# ----------------------------------------------------------------------------------------------------------------
def credencial():
    cred = una_por_nombre(paginas("/credentials"), NOMBRE_CRED, TIPO_CRED, "credencial")
    existe = cred is not None
    cid = cred.get("id") if existe else None
    print(f"  Credencial «{NOMBRE_CRED}» ({TIPO_CRED}): " + (f"existe (id …{str(cid)[-4:]})" if existe else "NO existe"))
    if not APLICAR:
        print("  Seco: no se escribió nada. Con --aplicar --confirmo produccion se " + ("actualiza en el lugar." if existe else "crea."))
        sys.exit(0 if existe else 1)
    secreto = leer_entrada(4096, r"[A-Za-z0-9_-]{32,200}", "el valor del secreto")
    respaldar("credencial", {"nombre": NOMBRE_CRED, "tipo": TIPO_CRED, "id": cid, "existiaAntes": existe,
                              "nota": "estado previo sin el valor de la credencial"})
    datos = {"hmacSecret": secreto}
    secreto = None
    if existe:
        cod, _ = pedir("PATCH", "/credentials/" + urllib.parse.quote(str(cid), safe=""), {"data": datos})
    else:
        cod, _ = pedir("POST", "/credentials", {"name": NOMBRE_CRED, "type": TIPO_CRED, "data": datos})
    datos = None
    if cod not in (200, 201):
        salir(3, f"✗ n8n respondió {cod} al escribir la credencial")
    nueva = una_por_nombre(paginas("/credentials"), NOMBRE_CRED, TIPO_CRED, "credencial")
    if nueva is None or (existe and nueva.get("id") != cid):
        salir(3, "✗ la relectura no encontró exactamente una credencial con el mismo nombre, tipo e id")
    print("  ✓ Relectura: una sola credencial, mismo nombre y tipo" + (", mismo id" if existe else "") + " (el valor no se lee).")

# ----------------------------------------------------------------------------------------------------------------
def flujo():
    url = leer_entrada(512, r"https://[a-z0-9][a-z0-9.-]{3,150}\.run\.app", "la URL de la Function")
    with open(E["ALERTA_FLUJO"], encoding="utf-8") as f:
        wf = json.load(f)
    nodos = wf["nodes"]
    # El marcador vive DENTRO del código de «Armar alerta» (verificar-saneo.sh no admite uno en otro parámetro sin manifiesto):
    # entre comillas simples, una sola vez en todo el flujo. Se repone solo en el cuerpo que se envía, nunca en el archivo.
    entre_comillas = "'" + MARCADOR + "'"
    con_marcador = [n for n in nodos if isinstance(n.get("parameters"), dict) and entre_comillas in str(n["parameters"].get("jsCode", ""))]
    if len(con_marcador) != 1 or json.dumps(wf, ensure_ascii=False).count(MARCADOR) != 1:
        salir(2, f"✗ El flujo versionado debe tener el marcador {MARCADOR} una sola vez, entre comillas, en el código de un nodo")
    con_marcador[0]["parameters"]["jsCode"] = con_marcador[0]["parameters"]["jsCode"].replace(entre_comillas, "'" + url + "'")
    if "REEMPLAZAR_" in json.dumps(wf, ensure_ascii=False):
        salir(2, "✗ Queda un marcador REEMPLAZAR_ sin reponer: se aborta sin escribir")
    # Credenciales POR NOMBRE EXACTO y TIPO; si falta una o está duplicada, se aborta.
    creds = paginas("/credentials")
    esperadas = {}
    for n in nodos:
        for tipo, ref in list((n.get("credentials") or {}).items()):
            nom = (ref or {}).get("name") or ""
            if not nom:
                salir(2, f"✗ {n['name']}: credencial {tipo} sin nombre (no se asigna por TIPO)")
            c = una_por_nombre(creds, nom, tipo, "credencial")
            if c is None:
                salir(2, f"✗ {n['name']}: no existe la credencial {tipo} «{nom}»: cárguela antes con --credencial")
            n["credentials"][tipo] = {"id": c["id"], "name": nom}
            esperadas[n["name"]] = (tipo, str(c["id"]))
    cuerpo = {"name": wf["name"], "nodes": nodos, "connections": wf["connections"], "settings": wf.get("settings", {})}
    existente = una_por_nombre(paginas("/workflows", 300), wf["name"], None, "flujo")
    wid = existente.get("id") if existente else None
    print(f"  Flujo «{wf['name']}»: " + (f"existe (id …{str(wid)[-4:]}, {'activo' if existente.get('active') else 'inactivo'}), se actualiza" if existente else "NO existe, se crea INACTIVO"))
    for nombre, (tipo, _i) in esperadas.items():
        print(f"    {nombre} <- «{NOMBRE_CRED}» (por nombre y tipo {tipo})")
    print("    URL de la Function: resuelta con gcloud (no se muestra)")
    if not APLICAR:
        print("  Seco: no se escribió nada. Con --aplicar --confirmo produccion se " + ("actualiza." if existente else "crea."))
        sys.exit(0)
    respaldar("flujo", {"nombre": wf["name"], "id": wid, "existiaAntes": existente is not None,
                         "activo": bool(existente.get("active")) if existente else False,
                         "nota": "estado previo sin nodos ni valores"})
    if existente:
        cod, rta = pedir("PUT", "/workflows/" + urllib.parse.quote(str(wid), safe=""), cuerpo)
    else:
        cod, rta = pedir("POST", "/workflows", cuerpo)
    if cod not in (200, 201) or not isinstance(rta, dict) or not id_valido(rta.get("id")):
        salir(3, f"✗ n8n respondió {cod} al escribir el flujo o no devolvió su id")
    wid = rta["id"]
    cod, vivo = pedir("GET", "/workflows/" + urllib.parse.quote(str(wid), safe=""))
    if cod != 200 or not isinstance(vivo, dict):
        salir(3, f"✗ n8n respondió {cod} al releer el flujo")
    errores = []
    if vivo.get("name") != wf["name"]:
        errores.append("el nombre no coincide")
    vn = vivo.get("nodes") if isinstance(vivo.get("nodes"), list) else []
    if sorted(str(n.get("name")) for n in vn if isinstance(n, dict)) != sorted(n["name"] for n in nodos):
        errores.append("los nodos no coinciden")
    for n in vn:
        if not isinstance(n, dict):
            continue
        if n.get("name") in esperadas:
            tipo, ident = esperadas[n["name"]]
            ref = (n.get("credentials") or {}).get(tipo) or {}
            if str(ref.get("id")) != ident or ref.get("name") != NOMBRE_CRED:
                errores.append(f"{n['name']}: la credencial no quedó asignada por id y nombre")
        if n.get("name") == con_marcador[0]["name"] and ("'" + url + "'") not in str((n.get("parameters") or {}).get("jsCode", "")):
            errores.append("la URL del envío no quedó repuesta")
    if "REEMPLAZAR_" in json.dumps(vivo, ensure_ascii=False):
        errores.append("el flujo vivo conserva un marcador REEMPLAZAR_")
    if not existente and vivo.get("active"):
        errores.append("el flujo recién creado quedó ACTIVO (tenía que quedar inactivo)")
    if errores:
        salir(3, "✗ La relectura no coincide con lo esperado: " + "; ".join(errores))
    print("  ✓ Relectura: nombre, nodos, credenciales por id y URL coinciden (" + str(len(vn)) + " nodos); "
          + ("quedó INACTIVO." if not vivo.get("active") else "sigue activo: n8n 2.x publica aparte la última versión."))
    print("  · Falta asignarlo en settings.errorWorkflow de los flujos con relé (paso aparte).")

(credencial if MODO == "credencial" else flujo)()
PY

export ALERTA_BASE="$N8N_BASE_URL" ALERTA_ENV="$ENV_FILE" ALERTA_APLICAR="$APLICAR" ALERTA_FLUJO="$ARCHIVO_FLUJO"
export ALERTA_RESPALDO_DIR="${XDG_RUNTIME_DIR:-$WORK}/cargar-alerta-n8n-respaldos"

if (( APLICAR )); then ESTADO="APLICANDO"; else ESTADO="seco (no escribe)"; fi
echo "Entorno: produccion  ·  modo ${MODO}  ·  ${ESTADO}"
(( ! APLICAR )) || echo "  · producción: solo con el «sí» de Andres, después del seco"
echo

# Ejecuta la tubería gcloud | programa y devuelve el estado de cada lado sin mostrar nunca lo que viaja.
correr_tuberia() { # <comando de gcloud ya armado como arreglo en TUBERIA_GC>
  set +e
  "${TUBERIA_GC[@]}" 2>"$ERR" | python3 -I -c "$PROGRAMA" "$MODO"
  local estados=("${PIPESTATUS[@]}")
  set -e
  if [[ "${estados[0]}" -ne 0 ]]; then
    echo "  ✗ gcloud no pudo entregar el dato (no se escribió nada en n8n):" >&2; sanear; exit 3
  fi
  exit "${estados[1]}"
}

if [[ "$MODO" == credencial ]]; then
  echo "Credencial de n8n «NovuChat alertas (HMAC)»"
  gc secrets describe "$SECRETO_HMAC" --format='value(name)' >/dev/null 2>"$ERR" \
    || { echo "  ✗ ${SECRETO_HMAC} no existe en Secret Manager: corra primero los pasos 1 a 3 de nube-alertas.sh" >&2; sanear; exit 3; }
  echo "  ✓ ${SECRETO_HMAC} existe (su valor no se lee en el seco)"
  if (( APLICAR )); then
    # El valor viaja por la TUBERÍA: gcloud -> entrada estándar del programa -> cuerpo de la llamada a n8n.
    TUBERIA_GC=(gcloud --project "$P" --quiet secrets versions access latest --secret "$SECRETO_HMAC")
    correr_tuberia
  fi
  rc=0; python3 -I -c "$PROGRAMA" credencial </dev/null || rc=$?
  exit "$rc"
fi

REGION="$(sed -nE "s/^export const REGION = '([a-z0-9-]+)';$/\1/p" admin/functions/src/core/region.ts 2>/dev/null | head -n 1)"
[[ -n "$REGION" ]] || { echo "✗ No pude leer la región de admin/functions/src/core/region.ts" >&2; exit 2; }
echo "Flujo «NovuChat — Error de envío incierto»"
TUBERIA_GC=(gcloud --project "$P" --quiet run services describe "$SERVICIO_ALERTAS" --region "$REGION" --format='value(status.url)')
correr_tuberia
