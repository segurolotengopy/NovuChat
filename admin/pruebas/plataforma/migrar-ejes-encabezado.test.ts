/**
 * `scripts/plataforma/migrar-ejes.mjs`, EL ENCABEZADO (PR-4a, hallazgo m2 de la revisión de #497).
 *
 * Las conversaciones de un plan dependen de la TARIFA (`planes.ts`: 200/500/1.000 con
 * `estandar`, 100/220/500 con `meta_incluido`). El encabezado «Plan para los demos» decía
 * una sola cifra, la del catálogo estándar, y un demo (sin campo de tarifa, `meta_incluido`)
 * recibe la otra. Ahora dice las dos y de qué tarifa es cada una. NO cambia lo que se escribe
 * (eso ya sale de `copiaDeLimites`, con la tarifa de cada cuenta): se prueba en seco, sin
 * escribir, contra un comercio que no existe, que corta con 1 después de imprimir el encabezado.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { limitesDe } from '../../functions/src/central/cuenta/planes.ts';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '..', '..', 'scripts', 'plataforma', 'migrar-ejes.mjs');
const PROYECTO = 'demo-novuchat-pruebas';
const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;

function correr(...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO, '--operador', 'operador@ejemplo.com',
    '--tenant', 'mej-enc-no-existe', ...args], { env: entornoDelEmulador(HOST), encoding: 'utf8' });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
}
const encabezado = (salida: string) => /^ {2}Plan para los demos: .*$/m.exec(salida)?.[0] ?? '';

describe('migrar-ejes.mjs: el encabezado dice de qué tarifa son las conversaciones', () => {
  it.each(['impulso', 'crecimiento', 'pro'] as const)('%s: las cifras de Meta incluido (la de un demo sin campo) y las de estándar, rotuladas', (plan) => {
    const r = correr('--plan-demos', plan);
    expect(r.codigo, r.salida).toBe(1); // el comercio no existe: corta después del encabezado, sin escribir
    const e = encabezado(r.salida);
    const meta = limitesDe(plan, 'meta_incluido').conversaciones;
    const estandar = limitesDe(plan, 'estandar').conversaciones;
    expect(e).toContain(`${meta} conversaciones con la tarifa meta_incluido`);
    expect(e).toContain(`${estandar} con estandar`);
    expect(meta).not.toBe(estandar);
  });
});
