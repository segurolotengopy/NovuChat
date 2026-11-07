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
 * QUÉ SE REVISA. TODO el texto tras el «=» (no solo lo que va entre `{{` y el primer `}}`: un `}}` dentro del código cortaría la
 * revisión), sin el contenido de los literales de texto, más los accesos entre corchetes con un texto literal. NO cuentan: una
 * propiedad propia con esos nombres (`$json.process`, `x.module`) ni una clave de objeto literal (`{ constructor: 1 }`).
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
// `$json["constructor"]`, `o['prototype']`: el acceso entre corchetes con un texto literal (se mira en el texto CON sus literales).
const RE_CORCHETE = new RegExp(`\\[\\s*(['"\`])${PROTO}\\1\\s*\\]`, 'g');

/** El código sin el contenido de los literales de texto ('…', "…", `…` sin interpolar). */
export function sinLiterales(codigo) {
  return String(codigo)
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

const anteriorNoBlanco = (s, i) => { let j = i - 1; while (j >= 0 && /\s/.test(s[j])) j--; return j >= 0 ? s[j] : ''; };
const siguienteNoBlanco = (s, i) => { let j = i; while (j < s.length && /\s/.test(s[j])) j++; return j < s.length ? s[j] : ''; };

/** El primer motivo de rechazo de un texto de código de expresión (sin el «=»), o null. */
export function rechazoDeCodigo(codigo) {
  const crudo = String(codigo);
  const m0 = new RegExp(RE_CORCHETE.source).exec(crudo);
  if (m0) return { regla: 'prototype', palabra: m0[2], texto: REGLAS_DE_EXPRESION[0].texto.replace('$1', m0[2]) };
  const s = sinLiterales(crudo);
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

/** El primer motivo de rechazo de un texto de expresión (que empieza con «=»), o null. */
export function rechazoDeExpresion(texto) {
  const s = String(texto);
  return s.startsWith('=') ? rechazoDeCodigo(s.slice(1)) : null;
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
