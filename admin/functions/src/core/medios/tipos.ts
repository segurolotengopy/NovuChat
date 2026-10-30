/**
 * El TIPO de un medio se decide por los PRIMEROS BYTES, nunca por lo que declara
 * quien sube (contrato de medios v2, 30/10/2026: «guardar y descargar TODO»).
 *
 * - **image / audio / video**: la firma decide la categoría. Una «imagen» que es
 *   HTML, SVG o un ejecutable, o un «video» que es un audio m4a, da 415: WhatsApp
 *   nunca manda eso, así que es un flujo roto o un token robado.
 * - **document**: se GUARDA cualquier cosa (Andres, 30/10/2026). Lo único que los
 *   bytes deciden es la EXTENSIÓN y el MIME guardados (`documentoPorFirma`), de una
 *   lista cerrada; todo lo que no se reconoce con certeza es `bin` y
 *   `application/octet-stream`. El mime que declara Meta nunca se guarda tal cual.
 *   El objeto de Storage de un documento lleva SIEMPRE `application/octet-stream`
 *   (`contentTypeDeObjeto`): un documento no se sirve ni se abre en línea.
 *
 * El modo ANOTAR (docx/xlsx sin bytes, contrato M1-M2 §1) se MANTIENE por
 * compatibilidad: los flujos publicados lo usan hasta que se republiquen; se quita
 * en un PR aparte.
 */

export const MB = 1024 * 1024;

export type TipoDeMedio = 'image' | 'audio' | 'video' | 'document';
export type ExtensionDeDocumento = 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'zip' | 'doc' | 'xls' | 'ppt' | 'txt' | 'csv' | 'bin';
export type ExtensionDeMedio =
  | 'jpg' | 'png' | 'webp' | 'ogg' | 'm4a' | 'mp3' | 'aac' | 'amr' | 'mp4' | '3gp' | ExtensionDeDocumento;

/**
 * Topes por tipo: imagen 5 MB y audio 16 MB (Andres, 22/10/2026); video 16 MB y
 * documento 16 MB de cualquier tipo (contrato v2, 30/10/2026: WhatsApp permite 100 MB
 * en documentos, pero manda el tope de Andres). Más grande: 413 `demasiado_grande`.
 */
export const TOPE_POR_TIPO: Record<TipoDeMedio, number> = {
  image: 5 * MB,
  audio: 16 * MB,
  video: 16 * MB,
  document: 16 * MB,
};

export const TIPOS_DE_MEDIO: readonly TipoDeMedio[] = ['image', 'audio', 'video', 'document'];

export const esTipoDeMedio = (v: unknown): v is TipoDeMedio =>
  typeof v === 'string' && (TIPOS_DE_MEDIO as readonly string[]).includes(v);

/**
 * Qué `tipo` del mensaje ENTRANTE registrado por la ingesta corresponde a cada
 * `X-NovuChat-Tipo`. El sticker de WhatsApp llega como `image` webp; si la ingesta
 * lo registra como `sticker`, igual corresponde. La ingesta tiene `video` y `sticker`
 * en su lista cerrada (`TIPOS` de `ingesta.ts`) desde el 30/10/2026. `otro` NO se
 * acepta a propósito: abriría el guardado a cualquier mensaje no clasificado.
 */
export const TIPOS_DE_MENSAJE: Readonly<Record<TipoDeMedio, readonly string[]>> = {
  image: ['image', 'sticker'],
  audio: ['audio'],
  video: ['video'],
  document: ['document'],
};

export interface FirmaDeMedio { ext: ExtensionDeMedio; tipo: TipoDeMedio; mime: string }

/** Los Content-Type que se aceptan como declaración de cada extensión de imagen, audio o video. */
export const MIMES_ACEPTADOS: Partial<Record<ExtensionDeMedio, readonly string[]>> = {
  // Alias rescatados de la rama `core/guardar-medio-servidor` (29/10/2026): los bytes siguen
  // decidiendo el tipo; el alias solo evita un 415 a un medio legítimo rotulado con la variante.
  jpg: ['image/jpeg', 'image/jpg'],
  png: ['image/png'],
  webp: ['image/webp'],
  ogg: ['audio/ogg', 'application/ogg'],
  // Un audio AAC de un iPhone viaja en contenedor MP4 y Meta puede rotularlo `audio/aac`.
  m4a: ['audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac'],
  mp3: ['audio/mpeg', 'audio/mp3'],
  aac: ['audio/aac'],
  amr: ['audio/amr', 'audio/3gpp'],
  mp4: ['video/mp4'],
  '3gp': ['video/3gpp', 'video/3gpp2'],
};

/**
 * Marcas `ftyp` de AUDIO: solo M4A y M4B. Las de VIDEO son una lista DISJUNTA (adenda §7.2): un
 * video no es un audio ni al revés. Si un medio legítimo llegara con otra marca, da 415 y se agrega
 * con evidencia; no se abre de más.
 */
export const MARCAS_FTYP_AUDIO: ReadonlySet<string> = new Set(['M4A ', 'M4B ']);
export const MARCAS_FTYP_MP4: ReadonlySet<string> = new Set(['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'MSNV', 'dash']);
export const MARCAS_FTYP_3GP: ReadonlySet<string> = new Set(['3gp4', '3gp5', '3gp6', '3gg6', '3g2a']);

const texto = (bytes: Buffer, desde: number, hasta: number) => bytes.subarray(desde, hasta).toString('latin1');
const ZIP_LOCAL = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const ZIP_FIN = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/**
 * ¿Es un ZIP en alguna parte? Un encabezado local en los primeros 1024 bytes, o el fin de directorio
 * central en los últimos 64 KiB + 22 (donde lo buscan los lectores de ZIP, que leen desde el FINAL).
 */
function tieneZip(bytes: Buffer): boolean {
  if (bytes.subarray(0, 1024).includes(ZIP_LOCAL)) return true;
  return bytes.subarray(Math.max(0, bytes.length - (65_535 + 22))).includes(ZIP_FIN);
}

/** Un PDF LIMPIO: empieza con `%PDF-` y no es a la vez un ZIP (políglota: docx, APK, jar). */
const esPdfLimpio = (bytes: Buffer): boolean =>
  bytes.length >= 5 && texto(bytes, 0, 5) === '%PDF-' && !tieneZip(bytes);

/** El tamaño de la primera caja ISO-BMFF (`ftyp`) es al menos 8 y cabe en el archivo. */
const cajaFtypValida = (bytes: Buffer): boolean => {
  if (bytes.length < 12) return false;
  const tam = bytes.readUInt32BE(0);
  return tam >= 8 && tam <= bytes.length;
};

/** La categoría (image|audio|video, y pdf como document) por la firma; `null` si no se reconoce. */
export function tipoPorFirma(bytes: Buffer): FirmaDeMedio | null {
  const n = bytes.length;
  const b = (i: number) => bytes[i] as number;
  if (n >= 3 && b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return { ext: 'jpg', tipo: 'image', mime: 'image/jpeg' };
  if (n >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: 'png', tipo: 'image', mime: 'image/png' };
  }
  if (n >= 12 && texto(bytes, 0, 4) === 'RIFF' && texto(bytes, 8, 12) === 'WEBP') {
    return { ext: 'webp', tipo: 'image', mime: 'image/webp' };
  }
  if (n >= 4 && texto(bytes, 0, 4) === 'OggS') return { ext: 'ogg', tipo: 'audio', mime: 'audio/ogg' };
  if (n >= 12 && texto(bytes, 4, 8) === 'ftyp') {
    const marca = texto(bytes, 8, 12);
    if (MARCAS_FTYP_AUDIO.has(marca)) return { ext: 'm4a', tipo: 'audio', mime: 'audio/mp4' };
    if (cajaFtypValida(bytes) && MARCAS_FTYP_MP4.has(marca)) return { ext: 'mp4', tipo: 'video', mime: 'video/mp4' };
    if (cajaFtypValida(bytes) && MARCAS_FTYP_3GP.has(marca)) return { ext: '3gp', tipo: 'video', mime: 'video/3gpp' };
    return null;
  }
  if (n >= 5 && texto(bytes, 0, 5) === '#!AMR') return { ext: 'amr', tipo: 'audio', mime: 'audio/amr' };
  if (n >= 3 && texto(bytes, 0, 3) === 'ID3') return { ext: 'mp3', tipo: 'audio', mime: 'audio/mpeg' };
  if (n >= 2 && b(0) === 0xff && (b(1) === 0xf1 || b(1) === 0xf9)) return { ext: 'aac', tipo: 'audio', mime: 'audio/aac' };
  // Trama MPEG capa III: sincronía de 11 bits y capa = 01 (excluye ADTS, cuya capa es 00).
  if (n >= 2 && b(0) === 0xff && (b(1) & 0xe0) === 0xe0 && (b(1) & 0x06) === 0x02 && (b(1) & 0x18) !== 0x08) {
    return { ext: 'mp3', tipo: 'audio', mime: 'audio/mpeg' };
  }
  if (esPdfLimpio(bytes)) return { ext: 'pdf', tipo: 'document', mime: 'application/pdf' };
  return null;
}

// ---------------------------------------------------------------------------
// DOCUMENTOS: extensión y mime guardados, de una lista cerrada (adenda §7.1)
// ---------------------------------------------------------------------------

const FORMA_DE_MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/;

/**
 * El mime declarado, sin parámetros (`audio/ogg; codecs=opus` → `audio/ogg`). Lo que no tiene forma
 * de mime (CR/LF, espacios internos, comillas, vacío) da `''`: nunca coincide con una lista cerrada.
 */
export const mimeDeclarado = (v: unknown): string => {
  const crudo = String(v ?? '');
  if (/[\r\n\0]/.test(crudo)) return '';
  const m = (crudo.split(';')[0] ?? '').trim().toLowerCase().slice(0, 129);
  return FORMA_DE_MIME.test(m) ? m : '';
};

export const MIME_BINARIO = 'application/octet-stream';

/** El mime GUARDADO de cada extensión de documento (y el único que la consola puede recibir). */
export const MIME_DE_DOCUMENTO: Readonly<Record<ExtensionDeDocumento, string>> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
  ppt: 'application/vnd.ms-powerpoint',
  txt: 'text/plain',
  csv: 'text/csv',
  bin: MIME_BINARIO,
};

export const EXTENSIONES_DE_DOCUMENTO = Object.keys(MIME_DE_DOCUMENTO) as readonly ExtensionDeDocumento[];

/** Qué carpeta interna exige cada formato Office moderno (un nombre de entrada del ZIP, en claro). */
const CARPETA_OOXML: Readonly<Record<'docx' | 'xlsx' | 'pptx', string>> = { docx: 'word/', xlsx: 'xl/', pptx: 'ppt/' };
const OOXML_POR_MIME: Readonly<Record<string, 'docx' | 'xlsx' | 'pptx'>> = {
  [MIME_DE_DOCUMENTO.docx]: 'docx',
  [MIME_DE_DOCUMENTO.xlsx]: 'xlsx',
  [MIME_DE_DOCUMENTO.pptx]: 'pptx',
};
const ZIP_POR_MIME = new Set(['application/zip', 'application/x-zip-compressed']);
const OLE_POR_MIME: Readonly<Record<string, 'doc' | 'xls' | 'ppt'>> = {
  [MIME_DE_DOCUMENTO.doc]: 'doc',
  [MIME_DE_DOCUMENTO.xls]: 'xls',
  [MIME_DE_DOCUMENTO.ppt]: 'ppt',
};
const TEXTO_POR_MIME: Readonly<Record<string, 'txt' | 'csv'>> = { 'text/plain': 'txt', 'text/csv': 'csv' };

const propio = <T>(o: Readonly<Record<string, T>>, k: string): T | undefined =>
  (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

const BINARIO: { ext: ExtensionDeDocumento; mime: string } = { ext: 'bin', mime: MIME_BINARIO };
const documento = (ext: ExtensionDeDocumento) => ({ ext, mime: MIME_DE_DOCUMENTO[ext] });

function esUtf8Valido(bytes: Buffer): boolean {
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return true; } catch { return false; }
}

/**
 * LA FUNCIÓN ÚNICA de documentos (adenda §7.1): la usan `guardarMedio` al guardar y `verMedio` al leer
 * (que la recalcula desde los BYTES y no confía en el `ext` de Firestore). Pura y total: nunca lanza, y
 * todo lo que no se reconoce con certeza es `bin` + `application/octet-stream`.
 *
 * - `pdf`: `%PDF-` y NO es a la vez un ZIP. Un PDF-ZIP políglota es `bin`.
 * - `docx/xlsx/pptx`: ZIP + el mime declarado EXACTO + la carpeta interna (`word/`, `xl/`, `ppt/`) +
 *   `[Content_Types].xml`, y SIN `vbaProject.bin` (macros: `bin`). Los mimes con macros (docm, xlsm,
 *   pptm) no están en la lista: `bin`. Nunca se descomprime nada: solo se buscan nombres en claro.
 * - `zip`: ZIP declarado `application/zip` (o la variante de Windows). Un ZIP con `%PDF-` en sus
 *   primeros 1024 bytes es un políglota: `bin`.
 * - `doc/xls/ppt`: la firma OLE `D0CF11E0A1B11AE1` + el mime declarado exacto.
 * - `txt/csv`: mime `text/plain` o `text/csv`, sin ningún byte NUL y UTF-8 válido.
 *
 * Idempotente: `documentoPorFirma(b, documentoPorFirma(b, m).mime)` da lo mismo, así que `verMedio`
 * llega al mismo resultado con el `mime` guardado en `mediosRecibidos`.
 */
export function documentoPorFirma(bytes: Buffer, declarado: unknown): { ext: ExtensionDeDocumento; mime: string } {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) return { ...BINARIO };
  const m = mimeDeclarado(declarado);
  if (esPdfLimpio(bytes)) return documento('pdf');
  if (bytes.length >= 4 && bytes.subarray(0, 4).equals(ZIP_LOCAL)) {
    if (bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) return { ...BINARIO };
    const ooxml = propio(OOXML_POR_MIME, m);
    if (ooxml) {
      const ok = bytes.includes(Buffer.from('[Content_Types].xml')) && bytes.includes(Buffer.from(CARPETA_OOXML[ooxml]))
        && !bytes.includes(Buffer.from('vbaProject.bin'));
      return ok ? documento(ooxml) : { ...BINARIO };
    }
    return ZIP_POR_MIME.has(m) ? documento('zip') : { ...BINARIO };
  }
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(OLE)) {
    const ole = propio(OLE_POR_MIME, m);
    return ole ? documento(ole) : { ...BINARIO };
  }
  const deTexto = propio(TEXTO_POR_MIME, m);
  if (deTexto && !bytes.includes(0) && esUtf8Valido(bytes)) return documento(deTexto);
  return { ...BINARIO };
}

/**
 * El `contentType` con el que se ESCRIBE el objeto en Storage: el mime verificado para imagen, audio y
 * video; `application/octet-stream` para TODO documento (contrato v2 §1), aunque sea un PDF.
 */
export const contentTypeDeObjeto = (firma: { tipo: TipoDeMedio; mime: string }): string =>
  (firma.tipo === 'document' ? MIME_BINARIO : firma.mime);

// ---------------------------------------------------------------------------
// EL VEREDICTO (puro: se prueba sin Firestore)
// ---------------------------------------------------------------------------

export type Rechazo = { codigo: 400 | 413 | 415; cuerpo: { error: string } };
export type VeredictoDeGuardar = { ok: true; firma: FirmaDeMedio } | ({ ok: false } & Rechazo);

/**
 * Decide, sin tocar nada, si estos bytes se guardan: 400 `vacio`, 413 `demasiado_grande` (por el tope
 * del tipo DECLARADO, antes de mirar los bytes). Para imagen, audio y video, 415 `tipo_no_admitido` si
 * la firma no está en la lista o no coincide con la cabecera de tipo o con el Content-Type. Un
 * documento NUNCA da 415: se guarda con la extensión y el mime de `documentoPorFirma`.
 */
export function veredictoDe(bytes: Buffer, tipo: TipoDeMedio, contentType: unknown): VeredictoDeGuardar {
  if (bytes.length === 0) return { ok: false, codigo: 400, cuerpo: { error: 'vacio' } };
  if (bytes.length > TOPE_POR_TIPO[tipo]) return { ok: false, codigo: 413, cuerpo: { error: 'demasiado_grande' } };
  if (tipo === 'document') {
    const d = documentoPorFirma(bytes, contentType);
    return { ok: true, firma: { ext: d.ext, tipo: 'document', mime: d.mime } };
  }
  const firma = tipoPorFirma(bytes);
  if (!firma || firma.tipo !== tipo || !(MIMES_ACEPTADOS[firma.ext] ?? []).includes(mimeDeclarado(contentType))) {
    return { ok: false, codigo: 415, cuerpo: { error: 'tipo_no_admitido' } };
  }
  return { ok: true, firma };
}

/** Lo único que se ANOTA sin bytes (contrato M1-M2 §1, compatibilidad): Word y Excel modernos. */
export const MIMES_ANOTABLES: Readonly<Record<string, 'docx' | 'xlsx'>> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

export type VeredictoDeAnotar = { ok: true; mime: string; ext: 'docx' | 'xlsx' } | ({ ok: false } & Rechazo);

/**
 * El modo ANOTAR (`X-NovuChat-Anotar: 1`), SOLO por compatibilidad con los flujos ya publicados: el
 * flujo no descargó los bytes. Exige cuerpo VACÍO (con cuerpo: 400 `anotar_con_cuerpo`, porque anotar
 * con bytes sería una puerta para guardar sin pasar por la firma), tipo `document` y un mime de docx o
 * xlsx; cualquier otro, 415.
 */
export function veredictoDeAnotar(bytes: Buffer, tipo: TipoDeMedio, mime: unknown): VeredictoDeAnotar {
  if (bytes.length !== 0) return { ok: false, codigo: 400, cuerpo: { error: 'anotar_con_cuerpo' } };
  const m = mimeDeclarado(mime);
  const ext = propio(MIMES_ANOTABLES, m);
  if (tipo !== 'document' || !ext) return { ok: false, codigo: 415, cuerpo: { error: 'tipo_no_admitido' } };
  return { ok: true, mime: m, ext };
}
