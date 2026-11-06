/**
 * `scripts/datos/qtaco/cargar-productos-promos.mjs` — crea dos productos de la campaña «Tortas mexicanas» en el
 * catálogo de qtaco. Sin emulador ni nube: lógica pura y una base en memoria. Se NIEGA primero:
 *   E1. Argumentos y salvaguarda: otro tenant, proyecto equivocado, producción sin confirmación, sin respaldo.
 *   E2. Seco: no escribe. No pisa un id; no duplica un nombre equivalente; tope del plan; contador desfasado.
 *   E3. Aplicar: solo esos dos ítems con las claves de la regla de create y el contador +2.
 *   E4. Reversa: borra solo lo idéntico a lo creado.
 *   E5. El texto del script y el respaldo de límites contra las reglas.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const ADMIN = join(aqui, '..', '..', '..');
const SCRIPT = join(ADMIN, 'scripts', 'datos', 'qtaco', 'cargar-productos-promos.mjs');
type Cfg = Record<string, unknown>;
type Doc = Record<string, unknown>;
// @ts-expect-error el script es un .mjs sin tipos
const mod = await import('../../../scripts/datos/qtaco/cargar-productos-promos.mjs') as unknown as {
  analizarArgumentos: (a: string[], env?: Record<string, string>) => { ok: boolean; problemas?: string[]; cfg?: Cfg };
  ejecutar: (cfg: Cfg, deps: Record<string, unknown>) => Promise<number>;
  evaluar: (e: Record<string, unknown>) => { bloqueos: string[]; limite: number; caben: number };
  limiteDeProductos: (c: unknown) => number;
  nombreEquivalente: (n: string) => boolean;
  PRODUCTOS: { id: string; nombre: string; precio: number; area: string }[];
  PRODUCTOS_POR_PLAN_RESPALDO: Record<string, number>;
};

const ENV_EMU = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:1' };
const PROY = 'demo-novuchat-pruebas';
const ENV_REAL = { GCP_PROJECT_ID_STAGING: 'proyecto-ficticio-staging', GCP_PROJECT_ID_PROD: 'proyecto-ficticio-prod' };
const dirs: string[] = [];
const rutaRespaldo = () => {
  const d = mkdtempSync(join(tmpdir(), 'promos-')); chmodSync(d, 0o700); dirs.push(d);
  return join(d, 'respaldo.json');
};
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const BASE = ['--proyecto', PROY, '--tenant', 'qtaco'];
const cfgSeco = (extra: Cfg = {}): Cfg => ({ proyecto: PROY, entorno: 'emulador', tenant: 'qtaco', aplicar: false, revertir: false, respaldo: null, ...extra });

/** Firestore en memoria con transacciones, `create` con precondición y registro de escrituras. */
function baseDe(inicial: Record<string, Doc>, opciones: { alLeerCambia?: () => void } = {}) {
  const datos: Record<string, Doc> = JSON.parse(JSON.stringify(inicial));
  const escrituras: { op: string; ruta: string; datos?: Doc }[] = [];
  const lecturas: string[] = [];
  const ref = (r: string) => ({ ruta: r });
  const snap = (r: string) => ({ exists: r in datos, id: r.split('/').pop()!, data: () => (r in datos ? datos[r] : undefined) });
  const prefijo = 'tenants/qtaco/catalogo/';
  const coleccion = (ruta: string) => ({
    select: () => ({
      get: async () => {
        lecturas.push(`coleccion:${ruta}`);
        const docs = Object.keys(datos).filter((k) => k.startsWith(`${ruta}/`)).map((k) => snap(k));
        return { docs, size: docs.length };
      },
    }),
  });
  const aplicar = (op: string, r: { ruta: string }, d?: Doc) => {
    if (op === 'create' && r.ruta in datos) throw Object.assign(new Error('existe'), { code: 6 });
    escrituras.push({ op, ruta: r.ruta, datos: d });
    if (op === 'delete') delete datos[r.ruta]; else datos[r.ruta] = { ...(op === 'set' ? {} : {}), ...d! };
  };
  const db = {
    doc: ref,
    collection: coleccion,
    getAll: async (...refs: { ruta: string }[]) => { for (const r of refs) lecturas.push(r.ruta); return refs.map((r) => snap(r.ruta)); },
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      opciones.alLeerCambia?.();
      const pendientes: (() => void)[] = [];
      const tx = {
        getAll: db.getAll,
        get: (q: { get: () => Promise<unknown> }) => q.get(),
        create: (r: { ruta: string }, d: Doc) => pendientes.push(() => aplicar('create', r, d)),
        set: (r: { ruta: string }, d: Doc) => pendientes.push(() => aplicar('set', r, d)),
        delete: (r: { ruta: string }) => pendientes.push(() => aplicar('delete', r)),
      };
      const res = await fn(tx);
      pendientes.forEach((f) => f());
      return res;
    },
  };
  return { db, datos, escrituras, lecturas, prefijo };
}
const FieldValue = { serverTimestamp: () => '<ts>' };
const tenantOk: Record<string, Doc> = { 'tenants/qtaco': { estado: 'activo', modulos: ['productos'] }, 'tenants/qtaco/cuenta/estado': { plan: 'pro' } };
const catalogo = (n: number, extra: Record<string, Doc> = {}) => {
  const r: Record<string, Doc> = { ...tenantOk, 'tenants/qtaco/contadores/catalogo': { items: n, ultimoItem: 'x' }, ...extra };
  for (let i = 0; i < n; i++) r[`tenants/qtaco/catalogo/it-${i}`] = { nombre: `Ítem ${i}`, area: 'tacos' };
  return r;
};
const correr = async (cfg: Cfg, inicial: Record<string, Doc>, opciones = {}) => {
  const b = baseDe(inicial, opciones); const salida: string[] = [];
  const codigo = await mod.ejecutar(cfg, { db: b.db, FieldValue, log: (t: string) => salida.push(t) });
  return { ...b, codigo, salida: salida.join('\n') };
};

describe('E1. argumentos y salvaguarda', () => {
  it('rechaza otro tenant', () => {
    const r = mod.analizarArgumentos(['--proyecto', PROY, '--tenant', 'bellido'], ENV_EMU);
    expect(r.ok).toBe(false);
    expect(r.problemas!.join()).toContain('lista cerrada');
  });
  it('rechaza proyecto equivocado y opciones desconocidas', () => {
    expect(mod.analizarArgumentos(['--proyecto', 'otro-proyecto-cualquiera', '--tenant', 'qtaco'], ENV_REAL).ok).toBe(false);
    expect(mod.analizarArgumentos([...BASE, '--items', 'x'], ENV_EMU).ok).toBe(false);
  });
  it('--aplicar exige respaldo, y en producción la confirmación', () => {
    expect(mod.analizarArgumentos([...BASE, '--aplicar'], ENV_EMU).problemas!.join()).toContain('--respaldo');
    const r = mod.analizarArgumentos(['--proyecto', 'proyecto-ficticio-prod', '--tenant', 'qtaco', '--aplicar', '--respaldo', rutaRespaldo()], ENV_REAL);
    expect(r.ok).toBe(false);
    expect(r.problemas!.join()).toContain('--confirmo-produccion');
  });
  it('la confirmación de producción debe ser qtaco', () => {
    const r = mod.analizarArgumentos(['--proyecto', 'proyecto-ficticio-prod', '--tenant', 'qtaco', '--confirmo-produccion', 'otro'], ENV_REAL);
    expect(r.ok).toBe(false);
  });
  it('acepta el seco y el aplicar bien formados', () => {
    expect(mod.analizarArgumentos(BASE, ENV_EMU).ok).toBe(true);
    expect(mod.analizarArgumentos(['--proyecto', 'proyecto-ficticio-prod', '--tenant', 'qtaco', '--aplicar', '--respaldo', rutaRespaldo(), '--confirmo-produccion', 'qtaco'], ENV_REAL).ok).toBe(true);
  });
});

describe('E2. seco y bloqueos', () => {
  it('sin --aplicar no escribe nada y lee ficha, cuenta, contador y la colección', async () => {
    const r = await correr(cfgSeco(), catalogo(79));
    expect(r.codigo).toBe(1);
    expect(r.escrituras).toEqual([]);
    expect(r.lecturas).toEqual(['tenants/qtaco', 'tenants/qtaco/cuenta/estado', 'tenants/qtaco/contadores/catalogo', 'coleccion:tenants/qtaco/catalogo']);
    expect(r.salida).toContain('Catálogo: 79 ítems; límite del plan: 500; caben: 421');
  });
  it('no pisa un id existente', async () => {
    const r = await correr(cfgSeco(), catalogo(3, { 'tenants/qtaco/catalogo/promo-torta-con-queso': { nombre: 'Otra cosa', area: 'x' }, 'tenants/qtaco/contadores/catalogo': { items: 4, ultimoItem: 'z' } }));
    expect(r.codigo).toBe(2);
    expect(r.salida).toContain('ya existe');
    expect(r.escrituras).toEqual([]);
  });
  it('se detiene ante un nombre equivalente en otro id', async () => {
    for (const nombre of ['TORTA MEXICANA sin queso', 'Torta Mexicana Especial', 'Torta mexicána con queso']) {
      const r = await correr(cfgSeco(), catalogo(1, { 'tenants/qtaco/catalogo/viejo': { nombre, area: 'promociones' }, 'tenants/qtaco/contadores/catalogo': { items: 2, ultimoItem: 'viejo' } }));
      expect(r.codigo).toBe(2);
      expect(r.salida).toContain('nombre equivalente');
    }
    expect(mod.nombreEquivalente('Torta de jamón')).toBe(false);
    expect(mod.nombreEquivalente('Promo Q\'Taco Dúo')).toBe(false);
  });
  it('tope del plan: con 19 de 20 no caben dos; con 18 sí', async () => {
    const plan = { 'tenants/qtaco/cuenta/estado': { plan: 'impulso' } };
    const lleno = await correr(cfgSeco(), catalogo(19, plan));
    expect(lleno.codigo).toBe(2);
    expect(lleno.salida).toContain('no caben en el plan');
    const justo = await correr(cfgSeco(), catalogo(18, plan));
    expect(justo.codigo).toBe(1);
  });
  it('el límite sale de la cuenta, y un valor corrupto cae al plan (o al menor)', () => {
    expect(mod.limiteDeProductos({ limites: { productos: 81 }, plan: 'pro' })).toBe(81);
    expect(mod.limiteDeProductos({ limites: { productos: 0 }, plan: 'crecimiento' })).toBe(100);
    expect(mod.limiteDeProductos({ limites: { productos: 1e9 }, plan: 'pro' })).toBe(500);
    expect(mod.limiteDeProductos({ plan: 'desconocido' })).toBe(20);
    expect(mod.limiteDeProductos(undefined)).toBe(20);
    expect(mod.limiteDeProductos({ plan: '__proto__' })).toBe(20);
  });
  it('contador corrupto (items no entero) bloquea y no escribe', async () => {
    for (const items of ['3', null, 2.5, undefined]) {
      const r = await correr(cfgSeco({ aplicar: true, respaldo: rutaRespaldo() }), catalogo(3, { 'tenants/qtaco/contadores/catalogo': { items, ultimoItem: 'x' } }));
      expect(r.codigo).toBe(2);
      expect(r.salida).toContain('contador corrupto');
      expect(r.escrituras).toEqual([]);
    }
  });
  it('sin el módulo productos bloquea', async () => {
    for (const modulos of [undefined, [], ['agenda']]) {
      const r = await correr(cfgSeco(), catalogo(3, { 'tenants/qtaco': { estado: 'activo', ...(modulos ? { modulos } : {}) } }));
      expect(r.codigo).toBe(2);
      expect(r.salida).toContain('módulo «productos»');
      expect(r.escrituras).toEqual([]);
    }
  });
  it('comercio no activo o contador desfasado: bloquea', async () => {
    const susp = await correr(cfgSeco(), catalogo(5, { 'tenants/qtaco': { estado: 'suspendido' } }));
    expect(susp.codigo).toBe(2);
    const desfasado = await correr(cfgSeco(), catalogo(5, { 'tenants/qtaco/contadores/catalogo': { items: 9, ultimoItem: 'x' } }));
    expect(desfasado.codigo).toBe(2);
    expect(desfasado.salida).toContain('no coincide');
  });
});

describe('E3. aplicar', () => {
  it('crea solo los dos ítems con las claves de la regla y mueve el contador +2', async () => {
    const respaldo = rutaRespaldo();
    const r = await correr(cfgSeco({ aplicar: true, respaldo }), catalogo(79));
    expect(r.codigo).toBe(0);
    expect(r.escrituras.map((e) => `${e.op} ${e.ruta}`)).toEqual([
      'create tenants/qtaco/catalogo/promo-torta-sin-queso',
      'create tenants/qtaco/catalogo/promo-torta-con-queso',
      'set tenants/qtaco/contadores/catalogo',
    ]);
    expect(r.datos['tenants/qtaco/catalogo/promo-torta-sin-queso']).toEqual({
      nombre: 'Torta mexicana sin queso', descripcion: 'Incluye salsa mexicana especial.', area: 'promociones',
      precio: 15, moneda: 'BOB', activo: true, actualizadoPor: 'cargar-productos-promos', actualizadoEn: '<ts>',
    });
    expect(r.datos['tenants/qtaco/catalogo/promo-torta-con-queso']!.precio).toBe(20);
    expect(r.datos['tenants/qtaco/contadores/catalogo']).toEqual({ items: 81, ultimoItem: 'promo-torta-con-queso', actualizadoEn: '<ts>' });
    expect(statSync(respaldo).mode & 0o777).toBe(0o600);
    // Ninguna otra escritura: solo esos tres documentos
    expect(r.escrituras.length).toBe(3);
  });
  it('si el catálogo cambia entre la lectura y la escritura, no escribe', async () => {
    const b = baseDe(catalogo(79));
    let primera = true;
    const original = b.db.runTransaction;
    b.db.runTransaction = async (fn) => {
      if (primera) { primera = false; b.datos['tenants/qtaco/catalogo/colado'] = { nombre: 'Torta mexicana', area: 'x' }; }
      return original(fn);
    };
    const salida: string[] = [];
    const codigo = await mod.ejecutar(cfgSeco({ aplicar: true, respaldo: rutaRespaldo() }), { db: b.db, FieldValue, log: (t: string) => salida.push(t) });
    expect(codigo).toBe(2);
    expect(b.escrituras).toEqual([]);
  });
  it('no pisa un respaldo existente', async () => {
    const respaldo = rutaRespaldo();
    const a = await correr(cfgSeco({ aplicar: true, respaldo }), catalogo(10));
    expect(a.codigo).toBe(0);
    const b = await correr(cfgSeco({ aplicar: true, respaldo }), catalogo(10));
    expect(b.codigo).toBe(2);
    expect(b.escrituras).toEqual([]);
  });
  it('si no hay contador, lo crea contando la colección', async () => {
    const ini = catalogo(3); delete ini['tenants/qtaco/contadores/catalogo'];
    const r = await correr(cfgSeco({ aplicar: true, respaldo: rutaRespaldo() }), ini);
    expect(r.codigo).toBe(0);
    expect((r.datos['tenants/qtaco/contadores/catalogo'] as { items: number }).items).toBe(5);
  });
});

describe('E4. reversa', () => {
  const crear = async () => {
    const respaldo = rutaRespaldo();
    const a = await correr(cfgSeco({ aplicar: true, respaldo }), catalogo(79));
    return { respaldo, datos: a.datos };
  };
  const revertir = (respaldo: string, datos: Record<string, Doc>, aplicar = true) =>
    correr(cfgSeco({ revertir: true, aplicar, respaldo }), datos);

  it('el seco de la reversa no escribe', async () => {
    const { respaldo, datos } = await crear();
    const r = await revertir(respaldo, datos, false);
    expect(r.escrituras).toEqual([]);
    expect(r.codigo).toBe(1);
  });
  it('borra solo los dos ids idénticos y devuelve el contador', async () => {
    const { respaldo, datos } = await crear();
    const r = await revertir(respaldo, datos);
    expect(r.codigo).toBe(0);
    expect(r.escrituras.filter((e) => e.op === 'delete').map((e) => e.ruta)).toEqual([
      'tenants/qtaco/catalogo/promo-torta-sin-queso', 'tenants/qtaco/catalogo/promo-torta-con-queso']);
    expect(r.datos['tenants/qtaco/contadores/catalogo']).toMatchObject({ items: 79, ultimoItem: 'promo-torta-con-queso' });
    expect(Object.keys(r.datos).filter((k) => k.includes('catalogo/it-')).length).toBe(79);
  });
  it('no borra uno modificado (precio, o un campo de más) y solo baja el contador en lo borrado', async () => {
    const { respaldo, datos } = await crear();
    (datos['tenants/qtaco/catalogo/promo-torta-sin-queso'] as Doc).precio = 16;
    const r = await revertir(respaldo, datos);
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('promo-torta-sin-queso fue modificado');
    expect(r.escrituras.filter((e) => e.op === 'delete').map((e) => e.ruta)).toEqual(['tenants/qtaco/catalogo/promo-torta-con-queso']);
    expect(r.datos['tenants/qtaco/contadores/catalogo']).toMatchObject({ items: 80, ultimoItem: 'promo-torta-con-queso' });
    const { respaldo: r2, datos: d2 } = await crear();
    (d2['tenants/qtaco/catalogo/promo-torta-con-queso'] as Doc).extra = 1;
    const x = await revertir(r2, d2);
    expect(x.escrituras.filter((e) => e.op === 'delete').length).toBe(1);
  });
  it('rechaza un respaldo de otro entorno o alterado', async () => {
    const { respaldo, datos } = await crear();
    const r = await correr(cfgSeco({ revertir: true, aplicar: true, respaldo, entorno: 'staging' }), datos);
    expect(r.codigo).toBe(2);
    expect(r.escrituras).toEqual([]);
  });
});

describe('E5. texto del script y límites', () => {
  const texto = readFileSync(SCRIPT, 'utf8');
  const codigo = texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  it('los dos productos tienen los precios y el área pedidos', () => {
    expect(mod.PRODUCTOS.map((p) => [p.id, p.nombre, p.precio, p.area])).toEqual([
      ['promo-torta-sin-queso', 'Torta mexicana sin queso', 15, 'promociones'],
      ['promo-torta-con-queso', 'Torta mexicana con queso', 20, 'promociones'],
    ]);
  });
  it('no usa update, set con merge ni borra fuera de la reversa, ni lee .env', () => {
    expect(codigo).not.toMatch(/\.update\(|merge|['\"`\/]\.env|CONFIGURACION\.local/);
  });
  it('importa la salvaguarda y no copia la lista de proyectos', () => {
    expect(codigo).toContain("from '../../plataforma/aplicar-consola-oculta.mjs'");
    expect(codigo).not.toContain('GCP_PROJECT_ID');
  });
  it('la tabla de respaldo coincide con RESPALDO-PRODUCTOS-POR-PLAN de las reglas', () => {
    const reglas = readFileSync(join(ADMIN, 'firestore.rules'), 'utf8');
    const m = reglas.match(/RESPALDO-PRODUCTOS-POR-PLAN[\s\S]*?\{'impulso': (\d+), 'crecimiento': (\d+), 'pro': (\d+), 'byoc': (\d+)\}[\s\S]*?\.get\(cuenta\.get\('plan', ''\), (\d+)\)/);
    expect(m).not.toBeNull();
    expect(mod.PRODUCTOS_POR_PLAN_RESPALDO).toEqual({ impulso: +m![1]!, crecimiento: +m![2]!, pro: +m![3]!, byoc: +m![4]! });
    expect(mod.limiteDeProductos({})).toBe(+m![5]!);
  });
});
