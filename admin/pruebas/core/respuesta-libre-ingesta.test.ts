/**
 * `config/respuestaLibre` EN `configuracionFlujo` (12/11/2026, PR B / P2), contra el emulador de Firestore.
 *
 * Se llama a la Function como lo hace n8n y se mira el cuerpo REAL. Se escribe negando: sin documento o con `activo`
 * distinto de `true` la respuesta es IDÉNTICA, byte a byte, a la de antes de la pieza; con `activo: true` viaja saneada
 * y recortada; los tipos basura se omiten; y el documento de otro comercio no se lee.
 */
import { beforeAll, describe, expect, it } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
// Valor de prueba, no un secreto. El alias es el de la ruta (`aliasSecreto`); cada suite corre en su propio proceso.
const TOKEN = 'valor-de-prueba-de-la-respuesta-libre';
process.env['INGESTA_CLIENTE04'] = TOKEN;

// Por el índice de Functions (como llama n8n): una prueba de core no importa el archivo del coordinador. El índice
// inicializa la app de Firebase con GCLOUD_PROJECT (arriba), así que acá no se vuelve a inicializar.
const { configuracionFlujo } = await import('../../functions/src/index.ts');
const { getFirestore } = await import('firebase-admin/firestore');
const db = getFirestore();

const T = 'respuesta-libre-ingesta';
// Número de prueba con la forma que exige el repositorio público: seis ceros seguidos.
const NUMERO = '1000000098';
const TELEFONO = '59170000006';

async function configuracion(): Promise<{ codigo: number; cuerpo: Record<string, unknown> }> {
  const cuerpoPeticion = { telefono: TELEFONO };
  const cabeceras: Record<string, string> = { 'x-novuchat-numero': NUMERO, authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
  const leer = (n: string) => cabeceras[n.toLowerCase()];
  const peticion = { method: 'POST', body: cuerpoPeticion, rawBody: Buffer.from(JSON.stringify(cuerpoPeticion)), headers: cabeceras, get: leer, header: leer };
  let codigo = 0;
  let cuerpo: Record<string, unknown> = {};
  const respuesta = {
    status(c: number) { codigo = c; return respuesta; },
    send() { return respuesta; },
    json(b: Record<string, unknown>) { cuerpo = b; return respuesta; },
    setHeader() { return respuesta; }, getHeader() { return undefined; }, set() { return respuesta; }, on() { return respuesta; }, end() { return respuesta; },
  };
  await (configuracionFlujo as unknown as (q: unknown, s: unknown) => Promise<void>)(peticion, respuesta);
  return { codigo, cuerpo };
}

const escribir = (datos: Record<string, unknown> | null) =>
  datos === null ? db.doc(`tenants/${T}/config/respuestaLibre`).delete() : db.doc(`tenants/${T}/config/respuestaLibre`).set(datos);

beforeAll(async () => {
  await db.doc(`rutasWhatsApp/${NUMERO}`).set({ tenantId: T, flujo: 'agendamiento', aliasSecreto: 'cliente04', estado: 'activo' });
  await db.doc(`tenants/${T}`).set({ nombre: 'Respuesta libre', estado: 'activo', flujos: ['agendamiento'] });
  await db.doc(`tenants/${T}/cuenta/estado`).set({ plan: 'impulso', estadoPago: 'al_dia' });
  await db.doc(`tenants/${T}/config/negocio`).set({ nombreNegocio: 'Respuesta libre', zonaHoraria: 'America/La_Paz', moneda: 'BOB' });
});

const completo = () => ({
  activo: true, acuse: 'Gracias', textoSeguimiento: 'Escribe al local', textoRechazo: 'No puedo', textoHumor: 'Jaja', textoQueja: 'Lamento eso',
});

describe('configuracionFlujo entrega config/respuestaLibre (PR B / P2)', () => {
  it('sin documento: la respuesta NO trae la clave y es la misma que con el documento apagado, byte a byte', async () => {
    await escribir(null);
    const sin = await configuracion();
    expect(sin.codigo).toBe(200);
    expect('respuestaLibre' in sin.cuerpo).toBe(false);
    const huella = (c: Record<string, unknown>) => JSON.stringify(c, Object.keys(c).sort());
    await escribir({ ...completo(), activo: false });
    const apagado = await configuracion();
    expect('respuestaLibre' in apagado.cuerpo).toBe(false);
    expect(huella(apagado.cuerpo)).toBe(huella(sin.cuerpo));
  });

  it('NEGADO: un `activo` que no es exactamente `true` (texto, número, nulo, lista, ausente) no produce la clave', async () => {
    for (const malo of ['true', 1, null, [], {}]) {
      await escribir({ ...completo(), activo: malo });
      const r = await configuracion();
      expect(r.codigo, JSON.stringify(malo)).toBe(200);
      expect('respuestaLibre' in r.cuerpo, JSON.stringify(malo)).toBe(false);
    }
    const { activo: _a, ...sinActivo } = completo();
    await escribir(sinActivo);
    expect('respuestaLibre' in (await configuracion()).cuerpo).toBe(false);
  });

  it('con activo:true viaja saneada (solo los siete campos)', async () => {
    await escribir({ ...completo(), campoAjeno: 'no viaja', cuentaServicio: 'no viaja' });
    const r = await configuracion();
    expect(r.cuerpo['respuestaLibre']).toEqual(completo());
    expect(JSON.stringify(r.cuerpo)).not.toMatch(/campoAjeno|cuentaServicio|no viaja/);
  });

  it('con activo:true los textos se recortan a sus topes (humor y queja a 300)', async () => {
    await escribir({
      activo: true, acuse: 'a'.repeat(400), textoSeguimiento: 's'.repeat(400), textoRechazo: 'r'.repeat(400), textoHumor: 'h'.repeat(400), textoQueja: 'q'.repeat(400), tono: 'x', prohibidos: ['no viaja'],
    });
    const rl = (await configuracion()).cuerpo['respuestaLibre'] as Record<string, unknown>;
    expect((rl['acuse'] as string).length).toBe(300);
    expect((rl['textoSeguimiento'] as string).length).toBe(300);
    expect((rl['textoRechazo'] as string).length).toBe(200);
    expect((rl['textoHumor'] as string).length).toBe(300);
    expect((rl['textoQueja'] as string).length).toBe(300);
    expect(Object.keys(rl)).not.toEqual(expect.arrayContaining(['tono', 'prohibidos']));
  });

  it('NEGADO: tipos basura se omiten (texto que no es texto)', async () => {
    await escribir({ activo: true, acuse: 7, textoSeguimiento: null, textoRechazo: ['x'], textoHumor: '   ', textoQueja: { a: 1 } });
    expect((await configuracion()).cuerpo['respuestaLibre']).toEqual({ activo: true });
    await escribir({ activo: true, acuse: 'ok' });
    expect((await configuracion()).cuerpo['respuestaLibre']).toEqual({ activo: true, acuse: 'ok' });
  });

  it('NEGADO: el documento de OTRO comercio no se lee (el tenant sale de la ruta, no del cuerpo)', async () => {
    await escribir(null);
    await db.doc('tenants/otro-comercio-rl/config/respuestaLibre').set(completo());
    expect('respuestaLibre' in (await configuracion()).cuerpo).toBe(false);
  });
});
