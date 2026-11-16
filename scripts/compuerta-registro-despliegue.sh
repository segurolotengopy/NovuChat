#!/usr/bin/env bash
# =============================================================================
# compuerta-registro-despliegue.sh — ¿`firebase deploy` terminó de verdad?
# =============================================================================
# ORIGEN (16/11/2026, v0.23.1): `firebase deploy` salió con código 0 a mitad del
# release de Functions, sin «Deploy complete!» y sin publicar Hosting (Hosting
# se publica DESPUÉS de Functions). El health check pasó porque el sitio viejo
# responde 200. El código de salida no alcanza: este script lee el registro
# que el workflow guardó con `tee` y decide con el texto Y el código, juntos.
#
# REGLAS (cada una falla por sí sola):
#   R1  CODIGO_FIREBASE distinto de 0.
#   R2  falta «Deploy complete!».
#   R3  COBERTURA de Functions: toda Function que firebase-tools empezó a
#       crear, actualizar o borrar tiene su «Successful <op> operation.». El
#       texto «failed to update function» no sirve de veredicto: aparece
#       también cuando el reintento interno de firebase-tools tiene éxito.
#   R4  «This deployment is in an unexpected state» (siempre).
#   R5  «release complete» por cada sitio de Hosting esperado.
#   R6  «Functions deploy had errors».
#   R7  SOLO incluye functions y el registro no trae ni una línea de Functions
#       (ni iniciadas ni omitidas): el formato cambió y no se puede juzgar.
#
# ENTRADAS (entorno):
#   REGISTRO         obligatorio: la salida de `firebase deploy` (con o sin ANSI).
#   CODIGO_FIREBASE  código de salida de `firebase deploy` (defecto 0).
#   SOLO             obligatorio: el valor de `--only`.
#   SITIO_CONSOLA    obligatorio si se publica la consola (id del sitio).
#   SITIO_CATALOGO   opcional: id del segundo sitio; vacío = no hay catálogo.
#
# SALIDAS en $GITHUB_OUTPUT (si existe):
#   completo=true|false
#   hosting_publicado=todos|parcial|ninguno|no_aplica
#   functions_pendientes=functions:admin:fnDos,...   (sin región; para un
#     redespliegue parcial en un PR futuro)
#
# CÓDIGOS: 0 completo · 1 incompleto · 2 error de uso.
# Nunca imprime el registro: puede traer identificadores de la infraestructura.
# =============================================================================
set -uo pipefail
# Orden y comparación de bytes estables, sea cual sea el idioma del runner.
export LC_ALL=C

# Los textos se verificaron contra el código de esta versión de firebase-tools
# (lib/deploy/index.js, lib/deploy/functions/release/fabricator.js,
# lib/deploy/hosting/release.js, lib/gcp/cloudfunctionsv2.js).
VERSION_VERIFICADA=15.28.1

uso() { echo "::error::compuerta-registro-despliegue: $*" >&2; exit 2; }

[[ -n "${REGISTRO:-}" ]] || uso "falta REGISTRO"
[[ -f "$REGISTRO" ]] || uso "el registro no existe"
[[ -n "${SOLO:-}" ]] || uso "falta SOLO"
CODIGO_FIREBASE="${CODIGO_FIREBASE:-0}"
SITIO_CONSOLA="${SITIO_CONSOLA:-}"
SITIO_CATALOGO="${SITIO_CATALOGO:-}"

if [[ -n "${FIREBASE_TOOLS_VERSION:-}" && "$FIREBASE_TOOLS_VERSION" != "$VERSION_VERIFICADA" ]]; then
  echo "::warning::firebase-tools $FIREBASE_TOOLS_VERSION: los textos de esta compuerta se verificaron con $VERSION_VERIFICADA; revise que sigan iguales."
fi

# Sin colores ni retornos de carro: el registro viene de un terminal de CI.
limpio="$(sed -E $'s/\x1b\\[[0-9;]*[A-Za-z]//g; s/\r$//' "$REGISTRO")"

IFS=',' read -r -a ELEMENTOS <<< "$SOLO"
tiene() { # ¿SOLO incluye el componente $1 (entero o calificado, p. ej. functions:x)?
  local x
  for x in "${ELEMENTOS[@]}"; do
    x="${x//[[:space:]]/}"
    [[ "$x" == "$1" || "$x" == "$1":* ]] && return 0
  done
  return 1
}
exacto() { # ¿SOLO incluye exactamente el elemento $1?
  local x
  for x in "${ELEMENTOS[@]}"; do
    [[ "${x//[[:space:]]/}" == "$1" ]] && return 0
  done
  return 1
}

motivos=()
pendientes=()

# R1 y R2
[[ "$CODIGO_FIREBASE" == "0" ]] || motivos+=("firebase deploy salió con código $CODIGO_FIREBASE")
grep -Eq '^[^[:alnum:]]*Deploy complete![[:space:]]*$' <<< "$limpio" \
  || motivos+=("no llegó a «Deploy complete!»: terminó a medias")

# R3 y R7: cobertura de Functions
if tiene functions; then
  iniciadas="$(sed -nE 's/^.*functions: (creating|updating|deleting) .* function ([^ ]+)\.\.\.$/\2/p' <<< "$limpio" | sort -u)"
  confirmadas="$(sed -nE 's/^.*functions\[([^]]+)\] Successful (create|update|delete) operation\.$/\1/p' <<< "$limpio" | sort -u)"
  omitidas="$(grep -c 'Skipped (No changes detected)' <<< "$limpio")"
  if [[ -z "$iniciadas" && "$omitidas" == "0" ]]; then
    motivos+=("el registro no tiene el formato esperado de firebase-tools (ninguna Function iniciada ni omitida)")
  fi
  if [[ -n "$iniciadas" ]]; then
    mapfile -t pendientes < <(comm -23 <(printf '%s\n' "$iniciadas") <(printf '%s\n' "$confirmadas"))
  fi
  if (( ${#pendientes[@]} > 0 )); then
    motivos+=("${#pendientes[@]} Function(s) sin confirmar")
  fi
  # Informativo: un «failed to …» que después se confirmó fue un reintento
  # interno de firebase-tools que salió bien; no es un fallo.
  while IFS= read -r fallida; do
    [[ -n "$fallida" ]] || continue
    region="${fallida%%|*}"; id="${fallida##*|}"
    if grep -Eq "(^|:)${id}\(${region}\)\$" <<< "$confirmadas"; then
      echo "::notice::reintento interno resuelto: $id falló una vez y luego se confirmó."
    fi
  done < <(sed -nE 's/^.*failed to (create|update|delete) function projects\/[^/]+\/locations\/([^/]+)\/functions\/([A-Za-z0-9_-]+)[[:space:]]*$/\2|\3/p' <<< "$limpio" | sort -u)
  cuota="$(grep -c 'Got "Quota Exceeded"' <<< "$limpio")"
  if [[ "$cuota" != "0" ]]; then
    echo "::warning::firebase-tools recibió $cuota aviso(s) de cuota excedida (429) y reintentó."
  fi
fi

# R4 y R6
grep -Fq 'This deployment is in an unexpected state' <<< "$limpio" \
  && motivos+=("firebase-tools avisó «This deployment is in an unexpected state»")
grep -Fq 'Functions deploy had errors' <<< "$limpio" \
  && motivos+=("firebase-tools avisó «Functions deploy had errors»")

# R5: un «release complete» por cada sitio esperado.
sitios=()
if exacto hosting; then
  [[ -n "$SITIO_CONSOLA" ]] || uso "falta SITIO_CONSOLA y el despliegue incluye hosting"
  sitios+=("$SITIO_CONSOLA")
  [[ -z "$SITIO_CATALOGO" ]] || sitios+=("$SITIO_CATALOGO")
fi
if exacto hosting:consola; then
  [[ -n "$SITIO_CONSOLA" ]] || uso "falta SITIO_CONSOLA y el despliegue incluye hosting:consola"
  [[ " ${sitios[*]} " == *" $SITIO_CONSOLA "* ]] || sitios+=("$SITIO_CONSOLA")
fi
if exacto hosting:catalogo; then
  [[ -n "$SITIO_CATALOGO" ]] || uso "falta SITIO_CATALOGO y el despliegue incluye hosting:catalogo"
  [[ " ${sitios[*]} " == *" $SITIO_CATALOGO "* ]] || sitios+=("$SITIO_CATALOGO")
fi
publicados=0
for s in "${sitios[@]}"; do
  if grep -Fq "hosting[$s]: release complete" <<< "$limpio"; then
    publicados=$((publicados + 1))
  else
    motivos+=("Hosting no publicó el sitio $s (falta «release complete»)")
  fi
done
if (( ${#sitios[@]} == 0 )); then hosting_publicado=no_aplica
elif (( publicados == ${#sitios[@]} )); then hosting_publicado=todos
elif (( publicados == 0 )); then hosting_publicado=ninguno
else hosting_publicado=parcial
fi

# Salidas
lista=""
for p in "${pendientes[@]}"; do
  lista+="${lista:+,}functions:${p%%(*}"
done
completo=true; (( ${#motivos[@]} == 0 )) || completo=false
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  { echo "completo=$completo"; echo "hosting_publicado=$hosting_publicado"; echo "functions_pendientes=$lista"; } >> "$GITHUB_OUTPUT"
fi

if [[ "$completo" == "true" ]]; then
  echo "Compuerta del registro: despliegue completo (Hosting: $hosting_publicado)."
  exit 0
fi

for m in "${motivos[@]}"; do echo "::error::$m"; done
for p in "${pendientes[@]}"; do echo "::error::Function sin confirmar: $p"; done
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "### Despliegue a medias: el job falla"
    for m in "${motivos[@]}"; do echo "- $m"; done
    (( ${#pendientes[@]} == 0 )) || echo "- Functions sin confirmar: \`$lista\`"
    echo "- Hosting publicado: $hosting_publicado"
    echo ""
    echo "Qué hacer: **Re-run failed jobs**, que pide de nuevo la aprobación de production; el despliegue es idempotente."
  } >> "$GITHUB_STEP_SUMMARY"
fi
exit 1
