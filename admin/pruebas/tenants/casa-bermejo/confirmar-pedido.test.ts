/**
 * EL BOTÓN «CONFIRMAR PEDIDO» ES EL DISPARADOR DEL QR (Andres, 23/11/2026; módulo común Pedidos `confirmar-pedido.js`).
 * «SIEMPRE se debe enviar el QR junto con el pedido confirmado»: con el pedido listo el mensaje del turno lleva el botón (el MISMO mensaje: 0 mensajes más),
 * y tocarlo emite el QR en el mismo turno, sin modelo. «pagar» sigue valiendo. Se prueba NEGANDO: un pedido confirmado sin QR falla; el título escrito a mano,
 * un botón de un mensaje viejo o un pedido incompleto NO emiten QR.
 */
import { describe, expect, it } from 'vitest';
import { ANA, CATALOGO, ENTREGA, catalogoOk, crear, hablar, mTexto, modelo, panelConQr, type Opciones } from './mundo';

const J = (x: unknown): string => JSON.stringify(x);
const mToque = (id: string, title = 'Confirmar pedido') => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title } } });
const LISTO: Opciones = { modeloDice: modelo('Con gusto, lo anoto.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }], entrega: ENTREGA }) };
const hayQr = (t: ReturnType<typeof hablar>): boolean => t.mensajes.some((x) => x.tipo === 'image' && /qr/i.test(J(x.payload)));
const botones = (t: ReturnType<typeof hablar>): string[] => t.mensajes.flatMap((x) => (J(x.payload).match(/"id":"[^"]+"/g) ?? []));
/** El id del botón que el cliente vio en el mensaje (lleva la huella de su carrito). */
const idDelBoton = (t: ReturnType<typeof hablar>): string => /"id":"(pedido:confirmar:[a-z0-9]+)"/.exec(t.mensajes.map((x) => J(x.payload)).join(' '))?.[1] ?? 'pedido:confirmar:sin-boton';

describe('el pedido listo ofrece el botón en el MISMO mensaje', () => {
  it('piezas + entrega completa + sin QR: 1 mensaje, interactivo, con «Confirmar pedido» y su instrucción; sin QR todavía', () => {
    const m = crear(LISTO);
    const t = hablar(m, ANA, mTexto('una billetera'));
    expect(t.mensajes).toHaveLength(1);
    expect(idDelBoton(t)).toMatch(/^pedido:confirmar:[a-z0-9]+$/);
    expect(J(t.mensajes[0]!.payload)).toMatch(/Confirmar pedido/);
    expect(hayQr(t)).toBe(false);
  });
  it('NEGADO: sin entrega completa o sin piezas NO hay botón', () => {
    const m = crear({ modeloDice: modelo('Con gusto.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }], entrega: {} }) });
    expect(idDelBoton(hablar(m, ANA, mTexto('una billetera')))).toBe('pedido:confirmar:sin-boton');
    const m2 = crear({ modeloDice: modelo('Hola, ¿qué busca?') });
    expect(idDelBoton(hablar(m2, ANA, mTexto('hola')))).toBe('pedido:confirmar:sin-boton');
  });
});

describe('INVARIANTE: un pedido confirmado sale SIEMPRE con su QR', () => {
  const confirmaciones: [string, (m: ReturnType<typeof crear>, id: string) => ReturnType<typeof hablar>][] = [
    ['el botón «Confirmar pedido»', (m, id) => hablar(m, ANA, mToque(id))],
    ['el texto «quiero pagar»', (m) => hablar(m, ANA, mTexto('quiero pagar'))],
    ['el texto «confirmo mi pedido»', (m) => hablar(m, ANA, mTexto('confirmo mi pedido'))],
  ];
  for (const [nombre, confirmar] of confirmaciones) {
    it(`${nombre}: con el pedido listo, el QR sale en el mismo turno`, () => {
      const m = crear(LISTO);
      const id = idDelBoton(hablar(m, ANA, mTexto('una billetera')));
      const t = confirmar(m, id);
      expect(hayQr(t)).toBe(true);
    });
  }
  it('el toque del botón no llama al modelo (el QR lo decide el código)', () => {
    const m = crear(LISTO);
    const id = idDelBoton(hablar(m, ANA, mTexto('una billetera')));
    let llamadas = 0;
    const previo = m.dobles['Conversar con el modelo'];
    m.dobles['Conversar con el modelo'] = (...a: unknown[]) => { llamadas++; return (previo as (...x: unknown[]) => unknown)(...a); };
    const t = hablar(m, ANA, mToque(id));
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
    expect(hayQr(hablar(m, ANA, mToque('pedido:confirmar:abc')))).toBe(false);
  });
});

describe('NEGADO: el botón de un mensaje con OTRO carrito no confirma, y un segundo toque no repite el QR', () => {
  it('el id de un carrito de 1 pieza no cierra un carrito de 2 (el botón viejo confirma lo que el cliente vio, no lo de ahora)', () => {
    const m = crear(LISTO);
    const id = idDelBoton(hablar(m, ANA, mTexto('una billetera')));
    m.sd['casabermejo'] = JSON.parse(J(m.sd['casabermejo']).replace(/"cantidad":1/g, '"cantidad":2'));
    expect(hayQr(hablar(m, ANA, mToque(id)))).toBe(false);
  });
  it('un segundo toque (el QR sigue abierto) no emite otro QR', () => {
    const m = crear(LISTO);
    const id = idDelBoton(hablar(m, ANA, mTexto('una billetera')));
    expect(hayQr(hablar(m, ANA, mToque(id)))).toBe(true);
    m.dobles['Traer configuración'] = () => panelConQr(450);
    expect(hayQr(hablar(m, ANA, mToque(id)))).toBe(false);
  });
});

describe('el texto y el botón dicen lo mismo (solo se ofrece lo que se cumple)', () => {
  const cuerpo = (t: ReturnType<typeof hablar>): string => t.mensajes.map((x) => x.cuerpo).join('\n');
  it('la instrucción de «Confirmar pedido» sale UNA sola vez y en un solo trato, también cuando el texto lo arma el código (pieza por orden)', () => {
    const m = crear({ modeloDice: modelo('Con gusto.', { lineas: [], entrega: ENTREGA }) });
    const t = hablar(m, ANA, mTexto('agrega una billetera de cuero'));
    const c = cuerpo(t);
    expect((c.match(/Confirmar pedido/g) ?? []).length).toBeLessThanOrEqual(1);
    expect(/toque «/i.test(c) && /toca «/i.test(c)).toBe(false);
  });
  it('NEGADO: con un QR abierto el texto NO manda tocar un botón que no sale', () => {
    const m = crear(LISTO);
    const id = idDelBoton(hablar(m, ANA, mTexto('una billetera')));
    hablar(m, ANA, mToque(id));
    m.dobles['Traer configuración'] = () => panelConQr(450);
    const t = hablar(m, ANA, mTexto('gracias'));
    expect(cuerpo(t)).not.toMatch(/Confirmar pedido/);
    expect(botones(t).some((b) => b.includes('pedido:confirmar'))).toBe(false);
  });
});

describe('NEGADO: si el catálogo cambió entre el resumen y el toque, el botón NO cierra otro pedido', () => {
  it('una pieza que se agotó: el toque no emite el QR del pedido más chico', () => {
    const m = crear({ modeloDice: modelo('Con gusto.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }, { id: 'llavero-llama', cantidad: 1 }], entrega: ENTREGA }) });
    const id = idDelBoton(hablar(m, ANA, mTexto('una billetera y un llavero')));
    // La billetera se agota (stock 0, no disponible): el resto del catálogo sigue igual.
    const items = CATALOGO.filter((c) => c.activo && typeof (c as Record<string, unknown>)['precio'] === 'number').map((c) => ({ ...c, precioCentavos: Math.round(((c as Record<string, unknown>)['precio'] as number) * 100), stock: c.id === 'billetera-cuero' ? 0 : 10, disponible: c.id !== 'billetera-cuero' }));
    m.dobles['Traer catálogo'] = () => catalogoOk({}, items as never);
    const t = hablar(m, ANA, mToque(id));
    expect(hayQr(t)).toBe(false);
    // El cliente ve QUÉ cambió: el pedido de ahora (solo el llavero) y el aviso, con un botón NUEVO; no un «¿confirma?» a ciegas.
    const c = t.mensajes.map((x) => x.cuerpo).join('\n');
    expect(c).toMatch(/pedido anterior/);
    expect(c).toMatch(/Llavero de llama/);
    expect(c).not.toMatch(/Billetera de cuero/);
    expect(idDelBoton(t)).toMatch(/^pedido:confirmar:[a-z0-9]+$/);
    expect(idDelBoton(t)).not.toBe(id);
  });
  it('un cambio de PRECIO tampoco se confirma a ciegas: el toque no emite el QR y muestra el precio nuevo', () => {
    const m = crear(LISTO);
    const id = idDelBoton(hablar(m, ANA, mTexto('una billetera')));
    const items = CATALOGO.filter((c) => c.activo && typeof (c as Record<string, unknown>)['precio'] === 'number').map((c) => ({ ...c, precio: c.id === 'billetera-cuero' ? 900 : (c as Record<string, unknown>)['precio'], precioCentavos: c.id === 'billetera-cuero' ? 90000 : Math.round(((c as Record<string, unknown>)['precio'] as number) * 100), stock: 10, disponible: true }));
    m.dobles['Traer catálogo'] = () => catalogoOk({}, items as never);
    const t = hablar(m, ANA, mToque(id));
    expect(hayQr(t)).toBe(false);
    const c = t.mensajes.map((x) => x.cuerpo).join('\n');
    expect(c).toMatch(/900/);
    expect(c).toMatch(/pedido anterior/);
    expect(c).not.toMatch(/\bDesea\b|\bsu pedido\b/);   // un solo trato (tuteo): no se mezcla con el usted
    // El botón NUEVO (con el precio nuevo) sí emite el QR, por el monto nuevo.
    const nuevo = idDelBoton(t);
    expect(nuevo).not.toBe(id);
    const t2 = hablar(m, ANA, mToque(nuevo));
    expect(hayQr(t2)).toBe(true);
    expect(JSON.stringify(t2.mensajes.map((x) => x.payload))).toMatch(/900/);
  });
  it('una pieza agotada que deja el pedido VACÍO: el cliente lo sabe (no un «no encuentro eso en el catálogo»)', () => {
    const m = crear(LISTO);
    const id = idDelBoton(hablar(m, ANA, mTexto('una billetera')));
    const items = CATALOGO.filter((c) => c.activo && typeof (c as Record<string, unknown>)['precio'] === 'number').map((c) => ({ ...c, precioCentavos: Math.round(((c as Record<string, unknown>)['precio'] as number) * 100), stock: c.id === 'billetera-cuero' ? 0 : 10, disponible: c.id !== 'billetera-cuero' }));
    m.dobles['Traer catálogo'] = () => catalogoOk({}, items as never);
    const t = hablar(m, ANA, mToque(id));
    expect(hayQr(t)).toBe(false);
    expect(t.mensajes.map((x) => x.cuerpo).join('\n')).toMatch(/ya no están disponibles/);
  });
  it('el botón de un pedido anterior (carrito vacío: cerrado, vaciado por el cliente o vencido) no cierra otro: texto neutro, sin QR ni pedido nuevo y sin afirmar que se registró algo', () => {
    const m = crear(LISTO);
    const id = idDelBoton(hablar(m, ANA, mTexto('una billetera')));
    m.sd['casabermejo'] = JSON.parse(J(m.sd['casabermejo']).replace(/"carrito":\[[^\]]*\]/, '"carrito":[]'));
    const t = hablar(m, ANA, mToque(id));
    expect(hayQr(t)).toBe(false);
    expect(t.mensajes.map((x) => x.cuerpo).join('\n')).toMatch(/pedido anterior que ya no está en curso/);
  });
});

