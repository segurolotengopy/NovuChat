/**
 * Lo que el copiado desde Word o WhatsApp deja sin querer en un texto: ancho cero, BOM, guion blando
 * y unidor de palabras. En el campo de indicaciones del asistente se QUITAN en silencio al escribir o
 * pegar (el texto que se ve es el que se guarda). El servidor sigue RECHAZANDO los demás invisibles
 * (etiquetas, selectores de variación, bidi, relleno de Hangul): esos nunca llegan por copiar y pegar.
 * La lista es la de `RE_RESIDUOS_DE_COPIADO` en `functions/src/core/seguridad/invisibles.ts`
 * (`pruebas/endurecer-invisibles.test.ts` las compara).
 */
export const RESIDUOS_DE_COPIADO = '\\u{200b}\\u{feff}\\u{ad}\\u{2060}';

export function quitarResiduosDeCopiado(texto: string): string {
  return texto.replace(new RegExp('[' + RESIDUOS_DE_COPIADO + ']', 'gu'), '');
}
