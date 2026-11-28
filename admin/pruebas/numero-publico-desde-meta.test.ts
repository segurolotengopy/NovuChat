/**
 * EL NÚMERO PÚBLICO SE FIJA SOLO DESDE META (27/11/2026), contra el emulador y por HTTP.
 *
 * `configuracionFlujo` fija `rutasWhatsApp/<phoneNumberId>.numeroPublico` la primera vez que llega un mensaje
 * verificado (`lineaVisible = {id, numero}`), sin pisar nunca uno fijado ni uno quitado a mano. Se prueba
 * negando: cada caso en que NO debe escribir, y luego los dos en que SÍ. Números ficticios.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { numeroPublicoDesdeMeta, numeroPublicoValido } from '../functions/src/core/conversacion/numeroPublico.ts';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
const TOKEN_A = 'valor-de-prueba-numero-meta-a';
const TOKEN_B = 'valor-de-prueba-numero-meta-b';
process.env['INGESTA_CLIENTE19'] = TOKEN_A;
process.env['INGESTA_CLIENTE20'] = TOKEN_B;

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore } = await import('firebase-admin/firestore');
const db = getFirestore();
const { configuracionFlujo, fijarNumeroPublicoDesdeMeta, TOPE_NUMERO_PUBLICO_MS } = await import('../functions/src/ingesta.ts');

const TA = 'numero-meta-a';
const TB = 'numero-meta-b';
const LINEA = (n: number) => `10000008${String(n).padStart(2, '0')}`;
const FICTICIO = '+591 7000 0000'; // forma de Meta; el resultado es 59170000000
const FICTICIO_DIGITOS = '59170000000';

interface Respuesta { codigo: number; cuerpo: Record<string, unknown> }

async function pedir(cuerpo: Record<string, unknown>, numero: string, token: string | null = TOKEN_A): Promise<Respuesta> {
  const cabeceras: Record<string, string> = { 'x-novuchat-numero': numero, 'content-type': 'application/json' };
  if (token) cabeceras['authorization'] = `Bearer ${token}`;
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
    setHeader() { return respuesta; }, getHeader() { return undefined; },
    set() { return respuesta; }, on() { return respuesta; }, end() { return respuesta; },
  };
  await (configuracionFlujo as unknown as (q: unknown, s: unknown) => Promise<void>)(peticion, respuesta);
  return r;
}

const ruta = async (n: string) => (await db.doc(`rutasWhatsApp/${n}`).get()).data() ?? {};
const auditorias = async (t: string) =>
  (await db.collection(`tenants/${t}/auditoria`).get()).docs.map((d) => d.data())
    .filter((a) => a['accion'] === 'fijar_numero_publico_auto');
const sembrarRuta = (n: string, tenantId: string, extra: Record<string, unknown> = {}) =>
  db.doc(`rutasWhatsApp/${n}`).set({ tenantId, flujo: 'agendamiento', aliasSecreto: 'cliente19', estado: 'activo', ...extra });

beforeAll(async () => {
  for (const [t, nombre] of [[TA, 'Numero Meta A'], [TB, 'Numero Meta B']] as const) {
    await db.doc(`tenants/${t}`).set({ nombre, estado: 'activo', plan: 'crecimiento' });
    await db.doc(`tenants/${t}/config/negocio`).set({ nombreNegocio: nombre, numeroRecepcion: '70000001' });
  }
}, 120_000);

describe('numeroPublicoDesdeMeta (pura)', () => {
  it('lleva la forma de Meta a dígitos', () => {
    expect(numeroPublicoDesdeMeta(FICTICIO)).toBe(FICTICIO_DIGITOS);
    expect(numeroPublicoDesdeMeta('59170000000')).toBe(FICTICIO_DIGITOS);
    expect(numeroPublicoValido(FICTICIO_DIGITOS)).toBe(FICTICIO_DIGITOS);
  });
  it.each([
    ['local de 8 dígitos (7)', '70000000'], ['local de 8 dígitos (6)', '+60000000'],
    ['591 con 10 dígitos', '5917000000'], ['591 con 12 dígitos', '591700000000'],
    ['con letras', 'abc'], ['vacío', ''], ['cero inicial', '070000000000'],
    ['demasiado corto', '1234567'], ['demasiado largo', '1000000000000000'],
  ])('rechaza: %s', (_n, v) => { expect(numeroPublicoDesdeMeta(v)).toBe(''); });
  it('rechaza lo que no es cadena', () => {
    for (const v of [undefined, null, 5, {}, [FICTICIO]]) expect(numeroPublicoDesdeMeta(v)).toBe('');
  });
});

describe('configuracionFlujo: lo que NO escribe', () => {
  it('con `numeroPublico` ya fijado, no lo pisa', async () => {
    const n = LINEA(1);
    await sembrarRuta(n, TA, { numeroPublico: '59170000001' });
    const r = await pedir({ lineaVisible: { id: n, numero: FICTICIO } }, n);
    expect(r.codigo).toBe(200);
    expect((await ruta(n))['numeroPublico']).toBe('59170000001');
    expect(await ruta(n)).not.toHaveProperty('actualizadoPor');
  });

  it('con `numeroPublicoAuto: false` (quitado a mano), no lo vuelve a fijar', async () => {
    const n = LINEA(2);
    await sembrarRuta(n, TA, { numeroPublicoAuto: false });
    const r = await pedir({ lineaVisible: { id: n, numero: FICTICIO } }, n);
    expect(r.codigo).toBe(200);
    expect(await ruta(n)).not.toHaveProperty('numeroPublico');
  });

  it('con `lineaVisible.id` distinto de la cabecera firmada, no escribe en ninguna de las dos', async () => {
    const n = LINEA(3), otra = LINEA(4);
    await sembrarRuta(n, TA);
    await sembrarRuta(otra, TA);
    const r = await pedir({ lineaVisible: { id: otra, numero: FICTICIO } }, n);
    expect(r.codigo).toBe(200);
    expect(await ruta(n)).not.toHaveProperty('numeroPublico');
    expect(await ruta(otra)).not.toHaveProperty('numeroPublico');
  });

  it('con firma inválida (401), no escribe', async () => {
    const n = LINEA(5);
    await sembrarRuta(n, TA);
    expect((await pedir({ lineaVisible: { id: n, numero: FICTICIO } }, n, 'token-equivocado')).codigo).toBe(401);
    expect((await pedir({ lineaVisible: { id: n, numero: FICTICIO } }, n, null)).codigo).toBe(401);
    expect(await ruta(n)).not.toHaveProperty('numeroPublico');
  });

  it.each([
    [40, 'número local de 8 dígitos', '7000 0000'],
    [41, '591 con 10 dígitos', '+591 700 0000'],
    [42, '591 con 12 dígitos', '+591 7000 00000'],
    [43, 'con letras', 'no-es-un-numero'],
    [44, 'no es cadena', 59170000000],
  ])('con indice %i, %s: no escribe', async (indice, _n, numero) => {
    const n = LINEA(indice);
    await sembrarRuta(n, TA);
    const r = await pedir({ lineaVisible: { id: n, numero } }, n);
    expect(r.codigo).toBe(200);
    expect(await ruta(n)).not.toHaveProperty('numeroPublico');
  });

  it('con una firma de A contra la ruta de B por HTTP, 401 y B no recibe nada', async () => {
    const nB = LINEA(6);
    await sembrarRuta(nB, TB, { aliasSecreto: 'cliente20' });
    const r = await pedir({ lineaVisible: { id: nB, numero: FICTICIO } }, nB, TOKEN_A);
    expect(r.codigo).toBe(401);
    expect(await ruta(nB)).not.toHaveProperty('numeroPublico');
    expect((await auditorias(TB)).filter((x) => x['phoneNumberId'] === `…${nB.slice(-4)}`)).toHaveLength(0);
  });

  it('el cuerpo sin `lineaVisible` se comporta como siempre: no escribe', async () => {
    const n = LINEA(7);
    await sembrarRuta(n, TA);
    expect((await pedir({}, n)).codigo).toBe(200);
    expect(await ruta(n)).not.toHaveProperty('numeroPublico');
  });
});

describe('configuracionFlujo: lo que SÍ escribe', () => {
  it('con la forma `+591 7xxx xxxx`, fija los dígitos, sella `meta:ingesta` y audita solo las últimas 4 cifras', async () => {
    const n = LINEA(20);
    await sembrarRuta(n, TA);
    const antes = await ruta(n);
    const r = await pedir({ lineaVisible: { id: n, numero: FICTICIO } }, n);
    expect(r.codigo).toBe(200);
    const despues = await ruta(n);
    expect(despues['numeroPublico']).toBe(FICTICIO_DIGITOS);
    expect(despues['actualizadoPor']).toBe('meta:ingesta');
    // No toca nada más de la ruta.
    for (const k of ['tenantId', 'flujo', 'aliasSecreto', 'estado']) expect(despues[k], k).toEqual(antes[k]);
    const a = (await auditorias(TA)).find((x) => x['phoneNumberId'] === `…${n.slice(-4)}`);
    expect(a).toMatchObject({ origen: 'ingesta', uid: 'ingesta', despues: `…${FICTICIO_DIGITOS.slice(-4)}` });
    expect(JSON.stringify(a)).not.toContain(FICTICIO_DIGITOS);
    expect(JSON.stringify(a)).not.toContain(n);
  });

  it('con dos turnos concurrentes, escribe UNA sola vez', async () => {
    const n = LINEA(21);
    await sembrarRuta(n, TA);
    const cuerpo = { lineaVisible: { id: n, numero: FICTICIO } };
    const rs = await Promise.all([pedir(cuerpo, n), pedir(cuerpo, n), pedir(cuerpo, n)]);
    for (const r of rs) expect(r.codigo).toBe(200);
    // El turno no espera más del tope; la escritura sigue y no se cancela: se espera a que termine.
    await vi.waitFor(async () => { expect((await ruta(n))['numeroPublico']).toBe(FICTICIO_DIGITOS); }, { timeout: 15_000, interval: 200 });
    await new Promise((r) => setTimeout(r, 1500));
    const suyas = (await auditorias(TA)).filter((x) => x['phoneNumberId'] === `…${n.slice(-4)}`);
    expect(suyas).toHaveLength(1);
  });

  it('un segundo turno con otro número no cambia el ya fijado', async () => {
    const n = LINEA(22);
    await sembrarRuta(n, TA);
    await pedir({ lineaVisible: { id: n, numero: FICTICIO } }, n);
    await pedir({ lineaVisible: { id: n, numero: '+591 7111 1111' } }, n);
    expect((await ruta(n))['numeroPublico']).toBe(FICTICIO_DIGITOS);
  });
});

const rutaDe = (phoneNumberId: string, tenantId: string, extra: Record<string, unknown> = {}) =>
  ({ phoneNumberId, tenantId, tieneNumeroPublico: false, numeroPublicoAutoApagado: false, ...extra });
const transacciones = () => vi.spyOn(db, 'runTransaction');

afterEach(() => { vi.restoreAllMocks(); });

describe('fijarNumeroPublicoDesdeMeta directa: la guarda del comercio dentro de la transacción', () => {
  it('ruta autenticada de A contra un documento de B: no escribe en B ni audita', async () => {
    const n = LINEA(50);
    await sembrarRuta(n, TB, { aliasSecreto: 'cliente20' });
    await fijarNumeroPublicoDesdeMeta(rutaDe(n, TA), { id: n, numero: FICTICIO });
    expect(await ruta(n)).not.toHaveProperty('numeroPublico');
    expect((await auditorias(TA)).filter((x) => x['phoneNumberId'] === `…${n.slice(-4)}`)).toHaveLength(0);
    expect((await auditorias(TB)).filter((x) => x['phoneNumberId'] === `…${n.slice(-4)}`)).toHaveLength(0);
  });

  it('cambio de dueño entre la autenticación y la transacción: no escribe', async () => {
    const n = LINEA(51);
    await sembrarRuta(n, TA);
    const autenticada = rutaDe(n, TA); // lo que vio la firma
    await db.doc(`rutasWhatsApp/${n}`).update({ tenantId: TB }); // la línea cambia de dueño
    await fijarNumeroPublicoDesdeMeta(autenticada, { id: n, numero: FICTICIO });
    expect(await ruta(n)).not.toHaveProperty('numeroPublico');
  });

  it('el campo aparece entre la autenticación y la transacción: no lo pisa', async () => {
    const n = LINEA(52);
    await sembrarRuta(n, TA);
    const autenticada = rutaDe(n, TA);
    await db.doc(`rutasWhatsApp/${n}`).update({ numeroPublico: '59170000001' });
    await fijarNumeroPublicoDesdeMeta(autenticada, { id: n, numero: FICTICIO });
    expect((await ruta(n))['numeroPublico']).toBe('59170000001');
  });

  it('la marca aparece entre la autenticación y la transacción: no escribe', async () => {
    const n = LINEA(53);
    await sembrarRuta(n, TA);
    const autenticada = rutaDe(n, TA);
    await db.doc(`rutasWhatsApp/${n}`).update({ numeroPublicoAuto: false });
    await fijarNumeroPublicoDesdeMeta(autenticada, { id: n, numero: FICTICIO });
    expect(await ruta(n)).not.toHaveProperty('numeroPublico');
  });
});

describe('el atajo: 0 transacciones cuando la ruta ya trae el campo o la marca', () => {
  it('CONTROL: una línea sin campo ni marca abre exactamente UNA transacción', async () => {
    const n = LINEA(60);
    await sembrarRuta(n, TA);
    const espia = transacciones();
    await pedir({ lineaVisible: { id: n, numero: FICTICIO } }, n);
    expect(espia).toHaveBeenCalledTimes(1);
  });

  it.each([
    [61, 'marca `numeroPublicoAuto: false`', { numeroPublicoAuto: false }],
    [62, '`numeroPublico` que no es texto (número)', { numeroPublico: 5 }],
    [63, '`numeroPublico` vacío', { numeroPublico: '' }],
    [64, '`numeroPublico` nulo', { numeroPublico: null }],
    [65, '`numeroPublico` fijado', { numeroPublico: '59170000001' }],
  ])('línea %i con %s: 0 transacciones y la respuesta sale igual', async (indice, _n, extra) => {
    const n = LINEA(indice);
    await sembrarRuta(n, TA, extra);
    const espia = transacciones();
    const r = await pedir({ lineaVisible: { id: n, numero: FICTICIO } }, n);
    expect(r.codigo).toBe(200);
    expect(espia).not.toHaveBeenCalled();
  });

  it('un mensaje sin `lineaVisible` tampoco abre transacción', async () => {
    const n = LINEA(66);
    await sembrarRuta(n, TA);
    const espia = transacciones();
    await pedir({}, n);
    expect(espia).not.toHaveBeenCalled();
  });
});

describe('ráfagas: `lineaVisible` se ignora', () => {
  it('con `rafaga` en el cuerpo no abre transacción ni escribe', async () => {
    const n = LINEA(70);
    await sembrarRuta(n, TA);
    const espia = transacciones();
    await pedir({ telefono: '59100000070', rafaga: { v: 1, idMeta: 'wamid.X' }, lineaVisible: { id: n, numero: FICTICIO } }, n);
    expect(espia).not.toHaveBeenCalled();
    expect(await ruta(n)).not.toHaveProperty('numeroPublico');
  });
});

describe('tope de tiempo: una transacción lenta o fallida no cambia ni demora el turno', () => {
  it('lenta (5 s): la respuesta sale en el tope y es la de siempre', async () => {
    const n = LINEA(80), testigo = LINEA(81);
    await sembrarRuta(n, TA);
    await sembrarRuta(testigo, TA);
    const normal = await pedir({}, testigo);
    vi.spyOn(db, 'runTransaction').mockImplementation(() => new Promise((resolver) => setTimeout(() => resolver(undefined), 5000)) as never);
    const t0 = Date.now();
    const r = await pedir({ lineaVisible: { id: n, numero: FICTICIO } }, n);
    const ms = Date.now() - t0;
    expect(r.codigo).toBe(200);
    expect(ms).toBeLessThan(TOPE_NUMERO_PUBLICO_MS + 1500);
    const { phoneNumberId: _a, ...sinLinea } = r.cuerpo;
    const { phoneNumberId: _b, ...sinLineaNormal } = normal.cuerpo;
    expect(sinLinea).toEqual(sinLineaNormal);
  }, 20_000);

  it('fallida: la respuesta sale igual y no revienta', async () => {
    const n = LINEA(82), testigo = LINEA(83);
    await sembrarRuta(n, TA);
    await sembrarRuta(testigo, TA);
    const normal = await pedir({}, testigo);
    vi.spyOn(db, 'runTransaction').mockRejectedValue(new Error('falla simulada'));
    const r = await pedir({ lineaVisible: { id: n, numero: FICTICIO } }, n);
    expect(r.codigo).toBe(200);
    const { phoneNumberId: _a, ...sinLinea } = r.cuerpo;
    const { phoneNumberId: _b, ...sinLineaNormal } = normal.cuerpo;
    expect(sinLinea).toEqual(sinLineaNormal);
    expect(await ruta(n)).not.toHaveProperty('numeroPublico');
  });
});

describe('configuracionFlujo: la respuesta no cambia', () => {
  it('es idéntica con y sin `lineaVisible`, con el reloj fijo', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 10, 27, 15, 0, 0));
    try {
      // La misma línea, para que la comparación sea de la respuesta entera (incluido `phoneNumberId`).
      const n = LINEA(30);
      await sembrarRuta(n, TA);
      const a = await pedir({}, n);
      const b = await pedir({ lineaVisible: { id: n, numero: FICTICIO } }, n);
      expect((await ruta(n))['numeroPublico']).toBe(FICTICIO_DIGITOS);
      expect(b.codigo).toBe(a.codigo);
      expect(b.cuerpo).toEqual(a.cuerpo);
    } finally { vi.useRealTimers(); }
  });
});
