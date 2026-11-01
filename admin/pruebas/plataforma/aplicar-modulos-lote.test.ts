/**
 * `scripts/plataforma/aplicar-modulos-lote.mjs` contra el EMULADOR (proyecto `demo-*`), como proceso.
 * Ninguna conexión a la nube real. Las fichas son sintéticas. Todas las pruebas NIEGAN algo:
 * sin --aplicar no escribe; una ficha con diferencia no aceptada no se escribe; un `modulos` existente
 * no se pisa; `flujos` y `vertical` no se tocan; una ficha de baja no se escribe; reaplicar no escribe;
 * revertir nunca borra `modulos`.
 *
 * El lote lista TODA la colección `tenants`: la suite la vacía al empezar (el emulador es de pruebas y las
 * suites no corren en paralelo). Puerto propio: `FIRESTORE_EMULATOR_PORT=<n> bash pruebas/correr.sh ...`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '..', '..', 'scripts', 'plataforma', 'aplicar-modulos-lote.mjs');
const PROYECTO = 'demo-novuchat-pruebas';
const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;

const { initializeApp, getApps } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const app = getApps().find((a) => a.name === 'aplicar-lote') ?? initializeApp({ projectId: PROYECTO }, 'aplicar-lote');
const db = getFirestore(app);
const lote = await import('../../scripts/plataforma/aplicar-modulos-lote.mjs') as unknown as {
  ejecutarLote: (cfg: Record<string, unknown>, deps: Record<string, unknown>) => Promise<number>;
};
const { FieldValue } = await import('firebase-admin/firestore');

const SECRETO = 'dato-del-comercio-que-no-debe-salir';
const VENTA = { nombre: SECRETO, estado: 'activo', vertical: 'venta', flujos: ['venta'] };
const AGENDA = { nombre: SECRETO, estado: 'activo', vertical: 'agendamiento', flujos: ['agendamiento'] };
const CON_LISTA = ['productos', 'campanas', 'agenda'];

const dirs: string[] = [];
const nuevoDir = () => { const d = mkdtempSync(join(tmpdir(), 'apl-lote-')); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const correr = (args: string[]) => {
  const r = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO, ...args], { encoding: 'utf8', env: entornoDelEmulador(HOST), timeout: 60_000 });
  return { codigo: r.status, salida: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};
const datos = async (t: string) => (await db.doc(`tenants/${t}`).get()).data() as Record<string, unknown> | undefined;
const tiempo = async (t: string) => (await db.doc(`tenants/${t}`).get()).updateTime?.toMillis();
const modo = (r: string) => statSync(r).mode & 0o777;

async function vaciar() {
  const docs = await db.collection('tenants').listDocuments();
  for (const d of docs) await db.recursiveDelete(d);
}
beforeAll(vaciar);
afterAll(vaciar);
beforeEach(vaciar);

describe('SECO por omisión', () => {
  it('no escribe nada (updateTime igual), muestra antes/después, omite lo que corresponde y sale 0', async () => {
    await db.doc('tenants/venta-uno').set(VENTA);
    await db.doc('tenants/con-lista').set({ ...AGENDA, modulos: CON_LISTA });
    await db.doc('tenants/de-baja').set({ ...VENTA, estado: 'dado_de_baja' });
    const t = await tiempo('venta-uno');
    const r = correr([]);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toContain('SECO');
    expect(r.salida).toContain('módulos de después');
    expect(r.salida).toContain('con-lista: omitida (ya tiene «modulos»)');
    expect(r.salida).toContain('de-baja: omitida (dada de baja)');
    expect(r.salida).not.toContain(SECRETO);
    expect(r.salida).not.toContain(PROYECTO);
    expect(await tiempo('venta-uno')).toBe(t);
    expect((await datos('venta-uno'))?.['modulos']).toBeUndefined();
  });
});

describe('--aplicar', () => {
  it('sin --excluir o sin --respaldo-dir se rechaza con 2 y no escribe', async () => {
    await db.doc('tenants/venta-uno').set(VENTA);
    const dir = nuevoDir();
    const sinExcluir = correr(['--aplicar', '--respaldo-dir', join(dir, 'r')]);
    expect(sinExcluir.codigo, sinExcluir.salida).toBe(2);
    const sinDir = correr(['--aplicar', '--excluir', 'ninguno']);
    expect(sinDir.codigo, sinDir.salida).toBe(2);
    expect((await datos('venta-uno'))?.['modulos']).toBeUndefined();
  });

  it('NO escribe una ficha cuya diferencia no está aceptada; las demás sí, y sale con 3 listando cuál', async () => {
    // `--acepto agenda-uno:inventario` no es derivable (agenda no tiene inventario): la ficha se rechaza.
    await db.doc('tenants/agenda-uno').set(AGENDA);
    await db.doc('tenants/venta-uno').set(VENTA);
    const dir = nuevoDir();
    const resp = join(dir, 'r');
    const t = await tiempo('agenda-uno');
    const r = correr(['--aplicar', '--excluir', 'ninguno', '--respaldo-dir', resp, '--acepto', 'agenda-uno:inventario']);
    expect(r.codigo, r.salida).toBe(3);
    expect(r.salida).toContain('rechazadas       : agenda-uno');
    expect(await tiempo('agenda-uno')).toBe(t);
    expect((await datos('agenda-uno'))?.['modulos']).toBeUndefined();
    expect(existsSync(join(resp, 'agenda-uno.json'))).toBe(false);
    // La otra ficha sí se escribió: una que falla no detiene a las demás.
    expect(Array.isArray((await datos('venta-uno'))?.['modulos'])).toBe(true);
  });

  it('un --acepto que no apunta a una candidata corta todo antes de escribir (2)', async () => {
    await db.doc('tenants/venta-uno').set(VENTA);
    const t = await tiempo('venta-uno');
    const r = correr(['--aplicar', '--excluir', 'ninguno', '--respaldo-dir', join(nuevoDir(), 'r'), '--acepto', 'no-existe:inventario']);
    expect(r.codigo, r.salida).toBe(2);
    expect(await tiempo('venta-uno')).toBe(t);
  });

  it('escribe SOLO modulos (flujos y vertical intactos), con respaldo 0600 en carpeta 0700; quita lo aceptado; no pisa un modulos existente; no toca bajas ni excluidas', async () => {
    await db.doc('tenants/venta-uno').set(VENTA);
    await db.doc('tenants/agenda-uno').set(AGENDA);
    await db.doc('tenants/con-lista').set({ ...AGENDA, modulos: CON_LISTA });
    await db.doc('tenants/de-baja').set({ ...VENTA, estado: 'dado_de_baja' });
    await db.doc('tenants/excluida').set(VENTA);
    const tLista = await tiempo('con-lista');
    const tBaja = await tiempo('de-baja');
    const tExc = await tiempo('excluida');
    const dir = nuevoDir();
    const resp = join(dir, 'resp');
    const r = correr(['--aplicar', '--excluir', 'excluida', '--respaldo-dir', resp, '--acepto', 'venta-uno:inventario']);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).not.toContain(SECRETO);
    expect(r.salida).not.toContain(PROYECTO);

    const v = await datos('venta-uno');
    expect(v).toMatchObject({ nombre: SECRETO, vertical: 'venta', flujos: ['venta'] });
    expect(v?.['modulos']).toEqual(expect.arrayContaining(['productos', 'campanas', 'pedidos']));
    expect(v?.['modulos']).not.toContain('inventario');
    const a = await datos('agenda-uno');
    expect(a).toMatchObject({ vertical: 'agendamiento', flujos: ['agendamiento'] });
    expect(a?.['modulos']).toContain('agenda');

    expect(modo(resp)).toBe(0o700);
    expect(modo(join(resp, 'venta-uno.json'))).toBe(0o600);
    const texto = readFileSync(join(resp, 'venta-uno.json'), 'utf8');
    expect(texto).not.toContain(SECRETO);
    expect(texto).not.toContain(PROYECTO);
    expect(JSON.parse(texto)).toMatchObject({ tenant: 'venta-uno', entorno: 'emulador', previo: { modulosPresente: false, modulos: null } });

    // Lo que NO se debía tocar sigue igual.
    expect(await tiempo('con-lista')).toBe(tLista);
    expect((await datos('con-lista'))?.['modulos']).toEqual(CON_LISTA);
    expect(await tiempo('de-baja')).toBe(tBaja);
    expect(await tiempo('excluida')).toBe(tExc);
    expect(existsSync(join(resp, 'de-baja.json'))).toBe(false);
    expect(existsSync(join(resp, 'excluida.json'))).toBe(false);
    expect(existsSync(join(resp, 'con-lista.json'))).toBe(false);
  });

  it('es idempotente: reaplicar el mismo comando no escribe nada ni pisa respaldos', async () => {
    await db.doc('tenants/venta-uno').set(VENTA);
    const resp = join(nuevoDir(), 'resp');
    const args = ['--aplicar', '--excluir', 'ninguno', '--respaldo-dir', resp];
    expect(correr(args).codigo).toBe(0);
    const t = await tiempo('venta-uno');
    const respaldo = readFileSync(join(resp, 'venta-uno.json'), 'utf8');
    const otra = correr(args);
    expect(otra.codigo, otra.salida).toBe(0);
    expect(otra.salida).toContain('venta-uno: omitida (ya tiene «modulos»)');
    expect(await tiempo('venta-uno')).toBe(t);
    expect(readFileSync(join(resp, 'venta-uno.json'), 'utf8')).toBe(respaldo);
  });

  it('un respaldo previo de una corrida abortada no se pisa: esa ficha falla, no se escribe y las demás siguen', async () => {
    await db.doc('tenants/venta-uno').set(VENTA);
    await db.doc('tenants/agenda-uno').set(AGENDA);
    const resp = join(nuevoDir(), 'resp');
    mkdirSync(resp, { mode: 0o700 });
    chmodSync(resp, 0o700);
    writeFileSync(join(resp, 'venta-uno.json'), '{}', { mode: 0o600 });
    chmodSync(join(resp, 'venta-uno.json'), 0o600);
    const r = correr(['--aplicar', '--excluir', 'ninguno', '--respaldo-dir', resp]);
    expect(r.codigo, r.salida).toBe(3);
    expect(r.salida).toContain('con falla        : venta-uno');
    expect((await datos('venta-uno'))?.['modulos']).toBeUndefined();
    expect(readFileSync(join(resp, 'venta-uno.json'), 'utf8')).toBe('{}');
    expect(Array.isArray((await datos('agenda-uno'))?.['modulos'])).toBe(true);
  });

  it('la ficha cambia entre el listado y la escritura (gana un modulos ajeno): no se pisa', async () => {
    await db.doc('tenants/venta-uno').set(VENTA);
    const ajeno = ['productos', 'campanas', 'pedidos'];
    // Una base que, al ser leída por `ejecutar` (la primera lectura de la ficha), ya trae el modulos ajeno.
    const real = db;
    const falsa = {
      collection: (p: string) => real.collection(p),
      doc: (p: string) => real.doc(p),
      getAll: async (...a: Parameters<typeof real.getAll>) => {
        await real.doc('tenants/venta-uno').update({ modulos: ajeno });
        return real.getAll(...a);
      },
    };
    const logs: string[] = [];
    const codigo = await lote.ejecutarLote(
      { entorno: 'emulador', aplicar: true, revertir: false, excluir: [], acepto: {}, respaldoDir: join(nuevoDir(), 'resp') },
      { db: falsa, FieldValue, log: (t: string) => logs.push(t) },
    );
    expect(codigo).toBe(3);
    expect(logs.join('\n')).toContain('la ficha cambió después del listado');
    expect((await datos('venta-uno'))?.['modulos']).toEqual(ajeno);
  });
});

describe('--revertir', () => {
  it('NO borra modulos cuando no existía antes: rechaza con el motivo y deja la ficha igual', async () => {
    await db.doc('tenants/venta-uno').set(VENTA);
    const resp = join(nuevoDir(), 'resp');
    expect(correr(['--aplicar', '--excluir', 'ninguno', '--respaldo-dir', resp]).codigo).toBe(0);
    const escrito = (await datos('venta-uno'))?.['modulos'];
    const t = await tiempo('venta-uno');
    const r = correr(['--revertir', '--aplicar', '--excluir', 'ninguno', '--respaldo-dir', resp]);
    expect(r.codigo, r.salida).toBe(3);
    expect(r.salida).toContain('tras H2b-cierre borrar modulos corta todo');
    expect((await datos('venta-uno'))?.['modulos']).toEqual(escrito);
    expect(await tiempo('venta-uno')).toBe(t);
  });

  it('restaura desde un respaldo que sí tenía modulos, con el freno, y no pisa un cambio ajeno', async () => {
    const resp = join(nuevoDir(), 'resp');
    // Se genera una carpeta válida (0700) con el script y luego se escribe a mano un respaldo con `modulos` previo.
    await db.doc('tenants/venta-uno').set(VENTA);
    expect(correr(['--aplicar', '--excluir', 'ninguno', '--respaldo-dir', resp]).codigo).toBe(0);
    const nuevo = ['productos', 'campanas', 'pedidos'];
    const previo = ['productos', 'campanas', 'agenda'];
    await db.doc('tenants/venta-uno').update({ modulos: nuevo });
    const archivo = join(resp, 'venta-uno.json');
    rmSync(archivo);
    writeFileSync(archivo, JSON.stringify({
      version: 1, entorno: 'emulador', tenant: 'venta-uno', creadoEn: '2026-11-01T00:00:00.000Z', fichaActualizadaEn: null,
      previo: { modulosPresente: true, modulos: previo, flujos: ['venta'], vertical: 'venta' }, escrito: nuevo,
    }), { mode: 0o600 });
    chmodSync(archivo, 0o600);

    // Sin declarar las capacidades que cambian (pedidos se quita, agenda se agrega) el freno rechaza.
    const t = await tiempo('venta-uno');
    const sinFreno = correr(['--revertir', '--aplicar', '--excluir', 'ninguno', '--respaldo-dir', resp]);
    expect(sinFreno.codigo, sinFreno.salida).toBe(3);
    expect(await tiempo('venta-uno')).toBe(t);
    // En seco no escribe.
    const seco = correr(['--revertir', '--respaldo-dir', resp, '--acepto', 'venta-uno:pedidos,agenda']);
    expect(seco.codigo, seco.salida).toBe(0);
    expect(await tiempo('venta-uno')).toBe(t);
    // Con el freno declarado, restaura; flujos y vertical intactos.
    const r = correr(['--revertir', '--aplicar', '--excluir', 'ninguno', '--respaldo-dir', resp, '--acepto', 'venta-uno:pedidos,agenda']);
    expect(r.codigo, r.salida).toBe(0);
    expect(await datos('venta-uno')).toMatchObject({ modulos: previo, flujos: ['venta'], vertical: 'venta' });

    // Un cambio ajeno posterior no se pisa.
    await db.doc('tenants/venta-uno').update({ modulos: ['productos', 'campanas', 'cobros'] });
    const ajeno = correr(['--revertir', '--aplicar', '--excluir', 'ninguno', '--respaldo-dir', resp, '--acepto', 'venta-uno:cobros,agenda']);
    expect(ajeno.codigo, ajeno.salida).toBe(3);
    expect((await datos('venta-uno'))?.['modulos']).toEqual(['productos', 'campanas', 'cobros']);
  });

  it('una ficha de baja no se revierte', async () => {
    const resp = join(nuevoDir(), 'resp');
    await db.doc('tenants/venta-uno').set(VENTA);
    expect(correr(['--aplicar', '--excluir', 'ninguno', '--respaldo-dir', resp]).codigo).toBe(0);
    const nuevo = ['productos', 'campanas', 'pedidos'];
    const previo = ['productos', 'campanas', 'agenda'];
    await db.doc('tenants/venta-uno').update({ modulos: nuevo, estado: 'dado_de_baja' });
    const archivo = join(resp, 'venta-uno.json');
    rmSync(archivo);
    writeFileSync(archivo, JSON.stringify({
      version: 1, entorno: 'emulador', tenant: 'venta-uno', creadoEn: '2026-11-01T00:00:00.000Z', fichaActualizadaEn: null,
      previo: { modulosPresente: true, modulos: previo, flujos: ['venta'], vertical: 'venta' }, escrito: nuevo,
    }), { mode: 0o600 });
    chmodSync(archivo, 0o600);
    const t = await tiempo('venta-uno');
    const r = correr(['--revertir', '--aplicar', '--excluir', 'ninguno', '--respaldo-dir', resp, '--acepto', 'venta-uno:pedidos,agenda']);
    expect(r.codigo, r.salida).toBe(3);
    expect(await tiempo('venta-uno')).toBe(t);
  });
});

describe('el texto del script', () => {
  const texto = readFileSync(SCRIPT, 'utf8');
  it('no tiene ninguna escritura propia a Firestore: toda escritura pasa por `ejecutar` de aplicar-modulos-tenant', () => {
    expect(texto).not.toMatch(/\.(set|update|delete|create|add|commit|recursiveDelete)\(/);
    expect(texto).not.toMatch(/FieldValue\.delete/);
    expect(texto).toContain("from './aplicar-modulos-tenant.mjs'");
  });
  it('no nombra a ningún cliente ni trae un id de proyecto', () => {
    expect(texto.toLowerCase()).not.toMatch(/qtaco|q'taco|dhermacore/);
  });
});
