/**
 * =============================================================================
 * CAMPAÑA SALIENTE (PR-B, E1): `configuracionFlujo` devuelve `campanaSaliente { citada, primeraEnVentana, campanaId }`
 * =============================================================================
 *
 * `configuracionFlujo` REAL contra el emulador. Solo si el cuerpo trae `campana: { contextoId }`, la respuesta agrega
 * `campanaSaliente`, calculado con la misma función pura que usa la ingesta antes de escribir la baja (`hechosDeCampana`) y
 * con la conversación que el turno ya leyó (cero lecturas nuevas). Se sostiene, negando:
 *
 *  1. Sin la clave `campana`, la respuesta queda IGUAL, byte a byte (ni la clave `campanaSaliente`).
 *  2. NUNCA viaja el idMeta de la campaña enviada.
 *  3. `citada` solo con el `context.id` exacto de la última campaña vigente; `primeraEnVentana` solo mientras la persona no le
 *     respondió; pasadas las 24 h no hay campaña vigente.
 *  4. Lo ajeno no se mezcla: la campaña de otro teléfono o de otro comercio no se ve.
 *  5. Cero mensajes por conversación: la suite no envía nada.
 *
 * Puerto del emulador: 8231 por convención.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
// Alias de esta suite: 03 y 04. Valores de prueba, no secretos.
const TOKENES = { a: 'valor-de-prueba-campcfg-a', b: 'valor-de-prueba-campcfg-b' };
process.env['INGESTA_CLIENTE03'] = TOKENES.a;
process.env['INGESTA_CLIENTE04'] = TOKENES.b;

const { configuracionFlujo } = await import('../../functions/src/index.ts');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const db = getFirestore();

interface Comercio { id: string; numero: string; alias: string; token: string }
const A: Comercio = { id: 'campcfg-a', numero: '1000000951', alias: 'cliente03', token: TOKENES.a };
const B: Comercio = { id: 'campcfg-b', numero: '1000000952', alias: 'cliente04', token: TOKENES.b };
interface Respuesta { codigo: number; cuerpo: Record<string, unknown> }

async function configuracion(c: Comercio, cuerpo: Record<string, unknown>): Promise<Respuesta> {
  const cabeceras: Record<string, string> = {
    'x-novuchat-numero': c.numero, authorization: `Bearer ${c.token}`, 'content-type': 'application/json',
  };
  const leer = (n: string) => cabeceras[n.toLowerCase()];
  const peticion = { method: 'POST', body: cuerpo, rawBody: Buffer.from(JSON.stringify(cuerpo)), headers: cabeceras, get: leer, header: leer };
  const r: Respuesta = { codigo: 0, cuerpo: {} };
  const respuesta = {
    status(cod: number) { r.codigo = cod; return respuesta; },
    send(b: unknown) { r.cuerpo = { texto: b }; return respuesta; },
    json(b: unknown) { r.cuerpo = b as Record<string, unknown>; return respuesta; },
    setHeader() { return respuesta; }, getHeader() { return undefined; }, set() { return respuesta; },
    on() { return respuesta; }, end() { return respuesta; },
  };
  await (configuracionFlujo as unknown as (q: unknown, s: unknown) => Promise<void>)(peticion, respuesta);
  return r;
}

const TEL = '59100000001';
const TEL2 = '59100000002';
const CTX = 'wamid.CAMPANA-ENVIADA-CFG';
const CAMPANA = 'camp-cfg-01';
const HORA = 3_600_000;
const conv = (c: Comercio, tel = TEL) => db.doc(`tenants/${c.id}/conversaciones/wa_${tel}`);
const sembrar = (c: Comercio, haceMs: number, extra: Record<string, unknown> = {}, tel = TEL) => conv(c, tel).set({
  telefono: tel, ultimoMensaje: 'Hola', canal: 'whatsapp', ultimoEn: Timestamp.now(), mensajesTotal: 1,
  campanaEnviada: { idMeta: CTX, campanaId: CAMPANA, en: Timestamp.fromMillis(Date.now() - haceMs) }, ...extra,
});
const hechos = (r: Respuesta) => r.cuerpo['campanaSaliente'] as Record<string, unknown> | undefined;
const SIN_CAMPANA = { citada: false, primeraEnVentana: false, campanaId: null };

async function limpiar(c: Comercio) {
  for (const col of ['auditoria', 'bitacora', 'metricas']) {
    for (const d of (await db.collection(`tenants/${c.id}/${col}`).get()).docs) await d.ref.delete();
  }
  for (const d of (await db.collection(`tenants/${c.id}/conversaciones`).get()).docs) {
    for (const m of (await d.ref.collection('mensajes').get()).docs) await m.ref.delete();
    await d.ref.delete();
  }
}

beforeAll(async () => {
  for (const c of [A, B]) {
    await limpiar(c);
    await db.doc(`rutasWhatsApp/${c.numero}`).set({ tenantId: c.id, flujo: 'agendamiento', aliasSecreto: c.alias, estado: 'activo' });
    await db.doc(`tenants/${c.id}`).set({ nombre: `Comercio ${c.id}`, estado: 'activo', plan: 'pro' });
  }
}, 120_000);
afterAll(async () => { for (const c of [A, B]) { await limpiar(c); await db.doc(`rutasWhatsApp/${c.numero}`).delete(); } });
beforeEach(async () => { for (const c of [A, B]) { await limpiar(c); await db.doc(`tenants/${c.id}/cuenta/estado`).set({ plan: 'pro', estadoPago: 'al_dia' }); } });

describe('`campanaSaliente` solo con `campana` en el cuerpo', () => {
  it('con la cita exacta: citada, primera en la ventana y el id de la campaña', async () => {
    await sembrar(A, HORA);
    const r = await configuracion(A, { telefono: TEL, campana: { contextoId: CTX } });
    expect(r.codigo).toBe(200);
    expect(hechos(r)).toEqual({ citada: true, primeraEnVentana: true, campanaId: CAMPANA });
  });

  it('NIEGA: NUNCA viaja el idMeta, en ningún lugar de la respuesta', async () => {
    await sembrar(A, HORA);
    const r = await configuracion(A, { telefono: TEL, campana: { contextoId: CTX } });
    expect(JSON.stringify(r.cuerpo)).not.toContain(CTX);
  });

  it('NIEGA: sin la clave `campana` la respuesta es IGUAL byte a byte (y no trae `campanaSaliente`)', async () => {
    await sembrar(A, HORA);
    const sin = await configuracion(A, { telefono: TEL });
    const con = await configuracion(A, { telefono: TEL, campana: { contextoId: CTX } });
    expect(sin.cuerpo['campanaSaliente']).toBeUndefined();
    const { campanaSaliente: _c, ...resto } = con.cuerpo;
    expect(JSON.stringify(resto)).toBe(JSON.stringify(sin.cuerpo));
    // Un `campana` que no es un objeto también se ignora.
    for (const raro of ['x', 1, null, [CTX]]) {
      expect((await configuracion(A, { telefono: TEL, campana: raro })).cuerpo['campanaSaliente']).toBeUndefined();
    }
  });

  it('NIEGA: un context.id distinto, ausente o mal formado no es cita (la campaña vigente sí cuenta como primera respuesta)', async () => {
    await sembrar(A, HORA);
    for (const campana of [{ contextoId: 'wamid.OTRA' }, {}, { contextoId: 7 }, { contextoId: 'con espacio' }, { contextoId: CTX.toLowerCase() }]) {
      expect(hechos(await configuracion(A, { telefono: TEL, campana }))).toEqual({ citada: false, primeraEnVentana: true, campanaId: CAMPANA });
    }
  });

  it('`primeraEnVentana` deja de valer cuando la persona ya respondió a la campaña (campanaRespuesta posterior al envío)', async () => {
    await sembrar(A, HORA, { campanaRespuesta: { campanaId: CAMPANA, respuesta: 'si', en: Timestamp.fromMillis(Date.now() - 1000) } });
    expect(hechos(await configuracion(A, { telefono: TEL, campana: { contextoId: CTX } })))
      .toEqual({ citada: true, primeraEnVentana: false, campanaId: CAMPANA });
    // Una respuesta ANTERIOR al envío (de una campaña vieja) no cuenta.
    await sembrar(A, HORA, { campanaRespuesta: { campanaId: 'vieja-camp', respuesta: 'si', en: Timestamp.fromMillis(Date.now() - 5 * HORA) } });
    expect(hechos(await configuracion(A, { telefono: TEL, campana: { contextoId: CTX } })))
      .toEqual({ citada: true, primeraEnVentana: true, campanaId: CAMPANA });
  });

  it('NIEGA: pasadas las 24 h no hay campaña vigente: ni cita ni primera respuesta ni id', async () => {
    await sembrar(A, 25 * HORA);
    expect(hechos(await configuracion(A, { telefono: TEL, campana: { contextoId: CTX } }))).toEqual(SIN_CAMPANA);
  });

  it('sin conversación, o sin `telefono`, todo en falso (y la clave igual viaja)', async () => {
    expect(hechos(await configuracion(A, { telefono: TEL, campana: { contextoId: CTX } }))).toEqual(SIN_CAMPANA);
    expect(hechos(await configuracion(A, { campana: { contextoId: CTX } }))).toEqual(SIN_CAMPANA);
  });

  it('aislamiento: la campaña de OTRO teléfono y la del MISMO teléfono en otro comercio no se ven', async () => {
    await sembrar(A, HORA, {}, TEL2);
    await sembrar(B, HORA, {}, TEL);
    expect(hechos(await configuracion(A, { telefono: TEL, campana: { contextoId: CTX } }))).toEqual(SIN_CAMPANA);
    expect(hechos(await configuracion(B, { telefono: TEL, campana: { contextoId: CTX } }))).toMatchObject({ citada: true });
  });

  it('con el comercio suspendido sigue el 409 de siempre, sin `campanaSaliente`', async () => {
    await sembrar(A, HORA);
    await db.doc(`tenants/${A.id}`).update({ estado: 'suspendido' });
    try {
      const r = await configuracion(A, { telefono: TEL, campana: { contextoId: CTX } });
      expect(r.codigo).toBe(409);
      expect(r.cuerpo['campanaSaliente']).toBeUndefined();
    } finally { await db.doc(`tenants/${A.id}`).update({ estado: 'activo' }); }
  });
});
