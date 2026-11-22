/**
 * LAS FOTOS SALEN ENTERAS (Andres, 22/11/2026): «No se deben recortar las
 * fotos, se pueden cambiar de resolución, pero deben salir enteras, el cliente
 * debe ver toda la foto que fue cargada».
 *
 * Invariante global de UX: ninguna hoja de estilos ni componente de `admin/web`
 * usa `object-fit: cover` (ni `objectFit: 'cover'`) ni `background-size: cover`
 * sobre una imagen. `cover` recorta lo que no entra en la caja: el 22/11 una
 * ficha de Walisuma con los círculos de colores al pie se veía sin ellos.
 * Se permite `contain` (entera, con fondo neutro). Si alguna vez hace falta un
 * `cover` que no sea una foto de producto ni un medio del cliente (un adorno
 * propio de NovuChat), se declara aquí con su archivo y su porqué.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '../../web');

/** Excepciones declaradas: ruta relativa a admin/web → porqué no es una foto del cliente. */
const EXCEPCIONES: Record<string, string> = {};

function archivos(dir: string): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(dir)) {
    if (nombre === 'node_modules' || nombre === 'dist') continue;
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) salida.push(...archivos(ruta));
    else if (/\.(css|tsx|ts|html)$/.test(nombre)) salida.push(ruta);
  }
  return salida;
}

// Quita los comentarios: la regla se explica en ellos y no es un uso.
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const COVER = /object-fit\s*:\s*cover|objectFit\s*[:=]\s*['"`]cover|background-size\s*:\s*cover|backgroundSize\s*[:=]\s*['"`]cover/i;

describe('fotos enteras: nunca object-fit/background-size cover en admin/web', () => {
  const lista = archivos(WEB);

  it('hay archivos que revisar (la prueba no es vacía)', () => {
    expect(lista.length).toBeGreaterThan(20);
  });

  it('ninguno recorta con cover', () => {
    const infractores = lista
      .filter((f) => !(relative(WEB, f) in EXCEPCIONES))
      .filter((f) => COVER.test(sinComentarios(readFileSync(f, 'utf8'))))
      .map((f) => relative(WEB, f));
    expect(infractores).toEqual([]);
  });

  it('niega: el detector SÍ marca cada forma de cover', () => {
    for (const malo of [
      '.f { object-fit: cover; }', '.f{object-fit:cover}', "style={{ objectFit: 'cover' }}",
      '.f { background-size: cover; }', "backgroundSize: 'cover'",
    ]) expect(COVER.test(sinComentarios(malo))).toBe(true);
    for (const bueno of ['.f { object-fit: contain; }', "style={{ objectFit: 'contain' }}", '/* object-fit: cover */ .f{}']) {
      expect(COVER.test(sinComentarios(bueno))).toBe(false);
    }
  });
});
