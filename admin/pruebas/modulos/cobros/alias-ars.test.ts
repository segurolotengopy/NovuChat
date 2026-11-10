/**
 * Cobro por ALIAS en pesos argentinos (Casa Bermejo, B4b): `pedirAliasArs` y `cotejarAliasArs`, de punta a punta
 * contra el emulador, más la parte pura (`aliasArs.ts`).
 *
 * LO QUE SE NIEGA: con el interruptor apagado no se toca nada; un pedido de otro comercio no existe; un centavo
 * de diferencia en el monto no pasa; un alias casi igual no pasa; un segundo de vencido no pasa; un comprobante
 * no cobra dos veces ni a dos pedidos; el tercer inválido pasa a una persona; una clave de más es 400; ni el
 * alias ni nada leído de la imagen vuelve al cliente o se loguea; ninguna respuesta afirma un pago (prohibición 3).
 */
import { beforeAll, describe, expect, it } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
// Valores de prueba, no secretos.
const TOKEN = 'valor-de-prueba-del-alias-ars-a';
const TOKEN_B = 'valor-de-prueba-del-alias-ars-b';
process.env['INGESTA_CLIENTE12'] = TOKEN;
process.env['INGESTA_CLIENTE13'] = TOKEN_B;

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore, Timestamp, FieldValue } = await import('firebase-admin/firestore');
const db = getFirestore();
const { pedirAliasArs, cotejarAliasArs } = await import('../../../functions/src/modulos/cobros/cobroAliasArs.ts');
const A = await import('../../../functions/src/modulos/cobros/aliasArs.ts');

const T = 'alias-ars-casa';
const T2 = 'alias-ars-otro';
const NUMERO = '1000000071';
const NUMERO2 = '1000000072';
const ALIAS = 'casa.bermejo.mp';
const ALIAS2 = 'otro.comercio.mp';
const TEL = '5491100000000';
const AFIRMA_PAGO = /acreditad|verificad|recibimos|pago confirmado/i;
const MIN = 60_000;

interface Respuesta { codigo: number; cuerpo: any }

async function llamar(
  funcion: unknown, cuerpo: unknown, opciones: { token?: string | null; numero?: string; metodo?: string } = {},
): Promise<Respuesta> {
  const { token = TOKEN, numero = NUMERO, metodo = 'POST' } = opciones;
  const cabeceras: Record<string, string> = { 'x-novuchat-numero': numero, 'content-type': 'application/json' };
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
  await (funcion as (q: unknown, s: unknown) => Promise<void>)(peticion, respuesta);
  return r;
}

const pedir = (pedidoId: string, extra: Record<string, unknown> = {}, o = {}) =>
  llamar(pedirAliasArs, { v: 1, pedidoId, telefono: TEL, ...extra }, o);
const cotejar = (pedidoId: string, idMeta: string, leido: Record<string, unknown> | undefined, extra: Record<string, unknown> = {}, o = {}) =>
  llamar(cotejarAliasArs, { v: 1, pedidoId, telefono: TEL, idMeta, legible: true, ...(leido ? { leido } : {}), ...extra }, o);

function enArgentina(ms: number): { fecha: string; hora: string } {
  const d = new Date(ms - 3 * 3_600_000);
  const dos = (n: number) => String(n).padStart(2, '0');
  return { fecha: `${dos(d.getUTCDate())}/${dos(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`, hora: `${dos(d.getUTCHours())}:${dos(d.getUTCMinutes())}` };
}
let contadorOperacion = 0;
// Cada captura cae en un MINUTO distinto (la huella monto + alias + minuto es a propósito): los cobros de prueba se
// abren con `creadoEn` 100 min atrás (`antiguar`) para que haya sitio para ~95 minutos distintos.
const leidoBueno = (monto: string | number, extra: Record<string, unknown> = {}) => ({
  monto, alias: ALIAS, ...enArgentina(Date.now() - ((contadorOperacion + 1) % 95) * MIN), operacion: `OP${Date.now()}${++contadorOperacion}`, ...extra,
});

const antiguar = (pedidoId: string) =>
  db.doc(`tenants/${T}/cobrosAlias/${pedidoId}`).update({ creadoEn: Timestamp.fromMillis(Date.now() - 100 * MIN) });
const cobroDe = async (pedidoId: string, tenant = T) => (await db.doc(`tenants/${tenant}/cobrosAlias/${pedidoId}`).get()).data();
const pedidoPrueba = (centavos: number, extra: Record<string, unknown> = {}) => ({
  origen: 'whatsapp', conversacionId: `wa_${TEL}`, moneda: 'ARS', estado: 'recibido', creadoEn: Timestamp.now(),
  totalServidorCentavos: centavos, total: centavos / 100, ...extra,
});
const sembrarPedido = (id: string, centavos = 150_000, extra: Record<string, unknown> = {}, tenant = T) =>
  db.doc(`tenants/${tenant}/pedidos/${id}`).set(pedidoPrueba(centavos, extra));

async function limpiar(t: string) {
  for (const c of ['pedidos', 'cobrosAlias', 'comprobantesAlias', 'bitacora']) {
    for (const d of (await db.collection(`tenants/${t}/${c}`).get()).docs) await d.ref.delete();
  }
}

beforeAll(async () => {
  for (const [t, numero, alias, secreto] of [[T, NUMERO, ALIAS, 'cliente12'], [T2, NUMERO2, ALIAS2, 'cliente13']] as const) {
    await limpiar(t);
    await db.doc(`rutasWhatsApp/${numero}`).set({ tenantId: t, flujo: 'venta', aliasSecreto: secreto, estado: 'activo' });
    await db.doc(`tenants/${t}`).set({ nombre: 'Tienda', estado: 'activo', flujos: ['venta'], modulos: ['productos', 'cobros', 'inventario', 'pedidos'] });
    await db.doc(`tenants/${t}/config/cobros`).set({ aliasArActivo: true, aliasAr: alias });
  }
}, 120_000);

// =============================================================================
describe('parte pura', () => {
  const l = (o: Partial<import('../../../functions/src/modulos/cobros/aliasArs.ts').LeidoAlias> = {}) =>
    ({ monto: '1.500,00', alias: ALIAS, fecha: '09/11/2026', hora: '10:05', operacion: '', ...o });
  const t0 = Date.UTC(2026, 10, 9, 13, 0, 0);   // 10:00 en Argentina
  const cobro = { montoCentavos: 150_000, alias: ALIAS, creadoEnMs: t0 };
  const ahora = t0 + 10 * MIN;

  it('ok con el monto en formato argentino, el alias con otra caja y la hora de Argentina', () => {
    expect(A.calificarAlias(cobro, true, l({ alias: ' CASA.Bermejo.MP ' }), ahora)).toEqual({ codigo: 'ok', montoLeidoCentavos: null });
  });
  it('un centavo de menos o de más: monto_distinto con el monto leído', () => {
    expect(A.calificarAlias(cobro, true, l({ monto: '1.499,99' }), ahora)).toEqual({ codigo: 'monto_distinto', montoLeidoCentavos: 149_999 });
    expect(A.calificarAlias(cobro, true, l({ monto: '1500,01' }), ahora)).toEqual({ codigo: 'monto_distinto', montoLeidoCentavos: 150_001 });
  });
  it('un alias con una letra de diferencia no pasa (igualdad exacta)', () => {
    expect(A.calificarAlias(cobro, true, l({ alias: 'casa.bermejo.mq' }), ahora).codigo).toBe('alias_distinto');
    expect(A.calificarAlias(cobro, true, l({ alias: 'casa.bermejo' }), ahora).codigo).toBe('alias_distinto');
  });
  it('sin hora, sin fecha, sin monto, sin alias o no legible: ilegible', () => {
    expect(A.calificarAlias(cobro, true, l({ hora: '' }), ahora).codigo).toBe('ilegible');
    expect(A.calificarAlias(cobro, true, l({ fecha: '' }), ahora).codigo).toBe('ilegible');
    expect(A.calificarAlias(cobro, true, l({ monto: '' }), ahora).codigo).toBe('ilegible');
    expect(A.calificarAlias(cobro, true, l({ alias: '' }), ahora).codigo).toBe('ilegible');
    expect(A.calificarAlias(cobro, false, l(), ahora).codigo).toBe('ilegible');
  });
  it('fecha: anterior al cobro (con la gracia de relojes) es vencido; en el futuro es ilegible', () => {
    expect(A.calificarAlias(cobro, true, l({ hora: '09:54' }), ahora).codigo).toBe('vencido');
    expect(A.calificarAlias(cobro, true, l({ hora: '09:56' }), ahora).codigo).toBe('ok');
    expect(A.calificarAlias(cobro, true, l({ hora: '10:16' }), ahora).codigo).toBe('ilegible');
  });
  it('el interruptor: solo `true` y con un alias de forma válida abre; todo lo demás cierra', () => {
    expect(A.aliasDelTenant({ aliasArActivo: true, aliasAr: ALIAS })).toBe(ALIAS);
    for (const c of [undefined, {}, { aliasAr: ALIAS }, { aliasArActivo: false, aliasAr: ALIAS }, { aliasArActivo: 'true', aliasAr: ALIAS },
      { aliasArActivo: true }, { aliasArActivo: true, aliasAr: 'a b' }, { aliasArActivo: true, aliasAr: 'corto' }, { aliasArActivo: true, aliasAr: 5 }]) {
      expect(A.aliasDelTenant(c as Record<string, unknown> | undefined)).toBeNull();
    }
  });
  it('el pedido: ARS, de WhatsApp, recibido, entero, positivo, múltiplo de 100 y dentro del techo', () => {
    expect(A.pedidoCobrable(pedidoPrueba(150_000), Date.now())).toEqual({ ok: true, montoCentavos: 150_000 });
    for (const p of [undefined, pedidoPrueba(150_050), pedidoPrueba(0), pedidoPrueba(-100), pedidoPrueba(1500.5 * 100 + 0.5),
      pedidoPrueba(100_000_100), pedidoPrueba(150_000, { moneda: 'BOB' }), pedidoPrueba(150_000, { estado: 'cancelado' }),
      pedidoPrueba(150_000, { origen: 'catalogo-web' }), pedidoPrueba('150000' as unknown as number),
      pedidoPrueba(150_000, { creadoEn: Timestamp.fromMillis(Date.now() - 24 * 3_600_000 - 1000) }), pedidoPrueba(150_000, { creadoEn: undefined }),
      pedidoPrueba(150_000, { creadoEn: 'ayer' })]) {
      expect(A.pedidoCobrable(p, Date.now()).ok).toBe(false);
    }
  });
  it('un pedido de justo menos de 24 h todavía se cobra', () => {
    expect(A.pedidoCobrable(pedidoPrueba(150_000, { creadoEn: Timestamp.fromMillis(Date.now() - 23 * 3_600_000) }), Date.now()).ok).toBe(true);
  });
  it('las dos huellas: hOp con operación (≥4 caracteres normalizados) depende de operación, monto y alias; hMf, de monto, alias y minuto', () => {
    const a = A.huellasDeComprobante(l({ operacion: 'AB-12 34' }), 150_000);
    expect(a.hOp).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hMf).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hOp).toBe(A.huellasDeComprobante(l({ operacion: 'ab1234', alias: ' CASA.bermejo.MP ' }), 150_000).hOp);
    expect(a.hOp).not.toBe(A.huellasDeComprobante(l({ operacion: 'ab1234' }), 150_100).hOp);
    expect(a.hOp).not.toBe(A.huellasDeComprobante(l({ operacion: 'ab1235' }), 150_000).hOp);
    expect(a.hOp).not.toBe(a.hMf);
    // sin operación (o con una de menos de 4 caracteres): solo hMf, y es la MISMA que con operación
    const sin = A.huellasDeComprobante(l({ operacion: '' }), 150_000);
    expect(sin.hOp).toBeNull();
    expect(A.huellasDeComprobante(l({ operacion: 'a-1' }), 150_000).hOp).toBeNull();
    expect(sin.hMf).toBe(a.hMf);
    expect(a.hMf).not.toBe(A.huellasDeComprobante(l({ hora: '10:06' }), 150_000).hMf);
    expect(a.hMf).not.toBe(A.huellasDeComprobante(l(), 150_100).hMf);
    // sin instante no hay hMf
    expect(A.huellasDeComprobante(l({ hora: '' }), 150_000).hMf).toBeNull();
  });
  it('los cuerpos: una clave de más, la versión y los tipos', () => {
    expect(A.validarCuerpoPedir({ v: 1, pedidoId: 'wa_x1', telefono: TEL }).ok).toBe(true);
    const p = { v: 1, pedidoId: 'wa_x1', telefono: TEL };
    for (const c of [null, [], 'x', { v: 1 }, { ...p, v: 2 }, { ...p, pedidoId: 'x1' }, { ...p, pedidoId: 'wa_x/1' }, { v: 1, pedidoId: 'wa_x1' },
      { ...p, telefono: 'abc' }, { ...p, telefono: '123' }, { ...p, telefono: 5491100000000 },
      { ...p, tenantId: 'otro' }, { ...p, montoCentavos: 1 }]) {
      expect(A.validarCuerpoPedir(c).ok).toBe(false);
    }
    const base = { v: 1, pedidoId: 'wa_x1', telefono: TEL, idMeta: 'wamid.1', legible: true, leido: {} };
    expect(A.validarCuerpoCotejo(base).ok).toBe(true);
    for (const c of [{ ...base, extra: 1 }, { ...base, leido: { banco: 'x' } }, { ...base, leido: [] }, { ...base, legible: 'si' },
      { ...base, telefono: undefined }, { ...base, telefono: '12' }, { ...base, idMeta: '' }, { ...base, idMeta: 'a b' }, { ...base, tenantId: 'otro' }]) {
      expect(A.validarCuerpoCotejo(c).ok).toBe(false);
    }
  });
});

// =============================================================================
describe('autenticación, forma e interruptor', () => {
  it('sin token, 401; token ajeno, 401; otro método, 405', async () => {
    expect((await pedir('wa_a1', {}, { token: null })).codigo).toBe(401);
    expect((await pedir('wa_a1', {}, { token: 'otro-valor' })).codigo).toBe(401);
    expect((await pedir('wa_a1', {}, { metodo: 'GET' })).codigo).toBe(405);
    expect((await cotejar('wa_a1', 'w1', {}, {}, { token: null })).codigo).toBe(401);
    expect((await cotejar('wa_a1', 'w1', {}, {}, { metodo: 'PUT' })).codigo).toBe(405);
  });
  it('el token de un comercio no sirve con el número de otro', async () => {
    expect((await pedir('wa_a1', {}, { token: TOKEN_B })).codigo).toBe(401);
  });
  it('cuerpo con clave de más, versión o pedido inválidos: 400 y nada escrito', async () => {
    await sembrarPedido('wa_forma');
    expect((await pedir('wa_forma', { montoCentavos: 1 })).codigo).toBe(400);
    expect((await pedir('wa_forma', { tenantId: T2 })).codigo).toBe(400);
    expect((await llamar(pedirAliasArs, { v: 2, pedidoId: 'wa_forma' })).codigo).toBe(400);
    expect((await pedir('forma')).codigo).toBe(400);
    expect(await cobroDe('wa_forma')).toBeUndefined();
    await pedir('wa_forma');
    expect((await cotejar('wa_forma', 'w1', { monto: '1', banco: 'X' })).codigo).toBe(400);
    expect((await cotejar('wa_forma', 'w1', {}, { extra: true })).codigo).toBe(400);
    expect((await cotejar('wa_forma', 'w1', {}, { ruta: 'otra' })).codigo).toBe(400);
    expect((await cobroDe('wa_forma'))?.['comprobantes']).toEqual([]);
  });
  it('interruptor apagado (o ausente): los dos responden cerrado y no tocan nada', async () => {
    await sembrarPedido('wa_apagado');
    for (const config of [{ aliasArActivo: false, aliasAr: ALIAS }, { aliasAr: ALIAS }, null]) {
      if (config) await db.doc(`tenants/${T}/config/cobros`).set(config); else await db.doc(`tenants/${T}/config/cobros`).delete();
      const p = await pedir('wa_apagado');
      expect(p).toEqual({ codigo: 409, cuerpo: { error: 'cerrado' } });
      expect(await cotejar('wa_apagado', 'w1', leidoBueno(1500))).toEqual({ codigo: 409, cuerpo: { error: 'cerrado' } });
      // Cerrado ANTES de leer el cuerpo: ni con un cuerpo roto se distingue.
      expect((await pedir('wa_apagado', { sobra: 1 })).codigo).toBe(409);
    }
    expect(await cobroDe('wa_apagado')).toBeUndefined();
    expect((await db.collection(`tenants/${T}/comprobantesAlias`).get()).size).toBe(0);
    expect((await db.collection(`tenants/${T}/bitacora`).get()).size).toBe(0);
    await db.doc(`tenants/${T}/config/cobros`).set({ aliasArActivo: true, aliasAr: ALIAS });
  });
  it('un cobro abierto con el interruptor apagado después tampoco se coteja', async () => {
    await sembrarPedido('wa_apagado2');
    expect((await pedir('wa_apagado2')).codigo).toBe(200);
    await db.doc(`tenants/${T}/config/cobros`).set({ aliasArActivo: false, aliasAr: ALIAS });
    expect((await cotejar('wa_apagado2', 'w1', leidoBueno(1500))).codigo).toBe(409);
    expect((await cobroDe('wa_apagado2'))?.['estado']).toBe('abierto');
    await db.doc(`tenants/${T}/config/cobros`).set({ aliasArActivo: true, aliasAr: ALIAS });
  });
  it('sin el módulo cobros o pedidos, o con el comercio no activo: cerrado', async () => {
    await sembrarPedido('wa_modulo');
    await db.doc(`tenants/${T}`).update({ modulos: ['productos', 'pedidos'] });
    expect((await pedir('wa_modulo')).cuerpo).toEqual({ error: 'cerrado' });
    await db.doc(`tenants/${T}`).update({ modulos: ['productos', 'cobros', 'inventario', 'pedidos'], estado: 'suspendido' });
    expect((await pedir('wa_modulo')).cuerpo).toEqual({ error: 'cerrado' });
    await db.doc(`tenants/${T}`).update({ estado: 'activo' });
    expect(await cobroDe('wa_modulo')).toBeUndefined();
  });
  it('una ruta que no es de venta no entra', async () => {
    await db.doc(`rutasWhatsApp/${NUMERO}`).update({ flujo: 'agendamiento' });
    expect((await pedir('wa_forma')).cuerpo).toEqual({ estado: 'flujo_no_admitido' });
    await db.doc(`rutasWhatsApp/${NUMERO}`).update({ flujo: 'venta' });
  });
});

// =============================================================================
describe('pedirAliasArs', () => {
  it('abre el cobro: alias del DATO del tenant, monto en centavos, 30 minutos', async () => {
    await sembrarPedido('wa_p1', 150_000);
    const antes = Date.now();
    const r = await pedir('wa_p1');
    expect(r.codigo).toBe(200);
    expect(r.cuerpo).toMatchObject({ estado: 'abierto', alias: ALIAS, montoCentavos: 150_000, moneda: 'ARS', reutilizado: false });
    const vence = Date.parse(r.cuerpo.venceEn);
    expect(vence).toBeGreaterThanOrEqual(antes + 30 * MIN);
    expect(vence).toBeLessThanOrEqual(Date.now() + 30 * MIN);
    expect(await cobroDe('wa_p1')).toMatchObject({ estado: 'abierto', montoCentavos: 150_000, alias: ALIAS, intentosInvalidos: 0, comprobantes: [] });
    expect(JSON.stringify(r.cuerpo)).not.toMatch(AFIRMA_PAGO);
  });
  it('el alias sale del dato del tenant: otro comercio, otro alias', async () => {
    await sembrarPedido('wa_p1', 150_000, {}, T2);
    const r = await pedir('wa_p1', {}, { token: TOKEN_B, numero: NUMERO2 });
    expect(r.cuerpo.alias).toBe(ALIAS2);
  });
  it('idempotente por pedido: dos veces devuelve el mismo cobro, sin crear otro ni estirar la vigencia', async () => {
    const primero = (await cobroDe('wa_p1'))!;
    const r = await pedir('wa_p1');
    expect(r.cuerpo).toMatchObject({ estado: 'abierto', alias: ALIAS, montoCentavos: 150_000, reutilizado: true });
    expect(Date.parse(r.cuerpo.venceEn)).toBe((primero['venceEn'] as FirebaseFirestore.Timestamp).toMillis());
    expect((await db.collection(`tenants/${T}/cobrosAlias`).get()).docs.filter((d) => d.id === 'wa_p1')).toHaveLength(1);
    // Dos pedidos concurrentes del mismo pedido: un solo cobro.
    await sembrarPedido('wa_p2', 200_000);
    const [a, b] = await Promise.all([pedir('wa_p2'), pedir('wa_p2')]);
    expect(a.cuerpo.venceEn).toBe(b.cuerpo.venceEn);
    expect([a.cuerpo.reutilizado, b.cuerpo.reutilizado].sort()).toEqual([false, true]);
  });
  it('el alias que se dio al cliente no cambia si el comercio cambia el dato después', async () => {
    await db.doc(`tenants/${T}/config/cobros`).set({ aliasArActivo: true, aliasAr: 'otro.alias.nuevo' });
    expect((await pedir('wa_p1')).cuerpo.alias).toBe(ALIAS);
    await db.doc(`tenants/${T}/config/cobros`).set({ aliasArActivo: true, aliasAr: ALIAS });
  });
  it('tenant ajeno: el pedido de otro comercio no existe para esta llamada', async () => {
    await sembrarPedido('wa_solo_de_b', 100_000, {}, T2);
    const r = await pedir('wa_solo_de_b');
    expect(r).toEqual({ codigo: 409, cuerpo: { error: 'sin_pedido' } });
    expect(await cobroDe('wa_solo_de_b')).toBeUndefined();
    expect(await cobroDe('wa_solo_de_b', T2)).toBeUndefined();
  });
  it('pedido que no se puede cobrar: sin crearlo, inexistente, en otra moneda, no múltiplo de 100, cancelado', async () => {
    expect((await pedir('wa_no_existe')).cuerpo).toEqual({ error: 'sin_pedido' });
    await sembrarPedido('wa_bob', 150_000, { moneda: 'BOB' });
    await sembrarPedido('wa_cent', 150_050);
    await sembrarPedido('wa_canc', 150_000, { estado: 'cancelado' });
    await sembrarPedido('wa_web', 150_000, { origen: 'catalogo-web' });
    for (const id of ['wa_bob', 'wa_cent', 'wa_canc', 'wa_web']) {
      expect((await pedir(id)).cuerpo).toEqual({ error: 'pedido_no_cobrable' });
      expect(await cobroDe(id)).toBeUndefined();
    }
  });
  it('un cobro vencido no se reabre: contesta vencido, sin alias, y no extiende nada', async () => {
    await sembrarPedido('wa_p3');
    await pedir('wa_p3');
    await db.doc(`tenants/${T}/cobrosAlias/wa_p3`).update({ venceEn: Timestamp.fromMillis(Date.now() - 1000) });
    const r = await pedir('wa_p3');
    expect(r.cuerpo).toMatchObject({ estado: 'vencido', montoCentavos: 150_000 });
    expect(r.cuerpo.alias).toBeUndefined();
    expect((await cobroDe('wa_p3'))?.['estado']).toBe('vencido');
  });
});

// =============================================================================
describe('cotejarAliasArs', () => {
  async function abrir(id: string, centavos = 150_000): Promise<void> {
    await sembrarPedido(id, centavos);
    expect((await pedir(id)).codigo).toBe(200);
    await antiguar(id);
  }

  it('sin cobro abierto para ese pedido: 409 sin_cobro', async () => {
    await sembrarPedido('wa_c0');
    expect(await cotejar('wa_c0', 'w1', leidoBueno(1500))).toEqual({ codigo: 409, cuerpo: { error: 'sin_cobro' } });
  });
  it('coincide: ok, sin nada leído en la respuesta, cobro en `coincide` y su huella registrada', async () => {
    await abrir('wa_c1');
    const leido = leidoBueno('1.500,00');
    const r = await cotejar('wa_c1', 'wamid.c1', leido);
    expect(r).toEqual({ codigo: 200, cuerpo: { codigo: 'ok', intentosRestantes: 3, reintento: false } });
    expect(JSON.stringify(r.cuerpo)).not.toMatch(AFIRMA_PAGO);
    const c = await cobroDe('wa_c1');
    expect(c).toMatchObject({ estado: 'coincide', intentosInvalidos: 0 });
    expect(c?.['comprobantes']).toEqual([{ idMeta: 'wamid.c1', codigo: 'ok', montoLeidoCentavos: null }]);
    const huellas = (await db.collection(`tenants/${T}/comprobantesAlias`).get()).docs.filter((d) => d.get('pedidoId') === 'wa_c1');
    // Las DOS huellas (con operación y sin ella), cada una un documento.
    const esperadas = A.huellasDeComprobante(leido as never, 150_000);
    expect(huellas.map((d) => d.id).sort()).toEqual([esperadas.hOp, esperadas.hMf].sort());
    // En la base no queda el alias leído ni el número de operación.
    expect(JSON.stringify([...huellas.map((d) => d.data()), c])).not.toContain(leido.operacion);
  });
  it('un reintento del mismo mensaje (mismo idMeta) repite la respuesta y no cuenta ni escribe', async () => {
    const r = await cotejar('wa_c1', 'wamid.c1', leidoBueno('1.500,00'));
    expect(r.cuerpo).toEqual({ codigo: 'ok', intentosRestantes: 3, reintento: true });
    expect((await cobroDe('wa_c1'))?.['comprobantes']).toHaveLength(1);
  });
  it('un segundo comprobante sobre un cobro que ya coincide: repetido, sin contar', async () => {
    const r = await cotejar('wa_c1', 'wamid.c1-otro', leidoBueno('1.500,00'));
    expect(r.cuerpo).toMatchObject({ codigo: 'repetido', reintento: false });
    expect(await cobroDe('wa_c1')).toMatchObject({ estado: 'coincide', intentosInvalidos: 0 });
  });
  it('monto distinto en UN centavo (menos o más): monto_distinto con el monto leído, y es lo único leído que vuelve', async () => {
    await abrir('wa_c2');
    const menos = await cotejar('wa_c2', 'w-menos', leidoBueno('1499,99'));
    expect(menos.cuerpo).toEqual({ codigo: 'monto_distinto', montoLeidoCentavos: 149_999, intentosRestantes: 2, reintento: false });
    const mas = await cotejar('wa_c2', 'w-mas', leidoBueno('1500,01'));
    expect(mas.cuerpo).toEqual({ codigo: 'monto_distinto', montoLeidoCentavos: 150_001, intentosRestantes: 1, reintento: false });
    expect(await cobroDe('wa_c2')).toMatchObject({ estado: 'abierto', intentosInvalidos: 2 });
    expect((await db.collection(`tenants/${T}/comprobantesAlias`).get()).docs.some((d) => d.get('pedidoId') === 'wa_c2')).toBe(false);
  });
  it('alias distinto (aunque el monto cuadre): alias_distinto, sin monto leído ni alias en la respuesta', async () => {
    await abrir('wa_c3');
    const r = await cotejar('wa_c3', 'w1', leidoBueno(1500, { alias: 'otra.persona.mp' }));
    expect(r.cuerpo).toEqual({ codigo: 'alias_distinto', intentosRestantes: 2, reintento: false });
    expect(JSON.stringify(r.cuerpo)).not.toContain('otra.persona');
    // El alias de OTRO comercio tampoco vale.
    const r2 = await cotejar('wa_c3', 'w2', leidoBueno(1500, { alias: ALIAS2 }));
    expect(r2.cuerpo.codigo).toBe('alias_distinto');
  });
  it('ilegible: no legible, o sin monto, fecha, hora o alias', async () => {
    await abrir('wa_c4');
    expect((await cotejar('wa_c4', 'w1', undefined, { legible: false })).cuerpo.codigo).toBe('ilegible');
    expect((await cotejar('wa_c4', 'w2', leidoBueno(1500, { hora: '' }))).cuerpo.codigo).toBe('ilegible');
    expect((await cobroDe('wa_c4'))?.['intentosInvalidos']).toBe(2);
  });
  it('fecha anterior al cobro: vencido, y cuenta como inválido', async () => {
    await abrir('wa_c5');
    const vieja = enArgentina(Date.now() - 2 * 3_600_000);
    const r = await cotejar('wa_c5', 'w1', leidoBueno(1500, vieja));
    expect(r.cuerpo).toEqual({ codigo: 'vencido', intentosRestantes: 2, reintento: false });
    expect((await cobroDe('wa_c5'))?.['intentosInvalidos']).toBe(1);
  });
  it('plazo vencido por 1 segundo: se califica igual; lo que habría sido ok pasa a una persona, lo demás es vencido (sin contar)', async () => {
    await abrir('wa_c6');
    await db.doc(`tenants/${T}/cobrosAlias/wa_c6`).update({ venceEn: Timestamp.fromMillis(Date.now() - 1000) });
    const mal = await cotejar('wa_c6', 'w0', leidoBueno(1400));
    expect(mal.cuerpo).toMatchObject({ codigo: 'vencido', intentosRestantes: 3 });
    expect(await cobroDe('wa_c6')).toMatchObject({ estado: 'vencido', intentosInvalidos: 0 });
    const bien = await cotejar('wa_c6', 'w1', leidoBueno(1500));
    expect(bien.cuerpo).toMatchObject({ codigo: 'en_revision', intentosRestantes: 3 });
    expect(await cobroDe('wa_c6')).toMatchObject({ estado: 'en_revision', intentosInvalidos: 0 });
    // Nada se cobró: no hay huella de ese comprobante.
    expect((await db.collection(`tenants/${T}/comprobantesAlias`).get()).docs.some((d) => d.get('pedidoId') === 'wa_c6')).toBe(false);
    // El reintento del mismo mensaje repite.
    expect((await cotejar('wa_c6', 'w1', leidoBueno(1500))).cuerpo).toMatchObject({ codigo: 'en_revision', reintento: true });
    // Un segundo antes del plazo todavía vale.
    await abrir('wa_c6b');
    await db.doc(`tenants/${T}/cobrosAlias/wa_c6b`).update({ venceEn: Timestamp.fromMillis(Date.now() + 20_000) });
    expect((await cotejar('wa_c6b', 'w1', leidoBueno(1500))).cuerpo.codigo).toBe('ok');
  });
  it('plazo vencido y cobro ya marcado vencido (por pedir): el comprobante que cuadra también va a una persona', async () => {
    await abrir('wa_c6c');
    await db.doc(`tenants/${T}/cobrosAlias/wa_c6c`).update({ venceEn: Timestamp.fromMillis(Date.now() - 1000) });
    expect((await pedir('wa_c6c')).cuerpo.estado).toBe('vencido');
    expect((await cotejar('wa_c6c', 'w1', leidoBueno(1500))).cuerpo.codigo).toBe('en_revision');
  });
  it('el MISMO comprobante a DOS pedidos: el segundo es repetido (y cuenta como inválido), el primero conserva su cobro', async () => {
    await abrir('wa_c7a');
    await abrir('wa_c7b');
    const leido = leidoBueno(1500);
    expect((await cotejar('wa_c7a', 'w-a', leido)).cuerpo.codigo).toBe('ok');
    const r = await cotejar('wa_c7b', 'w-b', leido);
    expect(r.cuerpo).toEqual({ codigo: 'repetido', intentosRestantes: 2, reintento: false });
    expect(await cobroDe('wa_c7a')).toMatchObject({ estado: 'coincide' });
    expect(await cobroDe('wa_c7b')).toMatchObject({ estado: 'abierto', intentosInvalidos: 1 });
    // Con otro idMeta (la imagen reenviada) y otro formato del número, es el mismo comprobante.
    const r2 = await cotejar('wa_c7b', 'w-b2', { ...leido, operacion: leido.operacion.toLowerCase() });
    expect(r2.cuerpo.codigo).toBe('repetido');
  });
  it('sin número de operación, el mismo comprobante (monto, alias y minuto) tampoco cobra dos veces', async () => {
    await abrir('wa_c8a');
    await abrir('wa_c8b');
    const leido = leidoBueno(1500, { operacion: '' });
    expect((await cotejar('wa_c8a', 'w-a', leido)).cuerpo.codigo).toBe('ok');
    expect((await cotejar('wa_c8b', 'w-b', leido)).cuerpo.codigo).toBe('repetido');
  });
  it('tres inválidos pasan a una persona: el tercero responde en_revision y el cobro ya no cobra', async () => {
    await abrir('wa_c9');
    expect((await cotejar('wa_c9', 'w1', leidoBueno(1400))).cuerpo.codigo).toBe('monto_distinto');
    expect((await cotejar('wa_c9', 'w2', leidoBueno(1500, { alias: 'x.y.z.mp' }))).cuerpo.codigo).toBe('alias_distinto');
    const tercero = await cotejar('wa_c9', 'w3', leidoBueno(1300));
    expect(tercero.cuerpo).toEqual({ codigo: 'en_revision', intentosRestantes: 0, reintento: false });
    expect(await cobroDe('wa_c9')).toMatchObject({ estado: 'en_revision', intentosInvalidos: 3 });
    // Ni el comprobante perfecto lo cobra: lo mira una persona. Y no suma intentos.
    const bueno = await cotejar('wa_c9', 'w4', leidoBueno(1500));
    expect(bueno.cuerpo).toMatchObject({ codigo: 'en_revision' });
    expect(await cobroDe('wa_c9')).toMatchObject({ estado: 'en_revision', intentosInvalidos: 3 });
    // El reintento del tercero repite lo que se contestó.
    expect((await cotejar('wa_c9', 'w3', leidoBueno(1300))).cuerpo).toEqual({ codigo: 'en_revision', intentosRestantes: 0, reintento: true });
    // Y pedir el alias de nuevo no lo reabre.
    expect((await pedir('wa_c9')).cuerpo).toMatchObject({ estado: 'en_revision' });
    expect((await pedir('wa_c9')).cuerpo.alias).toBeUndefined();
  });
  it('tenant ajeno: el cobro de otro comercio no se coteja con la credencial de este', async () => {
    await sembrarPedido('wa_solo_t2', 100_000, {}, T2);
    await pedir('wa_solo_t2', {}, { token: TOKEN_B, numero: NUMERO2 });
    const r = await cotejar('wa_solo_t2', 'w1', leidoBueno(1000, { alias: ALIAS2 }));
    expect(r.codigo).toBe(409);
    expect(r.cuerpo).toEqual({ error: 'sin_cobro' });
    expect(await cobroDe('wa_solo_t2', T2)).toMatchObject({ estado: 'abierto', intentosInvalidos: 0 });
  });
  it('el tenant sale de la credencial y no del cuerpo: un `tenantId` en el cuerpo es 400', async () => {
    expect((await cotejar('wa_c1', 'w1', {}, { tenantId: T2 })).codigo).toBe(400);
  });
  it('la bitácora lleva solo el código: ni alias, ni pedido, ni teléfono, ni nada leído', async () => {
    const docs = (await db.collection(`tenants/${T}/bitacora`).get()).docs.map((d) => d.data());
    expect(docs.length).toBeGreaterThan(0);
    for (const d of docs) {
      expect(d['tipo']).toBe('cobro_cotejado');
      const s = JSON.stringify(d);
      for (const prohibido of [ALIAS, 'casa.bermejo', 'wa_c', 'OP17', 'destinoEnmascarado', 'conversacionId']) expect(s).not.toContain(prohibido);
    }
  });
  it('ninguna respuesta de este archivo afirma un pago', () => {
    // Los códigos fijos son los únicos textos que salen de los endpoints.
    for (const c of A.CODIGOS_ALIAS) expect(c).not.toMatch(AFIRMA_PAGO);
    expect([...A.CODIGOS_ALIAS].sort()).toEqual(['alias_distinto', 'en_revision', 'ilegible', 'monto_distinto', 'ok', 'repetido', 'vencido']);
  });
});

// =============================================================================
describe('segunda tanda: huellas, pedido vivo, dueño del pedido, antigüedad', () => {
  async function abrir(id: string, centavos = 150_000, extra: Record<string, unknown> = {}): Promise<void> {
    await sembrarPedido(id, centavos, extra);
    expect((await pedir(id)).codigo).toBe(200);
    await antiguar(id);
  }

  it('la misma captura CON número de operación en un pedido y SIN él en otro del mismo monto: el segundo es repetido', async () => {
    await abrir('wa_h1a'); await abrir('wa_h1b');
    const captura = leidoBueno(1500);
    expect((await cotejar('wa_h1a', 'h-a', captura)).cuerpo.codigo).toBe('ok');
    expect((await cotejar('wa_h1b', 'h-b', { ...captura, operacion: '' })).cuerpo.codigo).toBe('repetido');
    expect(await cobroDe('wa_h1b')).toMatchObject({ estado: 'abierto', intentosInvalidos: 1 });
  });
  it('al revés: primero SIN número de operación, después CON él: repetido (se registran las dos huellas siempre que se pueda)', async () => {
    await abrir('wa_h2a'); await abrir('wa_h2b');
    const captura = leidoBueno(1500);
    expect((await cotejar('wa_h2a', 'h-a', { ...captura, operacion: '' })).cuerpo.codigo).toBe('ok');
    expect((await cotejar('wa_h2b', 'h-b', captura)).cuerpo.codigo).toBe('repetido');
  });
  it('con número de operación distinto pero misma captura (monto, alias y minuto): repetido por hMf', async () => {
    await abrir('wa_h3a'); await abrir('wa_h3b');
    const captura = leidoBueno(1500);
    expect((await cotejar('wa_h3a', 'h-a', captura)).cuerpo.codigo).toBe('ok');
    expect((await cotejar('wa_h3b', 'h-b', { ...captura, operacion: 'OTRO-NUMERO-999' })).cuerpo.codigo).toBe('repetido');
  });
  it('carrera: dos pedidos con la misma huella a la vez: uno ok, el otro repetido (nunca un 500 ni dos ok)', async () => {
    await abrir('wa_h4a'); await abrir('wa_h4b');
    const captura = leidoBueno(1500);
    const [a, b] = await Promise.all([cotejar('wa_h4a', 'h-a', captura), cotejar('wa_h4b', 'h-b', captura)]);
    expect([a.codigo, b.codigo]).toEqual([200, 200]);
    expect([a.cuerpo.codigo, b.cuerpo.codigo].sort()).toEqual(['ok', 'repetido']);
    const coinciden = [await cobroDe('wa_h4a'), await cobroDe('wa_h4b')].filter((c) => c?.['estado'] === 'coincide');
    expect(coinciden).toHaveLength(1);
  });
  it('carrera sin número de operación en uno y con él en el otro: tampoco cobra dos veces', async () => {
    await abrir('wa_h5a'); await abrir('wa_h5b');
    const captura = leidoBueno(1500);
    const [a, b] = await Promise.all([cotejar('wa_h5a', 'h-a', { ...captura, operacion: '' }), cotejar('wa_h5b', 'h-b', captura)]);
    expect([a.cuerpo.codigo, b.cuerpo.codigo].sort()).toEqual(['ok', 'repetido']);
  });

  it('el pedido se relee dentro del cotejo: si ya no está recibido, vencido sin contar como inválido', async () => {
    await abrir('wa_v1');
    await db.doc(`tenants/${T}/pedidos/wa_v1`).update({ estado: 'cancelado' });
    const r = await cotejar('wa_v1', 'w1', leidoBueno(1500));
    expect(r.cuerpo).toMatchObject({ codigo: 'vencido', intentosRestantes: 3 });
    expect(await cobroDe('wa_v1')).toMatchObject({ estado: 'vencido', intentosInvalidos: 0 });
    expect((await cotejar('wa_v1', 'w2', leidoBueno(1500))).cuerpo.codigo).toBe('vencido');
    expect((await db.collection(`tenants/${T}/comprobantesAlias`).get()).docs.some((d) => d.get('pedidoId') === 'wa_v1')).toBe(false);
  });
  it('si el total del pedido cambió después de abrir el cobro: vencido, aunque el comprobante cuadre con el monto viejo', async () => {
    await abrir('wa_v2');
    await db.doc(`tenants/${T}/pedidos/wa_v2`).update({ totalServidorCentavos: 160_000 });
    expect((await cotejar('wa_v2', 'w1', leidoBueno(1500))).cuerpo).toMatchObject({ codigo: 'vencido' });
    expect((await cobroDe('wa_v2'))?.['intentosInvalidos']).toBe(0);
  });
  it('pedir otra vez con el pedido cambiado: vencido, sin alias', async () => {
    await abrir('wa_v3');
    await db.doc(`tenants/${T}/pedidos/wa_v3`).update({ estado: 'reemplazado' });
    const r = await pedir('wa_v3');
    expect(r.cuerpo).toMatchObject({ estado: 'vencido' });
    expect(r.cuerpo.alias).toBeUndefined();
    expect((await cobroDe('wa_v3'))?.['estado']).toBe('vencido');
  });
  it('un pedido cambiado no revive con el plazo vigente: el comprobante perfecto sigue siendo vencido, no en_revision', async () => {
    await abrir('wa_v4');
    await db.doc(`tenants/${T}/pedidos/wa_v4`).update({ estado: 'cancelado' });
    await pedir('wa_v4');
    expect((await cotejar('wa_v4', 'w1', leidoBueno(1500))).cuerpo.codigo).toBe('vencido');
  });

  it('teléfono: obligatorio (400) y con la forma de un número', async () => {
    await abrir('wa_t0');
    expect((await llamar(pedirAliasArs, { v: 1, pedidoId: 'wa_t0' })).codigo).toBe(400);
    expect((await pedir('wa_t0', { telefono: 'abc' })).codigo).toBe(400);
    expect((await llamar(cotejarAliasArs, { v: 1, pedidoId: 'wa_t0', idMeta: 'w1', legible: true })).codigo).toBe(400);
  });
  it('el pedido es de otra conversación: sin_pedido, igual que un pedido ajeno, en pedir y en cotejar, con cobro nuevo o abierto', async () => {
    await sembrarPedido('wa_t1');
    const otro = ['54911', '99999999'].join('');
    expect(await pedir('wa_t1', { telefono: otro })).toEqual({ codigo: 409, cuerpo: { error: 'sin_pedido' } });
    expect(await cobroDe('wa_t1')).toBeUndefined();
    expect((await pedir('wa_t1')).codigo).toBe(200);
    expect(await pedir('wa_t1', { telefono: otro })).toEqual({ codigo: 409, cuerpo: { error: 'sin_pedido' } });
    expect(await cotejar('wa_t1', 'w1', leidoBueno(1500), { telefono: otro })).toEqual({ codigo: 409, cuerpo: { error: 'sin_pedido' } });
    expect(await cobroDe('wa_t1')).toMatchObject({ estado: 'abierto', intentosInvalidos: 0, comprobantes: [] });
    // y es la misma respuesta que un pedido que no existe
    expect((await pedir('wa_t_no_existe', { telefono: otro })).cuerpo).toEqual({ error: 'sin_pedido' });
  });
  it('el cobro guarda el teléfono enmascarado, nunca el completo', async () => {
    const c = await cobroDe('wa_t1');
    expect(c?.['telefonoEnmascarado']).toBe('5491****999'.replace('999', TEL.slice(-3)));
    expect(JSON.stringify(c)).not.toContain(TEL);
    await cotejar('wa_t1', 'w9', leidoBueno(1500));
    expect(JSON.stringify(await cobroDe('wa_t1'))).not.toContain(TEL);
    for (const d of (await db.collection(`tenants/${T}/comprobantesAlias`).get()).docs) expect(JSON.stringify(d.data())).not.toContain(TEL);
    for (const d of (await db.collection(`tenants/${T}/bitacora`).get()).docs) expect(JSON.stringify(d.data())).not.toContain(TEL);
  });
  it('claves extra siguen dando 400 aun con teléfono', async () => {
    expect((await pedir('wa_t1', { extra: 1 })).codigo).toBe(400);
    expect((await cotejar('wa_t1', 'w1', {}, { extra: 1 })).codigo).toBe(400);
  });

  it('un pedido de más de 24 h no abre cobro; uno sin creadoEn tampoco', async () => {
    await sembrarPedido('wa_o1', 150_000, { creadoEn: Timestamp.fromMillis(Date.now() - 24 * 3_600_000 - 1000) });
    expect((await pedir('wa_o1')).cuerpo).toEqual({ error: 'pedido_no_cobrable' });
    await sembrarPedido('wa_o2');
    await db.doc(`tenants/${T}/pedidos/wa_o2`).update({ creadoEn: FieldValue.delete() });
    expect((await pedir('wa_o2')).cuerpo).toEqual({ error: 'pedido_no_cobrable' });
    expect(await cobroDe('wa_o1')).toBeUndefined();
    expect(await cobroDe('wa_o2')).toBeUndefined();
  });
  it('si el cobro vencido o en revisión ya no existe (TTL), la regla de las 24 h impide abrir otro del mismo pedido', async () => {
    await abrir('wa_o3');
    await db.doc(`tenants/${T}/cobrosAlias/wa_o3`).delete();
    // El pedido envejece más allá de las 24 h: no se reabre.
    await db.doc(`tenants/${T}/pedidos/wa_o3`).update({ creadoEn: Timestamp.fromMillis(Date.now() - 25 * 3_600_000) });
    expect((await pedir('wa_o3')).cuerpo).toEqual({ error: 'pedido_no_cobrable' });
    expect(await cobroDe('wa_o3')).toBeUndefined();
  });
});
