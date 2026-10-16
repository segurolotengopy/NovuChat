/**
 * =============================================================================
 * H2-2: LA PAUSA DEL ASISTENTE LA DECIDE EL SERVIDOR (ingesta y configuracionFlujo)
 * =============================================================================
 *
 * La `ingesta` y `configuracionFlujo` REALES contra el emulador. Contrato único de H2, §3.
 * Lo que se sostiene, negando:
 *
 *  1. Con el turno de una PERSONA vigente, las DOS respuestas dicen `bloqueado`, aviso vacío y
 *     `pausadoPorPersona: true`; el `atencionEstado` del documento NO cambia por la pausa.
 *  2. Sin pausa, las claves de las dos respuestas son las de siempre.
 *  3. Un turno vencido (inactividad, ventana) se PERSISTE devuelto dentro de la transacción de
 *     la ingesta, con auditoría de solo `telefono4`, SIN una lectura más; y el asistente responde.
 *  4. Un turno ilegible, con fechas rotas o del futuro, no pausa ni escribe nada.
 *  5. El bloqueo por umbral sigue siendo de los umbrales y se combina bien con la pausa.
 *  6. Lo que reporta n8n nunca trae autor `persona` ni campos de turno: se ignoran.
 *  7. Los contadores de facturación y las operaciones de la transacción son los de siempre
 *     (Bellido incluido). Cero mensajes por conversación: esta suite no envía nada.
 *
 * Puertos del emulador propios de este PR: 8361 / 9281.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8361'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
// Alias de esta suite: 05, 06 y 07 (las suites corren una por una). Valores de prueba, no secretos.
const TOKENES = { a: 'valor-de-prueba-pausa-a', b: 'valor-de-prueba-pausa-b', bel: 'valor-de-prueba-pausa-bel' };
process.env['INGESTA_CLIENTE05'] = TOKENES.a;
process.env['INGESTA_CLIENTE06'] = TOKENES.b;
process.env['INGESTA_CLIENTE07'] = TOKENES.bel;

const { ingesta, configuracionFlujo } = await import('../../functions/src/index.ts');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const db = getFirestore();

const MIN = 60_000;
const HORA = 3_600_000;

interface Comercio { id: string; numero: string; alias: string; token: string }
const A: Comercio = { id: 'pausa-a', numero: '1000000621', alias: 'cliente05', token: TOKENES.a };
const B: Comercio = { id: 'pausa-b', numero: '1000000622', alias: 'cliente06', token: TOKENES.b };
const BEL: Comercio = { id: 'pausa-bellido', numero: '1000000623', alias: 'cliente07', token: TOKENES.bel };

interface Respuesta { codigo: number; cuerpo: Record<string, unknown> }

async function llamar(funcion: unknown, c: Comercio, cuerpo: Record<string, unknown>): Promise<Respuesta> {
  const cabeceras: Record<string, string> = {
    'x-novuchat-numero': c.numero, authorization: `Bearer ${c.token}`, 'content-type': 'application/json',
  };
  const leer = (n: string) => cabeceras[n.toLowerCase()];
  const peticion = {
    method: 'POST', body: cuerpo, rawBody: Buffer.from(JSON.stringify(cuerpo)),
    headers: cabeceras, get: leer, header: leer,
  };
  const r: Respuesta = { codigo: 0, cuerpo: {} };
  const respuesta = {
    status(cod: number) { r.codigo = cod; return respuesta; },
    send(b: unknown) { r.cuerpo = { texto: b }; return respuesta; },
    json(b: unknown) { r.cuerpo = b as Record<string, unknown>; return respuesta; },
    setHeader() { return respuesta; },
    getHeader() { return undefined; },
    set() { return respuesta; },
    on() { return respuesta; },
    end() { return respuesta; },
  };
  await (funcion as (q: unknown, s: unknown) => Promise<void>)(peticion, respuesta);
  return r;
}
const reportar = (c: Comercio, cuerpo: Record<string, unknown>) => llamar(ingesta, c, cuerpo);
const entrante = (c: Comercio, tel: string, extra: Record<string, unknown> = {}) =>
  reportar(c, { telefono: tel, direccion: 'entrante', tipo: 'text', texto: 'hola, quiero reservar', ...extra });
const saliente = (c: Comercio, tel: string, extra: Record<string, unknown> = {}) =>
  reportar(c, { telefono: tel, direccion: 'saliente', tipo: 'text', texto: 'con gusto, le ayudo', ...extra });
const configuracion = (c: Comercio, tel: string) => llamar(configuracionFlujo, c, { telefono: tel });

type Datos = Record<string, unknown>;
const refConv = (c: Comercio, tel: string) => db.doc(`tenants/${c.id}/conversaciones/wa_${tel}`);
const conversacion = async (c: Comercio, tel: string): Promise<Datos> => (await refConv(c, tel).get()).data() ?? {};
const mensajes = async (c: Comercio, tel: string) => (await refConv(c, tel).collection('mensajes').get()).docs;
const auditoria = async (c: Comercio) => (await db.collection(`tenants/${c.id}/auditoria`).get()).docs.map((d) => d.data());
const metricas = async (c: Comercio): Promise<Datos> =>
  (await db.doc(`tenants/${c.id}/metricas/${new Date().toISOString().slice(0, 7)}`).get()).data() ?? {};
const ms = (v: unknown): number => (v as { toMillis: () => number }).toMillis();
const atencionDe = (r: Respuesta) => r.cuerpo['atencion'] as Datos;

async function limpiar(c: Comercio) {
  for (const col of ['auditoria', 'bitacora', 'metricas']) {
    for (const d of (await db.collection(`tenants/${c.id}/${col}`).get()).docs) await d.ref.delete();
  }
  for (const d of (await db.collection(`tenants/${c.id}/conversaciones`).get()).docs) {
    for (const m of (await d.ref.collection('mensajes').get()).docs) await m.ref.delete();
    await d.ref.delete();
  }
}
const cuentaAlDia = (c: Comercio, extra: Datos = {}) =>
  db.doc(`tenants/${c.id}/cuenta/estado`).set({ plan: 'pro', estadoPago: 'al_dia', ...extra });

// --- Operaciones de la transacción, contadas por un proxy sobre `runTransaction` (último intento).
interface Operacion { op: string; ruta: string }
let intento: Operacion[] = [];
let ultimo: Operacion[] = [];
const normalizar = (ruta: string) => ruta
  .replace(/^tenants\/[^/]+/, 'tenants/<T>')
  .replace(/wa_\d+/g, 'wa_<tel>')
  .replace(/(mensajes|auditoria)\/[^/]+$/, '$1/<id>')
  .replace(/metricas\/\d{4}-\d{2}$/, 'metricas/<periodo>');
function contarTransacciones() {
  const original = db.runTransaction.bind(db) as (f: (tx: unknown) => Promise<unknown>, o?: unknown) => Promise<unknown>;
  return vi.spyOn(db, 'runTransaction').mockImplementation(((f: (tx: unknown) => Promise<unknown>, o?: unknown) =>
    original(async (tx) => {
      intento = [];
      const proxy = new Proxy(tx as object, {
        get(objetivo, prop, receptor) {
          const valor = Reflect.get(objetivo, prop, receptor);
          if (typeof valor !== 'function') return valor;
          return (...args: unknown[]) => {
            if (['get', 'set', 'create', 'update', 'delete'].includes(String(prop))) {
              const ref = args[0] as { path?: string };
              intento.push({ op: String(prop), ruta: normalizar(ref.path ?? '?') });
            }
            return (valor as (...a: unknown[]) => unknown).apply(objetivo, args);
          };
        },
      });
      try { return await f(proxy); } finally { ultimo = intento; }
    }, o)) as unknown as typeof db.runTransaction);
}

/** Un turno guardado como lo escribe el servidor (H2-1). `ahora` es el reloj de la prueba. */
const turnoDe = (ahora: number, o: { actividad?: number; tomadoEn?: number; responde?: string; uid?: string } = {}): Datos => ({
  responde: o.responde ?? 'persona', tomadoPor: o.uid ?? 'uid-oper-1',
  tomadoEn: Timestamp.fromMillis(o.tomadoEn ?? ahora - 5 * MIN),
  actividadPersonaEn: Timestamp.fromMillis(o.actividad ?? ahora - 2 * MIN),
});

/**
 * Deja una conversación con un mensaje del cliente ya reportado (un entrante normal) y le pone
 * `turno` y, si se pide, un `ultimoEntranteEn` distinto. Devuelve el reloj de la prueba.
 */
async function sembrar(c: Comercio, tel: string, o: {
  turno?: unknown; ultimoEntrante?: number; marcas?: Datos;
} = {}): Promise<number> {
  const primero = await entrante(c, tel);
  expect(primero.codigo).toBe(200);
  const ahora = Date.now();
  const cambios: Datos = { ...(o.marcas ?? {}) };
  if (o.turno !== undefined) cambios['turno'] = o.turno;
  if (o.ultimoEntrante !== undefined) cambios['ultimoEntranteEn'] = Timestamp.fromMillis(o.ultimoEntrante);
  if (Object.keys(cambios).length) await refConv(c, tel).update(cambios);
  return ahora;
}

beforeAll(async () => {
  for (const c of [A, B, BEL]) {
    await limpiar(c);
    await db.doc(`rutasWhatsApp/${c.numero}`).set({
      tenantId: c.id, flujo: 'agendamiento', aliasSecreto: c.alias, estado: 'activo',
    });
    await db.doc(`tenants/${c.id}`).set({ nombre: `Comercio ${c.id}`, estado: 'activo', plan: 'pro' });
    await cuentaAlDia(c);
  }
}, 120_000);

afterAll(async () => {
  vi.restoreAllMocks();
  for (const c of [A, B, BEL]) {
    await limpiar(c);
    await db.doc(`rutasWhatsApp/${c.numero}`).delete();
  }
});

beforeEach(async () => {
  vi.restoreAllMocks();
  for (const c of [A, B, BEL]) { await limpiar(c); await cuentaAlDia(c); }
});

const CLAVES_ATENCION = ['bloque', 'estado', 'mensajeFijo', 'respuestasEnVentana', 'restanDelBloque', 'umbrales', 'ventanaVenceEn'];
const CLAVES_CONFIG_ATENCION = [...CLAVES_ATENCION, 'avisarRecepcion'].sort();

// =============================================================================
describe('con el turno de una persona vigente, las DOS respuestas callan al asistente', () => {
  it('la ingesta: bloqueado, aviso vacío, pausadoPorPersona; el turno y atencionEstado no se tocan', async () => {
    const tel = '59100000021001';
    const turno = turnoDe(Date.now());
    await sembrar(A, tel, { turno });
    const antes = await conversacion(A, tel);

    const r = await entrante(A, tel);
    expect(r.codigo).toBe(200);
    expect(atencionDe(r)['estado']).toBe('bloqueado');
    expect(Object.keys(atencionDe(r)).sort()).toEqual(CLAVES_ATENCION);
    expect(r.cuerpo['avisarRecepcion']).toBe('');
    expect(r.cuerpo['pausadoPorPersona']).toBe(true);
    expect(Object.keys(r.cuerpo).sort()).toEqual(['atencion', 'avisarRecepcion', 'pausadoPorPersona']);

    const c = await conversacion(A, tel);
    // La pausa NO escribe 'bloqueado': atencionEstado sigue siendo de los umbrales.
    expect(c['atencionEstado']).toBe('normal');
    expect(c['turno']).toEqual(antes['turno']);
    expect(await auditoria(A)).toHaveLength(0);
    // El mensaje del cliente se guarda y se cuenta como siempre.
    expect(await mensajes(A, tel)).toHaveLength(2);
  });

  it('configuracionFlujo: lo mismo, con el aviso vacío y la marca junto a avisarRecepcion', async () => {
    const tel = '59100000021002';
    await sembrar(A, tel, { turno: turnoDe(Date.now()) });
    const r = await configuracion(A, tel);
    expect(r.codigo).toBe(200);
    const a = atencionDe(r);
    expect(a['estado']).toBe('bloqueado');
    expect(a['avisarRecepcion']).toBe('');
    expect(a['pausadoPorPersona']).toBe(true);
    expect(Object.keys(a).sort()).toEqual([...CLAVES_CONFIG_ATENCION, 'pausadoPorPersona'].sort());
    // Lectura pura: nada se escribió.
    expect(await auditoria(A)).toHaveLength(0);
    expect((await conversacion(A, tel))['atencionEstado']).toBe('normal');
  });

  it('un SALIENTE (el asistente reporta lo que ya dijo) no cambia: sin la clave nueva', async () => {
    const tel = '59100000021003';
    await sembrar(A, tel, { turno: turnoDe(Date.now()) });
    const r = await saliente(A, tel);
    expect(Object.keys(r.cuerpo).sort()).toEqual(['atencion', 'avisarRecepcion']);
    expect(atencionDe(r)['estado']).toBe('normal');
  });
});

// =============================================================================
describe('sin pausa, las claves de las respuestas son las de siempre', () => {
  it('sin turno, devuelto o con turno de otra conversación: nada nuevo en ingesta ni en configuración', async () => {
    const casos: Array<[string, unknown]> = [
      ['sin turno', undefined],
      ['devuelto a mano', { ...turnoDe(Date.now(), { responde: 'asistente' }), devueltoEn: Timestamp.now(), motivoDevolucion: 'manual' }],
    ];
    let i = 0;
    for (const [nombre, turno] of casos) {
      const tel = `5910000002110${i++}`;
      await sembrar(A, tel, { turno });
      const e = await entrante(A, tel);
      expect(Object.keys(e.cuerpo).sort(), nombre).toEqual(['atencion', 'avisarRecepcion']);
      expect(atencionDe(e)['estado'], nombre).toBe('normal');
      expect(e.cuerpo['avisarRecepcion'], nombre).toBeNull();
      const cfg = await configuracion(A, tel);
      expect(Object.keys(atencionDe(cfg)).sort(), nombre).toEqual(CLAVES_CONFIG_ATENCION);
      expect(atencionDe(cfg)['estado'], nombre).toBe('normal');
    }
  });
});

// =============================================================================
describe('un turno vencido se persiste devuelto y el asistente responde ese mensaje', () => {
  it('por INACTIVIDAD (31 min): turno devuelto, auditoría con telefono4, estado normal', async () => {
    const tel = '59100000022001';
    const ahora = Date.now();
    await sembrar(A, tel, { turno: turnoDe(ahora, { tomadoEn: ahora - 3 * HORA, actividad: ahora - 31 * MIN }) });
    const r = await entrante(A, tel);
    expect(atencionDe(r)['estado']).toBe('normal');
    expect(Object.keys(r.cuerpo).sort()).toEqual(['atencion', 'avisarRecepcion']);

    const t = (await conversacion(A, tel))['turno'] as Datos;
    expect(t['responde']).toBe('asistente');
    expect(t['motivoDevolucion']).toBe('inactividad');
    expect(ms(t['devueltoEn'])).toBe(ms(t['actividadPersonaEn']) + 30 * MIN);
    expect(t['tomadoPor']).toBe('uid-oper-1');

    const a = await auditoria(A);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ accion: 'conversacion_devuelta', motivo: 'inactividad', telefono4: '2001', uid: 'ingesta', resultado: 'ok' });
    // Nunca el teléfono ni el id de la conversación, en ningún campo.
    expect(JSON.stringify(a)).not.toContain(tel);
    expect(JSON.stringify(a)).not.toContain('wa_');
    // El comercio ve el estado verdadero también por configuracionFlujo.
    expect(atencionDe(await configuracion(A, tel))['estado']).toBe('normal');
  });

  it('por VENTANA (último entrante hace 25 h): devuelto con motivo ventana', async () => {
    const tel = '59100000022002';
    const ahora = Date.now();
    await sembrar(A, tel, { turno: turnoDe(ahora), ultimoEntrante: ahora - 25 * HORA });
    const r = await entrante(A, tel);
    expect(atencionDe(r)['estado']).toBe('normal');
    const t = (await conversacion(A, tel))['turno'] as Datos;
    expect(t['responde']).toBe('asistente');
    expect(t['motivoDevolucion']).toBe('ventana');
    expect(ms(t['devueltoEn'])).toBe(ahora - 25 * HORA + 24 * HORA);
    expect((await auditoria(A))[0]).toMatchObject({ accion: 'conversacion_devuelta', motivo: 'ventana', telefono4: '2002' });
  });

  it('un segundo mensaje no vuelve a auditar ni a escribir el turno (ya está devuelto)', async () => {
    const tel = '59100000022003';
    const ahora = Date.now();
    await sembrar(A, tel, { turno: turnoDe(ahora, { actividad: ahora - 40 * MIN }) });
    await entrante(A, tel);
    const t1 = (await conversacion(A, tel))['turno'];
    await entrante(A, tel);
    expect((await conversacion(A, tel))['turno']).toEqual(t1);
    expect(await auditoria(A)).toHaveLength(1);
  });

  it('en la rama de CORTE por prepago también se persiste el vencimiento', async () => {
    const tel = '59100000022004';
    const ahora = Date.now();
    await sembrar(A, tel, { turno: turnoDe(ahora, { actividad: ahora - 40 * MIN }) });
    await db.doc('plataforma/prepago').set({ corteActivo: false });
    await db.doc(`tenants/${A.id}/cuenta/estado`).set({
      modalidad: 'prepago', plan: 'crecimiento', limites: { conversaciones: 500, productos: 100, agendas: 2, cambiosIncluidos: 10 },
      periodoPagado: '2020-01', corteActivo: true,
    });
    await entrante(A, tel);
    expect(((await conversacion(A, tel))['turno'] as Datos)['responde']).toBe('asistente');
    await db.doc('plataforma/prepago').delete();
  });
});

// =============================================================================
describe('ante la duda, responde el asistente (turno ilegible, roto o del futuro)', () => {
  const ahora = () => Date.now();
  const casos: Array<[string, () => unknown]> = [
    ['forma rara', () => ({ responde: 'persona' })],
    ['responde con un valor desconocido', () => ({ ...turnoDe(ahora()), responde: 'robot' })],
    ['tomadoPor que no es un uid', () => ({ ...turnoDe(ahora()), tomadoPor: 'a b/c' })],
    ['fechas que no son fechas', () => ({ ...turnoDe(ahora()), actividadPersonaEn: 'ayer' })],
    ['actividad del futuro', () => turnoDe(ahora(), { actividad: ahora() + 2 * HORA })],
    ['tomado en el futuro', () => turnoDe(ahora(), { tomadoEn: ahora() + 2 * HORA })],
    ['un texto en vez de un mapa', () => 'persona'],
    ['null', () => null],
  ];
  it.each(casos)('%s: no pausa, no escribe el turno y no audita', async (_n, hacer) => {
    const tel = '59100000023001';
    await sembrar(A, tel, { turno: hacer() });
    const antes = (await conversacion(A, tel))['turno'];
    const r = await entrante(A, tel);
    expect(atencionDe(r)['estado']).toBe('normal');
    expect(r.cuerpo['pausadoPorPersona']).toBeUndefined();
    expect((await conversacion(A, tel))['turno']).toEqual(antes);
    expect(await auditoria(A)).toHaveLength(0);
    const cfg = await configuracion(A, tel);
    expect(atencionDe(cfg)['estado']).toBe('normal');
    expect(atencionDe(cfg)['pausadoPorPersona']).toBeUndefined();
  });

  it('el último entrante del futuro (más de 5 min) tampoco pausa', async () => {
    const tel = '59100000023002';
    const t = Date.now();
    await sembrar(A, tel, { turno: turnoDe(t), ultimoEntrante: t + 2 * HORA });
    const r = await entrante(A, tel);
    expect(r.cuerpo['pausadoPorPersona']).toBeUndefined();
  });
});

// =============================================================================
describe('el bloqueo por umbral sigue siendo de los umbrales y se combina con la pausa', () => {
  const CUENTA = { umbralOperador: 3, umbralBloqueo: 5 };
  const enBloqueo = (): Datos => ({ atencionDesde: Timestamp.now(), mensajesVentana: 5, atencionEstado: 'bloqueado' });
  const enOperador = (): Datos => ({ atencionDesde: Timestamp.now(), mensajesVentana: 3, atencionEstado: 'normal' });

  it('sin pausa: el bloqueo por umbral responde como siempre (sin la clave nueva)', async () => {
    await cuentaAlDia(A, CUENTA);
    const tel = '59100000024001';
    await sembrar(A, tel, { marcas: enBloqueo() });
    const r = await entrante(A, tel);
    expect(atencionDe(r)['estado']).toBe('bloqueado');
    expect(r.cuerpo['pausadoPorPersona']).toBeUndefined();
    expect((await conversacion(A, tel))['atencionEstado']).toBe('bloqueado');
  });

  it('con pausa sobre un bloqueo por umbral: bloqueado, aviso vacío, atencionEstado intacto', async () => {
    await cuentaAlDia(A, CUENTA);
    const tel = '59100000024002';
    await sembrar(A, tel, { turno: turnoDe(Date.now()), marcas: enBloqueo() });
    const r = await entrante(A, tel);
    expect(atencionDe(r)['estado']).toBe('bloqueado');
    expect(r.cuerpo['avisarRecepcion']).toBe('');
    expect(r.cuerpo['pausadoPorPersona']).toBe(true);
    expect((await conversacion(A, tel))['atencionEstado']).toBe('bloqueado');
  });

  it('en estado operador, la pausa anula también el aviso fijo, y atencionEstado sigue en el valor del umbral', async () => {
    await cuentaAlDia(A, CUENTA);
    const tel = '59100000024003';
    await sembrar(A, tel, { turno: turnoDe(Date.now()), marcas: enOperador() });
    const r = await entrante(A, tel);
    expect(atencionDe(r)['estado']).toBe('bloqueado');
    expect(atencionDe(r)['mensajeFijo']).toBeNull();
    // El umbral dice 'operador' (3 de 3): eso es lo que queda guardado, no la pausa.
    expect((await conversacion(A, tel))['atencionEstado']).toBe('operador');
    const cfg = await configuracion(A, tel);
    expect(atencionDe(cfg)['estado']).toBe('bloqueado');
    expect(atencionDe(cfg)['mensajeFijo']).toBeNull();
  });

  it('la pausa se quita y el umbral vuelve a mandar solo (sin turno, en operador, responde operador)', async () => {
    await cuentaAlDia(A, CUENTA);
    const tel = '59100000024004';
    await sembrar(A, tel, { marcas: enOperador() });
    const r = await entrante(A, tel);
    expect(atencionDe(r)['estado']).toBe('operador');
    expect(r.cuerpo['avisarRecepcion']).toBe('operador');
  });

  it('la bitácora y las métricas de umbral siguen contando el hecho aunque haya pausa', async () => {
    await cuentaAlDia(A, CUENTA);
    const tel = '59100000024005';
    await sembrar(A, tel, { turno: turnoDe(Date.now()), marcas: { atencionDesde: Timestamp.now(), mensajesVentana: 3, atencionEstado: 'normal' } });
    await entrante(A, tel);
    // La transición normal -> operador ocurrió de verdad: se anota, y el aviso a n8n va vacío.
    expect((await metricas(A))['derivadasAOperador']).toBe(1);
  });
});

// =============================================================================
describe('lo que NO cambia: facturación, operaciones y lo que reporta n8n', () => {
  const CAMPOS_CONV = ['mensajesTotal', 'respuestasDelPeriodo', 'mensajesVentana', 'periodoContado', 'atencionEstado', 'origen', 'noLeidos'];
  const CAMPOS_MET = ['mensajes', 'entrantes', 'conversaciones', 'personasAtendidas', 'interacciones', 'bloquesAdicionales'];
  const pick = (o: Datos, campos: readonly string[]): Datos =>
    Object.fromEntries(campos.filter((k) => k in o).map((k) => [k, o[k]]));

  async function escenario(c: Comercio, tel: string, turno: unknown) {
    vi.restoreAllMocks();
    contarTransacciones();
    await sembrar(c, tel, { turno });
    await entrante(c, tel);
    const operaciones = ultimo;
    await saliente(c, tel);
    await entrante(c, tel);
    return { operaciones, conv: pick(await conversacion(c, tel), CAMPOS_CONV), met: pick(await metricas(c), CAMPOS_MET) };
  }

  it.each([['Comercio A', A], ['Bellido', BEL]] as Array<[string, Comercio]>)(
    '%s: con turno vigente los contadores y las lecturas/escrituras son idénticas a las de sin turno', async (_n, c) => {
      const sin = await escenario(c, '59100000025001', undefined);
      await limpiar(c); await cuentaAlDia(c);
      const con = await escenario(c, '59100000025002', turnoDe(Date.now()));
      expect(con.operaciones).toEqual(sin.operaciones);
      expect(con.conv).toEqual(sin.conv);
      expect(con.met).toEqual({ ...sin.met, personasAtendidas: sin.met['personasAtendidas'] });
    });

  it('el vencimiento persistido agrega EXACTAMENTE un update y un create de auditoría, y ninguna lectura', async () => {
    const base = await escenario(B, '59100000025003', undefined);
    await limpiar(B); await cuentaAlDia(B);
    vi.restoreAllMocks();
    contarTransacciones();
    const tel = '59100000025004';
    const ahora = Date.now();
    await sembrar(B, tel, { turno: turnoDe(ahora, { actividad: ahora - 45 * MIN }) });
    await entrante(B, tel);
    const lecturas = (ops: Operacion[]) => ops.filter((o) => o.op === 'get');
    expect(lecturas(ultimo)).toEqual(lecturas(base.operaciones));
    expect(ultimo).toEqual([
      ...base.operaciones.slice(0, base.operaciones.findIndex((o) => o.op !== 'get')),
      { op: 'update', ruta: 'tenants/<T>/conversaciones/wa_<tel>' },
      { op: 'create', ruta: 'tenants/<T>/auditoria/<id>' },
      ...base.operaciones.slice(base.operaciones.findIndex((o) => o.op !== 'get')),
    ]);
  });

  it('lo que reporta n8n nunca trae autor persona ni turno: se ignora', async () => {
    const tel = '59100000025005';
    const falso = { responde: 'persona', tomadoPor: 'uid-falso', tomadoEn: Timestamp.now(), actividadPersonaEn: Timestamp.now() };
    const r = await entrante(A, tel, {
      autor: 'persona', autorUid: 'uid-falso', estadoEnvio: 'pendiente', turno: falso,
      mensajesPersona: 99, necesitaHumano: true,
    });
    expect(r.codigo).toBe(200);
    expect(r.cuerpo['pausadoPorPersona']).toBeUndefined();
    expect(atencionDe(r)['estado']).toBe('normal');
    const c = await conversacion(A, tel);
    expect(c['turno']).toBeUndefined();
    expect(c['necesitaHumano']).toBeUndefined();
    for (const d of await mensajes(A, tel)) {
      for (const k of ['autor', 'autorUid', 'estadoEnvio']) expect(Object.keys(d.data()), k).not.toContain(k);
    }
    expect((await metricas(A))['mensajesPersona']).toBeUndefined();
    // Un saliente con autor persona tampoco: cuenta como respuesta del asistente.
    const s = await saliente(A, tel, { autor: 'persona', autorUid: 'uid-falso' });
    expect(s.codigo).toBe(200);
    const docs = await mensajes(A, tel);
    for (const d of docs) expect(Object.keys(d.data())).not.toContain('autor');
    expect((await conversacion(A, tel))['mensajesVentana']).toBe(1);
  });
});
