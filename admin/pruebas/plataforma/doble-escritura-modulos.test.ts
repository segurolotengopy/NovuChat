/**
 * H2b-7 — DOBLE ESCRITURA DE `tenants.modulos`, CONTRA EL EMULADOR.
 *
 * Las reglas leen `modulos` (con respaldo a `flujos` cuando no es lista: «la lista manda»).
 * Si el alta o un script agregaban un flujo a una ficha YA migrada escribiendo solo `flujos`,
 * la capacidad del flujo quedaba cerrada en silencio. Esta suite escribe negando:
 *
 *   1. el alta deja `flujos` y `vertical` idénticos a hoy y una `modulos` coherente;
 *   2. agregar «venta» a una ficha migrada suma inventario, pedidos y catalogo-web (si se quita
 *      la línea del `arrayUnion` de `asignarNumero`, esta prueba falla);
 *   3. una ficha sin lista sigue sin lista; con `modulos` que no es lista se rechaza sin escribir;
 *   4. `asignar-numero.mjs` hace lo mismo que la callable;
 *   5. `fijar-flujos.mjs` sobre una ficha con lista sale con 2 y no cambia el `updateTime`;
 *   6. `ensayo.mjs` ya no borra `modulos`.
 *
 * Los scripts salen como proceso hijo con `entornoDelEmulador`.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';

const PROYECTO = 'demo-novuchat-pruebas';
const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;
process.env['GCLOUD_PROJECT'] = PROYECTO;

// El alta usa Auth (buscar al administrador y darle el rol): se simula, sin red.
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({
    getUserByEmail: async () => ({ uid: 'uid-admin-doble', customClaims: {} }),
    setCustomUserClaims: async () => undefined,
    getUser: async () => ({ uid: 'uid-admin-doble', customClaims: {} }),
  }),
}));
vi.mock('../../functions/src/core/seguridad/claims.ts', async (original) => ({
  ...(await original<object>()),
  asignarRol: async () => undefined,
}));

const { altaTenant, asignarNumero } = await import('../../functions/src/index.ts');
const { modulosDeFlujos } = await import('../../functions/src/registro.ts');
const { getFirestore } = await import('firebase-admin/firestore');
const db = getFirestore();

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(aqui, '..', '..', 'scripts', 'plataforma');

const AUTH_TIME = Math.floor(Date.now() / 1000);
const PROPIETARIO = { uid: 'prop-doble', token: { nc: { p: true }, firebase: { sign_in_provider: 'google.com' }, auth_time: AUTH_TIME } };
type Peticion = Parameters<typeof asignarNumero.run>[0];
const correr = (f: { run: (p: Peticion) => Promise<unknown> }, data: Record<string, unknown>) =>
  f.run({ data, auth: PROPIETARIO, rawRequest: {} } as unknown as Peticion);

const MIGRADA = 'dobl-migrada';
const SIN_LISTA = 'dobl-sin-lista';
const CADENA = 'dobl-cadena';
const ALTA = 'dobl-alta';
const NUM = '7310001';
const WABA = '7310002';
const NUM_S = '7310003';
const NUM_C = '7310004';
const COMUNES = ['productos', 'campanas'];
const DE_VENTA = ['inventario', 'pedidos', 'catalogo-web'];

const ficha = async (t: string) => (await db.doc(`tenants/${t}`).get()).data() ?? {};
const tiempo = async (t: string) => (await db.doc(`tenants/${t}`).get()).updateTime!.toMillis();
const asignar = (tenantId: string, numero = NUM) => correr(asignarNumero, { tenantId, phoneNumberId: numero, wabaId: WABA, flujo: 'venta' });

beforeEach(async () => {
  for (const t of [MIGRADA, SIN_LISTA, CADENA, ALTA, 'ensayo']) await db.recursiveDelete(db.doc(`tenants/${t}`));
  for (const n of [NUM, NUM_S, NUM_C]) await db.doc(`rutasWhatsApp/${n}`).delete();
  await db.doc(`tenants/${MIGRADA}`).set({ nombre: 'M', estado: 'activo', vertical: 'agendamiento', flujos: ['agendamiento'], modulos: ['productos', 'campanas', 'cobros', 'agenda'] });
  await db.doc(`tenants/${SIN_LISTA}`).set({ nombre: 'S', estado: 'activo', vertical: 'agendamiento', flujos: ['agendamiento'] });
  await db.doc(`tenants/${CADENA}`).set({ nombre: 'C', estado: 'activo', vertical: 'agendamiento', flujos: ['agendamiento'], modulos: 'agenda' });
});

describe('altaTenant escribe flujos y modulos', () => {
  it('flujos y vertical iguales a hoy; modulos coherente con el registro', async () => {
    await correr(altaTenant, { tenantId: ALTA, nombre: 'Alta', correoAdmin: 'a@ejemplo.com', flujos: ['venta', 'agendamiento'] });
    const f = await ficha(ALTA);
    expect(f['flujos']).toEqual(['venta', 'agendamiento']);
    expect(f['vertical']).toBe('venta');
    expect(f['modulos']).toEqual(modulosDeFlujos(['venta', 'agendamiento']));
    expect(f['modulos']).toEqual(expect.arrayContaining([...COMUNES, ...DE_VENTA, 'agenda']));
  });
  it('sin flujo pedido: agendamiento por defecto, con sus módulos y sin los de venta', async () => {
    await correr(altaTenant, { tenantId: ALTA, nombre: 'Alta', correoAdmin: 'a@ejemplo.com' });
    const f = await ficha(ALTA);
    expect(f['flujos']).toEqual(['agendamiento']);
    expect(f['modulos']).toEqual(expect.arrayContaining(['agenda', 'cobros']));
    expect(f['modulos']).not.toContain('inventario');
  });
});

describe('asignarNumero (callable) suma los módulos del flujo', () => {
  it('agregar «venta» a una ficha migrada suma inventario, pedidos y catalogo-web', async () => {
    await asignar(MIGRADA);
    const f = await ficha(MIGRADA);
    expect(f['flujos']).toEqual(['agendamiento', 'venta']);
    expect(f['modulos']).toEqual(expect.arrayContaining([...DE_VENTA, 'agenda', 'cobros']));
    // arrayUnion: sin repetidos aunque el flujo ya aportara «cobros» o «productos».
    expect(new Set(f['modulos'] as string[]).size).toBe((f['modulos'] as string[]).length);
  });
  it('NEGACIÓN: una ficha sin lista sigue sin lista', async () => {
    await asignar(SIN_LISTA, NUM_S);
    const f = await ficha(SIN_LISTA);
    expect(f['flujos']).toEqual(['agendamiento', 'venta']);
    expect(Object.prototype.hasOwnProperty.call(f, 'modulos')).toBe(false);
  });
  it('NEGACIÓN: `modulos` como cadena se rechaza (failed-precondition) sin escribir nada', async () => {
    const antes = await tiempo(CADENA);
    await expect(asignar(CADENA, NUM_C)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(await tiempo(CADENA)).toBe(antes);
    const f = await ficha(CADENA);
    expect(f['modulos']).toBe('agenda');
    expect(f['flujos']).toEqual(['agendamiento']);
    expect((await db.doc(`rutasWhatsApp/${NUM_C}`).get()).exists).toBe(false);
  });
});

function script(nombre: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [join(SCRIPTS, nombre), '--proyecto', PROYECTO, ...args], {
    env: entornoDelEmulador(HOST), encoding: 'utf8',
  });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
}
const BASE = ['--operador', 'operador@ejemplo.com', '--waba', WABA, '--flujo', 'venta', '--aplicar'];

describe('scripts', () => {
  it('asignar-numero.mjs suma los módulos en una ficha con lista y no crea la lista en una sin ella', async () => {
    const a = script('asignar-numero.mjs', '--tenant', MIGRADA, '--numero', NUM, '--alias', 'cliente18', ...BASE);
    expect(a.codigo, a.salida).toBe(0);
    expect((await ficha(MIGRADA))['modulos']).toEqual(expect.arrayContaining(DE_VENTA));
    const b = script('asignar-numero.mjs', '--tenant', SIN_LISTA, '--numero', NUM_S, '--alias', 'cliente19', ...BASE);
    expect(b.codigo, b.salida).toBe(0);
    expect(Object.prototype.hasOwnProperty.call(await ficha(SIN_LISTA), 'modulos')).toBe(false);
  });
  it('asignar-numero.mjs rechaza `modulos` que no es lista, sin escribir', async () => {
    const antes = await tiempo(CADENA);
    const r = script('asignar-numero.mjs', '--tenant', CADENA, '--numero', NUM_C, '--alias', 'cliente20', ...BASE);
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('no es una lista');
    expect(await tiempo(CADENA)).toBe(antes);
  });
  it('fijar-flujos.mjs sobre una ficha con lista sale con 2 y NO cambia el updateTime', async () => {
    const antes = await tiempo(MIGRADA);
    const r = script('fijar-flujos.mjs', '--operador', 'operador@ejemplo.com', '--tenant', MIGRADA, '--flujos', 'venta', '--aplicar');
    expect(r.codigo, r.salida).toBe(2);
    expect(r.salida).toContain('la ficha ya tiene modulos: use aplicar-modulos-tenant.mjs');
    expect(await tiempo(MIGRADA)).toBe(antes);
    expect((await ficha(MIGRADA))['flujos']).toEqual(['agendamiento']);
  });
  it('fijar-flujos.mjs sobre una ficha SIN lista sigue funcionando', async () => {
    const r = script('fijar-flujos.mjs', '--operador', 'operador@ejemplo.com', '--tenant', SIN_LISTA, '--flujos', 'venta', '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect((await ficha(SIN_LISTA))['flujos']).toEqual(['venta']);
  });
  it('ensayo.mjs ya no borra `modulos`: la deja derivada del flujo del ensayo', async () => {
    await db.doc('tenants/ensayo').set({ nombre: 'E', estado: 'activo', vertical: 'agendamiento', flujos: ['agendamiento'], modulos: ['productos'] });
    await db.doc(`tenants/${MIGRADA}/cuenta/estado`).set({ modalidad: 'demostracion' });
    await db.doc(`rutasWhatsApp/${NUM}`).set({ tenantId: MIGRADA, flujo: 'venta', estado: 'activo', aliasSecreto: 'cliente18' });
    const dir = mkdtempSync(join(tmpdir(), 'dobl-'));
    try {
      const archivo = join(dir, 'negocio-ejemplo.json');
      writeFileSync(archivo, JSON.stringify({ _comentario: 'ejemplo' }));
      // La carga posterior puede fallar con este JSON mínimo; lo que se mira es la ficha, que se escribe antes.
      script('ensayo.mjs', '--numero', NUM, '--preparar', '--cliente', 'ejemplo', '--archivo', archivo, '--aplicar');
      const e = await ficha('ensayo');
      expect(e['flujos']).toEqual(['venta']);
      expect(e['modulos']).toEqual(expect.arrayContaining([...COMUNES, ...DE_VENTA]));
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await db.doc(`rutasWhatsApp/${NUM}`).delete();
    }
  });
});
