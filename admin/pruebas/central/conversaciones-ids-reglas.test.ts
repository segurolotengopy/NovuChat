/**
 * CONVERSACIONES (H1-3): LA CONSULTA POR IDS (`documentId() in […]`) BAJO LAS REGLAS REALES.
 *
 * La pantalla trae las fichas de los resultados de la búsqueda por palabra en UNA consulta
 * `where(documentId(), 'in', ids)` bajo `tenants/{t}/conversaciones` (en vez de un `getDoc` por resultado). Las reglas de
 * Firestore evalúan una consulta como un todo: para que pase, la regla de `list` tiene que ser verdadera para cualquier
 * documento que la consulta pudiera devolver. Esta suite lo comprueba con el emulador y `firestore.rules` de verdad:
 *
 *   · positiva: el administrador y el operador DEL NEGOCIO la hacen y reciben sus documentos;
 *   · negativas: el administrador de otro negocio, el operador de otro negocio y un anónimo NO;
 *   · un id que no existe no rompe la consulta (simplemente no vuelve).
 *
 * Necesita el emulador (corre en el proyecto `emulador`, con puerto propio):
 *   FIRESTORE_EMULATOR_PORT=8261 FIRESTORE_EMULATOR_WS_PORT=9181 bash pruebas/correr.sh pruebas/central/conversaciones-ids-reglas.test.ts
 * Teléfonos ficticios (seis ceros seguidos).
 */
import {
  assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, documentId, getDocs, query, setDoc, where } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const aqui = dirname(fileURLToPath(import.meta.url));
const A = 'ids-reglas-a';
const B = 'ids-reglas-b';
const IDS = ['wa_59100000047', 'wa_59100000074'];
let entorno: RulesTestEnvironment;

const claims = (tenants: Record<string, string>) => ({
  nc: { t: tenants, v: 1 },
  firebase: { sign_in_provider: 'password', identities: {} }, email_verified: true,
});
const adminA = () => entorno.authenticatedContext('u-admin-a', claims({ [A]: 'admin' })).firestore();
const operA = () => entorno.authenticatedContext('u-oper-a', claims({ [A]: 'oper' })).firestore();
const adminB = () => entorno.authenticatedContext('u-admin-b', claims({ [B]: 'admin' })).firestore();
const operB = () => entorno.authenticatedContext('u-oper-b', claims({ [B]: 'oper' })).firestore();
const anonimo = () => entorno.unauthenticatedContext().firestore();

/** La consulta exacta de la pantalla: `documentId() in […]` bajo las conversaciones del negocio. */
const porIds = (fs: ReturnType<typeof adminA>, tenantId: string, ids: string[]) =>
  getDocs(query(collection(fs, 'tenants', tenantId, 'conversaciones'), where(documentId(), 'in', ids)));

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
      await setDoc(doc(fs, 'tenants', t), { nombre: t, estado: 'activo', plan: 'pro', flujos: ['venta'] });
      for (const id of IDS) {
        await setDoc(doc(fs, 'tenants', t, 'conversaciones', id), {
          telefono: id.replace(/^wa_/, ''), ultimoMensaje: 'hola', ultimoEn: new Date(), canal: 'whatsapp',
        });
      }
    }
  });
});

describe('consulta por ids bajo las reglas reales', () => {
  it('POSITIVA: el administrador y el operador del negocio la hacen y reciben sus dos conversaciones', async () => {
    for (const fs of [adminA(), operA()]) {
      const r = await assertSucceeds(porIds(fs, A, IDS));
      expect(r.docs.map((d) => d.id).sort()).toEqual([...IDS].sort());
    }
  });

  it('POSITIVA: un id que no existe no rompe la consulta; solo no vuelve', async () => {
    const r = await assertSucceeds(porIds(adminA(), A, [IDS[0] as string, 'wa_59100000099']));
    expect(r.docs.map((d) => d.id)).toEqual([IDS[0]]);
  });

  it('NEGATIVA: el administrador y el operador de OTRO negocio no la hacen', async () => {
    await assertFails(porIds(adminB(), A, IDS));
    await assertFails(porIds(operB(), A, IDS));
    await assertFails(porIds(adminA(), B, IDS));
    await assertFails(porIds(operA(), B, IDS));
  });

  it('NEGATIVA: un anónimo no la hace', async () => {
    await assertFails(porIds(anonimo(), A, IDS));
  });
});
