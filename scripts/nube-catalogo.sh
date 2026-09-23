#!/usr/bin/env bash
# El paso de NUBE que el catálogo web necesita para que n8n pueda pedir enlaces.
#
# POR QUÉ EXISTE. Las seis Functions del catálogo web se desplegaron el
# 22/09/2026. Cinco quedaron con invocador `allUsers`; `enlaceCatalogo` quedó
# SIN NINGÚN binding, así que responde 403 de Google —una página HTML, no
# nuestro JSON— antes de ejecutar una línea de su código. El flujo de n8n no
# puede pedir un enlace de catálogo, y el 403 no se parece en nada a los
# errores que el flujo sabe interpretar.
#
# Es el mismo paso que `Prompts/COORDINACION.md` ya tenía anotado para
# `avisoCobrador` e `imagenDePago`: una Function HTTP nueva no nace invocable,
# y el despliegue no lo arregla porque corre con `--non-interactive`.
#
# POR QUÉ `allUsers` ES CORRECTO ACÁ, y no un agujero:
#   - `enlaceCatalogo` se autentica DENTRO de su código con la misma
#     `rutaAutenticada()` que `ingesta` y `configuracionFlujo`: cabecera
#     `X-NovuChat-Numero` más firma HMAC o token del secreto de ese número.
#     Sin eso devuelve 401. `allUsers` solo permite que la petición LLEGUE.
#   - `configuracionFlujo` e `ingesta`, que hoy atienden a todos los comercios,
#     tienen exactamente este mismo binding desde siempre.
#   - `cors: false` sigue impidiendo que un navegador la llame.
# Quitar `allUsers` no da seguridad: apaga el endpoint.
#
#   ./scripts/nube-catalogo.sh              # diagnóstico: qué falta (no escribe)
#   ./scripts/nube-catalogo.sh --aplicar    # lo hace (idempotente)
#
# Andres autoriza; Claude opera.
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1

APLICAR=0
case "${1:-}" in
  --aplicar) APLICAR=1 ;;
  "") ;;
  -h|--help) sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) echo "Opción desconocida: $1" >&2; exit 2 ;;
esac

export CLOUDSDK_CONFIG="${CLOUDSDK_CONFIG:-$HOME/.config/gcloud-novuchat-prod}"
P="$(grep -o '"quota_project_id": *"[^"]*"' "$CLOUDSDK_CONFIG/application_default_credentials.json" | sed 's/.*"\([^"]*\)"$/\1/')"
[[ -n "$P" ]] || { echo "✗ no encuentro el proyecto en $CLOUDSDK_CONFIG" >&2; exit 1; }
REGION="${REGION_FUNCIONES:-us-east1}"

# Las Functions HTTP del catálogo web que TIENEN que ser invocables.
# El servicio de Cloud Run que hay debajo de una Function de 2.ª generación
# lleva el nombre en minúsculas: `enlaceCatalogo` → `enlacecatalogo`.
FUNCIONES=(enlaceCatalogo catalogoPublico checkoutCatalogo fotoDeCatalogo)

V=$'\e[32m'; A=$'\e[33m'; R=$'\e[31m'; F=$'\e[0m'
ok()    { echo "  ${V}✓${F} $*"; }
falta() { echo "  ${A}·${F} $*"; }
PENDIENTES=0

if (( APLICAR )); then
  echo "Proyecto: ${P:0:4}…  ·  región ${REGION}  ·  APLICANDO"
else
  echo "Proyecto: ${P:0:4}…  ·  región ${REGION}  ·  diagnóstico (no escribe)"
fi
echo

for fn in "${FUNCIONES[@]}"; do
  servicio="projects/${P}/locations/${REGION}/services/$(printf '%s' "$fn" | tr '[:upper:]' '[:lower:]')"

  if ! politica="$(gcloud run services get-iam-policy "$servicio" --format=json 2>/dev/null)"; then
    echo "  ${R}✗${F} ${fn}: no existe o no se puede leer su política"
    PENDIENTES=$((PENDIENTES + 1))
    continue
  fi

  # `allUsers` en roles/run.invoker: la única forma de que la petición LLEGUE.
  if printf '%s' "$politica" | python3 -c '
import json, sys
p = json.load(sys.stdin)
publico = any(
    b.get("role") == "roles/run.invoker" and "allUsers" in b.get("members", [])
    for b in p.get("bindings", [])
)
sys.exit(0 if publico else 1)
'; then
    ok "${fn}: invocable (allUsers)"
    continue
  fi

  falta "${fn}: SIN invocador — responde 403 de Google antes de correr"
  PENDIENTES=$((PENDIENTES + 1))
  if (( APLICAR )); then
    echo "    → concediendo roles/run.invoker a allUsers"
    gcloud run services add-iam-policy-binding "$servicio" \
      --member=allUsers --role=roles/run.invoker --quiet >/dev/null
    ok "${fn}: concedido"
  else
    echo "    (haría) gcloud run services add-iam-policy-binding … --member=allUsers --role=roles/run.invoker"
  fi
done

echo
if (( PENDIENTES == 0 )); then
  echo "${V}Nada que hacer: las cuatro Functions del catálogo son invocables.${F}"
elif (( APLICAR )); then
  echo "${V}Listo.${F} Comprobar con una petición sin credenciales: tiene que devolver 401"
  echo "de la función (JSON o texto nuestro), no un 403 con HTML de Google."
else
  echo "${A}${PENDIENTES} pendiente(s).${F} Volver a correr con --aplicar."
  exit 1
fi
