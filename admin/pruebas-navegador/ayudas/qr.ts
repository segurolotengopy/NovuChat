import { createRequire } from 'node:module';
import { crc32, deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// `qrcode-generator` es dependencia de las Functions (con ella dibujan el QR de demostración); se carga desde ahí.
const requerir = createRequire(join(dirname(fileURLToPath(import.meta.url)), '../../functions/package.json'));
const qrcode = requerir('qrcode-generator') as (tipo: number, nivel: 'L' | 'M' | 'Q' | 'H') => {
  addData(d: string): void; make(): void; getModuleCount(): number; isDark(f: number, c: number): boolean;
};

function trozo(tipo: string, datos: Buffer): Buffer {
  const cabeza = Buffer.alloc(4); cabeza.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'latin1'), datos]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(cuerpo) >>> 0);
  return Buffer.concat([cabeza, cuerpo, crc]);
}

/** Un PNG en escala de grises con un QR que dice `texto` (escala 6, borde de 4 módulos). Sirve para probar la lectura del código en el navegador. */
export function qrEnPng(texto: string): Buffer {
  const q = qrcode(0, 'M'); q.addData(texto); q.make();
  const n = q.getModuleCount(); const escala = 6; const borde = 4;
  const lado = (n + borde * 2) * escala;
  const crudo = Buffer.alloc((lado + 1) * lado, 255);
  for (let y = 0; y < lado; y++) {
    crudo[y * (lado + 1)] = 0; // filtro «ninguno»
    for (let x = 0; x < lado; x++) {
      const f = Math.floor(y / escala) - borde; const c = Math.floor(x / escala) - borde;
      if (f >= 0 && c >= 0 && f < n && c < n && q.isDark(f, c)) crudo[y * (lado + 1) + 1 + x] = 0;
    }
  }
  const cab = Buffer.alloc(13); cab.writeUInt32BE(lado, 0); cab.writeUInt32BE(lado, 4); cab[8] = 8; cab[9] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), trozo('IHDR', cab), trozo('IDAT', deflateSync(crudo)), trozo('IEND', Buffer.alloc(0))]);
}

/** Un PNG liso (blanco), válido, SIN ningún código adentro. */
export function pngSinCodigo(): Buffer {
  const lado = 64; const crudo = Buffer.alloc((lado + 1) * lado, 255);
  for (let y = 0; y < lado; y++) crudo[y * (lado + 1)] = 0;
  const cab = Buffer.alloc(13); cab.writeUInt32BE(lado, 0); cab.writeUInt32BE(lado, 4); cab[8] = 8; cab[9] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), trozo('IHDR', cab), trozo('IDAT', deflateSync(crudo)), trozo('IEND', Buffer.alloc(0))]);
}
