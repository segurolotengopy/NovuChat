/**
 * VALIDACIÓN PURA DE LOS ADJUNTOS QUE ENVÍA LA PERSONA (Core, «Envío de medios por consola», bloque B1).
 *
 * Sin Firebase, sin red, sin reloj: bytes adentro, veredicto afuera. La callable de B2 la llama
 * ANTES de tocar Storage o Firestore, y su veredicto es el único que cuenta (el navegador solo
 * ayuda: recodifica la imagen y rotula el tipo, pero un límite que solo vive en la pantalla no existe).
 *
 * Decisiones de Andres (10/11/2026, plan «Envío de medios por consola» §8-§10):
 * - D1 (a): imagen JPEG/PNG; audio Ogg/Opus MONO, mp3, m4a, aac; documento pdf, docx, xlsx, pptx SIN
 *   macros, txt. NO doc/xls/ppt antiguos, csv, zip, webp, video, amr.
 * - D6 (a): revisión por bytes y heurística en código. NO es un antivirus: es una barrera barata contra
 *   lo obvio (políglotas, macros, PDF activos, imágenes bomba, metadatos con ubicación).
 * - Solo Graph: el audio sale como Ogg/Opus mono (`voice: true`). Chrome graba WebM/Opus, así que aquí
 *   se REEMPAQUETA a Ogg/Opus en TypeScript puro (sin decodificar ni recodificar el audio).
 *
 * Todo lo que no se reconoce con certeza se NIEGA. El tipo lo deciden los PRIMEROS BYTES
 * (`tipoPorFirma` y `documentoPorFirma` de `tipos.ts`), nunca el mime ni la extensión declarados; la
 * extensión del nombre que sale se FUERZA a la detectada.
 *
 * Límites conocidos de la heurística (no ocultarlos): un PDF con las acciones dentro de un flujo de
 * objetos comprimido no se ve; un JPEG con una segunda imagen detrás de la primera conserva sus
 * metadatos; un docx se revisa por los NOMBRES de entrada en claro, no se descomprime.
 */
import {
  MB, MIMES_ACEPTADOS, MIME_BINARIO, TOPE_POR_TIPO, documentoPorFirma, mimeDeclarado, tipoPorFirma,
  type ExtensionDeMedio,
} from './tipos.js';

export type TipoDeAdjunto = 'image' | 'audio' | 'document';
export type ExtensionDeAdjunto = 'jpg' | 'png' | 'ogg' | 'mp3' | 'm4a' | 'aac' | 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'txt';

export type CodigoDeRechazo =
  | 'vacio'
  | 'demasiado_grande'
  | 'tipo_no_admitido'
  | 'tipo_no_coincide'
  | 'poliglota'
  | 'con_macros'
  | 'pdf_activo'
  | 'imagen_invalida'
  | 'imagen_dimensiones'
  | 'ogg_invalido'
  | 'ogg_sin_opushead'
  | 'no_mono'
  | 'webm_invalido';

export interface AdjuntoValido {
  ok: true;
  tipo: TipoDeAdjunto;
  ext: ExtensionDeAdjunto;
  /** El mime verificado por los bytes (el que se manda a Meta). */
  mime: string;
  /** Los bytes que se guardan y se envían: limpios (sin EXIF) o reempaquetados. */
  bytes: Buffer;
  /** Nombre saneado, 1 a 240 caracteres, con la extensión detectada. */
  nombre: string;
  /** `true` solo para Ogg/Opus mono: va como nota de voz. */
  voz: boolean;
  /** Se quitaron metadatos (EXIF/APPn, chunks de texto). */
  limpiado: boolean;
  /** Venía en WebM/Opus y se reempaquetó a Ogg/Opus. */
  reempaquetado: boolean;
}
export interface AdjuntoRechazado { ok: false; error: CodigoDeRechazo }
export type VeredictoDeAdjunto = AdjuntoValido | AdjuntoRechazado;

export const MAX_LADO_DE_IMAGEN = 4096;
export const LARGO_MAXIMO_DE_NOMBRE = 240;
/** Tope por tipo: las mismas cifras de los medios entrantes (imagen 5 MiB; audio y documento 16 MiB). */
export const TOPE_DE_ADJUNTO: Readonly<Record<TipoDeAdjunto, number>> = {
  image: TOPE_POR_TIPO.image,
  audio: TOPE_POR_TIPO.audio,
  document: TOPE_POR_TIPO.document,
};
const TOPE_ABSOLUTO = 16 * MB;

const rechazo = (error: CodigoDeRechazo): AdjuntoRechazado => ({ ok: false, error });

// ---------------------------------------------------------------------------
// CRC
// ---------------------------------------------------------------------------

/** CRC-32 de PNG/zlib (polinomio reflejado 0xEDB88320). */
const TABLA_CRC_PNG = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crcPng(partes: readonly Buffer[]): number {
  let c = 0xffffffff;
  for (const p of partes) for (const x of p) c = (TABLA_CRC_PNG[(c ^ x) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** CRC de Ogg: polinomio 0x04C11DB7 SIN reflejar, inicio 0 y sin xor final. */
const TABLA_CRC_OGG = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let r = n << 24;
    for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    t[n] = r >>> 0;
  }
  return t;
})();
export function crcOgg(bytes: Buffer): number {
  let c = 0;
  for (const x of bytes) c = (((c << 8) >>> 0) ^ (TABLA_CRC_OGG[((c >>> 24) ^ x) & 0xff] as number)) >>> 0;
  return c >>> 0;
}

// ---------------------------------------------------------------------------
// IMAGEN
// ---------------------------------------------------------------------------

type Limpieza = { bytes: Buffer; limpiado: boolean };

const esSof = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

/**
 * JPEG: recorre los segmentos hasta el primer SOS, exige un SOF con dimensiones ≤ 4.096 px, quita los
 * APP1 a APP15 (EXIF, XMP, ICC, GPS…) y los comentarios, y copia el resto tal cual. El JPEG debe
 * terminar en EOI (`FFD9`): nada pegado detrás.
 */
function limpiarJpeg(b: Buffer): Limpieza | AdjuntoRechazado {
  const n = b.length;
  if (n < 4 || b[n - 2] !== 0xff || b[n - 1] !== 0xd9) return rechazo('imagen_invalida');
  const partes: Buffer[] = [b.subarray(0, 2)];
  let limpiado = false;
  let dim: { w: number; h: number } | null = null;
  let i = 2;
  for (;;) {
    while (i < n && b[i] === 0xff && b[i + 1] === 0xff) i++; // relleno
    if (i + 1 >= n || b[i] !== 0xff) return rechazo('imagen_invalida');
    const m = b[i + 1] as number;
    if (m === 0xd9 || m === 0x00) return rechazo('imagen_invalida'); // EOI antes de SOS
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) { partes.push(b.subarray(i, i + 2)); i += 2; continue; }
    if (i + 4 > n) return rechazo('imagen_invalida');
    const largo = b.readUInt16BE(i + 2);
    const fin = i + 2 + largo;
    if (largo < 2 || fin > n) return rechazo('imagen_invalida');
    if (esSof(m)) {
      if (largo < 8) return rechazo('imagen_invalida');
      dim = { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    }
    if (m === 0xda) {
      if (!dim) return rechazo('imagen_invalida');
      partes.push(b.subarray(i)); // SOS y todos los datos de entropía, tal cual
      break;
    }
    if ((m >= 0xe1 && m <= 0xef) || m === 0xfe) limpiado = true;
    else partes.push(b.subarray(i, fin));
    i = fin;
  }
  if (!dim || dim.w < 1 || dim.h < 1) return rechazo('imagen_invalida');
  if (dim.w > MAX_LADO_DE_IMAGEN || dim.h > MAX_LADO_DE_IMAGEN) return rechazo('imagen_dimensiones');
  return { bytes: limpiado ? Buffer.concat(partes) : b, limpiado };
}

const CHUNKS_PNG_DE_METADATOS = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf']);

/**
 * PNG: IHDR primero con dimensiones ≤ 4.096 px, CRC de cada chunk verificado, IEND al final exacto
 * (sin datos detrás) y se descartan tEXt, zTXt, iTXt y eXIf.
 */
function limpiarPng(b: Buffer): Limpieza | AdjuntoRechazado {
  const n = b.length;
  const partes: Buffer[] = [b.subarray(0, 8)];
  let limpiado = false;
  let i = 8;
  let primero = true;
  let ihdrOk = false;
  for (;;) {
    if (i + 12 > n) return rechazo('imagen_invalida');
    const largo = b.readUInt32BE(i);
    const fin = i + 12 + largo;
    if (largo > n || fin > n) return rechazo('imagen_invalida');
    const tipo = b.toString('latin1', i + 4, i + 8);
    if (!/^[A-Za-z]{4}$/.test(tipo)) return rechazo('imagen_invalida');
    const datos = b.subarray(i + 8, i + 8 + largo);
    if (b.readUInt32BE(i + 8 + largo) !== crcPng([b.subarray(i + 4, i + 8), datos])) return rechazo('imagen_invalida');
    if (primero) {
      if (tipo !== 'IHDR' || largo !== 13) return rechazo('imagen_invalida');
      const w = datos.readUInt32BE(0);
      const h = datos.readUInt32BE(4);
      if (w < 1 || h < 1) return rechazo('imagen_invalida');
      if (w > MAX_LADO_DE_IMAGEN || h > MAX_LADO_DE_IMAGEN) return rechazo('imagen_dimensiones');
      ihdrOk = true;
      primero = false;
    } else if (tipo === 'IHDR') return rechazo('imagen_invalida');
    if (CHUNKS_PNG_DE_METADATOS.has(tipo)) limpiado = true;
    else partes.push(b.subarray(i, fin));
    i = fin;
    if (tipo === 'IEND') break;
  }
  if (!ihdrOk || i !== n) return rechazo('imagen_invalida');
  return { bytes: limpiado ? Buffer.concat(partes) : b, limpiado };
}

// ---------------------------------------------------------------------------
// OGG / OPUS
// ---------------------------------------------------------------------------

export interface PaginaOgg {
  /** Bits de cabecera: 0x01 continuación, 0x02 inicio (BOS), 0x04 fin (EOS). */
  banderas: number;
  granule: bigint;
  serie: number;
  secuencia: number;
  tabla: number[];
  datos: Buffer;
}

/**
 * Lee TODAS las páginas de un Ogg y verifica: captura `OggS`, versión 0, CRC de cada página, una sola
 * serie lógica, secuencia consecutiva, BOS solo en la primera y que no sobre ni un byte. `null` si
 * algo falla (un Ogg encadenado o con basura pegada también da `null`).
 */
export function leerPaginasOgg(b: Buffer): PaginaOgg[] | null {
  const paginas: PaginaOgg[] = [];
  let i = 0;
  while (i < b.length) {
    if (i + 27 > b.length || b.toString('latin1', i, i + 4) !== 'OggS' || b[i + 4] !== 0) return null;
    const nSeg = b[i + 26] as number;
    const inicioDatos = i + 27 + nSeg;
    if (inicioDatos > b.length) return null;
    const tabla = [...b.subarray(i + 27, inicioDatos)];
    const largoDatos = tabla.reduce((a, x) => a + x, 0);
    const fin = inicioDatos + largoDatos;
    if (fin > b.length) return null;
    const pagina = Buffer.from(b.subarray(i, fin));
    const crc = pagina.readUInt32LE(22);
    pagina.writeUInt32LE(0, 22);
    if (crcOgg(pagina) !== crc) return null;
    const p: PaginaOgg = {
      banderas: b[i + 5] as number,
      granule: b.readBigUInt64LE(i + 6),
      serie: b.readUInt32LE(i + 14),
      secuencia: b.readUInt32LE(i + 18),
      tabla,
      datos: b.subarray(inicioDatos, fin),
    };
    const anterior = paginas[paginas.length - 1];
    if (anterior) {
      if (p.serie !== anterior.serie || p.secuencia !== anterior.secuencia + 1 || (p.banderas & 0x02)) return null;
      if (anterior.banderas & 0x04) return null; // nada después del fin
    } else if (!(p.banderas & 0x02) || p.secuencia !== 0) return null;
    paginas.push(p);
    i = fin;
  }
  return paginas.length > 0 ? paginas : null;
}

/** Los paquetes COMPLETOS que empiezan en la página (cierra solo con un segmento < 255). */
function primerosPaquetes(p: PaginaOgg, max: number): Buffer[] {
  const out: Buffer[] = [];
  let acc = 0;
  let desde = 0;
  for (const s of p.tabla) {
    acc += s;
    if (s < 255) { out.push(p.datos.subarray(desde, desde + acc)); desde += acc; acc = 0; if (out.length >= max) break; }
  }
  return out;
}

/** Ogg válido, con `OpusHead` de 1 canal y `OpusTags` en el segundo paquete. */
function validarOggOpusMono(b: Buffer): AdjuntoRechazado | null {
  const paginas = leerPaginasOgg(b);
  if (!paginas) return rechazo('ogg_invalido');
  const [cabecera] = primerosPaquetes(paginas[0] as PaginaOgg, 1);
  if (!cabecera || cabecera.length < 19 || cabecera.toString('latin1', 0, 8) !== 'OpusHead') return rechazo('ogg_sin_opushead');
  if ((cabecera[8] as number) >> 4 !== 0) return rechazo('ogg_invalido'); // versión
  if (cabecera[9] !== 1) return rechazo('no_mono');
  if (cabecera[18] !== 0) return rechazo('ogg_invalido'); // solo mapeo de canales 0 (mono/estéreo)
  const segunda = paginas[1];
  const etiquetas = segunda ? primerosPaquetes(segunda, 1)[0] : undefined;
  if (!etiquetas || etiquetas.length < 16 || etiquetas.toString('latin1', 0, 8) !== 'OpusTags') return rechazo('ogg_invalido');
  return null;
}

// ---- WebM/Opus → Ogg/Opus ------------------------------------------------

const EBML_CABECERA = 0x1a45dfa3;
/** Elementos maestros por los que se DESCIENDE (sus hijos siguen en secuencia). */
const MAESTROS_WEBM = new Set([0x18538067 /* Segment */, 0x1f43b675 /* Cluster */, 0x1654ae6b /* Tracks */, 0xae /* TrackEntry */, 0xe1 /* Audio */, 0xa0 /* BlockGroup */]);
const MAX_PAQUETES_WEBM = 200_000;

const esWebm = (b: Buffer) => b.length >= 4 && b.readUInt32BE(0) === EBML_CABECERA;

/** Lee un identificador (se conservan los bits de marca) o un tamaño (se quitan); `null` tamaño = desconocido. */
function vint(b: Buffer, pos: number, id: boolean): { v: number | null; len: number } | null {
  const primero = b[pos];
  if (primero === undefined || primero === 0) return null;
  const len = Math.clz32(primero) - 23; // 1..8
  if (len < 1 || len > 8 || pos + len > b.length) return null;
  if (id && len > 4) return null;
  let v = id ? primero : primero & (0xff >> len);
  let todoUnos = (primero & (0xff >> len)) === (0xff >> len);
  for (let k = 1; k < len; k++) {
    const x = b[pos + k] as number;
    if (x !== 0xff) todoUnos = false;
    v = v * 256 + x;
  }
  if (!id && todoUnos) return { v: null, len };
  if (!id && v > Number.MAX_SAFE_INTEGER) return null;
  return { v, len };
}

const uint = (b: Buffer): number => b.reduce((a, x) => a * 256 + x, 0);

/** Duración en muestras de 48 kHz de un paquete Opus (RFC 6716 §3.1); `null` si está mal formado. */
function muestrasDePaqueteOpus(p: Buffer): number | null {
  if (p.length < 1) return null;
  const toc = p[0] as number;
  const config = toc >> 3;
  const ms = config < 12 ? [10, 20, 40, 60][config % 4] : config < 16 ? [10, 20][config % 2] : [2.5, 5, 10, 20][config % 4];
  const c = toc & 3;
  let tramas = c === 0 ? 1 : c === 3 ? 0 : 2;
  if (c === 3) { if (p.length < 2) return null; tramas = (p[1] as number) & 0x3f; }
  const muestras = (ms as number) * 48 * tramas;
  return tramas >= 1 && muestras <= 5760 ? muestras : null;
}

function paginaOgg(banderas: number, granule: bigint, secuencia: number, paquetes: readonly Buffer[]): Buffer {
  const tabla: number[] = [];
  for (const p of paquetes) {
    for (let r = p.length; r >= 255; r -= 255) tabla.push(255);
    tabla.push(p.length % 255);
  }
  const cab = Buffer.alloc(27 + tabla.length);
  cab.write('OggS', 0, 'latin1');
  cab[5] = banderas;
  cab.writeBigUInt64LE(granule, 6);
  cab.writeUInt32LE(SERIE_OGG, 14);
  cab.writeUInt32LE(secuencia, 18);
  cab[26] = tabla.length;
  Buffer.from(tabla).copy(cab, 27);
  const pagina = Buffer.concat([cab, ...paquetes]);
  pagina.writeUInt32LE(crcOgg(pagina), 22);
  return pagina;
}
const SERIE_OGG = 0x4e6f7675; // fija: la salida es determinista
const VENDEDOR = 'NovuChat';

/**
 * Reempaqueta un WebM con UNA pista Opus a Ogg/Opus, sin decodificar el audio: copia los paquetes
 * tal cual y arma `OpusHead` (el `CodecPrivate` de WebM ya lo es), `OpusTags` y páginas con CRC.
 * Rechaza lo que no sea una sola pista `A_OPUS` mono, y los bloques con «lacing».
 */
export function reempaquetarWebmOpusAOgg(b: Buffer): { ok: true; bytes: Buffer } | AdjuntoRechazado {
  if (!esWebm(b)) return rechazo('webm_invalido');
  type Pista = { num?: number; codec?: string; priv?: Buffer; canales?: number };
  const pistas: Pista[] = [];
  const bloques: { pista: number; trama: Buffer }[] = [];
  let pos = 0;
  while (pos < b.length) {
    const id = vint(b, pos, true);
    if (!id || id.v === null) return rechazo('webm_invalido');
    const sz = vint(b, pos + id.len, false);
    if (!sz) return rechazo('webm_invalido');
    const ini = pos + id.len + sz.len;
    if (MAESTROS_WEBM.has(id.v)) {
      if (id.v === 0xae) pistas.push({});
      pos = ini;
      continue;
    }
    if (sz.v === null) return rechazo('webm_invalido');
    const fin = ini + sz.v;
    if (fin > b.length) return rechazo('webm_invalido');
    const dato = b.subarray(ini, fin);
    const pista = pistas[pistas.length - 1];
    if (id.v === 0xd7 && pista) pista.num = uint(dato);
    else if (id.v === 0x86 && pista) pista.codec = dato.toString('latin1');
    else if (id.v === 0x63a2 && pista) pista.priv = dato;
    else if (id.v === 0x9f && pista) pista.canales = uint(dato);
    else if (id.v === 0xa3 || id.v === 0xa1) {
      const num = vint(dato, 0, false);
      if (!num || num.v === null || dato.length < num.len + 4) return rechazo('webm_invalido');
      if ((dato[num.len + 2] as number) & 0x06) return rechazo('webm_invalido'); // lacing
      if (bloques.length >= MAX_PAQUETES_WEBM) return rechazo('webm_invalido');
      bloques.push({ pista: num.v, trama: dato.subarray(num.len + 3) });
    }
    pos = fin;
  }
  if (pistas.length !== 1) return rechazo('webm_invalido');
  const [p] = pistas as [Pista];
  if (p.codec !== 'A_OPUS' || p.num === undefined || !p.priv) return rechazo('webm_invalido');
  const cabecera = p.priv;
  if (cabecera.length < 19 || cabecera.toString('latin1', 0, 8) !== 'OpusHead') return rechazo('ogg_sin_opushead');
  if (cabecera[9] !== 1 || (p.canales !== undefined && p.canales !== 1)) return rechazo('no_mono');
  if (cabecera[18] !== 0 || ((cabecera[8] as number) >> 4) !== 0) return rechazo('webm_invalido');
  const tramas = bloques.filter(x => x.pista === p.num).map(x => x.trama);
  if (tramas.length === 0) return rechazo('webm_invalido');

  const vendedor = Buffer.from(VENDEDOR, 'latin1');
  const etiquetas = Buffer.alloc(8 + 4 + vendedor.length + 4);
  etiquetas.write('OpusTags', 0, 'latin1');
  etiquetas.writeUInt32LE(vendedor.length, 8);
  vendedor.copy(etiquetas, 12);

  const paginas: Buffer[] = [paginaOgg(0x02, 0n, 0, [Buffer.from(cabecera.subarray(0, 19))]), paginaOgg(0, 0n, 1, [etiquetas])];
  let secuencia = 2;
  let acumulado = 0n;
  let lote: Buffer[] = [];
  let segmentos = 0;
  let granuleDelLote = 0n;
  const volcar = (ultima: boolean) => {
    if (lote.length === 0) return;
    paginas.push(paginaOgg(ultima ? 0x04 : 0, granuleDelLote, secuencia++, lote));
    lote = []; segmentos = 0;
  };
  for (let k = 0; k < tramas.length; k++) {
    const t = tramas[k] as Buffer;
    const muestras = muestrasDePaqueteOpus(t);
    if (muestras === null) return rechazo('webm_invalido');
    const seg = Math.floor(t.length / 255) + 1;
    if (seg > 255) return rechazo('webm_invalido');
    if (segmentos + seg > 255 || lote.length >= 25) volcar(false);
    lote.push(t); segmentos += seg;
    acumulado += BigInt(muestras);
    granuleDelLote = acumulado;
  }
  volcar(true);
  return { ok: true, bytes: Buffer.concat(paginas) };
}

// ---------------------------------------------------------------------------
// DOCUMENTOS
// ---------------------------------------------------------------------------

const ZIP_LOCAL = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const ZIP_FIN = Buffer.from([0x50, 0x4b, 0x05, 0x06]);

const tieneZipDentro = (b: Buffer) =>
  b.subarray(0, 1024).includes(ZIP_LOCAL) || b.subarray(Math.max(0, b.length - (65_535 + 22))).includes(ZIP_FIN);

const DOCUMENTOS_PERMITIDOS: ReadonlySet<string> = new Set(['pdf', 'docx', 'xlsx', 'pptx', 'txt']);
const MIME_POR_EXTENSION: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
};

/**
 * Heurística de PDF activo sobre el texto del archivo, con los nombres `#xx` decodificados (así
 * `/J#61vaScript` no se escapa): `/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile`, y `/OpenAction` que
 * no sea un destino (`[ … ]`), es decir, que lleve una acción. No es un antivirus.
 */
export function pdfEsActivo(b: Buffer): boolean {
  const texto = b.toString('latin1').replace(/#([0-9a-fA-F]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
  if (/\/(?:JavaScript|JS|Launch|EmbeddedFile)(?=[\s()<>[\]{}/%]|$)/.test(texto)) return true;
  for (const m of texto.matchAll(/\/OpenAction(?=[\s()<>[\]{}/%]|$)\s*(.?)/g)) if (m[1] !== '[') return true;
  return false;
}

// ---------------------------------------------------------------------------
// NOMBRE
// ---------------------------------------------------------------------------

/**
 * Nombre saneado: sin controles, sin marcas bidireccionales (RLO y compañía), sin separadores de ruta
 * ni caracteres de Windows, sin puntos internos (`factura.pdf.exe` → `factura_pdf`) y con la
 * extensión FORZADA a la detectada. Largo total entre 1 y 240 caracteres; sin nombre, `archivo`.
 */
export function sanearNombre(nombre: unknown, ext: ExtensionDeAdjunto): string {
  let base = typeof nombre === 'string' ? nombre.normalize('NFC') : '';
  base = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/[​-‏‪-‮⁠-⁯﻿￹-￻]/g, '')
    .replace(/[\\/<>:"|?*]/g, '_');
  const ultimoPunto = base.lastIndexOf('.');
  if (ultimoPunto > 0 && /^\.[A-Za-z0-9]{1,8}$/.test(base.slice(ultimoPunto))) base = base.slice(0, ultimoPunto);
  base = base.replace(/\./g, '_').replace(/^[\s_]+|[\s_]+$/g, '');
  const sufijo = `.${ext}`;
  const cupo = LARGO_MAXIMO_DE_NOMBRE - sufijo.length;
  const unidades = [...base];
  base = unidades.length > cupo ? unidades.slice(0, cupo).join('').replace(/\s+$/, '') : base;
  return `${base || 'archivo'}${sufijo}`;
}

// ---------------------------------------------------------------------------
// EL VEREDICTO
// ---------------------------------------------------------------------------

export interface OpcionesDeAdjunto {
  /** Nombre que dio la consola (solo para derivar el nombre saneado y, sin mime, la pista de documento). */
  nombre?: unknown;
  /** Content-Type declarado: nunca decide, solo debe COINCIDIR con lo que dicen los bytes. */
  mime?: unknown;
  /** Lo que dice la consola que es; si los bytes dicen otra cosa, `tipo_no_coincide`. */
  tipo?: TipoDeAdjunto;
}

const EXT_DE_IMAGEN_Y_AUDIO: Readonly<Record<string, TipoDeAdjunto>> = {
  jpg: 'image', png: 'image', ogg: 'audio', mp3: 'audio', m4a: 'audio', aac: 'audio',
};

/**
 * Decide, sin tocar nada, si estos bytes se pueden enviar como adjunto de la persona. Devuelve los bytes
 * que se guardan (limpios o reempaquetados), el mime verificado, el nombre saneado y si va como voz.
 */
export function validarAdjunto(bytes: Buffer, opciones: OpcionesDeAdjunto = {}): VeredictoDeAdjunto {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) return rechazo('vacio');
  if (bytes.length > TOPE_ABSOLUTO) return rechazo('demasiado_grande');
  const declarado = mimeDeclarado(opciones.mime);
  const sinDeclarar = declarado === '' || declarado === MIME_BINARIO;

  // 1. Audio de Chrome: WebM/Opus → Ogg/Opus.
  let datos = bytes;
  let reempaquetado = false;
  if (esWebm(bytes)) {
    if (!sinDeclarar && declarado !== 'audio/webm' && declarado !== 'video/webm') return rechazo('tipo_no_coincide');
    const r = reempaquetarWebmOpusAOgg(bytes);
    if (!r.ok) return r;
    datos = r.bytes;
    reempaquetado = true;
  }

  // 2. Imagen o audio por la firma; si no, documento.
  const firma = tipoPorFirma(datos);
  const esMedio = firma !== null && firma.tipo !== 'document';
  let tipo: TipoDeAdjunto;
  let ext: ExtensionDeAdjunto;
  let mime: string;

  if (esMedio) {
    const e = firma.ext as ExtensionDeMedio;
    if (EXT_DE_IMAGEN_Y_AUDIO[e] === undefined) return rechazo('tipo_no_admitido'); // webp, amr, mp4, 3gp
    ext = e as ExtensionDeAdjunto;
    tipo = EXT_DE_IMAGEN_Y_AUDIO[e] as TipoDeAdjunto;
    mime = firma.mime;
    if (!reempaquetado && !sinDeclarar && !(MIMES_ACEPTADOS[e] ?? []).includes(declarado)) return rechazo('tipo_no_coincide');
  } else {
    if (datos.subarray(0, 5).toString('latin1') === '%PDF-' && tieneZipDentro(datos)) return rechazo('poliglota');
    if (datos.subarray(0, 4).equals(ZIP_LOCAL) && datos.includes(Buffer.from('vbaProject.bin'))) return rechazo('con_macros');
    const extNombre = typeof opciones.nombre === 'string' ? (/\.([A-Za-z0-9]{1,8})$/.exec(opciones.nombre)?.[1] ?? '').toLowerCase() : '';
    const candidato = sinDeclarar ? (MIME_POR_EXTENSION[extNombre] ?? '') : declarado;
    const d = documentoPorFirma(datos, candidato);
    if (!DOCUMENTOS_PERMITIDOS.has(d.ext)) return rechazo('tipo_no_admitido');
    ext = d.ext as ExtensionDeAdjunto;
    tipo = 'document';
    mime = d.mime;
  }

  if (opciones.tipo !== undefined && opciones.tipo !== tipo) return rechazo('tipo_no_coincide');
  if (bytes.length > TOPE_DE_ADJUNTO[tipo]) return rechazo('demasiado_grande');

  // 3. Revisión y limpieza por formato.
  let salida = datos;
  let limpiado = false;
  if (ext === 'jpg' || ext === 'png') {
    const r = ext === 'jpg' ? limpiarJpeg(datos) : limpiarPng(datos);
    if ('ok' in r) return r;
    salida = r.bytes; limpiado = r.limpiado;
    if (salida.length > TOPE_DE_ADJUNTO.image) return rechazo('demasiado_grande');
  } else if (ext === 'ogg') {
    const r = validarOggOpusMono(datos);
    if (r) return r;
  } else if (ext === 'pdf') {
    if (pdfEsActivo(datos)) return rechazo('pdf_activo');
  }

  return {
    ok: true, tipo, ext, mime, bytes: salida, nombre: sanearNombre(opciones.nombre, ext),
    voz: ext === 'ogg', limpiado, reempaquetado,
  };
}
