/**
 * `cotejarComprobanteVenta`, DE PUNTA A PUNTA contra el emulador (regla 2).
 *
 * La solicitud se siembra con la propia máquina de estados (`solicitudDeCobroTras`),
 * porque la ingesta todavía no sabe de `reglaCobro` (es la integración C1b).
 *
 * LO QUE SE NIEGA: un inválido no crea cierre ni suma `cierres`; el tercero no
 * cierra nada y pasa a una persona; un tardío no cierra la venta; el endpoint
 * jamás contesta `sin_sena_pendiente`; una `ruta` ajena no se acepta; ninguna
 * respuesta afirma un pago (prohibición 3).
 */
import { beforeAll, describe, expect, it } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
// Alias que ninguna otra suite usa. Valor de prueba, no un secreto.
const TOKEN = 'valor-de-prueba-del-cotejo-de-venta-v2';
process.env['INGESTA_CLIENTE12'] = TOKEN;

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const db = getFirestore();
const { cotejarComprobanteVenta } = await import('../../../functions/src/modulos/cobros/cotejoVenta.ts');
const { solicitudDeCobroTras } = await import('../../../functions/src/modulos/cobros/cobroVenta.ts');
const { rutaDeComprobante } = await import('../../../functions/src/modulos/cobros/comprobantes.ts');

const AFIRMA_PAGO = /acreditad|verificad|recibimos|pago confirmado/i;
const T = 'cobro-v2-tienda';
const NUMERO = '1000000012';
const MES = new Date().toISOString().slice(0, 7);
const MIN = 60_000;
const CUENTA = '1000000890';
const TITULAR = 'Juan Carlos Pérez Gómez';

interface Respuesta { codigo: number; cuerpo: any }

async function llamar(cuerpo: Record<string, unknown>, token: string | null = TOKEN, metodo = 'POST'): Promise<Respuesta> {
  const cabeceras: Record<string, string> = { 'x-novuchat-numero': NUMERO, 'content-type': 'application/json' };
  if (token) cabeceras['authorization'] = `Bearer ${token}`;
  const leer = (n: string) => cabeceras[n.toLowerCase()];
  const peticion = { method: metodo, body: cuerpo, rawBody: Buffer.from(JSON.stringify(cuerpo)), headers: cabeceras, get: leer, header: leer };
  const r: Respuesta = { codigo: 0, cuerpo: null };
  const respuesta = {
    status(c: number) { r.codigo = c; return respuesta; },
    send(b: unknown) { r.cuerpo = b; return respuesta; },
    json(b: unknown) { r.cuerpo = b; return respuesta; },
    setHeader() { return respuesta; }, getHeader() { return undefined; },
    set() { return respuesta; }, on() { return respuesta; }, end() { return respuesta; },
  };
  await (cotejarComprobanteVenta as unknown as (q: unknown, s: unknown) => Promise<void>)(peticion, respuesta);
  return r;
}

function enLaPaz(ms: number): { fecha: string; hora: string } {
  const d = new Date(ms - 4 * 3_600_000);
  const dos = (n: number) => String(n).padStart(2, '0');
  return { fecha: `${dos(d.getUTCDate())}/${dos(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`, hora: `${dos(d.getUTCHours())}:${dos(d.getUTCMinutes())}` };
}

const leidoDe = (monto: string, extra: Record<string, unknown> = {}) => ({
  monto, cuentaDestino: CUENTA, nombreCuenta: 'PEREZ GOMEZ JUAN CARLOS', banco: 'BNB', ...enLaPaz(Date.now()), ...extra,
});
const comp = (tel: string, leido: Record<string, unknown>, idMeta: string, extra: Record<string, unknown> = {}) =>
  llamar({ telefono: tel, legible: true, leido, idMeta, ...extra });

const conversacion = async (tel: string) => (await db.doc(`tenants/${T}/conversaciones/wa_${tel}`).get()).data() ?? {};
const metricas = async () => (await db.doc(`tenants/${T}/metricas/${MES}`).get()).data() ?? {};
const cierres = async () => (await db.collection(`tenants/${T}/cierres`).get()).docs.map((d) => ({ id: d.id, ...d.data() }));

/** Siembra un cobro de regla 2 cuyo QR salió hace `haceMin` minutos. */
async function sembrar(tel: string, haceMin: number, extra: Record<string, unknown> = {}, referencia = `wamid.qr-${tel}`) {
  const enviado = Date.now() - haceMin * MIN;
  const t = solicitudDeCobroTras(null, { tipo: 'qr_enviado', reglaCobro: 2, idMeta: referencia }, enviado);
  await db.doc(`tenants/${T}/conversaciones/wa_${tel}`).set({
    nombreContacto: 'Cliente de prueba',
    solicitud: {
      etapa: 'qr_enviado', desde: Timestamp.fromMillis(enviado), qrEnviadoEn: Timestamp.fromMillis(enviado),
      evento: { id: referencia, calendario: '' }, cotejos: 0, seguimientos: 0, seguimientoEn: null,
      reactivadaEn: null, monto: 100, ...(t.cambios ?? {}), ...extra,
    },
  });
}

beforeAll(async () => {
  for (const c of ['auditoria', 'bitacora', 'conversaciones', 'cierres', 'pedidos']) {
    for (const d of (await db.collection(`tenants/${T}/${c}`).get()).docs) {
      for (const p of (await d.ref.collection('privado').get()).docs) await p.ref.delete();
      await d.ref.delete();
    }
  }
  await db.doc(`tenants/${T}/metricas/${MES}`).delete();
  await db.doc(`rutasWhatsApp/${NUMERO}`).set({ tenantId: T, flujo: 'venta', aliasSecreto: 'cliente12', estado: 'activo' });
  await db.doc(`tenants/${T}`).set({ nombre: 'Tienda', estado: 'activo', flujos: ['venta'] });
  await db.doc(`tenants/${T}/cuenta/estado`).set({ plan: 'impulso', estadoPago: 'al_dia' });
  await db.doc(`tenants/${T}/config/negocio`).set({ nombreNegocio: 'Tienda', zonaHoraria: 'America/La_Paz', moneda: 'BOB' });
  await db.doc(`tenants/${T}/config/venta`).set({
    cobroReal: { nombreCuenta: TITULAR, cuentas: [CUENTA], banco: 'BNB' },
  });
}, 120_000);

describe('autenticación y forma', () => {
  it('sin token, 401; con otro método, 405; sin idMeta, 400; teléfono inválido, 400', async () => {
    expect((await llamar({ telefono: '59170000011', idMeta: 'x' }, null)).codigo).toBe(401);
    expect((await llamar({ telefono: '59170000011', idMeta: 'x' }, TOKEN, 'GET')).codigo).toBe(405);
    expect((await llamar({ telefono: '59170000011', legible: true })).codigo).toBe(400);
    expect((await llamar({ telefono: 'abc', idMeta: 'x' })).codigo).toBe(400);
  });
  it('un token ajeno no entra', async () => {
    expect((await llamar({ telefono: '59170000011', idMeta: 'x' }, 'otro-valor')).codigo).toBe(401);
  });
});

describe('válido y aproximado: crean el cierre', () => {
  it('monto igual: válido, cierre venta_<ref>, suma `cierres`, avisa al comercio, solicitud agendada', async () => {
    await sembrar('59170000021', 2);
    const r = await comp('59170000021', leidoDe('100,00'), 'wamid.c-ok');
    expect(r.codigo).toBe(200);
    expect(r.cuerpo).toMatchObject({
      estado: 'valido', motivo: 'ok', montoDistinto: false, importe: 100, moneda: 'BOB',
      cierreId: 'venta_wamid.qr-59170000021'.replace(/[^a-zA-Z0-9_-]/g, ''), avisarComercio: true, intentos: 0,
    });
    const cierre = (await cierres()).find((c) => c.id === r.cuerpo.cierreId) as any;
    expect(cierre).toMatchObject({ tipo: 'venta', monto: 100, cotejo: { resultado: 'cuadra', calidad: 'valido' } });
    const priv = (await db.doc(`tenants/${T}/cierres/${r.cuerpo.cierreId}/privado/datos`).get()).data() as any;
    expect(priv.telefono).toBe('59170000021');
    expect(priv.detalle).not.toMatch(AFIRMA_PAGO);
    expect(JSON.stringify(r.cuerpo)).not.toMatch(AFIRMA_PAGO);
    expect((await conversacion('59170000021'))['solicitud']).toMatchObject({ etapa: 'agendada', cotejos: 1 });
    const m = await metricas();
    expect(m).toMatchObject({ cierres: 1, cobrosValidos: 1, cobrosCotejados: 1 });
  });
  it('leído mayor dentro de la tolerancia: aproximado con montoDistinto y montoLeido', async () => {
    await sembrar('59170000022', 2);
    const r = await comp('59170000022', leidoDe('101'), 'wamid.c-aprox');
    expect(r.cuerpo).toMatchObject({ estado: 'aproximado', motivo: 'monto_distinto', montoDistinto: true, montoLeido: 101, importe: 100, avisarComercio: true });
    expect(r.cuerpo.cierreId).toBeTruthy();
    expect((await metricas())['cobrosAproximados']).toBe(1);
  });
  it('un segundo comprobante sobre una venta ya cerrada: 200 `ya_resuelto`, nunca `sin_sena_pendiente`', async () => {
    const r = await comp('59170000021', leidoDe('100'), 'wamid.c-otro');
    expect(r.codigo).toBe(200);
    expect(r.cuerpo).toMatchObject({ estado: 'ya_resuelto', avisarComercio: false });
    expect(JSON.stringify(r.cuerpo)).not.toContain('sin_sena_pendiente');
    expect((await metricas())['cierres']).toBe(2);   // no se contó de nuevo (valido + aproximado)
  });
});

describe('inválido: NO crea cierre, y el tercero pasa a una persona', () => {
  it('pagar de menos: reintentar, sin cierre, sin `cierres`, suma `cobrosInvalidos`', async () => {
    const antes = (await cierres()).length;
    const cierresAntes = (await metricas())['cierres'];
    await sembrar('59170000031', 2);
    const r = await comp('59170000031', leidoDe('50'), 'wamid.i1');
    expect(r.codigo).toBe(200);
    expect(r.cuerpo).toMatchObject({ estado: 'reintentar', motivo: 'monto_menor', intentos: 1, intentosRestantes: 2, cierreId: null, avisarComercio: false, montoDistinto: false });
    expect((await cierres()).length).toBe(antes);
    expect((await metricas())['cierres']).toBe(cierresAntes);
    expect((await metricas())['cobrosInvalidos']).toBe(1);
    const s = (await conversacion('59170000031'))['solicitud'];
    expect(s).toMatchObject({ etapa: 'qr_enviado', intentosInvalidos: 1, cotejos: 1 });
    expect(s.prorrogaHasta).toBeTruthy();
  });
  it('ilegible cuenta como intento; el mismo idMeta repetido no cuenta dos veces', async () => {
    const r = await llamar({ telefono: '59170000031', legible: false, leido: {}, idMeta: 'wamid.i2' });
    expect(r.cuerpo).toMatchObject({ estado: 'reintentar', motivo: 'ilegible', intentos: 2, intentosRestantes: 1 });
    const repetido = await llamar({ telefono: '59170000031', legible: false, leido: {}, idMeta: 'wamid.i2' });
    expect(repetido.cuerpo).toMatchObject({ estado: 'reintentar', intentos: 2 });
  });
  it('el tercero: `en_revision`, avisa al comercio, sin cierre; un cuarto no vuelve a avisar', async () => {
    const antes = (await cierres()).length;
    const r = await comp('59170000031', leidoDe('100', { nombreCuenta: 'MARIA LOPEZ' }), 'wamid.i3');
    expect(r.cuerpo).toMatchObject({ estado: 'en_revision', motivo: 'nombre_distinto', intentos: 3, intentosRestantes: 0, avisarComercio: true, cierreId: null });
    expect((await cierres()).length).toBe(antes);
    expect((await conversacion('59170000031'))['solicitud']).toMatchObject({ etapa: 'en_revision' });
    expect((await metricas())['cobrosEnRevision']).toBe(1);
    const cuarto = await comp('59170000031', leidoDe('100'), 'wamid.i4');
    expect(cuarto.cuerpo).toMatchObject({ estado: 'en_revision', avisarComercio: false, cierreId: null });
    expect((await cierres()).length).toBe(antes);
  });
  it('`en_revision` no vence por reloj: con el QR de hace una semana sigue en revisión', async () => {
    await sembrar('59170000032', 7 * 24 * 60, { etapa: 'en_revision', intentosInvalidos: 3 });
    const r = await comp('59170000032', leidoDe('100'), 'wamid.rev');
    expect(r.cuerpo).toMatchObject({ estado: 'en_revision', avisarComercio: false });
  });
});

describe('tardío y los 409', () => {
  it('pasado el límite: `tardio`, sin cierre, avisa una vez, la solicitud queda vencida', async () => {
    const antes = (await cierres()).length;
    await sembrar('59170000041', 20);
    const r = await comp('59170000041', leidoDe('100', { hora: '' }), 'wamid.t1');
    expect(r.codigo).toBe(200);
    expect(r.cuerpo).toMatchObject({ estado: 'tardio', avisarComercio: true, cierreId: null });
    expect((await cierres()).length).toBe(antes);
    expect((await conversacion('59170000041'))['solicitud']).toMatchObject({ etapa: 'vencida' });
    const m = await metricas();
    expect(m['cobrosTardios']).toBe(1);
    expect(m['cobrosVencidos']).toBe(1);
    const otro = await comp('59170000041', leidoDe('100'), 'wamid.t2');
    expect(otro.cuerpo).toMatchObject({ estado: 'tardio', avisarComercio: false });
  });
  it('la prórroga del primer comprobante a tiempo cubre el reintento tardío del plazo base', async () => {
    // QR hace 14 min: el primer comprobante (inválido) fija la prórroga a +10 min.
    await sembrar('59170000042', 14);
    expect((await comp('59170000042', leidoDe('50'), 'wamid.p1')).cuerpo.estado).toBe('reintentar');
    // Se simula el paso de 5 minutos moviendo el QR hacia atrás: el límite efectivo sigue siendo la prórroga.
    const ref = db.doc(`tenants/${T}/conversaciones/wa_59170000042`);
    const s = (await ref.get()).get('solicitud');
    await ref.set({ solicitud: { qrEnviadoEn: Timestamp.fromMillis(s.qrEnviadoEn.toMillis() - 5 * MIN),
      venceEn: Timestamp.fromMillis(s.venceEn.toMillis() - 5 * MIN) } }, { merge: true });
    const r = await comp('59170000042', leidoDe('100'), 'wamid.p2');
    expect(r.cuerpo.estado).toBe('valido');
  });
  it('pasadas 24 h del límite: 409 `sin_cobro_pendiente`', async () => {
    await sembrar('59170000043', 15 + 24 * 60 + 5);
    const r = await comp('59170000043', leidoDe('100'), 'wamid.t9');
    expect(r).toMatchObject({ codigo: 409, cuerpo: { error: 'sin_cobro_pendiente' } });
  });
  it('sin conversación o sin solicitud: 409 `sin_cobro_pendiente`, nunca `sin_sena_pendiente`', async () => {
    const r = await comp('59170000044', leidoDe('100'), 'wamid.n1');
    expect(r).toMatchObject({ codigo: 409, cuerpo: { error: 'sin_cobro_pendiente' } });
    await db.doc(`tenants/${T}/conversaciones/wa_59170000045`).set({ nombreContacto: 'x' });
    expect((await comp('59170000045', leidoDe('100'), 'wamid.n2')).cuerpo).toEqual({ error: 'sin_cobro_pendiente' });
  });
  it('una solicitud de regla 1 no se coteja acá: 409 `regla_1`', async () => {
    await db.doc(`tenants/${T}/conversaciones/wa_59170000046`).set({
      solicitud: { etapa: 'qr_enviado', qrEnviadoEn: Timestamp.now(), monto: 100, evento: { id: 'p', calendario: '' }, cotejos: 0 },
    });
    expect(await comp('59170000046', leidoDe('100'), 'wamid.r1')).toMatchObject({ codigo: 409, cuerpo: { error: 'regla_1' } });
  });
  it('un cobro cancelado: 409 `cobro_cancelado`', async () => {
    await sembrar('59170000047', 2, { etapa: 'cancelada' });
    expect(await comp('59170000047', leidoDe('100'), 'wamid.k1')).toMatchObject({ codigo: 409, cuerpo: { error: 'cobro_cancelado' } });
  });
  it('sin total utilizable: 409 `sin_total`', async () => {
    await sembrar('59170000048', 2, { monto: null });
    expect(await comp('59170000048', leidoDe('100'), 'wamid.s1')).toMatchObject({ codigo: 409, cuerpo: { error: 'sin_total' } });
  });
});

describe('el total y la ruta de la imagen', () => {
  it('si el pedido vino del carrito web, manda el total del SERVIDOR y no lo que reportó el flujo', async () => {
    await db.doc(`tenants/${T}/pedidos/cat_abc`).set({ total: 250 });
    await sembrar('59170000051', 2, { monto: 100 }, 'cat_abc');
    const r = await comp('59170000051', leidoDe('250'), 'wamid.w1');
    expect(r.cuerpo).toMatchObject({ estado: 'valido', importe: 250 });
  });
  it('una `ruta` que coincide con el comercio y el idMeta se anota; una ajena queda en null', async () => {
    await sembrar('59170000052', 2);
    const buena = rutaDeComprobante(T, '2026-10-03', 'wamid.rt1', 'jpg');
    await comp('59170000052', leidoDe('50'), 'wamid.rt1', { ruta: buena });
    const ajena = rutaDeComprobante('otro-comercio', '2026-10-03', 'wamid.rt2', 'jpg');
    await comp('59170000052', leidoDe('50'), 'wamid.rt2', { ruta: ajena });
    await comp('59170000052', leidoDe('50'), 'wamid.rt3', { ruta: buena });   // de OTRO mensaje
    const lista = (await conversacion('59170000052'))['solicitud'].comprobantes as any[];
    expect(lista.map((c) => c.ruta)).toEqual([buena, null, null]);
    expect(JSON.stringify(lista)).not.toContain('59170000052');   // sin teléfono en la ruta
  });
});
