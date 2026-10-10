import { readFile } from 'node:fs/promises';
import type { Download } from '@playwright/test';

/**
 * Lee el CSV que exporta la consola (`web/src/central/lib/exportar.ts`): BOM, línea `sep=;`, separador `;`, todo entre comillas
 * dobles (las comillas internas duplicadas) y saltos `\r\n` entre filas. Un parser propio y mínimo, para que la prueba no dependa
 * de las funciones que prueba. Devuelve el texto crudo, la marca de orden de bytes y las filas ya partidas (sin la línea `sep=`).
 */
export interface CsvLeido { crudo: string; conBom: boolean; separador: string; filas: string[][] }

export function partirCsvExportado(crudo: string): CsvLeido {
  const conBom = crudo.startsWith('﻿');
  const texto = conBom ? crudo.slice(1) : crudo;
  const primera = texto.split('\r\n', 1)[0] ?? '';
  const separador = /^sep=(.)$/.exec(primera)?.[1] ?? '';
  const cuerpo = texto.slice(primera.length + 2);
  const filas: string[][] = [];
  let celda = '';
  let fila: string[] = [];
  let entre = false;
  for (let i = 0; i < cuerpo.length; i += 1) {
    const c = cuerpo[i] as string;
    if (entre) {
      if (c === '"') {
        if (cuerpo[i + 1] === '"') { celda += '"'; i += 1; } else entre = false;
      } else celda += c;
      continue;
    }
    if (c === '"') { entre = true; continue; }
    if (c === separador) { fila.push(celda); celda = ''; continue; }
    if (c === '\r' && cuerpo[i + 1] === '\n') { fila.push(celda); filas.push(fila); fila = []; celda = ''; i += 1; continue; }
    celda += c;
  }
  if (celda !== '' || fila.length > 0) { fila.push(celda); filas.push(fila); }
  return { crudo, conBom, separador, filas };
}

/** Lee el archivo de una descarga de Playwright y lo parte. */
export async function leerDescargaCsv(descarga: Download): Promise<CsvLeido> {
  const ruta = await descarga.path();
  if (!ruta) throw new Error('La descarga no dejó un archivo.');
  return partirCsvExportado(await readFile(ruta, 'utf8'));
}
