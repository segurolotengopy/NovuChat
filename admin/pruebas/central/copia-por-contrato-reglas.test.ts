/**
 * LA COPIA POR CONTRATO NO SE ESCRIBE DESDE EL NAVEGADOR — la prueba negativa
 * de reglas del bloque «copia por contrato» (`copia-por-contrato.test.ts`).
 *
 * `cuenta/estado` es de solo lectura para todos en `firestore.rules`
 * (`allow create, update, delete: if false`): el valor por contrato
 * (`limites.cambiosIncluidos`) y su marcador (`limitesPorContrato`) los
 * escribe SOLO el servidor —`actualizarEstadoCuenta`, que exige al
 * propietario y audita, o `asignar-plan.mjs`— . Si un administrador del
 * comercio pudiera escribirlos, se daría a sí mismo cambios incluidos que no
 * contrató; si el propietario los escribiera desde el navegador, el cambio
 * quedaría sin auditoría. Ninguna regla nueva: estas pruebas fijan que la que
 * existe también cubre las dos claves nuevas.
 *
 * Tenants ficticios; `clearFirestore` limpia el emulador entero, como las demás
 * suites de reglas (no corren en paralelo: `fileParallelism: false`).
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
const A = 'contrato-reglas-a';
const B = 'contrato-reglas-b';
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
        plan: 'pro', limites: { conversaciones: 500, productos: 500, agendas: 10, cambiosIncluidos: 2 },
      });
    }
  });
});

describe('cuenta/estado: el valor por contrato y su marcador, solo por el servidor', () => {
  it('el administrador del comercio NO se fija cambios incluidos por contrato, ni con la copia entera ni con la clave suelta', async () => {
    const fs = adminA();
    await assertFails(updateDoc(doc(fs, ruta(A)), { 'limites.cambiosIncluidos': 40 }));
    await assertFails(updateDoc(doc(fs, ruta(A)), { limitesPorContrato: ['cambiosIncluidos'] }));
    await assertFails(updateDoc(doc(fs, ruta(A)), {
      limites: { conversaciones: 500, productos: 500, agendas: 10, cambiosIncluidos: 40 }, limitesPorContrato: ['cambiosIncluidos'],
    }));
    await assertFails(setDoc(doc(fs, ruta(A)), { limitesPorContrato: ['cambiosIncluidos'] }, { merge: true }));
  });

  it('tampoco quita un contrato ajeno a su favor ni toca el de otro comercio', async () => {
    await entorno.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), ruta(A)), { 'limites.cambiosIncluidos': 4, limitesPorContrato: ['cambiosIncluidos'] });
    });
    await assertFails(updateDoc(doc(adminA(), ruta(A)), { limitesPorContrato: deleteField() }));
    await assertFails(updateDoc(doc(adminA(), ruta(B)), { 'limites.cambiosIncluidos': 40 }));
    await assertFails(updateDoc(doc(adminB(), ruta(A)), { 'limites.cambiosIncluidos': 0 }));
  });

  it('el operador, un anónimo y NI SIQUIERA el propietario lo escriben desde el navegador: sin la callable no hay auditoría', async () => {
    for (const fs of [operA(), anonimo(), propietario()]) {
      await assertFails(updateDoc(doc(fs, ruta(A)), { 'limites.cambiosIncluidos': 4 }));
      await assertFails(updateDoc(doc(fs, ruta(A)), { limitesPorContrato: ['cambiosIncluidos'] }));
    }
  });

  it('LEERLO sí: el administrador ve su cuenta (con el marcador); el de otro comercio, no', async () => {
    await assertSucceeds(getDoc(doc(adminA(), ruta(A))));
    await assertFails(getDoc(doc(adminB(), ruta(A))));
  });
});
