/**
 * EL COBRO DEL PREPAGO, DE PUNTA A PUNTA: las Functions reales contra el
 * emulador de Firestore y el doble del cobrador (DISENO.md §4undecies.7, A-2).
 *
 * Lo que se verifica, en el orden en que pasa de verdad:
 *
 *  1. `crearCobroPrepago` deja el pago `pendiente`, `pagoPendienteId`,
 *     `/cobrosPendientes` y `qr.png`; un segundo pedido rechaza y devuelve el
 *     vivo; el admin de B NO crea cobro en A; sin TCO del día no se emite.
 *  2. `avisoCobrador`: bien firmado con el doble en `QR_ACTIVO` o
 *     `PAGO_DETECTADO` NO aplica (el aviso no confirma); firma inválida o
 *     marca fuera de ventana → 401 y nada cambia, aunque el doble diga
 *     `CONFIRMADO`; bien firmado y `CONFIRMADO` → aplica; repetido → no suma.
 *  3. `barrerCobrosPendientes` confirma sin aviso, cierra los vencidos y
 *     anula en el cobrador lo que venció hace más de un día.
 *  4. `anularCobroVivo` (lo que `registrarPagoManual` de A-1 llama antes de
 *     cargar): anula el QR; si había plata, aplica el del banco.
 *  5. `imagenDePago` sirve el PNG del pendiente y 404 de lo demás.
 *
 * Alias `cliente15` reservado para esta suite (§4undecies.7); esta suite no
 * autentica ninguna ruta por número, así que solo lo fija en el entorno. Los
 * secretos del cobrador salen del entorno como en producción, con valores de
 * prueba. Storage no está en el emulador: se inyecta un almacén en memoria.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CobradorDoble, firmarAviso, idDeCobro, pngMinimo } from './dobles/cobrador.ts';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
process.env['COBRADOR_DOBLE'] = '1';
// Valores de prueba, no secretos. El token tiene los 32 caracteres que exige el cobrador.
const TOKEN = 'token-de-prueba-de-novuchat-sin-valor-real';
const SECRETO_AVISO = 'secreto-de-prueba-del-aviso-de-confirmacion';
process.env['COBRADOR_TOKEN'] = TOKEN;
process.env['COBRADOR_AVISO_SECRETO'] = SECRETO_AVISO;
process.env['INGESTA_CLIENTE15'] = 'valor-de-prueba-cliente15';

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const db = getFirestore();
const { crearClienteHttp, registrarCobradorDoble } = await import('../functions/src/cobrador.ts');
const {
  crearCobroPrepago, crearCobroInterno, avisoCobrador, barrerCobrosPendientes, anularCobroVivo, imagenDePago,
  fijarAlmacenDePrueba, consultarYAplicar,
} = await import('../functions/src/cobroPrepago.ts');
const { periodoBolivia, sumarMeses } = await import('../functions/src/pagos-stub.ts');

const A = 'prep-salon';
const B = 'prep-otro';
const HOY = periodoBolivia(Date.now());
const DIA = 86_400_000;
const TCO = 12.6;

// --- El doble, el cliente HTTP real contra él, y el almacén en memoria -------
let doble: CobradorDoble;
const archivos = new Map<string, Buffer>();
fijarAlmacenDePrueba({
  async guardar(ruta, bytes) { archivos.set(ruta, bytes); },
  async leer(ruta) { return archivos.get(ruta) ?? null; },
});
function nuevoDoble() {
  doble = new CobradorDoble({ tokens: { [TOKEN]: 'novuchat', 'token-del-otro-consumidor-sin-valor-real': 'otro' } });
  registrarCobradorDoble(crearClienteHttp({ baseUrl: 'https://cobrador.prueba', token: TOKEN, fetchImpl: doble.fetch }));
}

// --- Identidades ---------------------------------------------------------------
const token = (nc: object, proveedor = 'password', verificado = true) =>
  ({ nc, firebase: { sign_in_provider: proveedor, identities: {} }, email_verified: verificado });
const ADMIN_A = { uid: 'adm-a', token: token({ t: { [A]: 'admin' } }) };
const ADMIN_B = { uid: 'adm-b', token: token({ t: { [B]: 'admin' } }) };
const ADMIN_A_CON_GOOGLE = { uid: 'adm-a', token: token({ t: { [A]: 'admin' } }, 'google.com') };
const ADMIN_A_SIN_VERIFICAR = { uid: 'adm-a', token: token({ t: { [A]: 'admin' } }, 'password', false) };
const OPER_A = { uid: 'op-a', token: token({ t: { [A]: 'oper' } }) };
const PROPIETARIO = { uid: 'prop', token: token({ p: true }, 'google.com') };
const PROPIETARIO_CON_CONTRASENA = { uid: 'prop', token: token({ p: true }, 'password') };

type Peticion = Parameters<typeof crearCobroPrepago.run>[0];
const crear = (data: Record<string, unknown>, auth: object | null = ADMIN_A) =>
  crearCobroPrepago.run({ data, auth, rawRequest: {} } as unknown as Peticion) as Promise<Record<string, unknown>>;
async function rechaza(p: Promise<unknown>, codigo: string): Promise<Record<string, unknown>> {
  try { await p; } catch (e) {
    expect(e).toMatchObject({ code: codigo });
    return ((e as { details?: unknown }).details ?? {}) as Record<string, unknown>;
  }
  throw new Error(`se esperaba ${codigo} y la llamada pasó`);
}

// --- Lecturas ------------------------------------------------------------------
const cuenta = async (t = A) => (await db.doc(`tenants/${t}/cuenta/estado`).get()).data() ?? {};
const pago = async (id: string, t = A) => (await db.doc(`tenants/${t}/pagos/${id}`).get()).data();
const pendiente = async (id: string) => (await db.doc(`cobrosPendientes/${id}`).get()).data();
const resuelto = async (id: string) => (await db.doc(`cobrosResueltos/${id}`).get()).data();
const bitacora = async (tipo: string, t = A) =>
  (await db.collection(`tenants/${t}/bitacora`).where('tipo', '==', tipo).get()).docs.map((d) => d.data());
const auditoria = async (accion: string, t = A) =>
  (await db.collection(`tenants/${t}/auditoria`).where('accion', '==', accion).get()).docs.map((d) => d.data());

// --- El aviso, como lo manda el cobrador ---------------------------------------
interface Respuesta { codigo: number; cuerpo: unknown; cabeceras: Record<string, string> }
async function http(fn: unknown, metodo: string, cabeceras: Record<string, string>, cuerpo: string | null, query: Record<string, string> = {}): Promise<Respuesta> {
  const bajas = Object.fromEntries(Object.entries(cabeceras).map(([k, v]) => [k.toLowerCase(), v]));
  const leer = (n: string) => bajas[n.toLowerCase()];
  const peticion = {
    method: metodo, query, headers: bajas, get: leer, header: leer,
    body: cuerpo ? JSON.parse(cuerpo) : undefined, rawBody: Buffer.from(cuerpo ?? ''),
  };
  const r: Respuesta = { codigo: 0, cuerpo: null, cabeceras: {} };
  const respuesta = {
    status(c: number) { r.codigo = c; return respuesta; },
    send(b: unknown) { r.cuerpo = b; return respuesta; },
    json(b: unknown) { r.cuerpo = b; return respuesta; },
    set(k: string, v: string) { r.cabeceras[k] = v; return respuesta; },
    setHeader(k: string, v: string) { r.cabeceras[k] = v; return respuesta; },
    getHeader() { return undefined; }, on() { return respuesta; }, end() { return respuesta; },
  };
  await (fn as (q: unknown, s: unknown) => Promise<void>)(peticion, respuesta);
  return r;
}
const aviso = (referencia: string, opciones: { secreto?: string; marca?: number; cuerpo?: string } = {}) => {
  const cuerpo = opciones.cuerpo ?? JSON.stringify(doble.avisoDe(referencia));
  const cabeceras = { ...firmarAviso(opciones.secreto ?? SECRETO_AVISO, cuerpo, opciones.marca ?? Date.now()), 'content-type': 'application/json' };
  return http(avisoCobrador, 'POST', cabeceras, cuerpo);
};
const imagen = (ficha: string) => http(imagenDePago, 'GET', {}, null, { f: ficha });

// --- Semilla -------------------------------------------------------------------
async function limpiar(t: string) {
  for (const c of ['pagos', 'bitacora', 'auditoria']) {
    for (const d of (await db.collection(`tenants/${t}/${c}`).get()).docs) await d.ref.delete();
  }
  await db.doc(`tenants/${t}/cuenta/estado`).delete();
}
beforeAll(async () => {
  for (const c of ['cobrosPendientes', 'cobrosResueltos']) {
    for (const d of (await db.collection(c).get()).docs) await d.ref.delete();
  }
});
beforeEach(async () => {
  nuevoDoble(); archivos.clear();
  for (const c of ['cobrosPendientes', 'cobrosResueltos']) {
    for (const d of (await db.collection(c).get()).docs) await d.ref.delete();
  }
  await Promise.all([limpiar(A), limpiar(B)]);
  await db.doc(`tenants/${A}`).set({ nombre: 'Salón Prueba', estado: 'activo', plan: 'crecimiento', flujos: ['agendamiento'] });
  await db.doc(`tenants/${B}`).set({ nombre: 'Otro', estado: 'activo', plan: 'impulso', flujos: ['venta'] });
  await db.doc(`tenants/${A}/cuenta/estado`).set({ plan: 'crecimiento', modalidad: 'prepago', corte: { motivo: 'sin_pago', desde: Timestamp.now(), perdidas: 3, aplicado: true } });
  await db.doc(`tenants/${B}/cuenta/estado`).set({ plan: 'impulso', modalidad: 'prepago' });
  await db.doc('plataforma/tipoCambio').set({ tco: TCO, fecha: new Date(Date.now() - 4 * 3_600_000).toISOString().slice(0, 10), fuente: 'BCB' });
  await db.doc('plataforma/prepago').set({ corteActivo: false, cobrador: { baseUrl: 'https://cobrador.prueba', consumidor: 'novuchat', vigenciaHoras: 72 } });
});

const MENSUALIDAD = { tenantId: A, tipo: 'mensualidad', plan: 'crecimiento', meses: 1 };

// ===========================================================================
describe('1. Crear el cobro', () => {
  it('deja el pago pendiente, pagoPendienteId, cobrosPendientes y qr.png; el concepto no lleva el nombre del comercio', async () => {
    const r = await crear(MENSUALIDAD);
    const pagoId = r['pagoId'] as string;
    expect(pagoId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(r).toMatchObject({
      estado: 'pendiente', tipo: 'mensualidad', descripcion: 'Crecimiento · 1 mes',
      montoUsd: 50, monto: 630, moneda: 'BOB', tcoAplicado: TCO, tcoFuente: 'BCB', reutilizado: false,
      cobro: { estado: 'QR_ACTIVO' },
    });
    expect(r['fichaQr']).toMatch(/^[0-9a-f]{32}$/);

    const p = await pago(pagoId);
    expect(p).toMatchObject({
      tipo: 'mensualidad', plan: 'crecimiento', meses: 1, montoUsd: 50, monto: 630, moneda: 'BOB', monedaLista: 'USD',
      tcoAplicado: TCO, tcoFuente: 'BCB', montoRecibidoBs: null, estado: 'pendiente', medio: 'qr', canal: 'consola',
      referencia: pagoId, creadoPor: 'adm-a',
    });
    expect(p?.['cobro']).toMatchObject({ id: idDeCobro('novuchat', pagoId), estado: 'QR_ACTIVO', fichaQr: r['fichaQr'], qrRuta: `tenants/${A}/pagos/${pagoId}/qr.png` });
    expect((p?.['venceEn'] as InstanceType<typeof Timestamp>).toMillis()).toBeGreaterThan(Date.now() + 71 * 3_600_000);
    expect((await cuenta())['pagoPendienteId']).toBe(pagoId);
    expect(await pendiente(pagoId)).toMatchObject({ tenantId: A, pagoId, cobroId: idDeCobro('novuchat', pagoId), fichaQr: r['fichaQr'] });
    expect(archivos.get(`tenants/${A}/pagos/${pagoId}/qr.png`)?.subarray(0, 8)).toEqual(pngMinimo().subarray(0, 8));

    // Lo que viajó al cobrador: referencia = pagoId, monto como texto, concepto sin datos del comercio.
    const c = doble.cobroPorReferencia(pagoId);
    expect(c).toMatchObject({ montoCentavos: 63000, concepto: 'NovuChat · Crecimiento · 1 mes' });
    expect(c?.concepto).not.toContain('Salón');
    expect(doble.llamadas).toEqual([{ metodo: 'POST', ruta: '/api/v1/cobros', status: 201 }]);
    expect(await auditoria('cobro_emitido')).toHaveLength(1);
  });

  it('un segundo pedido con el QR vivo → failed-precondition, y devuelve el vivo', async () => {
    const primero = await crear(MENSUALIDAD);
    const detalles = await rechaza(crear({ tenantId: A, tipo: 'bolsa', cantidad: 1 }), 'failed-precondition');
    expect(detalles).toMatchObject({ pagoId: primero['pagoId'], monto: 630, fichaQr: primero['fichaQr'], cobroEstado: 'QR_ACTIVO' });
    expect(doble.cobros.size).toBe(1);
    expect((await db.collection(`tenants/${A}/pagos`).get()).size).toBe(1);
  });

  it('el admin de B NO crea cobro en A, ni el operador, ni un admin con sesión de Google o sin verificar, ni el propietario con contraseña', async () => {
    for (const quien of [ADMIN_B, OPER_A, ADMIN_A_CON_GOOGLE, ADMIN_A_SIN_VERIFICAR, PROPIETARIO_CON_CONTRASENA]) {
      await rechaza(crear(MENSUALIDAD, quien), 'permission-denied');
    }
    await rechaza(crear(MENSUALIDAD, null), 'unauthenticated');
    expect((await db.collection(`tenants/${A}/pagos`).get()).size).toBe(0);
    expect((await cuenta())['pagoPendienteId']).toBeUndefined();
    expect(doble.cobros.size).toBe(0);
  });

  it('el propietario (Google) sí puede, en cualquier comercio', async () => {
    const r = await crear({ tenantId: B, tipo: 'instalacion' }, PROPIETARIO);
    expect(r).toMatchObject({ monto: Math.round(65 * TCO), descripcion: 'Instalación' });
    expect((await cuenta(B))['pagoPendienteId']).toBe(r['pagoId']);
    expect((await cuenta(A))['pagoPendienteId']).toBeUndefined();
  });

  it('sin TCO del día no se emite; con un TCO de hace 6 días tampoco', async () => {
    await db.doc('plataforma/tipoCambio').delete();
    await rechaza(crear(MENSUALIDAD), 'failed-precondition');
    await db.doc('plataforma/tipoCambio').set({ tco: TCO, fecha: new Date(Date.now() - 6 * DIA).toISOString().slice(0, 10), fuente: 'BCB' });
    await rechaza(crear(MENSUALIDAD), 'failed-precondition');
    await db.doc('plataforma/tipoCambio').set({ tco: 130, fecha: new Date().toISOString().slice(0, 10), fuente: 'BCB' });
    await rechaza(crear(MENSUALIDAD), 'failed-precondition');
    expect(doble.cobros.size).toBe(0);
    expect((await db.collection(`tenants/${A}/pagos`).get()).size).toBe(0);
  });

  it('los límites viven acá: 7 meses no, 0 bolsas no, plan demostracion no, tipo inventado no', async () => {
    await rechaza(crear({ tenantId: A, tipo: 'mensualidad', plan: 'crecimiento', meses: 7 }), 'invalid-argument');
    await rechaza(crear({ tenantId: A, tipo: 'mensualidad', plan: 'crecimiento', meses: 0 }), 'invalid-argument');
    await rechaza(crear({ tenantId: A, tipo: 'mensualidad', plan: 'demostracion', meses: 1 }), 'invalid-argument');
    await rechaza(crear({ tenantId: A, tipo: 'bolsa', cantidad: 0 }), 'invalid-argument');
    await rechaza(crear({ tenantId: A, tipo: 'bolsa', cantidad: 13 }), 'invalid-argument');
    await rechaza(crear({ tenantId: A, tipo: 'regalo' }), 'invalid-argument');
    await rechaza(crear({ tenantId: 'Otro/Comercio', tipo: 'instalacion' }), 'invalid-argument');
    expect(doble.cobros.size).toBe(0);
  });

  it('BORRADOR (falló el banco): queda pendiente sin QR y el siguiente intento retoma la MISMA referencia', async () => {
    doble.bancoCaido = true;
    await rechaza(crear(MENSUALIDAD), 'unavailable');
    const id = (await cuenta())['pagoPendienteId'] as string;
    expect(await pago(id)).toMatchObject({ estado: 'pendiente', cobro: { estado: 'BORRADOR' } });
    expect(await pendiente(id)).toMatchObject({ cobroId: null });
    // Otro pedido mientras la referencia está reservada con este importe: no.
    await rechaza(crear({ tenantId: A, tipo: 'mensualidad', plan: 'pro', meses: 1 }), 'failed-precondition');
    doble.bancoCaido = false;
    const r = await crear(MENSUALIDAD);
    expect(r).toMatchObject({ pagoId: id, reutilizado: true, cobro: { estado: 'QR_ACTIVO' } });
    expect(doble.cobros.size).toBe(1);
    expect(await pendiente(id)).toMatchObject({ cobroId: idDeCobro('novuchat', id) });
    expect(archivos.has(`tenants/${A}/pagos/${id}/qr.png`)).toBe(true);
  });

  it('QR_SUELTO_EN_EL_PROVEEDOR: se aborta, se audita y NO se reintenta con esa referencia', async () => {
    doble.qrSuelto = true;
    await rechaza(crear(MENSUALIDAD), 'aborted');
    const id = (await cuenta())['pagoPendienteId'] as string;
    expect(await pago(id)).toMatchObject({ estado: 'pendiente', cobro: { estado: 'QR_SUELTO' } });
    doble.qrSuelto = false;
    await rechaza(crear(MENSUALIDAD), 'failed-precondition');
    expect(doble.cobros.size).toBe(0);
    expect(await auditoria('cobro_suelto_en_el_proveedor')).toHaveLength(1);
  });

  it('si el cobrador no responde, la reserva queda y el reintento la retoma con el mismo QR', async () => {
    doble.noDisponible = true;
    await rechaza(crear(MENSUALIDAD), 'unavailable');
    const id = (await cuenta())['pagoPendienteId'] as string;
    doble.noDisponible = false;
    const r = await crear(MENSUALIDAD);
    expect(r).toMatchObject({ pagoId: id, reutilizado: true });
    expect(doble.cobros.size).toBe(1);
  });
});

// ===========================================================================
describe('2. El aviso del cobrador', () => {
  let pagoId: string;
  beforeEach(async () => { pagoId = (await crear(MENSUALIDAD))['pagoId'] as string; });

  it('bien firmado, pero el doble sigue en QR_ACTIVO o PAGO_DETECTADO → NO aplica: el aviso no confirma', async () => {
    let r = await aviso(pagoId);
    expect(r.codigo).toBe(200);
    expect(r.cuerpo).toEqual({ recibido: true, aplicado: false, estado: 'pendiente' });
    doble.fijarEstado(pagoId, 'PAGO_DETECTADO');
    r = await aviso(pagoId);
    expect(r.cuerpo).toEqual({ recibido: true, aplicado: false, estado: 'pendiente' });
    expect(await pago(pagoId)).toMatchObject({ estado: 'pendiente', cobro: { estado: 'PAGO_DETECTADO' } });
    expect((await cuenta())['periodoPagado']).toBeUndefined();
    expect((await cuenta())['pagoPendienteId']).toBe(pagoId);
    // El aviso disparó la consulta autenticada: es lo único que le creemos.
    expect(doble.llamadas.filter((l) => l.ruta.startsWith('/api/v1/cobros/por-referencia/'))).toHaveLength(2);
  });

  it('firma inválida, marca fuera de ±5 min, sin firma o GET → 401/405, y nada cambia aunque el doble diga CONFIRMADO', async () => {
    doble.fijarEstado(pagoId, 'CONFIRMADO');
    expect((await aviso(pagoId, { secreto: 'otro-secreto' })).codigo).toBe(401);
    expect((await aviso(pagoId, { marca: Date.now() - 6 * 60_000 })).codigo).toBe(401);
    expect((await aviso(pagoId, { marca: Date.now() + 6 * 60_000 })).codigo).toBe(401);
    const cuerpo = JSON.stringify(doble.avisoDe(pagoId));
    expect((await http(avisoCobrador, 'POST', { 'content-type': 'application/json' }, cuerpo)).codigo).toBe(401);
    expect((await http(avisoCobrador, 'GET', firmarAviso(SECRETO_AVISO, '', Date.now()), null)).codigo).toBe(405);
    // Un cuerpo alterado después de firmar: la referencia de otro pago.
    const firmado = firmarAviso(SECRETO_AVISO, cuerpo, Date.now());
    expect((await http(avisoCobrador, 'POST', firmado, cuerpo.replace(pagoId, 'x'.repeat(22)))).codigo).toBe(401);

    expect(await pago(pagoId)).toMatchObject({ estado: 'pendiente' });
    expect((await cuenta())['periodoPagado']).toBeUndefined();
    expect(doble.llamadas.filter((l) => l.metodo === 'GET')).toHaveLength(0);   // ni una consulta
    expect(await bitacora('pago_registrado')).toHaveLength(0);
  });

  it('bien firmado y CONFIRMADO → confirmado: +1 mes, corte y pendiente borrados, bitácora, auditoría y confirmación encolada', async () => {
    doble.fijarEstado(pagoId, 'CONFIRMADO', { riel: 'watcher-baneco' });
    const r = await aviso(pagoId);
    expect(r.codigo).toBe(200);
    expect(r.cuerpo).toEqual({ recibido: true, aplicado: true, estado: 'confirmado' });

    const p = await pago(pagoId);
    expect(p).toMatchObject({
      estado: 'confirmado', montoRecibidoBs: 630, cubiertoHasta: HOY,
      confirmadoPor: { origen: 'banco', cobroId: idDeCobro('novuchat', pagoId), riel: 'api-baneco', confirmadoPorCobrador: 'automatico', avisoId: idDeCobro('novuchat', pagoId) },
      cobro: { estado: 'CONFIRMADO' },
    });
    const c = await cuenta();
    expect(c).toMatchObject({ periodoPagado: HOY, modalidad: 'prepago', plan: 'crecimiento', estadoPago: 'al_dia', montoMensual: 50, moneda: 'USD' });
    expect(c['pagoPendienteId']).toBeUndefined();
    expect(c['corte']).toBeUndefined();
    expect(c['confirmacionesPendientes']).toMatchObject({ [pagoId]: { plantilla: 'pago_confirmado', cubiertoHasta: HOY } });
    expect(await pendiente(pagoId)).toBeUndefined();
    expect(await resuelto(pagoId)).toMatchObject({ tenantId: A, estado: 'confirmado' });
    expect(await bitacora('pago_registrado')).toMatchObject([{ resultado: 'ok', canal: 'sistema', codigo: 'banco' }]);
    expect(await auditoria('pago_aplicado')).toMatchObject([{ pagoId, via: 'aviso', riel: 'api-baneco', montoRecibidoBs: 630 }]);
    // B no se enteró de nada.
    expect((await cuenta(B))['periodoPagado']).toBeUndefined();
  });

  it('un aviso repetido responde aplicado:false con el estado real y NO duplica los meses', async () => {
    doble.fijarEstado(pagoId, 'CONFIRMADO');
    await aviso(pagoId);
    const r = await aviso(pagoId);
    expect(r.cuerpo).toEqual({ recibido: true, aplicado: false, estado: 'confirmado' });
    expect((await cuenta())['periodoPagado']).toBe(HOY);
    expect(await bitacora('pago_registrado')).toHaveLength(1);
    expect(await auditoria('pago_aplicado')).toHaveLength(1);
  });

  it('una referencia desconocida responde 200 desconocido (para que el cobrador cierre el aviso) y no toca nada', async () => {
    const cuerpo = JSON.stringify({ ...doble.avisoDe(pagoId), referenciaExterna: 'zzzzzzzzzzzzzzzzzzzzzz' });
    const r = await aviso(pagoId, { cuerpo });
    expect(r.cuerpo).toEqual({ recibido: true, aplicado: false, estado: 'desconocido' });
    expect(await pago(pagoId)).toMatchObject({ estado: 'pendiente' });
  });

  it('si el cobrador no responde a la consulta, 503: el cobrador reintenta, y nada se aplicó', async () => {
    doble.fijarEstado(pagoId, 'CONFIRMADO');
    doble.noDisponible = true;
    const r = await aviso(pagoId);
    expect(r.codigo).toBe(503);
    expect(await pago(pagoId)).toMatchObject({ estado: 'pendiente' });
  });

  it('un cuerpo bien firmado sin la forma del aviso → 400, no 401', async () => {
    expect((await aviso(pagoId, { cuerpo: '{"evento":"otro"}' })).codigo).toBe(400);
  });
});

// ===========================================================================
describe('3. El barrido horario', () => {
  it('sin aviso, confirma; los meses se suman sobre lo ya cubierto', async () => {
    await db.doc(`tenants/${A}/cuenta/estado`).set({ periodoPagado: HOY }, { merge: true });
    const pagoId = (await crear({ tenantId: A, tipo: 'mensualidad', plan: 'pro', meses: 3 }))['pagoId'] as string;
    doble.fijarEstado(pagoId, 'CONFIRMADO');
    const r = await barrerCobrosPendientes(Date.now());
    expect(r).toMatchObject({ revisados: 1, confirmados: 1, errores: 0 });
    const c = await cuenta();
    expect(c).toMatchObject({ periodoPagado: sumarMeses(HOY, 3), plan: 'pro', modalidad: 'prepago' });
    expect(c['limites']).toMatchObject({ conversaciones: 500 });
    expect((await db.doc(`tenants/${A}`).get()).get('plan')).toBe('pro');
    expect(await auditoria('pago_aplicado')).toMatchObject([{ via: 'barrido' }]);
    // La segunda corrida no encuentra nada.
    expect(await barrerCobrosPendientes(Date.now())).toMatchObject({ revisados: 0 });
  });

  it('6 meses regalan una bolsa; una bolsa suma 30 por unidad; la instalación no suma nada', async () => {
    let id = (await crear({ tenantId: A, tipo: 'mensualidad', plan: 'crecimiento', meses: 6 }))['pagoId'] as string;
    doble.fijarEstado(id, 'CONFIRMADO');
    await barrerCobrosPendientes(Date.now());
    expect(await cuenta()).toMatchObject({ periodoPagado: sumarMeses(HOY, 5), bolsa: 30 });
    id = (await crear({ tenantId: A, tipo: 'bolsa', cantidad: 2 }))['pagoId'] as string;
    doble.fijarEstado(id, 'CONFIRMADO');
    await barrerCobrosPendientes(Date.now());
    expect(await cuenta()).toMatchObject({ periodoPagado: sumarMeses(HOY, 5), bolsa: 90 });
    id = (await crear({ tenantId: A, tipo: 'instalacion' }))['pagoId'] as string;
    doble.fijarEstado(id, 'CONFIRMADO');
    await barrerCobrosPendientes(Date.now());
    expect(await cuenta()).toMatchObject({ periodoPagado: sumarMeses(HOY, 5), bolsa: 90 });
    expect(await pago(id)).toMatchObject({ estado: 'confirmado', cubiertoHasta: sumarMeses(HOY, 5) });
  });

  it('VENCIDO → vencido y limpia pagoPendienteId; después se puede emitir otro', async () => {
    const pagoId = (await crear(MENSUALIDAD))['pagoId'] as string;
    doble.fijarEstado(pagoId, 'VENCIDO');
    expect(await barrerCobrosPendientes(Date.now())).toMatchObject({ vencidos: 1 });
    expect(await pago(pagoId)).toMatchObject({ estado: 'vencido' });
    expect((await cuenta())['pagoPendienteId']).toBeUndefined();
    expect((await cuenta())['periodoPagado']).toBeUndefined();
    expect(await pendiente(pagoId)).toBeUndefined();
    const otro = await crear(MENSUALIDAD);
    expect(otro['pagoId']).not.toBe(pagoId);
  });

  it('ANULADO y RECHAZADO → anulado; PAGO_DETECTADO y EN_REVISION siguen pendientes', async () => {
    const a = (await crear(MENSUALIDAD))['pagoId'] as string;
    doble.fijarEstado(a, 'RECHAZADO');
    expect(await barrerCobrosPendientes(Date.now())).toMatchObject({ anulados: 1 });
    expect(await pago(a)).toMatchObject({ estado: 'anulado', motivoAnulacion: 'cobrador:RECHAZADO' });
    const b = (await crear(MENSUALIDAD))['pagoId'] as string;
    doble.fijarEstado(b, 'EN_REVISION');
    expect(await barrerCobrosPendientes(Date.now())).toMatchObject({ sinCambio: 1 });
    expect(await pago(b)).toMatchObject({ estado: 'pendiente', cobro: { estado: 'EN_REVISION' } });
    expect(await auditoria('cobro_en_revision')).toHaveLength(1);
    await barrerCobrosPendientes(Date.now());
    expect(await auditoria('cobro_en_revision')).toHaveLength(1);   // una vez, no una por corrida
  });

  it('un QR_ACTIVO vencido hace más de un día se ANULA en el cobrador y se cierra; si había plata, se aplica', async () => {
    const a = (await crear(MENSUALIDAD))['pagoId'] as string;
    doble.vencerQr(a, 2 * DIA);
    expect(await barrerCobrosPendientes(Date.now())).toMatchObject({ vencidos: 1 });
    expect(doble.cobroPorReferencia(a)?.estado).toBe('ANULADO');
    expect(await pago(a)).toMatchObject({ estado: 'vencido' });

    const b = (await crear(MENSUALIDAD))['pagoId'] as string;
    doble.vencerQr(b, 2 * DIA);
    doble.fijarAnulacion(b, 'PAGADO_NO_SE_ANULA');
    doble.fijarEstado(b, 'PAGO_DETECTADO');
    expect(await barrerCobrosPendientes(Date.now())).toMatchObject({ sinCambio: 1 });
    expect(await pago(b)).toMatchObject({ estado: 'pendiente', cobro: { estado: 'PAGO_DETECTADO' } });
    // Vencido hace menos de un día: se deja, el banco todavía lo cobra.
    const c = (await crear({ tenantId: B, tipo: 'instalacion' }, PROPIETARIO))['pagoId'] as string;
    doble.vencerQr(c, 2 * 3_600_000);
    expect(await barrerCobrosPendientes(Date.now())).toMatchObject({ sinCambio: 2 });
    expect(doble.cobroPorReferencia(c)?.estado).toBe('QR_ACTIVO');
  });

  it('un error en un pendiente no frena a los demás', async () => {
    const a = (await crear(MENSUALIDAD))['pagoId'] as string;
    const b = (await crear({ tenantId: B, tipo: 'instalacion' }, PROPIETARIO))['pagoId'] as string;
    doble.cobros.delete(idDeCobro('novuchat', a));      // el cobrador «perdió» el de A: 404
    doble.fijarEstado(b, 'CONFIRMADO');
    const r = await barrerCobrosPendientes(Date.now());
    expect(r).toMatchObject({ revisados: 2, confirmados: 1, errores: 1 });
    expect(await pago(b, B)).toMatchObject({ estado: 'confirmado' });
  });

  it('la consulta puntual (al abrir la pantalla) aplica igual que el barrido', async () => {
    const a = (await crear(MENSUALIDAD))['pagoId'] as string;
    expect(await consultarYAplicar(A, a, { via: 'consulta' })).toEqual({ aplicado: false, estado: 'pendiente' });
    doble.fijarEstado(a, 'CONFIRMADO');
    expect(await consultarYAplicar(A, a, { via: 'consulta' })).toEqual({ aplicado: true, estado: 'confirmado' });
    expect(await consultarYAplicar(A, a, { via: 'consulta' })).toEqual({ aplicado: false, estado: 'confirmado', ya: true });
    expect(await consultarYAplicar(A, 'x'.repeat(22), { via: 'consulta' })).toEqual({ aplicado: false, estado: 'desconocido' });
  });
});

// ===========================================================================
describe('4. Anular el QR vivo antes de cargar un pago manual', () => {
  it('con el QR vivo lo anula en el cobrador y acá, y limpia el pendiente', async () => {
    const a = (await crear(MENSUALIDAD))['pagoId'] as string;
    expect(await anularCobroVivo(A, a, 'pago_manual')).toEqual({ resultado: 'anulado' });
    expect(doble.cobroPorReferencia(a)?.estado).toBe('ANULADO');
    expect(await pago(a)).toMatchObject({ estado: 'anulado', motivoAnulacion: 'pago_manual', anuladoPor: 'novuchat' });
    expect((await cuenta())['pagoPendienteId']).toBeUndefined();
    expect(await pendiente(a)).toBeUndefined();
    expect(await resuelto(a)).toMatchObject({ estado: 'anulado' });
    expect(await anularCobroVivo(A, a, 'otra vez')).toEqual({ resultado: 'sin_cobro' });
  });

  it('con PAGADO_NO_SE_ANULA aplica el del banco y avisa que el manual no se carga', async () => {
    const a = (await crear(MENSUALIDAD))['pagoId'] as string;
    doble.fijarEstado(a, 'CONFIRMADO');
    expect(await anularCobroVivo(A, a, 'pago_manual')).toEqual({ resultado: 'pagado', estado: 'confirmado' });
    expect(await pago(a)).toMatchObject({ estado: 'confirmado' });
    expect((await cuenta())['periodoPagado']).toBe(HOY);
  });

  it('con PAGO_TARDIO_EN_REVISION deja el pendiente y audita; si el cobrador no responde, lanza y no toca nada', async () => {
    const a = (await crear(MENSUALIDAD))['pagoId'] as string;
    doble.fijarAnulacion(a, 'PAGO_TARDIO_EN_REVISION');
    expect(await anularCobroVivo(A, a, 'pago_manual')).toEqual({ resultado: 'en_revision' });
    expect(await pago(a)).toMatchObject({ estado: 'pendiente' });
    const b = (await crear({ tenantId: B, tipo: 'instalacion' }, PROPIETARIO))['pagoId'] as string;
    doble.noDisponible = true;
    await expect(anularCobroVivo(B, b, 'pago_manual')).rejects.toThrow();
    expect(await pago(b, B)).toMatchObject({ estado: 'pendiente' });
  });
});

// ===========================================================================
describe('5. La imagen del QR', () => {
  it('sirve el PNG del pendiente con caché corta y nosniff; 404 para una ficha inválida, ajena o de un pago cerrado', async () => {
    const r = await crear(MENSUALIDAD);
    const ficha = r['fichaQr'] as string;
    const ok = await imagen(ficha);
    expect(ok.codigo).toBe(200);
    expect(ok.cabeceras).toMatchObject({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' });
    expect((ok.cuerpo as Buffer).subarray(0, 8)).toEqual(pngMinimo().subarray(0, 8));
    expect((await imagen('no-es-una-ficha')).codigo).toBe(404);
    expect((await imagen('0'.repeat(32))).codigo).toBe(404);
    doble.fijarEstado(r['pagoId'] as string, 'CONFIRMADO');
    await barrerCobrosPendientes(Date.now());
    expect((await imagen(ficha)).codigo).toBe(404);
  });

  it('la función interna sirve al WhatsApp interno con canal y autor propios', async () => {
    const r = await crearCobroInterno(A, { tipo: 'mensualidad', plan: 'impulso', meses: 1 }, { uid: 'whatsapp', creadoPor: 'whatsapp:0001', canal: 'whatsapp' });
    expect(await pago(r.pagoId)).toMatchObject({ canal: 'whatsapp', creadoPor: 'whatsapp:0001', monto: Math.round(25 * TCO) });
  });
});
