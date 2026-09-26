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
#   2. Si no, el archivo `.claude/zona` en la raíz del proyecto (la que dice
#      CLAUDE_PROJECT_DIR, o el directorio de trabajo si no está). LO ESCRIBE
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

RAIZ="${CLAUDE_PROJECT_DIR:-$PWD}"
ZONA="${NOVUCHAT_ZONA:-}"
if [[ -z "$ZONA" && -f "$RAIZ/.claude/zona" ]]; then
  # Une las líneas del archivo con «:», sin comentarios ni vacías.
  ZONA="$(grep -v '^[[:space:]]*#' "$RAIZ/.claude/zona" | grep -v '^[[:space:]]*$' | tr '\n' ':' | sed 's/:*$//')"
fi

# Sin zona: se consume el stdin (para no dejar un pipe roto) y no se opina.
[[ -n "$ZONA" ]] || { cat >/dev/null; exit 0; }

negar() {
  # Sin depender de python3: JSON escrito a mano, sin comillas dentro del texto.
  printf '{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "%s"}}\n' "$1"
  exit 0
}

if ! command -v python3 >/dev/null 2>&1; then
  cat >/dev/null
  negar "Zona de escritura: gancho no operativo (falta python3) y la zona esta activa; se rechaza la escritura por seguridad."
fi

NOVUCHAT_ZONA="$ZONA" NOVUCHAT_RAIZ="$RAIZ" python3 -c '
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

raiz = os.path.realpath(os.environ["NOVUCHAT_RAIZ"])

def resolver(camino):
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

zona = [p.strip() for p in os.environ.get("NOVUCHAT_ZONA", "").split(":") if p.strip()]
lista = ":".join(zona)

def es_ancestro_o_igual(p, de):
    return de == p or de.startswith(p.rstrip(os.sep) + os.sep)

prefijos = []
for p in zona:
    r = resolver(p)
    if r == os.sep or es_ancestro_o_igual(r, raiz):
        responder(
            f"Zona de escritura: el prefijo «{p}» resuelve a «{r}», que es la raiz del "
            f"proyecto, un ancestro o «/». Una zona asi no limita nada: se rechaza la "
            f"escritura hasta que NOVUCHAT_ZONA o .claude/zona nombre carpetas concretas."
        )
    prefijos.append(r)

destino = resolver(ruta)

def cubre(prefijo, destino):
    """El prefijo cubre al destino si son el mismo archivo o si el destino esta
    dentro de la carpeta que el prefijo nombra."""
    return destino == prefijo or destino.startswith(prefijo.rstrip(os.sep) + os.sep)

if any(cubre(p, destino) for p in prefijos):
    sys.exit(0)

relativa = os.path.relpath(destino, raiz)
responder(
    f"Zona de escritura: «{relativa}» esta fuera de la zona de este agente "
    f"({lista}). Cada agente escribe solo en su carpeta (Analisis/41 §8.1); si el "
    f"cambio corresponde a otra zona, se anota en el PR y lo hace el agente dueño. "
    f"La zona la fija NOVUCHAT_ZONA o el archivo .claude/zona."
)
'
exit 0
