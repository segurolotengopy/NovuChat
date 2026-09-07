/**
 * =============================================================================
 * IMPORTAR Y EXPORTAR EL CATÁLOGO EN CSV
 * =============================================================================
 *
 * QUÉ PROBLEMA RESUELVE. Un comercio con doscientos productos no los carga de a
 * uno en un formulario, y decirle que lo haga es decirle que no use el producto.
 * Casi todos tienen la lista en algún lado: una planilla, el sistema de facturas,
 * el menú que le armó el sobrino. Todos esos exportan CSV.
 *
 * EL SHEETS ES UN FORMATO DE IMPORTACIÓN, NO UNA FUENTE DE VERDAD.
 * Es la corrección §3.1 de `Analisis/11-catalogo-web-propio.md` y vale la pena
 * repetirla acá, donde se programa: el diseño original tenía el catálogo viviendo
 * en el Sheets y la consola recibiendo solo el carrito. Con eso, la copia que va
 * al prompt del asistente saldría del Sheets y la del sitio también, y volverían
 * a existir dos catálogos que se desincronizan. Acá el CSV entra, se valida, se
 * escribe en Firestore, y a partir de ese momento la consola manda. Se puede
 * volver a exportar —y por eso existe `aCsv`— pero lo exportado es una copia,
 * no la fuente.
 *
 * POR QUÉ SE PARSEA EN EL NAVEGADOR Y NO EN UNA FUNCTION. Porque el archivo lo
 * elige una persona que está mirando la pantalla: puede ver el resultado, darse
 * cuenta de que la columna de precios tenía el separador equivocado y volver a
 * intentar en dos segundos. Subirlo a un servidor para que conteste un error en
 * un correo es peor de todas las formas posibles. Y no hay riesgo: quien decide
 * si cada fila entra son las reglas de Firestore, que evalúan cada escritura una
 * por una, exactamente igual que si se hubiera cargado a mano.
 */

export interface FilaCatalogo {
  nombre: string;
  descripcion: string;
  area: string;
  /** Vacío = «a consultar». NO es cero: cero significa gratis. */
  precio: number | null;
  moneda: 'BOB' | 'USD';
  duracionMin: number;
  imagenUrl: string;
  activo: boolean;
}

export interface FilaConProblemas {
  linea: number;
  fila: FilaCatalogo;
  /** Impiden importar la fila. */
  problemas: string[];
  /** No impiden nada; se muestran para que alguien mire. */
  advertencias: string[];
}

/** Las columnas que se entienden. El orden no importa; el nombre sí. */
export const COLUMNAS = [
  'nombre', 'descripcion', 'area', 'precio', 'moneda', 'duracionmin',
  'imagenurl', 'activo',
] as const;

/**
 * Sinónimos de encabezado, para no obligar a nadie a renombrar sus columnas.
 *
 * Es una lista corta y a mano, no una adivinanza difusa. Adivinar qué columna es
 * el precio por parecido de texto funciona el 90 % de las veces, y el 10 %
 * restante importa un catálogo con los precios en la columna equivocada sin que
 * nadie lo note hasta que un cliente pague de menos.
 */
const SINONIMOS: Record<string, string> = {
  producto: 'nombre', servicio: 'nombre', item: 'nombre', 'ítem': 'nombre',
  detalle: 'descripcion', 'descripción': 'descripcion',
  categoria: 'area', 'categoría': 'area', rubro: 'area',
  precio_bs: 'precio', importe: 'precio', valor: 'precio', costo: 'precio',
  duracion: 'duracionmin', 'duración': 'duracionmin', minutos: 'duracionmin',
  imagen: 'imagenurl', foto: 'imagenurl', url_imagen: 'imagenurl',
  'imagen_url': 'imagenurl', 'url': 'imagenurl',
  disponible: 'activo', publicado: 'activo',
};

/** Normaliza un encabezado: sin tildes, sin espacios, en minúsculas. */
function normalizarEncabezado(valor: string): string {
  const base = valor.trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[\s.-]+/g, '_').replace(/^_|_$/g, '');
  const sinGuion = base.replace(/_/g, '');
  if ((COLUMNAS as readonly string[]).includes(sinGuion)) return sinGuion;
  return SINONIMOS[base] ?? SINONIMOS[sinGuion] ?? base;
}

/**
 * Parte un CSV en filas y celdas, respetando las comillas.
 *
 * Se escribió a mano y no se trajo una biblioteca por una razón concreta: este
 * archivo entero son cien líneas y una dependencia más es una cosa más que
 * auditar, que actualizar y que aparece en un informe de vulnerabilidades. El
 * formato que hay que soportar es el que exportan Excel, Google Sheets y
 * LibreOffice, que es exactamente esto: comillas dobles para escapar, comillas
 * dobles duplicadas adentro, y `\r\n` o `\n` como fin de fila.
 */
export function partirCsv(texto: string): string[][] {
  // Quitar la marca de orden de bytes que pone Excel. Sin esto, la primera
  // columna se llama «﻿nombre» y no coincide con nada: el síntoma es «me
  // dice que falta la columna nombre y ahí está».
  const limpio = texto.replace(/^﻿/, '');
  const delimitador = detectarDelimitador(limpio);

  const filas: string[][] = [];
  let celda = '';
  let fila: string[] = [];
  let entreComillas = false;

  for (let i = 0; i < limpio.length; i += 1) {
    const c = limpio[i];
    if (entreComillas) {
      if (c === '"') {
        if (limpio[i + 1] === '"') { celda += '"'; i += 1; } else { entreComillas = false; }
      } else { celda += c; }
      continue;
    }
    if (c === '"') { entreComillas = true; continue; }
    if (c === delimitador) { fila.push(celda); celda = ''; continue; }
    if (c === '\n') { fila.push(celda); filas.push(fila); fila = []; celda = ''; continue; }
    if (c === '\r') continue;
    celda += c;
  }
  if (celda !== '' || fila.length > 0) { fila.push(celda); filas.push(fila); }
  return filas.filter((f) => f.some((v) => v.trim() !== ''));
}

/**
 * Coma o punto y coma.
 *
 * Excel en español exporta con punto y coma, porque la coma es el separador
 * decimal. Es la causa número uno de «me importó todo en una sola columna», y
 * detectarlo cuesta tres líneas: gana el que más aparece en el encabezado.
 */
function detectarDelimitador(texto: string): string {
  const primera = texto.split(/\r?\n/, 1)[0] ?? '';
  const comas = (primera.match(/,/g) ?? []).length;
  const puntoYComa = (primera.match(/;/g) ?? []).length;
  const tabuladores = (primera.match(/\t/g) ?? []).length;
  if (tabuladores > comas && tabuladores > puntoYComa) return '\t';
  return puntoYComa > comas ? ';' : ',';
}

/**
 * Lee un precio escrito por una persona. `1.234,50`, `1234.50`, `Bs 1.234,50`.
 *
 * EL CASO QUE OBLIGA A PENSAR: `1.234`. En Bolivia eso son mil doscientos
 * treinta y cuatro; leído como decimal inglés es uno con veintitrés. Un catálogo
 * importado con esa confusión vende a la milésima parte del precio, y nadie
 * revisa doscientas filas. La regla que se aplica: si hay coma, la coma es el
 * decimal y los puntos son miles. Si solo hay puntos y el último grupo tiene
 * exactamente tres dígitos, es separador de miles. En cualquier otro caso, el
 * punto es el decimal.
 */
export function leerPrecio(valor: string): number | null {
  const limpio = valor.replace(/[^\d.,-]/g, '').trim();
  if (limpio === '') return null;
  let normal: string;
  if (limpio.includes(',')) {
    normal = limpio.replace(/\./g, '').replace(',', '.');
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(limpio)) {
    normal = limpio.replace(/\./g, '');
  } else {
    normal = limpio;
  }
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

/** Identificador del ítem, derivado del nombre. Mismo criterio que la pantalla. */
export function idDeNombre(nombre: string): string {
  return nombre.trim().toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    .slice(0, 60);
}

const VERDADEROS = new Set(['si', 'sí', 'true', '1', 'x', 'activo', 'verdadero', 'yes']);
const FALSOS = new Set(['no', 'false', '0', 'inactivo', 'baja', 'falso']);

/**
 * Convierte el CSV en filas validadas. NO escribe nada: devuelve qué entraría y
 * qué está mal, para que la persona lo vea ANTES de tocar su catálogo.
 *
 * Esa vista previa no es cortesía. Una importación que escribe primero y avisa
 * después obliga a deshacer a mano doscientas filas, y no hay ningún «deshacer».
 */
export function validarCsv(texto: string, conAgenda: boolean): {
  filas: FilaConProblemas[]; error: string | null; columnas: string[];
} {
  const bruto = partirCsv(texto);
  if (bruto.length < 2) {
    return { filas: [], columnas: [], error: 'El archivo no tiene encabezado y al menos una fila.' };
  }
  const encabezados = (bruto[0] as string[]).map(normalizarEncabezado);
  if (!encabezados.includes('nombre')) {
    return {
      filas: [], columnas: encabezados,
      error: 'Falta la columna «nombre». Es la única obligatoria: sin ella no se '
        + 'sabe qué se está cargando.',
    };
  }

  const indice = (columna: string) => encabezados.indexOf(columna);
  const celda = (f: string[], columna: string): string => {
    const i = indice(columna);
    return i >= 0 ? (f[i] ?? '').trim() : '';
  };

  const vistos = new Set<string>();
  const filas: FilaConProblemas[] = [];

  for (let n = 1; n < bruto.length; n += 1) {
    const f = bruto[n] as string[];
    const problemas: string[] = [];
    const advertencias: string[] = [];

    const nombre = celda(f, 'nombre').slice(0, 80);
    if (nombre === '') problemas.push('sin nombre');

    const id = idDeNombre(nombre);
    if (nombre !== '' && id === '') {
      problemas.push('el nombre no deja ningún identificador utilizable');
    } else if (vistos.has(id)) {
      // Dos filas con el mismo nombre se pisarían en silencio: la segunda
      // reemplaza a la primera y el comercio pierde una sin enterarse.
      problemas.push('nombre repetido en el archivo');
    }
    if (id !== '') vistos.add(id);

    const precioCrudo = celda(f, 'precio');
    const precio = precioCrudo === '' ? null : leerPrecio(precioCrudo);
    if (precioCrudo !== '' && precio === null) problemas.push('el precio no es un número');
    if (precio !== null && (precio < 0 || precio > 1_000_000)) {
      problemas.push('el precio está fuera de rango');
    }
    if (precio === 0) {
      advertencias.push('precio cero: el asistente lo va a ofrecer como GRATIS. '
        + 'Si querías «a consultar», dejá la celda vacía');
    }

    const monedaCruda = celda(f, 'moneda').toUpperCase();
    const moneda: 'BOB' | 'USD' = monedaCruda === 'USD' || monedaCruda === '$' ? 'USD' : 'BOB';

    let duracionMin = 30;
    if (conAgenda) {
      const d = Number(celda(f, 'duracionmin').replace(/[^\d]/g, ''));
      duracionMin = Number.isFinite(d) && d > 0 ? d : 30;
      if (duracionMin % 15 !== 0) {
        // Se redondea y se avisa. Rechazar la fila por esto haría fallar una
        // importación entera por un dato que se puede arreglar bien.
        const antes = duracionMin;
        duracionMin = Math.min(1440, Math.max(15, Math.round(duracionMin / 15) * 15));
        advertencias.push(`duración ${antes} min ajustada a ${duracionMin}`);
      }
    }

    const imagenUrl = celda(f, 'imagenurl').slice(0, 500);
    if (imagenUrl !== '' && !/^https:\/\/[^ '"<>]+$/.test(imagenUrl)) {
      problemas.push(imagenUrl.startsWith('http://')
        ? 'la imagen es http: el navegador la va a bloquear, tiene que ser https'
        : 'la imagen no es una dirección https válida');
    }

    const activoCrudo = celda(f, 'activo').toLowerCase();
    const activo = activoCrudo === '' ? true
      : VERDADEROS.has(activoCrudo) ? true
      : FALSOS.has(activoCrudo) ? false : true;
    if (activoCrudo !== '' && !VERDADEROS.has(activoCrudo) && !FALSOS.has(activoCrudo)) {
      advertencias.push(`no se entendió «${activoCrudo}» en activo: se carga como activo`);
    }

    filas.push({
      linea: n + 1,
      fila: {
        nombre,
        descripcion: celda(f, 'descripcion').slice(0, 300),
        area: celda(f, 'area').toLowerCase().slice(0, 40),
        precio, moneda, duracionMin, imagenUrl, activo,
      },
      problemas, advertencias,
    });
  }

  // QUÉ COLUMNAS TRAÍA EL ARCHIVO, y no es un detalle: la importación solo
  // escribe los campos que el archivo declara. Un CSV sin columna de precio
  // ACTUALIZA nombres y fotos y NO toca los precios; si la columna está y la
  // celda viene vacía, eso sí significa «a consultar» y borra el precio. Sin
  // esta distinción, subir una lista de fotos dejaría el catálogo entero sin
  // precios, y nadie lo miraría hasta que el asistente empezara a cotizar todo.
  return { filas, error: null, columnas: encabezados.filter((c) => c !== '') };
}

/** El catálogo, de vuelta a CSV. Con comillas siempre: nunca hay que pensar. */
export function aCsv(filas: FilaCatalogo[]): string {
  const escapar = (v: string | number | boolean) => `"${String(v).replace(/"/g, '""')}"`;
  const lineas = [COLUMNAS.map(escapar).join(',')];
  for (const f of filas) {
    lineas.push([
      f.nombre, f.descripcion, f.area,
      f.precio === null ? '' : f.precio,
      f.precio === null ? '' : f.moneda,
      f.duracionMin, f.imagenUrl, f.activo ? 'si' : 'no',
    ].map(escapar).join(','));
  }
  // Con BOM, para que Excel abra las tildes bien. Sin esto, «Depilación» sale
  // «DepilaciÃ³n» y el comercio cree que le rompimos el catálogo.
  return `﻿${lineas.join('\r\n')}\r\n`;
}
