#!/usr/bin/env bash
# Genera admin/functions/package-lock.json para Cloud Build.
#
# Cloud Build instala las Functions con `npm ci` usando este lockfile, y el job
# de despliegue también (firebase deploy necesita cargar el código para saber
# qué Functions hay). Si el lockfile está mal, las Functions llegan a
# producción sin sus dependencias.
#
# POR QUÉ EN UNA CARPETA APARTE. functions/ vive en un workspace de pnpm: su
# node_modules son ENLACES al almacén de pnpm. Si `npm install
# --package-lock-only` corre ahí, npm no resuelve nada —«up to date in 1s»— y
# escribe un lockfile con las dependencias directas como enlaces a rutas que
# solo existen en esa máquina. En cualquier otra, `npm ci` instala 3 paquetes en
# vez de ~250 y falta firebase-functions. Lo destapó v0.1.2 (2026-09-12); hasta
# entonces nada había desplegado por CI, así que el defecto nunca se había
# ejecutado.
#
# Acá se resuelve desde el package.json solo, en una carpeta temporal sin
# node_modules, y el resultado se verifica ANTES de copiarlo.
#
# LÍMITE CONOCIDO: npm resuelve dentro de los rangos de package.json; no copia
# las versiones exactas de pnpm-lock.yaml. Es lo mismo que ocurre en cada
# despliegue manual, donde Cloud Build instala sin lockfile. Si una dependencia
# directa sale distinta de la que probó pnpm, se avisa.
set -euo pipefail

ADMIN="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FUNCIONES="$ADMIN/functions"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cp "$FUNCIONES/package.json" "$TMP/"
( cd "$TMP" && npm install --package-lock-only --ignore-scripts --no-audit --no-fund >/dev/null )

node - "$TMP/package-lock.json" "$FUNCIONES" <<'JS'
const fs = require('fs');
const path = require('path');
const [lock, funciones] = process.argv.slice(2);
const paquetes = JSON.parse(fs.readFileSync(lock, 'utf8')).packages || {};

const enlaces = Object.entries(paquetes).filter(([, p]) => p.link).map(([k]) => k);
if (enlaces.length) {
  console.error('::error::el lockfile trae enlaces, no paquetes: ' + enlaces.join(', '));
  process.exit(1);
}

const directas = Object.keys(
  JSON.parse(fs.readFileSync(path.join(funciones, 'package.json'), 'utf8')).dependencies || {});
for (const d of directas) {
  const p = paquetes['node_modules/' + d];
  if (!p || !p.version) {
    console.error(`::error::falta ${d} en el lockfile`);
    process.exit(1);
  }
  let probada = '';
  try {
    probada = JSON.parse(fs.readFileSync(
      path.join(funciones, 'node_modules', d, 'package.json'), 'utf8')).version;
  } catch { /* sin node_modules de pnpm: no hay con qué comparar */ }
  if (probada && probada !== p.version) {
    console.log(`::warning::${d}: el lockfile resuelve ${p.version} y pnpm probó ${probada}`);
  }
  console.log(`  ${d}@${p.version}${probada ? ` (pnpm: ${probada})` : ''}`);
}
console.log(`${Object.keys(paquetes).length - 1} paquetes en el lockfile, ninguno como enlace.`);
JS

cp "$TMP/package-lock.json" "$FUNCIONES/package-lock.json"
echo "package-lock.json generado para Cloud Build."
