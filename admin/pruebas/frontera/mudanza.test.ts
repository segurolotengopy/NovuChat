/**
 * LA MUDANZA DE F2 — `mudanza.ts`, sobre un árbol inventado.
 *
 * Cada forma en que el repositorio nombra un archivo que F2 mueve tiene su
 * caso: el import de Functions (`.js`), el de la consola (sin extensión), el
 * compilado (`lib/*.js`), `join(FUENTES, …)`, `vi.mock`, la ruta desde la raíz,
 * la ruta desde `admin/` (`SUITES_PURAS`), `deuda.json`, un `.sh`, los imports
 * PROPIOS del archivo movido y un `join(aqui, …)` a una carpeta desde un
 * archivo movido. Un literal fuera de esos contextos (un fixture como los de
 * esta misma prueba) no se toca: se avisa. Y la validación de la tanda y la
 * reproducibilidad con la que `solo-rutas.mjs` juzga un PR de tanda.
 */
import { describe, expect, it } from 'vitest';
import { planDeMudanza, validarTanda, verificarReproducible, type ArbolConCarpetas, type Consulta } from './mudanza.ts';

const F = 'admin/functions/src';
const ARCHIVOS: Record<string, string> = {
  [`${F}/atencion.ts`]: "import { REGION } from './region.js';\nexport const x = REGION;\n",
  [`${F}/region.ts`]: "export const REGION = 'us-east1';\n",
  [`${F}/index.ts`]: "export { x } from './atencion.js';\n",
  'admin/web/src/lib/atencion.ts': "export * from '../../../functions/src/atencion';\n",
  'admin/web/src/paginas/Estado.tsx': "import { x } from '../lib/atencion';\nexport const E = () => x;\n",
  'admin/scripts/pase.mjs': "const FUENTES = join(aqui, '..', 'functions', 'src');\nconst a = await import(join(FUENTES, 'atencion.ts'));\nconst p = await import('../functions/lib/atencion.js');\n",
  'admin/pruebas/umbrales.test.ts': "vi.mock('../functions/src/atencion.ts');\nimport { x } from '../functions/src/atencion.ts';\nconst t = leer('admin/functions/src/atencion.ts');\n",
  'admin/pruebas/central/panel.test.ts': "import { p } from '../../web/src/lib/atencion';\nconst FLUJOS = join(aqui, '../../../Flujos');\n",
  'admin/vitest.config.ts': "export const SUITES_PURAS = [\n  'pruebas/central/panel.test.ts',\n];\n",
  'admin/pruebas/frontera/deuda.json': `${JSON.stringify({ cruces: [{ desde: `${F}/atencion.ts`, hacia: `${F}/region.ts`, porque: 'x' }], sinZona: [], sinResolver: {}, transversales: [] }, null, 2)}\n`,
  'scripts/staging.sh': 'grep x admin/functions/src/atencion.ts admin/functions/src/atencion.tsx\n',
  'admin/pruebas/fixture.test.ts': "const CASOS = { 'admin/functions/src/atencion.ts': 1 };\nconst m = { de: 'admin/functions/src/atencion.ts' };\n",
  'Flujos/a.json': '{}',
};
const arbol: ArbolConCarpetas = {
  leer: (a) => ARCHIVOS[a] ?? '',
  existe: (a) => a in ARCHIVOS,
  esCarpeta: (r) => Object.keys(ARCHIVOS).some((a) => a.startsWith(`${r}/`)),
};
const TANDA = [
  { de: `${F}/atencion.ts`, a: `${F}/core/conteo/atencion.ts` },
  { de: 'admin/web/src/lib/atencion.ts', a: 'admin/web/src/core/lib/atencion.ts' },
  { de: 'admin/pruebas/central/panel.test.ts', a: 'admin/pruebas/plataforma/sub/panel.test.ts' },
];
const plan = planDeMudanza(TANDA, Object.keys(ARCHIVOS), arbol);
const texto = (a: string) => plan.ediciones.find((e) => e.archivo === a)?.nuevoTexto ?? ARCHIVOS[a];

describe('planDeMudanza', () => {
  it('reescribe los imports PROPIOS del archivo movido', () => {
    expect(texto(`${F}/core/conteo/atencion.ts`)).toContain("from '../../region.js'");
  });
  it('Functions: el import con .js sigue con .js', () => {
    expect(texto(`${F}/index.ts`)).toBe("export { x } from './core/conteo/atencion.js';\n");
  });
  it('la consola: sin extensión, y desde un archivo que también se mueve', () => {
    expect(texto('admin/web/src/core/lib/atencion.ts')).toBe("export * from '../../../../functions/src/core/conteo/atencion';\n");
    expect(texto('admin/web/src/paginas/Estado.tsx')).toContain("from '../core/lib/atencion'");
  });
  it('scripts: join(FUENTES, …) por segmentos, y el compilado lib/*.js', () => {
    const t = texto('admin/scripts/pase.mjs')!;
    expect(t).toContain("join(FUENTES, 'core', 'conteo', 'atencion.ts')");
    expect(t).toContain("import('../functions/lib/core/conteo/atencion.js')");
    expect(t).toContain("join(aqui, '..', 'functions', 'src')"); // la base no se toca: el script no se mueve
  });
  it('pruebas: vi.mock, el import y la ruta desde la raíz', () => {
    const t = texto('admin/pruebas/umbrales.test.ts')!;
    expect(t).toContain("vi.mock('../functions/src/core/conteo/atencion.ts')");
    expect(t).toContain("from '../functions/src/core/conteo/atencion.ts'");
    expect(t).toContain("leer('admin/functions/src/core/conteo/atencion.ts')");
  });
  it('una prueba movida más hondo: sus imports y su join(aqui, …) a una carpeta', () => {
    const t = texto('admin/pruebas/plataforma/sub/panel.test.ts')!;
    expect(t).toContain("from '../../../web/src/core/lib/atencion'");
    expect(t).toContain("join(aqui, '..', '..', '..', '..', 'Flujos')");
  });
  it('SUITES_PURAS (ruta desde admin/), deuda.json y un .sh', () => {
    expect(texto('admin/vitest.config.ts')).toContain("'pruebas/plataforma/sub/panel.test.ts'");
    expect(JSON.parse(texto('admin/pruebas/frontera/deuda.json')!).cruces[0].desde).toBe(`${F}/core/conteo/atencion.ts`);
    // Con límites: el .tsx que empieza igual no se toca.
    expect(texto('scripts/staging.sh')).toBe('grep x admin/functions/src/core/conteo/atencion.ts admin/functions/src/atencion.tsx\n');
  });
  it('no toca lo que no nombra un archivo movido', () => {
    expect(plan.ediciones.map((e) => e.archivo)).not.toContain(`${F}/region.ts`);
    expect(plan.ediciones.map((e) => e.archivo)).not.toContain('Flujos/a.json');
  });
  it('un literal igual a una ruta movida FUERA de un contexto conocido no se toca: se avisa', () => {
    expect(plan.ediciones.map((e) => e.archivo)).not.toContain('admin/pruebas/fixture.test.ts');
    expect(plan.avisos.filter((a) => a.startsWith('admin/pruebas/fixture.test.ts:'))).toHaveLength(2);
  });
});

describe('validarTanda', () => {
  const consulta = (versionados: string[], existentes: string[] = [], enlaces: string[] = []): Consulta => ({
    existe: (r) => versionados.includes(r) || existentes.includes(r),
    esArchivoVersionado: (r) => versionados.includes(r),
    pasaPorEnlace: (r) => enlaces.some((e) => r.startsWith(e)),
  });
  const ok = consulta([`${F}/atencion.ts`, `${F}/region.ts`]);
  it('una tanda correcta no tiene errores', () => {
    expect(validarTanda([{ de: `${F}/atencion.ts`, a: `${F}/core/conteo/atencion.ts` }], ok)).toEqual([]);
  });
  it('rechaza salir del repositorio, rutas absolutas o no normales, y salir de las raíces', () => {
    for (const a of ['../../tmp/x.ts', '/tmp/x.ts', `${F}/core/../x.ts`, `${F}//x.ts`, 'admin/firestore.ts', '.github/x.ts']) {
      expect(validarTanda([{ de: `${F}/atencion.ts`, a }], ok).length, a).toBeGreaterThan(0);
    }
  });
  it('rechaza cambiar la extensión, repetir, mover lo que no está versionado o pisar lo que existe', () => {
    expect(validarTanda([{ de: `${F}/atencion.ts`, a: `${F}/core/atencion.js` }], ok)).toHaveLength(1);
    expect(validarTanda([{ de: `${F}/atencion.ts`, a: `${F}/core/a.ts` }, { de: `${F}/atencion.ts`, a: `${F}/core/b.ts` }], ok).length).toBeGreaterThan(0);
    expect(validarTanda([{ de: `${F}/no-esta.ts`, a: `${F}/core/no-esta.ts` }], ok)).toHaveLength(1);
    expect(validarTanda([{ de: `${F}/atencion.ts`, a: `${F}/region.ts` }], ok)).toHaveLength(1);
    expect(validarTanda([{ de: `${F}/atencion.ts`, a: `${F}/enlace/atencion.ts` }], consulta([`${F}/atencion.ts`], [], [`${F}/enlace`]))).toHaveLength(1);
    expect(validarTanda([], ok)).toHaveLength(1);
    expect(validarTanda([{ de: 1, a: 2 }], ok)).toHaveLength(1);
  });
});

describe('verificarReproducible (lo que usa solo-rutas.mjs)', () => {
  const leerBase = (r: string) => ARCHIVOS[r] ?? '';
  // El PR «perfecto»: los renombres y las ediciones del plan, tal cual.
  const diffPerfecto = [
    ...TANDA.map((m) => ({ estado: 'R100', viejo: m.de, nuevo: m.a })),
    ...plan.ediciones.filter((e) => !TANDA.some((m) => m.a === e.archivo) && e.cambios.length)
      .map((e) => ({ estado: 'M', viejo: e.archivo, nuevo: e.archivo })),
  ];
  const head = (cambios: Record<string, string> = {}) => (r: string) =>
    cambios[r] ?? plan.ediciones.find((e) => e.archivo === r)?.nuevoTexto ?? ARCHIVOS[r] ?? '';

  it('el PR que es exactamente la mudanza pasa', () => {
    expect(verificarReproducible(TANDA, plan, diffPerfecto, leerBase, head())).toEqual([]);
  });
  it('un literal que NO es una ruta, cambiado en un archivo de la tanda, no pasa (región, mensaje)', () => {
    const idx = texto(`${F}/index.ts`)!;
    const r = verificarReproducible(TANDA, plan, diffPerfecto, leerBase, head({ [`${F}/index.ts`]: `${idx}export const R = 'europe-west1';\n` }));
    expect(r).toEqual([`${F}/index.ts: no es lo que produce la mudanza (cambia algo más que rutas)`]);
  });
  it('un archivo que la tanda no toca, modificado, no pasa', () => {
    const diff = [...diffPerfecto, { estado: 'M', viejo: `${F}/region.ts`, nuevo: `${F}/region.ts` }];
    expect(verificarReproducible(TANDA, plan, diff, leerBase, head({ [`${F}/region.ts`]: "export const REGION = 'x';\n" }))).toHaveLength(1);
  });
  it('un archivo nuevo o borrado, o un renombre fuera de la tanda, no pasa', () => {
    expect(verificarReproducible(TANDA, plan, [...diffPerfecto, { estado: 'A', viejo: 'x.ts', nuevo: 'x.ts' }], leerBase, head())).toHaveLength(1);
    expect(verificarReproducible(TANDA, plan, [...diffPerfecto, { estado: 'R100', viejo: `${F}/region.ts`, nuevo: `${F}/core/region.ts` }], leerBase, head())).toHaveLength(1);
  });
  it('un PR que se olvida de reescribir un consumidor no pasa', () => {
    const diff = diffPerfecto.filter((d) => d.nuevo !== `${F}/index.ts`);
    expect(verificarReproducible(TANDA, plan, diff, leerBase, head())).toEqual([`${F}/index.ts: la mudanza lo reescribe y el PR no`]);
  });
  it('a mano solo se permite QUITAR deuda y tocar líneas de SUITES_PURAS', () => {
    const deuda = JSON.parse(texto('admin/pruebas/frontera/deuda.json')!);
    const sinCruces = `${JSON.stringify({ ...deuda, cruces: [] }, null, 2)}\n`;
    expect(verificarReproducible(TANDA, plan, diffPerfecto, leerBase, head({ 'admin/pruebas/frontera/deuda.json': sinCruces }))).toEqual([]);
    const conOtro = `${JSON.stringify({ ...deuda, cruces: [...deuda.cruces, { desde: 'a', hacia: 'b', porque: 'x' }] }, null, 2)}\n`;
    expect(verificarReproducible(TANDA, plan, diffPerfecto, leerBase, head({ 'admin/pruebas/frontera/deuda.json': conOtro }))).toHaveLength(1);
    const vitest = texto('admin/vitest.config.ts')!;
    const conSuite = vitest.replace('[\n', "[\n  'pruebas/otra.test.ts',\n");
    expect(verificarReproducible(TANDA, plan, diffPerfecto, leerBase, head({ 'admin/vitest.config.ts': conSuite }))).toEqual([]);
    expect(verificarReproducible(TANDA, plan, diffPerfecto, leerBase, head({ 'admin/vitest.config.ts': `${vitest}export const X = 1;\n` }))).toHaveLength(1);
  });
});
