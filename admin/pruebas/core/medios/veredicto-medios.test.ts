/**
 * EL VEREDICTO DE UN MEDIO, PURO (Core, guardado de medios). Sin Firestore: corre en `pruebas:puras`.
 *
 * Rescatado de la rama `core/guardar-medio-servidor` (29/10/2026) lo que el #617 no cubría: el
 * veredicto como función pura que se prueba negando sin emulador, los alias de mime (los bytes
 * siguen decidiendo), el modo ANOTAR de docx/xlsx del contrato M1-M2 §1, y dos revisiones del
 * código: el tope diario es una constante con nombre, y ningún `console` menciona teléfono ni idMeta.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MB, MIMES_ANOTABLES, mimeDeclarado, tipoPorFirma, veredictoDe, veredictoDeAnotar,
} from '../../../functions/src/core/medios/tipos.ts';

const JPG = (n = 1024) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n - 4)]);
const OGG = (n = 2048) => Buffer.concat([Buffer.from('OggS'), Buffer.alloc(n - 4)]);
const M4A = () => Buffer.concat([Buffer.alloc(4), Buffer.from('ftypM4A '), Buffer.alloc(100)]);
const AMR = () => Buffer.concat([Buffer.from('#!AMR\n'), Buffer.alloc(100)]);
const PDF = (n = 1024) => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(n - 9)]);
const HTML = () => Buffer.from('<html><script>alert(1)</script></html>');
const ZIP = () => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(100)]);
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

describe('veredictoDe: guarda', () => {
  it('cada tipo cuando la firma coincide con la cabecera y el Content-Type (con parámetros)', () => {
    expect(veredictoDe(JPG(), 'image', 'image/jpeg')).toMatchObject({ ok: true, firma: { ext: 'jpg' } });
    expect(veredictoDe(OGG(), 'audio', 'audio/ogg; codecs=opus')).toMatchObject({ ok: true, firma: { ext: 'ogg' } });
    expect(veredictoDe(PDF(), 'document', 'Application/PDF')).toMatchObject({ ok: true, firma: { ext: 'pdf' } });
  });
  it('los alias rescatados: image/jpg, application/ogg, audio/aac en m4a, audio/3gpp en amr', () => {
    expect(veredictoDe(JPG(), 'image', 'image/jpg').ok).toBe(true);
    expect(veredictoDe(OGG(), 'audio', 'application/ogg').ok).toBe(true);
    expect(veredictoDe(M4A(), 'audio', 'audio/aac').ok).toBe(true);
    expect(veredictoDe(AMR(), 'audio', 'audio/3gpp').ok).toBe(true);
  });
  it('justo en el tope entra: imagen 5 MB, audio 16 MB, PDF 10 MB', () => {
    expect(veredictoDe(JPG(5 * MB), 'image', 'image/jpeg').ok).toBe(true);
    expect(veredictoDe(OGG(16 * MB), 'audio', 'audio/ogg').ok).toBe(true);
    expect(veredictoDe(PDF(10 * MB), 'document', 'application/pdf').ok).toBe(true);
  });
});

describe('veredictoDe: NIEGA', () => {
  const error = (v: ReturnType<typeof veredictoDe>) => (v.ok ? null : [v.codigo, v.cuerpo.error]);
  it('cuerpo vacío: 400 vacio', () => {
    expect(error(veredictoDe(Buffer.alloc(0), 'audio', 'audio/ogg'))).toEqual([400, 'vacio']);
  });
  it('cada tope + 1 byte: 413 (el tope es el del tipo declarado: un PDF de 6 MB entra, una imagen de 6 MB no)', () => {
    expect(error(veredictoDe(JPG(5 * MB + 1), 'image', 'image/jpeg'))).toEqual([413, 'demasiado_grande']);
    expect(error(veredictoDe(OGG(16 * MB + 1), 'audio', 'audio/ogg'))).toEqual([413, 'demasiado_grande']);
    expect(error(veredictoDe(PDF(10 * MB + 1), 'document', 'application/pdf'))).toEqual([413, 'demasiado_grande']);
    expect(veredictoDe(PDF(6 * MB), 'document', 'application/pdf').ok).toBe(true);
  });
  it('la firma no coincide: PDF declarado imagen, imagen declarada audio, HTML declarado PDF, ZIP declarado docx: 415', () => {
    for (const [b, tipo, ct] of [
      [PDF(), 'image', 'image/jpeg'], [JPG(), 'audio', 'audio/ogg'], [HTML(), 'document', 'application/pdf'],
      [ZIP(), 'document', DOCX_MIME], [OGG(), 'audio', 'image/jpeg'], [OGG(), 'audio', ''], [JPG(), 'image', 'image/png'],
    ] as const) {
      expect(error(veredictoDe(b, tipo, ct)), `${tipo} ${ct}`).toEqual([415, 'tipo_no_admitido']);
    }
  });
  it('un alias no abre de más: audio/aac sobre un JPEG o un ftyp de video sigue en 415', () => {
    expect(veredictoDe(JPG(), 'audio', 'audio/aac').ok).toBe(false);
    const video = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom'), Buffer.alloc(50)]);
    expect(tipoPorFirma(video)).toBeNull();
    expect(veredictoDe(video, 'audio', 'audio/aac').ok).toBe(false);
  });
});

describe('veredictoDeAnotar (contrato M1-M2 §1)', () => {
  it('docx y xlsx, cuerpo vacío y tipo document: se anotan', () => {
    expect(veredictoDeAnotar(Buffer.alloc(0), 'document', DOCX_MIME)).toEqual({ ok: true, mime: DOCX_MIME, ext: 'docx' });
    expect(veredictoDeAnotar(Buffer.alloc(0), 'document', `${XLSX_MIME}; charset=binary`)).toEqual({ ok: true, mime: XLSX_MIME, ext: 'xlsx' });
    expect(Object.keys(MIMES_ANOTABLES).sort()).toEqual([XLSX_MIME, DOCX_MIME].sort());
  });
  it('NIEGA: cualquier otro mime (y los nombres del prototipo) da 415', () => {
    for (const m of ['application/pdf', 'image/jpeg', 'application/msword', 'application/vnd.ms-excel', 'text/html', '', 'toString', '__proto__', 'constructor']) {
      const v = veredictoDeAnotar(Buffer.alloc(0), 'document', m);
      expect(v.ok ? null : [v.codigo, v.cuerpo.error], m).toEqual([415, 'tipo_no_admitido']);
    }
  });
  it('NIEGA: tipo image o audio con un mime de docx da 415', () => {
    expect(veredictoDeAnotar(Buffer.alloc(0), 'image', DOCX_MIME).ok).toBe(false);
    expect(veredictoDeAnotar(Buffer.alloc(0), 'audio', XLSX_MIME).ok).toBe(false);
  });
  it('NIEGA: anotar CON bytes da 400 anotar_con_cuerpo (no es una puerta para guardar sin firma)', () => {
    for (const b of [ZIP(), PDF(), Buffer.from([0])]) {
      const v = veredictoDeAnotar(b, 'document', DOCX_MIME);
      expect(v.ok ? null : [v.codigo, v.cuerpo.error]).toEqual([400, 'anotar_con_cuerpo']);
    }
  });
  it('mimeDeclarado recorta parámetros, espacios y mayúsculas', () => {
    expect(mimeDeclarado('  Audio/OGG ; codecs=opus')).toBe('audio/ogg');
    expect(mimeDeclarado(undefined)).toBe('');
  });
});

describe('revisión del código de guardarMedio', () => {
  const aqui = dirname(fileURLToPath(import.meta.url));
  const fuente = readFileSync(join(aqui, '../../../functions/src/core/medios/guardarMedio.ts'), 'utf8');
  it('ninguna llamada a console menciona teléfono, idMeta ni el cuerpo', () => {
    const llamadas = fuente.match(/console\.\w+\([^)]*\)/g) ?? [];
    for (const l of llamadas) expect(l).not.toMatch(/telefono|idMeta|bytes|rawBody/i);
  });
  it('el tope diario es una constante con nombre (3000) y la constancia está acotada (50), no literales sueltos', () => {
    expect(fuente).toMatch(/export const TOPE_DIARIO_DE_MEDIOS = 3000;/);
    expect(fuente).toMatch(/export const MAX_ANOTACIONES_DE_TOPE = 50;/);
    expect(fuente).toMatch(/export const DIAS_DEL_CONTADOR = 2;/);
    expect(fuente).not.toMatch(/CUPO_MEDIOS_POR_DIA|CUPO_BYTES_POR_DIA/);
  });
});

describe('guardarMedio: concurrencia explícita (revisión de seguridad del #617)', () => {
  it('fuera de staging, 4 peticiones a la vez con 1 GiB; en staging (CPU fraccionaria) no se declara', async () => {
    const gm = await import('../../../functions/src/core/medios/guardarMedio.ts');
    expect(gm.CONCURRENCIA_DE_GUARDAR_MEDIO).toBe(4);
    expect(gm.opcionesDeGuardarMedio({})).toMatchObject({ concurrency: 4, memory: '1GiB', maxInstances: 10, cors: false });
    expect(gm.opcionesDeGuardarMedio({ CPU_FRACCIONARIA: 'si' })).not.toHaveProperty('concurrency');
  });
  it('despliegue.json declara concurrency 4 para guardarMedio (no el 80 por defecto)', () => {
    const aqui = dirname(fileURLToPath(import.meta.url));
    const d = JSON.parse(readFileSync(join(aqui, '../../frontera/despliegue.json'), 'utf8')) as Record<string, Record<string, unknown>>;
    expect(d['guardarMedio']?.['concurrency']).toBe(4);
    expect(d['guardarMedio']?.['availableMemoryMb']).toBe(1024);
  });
});
