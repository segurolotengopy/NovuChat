/**
 * `tenants/{t}/mediosRecibidos/{objeto}` y `topesDeMedios/{contador}`: LOS LEE QUIEN LEE CONVERSACIONES, NADIE LOS ESCRIBE DESDE EL NAVEGADOR
 *
 * Lo escribe solo `guardarMedio` (SDK Admin, Core) y lo borra el TTL o la purga de baja. Mismo patrón que
 * `comprobantesRecibidos`: leen (get y list) el administrador y el operador del comercio y el propietario CON
 * ventana de soporte; NO leen el propietario sin ventana, el administrador de otro comercio, la ingesta, un
 * administrador con Google, uno sin correo verificado, nadie de un comercio dado de baja, una sesión sin claims
 * ni el anónimo. Nadie crea, corrige ni borra. El contador `topesDeMedios` no lo lee ni lo escribe nadie.
 * Un control con las reglas apagadas prueba que los documentos existen (no pasa en vacío).
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
  conversacionId: 'wa_59170001', idMeta: 'wamid.reglas', tipo: 'imagen', mime: 'image/jpeg', tamano: 1024,
  ruta: 'tenants/x/medios/2026-10-29/abc.jpg', estado: 'guardado', motivo: null,
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
  });
});

const consulta = (db: ReturnType<ReturnType<typeof contexto['adminA']>['firestore']>, t: string) =>
  getDocs(query(collection(db, `tenants/${t}/mediosRecibidos`), orderBy('en', 'desc'), limit(100)));

describe('control: los documentos existen', () => {
  it('con las reglas apagadas se leen, así que las negaciones no pasan en vacío', async () => {
    await entorno.withSecurityRulesDisabled(async (ctx) => {
      expect((await getDoc(doc(ctx.firestore(), `tenants/${A}/mediosRecibidos/${OBJETO}`))).get('estado')).toBe('guardado');
      expect((await getDocs(collection(ctx.firestore(), `tenants/${A}/mediosRecibidos`))).size).toBe(1);
    });
  });
});

describe('lectura: quien lee conversaciones', () => {
  for (const quien of LEEN) {
    it(`${quien}: lee el documento (get) y la consulta de la consola (orderBy en desc, límite 100)`, async () => {
      const db = contexto[quien]().firestore();
      await assertSucceeds(getDoc(doc(db, `tenants/${A}/mediosRecibidos/${OBJETO}`)));
      const r = await assertSucceeds(consulta(db, A));
      expect(r.size).toBe(1);
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
  it('el administrador de A no lee lo de B, ni la ventana de soporte de A abre B', async () => {
    await assertFails(getDoc(doc(contexto.adminA().firestore(), `tenants/${B}/mediosRecibidos/${OBJETO}`)));
    await assertFails(consulta(contexto.adminA().firestore(), B));
    await assertFails(consulta(contexto.soporteConVentana().firestore(), B));
  });
});

describe('escritura: nadie desde el navegador', () => {
  for (const quien of TODOS) {
    it(`${quien}: no crea, no corrige y no borra`, async () => {
      const db = contexto[quien]().firestore();
      const ref = doc(db, `tenants/${A}/mediosRecibidos/${OBJETO}`);
      await assertFails(setDoc(doc(db, `tenants/${A}/mediosRecibidos/nuevo`), documento()));
      await assertFails(setDoc(ref, documento()));
      await assertFails(updateDoc(ref, { estado: 'fallo' }));
      await assertFails(deleteDoc(ref));
    });
  }
  it('y nada de eso modificó el documento sembrado (se comprueba con las reglas apagadas)', async () => {
    await assertFails(updateDoc(doc(contexto.adminA().firestore(), `tenants/${A}/mediosRecibidos/${OBJETO}`), { estado: 'fallo' }));
    await entorno.withSecurityRulesDisabled(async (ctx) => {
      const d = await getDoc(doc(ctx.firestore(), `tenants/${A}/mediosRecibidos/${OBJETO}`));
      expect(d.get('estado')).toBe('guardado');
      expect(d.exists()).toBe(true);
    });
  });
});

describe('la regla está donde debe', () => {
  it('declara mediosRecibidos dentro de /tenants con la lectura de conversaciones y sin escritura', () => {
    const fuente = readFileSync(REGLAS, 'utf8');
    const bloque = /match \/mediosRecibidos\/\{objeto\} \{\s*allow get, list: if puedeLeerConversaciones\(tenantId\);\s*allow create, update, delete: if false;\s*\}/.exec(fuente);
    expect(bloque, 'bloque mediosRecibidos').not.toBeNull();
    expect(bloque!.index).toBeGreaterThan(fuente.indexOf('match /tenants/{tenantId}'));
  });
});

describe('topesDeMedios: el contador diario no lo toca nadie del navegador', () => {
  const ruta = `topesDeMedios/${A}_2026-10-29`;
  beforeEach(async () => {
    await entorno.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), ruta), { n: 1, rechazados: 0 }); });
  });
  for (const quien of TODOS) {
    it(`${quien}: ni lee, ni escribe, ni borra, ni lista`, async () => {
      const db = contexto[quien]().firestore();
      await assertFails(getDoc(doc(db, ruta)));
      await assertFails(setDoc(doc(db, ruta), { n: 0 }));
      await assertFails(updateDoc(doc(db, ruta), { n: 0 }));
      await assertFails(deleteDoc(doc(db, ruta)));
      await assertFails(getDocs(collection(db, 'topesDeMedios')));
    });
  }
});
