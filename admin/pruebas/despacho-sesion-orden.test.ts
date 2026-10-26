/**
 * F3b PR-2b: EL ORDEN DE `leer` FRENTE AL ENLACE DEL CATÁLOGO.
 *
 * `leer` de la sesión corre ANTES del enlace de la carta (`enlaceParaElFlujo`), que escribe
 * una ficha en `fichasCatalogo`. Si la sesión falla (503 o 500), `configuracionFlujo`
 * devuelve ese status tal cual y NO debe quedar ninguna ficha hecha. La misma petición sin
 * falla de sesión sí la crea: así la negación no es vacía.
 *
 * El fallo se fuerza con `vi.mock` de `atenderSesion` solo en este archivo (cero cambio de
 * producción); sin fallo delega en la función real.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const modo = vi.hoisted(() => ({ falla: null as null | 500 | 503 }));
vi.mock('../functions/src/core/turno/sesionFirestore.ts', async (original) => {
  const real = await original<typeof import('../functions/src/core/turno/sesionFirestore.ts')>();
  return {
    ...real,
    atenderSesion: (...a: Parameters<typeof real.atenderSesion>) => modo.falla === null
      ? real.atenderSesion(...a)
      : Promise.resolve({ status: modo.falla, json: { error: modo.falla === 503 ? 'sesion: ocupada, reintente' : 'sesion: error interno' } }),
  };
});

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
process.env['SITIO_PUBLICO'] = 'https://catalogo.ejemplo.test';
const TOKEN = 'valor-de-prueba-despacho-orden';
process.env['INGESTA_CLIENTE19'] = TOKEN;

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore } = await import('firebase-admin/firestore');
const db = getFirestore();
const { configuracionFlujo } = await import('../functions/src/ingesta.ts');

const T = 'despacho-orden';
const NUMERO = '1000000713';
const TEL = '59100000013';

async function pedir(cuerpo: Record<string, unknown>): Promise<{ codigo: number; cuerpo: Record<string, unknown> }> {
  const cabeceras: Record<string, string> = {
    'x-novuchat-numero': NUMERO, authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json',
  };
  const leer = (n: string) => cabeceras[n.toLowerCase()];
  const peticion = { method: 'POST', body: cuerpo, rawBody: Buffer.from(JSON.stringify(cuerpo)), headers: cabeceras, get: leer, header: leer };
  const r = { codigo: 0, cuerpo: {} as Record<string, unknown> };
  const respuesta = {
    status(c: number) { r.codigo = c; return respuesta; },
    send(b: unknown) { r.cuerpo = { texto: b }; return respuesta; },
    json(b: unknown) { r.cuerpo = b as Record<string, unknown>; return respuesta; },
    setHeader() { return respuesta; }, getHeader() { return undefined; }, set() { return respuesta; },
    on() { return respuesta; }, end() { return respuesta; },
  };
  await (configuracionFlujo as unknown as (q: unknown, s: unknown) => Promise<void>)(peticion, respuesta);
  return r;
}

const fichas = async () =>
  (await db.collection('fichasCatalogo').where('tenantId', '==', T).get()).docs;
const borrarFichas = async () => { for (const f of await fichas()) await f.ref.delete(); };
const cuerpoDeVenta = (extra: Record<string, unknown> = {}) =>
  ({ telefono: TEL, catalogoCompleto: true, ...extra });
const sesionLeer = () => ({ v: 1, accion: 'leer', espacio: 'venta', ejecucion: 'ej-orden-1' });

beforeAll(async () => {
  await db.doc(`rutasWhatsApp/${NUMERO}`).set({ tenantId: T, flujo: 'venta', aliasSecreto: 'cliente19', estado: 'activo' });
  await db.doc(`tenants/${T}`).set({ nombre: T, estado: 'activo', plan: 'crecimiento', flujos: ['venta'] });
  await db.doc(`tenants/${T}/config/negocio`).set({ nombreNegocio: T, numeroRecepcion: '70000001', catalogoWebActivo: true });
  for (let i = 0; i < 3; i++) {
    await db.doc(`tenants/${T}/catalogo/i${i}`).set({ nombre: `Taco ${i}`, area: 'tacos', precio: 10 + i, moneda: 'BOB', activo: true });
  }
}, 120_000);

afterAll(async () => {
  await borrarFichas();
  await db.recursiveDelete(db.doc(`tenants/${T}`));
  await db.doc(`rutasWhatsApp/${NUMERO}`).delete();
});

beforeEach(async () => { modo.falla = null; await borrarFichas(); });

describe('`leer` que falla no deja la ficha del catálogo', () => {
  it('control: sin falla de sesión, la misma petición SÍ crea la ficha y trae el enlace', async () => {
    const r = await pedir(cuerpoDeVenta({ sesion: sesionLeer() }));
    expect(r.codigo).toBe(200);
    expect((r.cuerpo['catalogoWeb'] as Record<string, unknown>)['enlace']).toMatch(/^https:\/\/catalogo\.ejemplo\.test\/c\/[0-9a-f]{32}$/);
    expect((await fichas()).length).toBeGreaterThan(0);
  });

  it.each([503, 500] as const)('con la sesión en %s: se devuelve ese status tal cual y NO queda ficha', async (status) => {
    modo.falla = status;
    const r = await pedir(cuerpoDeVenta({ sesion: sesionLeer() }));
    expect(r.codigo).toBe(status);
    expect(r.cuerpo['catalogoWeb']).toBeUndefined();
    expect(r.cuerpo['conversacion']).toBeUndefined();
    expect(await fichas()).toHaveLength(0);
  });
});
