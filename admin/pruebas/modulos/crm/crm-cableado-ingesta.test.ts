/**
 * EL CABLEADO DE `config/crm.activo` EN `configuracionFlujo` (PR-B3), contra el emulador de Firestore.
 *
 * `crm.test.ts` prueba la función pura `crmParaElFlujo`. Esta prueba cierra el hueco que señaló la revisión del #763: si alguien
 * quita la lectura de `config/crm` o el `...crmParaElFlujo(...)` de `ingesta.ts`, el interruptor del miniCRM deja de llegar al
 * flujo sin que nada falle, y el comercio creería haber apagado el módulo. Aquí se llama a la Function como lo hace n8n y se mira
 * el cuerpo REAL de la respuesta.
 *
 * Se escribe negando: sin documento o con un `activo` que no es booleano NO sale la clave `crm`; y nunca viajan los campos
 * reservados del servidor (`hoja`, `mapaColumnas`, `cuentaServicio`…).
 */
import { beforeAll, describe, expect, it } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
// Valor de prueba, no un secreto. El alias es el de la ruta (`aliasSecreto`); cada suite corre en su propio proceso.
const TOKEN = 'valor-de-prueba-del-cableado-crm';
process.env['INGESTA_CLIENTE03'] = TOKEN;

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore } = await import('firebase-admin/firestore');
const db = getFirestore();
const { configuracionFlujo } = await import('../../../functions/src/ingesta.ts');

const T = 'crm-cableado';
// Número de prueba con la forma que exige el repositorio público: seis ceros seguidos.
const NUMERO = '1000000097';
const TELEFONO = '59170000005';

/** Llama a `configuracionFlujo` como n8n y devuelve el cuerpo JSON de la respuesta. */
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

const escribirCrm = (datos: Record<string, unknown> | null) =>
  datos === null ? db.doc(`tenants/${T}/config/crm`).delete() : db.doc(`tenants/${T}/config/crm`).set(datos);

beforeAll(async () => {
  await db.doc(`rutasWhatsApp/${NUMERO}`).set({ tenantId: T, flujo: 'agendamiento', aliasSecreto: 'cliente03', estado: 'activo' });
  await db.doc(`tenants/${T}`).set({ nombre: 'Cableado CRM', estado: 'activo', flujos: ['agendamiento'] });
  await db.doc(`tenants/${T}/cuenta/estado`).set({ plan: 'impulso', estadoPago: 'al_dia' });
  await db.doc(`tenants/${T}/config/negocio`).set({ nombreNegocio: 'Cableado CRM', zonaHoraria: 'America/La_Paz', moneda: 'BOB' });
});

describe('configuracionFlujo entrega config/crm.activo (PR-B3)', () => {
  it('sin documento config/crm: la respuesta NO trae la clave `crm` (queda como siempre)', async () => {
    await escribirCrm(null);
    const r = await configuracion();
    expect(r.codigo).toBe(200);
    expect('crm' in r.cuerpo).toBe(false);
  });

  it('con activo:false entrega EXACTAMENTE crm:{activo:false}, sin los campos reservados del servidor', async () => {
    await escribirCrm({ activo: false, hoja: 'Leads_CRM', filaEncabezados: 3, mapaColumnas: { telefono: 'E' }, cuentaServicio: 'cuenta-reservada-del-servidor', moneda: 'BOB' });
    const r = await configuracion();
    expect(r.codigo).toBe(200);
    expect(r.cuerpo['crm']).toEqual({ activo: false });
    expect(JSON.stringify(r.cuerpo)).not.toMatch(/Leads_CRM|mapaColumnas|cuenta-reservada-del-servidor|filaEncabezados/);
  });

  it('con activo:true entrega crm:{activo:true}', async () => {
    await escribirCrm({ activo: true });
    expect((await configuracion()).cuerpo['crm']).toEqual({ activo: true });
  });

  it('NEGADO: un `activo` que no es booleano («false» como texto, número, nulo) NO produce la clave `crm`', async () => {
    for (const malo of ['false', 0, null, []]) {
      await escribirCrm({ activo: malo, hoja: 'Leads_CRM' });
      const r = await configuracion();
      expect(r.codigo, JSON.stringify(malo)).toBe(200);
      expect('crm' in r.cuerpo, JSON.stringify(malo)).toBe(false);
    }
  });

  it('NEGADO: el documento de OTRO comercio no se lee (el tenant sale de la ruta, no del cuerpo)', async () => {
    await escribirCrm(null);
    await db.doc('tenants/otro-comercio-crm/config/crm').set({ activo: false });
    const r = await configuracion();
    expect('crm' in r.cuerpo).toBe(false);
  });
});
