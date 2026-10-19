#!/usr/bin/env bash
# =============================================================================
# marcador-desde-archivo.sh — copia un identificador desde un archivo local de
# CLIENTES/ a una fila de CONFIGURACION.local.md SIN MOSTRAR NUNCA SU VALOR.
#
# POR QUÉ EXISTE. El timbre de «Tomar» (`cargar-timbre-n8n.sh`) ata las
# credenciales de cada alias al `phoneNumberId` de su fila de la tabla
# (`REEMPLAZAR_PHONE_NUMBER_ID_CLIENTE05`) y aborta sin ella. El identificador de
# la línea del cliente vive en `CLIENTES/<CLIENTE>/<cuenta>/ids-meta.local.md`
# (línea `- phone_number_id: …`), y los dos archivos están fuera del alcance de la
# sesión (CONFIGURACION.local.md está en `deny`; el valor no debe pasar por el chat).
# Escribirlo a mano es lo que el procedimiento quiere evitar. Este paso lo hace una
# sola vez, revisado, y delega la escritura en `marcador-local.sh` (que ya valida la
# forma, respalda y no pisa filas existentes).
#
# USO (SECO por omisión: no escribe nada)
#   ./scripts/marcador-desde-archivo.sh --marcador REEMPLAZAR_PHONE_NUMBER_ID_CLIENTE05 \
#       --de CLIENTES/RUBEN_ROCA/Ruben/ids-meta.local.md --clave phone_number_id
#   ... --aplicar                 agrega la fila (nunca pisa una existente)
#   ... --aplicar --reemplazar    cambia el valor de una fila que ya existe (respaldo 600)
#
# QUÉ GARANTIZA, cada línea con una prueba que la niega
# (`admin/pruebas/core/marcador-desde-archivo.test.ts`):
#   · el valor NUNCA se imprime (ni en seco, ni al aplicar, ni en un error) y nunca
#     viaja por argumentos: pasa a `marcador-local.sh` por el entorno;
#   · el archivo de origen tiene que estar DENTRO de CLIENTES/ (ruta real, sin
#     enlaces simbólicos), ser un archivo común del usuario, llamarse `*.local.md` y
#     no ser escribible por otros;
#   · solo se puede copiar una clave de la lista cerrada (`phone_number_id`,
#     `waba_id`, `media_id_qr`), y debe haber UNA línea `- <clave>: <valor>` exacta:
#     ninguna o varias, se aborta sin escribir;
#   · el marcador debe tener la forma `REEMPLAZAR_…` y la clave debe corresponder a
#     su nombre (un PHONE_NUMBER_ID no recibe un waba_id);
#   · el valor es solo dígitos (10 a 20) antes de entregarlo.
# Salidas: 0 hecho o seco sin problemas · 1 el valor no se pudo tomar o validar ·
# 2 uso o salvaguarda (nada escrito).
# =============================================================================
set -euo pipefail
set +x
umask 077

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ_CLIENTES="${CLIENTES_RAIZ:-$HOME/NovuChat/CLIENTES}"
MARCADOR="" ; DE="" ; CLAVE="" ; APLICAR=0 ; REEMPLAZAR=0

while [ $# -gt 0 ]; do
  case "$1" in
    --marcador)   MARCADOR="${2:-}"; shift 2 ;;
    --de)         DE="${2:-}";       shift 2 ;;
    --clave)      CLAVE="${2:-}";    shift 2 ;;
    --aplicar)    APLICAR=1;         shift ;;
    --reemplazar) REEMPLAZAR=1;      shift ;;
    *) echo "✗ Argumento desconocido: $1" >&2; exit 2 ;;
  esac
done

[ -n "$MARCADOR" ] && [ -n "$DE" ] && [ -n "$CLAVE" ] \
  || { echo "✗ Faltan --marcador, --de o --clave." >&2; exit 2; }
printf '%s' "$MARCADOR" | grep -Eq '^REEMPLAZAR_[A-Z0-9_]+$' \
  || { echo "✗ Un marcador es REEMPLAZAR_ seguido de MAYÚSCULAS, dígitos y guiones bajos." >&2; exit 2; }

# La clave sale de una lista cerrada y tiene que corresponder al nombre del marcador.
case "$CLAVE" in
  phone_number_id) case "$MARCADOR" in *PHONE_NUMBER_ID*) ;; *) echo "✗ La clave phone_number_id solo va a un marcador *PHONE_NUMBER_ID*." >&2; exit 2 ;; esac ;;
  waba_id)         case "$MARCADOR" in *WABA*) ;; *) echo "✗ La clave waba_id solo va a un marcador *WABA*." >&2; exit 2 ;; esac ;;
  media_id_qr)     case "$MARCADOR" in *MEDIA_ID*) ;; *) echo "✗ La clave media_id_qr solo va a un marcador *MEDIA_ID*." >&2; exit 2 ;; esac ;;
  *) echo "✗ Clave no permitida (phone_number_id, waba_id o media_id_qr)." >&2; exit 2 ;;
esac

# El archivo de origen: ruta real dentro de CLIENTES/, común, propio y `*.local.md`.
[ ! -L "$DE" ] || { echo "✗ El archivo de origen no puede ser un enlace simbólico." >&2; exit 2; }
[ -f "$DE" ]   || { echo "✗ No existe el archivo de origen." >&2; exit 2; }
REAL="$(readlink -f -- "$DE")"
BASE="$(readlink -f -- "$RAIZ_CLIENTES")"
case "$REAL" in "$BASE"/*) ;; *) echo "✗ El archivo de origen tiene que estar dentro de CLIENTES/." >&2; exit 2 ;; esac
case "$REAL" in *.local.md) ;; *) echo "✗ El archivo de origen tiene que llamarse *.local.md." >&2; exit 2 ;; esac
[ "$(stat -c '%u' -- "$REAL")" = "$(id -u)" ] || { echo "✗ El archivo de origen no es del usuario." >&2; exit 2; }
modo="$(stat -c '%a' -- "$REAL")"
case "$modo" in *[2367]) echo "✗ El archivo de origen es escribible por otros (modo $modo)." >&2; exit 2 ;; esac
case "${modo: -2:1}" in [2367]) echo "✗ El archivo de origen es escribible por el grupo (modo $modo)." >&2; exit 2 ;; esac

# UNA línea `- <clave>: <valor>` exacta. Nunca se imprime lo leído.
n="$(grep -Ec "^- ${CLAVE}: *[^[:space:]]+ *\$" -- "$REAL" || true)"
[ "$n" = "1" ] || { echo "✗ Se esperaba UNA línea «- ${CLAVE}: …» y hay $n: no se escribe nada." >&2; exit 1; }
VALOR="$(sed -n -E "s/^- ${CLAVE}: *([^[:space:]]+) *\$/\1/p" -- "$REAL")"
printf '%s' "$VALOR" | grep -Eq '^[0-9]{10,20}$' \
  || { echo "✗ El valor de ${CLAVE} no tiene forma de identificador (solo dígitos, 10 a 20): no se escribe nada." >&2; exit 1; }

if [ "$APLICAR" -eq 0 ]; then
  existe="no"
  "$AQUI/marcador-local.sh" --verificar "$MARCADOR" >/dev/null 2>&1 && existe="sí"
  echo "Seco: ${CLAVE} se leyó con forma válida (valor no mostrado)."
  echo "  Marcador ${MARCADOR}: ya está en la tabla: ${existe}."
  if [ "$existe" = "sí" ]; then echo "  Con --aplicar no se pisa; para cambiarlo, --aplicar --reemplazar."; else echo "  Con --aplicar se agrega la fila."; fi
  exit 0
fi

# Aplicar: el valor viaja por el ENTORNO, no por argumentos; marcador-local.sh valida,
# respalda y escribe sin mostrarlo.
if [ "$REEMPLAZAR" -eq 1 ]; then
  MARCADOR_VALOR="$VALOR" "$AQUI/marcador-local.sh" --marcador "$MARCADOR" --reemplazar
else
  MARCADOR_VALOR="$VALOR" "$AQUI/marcador-local.sh" --marcador "$MARCADOR" --nota "copiado de CLIENTES/ (ids-meta.local.md)"
fi
