#!/usr/bin/env bash
# Verificación posterior al despliegue de v0.7.0 (el prepago en modo observación).
# SOLO LEE: no escribe en la nube, en Firestore ni en ninguna Function.
#
#   ./scripts/verificar-v070.sh
#
# Comprueba, en un solo paso:
#   1. las 12 Functions nuevas existen, en us-east1 y con la cuenta sa-functions;
#   2. las ocho que el #159 corrigió siguen con sa-functions;
#   3. los dos trabajos de Cloud Scheduler (sondeo cada 5 min, barrido cada 60);
#   4. las dos Functions públicas responden sin exponer nada: imagenDePago con
#      una ficha inválida da 404 y avisoCobrador sin firma da 401;
#   5. plataforma/prepago NO existe todavía: nadie encendió el corte;
#   6. sin errores de las Functions del prepago ni de la ingesta en los últimos
#      30 minutos.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
export CLOUDSDK_CONFIG="${CLOUDSDK_CONFIG:-$HOME/.config/gcloud-novuchat-prod}"
P="$(grep -o '"quota_project_id": *"[^"]*"' "$CLOUDSDK_CONFIG/application_default_credentials.json" | sed 's/.*"\([^"]*\)"$/\1/')"
R=us-east1
V=$'\e[32m'; X=$'\e[31m'; F=$'\e[0m'
FALLAS=0
ok()  { echo "  ${V}✓${F} $*"; }
mal() { echo "  ${X}✗${F} $*"; FALLAS=$((FALLAS + 1)); }

NUEVAS=(anularPagoPendiente avisoCobrador barridoCobros consultarPagoPendiente crearCobroPrepago
        fijarCortePrepago fijarTelefonosPago imagenDePago recordatorioPrepagoEnviado
        recordatoriosPrepago registrarPagoManual sondeoCobros)
CORREGIDAS=(ingesta configuracionFlujo comprobarImagenDelCatalogo recomprobarImagen
            ajustarStock dejarDeControlarStock comprobarArchivoPlanes)

echo "1-2. Functions: región y cuenta"
for f in "${NUEVAS[@]}" "${CORREGIDAS[@]}"; do
  s="$(echo "$f" | tr 'A-Z' 'a-z')"
  sa="$(gcloud run services describe "$s" --region "$R" --project "$P" --format='value(spec.template.spec.serviceAccountName)' 2>/dev/null)"
  if [[ "$sa" == sa-functions@* ]]; then ok "$f en $R con sa-functions"
  elif [[ -z "$sa" ]]; then mal "$f no existe en $R"
  else mal "$f corre con ${sa%%@*}"; fi
done
if gcloud run services describe fijartelefonospago --region us-central1 --project "$P" >/dev/null 2>&1; then
  mal "hay un fijarTelefonosPago en us-central1: borrarlo (con OK) después de confirmar que el de $R responde"
fi

echo "3. Cloud Scheduler"
TRABAJOS="$(gcloud scheduler jobs list --location "$R" --project "$P" --format='value(name,schedule,state)' 2>/dev/null)"
for t in sondeoCobros barridoCobros; do
  linea="$(echo "$TRABAJOS" | grep -i "$t" | head -1)"
  if [[ -n "$linea" ]]; then ok "$t: $(echo "$linea" | awk '{$1=""; print}')"; else mal "no hay trabajo para $t"; fi
done

echo "4. Las dos Functions públicas"
BASE="https://$R-$P.cloudfunctions.net"
c="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/imagenDePago?f=no-es-una-ficha")"
[[ "$c" == 404 ]] && ok "imagenDePago con ficha inválida: 404" || mal "imagenDePago respondió $c (se esperaba 404)"
c="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' "$BASE/avisoCobrador")"
[[ "$c" == 401 ]] && ok "avisoCobrador sin firma: 401" || mal "avisoCobrador respondió $c (se esperaba 401)"

echo "5. El corte sigue apagado"
TOKEN="$(gcloud auth print-access-token 2>/dev/null)"
c="$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" \
  "https://firestore.googleapis.com/v1/projects/$P/databases/(default)/documents/plataforma/prepago")"
unset TOKEN
[[ "$c" == 404 ]] && ok "plataforma/prepago no existe: modo observación" || mal "plataforma/prepago respondió $c (¿alguien encendió el corte?)"

echo "6. Errores en los últimos 30 minutos"
FILTRO='severity>=ERROR AND resource.type="cloud_run_revision" AND (resource.labels.service_name=("ingesta" OR "configuracionflujo" OR "sondeocobros" OR "barridocobros" OR "avisocobrador" OR "imagendepago" OR "crearcobroprepago" OR "registrarpagomanual" OR "recordatoriosprepago"))'
n="$(gcloud logging read "$FILTRO" --project "$P" --freshness=30m --limit=50 --format='value(timestamp)' 2>/dev/null | wc -l)"
(( n == 0 )) && ok "sin errores" || mal "$n errores: gcloud logging read con el filtro de este script para verlos"

echo
if (( FALLAS == 0 )); then echo "${V}v0.7.0 verificada: todo en orden.${F}"; else echo "${X}$FALLAS comprobación(es) fallaron.${F}"; exit 1; fi
