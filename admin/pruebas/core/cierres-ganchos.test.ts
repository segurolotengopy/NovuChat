/**
 * `registrarCierre` CON GANCHOS FALSOS, contra el emulador (F3b-1b).
 *
 * Qué defiende: que el recorrido de Core es el de siempre sin saber nada de
 * Agenda ni de Cobros. Los ganchos de esta suite son falsos y anotan cada
 * llamada, así que se ve EN QUÉ ORDEN y CON QUÉ se los llama, y qué escribe Core
 * con lo que devuelven:
 *
 *  - regla 1 (el predicado da falso): ni se lee `config/venta` ni se llama a
 *    `cobroRealActivo` —cero lecturas extra por cierre— y el cierre suma;
 *  - un reintento de n8n responde `repetido` sin llamar a ningún gancho;
 *  - cobro real y venta que cierra el cotejo: 409 sin una sola escritura;
 *  - el mismo caso con una cita: 200, y la solicitud recibe `cobroReal: true`;
 *  - una venta sin teléfono con cobro real: 400 con el lector de FUERA de la
 *    transacción, antes de escribir nada;
 *  - sin conversación no se llama ni al predicado ni a la solicitud;
 *  - ATOMICIDAD: si la solicitud lanza, no queda cierre, ni `privado`, ni cambio
 *    en `metricas` (la transacción entera se deshace);
 *  - los ganchos se capturan al crear el endpoint: mutar el objeto después no
 *    cambia nada.
 *
 * Los ganchos no reciben la `Transaction` ni `db`: reciben un lector y devuelven
 * decisiones; lo que escribe es Core. Los teléfonos llevan seis ceros seguidos
 * (los que admite el saneo del repositorio público).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
// Valor de prueba, no un secreto.
const TOKEN = 'valor-de-prueba-de-los-ganchos-del-cierre';
process.env['INGESTA_CLIENTE11'] = TOKEN;

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore } = await import('firebase-admin/firestore');
const db = getFirestore();
const { crearRegistrarCierre } = await import('../../functions/src/core/turno/cierres.ts');
type Ganchos = Parameters<typeof crearRegistrarCierre>[0];

const T = 'cierres-ganchos';
const NUMERO = '1000000121';
const MES = new Date().toISOString().slice(0, 7);
const TEL = '59170000009';
const SOLICITUD_PREVIA = { etapa: 'qr_enviado', cotejos: 0, marca: 'previa' };

interface Respuesta { codigo: number; cuerpo: unknown }

async function llamar(fn: unknown, cuerpo: Record<string, unknown>): Promise<Respuesta> {
  const cabeceras: Record<string, string> = {
    'x-novuchat-numero': NUMERO, authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json',
  };
  const leer = (n: string) => cabeceras[n.toLowerCase()];
  const peticion = {
    method: 'POST', body: cuerpo, rawBody: Buffer.from(JSON.stringify(cuerpo)),
    headers: cabeceras, get: leer, header: leer,
  };
  const r: Respuesta = { codigo: 0, cuerpo: null };
  const respuesta = {
    status(c: number) { r.codigo = c; return respuesta; },
    send(b: unknown) { r.cuerpo = b; return respuesta; },
    json(b: unknown) { r.cuerpo = b; return respuesta; },
    setHeader() { return respuesta; }, getHeader() { return undefined; },
    set() { return respuesta; }, on() { return respuesta; }, end() { return respuesta; },
  };
  await (fn as (q: unknown, s: unknown) => Promise<void>)(peticion, respuesta);
  return r;
}

// ---------------------------------------------------------------------------
// Los ganchos falsos: anotan llamadas, y lo que devuelven lo fija cada prueba.
// ---------------------------------------------------------------------------

const llamadas: string[] = [];
// `enTransaccion`: por cada llamada a `cobroRealActivo`, si el lector que recibió leyó POR la transacción
// (`t.get`) o por `db` directo. Es lo que distingue el lector de DENTRO de la transacción del de FUERA (ver `beforeAll`).
const argumentos: { previa: unknown[]; datos: unknown[]; rutasLeidas: string[]; enTransaccion: boolean[] } = {
  previa: [], datos: [], rutasLeidas: [], enTransaccion: [],
};
let lecturasPorTransaccion = 0;
const decide = { cotejo: false, cobroReal: false, solicitud: { etapa: 'agendada', marcaDelGancho: 'si' } as object | null, lanza: false };

const ganchos: Ganchos = {
  cobro: {
    async cobroRealActivo(leer) {
      llamadas.push('cobroRealActivo');
      // Lee de verdad por el lector (una lectura): lo que Core le pasa tiene que funcionar.
      const antes = lecturasPorTransaccion;
      const doc = await leer('config/venta');
      argumentos.enTransaccion.push(lecturasPorTransaccion > antes);
      argumentos.rutasLeidas.push(doc.ref.path);
      return decide.cobroReal;
    },
    cierreDeVentaLoHaceElCotejo(previa) {
      llamadas.push('cotejo');
      argumentos.previa.push(previa);
      return decide.cotejo;
    },
  },
  solicitud: {
    solicitudTrasElCierre(previa, _ahoraMs, datos) {
      llamadas.push(`solicitud:${datos.cobroReal}`);
      argumentos.datos.push(datos);
      if (decide.lanza) throw new Error('el gancho de solicitud falló');
      return decide.solicitud;
    },
  },
};

// Un endpoint por suite (se arma una vez); las pruebas cambian `decide`.
const registrarCierre = crearRegistrarCierre(ganchos);

const conversacion = async () => (await db.doc(`tenants/${T}/conversaciones/wa_${TEL}`).get()).data();
const metricas = async () => (await db.doc(`tenants/${T}/metricas/${MES}`).get()).data() ?? {};
const cierre = async (id: string) => (await db.doc(`tenants/${T}/cierres/${id}`).get());
const privado = async (id: string) => (await db.doc(`tenants/${T}/cierres/${id}/privado/datos`).get());

async function borrarTodo(): Promise<void> {
  for (const c of ['conversaciones', 'cierres']) {
    for (const d of (await db.collection(`tenants/${T}/${c}`).get()).docs) {
      for (const p of (await d.ref.collection('privado').get()).docs) await p.ref.delete();
      await d.ref.delete();
    }
  }
  await db.doc(`tenants/${T}/metricas/${MES}`).delete();
}

beforeAll(async () => {
  // Envuelve la transacción para contar sus `get`: así la prueba ve si el gancho leyó por la transacción o por `db`.
  const original = db.runTransaction.bind(db) as (f: (t: object) => Promise<unknown>, o?: unknown) => Promise<unknown>;
  vi.spyOn(db, 'runTransaction').mockImplementation(((f: (t: object) => Promise<unknown>, o?: unknown) =>
    original((t) => f(new Proxy(t, {
      get(objeto, propiedad) {
        const valor = Reflect.get(objeto, propiedad) as unknown;
        if (typeof valor !== 'function') return valor;
        return propiedad === 'get'
          ? (...a: unknown[]) => { lecturasPorTransaccion += 1; return (valor as (...x: unknown[]) => unknown).apply(objeto, a); }
          : (valor as (...x: unknown[]) => unknown).bind(objeto);
      },
    })), o)) as never);
  await db.doc(`rutasWhatsApp/${NUMERO}`).set({
    tenantId: T, flujo: 'agenda', aliasSecreto: 'cliente11', estado: 'activo',
  });
  await db.doc(`tenants/${T}`).set({ nombre: 'Tienda', estado: 'activo', flujos: ['agenda'] });
  await db.doc(`tenants/${T}/config/venta`).set({ costoDelivery: 7 });
}, 120_000);

beforeEach(async () => {
  await borrarTodo();
  llamadas.length = 0;
  argumentos.previa.length = 0; argumentos.datos.length = 0; argumentos.rutasLeidas.length = 0; argumentos.enTransaccion.length = 0;
  decide.cotejo = false; decide.cobroReal = false; decide.lanza = false;
  decide.solicitud = { etapa: 'agendada', marcaDelGancho: 'si' };
  await db.doc(`tenants/${T}/conversaciones/wa_${TEL}`).set({ solicitud: SOLICITUD_PREVIA, marcaPropia: 1 });
});

const cita = (referencia: string, extra: Record<string, unknown> = {}) =>
  llamar(registrarCierre, { tipo: 'cita', referencia, telefono: TEL, ...extra });
const venta = (referencia: string, extra: Record<string, unknown> = {}) =>
  llamar(registrarCierre, { tipo: 'venta', referencia, telefono: TEL, monto: 50, ...extra });

describe('Core recorre los ganchos sin saber de módulos', () => {
  it('regla 1 (el predicado da falso): ni se llama a cobroRealActivo, el cierre suma y la solicitud se escribe tal cual la devolvió el gancho', async () => {
    const r = await cita('ev-1', { detalle: 'limpieza', nombreCliente: 'Ana' });
    expect(r).toEqual({ codigo: 200, cuerpo: { registrado: true, repetido: false, id: 'cita_ev-1' } });
    expect(llamadas).toEqual(['cotejo', 'solicitud:false']);
    expect(argumentos.previa[0]).toMatchObject({ etapa: 'qr_enviado', marca: 'previa' });
    expect(argumentos.datos[0]).toEqual({ cobroReal: false });
    expect((await metricas())['cierres']).toBe(1);
    expect((await cierre('cita_ev-1')).exists).toBe(true);
    expect((await privado('cita_ev-1')).data()).toMatchObject({ telefono: TEL, conversacionId: `wa_${TEL}`, detalle: 'limpieza' });
    const c = await conversacion();
    // merge: lo que escribió el gancho se funde sobre la solicitud, y lo demás sigue.
    expect(c?.['solicitud']).toMatchObject({ etapa: 'agendada', marcaDelGancho: 'si', cotejos: 0 });
    expect(c?.['marcaPropia']).toBe(1);
  });

  it('un gancho de solicitud que devuelve null no toca la solicitud, pero el cierre se cuenta igual', async () => {
    decide.solicitud = null;
    const r = await cita('ev-2');
    expect(r.codigo).toBe(200);
    expect(llamadas).toEqual(['cotejo', 'solicitud:false']);
    expect((await conversacion())?.['solicitud']).toEqual(SOLICITUD_PREVIA);
    expect((await metricas())['cierres']).toBe(1);
  });

  it('un reintento de n8n responde `repetido` y NO llama a ningún gancho ni suma de nuevo', async () => {
    await cita('ev-3');
    llamadas.length = 0;
    const r = await cita('ev-3');
    expect(r).toEqual({ codigo: 200, cuerpo: { registrado: false, repetido: true, id: 'cita_ev-3' } });
    expect(llamadas).toEqual([]);
    expect((await metricas())['cierres']).toBe(1);
  });

  it('venta con el predicado verdadero y cobro real: 409 sin una sola escritura', async () => {
    decide.cotejo = true; decide.cobroReal = true;
    const r = await venta('v-1');
    expect(r).toEqual({ codigo: 409, cuerpo: { error: 'cobro_real_lo_cierra_el_cotejo' } });
    expect(llamadas).toEqual(['cotejo', 'cobroRealActivo']);
    expect(argumentos.enTransaccion, 'con teléfono, el lector es el de DENTRO de la transacción').toEqual([true]);
    expect((await cierre('venta_v-1')).exists).toBe(false);
    expect((await privado('venta_v-1')).exists).toBe(false);
    expect((await metricas())['cierres']).toBeUndefined();
    expect((await conversacion())?.['solicitud']).toEqual(SOLICITUD_PREVIA);
  });

  it('el lector que recibe el gancho lee de verdad `config/venta` DEL TENANT de la firma', async () => {
    decide.cotejo = true;
    await venta('v-2');
    expect(argumentos.rutasLeidas).toEqual([`tenants/${T}/config/venta`]);
  });

  it('cita con el predicado verdadero y cobro real: 200 y la solicitud recibe cobroReal: true', async () => {
    decide.cotejo = true; decide.cobroReal = true;
    const r = await cita('ev-4');
    expect(r.codigo).toBe(200);
    expect(llamadas).toEqual(['cotejo', 'cobroRealActivo', 'solicitud:true']);
    expect(argumentos.enTransaccion).toEqual([true]);
    expect(argumentos.datos[0]).toEqual({ cobroReal: true });
    expect((await metricas())['cierres']).toBe(1);
  });

  it('venta con el predicado verdadero pero SIN cobro real (modo simulado): 200, y la solicitud recibe cobroReal: false', async () => {
    decide.cotejo = true; decide.cobroReal = false;
    const r = await venta('v-3');
    expect(r.codigo).toBe(200);
    expect(llamadas).toEqual(['cotejo', 'cobroRealActivo', 'solicitud:false']);
    expect((await cierre('venta_v-3')).exists).toBe(true);
    expect((await metricas())['cierres']).toBe(1);
  });

  it('venta sin teléfono con cobro real: 400 con el lector de FUERA de la transacción, y nada se escribe', async () => {
    decide.cobroReal = true;
    const r = await llamar(registrarCierre, { tipo: 'venta', referencia: 'v-4', monto: 50 });
    expect(r.codigo).toBe(400);
    expect(r.cuerpo).toMatchObject({ error: 'falta_telefono' });
    expect(llamadas).toEqual(['cobroRealActivo']);
    expect(argumentos.enTransaccion, 'sin teléfono, el lector es el de FUERA de la transacción').toEqual([false]);
    expect((await cierre('venta_v-4')).exists).toBe(false);
    expect((await metricas())['cierres']).toBeUndefined();
  });

  it('venta sin teléfono SIN cobro real: 200, y no se llama ni al predicado ni a la solicitud', async () => {
    decide.cobroReal = false;
    const r = await llamar(registrarCierre, { tipo: 'venta', referencia: 'v-5', monto: 50 });
    expect(r.codigo).toBe(200);
    expect(llamadas).toEqual(['cobroRealActivo']);
    expect((await cierre('venta_v-5')).exists).toBe(true);
    expect((await metricas())['cierres']).toBe(1);
  });

  it('un cierre de tipo registro (sin conversación) no llama a ningún gancho', async () => {
    const r = await llamar(registrarCierre, { tipo: 'registro', referencia: 'fila-9', telefono: TEL });
    expect(r.codigo).toBe(200);
    expect(llamadas).toEqual([]);
  });

  it('conversación inexistente: no se llama ni al predicado ni a la solicitud, y el cierre se cuenta', async () => {
    await db.doc(`tenants/${T}/conversaciones/wa_${TEL}`).delete();
    const r = await cita('ev-5');
    expect(r.codigo).toBe(200);
    expect(llamadas).toEqual([]);
    expect((await cierre('cita_ev-5')).exists).toBe(true);
    expect((await metricas())['cierres']).toBe(1);
    // y no se crea una conversación de la nada
    expect(await conversacion()).toBeUndefined();
  });

  it('ATOMICIDAD: si solicitudTrasElCierre lanza, no queda cierre, ni `privado`, ni cambio en `metricas`', async () => {
    decide.lanza = true;
    const r = await cita('ev-6', { detalle: 'no debe quedar' }).then((x) => x, (e: unknown) => e);
    expect(r).toBeInstanceOf(Error);
    expect(llamadas).toContain('solicitud:false');
    expect((await cierre('cita_ev-6')).exists).toBe(false);
    expect((await privado('cita_ev-6')).exists).toBe(false);
    expect((await metricas())['cierres']).toBeUndefined();
    expect((await conversacion())?.['solicitud']).toEqual(SOLICITUD_PREVIA);
  });

  it('los ganchos se CAPTURAN al crear el endpoint: mutar el objeto después no cambia nada', async () => {
    const propios = {
      cobro: {
        cobroRealActivo: async () => false,
        cierreDeVentaLoHaceElCotejo: () => false,
      },
      solicitud: { solicitudTrasElCierre: () => ({ etapa: 'agendada', marcaDelGancho: 'original' }) },
    };
    const endpoint = crearRegistrarCierre(propios);
    // Alguien reemplaza los ganchos con otros que lanzan, ya con el endpoint creado.
    const boom = () => { throw new Error('el gancho mutado NO debía llamarse'); };
    (propios.solicitud as Record<string, unknown>)['solicitudTrasElCierre'] = boom;
    (propios.cobro as Record<string, unknown>)['cierreDeVentaLoHaceElCotejo'] = boom;
    (propios as Record<string, unknown>)['solicitud'] = { solicitudTrasElCierre: boom };
    const r = await llamar(endpoint, { tipo: 'cita', referencia: 'ev-7', telefono: TEL });
    expect(r.codigo).toBe(200);
    expect((await conversacion())?.['solicitud']).toMatchObject({ marcaDelGancho: 'original' });
  });

  it('el contrato de entrada no cambia: 400 sin referencia y 400 con tipo inválido, sin llamar a ningún gancho', async () => {
    expect((await llamar(registrarCierre, { tipo: 'cita', telefono: TEL })).codigo).toBe(400);
    expect((await llamar(registrarCierre, { tipo: 'otro', referencia: 'x' })).codigo).toBe(400);
    expect(llamadas).toEqual([]);
  });
});
