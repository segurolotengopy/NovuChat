/**
 * REGLAS DE STORAGE — EL ARCHIVO DE PLANES DE LA CAPTACIÓN, PROBADO NEGANDO.
 *
 * Contrato que verifican (admin/storage.rules):
 *   · único camino: tenants/{tenantId}/captacion/{planes.pdf|planes.jpg|planes.png}
 *   · planes.pdf → application/pdf ≤ 10 MB; planes.jpg / planes.png → image/jpeg
 *     / image/png ≤ 5 MB. El tipo tiene que coincidir con la extensión.
 *   · escribir y borrar: el ADMIN del comercio o el PROPIETARIO, con el flujo
 *     `onboarding` y el comercio 'activo' — el criterio de /config/onboarding.
 *   · leer por el SDK: miembros del comercio y el propietario. Listar: nadie.
 *   · todo lo demás: denegado.
 *
 * SE ESCRIBE NEGANDO (CLAUDE.md, base comercial §7): por cada caso que pasa hay
 * varios que tienen que fallar, construyendo la petición a mano, que es lo que
 * haría cualquiera con la consola del navegador abierta.
 *
 * SE SALTA sin STORAGE_EMULATOR_PORT. La corre `pruebas/correr-storage.sh`,
 * que levanta Firestore y Storage juntos con `firebase emulators:exec` (el
 * emulador de Storage resuelve `firestore.get()` contra el de Firestore del
 * mismo proceso). `pruebas/correr.sh` —solo Firestore— la ve saltada.
 */
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import {
  deleteObject, getDownloadURL, getMetadata, listAll, ref, updateMetadata, uploadBytes,
} from 'firebase/storage';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const aqui = dirname(fileURLToPath(import.meta.url));
const PUERTO_STORAGE = process.env.STORAGE_EMULATOR_PORT;
const PUERTO_FIRESTORE = process.env.FIRESTORE_EMULATOR_PORT;

const MB = 1024 * 1024;

/** Comercio con captación, activo. */
const A = 'tenant-a-captacion';
/** Otro comercio con captación, activo: el vecino. */
const B = 'tenant-b-captacion';
/** Comercio activo SIN el flujo de captación. */
const S = 'tenant-s-sin-captacion';
/** Comercio con captación, SUSPENDIDO. */
const D = 'tenant-d-suspendido';
/** Comercio con captación, dado de baja. */
const X = 'tenant-x-baja';
/** Ficha vieja: sin lista `flujos`, con `vertical: 'onboarding'`. */
const L = 'tenant-l-legado';
/** Ficha contradictoria: `vertical: 'onboarding'` pero `flujos: ['venta']`. Manda la lista. */
const M = 'tenant-m-lista-manda';
/** Tenant que NO existe en Firestore. */
const N = 'tenant-n-inexistente';

/** Mismos claims simulados que pruebas/reglas.test.ts: la identidad es la misma. */
const claims = (
  tenants: Record<string, string>,
  propietario = false,
  proveedor = 'password',
  correoVerificado = true,
) => ({
  nc: { t: tenants, ...(propietario ? { p: true } : {}), v: 1 },
  firebase: { sign_in_provider: proveedor, identities: {} },
  email_verified: correoVerificado,
});

let entorno: RulesTestEnvironment;

const st = (uid: string, c: object) => entorno.authenticatedContext(uid, c).storage();
const adminA = () => st('u-admin-a', claims({ [A]: 'admin' }));
const operA = () => st('u-oper-a', claims({ [A]: 'oper' }));
const ingestaA = () => st('svc-a', claims({ [A]: 'ingesta' }, false, 'custom'));
const adminB = () => st('u-admin-b', claims({ [B]: 'admin' }));
const adminS = () => st('u-admin-s', claims({ [S]: 'admin' }));
const adminD = () => st('u-admin-d', claims({ [D]: 'admin' }));
const adminX = () => st('u-admin-x', claims({ [X]: 'admin' }));
const adminL = () => st('u-admin-l', claims({ [L]: 'admin' }));
const adminM = () => st('u-admin-m', claims({ [M]: 'admin' }));
const adminN = () => st('u-admin-n', claims({ [N]: 'admin' }));
const propietario = () => st('u-novuchat', claims({}, true, 'google.com'));
const anonimo = () => entorno.unauthenticatedContext().storage();
// Proveedor equivocado para el rol: el claim tiene que quedar inerte.
const adminAConGoogle = () => st('u-admin-a', claims({ [A]: 'admin' }, false, 'google.com'));
const adminASinVerificar = () => st('u-admin-a', claims({ [A]: 'admin' }, false, 'password', false));
const propietarioConPassword = () => st('u-novuchat', claims({}, true, 'password'));
const propietarioCustom = () => st('u-colado', claims({}, true, 'custom'));

type Storage = ReturnType<typeof adminA>;

const ruta = (t: string, archivo = 'planes.pdf') => `tenants/${t}/captacion/${archivo}`;

/** Sube `n` bytes con el tipo declarado. El contenido no importa a las reglas. */
const subir = (s: Storage, camino: string, n: number, contentType: string) =>
  uploadBytes(ref(s, camino), new Uint8Array(n), { contentType });

const pdf = (s: Storage, t: string, n = 200 * 1024) => subir(s, ruta(t), n, 'application/pdf');

/** Deja un archivo en su lugar sin pasar por las reglas. */
const sembrarArchivo = (camino: string, contentType = 'application/pdf') =>
  entorno.withSecurityRulesDisabled(async (ctx) => {
    await uploadBytes(ref(ctx.storage(), camino), new Uint8Array(1024), { contentType });
  });

describe.skipIf(!PUERTO_STORAGE)('storage.rules — archivo de planes de la captación', () => {
  beforeAll(async () => {
    entorno = await initializeTestEnvironment({
      projectId: 'demo-novuchat-pruebas',
      firestore: {
        rules: readFileSync(join(aqui, '..', 'firestore.rules'), 'utf8'),
        host: '127.0.0.1',
        port: Number(PUERTO_FIRESTORE ?? 8233),
      },
      storage: {
        rules: readFileSync(join(aqui, '..', 'storage.rules'), 'utf8'),
        host: '127.0.0.1',
        port: Number(PUERTO_STORAGE),
      },
    });
  });

  afterAll(async () => { await entorno?.cleanup(); });

  beforeEach(async () => {
    await entorno.clearFirestore();
    await entorno.clearStorage();
    await entorno.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const fichas: Record<string, object> = {
        [A]: { estado: 'activo', vertical: 'onboarding', flujos: ['onboarding'] },
        [B]: { estado: 'activo', vertical: 'onboarding', flujos: ['onboarding'] },
        [S]: { estado: 'activo', vertical: 'agendamiento', flujos: ['agendamiento'] },
        [D]: { estado: 'suspendido', vertical: 'onboarding', flujos: ['onboarding'] },
        [X]: { estado: 'dado_de_baja', vertical: 'onboarding', flujos: ['onboarding'] },
        [L]: { estado: 'activo', vertical: 'onboarding' },
        [M]: { estado: 'activo', vertical: 'onboarding', flujos: ['venta'] },
      };
      for (const [t, ficha] of Object.entries(fichas)) {
        await setDoc(doc(db, 'tenants', t), { nombre: t, plan: 'basico', ...ficha });
      }
    });
  });

  // ===========================================================================
  describe('Subir: el caso que tiene que pasar', () => {
    it('el admin del comercio sube planes.pdf válido', async () => {
      await assertSucceeds(pdf(adminA(), A));
    });

    it('el admin sube planes.jpg y planes.png con su tipo', async () => {
      await assertSucceeds(subir(adminA(), ruta(A, 'planes.jpg'), MB, 'image/jpeg'));
      await assertSucceeds(subir(adminA(), ruta(A, 'planes.png'), MB, 'image/png'));
    });

    it('los topes son inclusivos: PDF de 10 MB y JPG de 5 MB exactos pasan', async () => {
      await assertSucceeds(pdf(adminA(), A, 10 * MB));
      await assertSucceeds(subir(adminA(), ruta(A, 'planes.jpg'), 5 * MB, 'image/jpeg'));
    });

    it('el admin reemplaza el archivo existente (update)', async () => {
      await sembrarArchivo(ruta(A));
      await assertSucceeds(pdf(adminA(), A));
    });

    it('el propietario sube en un comercio con captación y activo', async () => {
      await assertSucceeds(pdf(propietario(), A));
    });

    it('ficha vieja sin `flujos` y con vertical onboarding: vale como [vertical]', async () => {
      await assertSucceeds(pdf(adminL(), L));
    });
  });

  // ===========================================================================
  describe('Subir: tamaño, tipo y nombre', () => {
    it('PDF de 11 MB (y de 10 MB + 1 byte) se rechaza', async () => {
      await assertFails(pdf(adminA(), A, 11 * MB));
      await assertFails(pdf(adminA(), A, 10 * MB + 1));
    });

    it('imagen de 6 MB se rechaza, JPG o PNG', async () => {
      await assertFails(subir(adminA(), ruta(A, 'planes.jpg'), 6 * MB, 'image/jpeg'));
      await assertFails(subir(adminA(), ruta(A, 'planes.png'), 6 * MB, 'image/png'));
    });

    it('archivo vacío se rechaza', async () => {
      await assertFails(pdf(adminA(), A, 0));
    });

    it('contentType que no coincide con la extensión se rechaza', async () => {
      await assertFails(subir(adminA(), ruta(A, 'planes.pdf'), 1024, 'image/png'));
      await assertFails(subir(adminA(), ruta(A, 'planes.pdf'), 1024, 'text/html'));
      await assertFails(subir(adminA(), ruta(A, 'planes.jpg'), 1024, 'application/pdf'));
      await assertFails(subir(adminA(), ruta(A, 'planes.png'), 1024, 'image/jpeg'));
      await assertFails(subir(adminA(), ruta(A, 'planes.jpg'), 1024, 'image/svg+xml'));
    });

    it('un nombre distinto de los tres se rechaza, aunque el tipo sea bueno', async () => {
      for (const nombre of ['otro.pdf', 'planes.exe', 'planes.PDF', 'planes.jpeg', 'planes', '.planes.pdf']) {
        await assertFails(subir(adminA(), ruta(A, nombre), 1024, 'application/pdf'));
      }
    });

    it('rutas con `..` o más profundas caen en la negación final', async () => {
      await assertFails(subir(adminA(), `tenants/${A}/captacion/../x`, 1024, 'application/pdf'));
      await assertFails(subir(adminA(), `tenants/${A}/captacion/../../${B}/captacion/planes.pdf`, 1024, 'application/pdf'));
      await assertFails(subir(adminA(), `tenants/${A}/captacion/planes.pdf/x`, 1024, 'application/pdf'));
    });

    it('otra carpeta del MISMO comercio se rechaza', async () => {
      await assertFails(subir(adminA(), `tenants/${A}/otra/planes.pdf`, 1024, 'application/pdf'));
      await assertFails(subir(adminA(), `tenants/${A}/planes.pdf`, 1024, 'application/pdf'));
      await assertFails(subir(adminA(), `tenants/${A}/captacionx/planes.pdf`, 1024, 'application/pdf'));
      await assertFails(subir(adminA(), 'planes.pdf', 1024, 'application/pdf'));
    });

    it('cambiar solo los metadatos a un tipo que no corresponde se rechaza', async () => {
      await sembrarArchivo(ruta(A));
      await assertFails(updateMetadata(ref(adminA(), ruta(A)), { contentType: 'text/html' }));
      // Metadatos que no cambian el tipo: es un update válido.
      await assertSucceeds(updateMetadata(ref(adminA(), ruta(A)), { customMetadata: { origen: 'consola' } }));
    });
  });

  // ===========================================================================
  describe('Subir: quién NO puede', () => {
    it('el admin de OTRO comercio no escribe en la carpeta ajena', async () => {
      await assertFails(pdf(adminB(), A));
    });

    it('el operador del comercio no escribe (tampoco escribe /config/onboarding)', async () => {
      await assertFails(pdf(operA(), A));
    });

    it('el principal de ingesta no escribe', async () => {
      await assertFails(pdf(ingestaA(), A));
    });

    it('anónimo no escribe', async () => {
      await assertFails(pdf(anonimo(), A));
    });

    it('el admin de un comercio SIN captación no escribe en su propia carpeta', async () => {
      await assertFails(pdf(adminS(), S));
    });

    it('con vertical onboarding pero `flujos` sin él, manda la lista y se rechaza', async () => {
      await assertFails(pdf(adminM(), M));
    });

    it('comercio suspendido: ni su admin ni el propietario escriben', async () => {
      await assertFails(pdf(adminD(), D));
      await assertFails(pdf(propietario(), D));
    });

    it('comercio dado de baja: no se escribe', async () => {
      await assertFails(pdf(adminX(), X));
    });

    it('tenant inexistente: un claim de admin no alcanza', async () => {
      await assertFails(pdf(adminN(), N));
    });

    it('el propietario no escribe en un comercio sin captación', async () => {
      await assertFails(pdf(propietario(), S));
    });

    it('proveedor de sesión equivocado o correo sin verificar: el claim queda inerte', async () => {
      await assertFails(pdf(adminAConGoogle(), A));
      await assertFails(pdf(adminASinVerificar(), A));
      await assertFails(pdf(propietarioConPassword(), A));
      await assertFails(pdf(propietarioCustom(), A));
    });
  });

  // ===========================================================================
  describe('Leer por el SDK', () => {
    beforeEach(async () => {
      await sembrarArchivo(ruta(A));
      await sembrarArchivo(ruta(S));
      await sembrarArchivo(ruta(D));
    });

    it('los miembros del comercio leen: admin, operador e ingesta', async () => {
      await assertSucceeds(getMetadata(ref(adminA(), ruta(A))));
      await assertSucceeds(getMetadata(ref(operA(), ruta(A))));
      await assertSucceeds(getMetadata(ref(ingestaA(), ruta(A))));
    });

    it('el admin obtiene la URL de descarga con token (la que se guarda para Meta)', async () => {
      const url = await assertSucceeds(getDownloadURL(ref(adminA(), ruta(A))));
      expect(url).toContain('token=');
    });

    it('el propietario lee en un comercio con captación', async () => {
      await assertSucceeds(getMetadata(ref(propietario(), ruta(A))));
    });

    it('un comercio suspendido sigue viendo lo suyo (igual que /config)', async () => {
      await assertSucceeds(getMetadata(ref(adminD(), ruta(D))));
    });

    it('un ajeno no lee: otro comercio, anónimo, proveedor equivocado', async () => {
      await assertFails(getMetadata(ref(adminB(), ruta(A))));
      await assertFails(getDownloadURL(ref(adminB(), ruta(A))));
      await assertFails(getMetadata(ref(anonimo(), ruta(A))));
      await assertFails(getDownloadURL(ref(anonimo(), ruta(A))));
      await assertFails(getMetadata(ref(adminAConGoogle(), ruta(A))));
    });

    it('el propietario no lee la carpeta de un comercio sin captación', async () => {
      await assertFails(getMetadata(ref(propietario(), ruta(S))));
    });

    it('un nombre fuera de la lista no se lee, aunque exista y quien pida sea el admin', async () => {
      await sembrarArchivo(`tenants/${A}/captacion/otro.pdf`);
      await assertFails(getMetadata(ref(adminA(), `tenants/${A}/captacion/otro.pdf`)));
    });
  });

  // ===========================================================================
  describe('Listar: nadie', () => {
    beforeEach(async () => { await sembrarArchivo(ruta(A)); });

    it('ni el admin, ni el propietario, ni un anónimo listan la carpeta', async () => {
      await assertFails(listAll(ref(adminA(), `tenants/${A}/captacion`)));
      await assertFails(listAll(ref(propietario(), `tenants/${A}/captacion`)));
      await assertFails(listAll(ref(anonimo(), `tenants/${A}/captacion`)));
      await assertFails(listAll(ref(propietario(), '')));
    });
  });

  // ===========================================================================
  describe('Borrar', () => {
    beforeEach(async () => {
      await sembrarArchivo(ruta(A));
      await sembrarArchivo(ruta(D));
    });

    it('el admin del comercio borra', async () => {
      await assertSucceeds(deleteObject(ref(adminA(), ruta(A))));
    });

    it('el propietario borra en un comercio con captación y activo', async () => {
      await assertSucceeds(deleteObject(ref(propietario(), ruta(A))));
    });

    it('el operador, otro comercio y un anónimo no borran', async () => {
      await assertFails(deleteObject(ref(operA(), ruta(A))));
      await assertFails(deleteObject(ref(adminB(), ruta(A))));
      await assertFails(deleteObject(ref(anonimo(), ruta(A))));
    });

    it('con el comercio suspendido no se borra', async () => {
      await assertFails(deleteObject(ref(adminD(), ruta(D))));
    });
  });

  // ===========================================================================
  // EVIDENCIA DE PAGOS DEL PREPAGO (storage.rules, /tenants/{t}/pagos/{pagoId}/…;
  // DISENO.md §4undecies.7, bloque A-1). La evidencia de una transferencia la
  // sube SOLO el propietario; la lee el admin del comercio (también suspendido)
  // y el propietario; `qr.png` no tiene camino de escritura por reglas.
  // Se escribe negando.
  // ===========================================================================
  describe('Evidencia de pagos (prepago)', () => {
    const PAGO = 'AbCdEfGhIjKlMnOpQrStUv';
    const rutaPago = (t: string, archivo = 'evidencia.pdf', pagoId = PAGO) => `tenants/${t}/pagos/${pagoId}/${archivo}`;
    const evidencia = (s: Storage, t: string, n = 200 * 1024, archivo = 'evidencia.pdf', tipo = 'application/pdf') =>
      subir(s, rutaPago(t, archivo), n, tipo);

    describe('subir', () => {
      it('el propietario sube evidencia.pdf, .jpg y .png con su tipo, y la reemplaza MIENTRAS el pago no está registrado', async () => {
        await assertSucceeds(evidencia(propietario(), A));
        await assertSucceeds(evidencia(propietario(), A, MB, 'evidencia.jpg', 'image/jpeg'));
        await assertSucceeds(evidencia(propietario(), A, MB, 'evidencia.png', 'image/png'));
        await assertSucceeds(evidencia(propietario(), A, 10 * MB));
        await assertSucceeds(evidencia(propietario(), A, 5 * MB, 'evidencia.jpg', 'image/jpeg'));
        await sembrarArchivo(rutaPago(A));
        await assertSucceeds(evidencia(propietario(), A));
      });

      it('una vez REGISTRADO el pago, el propietario no reemplaza la evidencia ni sube otra (MEDIUM 2)', async () => {
        await sembrarArchivo(rutaPago(A));
        await entorno.withSecurityRulesDisabled(async (ctx) => {
          await setDoc(doc(ctx.firestore(), `tenants/${A}/pagos/${PAGO}`), { estado: 'confirmado', medio: 'transferencia' });
        });
        await assertFails(evidencia(propietario(), A));
        await assertFails(evidencia(propietario(), A, MB, 'evidencia.jpg', 'image/jpeg'));
        await assertFails(updateMetadata(ref(propietario(), rutaPago(A)), { customMetadata: { otra: 'version' } }));
        // Sigue pudiendo LEERLA: es la evidencia del pago.
        await assertSucceeds(getMetadata(ref(propietario(), rutaPago(A))));
      });

      it('el ADMIN del comercio no sube evidencia, ni en su propio comercio: confirma el propietario', async () => {
        await assertFails(evidencia(adminA(), A));
        await assertFails(evidencia(adminA(), A, MB, 'evidencia.jpg', 'image/jpeg'));
      });

      it('el operador, otro comercio, la ingesta y un anónimo tampoco', async () => {
        await assertFails(evidencia(operA(), A));
        await assertFails(evidencia(adminB(), A));
        await assertFails(evidencia(ingestaA(), A));
        await assertFails(evidencia(anonimo(), A));
      });

      it('el claim de propietario con contraseña o con token personalizado queda inerte (T-19)', async () => {
        await assertFails(evidencia(propietarioConPassword(), A));
        await assertFails(evidencia(propietarioCustom(), A));
      });

      it('un PDF de 11 MB (y de 10 MB + 1 byte) no; una imagen de 6 MB no; vacío no', async () => {
        await assertFails(evidencia(propietario(), A, 11 * MB));
        await assertFails(evidencia(propietario(), A, 10 * MB + 1));
        await assertFails(evidencia(propietario(), A, 6 * MB, 'evidencia.jpg', 'image/jpeg'));
        await assertFails(evidencia(propietario(), A, 6 * MB, 'evidencia.png', 'image/png'));
        await assertFails(evidencia(propietario(), A, 0));
      });

      it('el tipo tiene que coincidir con la extensión', async () => {
        await assertFails(evidencia(propietario(), A, 1024, 'evidencia.pdf', 'text/html'));
        await assertFails(evidencia(propietario(), A, 1024, 'evidencia.pdf', 'image/png'));
        await assertFails(evidencia(propietario(), A, 1024, 'evidencia.jpg', 'application/pdf'));
        await assertFails(evidencia(propietario(), A, 1024, 'evidencia.png', 'image/svg+xml'));
      });

      it('qr.png NO se sube por reglas, ni el propietario: es del SDK Admin', async () => {
        await assertFails(evidencia(propietario(), A, 1024, 'qr.png', 'image/png'));
        await assertFails(evidencia(adminA(), A, 1024, 'qr.png', 'image/png'));
      });

      it('otro nombre, o un pagoId sin la forma de 22 caracteres, cae en la negación', async () => {
        for (const nombre of ['comprobante.pdf', 'evidencia.jpeg', 'evidencia.PDF', 'evidencia', 'evidencia.pdf.html']) {
          await assertFails(evidencia(propietario(), A, 1024, nombre));
        }
        for (const pagoId of ['p1', 'AbCdEfGhIjKlMnOpQrStU', 'AbCdEfGhIjKlMnOpQrStUvW', 'AbCdEfGhIjKlMnOpQrSt.v']) {
          await assertFails(subir(propietario(), rutaPago(A, 'evidencia.pdf', pagoId), 1024, 'application/pdf'));
        }
        await assertFails(subir(propietario(), `tenants/${A}/pagos/evidencia.pdf`, 1024, 'application/pdf'));
        await assertFails(subir(propietario(), `tenants/${A}/pagos/${PAGO}/x/evidencia.pdf`, 1024, 'application/pdf'));
      });
    });

    describe('leer', () => {
      beforeEach(async () => {
        await sembrarArchivo(rutaPago(A));
        await sembrarArchivo(rutaPago(A, 'qr.png'), 'image/png');
        await sembrarArchivo(rutaPago(D, 'qr.png'), 'image/png');
        await sembrarArchivo(rutaPago(X));
        await sembrarArchivo(rutaPago(A, 'otro.pdf'));
      });

      it('el admin del comercio lee la evidencia y el QR; el propietario también', async () => {
        await assertSucceeds(getMetadata(ref(adminA(), rutaPago(A))));
        await assertSucceeds(getMetadata(ref(adminA(), rutaPago(A, 'qr.png'))));
        await assertSucceeds(getDownloadURL(ref(adminA(), rutaPago(A, 'qr.png'))));
        await assertSucceeds(getMetadata(ref(propietario(), rutaPago(A))));
        await assertSucceeds(getMetadata(ref(propietario(), rutaPago(A, 'qr.png'))));
      });

      it('un comercio SUSPENDIDO sigue viendo su QR (es con lo que se reactiva)', async () => {
        await assertSucceeds(getMetadata(ref(adminD(), rutaPago(D, 'qr.png'))));
      });

      it('el OPERADOR no lee: la situación financiera no es asunto suyo', async () => {
        await assertFails(getMetadata(ref(operA(), rutaPago(A))));
        await assertFails(getMetadata(ref(operA(), rutaPago(A, 'qr.png'))));
        await assertFails(getDownloadURL(ref(operA(), rutaPago(A, 'qr.png'))));
      });

      it('el admin del comercio B no lee lo de A; tampoco la ingesta, un anónimo ni un admin con Google', async () => {
        await assertFails(getMetadata(ref(adminB(), rutaPago(A))));
        await assertFails(getDownloadURL(ref(adminB(), rutaPago(A, 'qr.png'))));
        await assertFails(getMetadata(ref(ingestaA(), rutaPago(A))));
        await assertFails(getMetadata(ref(anonimo(), rutaPago(A))));
        await assertFails(getMetadata(ref(adminAConGoogle(), rutaPago(A))));
        await assertFails(getMetadata(ref(propietarioConPassword(), rutaPago(A))));
      });

      it('un comercio dado de baja no lee ni con su admin', async () => {
        await assertFails(getMetadata(ref(adminX(), rutaPago(X))));
      });

      it('un nombre fuera de la lista no se lee aunque exista', async () => {
        await assertFails(getMetadata(ref(adminA(), rutaPago(A, 'otro.pdf'))));
        await assertFails(getMetadata(ref(propietario(), rutaPago(A, 'otro.pdf'))));
      });
    });

    describe('listar y borrar: nadie', () => {
      beforeEach(async () => { await sembrarArchivo(rutaPago(A)); });

      it('ni el admin ni el propietario listan la carpeta del pago ni la de pagos', async () => {
        await assertFails(listAll(ref(adminA(), `tenants/${A}/pagos/${PAGO}`)));
        await assertFails(listAll(ref(propietario(), `tenants/${A}/pagos/${PAGO}`)));
        await assertFails(listAll(ref(propietario(), `tenants/${A}/pagos`)));
      });

      it('nadie borra una evidencia, ni el propietario: un pago no se corrige, se compensa', async () => {
        await assertFails(deleteObject(ref(propietario(), rutaPago(A))));
        await assertFails(deleteObject(ref(adminA(), rutaPago(A))));
        await assertFails(deleteObject(ref(anonimo(), rutaPago(A))));
      });

      it('cambiar los metadatos a un tipo que no corresponde se rechaza, también para el propietario', async () => {
        await assertFails(updateMetadata(ref(propietario(), rutaPago(A)), { contentType: 'text/html' }));
        await assertFails(updateMetadata(ref(adminA(), rutaPago(A)), { customMetadata: { origen: 'consola' } }));
      });
    });
  });
});
