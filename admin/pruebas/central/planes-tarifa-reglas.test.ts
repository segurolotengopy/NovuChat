/**
 * LA TARIFA NO SE ESCRIBE DESDE EL NAVEGADOR — la prueba negativa de reglas del
 * eje `cuenta/estado.tarifa` (`planes-tarifa.test.ts`).
 *
 * `cuenta/estado` es de solo lectura para todos en `firestore.rules`
 * (`allow create, update, delete: if false`). La tarifa decide cuántas
 * conversaciones incluye el plan: si un administrador del comercio pudiera
 * escribirla, se subiría solo de 100 a 200 (o de 220 a 500) sin pagar la
 * diferencia; si el propietario la escribiera desde el navegador, el cambio
 * quedaría sin auditoría. La escribe SOLO el servidor: el alta
 * (`cuentaInicial`) y, en los PR siguientes del bloque, `asignar-plan.mjs` y
 * `migrar-tarifa.mjs`, con auditoría. Ninguna regla nueva: estas pruebas fijan
 * que la que existe también cubre el campo nuevo.
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
const A = 'tarifa-reglas-a';
const B = 'tarifa-reglas-b';
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
      await setDoc(doc(fs, 'tenants', t), { nombre: t, estado: 'activo', plan: 'impulso', flujos: ['agendamiento'] });
      await setDoc(doc(fs, ruta(t)), {
        plan: 'impulso', limites: { conversaciones: 100, productos: 20, agendas: 1, cambiosIncluidos: 0 },
      });
    }
  });
});

describe('cuenta/estado.tarifa: solo por el servidor', () => {
  it('el administrador del comercio NO se sube a la tarifa estándar, ni con la clave suelta ni con la cuenta entera', async () => {
    const fs = adminA();
    await assertFails(updateDoc(doc(fs, ruta(A)), { tarifa: 'estandar' }));
    await assertFails(setDoc(doc(fs, ruta(A)), { tarifa: 'estandar' }, { merge: true }));
    await assertFails(setDoc(doc(fs, ruta(A)), {
      plan: 'impulso', tarifa: 'estandar', limites: { conversaciones: 200, productos: 20, agendas: 1, cambiosIncluidos: 0 },
    }));
  });

  it('tampoco la quita para volver a la tarifa de respaldo ni toca la de otro comercio', async () => {
    await entorno.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), ruta(A)), { tarifa: 'estandar' });
    });
    await assertFails(updateDoc(doc(adminA(), ruta(A)), { tarifa: deleteField() }));
    await assertFails(updateDoc(doc(adminA(), ruta(B)), { tarifa: 'estandar' }));
    await assertFails(updateDoc(doc(adminB(), ruta(A)), { tarifa: 'meta_incluido' }));
  });

  it('el operador, un anónimo y NI SIQUIERA el propietario la escriben desde el navegador: sin el servidor no hay auditoría', async () => {
    for (const fs of [operA(), anonimo(), propietario()]) {
      await assertFails(updateDoc(doc(fs, ruta(A)), { tarifa: 'estandar' }));
      await assertFails(updateDoc(doc(fs, ruta(A)), { tarifa: 'meta_incluido' }));
    }
  });

  it('LEERLA sí: el administrador ve su cuenta (con la tarifa); el de otro comercio, no', async () => {
    await entorno.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), ruta(A)), { tarifa: 'estandar' });
    });
    await assertSucceeds(getDoc(doc(adminA(), ruta(A))));
    await assertFails(getDoc(doc(adminB(), ruta(A))));
  });
});
