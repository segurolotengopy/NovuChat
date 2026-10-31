/**
 * `bloquearContacto` y `desbloquearContacto` (31/10/2026): ESCRITOS NEGANDO
 *
 * Entrada `{tenantId, conversacionId}`, salida `{bloqueada}`. Las guardas son las de tomar/devolver
 * (`atenderTurno`), con dos diferencias que esta suite fija: NO exigen `personaPuedeEscribir` y SOLO
 * el administrador del comercio bloquea (una operadora no). La compuerta en la ingesta y el conteo
 * están en `bloquear-contacto-ingesta.test.ts`. Mismo patrón que `turno-conversacion.test.ts`: Firestore
 * en el emulador, las callables con `.run`, Auth simulado que nunca debe llamarse, reloj fijo.
 * Comercios ficticios (tienda-a, tienda-b), personas ficticias y teléfonos con seis ceros.
 */
import {
  assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  addDoc as agregarDoc, collection as coleccion, deleteDoc as borrarDoc, deleteField as borrarCampo, doc as docCliente,
  setDoc as escribirDoc, updateDoc as actualizarDoc,
} from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;

const h = vi.hoisted(() => ({ getAuth: vi.fn() }));
vi.mock('firebase-admin/auth', async (importOriginal) => {
  const original = await importOriginal<typeof import('firebase-admin/auth')>();
  return { ...original, getAuth: (...a: unknown[]) => h.getAuth(...a) };
});

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const db = getFirestore();
const BLOQUEO = await import('../../functions/src/core/conversacion/bloquearContacto.ts');
const SERVIDOR = await import('../../functions/src/core/conversacion/turnoServidor.ts');

const aqui = dirname(fileURLToPath(import.meta.url));

interface Actor { uid: string; token: Record<string, unknown> }
function actor(uid: string, nc: Record<string, unknown>, opciones: { proveedor?: string } = {}): Actor {
  return {
    uid,
    token: { nc: { v: 1, ...nc }, firebase: { sign_in_provider: opciones.proveedor ?? 'password', identities: {} }, email_verified: true },
  };
}
const admin = (t: string, uid = `u-admin-${t}`) => actor(uid, { t: { [t]: 'admin' } });
const oper = (t: string, uid = `u-oper-${t}`) => actor(uid, { t: { [t]: 'oper' } });
const propietario = () => actor('u-propietario', { t: {}, p: true }, { proveedor: 'google.com' });

type Callable = { run: (r: unknown) => Promise<unknown> };
const BLOQUEAR = BLOQUEO.bloquearContacto as unknown as Callable;
const DESBLOQUEAR = BLOQUEO.desbloquearContacto as unknown as Callable;
const llamarA = (c: Callable, data: unknown, a?: Actor) =>
  c.run({ data, auth: a ? { uid: a.uid, token: a.token } : undefined, rawRequest: {} });
const bloquear = (data: unknown, a?: Actor) => llamarA(BLOQUEAR, data, a);
const desbloquear = (data: unknown, a?: Actor) => llamarA(DESBLOQUEAR, data, a);

interface ErrorLeido { code: string; message: string }
async function rechazo(p: Promise<unknown>): Promise<ErrorLeido> {
  try { await p; } catch (e) { const x = e as ErrorLeido; return { code: x.code, message: x.message }; }
  throw new Error('la callable NO rechazó');
}

const A = 'tienda-a';
const OTRO = 'tienda-b';
const TODOS = [A, OTRO, 'tienda-susp', 'tienda-clasica', 'bellido', 'consultorio-bellido', 'sonda-bloqueo'];
const TEL1 = '59100000001';
const CONV1 = `wa_${TEL1}`;
const AHORA = Date.UTC(2026, 9, 31, 15, 0, 0);
const ts = (ms: number) => Timestamp.fromMillis(ms);
const DATOS = { tenantId: A, conversacionId: CONV1 };
const FIJOS = {
  sinPermiso: 'No tiene permiso para atender esta conversación.',
  noHabilitado: 'Esta función no está habilitada para su comercio.',
  noExiste: 'La conversación no existe.',
  invalida: 'Solicitud inválida.',
  tope: 'Alcanzó el tope de cambios de atención por hora o por día.',
};

async function ficha(t: string, o: Record<string, unknown> = {}) {
  await db.doc(`tenants/${t}`).set({ nombre: t, estado: 'activo', consolaConversaciones: 'nueva', ...o });
}
async function conversacion(t: string, id: string, o: Record<string, unknown> = {}) {
  await db.doc(`tenants/${t}/conversaciones/${id}`).set({
    telefono: id.slice(3), canal: 'whatsapp', nombreContacto: 'Cliente', ultimoMensaje: 'Hola', mensajesTotal: 3,
    mensajesVentana: 2, atencionEstado: 'normal', noLeidos: 1, sinLeer: true, ...o,
  });
}
const leerConv = async (t: string, id: string) => (await db.doc(`tenants/${t}/conversaciones/${id}`).get()).data() ?? {};
const auditorias = async (t: string) => (await db.collection(`tenants/${t}/auditoria`).get()).docs.map((d) => d.data());
const hayEscrituras = async () => {
  const tope = (await db.collection('topesDeTurno').get()).size;
  const aud = (await Promise.all(TODOS.map(async (t) => (await db.collection(`tenants/${t}/auditoria`).get()).size))).reduce((x, y) => x + y, 0);
  return { tope, aud };
};

beforeAll(async () => { await db.doc('tenants/sonda-bloqueo').get(); }, 60_000);
beforeEach(async () => {
  vi.useRealTimers();
  for (const t of TODOS) await db.recursiveDelete(db.doc(`tenants/${t}`));
  for (const d of await db.collection('topesDeTurno').listDocuments()) await d.delete();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(AHORA));
  await ficha(A); // SIN `personaPuedeEscribir`: bloquear no la exige
  await ficha(OTRO);
  await conversacion(A, CONV1);
  h.getAuth.mockReset();
  h.getAuth.mockImplementation(() => { throw new Error('bloquear NO debe mirar Auth'); });
  for (const nivel of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, nivel).mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('bloquear: el camino feliz', () => {
  it('el administrador bloquea, SIN `personaPuedeEscribir`: salida, campos y auditoría exactos', async () => {
    const r = await bloquear(DATOS, admin(A));
    expect(r).toEqual({ bloqueada: true });
    const d = await leerConv(A, CONV1);
    expect(d['bloqueada']).toBe(true);
    expect(d['bloqueadaPor']).toBe(`u-admin-${A}`);
    expect(d['bloqueadaEn']).toEqual(ts(AHORA));
    expect(await auditorias(A)).toEqual([{
      accion: 'bloquear_contacto', uid: `u-admin-${A}`, en: ts(AHORA), rol: 'admin', telefono4: '0001', resultado: 'ok',
    }]);
    expect(JSON.stringify(await auditorias(A))).not.toContain(TEL1);
  });

  it('solo escribe los tres campos nuevos: ni `turno`, ni conteo, ni umbrales, ni lectura, ni `noContactar`', async () => {
    const antes = await leerConv(A, CONV1);
    await bloquear(DATOS, admin(A));
    const { bloqueada: _b, bloqueadaPor: _p, bloqueadaEn: _e, ...resto } = await leerConv(A, CONV1);
    expect(resto).toEqual(antes);
  });

  it('el servidor ignora las claves de más: ni una ruta, ni un uid, ni un `bloqueada:false` del cliente', async () => {
    await conversacion(OTRO, CONV1);
    await bloquear({ ...DATOS, ruta: `tenants/${OTRO}/conversaciones/${CONV1}`, uid: 'u-otro', rol: 'admin', bloqueada: false, bloqueadaPor: 'u-x' }, admin(A));
    expect((await leerConv(A, CONV1))['bloqueadaPor']).toBe(`u-admin-${A}`);
    expect((await leerConv(OTRO, CONV1))['bloqueada']).toBeUndefined();
  });

  it('es IDEMPOTENTE: bloquear lo ya bloqueado no escribe ni audita, y no cambia quién ni cuándo', async () => {
    await bloquear(DATOS, admin(A, 'u-admin-1'));
    vi.setSystemTime(new Date(AHORA + 3_600_000));
    expect(await bloquear(DATOS, admin(A, 'u-admin-2'))).toEqual({ bloqueada: true });
    const d = await leerConv(A, CONV1);
    expect(d['bloqueadaPor']).toBe('u-admin-1');
    expect(d['bloqueadaEn']).toEqual(ts(AHORA));
    expect((await auditorias(A)).length).toBe(1);
  });

  it('NO mira Auth', async () => {
    await bloquear(DATOS, admin(A)); await desbloquear(DATOS, admin(A));
    expect(h.getAuth).not.toHaveBeenCalled();
  });
});

describe('desbloquear: restaura todo', () => {
  beforeEach(async () => { await bloquear(DATOS, admin(A)); vi.setSystemTime(new Date(AHORA + 60_000)); });

  it('borra los tres campos, deja el resto igual y audita `desbloquear_contacto`', async () => {
    const bloqueada = await leerConv(A, CONV1);
    expect(await desbloquear(DATOS, admin(A))).toEqual({ bloqueada: false });
    const d = await leerConv(A, CONV1);
    expect(d).not.toHaveProperty('bloqueada');
    expect(d).not.toHaveProperty('bloqueadaPor');
    expect(d).not.toHaveProperty('bloqueadaEn');
    const { bloqueada: _b, bloqueadaPor: _p, bloqueadaEn: _e, ...resto } = bloqueada;
    expect(d).toEqual(resto);
    const aud = (await auditorias(A)).filter((x) => x['accion'] === 'desbloquear_contacto');
    expect(aud).toEqual([{ accion: 'desbloquear_contacto', uid: `u-admin-${A}`, en: ts(AHORA + 60_000), rol: 'admin', telefono4: '0001', resultado: 'ok' }]);
  });

  it('es IDEMPOTENTE: desbloquear lo que no está bloqueado no escribe ni audita', async () => {
    await desbloquear(DATOS, admin(A));
    expect(await desbloquear(DATOS, admin(A))).toEqual({ bloqueada: false });
    expect((await auditorias(A)).filter((x) => x['accion'] === 'desbloquear_contacto').length).toBe(1);
  });

  it('y se puede volver a bloquear', async () => {
    await desbloquear(DATOS, admin(A));
    expect(await bloquear(DATOS, admin(A))).toEqual({ bloqueada: true });
    expect((await auditorias(A)).map((x) => x['accion'])).toEqual(expect.arrayContaining(['bloquear_contacto', 'desbloquear_contacto']));
  });
});

const TOMAR = await import('../../functions/src/core/conversacion/tomarConversacion.ts');
const DEVOLVER = await import('../../functions/src/core/conversacion/devolverConversacion.ts');
const MSG_BLOQUEADO = 'Este contacto está bloqueado. Desbloquéelo para atenderlo.';
const turnoVigente = (uid = 'u-ana') => ({ responde: 'persona', tomadoPor: uid, tomadoEn: ts(AHORA - 5 * 60_000), actividadPersonaEn: ts(AHORA - 60_000) });

describe('convivencia con tomar y devolver', () => {
  it('NEGATIVA: tomar una conversación bloqueada se rechaza (failed-precondition) y no escribe turno, tope de más ni auditoría', async () => {
    await ficha(A, { personaPuedeEscribir: true });
    await conversacion(A, CONV1, { ultimoEntranteEn: ts(AHORA - 3_600_000), bloqueada: true, bloqueadaPor: 'u-admin', bloqueadaEn: ts(AHORA) });
    expect(await rechazo(llamarA(TOMAR.tomarConversacion as unknown as Callable, DATOS, oper(A, 'u-ana')))).toEqual({ code: 'failed-precondition', message: MSG_BLOQUEADO });
    expect((await leerConv(A, CONV1))['turno']).toBeUndefined();
    expect((await hayEscrituras()).aud).toBe(0);
  });

  it('NEGATIVA: bloquear con un turno de persona VIGENTE se rechaza y no escribe; vencido o devuelto, sí bloquea', async () => {
    await conversacion(A, CONV1, { ultimoEntranteEn: ts(AHORA - 3_600_000), turno: turnoVigente() });
    expect(await rechazo(bloquear(DATOS, admin(A)))).toEqual({ code: 'failed-precondition', message: 'Devuelva la conversación antes de bloquear el contacto.' });
    expect((await leerConv(A, CONV1))['bloqueada']).toBeUndefined();
    expect((await hayEscrituras()).aud).toBe(0);
    // vencido por inactividad (31 min): ya no es vigente
    await conversacion(A, CONV1, { ultimoEntranteEn: ts(AHORA - 3_600_000), turno: { ...turnoVigente(), actividadPersonaEn: ts(AHORA - 31 * 60_000) } });
    expect(await bloquear(DATOS, admin(A))).toEqual({ bloqueada: true });
  });

  it('devolver sigue permitido: devolver y después bloquear', async () => {
    await ficha(A, { personaPuedeEscribir: true });
    await conversacion(A, CONV1, { ultimoEntranteEn: ts(AHORA - 3_600_000), turno: turnoVigente() });
    await llamarA(DEVOLVER.devolverConversacion as unknown as Callable, DATOS, oper(A, 'u-ana'));
    expect(await bloquear(DATOS, admin(A))).toEqual({ bloqueada: true });
    // y devolver con la conversación ya bloqueada tampoco se rechaza
    await expect(llamarA(DEVOLVER.devolverConversacion as unknown as Callable, DATOS, admin(A))).resolves.toBeDefined();
  });
});

describe('NEGATIVAS: quién NO bloquea ni desbloquea (y no se escribe nada)', () => {
  const nada = async () => {
    expect((await leerConv(A, CONV1))['bloqueada']).toBeUndefined();
    expect((await hayEscrituras()).aud).toBe(0);
  };

  it('sin sesión: unauthenticated', async () => {
    expect((await rechazo(bloquear(DATOS))).code).toBe('unauthenticated');
    await nada();
  });

  it('una operadora del mismo comercio NO bloquea (solo el administrador)', async () => {
    expect(await rechazo(bloquear(DATOS, oper(A)))).toEqual({ code: 'permission-denied', message: FIJOS.sinPermiso });
    await nada();
  });

  it('una operadora tampoco desbloquea', async () => {
    await bloquear(DATOS, admin(A));
    expect(await rechazo(desbloquear(DATOS, oper(A)))).toEqual({ code: 'permission-denied', message: FIJOS.sinPermiso });
    expect((await leerConv(A, CONV1))['bloqueada']).toBe(true);
  });

  it('el administrador de OTRO comercio no bloquea lo ajeno, ni con la conversación existiendo allí', async () => {
    expect(await rechazo(bloquear(DATOS, admin(OTRO)))).toEqual({ code: 'permission-denied', message: FIJOS.sinPermiso });
    await nada();
  });

  it('un administrador de dos comercios bloquea en el pedido, no en el otro', async () => {
    await conversacion(OTRO, CONV1);
    const dos = actor('u-dos', { t: { [A]: 'admin', [OTRO]: 'oper' } });
    expect((await rechazo(bloquear({ tenantId: OTRO, conversacionId: CONV1 }, dos))).code).toBe('permission-denied');
    expect((await leerConv(OTRO, CONV1))['bloqueada']).toBeUndefined();
    expect(await bloquear(DATOS, dos)).toEqual({ bloqueada: true });
  });

  it('el propietario de NovuChat (soporte) no bloquea', async () => {
    expect((await rechazo(bloquear(DATOS, propietario()))).code).toBe('permission-denied');
    await nada();
  });

  it('Bellido (con la bandera encendida) y su variante: denegado', async () => {
    for (const id of ['bellido', 'consultorio-bellido']) {
      await ficha(id); await conversacion(id, CONV1);
      expect(await rechazo(bloquear({ tenantId: id, conversacionId: CONV1 }, admin(id)))).toEqual({ code: 'permission-denied', message: FIJOS.noHabilitado });
      expect((await leerConv(id, CONV1))['bloqueada']).toBeUndefined();
    }
  });

  it('consola vieja (`clasica` o sin bandera): denegado por habilitación', async () => {
    for (const consola of [undefined, 'clasica']) {
      await db.doc(`tenants/${A}`).set({ nombre: A, estado: 'activo', ...(consola ? { consolaConversaciones: consola } : {}) });
      expect(await rechazo(bloquear(DATOS, admin(A))), String(consola)).toEqual({ code: 'permission-denied', message: FIJOS.noHabilitado });
    }
    await nada();
  });

  it('comercio suspendido: denegado', async () => {
    await ficha('tienda-susp', { estado: 'suspendido' }); await conversacion('tienda-susp', CONV1);
    expect((await rechazo(bloquear({ tenantId: 'tienda-susp', conversacionId: CONV1 }, admin('tienda-susp')))).code).toBe('permission-denied');
  });

  it('id de conversación mal formado o ausente: solicitud inválida; conversación inexistente: not-found', async () => {
    for (const malo of [undefined, 'wa_1', `x${TEL1}`, 7, `wa_${TEL1}/../x`]) {
      expect(await rechazo(bloquear({ tenantId: A, conversacionId: malo }, admin(A))), String(malo)).toEqual({ code: 'invalid-argument', message: FIJOS.invalida });
    }
    expect(await rechazo(bloquear({ tenantId: A, conversacionId: 'wa_59100000099' }, admin(A)))).toEqual({ code: 'not-found', message: FIJOS.noExiste });
    expect((await db.doc(`tenants/${A}/conversaciones/wa_59100000099`).get()).exists).toBe(false); // no la crea
  });

  it('el tope por usuario aplica: pasado el cupo de la hora, resource-exhausted y nada se escribe', async () => {
    const a = admin(A);
    for (let i = 0; i < SERVIDOR.TOPE_DE_TURNO_POR_HORA; i++) await bloquear(DATOS, a);
    expect(await rechazo(bloquear(DATOS, a))).toEqual({ code: 'resource-exhausted', message: FIJOS.tope });
  });
});

describe('las reglas de Firestore: el navegador no escribe `bloqueada` (la negación está en las reglas)', () => {
  let entorno: RulesTestEnvironment;
  beforeAll(async () => {
    vi.useRealTimers();
    entorno = await initializeTestEnvironment({
      projectId: PROYECTO,
      firestore: { rules: readFileSync(join(aqui, '..', '..', 'firestore.rules'), 'utf8'), host: '127.0.0.1', port: Number(process.env['FIRESTORE_EMULATOR_PORT'] ?? 8231) },
    });
  }, 60_000);
  beforeEach(async () => {
    vi.useRealTimers();
    await entorno.withSecurityRulesDisabled(async (ctx) => {
      await escribirDoc(docCliente(ctx.firestore(), 'tenants/tienda-a'), { nombre: 'A', estado: 'activo', consolaConversaciones: 'nueva' });
      await escribirDoc(docCliente(ctx.firestore(), `tenants/tienda-a/conversaciones/${CONV1}`), { telefono: TEL1, canal: 'whatsapp', notaInterna: '' });
      await escribirDoc(docCliente(ctx.firestore(), `tenants/tienda-a/conversaciones/wa_59100000002`), {
        telefono: '59100000002', canal: 'whatsapp', bloqueada: true, bloqueadaPor: 'u-admin-tienda-a',
      });
    });
  });
  afterAll(async () => { await entorno?.cleanup(); });

  const claimsDe = (nc: Record<string, unknown>, proveedor = 'password') => ({
    nc: { v: 1, ...nc }, firebase: { sign_in_provider: proveedor, identities: {} }, email_verified: true,
  });
  const contextos = () => [
    ['administrador de A', entorno.authenticatedContext('u-admin-tienda-a', claimsDe({ t: { 'tienda-a': 'admin' } })).firestore()],
    ['operador de A', entorno.authenticatedContext('u-oper-tienda-a', claimsDe({ t: { 'tienda-a': 'oper' } })).firestore()],
    ['propietario de NovuChat', entorno.authenticatedContext('u-propietario', claimsDe({ t: {}, p: true }, 'google.com')).firestore()],
    ['sin sesión', entorno.unauthenticatedContext().firestore()],
  ] as const;
  const niega = async (quien: string, accion: string, p: Promise<unknown>) => {
    try { await assertFails(p); } catch (e) { throw new Error(`${quien}: pudo ${accion} (${String(e)})`); }
  };

  it('NEGATIVA: nadie, desde el navegador, bloquea, falsifica quién/cuándo ni desbloquea', async () => {
    for (const [quien, fs] of contextos()) {
      const libre = docCliente(fs, `tenants/tienda-a/conversaciones/${CONV1}`);
      const puesta = docCliente(fs, 'tenants/tienda-a/conversaciones/wa_59100000002');
      await niega(quien, 'bloquear a mano', actualizarDoc(libre, { bloqueada: true }));
      await niega(quien, 'bloquear con quién y cuándo', actualizarDoc(libre, { bloqueada: true, bloqueadaPor: 'u-x', bloqueadaEn: new Date() }));
      await niega(quien, 'escribir solo quién', actualizarDoc(libre, { bloqueadaPor: 'u-x' }));
      await niega(quien, 'desbloquear a mano', actualizarDoc(puesta, { bloqueada: false }));
      await niega(quien, 'borrar el bloqueo', actualizarDoc(puesta, { bloqueada: borrarCampo() }));
      await niega(quien, 'cambiar quién bloqueó', actualizarDoc(puesta, { bloqueadaPor: 'u-x' }));
      await niega(quien, 'crear la conversación ya bloqueada', escribirDoc(docCliente(fs, 'tenants/tienda-a/conversaciones/wa_59100000003'), { telefono: '59100000003', canal: 'whatsapp', bloqueada: true }));
    }
  });

  it('control positivo: la misma persona SÍ escribe un campo de gestión sobre una conversación bloqueada (si no, lo de arriba no prueba nada)', async () => {
    const fs = entorno.authenticatedContext('u-oper-tienda-a', claimsDe({ t: { 'tienda-a': 'oper' } })).firestore();
    await assertSucceeds(actualizarDoc(docCliente(fs, 'tenants/tienda-a/conversaciones/wa_59100000002'), { notaInterna: 'spam' }));
  });

  it('NEGATIVA: la ingesta (token custom de n8n) tampoco crea ni cambia `bloqueada`, pero sí actualiza el resumen de una bloqueada', async () => {
    const fs = entorno.authenticatedContext('ingesta-a', claimsDe({ t: { 'tienda-a': 'ingesta' } }, 'custom')).firestore();
    const puesta = docCliente(fs, 'tenants/tienda-a/conversaciones/wa_59100000002');
    await niega('ingesta', 'desbloquear', actualizarDoc(puesta, { bloqueada: false }));
    await niega('ingesta', 'borrar el bloqueo', actualizarDoc(puesta, { bloqueada: borrarCampo() }));
    await niega('ingesta', 'bloquear', actualizarDoc(docCliente(fs, `tenants/tienda-a/conversaciones/${CONV1}`), { bloqueada: true }));
    await niega('ingesta', 'crear bloqueada', escribirDoc(docCliente(fs, 'tenants/tienda-a/conversaciones/wa_59100000004'), { telefono: '59100000004', canal: 'whatsapp', bloqueada: true }));
    await assertSucceeds(actualizarDoc(puesta, { ultimoMensaje: 'hola' }));
  });

  it('NEGATIVA: nadie crea auditoría `bloquear_contacto` desde el cliente', async () => {
    for (const [quien, fs] of contextos()) {
      await niega(quien, 'crear una auditoría', agregarDoc(coleccion(fs, 'tenants/tienda-a/auditoria'), { accion: 'bloquear_contacto', uid: 'u-x' }));
      await niega(quien, 'borrar la conversación bloqueada', borrarDoc(docCliente(fs, 'tenants/tienda-a/conversaciones/wa_59100000002')));
    }
  });
});

describe('el despliegue y lo que el código NO hace', () => {
  it('las dos callables salen en us-east1, con 5 instancias y concurrencia 10 fuera de staging, y el índice las exporta', () => {
    for (const c of [BLOQUEO.bloquearContacto, BLOQUEO.desbloquearContacto]) {
      const e = (c as unknown as { __endpoint: Record<string, unknown> }).__endpoint;
      expect(e['region']).toEqual(['us-east1']);
      expect(e['maxInstances']).toBe(5);
      expect(e['concurrency']).toBe(10);
    }
    const indice = readFileSync(join(aqui, '..', '..', 'functions', 'src', 'index.ts'), 'utf8');
    expect(indice).toContain("export { bloquearContacto, desbloquearContacto } from './core/conversacion/bloquearContacto.js';");
  });

  it('el código no envía nada ni toca el conteo: sin fetch, sin campos de facturación, sin `turno`', () => {
    const c = readFileSync(join(aqui, '..', '..', 'functions', 'src', 'core', 'conversacion', 'bloquearContacto.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(c).not.toMatch(/fetch\(|https?:\/\/|mensajesVentana|atencionEstado|atencionDesde|periodoContado|respuestasDelPeriodo|noContactar|personaPuedeEscribir|turno:/);
  });
});
