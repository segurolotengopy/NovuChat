/**
 * `scripts/datos/rroca-ruben/cargar-campanas.mjs` — LOS ANUNCIOS DE RUBÉN, CONTRA EL EMULADOR.
 *
 * El script escribe con el SDK Admin, que se salta las reglas de Firestore: lo único que impide cargar un anuncio con monto, más campañas de las que admite el plan,
 * un producto inexistente o en un comercio suspendido es su propia validación (la del servidor, sin modelo). Por eso se prueba ejecutándolo de verdad, como proceso,
 * y se escribe negando: lo que no debe entrar, no entra, y SIN `--aplicar` no se escribe nada.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entornoDelEmulador } from '../../core/entorno-del-hijo.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '../../../scripts/datos/rroca-ruben/cargar-campanas.mjs');
const ARCHIVO = join(aqui, '../../../scripts/datos/rroca-ruben/campanas-rroca-ruben.json');
const PROYECTO = 'demo-novuchat-pruebas';
const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;

const { initializeApp, getApps } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const app = getApps().find((a) => a.name === 'cargar-campanas') ?? initializeApp({ projectId: PROYECTO }, 'cargar-campanas');
const db = getFirestore(app);

const T = 'camp-ruben';           // plan pro
const T_CHICO = 'camp-ruben-3';   // plan crecimiento (3 campañas)
const T_SUSP = 'camp-ruben-susp';
const T_SIN_PRODUCTO = 'camp-ruben-sinprod';
const TODOS = [T, T_CHICO, T_SUSP, T_SIN_PRODUCTO];

const tmp = mkdtempSync(join(tmpdir(), 'cargar-campanas-'));
const base = JSON.parse(readFileSync(ARCHIVO, 'utf8')) as { anuncios: Array<Record<string, unknown>>; tenant: string };
/** El archivo aprobado con el tenant pedido y la coma en lugar del «;» tras «100 prompts» (el servidor rechaza ese «;»: ver campanas.test.ts). */
const bueno = (tenant: string, mod: (d: { anuncios: Array<Record<string, unknown>>; tenant: string }) => void = () => undefined): { anuncios: Array<Record<string, unknown>>; tenant: string } => {
  const d = JSON.parse(JSON.stringify(base)) as typeof base;
  d.tenant = tenant;
  d.anuncios[2]!['angulo'] = String(d.anuncios[2]!['angulo']).replace('100 prompts; pregunta', '100 prompts. Pregunta');
  mod(d);
  return d;
};
function archivo(nombre: string, datos: unknown): string {
  const ruta = join(tmp, `${nombre}.json`);
  writeFileSync(ruta, JSON.stringify(datos));
  return ruta;
}
function correr(tenant: string, ruta: string, ...extra: string[]): { codigo: number | null; salida: string } {
  const r = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO, '--tenant', tenant, '--archivo', ruta, ...extra], { env: entornoDelEmulador(HOST), encoding: 'utf8' });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
}
const lista = async (t: string): Promise<Array<Record<string, unknown>>> => ((await db.doc(`tenants/${t}/config/campanas`).get()).get('lista') ?? []) as Array<Record<string, unknown>>;

beforeAll(async () => {
  for (const t of TODOS) {
    await db.doc(`tenants/${t}/config/campanas`).delete();
    await db.doc(`tenants/${t}/catalogo/libro-bonos`).delete();
  }
  const sembrar = async (t: string, plan: string, estado = 'activo', conProducto = true): Promise<void> => {
    await db.doc(`tenants/${t}`).set({ nombre: t, estado, vertical: 'venta', flujos: ['venta'] });
    await db.doc(`tenants/${t}/cuenta/estado`).set({ plan });
    if (conProducto) await db.doc(`tenants/${t}/catalogo/libro-bonos`).set({ nombre: 'Libro + bonos', precio: 32, activo: true });
  };
  await sembrar(T, 'pro');
  await sembrar(T_CHICO, 'crecimiento');
  await sembrar(T_SUSP, 'pro', 'suspendido');
  await sembrar(T_SIN_PRODUCTO, 'pro', 'activo', false);
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('cargar-campanas.mjs (los anuncios de Rubén)', () => {
  it('sin los argumentos, o con uno desconocido, no hace nada', () => {
    const a = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO], { env: entornoDelEmulador(HOST), encoding: 'utf8' });
    expect(a.status).toBe(2);
    expect(`${a.stdout}${a.stderr}`).toMatch(/--tenant inválido/);
    const b = correr(T, archivo('ok0', bueno(T)), '--forzar');
    expect(b.codigo).toBe(2);
    expect(b.salida).toMatch(/argumento desconocido/);
  });

  it('en SECO (por omisión) dice qué cargaría y NO escribe: ni la lista, ni el sello, ni la auditoría', async () => {
    const r = correr(T, archivo('seco', bueno(T)));
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/Seco: no se escribió nada/);
    expect(r.salida).toMatch(/anuncios del archivo: 5/);
    expect(r.salida).toMatch(/nuevo\s+asistente-de-negocio/);
    expect(r.salida).not.toContain('capítulos 9'); // los textos largos no se imprimen
    expect(await lista(T)).toEqual([]);
    expect((await db.doc(`tenants/${T}/config/campanas`).get()).exists).toBe(false);
  });

  it('con --aplicar escribe la lista (5 anuncios, con fechas de hoy), el sello y la auditoría; NO escribe `revision` ni `vigentes` (son del servidor)', async () => {
    const r = correr(T, archivo('aplicar', bueno(T)), '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/✓ Verificación por relectura/);
    const doc = (await db.doc(`tenants/${T}/config/campanas`).get()).data() ?? {};
    const l = doc['lista'] as Array<Record<string, unknown>>;
    expect(l.map((c) => c['id'])).toEqual(['asistente-de-negocio', 'usando-la-ia-realmente', 'que-publicar', 'tiempo-automatizar', 'chatgpt-sin-saber-usarlo']);
    for (const c of l) {
      expect(Object.keys(c).sort()).toEqual(['angulo', 'fin', 'id', 'inicio', 'productoId', 'texto', 'titulares']);
      expect(c['productoId']).toBe('libro-bonos');
      expect(String(c['inicio'])).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(String(c['fin']) > String(c['inicio'])).toBe(true);
    }
    expect(doc['actualizadoPor']).toBe('cargar-campanas');
    expect(doc['revision']).toBeUndefined();
    expect(doc['vigentes']).toBeUndefined();
    const auditoria = await db.collection(`tenants/${T}/auditoria`).where('accion', '==', 'cargar_campanas').get();
    expect(auditoria.size).toBeGreaterThanOrEqual(1);
    expect(auditoria.docs[0]!.get('conteos')).toMatchObject({ anuncios: 5, conservadas: 0 });
  });

  it('repetir la carga no duplica ni cambia: los 5 salen «igual»; una campaña ajena del comercio se conserva', async () => {
    const antes = await lista(T);
    await db.doc(`tenants/${T}/config/campanas`).set({ lista: [...antes, { id: 'otra-campana', texto: 'Hola, quiero el libro', inicio: antes[0]!['inicio'], fin: antes[0]!['fin'] }] }, { merge: true });
    // El comercio ya tiene 6 y el plan pro admite 10: caben.
    const r = correr(T, archivo('repetir', bueno(T)), '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect((r.salida.match(/\bigual\b/g) ?? []).length).toBeGreaterThanOrEqual(5);
    const despues = await lista(T);
    expect(despues).toHaveLength(6);
    expect(despues.filter((c) => c['id'] === 'otra-campana')).toHaveLength(1);
    expect(despues.slice(0, 5).map((c) => c['id'])).toEqual(antes.map((c) => c['id']));
  });

  it('NEGADO: más anuncios de los que admite el plan (crecimiento = 3) no se cargan ni se recortan en silencio', async () => {
    const r = correr(T_CHICO, archivo('chico', bueno(T_CHICO)), '--aplicar');
    expect(r.codigo, r.salida).toBe(1);
    expect(r.salida).toMatch(/plan del comercio admite 3/);
    expect(await lista(T_CHICO)).toEqual([]);
    // Con tres sí caben.
    const tres = correr(T_CHICO, archivo('tres', bueno(T_CHICO, (d) => { d.anuncios = d.anuncios.slice(0, 3); })), '--aplicar');
    expect(tres.codigo, tres.salida).toBe(0);
    expect(await lista(T_CHICO)).toHaveLength(3);
  });

  it('NEGADO: un producto que no es un documento ACTIVO del catálogo del comercio, un comercio suspendido o inexistente, y un archivo de otro comercio', async () => {
    const sinProducto = correr(T_SIN_PRODUCTO, archivo('sinprod', bueno(T_SIN_PRODUCTO)), '--aplicar');
    expect(sinProducto.codigo).toBe(1);
    expect(sinProducto.salida).toMatch(/libro-bonos.*no existe o no está activo/);
    expect(await lista(T_SIN_PRODUCTO)).toEqual([]);
    const susp = correr(T_SUSP, archivo('susp', bueno(T_SUSP)), '--aplicar');
    expect(susp.codigo).toBe(1);
    expect(susp.salida).toMatch(/no está activo/);
    expect(await lista(T_SUSP)).toEqual([]);
    const fantasma = correr('camp-ruben-fantasma', archivo('fantasma', bueno('camp-ruben-fantasma')), '--aplicar');
    expect(fantasma.codigo).toBe(1);
    expect(fantasma.salida).toMatch(/No existe el comercio/);
    const ajeno = correr(T, archivo('ajeno', bueno('otro-comercio')), '--aplicar');
    expect(ajeno.codigo).toBe(2);
    expect(ajeno.salida).toMatch(/es del comercio «otro-comercio»/);
  });

  it('NEGADO: un titular con monto, un ángulo de más de 300 caracteres y un titular repetido en otro anuncio se rechazan antes de escribir', async () => {
    for (const [nombre, mod, esperado] of [
      ['monto', (d: ReturnType<typeof bueno>) => { d.anuncios[0]!['titulares'] = ['Desde solo 32 Bs en libros']; }, /no lleva montos/],
      ['angulo-largo', (d: ReturnType<typeof bueno>) => { d.anuncios[0]!['angulo'] = 'a'.repeat(301); }, /el máximo es 300/],
      ['repetido', (d: ReturnType<typeof bueno>) => { d.anuncios[1]!['titulares'] = [(d.anuncios[0]!['titulares'] as string[])[0]!]; }, /ya lo usa el anuncio/],
    ] as Array<[string, (d: ReturnType<typeof bueno>) => void, RegExp]>) {
      const antes = await lista(T_SIN_PRODUCTO);
      const r = correr(T_SIN_PRODUCTO, archivo(nombre, bueno(T_SIN_PRODUCTO, mod)), '--aplicar');
      expect(r.codigo, nombre).toBe(2);
      expect(r.salida, nombre).toMatch(esperado);
      expect(await lista(T_SIN_PRODUCTO), nombre).toEqual(antes);
    }
  });
});
