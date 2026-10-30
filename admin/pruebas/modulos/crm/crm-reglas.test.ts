/**
 * LAS REGLAS DE `config/crm` (miniCRM, PR-A). Se escriben NEGANDO: otro
 * comercio, el operador, los campos del servidor, los tipos y topes, el
 * módulo apagado y el comercio no operativo.
 */
import {
  assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const aqui = dirname(fileURLToPath(import.meta.url));
const A = 'crm-a';
const B = 'crm-b';
const S = 'crm-suspendido';
const SIN = 'crm-sin-modulo';
let entorno: RulesTestEnvironment;

const claims = (tenants: Record<string, string>) => ({
  nc: { t: tenants, v: 1 }, firebase: { sign_in_provider: 'password', identities: {} }, email_verified: true,
});
const adminA = () => entorno.authenticatedContext('u-admin-a', claims({ [A]: 'admin' })).firestore();
const operA = () => entorno.authenticatedContext('u-oper-a', claims({ [A]: 'oper' })).firestore();
const adminB = () => entorno.authenticatedContext('u-admin-b', claims({ [B]: 'admin' })).firestore();
const adminS = () => entorno.authenticatedContext('u-admin-s', claims({ [S]: 'admin' })).firestore();
const adminSin = () => entorno.authenticatedContext('u-admin-sin', claims({ [SIN]: 'admin' })).firestore();
const sello = (uid = 'u-admin-a') => ({ actualizadoPor: uid, actualizadoEn: serverTimestamp() });
const ruta = (t: string) => `tenants/${t}/config/crm`;
const valido = () => ({ activo: true, moneda: 'Bs', listas: { etapas: ['Nuevo', 'Contactado'], origenes: ['Anuncio'] }, ...sello() });

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
    for (const [t, estado] of [[A, 'activo'], [B, 'activo'], [S, 'suspendido']] as const) {
      await setDoc(doc(fs, 'tenants', t), { nombre: t, estado, plan: 'crecimiento', flujos: ['agendamiento'] });
    }
    // Con lista `modulos` que no incluye crm: el módulo está apagado para este comercio.
    await setDoc(doc(fs, 'tenants', SIN), { nombre: SIN, estado: 'activo', plan: 'crecimiento', flujos: ['agendamiento'], modulos: ['agenda'] });
    await setDoc(doc(fs, ruta(A)), {
      activo: true, hoja: 'hoja-1', filaEncabezados: 1, mapaColumnas: { nombre: 'C' },
      cuentaServicio: 'crm-crm-a', recordatorios: { activo: false },
      actualizadoPor: 'seed', actualizadoEn: Timestamp.now(),
    });
  });
});

describe('config/crm: quién escribe', () => {
  it('el admin del comercio edita lo suyo, aunque el documento traiga campos del servidor', async () => {
    await assertSucceeds(updateDoc(doc(adminA(), ruta(A)), { moneda: 'USD', activo: false, ...sello() }));
  });
  it('el admin crea el documento si falta', async () => {
    await assertSucceeds(setDoc(doc(adminB(), ruta(B)), valido2('u-admin-b')));
  });
  it('NIEGA: otro comercio ni lee ni escribe', async () => {
    await assertFails(getDoc(doc(adminB(), ruta(A))));
    await assertFails(updateDoc(doc(adminB(), ruta(A)), { moneda: 'USD', ...sello('u-admin-b') }));
    await assertFails(setDoc(doc(adminB(), ruta(A)), valido2('u-admin-b')));
  });
  it('NIEGA: el operador lee pero no escribe', async () => {
    await assertSucceeds(getDoc(doc(operA(), ruta(A))));
    await assertFails(updateDoc(doc(operA(), ruta(A)), { moneda: 'USD', ...sello('u-oper-a') }));
  });
  it('NIEGA: sin sesión', async () => {
    const anon = entorno.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, ruta(A))));
    await assertFails(updateDoc(doc(anon, ruta(A)), { moneda: 'USD' }));
  });
  it('NIEGA: comercio suspendido y comercio sin el módulo no escriben', async () => {
    await assertFails(setDoc(doc(adminS(), ruta(S)), valido2('u-admin-s')));
    await assertFails(setDoc(doc(adminSin(), ruta(SIN)), valido2('u-admin-sin')));
  });
});

const valido2 = (uid: string) => ({ ...valido(), ...sello(uid) });

describe('config/crm: el comercio NO escribe los campos del servidor', () => {
  const casos: Record<string, unknown> = {
    hoja: 'otra-hoja', filaEncabezados: 2, mapaColumnas: { nombre: 'A' },
    cuentaServicio: 'crm-b', recordatorios: { activo: true },
  };
  for (const [campo, valor] of Object.entries(casos)) {
    it(`NIEGA editar ${campo}`, async () => {
      await assertFails(updateDoc(doc(adminA(), ruta(A)), { [campo]: valor, ...sello() }));
    });
    it(`NIEGA crear con ${campo}`, async () => {
      await assertFails(setDoc(doc(adminB(), ruta(B)), { ...valido2('u-admin-b'), [campo]: valor }));
    });
  }
  it('NIEGA una clave desconocida', async () => {
    await assertFails(updateDoc(doc(adminA(), ruta(A)), { token: 'x', ...sello() }));
  });
});

describe('config/crm: tipos y topes', () => {
  const malos: Array<[string, Record<string, unknown>]> = [
    ['activo no booleano', { activo: 'si' }],
    ['moneda no cadena', { moneda: 5 }],
    ['moneda vacía', { moneda: '' }],
    ['moneda de más de 5', { moneda: 'ABCDEF' }],
    ['listas no mapa', { listas: ['a'] }],
    ['listas con clave extra', { listas: { etapas: [], otra: [] } }],
    ['etapas no lista', { listas: { etapas: 'Nuevo' } }],
    ['etapas con 21', { listas: { etapas: Array.from({ length: 21 }, (_, i) => `e${i}`) } }],
    ['origenes con 21', { listas: { origenes: Array.from({ length: 21 }, (_, i) => `o${i}`) } }],
  ];
  for (const [nombre, parche] of malos) {
    it(`NIEGA ${nombre}`, async () => {
      await assertFails(updateDoc(doc(adminA(), ruta(A)), { ...parche, ...sello() }));
    });
  }
  it('NIEGA un sello que no es del que escribe', async () => {
    await assertFails(updateDoc(doc(adminA(), ruta(A)), { moneda: 'USD', actualizadoPor: 'otro', actualizadoEn: serverTimestamp() }));
  });
  it('el tope exacto (20) sí entra', async () => {
    await assertSucceeds(updateDoc(doc(adminA(), ruta(A)),
      { listas: { etapas: Array.from({ length: 20 }, (_, i) => `e${i}`) }, ...sello() }));
  });
});
