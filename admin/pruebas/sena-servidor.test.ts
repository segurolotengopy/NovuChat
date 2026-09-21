/**
 * SEÑA POR QR, DE PUNTA A PUNTA: las Functions reales contra el emulador.
 *
 * Las decisiones puras están en `sena-cotejo.test.ts`. Acá se prueba lo que
 * esa suite no ve, en el orden en que pasa de verdad:
 *
 *  1. `registrarQrDeCobro` escribe el QR en el documento del flujo que cobra:
 *     `config/agendamiento` para una clínica que solo agenda, `config/venta`
 *     si además vende, y RECHAZA a un comercio sin ninguno de los dos.
 *  2. `configuracionFlujo` le da al flujo la seña: activa solo con importe Y
 *     QR encendido, con la dirección de la imagen armada por el servidor.
 *  3. La `ingesta` con `evento: 'qr_enviado'` deja la solicitud y cuenta el
 *     QR en la MISMA transacción que el mensaje.
 *  4. `cotejarComprobante` escribe el cierre con su cotejo, el detalle
 *     privado, los contadores y la solicitud, y contesta sin afirmar nunca
 *     un pago. Un segundo comprobante para la misma cita reescribe el cotejo
 *     y NO vuelve a contar el cierre.
 *  5. `senaVencida` es idempotente y no manda nada a nadie.
 *
 * La petición se autentica con el token por número, igual que n8n
 * (`firma.ts`): el valor del secreto sale del entorno, como en producción.
 */
import { beforeAll, describe, expect, it } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
// Alias reservado que ninguna otra suite usa. Valor de prueba, no un secreto.
const TOKEN = 'valor-de-prueba-de-la-sena';
process.env['INGESTA_CLIENTE17'] = TOKEN;

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore } = await import('firebase-admin/firestore');
const db = getFirestore();
const { ingesta, configuracionFlujo } = await import('../functions/src/ingesta.ts');
const { cotejarComprobante, senaVencida } = await import('../functions/src/sena.ts');
const { registrarQrDeCobro } = await import('../functions/src/cobro.ts');

/** Lo que la prohibición 3 no deja decir, en ninguna forma. */
const AFIRMA_PAGO = /acreditad|verificad|recibimos|pago confirmado/i;

const T = 'sena-clinica';           // solo agendamiento: el QR va a config/agendamiento
const T_VENTA = 'sena-mixto';       // agendamiento y venta: el QR va a config/venta
const T_NADA = 'sena-sin-cobro';    // solo captación: no tiene con qué cobrar
const NUMERO = '1000000097';
const TEL_1 = '59170000001';
const TEL_2 = '59170000002';
const TEL_3 = '59170000003';   // sin ninguna seña pendiente: el caso de la cita huérfana
const TEL_4 = '59170000004';   // seña pendiente SIN ningún comprobante: la que sí vence
const MES = new Date().toISOString().slice(0, 7);

// QR Simple reutilizable, de monto abierto, a nombre de PEREZ GOMEZ JUAN CARLOS,
// con la cuenta 1000000890 adentro. El mismo de `qr.test.ts`.
const QR_BUENO = '00020101021126340016com.bcb.qrsimple011010000008905204581253030685802BO5923PEREZ GOMEZ JUAN CARLOS6006LA PAZ63048176';
const TITULAR = 'Juan Carlos Pérez Gómez';
const VENCE_EL = `${new Date().getUTCFullYear() + 1}-06-30`;

interface Respuesta { codigo: number; cuerpo: unknown }

/** Llama a una Function HTTP como lo hace n8n: token por número en la cabecera. */
async function llamar(fn: unknown, cuerpo: Record<string, unknown>): Promise<Respuesta> {
  const cabeceras: Record<string, string> = {
    'x-novuchat-numero': NUMERO, authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json',
  };
  const leer = (n: string) => cabeceras[n.toLowerCase()];
  const peticion = {
    method: 'POST', body: cuerpo, rawBody: Buffer.from(JSON.stringify(cuerpo)),
    headers: cabeceras, get: leer, header: leer,
  };
  const r: Respuesta = { codigo: 0, cuerpo: null };
  const respuesta = {
    status(c: number) { r.codigo = c; return respuesta; },
    send(b: unknown) { r.cuerpo = b; return respuesta; },
    json(b: unknown) { r.cuerpo = b; return respuesta; },
    setHeader() { return respuesta; },
    getHeader() { return undefined; },
    set() { return respuesta; },
    on() { return respuesta; },
    end() { return respuesta; },
  };
  await (fn as (q: unknown, s: unknown) => Promise<void>)(peticion, respuesta);
  return r;
}

/** `registrarQrDeCobro` como la llama la consola: el administrador del comercio. */
function registrarQr(tenantId: string) {
  const f = registrarQrDeCobro as unknown as { run: (r: unknown) => Promise<Record<string, unknown>> };
  return f.run({
    data: {
      tenantId, cargaUtil: QR_BUENO, nombreCuenta: TITULAR, banco: 'Banco de Prueba', venceEl: VENCE_EL,
      confirmaReutilizable: true, confirmaMontoAbierto: true,
    },
    auth: { uid: `u-admin-${tenantId}`, token: { nc: { t: { [tenantId]: 'admin' } } } },
    rawRequest: {},
  });
}

/** Fecha y hora de un instante como las imprime un banco boliviano (UTC−4). */
function enLaPaz(ms: number): { fecha: string; hora: string } {
  const d = new Date(ms - 4 * 3_600_000);
  const dos = (n: number) => String(n).padStart(2, '0');
  return {
    fecha: `${dos(d.getUTCDate())}/${dos(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`,
    hora: `${dos(d.getUTCHours())}:${dos(d.getUTCMinutes())}`,
  };
}

const configAgenda = async () => (await db.doc(`tenants/${T}/config/agendamiento`).get()).data() ?? {};
const conversacion = async (tel: string) => (await db.doc(`tenants/${T}/conversaciones/wa_${tel}`).get()).data() ?? {};
const metricas = async () => (await db.doc(`tenants/${T}/metricas/${MES}`).get()).data() ?? {};
const cierre = async (id: string) => (await db.doc(`tenants/${T}/cierres/${id}`).get()).data();
const privado = async (id: string) => (await db.doc(`tenants/${T}/cierres/${id}/privado/datos`).get()).data();
const bitacora = async (tipo: string) =>
  (await db.collection(`tenants/${T}/bitacora`).where('tipo', '==', tipo).get()).docs.map((d) => d.data());

const qrEnviado = (tel: string, referencia: string) => llamar(ingesta, {
  telefono: tel, direccion: 'saliente', tipo: 'image', texto: 'Seña: 50 Bs · Escaneá el QR',
  evento: 'qr_enviado', referencia, calendario: 'agenda@ejemplo.com',
});
const comprobante = (tel: string, leido: Record<string, unknown>, legible = true, idMeta = 'wamid.comp1') =>
  llamar(cotejarComprobante, { telefono: tel, legible, leido, idMeta });

let cuentaDelQr = '';

beforeAll(async () => {
  for (const t of [T, T_VENTA, T_NADA]) {
    for (const c of ['auditoria', 'bitacora', 'conversaciones', 'cierres']) {
      for (const d of (await db.collection(`tenants/${t}/${c}`).get()).docs) {
        for (const p of (await d.ref.collection('privado').get()).docs) await p.ref.delete();
        await d.ref.delete();
      }
    }
    for (const d of ['config/agendamiento', 'config/venta', `metricas/${MES}`]) await db.doc(`tenants/${t}/${d}`).delete();
  }
  await db.doc(`rutasWhatsApp/${NUMERO}`).set({
    tenantId: T, flujo: 'agendamiento', aliasSecreto: 'cliente17', estado: 'activo',
  });
  await db.doc(`tenants/${T}`).set({ nombre: 'Clínica', estado: 'activo', flujos: ['agendamiento'] });
  await db.doc(`tenants/${T_VENTA}`).set({ nombre: 'Mixto', estado: 'activo', flujos: ['agendamiento', 'venta'] });
  await db.doc(`tenants/${T_NADA}`).set({ nombre: 'Captación', estado: 'activo', flujos: ['onboarding'] });
  await db.doc(`tenants/${T}/cuenta/estado`).set({ plan: 'impulso', estadoPago: 'al_dia' });
  await db.doc(`tenants/${T}/config/negocio`).set({
    nombreNegocio: 'Clínica', zonaHoraria: 'America/La_Paz', moneda: 'BOB',
  });
  await db.doc(`tenants/${T}/config/agendamiento`).set({ senaImporte: 50, senaMinutosRetencion: 45 });
}, 120_000);

describe('1. registrarQrDeCobro elige el documento del flujo que cobra', () => {
  it('una clínica que solo agenda: el QR va a config/agendamiento, apagado', async () => {
    const r = await registrarQr(T);
    expect(r['registrado'], JSON.stringify(r)).toBe(true);
    expect(r['documento']).toBe('agendamiento');
    const cobro = (await configAgenda())['cobroReal'] as Record<string, unknown>;
    expect(cobro).toMatchObject({ activo: false, cargaUtil: QR_BUENO, nombreCuenta: TITULAR });
    expect(String(cobro['ficha'])).toMatch(/^[0-9a-f]{32}$/);
    expect(cobro['cuentas']).toEqual(['1000000890']);
    cuentaDelQr = (cobro['cuentas'] as string[])[0] ?? '';
    // Y lo que ya tenía el documento sigue ahí.
    expect(await configAgenda()).toMatchObject({ senaImporte: 50, senaMinutosRetencion: 45 });
    expect((await db.doc(`tenants/${T}/config/venta`).get()).exists).toBe(false);
  });

  it('un comercio con venta: a config/venta, tenga o no reservas', async () => {
    const r = await registrarQr(T_VENTA);
    expect(r['documento']).toBe('venta');
    expect((await db.doc(`tenants/${T_VENTA}/config/venta`).get()).get('cobroReal.cargaUtil')).toBe(QR_BUENO);
    expect((await db.doc(`tenants/${T_VENTA}/config/agendamiento`).get()).exists).toBe(false);
  });

  it('un comercio sin flujo que cobre: se rechaza y no se escribe nada', async () => {
    await expect(registrarQr(T_NADA)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await db.doc(`tenants/${T_NADA}/config/venta`).get()).exists).toBe(false);
    expect((await db.doc(`tenants/${T_NADA}/config/agendamiento`).get()).exists).toBe(false);
  });
});

describe('2. configuracionFlujo entrega la seña al flujo de reservas', () => {
  it('con el QR apagado: inactiva, importe 0 y sin QR', async () => {
    const r = await llamar(configuracionFlujo, { telefono: TEL_1 });
    expect(r.codigo).toBe(200);
    const sena = (r.cuerpo as Record<string, unknown>)['sena'];
    expect(sena).toEqual({
      activa: false, importe: 0, moneda: 'BOB', minutosRetencion: 45, qr: null,
      pendiente: false, evento: null, qrEnviadoEn: null, vencidaHaceMin: null,
    });
  });

  it('con el QR encendido: activa, con la dirección de la imagen armada por el servidor', async () => {
    // Encenderlo es un acto aparte (`cobro.ts`); acá lo hace la prueba.
    await db.doc(`tenants/${T}/config/agendamiento`).update({ 'cobroReal.activo': true });
    const ficha = String(((await configAgenda())['cobroReal'] as Record<string, unknown>)['ficha']);
    const r = await llamar(configuracionFlujo, { telefono: TEL_1 });
    const sena = (r.cuerpo as Record<string, unknown>)['sena'];
    expect(sena).toEqual({
      activa: true, importe: 50, moneda: 'BOB', minutosRetencion: 45,
      qr: { url: `https://us-east1-${PROYECTO}.cloudfunctions.net/imagenDeCobro?f=${ficha}`, nombreCuenta: TITULAR, banco: 'Banco de Prueba' },
      pendiente: false, evento: null, qrEnviadoEn: null, vencidaHaceMin: null,
    });
    // El flujo de venta no recibe `sena`, y el de agendamiento no recibe `cobroSimulado`.
    expect((r.cuerpo as Record<string, unknown>)['cobroSimulado']).toBeUndefined();
  });

  it('sin teléfono, la seña viene igual pero sin solicitud', async () => {
    const r = await llamar(configuracionFlujo, {});
    expect((r.cuerpo as Record<string, unknown>)['sena']).toMatchObject({ activa: true, pendiente: false, evento: null });
  });
});

describe('3. La ingesta anota el QR enviado', () => {
  it('evento qr_enviado: solicitud en la conversación y senasEnviadas, en la misma escritura que el mensaje', async () => {
    const r = await qrEnviado(TEL_1, 'evt_sena_1');
    expect(r.codigo).toBe(200);
    const c = await conversacion(TEL_1);
    expect(c['solicitud']).toMatchObject({
      etapa: 'qr_enviado', evento: { id: 'evt_sena_1', calendario: 'agenda@ejemplo.com' }, cotejos: 0, seguimientos: 0,
    });
    const enviado = (c['solicitud'] as Record<string, { toMillis(): number } | undefined>)['qrEnviadoEn'];
    expect(enviado?.toMillis()).toBeGreaterThan(Date.now() - 60_000);
    expect(c['mensajesTotal']).toBe(1);
    expect(await metricas()).toMatchObject({ senasEnviadas: 1, mensajes: 1 });
    // Y el flujo ya la ve como pendiente.
    const cfg = await llamar(configuracionFlujo, { telefono: TEL_1 });
    expect((cfg.cuerpo as Record<string, unknown>)['sena']).toMatchObject({
      pendiente: true, evento: { id: 'evt_sena_1', calendario: 'agenda@ejemplo.com' },
    });
    expect(typeof ((cfg.cuerpo as Record<string, unknown>)['sena'] as Record<string, unknown>)['qrEnviadoEn']).toBe('string');
  });

  it('un evento desconocido se ignora: el mensaje se cuenta y la solicitud no cambia', async () => {
    const r = await llamar(ingesta, { telefono: TEL_1, direccion: 'entrante', tipo: 'text', texto: 'ya pagué', evento: 'otro' });
    expect(r.codigo).toBe(200);
    expect((await conversacion(TEL_1))['solicitud']).toMatchObject({ etapa: 'qr_enviado', cotejos: 0 });
    expect((await metricas())['senasEnviadas']).toBe(1);
  });
});

describe('4. cotejarComprobante', () => {
  it('sin teléfono válido es 400; sin token, 401', async () => {
    expect((await comprobante('abc', {})).codigo).toBe(400);
    const sinToken = await (async () => {
      const cabeceras: Record<string, string> = { 'x-novuchat-numero': NUMERO };
      const leer = (n: string) => cabeceras[n.toLowerCase()];
      const r: Respuesta = { codigo: 0, cuerpo: null };
      const respuesta = { status(c: number) { r.codigo = c; return respuesta; }, send() { return respuesta; }, json() { return respuesta; }, setHeader() { return respuesta; }, getHeader() { return undefined; }, set() { return respuesta; }, on() { return respuesta; }, end() { return respuesta; } };
      await (cotejarComprobante as unknown as (q: unknown, s: unknown) => Promise<void>)(
        { method: 'POST', body: {}, rawBody: Buffer.from('{}'), headers: cabeceras, get: leer, header: leer }, respuesta);
      return r;
    })();
    expect(sinToken.codigo).toBe(401);
  });

  it('un teléfono sin QR pendiente: 409 sin_sena_pendiente, y no se escribe nada', async () => {
    const r = await comprobante('59170000009', { monto: '50' });
    expect(r.codigo).toBe(409);
    expect(r.cuerpo).toEqual({ error: 'sin_sena_pendiente' });
    expect((await db.collection(`tenants/${T}/cierres`).get()).size).toBe(0);
  });

  it('CUADRA: cierre con cotejo, detalle privado, contadores, solicitud agendada y bitácora', async () => {
    const { fecha, hora } = enLaPaz(Date.now());
    const r = await comprobante(TEL_1, {
      monto: 'Bs 50.00', cuentaDestino: cuentaDelQr, nombreCuenta: 'PEREZ GOMEZ JUAN CARLOS',
      fecha, hora, banco: 'Banco de Prueba',
    });
    expect(r.codigo, JSON.stringify(r.cuerpo)).toBe(200);
    expect(r.cuerpo).toEqual({
      resultado: 'cuadra', diferencias: [], importe: 50, moneda: 'BOB',
      evento: { id: 'evt_sena_1', calendario: 'agenda@ejemplo.com' }, cierreId: 'cita_evt_sena_1',
    });
    expect(JSON.stringify(r.cuerpo)).not.toMatch(AFIRMA_PAGO);

    const c = await cierre('cita_evt_sena_1');
    expect(c).toMatchObject({
      tipo: 'cita', referencia: 'evt_sena_1', telefonoEnmascarado: '591****001', monto: 50, moneda: 'BOB',
      cotejo: { resultado: 'cuadra', diferencias: [], montoLeido: 50, banco: 'Banco de Prueba', idMeta: 'wamid.comp1', intentos: 1 },
    });
    expect(c?.['comprobadoPor']).toBeUndefined();     // eso lo pone la clínica, nunca el servidor
    expect(Object.keys(c ?? {}).sort()).toEqual(['cotejo', 'moneda', 'monto', 'ocurridoEn', 'referencia', 'telefonoEnmascarado', 'tipo']);
    expect(await privado('cita_evt_sena_1')).toEqual({
      telefono: TEL_1, conversacionId: `wa_${TEL_1}`, detalle: 'Seña de 50 Bs, comprobante los datos coinciden',
    });
    expect(await metricas()).toMatchObject({ cierres: 1, senasCotejadas: 1, senasEnviadas: 1 });
    expect((await conversacion(TEL_1))['solicitud']).toMatchObject({ etapa: 'agendada', cotejos: 1, evento: { id: 'evt_sena_1' } });
    const renglones = await bitacora('cobro_cotejado');
    expect(renglones).toHaveLength(1);
    expect(renglones[0]).toMatchObject({ resultado: 'ok', codigo: 'cuadra', destinoEnmascarado: '5917****001', conversacionId: `wa_${TEL_1}` });
    // El flujo ya no la ve pendiente.
    const cfg = await llamar(configuracionFlujo, { telefono: TEL_1 });
    expect((cfg.cuerpo as Record<string, unknown>)['sena']).toMatchObject({ pendiente: false, evento: { id: 'evt_sena_1' } });
  });

  it('otro comprobante para una cita ya agendada: 409, sin tocar el cierre', async () => {
    const r = await comprobante(TEL_1, { monto: '50' });
    expect(r.codigo).toBe(409);
    expect((await cierre('cita_evt_sena_1'))?.['cotejo']).toMatchObject({ intentos: 1 });
    expect((await metricas())['senasCotejadas']).toBe(1);
  });

  it('NO CUADRA: el cierre nace igual, con la diferencia, y la solicitud sigue pendiente', async () => {
    await qrEnviado(TEL_2, 'evt_sena_2');
    const { fecha, hora } = enLaPaz(Date.now());
    const r = await comprobante(TEL_2, { monto: '40', cuentaDestino: cuentaDelQr, fecha, hora }, true, 'wamid.comp2');
    expect(r.codigo).toBe(200);
    expect(r.cuerpo).toMatchObject({ resultado: 'no_cuadra', cierreId: 'cita_evt_sena_2', importe: 50 });
    expect((r.cuerpo as { diferencias: string[] }).diferencias).toEqual(['El comprobante dice 40 y el pedido es de 50.']);
    expect(JSON.stringify(r.cuerpo)).not.toMatch(AFIRMA_PAGO);
    expect((await cierre('cita_evt_sena_2'))?.['cotejo']).toMatchObject({ resultado: 'no_cuadra', montoLeido: 40, intentos: 1, idMeta: 'wamid.comp2' });
    expect(await privado('cita_evt_sena_2')).toMatchObject({ detalle: 'Seña de 50 Bs, comprobante con una diferencia' });
    expect((await conversacion(TEL_2))['solicitud']).toMatchObject({ etapa: 'qr_enviado', cotejos: 1 });
    expect(await metricas()).toMatchObject({ cierres: 2, senasCotejadas: 2, senasEnviadas: 2 });
  });

  it('ILEGIBLE después: se reescribe el cotejo con el intento 2 y el cierre NO se cuenta de nuevo', async () => {
    const r = await comprobante(TEL_2, {}, false, 'wamid.comp3');
    expect(r.codigo).toBe(200);
    expect(r.cuerpo).toMatchObject({ resultado: 'ilegible', diferencias: ['No se pudo leer el comprobante.'] });
    expect(JSON.stringify(r.cuerpo)).not.toMatch(AFIRMA_PAGO);
    const c = await cierre('cita_evt_sena_2');
    expect(c?.['cotejo']).toMatchObject({ resultado: 'ilegible', montoLeido: null, intentos: 2, idMeta: 'wamid.comp3' });
    expect(c).toMatchObject({ referencia: 'evt_sena_2', monto: 50 });
    // El detalle privado es del primer registro: no se reescribe.
    expect(await privado('cita_evt_sena_2')).toMatchObject({ detalle: 'Seña de 50 Bs, comprobante con una diferencia' });
    expect(await metricas()).toMatchObject({ cierres: 2, senasCotejadas: 3 });
    expect((await conversacion(TEL_2))['solicitud']).toMatchObject({ etapa: 'qr_enviado', cotejos: 2 });
    expect(await bitacora('cobro_cotejado')).toHaveLength(3);
  });

  it('con la seña apagada entre el QR y el comprobante: 409 sena_inactiva', async () => {
    await db.doc(`tenants/${T}/config/agendamiento`).update({ senaImporte: 0 });
    const r = await comprobante(TEL_2, { monto: '50' });
    expect(r.codigo).toBe(409);
    expect(r.cuerpo).toEqual({ error: 'sena_inactiva' });
    await db.doc(`tenants/${T}/config/agendamiento`).update({ senaImporte: 50 });
  });

  it('un comprobante NUNCA se guarda: ni en el cierre, ni en la conversación, ni en la bitácora', async () => {
    const todo = JSON.stringify([
      await cierre('cita_evt_sena_2'), await privado('cita_evt_sena_2'), await conversacion(TEL_2),
      await bitacora('cobro_cotejado'),
    ]);
    expect(todo).not.toMatch(/imagen|base64|mediaId|data:image/i);
    expect(todo).not.toMatch(AFIRMA_PAGO);
  });
});

describe('5. senaVencida', () => {
  const vencida = (telefono: string, referencia: string, extra: Record<string, unknown> = {}) =>
    llamar(senaVencida, { telefono, referencia, ...extra });
  /** Una cita creada hace `min` minutos, como la reporta el flujo. */
  const creadaHace = (min: number) => ({
    creadoEn: new Date(Date.now() - min * 60 * 1000).toISOString(), minutosRetencion: 15,
  });

  it('sin referencia es 400', async () => {
    expect((await vencida(TEL_2, '')).codigo).toBe(400);
  });

  it('una cita ya agendada NO se vence: lo dice, sin tocar nada', async () => {
    const r = await vencida(TEL_1, 'evt_sena_1');
    expect(r.cuerpo).toEqual({ registrado: false, repetido: false, motivo: 'ya_agendada' });
    expect((await conversacion(TEL_1))['solicitud']).toMatchObject({ etapa: 'agendada' });
  });

  it('otra referencia que la retenida: no es esta seña', async () => {
    const r = await vencida(TEL_2, 'evt_otra');
    // Sin `creadoEn` no se puede saber si venció, así que no se autoriza nada.
    // El motivo ya NO es `sin_sena_pendiente`: ese estaba en la lista con la
    // que el flujo BORRA, y este caso terminaba en un borrado (20/09/2026).
    expect(r.cuerpo).toEqual({ registrado: false, repetido: false, motivo: 'sin_fecha_de_creacion' });
    expect((await conversacion(TEL_2))['solicitud']).toMatchObject({ etapa: 'qr_enviado' });
  });

  // --- UN COMPROBANTE EN REVISIÓN NO VENCE (2026-09-20) ---------------------
  // Prueba real con el teléfono: el paciente pagó 1 Bs de verdad y el cotejo
  // dijo «no cuadra» porque no entendió la fecha. El flujo le contestó «lo
  // revisa una persona, tu horario sigue reservado» y este endpoint, cinco
  // minutos después, autorizaba BORRARLE la cita. TEL_2 llega acá con dos
  // cotejos (uno que no cuadró y uno ilegible): es exactamente ese caso.
  it('una seña CON comprobante en revisión NO vence: la decide una persona', async () => {
    const r = await vencida(TEL_2, 'evt_sena_2');
    expect(r.codigo).toBe(200);
    expect(r.cuerpo).toEqual({ registrado: false, repetido: false, motivo: 'comprobante_en_revision' });
    // Sigue pendiente: ni vencida, ni contada, ni anotada.
    expect((await conversacion(TEL_2))['solicitud']).toMatchObject({ etapa: 'qr_enviado', cotejos: 2 });
    expect((await metricas())['senasVencidas'] ?? 0).toBe(0);
    expect(await bitacora('sena_vencida')).toHaveLength(0);
  });

  it('pero la protección NO es para siempre: pasada la ventana, vence y queda contada aparte', async () => {
    // El híbrido (Andres, 20/09): proteger siempre convertiría cualquier imagen
    // en un horario bloqueado eternamente. Se envejece el cotejo tres horas.
    const ref = db.doc(`tenants/${T}/cierres/cita_evt_sena_2`);
    const viejo = (await ref.get()).get('cotejo') as Record<string, unknown>;
    await ref.set({ cotejo: { ...viejo, en: new Date(Date.now() - 3 * 60 * 60 * 1000) } }, { merge: true });

    const r = await vencida(TEL_2, 'evt_sena_2');
    expect(r.cuerpo).toEqual({ registrado: true, repetido: false, conComprobante: true });
    expect((await conversacion(TEL_2))['solicitud']).toMatchObject({ etapa: 'vencida', cotejos: 2 });
    // Contada aparte: no es lo mismo que una seña que nadie pagó nunca.
    expect((await metricas())['senasVencidasConComprobante']).toBe(1);
    const renglones = await bitacora('sena_vencida');
    expect(renglones.some((x) => x['codigo'] === 'liberada_con_comprobante')).toBe(true);
  });

  it('la retención SIN comprobante sí vence: solicitud vencida, senasVencidas y bitácora', async () => {
    await qrEnviado(TEL_4, 'evt_sena_4');
    const r = await vencida(TEL_4, 'evt_sena_4');
    expect(r.codigo).toBe(200);
    expect(r.cuerpo).toEqual({ registrado: true, repetido: false });
    expect((await conversacion(TEL_4))['solicitud']).toMatchObject({ etapa: 'vencida', cotejos: 0, evento: { id: 'evt_sena_4' } });
    expect((await metricas())['senasVencidas']).toBe(2);   // la de TEL_2 (con comprobante) y esta
    const renglones = await bitacora('sena_vencida');
    expect(renglones).toHaveLength(2);
    const suyo = renglones.find((x) => x['destinoEnmascarado'] === '5917****004');
    expect(suyo).toMatchObject({ resultado: 'ok' });
    // Y esta NO lleva el código: nadie mandó nunca un comprobante.
    expect(suyo?.['codigo']).toBeUndefined();
    // Ningún mensaje salió: la conversación no tiene salientes nuevos.
    const mensajes = await db.collection(`tenants/${T}/conversaciones/wa_${TEL_4}/mensajes`).get();
    expect(mensajes.docs.filter((d) => d.get('direccion') === 'saliente')).toHaveLength(1);   // solo el QR
  });

  it('la segunda vez es repetido y no cuenta de nuevo', async () => {
    const r = await vencida(TEL_4, 'evt_sena_4');
    expect(r.cuerpo).toEqual({ registrado: false, repetido: true });
    expect((await metricas())['senasVencidas']).toBe(2);
    expect(await bitacora('sena_vencida')).toHaveLength(2);
  });

  it('un comprobante que llega después del vencimiento: 409, y la clínica lo resuelve', async () => {
    const r = await comprobante(TEL_4, { monto: '50' });
    expect(r.codigo).toBe(409);
    expect(r.cuerpo).toEqual({ error: 'sin_sena_pendiente' });
  });

  // --- LA CITA HUÉRFANA (decisión de Andres, 20/09/2026) --------------------
  // Un horario con el rótulo «PENDIENTE DE SEÑA» y SIN seña pendiente en el
  // servidor es un horario bloqueado que nadie va a pagar: pasa cuando el QR no
  // llegó a salir, que es lo que ocurrió el 20/09 con una clienta real. Antes
  // quedaba ahí para siempre, porque el servidor no autorizaba borrarla.

  it('una huérfana vencida SÍ se autoriza a borrar, y queda contada y anotada', async () => {
    const r = await vencida(TEL_3, 'evt_huerfana', creadaHace(40));
    expect(r.codigo).toBe(200);
    expect(r.cuerpo).toEqual({ registrado: true, repetido: false, motivo: 'huerfana' });
    expect((await metricas())['senasHuerfanas']).toBe(1);
    const renglones = await bitacora('sena_vencida');
    expect(renglones.some((x) => x['codigo'] === 'huerfana')).toBe(true);
  });

  // EL MOTIVO IMPORTA TANTO COMO EL «NO» (2026-09-20). Estos dos casos ya
  // contestaban `registrado: false`, pero con el motivo `sin_sena_pendiente`,
  // que estaba en la lista con la que el flujo BORRA: el servidor decía que no
  // y la cita se borraba igual. Ahora cada uno dice lo suyo, y ninguno de los
  // dos hace borrar (`senas-vencidas.test.ts` lo comprueba sobre la condición).
  it('una huérfana que TODAVÍA no cumplió la retención NO se borra', async () => {
    const r = await vencida(TEL_3, 'evt_huerfana_nueva', creadaHace(3));
    expect(r.cuerpo).toEqual({ registrado: false, repetido: false, motivo: 'todavia_no_vence' });
  });

  it('sin saber cuándo se creó tampoco se borra: no se autoriza a ciegas', async () => {
    const r = await vencida(TEL_3, 'evt_huerfana_sin_fecha');
    expect(r.cuerpo).toEqual({ registrado: false, repetido: false, motivo: 'sin_fecha_de_creacion' });
  });

  it('una cita YA PAGADA con el rótulo puesto NO se borra: eso destruiría una cita paga', async () => {
    // El caso peligroso: el comprobante cuadró y lo que falló fue quitarle el
    // rótulo. El cierre con `cuadra` es la prueba de que alguien pagó.
    await db.doc(`tenants/${T}/cierres/cita_evt_pagada`).set({
      tipo: 'cita', referencia: 'evt_pagada', cotejo: { resultado: 'cuadra' },
    });
    const r = await vencida(TEL_3, 'evt_pagada', creadaHace(90));
    expect(r.cuerpo).toEqual({ registrado: false, repetido: false, motivo: 'cita_pagada' });
    // Y queda anotado para que una persona lo mire.
    const renglones = await bitacora('sena_vencida');
    expect(renglones.some((x) => x['codigo'] === 'cita_pagada_con_rotulo' && x['resultado'] === 'rechazado')).toBe(true);
  });

  // UNA HUÉRFANA CON COMPROBANTE TAMBIÉN TIENE MOTIVO (Andres, 20/09/2026).
  // Antes acá se liberaba igual: «no hay seña pendiente, no hay nadie
  // esperando». Pero si hay cotejo, alguien mandó un comprobante, y eso es un
  // motivo aunque el servidor ya no retenga la seña. Se protege mientras una
  // persona puede resolverlo, y ni un minuto más.
  it('una huérfana con un comprobante RECIENTE se protege: alguien la reclamó', async () => {
    await db.doc(`tenants/${T}/cierres/cita_evt_nocuadra`).set({
      tipo: 'cita', referencia: 'evt_nocuadra',
      cotejo: { resultado: 'no_cuadra', en: new Date() },
    });
    const r = await vencida(TEL_3, 'evt_nocuadra', creadaHace(90));
    expect(r.cuerpo).toEqual({ registrado: false, repetido: false, motivo: 'comprobante_en_revision' });
  });

  it('y con el comprobante VIEJO se libera igual, contada y anotada aparte', async () => {
    await db.doc(`tenants/${T}/cierres/cita_evt_nocuadra`).set({
      tipo: 'cita', referencia: 'evt_nocuadra',
      cotejo: { resultado: 'no_cuadra', en: new Date(Date.now() - 3 * 60 * 60 * 1000) },
    }, { merge: true });
    const r = await vencida(TEL_3, 'evt_nocuadra', creadaHace(90));
    expect(r.cuerpo).toEqual({ registrado: true, repetido: false, motivo: 'huerfana', conComprobante: true });
    expect((await metricas())['senasHuerfanasConComprobante']).toBe(1);
    const renglones = await bitacora('sena_vencida');
    expect(renglones.some((x) => x['codigo'] === 'liberada_con_comprobante')).toBe(true);
  });

  it('un cotejo ILEGIBLE protege igual que uno que no cuadró: también hubo un comprobante', async () => {
    await db.doc(`tenants/${T}/cierres/cita_evt_ilegible`).set({
      tipo: 'cita', referencia: 'evt_ilegible',
      cotejo: { resultado: 'ilegible', en: new Date() },
    });
    const r = await vencida(TEL_3, 'evt_ilegible', creadaHace(90));
    expect(r.cuerpo).toEqual({ registrado: false, repetido: false, motivo: 'comprobante_en_revision' });
  });

  it('sin marca de cuándo llegó el comprobante, la ventana se cuenta desde la cita', async () => {
    // Un cierre sin `en` es un defecto NUESTRO. La ventana igual tiene final:
    // se toma cuándo se creó la cita, así nada queda bloqueado para siempre.
    await db.doc(`tenants/${T}/cierres/cita_evt_sinmarca`).set({
      tipo: 'cita', referencia: 'evt_sinmarca', cotejo: { resultado: 'no_cuadra' },
    });
    expect((await vencida(TEL_3, 'evt_sinmarca', creadaHace(30))).cuerpo)
      .toMatchObject({ registrado: false, motivo: 'comprobante_en_revision' });
    expect((await vencida(TEL_3, 'evt_sinmarca', creadaHace(200))).cuerpo)
      .toMatchObject({ registrado: true, motivo: 'huerfana', conComprobante: true });
  });

  it('un QR nuevo para el mismo teléfono abre otra solicitud desde cero', async () => {
    await qrEnviado(TEL_2, 'evt_sena_3');
    expect((await conversacion(TEL_2))['solicitud']).toMatchObject({ etapa: 'qr_enviado', cotejos: 0, evento: { id: 'evt_sena_3' } });
    expect((await metricas())['senasEnviadas']).toBe(4);   // los tres de antes y el de TEL_4
  });
});
