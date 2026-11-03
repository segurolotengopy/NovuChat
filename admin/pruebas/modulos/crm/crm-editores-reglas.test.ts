/**
 * LAS REGLAS DE `tenants/{t}/editoresCrm/{uid}` (edición del miniCRM por Gmail, 03/11/2026). Se escriben NEGANDO:
 * ningún cliente escribe (ni el admin, ni el propio uid, ni el propietario), el operador solo lee su documento y
 * no hace `list`, y otro comercio no lee nada.
 */
import {
  assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const aqui = dirname(fileURLToPath(import.meta.url));
const A = 'edi-a';
const B = 'edi-b';
let entorno: RulesTestEnvironment;

const claims = (tenants: Record<string, string>, proveedor = 'password') => ({
  nc: { t: tenants, v: 1 }, firebase: { sign_in_provider: proveedor, identities: {} }, email_verified: true,
});
const adminA = () => entorno.authenticatedContext('u-admin-a', claims({ [A]: 'admin' })).firestore();
const operA = () => entorno.authenticatedContext('u-oper-a', claims({ [A]: 'oper' })).firestore();
const otroOperA = () => entorno.authenticatedContext('u-oper-x', claims({ [A]: 'oper' })).firestore();
const adminB = () => entorno.authenticatedContext('u-admin-b', claims({ [B]: 'admin' })).firestore();
const ingestaA = () => entorno.authenticatedContext('u-ingesta-a', claims({ [A]: 'ingesta' }, 'custom')).firestore();
const propietario = () => entorno.authenticatedContext('u-prop', { ...claims({}, 'google.com'), nc: { p: true, t: {}, v: 1 } }).firestore();
const ruta = (t: string, uid: string) => `tenants/${t}/editoresCrm/${uid}`;
const ficha = () => ({
  correoGoogle: ['x', 'example.invalid'].join('@'), estado: 'activo', permisoId: 'p1', registradoPor: 'u-admin-a',
  desde: Timestamp.now(), verificadoPor: 'admin',
});

beforeAll(async () => {
  entorno = await initializeTestEnvironment({
    projectId: 'demo-novuchat-pruebas',
    firestore: {
      rules: readFileSync(join(aqui, '..', '..', '..', 'firestore.rules'), 'utf8'),
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
    for (const t of [A, B]) await setDoc(doc(fs, 'tenants', t), { nombre: t, estado: 'activo', plan: 'crecimiento', flujos: ['agendamiento'] });
    await setDoc(doc(fs, ruta(A, 'u-oper-a')), ficha());
    await setDoc(doc(fs, ruta(A, 'u-admin-a')), ficha());
  });
});

describe('editoresCrm: quién lee', () => {
  it('el admin del comercio lee cualquiera y lista', async () => {
    await assertSucceeds(getDoc(doc(adminA(), ruta(A, 'u-oper-a'))));
    await assertSucceeds(getDocs(collection(adminA(), `tenants/${A}/editoresCrm`)));
  });
  it('la persona lee su propio documento', async () => {
    await assertSucceeds(getDoc(doc(operA(), ruta(A, 'u-oper-a'))));
  });
  it('NIEGA: el operador no lee el de otro ni lista', async () => {
    await assertFails(getDoc(doc(otroOperA(), ruta(A, 'u-oper-a'))));
    await assertFails(getDoc(doc(operA(), ruta(A, 'u-admin-a'))));
    await assertFails(getDocs(collection(operA(), `tenants/${A}/editoresCrm`)));
  });
  it('NIEGA: otro comercio ni lee ni lista', async () => {
    await assertFails(getDoc(doc(adminB(), ruta(A, 'u-oper-a'))));
    await assertFails(getDocs(collection(adminB(), `tenants/${A}/editoresCrm`)));
  });
  it('NIEGA: la ingesta, el propietario sin rol en el comercio y quien no inició sesión', async () => {
    await assertFails(getDoc(doc(ingestaA(), ruta(A, 'u-ingesta-a'))));
    await assertFails(getDoc(doc(propietario(), ruta(A, 'u-oper-a'))));
    await assertFails(getDoc(doc(entorno.unauthenticatedContext().firestore(), ruta(A, 'u-oper-a'))));
  });
});

describe('editoresCrm: nadie escribe desde un cliente', () => {
  it('NIEGA: ni el admin, ni el propio uid, ni otro comercio crean, cambian o borran', async () => {
    for (const [bd, uid] of [[adminA(), 'u-oper-nuevo'], [operA(), 'u-oper-a'], [adminB(), 'u-oper-a'], [propietario(), 'u-oper-a']] as const) {
      await assertFails(setDoc(doc(bd, ruta(A, uid)), ficha()));
      await assertFails(updateDoc(doc(bd, ruta(A, 'u-oper-a')), { estado: 'activo', permisoId: 'otro' }));
      await assertFails(deleteDoc(doc(bd, ruta(A, 'u-oper-a'))));
    }
  });
  it('NIEGA: la persona no se da a sí misma el permiso', async () => {
    await assertFails(setDoc(doc(operA(), ruta(A, 'u-oper-a')), { ...ficha(), estado: 'activo' }));
    await assertFails(updateDoc(doc(operA(), ruta(A, 'u-oper-a')), { estado: 'activo' }));
  });
});
