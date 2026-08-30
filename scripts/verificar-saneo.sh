#!/usr/bin/env bash
# =============================================================================
#  NovuChat — verificacion de saneo del repositorio publico
# =============================================================================
#  El repositorio github.com/segurolotengopy/NovuChat es PUBLICO. Este script
#  comprueba que ningun archivo versionado contenga valores reales de la
#  infraestructura. Ver CONVENCIONES-REPO-PUBLICO.md.
#
#  NINGUN VALOR REAL ESTA ESCRITO EN ESTE ARCHIVO. Eso es deliberado: el
#  script se versiona en el repositorio publico, asi que un grep con los
#  valores incrustados seria, el mismo, la fuga que intenta evitar.
#
#  Dos modos, que se ejecutan segun lo que haya disponible:
#
#    A. EXACTO (solo en la maquina del operador). Lee los valores reales de
#       CONFIGURACION.local.md (tabla §0) y de .env — ambos ignorados por git —
#       y verifica que ninguno aparezca en un archivo versionado. Es el modo
#       fuerte y el que hay que correr antes de cada commit.
#
#    B. PATRONES (siempre, tambien en CI). No conoce ningun valor real: busca
#       formas genericas — IPv4 publica, UUID, correos, secuencias largas de
#       digitos, dominios de DNS dinamico, tokens con prefijo conocido, llaves
#       privadas. En GitHub Actions solo corre este modo, porque los archivos
#       locales no se suben; alli el complemento es gitleaks.
#
#  USO:
#     ./scripts/verificar-saneo.sh              # ambos modos si puede
#     ./scripts/verificar-saneo.sh --patrones   # fuerza solo el modo B
#     ./scripts/verificar-saneo.sh --exacto     # exige el modo A (falla si no)
#
#  SALIDA: 0 limpio · 1 hallazgos · 2 error de uso o de entorno.
# =============================================================================
set -uo pipefail

cd "$(dirname "$0")/.."
RAIZ="$(pwd)"

MODO="${1:-auto}"
case "$MODO" in
  auto|--patrones|--exacto|-h|--help) ;;
  *) echo "Uso: $0 [--patrones|--exacto]" >&2; exit 2 ;;
esac
if [[ "$MODO" == "-h" || "$MODO" == "--help" ]]; then
  sed -n '2,32p' "$0"; exit 0
fi

rojo()  { printf '\033[1;31m%s\033[0m\n' "$*"; }
verde() { printf '\033[1;32m%s\033[0m\n' "$*"; }
gris()  { printf '\033[0;90m%s\033[0m\n' "$*"; }
titulo(){ printf '\n\033[1;34m== %s ==\033[0m\n' "$*"; }

HALLAZGOS=0

# --- Que archivos se consideran "versionados" -------------------------------
# git ls-files --cached --others --exclude-standard = lo ya rastreado mas lo
# no rastreado que NO esta ignorado, es decir exactamente lo que terminaria
# en el repositorio publico. Funciona aun antes del primer commit.
listar_archivos() {
  if git -C "$RAIZ" rev-parse --git-dir >/dev/null 2>&1; then
    git -C "$RAIZ" ls-files --cached --others --exclude-standard -z
  else
    gris "  (no hay repositorio git: se recorre el arbol excluyendo lo obvio)" >&2
    find "$RAIZ" \( -name .git -o -name node_modules -o -name __pycache__ \
      -o -name .venv -o -name venv -o -name Preliminares \) -prune -o \
      -type f ! -name '*.local.md' ! -name '.env' -print0 \
      | sed -z "s|^$RAIZ/||"
  fi
}

mapfile -d '' ARCHIVOS < <(listar_archivos)
if [[ ${#ARCHIVOS[@]} -eq 0 ]]; then
  rojo "No se encontro ningun archivo que revisar."; exit 2
fi
gris "Archivos candidatos a versionar: ${#ARCHIVOS[@]}"

# Para el modo B se excluyen los archivos de bloqueo de dependencias: son
# grafos generados por el gestor de paquetes, con miles de hashes y URLs, y
# producen ruido en todas las reglas de forma. El modo A si los revisa, porque
# ahi la busqueda es por valor exacto y no hay falsos positivos posibles.
ARCHIVOS_PATRON=()
for _a in "${ARCHIVOS[@]}"; do
  case "$_a" in
    *package-lock.json|*pnpm-lock.yaml|*yarn.lock|*Cargo.lock|*poetry.lock) continue ;;
  esac
  ARCHIVOS_PATRON+=("$_a")
done
gris "Archivos para el modo B (sin lockfiles): ${#ARCHIVOS_PATRON[@]}"

# grep -I descarta binarios (PNG, docx, jfif). -n numero de linea. -F/-E segun caso.
buscar_fijo() {  # $1 = cadena literal
  grep -InIF -- "$1" "${ARCHIVOS[@]}" 2>/dev/null
}
buscar_regex() { # $1 = ERE (modo B: sobre ARCHIVOS_PATRON)
  grep -InIE -- "$1" "${ARCHIVOS_PATRON[@]}" 2>/dev/null
}

enmascarar() {   # muestra lo justo para reconocer el valor sin reimprimirlo
  local v="$1" n=${#1}
  if (( n <= 6 )); then printf '%s' "***"
  else printf '%s…%s (%d car.)' "${v:0:3}" "${v: -2}" "$n"; fi
}

# ============================================================================
#  MODO A — comparacion contra los valores reales locales
# ============================================================================
VALORES=()

cargar_de_configuracion_local() {
  local f="$RAIZ/CONFIGURACION.local.md"
  [[ -f "$f" ]] || return 1
  # Filas de la tabla §0:  | `${MARCADOR}` | `valor` ... |
  while IFS= read -r linea; do
    local celda tok
    celda="$(printf '%s' "$linea" | awk -F'|' '{print $3}')"
    while IFS= read -r tok; do
      tok="${tok//\`/}"
      [[ -z "$tok" ]] && continue
      [[ "$tok" == '${'*'}' ]] && continue          # es otro marcador
      [[ "$tok" == REEMPLAZAR_* ]] && continue      # es un marcador de n8n
      [[ "${#tok}" -lt 6 ]] && continue             # demasiado corto para ser util
      VALORES+=("$tok")
    done < <(printf '%s' "$celda" | grep -o '`[^`]*`' || true)
  done < <(grep -E '^\| *`(\$\{[A-Z0-9_]+\}|REEMPLAZAR_[^`]*)` *\|' "$f" | grep -vi 'pendiente')
  return 0
}

cargar_de_env() {
  local f="$RAIZ/.env"
  [[ -f "$f" ]] || return 1
  local clave valor
  while IFS='=' read -r clave valor; do
    clave="${clave// /}"
    [[ "$clave" =~ ^[A-Z][A-Z0-9_]*$ ]] || continue
    valor="${valor%\"}"; valor="${valor#\"}"
    valor="${valor%\'}"; valor="${valor#\'}"
    [[ -z "$valor" ]] && continue
    [[ "${#valor}" -lt 6 ]] && continue
    # valores publicos por definicion, no son fugas
    case "$clave" in WA_GRAPH_VERSION|VM_USER) continue ;; esac
    VALORES+=("$valor")
  done < <(grep -vE '^[[:space:]]*#' "$f")
  return 0
}

# De cada valor derivamos las formas en que puede aparecer escrito:
# la URL sin esquema, el UUID suelto dentro de una ruta, los grupos de digitos
# de un telefono con formato. Asi "https://x.tld" tambien detecta "x.tld".
derivar_variantes() {
  local v="$1" x
  printf '%s\n' "$v"
  x="${v#http://}"; x="${x#https://}"; x="${x%/}"
  [[ "$x" != "$v" && ${#x} -ge 6 ]] && printf '%s\n' "$x"
  printf '%s' "$v" | grep -oE '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}' || true
  printf '%s' "$v" | tr -c '0-9-' '\n' | grep -E '^[0-9-]{6,}$' || true
}

modo_exacto() {
  titulo "Modo A — valores reales tomados de CONFIGURACION.local.md y .env"
  local hay_local=0 hay_env=0
  cargar_de_configuracion_local && hay_local=1
  cargar_de_env && hay_env=1
  if [[ $hay_local -eq 0 && $hay_env -eq 0 ]]; then
    return 3   # no hay fuentes locales
  fi
  [[ $hay_local -eq 1 ]] && gris "  fuente: CONFIGURACION.local.md" \
                         || gris "  fuente: (falta CONFIGURACION.local.md)"
  [[ $hay_env -eq 1 ]]   && gris "  fuente: .env" \
                         || gris "  fuente: (falta .env)"

  local total=0 v var res
  local -A vistos=()
  for v in "${VALORES[@]}"; do
    while IFS= read -r var; do
      [[ -z "$var" ]] && continue
      [[ "${#var}" -lt 6 ]] && continue
      [[ -n "${vistos[$var]:-}" ]] && continue
      vistos[$var]=1
      total=$((total+1))
      res="$(buscar_fijo "$var")"
      if [[ -n "$res" ]]; then
        rojo "  ✗ valor real presente: $(enmascarar "$var")"
        printf '%s\n' "$res" | sed 's/^/      /' | cut -c1-160
        HALLAZGOS=$((HALLAZGOS+1))
      fi
    done < <(derivar_variantes "$v")
  done
  gris "  ${total} cadena(s) sensible(s) comprobadas contra ${#ARCHIVOS[@]} archivos"
  return 0
}

# ============================================================================
#  MODO B — patrones genericos (no conoce ningun valor real)
# ============================================================================
# Ejemplos deliberadamente falsos que aparecen en la documentacion y no deben
# disparar el escaneo. Se listan aca, a la vista, para que se note si crecen.
PERMITIDOS='(00000000-0000-0000-0000-000000000000|1234567890123456|gemini-code-[0-9]{13}|59170000000|59100000000|109xxxxxxxxxxx|example\.(com|org)|ejemplo\.(tld|com)|@group\.calendar\.google\.com|noreply@anthropic\.com|REEMPLAZAR|AKIAIOSFODNN7EXAMPLE|[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com|[0-9]*0{6,}[0-9]*)'

# Exclusiones por FORMA DE LINEA, no por valor. Se aplican despues de
# PERMITIDOS y se listan aparte para que se vea que ninguna oculta un secreto:
#   - `uses: accion@<sha de 40 hex>` es el pineado por SHA que exige el
#     estandar; sus tramos de digitos disparan la regla de secuencias largas.
#   - las lineas de integridad de paquetes (sha256-/sha512-) son hashes.
# Nota sobre *.iam.gserviceaccount.com: no son dato personal ni secreto.
# Se derivan del id del proyecto y su forma es justamente lo que el
# instructivo de despliegue necesita mostrar. Los correos de PERSONAS
# siguen disparando la regla.
LINEAS_EXCLUIDAS='(uses: *[^ ]+@[0-9a-f]{40}|integrity: *sha[0-9]+-|resolved: *"?https://registry\.)'

regla() { # $1 = nombre, $2 = ERE
  local nombre="$1" ere="$2" res
  res="$(buscar_regex "$ere" | grep -vE "$LINEAS_EXCLUIDAS" | grep -vE "$PERMITIDOS" || true)"
  if [[ -n "$res" ]]; then
    rojo "  ✗ ${nombre}"
    printf '%s\n' "$res" | sed 's/^/      /' | cut -c1-160
    HALLAZGOS=$((HALLAZGOS+1))
  else
    verde "  ✓ ${nombre}"
  fi
}

modo_patrones() {
  titulo "Modo B — patrones genericos (el unico que corre en CI)"

  # IPv4 publica: se descartan privadas, loopback, enlace local y multicast.
  local ipv4_priv='(^|[^0-9])(0|10|127|169\.254|192\.168|172\.(1[6-9]|2[0-9]|3[01])|22[4-9]|23[0-9]|24[0-9]|25[0-5])\.'
  local res
  res="$(buscar_regex '(^|[^0-9.])([0-9]{1,3}\.){3}[0-9]{1,3}([^0-9.]|$)' \
        | grep -vE "$LINEAS_EXCLUIDAS" | grep -vE "$PERMITIDOS" | grep -vE "$ipv4_priv" || true)"
  if [[ -n "$res" ]]; then
    rojo "  ✗ direccion IPv4 publica"
    printf '%s\n' "$res" | sed 's/^/      /' | cut -c1-160
    HALLAZGOS=$((HALLAZGOS+1))
  else
    verde "  ✓ direccion IPv4 publica"
  fi

  regla "UUID (ruta de webhook, identificadores)" \
        '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
  regla "correo electronico" \
        '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
  regla "secuencia de 10 o mas digitos (IDs de Meta, telefonos)" \
        '(^|[^0-9])[0-9]{10,}([^0-9]|$)'
  regla "dominio de DNS dinamico o tunel" \
        '\.(duckdns\.org|ngrok(-free)?\.(io|app|dev)|no-ip\.(org|com)|dyndns\.org|serveo\.net|trycloudflare\.com|loca\.lt)'
  regla "token de Meta / Facebook" \
        'EAA[A-Za-z0-9]{20,}'
  regla "clave de API de Google" \
        'AIza[0-9A-Za-z_-]{30,}'
  regla "token de OpenAI / Anthropic" \
        '(sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,})'
  regla "token de GitHub" \
        '(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})'
  regla "token de Slack" \
        'xox[baprs]-[A-Za-z0-9-]{10,}'
  regla "clave de acceso de AWS" \
        'AKIA[0-9A-Z]{16}'
  regla "llave privada en claro" \
        '-----BEGIN ([A-Z ]+ )?PRIVATE KEY-----'
  regla "clave JSON de cuenta de servicio de Google" \
        '"type": *"service_account"'
  regla "ruta absoluta con nombre de usuario del sistema" \
        '/(home|Users)/[a-z][a-z0-9._-]+/'

  # Regla propia del proyecto. El flujo de trabajo de NovuChat es exportar el
  # JSON desde la interfaz de n8n y reemplazar el archivo del repositorio; el
  # export trae los valores reales del nodo `Config del negocio`. Un JSON de
  # flujo SIN ningun REEMPLAZAR_ es la senal mas confiable de que se
  # commiteo un export sin sanear. Ver CONFIGURACION.local.md §0.b.
  local json faltan=()
  for json in "${ARCHIVOS[@]}"; do
    case "$json" in Flujos/*.json) ;; *) continue ;; esac
    [[ -f "$json" ]] || continue
    grep -q 'REEMPLAZAR_' "$json" || faltan+=("$json")
  done
  if [[ ${#faltan[@]} -gt 0 ]]; then
    rojo "  ✗ JSON de flujo sin ningun marcador REEMPLAZAR_"
    printf '      %s\n' "${faltan[@]}"
    gris "      Parece un export de n8n sin sanear. Reemplace los valores del"
    gris "      nodo 'Config del negocio' por sus marcadores REEMPLAZAR_*."
    HALLAZGOS=$((HALLAZGOS+1))
  else
    verde "  ✓ JSON de flujo conservan sus marcadores REEMPLAZAR_"
  fi
}

# ============================================================================
#  Orquestacion
# ============================================================================
echo "NovuChat — verificacion de saneo del repositorio publico"

CORRIO_EXACTO=0
if [[ "$MODO" != "--patrones" ]]; then
  modo_exacto; rc=$?
  if [[ $rc -eq 3 ]]; then
    if [[ "$MODO" == "--exacto" ]]; then
      rojo "Modo exacto exigido pero no hay CONFIGURACION.local.md ni .env."
      exit 2
    fi
    titulo "Modo A — omitido"
    gris "  No hay CONFIGURACION.local.md ni .env en esta maquina."
    gris "  Es lo esperado en GitHub Actions: alli manda el modo B + gitleaks."
  else
    CORRIO_EXACTO=1
  fi
fi

[[ "$MODO" != "--exacto" ]] && modo_patrones

echo
if [[ $HALLAZGOS -eq 0 ]]; then
  verde "Saneo correcto: 0 hallazgos."
  [[ $CORRIO_EXACTO -eq 0 ]] && gris "Recordatorio: el modo exacto no corrio en esta ejecucion."
  exit 0
else
  rojo "${HALLAZGOS} hallazgo(s). NO commitear hasta reemplazar por marcadores."
  gris "Tabla de marcadores: CONVENCIONES-REPO-PUBLICO.md"
  exit 1
fi
