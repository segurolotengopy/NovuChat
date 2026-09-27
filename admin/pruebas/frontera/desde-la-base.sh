#!/usr/bin/env bash
# =============================================================================
# desde-la-base.sh — corre solo-rutas con la herramienta de la BASE, no la del PR
# =============================================================================
#
# Se ejecuta LEYÉNDOLO DE LA BASE, nunca desde el worktree del PR:
#
#   git show origin/main:admin/pruebas/frontera/desde-la-base.sh \
#     | bash -s -- docs/arquitectura/tandas/tN.json [origin/main]
#
# Por qué (revisión de seguridad del #241): `solo-rutas.mjs` importa
# `frontera.ts`, que importa `destinos-f2.ts` y `functions/src/registro.ts`; el
# código de nivel superior de cualquiera de ellos corre al importar. Si se
# ejecuta la copia del PR, un PR de tanda puede hacer que la compuerta diga
# «todo en orden». Acá se extrae la herramienta del merge-base a una carpeta
# temporal y se corre contra el worktree del PR (NOVUCHAT_RAIZ).
#
# NADA DEL PR CORRE: ni su código ni sus dependencias. Los node_modules se
# instalan en la carpeta temporal desde el LOCKFILE DE LA BASE, con
# --ignore-scripts (revisión de seguridad del #241: un `typescript` manipulado
# en los node_modules del PR hacía decir «todo en orden» a la compuerta antes
# de que llegara a marcar el lockfile). Usa el almacén de pnpm de la máquina.
# Solo lectura sobre el repositorio; la carpeta temporal se borra al salir.
set -euo pipefail

tanda="${1:?Uso: … | bash -s -- docs/arquitectura/tandas/tN.json [base]}"
base="${2:-origin/main}"
raiz="$(git rev-parse --show-toplevel)"
mb="$(git -C "$raiz" merge-base "$base" HEAD)"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/solo-rutas.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

git -C "$raiz" archive "$mb" admin/pruebas/frontera admin/functions/src \
  admin/package.json admin/pnpm-lock.yaml admin/pnpm-workspace.yaml \
  admin/functions/package.json admin/web/package.json | tar -x -C "$tmp"
echo "Instalando las dependencias de la base (lockfile de ${mb:0:7}, --ignore-scripts)…"
( cd "$tmp/admin" && pnpm install --frozen-lockfile --ignore-scripts --prefer-offline >/dev/null )
echo "solo-rutas con la herramienta de ${mb:0:7} (merge-base con $base), contra $raiz"
NOVUCHAT_RAIZ="$raiz" node "$tmp/admin/pruebas/frontera/solo-rutas.mjs" "$tanda" "$base"
