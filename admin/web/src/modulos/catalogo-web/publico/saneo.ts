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

/**
 * El enlace para volver al chat del negocio: `https://wa.me/<número>`, SIN texto
 * precargado (un texto crearía un mensaje entrante más, y cada mensaje cuesta).
 *
 * Es la tercera valla del mismo patrón: el valor viene de la red y termina en
 * un `href` y en una navegación, así que se acepta SOLO una cadena de entre 8 y
 * 15 dígitos, sin ceros a la izquierda (el máximo de E.164). Ni `+`, ni espacios,
 * ni `javascript:` ni nada que una persona haya escrito con otra forma: si no es
 * exactamente eso, devuelve `''` y la página no ofrece el botón. El host y el
 * esquema son fijos: del valor entran únicamente dígitos.
 */
export function enlaceAlChat(numero: unknown): string {
  return typeof numero === 'string' && /^[1-9][0-9]{7,14}$/.test(numero)
    ? `https://wa.me/${numero}` : '';
}

/** Decimales de la ubicación compartida; el servidor aplica los mismos (5). */
export const DECIMALES_UBICACION = 5;

/**
 * Las coordenadas que entrega el navegador, o `null` si no sirven.
 *
 * Es la MISMA regla que `ubicacionDelPedido` del servidor (que no confía en
 * esto): números finitos —no cadenas—, latitud −90..90, longitud −180..180,
 * redondeo a 5 decimales (−0 pasa a 0) y (0,0) rechazado. Un cambio acá exige
 * el mismo cambio allá, en el flujo (`_pdUbicacion`) y en la prueba.
 */
export function coordenadasValidas(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  const f = 10 ** DECIMALES_UBICACION;
  const la = Math.round(lat * f) / f + 0;
  const ln = Math.round(lng * f) / f + 0;
  if (la === 0 && ln === 0) return null;
  return { lat: la, lng: ln };
}

/** Precio para mostrar. Sin `Intl` pesado: dos decimales solo si hacen falta. */
export function precioTexto(precio: number | null, moneda: string): string {
  if (precio === null) return 'A consultar';
  const n = Number.isInteger(precio) ? String(precio) : precio.toFixed(2);
  return `${moneda === 'USD' ? '$' : 'Bs'} ${n}`;
}
