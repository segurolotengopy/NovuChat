/**
 * LA TARIFA DE LA CUENTA, DE PUNTA A PUNTA (contra el emulador): los escritores
 * reales de la copia de límites —la callable `actualizarEstadoCuenta` y el pago
 * manual del propietario— y la lectura de la consola —`ejesDeCuenta`—.
 *
 * Lo que fija, escrito negando (`CLAUDE.md`, Base comercial §7):
 *  - una cuenta SIN `tarifa` y con la copia de 100 NO pasa a 200 al renovar, y al
 *    cambiar a Crecimiento (callable o pago) recibe 220, NO 500;
 *  - con `tarifa: 'estandar'` recibe 500;
 *  - ninguno de los dos escritores ESCRIBE la tarifa: la cuenta de Bellido
 *    queda sin el campo (no se escribe lo que no se pidió), y pedirla por la
 *    callable de plan no la fija: la tarifa no es un campo de esa callable;
 *  - la consola (`ejesDeCuenta`) la lee con su respaldo y dice si estaba escrita.
 *
 * Tenants ficticios; ningún nombre de cliente. Las suites no corren en
 * paralelo (`fileParallelism: false`); el puerto del emulador es propio de cada
 * worktree (`FIRESTORE_EMULATOR_PORT`).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { CATALOGO_PLANES, limitesDe } from '../../functions/src/central/cuenta/planes.ts';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
// El pago manual llega hasta el cliente del cobrador (doble en memoria):
// valores de prueba, no secretos. Cada suite fija su entorno (`pagos.test.ts`).
process.env['COBRADOR_DOBLE'] ??= '1';
process.env['COBRADOR_TOKEN'] ??= 'token-de-prueba-de-novuchat-sin-valor-real';
process.env['COBRADOR_AVISO_SECRETO'] ??= 'secreto-de-prueba-del-aviso-de-confirmacion';

const indice = await import('../../functions/src/index.ts');
const pagos = await import('../../functions/src/central/pagar/pagos.ts');
const { getFirestore } = await import('firebase-admin/firestore');
const db = getFirestore();

const A = 'tarifa-a';
const B = 'tarifa-b';
const TCO = 12.6;
const FECHA_HOY = new Date(Date.now() - 4 * 3_600_000).toISOString().slice(0, 10);

const google = { sign_in_provider: 'google.com' };
const password = { sign_in_provider: 'password' };
const PROPIETARIO = { uid: 'prop-t', token: { nc: { p: true }, firebase: google, auth_time: Math.floor(Date.now() / 1000) } };
const ADMIN_A = { uid: 'adm-ta', token: { nc: { t: { [A]: 'admin' } }, firebase: password, email_verified: true } };
const ADMIN_B = { uid: 'adm-tb', token: { nc: { t: { [B]: 'admin' } }, firebase: password, email_verified: true } };

type Callable = { run: (r: unknown) => Promise<unknown> };
const correr = (f: unknown, data: Record<string, unknown>, auth: object | null = PROPIETARIO) =>
  (f as Callable).run({ data, auth, rawRequest: {} }) as Promise<Record<string, unknown>>;
const cuentaDe = (data: Record<string, unknown>, auth: object | null = PROPIETARIO) =>
  correr(indice.actualizarEstadoCuenta, { tenantId: A, ...data }, auth);
const cuenta = async (t = A) => (await db.doc(`tenants/${t}/cuenta/estado`).get()).data() ?? {};

/** La forma de la cuenta de un piloto con Meta incluido: Impulso, copia de 100, SIN `tarifa`. */
const IMPULSO_COPIA_100 = {
  plan: 'impulso', limites: { conversaciones: 100, productos: 20, agendas: 1, cambiosIncluidos: 0 },
  catalogoPlanes: '2026-09-25', modalidad: 'prepago', periodoPagado: '2099-12',
};

async function sembrar(t: string, datos: Record<string, unknown>) {
  for (const col of ['auditoria', 'pagos']) {
    for (const d of (await db.collection(`tenants/${t}/${col}`).get()).docs) await d.ref.delete();
  }
  await db.doc(`tenants/${t}`).set({ nombre: t, estado: 'activo', plan: datos['plan'] ?? 'impulso', flujos: ['agendamiento'] });
  await db.doc(`tenants/${t}/cuenta/estado`).set(datos);
}

const pagoManual = (plan: string, montoRecibidoBs: number, meses = 1) =>
  correr(indice.registrarPagoManual, {
    pagoId: pagos.nuevoPagoId(), tenantId: A, tipo: 'mensualidad', plan, meses,
    medio: 'efectivo', referencia: 'recibido por la prueba', tcoAplicado: TCO, tcoFuente: 'BCB', tcoFecha: FECHA_HOY,
    montoRecibidoBs,
  });

beforeEach(async () => {
  await sembrar(A, IMPULSO_COPIA_100);
  await sembrar(B, { plan: 'impulso', limites: limitesDe('impulso', 'estandar'), tarifa: 'estandar', catalogoPlanes: CATALOGO_PLANES });
  for (const d of (await db.collection('cobrosPendientes').get()).docs) await d.ref.delete();
  await db.doc('plataforma/tipoCambio').set({ tco: TCO, fecha: FECHA_HOY, fuente: 'BCB' });
});

// ===========================================================================
describe('actualizarEstadoCuenta (cambio de plan por Negocios)', () => {
  it('sin tarifa y con la copia de 100: Crecimiento recibe 220, NO 500; y la cuenta sigue SIN el campo tarifa', async () => {
    await cuentaDe({ plan: 'crecimiento' });
    const c = await cuenta();
    expect(c['plan']).toBe('crecimiento');
    expect(c['limites']).toEqual(limitesDe('crecimiento', 'meta_incluido'));
    expect((c['limites'] as Record<string, number>)['conversaciones']).toBe(220);
    expect((c['limites'] as Record<string, number>)['conversaciones']).not.toBe(500);
    // No se escribe lo que nadie pidió: la cuenta no estrena un campo.
    expect(c).not.toHaveProperty('tarifa');
  });

  it('con tarifa estandar: Crecimiento recibe 500, y la tarifa no se toca', async () => {
    await sembrar(A, { ...IMPULSO_COPIA_100, tarifa: 'estandar' });
    await cuentaDe({ plan: 'crecimiento' });
    const c = await cuenta();
    expect((c['limites'] as Record<string, number>)['conversaciones']).toBe(500);
    expect(c['tarifa']).toBe('estandar');
  });

  it('la tarifa NO es un campo de esta callable: pedirla no la fija ni sube los topes', async () => {
    await cuentaDe({ plan: 'crecimiento', tarifa: 'estandar' });
    const c = await cuenta();
    expect(c).not.toHaveProperty('tarifa');
    expect((c['limites'] as Record<string, number>)['conversaciones']).toBe(220);
  });

  it('el administrador del comercio NO cambia el plan (y menos la tarifa): permission-denied, nada se escribe', async () => {
    await expect(cuentaDe({ plan: 'pro', tarifa: 'estandar' }, ADMIN_A)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(await cuenta()).toEqual(IMPULSO_COPIA_100);
  });
});

// ===========================================================================
describe('el pago manual del propietario', () => {
  it('RENOVAR el mismo plan (sin tarifa, copia 100) no toca la copia: sigue en 100, NO 200', async () => {
    const { periodoPagado: _p, ...sinMes } = IMPULSO_COPIA_100;
    await sembrar(A, sinMes);
    await pagoManual('impulso', 315);
    const c = await cuenta();
    expect(c['plan']).toBe('impulso');
    expect(c['limites']).toEqual(IMPULSO_COPIA_100.limites);
    expect(c['catalogoPlanes']).toBe('2026-09-25');
    expect(c).not.toHaveProperty('tarifa');
  });

  it('pagar Crecimiento sobre esa cuenta deja 220, NO 500', async () => {
    const { periodoPagado: _p, ...sinMes } = IMPULSO_COPIA_100;
    await sembrar(A, sinMes);
    await pagoManual('crecimiento', 630);
    const c = await cuenta();
    expect(c['plan']).toBe('crecimiento');
    expect((c['limites'] as Record<string, number>)['conversaciones']).toBe(220);
    expect(c).not.toHaveProperty('tarifa');
  });

  it('con tarifa estandar, pagar Crecimiento deja 500', async () => {
    const { periodoPagado: _p, ...sinMes } = IMPULSO_COPIA_100;
    await sembrar(A, { ...sinMes, tarifa: 'estandar' });
    await pagoManual('crecimiento', 630);
    const c = await cuenta();
    expect((c['limites'] as Record<string, number>)['conversaciones']).toBe(500);
    expect(c['tarifa']).toBe('estandar');
  });

  it('un pago de 6 meses regala 30 conversaciones a la bolsa, con o sin tarifa', async () => {
    for (const extra of [{}, { tarifa: 'estandar' }, { tarifa: 'meta_incluido' }]) {
      const { periodoPagado: _p, ...sinMes } = IMPULSO_COPIA_100;
      await sembrar(A, { ...sinMes, bolsa: 5, ...extra });
      await pagoManual('impulso', 1890, 6);
      expect((await cuenta())['bolsa'], JSON.stringify(extra)).toBe(35);
    }
  });
});

// ===========================================================================
describe('ejesDeCuenta: lo que lee la consola', () => {
  const ejes = (t: string, auth: object | null) => correr(indice.ejesDeCuenta, { tenantId: t }, auth);

  it('una cuenta SIN tarifa: meta_incluido, no escrita, y el plan trae 100 (no 200)', async () => {
    const r = await ejes(A, ADMIN_A);
    expect(r).toMatchObject({
      tarifa: 'meta_incluido', tarifaExplicita: false,
      limites: { conversaciones: 100, conversacionesDelPlan: 100 },
    });
  });

  it('una cuenta con tarifa estandar: estandar, escrita, y el plan trae 200', async () => {
    const r = await ejes(B, ADMIN_B);
    expect(r).toMatchObject({
      tarifa: 'estandar', tarifaExplicita: true,
      limites: { conversaciones: 200, conversacionesDelPlan: 200 },
    });
  });

  it('un valor de tarifa corrupto se lee como meta_incluido y NO cuenta como escrito', async () => {
    const { limites: _l, ...sinCopia } = IMPULSO_COPIA_100;
    await sembrar(A, { ...sinCopia, tarifa: 'gratis' });
    const r = await ejes(A, ADMIN_A);
    expect(r).toMatchObject({ tarifa: 'meta_incluido', tarifaExplicita: false, limites: { conversaciones: 100 } });
  });

  it('el administrador de OTRO comercio no la lee', async () => {
    await expect(ejes(A, ADMIN_B)).rejects.toMatchObject({ code: 'permission-denied' });
  });
});
