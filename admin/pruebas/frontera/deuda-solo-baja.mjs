#!/usr/bin/env node
/**
 * =============================================================================
 * deuda-solo-baja.mjs — la deuda de la frontera no crece en un PR
 * =============================================================================
 *
 *   node admin/pruebas/frontera/deuda-solo-baja.mjs <deuda-de-la-base.json> <deuda-del-pr.json>
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
 * Compara CANTIDADES, no claves: mover un archivo cambia la ruta de su entrada
 * sin cambiar cuántas hay, y eso es legítimo. Las claves nuevas se informan
 * para que el revisor las mire.
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

const claves = (d) => new Set([
  ...(d.cruces ?? []).map((c) => `cruce ${c.desde} → ${c.hacia}`),
  ...(d.sinZona ?? []).map((a) => `sin zona ${a}`),
  ...Object.keys(d.sinResolver ?? {}).map((a) => `sin resolver ${a}`),
  ...(d.transversales ?? []).map((a) => `transversal ${a}`),
]);

/** { crecen: [...], nuevas: [...] } entre la deuda de la base y la del PR. */
export function comparar(base, pr) {
  const a = medidas(base);
  const b = medidas(pr);
  const crecen = Object.keys(a).filter((k) => b[k] > a[k]).map((k) => `${k}: ${a[k]} → ${b[k]}`);
  const enBase = claves(base);
  const nuevas = [...claves(pr)].filter((k) => !enBase.has(k));
  return { antes: a, despues: b, crecen, nuevas };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [rutaBase, rutaPr] = process.argv.slice(2);
  if (!rutaBase || !rutaPr) {
    console.error('Uso: deuda-solo-baja.mjs <deuda-de-la-base.json> <deuda-del-pr.json>');
    process.exit(2);
  }
  const r = comparar(JSON.parse(readFileSync(rutaBase, 'utf8')), JSON.parse(readFileSync(rutaPr, 'utf8')));
  console.log(`Deuda de la frontera, base → PR: ${JSON.stringify(r.antes)} → ${JSON.stringify(r.despues)}`);
  for (const n of r.nuevas) console.log(`::notice::Entrada nueva en la deuda (¿un archivo movido?): ${n}`);
  if (r.crecen.length) {
    for (const c of r.crecen) console.log(`::error::La deuda de la frontera crece (${c}). Se corta el cruce o se ubica el archivo; no se anota.`);
    process.exit(1);
  }
  console.log('La deuda no crece.');
}
