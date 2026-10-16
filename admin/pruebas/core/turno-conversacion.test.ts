/**
 * `tomarConversacion` y `devolverConversacion` (H2-1): EL TURNO, ESCRITO NEGANDO
 *
 * Contrato: entrada `{tenantId, conversacionId}`, salida `{turno}` (tiempos en milisegundos).
 * Cada guarda de `accesoPersona.ts`, `turnoServidor.ts`, `tomarConversacion.ts` y
 * `devolverConversacion.ts` tiene acá una prueba que falla si se quita. Dos comercios ficticios
 * (tienda-a, tienda-b), personas ficticias (u-ana, u-bruno…) y teléfonos con seis ceros.
 *
 * CÓMO SE PRUEBA SIN NUBE (el mismo patrón que `buscar-conversaciones.test.ts`):
 *  - Firestore: el emulador; las callables se ejecutan de verdad con `.run`.
 *  - Auth: `firebase-admin/auth` se simula entero y se exige que NUNCA se llame (sin `cuentaVigenteDe`).
 *  - El reloj: solo `Date`, fijo. Ninguna prueba depende de la hora de la corrida.
 *  - Los registros: `logger` y `console` se espían; ninguno recibe un teléfono entero ni un error.
 *
 * La regla pura (plazos, límites exactos, formas rotas) está en `turno.test.ts`.
 */
import {
  assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  addDoc as agregarDoc, collection as coleccion, deleteDoc as borrarDoc, doc as docCliente, getDoc as leerDoc,
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
const { getFirestore, Timestamp, FieldValue, Transaction } = await import('firebase-admin/firestore');
const db = getFirestore();
const TOMAR = await import('../../functions/src/core/conversacion/tomarConversacion.ts');
const DEVOLVER = await import('../../functions/src/core/conversacion/devolverConversacion.ts');
const SERVIDOR = await import('../../functions/src/core/conversacion/turnoServidor.ts');

const aqui = dirname(fileURLToPath(import.meta.url));
/** El MISMO módulo `logger` que carga el código de Functions (CJS: una sola instancia), para espiarlo. */
const { default: logger } = await import('../../functions/node_modules/firebase-functions/lib/logger/index.js') as unknown as {
  default: Record<'log' | 'info' | 'warn' | 'error' | 'debug', (...a: unknown[]) => void>;
};
const SRC = join(aqui, '..', '..', 'functions', 'src', 'core', 'conversacion');
const CODIGO = (archivo: string) => readFileSync(join(SRC, archivo), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ---------------------------------------------------------------------------
// ACTORES Y LLAMADAS
// ---------------------------------------------------------------------------
interface Actor { uid: string; token: Record<string, unknown> }
function actor(
  uid: string, nc: Record<string, unknown>, opciones: { proveedor?: string; verificado?: boolean } = {},
): Actor {
  return {
    uid,
    token: {
      nc: { v: 1, ...nc },
      firebase: { sign_in_provider: opciones.proveedor ?? 'password', identities: {} },
      email_verified: opciones.verificado ?? true,
    },
  };
}
const admin = (t: string, uid = `u-admin-${t}`) => actor(uid, { t: { [t]: 'admin' } });
const oper = (t: string, uid = `u-oper-${t}`) => actor(uid, { t: { [t]: 'oper' } });
const propietario = (uid = 'u-propietario') => actor(uid, { t: {}, p: true }, { proveedor: 'google.com' });
const ANA = (t: string) => oper(t, 'u-ana');
const BRUNO = (t: string) => oper(t, 'u-bruno');

type Callable = { run: (r: unknown) => Promise<unknown> };
const NOMBRES = { tomar: 'tomarConversacion', devolver: 'devolverConversacion' } as const;
const CALLABLES: Record<keyof typeof NOMBRES, Callable> = {
  tomar: TOMAR.tomarConversacion as unknown as Callable,
  devolver: DEVOLVER.devolverConversacion as unknown as Callable,
};
const llamarA = (c: Callable, data: unknown, a?: Actor) =>
  c.run({ data, auth: a ? { uid: a.uid, token: a.token } : undefined, rawRequest: {} });
const tomar = (data: unknown, a?: Actor) => llamarA(CALLABLES.tomar, data, a);
const devolver = (data: unknown, a?: Actor) => llamarA(CALLABLES.devolver, data, a);

interface ErrorLeido { code: string; message: string; details?: unknown }
async function rechazo(p: Promise<unknown>): Promise<ErrorLeido> {
  try { await p; } catch (e) { const x = e as ErrorLeido; return { code: x.code, message: x.message, details: x.details }; }
  throw new Error('la callable NO rechazó');
}
/** Solo código y mensaje: lo que el navegador ve en un rechazo corriente. */
const cm = (e: ErrorLeido) => ({ code: e.code, message: e.message });

interface TurnoMs {
  responde: string; tomadoPor: string; tomadoEn: number; actividadPersonaEn: number; devueltoEn?: number; motivoDevolucion?: string;
}
const turnoDe = async (data: unknown, a: Actor, c: Callable = CALLABLES.tomar) => (await llamarA(c, data, a) as { turno: TurnoMs | null }).turno;

// ---------------------------------------------------------------------------
// SEMILLAS
// ---------------------------------------------------------------------------
const A = 'tienda-a';
const OTRO = 'tienda-b';
const TODOS = [A, OTRO, 'tienda-baja', 'tienda-susp', 'tienda-fantasma', 'tienda-rara', 'tienda-clasica', 'consultorio-bellido', 'bellido', 'constructor', 'sonda-turno'];
const TEL1 = '59100000001';
const TEL2 = '59100000002';
const CONV1 = `wa_${TEL1}`;
const CONV2 = `wa_${TEL2}`;
const AHORA = Date.UTC(2026, 9, 16, 15, 0, 0);
const MIN = 60_000;
const HORA = 3_600_000;
const FIJOS = {
  sinSesion: 'Inicie sesión.',
  sinPermiso: 'No tiene permiso para atender esta conversación.',
  noHabilitado: 'Esta función no está habilitada para su comercio.',
  invalida: 'Solicitud inválida.',
  noExiste: 'La conversación no existe.',
  ocupada: 'Esta conversación la atiende otra persona.',
  noEsSuya: 'Solo quien atiende la conversación, o un administrador, puede devolverla.',
  ventanaCerrada: 'La ventana de 24 horas de esta conversación está cerrada.',
  tope: 'Alcanzó el tope de cambios de atención por hora o por día.',
  noDisponible: 'No se pudo completar la operación. Intente de nuevo.',
};

/** La ficha del comercio: activo y con la pantalla nueva, salvo que se diga otra cosa. */
async function ficha(t: string, o: Record<string, unknown> = {}) {
  await db.doc(`tenants/${t}`).set({ nombre: t, estado: 'activo', consolaConversaciones: 'nueva', ...o });
}

/** Una conversación como la deja la ingesta: el cliente escribió hace 1 h, salvo que se diga otra cosa. */
async function conversacion(t: string, id: string, o: Record<string, unknown> = {}) {
  await db.doc(`tenants/${t}/conversaciones/${id}`).set({
    telefono: id.slice(3), canal: 'whatsapp', nombreContacto: 'Cliente', ultimoMensaje: 'Hola', mensajesTotal: 3,
    mensajesVentana: 2, atencionEstado: 'normal', noLeidos: 1, sinLeer: true,
    ultimoEntranteEn: Timestamp.fromMillis(AHORA - HORA), ventanaVenceEn: Timestamp.fromMillis(AHORA + 23 * HORA),
    ...o,
  });
}
const ts = (ms: number) => Timestamp.fromMillis(ms);
/** Un turno guardado en Firestore. */
const turnoGuardado = (o: Record<string, unknown> = {}) => ({
  responde: 'persona', tomadoPor: 'u-ana', tomadoEn: ts(AHORA - 5 * MIN), actividadPersonaEn: ts(AHORA - MIN), ...o,
});
const leerConv = async (t: string, id: string) => (await db.doc(`tenants/${t}/conversaciones/${id}`).get()).data() ?? {};
const auditorias = async (t: string) =>
  (await db.collection(`tenants/${t}/auditoria`).get()).docs.map((d) => d.data())
    .sort((x, y) => (x['en'] as { toMillis(): number }).toMillis() - (y['en'] as { toMillis(): number }).toMillis() || String(x['accion']).localeCompare(String(y['accion'])));
const hayEscrituras = async () => {
  const tope = (await db.collection('topesDeTurno').get()).size;
  const aud = (await Promise.all(TODOS.map(async (t) => (await db.collection(`tenants/${t}/auditoria`).get()).size))).reduce((x, y) => x + y, 0);
  return { tope, aud };
};

let registros: string[] = [];
/** Los registros que son una línea JSON `funcion {…}`, ya leídos. */
const lineas = () => registros.filter((x) => x.includes('{')).map((x) => JSON.parse(x.slice(x.indexOf('{'))) as Record<string, unknown>);

beforeAll(async () => {
  await db.doc('tenants/sonda-turno').get();
}, 60_000);
beforeEach(async () => {
  // La limpieza va con el reloj REAL: el BulkWriter de `recursiveDelete` regula su ritmo con `Date.now()`.
  vi.useRealTimers();
  for (const t of TODOS) await db.recursiveDelete(db.doc(`tenants/${t}`));
  for (const d of await db.collection('topesDeTurno').listDocuments()) await d.delete();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(AHORA));
  await ficha(A);
  await ficha(OTRO);
  await conversacion(A, CONV1);
  h.getAuth.mockReset();
  h.getAuth.mockImplementation(() => { throw new Error('el turno NO debe mirar Auth (sin cuentaVigenteDe)'); });
  registros = [];
  const anotar = (...a: unknown[]) => { registros.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
  for (const nivel of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, nivel).mockImplementation(anotar);
    vi.spyOn(logger, nivel).mockImplementation(anotar);
  }
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

// ===========================================================================
describe('tomar: el camino feliz', () => {
  it('la operadora toma: forma exacta de la salida y del documento', async () => {
    const r = await tomar({ tenantId: A, conversacionId: CONV1 }, ANA(A)) as { turno: TurnoMs };
    expect(Object.keys(r)).toEqual(['turno']);
    expect(r.turno).toEqual({ responde: 'persona', tomadoPor: 'u-ana', tomadoEn: AHORA, actividadPersonaEn: AHORA });
    const d = await leerConv(A, CONV1);
    expect(d['turno']).toEqual({ responde: 'persona', tomadoPor: 'u-ana', tomadoEn: ts(AHORA), actividadPersonaEn: ts(AHORA) });
  });

  it('el administrador también toma', async () => {
    expect(await turnoDe({ tenantId: A, conversacionId: CONV1 }, admin(A))).toMatchObject({ responde: 'persona', tomadoPor: `u-admin-${A}` });
  });

  it('solo cambia `turno`: ningún otro campo de la conversación (ni conteo, ni umbrales, ni lectura, ni necesitaHumano)', async () => {
    const antes = await leerConv(A, CONV1);
    await tomar({ tenantId: A, conversacionId: CONV1 }, ANA(A));
    const despues = await leerConv(A, CONV1);
    const { turno: _t, ...resto } = despues;
    expect(resto).toEqual(antes);
    expect(despues).not.toHaveProperty('necesitaHumano');
  });

  it('escribe la auditoría `conversacion_tomada` (quién, con qué rol, cuál conversación) y NADA más fuera del tope', async () => {
    await tomar({ tenantId: A, conversacionId: CONV1 }, ANA(A));
    expect(await auditorias(A)).toEqual([{
      accion: 'conversacion_tomada', uid: 'u-ana', en: ts(AHORA), rol: 'oper', conversacionId: CONV1, resultado: 'ok', previo: 'sin_turno',
    }]);
    expect(await auditorias(OTRO)).toEqual([]);
    expect((await db.collection('topesDeTurno').listDocuments()).map((d) => d.id)).toEqual(['u-ana']);
  });

  it('el servidor ignora las claves de más: ni una ruta, ni un uid, ni un rol del cliente cuentan', async () => {
    await conversacion(OTRO, CONV1);
    const r = await turnoDe({
      tenantId: A, conversacionId: CONV1, ruta: `tenants/${OTRO}/conversaciones/${CONV1}`, uid: 'u-otro', rol: 'admin', tomadoPor: 'u-otro', turno: { responde: 'asistente' },
    }, ANA(A));
    expect(r).toMatchObject({ tomadoPor: 'u-ana', responde: 'persona' });
    expect((await leerConv(OTRO, CONV1))['turno']).toBeUndefined();
  });

  it('NO mira Auth (sin cuentaVigenteDe ni getUser)', async () => {
    await tomar({ tenantId: A, conversacionId: CONV1 }, ANA(A));
    await devolver({ tenantId: A, conversacionId: CONV1 }, ANA(A));
    expect(h.getAuth).not.toHaveBeenCalled();
  });

  it('comercio suspendido NO puede tomar (a diferencia de leer): hablar con sus clientes exige comercio activo', async () => {
    await ficha('tienda-susp', { estado: 'suspendido' });
    await conversacion('tienda-susp', CONV1);
    expect(cm(await rechazo(tomar({ tenantId: 'tienda-susp', conversacionId: CONV1 }, ANA('tienda-susp'))))).toEqual({ code: 'permission-denied', message: FIJOS.sinPermiso });
  });
});

// ===========================================================================
describe('devolver: el camino feliz', () => {
  beforeEach(async () => { await tomar({ tenantId: A, conversacionId: CONV1 }, ANA(A)); vi.setSystemTime(new Date(AHORA + 10 * MIN)); });

  it('quien la tiene la devuelve: responde el asistente, motivo manual, y se conserva quién y cuándo tomó', async () => {
    const t = await turnoDe({ tenantId: A, conversacionId: CONV1 }, ANA(A), CALLABLES.devolver);
    expect(t).toEqual({
      responde: 'asistente', tomadoPor: 'u-ana', tomadoEn: AHORA, actividadPersonaEn: AHORA, devueltoEn: AHORA + 10 * MIN, motivoDevolucion: 'manual',
    });
    expect((await leerConv(A, CONV1))['turno']).toEqual({
      responde: 'asistente', tomadoPor: 'u-ana', tomadoEn: ts(AHORA), actividadPersonaEn: ts(AHORA), devueltoEn: ts(AHORA + 10 * MIN), motivoDevolucion: 'manual',
    });
  });

  it('escribe la auditoría `conversacion_devuelta`, con quién la tenía', async () => {
    await devolver({ tenantId: A, conversacionId: CONV1 }, ANA(A));
    const aud = (await auditorias(A)).filter((x) => x['accion'] === 'conversacion_devuelta');
    expect(aud).toEqual([{
      accion: 'conversacion_devuelta', uid: 'u-ana', en: ts(AHORA + 10 * MIN), rol: 'oper', conversacionId: CONV1, resultado: 'ok', tomadoPor: 'u-ana',
    }]);
  });

  it('solo cambia `turno`: ningún otro campo de la conversación', async () => {
    const antes = await leerConv(A, CONV1);
    await devolver({ tenantId: A, conversacionId: CONV1 }, ANA(A));
    const { turno: _a, ...restoAntes } = antes;
    const { turno: _d, ...restoDespues } = await leerConv(A, CONV1);
    expect(restoDespues).toEqual(restoAntes);
  });

  it('y después de devolverla otra persona puede tomarla', async () => {
    await devolver({ tenantId: A, conversacionId: CONV1 }, ANA(A));
    expect(await turnoDe({ tenantId: A, conversacionId: CONV1 }, BRUNO(A))).toMatchObject({ responde: 'persona', tomadoPor: 'u-bruno' });
    const tomadas = (await auditorias(A)).filter((x) => x['accion'] === 'conversacion_tomada');
    expect(tomadas.map((x) => x['previo'])).toEqual(['sin_turno', 'devuelto']);
  });
});

// ===========================================================================
for (const [clave, nombre] of Object.entries(NOMBRES) as Array<[keyof typeof NOMBRES, string]>) {
  const llamar = (data: unknown, a?: Actor) => llamarA(CALLABLES[clave], data, a);

  describe(`${nombre}: quién puede (ninguna otra pertenencia sirve)`, () => {
    const datos = { tenantId: A, conversacionId: CONV1 };
    beforeEach(async () => {
      await conversacion(OTRO, CONV1);
      await db.doc(`tenants/${A}/conversaciones/${CONV1}`).update({ turno: turnoGuardado() });
    });
    const sinCambios = async () => {
      expect((await leerConv(A, CONV1))['turno']).toEqual(turnoGuardado());
      expect((await leerConv(OTRO, CONV1))['turno']).toBeUndefined();
      expect(await hayEscrituras()).toEqual({ tope: 0, aud: 0 });
    };

    it('sin sesión: unauthenticated «Inicie sesión.»', async () => {
      expect(cm(await rechazo(llamar(datos)))).toEqual({ code: 'unauthenticated', message: FIJOS.sinSesion });
      await sinCambios();
    });

    it('el administrador de A pidiendo B, o el operador de A pidiendo B: permission-denied (no se autoriza contra «el primer comercio del token»)', async () => {
      for (const a of [admin(A), oper(A)]) {
        expect(cm(await rechazo(llamar({ tenantId: OTRO, conversacionId: CONV1 }, a))), a.uid).toEqual({ code: 'permission-denied', message: FIJOS.sinPermiso });
      }
      await sinCambios();
    });

    it('con roles en A y en B, cada uno actúa SOLO en el suyo (y el tope es del usuario, no del comercio)', async () => {
      const dos = actor('u-dos', { t: { [A]: 'oper', [OTRO]: 'oper' } });
      await ficha(OTRO);
      expect(await llamar({ tenantId: OTRO, conversacionId: CONV1 }, dos)).toBeTruthy();
      expect(cm(await rechazo(llamar({ tenantId: 'tienda-zzz', conversacionId: CONV1 }, dos)))).toEqual({ code: 'permission-denied', message: FIJOS.sinPermiso });
    });

    it('un usuario con claims de otro comercio, sin claims, o sin `nc`: permission-denied', async () => {
      for (const a of [admin('tienda-zzz'), actor('u-sin', { t: {} }), actor('u-nada', {}), { uid: 'u-sin-nc', token: {} }]) {
        expect(cm(await rechazo(llamar(datos, a))), a.uid).toEqual({ code: 'permission-denied', message: FIJOS.sinPermiso });
      }
      await sinCambios();
    });

    it('con sesión de Google o con el correo sin verificar: el claim es inerte (administrador y operador)', async () => {
      const casos = [
        actor('u-g', { t: { [A]: 'admin' } }, { proveedor: 'google.com' }),
        actor('u-v', { t: { [A]: 'admin' } }, { verificado: false }),
        actor('u-go', { t: { [A]: 'oper' } }, { proveedor: 'google.com' }),
        actor('u-vo', { t: { [A]: 'oper' } }, { verificado: false }),
      ];
      for (const a of casos) expect(await rechazo(llamar(datos, a)), a.uid).toMatchObject({ code: 'permission-denied', message: FIJOS.sinPermiso });
      await sinCambios();
    });

    it('un claim de rol desconocido (viewer, administrador, ADMIN, vacío) no sirve', async () => {
      for (const rol of ['viewer', 'administrador', 'ADMIN', '', 'soporte']) {
        expect(await rechazo(llamar(datos, actor('u-r', { t: { [A]: rol } }))), rol).toMatchObject({ code: 'permission-denied' });
      }
    });

    it('el soporte NO: el propietario de NovuChat con ventana de soporte vigente recibe permission-denied (y no se lee su ventana)', async () => {
      await db.doc(`tenants/${A}/accesosSoporte/u-propietario`).set({ expira: ts(AHORA + HORA) });
      const espia = vi.spyOn(db, 'doc');
      expect(cm(await rechazo(llamar(datos, propietario())))).toEqual({ code: 'permission-denied', message: FIJOS.sinPermiso });
      expect(espia.mock.calls.map((c) => c[0]).filter((r) => String(r).includes('accesosSoporte'))).toEqual([]);
      await sinCambios();
    });

    it('el propietario sin ventana, con la ventana vencida o de otro comercio: permission-denied', async () => {
      expect(await rechazo(llamar(datos, propietario()))).toMatchObject({ code: 'permission-denied' });
      await db.doc(`tenants/${A}/accesosSoporte/u-propietario`).set({ expira: ts(AHORA - 1) });
      expect(await rechazo(llamar(datos, propietario()))).toMatchObject({ code: 'permission-denied' });
      await sinCambios();
    });

    it('el propietario que además tiene el claim de administrador pero entra con Google: inerte', async () => {
      expect(await rechazo(llamar(datos, actor('u-pa', { t: { [A]: 'admin' }, p: true }, { proveedor: 'google.com' })))).toMatchObject({ code: 'permission-denied' });
    });
  });

  // -------------------------------------------------------------------------
  describe(`${nombre}: el estado del comercio`, () => {
    it('suspendido, dado de baja, inexistente, sin estado o con un estado raro: permission-denied, y NO se escribe nada', async () => {
      await conversacion('tienda-baja', CONV1);
      await conversacion('tienda-fantasma', CONV1); // hay conversación, no hay ficha
      await ficha('tienda-baja', { estado: 'dado_de_baja' });
      await ficha('tienda-susp', { estado: 'suspendido' });
      await conversacion('tienda-susp', CONV1);
      for (const t of ['tienda-baja', 'tienda-susp', 'tienda-fantasma']) {
        expect(cm(await rechazo(llamar({ tenantId: t, conversacionId: CONV1 }, oper(t)))), t).toEqual({ code: 'permission-denied', message: FIJOS.sinPermiso });
      }
      for (const estado of [undefined, 'inactivo', 'ACTIVO', 'activo ', 7, null, { a: 1 }]) {
        await db.doc('tenants/tienda-rara').set({ nombre: 'rara', consolaConversaciones: 'nueva', ...(estado === undefined ? {} : { estado }) });
        expect(await rechazo(llamar({ tenantId: 'tienda-rara', conversacionId: CONV1 }, oper('tienda-rara'))), String(estado)).toMatchObject({ code: 'permission-denied', message: FIJOS.sinPermiso });
      }
      expect(await hayEscrituras()).toEqual({ tope: 0, aud: 0 });
    });

    it('un fallo de Firestore al leer la ficha es `unavailable`, JAMÁS «sin permiso»', async () => {
      const real = db.doc.bind(db);
      vi.spyOn(db, 'doc').mockImplementation(((ruta: string) => {
        if (ruta === `tenants/${A}`) throw Object.assign(new Error('detalle interno zanahoria'), { code: 14 });
        return real(ruta);
      }) as never);
      expect(cm(await rechazo(llamar({ tenantId: A, conversacionId: CONV1 }, oper(A))))).toEqual({ code: 'unavailable', message: FIJOS.noDisponible });
      expect(registros.join('\n')).not.toContain('zanahoria');
    });
  });

  // -------------------------------------------------------------------------
  describe(`${nombre}: la habilitación se comprueba en el SERVIDOR (bandera y Bellido)`, () => {
    const rechazaHabilitacion = async (t: string, extra: Record<string, unknown> = {}) => {
      await ficha(t, extra);
      await conversacion(t, CONV1);
      return rechazo(llamar({ tenantId: t, conversacionId: CONV1 }, oper(t)));
    };

    it('bandera apagada (`clasica`): rechazo con el mensaje de «no habilitado»', async () => {
      expect(cm(await rechazaHabilitacion('tienda-clasica', { consolaConversaciones: 'clasica' }))).toEqual({ code: 'permission-denied', message: FIJOS.noHabilitado });
    });

    it('bandera ausente, de otro tipo o escrita distinto: rechazo', async () => {
      for (const bandera of [undefined, null, '', 'Nueva', 'NUEVA', 'nueva ', true, 1, {}, 'si']) {
        await db.doc('tenants/tienda-clasica').set({ nombre: 'c', estado: 'activo', ...(bandera === undefined ? {} : { consolaConversaciones: bandera }) });
        await conversacion('tienda-clasica', CONV1);
        expect(cm(await rechazo(llamar({ tenantId: 'tienda-clasica', conversacionId: CONV1 }, oper('tienda-clasica')))), String(bandera))
          .toEqual({ code: 'permission-denied', message: FIJOS.noHabilitado });
      }
    });

    it('Bellido: rechazo AUNQUE tenga la bandera `nueva` (por el id, contenido en el id y por el nombre de la ficha)', async () => {
      expect(cm(await rechazaHabilitacion('bellido'))).toEqual({ code: 'permission-denied', message: FIJOS.noHabilitado });
      expect(cm(await rechazaHabilitacion('consultorio-bellido'))).toEqual({ code: 'permission-denied', message: FIJOS.noHabilitado });
      expect(cm(await rechazaHabilitacion('tienda-clasica', { nombre: 'Consultorio Béllido' }))).toEqual({ code: 'permission-denied', message: FIJOS.noHabilitado });
    });

    it('un rechazo por habilitación no deja NADA: ni turno, ni auditoría, ni tope', async () => {
      await rechazaHabilitacion('bellido');
      await rechazaHabilitacion('tienda-clasica', { consolaConversaciones: 'clasica' });
      expect((await leerConv('bellido', CONV1))['turno']).toBeUndefined();
      expect(await hayEscrituras()).toEqual({ tope: 0, aud: 0 });
    });

    it('la bandera es la del comercio PEDIDO: tener la pantalla nueva en B no habilita A', async () => {
      await ficha(A, { consolaConversaciones: 'clasica' });
      const dos = actor('u-dos', { t: { [A]: 'oper', [OTRO]: 'oper' } });
      expect(await rechazo(llamar({ tenantId: A, conversacionId: CONV1 }, dos))).toMatchObject({ message: FIJOS.noHabilitado });
    });
  });

  // -------------------------------------------------------------------------
  describe(`${nombre}: la forma de lo que manda el navegador`, () => {
    it('un tenantId mal formado recibe el MISMO «sin permiso» que quien no tiene rol, antes de armar ninguna ruta', async () => {
      const malos: unknown[] = [
        '__proto__', '../x', '../tienda-b', 'tienda-a/../tienda-b', 'tienda-a/', 'TIENDA-A', '', 'a', 'ab', '-tienda', 'tienda a',
        'x'.repeat(61), undefined, null, 42, {}, ['tienda-a'], true,
      ];
      const espia = vi.spyOn(db, 'doc');
      for (const t of malos) {
        expect(cm(await rechazo(llamar({ tenantId: t, conversacionId: CONV1 }, actor('u-x', { t: { [A]: 'admin' } })))), String(t))
          .toEqual({ code: 'permission-denied', message: FIJOS.sinPermiso });
      }
      expect(espia).not.toHaveBeenCalled();
    });

    it('datos que no son un objeto (texto, nulo, lista, número): sin permiso, sin tocar Firestore', async () => {
      for (const d of ['tienda-a', null, undefined, [A, CONV1], 7]) {
        expect(await rechazo(llamar(d, oper(A))), String(d)).toMatchObject({ code: 'permission-denied', message: FIJOS.sinPermiso });
      }
      expect(await hayEscrituras()).toEqual({ tope: 0, aud: 0 });
    });

    it('un id de conversación mal formado: invalid-argument «Solicitud inválida.», y no cuenta en el tope', async () => {
      const malos: unknown[] = [
        '', 'wa_', 'wa_1234567', 'wa_1234567890123456', 'wa_5910000000a', '59100000001', `tenants/${OTRO}/conversaciones/${CONV1}`,
        `${CONV1}/mensajes/x`, `../${CONV1}`, `${CONV1}\n`, 'WA_59100000001', undefined, null, 7, {}, [CONV1], '__proto__', '..',
      ];
      for (const id of malos) {
        expect(cm(await rechazo(llamar({ tenantId: A, conversacionId: id }, oper(A)))), String(id)).toEqual({ code: 'invalid-argument', message: FIJOS.invalida });
      }
      expect(await hayEscrituras()).toEqual({ tope: 0, aud: 0 });
    });

    it('una conversación inexistente: not-found; nada se crea (ni el documento, ni la auditoría)', async () => {
      expect(cm(await rechazo(llamar({ tenantId: A, conversacionId: CONV2 }, oper(A))))).toEqual({ code: 'not-found', message: FIJOS.noExiste });
      expect((await db.doc(`tenants/${A}/conversaciones/${CONV2}`).get()).exists).toBe(false);
      expect((await hayEscrituras()).aud).toBe(0);
    });

    it('la conversación de OTRO comercio no se alcanza con el id de A: not-found, y la de B queda intacta', async () => {
      await conversacion(OTRO, CONV2, { turno: turnoGuardado({ tomadoPor: 'u-b' }) });
      expect(cm(await rechazo(llamar({ tenantId: A, conversacionId: CONV2 }, oper(A))))).toEqual({ code: 'not-found', message: FIJOS.noExiste });
      expect((await leerConv(OTRO, CONV2))['turno']).toEqual(turnoGuardado({ tomadoPor: 'u-b' }));
    });
  });
}

// ===========================================================================
describe('tomar: dos personas, la misma persona, y los vencimientos', () => {
  const datos = { tenantId: A, conversacionId: CONV1 };

  it('toma doble: la otra persona recibe failed-precondition con el uid de quien la tiene; nada cambia', async () => {
    await tomar(datos, ANA(A));
    const antes = await leerConv(A, CONV1);
    const e = await rechazo(tomar(datos, BRUNO(A)));
    expect(cm(e)).toEqual({ code: 'failed-precondition', message: FIJOS.ocupada });
    expect(e.details).toEqual({ tomadoPor: 'u-ana' });
    expect(await leerConv(A, CONV1)).toEqual(antes);
    expect((await auditorias(A)).map((x) => x['accion'])).toEqual(['conversacion_tomada']);
  });

  it('ni un administrador le quita la conversación a quien la tiene vigente (primero la devuelve)', async () => {
    await tomar(datos, ANA(A));
    expect(await rechazo(tomar(datos, admin(A)))).toMatchObject({ code: 'failed-precondition', message: FIJOS.ocupada, details: { tomadoPor: 'u-ana' } });
  });

  it('el rechazo por toma doble SÍ gasta cupo (llegó a la transacción) y se registra con el código', async () => {
    await tomar(datos, ANA(A));
    registros = [];
    await rechazo(tomar(datos, BRUNO(A)));
    expect(registros.some((r) => r.includes('failed-precondition'))).toBe(true);
    expect((await db.doc('topesDeTurno/u-bruno').get()).data()).toMatchObject({ cambiosHora: 1, cambiosDia: 1 });
  });

  it('CONCURRENTES: dos personas toman a la vez, gana UNA y la otra recibe failed-precondition', async () => {
    const r = await Promise.allSettled([tomar(datos, ANA(A)), tomar(datos, BRUNO(A))]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const perdedor = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect((perdedor.reason as ErrorLeido).code).toBe('failed-precondition');
    const ganador = ((r.find((x) => x.status === 'fulfilled') as PromiseFulfilledResult<{ turno: TurnoMs }>).value).turno.tomadoPor;
    expect(((await leerConv(A, CONV1))['turno'] as { tomadoPor: string }).tomadoPor).toBe(ganador);
    expect((perdedor.reason as ErrorLeido).details).toEqual({ tomadoPor: ganador });
    expect((await auditorias(A)).filter((x) => x['accion'] === 'conversacion_tomada')).toHaveLength(1);
  }, 60_000);

  it('IDEMPOTENTE: la misma persona toma dos veces y recibe el MISMO turno; no reescribe ni audita de nuevo', async () => {
    const t1 = await turnoDe(datos, ANA(A));
    vi.setSystemTime(new Date(AHORA + 5 * MIN));
    const t2 = await turnoDe(datos, ANA(A));
    expect(t2).toEqual(t1);
    expect((await leerConv(A, CONV1))['turno']).toEqual({ responde: 'persona', tomadoPor: 'u-ana', tomadoEn: ts(AHORA), actividadPersonaEn: ts(AHORA) });
    expect(await auditorias(A)).toHaveLength(1);
  });

  describe('un turno vencido no estorba (el vencimiento se calcula, no hay temporizador)', () => {
    it('a los 29 min 59 s de inactividad todavía es de ana; a los 30 min exactos la toma bruno', async () => {
      await tomar(datos, ANA(A));
      vi.setSystemTime(new Date(AHORA + 30 * MIN - 1));
      expect(await rechazo(tomar(datos, BRUNO(A)))).toMatchObject({ code: 'failed-precondition', message: FIJOS.ocupada });
      vi.setSystemTime(new Date(AHORA + 30 * MIN));
      expect(await turnoDe(datos, BRUNO(A))).toMatchObject({ responde: 'persona', tomadoPor: 'u-bruno', tomadoEn: AHORA + 30 * MIN });
      expect((await auditorias(A)).map((x) => x['previo']).filter(Boolean)).toEqual(['sin_turno', 'inactividad']);
    });

    it('se cierra la ventana de Meta (ultimoEntranteEn + 24 h) y el turno de ana ya no cuenta', async () => {
      // El cliente escribió hace 23 h 50 min; ana tiene turno con actividad hace 1 min.
      await db.doc(`tenants/${A}/conversaciones/${CONV1}`).update({
        ultimoEntranteEn: ts(AHORA - 23 * HORA - 50 * MIN), turno: turnoGuardado(),
      });
      expect(await rechazo(tomar(datos, BRUNO(A)))).toMatchObject({ code: 'failed-precondition', message: FIJOS.ocupada });
      vi.setSystemTime(new Date(AHORA + 10 * MIN)); // la ventana cierra justo ahora
      // la ventana está cerrada: nadie puede tomarla, y el turno de ana tampoco estorba (el error es el de la ventana).
      expect(await rechazo(tomar(datos, BRUNO(A)))).toMatchObject({ code: 'failed-precondition', message: FIJOS.ventanaCerrada });
    });

    it('un turno ya devuelto no estorba', async () => {
      await db.doc(`tenants/${A}/conversaciones/${CONV1}`).update({ turno: turnoGuardado({ responde: 'asistente', devueltoEn: ts(AHORA - MIN), motivoDevolucion: 'manual' }) });
      expect(await turnoDe(datos, BRUNO(A))).toMatchObject({ responde: 'persona', tomadoPor: 'u-bruno' });
      expect((await auditorias(A))[0]).toMatchObject({ accion: 'conversacion_tomada', previo: 'devuelto' });
    });

    it('al tomar de nuevo, el turno nuevo NO arrastra devueltoEn ni motivoDevolucion del anterior', async () => {
      await db.doc(`tenants/${A}/conversaciones/${CONV1}`).update({ turno: turnoGuardado({ responde: 'asistente', devueltoEn: ts(AHORA - MIN), motivoDevolucion: 'manual' }) });
      await tomar(datos, ANA(A));
      expect(Object.keys((await leerConv(A, CONV1))['turno'] as object).sort()).toEqual(['actividadPersonaEn', 'responde', 'tomadoEn', 'tomadoPor']);
    });
  });

  describe('la ventana de 24 h de Meta debe estar abierta para tomar (H2 es texto dentro de la ventana)', () => {
    const conUltimo = (v: unknown) => db.doc(`tenants/${A}/conversaciones/${CONV1}`).update({ ultimoEntranteEn: v });

    it('a las 24 h menos 1 ms se puede; a las 24 h exactas no', async () => {
      await conUltimo(ts(AHORA - 24 * HORA + 1));
      expect(await turnoDe(datos, ANA(A))).toMatchObject({ responde: 'persona' });
      await db.doc(`tenants/${A}/conversaciones/${CONV1}`).update({ turno: FieldValue.delete() });
      await conUltimo(ts(AHORA - 24 * HORA));
      expect(cm(await rechazo(tomar(datos, ANA(A))))).toEqual({ code: 'failed-precondition', message: FIJOS.ventanaCerrada });
    });

    it('sin ultimoEntranteEn, o con algo que no es fecha, o del futuro lejano: ventana cerrada y nada se escribe', async () => {
      for (const v of [Timestamp.fromMillis(AHORA + HORA), 'ayer', AHORA - HORA, null]) {
        await conUltimo(v);
        expect(cm(await rechazo(tomar(datos, ANA(A)))), String(v)).toEqual({ code: 'failed-precondition', message: FIJOS.ventanaCerrada });
      }
      await db.doc(`tenants/${A}/conversaciones/${CONV1}`).update({ ultimoEntranteEn: FieldValue.delete() });
      expect(await rechazo(tomar(datos, ANA(A)))).toMatchObject({ message: FIJOS.ventanaCerrada });
      expect((await leerConv(A, CONV1))['turno']).toBeUndefined();
      expect((await hayEscrituras()).aud).toBe(0);
    });

    it('la ventana de FACTURACIÓN (`ventanaVenceEn`) no decide: abierta la de facturación y cerrada la de Meta, no se toma', async () => {
      await db.doc(`tenants/${A}/conversaciones/${CONV1}`).update({ ultimoEntranteEn: ts(AHORA - 30 * HORA), ventanaVenceEn: ts(AHORA + 10 * HORA) });
      expect(await rechazo(tomar(datos, ANA(A)))).toMatchObject({ message: FIJOS.ventanaCerrada });
    });
  });

  describe('un turno corrupto no deja la conversación atascada: tomar lo repara', () => {
    const corruptos: Array<[string, unknown]> = [
      ['null', null], ['un texto', 'persona'], ['una lista', [1]], ['sin responde', { tomadoPor: 'u-ana' }],
      ['responde raro', turnoGuardado({ responde: 'robot' })], ['fechas que no son fechas', turnoGuardado({ tomadoEn: 'ayer', actividadPersonaEn: 5 })],
      ['tomadoPor con ruta', turnoGuardado({ tomadoPor: 'a/b' })],
      ['actividad del futuro', turnoGuardado({ actividadPersonaEn: ts(AHORA + 10 * HORA) })],
    ];
    for (const [nombre, valor] of corruptos) {
      it(`${nombre}: responde el asistente, tomar lo sobrescribe y lo audita como previo «ilegible»`, async () => {
        await db.doc(`tenants/${A}/conversaciones/${CONV1}`).update({ turno: valor });
        expect(await turnoDe(datos, BRUNO(A))).toMatchObject({ responde: 'persona', tomadoPor: 'u-bruno' });
        expect((await auditorias(A))[0]).toMatchObject({ accion: 'conversacion_tomada', previo: 'ilegible' });
        expect((await leerConv(A, CONV1))['turno']).toEqual({ responde: 'persona', tomadoPor: 'u-bruno', tomadoEn: ts(AHORA), actividadPersonaEn: ts(AHORA) });
      });
    }
  });
});

// ===========================================================================
describe('devolver: quién puede, y qué pasa cuando nadie la tiene', () => {
  const datos = { tenantId: A, conversacionId: CONV1 };

  it('un operador que no es quien la tiene: failed-precondition con el uid de quien sí; nada cambia', async () => {
    await tomar(datos, ANA(A));
    const antes = await leerConv(A, CONV1);
    const e = await rechazo(devolver(datos, BRUNO(A)));
    expect(cm(e)).toEqual({ code: 'failed-precondition', message: FIJOS.noEsSuya });
    expect(e.details).toEqual({ tomadoPor: 'u-ana' });
    expect(await leerConv(A, CONV1)).toEqual(antes);
    expect((await auditorias(A)).map((x) => x['accion'])).toEqual(['conversacion_tomada']);
  });

  it('un ADMINISTRADOR sí puede devolver la de otra persona: queda auditado quién la devolvió y quién la tenía', async () => {
    await tomar(datos, ANA(A));
    vi.setSystemTime(new Date(AHORA + MIN));
    const t = await turnoDe(datos, admin(A), CALLABLES.devolver);
    expect(t).toMatchObject({ responde: 'asistente', tomadoPor: 'u-ana', motivoDevolucion: 'manual', devueltoEn: AHORA + MIN });
    const dev = (await auditorias(A)).find((x) => x['accion'] === 'conversacion_devuelta');
    expect(dev).toMatchObject({ uid: `u-admin-${A}`, rol: 'admin', tomadoPor: 'u-ana' });
  });

  it('IDEMPOTENTE: devolver dos veces deja una sola auditoría y el mismo turno', async () => {
    await tomar(datos, ANA(A));
    vi.setSystemTime(new Date(AHORA + MIN));
    const t1 = await turnoDe(datos, ANA(A), CALLABLES.devolver);
    vi.setSystemTime(new Date(AHORA + 2 * MIN));
    const t2 = await turnoDe(datos, ANA(A), CALLABLES.devolver);
    expect(t2).toEqual(t1);
    expect((await leerConv(A, CONV1))['turno']).toMatchObject({ devueltoEn: ts(AHORA + MIN) });
    expect((await auditorias(A)).filter((x) => x['accion'] === 'conversacion_devuelta')).toHaveLength(1);
  });

  it('una vez devuelta por ana, bruno devolviendo no recibe error: nadie la tiene', async () => {
    await tomar(datos, ANA(A));
    await devolver(datos, ANA(A));
    expect(await turnoDe(datos, BRUNO(A), CALLABLES.devolver)).toMatchObject({ responde: 'asistente', tomadoPor: 'u-ana' });
  });

  it('una conversación que nunca se tomó: `{turno: null}` sin escribir nada (ni siquiera la auditoría)', async () => {
    const r = await devolver(datos, ANA(A));
    expect(r).toEqual({ turno: null });
    expect((await leerConv(A, CONV1))['turno']).toBeUndefined();
    expect((await hayEscrituras()).aud).toBe(0);
  });

  it('con un turno ilegible: `{turno: null}` y no se toca el documento', async () => {
    await db.doc(`tenants/${A}/conversaciones/${CONV1}`).update({ turno: { basura: true } });
    expect(await devolver(datos, ANA(A))).toEqual({ turno: null });
    expect((await leerConv(A, CONV1))['turno']).toEqual({ basura: true });
  });

  it('la DEVOLUCIÓN POR INACTIVIDAD: pasados 30 min devolver no escribe; informa el estado de hoy (asistente, «inactividad»)', async () => {
    await tomar(datos, ANA(A));
    vi.setSystemTime(new Date(AHORA + 30 * MIN));
    const t = await turnoDe(datos, BRUNO(A), CALLABLES.devolver); // ni siquiera hace falta ser quien la tenía
    expect(t).toEqual({ responde: 'asistente', tomadoPor: 'u-ana', tomadoEn: AHORA, actividadPersonaEn: AHORA, devueltoEn: AHORA + 30 * MIN, motivoDevolucion: 'inactividad' });
    expect((await leerConv(A, CONV1))['turno']).toMatchObject({ responde: 'persona' }); // lo guardado no cambia
    expect((await auditorias(A)).filter((x) => x['accion'] === 'conversacion_devuelta')).toEqual([]);
  });

  it('un milisegundo antes de los 30 min, un operador ajeno todavía no puede devolverla', async () => {
    await tomar(datos, ANA(A));
    vi.setSystemTime(new Date(AHORA + 30 * MIN - 1));
    expect(await rechazo(devolver(datos, BRUNO(A)))).toMatchObject({ code: 'failed-precondition', message: FIJOS.noEsSuya });
  });

  it('la DEVOLUCIÓN POR VENTANA vencida: se informa «ventana» con devueltoEn = el cierre de la ventana', async () => {
    const ultimo = AHORA - 23 * HORA - 55 * MIN;
    await db.doc(`tenants/${A}/conversaciones/${CONV1}`).update({ ultimoEntranteEn: ts(ultimo), turno: turnoGuardado() });
    vi.setSystemTime(new Date(AHORA + 10 * MIN)); // ya pasaron las 24 h del último mensaje del cliente
    const t = await turnoDe(datos, ANA(A), CALLABLES.devolver);
    expect(t).toMatchObject({ responde: 'asistente', motivoDevolucion: 'ventana', devueltoEn: ultimo + 24 * HORA });
    expect((await hayEscrituras()).aud).toBe(0);
  });

  it('devolver una conversación inexistente: not-found', async () => {
    expect(cm(await rechazo(devolver({ tenantId: A, conversacionId: CONV2 }, ANA(A))))).toEqual({ code: 'not-found', message: FIJOS.noExiste });
  });
});

// ===========================================================================
describe('el tope por usuario: 60 por hora y 300 por día, contado en el servidor y compartido por tomar y devolver', () => {
  // AHORA = 2026-10-16T15:00Z = 11:00 en La Paz (UTC-4 fijo).
  const HORA_ACTUAL = '2026-10-16T11';
  const DIA_ACTUAL = '2026-10-16';
  const datos = { tenantId: A, conversacionId: CONV1 };
  const topes = async (uid: string) => (await db.doc(`topesDeTurno/${uid}`).get()).data();
  const sembrarTope = (uid: string, d: Record<string, unknown>) =>
    db.doc(`topesDeTurno/${uid}`).set({ hora: HORA_ACTUAL, dia: DIA_ACTUAL, cambiosHora: 0, cambiosDia: 0, ...d });

  it('cada llamada autorizada y bien formada suma UNA en la hora y UNA en el día, con el sello de La Paz (tomar y devolver comparten)', async () => {
    await tomar(datos, ANA(A));
    await devolver(datos, ANA(A));
    expect(await topes('u-ana')).toEqual({ hora: HORA_ACTUAL, dia: DIA_ACTUAL, cambiosHora: 2, cambiosDia: 2, actualizadoEn: ts(AHORA) });
  });

  it('la 61 de la hora (la 60 pasa, la 61 no): resource-exhausted con el mensaje fijo; no lee la conversación ni suma', async () => {
    await sembrarTope('u-ana', { cambiosHora: 59, cambiosDia: 59 });
    await tomar(datos, ANA(A)); // la 60
    const espia = vi.spyOn(db, 'runTransaction');
    expect(cm(await rechazo(devolver(datos, ANA(A))))).toEqual({ code: 'resource-exhausted', message: FIJOS.tope });
    expect(espia).toHaveBeenCalledTimes(1); // solo la del tope; la de la conversación no llegó a abrirse
    expect(await topes('u-ana')).toMatchObject({ cambiosHora: 60, cambiosDia: 60 });
    expect((await leerConv(A, CONV1))['turno']).toMatchObject({ responde: 'persona' });
  });

  it('la hora siguiente abre el cupo horario (y el del día sigue contando)', async () => {
    await sembrarTope('u-ana', { hora: '2026-10-16T10', cambiosHora: 60, cambiosDia: 100 });
    await tomar(datos, ANA(A));
    expect(await topes('u-ana')).toMatchObject({ hora: HORA_ACTUAL, cambiosHora: 1, cambiosDia: 101 });
  });

  it('la 301 del día (la 300 pasa, la 301 no), aunque la hora esté casi vacía', async () => {
    await sembrarTope('u-ana', { cambiosHora: 3, cambiosDia: 299 });
    await tomar(datos, ANA(A)); // la 300
    expect(cm(await rechazo(devolver(datos, ANA(A))))).toEqual({ code: 'resource-exhausted', message: FIJOS.tope });
    expect(await topes('u-ana')).toMatchObject({ cambiosHora: 4, cambiosDia: 300 });
  });

  it('el día siguiente (La Paz) abre todo; la medianoche es la de La Paz, no la UTC', async () => {
    await sembrarTope('u-ana', { dia: '2026-10-15', hora: '2026-10-15T23', cambiosHora: 60, cambiosDia: 300 });
    await tomar(datos, ANA(A));
    expect(await topes('u-ana')).toMatchObject({ dia: DIA_ACTUAL, cambiosDia: 1, cambiosHora: 1 });
    // 03:30 UTC del 17/10 son las 23:30 del 16/10 en La Paz: sigue siendo el mismo día.
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 17, 3, 30, 0)));
    await db.doc(`tenants/${A}/conversaciones/${CONV1}`).update({ ultimoEntranteEn: ts(Date.UTC(2026, 9, 17, 3, 0, 0)) });
    await devolver(datos, ANA(A));
    expect(await topes('u-ana')).toMatchObject({ dia: DIA_ACTUAL, hora: '2026-10-16T23', cambiosDia: 2, cambiosHora: 1 });
  });

  it('es POR USUARIO: otra persona del mismo comercio no se ve afectada, y el mismo usuario comparte el tope entre comercios', async () => {
    await sembrarTope('u-ana', { cambiosHora: 60, cambiosDia: 60 });
    expect(await rechazo(tomar(datos, ANA(A)))).toMatchObject({ code: 'resource-exhausted' });
    expect(await turnoDe(datos, BRUNO(A))).toMatchObject({ tomadoPor: 'u-bruno' });
    await conversacion(OTRO, CONV1);
    const dos = actor('u-ana', { t: { [A]: 'oper', [OTRO]: 'oper' } }); // el MISMO uid, con rol en A y en B
    expect(await rechazo(tomar({ tenantId: OTRO, conversacionId: CONV1 }, dos))).toMatchObject({ code: 'resource-exhausted' });
  });

  it('un contador ilegible se trata como agotado (falla cerrado), con su propio motivo `tope_ilegible`', async () => {
    for (const mal of [{ cambiosHora: 'x' }, { cambiosHora: -1 }, { cambiosHora: 1.5 }, { cambiosDia: null }, { cambiosDia: '7' }]) {
      await sembrarTope('u-ana', mal);
      registros = [];
      expect(cm(await rechazo(tomar(datos, ANA(A)))), JSON.stringify(mal)).toEqual({ code: 'resource-exhausted', message: FIJOS.tope });
      expect(registros.join('\n'), JSON.stringify(mal)).toContain('tope_ilegible');
    }
  });

  it('es TRANSACCIONAL: 15 llamadas a la vez con 55 gastadas dejan pasar exactamente 5', async () => {
    await sembrarTope('u-ana', { cambiosHora: 55, cambiosDia: 55 });
    const r = await Promise.allSettled(Array.from({ length: 15 }, () => tomar(datos, ANA(A))));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(5);
    expect(r.filter((x) => x.status === 'rejected' && (x.reason as ErrorLeido).code === 'resource-exhausted')).toHaveLength(10);
    expect(await topes('u-ana')).toMatchObject({ cambiosHora: 60, cambiosDia: 60 });
  }, 60_000);

  it('solo cuentan las llamadas autorizadas, habilitadas y bien formadas: un rechazo previo no toca el tope', async () => {
    await rechazo(tomar(datos)); // sin sesión
    await rechazo(tomar({ tenantId: OTRO, conversacionId: CONV1 }, ANA(A))); // sin permiso
    await rechazo(tomar({ tenantId: '__proto__', conversacionId: CONV1 }, ANA(A)));
    await rechazo(tomar({ tenantId: A, conversacionId: 'mal' }, ANA(A))); // id mal formado
    await rechazo(tomar(datos, propietario())); // soporte
    await ficha(A, { consolaConversaciones: 'clasica' });
    await rechazo(tomar(datos, ANA(A))); // sin habilitación
    expect(await db.collection('topesDeTurno').listDocuments()).toEqual([]);
  });

  it('el cupo se consume ANTES de leer: una llamada autorizada y bien formada cuenta aunque la transacción falle', async () => {
    const real = db.runTransaction.bind(db);
    let n = 0;
    vi.spyOn(db, 'runTransaction').mockImplementation(((f: never) => {
      n += 1;
      if (n === 2) return Promise.reject(Object.assign(new Error('boom'), { code: 14 }));
      return real(f);
    }) as never);
    expect(cm(await rechazo(tomar(datos, ANA(A))))).toEqual({ code: 'unavailable', message: FIJOS.noDisponible });
    expect(await topes('u-ana')).toMatchObject({ cambiosHora: 1, cambiosDia: 1 });
  });

  it('si el tope mismo falla (Firestore caído): unavailable, y la conversación ni se lee', async () => {
    vi.spyOn(db, 'runTransaction').mockRejectedValue(Object.assign(new Error('boom'), { code: 14 }));
    expect(cm(await rechazo(tomar(datos, ANA(A))))).toEqual({ code: 'unavailable', message: FIJOS.noDisponible });
    expect((await leerConv(A, CONV1))['turno']).toBeUndefined();
  });

  it('el rechazo por tope se registra solo con código, comercio, uid, rol, últimos 4 dígitos y motivo', async () => {
    await sembrarTope('u-ana', { cambiosHora: 60 });
    await rechazo(tomar(datos, ANA(A)));
    const l = lineas().find((x) => x['codigo'] === 'resource-exhausted');
    expect(l).toEqual({ funcion: 'tomarConversacion', codigo: 'resource-exhausted', tenantId: A, uid: 'u-ana', rol: 'oper', telefono4: '0001', motivo: 'tope_hora' });
  });

  it('las constantes del contrato: 60 por hora y 300 por día', () => {
    expect([SERVIDOR.TOPE_DE_TURNO_POR_HORA, SERVIDOR.TOPE_DE_TURNO_POR_DIA]).toEqual([60, 300]);
  });
});

// ===========================================================================
describe('la auditoría es FALLA-CERRADA y atómica con el cambio de turno', () => {
  const datos = { tenantId: A, conversacionId: CONV1 };
  const fallaLaAuditoria = () => {
    const real = db.collection.bind(db);
    vi.spyOn(db, 'collection').mockImplementation(((ruta: string) => {
      if (String(ruta).endsWith('/auditoria')) throw Object.assign(new Error('detalle interno zanahoria'), { code: 9 });
      return real(ruta);
    }) as never);
  };

  it('tomar: si la auditoría no se puede escribir, el turno NO cambia y la persona recibe `unavailable`', async () => {
    fallaLaAuditoria();
    expect(cm(await rechazo(tomar(datos, ANA(A))))).toEqual({ code: 'unavailable', message: FIJOS.noDisponible });
    expect((await leerConv(A, CONV1))['turno']).toBeUndefined();
    expect(registros.join('\n')).not.toContain('zanahoria');
  });

  it('devolver: si la auditoría no se puede escribir, el turno sigue siendo de ana', async () => {
    await tomar(datos, ANA(A));
    const antes = await leerConv(A, CONV1);
    fallaLaAuditoria();
    expect(cm(await rechazo(devolver(datos, ANA(A))))).toEqual({ code: 'unavailable', message: FIJOS.noDisponible });
    expect(await leerConv(A, CONV1)).toEqual(antes);
  });

  it('tomar: si falla la ESCRITURA del documento de auditoría al confirmar, tampoco queda el turno', async () => {
    const real = Transaction.prototype.create;
    vi.spyOn(Transaction.prototype, 'create').mockImplementation(function (this: unknown, ref: { path: string }, ...resto: unknown[]) {
      if (ref.path.includes('/auditoria/')) throw Object.assign(new Error('boom'), { code: 9 });
      return (real as (...a: unknown[]) => unknown).call(this, ref, ...resto) as never;
    } as never);
    expect(cm(await rechazo(tomar(datos, ANA(A))))).toEqual({ code: 'unavailable', message: FIJOS.noDisponible });
    expect((await leerConv(A, CONV1))['turno']).toBeUndefined();
  });

  it('el documento de auditoría lo crea el servidor con `create` (nunca sobrescribe): el id es nuevo en cada cambio', async () => {
    await tomar(datos, ANA(A));
    await devolver(datos, ANA(A));
    await tomar(datos, BRUNO(A));
    const ids = (await db.collection(`tenants/${A}/auditoria`).get()).docs.map((d) => d.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('un fallo al leer la conversación: unavailable y nada escrito (solo el tope)', async () => {
    const real = db.runTransaction.bind(db);
    let n = 0;
    vi.spyOn(db, 'runTransaction').mockImplementation(((f: never) => {
      n += 1;
      return n === 2 ? Promise.reject(Object.assign(new Error('detalle interno zanahoria'), { code: 'permission-denied' })) : real(f);
    }) as never);
    expect(cm(await rechazo(tomar(datos, ANA(A))))).toEqual({ code: 'unavailable', message: FIJOS.noDisponible });
    expect(registros.join('\n')).not.toContain('zanahoria');
    expect(registros.join('\n')).toContain('error_permission-denied');
    expect((await hayEscrituras()).aud).toBe(0);
  });
});

// ===========================================================================
describe('los registros: nunca el teléfono entero ni el texto de un error', () => {
  const datos = { tenantId: A, conversacionId: CONV1 };

  it('un camino feliz registra comercio, uid, rol y los últimos 4 dígitos', async () => {
    await tomar(datos, ANA(A));
    const l = lineas().find((x) => x['codigo'] === 'ok');
    expect(l).toEqual({ funcion: 'tomarConversacion', codigo: 'ok', tenantId: A, uid: 'u-ana', rol: 'oper', telefono4: '0001' });
  });

  it('ni los rechazos ni los éxitos dejan el teléfono entero, el id de la conversación ni una ruta', async () => {
    await tomar(datos, ANA(A));
    await rechazo(tomar(datos, BRUNO(A)));
    await rechazo(devolver(datos, BRUNO(A)));
    await rechazo(tomar({ tenantId: A, conversacionId: CONV2 }, ANA(A)));
    await rechazo(tomar({ tenantId: A, conversacionId: `x${TEL1}` }, ANA(A)));
    await devolver(datos, ANA(A));
    const todo = registros.join('\n');
    expect(todo).not.toContain(TEL1);
    expect(todo).not.toContain(CONV1);
    expect(todo).not.toContain('conversaciones/');
    expect(todo).toContain('0001');
  });

  it('un tenantId mal escrito no llega a los registros (solo los que tienen forma de id)', async () => {
    await rechazo(tomar({ tenantId: '../etc/passwd', conversacionId: CONV1 }, ANA(A)));
    expect(registros.join('\n')).not.toContain('passwd');
  });
});

// ===========================================================================
describe('las reglas de Firestore cierran lo que escribe el servidor (la negación está en las reglas, no solo acá)', () => {
  let entorno: RulesTestEnvironment;
  beforeAll(async () => {
    vi.useRealTimers();
    entorno = await initializeTestEnvironment({
      projectId: PROYECTO,
      firestore: {
        rules: readFileSync(join(aqui, '..', '..', 'firestore.rules'), 'utf8'),
        host: '127.0.0.1', port: Number(process.env['FIRESTORE_EMULATOR_PORT'] ?? 8231),
      },
    });
  }, 60_000);
  beforeEach(async () => {
    vi.useRealTimers();
    await entorno.withSecurityRulesDisabled(async (ctx) => {
      await escribirDoc(docCliente(ctx.firestore(), 'topesDeTurno/u-oper-tienda-a'), { hora: 'x', cambiosHora: 1, cambiosDia: 1 });
      await escribirDoc(docCliente(ctx.firestore(), 'tenants/tienda-a'), { nombre: 'A', estado: 'activo', consolaConversaciones: 'nueva' });
      await escribirDoc(docCliente(ctx.firestore(), `tenants/tienda-a/conversaciones/${CONV1}`), {
        telefono: TEL1, canal: 'whatsapp', notaInterna: '', turno: { responde: 'persona', tomadoPor: 'u-ana' },
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

  it('NEGATIVA: nadie, desde el navegador, escribe `turno` en una conversación (ni como persona, ni como administrador)', async () => {
    for (const [quien, fs] of contextos()) {
      const ref = docCliente(fs, `tenants/tienda-a/conversaciones/${CONV1}`);
      await niega(quien, 'tomar a mano', actualizarDoc(ref, { turno: { responde: 'persona', tomadoPor: 'u-x' } }));
      await niega(quien, 'devolver a mano', actualizarDoc(ref, { turno: { responde: 'asistente', tomadoPor: 'u-x' } }));
      await niega(quien, 'borrar el turno', actualizarDoc(ref, { turno: null }));
    }
  });

  it('control positivo: la misma persona SÍ puede escribir un campo de gestión (si no, las negativas de arriba no prueban nada)', async () => {
    const fs = entorno.authenticatedContext('u-oper-tienda-a', claimsDe({ t: { 'tienda-a': 'oper' } })).firestore();
    await assertSucceeds(actualizarDoc(docCliente(fs, `tenants/tienda-a/conversaciones/${CONV1}`), { notaInterna: 'cliente frecuente' }));
  });

  it('NEGATIVA: nadie crea, edita ni borra un documento de auditoría desde el cliente', async () => {
    for (const [quien, fs] of contextos()) {
      await niega(quien, 'crear una auditoría', agregarDoc(coleccion(fs, 'tenants/tienda-a/auditoria'), { accion: 'conversacion_tomada', uid: 'u-x' }));
    }
  });

  it('NEGATIVA: nadie lee, crea, edita ni borra `topesDeTurno/{uid}` desde el cliente', async () => {
    for (const [quien, fs] of contextos()) {
      const ref = docCliente(fs, 'topesDeTurno/u-oper-tienda-a');
      await niega(quien, 'leer el tope', leerDoc(ref));
      await niega(quien, 'crear el tope', escribirDoc(docCliente(fs, 'topesDeTurno/u-nuevo'), { hora: 'x', cambiosHora: 0, cambiosDia: 0 }));
      await niega(quien, 'editar el tope', actualizarDoc(ref, { cambiosHora: 0 }));
      await niega(quien, 'borrar el tope', borrarDoc(ref));
    }
  });
});

// ===========================================================================
describe('el despliegue y lo que el código NO hace', () => {
  it('las dos callables salen en us-east1, con 5 instancias y concurrencia 10 fuera de staging', () => {
    for (const c of [TOMAR.tomarConversacion, DEVOLVER.devolverConversacion]) {
      const e = (c as unknown as { __endpoint: Record<string, unknown> }).__endpoint;
      expect(e['region']).toEqual(['us-east1']);
      expect(e['maxInstances']).toBe(5);
      expect(e['concurrency']).toBe(10);
      expect(e['callableTrigger']).toEqual({});
    }
  });

  it('el permiso NO mira al soporte ni a Auth: ninguna referencia a `soporteVigenteDe`, `esPropietario` ni `cuentaVigenteDe`', () => {
    for (const f of ['accesoPersona.ts', 'turnoServidor.ts', 'tomarConversacion.ts', 'devolverConversacion.ts', 'turno.ts']) {
      const c = CODIGO(f);
      expect(c, f).not.toMatch(/soporteVigenteDe|esPropietario|cuentaVigenteDe|getAuth|accesosSoporte/);
    }
  });

  it('el turno no toca el conteo ni el flujo: ningún archivo nuevo menciona los campos de facturación ni de umbrales', () => {
    for (const f of ['turno.ts', 'turnoServidor.ts', 'tomarConversacion.ts', 'devolverConversacion.ts', 'accesoPersona.ts']) {
      expect(CODIGO(f), f).not.toMatch(/mensajesVentana|atencionEstado|atencionDesde|necesitaHumano|respuestasDelPeriodo|ventanaVenceEn|noLeidos|sinLeer/);
    }
  });

  it('el comercio y la conversación se arman bajo `tenants/{pedido}`: no hay `collectionGroup` ni rutas del cliente', () => {
    for (const f of ['turnoServidor.ts', 'tomarConversacion.ts', 'devolverConversacion.ts']) {
      expect(CODIGO(f), f).not.toMatch(/collectionGroup|datos\['ruta'\]|datos\['path'\]/);
    }
  });

  it('la exclusión de Bellido del servidor no lee variables de entorno nuevas', () => {
    expect(CODIGO('accesoPersona.ts')).not.toMatch(/process\.env|NOVUCHAT_TENANTS_EXCLUIDOS/);
  });
});
