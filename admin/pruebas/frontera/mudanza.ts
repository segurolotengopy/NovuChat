/**
 * =============================================================================
 * LA MUDANZA DE F2, como funciones puras
 * =============================================================================
 *
 * `docs/arquitectura/f2-orden-de-movimiento.md`: los archivos de F2 los mueve
 * la coordinadora con un script revisado, no los agentes a mano. Este módulo
 * es la lógica; `mudanza.mjs` (en esta carpeta) es el comando.
 *
 * `planDeMudanza(movimientos, archivos, arbol)` recibe la tanda (ruta vieja →
 * ruta nueva) y devuelve qué archivos cambian y cómo, SIN escribir nada:
 *   - todo literal relativo que resuelve a un archivo movido (un import, un
 *     `vi.mock`, un `import()`), o que está EN un archivo movido, se recalcula
 *     con el mismo estilo (`.js`, `.ts` o sin extensión);
 *   - un `../functions/lib/x.js` (el compilado) sigue a su fuente;
 *   - `join(aqui | __dirname | BASE, 'a', 'b.ts')`, con BASE una constante
 *     armada con `join(aqui, …)`, se recalcula segmento por segmento, y si el
 *     archivo que lo escribe se mueve, también cuando apunta a una CARPETA;
 *   - un literal que ES la ruta vieja, desde la raíz (`admin/functions/src/x.ts`)
 *     o desde `admin/` (`pruebas/x.test.ts` en `SUITES_PURAS`), pasa a la nueva;
 *   - `deuda.json`: sus rutas; los `.sh`: la ruta desde la raíz.
 * Lo que queda en documentación se informa, no se toca.
 *
 * SOLO EN CONTEXTOS CONOCIDOS (revisión de seguridad del #241): un literal se
 * reescribe si es el especificador de un `import`/`export`/`import()`/
 * `require`/`vi.mock`/`new URL`, un argumento de `join`/`resolve` o de una
 * lectura (`leer`, `readFileSync`, `existsSync`…), o un elemento de
 * `SUITES_PURAS`. Un literal que coincide con una ruta movida en otro lugar
 * (un fixture, un mensaje, una tabla) NO se toca: se informa en `avisos`.
 *
 * `validarTanda` rechaza una tanda que saldría del repositorio, de las raíces
 * de código o de su extensión, antes de escribir nada.
 *
 * La prueba de que un PR de movimiento es solo la mudanza es la
 * REPRODUCIBILIDAD (`solo-rutas.mjs`): se vuelve a correr el plan sobre la base
 * y cada archivo del PR tiene que ser byte a byte el del plan.
 *
 * Node lo carga quitando tipos: nada de `enum`, importaciones con extensión.
 */
import { posix } from 'node:path';
import ts from 'typescript';
import { resolverRelativo, type Arbol } from './frontera.ts';

export interface Movimiento { readonly de: string; readonly a: string }
export interface Edicion { readonly archivo: string; readonly nuevoTexto: string; readonly cambios: readonly string[] }
export interface Plan {
  /** Archivo (ruta NUEVA si se mueve) → su texto nuevo, con la lista de cambios. */
  readonly ediciones: Edicion[];
  readonly renombres: Movimiento[];
  /** Literales que coinciden con una ruta movida fuera de un contexto conocido: se revisan a mano. */
  readonly avisos: string[];
}

/** Una ruta con segmentos de [A-Za-z0-9._-] que no empiezan con punto ni guion. */
export const RUTA_SEGURA = /^[A-Za-z0-9_][A-Za-z0-9._-]*(\/[A-Za-z0-9_][A-Za-z0-9._-]*)*$/;

/** Dónde vive una tanda versionada: la única ruta que `solo-rutas` acepta como tanda. */
export const RUTA_DE_TANDA = /^docs\/arquitectura\/tandas\/t\d+[a-z]?\.json$/;

/**
 * Los archivos de la herramienta: un PR de tanda no los toca, porque el
 * verificador que corre es el del PR (revisión del #241, tercera vuelta).
 */
export const HERRAMIENTA = ['admin/pruebas/frontera/mudanza.ts', 'admin/pruebas/frontera/solo-rutas.mjs',
  'admin/pruebas/frontera/mudanza.mjs', 'admin/pruebas/frontera/frontera.ts', 'admin/pruebas/frontera/desde-la-base.sh',
  // Lo que frontera.ts importa: su código de nivel superior corre al importar.
  'admin/pruebas/frontera/destinos-f2.ts', 'admin/functions/src/registro.ts'] as const;

/** Las raíces donde F2 mueve archivos. */
export const RAICES_DE_MUDANZA = ['admin/functions/src/', 'admin/web/src/', 'Flujos/src/', 'admin/scripts/', 'admin/pruebas/'] as const;

export interface Consulta {
  /** ¿Existe (archivo o carpeta, sin seguir enlaces)? */
  existe(ruta: string): boolean;
  /** ¿Es un archivo común versionado por git? */
  esArchivoVersionado(ruta: string): boolean;
  /** ¿Algún ancestro existente de la ruta es un enlace simbólico? */
  pasaPorEnlace(ruta: string): boolean;
}

/**
 * Los errores de una tanda, antes de tocar nada: rutas relativas, normales, sin
 * `..`, dentro de las raíces de mudanza, misma extensión, sin repetidos, `de`
 * versionado y `a` libre, sin enlaces en el camino.
 */
export function validarTanda(tanda: unknown, consulta: Consulta): string[] {
  const errores: string[] = [];
  if (!Array.isArray(tanda) || tanda.length === 0) return ['La tanda tiene que ser un arreglo no vacío de { de, a }'];
  const des = new Set<string>();
  const aes = new Set<string>();
  for (const [i, m] of tanda.entries()) {
    const de = (m as Movimiento)?.de;
    const a = (m as Movimiento)?.a;
    if (typeof de !== 'string' || typeof a !== 'string') { errores.push(`#${i}: de y a tienen que ser texto`); continue; }
    for (const r of [de, a]) {
      // Solo caracteres seguros: la ruta nueva se escribe dentro de literales de
      // JS y de .sh sin escapar; una comilla, un $ o un ( inyectarían código
      // (revisión de seguridad del #241, tercera vuelta).
      if (!RUTA_SEGURA.test(r)) errores.push(`#${i}: ${r} tiene caracteres fuera de [A-Za-z0-9._-/]`);
      else if (r.startsWith('/') || posix.normalize(r) !== r || r.split('/').includes('..')) errores.push(`#${i}: ${r} no es una ruta relativa normal`);
      else if (!RAICES_DE_MUDANZA.some((raiz) => r.startsWith(raiz))) errores.push(`#${i}: ${r} está fuera de las raíces de mudanza`);
    }
    if (posix.extname(de) !== posix.extname(a)) errores.push(`#${i}: ${de} → ${a} cambia la extensión`);
    if (des.has(de) || aes.has(a)) errores.push(`#${i}: ruta repetida en la tanda`);
    des.add(de); aes.add(a);
    if (!consulta.esArchivoVersionado(de)) errores.push(`#${i}: ${de} no es un archivo versionado`);
    if (consulta.existe(a)) errores.push(`#${i}: ${a} ya existe`);
    if (consulta.pasaPorEnlace(a)) errores.push(`#${i}: el camino de ${a} pasa por un enlace simbólico`);
  }
  for (const a of aes) if (des.has(a)) errores.push(`${a} es a la vez origen y destino`);
  return errores;
}

/**
 * Los archivos que la mudanza lee: las raíces, `scripts/` de la raíz, las
 * configuraciones de vitest y vite, y los manifiestos del ensamblador
 * (`Flujos/manifiestos/*.json`, que nombran sus módulos relativos a
 * `Flujos/src/`; los necesita FL1).
 */
export function archivosAMirar(todos: readonly string[]): string[] {
  return todos.filter((a) => RAICES_DE_MUDANZA.some((r) => a.startsWith(r)) || a.startsWith('scripts/')
    || a === 'admin/vitest.config.ts' || a === 'admin/web/vite.config.ts' || MANIFIESTO.test(a))
    .filter((a) => !a.includes('/node_modules/')).sort();
}

/** Un manifiesto del ensamblador de flujos (`admin/scripts/ensamblar-flujo.mjs`). */
const MANIFIESTO = /^Flujos\/manifiestos\/[^/]+\.json$/;
const SRC_FLUJOS = 'Flujos/src/';

/** Un árbol con carpetas: para saber si `join(aqui, '..', 'Flujos')` apunta a una. */
export interface ArbolConCarpetas extends Arbol { esCarpeta(ruta: string): boolean }

const EXT_CODIGO = /\.(ts|tsx|mts|cts|mjs|cjs|js|jsx)$/;
const BASES_AQUI = new Set(['aqui', 'AQUI', '__dirname', 'aquí']);

/** El especificador relativo de `desdeCarpeta` a `destino`, con el estilo del original. */
function especificador(desdeCarpeta: string, destino: string, original: string): string {
  let r = posix.relative(desdeCarpeta, destino);
  if (!r.startsWith('.')) r = `./${r}`;
  if (/\.js$/.test(original) && /\.tsx?$/.test(destino)) return r.replace(/\.tsx?$/, '.js');
  if (/\.(ts|tsx|mts|mjs|cjs|js|jsx|json|css)$/.test(original)) return r;
  // Sin extensión en el original: sin extensión (y sin /index si no lo tenía).
  r = r.replace(EXT_CODIGO, '');
  if (!/\/index$/.test(original) && /\/index$/.test(r)) r = r.slice(0, -'/index'.length);
  return r;
}

const aLib = (fuente: string) => fuente.replace(/^admin\/functions\/src\//, 'admin/functions/lib/').replace(/\.tsx?$/, '.js');

export function planDeMudanza(movimientos: readonly Movimiento[], archivos: readonly string[], arbol: ArbolConCarpetas): Plan {
  const mapa = new Map(movimientos.map((m) => [m.de, m.a]));
  const nueva = (r: string) => mapa.get(r) ?? r;
  const ediciones: Edicion[] = [];
  const avisos: string[] = [];
  const rutaSh = (r: string) => new RegExp(`(?<![\\w./-])${r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.-])`, 'g');

  for (const archivo of archivos) {
    const texto = arbol.leer(archivo);
    const seMueve = mapa.has(archivo);
    const carpetaVieja = posix.dirname(archivo);
    const carpetaNueva = posix.dirname(nueva(archivo));
    const cambios: string[] = [];
    let nuevoTexto = texto;

    if (MANIFIESTO.test(archivo)) {
      // `codigo`: nodo → "carpeta/archivo.js" (o { archivo, … }) bajo
      // Flujos/src/. Solo se reescribe el valor que nombra un archivo movido;
      // el resto del manifiesto (prompts, marcadores) no se toca. Se exige que
      // el archivo ya esté escrito como lo escribe JSON.stringify con dos
      // espacios: si no, reescribirlo cambiaría más que la ruta.
      const antes = JSON.parse(texto) as { codigo?: Record<string, unknown> };
      if (`${JSON.stringify(antes, null, 2)}\n` !== texto) throw new Error(`${archivo}: el manifiesto no tiene el formato de JSON.stringify(…, null, 2)`);
      const moverRel = (rel: unknown): unknown => {
        if (typeof rel !== 'string') return rel;
        const destino = mapa.get(`${SRC_FLUJOS}${rel}`);
        if (!destino) return rel;
        if (!destino.startsWith(SRC_FLUJOS)) throw new Error(`${archivo}: ${rel} sale de Flujos/src/`);
        cambios.push(`${rel} → ${destino.slice(SRC_FLUJOS.length)}`);
        return destino.slice(SRC_FLUJOS.length);
      };
      const codigo = antes.codigo && typeof antes.codigo === 'object' ? Object.fromEntries(Object.entries(antes.codigo).map(([nodo, v]) =>
        [nodo, v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as object), archivo: moverRel((v as { archivo?: unknown }).archivo) } : moverRel(v)]))
        : antes.codigo;
      nuevoTexto = `${JSON.stringify({ ...antes, ...(antes.codigo ? { codigo } : {}) }, null, 2)}\n`;
    } else if (archivo.endsWith('.json')) {
      if (!archivo.endsWith('/deuda.json')) continue;
      const cambiar = (v: unknown): unknown => (typeof v === 'string' && mapa.has(v) ? (cambios.push(`${v} → ${mapa.get(v)}`), mapa.get(v))
        : Array.isArray(v) ? v.map(cambiar)
          : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [mapa.get(k) ?? k, cambiar(x)])) : v);
      const antes = JSON.parse(texto) as unknown;
      const despues = cambiar(antes);
      if (Object.keys(antes as object).some((k, i) => k !== Object.keys(despues as object)[i])) cambios.push('claves');
      nuevoTexto = `${JSON.stringify(despues, null, 2)}\n`;
    } else if (archivo.endsWith('.sh')) {
      // Con límites: `…/atencion.ts` no toca `…/atencion.tsx` (revisión del #241).
      for (const m of movimientos) {
        const re = rutaSh(m.de);
        if (re.test(nuevoTexto)) { nuevoTexto = nuevoTexto.replace(rutaSh(m.de), m.a); cambios.push(`${m.de} → ${m.a}`); }
      }
    } else if (EXT_CODIGO.test(archivo)) {
      const fuente = ts.createSourceFile(archivo, texto, ts.ScriptTarget.Latest, true,
        archivo.endsWith('.tsx') ? ts.ScriptKind.TSX : archivo.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS);
      const reemplazos: { desde: number; hasta: number; por: string; nota: string }[] = [];
      const consumidos = new Set<ts.Node>();
      const lit = (n: ts.Node | undefined): string | null =>
        n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null;
      const comilla = (n: ts.Node) => texto[n.getStart(fuente)]!;
      const nombreDe = (e: ts.Expression): string => (ts.isIdentifier(e) ? e.text
        : ts.isPropertyAccessExpression(e) ? e.name.text : e.kind === ts.SyntaxKind.ImportKeyword ? 'import' : '');
      // Un especificador RELATIVO se resuelve contra el archivo solo donde Node o
      // vitest lo resuelven así: módulos. En una lectura (`readFileSync('../x')`)
      // es relativo a la carpeta de trabajo, y en `join(RAIZ, …)` a una base
      // desconocida: ahí solo se reescribe la ruta COMPLETA (revisión del #241).
      const MODULOS = new Set(['import', 'require', 'mock', 'doMock', 'importActual']);
      const LECTURAS = new Set(['leer', 'readFileSync', 'existsSync', 'statSync', 'lstatSync', 'readdirSync', 'join', 'resolve']);
      /** ¿El literal está donde se escribe una ruta (relativa o completa, según `relativo`)? */
      const enContexto = (n: ts.Node, relativo: boolean): boolean => {
        const p = n.parent;
        if ((ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) && p.moduleSpecifier === n) return true;
        if (ts.isExternalModuleReference(p) || (ts.isLiteralTypeNode(p) && ts.isImportTypeNode(p.parent))) return true;
        if (ts.isCallExpression(p) && p.arguments.includes(n as ts.Expression)) {
          const e = p.expression;
          const esRequireResolve = ts.isPropertyAccessExpression(e) && e.name.text === 'resolve'
            && ts.isIdentifier(e.expression) && e.expression.text === 'require';
          if (MODULOS.has(nombreDe(e)) || esRequireResolve) return true;
          if (!relativo && LECTURAS.has(nombreDe(e))) return true;
        }
        if (ts.isNewExpression(p) && ts.isIdentifier(p.expression) && p.expression.text === 'URL' && p.arguments?.[0] === n) return true;
        if (!relativo && ts.isArrayLiteralExpression(p) && ts.isVariableDeclaration(p.parent) && ts.isIdentifier(p.parent.name)
          && p.parent.name.text === 'SUITES_PURAS') return true;
        return false;
      };

      // BASES: const X = join(aqui, 'lit', …) → carpeta (vieja) a la que apunta.
      const bases = new Map<string, string>();
      const buscarBases = (n: ts.Node): void => {
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isCallExpression(n.initializer)) {
          const c = n.initializer;
          const nombre = ts.isIdentifier(c.expression) ? c.expression.text
            : ts.isPropertyAccessExpression(c.expression) ? c.expression.name.text : '';
          const [primero, ...resto] = c.arguments;
          const partes = resto.map(lit);
          if ((nombre === 'join' || nombre === 'resolve') && primero && ts.isIdentifier(primero)
            && BASES_AQUI.has(primero.text) && partes.every((p) => p !== null)) {
            bases.set(n.name.text, posix.normalize(posix.join(carpetaVieja, ...(partes as string[]))));
          }
        }
        ts.forEachChild(n, buscarBases);
      };
      buscarBases(fuente);

      const visitar = (n: ts.Node): void => {
        // join(BASE, 'a', 'b.ts') con literales
        if (ts.isCallExpression(n)) {
          const nombre = ts.isIdentifier(n.expression) ? n.expression.text
            : ts.isPropertyAccessExpression(n.expression) ? n.expression.name.text : '';
          const [primero, ...resto] = n.arguments;
          const partes = resto.map(lit);
          if ((nombre === 'join' || nombre === 'resolve') && primero && ts.isIdentifier(primero) && resto.length
            && partes.every((p) => p !== null)) {
            const esAqui = BASES_AQUI.has(primero.text);
            const baseVieja = esAqui ? carpetaVieja : bases.get(primero.text);
            if (baseVieja !== undefined) {
              resto.forEach((r) => consumidos.add(r));
              const destino = posix.normalize(posix.join(baseVieja, ...(partes as string[])));
              const destinoFuente = destino.startsWith('admin/functions/lib/')
                ? destino.replace('admin/functions/lib/', 'admin/functions/src/').replace(/\.js$/, '.ts') : destino;
              const baseNueva = esAqui ? carpetaNueva : baseVieja; // una BASE constante se recalcula aparte
              let nuevoDestino: string | null = null;
              if (mapa.has(destinoFuente)) {
                nuevoDestino = destino === destinoFuente ? nueva(destinoFuente) : aLib(nueva(destinoFuente));
              } else if (esAqui && seMueve && (arbol.existe(destino) || arbol.esCarpeta(destino))) {
                nuevoDestino = destino; // el archivo se mueve: lo que apunta a otra cosa se recalcula
              }
              if (nuevoDestino !== null) {
                const segmentos = posix.relative(baseNueva, nuevoDestino).split('/').filter(Boolean);
                const q = comilla(resto[0]!);
                const por = segmentos.map((s) => `${q}${s}${q}`).join(', ');
                const desde = resto[0]!.getStart(fuente);
                const hasta = resto[resto.length - 1]!.getEnd();
                if (texto.slice(desde, hasta) !== por) {
                  reemplazos.push({ desde, hasta, por, nota: `join(${primero.text}, …) → ${nuevoDestino}` });
                }
              }
            }
          }
        }
        const t = lit(n);
        if (t !== null && !consumidos.has(n)) {
          let por: string | null = null;
          if (t.startsWith('./') || t.startsWith('../')) {
            const crudo = posix.normalize(posix.join(carpetaVieja, t));
            if (crudo.startsWith('admin/functions/lib/')) {
              const fuenteLib = crudo.replace('admin/functions/lib/', 'admin/functions/src/').replace(/\.js$/, '.ts');
              if (mapa.has(fuenteLib) || seMueve) por = especificador(carpetaNueva, aLib(nueva(fuenteLib)), t);
            } else {
              const destino = resolverRelativo(archivo, t, arbol);
              if (destino && (mapa.has(destino) || seMueve)) por = especificador(carpetaNueva, nueva(destino), t);
              else if (!destino && seMueve && arbol.esCarpeta(crudo)) por = especificador(carpetaNueva, crudo, `${t}/`).replace(/\/$/, '');
            }
          } else if (mapa.has(t)) {
            por = mapa.get(t)!;
          } else if (mapa.has(`admin/${t}`)) {
            por = mapa.get(`admin/${t}`)!.replace(/^admin\//, '');
          }
          if (por !== null && por !== t) {
            if (enContexto(n, t.startsWith('./') || t.startsWith('../'))) {
              reemplazos.push({ desde: n.getStart(fuente) + 1, hasta: n.getEnd() - 1, por, nota: `${t} → ${por}` });
            } else {
              const { line } = fuente.getLineAndCharacterOfPosition(n.getStart(fuente));
              avisos.push(`${archivo}:${line + 1}: '${t}' nombra un archivo movido fuera de un contexto conocido (no se reescribe)`);
            }
          }
        }
        ts.forEachChild(n, visitar);
      };
      visitar(fuente);
      for (const r of reemplazos.sort((a, b) => b.desde - a.desde)) {
        nuevoTexto = nuevoTexto.slice(0, r.desde) + r.por + nuevoTexto.slice(r.hasta);
        cambios.push(r.nota);
      }
    } else {
      continue;
    }
    if (nuevoTexto !== texto || seMueve) ediciones.push({ archivo: nueva(archivo), nuevoTexto, cambios: cambios.reverse() });
  }
  return { ediciones, renombres: [...movimientos], avisos };
}

// ------------------------------------------------------ la reproducibilidad
export interface EntradaDiff { readonly estado: string; readonly viejo: string; readonly nuevo: string }

/**
 * Una tanda versionada en el PR (`docs/arquitectura/tandas/<n>.json`): los
 * movimientos y las suites que la tanda agrega a `SUITES_PURAS`. Así el CI, el
 * revisor y el autor usan la MISMA tanda.
 */
export interface Tanda { readonly movimientos: readonly Movimiento[]; readonly suitesPuras: readonly string[] }
export function leerTanda(json: unknown): Tanda {
  if (Array.isArray(json)) return { movimientos: json as Movimiento[], suitesPuras: [] };
  if (!json || typeof json !== 'object') throw new Error('La tanda tiene que ser un objeto { movimientos, suitesPuras }');
  const sobran = Object.keys(json).filter((k) => k !== 'movimientos' && k !== 'suitesPuras');
  if (sobran.length) throw new Error(`La tanda tiene claves que no son de una tanda: ${sobran.join(', ')}`);
  const t = json as Partial<Tanda>;
  if (!Array.isArray(t.movimientos) || !Array.isArray(t.suitesPuras ?? [])) throw new Error('movimientos y suitesPuras tienen que ser arreglos');
  return { movimientos: t.movimientos, suitesPuras: t.suitesPuras ?? [] };
}

/**
 * Suites que NO pueden estar en `SUITES_PURAS` aunque una tanda lo pida: abren
 * Firebase antes del modo seco (`asignar-rol.test.ts`, revisión del PR #206).
 */
export const SUITES_VETADAS: readonly string[] = ['pruebas/asignar-rol.test.ts'];

/**
 * El texto con cada ruta vieja de la tanda —completa y sin `admin/`— cambiada
 * por la nueva, con límites (`…/x.ts` no toca `…/x.tsx` ni `…/x.ts.bak`). Es
 * lo ÚNICO que se acepta a mano en un comentario o en un `.md`: la cita de la
 * ruta. Un punto que cierra la oración (`… en functions/src/x.ts.`, seguido
 * de espacio o fin de línea) no es parte de la ruta (tanda 2: `sembrar-demos`,
 * `superadmin`).
 */
export function reemplazarRutas(texto: string, movimientos: readonly Movimiento[]): string {
  const pares = movimientos.flatMap((m) => [[m.de, m.a], [m.de.replace(/^admin\//, ''), m.a.replace(/^admin\//, '')]] as const);
  let t = texto;
  for (const [de, a] of pares) {
    t = t.replace(new RegExp(`(?<![\\w./-])${de.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-]|\\.\\S)`, 'g'), a);
  }
  return t;
}

/**
 * El archivo reimpreso desde su AST sin comentarios. Un error de sintaxis NO
 * se tolera (el parser se recupera y lo escondería).
 */
export function sinComentariosAst(nombre: string, texto: string): string {
  const tipo = nombre.endsWith('.tsx') ? ts.ScriptKind.TSX : nombre.endsWith('.jsx') ? ts.ScriptKind.JSX
    : /\.(m|c)?ts$/.test(nombre) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const fuente = ts.createSourceFile(nombre, texto, ts.ScriptTarget.Latest, false, tipo);
  // `parseDiagnostics` no está en la API pública, pero es lo que el parser llena.
  const errores = (fuente as unknown as { parseDiagnostics?: readonly unknown[] }).parseDiagnostics ?? [];
  if (errores.length) throw new Error(`${nombre}: error de sintaxis`);
  return ts.createPrinter({ removeComments: true }).printFile(fuente);
}

/** Los elementos de `SUITES_PURAS` y el archivo sin ellos (por AST, con sus comentarios). */
function separarSuites(nombre: string, texto: string): { suites: string[]; resto: string } {
  const fuente = ts.createSourceFile(nombre, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const errores = (fuente as unknown as { parseDiagnostics?: readonly unknown[] }).parseDiagnostics ?? [];
  if (errores.length) throw new Error(`${nombre}: error de sintaxis`);
  let suites: string[] = [];
  let resto = texto;
  const visitar = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === 'SUITES_PURAS'
      && n.initializer && ts.isArrayLiteralExpression(n.initializer)) {
      suites = n.initializer.elements.map((e) => (ts.isStringLiteral(e) ? e.text : `<no literal: ${e.getText(fuente)}>`));
      resto = texto.slice(0, n.initializer.getStart(fuente)) + '[]' + texto.slice(n.initializer.getEnd());
    }
    ts.forEachChild(n, visitar);
  };
  visitar(fuente);
  return { suites, resto };
}

/** ¿`real` es `esperado` con algunas entradas QUITADAS de sus listas (y nada más)? */
function soloQuitaDeuda(esperado: string, real: string): boolean {
  const e = JSON.parse(esperado) as Record<string, unknown>;
  const r = JSON.parse(real) as Record<string, unknown>;
  if (JSON.stringify(Object.keys(e)) !== JSON.stringify(Object.keys(r))) return false;
  for (const k of Object.keys(e)) {
    const ve = e[k]; const vr = r[k];
    if (Array.isArray(ve) && Array.isArray(vr)) {
      const quedan = new Set(ve.map((x) => JSON.stringify(x)));
      if (!vr.every((x) => quedan.has(JSON.stringify(x)))) return false;
    } else if (ve && vr && typeof ve === 'object' && typeof vr === 'object' && !Array.isArray(ve)) {
      for (const [kk, vv] of Object.entries(vr)) if (JSON.stringify((ve as Record<string, unknown>)[kk]) !== JSON.stringify(vv)) return false;
    } else if (JSON.stringify(ve) !== JSON.stringify(vr)) return false;
  }
  return true;
}

export interface Veredicto {
  readonly problemas: string[];
  /** `.md` que el PR cambia más allá de citar la ruta nueva: los lee el revisor. */
  readonly revisarAMano: string[];
}

/**
 * Un PR de tanda frente a su plan. Cada archivo del diff tiene que ser BYTE A
 * BYTE el que produce el plan sobre la base. A mano solo se acepta:
 *   - quitar entradas de `deuda.json` (las saldadas);
 *   - en `admin/vitest.config.ts`, agregar a `SUITES_PURAS` las suites que la
 *     tanda declara (ninguna vetada) o quitar entradas; el resto del archivo,
 *     idéntico salvo la cita de una ruta en un comentario (el mismo criterio
 *     que en el código: `reemplazarRutas` y el AST sin comentarios igual);
 *   - en código, cambiar la CITA de una ruta vieja por la nueva (en un
 *     comentario): `real === reemplazarRutas(plan)`. Ningún otro comentario;
 *     `/*#__PURE__*\/` quitaría App Check del paquete (revisión del #241);
 *   - agregar el archivo de la tanda (`archivoTanda`);
 *   - los `.md`, que se listan para revisar a mano.
 */
export function verificarReproducible(
  tanda: Tanda, plan: Plan, diff: readonly EntradaDiff[],
  leerBase: (r: string) => string, leerHead: (r: string) => string, archivoTanda?: string,
): Veredicto {
  const problemas: string[] = [];
  if (archivoTanda !== undefined && !RUTA_DE_TANDA.test(archivoTanda)) {
    problemas.push(`${archivoTanda}: una tanda vive en docs/arquitectura/tandas/tN.json`);
  }
  const revisarAMano: string[] = [];
  const movs = new Map(tanda.movimientos.map((m) => [m.de, m.a]));
  const esperado = new Map(plan.ediciones.map((e) => [e.archivo, e.nuevoTexto]));
  const vistos = new Set<string>();
  for (const d of diff) {
    const destino = d.nuevo;
    vistos.add(destino);
    if (d.estado === 'A' && destino === archivoTanda && RUTA_DE_TANDA.test(destino)) continue;
    if ((HERRAMIENTA as readonly string[]).includes(d.viejo) || (HERRAMIENTA as readonly string[]).includes(destino)) {
      problemas.push(`${destino}: un PR de tanda no toca la herramienta que lo juzga`);
      continue;
    }
    if (d.estado.startsWith('R')) {
      if (movs.get(d.viejo) !== d.nuevo) { problemas.push(`${d.viejo} → ${d.nuevo}: renombre que no está en la tanda`); continue; }
    } else if (d.estado !== 'M') {
      problemas.push(`${d.estado} ${d.viejo}: una tanda solo renombra y reescribe`);
      continue;
    }
    const real = leerHead(destino);
    const quiere = esperado.get(destino) ?? leerBase(d.viejo);
    if (destino.endsWith('.md')) {
      if (real !== reemplazarRutas(quiere, tanda.movimientos)) revisarAMano.push(destino);
      continue;
    }
    if (real === quiere) continue;
    try {
      if (destino.endsWith('/deuda.json') && soloQuitaDeuda(quiere, real)) continue;
      if (destino === 'admin/vitest.config.ts') {
        const a = separarSuites(destino, quiere);
        const b = separarSuites(destino, real);
        const agregadas = b.suites.filter((x) => !a.suites.includes(x));
        const malas = agregadas.filter((x) => !tanda.suitesPuras.includes(x) || SUITES_VETADAS.includes(x));
        const restoIgual = a.resto === b.resto || (b.resto === reemplazarRutas(a.resto, tanda.movimientos)
          && sinComentariosAst(destino, a.resto) === sinComentariosAst(destino, b.resto));
        if (restoIgual && !malas.length) continue;
        problemas.push(`${destino}: fuera de SUITES_PURAS no se toca, y solo entran las suites que la tanda declara${malas.length ? ` (sobran: ${malas.join(', ')})` : ''}`);
        continue;
      }
      if (EXT_CODIGO.test(destino) && real === reemplazarRutas(quiere, tanda.movimientos)
        && sinComentariosAst(destino, quiere) === sinComentariosAst(destino, real)) continue;
    } catch (e) {
      problemas.push(`${destino}: ${(e as Error).message}`);
      continue;
    }
    problemas.push(`${destino}: no es lo que produce la mudanza (cambia algo más que rutas)`);
  }
  for (const m of tanda.movimientos) if (!vistos.has(m.a)) problemas.push(`${m.de} → ${m.a}: la tanda lo mueve y el PR no`);
  for (const e of plan.ediciones) {
    if (e.cambios.length && !vistos.has(e.archivo)) problemas.push(`${e.archivo}: la mudanza lo reescribe y el PR no`);
  }
  for (const s of tanda.suitesPuras) {
    if (SUITES_VETADAS.includes(s)) problemas.push(`${s}: vetada en SUITES_PURAS`);
    if (!/^pruebas\/[\w/.-]+\.test\.ts$/.test(s) || posix.normalize(s) !== s || s.split('/').includes('..')) {
      problemas.push(`${s}: no es una suite (pruebas/….test.ts, sin ..)`);
    }
  }
  return { problemas, revisarAMano };
}
