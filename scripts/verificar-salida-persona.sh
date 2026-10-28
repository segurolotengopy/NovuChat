#!/usr/bin/env bash
# Verifica, SOLO LECTURA, que la «Salida de persona» de un número esté completa antes de
# encender «Tomar» (personaPuedeEscribir). La lógica vive en
# admin/scripts/plataforma/verificar-salida-persona.mjs; este envoltorio solo:
#   1. ubica el proyecto de las credenciales de gcloud (quota_project_id) sin imprimirlo;
#   2. deja que el script de Node exija la lista blanca (GCP_PROJECT_ID_STAGING / _PROD) del entorno;
#   3. llama al script de Node con los argumentos tal cual.
#
#   ./scripts/verificar-salida-persona.sh --alias <clienteNN> --tenant <id> [--env .env] \
#        [--probar-timbre] [--encender [--aplicar --respaldo <ruta> --confirmo-produccion <tenant>]]
#
# Si se pasa --proyecto, se usa tal cual (la lista blanca la comprueba el script de Node).
# Salida: 0 todo OK · 1 hay FALLAs · 2 uso o salvaguarda · 3 error, o algo no se pudo verificar.
# Nunca imprime secretos, rutas de webhook, claves ni el id del proyecto.
set -euo pipefail

ESTE="$(readlink -f "${BASH_SOURCE[0]}")"
RAIZ="$(dirname "$(dirname "$ESTE")")"

TIENE_PROYECTO=0
for a in "$@"; do
  case "$a" in
    -h|--help) sed -n '2,13p' "$ESTE" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --proyecto) TIENE_PROYECTO=1 ;;
    *) ;;
  esac
done

if [[ -z "${CLOUDSDK_CONFIG:-}" && -z "${HOME:-}" ]]; then
  echo "✗ Sin CLOUDSDK_CONFIG ni HOME no sé dónde están las credenciales de gcloud" >&2; exit 2
fi
export CLOUDSDK_CONFIG="${CLOUDSDK_CONFIG:-$HOME/.config/gcloud-novuchat-prod}"
for v in "${!CLOUDSDK_@}"; do [[ $v == CLOUDSDK_CONFIG ]] || unset "$v"; done

EXTRA=()
if (( ! TIENE_PROYECTO )); then
  ADC="$CLOUDSDK_CONFIG/application_default_credentials.json"
  P=""
  if [[ -r "$ADC" ]]; then
    P="$(grep -o '"quota_project_id": *"[^"]*"' "$ADC" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/' | head -n 1 || true)"
  fi
  [[ -n "$P" ]] || { echo "✗ No encuentro el proyecto en las credenciales de gcloud (quota_project_id); pase --proyecto" >&2; exit 2; }
  EXTRA=(--proyecto "$P")
fi

cd "$RAIZ/admin"
exec node scripts/plataforma/verificar-salida-persona.mjs ${EXTRA[@]+"${EXTRA[@]}"} "$@"
