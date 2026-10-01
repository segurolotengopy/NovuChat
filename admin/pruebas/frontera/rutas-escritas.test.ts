/**
 * =============================================================================
 * LAS RUTAS ESCRITAS EN LOS SCRIPTS LLEVAN A UN ARCHIVO (F2, tanda cero)
 * =============================================================================
 *
 * F2 mueve archivos de `functions/src` y de `admin/scripts`. Un import en
 * TypeScript que queda roto lo atrapa la compilación, y uno de un script con
 * zona lo atrapa `fronteras.test.ts`. Pero un script arma rutas a partir de su
 * propia ubicación (`import.meta.url`, `aqui`, `__dirname`) y falla recién al
 * correr, a veces contra producción.
 *
 * Esta prueba lee el CÓDIGO de todo `admin/scripts/**` y `scripts/**` con el
 * parser de `typescript` (`rutas-escritas.ts`, que evalúa las rutas sin correr
 * el script) y exige:
 *   1. todo import relativo lleva a un archivo (con el lector de la frontera);
 *   2. todo literal con `functions/src/…` o `functions/lib/…` y extensión lleva
 *      a un archivo (`lib/x.js` es el compilado de `src/x.ts`; en un `.sh`, el
 *      texto);
 *   3. todo `new URL`, `join`, `resolve`, plantilla o suma ANCLADOS a
 *      `import.meta.url`, `aqui` o `__dirname` resuelve estáticamente a un
 *      archivo o carpeta que existe HOY. Si no se puede calcular (un nombre que
 *      llega por argumento, una función propia) es un error, no una omisión:
 *      mover el script lo rompería sin que nadie lo vea.
 *
 * Los casos que hoy no se pueden calcular están en `SIN_CALCULAR`, con su
 * porqué: son deuda declarada que solo puede bajar (una entrada que ya no se
 * da falla, y un caso nuevo no entra solo). Cambiar esa lista es de la
 * coordinadora, como `deuda.json`.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RAIZ, importsDe, sinComentarios } from './frontera.ts';
import { aFuente, literalesDeFunctions, lleva, sitiosDe, type Disco } from './rutas-escritas.ts';

const listar = (dir: string): string[] => readdirSync(join(RAIZ, dir), { withFileTypes: true }).flatMap((e) =>
  (e.isDirectory() ? (e.name === 'node_modules' ? [] : listar(`${dir}/${e.name}`))
    : /\.(mjs|js|ts|mts|sh)$/.test(e.name) ? [`${dir}/${e.name}`] : []));
const SCRIPTS = [...listar('admin/scripts'), ...listar('scripts')];
const esJs = (a: string) => /\.(mjs|js|ts|mts)$/.test(a);

const DISCO_REAL: Disco = { existe: (r) => existsSync(join(RAIZ, r)) };

/** Archivo (no carpeta) que existe: para los literales, que nombran archivos. */
const existeArchivo = (r: string) => {
  const f = aFuente(r);
  return existsSync(join(RAIZ, f)) && statSync(join(RAIZ, f)).isFile();
};

/**
 * Casos reales que no se pueden calcular sin correr el script, identificados
 * por el TEXTO del sitio. Solo descuentan hallazgos «no se puede calcular»: un
 * «no existe» (la base o el prefijo calculado no lleva a nada) nunca se
 * descuenta. Solo baja: una entrada que ya no se da falla, y un caso nuevo no
 * entra solo.
 */
const SIN_CALCULAR: readonly { archivo: string; sitio: string; porque: string }[] = [
  { archivo: 'admin/scripts/catalogo-demo.mjs', sitio: "join(RAIZ, 'scripts', 'datos', CONJUNTOS[CONJUNTO].archivo)",
    porque: 'el archivo del conjunto sale de un diccionario; el prefijo admin/scripts/datos se verifica' },
  { archivo: 'admin/scripts/catalogo-demo.mjs', sitio: 'join(DIST, ruta)',
    porque: 'servidor de la vista previa: el último tramo es la ruta de la petición (admin/web/dist se verifica)' },
  { archivo: 'admin/scripts/probar-csp.mjs', sitio: 'join(DIST, ruta)',
    porque: 'servidor de archivos estáticos: el último tramo es la ruta de la petición (admin/web/dist se verifica)' },
  { archivo: 'admin/scripts/pase-a-produccion.mjs', sitio: 'join(dirFlujos, a)',
    porque: 'nombres de Flujos/ leídos del disco; el prefijo Flujos se verifica' },
  { archivo: 'admin/scripts/pase-a-produccion.mjs', sitio: "join(REPO, 'admin', 'scripts', 'datos', `negocio-${TENANT}.json`)",
    porque: 'el nombre depende del tenant; el prefijo admin/scripts/datos se verifica' },
  { archivo: 'admin/scripts/probar-cierre.mjs', sitio: "new URL(ARCHIVO, new URL('../../', import.meta.url))",
    porque: "el .env sale de `leer('--env', '.env')` (opción con valor por defecto) y se une a la raíz calculada" },
  { archivo: 'admin/scripts/sembrar-demos.mjs', sitio: 'new URL(nombre, RAIZ)',
    porque: 'el nombre de cada archivo de una lista; la raíz sí se calcula' },
];

interface Hallazgo { tipo: 'calcular' | 'no-existe'; sitio: string; mensaje: string }

/** Lo que no se calcula (y si su prefijo calculado no existe, también eso), y lo que se calcula y no existe. */
export function analizarRutas(archivo: string, texto: string, disco: Disco): Hallazgo[] {
  return sitiosDe(archivo, texto).flatMap((s): Hallazgo[] => {
    const donde = `${archivo}:${s.linea}`;
    if (s.ruta !== null) {
      return lleva(s.ruta, disco) ? [] : [{ tipo: 'no-existe', sitio: s.texto, mensaje: `${donde}: ${s.ruta} no existe: ${s.texto}` }];
    }
    const salida: Hallazgo[] = [{ tipo: 'calcular', sitio: s.texto, mensaje: `${donde}: no se puede calcular (${s.motivo}): ${s.texto}` }];
    if (s.prefijo !== null && !lleva(s.prefijo, disco)) {
      salida.push({ tipo: 'no-existe', sitio: s.texto, mensaje: `${donde}: el prefijo ${s.prefijo} no existe: ${s.texto}` });
    }
    return salida;
  });
}

export const hallazgosDe = (archivo: string, texto: string, disco: Disco): string[] =>
  analizarRutas(archivo, texto, disco).map((h) => h.mensaje);

describe('las rutas escritas en los scripts llevan a un archivo', () => {
  it('hay scripts que revisar, y las formas conocidas se reconocen (control de que no pasa en vacío)', () => {
    expect(SCRIPTS.length).toBeGreaterThan(40);
    const sitios = SCRIPTS.filter(esJs).flatMap((a) => sitiosDe(a, readFileSync(join(RAIZ, a), 'utf8')).map((s) => ({ a, ...s })));
    const rutas = sitios.map((s) => s.ruta);
    // pase-a-produccion (join(FUENTES, …)), el compilado de migrar-prepago (new URL(…, import.meta.url))
    // y el `new URL('../../', import.meta.url)` de sembrar-demos tienen que verse.
    expect(rutas.some((r) => r?.endsWith('/atencion.ts'))).toBe(true);
    expect(rutas.some((r) => r?.startsWith('admin/functions/lib/') && r.endsWith('/prepago.js'))).toBe(true);
    expect(sitios.some((s) => s.a === 'admin/scripts/sembrar-demos.mjs' && s.ruta === '.')).toBe(true);
    expect(sitios.length).toBeGreaterThan(30);
  });

  it('todo import relativo de un script lleva a un archivo (también los scripts sin zona)', () => {
    const rotos = SCRIPTS.filter(esJs)
      .flatMap((a) => importsDe(a).filter((i) => i.especificador.startsWith('.') && !i.destino)
        .map((i) => `${a}: ${i.especificador}`));
    expect(rotos).toEqual([]);
  });

  it('todo literal hacia admin/functions lleva a un archivo', () => {
    const rotas = SCRIPTS.flatMap((a) => {
      const texto = readFileSync(join(RAIZ, a), 'utf8');
      const rutas = esJs(a) ? literalesDeFunctions(a, texto).map((l) => l.ruta)
        : [...sinComentarios(texto).matchAll(/['"`]([^'"`\s$*]*functions\/(?:src|lib)\/[^'"`\s$*]+\.(?:ts|js|mjs))['"`]/g)]
          .map((m) => (m[1]!.startsWith('admin/') ? m[1]! : `admin/${m[1]}`));
      return rutas.filter((r) => !existeArchivo(r)).map((r) => `${a}: ${r}`);
    });
    expect(rotas, 'Ruta a una Function que no existe (¿se movió?): se corrige en el mismo PR que mueve el archivo').toEqual([]);
  });

  it('toda ruta anclada al script (import.meta.url, aqui, __dirname) se calcula y lleva a algo que existe', () => {
    const porArchivo = SCRIPTS.filter(esJs).flatMap((a) => analizarRutas(a, readFileSync(join(RAIZ, a), 'utf8'), DISCO_REAL).map((h) => ({ a, ...h })));
    const usadas = new Set<number>();
    const nuevos = porArchivo.filter((h) => {
      const i = SIN_CALCULAR.findIndex((d) => h.tipo === 'calcular' && d.archivo === h.a && d.sitio === h.sitio);
      if (i >= 0) usadas.add(i);
      return i < 0;
    }).map((h) => h.mensaje);
    const sobran = SIN_CALCULAR.filter((_, i) => !usadas.has(i)).map((d) => `${d.archivo}: ${d.sitio}`);
    expect(sobran, 'La deuda de SIN_CALCULAR solo baja: estas entradas ya no se dan').toEqual([]);
    expect(nuevos, 'Ruta que depende de la ubicación del script y no lleva a nada (¿se movió el script o el destino?)').toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// La regla, negando: sobre un árbol inventado, como mudanza.test.ts.
// ---------------------------------------------------------------------------
const ARBOL: Record<string, string> = {
  'admin/firebase.json': '{}',
  'admin/web/src/main.tsx': '',
  'admin/functions/src/core/conteo/atencion.ts': '',
  'Flujos/a.json': '{}',
  'admin/scripts/sub/ok.mjs': '',
};
const disco: Disco = {
  existe: (r) => r === '.' || r in ARBOL || Object.keys(ARBOL).some((a) => a.startsWith(`${r}/`)),
};

describe('la regla, negando: un árbol inventado con las formas rotas', () => {
  // Cada script está en admin/scripts/sub/, como si F2 lo hubiera movido desde admin/scripts/.
  const SUB = 'admin/scripts/sub/mueve.mjs';
  const ROTOS: Record<string, string> = {
    'resolve(new URL(..).pathname) y join(RAIZ, …)':
      "import { join, resolve } from 'node:path';\nconst RAIZ = resolve(new URL('..', import.meta.url).pathname);\nconst C = join(RAIZ, 'firebase.json');\n",
    'join(REPO, …) con REPO a base de import.meta.url':
      "import { join } from 'node:path';\nconst REPO = new URL('../..', import.meta.url).pathname;\nconst F = join(REPO, 'Flujos');\n",
    "new URL('../../x', import.meta.url)":
      "const t = readFileSync(new URL('../../x.json', import.meta.url), 'utf8');\n",
    'ruta en plantilla':
      "const aqui = dirname(fileURLToPath(import.meta.url));\nconst c = `${aqui}/../../no-existe.json`;\n",
    'ruta con un nombre que llega por argumento':
      "import { join } from 'node:path';\nconst aqui = dirname(fileURLToPath(import.meta.url));\nexport const f = (nombre) => join(aqui, nombre);\n",
    'ruta que depende de una constante que no se calcula':
      "import { join } from 'node:path';\nimport { dirname } from 'node:path';\nimport { fileURLToPath } from 'node:url';\nconst aqui = dirname(fileURLToPath(import.meta.url));\nconst T = process.env.TENANT;\nconst a = join(aqui, '..', T);\n",
    'join(FUENTES, no-existe.ts) como en main':
      "import { join } from 'node:path';\nconst FUENTES = join(aqui, '..', '..', 'functions', 'src');\nawait import(join(FUENTES, 'no-existe.ts'));\n",
    'join(LIB, viejo/prepago.js) sobre functions/lib (compilado, solo cuenta su fuente)':
      "import { join } from 'node:path';\nconst LIB = join(aqui, '..', '..', 'functions', 'lib');\nawait import(join(LIB, 'viejo', 'prepago.js'));\n",
    'prefijo calculado que no existe aunque el resto no se calcule':
      "import { join } from 'node:path';\nexport const f = (n) => join(aqui, '..', 'carpeta-movida', n);\n",
    'ruta con un alias de import y path.resolve':
      "import { join as unir } from 'node:path';\nimport * as path from 'node:path';\nconst aqui = path.dirname(new URL(import.meta.url).pathname);\nconst b = path.resolve(aqui, '../../Flujos-viejos');\nconst c = unir(aqui, 'no-existe.json');\n",
  };
  for (const [forma, texto] of Object.entries(ROTOS)) {
    it(`falla: ${forma}`, () => {
      const h = hallazgosDe(SUB, texto, disco);
      // Las cuatro primeras formas dan exactamente un hallazgo: la base se calcula bien y lo que falla es el destino.
      expect(h.length, `${forma}: ${h.join(' | ')}`).toBeGreaterThanOrEqual(1);
      if (Object.keys(ROTOS).indexOf(forma) < 4) {
        expect(h.length, h.join(' | ')).toBe(1);
        expect(h[0], forma).toContain('no existe');
      }
    });
  }

  it('la forma de resolve(new URL(..)) desde donde el script no se movió SÍ pasa (control)', () => {
    const texto = "import { join, resolve } from 'node:path';\nconst RAIZ = resolve(new URL('..', import.meta.url).pathname);\nconst C = join(RAIZ, 'firebase.json');\n";
    expect(hallazgosDe('admin/scripts/ok.mjs', texto, disco)).toEqual([]);
  });

  it('se aceptan las formas que sí resuelven: constantes encadenadas, plantilla, ?? y ||', () => {
    const texto = [
      "import { dirname, join, resolve } from 'node:path';",
      "import { fileURLToPath } from 'node:url';",
      "const aqui = dirname(fileURLToPath(import.meta.url));",
      "const ADMIN = join(aqui, '..', '..');",
      "const REL = '../../../Flujos';",
      "const a = join(ADMIN, 'firebase.json');",
      "const b = resolve(aqui, REL);",
      "const c = resolve(opcion('repo') ?? join(aqui, '..', '..', '..'));",
      "const d = new URL(REL, import.meta.url);",
      "const e = join(aqui, `..${'/'}..`, 'firebase.json') || 'otro';",
      "const f = `${ADMIN}/web/src/main.tsx`;",
      "const g = ADMIN + '/functions/src/core/conteo/atencion.ts';",
      '',
    ].join('\n');
    expect(hallazgosDe(SUB, texto, disco)).toEqual([]);
  });

  it('un comentario que cita una ruta rota no cuenta', () => {
    expect(hallazgosDe(SUB, "// join(aqui, 'no-existe.ts')\n/* new URL('../../x', import.meta.url) */\n", disco)).toEqual([]);
    expect(literalesDeFunctions(SUB, "// ver functions/src/no-existe.ts\n")).toEqual([]);
  });

  it('los literales: una ruta movida se detecta en cada forma', () => {
    const casos: Record<string, string> = {
      'admin/scripts/b.mjs': "const m = await import('../functions/lib/no-existe.js');",
      'admin/scripts/c.mjs': "const t = readFileSync('admin/functions/src/no-existe.ts', 'utf8');",
    };
    for (const [archivo, texto] of Object.entries(casos)) {
      const rutas = literalesDeFunctions(archivo, texto).map((l) => l.ruta);
      expect(rutas.length, archivo).toBe(1);
      expect(disco.existe(aFuente(rutas[0]!)), archivo).toBe(false);
    }
    expect(posix.normalize('admin/scripts/../functions/src/x.ts')).toBe('admin/functions/src/x.ts');
  });

  it('lo local y lo generado se acepta solo si su carpeta existe, y lo demás que no existe falla', () => {
    const base = "const aqui = dirname(fileURLToPath(import.meta.url));\n";
    const ok = `${base}const a = resolve(aqui, '../../../CLIENTES/X/logo.webp');\nconst d = join(aqui, '..', '..', 'web', 'dist', 'index.html');\n`;
    expect(hallazgosDe(SUB, ok, disco)).toEqual([]);
    const mal = `${base}const d = join(aqui, '..', 'dist', 'index.html');\n`;
    expect(hallazgosDe(SUB, mal, disco).length).toBe(1);
  });
});
