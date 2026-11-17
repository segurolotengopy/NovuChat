#!/usr/bin/env bash
# =============================================================================
# comprobar-version-servida.sh — ¿el sitio sirve lo que se acaba de construir?
# =============================================================================
# ORIGEN (16/11/2026, v0.23.1): el despliegue quedó a medias y Hosting no se
# publicó, pero el health check pasó porque el sitio VIEJO también responde
# 200. Este script compara el conjunto de `/assets/*.js|css` que referencia el
# HTML construido con el que referencia el HTML servido: Vite pone un hash en
# cada nombre, así que un conjunto distinto es otra versión. (VITE_APP_VERSION
# no sirve: ningún archivo de la consola la usa y no queda en el paquete.)
#
# ENTRADAS (entorno):
#   SOLO           el valor de `--only` del despliegue.
#   URL_CONSOLA    dirección de la consola (https://, o http://127.0.0.1:<p>).
#   HTML_CONSOLA   HTML construido (defecto web/dist/index.html).
#   URL_CATALOGO   dirección del sitio público del catálogo.
#   HTML_CATALOGO  HTML construido (defecto web/dist-catalogo/catalogo.html).
#   INTENTOS (8) y ESPERA (15 s): la CDN de Hosting tarda en propagar.
#
# Qué sitios: los de SOLO, con la regla de la compuerta del registro:
#   «hosting» -> consola y catálogo; «hosting:consola»; «hosting:catalogo».
#
# SALIDA: ok=true|false en $GITHUB_OUTPUT. Códigos: 0 sirve lo construido ·
# 1 sirve otra versión o no responde · 2 error de uso. Solo lee.
# =============================================================================
set -uo pipefail
# Orden y comparación de bytes estables, sea cual sea el idioma del runner.
export LC_ALL=C

uso() { echo "::error::comprobar-version-servida: $*" >&2; exit 2; }
salida() { [[ -z "${GITHUB_OUTPUT:-}" ]] || echo "ok=$1" >> "$GITHUB_OUTPUT"; }

SOLO="${SOLO:-}"
URL_CONSOLA="${URL_CONSOLA:-}"
URL_CATALOGO="${URL_CATALOGO:-}"
HTML_CONSOLA="${HTML_CONSOLA:-web/dist/index.html}"
HTML_CATALOGO="${HTML_CATALOGO:-web/dist-catalogo/catalogo.html}"
INTENTOS="${INTENTOS:-8}"
ESPERA="${ESPERA:-15}"
[[ "$INTENTOS" =~ ^[1-9][0-9]*$ ]] || uso "INTENTOS no es un número positivo"
[[ "$ESPERA" =~ ^[0-9]+$ ]] || uso "ESPERA no es un número"

consola=false; catalogo=false
IFS=',' read -r -a elementos <<< "$SOLO"
for x in "${elementos[@]}"; do
  case "${x//[[:space:]]/}" in
    hosting) consola=true; catalogo=true
      [[ -n "$URL_CATALOGO" ]] || uso "SOLO incluye hosting y falta URL_CATALOGO" ;;
    hosting:consola) consola=true ;;
    hosting:catalogo) catalogo=true ;;
    # Un destino de Hosting que no es consola ni catálogo no tiene URL que
    # comprobar: pasaría en silencio. Es error de uso.
    hosting:*) uso "destino de Hosting desconocido en SOLO: «${x//[[:space:]]/}» (solo hosting, hosting:consola o hosting:catalogo)" ;;
  esac
done
if [[ "$consola" == false && "$catalogo" == false ]]; then
  echo "Este despliegue no incluye Hosting: no hay versión servida que comprobar."
  salida true; exit 0
fi

# https siempre; http solo contra un servidor local de prueba (como humo-sitio-publico.sh).
valida() {
  [[ "$1" == https://* || "$1" == http://127.0.0.1:* ]] \
    || uso "$2 tiene que ser https:// (o http://127.0.0.1:<puerto> para la prueba local)"
}

# El conjunto ordenado de /assets/*.js|css que referencia un HTML (por stdin).
referencias() {
  grep -oE '(src|href)="/assets/[A-Za-z0-9._-]+\.(js|css)"' \
    | sed -E 's/^(src|href)="//; s/"$//' | sort -u
}

fallas=0
comprobar() { # $1 nombre, $2 URL base, $3 ruta de prueba, $4 HTML construido
  local nombre="$1" url="$2" ruta="$3" html="$4" esperado servido i proto
  # Solo https, también al seguir redirecciones (y como mucho 3), para que una
  # redirección no lleve la petición a otro esquema; http solo contra la
  # prueba local en 127.0.0.1.
  if [[ "$url" == http://127.0.0.1:* ]]; then proto='=http'; else proto='=https'; fi
  [[ -f "$html" ]] || uso "no existe el HTML construido de $nombre ($html)"
  esperado="$(referencias < "$html")"
  [[ -n "$esperado" ]] || uso "el HTML construido de $nombre no referencia /assets/*.js|css"
  for ((i = 1; i <= INTENTOS; i++)); do
    servido="$(curl -sS -L --max-redirs 3 --proto "$proto" --proto-redir "$proto" --max-time 10 -H 'Cache-Control: no-cache' -H 'Pragma: no-cache' \
      "${url%/}${ruta}?compuerta=${GITHUB_RUN_ID:-local}-$i" 2>/dev/null | referencias)"
    if [[ "$servido" == "$esperado" ]]; then
      echo "$nombre sirve la versión construida (intento $i)."
      return 0
    fi
    echo "Intento $i: $nombre todavía no sirve la versión construida."
    (( i == INTENTOS )) || sleep "$ESPERA"
  done
  echo "::error::$nombre sirve otra versión: se construyó $(grep -m1 '\.js$' <<< "$esperado"), se sirve $(grep -m1 '\.js$' <<< "$servido" || echo nada)"
  fallas=$((fallas + 1))
}

if [[ "$consola" == true ]]; then valida "$URL_CONSOLA" URL_CONSOLA; fi
if [[ "$catalogo" == true ]]; then valida "$URL_CATALOGO" URL_CATALOGO; fi
# La consola responde en «/»; el catálogo solo sirve su HTML bajo /c/<ficha>
# (cualquier ficha: la página se arma después, en el navegador).
if [[ "$consola" == true ]]; then comprobar consola "$URL_CONSOLA" / "$HTML_CONSOLA"; fi
if [[ "$catalogo" == true ]]; then
  comprobar catálogo "$URL_CATALOGO" /c/00000000000000000000000000000000 "$HTML_CATALOGO"
fi

if (( fallas > 0 )); then salida false; exit 1; fi
salida true
