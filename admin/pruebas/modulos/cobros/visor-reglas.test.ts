/**
 * EL TOPE DEL VISOR (`topesDelVisor/{uid}`) NO LO TOCA NADIE DESDE EL NAVEGADOR
 *
 * El contador de 30 por hora y 100 por día lo lee y lo escribe solo la callable
 * `verComprobante` con el SDK Admin. Si el navegador pudiera borrar o bajar su
 * contador, el tope no sería un tope. Se escribe negando: el administrador, el
 * operador, el propietario (con y sin ventana de soporte), la ingesta, una
 * sesión sin claims, el anónimo y el MISMO usuario dueño del contador no leen,
 * no listan, no crean, no corrigen y no borran. Un control con las reglas
 * apagadas prueba que el documento existe (la prueba no pasa en vacío).
 */
import {
  assertFails, initializeTestEnvironment, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const aqui = dirname(fileURLToPath(import.meta.url));
const REGLAS = join(aqui, '..', '..', '..', 'firestore.rules');
const PROYECTO = 'demo-novuchat-pruebas';
const A = 'tope-visor-a';

let entorno: RulesTestEnvironment;

const claims = (
  tenants: Record<string, string>, propietario = false, proveedor = 'password', correoVerificado = true,
) => ({
  nc: { t: tenants, ...(propietario ? { p: true } : {}), v: 1 },
  firebase: { sign_in_provider: proveedor, identities: {} },
  email_verified: correoVerificado,
});

const IDENTIDADES: Array<[string, string, () => ReturnType<RulesTestEnvironment['authenticatedContext']>]> = [
  ['administrador del comercio', 'u-admin-a', () => entorno.authenticatedContext('u-admin-a', claims({ [A]: 'admin' }))],
  ['operador del comercio', 'u-oper-a', () => entorno.authenticatedContext('u-oper-a', claims({ [A]: 'oper' }))],
  ['propietario de NovuChat', 'u-novuchat', () => entorno.authenticatedContext('u-novuchat', claims({}, true, 'google.com'))],
  ['propietario con ventana de soporte vigente', 'u-soporte', () => entorno.authenticatedContext('u-soporte', claims({}, true, 'google.com'))],
  ['ingesta del comercio', 'svc-a', () => entorno.authenticatedContext('svc-a', claims({ [A]: 'ingesta' }, false, 'custom'))],
  ['sesión sin claims', 'u-huerfano', () => entorno.authenticatedContext('u-huerfano', {})],
  ['sin sesión', 'nadie', () => entorno.unauthenticatedContext()],
];

beforeAll(async () => {
  entorno = await initializeTestEnvironment({
    projectId: PROYECTO,
    firestore: {
      rules: readFileSync(REGLAS, 'utf8'),
      host: '127.0.0.1',
      port: Number(process.env['FIRESTORE_EMULATOR_PORT'] ?? 8231),
    },
  });
});
afterAll(async () => { await entorno?.cleanup(); });

beforeEach(async () => {
  await entorno.clearFirestore();
  await entorno.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'tenants', A), { nombre: A, estado: 'activo', modulos: ['cobros'] });
    // Una ventana de soporte vigente para el propietario del caso.
    await setDoc(doc(db, `tenants/${A}/accesosSoporte/u-soporte`), { expira: Timestamp.fromMillis(Date.now() + 3_600_000) });
    for (const [, uid] of IDENTIDADES) {
      await setDoc(doc(db, 'topesDelVisor', uid), {
        hora: '2026-10-09T10', vistasHora: 29, dia: '2026-10-09', vistasDia: 99, actualizadoEn: Timestamp.now(),
      });
    }
  });
});

describe('topesDelVisor/{uid}: cerrado a todo cliente', () => {
  it('el control: el documento existe (sin reglas se lee), así que las negaciones no pasan en vacío', async () => {
    await entorno.withSecurityRulesDisabled(async (ctx) => {
      expect((await getDoc(doc(ctx.firestore(), 'topesDelVisor', 'u-oper-a'))).get('vistasHora')).toBe(29);
    });
  });

  for (const [nombre, uid, contexto] of IDENTIDADES) {
    describe(nombre, () => {
      it('no lee su propio contador ni el de otro (get)', async () => {
        const db = contexto().firestore();
        await assertFails(getDoc(doc(db, 'topesDelVisor', uid)));
        await assertFails(getDoc(doc(db, 'topesDelVisor', 'u-oper-a')));
        await assertFails(getDoc(doc(db, 'topesDelVisor', 'otro-usuario')));
      });
      it('no lista la colección (list)', async () => {
        await assertFails(getDocs(collection(contexto().firestore(), 'topesDelVisor')));
      });
      it('no crea, no pisa, no baja y no borra su contador (set, update, delete)', async () => {
        const db = contexto().firestore();
        const ref = doc(db, 'topesDelVisor', uid);
        await assertFails(setDoc(ref, { hora: '2026-10-09T10', vistasHora: 0, dia: '2026-10-09', vistasDia: 0 }));
        await assertFails(updateDoc(ref, { vistasHora: 0, vistasDia: 0 }));
        await assertFails(deleteDoc(ref));
        await assertFails(setDoc(doc(db, 'topesDelVisor', 'un-uid-nuevo'), { vistasHora: 0 }));
      });
    });
  }

  it('y nada de eso modificó el contador sembrado (se comprueba con las reglas apagadas)', async () => {
    const db = IDENTIDADES[1]![2]().firestore();
    await assertFails(updateDoc(doc(db, 'topesDelVisor', 'u-oper-a'), { vistasHora: 0 }));
    await entorno.withSecurityRulesDisabled(async (ctx) => {
      const d = await getDoc(doc(ctx.firestore(), 'topesDelVisor', 'u-oper-a'));
      expect(d.get('vistasHora')).toBe(29);
      expect(d.get('vistasDia')).toBe(99);
    });
  });
});

describe('la regla está donde debe', () => {
  const fuente = readFileSync(REGLAS, 'utf8');
  it('declara topesDelVisor con «allow read, write: if false», fuera de /tenants y antes de la negación final', () => {
    const bloque = /match \/topesDelVisor\/\{uid\} \{\s*allow read, write: if false;\s*\}/.exec(fuente);
    expect(bloque, 'bloque topesDelVisor').not.toBeNull();
    const final = fuente.indexOf('match /{documento=**}');
    expect(final).toBeGreaterThan(0);
    expect(bloque!.index).toBeLessThan(final);
    const tenants = fuente.indexOf('match /tenants/{tenantId}');
    // Está a nivel raíz: después del cierre del bloque de tenants, no adentro.
    expect(bloque!.index).toBeGreaterThan(tenants);
    expect(fuente.indexOf('match /plataforma/{documento}')).toBeLessThan(bloque!.index);
  });
});
