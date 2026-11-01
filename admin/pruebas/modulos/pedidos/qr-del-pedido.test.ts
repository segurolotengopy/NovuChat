/**
 * MÓDULO PEDIDOS, LADO DEL FLUJO (PR-4): `Flujos/src/modulos/pedidos/qr-del-pedido.js`, NEGANDO.
 *
 * Lo que el flujo manda en el `qr_enviado` son solo identificadores, cantidades y un detalle: el precio, el nombre y el total
 * salen del catálogo del servidor, y el NIT/CI jamás sale del flujo. Cada prueba dice lo que NO debe pasar.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { armarPedidoWa } from '../../../functions/src/modulos/pedidos/pedidoDelQr.ts';

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const FUENTE = readFileSync(join(RAIZ, 'Flujos/src/modulos/pedidos/qr-del-pedido.js'), 'utf8');
// Se evalúa como lo hace un nodo Code: el texto del módulo delante, sin módulos ni globales de Node.
const M = new Function(`${FUENTE}\nreturn { pqrLineas, pqrEntrega, pqrCampos };`)() as {
  pqrLineas: (l: unknown) => J[]; pqrEntrega: (e: unknown) => J; pqrCampos: (r: unknown, l: unknown, e: unknown, s: unknown) => J;
};

describe('pqrLineas: solo id, cantidad y detalle', () => {
  it('junta el mismo id sumando cantidades y une los detalles con « · » (el servidor se quedaría solo con la primera)', () => {
    const r = M.pqrLineas([
      { id: 'taco', cantidad: 2, detalle: 'sin cebolla' },
      { id: 'jugo', cantidad: 1, detalle: '' },
      { id: 'taco', cantidad: 3, detalle: 'con picante' },
    ]);
    expect(r).toEqual([{ id: 'taco', cantidad: 5, detalle: 'sin cebolla · con picante' }, { id: 'jugo', cantidad: 1, detalle: '' }]);
  });
  it('el detalle unido se recorta a 120', () => {
    const r = M.pqrLineas([{ id: 'a', cantidad: 1, detalle: 'x'.repeat(100) }, { id: 'a', cantidad: 1, detalle: 'y'.repeat(100) }]);
    expect(r[0]!['detalle'].length).toBeLessThanOrEqual(120);
  });
  it('negado: la suma nunca pasa de 50 unidades', () => {
    expect(M.pqrLineas([{ id: 'a', cantidad: 40 }, { id: 'a', cantidad: 40 }])[0]!['cantidad']).toBe(50);
  });
  it('negado: nunca más de 30 líneas', () => {
    const muchas = Array.from({ length: 45 }, (_, i) => ({ id: `p${i}`, cantidad: 1 }));
    expect(M.pqrLineas(muchas)).toHaveLength(30);
  });
  it('negado: ids con barra, con «..», vacíos, de otro tipo o demasiado largos se descartan; cantidades inválidas también', () => {
    const malas = ['a/b', '../x', 'a..b', '', '-x', 'a b', 'x'.repeat(81), 5, null, { x: 1 }];
    for (const id of malas) expect(M.pqrLineas([{ id, cantidad: 1 }]), String(id)).toEqual([]);
    for (const cantidad of [0, -2, 'abc', null, NaN, undefined]) expect(M.pqrLineas([{ id: 'a', cantidad }]), String(cantidad)).toEqual([]);
    expect(M.pqrLineas('no es lista')).toEqual([]);
  });
  it('negado: precio, nombre, total y facturacion de entrada NO salen', () => {
    const r = M.pqrLineas([{ id: 'taco', cantidad: 2, detalle: 'ok', precio: 1, nombre: 'Taco', subtotal: 2, total: 2, facturacion: { documento: '4567890' }, nit: '4567890' }]);
    expect(Object.keys(r[0]!).sort()).toEqual(['cantidad', 'detalle', 'id']);
    expect(JSON.stringify(r)).not.toMatch(/4567890|precio|nombre/);
  });
  it('el detalle sale sin <>&, sin saltos de línea y sin caracteres de control', () => {
    const r = M.pqrLineas([{ id: 'a', cantidad: 1, detalle: 'sin <b>cebolla</b> & \n‮\u0000 más' }]);
    expect(r[0]!['detalle']).not.toMatch(/[<>&\n‮\u0000]/);
  });
});

describe('pqrEntrega', () => {
  it('cada palabra de delivery da envio con la dirección y la referencia unidas', () => {
    for (const palabra of ['delivery', 'domicilio', 'envio', 'courier', 'encomienda', 'DELIVERY']) {
      const r = M.pqrEntrega({ entrega: palabra, direccion: 'Calle Falsa 123', referencia: 'portón verde' });
      expect(r, palabra).toEqual({ tipo: 'envio', direccion: 'Calle Falsa 123 · portón verde' });
    }
  });
  it('lo que no es delivery es retiro y no lleva dirección ni ubicación', () => {
    for (const e of ['recojo', '', undefined, null, 7, { entrega: 'recojo', direccion: 'Calle X 1', ubicacion: { lat: 1, lng: 1 } }]) {
      expect(M.pqrEntrega(e), String(JSON.stringify(e))).toEqual({ tipo: 'retiro' });
    }
  });
  it('la ubicación solo sale si es válida y no es (0,0)', () => {
    const base = { entrega: 'delivery', direccion: 'Calle Falsa 123' };
    expect(M.pqrEntrega({ ...base, ubicacion: { lat: -16.5, lng: -68.15 } })['ubicacion']).toEqual({ lat: -16.5, lng: -68.15 });
    const malas: unknown[] = [{ lat: 0, lng: 0 }, { lat: 91, lng: 0 }, { lat: 0, lng: 181 }, { lat: -91, lng: 5 }, { lat: '1', lng: 2 }, { lat: NaN, lng: 1 }, [1, 2], null, 'x'];
    for (const ubicacion of malas) expect(M.pqrEntrega({ ...base, ubicacion }), JSON.stringify(ubicacion)).not.toHaveProperty('ubicacion');
  });
  it('la dirección sale sin <>&, sin enlaces y de hasta 200', () => {
    const r = M.pqrEntrega({ entrega: 'delivery', direccion: 'Calle <b>1</b> & 2 ' + 'z'.repeat(300), referencia: 'ver http://malo.example/x' });
    expect(r['direccion']).not.toMatch(/[<>&]/);
    expect(r['direccion'].length).toBeLessThanOrEqual(200);
  });
  it('negado: nunca lleva facturacion, nit ni documento', () => {
    const r = M.pqrEntrega({ entrega: 'delivery', direccion: 'Calle Falsa 123', facturacion: { documento: '4567890' }, nit: '4567890', documento: '4567890' });
    expect(JSON.stringify(r)).not.toMatch(/4567890|facturacion|nit|documento/i);
  });
});

describe('pqrCampos', () => {
  const L = [{ id: 'taco', cantidad: 2, detalle: '' }];
  it('con un pedido real lleva lineas y entrega, y nada más', () => {
    const r = M.pqrCampos('ped-2026-10-05-0011-abc', L, { modalidad: 'recojo' }, false);
    expect(Object.keys(r).sort()).toEqual(['entrega', 'lineas']);
  });
  it('negado: simulado, referencia cat_, referencia vacía o sin líneas válidas dan {}', () => {
    expect(M.pqrCampos('ped-1', L, {}, true)).toEqual({});
    expect(M.pqrCampos('cat_abc123', L, {}, false)).toEqual({});
    expect(M.pqrCampos('', L, {}, false)).toEqual({});
    expect(M.pqrCampos(undefined, L, {}, false)).toEqual({});
    expect(M.pqrCampos('ped-1', [], {}, false)).toEqual({});
    expect(M.pqrCampos('ped-1', [{ id: '../x', cantidad: 1 }], {}, false)).toEqual({});
  });
  it('negado: aunque la entrada traiga facturacion, el resultado no la tiene', () => {
    const r = M.pqrCampos('ped-1', L, { modalidad: 'delivery', direccion: 'Calle Falsa 123', facturacion: { nombre: 'X', documento: 'NIT 4567890' } }, false);
    expect(JSON.stringify(r)).not.toMatch(/facturacion|4567890|NIT/i);
  });
});

describe('contrato con el servidor: lo que sale del flujo lo acepta armarPedidoWa sin descartes y con el mismo total', () => {
  const CAT = {
    taco: { nombre: 'Taco', precio: 10, moneda: 'BOB', activo: true },
    jugo: { nombre: 'Jugo', precio: 7.5, moneda: 'BOB', activo: true },
  } as Record<string, Record<string, unknown>>;
  it('descartados:[] y totalDistinto:false con el monto del QR', () => {
    const c = M.pqrCampos('ped-2026-10-05-0011-abc', [
      { id: 'taco', cantidad: 2, detalle: 'sin cebolla' }, { id: 'jugo', cantidad: 1 }, { id: 'taco', cantidad: 1, detalle: 'picante' },
    ], { entrega: 'delivery', direccion: 'Calle Falsa 123', referencia: 'portón verde', ubicacion: { lat: -16.5, lng: -68.15 } }, false);
    const r = armarPedidoWa(c['lineas'], c['entrega'], undefined, CAT, 'ped-2026-10-05-0011-abc', '59100000011', 37.5);
    expect(r.descartados).toEqual([]);
    expect(r.pedido?.totalDistinto).toBe(false);
    expect(r.pedido?.total).toBe(37.5);
    expect(r.pedido?.entrega).toBe('envio');
    expect(r.pedido?.direccion).toBe('Calle Falsa 123 · portón verde');
    expect(r.pedido?.ubicacion).toEqual({ lat: -16.5, lng: -68.15 });
    expect(r.pedido?.items.find((i) => i['id'] === 'taco')?.['detalle']).toBe('sin cebolla · picante');
    expect(r.pedido?.facturacion).toBeUndefined();
  });
});

describe('NIT/CI: el módulo común no lo menciona y no hay forma de que viaje', () => {
  it('el fuente del módulo no tiene la palabra «facturacion» como campo ni «nit»/«documento» como clave', () => {
    const sinComentarios = FUENTE.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(sinComentarios).not.toMatch(/facturaci|\bnit\b|documento/i);
  });
});
