/**
 * `scripts/plataforma/aplicar-modulos-lote.mjs` contra el EMULADOR (proyecto `demo-*`), como proceso.
 * Ninguna conexión a la nube real. Las fichas son sintéticas. Todas las pruebas NIEGAN algo:
 * sin --aplicar no escribe; una ficha con diferencia no aceptada no se escribe; un `modulos` existente
 * no se pisa; `flujos` y `vertical` no se tocan; una ficha de baja no se escribe; reaplicar no escribe;
 * `--aplicar` sin la huella del seco (o con una huella vieja) no escribe; el lote no tiene `--revertir`.
 *
 * El lote lista TODA la colección `tenants`: la suite la vacía al empezar (el emulador es de pruebas y las
 * suites no corren en paralelo). Puerto propio: `FIRESTORE_EMULATOR_PORT=<n> bash pruebas/correr.sh ...`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
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

/** Corre el seco y devuelve su huella (la que el operador revisó). */
const huellaDelSeco = (extra: string[] = []) => {
  const r = correr(extra);
  const m = /huella: ([0-9a-f]{32})/.exec(r.salida);
  expect(m, r.salida).not.toBeNull();
  return { ...r, huella: m![1]! };
};
const aplicar = (huella: string, extra: string[], excluir = 'ninguno') =>
  correr(['--aplicar', '--excluir', excluir, '--esperar', huella, ...extra]);

describe('SECO por omisión', () => {
  it('no escribe nada (updateTime igual), muestra antes/después, la lista exacta y la huella, omite lo que corresponde y sale 0', async () => {
    await db.doc('tenants/venta-uno').set(VENTA);
    await db.doc('tenants/con-lista').set({ ...AGENDA, modulos: CON_LISTA });
    await db.doc('tenants/de-baja').set({ ...VENTA, estado: 'dado_de_baja' });
    const t = await tiempo('venta-uno');
    const r = correr([]);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toContain('SECO');
    expect(r.salida).toContain('módulos de después');
    expect(r.salida).toContain('ids que se escribirían (1): venta-uno');
    expect(r.salida).toMatch(/huella: [0-9a-f]{32}/);
    expect(r.salida).toContain('con-lista: omitida (ya tiene «modulos»)');
    expect(r.salida).toContain('de-baja: omitida (dada de baja)');
    expect(r.salida).toContain('quedan SIN modulos: (ninguno)');
    expect(r.salida).not.toContain(SECRETO);
    expect(r.salida).not.toContain(PROYECTO);
    expect(await tiempo('venta-uno')).toBe(t);
    expect((await datos('venta-uno'))?.['modulos']).toBeUndefined();
  });

  it('sale con 1 si --aplicar rechazaría alguna ficha, sin escribir, y la lista entre las que quedan SIN modulos', async () => {
    await db.doc('tenants/agenda-uno').set(AGENDA);
    const t = await tiempo('agenda-uno');
    const r = correr(['--acepto', 'agenda-uno:inventario']);
    expect(r.codigo, r.salida).toBe(1);
    expect(r.salida).toContain('quedan SIN modulos: agenda-uno');
    expect(await tiempo('agenda-uno')).toBe(t);
  });

  it('un id de --excluir que no existe corta con 2 (también en seco)', async () => {
    await db.doc('tenants/venta-uno').set(VENTA);
    const r = correr(['--excluir', 'no-existe']);
    expect(r.codigo, r.salida).toBe(2);
    expect(r.salida).toContain('--excluir nombra tenants que no existen: no-existe');
  });

  it('el lote ya no tiene --revertir', () => {
    const r = correr(['--revertir']);
    expect(r.codigo, r.salida).toBe(2);
    expect(r.salida).toContain('opción desconocida: --revertir');
  });

  it('una ficha con un id fuera de la forma permitida se rechaza, no se escribe', async () => {
    await db.doc('tenants/Mal-Id').set(VENTA);
    const t = await tiempo('Mal-Id');
    const r = correr([]);
    expect(r.codigo, r.salida).toBe(1);
    expect(r.salida).toContain('Mal-Id: el id del tenant no tiene la forma permitida');
    expect(await tiempo('Mal-Id')).toBe(t);
  });
});

describe('--aplicar', () => {
  it('sin --excluir, sin --respaldo-dir o sin --esperar se rechaza con 2 y no escribe', async () => {
    await db.doc('tenants/venta-uno').set(VENTA);
    const dir = nuevoDir();
    const { huella } = huellaDelSeco();
    expect(correr(['--aplicar', '--esperar', huella, '--respaldo-dir', join(dir, 'r')]).codigo).toBe(2);
    expect(correr(['--aplicar', '--excluir', 'ninguno', '--esperar', huella]).codigo).toBe(2);
    const sinEsperar = correr(['--aplicar', '--excluir', 'ninguno', '--respaldo-dir', join(dir, 'r')]);
    expect(sinEsperar.codigo, sinEsperar.salida).toBe(2);
    expect(sinEsperar.salida).toContain('--esperar');
    expect((await datos('venta-uno'))?.['modulos']).toBeUndefined();
  });

  it('una huella equivocada o de otro estado se rechaza con 2 sin escribir', async () => {
    await db.doc('tenants/venta-uno').set(VENTA);
    const t = await tiempo('venta-uno');
    const r = aplicar('0'.repeat(32), ['--respaldo-dir', join(nuevoDir(), 'r')]);
    expect(r.codigo, r.salida).toBe(2);
    expect(r.salida).toContain('La huella esperada no coincide');
    expect(await tiempo('venta-uno')).toBe(t);
  });

  it('aparece una candidata nueva entre el seco y el aplicar: sale 2 y no escribe NINGUNA', async () => {
    await db.doc('tenants/venta-uno').set(VENTA);
    const { huella } = huellaDelSeco();
    await db.doc('tenants/agenda-nueva').set(AGENDA);
    const t = await tiempo('venta-uno');
    const resp = join(nuevoDir(), 'r');
    const r = aplicar(huella, ['--respaldo-dir', resp]);
    expect(r.codigo, r.salida).toBe(2);
    expect(await tiempo('venta-uno')).toBe(t);
    expect((await datos('agenda-nueva'))?.['modulos']).toBeUndefined();
    expect(existsSync(resp)).toBe(false);
  });

  it('un id de --excluir inexistente corta con 2 antes de escribir', async () => {
    await db.doc('tenants/venta-uno').set(VENTA);
    const { huella } = huellaDelSeco();
    const r = aplicar(huella, ['--respaldo-dir', join(nuevoDir(), 'r')], 'no-existe');
    expect(r.codigo, r.salida).toBe(2);
    expect((await datos('venta-uno'))?.['modulos']).toBeUndefined();
  });

  it('--respaldo-dir como enlace simbólico se rechaza con 2', async () => {
    await db.doc('tenants/venta-uno').set(VENTA);
    const { huella } = huellaDelSeco();
    const real = nuevoDir();
    const enlace = join(nuevoDir(), 'enlace');
    symlinkSync(real, enlace);
    const r = aplicar(huella, ['--respaldo-dir', enlace]);
    expect(r.codigo, r.salida).toBe(2);
    expect(r.salida).toContain('enlace simbólico');
    expect((await datos('venta-uno'))?.['modulos']).toBeUndefined();
    expect(readdirSync(real)).toEqual([]);
  });

  it('NO escribe una ficha cuya diferencia no está aceptada (o rompe una dependencia); las demás sí; sale 3 y la lista entre las que quedan SIN modulos', async () => {
    await db.doc('tenants/agenda-uno').set(AGENDA);
    await db.doc('tenants/venta-uno').set(VENTA);
    await db.doc('tenants/venta-dos').set(VENTA);
    const resp = join(nuevoDir(), 'r');
    // agenda-uno: nada que quitar. venta-uno: quitar inventario deja a catalogo-web sin una dependencia (dependeDe).
    const acepto = ['--acepto', 'agenda-uno:inventario', '--acepto', 'venta-uno:inventario'];
    const { huella } = huellaDelSeco(acepto);
    const t = await tiempo('agenda-uno');
    const tv = await tiempo('venta-uno');
    const r = aplicar(huella, ['--respaldo-dir', resp, ...acepto]);
    expect(r.codigo, r.salida).toBe(3);
    expect(r.salida).toContain('depende de');
    expect(r.salida).toContain('quedan SIN modulos: agenda-uno, venta-uno');
    expect(await tiempo('agenda-uno')).toBe(t);
    expect(await tiempo('venta-uno')).toBe(tv);
    expect(existsSync(join(resp, 'agenda-uno.json'))).toBe(false);
    expect(existsSync(join(resp, 'venta-uno.json'))).toBe(false);
    // Una que falla no detiene a las demás.
    expect(Array.isArray((await datos('venta-dos'))?.['modulos'])).toBe(true);
  });

  it('un --acepto que no apunta a una candidata corta todo antes de escribir (2)', async () => {
    await db.doc('tenants/venta-uno').set(VENTA);
    const t = await tiempo('venta-uno');
    const r = aplicar('0'.repeat(32), ['--respaldo-dir', join(nuevoDir(), 'r'), '--acepto', 'no-existe:inventario']);
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
    const resp = join(nuevoDir(), 'resp');
    const acepto = ['--acepto', 'venta-uno:catalogo-web'];
    const seco = huellaDelSeco(['--excluir', 'excluida', ...acepto]);
    expect(seco.salida).toContain('ids que se escribirían (2): agenda-uno, venta-uno');
    const r = aplicar(seco.huella, ['--respaldo-dir', resp, ...acepto], 'excluida');
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toContain('quedan SIN modulos: excluida');
    expect(r.salida).not.toContain(SECRETO);
    expect(r.salida).not.toContain(PROYECTO);

    const v = await datos('venta-uno');
    expect(v).toMatchObject({ nombre: SECRETO, vertical: 'venta', flujos: ['venta'] });
    expect(v?.['modulos']).toEqual(expect.arrayContaining(['productos', 'campanas', 'pedidos', 'inventario']));
    expect(v?.['modulos']).not.toContain('catalogo-web');
    const a = await datos('agenda-uno');
    expect(a).toMatchObject({ vertical: 'agendamiento', flujos: ['agendamiento'] });
    expect(a?.['modulos']).toContain('agenda');

    expect(modo(resp)).toBe(0o700);
    expect(modo(join(resp, 'venta-uno.json'))).toBe(0o600);
    const texto = readFileSync(join(resp, 'venta-uno.json'), 'utf8');
    expect(texto).not.toContain(SECRETO);
    expect(texto).not.toContain(PROYECTO);
    expect(JSON.parse(texto)).toMatchObject({ tenant: 'venta-uno', entorno: 'emulador', previo: { modulosPresente: false, modulos: null } });

    expect(await tiempo('con-lista')).toBe(tLista);
    expect((await datos('con-lista'))?.['modulos']).toEqual(CON_LISTA);
    expect(await tiempo('de-baja')).toBe(tBaja);
    expect(await tiempo('excluida')).toBe(tExc);
    expect(existsSync(join(resp, 'de-baja.json'))).toBe(false);
    expect(existsSync(join(resp, 'excluida.json'))).toBe(false);
    expect(existsSync(join(resp, 'con-lista.json'))).toBe(false);
  });

  it('es idempotente: reaplicar no escribe nada ni pisa respaldos (con la huella del nuevo seco, sin candidatas)', async () => {
    await db.doc('tenants/venta-uno').set(VENTA);
    const resp = join(nuevoDir(), 'resp');
    const { huella } = huellaDelSeco();
    expect(aplicar(huella, ['--respaldo-dir', resp]).codigo).toBe(0);
    const t = await tiempo('venta-uno');
    const respaldo = readFileSync(join(resp, 'venta-uno.json'), 'utf8');
    // Repetir el MISMO comando (huella vieja) es rechazado: el estado cambió.
    expect(aplicar(huella, ['--respaldo-dir', resp]).codigo).toBe(2);
    const nueva = huellaDelSeco();
    expect(nueva.salida).toContain('venta-uno: omitida (ya tiene «modulos»)');
    const otra = aplicar(nueva.huella, ['--respaldo-dir', resp]);
    expect(otra.codigo, otra.salida).toBe(0);
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
    const { huella } = huellaDelSeco();
    const r = aplicar(huella, ['--respaldo-dir', resp]);
    expect(r.codigo, r.salida).toBe(3);
    expect(r.salida).toContain('con falla        : venta-uno');
    expect(r.salida).toContain('quedan SIN modulos: venta-uno');
    expect((await datos('venta-uno'))?.['modulos']).toBeUndefined();
    expect(readFileSync(join(resp, 'venta-uno.json'), 'utf8')).toBe('{}');
    expect(Array.isArray((await datos('agenda-uno'))?.['modulos'])).toBe(true);
  });
});

describe('--aplicar en proceso, con una base que cambia en medio', () => {
  /** El `huella:` que imprime el seco en proceso. */
  async function secoEnProceso() {
    const logs: string[] = [];
    await lote.ejecutarLote({ entorno: 'emulador', aplicar: false, excluir: [], acepto: {}, respaldoDir: null, esperar: null }, { db, log: (t: string) => logs.push(t) });
    return /huella: ([0-9a-f]{32})/.exec(logs.join('\n'))![1]!;
  }

  it('la ficha gana un modulos ajeno entre el listado y la escritura: no se pisa', async () => {
    await db.doc('tenants/venta-uno').set(VENTA);
    const esperar = await secoEnProceso();
    const ajeno = ['productos', 'campanas', 'pedidos'];
    const falsa = {
      collection: (p: string) => db.collection(p),
      doc: (p: string) => db.doc(p),
      getAll: async (...a: Parameters<typeof db.getAll>) => {
        await db.doc('tenants/venta-uno').update({ modulos: ajeno });
        return db.getAll(...a);
      },
    };
    const logs: string[] = [];
    const codigo = await lote.ejecutarLote(
      { entorno: 'emulador', aplicar: true, excluir: [], acepto: {}, respaldoDir: join(nuevoDir(), 'resp'), esperar },
      { db: falsa, log: (t: string) => logs.push(t) },
    );
    expect(codigo).toBe(3);
    expect(logs.join('\n')).toContain('la ficha cambió después del listado');
    expect((await datos('venta-uno'))?.['modulos']).toEqual(ajeno);
  });

  it('la precondición de updateTime falla a mitad del lote: esa ficha no se escribe, las demás sí, y sale 3 con el resumen', async () => {
    for (const t of ['venta-a', 'venta-b', 'venta-c']) await db.doc(`tenants/${t}`).set(VENTA);
    const esperar = await secoEnProceso();
    let tocada = false;
    const falsa = {
      collection: (p: string) => db.collection(p),
      doc: (p: string) => db.doc(p),
      getAll: async (...a: Parameters<typeof db.getAll>) => {
        const r = await db.getAll(...a);
        // Tras la primera lectura de venta-b, otra persona la edita: su updateTime ya no es el leído.
        if (!tocada && r[0]?.id === 'venta-b') {
          tocada = true;
          await db.doc('tenants/venta-b').update({ nombre: 'otro' });
        }
        return r;
      },
    };
    const logs: string[] = [];
    const codigo = await lote.ejecutarLote(
      { entorno: 'emulador', aplicar: true, excluir: [], acepto: {}, respaldoDir: join(nuevoDir(), 'resp'), esperar },
      { db: falsa, log: (t: string) => logs.push(t), escritas: [] },
    );
    const salida = logs.join('\n');
    expect(codigo, salida).toBe(3);
    expect(salida).toContain('con falla        : venta-b');
    expect(salida).toContain('quedan SIN modulos: venta-b');
    expect((await datos('venta-b'))?.['modulos']).toBeUndefined();
    expect(Array.isArray((await datos('venta-a'))?.['modulos'])).toBe(true);
    expect(Array.isArray((await datos('venta-c'))?.['modulos'])).toBe(true);
  });
});

describe('la línea final de ejecutar', () => {
  it('el lote no recomienda --revertir al terminar una ficha', async () => {
    await db.doc('tenants/venta-uno').set(VENTA);
    const { huella } = huellaDelSeco();
    const r = aplicar(huella, ['--respaldo-dir', join(nuevoDir(), 'r')]);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toContain('Este lote no revierte ni borra');
    expect(r.salida).not.toContain('Para deshacer: --revertir');
  });
});

describe('el texto del script', () => {
  const texto = readFileSync(SCRIPT, 'utf8');
  const raiz = join(aqui, '..', '..', '..');
  it('no tiene ninguna escritura propia a Firestore: toda escritura pasa por `ejecutar` y nunca se le da cómo borrar', () => {
    // El único `.update(` es el del hash de la huella (node:crypto), no de Firestore.
    expect(texto.replace(".update(JSON.stringify([entorno, orden]))", '')).not.toMatch(/\.(set|update|delete|create|add|commit|recursiveDelete)\(/);
    expect(texto).not.toMatch(/FieldValue\.delete/);
    expect(texto).not.toMatch(/revertirLote|leerRespaldo/);
    expect(texto).toContain("const BANDERAS = ['aplicar'];");
    expect(texto).toContain("from './aplicar-modulos-tenant.mjs'");
  });
  it('no nombra a ningún cliente: ni los ids de tenant versionados (pruebas/tenants, CONFIGURACION.md) ni una lista corta fija', () => {
    const ids = new Set<string>(['bellido', 'qtaco', 'dhermacore', 'walisuma', 'doctoras']);
    for (const d of readdirSync(join(aqui, '..', 'tenants'))) { ids.add(d); for (const parte of d.split('-')) if (parte.length > 3) ids.add(parte); }
    const config = readFileSync(join(raiz, 'CONFIGURACION.md'), 'utf8');
    for (const m of config.matchAll(/tenants\/([a-z0-9][a-z0-9-]{2,})/g)) ids.add(m[1]!);
    expect(ids.size).toBeGreaterThan(6);
    const bajo = texto.toLowerCase();
    for (const id of ids) expect(bajo, id).not.toContain(id.toLowerCase());
  });
});
