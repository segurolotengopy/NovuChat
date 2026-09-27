/**
 * LA MUDANZA DE F2 — `mudanza.ts`, sobre un árbol inventado.
 *
 * Cada forma en que el repositorio nombra un archivo que F2 mueve tiene su
 * caso: el import de Functions (`.js`), el de la consola (sin extensión), el
 * compilado (`lib/*.js`), `join(FUENTES, …)`, `vi.mock`, la ruta desde la raíz,
 * la ruta desde `admin/` (`SUITES_PURAS`), `deuda.json`, un `.sh`, los imports
 * PROPIOS del archivo movido y un `join(aqui, …)` a una carpeta desde un
 * archivo movido. Y `soloRutas`, que distingue un cambio de rutas de uno de
 * lógica.
 */
import { describe, expect, it } from 'vitest';
import { esqueleto, planDeMudanza, soloRutas, type ArbolConCarpetas } from './mudanza.ts';

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
  'admin/vitest.config.ts': "export const SUITES_PURAS = ['pruebas/central/panel.test.ts'];\n",
  'admin/pruebas/frontera/deuda.json': `${JSON.stringify({ cruces: [{ desde: `${F}/atencion.ts`, hacia: `${F}/region.ts`, porque: 'x' }], sinZona: [], sinResolver: {}, transversales: [] }, null, 2)}\n`,
  'scripts/staging.sh': 'grep x admin/functions/src/atencion.ts\n',
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
    expect(texto('scripts/staging.sh')).toBe('grep x admin/functions/src/core/conteo/atencion.ts\n');
  });
  it('no toca lo que no nombra un archivo movido', () => {
    expect(plan.ediciones.map((e) => e.archivo)).not.toContain(`${F}/region.ts`);
    expect(plan.ediciones.map((e) => e.archivo)).not.toContain('Flujos/a.json');
  });
  it('todo lo que reescribió es solo de rutas', () => {
    for (const e of plan.ediciones) {
      const viejo = TANDA.find((m) => m.a === e.archivo)?.de ?? e.archivo;
      if (/\.(ts|tsx|mjs)$/.test(e.archivo)) expect(soloRutas(e.archivo, ARCHIVOS[viejo]!, e.nuevoTexto), e.archivo).toBe(true);
    }
  });
});

describe('soloRutas', () => {
  it('un cambio de ruta, aun con más segmentos en un join, es solo de rutas', () => {
    expect(soloRutas('a.mjs', "import x from './a.js';\nf(join(B, 'a.ts'));", "import x from '../../a.js';\nf(join(B, 'core', 'a.ts'));")).toBe(true);
  });
  it('un cambio de lógica no lo es', () => {
    expect(soloRutas('a.ts', 'const x = 1;', 'const x = 2;')).toBe(false);
    expect(soloRutas('a.ts', "import { a } from './a.js';", "import { a, b } from './a.js';")).toBe(false);
    expect(soloRutas('a.ts', "f('a');", "g('a');")).toBe(false);
  });
  it('los comentarios y los espacios no cuentan', () => {
    expect(esqueleto('a.ts', '// hola\nconst x = 1;')).toBe(esqueleto('a.ts', 'const  x=1; /* otro */'));
  });
});
