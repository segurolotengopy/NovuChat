/**
 * =============================================================================
 * LA FRONTERA DE ZONAS, como funciones (F2, PR 2)
 * =============================================================================
 *
 * Lo que comparten `fronteras.test.ts` (la prueba que falla) y
 * `scripts/medir-zonas.mjs` (la medición que se cita en cada informe de hito):
 * de qué zona es un archivo, qué importa, y qué importación va hacia arriba.
 * Viven en un solo lugar para que la prueba y la medición no puedan contar
 * distinto.
 *
 * LA ZONA DE UN ARCHIVO, en este orden:
 *   1. Una entrada de `DESTINOS_F2` (el inventario del §5): mientras dura F2,
 *      el archivo que todavía no se movió ya tiene la zona a la que va.
 *   2. La CARPETA (`Analisis/41` §1: carpeta = zona): `core/`, `central/`,
 *      `plataforma/` y `modulos/<m>/` bajo cada raíz de código, y
 *      `scripts/datos/` (tenants). Es la regla permanente: cuando F2 termine,
 *      `DESTINOS_F2` se borra y esto es lo único que queda.
 *   3. El prefijo más largo de `PREFIJOS_F2` (lo que el §5 ubica por carpeta
 *      entera sin que la carpeta tenga todavía el nombre de su zona).
 *
 * HACIA ARRIBA: registro < core < central < plataforma < módulo < coordinador
 * < tenants. Una zona importa solo de la suya o de las de abajo; un módulo
 * importa a otro solo si lo declara (directa o indirectamente) en `dependeDe`
 * del registro. Las reexportaciones de `functions/src/index.ts` no cuentan: son
 * el inventario de despliegue, no una dependencia.
 *
 * Un import de «solo tipo» también cuenta: acopla igual, y es el que primero
 * se esconde. Y un cruce no se lava pasando por un archivo sin zona o por un
 * ayudante de prueba: el análisis sigue esos archivos hasta el primero con
 * zona (revisión de seguridad del PR #231).
 *
 * LOS IMPORTS SE LEEN CON EL PARSER DE TYPESCRIPT, no con expresiones
 * regulares: un texto con `/*` (`accept="image/*"`), un `import{a}from'x'`
 * sin espacios o un `export` sin punto y coma engañaban al lector anterior.
 *
 * DÓNDE VIVE Y QUIÉN LO CAMBIA. En `admin/pruebas/frontera/`, que no está en la
 * zona de ningún agente (`docs/arquitectura/agentes.md`): la regla, la deuda y
 * el inventario los cambia solo la coordinadora. Si estuvieran en
 * `pruebas/core/`, un agente de Core podría «arreglar» una prueba roja
 * agregando su cruce a la deuda, dentro de su zona.
 *
 * Node carga este archivo quitando tipos (desde `medir-zonas.mjs`): nada de
 * `enum` ni de parámetros con modificador, y las importaciones relativas con
 * su extensión.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { REGISTRO } from '../../functions/src/registro.ts';
import { DESTINOS_F2, PREFIJOS_F2 } from './destinos-f2.ts';
import type { DestinoF2, ZonaF2 } from './destinos-f2.ts';

/**
 * La raíz del repositorio. `NOVUCHAT_RAIZ` la fija cuando la herramienta corre
 * desde una copia de la BASE (`desde-la-base.sh`) contra el worktree de un PR:
 * así el verificador que juzga un PR de tanda no es el del PR.
 */
export const RAIZ = process.env['NOVUCHAT_RAIZ'] || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * La deuda de la frontera (`deuda.json`, en esta carpeta): cruces conocidos,
 * archivos sin zona, imports que no se pueden seguir y pruebas transversales.
 * En JSON para que el CI la compare con la de la base del PR sin ejecutar
 * TypeScript (`deuda-solo-baja.mjs`, en esta carpeta): ninguna lista puede crecer.
 */
export interface Deuda {
  readonly cruces: readonly { desde: string; hacia: string; porque: string; soloTipo?: true }[];
  readonly sinZona: readonly string[];
  readonly sinResolver: Readonly<Record<string, { cantidad: number; porque: string }>>;
  readonly transversales: readonly string[];
}
export function leerDeuda(): Deuda {
  return JSON.parse(readFileSync(join(RAIZ, 'admin/pruebas/frontera/deuda.json'), 'utf8')) as Deuda;
}

/** Las raíces de código: lo que tiene zona vive debajo de una de estas. */
export const RAICES = ['admin/functions/src/', 'admin/web/src/', 'Flujos/src/', 'admin/scripts/', 'admin/pruebas/'] as const;

export const RANGO: Readonly<Record<ZonaF2, number>> = {
  registro: -1, core: 0, central: 1, plataforma: 2, modulo: 3, coordinador: 4, tenants: 5,
};

/**
 * Archivos cuya zona no sale de la carpeta. El registro está en la raíz de
 * Functions a propósito (lo lee todo el mundo y no importa a nadie). El
 * coordinador de turno recibe su línea en el PR que mueva `ingesta.ts`; hasta
 * entonces lo ubica `DESTINOS_F2`, y la prueba falla si deja de haber uno.
 */
export const ZONA_POR_ARCHIVO: Readonly<Record<string, DestinoF2>> = {
  'admin/functions/src/registro.ts': { zona: 'registro', destino: 'admin/functions/src/registro.ts' },
  // Punto de entrada de la consola: monta las rutas de todas las zonas.
  'admin/web/src/App.tsx': { zona: 'coordinador', destino: 'admin/web/src/App.tsx' },
  // Arranque de la consola: toca todas las zonas.
  'admin/web/src/main.tsx': { zona: 'coordinador', destino: 'admin/web/src/main.tsx' },
  // Ensambla las pestañas de la consola de todas las zonas.
  'admin/web/src/consola.tsx': { zona: 'coordinador', destino: 'admin/web/src/consola.tsx' },
  // Herramienta de desarrollo: levanta los emuladores de todas las zonas; admin/package.json lo nombra.
  'admin/scripts/emuladores.sh': { zona: 'coordinador', destino: 'admin/scripts/emuladores.sh' },
  // Herramienta de desarrollo: regenera el lockfile de Functions, sin zona propia.
  'admin/scripts/lockfile-functions.sh': { zona: 'coordinador', destino: 'admin/scripts/lockfile-functions.sh' },
  // Herramienta de desarrollo: prueba de punta a punta del cierre, cruza zonas.
  'admin/scripts/probar-cierre.mjs': { zona: 'coordinador', destino: 'admin/scripts/probar-cierre.mjs' },
  // Herramienta de desarrollo: verifica la CSP de toda la consola.
  'admin/scripts/probar-csp.mjs': { zona: 'coordinador', destino: 'admin/scripts/probar-csp.mjs' },
  // Herramienta de desarrollo: siembra datos de todas las zonas; admin/package.json lo nombra.
  'admin/scripts/sembrar.mjs': { zona: 'coordinador', destino: 'admin/scripts/sembrar.mjs' },
  // Herramienta de desarrollo: usuarios de prueba para todas las zonas.
  'admin/scripts/usuarios-prueba.mjs': { zona: 'coordinador', destino: 'admin/scripts/usuarios-prueba.mjs' },
  // Corredor de las suites: toca todas las zonas.
  'admin/pruebas/correr.sh': { zona: 'coordinador', destino: 'admin/pruebas/correr.sh' },
  // Corredor de las reglas de Storage: toca todas las zonas.
  'admin/pruebas/correr-storage.sh': { zona: 'coordinador', destino: 'admin/pruebas/correr-storage.sh' },
  // Las reglas de Storage amparan a todas las zonas.
  'admin/pruebas/storage-reglas.test.ts': { zona: 'coordinador', destino: 'admin/pruebas/storage-reglas.test.ts' },
  // Las reglas de Firestore que cruzan zonas, con las campañas.
  'admin/pruebas/campanas-reglas.test.ts': { zona: 'coordinador', destino: 'admin/pruebas/campanas-reglas.test.ts' },
  // Doble de desarrollo (no hay una sexta zona): lo usan suites de varias zonas.
  'admin/pruebas/dobles/cobrador.ts': { zona: 'coordinador', destino: 'admin/pruebas/dobles/cobrador.ts' },
};

/**
 * El punto de entrada de las Functions. Sus reexportaciones no cuentan (son el
 * inventario de despliegue), y una PRUEBA que lo importa para llamar a una
 * callable tampoco: es lo mismo que llamarla por la red.
 */
export const INDICE_DE_FUNCTIONS = 'admin/functions/src/index.ts';

/**
 * Pruebas que leen todas las zonas POR DISEÑO, porque comprueban el registro
 * contra el código de cada una. Una prueba de zona que no esté acá importa
 * solo de su zona y de las de abajo, como el código.
 */
export const PRUEBAS_TRANSVERSALES: readonly string[] = leerDeuda().transversales;

export const esPrueba = (a: string): boolean => a.startsWith('admin/pruebas/');
export const esSuite = (a: string): boolean => esPrueba(a) && a.endsWith('.test.ts');
export const esCodigo = (a: string): boolean => /\.(ts|tsx|mts|cts|mjs|cjs|js|jsx)$/.test(a);
export const etiqueta = (z: DestinoF2): string => (z.zona === 'modulo' ? `modulo:${z.modulo}` : z.zona);

// -------------------------------------------------------------------- módulos
const DEPENDE = new Map<string, readonly string[]>(REGISTRO.map((m) => [m.modulo, m.dependeDe]));

/** Los módulos de los que `m` depende, directa o indirectamente. */
export function dependenciasDe(m: string, vistos: Set<string> = new Set()): Set<string> {
  for (const d of DEPENDE.get(m) ?? []) if (!vistos.has(d)) { vistos.add(d); dependenciasDe(d, vistos); }
  return vistos;
}

// ---------------------------------------------------------------------- zonas
/** La zona que da la carpeta, sin mirar el inventario. */
export function zonaPorCarpeta(archivo: string): DestinoF2 | null {
  if (ZONA_POR_ARCHIVO[archivo]) return ZONA_POR_ARCHIVO[archivo];
  const raiz = RAICES.find((r) => archivo.startsWith(r));
  if (!raiz) return null;
  const partes = archivo.slice(raiz.length).split('/');
  if (partes.length < 2) return null; // un archivo suelto en la raíz no está en una carpeta de zona
  const [primera, segunda] = partes;
  const destino = `${raiz}${primera}/`;
  if (primera === 'core') return { zona: 'core', destino };
  if (primera === 'central') return { zona: 'central', destino };
  if (primera === 'plataforma') return { zona: 'plataforma', destino };
  if (primera === 'modulos' && partes.length >= 3) return { zona: 'modulo', modulo: segunda, destino: `${destino}${segunda}/` };
  if (raiz === 'admin/scripts/' && primera === 'datos') return { zona: 'tenants', destino };
  return null;
}

/** La zona de un archivo de código: inventario, carpeta, prefijo (ver arriba). */
export function zonaDeCodigo(archivo: string): DestinoF2 | null {
  if (DESTINOS_F2[archivo]) return DESTINOS_F2[archivo];
  const porCarpeta = zonaPorCarpeta(archivo);
  if (porCarpeta) return porCarpeta;
  const prefijo = PREFIJOS_F2.filter((p) => archivo.startsWith(p.prefijo))
    .sort((a, b) => b.prefijo.length - a.prefijo.length)[0];
  return prefijo ? prefijo.destino : null;
}

// ---------------------------------------------------------------- el árbol
/** Lo que el análisis necesita del disco; la prueba negativa pasa uno de mentira. */
export interface Arbol {
  leer(archivo: string): string;
  existe(archivo: string): boolean;
}

export const ARBOL_REAL: Arbol = {
  leer: (a) => readFileSync(join(RAIZ, a), 'utf8'),
  existe: (a) => existsSync(join(RAIZ, a)) && statSync(join(RAIZ, a)).isFile(),
};

/** Todos los archivos de las raíces de código, relativos a la raíz, ordenados. */
export function listarRaices(): string[] {
  const listar = (dir: string): string[] => readdirSync(join(RAIZ, dir)).flatMap((n) => {
    if (n === 'node_modules') return [];
    const rel = `${dir}/${n}`;
    return statSync(join(RAIZ, rel)).isDirectory() ? listar(rel) : [rel];
  });
  return RAICES.flatMap((r) => listar(r.slice(0, -1))).sort();
}

// ------------------------------------------------------------ importaciones
/**
 * Quita comentarios SIN tocar el texto de los literales. Ya no lo usa el
 * lector de imports (que usa el parser); lo usa `medir-zonas.mjs` para buscar
 * rutas escritas en las pruebas.
 */
export const sinComentarios = (t: string): string =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[\s;])\/\/.*$/gm, '$1');

const EXTENSIONES = ['', '.ts', '.tsx', '.mjs', '.js', '.d.mts', '/index.ts', '/index.tsx'];

/** La ruta del archivo al que apunta un import relativo, o null si no existe. */
export function resolverRelativo(desde: string, especificador: string, arbol: Arbol = ARBOL_REAL): string | null {
  let base = posix.normalize(posix.join(posix.dirname(desde), especificador.replace(/\?.*$/, '')));
  if (base.startsWith('../')) return null;
  // Los scripts importan las Functions COMPILADAS (`functions/lib/*.js`), que
  // no están en el repositorio: la dependencia real es con su fuente.
  if (base.startsWith('admin/functions/lib/')) base = base.replace('admin/functions/lib/', 'admin/functions/src/');
  const candidatos = [base, base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx'), base.replace(/\.mjs$/, '.d.mts')];
  for (const c of candidatos) for (const e of EXTENSIONES) if (arbol.existe(c + e)) return c + e;
  return null;
}

/** Especificador calculado (`import(x)`, `require(ruta)`): no se puede seguir. */
export const CALCULADO = '<calculado>';

/**
 * Un especificador que no es relativo pero apunta al repositorio: un alias
 * (`@/`, `~/`, `#`) o una ruta absoluta. Hoy no hay ninguno; si aparece, el
 * lector no lo sigue, así que se informa en vez de ignorarlo.
 */
const esAlias = (e: string): boolean => /^(\/|@\/|~\/|#|src\/|admin\/)/.test(e);

export interface Importacion {
  readonly especificador: string;
  /** null si el import no lleva a ningún archivo (o es calculado, o es un alias). */
  readonly destino: string | null;
  readonly soloTipo: boolean;
  readonly reexporta: boolean;
}

const TIPO_DE_SCRIPT: Record<string, ts.ScriptKind> = {
  '.ts': ts.ScriptKind.TS, '.mts': ts.ScriptKind.TS, '.cts': ts.ScriptKind.TS, '.tsx': ts.ScriptKind.TSX,
  '.js': ts.ScriptKind.JS, '.mjs': ts.ScriptKind.JS, '.cjs': ts.ScriptKind.JS, '.jsx': ts.ScriptKind.JSX,
};

/**
 * Los imports de un archivo que apuntan al repositorio: estáticos,
 * reexportaciones, `import x = require()`, dinámicos, `require` y los tipos
 * `import('…').T`. Los paquetes de npm no cuentan.
 */
export function importsDe(archivo: string, arbol: Arbol = ARBOL_REAL): Importacion[] {
  const extension = archivo.slice(archivo.lastIndexOf('.'));
  const fuente = ts.createSourceFile(archivo, arbol.leer(archivo), ts.ScriptTarget.Latest, true,
    TIPO_DE_SCRIPT[extension] ?? ts.ScriptKind.TS);
  const encontrados: Importacion[] = [];
  const anotar = (especificador: string, soloTipo: boolean, reexporta: boolean) => {
    if (especificador === CALCULADO || esAlias(especificador)) {
      encontrados.push({ especificador, destino: null, soloTipo, reexporta });
    } else if (especificador.startsWith('.')) {
      encontrados.push({ especificador, destino: resolverRelativo(archivo, especificador, arbol), soloTipo, reexporta });
    }
  };
  const literal = (n: ts.Node | undefined): string | null =>
    n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null;
  // LOS REQUIRE, POR SÍMBOLO (revisión de seguridad del #236). Solo si el
  // texto los nombra: armar un programa por archivo cuesta.
  //   - `require` es el global: una referencia cuyo símbolo NO se declara en
  //     este archivo (un parámetro `require` es otra cosa).
  //   - Un alias es `const r = createRequire(…)`: cuenta toda referencia cuyo
  //     símbolo es el de esa declaración (un parámetro `r` no; un `r` de
  //     relleno tampoco apaga la detección).
  // Una referencia se SIGUE si es una llamada directa (`r('…')`, también entre
  // paréntesis u opcional) o `r.resolve('…')`; cualquier otra posición de
  // expresión (`const q = r`, `r.call`, `c ? r : x`, `(0, r)`) se informa como
  // CALCULADO. No cuentan los lugares que NOMBRAN algo (declaraciones,
  // propiedades, atributos JSX, tipos) ni `typeof`.
  const texto = fuente.text;
  const hayRequires = /\brequire\b|\bcreateRequire\b/.test(texto);
  let checker: ts.TypeChecker | null = null;
  const aliases = new Set<ts.Symbol>();
  if (hayRequires) {
    const opciones: ts.CompilerOptions = { noResolve: true, noLib: true, allowJs: true, jsx: ts.JsxEmit.Preserve, types: [] };
    const anfitrion = ts.createCompilerHost(opciones);
    anfitrion.getSourceFile = (nombre) => (nombre === archivo ? fuente : undefined);
    anfitrion.fileExists = (nombre) => nombre === archivo;
    anfitrion.readFile = (nombre) => (nombre === archivo ? texto : undefined);
    checker = ts.createProgram([archivo], opciones, anfitrion).getTypeChecker();
    const buscarAliases = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isCallExpression(n.initializer)
        && ts.isIdentifier(n.initializer.expression) && n.initializer.expression.text === 'createRequire') {
        const sim = checker!.getSymbolAtLocation(n.name);
        if (sim) aliases.add(sim);
      }
      ts.forEachChild(n, buscarAliases);
    };
    buscarAliases(fuente);
  }
  // Una declaración `declare` no emite nada: en ejecución, el require es el global.
  const declaradoAca = (sim: ts.Symbol | undefined): boolean =>
    Boolean(sim?.declarations?.some((d) => d.getSourceFile() === fuente
      && !(ts.getCombinedModifierFlags(d as ts.Declaration) & ts.ModifierFlags.Ambient)));
  /** ¿Este identificador ES un require (el global o un alias de createRequire)? */
  const esIdRequire = (id: ts.Identifier): boolean => {
    if (!checker) return false;
    const sim = checker.getSymbolAtLocation(id);
    if (sim !== undefined && aliases.has(sim)) return true; // también un alias llamado `require`
    return id.text === 'require' && !declaradoAca(sim);
  };
  /** ¿El identificador está en un lugar que nombra algo, y no es una referencia? */
  const nombra = (id: ts.Identifier): boolean => {
    const p = id.parent;
    if ((ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)
      || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p) || ts.isMethodSignature(p) || ts.isPropertyAssignment(p)
      || ts.isBindingElement(p) || ts.isEnumMember(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p)
      || ts.isClassDeclaration(p) || ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p)) && p.name === id) return true;
    if (ts.isPropertyAccessExpression(p) && p.name === id) return true;
    if (ts.isJsxAttribute(p) || ts.isQualifiedName(p) || ts.isTypeReferenceNode(p)) return true;
    if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p)) return true;
    for (let a: ts.Node | undefined = p; a; a = a.parent) if (ts.isTypeQueryNode(a)) return true;
    return false;
  };
  /** Una referencia a un require que el lector sigue: la llamada directa y `.resolve(…)`. */
  const seSigue = (id: ts.Identifier): boolean => {
    let arriba: ts.Node = id;
    while (ts.isParenthesizedExpression(arriba.parent)) arriba = arriba.parent;
    const p = arriba.parent;
    if (ts.isCallExpression(p) && p.expression === arriba) return true;
    if (ts.isPropertyAccessExpression(p) && p.expression === arriba && p.name.text === 'resolve'
      && ts.isCallExpression(p.parent) && p.parent.expression === p) return true;
    if (ts.isTypeOfExpression(p)) return true;
    return false;
  };
  /**
   * El único uso de `createRequire` que se sigue: importado por su nombre de
   * `module`/`node:module`, y llamado para inicializar un `const r`.
   */
  const createRequireReconocido = (id: ts.Identifier): boolean => {
    const p = id.parent;
    if (ts.isImportSpecifier(p) && p.name === id && !p.propertyName) {
      const decl = p.parent.parent.parent;
      return ts.isImportDeclaration(decl) && /^(node:)?module$/.test(literal(decl.moduleSpecifier) ?? '');
    }
    return ts.isCallExpression(p) && p.expression === id
      && ts.isVariableDeclaration(p.parent) && p.parent.initializer === p && ts.isIdentifier(p.parent.name);
  };
  /** `require(…)`, `r(…)` de un createRequire (con paréntesis), `require.resolve(…)` y `module.require(…)`. */
  const esRequire = (e: ts.Expression): boolean => {
    let x: ts.Expression = e;
    while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isNonNullExpression(x)
      || ts.isTypeAssertionExpression(x) || ts.isSatisfiesExpression(x)) x = x.expression;
    if (ts.isIdentifier(x)) return esIdRequire(x);
    return ts.isPropertyAccessExpression(x) && ts.isIdentifier(x.expression)
      && ((x.name.text === 'resolve' && esIdRequire(x.expression))
        || (x.expression.text === 'module' && x.name.text === 'require'));
  };
  const visitar = (n: ts.Node): void => {
    // MODO CONSERVADOR con los require que no se pueden seguir (revisión de
    // seguridad del #236): `import * as m from 'node:module'`, `createRequire`
    // importado con alias, `createRequire` que no se guarda en un `const`
    // (`r = createRequire(…)`, `createRequire(…)('…')`) y `require` usado como
    // valor (`const q = require`) se informan como CALCULADO. Así caen en
    // sinResolver, que el CI no deja crecer.
    if (ts.isImportDeclaration(n) && /^(node:)?module$/.test(literal(n.moduleSpecifier) ?? '')) {
      const nombres = n.importClause?.namedBindings;
      if (nombres && ts.isNamespaceImport(nombres)) anotar(CALCULADO, false, false);
      if (nombres && ts.isNamedImports(nombres)
        && nombres.elements.some((e) => e.propertyName?.text === 'createRequire')) anotar(CALCULADO, false, false);
    }
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'createRequire'
      && !(ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name))) {
      anotar(CALCULADO, false, false);
    }
    if (ts.isIdentifier(n) && !nombra(n) && esIdRequire(n) && !seSigue(n)) anotar(CALCULADO, false, false);
    // Por NOMBRE, fuera del patrón reconocido (revisión del #236, cuarta vuelta):
    // `m.createRequire`, `Module.createRequire`, `process.getBuiltinModule`,
    // `{ createRequire: cr } = await import('node:module')`, `globalThis.require`,
    // `module['require']`… Todo eso es CALCULADO.
    if (ts.isIdentifier(n) && (n.text === 'createRequire' || n.text === 'getBuiltinModule') && !createRequireReconocido(n)) {
      anotar(CALCULADO, false, false);
    }
    if (ts.isPropertyAccessExpression(n) && n.name.text === 'require'
      && !(ts.isIdentifier(n.expression) && n.expression.text === 'module' && ts.isCallExpression(n.parent) && n.parent.expression === n)) {
      anotar(CALCULADO, false, false);
    }
    if (ts.isElementAccessExpression(n) && literal(n.argumentExpression) === 'require') anotar(CALCULADO, false, false);
    if (ts.isImportDeclaration(n)) {
      anotar(literal(n.moduleSpecifier) ?? CALCULADO, Boolean(n.importClause?.isTypeOnly), false);
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier) {
      anotar(literal(n.moduleSpecifier) ?? CALCULADO, n.isTypeOnly, true);
    } else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)) {
      anotar(literal(n.moduleReference.expression) ?? CALCULADO, n.isTypeOnly, false);
    } else if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument)) {
      const e = literal(n.argument.literal);
      if (e) anotar(e, true, false);
    } else if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || esRequire(n.expression))) {
      anotar(literal(n.arguments[0]) ?? CALCULADO, false, false);
    }
    ts.forEachChild(n, visitar);
  };
  visitar(fuente);
  return encontrados;
}

// ----------------------------------------------------------------- la frontera
export interface Cruce {
  readonly desde: string;
  readonly hacia: string;
  readonly motivo: string;
  readonly soloTipo: boolean;
  /** Archivos sin zona (o ayudantes de prueba) por los que pasa el cruce, si no es directo. */
  readonly via: readonly string[];
}

/**
 * Por qué `origen` no puede importar a `destino`, o null si puede. Es LA
 * regla: la prueba negativa la ejerce con zonas inventadas.
 */
export function motivoDeCruce(origen: DestinoF2, destino: DestinoF2): string | null {
  if (origen.zona === 'modulo' && destino.zona === 'modulo') {
    if (origen.modulo === destino.modulo) return null;
    if (dependenciasDe(origen.modulo ?? '').has(destino.modulo ?? '')) return null;
    return `módulo sin dependeDe (${origen.modulo} → ${destino.modulo})`;
  }
  return RANGO[destino.zona] > RANGO[origen.zona] ? `${etiqueta(origen)} → ${etiqueta(destino)}` : null;
}

export const MOTIVO_INDICE = 'index.ts es el inventario de despliegue: el código no lo importa';
export const MOTIVO_PRUEBA = 'el código no importa de admin/pruebas/';

export interface Analisis {
  readonly cruces: Cruce[];
  /** Imports que no llevan a ningún archivo, calculados o por alias: el lector no ve a dónde van. */
  readonly sinResolver: { desde: string; especificador: string }[];
}

/**
 * Recorre los imports de `archivos` (los que tienen zona; una prueba solo si
 * está en una carpeta de zona) y devuelve los cruces hacia arriba. Un import
 * a un archivo sin zona, o de una prueba a un ayudante de prueba, se sigue
 * hasta el primer archivo con zona: el cruce se atribuye al origen. `zonaDe`
 * se inyecta para que la prueba negativa pueda inventar zonas.
 */
export function analizar(
  archivos: readonly string[],
  zonaDe: (a: string) => DestinoF2 | null = zonaDeCodigo,
  arbol: Arbol = ARBOL_REAL,
): Analisis {
  const cruces: Cruce[] = [];
  const sinResolver: { desde: string; especificador: string }[] = [];
  const cache = new Map<string, Importacion[]>();
  const imports = (a: string): Importacion[] => {
    if (!cache.has(a)) cache.set(a, esCodigo(a) ? juntarPorDestino(importsDe(a, arbol)) : []);
    return cache.get(a)!;
  };
  // Cada archivo informa lo que no se puede seguir UNA vez, aunque se llegue
  // a él desde muchos orígenes.
  const informados = new Set<string>();
  for (const archivo of archivos) {
    if (!esCodigo(archivo)) continue;
    const prueba = esPrueba(archivo);
    if (prueba && PRUEBAS_TRANSVERSALES.includes(archivo)) continue;
    const origen = prueba ? zonaPorCarpeta(archivo) : zonaDe(archivo);
    if (!origen) continue;
    const vistos = new Set<string>([archivo]);
    const pendientes: { archivo: string; via: string[] }[] = [{ archivo, via: [] }];
    while (pendientes.length) {
      const actual = pendientes.shift()!;
      const informar = !informados.has(actual.archivo);
      informados.add(actual.archivo);
      for (const i of imports(actual.archivo)) {
        if (!i.destino) {
          // También desde un puente: un archivo sin zona nunca se analiza como
          // origen, así que un import calculado suyo no se informaría nunca.
          if (informar) sinResolver.push({ desde: actual.archivo, especificador: i.especificador });
          continue;
        }
        const d = i.destino;
        // Antes de marcarlo visto: si index.ts reexporta un archivo y además
        // lo importa, la reexportación no debe tapar el import.
        if (actual.archivo === INDICE_DE_FUNCTIONS && i.reexporta) continue;
        if (vistos.has(d)) continue;
        vistos.add(d);
        const cruce = (hacia: string, motivo: string) =>
          cruces.push({ desde: archivo, hacia, motivo, soloTipo: i.soloTipo, via: actual.via });
        if (d === INDICE_DE_FUNCTIONS) {
          // Una prueba llama a una callable por el índice; el código, no.
          if (!prueba) cruce(d, MOTIVO_INDICE);
          continue;
        }
        if (esPrueba(d)) {
          if (!prueba) { cruce(d, MOTIVO_PRUEBA); continue; }
          // Un ayudante de prueba no tiene zona propia: se sigue.
          pendientes.push({ archivo: d, via: [...actual.via, d] });
          continue;
        }
        const destino = zonaDe(d);
        if (!destino) {
          // Sin zona: se sigue, para que no sirva de puente.
          pendientes.push({ archivo: d, via: [...actual.via, d] });
          continue;
        }
        const motivo = motivoDeCruce(origen, destino);
        if (motivo) cruce(d, actual.via.length ? `${motivo}, vía ${actual.via.join(' → ')}` : motivo);
      }
    }
  }
  return { cruces, sinResolver };
}

/**
 * Un import por destino (y por si reexporta), con `soloTipo` solo si TODOS los
 * imports a ese destino son de tipo: si uno es de valor, gana el valor. Sin
 * esto, un `import type` seguido de un import de valor se informaba «de tipo».
 */
function juntarPorDestino(lista: Importacion[]): Importacion[] {
  const juntos = new Map<string, Importacion>();
  const sueltos: Importacion[] = [];
  for (const i of lista) {
    if (!i.destino) { sueltos.push(i); continue; }
    const clave = `${i.destino}\u0000${i.reexporta}`;
    const previo = juntos.get(clave);
    juntos.set(clave, previo ? { ...previo, soloTipo: previo.soloTipo && i.soloTipo } : i);
  }
  return [...juntos.values(), ...sueltos];
}

export const claveDeCruce = (c: { desde: string; hacia: string }): string => `${c.desde} → ${c.hacia}`;
