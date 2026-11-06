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
  it('NEGADO: un producto no disponible no entra al carrito aunque el modelo lo pida (hay otro disponible en el catálogo)', () => {
    const m = crear({ catalogo: catalogoOk({}, [item({ disponible: false }), item({ id: 'otro', nombre: 'Otro', precio: 10, precioCentavos: 1000 })]), modeloDice: pide([{ id: BIL, cantidad: 1 }]) });
    hablar(m, ANA, mTexto('una billetera'));
    expect(fichas(m)[ANA]?.carrito ?? []).toEqual([]);
  });
  it('NEGADO: un tiempo agotado del catálogo (llega un error sin statusCode) pasa con recepción, sin modelo', () => {
    const m = crear({ catalogo: { error: 'timeout' } as never });
    const t = hablar(m, ANA, mTexto('una billetera'));
    expect(t.registro.map((r) => r.nodo)).not.toContain('Conversar con el modelo');
    expect(t.mensajes).toHaveLength(1);
    expect(t.avisos).toHaveLength(1);
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

describe('el Bearer del tenant solo sale hacia el host de la tienda', () => {
  it('NEGADO: «Traer catálogo» a otro host, con puerto, usuario, otra ruta u otro mercado viola la guardia', async () => {
    const C = (await import(/* @vite-ignore */ '../../../../Flujos/experimental/casa-bermejo/construir.mjs')) as { anfitrionPermitido: (u: string, n: string) => boolean; ANFITRIONES_TIENDA: string[] };
    const ruta = '/api/novuchat/v1/catalogo?mercado=BO';
    for (const url of ['=https://otro.ejemplo' + ruta, '=https://novutienda-sitio-stg.web.app:8443' + ruta, '=https://u' + String.fromCharCode(64) + 'novutienda-sitio-stg.web.app' + ruta, '=https://novutienda-sitio-stg.web.app.evil.test' + ruta,
      '=https://novutienda-sitio-stg.web.app/api/novuchat/v1/catalogo?mercado=AR', '=https://novutienda-sitio-stg.web.app/api/novuchat/v1/inventario', '={{ $json.url }}']) expect(C.anfitrionPermitido(url, 'Traer catálogo')).toBe(false);
    expect(C.anfitrionPermitido('=https://novutienda-sitio-stg.web.app' + ruta, 'Traer catálogo')).toBe(true);
    expect(C.anfitrionPermitido('=REEMPLAZAR_URL_CATALOGO' + ruta, 'Traer catálogo')).toBe(true);
    expect(C.ANFITRIONES_TIENDA.every((h) => /^[a-z0-9.-]+$/.test(h))).toBe(true);
  });
  it('la prueba usa su propia credencial de catálogo (no la de producción)', async () => {
    const { PRUEBA, PRODUCCION } = await import('./mundo');
    const cred = (f: { nodes: { name: string; credentials?: { httpHeaderAuth?: { name: string } } }[] }) => f.nodes.find((n) => n.name === 'Traer catálogo')?.credentials?.httpHeaderAuth?.name;
    expect(cred(PRODUCCION as never)).toBe('REEMPLAZAR_CREDENCIAL_CATALOGO');
    expect(cred(PRUEBA as never)).toBe('REEMPLAZAR_CREDENCIAL_CATALOGO_PRUEBA');
  });
});
