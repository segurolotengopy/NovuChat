#!/usr/bin/env bash
# Actualiza EN SU LUGAR el flujo ya publicado en n8n, usando la API publica.
# Evita el ciclo de importar: no hay que reconectar credenciales, ni reponer
# `Trigger On`, ni arriesgar que cambie la ruta del webhook.
#
# Como funciona:
#   1. lee el flujo vivo por la API (trae los bloques `credentials` y el
#      `webhookId` reales de la instancia);
#   2. los injerta sobre el JSON versionado, emparejando por NOMBRE de nodo;
#   3. escribe el resultado de vuelta en el mismo flujo.
#
# Por defecto SOLO LEE E INFORMA. Escribe unicamente con --aplicar, y antes
# guarda un respaldo del flujo vivo en Flujos/respaldo-<id>-<fecha>.local.json
#
#   ./scripts/publicar-flujo.sh              # diagnostico, no toca nada
#   ./scripts/publicar-flujo.sh --aplicar    # actualiza el flujo
#   ./scripts/publicar-flujo.sh --flujo Flujos/demo-b-venta-cobro.json --aplicar
#
# N8N_API_KEY es una credencial de ADMINISTRACION de toda la instancia: quien
# la tenga puede leer y modificar cualquier flujo, incluidos los ajenos. Vive
# solo en .env (ignorado, chmod 600) y en el gestor de contrasenas.
set -euo pipefail

cd "$(dirname "$0")/.." || exit 1

FLUJO="Flujos/demo-a-agendamiento.json"
APLICAR=0
ENV_FILE=".env"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --flujo)   FLUJO="${2:?--flujo necesita un archivo}"; shift 2 ;;
    --flujo=*) FLUJO="${1#*=}"; shift ;;
    --aplicar) APLICAR=1; shift ;;
    --env)     ENV_FILE="${2:?--env necesita un archivo}"; shift 2 ;;
    --env=*)   ENV_FILE="${1#*=}"; shift ;;
    -h|--help) sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Opcion desconocida: $1" >&2; exit 2 ;;
  esac
done

# Si existe el archivo preparado (con los valores reales ya puestos por
# preparar-import.sh), se usa ESE y no el versionado. Empujar el versionado
# escribiria los marcadores REEMPLAZAR_* encima de la configuracion real.
PREPARADO="${FLUJO%.json}.local.json"
if [[ "$FLUJO" != *.local.json && -f "$PREPARADO" ]]; then
  echo "Usando el archivo preparado en lugar del versionado:"
  echo "  $PREPARADO"
  echo
  FLUJO="$PREPARADO"
fi

[[ -f "$ENV_FILE" ]] || { echo "✗ Falta $ENV_FILE"; exit 1; }
set -a
# shellcheck disable=SC1090  # ruta variable: la elige --env
. "./$ENV_FILE"
set +a
: "${N8N_API_KEY:?Falta N8N_API_KEY en .env (n8n: Settings -> n8n API)}"
: "${N8N_WORKFLOW_ID:?Falta N8N_WORKFLOW_ID en .env (esta en la URL del editor)}"
: "${N8N_BASE_URL:?Falta N8N_BASE_URL en .env}"
[[ -f "$FLUJO" ]] || { echo "✗ No existe $FLUJO"; exit 1; }

API="${N8N_BASE_URL%/}/api/v1"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# --- 1. leer el flujo vivo ----------------------------------------------------
COD=$(curl -s --max-time 30 -o "$TMP/vivo.json" -w '%{http_code}' \
      -H "X-N8N-API-KEY: ${N8N_API_KEY}" "${API}/workflows/${N8N_WORKFLOW_ID}" || echo 000)

if [[ "$COD" != "200" ]]; then
  printf '\033[1;31m✗ No se pudo leer el flujo: HTTP %s\033[0m\n' "$COD"
  case "$COD" in
    401) echo "   La clave de API no es valida o caduco." ;;
    404) echo "   Ese N8N_WORKFLOW_ID no existe. Reviselo en la URL del editor." ;;
    000) echo "   No hubo respuesta: revise N8N_BASE_URL y la conectividad." ;;
  esac
  head -c 300 "$TMP/vivo.json" 2>/dev/null || true
  exit 1
fi

APLICAR="$APLICAR" FLUJO="$FLUJO" TMP="$TMP" python3 - <<'PY'
import json, os, datetime

aplicar = os.environ["APLICAR"] == "1"
tmp     = os.environ["TMP"]
flujo   = os.environ["FLUJO"]
V, R, G, A, FIN = "\033[1;32m", "\033[1;31m", "\033[0;90m", "\033[1;33m", "\033[0m"

vivo  = json.load(open(f"{tmp}/vivo.json", encoding="utf-8"))
nuevo = json.load(open(flujo, encoding="utf-8"))

webhooks = [n.get("webhookId") for n in vivo.get("nodes", [])
            if n.get("webhookId") and "trigger" in n["type"].lower()]
print(f"Flujo vivo : {vivo.get('name')}")
if webhooks:
    print(f"  webhook  : /webhook/{webhooks[0]}/webhook")
print(f"  activo   : {vivo.get('active')}   nodos: {len(vivo.get('nodes', []))}")
print(f"Origen     : {flujo}   nodos: {len(nuevo['nodes'])}\n")

# --- respaldo del flujo vivo, solo cuando se va a escribir --------------------
# El diagnostico no deja archivos: si no toca nada, no ensucia nada.
if aplicar:
    sello = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    respaldo = f"Flujos/respaldo-{vivo.get('id','sinid')}-{sello}.local.json"
    json.dump(vivo, open(respaldo, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"  {G}respaldo del flujo vivo: {respaldo}{FIN}\n")

# --- injerto de credenciales y webhookId, por nombre de nodo -----------------
por_nombre = {n["name"]: n for n in vivo.get("nodes", [])}
con_cred, sin_par, nuevos = [], [], []

# Mapa tipo-de-credencial -> referencia, tomado del flujo vivo. Sirve para los
# nodos NUEVOS: n8n rechaza publicar un flujo con un nodo sin credencial, asi
# que un nodo nuevo nunca podria entrar. Declarando el tipo en el JSON con id
# vacio, aca se completa desde una credencial ya conectada del mismo tipo.
cred_por_tipo = {}
for v in vivo.get("nodes", []):
    for tipo, ref in (v.get("credentials") or {}).items():
        if ref.get("id"):
            cred_por_tipo.setdefault(tipo, ref)

heredadas_por_tipo = []
for n in nuevo["nodes"]:
    par = por_nombre.get(n["name"])
    if par is None:
        nuevos.append(n["name"])
        continue
    if par.get("credentials"):
        n["credentials"] = par["credentials"]
        con_cred.append(n["name"])
    if par.get("webhookId"):
        n["webhookId"] = par["webhookId"]

# Relleno de credenciales por TIPO. Va DESPUES del injerto por nombre y vale
# para cualquier nodo cuya referencia quedo con id vacio: uno nuevo, o uno que
# ya existe en la instancia pero sin credencial conectada -- que es el estado
# en que queda un nodo si un PUT anterior escribio los nodos y n8n rechazo
# publicar. Sin esto no hay forma de salir: n8n no publica un flujo con un
# nodo sin credencial, y el nodo no puede recibirla si nunca entra.
for n in nuevo["nodes"]:
    for tipo, ref in (n.get("credentials") or {}).items():
        if not (ref or {}).get("id") and tipo in cred_por_tipo:
            n["credentials"][tipo] = cred_por_tipo[tipo]
            heredadas_por_tipo.append((n["name"], tipo))

for nombre in por_nombre:
    if nombre not in {n["name"] for n in nuevo["nodes"]}:
        sin_par.append(nombre)

for c in con_cred: print(f"  {V}+{FIN} credenciales heredadas: {c}")
for c in nuevos:   print(f"  {A}!{FIN} nodo nuevo, sin par en el flujo vivo: {c}")
for nodo, tipo in heredadas_por_tipo:
    print(f"  {V}+{FIN} credencial heredada POR TIPO ({tipo}): {nodo}")
for c in sin_par:  print(f"  {A}!{FIN} nodo del flujo vivo que ya no existe: {c}")

if not con_cred:
    print(f"\n  {R}Ningun nodo heredo credenciales.{FIN} Revise que el ID sea el del")
    print(f"  {G}flujo que ya tiene las credenciales conectadas, no el recien importado.{FIN}")

# --- que se perdio por el camino ---------------------------------------------
# n8n descarta parametros en silencio al importar un JSON: la opcion queda
# fuera del flujo publicado y nadie se entera hasta que el comportamiento
# cambia. Este bloque compara el flujo vivo contra el origen y avisa.
NOTAS = {
    "options.singleEvents":
        "Sin esta opcion, Calendar devuelve los eventos repetitivos como serie\n"
        "      y no como instancias sueltas: el agente puede leer mal la\n"
        "      disponibilidad y ofrecer un horario ocupado.",
    "returnAll":
        "Si falta, n8n aplica el valor por defecto del nodo. Conviene tenerlo\n"
        "      explicito: con returnAll activo se trae la agenda entera, que fue\n"
        "      una de las causas de la latencia alta.",
    "options.maxIterations":
        "Acota cuantas veces el agente puede llamar a una herramienta. Sin\n"
        "      limite, un turno se dispara a decenas de segundos.",
    "updates":
        "Es el `Trigger On` del disparador. Si queda vacio, no entra ningun\n"
        "      mensaje y el sintoma es identico al de un webhook mal puesto.",
}

def aplanar(d, prefijo=""):
    plano = {}
    if isinstance(d, dict):
        for k, v in d.items():
            ruta = f"{prefijo}{k}"
            if isinstance(v, dict):
                plano.update(aplanar(v, ruta + "."))
            else:
                plano[ruta] = v
    return plano

perdidos, cambiados, config_dif = [], [], []
for n in nuevo["nodes"]:
    par = por_nombre.get(n["name"])
    if par is None:
        continue
    pv, pn = aplanar(par.get("parameters", {})), aplanar(n.get("parameters", {}))
    for clave, valor in pn.items():
        # Los campos de `Config del negocio` llevan valores reales, asi que se
        # comparan pero se informan por LONGITUD, nunca mostrando el valor. Sin
        # esto el detector era ciego al defecto mas caro que tuvimos: un ID de
        # calendario al que le faltaba un caracter, que hacia fallar la reserva
        # y, peor, hacia que el agente inventara la disponibilidad.
        if clave.startswith("assignments"):
            continue   # se comparan aparte, por campo, mas abajo
        if clave not in pv or pv[clave] is None:
            if valor not in (None, "", [], {}):
                perdidos.append((n["name"], clave, valor))
        elif pv[clave] != valor:
            cambiados.append((n["name"], clave, pv[clave], valor))
    # Los campos de un nodo Set viven en una LISTA, no en un diccionario, asi
    # que el aplanado no los alcanza: hay que emparejarlos por nombre. Se
    # informan por LONGITUD, nunca mostrando el valor, porque son datos reales
    # del negocio. Sin esto el detector era ciego al defecto mas caro que
    # tuvimos: un ID de calendario al que le faltaba un caracter, que rompia la
    # reserva y hacia que el agente inventara la disponibilidad.
    def campos(nodo):
        d = nodo.get("parameters", {}).get("assignments", {})
        return {c.get("name"): str(c.get("value", "")) for c in d.get("assignments", [])} \
               if isinstance(d, dict) else {}

    cv, cn = campos(par), campos(n)
    for campo in sorted(set(cv) | set(cn)):
        if cv.get(campo) != cn.get(campo):
            config_dif.append((n["name"], campo,
                               len(cv.get(campo, "")), len(cn.get(campo, ""))))

    for meta in ("onError", "maxTries", "waitBetweenTries"):
        if n.get(meta) is not None and par.get(meta) != n.get(meta):
            cambiados.append((n["name"], meta, par.get(meta), n.get(meta)))

if perdidos:
    print(f"\n  {A}El flujo vivo no tiene esto explicito, y el origen si:{FIN}")
    for nodo, clave, valor in perdidos:
        print(f"    {A}!{FIN} {nodo} · {clave} = {json.dumps(valor, ensure_ascii=False)}")
        nota = NOTAS.get(clave) or NOTAS.get(clave.split(".")[-1])
        if nota:
            print(f"      {G}{nota}{FIN}")
    print(f"  {G}Puede ser un valor por defecto que n8n no guarda, o un parametro que{FIN}")
    print(f"  {G}descarto al importar. Aplicar los deja explicitos en los dos casos.{FIN}")

if cambiados:
    print(f"\n  {A}Valores distintos entre el flujo vivo y el origen:{FIN}")
    for nodo, clave, va, vb in cambiados:
        corta = lambda x: (json.dumps(x, ensure_ascii=False)[:70] + "…") if len(json.dumps(x, ensure_ascii=False)) > 70 else json.dumps(x, ensure_ascii=False)
        print(f"    {A}~{FIN} {nodo} · {clave}: vivo {corta(va)} -> origen {corta(vb)}")

if config_dif:
    print(f"\n  {A}Campos de configuracion distintos (se informa longitud, no valor):{FIN}")
    for nodo, campo, la, lb in config_dif:
        aviso = f"  {R}<- longitud distinta{FIN}" if la != lb else ""
        print(f"    {A}~{FIN} {nodo} · {campo}: vivo {la} car. -> origen {lb} car.{aviso}")

if not perdidos and not cambiados and not config_dif:
    print(f"\n  {V}El flujo vivo coincide con el origen: no hay nada que reponer.{FIN}")

# --- cuerpo para el PUT: la API rechaza campos de solo lectura ---------------
cuerpo = {
    "name":        nuevo.get("name", vivo.get("name")),
    "nodes":       nuevo["nodes"],
    "connections": nuevo["connections"],
    "settings":    nuevo.get("settings", vivo.get("settings", {})),
}
serializado = json.dumps(cuerpo, ensure_ascii=False)

# Defensa dura: nunca escribir marcadores encima de la configuracion real de
# produccion. Un `Config del negocio` con REEMPLAZAR_* deja el flujo sin
# calendario ni telefonos, y el sintoma aparece recien con el primer cliente.
if "REEMPLAZAR_" in serializado:
    import re as _re
    marcas = sorted(set(_re.findall(r'REEMPLAZAR_[^"\\\s]*', serializado)))
    print(f"\n{R}✗ ABORTADO: el archivo todavia tiene marcadores sin reponer.{FIN}")
    for m in marcas:
        print(f"    {m}")
    print(f"{G}  Corra primero:  ./scripts/preparar-import.sh {flujo}{FIN}")
    raise SystemExit(2)

open(f"{tmp}/cuerpo.json", "w", encoding="utf-8").write(serializado)

print()
if not aplicar:
    print(f"{A}Diagnostico solamente. Nada se escribio.{FIN}")
    print(f"{G}Para aplicar:  ./scripts/publicar-flujo.sh --aplicar{FIN}")
PY

[[ $APLICAR -eq 1 ]] || exit 0

# --- 2. escribir de vuelta ----------------------------------------------------
COD=$(curl -s --max-time 60 -o "$TMP/rta.json" -w '%{http_code}' -X PUT \
      -H "X-N8N-API-KEY: ${N8N_API_KEY}" -H "Content-Type: application/json" \
      --data-binary @"$TMP/cuerpo.json" "${API}/workflows/${N8N_WORKFLOW_ID}" || echo 000)

if [[ "$COD" == "200" ]]; then
  printf '\033[1;32m✓ Flujo actualizado en su lugar (HTTP 200).\033[0m\n'
  python3 -c "
import json,sys
d=json.load(open('$TMP/rta.json'))
print('  nombre:',d.get('name'),'| activo:',d.get('active'),'| nodos:',len(d.get('nodes',[])))"
  echo "  Revise en n8n que siga publicado y mande un mensaje de prueba."
else
  printf '\033[1;31m✗ La actualizacion fallo: HTTP %s\033[0m\n' "$COD"
  head -c 500 "$TMP/rta.json" 2>/dev/null || true
  echo
  echo "  El flujo vivo NO se modifico, o quedo a medias: compare contra el respaldo."
  exit 1
fi
