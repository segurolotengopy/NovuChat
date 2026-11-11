/**
 * `tenants/{t}/cobrosAlias/{pedidoId}` y `comprobantesAlias/{huella}` (cobro por alias en ARS, B4b), y el dato `config/cobros`
 * (interruptor y alias del tenant): LO LEEN QUIENES LEEN CONVERSACIONES (el dato, los miembros), NADIE LO ESCRIBE DESDE EL NAVEGADOR.
 * Mismo patrón que `recibidos-reglas.test.ts`. Los escriben solo `pedirAliasArs` y `cotejarAliasArs` (SDK Admin) y los borra el TTL.
 * Leen (get y list) el administrador y el operador del comercio y el propietario CON ventana de soporte; NO leen el propietario
 * sin ventana, el administrador de otro comercio, la ingesta, un administrador con Google, uno sin correo verificado, nadie de un
 * comercio dado de baja, una sesión sin claims ni el anónimo. Nadie crea, corrige ni borra. Un control con las reglas apagadas
 * prueba que los documentos existen (no pasa en vacío).
 */
import {
  assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection, deleteDoc, doc, getDoc, getDocs, setDoc, Timestamp, updateDoc,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const aqui = dirname(fileURLToPath(import.meta.url));
const REGLAS = join(aqui, '..', '..', '..', 'firestore.rules');
const PROYECTO = 'demo-novuchat-pruebas';
const A = 'alias-reglas-a';
const B = 'alias-reglas-b';
const BAJA = 'alias-reglas-baja';
const COLECCIONES = [['cobrosAlias', 'wa_pedido1'], ['comprobantesAlias', 'a'.repeat(64)]] as const;

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

const documento = () => ({ pedidoId: 'wa_pedido1', estado: 'abierto', en: Timestamp.now(), vence: Timestamp.fromMillis(Date.now() + 90 * 86_400_000) });

beforeAll(async () => {
  entorno = await initializeTestEnvironment({
    projectId: PROYECTO,
    firestore: { rules: readFileSync(REGLAS, 'utf8'), host: '127.0.0.1', port: Number(process.env['FIRESTORE_EMULATOR_PORT'] ?? 8231) },
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
    for (const t of [A, B, BAJA]) {
      for (const [c, id] of COLECCIONES) await setDoc(doc(db, `tenants/${t}/${c}/${id}`), documento());
      await setDoc(doc(db, `tenants/${t}/config/cobros`), { aliasArActivo: false, aliasAr: 'casa.bermejo.mp' });
    }
  });
});

describe('control: los documentos existen', () => {
  it('con las reglas apagadas se leen, así que las negaciones no pasan en vacío', async () => {
    await entorno.withSecurityRulesDisabled(async (ctx) => {
      for (const [c, id] of COLECCIONES) expect((await getDoc(doc(ctx.firestore(), `tenants/${A}/${c}/${id}`))).get('estado')).toBe('abierto');
      expect((await getDoc(doc(ctx.firestore(), `tenants/${A}/config/cobros`))).get('aliasArActivo')).toBe(false);
    });
  });
});

for (const [c, id] of COLECCIONES) {
  describe(`${c}: lectura`, () => {
    for (const quien of LEEN) {
      it(`${quien}: lee el documento y la lista`, async () => {
        const db = contexto[quien]().firestore();
        await assertSucceeds(getDoc(doc(db, `tenants/${A}/${c}/${id}`)));
        expect((await assertSucceeds(getDocs(collection(db, `tenants/${A}/${c}`)))).size).toBe(1);
      });
    }
    for (const quien of NO_LEEN) {
      it(`${quien}: no lee (ni get ni list)`, async () => {
        const db = contexto[quien]().firestore();
        await assertFails(getDoc(doc(db, `tenants/${A}/${c}/${id}`)));
        await assertFails(getDocs(collection(db, `tenants/${A}/${c}`)));
      });
    }
    it('nadie de un comercio dado de baja lee lo suyo, y A no lee lo de B', async () => {
      await assertFails(getDoc(doc(contexto.adminBaja().firestore(), `tenants/${BAJA}/${c}/${id}`)));
      await assertFails(getDoc(doc(contexto.adminA().firestore(), `tenants/${B}/${c}/${id}`)));
      await assertFails(getDocs(collection(contexto.soporteConVentana().firestore(), `tenants/${B}/${c}`)));
    });
  });

  describe(`${c}: escritura, nadie desde el navegador`, () => {
    for (const quien of TODOS) {
      it(`${quien}: no crea, no corrige y no borra`, async () => {
        const db = contexto[quien]().firestore();
        const ref = doc(db, `tenants/${A}/${c}/${id}`);
        await assertFails(setDoc(doc(db, `tenants/${A}/${c}/nuevo`), documento()));
        await assertFails(setDoc(ref, documento()));
        await assertFails(updateDoc(ref, { estado: 'coincide' }));
        await assertFails(deleteDoc(ref));
      });
    }
  });
}

describe('config/cobros: el comercio no enciende su propio interruptor ni cambia su alias', () => {
  for (const quien of TODOS) {
    it(`${quien}: no escribe`, async () => {
      const ref = doc(contexto[quien]().firestore(), `tenants/${A}/config/cobros`);
      await assertFails(updateDoc(ref, { aliasArActivo: true }));
      await assertFails(updateDoc(ref, { aliasAr: 'otro.alias.mp' }));
      await assertFails(setDoc(ref, { aliasArActivo: true, aliasAr: 'otro.alias.mp' }));
      await assertFails(deleteDoc(ref));
    });
  }
  it('lo leen los miembros del comercio y nadie de fuera', async () => {
    await assertSucceeds(getDoc(doc(contexto.adminA().firestore(), `tenants/${A}/config/cobros`)));
    await assertFails(getDoc(doc(contexto.adminB().firestore(), `tenants/${A}/config/cobros`)));
    await assertFails(getDoc(doc(contexto.anonimo().firestore(), `tenants/${A}/config/cobros`)));
  });
  it('y nada de eso lo modificó (se comprueba con las reglas apagadas)', async () => {
    await assertFails(updateDoc(doc(contexto.adminA().firestore(), `tenants/${A}/config/cobros`), { aliasArActivo: true }));
    await entorno.withSecurityRulesDisabled(async (ctx) => {
      expect((await getDoc(doc(ctx.firestore(), `tenants/${A}/config/cobros`))).get('aliasArActivo')).toBe(false);
    });
  });
});

describe('las reglas están donde deben', () => {
  it('declaran las dos colecciones dentro de /tenants, con la lectura de conversaciones y sin escritura', () => {
    const fuente = readFileSync(REGLAS, 'utf8');
    for (const [c, param] of [['cobrosAlias', 'pedidoId'], ['comprobantesAlias', 'huella']] as const) {
      const re = new RegExp(`match /${c}/\\{${param}\\} \\{\\s*allow get, list: if puedeLeerConversaciones\\(tenantId\\);\\s*allow create, update, delete: if false;\\s*\\}`);
      const bloque = re.exec(fuente);
      expect(bloque, `bloque ${c}`).not.toBeNull();
      expect(bloque!.index).toBeGreaterThan(fuente.indexOf('match /tenants/{tenantId}'));
    }
  });
});
