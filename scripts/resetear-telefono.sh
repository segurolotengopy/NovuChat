#!/usr/bin/env bash
# =============================================================================
# resetear-telefono.sh — EL ÚNICO REINICIO de un teléfono de prueba en un comercio, SIN variables a mano.
#
#   ./scripts/resetear-telefono.sh --tenant <comercio> --tel <dígitos>            # seco: solo lee y dice qué limpiaría
#   ./scripts/resetear-telefono.sh --tenant <comercio> --tel <dígitos> --aplicar  # limpia, con respaldo y relectura
#
# QUÉ HACE POR USTED (Andres, 20/11/2026: «debería ser UN solo reinicio, unificado»): arma el entorno que antes había que
# preparar a mano y llama a `admin/scripts/plataforma/resetear-telefono-prueba.mjs`, que limpia en una pasada la sesión y los cupos del
# servidor, el cobro pendiente, la atención (contador de 24 h), la pausa «Tomar» y la ficha/memoria del teléfono en n8n, y RELEE todo.
#   - la LISTA BLANCA de teléfonos sale de la tabla local (`CONFIGURACION.local.md`): las filas REEMPLAZAR_TELEFONOS_DE_PRUEBA y
#     REEMPLAZAR_TELEFONOS_DE_PRUEBA_<COMERCIO> (comas). Un teléfono que no está ahí NO se resetea. Los valores no se imprimen;
#   - la dirección y la clave de n8n salen del `.env` (se cargan acá, dentro del proceso; nunca se imprimen);
#   - el respaldo (datos de persona) va a una carpeta temporal 0700 fuera del repositorio; BÓRRELO al cerrar la prueba (sirve para deshacer con --revertir);
#   - `--aplicar` ya trae la confirmación de producción del comercio.
# Vale para CUALQUIER comercio con flujo en su ficha (no hay lista fija); los demos y NovuChat se rechazan.
# Variables opcionales: CONFIG_LOCAL_MD (otra tabla), ENV_N8N (otro .env), CLOUDSDK_CONFIG.
# RESETEAR_SOLO_LISTA=1 solo comprueba que el teléfono esté en la lista blanca (para las pruebas).
# =============================================================================
set -euo pipefail
set +x
cd "$(dirname "$0")/.." || exit 1

TENANT=""; TEL=""; APLICAR=0
while [ $# -gt 0 ]; do
  case "$1" in
    --tenant)  TENANT="${2:?}"; shift 2 ;;
    --tel)     TEL="${2:?}"; shift 2 ;;
    --aplicar) APLICAR=1; shift ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "✗ Opción desconocida: $1" >&2; exit 2 ;;
  esac
done
[[ "$TENANT" =~ ^[a-z0-9][a-z0-9-]{2,59}$ ]] || { echo "✗ --tenant: id de comercio (minúsculas, dígitos y guion)" >&2; exit 2; }
[[ "$TEL" =~ ^[0-9]{8,15}$ ]] || { echo "✗ --tel: solo dígitos (8 a 15)" >&2; exit 2; }

TABLA="${CONFIG_LOCAL_MD:-$HOME/NovuChat/CONFIGURACION.local.md}"
[ -f "$TABLA" ] || { echo "✗ No existe la tabla local: sin ella no hay lista blanca de teléfonos de prueba" >&2; exit 1; }

# La lista blanca: dos filas posibles de la tabla; el valor no se muestra.
TELEFONOS_PRUEBA="$(TABLA="$TABLA" TENANT="$TENANT" python3 - <<'PY'
import os, re
t = os.environ["TENANT"].upper().replace("-", "_")
claves = {"REEMPLAZAR_TELEFONOS_DE_PRUEBA", "REEMPLAZAR_TELEFONOS_DE_PRUEBA_" + t}
fila = re.compile(r'^\|\s*`(REEMPLAZAR_[^`]*)`\s*\|([^|]*)\|')
tels = []
for linea in open(os.environ["TABLA"], encoding="utf-8"):
    m = fila.match(linea)
    if m and m.group(1) in claves and "pendiente" not in linea.lower():
        tels += [x.strip() for x in m.group(2).strip().strip("`").split(",") if x.strip()]
print(",".join(dict.fromkeys(tels)))
PY
)"
[ -n "$TELEFONOS_PRUEBA" ] || { echo "✗ La tabla local no tiene teléfonos de prueba para este comercio (fila REEMPLAZAR_TELEFONOS_DE_PRUEBA)" >&2; exit 1; }
case ",$TELEFONOS_PRUEBA," in *",$TEL,"*) ;; *) echo "✗ Ese teléfono NO está en la lista blanca de teléfonos de prueba: no se resetea" >&2; exit 1 ;; esac
if [ "${RESETEAR_SOLO_LISTA:-0}" = 1 ]; then echo "✓ el teléfono está en la lista blanca (${TENANT})"; exit 0; fi

ENV_N8N="${ENV_N8N:-.env}"
[ -f "$ENV_N8N" ] || ENV_N8N="$HOME/NovuChat/.env"
# Del .env se toman SOLO la dirección y la clave de n8n (no se carga el archivo entero); no se imprimen.
valor_env() { grep -E "^$1=" "$ENV_N8N" 2>/dev/null | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"; }
N8N_BASE_URL="$(valor_env N8N_BASE_URL)"; N8N_API_KEY="$(valor_env N8N_API_KEY)"
export N8N_BASE_URL N8N_API_KEY
# La lista cerrada de flujos que el reseteo puede reescribir: SOLO flujos de NovuChat (nombre que empieza por «NovuChat»). El .mjs elige UNO por el nombre del comercio
# («(<comercio>)» o el nombre fijo de su tabla) y exige que esté en esta lista. Los ids no se imprimen.
if [ -n "$N8N_BASE_URL" ] && [ -n "$N8N_API_KEY" ]; then
  N8N_WORKFLOWS_PERMITIDOS="$(curl -s --compressed --max-time 150 -H @- "${N8N_BASE_URL%/}/api/v1/workflows?limit=250" <<<"X-N8N-API-KEY: ${N8N_API_KEY}" | TENANT="$TENANT" python3 -c '
import json, os, sys
t = os.environ["TENANT"]
try: d = json.load(sys.stdin).get("data", [])
except Exception: d = []
print(",".join(w["id"] for w in d if str(w.get("name", "")).startswith("NovuChat")))' || true)"
  export N8N_WORKFLOWS_PERMITIDOS
  echo "• flujos de NovuChat en la lista cerrada: $(printf '%s' "$N8N_WORKFLOWS_PERMITIDOS" | tr ',' '\n' | grep -c .)"
fi
export TELEFONOS_PRUEBA
export GCP_PROJECT_ID_PROD="${GCP_PROJECT_ID_PROD:-novuchat-demo}"
export GCP_PROJECT_ID_STAGING="${GCP_PROJECT_ID_STAGING:-novuchat-staging}"
export CLOUDSDK_CONFIG="${CLOUDSDK_CONFIG:-$HOME/.config/gcloud-novuchat-prod}"

ARGS=(--proyecto "$GCP_PROJECT_ID_PROD" --tenant "$TENANT" --tel "$TEL")
if [ "$APLICAR" = 1 ]; then
  DIR="$(mktemp -d)"; chmod 700 "$DIR"
  ARGS+=(--aplicar --respaldo "$DIR/respaldo.json" --confirmo-produccion "$TENANT")
  echo "• Respaldo (datos de persona): $DIR/respaldo.json — bórrelo al cerrar la prueba (sirve para --revertir)."
fi
( cd admin && node scripts/plataforma/resetear-telefono-prueba.mjs "${ARGS[@]}" )
