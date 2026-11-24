/**
 * COMPROBANTE QUE NO COINCIDE (Andres, 24/11/2026, D3-a): se nombran TODAS las diferencias (el destinatario primero, luego el monto y la fecha) y el caso PASA A RECEPCIÓN (aviso + botón), SIN pedir otro comprobante.
 * Mensajes por conversación: igual que antes para el cliente (1 respuesta al comprobante) y +1 aviso a recepción por comprobante con diferencias (hoy 0), a lo más uno cada 30 minutos. Se prueba NEGANDO.
 */
import { describe, expect, it } from 'vitest';
import type { Mundo } from '../../lib/n8n-de-mentira';
import { ANA, COMPROBANTE, ENTREGA, crear, hablar, mImagen, mTexto, modelo, panelConQr, textos, type Opciones } from './mundo';

const PROHIBIDO = /pago acreditado|pago verificado|recib[ií]mos? tu pago|acreditad[oa]|verificad[oa]|pagad[oa]|simulad[oa]/i;
const fichas = (m: Mundo): Record<string, any> => (m.sd['casabermejo'] ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const todo = (t: ReturnType<typeof hablar>): string[] => [...textos(t), ...t.mensajes.map((x) => JSON.stringify(x.payload)), ...t.avisos.map((x) => x.cuerpo)];
function conQrAbierto(o: Opciones = {}): Mundo {
  const m = crear({ modeloDice: modelo('Con gusto, lo anoto.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }], entrega: ENTREGA }), ...o });
  hablar(m, ANA, mTexto('una billetera'));
  hablar(m, ANA, mTexto('quiero pagar'));
  m.dobles['Traer configuración'] = () => panelConQr(450);
  return m;
}
const comprobante = (m: Mundo) => hablar(m, ANA, mImagen({ caption: '' }));
const TRES = { statusCode: 200, body: { estado: 'reintentar', motivo: 'monto_menor', motivos: ['fecha_anterior', 'monto_menor', 'cuenta_distinta'], importe: 450, montoLeido: 50 } };
const UNA = { statusCode: 200, body: { estado: 'reintentar', motivo: 'monto_menor', importe: 450, montoLeido: 50 } };

describe('tres motivos producen tres frases, con el destinatario primero', () => {
  it('el texto al cliente nombra la cuenta, luego el monto y luego la fecha; no una sola', () => {
    const t = comprobante(conQrAbierto({ medio: { clasificacion: COMPROBANTE }, cotejo: TRES }));
    const c = textos(t).join(' ');
    const iCuenta = c.indexOf('la cuenta de destino no es la del QR');
    const iMonto = c.indexOf('el comprobante dice 50 Bs y tu pedido es de 450 Bs');
    const iFecha = c.indexOf('la fecha del comprobante es anterior a tu pedido');
    expect(iCuenta).toBeGreaterThanOrEqual(0);
    expect(iMonto).toBeGreaterThan(iCuenta);
    expect(iFecha).toBeGreaterThan(iMonto);
    expect(c).toMatch(/Veo estas diferencias con tu pedido/);
    for (const x of todo(t)) expect(x).not.toMatch(PROHIBIDO);
  });
  it('NEGADO: no es la sola primera diferencia (con una sola, dice «una diferencia»)', () => {
    const c = textos(comprobante(conQrAbierto({ medio: { clasificacion: COMPROBANTE }, cotejo: UNA }))).join(' ');
    expect(c).toMatch(/Veo una diferencia con tu pedido: el comprobante dice 50 Bs y tu pedido es de 450 Bs/);
    expect(c).not.toMatch(/estas diferencias/);
  });
});

describe('pasa a recepción y NO pide otro comprobante', () => {
  it('1 mensaje al cliente con el botón de recepción + 1 aviso a recepción «llegó; NO coinciden, revisar»; sin «correcto» ni «otro comprobante»', () => {
    const m = conQrAbierto({ medio: { clasificacion: COMPROBANTE }, cotejo: TRES });
    const t = comprobante(m);
    expect(t.mensajes).toHaveLength(1);
    expect(JSON.stringify(t.mensajes[0]?.payload)).toContain('wa.me');
    expect(t.avisos).toHaveLength(1);
    expect(JSON.stringify(t.avisos[0]?.payload)).toMatch(/NO coinciden, revisar/);
    expect(textos(t).join(' ')).toMatch(/Ya lo pasé a recepción para que lo revise; también puedes escribirle con el botón\./);
    expect(textos(t).join(' ')).not.toMatch(/comprobante correcto|otro comprobante|env[ií]ame/i);
  });
  it('NEGADO: si el aviso a recepción NO sale, no dice que lo pasó: «No pude avisar a recepción; escríbele directo con el botón»', () => {
    const t = comprobante(conQrAbierto({ medio: { clasificacion: COMPROBANTE }, cotejo: TRES, aviso: 'error' }));
    expect(textos(t).join(' ')).toMatch(/No pude avisar a recepción; escríbele directo con el botón/);
    expect(textos(t).join(' ')).not.toMatch(/Ya lo pasé/);
  });
  it('el cobro NO se cierra: el cliente puede pagar bien y mandar el correcto (la ficha conserva el pedido y el QR)', () => {
    const m = conQrAbierto({ medio: { clasificacion: COMPROBANTE }, cotejo: TRES });
    comprobante(m);
    const f = fichas(m)[ANA];
    expect(f.carrito.length).toBeGreaterThan(0);
    expect(f.qrHastaMs).toBeGreaterThan(0);
    expect(f.comprobanteMs).toBe(0);
  });
  it('guarda de 30 minutos: un segundo comprobante que no coincide, dentro de la ventana, NO manda otro aviso (el cliente sí recibe su respuesta, 1 mensaje)', () => {
    const m = conQrAbierto({ medio: { clasificacion: COMPROBANTE }, cotejo: TRES });
    const t1 = comprobante(m);
    const t2 = comprobante(m);
    expect(t1.avisos).toHaveLength(1);
    expect(t2.avisos).toHaveLength(0);
    expect(t2.mensajes).toHaveLength(1);
    expect(textos(t2).join(' ')).toMatch(/Recepción ya recibió mi aviso anterior/);
  });
  it('NEGADO: si el primer aviso NO salió, el segundo comprobante sí lo intenta (la guarda solo se anota con un envío real)', () => {
    const m = conQrAbierto({ medio: { clasificacion: COMPROBANTE }, cotejo: TRES, aviso: 'error' });
    comprobante(m);
    expect(fichas(m)[ANA].avisoNoCuadraMs).toBe(0);
  });
});

describe('lo que NO cambia', () => {
  it('«ilegible» sigue pidiendo una foto más nítida, sin avisar a recepción', () => {
    const t = comprobante(conQrAbierto({ medio: { clasificacion: COMPROBANTE }, cotejo: { statusCode: 200, body: { estado: 'reintentar', motivo: 'ilegible', importe: 450 } } }));
    expect(textos(t).join(' ')).toMatch(/más nítida/);
    expect(t.avisos).toHaveLength(0);
  });
  it('un comprobante que cuadra sigue igual: «llegó y los datos coinciden», 1 mensaje, 1 aviso', () => {
    const t = comprobante(conQrAbierto({ medio: { clasificacion: COMPROBANTE } }));
    expect(textos(t).join(' ')).toMatch(/llegó y los datos coinciden/);
    expect(t.mensajes).toHaveLength(1);
    expect(t.avisos).toHaveLength(1);
  });
});
