/**
 * `scripts/datos/rroca-antonio/cargar-campanas.mjs` — LAS CAMPAÑAS DE ANTONIO, CONTRA EL EMULADOR (proyecto de pruebas, nunca producción).
 *
 * El script escribe con el SDK Admin, que se salta las reglas de Firestore: lo único que impide cargar una campaña con monto, más de las que admite el plan, un producto inexistente
 * o en un comercio suspendido es su propia validación. Se prueba ejecutándolo como proceso y negando: lo que no debe entrar, no entra; SIN `--aplicar` no se escribe nada;
 * y una campaña marcada `pendiente_de_termino_registrado` queda fuera del lote.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entornoDelEmulador } from '../../core/entorno-del-hijo.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '../../../scripts/datos/rroca-antonio/cargar-campanas.mjs');
const ARCHIVO = join(aqui, '../../../scripts/datos/rroca-antonio/campanas-rroca-antonio.json');
const PROYECTO = 'demo-novuchat-pruebas';
const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;

const { initializeApp, getApps } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const app = getApps().find((a) => a.name === 'cargar-campanas-antonio') ?? initializeApp({ projectId: PROYECTO }, 'cargar-campanas-antonio');
const db = getFirestore(app);

const T = 'camp-antonio';             // plan pro (10)
const T_CHICO = 'camp-antonio-3';     // plan crecimiento (3)
const T_SUSP = 'camp-antonio-susp';
const T_SIN_PRODUCTO = 'camp-antonio-sinprod';
const TODOS = [T, T_CHICO, T_SUSP, T_SIN_PRODUCTO];
const PRODUCTOS = ['pack-completo', 'libro'];

const tmp = mkdtempSync(join(tmpdir(), 'cargar-campanas-antonio-'));
type Datos = { anuncios: Array<Record<string, unknown>>; tenant: string };
const base = JSON.parse(readFileSync(ARCHIVO, 'utf8')) as Datos;
const bueno = (tenant: string, mod: (d: Datos) => void = () => undefined): Datos => { const d = JSON.parse(JSON.stringify(base)) as Datos; d.tenant = tenant; mod(d); return d; };
const archivo = (nombre: string, datos: unknown): string => { const ruta = join(tmp, `${nombre}.json`); writeFileSync(ruta, JSON.stringify(datos)); return ruta; };
function correr(tenant: string, ruta: string, ...extra: string[]): { codigo: number | null; salida: string } {
  const r = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO, '--tenant', tenant, '--archivo', ruta, ...extra], { env: entornoDelEmulador(HOST), encoding: 'utf8' });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
}
const lista = async (t: string): Promise<Array<Record<string, unknown>>> => ((await db.doc(`tenants/${t}/config/campanas`).get()).get('lista') ?? []) as Array<Record<string, unknown>>;

beforeAll(async () => {
  for (const t of TODOS) {
    await db.doc(`tenants/${t}/config/campanas`).delete();
    for (const p of PRODUCTOS) await db.doc(`tenants/${t}/catalogo/${p}`).delete();
  }
  const sembrar = async (t: string, plan: string, estado = 'activo', conProducto = true): Promise<void> => {
    await db.doc(`tenants/${t}`).set({ nombre: t, estado, vertical: 'venta', flujos: ['venta'] });
    await db.doc(`tenants/${t}/cuenta/estado`).set({ plan });
    if (conProducto) for (const p of PRODUCTOS) await db.doc(`tenants/${t}/catalogo/${p}`).set({ nombre: p, precio: 10, activo: true });
  };
  // El catálogo de prueba lleva los productos que usan las campañas (el pack y el libro); sus precios no importan: el archivo no lleva ninguno.
  await sembrar(T, 'pro'); await sembrar(T_CHICO, 'crecimiento'); await sembrar(T_SUSP, 'pro', 'suspendido'); await sembrar(T_SIN_PRODUCTO, 'pro', 'activo', false);
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('cargar-campanas.mjs (las campañas de Antonio)', () => {
  it('sin los argumentos, o con uno desconocido, no hace nada', () => {
    const a = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO], { env: entornoDelEmulador(HOST), encoding: 'utf8' });
    expect(a.status).toBe(2);
    expect(`${a.stdout}${a.stderr}`).toMatch(/--tenant inválido/);
    expect(correr(T, archivo('ok0', bueno(T)), '--forzar').codigo).toBe(2);
  });
  it('en SECO (por omisión) dice qué cargaría y NO escribe: ni la lista, ni el sello, ni la auditoría', async () => {
    const r = correr(T, archivo('seco', bueno(T)));
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/Seco: no se escribió nada/);
    expect(r.salida).toMatch(new RegExp(`anuncios del archivo: ${base.anuncios.filter((a) => a['pendiente_de_termino_registrado'] !== true).length}`));
    expect(await lista(T)).toEqual([]);
    expect((await db.doc(`tenants/${T}/config/campanas`).get()).exists).toBe(false);
  });
  it('una campaña marcada `pendiente_de_termino_registrado` queda FUERA del lote: se dice y no se escribe', async () => {
    const r = correr(T, archivo('pend', bueno(T, (d) => { d.anuncios[6]!['pendiente_de_termino_registrado'] = true; })));
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/Fuera del lote \(pendientes de término registrado\): cien-preguntas/);
    expect(r.salida).toMatch(new RegExp(`anuncios del archivo: ${base.anuncios.length - 1}\\b`));
    expect(r.salida).not.toMatch(/nuevo\s+cien-preguntas/);
  });
  it('con --aplicar (en el emulador) escribe la lista con fechas de hoy, el sello y la auditoría; NO escribe `revision` ni `vigentes`', async () => {
    const r = correr(T, archivo('aplicar', bueno(T)), '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/✓ Verificación por relectura/);
    const doc = (await db.doc(`tenants/${T}/config/campanas`).get()).data() ?? {};
    const l = doc['lista'] as Array<Record<string, unknown>>;
    expect(l.map((c) => c['id'])).toEqual(base.anuncios.map((a) => a['id']));
    for (const c of l) expect(Object.keys(c).sort()).toEqual(['angulo', 'fin', 'id', 'inicio', 'productoId', 'texto', 'titulares']);
    expect(doc['actualizadoPor']).toBe('cargar-campanas');
    expect(doc['revision']).toBeUndefined();
    expect(doc['vigentes']).toBeUndefined();
  });
  it('NEGADO: más campañas de las que admite el plan (crecimiento = 3) no se cargan ni se recortan en silencio', async () => {
    const r = correr(T_CHICO, archivo('chico', bueno(T_CHICO)), '--aplicar');
    expect(r.codigo, r.salida).toBe(1);
    expect(r.salida).toMatch(/plan del comercio admite 3/);
    expect(await lista(T_CHICO)).toEqual([]);
  });
  it('NEGADO: un producto que no es un documento ACTIVO del catálogo, un comercio suspendido o inexistente, y un archivo de otro comercio', async () => {
    const sinProducto = correr(T_SIN_PRODUCTO, archivo('sinprod', bueno(T_SIN_PRODUCTO)), '--aplicar');
    expect(sinProducto.codigo).toBe(1);
    expect(sinProducto.salida).toMatch(/no existe o no está activo/);
    expect(await lista(T_SIN_PRODUCTO)).toEqual([]);
    expect(correr(T_SUSP, archivo('susp', bueno(T_SUSP)), '--aplicar').salida).toMatch(/no está activo/);
    expect(correr('camp-antonio-fantasma', archivo('fantasma', bueno('camp-antonio-fantasma')), '--aplicar').salida).toMatch(/No existe el comercio/);
    const ajeno = correr(T, archivo('ajeno', bueno('otro-comercio')), '--aplicar');
    expect(ajeno.codigo).toBe(2);
    expect(ajeno.salida).toMatch(/es del comercio «otro-comercio»/);
  });
  it('NEGADO: un titular con monto y un ángulo de más de 300 caracteres se rechazan antes de escribir', async () => {
    for (const [nombre, mod, esperado] of [
      ['monto', (d: Datos) => { d.anuncios[0]!['titulares'] = ['Libro digital Bs 35']; }, /no lleva montos/],
      ['angulo-largo', (d: Datos) => { d.anuncios[0]!['angulo'] = 'a'.repeat(301); }, /el máximo es 300/],
    ] as Array<[string, (d: Datos) => void, RegExp]>) {
      const antes = await lista(T_SIN_PRODUCTO);
      const r = correr(T_SIN_PRODUCTO, archivo(nombre, bueno(T_SIN_PRODUCTO, mod)), '--aplicar');
      expect(r.codigo, nombre).toBe(2);
      expect(r.salida, nombre).toMatch(esperado);
      expect(await lista(T_SIN_PRODUCTO), nombre).toEqual(antes);
    }
  });
});
