/**
 * El TIPO de un medio se decide por los PRIMEROS BYTES, nunca por lo que declara
 * quien sube. SVG, HTML, docx, xlsx y todo lo que no esté en la lista cerrada
 * dan `null` (415): un SVG o un HTML guardado y servido después es un vector
 * de script, y docx/xlsx quedaron fuera por decisión de Andres (23/10/2026, D6).
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
  jpg: ['image/jpeg'],
  png: ['image/png'],
  webp: ['image/webp'],
  ogg: ['audio/ogg'],
  m4a: ['audio/mp4', 'audio/x-m4a', 'audio/m4a'],
  mp3: ['audio/mpeg', 'audio/mp3'],
  aac: ['audio/aac'],
  amr: ['audio/amr'],
  pdf: ['application/pdf'],
};

const MARCAS_FTYP = new Set(['M4A ', 'M4B ', 'mp42', 'mp41', 'isom', 'iso2']);
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
  if (n >= 5 && texto(bytes, 0, 5) === '%PDF-') return { ext: 'pdf', tipo: 'document', mime: 'application/pdf' };
  return null;
}
