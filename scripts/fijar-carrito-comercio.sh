#!/usr/bin/env bash
# Fija (o quita) a dónde avisa NovuChat cuando llega un carrito del catálogo web de UN comercio: `rutasWhatsApp/<phoneNumberId>.webhookCarrito`.
# Envoltorio de `admin/scripts/plataforma/fijar-webhook-carrito.mjs` SIN que nadie escriba, vea ni pegue el proyecto, el phone_number_id, la
# ruta secreta del carrito ni el host de n8n: todo se lee DENTRO del proceso (ver `scripts/lib/valores-del-comercio.sh`) y nada se imprime.
#
#   ./scripts/fijar-carrito-comercio.sh --tenant <comercio> --entorno staging|produccion
#       SECO (por omisión): lee y muestra «antes → después» con la URL enmascarada. No escribe.
#   ./scripts/fijar-carrito-comercio.sh --tenant <comercio> --entorno E --aplicar --confirmo <comercio>
#       Escribe SOLO `webhookCarrito` de la ruta del comercio. `--confirmo` tiene que repetir el comercio, escrito a mano.
#   ./scripts/fijar-carrito-comercio.sh --tenant <comercio> --entorno E --quitar [--aplicar --confirmo <comercio>]
#       La vuelta atrás: borra ese campo (apaga la derivación del carrito) sin tocar el resto de la ruta.
#
# DE DÓNDE SALE CADA VALOR (ninguno se imprime ni va por la línea de comandos):
#   · proyecto        → quota_project_id de las credenciales de gcloud del entorno (producción/staging; deben ser distintos);
#   · phone_number_id → `tenants/<comercio>.waPhoneNumberId` (el comercio tiene que estar activo);
#   · ruta secreta    → la fila `REEMPLAZAR_RUTA_CARRITO_<COMERCIO>` de la tabla local (CONFIGURACION.local.md);
#   · host de n8n     → `N8N_BASE_URL` del `.env` del comercio (ENV_N8N, o ~/NovuChat/.env.<comercio>-prod).
#   La URL es https://<host>/webhook/<ruta> y llega al script de nodo por una variable de entorno de ESE proceso.
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
[[ ! "$TENANT" =~ ^(novuchat|ensayo|demo-.*)$ ]] || { echo "✗ --tenant: los demos y NovuChat no se tocan con este envoltorio" >&2; exit 2; }

resolver_proyecto "$ENTORNO"

CLAVE_RUTA="REEMPLAZAR_RUTA_CARRITO_$(printf '%s' "$TENANT" | tr 'a-z-' 'A-Z_')"
ARGS=(--proyecto-env FIJAR_PROYECTO --tenant "$TENANT")
RUTA=""; BASE=""
if (( QUITAR )); then
  ARGS+=(--quitar)
else
  RUTA="$(valor_de_tabla "$CLAVE_RUTA")" || { echo "✗ la tabla local no tiene la fila $CLAVE_RUTA (o está pendiente): sin ella no hay a dónde avisar" >&2; exit 3; }
  [[ "$RUTA" =~ ^[A-Za-z0-9_-]{8,120}$ ]] || { echo "✗ el valor de $CLAVE_RUTA no tiene forma de ruta de webhook de n8n (8 a 120 caracteres: letras, dígitos, «_» y «-»)" >&2; exit 3; }
  ENV_N8N="${ENV_N8N:-$RAIZ_LOCAL/.env.$TENANT-prod}"
  BASE="$(valor_del_env N8N_BASE_URL "$ENV_N8N")" || true
  [[ -n "$BASE" ]] || { echo "✗ no se pudo leer N8N_BASE_URL del .env del comercio" >&2; exit 3; }
  BASE="${BASE%/}"
  [[ "$BASE" =~ ^https://[A-Za-z0-9.-]+(:[0-9]{2,5})?$ ]] || { echo "✗ N8N_BASE_URL tiene que ser https://<host> sin ruta ni credenciales" >&2; exit 3; }
  export CARRITO_URL_N8N="$BASE/webhook/$RUTA"
  ARGS+=(--url-env CARRITO_URL_N8N)
fi
if (( APLICAR )); then ARGS+=(--aplicar); fi
OTRO="$ID_PROD"; if [[ "$ENTORNO" == produccion ]]; then OTRO="$ID_STG"; fi

# El script de nodo vive en admin/ (ahí está firebase-admin). Su salida pasa por el filtro que oculta cualquier valor real.
set +e
( cd admin && node scripts/plataforma/fijar-webhook-carrito.mjs "${ARGS[@]}" 2>&1 ) | filtrar_valores "$FIJAR_PROYECTO" "$RUTA" "$BASE" "$OTRO"
ESTADOS=("${PIPESTATUS[@]}")
set -e
exit "${ESTADOS[0]}"
