/**
 * LA CLAVE DE LA SESIÓN en el esqueleto de Walisuma: es `messages[0].from`, nunca otro dato. Dos clientes jamás comparten ficha.
 */
import { describe, expect, it } from 'vitest';
import { ANA, BETO, ENTREGA, EXTRANJERO, crear, entrega, hablar, mSticker, mTexto, modelo, panelConQr, valorMeta } from './mundo';

const fichas = (m: ReturnType<typeof crear>): Record<string, any> => (m.sd['walisuma'] ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('ficha por teléfono', () => {
  it('dos teléfonos intercalados no comparten ficha: cada uno tiene la suya, con sus propios ids y turnos', () => {
    const m = crear();
    hablar(m, ANA, mTexto('hola'), { wamid: 'wamid.A1' });
    hablar(m, BETO, mTexto('buenas'), { wamid: 'wamid.B1' });
    hablar(m, ANA, mTexto('otra cosa'), { wamid: 'wamid.A2' });
    hablar(m, BETO, mSticker(), { wamid: 'wamid.B2' });
    const f = fichas(m);
    expect(Object.keys(f).sort()).toEqual([ANA, BETO].sort());
    expect(f[ANA].ultimosIds).toEqual(['wamid.A1', 'wamid.A2']);
    expect(f[BETO].ultimosIds).toEqual(['wamid.B1', 'wamid.B2']);
    expect(f[ANA].turnos).toBe(2);
    expect(f[BETO].turnos).toBe(2);
    // Cada uno recibió su propia presentación.
    expect(f[BETO].saludado).toBe(true);
    expect(f[ANA].saludado).toBe(true);
  });
  it('la clave es `messages[0].from`: ni el wa_id del contacto ni el cuerpo la reemplazan', () => {
    const m = crear();
    hablar(m, ANA, mTexto(`soy ${BETO}`), { contacto: BETO });
    expect(Object.keys(fichas(m))).toEqual([ANA]);
  });
  it('NEGADO: un `from` que no son 6 a 20 dígitos (o que toca el prototipo) se descarta sin ficha y sin respuesta', () => {
    for (const malo of ['__proto__', 'constructor', '59100000011; drop', '12345', '']) {
      const m = crear();
      const t = m.turno(entrega(valorMeta(mTexto('hola'), malo)));
      expect(t.mensajes).toHaveLength(0);
      expect(Object.keys(fichas(m))).toEqual([]);
      expect(({} as Record<string, unknown>)['ultimosIds']).toBeUndefined();
    }
  });
  it('un turno que no sale (bloqueado) igual deja la ficha de ESE teléfono con el id visto, y no toca la de otro', () => {
    const m = crear({ ingesta: { atencion: { estado: 'bloqueado' } } });
    hablar(m, ANA, mTexto('hola'), { wamid: 'wamid.A9' });
    expect(fichas(m)[ANA].ultimosIds).toEqual(['wamid.A9']);
    expect(fichas(m)[BETO]).toBeUndefined();
  });
});

describe('«Resumen del turno» devuelve a la ficha lo que no salió (reversión genérica)', () => {
  it('si Meta rechaza el envío y su respaldo, `fueraDePaisMs` vuelve a 0 y el siguiente mensaje del número de otro país sí recibe el texto', () => {
    const m = crear({ envio: { 'Enviar a WhatsApp': 'error', 'Enviar respaldo': 'error' } });
    const t = hablar(m, EXTRANJERO, mTexto('hello'), { toleraFallo: true });
    expect(t.fallo?.mensaje ?? '').toMatch(/Entrega fallida/);
    expect(fichas(m)[EXTRANJERO].fueraDePaisMs).toBe(0);
  });
  it('si el envío salió, `fueraDePaisMs` queda marcado y no se repite el texto en 24 horas', () => {
    const m = crear();
    hablar(m, EXTRANJERO, mTexto('hello'));
    expect(fichas(m)[EXTRANJERO].fueraDePaisMs).toBeGreaterThan(0);
  });
});

describe('el carrito, la ficha y el QR no se comparten entre teléfonos', () => {
  const ultimo = (ll: { cuerpo?: Record<string, any> }): string => { const c = (ll.cuerpo?.['contents'] ?? []) as { parts: { text: string }[] }[]; return c[c.length - 1]?.parts[0]?.text ?? ''; }; // eslint-disable-line @typescript-eslint/no-explicit-any
  it('dos teléfonos intercalados: cada uno con su carrito, su entrega y su QR; el QR de uno no abre ni cierra el del otro', () => {
    const m = crear({ modeloDice: (ll) => modelo('Con gusto.', { lineas: [{ id: /ana/.test(ultimo(ll)) ? 'billetera-cuero' : 'bufanda-vicuna', cantidad: 1 }], entrega: { ...ENTREGA, nombre: /ana/.test(ultimo(ll)) ? 'Ana' : 'Beto' } }) });
    hablar(m, ANA, mTexto('soy ana, una pieza'));
    hablar(m, BETO, mTexto('soy beto, una pieza'));
    const tAna = hablar(m, ANA, mTexto('ana quiere pagar'));
    expect(tAna.mensajes.some((x) => x.tipo === 'image')).toBe(true);
    const f = fichas(m);
    expect(f[ANA].qrHastaMs).toBeGreaterThan(0);
    expect(f[BETO].qrHastaMs).toBe(0);
    expect(f[BETO].pedidos).toBe(0);
    expect(f[ANA].carrito).toEqual([{ id: 'billetera-cuero', cantidad: 1, detalle: '' }]);
    expect(f[BETO].carrito).toEqual([{ id: 'bufanda-vicuna', cantidad: 1, detalle: '' }]);
    expect(f[ANA].entrega.nombre).toBe('Ana');
    expect(f[BETO].entrega.nombre).toBe('Beto');
    // Beto confirma después: su QR es por SU pedido (7.795), no por el de Ana.
    const tBeto = hablar(m, BETO, mTexto('beto quiere pagar'));
    expect(tBeto.llamadas.ingesta.find((x) => x['evento'] === 'qr_enviado')).toMatchObject({ monto: 7795, telefono: BETO });
    expect(tAna.llamadas.ingesta.find((x) => x['evento'] === 'qr_enviado')).toMatchObject({ monto: 450, telefono: ANA });
  });
});

describe('«Resumen del turno»: solo el ítem del QR revierte el cobro', () => {
  it('NEGADO: el texto del resumen falla (sale el respaldo) y el QR SALE: el servidor ya abrió el cobro, así que `qrHastaMs`, `pedidos` y `qrCarrito` NO se revierten', () => {
    const m = crear({ modeloDice: modelo('Con gusto.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }], entrega: ENTREGA }) });
    hablar(m, ANA, mTexto('una billetera'));
    m.dobles['Enviar a WhatsApp'] = (ll) => (ll.cuerpo?.['type'] === 'text' ? { error: { message: '(#131053) error', code: 131053 } } : { messaging_product: 'whatsapp', messages: [{ id: `wamid.OUT${ll.n}` }] });
    const t = hablar(m, ANA, mTexto('quiero pagar'));
    expect(t.mensajes.some((x) => x.tipo === 'image' && x.ok)).toBe(true);
    expect(fichas(m)[ANA].pedidos).toBe(1);
    expect(fichas(m)[ANA].qrHastaMs).toBeGreaterThan(0);
    expect(fichas(m)[ANA].qrCarrito).toHaveLength(1);
  });
});

describe('«Resumen del turno»: si el principal falla y el respaldo sale, el QR no queda abierto', () => {
  it('con un QR abierto, un pedido cambiado cuyo envío principal falla (y el respaldo sale): `qrHastaMs`, `pedidos` y `qrCarrito` vuelven a su valor anterior', () => {
    const m = crear({ modeloDice: (ll) => modelo('Con gusto.', { lineas: [{ id: 'billetera-cuero', cantidad: /mejor dos/.test(String(ll.cuerpo?.['contents']).slice(-120)) ? 2 : 1 }], entrega: ENTREGA }) });
    hablar(m, ANA, mTexto('una billetera'));
    hablar(m, ANA, mTexto('quiero pagar'));
    const antes = JSON.parse(JSON.stringify(fichas(m)[ANA]));
    expect(antes.pedidos).toBe(1);
    expect(antes.qrCarrito).toHaveLength(1);
    m.dobles['Traer configuración'] = () => panelConQr(450);
    m.dobles['Enviar a WhatsApp'] = () => ({ error: { message: '(#131053) Media upload error', code: 131053 } });
    const t = hablar(m, ANA, mTexto('mejor dos, quiero pagar'));
    // El respaldo en texto salió (el cliente recibió respuesta) pero el QR no: nada de QR «abierto» por 15 minutos ni pedido contado.
    expect(t.mensajes.some((x) => x.respaldo && x.ok)).toBe(true);
    const despues = fichas(m)[ANA];
    expect(despues.qrHastaMs).toBe(antes.qrHastaMs);
    expect(despues.pedidos).toBe(antes.pedidos);
    expect(despues.qrCarrito).toEqual(antes.qrCarrito);
  });
});
