/**
 * Intención de catálogo (`Flujos/src/modulos/productos/intencion-de-catalogo.js`, prefijo `ic`): pieza común y pura.
 * Pruebas NEGADAS: nunca más de 10 filas, ids válidos, un toque obsoleto no inventa un producto, respaldo con viñetas.
 */
import { describe, expect, it } from 'vitest';
import { cargarFuente } from '../../core/fuente-vm';

type Fila = { id: string; title: string; description: string };
type Msg = { tipo: string; payload: { interactive: { type: string; action: { sections: { rows: Fila[] }[] } } }; texto: string; respaldo: string; filas: Fila[]; hayMas: boolean; pag: number } | null;
type Ic = {
  icPideListado: (t: unknown) => boolean;
  icMensajeLista: (v: unknown[], m: (c: number) => string, o?: { catId?: string; pag?: number }) => Msg;
};
const ic = cargarFuente<Ic>([
  'Flujos/src/core/sin-agente/mensajes.js', 'Flujos/src/core/texto/parrafos.js',
  'Flujos/src/modulos/productos/lista-de-catalogo.js', 'Flujos/src/modulos/productos/intencion-de-catalogo.js',
], ['icPideListado', 'icMensajeLista']);
const monto = (c: number) => 'Bs ' + c / 100;
const PATRON = /^[a-z0-9:_-]{1,200}$/;
const AREAS = ['Televisores · LED', 'Audio', 'Cocina', 'Hogar', 'Jardín', 'Deportes', 'Juguetes', 'Libros', 'Ropa', 'Zapatos', 'Mascotas', 'Oficina'];
const catalogo = (n: number, areas = AREAS) => Array.from({ length: n }, (_, i) => ({ id: `P${i}`, nombre: `Producto ${i}`, area: areas[i % areas.length], precioCentavos: (10 + i) * 100, moneda: 'BOB' }));

describe('icPideListado', () => {
  it('pide el listado', () => {
    for (const t of ['¿Qué tienen?', 'Qué venden', 'catálogo', 'lista', 'productos', 'todo', 'Quiero ver todos los productos que manejan', 'me muestras el catálogo por favor?']) expect(ic.icPideListado(t), t).toBe(true);
  });
  it('NIEGA: con cifras, negación, pago o sin objeto no es un pedido de listado', () => {
    for (const t of ['quiero 2 productos', 'no quiero el catálogo', 'ya pagué, te mando el comprobante de los productos', 'hola', '', 'cuánto cuesta el televisor de 50', 'Quiero comprar una cocina para mi casa en La Paz ahora']) expect(ic.icPideListado(t), t).toBe(false);
    expect(ic.icPideListado(undefined)).toBe(false);
    expect(ic.icPideListado('x'.repeat(500))).toBe(false);
  });
});

describe('icMensajeLista', () => {
  it('NIEGA: con 12 categorías nunca pasa de 10 filas, y todos los ids cumplen el patrón', () => {
    const m = ic.icMensajeLista(catalogo(60), monto)!;
    expect(m.filas.length).toBeLessThanOrEqual(10);
    expect(m.payload.interactive.action.sections[0]!.rows.length).toBeLessThanOrEqual(10);
    for (const f of m.filas) expect(f.id).toMatch(PATRON);
    expect(m.hayMas).toBe(true);
  });
  it('NIEGA: una categoría de 40 productos pagina, sin más de 10 filas por página', () => {
    const v = catalogo(40, ['Cocina']);
    for (let p = 0; p < 5; p++) {
      const m = ic.icMensajeLista(v, monto, { pag: p })!;
      expect(m.filas.length).toBeLessThanOrEqual(10);
      for (const f of m.filas) expect(f.id).toMatch(PATRON);
    }
  });
  it('una sola categoría lista productos con su precio del catálogo; el respaldo lleva viñetas «• Nombre — precio»', () => {
    const m = ic.icMensajeLista(catalogo(3, ['Cocina']), monto)!;
    expect(m.filas.map((f) => f.id)).toEqual(['pro:p0', 'pro:p1', 'pro:p2']);
    expect(m.respaldo).toContain('• Producto 0 — Bs 10');
    expect(m.payload.interactive.type).toBe('list');
  });
  it('2.2 NIEGA: si el texto no cabe, no recorta en silencio: dice cuántos productos faltan', () => {
    const v = Array.from({ length: 200 }, (_, i) => ({ id: `p${i}`, nombre: 'Producto de nombre bastante largo número ' + i, area: 'Única', precioCentavos: 100000 + i }));
    const m = ic.icMensajeLista(v, monto, { catId: 'cat:unica' })!;
    expect(m.respaldo).toMatch(/Hay \d+ productos más\./);
    expect(m.respaldo.length).toBeLessThanOrEqual(4000);
    const completo = ic.icMensajeLista(catalogo(3, ['Cocina']), monto)!;
    expect(completo.respaldo).not.toMatch(/productos? más/);
  });
  it('NIEGA: un toque obsoleto (categoría que ya no existe) o sin vendibles no inventa nada', () => {
    expect(ic.icMensajeLista(catalogo(5), monto, { catId: 'cat:fantasma' })).toBeNull();
    expect(ic.icMensajeLista([], monto)).toBeNull();
    expect(ic.icMensajeLista([{ id: 'a', nombre: 'Sin precio', area: 'X' }, { id: 'b', nombre: 'Agotado', area: 'X', precioCentavos: 100, disponible: false }], monto)).toBeNull();
    expect(ic.icMensajeLista(catalogo(5), monto, { catId: 'x'.repeat(300) })).toBeNull();
  });
});
