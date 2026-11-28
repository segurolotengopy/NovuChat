#!/bin/bash -p
# Enciende o apaga el ENVÍO DE LA NOTA DEL CLIENTE A NOVUTIENDA de UN comercio (`tenants/<comercio>/config/pedidos.notaANovuTienda`).
# Envoltorio de `admin/scripts/modulos/pedidos/fijar-nota-novutienda.mjs` SIN que nadie escriba, vea ni pegue el proyecto: se lee DENTRO del
# proceso (ver `scripts/lib/valores-del-comercio.sh`), llega al script de nodo por variables de entorno de ESE proceso y nada se imprime.
#
#   ./scripts/fijar-nota-novutienda-comercio.sh --tenant <comercio> --entorno staging|produccion --activar|--desactivar
#       SECO (por omisión): lee y muestra «hoy → después» del campo. No escribe.
#   ./scripts/fijar-nota-novutienda-comercio.sh --tenant <comercio> --entorno E --activar|--desactivar --aplicar --confirmo <comercio>
#       Escribe SOLO `notaANovuTienda` (con auditoría). `--confirmo` repite el comercio, escrito a mano. Guarda el respaldo del valor previo
#       (o de su ausencia) en una carpeta temporal 0700 FUERA del repositorio y dice dónde queda: BÓRRELO al cerrar (sirve para --revertir).
#       En PRODUCCIÓN, `--activar --aplicar` exige además `--novutienda-acepta-nota`: se pasa SOLO tras el aviso escrito de NovuTienda de que
#       ya acepta el campo `nota` y lo muestra como texto (antes rechaza con 400). Sin esa opción: salida 2 y nada escrito. Staging no la exige.
#   ./scripts/fijar-nota-novutienda-comercio.sh --tenant <comercio> --entorno E --revertir <ruta del respaldo> [--aplicar --confirmo <comercio>]
#       La vuelta atrás: restaura el valor previo (o elimina el campo si no existía), si nadie lo cambió después.
#
# NovuTienda rechaza con 400 una clave desconocida: NO se enciende hasta que NovuTienda avise y confirme cómo muestra la nota (ver
# docs/arquitectura/modulos/pedidos.md). Se rechazan los demos, el ensayo y NovuChat. Salida: la del script de nodo; 2 uso o salvaguarda
# (nada escrito); 3 no se pudo resolver el proyecto.
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
case "$-" in *x*) echo "✗ xtrace activo: no se escribió nada." >&2; exit 2 ;; esac
[[ "${SHELLOPTS:-}" != *xtrace* ]] || { echo "✗ SHELLOPTS=xtrace en el entorno: no se escribió nada." >&2; exit 2; }
set +x
ESTE="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$ESTE")/.." || exit 1
# shellcheck source=lib/valores-del-comercio.sh
source "scripts/lib/valores-del-comercio.sh"
ayuda() { awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$ESTE"; }

TENANT=""; ENTORNO=""; APLICAR=0; CONFIRMO=""; ACTIVAR=0; DESACTIVAR=0; REVERTIR=0; RESPALDO_REVERTIR=""; ACEPTA_NOTA=0
necesita() { [[ $# -ge 2 ]] || { echo "✗ $1 requiere un valor" >&2; exit 2; }; }
# Una opción repetida se rechaza (la segunda no pisa a la primera en silencio).
declare -A VISTAS=()
una_vez() { [[ -z "${VISTAS[$1]:-}" ]] || { echo "✗ opción repetida: $1" >&2; exit 2; }; VISTAS[$1]=1; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tenant)     una_vez --tenant; necesita "$@"; TENANT="$2"; shift 2 ;;
    --entorno)    una_vez --entorno; necesita "$@"; ENTORNO="$2"; shift 2 ;;
    --activar)    una_vez --activar; ACTIVAR=1; shift ;;
    --desactivar) una_vez --desactivar; DESACTIVAR=1; shift ;;
    --revertir)   una_vez --revertir; necesita "$@"; REVERTIR=1; RESPALDO_REVERTIR="$2"; shift 2 ;;
    --aplicar)    una_vez --aplicar; APLICAR=1; shift ;;
    --confirmo)   una_vez --confirmo; necesita "$@"; CONFIRMO="$2"; shift 2 ;;
    --novutienda-acepta-nota) una_vez --novutienda-acepta-nota; ACEPTA_NOTA=1; shift ;;
    -h|--help)    ayuda; exit 0 ;;
    *) echo "✗ Opción desconocida (ver --help)" >&2; exit 2 ;;
  esac
done
[[ "$TENANT" =~ ^[a-z0-9][a-z0-9-]{2,59}$ ]] || { echo "✗ --tenant: id de comercio (minúsculas, dígitos y guiones)" >&2; exit 2; }
[[ "$ENTORNO" == staging || "$ENTORNO" == produccion ]] || { echo "✗ --entorno: staging o produccion" >&2; exit 2; }
(( ACTIVAR + DESACTIVAR + REVERTIR == 1 )) || { echo "✗ use exactamente UNO de --activar, --desactivar o --revertir <respaldo> (son excluyentes)" >&2; exit 2; }
if (( REVERTIR )); then
  [[ "$RESPALDO_REVERTIR" =~ ^/[A-Za-z0-9._/-]+$ && "$RESPALDO_REVERTIR" != *..* ]] || { echo "✗ --revertir: ruta absoluta del respaldo (sin «..»)" >&2; exit 2; }
fi
(( ! ACEPTA_NOTA || ACTIVAR )) || { echo "✗ --novutienda-acepta-nota solo va con --activar" >&2; exit 2; }
if (( ACTIVAR && APLICAR )) && [[ "$ENTORNO" == produccion ]] && (( ! ACEPTA_NOTA )); then
  echo "✗ En producción, --activar --aplicar exige --novutienda-acepta-nota (solo tras el aviso escrito de NovuTienda de que ya acepta «nota»). No se escribió nada." >&2; exit 2
fi
if (( APLICAR )); then
  [[ "$CONFIRMO" == "$TENANT" ]] || { echo "✗ --aplicar exige --confirmo <comercio> (el mismo, escrito a mano). No se escribió nada." >&2; exit 2; }
elif [[ -n "$CONFIRMO" ]]; then
  echo "✗ --confirmo solo va con --aplicar" >&2; exit 2
fi
[[ ! "$TENANT" =~ ^(novuchat.*|ensayo|demo(-.*)?)$ ]] || { echo "✗ --tenant: los demos y NovuChat no llevan este dato" >&2; exit 2; }

resolver_proyecto "$ENTORNO"
# El script de nodo toma el id del proyecto de la lista blanca del ENTORNO de su proceso (`--entorno`), nunca de la línea de comandos.
export GCP_PROJECT_ID_STAGING="$ID_STG" GCP_PROJECT_ID_PROD="$ID_PROD"

DIR=""
ARGS=(--entorno "$ENTORNO" --tenant "$TENANT")
if (( ACTIVAR )); then ARGS+=(--activar); fi
if (( DESACTIVAR )); then ARGS+=(--desactivar); fi
if (( REVERTIR )); then ARGS+=(--revertir --respaldo "$RESPALDO_REVERTIR"); fi
if (( APLICAR )); then
  ARGS+=(--aplicar --confirmo "$CONFIRMO")
  if (( ! REVERTIR )); then
    # El respaldo guarda solo el valor previo del campo (o su ausencia): carpeta temporal 0700 FUERA del repositorio; lo borra el operador al cerrar.
    DIR="$(mktemp -d /tmp/nota-novutienda.XXXXXX)"; chmod 700 "$DIR"
    ARGS+=(--respaldo "$DIR/respaldo.json")
  fi
fi

set +e
( cd admin && "$NODO" scripts/modulos/pedidos/fijar-nota-novutienda.mjs "${ARGS[@]}" 2>&1 ) | filtrar_valores "$ID_PROD" "$ID_STG"
ESTADOS=("${PIPESTATUS[@]}")
set -e
if [[ -n "$DIR" ]]; then
  if [[ -f "$DIR/respaldo.json" ]]; then
    echo "• Respaldo del valor previo: $DIR/respaldo.json — para deshacer: --revertir con esa ruta; bórrelo al cerrar."
  else
    rmdir "$DIR" 2>/dev/null || true
    echo "• No se guardó respaldo (no hubo nada que escribir, o se rechazó antes): no hay nada que deshacer." >&2
  fi
fi
exit "${ESTADOS[0]}"
