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
 * `soloRutas(viejo, nuevo)` compara dos versiones de un archivo con los
 * literales (y las listas de literales, como los argumentos de `join`)
 * reemplazados por un marcador: si no quedan iguales, el cambio no es solo de
 * rutas.
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
}

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

  for (const archivo of archivos) {
    const texto = arbol.leer(archivo);
    const seMueve = mapa.has(archivo);
    const carpetaVieja = posix.dirname(archivo);
    const carpetaNueva = posix.dirname(nueva(archivo));
    const cambios: string[] = [];
    let nuevoTexto = texto;

    if (archivo.endsWith('.json')) {
      if (!archivo.endsWith('/deuda.json')) continue;
      const cambiar = (v: unknown): unknown => (typeof v === 'string' && mapa.has(v) ? (cambios.push(`${v} → ${mapa.get(v)}`), mapa.get(v))
        : Array.isArray(v) ? v.map(cambiar)
          : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [mapa.get(k) ?? k, cambiar(x)])) : v);
      const antes = JSON.parse(texto) as unknown;
      const despues = cambiar(antes);
      if (Object.keys(antes as object).some((k, i) => k !== Object.keys(despues as object)[i])) cambios.push('claves');
      nuevoTexto = `${JSON.stringify(despues, null, 2)}\n`;
    } else if (archivo.endsWith('.sh')) {
      for (const m of movimientos) {
        if (nuevoTexto.includes(m.de)) { nuevoTexto = nuevoTexto.split(m.de).join(m.a); cambios.push(`${m.de} → ${m.a}`); }
      }
    } else if (EXT_CODIGO.test(archivo)) {
      const fuente = ts.createSourceFile(archivo, texto, ts.ScriptTarget.Latest, true,
        archivo.endsWith('.tsx') ? ts.ScriptKind.TSX : archivo.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS);
      const reemplazos: { desde: number; hasta: number; por: string; nota: string }[] = [];
      const consumidos = new Set<ts.Node>();
      const lit = (n: ts.Node | undefined): string | null =>
        n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null;
      const comilla = (n: ts.Node) => texto[n.getStart(fuente)]!;

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
            reemplazos.push({ desde: n.getStart(fuente) + 1, hasta: n.getEnd() - 1, por, nota: `${t} → ${por}` });
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
  return { ediciones, renombres: [...movimientos] };
}

/**
 * El texto de un archivo de código con los literales —y las listas de
 * literales separados por comas— reemplazados por «§». Dos versiones que
 * difieren solo en rutas dan lo mismo.
 */
export function esqueleto(nombre: string, texto: string): string {
  const escaner = ts.createScanner(ts.ScriptTarget.Latest, false,
    nombre.endsWith('.tsx') || nombre.endsWith('.jsx') ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard, texto);
  const fichas: string[] = [];
  for (let k = escaner.scan(); k !== ts.SyntaxKind.EndOfFileToken; k = escaner.scan()) {
    if (k === ts.SyntaxKind.WhitespaceTrivia || k === ts.SyntaxKind.NewLineTrivia
      || k === ts.SyntaxKind.SingleLineCommentTrivia || k === ts.SyntaxKind.MultiLineCommentTrivia) continue;
    const esLiteral = k === ts.SyntaxKind.StringLiteral || k === ts.SyntaxKind.NoSubstitutionTemplateLiteral;
    const ficha = esLiteral ? '§' : escaner.getTokenText();
    // § , § , § → §
    if (ficha === '§' && fichas.at(-1) === ',' && fichas.at(-2) === '§') { fichas.pop(); continue; }
    fichas.push(ficha);
  }
  return fichas.join(' ');
}

/** ¿`nuevo` difiere de `viejo` solo en rutas escritas como texto? */
export const soloRutas = (nombre: string, viejo: string, nuevo: string): boolean =>
  esqueleto(nombre, viejo) === esqueleto(nombre, nuevo);
