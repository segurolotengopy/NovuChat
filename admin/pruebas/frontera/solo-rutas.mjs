#!/usr/bin/env node
/**
 * =============================================================================
 * solo-rutas.mjs — ¿el PR de movimiento cambia algo más que rutas?
 * =============================================================================
 *
 *   node admin/pruebas/frontera/solo-rutas.mjs [base]     (base: origin/main)
 *
 * Para cada archivo de código que el PR renombra o modifica
 * (`git diff -M --name-status <base> HEAD`), compara la versión de la base con
 * la del PR con los literales —y las listas de literales, como los argumentos
 * de `join`— reemplazados por un marcador (`esqueleto` de `mudanza.ts`). Si no
 * quedan iguales, el cambio no es solo de rutas y se revisa a mano. Un archivo
 * NUEVO o BORRADO en un PR de movimiento también se informa: una tanda solo
 * renombra. Sale con 1 si hay algo que revisar. Solo lectura.
 */
import { execFileSync } from 'node:child_process';
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
const { soloRutas } = await import(pathToFileURL(join(AQUI, 'mudanza.ts')).href);
process.emitWarning = emitirOriginal;

const base = process.argv[2] ?? 'origin/main';
const git = (...a) => execFileSync('git', ['-C', RAIZ, '-c', 'core.quotePath=false', ...a], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const lineas = git('diff', '-M', '-l0', '--name-status', base, 'HEAD').trim().split('\n').filter(Boolean);
const CODIGO = /\.(ts|tsx|mts|cts|mjs|cjs|js|jsx)$/;
const revisar = [];
let comparados = 0;
for (const l of lineas) {
  const [estado, viejo, nuevo = viejo] = l.split('\t');
  if (estado === 'A' || estado === 'D') { revisar.push(`${estado} ${viejo}: una tanda solo renombra`); continue; }
  if (!CODIGO.test(nuevo)) continue;
  comparados++;
  const antes = git('show', `${base}:${viejo}`);
  const despues = git('show', `HEAD:${nuevo}`);
  if (!soloRutas(nuevo, antes, despues)) revisar.push(`${estado} ${viejo}${nuevo !== viejo ? ` → ${nuevo}` : ''}: cambia algo más que rutas`);
}
console.log(`solo-rutas: ${lineas.length} archivos en el diff, ${comparados} de código comparados.`);
for (const r of revisar) console.log(`  ✗ ${r}`);
if (revisar.length) process.exit(1);
console.log('  Solo rutas.');
