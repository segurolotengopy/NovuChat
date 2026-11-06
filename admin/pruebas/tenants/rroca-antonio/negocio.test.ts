/**
 * «EL PUENTE DE ANTONIO» (tenant rroca-antonio) — PR-C, LOS DATOS DEL NEGOCIO (`admin/scripts/datos/rroca-antonio/negocio-rroca-antonio.json`).
 *
 * Niega: que el catálogo no sea el que lee el flujo (`raCatalogo`: 6 ids que salen del nombre, precios 49, 35, 20, 18, 15 y 18 Bs (el MD modificado, 24/10/2026), todos activos); que el archivo traiga una sección que
 * `cargar-negocio.mjs` no admite, un secreto, un teléfono o una cuenta; y que sea APLICABLE mientras tenga marcadores `REEMPLAZAR_*` fuera de `numeroRecepcionMarcador`.
 * No toca Firestore: la carga real es del script con «sí» de Andres.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from '../../core/entorno-del-hijo.ts';
import { cargarLibrerias } from './librerias';

const AQUI = dirname(fileURLToPath(import.meta.url));
const REPO = join(AQUI, '../../../..');
const NEGOCIO = join(REPO, 'admin/scripts/datos/rroca-antonio/negocio-rroca-antonio.json');
const TEXTO = readFileSync(NEGOCIO, 'utf8');
type Item = { nombre: string; precio: number; moneda: string; activo: boolean };
const D = JSON.parse(TEXTO) as Record<string, any> & { catalogo: Item[] };
const idDe = (nombre: string): string => nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const L = cargarLibrerias('raCatalogo') as { raCatalogo: (c: unknown) => Record<string, number> };

const ESPERADO: Record<string, number> = { 'pack-completo': 49, libro: 35, workbook: 20, 'guia-de-conversaciones': 18, 'calendario-de-conexion': 15, 'preguntas-profundas': 18 };

describe('negocio-rroca-antonio.json: el catálogo es el que espera el flujo', () => {
  it('tiene exactamente los 6 productos, con los ids que salen del nombre y los precios del guion', () => {
    expect(D.catalogo).toHaveLength(6);
    expect(Object.fromEntries(D.catalogo.map((it) => [idDe(it.nombre), it.precio]))).toEqual(ESPERADO);
  });
  it('moneda BOB, ítems activos (todos DISPONIBLES) y precios positivos', () => {
    expect(D['negocio'].moneda).toBe('BOB');
    for (const it of D.catalogo) { expect(it.moneda).toBe('BOB'); expect(it.activo).toBe(true); expect(it.precio).toBeGreaterThan(0); }
  });
  it('`raCatalogo` lee los 6 productos con esos precios (como los sirve la consola: id + precio)', () => {
    const consola = { catalogo: D.catalogo.map((it) => ({ id: idDe(it.nombre), precio: it.precio })) };
    expect(L.raCatalogo(consola)).toEqual({ pack: 49, libro: 35, workbook: 20, guia: 18, calendario: 15, preguntas: 18 });
  });
  it('negando: un nombre que cambia deja al producto fuera del catálogo del flujo', () => {
    const consola = { catalogo: D.catalogo.map((it) => ({ id: idDe(it.nombre === 'Pack completo' ? 'Pack total' : it.nombre), precio: it.precio })) };
    expect(L.raCatalogo(consola)['pack']).toBeUndefined();
  });
  it('solo trae las secciones que cargar-negocio.mjs admite (negocio y catalogo), sin voseo', () => {
    expect(Object.keys(D).filter((k) => !k.startsWith('_')).sort()).toEqual(['catalogo', 'negocio']);
    expect(TEXTO).not.toMatch(/\b(vos|tenés|querés|podés|sos)\b/i);
  });
});

describe('negocio-rroca-antonio.json: repositorio público y marcadores', () => {
  it('no trae secretos, teléfonos, cuentas, enlaces ni secuencias largas de dígitos', () => {
    expect(TEXTO).not.toMatch(/\b\d{8,}\b/);
    expect(TEXTO).not.toMatch(/(token|secret|api[_-]?key|bearer|password|contrase)/i);
    expect(TEXTO).not.toMatch(/https?:\/\//i);
    expect(TEXTO).not.toMatch(/\+\d{6,}/);
  });
  const PENDIENTES = ['REEMPLAZAR_NUMERO_RECEPCION_ANTONIO'];
  it('solo queda el marcador del número de recepción (razón comercial y horario 24/7 ya resueltos)', () => {
    expect([...new Set(TEXTO.match(/REEMPLAZAR_[A-Z0-9_]+/g))].sort()).toEqual(PENDIENTES);
    expect(D['negocio'].numeroRecepcionMarcador).toBe('REEMPLAZAR_NUMERO_RECEPCION_ANTONIO');
    expect(D['negocio']).not.toHaveProperty('numeroRecepcion');
  });
});

describe('cargar-negocio.mjs --aplicar niega cualquier REEMPLAZAR_ fuera de los campos *Marcador', () => {
  const SCRIPT = join(REPO, 'admin/scripts/datos/cargar-negocio.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'rroca-ant-neg-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const local = join(dir, 'local.md');
  writeFileSync(local, '| `REEMPLAZAR_NUMERO_RECEPCION_ANTONIO` | 71234567 | prueba |\n');
  const correr = (archivo: string, ...extra: string[]) => {
    const r = spawnSync(process.execPath, [SCRIPT, '--proyecto', 'proyecto-de-prueba', '--tenant', 'rroca-antonio', '--archivo', archivo, '--local', local, ...extra], { encoding: 'utf8', env: entornoDelEmulador(undefined) });
    return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
  };
  it('un archivo con marcadores fuera de los campos *Marcador se NIEGA con --aplicar, nombra dónde falta cada dato y no imprime el número', () => {
    const conMarcadores = join(dir, 'con-marcadores.json');
    const copia = JSON.parse(readFileSync(NEGOCIO, 'utf8'));
    copia._pendiente.razonComercial = 'REEMPLAZAR_RAZON_COMERCIAL_ANTONIO';
    copia._pendiente.horarioDeRecepcion = 'REEMPLAZAR_HORARIO_RECEPCION_ANTONIO';
    writeFileSync(conMarcadores, JSON.stringify(copia));
    const r = correr(conMarcadores, '--aplicar');
    expect(r.codigo).toBe(2);
    expect(r.salida).toMatch(/NEGADO.*fuera de los campos \*Marcador/);
    expect(r.salida).toContain('_pendiente.razonComercial');
    expect(r.salida).toContain('_pendiente.horarioDeRecepcion');
    expect(r.salida).not.toContain('71234567');
  });
  it('el contrato del script acepta el archivo (ninguna sección ni clave desconocida)', () => {
    const r = correr(NEGOCIO);
    expect(r.salida).not.toMatch(/sección desconocida|clave desconocida|no está en el contrato/);
  });
});
