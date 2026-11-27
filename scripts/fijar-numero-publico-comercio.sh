#!/usr/bin/env bash
# Fija (o quita) el NÚMERO PÚBLICO de la línea de UN comercio (`rutasWhatsApp/<phoneNumberId>.numeroPublico`, el de «Volver al chat» del
# catálogo web). Envoltorio de `admin/scripts/modulos/catalogo-web/fijar-numero-publico.mjs` SIN que nadie escriba, vea ni pegue el
# proyecto, el phone_number_id ni el número: todo se lee DENTRO del proceso (ver `scripts/lib/valores-del-comercio.sh`) y nada se imprime.
#
#   ./scripts/fijar-numero-publico-comercio.sh --tenant <comercio> --entorno staging|produccion
#       SECO (por omisión): lee y muestra «antes → después» con el número reducido a sus últimas cuatro cifras. No escribe.
#   ./scripts/fijar-numero-publico-comercio.sh --tenant <comercio> --entorno E --aplicar --confirmo <comercio>
#       Escribe SOLO `numeroPublico` y deja constancia en la auditoría. `--confirmo` repite el comercio, escrito a mano.
#   ./scripts/fijar-numero-publico-comercio.sh --tenant <comercio> --entorno E --quitar [--aplicar --confirmo <comercio>]
#       La vuelta atrás: borra ese campo (sin él la página no ofrece «Volver al chat»).
#
# DE DÓNDE SALE CADA VALOR (ninguno se imprime ni va por la línea de comandos):
#   · proyecto        → quota_project_id de las credenciales de gcloud del entorno;
#   · phone_number_id → `tenants/<comercio>.waPhoneNumberId` (lo resuelve el script de nodo; el comercio tiene que estar activo);
#   · número público  → la fila `REEMPLAZAR_NUMERO_PUBLICO_<COMERCIO>` de la tabla local (CONFIGURACION.local.md), solo dígitos con el
#                       prefijo del país, sin «+» (8 a 15; si empieza por 591, 11); la fila se agrega con `scripts/marcador-local.sh`;
#   · operador        → NOVUCHAT_OPERADOR, o la cuenta de gcloud del entorno (queda en la auditoría; no se imprime).
# Salida: la del script de nodo; 2 uso o salvaguarda (nada escrito); 3 falta un valor local o no se pudo leer.
set -euo pipefail
case "$-" in *x*) echo "✗ xtrace activo: no se escribió nada." >&2; exit 2 ;; esac
[[ "${SHELLOPTS:-}" != *xtrace* ]] || { echo "✗ SHELLOPTS=xtrace en el entorno: no se escribió nada." >&2; exit 2; }
set +x
ESTE="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$ESTE")/.." || exit 1
# shellcheck source=lib/valores-del-comercio.sh
source "scripts/lib/valores-del-comercio.sh"
ayuda() { awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$ESTE"; }

TENANT=""; ENTORNO=""; APLICAR=0; CONFIRMO=""; QUITAR=0
necesita() { [[ $# -ge 2 ]] || { echo "✗ $1 requiere un valor" >&2; exit 2; }; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tenant)   necesita "$@"; TENANT="$2"; shift 2 ;;
    --entorno)  necesita "$@"; ENTORNO="$2"; shift 2 ;;
    --aplicar)  APLICAR=1; shift ;;
    --confirmo) necesita "$@"; CONFIRMO="$2"; shift 2 ;;
    --quitar)   QUITAR=1; shift ;;
    -h|--help)  ayuda; exit 0 ;;
    *) echo "✗ Opción desconocida (ver --help)" >&2; exit 2 ;;
  esac
done
[[ "$TENANT" =~ ^[a-z0-9][a-z0-9-]{2,59}$ ]] || { echo "✗ --tenant: id de comercio (minúsculas, dígitos y guiones)" >&2; exit 2; }
[[ "$ENTORNO" == staging || "$ENTORNO" == produccion ]] || { echo "✗ --entorno: staging o produccion" >&2; exit 2; }
if (( APLICAR )); then
  [[ "$CONFIRMO" == "$TENANT" ]] || { echo "✗ --aplicar exige --confirmo <comercio> (el mismo, escrito a mano). No se escribió nada." >&2; exit 2; }
elif [[ -n "$CONFIRMO" ]]; then
  echo "✗ --confirmo solo va con --aplicar" >&2; exit 2
fi
[[ ! "$TENANT" =~ ^(novuchat.*|ensayo|demo(-.*)?)$ ]] || { echo "✗ --tenant: los demos y NovuChat no se tocan con este envoltorio" >&2; exit 2; }

resolver_proyecto "$ENTORNO"

# El operador: queda en la auditoría de la ruta. Sale del entorno o de la cuenta de gcloud; nunca se imprime.
OPERADOR_CORREO="${NOVUCHAT_OPERADOR:-}"
if [[ -z "$OPERADOR_CORREO" ]] && command -v gcloud >/dev/null 2>&1; then
  OPERADOR_CORREO="$(CLOUDSDK_CONFIG="${NOVUCHAT_GCLOUD_PROD:-$HOME/.config/gcloud-novuchat-prod}" gcloud config list account --format='value(core.account)' 2>/dev/null || true)"
fi
[[ "$OPERADOR_CORREO" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || { echo "✗ no se pudo determinar el operador (NOVUCHAT_OPERADOR o la cuenta de gcloud)" >&2; exit 3; }
export NUMERO_OPERADOR="$OPERADOR_CORREO"

ARGS=(--proyecto-env FIJAR_PROYECTO --tenant "$TENANT" --operador-env NUMERO_OPERADOR)
NUMERO=""
if (( QUITAR )); then
  ARGS+=(--quitar)
else
  CLAVE="REEMPLAZAR_NUMERO_PUBLICO_$(printf '%s' "$TENANT" | tr 'a-z-' 'A-Z_')"
  NUMERO="$(valor_de_tabla "$CLAVE")" || { echo "✗ la tabla local no tiene la fila $CLAVE (o está pendiente): agréguela con scripts/marcador-local.sh" >&2; exit 3; }
  [[ "$NUMERO" =~ ^[1-9][0-9]{7,14}$ ]] || { echo "✗ el valor de $CLAVE tiene que ser solo dígitos con el prefijo del país (8 a 15), sin +" >&2; exit 3; }
  # Las mismas negativas del script de nodo (un local boliviano sin prefijo, o un 591 que no tiene 11 dígitos, llevarían el enlace a nadie).
  { [[ ! "$NUMERO" =~ ^[67][0-9]{7}$ ]] && { [[ "$NUMERO" != 591* ]] || [[ "${#NUMERO}" -eq 11 ]]; }; } \
    || { echo "✗ el valor de $CLAVE no es un número internacional completo (falta el prefijo del país, o el 591 no tiene 11 dígitos)" >&2; exit 3; }
  export NUMERO_PUBLICO_LINEA="$NUMERO"
  ARGS+=(--numero-env NUMERO_PUBLICO_LINEA)
fi
if (( APLICAR )); then ARGS+=(--aplicar); fi
OTRO="$ID_PROD"; if [[ "$ENTORNO" == produccion ]]; then OTRO="$ID_STG"; fi

set +e
( cd admin && node scripts/modulos/catalogo-web/fijar-numero-publico.mjs "${ARGS[@]}" 2>&1 ) | filtrar_valores "$FIJAR_PROYECTO" "$NUMERO" "$OPERADOR_CORREO" "$OTRO"
ESTADOS=("${PIPESTATUS[@]}")
set -e
exit "${ESTADOS[0]}"
