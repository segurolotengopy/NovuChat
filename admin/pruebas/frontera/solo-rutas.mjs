#!/usr/bin/env node
/**
 * =============================================================================
 * solo-rutas.mjs — ¿el PR de tanda es exactamente la mudanza?
 * =============================================================================
 *
 *   node admin/pruebas/frontera/solo-rutas.mjs <tanda.json> [base]   (base: origin/main)
 *
 * REPRODUCIBILIDAD (revisión de seguridad del #241): vuelve a correr
 * `planDeMudanza` con la tanda sobre el árbol de `git merge-base <base> HEAD`
 * (leyendo con `git show`, sin tocar el disco) y exige que cada archivo del
 * diff sea BYTE A BYTE el del plan. Lo único a mano: quitar entradas de
 * `deuda.json`, líneas de `SUITES_PURAS` y los `.md`. Un literal que no es una
 * ruta, una región o un mensaje cambiado no pasa, aunque esté entre comillas.
 * Exige el worktree limpio (compara lo que tiene commit). Solo lectura.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const emitirOriginal = process.emitWarning;
process.emitWarning = (aviso, ...resto) => {
  const codigo = resto.map((r) => (typeof r === 'object' && r ? r.code : r));
  if (codigo.includes('MODULE_TYPELESS_PACKAGE_JSON')) return;
  return emitirOriginal.call(process, aviso, ...resto);
};
const { RAIZ } = await import(pathToFileURL(join(AQUI, 'frontera.ts')).href);
const { planDeMudanza, archivosAMirar, verificarReproducible } = await import(pathToFileURL(join(AQUI, 'mudanza.ts')).href);
process.emitWarning = emitirOriginal;

const [rutaTanda, base = 'origin/main'] = process.argv.slice(2);
if (!rutaTanda) { console.error('Uso: solo-rutas.mjs <tanda.json> [base]'); process.exit(2); }
const git = (...a) => execFileSync('git', ['-C', RAIZ, '-c', 'core.quotePath=false', ...a], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
if (git('status', '--porcelain').trim()) { console.error('✗ El worktree tiene cambios sin commit: solo-rutas compara lo que tiene commit.'); process.exit(1); }

const tanda = JSON.parse(readFileSync(rutaTanda, 'utf8'));
const mb = git('merge-base', base, 'HEAD').trim();
const listaBase = git('ls-tree', '-r', '--name-only', mb).trim().split('\n');
const enBase = new Set(listaBase);
const carpetas = new Set(listaBase.flatMap((a) => a.split('/').slice(0, -1).map((_, i, p) => p.slice(0, i + 1).join('/'))));
const cache = new Map();
const leerBase = (r) => { if (!cache.has(r)) cache.set(r, git('show', `${mb}:${r}`)); return cache.get(r); };
const arbolBase = { leer: leerBase, existe: (r) => enBase.has(r), esCarpeta: (r) => carpetas.has(r) };
const plan = planDeMudanza(tanda, archivosAMirar(listaBase), arbolBase);

const diff = git('diff', '-M', '-l0', '--name-status', mb, 'HEAD').trim().split('\n').filter(Boolean)
  .map((l) => { const [estado, viejo, nuevo = viejo] = l.split('\t'); return { estado, viejo, nuevo }; });
const problemas = verificarReproducible(tanda, plan, diff, leerBase, (r) => git('show', `HEAD:${r}`));

console.log(`solo-rutas: ${diff.length} archivos en el diff contra ${mb.slice(0, 7)} (merge-base con ${base}); plan de ${tanda.length} movimientos.`);
for (const p of problemas) console.log(`  ✗ ${p}`);
if (problemas.length) process.exit(1);
console.log('  El PR es exactamente la mudanza (más las entradas de deuda saldadas y SUITES_PURAS).');
