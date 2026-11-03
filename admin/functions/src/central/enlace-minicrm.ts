/**
 * EL ENLACE A LA HOJA DEL miniCRM (03/11/2026). Función pura, sin dependencias: la usan el script de Plataforma que
 * lo escribe (`scripts/plataforma/crm-enlace.mjs`) y la Consola que pinta el botón «Abrir miniCRM».
 *
 * Una sola forma válida: `https://docs.google.com/spreadsheets/d/<id>[/…]`, sin usuario, sin puerto, sin espacios ni
 * caracteres de control, de hasta 300 caracteres. Cualquier otra cosa (otro dominio, `http:`, `javascript:`, un
 * subdominio parecido) no es un enlace a la hoja y no se escribe ni se pinta. Es una URL, nunca un secreto.
 */
export const LARGO_MAXIMO_ENLACE_HOJA = 300;

const FORMA = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]{10,100}(?:\/[A-Za-z0-9_\-./%?=&#]*)?$/;

export function esEnlaceDeHoja(v: unknown): v is string {
  if (typeof v !== 'string' || v.length === 0 || v.length > LARGO_MAXIMO_ENLACE_HOJA) return false;
  if (!FORMA.test(v)) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && u.hostname === 'docs.google.com' && u.username === '' && u.password === '' && u.port === '';
  } catch {
    return false;
  }
}

/** Lo que la Consola pinta: el enlace si es válido, o `null`. Nunca devuelve un valor que no pasó `esEnlaceDeHoja`. */
export function enlaceDeHojaVisible(v: unknown): string | null {
  return esEnlaceDeHoja(v) ? v : null;
}

/**
 * ¿Se ofrece el botón? Solo el administrador del comercio, con el miniCRM encendido (`config/crm.activo`; ausente =
 * encendido) y con un enlace válido. Sin enlace, o sin alguna de las tres, no hay botón.
 */
export function enlaceMiniCrmParaBoton(entrada: { esAdmin: boolean; crmActivo: unknown; enlace: unknown }): string | null {
  if (entrada.esAdmin !== true) return null;
  if (entrada.crmActivo === false) return null;
  return enlaceDeHojaVisible(entrada.enlace);
}
