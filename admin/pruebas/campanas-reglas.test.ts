/**
 * LAS REGLAS DE `config/campanas` (Andres, 24/09/2026).
 *
 * El tope de campañas por plan se hace cumplir ACÁ, con el tamaño de la lista
 * (CLAUDE.md, base comercial §7): la pantalla acompaña, la regla manda. Las
 * pruebas se escriben NEGANDO, como el aislamiento entre comercios de
 * `reglas.test.ts`: el comercio con el plan chico NO puede cargar la campaña
 * de más, ni armando la petición a mano; nadie escribe lo aprobado desde el
 * navegador; y un comercio no toca las campañas de otro.
 */
import {
  assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const aqui = dirname(fileURLToPath(import.meta.url));
const A = 'campanas-a';
const B = 'campanas-b';
const S = 'campanas-suspendido';
let entorno: RulesTestEnvironment;

const claims = (tenants: Record<string, string>) => ({
  nc: { t: tenants, v: 1 }, firebase: { sign_in_provider: 'password', identities: {} }, email_verified: true,
});
const adminA = () => entorno.authenticatedContext('u-admin-a', claims({ [A]: 'admin' })).firestore();
const operA = () => entorno.authenticatedContext('u-oper-a', claims({ [A]: 'oper' })).firestore();
const adminB = () => entorno.authenticatedContext('u-admin-b', claims({ [B]: 'admin' })).firestore();
const adminS = () => entorno.authenticatedContext('u-admin-s', claims({ [S]: 'admin' })).firestore();

const DIA = 86_400_000;
const dia = (n: number) => new Date(Date.now() - 4 * 3_600_000 + n * DIA).toISOString().slice(0, 10);
const campana = (id: string) => ({ id, texto: `Quiero la campaña ${id}`, inicio: dia(0), fin: dia(30) });
const lista = (n: number) => Array.from({ length: n }, (_, i) => campana(`c${i + 1}`));
const sello = (uid = 'u-admin-a') => ({ actualizadoPor: uid, actualizadoEn: serverTimestamp() });
const ruta = (t: string) => `tenants/${t}/config/campanas`;

/** Deja al comercio con un plan (o una copia de límites) y, si se pide, campañas ya cargadas. */
const preparar = async (t: string, cuenta: Record<string, unknown>, cargadas?: unknown[]) => {
  await entorno.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    await setDoc(doc(fs, `tenants/${t}/cuenta/estado`), cuenta);
    if (cargadas) {
      await setDoc(doc(fs, ruta(t)), { lista: cargadas, actualizadoPor: 'seed', actualizadoEn: Timestamp.now(),
        vigentes: cargadas, revision: { hash: 'x' } });
    }
  });
};

beforeAll(async () => {
  entorno = await initializeTestEnvironment({
    projectId: 'demo-novuchat-pruebas',
    firestore: {
      rules: readFileSync(join(aqui, '..', 'firestore.rules'), 'utf8'),
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
      await setDoc(doc(fs, `tenants/${t}/cuenta/estado`), { plan: 'crecimiento' });
    }
  });
});

describe('config/campanas: el tope del plan lo pone la regla', () => {
  it('Crecimiento (3): entran 3, la cuarta NO, ni creando ni editando', async () => {
    await assertSucceeds(setDoc(doc(adminA(), ruta(A)), { lista: lista(3), ...sello() }));
    await assertFails(updateDoc(doc(adminA(), ruta(A)), { lista: lista(4), ...sello() }));
    await entorno.clearFirestore();
    await preparar(A, { plan: 'crecimiento' });
    await entorno.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'tenants', A), { nombre: A, estado: 'activo', plan: 'crecimiento', flujos: ['agendamiento'] });
    });
    await assertFails(setDoc(doc(adminA(), ruta(A)), { lista: lista(4), ...sello() }));
  });

  it('Impulso (0): ninguna campaña; una lista vacía sí', async () => {
    await preparar(A, { plan: 'impulso' });
    await assertFails(setDoc(doc(adminA(), ruta(A)), { lista: lista(1), ...sello() }));
    await assertSucceeds(setDoc(doc(adminA(), ruta(A)), { lista: [], ...sello() }));
  });

  it('Pro (10): entran 10 y nunca 11; la copia de la cuenta manda sobre el plan', async () => {
    await preparar(A, { plan: 'pro' });
    await assertSucceeds(setDoc(doc(adminA(), ruta(A)), { lista: lista(10), ...sello() }));
    await assertFails(updateDoc(doc(adminA(), ruta(A)), { lista: lista(11), ...sello() }));
    await preparar(B, { plan: 'impulso', limites: { campanas: 2 } });
    await assertSucceeds(setDoc(doc(adminB(), ruta(B)), { lista: lista(2), ...sello('u-admin-b') }));
    await assertFails(updateDoc(doc(adminB(), ruta(B)), { lista: lista(3), ...sello('u-admin-b') }));
  });

  it('un plan desconocido cae en el más chico (0)', async () => {
    await preparar(A, { plan: 'basico' });
    await assertFails(setDoc(doc(adminA(), ruta(A)), { lista: lista(1), ...sello() }));
  });

  it('si el plan BAJÓ con campañas cargadas, se puede achicar la lista pero no dejarla igual ni agrandarla', async () => {
    await preparar(A, { plan: 'impulso' }, lista(3));
    await assertFails(updateDoc(doc(adminA(), ruta(A)), { lista: lista(3), ...sello() }));
    await assertSucceeds(updateDoc(doc(adminA(), ruta(A)), { lista: lista(2), ...sello() }));
    await assertSucceeds(updateDoc(doc(adminA(), ruta(A)), { lista: [], ...sello() }));
    await assertFails(updateDoc(doc(adminA(), ruta(A)), { lista: lista(1), ...sello() }));
  });
});

describe('config/campanas: quién y qué', () => {
  it('lo aprobado (`vigentes`, `revision`) no se escribe desde el navegador, ni al crear ni al editar', async () => {
    await assertFails(setDoc(doc(adminA(), ruta(A)), { lista: lista(1), vigentes: lista(1), ...sello() }));
    await assertFails(setDoc(doc(adminA(), ruta(A)), { lista: lista(1), revision: { hash: 'x' }, ...sello() }));
    await preparar(A, { plan: 'crecimiento' }, lista(1));
    await assertFails(updateDoc(doc(adminA(), ruta(A)), { vigentes: lista(3), ...sello() }));
    await assertFails(updateDoc(doc(adminA(), ruta(A)), { lista: lista(2), revision: { hash: 'y' }, ...sello() }));
    await assertSucceeds(updateDoc(doc(adminA(), ruta(A)), { lista: lista(2), ...sello() }));
  });

  it('el operador lee pero no escribe; otro comercio no toca; un comercio suspendido no reconfigura', async () => {
    await preparar(A, { plan: 'crecimiento' }, lista(1));
    await assertSucceeds(getDoc(doc(operA(), ruta(A))));
    await assertFails(updateDoc(doc(operA(), ruta(A)), { lista: lista(2), ...sello('u-oper-a') }));
    await assertFails(getDoc(doc(adminB(), ruta(A))));
    await assertFails(updateDoc(doc(adminB(), ruta(A)), { lista: lista(2), ...sello('u-admin-b') }));
    await assertFails(setDoc(doc(adminS(), ruta(S)), { lista: lista(1), ...sello('u-admin-s') }));
  });

  it('el sello no miente, y el documento no se borra (vaciar la lista alcanza)', async () => {
    await assertFails(setDoc(doc(adminA(), ruta(A)), { lista: lista(1), ...sello('otro') }));
    await assertFails(setDoc(doc(adminA(), ruta(A)), { lista: lista(1), actualizadoPor: 'u-admin-a', actualizadoEn: Timestamp.fromMillis(0) }));
    await preparar(A, { plan: 'crecimiento' }, lista(1));
    await assertFails(deleteDoc(doc(adminA(), ruta(A))));
  });

  it('la forma mínima de cada campaña: un mapa de cuatro claves con texto de hasta 300', async () => {
    const malas: unknown[] = [
      { ...campana('a'), extra: 1 },
      { id: 'a', texto: 'x', inicio: dia(0) },
      { ...campana('a'), texto: 'x'.repeat(301) },
      { ...campana('a'), texto: 7 },
      'no es un mapa',
    ];
    for (const m of malas) {
      await assertFails(setDoc(doc(adminA(), ruta(A)), { lista: [campana('ok'), m], ...sello() }));
    }
    await assertFails(setDoc(doc(adminA(), ruta(A)), { lista: 'no es lista', ...sello() }));
    await assertSucceeds(setDoc(doc(adminA(), ruta(A)), { lista: [campana('ok')], ...sello() }));
    // El formato fino (id, fechas, su orden) no lo mira la regla: lo decide el
    // servidor, que NUNCA aplica una campaña así (`campanas.test.ts`).
    await assertSucceeds(updateDoc(doc(adminA(), ruta(A)), { lista: [{ ...campana('ok'), inicio: '24/09/2026' }], ...sello() }));
  });
});
