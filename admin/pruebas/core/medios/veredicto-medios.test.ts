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
  EXTENSIONES_DE_DOCUMENTO, MARCAS_FTYP_3GP, MARCAS_FTYP_AUDIO, MARCAS_FTYP_MP4, MB, MIMES_ANOTABLES, MIME_DE_DOCUMENTO,
  TIPOS_DE_MENSAJE, contentTypeDeObjeto, documentoPorFirma, mimeDeclarado, tipoPorFirma, veredictoDe, veredictoDeAnotar,
} from '../../../functions/src/core/medios/tipos.ts';
import { crearAlmacenDeStorage, type BucketMinimo } from '../../../functions/src/core/medios/almacen.ts';

const JPG = (n = 1024) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n - 4)]);
const OGG = (n = 2048) => Buffer.concat([Buffer.from('OggS'), Buffer.alloc(n - 4)]);
const M4A = () => Buffer.concat([Buffer.alloc(4), Buffer.from('ftypM4A '), Buffer.alloc(100)]);
const AMR = () => Buffer.concat([Buffer.from('#!AMR\n'), Buffer.alloc(100)]);
const PDF = (n = 1024) => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(n - 9)]);
const HTML = () => Buffer.from('<html><script>alert(1)</script></html>');
const ZIP = () => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(100)]);
/** Un MP4/3GP con la caja `ftyp` bien formada (tamaño 24) y la marca dada. */
const MP4 = (marca: string, n = 256) => {
  const b = Buffer.alloc(Math.max(n, 24));
  b.writeUInt32BE(24, 0); b.write('ftyp', 4, 'latin1'); b.write(marca, 8, 'latin1');
  return b;
};
const M4A_BIEN = () => MP4('M4A ');
const MZ = () => Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]);
const SVG = () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const SCRIPT = () => Buffer.from('#!/bin/sh\nrm -rf ~\n');
const OLE = (n = 512) => Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(n - 8)]);
/** Un ZIP con nombres de entrada en claro (no hace falta que sea un ZIP válido: nunca se descomprime). */
const OOXML = (...nombres: string[]) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(26),
  ...nombres.map((n) => Buffer.from(n)), Buffer.alloc(64)]);
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
  it('justo en el tope entra: imagen 5 MB, audio 16 MB, video 16 MB, documento 16 MB (contrato v2)', () => {
    expect(veredictoDe(JPG(5 * MB), 'image', 'image/jpeg').ok).toBe(true);
    expect(veredictoDe(OGG(16 * MB), 'audio', 'audio/ogg').ok).toBe(true);
    expect(veredictoDe(MP4('isom', 16 * MB), 'video', 'video/mp4').ok).toBe(true);
    expect(veredictoDe(PDF(16 * MB), 'document', 'application/pdf').ok).toBe(true);
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
    expect(error(veredictoDe(MP4('isom', 16 * MB + 1), 'video', 'video/mp4'))).toEqual([413, 'demasiado_grande']);
    expect(error(veredictoDe(PDF(16 * MB + 1), 'document', 'application/pdf'))).toEqual([413, 'demasiado_grande']);
    // Un documento DESCONOCIDO de 16 MiB + 1 también: el tope no depende de reconocerlo.
    expect(error(veredictoDe(Buffer.alloc(16 * MB + 1, 0x41), 'document', 'application/octet-stream'))).toEqual([413, 'demasiado_grande']);
    expect(veredictoDe(PDF(6 * MB), 'document', 'application/pdf').ok).toBe(true);
  });
  it('la firma no coincide: PDF declarado imagen, imagen declarada audio, mime cruzado: 415', () => {
    // CAMBIO del contrato v2: «HTML declarado PDF» y «ZIP declarado docx» ya NO son 415: un documento se
    // guarda siempre (como `bin`); se prueban en «documentoPorFirma» abajo.
    for (const [b, tipo, ct] of [
      [PDF(), 'image', 'image/jpeg'], [JPG(), 'audio', 'audio/ogg'],
      [OGG(), 'audio', 'image/jpeg'], [OGG(), 'audio', ''], [JPG(), 'image', 'image/png'],
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
  it('los topes diarios viven en UN bloque con nombre (aprobados por Andres el 30/10) y la constancia está acotada (50)', () => {
    expect(fuente).toMatch(/export const TOPE_DIARIO_DE_MEDIOS = 3000;/);
    expect(fuente).toMatch(/export const TOPE_DIARIO_DE_BYTES = 3 \* GiB;/);
    expect(fuente).toMatch(/export const TOPE_DIARIO_POR_TELEFONO = 100;/);
    expect(fuente).toMatch(/export const TOPE_DIARIO_DE_BYTES_POR_TELEFONO = 500 \* MB;/);
    expect(fuente).toMatch(/aprobados por Andres el 30\/10\/2026/);
    expect(fuente).not.toMatch(/pendientes? de aprobaci/i);
    // Una sola definición de cada tope en todo core/medios.
    expect(fuente.match(/TOPE_DIARIO_POR_TELEFONO =/g)).toHaveLength(1);
    expect(fuente).toMatch(/export const MAX_ANOTACIONES_DE_TOPE = 50;/);
    expect(fuente).toMatch(/export const DIAS_DEL_CONTADOR = 2;/);
    expect(fuente).not.toMatch(/CUPO_MEDIOS_POR_DIA|CUPO_BYTES_POR_DIA/);
  });
});

describe('guardarMedio: concurrencia explícita (revisión de seguridad del #617)', () => {
  it('los valores de los topes', async () => {
    const gm = await import('../../../functions/src/core/medios/guardarMedio.ts');
    expect(gm.TOPE_DIARIO_DE_BYTES).toBe(3 * 1024 ** 3);
    expect(gm.TOPE_DIARIO_DE_BYTES_POR_TELEFONO).toBe(500 * 1024 ** 2);
    expect(gm.TOPE_DIARIO_POR_TELEFONO).toBe(100);
    expect(gm.claveDeTelefono('59170000000')).toMatch(/^t[A-Za-z0-9_-]{22}$/);
    expect(gm.claveDeTelefono('59170000000')).not.toContain('59170000000');
    expect(gm.claveDeTelefono('59170000000')).not.toBe(gm.claveDeTelefono('59170000001'));
  });
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

describe('documentoPorFirma: extensión y mime GUARDADOS (adenda §7.1), lista cerrada', () => {
  const XLSX_M = MIME_DE_DOCUMENTO.xlsx; const PPTX_M = MIME_DE_DOCUMENTO.pptx;
  it('reconoce pdf, docx, xlsx, pptx, zip, doc, xls, ppt, txt y csv con su firma y su mime', () => {
    const casos: [Buffer, string, string][] = [
      [PDF(), 'application/pdf', 'pdf'], [PDF(), 'application/octet-stream', 'pdf'],
      [OOXML('[Content_Types].xml', 'word/document.xml'), DOCX_MIME, 'docx'],
      [OOXML('[Content_Types].xml', 'xl/workbook.xml'), XLSX_M, 'xlsx'],
      [OOXML('[Content_Types].xml', 'ppt/presentation.xml'), PPTX_M, 'pptx'],
      [ZIP(), 'application/zip', 'zip'], [ZIP(), 'application/x-zip-compressed', 'zip'],
      [OLE(), 'application/msword', 'doc'], [OLE(), 'application/vnd.ms-excel', 'xls'], [OLE(), 'application/vnd.ms-powerpoint', 'ppt'],
      [Buffer.from('hola, ñandú\n'), 'text/plain; charset=utf-8', 'txt'], [Buffer.from('a;b\n1;2\n'), 'text/csv', 'csv'],
    ];
    for (const [b, m, ext] of casos) expect(documentoPorFirma(b, m), `${ext} ${m}`).toEqual({ ext, mime: MIME_DE_DOCUMENTO[ext as 'pdf'] });
  });
  it('NIEGA: ejecutable, HTML, SVG, script, bytes desconocidos y vacío se guardan como bin/octet-stream', () => {
    for (const [b, m] of [
      [MZ(), 'application/x-msdownload'], [MZ(), 'application/pdf'], [HTML(), 'text/html'], [HTML(), 'application/pdf'],
      [SVG(), 'image/svg+xml'], [SCRIPT(), 'application/x-sh'], [Buffer.from('alert(1)'), 'application/javascript'],
      [Buffer.alloc(300, 0x41), 'application/octet-stream'], [Buffer.alloc(0), 'application/pdf'], [JPG(), 'image/jpeg'],
    ] as const) {
      expect(documentoPorFirma(b, m), m).toEqual({ ext: 'bin', mime: 'application/octet-stream' });
    }
  });
  it('NIEGA: un ZIP sin mime de zip (o con el de docx sin su estructura) es bin', () => {
    expect(documentoPorFirma(ZIP(), 'application/octet-stream').ext).toBe('bin');
    expect(documentoPorFirma(ZIP(), DOCX_MIME).ext).toBe('bin');
    expect(documentoPorFirma(OOXML('[Content_Types].xml', 'xl/workbook.xml'), DOCX_MIME).ext).toBe('bin');
    expect(documentoPorFirma(OOXML('word/document.xml'), DOCX_MIME).ext).toBe('bin');
  });
  it('NIEGA: PDF-ZIP políglota es bin (ZIP local al inicio, fin de directorio al final, o ZIP con %PDF-)', () => {
    const local = Buffer.concat([Buffer.from('%PDF-1.7\n'), ZIP()]);
    const alFinal = Buffer.concat([PDF(4096), Buffer.from([0x50, 0x4b, 0x05, 0x06]), Buffer.alloc(18)]);
    const zipConPdf = Buffer.concat([ZIP(), Buffer.from('%PDF-1.4'), Buffer.alloc(50)]);
    for (const b of [local, alFinal]) {
      expect(documentoPorFirma(b, 'application/pdf').ext).toBe('bin');
      expect(tipoPorFirma(b)).toBeNull();
    }
    expect(documentoPorFirma(zipConPdf, 'application/zip').ext).toBe('bin');
  });
  it('NIEGA: macros. Los mimes docm/xlsm/pptm y un docx con vbaProject.bin son bin', () => {
    const conMacro = OOXML('[Content_Types].xml', 'word/document.xml', 'word/vbaProject.bin');
    expect(documentoPorFirma(conMacro, DOCX_MIME).ext).toBe('bin');
    for (const m of ['application/vnd.ms-word.document.macroenabled.12', 'application/vnd.ms-excel.sheet.macroenabled.12',
      'application/vnd.ms-powerpoint.presentation.macroenabled.12']) {
      expect(documentoPorFirma(OOXML('[Content_Types].xml', 'word/document.xml', 'xl/x', 'ppt/x'), m).ext, m).toBe('bin');
    }
    expect(documentoPorFirma(OLE(), 'application/vnd.ms-excel.sheet.macroenabled.12').ext).toBe('bin');
  });
  it('NIEGA: txt/csv con un NUL o con UTF-8 inválido es bin; un texto sin mime de texto también', () => {
    expect(documentoPorFirma(Buffer.from('hola\u0000mundo'), 'text/plain').ext).toBe('bin');
    expect(documentoPorFirma(Buffer.from([0x68, 0xff, 0xfe, 0x6f]), 'text/csv').ext).toBe('bin');
    expect(documentoPorFirma(Buffer.from('hola'), 'application/octet-stream').ext).toBe('bin');
    expect(documentoPorFirma(Buffer.from('hola'), 'text/html').ext).toBe('bin');
  });
  it('NIEGA: nombres del prototipo como mime no abren nada', () => {
    for (const m of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      expect(documentoPorFirma(ZIP(), m).ext, m).toBe('bin');
      expect(documentoPorFirma(OLE(), m).ext, m).toBe('bin');
    }
  });
  it('es idempotente con el mime guardado (lo que hará verMedio) y siempre cae en la lista cerrada', () => {
    const muestras: [Buffer, string][] = [
      [PDF(), 'application/pdf'], [ZIP(), 'application/zip'], [OLE(), 'application/msword'], [Buffer.from('x'), 'text/plain'],
      [OOXML('[Content_Types].xml', 'word/a'), DOCX_MIME], [MZ(), 'x'], [HTML(), 'text/html'], [Buffer.from('a,b'), 'text/csv'],
    ];
    for (const [b, m] of muestras) {
      const una = documentoPorFirma(b, m);
      expect(EXTENSIONES_DE_DOCUMENTO).toContain(una.ext);
      expect(una.mime).toBe(MIME_DE_DOCUMENTO[una.ext]);
      expect(documentoPorFirma(b, una.mime)).toEqual(una);
    }
  });
  it('veredictoDe con tipo document NUNCA da 415: guarda como bin lo que no reconoce', () => {
    for (const [b, m] of [[MZ(), 'application/x-msdownload'], [HTML(), 'application/pdf'], [ZIP(), DOCX_MIME], [OGG(), 'audio/ogg']] as const) {
      expect(veredictoDe(b, 'document', m), m).toEqual({ ok: true, firma: { ext: 'bin', tipo: 'document', mime: 'application/octet-stream' } });
    }
  });
  it('el objeto de un documento se escribe octet-stream (aunque sea PDF); imagen/audio/video con su mime verificado', () => {
    expect(contentTypeDeObjeto({ tipo: 'document', mime: 'application/pdf' })).toBe('application/octet-stream');
    expect(contentTypeDeObjeto({ tipo: 'image', mime: 'image/png' })).toBe('image/png');
    expect(contentTypeDeObjeto({ tipo: 'video', mime: 'video/mp4' })).toBe('video/mp4');
  });
});

describe('video (adenda §7.2): marcas ftyp DISJUNTAS de audio', () => {
  const error = (v: ReturnType<typeof veredictoDe>) => (v.ok ? null : [v.codigo, v.cuerpo.error]);
  it('reconoce mp4 (isom, iso2, iso4-6, mp41, mp42, avc1, M4V, MSNV, dash) y 3gp (3gp4-6, 3gg6, 3g2a)', () => {
    for (const m of MARCAS_FTYP_MP4) expect(veredictoDe(MP4(m), 'video', 'video/mp4'), m).toMatchObject({ ok: true, firma: { ext: 'mp4', tipo: 'video' } });
    for (const m of MARCAS_FTYP_3GP) expect(veredictoDe(MP4(m), 'video', 'video/3gpp'), m).toMatchObject({ ok: true, firma: { ext: '3gp', tipo: 'video' } });
    expect(veredictoDe(MP4('3g2a'), 'video', 'video/3gpp2').ok).toBe(true);
  });
  it('las listas de video y audio no se tocan', () => {
    for (const m of MARCAS_FTYP_AUDIO) { expect(MARCAS_FTYP_MP4.has(m)).toBe(false); expect(MARCAS_FTYP_3GP.has(m)).toBe(false); }
    for (const m of ['M4A ', 'M4B ', 'M4P ']) expect(MARCAS_FTYP_MP4.has(m), m).toBe(false);
  });
  it('NIEGA: m4a declarado video → 415; mp4 isom declarado audio → 415', () => {
    expect(error(veredictoDe(M4A_BIEN(), 'video', 'video/mp4'))).toEqual([415, 'tipo_no_admitido']);
    expect(error(veredictoDe(M4A_BIEN(), 'video', 'audio/mp4'))).toEqual([415, 'tipo_no_admitido']);
    expect(error(veredictoDe(MP4('isom'), 'audio', 'audio/mp4'))).toEqual([415, 'tipo_no_admitido']);
    expect(error(veredictoDe(MP4('isom'), 'audio', 'audio/aac'))).toEqual([415, 'tipo_no_admitido']);
  });
  it('NIEGA: video falso (HTML, JPEG, ogg, M4P, qt, heic, caja ftyp de tamaño < 8 o mayor que el archivo) → 415', () => {
    const chica = MP4('isom'); chica.writeUInt32BE(4, 0);
    const enorme = MP4('isom', 64); enorme.writeUInt32BE(1000, 0);
    for (const b of [HTML(), JPG(), OGG(), MP4('M4P '), MP4('qt  '), MP4('heic'), chica, enorme, Buffer.from('ftypisom')]) {
      expect(error(veredictoDe(b, 'video', 'video/mp4'))).toEqual([415, 'tipo_no_admitido']);
    }
    expect(error(veredictoDe(MP4('isom'), 'video', 'video/quicktime'))).toEqual([415, 'tipo_no_admitido']);
  });
  it('NIEGA: una imagen con bytes de HTML, SVG o ejecutable → 415', () => {
    for (const [b, ct] of [[HTML(), 'image/jpeg'], [SVG(), 'image/svg+xml'], [SVG(), 'image/png'], [MZ(), 'image/webp'], [MP4('isom'), 'image/jpeg']] as const) {
      expect(error(veredictoDe(b, 'image', ct)), ct).toEqual([415, 'tipo_no_admitido']);
    }
  });
  it('el sticker corresponde a image; otro, nunca', () => {
    expect(TIPOS_DE_MENSAJE.image).toEqual(['image', 'sticker']);
    for (const t of Object.values(TIPOS_DE_MENSAJE)) expect(t).not.toContain('otro');
  });
});

describe('almacen.guardar (adenda §7.3)', () => {
  it('graba contentDisposition attachment, el contentType dado y sin sobrescribir', async () => {
    const llamadas: { ruta: string; opciones: Record<string, any> }[] = [];
    const bucket: BucketMinimo = {
      file: (ruta) => ({
        save: async (_b, opciones) => { llamadas.push({ ruta, opciones }); },
        exists: async () => [false], download: async () => [Buffer.alloc(0)], getMetadata: async () => [{}],
      }),
      getFiles: async () => [[]], deleteFiles: async () => undefined,
    };
    await crearAlmacenDeStorage(() => bucket).guardar('tenants/t/medios/2026-10-30/x.bin', Buffer.from('x'), 'application/octet-stream');
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]?.opciones).toMatchObject({
      contentType: 'application/octet-stream', resumable: false, preconditionOpts: { ifGenerationMatch: 0 },
      metadata: { contentDisposition: 'attachment', cacheControl: 'private, max-age=0' },
    });
    expect(JSON.stringify(llamadas[0]?.opciones)).not.toMatch(/telefono|idMeta|wamid/i);
  });
});
