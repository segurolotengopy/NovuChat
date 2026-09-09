/**
 * =============================================================================
 * EXPORTAR UNA TABLA A UN ARCHIVO QUE EXCEL ABRA BIEN
 * =============================================================================
 *
 * POR QUÉ CSV Y NO `.xlsx`. Escribir un `.xlsx` es armar un ZIP con varios XML
 * adentro; leerlo ya se hace en `lib/xlsx.ts` porque el comercio sube lo que
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

/** Un valor de celda, ya en texto. */
const celda = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const t = v instanceof Date ? v.toLocaleString('es-BO') : String(v);
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
