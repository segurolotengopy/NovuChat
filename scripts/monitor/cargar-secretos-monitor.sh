#!/usr/bin/env bash
# =============================================================================
# cargar-secretos-monitor.sh — carga en el Environment `monitor-n8n` de GitHub
# los dos secretos del monitor externo de n8n SIN MOSTRAR NUNCA SU VALOR.
# =============================================================================
#
# Por qué existe. «Andres autoriza; Claude opera»: los secretos no se le pasan
# a Andres para que los pegue, y ninguna sesión puede leer el `.env`. Este paso
# revisado lee el host de n8n del `.env` COMO DATO (sin ejecutarlo) y arma la
# URL de salud; el id del chequeo de la sonda se lee de un ARCHIVO de modo 600
# (--ping-desde). Los dos valores viajan a `gh secret set` por la entrada estándar: nunca por
# argumentos, pantalla ni archivo.
#
#   ./scripts/monitor/cargar-secretos-monitor.sh --env <.env>
#       SECO (por omisión): dice qué cargaría y si la forma de cada valor es
#       válida. No llama a GitHub.
#   ./scripts/monitor/cargar-secretos-monitor.sh --env <.env> --ping-desde <archivo> \
#       --aplicar --confirmo github
#       Carga MONITOR_N8N_URL (https://<host de N8N_BASE_URL>/healthz/readiness)
#       y MONITOR_N8N_PING_URL (https://hc-ping.com/<uuid>) en el Environment.
#       El id del chequeo se lee de la PRIMERA LÍNEA de --ping-desde (archivo del
#       usuario, modo 600): así no queda en el historial del shell ni en una orden
#       de sesión. No hay variable de entorno para el id: una asignación en la línea
#       de comandos lo dejaría en el historial.
#       Sin ninguno de los dos carga solo el primer secreto y lo dice.
#
# Salida: 0 hecho, o seco sin hallazgos · 2 uso o validación (nada escrito) ·
# 3 falló `gh` (puede haber escrito uno de los dos).
# Se deshace con `gh secret delete <NOMBRE> --env monitor-n8n`.
# Pruebas: admin/pruebas/plataforma/monitor-n8n-reporte.test.ts (grupo «cargar-secretos-monitor.sh»)
set -uo pipefail
case "$-" in *x*) echo "✗ xtrace activo: imprimiría los valores. No se escribió nada." >&2; exit 2 ;; esac
[[ "${SHELLOPTS:-}" != *xtrace* ]] || { echo "✗ SHELLOPTS=xtrace: imprimiría los valores. No se escribió nada." >&2; exit 2; }

readonly REPO="segurolotengopy/NovuChat"
readonly ENTORNO="monitor-n8n"

ENV_FILE=""; PING_FILE=""; APLICAR=0; CONFIRMO=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)      [[ $# -ge 2 ]] || { echo "✗ --env necesita un valor" >&2; exit 2; }; ENV_FILE="$2"; shift 2 ;;
    --ping-desde) [[ $# -ge 2 ]] || { echo "✗ --ping-desde necesita un valor" >&2; exit 2; }; PING_FILE="$2"; shift 2 ;;
    --aplicar)  APLICAR=1; shift ;;
    --confirmo) [[ $# -ge 2 ]] || { echo "✗ --confirmo necesita un valor" >&2; exit 2; }; CONFIRMO="$2"; shift 2 ;;
    -h|--help)  awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"; exit 0 ;;
    *) echo "✗ Opción desconocida (ver --help)" >&2; exit 2 ;;
  esac
done
[[ -n "$ENV_FILE" ]] || { echo "✗ Falta --env <archivo con N8N_BASE_URL>" >&2; exit 2; }
[[ -f "$ENV_FILE" ]] || { echo "✗ No existe --env" >&2; exit 2; }
if (( APLICAR )); then
  [[ "$CONFIRMO" == "github" ]] || { echo "✗ --aplicar exige --confirmo github. No se escribió nada." >&2; exit 2; }
elif [[ -n "$CONFIRMO" ]]; then echo "✗ --confirmo solo va con --aplicar" >&2; exit 2; fi

# El .env se lee como texto: nunca se ejecuta ni se carga en el entorno.
BASE="$(grep -E '^N8N_BASE_URL=' "$ENV_FILE" | tail -n 1 | cut -d= -f2- | tr -d '"' | tr -d "'" | tr -d '\r' || true)"
[[ -n "$BASE" ]] || { echo "✗ --env no tiene N8N_BASE_URL" >&2; exit 2; }
# Solo https y solo un nombre de host (sin usuario@, puerto ni IP); la ruta que traiga se descarta.
if ! [[ "$BASE" =~ ^https://(([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,})(/.*)?$ ]]; then
  echo "✗ N8N_BASE_URL no tiene la forma https://<host> (sin usuario, puerto ni IP). No se escribió nada." >&2; exit 2
fi
URL_SALUD="https://${BASH_REMATCH[1]}/healthz/readiness"

PING_ID=""
if [[ -n "$PING_FILE" ]]; then
  # Archivo común del usuario y no legible por otros: el id es una URL de capacidad.
  [[ -f "$PING_FILE" && ! -L "$PING_FILE" && -O "$PING_FILE" && "$(stat -c %a "$PING_FILE")" == "600" ]] \
    || { echo "✗ --ping-desde debe ser un archivo común del usuario, de modo 600. No se escribió nada." >&2; exit 2; }
  PING_ID="$(head -n 1 "$PING_FILE" | tr -d '\r\n ')"
  # Si se pidió el id por archivo y no hay nada que leer, no se carga a medias.
  [[ -n "$PING_ID" ]] || { echo "✗ --ping-desde no tiene el id en su primera línea. No se escribió nada." >&2; exit 2; }
fi
URL_PING=""
if [[ -n "$PING_ID" ]]; then
  [[ "$PING_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] \
    || { echo "✗ El id del chequeo no tiene forma de UUID en minúsculas. No se escribió nada." >&2; exit 2; }
  URL_PING="https://hc-ping.com/${PING_ID}"
fi

echo "MONITOR_N8N_URL       forma válida (https://<host>/healthz/readiness)"
if [[ -n "$URL_PING" ]]; then echo "MONITOR_N8N_PING_URL  forma válida (https://hc-ping.com/<id>)"
else echo "MONITOR_N8N_PING_URL  NO se carga: falta el id del chequeo (--ping-desde)"; fi

if (( ! APLICAR )); then
  echo "SECO: no se llamó a GitHub. Para cargar: --aplicar --confirmo github"
  exit 0
fi

cargar() { # $1 nombre; el valor llega por la entrada estándar
  if gh secret set "$1" --env "$ENTORNO" --repo "$REPO" >/dev/null 2>&1; then
    echo "✓ $1 cargado en el Environment $ENTORNO"
  else
    echo "✗ gh no pudo cargar $1 (sesión de gh, permisos o Environment inexistente)" >&2
    return 1
  fi
}
printf '%s' "$URL_SALUD" | cargar MONITOR_N8N_URL || exit 3
if [[ -n "$URL_PING" ]]; then printf '%s' "$URL_PING" | cargar MONITOR_N8N_PING_URL || exit 3; fi
exit 0
