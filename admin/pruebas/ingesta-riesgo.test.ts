/**
 * LA SEÑAL DE CRISIS (`no_contactar` + `riesgo: true`) ESCRIBE `riesgoEn`, NEGANDO.
 *
 * La función `ingesta` real contra el emulador. `riesgoEn` solo debe aparecer con las dos
 * cosas a la vez; cualquier otra forma lo deja ausente. Lo respeta `reclamarRescates`.
 */
import { beforeAll, describe, expect, it } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
const TOKEN = 'valor-de-prueba-del-riesgo';
process.env['INGESTA_CLIENTE19'] = TOKEN;

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore } = await import('firebase-admin/firestore');
const db = getFirestore();
const { ingesta } = await import('../functions/src/ingesta.ts');

const T = 'riesgo-ingesta';
const NUMERO = '1000000089';

async function llamar(cuerpo: Record<string, unknown>): Promise<number> {
  const cabeceras: Record<string, string> = {
    'x-novuchat-numero': NUMERO, authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json',
  };
  const leer = (n: string) => cabeceras[n.toLowerCase()];
  const peticion = {
    method: 'POST', body: cuerpo, rawBody: Buffer.from(JSON.stringify(cuerpo)),
    headers: cabeceras, get: leer, header: leer,
  };
  let codigo = 0;
  const respuesta = {
    status(c: number) { codigo = c; return respuesta; },
    send() { return respuesta; }, json() { return respuesta; },
    setHeader() { return respuesta; }, getHeader() { return undefined; },
    set() { return respuesta; }, on() { return respuesta; }, end() { return respuesta; },
  };
  await (ingesta as unknown as (q: unknown, s: unknown) => Promise<void>)(peticion, respuesta);
  return codigo;
}

let n = 0;
const tel = () => `5917000${String(6000 + ++n).padStart(4, '0')}`;
const conv = async (t: string) => (await db.doc(`tenants/${T}/conversaciones/wa_${t}`).get()).data() as Record<string, unknown>;
const entrante = (t: string, extra: Record<string, unknown>) =>
  llamar({ direccion: 'entrante', tipo: 'text', texto: 'hola', telefono: t, ...extra });

beforeAll(async () => {
  await db.recursiveDelete(db.doc(`tenants/${T}`));
  await db.doc(`rutasWhatsApp/${NUMERO}`).set({ tenantId: T, flujo: 'venta', aliasSecreto: 'cliente19', estado: 'activo' });
  await db.doc(`tenants/${T}`).set({ nombre: 'Riesgo', estado: 'activo', plan: 'basico', flujos: ['venta'], vertical: 'venta', modulos: ['productos', 'pedidos'] });
  await db.doc(`tenants/${T}/cuenta/estado`).set({ plan: 'impulso', estadoPago: 'al_dia' });
}, 120_000);

describe('señal de crisis en la ingesta', () => {
  it('`no_contactar` + `riesgo: true` deja noContactar y riesgoEn', async () => {
    const t = tel();
    expect(await entrante(t, { evento: 'no_contactar', riesgo: true })).toBe(200);
    const c = await conv(t);
    expect(c['noContactar']).toBe(true);
    expect(c['riesgoEn']).toBeDefined();
  });

  it('`no_contactar` sin `riesgo`, `riesgo` sin `no_contactar`, o `riesgo` con otro valor: NO escriben riesgoEn', async () => {
    for (const extra of [
      { evento: 'no_contactar' }, { riesgo: true }, { evento: 'no_contactar', riesgo: 'true' },
      { evento: 'no_contactar', riesgo: 1 }, { evento: 'horarios_ofrecidos', riesgo: true },
    ]) {
      const t = tel();
      expect(await entrante(t, extra)).toBe(200);
      expect((await conv(t))['riesgoEn'], JSON.stringify(extra)).toBeUndefined();
    }
  });

  it('un mensaje posterior sin la señal no borra riesgoEn', async () => {
    const t = tel();
    await entrante(t, { evento: 'no_contactar', riesgo: true });
    await entrante(t, { texto: 'otra cosa' });
    expect((await conv(t))['riesgoEn']).toBeDefined();
  });
});
