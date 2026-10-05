/**
 * EL LOGO NO SE DECODIFICA POR UNA URL `blob:`.
 *
 * Con un JPEG válido de 526x526 la consola decía «Ese archivo no es una imagen
 * que podamos leer»: `recortar` usaba `URL.createObjectURL` + `<img>`, y la CSP
 * (`img-src 'self' data: https:`) no admite `blob:`, así que `onerror` saltaba
 * siempre. Esta suite fija tres cosas: que el camino del logo no vuelva a usar
 * `createObjectURL`, que la decodificación cae al respaldo y por fin al error
 * explicado, y que nadie «arregle» el síntoma aflojando la CSP sin decidirlo.
 *
 * No necesita emulador ni navegador: dobles de `createImageBitmap`,
 * `FileReader` e `Image`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { decodificarImagen } from '../../web/src/central/lib/decodificarImagen.ts';
import { ErrorDeImagen, mensajeDeErrorDeLogo } from '../../web/src/central/lib/errorLogo.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const RAIZ_ADMIN = join(aqui, '..', '..');
const leer = (ruta: string) => readFileSync(join(RAIZ_ADMIN, ruta), 'utf8');
const sinComentarios = (fuente: string) => fuente
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const archivo = {} as File;

/** Dobles mínimos de FileReader e Image que disparan onload/onerror a pedido. */
function lectorQue(resultado: 'ok' | 'error') {
  return () => {
    const l = { result: 'data:image/jpeg;base64,AAAA', onload: () => {}, onerror: () => {},
      readAsDataURL() { queueMicrotask(() => (resultado === 'ok' ? l.onload() : l.onerror())); } };
    return l as unknown as FileReader;
  };
}
function imagenQue(resultado: 'ok' | 'error', ancho = 526, alto = 526) {
  return () => {
    const i = { naturalWidth: ancho, naturalHeight: alto, onload: () => {}, onerror: () => {},
      set src(_v: string) { queueMicrotask(() => (resultado === 'ok' ? i.onload() : i.onerror())); } };
    return i as unknown as HTMLImageElement;
  };
}

describe('decodificarImagen', () => {
  it('createImageBitmap que funciona: usa sus medidas reales y cierra el bitmap', async () => {
    const close = vi.fn();
    const crearBitmap = vi.fn(async () => ({ width: 526, height: 400, close }) as unknown as ImageBitmap);
    const nuevoLector = vi.fn(lectorQue('ok'));
    const r = await decodificarImagen(archivo, { crearBitmap, nuevoLector });
    expect(r.ancho).toBe(526);
    expect(r.alto).toBe(400);
    expect(nuevoLector).not.toHaveBeenCalled();
    r.cerrar();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('createImageBitmap que lanza: cae al respaldo FileReader + Image (data:)', async () => {
    const crearBitmap = vi.fn(async () => { throw new Error('no decodifica'); });
    const r = await decodificarImagen(archivo, {
      crearBitmap, nuevoLector: lectorQue('ok'), nuevaImagen: imagenQue('ok', 600, 300),
    });
    expect(crearBitmap).toHaveBeenCalledTimes(1);
    expect(r.ancho).toBe(600);
    expect(r.alto).toBe(300);
    expect(() => r.cerrar()).not.toThrow();
  });

  it('el respaldo carga la imagen desde un data:, nunca desde un blob:', async () => {
    let fuenteAsignada = '';
    const nuevaImagen = () => {
      const i = { naturalWidth: 1, naturalHeight: 1, onload: () => {}, onerror: () => {},
        set src(v: string) { fuenteAsignada = v; queueMicrotask(() => i.onload()); } };
      return i as unknown as HTMLImageElement;
    };
    await decodificarImagen(archivo, {
      crearBitmap: async () => { throw new Error('x'); }, nuevoLector: lectorQue('ok'), nuevaImagen,
    });
    expect(fuenteAsignada).toMatch(/^data:/);
  });

  it('ambos fallan (la imagen no carga): ErrorDeImagen con el texto explicado', async () => {
    const error = await decodificarImagen(archivo, {
      crearBitmap: async () => { throw new Error('x'); }, nuevoLector: lectorQue('ok'), nuevaImagen: imagenQue('error'),
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorDeImagen);
    expect(mensajeDeErrorDeLogo(error)).toMatch(/^No pudimos leer ese archivo como imagen\. Sube un PNG, JPG o WebP/);
  });

  it('ambos fallan (el lector falla): ErrorDeImagen', async () => {
    const error = await decodificarImagen(archivo, {
      crearBitmap: async () => { throw new Error('x'); }, nuevoLector: lectorQue('error'),
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorDeImagen);
  });
});

describe('el camino del logo no usa createObjectURL', () => {
  it('ni Configuracion.tsx ni la decodificación lo llaman', () => {
    for (const ruta of ['web/src/central/paginas/Configuracion.tsx', 'web/src/central/lib/decodificarImagen.ts']) {
      expect(sinComentarios(leer(ruta)), ruta).not.toMatch(/createObjectURL|revokeObjectURL/);
    }
  });
  it('recortar decodifica con decodificarImagen y libera con cerrar()', () => {
    const f = sinComentarios(leer('web/src/central/paginas/Configuracion.tsx'));
    const cuerpo = f.slice(f.indexOf('async function recortar'));
    expect(cuerpo).toMatch(/await decodificarImagen\(archivo\)/);
    expect(cuerpo).toMatch(/img\.cerrar\(\)/);
  });
});

describe('la CSP de la consola NO admite blob: en img-src', () => {
  const csp = leer('firebase.json');
  const politicas = [...csp.matchAll(/"key":\s*"Content-Security-Policy",\s*"value":\s*"([^"]*)"/g)].map((m) => m[1] ?? '');
  it('hay dos políticas y las dos tienen img-src', () => {
    expect(politicas).toHaveLength(2);
    for (const p of politicas) expect(p).toMatch(/img-src [^;]+/);
  });
  it('ningún img-src contiene blob:', () => {
    for (const p of politicas) {
      const imgSrc = /img-src ([^;]+)/.exec(p)?.[1] ?? '';
      expect(imgSrc).not.toMatch(/blob:/);
    }
  });
});
