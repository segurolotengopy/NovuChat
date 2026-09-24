/**
 * EL ALTA DE UN COMERCIO NACE CON PLAN DEL CATÁLOGO Y CON CONTADOR.
 *
 * Arreglo de integración (b). Las tres altas —`altaTenant` (Functions),
 * `scripts/alta-comercio.mjs` y el sembrador local `scripts/sembrar.mjs`—
 * escribían `plan: 'basico'`, que no es un plan del catálogo, y ninguna creaba
 * el contador del catálogo, sin el cual las reglas no dejan dar de alta ni de
 * baja un producto.
 *
 * `altaTenant` y `alta-comercio.mjs` necesitan el emulador de Auth
 * (`getUserByEmail`, `createUser`, claims), que `pruebas/correr.sh` no levanta.
 * Por eso esta prueba verifica la función pura que las tres usan
 * (`cuentaInicial`) y lee las fuentes para exigir que la usen, que creen el
 * contador con la forma que la regla acepta y que no quede ningún `'basico'`
 * escrito. No necesita emulador.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CATALOGO_PLANES, PLANES, PLAN_POR_DEFECTO, cuentaInicial, esIdPlan, limitesDeCuenta,
} from '../functions/src/planes.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
/**
 * La fuente SIN COMENTARIOS: lo que se exige es sobre el código que escribe, y
 * los comentarios cuentan (con razón) que antes se escribía `plan: 'basico'`.
 * El `[^:]` deja en paz las URL (`https://`).
 */
const leer = (ruta: string) => readFileSync(join(aqui, '..', ruta), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');
/** `lote.create(db.doc(`…/<ruta>`), {` o, en Functions, `lote.create(db().doc(`…`), {`. */
const crea = (ruta: string, cuerpo: string) => new RegExp(
  String.raw`lote\.create\(db(?:\(\))?\.doc\(\x60[^\x60]*\/${ruta}\x60\),\s*\{\s*${cuerpo}`);

describe('cuentaInicial()', () => {
  it('es el plan más chico, con su copia completa y la versión del catálogo', () => {
    const c = cuentaInicial();
    expect(c.plan).toBe(PLAN_POR_DEFECTO);
    expect(esIdPlan(c.plan)).toBe(true);
    // `pagaMeta` es del PLAN, no de los límites: no se copia a la cuenta porque
    // nadie lo hace cumplir, lo lee la consola (`planes.ts`, `Analisis/39`).
    const { nombre: _n, precioUsd: _p, pagaMeta: _m, ...limites } = PLANES[PLAN_POR_DEFECTO];
    expect(c.limites).toEqual(limites);
    expect(c.catalogoPlanes).toBe(CATALOGO_PLANES);
  });

  it('lo que escribe es una copia que rige tal cual (origen «cuenta», no el respaldo)', () => {
    expect(limitesDeCuenta(cuentaInicial())).toMatchObject({ origen: 'cuenta', productos: 20 });
  });

  it('cada llamada devuelve objetos nuevos: nadie puede tocar el catálogo por la copia', () => {
    const a = cuentaInicial();
    a.limites.productos = 999;
    expect(cuentaInicial().limites.productos).toBe(PLANES[PLAN_POR_DEFECTO].productos);
  });
});

// El bloque de `altaTenant` en index.ts: desde su declaración hasta la siguiente.
function bloqueAltaTenant(): string {
  const fuente = leer('functions/src/index.ts');
  const desde = fuente.indexOf('export const altaTenant');
  const hasta = fuente.indexOf('export const bajaTenant', desde);
  expect(desde, 'no se encontró altaTenant').toBeGreaterThan(-1);
  return fuente.slice(desde, hasta);
}

describe.each([
  ['altaTenant (functions/src/index.ts)', bloqueAltaTenant],
  ['scripts/alta-comercio.mjs', () => leer('scripts/alta-comercio.mjs')],
])('%s', (_nombre, fuente) => {
  it('usa cuentaInicial() y no escribe el viejo «basico»', () => {
    const f = fuente();
    expect(f).toMatch(/cuentaInicial\(\)/);
    expect(f).not.toMatch(/plan:\s*'basico'/);
    expect(f).toMatch(/plan:\s*cuenta\.plan/);
  });

  it('crea cuenta/estado con la copia y el contador del catálogo en cero, con los tres campos', () => {
    const f = fuente();
    expect(f).toMatch(crea('cuenta/estado', String.raw`\.\.\.cuenta,`));
    // `create`, no `set`: un alta no pisa un contador que ya existiera.
    expect(f).toMatch(crea('contadores/catalogo', `items: 0, ultimoItem: '', actualizadoEn:`));
  });
});

describe('scripts/sembrar.mjs', () => {
  it('no siembra el viejo «basico»: el plan sale de cuentaInicial()', () => {
    const f = leer('scripts/sembrar.mjs');
    expect(f).not.toMatch(/'basico'/);
    expect(f).toMatch(/cuentaInicial\(\)/);
  });
});
