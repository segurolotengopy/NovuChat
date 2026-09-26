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
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));

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
  fijarAlmacenDePrueba, consultarYAplicar, sondearCobrosPendientes, TOPE_SONDEO,
} = await import('../functions/src/cobroPrepago.ts');
const { mesBolivia, sumarMeses } = await import('../functions/src/prepago.ts');
const { puertaDePagos } = await import('../functions/src/pagos.ts');
const { limitesDe } = await import('../functions/src/planes.ts');

const A = 'prep-salon';
const B = 'prep-otro';
const HOY = mesBolivia(Date.now());
const DIA = 86_400_000;
const TCO = 12.6;

// --- El doble, el cliente HTTP real contra él, y el almacén en memoria -------
let doble: CobradorDoble;
const archivos = new Map<string, Buffer>();
/** Cuántas veces seguidas va a fallar el almacén (Storage caído). */
let fallosDeAlmacen = 0;
fijarAlmacenDePrueba({
  async guardar(ruta, bytes) {
    if (fallosDeAlmacen > 0) { fallosDeAlmacen -= 1; throw new Error('storage caído'); }
    archivos.set(ruta, bytes);
  },
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
// `auth_time` (segundos) de ahora: el propietario que pide un QR de OTRO plan
// firma el cambio, y eso exige una sesión de menos de media hora (tercera
// vuelta de #212, LOW 3). La vieja y la sin `auth_time` son las negativas.
const AUTH_TIME = Math.floor(Date.now() / 1000);
const PROPIETARIO = { uid: 'prop', token: { ...token({ p: true }, 'google.com'), auth_time: AUTH_TIME } };
const PROPIETARIO_SESION_VIEJA = { uid: 'prop', token: { ...PROPIETARIO.token, auth_time: AUTH_TIME - 7200 } };
const PROPIETARIO_SIN_AUTH_TIME = { uid: 'prop', token: token({ p: true }, 'google.com') };
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
  nuevoDoble(); archivos.clear(); fallosDeAlmacen = 0;
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
    expect(await pendiente(pagoId)).toMatchObject({ tenantId: A, pagoId, cobroId: idDeCobro('novuchat', pagoId), estado: 'QR_ACTIVO', fichaQr: r['fichaQr'] });
    expect(archivos.get(`tenants/${A}/pagos/${pagoId}/qr.png`)?.subarray(0, 8)).toEqual(pngMinimo().subarray(0, 8));

    // Lo que viajó al cobrador: referencia = pagoId, monto como texto, concepto sin datos del comercio.
    const c = doble.cobroPorReferencia(pagoId);
    expect(c).toMatchObject({ montoCentavos: 63000, concepto: 'NovuChat · Crecimiento · 1 mes' });
    expect(c?.concepto).not.toContain('Salón');
    expect(doble.llamadas).toEqual([{ metodo: 'POST', ruta: '/api/v1/cobros', status: 201 }]);
    expect(await auditoria('cobro_emitido')).toHaveLength(1);
  });

  // BYOC lo asigna NovuChat (revisión de seguridad del pase, 24/09/2026): la
  // pantalla solo lo ofrece a quien ya lo tiene, y el servidor tiene que negarlo
  // aunque la petición se arme a mano. Se prueba NEGANDO, y sin escribir nada.
  it('un administrador NO se paga BYOC armando la petición a mano, y no queda nada reservado', async () => {
    await rechaza(crear({ ...MENSUALIDAD, plan: 'byoc' }), 'permission-denied');
    expect((await cuenta())['pagoPendienteId']).toBeUndefined();
    expect((await db.collection(`tenants/${A}/pagos`).get()).size).toBe(0);
    expect(doble.llamadas).toEqual([]);
  });

  it('tampoco por WhatsApp: sin rol vale lo mismo que un administrador', async () => {
    await rechaza(crearCobroInterno(A, { tipo: 'mensualidad', plan: 'byoc', meses: 1 },
      { uid: 'whatsapp', creadoPor: 'whatsapp:0001', canal: 'whatsapp' }), 'permission-denied');
    expect((await db.collection(`tenants/${A}/pagos`).get()).size).toBe(0);
  });

  it('el comercio que YA es BYOC lo renueva, y el propietario lo asigna', async () => {
    await db.doc(`tenants/${B}/cuenta/estado`).set({ plan: 'byoc', modalidad: 'prepago' });
    const renovado = await crear({ tenantId: B, tipo: 'mensualidad', plan: 'byoc', meses: 1 }, ADMIN_B);
    expect(renovado).toMatchObject({ estado: 'pendiente', tipo: 'mensualidad' });
    expect((await pago(renovado['pagoId'] as string, B))?.['plan']).toBe('byoc');

    const asignado = await crear({ ...MENSUALIDAD, plan: 'byoc' }, PROPIETARIO);
    expect((await pago(asignado['pagoId'] as string))?.['plan']).toBe('byoc');
  });

  // EL COMERCIO RENUEVA SU PLAN; EL CAMBIO LO HACE NOVUCHAT (Andres,
  // 26/09/2026). Hasta ese día un administrador podía pasarse a cualquier plan
  // publicado pagando: una baja era apretar «Pagar». Se prueba NEGANDO.
  it('un administrador NO se pasa a otro plan pagando, ni para subir ni para bajar: nada reservado, nada auditado', async () => {
    for (const plan of ['pro', 'impulso']) {
      await expect(crear({ ...MENSUALIDAD, plan })).rejects.toMatchObject({
        code: 'permission-denied', message: expect.stringMatching(/El cambio de plan lo hace NovuChat/),
      });
    }
    // Ni el de OTRO comercio pidiendo por el suyo, ni el administrador de B el plan de A.
    await rechaza(crear({ tenantId: B, tipo: 'mensualidad', plan: 'crecimiento', meses: 1 }, ADMIN_B), 'permission-denied');
    expect((await cuenta())['pagoPendienteId']).toBeUndefined();
    expect((await db.collection(`tenants/${A}/pagos`).get()).size).toBe(0);
    expect((await db.collection(`tenants/${B}/pagos`).get()).size).toBe(0);
    expect(await auditoria('cobro_emitido')).toHaveLength(0);
    expect(doble.llamadas).toEqual([]);
    expect(await cuenta()).toMatchObject({ plan: 'crecimiento' });
  });

  it('una cuenta sin plan del catálogo no se renueva sola: el plan lo asigna NovuChat', async () => {
    await db.doc(`tenants/${B}/cuenta/estado`).set({ plan: 'basico', modalidad: 'prepago' });
    for (const plan of ['impulso', 'crecimiento', 'pro']) {
      await rechaza(crear({ tenantId: B, tipo: 'mensualidad', plan, meses: 1 }, ADMIN_B), 'permission-denied');
    }
    expect((await db.collection(`tenants/${B}/pagos`).get()).size).toBe(0);
  });

  it('el administrador SÍ renueva su plan actual, y el propietario sí cambia el plan por QR', async () => {
    const r = await crear(MENSUALIDAD);
    expect((await pago(r['pagoId'] as string))?.['plan']).toBe('crecimiento');
    await db.doc(`tenants/${B}/cuenta/estado`).set({ plan: 'impulso', modalidad: 'prepago' });
    const cambio = await crear({ tenantId: B, tipo: 'mensualidad', plan: 'pro', meses: 1 }, PROPIETARIO);
    expect((await pago(cambio['pagoId'] as string, B))?.['plan']).toBe('pro');
  });

  it('las bolsas y la instalación no fijan plan: el administrador las paga como siempre', async () => {
    const r = await crear({ tenantId: A, tipo: 'bolsa', cantidad: 1 });
    expect(r).toMatchObject({ estado: 'pendiente', tipo: 'bolsa' });
  });

  it('sin cobrador configurado → failed-precondition ANTES de reservar: ningún pendiente trabado', async () => {
    registrarCobradorDoble(null);
    await db.doc('plataforma/prepago').set({ corteActivo: false });
    const r = crear(MENSUALIDAD);
    await rechaza(r, 'failed-precondition');
    expect((await cuenta())['pagoPendienteId']).toBeUndefined();
    expect((await db.collection(`tenants/${A}/pagos`).get()).size).toBe(0);
    expect((await db.collection('cobrosPendientes').get()).size).toBe(0);
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
    expect(await pago(id)).toMatchObject({ estado: 'pendiente', cobro: { id: idDeCobro('novuchat', id), estado: 'BORRADOR' } });
    // El índice también sabe el id del cobro: el barrido lo consulta aunque no haya QR.
    expect(await pendiente(id)).toMatchObject({ cobroId: idDeCobro('novuchat', id) });
    // Otro pedido mientras la referencia está reservada con este importe: no.
    // (Lo pide el propietario: un administrador ni siquiera llega acá, porque
    // no puede pedir otro plan.)
    await rechaza(crear({ tenantId: A, tipo: 'mensualidad', plan: 'pro', meses: 1 }, PROPIETARIO), 'failed-precondition');
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

  it('si el almacén falla una vez, el segundo intento retoma el cobro, pide SOLO la imagen y la sirve', async () => {
    fallosDeAlmacen = 1;
    await rechaza(crear(MENSUALIDAD), 'unavailable');
    const id = (await cuenta())['pagoPendienteId'] as string;
    expect(await pago(id)).toMatchObject({ estado: 'pendiente', cobro: { id: idDeCobro('novuchat', id), estado: 'QR_ACTIVO', qrRuta: null } });
    expect(await auditoria('cobro_emitido')).toMatchObject([{ conQr: false }]);
    const r = await crear(MENSUALIDAD);
    expect(r).toMatchObject({ pagoId: id, reutilizado: true, cobro: { estado: 'QR_ACTIVO' } });
    expect(doble.llamadas.filter((l) => l.metodo === 'POST')).toHaveLength(1);           // no se pidió un segundo QR
    expect(doble.llamadas.filter((l) => l.ruta.endsWith('/qr'))).toHaveLength(1);        // se pidió solo la imagen
    expect(await pago(id)).toMatchObject({ cobro: { qrRuta: `tenants/${A}/pagos/${id}/qr.png` } });
    expect((await imagen(r['fichaQr'] as string)).codigo).toBe(200);
    expect(doble.cobros.size).toBe(1);
  });

  it('un comercio dado de baja no emite cobros; uno suspendido sí', async () => {
    await db.doc(`tenants/${B}`).set({ estado: 'dado_de_baja' }, { merge: true });
    await rechaza(crear({ tenantId: B, tipo: 'instalacion' }, PROPIETARIO), 'failed-precondition');
    expect((await cuenta(B))['pagoPendienteId']).toBeUndefined();
    expect((await db.collection(`tenants/${B}/pagos`).get()).size).toBe(0);
    expect(doble.cobros.size).toBe(0);
    await db.doc(`tenants/${B}`).set({ estado: 'suspendido' }, { merge: true });
    expect(await crear({ tenantId: B, tipo: 'instalacion' }, PROPIETARIO)).toMatchObject({ estado: 'pendiente' });
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

  it('CONFIRMADO con 600 sobre un cobro de 630 → NO suma meses: queda pendiente con lo recibido, y audita una vez', async () => {
    doble.fijarEstado(pagoId, 'CONFIRMADO', { montoCentavos: 60000 });
    expect((await aviso(pagoId)).cuerpo).toEqual({ recibido: true, aplicado: false, estado: 'pendiente' });
    expect(await pago(pagoId)).toMatchObject({ estado: 'pendiente', montoRecibidoBs: 600, cobro: { estado: 'CONFIRMADO' } });
    expect((await cuenta())['periodoPagado']).toBeUndefined();
    expect((await cuenta())['pagoPendienteId']).toBe(pagoId);
    expect(await pendiente(pagoId)).toBeDefined();
    expect(await auditoria('pago_importe_menor')).toMatchObject([{ pagoId, esperado: 630, recibido: 600, via: 'aviso' }]);
    expect(await bitacora('pago_registrado')).toHaveLength(0);
    // El barrido lo vuelve a ver y no vuelve a auditar ni acredita.
    expect(await barrerCobrosPendientes(Date.now())).toMatchObject({ sinCambio: 1, confirmados: 0 });
    expect(await auditoria('pago_importe_menor')).toHaveLength(1);
    // De más sí se acredita (decisión 8: nunca se pierde), con lo recibido anotado.
    const b = (await crear({ tenantId: B, tipo: 'instalacion' }, PROPIETARIO))['pagoId'] as string;
    doble.fijarEstado(b, 'CONFIRMADO', { montoCentavos: 90000 });
    expect((await aviso(b)).cuerpo).toMatchObject({ aplicado: true, estado: 'confirmado' });
    expect(await pago(b, B)).toMatchObject({ estado: 'confirmado', montoRecibidoBs: 900 });
  });

  it('con un secreto de aviso demasiado corto, 401 aunque la firma cierre con él', async () => {
    process.env['COBRADOR_AVISO_SECRETO'] = 'corto';
    try {
      doble.fijarEstado(pagoId, 'CONFIRMADO');
      expect((await aviso(pagoId, { secreto: 'corto' })).codigo).toBe(401);
      expect(await pago(pagoId)).toMatchObject({ estado: 'pendiente' });
      expect(doble.llamadas.filter((l) => l.metodo === 'GET')).toHaveLength(0);
    } finally {
      process.env['COBRADOR_AVISO_SECRETO'] = SECRETO_AVISO;
    }
  });

  it('un cuerpo bien firmado sin la forma del aviso → 400, no 401', async () => {
    expect((await aviso(pagoId, { cuerpo: '{"evento":"otro"}' })).codigo).toBe(400);
  });
});

// ===========================================================================
describe('1bis. Una cuenta en demostración no emite cobros (opción B, 26/09/2026)', () => {
  it('ni el administrador ni el propietario: failed-precondition antes de reservar, sin escrituras ni llamadas al cobrador', async () => {
    for (const cuentaDemo of [{ plan: 'crecimiento', modalidad: 'demostracion' }, { plan: 'crecimiento' }]) {
      await db.doc(`tenants/${A}/cuenta/estado`).set(cuentaDemo);
      for (const [pedido, quien] of [[MENSUALIDAD, ADMIN_A], [MENSUALIDAD, PROPIETARIO], [{ tenantId: A, tipo: 'bolsa', cantidad: 1 }, ADMIN_A]] as const) {
        await expect(crear(pedido, quien)).rejects.toMatchObject({
          code: 'failed-precondition',
          message: 'La cuenta está en demostración: NovuChat la pasa a prueba o producción antes de cobrar.',
        });
      }
      const c = await cuenta();
      expect(c).toEqual(cuentaDemo);
      expect((await db.collection(`tenants/${A}/pagos`).get()).size).toBe(0);
      expect((await db.collection('cobrosPendientes').where('tenantId', '==', A).get()).size).toBe(0);
    }
    expect(doble.llamadas).toEqual([]);
    expect(await auditoria('cobro_emitido')).toHaveLength(0);
  });

  it('en prueba sí se cobra, y el pago confirmado NO la pasa a producción: sigue en prueba', async () => {
    await db.doc(`tenants/${A}/cuenta/estado`).set({ plan: 'crecimiento', modalidad: 'prueba', periodoPrueba: HOY, bolsaPrueba: 20 });
    const pagoId = (await crear(MENSUALIDAD))['pagoId'] as string;
    doble.fijarEstado(pagoId, 'CONFIRMADO');
    expect((await aviso(pagoId)).cuerpo).toMatchObject({ aplicado: true });
    expect(await cuenta()).toMatchObject({ modalidad: 'prueba', periodoPrueba: HOY, periodoPagado: sumarMeses(HOY, 1) });
  });
});

describe('1ter. Un QR confirmado de OTRO plan no cambia el plan sin autorización del propietario (LOW 2 de #212)', () => {
  it('el QR que pide el propietario con otro plan queda firmado; el del comercio con su plan, no', async () => {
    const delComercio = await crear(MENSUALIDAD);
    expect((await pago(delComercio['pagoId'] as string))?.['cambioAutorizadoPor']).toBeUndefined();
    await db.doc(`tenants/${B}/cuenta/estado`).set({ plan: 'impulso', modalidad: 'prepago' });
    const delPropietario = await crear({ tenantId: B, tipo: 'mensualidad', plan: 'pro', meses: 1 }, PROPIETARIO);
    expect((await pago(delPropietario['pagoId'] as string, B))?.['cambioAutorizadoPor']).toBe('prop');
  });

  it('un QR del plan viejo, confirmado después de un cambio de plan: queda EN REVISIÓN, sin tocar plan, límites ni meses', async () => {
    const pagoId = (await crear(MENSUALIDAD))['pagoId'] as string;   // Crecimiento, sin firma
    // NovuChat cambió el plan mientras el QR estaba vivo (antes de la regla
    // que ahora lo impide en Negocios, o un QR anterior al 26/09).
    const PRO = { conversaciones: 500, productos: 500, agendas: 10, cambiosIncluidos: 2 };
    await db.doc(`tenants/${A}/cuenta/estado`).set({ plan: 'pro', limites: PRO }, { merge: true });
    await db.doc(`tenants/${A}`).set({ plan: 'pro' }, { merge: true });
    doble.fijarEstado(pagoId, 'CONFIRMADO');
    expect((await aviso(pagoId)).cuerpo).toEqual({ recibido: true, aplicado: false, estado: 'pendiente' });
    expect(await pago(pagoId)).toMatchObject({ estado: 'pendiente', revision: 'plan_distinto', montoRecibidoBs: 630, cobro: { estado: 'CONFIRMADO' } });
    const c = await cuenta();
    expect(c).toMatchObject({ plan: 'pro', limites: PRO, pagoPendienteId: pagoId });
    expect(c['periodoPagado']).toBeUndefined();
    expect((await db.doc(`tenants/${A}`).get()).get('plan')).toBe('pro');
    expect(await auditoria('pago_aplicado')).toHaveLength(0);
    expect(await auditoria('pago_plan_distinto')).toMatchObject([{ pagoId, planPedido: 'crecimiento', planVigente: 'pro', recibido: 630 }]);
    // Un segundo aviso no duplica la auditoría.
    await aviso(pagoId);
    expect(await auditoria('pago_plan_distinto')).toHaveLength(1);
  });

  it('el QR firmado por el propietario sí cambia el plan al confirmarse', async () => {
    await db.doc(`tenants/${B}/cuenta/estado`).set({ plan: 'impulso', modalidad: 'prepago' });
    const pagoId = (await crear({ tenantId: B, tipo: 'mensualidad', plan: 'pro', meses: 1 }, PROPIETARIO))['pagoId'] as string;
    doble.fijarEstado(pagoId, 'CONFIRMADO');
    expect((await aviso(pagoId)).cuerpo).toMatchObject({ aplicado: true, estado: 'confirmado' });
    expect(await cuenta(B)).toMatchObject({ plan: 'pro', modalidad: 'prepago' });
  });

  it('la puerta misma se niega a aplicar un cambio de plan del banco sin firma (la red detrás de la revisión)', () => {
    const tx = { update: () => undefined, set: () => undefined, create: () => undefined };
    const refs = { pago: {}, cuenta: {}, ficha: {}, cobroPendiente: {} };
    expect(() => puertaDePagos.aplicarPagoEnTransaccion(tx as never, refs as never, {
      id: 'x'.repeat(22), cuenta: { plan: 'impulso', modalidad: 'prepago' }, ficha: {},
      datos: { tipo: 'mensualidad', plan: 'pro', meses: 1, estado: 'pendiente' },
    }, {
      origen: 'banco', cobroId: 'c', riel: null, confirmadoPorCobrador: 'automatico', montoRecibidoBs: 1134,
      confirmadoEn: Timestamp.now(), ahoraMs: Date.now(),
    })).toThrow(/sin autorización del propietario/);
  });
});

describe('1quater. El pago en revisión se resuelve, con auditoría y sesión reciente (tercera vuelta de #212)', () => {
  const PRO = { conversaciones: 500, productos: 500, agendas: 10, cambiosIncluidos: 2 };
  type Callable = { run: (x: unknown) => Promise<Record<string, unknown>> };
  const conCobrador = async () => import('../functions/src/pagosConCobrador.ts') as unknown as Promise<Record<string, Callable>>;

  /** Un QR de Crecimiento sin firma, confirmado por el banco después de que NovuChat pasó la cuenta a Pro. */
  async function pagoEnRevision(): Promise<{ pagoId: string; ficha: string }> {
    const r = await crear(MENSUALIDAD);
    const pagoId = r['pagoId'] as string;
    await db.doc(`tenants/${A}/cuenta/estado`).set({ plan: 'pro', limites: PRO }, { merge: true });
    await db.doc(`tenants/${A}`).set({ plan: 'pro' }, { merge: true });
    doble.fijarEstado(pagoId, 'CONFIRMADO');
    expect((await aviso(pagoId)).cuerpo).toEqual({ recibido: true, aplicado: false, estado: 'pendiente' });
    expect(await pago(pagoId)).toMatchObject({ estado: 'pendiente', revision: 'plan_distinto', cobro: { estado: 'CONFIRMADO' } });
    return { pagoId, ficha: r['fichaQr'] as string };
  }

  it('revisión → confirmarPendiente: plan, límites, espejo, auditoría con antes y después; el banco no vuelve a sumar; repetirlo no pasa', async () => {
    const { pagoId } = await pagoEnRevision();
    const { registrarPagoManual } = await conCobrador();
    const confirmar = { tenantId: A, confirmarPendiente: pagoId, montoRecibidoBs: 630, motivoDiferencia: 'QR emitido antes del cambio a Pro' };

    // NEGATIVAS primero: sin motivo, un admin, una sesión vieja. Nada cambia.
    await rechaza(registrarPagoManual.run({ data: { ...confirmar, motivoDiferencia: '' }, auth: PROPIETARIO, rawRequest: {} }), 'invalid-argument');
    await rechaza(registrarPagoManual.run({ data: confirmar, auth: ADMIN_A, rawRequest: {} }), 'permission-denied');
    await rechaza(registrarPagoManual.run({ data: confirmar, auth: PROPIETARIO_SESION_VIEJA, rawRequest: {} }), 'unauthenticated');
    expect(await pago(pagoId)).toMatchObject({ estado: 'pendiente', revision: 'plan_distinto' });
    expect(await cuenta()).toMatchObject({ plan: 'pro', limites: PRO, pagoPendienteId: pagoId });
    expect(await auditoria('pago_manual_confirma_qr')).toHaveLength(0);

    const r = await registrarPagoManual.run({ data: confirmar, auth: PROPIETARIO, rawRequest: {} });
    expect(r).toMatchObject({ pagoId, confirmadoQr: true, periodoPagado: HOY, plan: 'crecimiento', modalidad: 'prepago' });

    // El pago: confirmado por el propietario, SIN la marca de revisión.
    const p = await pago(pagoId);
    expect(p).toMatchObject({ estado: 'confirmado', montoRecibidoBs: 630, confirmadoPor: { origen: 'propietario', uid: 'prop' } });
    expect(p?.['revision']).toBeUndefined();
    // La cuenta: el plan del QR con SU copia de límites, el mes sumado, sin pendiente ni corte.
    const c = await cuenta();
    expect(c).toMatchObject({ plan: 'crecimiento', limites: limitesDe('crecimiento'), periodoPagado: HOY, modalidad: 'prepago' });
    expect(c['pagoPendienteId']).toBeUndefined();
    expect(c['corte']).toBeUndefined();
    // El espejo de la ficha.
    expect((await db.doc(`tenants/${A}`).get()).get('plan')).toBe('crecimiento');
    // Los índices del cobrador, cerrados.
    expect(await pendiente(pagoId)).toBeUndefined();
    expect(await resuelto(pagoId)).toMatchObject({ tenantId: A, estado: 'confirmado' });
    // La auditoría, con el antes y el después como `cambiar_plan`.
    expect(await auditoria('pago_manual_confirma_qr')).toMatchObject([{
      pagoId, uid: 'prop', revision: 'plan_distinto', montoRecibidoBs: 630, motivoDiferencia: 'QR emitido antes del cambio a Pro',
      planAntes: 'pro', planDespues: 'crecimiento', limitesAntes: PRO, limitesDespues: limitesDe('crecimiento'),
    }]);

    // UN SEGUNDO AVISO DEL BANCO NO SUMA OTRO MES: ni por el aviso (el índice
    // ya está resuelto) ni por la consulta, que llega a la tabla y dice `ya`.
    expect((await aviso(pagoId)).cuerpo).toEqual({ recibido: true, aplicado: false, estado: 'confirmado' });
    expect(await consultarYAplicar(A, pagoId, { via: 'consulta' })).toEqual({ aplicado: false, estado: 'confirmado', ya: true });
    expect((await cuenta())['periodoPagado']).toBe(HOY);
    expect(await auditoria('pago_aplicado')).toHaveLength(0);

    // Y confirmarlo otra vez se rechaza: el pago ya no está pendiente.
    await rechaza(registrarPagoManual.run({ data: { ...confirmar, motivoDiferencia: 'otra vez' }, auth: PROPIETARIO, rawRequest: {} }), 'failed-precondition');
    expect((await cuenta())['periodoPagado']).toBe(HOY);
    expect(await auditoria('pago_manual_confirma_qr')).toHaveLength(1);
  });

  it('en revisión el QR no se muestra: imagenDePago da 404, la consulta no trae ficha y «cancelar» se niega sin llamar al cobrador', async () => {
    const { pagoId, ficha } = await pagoEnRevision();
    expect((await imagen(ficha)).codigo).toBe(404);
    const { consultarPagoPendiente, anularPagoPendiente } = await conCobrador();
    const consulta = await consultarPagoPendiente.run({ data: { tenantId: A }, auth: ADMIN_A, rawRequest: {} });
    expect(consulta['pendiente']).toMatchObject({ pagoId, estado: 'pendiente', cobroEstado: 'CONFIRMADO', fichaQr: null, qrRuta: null });

    const llamadasAntes = doble.llamadas.length;
    const d = await rechaza(anularPagoPendiente.run({ data: { tenantId: A }, auth: ADMIN_A, rawRequest: {} }), 'failed-precondition');
    expect(d).toMatchObject({ pagoId, cobroEstado: 'CONFIRMADO' });
    expect(doble.llamadas.length).toBe(llamadasAntes);
    expect(await pago(pagoId)).toMatchObject({ estado: 'pendiente', cobro: { estado: 'CONFIRMADO' } });
    expect(doble.cobroPorReferencia(pagoId)?.estado).toBe('CONFIRMADO');
    expect(await auditoria('anular_pago_pendiente')).toHaveLength(0);
  });

  it('un QR vivo SIN confirmar sí se sigue mostrando: el 404 es solo para el que el banco ya confirmó', async () => {
    const r = await crear(MENSUALIDAD);
    doble.fijarEstado(r['pagoId'] as string, 'PAGO_DETECTADO');
    await consultarYAplicar(A, r['pagoId'] as string, { via: 'consulta' });
    expect(await pago(r['pagoId'] as string)).toMatchObject({ estado: 'pendiente', cobro: { estado: 'PAGO_DETECTADO' } });
    expect((await imagen(r['fichaQr'] as string)).codigo).toBe(200);
  });

  it('LA FIRMA PIDE SESIÓN RECIENTE: el propietario con auth_time viejo (o sin él) no emite un QR de otro plan; no queda pago, pendiente ni llamada al cobrador', async () => {
    await db.doc(`tenants/${B}/cuenta/estado`).set({ plan: 'impulso', modalidad: 'prepago' });
    const OTRO_PLAN = { tenantId: B, tipo: 'mensualidad', plan: 'pro', meses: 1 };
    for (const sesion of [PROPIETARIO_SESION_VIEJA, PROPIETARIO_SIN_AUTH_TIME]) {
      await rechaza(crear(OTRO_PLAN, sesion), 'unauthenticated');
    }
    expect((await db.collection(`tenants/${B}/pagos`).get()).size).toBe(0);
    expect((await cuenta(B))['pagoPendienteId']).toBeUndefined();
    expect((await db.collection('cobrosPendientes').where('tenantId', '==', B).get()).size).toBe(0);
    expect(doble.llamadas).toEqual([]);
    expect(await auditoria('cobro_emitido', B)).toHaveLength(0);
    expect(await cuenta(B)).toMatchObject({ plan: 'impulso' });

    // Renovar EL MISMO plan no firma nada: no pide sesión reciente.
    expect(await crear({ tenantId: B, tipo: 'mensualidad', plan: 'impulso', meses: 1 }, PROPIETARIO_SESION_VIEJA)).toMatchObject({ estado: 'pendiente' });
    const [emitido] = (await db.collection(`tenants/${B}/pagos`).get()).docs;
    expect(emitido?.get('cambioAutorizadoPor')).toBeUndefined();
  });

  it('con sesión reciente la firma entra, como antes', async () => {
    await db.doc(`tenants/${B}/cuenta/estado`).set({ plan: 'impulso', modalidad: 'prepago' });
    const r = await crear({ tenantId: B, tipo: 'mensualidad', plan: 'pro', meses: 1 }, PROPIETARIO);
    expect((await pago(r['pagoId'] as string, B))?.['cambioAutorizadoPor']).toBe('prop');
  });
});

describe('2bis. Un pago del banco que cambia el plan queda trazable (LOW 1 de #212)', () => {
  const PRO = { conversaciones: 500, productos: 500, agendas: 10, cambiosIncluidos: 2 };

  it('pago_aplicado dice la copia antes y después y lo conservado por contrato, como cambiar_plan', async () => {
    // Pro con 4 cambios por contrato; paga una mensualidad de Crecimiento.
    await db.doc(`tenants/${A}/cuenta/estado`).set({
      plan: 'pro', modalidad: 'prepago', limites: { ...PRO, cambiosIncluidos: 4 }, limitesPorContrato: ['cambiosIncluidos'],
    });
    // El cambio de plan por QR lo pide el propietario (el comercio no puede).
    const pagoId = (await crear(MENSUALIDAD, PROPIETARIO))['pagoId'] as string;
    doble.fijarEstado(pagoId, 'CONFIRMADO');
    expect((await aviso(pagoId)).cuerpo).toMatchObject({ aplicado: true, estado: 'confirmado' });
    const c = await cuenta();
    expect(c).toMatchObject({ plan: 'crecimiento', limites: { conversaciones: 220, productos: 100, agendas: 5, cambiosIncluidos: 4 } });
    expect(await auditoria('pago_aplicado')).toMatchObject([{
      pagoId, plan: 'crecimiento',
      limitesAntes: { ...PRO, cambiosIncluidos: 4 },
      limitesDespues: { conversaciones: 220, productos: 100, agendas: 5, cambiosIncluidos: 4 },
      conservadosPorContrato: { cambiosIncluidos: 4 },
    }]);
  });

  it('un pago del mismo plan NO agrega nada de la copia a pago_aplicado', async () => {
    const pagoId = (await crear(MENSUALIDAD))['pagoId'] as string;
    doble.fijarEstado(pagoId, 'CONFIRMADO');
    await aviso(pagoId);
    const [a] = await auditoria('pago_aplicado');
    expect(a).toBeDefined();
    for (const k of ['limitesAntes', 'limitesDespues', 'conservadosPorContrato']) expect(a![k], k).toBeUndefined();
  });
});

// ===========================================================================
describe('3. El barrido horario', () => {
  it('sin aviso, confirma; los meses se suman sobre lo ya cubierto', async () => {
    await db.doc(`tenants/${A}/cuenta/estado`).set({ periodoPagado: HOY }, { merge: true });
    // El cambio de plan lo pide el propietario (desde el 26/09 el comercio no puede).
    const pagoId = (await crear({ tenantId: A, tipo: 'mensualidad', plan: 'pro', meses: 3 }, PROPIETARIO))['pagoId'] as string;
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

  it('sin pendientes no llama al cobrador', async () => {
    expect(await barrerCobrosPendientes(Date.now()))
      .toEqual({ revisados: 0, confirmados: 0, vencidos: 0, anulados: 0, sinCambio: 0, errores: 0 });
    expect(doble.llamadas).toHaveLength(0);
  });

  it('y ni siquiera lo RESUELVE: la salida temprana va antes (v0.7.0 fallaba cada hora)', () => {
    // Producción, 23/09: sin URL pública, resolver el cobrador lanza. El
    // barrido lo resolvía ANTES de mirar si había algo que revisar, y el
    // trabajo horario terminaba con error en cada corrida; el sondeo nunca
    // falló porque consulta primero. Se comprueba sobre la fuente porque
    // borrar la configuración compartida rompe las suites que corren en
    // paralelo contra el mismo emulador.
    const fuente = readFileSync(join(aqui, '../functions/src/cobroPrepago.ts'), 'utf8');
    const cuerpo = fuente.slice(fuente.indexOf('export async function barrerCobrosPendientes'));
    const salida = cuerpo.indexOf('if (lista.empty) return resumen;');
    const resolver = cuerpo.indexOf('await resolverCobrador(');
    expect(salida, 'falta la salida temprana del barrido').toBeGreaterThan(-1);
    expect(salida).toBeLessThan(resolver);
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
    // El pago de A quedó corrupto (un tipo que la puerta no conoce): aplicar lanza.
    await db.doc(`tenants/${A}/pagos/${a}`).set({ tipo: 'raro' }, { merge: true });
    doble.fijarEstado(a, 'CONFIRMADO');
    doble.fijarEstado(b, 'CONFIRMADO');
    const r = await barrerCobrosPendientes(Date.now());
    expect(r).toMatchObject({ revisados: 2, confirmados: 1, errores: 1 });
    expect(await pago(b, B)).toMatchObject({ estado: 'confirmado' });
    expect(await pago(a)).toMatchObject({ estado: 'pendiente' });
  });

  it('cobro emitido allá sin id acá (la respuesta se perdió): el barrido completa el índice y, con CONFIRMADO, acredita', async () => {
    const pagoId = (await crear(MENSUALIDAD))['pagoId'] as string;
    // Simular la pérdida: el índice y el pago quedaron como recién reservados.
    await db.doc(`cobrosPendientes/${pagoId}`).set({ cobroId: null, venceEn: null }, { merge: true });
    await db.doc(`tenants/${A}/pagos/${pagoId}`).set({ cobro: { id: null, estado: 'SIN_EMITIR' } }, { merge: true });
    expect(await barrerCobrosPendientes(Date.now())).toMatchObject({ sinCambio: 1 });
    expect(await pendiente(pagoId)).toMatchObject({ cobroId: idDeCobro('novuchat', pagoId) });
    expect((await pendiente(pagoId))?.['venceEn']).toBeInstanceOf(Timestamp);
    expect(await pago(pagoId)).toMatchObject({ estado: 'pendiente', cobro: { id: idDeCobro('novuchat', pagoId), estado: 'QR_ACTIVO' } });
    doble.fijarEstado(pagoId, 'CONFIRMADO');
    expect(await barrerCobrosPendientes(Date.now())).toMatchObject({ confirmados: 1 });
    expect(await pago(pagoId)).toMatchObject({ estado: 'confirmado' });
    expect((await cuenta())['periodoPagado']).toBe(HOY);
  });

  it('reserva sin emitir (404 del cobrador): el barrido la deja, y a los 4 días la anula', async () => {
    doble.noDisponible = true;
    await rechaza(crear(MENSUALIDAD), 'unavailable');
    doble.noDisponible = false;
    const id = (await cuenta())['pagoPendienteId'] as string;
    expect(doble.cobroPorReferencia(id)).toBeUndefined();
    expect(await barrerCobrosPendientes(Date.now())).toMatchObject({ sinCambio: 1, errores: 0 });
    expect(await pago(id)).toMatchObject({ estado: 'pendiente' });
    expect(await barrerCobrosPendientes(Date.now() + 5 * DIA)).toMatchObject({ anulados: 1, errores: 0 });
    expect(await pago(id)).toMatchObject({ estado: 'anulado', motivoAnulacion: 'reserva sin emitir' });
    expect((await cuenta())['pagoPendienteId']).toBeUndefined();
    expect(await pendiente(id)).toBeUndefined();
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
describe('3bis. El sondeo de cada 5 minutos', () => {
  const consultas = () => doble.llamadas.filter((l) => l.metodo === 'GET').length;

  it('sin pendientes, cero llamadas al cobrador', async () => {
    expect(await sondearCobrosPendientes(Date.now())).toEqual({ consultados: 0, confirmados: 0, cerrados: 0, sinCambio: 0, errores: 0 });
    expect(doble.llamadas).toHaveLength(0);
  });

  it('PAGO_DETECTADO nunca acredita; cuando pasa a CONFIRMADO, el sondeo acredita', async () => {
    const pagoId = (await crear(MENSUALIDAD))['pagoId'] as string;
    doble.fijarEstado(pagoId, 'PAGO_DETECTADO');
    for (let i = 0; i < 3; i++) {
      expect(await sondearCobrosPendientes(Date.now())).toMatchObject({ consultados: 1, confirmados: 0, sinCambio: 1 });
    }
    expect(await pago(pagoId)).toMatchObject({ estado: 'pendiente', cobro: { estado: 'PAGO_DETECTADO' } });
    expect(await pendiente(pagoId)).toMatchObject({ estado: 'PAGO_DETECTADO' });
    expect((await cuenta())['periodoPagado']).toBeUndefined();
    expect(await bitacora('pago_registrado')).toHaveLength(0);

    doble.fijarEstado(pagoId, 'CONFIRMADO');
    expect(await sondearCobrosPendientes(Date.now())).toMatchObject({ consultados: 1, confirmados: 1 });
    expect(await pago(pagoId)).toMatchObject({ estado: 'confirmado' });
    expect((await cuenta())['periodoPagado']).toBe(HOY);
    expect(await auditoria('pago_aplicado')).toMatchObject([{ via: 'sondeo' }]);
    expect(await pendiente(pagoId)).toBeUndefined();
    // Ya no hay nada vivo: la corrida siguiente no llama al cobrador.
    const antes = consultas();
    expect(await sondearCobrosPendientes(Date.now())).toMatchObject({ consultados: 0 });
    expect(consultas()).toBe(antes);
  });

  it('no consulta lo que es del barrido: vencido, sin emitir, BORRADOR, EN_REVISION ni importe menor', async () => {
    // Vencido según el reloj.
    const a = (await crear(MENSUALIDAD))['pagoId'] as string;
    // Sin emitir (el cobrador no respondió).
    doble.noDisponible = true;
    await rechaza(crear({ tenantId: B, tipo: 'instalacion' }, PROPIETARIO), 'unavailable');
    doble.noDisponible = false;
    const antes = consultas();
    expect(await sondearCobrosPendientes(Date.now() + 80 * 3_600_000)).toMatchObject({ consultados: 0 });
    expect(consultas()).toBe(antes);
    // EN_REVISION: el barrido lo anota en el índice y el sondeo deja de verlo.
    doble.fijarEstado(a, 'EN_REVISION');
    await barrerCobrosPendientes(Date.now());
    expect(await pendiente(a)).toMatchObject({ estado: 'EN_REVISION' });
    const despues = consultas();
    expect(await sondearCobrosPendientes(Date.now())).toMatchObject({ consultados: 0 });
    expect(consultas()).toBe(despues);
  });

  it('un CONFIRMADO con importe menor sale del sondeo (espera al propietario) y no vuelve a consultarse', async () => {
    const pagoId = (await crear(MENSUALIDAD))['pagoId'] as string;
    doble.fijarEstado(pagoId, 'CONFIRMADO', { montoCentavos: 60000 });
    expect(await sondearCobrosPendientes(Date.now())).toMatchObject({ consultados: 1, confirmados: 0 });
    expect(await pendiente(pagoId)).toMatchObject({ estado: 'CONFIRMADO' });
    expect(await pago(pagoId)).toMatchObject({ estado: 'pendiente', montoRecibidoBs: 600 });
    expect(await sondearCobrosPendientes(Date.now())).toMatchObject({ consultados: 0 });
  });

  it('un error en uno no frena a los demás, y el tope por corrida se respeta', async () => {
    const a = (await crear(MENSUALIDAD))['pagoId'] as string;
    const b = (await crear({ tenantId: B, tipo: 'instalacion' }, PROPIETARIO))['pagoId'] as string;
    doble.cobros.delete(idDeCobro('novuchat', a));          // 404 para A
    doble.fijarEstado(b, 'CONFIRMADO');
    expect(await sondearCobrosPendientes(Date.now())).toMatchObject({ consultados: 2, confirmados: 1, errores: 1 });
    expect(await pago(b, B)).toMatchObject({ estado: 'confirmado' });
    expect(await pago(a)).toMatchObject({ estado: 'pendiente' });
    expect(TOPE_SONDEO).toBe(100);
  });
});

// ===========================================================================
describe('4bis. La carga manual EXPORTADA (A-1 con el cobrador enchufado, pagosConCobrador.ts)', () => {
  it('con cobrador disponible anula allá el QR vivo antes de cargar el manual, y el manual entra', async () => {
    const indice = await import('../functions/src/pagosConCobrador.ts');
    const { randomBytes } = await import('node:crypto');
    const vivo = (await crear(MENSUALIDAD))['pagoId'] as string;
    const propietario = { uid: 'prop', token: { ...PROPIETARIO.token, auth_time: Math.floor(Date.now() / 1000) } };
    const manualId = randomBytes(16).toString('base64url');
    const r = await (indice.registrarPagoManual as unknown as { run: (x: unknown) => Promise<Record<string, unknown>> }).run({
      data: {
        pagoId: manualId, tenantId: A, tipo: 'mensualidad', plan: 'crecimiento', meses: 1,
        medio: 'efectivo', referencia: 'recibido por Andres',
        tcoAplicado: TCO, tcoFuente: 'BCB', tcoFecha: new Date(Date.now() - 4 * 3_600_000).toISOString().slice(0, 10),
        montoRecibidoBs: 630,
      },
      auth: propietario, rawRequest: {},
    });
    expect(r).toBeTruthy();
    expect(doble.cobroPorReferencia(vivo)?.estado).toBe('ANULADO');
    expect(await pago(vivo)).toMatchObject({ estado: 'anulado', motivoAnulacion: 'pago_manual' });
    expect(await pago(manualId)).toMatchObject({ estado: 'confirmado', medio: 'efectivo' });
    expect((await cuenta())['pagoPendienteId']).toBeUndefined();
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

  it('sin id guardado pregunta por la referencia y anula allá si el cobro existe', async () => {
    const id = (await crear(MENSUALIDAD))['pagoId'] as string;
    await db.doc(`tenants/${A}/pagos/${id}`).set({ cobro: { id: null, estado: 'SIN_EMITIR' } }, { merge: true });
    expect(await anularCobroVivo(A, id, 'pago_manual')).toEqual({ resultado: 'anulado' });
    expect(doble.cobroPorReferencia(id)?.estado).toBe('ANULADO');
    expect(await resuelto(id)).toMatchObject({ cobroId: idDeCobro('novuchat', id), estado: 'anulado' });
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
    const r = await crearCobroInterno(A, { tipo: 'mensualidad', plan: 'crecimiento', meses: 1 }, { uid: 'whatsapp', creadoPor: 'whatsapp:0001', canal: 'whatsapp' });
    expect(await pago(r.pagoId)).toMatchObject({ canal: 'whatsapp', creadoPor: 'whatsapp:0001', monto: Math.round(50 * TCO) });
    // Y por WhatsApp tampoco se cambia de plan.
    await rechaza(crearCobroInterno(B, { tipo: 'mensualidad', plan: 'pro', meses: 1 },
      { uid: 'whatsapp', creadoPor: 'whatsapp:0001', canal: 'whatsapp' }), 'permission-denied');
  });
});
