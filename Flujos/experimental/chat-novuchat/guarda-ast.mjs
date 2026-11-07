/**
 * guarda-ast.mjs — la guardia de código de `construir.mjs`, con un PARSER (acorn) en vez de expresiones regulares.
 *
 * QUÉ HACE. Lee el código de un nodo Code de n8n como un árbol (AST) y devuelve hallazgos con los MISMOS textos que tenía la guardia por patrones:
 *   - mutación de los parámetros de sesión: asignaciones (todas las formas de `=`), `++`/`--`, `for…in/of`, desestructuración, `delete`, `Object.assign/defineProperty/…` y `Reflect.set/…`, accesos a miembros e índice a `SS_CONFIG`;
 *   - `eval`, `Function` y `.constructor` (por nombre o por clave computada resuelta por plegado de constantes: `'ev' + 'al'`);
 *   - contaminar prototipos (`.prototype =`, `__proto__`, `getPrototypeOf`/`setPrototypeOf`, `defineProperty` sobre un `prototype`);
 *   - el conteo de declaraciones de `ss*` y `SS_CONFIG` (cada una, UNA vez por nodo).
 *
 * POR QUÉ UN PARSER. Una guardia por patrones sobre el texto se evade con la forma del código (una cadena que parece comentario, una división que parece regex, claves armadas con cadenas). Un parser ve lo que el motor ve:
 * comentarios, cadenas y plantillas no son código, y `new Fun` + `ction` no existe como identificador, pero `globalThis['Fun' + 'ction']` se resuelve.
 *
 * FALLA CERRADA. Un código que acorn no puede analizar es un hallazgo (el motor de n8n tampoco lo correría, o lo correría distinto): nunca se da por limpio lo que no se pudo leer.
 *
 * DÓNDE VIVE ACORN. Es una devDependency FIJA de `admin/` (acorn 8.18.0, ya en el lockfile como transitiva de eslint). Este archivo la carga con `createRequire` apuntando a `admin/package.json`,
 * porque `Flujos/` no tiene `node_modules`: la guardia corre desde `admin/` (pruebas) o con la instalación de `admin/` presente. Sin acorn instalado, la carga falla ruidosamente: no hay guardia en silencio.
 *
 * LÍMITES CONOCIDOS (declarados en `DISENO.md`, límite 4): una clave computada que no se pueda plegar (`o[f()]`) no se ve; un alias (`const c = SS_CONFIG; c.x = 1`, `const { assign } = Object`) tampoco;
 * `import()` y `require` no se vigilan aquí. El nombre se compara sin ámbito: un `ssFoo` local también cuenta (conservador).
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const requerir = createRequire(fileURLToPath(new URL('../../../admin/package.json', import.meta.url)));
const acorn = requerir('acorn');

const OPCIONES = { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true };

// Los textos de hallazgo (los mismos de siempre: las pruebas los comparan).
export const TEXTOS = {
  asigna: 'reasigna o muta un ayudante de sesión (ss*) o SS_CONFIG con «=» (o con un operador de asignación)',
  incrementa: 'incrementa o decrementa un ayudante de sesión (ss*)',
  desestructura: 'reasigna un ayudante de sesión (ss*) por desestructuración',
  paraDe: 'usa un ayudante de sesión (ss*) o SS_CONFIG como variable de un for…of / for…in',
  eval: 'usa eval o .constructor en cualquier posición (cubre eval(…), (eval)(…), alias de eval y X.constructor)',
  funcion: 'usa Function en cualquier posición (cubre Function(…) y new Function; no ve otros caminos hacia Function)',
  prototipo: 'contamina un prototipo (asigna a .prototype, asigna un .prototype a una variable, __proto__, o defineProperty/Reflect/Object.assign sobre un prototype)',
  protoDe: 'usa setPrototypeOf o getPrototypeOf',
  borra: 'borra un ayudante de sesión (ss*) o SS_CONFIG con delete',
  indice: 'accede a SS_CONFIG por índice',
  mutaConfig: 'muta SS_CONFIG con Object.assign/defineProperty/defineProperties o con Reflect',
  mutaAyudante: 'muta un ayudante de sesión (ss*) con Object.assign/defineProperty/defineProperties o con Reflect',
  noAnalizable: 'tiene código que no se puede analizar',
};

const esSS = (nombre) => nombre === 'SS_CONFIG' || /^ss[A-Z]/.test(nombre);
const MEMO = new Map();   // la guardia relee los mismos nodos varias veces

/** Analiza el código: `{ ok: true, ast }` o `{ ok: false, error }`. */
export function analizar(codigo) {
  const texto = String(codigo);
  let r = MEMO.get(texto);
  if (r === undefined) {
    try { r = { ok: true, ast: acorn.parse(texto, OPCIONES) }; } catch (x) { r = { ok: false, error: String((x && x.message) || x) }; }
    if (MEMO.size > 400) MEMO.clear();
    MEMO.set(texto, r);
  }
  return r;
}

// Recorre todo el árbol (nodo, padre).
function recorrer(nodo, visita, padre = null) {
  if (!nodo || typeof nodo.type !== 'string') return;
  visita(nodo, padre);
  for (const clave of Object.keys(nodo)) {
    if (clave === 'type' || clave === 'start' || clave === 'end') continue;
    const v = nodo[clave];
    if (Array.isArray(v)) { for (const x of v) if (x && typeof x.type === 'string') recorrer(x, visita, nodo); }
    else if (v && typeof v.type === 'string') recorrer(v, visita, nodo);
  }
}

// ---- plegado de constantes: devuelve una cadena o undefined si no se puede resolver
function tablaDeConstantes(ast) {
  const veces = new Map();
  const decl = new Map();
  recorrer(ast, (n) => {
    if (n.type === 'VariableDeclarator') {
      const nombres = []; nombresDe(n.id, nombres);
      for (const x of nombres) veces.set(x, (veces.get(x) || 0) + 1);
      return;
    }
    if (n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') { if (n.id) veces.set(n.id.name, (veces.get(n.id.name) || 0) + 2); return; }
    if (n.type === 'AssignmentExpression' || n.type === 'UpdateExpression') {
      const blanco = n.type === 'AssignmentExpression' ? n.left : n.argument;
      const nombres = []; nombresDe(blanco, nombres);
      for (const x of nombres) veces.set(x, (veces.get(x) || 0) + 2);
    }
    if (n.type === 'ForInStatement' || n.type === 'ForOfStatement') { const nombres = []; nombresDe(n.left, nombres); for (const x of nombres) veces.set(x, (veces.get(x) || 0) + 2); }
  });
  recorrer(ast, (n, padre) => {
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.init && padre && padre.kind === 'const' && veces.get(n.id.name) === 1) decl.set(n.id.name, n.init);
  });
  return decl;
}
// Los identificadores que introduce o recibe un patrón (declarador, destino de asignación, variable de for).
function nombresDe(p, salida) {
  if (!p) return;
  switch (p.type) {
    case 'Identifier': salida.push(p.name); break;
    case 'VariableDeclaration': for (const d of p.declarations) nombresDe(d.id, salida); break;
    case 'ObjectPattern': for (const x of p.properties) nombresDe(x.type === 'RestElement' ? x.argument : x.value, salida); break;
    case 'ArrayPattern': for (const x of p.elements) nombresDe(x, salida); break;
    case 'RestElement': nombresDe(p.argument, salida); break;
    case 'AssignmentPattern': nombresDe(p.left, salida); break;
    case 'MemberExpression': break;
    default: break;
  }
}

function plegador(ast) {
  const consts = tablaDeConstantes(ast);
  const enCurso = new Set();
  const plegar = (e) => {
    if (!e) return undefined;
    switch (e.type) {
      case 'Literal': return typeof e.value === 'string' || typeof e.value === 'number' || typeof e.value === 'boolean' ? String(e.value) : undefined;
      case 'TemplateLiteral': {
        let s = '';
        for (let i = 0; i < e.quasis.length; i++) {
          s += e.quasis[i].value.cooked ?? '';
          if (i < e.expressions.length) { const v = plegar(e.expressions[i]); if (v === undefined) return undefined; s += v; }
        }
        return s;
      }
      case 'BinaryExpression': {
        if (e.operator !== '+') return undefined;
        const a = plegar(e.left); const b = plegar(e.right);
        return a === undefined || b === undefined ? undefined : a + b;
      }
      case 'Identifier': {
        if (!consts.has(e.name) || enCurso.has(e.name)) return undefined;
        enCurso.add(e.name);
        try { return plegar(consts.get(e.name)); } finally { enCurso.delete(e.name); }
      }
      case 'SequenceExpression': return plegar(e.expressions[e.expressions.length - 1]);
      case 'CallExpression': {
        const c = e.callee;
        if (c.type !== 'MemberExpression') return undefined;
        const m = nombreDeMiembro(c, plegar);
        if (m === 'join' && c.object.type === 'ArrayExpression') {
          const partes = c.object.elements.map((x) => (x && x.type !== 'SpreadElement' ? plegar(x) : undefined));
          const sep = e.arguments.length ? plegar(e.arguments[0]) : ',';
          return partes.includes(undefined) || sep === undefined ? undefined : partes.join(sep);
        }
        if (m === 'concat') { const base = plegar(c.object); const resto = e.arguments.map((x) => plegar(x)); return base === undefined || resto.includes(undefined) ? undefined : base + resto.join(''); }
        if (m === 'fromCharCode' && c.object.type === 'Identifier' && c.object.name === 'String') {
          const cs = e.arguments.map((x) => { const v = plegar(x); return v === undefined || !/^\d+$/.test(v) ? undefined : Number(v); });
          return cs.includes(undefined) ? undefined : String.fromCharCode(...cs);
        }
        return undefined;
      }
      default: return undefined;
    }
  };
  return plegar;
}

// El nombre de la propiedad de un miembro: `a.b` → 'b'; `a['b'+'c']` → 'bc'; si no se resuelve, undefined.
function nombreDeMiembro(m, plegar) {
  if (!m.computed) return m.property.type === 'Identifier' ? m.property.name : (m.property.type === 'PrivateIdentifier' ? '#' + m.property.name : undefined);
  return plegar(m.property);
}

// Descompone una expresión de acceso en sus «raíces» y los nombres de propiedad de la cadena: `(a || ssFoo).x.y` → raíces [a, ssFoo], nombres [x, y].
function cadena(e, plegar, acc = { raices: [], nombres: [], ultimo: undefined }) {
  if (!e) return acc;
  switch (e.type) {
    case 'Identifier': acc.raices.push(e.name); break;
    case 'MemberExpression': {
      const n = nombreDeMiembro(e, plegar);
      if (n !== undefined) acc.nombres.push(n);
      if (acc.ultimo === undefined) acc.ultimo = n;
      cadena(e.object, plegar, acc); break;
    }
    case 'ChainExpression': cadena(e.expression, plegar, acc); break;
    case 'SequenceExpression': cadena(e.expressions[e.expressions.length - 1], plegar, acc); break;
    case 'ConditionalExpression': cadena(e.consequent, plegar, acc); cadena(e.alternate, plegar, acc); break;
    case 'LogicalExpression': cadena(e.left, plegar, acc); cadena(e.right, plegar, acc); break;
    case 'AssignmentExpression': cadena(e.right, plegar, acc); cadena(e.left, plegar, acc); break;
    default: break;
  }
  return acc;
}
const tocaSS = (c) => c.raices.some(esSS) || c.nombres.some(esSS);

// Los destinos de una asignación o de la variable de un for: [{ expr, desestructurado }]
function destinos(p, desestructurado = false, salida = []) {
  if (!p) return salida;
  switch (p.type) {
    case 'ObjectPattern': for (const x of p.properties) destinos(x.type === 'RestElement' ? x.argument : x.value, true, salida); break;
    case 'ArrayPattern': for (const x of p.elements) destinos(x, true, salida); break;
    case 'RestElement': destinos(p.argument, true, salida); break;
    case 'AssignmentPattern': destinos(p.left, desestructurado, salida); break;
    case 'VariableDeclaration': for (const d of p.declarations) destinos(d.id, desestructurado, salida); break;
    default: salida.push({ expr: p, desestructurado });
  }
  return salida;
}

const FUNCIONES_DE_MUTACION = { Object: new Set(['assign', 'defineProperty', 'defineProperties']), Reflect: new Set(['set', 'defineProperty', 'deleteProperty']) };

/**
 * Los hallazgos del código de un nodo (SIN el módulo común ni el registro, que declaran `ss*` y `SS_CONFIG`): un arreglo de textos, sin repetidos, vacío si está limpio.
 */
export function hallazgosDelCodigo(codigo) {
  const a = analizar(codigo);
  if (!a.ok) return [TEXTOS.noAnalizable];
  const plegar = plegador(a.ast);
  const h = new Set();
  const nombreDe = (m) => nombreDeMiembro(m, plegar);

  recorrer(a.ast, (n) => {
    switch (n.type) {
      case 'Identifier':
        if (n.name === 'eval') h.add(TEXTOS.eval);
        else if (n.name === 'Function') h.add(TEXTOS.funcion);
        else if (n.name === '__proto__') h.add(TEXTOS.prototipo);
        else if (n.name === 'getPrototypeOf' || n.name === 'setPrototypeOf') h.add(TEXTOS.protoDe);
        break;
      case 'Property':
      case 'MethodDefinition':
      case 'PropertyDefinition': {
        // clave literal o computada resuelta: `{ ['__proto__']: x }`, `{ '__proto__': x }`
        if (!n.key) break;
        const k = n.computed || n.key.type === 'Literal' ? plegar(n.key) : undefined;
        if (k === '__proto__') h.add(TEXTOS.prototipo);
        else if (k === 'eval') h.add(TEXTOS.eval);
        else if (k === 'Function') h.add(TEXTOS.funcion);
        else if (k === 'getPrototypeOf' || k === 'setPrototypeOf') h.add(TEXTOS.protoDe);
        break;
      }
      case 'MemberExpression': {
        const k = nombreDe(n);
        if (k === 'eval') h.add(TEXTOS.eval);
        else if (k === 'constructor') h.add(TEXTOS.eval);
        else if (k === 'Function') h.add(TEXTOS.funcion);
        else if (k === '__proto__') h.add(TEXTOS.prototipo);
        else if (k === 'getPrototypeOf' || k === 'setPrototypeOf') h.add(TEXTOS.protoDe);
        // SS_CONFIG[…]: cualquier acceso por índice
        if (n.computed && n.object.type === 'Identifier' && n.object.name === 'SS_CONFIG') h.add(TEXTOS.indice);
        break;
      }
      case 'AssignmentExpression': {
        for (const d of destinos(n.left)) {
          const c = cadena(d.expr, plegar);
          if (tocaSS(c)) h.add(d.desestructurado ? TEXTOS.desestructura : TEXTOS.asigna);
          if (c.nombres.includes('prototype')) h.add(TEXTOS.prototipo);
        }
        if (terminaEnPrototype(n.right, plegar)) h.add(TEXTOS.prototipo);
        break;
      }
      case 'VariableDeclarator':
        if (n.init && terminaEnPrototype(n.init, plegar)) h.add(TEXTOS.prototipo);
        break;
      case 'UpdateExpression': {
        const c = cadena(n.argument, plegar);
        if (tocaSS(c)) h.add(TEXTOS.incrementa);
        if (c.nombres.includes('prototype')) h.add(TEXTOS.prototipo);
        break;
      }
      case 'UnaryExpression':
        if (n.operator === 'delete') {
          const c = cadena(n.argument, plegar);
          if (tocaSS(c)) h.add(TEXTOS.borra);
          if (c.nombres.includes('prototype')) h.add(TEXTOS.prototipo);
        }
        break;
      case 'ForInStatement':
      case 'ForOfStatement':
        for (const d of destinos(n.left)) if (tocaSS(cadena(d.expr, plegar))) h.add(TEXTOS.paraDe);
        break;
      case 'CallExpression': {
        const c = n.callee;
        if (c.type !== 'MemberExpression' || c.object.type !== 'Identifier') break;
        const funcion = nombreDe(c);
        const permitidas = Object.prototype.hasOwnProperty.call(FUNCIONES_DE_MUTACION, c.object.name) ? FUNCIONES_DE_MUTACION[c.object.name] : null;
        if (!permitidas || !permitidas.has(funcion) || !n.arguments.length) break;
        const primero = cadena(n.arguments[0], plegar);
        if (primero.raices.includes('SS_CONFIG') || primero.nombres.includes('SS_CONFIG')) h.add(TEXTOS.mutaConfig);
        else if (tocaSS(primero)) h.add(TEXTOS.mutaAyudante);
        if (primero.nombres.includes('prototype')) h.add(TEXTOS.prototipo);
        break;
      }
      default: break;
    }
  });
  return [...h];
}

// `x = Algo.prototype` (el valor ES un prototipo, sin seguir hacia una propiedad suya).
function terminaEnPrototype(e, plegar) {
  let x = e;
  while (x && (x.type === 'ChainExpression' || x.type === 'SequenceExpression')) x = x.type === 'ChainExpression' ? x.expression : x.expressions[x.expressions.length - 1];
  return !!x && x.type === 'MemberExpression' && nombreDeMiembro(x, plegar) === 'prototype';
}

/**
 * Cuántas veces se declara cada `ss*` y `SS_CONFIG` en el código (declaraciones de variable, desestructuradas incluidas, funciones, nombradas o no, y clases). Un Map nombre → veces.
 * Si el código no se puede analizar devuelve `null` (el llamador ya reporta el hallazgo `noAnalizable`).
 */
export function contarDeclaraciones(codigo) {
  const a = analizar(codigo);
  if (!a.ok) return null;
  const cuenta = new Map();
  const suma = (nombre) => { if (esSS(nombre)) cuenta.set(nombre, (cuenta.get(nombre) || 0) + 1); };
  recorrer(a.ast, (n) => {
    if (n.type === 'VariableDeclarator') { const nombres = []; nombresDe(n.id, nombres); nombres.forEach(suma); }
    else if ((n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ClassDeclaration' || n.type === 'ClassExpression') && n.id) suma(n.id.name);
  });
  return cuenta;
}
