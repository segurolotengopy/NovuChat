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
#       --de CLIENTES/RUBEN_ROCA/Ruben/ids-meta.local.md --clave phone_number_id --cliente RUBEN_ROCA
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
# OJO: con --aplicar sobre una fila que YA existe y sin --reemplazar no se escribe nada y la salida es 0
# (el mensaje lo dice); quien automatice debe leer el mensaje o usar --reemplazar.
# Salidas: 0 hecho o seco sin problemas · 1 el valor no se pudo tomar o validar ·
# 2 uso o salvaguarda (nada escrito).
# =============================================================================
set -euo pipefail
set +x
umask 077

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Las rutas son FIJAS. Solo la suite de pruebas (NOVUCHAT_PRUEBAS=1) puede cambiarlas por
# CLIENTES_RAIZ y CONFIG_LOCAL: si no, quien invoque podría ensanchar la raíz permitida y usar
# este script como oráculo sobre archivos fuera de CLIENTES/.
if [ "${NOVUCHAT_PRUEBAS:-}" = "1" ]; then
  RAIZ_CLIENTES="${CLIENTES_RAIZ:-$HOME/NovuChat/CLIENTES}"
  LOCAL="${CONFIG_LOCAL:-$HOME/NovuChat/CONFIGURACION.local.md}"
else
  RAIZ_CLIENTES="$HOME/NovuChat/CLIENTES"
  LOCAL="$HOME/NovuChat/CONFIGURACION.local.md"
fi
MARCADOR="" ; DE="" ; CLAVE="" ; CLIENTE="" ; APLICAR=0 ; REEMPLAZAR=0

while [ $# -gt 0 ]; do
  case "$1" in
    --marcador)   MARCADOR="${2:-}"; shift 2 ;;
    --de)         DE="${2:-}";       shift 2 ;;
    --clave)      CLAVE="${2:-}";    shift 2 ;;
    --cliente)    CLIENTE="${2:-}";  shift 2 ;;
    --aplicar)    APLICAR=1;         shift ;;
    --reemplazar) REEMPLAZAR=1;      shift ;;
    *) echo "✗ Argumento desconocido: $1" >&2; exit 2 ;;
  esac
done

[ -n "$MARCADOR" ] && [ -n "$DE" ] && [ -n "$CLAVE" ] && [ -n "$CLIENTE" ] \
  || { echo "✗ Faltan --marcador, --de, --clave o --cliente." >&2; exit 2; }
printf '%s' "$CLIENTE" | grep -Eq '^[A-Z0-9_]+$' \
  || { echo "✗ --cliente es la carpeta de CLIENTES/ (mayúsculas, dígitos y guiones bajos)." >&2; exit 2; }
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
case "$REAL" in "$BASE/$CLIENTE"/*) ;; *) echo "✗ El archivo de origen tiene que estar dentro de CLIENTES/$CLIENTE/." >&2; exit 2 ;; esac
case "$REAL" in *.local.md) ;; *) echo "✗ El archivo de origen tiene que llamarse *.local.md." >&2; exit 2 ;; esac
[ "$(stat -c '%u' -- "$REAL")" = "$(id -u)" ] || { echo "✗ El archivo de origen no es del usuario." >&2; exit 2; }
modo="$(printf '%03d' "$(stat -c '%a' -- "$REAL")")"
case "${modo: -1}" in [2367]) echo "✗ El archivo de origen es escribible por otros (modo $modo)." >&2; exit 2 ;; esac
case "${modo: -2:1}" in [2367]) echo "✗ El archivo de origen es escribible por el grupo (modo $modo)." >&2; exit 2 ;; esac

# UNA sola apertura: se abre el descriptor, se comprueba que sigue siendo el mismo archivo
# (ruta real, dueño) y se lee UNA vez; el conteo y la extracción salen de ese mismo contenido
# (sin carrera entre comprobar y leer). Nada de lo leído se imprime.
exec 3< "$REAL"
[ "$(readlink -f -- /proc/self/fd/3)" = "$REAL" ] && [ "$(stat -L -c '%u' -- /proc/self/fd/3)" = "$(id -u)" ] \
  || { echo "✗ El archivo de origen cambió mientras se abría: no se escribe nada." >&2; exit 2; }
CONTENIDO="$(cat <&3)"
exec 3<&-
n="$(printf '%s\n' "$CONTENIDO" | grep -Ec "^- ${CLAVE}:[[:space:]]*[^[:space:]]+[[:space:]]*\$" || true)"
[ "$n" = "1" ] || { echo "✗ Se esperaba UNA línea «- ${CLAVE}: …» y hay $n: no se escribe nada." >&2; exit 1; }
VALOR="$(printf '%s\n' "$CONTENIDO" | sed -n -E "s/^- ${CLAVE}:[[:space:]]*([^[:space:]]+)[[:space:]]*\$/\1/p")"
unset CONTENIDO
printf '%s' "$VALOR" | grep -Eq '^[0-9]{10,20}$' \
  || { echo "✗ El valor de ${CLAVE} no tiene forma de identificador (solo dígitos, 10 a 20): no se escribe nada." >&2; exit 1; }

if [ "$APLICAR" -eq 0 ]; then
  [ -r "$LOCAL" ] && [ -f "$LOCAL" ] \
    || { echo "✗ La tabla de valores locales no existe o no se puede leer: --aplicar fallaría." >&2; exit 1; }
  existe="no"
  "$AQUI/marcador-local.sh" --archivo "$LOCAL" --verificar "$MARCADOR" >/dev/null 2>&1 && existe="sí"
  echo "Seco: ${CLAVE} se leyó de CLIENTES/${CLIENTE}/ con forma válida (valor no mostrado)."
  echo "  Marcador ${MARCADOR}: ya está en la tabla: ${existe}."
  if [ "$existe" = "sí" ]; then echo "  Con --aplicar no se pisa; para cambiarlo, --aplicar --reemplazar."; else echo "  Con --aplicar se agrega la fila."; fi
  exit 0
fi

# Aplicar: el valor viaja por el ENTORNO, no por argumentos; marcador-local.sh valida,
# respalda y escribe sin mostrarlo.
if [ "$REEMPLAZAR" -eq 1 ]; then
  MARCADOR_VALOR="$VALOR" "$AQUI/marcador-local.sh" --archivo "$LOCAL" --marcador "$MARCADOR" --reemplazar
else
  MARCADOR_VALOR="$VALOR" "$AQUI/marcador-local.sh" --archivo "$LOCAL" --marcador "$MARCADOR" --nota "copiado de CLIENTES/${CLIENTE}/$(basename -- "$REAL")"
fi
