/**
 * LA PANTALLA DE «CONFIRMAR» (B5b): cuándo hay botón y cómo se lee el error del servidor. Pura.
 * El servidor vuelve a negar todo (`confirmar-externo.test.ts`); esto solo evita mostrar de más y perder los faltantes.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { estaConfirmando, leerErrorDeConfirmar, puedeConfirmarse } from '../../../web/src/modulos/pedidos/confirmar.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const PANTALLA = readFileSync(join(aqui, '..', '..', '..', 'web', 'src', 'modulos', 'pedidos', 'Pedidos.tsx'), 'utf8');

describe('el botón «Confirmar»', () => {
  it('NIEGA: no aparece para un pedido propio, ya confirmado, confirmando, cancelado, reemplazado o sin datos', () => {
    for (const p of [
      { catalogo: undefined, estado: 'recibido' }, { catalogo: 'propio', estado: 'recibido' },
      { catalogo: 'externo', estado: 'confirmado' }, { catalogo: 'externo', estado: 'confirmando' },
      { catalogo: 'externo', estado: 'cancelado' }, { catalogo: 'externo', estado: 'reemplazado' }, { catalogo: 'externo' }, {},
    ]) expect(puedeConfirmarse(p, 'admin')).toBe(false);
  });
  it('NIEGA: tampoco para quien no es admin u oper de ESE comercio (ingesta, sin rol, rol inventado)', () => {
    for (const rol of ['ingesta', null, undefined, '', 'propietario', 'ADMIN']) expect(puedeConfirmarse({ catalogo: 'externo', estado: 'recibido' }, rol)).toBe(false);
  });
  it('aparece solo para un pedido externo `recibido` y un admin u oper', () => {
    expect(puedeConfirmarse({ catalogo: 'externo', estado: 'recibido' }, 'admin')).toBe(true);
    expect(puedeConfirmarse({ catalogo: 'externo', estado: 'recibido' }, 'oper')).toBe(true);
  });
  it('un pedido externo `confirmando` se rotula «Confirmando…» y no tiene botón; ningún otro lo muestra', () => {
    expect(estaConfirmando({ catalogo: 'externo', estado: 'confirmando' })).toBe(true);
    for (const p of [{ catalogo: 'propio', estado: 'confirmando' }, { catalogo: 'externo', estado: 'recibido' }, {}]) expect(estaConfirmando(p)).toBe(false);
    expect(PANTALLA).toContain('Confirmando…');
  });
  it('la pantalla envía {tenantId, pedidoId} y el rol sale de la sesión (rolEn), no de un dato del pedido', () => {
    expect(PANTALLA).toContain("httpsCallable(funciones, 'confirmarPedidoExterno')({ tenantId, pedidoId })");
    expect(PANTALLA).toContain('rolEn(permisos, tenantId)');
    expect(PANTALLA).toContain('puedeConfirmarse(p, rol)');
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
