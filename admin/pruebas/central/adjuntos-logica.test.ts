/**
 * MEDIOS B4 — LÓGICA PURA DE ADJUNTAR (web/src/central/lib/adjuntos.ts), sin navegador ni red. Escrita negando.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  AUDIOS, DOCUMENTOS, ENTRADA_IMAGEN, MAX_LEYENDA, TEXTOS_DE_RECHAZO, TOPE_AUDIO, TOPE_DOCUMENTO, TOPE_IMAGEN,
  base64DeDataUrl, claveDelAdjunto, clasificarArchivo, cuerpoDeAdjunto, destinatarioAbreviado, ejecutarEnvioDeAdjunto,
  formatoDeGrabacion, leyendaParaEnviar, medidasDeRecodificacion, puedeEnviarMediosDeFicha, recodificarImagen,
  textoErrorAdjunto, textoErrorMicrofono, verAdjuntar, ErrorDeAdjunto,
  type AdjuntoPreparado, type CapaAdjunto, type LienzoMinimo,
} from '../../web/src/central/lib/adjuntos';
import { TOPE_ORIGINAL } from '../../web/src/central/lib/decodificarImagen';

const MIB = 1024 * 1024;

describe('verAdjuntar: solo con las cuatro condiciones', () => {
  const ok = { verEscribir: true, puedeEnviarMedios: true, ventana: 'abierta' as const, habilitados: true };
  it('con todo cumplido se ve', () => expect(verAdjuntar(ok)).toBe(true));
  it.each([
    ['sin verEscribir', { ...ok, verEscribir: false }],
    ['sin la bandera de medios', { ...ok, puedeEnviarMedios: false }],
    ['ventana cerrada', { ...ok, ventana: 'cerrada' as const }],
    ['ventana sin dato', { ...ok, ventana: 'sin-dato' as const }],
    ['comercio no habilitado', { ...ok, habilitados: false }],
  ])('NEGANDO: %s no se ve', (_n, a) => expect(verAdjuntar(a)).toBe(false));
});

describe('puedeEnviarMediosDeFicha falla cerrada', () => {
  const base = { consolaConversaciones: 'nueva', personaPuedeEscribir: true, personaPuedeEnviarMedios: true };
  it('con las tres banderas explícitas, sí', () => expect(puedeEnviarMediosDeFicha(base)).toBe(true));
  it.each([
    ['bandera "true" (texto)', { ...base, personaPuedeEnviarMedios: 'true' }],
    ['bandera 1', { ...base, personaPuedeEnviarMedios: 1 }],
    ['bandera null', { ...base, personaPuedeEnviarMedios: null }],
    ['bandera ausente', { consolaConversaciones: 'nueva', personaPuedeEscribir: true }],
    ['sin poder escribir', { ...base, personaPuedeEscribir: false }],
    ['sin pantalla nueva', { ...base, consolaConversaciones: 'vieja' }],
    ['ficha null', null],
    ['ficha ausente', undefined],
  ])('NEGANDO: %s', (_n, f) => expect(puedeEnviarMediosDeFicha(f as never)).toBe(false));
});

describe('formatoDeGrabacion: nunca mp4', () => {
  const con = (...ok: string[]) => ({ hayMediaRecorder: true, hayGetUserMedia: true, soporta: (m: string) => ok.includes(m) });
  it('con ogg y webm prefiere ogg', () =>
    expect(formatoDeGrabacion(con('audio/ogg;codecs=opus', 'audio/webm;codecs=opus'))?.mimeDeclarado).toBe('audio/ogg'));
  it('solo webm da webm', () => expect(formatoDeGrabacion(con('audio/webm;codecs=opus'))?.mimeDeclarado).toBe('audio/webm'));
  it('NEGANDO: solo mp4 da null', () => expect(formatoDeGrabacion(con('audio/mp4'))).toBeNull());
  it('NEGANDO: sin MediaRecorder o sin getUserMedia da null', () => {
    expect(formatoDeGrabacion({ ...con('audio/ogg;codecs=opus'), hayMediaRecorder: false })).toBeNull();
    expect(formatoDeGrabacion({ ...con('audio/ogg;codecs=opus'), hayGetUserMedia: false })).toBeNull();
  });
});

describe('clasificarArchivo', () => {
  it('admite los de imagen, documento y audio de la lista', () => {
    for (const e of Object.keys(ENTRADA_IMAGEN)) expect(clasificarArchivo(`a.${e}`, '', 10)).toMatchObject({ ok: true, clase: 'imagen' });
    for (const e of Object.keys(DOCUMENTOS)) expect(clasificarArchivo(`a.${e}`, '', 10)).toMatchObject({ ok: true, clase: 'documento' });
    for (const e of Object.keys(AUDIOS)) expect(clasificarArchivo(`a.${e}`, '', 10)).toMatchObject({ ok: true, clase: 'audio' });
    expect(Object.keys(ENTRADA_IMAGEN)).toHaveLength(3);
    expect(Object.keys(DOCUMENTOS)).toHaveLength(5);
    expect(Object.keys(AUDIOS)).toHaveLength(4);
  });
  it.each(['a.doc', 'a.xls', 'a.ppt', 'a.csv', 'a.zip', 'a.webp', 'a.gif', 'a.heic', 'a.mp4', 'a.webm', 'a.exe', 'factura.pdf.exe', 'sinextension', 'termina.'])(
    'NEGANDO: %s no se admite', (n) => expect(clasificarArchivo(n, 'application/pdf', 10)).toEqual({ ok: false, error: 'tipo_no_admitido' }));
  it('tamaños: 0 vacío; 16 MiB pasa; 16 MiB + 1 pesa demasiado; imagen hasta 25 MiB', () => {
    expect(clasificarArchivo('a.pdf', '', 0)).toEqual({ ok: false, error: 'vacio' });
    expect(clasificarArchivo('a.pdf', '', 16 * MIB).ok).toBe(true);
    expect(clasificarArchivo('a.pdf', '', 16 * MIB + 1)).toEqual({ ok: false, error: 'demasiado_grande' });
    expect(clasificarArchivo('a.mp3', '', 16 * MIB + 1)).toEqual({ ok: false, error: 'demasiado_grande' });
    expect(clasificarArchivo('a.png', '', TOPE_ORIGINAL).ok).toBe(true);
    expect(clasificarArchivo('a.png', '', TOPE_ORIGINAL + 1)).toEqual({ ok: false, error: 'demasiado_grande' });
  });
  it('NEGANDO: un file.type mentiroso no cambia el mime derivado', () => {
    expect(clasificarArchivo('a.pdf', 'image/png', 10)).toMatchObject({ ok: true, mime: DOCUMENTOS['pdf'] });
    expect(clasificarArchivo('a.txt', 'application/x-msdownload', 10)).toMatchObject({ ok: true, mime: 'text/plain' });
  });
  it('los topes de la consola son los del servidor', () => {
    expect([TOPE_IMAGEN, TOPE_DOCUMENTO, TOPE_AUDIO]).toEqual([5 * MIB, 16 * MIB, 16 * MIB]);
  });
});

describe('medidasDeRecodificacion', () => {
  it('acota el lado mayor y conserva la proporción', () => {
    expect(medidasDeRecodificacion(4097, 10)).toEqual({ ancho: 4096, alto: 10 });
    expect(medidasDeRecodificacion(8000, 6000)).toEqual({ ancho: 4096, alto: 3072 });
    expect(medidasDeRecodificacion(10, 10)).toEqual({ ancho: 10, alto: 10 });
  });
  it('NEGANDO: nunca da 0', () => {
    const m = medidasDeRecodificacion(10000, 1);
    expect(m.alto).toBeGreaterThanOrEqual(1);
  });
});

describe('recodificarImagen', () => {
  const montar = (tamanos: (number | null)[]) => {
    const orden: string[] = [];
    let n = 0;
    const cerrar = vi.fn();
    const lienzo: LienzoMinimo = {
      getContext: () => ({
        fillStyle: '', fillRect: () => { orden.push('fillRect'); }, drawImage: () => { orden.push('drawImage'); },
      }),
      toBlob: (cb, tipo, q) => {
        orden.push(`toBlob:${tipo}:${q}`);
        const t = tamanos[Math.min(n++, tamanos.length - 1)];
        cb(t === null ? null : ({ size: t } as Blob));
      },
    };
    const piezas = {
      decodificar: async () => ({ fuente: {} as CanvasImageSource, ancho: 5000, alto: 10, cerrar }),
      crearLienzo: () => lienzo,
      leerComoDataUrl: async () => 'data:image/jpeg;base64,AAAA',
    };
    return { piezas, orden, cerrar };
  };
  it('exporta JPEG, pinta fondo antes de la imagen y baja la calidad hasta caber', async () => {
    const { piezas, orden, cerrar } = montar([6 * MIB, 6 * MIB, 4 * MIB]);
    const r = await recodificarImagen({} as Blob, piezas);
    expect(r).toEqual({ dataUrl: 'data:image/jpeg;base64,AAAA', base64: 'AAAA', tamano: 4 * MIB });
    expect(orden.indexOf('fillRect')).toBeLessThan(orden.indexOf('drawImage'));
    expect(orden.filter((o) => o.startsWith('toBlob'))).toEqual(['toBlob:image/jpeg:0.85', 'toBlob:image/jpeg:0.75', 'toBlob:image/jpeg:0.65']);
    expect(cerrar).toHaveBeenCalledTimes(1);
  });
  it('NEGANDO: si nunca baja de 5 MiB, demasiado_grande, y igual libera', async () => {
    const { piezas, cerrar } = montar([6 * MIB]);
    await expect(recodificarImagen({} as Blob, piezas)).rejects.toMatchObject({ codigo: 'demasiado_grande' });
    expect(cerrar).toHaveBeenCalledTimes(1);
  });
  it('NEGANDO: un lienzo que no da blob es imagen_ilegible y libera', async () => {
    const { piezas, cerrar } = montar([null]);
    await expect(recodificarImagen({} as Blob, piezas)).rejects.toBeInstanceOf(ErrorDeAdjunto);
    expect(cerrar).toHaveBeenCalledTimes(1);
  });
  it('NEGANDO: si no decodifica, imagen_ilegible', async () => {
    const { piezas } = montar([1]);
    await expect(recodificarImagen({} as Blob, { ...piezas, decodificar: async () => { throw new Error('x'); } }))
      .rejects.toMatchObject({ codigo: 'imagen_ilegible' });
  });
});

describe('base64DeDataUrl', () => {
  it('lee un data URL válido', () => expect(base64DeDataUrl('data:image/jpeg;base64,AAAA')).toBe('AAAA'));
  it.each([
    ['sin prefijo', 'AAAA'], ['sin ;base64', 'data:image/jpeg,AAAA'], ['alfabeto', 'data:a/b;base64,AA*A'],
    ['largo no múltiplo de 4', 'data:a/b;base64,AAA'], ['vacío', 'data:a/b;base64,'],
  ])('NEGANDO: %s', (_n, d) => expect(base64DeDataUrl(d)).toBeNull());
});

describe('leyendaParaEnviar', () => {
  it('NEGANDO: en audio o voz nunca devuelve leyenda', () => {
    expect(leyendaParaEnviar('hola', 'audio')).toEqual({ ok: true });
    expect(leyendaParaEnviar('hola', 'voz')).toEqual({ ok: true });
  });
  it('vacía o solo espacios no la devuelve; se recorta', () => {
    expect(leyendaParaEnviar('   \n ', 'imagen')).toEqual({ ok: true });
    expect(leyendaParaEnviar('  hola  ', 'documento')).toEqual({ ok: true, leyenda: 'hola' });
    expect(leyendaParaEnviar('a\nb', 'imagen')).toEqual({ ok: true, leyenda: 'a\nb' });
  });
  it('NEGANDO: 1001 caracteres o un control son inválidos', () => {
    expect(leyendaParaEnviar('a'.repeat(MAX_LEYENDA + 1), 'imagen')).toEqual({ ok: false });
    expect(leyendaParaEnviar('a\u0007b', 'imagen')).toEqual({ ok: false });
  });
});

describe('cuerpo y envío', () => {
  const imagen: AdjuntoPreparado = { id: 'id-imagen-1', clase: 'imagen', base64: 'AAAA', mime: 'image/jpeg', tamano: 3 };
  const doc: AdjuntoPreparado = { id: 'id-doc-1', clase: 'documento', base64: 'AAAA', mime: DOCUMENTOS['pdf']!, nombre: 'carta.pdf', tamano: 3 };
  const voz: AdjuntoPreparado = { id: 'id-voz-1', clase: 'voz', base64: 'AAAA', mime: 'audio/webm', tamano: 3 };
  const e = { tenantId: 't', conversacionId: 'wa_1' };
  const capaCon = (f: (x: unknown) => Promise<unknown>): CapaAdjunto & { llamadas: unknown[] } => {
    const llamadas: unknown[] = [];
    return { llamadas, enviarAdjunto: async (x) => { llamadas.push(x); return f(x); } };
  };
  const fija = () => 'clave-generada-0001';

  it('NEGANDO: las claves sin valor se omiten (Object.keys, no undefined)', () => {
    const c = cuerpoDeAdjunto({ ...e, clave: 'k', adjunto: { base64: 'AAAA', mime: 'image/jpeg' } });
    expect(Object.keys(c).sort()).toEqual(['adjunto', 'clave', 'conversacionId', 'tenantId']);
    expect(Object.keys(c['adjunto'] as object).sort()).toEqual(['base64', 'mime']);
    const d = cuerpoDeAdjunto({ ...e, clave: 'k', adjunto: { base64: 'A', mime: 'm', nombre: 'n' }, leyenda: 'l' });
    expect(Object.keys(d).sort()).toEqual(['adjunto', 'clave', 'conversacionId', 'leyenda', 'tenantId']);
  });
  it('imagen sin leyenda: el adjunto no tiene nombre y el cuerpo no tiene leyenda', async () => {
    const capa = capaCon(async () => ({ estado: 'pendiente' }));
    await ejecutarEnvioDeAdjunto(capa, { ...e, preparado: imagen }, null, fija);
    const x = capa.llamadas[0] as { adjunto: object; leyenda?: string };
    expect(Object.keys(x.adjunto).sort()).toEqual(['base64', 'mime']);
    expect('leyenda' in x).toBe(false);
  });
  it('NEGANDO: voz con leyenda pasada no lleva leyenda ni nombre', async () => {
    const capa = capaCon(async () => ({ estado: 'pendiente' }));
    await ejecutarEnvioDeAdjunto(capa, { ...e, preparado: voz, leyenda: 'hola' }, null, fija);
    const x = capa.llamadas[0] as { adjunto: object };
    expect('leyenda' in x).toBe(false);
    expect('nombre' in x.adjunto).toBe(false);
  });
  it('documento manda su nombre y la leyenda', async () => {
    const capa = capaCon(async () => ({ estado: 'pendiente' }));
    await ejecutarEnvioDeAdjunto(capa, { ...e, preparado: doc, leyenda: 'mire' }, null, fija);
    expect(capa.llamadas[0]).toMatchObject({ adjunto: { nombre: 'carta.pdf' }, leyenda: 'mire' });
  });
  it('sin respuesta: queda abierto con la misma clave y el reintento la reusa', async () => {
    const capa = capaCon(async () => { throw { code: 'functions/deadline-exceeded' }; });
    const a = await ejecutarEnvioDeAdjunto(capa, { ...e, preparado: imagen }, null, fija);
    expect(a.salida).toMatchObject({ tipo: 'error', desconocido: true });
    expect(a.borrador).not.toBeNull();
    const b = await ejecutarEnvioDeAdjunto(capa, { ...e, preparado: imagen }, a.borrador, () => 'otra-clave-distinta-9');
    expect(b.clave).toBe(a.clave);
  });
  it('pendiente cierra el borrador; rechazado es fallido', async () => {
    const ok = await ejecutarEnvioDeAdjunto(capaCon(async () => ({ estado: 'pendiente' })), { ...e, preparado: imagen }, null, fija);
    expect(ok.salida).toEqual({ tipo: 'enviado' });
    expect(ok.borrador).toBeNull();
    const mal = await ejecutarEnvioDeAdjunto(capaCon(async () => ({ estado: 'rechazado' })), { ...e, preparado: imagen }, null, fija);
    expect(mal.salida).toEqual({ tipo: 'fallido' });
  });
  it('NEGANDO: un error con respuesta definitiva cierra el borrador', async () => {
    const r = await ejecutarEnvioDeAdjunto(capaCon(async () => { throw { code: 'functions/permission-denied' }; }), { ...e, preparado: imagen }, null, fija);
    expect(r.borrador).toBeNull();
  });
  it('misma clave solo con el mismo archivo y el mismo texto; sin borrador abierto cualquier cambio es clave nueva', () => {
    const nueva = () => 'zzzzzzzzzzzzzzzzzzzz';
    const a = claveDelAdjunto(null, 'x', '', fija);
    expect(claveDelAdjunto(a, 'x', '', nueva)).toBe(a);
    expect(claveDelAdjunto(a, 'y', '', nueva).clave).toBe('zzzzzzzzzzzzzzzzzzzz');
    // Otro texto sobre el mismo archivo es otro contenido: nunca reusa la clave (el servidor la ata al contenido).
    // Con un borrador abierto la pantalla ni deja editar el texto (ver adjuntos-pantalla).
    expect(claveDelAdjunto(a, 'x', 'otra', nueva).clave).toBe('zzzzzzzzzzzzzzzzzzzz');
    expect(claveDelAdjunto(null, 'x', 'otra', nueva).clave).toBe('zzzzzzzzzzzzzzzzzzzz');
  });
});

describe('textoErrorAdjunto', () => {
  const GENERICO = 'No se pudo enviar el archivo. Intente de nuevo.';
  it('cada código de rechazo da un texto propio, distinto del genérico', () => {
    const codigos = Object.keys(TEXTOS_DE_RECHAZO);
    expect(codigos).toHaveLength(14);
    const textos = codigos.map((m) => textoErrorAdjunto('invalid-argument', { motivo: m }));
    expect(new Set(textos).size).toBe(14);
    for (const t of textos) expect(t).not.toBe(GENERICO);
  });
  it('invalid-argument sin motivo o con motivo desconocido o heredado no revienta', () => {
    const base = textoErrorAdjunto('invalid-argument', {});
    expect(textoErrorAdjunto('invalid-argument', { motivo: 'inventado' })).toBe(base);
    expect(textoErrorAdjunto('invalid-argument', { motivo: 'constructor' })).toBe(base);
  });
  it('los cinco topes se dicen distinto; el del minuto trae los segundos', () => {
    const t = ['minuto', 'conversacion', 'dia', 'adjuntosDia', 'bytesDia'].map((x) => textoErrorAdjunto('resource-exhausted', { tope: x, esperaSegundos: 37 }));
    expect(new Set(t).size).toBe(5);
    expect(t[0]).toContain('37 s');
  });
  it('NEGANDO: ni el message ni details.message del servidor llegan a la persona (camino real del envío)', async () => {
    const e = { tenantId: 't', conversacionId: 'wa_1', preparado: { id: 'i', clase: 'imagen' as const, base64: 'AAAA', mime: 'image/jpeg', tamano: 3 } };
    for (const code of ['functions/internal', 'functions/permission-denied', 'functions/failed-precondition', 'functions/invalid-argument',
      'functions/resource-exhausted', 'functions/not-found', 'functions/otro', 'functions/deadline-exceeded']) {
      const capa: CapaAdjunto = { enviarAdjunto: async () => { throw { code, message: 'SECRETO-INTERNO', details: { message: 'SECRETO-DETALLE', motivo: 'inventado', tope: 'inventado' } }; } };
      const r = await ejecutarEnvioDeAdjunto(capa, e, null, () => 'clave-generada-0001');
      expect(r.salida.tipo).toBe('error');
      const texto = r.salida.tipo === 'error' ? r.salida.texto : '';
      expect(texto.length).toBeGreaterThan(10);
      expect(texto).not.toContain('SECRETO');
    }
  });
  it('permission-denied menciona el envío de archivos; sin respuesta invita a reintentar sin duplicar', () => {
    expect(textoErrorAdjunto('permission-denied')).toContain('envío de archivos');
    expect(textoErrorAdjunto('')).toContain('Reintentar envío');
    expect(textoErrorAdjunto('failed-precondition', { motivo: 'espera', esperaSegundos: 12 })).toContain('12 segundos');
  });
});

describe('destinatario y micrófono', () => {
  it('destinatarioAbreviado', () => {
    expect(destinatarioAbreviado('', '59100000047')).toEqual({ nombre: 'el cliente', ultimos4: '0047' });
    expect(destinatarioAbreviado('Ana', '+591 000 00047').ultimos4).toBe('0047');
    expect(destinatarioAbreviado('Ana', '123').ultimos4).toBe('');
  });
  it('textoErrorMicrofono: los cuatro casos', () => {
    const t = ['NotAllowedError', 'NotFoundError', 'NotReadableError', 'Otro'].map(textoErrorMicrofono);
    expect(new Set(t).size).toBe(4);
    expect(textoErrorMicrofono('SecurityError')).toBe(t[0]);
  });
});
