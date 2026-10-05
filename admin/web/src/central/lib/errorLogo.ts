/**
 * LO QUE EL COMERCIO LEE CUANDO FALLA EL LOGO. Módulo puro (sin React ni
 * Firebase en ejecución): `LogoDelComercio` lo usa en el `catch` de elegir y de
 * quitar el logo, y la prueba lo ejercita sin pantalla.
 *
 * El criterio es el de `Analisis/41` §4quindecies: la consola nunca da un
 * mensaje genérico donde se puede decir la causa, y nunca deja pasar el texto
 * crudo del SDK («Missing or insufficient permissions»), que no le dice nada a
 * quien tiene un negocio. La causa se lee por FORMA (`error.code`), sin
 * importar `FirebaseError`: así el módulo no arrastra el SDK a la prueba.
 *
 * Los errores propios de la imagen (no se pudo leer, pesa demasiado, el
 * navegador no tiene lienzo) se distinguen por CLASE, no comparando textos: un
 * texto cambia con el idioma o con una edición, la clase no.
 */

export type CausaDeImagen = 'ilegible' | 'pesada' | 'sin-lienzo';

/** Un fallo de la imagen misma, antes de llegar al servidor. */
export class ErrorDeImagen extends Error {
  readonly causa: CausaDeImagen;
  constructor(causa: CausaDeImagen) {
    super(`Error de imagen: ${causa}`);
    this.name = 'ErrorDeImagen';
    this.causa = causa;
  }
}

const TEXTO_POR_CAUSA: Record<CausaDeImagen, string> = {
  ilegible: 'No pudimos leer ese archivo como imagen. Sube un PNG, JPG o WebP '
    + '(no un PDF ni una captura de otro formato). Si es de WhatsApp o de un '
    + 'PDF, guárdalo primero como imagen.',
  pesada: 'Esa imagen es demasiado pesada incluso reducida. '
    + 'Intenta con una más simple o con menos detalle.',
  'sin-lienzo': 'El navegador no pudo procesar la imagen.',
};

export const TEXTO_SIN_PERMISO = 'No tienes permiso para cambiar el logo. Solo lo cambia la '
  + 'persona administradora del negocio, y el catálogo web tiene que estar incluido en tu plan. '
  + 'Si eres administradora y sigue igual, avísanos.';
export const TEXTO_SIN_CONEXION = 'No hay conexión con el servidor. Revisa tu internet e intenta de nuevo.';
export const TEXTO_SESION_VENCIDA = 'Tu sesión venció. Entra de nuevo e intenta otra vez.';
export const TEXTO_TAMANO_RECHAZADO = 'El servidor rechazó el tamaño del logo. Prueba con una imagen más simple.';
export const TEXTO_GENERICO = 'No se pudo guardar el logo. Intenta de nuevo; si sigue igual, avísanos.';

/** `error.code` si lo hay, sin el prefijo `firestore/` que a veces trae el SDK. */
function codigoDe(error: unknown): string {
  if (typeof error !== 'object' || error === null) return '';
  const codigo = (error as { code?: unknown }).code;
  return typeof codigo === 'string' ? codigo.replace(/^firestore\//, '') : '';
}

export function mensajeDeErrorDeLogo(error: unknown): string {
  if (error instanceof ErrorDeImagen) return TEXTO_POR_CAUSA[error.causa];
  switch (codigoDe(error)) {
    case 'permission-denied': return TEXTO_SIN_PERMISO;
    case 'unavailable':
    case 'deadline-exceeded': return TEXTO_SIN_CONEXION;
    case 'unauthenticated': return TEXTO_SESION_VENCIDA;
    case 'resource-exhausted':
    case 'invalid-argument': return TEXTO_TAMANO_RECHAZADO;
    default: return TEXTO_GENERICO;
  }
}
