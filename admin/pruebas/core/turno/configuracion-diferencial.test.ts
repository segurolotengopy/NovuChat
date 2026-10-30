/**
 * RED DIFERENCIAL DE `configuracionFlujo` (F3b-2a, Analisis/41 §7 F3b).
 *
 * POR QUE EXISTE. F3b-2b..2e cortan `ingesta.ts` en ganchos por modulo, y la
 * promesa es «sin cambiar logica»: la respuesta que recibe n8n tiene que ser la
 * MISMA para cada forma de ficha. Esta suite fija siete fichas y compara lo que
 * devuelve `configuracionFlujo` con una respuesta de referencia generada
 * corriendo el codigo ANTERIOR al corte (`referencias/*.json`).
 *
 * Una referencia que cambia SOLO se acepta regenerandola a proposito
 * (`ACTUALIZAR_REFERENCIAS=1`) y explicando el porque en el PR: es un cambio de
 * contrato con el flujo de todos los clientes.
 *
 * Sin telefono en la peticion: la respuesta no depende del reloj. Los datos
 * son de prueba (sin secretos ni numeros reales).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
const TOKEN = 'valor-de-prueba-de-la-red-diferencial';
process.env['INGESTA_CLIENTE18'] = TOKEN;

// Por index.ts, como el resto de las pruebas de Core (una prueba de Core no importa el coordinador a mano).
// index.ts inicializa la app por defecto al cargarse, como en producción.
const { configuracionFlujo } = await import('../../../functions/src/index.ts');
const { getFirestore } = await import('firebase-admin/firestore');
const db = getFirestore();

const AQUI = dirname(fileURLToPath(import.meta.url));
const ACTUALIZAR = process.env['ACTUALIZAR_REFERENCIAS'] === '1';

const COBRO_REAL = {
  activo: true, cargaUtil: 'carga-de-prueba', ficha: 'ficha-de-prueba-0001',
  nombreCuenta: 'Titular de Prueba', banco: 'Banco de Prueba', cuentas: ['0001'], venceEl: '2099-12-31',
};
const CAMPANA = {
  id: 'c1', texto: 'Promo de prueba', inicio: '2020-01-01', fin: '2099-12-31', estado: 'aprobada',
};

interface Ficha {
  nombre: string;
  numero: string;
  flujo: string;
  tenant: Record<string, unknown>;
  docs: Record<string, Record<string, unknown>>;
}

const FICHAS: Ficha[] = [
  {
    nombre: 'agendamiento-sin-sena', numero: '900001', flujo: 'agendamiento',
    tenant: { flujos: ['agendamiento'] },
    docs: { 'config/agendamiento': { duracionCita: 30 } },
  },
  {
    nombre: 'agendamiento-con-sena', numero: '900002', flujo: 'agendamiento',
    tenant: { flujos: ['agendamiento'] },
    docs: { 'config/agendamiento': { senaImporte: 50, senaMinutosRetencion: 45, cobroReal: COBRO_REAL } },
  },
  {
    nombre: 'venta-cobro-real', numero: '900003', flujo: 'venta',
    tenant: { flujos: ['venta'] },
    docs: {
      'config/venta': { cobroReal: COBRO_REAL, envio: true },
      'catalogo/p1': { nombre: 'Producto uno', precio: 10, activo: true, stock: 0 },
      'catalogo/p2': { nombre: 'Producto dos', precio: 20, activo: true },
    },
  },
  {
    nombre: 'venta-cobro-simulado', numero: '900004', flujo: 'venta',
    tenant: { flujos: ['venta'] },
    docs: {
      'config/venta': { mediaIdQr: 'media-de-prueba' },
      'catalogo/p1': { nombre: 'Producto uno', precio: 10, activo: true },
    },
  },
  {
    nombre: 'onboarding', numero: '900005', flujo: 'onboarding',
    tenant: { flujos: ['onboarding'] },
    docs: { 'config/onboarding': { rubros: [{ id: 'r1', nombre: 'Rubro uno' }] } },
  },
  {
    nombre: 'varios-flujos-ruta-venta', numero: '900006', flujo: 'venta',
    tenant: { flujos: ['agendamiento', 'venta'] },
    docs: {
      'config/venta': { cobroReal: COBRO_REAL },
      'config/agendamiento': { senaImporte: 30, cobroReal: COBRO_REAL },
      'catalogo/p1': { nombre: 'Producto uno', precio: 10, activo: true },
      'config/campanas': { vigentes: [CAMPANA] },
    },
  },
  {
    nombre: 'ficha-con-modulos', numero: '900007', flujo: 'agendamiento',
    tenant: { flujos: ['agendamiento'], modulos: ['productos', 'cobros', 'agenda', 'campanas'] },
    docs: {
      'config/agendamiento': { senaImporte: 50, cobroReal: COBRO_REAL },
      'config/campanas': { vigentes: [CAMPANA] },
    },
  },
];

const tenantDe = (f: Ficha): string => `diferencial-${f.nombre}`;

async function llamar(numero: string): Promise<{ codigo: number; cuerpo: unknown }> {
  const cabeceras: Record<string, string> = {
    'x-novuchat-numero': numero, authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json',
  };
  const leer = (n: string): string | undefined => cabeceras[n.toLowerCase()];
  const cuerpo = {};
  const peticion = {
    method: 'POST', body: cuerpo, rawBody: Buffer.from(JSON.stringify(cuerpo)),
    headers: cabeceras, get: leer, header: leer,
  };
  const r: { codigo: number; cuerpo: unknown } = { codigo: 0, cuerpo: null };
  const respuesta = {
    status(c: number) { r.codigo = c; return respuesta; },
    send(b: unknown) { r.cuerpo = b; return respuesta; },
    json(b: unknown) { r.cuerpo = b; return respuesta; },
    setHeader() { return respuesta; }, getHeader() { return undefined; },
    set() { return respuesta; }, on() { return respuesta; }, end() { return respuesta; },
  };
  await (configuracionFlujo as unknown as (q: unknown, s: unknown) => Promise<void>)(peticion, respuesta);
  return r;
}

async function vaciar(tenantId: string): Promise<void> {
  for (const c of ['catalogo', 'config', 'cuenta', 'metricas', 'funcionarios', 'conversaciones']) {
    for (const d of (await db.collection(`tenants/${tenantId}/${c}`).get()).docs) await d.ref.delete();
  }
}

beforeAll(async () => {
  for (const f of FICHAS) {
    const t = tenantDe(f);
    await vaciar(t);
    await db.doc(`rutasWhatsApp/${f.numero}`).set({
      tenantId: t, flujo: f.flujo, aliasSecreto: 'cliente18', estado: 'activo',
    });
    await db.doc(`tenants/${t}`).set({ nombre: f.nombre, estado: 'activo', ...f.tenant });
    await db.doc(`tenants/${t}/cuenta/estado`).set({ plan: 'impulso', estadoPago: 'al_dia' });
    await db.doc(`tenants/${t}/config/negocio`).set({
      nombreNegocio: `Negocio ${f.nombre}`, zonaHoraria: 'America/La_Paz', moneda: 'BOB',
    });
    for (const [ruta, datos] of Object.entries(f.docs)) await db.doc(`tenants/${t}/${ruta}`).set(datos);
  }
  await db.doc('plataforma/cobroSimulado').delete();
}, 120_000);

describe('configuracionFlujo: la respuesta no varia con el corte en ganchos', () => {
  for (const f of FICHAS) {
    it(`ficha «${f.nombre}»: igual a la referencia`, async () => {
      const r = await llamar(f.numero);
      expect(r.codigo).toBe(200);
      // Pasa por JSON para comparar lo que de verdad viaja por el cable (sin `undefined`).
      const obtenida = JSON.parse(JSON.stringify(r.cuerpo));
      const archivo = join(AQUI, 'referencias', `${f.nombre}.json`);
      if (ACTUALIZAR) writeFileSync(archivo, `${JSON.stringify(obtenida, null, 2)}\n`);
      expect(obtenida).toEqual(JSON.parse(readFileSync(archivo, 'utf8')));
    });
  }

  it('las referencias distinguen las fichas (no son todas la misma respuesta)', () => {
    const distintas = new Set(FICHAS.map((f) =>
      readFileSync(join(AQUI, 'referencias', `${f.nombre}.json`), 'utf8')));
    expect(distintas.size).toBe(FICHAS.length);
  });
});
