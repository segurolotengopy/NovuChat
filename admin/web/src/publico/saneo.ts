/**
 * SANEO DEL LADO DEL NAVEGADOR.
 *
 * El servidor ya validó estos dos campos y esta capa NO lo reemplaza: lo
 * duplica a propósito. El motivo es que son los únicos dos valores del comercio
 * que no terminan como texto —uno va a un atributo `src`, el otro a una
 * propiedad de CSS— y para esos dos el costo de una segunda comprobación es
 * cuatro líneas. La regla del proyecto es que quien decide es el servidor; esto
 * es lo que hace que un despliegue con las dos mitades desincronizadas falle
 * hacia no pintar nada, en vez de hacia pintar cualquier cosa.
 */

/** `https://…` y nada más. `javascript:` y `data:` en un `src` son ejecución. */
export function imagenSegura(url: unknown): string {
  if (typeof url !== 'string' || url.length > 500) return '';
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.username === '' && u.password === '' ? url : '';
  } catch {
    return '';
  }
}

/**
 * Color de marca: exactamente `#rrggbb`.
 *
 * Va a `style={{ '--marca': color }}`. React no escapa el VALOR de una
 * propiedad personalizada de CSS —no puede, porque no sabe qué significa—, así
 * que un valor libre acá es una inyección de CSS: `#fff;background:url(…)`
 * filtraría la visita a un tercero sin ejecutar JavaScript. Seis hexadecimales
 * eliminan el problema en vez de intentar limpiarlo.
 */
export function colorSeguro(valor: unknown): string {
  return typeof valor === 'string' && /^#[0-9a-fA-F]{6}$/.test(valor) ? valor : '';
}

/** Precio para mostrar. Sin `Intl` pesado: dos decimales solo si hacen falta. */
export function precioTexto(precio: number | null, moneda: string): string {
  if (precio === null) return 'A consultar';
  const n = Number.isInteger(precio) ? String(precio) : precio.toFixed(2);
  return `${moneda === 'USD' ? '$' : 'Bs'} ${n}`;
}
