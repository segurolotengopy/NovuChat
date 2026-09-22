/**
 * EL CORTE DEL PREPAGO EN `configuracionFlujo`, contra el emulador: reutiliza
 * el 409 que los tres flujos ya obedecen (`DISENO.md` §4undecies.3).
 *
 *  - Cortado y con la bandera encendida: 409 con `estado: 'sin_pago'` y una
 *    cortesía que lleva el teléfono de recepción y NO dice «pago», «deuda» ni
 *    «mantenimiento».
 *  - Con la bandera apagada: 200, con `prepago.corteAplicado: false`.
 *  - En gracia: 200 con `prepago.fase: 'gracia'`.
 *  - Demostración: 200 siempre, con la bandera encendida y 99.999 consumidas.
 *  - `sin_conversaciones` con la ventana del teléfono abierta: 200; con un
 *    teléfono nuevo o sin teléfono: 409.
 *  - El comercio suspendido sigue dando 409, ahora con el teléfono.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
const TOKEN = 'valor-de-prueba-del-prepago';
process.env['INGESTA_CLIENTE16'] = TOKEN;

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const db = getFirestore();
const { configuracionFlujo } = await import('../functions/src/ingesta.ts');
const { MENSAJE_CORTESIA } = await import('../functions/src/prepago.ts');
const { limitesDe } = await import('../functions/src/planes.ts');

const T = 'prepago-config';
const NUMERO = '1000000095';
const RECEPCION = '70000001';
const HORA = 3_600_000;
const bo = (y: number, m: number, d: number, h = 0, mi = 0) => Date.UTC(y, m - 1, d, h, mi) + 4 * HORA;
const AHORA = bo(2026, 10, 15, 12);
const MES_UTC = (ms: number) => new Date(ms).toISOString().slice(0, 7);
const PROHIBIDO = /pago|deuda|mantenimiento|suspend|moros/i;

interface Respuesta { codigo: number; cuerpo: Record<string, unknown> }

async function configuracion(cuerpo: Record<string, unknown> = {}): Promise<Respuesta> {
  const cabeceras: Record<string, string> = {
    'x-novuchat-numero': NUMERO, authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json',
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
  await (configuracionFlujo as unknown as (q: unknown, s: unknown) => Promise<void>)(peticion, respuesta);
  return r;
}

const plataforma = (corteActivo: boolean | null) =>
  corteActivo === null ? db.doc('plataforma/prepago').delete() : db.doc('plataforma/prepago').set({ corteActivo });
const fijarCuenta = (datos: Record<string, unknown>) => db.doc(`tenants/${T}/cuenta/estado`).set(datos);
const fijarMetricas = (conversaciones: number) =>
  db.doc(`tenants/${T}/metricas/${MES_UTC(Date.now())}`).set({ conversaciones });

const VENCIDA = { modalidad: 'prepago', plan: 'crecimiento', limites: limitesDe('crecimiento'), periodoPagado: '2026-08' };

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AHORA);
  await db.doc(`rutasWhatsApp/${NUMERO}`).set({ tenantId: T, flujo: 'agendamiento', aliasSecreto: 'cliente16', estado: 'activo' });
  await db.doc(`tenants/${T}`).set({ nombre: 'Config', estado: 'activo', plan: 'crecimiento' });
  await db.doc(`tenants/${T}/config/negocio`).set({ nombreNegocio: 'Config', numeroRecepcion: RECEPCION });
}, 120_000);

afterAll(async () => {
  vi.useRealTimers();
  await plataforma(null);
});

beforeEach(async () => {
  vi.setSystemTime(AHORA);
  await db.doc(`tenants/${T}`).update({ estado: 'activo' });
  await fijarMetricas(0);
});

describe('El 409 del corte', () => {
  it('cortado y con la bandera encendida: 409 con el teléfono de recepción y sin mencionar el motivo', async () => {
    await plataforma(true);
    await fijarCuenta(VENCIDA);
    const r = await configuracion({ telefono: '591000000001' });
    expect(r.codigo).toBe(409);
    expect(r.cuerpo['estado']).toBe('sin_pago');
    const cortesia = String(r.cuerpo['mensajeCortesia']);
    expect(cortesia).toBe(`${MENSAJE_CORTESIA} Puede comunicarse al ${RECEPCION}.`);
    expect(cortesia).not.toMatch(PROHIBIDO);
    expect(r.cuerpo['tenantId']).toBeUndefined();
  });

  it('sin teléfono en la petición también corta', async () => {
    await plataforma(true);
    await fijarCuenta(VENCIDA);
    expect((await configuracion({})).codigo).toBe(409);
  });

  it('con la bandera del tenant encendida y la global apagada, corta igual', async () => {
    await plataforma(false);
    await fijarCuenta({ ...VENCIDA, corteActivo: true });
    expect((await configuracion({})).codigo).toBe(409);
  });

  it('en modo observación: 200, con `prepago.corteAplicado: false` y la fase real', async () => {
    await plataforma(false);
    await fijarCuenta(VENCIDA);
    const r = await configuracion({ telefono: '591000000001' });
    expect(r.codigo).toBe(200);
    expect(r.cuerpo['prepago']).toEqual({
      modalidad: 'prepago', fase: 'cortado', motivo: 'sin_pago', graciaHasta: null, disponibles: 0, corteAplicado: false,
    });
    expect(r.cuerpo['tenantId']).toBe(T);
  });

  it('`cuenta.corteActivo: false` no exime: con la global encendida, 409', async () => {
    await plataforma(true);
    await fijarCuenta({ ...VENCIDA, corteActivo: false });
    expect((await configuracion({})).codigo).toBe(409);
  });
});

describe('Lo que nunca da 409 por prepago', () => {
  beforeEach(() => plataforma(true));

  it('una demostración, con la bandera encendida y 99.999 consumidas', async () => {
    await fijarMetricas(99_999);
    for (const datos of [{ plan: 'crecimiento' }, { modalidad: 'demostracion' }, { plan: 'demostracion', modalidad: 'prepago' }]) {
      await fijarCuenta(datos);
      const r = await configuracion({ telefono: '591000000001' });
      expect(r.codigo).toBe(200);
      expect(r.cuerpo['prepago']).toMatchObject({ modalidad: 'demostracion', fase: 'cubierto', motivo: null, disponibles: null, corteAplicado: false });
    }
  });

  it('en gracia: 200 con la fase y hasta cuándo', async () => {
    await fijarCuenta({ ...VENCIDA, periodoPagado: '2026-09' });
    vi.setSystemTime(bo(2026, 10, 2, 23));
    await fijarMetricas(0);
    const r = await configuracion({ telefono: '591000000001' });
    expect(r.codigo).toBe(200);
    expect(r.cuerpo['prepago']).toMatchObject({ fase: 'gracia', motivo: null, graciaHasta: new Date(bo(2026, 10, 3)).toISOString(), corteAplicado: false });
    // Un minuto después de la gracia, ya no.
    vi.setSystemTime(bo(2026, 10, 3, 0, 1));
    await fijarMetricas(0);
    expect((await configuracion({ telefono: '591000000001' })).codigo).toBe(409);
  });

  it('cubierta y con conversaciones: 200 con las disponibles', async () => {
    await fijarCuenta({ ...VENCIDA, periodoPagado: '2026-10', bolsa: 3 });
    await fijarMetricas(200);
    const r = await configuracion({});
    expect(r.codigo).toBe(200);
    expect(r.cuerpo['prepago']).toMatchObject({ fase: 'cubierto', disponibles: 23, corteAplicado: false });
  });
});

describe('Sin conversaciones y la ventana abierta', () => {
  beforeEach(async () => {
    await plataforma(true);
    await fijarCuenta({ ...VENCIDA, periodoPagado: '2026-10', bolsa: 0 });
    await fijarMetricas(220);
    // Un teléfono con la ventana abierta hace una hora, y otro con la ventana vencida ayer.
    await db.doc(`tenants/${T}/conversaciones/wa_591000000011`).set({ telefono: '591000000011', atencionDesde: Timestamp.fromMillis(AHORA - HORA), mensajesVentana: 3 });
    await db.doc(`tenants/${T}/conversaciones/wa_591000000012`).set({ telefono: '591000000012', atencionDesde: Timestamp.fromMillis(AHORA - 30 * HORA), mensajesVentana: 3 });
  });

  it('el teléfono con la ventana abierta se atiende: 200', async () => {
    const r = await configuracion({ telefono: '591000000011' });
    expect(r.codigo).toBe(200);
    expect(r.cuerpo['prepago']).toMatchObject({ fase: 'cortado', motivo: 'sin_conversaciones', disponibles: 0, corteAplicado: true });
  });

  it('un teléfono con la ventana vencida, o uno nuevo: 409', async () => {
    for (const cuerpo of [{ telefono: '591000000012' }, { telefono: '591000000099' }]) {
      const r = await configuracion(cuerpo);
      expect(r.codigo).toBe(409);
      expect(r.cuerpo['estado']).toBe('sin_conversaciones');
      expect(String(r.cuerpo['mensajeCortesia'])).not.toMatch(PROHIBIDO);
    }
  });

  it('sin teléfono en la petición NO corta por conversaciones: no se sabe si la ventana está abierta', async () => {
    // Revisión de seguridad de A-0: se falla hacia atender. El corte a los
    // teléfonos nuevos entra por la ingesta y por las peticiones con teléfono;
    // por eso encender la bandera exige que todos los flujos manden `telefono`.
    const r = await configuracion({});
    expect(r.codigo).toBe(200);
    expect(r.cuerpo['prepago']).toMatchObject({ motivo: 'sin_conversaciones', corteAplicado: true });
  });
});

describe('El comercio suspendido', () => {
  it('sigue dando 409, ahora con el teléfono de recepción', async () => {
    await plataforma(false);
    await fijarCuenta({ plan: 'crecimiento' });
    await db.doc(`tenants/${T}`).update({ estado: 'suspendido' });
    const r = await configuracion({});
    expect(r.codigo).toBe(409);
    expect(r.cuerpo['estado']).toBe('suspendido');
    expect(String(r.cuerpo['mensajeCortesia'])).toContain(`Puede comunicarse al ${RECEPCION}.`);
  });

  it('sin teléfono de recepción, la cortesía es el texto de siempre', async () => {
    await db.doc(`tenants/${T}/config/negocio`).update({ numeroRecepcion: '' });
    await db.doc(`tenants/${T}`).update({ estado: 'suspendido' });
    expect((await configuracion({})).cuerpo['mensajeCortesia']).toBe(MENSAJE_CORTESIA);
    await db.doc(`tenants/${T}/config/negocio`).update({ numeroRecepcion: RECEPCION });
  });
});
