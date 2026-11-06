/**
 * EL CATÁLOGO EXTERNO DENTRO DEL FLUJO de Casa Bermejo (nodo `Traer catálogo`, contrato v1 de la plataforma de la tienda). Se prueba NEGANDO:
 * el precio y el total salen del catálogo del servidor (nunca del modelo), el stock recorta, lo no disponible no se ofrece, el catálogo vuelve a leerse en cada turno, y el costo en mensajes por conversación no crece.
 */
import { describe, expect, it } from 'vitest';
import { ANA, CATALOGO, ENTREGA, catalogoOk, crear, hablar, mTexto, modelo, textos } from './mundo';

const BIL = 'billetera-cuero';
const item = (o: Record<string, unknown> = {}) => ({ ...CATALOGO[1], precioCentavos: 45000, stock: 10, disponible: true, ...o });
const pide = (lineas: unknown[], extra: Record<string, unknown> = {}) => modelo('Con gusto, lo anoto.', { lineas, ...extra });
const fichas = (m: ReturnType<typeof crear>): Record<string, any> => (m.sd['casabermejo'] ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const PROHIBIDO = /pago acreditado|pago verificado|recib[ií]mos? tu pago|acreditad[oa]|verificad[oa]|simulad[oa]/i;

describe('el precio sale del catálogo del servidor', () => {
  it('el resumen y el monto usan el precio de NovuTienda; si el servidor cambia el precio, cambia el pedido', () => {
    const m = crear({ catalogo: catalogoOk({}, [item({ precio: 500, precioCentavos: 50000 })]), modeloDice: pide([{ id: BIL, cantidad: 2, precio: 1 }], { entrega: ENTREGA }) });
    const t = hablar(m, ANA, mTexto('dos billeteras'));
    expect(textos(t).join(' ')).toMatch(/Total: Bs 1\.000/);
    expect(fichas(m)[ANA].carrito).toEqual([{ id: BIL, cantidad: 2, detalle: '' }]);
  });
  it('NEGADO: el modelo no puede fijar el precio ni el total', () => {
    const m = crear({ modeloDice: pide([{ id: BIL, cantidad: 1, precio: 1, total: 1, subtotalCentavos: 1 }]) });
    const t = hablar(m, ANA, mTexto('una billetera'));
    expect(textos(t).join(' ')).toMatch(/Bs 450/);
    expect(textos(t).join(' ')).not.toMatch(/Bs 1\b/);
  });
  it('el catálogo se lee en CADA turno (nada de precios viejos guardados en la ficha)', () => {
    let prompt = '';
    const m = crear({ modeloDice: (ll) => { prompt = JSON.stringify(ll.cuerpo); return pide([{ id: BIL, cantidad: 1 }]); } });
    hablar(m, ANA, mTexto('una billetera'));
    expect(prompt).toMatch(/billetera-cuero\|Billetera de cuero\|450/);
    m.dobles['Traer catálogo'] = () => catalogoOk({}, [item({ precio: 600, precioCentavos: 60000 })]);
    hablar(m, ANA, mTexto('¿cuánto va?'));
    expect(prompt).toMatch(/billetera-cuero\|Billetera de cuero\|600/);
    expect(prompt).not.toMatch(/Billetera de cuero\|450/);
  });
});

describe('stock y disponibilidad', () => {
  it('NEGADO: pedir más que el stock deja el carrito en el stock', () => {
    const m = crear({ catalogo: catalogoOk({}, [item({ stock: 2 })]), modeloDice: pide([{ id: BIL, cantidad: 5 }]) });
    hablar(m, ANA, mTexto('cinco billeteras'));
    expect(fichas(m)[ANA].carrito[0].cantidad).toBe(2);
  });
  it('NEGADO: un producto no disponible no entra al carrito', () => {
    const m = crear({ catalogo: catalogoOk({}, [item({ disponible: false })]), modeloDice: pide([{ id: BIL, cantidad: 1 }]) });
    const t = hablar(m, ANA, mTexto('una billetera'));
    expect(t.registro.map((r) => r.nodo)).not.toContain('Conversar con el modelo');
    expect(fichas(m)[ANA]?.carrito ?? []).toEqual([]);
  });
});

describe('costo en mensajes por conversación (compuerta del diseño)', () => {
  it('un turno de conversación = 1 mensaje al cliente y ningún aviso; el turno del QR = 2 (resumen + imagen); ninguno dice «acreditado»', () => {
    const m = crear({ modeloDice: pide([{ id: BIL, cantidad: 1 }], { entrega: ENTREGA }) });
    const t1 = hablar(m, ANA, mTexto('una billetera'));
    expect(t1.mensajes).toHaveLength(1);
    expect(t1.avisos).toHaveLength(0);
    const t2 = hablar(m, ANA, mTexto('quiero pagar'));
    expect(t2.mensajes).toHaveLength(2);
    expect(t2.mensajes.some((x) => x.tipo === 'image')).toBe(true);
    for (const t of [t1, t2]) for (const x of textos(t)) expect(x).not.toMatch(PROHIBIDO);
  });
  it('el catálogo caído es 1 mensaje (con el botón) y 1 aviso al comercio, nunca más', () => {
    const t = hablar(crear({ catalogo: 'cae' }), ANA, mTexto('quiero una billetera'));
    expect(t.mensajes).toHaveLength(1);
    expect(t.avisos).toHaveLength(1);
  });
});

describe('la foto del catálogo no sale al cliente en B3', () => {
  it('NEGADO: aunque el catálogo traiga foto, ningún mensaje del turno de conversación lleva imagen', () => {
    const m = crear({ catalogo: catalogoOk({}, [item({ foto: 'https://fotos.ejemplo.test/b.jpg' })]), modeloDice: pide([{ id: BIL, cantidad: 1 }]) });
    const t = hablar(m, ANA, mTexto('una billetera'));
    expect(t.mensajes.every((x) => x.tipo !== 'image')).toBe(true);
  });
});
