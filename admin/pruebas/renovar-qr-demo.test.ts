/**
 * `scripts/datos/renovar-qr-demo.mjs`: renueva SOLO el media ID del QR en
 * `config/venta` de un demo, sin mostrar nunca ningún valor.
 *
 * Corre el script real contra el emulador y contra un archivo de valores
 * FALSO (`--archivo`); jamás toca CONFIGURACION.local.md. Se prueba negando:
 * escribir sin `--aplicar`, tocar otra clave, aceptar un tenant que no es demo,
 * una fila vacía o con forma inválida, imprimir un valor, conectarse sin
 * `--proyecto`.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './core/entorno-del-hijo.ts';
import { descubrirDemosDeVenta } from '../scripts/datos/demos-de-venta.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '..', 'scripts', 'datos', 'renovar-qr-demo.mjs');
const PROYECTO = 'demo-novuchat-pruebas';
const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;

const { initializeApp, getApps } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const app = getApps().find((a) => a.name === 'renovar-qr')
  ?? initializeApp({ projectId: PROYECTO }, 'renovar-qr');
const db = getFirestore(app);

const DEMO = 'demo-venta';   // el que define sembrar-demos.mjs
const NO_DEMO = 'cliente-real';
const LOCAL = '5'.repeat(13);
const VIEJO = '2'.repeat(13);

const tmp = mkdtempSync(join(tmpdir(), 'renovar-qr-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function archivoCon(valor: string | null, nombre = 'local.md', veces = 1) {
  const ruta = join(tmp, nombre);
  const una = `| \`REEMPLAZAR_MEDIA_ID_QR_DEMO\` | ${valor} | vence a los 30 días |`;
  const fila = valor === null ? '' : Array(veces).fill(una).join('\n');
  writeFileSync(ruta, ['# falso', '', '| Marcador | Valor | Nota |', '|---|---|---|', fila, ''].join('\n'));
  return ruta;
}

function correr(args: string[], host: string | undefined = HOST) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    env: entornoDelEmulador(host), encoding: 'utf8',
  });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
}
const sinValores = (s: string) => {
  expect(s).not.toContain(LOCAL);
  expect(s).not.toContain(VIEJO);
};

beforeEach(async () => {
  for (const t of [DEMO, NO_DEMO]) {
    await db.doc(`tenants/${t}`).set({
      nombre: t, estado: 'activo', vertical: 'venta',
      ...(t === DEMO ? { creadoPor: 'sembrar-demos' } : {}),
    });
    await db.doc(`tenants/${t}/config/venta`).set({
      mediaIdQr: VIEJO, cobroReal: { activo: true, banco: 'x' }, costoDelivery: 7,
    });
    for (const d of (await db.collection(`tenants/${t}/auditoria`).get()).docs) await d.ref.delete();
  }
}, 60_000);

describe('renovar-qr-demo.mjs', () => {
  it('seco con --proyecto: DIFIERE, no escribe y no imprime ningún valor', async () => {
    const r = correr(['--tenant', DEMO, '--proyecto', PROYECTO, '--archivo', archivoCon(LOCAL)]);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/DIFIERE/);
    sinValores(r.salida);
    expect((await db.doc(`tenants/${DEMO}/config/venta`).get()).get('mediaIdQr')).toBe(VIEJO);
    expect((await db.collection(`tenants/${DEMO}/auditoria`).get()).size).toBe(0);
  }, 60_000);

  it('seco: COINCIDE cuando el servidor ya tiene el valor local, y AUSENTE si falta', async () => {
    await db.doc(`tenants/${DEMO}/config/venta`).set({ mediaIdQr: LOCAL });
    let r = correr(['--tenant', DEMO, '--proyecto', PROYECTO, '--archivo', archivoCon(LOCAL)]);
    expect(r.salida).toMatch(/COINCIDE/);
    sinValores(r.salida);
    await db.doc(`tenants/${DEMO}/config/venta`).set({ costoDelivery: 7 });
    r = correr(['--tenant', DEMO, '--proyecto', PROYECTO, '--archivo', archivoCon(LOCAL)]);
    expect(r.salida).toMatch(/AUSENTE/);
  }, 60_000);

  it('sin --proyecto no hay conexión: solo valida la fila (aun sin emulador)', () => {
    const r = correr(['--tenant', DEMO, '--archivo', archivoCon(LOCAL)], undefined);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/no se abrió ninguna conexión/);
    sinValores(r.salida);
  });

  it('--aplicar cambia solo mediaIdQr y el sello; cobroReal y lo demás quedan intactos', async () => {
    const r = correr(['--tenant', DEMO, '--proyecto', PROYECTO, '--aplicar', '--archivo', archivoCon(LOCAL)]);
    expect(r.codigo, r.salida).toBe(0);
    sinValores(r.salida);
    const d = await db.doc(`tenants/${DEMO}/config/venta`).get();
    expect(d.get('mediaIdQr')).toBe(LOCAL);
    expect(d.get('actualizadoPor')).toBe('renovar-qr-demo');
    expect(d.get('actualizadoEn')).toBeTruthy();
    expect(d.get('cobroReal')).toEqual({ activo: true, banco: 'x' });
    expect(d.get('costoDelivery')).toBe(7);
    expect(Object.keys(d.data() ?? {}).sort())
      .toEqual(['actualizadoEn', 'actualizadoPor', 'cobroReal', 'costoDelivery', 'mediaIdQr']);
    // Ningún otro documento de config se creó.
    expect((await db.collection(`tenants/${DEMO}/config`).get()).size).toBe(1);
    const aud = await db.collection(`tenants/${DEMO}/auditoria`).get();
    expect(aud.size).toBe(1);
    expect(JSON.stringify(aud.docs[0]!.data())).not.toContain(LOCAL);
  }, 60_000);

  it('un tenant que no es demo de venta, NEGADO, sin escribir', async () => {
    const r = correr(['--tenant', NO_DEMO, '--proyecto', PROYECTO, '--aplicar', '--archivo', archivoCon(LOCAL)]);
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/NEGADO/);
    sinValores(r.salida);
    expect((await db.doc(`tenants/${NO_DEMO}/config/venta`).get()).get('mediaIdQr')).toBe(VIEJO);
  }, 60_000);

  it('fila vacía, pendiente o con forma inválida: aborta sin escribir', async () => {
    const casos: Array<string | null> = [null, '', 'pendiente', 'ABC123', '12345', '1'.repeat(21), '12 345 678 901'];
    for (const [i, valor] of casos.entries()) {
      const r = correr(['--tenant', DEMO, '--proyecto', PROYECTO, '--aplicar',
        '--archivo', archivoCon(valor, `caso-${i}.md`)]);
      expect(r.codigo, `caso ${i}: ${r.salida}`).toBe(1);
      expect(r.salida).toMatch(/NEGADO/);
      sinValores(r.salida);
    }
    expect((await db.doc(`tenants/${DEMO}/config/venta`).get()).get('mediaIdQr')).toBe(VIEJO);
  }, 60_000);

  it('--aplicar exige --proyecto y --tenant', () => {
    expect(correr(['--tenant', DEMO, '--aplicar', '--archivo', archivoCon(LOCAL)]).codigo).toBe(1);
    expect(correr(['--proyecto', PROYECTO, '--aplicar', '--archivo', archivoCon(LOCAL)]).codigo).toBe(1);
  });

  it('--aplicar rechaza el emulador si el proyecto no es de pruebas (demo-*)', async () => {
    const r = correr(['--tenant', DEMO, '--proyecto', 'novuchat-real', '--aplicar', '--archivo', archivoCon(LOCAL)]);
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/NEGADO.*FIRESTORE_EMULATOR_HOST/s);
    sinValores(r.salida);
  });

  it('un archivo inexistente aborta sin imprimir su ruta ni contenido', () => {
    const r = correr(['--tenant', DEMO, '--archivo', join(tmp, 'no-existe.md')]);
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/NEGADO/);
  });

  it('un tenant con id de demo pero no creado por sembrar-demos, NEGADO en seco y en aplicar', async () => {
    await db.doc(`tenants/${DEMO}`).set({ nombre: 'otro', estado: 'activo', creadoPor: 'alguien' });
    for (const extra of [[], ['--aplicar']]) {
      const r = correr(['--tenant', DEMO, '--proyecto', PROYECTO, ...extra, '--archivo', archivoCon(LOCAL)]);
      expect(r.codigo, r.salida).toBe(1);
      expect(r.salida).toMatch(/NEGADO.*no es un demo/s);
    }
    expect((await db.doc(`tenants/${DEMO}/config/venta`).get()).get('mediaIdQr')).toBe(VIEJO);
  }, 60_000);

  it('el seco con emulador heredado y proyecto no demo-*, NEGADO; con demo-* dice EMULADOR', () => {
    const r = correr(['--tenant', DEMO, '--proyecto', 'novuchat-real', '--archivo', archivoCon(LOCAL)]);
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/NEGADO.*FIRESTORE_EMULATOR_HOST/s);
    const ok = correr(['--tenant', DEMO, '--proyecto', PROYECTO, '--archivo', archivoCon(LOCAL)]);
    expect(ok.salida).toMatch(/\(EMULADOR\)/);
  });

  it('una fila repetida del marcador, NEGADO (no se toma la última)', () => {
    const r = correr(['--tenant', DEMO, '--proyecto', PROYECTO, '--aplicar',
      '--archivo', archivoCon(LOCAL, 'dup.md', 2)]);
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/NEGADO.*repetida/s);
    sinValores(r.salida);
  });
});

describe('descubrirDemosDeVenta (falla cerrado)', () => {
  const entrada = (id: string, vertical: string | null) =>
    `  {\n    id: '${id}',\n    alias: 'x',\n${vertical ? `    vertical: '${vertical}',\n` : ''}  },\n`;

  it('lee los demos de venta de un formato normal', () => {
    expect(descubrirDemosDeVenta(entrada('a-1', 'agendamiento') + entrada('b-2', 'venta'))).toEqual(['b-2']);
  });
  it('un id sin vertical no toma el de la entrada siguiente', () => {
    expect(() => descubrirDemosDeVenta(entrada('a-1', null) + entrada('b-2', 'venta'))).toThrow(/formato/);
  });
  it('formato cambiado (otra sangría) o sin demos de venta, error', () => {
    expect(() => descubrirDemosDeVenta(entrada('a-1', 'venta').replace(/^ {4}/gm, '      '))).toThrow();
    expect(() => descubrirDemosDeVenta(entrada('a-1', 'agendamiento'))).toThrow(/ningún demo/);
  });
});
