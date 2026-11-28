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
  icIntencion: (t: unknown, v: unknown[]) => { tipo: string; catIds: string[]; faltan: string[]; pedido: boolean };
  icMensajeLista: (v: unknown[], m: (c: number) => string, o?: { catId?: string; pag?: number; enlace?: string; faltan?: string[] }) => Msg;
  icTextoNoFigura: (f: unknown) => string;
  icResolverToque: (id: unknown, v: unknown[], m: (c: number) => string) => { tipo: string; id?: string; mensaje?: NonNullable<Msg> };
};
const ic = cargarFuente<Ic>([
  'Flujos/src/core/sin-agente/mensajes.js', 'Flujos/src/core/texto/parrafos.js',
  'Flujos/src/modulos/productos/lista-de-catalogo.js', 'Flujos/src/modulos/productos/intencion-de-catalogo.js',
], ['icPideListado', 'icIntencion', 'icMensajeLista', 'icResolverToque', 'icTextoNoFigura']);
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
  it('C2: con enlace https al catálogo el respaldo remite («Míralos en el catálogo»); sin enlace o con uno inválido sigue pidiendo que escriba', () => {
    const v = Array.from({ length: 200 }, (_, i) => ({ id: `p${i}`, nombre: 'Producto de nombre bastante largo número ' + i, area: 'Única', precioCentavos: 100000 + i }));
    const con = ic.icMensajeLista(v, monto, { catId: 'cat:unica', enlace: 'https://catalogo.ejemplo.test/c/x' })!;
    expect(con.respaldo).toMatch(/Hay \d+ productos más\. Míralos en el catálogo\./);
    expect(con.respaldo).not.toMatch(/Dime cuál buscas/);
    for (const e of [undefined, 'http://a.test/x', 'javascript:alert(1)', '']) expect(ic.icMensajeLista(v, monto, { catId: 'cat:unica', enlace: e })!.respaldo, String(e)).toMatch(/Dime cuál buscas/);
  });
  it('NIEGA: un toque obsoleto (categoría que ya no existe) o sin vendibles no inventa nada', () => {
    expect(ic.icMensajeLista(catalogo(5), monto, { catId: 'cat:fantasma' })).toBeNull();
    expect(ic.icMensajeLista([], monto)).toBeNull();
    expect(ic.icMensajeLista([{ id: 'a', nombre: 'Sin precio', area: 'X' }, { id: 'b', nombre: 'Agotado', area: 'X', precioCentavos: 100, disponible: false }], monto)).toBeNull();
    expect(ic.icMensajeLista(catalogo(5), monto, { catId: 'x'.repeat(300) })).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// I4 (revisión del PR #1147): las frases de la batería de ataque de Bermejo (27/11/2026) que fallaban por la INTENCIÓN, y las de cierre
// que NO deben dispararla. Catálogo de electrodomésticos solo de prueba (sin datos de ningún comercio).
// ---------------------------------------------------------------------------------------------------------------------------
const ELECTRO: Array<[string, number]> = [['Televisores', 23], ['Aires acondicionados', 12], ['Heladeras', 6], ['Freezers', 4], ['Lavadoras', 8], ['Microondas', 5], ['Parlantes', 9]];
const electro = ELECTRO.flatMap(([area, n]) => Array.from({ length: n }, (_, i) => ({ id: `${area.slice(0, 3)}${i}`, nombre: `${area} modelo ${i}`, area, precioCentavos: 10000 + i, moneda: 'BOB' })));
const por = (t: string, v: unknown[] = electro) => ic.icIntencion(t, v);

describe('paginación: categoría de más de 10 productos = lista de 9 + «Ver más», el toque lo resuelve el CÓDIGO', () => {
  const ids = (m: NonNullable<Msg>) => m.filas.map((f) => f.id);
  it('23 televisores: tres páginas (9 + Ver más, 9 + Ver más, 5); ninguna pasa de 10 filas; los 23 salen una sola vez; cada «Ver más» se resuelve por código', () => {
    let t = ic.icResolverToque('cat:televisores', electro, monto);
    const vistos: string[] = [];
    let paginas = 0;
    while (t.tipo === 'lista') {
      paginas++;
      const m = t.mensaje!;
      expect(m.filas.length).toBeLessThanOrEqual(10);
      expect(m.payload.interactive.type).toBe('list');
      vistos.push(...ids(m).filter((i) => i.startsWith('pro:')));
      const mas = ids(m).find((i) => i.startsWith('mas:'));
      if (!mas) break;
      expect(m.filas).toHaveLength(10);
      expect(m.filas.filter((f) => f.id.startsWith('pro:'))).toHaveLength(9);
      t = ic.icResolverToque(mas, electro, monto);
    }
    expect(paginas).toBe(3);
    expect(vistos).toHaveLength(23);
    expect(new Set(vistos).size).toBe(23);
  });
  it('una categoría de 12 aires: primera página con 9 + «Ver más»; la segunda, los 3 que faltan sin «Ver más»', () => {
    const a = ic.icResolverToque('cat:aires-acondicionados', electro, monto).mensaje!;
    expect(a.filas).toHaveLength(10);
    expect(a.hayMas).toBe(true);
    const b = ic.icResolverToque(ids(a)[9]!, electro, monto).mensaje!;
    expect(b.filas).toHaveLength(3);
    expect(b.hayMas).toBe(false);
  });
  it('NIEGA: un toque viejo (categoría o producto que ya no está, página fuera de rango, id inventado o malformado) da una respuesta clara y las categorías vigentes; nunca un producto inventado', () => {
    const sin = electro.filter((p) => p.area !== 'Freezers');
    for (const id of ['cat:freezers', 'pro:fre0', 'mas:televisores:99', 'mas:fantasma:1', 'cat:xyz', 'MAS:X', '', null, 42, 'x'.repeat(300)]) {
      const t = ic.icResolverToque(id, sin, monto);
      expect(t.tipo, String(id)).toBe('obsoleto');
      expect(t.mensaje!.texto).toMatch(/ya no está vigente/);
      expect(t.mensaje!.payload.interactive.type).toBe('list');
      expect(t.mensaje!.filas.every((f) => !f.id.startsWith('pro:'))).toBe(true);
    }
    const vacio = ic.icResolverToque('cat:televisores', [], monto);
    expect(vacio.tipo).toBe('obsoleto');
    expect(vacio.mensaje!.texto).toMatch(/ya no está vigente/);
  });
  it('un toque de producto devuelve su id real (lo agrega el llamador); nunca pasa por el modelo', () => {
    expect(ic.icResolverToque('pro:tel5', electro, monto)).toEqual({ tipo: 'producto', id: 'Tel5' });
  });
  it('un id inventado que cumple el patrón no abre nada: «cat:aires-acondicionados» sí, «cat:aires» no', () => {
    expect(ic.icResolverToque('cat:aires', electro, monto).tipo).toBe('obsoleto');
  });
});

describe('icPideListado: la carta y las variantes de la batería', () => {
  it('reconoce «carta», «q tienen», «qué cosas venden», «catalogo», «mándenme la lista», «precios de todo», «ver el catálogo antes de pagar» y «el link del catálogo»', () => {
    for (const t of ['carta', '¿Qué es lo que tienen? la carta', 'q tienen', '¿Qué cosas venden?', 'que productos tienen', 'catalogo', 'mándenme la lista', 'precios de todo',
      'quiero ver el catálogo antes de pagar', 'me pasas el link del catálogo?', '¿Qué productos tienen? Quiero ver el catálogo completo con precios', 'lista', 'todo', 'todos']) expect(ic.icPideListado(t), t).toBe(true);
  });
  it('NIEGA: «eso es todo», «todo bien», «estoy lista», «gracias a todos» y las demás frases de cierre NO piden el listado', () => {
    for (const t of ['eso es todo', 'Eso es todo, gracias', 'todo bien', 'todo ok', 'ya está todo listo', 'estoy lista', 'ya estoy lista', 'ya estamos listos', 'gracias a todos', 'buenas tardes a todos',
      'lista para pagar', 'listo', 'nada más, eso es todo']) expect(ic.icPideListado(t), t).toBe(false);
  });
  it('NIEGA: un mensaje que además pide una pieza no se toma por un pedido de listado (el pedido no se pierde)', () => {
    expect(ic.icPideListado('quiero la heladera más barata y mándenme la lista de aires')).toBe(false);
    expect(ic.icPideListado('dame el televisor y el catálogo')).toBe(false);
  });
  it('NIEGA: pagar o el comprobante sigue anulando el pedido de listado (solo «antes de pagar» no es un pago)', () => {
    expect(ic.icPideListado('ya pagué, mando el comprobante del catálogo')).toBe(false);
    expect(ic.icPideListado('quiero pagar el catálogo')).toBe(false);
  });
});

describe('icIntencion: la categoría nombrada gana al listado genérico', () => {
  const cat = (t: string) => por(t);
  it('L2/A3/A4/A5: televisores, «tele», singular y mayúsculas llevan a la categoría', () => {
    for (const t of ['¿Qué televisores tienen y a qué precio?', 'tienen tele?', 'televisor', 'TELEVISORES PRECIOS', 'telebisores']) expect(cat(t), t).toMatchObject({ tipo: 'categoria', catIds: ['cat:televisores'] });
  });
  it('A12/A13/A7/L4: heladera, heladeras, refri, parlantes baratos y aire acondicionado', () => {
    for (const t of ['heladera', 'heladeras', 'refri']) expect(cat(t), t).toMatchObject({ tipo: 'categoria', catIds: ['cat:heladeras'] });
    expect(cat('parlantes bluetooth baratos')).toMatchObject({ tipo: 'categoria', catIds: ['cat:parlantes'] });
    expect(cat('aire acondisionado')).toMatchObject({ tipo: 'categoria', catIds: ['cat:aires-acondicionados'] });
    expect(cat('¿Y qué aires acondicionados tienen? Todos, con precio')).toMatchObject({ tipo: 'categoria', catIds: ['cat:aires-acondicionados'] });
  });
  it('L3: «otros televisores… quiero ver todos» es la categoría, no el listado genérico', () => {
    expect(cat('¿Qué otros televisores tienen? Quiero ver todos')).toMatchObject({ tipo: 'categoria', catIds: ['cat:televisores'] });
  });
  it('L5/2.4: varias categorías pedidas a la vez salen TODAS, en el orden del catálogo', () => {
    expect(cat('¿Qué heladeras, freezers, lavadoras, microondas y parlantes tienen? Todos con precio').catIds)
      .toEqual(['cat:heladeras', 'cat:freezers', 'cat:lavadoras', 'cat:microondas', 'cat:parlantes']);
  });
  it('«TV y video» del catálogo: «tele» y «tv» llegan a esa categoría (el sinónimo, no una lista de comercios)', () => {
    const v = [{ id: 'a', nombre: 'LED 50', area: 'TV y video', precioCentavos: 100, moneda: 'BOB' }, { id: 'b', nombre: 'Mate', area: 'Hogar', precioCentavos: 100, moneda: 'BOB' }];
    expect(por('tienen tele?', v).catIds).toEqual(['cat:tv-y-video']);
    expect(por('tv', v).catIds).toEqual(['cat:tv-y-video']);
  });
  it('L1/A1/A2/A8/A9/A10/A11: sin categoría, el listado genérico', () => {
    for (const t of ['¿Qué productos tienen? Quiero ver el catálogo completo con precios', 'que productos tienen', 'q tienen', 'mándenme la lista', 'precios de todo', 'catalogo', 'carta', 'me pasas el link del catálogo?']) expect(cat(t), t).toMatchObject({ tipo: 'listado', catIds: [] });
  });
  it('A14/A15: una categoría que no existe NO es una negación del catálogo: es «sin_categoria» con lo que faltó', () => {
    expect(cat('¿tienen bicicletas?')).toMatchObject({ tipo: 'sin_categoria', faltan: ['bicicletas'] });
    expect(cat('venden celulares?')).toMatchObject({ tipo: 'sin_categoria', faltan: ['celulares'] });
  });
  it('B-1 NIEGA: un servicio o condición (delivery, garantía, envío, stock, factura, tarjeta, horario, ubicación, local, sucursal) NO es una categoría y nunca se niega', () => {
    for (const t of ['¿tienen delivery?', '¿tienen garantía?', '¿tienen envío a Cochabamba?', '¿tienen stock?', 'hacen envíos?', 'tienen factura?', 'aceptan tarjeta?', 'tienen horario de atención?', 'tienen ubicación?', 'tienen local?', 'tienen sucursal en Sucre?', 'tienen entrega a domicilio?', 'tienen stock de bicicletas?']) {
      expect(cat(t), t).toMatchObject({ tipo: 'ninguna', faltan: [] });
    }
  });
  it('B-1: «fotos» y «fotografías» van al listado, no a una negación', () => {
    for (const t of ['¿tienen fotos?', 'tienen fotografías?', 'me mandan fotos?']) expect(cat(t), t).toMatchObject({ tipo: 'listado', faltan: [] });
    expect(cat('fotos de las heladeras')).toMatchObject({ tipo: 'categoria', catIds: ['cat:heladeras'] });
  });
  it('B-1: lo que parece un producto sigue siendo «sin_categoria» y una categoría real con servicio sigue ganando', () => {
    expect(cat('¿tienen mochilas?')).toMatchObject({ tipo: 'sin_categoria', faltan: ['mochilas'] });
    expect(cat('¿tienen televisores con garantía?')).toMatchObject({ tipo: 'categoria', catIds: ['cat:televisores'], faltan: [] });
  });
  it('A16: «bicis y teles» da la categoría que existe y lo que falta', () => {
    expect(cat('bicis y teles')).toMatchObject({ tipo: 'categoria', catIds: ['cat:televisores'], faltan: ['bicis'] });
  });
  it('A25: el pedido de una pieza no se pierde: se marca `pedido` y la lista de aires sigue pedida', () => {
    expect(cat('quiero la heladera más barata y mándenme la lista de aires')).toMatchObject({ tipo: 'categoria', pedido: true, catIds: ['cat:aires-acondicionados', 'cat:heladeras'] });
  });
  it('NIEGA: las frases de cierre, la negación, el pago y las cifras no nombran ninguna categoría', () => {
    for (const t of ['eso es todo', 'todo bien', 'estoy lista', 'gracias a todos', 'no quiero televisores', 'ya pagué el televisor', 'quiero 2 televisores', 'hola', '', 'listo']) expect(cat(t), t).toMatchObject({ tipo: 'ninguna', catIds: [] });
  });
  it('NIEGA: una palabra suelta que no es un producto ni una pregunta de «hay» no se vuelve «sin_categoria»', () => {
    expect(cat('rápido por favor')).toMatchObject({ tipo: 'ninguna' });
    expect(cat('heladeras y por favor rápido')).toMatchObject({ tipo: 'categoria', faltan: [] });
  });
  it('NIEGA: sin catálogo no hay categoría que nombrar; texto vacío o enorme no rompe', () => {
    expect(por('tienen tele?', [])).toMatchObject({ tipo: 'sin_categoria' });
    expect(por('x'.repeat(500))).toMatchObject({ tipo: 'ninguna' });
    expect(ic.icIntencion(undefined, electro)).toMatchObject({ tipo: 'ninguna' });
  });
});

// Decisión de Andres (28/11/2026), revisión r3 B-1: lo nombrado que NO está en el catálogo se dice «"X" no figura en nuestro catálogo; estas son las
// categorías que tenemos», con la lista y el botón. NUNCA «no tenemos X» ni «No encuentro eso». Una lista negra de servicios no tiene fin: la garantía
// no es la lista, es lo que se afirma.
describe('B-1 (28/11): lo que no está en el catálogo «no figura»; jamás «no tenemos»', () => {
  const PROHIBIDO = /no tenemos|no tengo|no hay |no encuentro|no manejamos|no vendemos|no contamos/i;
  const VEINTE = [
    '¿tienen pantallas?', '¿tienen servicio técnico?', '¿tienen descuentos?', '¿tienen promociones?', '¿tienen repuestos?',
    '¿tienen otros colores?', '¿tienen tallas?', '¿tienen otros modelos?', '¿tienen instalación?', '¿venden por mayor?',
    '¿tienen mayoreo?', '¿tienen ofertas?', '¿tienen marcas?', '¿tienen marca Samsung?', '¿tienen WhatsApp?',
    '¿tienen Instagram?', '¿tienen página web?', '¿tienen estacionamiento?', '¿tienen atención los domingos?', '¿tienen envoltura para regalo?',
  ];
  it('las 20 frases de la revisión r3: nunca una negación de existencia (otra intención, o el texto «no figura…»)', () => {
    expect(VEINTE).toHaveLength(20);
    for (const t of VEINTE) {
      const r = por(t);
      if (r.tipo !== 'sin_categoria') continue;
      const m = ic.icMensajeLista(electro, monto, { faltan: r.faltan, enlace: 'https://catalogo.ejemplo.test/c/abc' })!;
      expect(m, t).not.toBeNull();
      for (const x of [m.texto, m.respaldo, JSON.stringify(m.payload)]) {
        expect(x, t).toContain('no figura en nuestro catálogo; estas son las categorías que tenemos.');
        expect(x, t).not.toMatch(PROHIBIDO);
      }
      expect(m.payload.interactive.type, t).toBe('list');
      expect(m.filas.every((f) => f.id.startsWith('cat:')), t).toBe(true);
    }
  });
  it('«pantallas» es televisores: con 23 televisores en el catálogo jamás se niega', () => {
    expect(electro.filter((p) => p.area === 'Televisores')).toHaveLength(23);
    for (const t of ['¿tienen pantallas?', 'pantalla', 'qué pantallas tienen y a qué precio', 'tienen pantallas?']) expect(por(t), t).toMatchObject({ tipo: 'categoria', catIds: ['cat:televisores'] });
  });
  it('los sinónimos obvios llegan a su categoría real, sin nombres de comercio', () => {
    const v = [{ id: 'c', nombre: 'Celular A', area: 'Celulares', precioCentavos: 100, moneda: 'BOB' }, { id: 'p', nombre: 'Lap', area: 'Computadoras', precioCentavos: 100, moneda: 'BOB' }, { id: 'l', nombre: 'Lav', area: 'Lavadoras', precioCentavos: 100, moneda: 'BOB' }];
    expect(por('tienen moviles?', v).catIds).toEqual(['cat:celulares']);
    expect(por('tienen laptops?', v).catIds).toEqual(['cat:computadoras']);
    expect(por('tienen lavarropa?', v).catIds).toEqual(['cat:lavadoras']);
  });
  it('el contrato: `icMensajeLista` con `faltan` arma el texto correcto (también con una sola categoría y con varias cosas) y nunca el prohibido', () => {
    const una = [{ id: 'a', nombre: 'LED 50', area: 'Televisores', precioCentavos: 100, moneda: 'BOB' }];
    const m = ic.icMensajeLista(una, monto, { faltan: ['bicicletas'] })!;
    expect(m.texto).toBe('"bicicletas" no figura en nuestro catálogo; estas son las categorías que tenemos.');
    expect(m.filas.map((f) => f.id)).toEqual(['cat:televisores']);
    expect(ic.icTextoNoFigura(['bicis', 'motos'])).toBe('"bicis" y "motos" no figuran en nuestro catálogo; estas son las categorías que tenemos.');
    expect(ic.icTextoNoFigura([])).toBe('');
    expect(ic.icMensajeLista(una, monto, { faltan: ['x'] })!.respaldo).not.toMatch(PROHIBIDO);
    // Sin `faltan`, la lista de una sola categoría sigue siendo de productos.
    expect(ic.icMensajeLista(una, monto)!.filas[0]!.id).toBe('pro:a');
  });
  it('los 13 casos de servicio de la v3 siguen sin negarse', () => {
    for (const t of ['¿tienen delivery?', '¿tienen garantía?', '¿tienen envío a Cochabamba?', '¿tienen stock?', 'hacen envíos?', 'tienen factura?', 'aceptan tarjeta?', 'tienen horario de atención?', 'tienen ubicación?', 'tienen local?', 'tienen sucursal en Sucre?', 'tienen entrega a domicilio?', 'tienen stock de bicicletas?']) expect(por(t), t).toMatchObject({ tipo: 'ninguna', faltan: [] });
  });
});
