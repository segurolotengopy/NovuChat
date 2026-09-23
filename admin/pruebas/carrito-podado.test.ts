/**
 * EL CARRITO NO PUEDE CONTAR LO QUE EL CATÁLOGO YA NO TIENE.
 *
 * EL DEFECTO, encontrado el 22/09/2026 mirando la vista previa y no leyendo el
 * código. El carrito del sitio público se lee de `sessionStorage` al montar,
 * ANTES de que llegue el catálogo, y nadie volvía a mirarlo. Bastaba con que el
 * comercio diera de baja un producto —o le sacara el precio, que para la página
 * es lo mismo— para que la pantalla se contradijera sola:
 *
 *   la barra decía  «1 ítem»   ← suma las cantidades guardadas
 *   y el total      «$ 0»      ← `totalDelCarrito` solo suma lo que existe
 *
 * Y el cliente no tenía cómo arreglarlo: entraba a «Tu pedido», lo veía vacío,
 * y lo que no aparece en la lista no tiene botón para quitarlo. El carrito
 * quedaba trabado hasta cerrar la pestaña.
 *
 * Es el mismo caso que el servidor ya contempla en el checkout con
 * `descartados` (`catalogoWeb.ts`): lo que faltaba era contemplarlo al mirar,
 * no solo al confirmar.
 *
 * SE PRUEBA LA FUNCIÓN PURA y no el componente montado: `podarCarrito` es la
 * regla, y el efecto que la llama es una línea. Montar React entero para
 * comprobar una poda sería más frágil que la poda.
 */
import { describe, expect, it } from 'vitest';
import { podarCarrito } from '../web/src/publico/SitioCatalogo.tsx';
import type { ItemPublico } from '../web/src/publico/tipos.ts';

const item = (id: string, precio = 10): ItemPublico => ({
  id, nombre: id, descripcion: '', area: 'x', precio, moneda: 'BOB', imagenUrl: '',
} as ItemPublico);

const CATALOGO = [item('llavero', 23), item('cardigan', 108), item('sales-spa', 7)];

describe('podarCarrito', () => {
  it('quita lo que ya no está en el catálogo y deja lo demás intacto', () => {
    const podado = podarCarrito({ llavero: 2, 'pique-macho': 1, cardigan: 1 }, CATALOGO);
    expect(podado).toEqual({ llavero: 2, cardigan: 1 });
  });

  it('es el caso que rompía la pantalla: lo único del carrito ya no existe', () => {
    // Antes: la barra contaba 1 ítem y el total daba 0, sin forma de limpiarlo.
    expect(podarCarrito({ 'pique-macho': 1 }, CATALOGO)).toEqual({});
  });

  it('devuelve EL MISMO objeto cuando no sobra nada', () => {
    // No es una optimización de gusto: un objeto nuevo en cada respuesta del
    // servidor volvería a disparar el efecto de guardado y a reescribir
    // `sessionStorage` sin que nadie haya tocado el carrito.
    const carrito = { llavero: 2, cardigan: 1 };
    expect(podarCarrito(carrito, CATALOGO)).toBe(carrito);
  });

  it('con el carrito vacío no inventa nada', () => {
    const vacio = {};
    expect(podarCarrito(vacio, CATALOGO)).toBe(vacio);
  });

  it('con el catálogo vacío deja el carrito vacío', () => {
    // Pasa de verdad: un comercio que dio de baja todo, o que se quedó sin
    // ítems con precio. La página tiene que poder mostrarse igual.
    expect(podarCarrito({ llavero: 2 }, [])).toEqual({});
  });

  it('no se deja engañar por una clave heredada del prototipo', () => {
    // `Object.entries` solo recorre las propias, y la comparación es contra un
    // `Set` de ids. Un `toString` en el carrito guardado no puede colarse.
    const carrito = JSON.parse('{"llavero":1,"toString":2,"constructor":3}') as Record<string, number>;
    expect(podarCarrito(carrito, CATALOGO)).toEqual({ llavero: 1 });
  });
});
