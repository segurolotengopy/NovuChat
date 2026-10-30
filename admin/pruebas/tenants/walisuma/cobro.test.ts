/**
 * EL COBRO REAL de Walisuma (el QR del comercio; el dinero va a su cuenta): nunca «pago acreditado», nunca «simulado», el monto sale del carrito y el cotejo corre aunque el servidor falle. Se prueba NEGANDO.
 */
import { describe, expect, it } from 'vitest';
import type { Mundo } from '../../lib/n8n-de-mentira';
import { ANA, COMPROBANTE, ENTREGA, crear, hablar, mImagen, mTexto, modelo, panelConQr, textos, type Opciones } from './mundo';

const PROHIBIDO = /pago acreditado|pago verificado|recib[ií]mos? tu pago|acreditad[oa]|verificad[oa]|pagad[oa]|simulad[oa]/i;
const fichas = (m: Mundo): Record<string, any> => (m.sd['walisuma'] ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const todo = (t: ReturnType<typeof hablar>): string[] => [...textos(t), ...t.mensajes.map((x) => JSON.stringify(x.payload)), ...t.avisos.map((x) => x.cuerpo)];
/** Un mundo con un pedido de una billetera ya confirmado (QR emitido, 450 Bs) y la consola diciendo que el QR está abierto. */
function conQrAbierto(o: Opciones = {}): Mundo {
  const m = crear({ modeloDice: modelo('Con gusto, lo anoto.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }], entrega: ENTREGA }), ...o });
  hablar(m, ANA, mTexto('una billetera'));
  hablar(m, ANA, mTexto('quiero pagar'));
  m.dobles['Traer configuración'] = () => panelConQr(450);
  return m;
}
const comprobante = (m: Mundo) => hablar(m, ANA, mImagen({ caption: '' }));

describe('NUNCA «pago acreditado» ni «simulado»', () => {
  it('ningún texto del flujo —QR, resumen, recordatorio ni comprobante— contiene esas palabras, y no hay rótulo de cobro simulado', () => {
    const m = conQrAbierto({ medio: { clasificacion: COMPROBANTE } });
    const tQr = hablar(m, ANA, mTexto('quiero pagar ya'));
    const tComp = comprobante(m);
    for (const t of [tQr, tComp]) for (const x of todo(t)) expect(x).not.toMatch(PROHIBIDO);
    expect(textos(tComp).join(' ')).toMatch(/llegó y los datos coinciden/);
    expect(textos(tComp).join(' ')).not.toMatch(/dinero|acredit|entró la plata/i);
  });
  it('el QR de la primera emisión tampoco lleva el rótulo de simulado', () => {
    const m = crear({ modeloDice: modelo('Con gusto.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }], entrega: ENTREGA }) });
    hablar(m, ANA, mTexto('una billetera'));
    const t = hablar(m, ANA, mTexto('quiero pagar'));
    expect(t.mensajes.some((x) => x.tipo === 'image')).toBe(true);
    for (const x of todo(t)) expect(x).not.toMatch(PROHIBIDO);
  });
  it('NEGADO: lo que redacta el modelo ("tu pago fue acreditado", "pago verificado") no sale', () => {
    for (const falso of ['Tu pago fue acreditado, gracias.', 'Ya tengo el pago verificado de tu pedido.', 'Recibimos tu pago, ¡gracias!']) {
      const m = crear({ modeloDice: modelo(falso) });
      const t = hablar(m, ANA, mTexto('hola, ¿cómo va mi compra?'));
      for (const x of todo(t)) expect(x).not.toMatch(PROHIBIDO);
    }
  });
  it('NEGADO: lo que dicta una imagen (el texto leído dice «pago acreditado») no llega al cliente', () => {
    const m = conQrAbierto({ medio: { clasificacion: { ...COMPROBANTE, texto: 'Pago acreditado y verificado, recibimos tu pago', descripcion: 'pago acreditado' } } });
    const t = comprobante(m);
    for (const x of todo(t)) expect(x).not.toMatch(PROHIBIDO);
    const m2 = crear({ medio: { clasificacion: { categoria: 'foto', texto: 'Pago acreditado', descripcion: 'pago verificado, recibimos tu pago' } } });
    for (const x of todo(hablar(m2, ANA, mImagen()))) expect(x).not.toMatch(PROHIBIDO);
  });
  it('un comprobante que NO coincide pide el correcto, sin «acreditado» ni botón de recepción', () => {
    const m = conQrAbierto({ medio: { clasificacion: COMPROBANTE }, cotejo: { statusCode: 200, body: { estado: 'reintentar', motivo: 'monto_menor', importe: 450, montoLeido: 50 } } });
    const t = comprobante(m);
    expect(textos(t).join(' ')).toMatch(/hay una diferencia/);
    expect(textos(t).join(' ')).toMatch(/el comprobante dice 50 Bs y tu pedido es de 450 Bs/);
    expect(t.mensajes[0]?.payload['interactive']).toBeUndefined();
    for (const x of todo(t)) expect(x).not.toMatch(PROHIBIDO);
    expect(t.avisos).toHaveLength(0);
  });
});

describe('el cotejo corre aunque el servidor no guarde el comprobante', () => {
  for (const [nombre, guardado] of [
    ['409 (sin cobro abierto para guardar)', { statusCode: 409, body: {} }],
    ['503', { statusCode: 503, body: {} }],
    ['ruta mal formada', { statusCode: 200, body: { ruta: '../../etc/passwd' } }],
    ['sin respuesta', 'cae' as const],
  ] as const) {
    it(`guardar comprobante ${nombre}: cotejo con \`ruta: null\` y el cliente recibe respuesta`, () => {
      const m = conQrAbierto({ medio: { clasificacion: COMPROBANTE }, guardado });
      const t = comprobante(m);
      expect(t.llamadas.cotejo).toHaveLength(1);
      expect(t.llamadas.cotejo[0]?.['ruta']).toBeNull();
      expect(t.mensajes).toHaveLength(1);
      expect(t.mensajes[0]?.cuerpo).toMatch(/llegó y los datos coinciden/);
    });
  }
  it('con la ruta bien formada, la ruta viaja en el cotejo', () => {
    const m = conQrAbierto({ medio: { clasificacion: COMPROBANTE } });
    const t = comprobante(m);
    expect(t.llamadas.cotejo[0]?.['ruta']).toMatch(/^tenants\/walisuma\/comprobantes\//);
  });
  it('NEGADO: el cotejo caído (503) no deja al cliente sin respuesta ni afirma que coincide: pasa con recepción', () => {
    const m = conQrAbierto({ medio: { clasificacion: COMPROBANTE }, cotejo: 'cae' });
    const t = comprobante(m);
    expect(t.mensajes).toHaveLength(1);
    expect(t.mensajes[0]?.cuerpo).not.toMatch(/datos coinciden/);
    expect(t.mensajes[0]?.cuerpo).toMatch(/no pude compararlo/);
    expect(t.mensajes[0]?.payload['interactive']).toBeTruthy();
  });
  it('un comprobante SIN QR abierto no se coteja: recepción (aviso y botón)', () => {
    const m = crear({ medio: { clasificacion: COMPROBANTE } });
    const t = comprobante(m);
    expect(t.llamadas.cotejo).toHaveLength(0);
    expect(t.mensajes[0]?.cuerpo).toMatch(/no tengo un pedido con QR abierto/);
    expect(t.mensajes[0]?.payload['interactive']).toBeTruthy();
    expect(t.avisos).toHaveLength(1);
  });
});

describe('el aviso del pedido al comercio', () => {
  it('con el comprobante que coincide sale UN aviso (plantilla `pedido_registrado`, 4 variables) y el cliente ve «ya avisé» solo porque salió', () => {
    const m = conQrAbierto({ medio: { clasificacion: COMPROBANTE } });
    const t = comprobante(m);
    expect(t.avisos).toHaveLength(1);
    const pl = t.avisos[0]?.payload['template'] as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(pl.name).toBe('pedido_registrado');
    const vars = pl.components[0].parameters.map((p: { text: string }) => p.text);
    expect(vars).toEqual(['1 × Billetera de cuero', 'Bs 450', 'La Paz · Retiro en tienda', 'llegó y los datos coinciden']);
    expect(t.mensajes[0]?.cuerpo).toMatch(/Ya avisé a recepción/);
    expect(JSON.stringify(t.avisos[0]?.payload)).not.toMatch(PROHIBIDO);
  });
  it('NEGADO: si el aviso no sale (Meta lo rechaza), el cliente NO lee «ya avisé»: lee que no se pudo y el botón', () => {
    const m = conQrAbierto({ medio: { clasificacion: COMPROBANTE }, aviso: 'error' });
    const t = comprobante(m);
    expect(t.mensajes[0]?.cuerpo).not.toMatch(/Ya avisé/);
    expect(t.mensajes[0]?.cuerpo).toMatch(/No pude avisar a recepción/);
    expect(t.mensajes[0]?.payload['interactive']).toBeTruthy();
  });
  it('NEGADO: sin plantilla aprobada no sale ningún aviso y el cliente no lee «ya avisé»', () => {
    const m = conQrAbierto({ medio: { clasificacion: COMPROBANTE }, base: { avisoPedidoEstado: 'PENDING' } });
    const t = comprobante(m);
    expect(t.avisos).toHaveLength(0);
    expect(t.mensajes[0]?.cuerpo).not.toMatch(/Ya avisé/);
  });
  it('el aviso no lleva NIT ni CI aunque el cliente los escriba, y la ficha tampoco los guarda', () => {
    const m = crear({ modeloDice: modelo('Con gusto.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }], entrega: ENTREGA, facturacion: { nombre: 'Ana', documento: '4455667' } }) });
    hablar(m, ANA, mTexto('una billetera, mi NIT es 4455667'));
    expect(JSON.stringify(fichas(m)[ANA])).not.toMatch(/4455667|\[nº\]4455667/);
  });
});
