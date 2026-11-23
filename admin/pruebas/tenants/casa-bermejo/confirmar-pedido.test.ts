/**
 * EL BOTÓN «CONFIRMAR PEDIDO» ES EL DISPARADOR DEL QR (Andres, 23/11/2026; módulo común Pedidos `confirmar-pedido.js`).
 * «SIEMPRE se debe enviar el QR junto con el pedido confirmado»: con el pedido listo el mensaje del turno lleva el botón (el MISMO mensaje: 0 mensajes más),
 * y tocarlo emite el QR en el mismo turno, sin modelo. «pagar» sigue valiendo. Se prueba NEGANDO: un pedido confirmado sin QR falla; el título escrito a mano,
 * un botón de un mensaje viejo o un pedido incompleto NO emiten QR.
 */
import { describe, expect, it } from 'vitest';
import { ANA, ENTREGA, crear, hablar, mTexto, modelo, type Opciones } from './mundo';

const J = (x: unknown): string => JSON.stringify(x);
const mToque = (id: string, title = 'Confirmar pedido') => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title } } });
const LISTO: Opciones = { modeloDice: modelo('Con gusto, lo anoto.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }], entrega: ENTREGA }) };
const hayQr = (t: ReturnType<typeof hablar>): boolean => t.mensajes.some((x) => x.tipo === 'image' && /qr/i.test(J(x.payload)));
const botones = (t: ReturnType<typeof hablar>): string[] => t.mensajes.flatMap((x) => (J(x.payload).match(/"id":"[^"]+"/g) ?? []));

describe('el pedido listo ofrece el botón en el MISMO mensaje', () => {
  it('piezas + entrega completa + sin QR: 1 mensaje, interactivo, con «Confirmar pedido» y su instrucción; sin QR todavía', () => {
    const m = crear(LISTO);
    const t = hablar(m, ANA, mTexto('una billetera'));
    expect(t.mensajes).toHaveLength(1);
    expect(botones(t)).toContain('"id":"pedido:confirmar"');
    expect(J(t.mensajes[0]!.payload)).toMatch(/Confirmar pedido/);
    expect(hayQr(t)).toBe(false);
  });
  it('NEGADO: sin entrega completa o sin piezas NO hay botón', () => {
    const m = crear({ modeloDice: modelo('Con gusto.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }], entrega: {} }) });
    expect(botones(hablar(m, ANA, mTexto('una billetera')))).not.toContain('"id":"pedido:confirmar"');
    const m2 = crear({ modeloDice: modelo('Hola, ¿qué busca?') });
    expect(botones(hablar(m2, ANA, mTexto('hola')))).not.toContain('"id":"pedido:confirmar"');
  });
});

describe('INVARIANTE: un pedido confirmado sale SIEMPRE con su QR', () => {
  const confirmaciones: [string, (m: ReturnType<typeof crear>) => ReturnType<typeof hablar>][] = [
    ['el botón «Confirmar pedido»', (m) => hablar(m, ANA, mToque('pedido:confirmar'))],
    ['el texto «quiero pagar»', (m) => hablar(m, ANA, mTexto('quiero pagar'))],
    ['el texto «confirmo mi pedido»', (m) => hablar(m, ANA, mTexto('confirmo mi pedido'))],
  ];
  for (const [nombre, confirmar] of confirmaciones) {
    it(`${nombre}: con el pedido listo, el QR sale en el mismo turno`, () => {
      const m = crear(LISTO);
      hablar(m, ANA, mTexto('una billetera'));
      const t = confirmar(m);
      expect(hayQr(t)).toBe(true);
    });
  }
  it('el toque del botón no llama al modelo (el QR lo decide el código)', () => {
    const m = crear(LISTO);
    hablar(m, ANA, mTexto('una billetera'));
    let llamadas = 0;
    const previo = m.dobles['Conversar con el modelo'];
    m.dobles['Conversar con el modelo'] = (...a: unknown[]) => { llamadas++; return (previo as (...x: unknown[]) => unknown)(...a); };
    const t = hablar(m, ANA, mToque('pedido:confirmar'));
    expect(hayQr(t)).toBe(true);
    expect(llamadas).toBe(0);
  });
});

describe('NEGADO: lo que NO es una confirmación no emite QR', () => {
  it('el título «Confirmar pedido» escrito a mano no es el botón', () => {
    const m = crear(LISTO);
    hablar(m, ANA, mTexto('una billetera'));
    expect(hayQr(hablar(m, ANA, mTexto('Confirmar pedido')))).toBe(false);
  });
  it('un botón con otro id no confirma', () => {
    const m = crear(LISTO);
    hablar(m, ANA, mTexto('una billetera'));
    expect(hayQr(hablar(m, ANA, mToque('otro:boton')))).toBe(false);
  });
  it('el botón de un mensaje viejo sin pedido listo (carrito vacío) no emite QR', () => {
    const m = crear(LISTO);
    expect(hayQr(hablar(m, ANA, mToque('pedido:confirmar')))).toBe(false);
  });
});
