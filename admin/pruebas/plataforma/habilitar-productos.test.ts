/**
 * `scripts/plataforma/habilitar-productos.mjs` — HABILITA (`activo: true`) los ítems deshabilitados del catálogo
 * de un comercio cuya categoría (`area`) es cervezas, cocteleria o postres (y `--buscar`, solo lectura).
 *
 * Sin emulador ni nube: lógica pura y una base en memoria con datos sintéticos. Se NIEGA primero:
 *   E1. Argumentos y salvaguarda: tenant fuera de la lista, proyecto equivocado, producción sin confirmación.
 *   E2. Clasificación: otras categorías (y plurales) no se habilitan.
 *   E3. Seco: no escribe, solo lee un tenant; --aplicar escribe solo `activo` y solo lo elegido.
 *   E4. Reversa: restaura el estado exacto y no toca lo que ya no está en true.
 *   E5. El texto del script.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { chmodSync, closeSync, fstatSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '..', '..', 'scripts', 'plataforma', 'habilitar-productos.mjs');
const sinComentarios = (f: string) => f.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
type Cfg = Record<string, unknown>;
type Item = Record<string, unknown>;
const mod = await import('../../scripts/plataforma/habilitar-productos.mjs') as unknown as {
  analizarArgumentos: (argv: string[], env?: Record<string, string>) => { ok: boolean; problemas?: string[]; cfg?: Cfg };
  clasificar: (items: Item[], c?: readonly string[]) => { habilitar: Item[]; otras: Item[]; noReconocidos: Item[] };
  mensajeDeInterrupcion: (e: string, r?: boolean) => string;
  categoriaObjetivo: (a: unknown, c?: readonly string[]) => boolean;
  CATEGORIAS: readonly string[];
  leerRespaldo: (r: string, o: { entorno: string; tenant: string }) => { ok: boolean; motivo?: string; ids?: string[] };
  ejecutar: (cfg: Cfg, deps: Record<string, unknown>) => Promise<number>;
};

const HOST = '127.0.0.1:1';
const ENV_EMU = { FIRESTORE_EMULATOR_HOST: HOST };
const PROY = 'demo-novuchat-pruebas';
const ENV_REAL = { GCP_PROJECT_ID_STAGING: 'proyecto-ficticio-staging', GCP_PROJECT_ID_PROD: 'proyecto-ficticio-prod' };
const dirs: string[] = [];
const rutaRespaldo = () => {
  const d = mkdtempSync(join(tmpdir(), 'hab-prod-')); chmodSync(d, 0o700); dirs.push(d);
  return join(d, 'respaldo.json');
};
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const CATALOGO: Record<string, Item> = {
  a1: { nombre: 'Pilsener', area: 'cervezas', activo: false },
  a2: { nombre: 'Brownie', area: 'Postres', activo: false },
  a3: { nombre: 'Helado de canela', area: 'POSTRES', activo: false },
  a4: { nombre: 'Mojito', area: 'Cocteleria', activo: false },
  a5: { nombre: 'Gaseosa', area: 'bebidas', activo: false },
  a6: { nombre: 'Cerveza de lata', area: 'cerveza', activo: false },
  a7: { nombre: 'Sin categoría', activo: false },
  a8: { nombre: 'Ya activa', area: 'cervezas', activo: true },
  a9: { nombre: 'Sin campo activo', area: 'cocteleria' },
  a10: { nombre: "Promo Duo", area: 'promociones', activo: false },
  a11: { nombre: 'Helado suelto', area: 'helados', activo: false },
  a12: { nombre: 'Trago suelto', area: 'tragos', activo: false },
  a13: { nombre: 'Taco de birria', area: 'birria', activo: false },
};

/** Firestore en memoria con varios tenants; registra cada lectura y escritura (ruta y campos). */
function baseDe(catalogos: Record<string, Record<string, Item>>, opciones: { cambiaAntes?: string; falloTrasEscrituras?: number } = {}) {
  const datos: Record<string, Record<string, Item>> = JSON.parse(JSON.stringify(catalogos));
  const horas: Record<string, number> = {};
  const lecturas: string[] = [];
  const escrituras: { ruta: string; campos: Record<string, unknown> }[] = [];
  const hora = (r: string) => horas[r] ?? 1;
  const refDe = (col: string, id: string) => ({
    update: async (campos: Record<string, unknown>, pre: { lastUpdateTime: { hora: number } }) => {
      if (opciones.falloTrasEscrituras !== undefined && escrituras.length >= opciones.falloTrasEscrituras) throw Object.assign(new Error('x'), { code: 'unavailable' });
      if (opciones.cambiaAntes === id) { horas[`${col}/${id}`] = hora(`${col}/${id}`) + 1; }
      if (pre.lastUpdateTime.hora !== hora(`${col}/${id}`)) throw Object.assign(new Error('pre'), { code: 9 });
      for (const [k, v] of Object.entries(campos)) {
        if (v && typeof v === 'object' && (v as { __borrar?: boolean }).__borrar) delete datos[col]![id]![k];
        else datos[col]![id]![k] = v;
      }
      horas[`${col}/${id}`] = hora(`${col}/${id}`) + 1;
      escrituras.push({ ruta: `${col}/${id}`, campos });
    },
  });
  return {
    escrituras, lecturas, datos,
    db: {
      collection: (col: string) => ({
        select: (...campos: string[]) => ({
          get: async () => {
            lecturas.push(col);
            const c = datos[col.replace(/^tenants\//, '').replace(/\/catalogo$/, '')] ?? {};
            return {
              docs: Object.entries(c).map(([id, d]) => ({
                id, ref: refDe(col.replace(/^tenants\//, '').replace(/\/catalogo$/, ''), id),
                updateTime: { hora: hora(`${col.replace(/^tenants\//, '').replace(/\/catalogo$/, '')}/${id}`) },
                data: () => Object.fromEntries(Object.entries(d).filter(([k]) => campos.includes(k))),
              })),
            };
          },
        }),
      }),
    },
  };
}
const FieldValue = { delete: () => ({ __borrar: true }) };
const cfgDe = (extra: Cfg = {}): Cfg => ({ proyecto: PROY, entorno: 'emulador', tenant: 'qtaco', aplicar: false, revertir: false, respaldo: null, ...extra });
const correr = async (cfg: Cfg, b: ReturnType<typeof baseDe>) => {
  const salida: string[] = [];
  const estados: string[] = [];
  const codigo = await mod.ejecutar(cfg, { db: b.db, FieldValue, marcarEscritura: (v: string) => estados.push(v), log: (t: string) => salida.push(t) });
  return { codigo, salida: salida.join('\n'), estados };
};

describe('E1. argumentos y salvaguarda', () => {
  const base = ['--proyecto', PROY, '--tenant', 'qtaco'];
  const problemas = (argv: string[], env: Record<string, string> = ENV_EMU) => {
    const r = mod.analizarArgumentos(argv, env);
    expect(r.ok, JSON.stringify(r)).toBe(false);
    return (r.problemas ?? []).join(' | ');
  };
  it('la invocación válida queda en seco', () => {
    const r = mod.analizarArgumentos(base, ENV_EMU);
    expect(r.ok).toBe(true);
    expect(r.cfg).toMatchObject({ tenant: 'qtaco', aplicar: false, revertir: false, entorno: 'emulador' });
  });
  it('rechaza cualquier tenant fuera de la lista cerrada, con comas o formas raras', () => {
    for (const t of ['otro-comercio', 'qtaco,otro', 'QTaco', '../qtaco', '__proto__', '']) {
      expect(problemas(['--proyecto', PROY, '--tenant', t])).toMatch(/--tenant|sin valor/);
    }
    expect(problemas(['--proyecto', PROY])).toContain('falta --tenant');
  });
  it('--aplicar exige --respaldo; --revertir exige --respaldo; opciones raras se rechazan', () => {
    expect(problemas([...base, '--aplicar'])).toContain('--aplicar exige --respaldo');
    expect(problemas(['--revertir', ...base])).toContain('--revertir exige --respaldo');
    expect(problemas([...base, '--categoria', 'bebidas'])).toContain('opción desconocida');
    expect(problemas([...base, '--aplicar', '--aplicar'])).toContain('opción repetida');
  });
  it('proyecto equivocado: sin lista blanca, fuera de ella o con emulador mezclado', () => {
    expect(problemas(['--proyecto', 'otro-proyecto-real', '--tenant', 'qtaco'], ENV_REAL)).toContain('lista blanca');
    expect(problemas(base, {})).toContain('FIRESTORE_EMULATOR_HOST');
    expect(problemas(['--proyecto', 'proyecto-ficticio-prod', '--tenant', 'qtaco'], { ...ENV_REAL, FIRESTORE_EMULATOR_HOST: HOST })).toContain('ambiguo');
    expect(problemas(['--proyecto', 'proyecto-ficticio-staging', '--tenant', 'qtaco'], { GCP_PROJECT_ID_STAGING: 'proyecto-ficticio-staging' })).toContain('GCP_PROJECT_ID_PROD');
  });
  it('producción: --aplicar exige --confirmo-produccion igual al tenant; el seco no', () => {
    const prod = ['--proyecto', 'proyecto-ficticio-prod', '--tenant', 'qtaco'];
    const resp = join(mkdtempSync(join(tmpdir(), 'hab-prod-')), 'r.json');
    dirs.push(dirname(resp)); chmodSync(dirname(resp), 0o700);
    expect(mod.analizarArgumentos(prod, ENV_REAL).ok).toBe(true);
    expect(problemas([...prod, '--aplicar', '--respaldo', resp], ENV_REAL)).toContain('--confirmo-produccion');
    expect(problemas([...prod, '--aplicar', '--respaldo', resp, '--confirmo-produccion', 'otro'], ENV_REAL)).toContain('no coincide');
    expect(mod.analizarArgumentos([...prod, '--aplicar', '--respaldo', resp, '--confirmo-produccion', 'qtaco'], ENV_REAL).ok).toBe(true);
    expect(problemas([...base, '--confirmo-produccion', 'qtaco'])).toContain('solo se usa contra producción');
  });
  it('el respaldo no puede estar dentro del repositorio', () => {
    expect(problemas([...base, '--aplicar', '--respaldo', join(aqui, 'r.json')])).toContain('repositorio');
  });
});

describe('E2. clasificación: solo las tres categorías exactas, solo deshabilitados', () => {
  const items = Object.entries(CATALOGO).map(([id, d]) => ({ id, ...d }));
  const { habilitar, otras } = mod.clasificar(items);
  it('habilita cervezas, cocteleria y postres (sin tildes ni mayúsculas, como el filtro de la consola)', () => {
    expect(habilitar.map((i) => i['id']).sort()).toEqual(['a1', 'a2', 'a3', 'a4', 'a9']);
  });
  it('NO habilita otras categorías, plurales, sin categoría ni los que ya están activos', () => {
    expect(otras.map((i) => i['id']).sort()).toEqual(['a10', 'a11', 'a12', 'a13', 'a5', 'a6', 'a7']);
    for (const a of ['cerveza', 'tragos', 'helados', 'promociones', 'bebidas', 'birria', 'tacos', 'cervezas artesanales']) {
      expect(mod.categoriaObjetivo(a)).toBe(false);
    }
    expect(mod.categoriaObjetivo(undefined)).toBe(false);
    expect(mod.categoriaObjetivo(['cervezas'])).toBe(false);
    expect(habilitar.map((i) => i['id'])).not.toContain('a8');
  });
});

describe('E2b. la constante de categorías', () => {
  it('es la lista cerrada de tres, sin variantes; recorta espacios; y se ajusta cambiando solo la constante', () => {
    expect([...mod.CATEGORIAS]).toEqual(['cervezas', 'cocteleria', 'postres']);
    expect(mod.categoriaObjetivo('  Cervezas  ')).toBe(true);
    for (const a of ['cerveza', 'tragos', 'trago', 'postre', 'helado', 'helados', 'promociones']) expect(mod.categoriaObjetivo(a)).toBe(false);
    expect(mod.categoriaObjetivo('tragos', ['tragos'])).toBe(true);
    const r = mod.clasificar([{ id: 'x', nombre: 'N', area: 'tragos', activo: false }], ['tragos']);
    expect(r.habilitar).toHaveLength(1);
  });
});

describe('E3. seco y aplicar', () => {
  it('el seco no escribe, lee solo el tenant pedido e imprime la tabla y los conteos de otras categorías', async () => {
    const b = baseDe({ qtaco: CATALOGO, ajeno: { z1: { nombre: 'Ajeno', area: 'cervezas', activo: false } } });
    const { codigo, salida } = await correr(cfgDe(), b);
    expect(codigo).toBe(1);
    expect(b.escrituras).toHaveLength(0);
    expect(b.lecturas).toEqual(['tenants/qtaco/catalogo']);
    expect(salida).toContain('Se habilitarían (5)');
    expect(salida).toContain('Pilsener');
    expect(salida).toContain('OTRAS categorías (NO se tocan): 7');
    expect(salida).toContain('Gaseosa');
    expect(salida).not.toContain('Ajeno');
    expect(salida).toContain('Catálogo por área (13 ítems; total / deshabilitados)');
    expect(salida).toMatch(/bebidas\s+1 \/ 1/);
    expect(salida).toContain('Gaseosa [bebidas]');
    expect(salida).toContain('Sin categoría [(sin área)]');
    expect(salida).not.toContain('AVISO');
    expect(salida).not.toContain(PROY);
  });
  it('avisa cuando una categoría objetivo no tiene coincidencias', async () => {
    const b = baseDe({ qtaco: { a1: { nombre: 'Pilsener', area: 'cerveza', activo: false }, a2: { nombre: 'Mojito', area: 'tragos', activo: false } } });
    const { codigo, salida } = await correr(cfgDe(), b);
    expect(codigo).toBe(0);
    for (const c of ['cervezas', 'cocteleria', 'postres']) expect(salida).toContain(`ninguna área coincide con «${c}»`);
    expect(salida).toMatch(/tragos\s+1 \/ 1/);
    expect(b.escrituras).toHaveLength(0);
  });
  it('sin --aplicar no escribe aunque haya respaldo configurado', async () => {
    const b = baseDe({ qtaco: CATALOGO });
    const r = rutaRespaldo();
    await correr(cfgDe({ respaldo: r }), b);
    expect(b.escrituras).toHaveLength(0);
    expect(() => statSync(r)).toThrow();
  });
  it('--aplicar escribe solo {activo:true} en los ítems elegidos, deja respaldo 0600 y no toca otro tenant ni otras categorías', async () => {
    const b = baseDe({ qtaco: CATALOGO, ajeno: { z1: { nombre: 'Ajeno', area: 'cervezas', activo: false } } });
    const r = rutaRespaldo();
    const { codigo } = await correr(cfgDe({ aplicar: true, respaldo: r }), b);
    expect(codigo).toBe(0);
    expect(b.escrituras.map((e) => e.ruta).sort()).toEqual(['qtaco/a1', 'qtaco/a2', 'qtaco/a3', 'qtaco/a4', 'qtaco/a9']);
    for (const e of b.escrituras) expect(e.campos).toEqual({ activo: true });
    expect(b.datos['qtaco']!['a5']!['activo']).toBe(false);
    expect(b.datos['qtaco']!['a6']!['activo']).toBe(false);
    expect(b.datos['qtaco']!['a7']!['activo']).toBe(false);
    expect(b.datos['ajeno']!['z1']!['activo']).toBe(false);
    const fd = openSync(r, 'r');
    try {
      const st = fstatSync(fd);
      const buf = Buffer.alloc(st.size);
      readSync(fd, buf, 0, st.size, 0);
      expect(st.mode & 0o777).toBe(0o600);
      expect(buf.toString('utf8')).not.toContain('Pilsener');
    } finally { closeSync(fd); }
  });
  it('idempotente: sin nada que habilitar sale 0 sin escribir ni crear respaldo', async () => {
    const b = baseDe({ qtaco: { a1: { nombre: 'X', area: 'cervezas', activo: true }, a2: { nombre: 'Y', area: 'otra', activo: false } } });
    const r = rutaRespaldo();
    const { codigo } = await correr(cfgDe({ aplicar: true, respaldo: r }), b);
    expect(codigo).toBe(0);
    expect(b.escrituras).toHaveLength(0);
    expect(() => statSync(r)).toThrow();
  });
  it('un respaldo existente nunca se pisa (sale 2 sin escribir)', async () => {
    const r = rutaRespaldo();
    await correr(cfgDe({ aplicar: true, respaldo: r }), baseDe({ qtaco: CATALOGO }));
    const b2 = baseDe({ qtaco: CATALOGO });
    const { codigo } = await correr(cfgDe({ aplicar: true, respaldo: r }), b2);
    expect(codigo).toBe(2);
    expect(b2.escrituras).toHaveLength(0);
  });
  it('un error a mitad de las escrituras avisa que hubo escrituras y que se puede revertir; el estado es «escrito»', async () => {
    const b = baseDe({ qtaco: CATALOGO }, { falloTrasEscrituras: 2 });
    const { codigo, salida, estados } = await correr(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), b);
    expect(codigo).toBe(3);
    expect(b.escrituras).toHaveLength(2);
    expect(salida).toContain('SÍ se escribieron 2 de 5');
    expect(salida).toContain('--revertir');
    expect(estados.at(-1)).toBe('escrito');
  });
  it('si el primer ítem falla no se escribió nada y el estado es «antes»', async () => {
    const b = baseDe({ qtaco: CATALOGO }, { falloTrasEscrituras: 0 });
    const { codigo, salida, estados } = await correr(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), b);
    expect(codigo).toBe(3);
    expect(salida).toContain('no se escribió nada');
    expect(estados.at(-1)).toBe('antes');
  });
  it('si un ítem cambia entre la lectura y la escritura, se detiene con 3 sin pisarlo', async () => {
    const b = baseDe({ qtaco: CATALOGO }, { cambiaAntes: 'a2' });
    const { codigo } = await correr(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), b);
    expect(codigo).toBe(3);
    expect(b.datos['qtaco']!['a2']!['activo']).toBe(false);
  });
});

describe('E3a. valores de «activo» no reconocidos: no se tocan', () => {
  const cat = {
    v1: { nombre: 'Valor no', area: 'cervezas', activo: 'no' }, v2: { nombre: 'Valor cero', area: 'postres', activo: 0 },
    v3: { nombre: 'Normal', area: 'postres', activo: false },
  };
  it('clasificar los separa de lo que se habilita y de «otras»', () => {
    const r = mod.clasificar(Object.entries(cat).map(([id, d]) => ({ id, ...d })));
    expect(r.habilitar.map((i) => i['id'])).toEqual(['v3']);
    expect(r.noReconocidos.map((i) => i['id']).sort()).toEqual(['v1', 'v2']);
    expect(r.otras).toHaveLength(0);
  });
  it('el seco los lista aparte con su tipo y --aplicar no los escribe', async () => {
    const b = baseDe({ qtaco: cat });
    const seco = await correr(cfgDe(), b);
    expect(seco.salida).toContain('no reconocido, no se toca: 2');
    expect(seco.salida).toContain('tipo string');
    expect(seco.salida).toContain('tipo number');
    const ap = await correr(cfgDe({ aplicar: true, respaldo: rutaRespaldo() }), b);
    expect(ap.codigo).toBe(0);
    expect(b.escrituras.map((e) => e.ruta)).toEqual(['qtaco/v3']);
    expect(b.datos['qtaco']!['v1']!['activo']).toBe('no');
    expect(b.datos['qtaco']!['v2']!['activo']).toBe(0);
  });
});

describe('E3c. el texto de «deshacer» según la operación', () => {
  it('la interrupción y el error a mitad de una reversa no mandan a revertir', async () => {
    expect(mod.mensajeDeInterrupcion('escrito', false)).toContain('--revertir');
    expect(mod.mensajeDeInterrupcion('escrito', true)).not.toContain('--revertir');
    const b = baseDe({ qtaco: CATALOGO });
    const r = rutaRespaldo();
    await correr(cfgDe({ aplicar: true, respaldo: r }), b);
    const b2 = baseDe({ qtaco: b.datos['qtaco']! }, { falloTrasEscrituras: 1 });
    const { codigo, salida } = await correr(cfgDe({ revertir: true, aplicar: true, respaldo: r }), b2);
    expect(codigo).toBe(3);
    expect(salida).toContain('SÍ se revirtieron 1 de');
    expect(salida).not.toContain('para deshacer');
  });
});

describe('E3b. --buscar (solo lectura)', () => {
  const base = ['--proyecto', PROY, '--tenant', 'qtaco'];
  it('se valida: texto de 1 a 40, y no se combina con --aplicar, --revertir ni --respaldo', () => {
    const mal = (a: string[]) => { const r = mod.analizarArgumentos(a, ENV_EMU); expect(r.ok).toBe(false); return (r.problemas ?? []).join(' | '); };
    expect(mal([...base, '--buscar', '  '])).toContain('--buscar necesita');
    expect(mal([...base, '--buscar', 'x'.repeat(41)])).toContain('--buscar necesita');
    expect(mal([...base, '--buscar', 'torta', '--aplicar', '--respaldo', join(tmpdir(), 'r.json')])).toContain('solo lectura');
    expect(mal([...base, '--buscar', 'torta', '--buscar', 'otra'])).toContain('opción repetida');
    expect(mod.analizarArgumentos([...base, '--buscar', 'torta'], ENV_EMU).cfg).toMatchObject({ buscar: 'torta', aplicar: false });
  });
  it('lista área/nombre/activo de todos los ítems cuyo nombre contenga el texto, en cualquier estado, sin escribir', async () => {
    const b = baseDe({ qtaco: { ...CATALOGO, t1: { nombre: 'Torta de milanesa', area: 'tortas', activo: true }, t2: { nombre: 'TORTA ahogada', activo: false } }, ajeno: { z: { nombre: 'Torta ajena', area: 'x', activo: true } } });
    const { codigo, salida } = await correr(cfgDe({ buscar: 'tórta' }), b);
    expect(codigo).toBe(0);
    expect(b.escrituras).toHaveLength(0);
    expect(b.lecturas).toEqual(['tenants/qtaco/catalogo']);
    expect(salida).toContain('2 ítem(s)');
    expect(salida).toMatch(/tortas\s+Torta de milanesa\s+true/);
    expect(salida).toMatch(/\(sin área\)\s+TORTA ahogada\s+false/);
    expect(salida).not.toContain('ajena');
    expect(salida).not.toContain('Pilsener');
  });
  it('sin coincidencias lo dice y sale 0', async () => {
    const { codigo, salida } = await correr(cfgDe({ buscar: 'torta' }), baseDe({ qtaco: CATALOGO }));
    expect(codigo).toBe(0);
    expect(salida).toContain('0 ítem(s)');
  });
});

describe('E4. reversa', () => {
  it('restaura el estado exacto: los habilitados vuelven a false y lo demás queda igual', async () => {
    const b = baseDe({ qtaco: CATALOGO });
    const r = rutaRespaldo();
    await correr(cfgDe({ aplicar: true, respaldo: r }), b);
    b.escrituras.length = 0;
    const seco = await correr(cfgDe({ revertir: true, respaldo: r }), b);
    expect(seco.codigo).toBe(1);
    expect(b.escrituras).toHaveLength(0);
    const { codigo } = await correr(cfgDe({ revertir: true, aplicar: true, respaldo: r }), b);
    expect(codigo).toBe(0);
    for (const e of b.escrituras) expect([false, undefined]).toContain(e.campos['activo'] === false ? false : (e.campos['activo'] as { __borrar?: boolean }).__borrar ? undefined : 'otro');
    expect(b.datos['qtaco']).toEqual(CATALOGO);
    expect('activo' in b.datos['qtaco']!['a9']!).toBe(false);
    expect(b.datos['qtaco']!['a8']!['activo']).toBe(true);
  });
  it('restaura el valor previo real: null vuelve a null, false a false, ausente se quita', async () => {
    const cat = {
      n1: { nombre: 'A', area: 'postres', activo: null }, n2: { nombre: 'B', area: 'postres', activo: false }, n3: { nombre: 'C', area: 'postres' },
    };
    const b = baseDe({ qtaco: cat });
    const r = rutaRespaldo();
    await correr(cfgDe({ aplicar: true, respaldo: r }), b);
    expect(Object.values(b.datos['qtaco']!).every((d) => d['activo'] === true)).toBe(true);
    await correr(cfgDe({ revertir: true, aplicar: true, respaldo: r }), b);
    expect(b.datos['qtaco']).toEqual(cat);
    expect(Object.keys(b.datos['qtaco']!['n3']!)).not.toContain('activo');
  });
  it('RECHAZA el respaldo entero (2) si algún id hoy está fuera de las categorías objetivo, sin escribir nada', async () => {
    const b = baseDe({ qtaco: CATALOGO });
    const r = rutaRespaldo();
    await correr(cfgDe({ aplicar: true, respaldo: r }), b);
    b.datos['qtaco']!['a5']!['activo'] = true;
    const j = JSON.parse(readFileSync(r, 'utf8'));
    j.items.push({ id: 'a5', previo: { presente: true, valor: false } });
    const r2 = rutaRespaldo();
    writeFileSync(r2, JSON.stringify(j), { mode: 0o600 });
    b.escrituras.length = 0;
    const { codigo, salida } = await correr(cfgDe({ revertir: true, aplicar: true, respaldo: r2 }), b);
    expect(codigo).toBe(2);
    expect(salida).toContain('se rechaza entero');
    expect(b.escrituras).toHaveLength(0);
    expect(b.datos['qtaco']!['a5']!['activo']).toBe(true);
  });
  it('rechaza un respaldo con un valor previo inventado', async () => {
    const r = rutaRespaldo();
    writeFileSync(r, JSON.stringify({ version: 1, entorno: 'emulador', tenant: 'qtaco', items: [{ id: 'a1', previo: { presente: true, valor: 'si' } }] }), { mode: 0o600 });
    expect(mod.leerRespaldo(r, { entorno: 'emulador', tenant: 'qtaco' }).ok).toBe(false);
  });
  it('no toca un ítem que alguien ya cambió o que ya no está en true; segunda reversa no hace nada', async () => {
    const b = baseDe({ qtaco: CATALOGO });
    const r = rutaRespaldo();
    await correr(cfgDe({ aplicar: true, respaldo: r }), b);
    b.datos['qtaco']!['a1']!['activo'] = false;
    b.escrituras.length = 0;
    await correr(cfgDe({ revertir: true, aplicar: true, respaldo: r }), b);
    expect(b.escrituras.map((e) => e.ruta)).not.toContain('qtaco/a1');
    b.escrituras.length = 0;
    expect((await correr(cfgDe({ revertir: true, aplicar: true, respaldo: r }), b)).codigo).toBe(0);
    expect(b.escrituras).toHaveLength(0);
  });
  it('rechaza un respaldo de otro entorno o de otro tenant', async () => {
    const r = rutaRespaldo();
    await correr(cfgDe({ aplicar: true, respaldo: r }), baseDe({ qtaco: CATALOGO }));
    expect(mod.leerRespaldo(r, { entorno: 'produccion', tenant: 'qtaco' }).ok).toBe(false);
    expect(mod.leerRespaldo(r, { entorno: 'emulador', tenant: 'otro' }).ok).toBe(false);
    expect(mod.leerRespaldo(r, { entorno: 'emulador', tenant: 'qtaco' }).ok).toBe(true);
  });
});

describe('E5. el texto del script', () => {
  const f = sinComentarios(readFileSync(SCRIPT, 'utf8'));
  it('su única escritura es update del campo activo; no crea ni borra', () => {
    expect(f.match(/\.update\(/g)).toHaveLength(1);
    expect(f).toContain("const CAMPO = 'activo';");
    expect(f).toContain('await ref.update({ [CAMPO]: valor }, { lastUpdateTime: ultimaActualizacion });');
    expect(f.replace(/FieldValue\.delete\(\)/g, '')).not.toMatch(/\.(set|create|delete|add)\(/);
    expect(f).not.toMatch(/\bbatch\b|runTransaction/);
  });
  it('lee solo nombre, area y activo y no imprime el proyecto', () => {
    expect(f).toContain(".select('nombre', 'area', 'activo')");
    expect(f).not.toMatch(/console\.(log|error)\([^)]*proyecto\b(?!s)/);
  });
});
