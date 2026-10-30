/**
 * El TIPO de un medio se decide por los PRIMEROS BYTES, nunca por lo que declara
 * quien sube. SVG, HTML, docx, xlsx y todo lo que no esté en la lista cerrada
 * dan `null` (415): un SVG o un HTML guardado y servido después es un vector
 * de script. docx y xlsx NO se guardan (Andres, 23 y 29/10/2026): con la
 * cabecera `X-NovuChat-Anotar: 1` y el cuerpo vacío solo se ANOTA que llegaron
 * (`veredictoDeAnotar`); con bytes dan 415 como cualquier otro tipo fuera de la lista.
 */

export const MB = 1024 * 1024;

export type TipoDeMedio = 'image' | 'audio' | 'document';
export type ExtensionDeMedio = 'jpg' | 'png' | 'webp' | 'ogg' | 'm4a' | 'mp3' | 'aac' | 'amr' | 'pdf';

/** Topes por tipo (Andres, 22/10/2026): imagen 5 MB, audio 16 MB (el de WhatsApp), PDF 10 MB. */
export const TOPE_POR_TIPO: Record<TipoDeMedio, number> = {
  image: 5 * MB,
  audio: 16 * MB,
  document: 10 * MB,
};

export const TIPOS_DE_MEDIO: readonly TipoDeMedio[] = ['image', 'audio', 'document'];

export const esTipoDeMedio = (v: unknown): v is TipoDeMedio =>
  typeof v === 'string' && (TIPOS_DE_MEDIO as readonly string[]).includes(v);

export interface FirmaDeMedio { ext: ExtensionDeMedio; tipo: TipoDeMedio; mime: string }

/** Los Content-Type que se aceptan como declaración de cada extensión. */
export const MIMES_ACEPTADOS: Record<ExtensionDeMedio, readonly string[]> = {
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
  pdf: ['application/pdf'],
};

// Solo M4A y M4B: `isom`, `mp41`, `mp42` e `iso2` también las usa el VIDEO MP4, y un video no es un audio
// (revisión de seguridad del #617). Un audio m4a de WhatsApp declara M4A; si alguno llegara con otra marca,
// da 415 y se corrige con evidencia, no se abre de más.
const MARCAS_FTYP = new Set(['M4A ', 'M4B ']);
const texto = (bytes: Buffer, desde: number, hasta: number) => bytes.subarray(desde, hasta).toString('latin1');

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
  if (n >= 12 && texto(bytes, 4, 8) === 'ftyp' && MARCAS_FTYP.has(texto(bytes, 8, 12))) {
    return { ext: 'm4a', tipo: 'audio', mime: 'audio/mp4' };
  }
  if (n >= 5 && texto(bytes, 0, 5) === '#!AMR') return { ext: 'amr', tipo: 'audio', mime: 'audio/amr' };
  if (n >= 3 && texto(bytes, 0, 3) === 'ID3') return { ext: 'mp3', tipo: 'audio', mime: 'audio/mpeg' };
  if (n >= 2 && b(0) === 0xff && (b(1) === 0xf1 || b(1) === 0xf9)) return { ext: 'aac', tipo: 'audio', mime: 'audio/aac' };
  // Trama MPEG capa III: sincronía de 11 bits y capa = 01 (excluye ADTS, cuya capa es 00).
  if (n >= 2 && b(0) === 0xff && (b(1) & 0xe0) === 0xe0 && (b(1) & 0x06) === 0x02 && (b(1) & 0x18) !== 0x08) {
    return { ext: 'mp3', tipo: 'audio', mime: 'audio/mpeg' };
  }
  // Un PDF que a la vez es un ZIP (docx, APK, jar) en sus primeros bytes es un políglota: se rechaza.
  if (n >= 5 && texto(bytes, 0, 5) === '%PDF-' && !bytes.subarray(0, 1024).includes(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return { ext: 'pdf', tipo: 'document', mime: 'application/pdf' };
  return null;
}

// ---------------------------------------------------------------------------
// EL VEREDICTO (puro: se prueba sin Firestore)
// ---------------------------------------------------------------------------

/** El mime declarado, sin parámetros (`audio/ogg; codecs=opus` → `audio/ogg`). */
export const mimeDeclarado = (v: unknown): string =>
  (String(v ?? '').split(';')[0] ?? '').trim().toLowerCase().slice(0, 120);

export type Rechazo = { codigo: 400 | 413 | 415; cuerpo: { error: string } };
export type VeredictoDeGuardar = { ok: true; firma: FirmaDeMedio } | ({ ok: false } & Rechazo);

/**
 * Decide, sin tocar nada, si estos bytes se guardan: 400 `vacio`, 413 `demasiado_grande`
 * (por el tope del tipo DECLARADO, antes de mirar los bytes) o 415 `tipo_no_admitido` si la
 * firma no está en la lista o no coincide con la cabecera de tipo o con el Content-Type.
 */
export function veredictoDe(bytes: Buffer, tipo: TipoDeMedio, contentType: unknown): VeredictoDeGuardar {
  if (bytes.length === 0) return { ok: false, codigo: 400, cuerpo: { error: 'vacio' } };
  if (bytes.length > TOPE_POR_TIPO[tipo]) return { ok: false, codigo: 413, cuerpo: { error: 'demasiado_grande' } };
  const firma = tipoPorFirma(bytes);
  if (!firma || firma.tipo !== tipo || !MIMES_ACEPTADOS[firma.ext].includes(mimeDeclarado(contentType))) {
    return { ok: false, codigo: 415, cuerpo: { error: 'tipo_no_admitido' } };
  }
  return { ok: true, firma };
}

/** Lo único que se ANOTA sin bytes (contrato M1-M2 §1): Word y Excel modernos. */
export const MIMES_ANOTABLES: Readonly<Record<string, 'docx' | 'xlsx'>> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

export type VeredictoDeAnotar = { ok: true; mime: string; ext: 'docx' | 'xlsx' } | ({ ok: false } & Rechazo);

/**
 * El modo ANOTAR (`X-NovuChat-Anotar: 1`): el flujo no descargó los bytes. Exige cuerpo VACÍO
 * (con cuerpo: 400 `anotar_con_cuerpo`, porque anotar con bytes sería una puerta para guardar
 * sin pasar por la firma), tipo `document` y un mime de docx o xlsx; cualquier otro, 415.
 */
export function veredictoDeAnotar(bytes: Buffer, tipo: TipoDeMedio, mime: unknown): VeredictoDeAnotar {
  if (bytes.length !== 0) return { ok: false, codigo: 400, cuerpo: { error: 'anotar_con_cuerpo' } };
  const m = mimeDeclarado(mime);
  const ext = Object.prototype.hasOwnProperty.call(MIMES_ANOTABLES, m) ? MIMES_ANOTABLES[m] : undefined;
  if (tipo !== 'document' || !ext) return { ok: false, codigo: 415, cuerpo: { error: 'tipo_no_admitido' } };
  return { ok: true, mime: m, ext };
}
