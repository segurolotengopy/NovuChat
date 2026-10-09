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
 * Origen: las funciones de normalización se copiaron LITERALES del prototipo
 * aprobado (`admin/web/src/central/lib/conversaciones.ts`, 09/10/2026). Se
 * agregaron las constantes de búsqueda y `prefijosValidos`.
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
/** Tope de palabras indexadas por mensaje (decisión D4 / D9). */
export const MAX_PALABRAS_POR_MENSAJE = 30;
/** Tope de palabras de una consulta del buscador. */
export const MAX_PALABRAS_CONSULTA = 6;
/** Tope de resultados de una búsqueda por texto. */
export const MAX_RESULTADOS_BUSQUEDA = 20;
/** Prefijo de país por defecto. En el servidor sale de `prefijosPermitidos` del tenant. */
export const PREFIJOS_PAIS_DEFECTO: readonly string[] = ['591'];

// ── Normalización ────────────────────────────────────────────────────────────

export function soloDigitos(s: unknown): string {
  return typeof s === 'string' ? s.replace(/\D+/g, '') : '';
}

/** Minúsculas y sin tildes ni eñes: «Salteñas» y «saltenas» son la misma palabra. */
export function normalizarTexto(s: unknown): string {
  if (typeof s !== 'string') return '';
  return s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

/**
 * La raíz de una palabra, con la regla más barata que sirve al español: quitar
 * la «s» o la «es» del plural. Sin esto, quien escribe «alfajor» no encuentra
 * «alfajores» y la búsqueda parece rota. No es un lematizador: es lo mínimo
 * que se puede repetir idéntico en el servidor.
 */
export function raizDe(palabra: string): string {
  if (palabra.length > 5 && palabra.endsWith('es')) return palabra.slice(0, -2);
  if (palabra.length > 3 && palabra.endsWith('s')) return palabra.slice(0, -1);
  return palabra;
}

/**
 * Las palabras a indexar de un texto: normalizadas, de 3 letras o más, con su
 * raíz, sin repetir y como mucho 30 (decisión D4). El orden es el de aparición.
 */
export function palabrasDe(texto: unknown, max = MAX_PALABRAS_POR_MENSAJE): string[] {
  const salida: string[] = [];
  const vistas = new Set<string>();
  for (const t of normalizarTexto(texto).split(/[^a-z0-9]+/)) {
    if (t.length < 3) continue;
    const r = raizDe(t);
    if (vistas.has(r)) continue;
    vistas.add(r);
    salida.push(r);
    if (salida.length >= max) break;
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

/** Un fragmento del texto alrededor de la primera palabra encontrada, para mostrar en el resultado. */
export function fragmento(texto: string, buscadas: readonly string[], ancho = 70): string {
  const limpio = texto.replace(/\s+/g, ' ').trim();
  if (limpio.length <= ancho) return limpio;
  const plano = normalizarTexto(limpio);
  let pos = -1;
  for (const p of buscadas) {
    const i = plano.indexOf(p);
    if (i >= 0 && (pos < 0 || i < pos)) pos = i;
  }
  if (pos < 0) return limpio.slice(0, ancho) + '…';
  const desde = Math.max(0, Math.min(pos - Math.floor(ancho / 3), limpio.length - ancho));
  return (desde > 0 ? '…' : '') + limpio.slice(desde, desde + ancho) + (desde + ancho < limpio.length ? '…' : '');
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
  if (Array.isArray(v) && v.length >= 1 && v.length <= 10 && v.every((p) => typeof p === 'string' && /^[0-9]{1,4}$/.test(p))) {
    return v.slice() as string[];
  }
  return PREFIJOS_PAIS_DEFECTO.slice();
}
