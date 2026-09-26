#!/usr/bin/env bash
# =============================================================================
# humo-staging.sh — prueba de humo de la consola en STAGING, después de desplegar
# =============================================================================
# Lo que el humo HTTP del estándar (_reusable-dast.yml) no mira y Analisis/28
# pide: que las Functions estén publicadas detrás de Hosting y contesten a un
# anónimo exactamente como el código dice; que las reglas de Firestore y de
# Storage desplegadas nieguen al anónimo; y que el paquete publicado apunte al
# proyecto de staging y no al de producción.
#
# SOLO LEE, y SIN CREDENCIALES: todo lo que comprueba es lo que ve cualquiera
# desde internet. No hay nada que pueda romper.
#
#   ./scripts/humo-staging.sh
#       Lee STAGING_URL, GCP_PROJECT_ID_STAGING y GCP_PROJECT_ID_PROD (variables
#       del repositorio) y VITE_FIREBASE_STORAGE_BUCKET (del Environment
#       `staging`) con `gh variable get`; respeta GH_CONFIG_DIR.
#
#   STAGING_URL=https://... GCP_PROJECT_ID_STAGING=... ./scripts/humo-staging.sh
#       Con las variables en el entorno no llama a gh: así corre en CI, en el
#       job humo-staging. FIREBASE_STORAGE_BUCKET y GCP_PROJECT_ID_PROD son
#       opcionales; sin ellas se omite la comprobación correspondiente y se avisa.
#
# Qué comprueba, y por qué ese código y no otro (los códigos salen del código
# fuente de admin/functions/src, no de una suposición):
#   1. Consola: GET / → 200 con Strict-Transport-Security y
#      Content-Security-Policy (firebase.json las declara); /index.html con
#      Cache-Control: no-cache.
#   2. Functions detrás de las reescrituras de firebase.json. Si una Function
#      no está desplegada, Hosting responde 404 a todo; por eso se pide primero
#      el método EQUIVOCADO (405 = la Function existe y contestó ella):
#        GET  /api/ingesta             405   ingesta.ts (método)
#        POST /api/ingesta sin firma   401   ingesta.ts (no autorizado)
#        GET  /api/configuracion       405   ingesta.ts
#        POST /api/configuracion       401   ingesta.ts
#        GET  /api/qr/<ficha inválida> 404   cobro.ts
#        POST /api/catalogo/enlace     401   catalogoWeb.ts
#        GET  /api/catalogo/<vencido>  404   catalogoWeb.ts (enlace vencido)
#   3. Reglas: la API REST de Firestore sin credenciales devuelve 403 en
#      /tenants, /plataforma y /rutasWhatsApp (negación por defecto). 404
#      significaría que la base no existe; 200, que las reglas están abiertas.
#      Storage: un objeto cualquiera del bucket responde 403 (las reglas se
#      evalúan antes de mirar si el objeto existe; 404 sería reglas abiertas).
#   4. El paquete publicado: el JavaScript de la consola contiene el ID del
#      proyecto de staging (VITE_FIREBASE_PROJECT_ID viaja en el bundle) y NO
#      el de producción.
#
# Salida: 0 todo en orden · 1 alguna comprobación falló · 2 faltan datos.
# =============================================================================
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

V=$'\e[32m'; X=$'\e[31m'; A=$'\e[33m'; F=$'\e[0m'
FALLAS=0
ok()    { echo "  ${V}✓${F} $*"; }
mal()   { echo "  ${X}✗${F} $*"; FALLAS=$((FALLAS + 1)); }
aviso() { echo "  ${A}!${F} $*"; }

# --- Datos: del entorno o de GitHub ------------------------------------------
leer_variable() { # $1 nombre, $2 environment (vacío = repositorio)
  if [[ -n "${2:-}" ]]; then gh variable get "$1" --env "$2" 2>/dev/null
  else gh variable get "$1" 2>/dev/null; fi
}
if [[ -z "${STAGING_URL:-}" || -z "${GCP_PROJECT_ID_STAGING:-}" ]]; then
  command -v gh >/dev/null \
    || { echo "Faltan STAGING_URL y GCP_PROJECT_ID_STAGING, y no hay gh para leerlas." >&2; exit 2; }
  STAGING_URL="${STAGING_URL:-$(leer_variable STAGING_URL)}"
  GCP_PROJECT_ID_STAGING="${GCP_PROJECT_ID_STAGING:-$(leer_variable GCP_PROJECT_ID_STAGING)}"
  FIREBASE_STORAGE_BUCKET="${FIREBASE_STORAGE_BUCKET:-$(leer_variable VITE_FIREBASE_STORAGE_BUCKET staging)}"
  GCP_PROJECT_ID_PROD="${GCP_PROJECT_ID_PROD:-$(leer_variable GCP_PROJECT_ID_PROD)}"
fi
[[ -n "${STAGING_URL:-}" && -n "${GCP_PROJECT_ID_STAGING:-}" ]] \
  || { echo "Sin STAGING_URL o GCP_PROJECT_ID_STAGING: ¿existe ya el proyecto de staging? (docs/staging/DISENO.md)" >&2; exit 2; }
URL="${STAGING_URL%/}"
P="$GCP_PROJECT_ID_STAGING"
BUCKET="${FIREBASE_STORAGE_BUCKET:-}"; BUCKET="${BUCKET#gs://}"

codigo() { # $1 método, $2 URL, resto: opciones de curl. Imprime el código HTTP o 000.
  local metodo="$1" destino="$2" c; shift 2
  c="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 -X "$metodo" "$@" "$destino" 2>/dev/null)"
  [[ "$c" =~ ^[0-9]{3}$ ]] || c=000
  echo "$c"
}
esperar() { # $1 esperado, $2 descripción, $3 método, $4 URL, resto: curl
  local esperado="$1" que="$2" c; shift 2
  c="$(codigo "$@")"
  if [[ "$c" == "$esperado" ]]; then ok "$que → $c"; else mal "$que → $c (se esperaba $esperado)"; fi
}
cabeceras_de() { curl -sSI -L --max-time 20 "$1" 2>/dev/null | tr -d '\r' | tr '[:upper:]' '[:lower:]'; }

echo "Humo de staging: $URL (proyecto $P)"
echo "1. Consola"
# Hosting puede tardar en propagar tras el despliegue: hasta 10 intentos.
c=000
for i in $(seq 1 10); do
  c="$(codigo GET "$URL/" -L)"
  [[ "$c" == 200 ]] && break
  echo "  esperando / → $c (intento $i/10)"; sleep 15
done
if [[ "$c" == 200 ]]; then ok "GET / → 200"; else mal "GET / → $c tras 10 intentos"; fi
cabeceras="$(cabeceras_de "$URL/")"
for h in strict-transport-security content-security-policy x-content-type-options x-frame-options; do
  if grep -q "^$h:" <<< "$cabeceras"; then ok "cabecera $h"; else mal "falta la cabecera $h"; fi
done
if grep -q '^cache-control:.*no-cache' <<< "$(cabeceras_de "$URL/index.html")"; then
  ok "/index.html sin caché"
else
  mal "/index.html sin Cache-Control: no-cache"
fi

echo "2. Functions detrás de Hosting (los códigos que el código fuente da a un anónimo)"
esperar 405 "GET  /api/ingesta (Function viva)"       GET  "$URL/api/ingesta"
esperar 401 "POST /api/ingesta sin firma"             POST "$URL/api/ingesta" -H 'Content-Type: application/json' -d '{}'
esperar 405 "GET  /api/configuracion (Function viva)" GET  "$URL/api/configuracion"
esperar 401 "POST /api/configuracion sin firma"       POST "$URL/api/configuracion" -H 'Content-Type: application/json' -d '{}'
esperar 404 "GET  /api/qr/<ficha inválida>"           GET  "$URL/api/qr/no-es-una-ficha"
esperar 401 "POST /api/catalogo/enlace sin firma"     POST "$URL/api/catalogo/enlace" -H 'Content-Type: application/json' -d '{}'
esperar 404 "GET  /api/catalogo/<enlace vencido>"     GET  "$URL/api/catalogo/no-es-una-ficha"

echo "3. Reglas desplegadas (el anónimo no lee nada)"
FS="https://firestore.googleapis.com/v1/projects/$P/databases/(default)/documents"
for col in tenants plataforma rutasWhatsApp; do
  c="$(codigo GET "$FS/$col")"
  case "$c" in
    403) ok "Firestore /$col → 403" ;;
    404) mal "Firestore /$col → 404: ¿existe la base (default) en el proyecto?" ;;
    *)   mal "Firestore /$col → $c (se esperaba 403; 200 sería reglas abiertas)" ;;
  esac
done
if [[ -n "$BUCKET" ]]; then
  c="$(codigo GET "https://firebasestorage.googleapis.com/v0/b/$BUCKET/o/captacion%2Fnadie%2Fplanes.pdf")"
  if [[ "$c" == 403 ]]; then ok "Storage $BUCKET → 403"; else mal "Storage $BUCKET → $c (se esperaba 403)"; fi
else
  aviso "sin FIREBASE_STORAGE_BUCKET: no se comprueban las reglas de Storage"
fi

echo "4. El paquete publicado apunta a staging"
html="$(curl -sS -L --max-time 20 "$URL/" 2>/dev/null)"
js="$(grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' <<< "$html" | head -1)"
if [[ -z "$js" ]]; then
  mal "no se encontró el JavaScript principal en /"
else
  bundle="$(curl -sS -L --max-time 30 "$URL$js" 2>/dev/null)"
  # El ID va entre comillas o seguido de punto (authDomain, bucket): así no
  # confunde un ID que contenga al otro como subcadena.
  if grep -qE "[\"']${P}[\"'.]" <<< "$bundle"; then
    ok "$js contiene el proyecto de staging"
  else
    mal "$js no contiene el proyecto de staging: ¿VITE_FIREBASE_PROJECT_ID en el Environment 'staging'?"
  fi
  if [[ -n "${GCP_PROJECT_ID_PROD:-}" ]]; then
    if grep -qE "[\"']${GCP_PROJECT_ID_PROD}[\"'.]" <<< "$bundle"; then
      mal "$js contiene el proyecto de PRODUCCIÓN: el paquete se compiló con variables del repositorio"
    else
      ok "$js no menciona el proyecto de producción"
    fi
  else
    aviso "sin GCP_PROJECT_ID_PROD: no se comprueba la ausencia del proyecto de producción"
  fi
fi

echo
if (( FALLAS == 0 )); then
  echo "${V}Staging verificado: todo en orden.${F}"
else
  echo "${X}$FALLAS comprobación(es) fallaron.${F}"; exit 1
fi
