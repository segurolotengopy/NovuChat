/**
 * EL FLUJO RECIBE LO VIGENTE, NUNCA LO PROPUESTO (17/09/2026).
 *
 * `configuracionFlujo` entrega `datosDelNegocio.instruccionesExtra` —la clave
 * que los flujos ya leen— con el texto de `config/negocio.instruccionesVigentes`,
 * que solo escribe el SDK Admin después de verificarlo
 * (`functions/src/comportamiento.ts`). Lo que el comercio acaba de escribir en
 * `instruccionesExtra` no llega al asistente hasta que se apruebe.
 *
 * Es la función real contra el emulador, autenticada por número como n8n.
 */
import { beforeAll, describe, expect, it } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
// Alias reservado que ninguna otra suite usa. Valor de prueba, no un secreto.
const TOKEN = 'valor-de-prueba-de-lo-vigente';
process.env['INGESTA_CLIENTE17'] = TOKEN;

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore } = await import('firebase-admin/firestore');
const db = getFirestore();
const { configuracionFlujo } = await import('../functions/src/ingesta.ts');

const T = 'instrucciones-vigentes';
// Número de prueba con la forma que exige el repositorio público: seis ceros seguidos.
const NUMERO = '1000000097';

async function configuracion(): Promise<{ codigo: number; cuerpo: Record<string, unknown> }> {
  const cabeceras: Record<string, string> = {
    'x-novuchat-numero': NUMERO, authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json',
  };
  const leer = (n: string) => cabeceras[n.toLowerCase()];
  const peticion = {
    method: 'POST', body: {}, rawBody: Buffer.from('{}'), headers: cabeceras, get: leer, header: leer,
  };
  const r = { codigo: 0, cuerpo: {} as Record<string, unknown> };
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
  await (configuracionFlujo as unknown as (q: unknown, s: unknown) => Promise<void>)(peticion, respuesta);
  return r;
}

const datos = async () => {
  const r = await configuracion();
  expect(r.codigo).toBe(200);
  return r.cuerpo['datosDelNegocio'] as Record<string, unknown>;
};

const ref = () => db.doc(`tenants/${T}/config/negocio`);
const base = { nombreNegocio: 'Vigentes', tratamiento: 'usted', estiloEmojis: 'pocos', direccion: 'Calle 1' };

beforeAll(async () => {
  await db.doc(`rutasWhatsApp/${NUMERO}`).set({
    tenantId: T, flujo: 'agendamiento', aliasSecreto: 'cliente17', estado: 'activo',
  });
  await db.doc(`tenants/${T}`).set({ nombre: 'Vigentes', estado: 'activo', flujos: ['agendamiento'] });
});

describe('configuracionFlujo: instruccionesExtra sale de instruccionesVigentes', () => {
  it('con propuesto «X» y vigente «Y», el flujo recibe «Y»', async () => {
    await ref().set({ ...base, instruccionesExtra: 'X: texto recién escrito, sin revisar', instruccionesVigentes: 'Y: lo aprobado' });
    const d = await datos();
    expect(d['instruccionesExtra']).toBe('Y: lo aprobado');
    expect(JSON.stringify(d)).not.toContain('sin revisar');
  });

  it('sin vigente, el flujo recibe vacío aunque lo propuesto tenga texto', async () => {
    await ref().set({ ...base, instruccionesExtra: 'X: texto recién escrito, sin revisar' });
    const d = await datos();
    expect(d['instruccionesExtra']).toBe('');
    expect(JSON.stringify(d)).not.toContain('sin revisar');
  });

  it('con vigente vacío (lo propuesto se borró y se aprobó), vacío', async () => {
    await ref().set({ ...base, instruccionesExtra: 'X', instruccionesVigentes: '' });
    expect((await datos())['instruccionesExtra']).toBe('');
  });

  it('un vigente que no es texto se trata como vacío', async () => {
    await ref().set({ ...base, instruccionesExtra: 'X', instruccionesVigentes: { truco: 'mapa' } });
    expect((await datos())['instruccionesExtra']).toBe('');
  });

  it('la revisión no viaja al flujo: no es un dato del negocio', async () => {
    await ref().set({
      ...base, instruccionesExtra: 'X', instruccionesVigentes: 'Y',
      instruccionesRevision: { estado: 'aprobado', motivo: 'ok', hash: 'abc' },
    });
    const r = await configuracion();
    expect(JSON.stringify(r.cuerpo)).not.toContain('instruccionesRevision');
    expect(JSON.stringify(r.cuerpo)).not.toContain('instruccionesVigentes');
  });

  it('los demás textos libres siguen saliendo como siempre', async () => {
    await ref().set({ ...base, instruccionesVigentes: 'Y', politicaCancelacion: 'Con 24 horas.' });
    const d = await datos();
    expect(d['politicaCancelacion']).toBe('Con 24 horas.');
    expect(d['direccion']).toBe('Calle 1');
    expect(d['instruccionesExtra']).toBe('Y');
  });
});
