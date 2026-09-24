#!/usr/bin/env bash
# =============================================================================
# ¿QUÉ FLUJO VIVO ESTÁ ATRASADO, Y CUÁL ESTÁ ATRASADO A PROPÓSITO?
# =============================================================================
#
# POR QUE EXISTE. El 24/09/2026 la regla «un cambio se aplica a todos o a
# ninguno» paso a ser «preferentemente a todos, REGISTRANDO LAS EXCEPCIONES»,
# porque NovuChat empieza a sacar productos empaquetados y un cliente puede
# quedarse a proposito en una version.
#
# EL PELIGRO DE ESE CAMBIO es obvio: «registrando las excepciones» sin un lugar
# y sin una comprobacion es una promesa sin respaldo, y este proyecto ya tiene
# una politica entera sobre eso («solo se ofrece lo que se cumple»). Sin esto,
# la regla nueva seria un permiso para que los clientes se desincronicen en
# silencio, que es exactamente el defecto que la regla vieja evitaba.
#
# QUE HACE. Lee `docs/versiones-por-cliente.md` --el registro-- y, por cada
# fila, compara el flujo VIVO en n8n contra su JSON versionado:
#
#   ✓  al dia
#   !  atrasado CON excepcion declarada  -> se informa, no falla
#   ✗  atrasado SIN declarar             -> falla (salida 1)
#
# NO ESCRIBE NADA en n8n: usa el modo seco de `publicar-flujo.sh`. Lo unico que
# escribe son los `.local.json` con los marcadores repuestos, que estan
# ignorados por git y son los mismos que hacen falta para publicar.
#
# NO IMPRIME EL CONTENIDO de ningun flujo ni ningun valor de configuracion:
# solo el nombre del nodo que difiere. Por ahi pasan datos de clientes.
#
#   ./scripts/estado-de-versiones.sh              # todos los del registro
#   ./scripts/estado-de-versiones.sh --cliente Bellido
#
# Salida: 0 si no hay ningun atraso sin declarar, 1 si lo hay, 2 si la llamada
# o el registro estan mal.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 2
REGISTRO="docs/versiones-por-cliente.md"
SOLO=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cliente) SOLO="${2:?--cliente necesita un nombre}"; shift 2 ;;
    --registro) REGISTRO="${2:?}"; shift 2 ;;
    -h|--help) sed -n '2,36p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Opcion desconocida: $1" >&2; exit 2 ;;
  esac
done
[[ -f "$REGISTRO" ]] || { echo "✗ No existe el registro $REGISTRO" >&2; exit 2; }

V=$'\033[1;32m'; R=$'\033[1;31m'; A=$'\033[1;33m'; G=$'\033[0;90m'; FIN=$'\033[0m'
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# Las filas del registro: | Cliente | `--env` | `Flujo` | Excepcion |
# Se toman solo las que tienen las cuatro columnas y un env que empieza con
# punto: asi la cabecera y la linea de guiones quedan afuera sin listarlas.
python3 - "$REGISTRO" > "$TMP/filas" <<'PY'
import re, sys
for linea in open(sys.argv[1], encoding='utf-8'):
    if not linea.lstrip().startswith('|'):
        continue
    col = [c.strip().strip('`').strip() for c in linea.strip().strip('|').split('|')]
    if len(col) != 4:
        continue
    cliente, env, flujo, excepcion = col
    if not env.startswith('.env'):
        continue
    # El guion largo o corto significa «sin excepcion».
    sin = excepcion in ('', '—', '-', '–')
    print('\t'.join([cliente, env, flujo, '' if sin else excepcion]))
PY

[[ -s "$TMP/filas" ]] || { echo "✗ El registro no tiene ninguna fila utilizable" >&2; exit 2; }

printf '\n  Registro: %s\n\n' "$REGISTRO"
SIN_DECLARAR=0; REVISADOS=0; OMITIDOS=0

while IFS=$'\t' read -r CLIENTE ENV_FILE FLUJO EXCEPCION; do
  if [[ -n "$SOLO" && "${CLIENTE,,}" != *"${SOLO,,}"* ]]; then continue; fi
  REVISADOS=$((REVISADOS + 1))

  if [[ ! -f "$ENV_FILE" ]]; then
    printf '  %s?%s %-34s %sno hay %s en esta copia: no se puede comprobar%s\n' \
      "$A" "$FIN" "$CLIENTE" "$G" "$ENV_FILE" "$FIN"
    OMITIDOS=$((OMITIDOS + 1)); continue
  fi
  if [[ ! -f "$FLUJO" ]]; then
    printf '  %s✗%s %-34s %sel registro apunta a un flujo que no existe: %s%s\n' \
      "$R" "$FIN" "$CLIENTE" "$R" "$FLUJO" "$FIN"
    SIN_DECLARAR=$((SIN_DECLARAR + 1)); continue
  fi

  # Los marcadores, repuestos: si no, el seco aborta y no dice nada del atraso.
  ./scripts/preparar-import.sh "$FLUJO" "$ENV_FILE" > "$TMP/prep" 2>&1
  # Sin los codigos de color no se puede buscar por posicion en la linea: el
  # `~` del diagnostico viene precedido de una secuencia ANSI y el `grep` de
  # mas abajo no encontraba ni un nodo (visto al estrenar el script).
  ./scripts/publicar-flujo.sh --env "$ENV_FILE" --flujo "$FLUJO" 2>&1 \
    | sed 's/\x1b\[[0-9;]*m//g' > "$TMP/seco"
  SALIDA=${PIPESTATUS[0]}

  if [[ $SALIDA -ne 0 ]]; then
    printf '  %s?%s %-34s %sno se pudo consultar (%s)%s\n' \
      "$A" "$FIN" "$CLIENTE" "$G" "$(grep -m1 -oE '✗.*' "$TMP/seco" | head -c 60)" "$FIN"
    OMITIDOS=$((OMITIDOS + 1)); continue
  fi

  if grep -q 'coincide con el origen' "$TMP/seco"; then
    printf '  %s✓%s %-34s al día\n' "$V" "$FIN" "$CLIENTE"
    if [[ -n "$EXCEPCION" ]]; then
      printf '      %sexcepción declarada pero el flujo está al día: revisar si ya se puede borrar del registro%s\n' "$A" "$FIN"
    fi
    continue
  fi

  # Solo los NOMBRES de los nodos que difieren: nunca su contenido.
  NODOS=$(grep -oE '^    ~ [^·]+·' "$TMP/seco" | sed 's/^    ~ //; s/ ·$//' | sort -u | paste -sd', ' -)
  [[ -n "$NODOS" ]] || NODOS="(diferencias de configuración)"
  if [[ -n "$EXCEPCION" ]]; then
    printf '  %s!%s %-34s atrasado, CON excepción declarada\n' "$A" "$FIN" "$CLIENTE"
    printf '      %sdifiere en: %s%s\n' "$G" "$NODOS" "$FIN"
    printf '      %sexcepción: %s%s\n' "$G" "$EXCEPCION" "$FIN"
  else
    printf '  %s✗%s %-34s %sATRASADO Y SIN DECLARAR%s\n' "$R" "$FIN" "$CLIENTE" "$R" "$FIN"
    printf '      %sdifiere en: %s%s\n' "$G" "$NODOS" "$FIN"
    SIN_DECLARAR=$((SIN_DECLARAR + 1))
  fi
done < "$TMP/filas"

echo
if [[ $SIN_DECLARAR -gt 0 ]]; then
  printf '  %s✗ %s flujo(s) atrasado(s) SIN declarar, de %s revisado(s).%s\n' \
    "$R" "$SIN_DECLARAR" "$REVISADOS" "$FIN"
  printf '    O se publican, o se declara la excepción en %s con su porqué\n' "$REGISTRO"
  printf '    y qué la cierra. Un atraso sin fila es un defecto, no una excepción.\n\n'
  exit 1
fi
printf '  %s✓ Ningún atraso sin declarar%s (%s revisado(s)' "$V" "$FIN" "$REVISADOS"
[[ $OMITIDOS -gt 0 ]] && printf ', %s sin poder comprobar' "$OMITIDOS"
printf ').\n\n'
