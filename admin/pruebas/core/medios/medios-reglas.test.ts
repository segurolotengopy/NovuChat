/**
 * MEDIOS ENTRANTES GUARDADOS: reglas de Firestore (Core, H3 PR-1).
 *
 *  - `tenants/{t}/mediosRecibidos/{objeto}`: lo lee quien lee conversaciones; nadie lo escribe
 *    desde el navegador (lo escribe `guardarMedio`, con el SDK Admin, y lo borra el TTL o la purga).
 *  - `tenants/{t}/cuposDeMedios/{dia}` y `topesDeMedios/{uid}`: cerrados a lectura y escritura.
 *  - La bandera `guardarMedios` vive en la ficha del comercio, que ningún navegador escribe: ni el
 *    administrador del comercio ni el propietario pueden encenderla (D3: solo el script de plataforma,
 *    con el «sí» de Andres). Se escribe negando, y un control con las reglas apagadas prueba que los
 *    documentos existen (no pasa en vacío).
 */
import {
  assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, setDoc, Timestamp, updateDoc,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const aqui = dirname(fileURLToPath(import.meta.url));
const REGLAS = join(aqui, '..', '..', '..', 'firestore.rules');
const PROYECTO = 'demo-novuchat-pruebas';
const A = 'medios-reglas-a';
const B = 'medios-reglas-b';
const BAJA = 'medios-reglas-baja';
const OBJETO = 'ObjetoDeEjemplo-abcdefghijklmnopqrstuvwxyz-ABC';

let entorno: RulesTestEnvironment;

const claims = (
  tenants: Record<string, string>, propietario = false, proveedor = 'password', correoVerificado = true,
) => ({
  nc: { t: tenants, ...(propietario ? { p: true } : {}), v: 1 },
  firebase: { sign_in_provider: proveedor, identities: {} },
  email_verified: correoVerificado,
});

const contexto = {
  adminA: () => entorno.authenticatedContext('u-admin-a', claims({ [A]: 'admin' })),
  operA: () => entorno.authenticatedContext('u-oper-a', claims({ [A]: 'oper' })),
  soporteConVentana: () => entorno.authenticatedContext('u-soporte', claims({}, true, 'google.com')),
  propietarioSinVentana: () => entorno.authenticatedContext('u-novuchat', claims({}, true, 'google.com')),
  adminB: () => entorno.authenticatedContext('u-admin-b', claims({ [B]: 'admin' })),
  ingestaA: () => entorno.authenticatedContext('svc-a', claims({ [A]: 'ingesta' }, false, 'custom')),
  adminConGoogle: () => entorno.authenticatedContext('u-admin-g', claims({ [A]: 'admin' }, false, 'google.com')),
  adminSinCorreo: () => entorno.authenticatedContext('u-admin-sc', claims({ [A]: 'admin' }, false, 'password', false)),
  adminBaja: () => entorno.authenticatedContext('u-admin-baja', claims({ [BAJA]: 'admin' })),
  sinClaims: () => entorno.authenticatedContext('u-huerfano', {}),
  anonimo: () => entorno.unauthenticatedContext(),
};
type Identidad = keyof typeof contexto;

const LEEN: Identidad[] = ['adminA', 'operA', 'soporteConVentana'];
const NO_LEEN: Identidad[] = [
  'propietarioSinVentana', 'adminB', 'ingestaA', 'adminConGoogle', 'adminSinCorreo', 'sinClaims', 'anonimo',
];
const TODOS: Identidad[] = [...LEEN, ...NO_LEEN];

const documento = () => ({
  idMeta: 'wamid.reglas', conversacionId: 'wa_59170000001', tipo: 'audio', mime: 'audio/ogg', ext: 'ogg',
  tamano: 1024, sha256: 'a'.repeat(64), ruta: `tenants/${A}/medios/2026-10-23/${OBJETO}.ogg`,
  en: Timestamp.now(), vence: Timestamp.fromMillis(Date.now() + 90 * 86_400_000),
});

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
    await setDoc(doc(db, 'tenants', B), { nombre: B, estado: 'activo', modulos: ['cobros'] });
    await setDoc(doc(db, 'tenants', BAJA), { nombre: BAJA, estado: 'dado_de_baja', modulos: ['cobros'] });
    await setDoc(doc(db, `tenants/${A}/accesosSoporte/u-soporte`), { expira: Timestamp.fromMillis(Date.now() + 3_600_000) });
    for (const t of [A, B, BAJA]) await setDoc(doc(db, `tenants/${t}/mediosRecibidos/${OBJETO}`), documento());
    await setDoc(doc(db, `tenants/${A}/cuposDeMedios/2026-10-23`), { n: 1, bytes: 1024, vence: Timestamp.now() });
    await setDoc(doc(db, 'topesDeMedios/u-admin-a'), { hora: '2026-10-23T10', n: 1 });
  });
});

const consulta = (db: ReturnType<ReturnType<typeof contexto['adminA']>['firestore']>, t: string) =>
  getDocs(query(collection(db, `tenants/${t}/mediosRecibidos`), orderBy('en', 'desc'), limit(100)));

describe('control: los documentos existen', () => {
  it('con las reglas apagadas se leen, así que las negaciones no pasan en vacío', async () => {
    await entorno.withSecurityRulesDisabled(async (ctx) => {
      expect((await getDoc(doc(ctx.firestore(), `tenants/${A}/mediosRecibidos/${OBJETO}`))).get('tipo')).toBe('audio');
      expect((await getDocs(collection(ctx.firestore(), `tenants/${A}/mediosRecibidos`))).size).toBe(1);
      expect((await getDoc(doc(ctx.firestore(), `tenants/${A}/cuposDeMedios/2026-10-23`))).get('n')).toBe(1);
      expect((await getDoc(doc(ctx.firestore(), 'topesDeMedios/u-admin-a'))).get('n')).toBe(1);
    });
  });
});

describe('mediosRecibidos: lectura', () => {
  for (const quien of LEEN) {
    it(`${quien}: lee el documento (get) y la consulta (orderBy en desc, límite 100)`, async () => {
      const db = contexto[quien]().firestore();
      await assertSucceeds(getDoc(doc(db, `tenants/${A}/mediosRecibidos/${OBJETO}`)));
      expect((await assertSucceeds(consulta(db, A))).size).toBe(1);
    });
  }
  for (const quien of NO_LEEN) {
    it(`${quien}: no lee (ni get ni list)`, async () => {
      const db = contexto[quien]().firestore();
      await assertFails(getDoc(doc(db, `tenants/${A}/mediosRecibidos/${OBJETO}`)));
      await assertFails(consulta(db, A));
    });
  }
  it('el administrador de un comercio dado de baja no lee lo suyo', async () => {
    const db = contexto.adminBaja().firestore();
    await assertFails(getDoc(doc(db, `tenants/${BAJA}/mediosRecibidos/${OBJETO}`)));
    await assertFails(consulta(db, BAJA));
  });
  it('lectura cruzada: el administrador de A no lee lo de B, ni la ventana de soporte de A abre B', async () => {
    await assertFails(getDoc(doc(contexto.adminA().firestore(), `tenants/${B}/mediosRecibidos/${OBJETO}`)));
    await assertFails(consulta(contexto.adminA().firestore(), B));
    await assertFails(consulta(contexto.soporteConVentana().firestore(), B));
  });
});

describe('mediosRecibidos: escritura, nadie desde el navegador', () => {
  for (const quien of TODOS) {
    it(`${quien}: no crea, no corrige y no borra`, async () => {
      const db = contexto[quien]().firestore();
      const ref = doc(db, `tenants/${A}/mediosRecibidos/${OBJETO}`);
      await assertFails(setDoc(doc(db, `tenants/${A}/mediosRecibidos/nuevo`), documento()));
      await assertFails(setDoc(ref, documento()));
      await assertFails(updateDoc(ref, { tamano: 1 }));
      await assertFails(deleteDoc(ref));
    });
  }
  it('y nada de eso modificó el documento sembrado', async () => {
    await assertFails(updateDoc(doc(contexto.adminA().firestore(), `tenants/${A}/mediosRecibidos/${OBJETO}`), { tamano: 1 }));
    await entorno.withSecurityRulesDisabled(async (ctx) => {
      expect((await getDoc(doc(ctx.firestore(), `tenants/${A}/mediosRecibidos/${OBJETO}`))).get('tamano')).toBe(1024);
    });
  });
});

describe('cuposDeMedios y topesDeMedios: cerrados a todos', () => {
  for (const quien of TODOS) {
    it(`${quien}: ni lee, ni escribe, ni borra, ni lista`, async () => {
      const db = contexto[quien]().firestore();
      for (const ruta of [`tenants/${A}/cuposDeMedios/2026-10-23`, `tenants/${A}/cuposDeMedios/2026-10-24`, 'topesDeMedios/u-admin-a', 'topesDeMedios/u-nuevo']) {
        await assertFails(getDoc(doc(db, ruta)));
        await assertFails(setDoc(doc(db, ruta), { n: 0, bytes: 0 }));
        await assertFails(updateDoc(doc(db, ruta), { n: 0 }));
        await assertFails(deleteDoc(doc(db, ruta)));
      }
      await assertFails(getDocs(collection(db, `tenants/${A}/cuposDeMedios`)));
      await assertFails(getDocs(collection(db, 'topesDeMedios')));
    });
  }
});

describe('la bandera guardarMedios: el comercio no la enciende', () => {
  for (const quien of TODOS) {
    it(`${quien}: no escribe guardarMedios en la ficha`, async () => {
      const db = contexto[quien]().firestore();
      await assertFails(updateDoc(doc(db, 'tenants', A), { guardarMedios: true }));
      await assertFails(setDoc(doc(db, 'tenants', A), { nombre: A, estado: 'activo', guardarMedios: true }));
    });
  }
  it('la ficha sigue sin la bandera (se comprueba con las reglas apagadas)', async () => {
    await assertFails(updateDoc(doc(contexto.adminA().firestore(), 'tenants', A), { guardarMedios: true }));
    await entorno.withSecurityRulesDisabled(async (ctx) => {
      expect((await getDoc(doc(ctx.firestore(), 'tenants', A))).get('guardarMedios')).toBeUndefined();
    });
  });
});

describe('las reglas están donde deben', () => {
  const fuente = readFileSync(REGLAS, 'utf8');
  it('mediosRecibidos dentro de /tenants con la lectura de conversaciones y sin escritura', () => {
    const bloque = /match \/mediosRecibidos\/\{objeto\} \{\s*allow get, list: if puedeLeerConversaciones\(tenantId\);\s*allow create, update, delete: if false;\s*\}/.exec(fuente);
    expect(bloque, 'bloque mediosRecibidos').not.toBeNull();
    expect(bloque!.index).toBeGreaterThan(fuente.indexOf('match /tenants/{tenantId}'));
  });
  it('storage.rules niega /tenants/{t}/medios/** a todos', () => {
    const storage = readFileSync(join(aqui, '..', '..', '..', 'storage.rules'), 'utf8');
    expect(/match \/tenants\/\{tenantId\}\/medios\/\{resto=\*\*\} \{\s*allow read, write: if false;\s*\}/.test(storage)).toBe(true);
  });
  it('la ficha del comercio no se escribe desde el navegador (única puerta de la bandera)', () => {
    const i = fuente.indexOf('match /tenants/{tenantId} {');
    expect(fuente.slice(i, i + 3000)).toMatch(/allow create, update, delete: if false;/);
  });
});
