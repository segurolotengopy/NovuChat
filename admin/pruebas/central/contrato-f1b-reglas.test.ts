/**
 * F1b — LO QUE VA POR CONTRATO NO SE ESCRIBE DESDE EL NAVEGADOR: la prueba
 * negativa de reglas de las conversaciones, el precio y la prueba por
 * contrato (`contrato-f1b.test.ts` prueba la callable).
 *
 * `cuenta/estado` es de solo lectura para todos en `firestore.rules`
 * (`allow create, update, delete: if false`), y F1b NO agrega ninguna regla:
 * estas pruebas fijan que la que existe cubre también los campos nuevos
 * (`limites.conversaciones` con su marcador, `precioPorContrato`,
 * `periodoPrueba`, `pruebaDesde`, `bolsaPrueba`). Si un administrador del
 * comercio pudiera escribirlos, se bajaría la mensualidad, se daría
 * conversaciones que no contrató o se extendería la prueba gratis; si el
 * propietario los escribiera desde el navegador, quedarían sin auditoría.
 *
 * Tenants ficticios; `clearFirestore` limpia el emulador entero, como las
 * demás suites de reglas (no corren en paralelo: `fileParallelism: false`).
 */
import {
  assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteField, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const aqui = dirname(fileURLToPath(import.meta.url));
const A = 'f1b-reglas-a';
const B = 'f1b-reglas-b';
let entorno: RulesTestEnvironment;

const claims = (tenants: Record<string, string>, propietario = false, proveedor = 'password') => ({
  nc: { t: tenants, ...(propietario ? { p: true } : {}), v: 1 },
  firebase: { sign_in_provider: proveedor, identities: {} }, email_verified: true,
});
const adminA = () => entorno.authenticatedContext('u-admin-a', claims({ [A]: 'admin' })).firestore();
const operA = () => entorno.authenticatedContext('u-oper-a', claims({ [A]: 'oper' })).firestore();
const adminB = () => entorno.authenticatedContext('u-admin-b', claims({ [B]: 'admin' })).firestore();
const propietario = () => entorno.authenticatedContext('u-prop', claims({}, true, 'google.com')).firestore();
const anonimo = () => entorno.unauthenticatedContext().firestore();
const ruta = (t: string) => `tenants/${t}/cuenta/estado`;

/** Cada intento de escritura de un campo por contrato, como lo haría un navegador. */
const INTENTOS: Record<string, unknown>[] = [
  { 'limites.conversaciones': 5000 },
  { limitesPorContrato: ['conversaciones'] },
  { 'limites.conversaciones': 5000, limitesPorContrato: ['cambiosIncluidos', 'conversaciones'] },
  { precioPorContrato: 1 },
  { precioPorContrato: deleteField() },
  { montoMensual: 1 },
  { periodoPrueba: '2099-12' },
  { pruebaDesde: '2026-01' },
  { bolsaPrueba: 1000 },
  { modalidad: 'prueba', periodoPrueba: '2099-12', bolsaPrueba: 1000 },
];

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
    for (const t of [A, B]) {
      await setDoc(doc(fs, 'tenants', t), { nombre: t, estado: 'activo', plan: 'pro', flujos: ['agendamiento'] });
      await setDoc(doc(fs, ruta(t)), {
        plan: 'pro', modalidad: 'prueba', periodoPrueba: '2026-09', bolsaPrueba: 7, precioPorContrato: 120,
        limites: { conversaciones: 800, productos: 500, agendas: 10, cambiosIncluidos: 2 }, limitesPorContrato: ['conversaciones'],
      });
    }
  });
});

describe('cuenta/estado: conversaciones, precio y prueba por contrato, solo por el servidor', () => {
  it('el ADMINISTRADOR del comercio NO escribe ninguno en su cuenta: ni con update, ni con set y merge', async () => {
    const fs = adminA();
    for (const intento of INTENTOS) {
      await assertFails(updateDoc(doc(fs, ruta(A)), intento));
    }
    await assertFails(setDoc(doc(fs, ruta(A)), { precioPorContrato: 1, bolsaPrueba: 1000 }, { merge: true }));
  });

  it('tampoco en la de otro comercio, ni el operador, ni un anónimo', async () => {
    for (const intento of INTENTOS) {
      await assertFails(updateDoc(doc(adminB(), ruta(A)), intento));
      await assertFails(updateDoc(doc(operA(), ruta(A)), intento));
      await assertFails(updateDoc(doc(anonimo(), ruta(A)), intento));
    }
  });

  it('NI SIQUIERA el propietario desde el navegador: sin la callable no hay auditoría ni sesión reciente', async () => {
    for (const intento of INTENTOS) await assertFails(updateDoc(doc(propietario(), ruta(A)), intento));
  });

  it('LEERLO sí: el administrador ve su precio y su prueba; el de otro comercio, no', async () => {
    await assertSucceeds(getDoc(doc(adminA(), ruta(A))));
    await assertFails(getDoc(doc(adminB(), ruta(A))));
  });
});
