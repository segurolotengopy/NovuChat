/**
 * =============================================================================
 * LEER UN .XLSX SIN NINGUNA DEPENDENCIA
 * =============================================================================
 *
 * POR QUÉ IMPORTA SOPORTAR EXCEL Y NO SOLO CSV. Un comercio que tiene su lista
 * en Excel y recibe «exportá a CSV» hace tres cosas mal antes de acertar: elige
 * el separador equivocado, pierde las tildes, o guarda el archivo y sube el
 * `.xlsx` igual. Aceptar el archivo que ya tiene elimina esos tres tropiezos de
 * una vez, y son la mitad de las importaciones que fallan.
 *
 * POR QUÉ ESCRITO A MANO. Las bibliotecas de Excel del ecosistema son grandes
 * —cientos de kilobytes— y arrastran superficie que hay que auditar en un
 * producto con `default-src 'none'`. Lo que hace falta acá es una porción muy
 * chica del formato: un `.xlsx` es un ZIP con XML adentro, y de todo ese XML
 * solo se leen los valores de las celdas de la primera hoja. Son unas doscientas
 * líneas contra una dependencia con su cadena de suministro.
 *
 * LO QUE ESTE LECTOR HACE Y LO QUE NO, dicho para que nadie suponga de más:
 *
 *   SÍ   valores de texto y de número, cadenas compartidas, celdas vacías,
 *        fórmulas (se lee el valor calculado que Excel dejó guardado).
 *   NO   fechas con formato (llegan como el número de serie de Excel), hojas
 *        que no sean la primera, celdas combinadas, y el formato viejo `.xls`
 *        —que no es un ZIP y no tiene nada que ver con esto—.
 *
 * Ninguna de esas ausencias afecta a un catálogo: nombre, precio, área y una
 * dirección de foto son texto y números.
 */

/** Un archivo dentro del ZIP, ya descomprimido. */
type Entradas = Map<string, Uint8Array>;

const texto = new TextDecoder('utf-8');

/**
 * Descomprime el ZIP leyendo su DIRECTORIO CENTRAL, no recorriendo los
 * encabezados locales.
 *
 * La diferencia importa: en un ZIP escrito «al vuelo» los encabezados locales
 * pueden traer los tamaños en cero y dejarlos para un descriptor posterior, y
 * un recorrido secuencial se pierde. El directorio central siempre tiene los
 * tamaños reales — es el índice del archivo, y está al final.
 */
async function abrirZip(datos: Uint8Array): Promise<Entradas> {
  const v = new DataView(datos.buffer, datos.byteOffset, datos.byteLength);
  const u32 = (p: number) => v.getUint32(p, true);
  const u16 = (p: number) => v.getUint16(p, true);

  // El fin del directorio central está al final, después de un comentario de
  // largo variable. Se busca su firma hacia atrás.
  let fin = -1;
  for (let p = datos.length - 22; p >= 0 && p > datos.length - 65_557; p -= 1) {
    if (u32(p) === 0x06054b50) { fin = p; break; }
  }
  if (fin < 0) throw new Error('Ese archivo no es un .xlsx (no parece un ZIP).');

  const cantidad = u16(fin + 10);
  let p = u32(fin + 16);
  const entradas: Entradas = new Map();

  for (let i = 0; i < cantidad; i += 1) {
    if (u32(p) !== 0x02014b50) break;
    const metodo = u16(p + 10);
    const comprimido = u32(p + 20);
    const crudo = u32(p + 24);
    const largoNombre = u16(p + 28);
    const largoExtra = u16(p + 30);
    const largoComentario = u16(p + 32);
    const desplazamiento = u32(p + 42);
    const nombre = texto.decode(datos.subarray(p + 46, p + 46 + largoNombre));

    // El encabezado local repite el nombre y el extra, con largos PROPIOS que
    // pueden no coincidir con los del directorio. Hay que leerlos de ahí.
    const nombreLocal = u16(desplazamiento + 26);
    const extraLocal = u16(desplazamiento + 28);
    const inicio = desplazamiento + 30 + nombreLocal + extraLocal;
    const cuerpo = datos.subarray(inicio, inicio + comprimido);

    if (metodo === 0) {
      entradas.set(nombre, cuerpo);
    } else if (metodo === 8) {
      entradas.set(nombre, await inflar(cuerpo, crudo));
    }
    // Cualquier otro método se ignora en silencio: no hay ninguno que Excel
    // use para las partes que este lector necesita.

    p += 46 + largoNombre + largoExtra + largoComentario;
  }
  return entradas;
}

/** `deflate` crudo con la API del navegador. Sin biblioteca. */
async function inflar(datos: Uint8Array, esperado: number): Promise<Uint8Array> {
  const flujo = new Blob([datos as BlobPart]).stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  const salida = new Uint8Array(await new Response(flujo).arrayBuffer());
  if (esperado > 0 && salida.length !== esperado) {
    throw new Error('El archivo de Excel parece dañado.');
  }
  return salida;
}

/** `A1` → columna 0. `AB12` → columna 27. */
function columnaDe(ref: string): number {
  let n = 0;
  for (const c of ref) {
    const código = c.charCodeAt(0);
    if (código < 65 || código > 90) break;
    n = n * 26 + (código - 64);
  }
  return n - 1;
}

/** Deshace las cinco entidades de XML. No hace falta más: es XML generado. */
const desescapar = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&');

/**
 * Las cadenas compartidas. Excel guarda cada texto UNA vez acá y en la celda
 * deja un índice; sin resolverlas, una hoja de texto se lee como una hoja de
 * números.
 *
 * Se toma el texto de TODOS los `<t>` de cada `<si>`: una celda con parte del
 * texto en negrita se parte en varios fragmentos, y quedarse con el primero
 * devolvería «Hambur» en vez de «Hamburguesa doble».
 */
function cadenasCompartidas(entradas: Entradas): string[] {
  const xml = entradas.get('xl/sharedStrings.xml');
  if (!xml) return [];
  const crudo = texto.decode(xml);
  return [...crudo.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((si) =>
    [...(si[1] ?? '').matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
      .map((t) => desescapar(t[1] ?? '')).join(''));
}

/** La primera hoja, resuelta por el libro y sus relaciones. */
function rutaDeLaPrimeraHoja(entradas: Entradas): string {
  const libro = entradas.get('xl/workbook.xml');
  const rels = entradas.get('xl/_rels/workbook.xml.rels');
  if (libro && rels) {
    const id = /<sheet[^>]*r:id="([^"]+)"/.exec(texto.decode(libro))?.[1];
    if (id) {
      const destino = new RegExp(`Id="${id}"[^>]*Target="([^"]+)"`)
        .exec(texto.decode(rels))?.[1];
      if (destino) return `xl/${destino.replace(/^\/?xl\//, '')}`;
    }
  }
  // Respaldo: el nombre que Excel usa siempre. Un libro raro no debería dejar
  // la importación muerta si la hoja está donde está siempre.
  return 'xl/worksheets/sheet1.xml';
}

/**
 * Convierte la primera hoja en filas de celdas, como las devuelve `partirCsv`.
 *
 * Las filas y columnas VACÍAS se rellenan. Excel omite del XML las celdas sin
 * valor, así que sin rellenar, una fila a la que le falta el precio correría el
 * resto de las columnas un lugar a la izquierda y el catálogo entraría con la
 * foto en la columna del área. Es el defecto que más caro sale de este formato.
 */
async function leerHoja(
  datos: Uint8Array,
): Promise<Array<{ r: number; celdas: string[] }>> {
  const entradas = await abrirZip(datos);
  const compartidas = cadenasCompartidas(entradas);
  const hoja = entradas.get(rutaDeLaPrimeraHoja(entradas));
  if (!hoja) throw new Error('El archivo no tiene ninguna hoja legible.');
  const xml = texto.decode(hoja);

  const filas: Array<{ r: number; celdas: string[] }> = [];
  for (const fila of xml.matchAll(/<row([^>]*)>([\s\S]*?)<\/row>/g)) {
    // El número de fila del ARCHIVO, que no es el índice en el arreglo: las
    // filas vacías se descartan. Hace falta para poder atar cada imagen a su
    // producto, porque el anclaje del dibujo apunta a la fila de la hoja.
    const numero = Number(/r="(\d+)"/.exec(fila[1] ?? '')?.[1] ?? '0');
    const celdas: string[] = [];
    // LA ALTERNATIVA `/>` NO ES ADORNO. Excel escribe las celdas con formato
    // pero sin valor como `<c r="F4" s="1"/>`, autocerradas. Sin contemplarlas,
    // la expresión toma esa apertura como si fuera un `<c…>` normal, se traga
    // las celdas siguientes hasta el primer `</c>`, y devuelve el ÍNDICE CRUDO
    // de la cadena compartida como si fuera el valor — en la columna
    // equivocada. O sea: el catálogo entra entero, mal, y sin ningún error.
    // Lo destapó el primer archivo de Excel de verdad; ninguna de las hojas
    // fabricadas a mano tenía celdas autocerradas.
    for (const celda of (fila[2] ?? '')
      .matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const atributos = celda[1] ?? '';
      const cuerpo = celda[2] ?? '';
      const ref = /r="([A-Z]+)\d+"/.exec(atributos)?.[1];
      const tipo = /t="([^"]+)"/.exec(atributos)?.[1] ?? 'n';

      let valor = '';
      if (tipo === 's') {
        const i = Number(/<v>([\s\S]*?)<\/v>/.exec(cuerpo)?.[1] ?? '-1');
        valor = compartidas[i] ?? '';
      } else if (tipo === 'inlineStr') {
        valor = [...cuerpo.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
          .map((t) => desescapar(t[1] ?? '')).join('');
      } else {
        // Número, booleano o el valor calculado de una fórmula. Excel guarda
        // el resultado junto a la fórmula, así que una columna de precios
        // calculada se importa igual que una escrita a mano.
        valor = desescapar(/<v>([\s\S]*?)<\/v>/.exec(cuerpo)?.[1] ?? '');
      }

      const columna = ref !== undefined ? columnaDe(ref) : celdas.length;
      while (celdas.length < columna) celdas.push('');
      celdas[columna] = valor;
    }
    filas.push({ r: numero, celdas });
  }
  // Las filas totalmente vacías se descartan, igual que en el CSV.
  return filas.filter((f) => f.celdas.some((v) => v.trim() !== ''));
}

/** La forma de siempre: solo las celdas. */
export async function leerXlsx(datos: Uint8Array): Promise<string[][]> {
  return (await leerHoja(datos)).map((f) => f.celdas);
}

/** Una imagen pegada en la hoja, con la fila del ARCHIVO a la que está anclada. */
export interface FotoIncrustada {
  /** Número de fila de la hoja, base 1. */
  fila: number;
  tipo: string;
  bytes: Uint8Array;
}

const TIPOS_IMAGEN: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp',
};

/**
 * =============================================================================
 * LAS IMÁGENES PEGADAS EN LA HOJA, ATADAS A SU PRODUCTO
 * =============================================================================
 *
 * CÓMO SE SABE A QUÉ FILA VA CADA UNA. En un `.xlsx` la imagen no vive en la
 * celda: flota por encima de la hoja, y su posición está en `xl/drawings/`,
 * en un ancla que dice desde qué columna y fila arranca. Esa fila es la que
 * ata la foto a su producto.
 *
 * SE USA EL BORDE SUPERIOR DEL ANCLA (`<xdr:from>`) y no el centro de la
 * imagen. Una foto alta se derrama sobre la fila de abajo, y tomar el centro
 * la asignaría al producto siguiente — el modo de fallo más incómodo posible,
 * porque el catálogo entra completo con las fotos corridas un lugar.
 *
 * SI DOS IMÁGENES CAEN EN LA MISMA FILA gana la primera, y no es arbitrario:
 * un ítem tiene una foto. Que la segunda pise a la primera dejaría el resultado
 * dependiendo del orden en que Excel las escribió.
 */
export function fotosIncrustadas(entradas: Entradas): FotoIncrustada[] {
  const dibujo = [...entradas.keys()].find((n) => /^xl\/drawings\/drawing\d+\.xml$/.test(n));
  if (!dibujo) return [];
  const rels = entradas.get(dibujo.replace('drawings/', 'drawings/_rels/') + '.rels');
  if (!rels) return [];

  // rId -> ruta del archivo dentro del ZIP.
  const destinos = new Map<string, string>();
  for (const m of texto.decode(rels).matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    destinos.set(m[1] ?? '', `xl/${(m[2] ?? '').replace(/^\.\.\//, '')}`);
  }

  const xml = texto.decode(entradas.get(dibujo) as Uint8Array);
  const fotos: FotoIncrustada[] = [];
  const vistas = new Set<number>();

  // Cada ancla es un bloque `<xdr:oneCellAnchor>` o `<xdr:twoCellAnchor>`; los
  // dos empiezan con un `<xdr:from>` y llevan adentro el `r:embed` de la imagen.
  for (const ancla of xml.matchAll(/<xdr:(?:one|two)CellAnchor[\s\S]*?<\/xdr:(?:one|two)CellAnchor>/g)) {
    const bloque = ancla[0];
    const desde = /<xdr:from>([\s\S]*?)<\/xdr:from>/.exec(bloque)?.[1] ?? '';
    const fila = Number(/<xdr:row>(\d+)<\/xdr:row>/.exec(desde)?.[1] ?? '-1') + 1;
    const id = /r:embed="([^"]+)"/.exec(bloque)?.[1] ?? '';
    const ruta = destinos.get(id);
    if (fila <= 0 || !ruta) continue;
    if (vistas.has(fila)) continue;

    const bytes = entradas.get(ruta);
    const extension = /\.([a-z0-9]+)$/i.exec(ruta)?.[1]?.toLowerCase() ?? '';
    const tipo = TIPOS_IMAGEN[extension];
    // Los `.emf` y `.wmf` que Excel a veces guarda como respaldo no son
    // imágenes que un navegador sepa dibujar: se descartan en silencio.
    if (!bytes || !tipo) continue;

    vistas.add(fila);
    fotos.push({ fila, tipo, bytes });
  }
  return fotos;
}

/**
 * Cuántas imágenes trae incrustadas el archivo.
 *
 * NO SE IMPORTAN, y por eso esto devuelve un número y no las imágenes: alojar
 * las fotos de los productos es una decisión de arquitectura que este proyecto
 * tomó al revés a propósito —se referencian por URL, no se guardan— y una
 * importación no es el lugar donde revertirla en silencio. Lo que sí hace falta
 * es AVISAR: un comercio que pegó sus fotos dentro del Excel las va a dar por
 * importadas, y descubrir que no en la página que ve su cliente es el peor
 * momento posible.
 */
export function imagenesIncrustadas(entradas: Entradas): number {
  let n = 0;
  for (const nombre of entradas.keys()) {
    if (/^xl\/media\/.+\.(png|jpe?g|gif|bmp|webp|emf|wmf)$/i.test(nombre)) n += 1;
  }
  return n;
}

/**
 * Las filas, y las fotos pegadas ya atadas al ÍNDICE de la fila devuelta.
 *
 * La traducción de «fila de la hoja» a «índice del arreglo» se hace acá y no en
 * quien llama: las filas vacías se descartan al leer, así que los dos números no
 * coinciden, y equivocarse ahí pone la foto en el producto de al lado.
 */
export async function leerXlsxConAviso(datos: Uint8Array): Promise<{
  filas: string[][];
  imagenes: number;
  fotos: Map<number, { tipo: string; bytes: Uint8Array }>;
}> {
  const entradas = await abrirZip(datos);
  const hoja = await leerHoja(datos);
  const porFilaDeLaHoja = new Map(hoja.map((f, i) => [f.r, i]));

  const fotos = new Map<number, { tipo: string; bytes: Uint8Array }>();
  for (const f of fotosIncrustadas(entradas)) {
    const indice = porFilaDeLaHoja.get(f.fila);
    // Una imagen anclada a una fila vacía —o al encabezado— no tiene producto
    // al que pertenecer. Se descarta, pero sigue contando en `imagenes`, para
    // que el aviso no mienta sobre cuántas traía el archivo.
    if (indice !== undefined) fotos.set(indice, { tipo: f.tipo, bytes: f.bytes });
  }

  return {
    filas: hoja.map((f) => f.celdas),
    imagenes: imagenesIncrustadas(entradas),
    fotos,
  };
}
