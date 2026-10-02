#!/usr/bin/env bash
# =============================================================================
# cotejar-ids-ajenos.sh — compara los ids de cada .env de NovuChat contra las
# huellas del candado de apps ajenas (scripts/lib/apps-ajenas.sh), SIN red y
# SIN imprimir nunca un id: solo los últimos 4 dígitos y si coincide.
#
# POR QUÉ EXISTE. Una huella que entra a una lista del candado bloquea ese id
# en todos los scripts. El 01/10/2026 entró la huella del número de prueba de
# la Fase 0 con la etiqueta «en desuso» y era el WA_PHONE_ID del Demo A: bloqueo
# indebido en main hasta que se cotejó (PR #313). La regla que salió de ahí:
# TODA huella que se suma a una lista se coteja antes contra los .env de
# NovuChat. Este script es esa regla, repetible.
#
#   ./scripts/cotejar-ids-ajenos.sh                      # cada .env* de la carpeta principal
#   ./scripts/cotejar-ids-ajenos.sh --dir <carpeta>      # los .env* de otra carpeta
#   ./scripts/cotejar-ids-ajenos.sh --env .env.bellido   # un .env en concreto (repetible)
#   ./scripts/cotejar-ids-ajenos.sh --candidata <sha256> # ANTES de agregar una huella
#
# QUÉ MIRA: WA_APP_ID, WA_PHONE_ID y WABA_ID de cada archivo, contra las tres
# listas vigentes (apps, números, WABAs) y contra cada --candidata.
#
# CÓDIGOS DE SALIDA (FALLA CERRADO: solo el 0 dice «todo bien»):
#   0  se revisó al menos un id y ninguno coincide.
#   1  algo coincide (con una lista vigente: ese .env está bloqueado hoy; con
#      una candidata: NO se agrega sin decidirlo con Andres y con WhatsApp-Modular).
#   2  uso incorrecto, un archivo que no se pudo leer, UNA CLAVE PRESENTE CUYO
#      VALOR NO SE PUDO LEER COMO ID (p. ej. «${OTRA}»), o no se revisó ningún
#      id: en cualquiera de esos casos «no coincide» no está demostrado.
#   3  python3 no contestó (lo corta la biblioteca del candado).
#
# LEE EL .env COMO DATOS: busca las tres claves línea por línea y no ejecuta el
# archivo (no usa `source`). Entiende «export», «readonly» y «declare» delante,
# comillas, espacios, «;» y un comentario al final de la línea. Una clave que
# no está en un archivo no es error (no todo .env las trae); una que está y no
# se entiende, sí. Nada de red, nada de escritura, ningún valor en la salida.
# La biblioteca del candado SÍ se carga: es código del repositorio.
# =============================================================================
set -euo pipefail

DIR=""; ARCHIVOS=(); CANDIDATAS=()
requiere_valor() { { [ "$1" -ge 2 ] && [ -n "$3" ]; } || { echo "✗ La opción $2 requiere un valor" >&2; exit 2; }; }
while [ $# -gt 0 ]; do
  case "$1" in
    --dir)       requiere_valor $# "$1" "${2-}"; DIR="$2"; shift 2 ;;
    --env)       requiere_valor $# "$1" "${2-}"; ARCHIVOS+=("$2"); shift 2 ;;
    --candidata) requiere_valor $# "$1" "${2-}"; CANDIDATAS+=("$2"); shift 2 ;;
    -h|--help)   sed -n '2,37p' "$0"; exit 0 ;;
    # No se repite el argumento: podría ser un id pegado por error.
    *) echo "✗ Argumento desconocido (ver --help)" >&2; exit 2 ;;
  esac
done

# sha256: 64 hex, con o sin «:». LC_ALL=C: en es_ES/es_BO/es_AR `[0-9a-f]`
# acepta dígitos de otras escrituras y letras con tilde (como `es_id`).
es_sha256() { local LC_ALL=C || return 1; local h=${1//:/}; [[ $h =~ ^[0-9a-f]{64}$ ]]; }
for c in "${CANDIDATAS[@]+"${CANDIDATAS[@]}"}"; do
  es_sha256 "$c" || { echo "✗ --candidata espera un sha256 (64 hex, con o sin «:»)" >&2; exit 2; }
done

# shellcheck source=scripts/lib/apps-ajenas.sh
source "$(dirname "$0")/lib/apps-ajenas.sh"

if [ ${#ARCHIVOS[@]} -eq 0 ]; then
  # Los .env viven en la carpeta principal, no en cada worktree. Se pregunta
  # desde ESTE repositorio, no desde la carpeta donde se corra el script.
  [ -n "$DIR" ] || DIR=$(git -C "$(dirname "$0")" worktree list --porcelain | sed -n '1s/^worktree //p')
  [ -d "$DIR" ] || { echo "✗ No existe la carpeta indicada" >&2; exit 2; }
  for f in "$DIR"/.env "$DIR"/.env.*; do
    [ -f "$f" ] || continue
    case "$f" in *.example) continue ;; esac
    ARCHIVOS+=("$f")
  done
fi
[ ${#ARCHIVOS[@]} -gt 0 ] || { echo "✗ No hay ningún .env que cotejar (¿--dir o --env?)" >&2; exit 2; }

# Lee una clave del archivo como datos. Deja el valor en LEIDO y devuelve:
#   0  encontrada, con forma de id;   1  la clave no está;
#   2  la clave está y NO se puede asegurar qué valor tiene `source` (no se imprime).
# La última asignación vale, como al cargar el archivo. Las líneas de comentario
# no cuentan. Solo es una asignación la línea ANCLADA: [export|readonly|declare
# -x] CLAVE=valor, y tras el valor solo puede haber espacios, «;» o «# …». Toda
# otra línea que nombre la clave (dos asignaciones en una, la clave dentro de
# otro valor, un prefijo parecido seguido de la clave…) es ambigua: sale 2.
# Una asignación con «+=» y una línea de más de 4 KiB también son ambiguas.
# Revisión de seguridad del #367. Un error de lectura de grep corta con 2.
leer_clave() {
  local todas rc=0 linea="" l rest v tras t ambiguo=0
  local ancla="^[[:space:]]*(export[[:space:]]+|readonly[[:space:]]+|declare[[:space:]]+(-[A-Za-z]+[[:space:]]+)*)?$2[[:space:]]*="
  LEIDO=""
  todas=$(LC_ALL=C grep -a -E -e "(^|[^A-Za-z0-9_])$2[[:space:]]*\+?=" -- "$1") || rc=$?
  [ "$rc" -le 1 ] || { echo "✗ No se pudo leer $(basename -- "$1")" >&2; exit 2; }
  while IFS= read -r l; do
    # Una línea de más de 4 KiB que nombra la clave no es un .env normal, y las
    # expansiones de abajo son cuadráticas: se corta antes, fallando cerrado.
    (( ${#l} <= 4096 )) || return 2
    l=${l#$'\xef\xbb\xbf'}
    case "$l" in *[![:space:]]*) ;; *) continue ;; esac
    t=${l#"${l%%[![:space:]]*}"}
    [ "${t:0:1}" = "#" ] && continue
    if [[ $l =~ $ancla ]]; then linea=$l; else ambiguo=1; fi
  done <<<"$todas"
  [ "$ambiguo" -eq 0 ] || return 2
  [ -n "$linea" ] || return 1
  rest=${linea#*"$2"}
  rest=${rest#"${rest%%[![:space:]]*}"}; rest=${rest#=}
  rest=${rest#"${rest%%[![:space:]]*}"}; rest=${rest//$'\r'/}
  case $rest in
    \"*) v=${rest#\"}; [[ $v == *\"* ]] || return 2; tras=${v#*\"}; v=${v%%\"*} ;;
    \'*) v=${rest#\'}; [[ $v == *\'* ]] || return 2; tras=${v#*\'}; v=${v%%\'*} ;;
    *)   v=${rest%%[[:space:];#]*}; tras=${rest#"$v"} ;;
  esac
  t=${tras#"${tras%%[![:space:]]*}"}
  if [ "${t:0:1}" = ";" ]; then t=${t#;}; t=${t#"${t%%[![:space:]]*}"}; fi
  case "$t" in ""|"#"*) ;; *) return 2 ;; esac
  es_id "$v" || return 2
  LEIDO=$v
}

coincidencias=0; revisados=0; omitidos=0
for f in "${ARCHIVOS[@]}"; do
  nombre=$(basename -- "$f")
  { [ -f "$f" ] && [ -r "$f" ]; } || { echo "✗ No existe o no se puede leer: $nombre" >&2; exit 2; }
  for par in "WA_APP_ID:huella_ajena:apps" "WA_PHONE_ID:numero_ajeno:números" "WABA_ID:waba_ajena:WABAs"; do
    IFS=: read -r clave fn lista <<<"$par"
    estado=0; leer_clave "$f" "$clave" || estado=$?
    case "$estado" in
      1) continue ;;
      2) echo "  ?  $nombre  $clave: está, pero su valor no se entiende como id: NO se pudo cotejar"
         omitidos=$((omitidos + 1)); continue ;;
    esac
    id=$LEIDO
    revisados=$((revisados + 1))
    marca="…${id: -4}"
    if "$fn" "$id"; then
      echo "  ✗  $nombre  $clave $marca  COINCIDE con la lista vigente de $lista (hoy los scripts cortan con este .env)"
      coincidencias=$((coincidencias + 1))
    fi
    for c in "${CANDIDATAS[@]+"${CANDIDATAS[@]}"}"; do
      if huella_en "$id" "$c"; then
        echo "  ✗  $nombre  $clave $marca  COINCIDE con la huella candidata ${c:0:8}…: NO se agrega a la lista de $lista sin decidirlo"
        coincidencias=$((coincidencias + 1))
      fi
    done
  done
  echo "  ·  $nombre  cotejado"
done

echo
if [ "$coincidencias" -gt 0 ]; then
  echo "✗ $coincidencias coincidencia(s) en $revisados id(s) revisados."
  exit 1
fi
if [ "$omitidos" -gt 0 ]; then
  echo "✗ $omitidos clave(s) presentes que no se pudieron leer como id: no se puede decir que nada coincide. Revisar a mano." >&2
  exit 2
fi
if [ "$revisados" -eq 0 ]; then
  echo "✗ No se revisó ningún id (ningún archivo trae WA_APP_ID, WA_PHONE_ID ni WABA_ID): no se puede decir que nada coincide." >&2
  exit 2
fi
echo "✓ Ningún id de ${#ARCHIVOS[@]} archivo(s) coincide ($revisados id(s) revisados)."
