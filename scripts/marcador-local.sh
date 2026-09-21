#!/usr/bin/env bash
# =============================================================================
# marcador-local.sh — agrega o comprueba una fila de la tabla de marcadores de
# CONFIGURACION.local.md SIN MOSTRAR NUNCA SU VALOR.
#
# POR QUÉ EXISTE. `docs/alta-cliente/RUNBOOK.md` §4 dice que esa tabla «la
# completa una persona, a mano». Es el único paso del alta que quedaba fuera
# del CLI, y es el que más caro sale cuando se escribe mal: `cargar-negocio.mjs`
# y `preparar-import.sh` NIEGAN el `--aplicar` si falta una fila, y antes del
# 15/09 un marcador con nombre-prefijo de otro cliente hizo salir a NovuChat
# con el Phone ID del Demo A.
#
# POR QUÉ NO SE LEE EL ARCHIVO. CONFIGURACION.local.md guarda identificadores
# reales y está en la lista `deny` de la sesión: ningún agente puede leerlo.
# Este script tampoco lo lee «hacia afuera»: escribe con `awk` a un temporal y
# lo mueve. Lo único que imprime es el NOMBRE del marcador y un veredicto.
#
# USO
#   ./scripts/marcador-local.sh --marcador REEMPLAZAR_X --valor <valor> [--nota "texto"]
#   ./scripts/marcador-local.sh --verificar REEMPLAZAR_X
#   ./scripts/marcador-local.sh --listar
#   ./scripts/marcador-local.sh --marcador REEMPLAZAR_X --copiar-de REEMPLAZAR_Y [--nota "texto"]
#
# --copiar-de (21/09/2026, el ensayo) toma el valor de OTRA fila de la tabla sin
# que pase por la pantalla ni por el chat: las filas del ensayo apuntan a los
# mismos calendarios del Demo A y al teléfono de quien prueba, que ya están en
# la tabla. Sin esto había que volver a pegarlos a mano.
#
# El valor se puede pasar por `--valor` o, mejor, por la variable de entorno
# MARCADOR_VALOR, para que no quede en el historial del shell.
# =============================================================================
set -euo pipefail

LOCAL="${CONFIG_LOCAL:-$HOME/NovuChat/CONFIGURACION.local.md}"
MARCADOR="" ; VALOR="${MARCADOR_VALOR:-}" ; NOTA="" ; MODO="agregar" ; COPIAR_DE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --marcador)  MARCADOR="$2"; shift 2 ;;
    --valor)     VALOR="$2";    shift 2 ;;
    --nota)      NOTA="$2";     shift 2 ;;
    --verificar) MODO="verificar"; MARCADOR="${2:-}"; shift 2 ;;
    --listar)    MODO="listar";  shift ;;
    --archivo)   LOCAL="$2";    shift 2 ;;
    --copiar-de) COPIAR_DE="$2"; shift 2 ;;
    *) echo "Argumento desconocido: $1" >&2; exit 2 ;;
  esac
done

[ -f "$LOCAL" ] || { echo "✗ No existe el archivo de valores locales." >&2; exit 1; }

# --- listar: solo los NOMBRES de los marcadores, nunca los valores -----------
if [ "$MODO" = "listar" ]; then
  awk -F'|' '/^\| *`REEMPLAZAR_/ { gsub(/[ `]/, "", $2); print "  " $2 }' "$LOCAL" | sort -u
  exit 0
fi

[ -n "$MARCADOR" ] || { echo "Falta --marcador." >&2; exit 2; }
# FORMA ESTRICTA, no solo el prefijo. Con `case` bastaba `REEMPLAZAR_X | fila | falsa`
# para deformar la tabla: el nombre es parte de la fila que se escribe.
printf '%s' "$MARCADOR" | grep -Eq '^REEMPLAZAR_[A-Z0-9_]+$' \
  || { echo "✗ Un marcador es REEMPLAZAR_ seguido de MAYÚSCULAS, dígitos y guiones bajos." >&2; exit 2; }

existe=$(awk -v m="$MARCADOR" -F'|' '
  /^\| *`REEMPLAZAR_/ { c=$2; gsub(/[ `]/, "", c); if (c == m) n++ }
  END { print n+0 }' "$LOCAL")

if [ "$MODO" = "verificar" ]; then
  if [ "$existe" -gt 0 ]; then echo "✓ $MARCADOR está en la tabla ($existe fila)."; exit 0
  else echo "✗ $MARCADOR NO está en la tabla."; exit 1; fi
fi

# --- agregar ------------------------------------------------------------------
if [ -n "$COPIAR_DE" ]; then
  printf '%s' "$COPIAR_DE" | grep -Eq '^REEMPLAZAR_[A-Z0-9_]+$' \
    || { echo "✗ --copiar-de tiene que ser un marcador REEMPLAZAR_…" >&2; exit 2; }
  [ -z "$VALOR" ] || { echo "✗ O --valor o --copiar-de, no los dos." >&2; exit 2; }
  # La celda del valor, sin comillas invertidas ni espacios. Nunca se imprime.
  VALOR=$(awk -v m="$COPIAR_DE" -F'|' '
    /^\| *`REEMPLAZAR_/ { c=$2; gsub(/[ `]/, "", c); if (c == m) { v=$3; gsub(/[ `]/, "", v); print v; exit } }' "$LOCAL")
  [ -n "$VALOR" ] || { echo "✗ $COPIAR_DE no está en la tabla (o está vacío): no hay qué copiar." >&2; exit 1; }
fi
[ -n "$VALOR" ] || { echo "Falta el valor (--valor, MARCADOR_VALOR o --copiar-de)." >&2; exit 2; }
if [ "$existe" -gt 0 ]; then
  echo "✓ $MARCADOR ya estaba en la tabla: no se toca nada."
  echo "  (para cambiar su valor, edítalo a mano: este script no pisa filas existentes.)"
  exit 0
fi

# Validación por FORMA del valor, deducida del nombre del marcador. No lo imprime.
case "$MARCADOR" in
  *CALENDARIO*)
    echo "$VALOR" | grep -Eq '^[0-9a-f]{64}@group\.calendar\.google\.com$' \
      || { echo "✗ El valor no tiene forma de calendario de Google (64 hexadecimales @group.calendar.google.com)." >&2; exit 1; } ;;
  *PHONE_NUMBER_ID*)
    echo "$VALOR" | grep -Eq '^[0-9]{10,20}$' \
      || { echo "✗ El valor no tiene forma de PHONE_NUMBER_ID (solo dígitos)." >&2; exit 1; } ;;
  *NUMERO_RECEPCION*|*NUMERO_DUENO*)
    echo "$VALOR" | grep -Eq '^591[0-9]{7,8}$' \
      || { echo "✗ El valor no tiene forma de número boliviano con prefijo y sin «+» (591…)." >&2; exit 1; } ;;
esac

# NINGUNO de los tres campos puede traer «|», «\» ni un salto de línea. El valor
# ya se revisaba; la NOTA no, y era el hueco: `awk -v` interpreta las secuencias
# de escape, así que una nota con «|\n|» insertaba una FILA ENTERA inventada. Es
# exactamente el defecto del 15/09 —un marcador ajeno colado en la tabla, que
# mandó a NovuChat con el Phone ID del Demo A— que este script existe para
# cerrar. Por eso se revisan los tres, y por eso viajan por el ENTORNO y no por
# `awk -v`: en `-v` el valor queda legible en /proc/<pid>/cmdline.
for campo in MARCADOR VALOR NOTA; do
  contenido="${!campo}"
  case "$contenido" in
    *'|'*|*'\'*) echo "✗ El campo $campo lleva «|» o «\» y rompería la tabla." >&2; exit 1 ;;
  esac
  [ "$contenido" = "${contenido%%$'\n'*}" ] \
    || { echo "✗ El campo $campo lleva un salto de línea." >&2; exit 1; }
done

# El temporal va JUNTO al destino, no en /tmp: así el `mv` final es atómico y el
# archivo con los identificadores reales no se copia a otro sistema de archivos.
tmp="$(mktemp "$LOCAL.nuevo.XXXXXX")"; trap 'rm -f "$tmp"' EXIT
chmod --reference="$LOCAL" "$tmp" 2>/dev/null || chmod 600 "$tmp"

MARCADOR="$MARCADOR" VALOR="$VALOR" NOTA="$NOTA" awk '
  { lineas[NR] = $0; if ($0 ~ /^\| *`REEMPLAZAR_/) ultima = NR }
  END {
    if (ultima == 0) { print "SIN_TABLA" > "/dev/stderr"; exit 3 }
    for (i = 1; i <= NR; i++) {
      print lineas[i]
      if (i == ultima) printf "| `%s` | %s | %s |\n", ENVIRON["MARCADOR"], ENVIRON["VALOR"], ENVIRON["NOTA"]
    }
  }' "$LOCAL" > "$tmp" || { echo "✗ No se encontró la tabla de marcadores." >&2; exit 3; }

# Respaldo CON MARCA DE TIEMPO: con una sola ranura, una segunda corrida sobre un
# archivo ya dañado pisaba la única copia buena, y este archivo no está en git.
sello="$(date +%Y%m%d-%H%M%S)"
cp -p "$LOCAL" "$LOCAL.respaldo-$sello"
mv "$tmp" "$LOCAL"   # atómico: nunca queda un archivo truncado a la mitad
trap - EXIT
echo "✓ $MARCADOR agregado a la tabla (respaldo: CONFIGURACION.local.md.respaldo-$sello)."
