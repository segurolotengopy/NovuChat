#!/usr/bin/env bash
# Crea y sube la ETIQUETA de una version, que es lo que dispara el despliegue a
# produccion (`desplegar-produccion` corre con `refs/tags/v*`).
#
# POR QUE EXISTE. `git tag` esta en la lista de denegacion de Claude por
# decision de Andres del 15/09/2026: la etiqueta la crea una persona. Pero
# «nunca comandos sueltos ni marcadores para reemplazar a mano» (CLAUDE.md):
# entonces la persona corre UN comando y el script hace todo lo demas, con las
# comprobaciones que un operador apurado se saltea.
#
# QUE COMPRUEBA ANTES DE ETIQUETAR (y aborta si algo no cuadra):
#   - que la version tenga forma vX.Y.Z y que no exista ya, ni local ni en el
#     remoto: reetiquetar es la forma mas rapida de desplegar otra cosa;
#   - que `origin/main` este al dia y que la etiqueta apunte EXACTAMENTE al
#     commit que se le pide (por defecto, la punta de `origin/main`);
#   - que ese commit sea el que esta publicado, no uno local sin subir;
#   - que la version sea POSTERIOR a la ultima etiquetada.
#
# QUE HACE DESPUES. Sube la etiqueta y queda mirando la corrida del pipeline:
# imprime el enlace, y el del entorno `production` cuando GitHub pida la
# aprobacion, que es el segundo y ultimo paso de una persona.
#
#   ./scripts/etiquetar-version.sh v0.6.0
#   ./scripts/etiquetar-version.sh v0.6.0 --commit c7d1122   # otro commit
#   ./scripts/etiquetar-version.sh v0.6.0 --sin-seguir       # no espera al CI
#
# NO despliega nada por si mismo: lo hace GitHub Actions, con la aprobacion del
# entorno. Y no toca ninguna rama.
set -euo pipefail

VERSION="${1:-}"
COMMIT=""
SEGUIR=1
shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --commit)  COMMIT="${2:?--commit necesita un commit}"; shift 2 ;;
    --commit=*) COMMIT="${1#*=}"; shift ;;
    --sin-seguir) SEGUIR=0; shift ;;
    *) echo "Opcion desconocida: $1" >&2; exit 2 ;;
  esac
done

rojo()  { printf '\033[1;31m%s\033[0m\n' "$*"; }
verde() { printf '\033[1;32m%s\033[0m\n' "$*"; }
gris()  { printf '\033[0;90m%s\033[0m\n' "$*"; }

if [[ -z "$VERSION" ]]; then
  echo "  Uso: ./scripts/etiquetar-version.sh vX.Y.Z [--commit <sha>] [--sin-seguir]" >&2
  exit 2
fi
[[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || { rojo "✗ La version tiene que ser vX.Y.Z (sin sufijos: un guion desactiva el despliegue)."; exit 1; }

cd "$(git rev-parse --show-toplevel)"

# EL ARBOL LOCAL NO IMPORTA, a proposito: se etiqueta un commit PUBLICADO en
# `origin/main`, no lo que haya en la carpeta. En `~/NovuChat` trabajan varias
# sesiones a la vez y casi siempre hay algo a medio hacer; exigir un arbol
# limpio habria hecho fallar el unico comando de la persona sin ninguna razon.
git fetch --quiet origin --tags

# --- La etiqueta, nueva -----------------------------------------------------
if git rev-parse -q --verify "refs/tags/$VERSION" >/dev/null \
   || git ls-remote --exit-code --tags origin "refs/tags/$VERSION" >/dev/null 2>&1; then
  rojo "✗ $VERSION ya existe. Reetiquetar deja el historial mintiendo: use la siguiente."
  exit 1
fi

ULTIMA=$(git tag --list 'v*' --sort=-v:refname | head -1)
if [[ -n "$ULTIMA" ]]; then
  MAYOR=$(printf '%s\n%s\n' "${ULTIMA#v}" "${VERSION#v}" | sort -V | tail -1)
  [[ "$MAYOR" == "${VERSION#v}" ]] \
    || { rojo "✗ $VERSION es anterior a la ultima etiqueta ($ULTIMA)."; exit 1; }
fi

# --- El commit, el publicado ------------------------------------------------
DESTINO=$(git rev-parse "${COMMIT:-origin/main}")
git merge-base --is-ancestor "$DESTINO" origin/main \
  || { rojo "✗ Ese commit no esta en origin/main: se etiqueta lo que esta publicado."; exit 1; }
if [[ -z "$COMMIT" && "$DESTINO" != "$(git rev-parse origin/main)" ]]; then
  rojo "✗ origin/main se movio mientras tanto."; exit 1
fi

ASUNTO=$(git log -1 --format='%s' "$DESTINO")
echo
echo "  Version : $VERSION   (la anterior: ${ULTIMA:-ninguna})"
echo "  Commit  : $(git rev-parse --short "$DESTINO")  $ASUNTO"
echo "  Despliega: consola, reglas e indices de Firestore, Functions y Storage."
echo

git tag -a "$VERSION" "$DESTINO" -m "$VERSION"
git push --quiet origin "refs/tags/$VERSION"
verde "✓ $VERSION creada y subida."

if [[ "$SEGUIR" -eq 0 ]]; then
  gris "  El pipeline arranca solo. La aprobacion del entorno se pide en GitHub."
  exit 0
fi

# --- La corrida, seguida ----------------------------------------------------
command -v gh >/dev/null || { gris "  (sin gh: siga la corrida en GitHub)"; exit 0; }
REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || echo '')
gris "  Esperando a que arranque la corrida..."
gris "  (esto NO se cuelga: el pipeline corre en GitHub y este proceso solo mira;"
gris "   puede cortarlo con Ctrl+C cuando quiera, la etiqueta ya esta subida)"
ID=""
for _ in $(seq 1 30); do
  ID=$(gh run list --workflow ci-node-firebase.yml --event push --limit 20 \
        --json databaseId,headBranch --jq "[.[] | select(.headBranch==\"$VERSION\")][0].databaseId" 2>/dev/null || echo '')
  [[ -n "$ID" && "$ID" != "null" ]] && break
  sleep 5
done
if [[ -z "$ID" || "$ID" == "null" ]]; then
  gris "  No aparecio todavia. Mirela en: https://github.com/$REPO/actions"
  exit 0
fi
# EL ENLACE SE IMPRIME AL FINAL, Y UNA SOLA LINEA SE REESCRIBE MIENTRAS TANTO.
# `gh run watch` volcaba cientos de lineas de cada job: el enlace quedaba
# sepultado arriba, la terminal no dejaba subir a buscarlo, y no se distinguia
# «sigue corriendo» de «se colgo» (Andres, 20/09/2026, dos veces).
ENLACE="https://github.com/$REPO/actions/runs/$ID"
avisado=""
while :; do
  ESTADO=$(gh run view "$ID" --json status,conclusion --jq '"\(.status)/\(.conclusion // "")"' 2>/dev/null || echo "?")
  case "$ESTADO" in
    completed/success)
      printf '\r%-78s\n' " "
      verde "✓ Despliegue terminado y en verde."
      echo "  $ENLACE"
      exit 0 ;;
    completed/*)
      printf '\r%-78s\n' " "
      rojo "✗ La corrida no termino bien ($ESTADO)."
      echo "  $ENLACE"
      exit 1 ;;
  esac
  PENDIENTE=$(gh api "repos/$REPO/actions/runs/$ID/pending_deployments" --jq 'length' 2>/dev/null || echo 0)
  if [[ "$PENDIENTE" != "0" && "$avisado" != "espera" ]]; then
    printf '\r%-78s\n' " "
    echo
    verde "  ⏸  EL PIPELINE PASO Y AHORA LO ESPERA A USTED."
    verde "  Apruebe el entorno «production» acá (boton «Review deployments»):"
    echo
    echo "      $ENLACE"
    echo
    gris "  Esta pantalla solo mira: puede cerrarla con Ctrl+C cuando quiera."
    avisado=espera
  elif [[ "$PENDIENTE" == "0" && "$avisado" == "espera" ]]; then
    printf '\r%-78s\n' " "
    verde "  ▶  Aprobado: desplegando..."
    avisado=desplegando
  fi
  printf '\r  %s · %s ' "$(date +%H:%M:%S)" "$ESTADO"
  sleep 10
done
