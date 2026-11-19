/**
 * LA FACTURA QUE LLEGA PASADAS 48 H (Walisuma, PR-F), de punta a punta contra el emulador:
 * `cotejarComprobanteVenta` → `configuracionFlujo` → `ingesta` (evento `factura_dada` / `factura_sin`).
 *
 * Contrato (PROPIO.md de Walisuma, «NIT que llega pasadas 48 h»):
 *  - al cerrar la venta CON `codigoPedido`, el servidor guarda en `conversaciones/wa_<tel>.ultimoPedido`
 *    `{ codigo, cierreId, factura: 'pedida', desdeMs, venceMs }`;
 *  - «Traer configuración» devuelve, para ESE teléfono y ESE comercio y dentro del plazo,
 *    `ultimoPedido: { codigo, factura, desdeMs }`, nada más;
 *  - `factura_dada` / `factura_sin` con el `codigoPedido` marca el pedido una sola vez.
 *
 * LO QUE SE NIEGA: otro teléfono u otro comercio nunca ven ni marcan el pedido; un evento con un
 * código ajeno se ignora y queda en la bitácora como rechazado; el segundo reporte no cambia nada;
 * NINGÚN documento ni respuesta lleva NIT o razón social aunque el cuerpo los traiga; un comercio sin
 * prefijo no guarda nada y su «Traer configuración» no trae la clave.
 */
import { beforeAll, describe, expect, it } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
const TOKEN = 'valor-de-prueba-de-la-factura-del-pedido';
process.env['INGESTA_CLIENTE12'] = TOKEN;

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const db = getFirestore();
const { cotejarComprobanteVenta } = await import('../functions/src/modulos/cobros/cotejoVenta.ts');
const { ingesta, configuracionFlujo } = await import('../functions/src/ingesta.ts');
const { solicitudDeCobroTras } = await import('../functions/src/modulos/cobros/cobroVenta.ts');
const { diaLaPaz } = await import('../functions/src/core/turno/correlativo.ts');
const { limitesDe } = await import('../functions/src/central/cuenta/planes.ts');

const CON = 'factura-pedido-con';   // con prefijo WAL
const OTRO = 'factura-pedido-otro'; // otro comercio, con prefijo
const SIN = 'factura-pedido-sin';   // sin prefijo
const NUM: Record<string, string> = { [CON]: '1000000351', [OTRO]: '1000000352', [SIN]: '1000000353' };
const TEL_A = '59100000081';
const TEL_B = '59100000082';
const MIN = 60_000;
const DIA = 86_400_000;
const CUENTA = '1000000890';
const NIT = '1000000123';
const RAZON = 'Razon Social De Prueba SRL';

interface Respuesta { codigo: number; cuerpo: any }

async function invocar(fn: unknown, numero: string, cuerpo: Record<string, unknown>): Promise<Respuesta> {
  const cab: Record<string, string> = { 'x-novuchat-numero': numero, 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` };
  const leer = (n: string) => cab[n.toLowerCase()];
  const peticion = { method: 'POST', body: cuerpo, rawBody: Buffer.from(JSON.stringify(cuerpo)), headers: cab, get: leer, header: leer };
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

function enLaPaz(ms: number): { fecha: string; hora: string } {
  const d = new Date(ms - 4 * 3_600_000);
  const dos = (n: number) => String(n).padStart(2, '0');
  return { fecha: `${dos(d.getUTCDate())}/${dos(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`, hora: `${dos(d.getUTCHours())}:${dos(d.getUTCMinutes())}` };
}
const cotejar = (t: string, tel: string, idMeta: string) => invocar(cotejarComprobanteVenta, NUM[t]!, {
  telefono: tel, legible: true, idMeta,
  leido: { monto: '100', cuentaDestino: CUENTA, nombreCuenta: 'PEREZ GOMEZ JUAN CARLOS', banco: 'BNB', ...enLaPaz(Date.now()) },
});
const configuracion = (t: string, tel: string) => invocar(configuracionFlujo, NUM[t]!, { telefono: tel });
const reportar = (t: string, tel: string, extra: Record<string, unknown>) => invocar(ingesta, NUM[t]!, {
  telefono: tel, direccion: 'saliente', tipo: 'text', texto: 'Gracias, ya avisamos a nuestra encargada.', ...extra,
});
const conversacion = async (t: string, tel: string) => (await db.doc(`tenants/${t}/conversaciones/wa_${tel}`).get()).data() ?? {};

async function sembrarQr(t: string, tel: string) {
  const referencia = `wamid.qr-${t}-${tel}`;
  const enviado = Date.now() - 2 * MIN;
  const tr = solicitudDeCobroTras(null, { tipo: 'qr_enviado', reglaCobro: 2, idMeta: referencia }, enviado);
  await db.doc(`tenants/${t}/conversaciones/wa_${tel}`).set({
    nombreContacto: 'Cliente de prueba',
    solicitud: {
      etapa: 'qr_enviado', desde: Timestamp.fromMillis(enviado), qrEnviadoEn: Timestamp.fromMillis(enviado),
      evento: { id: referencia, calendario: '' }, cotejos: 0, seguimientos: 0, seguimientoEn: null,
      reactivadaEn: null, monto: 100, ...(tr.cambios ?? {}),
    },
  }, { merge: true });
}

async function sembrarComercio(t: string, prefijo: string | null) {
  await db.recursiveDelete(db.doc(`tenants/${t}`));
  await db.doc(`rutasWhatsApp/${NUM[t]}`).set({ tenantId: t, flujo: 'venta', aliasSecreto: 'cliente12', estado: 'activo' });
  await db.doc(`tenants/${t}`).set({ nombre: 'Tienda', estado: 'activo', plan: 'crecimiento', flujos: ['venta'] });
  await db.doc(`tenants/${t}/cuenta/estado`).set({ plan: 'crecimiento', limites: limitesDe('crecimiento'), modalidad: 'demostracion' });
  await db.doc(`tenants/${t}/config/negocio`).set({ nombreNegocio: 'Tienda', zonaHoraria: 'America/La_Paz', moneda: 'BOB', numeroRecepcion: '70000001' });
  await db.doc(`tenants/${t}/config/venta`).set({
    cobroReal: { activo: true, ficha: 'ficha-de-prueba', cargaUtil: 'carga-de-prueba', nombreCuenta: 'Juan Carlos Pérez Gómez', cuentas: [CUENTA], banco: 'BNB' },
  });
  if (prefijo) await db.doc(`tenants/${t}/config/pedidos`).set({ prefijoCodigo: prefijo });
}

const sinDatosDeFactura = (x: unknown) => {
  const s = JSON.stringify(x);
  expect(s).not.toContain(NIT);
  expect(s).not.toContain(RAZON);
  expect(s).not.toMatch(/"(nit|razonSocial|razon_social|ci)"/i);
};

let CODIGO = '';

beforeAll(async () => {
  await sembrarComercio(CON, 'WAL');
  await sembrarComercio(OTRO, 'OTR');
  await sembrarComercio(SIN, null);
}, 120_000);

describe('al cerrar la venta con código', () => {
  it('guarda ultimoPedido con factura pedida, desdeMs y venceMs a 30 días, en la conversación de ese teléfono', async () => {
    await sembrarQr(CON, TEL_A);
    const antes = Date.now();
    const r = await cotejar(CON, TEL_A, 'wamid.fa1');
    expect(r.cuerpo).toMatchObject({ estado: 'valido', codigoPedido: `WAL-${diaLaPaz(Date.now())}-001` });
    CODIGO = r.cuerpo.codigoPedido;
    const u = (await conversacion(CON, TEL_A))['ultimoPedido'];
    expect(u).toMatchObject({ codigo: CODIGO, factura: 'pedida', cierreId: r.cuerpo.cierreId });
    expect(u.desdeMs).toBeGreaterThanOrEqual(antes);
    expect(u.venceMs - u.desdeMs).toBe(30 * DIA);
    sinDatosDeFactura(u);
  });

  it('otro teléfono del mismo comercio no recibe nada', async () => {
    expect((await conversacion(CON, TEL_B))['ultimoPedido']).toBeUndefined();
  });
});

describe('Traer configuración', () => {
  it('devuelve ultimoPedido { codigo, factura, desdeMs } para ese teléfono, nada más', async () => {
    const r = await configuracion(CON, TEL_A);
    expect(r.codigo).toBe(200);
    expect(Object.keys(r.cuerpo.ultimoPedido).sort()).toEqual(['codigo', 'desdeMs', 'factura']);
    expect(r.cuerpo.ultimoPedido).toMatchObject({ codigo: CODIGO, factura: 'pedida' });
  });

  it('otro teléfono y otro comercio (mismo teléfono) no lo reciben', async () => {
    const b = await configuracion(CON, TEL_B);
    expect(b.codigo).toBe(200);
    expect('ultimoPedido' in b.cuerpo).toBe(false);
    const o = await configuracion(OTRO, TEL_A);
    expect(o.codigo).toBe(200);
    expect('ultimoPedido' in o.cuerpo).toBe(false);
  });
});

describe('el evento de la factura', () => {
  it('un código que no es de ese teléfono se ignora y queda como rechazado en la bitácora', async () => {
    await db.doc(`tenants/${CON}/conversaciones/wa_${TEL_B}`).set({ nombreContacto: 'B' }, { merge: true });
    const r = await reportar(CON, TEL_B, { evento: 'factura_dada', codigoPedido: CODIGO });
    expect(r.codigo).toBe(200);
    expect(r.cuerpo.factura).toBe('rechazada');
    expect((await conversacion(CON, TEL_B))['ultimoPedido']).toBeUndefined();
    expect((await conversacion(CON, TEL_A))['ultimoPedido'].factura).toBe('pedida');
    // TEL_B no tiene pedido: el código de TEL_A es ajeno para él (`sin_pedido`).
    const bit = await db.collection(`tenants/${CON}/bitacora`).where('codigo', '==', 'factura_sin_pedido').get();
    expect(bit.size).toBe(1);
    expect(bit.docs[0]!.get('resultado')).toBe('rechazado');
  });

  it('otro comercio con el mismo teléfono y el código no marca nada', async () => {
    const r = await reportar(OTRO, TEL_A, { evento: 'factura_dada', codigoPedido: CODIGO });
    expect(r.codigo).toBe(200);
    expect(r.cuerpo.factura).toBe('rechazada');
    expect((await conversacion(CON, TEL_A))['ultimoPedido'].factura).toBe('pedida');
    expect((await conversacion(OTRO, TEL_A))['ultimoPedido']).toBeUndefined();
  });

  it('factura_dada con su código marca dada, y NADA guarda NIT ni razón social aunque el cuerpo los traiga', async () => {
    const r = await reportar(CON, TEL_A, {
      evento: 'factura_dada', codigoPedido: CODIGO, nit: NIT, razonSocial: RAZON,
      facturacion: { nit: NIT, razonSocial: RAZON },
    });
    expect(r.codigo).toBe(200);
    expect(r.cuerpo.factura).toBe('marcada');
    sinDatosDeFactura(r.cuerpo);
    const c = await conversacion(CON, TEL_A);
    expect(c['ultimoPedido']).toMatchObject({ codigo: CODIGO, factura: 'dada' });
    expect(typeof c['ultimoPedido'].facturaEnMs).toBe('number');
    sinDatosDeFactura(c);
    for (const col of ['cierres', 'pedidos', 'bitacora']) {
      for (const d of (await db.collection(`tenants/${CON}/${col}`).get()).docs) sinDatosDeFactura(d.data());
    }
    for (const m of (await db.collection(`tenants/${CON}/conversaciones/wa_${TEL_A}/mensajes`).get()).docs) sinDatosDeFactura(m.data());
    const cfg = await configuracion(CON, TEL_A);
    expect(cfg.cuerpo.ultimoPedido).toMatchObject({ codigo: CODIGO, factura: 'dada' });
    sinDatosDeFactura(cfg.cuerpo.ultimoPedido);
  });

  it('idempotente: el segundo reporte (incluso factura_sin) no cambia nada ni falla', async () => {
    const antes = (await conversacion(CON, TEL_A))['ultimoPedido'];
    for (const evento of ['factura_dada', 'factura_sin']) {
      const r = await reportar(CON, TEL_A, { evento, codigoPedido: CODIGO });
      expect(r.codigo).toBe(200);
      expect(r.cuerpo.factura).toBe('ya_marcada');
    }
    expect((await conversacion(CON, TEL_A))['ultimoPedido']).toEqual(antes);
  });

  it('el reintento del mismo comprobante no vuelve la factura a pedida', async () => {
    const r = await cotejar(CON, TEL_A, 'wamid.fa1');
    expect(r.cuerpo).toMatchObject({ repetido: true, codigoPedido: CODIGO });
    expect((await conversacion(CON, TEL_A))['ultimoPedido'].factura).toBe('dada');
  });

  it('el evento no toca la solicitud del cobro', async () => {
    await sembrarQr(CON, TEL_B);
    const antes = (await conversacion(CON, TEL_B))['solicitud'];
    await reportar(CON, TEL_B, { evento: 'factura_sin', codigoPedido: 'WAL-261119-009' });
    expect((await conversacion(CON, TEL_B))['solicitud']).toEqual(antes);
  });
});

describe('plazo', () => {
  it('vencido el plazo, Traer configuración ya no lo entrega', async () => {
    const tel = '59100000083';
    const desdeMs = Date.now() - 31 * DIA;
    await db.doc(`tenants/${CON}/conversaciones/wa_${tel}`).set({
      ultimoPedido: { codigo: 'WAL-261019-001', cierreId: 'venta_viejo', factura: 'pedida', desdeMs, venceMs: desdeMs + 30 * DIA },
    });
    const r = await configuracion(CON, tel);
    expect(r.codigo).toBe(200);
    expect('ultimoPedido' in r.cuerpo).toBe(false);
  });

  it('el plazo del comercio (config/pedidos.plazoFacturaDias) fija venceMs, con tope de 90', async () => {
    await db.doc(`tenants/${OTRO}/config/pedidos`).set({ prefijoCodigo: 'OTR', plazoFacturaDias: 365 });
    await sembrarQr(OTRO, TEL_B);
    const r = await cotejar(OTRO, TEL_B, 'wamid.fo1');
    expect(r.cuerpo.codigoPedido).toMatch(/^OTR-/);
    const u = (await conversacion(OTRO, TEL_B))['ultimoPedido'];
    expect(u.venceMs - u.desdeMs).toBe(90 * DIA);
    // Con pedido propio, el código de OTRO comercio es ajeno: no marca y queda rechazado.
    const ev = await reportar(OTRO, TEL_B, { evento: 'factura_dada', codigoPedido: CODIGO });
    expect(ev.cuerpo.factura).toBe('rechazada');
    expect((await conversacion(OTRO, TEL_B))['ultimoPedido'].factura).toBe('pedida');
    const bit = await db.collection(`tenants/${OTRO}/bitacora`).where('codigo', '==', 'factura_codigo_ajeno').get();
    expect(bit.size).toBe(1);
    expect(bit.docs[0]!.get('resultado')).toBe('rechazado');
  });
});

describe('el evento de factura NO es un mensaje (revisión del PR-F)', () => {
  it('con texto «Mariana Quiroga NIT 1234567»: nada guarda el NIT y ningún contador cambia', async () => {
    const tel = '59100000084';
    await sembrarQr(CON, tel);
    const cod = (await cotejar(CON, tel, 'wamid.fp1')).cuerpo.codigoPedido as string;
    await reportar(CON, tel, {});  // un mensaje común, para tener contadores
    const MES = new Date().toISOString().slice(0, 7);
    const metricas = async () => (await db.doc(`tenants/${CON}/metricas/${MES}`).get()).data() ?? {};
    const mensajes = async () => (await db.collection(`tenants/${CON}/conversaciones/wa_${tel}/mensajes`).get()).size;
    const antesC = await conversacion(CON, tel);
    const antesM = await metricas();
    const antesN = await mensajes();
    const TEXTO = 'Mariana Quiroga NIT 1234567';
    const r = await reportar(CON, tel, { direccion: 'entrante', evento: 'factura_dada', codigoPedido: cod, texto: TEXTO, nombreContacto: 'Mariana' });
    expect(r).toEqual({ codigo: 200, cuerpo: { factura: 'marcada' } });
    const c = await conversacion(CON, tel);
    expect(JSON.stringify(c)).not.toContain('1234567');
    for (const k of ['ultimoMensaje', 'ultimoEn', 'mensajesTotal', 'noLeidos', 'sinLeer', 'atencionDesde', 'ultimoEntranteEn',
      'ventanaVenceEn', 'periodoContado', 'respuestasDelPeriodo', 'mensajesVentana', 'nombreContacto']) {
      expect(c[k], k).toEqual(antesC[k]);
    }
    expect(c['ultimoPedido']).toMatchObject({ codigo: cod, factura: 'dada' });
    expect(await metricas()).toEqual(antesM);
    expect(await mensajes()).toBe(antesN);
    for (const m of (await db.collection(`tenants/${CON}/conversaciones/wa_${tel}/mensajes`).get()).docs) expect(JSON.stringify(m.data())).not.toContain('1234567');
    for (const b of (await db.collection(`tenants/${CON}/bitacora`).get()).docs) expect(JSON.stringify(b.data())).not.toContain('1234567');
  });

  it('un rechazo con texto tampoco lo guarda en ningún lado', async () => {
    const tel = '59100000085';
    const r = await reportar(CON, tel, { direccion: 'entrante', evento: 'factura_dada', codigoPedido: 'WAL-261119-777', texto: 'NIT 1234567' });
    expect(r.cuerpo).toEqual({ factura: 'rechazada' });
    expect((await db.doc(`tenants/${CON}/conversaciones/wa_${tel}`).get()).exists).toBe(false);
    for (const b of (await db.collection(`tenants/${CON}/bitacora`).get()).docs) expect(JSON.stringify(b.data())).not.toContain('1234567');
  });

  it('contacto bloqueado: no_aplicado, nada se marca', async () => {
    const tel = '59100000086';
    await sembrarQr(CON, tel);
    const cod = (await cotejar(CON, tel, 'wamid.fb1')).cuerpo.codigoPedido as string;
    await db.doc(`tenants/${CON}/conversaciones/wa_${tel}`).update({ bloqueada: true });
    const r = await reportar(CON, tel, { evento: 'factura_dada', codigoPedido: cod });
    expect(r.cuerpo).toEqual({ factura: 'no_aplicado' });
    expect((await conversacion(CON, tel))['ultimoPedido'].factura).toBe('pedida');
  });
});

describe('plazoFacturaDias de punta a punta', () => {
  const casos: [unknown, number][] = [['abc', 30], ['45', 30], [3.5, 30], [-5, 30], [0, 30], [1e9, 90], [45, 45]];
  for (const [i, [valor, dias]] of casos.entries()) {
    it(`plazoFacturaDias = ${JSON.stringify(valor)} → ${dias} días`, async () => {
      await db.doc(`tenants/${OTRO}/config/pedidos`).set({ prefijoCodigo: 'OTR', plazoFacturaDias: valor });
      const tel = `5910000002${i}`;
      await sembrarQr(OTRO, tel);
      const r = await cotejar(OTRO, tel, `wamid.pz${i}`);
      expect(r.cuerpo.codigoPedido).toMatch(/^OTR-/);
      const u = (await conversacion(OTRO, tel))['ultimoPedido'];
      expect(u.venceMs - u.desdeMs).toBe(dias * DIA);
    });
  }
});

describe('comercio sin prefijo: sin cambios', () => {
  it('cierra como siempre, sin ultimoPedido, sin la clave en Traer configuración, y el evento no escribe nada', async () => {
    await sembrarQr(SIN, TEL_A);
    const r = await cotejar(SIN, TEL_A, 'wamid.fs1');
    expect(r.cuerpo.estado).toBe('valido');
    expect('codigoPedido' in r.cuerpo).toBe(false);
    expect((await conversacion(SIN, TEL_A))['ultimoPedido']).toBeUndefined();
    const cfg = await configuracion(SIN, TEL_A);
    expect(cfg.codigo).toBe(200);
    expect('ultimoPedido' in cfg.cuerpo).toBe(false);
    const ev = await reportar(SIN, TEL_A, { evento: 'factura_dada', codigoPedido: CODIGO });
    expect(ev.codigo).toBe(200);
    expect((await conversacion(SIN, TEL_A))['ultimoPedido']).toBeUndefined();
  });

  it('un mensaje sin evento de factura responde como siempre: sin la clave factura', async () => {
    const r = await reportar(SIN, TEL_A, {});
    expect(r.codigo).toBe(200);
    expect('factura' in r.cuerpo).toBe(false);
  });
});
