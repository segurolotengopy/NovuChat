#!/usr/bin/env bash
# Carga en n8n, por la API, el TIMBRE de la salida de persona de UN número (alias):
# la credencial Header Auth del webhook y el flujo «NovuChat — Salida de persona»
# con sus marcadores repuestos. SECO por omisión; sin imprimir la clave ni la ruta.
#
# POR QUÉ EXISTE. `scripts/nube-salida-persona.sh --agregar-alias <alias>` genera la
# ruta y la clave del timbre y las deja en un archivo de modo 600 en $XDG_RUNTIME_DIR;
# este es el CONSUMIDOR revisado de ese archivo. Ni `publicar-flujo.sh` ni
# `preparar-import.sh` sirven para este flujo: llenan desde UNA tabla sin sufijo por
# número, abortan con marcadores sin reponer y completan las credenciales por TIPO
# (la trampa del 15/09: un nodo que manda a Meta con la credencial de ingesta). Acá
# cada nodo recibe su credencial POR NOMBRE EXACTO y TIPO; si falta una, se aborta.
#
#   ./scripts/cargar-timbre-n8n.sh --alias <alias> [--env .env] [--aplicar --confirmo produccion]
#       CARGAR (modo por omisión). Seco: lee n8n (solo GET), valida la entrega, la
#       tabla y las credenciales, y dice qué haría. Con --aplicar:
#         1. respalda el estado vivo del alias (modo 600, directorio 700);
#         2. crea o actualiza la credencial Header Auth «Salida de persona (timbre
#            <alias>)» con `Authorization: Bearer <clave>`;
#         3. crea o actualiza el flujo «NovuChat — Salida de persona (<alias>)» con
#            path del webhook = el de la entrega, phoneNumberId y URL interna del relé de
#            la tabla y un `webhookId` estable por alias; lo deja INACTIVO si lo crea (si ya
#            existía y estaba activo, conserva ese estado Y publica la última versión: n8n 2.x
#            separa borrador y publicada, y sin eso seguiría corriendo la vieja);
#         4. relee lo escrito y, solo si todo coincide, BORRA el archivo de entrega.
#       Si algo falla, el archivo de entrega se CONSERVA y se dice cómo seguir.
#   ./scripts/cargar-timbre-n8n.sh --alias <alias> --activar [--aplicar --confirmo produccion]
#       ACTIVAR, paso aparte: el flujo debe existir con credenciales completas. Al
#       activarlo empieza el barrido de cada minuto (llama a reclamarSalidaPersona).
#   ./scripts/cargar-timbre-n8n.sh --alias <alias> --quitar [--aplicar --confirmo produccion]
#       RESTAURACIÓN: desactiva y borra el flujo del alias y borra la credencial del
#       timbre de ese alias (nunca las de ingesta, AAB1 ni WhatsApp). Respalda antes.
#
# OPCIONES. --env <archivo>: de él SOLO se leen N8N_BASE_URL y N8N_API_KEY (no se
# ejecuta; con --aplicar exige que sea del usuario y de modo 600). --flujo <json>: otro
# JSON de flujo (para pruebas). --tabla-demo-a: usa las filas SIN sufijo
# (REEMPLAZAR_PHONE_NUMBER_ID, REEMPLAZAR_URL_INTERNA_DEL_RELE) en vez de las del alias.
#
# LA CLAVE DE LA API DE N8N. Sale de `--env` (el mismo `.env` ignorado, chmod 600, que
# usan publicar-flujo.sh y rotar-ingesta.sh) y viaja a curl por la entrada estándar
# (`-H @-`), nunca por argumentos ni por pantalla. No se pide por el chat ni se pasa
# en una variable del comando. N8N_API_KEY es de administración de TODA la instancia.
#
# LA TABLA (CONFIGURACION.local.md, o la de CONFIG_LOCAL_MD): filas
#   | `REEMPLAZAR_PHONE_NUMBER_ID_<ALIAS>` | valor |
#   | `REEMPLAZAR_URL_INTERNA_DEL_RELE_<ALIAS>` | valor |
# con <ALIAS> en mayúsculas. Coincidencia exacta; "pendiente" o vacío cuentan como falta.
#
# LA ENTREGA: $XDG_RUNTIME_DIR/novuchat-salida-persona-<alias>.json (la deja
# nube-salida-persona.sh). Se abre sin seguir enlaces, y debe ser un archivo propio de
# modo 600. NINGÚN agente ni persona la lee: este script la consume y la borra.
#
# QUÉ NUNCA HACE: activar un WhatsApp Trigger, tocar credenciales de AAB1-WA-Prod,
# asignar una credencial por TIPO, imprimir la clave, la ruta, el phoneNumberId, la
# URL del relé o un id, ni escribir sin --aplicar --confirmo produccion.
#
# A VERIFICAR EN EL ENSAYO (no se puede saber sin n8n real; ver docs/ensayo/LEEME.md §7):
#   - que n8n acepte PATCH /credentials/{id} (rotar-ingesta.sh lo usa) y DELETE;
#   - que el webhook con `path` explícito se registre en /webhook/<path> al activar;
#   - que la API acepte el cuerpo {name,nodes,connections,settings} tal cual;
#   - que el Header Auth con `Bearer <clave>` autentique de verdad el timbre.
#
# Salida: 0 hecho y comprobado, o nada que hacer · 1 el seco encontró pasos pendientes
# · 2 uso, salvaguarda o validación previa (entrega, tabla, plan; nada escrito) · 3 error de
# ejecución (n8n, relectura; puede haber escrito). Con --aplicar exige $XDG_RUNTIME_DIR válido
# y no admite --flujo. El respaldo no lleva la ruta ni la clave del timbre (el path va como
# <capacidad> con su sha256); sí lleva ids, nombres, phoneNumberId y URL del relé.
set -euo pipefail
ESTE="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$ESTE")/.." || exit 1

ayuda() { awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$ESTE"; }

APLICAR=0; CONFIRMO=""; MODO="cargar"; ALIAS=""; ENV_FILE=".env"; FLUJO="Flujos/salida-de-persona.json"; SINSUFIJO=0
fijar_modo() { [[ "$MODO" == cargar ]] || { echo "✗ Un solo modo a la vez (--activar o --quitar)" >&2; exit 2; }; MODO="$1"; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --alias)       [[ $# -ge 2 ]] || { echo "✗ --alias necesita el alias" >&2; exit 2; }; ALIAS="$2"; shift 2 ;;
    --env)         [[ $# -ge 2 ]] || { echo "✗ --env necesita un archivo" >&2; exit 2; }; ENV_FILE="$2"; shift 2 ;;
    --flujo)       [[ $# -ge 2 ]] || { echo "✗ --flujo necesita un archivo" >&2; exit 2; }; FLUJO="$2"; shift 2 ;;
    --tabla-demo-a) SINSUFIJO=1; shift ;;
    --activar)     fijar_modo activar; shift ;;
    --quitar)      fijar_modo quitar; shift ;;
    --aplicar)     APLICAR=1; shift ;;
    --confirmo)    [[ $# -ge 2 ]] || { echo "✗ --confirmo necesita produccion" >&2; exit 2; }; CONFIRMO="$2"; shift 2 ;;
    --confirmo=*)  CONFIRMO="${1#*=}"; shift ;;
    -h|--help)     ayuda; exit 0 ;;
    *) echo "✗ Opción desconocida (ver --help)" >&2; exit 2 ;;
  esac
done
[[ "$ALIAS" =~ ^[A-Za-z][A-Za-z0-9]{1,29}$ ]] || { echo "✗ --alias inválido o ausente (letras y dígitos, de 2 a 30, empieza con letra)" >&2; exit 2; }
if (( APLICAR )) && [[ "$FLUJO" != "Flujos/salida-de-persona.json" ]]; then
  echo "✗ --flujo (otro JSON) solo se permite en seco: con --aplicar se carga únicamente Flujos/salida-de-persona.json. No se escribió nada." >&2; exit 2
fi
if (( APLICAR )) && [[ "$CONFIRMO" != "produccion" ]]; then
  echo "✗ --aplicar exige --confirmo produccion (escrito a mano). No se escribió nada." >&2; exit 2
fi

# --- El entorno de n8n: solo dos claves, por nombre, sin ejecutar el archivo ------
[[ -f "$ENV_FILE" ]] || { echo "✗ No existe el archivo de entorno indicado en --env" >&2; exit 2; }
if (( APLICAR )); then
  [[ -O "$ENV_FILE" ]] || { echo "✗ El archivo de --env no es del usuario: con --aplicar se niega" >&2; exit 2; }
  MODO_ENV="$(stat -c '%a' "$ENV_FILE")"
  (( (8#$MODO_ENV & 8#077) == 0 )) || { echo "✗ El archivo de --env tiene permisos de más (debe ser modo 600): con --aplicar se niega" >&2; exit 2; }
fi
valor_env() { grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true; }
N8N_BASE_URL="$(valor_env N8N_BASE_URL)"; N8N_API_KEY="$(valor_env N8N_API_KEY)"
[[ "$N8N_BASE_URL" =~ ^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{2,5})?$ ]] \
  || { echo "✗ N8N_BASE_URL (en --env) tiene que ser https://<host> sin ruta, sin barra final ni usuario" >&2; exit 2; }
N8N_API_KEY="$N8N_API_KEY" python3 -I -c 'import os, re, sys; sys.exit(0 if re.fullmatch(r"[A-Za-z0-9._-]+", os.environ.get("N8N_API_KEY", "")) else 1)' || { echo "✗ Falta N8N_API_KEY en --env, o tiene caracteres no esperados" >&2; exit 2; }
API="${N8N_BASE_URL}/api/v1"

V=$'\e[32m'; A=$'\e[33m'; R=$'\e[31m'; F=$'\e[0m'
ok()    { echo "  ${V}✓${F} $*"; }
nota()  { echo "  ${A}·${F} $*"; }
falla() { echo "  ${R}✗${F} $*" >&2; }
hacer() { if (( APLICAR )); then echo "  → $*"; else echo "  (haría) $*"; fi; }

# --- Directorio de trabajo de modo 700 ---------------------------------------------
BASE_TMP="${TMPDIR:-/tmp}"
# Con escritura (--aplicar) el directorio de trabajo, el respaldo y la entrega viven SOLO en
# $XDG_RUNTIME_DIR (memoria, modo 700, del usuario): no hay plan B en /tmp.
if (( APLICAR )) && [[ -z "${XDG_RUNTIME_DIR:-}" || ! -d "$XDG_RUNTIME_DIR" || ! -O "$XDG_RUNTIME_DIR" || "$(stat -c '%a' "$XDG_RUNTIME_DIR" 2>/dev/null)" != "700" ]]; then
  echo "✗ --aplicar exige un \$XDG_RUNTIME_DIR válido (del usuario y de modo 700): ahí van el respaldo y la entrega, nunca a /tmp. No se escribió nada." >&2; exit 2
fi
if [[ -n "${XDG_RUNTIME_DIR:-}" && -d "$XDG_RUNTIME_DIR" && -O "$XDG_RUNTIME_DIR" && "$(stat -c '%a' "$XDG_RUNTIME_DIR" 2>/dev/null)" == "700" ]]; then
  BASE_TMP="$XDG_RUNTIME_DIR"
fi
umask 077
WORK="$(mktemp -d "$BASE_TMP/cargar-timbre-n8n.XXXXXX")"
chmod 700 "$WORK"
ERR="$WORK/err"; : >"$ERR"; CONSERVAR=0
# shellcheck disable=SC2329  # se invoca por el trap EXIT
limpiar() {
  if (( CONSERVAR )); then find "$WORK" -mindepth 1 ! -name 'respaldo-vivo.json' -delete 2>/dev/null || true
  else rm -rf "$WORK"; fi
}
trap limpiar EXIT

# --- La parte en python: todo lo que toca valores vive acá, y no los imprime ----------
cat >"$WORK/lib.py" <<'PY'
import hashlib, json, os, re, stat, sys

NOMBRE_BASE = "NovuChat — Salida de persona"
RE_TOKEN = re.compile(r"REEMPLAZAR_[A-Z][A-Z0-9_]*")
RE_CAP = re.compile(r"^[A-Za-z0-9_-]{16,100}$")
RE_PHONE = re.compile(r"^[0-9]{8,20}$")
RE_RELE = re.compile(r"^https?://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{2,5})?(/[A-Za-z0-9._~/-]*)?$")


def salir(cod, msg=""):
    if msg:
        print(msg)
    sys.exit(cod)


def escribir_600(ruta, texto):
    fd = os.open(ruta, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(texto)


def cargar(ruta):
    with open(ruta, encoding="utf-8") as f:
        return json.load(f)


def nombres(alias):
    return {
        "timbre": "Salida de persona (timbre %s)" % alias,
        "ingesta": "NovuChat ingesta (%s)" % alias,
        "rele": "AAB1 envío · %s" % alias,
        "graph": "WhatsApp %s (envío)" % alias,
        "flujo": "%s (%s)" % (NOMBRE_BASE, alias),
    }


def cmd_lista(archivo):
    """La lista de n8n llegó entera: data es una lista y no hay nextCursor."""
    try:
        d = cargar(archivo)
    except Exception:
        salir(3, "la respuesta de n8n no es JSON")
    if not isinstance(d, dict) or not isinstance(d.get("data"), list):
        salir(3, "n8n no entregó una lista")
    if d.get("nextCursor"):
        salir(3, "la lista de n8n llegó partida (más de 250): no se decide con una lista parcial")


def cmd_id(archivo):
    try:
        d = cargar(archivo)
        i = str(d.get("id", ""))
    except Exception:
        i = ""
    if not re.match(r"^[A-Za-z0-9_-]{1,64}$", i):
        salir(3, "la respuesta de n8n no trajo un id válido")
    print(i)


def cmd_campo(archivo, campo):
    d = cargar(archivo)
    v = d.get(campo, "")
    print("true" if v is True else "false" if v is False else v)


def cmd_entrega(archivo, alias, base, cuerpo_out, path_out):
    try:
        fd = os.open(archivo, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError:
        salir(4, "no hay archivo de entrega para este alias (o es un enlace, o no se puede abrir)")
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_uid != os.getuid() or (st.st_mode & 0o077):
            salir(4, "el archivo de entrega no es un archivo propio de modo 600")
        with os.fdopen(fd, "r", encoding="utf-8") as f:
            d = json.load(f)
    except SystemExit:
        raise
    except Exception:
        salir(4, "el archivo de entrega no es JSON legible")
    if not isinstance(d, dict) or d.get("alias") != alias:
        salir(4, "la entrega no es de este alias")
    path, clave, ruta = d.get("path"), d.get("clave"), d.get("ruta")
    if not (isinstance(path, str) and RE_CAP.match(path) and isinstance(clave, str) and RE_CAP.match(clave)):
        salir(4, "la entrega no trae un path y una clave con la forma esperada")
    if ruta != base + "/webhook/" + path:
        salir(4, "la ruta de la entrega no corresponde a N8N_BASE_URL de --env (¿otra instancia?)")
    escribir_600(cuerpo_out, json.dumps({
        "name": nombres(alias)["timbre"], "type": "httpHeaderAuth",
        "data": {"name": "Authorization", "value": "Bearer " + clave}}))
    escribir_600(path_out, path)


def cmd_tabla(local, alias, sinsufijo, salida):
    suf = "" if sinsufijo == "1" else "_" + alias.upper()
    kp, kr = "REEMPLAZAR_PHONE_NUMBER_ID" + suf, "REEMPLAZAR_URL_INTERNA_DEL_RELE" + suf
    try:
        lineas = open(local, encoding="utf-8").read().splitlines()
    except Exception:
        salir(4, "no puedo leer la tabla de marcadores (CONFIGURACION.local.md o CONFIG_LOCAL_MD)")
    fila = re.compile(r"^\|\s*`(REEMPLAZAR_[^`]*)`\s*\|([^|]*)\|")
    tabla = {}
    for l in lineas:
        m = fila.match(l)
        if m and "pendiente" not in l.lower() and m.group(2).strip().strip("`").strip():
            tabla[m.group(1)] = m.group(2).strip().strip("`").strip()
    faltan = [k for k in (kp, kr) if k not in tabla]
    if faltan:
        salir(4, "faltan en la tabla (o están pendientes): " + ", ".join(faltan))
    phone, rele = tabla[kp], tabla[kr].rstrip("/")
    if not RE_PHONE.match(phone):
        salir(4, "el valor de %s no tiene la forma de un phone number id" % kp)
    if not RE_RELE.match(rele):
        salir(4, "el valor de %s no es una URL http(s) de host y ruta simples" % kr)
    escribir_600(salida, json.dumps({"phone": phone, "rele": rele}))


def recorrer(x, f, clave=None):
    if isinstance(x, str):
        return f(x, clave)
    if isinstance(x, list):
        return [recorrer(i, f, clave) for i in x]
    if isinstance(x, dict):
        return {k: recorrer(v, f, k) for k, v in x.items()}
    return x


def revisar_roles(nodos, alias):
    """El nodo que manda a Meta o al relé nunca lleva la credencial de ingesta."""
    n = nombres(alias)
    errores = []
    esperado = {  # nodo -> (tipo de credencial, nombre exacto)
        "Timbre": ("httpHeaderAuth", n["timbre"]),
        "Reclamar": ("httpHeaderAuth", n["ingesta"]),
        "Confirmar": ("httpHeaderAuth", n["ingesta"]),
        "Enviar por el relé": ("httpHeaderAuth", n["rele"]),
        "Enviar por Graph": ("whatsAppApi", n["graph"]),
    }
    por_nombre = {x.get("name"): x for x in nodos}
    for nom, (tipo, cred) in esperado.items():
        x = por_nombre.get(nom)
        if x is None:
            errores.append("falta el nodo %s" % nom)
            continue
        c = x.get("credentials") or {}
        if set(c) != {tipo} or (c[tipo] or {}).get("name") != cred:
            errores.append("%s debe llevar exactamente la credencial %s «%s»" % (nom, tipo, cred))
    t = por_nombre.get("Timbre")
    if t is not None and (t.get("parameters") or {}).get("authentication") != "headerAuth":
        errores.append("el nodo Timbre no exige authentication=headerAuth: quedaría abierto")
    ids_ingesta = set()
    for nodo in nodos:
        for tp, ref in (nodo.get("credentials") or {}).items():
            if (ref or {}).get("name") == n["ingesta"]:
                ids_ingesta.add(ref.get("id"))
    for nodo in nodos:
        tipo = nodo.get("type", "").lower()
        if "whatsapptrigger" in tipo:
            errores.append("el flujo trae un WhatsApp Trigger (%s): no se carga" % nodo.get("name"))
        p = json.dumps(nodo.get("parameters") or {})
        if "httprequest" in tipo and re.search(r"subscriptions|subscribed_apps|/register|message_templates", p, re.I):
            errores.append("%s llama a subscriptions/subscribed_apps/register/message_templates: eso es de otra sesión" % nodo.get("name"))
        manda = nodo.get("name") in ("Enviar por el relé", "Enviar por Graph") or "graph.facebook.com" in p or "releBaseUrl" in p
        for tp, ref in (nodo.get("credentials") or {}).items():
            nom = (ref or {}).get("name", "")
            if re.search(r"WA-Prod|AAB1-WA|segurolotengo", nom, re.I):
                errores.append("%s usa una credencial de AAB1-WA-Prod o de otro sistema: prohibido" % nodo.get("name"))
            if manda and (nom == n["ingesta"] or (ref or {}).get("id") in ids_ingesta):
                errores.append("%s manda a Meta o al relé y llevaría la credencial de ingesta" % nodo.get("name"))
    return errores


RE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def id_valido(x):
    return isinstance(x, str) and RE_ID.match(x) is not None


def webhook_id(alias):
    import uuid
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "novuchat-salida-persona/" + alias))


def buscar(wfs, creds, alias):
    n = nombres(alias)
    w = [x for x in wfs if x.get("name") == n["flujo"]]
    c = [x for x in creds if x.get("name") == n["timbre"] and x.get("type") == "httpHeaderAuth"]
    return w, c


def cmd_buscar(wfs_f, creds_f, alias, plan_out):
    wfs, creds = cargar(wfs_f)["data"], cargar(creds_f)["data"]
    w, c = buscar(wfs, creds, alias)
    if len(w) > 1:
        salir(4, "hay %d flujos llamados «%s»: no se elige uno" % (len(w), nombres(alias)["flujo"]))
    if len(c) > 1:
        salir(4, "hay %d credenciales «%s»: no se elige una" % (len(c), nombres(alias)["timbre"]))
    for x in w + c:
        if not id_valido(x.get("id")):
            salir(4, "n8n devolvió un id con forma inesperada: no se sigue")
    escribir_600(plan_out, json.dumps({
        "wfId": w[0]["id"] if w else "", "wfActivo": bool(w[0].get("active")) if w else False,
        "timbreId": c[0]["id"] if c else ""}))
    print("flujo del alias: %s · credencial del timbre: %s · estado activo: %s" % (
        "existe" if w else "no existe", "existe" if c else "no existe", "sí" if (w and w[0].get("active")) else "no"))


def cmd_respaldar(wfs_f, creds_f, alias, salida):
    wfs, creds = cargar(wfs_f)["data"], cargar(creds_f)["data"]
    n = nombres(alias)
    propios = [x for x in wfs if str(x.get("name", "")).startswith(NOMBRE_BASE)]
    vivo = [x for x in wfs if x.get("name") == n["flujo"]]
    cred = [{"id": x.get("id"), "name": x.get("name"), "type": x.get("type")}
            for x in creds if x.get("name") in (n["timbre"], n["ingesta"], n["rele"], n["graph"])]
    completo = None
    if vivo:
        completo = json.loads(json.dumps(vivo[0]))
        for nodo in completo.get("nodes", []):
            ps = nodo.get("parameters") or {}
            if "path" in ps:  # la ruta del timbre es una URL de capacidad: no se respalda
                antes = str(ps["path"])
                ps["path"] = "<capacidad>"
                ps["path_sha256"] = hashlib.sha256(antes.encode("utf-8")).hexdigest()
    escribir_600(salida, json.dumps({
        "alias": alias,
        "nota": "sin la ruta ni la clave del timbre; lleva ids, nombres, phoneNumberId y URL interna del rele",
        "workflows_salida_de_persona": [{"id": x.get("id"), "name": x.get("name"), "active": x.get("active")} for x in propios],
        "workflow_del_alias_completo": completo,
        "credenciales_del_alias_sin_ninguna_clave": cred}, ensure_ascii=False))
    print("respaldo: %d flujo(s) de salida de persona, %s del alias, %d credencial(es) del alias (sin la ruta ni la clave del timbre)" % (
        len(propios), "con el flujo completo" if vivo else "sin flujo", len(cred)))


def cmd_plan(flujo_f, wfs_f, creds_f, tabla_f, path_f, alias, timbre_id, cuerpo_out, plan_out):
    n = nombres(alias)
    flujo = cargar(flujo_f)
    t = cargar(tabla_f)
    path = open(path_f, encoding="utf-8").read()
    reemplazos = {"REEMPLAZAR_ALIAS": alias, "REEMPLAZAR_RUTA_TIMBRE": path,
                  "REEMPLAZAR_PHONE_NUMBER_ID": t["phone"], "REEMPLAZAR_URL_INTERNA_DEL_RELE": t["rele"]}

    def sustituir(s, clave):
        if clave in ("notes", "content"):  # notas y stickyNote no llevan valores: la ruta es una URL de capacidad
            return RE_TOKEN.sub("<marcador>", s)
        return RE_TOKEN.sub(lambda m: reemplazos.get(m.group(0), m.group(0)), s)

    flujo = recorrer(flujo, sustituir)
    sobran = sorted(set(RE_TOKEN.findall(json.dumps(flujo, ensure_ascii=False))))
    if sobran:
        salir(4, "quedan marcadores sin reponer: " + ", ".join(sobran))
    wfs, creds = cargar(wfs_f)["data"], cargar(creds_f)["data"]
    indice = {}
    for c in creds:
        indice.setdefault((c.get("type"), c.get("name")), []).append(c)
    errores = []
    for nodo in flujo["nodes"]:
        for tipo, ref in list((nodo.get("credentials") or {}).items()):
            nom = (ref or {}).get("name") or ""
            if not nom:
                errores.append("%s: credencial %s sin nombre (no se asigna por TIPO)" % (nodo["name"], tipo))
                continue
            if tipo == "httpHeaderAuth" and nom == n["timbre"]:
                ident = timbre_id or "PENDIENTE-DEL-TIMBRE"
            else:
                h = indice.get((tipo, nom), [])
                if len(h) != 1:
                    errores.append("%s: hay %d credenciales %s llamadas «%s» (tiene que haber exactamente una)" % (nodo["name"], len(h), tipo, nom))
                    continue
                ident = h[0]["id"]
                if not id_valido(ident):
                    errores.append("%s: id de credencial con forma inesperada" % nodo["name"])
                    continue
            nodo["credentials"][tipo] = {"id": ident, "name": nom}
    errores += revisar_roles(flujo["nodes"], alias)
    for nodo in flujo["nodes"]:
        if nodo.get("name") == "Timbre" and (nodo.get("parameters") or {}).get("path") != path:
            errores.append("el nodo Timbre no quedó con el path de la entrega")
    if errores:
        salir(4, "\n".join("    " + e for e in errores))
    w, c = buscar(wfs, creds, alias)
    if len(w) > 1 or len(c) > 1:
        salir(4, "hay duplicados del flujo o de la credencial del timbre: no se elige uno")
    for x in w + c:
        if not id_valido(x.get("id")):
            salir(4, "n8n devolvió un id con forma inesperada: no se sigue")
    for nodo in flujo["nodes"]:
        if nodo.get("name") == "Timbre":
            nodo["webhookId"] = webhook_id(alias)  # estable por alias: no depende de guardar desde el editor
    cuerpo = {"name": n["flujo"], "nodes": flujo["nodes"], "connections": flujo["connections"],
              "settings": flujo.get("settings", {})}
    escribir_600(cuerpo_out, json.dumps(cuerpo, ensure_ascii=False))
    escribir_600(plan_out, json.dumps({
        "wfId": w[0]["id"] if w else "", "wfActivo": bool(w[0].get("active")) if w else False,
        "timbreId": c[0]["id"] if c else ""}))
    print("flujo «%s»: %s · credencial del timbre: %s" % (n["flujo"], "se actualiza" if w else "se crea", "se actualiza" if c else "se crea"))
    for nodo in flujo["nodes"]:
        for tipo, ref in (nodo.get("credentials") or {}).items():
            print("    %s <- «%s» (por nombre y tipo %s)" % (nodo["name"], ref["name"], tipo))


def publicada(wf):
    return wf.get("versionId") == wf.get("activeVersionId")


def cmd_publicada(wf_f):
    """n8n 2.x separa borrador y publicada: tras un PUT de un flujo activo la activa sigue siendo la vieja."""
    wf = cargar(wf_f)
    print("si" if publicada(wf) else "no")


def cmd_verificar(wf_f, path_f, alias, activo_esperado, creds_f="-"):
    """Relectura (o previa a activar): sin marcadores, ids vivos, roles, path y webhookId correctos."""
    wf = cargar(wf_f)
    n = nombres(alias)
    path = open(path_f, encoding="utf-8").read() if path_f != "-" else None
    vivas = None
    if creds_f != "-":
        vivas = {(c.get("id"), c.get("name"), c.get("type")) for c in cargar(creds_f)["data"]}
    errores = []
    if wf.get("name") != n["flujo"]:
        errores.append("el nombre del flujo no es el esperado")
    if RE_TOKEN.search(json.dumps(wf, ensure_ascii=False)):
        errores.append("el flujo vivo todavía tiene marcadores sin reponer")
    for nodo in wf.get("nodes", []):
        for t, ref in (nodo.get("credentials") or {}).items():
            i = (ref or {}).get("id")
            if not id_valido(i) or i == "PENDIENTE-DEL-TIMBRE":
                errores.append("%s: credencial sin id válido" % nodo.get("name"))
            elif vivas is not None and (i, ref.get("name"), t) not in vivas:
                errores.append("%s: la credencial «%s» no está en la lista viva de n8n" % (nodo.get("name"), ref.get("name")))
        if nodo.get("name") == "Timbre":
            if path and (nodo.get("parameters") or {}).get("path") != path:
                errores.append("el path del Timbre vivo no es el de la entrega")
            if nodo.get("webhookId") != webhook_id(alias):
                errores.append("el webhookId del Timbre no es el estable del alias")
    errores += revisar_roles(wf.get("nodes", []), alias)
    if activo_esperado in ("true", "false") and bool(wf.get("active")) != (activo_esperado == "true"):
        errores.append("el estado activo vivo no es el esperado (%s)" % activo_esperado)
    if activo_esperado == "true" and not publicada(wf):
        errores.append("la versión PUBLICADA no es la última guardada (versionId distinto de activeVersionId): corre la vieja")
    if errores:
        salir(4, "\n".join("    " + e for e in errores))
    print("coincide con lo esperado (%d nodos)" % len(wf.get("nodes", [])))


if __name__ == "__main__":
    globals()["cmd_" + sys.argv[1]](*sys.argv[2:])
PY
py() { python3 -I "$WORK/lib.py" "$@"; }

# --- n8n por la API: la clave va por stdin (-H @-), nunca por argumentos ---------------
CODIGO=000
api() { # <método> <ruta> [archivo-cuerpo]
  local m="$1" r="$2" b="${3:-}" cod
  if [[ "$m" != GET ]] && (( ! APLICAR )); then falla "BUG: escritura (${m}) sin --aplicar; se detiene"; exit 3; fi
  local args=(-sS --max-time 60 --proto '=https' -o "$WORK/rta.json" -w '%{http_code}' -X "$m" -H @-)
  [[ -z "$b" ]] || args+=(-H "Content-Type: application/json" --data-binary "@$b")
  cod="$(curl "${args[@]}" "${API}${r}" 2>"$ERR" <<<"X-N8N-API-KEY: ${N8N_API_KEY}")" || cod=000
  CODIGO="$cod"
}
exigir() { # <códigos aceptados separados por |> <qué se hacía>
  [[ "$CODIGO" =~ ^($1)$ ]] && return 0
  case "$CODIGO" in
    401) falla "$2: n8n respondió 401 (la clave de la API no sirve o caducó)" ;;
    000) falla "$2: sin respuesta de n8n (revise N8N_BASE_URL y la conectividad)" ;;
    *)   falla "$2: n8n respondió HTTP ${CODIGO}" ;;
  esac
  return 1
}
leer_estado() { # deja credenciales.json y flujos.json, enteros
  api GET "/credentials?limit=250"; exigir 200 "no pude leer las credenciales" || exit 3
  cp "$WORK/rta.json" "$WORK/credenciales.json"; py lista "$WORK/credenciales.json" || { falla "lista de credenciales incompleta"; exit 3; }
  api GET "/workflows?limit=250"; exigir 200 "no pude leer los flujos" || exit 3
  cp "$WORK/rta.json" "$WORK/flujos.json"; py lista "$WORK/flujos.json" || { falla "lista de flujos incompleta"; exit 3; }
}

if (( APLICAR )); then ESTADO="APLICANDO"; else ESTADO="seco (no escribe)"; fi
echo "n8n del alias ${ALIAS}  ·  modo ${MODO}  ·  ${ESTADO}"
(( ! APLICAR )) || nota "producción: solo con el «sí» de Andres y después del seco"
echo

leer_estado
echo "Estado vivo"
py buscar "$WORK/flujos.json" "$WORK/credenciales.json" "$ALIAS" "$WORK/plan.json" || { falla "n8n tiene un estado ambiguo para este alias"; exit 3; }
WF_ID="$(py campo "$WORK/plan.json" wfId)"; WF_ACTIVO="$(py campo "$WORK/plan.json" wfActivo)"; TIMBRE_ID="$(py campo "$WORK/plan.json" timbreId)"
if py respaldar "$WORK/flujos.json" "$WORK/credenciales.json" "$ALIAS" "$WORK/respaldo-vivo.json"; then :; else falla "no pude armar el respaldo"; exit 3; fi
(( ! APLICAR )) || CONSERVAR=1

# ======================================================================== ACTIVAR
if [[ "$MODO" == activar ]]; then
  [[ -n "$WF_ID" ]] || { falla "el flujo del alias no existe: cárguelo primero (sin --activar)"; exit 2; }
  [[ -n "$TIMBRE_ID" ]] || { falla "la credencial del timbre no existe: cargue primero"; exit 2; }
  api GET "/workflows/${WF_ID}"; exigir 200 "no pude leer el flujo" || exit 3
  cp "$WORK/rta.json" "$WORK/vivo.json"
  if ! SAL="$(py verificar "$WORK/vivo.json" - "$ALIAS" any "$WORK/credenciales.json")"; then falla "el flujo vivo no está completo; no se activa:"; echo "$SAL" >&2; exit 2; fi
  PUB="$(py publicada "$WORK/vivo.json")"
  if [[ "$WF_ACTIVO" == true && "$PUB" == si ]]; then ok "ya está activo y la versión publicada es la última guardada: nada que hacer"; exit 0; fi
  if [[ "$WF_ACTIVO" == true ]]; then nota "está activo pero corre una versión ANTERIOR (borrador sin publicar): hay que publicar la última"; fi
  hacer "activar/publicar el flujo (empieza el barrido de cada minuto y el timbre responde)"
  if (( ! APLICAR )); then echo; echo "Diagnóstico: 1 paso pendiente; no se escribió nada. Con --aplicar --confirmo produccion se hace lo marcado «(haría)»."; exit 1; fi
  api POST "/workflows/${WF_ID}/activate"; exigir '200|201' "no pude activar" || exit 3
  api GET "/workflows/${WF_ID}"; exigir 200 "no pude releer" || exit 3
  cp "$WORK/rta.json" "$WORK/vivo.json"
  py verificar "$WORK/vivo.json" - "$ALIAS" true "$WORK/credenciales.json" >/dev/null || { falla "al releer, el flujo NO quedó activo con su última versión publicada"; exit 3; }
  ok "activo y publicado (versionId = activeVersionId), comprobado por relectura"
  nota "respaldo previo (sin la ruta ni la clave del timbre; modo 600): ${WORK}/respaldo-vivo.json"
  exit 0
fi

# ======================================================================== QUITAR
if [[ "$MODO" == quitar ]]; then
  PEND=0
  if [[ -n "$WF_ID" ]]; then
    PEND=$((PEND + 1))
    [[ "$WF_ACTIVO" != true ]] || hacer "desactivar el flujo del alias"
    hacer "borrar el flujo del alias"
  else ok "el flujo del alias no existe"; fi
  if [[ -n "$TIMBRE_ID" ]]; then PEND=$((PEND + 1)); hacer "borrar la credencial «Salida de persona (timbre ${ALIAS})» (y solo esa)"
  else ok "la credencial del timbre no existe"; fi
  nota "la ruta y la clave siguen en SALIDA_PERSONA_RUTAS: se quitan con nube-salida-persona.sh --quitar-alias ${ALIAS}"
  if (( ! APLICAR )); then
    if (( PEND )); then echo; echo "Diagnóstico: ${PEND} paso(s) pendiente(s); no se escribió nada. Con --aplicar --confirmo produccion se hace lo marcado «(haría)»."; exit 1; fi
    echo; echo "Diagnóstico: no falta nada."; exit 0
  fi
  if [[ -n "$WF_ID" ]]; then
    if [[ "$WF_ACTIVO" == true ]]; then api POST "/workflows/${WF_ID}/deactivate"; exigir '200|201' "no pude desactivar el flujo" || exit 3; ok "flujo desactivado"; fi
    api DELETE "/workflows/${WF_ID}"; exigir '200|204' "no pude borrar el flujo" || exit 3; ok "flujo borrado"
  fi
  if [[ -n "$TIMBRE_ID" ]]; then
    api DELETE "/credentials/${TIMBRE_ID}"; exigir '200|204' "no pude borrar la credencial del timbre" || exit 3; ok "credencial del timbre borrada"
  fi
  leer_estado
  py buscar "$WORK/flujos.json" "$WORK/credenciales.json" "$ALIAS" "$WORK/plan2.json" >/dev/null || exit 3
  [[ -z "$(py campo "$WORK/plan2.json" wfId)" && -z "$(py campo "$WORK/plan2.json" timbreId)" ]] \
    || { falla "al releer, algo del alias SIGUE en n8n"; exit 3; }
  ok "relectura: no queda flujo ni credencial del timbre de ${ALIAS}"
  nota "respaldo previo (sin la ruta ni la clave del timbre; modo 600): ${WORK}/respaldo-vivo.json"
  exit 0
fi

# ======================================================================== CARGAR
echo "Entrega y tabla"
DESTINO=""
DIR="${XDG_RUNTIME_DIR:-}"
if [[ -z "$DIR" || ! -d "$DIR" || ! -O "$DIR" || "$(stat -c '%a' "$DIR" 2>/dev/null)" != "700" ]]; then
  falla "no hay un \$XDG_RUNTIME_DIR válido (del usuario y de modo 700) donde estaría la entrega"; exit 2
fi
DESTINO="$DIR/novuchat-salida-persona-${ALIAS}.json"
if ! SAL="$(py entrega "$DESTINO" "$ALIAS" "$N8N_BASE_URL" "$WORK/cuerpo-cred.json" "$WORK/path")"; then
  falla "${SAL:-entrega inválida}"; nota "la entrega la deja nube-salida-persona.sh --agregar-alias ${ALIAS} --aplicar"; exit 2
fi
ok "entrega válida (archivo propio de modo 600, alias y ruta coinciden; no se imprime nada)"
LOCAL="${CONFIG_LOCAL_MD:-CONFIGURACION.local.md}"
if ! SAL="$(py tabla "$LOCAL" "$ALIAS" "$SINSUFIJO" "$WORK/tabla.json")"; then falla "${SAL}"; exit 2; fi
ok "tabla: phoneNumberId y URL interna del relé presentes y con forma válida (no se imprimen)"
echo "Plan"
if ! SAL="$(py plan "$FLUJO" "$WORK/flujos.json" "$WORK/credenciales.json" "$WORK/tabla.json" "$WORK/path" "$ALIAS" "$TIMBRE_ID" "$WORK/cuerpo-flujo.json" "$WORK/plan.json")"; then
  falla "el plan se aborta (no se escribió nada):"; echo "$SAL" >&2; exit 2
fi
echo "$SAL"
if [[ -n "$WF_ID" && "$WF_ACTIVO" == true ]]; then nota "el flujo ya está ACTIVO: se actualiza y conserva ese estado (n8n lo vuelve a registrar)"; fi
if (( ! APLICAR )); then
  hacer "crear o actualizar la credencial del timbre y el flujo del alias (inactivo si es nuevo)"
  hacer "borrar la entrega al terminar bien"
  echo; echo "Diagnóstico: 2 paso(s) pendiente(s); no se escribió nada. Con --aplicar --confirmo produccion se hace lo marcado «(haría)»."
  exit 1
fi

FALLO_ENTREGA="la entrega se CONSERVÓ en ${DESTINO}: corrija la causa y vuelva a correr (es idempotente), o deshaga con --quitar --alias ${ALIAS}"
fallar() { falla "$1"; nota "$FALLO_ENTREGA"; nota "respaldo previo (sin la ruta ni la clave del timbre; modo 600): ${WORK}/respaldo-vivo.json"; exit 3; }

echo "Escritura"
if [[ -n "$TIMBRE_ID" ]]; then
  api PATCH "/credentials/${TIMBRE_ID}" "$WORK/cuerpo-cred.json"; exigir '200|201' "no pude actualizar la credencial del timbre" || fallar "falló la credencial"
  ok "credencial del timbre actualizada"
else
  api POST "/credentials" "$WORK/cuerpo-cred.json"; exigir '200|201' "no pude crear la credencial del timbre" || fallar "falló la credencial"
  py id "$WORK/rta.json" >/dev/null || fallar "n8n creó la credencial pero no devolvió su id"
  ok "credencial del timbre creada"
fi
leer_estado
if ! SAL="$(py buscar "$WORK/flujos.json" "$WORK/credenciales.json" "$ALIAS" "$WORK/plan.json")"; then fallar "estado ambiguo tras escribir la credencial"; fi
TIMBRE_ID="$(py campo "$WORK/plan.json" timbreId)"; WF_ID="$(py campo "$WORK/plan.json" wfId)"
[[ -n "$TIMBRE_ID" ]] || fallar "la credencial del timbre no aparece al releer"
if ! SAL="$(py plan "$FLUJO" "$WORK/flujos.json" "$WORK/credenciales.json" "$WORK/tabla.json" "$WORK/path" "$ALIAS" "$TIMBRE_ID" "$WORK/cuerpo-flujo.json" "$WORK/plan.json")"; then fallar "el plan final se aborta: ${SAL}"; fi
if [[ -n "$WF_ID" ]]; then
  api PUT "/workflows/${WF_ID}" "$WORK/cuerpo-flujo.json"; exigir '200|201' "no pude actualizar el flujo" || fallar "falló el flujo"
  ok "flujo actualizado"
else
  api POST "/workflows" "$WORK/cuerpo-flujo.json"; exigir '200|201' "no pude crear el flujo" || fallar "falló el flujo"
  WF_ID="$(py id "$WORK/rta.json")" || fallar "n8n creó el flujo pero no devolvió su id"
  ok "flujo creado (inactivo)"
fi
echo "Comprobación (relectura)"
api GET "/workflows/${WF_ID}"; exigir 200 "no pude releer el flujo" || fallar "falló la relectura"
cp "$WORK/rta.json" "$WORK/vivo.json"
ESPERADO="false"; [[ "$WF_ACTIVO" != true ]] || ESPERADO="true"
leer_estado
if [[ "$ESPERADO" == true && "$(py publicada "$WORK/vivo.json")" == no ]]; then
  # n8n 2.x separa borrador y publicada: el PUT de un flujo activo deja corriendo la versión vieja.
  nota "el PUT dejó la versión publicada atrás (versionId distinto de activeVersionId): se publica la última"
  api POST "/workflows/${WF_ID}/activate"; exigir '200|201' "no pude publicar la última versión" || fallar "falló la publicación"
  api GET "/workflows/${WF_ID}"; exigir 200 "no pude releer el flujo" || fallar "falló la relectura"
  cp "$WORK/rta.json" "$WORK/vivo.json"
fi
if ! SAL="$(py verificar "$WORK/vivo.json" "$WORK/path" "$ALIAS" "$ESPERADO" "$WORK/credenciales.json")"; then fallar "la relectura NO coincide:
${SAL}"; fi
ok "$SAL"
py buscar "$WORK/flujos.json" "$WORK/credenciales.json" "$ALIAS" "$WORK/plan3.json" >/dev/null || fallar "estado ambiguo al releer"
[[ -n "$(py campo "$WORK/plan3.json" timbreId)" ]] || fallar "la credencial del timbre no aparece al releer"
ok "la credencial del timbre existe (su valor no se puede leer por la API: se prueba en el ensayo)"

# Todo salió bien: la entrega ya cumplió su función. Se destruye.
if command -v shred >/dev/null 2>&1; then shred -u "$DESTINO" 2>/dev/null || rm -f "$DESTINO"; else rm -f "$DESTINO"; fi
if [[ -e "$DESTINO" ]]; then falla "no pude borrar la entrega: bórrela a mano (rm) antes de seguir"; exit 3; fi
ok "archivo de entrega destruido"
nota "el flujo queda como se describe arriba; activarlo es un paso aparte: --alias ${ALIAS} --activar --aplicar --confirmo produccion"
nota "respaldo previo (sin la ruta ni la clave del timbre; modo 600): ${WORK}/respaldo-vivo.json (bórrelo cuando el ensayo termine)"
exit 0
