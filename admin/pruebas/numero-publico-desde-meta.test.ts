/**
 * EL NÚMERO PÚBLICO SE FIJA SOLO DESDE META (27/11/2026), contra el emulador y por HTTP.
 *
 * `configuracionFlujo` fija `rutasWhatsApp/<phoneNumberId>.numeroPublico` la primera vez que llega un mensaje
 * verificado (`lineaVisible = {id, numero}`), sin pisar nunca uno fijado ni uno quitado a mano. Se prueba
 * negando: cada caso en que NO debe escribir, y luego los dos en que SÍ. Números ficticios.
 */
import { beforeAll, describe, expect, it } from 'vitest';
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
const { configuracionFlujo } = await import('../functions/src/ingesta.ts');

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
    ['demasiado corto', '1234567'], ['demasiado largo', '1234567890123456'],
  ])('rechaza: %s', (_n, v) => { expect(numeroPublicoDesdeMeta(v)).toBe(''); });
  it('rechaza lo que no es cadena', () => {
    for (const v of [undefined, null, 5, {}, [FICTICIO]]) expect(numeroPublicoDesdeMeta(v)).toBe('');
  });
});

describe('configuracionFlujo: lo que NO escribe', () => {
  it('con `numeroPublico` ya fijado, no lo pisa', async () => {
    const n = LINEA(1);
    await sembrarRuta(n, TA, { numeroPublico: '59171111111' });
    const r = await pedir({ lineaVisible: { id: n, numero: FICTICIO } }, n);
    expect(r.codigo).toBe(200);
    expect((await ruta(n))['numeroPublico']).toBe('59171111111');
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
    ['número local de 8 dígitos', '7000 0000'],
    ['591 con 10 dígitos', '+591 700 0000'],
    ['591 con 12 dígitos', '+591 7000 00000'],
    ['con letras', 'no-es-un-numero'],
    ['no es cadena', 59170000000],
  ])('con %s, no escribe', async (_n, numero) => {
    const n = LINEA(10 + _n.length);
    await sembrarRuta(n, TA);
    const r = await pedir({ lineaVisible: { id: n, numero } }, n);
    expect(r.codigo).toBe(200);
    expect(await ruta(n)).not.toHaveProperty('numeroPublico');
  });

  it('con la ruta de otro comercio, no escribe: el `tenantId` se relee dentro de la transacción', async () => {
    // La ruta autenticada es de A; entre la lectura de la firma y la transacción pasa a B.
    // Se prueba la parte observable: una ruta de B firmada con el alias de A no recibe el campo de A,
    // y la de A no se toca cuando la cabecera es la de B.
    const nB = LINEA(6);
    await sembrarRuta(nB, TB, { aliasSecreto: 'cliente20' });
    const r = await pedir({ lineaVisible: { id: nB, numero: FICTICIO } }, nB, TOKEN_A);
    expect(r.codigo).toBe(401);
    expect(await ruta(nB)).not.toHaveProperty('numeroPublico');
    expect(await auditorias(TA)).toHaveLength(0);
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
    expect((await ruta(n))['numeroPublico']).toBe(FICTICIO_DIGITOS);
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

describe('configuracionFlujo: la respuesta no cambia', () => {
  it('es idéntica con y sin `lineaVisible`', async () => {
    // La misma línea, para que la comparación sea de la respuesta entera (incluido `phoneNumberId`).
    const n = LINEA(30);
    await sembrarRuta(n, TA);
    const a = await pedir({}, n);
    const b = await pedir({ lineaVisible: { id: n, numero: FICTICIO } }, n);
    expect((await ruta(n))['numeroPublico']).toBe(FICTICIO_DIGITOS);
    expect(b.codigo).toBe(a.codigo);
    expect(b.cuerpo).toEqual(a.cuerpo);
  });
});
