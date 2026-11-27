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
#   R4  «This deployment is in an unexpected state»: fatal, SALVO que el despliegue esté completo y limpio y no haya Functions NUEVAS
#       (solo actualizaciones: conservan su invoker); entonces es ::warning:: con las Functions candidatas (26/11/2026).
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
#   REGISTRO_ACUMULADO  opcional: la salida de TODOS los intentos de `firebase deploy` (el workflow repite el despliegue
#                    hasta 3 veces ante la cuota de escrituras de Cloud Functions). R3 y R5 se miden sobre este acumulado:
#                    toda Function iniciada en CUALQUIER intento debe tener su «Successful» en alguno, y un «Skipped (No
#                    changes detected)» posterior NO la salva; un sitio de Hosting publicado en cualquier intento cuenta.
#                    R1, R2, R4 y R6 se miden sobre REGISTRO (el último intento). Sin esta variable, REGISTRO hace de ambos.
#   REINTENTABLE_EN  opcional: archivo donde se escribe «si» o «no»: ¿vale la pena repetir el despliegue? Es «si» SOLO cuando
#                    lo único que falta son Functions y TODAS las pendientes tienen en el último intento su
#                    «Got "Quota Exceeded" error while trying to <op> …/functions/<id>.», y no hay «unexpected state».
#
# SALIDAS en $GITHUB_OUTPUT (si existe):
#   completo=true|false
#   hosting_publicado=todos|parcial|ninguno|no_aplica
#   functions_pendientes=functions:admin:fnDos,...   (sin región; para un
#     redespliegue parcial en un PR futuro)
#
# CÓDIGOS: 0 completo · 1 incompleto · 2 error de uso.
# No vuelve a imprimir el registro (ya salió por `tee` en el paso del workflow),
# y en ::error:: y en el resumen nombra los sitios por su ROL («consola»,
# «catálogo»), no por su id: en staging y dev el id del sitio es el del proyecto.
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
limpio="$(sed -E $'s/\x1b\\[[0-9;?]*[A-Za-z]//g; s/\r$//' "$REGISTRO")"
# El acumulado de todos los intentos (o el mismo registro si el workflow no repite).
REGISTRO_ACUMULADO="${REGISTRO_ACUMULADO:-$REGISTRO}"
[[ -f "$REGISTRO_ACUMULADO" ]] || uso "el registro acumulado no existe"
acumulado="$(sed -E $'s/\x1b\\[[0-9;?]*[A-Za-z]//g; s/\r$//' "$REGISTRO_ACUMULADO")"

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

# Destino de Hosting desconocido: error de uso. Un `hosting:<x>` que no fuera
# consola ni catálogo no tendría sitio esperado y la regla R5 no lo juzgaría.
for x in "${ELEMENTOS[@]}"; do
  x="${x//[[:space:]]/}"
  case "$x" in
    hosting:consola|hosting:catalogo) ;;
    hosting:*) uso "destino de Hosting desconocido en SOLO: «$x» (solo hosting, hosting:consola o hosting:catalogo)" ;;
  esac
done

# Cada línea sin sangría ni ícono (✔/✓) al inicio y sin espacios al final: los anclajes de abajo comparan la LÍNEA ENTERA (no una subcadena).
normalizar() { sed -E 's/^([[:space:]]|✔|✓)*//; s/[[:space:]]*$//' <<< "$1"; }
limpio_norm="$(normalizar "$limpio")"
acumulado_norm="$(normalizar "$acumulado")"

motivos=()
pendientes=()

# R1 y R2
[[ "$CODIGO_FIREBASE" == "0" ]] || motivos+=("firebase deploy salió con código $CODIGO_FIREBASE")
grep -Fxq 'Deploy complete!' <<< "$limpio_norm" \
  || motivos+=("no llegó a «Deploy complete!»: terminó a medias")

# R3 y R7: cobertura de Functions
if tiene functions; then
  # Sin ancla al final de la línea: un espacio o un resto de spinner tras «...» no puede esconder una Function iniciada.
  iniciadas="$(sed -nE 's/^.*functions: (creating|updating|deleting) .* function ([^ ]+)\.\.\..*$/\2/p' <<< "$acumulado" | sort -u)"
  confirmadas="$(sed -nE 's/^.*functions\[([^]]+)\] Successful (create|update|delete) operation\.[[:space:]]*$/\1/p' <<< "$acumulado" | sort -u)"
  # Y las del ÚLTIMO intento: una Function que se vuelve a iniciar en el último intento tiene que confirmarse en ESE intento; el «Successful» de un
  # intento anterior no la tapa.
  iniciadas_ult="$(sed -nE 's/^.*functions: (creating|updating|deleting) .* function ([^ ]+)\.\.\..*$/\2/p' <<< "$limpio" | sort -u)"
  confirmadas_ult="$(sed -nE 's/^.*functions\[([^]]+)\] Successful (create|update|delete) operation\.[[:space:]]*$/\1/p' <<< "$limpio" | sort -u)"
  omitidas="$(grep -c 'Skipped (No changes detected)' <<< "$acumulado")"
  if [[ -z "$iniciadas" && "$omitidas" == "0" ]]; then
    motivos+=("el registro no tiene el formato esperado de firebase-tools (ninguna Function iniciada ni omitida)")
  fi
  if [[ -n "$iniciadas" ]]; then
    mapfile -t pendientes < <(sort -u <(comm -23 <(printf '%s\n' "$iniciadas") <(printf '%s\n' "$confirmadas")) \
      <(comm -23 <(printf '%s\n' "$iniciadas_ult") <(printf '%s\n' "$confirmadas_ult")) | sed '/^$/d')
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

# R6 («Functions deploy had errors»). R4 («unexpected state») se decide MAS ABAJO, cuando ya se sabe si el despliegue quedó completo.
grep -Fq 'Functions deploy had errors' <<< "$limpio" \
  && motivos+=("firebase-tools avisó «Functions deploy had errors»")

# R5: un «release complete» por cada sitio esperado. Cada sitio se busca por su
# id y se nombra por su rol.
roles=()
if exacto hosting; then
  [[ -n "$SITIO_CONSOLA" ]] || uso "falta SITIO_CONSOLA y el despliegue incluye hosting"
  roles+=(consola)
  [[ -z "$SITIO_CATALOGO" ]] || roles+=(catalogo)
fi
if exacto hosting:consola; then
  [[ -n "$SITIO_CONSOLA" ]] || uso "falta SITIO_CONSOLA y el despliegue incluye hosting:consola"
  [[ " ${roles[*]} " == *" consola "* ]] || roles+=(consola)
fi
if exacto hosting:catalogo; then
  [[ -n "$SITIO_CATALOGO" ]] || uso "falta SITIO_CATALOGO y el despliegue incluye hosting:catalogo"
  [[ " ${roles[*]} " == *" catalogo "* ]] || roles+=(catalogo)
fi
publicados=0
for rol in "${roles[@]}"; do
  if [[ "$rol" == consola ]]; then sitio="$SITIO_CONSOLA"; nombre="de la consola"
  else sitio="$SITIO_CATALOGO"; nombre="del catálogo"
  fi
  if grep -Fxq "hosting[$sitio]: release complete" <<< "$acumulado_norm"; then
    publicados=$((publicados + 1))
  else
    motivos+=("Hosting no publicó el sitio $nombre (falta «release complete»)")
  fi
done
if (( ${#roles[@]} == 0 )); then hosting_publicado=no_aplica
elif (( publicados == ${#roles[@]} )); then hosting_publicado=todos
elif (( publicados == 0 )); then hosting_publicado=ninguno
else hosting_publicado=parcial
fi

# R4: «Updated function is not associated with a service. This deployment is in an unexpected state». firebase-tools (v15.28.1,
# fabricator.ts, updateV2Function) lo imprime cuando la API devuelve la actualización SIN el nombre del servicio: NO es fatal para
# el CLI (la operación sale «Successful update operation»), pero OMITE solo el paso del invoker (IAM) de ESA Function; el aviso
# no la nombra. Por eso:
#   · FATAL, siempre y por omisión (PRODUCCIÓN: el job de producción no define AVISO_SERVICIO_NO_FATAL);
#   · SOLO EN STAGING (el job de staging define AVISO_SERVICIO_NO_FATAL=1) deja de ser fatal si TODO lo demás está completo y limpio
#     (sin ningún otro motivo), FIREBASE_TOOLS_VERSION es EXACTAMENTE la verificada (vacía o distinta = fatal) y no hubo ninguna
#     creación. Entonces avisa con ::warning:: y entrega las Functions candidatas (`candidatas` en GITHUB_OUTPUT) para que el workflow
#     verifique su invoker (scripts/verificar-invocadores-candidatas.sh); si esa verificación falla, el job falla.
#   · CREACIÓN: se busca SIN distinguir mayúsculas y en TODO el acumulado: «functions: creat…», «Successful create operation»,
#     «failed to create function», «while trying to create». LÍMITE CONOCIDO (B1 de la revisión de #1137): firebase-tools, al
#     recrear por dentro una Function (deleteAndRecreate), imprime «updating»; una recreación así es indistinguible de una
#     actualización en el registro y NO se detecta; por eso es solo staging y con la verificación del invoker.
#   AL SUBIR FIREBASE_TOOLS_VERSION: volver a verificar estos textos contra fabricator.ts de la versión nueva y actualizar VERSION_VERIFICADA.
avisos_servicio="$(grep -Fc 'This deployment is in an unexpected state' <<< "$acumulado" || true)"
candidatas_ids=""
if [[ "${avisos_servicio:-0}" != "0" ]]; then
  creaciones=0
  grep -Eiq 'functions:[[:space:]]+creat|Successful create operation|failed to create function|while trying to create' <<< "$acumulado" && creaciones=1
  version_ok=0
  if [[ -n "${FIREBASE_TOOLS_VERSION:-}" && "$FIREBASE_TOOLS_VERSION" == "$VERSION_VERIFICADA" ]]; then version_ok=1; fi
  if [[ "${AVISO_SERVICIO_NO_FATAL:-0}" == "1" ]] && (( ${#motivos[@]} == 0 && creaciones == 0 && version_ok == 1 )); then
    # Candidatas: TODAS las Functions confirmadas desde el primer aviso hasta el final del último intento (el aviso no dice cuál; dos avisos seguidos y una sola confirmación no deben dejar a una fuera).
    candidatas_ids="$(awk '
      /This deployment is in an unexpected state/ { if (!ini) ini = NR; fin = NR }
      { l[NR] = $0 }
      END {
        if (!ini) exit
        n = 0
        for (i = ini; i <= NR; i++) {
          if (l[i] ~ /Successful (create|update|delete) operation\./) {
            match(l[i], /functions\[[^]]+\]/); id = substr(l[i], RSTART + 10, RLENGTH - 11)
            sub(/\(.*$/, "", id); sub(/^.*:/, "", id)
            if (id !~ /^[A-Za-z][A-Za-z0-9_-]*$/) { malas++; continue }
            c[++n] = id
          }
        }
        for (i = 1; i <= n; i++) printf "%s%s", (i > 1 ? "," : ""), c[i]
        if (malas) printf "%s!", (n ? "," : "")
      }' <<< "$limpio")"
    if [[ "$candidatas_ids" == *'!'* ]]; then
      # M-D (revisión de #1137): una confirmada con un id de forma inesperada no se puede verificar; omitirla en silencio dejaría un invoker sin comprobar.
      candidatas_ids=""
      motivos+=("firebase-tools avisó «This deployment is in an unexpected state» y una Function confirmada tiene un id con forma inesperada: no se puede verificar su invoker")
    elif [[ -z "$candidatas_ids" ]]; then
      # Un aviso sin ninguna candidata que verificar sería un warning sin comprobación del invoker: es fatal.
      motivos+=("firebase-tools avisó «This deployment is in an unexpected state» y no hay Function confirmada que verificar")
    else
    echo "::warning::firebase-tools avisó $avisos_servicio vez/veces «unexpected state» (una actualización sin servicio asociado: se omitió su invoker), con el despliegue completo y sin Functions nuevas (solo staging). El workflow verifica el invoker de las candidatas (el aviso no nombra la Function): ${candidatas_ids//,/, }."
    fi
  else
    motivos+=("firebase-tools avisó «This deployment is in an unexpected state»")
  fi
fi

# ¿Vale la pena repetir el despliegue? Caso real (25/11/2026, staging, 86 Functions): firebase-tools recibe «Quota Exceeded» en
# unas Functions, reintenta, y a los ~3 min se rinde con otras que ni siquiera intentó (sin ninguna línea de cuota ni de éxito).
# Por eso NO se exige que cada pendiente tenga su línea de cuota. Es reintentable cuando, en el ÚLTIMO intento:
#   · terminó a medias y quedan Functions pendientes;
#   · hubo AL MENOS una señal de cuota («Got "Quota Exceeded"»);
#   · NINGUNA pendiente tiene una línea de fallo que no sea de cuota (una pendiente sin ninguna línea es «no intentada»: se repite);
#   · no hay «unexpected state», «Functions deploy had errors» ni un fallo de compilación o de arranque.
# El acumulado (R3) sigue mandando: tras repetir, toda Function iniciada en cualquier intento necesita su «Successful».
reintentable=no
cuota_total="$(grep -c 'Got "Quota Exceeded"' <<< "$limpio")"
if (( ${#motivos[@]} > 0 && ${#pendientes[@]} > 0 && cuota_total > 0 )); then
  reintentable=si
  # M-A (revisión de #1137): las candidatas del aviso salen SOLO del último intento (arriba). Vale porque un intento con el aviso nunca se
  # repite (esta línea). Si esta regla cambia, las candidatas deben salir de TODOS los intentos desde el primer aviso del acumulado.
  grep -Fq 'This deployment is in an unexpected state' <<< "$limpio" && reintentable=no
  grep -Fq 'Functions deploy had errors' <<< "$limpio" && reintentable=no
  grep -Eiq 'build failed|healthcheck failed|container failed to start|failed to build' <<< "$limpio" && reintentable=no
  for p in "${pendientes[@]}"; do
    id="${p%%(*}"; id="${id##*:}"
    [[ "$id" =~ ^[A-Za-z0-9_-]+$ ]] || { reintentable=no; continue; }
    # Las líneas que nombran ESTA Function y que son un fallo distinto del de cuota: ni la de cuota, ni el «HTTP Error: 429» de la
    # petición, ni el «failed to <op> function» que firebase-tools imprime al reintentar internamente.
    otras="$(grep -E "(functions/|:)${id}([^A-Za-z0-9_-]|$)" <<< "$limpio" \
      | grep -Ev 'Quota Exceeded|HTTP Error: 429|failed to (create|update|delete) function' \
      | grep -Ec '✘|[Ee]rror|[Ff]ailed|denied|[Uu]nable' || true)"
    [[ "${otras:-0}" == "0" ]] || reintentable=no
  done
fi
if [[ -n "${REINTENTABLE_EN:-}" ]]; then printf '%s\n' "$reintentable" > "$REINTENTABLE_EN"; fi

# Salidas
lista=""
for p in "${pendientes[@]}"; do
  lista+="${lista:+,}functions:${p%%(*}"
done
completo=true; (( ${#motivos[@]} == 0 )) || completo=false
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  { echo "completo=$completo"; echo "hosting_publicado=$hosting_publicado"; echo "functions_pendientes=$lista"; echo "candidatas=$candidatas_ids"; } >> "$GITHUB_OUTPUT"
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
    echo "Qué hacer: **Re-run failed jobs**; si el entorno exige aprobación, la pide de nuevo; el despliegue es idempotente."
  } >> "$GITHUB_STEP_SUMMARY"
fi
exit 1
