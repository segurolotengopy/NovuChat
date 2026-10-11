/**
 * =============================================================================
 * EXPORTAR UNA TABLA A UN ARCHIVO QUE EXCEL ABRA BIEN
 * =============================================================================
 *
 * POR QUÉ CSV Y NO `.xlsx`. Escribir un `.xlsx` es armar un ZIP con varios XML
 * adentro; leerlo ya se hace en `web/src/modulos/productos/xlsx.ts` porque el comercio sube lo que
 * tiene, pero ESCRIBIRLO para que después alguien lo abra y lo ordene no agrega
 * nada: Excel, Sheets y LibreOffice abren un CSV con doble clic. La diferencia
 * la notaría el usuario solo si necesitara formatos o fórmulas, y una
 * exportación de bitácora no los tiene.
 *
 * LO QUE SÍ HAY QUE HACER BIEN ES EL BOM. Sin la marca de bytes al principio,
 * Excel en Windows lee el archivo como Latin-1 y «Depilación» sale
 * «DepilaciÃ³n». El comercio no piensa «falta un BOM»: piensa que le
 * mandamos los datos rotos.
 *
 * Y LA COMA NO ES INOCENTE. Un separador coma con Excel en español abre todo en
 * una sola columna, porque su lista por defecto es el punto y coma. Se escribe
 * la línea `sep=;` al principio, que Excel entiende y las demás hojas de
 * cálculo ignoran, y se usa punto y coma.
 */

/**
 * =============================================================================
 * INYECCIÓN DE FÓRMULAS (OWASP «CSV injection»)
 * =============================================================================
 *
 * Excel, Sheets y LibreOffice ejecutan como fórmula una celda cuyo texto
 * empieza con `=`, `+`, `-`, `@`, tabulación o retorno de carro, y entrecomillar
 * no lo impide: las comillas son del CSV, no de la hoja. Varias columnas de lo
 * que exporta la consola son texto escrito por el cliente final (nota,
 * dirección, referencia para llegar), así que una nota «=HYPERLINK(...)» se
 * ejecutaría cuando el local abra el archivo.
 *
 * LA REGLA: todo TEXTO que empiece así lleva un `'` delante, que la hoja
 * muestra como texto literal y no como parte del valor. Un NÚMERO real
 * (`typeof 'number'`) NO se toca: un monto negativo sigue siendo número, y un
 * número no puede llevar una fórmula. Lo que llega como texto se neutraliza
 * siempre, aunque parezca un número: no hay forma de distinguir «-2» de un
 * texto escrito por una persona.
 *
 * IDA Y VUELTA. Para que `quitarNeutralizacion` devuelva exactamente lo que
 * había (el importador del catálogo lo usa), también se antepone el `'` cuando
 * el texto ya empieza con comillas simples seguidas de uno de esos caracteres:
 * `'=x` se escribe `''=x` y se lee `'=x`, no `=x`.
 */
const PELIGROSO = /^'*[=+\-@\t\r]/;

/** El texto, listo para una hoja de cálculo: sin fórmulas posibles. */
export function neutralizarFormula(t: string): string {
  return PELIGROSO.test(t) ? `'${t}` : t;
}

/** Lo inverso, para el importador: quita UN `'` si lo puso `neutralizarFormula`. */
export function quitarNeutralizacion(t: string): string {
  return t.startsWith("'") && PELIGROSO.test(t) ? t.slice(1) : t;
}

/** Un valor de celda, ya en texto. */
const celda = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return `"${String(v)}"`;
  const t = neutralizarFormula(v instanceof Date ? v.toLocaleString('es-BO') : String(v));
  // Comillas dobles duplicadas, y todo entre comillas: así un texto con punto y
  // coma, comillas o saltos de línea no parte la fila.
  return `"${t.replace(/"/g, '""')}"`;
};

export function aCsvGenerico(columnas: string[], filas: unknown[][]): string {
  const lineas = ['sep=;', columnas.map(celda).join(';')];
  for (const f of filas) lineas.push(f.map(celda).join(';'));
  return `﻿${lineas.join('\r\n')}\r\n`;
}

/**
 * Dispara la descarga. El archivo se arma EN EL NAVEGADOR y no viaja a ningún
 * lado: no hay una petición al servidor con los datos del negocio adentro.
 */
export function descargarCsv(nombre: string, columnas: string[], filas: unknown[][]): void {
  const blob = new Blob([aCsvGenerico(columnas, filas)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  // La fecha en el nombre: quien exporta dos veces en la semana termina con dos
  // archivos iguales en Descargas y no sabe cuál es cuál.
  a.download = `${nombre}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Sin esto, el blob queda en memoria hasta que se cierre la pestaña.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
