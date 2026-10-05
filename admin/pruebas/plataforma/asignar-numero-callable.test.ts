/**
 * `asignarNumero` y `liberarNumero` (functions/src/plataforma/tenants.ts) —
 * LAS CALLABLES REALES CONTRA EL EMULADOR.
 *
 * Lo que se cuida: `rutasWhatsApp/{n}` mezcla datos del COMERCIO (tenantId,
 * flujo, titularidad, estado) con propiedades de la LÍNEA que escriben otras
 * piezas: `numeroPublico` (el botón «Volver al chat» del catálogo web),
 * `webhookCarrito` (a dónde notifica el carrito) y `aliasSecreto` (qué secreto
 * HMAC valida el número). `asignarNumero` escribía el documento ENTERO, sin
 * `merge`: reasignar la misma línea al mismo comercio las borraba en silencio.
 *
 * Se escribe negando (la prueba falla con el `tx.set` sin merge):
 *   1. reasignar la misma línea al mismo comercio CONSERVA las tres;
 *   2. un número de OTRO comercio no se pisa (ni se hereda nada);
 *   3. liberar borra el documento entero, y reasignar a OTRO comercio después
 *      NO arrastra nada del dueño anterior: el merge no hereda datos ajenos.
 */
import { beforeEach, describe, expect, it } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;

const { asignarNumero, liberarNumero } = await import('../../functions/src/index.ts');
const { getFirestore } = await import('firebase-admin/firestore');
const db = getFirestore();

const A = 'asigc-a';
const B = 'asigc-b';
const NUM = '1000000121';
const WABA = '2000000121';
const PUBLICO = '59170000000';
const WEBHOOK = 'https://ejemplo.invalid/carrito';

const AUTH_TIME = Math.floor(Date.now() / 1000);
const PROPIETARIO = { uid: 'prop-c', token: { nc: { p: true }, firebase: { sign_in_provider: 'google.com' }, auth_time: AUTH_TIME } };
const admin = (t: string) => ({
  uid: `adm-${t}`, token: { nc: { t: { [t]: 'admin' } }, firebase: { sign_in_provider: 'password' }, email_verified: true },
});

type Peticion = Parameters<typeof asignarNumero.run>[0];
const correr = (f: { run: (p: Peticion) => Promise<unknown> }, data: Record<string, unknown>, auth: object | null = PROPIETARIO) =>
  f.run({ data, auth, rawRequest: {} } as unknown as Peticion);
const asignar = (tenantId: string, extra: Record<string, unknown> = {}, auth: object | null = PROPIETARIO) =>
  correr(asignarNumero, { tenantId, phoneNumberId: NUM, wabaId: WABA, flujo: 'venta', ...extra }, auth);
const liberar = (auth: object | null = PROPIETARIO) => correr(liberarNumero, { phoneNumberId: NUM }, auth);
const ruta = async () => (await db.doc(`rutasWhatsApp/${NUM}`).get()).data() ?? {};

beforeEach(async () => {
  await db.doc(`tenants/${A}`).set({ nombre: 'A', estado: 'activo', flujos: ['venta'] });
  await db.doc(`tenants/${B}`).set({ nombre: 'B', estado: 'activo', flujos: ['venta'] });
  await db.doc(`rutasWhatsApp/${NUM}`).set({
    tenantId: A, flujo: 'venta', wabaId: WABA, estado: 'activo', titularidad: 'novuchat',
    aliasSecreto: 'cliente40', numeroPublico: PUBLICO, webhookCarrito: WEBHOOK,
  });
});

describe('asignarNumero sobre una línea que ya existe', () => {
  it('reasignar la misma línea al mismo comercio CONSERVA numeroPublico, webhookCarrito y aliasSecreto', async () => {
    await asignar(A, { titularidad: 'novuchat' });
    const r = await ruta();
    expect(r['numeroPublico']).toBe(PUBLICO);
    expect(r['webhookCarrito']).toBe(WEBHOOK);
    expect(r['aliasSecreto']).toBe('cliente40');
    // Y lo que sí es del comercio se refresca.
    expect(r).toMatchObject({ tenantId: A, flujo: 'venta', wabaId: WABA, estado: 'activo', asignadoPor: 'prop-c' });
    expect(r['asignadoEn']).toBeDefined();
  });

  it('reasignar con otro flujo o con la WABA corregida cambia eso y nada más', async () => {
    await asignar(A, { flujo: 'agendamiento', wabaId: '2000000199', titularidad: 'novuchat' });
    expect(await ruta()).toMatchObject({
      flujo: 'agendamiento', wabaId: '2000000199',
      numeroPublico: PUBLICO, webhookCarrito: WEBHOOK, aliasSecreto: 'cliente40',
    });
  });

  it('un número de OTRO comercio no se pisa: ni la ruta ni sus datos cambian', async () => {
    await expect(asignar(B)).rejects.toMatchObject({ code: 'already-exists' });
    expect(await ruta()).toMatchObject({ tenantId: A, numeroPublico: PUBLICO, webhookCarrito: WEBHOOK });
  });

  it('el administrador del comercio no reasigna', async () => {
    await expect(asignar(A, {}, admin(A))).rejects.toMatchObject({ code: 'permission-denied' });
    expect(await ruta()).toMatchObject({ tenantId: A, numeroPublico: PUBLICO });
  });
});

describe('liberar y reasignar a OTRO comercio no hereda nada del dueño anterior', () => {
  it('liberar borra el documento entero', async () => {
    await liberar();
    expect((await db.doc(`rutasWhatsApp/${NUM}`).get()).exists).toBe(false);
    expect((await db.doc(`tenants/${A}`).get()).get('waPhoneNumberId')).toBeNull();
  });

  it('tras liberar, asignarlo a B deja la ruta SIN numeroPublico, webhookCarrito ni aliasSecreto de A', async () => {
    await liberar();
    await asignar(B);
    const r = await ruta();
    expect(r['tenantId']).toBe(B);
    expect(r).not.toHaveProperty('numeroPublico');
    expect(r).not.toHaveProperty('webhookCarrito');
    expect(r).not.toHaveProperty('aliasSecreto');
  });

  it('el administrador del comercio no libera', async () => {
    await expect(liberar(admin(A))).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await db.doc(`rutasWhatsApp/${NUM}`).get()).exists).toBe(true);
  });
});
