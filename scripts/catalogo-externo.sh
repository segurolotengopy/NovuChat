#!/usr/bin/env bash
# Envoltorio de `admin/scripts/plataforma/aplicar-catalogo-externo.mjs` (enciende, apaga o revierte
# `tenants/<id>/config/pedidos.catalogoExterno` de UN comercio), SIN que nadie lea ni pegue un id de proyecto.
# Calcado de `nube-novutienda-catalogo.sh` (gcloud aislado, seco por omisión, id nunca impreso).
#
#   ./scripts/catalogo-externo.sh --entorno staging|produccion --tenant <id> --monedas BOB,ARS [--crear-documento]
#   ./scripts/catalogo-externo.sh --entorno staging|produccion --tenant <id> --desactivar
#       SECO por omisión: lee y muestra «valor actual → nuevo». No escribe.
#   ./scripts/catalogo-externo.sh --entorno E --tenant <id> --monedas BOB,ARS --aplicar --confirmo E
#       Escribe SOLO `catalogoExterno`. `--confirmo` tiene que ser IGUAL a `--entorno` (escrito a mano). El respaldo es
#       obligatorio y lo crea el envoltorio: archivo de modo 600 en una carpeta 700 FUERA del repositorio
#       (`/var/tmp/novuchat-respaldos-<uid>/`); se imprime su ruta (no es secreta) para poder revertir.
#   ./scripts/catalogo-externo.sh --entorno E --tenant <id> --revertir <ruta-del-respaldo> [--aplicar --confirmo E]
#       Restaura el valor previo (o elimina el campo / el documento creado). El respaldo tiene que estar en esa carpeta.
#
# EL PROYECTO. No se pasa nunca: sale del `quota_project_id` de las credenciales de gcloud de cada entorno
# (`application_default_credentials.json`): producción en `$NOVUCHAT_GCLOUD_PROD` (por omisión ~/.config/gcloud-novuchat-prod) y
# staging en `$NOVUCHAT_GCLOUD_STAGING` (por omisión ~/.config/gcloud). Se calculan los DOS (el script de nodo exige la lista
# blanca de ambos y que sean distintos) y llegan al proceso de nodo por variables de entorno SOLO de ese proceso
# (GCP_PROJECT_ID_PROD, GCP_PROJECT_ID_STAGING) y por su `--proyecto`. Toda la salida pasa por un filtro que reemplaza los
# ids por «<proyecto>». Los ids NUNCA se imprimen. Cualquier CLOUDSDK_* heredada se descarta.
#
# Salida: la del script de nodo (0 bien · 1 diferencias o falta algo · 2 uso o salvaguarda, nada escrito · 3 error) y 2 si
# este envoltorio rechaza algo antes de llamarlo.
#
# Contra producción: con el «sí» de Andres, seco primero (.github/DESPLIEGUE-FIREBASE.md).
set -euo pipefail
case "$-" in *x*) echo "✗ xtrace activo: no se escribió nada." >&2; exit 2 ;; esac
[[ "${SHELLOPTS:-}" != *xtrace* ]] || { echo "✗ SHELLOPTS=xtrace en el entorno: no se escribió nada." >&2; exit 2; }
set +x
ESTE="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$ESTE")/.." || exit 1
ayuda() { awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$ESTE"; }

ENTORNO=""; TENANT=""; MONEDAS=""; DESACTIVAR=0; CREAR=0; APLICAR=0; CONFIRMO=""; REVERTIR=""
necesita() { [[ $# -ge 2 ]] || { echo "✗ $1 requiere un valor" >&2; exit 2; }; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --entorno)         necesita "$@"; ENTORNO="$2"; shift 2 ;;
    --tenant)          necesita "$@"; TENANT="$2"; shift 2 ;;
    --monedas)         necesita "$@"; MONEDAS="$2"; shift 2 ;;
    --desactivar)      DESACTIVAR=1; shift ;;
    --crear-documento) CREAR=1; shift ;;
    --aplicar)         APLICAR=1; shift ;;
    --confirmo)        necesita "$@"; CONFIRMO="$2"; shift 2 ;;
    --revertir)        necesita "$@"; REVERTIR="$2"; shift 2 ;;
    -h|--help)         ayuda; exit 0 ;;
    *) echo "✗ Opción desconocida (ver --help)" >&2; exit 2 ;;
  esac
done
[[ "$ENTORNO" == staging || "$ENTORNO" == produccion ]] || { echo "✗ --entorno: staging o produccion" >&2; exit 2; }
[[ "$TENANT" =~ ^[a-z0-9][a-z0-9-]{2,59}$ ]] || { echo "✗ --tenant: id de comercio (minúsculas, dígitos y guiones)" >&2; exit 2; }
[[ -n "${HOME:-}" ]] || { echo "✗ HOME no está definido" >&2; exit 2; }
if (( APLICAR )); then
  [[ "$CONFIRMO" == "$ENTORNO" ]] || { echo "✗ --aplicar exige --confirmo $ENTORNO (escrito a mano). No se escribió nada." >&2; exit 2; }
elif [[ -n "$CONFIRMO" ]]; then
  echo "✗ --confirmo solo va con --aplicar" >&2; exit 2
fi
if [[ -n "$REVERTIR" ]]; then
  { (( ! DESACTIVAR )) && (( ! CREAR )) && [[ -z "$MONEDAS" ]]; } || { echo "✗ --revertir no admite --monedas, --desactivar ni --crear-documento" >&2; exit 2; }
elif (( DESACTIVAR )); then
  { [[ -z "$MONEDAS" ]] && (( ! CREAR )); } || { echo "✗ --desactivar no admite --monedas ni --crear-documento" >&2; exit 2; }
else
  [[ "$MONEDAS" =~ ^(BOB|ARS)(,(BOB|ARS))?$ ]] || { echo "✗ --monedas: BOB, ARS o BOB,ARS" >&2; exit 2; }
fi

# La carpeta de respaldos: del usuario, modo 700, fuera del repositorio.
BASE_RESPALDOS="${NOVUCHAT_RESPALDOS_BASE:-/var/tmp}"
DIR_RESPALDOS="$BASE_RESPALDOS/novuchat-respaldos-$(id -u)"
preparar_carpeta() {
  [[ ! -L "$DIR_RESPALDOS" ]] || { echo "✗ la carpeta de respaldos es un enlace" >&2; exit 2; }
  mkdir -p -m 700 -- "$DIR_RESPALDOS"
  [[ "$(stat -c '%a %u' -- "$DIR_RESPALDOS")" == "700 $(id -u)" ]] || { echo "✗ la carpeta de respaldos tiene que ser del usuario y de modo 700" >&2; exit 2; }
}
if [[ -n "$REVERTIR" ]]; then
  [[ "$REVERTIR" != *..* && "$REVERTIR" == "$DIR_RESPALDOS"/*.json && ! -L "$REVERTIR" && -f "$REVERTIR" ]] \
    || { echo "✗ --revertir: el respaldo tiene que ser un archivo .json (no un enlace) dentro de la carpeta de respaldos del envoltorio" >&2; exit 2; }
  [[ "$(stat -c '%a %u' -- "$REVERTIR")" == "600 $(id -u)" ]] || { echo "✗ el respaldo tiene que ser del usuario y de modo 600" >&2; exit 2; }
fi

# Los ids salen de las credenciales de cada entorno. Nada se imprime.
CONFIG_PROD="${NOVUCHAT_GCLOUD_PROD:-$HOME/.config/gcloud-novuchat-prod}"
CONFIG_STG="${NOVUCHAT_GCLOUD_STAGING:-$HOME/.config/gcloud}"
for v in "${!CLOUDSDK_@}"; do unset "$v"; done
export CLOUDSDK_CORE_DISABLE_FILE_LOGGING=true
id_de() { # <carpeta de gcloud> → quota_project_id por stdout (lo captura la llamada; nunca va a la pantalla)
  python3 -I -c '
import sys, json, re
try:
    d = json.load(open(sys.argv[1] + "/application_default_credentials.json"))
    q = d.get("quota_project_id")
    assert isinstance(q, str) and re.fullmatch(r"[a-z][a-z0-9-]{4,28}[a-z0-9]", q)
    print(q)
except Exception:
    sys.exit(1)
' "$1" 2>/dev/null
}
ID_PROD="$(id_de "$CONFIG_PROD")" || { echo "✗ no se pudo leer el proyecto de las credenciales de producción" >&2; exit 3; }
ID_STG="$(id_de "$CONFIG_STG")" || { echo "✗ no se pudo leer el proyecto de las credenciales de staging" >&2; exit 3; }
[[ "$ID_PROD" != "$ID_STG" ]] || { echo "✗ las credenciales de producción y de staging apuntan al mismo proyecto: no se sabe cuál es cuál. No se escribió nada." >&2; exit 2; }
if [[ "$ENTORNO" == produccion ]]; then ID_ELEGIDO="$ID_PROD"; CONFIG_ELEGIDA="$CONFIG_PROD"; else ID_ELEGIDO="$ID_STG"; CONFIG_ELEGIDA="$CONFIG_STG"; fi

ARGS=(--proyecto "$ID_ELEGIDO" --tenant "$TENANT")
RESPALDO=""
if [[ -n "$REVERTIR" ]]; then
  ARGS+=(--revertir --respaldo "$REVERTIR")
else
  if (( DESACTIVAR )); then ARGS+=(--desactivar); else ARGS+=(--monedas "$MONEDAS"); fi
  if (( CREAR )); then ARGS+=(--crear-documento); fi
  if (( APLICAR )); then
    preparar_carpeta
    RESPALDO="$DIR_RESPALDOS/${ENTORNO}_${TENANT}_$(date -u +%Y%m%dT%H%M%SZ)_$$.json"
    ARGS+=(--respaldo "$RESPALDO")
  fi
fi
if (( APLICAR )); then
  ARGS+=(--aplicar)
  if [[ "$ENTORNO" == produccion ]]; then ARGS+=(--confirmo-produccion "$TENANT"); fi
fi

# El script de nodo vive en admin/ (ahí está firebase-admin). Su salida pasa por el filtro que oculta los ids.
set +e
( cd admin && \
  GCP_PROJECT_ID_PROD="$ID_PROD" GCP_PROJECT_ID_STAGING="$ID_STG" \
  GOOGLE_APPLICATION_CREDENTIALS="$CONFIG_ELEGIDA/application_default_credentials.json" \
  node scripts/plataforma/aplicar-catalogo-externo.mjs "${ARGS[@]}" 2>&1 ) \
  | ID_A="$ID_PROD" ID_B="$ID_STG" python3 -I -c '
import sys, os
t = sys.stdin.read()
for k in ("ID_A", "ID_B"):
    if os.environ[k]:
        t = t.replace(os.environ[k], "<proyecto>")
sys.stdout.write(t)
'
ESTADOS=("${PIPESTATUS[@]}")
set -e
if (( APLICAR )) && [[ -z "$REVERTIR" && "${ESTADOS[0]}" -eq 0 ]]; then echo "Respaldo para revertir: $RESPALDO"; fi
exit "${ESTADOS[0]}"
