/**
 * GUARDAR EL MEDIO ENTRANTE: lo que se decide SIN tocar Firestore ni Storage.
 *
 * Se escribe negando: un tipo que miente no se guarda, 5 MB de imagen + 1 byte
 * no entra, un PDF de más de 10 MB no entra, un audio de más de 16 MB no entra,
 * un docx se anota y no se guarda, y el teléfono no aparece en un log ni en la
 * ruta. La parte con Firestore (tope diario, repetidos, purga) está en
 * `guardar-medio.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MB, diaDeLaPaz, nombreDeObjeto, tipoDeMedioPorFirma } from '../../../functions/src/core/medios/almacen.ts';
import {
  MAXIMO_AUDIO_MEDIO, MAXIMO_IMAGEN_MEDIO, MAXIMO_PDF_MEDIO, TOPE_DIARIO_DE_MEDIOS, rutaDeMedio, veredictoDe,
} from '../../../functions/src/core/medios/guardarMedio.ts';

const JPG = (n = 1024) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n)]);
const PNG = (n = 100) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(n)]);
const WEBP = () => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(100)]);
const PDF = (n = 1024) => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(n)]);
const OGG = (n = 1024) => Buffer.concat([Buffer.from('OggS'), Buffer.alloc(n)]);
const M4A = (n = 1024) => Buffer.concat([Buffer.alloc(4), Buffer.from('ftypM4A '), Buffer.alloc(n)]);
const MP3_ID3 = () => Buffer.concat([Buffer.from('ID3'), Buffer.alloc(100)]);
const MP3_TRAMA = () => Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(100)]);
const AMR = () => Buffer.concat([Buffer.from('#!AMR\n'), Buffer.alloc(100)]);
const ZIP = (n = 1024) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(n)]);
const HTML = () => Buffer.from('<html><script>alert(1)</script></html>');

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

describe('el tipo se decide por los bytes', () => {
  it('reconoce imagen, PDF y las cuatro familias de audio', () => {
    expect(tipoDeMedioPorFirma(JPG())).toMatchObject({ ext: 'jpg', tipo: 'imagen' });
    expect(tipoDeMedioPorFirma(PNG())).toMatchObject({ ext: 'png', tipo: 'imagen' });
    expect(tipoDeMedioPorFirma(WEBP())).toMatchObject({ ext: 'webp', tipo: 'imagen' });
    expect(tipoDeMedioPorFirma(PDF())).toMatchObject({ ext: 'pdf', tipo: 'pdf' });
    expect(tipoDeMedioPorFirma(OGG())).toMatchObject({ ext: 'ogg', mime: 'audio/ogg', tipo: 'audio' });
    expect(tipoDeMedioPorFirma(M4A())).toMatchObject({ ext: 'm4a', mime: 'audio/mp4', tipo: 'audio' });
    expect(tipoDeMedioPorFirma(MP3_ID3())).toMatchObject({ ext: 'mp3', tipo: 'audio' });
    expect(tipoDeMedioPorFirma(MP3_TRAMA())).toMatchObject({ ext: 'mp3', tipo: 'audio' });
    expect(tipoDeMedioPorFirma(AMR())).toMatchObject({ ext: 'amr', tipo: 'audio' });
  });
  it('no reconoce ZIP (docx/xlsx), HTML, texto, un RIFF que no es WEBP ni bytes vacíos o ceros', () => {
    for (const b of [ZIP(), HTML(), Buffer.from('hola'), Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')]), Buffer.alloc(0), Buffer.alloc(20)]) {
      expect(tipoDeMedioPorFirma(b)).toBeNull();
    }
  });
});

describe('veredictoDe: guardar', () => {
  it('guarda cada tipo cuando la cabecera coincide con los bytes (con parámetros incluidos)', () => {
    expect(veredictoDe(JPG(), 'image/jpeg', false, '')).toMatchObject({ estado: 'guardado', ext: 'jpg', tipo: 'imagen' });
    expect(veredictoDe(PDF(), 'application/pdf', false, '')).toMatchObject({ estado: 'guardado', ext: 'pdf' });
    expect(veredictoDe(OGG(), 'audio/ogg; codecs=opus', false, '')).toMatchObject({ estado: 'guardado', ext: 'ogg', tipo: 'audio' });
    expect(veredictoDe(M4A(), 'audio/mp4', false, '')).toMatchObject({ estado: 'guardado', ext: 'm4a' });
    expect(veredictoDe(MP3_ID3(), 'audio/mpeg', false, '')).toMatchObject({ estado: 'guardado', ext: 'mp3' });
    expect(veredictoDe(AMR(), 'audio/amr', false, '')).toMatchObject({ estado: 'guardado', ext: 'amr' });
  });
  it('los topes son justo 5 MB imagen, 10 MB PDF y 16 MB audio', () => {
    expect([MAXIMO_IMAGEN_MEDIO, MAXIMO_PDF_MEDIO, MAXIMO_AUDIO_MEDIO]).toEqual([5 * MB, 10 * MB, 16 * MB]);
    expect(veredictoDe(JPG(MAXIMO_IMAGEN_MEDIO - 4), 'image/jpeg', false, '').estado).toBe('guardado');
    expect(veredictoDe(PDF(MAXIMO_PDF_MEDIO - 9), 'application/pdf', false, '').estado).toBe('guardado');
    expect(veredictoDe(OGG(MAXIMO_AUDIO_MEDIO - 4), 'audio/ogg', false, '').estado).toBe('guardado');
  });
});

describe('veredictoDe: lo que NO se guarda', () => {
  it('imagen de más de 5 MB: 413 y fallo', () => {
    expect(veredictoDe(JPG(MAXIMO_IMAGEN_MEDIO), 'image/jpeg', false, '')).toMatchObject({ estado: 'fallo', codigo: 413, motivo: 'demasiado_grande' });
  });
  it('PDF de más de 10 MB: 413 y fallo (aunque una imagen de 6 MB sí falla y un PDF de 6 MB no)', () => {
    expect(veredictoDe(PDF(MAXIMO_PDF_MEDIO), 'application/pdf', false, '')).toMatchObject({ estado: 'fallo', codigo: 413 });
    expect(veredictoDe(PDF(6 * MB), 'application/pdf', false, '').estado).toBe('guardado');
    expect(veredictoDe(PNG(6 * MB), 'image/png', false, '')).toMatchObject({ estado: 'fallo', codigo: 413 });
  });
  it('audio de más de 16 MB: 413 y fallo', () => {
    expect(veredictoDe(OGG(MAXIMO_AUDIO_MEDIO), 'audio/ogg', false, '')).toMatchObject({ estado: 'fallo', codigo: 413, motivo: 'demasiado_grande' });
    expect(veredictoDe(M4A(20 * MB), 'audio/mp4', false, '')).toMatchObject({ estado: 'fallo', codigo: 413 });
  });
  it('una cabecera que miente (PDF declarado imagen, imagen declarada audio, HTML declarado PDF): 415 y fallo', () => {
    expect(veredictoDe(PDF(), 'image/jpeg', false, '')).toMatchObject({ estado: 'fallo', codigo: 415, motivo: 'tipo_no_coincide' });
    expect(veredictoDe(JPG(), 'audio/ogg', false, '')).toMatchObject({ estado: 'fallo', codigo: 415 });
    expect(veredictoDe(HTML(), 'application/pdf', false, '')).toMatchObject({ estado: 'fallo', codigo: 415 });
    expect(veredictoDe(JPG(), '', false, '')).toMatchObject({ estado: 'fallo', codigo: 415 });
    expect(veredictoDe(JPG(), 'application/octet-stream', false, '')).toMatchObject({ estado: 'fallo', codigo: 415 });
  });
  it('docx y xlsx (y cualquier otro tipo): se ANOTAN y no se guardan', () => {
    expect(veredictoDe(ZIP(), DOCX, false, '')).toMatchObject({ estado: 'anotado', codigo: 200, motivo: 'tipo_no_admitido' });
    expect(veredictoDe(ZIP(), XLSX, false, '')).toMatchObject({ estado: 'anotado', codigo: 200 });
    expect(veredictoDe(HTML(), 'text/html', false, '')).toMatchObject({ estado: 'anotado', codigo: 200 });
    expect(veredictoDe(HTML(), 'application/zip', false, '').estado).toBe('anotado');
  });
  it('cuerpo vacío SIN la cabecera de fallo: 400 y fallo', () => {
    expect(veredictoDe(Buffer.alloc(0), 'image/jpeg', false, '')).toMatchObject({ estado: 'fallo', codigo: 400, motivo: 'vacio' });
  });
  it('cuerpo vacío CON la cabecera de fallo: se anota como fallo con el motivo del flujo (200)', () => {
    expect(veredictoDe(Buffer.alloc(0), '', true, 'meta_no_entrego')).toMatchObject({ estado: 'fallo', codigo: 200, motivo: 'meta_no_entrego' });
  });
});

describe('la ruta', () => {
  it('es tenants/{t}/medios/{día}/{sha256 en base64url}.{ext}, sin teléfono', () => {
    const r = rutaDeMedio('tienda', '2026-10-03', 'wamid.HBg=Lw==', 'jpg');
    expect(r).toBe(`tenants/tienda/medios/2026-10-03/${nombreDeObjeto('wamid.HBg=Lw==')}.jpg`);
    expect(r).toMatch(/^tenants\/[\w-]+\/medios\/\d{4}-\d{2}-\d{2}\/[A-Za-z0-9_-]{43}\.(jpg|png|webp|pdf|ogg|m4a|mp3|amr)$/);
  });
  it('dos ids que un saneo confundiría no chocan, y uno con «..» no escapa de la carpeta', () => {
    expect(rutaDeMedio('t', '2026-10-03', 'wamid.a+b', 'png')).not.toBe(rutaDeMedio('t', '2026-10-03', 'wamid.a/b', 'png'));
    expect(rutaDeMedio('t', '2026-10-03', '../../otro/../x', 'png')).toMatch(/^tenants\/t\/medios\/2026-10-03\/[A-Za-z0-9_-]{43}\.png$/);
  });
  it('el día es el de La Paz: 23:30 del 3 en La Paz es el 4 en UTC', () => {
    expect(diaDeLaPaz(Date.UTC(2026, 9, 4, 3, 30))).toBe('2026-10-03');
  });
});

describe('el teléfono nunca sale en un log (revisión del código)', () => {
  const fuente = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../functions/src/core/medios/guardarMedio.ts'), 'utf8');
  const almacen = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../functions/src/core/medios/almacen.ts'), 'utf8');
  const llamadasALog = (t: string) => [...t.matchAll(/console\.(?:log|info|warn|error|debug)\(([^;]*)\);/g)].map((m) => m[1] as string);
  it('ninguna llamada a console menciona teléfono, idMeta ni el cuerpo', () => {
    const llamadas = [...llamadasALog(fuente), ...llamadasALog(almacen)];
    expect(llamadas.length, 'control: hay logs que revisar').toBeGreaterThan(0);
    for (const l of llamadas) expect(l, l).not.toMatch(/telefono|idMeta|bytes|\be\./i);
  });
  it('el tope diario es un número con nombre y amplio (3000), no un literal suelto', () => {
    expect(TOPE_DIARIO_DE_MEDIOS).toBe(3000);
  });
});
