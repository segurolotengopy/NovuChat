/**
 * LA UBICACIÓN QUE EL CLIENTE COMPARTE AL PEDIR (delivery).
 *
 * El pedido del catálogo web puede traer `ubicacion: { lat, lng }`. Es un dato
 * que escribió el servidor a partir de lo que mandó un navegador ajeno, así que
 * la consola no se fía de él: acá se valida tipo y rango, y el enlace a Maps se
 * ARMA solo desde esos dos números, redondeados a 5 decimales (~1 m). Nunca se
 * usa un texto ni una URL que venga del pedido: un campo de texto con
 * `javascript:` o con un dominio ajeno no tiene por dónde entrar.
 *
 * Es OPCIONAL y compatible hacia atrás: un pedido sin el campo, o con algo que
 * no pasa la validación, devuelve `null` y la pantalla queda como siempre.
 *
 * Función pura, sin imports: la prueba está en
 * `pruebas/modulos/pedidos/ubicacion.test.ts`.
 */

export interface UbicacionValida { lat: number; lng: number }

const DECIMALES = 5;

/**
 * `null` si el valor no es `{ lat, lng }` de números finitos, con lat entre
 * -90 y 90, lng entre -180 y 180, y distinto de (0, 0) (el «punto nulo» que
 * dejan los clientes cuando no hubo lectura del GPS). Los números que
 * devuelve ya van redondeados a 5 decimales.
 */
export function ubicacionValida(valor: unknown): UbicacionValida | null {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return null;
  const { lat, lng } = valor as Record<string, unknown>;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  const la = Number(lat.toFixed(DECIMALES)) + 0; // «+ 0» vuelve 0 al -0
  const ln = Number(lng.toFixed(DECIMALES)) + 0;
  if (la === 0 && ln === 0) return null;
  return { lat: la, lng: ln };
}

/**
 * El enlace de Google Maps para esa ubicación, o `null` si no es válida.
 * Construido solo con dígitos, signo y punto de los dos números validados; la
 * coma del par va codificada (%2C), como lo documenta la API de enlaces de
 * Maps.
 */
export function enlaceAMaps(valor: unknown): string | null {
  const u = ubicacionValida(valor);
  if (!u) return null;
  return 'https://www.google.com/maps/search/?api=1&query='
    + `${u.lat.toFixed(DECIMALES)}%2C${u.lng.toFixed(DECIMALES)}`;
}

/**
 * El enlace de un pedido, o `null`. La ubicación solo importa cuando el pedido
 * va a domicilio. El servidor guarda `entrega: 'envio' | 'retiro'`
 * (`checkoutCatalogo`); `'delivery'` es el nombre que usan otras partes y se
 * acepta también. Un retiro en el local nunca muestra el enlace, aunque traiga
 * ubicación.
 */
export function enlaceDelPedido(p: { entrega?: unknown; ubicacion?: unknown }): string | null {
  if (p.entrega !== 'envio' && p.entrega !== 'delivery') return null;
  return enlaceAMaps(p.ubicacion);
}
