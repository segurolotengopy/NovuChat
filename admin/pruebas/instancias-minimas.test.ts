/**
 * Las dos Functions que el flujo llama en serie en cada mensaje tienen una
 * instancia mínima: sin ella, la primera respuesta tras un rato sin tráfico
 * tardaba ~20 s por el arranque en frío (medido el 15/09/2026). Es un costo
 * fijo decidido (~16 USD al mes las dos): esta prueba evita que se pierda, o
 * que se suba, sin que nadie lo note.
 *
 * Desde el 26/09/2026 la instancia mínima es el parámetro INSTANCIAS_MINIMAS,
 * con valor por defecto 1: el despliegue de producción lo escribe en 1 (sin
 * valor en el .env, firebase-tools falla en modo no interactivo); staging, en 0 (ese costo, en un ambiente sin tráfico, triplicaba su presupuesto). La
 * prueba vigila las dos mitades: el valor por defecto y quién lo cambia.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));
const fuente = readFileSync(join(aqui, '../functions/src/ingesta.ts'), 'utf8');
const flujoCi = readFileSync(join(aqui, '../../.github/workflows/ci-node-firebase.yml'), 'utf8');

/** Las opciones del `onRequest` de una Function exportada, como texto. */
function opcionesDe(nombre: string): string {
  const i = fuente.indexOf(`export const ${nombre} = onRequest(`);
  expect(i, `no encontré ${nombre}`).toBeGreaterThan(-1);
  return fuente.slice(i, fuente.indexOf('async (', i));
}

/** El texto de un job del workflow, desde su cabecera hasta la del siguiente. */
function job(nombre: string): string {
  const i = flujoCi.indexOf(`\n  ${nombre}:\n`);
  expect(i, `no encontré el job ${nombre}`).toBeGreaterThan(-1);
  const resto = flujoCi.slice(i + 1);
  const siguiente = resto.slice(1).search(/\n {2}[a-z][a-z-]*:\n/);
  return siguiente === -1 ? resto : resto.slice(0, siguiente + 1);
}

describe('instancias mínimas de las Functions que el flujo llama en cada mensaje', () => {
  it('el parámetro vale 1 por defecto (producción)', () => {
    expect(fuente).toMatch(/const INSTANCIAS_MINIMAS = defineInt\('INSTANCIAS_MINIMAS', \{ default: 1 \}\);/);
  });

  for (const nombre of ['ingesta', 'configuracionFlujo']) {
    it(`${nombre} toma su instancia mínima del parámetro`, () => {
      expect(opcionesDe(nombre)).toMatch(/\bminInstances: INSTANCIAS_MINIMAS,/);
    });
  }

  // Producción lo ESCRIBE en 1 aunque sea el valor por defecto: con
  // --non-interactive, firebase-tools falla si un parámetro falta del .env
  // (no usa el default; lib/deploy/functions/params.js en 15.28.1).
  it('el despliegue de producción lo fija en 1, y en ningún otro valor', () => {
    const produccion = job('desplegar-produccion');
    expect(produccion).toMatch(/INSTANCIAS_MINIMAS=1\\n/);
    expect(produccion).not.toMatch(/INSTANCIAS_MINIMAS=(0|[2-9])/);
  });

  // La compuerta de la revisión de seguridad de #215: antes de simular, el job
  // de producción corta si hay un functions/.env.* (lo cargaría después y
  // pisaría el .env) o si INSTANCIAS_MINIMAS no quedó exactamente una vez en 1.
  it('producción tiene la compuerta que impide desplegar con otro valor', () => {
    const produccion = job('desplegar-produccion');
    expect(produccion).toContain("compgen -G 'functions/.env.*'");
    expect(produccion).toContain("grep -qx 'INSTANCIAS_MINIMAS=1' functions/.env");
    const compuerta = produccion.indexOf("grep -qx 'INSTANCIAS_MINIMAS=1' functions/.env");
    const simulacion = produccion.indexOf('firebase deploy --only "$SIMULAR"');
    expect(simulacion).toBeGreaterThan(-1);
    expect(compuerta).toBeGreaterThan(-1);
    expect(compuerta, 'la compuerta va antes de la simulación').toBeLessThan(simulacion);
  });

  it('ningún archivo de parámetros de las Functions está versionado', () => {
    const versionados = execFileSync('git', ['ls-files', 'functions'], { cwd: join(aqui, '..'), encoding: 'utf8' })
      .split('\n').filter((f) => /(^|\/)\.env(\.|$)/.test(f));
    expect(versionados).toEqual([]);
  });

  it('el despliegue de staging lo fija en 0, y en ningún otro valor', () => {
    const staging = job('desplegar-staging');
    expect(staging).toMatch(/INSTANCIAS_MINIMAS=0\\n/);
    expect(staging).not.toMatch(/INSTANCIAS_MINIMAS=[1-9]/);
  });
});
