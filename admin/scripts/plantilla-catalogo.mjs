#!/usr/bin/env node
/**
 * =============================================================================
 * GENERA LA PLANTILLA DE CATÁLOGO EN .XLSX
 * =============================================================================
 *
 * PARA QUÉ. Es el archivo que se le entrega a un comercio en la reunión de alta:
 * lo llena, lo devuelve, y se importa desde la consola sin tocar nada. Sustituye
 * a la conversación de «mandanos tu lista en el formato que puedas», que termina
 * en un PDF, una foto de un cuaderno o un Word con una tabla.
 *
 * POR QUÉ SE GENERA Y NO SE VERSIONA UN BINARIO. Un `.xlsx` en el repositorio no
 * se puede revisar en un diff: nadie sabe qué cambió ni si alguien le metió algo.
 * Generarlo obliga además a que la plantilla y las columnas que el importador
 * entiende salgan del mismo lugar, así que no pueden separarse en silencio.
 *
 * NO LLEVA FILAS DE INSTRUCCIONES. Es la lección del primer archivo de ejemplo
 * que se probó: tenía la tabla de la documentación pegada arriba —una fila
 * «obligatoria: sí/no», otra con la explicación de cada columna— y el importador
 * hizo lo correcto, que fue tratarlas como dos productos con problemas. La
 * ayuda va en una hoja aparte del cuaderno o en la consola; la hoja de datos
 * tiene encabezados y datos, y nada más.
 *
 * USO:  node scripts/plantilla-catalogo.mjs
 */
import { deflateRawSync, crc32 } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const RAIZ = resolve(new URL('..', import.meta.url).pathname);
const SALIDA = join(RAIZ, '..', 'Demo-Recursos', 'plantilla-catalogo.xlsx');

// Las columnas que entiende `web/src/lib/csv.ts`. El orden es el del documento.
const ENCABEZADOS = [
  'nombre', 'descripcion', 'area', 'precio', 'duracionMin',
  'imagenUrl', 'activo', 'cantidad',
];

// SIN COLUMNA DE MONEDA, a propósito. La moneda es un parámetro del negocio y
// vive en su configuración: una panadería no vende el pan en bolivianos y la
// torta en dólares. Pedirla por fila es pedir un dato que ya se tiene, y cada
// dato de más es una columna que alguien llena mal.

/**
 * Dos filas de ejemplo: UN PRODUCTO Y UN SERVICIO.
 *
 * Están elegidas para que se vea la diferencia que más confunde: el producto no
 * lleva `duracionMin` y el servicio sí. Y el servicio va SIN PRECIO a propósito,
 * para mostrar que la celda vacía significa «a consultar» —que no es cero, y que
 * además no se publica en el catálogo web—.
 */
const EJEMPLOS = [
  // El producto lleva la cuenta de unidades; el servicio NO —una manicure no
  // se agota— y por eso su celda de cantidad va vacía. Es la diferencia que más
  // conviene que se vea en la plantilla.
  ['Hamburguesa doble', 'Doble carne, queso cheddar y papas', 'gastronomia',
   '35', '', 'https://misitio.com/fotos/doble.jpg', 'si', '24'],
  ['Manicure', 'Incluye el material', 'belleza',
   '70', '45', '', 'si', ''],
];

const escapar = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const letra = (n) => {
  let s = '';
  for (let x = n + 1; x > 0; x = Math.floor((x - 1) / 26)) {
    s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  }
  return s;
};

// --- La hoja, con todo como texto en línea ----------------------------------
// `inlineStr` en vez de cadenas compartidas: es más largo en bytes y muchísimo
// más simple de generar, y a Excel le da igual. Para una plantilla de tres filas
// la diferencia de tamaño no existe.
const filas = [ENCABEZADOS, ...EJEMPLOS].map((fila, f) => {
  const celdas = fila.map((valor, c) => (valor === ''
    ? `<c r="${letra(c)}${f + 1}"/>`
    : `<c r="${letra(c)}${f + 1}" t="inlineStr"><is><t>${escapar(valor)}</t></is></c>`));
  return `<row r="${f + 1}">${celdas.join('')}</row>`;
}).join('');

const HOJA = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  // Anchos pensados para que se lea sin tocar nada al abrirlo: la descripción y
  // la dirección de la foto son las que se cortan si quedan angostas.
  + '<cols><col min="1" max="1" width="26" customWidth="1"/>'
  + '<col min="2" max="2" width="38" customWidth="1"/>'
  + '<col min="3" max="3" width="16" customWidth="1"/>'
  + '<col min="4" max="5" width="12" customWidth="1"/>'
  + '<col min="6" max="6" width="42" customWidth="1"/>'
  + '<col min="7" max="8" width="10" customWidth="1"/></cols>'
  + `<sheetData>${filas}</sheetData></worksheet>`;

const LIBRO = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
  + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
  + '<sheets><sheet name="Catalogo" sheetId="1" r:id="rId1"/></sheets></workbook>';

const RELS_LIBRO = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"'
  + ' Target="worksheets/sheet1.xml"/></Relationships>';

const RELS_RAIZ = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"'
  + ' Target="xl/workbook.xml"/></Relationships>';

const TIPOS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
  + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
  + '</Types>';

// --- ZIP --------------------------------------------------------------------
const cod = new TextEncoder();
const partes = [
  ['[Content_Types].xml', TIPOS],
  ['_rels/.rels', RELS_RAIZ],
  ['xl/workbook.xml', LIBRO],
  ['xl/_rels/workbook.xml.rels', RELS_LIBRO],
  ['xl/worksheets/sheet1.xml', HOJA],
];

const locales = [];
const central = [];
let desplazamiento = 0;

for (const [nombre, contenido] of partes) {
  const crudo = cod.encode(contenido);
  const cuerpo = new Uint8Array(deflateRawSync(crudo));
  const bytesNombre = cod.encode(nombre);
  const suma = crc32(Buffer.from(crudo));

  const local = new DataView(new ArrayBuffer(30));
  local.setUint32(0, 0x04034b50, true);
  local.setUint16(4, 20, true);
  local.setUint16(8, 8, true);
  local.setUint32(14, suma, true);
  local.setUint32(18, cuerpo.length, true);
  local.setUint32(22, crudo.length, true);
  local.setUint16(26, bytesNombre.length, true);
  locales.push(new Uint8Array(local.buffer), bytesNombre, cuerpo);

  const dir = new DataView(new ArrayBuffer(46));
  dir.setUint32(0, 0x02014b50, true);
  dir.setUint16(4, 20, true);
  dir.setUint16(6, 20, true);
  dir.setUint16(10, 8, true);
  dir.setUint32(16, suma, true);
  dir.setUint32(20, cuerpo.length, true);
  dir.setUint32(24, crudo.length, true);
  dir.setUint16(28, bytesNombre.length, true);
  dir.setUint32(42, desplazamiento, true);
  central.push(new Uint8Array(dir.buffer), bytesNombre);

  desplazamiento += 30 + bytesNombre.length + cuerpo.length;
}

const unir = (trozos) => {
  const total = trozos.reduce((n, t) => n + t.length, 0);
  const salida = new Uint8Array(total);
  let p = 0;
  for (const t of trozos) { salida.set(t, p); p += t.length; }
  return salida;
};

const cuerpoCentral = unir(central);
const fin = new DataView(new ArrayBuffer(22));
fin.setUint32(0, 0x06054b50, true);
fin.setUint16(8, partes.length, true);
fin.setUint16(10, partes.length, true);
fin.setUint32(12, cuerpoCentral.length, true);
fin.setUint32(16, desplazamiento, true);

writeFileSync(SALIDA, unir([...locales, cuerpoCentral, new Uint8Array(fin.buffer)]));
console.log(`Escrito ${SALIDA}`);
console.log(`  ${ENCABEZADOS.length} columnas · ${EJEMPLOS.length} filas de ejemplo (un producto y un servicio)`);
