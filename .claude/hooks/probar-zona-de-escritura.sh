#!/usr/bin/env bash
# =============================================================================
# probar-zona-de-escritura.sh — prueba de verdad del gancho zona-de-escritura.sh
# =============================================================================
#
# Invoca el gancho como lo invoca Claude Code (JSON del evento por stdin,
# CLAUDE_PROJECT_DIR en el entorno) con un intento FUERA de la zona, uno
# ADENTRO, y los bordes: sin zona, herramienta que no es Edit ni Write, ruta
# relativa, archivo exacto como prefijo, prefijo absoluto, escape con «..»,
# CLAUDE_PROJECT_DIR distinto de la raíz del worktree, la zona leída de
# `.claude/zona` sin variable, un enlace simbólico hacia fuera de la zona, un
# prefijo demasiado amplio (la raíz, «/», un ancestro), y el fallo cerrado
# (JSON inválido, tool_input que no es objeto, python3 ausente), y el
# subagente en su worktree con CLAUDE_PROJECT_DIR en la copia principal (el
# `cwd` del evento decide). Imprime cada
# caso con su resultado real y sale con 1 si alguno falla. Es lo que exige
# Analisis/41 §7 (fila F6) y §8.5 (H6): «el gancho probado con un intento
# fuera de carpeta».
#
#   .claude/hooks/probar-zona-de-escritura.sh
set -uo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GANCHO="$AQUI/zona-de-escritura.sh"
RAIZ="$(cd "$AQUI/../.." && pwd)"
FALLOS=0

# Un proyecto de mentira en un directorio temporal, para los casos en que la
# raíz NO es este worktree: con `.claude/zona`, una carpeta dentro de la zona,
# otra fuera, y un enlace simbólico desde adentro hacia afuera.
FICTICIO="$(mktemp -d)"
trap 'rm -rf "$FICTICIO"' EXIT
mkdir -p "$FICTICIO/.claude" "$FICTICIO/docs" "$FICTICIO/admin/functions/src"
printf '# zona del agente metodo, versionada en su rama\ndocs/\nbitacora/\n' > "$FICTICIO/.claude/zona"
ln -s "$FICTICIO/admin" "$FICTICIO/docs/enlace-afuera"
: > "$FICTICIO/admin/functions/src/ingesta.ts"

# evento <herramienta> <ruta>  -> JSON como el que manda Claude Code
evento() {
  python3 -c 'import json,sys; print(json.dumps({"tool_name": sys.argv[1], "tool_input": {"file_path": sys.argv[2], "content": "x"}}))' "$1" "$2"
}

decidir() {
  # lee la salida del gancho y devuelve nada | deny | allow | salida-invalida
  local salida="$1"
  if [[ -z "$salida" ]]; then echo "nada"; return; fi
  printf '%s' "$salida" | python3 -c 'import json,sys; print(json.load(sys.stdin)["hookSpecificOutput"]["permissionDecision"])' 2>/dev/null || echo "salida-invalida"
}

informar() {
  local nombre="$1" esperado="$2" decision="$3" detalle="$4" salida="$5"
  if [[ "$decision" == "$esperado" ]]; then
    printf '  ✓ %-62s %-5s (%s)\n' "$nombre" "$decision" "$detalle"
  else
    printf '  ✗ %-62s esperado %s, dio %s (%s)\n' "$nombre" "$esperado" "$decision" "$detalle"
    [[ -n "$salida" ]] && printf '      %s\n' "$salida"
    FALLOS=$((FALLOS + 1))
  fi
}

# caso <nombre> <esperado> <zona o "-"> <raíz> <herramienta> <ruta>
caso() {
  local nombre="$1" esperado="$2" zona="$3" raiz="$4" herramienta="$5" ruta="$6"
  local salida
  if [[ "$zona" == "-" ]]; then
    salida="$(evento "$herramienta" "$ruta" | env -u NOVUCHAT_ZONA CLAUDE_PROJECT_DIR="$raiz" bash "$GANCHO")"
  else
    salida="$(evento "$herramienta" "$ruta" | NOVUCHAT_ZONA="$zona" CLAUDE_PROJECT_DIR="$raiz" bash "$GANCHO")"
  fi
  informar "$nombre" "$esperado" "$(decidir "$salida")" "$herramienta $ruta" "$salida"
}

# crudo <nombre> <esperado> <zona> <raíz> <stdin literal>  -> para JSON inválido, etc.
crudo() {
  local nombre="$1" esperado="$2" zona="$3" raiz="$4" stdin="$5"
  local salida
  salida="$(printf '%s' "$stdin" | NOVUCHAT_ZONA="$zona" CLAUDE_PROJECT_DIR="$raiz" bash "$GANCHO")"
  informar "$nombre" "$esperado" "$(decidir "$salida")" "stdin: ${stdin:0:40}" "$salida"
}

ZONA_METODO="docs/:bitacora/:.claude/hooks/:.claude/agents/:CLAUDE.md"
ZONA_MODULO="admin/functions/src/modulos/agenda/:admin/web/src/modulos/agenda/:admin/pruebas/modulos/agenda/"

echo "Gancho: $GANCHO"
echo "Raíz del worktree: $RAIZ"
echo "Proyecto ficticio: $FICTICIO (con .claude/zona = docs/:bitacora/)"
echo
echo "Sin zona (ni variable ni .claude/zona): el gancho no hace nada"
caso "sin variable, escritura en el core"            nada "-" "$RAIZ" Write "$RAIZ/admin/functions/src/ingesta.ts"

echo
echo "Zona del agente metodo por variable ($ZONA_METODO)"
caso "FUERA: Write en admin/functions/src/"          deny "$ZONA_METODO" "$RAIZ" Write "$RAIZ/admin/functions/src/ingesta.ts"
caso "FUERA: Edit en Flujos/"                        deny "$ZONA_METODO" "$RAIZ" Edit  "$RAIZ/Flujos/demo-a.json"
caso "FUERA: Edit en ESTADO.md (raíz, no listado)"   deny "$ZONA_METODO" "$RAIZ" Edit  "$RAIZ/ESTADO.md"
caso "ADENTRO: Write en docs/arquitectura/"          nada "$ZONA_METODO" "$RAIZ" Write "$RAIZ/docs/arquitectura/core.md"
caso "ADENTRO: Edit en .claude/agents/ (ruta relativa)" nada "$ZONA_METODO" "$RAIZ" Edit  ".claude/agents/metodo.md"
caso "ADENTRO: archivo exacto CLAUDE.md"             nada "$ZONA_METODO" "$RAIZ" Edit  "$RAIZ/CLAUDE.md"
caso "ADENTRO: archivo nuevo en carpeta nueva de docs/" nada "$ZONA_METODO" "$RAIZ" Write "$RAIZ/docs/clientes/nuevo/x.md"
caso "FUERA: CLAUDE.md.bak no es CLAUDE.md"          deny "$ZONA_METODO" "$RAIZ" Write "$RAIZ/CLAUDE.md.bak"
caso "FUERA: docs-viejos/ no es docs/"               deny "$ZONA_METODO" "$RAIZ" Write "$RAIZ/docs-viejos/x.md"
caso "FUERA: escape con .. desde docs/"              deny "$ZONA_METODO" "$RAIZ" Write "$RAIZ/docs/../admin/firestore.rules"
caso "FUERA: archivo fuera del proyecto"             deny "$ZONA_METODO" "$RAIZ" Write "/tmp/cualquiera.md"
caso "Bash no es Edit ni Write: no hace nada"        nada "$ZONA_METODO" "$RAIZ" Bash  "$RAIZ/admin/functions/src/ingesta.ts"

echo
echo "Zona de un agente de módulo ($ZONA_MODULO)"
caso "ADENTRO: su carpeta de Functions"              nada "$ZONA_MODULO" "$RAIZ" Write "$RAIZ/admin/functions/src/modulos/agenda/sena.ts"
caso "FUERA: otro módulo"                            deny "$ZONA_MODULO" "$RAIZ" Write "$RAIZ/admin/functions/src/modulos/cobros/cobro.ts"
caso "FUERA: el core"                                deny "$ZONA_MODULO" "$RAIZ" Edit  "$RAIZ/admin/functions/src/core/turno/ingesta.ts"
caso "FUERA: el registro (lo escribe la coordinadora)" deny "$ZONA_MODULO" "$RAIZ" Edit  "$RAIZ/admin/functions/src/registro.ts"

echo
echo "Prefijo absoluto (por ejemplo, el scratchpad de la sesión)"
caso "ADENTRO: prefijo absoluto"                     nada "/tmp/zona-de-prueba/:docs/" "$RAIZ" Write "/tmp/zona-de-prueba/salida.md"

echo
echo "CLAUDE_PROJECT_DIR distinto de la raíz del worktree (proyecto ficticio)"
caso "ADENTRO: relativa resuelta contra CLAUDE_PROJECT_DIR" nada "docs/" "$FICTICIO" Write "docs/nuevo.md"
caso "FUERA: la misma relativa que en el worktree sería adentro" deny "docs/" "$FICTICIO" Write "$RAIZ/docs/arquitectura/core.md"
caso "FUERA: archivo del ficticio fuera de la zona"  deny "docs/" "$FICTICIO" Write "$FICTICIO/admin/functions/src/ingesta.ts"

echo
echo "Zona leída de .claude/zona, sin NOVUCHAT_ZONA"
caso "ADENTRO: docs/ del archivo .claude/zona"       nada "-" "$FICTICIO" Write "$FICTICIO/docs/uno.md"
caso "ADENTRO: bitacora/ (segunda línea del archivo)" nada "-" "$FICTICIO" Write "$FICTICIO/bitacora/2026-09.md"
caso "FUERA: admin/ con la zona del archivo"         deny "-" "$FICTICIO" Write "$FICTICIO/admin/functions/src/ingesta.ts"
caso "la variable manda sobre el archivo"            deny "bitacora/" "$FICTICIO" Write "$FICTICIO/docs/uno.md"

echo
echo "Enlaces simbólicos"
caso "FUERA: enlace dentro de docs/ que apunta a admin/" deny "docs/" "$FICTICIO" Write "$FICTICIO/docs/enlace-afuera/functions/src/ingesta.ts"
caso "FUERA: archivo nuevo bajo el enlace (padre resuelto)" deny "docs/" "$FICTICIO" Write "$FICTICIO/docs/enlace-afuera/nuevo.ts"

echo
echo "Prefijo demasiado amplio: se rechaza aunque la ruta esté adentro"
caso "raíz del proyecto como prefijo (.)"            deny "." "$FICTICIO" Write "$FICTICIO/docs/uno.md"
caso "raíz del proyecto como prefijo (absoluta)"     deny "$FICTICIO/" "$FICTICIO" Write "$FICTICIO/docs/uno.md"
caso "un ancestro de la raíz"                        deny "$(dirname "$FICTICIO")/" "$FICTICIO" Write "$FICTICIO/docs/uno.md"
caso "la barra sola"                                 deny "/" "$FICTICIO" Write "$FICTICIO/docs/uno.md"
caso "escape con .. en el prefijo"                   deny "docs/../" "$FICTICIO" Write "$FICTICIO/docs/uno.md"

echo
echo "Fallo cerrado con la zona activa"
crudo "JSON inválido"                                deny "docs/" "$FICTICIO" '{esto no es json'
crudo "tool_input que no es objeto"                  deny "docs/" "$FICTICIO" '{"tool_name":"Write","tool_input":"docs/uno.md"}'
crudo "sin file_path"                                deny "docs/" "$FICTICIO" '{"tool_name":"Write","tool_input":{"content":"x"}}'
crudo "evento que no es objeto"                      deny "docs/" "$FICTICIO" '[1,2,3]'
# python3 ausente: PATH con solo un directorio vacío (bash, grep, tr, sed, cat
# y printf se buscan por ruta absoluta o son builtins).
SIN_PY="$(mktemp -d)"
for h in bash grep tr sed cat; do ln -s "$(command -v "$h")" "$SIN_PY/$h"; done
salida="$(printf '{"tool_name":"Write","tool_input":{"file_path":"docs/uno.md"}}' | PATH="$SIN_PY" NOVUCHAT_ZONA="docs/" CLAUDE_PROJECT_DIR="$FICTICIO" "$SIN_PY/bash" "$GANCHO")"
informar "python3 ausente con zona activa" deny "$(decidir "$salida")" "PATH sin python3" "$salida"
salida="$(printf '{"tool_name":"Write","tool_input":{"file_path":"docs/uno.md"}}' | env -u NOVUCHAT_ZONA PATH="$SIN_PY" CLAUDE_PROJECT_DIR="$RAIZ" "$SIN_PY/bash" "$GANCHO")"
informar "python3 ausente SIN zona: no hace nada" nada "$(decidir "$salida")" "PATH sin python3" "$salida"
rm -rf "$SIN_PY"

echo
echo "Subagente en su worktree (26/09): CLAUDE_PROJECT_DIR es la copia principal, sin zona"
# Como en el repositorio real: la copia principal (con .git directorio y SIN
# .claude/zona) y, adentro, el worktree del agente (con .git archivo y su
# .claude/zona). Claude Code manda el `cwd` del agente en cada evento; antes
# de este arreglo el gancho solo miraba CLAUDE_PROJECT_DIR y no rechazaba nada.
PRINCIPAL="$(mktemp -d)"
AGENTE="$PRINCIPAL/.claude/worktrees/agente"
mkdir -p "$PRINCIPAL/.git/worktrees/agente" "$PRINCIPAL/.git/worktrees/otro" "$PRINCIPAL/docs" "$PRINCIPAL/admin/functions/src" "$AGENTE/.claude" \
  "$AGENTE/admin/functions/src/modulos/agenda" "$AGENTE/admin/functions/src/core"
printf 'gitdir: %s/.git/worktrees/agente\n' "$PRINCIPAL" > "$AGENTE/.git"
printf 'admin/functions/src/modulos/agenda/\n' > "$AGENTE/.claude/zona"

# evento_cwd <herramienta> <ruta> <cwd>
evento_cwd() {
  python3 -c 'import json,sys; print(json.dumps({"tool_name": sys.argv[1], "cwd": sys.argv[3], "tool_input": {"file_path": sys.argv[2], "content": "x"}}))' "$1" "$2" "$3"
}
# caso_cwd <nombre> <esperado> <cwd> <herramienta> <ruta>   (sin NOVUCHAT_ZONA)
caso_cwd() {
  local nombre="$1" esperado="$2" cwd="$3" herramienta="$4" ruta="$5" salida
  salida="$(evento_cwd "$herramienta" "$ruta" "$cwd" | env -u NOVUCHAT_ZONA CLAUDE_PROJECT_DIR="$PRINCIPAL" bash "$GANCHO")"
  informar "$nombre" "$esperado" "$(decidir "$salida")" "$herramienta ${ruta#"$PRINCIPAL"/} desde ${cwd#"$PRINCIPAL"/}" "$salida"
}

caso_cwd "FUERA: el core, desde su worktree (el caso medido)"  deny "$AGENTE" Write "$AGENTE/admin/functions/src/core/ingesta.ts"
caso_cwd "ADENTRO: su módulo, desde su worktree"              nada "$AGENTE" Write "$AGENTE/admin/functions/src/modulos/agenda/sena.ts"
caso_cwd "ADENTRO: relativa resuelta contra el cwd"           nada "$AGENTE" Write "admin/functions/src/modulos/agenda/nuevo.ts"
caso_cwd "FUERA: cwd en una subcarpeta de su worktree"        deny "$AGENTE/admin/functions" Edit "$AGENTE/admin/functions/src/core/ingesta.ts"
caso_cwd "FUERA: escribe en la copia principal"               deny "$AGENTE" Write "$PRINCIPAL/admin/functions/src/ingesta.ts"
caso_cwd "FUERA: se mudó a la principal y escribe en su worktree" deny "$PRINCIPAL" Write "$AGENTE/admin/functions/src/core/ingesta.ts"
caso_cwd "sin zona en ningún lado: la principal sigue igual"  nada "$PRINCIPAL" Write "$PRINCIPAL/admin/functions/src/ingesta.ts"
SIN_PY="$(mktemp -d)"
for h in bash grep tr sed cat head dirname; do ln -s "$(command -v "$h")" "$SIN_PY/$h"; done
salida="$(evento_cwd Write "$AGENTE/admin/functions/src/core/ingesta.ts" "$AGENTE" | env -u NOVUCHAT_ZONA PATH="$SIN_PY" CLAUDE_PROJECT_DIR="$PRINCIPAL" "$SIN_PY/bash" "$GANCHO")"
informar "python3 ausente, zona solo en el worktree del cwd" deny "$(decidir "$salida")" "PATH sin python3" "$salida"
rm -rf "$SIN_PY"
echo
echo "Revisión de seguridad de #210: relativas contra el cwd, plantar raíz o zona, intersección, zona vacía"
mkdir -p "$AGENTE/admin/functions/src/modulos/agenda/sub/.claude"
caso_cwd "FUERA: relativa desde una subcarpeta cae fuera"      deny "$AGENTE/admin/functions/src/core" Write "admin/functions/src/modulos/agenda/x.ts"
caso_cwd "ADENTRO: ../ desde una subcarpeta cae adentro"      nada "$AGENTE/admin/functions/src/core" Write "../modulos/agenda/x.ts"
caso_cwd "FUERA: plantar un .git dentro de la zona"           deny "$AGENTE" Write "$AGENTE/admin/functions/src/modulos/agenda/sub/.git"
caso_cwd "FUERA: plantar un .claude/zona dentro de la zona"   deny "$AGENTE" Write "$AGENTE/admin/functions/src/modulos/agenda/sub/.claude/zona"
# Si igual aparecen (plantados por Bash), no amplían la zona: se aplican todas.
: > "$AGENTE/admin/functions/src/modulos/agenda/sub/.git"
printf '../../../core/\n' > "$AGENTE/admin/functions/src/modulos/agenda/sub/.claude/zona"
caso_cwd "FUERA: raíz y zona plantadas, cwd adentro, escribe en el core" deny "$AGENTE/admin/functions/src/modulos/agenda/sub" Write "$AGENTE/admin/functions/src/core/ingesta.ts"
# El residual de la segunda vuelta: la raíz plantada ya no oculta la zona del
# worktree aunque el destino esté en la copia principal (se sube hasta la
# primera raíz REAL, y un `.git` vacío no lo es).
caso_cwd "FUERA: raíz plantada, cwd adentro, escribe en la principal" deny "$AGENTE/admin/functions/src/modulos/agenda/sub" Write "$PRINCIPAL/admin/functions/src/ingesta.ts"
rm -rf "$AGENTE/admin/functions/src/modulos/agenda/sub"
# Otro worktree con su zona: una sesión con zona en el proyecto, sin cwd, no escribe ahí.
OTRO="$PRINCIPAL/.claude/worktrees/otro"
mkdir -p "$OTRO/.claude" "$OTRO/admin" "$OTRO/docs"
printf 'gitdir: %s/.git/worktrees/otro\n' "$PRINCIPAL" > "$OTRO/.git"; printf 'admin/\n' > "$OTRO/.claude/zona"
printf 'docs/\n' > "$PRINCIPAL/.claude/zona"
salida="$(evento Write "$OTRO/admin/x.ts" | env -u NOVUCHAT_ZONA CLAUDE_PROJECT_DIR="$PRINCIPAL" bash "$GANCHO")"
informar "FUERA: sin cwd, zona del proyecto y del destino a la vez" deny "$(decidir "$salida")" "Write otro/admin/x.ts" "$salida"
salida="$(evento_cwd Write "$OTRO/docs/x.md" "$OTRO" | NOVUCHAT_ZONA="docs/" CLAUDE_PROJECT_DIR="$PRINCIPAL" bash "$GANCHO")"
informar "FUERA: NOVUCHAT_ZONA se ancla en CLAUDE_PROJECT_DIR" deny "$(decidir "$salida")" "Write otro/docs/x.md" "$salida"
# Una sesión con zona puede lanzar subagentes con zona en otros worktrees: la
# zona del proyecto es solo el respaldo de un cwd sin zona.
caso_cwd "ADENTRO: proyecto con zona, subagente dentro de la suya" nada "$AGENTE" Write "$AGENTE/admin/functions/src/modulos/agenda/sena.ts"
rm -f "$PRINCIPAL/.claude/zona"
printf '# pendiente\n\n' > "$OTRO/.claude/zona"
caso_cwd "FUERA: .claude/zona sin prefijos (fallo cerrado)"   deny "$OTRO" Write "$OTRO/admin/x.ts"

rm -rf "$PRINCIPAL"

echo
echo ".claude/zona nunca se versiona (lo escribe quien lanza al agente; está en .gitignore)"
if git -C "$RAIZ" ls-files --error-unmatch .claude/zona >/dev/null 2>&1; then
  printf '  ✗ %-62s git RASTREA .claude/zona: hay que quitarlo del índice (git rm --cached) y dejarlo en .gitignore\n' ".claude/zona no rastreado por git"
  FALLOS=$((FALLOS + 1))
else
  printf '  ✓ %-62s %-5s (git ls-files --error-unmatch falla)\n' ".claude/zona no rastreado por git" "ok"
fi
if git -C "$RAIZ" check-ignore -q .claude/zona; then
  printf '  ✓ %-62s %-5s (git check-ignore)\n' ".claude/zona está en .gitignore" "ok"
else
  printf '  ✗ %-62s falta la línea .claude/zona en .gitignore\n' ".claude/zona está en .gitignore"
  FALLOS=$((FALLOS + 1))
fi

echo
if [[ "$FALLOS" -eq 0 ]]; then
  echo "✓ Todos los casos pasaron."
else
  echo "✗ $FALLOS caso(s) fallaron."
fi
exit "$((FALLOS > 0))"
