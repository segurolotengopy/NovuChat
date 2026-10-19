/**
 * =============================================================================
 * F3b PR-2b: EL DESPACHO DE `sesion` EN `configuracionFlujo`, contra el emulador
 * =============================================================================
 *
 * `sesion.ts` decide y `sesionFirestore.ts` escribe (PR-1 y PR-2a); acá se prueba
 * solo el despacho de `configuracionFlujo`, por el mismo camino HTTP que usa el flujo:
 *
 *  1. Sin `sesion`, la respuesta es IDÉNTICA a la de antes del PR (la huella
 *     `despacho-sesion.sin-sesion.json` se generó con el código de `origin/main`).
 *  2. `leer` agrega `conversacion` y `visto` a esa misma respuesta.
 *  3. `comprometer` y `asentar` responden el JSON de `atenderSesion`.
 *  4. Seguridad: el token de un número con la cabecera de otro -> 401; un
 *     `tenantId` en el cuerpo se ignora; un comercio suspendido -> 409 sin escritura;
 *     sin teléfono válido o con `v` desconocida -> 400.
 *  5. El camino `sesion` no escribe en `conversaciones/*` ni en `metricas/*` (conteo facturado).
 *
 * Teléfonos ficticios (seis ceros seguidos).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
const TOKEN_A = 'valor-de-prueba-despacho-a';
const TOKEN_B = 'valor-de-prueba-despacho-b';
process.env['INGESTA_CLIENTE17'] = TOKEN_A;
process.env['INGESTA_CLIENTE18'] = TOKEN_B;

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore } = await import('firebase-admin/firestore');
const db = getFirestore();
const { configuracionFlujo } = await import('../functions/src/ingesta.ts');

const aqui = dirname(fileURLToPath(import.meta.url));
const HUELLA = join(aqui, 'despacho-sesion.sin-sesion.json');
const TA = 'despacho-a';
const TB = 'despacho-b';
const NUMERO_A = '1000000711';
const NUMERO_B = '1000000712';
const TEL = '59100000011';
const AHORA = Date.UTC(2026, 9, 18, 15, 0, 0);

interface Respuesta { codigo: number; cuerpo: Record<string, unknown> }

async function pedir(cuerpo: Record<string, unknown>, numero = NUMERO_A, token = TOKEN_A): Promise<Respuesta> {
  const cabeceras: Record<string, string> = {
    'x-novuchat-numero': numero, authorization: `Bearer ${token}`, 'content-type': 'application/json',
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
  await (configuracionFlujo as unknown as (q: unknown, s: unknown) => Promise<void>)(peticion, respuesta);
  return r;
}

let n = 0;
const sesion = (extra: Record<string, unknown>) =>
  ({ v: 1, espacio: 'venta', ejecucion: `ej-${++n}`, ...extra });
const comprometer = (extra: Record<string, unknown> = {}) =>
  sesion({ accion: 'comprometer', idCompromiso: `compromiso-${String(++n).padStart(6, '0')}`, estado: { paso: 1 },
    venceEnMin: 60, versionLeida: 0, ...extra });

async function documentos(ruta: string): Promise<number> {
  return (await db.collection(ruta).get()).size;
}
const coleccionesDeTurno = ['sesionesDeTurno', 'vistosDeTurno', 'cuposDeTurno'];
async function escriturasDeTurno(t: string): Promise<number> {
  let total = 0;
  for (const c of coleccionesDeTurno) total += await documentos(`tenants/${t}/${c}`);
  return total;
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AHORA);
  await db.doc(`rutasWhatsApp/${NUMERO_A}`).set({ tenantId: TA, flujo: 'agendamiento', aliasSecreto: 'cliente17', estado: 'activo' });
  await db.doc(`rutasWhatsApp/${NUMERO_B}`).set({ tenantId: TB, flujo: 'agendamiento', aliasSecreto: 'cliente18', estado: 'activo' });
  for (const [t, nombre] of [[TA, 'Despacho A'], [TB, 'Despacho B']] as const) {
    await db.doc(`tenants/${t}`).set({ nombre, estado: 'activo', plan: 'crecimiento' });
    await db.doc(`tenants/${t}/config/negocio`).set({ nombreNegocio: nombre, numeroRecepcion: '70000001' });
  }
}, 120_000);

afterAll(() => { vi.useRealTimers(); });

beforeEach(async () => {
  vi.setSystemTime(AHORA);
  await db.doc(`tenants/${TA}`).update({ estado: 'activo' });
  for (const t of [TA, TB]) {
    for (const c of coleccionesDeTurno) {
      for (const d of (await db.collection(`tenants/${t}/${c}`).get()).docs) await d.ref.delete();
    }
  }
});

describe('sin `sesion`: la respuesta de siempre', () => {
  it('es idéntica, byte a byte, a la huella tomada antes del PR', async () => {
    const r = await pedir({ telefono: TEL });
    expect(r.codigo).toBe(200);
    expect(r.cuerpo['conversacion']).toBeUndefined();
    expect(r.cuerpo['visto']).toBeUndefined();
    const actual = JSON.stringify(r.cuerpo, null, 1);
    if (process.env['GENERAR_HUELLA'] === '1') writeFileSync(HUELLA, `${actual}\n`);
    expect(actual).toBe(readFileSync(HUELLA, 'utf8').trimEnd());
  });
});

describe('leer', () => {
  it('agrega `conversacion` y `visto` a la respuesta de hoy, sin quitarle nada', async () => {
    const base = await pedir({ telefono: TEL });
    const r = await pedir({ telefono: TEL, sesion: sesion({ accion: 'leer', idMensaje: 'wamid.HBgLAAAA' }) });
    expect(r.codigo).toBe(200);
    expect(r.cuerpo['conversacion']).toEqual({ version: 0, estado: null, desde: null, vence: null, vencido: false });
    expect(r.cuerpo['visto']).toBe('nuevo');
    const { conversacion: _c, visto: _v, ...resto } = r.cuerpo;
    expect(resto).toEqual(base.cuerpo);
  });

  it('la acción ausente es `leer`', async () => {
    const r = await pedir({ telefono: TEL, sesion: sesion({}) });
    expect(r.codigo).toBe(200);
    expect(r.cuerpo['conversacion']).toMatchObject({ version: 0 });
  });

  it('el mismo idMensaje leído de nuevo es `repetido`', async () => {
    const s = () => sesion({ accion: 'leer', idMensaje: 'wamid.REPETIDO1' });
    expect((await pedir({ telefono: TEL, sesion: s() })).cuerpo['visto']).toBe('nuevo');
    expect((await pedir({ telefono: TEL, sesion: s() })).cuerpo['visto']).toBe('repetido');
  });
});

describe('comprometer y asentar', () => {
  it('responden el JSON de atenderSesion, sin los campos de la configuración', async () => {
    const c = await pedir({ telefono: TEL, sesion: comprometer({ cupos: [{ clave: 'avisos', alcance: 'contacto', periodo: 'dia', cantidad: 1, tope: 3 }], idCompromiso: 'compromiso-despacho-1' }) });
    expect(c.codigo).toBe(200);
    expect(c.cuerpo['resultado']).toBe('comprometido');
    expect(c.cuerpo['tenantId']).toBeUndefined();
    const lectura = await pedir({ telefono: TEL, sesion: sesion({ accion: 'leer' }) });
    expect(lectura.cuerpo['conversacion']).toMatchObject({ version: 1, estado: { paso: 1 } });
    const a = await pedir({ telefono: TEL, sesion: sesion({ accion: 'asentar', idCompromiso: 'compromiso-despacho-1' }) });
    expect(a.codigo).toBe(200);
    expect(a.cuerpo['resultado']).toBe('asentado');
  });

  it('no escriben en `conversaciones/*` ni en `metricas/*` (el conteo facturado)', async () => {
    const antes = [await documentos(`tenants/${TA}/conversaciones`), await documentos(`tenants/${TA}/metricas`)];
    await pedir({ telefono: TEL, sesion: sesion({ accion: 'leer', idMensaje: 'wamid.SINCONTEO1' }) });
    await pedir({ telefono: TEL, sesion: comprometer({ idCompromiso: 'compromiso-conteo-1' }) });
    await pedir({ telefono: TEL, sesion: sesion({ accion: 'asentar', idCompromiso: 'compromiso-conteo-1' }) });
    expect(await escriturasDeTurno(TA)).toBeGreaterThan(0);
    expect([await documentos(`tenants/${TA}/conversaciones`), await documentos(`tenants/${TA}/metricas`)]).toEqual(antes);
  });
});

describe('seguridad', () => {
  it('el token del número A con la cabecera del número B: 401 y nada escrito', async () => {
    const r = await pedir({ telefono: TEL, sesion: comprometer() }, NUMERO_B, TOKEN_A);
    expect(r.codigo).toBe(401);
    expect(await escriturasDeTurno(TA) + await escriturasDeTurno(TB)).toBe(0);
  });

  it('un `tenantId` en el cuerpo se ignora: se escribe en el comercio de la ruta, no en el pedido', async () => {
    const r = await pedir({ telefono: TEL, tenantId: TB, sesion: comprometer() });
    expect(r.cuerpo['resultado']).toBe('comprometido');
    expect(await escriturasDeTurno(TB)).toBe(0);
    expect(await escriturasDeTurno(TA)).toBe(1);
  });

  it('un `tenantId` dentro de `sesion` es forma inválida: 400', async () => {
    const r = await pedir({ telefono: TEL, sesion: comprometer({ tenantId: TB }) });
    expect(r.codigo).toBe(400);
    expect(await escriturasDeTurno(TB) + await escriturasDeTurno(TA)).toBe(0);
  });

  it('un comercio suspendido: 409 en las tres acciones y sin escritura', async () => {
    await db.doc(`tenants/${TA}`).update({ estado: 'suspendido' });
    for (const s of [sesion({ accion: 'leer', idMensaje: 'wamid.SUSPENDIDO1' }), comprometer(), sesion({ accion: 'asentar', idCompromiso: 'compromiso-suspendido' })]) {
      const r = await pedir({ telefono: TEL, sesion: s });
      expect(r.codigo).toBe(409);
      expect(r.cuerpo['conversacion']).toBeUndefined();
    }
    expect(await escriturasDeTurno(TA)).toBe(0);
  });

  it('sin teléfono válido: 400 en las tres acciones', async () => {
    for (const tel of [undefined, '123', 'abcdefghij']) {
      for (const s of [sesion({ accion: 'leer' }), comprometer(), sesion({ accion: 'asentar', idCompromiso: 'compromiso-sin-tel' })]) {
        const r = await pedir({ ...(tel === undefined ? {} : { telefono: tel }), sesion: s });
        expect(r.codigo).toBe(400);
      }
    }
    expect(await escriturasDeTurno(TA)).toBe(0);
  });

  it('una `v` desconocida o ausente: 400', async () => {
    for (const s of [{ ...sesion({ accion: 'leer' }), v: 2 }, { ...comprometer(), v: 0 }, { accion: 'leer', espacio: 'venta', ejecucion: 'ej-x' }]) {
      expect((await pedir({ telefono: TEL, sesion: s })).codigo).toBe(400);
    }
    expect(await escriturasDeTurno(TA)).toBe(0);
  });

  it('una `sesion` que no es un objeto: 400', async () => {
    for (const s of [null, 'leer', 7, []]) {
      expect((await pedir({ telefono: TEL, sesion: s })).codigo).toBe(400);
    }
  });
});

