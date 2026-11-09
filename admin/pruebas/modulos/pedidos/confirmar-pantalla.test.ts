/**
 * LA PANTALLA DE «CONFIRMAR» (B5b): cuándo hay botón y cómo se lee el error del servidor. Pura.
 * El servidor vuelve a negar todo (`confirmar-externo.test.ts`); esto solo evita mostrar de más y perder los faltantes.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leerErrorDeConfirmar, puedeConfirmarse } from '../../../web/src/modulos/pedidos/confirmar.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const PANTALLA = readFileSync(join(aqui, '..', '..', '..', 'web', 'src', 'modulos', 'pedidos', 'Pedidos.tsx'), 'utf8');

describe('el botón «Confirmar»', () => {
  it('NIEGA: no aparece para un pedido propio, ya confirmado, cancelado, reemplazado o sin datos', () => {
    for (const p of [
      { catalogo: undefined, estado: 'recibido' }, { catalogo: 'propio', estado: 'recibido' },
      { catalogo: 'externo', estado: 'confirmado' }, { catalogo: 'externo', estado: 'cancelado' },
      { catalogo: 'externo', estado: 'reemplazado' }, { catalogo: 'externo' }, {},
    ]) expect(puedeConfirmarse(p)).toBe(false);
  });
  it('aparece solo para un pedido externo `recibido`', () => {
    expect(puedeConfirmarse({ catalogo: 'externo', estado: 'recibido' })).toBe(true);
  });
  it('la pantalla llama a la callable con SOLO el pedidoId (el comercio sale del token)', () => {
    expect(PANTALLA).toContain("httpsCallable(funciones, 'confirmarPedidoExterno')({ pedidoId })");
    expect(PANTALLA).not.toMatch(/confirmarPedidoExterno'\)\(\{[^}]*tenant/);
  });
});

describe('el error del servidor', () => {
  it('409 de stock: muestra los faltantes legibles', () => {
    const e = { code: 'functions/failed-precondition', message: 'NovuTienda no tiene stock suficiente para este pedido.',
      details: { motivo: 'stock_insuficiente', faltantes: [{ productoId: 'a', nombre: 'Mesa', solicitado: 2, disponible: 1 }, { productoId: 'b' }] } };
    expect(leerErrorDeConfirmar(e)).toEqual({
      mensaje: e.message,
      faltantes: [{ productoId: 'a', nombre: 'Mesa', solicitado: 2, disponible: 1 }, { productoId: 'b', nombre: 'b' }],
    });
  });
  it('NIEGA: detalles de otra cosa, con formas raras o de otro código, no producen una lista', () => {
    expect(leerErrorDeConfirmar({ code: 'functions/unavailable', message: 'x', details: { motivo: 'stock_insuficiente', faltantes: [{ productoId: 'a' }] } }).faltantes).toEqual([]);
    expect(leerErrorDeConfirmar({ code: 'functions/failed-precondition', message: 'x', details: { motivo: 'otro', faltantes: [{ productoId: 'a' }] } }).faltantes).toEqual([]);
    expect(leerErrorDeConfirmar({ code: 'functions/failed-precondition', message: 'x', details: { motivo: 'stock_insuficiente', faltantes: [7, null, { productoId: 3 }, { productoId: 'a', solicitado: 'dos' }] } }).faltantes)
      .toEqual([{ productoId: 'a', nombre: 'a' }]);
  });
  it('un error sin forma da un mensaje general, nunca revienta', () => {
    for (const e of [undefined, null, 'x', 5, {}]) expect(leerErrorDeConfirmar(e).mensaje).toMatch(/No se pudo confirmar/);
  });
});
