/**
 * DECODIFICAR UN ARCHIVO DE IMAGEN SIN PASAR POR UNA URL `blob:`.
 *
 * La CSP de la consola (`admin/firebase.json`) declara `img-src 'self' data:
 * https:` y NO incluye `blob:`. Con `URL.createObjectURL(archivo)` + `<img>`, el
 * navegador bloquea la carga y `onerror` salta SIEMPRE, aun con un JPEG válido:
 * es lo que le pasó a Andres con el logo («Ese archivo no es una imagen que
 * podamos leer»). Las fotos de productos tuvieron el mismo defecto y se
 * corrigieron en `modulos/productos/foto.ts` (`cargarImagen`).
 *
 * Esta es una versión propia y mínima de esa pieza: la consola central no
 * puede importar de un módulo (`fronteras.test.ts`). SEGUIMIENTO: unificar
 * ambas en una pieza común. Y no se arregla aflojando la CSP con `blob:`: lo
 * fija `admin/pruebas/central/error-logo.test.ts`.
 *
 * Primero `createImageBitmap(archivo)` (recibe el `File`, sin URL); si no
 * existe o falla, respaldo con `FileReader.readAsDataURL` + `Image`, porque
 * `data:` sí lo admite la CSP. Si ninguno puede, `ErrorDeImagen('ilegible')`.
 */
import { ErrorDeImagen } from './errorLogo';

/** Lo que se puede dibujar en un lienzo, con sus medidas reales. */
export interface ImagenDecodificada {
  fuente: CanvasImageSource;
  ancho: number;
  alto: number;
  /** Libera la memoria del bitmap; en el respaldo no hace nada. */
  cerrar: () => void;
}

/** Piezas del navegador, inyectables para probar la función sin DOM. */
export interface PiezasDeDecodificacion {
  crearBitmap?: (archivo: Blob) => Promise<ImageBitmap>;
  nuevoLector?: () => FileReader;
  nuevaImagen?: () => HTMLImageElement;
}

export async function decodificarImagen(
  archivo: File,
  piezas: PiezasDeDecodificacion = {},
): Promise<ImagenDecodificada> {
  const crearBitmap = piezas.crearBitmap
    ?? (typeof createImageBitmap === 'function' ? (a: Blob) => createImageBitmap(a) : undefined);
  if (crearBitmap) {
    try {
      const bitmap = await crearBitmap(archivo);
      return {
        fuente: bitmap, ancho: bitmap.width, alto: bitmap.height,
        cerrar: () => { (bitmap as { close?: () => void }).close?.(); },
      };
    } catch {
      // Un formato que el navegador no abre así: se prueba el otro camino.
    }
  }
  try {
    const img = await new Promise<HTMLImageElement>((resolver, rechazar) => {
      const lector = piezas.nuevoLector?.() ?? new FileReader();
      lector.onerror = () => rechazar(new ErrorDeImagen('ilegible'));
      lector.onload = () => {
        const i = piezas.nuevaImagen?.() ?? new Image();
        i.onload = () => resolver(i);
        i.onerror = () => rechazar(new ErrorDeImagen('ilegible'));
        i.src = String(lector.result);
      };
      lector.readAsDataURL(archivo);
    });
    return { fuente: img, ancho: img.naturalWidth, alto: img.naturalHeight, cerrar: () => {} };
  } catch {
    throw new ErrorDeImagen('ilegible');
  }
}
