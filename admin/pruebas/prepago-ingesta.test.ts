/**
 * EL PREPAGO EN LA INGESTA REAL, contra el emulador de Firestore: la tabla de
 * `DISENO.md` §4undecies.4, más las negativas que son la condición de fusión
 * del bloque A-0.
 *
 *  - Sin modalidad, en demostración o con plan de demostración NUNCA se
 *    corta, ni con la bandera encendida: los contadores se mueven exactamente
 *    como hoy y la cuenta no recibe ni un campo.
 *  - Con la bandera apagada (modo observación) NADIE se corta aunque deba: se
 *    anota `corte.aplicado: false`, se cuentan las pérdidas, queda auditoría
 *    `corte_observado`, y la bitácora NO recibe `corte_servicio`.
 *  - Con la bandera del tenant encendida se corta de verdad: 200 con
 *    `servicio.estado: 'cortado'`, el mensaje se guarda, NINGÚN contador se
 *    mueve, `perdidas` cuenta una vez por teléfono, `corte_servicio` una vez.
 *  - La gracia de 48 horas, hora por hora en el borde.
 *  - `sin_conversaciones` descuenta la bolsa, corta al agotarse, y no corta
 *    una ventana ya abierta.
 *  - `fijarCortePrepago`: solo el propietario con sesión de Google.
 *
 * EL RELOJ SE CONGELA (`vi.useFakeTimers` solo sobre `Date`): la cobertura y la
 * gracia se deciden por instantes, y los bordes son a las 00:00 de Bolivia.
 * El alias de secreto `cliente16` es el de esta suite (§4undecies.7).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
// Alias reservado para el bloque A-0. Valor de prueba, no un secreto.
const TOKEN = 'valor-de-prueba-del-prepago';
process.env['INGESTA_CLIENTE16'] = TOKEN;

// index.ts inicializa la app por defecto al cargarse, como en producción, y
// reexporta la ingesta: se importa todo de ahí para no inicializar dos veces.
const { ingesta, fijarCortePrepago } = await import('../functions/src/index.ts');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const { limitesDe } = await import('../functions/src/planes.ts');
const { GRACIA_MS, finDelPeriodoMs, inicioDelPeriodoMs, mesBolivia, periodoAnterior, periodoSiguiente } =
  await import('../functions/src/prepago.ts');
const db = getFirestore();

const T = 'prepago-ingesta';
const NUMERO = '1000000094';
const HORA = 3_600_000;
const bo = (y: number, m: number, d: number, h = 0, mi = 0) => Date.UTC(y, m - 1, d, h, mi) + 4 * HORA;
/**
 * EL RELOJ SE CONGELA EN LA HORA REAL, no en una fecha inventada: los anclas de
 * ventana (`atencionDesde`) los escribe el emulador con SU reloj
 * (`serverTimestamp`), y con una fecha lejana cada mensaje abriría una ventana
 * nueva. Los bordes de la gracia, que sí exigen una fecha, van con instantes
 * explícitos y un solo mensaje por teléfono.
 */
const AHORA = Date.now();
const MES = mesBolivia(AHORA);
/** El mes pagado de una cuenta VENCIDA: dos meses atrás, ya sin gracia. */
const HACE_DOS_MESES = periodoAnterior(periodoAnterior(MES));
/** Desde cuándo rige ese corte: el fin de la gracia del mes siguiente al pagado. */
const DESDE_VENCIDA = inicioDelPeriodoMs(periodoSiguiente(HACE_DOS_MESES)) + GRACIA_MS;
const MES_UTC = (ms: number) => new Date(ms).toISOString().slice(0, 7);

interface Respuesta { codigo: number; cuerpo: Record<string, unknown> }

async function mensaje(telefono: string, direccion: 'entrante' | 'saliente', texto = 'hola, quiero reservar'): Promise<Respuesta> {
  const cuerpo = { telefono, direccion, tipo: 'text', texto };
  const cabeceras: Record<string, string> = {
    'x-novuchat-numero': NUMERO, authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json',
  };
  const leer = (n: string) => cabeceras[n.toLowerCase()];
  const peticion = {
    method: 'POST', body: cuerpo, rawBody: Buffer.from(JSON.stringify(cuerpo)),
    headers: cabeceras, get: leer, header: leer,
  };
  const r: Respuesta = { codigo: 0, cuerpo: {} };
  const respuesta = {
    status(c: number) { r.codigo = c; return respuesta; },
    send(b: unknown) { r.cuerpo = { texto: b }; return respuesta; },
    json(b: unknown) { r.cuerpo = b as Record<string, unknown>; return respuesta; },
    setHeader() { return respuesta; },
    getHeader() { return undefined; },
    set() { return respuesta; },
    on() { return respuesta; },
    end() { return respuesta; },
  };
  await (ingesta as unknown as (q: unknown, s: unknown) => Promise<void>)(peticion, respuesta);
  return r;
}
const entrante = (tel: string, texto?: string) => mensaje(tel, 'entrante', texto);
const saliente = (tel: string) => mensaje(tel, 'saliente', 'con gusto');

const cuenta = async () => (await db.doc(`tenants/${T}/cuenta/estado`).get()).data() ?? {};
const metricas = async () => (await db.doc(`tenants/${T}/metricas/${MES_UTC(Date.now())}`).get()).data() ?? {};
const conversacion = async (tel: string) => (await db.doc(`tenants/${T}/conversaciones/wa_${tel}`).get()).data() ?? {};
const mensajesDe = async (tel: string) => (await db.collection(`tenants/${T}/conversaciones/wa_${tel}/mensajes`).get()).size;
const auditorias = async (accion: string) =>
  (await db.collection(`tenants/${T}/auditoria`).where('accion', '==', accion).get()).docs.map((d) => d.data());
const bitacora = async (tipo: string) =>
  (await db.collection(`tenants/${T}/bitacora`).where('tipo', '==', tipo).get()).docs.map((d) => d.data());

async function limpiar() {
  for (const c of ['auditoria', 'bitacora']) {
    const previos = await db.collection(`tenants/${T}/${c}`).get();
    for (const d of previos.docs) await d.ref.delete();
  }
  const convs = await db.collection(`tenants/${T}/conversaciones`).get();
  for (const d of convs.docs) {
    const msgs = await d.ref.collection('mensajes').get();
    for (const m of msgs.docs) await m.ref.delete();
    await d.ref.delete();
  }
  const mets = await db.collection(`tenants/${T}/metricas`).get();
  for (const d of mets.docs) await d.ref.delete();
}
const plataforma = (corteActivo: boolean | null) =>
  corteActivo === null
    ? db.doc('plataforma/prepago').delete()
    : db.doc('plataforma/prepago').set({ corteActivo });
const fijarCuenta = (datos: Record<string, unknown>) => db.doc(`tenants/${T}/cuenta/estado`).set(datos);

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AHORA);
  await db.doc(`rutasWhatsApp/${NUMERO}`).set({
    tenantId: T, flujo: 'agendamiento', aliasSecreto: 'cliente16', estado: 'activo',
  });
  await db.doc(`tenants/${T}`).set({ nombre: 'Prepago', estado: 'activo', plan: 'crecimiento' });
}, 120_000);

afterAll(async () => {
  vi.useRealTimers();
  await plataforma(null);
});

beforeEach(async () => {
  vi.setSystemTime(AHORA);
  await limpiar();
});

describe('Negativas: lo que NUNCA se corta, con la bandera global encendida', () => {
  beforeEach(() => plataforma(true));

  // Con el aviso del 80 % ya marcado este mes: ese aviso es de hoy y saltaría
  // igual con 99.999 conversaciones, y acá lo que se mira es el prepago.
  const AVISADA = { avisoConsumo: { mes: MES_UTC(AHORA) } };
  it.each([
    ['sin modalidad y sin período pagado', { plan: 'crecimiento', estadoPago: 'al_dia', montoMensual: 50, ...AVISADA }],
    ['modalidad demostración con 99.999 consumidas', { modalidad: 'demostracion', plan: 'pro', ...AVISADA }],
    ['plan de demostración sin modalidad', { plan: 'demostracion', ...AVISADA }],
    ['plan de demostración con modalidad prepago (doble salvaguarda)', { plan: 'demostracion', modalidad: 'prepago', periodoPagado: '2025-01', ...AVISADA }],
  ])('%s: 200, contadores idénticos a hoy, sin `corte` y sin tocar la cuenta', async (_, datos) => {
    await fijarCuenta(datos);
    await db.doc(`tenants/${T}/metricas/${MES_UTC(AHORA)}`).set({ conversaciones: 99_999, mensajes: 5 });
    const r = await entrante('591000000101');
    expect(r.codigo).toBe(200);
    // La respuesta a n8n es byte a byte la de hoy: sin `servicio`.
    expect(Object.keys(r.cuerpo).sort()).toEqual(['atencion', 'avisarRecepcion']);
    expect(await metricas()).toMatchObject({ conversaciones: 100_000, mensajes: 6, entrantes: 1, personasAtendidas: 1 });
    expect(await cuenta()).toEqual(datos);
    expect(await auditorias('corte_observado')).toHaveLength(0);
    expect(await bitacora('corte_servicio')).toHaveLength(0);
    expect((await conversacion('591000000101'))['corteVisto']).toBeUndefined();
  });
});

describe('Negativas: una cuenta con modalidad pero con el período mal formado se atiende', () => {
  beforeEach(() => plataforma(true));

  it.each([
    ['prepago con `periodoPagado: "2026-9"`', { modalidad: 'prepago', plan: 'crecimiento', limites: limitesDe('crecimiento'), periodoPagado: '2026-9' }],
    ['prueba con `periodoPrueba` como Timestamp', { modalidad: 'prueba', plan: 'impulso', periodoPrueba: Timestamp.fromMillis(AHORA), bolsaPrueba: 0 }],
  ])('%s, bandera encendida: 200, contadores como hoy, auditoría `cuenta_incoherente` una sola vez', async (_, datos) => {
    await fijarCuenta({ ...datos, avisoConsumo: { mes: MES_UTC(AHORA) } });
    const r = await entrante('591000000601');
    expect(r.codigo).toBe(200);
    expect(r.cuerpo['servicio']).toMatchObject({ estado: 'operativo', motivo: null, fase: 'cubierto' });
    expect(await metricas()).toMatchObject({ conversaciones: 1, mensajes: 1, entrantes: 1 });
    expect((await cuenta())['corte']).toBeUndefined();
    expect((await cuenta())['incoherencia']).toBeDefined();
    await entrante('591000000602');
    expect((await metricas())['conversaciones']).toBe(2);
    const auds = await auditorias('cuenta_incoherente');
    expect(auds).toHaveLength(1);
    expect(auds[0]).toMatchObject({ uid: 'ingesta', modalidad: datos.modalidad });
    expect(await bitacora('corte_servicio')).toHaveLength(0);
    // Corregido el dato, la marca se va sola con el siguiente mensaje.
    await db.doc(`tenants/${T}/cuenta/estado`).update({ periodoPagado: MES, periodoPrueba: MES });
    await entrante('591000000603');
    expect((await cuenta())['incoherencia']).toBeUndefined();
  });
});

describe('Modo observación: la bandera apagada no corta a nadie aunque deba', () => {
  const VENCIDA = { modalidad: 'prepago', plan: 'crecimiento', limites: limitesDe('crecimiento'), periodoPagado: HACE_DOS_MESES };

  it('sin bandera: 200, contadores se mueven, corte observado con pérdidas, auditoría y sin bitácora de corte', async () => {
    await plataforma(false);
    await fijarCuenta(VENCIDA);
    const r = await entrante('591000000201');
    expect(r.codigo).toBe(200);
    expect(r.cuerpo['servicio']).toMatchObject({ estado: 'observado', motivo: 'sin_pago', fase: 'cortado' });
    expect(await metricas()).toMatchObject({ conversaciones: 1, mensajes: 1, entrantes: 1 });
    const c = await cuenta();
    expect(c['corte']).toMatchObject({ motivo: 'sin_pago', aplicado: false, perdidas: 1, mensajesPerdidos: 1 });
    // «Desde» es el fin de la gracia del mes siguiente al pagado: su día 3 a las 00:00.
    expect((c['corte'] as { desde: { toMillis: () => number } }).desde.toMillis()).toBe(DESDE_VENCIDA);
    expect(c).toMatchObject({ estadoPago: 'vencido', montoMensual: 50, moneda: 'USD' });
    expect(await auditorias('corte_observado')).toHaveLength(1);
    expect(await bitacora('corte_servicio')).toHaveLength(0);
    expect(await bitacora('mensaje_entrante')).toMatchObject([{ resultado: 'ok' }]);

    // El mismo teléfono otra vez: una pérdida más de mensajes, ninguna de clientes.
    await entrante('591000000201', 'sigo esperando');
    expect((await cuenta())['corte']).toMatchObject({ perdidas: 1, mensajesPerdidos: 2 });
    // Otro teléfono: otro cliente. Un saliente: nada.
    await entrante('591000000202');
    await saliente('591000000202');
    expect((await cuenta())['corte']).toMatchObject({ perdidas: 2, mensajesPerdidos: 3 });
    expect(await auditorias('corte_observado')).toHaveLength(1);
    expect((await metricas())['conversaciones']).toBe(2);
  });

  it('`cuenta.corteActivo: false` no exime ni corta: ídem', async () => {
    await plataforma(false);
    await fijarCuenta({ ...VENCIDA, corteActivo: false });
    const r = await entrante('591000000211');
    expect(r.codigo).toBe(200);
    expect(r.cuerpo['servicio']).toMatchObject({ estado: 'observado' });
    expect((await metricas())['conversaciones']).toBe(1);
    expect((await cuenta())['corte']).toMatchObject({ aplicado: false, perdidas: 1 });
    expect(await bitacora('corte_servicio')).toHaveLength(0);
  });

  it('sin documento `plataforma/prepago` es lo mismo que apagada', async () => {
    await plataforma(null);
    await fijarCuenta(VENCIDA);
    expect((await entrante('591000000221')).cuerpo['servicio']).toMatchObject({ estado: 'observado' });
    expect((await metricas())['conversaciones']).toBe(1);
  });

  it('`corteActivo: "true"` (texto, no booleano) es apagada', async () => {
    await db.doc('plataforma/prepago').set({ corteActivo: 'true' });
    await fijarCuenta({ ...VENCIDA, corteActivo: 'true' });
    expect((await entrante('591000000231')).cuerpo['servicio']).toMatchObject({ estado: 'observado' });
    expect((await metricas())['conversaciones']).toBe(1);
    expect((await cuenta())['corte']).toMatchObject({ aplicado: false });
  });
});

describe('Corte aplicado: la bandera del tenant encendida', () => {
  const VENCIDA = {
    modalidad: 'prepago', plan: 'crecimiento', limites: limitesDe('crecimiento'), periodoPagado: HACE_DOS_MESES,
    corteActivo: true,
  };

  it('200 con `cortado`, el mensaje se guarda, ningún contador se mueve, pérdidas una vez por teléfono, `corte_servicio` una vez', async () => {
    await plataforma(false);
    await fijarCuenta(VENCIDA);
    await db.doc(`tenants/${T}/metricas/${MES_UTC(AHORA)}`).set({ conversaciones: 4, mensajes: 40, entrantes: 20 });
    const antes = await metricas();

    const r = await entrante('591000000301');
    expect(r.codigo).toBe(200);
    expect(r.cuerpo['servicio']).toMatchObject({ estado: 'cortado', motivo: 'sin_pago', fase: 'cortado' });
    expect(await metricas()).toEqual(antes);
    expect(await mensajesDe('591000000301')).toBe(1);
    const conv = await conversacion('591000000301');
    expect(conv).toMatchObject({ telefono: '591000000301', ultimoMensaje: 'hola, quiero reservar' });
    expect(conv['atencionDesde']).toBeUndefined();
    expect(conv['mensajesVentana']).toBeUndefined();
    expect(conv['corteVisto']).toBe(DESDE_VENCIDA);
    expect((await cuenta())['corte']).toMatchObject({ motivo: 'sin_pago', aplicado: true, perdidas: 1, mensajesPerdidos: 1 });

    await entrante('591000000301', 'hola?');
    await entrante('591000000302');
    await saliente('591000000302');
    expect(await metricas()).toEqual(antes);
    expect((await cuenta())['corte']).toMatchObject({ perdidas: 2, mensajesPerdidos: 3 });
    expect(await bitacora('corte_servicio')).toHaveLength(1);
    expect((await bitacora('corte_servicio'))[0]).toMatchObject({ codigo: 'sin_pago', canal: 'sistema' });
    expect(await auditorias('corte_servicio')).toHaveLength(1);
    expect(await auditorias('corte_observado')).toHaveLength(0);
    const entrantes = await bitacora('mensaje_entrante');
    expect(entrantes).toHaveLength(3);
    for (const e of entrantes) expect(e).toMatchObject({ resultado: 'rechazado', codigo: 'cortado' });
  });

  it('al pasar de observado a aplicado empieza un corte nuevo: pérdidas desde cero y «desde» ahora', async () => {
    await plataforma(false);
    await fijarCuenta({ ...VENCIDA, corteActivo: false });
    await entrante('591000000311');
    await entrante('591000000312');
    expect((await cuenta())['corte']).toMatchObject({ aplicado: false, perdidas: 2 });
    await db.doc(`tenants/${T}/cuenta/estado`).update({ corteActivo: true });
    vi.setSystemTime(AHORA + HORA);
    await entrante('591000000313');
    const c = (await cuenta())['corte'] as Record<string, unknown>;
    expect(c).toMatchObject({ aplicado: true, perdidas: 1, mensajesPerdidos: 1 });
    expect((c['desde'] as { toMillis: () => number }).toMillis()).toBe(AHORA + HORA);
    expect(await bitacora('corte_servicio')).toHaveLength(1);
  });

  it('la bandera global también corta', async () => {
    await plataforma(true);
    await fijarCuenta({ ...VENCIDA, corteActivo: false });
    expect((await entrante('591000000321')).cuerpo['servicio']).toMatchObject({ estado: 'cortado' });
    expect(await metricas()).toEqual({});
  });

  it('cuando el mes queda pagado, el siguiente mensaje borra el corte y avisa la reanudación', async () => {
    await plataforma(false);
    await fijarCuenta(VENCIDA);
    await entrante('591000000331');
    expect((await cuenta())['corte']).toBeDefined();
    await db.doc(`tenants/${T}/cuenta/estado`).update({ periodoPagado: MES });
    const r = await entrante('591000000331', 'ahora sí');
    expect(r.cuerpo['servicio']).toMatchObject({ estado: 'operativo', fase: 'cubierto' });
    const c = await cuenta();
    expect(c['corte']).toBeUndefined();
    expect(c).toMatchObject({ estadoPago: 'al_dia', montoMensual: 50 });
    expect((c['proximoVencimiento'] as { toMillis: () => number }).toMillis()).toBe(finDelPeriodoMs(MES));
    expect(await bitacora('reanudacion_servicio')).toHaveLength(1);
    expect((await metricas())['conversaciones']).toBe(1);
  });
});

describe('La gracia de 48 horas, con el corte activo', () => {
  const SEPTIEMBRE = {
    modalidad: 'prepago', plan: 'impulso', limites: limitesDe('impulso'), periodoPagado: '2026-09', corteActivo: true,
  };

  it('el día 2 a las 23:00 de Bolivia se atiende, en gracia', async () => {
    await plataforma(false);
    await fijarCuenta(SEPTIEMBRE);
    vi.setSystemTime(bo(2026, 10, 2, 23));
    const r = await entrante('591000000401');
    expect(r.codigo).toBe(200);
    expect(r.cuerpo['servicio']).toMatchObject({ estado: 'operativo', fase: 'gracia', motivo: null });
    expect(r.cuerpo['servicio']).toMatchObject({ graciaHasta: new Date(bo(2026, 10, 3)).toISOString() });
    expect((await metricas())['conversaciones']).toBe(1);
    expect((await cuenta())['corte']).toBeUndefined();
  });

  it('el día 3 a las 00:01 está cortado, y «desde» son las 00:00', async () => {
    await plataforma(false);
    await fijarCuenta(SEPTIEMBRE);
    vi.setSystemTime(bo(2026, 10, 3, 0, 1));
    const r = await entrante('591000000402');
    expect(r.cuerpo['servicio']).toMatchObject({ estado: 'cortado', motivo: 'sin_pago' });
    expect(await metricas()).toEqual({});
    const c = (await cuenta())['corte'] as Record<string, unknown>;
    expect((c['desde'] as { toMillis: () => number }).toMillis()).toBe(bo(2026, 10, 3));
  });
});

describe('Sin conversaciones: la bolsa, el corte al agotarse y la ventana abierta', () => {
  const CHICA = {
    modalidad: 'prepago', plan: 'impulso', limites: { conversaciones: 1, productos: 20, agendas: 1 },
    periodoPagado: MES, bolsa: 2, corteActivo: true,
  };

  it('descuenta la bolsa, corta con la última, atiende la ventana abierta y rechaza al teléfono nuevo', async () => {
    await plataforma(false);
    await fijarCuenta(CHICA);
    await db.doc(`tenants/${T}/metricas/${MES_UTC(AHORA)}`).set({ conversaciones: 1 });

    // A abre: las incluidas ya están agotadas, gasta una de la bolsa.
    expect((await entrante('591000000501')).cuerpo['servicio']).toMatchObject({ estado: 'operativo' });
    expect((await cuenta())['bolsa']).toBe(1);
    expect((await cuenta())['corte']).toBeUndefined();
    // B abre: gasta la última y el corte queda anotado. B se atiende.
    const b = await entrante('591000000502');
    expect(b.cuerpo['servicio']).toMatchObject({ estado: 'operativo' });
    expect((await metricas())['conversaciones']).toBe(3);
    expect((await cuenta())['bolsa']).toBe(0);
    expect((await cuenta())['corte']).toMatchObject({ motivo: 'sin_conversaciones', aplicado: true, perdidas: 0 });
    expect(await bitacora('corte_servicio')).toHaveLength(1);
    // B sigue escribiendo dentro de su ventana: se atiende hasta el final.
    const b2 = await entrante('591000000502', '¿y a las 5?');
    expect(b2.cuerpo['servicio']).toMatchObject({ estado: 'observado', motivo: 'sin_conversaciones' });
    expect((await metricas())['mensajes']).toBe(3);
    expect((await cuenta())['corte']).toMatchObject({ motivo: 'sin_conversaciones', perdidas: 0 });
    // C es nuevo: cortado, una pérdida.
    const c = await entrante('591000000503');
    expect(c.cuerpo['servicio']).toMatchObject({ estado: 'cortado', motivo: 'sin_conversaciones' });
    expect((await metricas())).toMatchObject({ mensajes: 3, conversaciones: 3 });
    expect((await cuenta())['corte']).toMatchObject({ perdidas: 1, mensajesPerdidos: 1 });
    expect(await bitacora('corte_servicio')).toHaveLength(1);
    // Una bolsa nueva reanuda: el siguiente teléfono se atiende y el corte se borra.
    await db.doc(`tenants/${T}/cuenta/estado`).update({ bolsa: 30 });
    expect((await entrante('591000000504')).cuerpo['servicio']).toMatchObject({ estado: 'operativo' });
    expect((await cuenta())['corte']).toBeUndefined();
    expect((await cuenta())['bolsa']).toBe(29);
    expect(await bitacora('reanudacion_servicio')).toHaveLength(1);
  });

  it('en observación se descuenta igual y el corte queda solo anotado', async () => {
    await plataforma(false);
    await fijarCuenta({ ...CHICA, corteActivo: false, bolsa: 1 });
    await db.doc(`tenants/${T}/metricas/${MES_UTC(AHORA)}`).set({ conversaciones: 1 });
    await entrante('591000000511');
    expect((await cuenta())['bolsa']).toBe(0);
    expect((await cuenta())['corte']).toMatchObject({ motivo: 'sin_conversaciones', aplicado: false });
    expect(await auditorias('corte_observado')).toHaveLength(1);
    const r = await entrante('591000000512');
    expect(r.cuerpo['servicio']).toMatchObject({ estado: 'observado', motivo: 'sin_conversaciones' });
    expect((await metricas())['conversaciones']).toBe(3);
    expect((await cuenta())['corte']).toMatchObject({ perdidas: 1, aplicado: false });
    expect(await bitacora('corte_servicio')).toHaveLength(0);
  });
});

describe('`fijarCortePrepago`: solo el propietario con sesión de Google', () => {
  const PROPIETARIO = { uid: 'prop-1', token: { nc: { p: true }, firebase: { sign_in_provider: 'google.com' } } };
  const PROPIETARIO_CON_CONTRASENA = { uid: 'prop-2', token: { nc: { p: true }, firebase: { sign_in_provider: 'password' } } };
  const ADMIN = { uid: 'adm-1', token: { nc: { t: { [T]: 'admin' } }, firebase: { sign_in_provider: 'password' } } };
  const MOTIVO = 'ensayo de extremo a extremo';
  type Peticion = Parameters<typeof fijarCortePrepago.run>[0];
  const llamar = (data: Record<string, unknown>, auth: object | null = PROPIETARIO) =>
    fijarCortePrepago.run({ data, auth, rawRequest: {} } as unknown as Peticion);
  const historial = async () => (await db.collection('plataforma/prepago/historial').get()).docs.map((d) => d.data());

  beforeEach(async () => {
    await plataforma(null);
    for (const d of (await db.collection('plataforma/prepago/historial').get()).docs) await d.ref.delete();
    await fijarCuenta({ modalidad: 'prepago', plan: 'impulso' });
  });

  it('el administrador del comercio NO puede, ni para su propio comercio; el documento queda intacto', async () => {
    await expect(llamar({ corteActivo: true, motivo: MOTIVO }, ADMIN)).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(llamar({ corteActivo: true, tenantId: T, motivo: MOTIVO }, ADMIN)).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await db.doc('plataforma/prepago').get()).exists).toBe(false);
    expect((await cuenta())['corteActivo']).toBeUndefined();
  });

  it('el claim de propietario con contraseña no alcanza (T-19); sin sesión, tampoco', async () => {
    await expect(llamar({ corteActivo: true, motivo: MOTIVO }, PROPIETARIO_CON_CONTRASENA)).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(llamar({ corteActivo: true, motivo: MOTIVO }, null)).rejects.toMatchObject({ code: 'unauthenticated' });
    expect((await db.doc('plataforma/prepago').get()).exists).toBe(false);
  });

  it('el motivo es obligatorio, de al menos 10 caracteres', async () => {
    await expect(llamar({ corteActivo: true })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(llamar({ corteActivo: true, motivo: 'ensayo' })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(llamar({ corteActivo: true, motivo: '         ' })).rejects.toMatchObject({ code: 'invalid-argument' });
    expect((await db.doc('plataforma/prepago').get()).exists).toBe(false);
    expect(await historial()).toEqual([]);
  });

  it('un valor que no es booleano se rechaza', async () => {
    await expect(llamar({ corteActivo: 'si', motivo: MOTIVO })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(llamar({})).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(llamar({ corteActivo: true, tenantId: 'no-existe', motivo: MOTIVO })).rejects.toMatchObject({ code: 'not-found' });
  });

  it('la global se escribe con quién, cuándo y por qué, y queda en el historial', async () => {
    expect(await llamar({ corteActivo: true, motivo: 'ensayo de extremo a extremo' })).toEqual({ ok: true, corteActivo: true });
    expect((await db.doc('plataforma/prepago').get()).data()).toMatchObject({ corteActivo: true, actualizadoPor: 'prop-1', motivo: 'ensayo de extremo a extremo' });
    expect(await historial()).toMatchObject([{ corteActivo: true, uid: 'prop-1', motivo: 'ensayo de extremo a extremo' }]);
    await llamar({ corteActivo: false, motivo: 'fin del ensayo de extremo a extremo' });
    expect((await db.doc('plataforma/prepago').get()).get('corteActivo')).toBe(false);
    expect(await historial()).toHaveLength(2);
  });

  it('la de un tenant va a su cuenta, a su auditoría y al historial con el tenant', async () => {
    expect(await llamar({ corteActivo: true, tenantId: T, motivo: 'ensayo de extremo a extremo' })).toEqual({ ok: true, corteActivo: true, tenantId: T });
    expect((await cuenta())['corteActivo']).toBe(true);
    expect((await db.doc('plataforma/prepago').get()).exists).toBe(false);
    expect(await auditorias('corte_prepago')).toMatchObject([{ uid: 'prop-1', corteActivo: true, motivo: 'ensayo de extremo a extremo' }]);
    expect(await historial()).toMatchObject([{ tenantId: T, corteActivo: true }]);
  });
});
