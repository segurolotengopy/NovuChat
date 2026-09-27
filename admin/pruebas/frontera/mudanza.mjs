#!/usr/bin/env node
/**
 * =============================================================================
 * mudanza.mjs — mover archivos de F2 y reescribir quien los nombra
 * =============================================================================
 *
 *   node admin/pruebas/frontera/mudanza.mjs <tanda.json>              en seco: qué haría
 *   node admin/pruebas/frontera/mudanza.mjs <tanda.json> --escribir   git mv y escribe
 *
 * `tanda.json`: [{ "de": "admin/functions/src/atencion.ts", "a": "admin/functions/src/core/conteo/atencion.ts" }, …]
 *
 * La lógica está en `mudanza.ts` (probada en `mudanza.test.ts`). Recorre las
 * raíces de código, `scripts/` de la raíz y las configuraciones de vitest y
 * vite. No toca documentación: lista dónde queda la ruta vieja, para corregirla
 * a mano en el mismo PR. El modo que escribe se llama `--escribir` a propósito
 * (no `--aplicar`, que dispara `.claude/hooks/acciones-sensibles.sh`): no
 * escribe fuera del repositorio. Correrlo en un worktree limpio, nacido de
 * `origin/main`, y verificar después con `solo-rutas.mjs`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const emitirOriginal = process.emitWarning;
process.emitWarning = (aviso, ...resto) => {
  const codigo = resto.map((r) => (typeof r === 'object' && r ? r.code : r));
  if (codigo.includes('MODULE_TYPELESS_PACKAGE_JSON')) return;
  return emitirOriginal.call(process, aviso, ...resto);
};
const { RAIZ, ARBOL_REAL, listarRaices, analizar, claveDeCruce, leerDeuda } = await import(pathToFileURL(join(AQUI, 'frontera.ts')).href);
const { planDeMudanza } = await import(pathToFileURL(join(AQUI, 'mudanza.ts')).href);
process.emitWarning = emitirOriginal;

const [rutaTanda, ...banderas] = process.argv.slice(2);
if (!rutaTanda) { console.error('Uso: mudanza.mjs <tanda.json> [--escribir]'); process.exit(2); }
const ESCRIBIR = banderas.includes('--escribir');
const tanda = JSON.parse(readFileSync(rutaTanda, 'utf8'));

// Validar la tanda antes de nada.
for (const { de, a } of tanda) {
  if (!existsSync(join(RAIZ, de))) { console.error(`✗ No existe ${de}`); process.exit(1); }
  if (existsSync(join(RAIZ, a))) { console.error(`✗ Ya existe ${a}`); process.exit(1); }
}

const listar = (dir) => (existsSync(join(RAIZ, dir)) ? readdirSync(join(RAIZ, dir), { withFileTypes: true }).flatMap((e) =>
  (e.isDirectory() ? (e.name === 'node_modules' ? [] : listar(`${dir}/${e.name}`)) : [`${dir}/${e.name}`])) : []);
const ARCHIVOS = [...new Set([
  ...listarRaices(), ...listar('scripts'), 'admin/vitest.config.ts', 'admin/web/vite.config.ts',
].filter((a) => existsSync(join(RAIZ, a))))].sort();

const arbol = { ...ARBOL_REAL, esCarpeta: (r) => existsSync(join(RAIZ, r)) && statSync(join(RAIZ, r)).isDirectory() };
const plan = planDeMudanza(tanda, ARCHIVOS, arbol);

console.log(`Mudanza ${ESCRIBIR ? '(ESCRIBE)' : '(en seco)'}: ${tanda.length} archivos.\n`);
for (const { de, a } of tanda) console.log(`  git mv ${de} ${a}`);
console.log('');
for (const e of plan.ediciones) {
  if (!e.cambios.length) continue;
  console.log(`  ${e.archivo}`);
  for (const c of e.cambios) console.log(`      ${c}`);
}

// Lo que queda en documentación (no se toca).
const viejas = tanda.map((m) => m.de);
let restos = '';
try {
  restos = execFileSync('git', ['-C', RAIZ, 'grep', '-n', '-F', ...viejas.flatMap((v) => ['-e', v]), '--',
    'docs', 'Prompts', '.claude/agents', 'CLAUDE.md', 'admin/*.md', 'Flujos/*.md'], { encoding: 'utf8' });
} catch { /* git grep sale con 1 si no encuentra nada */ }
console.log(`\nRestos en documentación (${restos ? restos.trim().split('\n').length : 0}):`);
if (restos) console.log(restos.trim().split('\n').map((l) => `  ${l}`).join('\n'));

if (!ESCRIBIR) { console.log('\nEn seco: no se escribió nada. Agregue --escribir.'); process.exit(0); }
for (const { de, a } of tanda) {
  mkdirSync(join(RAIZ, dirname(a)), { recursive: true });
  execFileSync('git', ['-C', RAIZ, 'mv', de, a]);
}
for (const e of plan.ediciones) writeFileSync(join(RAIZ, e.archivo), e.nuevoTexto);
console.log(`\nEscrito: ${tanda.length} movidos, ${plan.ediciones.filter((e) => e.cambios.length).length} archivos reescritos. Verificar con solo-rutas.mjs.`);
// La deuda que la tanda salda: se saca a mano de deuda.json, a la vista.
const vivas = new Set(analizar(listarRaices()).cruces.map(claveDeCruce));
const saldadas = leerDeuda().cruces.map(claveDeCruce).filter((k) => !vivas.has(k));
console.log(`\nCruces de la deuda que esta tanda salda (${saldadas.length}): sacarlos de deuda.json.`);
for (const k of saldadas) console.log(`  ${k}`);
