/**
 * EL NÚMERO PÚBLICO DE LA LÍNEA DEL NEGOCIO (`rutasWhatsApp/<phoneNumberId>.numeroPublico`).
 *
 * Es el número que el negocio ya publica como su WhatsApp, para que el cliente
 * vuelva al chat con `https://wa.me/<número>`. Solo viaja si es una cadena de 8 a
 * 15 dígitos, sin `+` ni espacios y sin cero inicial; cualquier otra cosa
 * devuelve `''`. Es la misma forma que valida el navegador (`enlaceAlChat`) y que
 * exige `admin/scripts/modulos/catalogo-web/fijar-numero-publico.mjs`.
 *
 * Vive en core porque lo usan dos zonas: el catálogo web (lo lee para el enlace)
 * y la coordinadora de la ingesta (lo fija la primera vez que llega un mensaje
 * verificado a la línea). Core no depende de nada.
 */
const NUMERO_PUBLICO = /^[1-9][0-9]{7,14}$/;

export function numeroPublicoValido(valor: unknown): string {
  return typeof valor === 'string' && NUMERO_PUBLICO.test(valor) ? valor : '';
}

/**
 * El número que Meta informa para la línea (`metadata.display_phone_number`,
 * p. ej. `+591 7xxx xxxx`) llevado a la forma pública: se quita todo lo que no
 * sea dígito y se aplican LAS MISMAS reglas que el script de fijado a mano:
 * forma válida; nunca un número local boliviano de 8 dígitos (empieza en 6 o 7),
 * porque sin el 591 el enlace llevaría a otro país; y si empieza por 591,
 * exactamente 11 dígitos. Si no cumple devuelve `''`.
 */
export function numeroPublicoDesdeMeta(crudo: unknown): string {
  if (typeof crudo !== 'string') return '';
  const digitos = crudo.replace(/[^0-9]/g, '');
  if (numeroPublicoValido(digitos) === '') return '';
  if (/^[67][0-9]{7}$/.test(digitos)) return '';
  if (digitos.startsWith('591') && digitos.length !== 11) return '';
  return digitos;
}
