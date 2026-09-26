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
# Cómo se activa: con la variable de entorno NOVUCHAT_ZONA, una lista de
# prefijos de ruta permitidos separados por «:», relativos a la raíz del
# proyecto (CLAUDE_PROJECT_DIR) o absolutos. Ejemplos:
#
#   NOVUCHAT_ZONA="docs/:bitacora/:.claude/hooks/:.claude/agents/:CLAUDE.md"
#   NOVUCHAT_ZONA="admin/functions/src/modulos/agenda/:admin/web/src/modulos/agenda/"
#
# Un prefijo que termina en «/» es una carpeta; uno que no, es un archivo exacto
# o una carpeta (se acepta «CLAUDE.md» y también «docs» como «docs/»). Se fija al
# lanzar la sesión del agente (en su `.claude/settings.local.json` bajo `env`, o
# exportada antes de arrancar Claude Code).
#
# Cuando la variable NO está, el gancho no hace nada: la sesión de Andres y las
# sesiones sin zona siguen igual que hoy. Cuando está:
#
#   deny  -> la ruta queda fuera de todos los prefijos (o fuera del proyecto y
#            sin un prefijo absoluto que la cubra).
#   nada  -> la ruta está dentro de un prefijo; sigue la evaluación normal.
#
# Recibe por stdin el JSON del evento (tool_name, tool_input.file_path) y
# responde por stdout con hookSpecificOutput.permissionDecision. Sale siempre
# con 0: un fallo de este script no debe dejar la herramienta en un estado
# indefinido. Se prueba con `.claude/hooks/probar-zona-de-escritura.sh`.
set -uo pipefail

# Sin zona: se consume el stdin (para no dejar un pipe roto) y no se opina.
[[ -n "${NOVUCHAT_ZONA:-}" ]] || { cat >/dev/null; exit 0; }

python3 -c '
import json, os, sys

try:
    evento = json.load(sys.stdin)
except Exception:
    sys.exit(0)
if evento.get("tool_name") not in ("Edit", "Write", "MultiEdit"):
    sys.exit(0)
entrada = evento.get("tool_input") or {}
ruta = str(entrada.get("file_path") or "")
if not ruta:
    sys.exit(0)

raiz = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
raiz = os.path.normpath(os.path.abspath(raiz))
absoluta = os.path.normpath(ruta if os.path.isabs(ruta) else os.path.join(raiz, ruta))

zona = [p for p in os.environ.get("NOVUCHAT_ZONA", "").split(":") if p.strip()]

def cubre(prefijo, destino):
    """El prefijo cubre al destino si son el mismo archivo o si el destino está
    dentro de la carpeta que el prefijo nombra."""
    p = os.path.normpath(prefijo if os.path.isabs(prefijo) else os.path.join(raiz, prefijo))
    if destino == p:
        return True
    return destino.startswith(p.rstrip(os.sep) + os.sep)

if any(cubre(p, absoluta) for p in zona):
    sys.exit(0)

relativa = os.path.relpath(absoluta, raiz)
lista = ":".join(zona)
motivo = (
    f"Zona de escritura: «{relativa}» está fuera de la zona de este agente "
    f"({lista}). Cada agente escribe solo en su carpeta "
    f"(Analisis/41 §8.1); si el cambio corresponde a otra zona, se anota en el "
    f"PR y lo hace el agente dueño. La zona la fija NOVUCHAT_ZONA."
)
print(json.dumps({"hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": motivo,
}}, ensure_ascii=False))
'
exit 0
