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
 * `import()` y `require` no se vigilan aquí; tampoco `const O = Object; O.assign(SS_CONFIG)`, `Object.assign(...[SS_CONFIG])` ni las plantillas con etiqueta dentro de join/concat. El nombre se compara sin ámbito: un `ssFoo` local también cuenta (conservador).
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
  claveGlobal: 'accede al objeto global (globalThis, global, self, window, this) con una clave computada que no se puede resolver',
  conWith: 'usa with (cambia el ámbito de los nombres: `with (SS_CONFIG) { espacio = 1 }` muta sin nombrarlo)',
  noAnalizable: 'tiene código que no se puede analizar',
  comentarioHtml: 'usa un comentario HTML («<!--» o «-->»), que esconde código a una guardia por patrones',
};

const esSS = (nombre) => nombre === 'SS_CONFIG' || /^ss[A-Z]/.test(nombre);
const MEMO = new Map();   // la guardia relee los mismos nodos varias veces

/** Analiza el código: `{ ok: true, ast }` o `{ ok: false, error }`. */
export function analizar(codigo) {
  const texto = String(codigo);
  let r = MEMO.get(texto);
  if (r === undefined) {
    try {
      // los comentarios HTML de Annex B (`<!--`, `-->` al inicio de línea) son comentarios para el motor y no para un tokenizador: se rechazan (fuera de cadenas y plantillas, porque el parser los ve como lo que son)
      let html = false;
      const ast = acorn.parse(texto, { ...OPCIONES, onComment: (bloque, _t, ini) => { if (!bloque && (texto.startsWith('<!--', ini) || texto.startsWith('-->', ini))) html = true; } });
      r = { ok: true, ast, html };
    } catch (x) { r = { ok: false, error: String((x && x.message) || x) }; }
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

const TOPE_PLEGADO = 256;     // una cadena plegada más larga que esto se trata como «no se puede plegar»
const TOPE_PROFUNDIDAD = 200;
function plegador(ast) {
  const consts = tablaDeConstantes(ast);
  const enCurso = new Set();
  const memo = new Map();   // nodo → valor (o NO_PLEGABLE): sin memo, `k1 = k0 + k0; k2 = k1 + k1; …` es exponencial
  const NO_PLEGABLE = Symbol('no plegable');
  let profundidad = 0;
  // devuelve un valor primitivo (cadena, número o booleano) o undefined si no hay certeza
  const plegar = (e) => {
    if (!e) return undefined;
    if (memo.has(e)) { const m = memo.get(e); return m === NO_PLEGABLE ? undefined : m; }
    if (profundidad > TOPE_PROFUNDIDAD) return undefined;
    profundidad++;
    let v;
    try { v = plegarSinMemo(e); } finally { profundidad--; }
    if (typeof v === 'string' && v.length > TOPE_PLEGADO) v = undefined;
    memo.set(e, v === undefined ? NO_PLEGABLE : v);
    return v;
  };
  const plegarSinMemo = (e) => {
    if (!e) return undefined;
    switch (e.type) {
      case 'Literal': return typeof e.value === 'string' || typeof e.value === 'number' || typeof e.value === 'boolean' ? e.value : undefined;
      case 'TemplateLiteral': {
        let s = '';
        for (let i = 0; i < e.quasis.length; i++) {
          s += e.quasis[i].value.cooked ?? '';
          if (i < e.expressions.length) { const v = plegar(e.expressions[i]); if (v === undefined) return undefined; s += String(v); }
        }
        return s;
      }
      case 'BinaryExpression': {
        if (e.operator !== '+') return undefined;
        const a = plegar(e.left); const b = plegar(e.right);
        if (a === undefined || b === undefined) return undefined;
        if (typeof a === 'number' && typeof b === 'number') return a + b;   // suma numérica: 100 + 1 es 101, no «1001»
        if (typeof a === 'string' || typeof b === 'string') return String(a) + String(b);
        return undefined;   // sin certeza del tipo (booleanos…)
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
          return partes.includes(undefined) || sep === undefined ? undefined : partes.map(String).join(String(sep));
        }
        if (m === 'concat') { const base = plegar(c.object); const resto = e.arguments.map((x) => plegar(x)); return typeof base !== 'string' || resto.includes(undefined) ? undefined : base + resto.map(String).join(''); }
        if (m === 'fromCharCode' && c.object.type === 'Identifier' && c.object.name === 'String') {
          const cs = e.arguments.map((x) => { const v = plegar(x); return typeof v !== 'number' ? undefined : v; });
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
  const v = plegar(m.property);
  return v === undefined ? undefined : String(v);
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
 * Los hallazgos de un código (el del nodo completo, o el que queda sin el módulo común y el registro, que declaran `ss*` y `SS_CONFIG`): un arreglo de textos, sin repetidos, vacío si está limpio.
 */
const MEMO_HALLAZGOS = new Map();
export function hallazgosDelCodigo(codigo) {
  const texto = String(codigo);
  let r = MEMO_HALLAZGOS.get(texto);
  if (r === undefined) {
    // falla cerrada: un error del análisis (p. ej. un RangeError por anidamiento extremo) es un hallazgo, no una excepción suelta
    try { r = hallazgosSinMemo(texto); } catch (x) { r = [TEXTOS.noAnalizable]; }
    if (MEMO_HALLAZGOS.size > 100) MEMO_HALLAZGOS.clear();
    MEMO_HALLAZGOS.set(texto, r);
  }
  return [...r];
}
function hallazgosSinMemo(codigo) {
  const a = analizar(codigo);
  if (!a.ok) return [TEXTOS.noAnalizable];
  const plegar = plegador(a.ast);
  const h = new Set();
  if (a.html) h.add(TEXTOS.comentarioHtml);
  const nombreDe = (m) => nombreDeMiembro(m, plegar);

  const PALABRA_PELIGROSA = /(?<![\p{L}\p{N}_$])(eval|Function|__proto__|[gs]etPrototypeOf)(?![\p{L}\p{N}_$])/u;
  const NOMBRES_PELIGROSOS = new Map([['eval', TEXTOS.eval], ['constructor', TEXTOS.eval], ['Function', TEXTOS.funcion], ['__proto__', TEXTOS.prototipo], ['getPrototypeOf', TEXTOS.protoDe], ['setPrototypeOf', TEXTOS.protoDe]]);
  recorrer(a.ast, (n, padre) => {
    // Toda expresión (fuera de una clave) cuyo valor plegado sea EXACTAMENTE uno de esos nombres: una cadena que vale `eval` no tiene otro uso que llegar a `eval` (`Reflect.get(globalThis, 'eval')`, `let k = 'eval'`, `f('eval')`, `['eval'][0]`). Una cadena que solo CONTIENE «eval» en un texto más largo no se marca.
    if (n.type === 'Literal' || n.type === 'TemplateLiteral' || n.type === 'BinaryExpression' || n.type === 'CallExpression' || n.type === 'Identifier') {
      const esClave = padre && ((padre.type === 'MemberExpression' && padre.property === n && !padre.computed) || ((padre.type === 'Property' || padre.type === 'MethodDefinition' || padre.type === 'PropertyDefinition') && padre.key === n && !padre.computed));
      if (!esClave) { const v = plegar(n); if (typeof v === 'string' && NOMBRES_PELIGROSOS.has(v)) h.add(NOMBRES_PELIGROSOS.get(v)); }
    }
    // Toda cadena, patrón de regex o fragmento de plantilla que contenga COMO PALABRA eval, Function, __proto__ o get/setPrototypeOf: se transforman (`' eval'.trim()`, `JSON.parse('"eval"')`, `'eval,x'.split(',')[0]`, `/eval/.source`) y llegan a su destino sin que el plegado las vea.
    {
      const texto = n.type === 'Literal' ? (typeof n.value === 'string' ? n.value : (n.regex ? n.regex.pattern : undefined)) : (n.type === 'TemplateElement' ? n.value.cooked ?? n.value.raw : undefined);
      if (typeof texto === 'string') { const m = PALABRA_PELIGROSA.exec(texto); if (m) h.add(NOMBRES_PELIGROSOS.get(m[1] === 'eval' || m[1] === 'Function' || m[1] === '__proto__' ? m[1] : 'getPrototypeOf')); }
    }
    if (n.type === 'WithStatement') h.add(TEXTOS.conWith);
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
        // clave: `{ eval: 1 }`, `{ ['__proto__']: x }`, `{ ['constr' + 'uctor']: C }` (también en patrones). La clase `constructor() {}` es legítima.
        if (n.key) {
          const v = n.computed ? plegar(n.key) : (n.key.type === 'Identifier' ? n.key.name : (n.key.type === 'Literal' ? n.key.value : undefined));
          const k = v === undefined ? undefined : String(v);
          if (k === '__proto__') h.add(TEXTOS.prototipo);
          else if (k === 'eval' || (k === 'constructor' && n.type === 'Property' && !n.method)) h.add(TEXTOS.eval);
          else if (k === 'Function') h.add(TEXTOS.funcion);
          else if (k === 'getPrototypeOf' || k === 'setPrototypeOf') h.add(TEXTOS.protoDe);
        }
        if (n.type === 'PropertyDefinition' && n.value && terminaEnPrototype(n.value, plegar)) h.add(TEXTOS.prototipo);
        break;
      }
      case 'AssignmentPattern':
        if (terminaEnPrototype(n.right, plegar)) h.add(TEXTOS.prototipo);
        break;
      case 'MemberExpression': {
        const k = nombreDe(n);
        if (k === 'eval') h.add(TEXTOS.eval);
        else if (k === 'constructor') h.add(TEXTOS.eval);
        else if (k === 'Function') h.add(TEXTOS.funcion);
        else if (k === '__proto__') h.add(TEXTOS.prototipo);
        else if (k === 'getPrototypeOf' || k === 'setPrototypeOf') h.add(TEXTOS.protoDe);
        // clave computada que no se pliega sobre el objeto global: `let k = 'ev'; globalThis[k + 'al']`
        if (n.computed && plegar(n.property) === undefined && ((n.object.type === 'Identifier' && ['globalThis', 'global', 'self', 'window'].includes(n.object.name)) || n.object.type === 'ThisExpression')) h.add(TEXTOS.claveGlobal);
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
        if (c.type !== 'MemberExpression') break;
        // el objeto se resuelve por la cadena de miembros: `Object`, `globalThis.Object`, `globalThis['Obj' + 'ect']`
        const cabeza = cadena(c.object, plegar);
        const funcion = nombreDe(c);
        const permitidas = [cabeza.ultimo, ...cabeza.raices].filter((x) => x !== undefined).map((x) => (Object.prototype.hasOwnProperty.call(FUNCIONES_DE_MUTACION, x) ? FUNCIONES_DE_MUTACION[x] : null)).find(Boolean) || null;
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
 * Cuántas veces se declara cada `ss*` y `SS_CONFIG` en el código (declaraciones de variable, desestructuradas incluidas, declaraciones de función y de clase; no las expresiones, cuyo nombre no entra en el ámbito). Un Map nombre → veces.
 * Si el código no se puede analizar devuelve `null` (el llamador ya reporta el hallazgo `noAnalizable`).
 */
const MEMO_CUENTA = new Map();
export function contarDeclaraciones(codigo) {
  const texto = String(codigo);
  let r = MEMO_CUENTA.get(texto);
  if (r === undefined) {
    try { r = contarSinMemo(texto); } catch (x) { r = null; }
    if (MEMO_CUENTA.size > 100) MEMO_CUENTA.clear();
    MEMO_CUENTA.set(texto, r);
  }
  return r === null ? null : new Map(r);
}
function contarSinMemo(codigo) {
  const a = analizar(codigo);
  if (!a.ok) return null;
  const cuenta = new Map();
  const suma = (nombre) => { if (esSS(nombre)) cuenta.set(nombre, (cuenta.get(nombre) || 0) + 1); };
  recorrer(a.ast, (n) => {
    if (n.type === 'VariableDeclarator') { const nombres = []; nombresDe(n.id, nombres); nombres.forEach(suma); }
    else if ((n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') && n.id) suma(n.id.name);
  });
  return cuenta;
}
