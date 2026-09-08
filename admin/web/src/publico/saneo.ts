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

/**
 * El logo, que sí es un `data:` — pero solo de imagen.
 *
 * Es la excepción a la regla de abajo, y por eso está aparte en vez de aflojar
 * aquella: `data:image/png;base64,…` es una imagen y `data:text/html,…` es
 * ejecución, y la diferencia entre las dos es exactamente lo que comprueba esta
 * expresión. El servidor ya lo valida; acá se repite porque es el único otro
 * valor del comercio que no termina como texto.
 */
export function logoSeguro(valor: unknown): string {
  return typeof valor === 'string' && valor.length <= 200_000
    && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(valor)
    ? valor : '';
}

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

/** Precio para mostrar. Sin `Intl` pesado: dos decimales solo si hacen falta. */
export function precioTexto(precio: number | null, moneda: string): string {
  if (precio === null) return 'A consultar';
  const n = Number.isInteger(precio) ? String(precio) : precio.toFixed(2);
  return `${moneda === 'USD' ? '$' : 'Bs'} ${n}`;
}
