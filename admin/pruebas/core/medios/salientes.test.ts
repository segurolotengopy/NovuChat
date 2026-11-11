/**
 * ADJUNTOS DE LA PERSONA, VALIDACIÓN PURA (Core, «Envío de medios por consola», B1). Sin emulador.
 * Cada caso de seguridad se escribe NEGANDO: lo malo debe dar un código concreto, y lo bueno debe salir
 * limpio. El Ogg reempaquetado se lee con un CRC calculado AQUÍ, aparte del que usa el código.
 */
import { describe, expect, it } from 'vitest';
import {
  crcOgg, leerPaginasOgg, pdfEsActivo, reempaquetarWebmOpusAOgg, sanearNombre, validarAdjunto,
} from '../../../functions/src/core/medios/salientes.ts';

// ---------- constructores de bytes ----------
const crc32 = (b: Buffer): number => {
  let c = 0xffffffff;
  for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; }
  return (c ^ 0xffffffff) >>> 0;
};
const chunkPng = (tipo: string, datos: Buffer) => {
  const t = Buffer.from(tipo, 'latin1');
  const l = Buffer.alloc(4); l.writeUInt32BE(datos.length);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, datos])));
  return Buffer.concat([l, t, datos, c]);
};
const PNG_FIRMA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (w = 8, h = 8, extra: Buffer[] = []) => {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([PNG_FIRMA, chunkPng('IHDR', ihdr), ...extra, chunkPng('IDAT', Buffer.from([1, 2, 3, 4])), chunkPng('IEND', Buffer.alloc(0))]);
};
const seg = (m: number, datos: Buffer) => { const l = Buffer.alloc(2); l.writeUInt16BE(datos.length + 2); return Buffer.concat([Buffer.from([0xff, m]), l, datos]); };
const jpeg = (w = 16, h = 16, extra: Buffer[] = []) => {
  const sof = Buffer.alloc(15); sof[0] = 8; sof.writeUInt16BE(h, 1); sof.writeUInt16BE(w, 3); sof[5] = 3;
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]), seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')), ...extra,
    seg(0xc0, sof), seg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])), Buffer.from([0x12, 0x34, 0x56]), Buffer.from([0xff, 0xd9]),
  ]);
};
const EXIF = seg(0xe1, Buffer.from('Exif\0\0GPS-17.78,-63.18', 'latin1'));

const zip = (...nombres: string[]) => Buffer.concat([
  ...nombres.map(n => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(26), Buffer.from(n, 'latin1'), Buffer.from('x')])),
  Buffer.from([0x50, 0x4b, 0x05, 0x06]), Buffer.alloc(18),
]);
const DOCX = (...mas: string[]) => zip('[Content_Types].xml', 'word/document.xml', ...mas);
const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const pdf = (cuerpo = '') => Buffer.from(`%PDF-1.7\n1 0 obj\n<< /Type /Catalog ${cuerpo} >>\nendobj\n%%EOF\n`, 'latin1');

// Ogg/Opus de prueba, armado con un CRC independiente del módulo.
const crcOggAparte = (b: Buffer) => {
  let c = 0;
  for (const x of b) { c ^= x << 24; for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1; c >>>= 0; }
  return c >>> 0;
};
const pagina = (banderas: number, granule: bigint, sec: number, paquetes: Buffer[], serie = 7) => {
  const tabla: number[] = [];
  for (const p of paquetes) { for (let r = p.length; r >= 255; r -= 255) tabla.push(255); tabla.push(p.length % 255); }
  const cab = Buffer.alloc(27 + tabla.length);
  cab.write('OggS', 0, 'latin1'); cab[5] = banderas; cab.writeBigUInt64LE(granule, 6); cab.writeUInt32LE(serie, 14); cab.writeUInt32LE(sec, 18);
  cab[26] = tabla.length; Buffer.from(tabla).copy(cab, 27);
  const p = Buffer.concat([cab, ...paquetes]); p.writeUInt32LE(crcOggAparte(p), 22); return p;
};
const opusHead = (canales = 1) => { const h = Buffer.alloc(19); h.write('OpusHead', 0, 'latin1'); h[8] = 1; h[9] = canales; h.writeUInt16LE(312, 10); h.writeUInt32LE(48000, 12); return h; };
const opusTags = () => Buffer.concat([Buffer.from('OpusTags', 'latin1'), Buffer.alloc(8)]);
const ogg = (canales = 1) => Buffer.concat([
  pagina(2, 0n, 0, [opusHead(canales)]), pagina(0, 0n, 1, [opusTags()]), pagina(4, 960n, 2, [Buffer.from([0xfc, 1, 2, 3])]),
]);

// WebM/Opus mínimo, con Segment y Cluster de tamaño desconocido, como lo escribe Chrome.
const ebml = (id: number[], dato: Buffer, desconocido = false) => {
  const n = dato.length;
  const sz = desconocido ? Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]) : n < 127 ? Buffer.from([0x80 | n]) : Buffer.from([0x40 | (n >> 8), n & 0xff]);
  return Buffer.concat([Buffer.from(id), sz, dato]);
};
const u = (...x: number[]) => Buffer.from(x);
const trama = (n: number) => Buffer.from([0xfc, n, n, n]); // TOC config 31 (CELT 20 ms), 1 trama
const webm = (opciones: { canales?: number; lacing?: boolean; tramas?: number } = {}) => {
  const canales = opciones.canales ?? 1;
  const pista = ebml([0xae], Buffer.concat([
    ebml([0xd7], u(1)), ebml([0x86], Buffer.from('A_OPUS')), ebml([0x63, 0xa2], opusHead(canales)), ebml([0xe1], ebml([0x9f], u(canales))),
  ]));
  const bloques = Array.from({ length: opciones.tramas ?? 60 }, (_, i) =>
    ebml([0xa3], Buffer.concat([u(0x81, 0, i), u(opciones.lacing ? 0x82 : 0x80), trama(i & 0xff)])));
  return Buffer.concat([
    ebml([0x1a, 0x45, 0xdf, 0xa3], ebml([0x42, 0x82], Buffer.from('webm'))),
    ebml([0x18, 0x53, 0x80, 0x67], Buffer.concat([ebml([0x16, 0x54, 0xae, 0x6b], pista), ebml([0x1f, 0x43, 0xb6, 0x75], Buffer.concat([ebml([0xe7], u(0)), ...bloques]), true)]), true),
  ]);
};

const negado = (r: ReturnType<typeof validarAdjunto>, error: string) => {
  expect(r.ok).toBe(false);
  expect(r.ok === false && r.error).toBe(error);
};
const bueno = (r: ReturnType<typeof validarAdjunto>) => {
  if (!r.ok) throw new Error(`se esperaba ok y dio ${r.error}`);
  return r;
};

describe('lo que se NIEGA', () => {
  it('políglota PDF+ZIP', () => {
    const poli = Buffer.concat([pdf(), zip('a.txt')]);
    negado(validarAdjunto(poli, { nombre: 'x.pdf', mime: 'application/pdf' }), 'poliglota');
    // y un ZIP con %PDF- al inicio de su cuerpo tampoco pasa como docx
    negado(validarAdjunto(Buffer.concat([zip('[Content_Types].xml', 'word/x'), pdf()]), { mime: MIME_DOCX }), 'tipo_no_admitido');
  });
  it('docx con macros (vbaProject.bin), aunque se declare docx', () => {
    negado(validarAdjunto(DOCX('word/vbaProject.bin'), { nombre: 'a.docx', mime: MIME_DOCX }), 'con_macros');
  });
  it('docm / xlsm y Office antiguo (doc, xls, ppt), zip y csv no están en la lista', () => {
    negado(validarAdjunto(DOCX(), { mime: 'application/vnd.ms-word.document.macroEnabled.12' }), 'tipo_no_admitido');
    const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(600)]);
    negado(validarAdjunto(ole, { mime: 'application/msword' }), 'tipo_no_admitido');
    negado(validarAdjunto(zip('a.txt'), { mime: 'application/zip' }), 'tipo_no_admitido');
    negado(validarAdjunto(Buffer.from('a,b\n1,2\n'), { mime: 'text/csv' }), 'tipo_no_admitido');
  });
  it('ogg estéreo', () => negado(validarAdjunto(ogg(2), { mime: 'audio/ogg' }), 'no_mono'));
  it('ogg sin OpusHead (Vorbis) y ogg con CRC roto o basura detrás', () => {
    const vorbis = Buffer.concat([pagina(2, 0n, 0, [Buffer.from('\x01vorbis' + 'x'.repeat(20), 'latin1')]), pagina(4, 0n, 1, [Buffer.alloc(10)])]);
    negado(validarAdjunto(vorbis), 'ogg_sin_opushead');
    const roto = Buffer.from(ogg()); roto[roto.length - 1] ^= 0xff;
    negado(validarAdjunto(roto), 'ogg_invalido');
    negado(validarAdjunto(Buffer.concat([ogg(), Buffer.from('basura')])), 'ogg_invalido');
    negado(validarAdjunto(Buffer.concat([ogg(), ogg()])), 'ogg_invalido'); // encadenado
  });
  it('WebM estéreo, con lacing, sin audio o con otra pista', () => {
    negado(validarAdjunto(webm({ canales: 2 })), 'no_mono');
    negado(validarAdjunto(webm({ lacing: true })), 'webm_invalido');
    negado(validarAdjunto(webm({ tramas: 0 })), 'webm_invalido');
    negado(validarAdjunto(webm().subarray(0, 60)), 'webm_invalido');
  });
  it('PNG de 4.097 px (alto o ancho) y PNG con CRC roto o datos detrás', () => {
    negado(validarAdjunto(png(4097, 10), { mime: 'image/png' }), 'imagen_dimensiones');
    negado(validarAdjunto(png(10, 4097), { mime: 'image/png' }), 'imagen_dimensiones');
    bueno(validarAdjunto(png(4096, 4096), { mime: 'image/png' }));
    const roto = Buffer.from(png()); roto[20] ^= 0xff;
    negado(validarAdjunto(roto), 'imagen_invalida');
    negado(validarAdjunto(Buffer.concat([png(), Buffer.from('<?php')])), 'imagen_invalida');
  });
  it('JPEG de 4.097 px, sin SOF o con datos detrás del EOI', () => {
    negado(validarAdjunto(jpeg(4097, 10)), 'imagen_dimensiones');
    bueno(validarAdjunto(jpeg(4096, 4096)));
    negado(validarAdjunto(Buffer.concat([jpeg(), Buffer.from('zip')])), 'imagen_invalida');
    negado(validarAdjunto(Buffer.from([0xff, 0xd8, 0xff, 0xd9])), 'imagen_invalida');
  });
  it('HTML rotulado como jpg (por mime o por nombre)', () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    negado(validarAdjunto(html, { nombre: 'foto.jpg', mime: 'image/jpeg', tipo: 'image' }), 'tipo_no_admitido');
    negado(validarAdjunto(html, { nombre: 'foto.jpg' }), 'tipo_no_admitido');
    negado(validarAdjunto(html, { nombre: 'foto.jpg', mime: 'image/jpeg' }), 'tipo_no_admitido');
  });
  it('la consola dice una cosa y los bytes otra', () => {
    negado(validarAdjunto(png(), { mime: 'image/jpeg' }), 'tipo_no_coincide');
    negado(validarAdjunto(pdf(), { tipo: 'image' }), 'tipo_no_coincide');
    negado(validarAdjunto(jpeg(), { tipo: 'audio' }), 'tipo_no_coincide');
  });
  it('archivo vacío y tope + 1 byte, por tipo', () => {
    negado(validarAdjunto(Buffer.alloc(0)), 'vacio');
    const MiB = 1024 * 1024;
    const j = jpeg(); const jGrande = Buffer.concat([j.subarray(0, j.length - 2), Buffer.alloc(5 * MiB + 1 - j.length), Buffer.from([0xff, 0xd9])]);
    expect(jGrande.length).toBe(5 * MiB + 1);
    negado(validarAdjunto(jGrande), 'demasiado_grande');
    const jTope = Buffer.concat([j.subarray(0, j.length - 2), Buffer.alloc(5 * MiB - j.length), Buffer.from([0xff, 0xd9])]);
    expect(jTope.length).toBe(5 * MiB);
    bueno(validarAdjunto(jTope));
    const pdfTope = Buffer.concat([pdf(), Buffer.alloc(16 * MiB - pdf().length)]);
    bueno(validarAdjunto(pdfTope, { mime: 'application/pdf' }));
    negado(validarAdjunto(Buffer.concat([pdfTope, Buffer.from('x')]), { mime: 'application/pdf' }), 'demasiado_grande');
    const oggGrande = Buffer.concat([ogg(), Buffer.alloc(16 * MiB)]);
    negado(validarAdjunto(oggGrande), 'demasiado_grande');
  });
  it('PDF con /JavaScript, /JS, /Launch, /EmbeddedFile, /OpenAction con acción y nombres ofuscados', () => {
    for (const c of ['/JavaScript (app.alert(1))', '/S /JavaScript /JS (x)', '/JS(x)', '/Launch << >>', '/EmbeddedFile', '/OpenAction << /S /URI >>', '/OpenAction 5 0 R', '/J#61vaScr#69pt (x)']) {
      negado(validarAdjunto(pdf(c), { nombre: 'x.pdf', mime: 'application/pdf' }), 'pdf_activo');
    }
    expect(pdfEsActivo(pdf('/OpenAction [3 0 R /Fit]'))).toBe(false); // un destino no es una acción
    bueno(validarAdjunto(pdf('/Pages 2 0 R /Title (JSON y JavaScript no son nombres)'), { mime: 'application/pdf' }));
  });
  it('txt con bytes NUL o UTF-8 inválido', () => {
    negado(validarAdjunto(Buffer.from([0x61, 0x00, 0x62]), { mime: 'text/plain' }), 'tipo_no_admitido');
    negado(validarAdjunto(Buffer.from([0xc3, 0x28]), { mime: 'text/plain' }), 'tipo_no_admitido');
  });
  it('lo que Meta acepta pero D1 no incluye: webp, amr, mp4', () => {
    negado(validarAdjunto(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(20)])), 'tipo_no_admitido');
    negado(validarAdjunto(Buffer.concat([Buffer.from('#!AMR\n'), Buffer.alloc(40)])), 'tipo_no_admitido');
    const mp4 = Buffer.alloc(64); mp4.writeUInt32BE(24, 0); mp4.write('ftypisom', 4, 'latin1');
    negado(validarAdjunto(mp4), 'tipo_no_admitido');
  });
});

describe('nombre de archivo', () => {
  it('RLO y compañía fuera: factura\\u202Efdp.exe no se disfraza', () => {
    const n = sanearNombre('factura‮fdp.exe', 'pdf');
    expect(n).not.toMatch(/[‪-‮⁦-⁩​-‏]/);
    expect(n.endsWith('.pdf')).toBe(true);
    expect(n).not.toMatch(/\.exe/);
  });
  it('factura.pdf.exe termina en la extensión detectada, sin doble extensión', () => {
    const n = sanearNombre('factura.pdf.exe', 'pdf');
    expect(n).toBe('factura_pdf.pdf');
  });
  it('sin barras, controles ni caracteres de ruta', () => {
    const n = sanearNombre('../../etc/pass\0wd\r\n.txt', 'txt');
    expect(n).not.toMatch(/[\\/\0\r\n]/);
    expect(n.startsWith('.')).toBe(false);
  });
  it('largo 1 a 240 y nombre vacío o ausente', () => {
    expect(sanearNombre('a'.repeat(1000) + '.pdf', 'pdf').length).toBe(240);
    expect(sanearNombre('😀'.repeat(1000), 'png').length).toBeLessThanOrEqual(240 * 2);
    expect([...sanearNombre('😀'.repeat(1000), 'png')].length).toBe(240);
    for (const v of ['', '   ', '...', undefined, null, 42, {}]) expect(sanearNombre(v, 'jpg')).toBe('archivo.jpg');
  });
  it('en el veredicto, la extensión sale de los bytes y no del nombre', () => {
    const r = bueno(validarAdjunto(pdf(), { nombre: 'resumen.exe', mime: 'application/pdf' }));
    expect(r.nombre).toBe('resumen.pdf');
    expect(bueno(validarAdjunto(png(), { nombre: 'a.jpg', mime: 'image/png' })).nombre).toBe('a.png');
  });
});

describe('lo que PASA', () => {
  it('JPEG: quita EXIF/GPS y deja el resto igual', () => {
    const con = jpeg(16, 16, [EXIF, seg(0xfe, Buffer.from('comentario')), seg(0xe2, Buffer.from('ICC_PROFILE'))]);
    expect(con.includes(Buffer.from('GPS-17'))).toBe(true);
    const r = bueno(validarAdjunto(con, { nombre: 'IMG_1.JPG', mime: 'image/jpeg', tipo: 'image' }));
    expect(r.limpiado).toBe(true);
    expect(r.bytes.includes(Buffer.from('GPS-17'))).toBe(false);
    expect(r.bytes.includes(Buffer.from('JFIF'))).toBe(true);
    expect(r.bytes).toEqual(jpeg());
    expect([r.tipo, r.ext, r.mime, r.nombre, r.voz]).toEqual(['image', 'jpg', 'image/jpeg', 'IMG_1.jpg', false]);
  });
  it('JPEG sin metadatos queda idéntico y sin marca de limpieza', () => {
    const r = bueno(validarAdjunto(jpeg()));
    expect(r.limpiado).toBe(false);
    expect(r.bytes).toEqual(jpeg());
  });
  it('PNG: quita tEXt, zTXt, iTXt y eXIf, conserva el resto', () => {
    const extras = [chunkPng('tEXt', Buffer.from('GPS\0-17')), chunkPng('zTXt', Buffer.from('x\0\0y')), chunkPng('iTXt', Buffer.from('x')), chunkPng('eXIf', Buffer.from('GPS')), chunkPng('gAMA', Buffer.alloc(4))];
    const r = bueno(validarAdjunto(png(8, 8, extras), { mime: 'image/png' }));
    expect(r.limpiado).toBe(true);
    for (const t of ['tEXt', 'zTXt', 'iTXt', 'eXIf']) expect(r.bytes.includes(Buffer.from(t))).toBe(false);
    expect(r.bytes).toEqual(png(8, 8, [chunkPng('gAMA', Buffer.alloc(4))]));
  });
  it('Ogg/Opus mono es nota de voz', () => {
    const r = bueno(validarAdjunto(ogg(), { mime: 'audio/ogg; codecs=opus', tipo: 'audio' }));
    expect([r.tipo, r.ext, r.mime, r.voz, r.reempaquetado]).toEqual(['audio', 'ogg', 'audio/ogg', true, false]);
  });
  it('mp3, m4a y aac pasan como audio sin ser voz', () => {
    const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(200)]);
    const m4a = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypM4A '), Buffer.alloc(100)]);
    const aac = Buffer.concat([Buffer.from([0xff, 0xf1]), Buffer.alloc(200)]);
    for (const [b, e] of [[mp3, 'mp3'], [m4a, 'm4a'], [aac, 'aac']] as const) {
      const r = bueno(validarAdjunto(b, { tipo: 'audio' }));
      expect([r.ext, r.voz]).toEqual([e, false]);
    }
  });
  it('documentos: pdf, docx, xlsx, pptx y txt (por mime o, sin mime, por la extensión del nombre)', () => {
    expect(bueno(validarAdjunto(pdf(), { mime: 'application/pdf' })).ext).toBe('pdf');
    expect(bueno(validarAdjunto(DOCX(), { mime: MIME_DOCX })).ext).toBe('docx');
    expect(bueno(validarAdjunto(DOCX(), { nombre: 'carta.docx' })).ext).toBe('docx');
    expect(bueno(validarAdjunto(zip('[Content_Types].xml', 'xl/workbook.xml'), { nombre: 'a.xlsx' })).ext).toBe('xlsx');
    expect(bueno(validarAdjunto(zip('[Content_Types].xml', 'ppt/presentation.xml'), { nombre: 'a.pptx' })).ext).toBe('pptx');
    const t = bueno(validarAdjunto(Buffer.from('hola, ñandú\n', 'utf8'), { nombre: 'nota.txt', mime: 'text/plain; charset=utf-8' }));
    expect([t.ext, t.tipo, t.mime]).toEqual(['txt', 'document', 'text/plain']);
  });
  it('un docx rotulado como xlsx se niega (la carpeta interna no coincide)', () => {
    negado(validarAdjunto(DOCX(), { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'tipo_no_admitido');
  });
});

describe('WebM/Opus → Ogg/Opus', () => {
  it('el Ogg resultante tiene páginas con CRC válido, OpusHead mono y OpusTags', () => {
    const r = bueno(validarAdjunto(webm({ tramas: 60 }), { mime: 'audio/webm;codecs=opus', tipo: 'audio' }));
    expect([r.ext, r.mime, r.voz, r.reempaquetado]).toEqual(['ogg', 'audio/ogg', true, true]);
    // CRC calculado aparte, página por página
    let i = 0; let paginas = 0;
    while (i < r.bytes.length) {
      const nSeg = r.bytes[i + 26] as number;
      const largo = r.bytes.subarray(i + 27, i + 27 + nSeg).reduce((a, x) => a + x, 0);
      const fin = i + 27 + nSeg + largo;
      const p = Buffer.from(r.bytes.subarray(i, fin));
      const guardado = p.readUInt32LE(22); p.writeUInt32LE(0, 22);
      expect(crcOggAparte(p)).toBe(guardado);
      expect(crcOgg(p)).toBe(guardado);
      paginas++; i = fin;
    }
    expect(i).toBe(r.bytes.length);
    expect(paginas).toBeGreaterThanOrEqual(4); // cabecera, etiquetas y 60 tramas en lotes de 25
    const leidas = leerPaginasOgg(r.bytes);
    expect(leidas).not.toBeNull();
    const pags = leidas!;
    expect(pags[0]!.banderas & 0x02).toBe(0x02);
    expect(pags[pags.length - 1]!.banderas & 0x04).toBe(0x04);
    expect(pags[0]!.datos.toString('latin1', 0, 8)).toBe('OpusHead');
    expect(pags[0]!.datos[9]).toBe(1);
    expect(pags[1]!.datos.toString('latin1', 0, 8)).toBe('OpusTags');
    // 60 tramas de 20 ms a 48 kHz = 57.600 muestras
    expect(pags[pags.length - 1]!.granule).toBe(57_600n);
    // los paquetes de audio son los mismos bytes que había en el WebM
    const audio = Buffer.concat(pags.slice(2).map(p => p.datos));
    expect(audio).toEqual(Buffer.concat(Array.from({ length: 60 }, (_, k) => trama(k))));
  });
  it('es determinista y sobrevive a la validación de Ogg del propio módulo', () => {
    const a = reempaquetarWebmOpusAOgg(webm());
    const b = reempaquetarWebmOpusAOgg(webm());
    expect(a.ok && b.ok && a.bytes.equals(b.bytes)).toBe(true);
    if (a.ok) bueno(validarAdjunto(a.bytes, { mime: 'audio/ogg' }));
  });
  it('muchas tramas: ninguna página pasa de 255 segmentos', () => {
    const r = bueno(validarAdjunto(webm({ tramas: 1000 })));
    for (const p of leerPaginasOgg(r.bytes)!) expect(p.tabla.length).toBeLessThanOrEqual(255);
  });
  it('un WebM rotulado como imagen no pasa', () => {
    negado(validarAdjunto(webm(), { mime: 'image/png' }), 'tipo_no_coincide');
  });
});
