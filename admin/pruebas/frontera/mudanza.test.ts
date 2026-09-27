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
  [`${F}/muestra.ts`]: "import { REGION } from './region.js';\nexport const x = REGION;\n",
  [`${F}/region.ts`]: "export const REGION = 'us-east1';\n",
  [`${F}/index.ts`]: "export { x } from './muestra.js';\n",
  'admin/web/src/lib/muestra.ts': "export * from '../../../functions/src/muestra';\n",
  'admin/web/src/paginas/Estado.tsx': "import { x } from '../lib/muestra';\nexport const E = () => x;\n",
  'admin/scripts/pase.mjs': "const FUENTES = join(aqui, '..', 'functions', 'src');\nconst a = await import(join(FUENTES, 'muestra.ts'));\nconst p = await import('../functions/lib/muestra.js');\n",
  'admin/pruebas/umbrales.test.ts': "vi.mock('../functions/src/muestra.ts');\nimport { x } from '../functions/src/muestra.ts';\nconst t = leer('admin/functions/src/muestra.ts');\n",
  'admin/pruebas/central/panel.test.ts': "import { p } from '../../web/src/lib/muestra';\nconst FLUJOS = join(aqui, '../../../Flujos');\n",
  'admin/vitest.config.ts': "export const SUITES_PURAS = [\n  'pruebas/central/panel.test.ts',\n];\n",
  'admin/pruebas/frontera/deuda.json': `${JSON.stringify({ cruces: [{ desde: `${F}/muestra.ts`, hacia: `${F}/region.ts`, porque: 'x' }], sinZona: [], sinResolver: {}, transversales: [] }, null, 2)}\n`,
  'scripts/staging.sh': 'grep x admin/functions/src/muestra.ts admin/functions/src/muestra.tsx\n',
  'admin/pruebas/fixture.test.ts': "const CASOS = { 'admin/functions/src/muestra.ts': 1 };\nconst m = { de: 'admin/functions/src/muestra.ts' };\n",
  'Flujos/a.json': '{}',
};
const arbol: ArbolConCarpetas = {
  leer: (a) => ARCHIVOS[a] ?? '',
  existe: (a) => a in ARCHIVOS,
  esCarpeta: (r) => Object.keys(ARCHIVOS).some((a) => a.startsWith(`${r}/`)),
};
const TANDA = [
  { de: `${F}/muestra.ts`, a: `${F}/core/conteo/muestra.ts` },
  { de: 'admin/web/src/lib/muestra.ts', a: 'admin/web/src/core/lib/muestra.ts' },
  { de: 'admin/pruebas/central/panel.test.ts', a: 'admin/pruebas/plataforma/sub/panel.test.ts' },
];
const plan = planDeMudanza(TANDA, Object.keys(ARCHIVOS), arbol);
const texto = (a: string) => plan.ediciones.find((e) => e.archivo === a)?.nuevoTexto ?? ARCHIVOS[a];

describe('planDeMudanza', () => {
  it('reescribe los imports PROPIOS del archivo movido', () => {
    expect(texto(`${F}/core/conteo/muestra.ts`)).toContain("from '../../region.js'");
  });
  it('Functions: el import con .js sigue con .js', () => {
    expect(texto(`${F}/index.ts`)).toBe("export { x } from './core/conteo/muestra.js';\n");
  });
  it('la consola: sin extensión, y desde un archivo que también se mueve', () => {
    expect(texto('admin/web/src/core/lib/muestra.ts')).toBe("export * from '../../../../functions/src/core/conteo/muestra';\n");
    expect(texto('admin/web/src/paginas/Estado.tsx')).toContain("from '../core/lib/muestra'");
  });
  it('scripts: join(FUENTES, …) por segmentos, y el compilado lib/*.js', () => {
    const t = texto('admin/scripts/pase.mjs')!;
    expect(t).toContain("join(FUENTES, 'core', 'conteo', 'muestra.ts')");
    expect(t).toContain("import('../functions/lib/core/conteo/muestra.js')");
    expect(t).toContain("join(aqui, '..', 'functions', 'src')"); // la base no se toca: el script no se mueve
  });
  it('pruebas: vi.mock, el import y la ruta desde la raíz', () => {
    const t = texto('admin/pruebas/umbrales.test.ts')!;
    expect(t).toContain("vi.mock('../functions/src/core/conteo/muestra.ts')");
    expect(t).toContain("from '../functions/src/core/conteo/muestra.ts'");
    expect(t).toContain("leer('admin/functions/src/core/conteo/muestra.ts')");
  });
  it('una prueba movida más hondo: sus imports y su join(aqui, …) a una carpeta', () => {
    const t = texto('admin/pruebas/plataforma/sub/panel.test.ts')!;
    expect(t).toContain("from '../../../web/src/core/lib/muestra'");
    expect(t).toContain("join(aqui, '..', '..', '..', '..', 'Flujos')");
  });
  it('SUITES_PURAS (ruta desde admin/), deuda.json y un .sh', () => {
    expect(texto('admin/vitest.config.ts')).toContain("'pruebas/plataforma/sub/panel.test.ts'");
    expect(JSON.parse(texto('admin/pruebas/frontera/deuda.json')!).cruces[0].desde).toBe(`${F}/core/conteo/muestra.ts`);
    // Con límites: el .tsx que empieza igual no se toca.
    expect(texto('scripts/staging.sh')).toBe('grep x admin/functions/src/core/conteo/muestra.ts admin/functions/src/muestra.tsx\n');
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
  const ok = consulta([`${F}/muestra.ts`, `${F}/region.ts`]);
  it('una tanda correcta no tiene errores', () => {
    expect(validarTanda([{ de: `${F}/muestra.ts`, a: `${F}/core/conteo/muestra.ts` }], ok)).toEqual([]);
  });
  it('rechaza salir del repositorio, rutas absolutas o no normales, y salir de las raíces', () => {
    for (const a of ['../../tmp/x.ts', '/tmp/x.ts', `${F}/core/../x.ts`, `${F}//x.ts`, 'admin/firestore.ts', '.github/x.ts']) {
      expect(validarTanda([{ de: `${F}/muestra.ts`, a }], ok).length, a).toBeGreaterThan(0);
    }
  });
  it('rechaza cambiar la extensión, repetir, mover lo que no está versionado o pisar lo que existe', () => {
    expect(validarTanda([{ de: `${F}/muestra.ts`, a: `${F}/core/muestra.js` }], ok)).toHaveLength(1);
    expect(validarTanda([{ de: `${F}/muestra.ts`, a: `${F}/core/a.ts` }, { de: `${F}/muestra.ts`, a: `${F}/core/b.ts` }], ok).length).toBeGreaterThan(0);
    expect(validarTanda([{ de: `${F}/no-esta.ts`, a: `${F}/core/no-esta.ts` }], ok)).toHaveLength(1);
    expect(validarTanda([{ de: `${F}/muestra.ts`, a: `${F}/region.ts` }], ok)).toHaveLength(1);
    expect(validarTanda([{ de: `${F}/muestra.ts`, a: `${F}/enlace/muestra.ts` }], consulta([`${F}/muestra.ts`], [], [`${F}/enlace`]))).toHaveLength(1);
    expect(validarTanda([], ok)).toHaveLength(1);
    expect(validarTanda([{ de: 1, a: 2 }], ok)).toHaveLength(1);
  });
});

describe('verificarReproducible (lo que usa solo-rutas.mjs)', () => {
  const T = { movimientos: TANDA, suitesPuras: ['pruebas/otra.test.ts'] };
  const leerBase = (r: string) => ARCHIVOS[r] ?? '';
  const diffPerfecto = [
    ...TANDA.map((m) => ({ estado: 'R100', viejo: m.de, nuevo: m.a })),
    ...plan.ediciones.filter((e) => !TANDA.some((m) => m.a === e.archivo) && e.cambios.length)
      .map((e) => ({ estado: 'M', viejo: e.archivo, nuevo: e.archivo })),
  ];
  const head = (cambios: Record<string, string> = {}) => (r: string) =>
    cambios[r] ?? plan.ediciones.find((e) => e.archivo === r)?.nuevoTexto ?? ARCHIVOS[r] ?? '';
  const problemas = (diff = diffPerfecto, cambios: Record<string, string> = {}, base = leerBase) =>
    verificarReproducible(T, plan, diff, base, head(cambios), 'docs/arquitectura/tandas/t9.json').problemas;
  const M = (r: string) => ({ estado: 'M', viejo: r, nuevo: r });

  it('el PR que es exactamente la mudanza pasa, con el archivo de la tanda agregado', () => {
    expect(problemas([...diffPerfecto, { estado: 'A', viejo: 'docs/arquitectura/tandas/t9.json', nuevo: 'docs/arquitectura/tandas/t9.json' }])).toEqual([]);
  });
  it('un literal que NO es una ruta, cambiado en un archivo de la tanda, no pasa (región)', () => {
    const idx = texto(`${F}/index.ts`)!;
    expect(problemas(diffPerfecto, { [`${F}/index.ts`]: `${idx}export const R = 'europe-west1';\n` }))
      .toEqual([`${F}/index.ts: no es lo que produce la mudanza (cambia algo más que rutas)`]);
  });
  it('un archivo que la tanda no toca, modificado, no pasa', () => {
    expect(problemas([...diffPerfecto, M(`${F}/region.ts`)], { [`${F}/region.ts`]: "export const REGION = 'x';\n" })).toHaveLength(1);
  });
  it('un archivo nuevo o borrado, o un renombre fuera de la tanda, no pasa', () => {
    expect(problemas([...diffPerfecto, { estado: 'A', viejo: 'x.ts', nuevo: 'x.ts' }])).toHaveLength(1);
    expect(problemas([...diffPerfecto, { estado: 'R100', viejo: `${F}/region.ts`, nuevo: `${F}/core/region.ts` }])).toHaveLength(1);
  });
  it('un PR que se olvida de reescribir un consumidor no pasa', () => {
    expect(problemas(diffPerfecto.filter((d) => d.nuevo !== `${F}/index.ts`))).toEqual([`${F}/index.ts: la mudanza lo reescribe y el PR no`]);
  });
  it('comentarios: la CITA de la ruta nueva pasa; cualquier otro comentario, no (/*#__PURE__*/ quitaría App Check)', () => {
    const base = (r: string) => (r === `${F}/region.ts` ? '// ver admin/functions/src/muestra.ts\ninitializeAppCheck(app, {});\n' : leerBase(r));
    const d = [...diffPerfecto, M(`${F}/region.ts`)];
    expect(problemas(d, { [`${F}/region.ts`]: '// ver admin/functions/src/core/conteo/muestra.ts\ninitializeAppCheck(app, {});\n' }, base)).toEqual([]);
    expect(problemas(d, { [`${F}/region.ts`]: '// ver admin/functions/src/muestra.ts\n/*#__PURE__*/ initializeAppCheck(app, {});\n' }, base)).toHaveLength(1);
    expect(problemas(d, { [`${F}/region.ts`]: '// @ts-nocheck\n// ver admin/functions/src/muestra.ts\ninitializeAppCheck(app, {});\n' }, base)).toHaveLength(1);
  });
  it('un error de sintaxis no pasa por comentario', () => {
    const base = (r: string) => (r === `${F}/region.ts` ? 'f(1); // admin/functions/src/muestra.ts\n' : leerBase(r));
    expect(problemas([...diffPerfecto, M(`${F}/region.ts`)], { [`${F}/region.ts`]: 'f(1); // admin/functions/src/core/conteo/muestra.ts\n)\n' }, base)).toHaveLength(1);
  });
  it('a mano: QUITAR deuda pasa; agregar, no', () => {
    const deuda = JSON.parse(texto('admin/pruebas/frontera/deuda.json')!);
    expect(problemas(diffPerfecto, { 'admin/pruebas/frontera/deuda.json': `${JSON.stringify({ ...deuda, cruces: [] }, null, 2)}\n` })).toEqual([]);
    const conOtro = `${JSON.stringify({ ...deuda, cruces: [...deuda.cruces, { desde: 'a', hacia: 'b', porque: 'x' }] }, null, 2)}\n`;
    expect(problemas(diffPerfecto, { 'admin/pruebas/frontera/deuda.json': conOtro })).toHaveLength(1);
  });
  it('vitest.config.ts: solo entran las suites declaradas en la tanda, ninguna vetada, y el resto no se toca', () => {
    const vitest = texto('admin/vitest.config.ts')!;
    const con = (x: string) => vitest.replace('[\n', `[\n  '${x}',\n`);
    expect(problemas(diffPerfecto, { 'admin/vitest.config.ts': con('pruebas/otra.test.ts') })).toEqual([]);
    expect(problemas(diffPerfecto, { 'admin/vitest.config.ts': con('pruebas/no-declarada.test.ts') })).toHaveLength(1);
    expect(verificarReproducible({ movimientos: TANDA, suitesPuras: ['pruebas/asignar-rol.test.ts'] }, plan, diffPerfecto, leerBase,
      head({ 'admin/vitest.config.ts': con('pruebas/asignar-rol.test.ts') })).problemas.length).toBeGreaterThan(0);
    // Mover código a un comentario (la guarda o el env) no es tocar SUITES_PURAS.
    expect(problemas(diffPerfecto, { 'admin/vitest.config.ts': `${vitest}if (x) { throw new Error('y'); }\n` })).toHaveLength(1);
    expect(problemas(diffPerfecto, { 'admin/vitest.config.ts': `// ${vitest.replace(/\n/g, '\n// ')}` })).toHaveLength(1);
  });
  it('un .md que cambia más que la cita se lista para revisar a mano', () => {
    const base = (r: string) => (r === 'docs/x.md' ? 'ver admin/functions/src/muestra.ts\n' : leerBase(r));
    const cita = verificarReproducible(T, plan, [...diffPerfecto, M('docs/x.md')], base, head({ 'docs/x.md': 'ver admin/functions/src/core/conteo/muestra.ts\n' }));
    expect(cita.revisarAMano).toEqual([]);
    const mas = verificarReproducible(T, plan, [...diffPerfecto, M('docs/x.md')], base, head({ 'docs/x.md': 'otra cosa\n' }));
    expect(mas.revisarAMano).toEqual(['docs/x.md']);
  });
});

describe('contextos: relativo solo en módulos; completo también en lecturas y join', () => {
  const arb: ArbolConCarpetas = {
    leer: (a) => ({
      [`${F}/muestra.ts`]: '',
      'admin/pruebas/p.test.ts': "const a = join(RAIZ, 'admin/functions/src/muestra.ts');\nconst b = readFileSync('../functions/src/muestra.ts');\nimport { m } from '../functions/src/muestra';\n",
    } as Record<string, string>)[a] ?? '',
    existe: (a) => a === `${F}/muestra.ts` || a === 'admin/pruebas/p.test.ts',
    esCarpeta: () => false,
  };
  const p = planDeMudanza([{ de: `${F}/muestra.ts`, a: `${F}/core/muestra.ts` }], ['admin/pruebas/p.test.ts'], arb);
  const t = p.ediciones.find((e) => e.archivo === 'admin/pruebas/p.test.ts')!.nuevoTexto;
  it('join(RAIZ, ruta completa) se reescribe', () => { expect(t).toContain("join(RAIZ, 'admin/functions/src/core/muestra.ts')"); });
  it('un relativo en una lectura (relativo a la carpeta de trabajo) NO: se avisa', () => {
    expect(t).toContain("readFileSync('../functions/src/muestra.ts')");
    expect(p.avisos.some((a) => a.includes("'../functions/src/muestra.ts'"))).toBe(true);
  });
  it('un relativo en un import sí', () => { expect(t).toContain("from '../functions/src/core/muestra'"); });
});
