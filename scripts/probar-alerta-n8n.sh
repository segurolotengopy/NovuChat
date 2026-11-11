#!/usr/bin/env bash
# PRUEBA DE ERROR FORZADO de la alerta «NovuChat — Error de envío incierto» en el n8n de producción, sin tocar ningún
# flujo de cliente. SECO por omisión (solo GET); nada sensible sale por la pantalla.
#
# QUÉ DEMUESTRA. Que, cuando un flujo con settings.errorWorkflow = el flujo de alertas termina en error en el nodo
# «Detener por envío incierto», n8n dispara el Error Trigger y la alerta REAL (HMAC -> Function alertaOperativa -> correo/aviso)
# llega a Andres. «Armar alerta» solo marca `urgente / envio_incierto` si el ÚLTIMO nodo ejecutado se llama exactamente
# «Detener por envío incierto»; por eso el flujo temporal lleva un nodo con ese nombre (Stop and Error) como único paso.
#
#   ./scripts/probar-alerta-n8n.sh [--env .env] [--espera N]
#       SECO: comprueba que existe EXACTAMENTE un flujo «NovuChat — Error de envío incierto» (y que tiene su Error Trigger),
#       que no quedó un temporal de una prueba anterior, y dice qué haría. Solo GET. El id no se imprime.
#   ./scripts/probar-alerta-n8n.sh --aplicar --confirmo produccion [--env .env] [--espera N]
#       1. Crea el flujo «NovuChat — PRUEBA alerta (temporal)»: Webhook (ruta aleatoria) -> «Detener por envío incierto»,
#          con settings.errorWorkflow = el id del flujo de alertas y saveData{Error,Success}Execution = none.
#       2. Lo activa SOLO el tiempo necesario y lo dispara UNA vez (POST al webhook; solo se repite si el webhook contesta 404,
#          que significa que NO se ejecutó nada).
#       3. Espera N segundos (por omisión 15) e informa si el flujo de alertas registró ejecuciones nuevas y con qué estado.
#       4. SIEMPRE (trap, también ante Ctrl-C o fallo a mitad): lo desactiva, lo borra y relee que no quede ningún flujo con ese nombre.
#
# COSTO: 1 aviso de prueba a Andres (cuenta contra el tope de 5 al día de la Function). 0 mensajes de WhatsApp. Ningún flujo de cliente
# se lee ni se escribe. Solo se llama a la API pública de n8n y a la ruta de webhook del flujo temporal.
#
# LO QUE LA API NO PERMITE VER. El flujo de alertas guarda las ejecuciones EXITOSAS con `none` (decisión del 10/11/2026): un envío
# correcto no deja fila. Por eso el informe distingue «ejecución con error» (la alerta falló) de «sin ejecuciones guardadas» (consistente
# con éxito, pero no lo prueba): la prueba de que salió es el aviso que llega a Andres. NO VERIFICADO en n8n 2.36.5 (se comprueba con
# esta prueba): que el Error Trigger dispare con el flujo de alertas INACTIVO; este script NO lo activa. Si no dispara, no habrá aviso.
#
# La RUTA del webhook es URL de capacidad: se genera al azar, viaja a curl por un archivo de configuración en memoria (-K) y no se
# imprime ni se guarda. Los ids de n8n (el de la alerta y el del temporal) tampoco se imprimen. La clave de la API sale de --env
# (solo N8N_BASE_URL y N8N_API_KEY, leídos como datos sin ejecutar el archivo; con --aplicar exige que sea del usuario y de modo 600)
# y viaja a curl por la entrada estándar (-H @-); NUNCA al webhook. Sin respaldo: no existe estado previo que preservar (es un flujo
# nuevo que se destruye; el seco aborta si ya hay uno).
#
# Salida: 0 hecho (seco sin hallazgos, o prueba disparada y limpia) · 2 uso, salvaguarda o validación previa (nada escrito) ·
# 3 error de ejecución, de n8n o limpieza incompleta · 4 la prueba se hizo y limpió, pero el flujo de alertas registró un ERROR.
set -euo pipefail
# NUNCA con xtrace: imprimiría cada comando ya expandido.
case "$-" in *x*) echo "✗ xtrace activo (bash -x o SHELLOPTS=xtrace): imprimiría datos sensibles. No se escribió nada." >&2; exit 2 ;; esac
[[ "${SHELLOPTS:-}" != *xtrace* ]] || { echo "✗ SHELLOPTS=xtrace en el entorno: imprimiría datos sensibles. No se escribió nada." >&2; exit 2; }
set +x
unset N8N_BASE_URL N8N_API_KEY
ESTE="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$ESTE")/.." || exit 1
ayuda() { awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$ESTE"; }

readonly NOMBRE_ALERTA="NovuChat — Error de envío incierto"
readonly NOMBRE_TEMPORAL="NovuChat — PRUEBA alerta (temporal)"

ENV_FILE=".env"; APLICAR=0; CONFIRMO=""; ESPERA=15
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)      [[ $# -ge 2 ]] || { echo "✗ --env necesita un valor" >&2; exit 2; }; ENV_FILE="$2"; shift 2 ;;
    --espera)   [[ $# -ge 2 && "$2" =~ ^[0-9]{1,3}$ && "$2" -le 120 ]] || { echo "✗ --espera necesita un entero de 0 a 120 (segundos)" >&2; exit 2; }; ESPERA="$2"; shift 2 ;;
    --aplicar)  APLICAR=1; shift ;;
    --confirmo) [[ $# -ge 2 ]] || { echo "✗ --confirmo necesita un valor" >&2; exit 2; }; CONFIRMO="$2"; shift 2 ;;
    -h|--help)  ayuda; exit 0 ;;
    *) echo "✗ Opción desconocida (ver --help)" >&2; exit 2 ;;
  esac
done
if (( APLICAR )); then
  [[ "$CONFIRMO" == "produccion" ]] || { echo "✗ --aplicar exige --confirmo produccion (escrito a mano). No se escribió nada." >&2; exit 2; }
elif [[ -n "$CONFIRMO" ]]; then echo "✗ --confirmo solo va con --aplicar" >&2; exit 2; fi

[[ -f "$ENV_FILE" ]] || { echo "✗ No existe --env" >&2; exit 2; }
if (( APLICAR )); then
  [[ -O "$ENV_FILE" && "$(stat -c %a "$ENV_FILE")" == "600" ]] || { echo "✗ Con --aplicar, --env debe ser del usuario y de modo 600" >&2; exit 2; }
fi
valor_env() { grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true; }
N8N_BASE_URL="$(valor_env N8N_BASE_URL)"; N8N_API_KEY="$(valor_env N8N_API_KEY)"
[[ -n "$N8N_BASE_URL" ]] || { echo "✗ Falta N8N_BASE_URL en --env" >&2; exit 2; }
[[ "$N8N_BASE_URL" =~ ^https://[^/[:space:]@]+(/.*)?$ ]] || { echo "✗ N8N_BASE_URL tiene que ser https://" >&2; exit 2; }
[[ "$N8N_API_KEY" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "✗ Falta N8N_API_KEY en --env, o tiene caracteres no esperados" >&2; exit 2; }
BASE="${N8N_BASE_URL%/}"; API="${BASE}/api/v1"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/probar-alerta-n8n.XXXXXX")"
chmod 700 "$WORK"
ERR="$WORK/err"; : >"$ERR"

# --- Ayudante de JSON. Nunca imprime ids, cuerpos ni la ruta del webhook. ----------------------------------------
read -r -d '' PROGRAMA <<'PY' || true
import json, os, re, sys, urllib.parse
E = os.environ
NOMBRE_ALERTA, NOMBRE_TEMPORAL = E["PA_ALERTA"], E["PA_TEMPORAL"]
ID = re.compile(r"[A-Za-z0-9_-]{1,64}")

def _inesperado(*_a):
    print("✗ respuesta inesperada de n8n o error interno: se aborta", file=sys.stderr)
    sys.stdout.flush(); os._exit(3)
sys.excepthook = _inesperado

def cargar(ruta):
    with open(ruta, encoding="utf-8") as f:
        return json.load(f)
def archivado(w):
    return w.get("isArchived") is True or w.get("archived") is True

cmd = sys.argv[1]
if cmd == "fusionar":      # <lista.json acumulada> <rta.json>  -> imprime el cursor siguiente (vacío si no hay más)
    acum, rta = cargar(sys.argv[2]), cargar(sys.argv[3])
    if not isinstance(rta, dict) or not isinstance(rta.get("data"), list) or not all(isinstance(x, dict) for x in rta["data"]):
        sys.exit(3)
    acum += rta["data"]
    json.dump(acum, open(sys.argv[2], "w", encoding="utf-8"))
    c = rta.get("nextCursor")
    if c and not (isinstance(c, str) and re.fullmatch(r"[A-Za-z0-9_=+/.-]{1,512}", c)):
        sys.exit(3)
    print(urllib.parse.quote(c, safe="") if c else "")
elif cmd == "alertas":     # <lista.json> -> un id por línea (solo no archivados); aborta si el id no tiene forma de id
    for w in cargar(sys.argv[2]):
        if w.get("name") == NOMBRE_ALERTA and not archivado(w):
            if not (isinstance(w.get("id"), (str, int)) and ID.fullmatch(str(w["id"]))): sys.exit(3)
            print(w["id"])
elif cmd == "temporales":  # <lista.json> -> un id por línea (archivados incluidos)
    for w in cargar(sys.argv[2]):
        if w.get("name") == NOMBRE_TEMPORAL:
            if not (isinstance(w.get("id"), (str, int)) and ID.fullmatch(str(w["id"]))): sys.exit(3)
            print(w["id"])
elif cmd == "equivalentes":  # <lista.json> -> cuántos nombres equivalentes pero no exactos al de la alerta (mayúsculas, espacios)
    import unicodedata
    n = lambda t: unicodedata.normalize("NFKC", str(t)).casefold().strip()
    print(sum(1 for w in cargar(sys.argv[2]) if w.get("name") != NOMBRE_ALERTA and n(w.get("name", "")) == n(NOMBRE_ALERTA)))
elif cmd == "es_alerta":   # <flujo.json> -> imprime "activo" o "inactivo" si trae su Error Trigger; si no, sale 1
    w = cargar(sys.argv[2])
    nodos = w.get("nodes") if isinstance(w.get("nodes"), list) else []
    if w.get("name") != NOMBRE_ALERTA or not any(isinstance(n, dict) and n.get("type") == "n8n-nodes-base.errorTrigger" for n in nodos):
        sys.exit(1)
    print("activo" if w.get("active") else "inactivo")
elif cmd == "cuerpo":      # <salida.json>; PA_ID_ALERTA y PA_RUTA por el entorno de este proceso
    ident, ruta = E["PA_ID_ALERTA"], E["PA_RUTA"]
    if not ID.fullmatch(ident) or not re.fullmatch(r"[0-9a-f]{32}", ruta): sys.exit(2)
    cuerpo = {
        "name": NOMBRE_TEMPORAL,
        "nodes": [
            {"id": "prueba-disparo", "name": "Disparo de prueba", "type": "n8n-nodes-base.webhook", "typeVersion": 2,
             "position": [0, 0], "webhookId": E["PA_WEBHOOK_ID"],
             "parameters": {"httpMethod": "POST", "path": ruta, "responseMode": "onReceived", "options": {}}},
            # El nombre EXACTO es lo que «Armar alerta» compara para marcar el aviso como urgente / envio_incierto.
            {"id": "prueba-detener", "name": "Detener por envío incierto", "type": "n8n-nodes-base.stopAndError", "typeVersion": 1,
             "position": [240, 0], "parameters": {"errorType": "errorMessage", "errorMessage": "Prueba de la alerta (forzada)"}},
        ],
        "connections": {"Disparo de prueba": {"main": [[{"node": "Detener por envío incierto", "type": "main", "index": 0}]]}},
        "settings": {"executionOrder": "v1", "timezone": "America/La_Paz", "errorWorkflow": ident,
                     "saveDataErrorExecution": "none", "saveDataSuccessExecution": "none", "saveManualExecutions": False},
    }
    json.dump(cuerpo, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False)
elif cmd == "id_de":       # <rta.json> -> el id de la respuesta de crear
    w = cargar(sys.argv[2])
    if not (isinstance(w, dict) and isinstance(w.get("id"), (str, int)) and ID.fullmatch(str(w["id"]))): sys.exit(3)
    print(w["id"])
elif cmd == "activo":      # <rta.json> -> "true"/"false"
    w = cargar(sys.argv[2]); print("true" if isinstance(w, dict) and w.get("active") is True else "false")
elif cmd == "ejecuciones":  # <rta.json> -> ids, uno por línea
    d = cargar(sys.argv[2])
    if not isinstance(d, dict) or not isinstance(d.get("data"), list): sys.exit(3)
    for x in d["data"]:
        if isinstance(x, dict) and x.get("id") is not None: print(x["id"])
elif cmd == "nuevas":      # <rta.json> <ids previos, uno por línea> -> "<n> <estado>[,<estado>…]" (solo estados, nunca datos)
    d = cargar(sys.argv[2])
    if not isinstance(d, dict) or not isinstance(d.get("data"), list): sys.exit(3)
    previos = set(open(sys.argv[3], encoding="utf-8").read().split())
    estados = sorted(str(x.get("status", "?")) for x in d["data"] if isinstance(x, dict) and str(x.get("id")) not in previos)
    estados = [re.sub(r"[^a-z]", "", s.lower())[:12] or "?" for s in estados]
    print(len(estados), ",".join(estados))
else:
    sys.exit(2)
PY
py() { PA_ALERTA="$NOMBRE_ALERTA" PA_TEMPORAL="$NOMBRE_TEMPORAL" python3 -I -c "$PROGRAMA" "$@"; }

# --- n8n por la API: la clave va por stdin (-H @-), nunca por argumentos -------------------------------------------
CODIGO=000
api() { # <método> <ruta> [archivo-cuerpo]   -> deja $WORK/rta.json y $CODIGO
  local m="$1" r="$2" b="${3:-}" rc=0 args
  if [[ "$m" != GET ]] && (( ! APLICAR )); then echo "✗ BUG: escritura (${m}) sin --aplicar; se detiene" >&2; exit 3; fi
  args=(-sS --max-time 60 --proto '=https' -o "$WORK/rta.json" -w '%{http_code}' -X "$m" -H @-)
  [[ -z "$b" ]] || args+=(-H "Content-Type: application/json" --data-binary "@$b")
  CODIGO="$(curl "${args[@]}" "${API}${r}" 2>"$ERR" <<<"X-N8N-API-KEY: ${N8N_API_KEY}")" || { rc=$?; CODIGO=000; }
  return 0
}
listar() { # deja $WORK/lista.json con TODOS los flujos (sigue nextCursor); 1 si algo no cuadra
  local cursor=""
  echo '[]' >"$WORK/lista.json"
  while :; do
    api GET "/workflows?limit=250${cursor:+&cursor=$cursor}"
    [[ "$CODIGO" == 200 ]] || return 1
    cursor="$(py fusionar "$WORK/lista.json" "$WORK/rta.json")" || return 1
    [[ -n "$cursor" ]] || return 0
  done
}

ID_ALERTA=""; ID_TEMPORAL=""; EMPEZO_A_ESCRIBIR=0
# Borra TODO flujo con el nombre del temporal (la comprobación previa garantiza que no había otro): sirve igual si el POST
# falló a mitad y no se llegó a conocer el id. n8n 2.x puede exigir archivar antes de borrar: se prueba directo y, si no, archivando.
limpiar() {
  local ids i quedan
  (( EMPEZO_A_ESCRIBIR )) || return 0

  if ! listar; then echo "✗ LIMPIEZA: no pude leer la lista de flujos de n8n; compruebe a mano que no quede «${NOMBRE_TEMPORAL}» (activo o no)" >&2; return 1; fi
  ids="$(py temporales "$WORK/lista.json")" || { echo "✗ LIMPIEZA: lista de flujos ilegible" >&2; return 1; }
  for i in $ids; do
    api POST "/workflows/${i}/deactivate"
    api DELETE "/workflows/${i}"
    if [[ ! "$CODIGO" =~ ^(200|204)$ ]]; then
      api POST "/workflows/${i}/archive"
      api DELETE "/workflows/${i}"
    fi
  done
  if ! listar; then echo "✗ LIMPIEZA: no pude releer la lista tras borrar" >&2; return 1; fi
  quedan="$(py temporales "$WORK/lista.json" | wc -l)"
  if (( quedan != 0 )); then echo "✗ LIMPIEZA INCOMPLETA: queda ${quedan} flujo(s) «${NOMBRE_TEMPORAL}» en n8n. Bórrelo(s) a mano (desactivar y eliminar)." >&2; return 1; fi
  EMPEZO_A_ESCRIBIR=0
  echo "  ✓ Limpieza: el temporal se desactivó y se borró; la relectura no encuentra ningún flujo «${NOMBRE_TEMPORAL}»."
}
# shellcheck disable=SC2329  # se invoca por trap
al_salir() {
  local rc=$?
  trap - EXIT INT TERM
  if ! limpiar; then rc=3; fi
  rm -rf "$WORK"
  exit "$rc"
}
trap al_salir EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if (( APLICAR )); then ESTADO="APLICANDO"; else ESTADO="seco (solo lee)"; fi
echo "Entorno: produccion  ·  prueba de error forzado de la alerta  ·  ${ESTADO}"
(( ! APLICAR )) || echo "  · producción: solo con el «sí» de Andres, después del seco"
echo

# --- Comprobaciones (también en seco) ----------------------------------------------------------------------------
listar || { echo "✗ n8n respondió ${CODIGO} o no entregó la lista de flujos: no se sigue" >&2; exit 3; }
if [[ "$(py equivalentes "$WORK/lista.json")" != 0 ]]; then
  echo "✗ Hay un flujo con nombre equivalente pero no exacto a «${NOMBRE_ALERTA}»: se aborta sin escribir" >&2; exit 2
fi
mapfile -t ALERTAS < <(py alertas "$WORK/lista.json")
case "${#ALERTAS[@]}" in
  1) ID_ALERTA="${ALERTAS[0]}" ;;
  0) echo "✗ No existe el flujo «${NOMBRE_ALERTA}» en este n8n: cárguelo antes (scripts/cargar-alerta-n8n.sh). No se escribió nada." >&2; exit 2 ;;
  *) echo "✗ Hay ${#ALERTAS[@]} flujos «${NOMBRE_ALERTA}»: no se elige uno. No se escribió nada." >&2; exit 2 ;;
esac
echo "  ✓ Existe exactamente un flujo «${NOMBRE_ALERTA}» (id no mostrado)"
api GET "/workflows/${ID_ALERTA}"
[[ "$CODIGO" == 200 ]] || { echo "✗ n8n respondió ${CODIGO} al leer el flujo de alertas" >&2; exit 3; }
ESTADO_ALERTA="$(py es_alerta "$WORK/rta.json")" || { echo "✗ El flujo de alertas no trae su Error Trigger o su nombre no coincide: se aborta sin escribir" >&2; exit 2; }
echo "  ✓ Tiene su Error Trigger; está ${ESTADO_ALERTA} (este script no lo cambia)"
if [[ -n "$(py temporales "$WORK/lista.json")" ]]; then
  echo "✗ Ya existe un flujo «${NOMBRE_TEMPORAL}» (resto de una prueba anterior): bórrelo a mano y repita. No se escribió nada." >&2; exit 2
fi
echo "  ✓ No hay ningún flujo «${NOMBRE_TEMPORAL}» previo"

if (( ! APLICAR )); then
  echo
  echo "Seco: no se escribió nada. Con --aplicar --confirmo produccion se haría:"
  echo "  1. crear «${NOMBRE_TEMPORAL}» (Webhook de ruta aleatoria -> «Detener por envío incierto»), errorWorkflow = la alerta, sin guardar ejecuciones;"
  echo "  2. activarlo, dispararlo UNA vez y esperar ${ESPERA} s;"
  echo "  3. informar si el flujo de alertas registró ejecuciones nuevas y su estado;"
  echo "  4. desactivarlo y borrarlo SIEMPRE, y releer que no quede ninguno."
  echo "Costo: 1 aviso de prueba a Andres (tope de 5 al día de la Function). 0 mensajes de WhatsApp."
  exit 0
fi

# --- Aplicar -----------------------------------------------------------------------------------------------------
# Referencia de ejecuciones del flujo de alertas ANTES de disparar (para distinguir las nuevas sin depender de relojes).
api GET "/executions?workflowId=${ID_ALERTA}&limit=100"
[[ "$CODIGO" == 200 ]] || { echo "✗ n8n respondió ${CODIGO} al leer las ejecuciones del flujo de alertas: no se sigue" >&2; exit 3; }
py ejecuciones "$WORK/rta.json" >"$WORK/previas" || { echo "✗ lista de ejecuciones ilegible" >&2; exit 3; }

RUTA="$(python3 -I -c 'import secrets; print(secrets.token_hex(16))')"
WEBHOOK_ID="$(python3 -I -c 'import uuid; print(uuid.uuid4())')"
PA_ID_ALERTA="$ID_ALERTA" PA_RUTA="$RUTA" PA_WEBHOOK_ID="$WEBHOOK_ID" py cuerpo "$WORK/cuerpo.json" || { echo "✗ no pude armar el flujo temporal" >&2; exit 2; }

EMPEZO_A_ESCRIBIR=1
echo "Prueba"
api POST "/workflows" "$WORK/cuerpo.json"
[[ "$CODIGO" =~ ^(200|201)$ ]] || { echo "✗ n8n respondió ${CODIGO} al crear el flujo temporal" >&2; exit 3; }
ID_TEMPORAL="$(py id_de "$WORK/rta.json")" || { echo "✗ n8n no devolvió el id del flujo temporal" >&2; exit 3; }
echo "  ✓ Flujo temporal creado (inactivo; id no mostrado)"

api POST "/workflows/${ID_TEMPORAL}/activate"
[[ "$CODIGO" =~ ^(200|201)$ ]] || { echo "✗ n8n respondió ${CODIGO} al activar el flujo temporal" >&2; exit 3; }
[[ "$(py activo "$WORK/rta.json")" == true ]] || { echo "✗ n8n no dejó activo el flujo temporal" >&2; exit 3; }
echo "  ✓ Activado"
sleep "$(( ESPERA < 2 ? ESPERA : 2 ))"

# El disparo: la URL (con la ruta) viaja a curl por un archivo de configuración en memoria; la clave de la API NO se envía aquí.
disparar() {
  local cod rc=0
  cod="$(curl -sS --max-time 30 --proto '=https' -o /dev/null -w '%{http_code}' -X POST -H "Content-Type: application/json" --data-binary '{}' \
         -K <(printf 'url = "%s/webhook/%s"\n' "$BASE" "$RUTA") 2>"$ERR")" || { rc=$?; cod=000; }
  echo "$cod"
}
COD_WEBHOOK="$(disparar)"
if [[ "$COD_WEBHOOK" == 404 ]]; then   # 404 = el webhook aún no estaba registrado: no se ejecutó nada, un único reintento
  sleep 3
  COD_WEBHOOK="$(disparar)"
fi
if [[ ! "$COD_WEBHOOK" =~ ^2[0-9][0-9]$ ]]; then
  echo "✗ El webhook del temporal respondió ${COD_WEBHOOK}: la prueba NO se disparó (se limpia el temporal)" >&2; exit 3
fi
echo "  ✓ Disparado una vez (el webhook respondió ${COD_WEBHOOK})"

echo "  · Espero ${ESPERA} s a que n8n dispare el Error Trigger..."
sleep "$ESPERA"
api GET "/executions?workflowId=${ID_ALERTA}&limit=100"
if [[ "$CODIGO" != 200 ]]; then
  echo "  ? No pude leer las ejecuciones del flujo de alertas (HTTP ${CODIGO}); verifique el aviso en el buzón de Andres." >&2
  RESULTADO=0
else
  SAL="$(py nuevas "$WORK/rta.json" "$WORK/previas")" || { echo "✗ lista de ejecuciones ilegible" >&2; exit 3; }
  read -r NUEVAS ESTADOS <<<"$SAL"
  if (( NUEVAS == 0 )); then
    echo "  = El flujo de alertas no guardó ejecuciones nuevas. Con saveDataSuccessExecution=none eso es lo esperado si la alerta salió bien,"
    echo "    y también si el Error Trigger no disparó: la evidencia es el aviso que llega a Andres (urgente, «Envío incierto», flujo «PRUEBA alerta (temporal)»)."
    RESULTADO=0
  elif [[ ",${ESTADOS}," == *,error,* || ",${ESTADOS}," == *,crashed,* ]]; then
    echo "  ✗ El flujo de alertas SÍ corrió y terminó con ERROR (${NUEVAS} nueva(s): ${ESTADOS}). La alerta no salió: revise la credencial HMAC y la Function (ver-ejecuciones.sh)."
    RESULTADO=4
  else
    echo "  ✓ El flujo de alertas corrió (${NUEVAS} ejecución(es) nueva(s): ${ESTADOS}, sin error)."
    RESULTADO=0
  fi
fi
echo
echo "Limpieza"
limpiar || exit 3
echo
if (( RESULTADO == 0 )); then echo "Prueba terminada. Falta confirmar que el aviso de prueba llegó a Andres."; fi
exit "$RESULTADO"
