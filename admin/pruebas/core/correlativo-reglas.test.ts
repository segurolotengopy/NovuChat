/**
 * REGLAS DE `contadores/pedidos-AAMMDD`: el correlativo del pedido solo lo mueve el servidor.
 *
 * Se escribe NEGANDO: ni el administrador del comercio, ni un operador, ni otro comercio, ni un anónimo pueden crear,
 * editar o borrar el contador (inflarlo o reiniciarlo repetiría o saltaría códigos de pedido). Leerlo, solo el propio comercio.
 */
import {
  assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';

const aqui = dirname(fileURLToPath(import.meta.url));
const A = 'contador-reglas-a';
const B = 'contador-reglas-b';
const RUTA = `tenants/${A}/contadores/pedidos-261118`;
let entorno: RulesTestEnvironment;

const claims = (tenants: Record<string, string>) => ({
  nc: { t: tenants, v: 1 }, firebase: { sign_in_provider: 'password', identities: {} }, email_verified: true,
});
const adminA = () => entorno.authenticatedContext('u-admin-a', claims({ [A]: 'admin' })).firestore();
const operA = () => entorno.authenticatedContext('u-oper-a', claims({ [A]: 'oper' })).firestore();
const adminB = () => entorno.authenticatedContext('u-admin-b', claims({ [B]: 'admin' })).firestore();
const anonimo = () => entorno.unauthenticatedContext().firestore();

beforeAll(async () => {
  entorno = await initializeTestEnvironment({
    projectId: 'demo-novuchat-pruebas',
    firestore: {
      rules: readFileSync(join(aqui, '..', '..', 'firestore.rules'), 'utf8'),
      host: '127.0.0.1', port: Number(process.env['FIRESTORE_EMULATOR_PORT'] ?? 8231),
    },
  });
  await entorno.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    for (const t of [A, B]) {
      await setDoc(doc(fs, 'tenants', t), { nombre: t, estado: 'activo', plan: 'crecimiento', flujos: ['venta'] });
      await setDoc(doc(fs, `tenants/${t}/cuenta/estado`), { plan: 'crecimiento' });
    }
    await setDoc(doc(fs, RUTA), { dia: '261118', ultimo: 3 });
  });
});
afterAll(async () => { await entorno.cleanup(); });

describe('contadores/pedidos-*: nadie lo escribe desde el navegador', () => {
  const nuevo = `tenants/${A}/contadores/pedidos-261119`;
  it('el administrador del comercio NO lo crea, ni lo edita, ni lo borra', async () => {
    await assertFails(setDoc(doc(adminA(), nuevo), { dia: '261119', ultimo: 1 }));
    await assertFails(updateDoc(doc(adminA(), RUTA), { ultimo: 999 }));
    await assertFails(updateDoc(doc(adminA(), RUTA), { ultimo: 0 }));
    await assertFails(deleteDoc(doc(adminA(), RUTA)));
  });
  it('un operador, otro comercio y un anónimo tampoco', async () => {
    await assertFails(updateDoc(doc(operA(), RUTA), { ultimo: 999 }));
    await assertFails(setDoc(doc(adminB(), nuevo), { dia: '261119', ultimo: 1 }));
    await assertFails(updateDoc(doc(adminB(), RUTA), { ultimo: 999 }));
    await assertFails(setDoc(doc(anonimo(), nuevo), { dia: '261119', ultimo: 1 }));
    await assertFails(deleteDoc(doc(anonimo(), RUTA)));
  });
  it('lo lee el propio comercio; otro comercio y un anónimo no', async () => {
    await assertSucceeds(getDoc(doc(adminA(), RUTA)));
    await assertFails(getDoc(doc(adminB(), RUTA)));
    await assertFails(getDoc(doc(anonimo(), RUTA)));
  });
});
