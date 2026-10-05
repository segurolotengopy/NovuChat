/**
 * LO QUE EL COMERCIO LEE CUANDO FALLA EL LOGO. Una prueba por rama del mapeo, y
 * la que importa: el texto crudo del SDK no llega nunca a la pantalla. El
 * fallo real del 04/10 fue un archivo que el navegador no decodificó; antes se
 * mostraba «Ese archivo no es una imagen que podamos leer.» y, si fallaba el
 * guardado, `error.message` tal cual.
 *
 * No necesita emulador ni el SDK: el módulo lee `error.code` por forma.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ErrorDeImagen, mensajeDeErrorDeLogo,
  TEXTO_GENERICO, TEXTO_SESION_VENCIDA, TEXTO_SIN_CONEXION, TEXTO_SIN_PERMISO, TEXTO_TAMANO_RECHAZADO,
} from '../../web/src/central/lib/errorLogo.ts';

const aqui = dirname(fileURLToPath(import.meta.url));

/** La forma de un FirebaseError, sin importar el SDK. */
const deFirebase = (code: string, message: string) => Object.assign(new Error(message), { code, name: 'FirebaseError' });

describe('errores propios de la imagen (por clase, no por texto)', () => {
  it('ilegible: el texto fijado por Principal, con PNG, JPG o WebP', () => {
    expect(mensajeDeErrorDeLogo(new ErrorDeImagen('ilegible'))).toBe(
      'No pudimos leer ese archivo como imagen. Sube un PNG, JPG o WebP (no un PDF ni una captura de '
      + 'otro formato). Si es de WhatsApp o de un PDF, guárdalo primero como imagen.');
  });
  it('pesada: un texto que vale tanto para el original enorme como para el que no entra reducido', () => {
    expect(mensajeDeErrorDeLogo(new ErrorDeImagen('pesada'))).toBe(
      'Esa imagen es demasiado pesada. Prueba con una más pequeña o más simple.');
  });
  it('sin lienzo: se conserva el texto de siempre', () => {
    expect(mensajeDeErrorDeLogo(new ErrorDeImagen('sin-lienzo'))).toBe('El navegador no pudo procesar la imagen.');
  });
  it('un Error común con el mismo texto NO se toma por error de imagen', () => {
    expect(mensajeDeErrorDeLogo(new Error('Ese archivo no es una imagen que podamos leer.'))).toBe(TEXTO_GENERICO);
  });
});

describe('errores del servidor, por código', () => {
  it('permission-denied: explica el permiso y NO deja pasar el texto crudo', () => {
    const m = mensajeDeErrorDeLogo(deFirebase('permission-denied', 'Missing or insufficient permissions.'));
    expect(m).toBe(TEXTO_SIN_PERMISO);
    expect(m).not.toMatch(/Missing or insufficient/i);
    // La regla exige administrador, negocio activo y catálogo web habilitado.
    expect(m).toMatch(/quien administra el negocio/);
    expect(m).toMatch(/activo/);
    expect(m).toMatch(/catálogo web habilitado/);
    expect(m).not.toMatch(/administradora|plan/);
  });
  it('con el prefijo firestore/ también', () => {
    expect(mensajeDeErrorDeLogo(deFirebase('firestore/permission-denied', 'x'))).toBe(TEXTO_SIN_PERMISO);
  });
  it('unavailable y deadline-exceeded: sin conexión', () => {
    expect(mensajeDeErrorDeLogo(deFirebase('unavailable', 'The service is currently unavailable.'))).toBe(TEXTO_SIN_CONEXION);
    expect(mensajeDeErrorDeLogo(deFirebase('deadline-exceeded', 'Deadline exceeded'))).toBe(TEXTO_SIN_CONEXION);
  });
  it('unauthenticated: sesión vencida', () => {
    expect(mensajeDeErrorDeLogo(deFirebase('unauthenticated', 'x'))).toBe(TEXTO_SESION_VENCIDA);
  });
  it('resource-exhausted e invalid-argument: tamaño rechazado', () => {
    expect(mensajeDeErrorDeLogo(deFirebase('resource-exhausted', 'x'))).toBe(TEXTO_TAMANO_RECHAZADO);
    expect(mensajeDeErrorDeLogo(deFirebase('invalid-argument', 'x'))).toBe(TEXTO_TAMANO_RECHAZADO);
  });
  it('un código desconocido da el texto genérico y no el message crudo', () => {
    const m = mensajeDeErrorDeLogo(deFirebase('internal', 'INTERNAL ASSERTION FAILED: algo'));
    expect(m).toBe(TEXTO_GENERICO);
    expect(m).not.toMatch(/INTERNAL/);
  });
  it('un objeto con code pero sin ser Error se lee igual', () => {
    expect(mensajeDeErrorDeLogo({ code: 'permission-denied', message: 'Missing or insufficient permissions' })).toBe(TEXTO_SIN_PERMISO);
  });
});

describe('entradas que no son errores', () => {
  it.each([['string', 'boom'], ['null', null], ['undefined', undefined], ['objeto vacío', {}], ['número', 42], ['code no texto', { code: 7 }]])(
    '%s: texto genérico', (_n, valor) => {
      expect(mensajeDeErrorDeLogo(valor)).toBe(TEXTO_GENERICO);
    });
});

describe('ningún texto cae en voseo ni deja el message crudo en el componente', () => {
  const textos = [TEXTO_GENERICO, TEXTO_SESION_VENCIDA, TEXTO_SIN_CONEXION, TEXTO_SIN_PERMISO, TEXTO_TAMANO_RECHAZADO,
    mensajeDeErrorDeLogo(new ErrorDeImagen('ilegible'))];
  it('sin voseo', () => {
    for (const t of textos) expect(t).not.toMatch(/\b(tenés|intentá|revisá|ingresá|podés|subí|guardalo)\b/i);
  });
  it('LogoDelComercio no muestra error.message', () => {
    const fuente = readFileSync(join(aqui, '..', '..', 'web', 'src', 'central', 'paginas', 'Configuracion.tsx'), 'utf8');
    const ini = fuente.indexOf('function LogoDelComercio');
    const cuerpo = fuente.slice(ini, fuente.indexOf('async function recortar'));
    expect(cuerpo).not.toMatch(/error\.message|\.message\b/);
    expect(cuerpo).toMatch(/mensajeDeErrorDeLogo\(error\)/g);
  });
});
