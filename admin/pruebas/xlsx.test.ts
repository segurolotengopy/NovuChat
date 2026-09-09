/**
 * Pruebas del lector de `.xlsx`. NO NECESITAN EMULADOR.
 *
 * EL ARCHIVO DE PRUEBA SE FABRICA ACÁ, byte a byte, en vez de versionar un
 * `.xlsx` binario. Dos razones: un binario en el repositorio no se puede revisar
 * en un diff —nadie sabe qué cambió— y, sobre todo, fabricarlo obliga a escribir
 * el formato que el lector dice entender. Si el lector y el generador se ponen
 * de acuerdo en algo equivocado, las pruebas de más abajo —las que comprueban
 * VALORES concretos— lo delatan igual.
 *
 * Se cubren los dos métodos de compresión que usa un ZIP real: `stored` (0) y
 * `deflate` (8). Excel usa el segundo; el primero aparece en archivos generados
 * por otras herramientas, y es el que rompe un lector que solo mira uno.
 */
import { describe, expect, it } from 'vitest';
import { deflateRawSync, crc32 } from 'node:zlib';
import { leerXlsx, leerXlsxConAviso } from '../web/src/lib/xlsx.ts';

// --- Fabricación de un ZIP mínimo -------------------------------------------

interface Parte { nombre: string; contenido: string | Uint8Array; comprimir: boolean }

function armarZip(partes: Parte[]): Uint8Array {
  const cod = new TextEncoder();
  const locales: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let desplazamiento = 0;

  for (const p of partes) {
    const crudo = typeof p.contenido === 'string' ? cod.encode(p.contenido) : p.contenido;
    const cuerpo = p.comprimir ? new Uint8Array(deflateRawSync(crudo)) : crudo;
    const metodo = p.comprimir ? 8 : 0;
    const nombre = cod.encode(p.nombre);
    const suma = crc32(Buffer.from(crudo));

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(8, metodo, true);
    local.setUint32(14, suma, true);
    local.setUint32(18, cuerpo.length, true);
    local.setUint32(22, crudo.length, true);
    local.setUint16(26, nombre.length, true);
    locales.push(new Uint8Array(local.buffer), nombre, cuerpo);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(10, metodo, true);
    dir.setUint32(16, suma, true);
    dir.setUint32(20, cuerpo.length, true);
    dir.setUint32(24, crudo.length, true);
    dir.setUint16(28, nombre.length, true);
    dir.setUint32(42, desplazamiento, true);
    central.push(new Uint8Array(dir.buffer), nombre);

    desplazamiento += 30 + nombre.length + cuerpo.length;
  }

  const cuerpoCentral = concatenar(central);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true);
  fin.setUint16(8, partes.length, true);
  fin.setUint16(10, partes.length, true);
  fin.setUint32(12, cuerpoCentral.length, true);
  fin.setUint32(16, desplazamiento, true);
  return concatenar([...locales, cuerpoCentral, new Uint8Array(fin.buffer)]);
}

function concatenar(trozos: Uint8Array[]): Uint8Array {
  const total = trozos.reduce((n, t) => n + t.length, 0);
  const salida = new Uint8Array(total);
  let p = 0;
  for (const t of trozos) { salida.set(t, p); p += t.length; }
  return salida;
}

const LIBRO = '<?xml version="1.0"?><workbook xmlns:r="x">'
  + '<sheets><sheet name="Hoja1" sheetId="1" r:id="rId1"/></sheets></workbook>';
const RELS = '<?xml version="1.0"?><Relationships>'
  + '<Relationship Id="rId1" Type="x/worksheet" Target="worksheets/sheet1.xml"/>'
  + '</Relationships>';

/** Hoja con `n` cadenas compartidas y las filas dadas como XML crudo. */
function libro(compartidas: string[], filasXml: string, extra: Parte[] = []): Uint8Array {
  const si = compartidas.map((s) => `<si><t>${s}</t></si>`).join('');
  return armarZip([
    { nombre: 'xl/workbook.xml', contenido: LIBRO, comprimir: true },
    { nombre: 'xl/_rels/workbook.xml.rels', contenido: RELS, comprimir: false },
    { nombre: 'xl/sharedStrings.xml',
      contenido: `<?xml version="1.0"?><sst count="${compartidas.length}">${si}</sst>`,
      comprimir: true },
    { nombre: 'xl/worksheets/sheet1.xml',
      contenido: `<?xml version="1.0"?><worksheet><sheetData>${filasXml}</sheetData></worksheet>`,
      comprimir: true },
    ...extra,
  ]);
}

// ---------------------------------------------------------------------------

describe('Leer un .xlsx', () => {
  it('resuelve las cadenas compartidas, que es de lo que depende todo', async () => {
    // Sin esto, una hoja de texto se lee como una hoja de números: Excel guarda
    // cada texto UNA vez y en la celda deja un índice.
    const datos = libro(['nombre', 'precio', 'Hamburguesa doble'],
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
      + '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>35</v></c></row>');
    expect(await leerXlsx(datos)).toEqual([
      ['nombre', 'precio'],
      ['Hamburguesa doble', '35'],
    ]);
  });

  it('rellena las celdas VACÍAS del medio, que es el defecto más caro', async () => {
    // Excel omite del XML las celdas sin valor. Sin rellenar, a esta fila le
    // faltaría el precio y la foto entraría en la columna del área: el catálogo
    // se importa entero y mal, sin ningún error.
    const datos = libro(['Salchipapa', 'https://e.com/f.jpg'],
      '<row r="2"><c r="A2" t="s"><v>0</v></c><c r="D2" t="s"><v>1</v></c></row>');
    expect(await leerXlsx(datos)).toEqual([['Salchipapa', '', '', 'https://e.com/f.jpg']]);
  });

  it('entiende las celdas AUTOCERRADAS que escribe Excel de verdad', async () => {
    // EL DEFECTO QUE ENCONTRÓ EL PRIMER ARCHIVO REAL. Excel escribe las celdas
    // con formato pero sin valor como `<c r="F1" s="1"/>`. La primera versión
    // del lector tomaba esa apertura como un `<c…>` normal, se tragaba las
    // celdas siguientes hasta el primer `</c>`, y devolvía el ÍNDICE CRUDO de
    // la cadena compartida —«24»— como valor, en la columna equivocada.
    //
    // O sea: el catálogo entraba entero, mal, y sin ningún error. Es exactamente
    // el modo de fallo que este formato tiene que evitar, y ninguna de las hojas
    // fabricadas a mano lo tenía porque nadie escribe celdas vacías a propósito.
    const datos = libro(['Hamburguesa doble', 'BOB', 'si'],
      '<row r="1">'
      + '<c r="A1" s="1" t="s"><v>0</v></c>'
      + '<c r="B1" s="1" t="s"><v>1</v></c>'
      + '<c r="C1" s="1"/>'
      + '<c r="D1" s="1"/>'
      + '<c r="E1" s="1" t="s"><v>2</v></c>'
      + '</row>');
    expect(await leerXlsx(datos)).toEqual([['Hamburguesa doble', 'BOB', '', '', 'si']]);
  });

  it('entiende columnas más allá de la Z', async () => {
    const datos = libro(['lejos'], '<row r="1"><c r="AB1" t="s"><v>0</v></c></row>');
    const filas = await leerXlsx(datos);
    expect(filas[0]).toHaveLength(28);
    expect(filas[0]?.[27]).toBe('lejos');
  });

  it('junta los fragmentos de una celda con formato mezclado', async () => {
    // Una celda con parte del texto en negrita se parte en varios `<t>`.
    // Quedarse con el primero devolvería «Hambur».
    const datos = armarZip([
      { nombre: 'xl/workbook.xml', contenido: LIBRO, comprimir: true },
      { nombre: 'xl/_rels/workbook.xml.rels', contenido: RELS, comprimir: false },
      { nombre: 'xl/sharedStrings.xml',
        contenido: '<sst><si><r><t>Hambur</t></r><r><t>guesa doble</t></r></si></sst>',
        comprimir: true },
      { nombre: 'xl/worksheets/sheet1.xml',
        contenido: '<worksheet><sheetData><row r="1">'
          + '<c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>',
        comprimir: true },
    ]);
    expect((await leerXlsx(datos))[0]?.[0]).toBe('Hamburguesa doble');
  });

  it('lee el valor calculado de una fórmula, no la fórmula', async () => {
    // Una columna de precios con `=B2*1.1` tiene que importarse como el número.
    const datos = libro([], '<row r="1"><c r="A1"><f>B1*2</f><v>70</v></c></row>');
    expect((await leerXlsx(datos))[0]?.[0]).toBe('70');
  });

  it('lee texto en línea, que es lo que exportan otras herramientas', async () => {
    const datos = libro([],
      '<row r="1"><c r="A1" t="inlineStr"><is><t>Gaseosa</t></is></c></row>');
    expect((await leerXlsx(datos))[0]?.[0]).toBe('Gaseosa');
  });

  it('deshace las entidades de XML', async () => {
    const datos = libro(['Café &amp; Té &lt;grande&gt;'],
      '<row r="1"><c r="A1" t="s"><v>0</v></c></row>');
    expect((await leerXlsx(datos))[0]?.[0]).toBe('Café & Té <grande>');
  });

  it('descarta las filas totalmente vacías', async () => {
    const datos = libro(['algo'],
      '<row r="1"><c r="A1" t="s"><v>0</v></c></row>'
      + '<row r="2"><c r="A2"><v></v></c></row>');
    expect(await leerXlsx(datos)).toHaveLength(1);
  });

  it('sirve tanto un ZIP comprimido como uno sin comprimir', async () => {
    // `xl/_rels/workbook.xml.rels` va sin comprimir en estas pruebas y el resto
    // con deflate: un lector que solo mire uno de los dos métodos falla acá.
    const datos = libro(['ok'], '<row r="1"><c r="A1" t="s"><v>0</v></c></row>');
    expect((await leerXlsx(datos))[0]?.[0]).toBe('ok');
  });

  it('rechaza con un mensaje entendible lo que no es un ZIP', async () => {
    const csv = new TextEncoder().encode('nombre,precio\nPizza,45');
    await expect(leerXlsx(csv)).rejects.toThrow(/no es un \.xlsx/);
  });
});

describe('Las imágenes incrustadas se atan a su fila', () => {
  /** Un dibujo con una imagen anclada a la fila `fila` (base 1). */
  const dibujo = (fila: number) => '<xdr:wsDr>'
    + '<xdr:oneCellAnchor><xdr:from>'
    + `<xdr:col>6</xdr:col><xdr:row>${fila - 1}</xdr:row>`
    + '</xdr:from><xdr:pic><xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill></xdr:pic>'
    + '</xdr:oneCellAnchor></xdr:wsDr>';
  const relsDibujo = '<Relationships>'
    + '<Relationship Id="rId1" Target="../media/image1.png"/></Relationships>';

  const conFoto = (fila: number) => libro(['nombre', 'Hamburguesa', 'Manicure'],
    '<row r="1"><c r="A1" t="s"><v>0</v></c></row>'
    + '<row r="2"><c r="A2" t="s"><v>1</v></c></row>'
    + '<row r="3"><c r="A3" t="s"><v>2</v></c></row>', [
      { nombre: 'xl/drawings/drawing1.xml', contenido: dibujo(fila), comprimir: true },
      { nombre: 'xl/drawings/_rels/drawing1.xml.rels', contenido: relsDibujo, comprimir: true },
      { nombre: 'xl/media/image1.png',
        contenido: new Uint8Array([137, 80, 78, 71, 1, 2, 3]), comprimir: false },
    ]);

  it('la foto va al producto de SU fila, no a otro', async () => {
    // Es lo único que importa de esta función: una foto en el producto
    // equivocado entra sin ningún error y nadie la revisa fila por fila.
    const r = await leerXlsxConAviso(conFoto(2));
    expect(r.imagenes).toBe(1);
    expect([...r.fotos.keys()]).toEqual([1]);   // índice 1 = «Hamburguesa»
    expect(r.fotos.get(1)?.tipo).toBe('image/png');
  });

  it('la de la tercera fila va a la tercera, no a la segunda', async () => {
    const r = await leerXlsxConAviso(conFoto(3));
    expect([...r.fotos.keys()]).toEqual([2]);   // índice 2 = «Manicure»
  });

  it('una foto anclada al encabezado no se le asigna a nadie', async () => {
    // Cuenta igual en `imagenes` —el aviso no debe mentir sobre cuántas
    // traía— pero no se importa, porque no hay producto al que pertenezca.
    const r = await leerXlsxConAviso(conFoto(1));
    expect(r.imagenes).toBe(1);
    expect(r.fotos.get(0)?.tipo).toBe('image/png');
  });
});

describe('Las imágenes incrustadas se cuentan', () => {
  it('avisa cuántas venían adentro', async () => {
    // Un comercio que pegó sus fotos dentro del Excel las va a dar por
    // importadas. Descubrir que no en la página que ve su cliente es el peor
    // momento posible, así que la importación lo dice antes.
    const datos = libro(['nombre'], '<row r="1"><c r="A1" t="s"><v>0</v></c></row>', [
      { nombre: 'xl/media/image1.png', contenido: new Uint8Array([1, 2, 3]), comprimir: false },
      { nombre: 'xl/media/image2.jpeg', contenido: new Uint8Array([4, 5]), comprimir: false },
    ]);
    const r = await leerXlsxConAviso(datos);
    expect(r.imagenes).toBe(2);
    expect(r.filas).toEqual([['nombre']]);
    // Sin dibujo que las ancle, no se le asignan a ninguna fila.
    expect(r.fotos.size).toBe(0);
  });

  it('un archivo sin imágenes no avisa nada', async () => {
    const datos = libro(['nombre'], '<row r="1"><c r="A1" t="s"><v>0</v></c></row>');
    expect((await leerXlsxConAviso(datos)).imagenes).toBe(0);
  });
});


/**
 * LA PRUEBA QUE MÁS IMPORTA DE ESTE ARCHIVO: que el mismo catálogo, subido como
 * Excel o como CSV, entre EXACTAMENTE igual.
 *
 * Si las dos entradas se separaran, el síntoma no apuntaría a la causa: el
 * comercio subiría su Excel, vería precios distintos de los que ve en su
 * planilla, y no habría ningún error en ninguna parte.
 */
import { validarCsv, validarFilas } from '../web/src/lib/csv.ts';

describe('Excel y CSV dan el mismo resultado', () => {
  it('mismas filas, mismos precios, mismas columnas detectadas', async () => {
    const compartidas = ['nombre', 'precio', 'imagenUrl',
      'Hamburguesa doble', 'https://e.com/h.jpg', 'Salchipapa'];
    const excel = libro(compartidas,
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c>'
      + '<c r="C1" t="s"><v>2</v></c></row>'
      + '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>35</v></c>'
      + '<c r="C2" t="s"><v>4</v></c></row>'
      + '<row r="3"><c r="A3" t="s"><v>5</v></c><c r="B3"><v>20</v></c></row>');

    const csv = 'nombre,precio,imagenUrl\n'
      + 'Hamburguesa doble,35,https://e.com/h.jpg\n'
      + 'Salchipapa,20,';

    const deExcel = validarFilas(await leerXlsx(excel), false);
    const deCsv = validarCsv(csv, false);

    expect(deExcel.error).toBe(null);
    expect(deExcel.columnas).toEqual(deCsv.columnas);
    expect(deExcel.filas.map((f) => f.fila)).toEqual(deCsv.filas.map((f) => f.fila));
    expect(deExcel.filas[0]?.fila.precio).toBe(35);
    expect(deExcel.filas[1]?.fila.imagenUrl).toBe('');
  });

  it('el precio con coma decimal de Excel se lee igual que en el CSV', async () => {
    // Excel guarda los números con punto en el XML aunque los muestre con coma,
    // y el CSV los trae como los escribió la persona. Las dos ramas pasan por
    // `leerPrecio`, así que «1.234,50» y «1234.5» terminan en el mismo número.
    const excel = libro(['nombre', 'precio', 'Torta'],
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
      + '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1234.5</v></c></row>');
    const deExcel = validarFilas(await leerXlsx(excel), false);
    const deCsv = validarCsv('nombre,precio\nTorta,"1.234,50"', false);
    expect(deExcel.filas[0]?.fila.precio).toBe(1234.5);
    expect(deCsv.filas[0]?.fila.precio).toBe(1234.5);
  });
});
