#!/usr/bin/env bash
# =============================================================================
# sondear-n8n.sh — sonda EXTERNA de la ruta de salud del n8n de producción.
# =============================================================================
#
# Por qué existe (política de Andres del 11/10/2026 y diseño del 12/11/2026,
# docs/produccion/monitor-n8n.md): ningún monitoreo puede depender de la laptop.
# El 11/11 dos sesiones vieron «HTTP 000» desde la oficina y era un cortafuegos,
# no una caída. Esta sonda corre en GitHub Actions (otra red) y DICE QUÉ FALLÓ:
# nombre que no resuelve, conexión, tiempo, TLS o respuesta del servidor.
#
# Qué hace:
#   sondear      (por omisión) Hasta MONITOR_RONDAS rondas; cada ronda son
#                MONITOR_INTENTOS consultas a la URL. Una ronda buena basta: sale
#                0. Solo si fallan TODAS las rondas sale 1. Con dos rondas
#                separadas unos minutos, un parpadeo no declara nada.
#   certificado  Días que le quedan al certificado del host. Nunca falla la
#                corrida: informa `dias=` y `certificado=vigente|por_vencer|…`.
#
# Lo que NUNCA hace: imprimir la URL ni el host (el dominio no va en registros
# de un repositorio público), llamar a una ruta de webhook, ni escribir en n8n.
# La ruta de salud no crea ejecuciones (medido el 10/10/2026).
#
# Entrada (variables de entorno):
#   MONITOR_URL            https://<host>/healthz o https://<host>/healthz/readiness
#   MONITOR_RONDAS         rondas (por omisión 2)
#   MONITOR_INTENTOS       consultas por ronda (por omisión 3)
#   MONITOR_ESPERA_S       segundos entre consultas (por omisión 20)
#   MONITOR_PAUSA_RONDA_S  segundos entre rondas (por omisión 240)
#   MONITOR_TIEMPO_S       tope de cada consulta (por omisión 10)
#   MONITOR_CERT_AVISO_D   días para avisar del certificado (por omisión 14)
#   MONITOR_AHORA_EPOCH    solo pruebas: «ahora» simulado para el certificado
#
# Salida: líneas `clave=valor` por stdout y, si existe, en $GITHUB_OUTPUT.
#   estado = ok | no_resuelve | sin_conexion | tiempo_agotado | tls | http_5xx
#            | http_otro | error_de_red
# Pruebas: admin/pruebas/plataforma/monitor-n8n-sonda.test.ts
set -uo pipefail

MODO="${1:-sondear}"

salir_mal_uso() {
  echo "::error::$1" >&2
  exit 2
}

emitir() {
  # Solo valores de una lista cerrada o números: nada que venga de la red.
  echo "$1=$2"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "$1=$2" >> "$GITHUB_OUTPUT"
  fi
}

entero() {
  # $1 nombre, $2 valor, $3 mínimo, $4 máximo
  if ! [[ "$2" =~ ^[0-9]{1,5}$ ]] || [ "$2" -lt "$3" ] || [ "$2" -gt "$4" ]; then
    salir_mal_uso "$1 debe ser un entero entre $3 y $4."
  fi
}

URL="${MONITOR_URL:-}"
[ -n "$URL" ] || salir_mal_uso "Falta MONITOR_URL (secreto del Environment)."
# Solo https, solo un nombre de host (sin usuario@, puerto ni consulta) y solo
# la ruta de salud: con otra forma la sonda podría tocar una ruta de webhook o
# mandar la consulta a otro servidor.
if ! [[ "$URL" =~ ^https://([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}/healthz(/readiness)?$ ]]; then
  salir_mal_uso "MONITOR_URL debe ser https://<host>/healthz o https://<host>/healthz/readiness."
fi
HOST="${URL#https://}"
HOST="${HOST%%/*}"

RONDAS="${MONITOR_RONDAS:-2}"
INTENTOS="${MONITOR_INTENTOS:-3}"
ESPERA="${MONITOR_ESPERA_S:-20}"
PAUSA="${MONITOR_PAUSA_RONDA_S:-240}"
TIEMPO="${MONITOR_TIEMPO_S:-10}"
AVISO_D="${MONITOR_CERT_AVISO_D:-14}"
entero MONITOR_RONDAS "$RONDAS" 1 3
entero MONITOR_INTENTOS "$INTENTOS" 1 5
entero MONITOR_ESPERA_S "$ESPERA" 0 60
entero MONITOR_PAUSA_RONDA_S "$PAUSA" 0 300
entero MONITOR_TIEMPO_S "$TIEMPO" 1 30
entero MONITOR_CERT_AVISO_D "$AVISO_D" 1 60

# Clasifica UNA consulta. Deja en ESTADO un valor de la lista cerrada.
consultar() {
  local codigo salida
  # --proto y --proto-redir: nunca http, ni siquiera por una redirección.
  # --max-redirs 0: una redirección es una respuesta rara, no se sigue.
  codigo="$(curl --silent --output /dev/null --write-out '%{http_code}' \
    --proto '=https' --proto-redir '=https' --max-redirs 0 \
    --max-time "$TIEMPO" "$URL" 2>/dev/null)"
  salida=$?
  case "$salida" in
    0)
      if [ "$codigo" = "200" ]; then ESTADO="ok"
      elif [[ "$codigo" =~ ^5[0-9][0-9]$ ]]; then ESTADO="http_5xx"
      else ESTADO="http_otro"
      fi
      ;;
    6) ESTADO="no_resuelve" ;;
    7) ESTADO="sin_conexion" ;;
    28) ESTADO="tiempo_agotado" ;;
    35 | 51 | 58 | 59 | 60 | 77 | 83 | 90 | 91) ESTADO="tls" ;;
    *) ESTADO="error_de_red" ;;
  esac
  if [[ "$codigo" =~ ^[0-9]{3}$ ]]; then CODIGO="$codigo"; else CODIGO="000"; fi
}

sondear() {
  local ronda intento
  ESTADO="error_de_red"
  CODIGO="000"
  for ronda in $(seq 1 "$RONDAS"); do
    for intento in $(seq 1 "$INTENTOS"); do
      consultar
      echo "ronda=$ronda intento=$intento estado=$ESTADO http=$CODIGO"
      if [ "$ESTADO" = "ok" ]; then
        emitir estado ok
        emitir http "$CODIGO"
        emitir rondas_fallidas "$((ronda - 1))"
        return 0
      fi
      if [ "$intento" -lt "$INTENTOS" ]; then sleep "$ESPERA"; fi
    done
    if [ "$ronda" -lt "$RONDAS" ]; then sleep "$PAUSA"; fi
  done
  emitir estado "$ESTADO"
  emitir http "$CODIGO"
  emitir rondas_fallidas "$RONDAS"
  echo "::error::La ruta de salud de n8n falló en $RONDAS rondas seguidas (estado=$ESTADO, http=$CODIGO)."
  return 1
}

certificado() {
  local fin fin_epoch ahora dias
  # `</dev/null` cierra la sesión TLS en cuanto llega el certificado.
  fin="$(timeout 20 openssl s_client -connect "$HOST:443" -servername "$HOST" </dev/null 2>/dev/null |
    openssl x509 -noout -enddate 2>/dev/null)"
  fin="${fin#notAfter=}"
  if [ -z "$fin" ]; then
    emitir certificado sin_datos
    return 0
  fi
  fin_epoch="$(date -u -d "$fin" +%s 2>/dev/null)"
  if ! [[ "$fin_epoch" =~ ^[0-9]+$ ]]; then
    emitir certificado sin_datos
    return 0
  fi
  ahora="${MONITOR_AHORA_EPOCH:-$(date -u +%s)}"
  [[ "$ahora" =~ ^[0-9]+$ ]] || salir_mal_uso "MONITOR_AHORA_EPOCH debe ser un entero."
  dias=$(((fin_epoch - ahora) / 86400))
  emitir dias "$dias"
  if [ "$fin_epoch" -le "$ahora" ]; then
    emitir certificado vencido
    echo "::warning::El certificado de n8n está vencido."
  elif [ "$dias" -lt "$AVISO_D" ]; then
    emitir certificado por_vencer
    echo "::warning::Al certificado de n8n le quedan $dias días (aviso a los $AVISO_D): la renovación automática no está corriendo."
  else
    emitir certificado vigente
  fi
  return 0
}

case "$MODO" in
  sondear) sondear ;;
  certificado) certificado ;;
  *) salir_mal_uso "Uso: sondear-n8n.sh [sondear|certificado]" ;;
esac
