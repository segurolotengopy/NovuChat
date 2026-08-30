#!/usr/bin/env bash
# Verifica de una pasada las cuatro condiciones que deben cumplirse para que
# los mensajes de WhatsApp lleguen a n8n. Solo lee; no modifica nada salvo que
# se pase --suscribir.
#
#   ./scripts/verificar-meta.sh                       # usa .env (Demo A)
#   ./scripts/verificar-meta.sh --env .env.demo-b     # otro entorno
#   ./scripts/verificar-meta.sh --suscribir           # corrige la suscripción
#   ./scripts/verificar-meta.sh --env .env.demo-b --suscribir
#
# Cada demo tiene su propia app de Meta, con su WA_APP_ID, WA_PHONE_ID y
# WABA_ID: por eso hace falta poder apuntar el script a un archivo distinto.
# Todos los archivos .env* están en .gitignore (repositorio público).
set -euo pipefail

cd "$(dirname "$0")/.." || exit 1

ARCHIVO_ENV=".env"
SUSCRIBIR=0
uso() {
  # Imprime el bloque de comentarios de la cabecera, hasta la primera linea
  # que no sea comentario. Asi la ayuda no se desincroniza al editar el script.
  awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "$0"
  exit "${1:-0}"
}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      [[ $# -ge 2 ]] || { echo "✗ --env requiere la ruta de un archivo"; exit 2; }
      ARCHIVO_ENV="$2"; shift 2 ;;
    --env=*)   ARCHIVO_ENV="${1#--env=}"; shift ;;
    --suscribir) SUSCRIBIR=1; shift ;;
    -h|--help)   uso 0 ;;
    *) echo "✗ Argumento no reconocido: $1"; uso 2 ;;
  esac
done

if [[ ! -f "$ARCHIVO_ENV" ]]; then
  echo "✗ Falta ${ARCHIVO_ENV} (copiar de .env.example)"
  exit 1
fi
echo "Entorno: ${ARCHIVO_ENV}"
set -a
# shellcheck disable=SC1090  # ruta variable: la elige --env
source "$ARCHIVO_ENV"
set +a
: "${WA_TOKEN:?Falta WA_TOKEN en ${ARCHIVO_ENV}}"
G="https://graph.facebook.com/${WA_GRAPH_VERSION:-v26.0}"

# La URL del webhook se arma con N8N_BASE_URL + N8N_WEBHOOK_PATH si no se
# definio la completa. Ningun valor real vive en este archivo (repo publico).
if [[ -z "${N8N_WEBHOOK_URL:-}" && -n "${N8N_BASE_URL:-}" && -n "${N8N_WEBHOOK_PATH:-}" ]]; then
  N8N_WEBHOOK_URL="${N8N_BASE_URL%/}${N8N_WEBHOOK_PATH}"
fi

ok=0; fail=0
p_ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$*"; ok=$((ok+1)); }
p_fail() { printf '  \033[1;31m✗\033[0m %s\n' "$*"; fail=$((fail+1)); }

echo "== 1. El token pertenece a la app correcta =="
APP=$(curl -s --max-time 20 "${G}/debug_token?input_token=${WA_TOKEN}&access_token=${WA_TOKEN}" || echo '{}')
APP_ID=$(echo "$APP" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("data",{}).get("app_id",""))' 2>/dev/null || echo "")
if [[ "$APP_ID" == "${WA_APP_ID}" ]]; then
  p_ok "token de la app ${WA_APP_ID}"
else
  p_fail "el token pertenece a la app '${APP_ID:-sin-respuesta}', se esperaba ${WA_APP_ID}"
  echo "     → generar un token nuevo desde el usuario de sistema eligiendo NovuChat-Demo-A"
fi

echo "== 2. La WABA está suscrita a la app =="
SUBS=$(curl -s --max-time 20 "${G}/${WABA_ID}/subscribed_apps" -H "Authorization: Bearer ${WA_TOKEN}" || echo '{}')
if echo "$SUBS" | grep -q "\"${WA_APP_ID}\""; then
  p_ok "la WABA ${WABA_ID} entrega a la app ${WA_APP_ID}"
else
  p_fail "la app NO está suscrita a la WABA — los mensajes no llegarán a n8n"
  echo "$SUBS" | python3 -m json.tool 2>/dev/null || true
  if [[ $SUSCRIBIR -eq 1 ]]; then
    echo "     → suscribiendo..."
    curl -s -X POST "${G}/${WABA_ID}/subscribed_apps" \
      -H "Authorization: Bearer ${WA_TOKEN}" | python3 -m json.tool
  else
    echo "     → corregir con: $0 --env ${ARCHIVO_ENV} --suscribir"
  fi
fi

echo "== 3. El número de prueba responde =="
NUM=$(curl -s --max-time 20 "${G}/${WA_PHONE_ID}" -H "Authorization: Bearer ${WA_TOKEN}" || echo '{}')
if echo "$NUM" | grep -q '"id"'; then
  p_ok "$(echo "$NUM" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("display_phone_number","?"),"·",d.get("verified_name","?"))' 2>/dev/null)"
else
  p_fail "no se pudo leer el número ${WA_PHONE_ID}"
fi

echo "== 4. El webhook de n8n responde el desafío =="
if [[ -n "${N8N_WEBHOOK_URL:-}" ]]; then
  R=$(curl -s --max-time 20 -o /dev/null -w '%{http_code}' \
      "${N8N_WEBHOOK_URL}?hub.mode=subscribe&hub.verify_token=x&hub.challenge=12345" || true)
  R=${R:-000}
  if [[ "$R" == "200" ]]; then
    p_ok "el endpoint devuelve 200 (flujo publicado y proxy correcto)"
  else
    p_fail "el endpoint devuelve HTTP ${R} — ¿flujo sin publicar, o URL de Test?"
  fi
else
  echo "  - N8N_WEBHOOK_URL no definida, se omite"
fi

echo
if [[ $fail -eq 0 ]]; then
  printf '\033[1;32mTodo en orden (%d comprobaciones).\033[0m\n' "$ok"
else
  printf '\033[1;31m%d comprobación(es) fallida(s).\033[0m Ver ESTADO.md §Hallazgos.\n' "$fail"
  exit 1
fi
