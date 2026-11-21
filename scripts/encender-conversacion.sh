#!/usr/bin/env bash
# Enciende TODO el juego de conversación de un comercio con una sola corrida (seco por omisión). La lógica vive en
# admin/scripts/plataforma/encender-conversacion.mjs; este envoltorio solo:
#   1. ubica el proyecto de las credenciales de gcloud (quota_project_id) sin imprimirlo;
#   2. deja que el script de Node exija la lista blanca (GCP_PROJECT_ID_STAGING / _PROD) del entorno;
#   3. llama al script de Node con los argumentos tal cual, desde la raíz del repositorio.
#
#   ./scripts/encender-conversacion.sh --tenant <id> --env .env [--alias <clienteNN>] \
#        --cred-ingesta "<nombre>" --cred-envio "<nombre>" --respaldo-dir <ruta> [--aplicar --confirmo produccion]
#   ./scripts/encender-conversacion.sh --todos          (solo lectura: qué comercios no tienen el juego completo)
#
# Sin redespliegue (decisión D1, 21/11/2026). Salida: 0 listo · 1 (seco) hay pasos por hacer · 2 uso o salvaguarda · 3 fallo.
# Nunca imprime la ruta del webhook, claves ni el id del proyecto.
set -euo pipefail

ESTE="$(readlink -f "${BASH_SOURCE[0]}")"
RAIZ="$(dirname "$(dirname "$ESTE")")"

TIENE_PROYECTO=0
for a in "$@"; do
  case "$a" in
    -h|--help) sed -n '2,12p' "$ESTE" | sed 's/^# \{0,1\}//'; exit 0 ;;
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
exec node scripts/plataforma/encender-conversacion.mjs ${EXTRA[@]+"${EXTRA[@]}"} "$@"
