// Verificador de referencias de nodos (core, sin agente): cada $('Nodo') de las expresiones y del código nombra un nodo que existe y es antecesor; sin mezclar literales con dinámicas.
// Función pura: recibe un flujo (JSON de n8n), no depende de ningún constructor ni cliente.
/**
 * El task runner de n8n decide qué nodos precarga ESCANEANDO el código: un nodo con SOLO referencias dinámicas (`cnNodo(nombre)`, `$(variable)`) recibe todos; uno con algún literal `$('X')` recibe SOLO los nombrados
 * literalmente. Por eso: (1) todo literal `$('X')`, `$("X")`, `$node['X']`, `$items('X')` nombra un nodo que EXISTE y es ANTECESOR; (2) un nodo con al menos un literal NO puede alcanzar a otro nodo de forma dinámica o por
 * `cnNodo('Y')`/`cnPrimero('Y')`/`cnTodos('Y')` sin nombrar también `$('Y')` en un literal (un nodo MIXTO falla en n8n real). Los comentarios no cuentan. Se recorre el código (`jsCode`) y las expresiones `={{ … }}`.
 */
const REF_LITERAL = [/\$\(\s*(['"])((?:(?!\1).)+)\1\s*\)/g, /\$node\[\s*(['"])((?:(?!\1).)+)\1\s*\]/g, /\$items\(\s*(['"])((?:(?!\1).)+)\1/g];
const REF_AYUDA = /(?<!function\s)\bcn(?:Nodo|Primero|Todos)\(\s*(['"])((?:(?!\1).)+)\1/g;
const REF_DINAMICA = [/\$\(\s*(?!['"\s])/, /\$node\[\s*(?!['"\s])/, /\$items\(\s*(?!['"\s])/, /(?<!function\s)\bcn(?:Nodo|Primero|Todos)\(\s*(?!['"\s])/];
const sinComentariosDeCodigo = (codigo) => codigo.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\w'"`])\/\/[^\n]*/g, '$1 ');
function cadenasDe(v, campo = '') {
  if (typeof v === 'string') return [{ campo, texto: v }];
  if (Array.isArray(v)) return v.flatMap((x) => cadenasDe(x, campo));
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => cadenasDe(x, k));
  return [];
}
/** Por nodo: los nombres literales (`literales`), los alcanzados por las funciones `cn*` con literal (`ayuda`) y si hay alguna referencia dinámica (`dinamica`). */
export function referenciasDeNodos(nodos) {
  return (Array.isArray(nodos) ? nodos : []).map((n) => {
    const literales = []; const ayuda = []; let dinamica = false;
    for (const { campo, texto } of cadenasDe(n.parameters || {})) {
      const t = campo === 'jsCode' ? sinComentariosDeCodigo(texto) : texto;
      if (campo !== 'jsCode' && !t.startsWith('=')) continue;
      for (const re of REF_LITERAL) for (const m of t.matchAll(new RegExp(re.source, 'g'))) literales.push(m[2]);
      for (const m of t.matchAll(new RegExp(REF_AYUDA.source, 'g'))) ayuda.push(m[2]);
      if (REF_DINAMICA.some((re) => re.test(t))) dinamica = true;
    }
    return { nodo: n.name, literales, ayuda, dinamica };
  });
}
/** Los antecesores de cada nodo en el grafo de conexiones: Map nombre → Set de nombres. */
export function antecesoresDe(flujo) {
  const padres = new Map((flujo.nodes || []).map((n) => [n.name, new Set()]));
  for (const [de, salidas] of Object.entries(flujo.connections || {})) for (const salida of (salidas.main || [])) for (const c of (salida || [])) if (padres.has(c.node)) padres.get(c.node).add(de);
  const todos = new Map();
  for (const n of flujo.nodes || []) {
    const vistos = new Set(); const pila = [...padres.get(n.name)];
    while (pila.length) { const x = pila.pop(); if (vistos.has(x)) continue; vistos.add(x); pila.push(...(padres.get(x) || [])); }
    todos.set(n.name, vistos);
  }
  return todos;
}
/** Los problemas de referencias de un flujo (lista vacía si está limpio). Reutilizable: sirve para cualquier JSON de flujo. */
export function problemasDeReferencias(flujo) {
  const existen = new Set((flujo.nodes || []).map((n) => n.name));
  const antes = antecesoresDe(flujo);
  const p = [];
  for (const r of referenciasDeNodos(flujo.nodes)) {
    for (const nombre of r.literales) {
      if (!existen.has(nombre)) p.push(`«${r.nodo}» nombra «${nombre}», que NO existe en este flujo`);
      else if (!antes.get(r.nodo).has(nombre)) p.push(`«${r.nodo}» nombra «${nombre}», que existe pero NO es su antecesor en el grafo`);
    }
    if (r.literales.length) {
      if (r.dinamica) p.push(`«${r.nodo}» mezcla referencias literales con referencias dinámicas a otros nodos: n8n solo precarga los nombrados con literal`);
      for (const y of new Set(r.ayuda)) if (!r.literales.includes(y)) p.push(`«${r.nodo}» alcanza «${y}» por cn*() sin nombrarlo también con $('${y}') literal: n8n no lo precargaría`);
    }
  }
  return p;
}
