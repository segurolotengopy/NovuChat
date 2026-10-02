#!/usr/bin/env bash
# curl FALSO para la suite que corre los scripts de la API de n8n sin red
# (clave-n8n-fuera-de-argumentos.test.ts). Va adelante en el PATH con el
# nombre `curl`.
#
# Anota cada llamada en $REGISTRO_CURL, una línea:
#   <MÉTODO> <argumentos> ‹entrada estándar›
# La entrada estándar se lee solo si algún argumento es `@-` (donde los scripts
# ponen la cabecera con la clave): así se ve qué viajó por ahí y qué por argv.
#
# Contesta como la API pública de n8n, lo mínimo para que cada script siga su
# camino: un flujo ($RESPUESTA_FLUJO) al leer /workflows/<id>, listas vacías o
# $RESPUESTA_EJECUCIONES / $RESPUESTA_CREDENCIALES al listar, `{"active":…}` al encender o apagar, y el
# flujo con id al crear o reescribir. Respeta -o y -w '%{http_code}' (200).
# Sin registro no es la suite: se niega, en vez de contestar «200» a una
# escritura que no ocurrió (revisión de seguridad del #276, L-3).
[ -n "${REGISTRO_CURL:-}" ] || { echo "curl falso: solo para clave-n8n-fuera-de-argumentos.test.ts" >&2; exit 97; }
metodo=GET; entrada=""; salida=""; formato=""; url=""
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  a="${args[i]}"; sig="${args[i + 1]:-}"
  case "$a" in
    -X | --request) metodo="$sig"; i=$((i + 1)) ;;
    -d | --data | --data-* | --json) [ "$metodo" = GET ] && metodo=POST; i=$((i + 1)) ;;
    -o | --output) salida="$sig"; i=$((i + 1)) ;;
    -w | --write-out) formato="$sig"; i=$((i + 1)) ;;
    -H | --header | --max-time | -m) i=$((i + 1)) ;;
    http*://*) url="$a" ;;
  esac
done
case " $* " in *" @- "*) entrada=$(cat) ;; esac
printf '%s %s ‹%s›\n' "$metodo" "$*" "$entrada" >> "$REGISTRO_CURL"

FLUJO_POR_DEFECTO='{"id":"7","name":"Flujo de prueba","active":false,"nodes":[],"connections":{},"settings":{}}'
LISTA_VACIA='{"data":[]}'
ruta="${url#*/api/v1}"; ruta="${ruta%%\?*}"
case "$metodo $ruta" in
  "POST /workflows/"*/activate)   cuerpo='{"id":"7","name":"Flujo de prueba","active":true}' ;;
  "POST /workflows/"*/deactivate) cuerpo='{"id":"7","name":"Flujo de prueba","active":false}' ;;
  "POST /workflows")              cuerpo='{"id":"99","name":"Flujo de prueba","active":false,"nodes":[]}' ;;
  "PUT /workflows/"*)             cuerpo="${RESPUESTA_FLUJO:-$FLUJO_POR_DEFECTO}" ;;
  "GET /workflows/"*)             cuerpo="${RESPUESTA_FLUJO:-$FLUJO_POR_DEFECTO}" ;;
  "GET /credentials")             cuerpo="${RESPUESTA_CREDENCIALES:-$LISTA_VACIA}" ;;
  "GET /executions")              cuerpo="${RESPUESTA_EJECUCIONES:-$LISTA_VACIA}" ;;
  "GET /executions/"*)            cuerpo='{"id":"1","status":"error","data":{"resultData":{"runData":{}}}}' ;;
  *)                              cuerpo="$LISTA_VACIA" ;;
esac
if [ -n "$salida" ]; then printf '%s' "$cuerpo" > "$salida"; else printf '%s' "$cuerpo"; fi
case "$formato" in *http_code*) printf 200 ;; esac
exit 0
