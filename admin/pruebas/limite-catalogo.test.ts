/**
 * =============================================================================
 * LÍMITE DE PRODUCTOS POR PLAN — lo que no cabe en `reglas.test.ts`
 * =============================================================================
 *
 * Decisión del 15/09/2026: 20 / 100 / 500 productos. Las reglas del alta de a
 * uno se prueban en `reglas.test.ts` («Límite de productos por plan»). Acá va
 * el resto del servidor, también NEGANDO:
 *
 *  1. UNA SOLA FUENTE para los números: la tabla de respaldo de
 *     `firestore.rules`, la de `functions/src/limiteCatalogo.ts` y —si existe
 *     en la rama— `functions/src/planes.ts`, que es la fuente.
 *  2. LA MISMA FORMA DE ÍTEM en las reglas y en `importarCatalogo`: el SDK
 *     Admin se salta las reglas, así que la función las copia; acá se pasan
 *     los mismos casos por las dos y se exige que digan lo mismo.
 *  3. `importarCatalogo` contra el emulador: corta en el límite con
 *     `motivo: 'limite_plan'`, deja el contador igual a lo que hay, y NO deja
 *     entrar a nadie que las reglas no dejarían crear.
 *  4. `scripts/contar-catalogo.mjs`: en seco no escribe, con `--aplicar` crea
 *     o corrige el contador, y no borra nada.
 */
import {
  initializeTestEnvironment, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, writeBatch, increment, serverTimestamp } from 'firebase/firestore';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { idDeNombre } from '../web/src/lib/csv.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const PROYECTO = 'demo-novuchat-pruebas';
const PUERTO = Number(process.env['FIRESTORE_EMULATOR_PORT'] ?? 8231);
const HOST = `127.0.0.1:${PUERTO}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;

// EL SDK ADMIN, RESUELTO DESDE `functions/`. `importarCatalogo` usa la app por
// defecto de SU copia de firebase-admin (functions/node_modules); si la prueba
// inicializara la de `admin/node_modules`, serían dos instancias distintas y la
// función no encontraría ninguna app.
const requerir = createRequire(join(aqui, '..', 'functions', 'package.json'));
const { initializeApp, getApps } = requerir('firebase-admin/app') as typeof import('firebase-admin/app');
const { getFirestore } = requerir('firebase-admin/firestore') as typeof import('firebase-admin/firestore');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const db = getFirestore();

const L = await import('../functions/src/limiteCatalogo.ts');
const P = await import('../functions/src/planes.ts');

// ===========================================================================
// 1) UNA SOLA FUENTE PARA LOS NÚMEROS
// ===========================================================================
describe('Los números del límite: una sola fuente', () => {
  const reglas = readFileSync(join(aqui, '..', 'firestore.rules'), 'utf8');
  const desde = reglas.indexOf('function limiteProductos()');
  const funcion = reglas.slice(desde, reglas.indexOf('function altaContada', desde));

  // LA FUENTE ES `planes.ts`. Antes de integrar la rama de planes esta prueba
  // se saltaba si el archivo no existía; ahora es obligatoria, y compara la
  // regla con `PLANES_ASIGNABLES` directamente (no con una copia intermedia).
  it('la tabla de respaldo de las reglas es la de planes.ts, con el mismo mínimo', () => {
    const m = funcion.match(/\{('[^}]*)\}\s*\.get\(cuenta\.get\('plan', ''\),\s*(\d+)\)/);
    expect(m, 'no se encontró la tabla en limiteProductos() de firestore.rules').not.toBeNull();
    const tabla = Object.fromEntries([...m![1]!.matchAll(/'(\w+)':\s*(\d+)/g)]
      .map((x) => [x[1], Number(x[2])]));
    const dePlanes = Object.fromEntries(Object.entries(P.PLANES_ASIGNABLES).map(([id, p]) => [id, p.productos]));
    // Todos los planes asignables, demostración incluida, y ninguno de más.
    expect(tabla).toEqual(dePlanes);
    expect(Number(m![2])).toBe(P.PLANES[P.PLAN_POR_DEFECTO].productos);
    // Y la tabla derivada de la función, que usa `importarCatalogo`.
    expect({ ...L.PRODUCTOS_POR_PLAN_RESPALDO }).toEqual(dePlanes);
    expect(L.PRODUCTOS_SIN_PLAN).toBe(P.PLANES[P.PLAN_POR_DEFECTO].productos);
  });

  it('la regla acepta la copia en el MISMO rango que limitesDeCuenta (1..LIMITE_MAXIMO)', () => {
    const r = funcion.match(/propio is int && propio >= (\d+) && propio <= (\d+)/);
    expect(r, 'la regla no acota limites.productos').not.toBeNull();
    expect(Number(r![1])).toBe(1);
    expect(Number(r![2])).toBe(P.LIMITE_MAXIMO);
  });

  it('son los de la decisión del 15/09: 20 / 100 / 500, y el mínimo es el menor', () => {
    expect(L.PRODUCTOS_POR_PLAN_RESPALDO).toMatchObject({ impulso: 20, crecimiento: 100, pro: 500 });
    const vendibles = Object.values(P.PLANES).map((p) => p.productos);
    expect(L.PRODUCTOS_SIN_PLAN).toBe(Math.min(...vendibles));
    // El plan de demostración no se vende, pero existe para las reglas.
    expect(L.PRODUCTOS_POR_PLAN_RESPALDO['demostracion']).toBe(P.PLANES.pro.productos);
  });

  it('la función del catálogo es limitesDeCuenta: mismo número en los casos del borde', () => {
    for (const cuenta of [
      undefined, {}, { plan: 'basico' }, { plan: 'toString' }, { plan: 'demostracion' },
      { plan: 'pro', limites: { productos: 0 } }, { plan: 'pro', limites: { productos: -3 } },
      { plan: 'impulso', limites: { productos: P.LIMITE_MAXIMO } },
      { plan: 'impulso', limites: { productos: P.LIMITE_MAXIMO + 1 } },
      { plan: 'crecimiento', limites: { productos: 12.5 } }, { plan: 'crecimiento', limites: [] },
      { plan: 'impulso', limites: { productos: 500 } },
    ] as Array<Record<string, unknown> | undefined>) {
      expect(L.limiteDeProductos(cuenta), JSON.stringify(cuenta)).toBe(P.limitesDeCuenta(cuenta).productos);
    }
  });

  it('el id que deriva la función es el que deriva la consola (si no, reimportar duplica)', () => {
    for (const nombre of ['Corte y lavado', '  Pizza Muzzarella  ', 'Salteña de pollo', 'Ñandú', 'ÁÉÍÓÚ ü',
      'Café & té', '---', '', 'x'.repeat(90), 'Promo 2x1 (martes)', 'Tratamiento—facial']) {
      expect(L.idDeItem(nombre)).toBe(idDeNombre(nombre));
    }
  });
});

// ===========================================================================
// Semilla con el SDK Admin
// ===========================================================================
type Cuenta = Record<string, unknown> | null;
async function sembrar(t: string, { estado = 'activo', productos = 0, contador = true, cuenta = { plan: 'basico' } as Cuenta } = {}) {
  await db.recursiveDelete(db.doc(`tenants/${t}`));
  await db.doc(`tenants/${t}`).set({ nombre: t, estado, vertical: 'venta', flujos: ['venta'] });
  if (cuenta) await db.doc(`tenants/${t}/cuenta/estado`).set(cuenta);
  const lote = db.batch();
  for (let i = 1; i <= productos; i++) {
    lote.set(db.doc(`tenants/${t}/catalogo/p${i}`), {
      nombre: `P${i}`, precio: i, moneda: 'BOB', activo: true, actualizadoPor: 'seed', actualizadoEn: new Date(),
    });
  }
  if (contador) {
    lote.set(db.doc(`tenants/${t}/contadores/catalogo`),
      { items: productos, ultimoItem: productos ? `p${productos}` : '', actualizadoEn: new Date() });
  }
  await lote.commit();
}
const cuantos = async (t: string) => (await db.collection(`tenants/${t}/catalogo`).get()).size;
const contadorDe = async (t: string) => (await db.doc(`tenants/${t}/contadores/catalogo`).get()).data();
const producto = async (t: string, id: string) => (await db.doc(`tenants/${t}/catalogo/${id}`).get()).data();
const item = (nombre: string, extra: Record<string, unknown> = {}) =>
  ({ nombre, precio: 10, moneda: 'BOB', activo: true, ...extra });

// ===========================================================================
// 2) LA MISMA FORMA DE ÍTEM EN LAS REGLAS Y EN LA FUNCIÓN
// ===========================================================================
let entorno: RulesTestEnvironment;
const EQ = 'lim-equivalencia';
const tokenPersona = (tenants: Record<string, string>, proveedor = 'password', verificado = true) => ({
  nc: { t: tenants, v: 1 },
  firebase: { sign_in_provider: proveedor, identities: {} },
  email_verified: verificado,
});

beforeAll(async () => {
  entorno = await initializeTestEnvironment({
    projectId: PROYECTO,
    firestore: {
      rules: readFileSync(join(aqui, '..', 'firestore.rules'), 'utf8'),
      host: '127.0.0.1', port: PUERTO,
    },
  });
});
afterAll(async () => { await entorno?.cleanup(); });

describe('La forma del ítem: la función y las reglas dicen lo mismo', () => {
  const CASOS: Array<[string, Record<string, unknown>]> = [
    ['mínimo', { nombre: 'Pan', activo: true }],
    ['precio 0 en dólares, inactivo', { nombre: 'Pan', precio: 0, moneda: 'USD', activo: false }],
    ['nombre de 80', { nombre: 'x'.repeat(80), activo: true }],
    ['nombre de 80 eñes', { nombre: 'ñ'.repeat(80), activo: true }],
    ['descripción 300 y área 40', { nombre: 'P', descripcion: 'd'.repeat(300), area: 'a'.repeat(40), activo: true }],
    ['precio tope', { nombre: 'P', precio: 1_000_000, activo: true }],
    ['precio con decimales', { nombre: 'P', precio: 12.5, activo: true }],
    ['precio nulo = a consultar', { nombre: 'P', precio: null, activo: true }],
    ['duración 15', { nombre: 'P', duracionMin: 15, activo: true }],
    ['duración 1440', { nombre: 'P', duracionMin: 1440, activo: true }],
    ['foto vacía', { nombre: 'P', imagenUrl: '', activo: true }],
    ['foto https', { nombre: 'P', imagenUrl: 'https://ejemplo.bo/a.png', activo: true }],
    // Lo que se rechaza
    ['nombre vacío', { nombre: '', activo: true }],
    ['nombre de 81', { nombre: 'x'.repeat(81), activo: true }],
    ['nombre de 81 eñes', { nombre: 'ñ'.repeat(81), activo: true }],
    ['nombre que no es texto', { nombre: 5, activo: true }],
    ['sin activo', { nombre: 'P' }],
    ['activo como texto', { nombre: 'P', activo: 'si' }],
    ['precio negativo', { nombre: 'P', precio: -1, activo: true }],
    ['precio sobre el tope', { nombre: 'P', precio: 1_000_001, activo: true }],
    ['precio como texto', { nombre: 'P', precio: '10', activo: true }],
    ['moneda desconocida', { nombre: 'P', moneda: 'EUR', activo: true }],
    ['moneda nula', { nombre: 'P', moneda: null, activo: true }],
    ['duración 50', { nombre: 'P', duracionMin: 50, activo: true }],
    ['duración 0', { nombre: 'P', duracionMin: 0, activo: true }],
    ['duración 1455', { nombre: 'P', duracionMin: 1455, activo: true }],
    ['duración con decimales', { nombre: 'P', duracionMin: 30.5, activo: true }],
    ['duración nula', { nombre: 'P', duracionMin: null, activo: true }],
    ['foto http', { nombre: 'P', imagenUrl: 'http://ejemplo.bo/a.png', activo: true }],
    ['foto con espacio', { nombre: 'P', imagenUrl: 'https://ejemplo.bo/a b.png', activo: true }],
    ['foto de 501', { nombre: 'P', imagenUrl: `https://${'a'.repeat(493)}`, activo: true }],
    ['descripción de 301', { nombre: 'P', descripcion: 'd'.repeat(301), activo: true }],
    ['descripción nula', { nombre: 'P', descripcion: null, activo: true }],
    ['área de 41', { nombre: 'P', area: 'a'.repeat(41), activo: true }],
    ['campo inventado', { nombre: 'P', trampa: 1, activo: true }],
    ['con stock al crear', { nombre: 'P', stock: 3, activo: true }],
  ];

  it('cada caso recibe el mismo veredicto por las dos puertas', async () => {
    await sembrar(EQ, { cuenta: { plan: 'pro' } });
    const fs = entorno.authenticatedContext('u-admin-eq', tokenPersona({ [EQ]: 'admin' })).firestore();
    const diferencias: string[] = [];
    let aceptados = 0;
    for (const [i, [nombre, caso]] of CASOS.entries()) {
      const id = `c${i}`;
      await db.doc(`tenants/${EQ}/contadores/catalogo`).set({ items: 0, ultimoItem: '', actualizadoEn: new Date() });
      const lote = writeBatch(fs);
      lote.set(doc(fs, `tenants/${EQ}/catalogo/${id}`),
        { ...caso, actualizadoPor: 'u-admin-eq', actualizadoEn: serverTimestamp() });
      lote.update(doc(fs, `tenants/${EQ}/contadores/catalogo`),
        { items: increment(1), ultimoItem: id, actualizadoEn: serverTimestamp() });
      const reglas = await lote.commit().then(() => true, () => false);
      const funcion = L.formaDeAltaValida(caso);
      if (reglas) aceptados += 1;
      if (reglas !== funcion) diferencias.push(`${nombre}: reglas ${reglas}, función ${funcion}`);
    }
    expect(diferencias).toEqual([]);
    // Contra las pruebas que pasan en vacío: si las reglas rechazaran TODO
    // (un contador roto, una semilla que falló), la lista de arriba igual
    // podría quedar vacía para los casos inválidos.
    expect(aceptados).toBe(CASOS.filter(([, c]) => L.formaDeAltaValida(c)).length);
    expect(aceptados).toBeGreaterThan(5);
  });

  it('el contador que crea importarCatalogo lo aceptan después las reglas del alta de a uno', async () => {
    await sembrar(EQ, { productos: 3, contador: false });
    await llamar({ tenantId: EQ, items: [] }, comoAdmin(EQ));
    expect(await contadorDe(EQ)).toMatchObject({ items: 3 });
    const fs = entorno.authenticatedContext('u-admin-eq', tokenPersona({ [EQ]: 'admin' })).firestore();
    const lote = writeBatch(fs);
    lote.set(doc(fs, `tenants/${EQ}/catalogo/nuevo`),
      { ...item('Nuevo'), actualizadoPor: 'u-admin-eq', actualizadoEn: serverTimestamp() });
    lote.update(doc(fs, `tenants/${EQ}/contadores/catalogo`),
      { items: increment(1), ultimoItem: 'nuevo', actualizadoEn: serverTimestamp() });
    await expect(lote.commit()).resolves.toBeUndefined();
    expect(await contadorDe(EQ)).toMatchObject({ items: 4, ultimoItem: 'nuevo' });
  });
});

// ===========================================================================
// 3) importarCatalogo CONTRA EL EMULADOR
// ===========================================================================
type Auth = { uid: string; token: Record<string, unknown> } | undefined;
function llamar(data: unknown, auth: Auth) {
  const f = L.importarCatalogo as unknown as { run: (r: unknown) => Promise<import('../functions/src/limiteCatalogo.ts').ResultadoImportacion> };
  return f.run({ data, auth, rawRequest: {} });
}
function comoAdmin(t: string): Auth { return { uid: `u-admin-${t}`, token: tokenPersona({ [t]: 'admin' }) }; }

const T = 'lim-activo';

describe('importarCatalogo: crea hasta donde deja el plan', () => {
  it('con 18 de 20, de 5 nuevos crea 2 y corta con motivo limite_plan', async () => {
    await sembrar(T, { productos: 18 });
    const r = await llamar({ tenantId: T, items: ['A', 'B', 'C', 'D', 'E'].map((n) => item(n)) }, comoAdmin(T));
    expect(r.creados).toEqual(['a', 'b']);
    expect(r.rechazados).toEqual([2, 3, 4].map((indice) =>
      ({ indice, id: 'cde'[indice - 2], motivo: 'limite_plan' })));
    expect(r.motivo).toBe('limite_plan');
    expect(r).toMatchObject({ limite: 20, items: 20 });
    expect(await cuantos(T)).toBe(20);
    expect(await contadorDe(T)).toMatchObject({ items: 20, ultimoItem: 'b' });
    expect(Object.keys((await contadorDe(T))!).sort()).toEqual(['actualizadoEn', 'items', 'ultimoItem']);
  });

  it('con el cupo lleno, lo que ya existe se actualiza y NO consume cupo', async () => {
    await sembrar(T, { productos: 20 });
    const r = await llamar({ tenantId: T, items: [item('P3', { precio: 99 }), item('Nuevo')] }, comoAdmin(T));
    expect(r.actualizados).toEqual(['p3']);
    expect(r.creados).toEqual([]);
    expect(r.rechazados).toEqual([{ indice: 1, id: 'nuevo', motivo: 'limite_plan' }]);
    expect((await producto(T, 'p3'))?.['precio']).toBe(99);
    expect(await cuantos(T)).toBe(20);
  });

  it('`limites.productos: 500` en la cuenta deja pasar el 21', async () => {
    await sembrar(T, { productos: 20, cuenta: { plan: 'impulso', limites: { productos: 500 } } });
    const r = await llamar({ tenantId: T, items: [item('Nuevo')] }, comoAdmin(T));
    expect(r.creados).toEqual(['nuevo']);
    expect(r.motivo).toBeUndefined();
    expect(r.limite).toBe(500);
  });

  it('sin `limites`, el respaldo por plan; sin plan conocido o sin cuenta, 20', async () => {
    for (const [cuenta, limite] of [
      [{ plan: 'impulso' }, 20], [{ plan: 'crecimiento' }, 100], [{ plan: 'pro' }, 500],
      [{ plan: 'demostracion' }, 500], [{ plan: 'basico' }, 20], [null, 20],
      [{ plan: 'crecimiento', limites: { productos: '500' } }, 100],
    ] as const) {
      await sembrar(T, { cuenta: cuenta as Cuenta });
      expect((await llamar({ tenantId: T, items: [] }, comoAdmin(T))).limite).toBe(limite);
    }
  });

  it('sin contador, lo crea contando lo que hay, y con `items: []` basta', async () => {
    await sembrar(T, { productos: 7, contador: false });
    const r = await llamar({ tenantId: T, items: [] }, comoAdmin(T));
    expect(r).toMatchObject({ creados: [], items: 7 });
    expect(await contadorDe(T)).toMatchObject({ items: 7, ultimoItem: '' });
  });

  it('sin contador y ya por encima del límite, no crea nada y deja el contador verdadero', async () => {
    await sembrar(T, { productos: 25, contador: false });
    const r = await llamar({ tenantId: T, items: [item('Otro')] }, comoAdmin(T));
    expect(r.creados).toEqual([]);
    expect(r.motivo).toBe('limite_plan');
    expect(await contadorDe(T)).toMatchObject({ items: 25 });
  });

  it('lo que las reglas no dejarían crear, no entra', async () => {
    await sembrar(T, { productos: 1 });
    const r = await llamar({ tenantId: T, items: [
      { nombre: '', activo: true },
      item('A', { precio: -1 }),
      item('B', { stock: 5 }),
      item('C', { duracionMin: 50 }),
      item('D', { activo: 'si' }),
      item('E', { trampa: 1 }),
      'no es un objeto',
      item('F', { imagenUrl: 'javascript:alert(1)' }),
      item('G', { id: '../otro-comercio' }),
      item('H', { activo: null }),
    ] }, comoAdmin(T));
    expect(r.creados).toEqual([]);
    expect(r.rechazados.map((x) => x.motivo)).toEqual(
      ['id_invalido', 'forma', 'forma', 'forma', 'forma', 'forma', 'forma', 'forma', 'id_invalido', 'forma']);
    expect(await cuantos(T)).toBe(1);
    expect(await contadorDe(T)).toMatchObject({ items: 1 });
  });

  // Arreglo de integración (a): la consola manda `activo` en las altas porque
  // `csv.ts` lo supone verdadero sin la columna, pero la callable es una API
  // del servidor y no puede depender de eso. Solo se suple la AUSENCIA, y solo
  // en un ítem NUEVO: una edición sin `activo` no reactiva uno dado de baja.
  it('un ítem NUEVO sin `activo` nace activo; uno existente sin `activo` conserva el suyo', async () => {
    await sembrar(T, { productos: 1 });
    await db.doc(`tenants/${T}/catalogo/p1`).update({ activo: false });
    const r = await llamar({ tenantId: T, items: [
      { nombre: 'Sin columna', precio: 1, moneda: 'BOB' },
      { id: 'p1', nombre: 'P1', precio: 2 },
    ] }, comoAdmin(T));
    expect(r.creados).toEqual(['sin-columna']);
    expect(r.actualizados).toEqual(['p1']);
    expect(await producto(T, 'sin-columna')).toMatchObject({ activo: true });
    expect(await producto(T, 'p1')).toMatchObject({ activo: false, precio: 2 });
    expect(await contadorDe(T)).toMatchObject({ items: 2, ultimoItem: 'sin-columna' });
  });

  // Arreglo de integración (b): la consola, sin contador, llama a la callable
  // con `items: []` antes de la primera BAJA. El contador que queda tiene que
  // dejar pasar esa baja por las reglas (el alta ya se prueba arriba, en «el
  // contador que crea importarCatalogo lo aceptan después las reglas…»).
  it('el contador que crea importarCatalogo deja pasar después una baja de a una', async () => {
    await sembrar(EQ, { productos: 3, contador: false });
    await llamar({ tenantId: EQ, items: [] }, comoAdmin(EQ));
    const fs = entorno.authenticatedContext('u-admin-eq', tokenPersona({ [EQ]: 'admin' })).firestore();
    const lote = writeBatch(fs);
    lote.delete(doc(fs, `tenants/${EQ}/catalogo/p2`));
    lote.update(doc(fs, `tenants/${EQ}/contadores/catalogo`),
      { items: increment(-1), ultimoItem: 'p2', actualizadoEn: serverTimestamp() });
    await expect(lote.commit()).resolves.toBeUndefined();
    expect(await contadorDe(EQ)).toMatchObject({ items: 2, ultimoItem: 'p2' });
    expect(await cuantos(EQ)).toBe(2);
  });

  it('dos filas con el mismo id: entra la primera y la segunda se rechaza', async () => {
    await sembrar(T);
    const r = await llamar({ tenantId: T, items: [item('Pan'), item('pan', { precio: 20 })] }, comoAdmin(T));
    expect(r.creados).toEqual(['pan']);
    expect(r.rechazados).toEqual([{ indice: 1, id: 'pan', motivo: 'duplicado' }]);
    expect((await producto(T, 'pan'))?.['precio']).toBe(10);
  });

  it('`null` en una actualización borra el campo; quitar el precio quita la moneda', async () => {
    await sembrar(T, { productos: 1 });
    const r = await llamar({ tenantId: T, items: [{ id: 'p1', nombre: 'P1', precio: null }] }, comoAdmin(T));
    expect(r.actualizados).toEqual(['p1']);
    const p1 = await producto(T, 'p1');
    expect(p1).not.toHaveProperty('precio');
    expect(p1).not.toHaveProperty('moneda');
    expect(p1).toMatchObject({ nombre: 'P1', activo: true, actualizadoPor: 'u-admin-lim-activo' });
  });

  it('una edición no toca el stock de un ítem que lo lleva', async () => {
    await sembrar(T, { productos: 1 });
    await db.doc(`tenants/${T}/catalogo/p1`).update({ stock: 7 });
    await llamar({ tenantId: T, items: [{ id: 'p1', nombre: 'P1', precio: 5 }] }, comoAdmin(T));
    expect(await producto(T, 'p1')).toMatchObject({ stock: 7, precio: 5 });
  });

  it('el contador siempre queda igual a lo que hay', async () => {
    await sembrar(T, { productos: 10 });
    await llamar({ tenantId: T, items: [
      item('P2', { precio: 3 }), item('Nuevo 1'), item('X', { precio: -5 }), item('Nuevo 2'),
    ] }, comoAdmin(T));
    expect((await contadorDe(T))?.['items']).toBe(await cuantos(T));
    expect(await cuantos(T)).toBe(12);
  });
});

describe('importarCatalogo: el permiso es el de crear productos en las reglas', () => {
  const S = 'lim-suspendido';
  const BAJA = 'lim-baja';
  const OTRO = 'lim-otro';

  const nadaCambio = async (t: string, antes: number) => {
    expect(await cuantos(t)).toBe(antes);
    expect(await producto(t, 'intruso')).toBeUndefined();
  };

  it.each([
    ['sin sesión', undefined, 'unauthenticated'],
    ['el operador', { uid: 'u-oper', token: tokenPersona({ [T]: 'oper' }) }, 'permission-denied'],
    ['el admin de OTRO comercio', { uid: 'u-admin-otro', token: tokenPersona({ [OTRO]: 'admin' }) }, 'permission-denied'],
    ['el admin que entró con Google', { uid: 'u-admin', token: tokenPersona({ [T]: 'admin' }, 'google.com') }, 'permission-denied'],
    ['el admin con el correo sin verificar', { uid: 'u-admin', token: tokenPersona({ [T]: 'admin' }, 'password', false) }, 'permission-denied'],
    ['la ingesta de n8n', { uid: 'svc', token: tokenPersona({ [T]: 'ingesta' }, 'custom') }, 'permission-denied'],
    ['NovuChat (propietario)', { uid: 'u-novuchat', token: { nc: { p: true, t: {} }, firebase: { sign_in_provider: 'google.com' }, email_verified: true } }, 'permission-denied'],
  ] as const)('%s NO importa', async (_q, auth, codigo) => {
    await sembrar(T, { productos: 2 });
    await expect(llamar({ tenantId: T, items: [item('Intruso')] }, auth as Auth))
      .rejects.toMatchObject({ code: codigo });
    await nadaCambio(T, 2);
  });

  it('un comercio SUSPENDIDO o DADO DE BAJA no importa, ni su propio admin', async () => {
    for (const [t, estado] of [[S, 'suspendido'], [BAJA, 'dado_de_baja']] as const) {
      await sembrar(t, { estado, productos: 2 });
      await expect(llamar({ tenantId: t, items: [item('Intruso')] }, comoAdmin(t)))
        .rejects.toMatchObject({ code: 'failed-precondition' });
      await nadaCambio(t, 2);
    }
  });

  it('entradas malformadas se rechazan enteras', async () => {
    await sembrar(T, { productos: 2 });
    // Un id con barras no llega nunca a armar una ruta: se corta antes del permiso.
    await expect(llamar({ tenantId: 'A/../b', items: [] }, comoAdmin(T))).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(llamar({ tenantId: '../x', items: [] }, comoAdmin('../x'))).rejects.toMatchObject({ code: 'invalid-argument' });
    // Id válido pero de otro comercio: el admin de T no importa en él.
    await expect(llamar({ tenantId: 'lim-otro', items: [] }, comoAdmin(T))).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(llamar({ tenantId: T }, comoAdmin(T))).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(llamar({ tenantId: T, items: Array.from({ length: L.MAX_ITEMS_POR_LLAMADA + 1 }, (_, i) => item(`N${i}`)) }, comoAdmin(T)))
      .rejects.toMatchObject({ code: 'invalid-argument' });
    await nadaCambio(T, 2);
  });
});

// ===========================================================================
// 4) scripts/contar-catalogo.mjs
// ===========================================================================
describe('contar-catalogo.mjs', () => {
  const SCRIPT = join(aqui, '..', 'scripts', 'contar-catalogo.mjs');
  const U = 'lim-script';
  const V = 'lim-script-otro';
  const correr = (...args: string[]) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], {
      env: { ...process.env, FIRESTORE_EMULATOR_HOST: HOST }, encoding: 'utf8',
    });
    return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
  };

  it('sin --proyecto no hace nada', () => {
    const r = correr('--tenant', U);
    expect(r.codigo).toBe(2);
    expect(r.salida).toMatch(/falta --proyecto/);
  });

  it('en seco no escribe', async () => {
    await sembrar(U, { productos: 5, contador: false });
    const r = correr('--proyecto', PROYECTO, '--tenant', U);
    expect(r.codigo).toBe(0);
    expect(r.salida).toMatch(/productos\s+5 · contador FALTA/);
    expect(r.salida).toMatch(/Seco: no se escribió nada/);
    expect(await contadorDe(U)).toBeUndefined();
  });

  it('con --aplicar crea el contador, y SOLO el del comercio pedido', async () => {
    await sembrar(U, { productos: 5, contador: false });
    await sembrar(V, { productos: 3, contador: false });
    const r = correr('--proyecto', PROYECTO, '--tenant', U, '--aplicar');
    expect(r.codigo).toBe(0);
    expect(r.salida).toMatch(/Verificación: 1 de 1/);
    const c = await contadorDe(U);
    expect(c).toMatchObject({ items: 5, ultimoItem: '' });
    expect(Object.keys(c!).sort()).toEqual(['actualizadoEn', 'items', 'ultimoItem']);
    expect(await contadorDe(V)).toBeUndefined();
  });

  it('corrige un contador desajustado y uno con campos de más', async () => {
    await sembrar(U, { productos: 5 });
    await db.doc(`tenants/${U}/contadores/catalogo`).set({ items: 9, ultimoItem: 'p5', trampa: 1, actualizadoEn: new Date() });
    correr('--proyecto', PROYECTO, '--tenant', U, '--aplicar');
    const c = await contadorDe(U);
    expect(c).toMatchObject({ items: 5, ultimoItem: 'p5' });
    expect(c).not.toHaveProperty('trampa');
  });

  it('avisa del comercio que está por encima de su límite y NO borra nada', async () => {
    await sembrar(U, { productos: 25, contador: false });
    const r = correr('--proyecto', PROYECTO, '--tenant', U, '--aplicar');
    expect(r.salida).toMatch(/por encima del límite/);
    expect(await cuantos(U)).toBe(25);
    expect(await contadorDe(U)).toMatchObject({ items: 25 });
  });

  it('un comercio que no existe corta con error', () => {
    const r = correr('--proyecto', PROYECTO, '--tenant', 'lim-no-existe');
    expect(r.codigo).toBe(1);
  });
});
