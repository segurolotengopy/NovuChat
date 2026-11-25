/**
 * EL PEDIDO DEL CARRITO (módulo común Pedidos, `pedido-del-carrito.js`, prefijo `pc`; B4 de Casa Bermejo, 24/11/2026). Funciones puras, sin textos de cliente. Se prueba NEGANDO.
 * Los ids, nombres y precios son de PRUEBA.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RAIZ_REPO, cargarFuente } from '../../core/fuente-vm';

const P = cargarFuente<Record<string, any>>( // eslint-disable-line @typescript-eslint/no-explicit-any
  [join(RAIZ_REPO, 'Flujos/experimental/venta-digital/src/carrito.js'), join(RAIZ_REPO, 'Flujos/src/modulos/pedidos/pedido-del-carrito.js')],
  ['pcLineasDelCarrito', 'pcEntregaDelCarrito', 'pcDecision', 'pcQrSoloAlCompletar', 'pcMercadoCoincide'],
);
type Fn = (...a: unknown[]) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
const lineas = P['pcLineasDelCarrito'] as Fn;
const entrega = P['pcEntregaDelCarrito'] as Fn;
const decision = P['pcDecision'] as Fn;
const qrSolo = P['pcQrSoloAlCompletar'] as Fn;
const mercadoOk = P['pcMercadoCoincide'] as Fn;

const V = (o: Record<string, unknown> = {}) => ({ id: 'a1', nombre: 'Pieza A', precioCentavos: 10000, moneda: 'BOB', stock: 10, ...o });
const VENDIBLES = [V(), V({ id: 'b2', nombre: 'Pieza B', precioCentavos: 2550 })];
const it_ = (o: Record<string, unknown> = {}) => ({ id: 'a1', nombre: 'Pieza A', cantidad: 1, subtotal: 100, ...o });
const retiro = (s: string) => /retiro|recojo/i.test(s);
const envio = (s: string) => /envio|envío|flota/i.test(s);

describe('pcLineasDelCarrito', () => {
  it('las líneas salen del catálogo vivo: el precio y el nombre de la carga se ignoran', () => {
    const r = lineas({ items: [it_({ nombre: 'Gratis', precioCentavos: 1, cantidad: 2 }), it_({ id: 'b2', nombre: 'Pieza B' })], total: 225.5 }, VENDIBLES);
    expect(r.lineas.map((l: any) => [l.id, l.cantidad, l.precioCentavos, l.nombre])).toEqual([['a1', 2, 10000, 'Pieza A'], ['b2', 1, 2550, 'Pieza B']]); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(r.noEntraron).toEqual([]);
  });
  it('un precio de la carga distinto del vivo se anota en `distintos`; uno igual no', () => {
    expect(lineas({ items: [it_({ precioCentavos: 9999 })] }, VENDIBLES).distintos).toEqual(['a1']);
    expect(lineas({ items: [it_({ precioCentavos: 10000 })] }, VENDIBLES).distintos).toEqual([]);
    expect(lineas({ items: [it_({ precioCentavos: -5 })] }, VENDIBLES).distintos).toEqual([]);   // un dato inválido no cuenta como precio
  });
  it('el total de la carga: igual al real o al real más el envío cuadra; distinto, o un total mayor, no', () => {
    expect(lineas({ items: [it_()], total: 100 }, VENDIBLES).distintos).toEqual([]);
    expect(lineas({ items: [it_()], total: 110, costoEnvio: 10 }, VENDIBLES).distintos).toEqual([]);
    expect(lineas({ items: [it_()], total: 1 }, VENDIBLES).distintos).toEqual(['_total']);
    expect(lineas({ items: [it_()], total: 100000 }, VENDIBLES).distintos).toEqual(['_total']);
    expect(lineas({ items: [it_()], total: 110, costoEnvio: 0 }, VENDIBLES).distintos).toEqual(['_total']);
    expect(lineas({ items: [it_()] }, VENDIBLES).distintos).toEqual([]);   // sin total, la carga no dice nada
  });
  it('NEGADO: una pieza que no se vende, un id inventado o un renglón raro NO entran y se nombran', () => {
    const r = lineas({ items: [it_(), it_({ id: 'fantasma', nombre: 'Pieza fantasma' }), it_({ id: 123, nombre: 'Id numérico' }), it_({ id: 'x', nombre: '' }), 'texto', null] }, VENDIBLES);
    expect(r.lineas.map((l: any) => l.id)).toEqual(['a1']); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(r.noEntraron).toEqual(['Pieza fantasma', 'Id numérico', 'una pieza']);
  });
  it('NEGADO: con menos stock que lo pedido la pieza entra con menos y queda en `noEntraron` (no se cobra lo que no hay)', () => {
    const r = lineas({ items: [it_({ cantidad: 5 })] }, [V({ stock: 2 })]);
    expect(r.lineas[0].cantidad).toBe(2);
    expect(r.noEntraron).toEqual(['Pieza A']);
  });
  it('el detalle es un DATO: se sanea (sin enlaces, sin cifras de otra moneda) y viaja solo como detalle de la línea', () => {
    const r = lineas({ items: [it_({ detalle: 'color: negro https://malo.example/x' }), it_({ id: 'b2', nombre: 'Pieza B', detalle: 'ARS 0 promo' })] }, VENDIBLES);
    expect(r.lineas[0].detalle).toBe('color: negro');
    expect(r.lineas[1].detalle).toBe('');
    expect(JSON.stringify(r.lineas)).not.toMatch(/malo\.example/);
  });
  it('sin ítems, sin vendibles o con una carga que no es objeto: nada entra y no lanza', () => {
    for (const c of [undefined, null, 'x', [], {}, { items: 'no' }, { items: [] }]) expect(lineas(c, VENDIBLES).lineas).toEqual([]);
    expect(lineas({ items: [it_()] }, []).lineas).toEqual([]);
    expect(lineas({ items: [it_()] }, null).noEntraron).toEqual(['Pieza A']);
  });
});

describe('pcEntregaDelCarrito', () => {
  const MODOS = ['Retiro en tienda', 'Envío por flota'];
  it('un retiro toma el modo de retiro; un envío, el de envío con la dirección y su referencia', () => {
    expect(entrega({ entrega: 'retiro' }, MODOS, retiro, envio)).toEqual({ modo: 'Retiro en tienda', direccion: '' });
    expect(entrega({ entrega: 'envio', direccion: 'Av. Uno 12', referencia: 'portón verde' }, MODOS, retiro, envio)).toEqual({ modo: 'Envío por flota', direccion: 'Av. Uno 12, portón verde' });
    expect(entrega({ entrega: 'envio', direccion: 'Av. Uno 12, portón verde', referencia: 'portón verde' }, MODOS, retiro, envio).direccion).toBe('Av. Uno 12, portón verde');
  });
  it('NEGADO: un retiro nunca toma un modo de envío (ni al revés); sin un modo reconocible, el modo queda vacío y se pregunta', () => {
    expect(entrega({ entrega: 'retiro' }, ['Envío por flota'], retiro, envio).modo).toBe('');
    expect(entrega({ entrega: 'envio' }, ['Retiro en tienda'], retiro, envio).modo).toBe('');
    expect(entrega({ entrega: 'otra cosa' }, MODOS, retiro, envio).modo).toBe('');   // un valor raro NO es retiro: se pregunta (revisión del PR #1106)
    expect(entrega({ entrega: 'envio' }, undefined, retiro, envio)).toEqual({ modo: '', direccion: '' });
  });
  it('la dirección es un DATO: sin enlaces y de 120 caracteres como máximo; un retiro no lleva dirección', () => {
    expect(entrega({ entrega: 'envio', direccion: 'Calle 5 https://malo.example/x' }, MODOS, retiro, envio).direccion).toBe('Calle 5');
    expect(entrega({ entrega: 'envio', direccion: 'x'.repeat(300), referencia: 'y' }, MODOS, retiro, envio).direccion.length).toBeLessThanOrEqual(120);
    expect(entrega({ entrega: 'retiro', direccion: 'Calle 5' }, MODOS, retiro, envio).direccion).toBe('');
  });
});

describe('pcDecision (la regla del 23/11/2026)', () => {
  const OK = { lineas: [{ id: 'a1' }], noEntraron: [], distintos: [], descartados: 0, entregaCompleta: true, cobroReal: true, mercadoCoincide: true };
  it('todo entró + entrega completa + cobro real ⇒ qr', () => { expect(decision(OK)).toBe('qr'); });
  it('sin piezas, o sin nada ⇒ derivar (antes que cualquier otra regla)', () => {
    expect(decision({ ...OK, lineas: [] })).toBe('derivar');
    expect(decision({ ...OK, lineas: [], entregaCompleta: false })).toBe('derivar');
    for (const x of [undefined, null, 'x', {}]) expect(decision(x)).toBe('derivar');
  });
  it('falta la entrega ⇒ pedir_faltante', () => {
    expect(decision({ ...OK, entregaCompleta: false })).toBe('pedir_faltante');
    expect(decision({ ...OK, entregaCompleta: 'sí' })).toBe('pedir_faltante');   // solo `true` cuenta
  });
  it('NEGADO: cada condición por sí sola impide el QR directo y deja «listo para confirmar»', () => {
    expect(decision({ ...OK, noEntraron: ['Pieza X'] })).toBe('listo_para_confirmar');
    expect(decision({ ...OK, distintos: ['a1'] })).toBe('listo_para_confirmar');
    expect(decision({ ...OK, distintos: ['_total'] })).toBe('listo_para_confirmar');
    expect(decision({ ...OK, descartados: 1 })).toBe('listo_para_confirmar');
    expect(decision({ ...OK, cobroReal: false })).toBe('listo_para_confirmar');
    expect(decision({ ...OK, cobroReal: 'real' })).toBe('listo_para_confirmar');   // solo `true` cuenta: un dato raro nunca da más cobro
    expect(decision({ ...OK, cobroReal: undefined })).toBe('listo_para_confirmar');
  });
  it('NEGADO: un dato ilegible en `descartados` cuenta como «hubo descartados»', () => {
    for (const d of [undefined, NaN, 'muchos', {}, Infinity]) expect(decision({ ...OK, descartados: d })).toBe('listo_para_confirmar');
    expect(decision({ ...OK, descartados: '0' })).toBe('listo_para_confirmar');   // K1 manda un ARREGLO de ids: un texto no es el número (revisión del PR #1106)
    expect(decision({ ...OK, descartados: -3 })).toBe('listo_para_confirmar');   // un negativo es un dato raro
  });
  it('la entrega incompleta gana sobre lo descartado (se pregunta primero); `pcQrSoloAlCompletar` dice si el QR saldría solo al completarla', () => {
    expect(decision({ ...OK, entregaCompleta: false, descartados: 2 })).toBe('pedir_faltante');
    expect(qrSolo({ ...OK })).toBe(true);
    expect(qrSolo({ ...OK, descartados: 2 })).toBe(false);
    expect(qrSolo({ ...OK, noEntraron: ['x'] })).toBe(false);
    expect(qrSolo({ ...OK, distintos: ['_total'] })).toBe(false);
    expect(qrSolo({ ...OK, cobroReal: false })).toBe(false);
    expect(qrSolo({ lineas: [] })).toBe(false);
  });
});

describe('pcMercadoCoincide (K1): la moneda y el mercado de la carga se COMPRUEBAN contra el país del teléfono', () => {
  it('Bolivia: BOB (o sin moneda) y mercado BO (o ausente); Argentina: ARS externo y mercado AR', () => {
    expect(mercadoOk({ moneda: 'BOB' }, 'BO')).toBe(true);
    expect(mercadoOk({}, 'BO')).toBe(true);
    expect(mercadoOk({ moneda: 'BOB', mercado: 'BO', catalogo: 'externo' }, 'BO')).toBe(true);
    expect(mercadoOk({ moneda: 'ARS', mercado: 'AR', catalogo: 'externo' }, 'AR')).toBe(true);
  });
  it('NEGADO: una carga de Argentina exige moneda ARS, mercado AR y catalogo externo, los tres; una carga vacía o solo con mercado no sirve', () => {
    expect(mercadoOk({}, 'AR')).toBe(false);
    expect(mercadoOk({ mercado: 'AR' }, 'AR')).toBe(false);
    expect(mercadoOk({ moneda: 'ARS', mercado: 'AR' }, 'AR')).toBe(false);
    expect(mercadoOk({ moneda: 'ARS', catalogo: 'externo' }, 'AR')).toBe(false);
  });
  it('NEGADO: la moneda o el mercado de otro país, USD, ARS sin fuente externa y un teléfono de otro país NO coinciden', () => {
    expect(mercadoOk({ moneda: 'ARS', catalogo: 'externo' }, 'BO')).toBe(false);
    expect(mercadoOk({ moneda: 'BOB' }, 'AR')).toBe(false);
    expect(mercadoOk({ moneda: 'USD' }, 'BO')).toBe(false);
    expect(mercadoOk({ moneda: 'USD', mercado: 'AR' }, 'AR')).toBe(false);
    expect(mercadoOk({ moneda: 'BOB', mercado: 'AR' }, 'BO')).toBe(false);
    expect(mercadoOk({ moneda: 'ARS', mercado: 'AR' }, 'AR')).toBe(false); // ARS sin catalogo: 'externo'
    expect(mercadoOk({ moneda: 'BOB' }, '')).toBe(false);
    expect(mercadoOk(null, 'BO')).toBe(false);
    expect(mercadoOk({ moneda: 'BOB' }, 'otro')).toBe(false);
  });
});

describe('revisión del PR #1106: casos que no pueden dejar salir un QR que no corresponde', () => {
  it('`descartados` es el ARREGLO de ids de K1: cualquier id (incluso «0») impide el QR; vacío lo permite; un valor ilegible cuenta como descartado', () => {
    expect(decision({ ...OK_REV, descartados: ['0'] })).toBe('listo_para_confirmar');
    expect(decision({ ...OK_REV, descartados: ['x', 'y'] })).toBe('listo_para_confirmar');
    expect(decision({ ...OK_REV, descartados: [] })).toBe('qr');
    expect(decision({ ...OK_REV, descartados: 0 })).toBe('qr');
    for (const raro of ['', null, undefined, 'a', -1, 1.5, {}]) expect(decision({ ...OK_REV, descartados: raro }), String(raro)).toBe('listo_para_confirmar');
  });
  it('NEGADO: sin `mercadoCoincide === true` NUNCA sale el QR (el candado está en la decisión)', () => {
    for (const v of [false, undefined, null, 'true', 1]) expect(decision({ ...OK_REV, mercadoCoincide: v }), String(v)).toBe('listo_para_confirmar');
    expect(qrSolo({ lineas: [{ id: 'a1' }], noEntraron: [], distintos: [], descartados: [], cobroReal: true })).toBe(false);
  });
  it('una cantidad en texto («5») con stock 2 NO se cobra en silencio: la pieza queda en `noEntraron`', () => {
    const r = lineas({ items: [it_({ cantidad: '5' })] }, [V({ stock: 2 })]);
    expect(r.lineas[0].cantidad).toBe(2);
    expect(r.noEntraron).toEqual(['Pieza A']);
  });
  it('más de 50 renglones: lo que sobra se dice (`otras piezas`), no se pierde en silencio', () => {
    const items = Array.from({ length: 50 }, () => it_({ cantidad: 1 })).concat([it_({ id: 'b2', nombre: 'Pieza B' })]);
    expect(lineas({ items }, VENDIBLES).noEntraron).toContain('otras piezas');
  });
  it('hasta 99 unidades por pieza (el tope del servidor), no 50', () => {
    const r = lineas({ items: [it_({ cantidad: 60 })] }, [V({ stock: 99 })]);
    expect(r.lineas[0].cantidad).toBe(60);
    expect(r.noEntraron).toEqual([]);
  });
  it('NEGADO: monedas mezcladas en las líneas del catálogo vivo, aun sin `total` en la carga, quedan en `distintos` (no hay total honesto)', () => {
    const r = lineas({ items: [it_(), it_({ id: 'b2', nombre: 'Pieza B' })] }, [V({ moneda: 'BOB' }), V({ id: 'b2', nombre: 'Pieza B', moneda: 'ARS' })]);
    expect(r.distintos).toContain('_moneda');
    expect(decision({ ...OK_REV, distintos: r.distintos })).toBe('listo_para_confirmar');
  });
  it('NEGADO: una entrega ausente o rara NO se toma como retiro (el modo queda vacío y se pregunta); tampoco lanza con reconocedores que no son funciones', () => {
    for (const e of [undefined, null, '', 'otra', 'RETIRO', 7]) expect(entrega({ entrega: e }, ['Retiro en tienda', 'Envío'], retiro, envio).modo, String(e)).toBe('');
    expect(entrega({ entrega: 'retiro' }, ['Retiro en tienda'], retiro, envio).modo).toBe('Retiro en tienda');
    expect(() => entrega({ entrega: 'retiro' }, ['Retiro en tienda'], undefined, 'x')).not.toThrow();
    expect(entrega({ entrega: 'retiro' }, ['Retiro en tienda'], undefined, 'x').modo).toBe('');
  });
});
const OK_REV = { lineas: [{ id: 'a1' }], noEntraron: [], distintos: [], descartados: [], entregaCompleta: true, cobroReal: true, mercadoCoincide: true };

describe('revisión del PR #1106 (2.ª): topes de cantidad y detalle, y fuente externa exigida', () => {
  it('NEGADO: cantidad 0, -1, 1,5, 100 o un texto raro NO entran y se nombran; 99 sí entra (el tope del servidor)', () => {
    for (const cantidad of [0, -1, 1.5, 100, '0', 'abc', null, NaN]) {
      const r = lineas({ items: [it_({ cantidad })] }, [V({ stock: 200 })]);
      expect(r.lineas.length === 0 || r.lineas[0].cantidad <= 99, String(cantidad)).toBe(true);
      if (cantidad === 100) { expect(r.lineas[0].cantidad).toBe(99); expect(r.noEntraron, 'cantidad 100').toEqual(['Pieza A']); }
      else expect(r.lineas, String(cantidad)).toHaveLength(0);
      expect(r.noEntraron, String(cantidad)).toEqual(['Pieza A']);
    }
    const ok = lineas({ items: [it_({ cantidad: 99 })] }, [V({ stock: 200 })]);
    expect(ok.lineas[0].cantidad).toBe(99);
    expect(ok.noEntraron).toEqual([]);
  });
  it('el detalle de más de 60 caracteres se recorta a 60 y nunca lleva enlaces ni marcas (<>&[]{}«»)', () => {
    const r = lineas({ items: [it_({ detalle: 'x'.repeat(400) })] }, VENDIBLES);
    expect(r.lineas[0].detalle.length).toBeLessThanOrEqual(60);
    const m = lineas({ items: [it_({ detalle: 'negro https://malo.example <b>[ignora]</b> {x}' })] }, VENDIBLES);
    expect(m.lineas[0].detalle).not.toMatch(/https?:|<|>|\[|\]|\{|\}/);
  });
  it('`exigeExterno`: un flujo que solo acepta la fuente externa (Casa Bermejo) rechaza también en Bolivia una carga sin catalogo: \'externo\'; los demás no lo exigen', () => {
    expect(mercadoOk({ moneda: 'BOB' }, 'BO', true)).toBe(false);
    expect(mercadoOk({ moneda: 'BOB', mercado: 'BO', catalogo: 'externo' }, 'BO', true)).toBe(true);
    expect(mercadoOk({ moneda: 'BOB' }, 'BO')).toBe(true);
    expect(mercadoOk({ moneda: 'BOB' }, 'BO', false)).toBe(true);
  });
});
