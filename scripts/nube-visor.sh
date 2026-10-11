#!/usr/bin/env bash
# El invocador público de la callable `verComprobante` (el visor de comprobantes
# del módulo Cobros), EN SECO por omisión.
#
# POR QUÉ EXISTE. Una Function HTTP o callable nueva no nace invocable si su
# creación no salió limpia: sin `roles/run.invoker` para `allUsers`, Google
# responde un 403 con HTML ANTES de ejecutar una línea del código, y la consola
# no puede abrir ningún comprobante (memoria «una Function HTTP nueva no nace
# invocable»; el mismo paso que `nube-catalogo.sh` para el catálogo).
#
# POR QUÉ `allUsers` ES CORRECTO ACÁ, y no un agujero: es lo normal en una
# callable. `allUsers` solo deja que la petición LLEGUE; la barrera es el token,
# DENTRO del código (admin/functions/src/modulos/cobros/verComprobante.ts):
# App Check en producción, sesión de Firebase Auth, rol en ESE comercio con la
# cuenta releída, módulo Cobros, tope por usuario y auditoría fail-closed. Sin
# sesión, la respuesta es un `unauthenticated` en JSON de Firebase.
#
#   ./scripts/nube-visor.sh --entorno <staging|produccion>
#       SECO: lee la política IAM del servicio y dice qué haría. No escribe.
#   ./scripts/nube-visor.sh --entorno <e> --aplicar --confirmo <e>
#       Concede roles/run.invoker a allUsers SOLO sobre el servicio
#       `vercomprobante` (idempotente), relee la política y prueba el endpoint
#       sin sesión: tiene que contestar nuestro código, no el 403 de Google.
#   ./scripts/nube-visor.sh --entorno <e> --revertir [--aplicar --confirmo <e>]
#       La vuelta atrás: quita ESE binding, con las mismas protecciones.
#
# El proyecto sale de GCP_PROJECT_ID_STAGING / GCP_PROJECT_ID_PROD (entorno, o
# `gh variable get` si no están); el de producción, si falta, del
# quota_project_id de la configuración aislada de gcloud (la fuente de
# nube-catalogo.sh), y si están los dos tienen que coincidir. El id NUNCA se
# imprime: se dice «staging» o «produccion». La región sale de
# admin/functions/src/core/region.ts. Credenciales: la sesión de gcloud de
# CLOUDSDK_CONFIG (por omisión ~/.config/gcloud-novuchat-prod); no lee secretos.
#
# Salida: 0 nada que hacer, o escrito y comprobado · 1 el seco encontró algo
# pendiente · 2 uso o salvaguarda (nada escrito) · 3 error de ejecución, o el
# servicio no existe (despliega primero).
#
# Contra producción: con el «sí» de Andres, en la ventana 23:30–01:30, seco
# primero (.github/DESPLIEGUE-FIREBASE.md). Andres autoriza; Claude opera.
set -euo pipefail
ESTE="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$ESTE")/.." || exit 1

ayuda() { sed -n '2,40p' "$ESTE" | sed 's/^# \{0,1\}//'; }

# La Function y su servicio de Cloud Run (2.ª generación: el nombre en
# minúsculas). Fijos a propósito: este script no sirve para otro servicio.
readonly FUNCION="verComprobante"
readonly SERVICIO="vercomprobante"
readonly ROL="roles/run.invoker"
readonly MIEMBRO="allUsers"

ENTORNO=""; APLICAR=0; REVERTIR=0; CONFIRMO=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --entorno)    ENTORNO="${2:-}"; [[ $# -ge 2 ]] || { echo "✗ --entorno necesita staging o produccion" >&2; exit 2; }; shift 2 ;;
    --entorno=*)  ENTORNO="${1#*=}"; shift ;;
    --confirmo)   CONFIRMO="${2:-}"; [[ $# -ge 2 ]] || { echo "✗ --confirmo necesita el entorno" >&2; exit 2; }; shift 2 ;;
    --confirmo=*) CONFIRMO="${1#*=}"; shift ;;
    --aplicar)    APLICAR=1; shift ;;
    --revertir)   REVERTIR=1; shift ;;
    -h|--help)    ayuda; exit 0 ;;
    *) echo "✗ Opción desconocida (ver --help)" >&2; exit 2 ;;
  esac
done

case "$ENTORNO" in
  staging|produccion) ;;
  "") echo "✗ Falta --entorno staging|produccion (no hay entorno por omisión)" >&2; exit 2 ;;
  *)  echo "✗ --entorno tiene que ser staging o produccion" >&2; exit 2 ;;
esac
if (( APLICAR )) && [[ "$CONFIRMO" != "$ENTORNO" ]]; then
  echo "✗ --aplicar exige --confirmo ${ENTORNO} (el mismo entorno, escrito a mano). No se escribió nada." >&2
  exit 2
fi

# --- La región: la de TODAS las Functions -------------------------------------
REGION="$(sed -nE "s/^export const REGION = '([a-z0-9-]+)';$/\1/p" admin/functions/src/core/region.ts 2>/dev/null | head -n 1)"
[[ "$REGION" =~ ^[a-z]+-[a-z]+[0-9]$ ]] \
  || { echo "✗ No pude leer la región de admin/functions/src/core/region.ts" >&2; exit 2; }

# --- El proyecto, sin imprimirlo ----------------------------------------------
export CLOUDSDK_CONFIG="${CLOUDSDK_CONFIG:-$HOME/.config/gcloud-novuchat-prod}"
unset CLOUDSDK_ACTIVE_CONFIG_NAME CLOUDSDK_CORE_PROJECT

leer_variable() { # variable del repositorio con gh, solo lectura; vacío si no se puede
  command -v gh >/dev/null 2>&1 || return 0
  gh variable get "$1" 2>/dev/null || true
}
FORMA_PROYECTO='^[a-z][a-z0-9-]{4,28}[a-z0-9]$'
STAGING="${GCP_PROJECT_ID_STAGING:-}"
[[ -n "$STAGING" ]] || STAGING="$(leer_variable GCP_PROJECT_ID_STAGING)"
PROD="${GCP_PROJECT_ID_PROD:-}"
[[ -n "$PROD" ]] || PROD="$(leer_variable GCP_PROJECT_ID_PROD)"
CUOTA=""
ADC="$CLOUDSDK_CONFIG/application_default_credentials.json"
if [[ -r "$ADC" ]]; then
  CUOTA="$(grep -o '"quota_project_id": *"[^"]*"' "$ADC" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/' | head -n 1 || true)"
fi
[[ -n "$PROD" ]] || PROD="$CUOTA"

if [[ "$ENTORNO" == "produccion" ]]; then P="$PROD"; OTRO="$STAGING"; else P="$STAGING"; OTRO="$PROD"; fi
[[ -n "$P" ]] || { echo "✗ No encuentro el proyecto de ${ENTORNO} (GCP_PROJECT_ID_$([[ $ENTORNO == produccion ]] && echo PROD || echo STAGING))" >&2; exit 2; }
[[ "$P" =~ $FORMA_PROYECTO ]] || { echo "✗ El proyecto de ${ENTORNO} no tiene la forma de un id de Google Cloud" >&2; exit 2; }
if [[ -n "$OTRO" && "$OTRO" == "$P" ]]; then
  echo "✗ GCP_PROJECT_ID_STAGING y GCP_PROJECT_ID_PROD son iguales: no se sabe cuál es cuál" >&2; exit 2
fi
if [[ "$ENTORNO" == "produccion" && -n "$CUOTA" && "$CUOTA" != "$P" ]]; then
  echo "✗ GCP_PROJECT_ID_PROD no coincide con el proyecto de las credenciales de gcloud: no se sigue" >&2; exit 2
fi

# --- Salida -------------------------------------------------------------------
V=$'\e[32m'; A=$'\e[33m'; R=$'\e[31m'; F=$'\e[0m'
ok()    { echo "  ${V}✓${F} $*"; }
nota()  { echo "  ${A}·${F} $*"; }
falla() { echo "  ${R}✗${F} $*" >&2; }

ERR="$(mktemp)"; CUERPO="$(mktemp)"
trap 'rm -f "$ERR" "$CUERPO"' EXIT

# Lo que gcloud dice al fallar puede traer el id o el número del proyecto, o la
# cuenta: se tapan antes de mostrarlo.
sanear() {
  local t; t="$(head -c 2000 "$ERR")"
  t="${t//"$P"/<proyecto>}"
  [[ -n "$OTRO" ]] && t="${t//"$OTRO"/<proyecto>}"
  printf '%s\n' "$t" | sed -E 's/[0-9]{6,}/<número>/g; s/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/<cuenta>/g' | head -n 4 | sed 's/^/      /' >&2
}

# gcloud siempre con el proyecto y la región fijos, sin preguntas.
gc() { gcloud --project "$P" --quiet "$@"; }

# ¿La política (JSON por stdin) tiene allUsers en roles/run.invoker, sin condición?
tiene_publico() {
  python3 -c '
import json, sys
p = json.load(sys.stdin)
sys.exit(0 if any(
    b.get("role") == "roles/run.invoker" and "allUsers" in b.get("members", []) and not b.get("condition")
    for b in p.get("bindings", [])) else 1)
'
}

# Resumen de la política sin identidades: rol, si está allUsers, y cuántos más.
resumir() {
  python3 -c '
import json, sys
p = json.load(sys.stdin)
bs = p.get("bindings", [])
if not bs:
    print("    (sin ningún binding)")
for b in bs:
    m = b.get("members", [])
    pub = "allUsers" in m
    resto = len(m) - (1 if pub else 0)
    partes = (["allUsers"] if pub else []) + ([f"{resto} miembro(s) más, no se imprimen"] if resto else [])
    cond = " (con condición)" if b.get("condition") else ""
    rol = str(b.get("role", "?"))
    print("    " + rol + cond + ": " + " + ".join(partes))
'
}

leer_politica() {
  gc run services get-iam-policy "$SERVICIO" --region "$REGION" --format=json 2>"$ERR"
}

# --- 1. El servicio existe (si no: despliega primero) -------------------------
if (( REVERTIR )); then ACCION="quitar"; else ACCION="conceder"; fi
if (( APLICAR )); then MODO="APLICANDO"; else MODO="seco (no escribe)"; fi
echo "Entorno: ${ENTORNO}  ·  región ${REGION}  ·  servicio ${SERVICIO} (${FUNCION})  ·  ${ACCION} ${ROL} a ${MIEMBRO}  ·  ${MODO}"
if [[ "$ENTORNO" == "produccion" ]] && (( APLICAR )); then
  nota "producción: solo con el «sí» de Andres, en la ventana 23:30–01:30 y después del seco"
fi
echo

if ! descripcion="$(gc run services describe "$SERVICIO" --region "$REGION" --format=json 2>"$ERR")"; then
  if grep -qiE 'NOT_FOUND|could not be found|does not exist|cannot find' "$ERR"; then
    falla "${FUNCION} no está desplegada en ${ENTORNO} (no existe el servicio ${SERVICIO}): despliega primero."
  else
    falla "no pude leer el servicio ${SERVICIO} en ${ENTORNO}:"; sanear
  fi
  exit 3
fi
URL="$(printf '%s' "$descripcion" | python3 -c 'import json,sys; print((json.load(sys.stdin).get("status") or {}).get("url") or "")')"
GESTOR="$(printf '%s' "$descripcion" | python3 -c 'import json,sys; print(((json.load(sys.stdin).get("metadata") or {}).get("labels") or {}).get("goog-managed-by") or "")')"
ok "el servicio ${SERVICIO} existe en ${ENTORNO}"
[[ "$GESTOR" == "cloudfunctions" ]] \
  || nota "el servicio no lleva la etiqueta goog-managed-by=cloudfunctions: confirmar que es el de la Function ${FUNCION}"

# --- 2. La política de hoy -----------------------------------------------------
if ! politica="$(leer_politica)"; then
  falla "no pude leer la política IAM de ${SERVICIO}:"; sanear; exit 3
fi
echo "  Política IAM de ${SERVICIO} hoy:"
printf '%s' "$politica" | resumir
PUBLICO=0
if printf '%s' "$politica" | tiene_publico; then PUBLICO=1; fi

# --- 3. La comprobación sin sesión ---------------------------------------------
# Una sola petición POST sin credenciales al propio servicio. Nuestro código (o
# Firebase por él: App Check, sesión) contesta JSON `unauthenticated` o
# `failed-precondition`; sin invocador, Google contesta 403 con HTML.
INTENTOS="${NUBE_VISOR_INTENTOS:-9}"; ESPERA="${NUBE_VISOR_ESPERA:-10}"
[[ "$INTENTOS" =~ ^[1-9][0-9]?$ && "$ESPERA" =~ ^[0-9]{1,2}$ ]] \
  || { echo "✗ NUBE_VISOR_INTENTOS (1-99) o NUBE_VISOR_ESPERA (0-99 s) inválidos" >&2; exit 2; }
URL_VALIDA="^https://${SERVICIO}-[a-z0-9-]+(\.[a-z0-9-]+)*\.run\.app/?$"

sondear() { # imprime «propio», «google403» u «otro:<código>»
  local linea codigo
  : >"$CUERPO"
  linea="$(curl -q -sS --proto '=https' --max-redirs 0 --max-time 20 -o "$CUERPO" -w '%{http_code}' \
    -X POST -H 'Content-Type: application/json' --data '{"data":{}}' "$URL" 2>/dev/null || true)"
  codigo="${linea:0:3}"
  [[ "$codigo" =~ ^[0-9]{3}$ ]] || codigo=000
  if [[ "$codigo" == 401 || "$codigo" == 400 ]] && python3 -c '
import json, sys
try:
    d = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    sys.exit(1)
e = d.get("error") if isinstance(d, dict) else None
sys.exit(0 if isinstance(e, dict) and e.get("status") in ("UNAUTHENTICATED", "FAILED_PRECONDITION") else 1)
' "$CUERPO"; then
    echo propio
  elif [[ "$codigo" == 403 ]]; then
    echo google403
  else
    echo "otro:${codigo}"
  fi
}

comprobar_respuesta() { # $1: propio | google403 — lo esperado
  local esperado="$1" r="" i
  if [[ ! "$URL" =~ $URL_VALIDA ]]; then
    falla "la dirección del servicio no tiene la forma esperada (*.run.app de ${SERVICIO}): no se prueba"; return 1
  fi
  for (( i = 1; i <= INTENTOS; i++ )); do
    r="$(sondear)"
    [[ "$r" == "$esperado" ]] && break
    (( i < INTENTOS )) && sleep "$ESPERA"
  done
  case "$r" in
    propio)    [[ "$esperado" == propio ]] && ok "sin sesión contesta NUESTRO código (JSON unauthenticated de Firebase), no el 403 de Google" ;;
    google403) [[ "$esperado" == google403 ]] && ok "sin invocador: Google contesta 403 antes del código, como se esperaba" ;;
  esac
  if [[ "$r" != "$esperado" ]]; then
    case "$r" in
      propio)    falla "contesta nuestro código: el binding sigue surtiendo efecto" ;;
      google403) falla "contesta el 403 de Google: el invocador no surte efecto (¿propagación de IAM? reintentar el seco en unos minutos)" ;;
      *)         falla "respuesta inesperada (${r#otro:}): ni nuestro JSON ni el 403 de Google" ;;
    esac
    return 1
  fi
}

# --- 4. Decidir y, con --aplicar, escribir -------------------------------------
echo
if (( REVERTIR )); then
  if (( ! PUBLICO )); then
    ok "${MIEMBRO} no tiene ${ROL} en ${SERVICIO}: nada que quitar"
    exit 0
  fi
  if (( ! APLICAR )); then
    nota "(haría) gcloud run services remove-iam-policy-binding ${SERVICIO} --region ${REGION} --member=${MIEMBRO} --role=${ROL}"
    nota "1 pendiente. Para hacerlo: --revertir --aplicar --confirmo ${ENTORNO}"
    exit 1
  fi
  echo "  → quitando ${ROL} de ${MIEMBRO} en ${SERVICIO}"
  if ! gc run services remove-iam-policy-binding "$SERVICIO" --region "$REGION" \
      --member="$MIEMBRO" --role="$ROL" >/dev/null 2>"$ERR"; then
    falla "gcloud no pudo quitar el binding:"; sanear; exit 3
  fi
  politica="$(leer_politica)" || { falla "no pude releer la política:"; sanear; exit 3; }
  if printf '%s' "$politica" | tiene_publico; then falla "al releer, ${MIEMBRO} SIGUE con ${ROL}"; exit 3; fi
  ok "relectura: ${MIEMBRO} ya no tiene ${ROL} en ${SERVICIO}"
  comprobar_respuesta google403 || exit 3
  echo; echo "${V}Vuelta atrás hecha.${F} La consola ya no puede abrir comprobantes en ${ENTORNO}."
  exit 0
fi

if (( PUBLICO )); then
  ok "ya concedido: ${MIEMBRO} tiene ${ROL} en ${SERVICIO}. No se escribe nada."
  if (( APLICAR )); then comprobar_respuesta propio || exit 3; fi
  exit 0
fi
if (( ! APLICAR )); then
  nota "${SERVICIO} SIN invocador: responde 403 de Google antes de correr el código"
  nota "(haría) gcloud run services add-iam-policy-binding ${SERVICIO} --region ${REGION} --member=${MIEMBRO} --role=${ROL}"
  nota "1 pendiente. Para hacerlo: --aplicar --confirmo ${ENTORNO}"
  exit 1
fi
echo "  → concediendo ${ROL} a ${MIEMBRO} SOLO en ${SERVICIO}"
if ! gc run services add-iam-policy-binding "$SERVICIO" --region "$REGION" \
    --member="$MIEMBRO" --role="$ROL" >/dev/null 2>"$ERR"; then
  falla "gcloud no pudo conceder el binding:"; sanear; exit 3
fi
politica="$(leer_politica)" || { falla "no pude releer la política:"; sanear; exit 3; }
printf '%s' "$politica" | tiene_publico || { falla "al releer, ${MIEMBRO} NO tiene ${ROL}"; exit 3; }
ok "relectura: ${MIEMBRO} tiene ${ROL} en ${SERVICIO}"
comprobar_respuesta propio || exit 3
echo; echo "${V}Listo.${F} ${FUNCION} es invocable en ${ENTORNO}; la barrera sigue siendo el token, dentro del código."
