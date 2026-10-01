/**
 * =============================================================================
 * DIBUJO DEL QR — de texto validado a PNG, sin bibliotecas de imágenes
 * =============================================================================
 *
 * Vive aparte de `cobro.ts` para poder probarse sin levantar Firebase. Lo que
 * hay acá es puro cálculo: una matriz de módulos y un PNG.
 *
 * POR QUÉ SE ESCRIBE EL PNG A MANO. Un PNG en blanco y negro es un formato
 * simple —firma, cabecera, píxeles comprimidos con zlib, fin— y `zlib` ya viene
 * en Node. Traer una biblioteca de imágenes para esto agregaría una cadena de
 * dependencias a una función que corre en producción y toca dinero ajeno.
 *
 * COMPROBADO CONTRA UN LECTOR INDEPENDIENTE. El 2026-09-06 se generó el PNG con
 * este código y se leyó con zxing-cpp —el motor que usan muchos escáneres de
 * teléfono—: devuelve exactamente el texto que se le dio, también con acentos.
 * No alcanzaba con que el PNG fuera válido: tenía que ESCANEARSE.
 */
import { deflateSync } from 'node:zlib';
import qrcode from 'qrcode-generator';

/** CRC-32 de PNG: polinomio reflejado 0xEDB88320. No es el CRC del QR. */
function crc32(datos: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of datos) {
    c ^= byte;
    for (let i = 0; i < 8; i += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function trozo(tipo: string, datos: Buffer): Buffer {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length, 0);
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo), 0);
  return Buffer.concat([largo, cuerpo, crc]);
}

/**
 * Arma un PNG en escala de grises a partir de la matriz de módulos.
 *
 * Se escribe a mano en vez de traer una biblioteca de imágenes porque un PNG
 * de dos colores es un formato simple —cabecera, píxeles comprimidos, fin— y
 * una dependencia menos en una función que corre en producción es una
 * superficie de ataque menos.
 */
export function pngDeMatriz(
  esOscuro: (fila: number, columna: number) => boolean,
  modulos: number,
  escala = 10,
  margen = 4,
): Buffer {
  const lado = (modulos + margen * 2) * escala;
  // Cada fila lleva delante un byte de «filtro»; 0 = sin filtro.
  const crudo = Buffer.alloc((lado + 1) * lado, 0xff);
  for (let y = 0; y < lado; y += 1) {
    const inicioFila = y * (lado + 1);
    crudo[inicioFila] = 0;
    const filaModulo = Math.floor(y / escala) - margen;
    for (let x = 0; x < lado; x += 1) {
      const columnaModulo = Math.floor(x / escala) - margen;
      const dentro = filaModulo >= 0 && filaModulo < modulos
        && columnaModulo >= 0 && columnaModulo < modulos;
      crudo[inicioFila + 1 + x] = dentro && esOscuro(filaModulo, columnaModulo) ? 0x00 : 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lado, 0);
  ihdr.writeUInt32BE(lado, 4);
  ihdr[8] = 8;      // bits por muestra
  ihdr[9] = 0;      // escala de grises
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo('IHDR', ihdr),
    trozo('IDAT', deflateSync(crudo, { level: 9 })),
    trozo('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * `qrcode-generator` se publica como CommonJS y, según quién lo cargue, llega
 * como la función o envuelto en `.default`. Se resuelven las dos formas.
 */
interface GeneradorQr {
  (tipo: number, correccion: string): {
    addData(dato: string, modo: string): void;
    make(): void;
    getModuleCount(): number;
    isDark(fila: number, columna: number): boolean;
  };
}
const generador = ((qrcode as unknown as { default?: unknown }).default ?? qrcode) as GeneradorQr;

/**
 * Convierte el texto a una cadena donde cada carácter YA ES un byte de su
 * codificación UTF-8.
 *
 * POR QUÉ ESTE RODEO. La biblioteca convierte texto a bytes con una función
 * suya que trunca cada carácter a un byte, así que una eñe saldría mal. Se
 * puede reemplazar esa función por la de UTF-8… salvo que, al empaquetar para
 * las pruebas, las propiedades estáticas del módulo se pierden y el reemplazo
 * queda en nada. Pasó exactamente eso: compilado andaba, en pruebas no.
 *
 * Entregando los bytes ya convertidos, el truncado no tiene nada que truncar y
 * el resultado es correcto con cualquier forma de carga del módulo. Menos
 * elegante y mucho más difícil de romper.
 */
function comoBytes(texto: string): string {
  const bytes = new TextEncoder().encode(texto);
  let salida = '';
  for (const byte of bytes) salida += String.fromCharCode(byte);
  return salida;
}

/** Dibuja el código de cobro como PNG a partir de su texto. */
export function dibujarQr(cargaUtil: string, escala = 10): Buffer {
  // Nivel de corrección M: aguanta un 15 % de la imagen dañada, que es lo que
  // se pierde con el reflejo de una pantalla o un dedo en la cámara.
  const qr = generador(0, 'M');
  qr.addData(comoBytes(cargaUtil), 'Byte');
  qr.make();
  return pngDeMatriz((f, c) => qr.isDark(f, c), qr.getModuleCount(), escala);
}
