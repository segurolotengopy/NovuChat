/**
 * Descubre, en el TEXTO de `sembrar-demos.mjs`, los ids de los demos de venta.
 *
 * Es un módulo aparte para poder probarlo con un texto de formato cambiado sin
 * ejecutar la siembra. Falla CERRADO: si la cantidad de `id:` y de `vertical:`
 * (a 4 espacios de sangría) no coincide, o no se encuentra ninguno de venta,
 * lanza un error en vez de adivinar. La búsqueda de `vertical:` se detiene en
 * el cierre del objeto (`  }`), así un `id` sin `vertical` no toma el de la
 * entrada siguiente.
 */
export function descubrirDemosDeVenta(texto) {
  const ids = [...texto.matchAll(/^ {4}id: '[a-z0-9-]+',/gm)].length;
  const verticales = [...texto.matchAll(/^ {4}vertical: '\w+'/gm)].length;
  if (ids === 0 || ids !== verticales) {
    throw new Error(`formato inesperado en sembrar-demos.mjs (${ids} id, ${verticales} vertical)`);
  }
  const pares = [...texto.matchAll(
    /^ {4}id: '([a-z0-9-]+)',(?:(?!^ {2}\})[\s\S])*?^ {4}vertical: '(\w+)'/gm)];
  if (pares.length !== ids) {
    throw new Error('formato inesperado en sembrar-demos.mjs (un id sin su vertical)');
  }
  const venta = pares.filter((m) => m[2] === 'venta').map((m) => m[1]);
  if (!venta.length) throw new Error('ningún demo de venta en sembrar-demos.mjs');
  return venta;
}
