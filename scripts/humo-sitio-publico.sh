#!/usr/bin/env bash
# =============================================================================
# humo-sitio-publico.sh — prueba de humo del SITIO PÚBLICO del catálogo web
# =============================================================================
# T-37 (admin/SEGURIDAD.md): la página pública del catálogo vive en un SEGUNDO
# sitio de Hosting, con otro origen que la consola. Este script comprueba, desde
# internet y SIN credenciales, que ese sitio quedó como el diseño dice. Es la
# única fuente de esa comprobación: la usan `humo-staging.sh` (punto 5, en CI) y
# la verificación posterior al despliegue de producción.
#
#   SITIO_PUBLICO_URL=https://<sitio>.web.app ./scripts/humo-sitio-publico.sh
#   SITIO_PUBLICO_URL=... CONSOLA_URL=https://<consola> ./scripts/humo-sitio-publico.sh
#   SITIO_PUBLICO_URL=... FICHA_DE_PRUEBA=<32 hexadecimales> ./scripts/humo-sitio-publico.sh
#
#   SITIO_PUBLICO_URL  obligatoria: la dirección del sitio público (la misma
#                      que `SITIO_PUBLICO` de las Functions).
#   CONSOLA_URL        opcional: la de la consola. Si se da, se exige que sea OTRO
#                      origen (la separación que T-37 pide).
#   FICHA_DE_PRUEBA    opcional: una ficha REAL y vigente (la que llega en el
#                      enlace de WhatsApp del ensayo, o la de la vista previa de
#                      la consola, que dura 15 minutos). Con ella se comprueba el
#                      camino completo: la página y el JSON del catálogo.
#
# Qué comprueba, y con qué código (los códigos salen de `catalogoWeb.ts`):
#   1. `/c/<ficha>` → 200 con la CSP propia del catálogo (sin marcos, sin
#      Google, sin Firebase, sin Functions), HSTS, nosniff, X-Frame-Options,
#      X-Robots-Tag y Referrer-Policy: no-referrer (la ficha viaja en la ruta).
#   2. La consola NO está en este origen: `/` y `/index.html` → 404.
#   3. Las Functions públicas contestan: GET `/api/catalogo/<x>/checkout` → 405
#      (método equivocado: contestó la Function), GET `/api/catalogo/<x>` → 404
#      (ficha inexistente). Las demás NO se exponen: `/api/ingesta/` y
#      `/api/configuracion/` → 404; `POST /api/catalogo/enlace` → 405 (lo atiende
#      `catalogoPublico`, solo GET; la Function firmada daría 401).
#   4. El JavaScript publicado no trae el SDK de Firebase: el código de sesión de
#      un administrador no existe en este origen.
#   5. Con FICHA_DE_PRUEBA: `/api/catalogo/<ficha>` → 200 con `items`.
#
# SOLO LEE. No imprime la ficha ni la dirección completa de la ficha.
# Salida: 0 todo en orden · 1 alguna comprobación falló · 2 faltan datos.
# =============================================================================
set -uo pipefail

V=$'\e[32m'; X=$'\e[31m'; A=$'\e[33m'; F=$'\e[0m'
FALLAS=0
ok()    { echo "  ${V}✓${F} $*"; }
mal()   { echo "  ${X}✗${F} $*"; FALLAS=$((FALLAS + 1)); }
aviso() { echo "  ${A}!${F} $*"; }

PUBLICO="${SITIO_PUBLICO_URL:-}"; PUBLICO="${PUBLICO%/}"
CONSOLA="${CONSOLA_URL:-}"; CONSOLA="${CONSOLA%/}"
FICHA="${FICHA_DE_PRUEBA:-}"
[[ -n "$PUBLICO" ]] || { echo "Falta SITIO_PUBLICO_URL." >&2; exit 2; }
# https siempre; http solo contra el servidor local de `probar-csp.mjs` (127.0.0.1).
[[ "$PUBLICO" == https://* || "$PUBLICO" == http://127.0.0.1:* ]] \
  || { echo "SITIO_PUBLICO_URL tiene que ser https:// (o http://127.0.0.1:<puerto> para la prueba local)." >&2; exit 2; }
if [[ -n "$FICHA" && ! "$FICHA" =~ ^[0-9a-f]{32}$ ]]; then
  echo "FICHA_DE_PRUEBA no tiene forma de ficha (32 hexadecimales)." >&2; exit 2
fi
[[ -z "$FICHA" ]] || { [[ "${GITHUB_ACTIONS:-}" == "true" ]] && echo "::add-mask::$FICHA"; }

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

echo "Humo del sitio público del catálogo"
if [[ -n "$CONSOLA" ]]; then
  if [[ "$PUBLICO" == "$CONSOLA" ]]; then
    mal "el sitio público es el origen de la consola: la página pública tiene que estar en OTRO sitio (T-37)"
  else
    ok "el sitio público y la consola son orígenes distintos"
  fi
fi

echo "1. La página y su política de seguridad"
FICHA0=00000000000000000000000000000000
# Hosting puede tardar en propagar un sitio recién publicado: hasta 10 intentos.
c=000
for i in $(seq 1 10); do
  c="$(codigo GET "$PUBLICO/c/$FICHA0" -L)"
  [[ "$c" == 200 ]] && break
  echo "  esperando /c/<ficha> → $c (intento $i/10)"; sleep 15
done
if [[ "$c" == 200 ]]; then ok "GET /c/<ficha> → 200 (la página; con una ficha falsa ella misma dice «enlace vencido»)"
else mal "GET /c/<ficha> → $c tras 10 intentos"; fi
cab="$(cabeceras_de "$PUBLICO/c/$FICHA0")"
csp="$(grep '^content-security-policy:' <<< "$cab")"
for d in "default-src 'none'" "script-src 'self';" "frame-ancestors 'none'" "form-action 'none'" "connect-src 'self'"; do
  if grep -qF "$d" <<< "$csp"; then ok "CSP: $d"; else mal "CSP sin «$d»"; fi
done
if grep -qE 'frame-src|google|firebase|gstatic|unsafe-eval|cloudfunctions|run\.app' <<< "$csp"; then
  mal "la CSP nombra marcos, Google, Firebase o Functions: no es la del catálogo"
else
  ok "la CSP no nombra marcos, Google, Firebase ni Functions"
fi
for h in strict-transport-security x-content-type-options x-frame-options x-robots-tag; do
  if grep -q "^$h:" <<< "$cab"; then ok "cabecera $h"; else mal "falta la cabecera $h"; fi
done
if grep -q '^referrer-policy: no-referrer' <<< "$cab"; then ok "Referrer-Policy: no-referrer"
else mal "sin Referrer-Policy: no-referrer (la ficha viaja en la ruta)"; fi

echo "2. La consola NO está en este origen"
esperar 404 "GET  / (nada fuera de /c/**)"              GET "$PUBLICO/"
esperar 404 "GET  /index.html (entrada de la consola)"  GET "$PUBLICO/index.html"

echo "3. Las Functions: las del catálogo contestan, las demás no se exponen"
# El método equivocado primero: 405 = la Function existe y contestó ella; un 404
# sería Hosting sin Function detrás.
esperar 405 "GET  /api/catalogo/<x>/checkout (Function viva)" GET "$PUBLICO/api/catalogo/no-es-una-ficha/checkout"
esperar 404 "GET  /api/catalogo/<enlace vencido>"             GET "$PUBLICO/api/catalogo/no-es-una-ficha"
esperar 405 "POST /api/catalogo/enlace (no es la Function firmada)" POST "$PUBLICO/api/catalogo/enlace" -H 'Content-Type: application/json' -d '{}'
esperar 404 "GET  /api/ingesta/ (no se expone)"               GET "$PUBLICO/api/ingesta/"
esperar 404 "GET  /api/configuracion/ (no se expone)"         GET "$PUBLICO/api/configuracion/"

echo "4. El paquete publicado no trae el SDK de Firebase"
js="$(curl -sS -L --max-time 20 "$PUBLICO/c/$FICHA0" 2>/dev/null | grep -oE '/assets/catalogo-[A-Za-z0-9_-]+\.js' | head -1)"
if [[ -z "$js" ]]; then
  mal "no se encontró el JavaScript de la página pública"
else
  bundle="$(curl -sS -L --max-time 30 "$PUBLICO$js" 2>/dev/null)"
  if [[ -z "$bundle" ]]; then mal "$js no se pudo leer"
  elif grep -qE 'identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com|firestore\.googleapis\.com' <<< "$bundle"; then
    mal "$js trae el SDK de Firebase: el código de sesión está en el origen público"
  else
    ok "$js sin el SDK de Firebase"
  fi
fi

echo "5. Una ficha real"
if [[ -z "$FICHA" ]]; then
  aviso "sin FICHA_DE_PRUEBA: no se comprueba el camino completo (pásela desde un enlace real del ensayo)"
else
  esperar 200 "GET  /c/<ficha de prueba> (la página)" GET "$PUBLICO/c/$FICHA" -L
  cuerpo="$(curl -sS --max-time 20 -H 'Accept: application/json' "$PUBLICO/api/catalogo/$FICHA" 2>/dev/null)"
  if command -v jq >/dev/null && jq -e '(.items | type) == "array" and (.items | length) > 0' <<< "$cuerpo" >/dev/null 2>&1; then
    ok "GET /api/catalogo/<ficha de prueba> → catálogo con ítems"
  else
    mal "GET /api/catalogo/<ficha de prueba> no devolvió un catálogo con ítems (¿ficha vencida? la de la vista previa dura 15 min)"
  fi
fi

echo
if (( FALLAS == 0 )); then
  echo "${V}Sitio público verificado: todo en orden.${F}"
else
  echo "${X}$FALLAS comprobación(es) fallaron.${F}"; exit 1
fi
