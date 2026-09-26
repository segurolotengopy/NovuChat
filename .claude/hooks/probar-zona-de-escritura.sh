#!/usr/bin/env bash
# =============================================================================
# probar-zona-de-escritura.sh — prueba de verdad del gancho zona-de-escritura.sh
# =============================================================================
#
# Invoca el gancho como lo invoca Claude Code (JSON del evento por stdin,
# CLAUDE_PROJECT_DIR en el entorno) con un intento FUERA de la zona, uno
# ADENTRO, y los bordes: sin variable, herramienta que no es Edit ni Write,
# ruta relativa, archivo exacto como prefijo, prefijo absoluto, y un intento de
# escapar con «..». Imprime cada caso con su resultado real y sale con 1 si
# alguno falla. Es lo que exige Analisis/41 §7 (fila F6) y §8.5 (H6): «el
# gancho probado con un intento fuera de carpeta».
#
#   .claude/hooks/probar-zona-de-escritura.sh
set -uo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GANCHO="$AQUI/zona-de-escritura.sh"
RAIZ="$(cd "$AQUI/../.." && pwd)"
FALLOS=0

# evento <herramienta> <ruta>  -> JSON como el que manda Claude Code
evento() {
  python3 -c 'import json,sys; print(json.dumps({"tool_name": sys.argv[1], "tool_input": {"file_path": sys.argv[2], "content": "x"}}))' "$1" "$2"
}

# caso <nombre> <esperado: deny|nada> <zona o "-"> <herramienta> <ruta>
caso() {
  local nombre="$1" esperado="$2" zona="$3" herramienta="$4" ruta="$5"
  local salida decision
  if [[ "$zona" == "-" ]]; then
    salida="$(evento "$herramienta" "$ruta" | env -u NOVUCHAT_ZONA CLAUDE_PROJECT_DIR="$RAIZ" bash "$GANCHO")"
  else
    salida="$(evento "$herramienta" "$ruta" | NOVUCHAT_ZONA="$zona" CLAUDE_PROJECT_DIR="$RAIZ" bash "$GANCHO")"
  fi
  if [[ -z "$salida" ]]; then
    decision="nada"
  else
    decision="$(printf '%s' "$salida" | python3 -c 'import json,sys; print(json.load(sys.stdin)["hookSpecificOutput"]["permissionDecision"])' 2>/dev/null || echo "salida-invalida")"
  fi
  if [[ "$decision" == "$esperado" ]]; then
    printf '  ✓ %-58s %-5s (%s %s)\n' "$nombre" "$decision" "$herramienta" "$ruta"
  else
    printf '  ✗ %-58s esperado %s, dio %s (%s %s)\n' "$nombre" "$esperado" "$decision" "$herramienta" "$ruta"
    [[ -n "$salida" ]] && printf '      %s\n' "$salida"
    FALLOS=$((FALLOS + 1))
  fi
}

ZONA_METODO="docs/:bitacora/:.claude/hooks/:.claude/agents/:CLAUDE.md"
ZONA_MODULO="admin/functions/src/modulos/agenda/:admin/web/src/modulos/agenda/:admin/pruebas/modulos/agenda/"

echo "Gancho: $GANCHO"
echo "Raíz del proyecto: $RAIZ"
echo
echo "Sin NOVUCHAT_ZONA: el gancho no hace nada"
caso "sin variable, escritura en el core"            nada "-" Write "$RAIZ/admin/functions/src/ingesta.ts"

echo
echo "Zona del agente metodo ($ZONA_METODO)"
caso "FUERA: Write en admin/functions/src/"          deny "$ZONA_METODO" Write "$RAIZ/admin/functions/src/ingesta.ts"
caso "FUERA: Edit en Flujos/"                        deny "$ZONA_METODO" Edit  "$RAIZ/Flujos/demo-a.json"
caso "FUERA: Edit en ESTADO.md (raíz, no listado)"   deny "$ZONA_METODO" Edit  "$RAIZ/ESTADO.md"
caso "ADENTRO: Write en docs/arquitectura/"          nada "$ZONA_METODO" Write "$RAIZ/docs/arquitectura/core.md"
caso "ADENTRO: Edit en .claude/agents/ (ruta relativa)" nada "$ZONA_METODO" Edit  ".claude/agents/metodo.md"
caso "ADENTRO: archivo exacto CLAUDE.md"             nada "$ZONA_METODO" Edit  "$RAIZ/CLAUDE.md"
caso "FUERA: CLAUDE.md.bak no es CLAUDE.md"          deny "$ZONA_METODO" Write "$RAIZ/CLAUDE.md.bak"
caso "FUERA: docs-viejos/ no es docs/"               deny "$ZONA_METODO" Write "$RAIZ/docs-viejos/x.md"
caso "FUERA: escape con .. desde docs/"              deny "$ZONA_METODO" Write "$RAIZ/docs/../admin/firestore.rules"
caso "FUERA: archivo fuera del proyecto"             deny "$ZONA_METODO" Write "/tmp/cualquiera.md"
caso "Bash no es Edit ni Write: no hace nada"        nada "$ZONA_METODO" Bash  "$RAIZ/admin/functions/src/ingesta.ts"

echo
echo "Zona de un agente de módulo ($ZONA_MODULO)"
caso "ADENTRO: su carpeta de Functions"              nada "$ZONA_MODULO" Write "$RAIZ/admin/functions/src/modulos/agenda/sena.ts"
caso "FUERA: otro módulo"                            deny "$ZONA_MODULO" Write "$RAIZ/admin/functions/src/modulos/cobros/cobro.ts"
caso "FUERA: el core"                                deny "$ZONA_MODULO" Edit  "$RAIZ/admin/functions/src/core/turno/ingesta.ts"
caso "FUERA: el registro (lo escribe la coordinadora)" deny "$ZONA_MODULO" Edit  "$RAIZ/admin/functions/src/registro.ts"

echo
echo "Prefijo absoluto (por ejemplo, el scratchpad de la sesión)"
caso "ADENTRO: prefijo absoluto"                     nada "/tmp/zona-de-prueba/:docs/" Write "/tmp/zona-de-prueba/salida.md"

echo
if [[ "$FALLOS" -eq 0 ]]; then
  echo "✓ Todos los casos pasaron."
else
  echo "✗ $FALLOS caso(s) fallaron."
fi
exit "$((FALLOS > 0))"
