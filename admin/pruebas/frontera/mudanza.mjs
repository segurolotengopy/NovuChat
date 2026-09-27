#!/usr/bin/env node
/**
 * =============================================================================
 * mudanza.mjs — mover archivos de F2 y reescribir quien los nombra
 * =============================================================================
 *
 *   node admin/pruebas/frontera/mudanza.mjs <tanda.json>              en seco: qué haría
 *   node admin/pruebas/frontera/mudanza.mjs <tanda.json> --escribir   git mv y escribe
 *
 * `tanda.json`: { "movimientos": [{ "de": "admin/functions/src/<viejo>.ts", "a": "admin/functions/src/core/<zona>/<viejo>.ts" }, …],
 *                 "suitesPuras": ["pruebas/…test.ts"] }   (va versionada en docs/arquitectura/tandas/)
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
import { existsSync, lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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
const { planDeMudanza, validarTanda, archivosAMirar, leerTanda } = await import(pathToFileURL(join(AQUI, 'mudanza.ts')).href);
process.emitWarning = emitirOriginal;

const [rutaTanda, ...banderas] = process.argv.slice(2);
if (!rutaTanda) { console.error('Uso: mudanza.mjs <tanda.json> [--escribir]'); process.exit(2); }
const ESCRIBIR = banderas.includes('--escribir');
const git = (...a) => execFileSync('git', ['-C', RAIZ, '-c', 'core.quotePath=false', ...a], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
// La tanda: un arreglo de { de, a }, o { movimientos, suitesPuras } (la forma
// versionada en docs/arquitectura/tandas/, que lee solo-rutas.mjs).
const tanda = leerTanda(JSON.parse(readFileSync(rutaTanda, 'utf8'))).movimientos;

// VALIDAR ANTES DE NADA (revisión de seguridad del #241): nada fuera del
// repositorio, de las raíces de mudanza o de su extensión; nada a medias.
const VERSIONADOS = new Set(git('ls-files').trim().split('\n'));
const pasaPorEnlace = (r) => {
  const partes = r.split('/');
  for (let i = 1; i < partes.length; i++) {
    const p = join(RAIZ, ...partes.slice(0, i));
    if (!existsSync(p)) return false;
    if (lstatSync(p).isSymbolicLink()) return true;
  }
  return false;
};
const errores = validarTanda(tanda, {
  existe: (r) => existsSync(join(RAIZ, r)),
  esArchivoVersionado: (r) => VERSIONADOS.has(r) && lstatSync(join(RAIZ, r), { throwIfNoEntry: false })?.isFile() === true,
  pasaPorEnlace,
});
if (errores.length) { for (const e of errores) console.error(`✗ ${e}`); process.exit(1); }
if (ESCRIBIR && git('status', '--porcelain').trim()) {
  console.error('✗ El worktree tiene cambios sin commit: --escribir los arrastraría al PR.'); process.exit(1);
}

const ARCHIVOS = archivosAMirar([...VERSIONADOS]);

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

console.log(`\nLiterales que nombran un archivo movido fuera de un contexto conocido (${plan.avisos.length}; no se reescriben, revisar a mano):`);
for (const a of plan.avisos) console.log(`  ${a}`);

/** Las rutas viejas, completas y sin `admin/`, en todo el repositorio. */
const restos = (donde) => {
  const patrones = tanda.flatMap((m) => [m.de, m.de.replace(/^admin\//, '')]);
  try {
    return git('grep', '-n', '-F', ...patrones.flatMap((v) => ['-e', v]), '--', ...donde).trim().split('\n').filter(Boolean);
  } catch { return []; } // git grep sale con 1 si no encuentra nada
};
const DOCUMENTACION = ['docs', 'Prompts', '.claude/agents', 'CLAUDE.md', 'admin/*.md', 'Flujos/*.md', 'ESTADO.md'];
const enDocs = restos(DOCUMENTACION);
console.log(`\nRestos en documentación (${enDocs.length}; se corrigen a mano en el mismo PR):`);
for (const l of enDocs) console.log(`  ${l}`);

if (!ESCRIBIR) { console.log('\nEn seco: no se escribió nada. Agregue --escribir.'); process.exit(0); }
// Primero, git mv -n de TODA la tanda: si uno falla, no se mueve ninguno.
for (const { de, a } of tanda) {
  mkdirSync(join(RAIZ, dirname(a)), { recursive: true });
}
try {
  for (const { de, a } of tanda) git('mv', '-n', de, a);
} catch (e) {
  console.error(`✗ git mv -n falló: ${e.message}. No se movió nada.`); process.exit(1);
}
for (const { de, a } of tanda) git('mv', de, a);
for (const e of plan.ediciones) writeFileSync(join(RAIZ, e.archivo), e.nuevoTexto);
console.log(`\nEscrito: ${tanda.length} movidos, ${plan.ediciones.filter((e) => e.cambios.length).length} archivos reescritos. Verificar con solo-rutas.mjs.`);
// La deuda que la tanda salda: se saca a mano de deuda.json, a la vista.
const vivas = new Set(analizar(listarRaices()).cruces.map(claveDeCruce));
const saldadas = leerDeuda().cruces.map(claveDeCruce).filter((k) => !vivas.has(k));
console.log(`\nCruces de la deuda que esta tanda salda (${saldadas.length}): sacarlos de deuda.json.`);
for (const k of saldadas) console.log(`  ${k}`);

// Restos en CÓDIGO después de escribir: la ruta vieja no puede quedar fuera de
// la documentación, la bitácora y los análisis.
// destinos-f2.ts es el mapa de rutas viejas a nuevas: las nombra a propósito.
const enCodigo = restos(['.', ':!docs', ':!Prompts', ':!bitacora', ':!Analisis', ':!*.md', ':!.claude/agents', ':!admin/pruebas/frontera/destinos-f2.ts']);
if (enCodigo.length) {
  console.error(`\n✗ La ruta vieja sigue en código o configuración (${enCodigo.length}); corregir a mano y revisar:`);
  for (const l of enCodigo) console.error(`  ${l}`);
  process.exit(1);
}
