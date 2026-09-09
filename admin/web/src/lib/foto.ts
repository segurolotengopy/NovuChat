/**
 * =============================================================================
 * PREPARAR UNA FOTO ANTES DE GUARDARLA
 * =============================================================================
 *
 * El comercio elige una foto de su teléfono. Una foto de un teléfono de hoy son
 * entre 3 y 8 MB y 4.000 píxeles de ancho, y en el catálogo se ve en un cuadro
 * de 300. Guardarla entera sería pagar mil veces por un dato que nadie va a
 * mirar en ese tamaño, y hacer que el catálogo tarde en abrir en el celular del
 * CLIENTE, que es donde menos datos hay.
 *
 * SE ENCOGE EN EL NAVEGADOR, ANTES DE SUBIR. No en el servidor: subir 8 MB para
 * después tirarlos es gastar los datos del comercio —muchos cargan el catálogo
 * desde el celular, con datos móviles— y es el minuto en que la pantalla parece
 * colgada. Acá el archivo original NUNCA sale del teléfono.
 *
 * WEBP CON RESERVA. Comprime bastante mejor que JPEG a igual calidad, y lo
 * entiende todo lo que se usa hoy. Si el navegador no lo soporta, `toDataURL`
 * devuelve un PNG sin avisar —devuelve el formato por defecto, no un error—,
 * así que se comprueba lo que DEVOLVIÓ y no lo que se pidió, y se cae a JPEG,
 * que sí es universal. Un PNG de una fotografía pesa varias veces más que un
 * JPEG y era la forma silenciosa de guardar fotos de 800 KB.
 *
 * DÓNDE SE GUARDA, y por qué no dentro del ítem: en `fotosCatalogo/{itemId}`,
 * un documento aparte. El ítem lo leen la consola, el sitio público Y
 * `configuracionFlujo`, que corre en la ruta de CADA MENSAJE de WhatsApp. Con
 * la foto adentro, un catálogo de 40 ítems mandaría cuatro megas en cada
 * consulta del asistente. La foto se lee solo donde se muestra.
 *
 * ESTO NO ES UN DEPÓSITO DE ARCHIVOS Y NO PRETENDE SERLO. Firestore guarda
 * documentos de hasta 1 MB; acá se corta en 150 KB. Sirve porque el catálogo es
 * chico —200 ítems como tope— y ahorra montar un bucket con su subida, sus
 * reglas y su CORS. El día que un comercio necesite fotos grandes o galerías,
 * esto se muda a Storage y el resto no se entera: lo único que sale del módulo
 * es una cadena.
 */

/** Lado mayor de la imagen guardada. Se ve en cuadros de 300 px como mucho. */
const LADO_MAXIMO = 900;
/** Tope duro de lo que se guarda. Por encima se rechaza en vez de guardar algo enorme. */
export const TOPE_GUARDADO = 150 * 1024;
/** Tope de lo que se acepta ELEGIR. Más que esto ni se intenta decodificar. */
const TOPE_ORIGINAL = 25 * 1024 * 1024;

const TIPOS = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'];

export interface FotoLista {
  /** `data:image/webp;base64,…` — lo que se guarda y lo que se pinta. */
  datos: string;
  ancho: number;
  alto: number;
  bytes: number;
  tipo: string;
}

export type FallaFoto =
  | 'no_es_imagen' | 'original_enorme' | 'no_se_pudo_leer' | 'no_entra';

const MENSAJES: Record<FallaFoto, string> = {
  no_es_imagen: 'Eso no es una imagen. Elija un archivo JPG, PNG o WEBP.',
  original_enorme: 'La foto pesa más de 25 MB. Sáquela de nuevo con menos calidad.',
  no_se_pudo_leer: 'No se pudo leer la imagen. Puede estar dañada o en un formato '
    + 'que este navegador no abre.',
  no_entra: 'No se pudo achicar esa imagen lo suficiente. Recórtela y vuelva a intentar.',
};

export const mensajeDeFalla = (f: FallaFoto): string => MENSAJES[f];

/** Dimensiones de destino: encoge, nunca agranda. */
export function medidaDestino(ancho: number, alto: number, lado = LADO_MAXIMO):
{ ancho: number; alto: number } {
  const mayor = Math.max(ancho, alto);
  if (mayor <= lado) return { ancho, alto };
  const f = lado / mayor;
  return { ancho: Math.max(1, Math.round(ancho * f)), alto: Math.max(1, Math.round(alto * f)) };
}

/** Bytes reales de un `data:` URL, sin decodificarlo. */
export function bytesDeDataUrl(url: string): number {
  const coma = url.indexOf(',');
  if (coma < 0) return 0;
  const cuerpo = url.slice(coma + 1);
  const relleno = (cuerpo.endsWith('==') ? 2 : cuerpo.endsWith('=') ? 1 : 0);
  return Math.max(0, Math.floor(cuerpo.length * 3 / 4) - relleno);
}

/** El tipo REAL que produjo el lienzo, que no siempre es el que se le pidió. */
export function tipoDeDataUrl(url: string): string {
  return /^data:([^;,]+)/.exec(url)?.[1] ?? '';
}

function cargarImagen(archivo: File): Promise<HTMLImageElement> {
  return new Promise((resolver, rechazar) => {
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolver(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rechazar(new Error('no_se_pudo_leer')); };
    img.src = url;
  });
}

/**
 * Encoge y comprime hasta entrar en el tope.
 *
 * Baja la calidad por pasos y, si con la calidad más baja todavía no entra,
 * encoge el lado. Va en ese orden porque bajar calidad se nota mucho menos que
 * perder píxeles, y porque una foto de comida con mucho detalle puede no entrar
 * a 900 px ni al 40 % de calidad.
 */
export async function prepararFoto(archivo: File):
Promise<{ ok: true; foto: FotoLista } | { ok: false; falla: FallaFoto }> {
  if (!TIPOS.includes(archivo.type) && !archivo.type.startsWith('image/')) {
    return { ok: false, falla: 'no_es_imagen' };
  }
  if (archivo.size > TOPE_ORIGINAL) return { ok: false, falla: 'original_enorme' };

  let img: HTMLImageElement;
  try { img = await cargarImagen(archivo); } catch { return { ok: false, falla: 'no_se_pudo_leer' }; }

  const lienzo = document.createElement('canvas');
  const pincel = lienzo.getContext('2d');
  if (!pincel) return { ok: false, falla: 'no_se_pudo_leer' };

  for (const lado of [LADO_MAXIMO, 700, 520, 400]) {
    const m = medidaDestino(img.naturalWidth, img.naturalHeight, lado);
    lienzo.width = m.ancho;
    lienzo.height = m.alto;
    pincel.clearRect(0, 0, m.ancho, m.alto);
    pincel.drawImage(img, 0, 0, m.ancho, m.alto);

    for (const calidad of [0.78, 0.68, 0.58, 0.45]) {
      let datos = lienzo.toDataURL('image/webp', calidad);
      // El navegador que no sabe WEBP devuelve un PNG sin decirlo. Un PNG de una
      // fotografía pesa varias veces más que un JPEG: se cae a JPEG a propósito.
      if (tipoDeDataUrl(datos) !== 'image/webp') {
        datos = lienzo.toDataURL('image/jpeg', calidad);
      }
      const bytes = bytesDeDataUrl(datos);
      if (bytes <= TOPE_GUARDADO) {
        return { ok: true, foto: { datos, ancho: m.ancho, alto: m.alto, bytes, tipo: tipoDeDataUrl(datos) } };
      }
    }
  }
  return { ok: false, falla: 'no_entra' };
}
