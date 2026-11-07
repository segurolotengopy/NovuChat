/**
 * =============================================================================
 * expresiones.mjs — LO QUE EL SANDBOX DE EXPRESIONES DE n8n 2.36.5 RECHAZA (guardia común, 07/11/2026)
 * =============================================================================
 *
 * POR QUÉ. El 07/11/2026 dos imágenes de clientes de Q'Taco no dejaron ninguna ejecución: la expresión del IF
 * «¿Es comprobante?» usaba `Object.prototype.hasOwnProperty` y n8n la rechazó con
 * «Cannot access "prototype" due to security concerns»; la ejecución murió sin registro.
 *
 * DOS SANDBOX DISTINTOS. Las EXPRESIONES (cualquier parámetro de nodo cuyo texto empieza con «=», con el código dentro de
 * `{{ … }}`) las evalúa n8n con un sandbox restrictivo que bloquea, entre otras cosas, leer `prototype`, `__proto__` y
 * `constructor`, y que no expone `Function`, `eval`, `process`, `require`, `globalThis` ni `this`. Los nodos Code corren en
 * otro sandbox (el del task runner), con otras reglas: esta guardia NO mira `jsCode` (su texto no empieza con «=»).
 *
 * QUÉ DEVUELVE. `hallazgosDeExpresiones(flujo)` → lista de `{ nodo, ruta, regla, severidad, texto }`; vacía si el flujo está
 * limpio. `textosDeHallazgos(flujo)` → la misma lista en frases, para los `--verificar` de los armadores.
 * Para saber si una clave es propia DENTRO de una expresión: `Object.keys(o).indexOf(k) >= 0`.
 */

// Las reglas, sobre el CÓDIGO de la expresión (lo que va entre `{{` y `}}`) sin los literales de texto: una palabra dentro de
// comillas (`$getWorkflowStaticData('global')`) no cuenta.
export const REGLAS_DE_EXPRESION = [
  { regla: 'prototype', severidad: 'bloquea', re: /\b(prototype|__proto__|constructor)\b/, texto: 'lee «$1»: n8n rechaza la expresión («Cannot access … due to security concerns») y la ejecución muere' },
  { regla: 'eval', severidad: 'bloquea', re: /\b(Function|eval)\s*\(/, texto: 'llama a «$1(…)»: no existe en el sandbox de expresiones' },
  { regla: 'global', severidad: 'bloquea', re: /\b(globalThis|global|process|require|module|exports|Buffer)\b(?!\s*:)/, texto: 'usa «$1»: no existe en el sandbox de expresiones' },
  { regla: 'import', severidad: 'bloquea', re: /\bimport\s*\(/, texto: 'usa «import(…)»: no existe en el sandbox de expresiones' },
  { regla: 'this', severidad: 'bloquea', re: /\bthis\s*\./, texto: 'usa «this.»: en una expresión no hay `this`' },
  { regla: 'structuredClone', severidad: 'bloquea', re: /\b(structuredClone|queueMicrotask|setTimeout|setInterval|fetch)\s*\(/, texto: 'llama a «$1(…)»: no está en el sandbox de expresiones' },
];

/** El código de cada `{{ … }}` de un texto de expresión (que empieza con «=»). */
export function bloquesDeCodigo(texto) {
  const s = String(texto);
  if (!s.startsWith('=')) return [];
  const bloques = [];
  const re = /\{\{([\s\S]*?)\}\}(?!\})/g;
  let m;
  while ((m = re.exec(s)) !== null) bloques.push(m[1]);
  return bloques;
}

/** El código sin el contenido de los literales de texto ('…', "…", `…` sin interpolar) ni las expresiones regulares obvias. */
export function sinLiterales(codigo) {
  return String(codigo)
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

export function hallazgosDeExpresiones(flujo) {
  const h = [];
  const recorrer = (v, ruta, nodo) => {
    if (typeof v === 'string') {
      for (const bloque of bloquesDeCodigo(v)) {
        const codigo = sinLiterales(bloque);
        for (const r of REGLAS_DE_EXPRESION) {
          const m = r.re.exec(codigo);
          if (m) h.push({ nodo, ruta, regla: r.regla, severidad: r.severidad, texto: r.texto.replace('$1', m[1] || m[0]) });
        }
      }
    } else if (Array.isArray(v)) v.forEach((x, i) => recorrer(x, `${ruta}[${i}]`, nodo));
    else if (v && typeof v === 'object') for (const k of Object.keys(v)) recorrer(v[k], ruta ? `${ruta}.${k}` : k, nodo);
  };
  for (const n of (flujo && Array.isArray(flujo.nodes) ? flujo.nodes : [])) recorrer(n.parameters || {}, '', n.name);
  return h;
}

export function textosDeHallazgos(flujo) {
  return hallazgosDeExpresiones(flujo).map((x) => `la expresión de «${x.nodo}» (${x.ruta}) ${x.texto}`);
}
