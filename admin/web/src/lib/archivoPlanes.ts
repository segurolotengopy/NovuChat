/**
 * =============================================================================
 * EL ARCHIVO DE PLANES DE «CAPTACIÓN», ANTES Y DESPUÉS DE SUBIRLO
 * =============================================================================
 *
 * Con más de cinco planes el asistente de captación no los recita: manda un PDF
 * o una imagen por WhatsApp. Hasta el 15/09 el comercio pegaba un enlace a un
 * archivo publicado en otro lado; desde ahora también lo puede subir a Storage.
 *
 * EL CONTRATO CON `admin/storage.rules` (la regla es la que manda):
 *   - una sola ruta por comercio, `tenants/{id}/captacion/planes.{pdf|jpg|png}`,
 *     con nombre FIJO: subir de nuevo reemplaza, y no se acumulan versiones;
 *   - PDF hasta 10 MB; JPEG o PNG hasta 5 MB;
 *   - el `contentType` coincide con la extensión.
 *
 * ESTE MÓDULO REPITE ESOS LÍMITES EN EL NAVEGADOR, ANTES DE SUBIR. No es la
 * defensa —quien arma la petición a mano se salta todo esto— sino el aviso
 * (base comercial §7): que el comercio no espere a que suban 12 MB por datos
 * móviles para enterarse de que no entraban, y que el motivo se lea en
 * castellano y no como «storage/unauthorized».
 *
 * LA EXTENSIÓN Y LOS PRIMEROS BYTES, LAS DOS COSAS. La extensión dice qué
 * DICE ser el archivo; los primeros bytes, qué ES. Un «planes.pdf» que en
 * realidad es un .docx renombrado pasaría la regla (que solo ve el
 * `contentType` que declaramos nosotros) y le llegaría al prospecto como un
 * PDF que no abre. Las firmas son las mismas que usa `firmaCoincide` de
 * `functions/src/captacion.ts`, para que lo que acepta la pantalla no lo
 * rechace después «Comprobar archivo».
 */

export type TipoArchivo = 'pdf' | 'imagen';
export type ExtensionPlanes = 'pdf' | 'jpg' | 'png';

interface Formato {
  contentType: string;
  tipo: TipoArchivo;
  tope: number;
  firma: readonly number[];
  /** Cómo se le nombra a la persona. */
  rotulo: string;
}

const MB = 1024 * 1024;

export const FORMATOS: Record<ExtensionPlanes, Formato> = {
  pdf: { contentType: 'application/pdf', tipo: 'pdf', tope: 10 * MB, rotulo: 'PDF',
    firma: [0x25, 0x50, 0x44, 0x46, 0x2d] },                                   // %PDF-
  jpg: { contentType: 'image/jpeg', tipo: 'imagen', tope: 5 * MB, rotulo: 'JPG',
    firma: [0xff, 0xd8, 0xff] },
  png: { contentType: 'image/png', tipo: 'imagen', tope: 5 * MB, rotulo: 'PNG',
    firma: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
};

export const EXTENSIONES = Object.keys(FORMATOS) as ExtensionPlanes[];

/** Lo que ofrece el diálogo de elegir archivo. Es comodidad: se valida igual. */
export const ACEPTA = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';

export const rutaArchivoPlanes = (tenantId: string, ext: ExtensionPlanes) =>
  `tenants/${tenantId}/captacion/planes.${ext}`;

/** `.jpeg` es el mismo formato que `.jpg`: se guarda con un solo nombre. */
export function extensionDe(nombre: string): ExtensionPlanes | null {
  const e = /\.([A-Za-z0-9]+)$/.exec(nombre.trim())?.[1]?.toLowerCase() ?? '';
  if (e === 'pdf') return 'pdf';
  if (e === 'jpg' || e === 'jpeg') return 'jpg';
  if (e === 'png') return 'png';
  return null;
}

/**
 * ¿La dirección apunta al archivo que subió la consola? Sirve para no
 * ofrecer cambiar el «tipo» de un archivo cuyo tipo fijó la subida.
 */
export function esDelDeposito(url: string): boolean {
  return /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o\/tenants%2F[^%]+%2Fcaptacion%2Fplanes\.(pdf|jpg|png)\?/
    .test(url);
}

/** El nombre con el que le llega al prospecto: el original, hasta 80 caracteres. */
export function nombreParaProspecto(nombre: string, ext: ExtensionPlanes): string {
  const limpio = nombre.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (limpio.length <= 80) return limpio || `planes.${ext}`;
  // Se recorta por el medio para no perder la extensión, que es la que le dice
  // al teléfono del prospecto con qué abrirlo.
  const cola = `.${/\.([A-Za-z0-9]+)$/.exec(limpio)?.[1] ?? ext}`;
  return limpio.slice(0, 80 - cola.length).trimEnd() + cola;
}

const megas = (bytes: number) =>
  (bytes / MB).toLocaleString('es-BO', { maximumFractionDigits: 1 });

export type ArchivoValidado =
  | { ok: true; ext: ExtensionPlanes; formato: Formato }
  | { ok: false; motivo: string };

/** Valida en el navegador, antes de gastar datos en subir. Nunca lanza. */
export async function validarArchivoPlanes(archivo: File): Promise<ArchivoValidado> {
  const ext = extensionDe(archivo.name);
  if (!ext) {
    return { ok: false, motivo: 'Ese archivo no es PDF, JPG ni PNG. El asistente manda los '
      + 'planes como documento PDF o como imagen JPG o PNG: son los que WhatsApp acepta y '
      + 'los que cualquier teléfono abre sin instalar nada. Expórtalo como PDF y súbelo de nuevo.' };
  }
  const formato = FORMATOS[ext];
  if (archivo.size === 0) {
    return { ok: false, motivo: 'El archivo está vacío. Revisa que sea el correcto.' };
  }
  if (archivo.size > formato.tope) {
    return { ok: false, motivo: formato.tipo === 'imagen'
      ? `La imagen pesa ${megas(archivo.size)} MB y WhatsApp acepta imágenes de hasta 5 MB: `
        + 'el prospecto no la recibiría. Guárdala con menos calidad, o conviértela en PDF.'
      : `El PDF pesa ${megas(archivo.size)} MB y el tope es 10 MB. El prospecto lo baja por `
        + 'WhatsApp, muchas veces con datos móviles, y un archivo pesado tarda o no baja. '
        + 'Expórtalo de nuevo con las imágenes en menor calidad.' };
  }
  let cabeza: Uint8Array;
  try {
    cabeza = new Uint8Array(await archivo.slice(0, 8).arrayBuffer());
  } catch {
    return { ok: false, motivo: 'No se pudo leer el archivo. Puede estar dañado, o en una '
      + 'carpeta a la que el navegador no tiene acceso.' };
  }
  const coincide = cabeza.length >= formato.firma.length
    && formato.firma.every((b, i) => cabeza[i] === b);
  if (!coincide) {
    return { ok: false, motivo: `El archivo termina en .${ext} pero por dentro no es un `
      + `${formato.rotulo}: puede estar dañado o haber sido renombrado. WhatsApp lo rechazaría, `
      + `o el prospecto no lo podría abrir. Ábrelo y guárdalo de nuevo como ${formato.rotulo}.` };
  }
  return { ok: true, ext, formato };
}

/** Los errores del SDK de Storage, dichos para quien los tiene que resolver. */
export function mensajeDeFallaStorage(codigo: string): string {
  switch (codigo) {
    case 'storage/unauthorized':
      return 'El servidor no aceptó el archivo. Lo pueden subir el administrador del negocio '
        + 'y NovuChat, y solo si el negocio tiene el flujo de captación; además tiene que ser '
        + 'un PDF de hasta 10 MB o una imagen JPG o PNG de hasta 5 MB. Si eres el '
        + 'administrador, sal y vuelve a entrar.';
    case 'storage/unauthenticated':
      return 'Tu sesión venció. Sal y vuelve a entrar.';
    case 'storage/retry-limit-exceeded':
    case 'storage/server-file-wrong-size':
      return 'Se cortó la conexión mientras subía. Revisa tu conexión y prueba de nuevo.';
    case 'storage/quota-exceeded':
      return 'El depósito de archivos llegó a su límite. Avísale a NovuChat.';
    case 'storage/canceled':
      return 'La subida se canceló.';
    default:
      return 'No se pudo subir el archivo. Prueba de nuevo; si sigue fallando, avísale a NovuChat.';
  }
}
