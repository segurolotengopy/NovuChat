#!/usr/bin/env bash
# Los pasos de NUBE de PRODUCCIÓN que necesita la alerta operativa «envío incierto» (Function `alertaOperativa`
# y su resumen diario), EN SECO por omisión, sin que el valor de ningún secreto pase por la pantalla, el
# historial, un archivo del repositorio ni el modelo. Calcado de `nube-salida-persona.sh`.
#
# POR QUÉ EXISTE. `alertaOperativa.ts` declara `defineSecret('ALERTAS_HMAC')` y
# `defineSecret('ALERTAS_RESEND_API_KEY')`. `firebase deploy` lee los metadatos de cada secreto que una Function
# declara; sin estos pasos el despliegue de la etiqueta falla con «403 secretmanager.secrets.get denied (or it
# may not exist)»: la condición del rol `desplegadorSecretos` de la cuenta de despliegue es por PREFIJO
# (INGESTA_, GEMINI_API_KEY, COBRADOR_, SALIDA_PERSONA_) y los dos secretos no caían en ninguno. Por eso los dos
# llevan un prefijo COMÚN y EXACTO, `ALERTAS_` (`admin/pruebas/plataforma/secretos-iam-prefijos.test.ts` lo
# exige para todo `defineSecret`). El mismo arreglo para staging: `preparar-staging.sh alertas`.
# Andres autoriza; Claude opera.
#
#   ./scripts/nube-alertas.sh
#       SECO: diagnóstico de los pasos 1 a 3; no escribe.
#   ./scripts/nube-alertas.sh --aplicar --confirmo produccion
#       1. amplía en su lugar la condición «secretos-de-las-functions» de la cuenta de despliegue con el prefijo
#          EXACTO ALERTAS_ (una cláusula `startsWith`, sin comodines; la cuenta sigue sin poder leer valores),
#          con set-iam-policy y el etag leído (si alguien cambió la política entretanto, falla en vez de pisarla);
#       2. crea ALERTAS_HMAC con un valor aleatorio (python `secrets`, por una tubería: no se imprime) y
#          ALERTAS_RESEND_API_KEY con el marcador «PENDIENTE-DE-CARGAR» (no es una credencial: Resend lo rechaza
#          hasta el paso de carga; la clave real nunca pasa por aquí);
#       3. da roles/secretmanager.secretAccessor sobre cada uno a sa-functions, secreto por secreto.
#   ./scripts/nube-alertas.sh --cargar-resend <archivo> [--aplicar --confirmo produccion]
#       Carga la clave de Resend (la que Andres crea en el panel, solo envío, limitada al dominio de avisos) como
#       versión nueva de ALERTAS_RESEND_API_KEY SIN mostrarla. El archivo tiene que estar dentro de
#       $XDG_RUNTIME_DIR (tmpfs del usuario, modo 700), ser un archivo regular del usuario de modo 600 y traer
#       una sola línea con la forma `re_…`. El script no imprime su contenido y, con éxito, lo BORRA.
#   LA CLAVE ALERTAS_HMAC NO SE ENTREGA A NINGÚN ARCHIVO. La credencial «NovuChat alertas (HMAC)» de n8n la carga
#   `scripts/cargar-alerta-n8n.sh --credencial`, que lleva el valor de Secret Manager por TUBERÍA directo al cuerpo de
#   la llamada a la API de n8n (sin variable, argumento, archivo ni pantalla). Por eso este script ya no tiene modo de entrega.
#   ./scripts/nube-alertas.sh --invocador [--aplicar --confirmo produccion]
#       PASO APARTE, DESPUÉS DEL DESPLIEGUE (una Function HTTP nueva no nace invocable): delega en
#       `nube-visor.sh --servicio alertaoperativa --entorno produccion`, que concede roles/run.invoker a allUsers
#       SOLO sobre ese servicio y prueba sin firma que contesta nuestro código (401 «no autorizado»), no el 403 de
#       Google; si contesta «abierto», lo revierte. `allUsers` solo deja que la petición LLEGUE: la barrera es la
#       firma HMAC propia, dentro del código.
#   ./scripts/nube-alertas.sh --revertir-iam [--aplicar --confirmo produccion]
#       La vuelta atrás del paso 1: quita la cláusula ALERTAS_ de la condición.
#       OJO: sin ella, el despliegue de las Functions que declaran los secretos vuelve a fallar.
#
# UN DETALLE QUE IMPORTA. firebase-tools FIJA el número de versión de cada secreto al desplegar: una versión agregada
# después (la clave de Resend cargada con --cargar-resend) NO la ven las instancias hasta el próximo despliegue.
# Orden: pasos 1 a 3 -> --cargar-resend -> desplegar la etiqueta -> --invocador. La credencial de n8n va aparte, con
# `scripts/cargar-alerta-n8n.sh` (--credencial y luego --flujo, este último con la Function ya desplegada).
#
# El proyecto: el quota_project_id de las credenciales de gcloud (CLOUDSDK_CONFIG, por omisión
# ~/.config/gcloud-novuchat-prod; cualquier otra CLOUDSDK_* se descarta), que es el de producción. Con --aplicar
# GCP_PROJECT_ID_PROD tiene que estar SIEMPRE y ser igual. El id NUNCA se imprime.
#
# RESPALDO Y TEMPORALES. Todo temporal vive en un directorio de modo 700 que se borra al salir; con --aplicar y un
# cambio de IAM queda el respaldo de la política anterior (se imprime la ruta).
#
# Salida: 0 nada que hacer, o escrito y comprobado · 1 el seco encontró algo pendiente · 2 uso o salvaguarda
# (nada escrito) · 3 error de ejecución.
#
# Contra producción: con el «sí» de Andres, seco primero (.github/DESPLIEGUE-FIREBASE.md).
set -euo pipefail
# NUNCA con xtrace: `bash -x` (o SHELLOPTS=xtrace) imprimiría cada comando ya expandido, y con él el valor de la clave de
# Resend o del HMAC. Se rechaza antes de tocar nada y, por si acaso, se apaga.
case "$-" in *x*) echo "✗ xtrace activo (bash -x o SHELLOPTS=xtrace): imprimiría el valor de los secretos. No se escribió nada." >&2; exit 2 ;; esac
[[ "${SHELLOPTS:-}" != *xtrace* ]] || { echo "✗ SHELLOPTS=xtrace en el entorno: imprimiría el valor de los secretos. No se escribió nada." >&2; exit 2; }
set +x
ESTE="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$ESTE")/.." || exit 1

ayuda() { awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$ESTE"; }

readonly PREFIJO="ALERTAS_"
readonly SECRETO_HMAC="ALERTAS_HMAC"
readonly SECRETO_RESEND="ALERTAS_RESEND_API_KEY"
readonly SECRETOS=("$SECRETO_HMAC" "$SECRETO_RESEND")
readonly SERVICIO_ALERTAS="alertaoperativa"

APLICAR=0; CONFIRMO=""; MODO="preparar"; ARCHIVO=""
fijar_modo() { [[ "$MODO" == preparar ]] || { echo "✗ Un solo modo a la vez (--cargar-resend, --invocador o --revertir-iam)" >&2; exit 2; }; MODO="$1"; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --aplicar)        APLICAR=1; shift ;;
    --confirmo)       [[ $# -ge 2 ]] || { echo "✗ --confirmo necesita produccion" >&2; exit 2; }; CONFIRMO="$2"; shift 2 ;;
    --confirmo=*)     CONFIRMO="${1#*=}"; shift ;;
    --cargar-resend)  fijar_modo cargar; [[ $# -ge 2 ]] || { echo "✗ --cargar-resend necesita la ruta del archivo" >&2; exit 2; }; ARCHIVO="$2"; shift 2 ;;
    --invocador)      fijar_modo invocador; shift ;;
    --revertir-iam)   fijar_modo revertir; shift ;;
    -h|--help)        ayuda; exit 0 ;;
    *) echo "✗ Opción desconocida (ver --help)" >&2; exit 2 ;;
  esac
done
if (( APLICAR )) && [[ "$CONFIRMO" != "produccion" ]]; then
  echo "✗ --aplicar exige --confirmo produccion (escrito a mano). No se escribió nada." >&2; exit 2
fi

# --- El invocador: delega en nube-visor.sh (la lista cerrada que ya sabe hacerlo y probarlo) ----------------------
if [[ "$MODO" == invocador ]]; then
  args=(--servicio "$SERVICIO_ALERTAS" --entorno produccion)
  (( ! APLICAR )) || args+=(--aplicar --confirmo produccion)
  exec bash "$(dirname "$ESTE")/nube-visor.sh" "${args[@]}"
fi

# Un directorio de ejecución válido (del usuario, modo 700) para la carga: se pide antes de tocar gcloud.
dir_ejecucion_valido() {
  local d="${XDG_RUNTIME_DIR:-}"
  [[ -n "$d" && -d "$d" && -O "$d" && "$(stat -c '%a' "$d" 2>/dev/null)" == "700" ]]
}
if [[ "$MODO" == cargar ]]; then
  dir_ejecucion_valido || { echo "✗ no hay un \$XDG_RUNTIME_DIR válido (del usuario y de modo 700): no hay dónde pasar un secreto sin la pantalla. No se escribió nada." >&2; exit 2; }
fi
if [[ "$MODO" == cargar ]]; then
  # La ruta tiene que ser absoluta, estar DENTRO del directorio de ejecución y ser un archivo regular del usuario, de modo 600.
  [[ "$ARCHIVO" == "${XDG_RUNTIME_DIR}"/* && "$ARCHIVO" != *..* ]] || { echo "✗ el archivo tiene que estar dentro de \$XDG_RUNTIME_DIR (sin ..)" >&2; exit 2; }
  [[ -f "$ARCHIVO" && ! -L "$ARCHIVO" && -O "$ARCHIVO" && "$(stat -c '%a' "$ARCHIVO" 2>/dev/null)" == "600" ]] \
    || { echo "✗ el archivo tiene que ser regular (no un enlace), del usuario y de modo 600" >&2; exit 2; }
  [[ "$(stat -c '%s' "$ARCHIVO")" -le 512 ]] || { echo "✗ el archivo es demasiado grande para ser una clave" >&2; exit 2; }
  # La forma, SIN llevar el valor a una variable ni a una expansión (grep sobre el archivo): una sola línea `re_…`.
  grep -Eqx 're_[A-Za-z0-9_]{10,200}' "$ARCHIVO" && [[ "$(grep -c '' "$ARCHIVO")" == 1 ]] \
    || { echo "✗ el contenido del archivo no tiene la forma de una clave de Resend (una línea re_…); no se muestra" >&2; exit 2; }
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

# Directorio de trabajo de modo 700 (mktemp -d lo crea así): ahí van la política leída,
# los errores de gcloud y el respaldo. Se borra al salir; solo con --aplicar y un
# cambio de IAM se conserva el respaldo (CONSERVAR=1).
BASE_TMP="${TMPDIR:-/tmp}"
if [[ -n "${XDG_RUNTIME_DIR:-}" && -d "$XDG_RUNTIME_DIR" && -O "$XDG_RUNTIME_DIR" && "$(stat -c '%a' "$XDG_RUNTIME_DIR" 2>/dev/null)" == "700" ]]; then
  BASE_TMP="$XDG_RUNTIME_DIR"
fi
WORK="$(mktemp -d "$BASE_TMP/nube-alertas.XXXXXX")"
chmod 700 "$WORK"
ERR="$WORK/err"; TMP="$WORK/politica.json"; RESPALDO="$WORK/respaldo-politica.json"
: >"$ERR"; ENTREGA_TMP=""; CONSERVAR=0
limpiar() {
  [[ -z "$ENTREGA_TMP" ]] || rm -f "$ENTREGA_TMP"
  if (( CONSERVAR )); then find "$WORK" -mindepth 1 ! -name 'respaldo-politica.json' -delete 2>/dev/null || true
  else rm -rf "$WORK"; fi
}
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
echo "Entorno: produccion  ·  secretos ${SECRETOS[*]}  ·  modo ${MODO}  ·  ${ESTADO}"
(( ! APLICAR )) || nota "producción: solo con el «sí» de Andres, a cualquier hora, y después del seco"
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
  local modo="$1" rc
  if ! gc projects get-iam-policy "$P" --format=json >"$TMP" 2>"$ERR"; then falla "no pude leer la política del proyecto:"; sanear; exit 3; fi
  if python3 -I -c "$PY_IAM" "$modo" "$TMP" "$N" "$SA_DEP" "$PREFIJO" >"$WORK/py" 2>&1; then rc=0; else rc=$?; fi
  if [[ -s "$WORK/py" ]]; then falla "$(cat "$WORK/py")"; fi
  case "$rc" in
    0) if [[ "$modo" == ampliar ]]; then ok "la condición de la cuenta de despliegue ya cubre ${PREFIJO}"
       else ok "la condición no tiene la cláusula ${PREFIJO}: nada que quitar"; fi ;;
    10) PENDIENTES=$((PENDIENTES + 1))
        if [[ "$modo" == ampliar ]]; then nota "la condición no cubre ${PREFIJO}"; hacer "agregar a la condición: || startsWith(\"projects/<número>/secrets/${PREFIJO}\")"
        else nota "la condición cubre ${PREFIJO}"; hacer "quitar de la condición la cláusula de ${PREFIJO}"; fi
        if (( APLICAR )); then
          # El respaldo es la política LEÍDA (TMP ya trae la edición): se vuelve a leer sin tocar.
          gc projects get-iam-policy "$P" --format=json >"$RESPALDO" 2>"$ERR" || { falla "no pude guardar el respaldo:"; sanear; exit 3; }
          chmod 600 "$RESPALDO"
          gc projects set-iam-policy "$P" "$TMP" >/dev/null 2>"$ERR" || { falla "set-iam-policy falló (¿cambió la política entretanto? el etag lo impide):"; sanear; exit 3; }
          CONSERVAR=1   # solo tras el éxito: si set-iam-policy falla, nada cambió y no se deja respaldo
          ok "política del proyecto actualizada"
          nota "respaldo de la política anterior (identidades y roles, sin secretos; modo 600): ${RESPALDO}"
          nota "bórrelo (rm -rf del directorio que lo contiene) cuando la comprobación final salga en ✓"
        fi ;;
    *) exit 3 ;;
  esac
}

# Relee y confirma lo escrito. <ampliar|quitar>: el estado final que debe tener la condición.
comprobar_iam() {
  local modo="$1" rc
  gc projects get-iam-policy "$P" --format=json >"$WORK/relectura.json" 2>"$ERR" || { falla "no pude releer la política:"; sanear; exit 3; }
  if python3 -I -c "$PY_IAM" "$modo" "$WORK/relectura.json" "$N" "$SA_DEP" "$PREFIJO" >/dev/null 2>&1; then rc=0; else rc=$?; fi
  (( rc == 0 )) || { falla "al releer, la condición NO quedó como se pidió"; exit 3; }
  ok "relectura: la condición quedó como se pidió"
}


secreto_existe() { gc secrets describe "$1" >/dev/null 2>"$ERR"; }
versiones_habilitadas() { gc secrets versions list "$1" --filter='state=ENABLED' --format='value(name)' 2>/dev/null | wc -l; }

tiene_accessor() { # <secreto>
  gc secrets get-iam-policy "$1" --format=json 2>/dev/null | python3 -I -c '
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if any(b["role"] == "roles/secretmanager.secretAccessor" and "serviceAccount:" + sys.argv[1] in b["members"] for b in d.get("bindings", [])) else 1)' "$SA_FN"
}

mensaje_final() {
  if (( APLICAR )); then echo; echo "Hecho y comprobado por relectura. Si quiere, corra el diagnóstico de nuevo (sin --aplicar): todo tiene que salir en ✓."
  elif (( PENDIENTES )); then echo; echo "Diagnóstico: ${PENDIENTES} paso(s) pendiente(s); no se escribió nada. Con --aplicar --confirmo produccion se hace lo marcado «(haría)»."; exit 1
  else echo; echo "Diagnóstico: no falta nada."; fi
}

# El valor inicial va por una TUBERÍA hacia gcloud: nunca a la pantalla. El de la clave de Resend es un marcador.
valor_inicial() {
  if [[ "$1" == "$SECRETO_HMAC" ]]; then python3 -I -c 'import secrets, sys; sys.stdout.write(secrets.token_urlsafe(48))'
  else printf 'PENDIENTE-DE-CARGAR'; fi
}

# --- Modo preparar: pasos 1 a 3 -------------------------------------------------
if [[ "$MODO" == preparar ]]; then
  echo "1. Condición de IAM de la cuenta de despliegue"
  paso_iam ampliar
  echo "2. Los secretos"
  for s in "${SECRETOS[@]}"; do
    if secreto_existe "$s"; then
      ok "${s} existe ($(versiones_habilitadas "$s") versión habilitada)"
    else
      nota "${s} no existe"; PENDIENTES=$((PENDIENTES + 1))
      if [[ "$s" == "$SECRETO_HMAC" ]]; then hacer "crear ${s} con un valor aleatorio (no se imprime)"
      else hacer "crear ${s} con el marcador PENDIENTE-DE-CARGAR (la clave real se carga con --cargar-resend)"; fi
      if (( APLICAR )); then
        valor_inicial "$s" | gc secrets create "$s" --replication-policy=automatic --data-file=- >/dev/null 2>"$ERR" \
          || { falla "no pude crear ${s}:"; sanear; exit 3; }
        ok "${s} creado"
      fi
    fi
  done
  echo "3. Acceso de sa-functions"
  for s in "${SECRETOS[@]}"; do
    if { (( APLICAR )) || secreto_existe "$s"; } && tiene_accessor "$s"; then
      ok "sa-functions puede leer ${s}"
    else
      nota "sa-functions no puede leer ${s}"; hacer "dar secretAccessor sobre ${s} a sa-functions"; PENDIENTES=$((PENDIENTES + 1))
      if (( APLICAR )); then
        gc secrets add-iam-policy-binding "$s" --member="serviceAccount:$SA_FN" --role=roles/secretmanager.secretAccessor >/dev/null 2>"$ERR" \
          || { falla "no pude dar el acceso a ${s}:"; sanear; exit 3; }
        ok "acceso a ${s} concedido"
      fi
    fi
  done
  if (( APLICAR )); then
    echo "Comprobación (relectura)"
    comprobar_iam ampliar
    for s in "${SECRETOS[@]}"; do
      secreto_existe "$s" || { falla "al releer, ${s} no existe"; exit 3; }
      tiene_accessor "$s" || { falla "al releer, sa-functions NO puede leer ${s}"; exit 3; }
    done
    ok "los dos secretos existen y sa-functions puede leerlos: escrito y comprobado"
  fi
  mensaje_final
  exit 0
fi

if [[ "$MODO" == revertir ]]; then
  echo "Vuelta atrás del paso 1"
  paso_iam quitar
  if (( APLICAR )); then comprobar_iam quitar; fi
  mensaje_final
  exit 0
fi

secreto_existe "$SECRETO_RESEND" && secreto_existe "$SECRETO_HMAC" || { falla "los secretos no existen: corra primero los pasos 1 a 3 (sin opciones)"; exit 3; }

if [[ "$MODO" == cargar ]]; then
  echo "Carga de la clave de Resend en ${SECRETO_RESEND} (el valor no se imprime)"
  hacer "agregar una versión nueva de ${SECRETO_RESEND} con el contenido del archivo y borrar el archivo"
  PENDIENTES=$((PENDIENTES + 1))
  if (( APLICAR )); then
    tr -d '\n' <"$ARCHIVO" | gc secrets versions add "$SECRETO_RESEND" --data-file=- >/dev/null 2>"$ERR" \
      || { falla "gcloud no pudo agregar la versión (el archivo se conserva):"; sanear; exit 3; }
    rm -f "$ARCHIVO"
    ok "versión nueva de ${SECRETO_RESEND} ($(versiones_habilitadas "$SECRETO_RESEND") habilitada(s)); archivo borrado"
    nota "hay que REDESPLEGAR las Functions que declaran el secreto: las instancias siguen con la versión anterior hasta entonces"
    exit 0
  fi
  mensaje_final
  exit 0
fi
