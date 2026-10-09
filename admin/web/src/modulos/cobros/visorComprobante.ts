/**
 * VISOR DE COMPROBANTES — la parte pura (sin React, sin red).
 *
 * El comprobante que mandó el cliente se guarda 90 días en Storage y SOLO lo
 * entrega la callable `verComprobante` (auditada y con tope): devuelve
 * `{mime, base64}` y nada más. La consola lo muestra así:
 *
 *  - IMAGEN: `<img src="data:image/(jpeg|png|webp);base64,…">`, y únicamente con
 *    un MIME de la lista cerrada. Un SVG o un HTML con el MIME cambiado no pasa.
 *  - PDF: nunca se abre en una pestaña ni en un marco; se baja como archivo
 *    (Blob de tipo fijo + enlace de descarga) con el aviso de que lo mandó el
 *    cliente. Un PDF puede traer código activo: lo abre el lector del usuario.
 *
 * Los textos hablan de DATOS y de CONSERVACIÓN, nunca de dinero recibido: una
 * imagen se edita, y quien confirma que el dinero entró es el banco y el negocio
 * (prohibición 3 de CLAUDE.md).
 *
 * Los errores se muestran por `e.code`, jamás por `e.message`: el mensaje del
 * servidor es un contrato del servidor y el de una librería puede traer rutas.
 */

/** Lista cerrada de imágenes que la consola dibuja. */
export const MIMES_DE_IMAGEN = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MIME_DE_PDF = 'application/pdf';

/** Lo que muestra el modal tras un PDF bajado. */
export const AVISO_PDF = 'Archivo enviado por el cliente; ábralo con un lector actualizado.';

export const NOMBRE_DEL_PDF = 'comprobante.pdf';

/**
 * ¿Este cierre tiene un comprobante que se pueda pedir? Solo las ventas cotejadas
 * con calidad «valido» o «aproximado»: el servidor aplica la misma regla, esta
 * solo evita ofrecer un botón que siempre fallaría.
 */
export function puedeVerComprobante(
  c: { id?: unknown; cotejo?: { calidad?: unknown } | null },
): boolean {
  if (typeof c.id !== 'string' || !c.id.startsWith('venta_')) return false;
  const cotejo = c.cotejo;
  if (typeof cotejo !== 'object' || cotejo === null) return false;
  return cotejo.calidad === 'valido' || cotejo.calidad === 'aproximado';
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** `src` de la imagen, o `null` si el MIME no es de la lista cerrada o el base64 no es base64. */
export function srcDeImagen(mime: unknown, base64: unknown): string | null {
  if (typeof mime !== 'string' || typeof base64 !== 'string') return null;
  if (!(MIMES_DE_IMAGEN as readonly string[]).includes(mime)) return null;
  if (!BASE64.test(base64)) return null;
  return `data:${mime};base64,${base64}`;
}

/** Bytes de un base64, o `null` si no lo es. Para armar el Blob del PDF. */
export function bytesDeBase64(base64: unknown): Uint8Array | null {
  if (typeof base64 !== 'string' || !BASE64.test(base64)) return null;
  try {
    const binario = atob(base64);
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** Qué hacer con una respuesta del servidor. */
export type ClaseDeRespuesta = 'imagen' | 'pdf' | 'invalida';

export function claseDeRespuesta(mime: unknown): ClaseDeRespuesta {
  if (typeof mime !== 'string') return 'invalida';
  if ((MIMES_DE_IMAGEN as readonly string[]).includes(mime)) return 'imagen';
  if (mime === MIME_DE_PDF) return 'pdf';
  return 'invalida';
}

const TEXTO_GENERICO = 'No se pudo abrir el comprobante. Intente de nuevo en unos minutos.';

/** Texto para el usuario según el `code` del error de la callable. */
export function textoDeError(code: unknown): string {
  switch (code) {
    case 'functions/unauthenticated':
      return 'No se pudo comprobar su sesión. Recargue la página e inicie sesión de nuevo.';
    case 'functions/permission-denied':
      return 'No tiene permiso para ver este comprobante.';
    case 'functions/not-found':
      return 'No hay un comprobante guardado para este cobro. Se conserva hasta 90 días desde que llegó.';
    case 'functions/failed-precondition':
    case 'functions/invalid-argument':
      return 'Este comprobante no se puede mostrar desde la consola.';
    case 'functions/resource-exhausted':
      return 'Alcanzó el máximo de comprobantes que se pueden ver: 30 por hora y 100 por día. Vuelva a intentar más tarde.';
    default:
      return TEXTO_GENERICO;
  }
}

/** Los tres párrafos del detalle de un cobro con comprobante. */
export function textosDelVisor(calidad: unknown, esAdmin: boolean): string[] {
  return [
    'El comprobante se conserva hasta 90 días desde que llegó, como evidencia.',
    // Solo «valido» dice «coinciden» a secas; cualquier otra calidad, aproximada.
    calidad === 'valido'
      ? 'Los datos coinciden con el pedido.'
      : 'Los datos coinciden de forma aproximada.',
    esAdmin
      ? 'Que el dinero entró lo confirma su banco; márquelo como comprobado cuando lo vea.'
      : 'Que el dinero entró lo confirma su banco; el administrador lo marca como comprobado.',
  ];
}
