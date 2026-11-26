#!/usr/bin/env bash
# Enciende (o apaga, o revierte) el CATÁLOGO EXTERNO (NovuTienda) de UN comercio, EN SECO por omisión, sin que el id del
# proyecto pase por la pantalla ni por la línea de comandos. La lógica, el respaldo y la vuelta atrás viven en
# admin/scripts/plataforma/aplicar-catalogo-externo.mjs; este envoltorio solo resuelve el proyecto y pone las llaves.
#
#   ./scripts/catalogo-externo.sh --entorno staging|produccion --tenant <id> --monedas BOB,ARS [--crear-documento]
#   ./scripts/catalogo-externo.sh --entorno staging|produccion --tenant <id> --desactivar
#   ./scripts/catalogo-externo.sh --entorno staging|produccion --tenant <id> --revertir <respaldo>
#   … y para escribir, al final:  --aplicar --confirmo <el mismo entorno>
#
# SECO por omisión: lee y muestra «hoy → después», no escribe. Escribe SOLO con `--aplicar --confirmo <entorno>`
# (escrito a mano, igual a --entorno); en producción además pasa `--confirmo-produccion <tenant>` al script de Node.
# RESPALDO obligatorio al escribir, en /var/tmp/novuchat-respaldos-<uid>/ (fuera del repositorio, sobrevive a un
# reinicio, pero systemd-tmpfiles BORRA /var/tmp a los 30 días: para conservarlo más, cópielo a un lugar durable): la carpeta la crea este envoltorio con 0700 y exige que sea del usuario, no un enlace y 0700; el archivo lo
# escribe el script de Node con 0600 y nunca pisa otro. Se imprime su ruta (no es secreta). `--revertir` solo acepta un
# .json de esa carpeta, regular, del usuario y 0600 (seco primero; con --aplicar --confirmo <entorno> restaura).
#
# EL PROYECTO, sin imprimirlo (como nube-visor.sh): GCP_PROJECT_ID_STAGING y GCP_PROJECT_ID_PROD, LAS DOS, del entorno o,
# si faltan, de `gh variable get --repo` (si están las dos fuentes, tienen que coincidir). Tres llaves más, en este orden:
#   1. cada id tiene que dar la HUELLA de su entorno fijada abajo (sha256 del id, 12 hex): un tercer proyecto, aunque
#      la misma cuenta lo pueda escribir, no pasa;
#   2. el quota_project_id de las credenciales de gcloud (CLOUDSDK_CONFIG, por omisión ~/.config/gcloud-novuchat-prod;
#      la misma cuenta es dueña de los dos proyectos) tiene que ser el de producción;
#   3. el script de Node vuelve a validar la lista blanca (comprobarProyecto).
# Los ids llegan a Node SOLO por su entorno (un subshell que desexporta todo y exporta una lista blanca; nunca por argv:
# Node recibe `--entorno`). Toda la salida pasa por un filtro que tapa los ids, números largos y cuentas.
# No hace ninguna llamada de gcloud: el script de Node usa las credenciales de aplicación de ese CLOUDSDK_CONFIG.
#
# Salida: la del script de Node (0 nada que hacer o escrito y comprobado · 1 el seco encontró diferencias · 2 uso o
# salvaguarda, nada escrito · 3 error de ejecución · 130 Ctrl-C), y 2 para todo lo que este envoltorio rechaza.
#
# COSTO: el del script de Node (seco: 1 lectura; --aplicar: 2 lecturas y 1 escritura de un campo). 0 mensajes.
# Contra producción: con el «sí» de Andres, staging y seco primero.
set -euo pipefail
case "$-" in *x*) echo "✗ xtrace activo (bash -x): imprimiría el id del proyecto. No se hizo nada." >&2; exit 2 ;; esac
[[ "${SHELLOPTS:-}" != *xtrace* ]] || { echo "✗ SHELLOPTS=xtrace en el entorno: imprimiría el id del proyecto. No se hizo nada." >&2; exit 2; }
set +x
# Los nombres que llevan ids no se heredan: se desexportan y se descartan antes de fijarlos aquí.
export -n P OTRO CUOTA STAGING PROD 2>/dev/null || true
unset P OTRO CUOTA STAGING PROD
# El arranque no hereda comportamiento: sin BASH_ENV/ENV (los bash hijos no lo leen) ni funciones exportadas (una función
# `sha256sum` o `command` falsearía la huella o la búsqueda de node). node y gh se resuelven con el PATH de quien llama
# (nvm, ~/.local/bin) y desde ahí se usan por RUTA ABSOLUTA; todo lo demás (sha256sum, sed, grep, mkdir, stat, env) sale
# de un PATH de sistema fijo, también el de Node.
unset BASH_ENV ENV
while IFS= read -r f; do builtin unset -f "$f"; done < <(compgen -A function)
NODO="$(command -v node || true)"
[[ "$NODO" == /* && -x "$NODO" ]] || { echo "✗ No encuentro node (ruta absoluta y ejecutable)" >&2; exit 2; }
GH="$(command -v gh || true)"
[[ -z "$GH" || "$GH" == /* ]] || GH=""
readonly PATH_SISTEMA="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
PATH="$PATH_SISTEMA"; export PATH
hash -r

# Huellas de los proyectos (sha256 del id, primeros 12 hex). Cambian solo si cambia el proyecto: entonces, con el «sí» de
# Andres, se recalculan sin imprimir el id y se actualizan aquí. RIESGO ACEPTADO (revisión del 25/11/2026): en un
# repositorio público, una huella permite CONFIRMAR una adivinanza del id (poca entropía); no da acceso, porque escribir
# exige igual las credenciales. La alternativa (HMAC con un secreto local) agregaría un secreto que hoy no hace falta.
readonly HUELLA_STAGING="2dedea95e190"
readonly HUELLA_PROD="100cf4f1401f"
readonly BASE_RESPALDOS="/var/tmp"

ESTE="$(readlink -f "${BASH_SOURCE[0]}")"
RAIZ="$(dirname "$(dirname "$ESTE")")"
readonly REPO="segurolotengopy/NovuChat"
readonly FORMA_PROYECTO='^[a-z][a-z0-9-]{4,28}[a-z0-9]$'
readonly FORMA_TENANT='^[a-z0-9][a-z0-9-]{2,59}$'

ayuda() { awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$ESTE"; }

ENTORNO=""; TENANT=""; MONEDAS=""; DESACTIVAR=0; CREAR=0; REVERTIR=""; APLICAR=0; CONFIRMO=""
necesita() { [[ $# -ge 2 && "$2" != --* ]] || { echo "✗ $1 requiere un valor" >&2; exit 2; }; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --entorno)         necesita "$@"; ENTORNO="$2"; shift 2 ;;
    --tenant)          necesita "$@"; TENANT="$2"; shift 2 ;;
    --monedas)         necesita "$@"; MONEDAS="$2"; shift 2 ;;
    --desactivar)      DESACTIVAR=1; shift ;;
    --crear-documento) CREAR=1; shift ;;
    --revertir)        necesita "$@"; REVERTIR="$2"; shift 2 ;;
    --aplicar)         APLICAR=1; shift ;;
    --confirmo)        necesita "$@"; CONFIRMO="$2"; shift 2 ;;
    -h|--help)         ayuda; exit 0 ;;
    *) echo "✗ Opción desconocida (ver --help). No se hizo nada." >&2; exit 2 ;;
  esac
done

# --- Uso, antes de mirar credenciales ---------------------------------------------------------------------------
[[ "$ENTORNO" == staging || "$ENTORNO" == produccion ]] \
  || { echo "✗ --entorno es obligatorio: staging o produccion (sin valor por omisión)" >&2; exit 2; }
[[ "$TENANT" =~ $FORMA_TENANT ]] || { echo "✗ --tenant: id de UN comercio (minúsculas, dígitos y guiones)" >&2; exit 2; }
MODOS=0
[[ -n "$MONEDAS" ]] && MODOS=$((MODOS + 1))
(( DESACTIVAR )) && MODOS=$((MODOS + 1))
[[ -n "$REVERTIR" ]] && MODOS=$((MODOS + 1))
(( MODOS == 1 )) || { echo "✗ Un solo modo: --monedas, --desactivar o --revertir <respaldo>" >&2; exit 2; }
if (( CREAR )) && [[ -z "$MONEDAS" ]]; then echo "✗ --crear-documento solo va con --monedas" >&2; exit 2; fi
if [[ -n "$CONFIRMO" ]] && (( ! APLICAR )); then echo "✗ --confirmo solo va con --aplicar" >&2; exit 2; fi
if (( APLICAR )) && [[ "$CONFIRMO" != "$ENTORNO" ]]; then
  echo "✗ --aplicar exige --confirmo ${ENTORNO} (escrito a mano, igual a --entorno). No se escribió nada." >&2; exit 2
fi
[[ -n "${HOME:-}" ]] || { echo "✗ HOME no está definido: no se sigue" >&2; exit 2; }

# --- La carpeta de respaldos: del usuario, 0700, fuera del repositorio --------------------------------------------
DIR_RESPALDOS="${BASE_RESPALDOS}/novuchat-respaldos-$(id -u)"
carpeta_propia() { [[ ! -L "$DIR_RESPALDOS" && -d "$DIR_RESPALDOS" && "$(stat -c '%u %a' -- "$DIR_RESPALDOS" 2>/dev/null)" == "$(id -u) 700" ]]; }
if [[ -n "$REVERTIR" ]]; then
  carpeta_propia || { echo "✗ ${DIR_RESPALDOS} no es una carpeta del usuario con modo 700 (o es un enlace): no se sigue" >&2; exit 2; }
  [[ "$REVERTIR" != *..* && "$(dirname -- "$REVERTIR")" == "$DIR_RESPALDOS" && "$REVERTIR" == *.json && ! -L "$REVERTIR" && -f "$REVERTIR" ]] \
    || { echo "✗ --revertir: un respaldo .json (no un enlace) de ${DIR_RESPALDOS}" >&2; exit 2; }
  [[ "$(stat -c '%u %a' -- "$REVERTIR" 2>/dev/null)" == "$(id -u) 600" ]] || { echo "✗ el respaldo tiene que ser del usuario y de modo 600" >&2; exit 2; }
fi

# --- El proyecto, sin imprimirlo ----------------------------------------------------------------------------------
CONFIG_GCLOUD="${CLOUDSDK_CONFIG:-$HOME/.config/gcloud-novuchat-prod}"
for v in "${!CLOUDSDK_@}"; do unset "$v"; done
ADC="$CONFIG_GCLOUD/application_default_credentials.json"
[[ -f "$ADC" && -r "$ADC" ]] || { echo "✗ No encuentro las credenciales de aplicación de gcloud (application_default_credentials.json)" >&2; exit 2; }
CUOTA="$(grep -o '"quota_project_id": *"[^"]*"' "$ADC" 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/' | head -n 1 || true)"
[[ "$CUOTA" =~ $FORMA_PROYECTO ]] || { echo "✗ Las credenciales de gcloud no traen un quota_project_id con forma de id: no se puede cruzar el proyecto" >&2; exit 2; }

leer_variable() { # variable del repositorio con gh, solo lectura; vacío si no se puede. El valor nunca se imprime.
  [[ -n "$GH" ]] || return 0
  # GH_CONFIG_DIR se CONSERVA a propósito (el proyecto lo usa para la segunda cuenta); lo demás que desvía a gh, no. Un
  # valor desviado igual lo rechazan las huellas.
  env -u GH_REPO -u GH_HOST -u GH_ENTERPRISE_TOKEN -u GH_TOKEN -u GITHUB_TOKEN -u GH_DEBUG -u GH_PAGER \
    -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy -u ALL_PROXY -u all_proxy \
    "$GH" variable get "$1" --repo "$REPO" 2>/dev/null || true
}
# Del entorno o de gh; si están las dos fuentes, tienen que coincidir (un id heredado no reemplaza al del repositorio).
resolver() { # $1 = nombre de la variable; imprime el valor elegido (a una variable, nunca a la pantalla)
  local del_entorno="${!1:-}" del_repo
  del_entorno="${del_entorno//[[:space:]]/}"
  del_repo="$(leer_variable "$1")"; del_repo="${del_repo//[[:space:]]/}"
  if [[ -n "$del_entorno" && -n "$del_repo" && "$del_entorno" != "$del_repo" ]]; then return 1; fi
  printf '%s' "${del_entorno:-$del_repo}"
}
huella() { printf '%s' "$1" | sha256sum | cut -c1-12; }
STAGING="$(resolver GCP_PROJECT_ID_STAGING)" || { echo "✗ GCP_PROJECT_ID_STAGING del entorno no coincide con la variable del repositorio: no se sigue" >&2; exit 2; }
PROD="$(resolver GCP_PROJECT_ID_PROD)" || { echo "✗ GCP_PROJECT_ID_PROD del entorno no coincide con la variable del repositorio: no se sigue" >&2; exit 2; }
[[ -n "$STAGING" && -n "$PROD" ]] || { echo "✗ Faltan GCP_PROJECT_ID_STAGING o GCP_PROJECT_ID_PROD (hacen falta las dos para no confundir proyectos)" >&2; exit 2; }
[[ "$STAGING" =~ $FORMA_PROYECTO && "$PROD" =~ $FORMA_PROYECTO ]] \
  || { echo "✗ GCP_PROJECT_ID_STAGING o GCP_PROJECT_ID_PROD no tienen la forma de un id de Google Cloud" >&2; exit 2; }
[[ "$(huella "$STAGING")" == "$HUELLA_STAGING" ]] || { echo "✗ GCP_PROJECT_ID_STAGING no es el proyecto de staging (su huella no coincide): no se sigue" >&2; exit 2; }
[[ "$(huella "$PROD")" == "$HUELLA_PROD" ]] || { echo "✗ GCP_PROJECT_ID_PROD no es el proyecto de producción (su huella no coincide): no se sigue" >&2; exit 2; }
[[ "$CUOTA" == "$PROD" ]] || { echo "✗ El proyecto de las credenciales de gcloud no es el de producción: no se sigue" >&2; exit 2; }
if [[ "$ENTORNO" == produccion ]]; then P="$PROD"; OTRO="$STAGING"; else P="$STAGING"; OTRO="$PROD"; fi

# --- Argumentos del script de Node (sin ningún id) ----------------------------------------------------------------
ARGS=(--entorno "$ENTORNO" --tenant "$TENANT")
RESPALDO=""
if [[ -n "$REVERTIR" ]]; then
  ARGS+=(--revertir --respaldo "$REVERTIR")
else
  if [[ -n "$MONEDAS" ]]; then ARGS+=(--monedas "$MONEDAS"); else ARGS+=(--desactivar); fi
  if (( CREAR )); then ARGS+=(--crear-documento); fi
  if (( APLICAR )); then
    # /var/tmp es 1777: el script de Node exige una carpeta del usuario y 0700. Se crea aquí y se comprueba (otro usuario
    # pudo crearla antes, o ser un enlace): si no es nuestra y 0700, no se sigue.
    ( umask 077; mkdir -m 0700 -- "$DIR_RESPALDOS" ) 2>/dev/null || true
    carpeta_propia || { echo "✗ ${DIR_RESPALDOS} no es una carpeta del usuario con modo 700 (o es un enlace). No se escribió nada." >&2; exit 2; }
    RESPALDO="${DIR_RESPALDOS}/catalogo-externo-${ENTORNO}-${TENANT}-$(date -u +%Y%m%dT%H%M%SZ).json"
    ARGS+=(--respaldo "$RESPALDO")
  fi
fi
if (( APLICAR )); then
  ARGS+=(--aplicar)
  if [[ "$ENTORNO" == produccion ]]; then ARGS+=(--confirmo-produccion "$TENANT"); fi
fi

if (( APLICAR )); then echo "Catálogo externo · ${ENTORNO} · ${TENANT} · APLICANDO"; else echo "Catálogo externo · ${ENTORNO} · ${TENANT} · seco (no escribe)"; fi
if [[ -n "$RESPALDO" ]]; then echo "  respaldo: ${RESPALDO}"; fi

# Lo que imprima Node (y firebase-admin) pasa por aquí: los ids, y cualquier número largo o cuenta, se tapan.
tapar() {
  local linea
  while IFS= read -r linea || [[ -n "$linea" ]]; do
    linea="${linea//"$P"/<proyecto>}"; linea="${linea//"$OTRO"/<proyecto>}"
    printf '%s\n' "$linea" | sed -E 's/[0-9]{9,}/<número>/g; s/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/<cuenta>/g'
  done
}

cd "$RAIZ/admin"
CAMINO="$PATH_SISTEMA"; CASA="$HOME"; IDIOMA="${LANG:-C.UTF-8}"; EXCLUIDOS="${NOVUCHAT_TENANTS_EXCLUIDOS:-}"
# Node arranca en un subshell que DESEXPORTA todo lo heredado (NODE_OPTIONS, emulador, proyecto, cuota, gRPC…) y exporta
# solo la lista blanca: los ids nunca pasan por argv (ni por el de `env`). Ctrl-C le llega a Node (avisa en qué punto
# quedó) y el filtro lo ignora para que ese aviso se vea.
set +e
(
  # shellcheck disable=SC2163  # se DESEXPORTA la variable cuyo nombre está en $v (no se exporta v)
  while IFS= read -r v; do export -n "$v" 2>/dev/null || true; done < <(compgen -e)
  while IFS= read -r f; do unset -f "$f" 2>/dev/null || true; done < <(compgen -A function)
  # Queda solo lo que bash no puede quitar (entradas heredadas con nombres que no son identificadores): Node no las lee.
  export PATH="$CAMINO" HOME="$CASA" LANG="$IDIOMA" GOOGLE_APPLICATION_CREDENTIALS="$ADC"
  export GCP_PROJECT_ID_STAGING="$STAGING" GCP_PROJECT_ID_PROD="$PROD"
  if [[ -n "$EXCLUIDOS" ]]; then export NOVUCHAT_TENANTS_EXCLUIDOS="$EXCLUIDOS"; fi
  exec "$NODO" scripts/plataforma/aplicar-catalogo-externo.mjs "${ARGS[@]}"
) 2>&1 | { trap '' INT; tapar; }
ESTADOS=("${PIPESTATUS[@]}")
set -e
exit "${ESTADOS[0]}"
