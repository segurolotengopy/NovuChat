/**
 * EL CATÁLOGO EXTERNO DENTRO DEL FLUJO de Casa Bermejo (nodo `Traer catálogo`, contrato v1 de la plataforma de la tienda). Se prueba NEGANDO:
 * el precio y el total salen del catálogo del servidor (nunca del modelo), el stock recorta, lo no disponible no se ofrece, el catálogo vuelve a leerse en cada turno, y el costo en mensajes por conversación no crece.
 */
import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import { ANA, CATALOGO, ENTREGA, catalogoOk, crear, hablar, mTexto, modelo, textos } from './mundo';
import { ceMercadoDePrefijo } from './mercado';

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
    const C = (await import(/* @vite-ignore */ '../../../../Flujos/clientes/casa-bermejo/construir.mjs')) as { anfitrionPermitido: (u: string, n: string) => boolean; ANFITRIONES_TIENDA: string[]; EXPRESION_MERCADO: string };
    const ruta = '/api/novuchat/v1/catalogo?mercado=' + C.EXPRESION_MERCADO;
    for (const url of ['=https://otro.ejemplo' + ruta, '=https://novutienda-sitio-stg.web.app:8443' + ruta, '=https://u' + String.fromCharCode(64) + 'novutienda-sitio-stg.web.app' + ruta, '=https://novutienda-sitio-stg.web.app.evil.test' + ruta,
      '=https://novutienda-sitio-stg.web.app/api/novuchat/v1/catalogo?mercado=AR', '=https://novutienda-sitio-stg.web.app/api/novuchat/v1/catalogo?mercado=BO', '=https://novutienda-sitio-stg.web.app/api/novuchat/v1/catalogo?mercado={{ $json.m }}', '=https://novutienda-sitio-stg.web.app/api/novuchat/v1/inventario', '={{ $json.url }}']) expect(C.anfitrionPermitido(url, 'Traer catálogo')).toBe(false);
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

describe('Argentina (B4a): catálogo en pesos y pedido anotado; el pago por alias llega con el servidor (B4b)', () => {
  const ARG = ['54', '9', '11', '5550', '0001'].join('');
  const itemAr = (o: Record<string, unknown> = {}) => ({ ...CATALOGO[1], moneda: 'ARS', precio: 450000, precioCentavos: 45000000, stock: 10, disponible: true, ...o });
  const catAr = (items: unknown[] = [itemAr()]) => catalogoOk({ mercado: 'AR', moneda: 'ARS' }, items as never);
  it('la expresión del mercado del nodo HTTP da lo mismo que ceMercadoDePrefijo para 591 y 54', async () => {
    const C = (await import(/* @vite-ignore */ '../../../../Flujos/clientes/casa-bermejo/construir.mjs')) as { EXPRESION_MERCADO: string };
    const cuerpo = C.EXPRESION_MERCADO.replace(/^\{\{|\}\}$/g, '').trim();
    const evalua = (from: string): string => (vm.compileFunction(`return (${cuerpo});`, ['$']) as (a: unknown) => string)(() => ({ first: () => ({ json: { from } }) }));
    // Donde la función da null (otro país, número corto o largo) la expresión da «X»: el servidor responde 400 y el turno pasa con recepción.
    for (const f of [ANA, ARG, '+' + ARG, '00' + ARG, '5491', '5511900000033', '', '54' + '9'.repeat(20), '591']) expect(evalua(f)).toBe(ceMercadoDePrefijo(f) ?? 'X');
  });
  it('un cliente de Argentina ve precios en pesos y nunca en «Bs»', () => {
    const m = crear({ catalogo: catAr(), modeloDice: pide([{ id: BIL, cantidad: 2 }]) });
    const t = hablar(m, ARG, mTexto('dos billeteras'));
    expect(textos(t).join(' ')).toMatch(/ARS 900\.000/);
    expect(textos(t).join(' ')).not.toMatch(/Bs/);
  });
  it('NEGADO: al confirmar el pedido NO se emite un QR de Bolivia: queda anotado, 1 aviso al comercio con el total en ARS y el botón; nada de «acreditado»', () => {
    const m = crear({ catalogo: catAr(), modeloDice: pide([{ id: BIL, cantidad: 1 }], { entrega: ENTREGA }) });
    hablar(m, ARG, mTexto('una billetera'));
    const t = hablar(m, ARG, mTexto('quiero pagar'));
    expect(t.mensajes.every((x) => x.tipo !== 'image')).toBe(true);
    expect(t.avisos).toHaveLength(1);
    const vars = (t.avisos[0]?.payload['template'] as any).components[0].parameters.map((p: { text: string }) => p.text); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(vars[1]).toMatch(/^ARS /);
    expect(vars[3]).toBe('sin comprobante aún');
    expect(textos(t).join(' ')).toMatch(/pesos argentinos/);
    expect(textos(t).join(' ')).not.toMatch(PROHIBIDO);
    expect(t.llamadas.cotejo ?? []).toHaveLength(0);
  });
  it('NEGADO: un catálogo en BOB para un cliente de Argentina, o uno en ARS para uno de Bolivia, no se vende: pasa con recepción', () => {
    for (const [tel, cat] of [[ARG, catalogoOk()], [ANA, catAr()]] as const) {
      const t = hablar(crear({ catalogo: cat }), tel, mTexto('quiero una billetera'));
      expect(t.registro.map((r) => r.nodo)).not.toContain('Conversar con el modelo');
      expect(t.avisos).toHaveLength(1);
    }
  });
  it('NEGADO: lo que escribe el modelo con otra moneda no sale (Bs a Argentina; $, ARS o pesos a Bolivia), ni un precio inventado en pesos', () => {
    for (const falso of ['Cuesta Bs 450.000.', 'Son 450 Bs.', 'La billetera sale $ 300.000.', 'Te cuesta ARS 1.000.', 'Son 300000 pesos.']) {
      const t = hablar(crear({ catalogo: catAr(), modeloDice: modelo(falso) }), ARG, mTexto('¿cuánto sale?'));
      expect(textos(t).join(' ')).not.toMatch(/Bs|\$ ?300|ARS 1\.000|300000 pesos/);
    }
    for (const falso of ['La billetera sale $ 450.', 'Te cuesta ARS 450.', 'Son 450 pesos.']) {
      const t = hablar(crear({ modeloDice: modelo(falso) }), ANA, mTexto('¿cuánto sale?'));
      expect(textos(t).join(' ')).not.toMatch(/\$ ?450|ARS 450|450 pesos/);
    }
  });
  it('el prompt de un cliente de Argentina habla de pesos y de que el pago lo coordina recepción (no promete QR)', () => {
    let prompt = '';
    const m = crear({ catalogo: catAr(), modeloDice: (ll) => { prompt = JSON.stringify(ll.cuerpo); return pide([]); } });
    hablar(m, ARG, mTexto('hola'));
    expect(prompt).toMatch(/pesos argentinos, ARS/);
    expect(prompt).toMatch(/lo coordina recepción: nunca prometas un QR/);
    expect(prompt).toMatch(/español de Argentina/);
    expect(prompt).not.toMatch(/precio en Bs|envía el sistema cuando el cliente confirma/);
  });
  it('NEGADO: si el aviso al comercio no sale, el cliente lee que escriba a recepción con el botón (no que recepción coordina)', () => {
    const m = crear({ catalogo: catAr(), aviso: 'error', modeloDice: pide([{ id: BIL, cantidad: 1 }], { entrega: ENTREGA }) });
    hablar(m, ARG, mTexto('una billetera'));
    const t = hablar(m, ARG, mTexto('quiero pagar'));
    expect(textos(t).join(' ')).toMatch(/no pude avisar a recepción/i);
    expect(textos(t).join(' ')).not.toMatch(/lo coordina recepción/);
  });
});

describe('«Traer catálogo» no puede desviar el Bearer', () => {
  it('NEGADO: query propia, cabeceras propias, proxy, certificados sin validar o redirecciones seguidas violan la guardia de publicación', async () => {
    const C = (await import(/* @vite-ignore */ '../../../../Flujos/clientes/casa-bermejo/construir.mjs')) as { guardiaDePublicacion: (a: { flujo: unknown; datos: unknown }) => string[] };
    const { PRODUCCION } = await import('./mundo');
    const con = (cambio: Record<string, unknown>) => {
      const f = JSON.parse(JSON.stringify(PRODUCCION)) as { nodes: { name: string; parameters: Record<string, unknown> }[] };
      Object.assign(f.nodes.find((n) => n.name === 'Traer catálogo')!.parameters, cambio);
      return C.guardiaDePublicacion({ flujo: f, datos: {} }).join(' ');
    };
    for (const cambio of [{ sendQuery: true }, { sendHeaders: true }, { options: { proxy: 'http://x' } }, { options: { allowUnauthorizedCerts: true } }, { options: { redirect: { redirect: { followRedirects: true } } } }]) expect(con(cambio)).toMatch(/no puede llevar query/);
    expect(con({})).not.toMatch(/no puede llevar query/);
  });
});
