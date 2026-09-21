/**
 * LA COBRANZA DEL PREPAGO (`functions/src/cobranza.ts`), contra el emulador.
 *
 *  - Solo el número de NovuChat (ruta `onboarding`) puede preguntar y marcar:
 *    el número de un comercio recibe 403.
 *  - La lista trae solo comercios CON modalidad; nunca una demostración.
 *  - PRUEBA recibe solo el aviso de conversión.
 *  - Sin `telefonosPago` el comercio va en `sinTelefono`.
 *  - Marcar va ANTES de enviar: la segunda llamada contesta `repetido`, y
 *    el recordatorio marcado deja de aparecer en la lista.
 *  - Fuera de las 09:00-19:00 de Bolivia la lista vuelve vacía.
 *  - Sin TCO vigente no sale ningún recordatorio con importe.
 *
 * El reloj se congela sobre `Date` (los recordatorios son por día).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
const TOKEN = 'valor-de-prueba-del-prepago';
process.env['INGESTA_CLIENTE16'] = TOKEN;

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const db = getFirestore();
const { recordatoriosPrepago, recordatorioPrepagoEnviado, telefonosPagoDe, enHorarioDeEnvio } =
  await import('../functions/src/cobranza.ts');
const { limitesDe } = await import('../functions/src/planes.ts');

const NOVUCHAT = 'novuchat-cobranza';
const NUMERO_NOVUCHAT = '1000000096';
const NUMERO_COMERCIO = '1000000089';
const HORA = 3_600_000;
const bo = (y: number, m: number, d: number, h = 0, mi = 0) => Date.UTC(y, m - 1, d, h, mi) + 4 * HORA;
/** 28 de octubre de 2026, 10:00 de Bolivia: D-5 de noviembre, en horario. */
const OCT_28 = bo(2026, 10, 28, 10);
const NOV_5 = bo(2026, 11, 5, 10);

const TENANTS = {
  demo: 'cob-demo', prueba: 'cob-prueba', prepago: 'cob-prepago', sinTel: 'cob-sin-tel', cortado: 'cob-cortado',
} as const;

interface Respuesta { codigo: number; cuerpo: Record<string, unknown> }

async function llamar(fn: unknown, cuerpo: Record<string, unknown>, numero = NUMERO_NOVUCHAT): Promise<Respuesta> {
  const cabeceras: Record<string, string> = {
    'x-novuchat-numero': numero, authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json',
  };
  const leer = (n: string) => cabeceras[n.toLowerCase()];
  const peticion = {
    method: 'POST', body: cuerpo, rawBody: Buffer.from(JSON.stringify(cuerpo)),
    headers: cabeceras, get: leer, header: leer,
  };
  const r: Respuesta = { codigo: 0, cuerpo: {} };
  const respuesta = {
    status(c: number) { r.codigo = c; return respuesta; },
    send(b: unknown) { r.cuerpo = { texto: b }; return respuesta; },
    json(b: unknown) { r.cuerpo = b as Record<string, unknown>; return respuesta; },
    setHeader() { return respuesta; },
    getHeader() { return undefined; },
    set() { return respuesta; },
    on() { return respuesta; },
    end() { return respuesta; },
  };
  await (fn as (q: unknown, s: unknown) => Promise<void>)(peticion, respuesta);
  return r;
}
const listar = () => llamar(recordatoriosPrepago, {});
const marcar = (tenantId: string, clave: string) => llamar(recordatorioPrepagoEnviado, { tenantId, clave });

interface Fila { tenantId: string; telefono: string; telefonos: string[]; clave: string; tipo: string; plantilla: string; parametros: string[] }
const filas = (r: Respuesta) => r.cuerpo['recordatorios'] as Fila[];
const deTenant = (r: Respuesta, t: string) => filas(r).filter((f) => f.tenantId === t);
const bitacora = async (t: string) =>
  (await db.collection(`tenants/${t}/bitacora`).where('tipo', '==', 'plantilla_enviada').get()).docs.map((d) => d.data());
const tipoCambio = (fecha: string) => db.doc('plataforma/tipoCambio').set({ tco: 12.6, fecha, fuente: 'BCB' });

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(OCT_28);
  await db.doc(`rutasWhatsApp/${NUMERO_NOVUCHAT}`).set({ tenantId: NOVUCHAT, flujo: 'onboarding', aliasSecreto: 'cliente16', estado: 'activo' });
  await db.doc(`rutasWhatsApp/${NUMERO_COMERCIO}`).set({ tenantId: TENANTS.prepago, flujo: 'agendamiento', aliasSecreto: 'cliente16', estado: 'activo' });
  await db.doc(`tenants/${NOVUCHAT}`).set({ nombre: 'NovuChat', estado: 'activo', plan: 'demostracion' });
  await tipoCambio('2026-10-27');

  const crecimiento = { plan: 'crecimiento', limites: limitesDe('crecimiento') };
  await db.doc(`tenants/${TENANTS.demo}`).set({ nombre: 'Demo', estado: 'activo', plan: 'crecimiento' });
  await db.doc(`tenants/${TENANTS.demo}/cuenta/estado`).set({ ...crecimiento, telefonosPago: ['59170000001'] });
  await db.doc(`tenants/${TENANTS.prueba}`).set({ nombre: 'Prueba', estado: 'activo', plan: 'impulso' });
  await db.doc(`tenants/${TENANTS.prueba}/cuenta/estado`).set({
    plan: 'impulso', limites: limitesDe('impulso'), modalidad: 'prueba', periodoPrueba: '2026-10', bolsaPrueba: 9,
    telefonosPago: ['59170000002'],
  });
  await db.doc(`tenants/${TENANTS.prepago}`).set({ nombre: 'Prepago', estado: 'activo', plan: 'crecimiento' });
  await db.doc(`tenants/${TENANTS.prepago}/cuenta/estado`).set({
    ...crecimiento, modalidad: 'prepago', periodoPagado: '2026-10', telefonosPago: ['59170000003', '59170000004', 'basura'],
  });
  await db.doc(`tenants/${TENANTS.prepago}/config/negocio`).set({ numeroRecepcion: '70000003' });
  await db.doc(`tenants/${TENANTS.sinTel}`).set({ nombre: 'Sin tel', estado: 'activo', plan: 'crecimiento' });
  await db.doc(`tenants/${TENANTS.sinTel}/cuenta/estado`).set({ ...crecimiento, modalidad: 'prepago', periodoPagado: '2026-10' });
  await db.doc(`tenants/${TENANTS.cortado}`).set({ nombre: 'Cortado', estado: 'activo', plan: 'impulso' });
  await db.doc(`tenants/${TENANTS.cortado}/cuenta/estado`).set({
    plan: 'impulso', limites: limitesDe('impulso'), modalidad: 'prepago', periodoPagado: '2026-10',
    telefonosPago: ['59170000005'],
    corte: { motivo: 'sin_pago', desde: Timestamp.fromMillis(bo(2026, 11, 3)), perdidas: 7, mensajesPerdidos: 20, aplicado: true },
  });
  for (const t of Object.values(TENANTS)) {
    for (const d of (await db.collection(`tenants/${t}/bitacora`).get()).docs) await d.ref.delete();
  }
}, 120_000);

afterAll(() => vi.useRealTimers());

describe('Quién puede preguntar', () => {
  it('el número de un comercio recibe 403, en las dos Functions', async () => {
    expect((await llamar(recordatoriosPrepago, {}, NUMERO_COMERCIO)).codigo).toBe(403);
    expect((await llamar(recordatorioPrepagoEnviado, { tenantId: TENANTS.prepago, clave: 'vence_pronto_2026-11' }, NUMERO_COMERCIO)).codigo).toBe(403);
  });

  it('sin firma ni token, 401', async () => {
    const r = await llamar(recordatoriosPrepago, {}, '1000000000');
    expect(r.codigo).toBe(401);
  });
});

describe('Ayudantes puros', () => {
  it('`telefonosPagoDe` filtra la basura y corta en cinco', () => {
    expect(telefonosPagoDe({ telefonosPago: ['59170000003', 'basura', '59170000003', 7] })).toEqual(['59170000003']);
    expect(telefonosPagoDe({ telefonosPago: ['1', '59170000001', '59170000002', '59170000003', '59170000004', '59170000005', '59170000006'] }))
      .toHaveLength(5);
    expect(telefonosPagoDe({})).toEqual([]);
    expect(telefonosPagoDe({ telefonosPago: 'no' })).toEqual([]);
  });

  it('`enHorarioDeEnvio`: de 09:00 a 18:59 de Bolivia', () => {
    expect(enHorarioDeEnvio(bo(2026, 10, 28, 8, 59))).toBe(false);
    expect(enHorarioDeEnvio(bo(2026, 10, 28, 9))).toBe(true);
    expect(enHorarioDeEnvio(bo(2026, 10, 28, 18, 59))).toBe(true);
    expect(enHorarioDeEnvio(bo(2026, 10, 28, 19))).toBe(false);
  });
});

describe('La lista del D-5 (28 de octubre)', () => {
  it('trae la renovación del prepago con sus teléfonos válidos, y la conversión de la prueba', async () => {
    vi.setSystemTime(OCT_28);
    const r = await listar();
    expect(r.codigo).toBe(200);
    expect(r.cuerpo['fueraDeHorario']).toBe(false);
    expect(r.cuerpo['tipoCambio']).toEqual({ tco: 12.6, fecha: '2026-10-27' });

    const prepago = deTenant(r, TENANTS.prepago);
    expect(prepago).toHaveLength(1);
    expect(prepago[0]).toMatchObject({
      clave: 'vence_pronto_2026-11', tipo: 'vencePronto', plantilla: 'mensualidad_vence_pronto',
      telefono: '59170000003', telefonos: ['59170000003', '59170000004'],
      parametros: ['1 de noviembre de 2026', '630', 'Crecimiento', '1 mes'],
    });

    const prueba = deTenant(r, TENANTS.prueba);
    expect(prueba.map((f) => f.tipo)).toEqual(['conversion']);
    expect(prueba[0]).toMatchObject({ clave: 'conversion_2026-10', plantilla: 'prueba_termina', parametros: ['31 de octubre de 2026'] });
  });

  it('nunca una demostración, ni el propio NovuChat', async () => {
    const r = await listar();
    expect(deTenant(r, TENANTS.demo)).toEqual([]);
    expect(deTenant(r, NOVUCHAT)).toEqual([]);
    expect((r.cuerpo['sinTelefono'] as { tenantId: string }[]).map((s) => s.tenantId)).not.toContain(TENANTS.demo);
  });

  it('el comercio sin teléfonos de pago va en `sinTelefono`, con sus claves', async () => {
    const r = await listar();
    expect(deTenant(r, TENANTS.sinTel)).toEqual([]);
    expect(r.cuerpo['sinTelefono']).toContainEqual({ tenantId: TENANTS.sinTel, claves: ['vence_pronto_2026-11'] });
  });

  it('fuera del horario de Bolivia la lista vuelve vacía', async () => {
    vi.setSystemTime(bo(2026, 10, 28, 22));
    const r = await listar();
    expect(r.codigo).toBe(200);
    expect(r.cuerpo).toMatchObject({ fueraDeHorario: true, recordatorios: [], sinTelefono: [] });
    vi.setSystemTime(OCT_28);
  });

  it('sin un TCO vigente no sale la renovación (lleva importe), pero sí la conversión', async () => {
    await tipoCambio('2026-10-01');
    const r = await listar();
    expect(r.cuerpo['tipoCambio']).toBeNull();
    expect(deTenant(r, TENANTS.prepago)).toEqual([]);
    expect(deTenant(r, TENANTS.prueba)).toHaveLength(1);
    await tipoCambio('2026-10-27');
  });
});

describe('Marcar antes de enviar', () => {
  it('la primera marca pasa, la segunda es `repetido`, y el recordatorio deja de listarse', async () => {
    vi.setSystemTime(OCT_28);
    expect((await marcar(TENANTS.prepago, 'vence_pronto_2026-11')).cuerpo).toEqual({ marcado: true, repetido: false });
    expect((await marcar(TENANTS.prepago, 'vence_pronto_2026-11')).cuerpo).toEqual({ marcado: false, repetido: true });
    const cuenta = (await db.doc(`tenants/${TENANTS.prepago}/cuenta/estado`).get()).data() ?? {};
    expect((cuenta['recordatorios'] as Record<string, unknown>)['vence_pronto_2026-11']).toBeDefined();
    expect(deTenant(await listar(), TENANTS.prepago)).toEqual([]);
    const renglones = await bitacora(TENANTS.prepago);
    expect(renglones).toHaveLength(1);
    expect(renglones[0]).toMatchObject({ canal: 'sistema', detalle: 'vence_pronto_2026-11' });
  });

  it('a una demostración no se le marca nada; una clave o un tenant mal formados son 400', async () => {
    expect((await marcar(TENANTS.demo, 'vence_pronto_2026-11')).cuerpo).toMatchObject({ marcado: false, motivo: 'demostracion' });
    expect((await marcar(TENANTS.prepago, 'Con Espacios')).codigo).toBe(400);
    expect((await marcar('Mal', 'vence_pronto_2026-11')).codigo).toBe(400);
    expect((await marcar('no-existe-cob', 'vence_pronto_2026-11')).cuerpo).toMatchObject({ marcado: false, motivo: 'sin_cuenta' });
  });

  it('una confirmación pendiente se lista y, al marcarla, se cierra', async () => {
    await db.doc(`tenants/${TENANTS.prepago}/cuenta/estado`).update({
      confirmacionesPendientes: { abc123: { parametros: ['630', 'Crecimiento', '30/11/2026'] }, mala: { parametros: [] } },
    });
    const r = await listar();
    const conf = (r.cuerpo['confirmaciones'] as { tenantId: string; pagoId: string; clave: string; plantilla: string; parametros: string[] }[])
      .filter((c) => c.tenantId === TENANTS.prepago);
    expect(conf).toHaveLength(1);
    expect(conf[0]).toMatchObject({ pagoId: 'abc123', clave: 'confirmacion_abc123', plantilla: 'pago_confirmado', parametros: ['630', 'Crecimiento', '30/11/2026'] });
    expect((await marcar(TENANTS.prepago, 'confirmacion_abc123')).cuerpo).toEqual({ marcado: true, repetido: false });
    const cuenta = (await db.doc(`tenants/${TENANTS.prepago}/cuenta/estado`).get()).data() ?? {};
    expect((cuenta['confirmacionesPendientes'] as Record<string, unknown>)['abc123']).toBeUndefined();
    expect((await listar()).cuerpo['confirmaciones']).toEqual([]);
  });
});

describe('La lista del D+4 (5 de noviembre)', () => {
  it('el cortado recibe el segundo aviso con sus pérdidas; la prueba vencida, nada', async () => {
    vi.setSystemTime(NOV_5);
    await tipoCambio('2026-11-04');
    const r = await listar();
    const cortado = deTenant(r, TENANTS.cortado);
    expect(cortado.map((f) => f.tipo)).toEqual(['cortePago2']);
    expect(cortado[0]).toMatchObject({
      clave: 'corte2_2026-11', plantilla: 'asistente_sin_atender_perdidas',
      parametros: ['7', '1 de noviembre de 2026', '315', 'Impulso', '1 mes'],
    });
    // El prepago sin corte guardado también está cortado en noviembre: pérdidas 0.
    expect(deTenant(r, TENANTS.prepago).map((f) => [f.tipo, f.parametros[0]])).toEqual([['cortePago2', '0']]);
    expect(deTenant(r, TENANTS.prueba)).toEqual([]);
    expect(deTenant(r, TENANTS.demo)).toEqual([]);
  });
});
