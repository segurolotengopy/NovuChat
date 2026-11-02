/**
 * =============================================================================
 * BLOQUEAR CONTACTO, REVERSIÓN HACIA ADELANTE: el asistente vuelve a responder
 * =============================================================================
 *
 * Esta suite vive SOLO en la rama `core/bloquear-reversion` (nunca se fusiona con el bloqueo
 * activo en main a la vez). Dice LO CONTRARIO de `bloquear-contacto-ingesta.test.ts`,
 * `bloquear-contacto.test.ts` (en lo que toca a la compuerta) y `seguimientos-bloqueo.test.ts`, que
 * FALLAN en esta rama a propósito: es lo esperado, no una regresión.
 *
 *  1. Con `bloqueada === true` la ingesta y `configuracionFlujo` responden como a un contacto normal:
 *     sin `bloqueadoPorContacto`, y el entrante se cuenta.
 *  2. Los exports `bloquearContacto` y `desbloquearContacto` SIGUEN (firebase-tools se niega a borrar
 *     una Function que está en la nube y no en el código).
 *  3. El filtro de seguimientos de #728 vuelve a su estado previo: ya no mira `bloqueada`.
 *
 * Puerto del emulador: 8191 por convención.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8191'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
const TOKEN = 'valor-de-prueba-bloqueo-reversion';
process.env['INGESTA_CLIENTE05'] = TOKEN;

const indice = await import('../../functions/src/index.ts');
const { ingesta, configuracionFlujo } = indice;
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
const db = getFirestore();

const C = { id: 'bloqueo-rev-a', numero: '1000000941', alias: 'cliente05' };
const TEL = '59100000041';
interface Respuesta { codigo: number; cuerpo: Record<string, unknown> }

async function llamar(funcion: unknown, cuerpo: Record<string, unknown>): Promise<Respuesta> {
  const cab: Record<string, string> = {
    'x-novuchat-numero': C.numero, authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json',
  };
  const leer = (n: string) => cab[n.toLowerCase()];
  const peticion = { method: 'POST', body: cuerpo, rawBody: Buffer.from(JSON.stringify(cuerpo)), headers: cab, get: leer, header: leer };
  const r: Respuesta = { codigo: 0, cuerpo: {} };
  const respuesta = {
    status(cod: number) { r.codigo = cod; return respuesta; },
    send(b: unknown) { r.cuerpo = { texto: b }; return respuesta; },
    json(b: unknown) { r.cuerpo = b as Record<string, unknown>; return respuesta; },
    setHeader() { return respuesta; }, getHeader() { return undefined; }, set() { return respuesta; },
    on() { return respuesta; }, end() { return respuesta; },
  };
  await (funcion as (q: unknown, s: unknown) => Promise<void>)(peticion, respuesta);
  return r;
}
const ref = () => db.doc(`tenants/${C.id}/conversaciones/wa_${TEL}`);

async function limpiar() {
  for (const col of ['auditoria', 'bitacora', 'metricas']) {
    for (const d of (await db.collection(`tenants/${C.id}/${col}`).get()).docs) await d.ref.delete();
  }
  for (const d of (await db.collection(`tenants/${C.id}/conversaciones`).get()).docs) {
    for (const m of (await d.ref.collection('mensajes').get()).docs) await m.ref.delete();
    await d.ref.delete();
  }
}

beforeAll(async () => {
  await limpiar();
  await db.doc(`rutasWhatsApp/${C.numero}`).set({ tenantId: C.id, flujo: 'agendamiento', aliasSecreto: C.alias, estado: 'activo' });
  await db.doc(`tenants/${C.id}`).set({ nombre: 'Comercio reversion', estado: 'activo', plan: 'pro' });
  await db.doc(`tenants/${C.id}/cuenta/estado`).set({ plan: 'pro', estadoPago: 'al_dia' });
}, 120_000);
afterAll(async () => {
  vi.restoreAllMocks();
  await limpiar();
  await db.doc(`rutasWhatsApp/${C.numero}`).delete();
});

describe('con un contacto marcado como bloqueado, el asistente responde', () => {
  it('la ingesta y configuracionFlujo no lo tratan como bloqueado y el entrante se cuenta', async () => {
    await llamar(ingesta, { telefono: TEL, direccion: 'entrante', tipo: 'text', texto: 'hola' });
    await ref().update({ bloqueada: true, bloqueadaPor: 'u-admin', bloqueadaEn: Timestamp.now() });
    const antes = ((await ref().get()).data() ?? {})['mensajesTotal'] as number;

    const r = await llamar(ingesta, { telefono: TEL, direccion: 'entrante', tipo: 'text', texto: 'quiero reservar' });
    expect(r.codigo).toBe(200);
    expect((r.cuerpo['atencion'] as Record<string, unknown>)['estado']).toBe('normal');
    expect(r.cuerpo['bloqueadoPorContacto']).toBeUndefined();
    expect(r.cuerpo['pausadoPorPersona']).toBeUndefined();
    expect(((await ref().get()).data() ?? {})['mensajesTotal']).toBe(antes + 1);

    const c = await llamar(configuracionFlujo, { telefono: TEL });
    const a = (c.cuerpo['atencion'] ?? c.cuerpo) as Record<string, unknown>;
    expect(a['estado']).toBe('normal');
    expect(a['bloqueadoPorContacto']).toBeUndefined();
  });
});

describe('los exports se conservan y el filtro de seguimientos vuelve a su estado previo', () => {
  it('bloquearContacto y desbloquearContacto siguen exportadas por index.ts', () => {
    expect(indice['bloquearContacto']).toBeDefined();
    expect(indice['desbloquearContacto']).toBeDefined();
  });

  it('ingesta.ts y seguimientos.ts ya no consultan `estaBloqueada`', () => {
    const src = join(dirname(fileURLToPath(import.meta.url)), '../../functions/src');
    for (const f of ['ingesta.ts', 'modulos/agenda/seguimientos.ts']) {
      expect(readFileSync(join(src, f), 'utf8'), f).not.toMatch(/estaBloqueada/);
    }
    expect(readFileSync(join(src, 'modulos/agenda/seguimientos.ts'), 'utf8')).not.toMatch(/bloqueada/);
  });
});
