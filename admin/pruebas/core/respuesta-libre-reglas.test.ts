/**
 * LAS REGLAS DE `config/respuestaLibre` (12/11/2026, «respuesta coherente», PR B / P2), contra el emulador.
 *
 * El documento lo escribe SOLO el servidor (Admin SDK, que no pasa por las reglas). Ninguna rama de `firestore.rules` lo
 * nombra: queda cerrado por omisión. Se prueba NEGANDO: el admin, el operador, el propietario de NovuChat y el servicio
 * de ingesta no pueden crear, actualizar ni borrar; un miembro lee (regla general de `config/`); otro comercio no lee.
 */
import {
  assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const aqui = dirname(fileURLToPath(import.meta.url));
const A = 'rl-a';
const B = 'rl-b';
let entorno: RulesTestEnvironment;

const claims = (tenants: Record<string, string>, proveedor = 'password') => ({
  nc: { t: tenants, v: 1 }, firebase: { sign_in_provider: proveedor, identities: {} }, email_verified: true,
});
const adminA = () => entorno.authenticatedContext('u-admin-a', claims({ [A]: 'admin' })).firestore();
const operA = () => entorno.authenticatedContext('u-oper-a', claims({ [A]: 'oper' })).firestore();
const ingestaA = () => entorno.authenticatedContext('svc-a', claims({ [A]: 'ingesta' }, 'custom')).firestore();
const adminB = () => entorno.authenticatedContext('u-admin-b', claims({ [B]: 'admin' })).firestore();
const propietario = () => entorno.authenticatedContext('u-novuchat', {
  nc: { t: {}, p: true, v: 1 }, firebase: { sign_in_provider: 'google.com', identities: {} }, email_verified: true,
}).firestore();
const sinSesion = () => entorno.unauthenticatedContext().firestore();
const ruta = (t: string) => `tenants/${t}/config/respuestaLibre`;
const valido = () => ({
  activo: true, acuse: 'Gracias', textoSeguimiento: 'Escribe al local', textoRechazo: 'No puedo', textoHumor: 'Mejor te cuento', textoQueja: 'Lamento eso',
});

beforeAll(async () => {
  entorno = await initializeTestEnvironment({
    projectId: 'demo-novuchat-pruebas',
    firestore: {
      rules: readFileSync(join(aqui, '..', '..', 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: Number(process.env['FIRESTORE_EMULATOR_PORT'] ?? 8231),
    },
  });
});
afterAll(async () => { await entorno.cleanup(); });

beforeEach(async () => {
  await entorno.clearFirestore();
  await entorno.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    for (const t of [A, B]) await setDoc(doc(fs, 'tenants', t), { nombre: t, estado: 'activo', plan: 'crecimiento', flujos: ['venta'] });
    await setDoc(doc(fs, ruta(A)), valido());
  });
});

describe('config/respuestaLibre: nadie la escribe desde un cliente', () => {
  const quienes: [string, () => ReturnType<typeof adminA>][] = [
    ['el admin del comercio', adminA], ['el operador', operA], ['el propietario de NovuChat', propietario], ['el servicio de ingesta', ingestaA], ['sin sesión', sinSesion],
  ];
  for (const [nombre, ctx] of quienes) {
    it(`NIEGA: ${nombre} no actualiza ni borra el documento existente`, async () => {
      await assertFails(updateDoc(doc(ctx(), ruta(A)), { activo: false }));
      await assertFails(updateDoc(doc(ctx(), ruta(A)), { acuse: 'otro texto' }));
      await assertFails(setDoc(doc(ctx(), ruta(A)), valido()));
      await assertFails(deleteDoc(doc(ctx(), ruta(A))));
    });
    it(`NIEGA: ${nombre} no crea el documento donde no existe`, async () => {
      await assertFails(setDoc(doc(ctx(), ruta(B)), valido()));
      await assertFails(setDoc(doc(ctx(), ruta(B)), { activo: false }));
    });
  }
  it('NIEGA: el admin tampoco lo crea con la forma de otro documento de config ni con campos extra', async () => {
    await assertFails(setDoc(doc(adminB(), ruta(B)), { ...valido(), actualizadoPor: 'u-admin-b' }));
    await assertFails(setDoc(doc(adminB(), ruta(B)), { activo: true }));
  });
  it('NIEGA: los campos del servidor no se escriben por el documento común (`config/negocio`)', async () => {
    await assertFails(setDoc(doc(adminB(), `tenants/${B}/config/negocio`), { respuestaLibre: valido() }));
  });
});

describe('config/respuestaLibre: quién lee', () => {
  it('el admin y el operador del comercio la leen (regla general de config)', async () => {
    await assertSucceeds(getDoc(doc(adminA(), ruta(A))));
    await assertSucceeds(getDoc(doc(operA(), ruta(A))));
  });
  it('NIEGA: otro comercio y sin sesión no la leen', async () => {
    await assertFails(getDoc(doc(adminB(), ruta(A))));
    await assertFails(getDoc(doc(sinSesion(), ruta(A))));
  });
});
