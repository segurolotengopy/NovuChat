/**
 * «¿PUEDO VER SU CATÁLOGO?» en Casa Bermejo (humo de Silvana, 20/11/2026): pedir el catálogo, la página o las fotos da el botón «Ver catálogo» con el enlace del comercio POR CÓDIGO, sin modelo.
 * Derivado de `wlPideCatalogo` (#1033 de Walisuma; la suite de Walisuma no se toca). Se prueba NEGANDO: sin enlace cargado, con un pedido en curso, con un pago, con cifras o con un enlace que no es https, no sale.
 */
import { describe, expect, it } from 'vitest';
import { ANA, crear, hablar, modelo, mTexto, textos } from './mundo';

const ENLACE = 'https://catalogo.example.com';
type Ficha = { carrito: unknown[] };
const interactivo = (t: ReturnType<typeof hablar>) => t.mensajes[0]?.payload['interactive'] as { type?: string; action?: { parameters?: { url?: string; display_text?: string } } } | undefined;
const llamoAlModelo = (t: ReturnType<typeof hablar>): boolean => t.registro.map((r) => r.nodo).includes('Conversar con el modelo');

describe('el catálogo web sale como botón y sin modelo', () => {
  for (const frase of ['¿puedo ver su catálogo?', 'Puedo ver tu catalogo?', 'catálogo', 'quiero ver las fotos', '¿tienen página web o catálogo con fotos?', 'mándeme su catálogo por favor']) {
    it(`«${frase}» da el botón «Ver catálogo» con el enlace, sin llamar al modelo`, () => {
      const m = crear({ enlaceCatalogo: ENLACE });
      const t = hablar(m, ANA, mTexto(frase));
      expect(t.mensajes).toHaveLength(1);
      const i = interactivo(t);
      expect(i?.type).toBe('cta_url');
      expect(i?.action?.parameters).toMatchObject({ url: ENLACE, display_text: 'Ver catálogo' });
      expect(textos(t).join(' ')).toMatch(/puede ver nuestro catálogo con fotos y precios/);   // de usted
      expect(llamoAlModelo(t)).toBe(false);
    });
  }
  it('NEGADO: sin enlace cargado NO hay botón: sigue al modelo como hoy', () => {
    const m = crear({ modeloDice: modelo('Con gusto, le muestro piezas.') });
    const t = hablar(m, ANA, mTexto('¿puedo ver su catálogo?'));
    expect(interactivo(t)?.type).toBeUndefined();
    expect(llamoAlModelo(t)).toBe(true);
  });
  it('NEGADO: un enlace que no es https (o con un esquema peligroso) no sale como botón', () => {
    for (const malo of ['http://catalogo.example.com', 'javascript:alert(1)', 'https://a b.com']) {
      const m = crear({ enlaceCatalogo: malo, modeloDice: modelo('Con gusto.') });
      const t = hablar(m, ANA, mTexto('¿puedo ver su catálogo?'));
      expect(interactivo(t)?.type).toBeUndefined();
      expect(JSON.stringify(t.mensajes)).not.toMatch(/javascript:/);
    }
  });
  it('NEGADO: con cifras, un pago, un comprobante o una negación NO es «ver el catálogo»; el mensaje sigue su camino', () => {
    for (const frase of ['quiero 2 del catálogo', 'ya pagué, mándeme el catálogo del comprobante', 'no quiero ver el catálogo', 'ya vi el catálogo']) {
      const m = crear({ enlaceCatalogo: ENLACE, modeloDice: modelo('Con gusto.') });
      const t = hablar(m, ANA, mTexto(frase));
      expect(interactivo(t)?.type).toBeUndefined();
    }
  });
  it('NEGADO: con un pedido en curso el catálogo no interrumpe el pedido', () => {
    const m = crear({ enlaceCatalogo: ENLACE, modeloDice: modelo('Anotado.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }] }) });
    hablar(m, ANA, mTexto('quiero la billetera'));
    expect(((m.sd['casabermejo'] as Record<string, Ficha>)[ANA]).carrito.length).toBeGreaterThan(0);
    const t = hablar(m, ANA, mTexto('¿puedo ver su catálogo?'));
    expect(interactivo(t)?.type).toBeUndefined();
  });
});
