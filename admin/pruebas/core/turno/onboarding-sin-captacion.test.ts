/**
 * PRUEBA NEGATIVA DEL COORDINADOR (F3b-2b, revisión de seguridad de #712).
 *
 * Un número de captación (`onboarding`) cuya ficha trae `modulos` SIN `captacion`
 * no recibe la clave `onboarding`, y el documento nunca sale crudo por la rama
 * genérica de `configuracionFlujo` (que excluye `docVertical === 'onboarding'`).
 * El documento trae un `cobroReal` y un campo ajeno a propósito: si alguien quita
 * la exclusión, el documento viaja por la rama genérica y esta prueba falla.
 * Datos de prueba, sin secretos ni números reales.
 */
import { beforeAll, describe, expect, it } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
const TOKEN = 'valor-de-prueba-onboarding-sin-captacion';
process.env['INGESTA_CLIENTE18'] = TOKEN;

const { configuracionFlujo } = await import('../../../functions/src/index.ts');
const { getFirestore } = await import('firebase-admin/firestore');
const db = getFirestore();

const NUMERO = '900021';
const TENANT = 'onboarding-sin-captacion';

async function llamar(): Promise<{ codigo: number; cuerpo: Record<string, unknown> }> {
  const cabeceras: Record<string, string> = {
    'x-novuchat-numero': NUMERO, authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json',
  };
  const leer = (n: string): string | undefined => cabeceras[n.toLowerCase()];
  const cuerpo = {};
  const peticion = {
    method: 'POST', body: cuerpo, rawBody: Buffer.from(JSON.stringify(cuerpo)),
    headers: cabeceras, get: leer, header: leer,
  };
  const r: { codigo: number; cuerpo: Record<string, unknown> } = { codigo: 0, cuerpo: {} };
  const respuesta = {
    status(c: number) { r.codigo = c; return respuesta; },
    send(b: unknown) { r.cuerpo = b as Record<string, unknown>; return respuesta; },
    json(b: unknown) { r.cuerpo = b as Record<string, unknown>; return respuesta; },
    setHeader() { return respuesta; }, getHeader() { return undefined; },
    set() { return respuesta; }, on() { return respuesta; }, end() { return respuesta; },
  };
  await (configuracionFlujo as unknown as (q: unknown, s: unknown) => Promise<void>)(peticion, respuesta);
  return r;
}

beforeAll(async () => {
  for (const c of ['catalogo', 'config', 'cuenta', 'metricas', 'funcionarios', 'conversaciones']) {
    for (const d of (await db.collection(`tenants/${TENANT}/${c}`).get()).docs) await d.ref.delete();
  }
  await db.doc(`rutasWhatsApp/${NUMERO}`).set({
    tenantId: TENANT, flujo: 'onboarding', aliasSecreto: 'cliente18', estado: 'activo',
  });
  await db.doc(`tenants/${TENANT}`).set({
    nombre: TENANT, estado: 'activo', flujos: ['onboarding'], modulos: ['productos', 'campanas'],
  });
  await db.doc(`tenants/${TENANT}/cuenta/estado`).set({ plan: 'impulso', estadoPago: 'al_dia' });
  await db.doc(`tenants/${TENANT}/config/negocio`).set({
    nombreNegocio: 'Negocio de prueba', zonaHoraria: 'America/La_Paz', moneda: 'BOB',
  });
  await db.doc(`tenants/${TENANT}/config/onboarding`).set({
    rubros: [{ id: 'r1', nombre: 'Rubro uno' }],
    campoAjeno: 'valor-ajeno',
    cobroReal: { activo: true, cargaUtil: 'carga-de-prueba', ficha: 'ficha-de-prueba-0001' },
  });
}, 120_000);

describe('configuracionFlujo: onboarding con una ficha sin el módulo captacion', () => {
  it('no devuelve `onboarding` ni `cobroReal`, ni el documento crudo por la rama genérica', async () => {
    const r = await llamar();
    expect(r.codigo).toBe(200);
    expect('onboarding' in r.cuerpo).toBe(false);
    expect('cobroReal' in r.cuerpo).toBe(false);
    const texto = JSON.stringify(r.cuerpo);
    expect(texto).not.toContain('valor-ajeno');
    expect(texto).not.toContain('carga-de-prueba');
  });
});
