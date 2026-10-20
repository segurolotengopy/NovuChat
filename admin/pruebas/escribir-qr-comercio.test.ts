/**
 * `scripts/datos/escribir-qr-comercio.mjs`: escribe SOLO el media ID del QR en
 * `config/venta` de un comercio REAL, sin mostrar nunca ningún valor.
 *
 * Corre el script real contra el emulador y contra una tabla FALSA (`--archivo`).
 * Se prueba negando cada candado.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './core/entorno-del-hijo.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '..', 'scripts', 'datos', 'escribir-qr-comercio.mjs');
const PROYECTO = 'demo-novuchat-pruebas';
const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;

const { initializeApp, getApps } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const app = getApps().find((a) => a.name === 'escribir-qr')
  ?? initializeApp({ projectId: PROYECTO }, 'escribir-qr');
const db = getFirestore(app);

const REAL = 'comercio-real';
const SIN_VENTA = 'comercio-agenda';
const DEMO = 'demo-venta';
const MARC = 'REEMPLAZAR_MEDIA_ID_QR_REAL';
const LOCAL = '5'.repeat(13);
const VIEJO = '2'.repeat(13);

const tmp = mkdtempSync(join(tmpdir(), 'escribir-qr-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function archivoCon(valor: string | null, nombre = 'local.md', veces = 1, marcador = MARC) {
  const ruta = join(tmp, nombre);
  const una = `| \`${marcador}\` | ${valor} | vence a los 30 días |`;
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
const base = (t: string, extra: string[] = [], arch = archivoCon(LOCAL)) =>
  ['--tenant', t, '--proyecto', PROYECTO, '--marcador', MARC, '--archivo', arch, ...extra];
const sinValores = (s: string) => {
  expect(s).not.toContain(LOCAL);
  expect(s).not.toContain(VIEJO);
};
const mediaId = async (t: string) => (await db.doc(`tenants/${t}/config/venta`).get()).get('mediaIdQr');

beforeEach(async () => {
  const fichas: Record<string, Record<string, unknown>> = {
    [REAL]: { flujos: ['venta'], vertical: 'venta' },
    [SIN_VENTA]: { flujos: ['agendamiento'], vertical: 'agendamiento' },
    [DEMO]: { flujos: ['venta'], vertical: 'venta', creadoPor: 'sembrar-demos' },
  };
  for (const [t, f] of Object.entries(fichas)) {
    await db.doc(`tenants/${t}`).set({ nombre: t, estado: 'activo', ...f });
    await db.doc(`tenants/${t}/config/venta`).set({
      mediaIdQr: VIEJO, cobroReal: { activo: true, banco: 'x' }, costoDelivery: 7,
    });
    for (const d of (await db.collection(`tenants/${t}/auditoria`).get()).docs) await d.ref.delete();
  }
}, 60_000);

describe('escribir-qr-comercio.mjs', () => {
  it('seco con --proyecto: DIFIERE, no escribe y no imprime ningún valor', async () => {
    const r = correr(base(REAL));
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/DIFIERE/);
    sinValores(r.salida);
    expect(await mediaId(REAL)).toBe(VIEJO);
    expect((await db.collection(`tenants/${REAL}/auditoria`).get()).size).toBe(0);
  }, 60_000);

  it('seco: COINCIDE y AUSENTE', async () => {
    await db.doc(`tenants/${REAL}/config/venta`).set({ mediaIdQr: LOCAL });
    expect(correr(base(REAL)).salida).toMatch(/COINCIDE/);
    await db.doc(`tenants/${REAL}/config/venta`).set({ costoDelivery: 7 });
    expect(correr(base(REAL)).salida).toMatch(/AUSENTE/);
  }, 60_000);

  it('sin --proyecto no hay conexión: solo valida la fila', () => {
    const r = correr(['--tenant', REAL, '--marcador', MARC, '--archivo', archivoCon(LOCAL)], undefined);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/no se abrió ninguna conexión/);
    sinValores(r.salida);
  });

  it('--aplicar cambia solo mediaIdQr y el sello; cobroReal y lo demás intactos', async () => {
    const r = correr(base(REAL, ['--aplicar']));
    expect(r.codigo, r.salida).toBe(0);
    sinValores(r.salida);
    const d = await db.doc(`tenants/${REAL}/config/venta`).get();
    expect(d.get('mediaIdQr')).toBe(LOCAL);
    expect(d.get('actualizadoPor')).toBe('escribir-qr-comercio');
    expect(d.get('cobroReal')).toEqual({ activo: true, banco: 'x' });
    expect(d.get('costoDelivery')).toBe(7);
    expect(Object.keys(d.data() ?? {}).sort())
      .toEqual(['actualizadoEn', 'actualizadoPor', 'cobroReal', 'costoDelivery', 'mediaIdQr']);
    expect((await db.collection(`tenants/${REAL}/config`).get()).size).toBe(1);
    const aud = await db.collection(`tenants/${REAL}/auditoria`).get();
    expect(aud.size).toBe(1);
    expect(JSON.stringify(aud.docs[0]!.data())).not.toContain(LOCAL);
  }, 60_000);

  it('el marcador de demo o sin el prefijo, NEGADO', async () => {
    for (const m of ['REEMPLAZAR_MEDIA_ID_QR_DEMO', 'REEMPLAZAR_OTRO', 'REEMPLAZAR_MEDIA_ID_QR_', 'media_id_qr_x']) {
      const r = correr(['--tenant', REAL, '--proyecto', PROYECTO, '--aplicar', '--marcador', m,
        '--archivo', archivoCon(LOCAL, 'm.md', 1, m)]);
      expect(r.codigo, m).toBe(1);
      expect(r.salida).toMatch(/NEGADO/);
      sinValores(r.salida);
    }
    expect(await mediaId(REAL)).toBe(VIEJO);
  }, 60_000);

  it('sin --archivo ni CONFIG_LOCAL, NEGADO (no hay lectura por omisión)', () => {
    const r = correr(['--tenant', REAL, '--marcador', MARC]);
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/NEGADO.*--archivo/s);
  });

  it('fila vacía, pendiente o con forma inválida: aborta sin escribir', async () => {
    const casos: Array<string | null> = [null, '', 'pendiente', 'ABC123', '12345', '1'.repeat(21), '12 345 678 901'];
    for (const [i, valor] of casos.entries()) {
      const r = correr(base(REAL, ['--aplicar'], archivoCon(valor, `caso-${i}.md`)));
      expect(r.codigo, `caso ${i}: ${r.salida}`).toBe(1);
      expect(r.salida).toMatch(/NEGADO/);
      sinValores(r.salida);
    }
    expect(await mediaId(REAL)).toBe(VIEJO);
  }, 60_000);

  it('una fila repetida, NEGADO', () => {
    const r = correr(base(REAL, ['--aplicar'], archivoCon(LOCAL, 'dup.md', 2)));
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/NEGADO.*repetida/s);
    sinValores(r.salida);
  });

  it('--aplicar exige --proyecto y --tenant', () => {
    const a = archivoCon(LOCAL);
    expect(correr(['--tenant', REAL, '--marcador', MARC, '--aplicar', '--archivo', a]).codigo).toBe(1);
    expect(correr(['--proyecto', PROYECTO, '--marcador', MARC, '--aplicar', '--archivo', a]).codigo).toBe(1);
  });

  it('un tenant inexistente, NEGADO', async () => {
    const r = correr(base('no-existe-xyz', ['--aplicar']));
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/NEGADO.*no existe/s);
  }, 60_000);

  it('un tenant demo (creadoPor sembrar-demos), NEGADO en seco y en aplicar', async () => {
    for (const extra of [[], ['--aplicar']]) {
      const r = correr(base(DEMO, extra));
      expect(r.codigo, r.salida).toBe(1);
      expect(r.salida).toMatch(/NEGADO.*demo/s);
    }
    expect(await mediaId(DEMO)).toBe(VIEJO);
  }, 60_000);

  it('un tenant sin la venta habilitada, NEGADO; con config/venta ausente y sin flujo, también', async () => {
    let r = correr(base(SIN_VENTA, ['--aplicar']));
    // Tiene el documento config/venta (sembrado), así que pasa por el segundo criterio.
    expect(r.codigo, r.salida).toBe(0);
    await db.doc(`tenants/${SIN_VENTA}/config/venta`).delete();
    r = correr(base(SIN_VENTA, ['--aplicar']));
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/NEGADO.*venta habilitada/s);
    expect((await db.doc(`tenants/${SIN_VENTA}/config/venta`).get()).exists).toBe(false);
  }, 60_000);

  it('con emulador heredado y proyecto no demo-*, NEGADO; con demo-* dice EMULADOR', () => {
    const r = correr(['--tenant', REAL, '--proyecto', 'novuchat-real', '--aplicar',
      '--marcador', MARC, '--archivo', archivoCon(LOCAL)]);
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/NEGADO.*FIRESTORE_EMULATOR_HOST/s);
    expect(correr(base(REAL)).salida).toMatch(/\(EMULADOR\)/);
  });

  it('un archivo inexistente aborta sin imprimir su ruta', () => {
    const r = correr(['--tenant', REAL, '--marcador', MARC, '--archivo', join(tmp, 'no-existe.md')]);
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/NEGADO/);
    expect(r.salida).not.toContain('no-existe.md');
  });
});
