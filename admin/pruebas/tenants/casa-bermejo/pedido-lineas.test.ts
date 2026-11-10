/**
 * LAS LÍNEAS DEL PEDIDO QUE EL FLUJO DE CASA BERMEJO MANDA AL SERVIDOR (B8, tarea A). Contrato: `docs/arquitectura/modulos/pedidos.md`, «Pedido de catálogo externo».
 * Forma cerrada `{externa, id, nombre, cantidad, precioCentavos, moneda, detalle?, subtotalCentavos}`; todo sale del catálogo y del carrito calculados por el CÓDIGO, nunca del modelo.
 * Se prueba NEGANDO. Sin servidor: el servidor es un doble que recibe el reporte.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { cargarFuente, RAIZ_REPO } from '../../core/fuente-vm';
import { ANA, CATALOGO, ENTREGA, catalogoOk, crear, hablar, mTexto, modelo, panelSinCobro, textos } from './mundo';

const BIL = 'billetera-cuero'; // Bs 450
const BUF = 'bufanda-vicuna'; // Bs 7.795
const ARG = ['54', '9', '11', '5550', '0001'].join('');
const CLAVES = ['externa', 'id', 'nombre', 'cantidad', 'precioCentavos', 'moneda', 'detalle', 'subtotalCentavos'];
const pide = (lineas: unknown[], extra: Record<string, unknown> = {}) => modelo('Con gusto, lo anoto.', { lineas, ...extra });
const itemAr = (o: Record<string, unknown> = {}) => ({ ...CATALOGO[1], moneda: 'ARS', precio: 450000, precioCentavos: 45000000, stock: 10, disponible: true, ...o });
const catAr = (items: unknown[] = [itemAr()]) => catalogoOk({ mercado: 'AR', moneda: 'ARS' }, items as never);
type Rep = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const evento = (t: { llamadas: { ingesta: Record<string, unknown>[] } }, e: string): Rep | undefined => t.llamadas.ingesta.find((x) => x['evento'] === e) as Rep | undefined;
const confirmar = (m: ReturnType<typeof crear>, tel: string) => { hablar(m, tel, mTexto('quiero una billetera')); return hablar(m, tel, mTexto('quiero pagar')); };

describe('Bolivia: `qr_enviado` lleva la línea completa', () => {
  it('forma cerrada, precio del catálogo y moneda BOB', () => {
    const t = confirmar(crear({ modeloDice: pide([{ id: BIL, cantidad: 2 }], { entrega: ENTREGA }) }), ANA);
    const l = evento(t, 'qr_enviado')?.['lineas'] as Rep[];
    expect(l).toEqual([{ externa: true, id: BIL, nombre: 'Billetera de cuero', cantidad: 2, precioCentavos: 45000, moneda: 'BOB', subtotalCentavos: 90000 }]);
    for (const x of l) for (const k of Object.keys(x)) expect(CLAVES).toContain(k);
  });
  it('NEGADO: precio, nombre, moneda, subtotal y claves extra del modelo no llegan al servidor', () => {
    const t = confirmar(crear({ modeloDice: pide([{ id: BIL, cantidad: 1, precio: 1, precioCentavos: 1, subtotalCentavos: 1, nombre: 'Regalo', moneda: 'ARS', externa: false, sku: 'X' }], { entrega: ENTREGA }) }), ANA);
    const l = evento(t, 'qr_enviado')?.['lineas'] as Rep[];
    expect(l).toEqual([{ externa: true, id: BIL, nombre: 'Billetera de cuero', cantidad: 1, precioCentavos: 45000, moneda: 'BOB', subtotalCentavos: 45000 }]);
    expect(JSON.stringify(t.llamadas.ingesta)).not.toMatch(/Regalo|"sku"/);
  });
  it('si el servidor de la tienda cambia el precio, la línea sale con el precio nuevo', () => {
    const m = crear({ catalogo: catalogoOk({}, [{ ...CATALOGO[1], precioCentavos: 50000, precio: 500, stock: 10, disponible: true }]), modeloDice: pide([{ id: BIL, cantidad: 2, precio: 1 }], { entrega: ENTREGA }) });
    const l = evento(confirmar(m, ANA), 'qr_enviado')?.['lineas'] as Rep[];
    expect(l[0]).toMatchObject({ precioCentavos: 50000, subtotalCentavos: 100000 });
  });
  it('ids repetidos con distinto detalle se fusionan: UNA línea por id, con la cantidad sumada', () => {
    const m = crear({ modeloDice: pide([{ id: BIL, cantidad: 1, detalle: 'azul' }, { id: BUF, cantidad: 1 }, { id: BIL, cantidad: 2, detalle: 'negra' }], { entrega: ENTREGA }) });
    const l = evento(confirmar(m, ANA), 'qr_enviado')?.['lineas'] as Rep[];
    expect(l.map((x) => x['id'])).toEqual([BIL, BUF]);
    expect(l[0]).toMatchObject({ cantidad: 3, subtotalCentavos: 135000 });
    expect(l[0]?.['detalle']).toBe('1 azul · 2 negra');
    expect(l[1]).toEqual({ externa: true, id: BUF, nombre: 'Bufanda de vicuña', cantidad: 1, precioCentavos: 779500, moneda: 'BOB', subtotalCentavos: 779500 });
    expect(new Set(l.map((x) => x['id'])).size).toBe(l.length);
  });
  it('la suma de las líneas coincide con el monto del QR', () => {
    const m = crear({ modeloDice: pide([{ id: BIL, cantidad: 2 }, { id: BUF, cantidad: 1 }], { entrega: ENTREGA }) });
    const rep = evento(confirmar(m, ANA), 'qr_enviado') as Rep;
    expect((rep['lineas'] as Rep[]).reduce((a, x) => a + x['subtotalCentavos'], 0)).toBe(rep['monto'] * 100);
  });
});

describe('Argentina: `pedido_sin_cobro` lleva la línea en pesos', () => {
  const armar = () => crear({ catalogo: catAr(), modeloDice: pide([{ id: BIL, cantidad: 1, precio: 1, moneda: 'BOB' }], { entrega: ENTREGA }) });
  it('se emite una vez, con referencia, entrega y líneas ARS de forma cerrada; sin monto ni regla de cobro', () => {
    const t = confirmar(armar(), ARG);
    const rep = evento(t, 'pedido_sin_cobro') as Rep;
    expect(rep).toBeTruthy();
    expect(rep['lineas']).toEqual([{ externa: true, id: BIL, nombre: 'Billetera de cuero', cantidad: 1, precioCentavos: 45000000, moneda: 'ARS', subtotalCentavos: 45000000 }]);
    expect(rep['referencia']).toMatch(/^[A-Za-z0-9]{3,40}$/);
    expect(rep['entrega']).toBeTruthy();
    expect(rep).not.toHaveProperty('monto');
    expect(rep).not.toHaveProperty('reglaCobro');
    expect(t.llamadas.ingesta.filter((x) => x['evento'] === 'pedido_sin_cobro')).toHaveLength(1);
    expect(evento(t, 'qr_enviado')).toBeUndefined();
    expect(JSON.stringify(rep)).not.toMatch(/factur/i);
  });
  it('NEGADO: el teléfono del reporte es el del mensaje y la moneda es ARS aunque el modelo diga BOB', () => {
    const rep = evento(confirmar(armar(), ARG), 'pedido_sin_cobro') as Rep;
    expect(rep['telefono']).toBe(ARG);
    expect(JSON.stringify(rep['lineas'])).not.toMatch(/BOB/);
  });
  it('dos pedidos seguidos no repiten la referencia', () => {
    const m = armar();
    const a = evento(confirmar(m, ARG), 'pedido_sin_cobro') as Rep;
    const b = evento(confirmar(m, ARG), 'pedido_sin_cobro') as Rep;
    expect(a['referencia']).not.toBe(b['referencia']);
  });
  it('NEGADO: si Meta no aceptó el mensaje, el evento no viaja (no hay pedido de algo que el cliente no leyó)', () => {
    const m = crear({ catalogo: catAr(), envio: { 'Enviar a WhatsApp': 'error' }, modeloDice: pide([{ id: BIL, cantidad: 1 }], { entrega: ENTREGA }) });
    hablar(m, ARG, mTexto('una billetera'));
    const t = hablar(m, ARG, mTexto('quiero pagar'), { toleraFallo: true });
    expect(evento(t, 'pedido_sin_cobro')).toBeUndefined();
  });
  it('NEGADO: un pedido sin entrega completa no emite nada', () => {
    const m = crear({ catalogo: catAr(), modeloDice: pide([{ id: BIL, cantidad: 1 }]) });
    expect(evento(confirmar(m, ARG), 'pedido_sin_cobro')).toBeUndefined();
  });
  it('cero mensajes agregados: sigue siendo 1 mensaje al cliente y 1 aviso al comercio, y el texto no promete ni dice «acreditado»', () => {
    const t = confirmar(armar(), ARG);
    expect(t.mensajes).toHaveLength(1);
    expect(t.avisos).toHaveLength(1);
    expect(textos(t).join(' ')).not.toMatch(/acreditad|verificad|recibimos tu pago|te avisamos|te llamamos/i);
  });
});

describe('Bolivia sin QR configurado: no emite `pedido_sin_cobro` (el evento es de Argentina)', () => {
  it('el pedido queda anotado y no se reporta como pedido sin cobro', () => {
    const t = confirmar(crear({ panel: panelSinCobro(), modeloDice: pide([{ id: BIL, cantidad: 1 }], { entrega: ENTREGA }) }), ANA);
    expect(evento(t, 'pedido_sin_cobro')).toBeUndefined();
    expect(evento(t, 'qr_enviado')).toBeUndefined();
  });
});

describe('bmLineasPedido, la función pura', () => {
  const F = cargarFuente<{ bmLineasPedido: (l: unknown, from: string) => unknown[] | null }>([
    join(RAIZ_REPO, 'Flujos/experimental/venta-digital/src/catalogo-externo.js'),
    join(RAIZ_REPO, 'Flujos/experimental/casa-bermejo/src/lib/bm-venta.js'),
  ], ['bmLineasPedido']);
  const L = (o: Record<string, unknown> = {}) => ({ id: 'p1', nombre: 'Pieza', cantidad: 1, precioCentavos: 10000, detalle: '', moneda: 'BOB', ...o });
  it('devuelve null (nunca una línea a medias) ante cada defecto', () => {
    expect(F.bmLineasPedido([L()], ANA)).toHaveLength(1);
    expect(F.bmLineasPedido([L({ moneda: 'ARS' })], ANA)).toBeNull(); // moneda que no es la del mercado
    expect(F.bmLineasPedido([L({ moneda: 'BOB' })], ARG)).toBeNull();
    expect(F.bmLineasPedido([L({ moneda: 'ARS', precioCentavos: 10050 })], ARG)).toBeNull(); // ARS en múltiplos de 100
    expect(F.bmLineasPedido([L()], '5511900000033')).toBeNull(); // mercado desconocido
    expect(F.bmLineasPedido([L()], '')).toBeNull();
    expect(F.bmLineasPedido([L({ id: 'a__b' })], ANA)).toBeNull();
    expect(F.bmLineasPedido([L({ id: '../x' })], ANA)).toBeNull();
    expect(F.bmLineasPedido([L({ id: '' })], ANA)).toBeNull();
    expect(F.bmLineasPedido([L({ precioCentavos: 0 })], ANA)).toBeNull();
    expect(F.bmLineasPedido([L({ precioCentavos: 1.5 })], ANA)).toBeNull();
    expect(F.bmLineasPedido([L({ precioCentavos: 100_000_001 })], ANA)).toBeNull();
    expect(F.bmLineasPedido([L({ cantidad: 0 })], ANA)).toBeNull();
    expect(F.bmLineasPedido([L({ cantidad: 51 })], ANA)).toBeNull();
    expect(F.bmLineasPedido([L({ cantidad: 30 }), L({ cantidad: 30 })], ANA)).toBeNull(); // la suma por id pasa de 50
    expect(F.bmLineasPedido([L({ nombre: '' })], ANA)).toBeNull();
    expect(F.bmLineasPedido([L(), L({ precioCentavos: 20000 })], ANA)).toBeNull(); // un id con dos precios
    expect(F.bmLineasPedido([], ANA)).toBeNull();
    expect(F.bmLineasPedido('x', ANA)).toBeNull();
    expect(F.bmLineasPedido(Array.from({ length: 31 }, (_, i) => L({ id: 'p' + i })), ANA)).toBeNull();
  });
  it('el nombre y el detalle salen limpios y acotados; nada de claves extra', () => {
    const [l] = F.bmLineasPedido([L({ nombre: '<b>' + 'x'.repeat(200) + '</b>', detalle: 'azul & verde', sku: 'SECRETO' })], ANA) as Rep[];
    expect(Object.keys(l!).every((k) => CLAVES.includes(k))).toBe(true);
    expect(String(l!['nombre'])).not.toMatch(/[<>&]/);
    expect(String(l!['nombre']).length).toBeLessThanOrEqual(80);
    expect(l!['detalle']).toBe('azul verde');
  });
});
