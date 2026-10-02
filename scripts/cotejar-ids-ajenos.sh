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
# listas vigentes (apps, números, WABAs) y contra cada --candidata. Sale 0 si
# ninguno coincide; 1 si alguno coincide (con una lista vigente: ese .env está
# bloqueado hoy; con una candidata: NO se agrega sin decidirlo con Andres y con
# WhatsApp-Modular); 2 si el uso es incorrecto o no hay nada que cotejar.
#
# LEE EL .env COMO DATOS: busca las tres claves línea por línea y no ejecuta el
# archivo (no usa `source`). Nada de red, nada de escritura, ningún valor en la
# salida. La biblioteca del candado SÍ se carga: es código del repositorio.
# =============================================================================
set -euo pipefail

DIR=""; ARCHIVOS=(); CANDIDATAS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --dir)       DIR="${2:-}"; shift 2 ;;
    --env)       ARCHIVOS+=("${2:-}"); shift 2 ;;
    --candidata) CANDIDATAS+=("${2:-}"); shift 2 ;;
    -h|--help)   sed -n '2,29p' "$0"; exit 0 ;;
    *) echo "Argumento desconocido: $1" >&2; exit 2 ;;
  esac
done

for c in "${CANDIDATAS[@]+"${CANDIDATAS[@]}"}"; do
  [[ ${c//:/} =~ ^[0-9a-f]{64}$ ]] || { echo "✗ --candidata espera un sha256 (64 hex, con o sin «:»)" >&2; exit 2; }
done

# shellcheck source=scripts/lib/apps-ajenas.sh
source "$(dirname "$0")/lib/apps-ajenas.sh"

if [ ${#ARCHIVOS[@]} -eq 0 ]; then
  # Los .env viven en la carpeta principal, no en cada worktree.
  [ -n "$DIR" ] || DIR=$(git worktree list --porcelain | sed -n '1s/^worktree //p')
  [ -d "$DIR" ] || { echo "✗ No existe la carpeta: ${DIR:-<vacía>}" >&2; exit 2; }
  for f in "$DIR"/.env "$DIR"/.env.*; do
    [ -f "$f" ] || continue
    case "$f" in *.example) continue ;; esac
    ARCHIVOS+=("$f")
  done
fi
[ ${#ARCHIVOS[@]} -gt 0 ] || { echo "✗ No hay ningún .env que cotejar (¿--dir o --env?)" >&2; exit 2; }

# Valor de una clave, leyendo el archivo como datos: última aparición, sin
# «export», sin comillas ni espacios, sin retorno de carro.
valor() {
  local linea v
  linea=$(grep -E "^[[:space:]]*(export[[:space:]]+)?$2[[:space:]]*=" "$1" | tail -n 1) || true
  [ -n "$linea" ] || return 0
  v=${linea#*=}
  v=${v//$'\r'/}
  v=${v#"${v%%[![:space:]]*}"}; v=${v%"${v##*[![:space:]]}"}
  v=${v#[\"\']}; v=${v%[\"\']}
  printf '%s' "$v"
}

coincidencias=0; revisados=0
for f in "${ARCHIVOS[@]}"; do
  [ -f "$f" ] || { echo "✗ No existe: $f" >&2; exit 2; }
  nombre=$(basename "$f")
  for par in "WA_APP_ID:huella_ajena:apps" "WA_PHONE_ID:numero_ajeno:números" "WABA_ID:waba_ajena:WABAs"; do
    IFS=: read -r clave fn lista <<<"$par"
    id=$(valor "$f" "$clave")
    if [ -z "$id" ]; then continue; fi
    if ! es_id "$id"; then
      echo "  ?  $nombre  $clave: valor sin forma de id (se omite)"
      continue
    fi
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
echo "✓ Ningún id de ${#ARCHIVOS[@]} archivo(s) coincide ($revisados id(s) revisados)."
