/**
 * La pantalla de términos de producto de Negocios (PR 3): se dibuja con `renderToStaticMarkup`.
 * La pantalla acompaña y el servidor manda; acá se prueba lo que la pantalla sí decide: qué botón
 * ofrece, que el texto del comercio no se interpreta, y que solo vive dentro de la página del
 * propietario (`Proteger requiere="propietario"`).
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TerminosProducto } from '../../web/src/plataforma/componentes/TerminosProducto';
import { listaDeTerminos, type FilaTermino } from '../../web/src/plataforma/lib/terminos';

const aqui = dirname(fileURLToPath(import.meta.url));
const desdeWeb = createRequire(join(aqui, '..', '..', 'web', 'package.json'));
const { createElement } = desdeWeb('react') as { createElement: (c: unknown, p: unknown) => unknown };
const { renderToStaticMarkup } = desdeWeb('react-dom/server') as { renderToStaticMarkup: (e: unknown) => string };

const fila = (extra: Partial<FilaTermino> = {}): FilaTermino => ({
  itemId: 'i1', termino: '100 prompts', estado: 'pendiente', nombre: 'Pack 100 prompts', activo: true, hashVigente: true, ...extra,
});
const dibujar = (filas: FilaTermino[] | null, extra: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(TerminosProducto, {
  filas, aprobados: filas?.filter((f) => f.estado === 'aprobado').length ?? 0, tope: 10, cargando: false, ocupado: false,
  onDecidir: () => undefined, ...extra,
}));

describe('TerminosProducto', () => {
  it('un pendiente vigente ofrece Aprobar y Rechazar, con el nombre, el término y el tope', () => {
    const html = dibujar([fila()]);
    expect(html).toContain('Pack 100 prompts');
    expect(html).toContain('100 prompts');
    expect(html).toContain('Aprobados: 0 de 10');
    expect(html).toMatch(/>Aprobar</);
    expect(html).toMatch(/>Rechazar</);
    expect(html).not.toMatch(/>Revocar</);
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>Aprobar/);
  });

  it('negando: Aprobar sale deshabilitado con el nombre cambiado, el ítem inactivo o el tope lleno', () => {
    for (const [f, extra] of [
      [fila({ hashVigente: false }), {}], [fila({ activo: false }), {}], [fila({ nombre: null, activo: false }), {}],
      [fila(), { aprobados: 10 }],
    ] as const) {
      expect(dibujar([f], extra), JSON.stringify([f, extra])).toMatch(/<button[^>]*disabled[^>]*>Aprobar/);
    }
  });

  it('un aprobado ofrece solo Revocar', () => {
    const html = dibujar([fila({ estado: 'aprobado' })]);
    expect(html).toMatch(/>Revocar</);
    expect(html).not.toMatch(/>Aprobar</);
    expect(html).not.toMatch(/>Rechazar</);
  });

  it('el texto del comercio no se interpreta: ni HTML ni marcas', () => {
    const html = dibujar([fila({ nombre: '<img src=x onerror=alert(1)> 100 prompts', termino: '<b>x</b>' })]);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>x');
  });

  it('sin lista: dice que lee o que no pudo leer, sin botones', () => {
    expect(dibujar(null, { cargando: true })).toContain('Leyendo');
    const sin = dibujar(null);
    expect(sin).toContain('No se pudo leer la lista.');
    expect(sin).not.toMatch(/<button/);
  });

  it('listaDeTerminos descarta lo que no tiene la forma del servidor', () => {
    const l = listaDeTerminos({ filas: [{ itemId: 'a', estado: 'aprobado', termino: 't', nombre: 'n', activo: true, hashVigente: true },
      { itemId: 7, estado: 'aprobado' }, { itemId: 'b', estado: 'otro' }, null], tope: 'x' });
    expect(l.filas.map((f) => f.itemId)).toEqual(['a']);
    expect(l.tope).toBe(10);
    expect(l.aprobados).toBe(1);
  });

  it('solo vive en la página del propietario, que ya está detrás de Proteger', () => {
    const pagina = readFileSync(join(aqui, '..', '..', 'web', 'src', 'plataforma', 'paginas', 'CuentaNegocio.tsx'), 'utf8');
    expect(pagina).toContain('<TerminosProducto');
    const rutas = readFileSync(join(aqui, '..', '..', 'web', 'src', 'App.tsx'), 'utf8');
    expect(rutas).toMatch(/Proteger requiere="propietario"[\s\S]{0,200}CuentaNegocio/);
  });
});
