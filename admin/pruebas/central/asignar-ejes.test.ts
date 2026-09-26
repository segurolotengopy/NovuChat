/**
 * LOS EJES ESCRITOS POR PLATAFORMA Y LEÍDOS POR EL COMERCIO — las callables
 * reales contra el emulador: `asignarEjes` y `ejesDeCuenta`
 * (functions/src/central/ejesDeCuenta.ts) y `asignarNumero` (index.ts), que
 * desde F1 escribe la titularidad del número.
 *
 * Se escribe negando (`Analisis/41` §8.5, H1): un administrador NO escribe
 * los ejes; el propietario sí; un número de OTRO comercio no se toca desde
 * este tenant; un valor fuera de la lista no entra; y el administrador de B
 * no lee los ejes de A.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { limitesDe } from '../../functions/src/planes.ts';
import { MODELO_POR_DEFECTO } from '../../functions/src/central/ejes.ts';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;

const { asignarEjes, ejesDeCuenta, asignarNumero } = await import('../../functions/src/index.ts');
const { getFirestore } = await import('firebase-admin/firestore');
const db = getFirestore();

const A = 'ejes-a';
const B = 'ejes-b';
const NUM_A = '1000000091';
const NUM_A2 = '1000000092';
const NUM_B = '1000000093';
const NUM_NUEVO = '1000000094';
const WABA = '2000000091';

const PROPIETARIO = { uid: 'prop-e', token: { nc: { p: true }, firebase: { sign_in_provider: 'google.com' } } };
const admin = (t: string, uid = `adm-${t}`) => ({
  uid, token: { nc: { t: { [t]: 'admin' } }, firebase: { sign_in_provider: 'password' }, email_verified: true },
});
const oper = (t: string) => ({
  uid: `op-${t}`, token: { nc: { t: { [t]: 'oper' } }, firebase: { sign_in_provider: 'password' }, email_verified: true },
});

type Peticion = Parameters<typeof asignarEjes.run>[0];
const correr = (f: { run: (p: Peticion) => Promise<unknown> }, data: Record<string, unknown>, auth: object | null) =>
  f.run({ data, auth, rawRequest: {} } as unknown as Peticion);
const asignar = (data: Record<string, unknown>, auth: object | null = PROPIETARIO) => correr(asignarEjes, data, auth);
const ejes = (data: Record<string, unknown>, auth: object | null) =>
  correr(ejesDeCuenta, data, auth) as Promise<Record<string, unknown>>;
async function rechaza(p: Promise<unknown>, codigo: string) {
  await expect(p).rejects.toMatchObject({ code: codigo });
}
const ficha = async (t: string) => (await db.doc(`tenants/${t}`).get()).data() ?? {};
const ruta = async (n: string) => (await db.doc(`rutasWhatsApp/${n}`).get()).data() ?? {};
const auditoria = async (t: string, accion: string) =>
  (await db.collection(`tenants/${t}/auditoria`).where('accion', '==', accion).get()).docs.map((d) => d.data());

beforeEach(async () => {
  for (const t of [A, B]) {
    const previas = await db.collection(`tenants/${t}/auditoria`).get();
    for (const d of previas.docs) await d.ref.delete();
  }
  await db.doc(`tenants/${A}`).set({ nombre: 'A', estado: 'activo', plan: 'crecimiento', flujos: ['agendamiento'] });
  await db.doc(`tenants/${A}/cuenta/estado`).set({
    plan: 'crecimiento', limites: limitesDe('crecimiento'), modalidad: 'prepago', periodoPagado: '2099-12',
    cambios: { '2020-01': 1 },
  });
  await db.doc(`tenants/${B}`).set({ nombre: 'B', estado: 'activo', plan: 'impulso', flujos: ['venta'], modelo: 'claude-haiku-4-5' });
  await db.doc(`tenants/${B}/cuenta/estado`).set({ plan: 'impulso', limites: limitesDe('impulso') });
  await db.doc(`rutasWhatsApp/${NUM_A}`).set({ tenantId: A, flujo: 'agendamiento', wabaId: WABA, aliasSecreto: 'cliente30', estado: 'activo' });
  await db.doc(`rutasWhatsApp/${NUM_A2}`).set({ tenantId: A, flujo: 'venta', wabaId: WABA, aliasSecreto: 'cliente31', estado: 'activo', titularidad: 'comercio' });
  await db.doc(`rutasWhatsApp/${NUM_B}`).set({ tenantId: B, flujo: 'venta', wabaId: WABA, aliasSecreto: 'cliente32', estado: 'activo' });
  await db.doc(`rutasWhatsApp/${NUM_NUEVO}`).delete();
});

describe('asignarEjes: quién puede', () => {
  it('el administrador del comercio NO escribe los ejes, ni el operador, ni sin sesión', async () => {
    await rechaza(asignar({ tenantId: A, modelo: 'claude-sonnet-5' }, admin(A)), 'permission-denied');
    await rechaza(asignar({ tenantId: A, titularidad: { phoneNumberId: NUM_A, titularidad: 'comercio' } }, admin(A)), 'permission-denied');
    await rechaza(asignar({ tenantId: A, modelo: 'claude-sonnet-5' }, oper(A)), 'permission-denied');
    await rechaza(asignar({ tenantId: A, modelo: 'claude-sonnet-5' }, null), 'unauthenticated');
    expect((await ficha(A))['modelo']).toBeUndefined();
    expect((await ruta(NUM_A))['titularidad']).toBeUndefined();
    expect(await auditoria(A, 'asignar_ejes')).toHaveLength(0);
  });

  it('el propietario sí: modelo a la ficha y titularidad al número, con auditoría del antes y el después', async () => {
    const r = await asignar({ tenantId: A, modelo: 'claude-haiku-4-5', titularidad: { phoneNumberId: NUM_A, titularidad: 'comercio' } });
    expect(r).toEqual({ ok: true, tenantId: A, modelo: 'claude-haiku-4-5', titularidad: { phoneNumberId: NUM_A, titularidad: 'comercio' } });
    expect((await ficha(A))['modelo']).toBe('claude-haiku-4-5');
    expect(await ruta(NUM_A)).toMatchObject({ titularidad: 'comercio', titularidadPor: 'prop-e', tenantId: A });
    const [a] = await auditoria(A, 'asignar_ejes');
    expect(a).toMatchObject({
      uid: 'prop-e', modeloAntes: MODELO_POR_DEFECTO, modeloDespues: 'claude-haiku-4-5',
      phoneNumberId: NUM_A, titularidadAntes: 'novuchat', titularidadDespues: 'comercio',
    });
    // Solo uno de los dos también vale.
    await asignar({ tenantId: A, modelo: 'gemini-3.5-flash-lite' });
    expect((await ficha(A))['modelo']).toBe('gemini-3.5-flash-lite');
    expect((await ruta(NUM_A))['titularidad']).toBe('comercio');
  });
});

describe('asignarEjes: lo que no entra', () => {
  it('un modelo fuera de la lista, una titularidad fuera de la lista, o nada que asignar', async () => {
    await rechaza(asignar({ tenantId: A, modelo: 'gemini' }), 'invalid-argument');
    await rechaza(asignar({ tenantId: A, modelo: 'gpt-5' }), 'invalid-argument');
    await rechaza(asignar({ tenantId: A, titularidad: { phoneNumberId: NUM_A, titularidad: 'byoc' } }), 'invalid-argument');
    await rechaza(asignar({ tenantId: A, titularidad: 'comercio' }), 'invalid-argument');
    await rechaza(asignar({ tenantId: A, titularidad: { phoneNumberId: 'abc', titularidad: 'comercio' } }), 'invalid-argument');
    await rechaza(asignar({ tenantId: A }), 'invalid-argument');
    await rechaza(asignar({ tenantId: 'Con Espacios', modelo: 'claude-sonnet-5' }), 'invalid-argument');
    expect((await ficha(A))['modelo']).toBeUndefined();
    expect((await ruta(NUM_A))['titularidad']).toBeUndefined();
  });

  it('un número de OTRO comercio no se toca desde este tenant, y uno sin ruta no existe', async () => {
    await rechaza(asignar({ tenantId: A, titularidad: { phoneNumberId: NUM_B, titularidad: 'comercio' } }), 'failed-precondition');
    expect((await ruta(NUM_B))['titularidad']).toBeUndefined();
    await rechaza(asignar({ tenantId: A, titularidad: { phoneNumberId: NUM_NUEVO, titularidad: 'comercio' } }), 'not-found');
    // Y si falla la titularidad, tampoco se escribe el modelo que venía en la misma llamada.
    await rechaza(asignar({ tenantId: A, modelo: 'claude-sonnet-5', titularidad: { phoneNumberId: NUM_B, titularidad: 'comercio' } }), 'failed-precondition');
    expect((await ficha(A))['modelo']).toBeUndefined();
    expect(await auditoria(A, 'asignar_ejes')).toHaveLength(0);
  });

  it('un comercio que no existe, o dado de baja', async () => {
    await rechaza(asignar({ tenantId: 'ejes-no-existe', modelo: 'claude-sonnet-5' }), 'not-found');
    await db.doc(`tenants/${A}`).update({ estado: 'dado_de_baja' });
    await rechaza(asignar({ tenantId: A, modelo: 'claude-sonnet-5' }), 'failed-precondition');
  });
});

describe('asignarNumero escribe la titularidad', () => {
  const alta = (extra: Record<string, unknown>, auth: object | null = PROPIETARIO) =>
    correr(asignarNumero, { tenantId: A, phoneNumberId: NUM_NUEVO, wabaId: WABA, flujo: 'venta', ...extra }, auth);

  it('sin titularidad, el número es de NovuChat; con `comercio`, del comercio; fuera de la lista, no', async () => {
    expect(await alta({})).toMatchObject({ ok: true, titularidad: 'novuchat' });
    expect((await ruta(NUM_NUEVO))['titularidad']).toBe('novuchat');
    expect(await alta({ titularidad: 'comercio' })).toMatchObject({ titularidad: 'comercio' });
    expect((await ruta(NUM_NUEVO))['titularidad']).toBe('comercio');
    await rechaza(alta({ titularidad: 'byoc' }), 'invalid-argument');
    await rechaza(alta({ titularidad: null }), 'invalid-argument');
    expect((await ruta(NUM_NUEVO))['titularidad']).toBe('comercio');
    const [a] = (await auditoria(A, 'asignar_numero')).filter((x) => x['titularidad'] === 'comercio');
    expect(a).toMatchObject({ phoneNumberId: NUM_NUEVO, titularidad: 'comercio' });
  });

  it('el administrador NO asigna números', async () => {
    await rechaza(alta({}, admin(A)), 'permission-denied');
    expect((await db.doc(`rutasWhatsApp/${NUM_NUEVO}`).get()).exists).toBe(false);
  });
});

describe('ejesDeCuenta: lo que lee la consola', () => {
  it('el administrador de A lee los ejes de A: plan, límites, modalidad, modelo, sus números con titularidad y los cambios del mes', async () => {
    const r = await ejes({ tenantId: A }, admin(A));
    expect(r).toMatchObject({
      tenantId: A, plan: 'crecimiento', modalidad: 'prepago', modalidadExplicita: true, modelo: MODELO_POR_DEFECTO,
      limites: { conversaciones: 220, productos: 100, agendas: 5, cambiosIncluidos: 1, origen: 'cuenta' },
      cambios: { usados: 0, incluidos: 1, restantes: 1, ilimitado: false },
    });
    const numeros = (r['numeros'] as Record<string, unknown>[]).sort((x, y) => String(x['phoneNumberId']).localeCompare(String(y['phoneNumberId'])));
    expect(numeros).toEqual([
      { phoneNumberId: NUM_A, flujo: 'agendamiento', estado: 'activo', titularidad: 'novuchat', titularidadExplicita: false },
      { phoneNumberId: NUM_A2, flujo: 'venta', estado: 'activo', titularidad: 'comercio', titularidadExplicita: true },
    ]);
    // El alias del secreto no viaja.
    for (const n of numeros) expect(n).not.toHaveProperty('aliasSecreto');
  });

  it('el administrador de B NO lee los ejes de A; el operador de A tampoco; sin sesión, no', async () => {
    await rechaza(ejes({ tenantId: A }, admin(B)), 'permission-denied');
    await rechaza(ejes({ tenantId: A }, oper(A)), 'permission-denied');
    await rechaza(ejes({ tenantId: A }, null), 'unauthenticated');
    // Un claim de admin con sesión de Google no es un admin (T-19).
    await rechaza(ejes({ tenantId: A }, { uid: 'x', token: { nc: { t: { [A]: 'admin' } }, firebase: { sign_in_provider: 'google.com' }, email_verified: true } }), 'permission-denied');
  });

  it('el propietario lee cualquiera; un demo por ausencia de modalidad se dice así, con cambios ilimitados', async () => {
    const r = await ejes({ tenantId: B }, PROPIETARIO);
    expect(r).toMatchObject({
      plan: 'impulso', modalidad: 'demostracion', modalidadExplicita: false, modelo: 'claude-haiku-4-5',
      cambios: { usados: 0, incluidos: null, restantes: null, ilimitado: true },
    });
    await rechaza(ejes({ tenantId: 'ejes-no-existe' }, PROPIETARIO), 'not-found');
  });
});
