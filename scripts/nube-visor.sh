#!/usr/bin/env bash
# El invocador público de UNA Function de una LISTA CERRADA, EN SECO por omisión:
#   vercomprobante          → `verComprobante` (callable; el visor de comprobantes, Cobros)
#   buscarconversaciones    → `buscarConversaciones` (callable; la búsqueda en conversaciones, Core)
#   enviarcomopersona       → `enviarComoPersona` (callable; la persona escribe desde la consola, Core, H2-3)
#   tomarconversacion       → `tomarConversacion` (callable; la persona toma la conversación, Core, H2-1)
#   devolverconversacion    → `devolverConversacion` (callable; la devuelve al asistente, Core, H2-1)
#   reclamarsalidapersona   → `reclamarSalidaPersona` (HTTP; la llama el flujo n8n con la credencial de la
#                              ingesta del número, Core, H2-3)
#   confirmarsalidapersona  → `confirmarSalidaPersona` (HTTP; ídem)
#   reclamarrescates        → `reclamarRescates` (HTTP; la llama el flujo n8n de rescate de 22 h con la
#                              credencial de la ingesta del número, módulo Pedidos)
#
# POR QUÉ EXISTE. Una Function HTTP o callable nueva no nace invocable si su
# creación no salió limpia: sin `roles/run.invoker` para `allUsers`, Google
# responde un 403 con HTML ANTES de ejecutar una línea del código, y la consola
# no puede usarla (memoria «una Function HTTP nueva no nace invocable»; el mismo
# paso que `nube-catalogo.sh` para el catálogo).
#
# POR QUÉ `allUsers` ES CORRECTO ACÁ, y no un agujero: es lo normal en una
# callable. `allUsers` solo deja que la petición LLEGUE; la barrera es el token,
# DENTRO del código: App Check en producción y, antes de mirar la entrada, la
# sesión (`exigirAutenticado`); después el rol en ESE comercio, el tope y el
# resto. Sin sesión, la respuesta es un JSON de Firebase `UNAUTHENTICATED` (o
# `FAILED_PRECONDITION`). Ninguna de las dos valida la forma de la entrada antes
# de la sesión: un 2xx, o un JSON `INVALID_ARGUMENT`, `PERMISSION_DENIED`,
# `NOT_FOUND` o `RESOURCE_EXHAUSTED`, sin sesión, quiere decir que el código
# atendió a un anónimo («abierto»).
#
# LAS TRES HTTP (`reclamarsalidapersona`, `confirmarsalidapersona`, `reclamarrescates`) NO son
# callables: no hay sesión de Firebase ni App Check; la barrera es la credencial
# de la ingesta del número (`rutaAutenticada`, secreto por alias), que el código
# exige ANTES de mirar la entrada. Sin ella contestan `401` con el texto «no
# autorizado» (no JSON): eso es «nuestro código». Cualquier otra
# respuesta HTTP (2xx, 400, 404, 409, 500, 503…), salvo el 403 HTML de Google y
# el error de red (000), cuenta como «abierto» y se revierte: falla hacia cerrar. Es el mismo modelo que la
# ingesta, que también es pública a nivel de Cloud Run y se protege por dentro.
#
#   ./scripts/nube-visor.sh --servicio <s> --entorno <staging|produccion>
#       SECO: lee la política IAM del servicio y dice qué haría. No escribe.
#   ./scripts/nube-visor.sh --servicio <s> --entorno <e> --aplicar --confirmo <e>
#       Concede roles/run.invoker a allUsers SOLO sobre ese servicio
#       (idempotente; si ya está, no escribe y solo prueba), relee la política
#       y prueba el endpoint sin sesión: tiene que contestar nuestro código, no
#       el 403 de Google. Si contesta «abierto», quita en el acto el binding que
#       acaba de poner, relee, y sale con 3.
#   ./scripts/nube-visor.sh --servicio <s> --entorno <e> --revertir [--aplicar --confirmo <e>]
#       La vuelta atrás: quita ESE binding, con las mismas protecciones.
#
# El servicio: obligatorio, sin valor por omisión, uno de la lista de arriba y
# escrito así (en minúsculas). El proyecto: GCP_PROJECT_ID_STAGING y
# GCP_PROJECT_ID_PROD, LAS DOS (del entorno, o `gh variable get --repo` si no
# están), distintas; y se cruzan con el quota_project_id de las credenciales de
# gcloud (CLOUDSDK_CONFIG; la fuente de nube-catalogo.sh), que es el de
# producción: en producción tiene que coincidir; en staging, NO puede coincidir;
# y con --aplicar, en los dos, tiene que estar. Sin CLOUDSDK_CONFIG ni HOME,
# sale con 2. El id NUNCA se imprime: se dice
# «staging» o «produccion». La región sale de admin/functions/src/core/region.ts.
# Credenciales: la sesión de gcloud de CLOUDSDK_CONFIG (por omisión
# ~/.config/gcloud-novuchat-prod); cualquier otra CLOUDSDK_* se descarta. No lee
# secretos.
#
# Salida: 0 nada que hacer, o escrito y comprobado · 1 el seco encontró algo
# pendiente · 2 uso o salvaguarda (nada escrito) · 3 error de ejecución, el
# servicio no existe (despliega primero), o se revirtió lo escrito.
#
# Contra producción: con el «sí» de Andres, en la ventana 23:30–01:30, seco
# primero (.github/DESPLIEGUE-FIREBASE.md). Andres autoriza; Claude opera.
set -euo pipefail
ESTE="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$ESTE")/.." || exit 1

# La ayuda es el bloque de comentarios del principio, hasta la primera línea de código.
ayuda() { awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$ESTE"; }

# LA LISTA CERRADA. Cada callable con su servicio de Cloud Run (2.ª generación:
# el nombre en minúsculas). No hay variable de entorno ni opción que agregue otro.
readonly SERVICIO_VISOR="vercomprobante"
readonly FUNCION_VISOR="verComprobante"
readonly SERVICIO_BUSCADOR="buscarconversaciones"
readonly FUNCION_BUSCADOR="buscarConversaciones"
readonly SERVICIO_ENVIAR="enviarcomopersona"
readonly FUNCION_ENVIAR="enviarComoPersona"
readonly SERVICIO_TOMAR="tomarconversacion"
readonly FUNCION_TOMAR="tomarConversacion"
readonly SERVICIO_DEVOLVER="devolverconversacion"
readonly FUNCION_DEVOLVER="devolverConversacion"
readonly SERVICIO_RECLAMAR="reclamarsalidapersona"
readonly FUNCION_RECLAMAR="reclamarSalidaPersona"
readonly SERVICIO_CONFIRMAR="confirmarsalidapersona"
readonly FUNCION_CONFIRMAR="confirmarSalidaPersona"
readonly SERVICIO_RESCATES="reclamarrescates"
readonly FUNCION_RESCATES="reclamarRescates"
readonly LISTA_SERVICIOS="${SERVICIO_VISOR}|${SERVICIO_BUSCADOR}|${SERVICIO_ENVIAR}|${SERVICIO_TOMAR}|${SERVICIO_DEVOLVER}|${SERVICIO_RECLAMAR}|${SERVICIO_CONFIRMAR}|${SERVICIO_RESCATES}"
readonly ROL="roles/run.invoker"
readonly MIEMBRO="allUsers"
readonly REPO="segurolotengopy/NovuChat"

PEDIDO=""; ENTORNO=""; APLICAR=0; REVERTIR=0; CONFIRMO=""; VISTO_SERVICIO=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --servicio|--servicio=*)
      (( VISTO_SERVICIO == 0 )) || { echo "✗ --servicio va una sola vez" >&2; exit 2; }
      VISTO_SERVICIO=1
      if [[ "$1" == --servicio ]]; then
        [[ $# -ge 2 ]] || { echo "✗ --servicio necesita uno de ${LISTA_SERVICIOS}" >&2; exit 2; }
        PEDIDO="$2"; shift 2
      else
        PEDIDO="${1#*=}"; shift
      fi ;;
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

# TIPO: callable (responde JSON de Firebase) o http (responde texto 401 «no autorizado»).
case "$PEDIDO" in
  "$SERVICIO_VISOR")     SERVICIO="$SERVICIO_VISOR";     FUNCION="$FUNCION_VISOR";     TIPO="callable" ;;
  "$SERVICIO_BUSCADOR")  SERVICIO="$SERVICIO_BUSCADOR";  FUNCION="$FUNCION_BUSCADOR";  TIPO="callable" ;;
  "$SERVICIO_ENVIAR")    SERVICIO="$SERVICIO_ENVIAR";    FUNCION="$FUNCION_ENVIAR";    TIPO="callable" ;;
  "$SERVICIO_TOMAR")     SERVICIO="$SERVICIO_TOMAR";     FUNCION="$FUNCION_TOMAR";     TIPO="callable" ;;
  "$SERVICIO_DEVOLVER")  SERVICIO="$SERVICIO_DEVOLVER";  FUNCION="$FUNCION_DEVOLVER";  TIPO="callable" ;;
  "$SERVICIO_RECLAMAR")  SERVICIO="$SERVICIO_RECLAMAR";  FUNCION="$FUNCION_RECLAMAR";  TIPO="http" ;;
  "$SERVICIO_CONFIRMAR") SERVICIO="$SERVICIO_CONFIRMAR"; FUNCION="$FUNCION_CONFIRMAR"; TIPO="http" ;;
  "$SERVICIO_RESCATES")  SERVICIO="$SERVICIO_RESCATES";  FUNCION="$FUNCION_RESCATES";  TIPO="http" ;;
  "") echo "✗ Falta --servicio ${LISTA_SERVICIOS} (no hay servicio por omisión)" >&2; exit 2 ;;
  *)  echo "✗ --servicio tiene que ser uno de ${LISTA_SERVICIOS}, escrito así (lista cerrada)" >&2; exit 2 ;;
esac
readonly SERVICIO FUNCION TIPO

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
# Nada del entorno puede cambiar a QUIÉN actúa ni ADÓNDE van las llamadas: de las
# CLOUDSDK_* solo queda CLOUDSDK_CONFIG (cuenta, token, impersonación, extremos,
# proyecto y configuración activa se descartan todas), y gh va con --repo.
if [[ -z "${CLOUDSDK_CONFIG:-}" && -z "${HOME:-}" ]]; then
  echo "✗ Sin CLOUDSDK_CONFIG ni HOME no sé dónde están las credenciales de gcloud: no se sigue" >&2; exit 2
fi
export CLOUDSDK_CONFIG="${CLOUDSDK_CONFIG:-$HOME/.config/gcloud-novuchat-prod}"
for v in "${!CLOUDSDK_@}"; do [[ $v == CLOUDSDK_CONFIG ]] || unset "$v"; done
unset GH_REPO

leer_variable() { # variable del repositorio con gh, solo lectura; vacío si no se puede
  command -v gh >/dev/null 2>&1 || return 0
  gh variable get "$1" --repo "$REPO" 2>/dev/null || true
}
FORMA_PROYECTO='^[a-z][a-z0-9-]{4,28}[a-z0-9]$'
STAGING="${GCP_PROJECT_ID_STAGING:-}"
[[ -n "$STAGING" ]] || STAGING="$(leer_variable GCP_PROJECT_ID_STAGING)"
PROD="${GCP_PROJECT_ID_PROD:-}"
[[ -n "$PROD" ]] || PROD="$(leer_variable GCP_PROJECT_ID_PROD)"

# LAS DOS, con forma de id y distintas, antes de cualquier llamada a gcloud: con
# una sola no se puede saber que el id de staging no sea en realidad el de
# producción (aplicar-consola-oculta.mjs exige lo mismo).
[[ -n "$STAGING" ]] || { echo "✗ Falta GCP_PROJECT_ID_STAGING: hacen falta las dos variables para no confundir proyectos" >&2; exit 2; }
[[ -n "$PROD" ]]    || { echo "✗ Falta GCP_PROJECT_ID_PROD: hacen falta las dos variables para no confundir proyectos" >&2; exit 2; }
[[ "$STAGING" =~ $FORMA_PROYECTO && "$PROD" =~ $FORMA_PROYECTO ]] \
  || { echo "✗ GCP_PROJECT_ID_STAGING o GCP_PROJECT_ID_PROD no tienen la forma de un id de Google Cloud" >&2; exit 2; }
[[ "$STAGING" != "$PROD" ]] \
  || { echo "✗ GCP_PROJECT_ID_STAGING y GCP_PROJECT_ID_PROD son iguales: no se sabe cuál es cuál" >&2; exit 2; }
if [[ "$ENTORNO" == "produccion" ]]; then P="$PROD"; OTRO="$STAGING"; else P="$STAGING"; OTRO="$PROD"; fi

# El cruce con las credenciales de gcloud: su quota_project_id es el de PRODUCCIÓN.
CUOTA=""
ADC="$CLOUDSDK_CONFIG/application_default_credentials.json"
if [[ -r "$ADC" ]]; then
  CUOTA="$(grep -o '"quota_project_id": *"[^"]*"' "$ADC" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/' | head -n 1 || true)"
fi
# Para escribir, el cruce es obligatorio en LOS DOS entornos.
if (( APLICAR )) && [[ -z "$CUOTA" ]]; then
  echo "✗ Sin quota_project_id en las credenciales no se puede cruzar el proyecto: no se escribe" >&2; exit 2
fi
CRUCE=""
if [[ "$ENTORNO" == "produccion" ]]; then
  if [[ -n "$CUOTA" && "$CUOTA" != "$P" ]]; then
    echo "✗ GCP_PROJECT_ID_PROD no coincide con el proyecto de las credenciales de gcloud: no se sigue" >&2; exit 2
  elif [[ -n "$CUOTA" ]]; then
    CRUCE="sí"
  else
    CRUCE="no (sin quota_project_id en las credenciales; con --aplicar se exige)"
  fi
elif [[ -n "$CUOTA" && "$CUOTA" == "$P" ]]; then
  echo "✗ El id de staging coincide con el proyecto de las credenciales, que es el de producción: no se sigue" >&2; exit 2
fi

# --- Salida -------------------------------------------------------------------
V=$'\e[32m'; A=$'\e[33m'; R=$'\e[31m'; F=$'\e[0m'
ok()    { echo "  ${V}✓${F} $*"; }
nota()  { echo "  ${A}·${F} $*"; }
falla() { echo "  ${R}✗${F} $*" >&2; }

ERR="$(mktemp)"; CUERPO="$(mktemp)"
trap 'rm -f "$ERR" "$CUERPO"' EXIT

# Lo que gcloud dice al fallar puede traer el id o el número del proyecto, o la
# cuenta: se tapan sobre el texto COMPLETO, y recién después se corta (un corte
# antes podía dejar medio id sin tapar).
sanear() {
  local t; t="$(cat "$ERR")"
  t="${t//"$P"/<proyecto>}"
  t="${t//"$OTRO"/<proyecto>}"
  [[ -z "$CUOTA" ]] || t="${t//"$CUOTA"/<proyecto>}"
  printf '%s\n' "$t" | sed -E 's/[0-9]{6,}/<número>/g; s/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/<cuenta>/g' \
    | head -c 2000 | head -n 4 | sed 's/^/      /' >&2 || true
}

# gcloud siempre con el proyecto y la región fijos, sin preguntas.
gc() { gcloud --project "$P" --quiet "$@"; }

# «si» o «no»: ¿la política (JSON por stdin) tiene allUsers en roles/run.invoker,
# sin condición? Si no es una política legible, falla (≠ 0): nunca «no» por error.
estado_publico() {
  python3 -I -c '
import json, sys
try:
    p = json.load(sys.stdin)
    bs = p.get("bindings") or []
    publico = any(
        b.get("role") == "roles/run.invoker" and "allUsers" in (b.get("members") or []) and not b.get("condition")
        for b in bs)
except Exception:
    sys.exit(3)
print("si" if publico else "no")
'
}

# Resumen de la política sin identidades: rol, si está allUsers, y cuántos más.
resumir() {
  python3 -I -c '
import json, sys
p = json.load(sys.stdin)
bs = p.get("bindings") or []
if not bs:
    print("    (sin ningún binding)")
for b in bs:
    m = b.get("members") or []
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

# Relee la política e imprime «si»/«no»; sale con 3 si no se puede leer o entender.
releer_publico() {
  local pol e
  pol="$(leer_politica)" || { falla "no pude releer la política:"; sanear; exit 3; }
  e="$(printf '%s' "$pol" | estado_publico)" || { falla "la política releída no es JSON legible"; exit 3; }
  echo "$e"
}

# --- 1. El servicio existe (si no: despliega primero) -------------------------
if (( REVERTIR )); then ACCION="quitar"; else ACCION="conceder"; fi
if (( APLICAR )); then MODO="APLICANDO"; else MODO="seco (no escribe)"; fi
echo "Entorno: ${ENTORNO}  ·  región ${REGION}  ·  servicio ${SERVICIO} (${FUNCION})  ·  ${ACCION} ${ROL} a ${MIEMBRO}  ·  ${MODO}"
if [[ "$ENTORNO" == "produccion" ]]; then
  nota "proyecto cruzado con las credenciales: ${CRUCE}"
  (( APLICAR )) && nota "producción: solo con el «sí» de Andres, en la ventana 23:30–01:30 y después del seco"
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
URL="$(printf '%s' "$descripcion" | python3 -I -c 'import json,sys; print((json.load(sys.stdin).get("status") or {}).get("url") or "")' 2>/dev/null)" \
  || { falla "la descripción del servicio no es JSON legible"; exit 3; }
GESTOR="$(printf '%s' "$descripcion" | python3 -I -c 'import json,sys; print(((json.load(sys.stdin).get("metadata") or {}).get("labels") or {}).get("goog-managed-by") or "")' 2>/dev/null)" \
  || { falla "la descripción del servicio no es JSON legible"; exit 3; }
ok "el servicio ${SERVICIO} existe en ${ENTORNO}"
if [[ "$GESTOR" != "cloudfunctions" ]]; then
  if (( APLICAR )); then
    falla "el servicio no lleva la etiqueta goog-managed-by=cloudfunctions: no se puede asegurar que sea el de la Function ${FUNCION}. No se escribe."
    exit 2
  fi
  nota "el servicio no lleva la etiqueta goog-managed-by=cloudfunctions: confirmar que es el de la Function ${FUNCION} (con --aplicar, no se escribe)"
fi

# --- 2. La política de hoy -----------------------------------------------------
if ! politica="$(leer_politica)"; then
  falla "no pude leer la política IAM de ${SERVICIO}:"; sanear; exit 3
fi
echo "  Política IAM de ${SERVICIO} hoy:"
printf '%s' "$politica" | resumir 2>/dev/null || { falla "la política IAM no es JSON legible"; exit 3; }
ESTADO="$(printf '%s' "$politica" | estado_publico)" || { falla "la política IAM no es JSON legible"; exit 3; }
PUBLICO=0
[[ "$ESTADO" == "si" ]] && PUBLICO=1

# --- 3. La comprobación sin sesión ---------------------------------------------
# Una petición POST sin credenciales al propio servicio, por intento, con una
# entrada bien formada (`{"data":{}}`): el marco de Firebase no la rechaza por
# forma. Nuestro código (o Firebase por él: App Check, sesión) contesta JSON
# `UNAUTHENTICATED` o `FAILED_PRECONDITION`; sin invocador, Google contesta 403
# con HTML (un 403 con JSON de error NO es de Google). Lo que solo sale DESPUÉS
# de la sesión (2xx, `INVALID_ARGUMENT`, `PERMISSION_DENIED`, `NOT_FOUND`,
# `RESOURCE_EXHAUSTED`) es «abierto».
INTENTOS="${NUBE_VISOR_INTENTOS:-9}"; ESPERA="${NUBE_VISOR_ESPERA:-10}"
[[ "$INTENTOS" =~ ^[1-9][0-9]?$ && "$ESPERA" =~ ^[0-9]{1,2}$ ]] \
  || { echo "✗ NUBE_VISOR_INTENTOS (1-99) o NUBE_VISOR_ESPERA (0-99 s) inválidos" >&2; exit 2; }
if [[ "$TIPO" == http ]]; then
  SIN="credencial"; MSG_ESPERADO="texto 401 «no autorizado»"
  MSG_PROPIO="sin credencial contesta NUESTRO código (401 «no autorizado»), no el 403 de Google"
  case "$SERVICIO" in
    "$SERVICIO_RESCATES") QUE_DEJA="El flujo n8n de rescate de 22 h ya no puede llamar a" ;;
    *)                    QUE_DEJA="El flujo n8n «Salida de persona» ya no puede llamar a" ;;
  esac
  BARRERA="la credencial de ingesta del número"
else
  SIN="sesión"; MSG_ESPERADO="JSON de Firebase"
  MSG_PROPIO="sin sesión contesta NUESTRO código (JSON de Firebase), no el 403 de Google"
  QUE_DEJA="La consola ya no puede usar"; BARRERA="el token"
fi
URL_VALIDA="^https://${SERVICIO}-[a-z0-9-]+(\.[a-z0-9-]+)*\.run\.app/?$"
ULTIMA=""

sondear() { # imprime «propio», «google403», «abierto:<código>» u «otro:<código>»
  local linea codigo estado
  : >"$CUERPO"
  linea="$(curl -q -sS --proto '=https' --max-redirs 0 --max-time 20 -o "$CUERPO" -w '%{http_code}' \
    -X POST -H 'Content-Type: application/json' --data '{"data":{}}' "$URL" 2>/dev/null || true)"
  codigo="${linea:0:3}"
  [[ "$codigo" =~ ^[0-9]{3}$ ]] || codigo=000
  # El `status` del JSON de error; «JSON_DE_ERROR» si es un JSON con `error` pero
  # sin `status` de texto; vacío SOLO si el cuerpo no es un JSON de error (el
  # 403 de Google es HTML). Así un 403 con cualquier JSON de error no es «de Google».
  estado="$(python3 -I -c '
import json, sys
try:
    d = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    print(""); sys.exit(0)
if isinstance(d, dict) and "error" in d:
    e = d["error"]
    s = e.get("status") if isinstance(e, dict) else None
    print(s if isinstance(s, str) and s else "JSON_DE_ERROR")
else:
    print("")
' "$CUERPO" 2>/dev/null || true)"
  if [[ "$TIPO" == http ]]; then
    # Función HTTP con credencial de ingesta: sin ella, 401 con el texto exacto
    # «no autorizado». Todo lo demás, salvo el 403 HTML de Google y el error de
    # red (000), cuenta como «abierto».
    local cuerpo; cuerpo="$(head -c 200 "$CUERPO" 2>/dev/null || true)"
    if [[ "$codigo" == 401 && "$cuerpo" == "no autorizado" ]]; then
      echo propio
    elif [[ "$codigo" == 403 && -z "$estado" ]]; then
      echo google403
    elif [[ "$codigo" == 000 ]]; then
      echo "otro:${codigo}"   # error de red: no se revierte a ciegas
    else
      # Falla hacia REVERTIR: cualquier otra respuesta HTTP (409, 500, 503, 2xx con
      # HTML, un 401 con otro texto, un 403 con JSON…) no es ni nuestro 401 ni el
      # 403 de Google; no se puede asegurar que la credencial se exija.
      echo "abierto:${codigo}"
    fi
  elif [[ ( "$codigo" == 401 || "$codigo" == 400 ) && ( "$estado" == UNAUTHENTICATED || "$estado" == FAILED_PRECONDITION ) ]]; then
    echo propio
  elif [[ "$codigo" == 2[0-9][0-9] || "$estado" =~ ^(INVALID_ARGUMENT|PERMISSION_DENIED|NOT_FOUND|RESOURCE_EXHAUSTED)$ ]]; then
    echo "abierto:${codigo}"
  elif [[ "$codigo" == 403 && -z "$estado" ]]; then
    echo google403
  else
    echo "otro:${codigo}"
  fi
}

# $1: propio | google403 — lo esperado. Deja la última respuesta en ULTIMA.
# 0: la esperada · 1: otra · 2: «abierto» (respondió sin sesión; no se reintenta).
comprobar_respuesta() {
  local esperado="$1" i
  ULTIMA=""
  if [[ ! "$URL" =~ $URL_VALIDA ]]; then
    falla "la dirección del servicio no tiene la forma esperada (*.run.app de ${SERVICIO}): no se prueba"; return 1
  fi
  for (( i = 1; i <= INTENTOS; i++ )); do
    ULTIMA="$(sondear)"
    [[ "$ULTIMA" == "$esperado" || "$ULTIMA" == abierto:* ]] && break
    (( i < INTENTOS )) && sleep "$ESPERA"
  done
  if [[ "$ULTIMA" == "$esperado" ]]; then
    case "$ULTIMA" in
      propio)    ok "$MSG_PROPIO" ;;
      google403) ok "sin invocador: Google contesta 403 antes del código, como se esperaba" ;;
    esac
    return 0
  fi
  case "$ULTIMA" in
    abierto:*) falla "respondió SIN ${SIN}: ${ULTIMA#abierto:} no es ni nuestro ${MSG_ESPERADO} ni el 403 de Google; se asume que el código atendió a un anónimo"; return 2 ;;
    propio)    falla "contesta nuestro código: el binding sigue surtiendo efecto" ;;
    google403) falla "contesta el 403 de Google: el invocador no surte efecto (¿propagación de IAM? reintentar con --aplicar --confirmo ${ENTORNO}: no escribe nada si ya está concedido; solo prueba)" ;;
    *)         falla "respuesta inesperada (${ULTIMA#otro:}): ni ${MSG_ESPERADO} ni el 403 de Google" ;;
  esac
  return 1
}

OPCIONES="--servicio ${SERVICIO} --entorno ${ENTORNO}"

# --- 4. Decidir y, con --aplicar, escribir -------------------------------------
echo
if (( REVERTIR )); then
  if (( ! PUBLICO )); then
    ok "${MIEMBRO} no tiene ${ROL} en ${SERVICIO}: nada que quitar"
    exit 0
  fi
  if (( ! APLICAR )); then
    nota "(haría) gcloud run services remove-iam-policy-binding ${SERVICIO} --region ${REGION} --member=${MIEMBRO} --role=${ROL}"
    nota "1 pendiente. Para hacerlo: ${OPCIONES} --revertir --aplicar --confirmo ${ENTORNO}"
    exit 1
  fi
  echo "  → quitando ${ROL} de ${MIEMBRO} en ${SERVICIO}"
  if ! gc run services remove-iam-policy-binding "$SERVICIO" --region "$REGION" \
      --member="$MIEMBRO" --role="$ROL" >/dev/null 2>"$ERR"; then
    falla "gcloud no pudo quitar el binding:"; sanear; exit 3
  fi
  RELEIDO="$(releer_publico)" || exit 3
  [[ "$RELEIDO" == "no" ]] || { falla "al releer, ${MIEMBRO} SIGUE con ${ROL}"; exit 3; }
  ok "relectura: ${MIEMBRO} ya no tiene ${ROL} en ${SERVICIO}"
  comprobar_respuesta google403 || exit 3
  echo; echo "${V}Vuelta atrás hecha.${F} ${QUE_DEJA} ${FUNCION} en ${ENTORNO}."
  exit 0
fi

if (( PUBLICO )); then
  ok "ya concedido: ${MIEMBRO} tiene ${ROL} en ${SERVICIO}. No se escribe nada."
  if (( APLICAR )); then
    # El binding no lo puso esta corrida: si la prueba falla, se avisa y se sale
    # con 3, pero no se quita solo (la vuelta atrás es --revertir).
    comprobar_respuesta propio || { falla "el binding ya estaba puesto; para quitarlo: ${OPCIONES} --revertir --aplicar --confirmo ${ENTORNO}"; exit 3; }
  fi
  exit 0
fi
if (( ! APLICAR )); then
  nota "${SERVICIO} SIN invocador: responde 403 de Google antes de correr el código"
  nota "(haría) gcloud run services add-iam-policy-binding ${SERVICIO} --region ${REGION} --member=${MIEMBRO} --role=${ROL}"
  nota "1 pendiente. Para hacerlo: ${OPCIONES} --aplicar --confirmo ${ENTORNO}"
  exit 1
fi
echo "  → concediendo ${ROL} a ${MIEMBRO} SOLO en ${SERVICIO}"
if ! gc run services add-iam-policy-binding "$SERVICIO" --region "$REGION" \
    --member="$MIEMBRO" --role="$ROL" >/dev/null 2>"$ERR"; then
  falla "gcloud no pudo conceder el binding:"; sanear; exit 3
fi
RELEIDO="$(releer_publico)" || exit 3
[[ "$RELEIDO" == "si" ]] || { falla "al releer, ${MIEMBRO} NO tiene ${ROL}"; exit 3; }
ok "relectura: ${MIEMBRO} tiene ${ROL} en ${SERVICIO}"
if comprobar_respuesta propio; then RC=0; else RC=$?; fi
if (( RC == 2 )); then
  # Lo que esta corrida puso, se quita en el acto: un anónimo llegó al código.
  if ! gc run services remove-iam-policy-binding "$SERVICIO" --region "$REGION" \
      --member="$MIEMBRO" --role="$ROL" >/dev/null 2>"$ERR"; then
    falla "respondió sin sesión (${ULTIMA}) y NO SE PUDO REVERTIR: quitarlo YA con ${OPCIONES} --revertir --aplicar --confirmo ${ENTORNO}"; sanear
    exit 3
  fi
  RELEIDO="$(releer_publico)" || { falla "respondió sin sesión (${ULTIMA}); se pidió quitar el binding pero no se pudo releer: comprobar con ${OPCIONES} --revertir"; exit 3; }
  if [[ "$RELEIDO" != "no" ]]; then
    falla "respondió sin sesión (${ULTIMA}) y, tras quitarlo, ${MIEMBRO} SIGUE con ${ROL}: quitarlo YA con ${OPCIONES} --revertir --aplicar --confirmo ${ENTORNO}"
    exit 3
  fi
  falla "REVERTIDO: respondió sin sesión (${ULTIMA}); se quitó ${ROL} de ${MIEMBRO} en ${SERVICIO} y la relectura lo confirma"
  exit 3
fi
if (( RC != 0 )); then
  falla "el binding QUEDÓ puesto; si persiste: ${OPCIONES} --revertir --aplicar --confirmo ${ENTORNO}"
  exit 3
fi
echo; echo "${V}Listo.${F} ${FUNCION} es invocable en ${ENTORNO}; la barrera sigue siendo ${BARRERA}, dentro del código."
