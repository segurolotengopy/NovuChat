/**
 * `tenants/{t}/comprobantesRecibidos/{objeto}`: LO LEE QUIEN LEE CONVERSACIONES, NADIE LO ESCRIBE DESDE EL NAVEGADOR
 *
 * Lo escribe solo `cotejarComprobanteVenta` (SDK Admin) y lo borra el TTL o la purga de baja. Se escribe
 * negando, con el patrón de `visor-reglas.test.ts`: leen (get y list, la consulta de la consola) el
 * administrador y el operador del comercio y el propietario CON ventana de soporte; NO leen el propietario
 * sin ventana, el administrador de otro comercio, la ingesta, un administrador con Google, uno sin correo
 * verificado, nadie de un comercio dado de baja, una sesión sin claims ni el anónimo. Nadie crea, corrige
 * ni borra. Un control con las reglas apagadas prueba que los documentos existen (no pasa en vacío).
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
const A = 'recibidos-reglas-a';
const B = 'recibidos-reglas-b';
const BAJA = 'recibidos-reglas-baja';
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
  idMeta: 'wamid.reglas', conversacionId: 'wa_59170000001', estado: 'invalido', motivo: 'monto_menor',
  en: Timestamp.now(), vence: Timestamp.fromMillis(Date.now() + 90 * 86_400_000),
  importe: 100, montoLeido: 50, montoDistinto: false, intentos: 1, ruta: null,
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
    for (const t of [A, B, BAJA]) await setDoc(doc(db, `tenants/${t}/comprobantesRecibidos/${OBJETO}`), documento());
  });
});

const consulta = (db: ReturnType<ReturnType<typeof contexto['adminA']>['firestore']>, t: string) =>
  getDocs(query(collection(db, `tenants/${t}/comprobantesRecibidos`), orderBy('en', 'desc'), limit(100)));

describe('control: los documentos existen', () => {
  it('con las reglas apagadas se leen, así que las negaciones no pasan en vacío', async () => {
    await entorno.withSecurityRulesDisabled(async (ctx) => {
      expect((await getDoc(doc(ctx.firestore(), `tenants/${A}/comprobantesRecibidos/${OBJETO}`))).get('estado')).toBe('invalido');
      expect((await getDocs(collection(ctx.firestore(), `tenants/${A}/comprobantesRecibidos`))).size).toBe(1);
    });
  });
});

describe('lectura: quien lee conversaciones', () => {
  for (const quien of LEEN) {
    it(`${quien}: lee el documento (get) y la consulta de la consola (orderBy en desc, límite 100)`, async () => {
      const db = contexto[quien]().firestore();
      await assertSucceeds(getDoc(doc(db, `tenants/${A}/comprobantesRecibidos/${OBJETO}`)));
      const r = await assertSucceeds(consulta(db, A));
      expect(r.size).toBe(1);
    });
  }
  for (const quien of NO_LEEN) {
    it(`${quien}: no lee (ni get ni list)`, async () => {
      const db = contexto[quien]().firestore();
      await assertFails(getDoc(doc(db, `tenants/${A}/comprobantesRecibidos/${OBJETO}`)));
      await assertFails(consulta(db, A));
    });
  }
  it('el administrador de un comercio dado de baja no lee lo suyo', async () => {
    const db = contexto.adminBaja().firestore();
    await assertFails(getDoc(doc(db, `tenants/${BAJA}/comprobantesRecibidos/${OBJETO}`)));
    await assertFails(consulta(db, BAJA));
  });
  it('el administrador de A no lee lo de B, ni la ventana de soporte de A abre B', async () => {
    await assertFails(getDoc(doc(contexto.adminA().firestore(), `tenants/${B}/comprobantesRecibidos/${OBJETO}`)));
    await assertFails(consulta(contexto.adminA().firestore(), B));
    await assertFails(consulta(contexto.soporteConVentana().firestore(), B));
  });
});

describe('escritura: nadie desde el navegador', () => {
  for (const quien of TODOS) {
    it(`${quien}: no crea, no corrige y no borra`, async () => {
      const db = contexto[quien]().firestore();
      const ref = doc(db, `tenants/${A}/comprobantesRecibidos/${OBJETO}`);
      await assertFails(setDoc(doc(db, `tenants/${A}/comprobantesRecibidos/nuevo`), documento()));
      await assertFails(setDoc(ref, documento()));
      await assertFails(updateDoc(ref, { estado: 'valido' }));
      await assertFails(deleteDoc(ref));
    });
  }
  it('y nada de eso modificó el documento sembrado (se comprueba con las reglas apagadas)', async () => {
    await assertFails(updateDoc(doc(contexto.adminA().firestore(), `tenants/${A}/comprobantesRecibidos/${OBJETO}`), { estado: 'valido' }));
    await entorno.withSecurityRulesDisabled(async (ctx) => {
      const d = await getDoc(doc(ctx.firestore(), `tenants/${A}/comprobantesRecibidos/${OBJETO}`));
      expect(d.get('estado')).toBe('invalido');
      expect(d.exists()).toBe(true);
    });
  });
});

describe('la regla está donde debe', () => {
  it('declara comprobantesRecibidos dentro de /tenants con la lectura de conversaciones y sin escritura', () => {
    const fuente = readFileSync(REGLAS, 'utf8');
    const bloque = /match \/comprobantesRecibidos\/\{objeto\} \{\s*allow get, list: if puedeLeerConversaciones\(tenantId\);\s*allow create, update, delete: if false;\s*\}/.exec(fuente);
    expect(bloque, 'bloque comprobantesRecibidos').not.toBeNull();
    expect(bloque!.index).toBeGreaterThan(fuente.indexOf('match /tenants/{tenantId}'));
  });
});
