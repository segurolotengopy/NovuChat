/**
 * LO QUE PEDIDOS COMPARTE CON QUIEN ARMA UN PEDIDO (PR-4, mudanza sin cambio de
 * lógica). Antes vivía en `catalogo-web/catalogoWeb.ts`; Pedidos no puede
 * importar de Catálogo web (`fronteras.test.ts`), así que se muda aquí y
 * Catálogo web lo importa. Mismo cuerpo, mismas expresiones.
 */

/** Un ítem se puede comprar si tiene un precio numérico finito. */
export const sePuedeComprar = (d: Record<string, unknown> | undefined): boolean =>
  Number.isFinite(d?.['precio']);

/**
 * El identificador del ítem ES un segmento de ruta de Firestore. Que no pueda
 * traer barras ni puntos dobles no es cosmética: es lo que impide que un `id`
 * fabricado apunte a otro documento.
 */
export const idDeItemValido = (id: string): boolean =>
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(id) && !id.includes('..');

/**
 * UNA LÍNEA DE TEXTO LIBRE DEL CLIENTE, lista para guardar y para reenviar al
 * flujo (hoy, las referencias para llegar). A diferencia de `texto`, que solo
 * recorta, esta limpia:
 *
 *  - caracteres de control (saltos de línea, NUL), de formato (la marca de
 *    derecha a izquierda U+202E y compañía), surrogates sueltos, uso privado,
 *    separadores de línea y de párrafo, y `<`, `>` y `&`, se vuelven un espacio;
 *  - los enlaces (`http(s)://…`, `www.…`) se borran: una referencia para llegar
 *    no lleva enlaces, y un enlace en un mensaje de WhatsApp al repartidor es la
 *    forma más barata de colar un engaño;
 *  - los espacios se colapsan en uno;
 *  - se recorta por PUNTOS DE CÓDIGO, no por unidades UTF-16: `slice` partiría
 *    un emoji por la mitad y dejaría un carácter suelto e ilegible.
 *
 * Lo que no es texto da cadena vacía.
 */
export function lineaLimpia(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  // Tope previo solo para acotar el trabajo de las expresiones regulares sobre
  // un cuerpo hostil; el recorte que vale es el de abajo. Si el corte cae entre
  // las dos mitades de un emoji, se descarta la mitad que quedó, para no dejar
  // un surrogate suelto.
  let tope = v.slice(0, 1000);
  if (/[\ud800-\udbff]$/.test(tope)) tope = tope.slice(0, -1);
  const limpio = tope
    // Cs: surrogates sueltos; Co: uso privado. Ninguno es texto legible.
    .replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}<>&]/gu, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/www\.\S+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Bien formado por construcción: `\p{Cs}` con la bandera `u` solo casa los
  // surrogates SUELTOS (una pareja válida es un solo punto de código), y ya se
  // volvieron espacio arriba; el corte por puntos de código de abajo no parte
  // parejas. Es el equivalente de `toWellFormed()` sin U+FFFD y sin pedir la
  // biblioteca ES2024 que el `tsconfig` de Functions no declara.
  return Array.from(limpio).slice(0, max).join('').trim();
}

/** Decimales de la ubicación compartida (5 ≈ 1 m). */
const DECIMALES_UBICACION = 5;

/**
 * La ubicación de la entrega de un pedido tomado por WhatsApp, o null. Mismas
 * reglas que `ubicacionDelPedido` del checkout web (que sigue en Catálogo web,
 * donde sus pruebas leen la fuente): solo con envío, números finitos en rango,
 * 5 decimales, (0,0) se rechaza.
 */
export function ubicacionDeEntrega(
  u: unknown, entrega: string,
): { lat: number; lng: number } | null {
  if (entrega !== 'envio') return null;
  if (typeof u !== 'object' || u === null || Array.isArray(u)) return null;
  const { lat, lng } = u as Record<string, unknown>;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  const f = 10 ** DECIMALES_UBICACION;
  const redondea = (x: number): number => Math.round(x * f) / f + 0; // −0 → 0
  const la = redondea(lat);
  const ln = redondea(lng);
  if (la === 0 && ln === 0) return null;
  return { lat: la, lng: ln };
}
