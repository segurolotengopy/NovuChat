#!/usr/bin/env bash
# Los pasos de NUBE de PRODUCCIÓN que necesita el timbre de la salida de persona
# (H2-3), EN SECO por omisión, sin que el valor del secreto pase por la pantalla,
# el historial, un archivo del repositorio ni el modelo.
#
# POR QUÉ EXISTE. `salidaPersona.ts` declara `defineSecret('SALIDA_PERSONA_RUTAS')`.
# `firebase deploy` lee los metadatos de cada secreto que una Function declara; sin
# estos pasos el despliegue de la etiqueta a producción falla con
# «403 secretmanager.secrets.get denied (or it may not exist)», por DOS causas
# independientes: el secreto no existe, y aunque existiera la cuenta de despliegue
# no podría leerlo (su rol `desplegadorSecretos` lleva una condición por prefijo que
# solo cubría INGESTA_, GEMINI_API_KEY y COBRADOR_). El mismo arreglo para staging
# vive en `preparar-staging.sh salida-persona`. Andres autoriza; Claude opera.
#
#   ./scripts/nube-salida-persona.sh
#       SECO: diagnóstico de los pasos 1 a 3; no escribe.
#   ./scripts/nube-salida-persona.sh --aplicar --confirmo produccion
#       1. amplía en su lugar la condición «secretos-de-las-functions» de la cuenta
#          de despliegue con el prefijo EXACTO SALIDA_PERSONA_ (sin comodines: una
#          cláusula `startsWith`; la cuenta sigue sin poder leer valores);
#       2. crea SALIDA_PERSONA_RUTAS con el valor `{}` si no existe (JSON válido,
#          ningún alias = ningún timbre: el código no toca nada);
#       3. da roles/secretmanager.secretAccessor sobre él a sa-functions.
#   ./scripts/nube-salida-persona.sh --agregar-alias <alias> [--aplicar --confirmo produccion]
#       SOLO para el ensayo, después de los pasos 1 a 3. Exige N8N_BASE_URL (https,
#       sin ruta: la dirección de n8n). Genera una ruta de webhook y una clave con
#       `secrets` de python, las FUSIONA con el mapa vigente en una versión nueva
#       del secreto y NO las imprime. Entrega ruta y clave en un archivo de modo 600
#       dentro de $XDG_RUNTIME_DIR (ver ENTREGA). Si el alias ya existe, se niega.
#   ./scripts/nube-salida-persona.sh --quitar-alias <alias> [--aplicar --confirmo produccion]
#       La restauración: nueva versión sin ese alias (si no está, no escribe).
#   ./scripts/nube-salida-persona.sh --revertir-iam [--aplicar --confirmo produccion]
#       La vuelta atrás del paso 1: quita la cláusula SALIDA_PERSONA_ de la condición.
#       OJO: sin ella, el despliegue de Functions que declaran el secreto vuelve a fallar.
#
# ENTREGA. La ruta (y la clave del Header Auth del webhook de n8n) tienen que llegar
# a n8n, y no pueden ir por la pantalla, el historial ni un chat. Canal elegido: un
# archivo en $XDG_RUNTIME_DIR, que es memoria (tmpfs) por usuario, de modo 0700, que
# no sobrevive a un reinicio, no se respalda y no es del repositorio. El script
# exige que el directorio sea del usuario, de modo 0700, y crea el archivo con 0600
# y O_EXCL. Quien lo consuma (el que cargue la credencial y el `path` del webhook en
# n8n) lo lee y lo BORRA; este script solo imprime la ruta del archivo, no su
# contenido. Sin $XDG_RUNTIME_DIR válido, --agregar-alias se niega: no hay plan B por
# pantalla ni por disco persistente.
#
# UN DETALLE QUE IMPORTA. firebase-tools FIJA el número de versión de cada secreto al
# desplegar: una versión agregada después NO la ven las instancias hasta el próximo
# despliegue de las Functions que lo declaran (docs/produccion/rotar-secreto-ingesta.md
# §1.1). Tras --agregar-alias o --quitar-alias hay que redesplegar la etiqueta.
#
# El proyecto: el quota_project_id de las credenciales de gcloud (CLOUDSDK_CONFIG, por
# omisión ~/.config/gcloud-novuchat-prod; cualquier otra CLOUDSDK_* se descarta), que es
# el de producción. Si GCP_PROJECT_ID_PROD está en el entorno, tiene que coincidir; si
# GCP_PROJECT_ID_STAGING está, tiene que ser distinto. El id NUNCA se imprime.
#
# Salida: 0 nada que hacer, o escrito y comprobado · 1 el seco encontró algo pendiente
# · 2 uso o salvaguarda (nada escrito) · 3 error de ejecución.
#
# Contra producción: con el «sí» de Andres, en la ventana 23:30–01:30, seco primero
# (.github/DESPLIEGUE-FIREBASE.md).
set -euo pipefail
ESTE="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$ESTE")/.." || exit 1

ayuda() { awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$ESTE"; }

readonly SECRETO="SALIDA_PERSONA_RUTAS"
readonly PREFIJO="SALIDA_PERSONA_"

APLICAR=0; CONFIRMO=""; MODO="preparar"; ALIAS=""
fijar_modo() { [[ "$MODO" == preparar ]] || { echo "✗ Un solo modo a la vez (--agregar-alias, --quitar-alias o --revertir-iam)" >&2; exit 2; }; MODO="$1"; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --aplicar)       APLICAR=1; shift ;;
    --confirmo)      [[ $# -ge 2 ]] || { echo "✗ --confirmo necesita produccion" >&2; exit 2; }; CONFIRMO="$2"; shift 2 ;;
    --confirmo=*)    CONFIRMO="${1#*=}"; shift ;;
    --agregar-alias) fijar_modo agregar; [[ $# -ge 2 ]] || { echo "✗ --agregar-alias necesita el alias" >&2; exit 2; }; ALIAS="$2"; shift 2 ;;
    --quitar-alias)  fijar_modo quitar;  [[ $# -ge 2 ]] || { echo "✗ --quitar-alias necesita el alias" >&2; exit 2; }; ALIAS="$2"; shift 2 ;;
    --revertir-iam)  fijar_modo revertir; shift ;;
    -h|--help)       ayuda; exit 0 ;;
    *) echo "✗ Opción desconocida (ver --help)" >&2; exit 2 ;;
  esac
done
if (( APLICAR )) && [[ "$CONFIRMO" != "produccion" ]]; then
  echo "✗ --aplicar exige --confirmo produccion (escrito a mano). No se escribió nada." >&2; exit 2
fi
if [[ "$MODO" == agregar || "$MODO" == quitar ]]; then
  [[ "$ALIAS" =~ ^[A-Za-z][A-Za-z0-9]{1,29}$ ]] || { echo "✗ alias inválido (letras y dígitos, de 2 a 30, empieza con letra)" >&2; exit 2; }
fi
if [[ "$MODO" == agregar ]]; then
  # La dirección de n8n: https, un host, puerto opcional, sin ruta, sin usuario.
  [[ "${N8N_BASE_URL:-}" =~ ^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{2,5})?$ ]] \
    || { echo "✗ --agregar-alias exige N8N_BASE_URL en el entorno: https://<host> sin ruta ni usuario" >&2; exit 2; }
fi

# --- El proyecto, sin imprimirlo ----------------------------------------------
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

ERR="$(mktemp)"; TMP="$(mktemp)"; ENTREGA_TMP=""
chmod 600 "$ERR" "$TMP"
limpiar() { rm -f "$ERR" "$TMP"; [[ -z "$ENTREGA_TMP" ]] || rm -f "$ENTREGA_TMP"; }
trap limpiar EXIT

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
(( ! APLICAR )) || nota "producción: solo con el «sí» de Andres, en la ventana 23:30–01:30 y después del seco"
echo

PENDIENTES=0

# --- La condición del rol desplegadorSecretos ----------------------------------
# <ampliar|quitar>: edita EN SU LUGAR la expresión del binding y la escribe con
# set-iam-policy con el etag leído (si alguien cambió la política entretanto, falla
# en vez de pisarla). El binding no se quita ni se vuelve a poner: no hay un instante
# sin permiso. Respaldo de la política anterior en un archivo de modo 600.
PY_IAM='
import json, sys
modo, ruta, n, sa, prefijo = sys.argv[1:6]
d = json.load(open(ruta)); miembro = "serviceAccount:" + sa
clausula = "resource.name.startsWith(\"projects/%s/secrets/%s\")" % (n, prefijo)
marca = "secrets/%s\"" % prefijo
for b in d.get("bindings", []):
    c = b.get("condition") or {}
    if b.get("role", "").endswith("/desplegadorSecretos") and miembro in b.get("members", []) and c.get("title") == "secretos-de-las-functions":
        if len(b["members"]) != 1:
            print("el binding con condición tiene más de un miembro"); sys.exit(3)
        e = c["expression"]
        if modo == "ampliar":
            if marca in e: sys.exit(0)
            c["expression"] = e + " || " + clausula
        else:
            if marca not in e: sys.exit(0)
            c["expression"] = e.replace(" || " + clausula, "")
            if marca in c["expression"]:
                print("la cláusula no tiene la forma esperada: no toco nada"); sys.exit(3)
        d["version"] = 3
        json.dump(d, open(ruta, "w"))
        sys.exit(10)
print("no encuentro el binding con condición de la cuenta de despliegue"); sys.exit(3)
'
paso_iam() { # <ampliar|quitar>
  local modo="$1" rc respaldo
  if ! gc projects get-iam-policy "$P" --format=json >"$TMP" 2>"$ERR"; then falla "no pude leer la política del proyecto:"; sanear; exit 3; fi
  respaldo="$(mktemp)"; chmod 600 "$respaldo"; cp "$TMP" "$respaldo"
  if python3 -I -c "$PY_IAM" "$modo" "$TMP" "$N" "$SA_DEP" "$PREFIJO" >"$ERR.py" 2>&1; then rc=0; else rc=$?; fi
  if [[ -s "$ERR.py" ]]; then falla "$(cat "$ERR.py")"; fi
  rm -f "$ERR.py"
  case "$rc" in
    0) rm -f "$respaldo"
       if [[ "$modo" == ampliar ]]; then ok "la condición de la cuenta de despliegue ya cubre ${PREFIJO}"
       else ok "la condición no tiene la cláusula ${PREFIJO}: nada que quitar"; fi ;;
    10) PENDIENTES=$((PENDIENTES + 1))
        if [[ "$modo" == ampliar ]]; then nota "la condición no cubre ${PREFIJO}"; hacer "agregar a la condición: || startsWith(\"projects/<número>/secrets/${PREFIJO}\")"
        else nota "la condición cubre ${PREFIJO}"; hacer "quitar de la condición la cláusula de ${PREFIJO}"; fi
        if (( APLICAR )); then
          nota "respaldo de la política ANTES del cambio (identidades y roles, sin secretos), modo 600: $respaldo"
          gc projects set-iam-policy "$P" "$TMP" >/dev/null 2>"$ERR" || { falla "set-iam-policy falló (¿cambió la política entretanto? el etag lo impide):"; sanear; exit 3; }
          ok "política del proyecto actualizada"
        else rm -f "$respaldo"; fi ;;
    *) rm -f "$respaldo"; exit 3 ;;
  esac
}

secreto_existe() { gc secrets describe "$SECRETO" >/dev/null 2>"$ERR"; }
versiones_habilitadas() { gc secrets versions list "$SECRETO" --filter='state=ENABLED' --format='value(name)' 2>/dev/null | wc -l; }

tiene_accessor() {
  gc secrets get-iam-policy "$SECRETO" --format=json 2>/dev/null | python3 -I -c '
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if any(b["role"] == "roles/secretmanager.secretAccessor" and "serviceAccount:" + sys.argv[1] in b["members"] for b in d.get("bindings", [])) else 1)' "$SA_FN"
}

mensaje_final() {
  if (( APLICAR )); then echo; echo "Hecho. Corra el diagnóstico de nuevo (sin --aplicar): todo tiene que salir en ✓."
  elif (( PENDIENTES )); then echo; echo "Diagnóstico: ${PENDIENTES} paso(s) pendiente(s); no se escribió nada. Con --aplicar --confirmo produccion se hace lo marcado «(haría)»."; exit 1
  else echo; echo "Diagnóstico: no falta nada."; fi
}

# --- Modo preparar: pasos 1 a 3 -------------------------------------------------
if [[ "$MODO" == preparar ]]; then
  echo "1. Condición de IAM de la cuenta de despliegue"
  paso_iam ampliar
  echo "2. El secreto ${SECRETO}"
  if secreto_existe; then
    ok "existe (${SECRETO}: $(versiones_habilitadas) versión habilitada)"
  else
    nota "no existe"; hacer "crear ${SECRETO} con el valor {} (ningún alias = ningún timbre)"; PENDIENTES=$((PENDIENTES + 1))
    if (( APLICAR )); then
      printf '{}' | gc secrets create "$SECRETO" --replication-policy=automatic --data-file=- >/dev/null 2>"$ERR" \
        || { falla "no pude crear el secreto:"; sanear; exit 3; }
      ok "creado"
    fi
  fi
  echo "3. Acceso de sa-functions"
  if { (( APLICAR )) || secreto_existe; } && tiene_accessor; then
    ok "sa-functions puede leer ${SECRETO}"
  else
    nota "sa-functions no puede leer ${SECRETO}"; hacer "dar secretAccessor sobre ${SECRETO} a sa-functions"; PENDIENTES=$((PENDIENTES + 1))
    if (( APLICAR )); then
      gc secrets add-iam-policy-binding "$SECRETO" --member="serviceAccount:$SA_FN" --role=roles/secretmanager.secretAccessor >/dev/null 2>"$ERR" \
        || { falla "no pude dar el acceso:"; sanear; exit 3; }
      ok "acceso concedido"
    fi
  fi
  mensaje_final
  exit 0
fi

if [[ "$MODO" == revertir ]]; then
  echo "Vuelta atrás del paso 1"
  paso_iam quitar
  mensaje_final
  exit 0
fi

# --- Modos agregar / quitar: el mapa de timbres ----------------------------------
secreto_existe || { falla "${SECRETO} no existe: corra primero los pasos 1 a 3 (sin opciones)"; exit 3; }

leer_mapa() { gc secrets versions access latest --secret "$SECRETO" 2>"$ERR"; }

# Lee el mapa por stdin. En seco solo dice si el alias está («presente»/«ausente») y
# cuántos hay; con "agregar" imprime el mapa nuevo (la ÚNICA salida con valores, que
# va a una variable y de ahí a gcloud) y escribe la entrega en el archivo dado;
# con "quitar" imprime el mapa sin el alias.
PY_MAPA='
import json, os, secrets, sys
modo, alias, base, entrega = sys.argv[1:5]
crudo = sys.stdin.read()
try:
    mapa = json.loads(crudo)
except Exception:
    sys.exit(5)
if not isinstance(mapa, dict):
    sys.exit(5)
esta = alias in mapa
if modo == "ver":
    print(("presente" if esta else "ausente") + " " + str(len(mapa))); sys.exit(0)
if modo == "agregar":
    if esta:
        sys.exit(4)
    seg = secrets.token_urlsafe(32); clave = secrets.token_urlsafe(32)
    ruta = base + "/webhook/" + seg
    mapa[alias] = {"ruta": ruta, "clave": clave}
    fd = os.open(entrega, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump({"alias": alias, "ruta": ruta, "path": seg, "clave": clave}, f)
    sys.stdout.write(json.dumps(mapa, separators=(",", ":")))
else:
    if not esta:
        sys.exit(6)
    del mapa[alias]
    sys.stdout.write(json.dumps(mapa, separators=(",", ":")))
'

# ¿ya está? (solo lectura; no imprime valores)
if ! VISTO="$(leer_mapa | python3 -I -c "$PY_MAPA" ver "$ALIAS" "" "")"; then
  falla "no pude leer o entender la versión vigente de ${SECRETO} (tiene que ser un objeto JSON)"; sanear; exit 3
fi
ESTA="${VISTO%% *}"; CUANTOS="${VISTO##* }"
echo "El mapa vigente tiene ${CUANTOS} alias; el alias pedido está ${ESTA}."

if [[ "$MODO" == agregar ]]; then
  if [[ "$ESTA" == presente ]]; then
    falla "el alias ya existe: no se rota en silencio. Quítelo primero con --quitar-alias si es lo que quiere."; exit 3
  fi
  DIR="${XDG_RUNTIME_DIR:-}"
  if [[ -z "$DIR" || ! -d "$DIR" || ! -O "$DIR" || "$(stat -c '%a' "$DIR" 2>/dev/null)" != "700" ]]; then
    falla "no hay un \$XDG_RUNTIME_DIR válido (del usuario y de modo 700) donde entregar la ruta sin pasar por la pantalla: --agregar-alias se niega"; exit 2
  fi
  DESTINO="$DIR/novuchat-salida-persona-${ALIAS}.json"
  if [[ -e "$DESTINO" ]]; then falla "ya hay un archivo de entrega pendiente para ese alias: bórrelo o consúmalo antes"; exit 2; fi
  hacer "generar ruta y clave al azar, fusionarlas en una versión nueva de ${SECRETO} y entregarlas en un archivo de modo 600 (no se imprimen)"
  PENDIENTES=$((PENDIENTES + 1))
  if (( APLICAR )); then
    ENTREGA_TMP="$DIR/.novuchat-salida-persona-${ALIAS}.tmp"
    rm -f "$ENTREGA_TMP"
    NUEVO="$(leer_mapa | python3 -I -c "$PY_MAPA" agregar "$ALIAS" "$N8N_BASE_URL" "$ENTREGA_TMP")" \
      || { rm -f "$ENTREGA_TMP"; falla "no se pudo preparar el mapa nuevo: no se escribió nada"; sanear; exit 3; }
    if ! printf '%s' "$NUEVO" | gc secrets versions add "$SECRETO" --data-file=- >/dev/null 2>"$ERR"; then
      NUEVO=""; falla "gcloud no pudo agregar la versión (se descarta lo generado):"; sanear; exit 3
    fi
    NUEVO=""
    if ! leer_mapa | python3 -I -c "$PY_MAPA" ver "$ALIAS" "" "" | grep -q '^presente '; then
      falla "al releer, el alias NO está en la versión vigente"; exit 3
    fi
    mv "$ENTREGA_TMP" "$DESTINO"; ENTREGA_TMP=""
    ok "versión nueva de ${SECRETO} con el alias; relectura confirmada"
    ok "entrega (modo 600, memoria): ${DESTINO}"
    nota "quien la consuma carga el path y la clave en n8n y BORRA el archivo"
    nota "hay que REDESPLEGAR las Functions que declaran el secreto: las instancias siguen con la versión anterior hasta entonces"
    exit 0
  fi
  mensaje_final
  exit 0
fi

# quitar
if [[ "$ESTA" == ausente ]]; then ok "el alias no está en el mapa: nada que quitar"; exit 0; fi
hacer "escribir una versión nueva de ${SECRETO} sin ese alias"
PENDIENTES=$((PENDIENTES + 1))
if (( APLICAR )); then
  NUEVO="$(leer_mapa | python3 -I -c "$PY_MAPA" quitar "$ALIAS" "" "")" || { falla "no se pudo preparar el mapa: no se escribió nada"; sanear; exit 3; }
  if ! printf '%s' "$NUEVO" | gc secrets versions add "$SECRETO" --data-file=- >/dev/null 2>"$ERR"; then
    NUEVO=""; falla "gcloud no pudo agregar la versión:"; sanear; exit 3
  fi
  NUEVO=""
  leer_mapa | python3 -I -c "$PY_MAPA" ver "$ALIAS" "" "" | grep -q '^ausente ' || { falla "al releer, el alias SIGUE en la versión vigente"; exit 3; }
  ok "versión nueva sin el alias; relectura confirmada"
  nota "hay que REDESPLEGAR las Functions que declaran el secreto para que dejen de ver el alias"
  exit 0
fi
mensaje_final
