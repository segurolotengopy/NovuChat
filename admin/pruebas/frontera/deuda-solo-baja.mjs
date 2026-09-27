#!/usr/bin/env node
/**
 * =============================================================================
 * deuda-solo-baja.mjs — la deuda de la frontera no crece en un PR
 * =============================================================================
 *
 *   node admin/pruebas/frontera/deuda-solo-baja.mjs <deuda-de-la-base.json> <deuda-del-pr.json> [movidos.txt]
 *
 * `movidos.txt` es la salida de `git diff -M --name-status <base> HEAD`: las
 * líneas `R…` (renombres) son lo único que explica una entrada nueva.
 *
 * Lo corre `calidad` en cada PR, con la `deuda.json` de la base
 * (`git show <base>:admin/pruebas/frontera/deuda.json`) y la del PR. Falla si
 * alguna lista CRECE: cruces conocidos, archivos sin zona, imports que no se
 * pueden seguir (por cantidad total) o pruebas transversales.
 *
 * Por qué hace falta, si `fronteras.test.ts` ya exige que la deuda coincida con
 * el código: esa prueba compara la lista con el árbol del PR, y un PR que
 * agrega un cruce y lo anota en la lista la deja en verde. La carpeta está
 * fuera de la zona de todo agente, pero el gancho no rige para `Bash` ni para
 * agentes sin zona (revisión de seguridad del PR #231, LOW 1). Esto es lo que
 * lo hace cumplir en el CI.
 *
 * Dos controles:
 *   - Ninguna lista CRECE en cantidad.
 *   - Toda entrada NUEVA se explica por un archivo movido: es una entrada que
 *     desapareció con sus rutas pasadas por los renombres del PR. Sin esto,
 *     saldar un cruce trivial y anotar uno nuevo dejaba la cantidad igual y
 *     pasaba (revisión de seguridad del #236). Las transversales, igual.
 *
 * El CI corre la versión de ESTE archivo que está en la base del PR, no la del
 * PR, para que un PR no afloje el comparador que lo juzga.
 *
 * Solo lectura: no escribe nada, no abre la red.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Las cantidades que no pueden crecer. */
export function medidas(deuda) {
  return {
    cruces: deuda.cruces?.length ?? 0,
    sinZona: deuda.sinZona?.length ?? 0,
    sinResolver: Object.values(deuda.sinResolver ?? {}).reduce((t, v) => t + (v?.cantidad ?? 0), 0),
    transversales: deuda.transversales?.length ?? 0,
  };
}

/** Las claves de cada lista, con las rutas por separado para poder renombrarlas. */
const claves = (d) => [
  ...(d.cruces ?? []).map((c) => ({ lista: 'cruce', rutas: [c.desde, c.hacia] })),
  ...(d.sinZona ?? []).map((a) => ({ lista: 'sin zona', rutas: [a] })),
  ...Object.keys(d.sinResolver ?? {}).map((a) => ({ lista: 'sin resolver', rutas: [a] })),
  ...(d.transversales ?? []).map((a) => ({ lista: 'transversal', rutas: [a] })),
];
const texto = (k) => `${k.lista} ${k.rutas.join(' → ')}`;

/** Los renombres de `git diff -M --name-status`: Map ruta vieja → ruta nueva. */
export function leerMovidos(salida) {
  const movidos = new Map();
  for (const linea of String(salida ?? '').split('\n')) {
    const [estado, vieja, nueva] = linea.split('\t');
    if (estado?.startsWith('R') && vieja && nueva) movidos.set(vieja, nueva);
  }
  return movidos;
}

/**
 * { crecen, nuevas, inexplicadas } entre la deuda de la base y la del PR.
 * Una entrada nueva está explicada si es una entrada de la base que ya no está,
 * con alguna de sus rutas movida por el PR.
 */
export function comparar(base, pr, movidos = new Map()) {
  const a = medidas(base);
  const b = medidas(pr);
  const crecen = Object.keys(a).filter((k) => b[k] > a[k]).map((k) => `${k}: ${a[k]} → ${b[k]}`);
  const enBase = claves(base);
  const enPr = claves(pr);
  const textosBase = new Set(enBase.map(texto));
  const textosPr = new Set(enPr.map(texto));
  const nuevas = enPr.filter((k) => !textosBase.has(texto(k)));
  const desaparecidas = enBase.filter((k) => !textosPr.has(texto(k)));
  const movida = (k) => ({ lista: k.lista, rutas: k.rutas.map((r) => movidos.get(r) ?? r) });
  const explicables = new Set(desaparecidas.filter((k) => k.rutas.some((r) => movidos.has(r))).map((k) => texto(movida(k))));
  const inexplicadas = nuevas.filter((k) => !explicables.has(texto(k))).map(texto);
  return { antes: a, despues: b, crecen, nuevas: nuevas.map(texto), inexplicadas };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [rutaBase, rutaPr, rutaMovidos] = process.argv.slice(2);
  if (!rutaBase || !rutaPr) {
    console.error('Uso: deuda-solo-baja.mjs <deuda-de-la-base.json> <deuda-del-pr.json> [movidos.txt]');
    process.exit(2);
  }
  const movidos = leerMovidos(rutaMovidos ? readFileSync(rutaMovidos, 'utf8') : '');
  const r = comparar(JSON.parse(readFileSync(rutaBase, 'utf8')), JSON.parse(readFileSync(rutaPr, 'utf8')), movidos);
  console.log(`Deuda de la frontera, base → PR: ${JSON.stringify(r.antes)} → ${JSON.stringify(r.despues)}`);
  for (const n of r.nuevas) console.log(`::notice::Entrada nueva en la deuda: ${n}`);
  for (const c of r.crecen) console.log(`::error::La deuda de la frontera crece (${c}). Se corta el cruce o se ubica el archivo; no se anota.`);
  for (const i of r.inexplicadas) console.log(`::error::Entrada nueva que ningún archivo movido explica: ${i}. Saldar otra no la compensa.`);
  if (r.crecen.length || r.inexplicadas.length) process.exit(1);
  console.log('La deuda no crece y sus entradas nuevas son archivos movidos.');
}
