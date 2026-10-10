/**
 * El título de la pestaña sale del tramo de la ruta, y la ruta de una conversación lleva su id (el teléfono):
 * el título nunca puede llevarlo.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { tramoDeTitulo } from '../../web/src/core/lib/tramoDeTitulo.ts';

describe('tramoDeTitulo', () => {
  it('una conversación abierta se titula como la lista, sin el id', () => {
    expect(tramoDeTitulo('/negocio/comercio-a/conversaciones/wa_59100000047')).toBe('conversaciones');
    expect(tramoDeTitulo('/negocio/comercio-a/conversaciones/wa_59100000047/')).toBe('conversaciones');
  });

  it('el resto de las rutas conserva su último tramo', () => {
    expect(tramoDeTitulo('/negocio/comercio-a/pedidos')).toBe('pedidos');
    expect(tramoDeTitulo('/negocio/comercio-a/cobros/')).toBe('cobros');
    expect(tramoDeTitulo('/negocio/comercio-a')).toBe('comercio-a');
    expect(tramoDeTitulo('/negocios/administrar')).toBe('administrar');
    expect(tramoDeTitulo('/')).toBe('');
  });
});

describe('App.tsx', () => {
  it('titula con tramoDeTitulo y no con el último tramo crudo (que sería el teléfono)', () => {
    const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'src', 'App.tsx'), 'utf8');
    expect(app).toContain("import { tramoDeTitulo } from './core/lib/tramoDeTitulo'");
    const cuerpo = app.slice(app.indexOf('function useTituloDePagina'), app.indexOf('function Cabecera'));
    expect(cuerpo).toContain('tramoDeTitulo(pathname)');
    expect(cuerpo).not.toContain('.pop()');
  });
});
