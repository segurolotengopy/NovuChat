/**
 * Fase 2 de «Comprobantes recibidos»: `cotejarComprobanteVenta` escribe
 * `tenants/{t}/comprobantesRecibidos/{nombreDeObjeto(idMeta)}` EN LA MISMA TRANSACCIÓN del cotejo.
 * Contra el emulador y ESCRITO NEGANDO: un fallo de la escritura nueva aborta todo (ni la
 * conversación, ni el cierre, ni las métricas quedan escritos), el repetido no escribe, el séptimo
 * comprobante también se registra, el documento no lleva el teléfono ni lo leído de la imagen, y la
 * respuesta del cotejo no cambia.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
const TOKEN = 'valor-de-prueba-de-recibidos-fase-2';
process.env['INGESTA_CLIENTE14'] = TOKEN;

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const db = getFirestore();
const { cotejarComprobanteVenta, documentoDeRecibido } = await import('../../../functions/src/modulos/cobros/cotejoVenta.ts');
const { solicitudDeCobroTras, MAX_COMPROBANTES } = await import('../../../functions/src/modulos/cobros/cobroVenta.ts');
const { nombreDeObjeto, rutaDeComprobante } = await import('../../../functions/src/modulos/cobros/comprobantes.ts');

const T = 'recibidos-f2-tienda';
const OTRO = 'recibidos-f2-otra';
const NUMERO = '1000000014';
const MES = new Date().toISOString().slice(0, 7);
const MIN = 60_000;
const DIA = 86_400_000;
const CUENTA = '1000000890';
const TITULAR = 'Juan Carlos Pérez Gómez';
// Teléfonos armados en ejecución: el saneo del repo público no admite 10+ dígitos seguidos.
const tel = (n: number) => ['5917', '2000', String(n).padStart(3, '0')].join('');

interface Respuesta { codigo: number; cuerpo: any }
async function llamar(cuerpo: Record<string, unknown>): Promise<Respuesta> {
  const cabeceras: Record<string, string> = {
    'x-novuchat-numero': NUMERO, 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`,
  };
  const leer = (n: string) => cabeceras[n.toLowerCase()];
  const peticion = { method: 'POST', body: cuerpo, rawBody: Buffer.from(JSON.stringify(cuerpo)), headers: cabeceras, get: leer, header: leer };
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
  monto, cuentaDestino: CUENTA, nombreCuenta: 'PEREZ GOMEZ JUAN CARLOS', banco: 'BNB-SECRETO-LEIDO', ...enLaPaz(Date.now()), ...extra,
});
const comp = (t: string, leido: Record<string, unknown>, idMeta: string, extra: Record<string, unknown> = {}) =>
  llamar({ telefono: t, legible: true, leido, idMeta, ...extra });

const refRecibido = (idMeta: string, t = T) => db.doc(`tenants/${t}/comprobantesRecibidos/${nombreDeObjeto(idMeta)}`);
const recibido = async (idMeta: string, t = T) => (await refRecibido(idMeta, t).get()).data();
const todosLosRecibidos = async (t = T) => (await db.collection(`tenants/${t}/comprobantesRecibidos`).get()).docs;
const conversacion = async (t: string) => (await db.doc(`tenants/${T}/conversaciones/wa_${t}`).get()).data() ?? {};
const metricas = async () => (await db.doc(`tenants/${T}/metricas/${MES}`).get()).data() ?? {};
const cierres = async () => (await db.collection(`tenants/${T}/cierres`).get()).docs;

async function sembrar(t: string, haceMin: number, extra: Record<string, unknown> = {}, referencia = `wamid.qr-${t}`) {
  const enviado = Date.now() - haceMin * MIN;
  const tr = solicitudDeCobroTras(null, { tipo: 'qr_enviado', reglaCobro: 2, idMeta: referencia }, enviado);
  await db.doc(`tenants/${T}/conversaciones/wa_${t}`).set({
    nombreContacto: 'Cliente de prueba',
    solicitud: {
      etapa: 'qr_enviado', desde: Timestamp.fromMillis(enviado), qrEnviadoEn: Timestamp.fromMillis(enviado),
      evento: { id: referencia, calendario: '' }, cotejos: 0, seguimientos: 0, seguimientoEn: null,
      reactivadaEn: null, monto: 100, ...(tr.cambios ?? {}), ...extra,
    },
  });
}

beforeAll(async () => {
  for (const t of [T, OTRO]) await db.recursiveDelete(db.doc(`tenants/${t}`));
  await db.doc(`rutasWhatsApp/${NUMERO}`).set({ tenantId: T, flujo: 'venta', aliasSecreto: 'cliente14', estado: 'activo' });
  await db.doc(`tenants/${T}`).set({ nombre: 'Tienda', estado: 'activo', flujos: ['venta'] });
  await db.doc(`tenants/${T}/cuenta/estado`).set({ plan: 'impulso', estadoPago: 'al_dia' });
  await db.doc(`tenants/${T}/config/negocio`).set({ nombreNegocio: 'Tienda', zonaHoraria: 'America/La_Paz', moneda: 'BOB' });
  await db.doc(`tenants/${T}/config/venta`).set({
    cobroReal: { activo: true, ficha: 'ficha-de-prueba', cargaUtil: 'carga-de-prueba', nombreCuenta: TITULAR, cuentas: [CUENTA], banco: 'BNB' },
  });
}, 120_000);
afterEach(() => { vi.restoreAllMocks(); });

describe('cada comprobante anotado queda en comprobantesRecibidos, con el id del objeto', () => {
  it('válido: documento con los campos del diseño, vence = en + 90 días, además del cierre', async () => {
    const t = tel(1);
    await sembrar(t, 2);
    const r = await comp(t, leidoDe('100'), 'wamid.f2-valido', { ruta: rutaDeComprobante(T, '2026-10-20', 'wamid.f2-valido', 'jpg') });
    expect(r.codigo).toBe(200);
    expect(r.cuerpo.cierreId).toBeTruthy();
    const d = await recibido('wamid.f2-valido');
    expect(d).toMatchObject({
      idMeta: 'wamid.f2-valido', conversacionId: `wa_${t}`, estado: 'valido', motivo: 'ok', importe: 100,
      montoLeido: 100, montoDistinto: false, intentos: 0, nombreContacto: 'Cliente de prueba',
    });
    expect(d?.['en'].toMillis() + 90 * DIA).toBe(d?.['vence'].toMillis());
    expect((await cierres()).length).toBeGreaterThan(0);
  });

  it('aproximado, inválido, tercer inválido (en revisión) y el cuarto con la solicitud ya en revisión', async () => {
    const t = tel(2);
    await sembrar(t, 2);
    await comp(t, leidoDe('50'), 'wamid.f2-i1');
    await comp(t, leidoDe('50'), 'wamid.f2-i2');
    await comp(t, leidoDe('100', { nombreCuenta: 'MARIA LOPEZ' }), 'wamid.f2-i3');
    await comp(t, leidoDe('100'), 'wamid.f2-i4');
    expect(await recibido('wamid.f2-i1')).toMatchObject({ estado: 'invalido', motivo: 'monto_menor', intentos: 1, montoLeido: 50 });
    expect(await recibido('wamid.f2-i2')).toMatchObject({ estado: 'invalido', intentos: 2 });
    expect(await recibido('wamid.f2-i3')).toMatchObject({ estado: 'en_revision', motivo: 'nombre_distinto', intentos: 3 });
    expect(await recibido('wamid.f2-i4')).toMatchObject({ estado: 'en_revision', motivo: 'en_revision' });
    const t2 = tel(3);
    await sembrar(t2, 2);
    await comp(t2, leidoDe('101'), 'wamid.f2-aprox');
    expect(await recibido('wamid.f2-aprox')).toMatchObject({ estado: 'aproximado', motivo: 'monto_distinto', montoDistinto: true, montoLeido: 101 });
  });

  it('tardío: queda registrado', async () => {
    const t = tel(4);
    await sembrar(t, 20);
    await comp(t, leidoDe('100'), 'wamid.f2-tardio');
    expect(await recibido('wamid.f2-tardio')).toMatchObject({ estado: 'tardio', motivo: 'tardio', conversacionId: `wa_${t}` });
  });

  it('el séptimo comprobante, que el arreglo de la conversación ya no guarda, SÍ se registra', async () => {
    const t = tel(5);
    await sembrar(t, 2, { etapa: 'en_revision', intentosInvalidos: 3 });
    for (let i = 1; i <= MAX_COMPROBANTES + 1; i++) await comp(t, leidoDe('100'), `wamid.f2-sie${i}`);
    expect(((await conversacion(t))['solicitud'].comprobantes as unknown[]).length).toBe(MAX_COMPROBANTES);
    expect(await recibido(`wamid.f2-sie${MAX_COMPROBANTES + 1}`)).toMatchObject({ estado: 'en_revision' });
    expect(await recibido('wamid.f2-sie1')).toBeTruthy();
  });

  it('el documento NO lleva el teléfono, lo leído de la imagen, `avisar` ni la referencia del pedido', async () => {
    const t = tel(6);
    await sembrar(t, 2, {}, 'wamid.REFERENCIA-DEL-PEDIDO');
    await comp(t, leidoDe('50'), 'wamid.f2-limpio');
    const d = await recibido('wamid.f2-limpio') as Record<string, unknown>;
    // El teléfono vive solo dentro de `conversacionId` (el diseño lo acepta); en ningún otro campo.
    const s = JSON.stringify({ ...d, conversacionId: undefined });
    for (const prohibido of [t, 'BNB-SECRETO-LEIDO', CUENTA, 'PEREZ', 'REFERENCIA-DEL-PEDIDO']) expect(s).not.toContain(prohibido);
    for (const campo of ['telefono', 'telefonoEnmascarado', 'avisar', 'cuentaDestino', 'nombreCuenta', 'banco', 'referencia']) {
      expect(d).not.toHaveProperty(campo);
    }
    expect(Object.keys(d).sort()).toEqual([
      'conversacionId', 'en', 'estado', 'idMeta', 'importe', 'intentos', 'montoDistinto', 'montoLeido', 'motivo',
      'nombreContacto', 'ruta', 'vence',
    ]);
  });

  it('con ruta válida de ESTE comercio y ESTE mensaje se guarda; una ajena queda en null', async () => {
    const t = tel(7);
    await sembrar(t, 2);
    const propia = rutaDeComprobante(T, '2026-10-20', 'wamid.f2-ruta', 'jpg');
    await comp(t, leidoDe('50'), 'wamid.f2-ruta', { ruta: propia });
    expect((await recibido('wamid.f2-ruta'))?.['ruta']).toBe(propia);
    await comp(t, leidoDe('50'), 'wamid.f2-ruta-ajena', { ruta: rutaDeComprobante(OTRO, '2026-10-20', 'wamid.f2-ruta-ajena', 'jpg') });
    expect((await recibido('wamid.f2-ruta-ajena'))?.['ruta']).toBeNull();
  });
});

describe('idempotencia y los casos que NO se anotan', () => {
  it('el mismo comprobante otra vez: sale antes, no escribe ni cambia el documento', async () => {
    const t = tel(10);
    await sembrar(t, 2);
    await comp(t, leidoDe('50'), 'wamid.f2-rep');
    const ref = refRecibido('wamid.f2-rep');
    await ref.update({ centinela: 'intacto' });
    const antes = (await ref.get()).updateTime;
    const otra = await comp(t, leidoDe('50'), 'wamid.f2-rep');
    expect(otra.cuerpo).toMatchObject({ repetido: true });
    expect((await ref.get()).updateTime.isEqual(antes)).toBe(true);
    expect((await recibido('wamid.f2-rep'))?.['centinela']).toBe('intacto');
  });

  it('si el documento ya existía, conserva `en` y `vence` y actualiza estado, motivo, montos e intentos', async () => {
    const t = tel(11);
    await sembrar(t, 2);
    const viejo = Timestamp.fromMillis(Date.now() - 5 * DIA);
    const vence = Timestamp.fromMillis(viejo.toMillis() + 90 * DIA);
    await refRecibido('wamid.f2-previo').set({
      idMeta: 'wamid.f2-previo', conversacionId: `wa_${t}`, estado: 'tardio', motivo: 'tardio', en: viejo, vence,
      importe: null, montoLeido: null, montoDistinto: false, intentos: 0, ruta: null,
    });
    await comp(t, leidoDe('50'), 'wamid.f2-previo');
    const d = await recibido('wamid.f2-previo');
    expect(d?.['en'].toMillis()).toBe(viejo.toMillis());
    expect(d?.['vence'].toMillis()).toBe(vence.toMillis());
    expect(d).toMatchObject({ estado: 'invalido', motivo: 'monto_menor', montoLeido: 50, importe: 100, intentos: 1 });
  });

  it('ya_resuelto y los 409 (sin cobro, cancelado, regla 1, sin total) no anotan nada', async () => {
    const antes = (await todosLosRecibidos()).length;
    const a = tel(20); await sembrar(a, 2, { etapa: 'agendada' });
    const b = tel(21); await sembrar(b, 2, { etapa: 'cancelada' });
    const c = tel(22); await sembrar(c, 2, { monto: null });
    const d = tel(23);
    await db.doc(`tenants/${T}/conversaciones/wa_${d}`).set({
      solicitud: { etapa: 'qr_enviado', qrEnviadoEn: Timestamp.now(), monto: 100, evento: { id: 'p', calendario: '' }, cotejos: 0 },
    });
    const resultados = [
      await comp(a, leidoDe('100'), 'wamid.f2-409a'), await comp(b, leidoDe('100'), 'wamid.f2-409b'),
      await comp(c, leidoDe('100'), 'wamid.f2-409c'), await comp(d, leidoDe('100'), 'wamid.f2-409d'),
      await comp(tel(24), leidoDe('100'), 'wamid.f2-409e'),
    ];
    expect(resultados.map((x) => x.cuerpo.estado ?? x.cuerpo.error)).toEqual([
      'ya_resuelto', 'cobro_cancelado', 'sin_total', 'regla_1', 'sin_cobro_pendiente',
    ]);
    expect((await todosLosRecibidos()).length).toBe(antes);
  });

  it('un comercio no escribe en el de otro: el documento queda bajo el comercio de la ruta', async () => {
    const t = tel(25);
    await sembrar(t, 2);
    await comp(t, leidoDe('50'), 'wamid.f2-aislado');
    expect(await recibido('wamid.f2-aislado', T)).toBeTruthy();
    expect(await recibido('wamid.f2-aislado', OTRO)).toBeUndefined();
  });
});

describe('UNA SOLA TRANSACCIÓN: si la escritura nueva falla, el cotejo entero se aborta', () => {
  async function conSetQueFalla<R>(cuando: (ruta: string) => boolean, prueba: () => Promise<R>): Promise<R> {
    let proto: any = null;
    await db.runTransaction(async (tx) => { proto = Object.getPrototypeOf(tx); });
    const original = proto.set;
    vi.spyOn(proto, 'set').mockImplementation(function (this: unknown, ref: { path: string }, ...resto: unknown[]) {
      if (cuando(ref.path)) throw new Error('fallo simulado de la escritura');
      return original.call(this, ref, ...resto);
    });
    return prueba();
  }

  it('válido: no queda la conversación, ni el cierre, ni las métricas, ni el recibido', async () => {
    const t = tel(30);
    await sembrar(t, 2);
    const antesConv = await conversacion(t);
    const antesMetricas = await metricas();
    const antesCierres = (await cierres()).length;
    await expect(conSetQueFalla((p) => p.includes('/comprobantesRecibidos/'), () => comp(t, leidoDe('100'), 'wamid.f2-atomico'))).rejects.toThrow();
    vi.restoreAllMocks();
    expect(await conversacion(t)).toEqual(antesConv);
    expect(await metricas()).toEqual(antesMetricas);
    expect((await cierres()).length).toBe(antesCierres);
    expect(await recibido('wamid.f2-atomico')).toBeUndefined();
    // Y sin el fallo, el MISMO comprobante sí se procesa (no quedó estado a medias que lo tome por repetido).
    const ok = await comp(t, leidoDe('100'), 'wamid.f2-atomico');
    expect(ok.cuerpo).toMatchObject({ estado: 'valido', repetido: false });
  });

  it('inválido: tampoco quedan intentos contados ni métricas', async () => {
    const t = tel(31);
    await sembrar(t, 2);
    const antesConv = await conversacion(t);
    const antesMetricas = await metricas();
    await expect(conSetQueFalla((p) => p.includes('/comprobantesRecibidos/'), () => comp(t, leidoDe('50'), 'wamid.f2-atomico2'))).rejects.toThrow();
    vi.restoreAllMocks();
    expect(await conversacion(t)).toEqual(antesConv);
    expect(await metricas()).toEqual(antesMetricas);
    expect(await recibido('wamid.f2-atomico2')).toBeUndefined();
  });

  it('control: si falla la escritura de la CONVERSACIÓN, tampoco queda el recibido (misma transacción)', async () => {
    const t = tel(32);
    await sembrar(t, 2);
    await expect(conSetQueFalla((p) => p.includes('/conversaciones/'), () => comp(t, leidoDe('50'), 'wamid.f2-atomico3'))).rejects.toThrow();
    vi.restoreAllMocks();
    expect(await recibido('wamid.f2-atomico3')).toBeUndefined();
  });
});

describe('la respuesta y el camino del cobro no cambian', () => {
  it('RespuestaDelCotejo conserva exactamente sus campos', async () => {
    const t = tel(40);
    await sembrar(t, 2);
    const r = await comp(t, leidoDe('100'), 'wamid.f2-forma');
    expect(Object.keys(r.cuerpo).sort()).toEqual([
      'avisarComercio', 'cierreId', 'estado', 'evento', 'importe', 'intentos', 'intentosRestantes', 'moneda',
      'montoDistinto', 'montoLeido', 'motivo', 'repetido',
    ]);
    expect(JSON.stringify(r.cuerpo)).not.toMatch(/comprobantesRecibidos|nombreContacto|vence/);
  });
  it('`solicitud.comprobantes` conserva su tope y su forma (el séptimo no entra)', async () => {
    const t = tel(41);
    await sembrar(t, 2, { etapa: 'en_revision', intentosInvalidos: 3 });
    for (let i = 1; i <= 7; i++) await comp(t, leidoDe('100'), `wamid.f2-tope${i}`);
    const lista = (await conversacion(t))['solicitud'].comprobantes as Array<Record<string, unknown>>;
    expect(lista.map((c) => c['idMeta'])).toEqual([1, 2, 3, 4, 5, 6].map((i) => `wamid.f2-tope${i}`));
    expect(Object.keys(lista[0] ?? {}).sort()).toEqual(
      ['avisar', 'en', 'estado', 'idMeta', 'importe', 'intentos', 'montoDistinto', 'montoLeido', 'motivo', 'ruta']);
  });
});

describe('la máquina de estados pura: `anotado`', () => {
  const ahora = Date.now();
  const base = (n: number, extra: Record<string, unknown> = {}) => ({
    etapa: 'qr_enviado', reglaCobro: 2, venceEn: Timestamp.fromMillis(ahora + 10 * MIN), monto: 100,
    comprobantes: Array.from({ length: n }, (_, i) => ({ idMeta: `p${i}`, estado: 'invalido', motivo: 'x', en: Timestamp.fromMillis(ahora), ruta: null })),
    ...extra,
  });
  const ev = (idMeta: string, estado: 'valido' | 'aproximado' | 'invalido' = 'invalido') =>
    ({ tipo: 'comprobante' as const, estado, motivo: 'm', idMeta, ruta: null });
  it.each([
    ['inválido', base(0), ev('n')], ['válido', base(0), ev('n', 'valido')], ['aproximado', base(0), ev('n', 'aproximado')],
    ['tercer inválido', base(2, { intentosInvalidos: 2 }), ev('n')],
    ['en revisión', base(1, { etapa: 'en_revision' }), ev('n')],
    ['tardío', base(0, { etapa: 'vencida', venceEn: Timestamp.fromMillis(ahora - 5 * MIN) }), ev('n')],
  ])('%s devuelve `anotado` con el idMeta nuevo', (_n, s, e) => {
    const t = solicitudDeCobroTras(s, e, ahora);
    expect(t.anotado).toMatchObject({ idMeta: 'n' });
  });
  it('con 6 ya anotados, el arreglo no cambia pero `anotado` sí viene', () => {
    const t = solicitudDeCobroTras(base(6, { etapa: 'en_revision' }), ev('septimo'), ahora);
    expect((t.cambios?.['comprobantes'] as unknown[]).length).toBe(6);
    expect(t.anotado).toMatchObject({ idMeta: 'septimo' });
  });
  it('repetido, ya resuelto, cancelado y vencido sin cobro: sin `anotado`', () => {
    expect(solicitudDeCobroTras(base(1), ev('p0'), ahora).anotado).toBeUndefined();
    expect(solicitudDeCobroTras(base(0, { etapa: 'agendada' }), ev('n'), ahora).anotado).toBeUndefined();
    expect(solicitudDeCobroTras(base(0, { etapa: 'cancelada' }), ev('n'), ahora).anotado).toBeUndefined();
    expect(solicitudDeCobroTras(null, ev('n'), ahora).anotado).toBeUndefined();
  });
  it('documentoDeRecibido sin previo: vence = en + 90 días y no copia nada de más', () => {
    const t = solicitudDeCobroTras(base(0), ev('n'), ahora);
    const d = documentoDeRecibido(t.anotado!, 'wa_x', '');
    expect((d['vence'] as { toMillis(): number }).toMillis() - (d['en'] as { toMillis(): number }).toMillis()).toBe(90 * DIA);
    expect(d).not.toHaveProperty('nombreContacto');
  });
});
