/**
 * =============================================================================
 * EL LECTOR DE RUTAS ESCRITAS EN LOS SCRIPTS (F2, compuerta previa a S1 y S2)
 * =============================================================================
 *
 * Un script que arma una ruta a partir de su propia ubicación (`import.meta.url`,
 * `aqui`, `__dirname`) se rompe en silencio cuando F2 lo mueve de carpeta, y
 * recién falla al correr, a veces contra producción. Este lector evalúa
 * ESTÁTICAMENTE esas rutas, con el parser de `typescript` (como `frontera.ts`),
 * y dice a qué archivo o carpeta del repositorio llevan.
 *
 * QUÉ RESUELVE: `join`, `resolve` (con `path.`/`posix.` o por alias de import),
 * `dirname`, `fileURLToPath`, `pathToFileURL`, `new URL(rel, base)` (con la
 * semántica de URL: `'..'` desde un archivo es el padre de la carpeta que lo
 * contiene), `.pathname`, plantillas, sumas de cadenas, constantes y
 * variables encadenadas, y `a ?? b` / `a || b` (se evalúa el lado por
 * defecto: la opción de línea de comandos que lo pisa no cuenta).
 *
 * QUÉ MARCA: todo `join`, `resolve`, `new URL` o plantilla/suma ANCLADOS (su
 * valor depende de `import.meta.url`, `aqui`, `AQUI` o `__dirname`) cuyo
 * resultado no se pueda calcular sin ejecutar el script (una variable que
 * llega de un argumento, un nombre de archivo calculado, varias definiciones
 * distintas de una constante, una función propia, una escapada del
 * repositorio). Lo que se calcula se devuelve como ruta relativa a la raíz y
 * la prueba exige que exista.
 *
 * LO QUE NO VE (a propósito): una ruta cuya ancla llega importada de otro
 * módulo (`import { BASE } from './x.mjs'`), porque el valor vive en el otro
 * archivo, y una ruta armada sin ancla (relativa al directorio de trabajo).
 * Quien importa la ancla la ve con su propio `import.meta.url`.
 *
 * Node carga `frontera.ts` quitando tipos; este archivo solo lo carga vitest,
 * pero sigue la misma disciplina: sin `enum`, imports relativos con extensión.
 */
import { posix } from 'node:path';
import ts from 'typescript';

/** El repositorio dentro del lector: toda ruta evaluada vive bajo esta raíz virtual. */
const R = '/R';

/** Lo que el lector necesita del disco. Una carpeta cuenta como existente. */
export interface Disco {
  existe(rutaRelativa: string): boolean;
}

export interface Sitio {
  /** Línea (desde 1) del `join`, `resolve`, `new URL` o plantilla. */
  linea: number;
  texto: string;
  /** La ruta relativa a la raíz del repositorio, o null si no se pudo calcular. */
  ruta: string | null;
  /** Por qué no se pudo calcular. */
  motivo: string | null;
  /** Si no se calculó: la carpeta que sí se calcula antes del primer tramo que no (relativa a la raíz). */
  prefijo: string | null;
}

type Val =
  | { t: 'cad'; v: string }
  | { t: 'ruta'; v: string }
  | { t: 'url'; v: string }
  | { t: 'x'; why: string; ancla: boolean; prefijo?: string };

const x = (why: string, ancla: boolean): Val => ({ t: 'x', why, ancla });
const anclado = (v: Val): boolean => v.t !== 'cad' && (v.t !== 'x' || v.ancla);
const dentro = (p: string): boolean => p === R || p.startsWith(`${R}/`);

const NS_PATH = new Set(['path', 'posix', 'win32', 'nodePath']);
const MODULOS_PATH = new Set(['node:path', 'path', 'node:path/posix', 'path/posix']);

const tipoDeScript = (archivo: string): ts.ScriptKind => (/\.(mjs|js|cjs)$/.test(archivo) ? ts.ScriptKind.JS : ts.ScriptKind.TS);

/** Los nombres con que el archivo trae las funciones de ruta (alias de import incluidos). */
function nombresDe(fuente: ts.SourceFile): { funciones: Map<string, string>; espacios: Set<string> } {
  const funciones = new Map<string, string>(
    ['join', 'resolve', 'dirname', 'fileURLToPath', 'pathToFileURL'].map((n) => [n, n]));
  const espacios = new Set(NS_PATH);
  for (const s of fuente.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier) || !s.importClause) continue;
    const modulo = s.moduleSpecifier.text;
    const esPath = MODULOS_PATH.has(modulo);
    if (!esPath && modulo !== 'node:url' && modulo !== 'url') continue;
    const { name, namedBindings } = s.importClause;
    if (esPath && name) espacios.add(name.text);
    if (namedBindings && ts.isNamespaceImport(namedBindings) && esPath) espacios.add(namedBindings.name.text);
    if (namedBindings && ts.isNamedImports(namedBindings)) {
      for (const e of namedBindings.elements) funciones.set(e.name.text, (e.propertyName ?? e.name).text);
    }
  }
  return { funciones, espacios };
}

/**
 * Evalúa las rutas ancladas de un archivo. `archivo` es la ruta relativa a la
 * raíz (`admin/scripts/x.mjs`). No toca el disco: la existencia la juzga quien
 * llama con `rutasAncladas` + `Disco`.
 */
export function sitiosDe(archivo: string, texto: string): Sitio[] {
  const fuente = ts.createSourceFile(archivo, texto, ts.ScriptTarget.Latest, true, tipoDeScript(archivo));
  const { funciones, espacios } = nombresDe(fuente);
  const yo = `${R}/${archivo}`;

  const enCurso = new Set<ts.Node>();
  const memo = new Map<ts.Node, Val>();

  /** La definición de un nombre, buscando hacia afuera desde donde se usa (el ámbito más cercano manda). */
  type Definicion = { tipo: 'valor'; nodo: ts.VariableDeclaration; ambito: ts.Node } | { tipo: 'otro' } | null;
  const nombraA = (b: ts.BindingName, n: string): boolean =>
    ts.isIdentifier(b) ? b.text === n : b.elements.some((e) => !ts.isOmittedExpression(e) && nombraA(e.name, n));
  const definicionDe = (id: ts.Identifier): Definicion => {
    const n = id.text;
    for (let c: ts.Node | undefined = id.parent; c; c = c.parent) {
      if (ts.isFunctionLike(c) && c.parameters.some((p) => nombraA(p.name, n))) return { tipo: 'otro' };
      if (ts.isCatchClause(c) && c.variableDeclaration && nombraA(c.variableDeclaration.name, n)) return { tipo: 'otro' };
      let lista: readonly ts.VariableDeclaration[] = [];
      if (ts.isSourceFile(c) || ts.isBlock(c) || ts.isModuleBlock(c)) {
        lista = c.statements.flatMap((st) => (ts.isVariableStatement(st) ? st.declarationList.declarations : []));
      } else if ((ts.isForStatement(c)) && c.initializer && ts.isVariableDeclarationList(c.initializer)) {
        lista = c.initializer.declarations;
      } else if ((ts.isForOfStatement(c) || ts.isForInStatement(c)) && ts.isVariableDeclarationList(c.initializer)) {
        lista = c.initializer.declarations;
      }
      const d = lista.find((v) => nombraA(v.name, n));
      if (d) {
        const deIteracion = ts.isForOfStatement(c) || ts.isForInStatement(c);
        return ts.isIdentifier(d.name) && !deIteracion ? { tipo: 'valor', nodo: d, ambito: c } : { tipo: 'otro' };
      }
    }
    return null;
  };

  const nombreDeFuncion = (callee: ts.Expression): string | null => {
    if (ts.isIdentifier(callee)) return funciones.get(callee.text) ?? null;
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && espacios.has(callee.expression.text)) {
      return callee.name.text;
    }
    return null;
  };

  const concatenar = (partes: Val[]): Val => {
    const raro = partes.find((p) => p.t === 'x');
    if (raro && raro.t === 'x') return x(raro.why, partes.some(anclado));
    const i = partes.findIndex((p) => p.t === 'ruta' || p.t === 'url');
    if (i < 0) return { t: 'cad', v: partes.map((p) => (p as { v: string }).v).join('') };
    if (partes.slice(0, i).some((p) => (p as { v: string }).v !== '')) return x('ruta armada con texto antes del ancla', true);
    const tipo = (partes[i] as { t: 'ruta' | 'url' }).t;
    return { t: tipo, v: partes.slice(i).map((p) => (p as { v: string }).v).join('') };
  };

  const rutaDe = (v: Val): Val => (v.t === 'url' ? { t: 'ruta', v: decodeURIComponent(v.v) } : v);

  const nuevoUrl = (n: ts.NewExpression): Val => {
    const [rel, base] = (n.arguments ?? []).map((a) => ev(a));
    if (!rel) return x('new URL sin argumentos', false);
    if (!base) return rel.t === 'url' ? rel : x('new URL de un valor que no se calcula', anclado(rel));
    if (!anclado(base) && !anclado(rel)) return x('new URL sin ancla', false);
    if (base.t === 'x') return x(base.why, true);
    if (rel.t === 'x') return x(rel.why, true);
    if (base.t !== 'url') return x('new URL con una base que no es import.meta.url ni una URL de archivo', true);
    if (rel.t !== 'cad') return x('new URL con un primer argumento que no es texto', true);
    try {
      const p = decodeURIComponent(new URL(rel.v, `file://${base.v}`).pathname);
      return dentro(p) ? { t: 'url', v: p } : x(`la URL sale del repositorio (${p})`, true);
    } catch {
      return x('new URL inválida', true);
    }
  };

  const unirRutas = (args: Val[], quien: 'join' | 'resolve'): Val => {
    const ancla = args.some(anclado);
    if (!ancla) return x('sin ancla', false);
    const raro = args.find((a) => a.t === 'x');
    if (raro && raro.t === 'x') {
      // El prefijo que sí se calcula (los argumentos anteriores al primero que no) tiene que existir.
      const i = args.indexOf(raro);
      const previo = i > 0 ? unirRutas(args.slice(0, i), quien) : null;
      return { ...x(raro.why, true), ...(previo && previo.t === 'ruta' ? { prefijo: previo.v } : {}) };
    }
    if (args.some((a) => a.t === 'url')) return x('una URL dentro de join/resolve (falta fileURLToPath)', true);
    let actual: string | null = null;
    for (const a of args as { t: 'cad' | 'ruta'; v: string }[]) {
      if (a.t === 'ruta') {
        if (quien === 'join' && actual !== null) return x('una ruta absoluta no va en el medio de join', true);
        actual = a.v;
      } else if (actual === null) {
        if (quien === 'join') actual = a.v; else return x('resolve parte de un texto relativo (depende del directorio de trabajo)', true);
      } else {
        actual = a.v === '' ? actual : posix.join(actual, a.v);
      }
    }
    const p = posix.normalize(actual ?? '');
    return dentro(p) ? { t: 'ruta', v: p } : x(`la ruta sale del repositorio (${p})`, true);
  };

  const llamada = (n: ts.CallExpression): Val => {
    const f = nombreDeFuncion(n.expression);
    const args = n.arguments.map((a) => ev(a));
    if (f === 'join' || f === 'resolve') return unirRutas(args, f);
    const [a0] = args;
    if (f === 'dirname' && a0) {
      const r = rutaDe(a0);
      if (r.t === 'ruta') return { t: 'ruta', v: posix.dirname(posix.normalize(r.v)) };
      return x(a0.t === 'x' ? a0.why : 'dirname de algo que no es una ruta calculada', anclado(a0));
    }
    if (f === 'fileURLToPath' && a0) return a0.t === 'url' ? rutaDe(a0) : x('fileURLToPath de algo que no es una URL calculada', anclado(a0));
    if (f === 'pathToFileURL' && a0) return a0.t === 'ruta' ? { t: 'url', v: a0.v } : x('pathToFileURL de algo que no es una ruta calculada', anclado(a0));
    return x('llamada a una función que el lector no sigue', args.some(anclado));
  };

  const nombre = (id: ts.Identifier): Val => {
    const n = id.text;
    const def = definicionDe(id);
    if (!def) {
      if (n === 'aqui' || n === 'AQUI' || n === '__dirname') return { t: 'ruta', v: posix.dirname(yo) };
      if (n === '__filename') return { t: 'ruta', v: yo };
      return x(`nombre sin definición en el archivo (${n})`, false);
    }
    if (def.tipo === 'otro') return x(`${n} llega de un argumento o de una iteración`, false);
    const d = def.nodo;
    if (memo.has(d)) return memo.get(d)!;
    if (enCurso.has(d)) return x(`definición circular (${n})`, true);
    enCurso.add(d);
    const exprs: ts.Expression[] = d.initializer ? [d.initializer] : [];
    // `let`/`var`: también cuentan las asignaciones posteriores dentro de su ámbito.
    const lista = d.parent;
    if (ts.isVariableDeclarationList(lista) && !(lista.flags & ts.NodeFlags.Const)) {
      const asignaciones = (m: ts.Node): void => {
        if (ts.isBinaryExpression(m) && m.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(m.left) && m.left.text === n) exprs.push(m.right);
        ts.forEachChild(m, asignaciones);
      };
      asignaciones(def.ambito);
    }
    const vals = exprs.map((e) => ev(e));
    enCurso.delete(d);
    const primero = vals[0];
    const r = !primero ? x(`${n} sin valor calculable`, false)
      : vals.every((v) => JSON.stringify(v) === JSON.stringify(primero)) ? primero
        : x(`${n} tiene varias definiciones distintas`, vals.some(anclado));
    memo.set(d, r);
    return r;
  };

  function ev(n: ts.Node): Val {
    if (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n) || ts.isAwaitExpression(n)
      || ts.isSatisfiesExpression(n)) return ev(n.expression);
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return { t: 'cad', v: n.text };
    if (ts.isNumericLiteral(n)) return { t: 'cad', v: n.text };
    if (ts.isTemplateExpression(n)) {
      return concatenar([{ t: 'cad', v: n.head.text }, ...n.templateSpans.flatMap((s) => [ev(s.expression), { t: 'cad', v: s.literal.text } as Val])]);
    }
    if (ts.isBinaryExpression(n)) {
      const op = n.operatorToken.kind;
      if (op === ts.SyntaxKind.PlusToken) return concatenar([ev(n.left), ev(n.right)]);
      if (op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken) return ev(n.right);
      if (op === ts.SyntaxKind.EqualsToken) return ev(n.right);
      return x('operador que el lector no sigue', anclado(ev(n.left)) || anclado(ev(n.right)));
    }
    if (ts.isConditionalExpression(n)) {
      const a = ev(n.whenTrue);
      const b = ev(n.whenFalse);
      return JSON.stringify(a) === JSON.stringify(b) ? a : x('las dos ramas de un condicional dan rutas distintas', anclado(a) || anclado(b));
    }
    if (ts.isIdentifier(n)) return nombre(n);
    if (ts.isPropertyAccessExpression(n)) {
      if (ts.isMetaProperty(n.expression)) {
        if (n.name.text === 'url') return { t: 'url', v: yo };
        if (n.name.text === 'dirname') return { t: 'ruta', v: posix.dirname(yo) };
        if (n.name.text === 'filename') return { t: 'ruta', v: yo };
      }
      const base = ev(n.expression);
      if (n.name.text === 'pathname' && base.t === 'url') return rutaDe(base);
      return x('propiedad que el lector no sigue', anclado(base));
    }
    if (ts.isElementAccessExpression(n)) return x('acceso por clave', anclado(ev(n.expression)) || anclado(ev(n.argumentExpression)));
    if (ts.isCallExpression(n)) return llamada(n);
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'URL') return nuevoUrl(n);
    return x(`expresión que el lector no sigue (${ts.SyntaxKind[n.kind]})`, false);
  }

  const sitios: Sitio[] = [];
  const visitar = (n: ts.Node): void => {
    let sitio = false;
    if (ts.isCallExpression(n)) {
      const f = nombreDeFuncion(n.expression);
      sitio = f === 'join' || f === 'resolve';
    } else if (ts.isNewExpression(n)) {
      sitio = ts.isIdentifier(n.expression) && n.expression.text === 'URL';
    } else if (ts.isTemplateExpression(n) || (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken)) {
      // Solo la plantilla o la suma más externa que EMPIEZA con un ancla y sigue como ruta
      // (`${aqui}/x`, `RAIZ + '/x'`): un mensaje como `No existe ${DIST}` no arma una ruta.
      const p = n.parent;
      const anidada = ts.isTemplateSpan(p) || ts.isTemplateExpression(p) || (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.PlusToken);
      if (!anidada) {
        if (ts.isTemplateExpression(n)) {
          const s0 = n.templateSpans[0];
          sitio = n.head.text === '' && !!s0 && anclado(ev(s0.expression)) && /^([\\/]|$)/.test(s0.literal.text);
        } else {
          let b = n as ts.BinaryExpression;
          while (ts.isBinaryExpression(b.left) && b.left.operatorToken.kind === ts.SyntaxKind.PlusToken) b = b.left;
          const sigue = ts.isStringLiteral(b.right) || ts.isNoSubstitutionTemplateLiteral(b.right) ? /^[\\/]/.test(b.right.text) : false;
          sitio = sigue && anclado(ev(b.left));
        }
      }
    }
    if (sitio) {
      const v = ev(n);
      if (anclado(v)) {
        const linea = fuente.getLineAndCharacterOfPosition(n.getStart(fuente)).line + 1;
        const t = n.getText(fuente).replace(/\s+/g, ' ');
        const ruta = v.t === 'ruta' || v.t === 'url' ? posix.normalize(v.v.slice(R.length + 1) || '.').replace(/\/$/, '') : null;
        sitios.push({ linea, texto: t.length > 110 ? `${t.slice(0, 107)}...` : t, ruta, motivo: v.t === 'x' ? v.why : null,
          prefijo: v.t === 'x' && v.prefijo ? posix.normalize(v.prefijo.slice(R.length + 1) || '.') : null });
      }
    }
    ts.forEachChild(n, visitar);
  };
  visitar(fuente);
  return sitios;
}

/** Los literales con `functions/src/…` o `functions/lib/…` y extensión, leídos del código (no de comentarios). */
export function literalesDeFunctions(archivo: string, texto: string): { linea: number; ruta: string }[] {
  const fuente = ts.createSourceFile(archivo, texto, ts.ScriptTarget.Latest, true, tipoDeScript(archivo));
  const carpeta = posix.dirname(archivo);
  const salida: { linea: number; ruta: string }[] = [];
  const visitar = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      const m = /^([^\s$*]*functions\/(?:src|lib)\/[^\s$*]+\.(?:ts|js|mjs))$/.exec(n.text);
      if (m) {
        const lit = m[1]!;
        const linea = fuente.getLineAndCharacterOfPosition(n.getStart(fuente)).line + 1;
        salida.push({ linea, ruta: lit.startsWith('.') ? posix.normalize(posix.join(carpeta, lit)) : lit.startsWith('admin/') ? lit : `admin/${lit}` });
      }
    }
    ts.forEachChild(n, visitar);
  };
  visitar(fuente);
  return salida;
}

/**
 * Rutas que no están en el repositorio a propósito: salidas de compilación o
 * archivos locales ignorados por git. Se aceptan solo si su carpeta existe,
 * para que una base mal armada (que cae en una carpeta que no es) se atrape.
 */
export const LOCALES_O_GENERADAS: readonly string[] = [
  'admin/web/dist', 'admin/functions/lib', 'CLIENTES', 'CONFIGURACION.local.md', 'Demo-Recursos/plantilla-catalogo.xlsx',
];

/** `admin/functions/lib/x.js` es el compilado de `admin/functions/src/x.ts`. */
export const aFuente = (r: string): string => r.replace(/^admin\/functions\/lib\/(.+)\.js$/, 'admin/functions/src/$1.ts');

/** ¿La ruta calculada lleva a algo que existe hoy (archivo o carpeta) o a una local/generada declarada? */
export function lleva(ruta: string, disco: Disco): boolean {
  // Un compilado `lib/*.js` existe solo si existe su fuente: el comodín de las generadas no lo salva.
  if (/^admin\/functions\/lib\/.+\.js$/.test(ruta)) return disco.existe(aFuente(ruta));
  if (disco.existe(aFuente(ruta))) return true;
  return LOCALES_O_GENERADAS.some((g) => (ruta === g || ruta.startsWith(`${g}/`)) && disco.existe(posix.dirname(g)));
}
