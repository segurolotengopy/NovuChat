/**
 * El título de la pestaña sale del tramo de la ruta, y la ruta de una conversación lleva su id (el teléfono):
 * el título nunca puede llevarlo.
 */
import { describe, expect, it } from 'vitest';
import { tramoDeTitulo } from '../../web/src/core/lib/tramoDeTitulo.ts';

describe('tramoDeTitulo', () => {
  it('una conversación abierta se titula como la lista, sin el id', () => {
    const t = tramoDeTitulo('/negocio/comercio-a/conversaciones/wa_59100000047');
    expect(t).toBe('conversaciones');
    expect(t).not.toMatch(/\d{4}/);
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
