/**
 * =============================================================================
 * expresiones.mjs — LO QUE EL SANDBOX DE EXPRESIONES DE n8n 2.36.5 RECHAZA (guardia común, 07/11/2026)
 * =============================================================================
 *
 * POR QUÉ. El 07/11/2026 dos imágenes de clientes de Q'Taco no dejaron ninguna ejecución: la expresión del IF
 * «¿Es comprobante?» usaba `Object.prototype.hasOwnProperty` y n8n la rechazó con
 * «Cannot access "prototype" due to security concerns»; la ejecución murió sin registro.
 *
 * DOS SANDBOX DISTINTOS. Las EXPRESIONES (cualquier parámetro de nodo cuyo texto empieza con «=») las evalúa n8n con un
 * sandbox restrictivo que bloquea, entre otras cosas, leer `prototype`, `__proto__`, `constructor` y `getPrototypeOf` (también
 * entre comillas: `$json["constructor"]`), y que no expone `Function`, `eval`, `process`, `require`, `globalThis` ni `this`. Los
 * nodos Code corren en otro sandbox (el del task runner), con otras reglas: esta guardia NO mira `jsCode` (no empieza con «=»).
 *
 * QUÉ SE REVISA. El CÓDIGO de cada bloque `{{ … }}` (el bloque se cierra en el `}}` que queda fuera de toda cadena y a profundidad de llaves
 * 0, así un `}}` dentro del código no corta la revisión), con el contenido de los literales vacío (cadenas, tramos de texto de las
 * plantillas y expresiones regulares) pero con lo interpolado en `${…}`, más los accesos entre corchetes con un texto literal. La prosa
 * fuera de los bloques no cuenta. NO cuentan: una propiedad del dato con esos nombres (`$json.process`, `x.module`) ni una clave de
 * objeto literal (`{ constructor: 1 }`). LÍMITE DECLARADO: una «/» tras un `)` o un identificador se toma por división (como en JS).
 *
 * QUÉ DEVUELVE. `hallazgosDeExpresiones(flujo)` → `{ nodo, ruta, regla, severidad, texto }[]` (vacía si está limpio);
 * `textosDeHallazgos(flujo)` → la misma lista en frases (para los `--verificar`); `rechazoDeExpresion(texto)` → el primer motivo de
 * rechazo de UN texto de expresión, o null (lo usa el n8n de mentira de la suite, así la regla es una sola).
 * Para saber si una clave es propia DENTRO de una expresión: `Object.keys(o).indexOf(k) >= 0`.
 */

const PROTO = '(prototype|__proto__|constructor|getPrototypeOf|setPrototypeOf)';

// Cada regla: `re` con la palabra en el grupo 1, sobre el código sin literales; `clave` = no cuenta en posición de clave de objeto literal;
// `propiedad` = no cuenta tras un punto (es una propiedad del dato, no el global).
export const REGLAS_DE_EXPRESION = [
  { regla: 'prototype', severidad: 'bloquea', re: new RegExp(`\\b${PROTO}\\b`, 'g'), clave: true, propiedad: false,
    texto: 'lee «$1»: n8n rechaza la expresión («Cannot access … due to security concerns») y la ejecución muere' },
  { regla: 'eval', severidad: 'bloquea', re: /(?<![.\w$])(Function|eval)\s*\(/g, clave: false, propiedad: true, texto: 'llama a «$1(…)»: no existe en el sandbox de expresiones' },
  { regla: 'global', severidad: 'bloquea', re: /\b(globalThis|global|process|require|module|exports|Buffer)\b/g, clave: true, propiedad: true, texto: 'usa «$1»: no existe en el sandbox de expresiones' },
  { regla: 'import', severidad: 'bloquea', re: /(?<![.\w$])(import)\s*\(/g, clave: false, propiedad: true, texto: 'usa «import(…)»: no existe en el sandbox de expresiones' },
  { regla: 'this', severidad: 'bloquea', re: /(?<![.\w$])(this)\s*[.[]/g, clave: false, propiedad: true, texto: 'usa «this»: en una expresión no hay `this`' },
  { regla: 'structuredClone', severidad: 'bloquea', re: /\b(structuredClone|queueMicrotask|setTimeout|setInterval|fetch)\s*\(/g, clave: false, propiedad: true, texto: 'llama a «$1(…)»: no está en el sandbox de expresiones' },
];
// `$json["constructor"]`, `o['prototype']`: el acceso entre corchetes con un texto literal. El escáner conserva el texto de un literal SOLO si es
// una de esas palabras (para poder ver este acceso); cualquier otro literal se vacía.
// El literal conservado sale como `'P_<palabra>'` (el «_» corta el límite de palabra: así no lo toma la regla de `prototype` por sí solo).
const RE_CORCHETE = new RegExp(`\\[\\s*(['"\`])P_${PROTO}\\1\\s*\\]`);
const PALABRA_PROTO = new RegExp(`^${PROTO}$`);

// Lo que va antes de una «/» que abre una EXPRESIÓN REGULAR (y no una división): un operador, un paréntesis o una llave que abre, o nada.
const ANTES_DE_REGEX = /[(,=:[!&|?{};+\-*%<>~^]/;

/**
 * EL ESCÁNER (una sola función para la guardia y para el n8n de mentira). Recorre `texto` desde `desde` como CÓDIGO JavaScript y devuelve
 * `{ codigo, fin }`: el código con el contenido de los literales vacío (las cadenas '…' y "…", los tramos de texto de las plantillas `…`
 * y las expresiones regulares /…/), pero CONSERVANDO lo interpolado en `${…}`. Con `cierre: '}}'` se detiene en el `}}` que cierra el
 * bloque (a profundidad de llaves 0, fuera de toda cadena); sin él, recorre todo. `fin` = el índice tras el `}}` (o -1 si no cerró).
 */
export function escanear(texto, desde = 0, cierre = '') {
  const s = String(texto);
  let out = '';
  let i = desde;
  let ultimo = ''; // el último carácter significativo del CÓDIGO (para distinguir una regex de una división)
  const pila = []; // profundidades de llaves de cada `${` abierto
  let llaves = 0;
  const literal = (q) => { // una cadena '…' o "…": devuelve su contenido y avanza `i` tras la comilla de cierre
    let t = '';
    i++;
    while (i < s.length && s[i] !== q && s[i] !== '\n') { if (s[i] === '\\') { t += s.slice(i, i + 2); i += 2; } else { t += s[i]; i++; } }
    i++;
    return t;
  };
  const plantilla = () => { // los tramos de texto de `…`; en `${` vuelve al código
    i++;
    out += '`';
    while (i < s.length) {
      if (s[i] === '\\') { i += 2; continue; }
      if (s[i] === '`') { i++; out += '`'; return; }
      if (s[i] === '$' && s[i + 1] === '{') { out += '${'; i += 2; pila.push(llaves); llaves = 0; ultimo = '{'; codigo(true); out += '}'; continue; }
      i++;
    }
  };
  const regex = () => {
    let enClase = false;
    i++;
    while (i < s.length && s[i] !== '\n') {
      if (s[i] === '\\') { i += 2; continue; }
      if (s[i] === '[') enClase = true; else if (s[i] === ']') enClase = false; else if (s[i] === '/' && !enClase) break;
      i++;
    }
    i++;
    while (i < s.length && /[a-z]/i.test(s[i])) i++;
    out += '/x/';
    ultimo = 'x';
  };
  let cerro = -1;
  const codigo = (enInterpolacion) => {
    while (i < s.length) {
      const c = s[i];
      if (!enInterpolacion && cierre && llaves === 0 && s.startsWith(cierre, i)) { cerro = i + cierre.length; i = s.length; return; }
      if (c === '"' || c === "'") { const t = literal(c); out += PALABRA_PROTO.test(t) ? c + 'P_' + t + c : c + c; ultimo = c; continue; }
      if (c === '`') { plantilla(); ultimo = '`'; continue; }
      if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
      if (c === '/' && s[i + 1] === '*') { const k = s.indexOf('*/', i + 2); i = k < 0 ? s.length : k + 2; continue; }
      if (c === '/' && (ultimo === '' || ANTES_DE_REGEX.test(ultimo))) { regex(); continue; }
      if (c === '{') llaves++;
      if (c === '}') {
        if (llaves === 0 && enInterpolacion) { i++; llaves = pila.pop() || 0; ultimo = '}'; return; }
        llaves = Math.max(0, llaves - 1);
      }
      out += c;
      if (!/\s/.test(c)) ultimo = c;
      i++;
    }
  };
  codigo(false);
  return { codigo: out, fin: cerro };
}

/** Los bloques `{{ … }}` de un texto de expresión (que empieza con «=»), ya escaneados: `[codigoSinLiterales, …]`. Un `{{` sin cierre se revisa hasta el final. */
export function bloquesDeExpresion(texto) {
  const s = String(texto);
  if (!s.startsWith('=')) return [];
  const bloques = [];
  let i = 1;
  for (;;) {
    const k = s.indexOf('{{', i);
    if (k < 0) break;
    const r = escanear(s, k + 2, '}}');
    bloques.push(r.codigo);
    if (r.fin < 0) break;
    i = r.fin;
  }
  return bloques;
}

/** El código sin el contenido de sus literales (lo interpolado en `${…}` se conserva). */
export function sinLiterales(codigo) {
  return escanear(codigo).codigo;
}

const anteriorNoBlanco = (s, i) => { let j = i - 1; while (j >= 0 && /\s/.test(s[j])) j--; return j >= 0 ? s[j] : ''; };
const siguienteNoBlanco = (s, i) => { let j = i; while (j < s.length && /\s/.test(s[j])) j++; return j < s.length ? s[j] : ''; };

/** El primer motivo de rechazo de un código YA ESCANEADO (de `bloquesDeExpresion`), o null. */
function rechazoDeEscaneado(s) {
  const m0 = RE_CORCHETE.exec(s);
  if (m0) return { regla: 'prototype', palabra: m0[2], texto: REGLAS_DE_EXPRESION[0].texto.replace('$1', m0[2]) };
  for (const r of REGLAS_DE_EXPRESION) {
    const re = new RegExp(r.re.source, 'g');
    let m;
    while ((m = re.exec(s)) !== null) {
      const ini = m.index + m[0].indexOf(m[1]);
      const fin = ini + m[1].length;
      const antes = anteriorNoBlanco(s, ini);
      if (r.clave && (antes === '{' || antes === ',') && siguienteNoBlanco(s, fin) === ':') continue; // clave de un objeto literal
      if (r.propiedad && antes === '.') continue; // `$json.process`: una propiedad del dato, no el global
      return { regla: r.regla, palabra: m[1], texto: r.texto.replace('$1', m[1]) };
    }
  }
  return null;
}

/** El primer motivo de rechazo de un trozo de CÓDIGO de expresión (lo de dentro de un `{{ … }}`), o null. */
export function rechazoDeCodigo(codigo) {
  return rechazoDeEscaneado(sinLiterales(codigo));
}

/**
 * El primer motivo de rechazo de un texto de expresión (que empieza con «=»), o null. Revisa SOLO el código de los bloques `{{ … }}`: la prosa
 * de fuera («Usa el modulo global…», un apóstrofo como «Q'Taco») ni cuenta ni esconde código. La usan la guardia y el n8n de mentira.
 */
export function rechazoDeExpresion(texto) {
  for (const b of bloquesDeExpresion(texto)) {
    const r = rechazoDeEscaneado(b);
    if (r) return r;
  }
  return null;
}

export function hallazgosDeExpresiones(flujo) {
  const h = [];
  const recorrer = (v, ruta, nodo) => {
    if (typeof v === 'string') {
      const r = rechazoDeExpresion(v);
      if (r) h.push({ nodo, ruta, regla: r.regla, severidad: 'bloquea', texto: r.texto });
    } else if (Array.isArray(v)) v.forEach((x, i) => recorrer(x, `${ruta}[${i}]`, nodo));
    else if (v && typeof v === 'object') for (const k of Object.keys(v)) recorrer(v[k], ruta ? `${ruta}.${k}` : k, nodo);
  };
  for (const n of (flujo && Array.isArray(flujo.nodes) ? flujo.nodes : [])) recorrer(n.parameters || {}, '', n.name);
  return h;
}

export function textosDeHallazgos(flujo) {
  return hallazgosDeExpresiones(flujo).map((x) => `la expresión de «${x.nodo}» (${x.ruta}) ${x.texto}`);
}
