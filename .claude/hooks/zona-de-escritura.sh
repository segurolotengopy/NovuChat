#!/usr/bin/env bash
# =============================================================================
# zona-de-escritura.sh — control PreToolUse de Edit y Write: cada agente
# escribe SOLO en su zona.
# =============================================================================
#
# Por qué existe (Analisis/41-arquitectura-por-capas.md §1, §8.1 y §9.1): la
# arquitectura por capas se sostiene con «carpeta = zona», y una política
# escrita es un prompt, y el prompt no es una barrera. Este gancho es el candado
# por hecho aplicado a la arquitectura: un agente de módulo que intenta escribir
# en el core no recibe una advertencia, recibe un rechazo.
#
# DE DÓNDE SALE LA ZONA, en este orden (revisión de seguridad del 26/09):
#
#   1. La variable de entorno NOVUCHAT_ZONA, si existe y no está vacía.
#   2. Si no, TODOS los `.claude/zona` de estas raíces, a la vez: la del
#      `cwd` del evento (el worktree del agente), la del archivo destino, y
#      CLAUDE_PROJECT_DIR (o el directorio de trabajo). Hasta el
#      26/09 solo se miraba CLAUDE_PROJECT_DIR, que en un subagente es la copia
#      principal: el gancho no rechazaba nada dentro del worktree del agente. LO ESCRIBE
#      QUIEN LANZA AL AGENTE (la sesión coordinadora) al crear el worktree,
#      NO el agente, y NUNCA SE VERSIONA: está en .gitignore, y la prueba del
#      gancho falla si git lo rastrea. Así dos subagentes lanzados desde la
#      misma sesión —que comparten el entorno— no comparten la zona, y un
#      archivo de zona nunca llega a `main` (donde le negaría la escritura a
#      toda sesión, incluida la de Andres) ni choca entre dos ramas.
#
# Las dos fuentes usan la misma sintaxis: prefijos de ruta permitidos separados
# por «:» (en el archivo, también uno por línea; las líneas con «#» son
# comentarios), relativos a la raíz del proyecto o absolutos. Ejemplos:
#
#   NOVUCHAT_ZONA="docs/:bitacora/:.claude/hooks/:.claude/agents/:CLAUDE.md"
#   NOVUCHAT_ZONA="admin/functions/src/modulos/agenda/:admin/web/src/modulos/agenda/"
#
# Un prefijo que termina en «/» es una carpeta; uno que no, es un archivo exacto
# o una carpeta (se acepta «CLAUDE.md» y también «docs» como «docs/»). Un
# prefijo que resuelva a la raíz del proyecto, a «/» o a un ancestro de la raíz
# es demasiado amplio y se rechaza con mensaje: una zona así no es una zona.
#
# Rutas y enlaces simbólicos: destino y prefijos se resuelven con realpath (y,
# cuando el archivo todavía no existe, se resuelve su carpeta padre), así que
# un enlace dentro de la zona que apunte afuera se rechaza, y «..» no escapa.
#
# Cuando la zona NO está definida (ni variable ni archivo), el gancho no hace
# nada: la sesión de Andres y las sesiones sin zona siguen igual que hoy.
# Cuando está, FALLA CERRADO: sin python3, con un evento que no es JSON o con
# un tool_input que no es un objeto, responde deny («gancho no operativo»)
# antes que dejar pasar una escritura que no pudo comprobar.
#
#   deny  -> la ruta queda fuera de todos los prefijos (o fuera del proyecto y
#            sin un prefijo absoluto que la cubra); o un prefijo es demasiado
#            amplio; o el gancho no pudo evaluar.
#   nada  -> la ruta está dentro de un prefijo; sigue la evaluación normal.
#
# Recibe por stdin el JSON del evento (tool_name, tool_input.file_path) y
# responde por stdout con hookSpecificOutput.permissionDecision. Sale siempre
# con 0: un fallo de este script no debe dejar la herramienta en un estado
# indefinido. Se prueba con `.claude/hooks/probar-zona-de-escritura.sh`.
# Documentación: docs/arquitectura/zona-de-escritura.md.
set -uo pipefail

# El evento completo, una sola vez: de él salen el `cwd` y el destino.
EVENTO="$(cat)"

# campo <nombre>: `cwd` del evento o `tool_input.file_path`, con python3 si
# está y, si no, con sed (lo justo para decidir si hay zona: sin python3 y con
# zona, el gancho rechaza igual más abajo).
campo() {
  if command -v python3 >/dev/null 2>&1; then
    printf '%s' "$EVENTO" | python3 -c '
import json, sys
try:
    e = json.load(sys.stdin)
except Exception:
    sys.exit(0)
if not isinstance(e, dict):
    sys.exit(0)
v = e.get("cwd") if sys.argv[1] == "cwd" else (e.get("tool_input") or {}).get("file_path") if isinstance(e.get("tool_input"), dict) else None
print(v if isinstance(v, str) else "")' "$1" 2>/dev/null
  else
    local clave="$1"; [[ "$clave" == "cwd" ]] || clave="file_path"
    printf '%s' "$EVENTO" | sed -n "s/.*\"$clave\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | sed -n 1p
  fi
}

# es_raiz_real <dir>: un checkout de verdad, no un `.git` plantado. En la
# copia principal `.git` es un directorio; en un worktree es un archivo
# «gitdir: <ruta>» cuya ruta existe.
es_raiz_real() {
  local d="$1" linea destino
  [[ -d "$d/.git" ]] && return 0
  [[ -f "$d/.git" ]] || return 1
  IFS= read -r linea < "$d/.git" || return 1
  [[ "$linea" == gitdir:* ]] || return 1
  destino="${linea#gitdir:}"; destino="${destino# }"
  [[ "$destino" == /* ]] || destino="$d/$destino"
  [[ -d "$destino" ]]
}

# zonas_hasta_raiz <ruta>: cada carpeta con `.claude/zona` desde la carpeta
# existente más cercana a la ruta, subiendo, HASTA la primera raíz real
# (incluida). Así una zona o un `.git` plantados en una subcarpeta no ocultan
# la zona del worktree, y la zona de un checkout no alcanza a los worktrees
# que viven adentro de él. Solo con expansiones de bash (sin `dirname`) y con
# un tope de 256 niveles, para que ningún camino raro cuelgue el gancho.
zonas_hasta_raiz() {
  local d="$1" n=0
  [[ -n "$d" && "$d" == /* ]] || return 0
  while [[ -n "$d" && ! -d "$d" && $n -lt 256 ]]; do d="${d%/*}"; n=$((n + 1)); done
  [[ -n "$d" ]] || d="/"
  d="$(cd "$d" 2>/dev/null && pwd -P)" || return 0
  n=0
  while [[ -n "$d" && "$d" != "/" && $n -lt 256 ]]; do
    [[ -f "$d/.claude/zona" ]] && printf '%s\n' "$d"
    es_raiz_real "$d" && return 0
    d="${d%/*}"; n=$((n + 1))
  done
}

# DE DÓNDE SALE LA ZONA (corregido el 26/09/2026, antes de F2). Un subagente
# lanzado con worktree recibe el CLAUDE_PROJECT_DIR de la sesión que lo lanzó
# —la copia principal—, así que buscar `.claude/zona` solo ahí dejaba el gancho
# mudo dentro del worktree del agente: medido con un agente de prueba, que
# escribió fuera de su zona sin un rechazo. Ahora se juntan las zonas que hay
# subiendo desde el `cwd` del evento (el worktree donde trabaja el agente) y
# desde el archivo destino, cada recorrido hasta su primera raíz git real; la
# de CLAUDE_PROJECT_DIR (o el directorio de trabajo) entra solo si el cwd no
# dio ninguna. TODAS se aplican a la vez (intersección; revisión de seguridad
# de #210): el destino tiene que caber en cada una, cada una con sus prefijos
# relativos a su propia carpeta. Así un agente con zona que escribe en
# otro checkout choca con su zona, uno que se mudó de carpeta y escribe en un
# worktree con zona choca con la de ese worktree, y una zona plantada no
# amplía la otra.
#
# NOVUCHAT_ZONA, si está, manda sola y se ancla en CLAUDE_PROJECT_DIR, como
# siempre: es para lanzar una sesión con zona desde afuera.
PROYECTO="${CLAUDE_PROJECT_DIR:-$PWD}"
CWD_EVENTO="$(campo cwd)"
DESTINO_EVENTO="$(campo file_path)"
# Una ruta relativa la escribe la herramienta contra el cwd: se juzga ESA.
[[ -z "$DESTINO_EVENTO" || "$DESTINO_EVENTO" == /* ]] || DESTINO_EVENTO="${CWD_EVENTO:-$PROYECTO}/$DESTINO_EVENTO"
ZONAS_CWD="$(zonas_hasta_raiz "$CWD_EVENTO")"
ZONAS_DESTINO="$(zonas_hasta_raiz "$DESTINO_EVENTO")"
# La del proyecto, solo de respaldo: cuando el cwd no dio ninguna zona. Si no,
# una sesión con zona no podría lanzar subagentes con zona en otros worktrees.
ZONA_PROYECTO=""
[[ -z "$ZONAS_CWD" && -f "$PROYECTO/.claude/zona" ]] && ZONA_PROYECTO="$PROYECTO"

negar() {
  # Sin depender de python3: JSON escrito a mano, sin comillas dentro del texto.
  printf '{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "%s"}}\n' "$1"
  exit 0
}

# ZONAS: una línea por zona, «raíz<TAB>prefijo:prefijo…».
ZONAS=""
if [[ -n "${NOVUCHAT_ZONA:-}" ]]; then
  ZONAS="$PROYECTO"$'\t'"$NOVUCHAT_ZONA"
else
  vistas=":"
  while IFS= read -r candidata; do
    [[ -n "$candidata" && -f "$candidata/.claude/zona" ]] || continue
    real="$(cd "$candidata" 2>/dev/null && pwd -P)" || real="$candidata"
    [[ "$vistas" == *":$real:"* ]] && continue
    vistas="$vistas$real:"
    # Une las líneas del archivo con «:», sin comentarios ni vacías.
    prefijos="$(grep -v '^[[:space:]]*#' "$candidata/.claude/zona" | grep -v '^[[:space:]]*$' | tr '\n' ':' | sed 's/:*$//')"
    # Un `.claude/zona` que existe y no deja ningún prefijo es un error de
    # quien lanzó al agente, no una zona abierta: fallo cerrado.
    [[ -n "$prefijos" ]] || negar "Zona de escritura: el archivo de zona existe pero no tiene prefijos (o no se pudo leer); se rechaza la escritura hasta que nombre carpetas concretas."
    ZONAS="${ZONAS:+$ZONAS$'\n'}$real"$'\t'"$prefijos"
  done <<< "$ZONAS_CWD"$'\n'"$ZONAS_DESTINO"$'\n'"$ZONA_PROYECTO"
fi

# Sin zona: no se opina.
[[ -n "$ZONAS" ]] || exit 0

if ! command -v python3 >/dev/null 2>&1; then
  negar "Zona de escritura: gancho no operativo (falta python3) y la zona esta activa; se rechaza la escritura por seguridad."
fi

printf '%s' "$EVENTO" | NOVUCHAT_ZONAS="$ZONAS" NOVUCHAT_DESTINO="$DESTINO_EVENTO" python3 -c '
import json, os, sys

def responder(motivo):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": motivo,
    }}, ensure_ascii=False))
    sys.exit(0)

try:
    evento = json.load(sys.stdin)
except Exception:
    responder("Zona de escritura: el evento no es JSON valido y la zona esta activa; se rechaza la escritura por seguridad.")
if not isinstance(evento, dict):
    responder("Zona de escritura: el evento no es un objeto y la zona esta activa; se rechaza la escritura por seguridad.")
if evento.get("tool_name") not in ("Edit", "Write", "MultiEdit"):
    sys.exit(0)
entrada = evento.get("tool_input")
if not isinstance(entrada, dict):
    responder("Zona de escritura: tool_input no es un objeto y la zona esta activa; se rechaza la escritura por seguridad.")
ruta = entrada.get("file_path")
if not isinstance(ruta, str) or not ruta:
    responder("Zona de escritura: la escritura no trae file_path y la zona esta activa; se rechaza por seguridad.")

def resolver(camino, raiz):
    """realpath que sirve aunque el archivo no exista todavia: resuelve la
    carpeta padre existente mas cercana y vuelve a pegar el resto."""
    camino = camino if os.path.isabs(camino) else os.path.join(raiz, camino)
    camino = os.path.normpath(camino)
    if os.path.exists(camino):
        return os.path.realpath(camino)
    resto = []
    actual = camino
    while not os.path.exists(actual):
        padre, nombre = os.path.split(actual)
        if padre == actual:
            break
        resto.insert(0, nombre)
        actual = padre
    return os.path.normpath(os.path.join(os.path.realpath(actual), *resto))

def dentro(prefijo, destino):
    """El prefijo cubre al destino si son el mismo archivo o si el destino esta
    dentro de la carpeta que el prefijo nombra."""
    return destino == prefijo or destino.startswith(prefijo.rstrip(os.sep) + os.sep)

zonas = []
for linea in os.environ.get("NOVUCHAT_ZONAS", "").split("\n"):
    if "\t" not in linea:
        continue
    raiz, lista = linea.split("\t", 1)
    raiz = os.path.realpath(raiz)
    prefijos = [p.strip() for p in lista.split(":") if p.strip()]
    if not prefijos:
        responder("Zona de escritura: una zona sin prefijos; se rechaza la escritura por seguridad.")
    resueltos = []
    for p in prefijos:
        r = resolver(p, raiz)
        if r == os.sep or dentro(r, raiz):
            responder(
                f"Zona de escritura: el prefijo «{p}» resuelve a «{r}», que es la raiz del "
                f"proyecto, un ancestro o «/». Una zona asi no limita nada: se rechaza la "
                f"escritura hasta que NOVUCHAT_ZONA o .claude/zona nombre carpetas concretas."
            )
        resueltos.append(r)
    zonas.append((raiz, lista, resueltos))
if not zonas:
    responder("Zona de escritura: la zona esta activa pero no se pudo leer; se rechaza la escritura por seguridad.")

# El destino: el que armo el gancho contra el cwd (ya absoluto); si no vino,
# el file_path contra la raiz de la primera zona.
destino = resolver(os.environ.get("NOVUCHAT_DESTINO") or ruta, zonas[0][0])

# Con la zona activa nadie escribe un .git ni un .claude/zona: es la forma de
# plantar desde adentro de la propia zona una raiz o una zona nuevas.
if ".git" in destino.split(os.sep) or destino.endswith(os.sep + os.path.join(".claude", "zona")):
    responder("Zona de escritura: con la zona activa no se escribe un .git ni un .claude/zona; la zona la fija quien lanza al agente.")

for raiz, lista, resueltos in zonas:
    if not any(dentro(p, destino) for p in resueltos):
        relativa = os.path.relpath(destino, raiz)
        responder(
            f"Zona de escritura: «{relativa}» esta fuera de la zona de este agente "
            f"({lista}). Cada agente escribe solo en su carpeta (Analisis/41 §8.1); si el "
            f"cambio corresponde a otra zona, se anota en el PR y lo hace el agente dueño. "
            f"La zona la fija NOVUCHAT_ZONA o el archivo .claude/zona."
        )
sys.exit(0)
'
exit 0
