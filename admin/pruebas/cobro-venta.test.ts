/**
 * COBRO REAL DE UNA VENTA, DE PUNTA A PUNTA: las Functions contra el emulador.
 *
 * LA DIFERENCIA QUE ESTA SUITE DEFIENDE, y es una sola: en una reserva el
 * importe esperado se LEE de la configuración (`senaImporte`, fijo); en una
 * venta se FIJA cuando sale el QR, porque el total cambia con cada pedido. Todo
 * lo demás —quién coteja, qué se guarda, qué se responde y qué no se dice
 * nunca— es idéntico al de la seña, y tiene que seguir siéndolo.
 *
 * Lo que se prueba, en el orden en que pasa de verdad:
 *
 *  1. `configuracionFlujo` le da al flujo de venta el estado del cobro: en qué
 *     modo está el comercio y si hay un QR esperando el comprobante de ESTE
 *     teléfono. Sale en los DOS modos, real y simulado: la compuerta del
 *     comprobante tiene que funcionar también en la demostración.
 *  2. La ingesta con `evento: 'qr_enviado'` guarda el TOTAL en la solicitud,
 *     en la misma transacción que cuenta el mensaje.
 *  3. `cotejarComprobante` compara contra ese total y no contra ninguna
 *     configuración; escribe `cierres/venta_…`; y cuando el pedido vino del
 *     carrito web, manda el total que calculó el SERVIDOR.
 *  4. Los casos que NO cotejan: sin total, con el QR caducado, sin pendiente.
 *  5. `imagenDeCobro` deja de servir un QR vencido.
 *
 * NINGUNA FRASE AFIRMA UN PAGO (prohibición 3): se comprueba con una expresión
 * regular sobre cada texto que sale del servidor.
 */
import { beforeAll, describe, expect, it } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
// Alias reservado que ninguna otra suite usa. Valor de prueba, no un secreto.
const TOKEN = 'valor-de-prueba-del-cobro-de-venta';
process.env['INGESTA_CLIENTE18'] = TOKEN;

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const db = getFirestore();
const { ingesta, configuracionFlujo } = await import('../functions/src/ingesta.ts');
const { cotejarComprobante } = await import('../functions/src/sena.ts');
const { imagenDeCobro, registrarQrDeCobro } = await import('../functions/src/cobro.ts');
const {
  MINUTOS_QR_VENTA, cobroParaElFlujo, detalleDeLaVenta, esperadoDeLaVenta,
  idDeCierreDeVenta, qrDeVentaVencido, totalUtilizable,
} = await import('../functions/src/cobroVenta.ts');

/** Lo que la prohibición 3 no deja decir, en ninguna forma. */
const AFIRMA_PAGO = /acreditad|verificad|recibimos|pago confirmado/i;

const T = 'cobro-tienda';
const NUMERO = '1000000098';
// Los teléfonos de prueba llevan SEIS CEROS seguidos, que es lo que el saneo
// del repositorio público exige para distinguir un número inventado de uno real
// (`CONVENCIONES-REPO-PUBLICO.md`). El comercio es otro que el de la seña, así
// que los mismos números no se cruzan con los de `sena-servidor.test.ts`.
const TEL_1 = '59170000001';   // el camino feliz, con el total del asistente
const TEL_2 = '59170000002';   // el pedido del carrito web: manda el total del servidor
const TEL_3 = '59170000003';   // QR enviado SIN total
const TEL_4 = '59170000004';   // QR caducado por reloj
const TEL_5 = '59170000005';   // sin ningún QR pendiente
const MES = new Date().toISOString().slice(0, 7);

// El mismo QR Simple de `qr.test.ts`: reutilizable, de monto abierto, a nombre
// de PEREZ GOMEZ JUAN CARLOS, con la cuenta 1000000890 adentro.
const QR_BUENO = '00020101021126340016com.bcb.qrsimple011010000008905204581253030685802BO5923PEREZ GOMEZ JUAN CARLOS6006LA PAZ63048176';
const TITULAR = 'Juan Carlos Pérez Gómez';
const CUENTA = '1000000890';
const VENCE_EL = `${new Date().getUTCFullYear() + 1}-06-30`;

interface Respuesta { codigo: number; cuerpo: unknown }

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
    setHeader() { return respuesta; }, getHeader() { return undefined; },
    set() { return respuesta; }, on() { return respuesta; }, end() { return respuesta; },
  };
  await (fn as (q: unknown, s: unknown) => Promise<void>)(peticion, respuesta);
  return r;
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

const conversacion = async (tel: string) => (await db.doc(`tenants/${T}/conversaciones/wa_${tel}`).get()).data() ?? {};
const metricas = async () => (await db.doc(`tenants/${T}/metricas/${MES}`).get()).data() ?? {};
const cierre = async (id: string) => (await db.doc(`tenants/${T}/cierres/${id}`).get()).data();
const privado = async (id: string) => (await db.doc(`tenants/${T}/cierres/${id}/privado/datos`).get()).data();

const qrEnviado = (tel: string, referencia: string, monto?: number) => llamar(ingesta, {
  telefono: tel, direccion: 'saliente', tipo: 'image', texto: 'Tu pedido: 597 Bs. Escaneá el QR',
  evento: 'qr_enviado', referencia, ...(monto === undefined ? {} : { monto }),
});
const comprobante = (tel: string, leido: Record<string, unknown>, legible = true, idMeta = 'wamid.c1') =>
  llamar(cotejarComprobante, { telefono: tel, legible, leido, idMeta });

const leidoDe = (monto: string, ms = Date.now()) => ({
  monto, cuentaDestino: CUENTA, nombreCuenta: 'PEREZ GOMEZ JUAN CARLOS', banco: 'BNB', ...enLaPaz(ms),
});

beforeAll(async () => {
  for (const c of ['auditoria', 'bitacora', 'conversaciones', 'cierres', 'pedidos']) {
    for (const d of (await db.collection(`tenants/${T}/${c}`).get()).docs) {
      for (const p of (await d.ref.collection('privado').get()).docs) await p.ref.delete();
      await d.ref.delete();
    }
  }
  for (const d of ['config/venta', `metricas/${MES}`]) await db.doc(`tenants/${T}/${d}`).delete();
  await db.doc(`rutasWhatsApp/${NUMERO}`).set({
    tenantId: T, flujo: 'venta', aliasSecreto: 'cliente18', estado: 'activo',
  });
  await db.doc(`tenants/${T}`).set({ nombre: 'Tienda', estado: 'activo', flujos: ['venta'] });
  await db.doc(`tenants/${T}/cuenta/estado`).set({ plan: 'impulso', estadoPago: 'al_dia' });
  await db.doc(`tenants/${T}/config/negocio`).set({
    nombreNegocio: 'Tienda', zonaHoraria: 'America/La_Paz', moneda: 'BOB',
  });
  await db.doc(`tenants/${T}/config/venta`).set({ costoDelivery: 7, mediaIdQr: '1000000000000001' });
}, 120_000);

// ===========================================================================

describe('1. Las decisiones puras: el total manda, y el pendiente caduca', () => {
  it('un total utilizable es finito, positivo y dentro del techo', () => {
    expect(totalUtilizable(597)).toBe(597);
    expect(totalUtilizable(1234.5)).toBe(1234.5);
    expect(totalUtilizable(1234.567)).toBe(1234.57);
    for (const malo of [0, -1, NaN, Infinity, '597', null, undefined, {}, 2_000_000]) {
      expect(totalUtilizable(malo), String(malo)).toBeNull();
    }
  });

  it('el esperado de una venta lleva el total del pedido, no ninguna configuración', () => {
    const e = esperadoDeLaVenta(597, { nombreCuenta: TITULAR, cuentas: [CUENTA] }, 1000, 2000, 10);
    expect(e).toEqual({
      monto: 597, nombreCuenta: TITULAR, cuentas: [CUENTA],
      qrEnviadoEn: 1000, comprobanteRecibidoEn: 2000, toleranciaMin: 10,
    });
    // Como en la seña: a lo sumo cinco cuentas, y todas como texto.
    expect(esperadoDeLaVenta(1, { cuentas: [1, 2, 3, 4, 5, 6] }, 0, 0, 10).cuentas)
      .toEqual(['1', '2', '3', '4', '5']);
  });

  it('el id del cierre es la MISMA cuenta que `registrarCierre` para una venta', () => {
    // Si las dos no coincidieran, la misma venta se contaría dos veces.
    expect(idDeCierreDeVenta('wamid.ABC-123')).toBe('venta_wamidABC-123');
    expect(idDeCierreDeVenta('x'.repeat(200))).toBe('venta_' + 'x'.repeat(120));
  });

  it('el QR de venta caduca a las 24 h, que es la ventana de la conversación', () => {
    expect(MINUTOS_QR_VENTA).toBe(24 * 60);
    const ahora = 1_700_000_000_000;
    const recien = { etapa: 'qr_enviado', qrEnviadoEn: ahora - 60_000 };
    expect(qrDeVentaVencido(recien, ahora).vencido).toBe(false);
    const viejo = { etapa: 'qr_enviado', qrEnviadoEn: ahora - 25 * 3_600_000 };
    expect(qrDeVentaVencido(viejo, ahora).vencido).toBe(true);
    // Sin etapa `qr_enviado` no hay nada que vencer.
    expect(qrDeVentaVencido({ etapa: 'agendada', qrEnviadoEn: 0 }, ahora).vencido).toBe(false);
    expect(qrDeVentaVencido(null, ahora).vencido).toBe(false);
    // Sin marca de cuándo salió, tampoco: no se inventa un plazo.
    expect(qrDeVentaVencido({ etapa: 'qr_enviado' }, ahora).vencido).toBe(false);
  });

  it('ningún detalle del cierre afirma que el dinero entró', () => {
    for (const r of ['cuadra', 'no_cuadra', 'ilegible'] as const) {
      const t = detalleDeLaVenta(597, 'BOB', r);
      expect(t, r).not.toMatch(AFIRMA_PAGO);
      expect(t, r).toContain('597 Bs');
    }
    expect(detalleDeLaVenta(597, 'BOB', 'cuadra')).toContain('los datos coinciden');
  });

  it('`cobroParaElFlujo` sale en los DOS modos, y solo el real trae QR', () => {
    const url = (f: string) => `https://panel/imagenDeCobro?f=${f}`;
    const apagado = cobroParaElFlujo({ cobroReal: { ficha: 'abc' } }, false, 'BOB', url, null);
    expect(apagado).toMatchObject({ activo: false, qr: null, pendiente: false, monto: null });
    const encendido = cobroParaElFlujo(
      { cobroReal: { ficha: 'abc', nombreCuenta: TITULAR, banco: 'BNB' } }, true, 'BOB', url, null);
    expect(encendido.activo).toBe(true);
    expect(encendido.qr).toEqual({ url: url('abc'), nombreCuenta: TITULAR, banco: 'BNB' });
  });
});

describe('2. configuracionFlujo le da al flujo de venta el estado del cobro', () => {
  it('con el QR apagado: modo SIMULADO, con sus rótulos, y el bloque `cobro` igual', async () => {
    const r = await llamar(configuracionFlujo, { telefono: TEL_1 });
    expect(r.codigo).toBe(200);
    const c = r.cuerpo as Record<string, any>;
    expect(c['cobroReal']).toBeUndefined();
    expect(c['cobroSimulado']).toMatchObject({ mediaIdQr: '1000000000000001' });
    expect(String(c['cobroSimulado'].epigrafe)).toMatch(/SIMULADO/i);
    // El bloque del pendiente sale igual: la compuerta del comprobante tiene
    // que funcionar también en la demostración.
    expect(c['cobro']).toMatchObject({ activo: false, qr: null, pendiente: false, monto: null });
  });

  it('con el QR registrado y ENCENDIDO: modo REAL, sin un solo rótulo', async () => {
    const f = registrarQrDeCobro as unknown as { run: (r: unknown) => Promise<Record<string, unknown>> };
    const alta = await f.run({
      data: { tenantId: T, cargaUtil: QR_BUENO, nombreCuenta: TITULAR, banco: 'BNB', venceEl: VENCE_EL,
        confirmaReutilizable: true, confirmaMontoAbierto: true },
      auth: { uid: 'u-admin', token: { nc: { t: { [T]: 'admin' } } } }, rawRequest: {},
    });
    expect(alta['registrado'], JSON.stringify(alta)).toBe(true);
    expect(alta['documento']).toBe('venta');
    // Nace APAGADO a propósito: encenderlo es un acto aparte.
    let r = await llamar(configuracionFlujo, { telefono: TEL_1 });
    expect((r.cuerpo as Record<string, any>)['cobroSimulado']).toBeDefined();

    await db.doc(`tenants/${T}/config/venta`).set({ cobroReal: { activo: true } }, { merge: true });
    r = await llamar(configuracionFlujo, { telefono: TEL_1 });
    const c = r.cuerpo as Record<string, any>;
    expect(c['cobroSimulado']).toBeUndefined();
    expect(c['cobroReal']).toMatchObject({ nombreCuenta: TITULAR, banco: 'BNB', cuentas: [CUENTA] });
    expect(c['cobro'].activo).toBe(true);
    expect(String(c['cobro'].qr.url)).toMatch(/^https:\/\/.+\/imagenDeCobro\?f=[0-9a-f]{32}$/);
    // Y en ninguna parte de la respuesta aparece la carga útil del QR.
    expect(JSON.stringify(r.cuerpo)).not.toContain(QR_BUENO);
  });

  it('un cobro real a medio configurar cae al camino que NO mueve dinero', async () => {
    // Encendido pero sin código: `cobroRealActivo` exige las tres cosas.
    await db.doc(`tenants/${T}/config/venta`).set({ cobroReal: { cargaUtil: '' } }, { merge: true });
    const r = await llamar(configuracionFlujo, { telefono: TEL_1 });
    expect((r.cuerpo as Record<string, any>)['cobroSimulado']).toBeDefined();
    expect((r.cuerpo as Record<string, any>)['cobroReal']).toBeUndefined();
    await db.doc(`tenants/${T}/config/venta`).set({ cobroReal: { cargaUtil: QR_BUENO } }, { merge: true });
  });
});

describe('3. La ingesta guarda el total cuando sale el QR', () => {
  it('`qr_enviado` deja la solicitud con su total, y cuenta el mensaje', async () => {
    const r = await qrEnviado(TEL_1, 'wamid.qr1', 597);
    expect(r.codigo).toBe(200);
    const s = (await conversacion(TEL_1))['solicitud'] as Record<string, unknown>;
    expect(s['etapa']).toBe('qr_enviado');
    expect(s['monto']).toBe(597);
    expect((s['evento'] as Record<string, unknown>)['id']).toBe('wamid.qr1');
    expect((await conversacion(TEL_1))['mensajesTotal']).toBe(1);
  });

  it('un total que no se puede usar NO se guarda como cero', async () => {
    await qrEnviado(TEL_3, 'wamid.qr3');
    expect(((await conversacion(TEL_3))['solicitud'] as Record<string, unknown>)['monto']).toBeNull();
    await llamar(ingesta, { telefono: TEL_3, direccion: 'saliente', tipo: 'image', texto: 'x',
      evento: 'qr_enviado', referencia: 'wamid.qr3b', monto: -5 });
    expect(((await conversacion(TEL_3))['solicitud'] as Record<string, unknown>)['monto']).toBeNull();
  });

  it('y el flujo lo recibe de vuelta en `cobro.pendiente` y `cobro.monto`', async () => {
    const r = await llamar(configuracionFlujo, { telefono: TEL_1 });
    const c = (r.cuerpo as Record<string, any>)['cobro'];
    expect(c.pendiente).toBe(true);
    expect(c.monto).toBe(597);
    expect(c.pedido).toBe('wamid.qr1');
    expect(typeof c.qrEnviadoEn).toBe('string');
    // Y otro teléfono no ve nada: el pendiente es de quien escribió.
    expect((await llamar(configuracionFlujo, { telefono: TEL_5 })).cuerpo as Record<string, any>)
      .toMatchObject({ cobro: { pendiente: false, monto: null } });
  });
});

describe('4. cotejarComprobante compara contra el TOTAL DEL PEDIDO', () => {
  it('CUADRA: el comprobante por el total del pedido, con la cuenta del QR', async () => {
    const r = await comprobante(TEL_1, leidoDe('Bs 597,00'));
    expect(r.codigo).toBe(200);
    expect(r.cuerpo).toMatchObject({ resultado: 'cuadra', diferencias: [], importe: 597, moneda: 'BOB' });
    // El cierre es de tipo venta, con el total y el cotejo adentro.
    const c = await cierre('venta_wamidqr1');
    expect(c).toMatchObject({ tipo: 'venta', referencia: 'wamid.qr1', monto: 597, moneda: 'BOB' });
    expect((c!['cotejo'] as Record<string, unknown>)['resultado']).toBe('cuadra');
    expect((c!['cotejo'] as Record<string, unknown>)['montoLeido']).toBe(597);
    // El teléfono completo vive en el subdocumento privado, no en el cierre.
    expect(JSON.stringify(c)).not.toContain(TEL_1);
    expect((await privado('venta_wamidqr1'))!['telefono']).toBe(TEL_1);
    expect(String((await privado('venta_wamidqr1'))!['detalle'])).not.toMatch(AFIRMA_PAGO);
    // Y la solicitud avanza: la próxima imagen ya no es un comprobante.
    expect(((await conversacion(TEL_1))['solicitud'] as Record<string, unknown>)['etapa']).toBe('agendada');
    expect(await metricas()).toMatchObject({ cobrosCotejados: 1, cierres: 1 });
  });

  it('NO CUADRA si el importe no es el del pedido, y lo dice con los dos números', async () => {
    await qrEnviado(TEL_2, 'wamid.qr2', 350);
    const r = await comprobante(TEL_2, leidoDe('Bs 300,00'), true, 'wamid.c2');
    expect(r.codigo).toBe(200);
    const cuerpo = r.cuerpo as Record<string, any>;
    expect(cuerpo['resultado']).toBe('no_cuadra');
    expect(String(cuerpo['diferencias'][0])).toContain('300');
    expect(String(cuerpo['diferencias'][0])).toContain('350');
    // El pendiente NO avanza: el próximo archivo se vuelve a cotejar.
    expect(((await conversacion(TEL_2))['solicitud'] as Record<string, unknown>)['etapa']).toBe('qr_enviado');
  });

  it('un segundo comprobante reescribe el cotejo y NO cuenta el cierre dos veces', async () => {
    const antes = (await metricas())['cierres'];
    const r = await comprobante(TEL_2, leidoDe('Bs 350,00'), true, 'wamid.c3');
    expect(r.cuerpo).toMatchObject({ resultado: 'cuadra', importe: 350 });
    expect((await metricas())['cierres']).toBe(antes);
    const c = await cierre('venta_wamidqr2');
    expect((c!['cotejo'] as Record<string, unknown>)['idMeta']).toBe('wamid.c3');
    expect((c!['cotejo'] as Record<string, unknown>)['intentos']).toBe(2);
  });

  it('una vez que CUADRÓ, la próxima imagen ya no es un comprobante', async () => {
    // La solicitud avanzó, así que el pendiente se cerró: mandar otra foto no
    // vuelve a cotejar nada ni crea un segundo cierre.
    const r = await comprobante(TEL_2, leidoDe('Bs 350,00'), true, 'wamid.c4');
    expect(r.codigo).toBe(409);
    expect(r.cuerpo).toEqual({ error: 'sin_sena_pendiente' });
  });

  it('EL CARRITO WEB GANA: si hay pedido del servidor, se coteja SU total', async () => {
    // El flujo manda 999 --el modelo se equivocó al dictar el total-- y el
    // pedido del carrito dice 412,50, calculado por el servidor con el envío
    // incluido. El que vale es el del servidor.
    await db.doc(`tenants/${T}/pedidos/cat_prueba1`).set({
      origen: 'catalogo-web', total: 412.5, moneda: 'BOB', estado: 'recibido',
    });
    await qrEnviado(TEL_2, 'cat_prueba1', 999);
    // Con el total que dictó el modelo NO cuadra: ese número no se usa.
    const conElOtro = await comprobante(TEL_2, leidoDe('Bs 999,00'), true, 'wamid.c5');
    expect((conElOtro.cuerpo as Record<string, any>)['resultado']).toBe('no_cuadra');
    expect(String((conElOtro.cuerpo as Record<string, any>)['diferencias'][0])).toContain('412.5');
    // Con el del servidor, sí.
    const r = await comprobante(TEL_2, leidoDe('Bs 412,50'), true, 'wamid.c6');
    expect(r.cuerpo).toMatchObject({ resultado: 'cuadra', importe: 412.5 });
    expect(await cierre('venta_cat_prueba1')).toMatchObject({ monto: 412.5 });
  });
});

describe('5. Lo que NO se coteja, y por qué', () => {
  it('SIN TOTAL no se coteja contra cero: se dice `sin_total` y lo mira una persona', async () => {
    const r = await comprobante(TEL_3, leidoDe('Bs 597,00'), true, 'wamid.c11');
    expect(r.codigo).toBe(409);
    expect(r.cuerpo).toEqual({ error: 'sin_total' });
    // Y no se creó ningún cierre con monto cero.
    expect(await cierre('venta_wamidqr3b')).toBeUndefined();
  });

  it('EL QR CADUCADO no se coteja: se anota vencido, se cuenta, y se pasa a una persona', async () => {
    await qrEnviado(TEL_4, 'wamid.qr4', 100);
    await db.doc(`tenants/${T}/conversaciones/wa_${TEL_4}`).set({
      solicitud: { etapa: 'qr_enviado', monto: 100, cotejos: 0,
        qrEnviadoEn: Timestamp.fromMillis(Date.now() - 25 * 3_600_000),
        evento: { id: 'wamid.qr4', calendario: '' } },
    }, { merge: true });
    const r = await comprobante(TEL_4, leidoDe('Bs 100,00'), true, 'wamid.c12');
    expect(r.codigo).toBe(409);
    expect(((await conversacion(TEL_4))['solicitud'] as Record<string, unknown>)['etapa']).toBe('vencida');
    expect((await metricas())['cobrosVencidos']).toBe(1);
    // Los contadores de la SEÑA no se tocan: son de otro vertical.
    expect((await metricas())['senasVencidas']).toBeUndefined();
  });

  it('SIN QR PENDIENTE una imagen es una imagen: 409 y ningún cierre', async () => {
    const r = await comprobante(TEL_5, leidoDe('Bs 597,00'), true, 'wamid.c13');
    expect(r.codigo).toBe(409);
    expect(r.cuerpo).toEqual({ error: 'sin_sena_pendiente' });
    expect((await db.collection(`tenants/${T}/cierres`).get()).docs
      .some((d) => d.id.includes('c8'))).toBe(false);
  });

  it('ILEGIBLE: se registra el intento, sin afirmar nada', async () => {
    await qrEnviado(TEL_5, 'wamid.qr5', 200);
    const r = await comprobante(TEL_5, {}, false, 'wamid.c14');
    expect(r.codigo).toBe(200);
    expect(r.cuerpo).toMatchObject({ resultado: 'ilegible' });
    expect(String((await privado('venta_wamidqr5'))!['detalle'])).not.toMatch(AFIRMA_PAGO);
    expect(JSON.stringify(r.cuerpo)).not.toMatch(AFIRMA_PAGO);
  });
});

describe('6. La imagen del QR: un código vencido deja de servirse', () => {
  const pedirImagen = async (ficha: string) => {
    const r: { codigo: number; cuerpo: unknown } = { codigo: 0, cuerpo: null };
    const respuesta = {
      status(c: number) { r.codigo = c; return respuesta; },
      send(b: unknown) { r.cuerpo = b; return respuesta; },
      json(b: unknown) { r.cuerpo = b; return respuesta; },
      set() { return respuesta; }, setHeader() { return respuesta; },
      getHeader() { return undefined; }, on() { return respuesta; }, end() { return respuesta; },
    };
    await (imagenDeCobro as unknown as (q: unknown, s: unknown) => Promise<void>)(
      { method: 'GET', query: { f: ficha }, headers: {}, get: () => undefined }, respuesta);
    return r;
  };

  it('con el QR vigente y encendido, devuelve el PNG', async () => {
    await db.doc(`tenants/${T}/config/venta`).set({ cobroReal: { activo: true } }, { merge: true });
    const ficha = String((await db.doc(`tenants/${T}/config/venta`).get()).get('cobroReal.ficha'));
    const r = await pedirImagen(ficha);
    expect(r.codigo).toBe(200);
    expect(Buffer.isBuffer(r.cuerpo)).toBe(true);
    expect((r.cuerpo as Buffer).subarray(1, 4).toString()).toBe('PNG');
  });

  it('VENCIDO: deja de servirse, aunque siga encendido (hallazgo del 23/09)', async () => {
    // `registrarQrDeCobro` rechaza registrar uno vencido y `activar-cobro-real`
    // se niega a encenderlo, pero ninguno de los dos miraba lo que pasa DESPUÉS.
    // Un QR encendido en junio con vencimiento en septiembre se seguía sirviendo
    // en octubre: el cliente escaneaba, el banco rechazaba, y el negocio se
    // enteraba por un reclamo.
    const ficha = String((await db.doc(`tenants/${T}/config/venta`).get()).get('cobroReal.ficha'));
    await db.doc(`tenants/${T}/config/venta`).set({
      cobroReal: { venceEl: '2020-01-01' } }, { merge: true });
    expect((await pedirImagen(ficha)).codigo).toBe(404);
    // Sin fecha guardada no se bloquea nada: los registros viejos no se rompen.
    await db.doc(`tenants/${T}/config/venta`).set({ cobroReal: { venceEl: '' } }, { merge: true });
    expect((await pedirImagen(ficha)).codigo).toBe(200);
    await db.doc(`tenants/${T}/config/venta`).set({ cobroReal: { venceEl: VENCE_EL } }, { merge: true });
  });

  it('una ficha que no existe: 404, sin decir si el comercio existe', async () => {
    expect((await pedirImagen('0'.repeat(32))).codigo).toBe(404);
    expect((await pedirImagen('no-es-una-ficha')).codigo).toBe(404);
  });
});

describe('7. La seña no se rompió: el otro vertical sigue leyendo su importe fijo', () => {
  it('`esperadoDeLaVenta` y `esperadoDeLaSena` producen la misma forma', async () => {
    const { esperadoDeLaSena, MINUTOS_TOLERANCIA_RELOJ } = await import('../functions/src/sena.ts');
    const qr = { nombreCuenta: TITULAR, cuentas: [CUENTA] };
    const sena = esperadoDeLaSena(50, qr, 1000, 2000);
    const venta = esperadoDeLaVenta(50, qr, 1000, 2000, MINUTOS_TOLERANCIA_RELOJ);
    expect(venta).toEqual(sena);
  });
});
