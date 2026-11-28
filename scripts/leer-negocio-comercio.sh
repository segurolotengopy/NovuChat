#!/bin/bash -p
# LEE UN CAMPO PÚBLICO de `tenants/<comercio>/config/negocio`. SOLO LECTURA: no existe `--aplicar` ni forma de escribir.
# Envoltorio de `admin/scripts/plataforma/leer-config-negocio.mjs` SIN que nadie escriba, vea ni pegue el proyecto: se lee DENTRO del proceso
# (ver `scripts/lib/valores-del-comercio.sh`) y nada del proyecto se imprime.
#
#   ./scripts/leer-negocio-comercio.sh --tenant <comercio> --entorno staging|produccion --campo <campo> [--esperado <url>]
#
# LISTA CERRADA de campos (datos públicos, no secretos): enlaceCatalogo, ubicacionTienda, mapaTienda, horarioTienda. Cualquier otro se rechaza
# ANTES de leer. Con `enlaceCatalogo` imprime la URL (es pública) y tres comprobaciones: «sin barra final», «empieza por https://» y, si se pasa
# `--esperado <url>`, «es exactamente igual a la URL esperada». Salida: 0 todo bien; 1 no existe el documento o el campo, o falla una
# comprobación; 2 uso o salvaguarda (nada leído); 3 no se pudo resolver el proyecto.
case "$-" in *p*) ;; *) exec /bin/bash -p -- "$0" "$@" ;; esac
# H4 (revisión de #1141): el arranque no hereda comportamiento del entorno de quien llama: modo privilegiado (-p: ni BASH_ENV ni funciones importadas),
# sin BASH_ENV/ENV, sin funciones, y un PATH de sistema fijo. Los ejecutables que hacen falta se resuelven ANTES por ruta absoluta.
unset BASH_ENV ENV
while IFS= read -r f; do builtin unset -f "$f"; done < <(compgen -A function)
NODO="$(command -v node || true)"
[[ "$NODO" == /* && -x "$NODO" ]] || { echo "✗ No encuentro node (ruta absoluta y ejecutable)" >&2; exit 2; }
PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"; export PATH
hash -r
set -euo pipefail
case "$-" in *x*) echo "✗ xtrace activo: no se leyó nada." >&2; exit 2 ;; esac
[[ "${SHELLOPTS:-}" != *xtrace* ]] || { echo "✗ SHELLOPTS=xtrace en el entorno: no se leyó nada." >&2; exit 2; }
set +x
ESTE="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$ESTE")/.." || exit 1
# shellcheck source=lib/valores-del-comercio.sh
source "scripts/lib/valores-del-comercio.sh"
ayuda() { awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$ESTE"; }

TENANT=""; ENTORNO=""; CAMPO=""; ESPERADO=""; CON_ESPERADO=0
necesita() { [[ $# -ge 2 ]] || { echo "✗ $1 requiere un valor" >&2; exit 2; }; }
# Una opción repetida se rechaza (la segunda no pisa a la primera en silencio).
declare -A VISTAS=()
una_vez() { [[ -z "${VISTAS[$1]:-}" ]] || { echo "✗ opción repetida: $1" >&2; exit 2; }; VISTAS[$1]=1; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tenant)   una_vez --tenant; necesita "$@"; TENANT="$2"; shift 2 ;;
    --entorno)  una_vez --entorno; necesita "$@"; ENTORNO="$2"; shift 2 ;;
    --campo)    una_vez --campo; necesita "$@"; CAMPO="$2"; shift 2 ;;
    --esperado) una_vez --esperado; necesita "$@"; ESPERADO="$2"; CON_ESPERADO=1; shift 2 ;;
    -h|--help)  ayuda; exit 0 ;;
    *) echo "✗ Opción desconocida (este envoltorio solo lee; ver --help)" >&2; exit 2 ;;
  esac
done
[[ "$TENANT" =~ ^[a-z0-9][a-z0-9-]{2,59}$ ]] || { echo "✗ --tenant: id de comercio (minúsculas, dígitos y guiones)" >&2; exit 2; }
[[ "$ENTORNO" == staging || "$ENTORNO" == produccion ]] || { echo "✗ --entorno: staging o produccion" >&2; exit 2; }
case "$CAMPO" in
  enlaceCatalogo|ubicacionTienda|mapaTienda|horarioTienda) ;;
  *) echo "✗ --campo: solo enlaceCatalogo, ubicacionTienda, mapaTienda u horarioTienda. No se leyó nada." >&2; exit 2 ;;
esac
if (( CON_ESPERADO )); then
  [[ "$CAMPO" == enlaceCatalogo ]] || { echo "✗ --esperado solo vale con --campo enlaceCatalogo" >&2; exit 2; }
  [[ "$ESPERADO" =~ ^https://[^/[:space:]][^[:space:]]{0,1999}$ ]] || { echo "✗ --esperado: una URL https:// con host y sin espacios" >&2; exit 2; }
fi
[[ ! "$TENANT" =~ ^(novuchat.*|ensayo|demo(-.*)?)$ ]] || { echo "✗ --tenant: los demos y NovuChat no se leen con este envoltorio" >&2; exit 2; }

resolver_proyecto "$ENTORNO"
# El script de nodo toma el id del proyecto de la lista blanca del ENTORNO de su proceso (`--entorno`), nunca de la línea de comandos.
export GCP_PROJECT_ID_STAGING="$ID_STG" GCP_PROJECT_ID_PROD="$ID_PROD"

ARGS=(--entorno "$ENTORNO" --tenant "$TENANT" --campo "$CAMPO")
if (( CON_ESPERADO )); then ARGS+=(--esperado "$ESPERADO"); fi

set +e
( cd admin && "$NODO" scripts/plataforma/leer-config-negocio.mjs "${ARGS[@]}" 2>&1 ) | filtrar_valores "$ID_PROD" "$ID_STG"
ESTADOS=("${PIPESTATUS[@]}")
set -e
exit "${ESTADOS[0]}"
