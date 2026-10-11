/**
 * =============================================================================
 * CONVERSACIONES: LA NORMALIZACIÓN, UNA SOLA PARA TODOS (CORE)
 * =============================================================================
 *
 * La regla que convierte un teléfono en «trozos» y un texto en «palabras» tiene
 * que ser LA MISMA en cuatro lugares: la ingesta que escribe `telefonoTrozos[]`
 * y `palabras[]`, la callable que busca, la consola que filtra en pantalla y los
 * scripts de relleno. Si una de las cuatro la cambia por su cuenta, la búsqueda
 * deja de encontrar lo que ya está guardado y nadie se entera. Por eso vive en
 * Core (lo que todo tenant corre igual) y en un solo archivo.
 *
 * Origen: las funciones de normalización salen del prototipo aprobado
 * (`admin/web/src/central/lib/conversaciones.ts`, 09/10/2026). Se agregaron las
 * constantes de búsqueda y `prefijosValidos`, y se cambiaron A PROPÓSITO dos
 * cosas respecto del prototipo: `raizDe` (también quita la «e» final, para que
 * «chocolate» y «chocolates» sean la misma palabra) y `normalizarTexto` (NFKD
 * en lugar de NFD, para que «ﬁesta» indexe «fiesta» y el ancho completo no se
 * pierda).
 *
 * REGLA CONGELADA DESDE H1-6: desde que la ingesta guarda `palabras[]`, cambiar
 * `raizDe`, `normalizarTexto` o `palabrasDe` deja sin hallar todo lo ya
 * indexado. Cambiarla exige rellenar los mensajes guardados. La prueba de
 * corpus fijo de `conversacion-normalizacion.test.ts` la congela.
 *
 * SIN `import`, SIN `enum`, SIN `namespace`, A PROPÓSITO: los scripts `.mjs`
 * (relleno, siembra) lo cargan con Node y `--experimental-strip-types`, que solo
 * quita los tipos; no hay empaquetador de por medio. La consola lo importa por
 * ruta relativa. Core no depende de nada, y este archivo menos. La prueba
 * `conversacion-normalizacion.test.ts` lo hace cumplir.
 *
 * LA UNIDAD ES LA CONVERSACIÓN, NO LA «ATENCIÓN» (CLAUDE.md, vocabulario).
 */

// ── Constantes de producto ───────────────────────────────────────────────────

/** Ventana de servicio de Meta: se responde libremente hasta 24 h después del último mensaje del cliente. */
export const VENTANA_HORAS = 24;
/** «Ventana por vencer»: le quedan menos de estas horas. */
export const POR_VENCER_HORAS = 6;
/** Mínimo de dígitos para buscar por teléfono: con menos, casi todo coincide con casi todo. */
export const MINIMO_DIGITOS = 4;
/** Tope de palabras indexadas por mensaje (decisión D9 del plan H1). */
export const MAX_PALABRAS_POR_MENSAJE = 30;
/** Tope de palabras de una consulta del buscador. El nombre del contacto usa `palabrasDe(nombre, 6)` (decisión D4). */
export const MAX_PALABRAS_CONSULTA = 6;
/** Tope de resultados de una búsqueda por texto. */
export const MAX_RESULTADOS_BUSQUEDA = 20;
/** Prefijo de país por defecto. En el servidor sale de `prefijosPermitidos` del tenant. */
export const PREFIJOS_PAIS_DEFECTO: readonly string[] = Object.freeze(['591']);

// ── Normalización ────────────────────────────────────────────────────────────

export function soloDigitos(s: unknown): string {
  return typeof s === 'string' ? s.replace(/\D+/g, '') : '';
}

/**
 * Minúsculas y sin tildes ni eñes: «Salteñas» y «saltenas» son la misma palabra.
 * NFKD (y no NFD) también descompone las ligaduras y el ancho completo:
 * «ﬁesta» pasa a «fiesta» y «ＡＢＣ» a «abc». CONGELADA desde H1-6.
 */
export function normalizarTexto(s: unknown): string {
  if (typeof s !== 'string') return '';
  return s.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase();
}

/**
 * La raíz de una palabra, con la regla más barata que sirve al español: quitar
 * la «s» final y luego la «e» final, cada paso solo si la palabra queda con
 * más de 3 letras (no se come las cortas: «mes», «pan», «dos», «mas»). Con eso
 * «alfajor» y «alfajores», «flor» y «flores», «chocolate» y «chocolates», «pan»
 * y «panes» son la misma palabra, y la búsqueda no parece rota. No es un
 * lematizador: es lo mínimo que se puede repetir idéntico en el servidor.
 * CONGELADA desde H1-6: cambiarla exige rellenar los mensajes ya indexados.
 */
export function raizDe(palabra: string): string {
  let r = palabra;
  if (r.length > 3 && r.endsWith('s')) r = r.slice(0, -1);
  if (r.length > 3 && r.endsWith('e')) r = r.slice(0, -1);
  return r;
}

/**
 * Las palabras a indexar de un texto: normalizadas, de 3 letras o más, con su
 * raíz, sin repetir y como mucho 30 (decisión D9). El orden es el de aparición.
 */
export function palabrasDe(texto: unknown, max: number = MAX_PALABRAS_POR_MENSAJE): string[] {
  if (!(max >= 1)) return []; // 0, negativos, NaN, null: nada que indexar
  const tope = Math.floor(max);
  const salida: string[] = [];
  const vistas = new Set<string>();
  for (const t of normalizarTexto(texto).split(/[^a-z0-9]+/)) {
    if (t.length < 3) continue;
    const r = raizDe(t);
    if (vistas.has(r)) continue;
    vistas.add(r);
    salida.push(r);
    if (salida.length >= tope) break;
  }
  return salida;
}

/**
 * Los «trozos» de un teléfono: todos sus finales de 4 dígitos o más. Con un
 * `array-contains` sobre esta lista se halla un número por los últimos 4, por
 * los últimos 8 («sin prefijo») o completo, sin que Firestore sepa buscar
 * dentro de una cadena.
 */
export function trozosDeTelefono(telefono: unknown): string[] {
  const d = soloDigitos(telefono);
  const trozos: string[] = [];
  for (let i = 0; i + MINIMO_DIGITOS <= d.length; i++) trozos.push(d.slice(i));
  return trozos;
}

/**
 * ¿El mensaje contiene TODAS las palabras buscadas? `palabras` es lo que la
 * consulta ya normalizó con `palabrasDe`. Es la segunda pasada de una búsqueda de
 * varias palabras: el índice (`array-contains`) solo puede preguntar por una.
 */
export function mensajeContiene(mensajePalabras: readonly string[] | undefined, texto: unknown, buscadas: readonly string[]): boolean {
  if (!buscadas.length) return false;
  const tiene = new Set(mensajePalabras && mensajePalabras.length ? mensajePalabras : palabrasDe(texto));
  return buscadas.every((p) => tiene.has(p));
}

/** La palabra por la que preguntarle al índice: la más larga, que es la más selectiva. */
export function palabraParaIndice(palabras: readonly string[]): string | null {
  let mejor: string | null = null;
  for (const p of palabras) if (mejor === null || p.length > mejor.length) mejor = p;
  return mejor;
}

/** Los primeros `n` caracteres, sin dejar la mitad de un par sustituto (un emoji) al final. */
function cortarSinPartirPar(s: string, n: number): string {
  const c = s.slice(0, n);
  const ultimo = c.charCodeAt(c.length - 1);
  return c.length < s.length && ultimo >= 0xd800 && ultimo <= 0xdbff ? c.slice(0, -1) : c;
}

/**
 * Un fragmento del texto alrededor de la primera palabra encontrada, para
 * mostrar en el resultado. Nunca devuelve más de `ancho` caracteres, contando
 * los «…» de los extremos.
 *
 * La palabra se busca en el texto normalizado, pero la ventana se corta en el
 * ORIGINAL. NFKD no conserva las posiciones («…» pasa a «...», que son tres
 * caracteres; un ❤️ pierde su selector U+FE0F; «ﬁ» pasa a «fi»), así que el
 * texto plano se arma punto de código por punto de código y se guarda, para
 * cada carácter plano, el índice del carácter original de donde salió. Así la
 * ventana cae sobre la palabra aunque el texto traiga cientos de esos símbolos.
 * Solo se recorre un texto más largo que `ancho`.
 *
 * Los extremos no parten un par sustituto (un emoji): se corre un carácter
 * hacia adentro. Cuando la palabra queda al final del texto, la ventana se
 * apoya en el final (con el «…» inicial ocupando su lugar) y no deja un «…»
 * final falso que corte la palabra.
 */
export function fragmento(texto: string, buscadas: readonly string[], ancho = 70): string {
  if (typeof texto !== 'string' || !(ancho >= 1)) return '';
  const limpio = texto.replace(/\s+/g, ' ').trim();
  if (limpio.length <= ancho) return limpio;
  if (ancho < 3) return cortarSinPartirPar(limpio, Math.floor(ancho));

  // Texto plano (como `normalizarTexto`) con el índice de origen de cada carácter.
  let plano = '';
  const origen: number[] = [];
  let u = 0;
  for (const c of limpio) {
    const n = normalizarTexto(c);
    for (let k = 0; k < n.length; k++) origen.push(u);
    plano += n;
    u += c.length;
  }
  let pos = -1;
  for (const p of buscadas) {
    if (!p) continue;
    const i = plano.indexOf(p);
    if (i >= 0 && (pos < 0 || i < pos)) pos = i;
  }
  if (pos < 0) return cortarSinPartirPar(limpio, ancho - 1) + '…';

  const aqui = origen[pos] ?? 0; // dónde está la palabra en el texto ORIGINAL
  let desde = Math.max(0, aqui - Math.floor(ancho / 3));
  if (desde > 0) {
    // La palabra entera, si cabe: se corre la ventana hacia la derecha lo justo
    // (sin pasar de la palabra, y dejando lugar para el «…» de los extremos).
    const fin = aqui + (/^[\p{L}\p{N}]*/u.exec(limpio.slice(aqui))?.[0].length ?? 0);
    desde = Math.min(Math.max(desde, fin - (ancho - 2)), aqui);
    // Con «…» inicial la ventana tiene `ancho - 1` caracteres de texto: si la
    // palabra queda al final, el texto llega hasta el último carácter.
    desde = Math.min(desde, limpio.length - (ancho - 1));
  }
  const esSustitutoBajo = (i: number) => { const c = limpio.charCodeAt(i); return c >= 0xdc00 && c <= 0xdfff; };
  const esSustitutoAlto = (i: number) => { const c = limpio.charCodeAt(i); return c >= 0xd800 && c <= 0xdbff; };
  if (desde > 0 && esSustitutoBajo(desde)) desde += 1;
  const pre = desde > 0 ? 1 : 0;
  let hasta = Math.min(limpio.length, desde + ancho - pre);
  if (hasta < limpio.length) {
    hasta -= 1; // el «…» final ocupa un lugar
    if (hasta > desde && esSustitutoAlto(hasta - 1)) hasta -= 1;
  }
  return (pre ? '…' : '') + limpio.slice(desde, hasta) + (hasta < limpio.length ? '…' : '');
}

// ── Prefijos de país del tenant ──────────────────────────────────────────────

/**
 * Los prefijos de país que se aceptan al buscar por teléfono: una lista de 1 a
 * 10 elementos, cada uno de 1 a 4 dígitos. Cualquier otra cosa (ausente, vacía,
 * demasiado larga, con letras, un objeto) devuelve el prefijo por defecto, y no
 * se intenta «arreglar» a medias: un dato que viene de un documento que otro
 * pudo escribir no se interpreta, se descarta.
 */
export function prefijosValidos(v: unknown): string[] {
  if (Array.isArray(v) && v.length >= 1 && v.length <= 10 && [...v].every((p) => typeof p === 'string' && /^[0-9]{1,4}$/.test(p))) {
    return v.slice() as string[];
  }
  return PREFIJOS_PAIS_DEFECTO.slice();
}
