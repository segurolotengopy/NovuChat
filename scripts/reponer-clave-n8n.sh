#!/usr/bin/env bash
# Repone N8N_API_KEY en uno o varios archivos .env SIN que el valor aparezca nunca
# en pantalla, en el historial, en argumentos de procesos ni en un archivo temporal.
#
# Existe por el incidente del 27/10/2026: la API de n8n respondio 401 a todas las
# sesiones a la vez (clave rotada, revocada o contenedor recreado). La clave nueva la
# emite Andres en n8n (Ajustes > API de n8n) y la teclea AQUI, oculta; Claude no la ve.
# Andres autoriza y Claude opera: este script lo corre Claude con el «si» de Andres.
#
#   ./scripts/reponer-clave-n8n.sh sonda --env .env [--env otro.env ...]
#       SOLO LEE. Por cada .env hace UNA peticion minima a la API con la clave que ya
#       tiene y dice solo el codigo HTTP (200 = sirve, 401 = no sirve, 000 = sin red).
#
#   ./scripts/reponer-clave-n8n.sh reponer --env .env --env .env.rroca-ruben ... [--aplicar]
#       Pide la clave nueva (entrada oculta, o la primera linea de la entrada estandar
#       con --stdin), valida su forma, comprueba con UNA peticion que n8n la acepta
#       (200) y, solo con --aplicar, la escribe en cada .env (chmod 600, reemplazo
#       atomico, el resto del archivo intacto) y confirma con otra peticion por .env.
#       Sin --aplicar (seco) no escribe nada.
#
#   ./scripts/reponer-clave-n8n.sh copiar --desde .env --env .env.rroca-ruben ... [--aplicar]
#       Igual que reponer, pero la clave sale del N8N_API_KEY de OTRO .env (--desde) que
#       hoy sirve: no hace falta emitir una clave nueva. Misma comprobacion previa (200),
#       mismo seco por omisión, misma escritura atomica y misma confirmacion.
#
# Antes de escribir deja un respaldo 600 `<env>.respaldo-AAAAMMDD-HHMMSS` con la clave vieja.
# Nunca imprime la clave, ni siquiera su largo, ni en los errores. Tampoco las URL ni
# los nombres de host: los .env se nombran por su ruta. Salida: 0 todo bien; 1 algun
# .env quedo sin comprobar o con 401; 2 mal uso o mal entorno (no se escribe nada).
set -uo pipefail
umask 077

uso() { sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; }
die() { echo "✗ $*" >&2; exit 2; }

MODO="${1:-}"; [[ -n "$MODO" ]] && shift
case "$MODO" in sonda|reponer|copiar) ;; -h|--help|"") uso; exit 0 ;; *) die "Modo desconocido (use sonda o reponer)" ;; esac

ENVS=(); APLICAR=0; DESDE_STDIN=0; DESDE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)     [[ -n "${2:-}" ]] || die "--env necesita un archivo"; ENVS+=("$2"); shift 2 ;;
    --env=*)   ENVS+=("${1#*=}"); shift ;;
    --desde)   [[ -n "${2:-}" ]] || die "--desde necesita un archivo"; DESDE="$2"; shift 2 ;;
    --aplicar) APLICAR=1; shift ;;
    --stdin)   DESDE_STDIN=1; shift ;;
    -h|--help) uso; exit 0 ;;
    *) die "Opcion desconocida: $1" ;;
  esac
done
[[ ${#ENVS[@]} -gt 0 ]] || die "Falta al menos un --env"
[[ "$MODO" != "sonda" || ( $APLICAR -eq 0 && $DESDE_STDIN -eq 0 && -z "$DESDE" ) ]] || die "--aplicar, --stdin y --desde no son del modo sonda"
[[ "$MODO" == "copiar" || -z "$DESDE" ]] || die "--desde es del modo copiar"
[[ "$MODO" != "copiar" || ( $DESDE_STDIN -eq 0 && -n "$DESDE" && -f "$DESDE" ) ]] || die "copiar necesita --desde con un archivo existente (y no usa --stdin)"

# Un .env: debe existir, ser archivo comun (no enlace a otro lado que no sea el real) y traer la URL base.
valor_de() { # valor_de <archivo> <NOMBRE>: ultima asignacion, sin comillas ni espacios; no ejecuta el archivo
  local v; v="$(grep -E "^[[:space:]]*(export[[:space:]]+)?$2=" "$1" | tail -n1)" || true
  v="${v#*=}"; v="${v%$'\r'}"; v="${v#\"}"; v="${v%\"}"; v="${v#\'}"; v="${v%\'}"
  printf '%s' "$v"
}
for f in "${ENVS[@]}"; do
  [[ -f "$f" ]] || die "No existe $f"
  [[ -n "$(valor_de "$f" N8N_BASE_URL)" ]] || die "$f no trae N8N_BASE_URL"
  [[ "$(valor_de "$f" N8N_BASE_URL)" == https://* ]] || die "$f: N8N_BASE_URL debe ser https"
  if [[ "$MODO" != "sonda" ]]; then
    grep -qE "^[[:space:]]*N8N_API_KEY=" "$f" || die "$f no trae una linea N8N_API_KEY= que reponer"
  fi
done

# UNA peticion minima; la clave viaja a curl por la entrada estandar (-H @-), nunca por argumentos.
# Imprime solo el codigo HTTP (000 si no hubo respuesta). El cuerpo se descarta y los errores de curl se silencian.
sondear() { # sondear <base> <clave>
  local cod
  cod="$(curl -sS --max-time 90 --connect-timeout 15 --proto '=https' -o /dev/null -w '%{http_code}' \
    -H @- "${1%/}/api/v1/executions?limit=1" 2>/dev/null <<<"X-N8N-API-KEY: $2")" || cod="000"
  [[ "$cod" =~ ^[0-9]{3}$ ]] || cod="000"
  printf '%s' "$cod"
}

if [[ "$MODO" == "sonda" ]]; then
  mal=0
  for f in "${ENVS[@]}"; do
    clave="$(valor_de "$f" N8N_API_KEY)"
    if [[ -z "$clave" ]]; then echo "$f: sin N8N_API_KEY"; mal=1; continue; fi
    cod="$(sondear "$(valor_de "$f" N8N_BASE_URL)" "$clave")"; clave=""
    echo "$f: HTTP $cod"; [[ "$cod" == 200 ]] || mal=1
  done
  exit "$mal"
fi

# --- reponer --------------------------------------------------------------------------------
if [[ "$MODO" == "copiar" ]]; then
  NUEVA="$(valor_de "$DESDE" N8N_API_KEY)"
elif [[ $DESDE_STDIN -eq 1 ]]; then
  IFS= read -r NUEVA || true
else
  [[ -r /dev/tty ]] || die "Sin terminal para pedir la clave oculta (use --stdin)"
  printf 'Clave nueva de la API de n8n (no se muestra): ' >/dev/tty
  IFS= read -rs NUEVA </dev/tty || true
  printf '\n' >/dev/tty
fi
NUEVA="${NUEVA%$'\r'}"
# Forma: JWT o clave de n8n; caracteres seguros para un .env sin comillas, sin espacios ni saltos.
if [[ -z "$NUEVA" ]]; then die "No se recibio ninguna clave"; fi
if [[ ! "$NUEVA" =~ ^[A-Za-z0-9._~+/=-]{20,2000}$ ]]; then die "La clave no tiene la forma esperada (se aborta sin escribir)"; fi

# La clave nueva debe servir ANTES de escribir nada.
BASE="$(valor_de "${ENVS[0]}" N8N_BASE_URL)"
cod="$(sondear "$BASE" "$NUEVA")"
if [[ "$cod" != 200 ]]; then
  NUEVA=""; echo "✗ n8n respondio HTTP $cod con la clave nueva: no se escribe nada."; exit 1
fi
echo "✓ n8n acepta la clave nueva (HTTP 200)."
if [[ $APLICAR -eq 0 ]]; then
  NUEVA=""; echo "Seco: no se escribio nada en ${#ENVS[@]} archivo(s). Repita con --aplicar."; exit 0
fi

mal=0
SELLO="$(date +%Y%m%d-%H%M%S)"
for f in "${ENVS[@]}"; do
  dir="$(dirname "$f")"
  # Respaldo 600 ANTES de escribir (conserva la clave vieja por si hubiera que volver atras).
  if ! cp -p "$f" "$f.respaldo-$SELLO" || ! chmod 600 "$f.respaldo-$SELLO"; then
    echo "$f: no se pudo respaldar (queda como estaba)"; mal=1; continue
  fi
  tmp="$(mktemp "$dir/.reponer-clave.XXXXXX")" || { echo "$f: no se pudo crear el temporal"; mal=1; continue; }
  # El valor entra al temporal por el builtin printf (no por argumentos de un proceso).
  hecho=0
  while IFS= read -r linea || [[ -n "$linea" ]]; do
    if [[ $hecho -eq 0 && "$linea" =~ ^[[:space:]]*N8N_API_KEY= ]]; then
      printf 'N8N_API_KEY=%s\n' "$NUEVA" >>"$tmp"; hecho=1
    else
      printf '%s\n' "$linea" >>"$tmp"
    fi
  done <"$f"
  if [[ $hecho -eq 1 ]] && chmod 600 "$tmp" && mv -f "$tmp" "$f"; then
    chmod 600 "$f"
    echo "$f: clave repuesta (respaldo: $f.respaldo-$SELLO)"
  else
    rm -f "$tmp"; echo "$f: NO se pudo escribir (queda como estaba)"; mal=1; continue
  fi
done
NUEVA=""

# Confirmacion: otra peticion por .env, ya leyendo la clave desde el archivo.
for f in "${ENVS[@]}"; do
  clave="$(valor_de "$f" N8N_API_KEY)"
  cod="$(sondear "$(valor_de "$f" N8N_BASE_URL)" "$clave")"; clave=""
  echo "$f: HTTP $cod"; [[ "$cod" == 200 ]] || mal=1
done
exit "$mal"
