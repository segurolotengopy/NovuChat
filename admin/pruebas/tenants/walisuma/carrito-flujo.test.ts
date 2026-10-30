/**
 * EL CARRITO EN EL FLUJO DE WALISUMA, con el n8n de mentira: el modelo propone, el CÓDIGO valida contra el catálogo y calcula. Se prueba NEGANDO.
 */
import { describe, expect, it } from 'vitest';
import { ANA, BETO, CATALOGO, ENTREGA, MEDIA_QR, crear, hablar, mTexto, modelo, panelConQr, panelOk, textos } from './mundo';

const BIL = 'billetera-cuero'; // Bs 450
const BUF = 'bufanda-vicuna'; // Bs 7.795
const fichas = (m: ReturnType<typeof crear>): Record<string, any> => (m.sd['walisuma'] ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
/** Lo último que escribió el cliente (la última entrada de `contents` de la llamada al modelo). */
const ultimo = (ll: { cuerpo?: Record<string, any> }): string => { const c = (ll.cuerpo?.['contents'] ?? []) as { parts: { text: string }[] }[]; return c[c.length - 1]?.parts[0]?.text ?? ''; }; // eslint-disable-line @typescript-eslint/no-explicit-any
const pide = (lineas: unknown[], extra: Record<string, unknown> = {}) => modelo('Con gusto, lo anoto.', { lineas, ...extra });

describe('lo que propone el modelo se valida contra el catálogo', () => {
  it('un id que no existe no genera línea ni resumen', () => {
    const m = crear({ modeloDice: pide([{ id: 'pieza-inventada', cantidad: 3 }]) });
    const t = hablar(m, ANA, mTexto('quiero una pieza'));
    expect(fichas(m)[ANA].carrito).toEqual([]);
    expect(textos(t).join(' ')).not.toMatch(/Total:/);
  });
  it('NEGADO: precio, total, subtotal y descuento del modelo se ignoran; el resumen sale con el precio del catálogo', () => {
    const m = crear({ modeloDice: pide([{ id: BIL, cantidad: 2, precio: 1, total: 1, subtotal: 1, descuento: 99, precioCentavos: 1 }], { total: 1, descuento: 50 }) });
    const t = hablar(m, ANA, mTexto('dos billeteras'));
    const cuerpo = textos(t).join('\n');
    expect(cuerpo).toMatch(/2 × Billetera de cuero — Bs 900/);
    expect(cuerpo).toMatch(/Total: Bs 900/);
    expect(cuerpo).not.toMatch(/Bs 1\b|descuento/i);
  });
  it('NEGADO: un ítem apagado (licor) o sin precio (tapiz) es invendible aunque el modelo lo pida', () => {
    const m = crear({ modeloDice: pide([{ id: 'licor-de-coca', cantidad: 1 }, { id: 'tapiz-mujer-rio', cantidad: 1 }]) });
    hablar(m, ANA, mTexto('quiero algo de la tienda'));
    expect(fichas(m)[ANA].carrito).toEqual([]);
  });
  it('más de 30 líneas distintas y más de 50 unidades por producto se recortan', () => {
    const muchas = Array.from({ length: 40 }, (_, i) => ({ id: `pieza-${i + 1}`, nombre: `Pieza ${i + 1}`, area: 'Prueba', precio: 10 + i, moneda: 'BOB', activo: true }));
    const m = crear({ panel: panelOk({ catalogo: muchas }), modeloDice: pide([...muchas.map((x) => ({ id: x.id, cantidad: 1 })), { id: 'pieza-1', cantidad: 999 }]) });
    hablar(m, ANA, mTexto('quiero muchas piezas'));
    const car = fichas(m)[ANA].carrito as { id: string; cantidad: number }[];
    expect(car.length).toBeLessThanOrEqual(30);
    expect(car.find((l) => l.id === 'pieza-1')?.cantidad).toBe(50);
    const m2 = crear({ modeloDice: pide([{ id: BIL, cantidad: 500 }]) });
    hablar(m2, ANA, mTexto('quiero muchísimas'));
    expect(fichas(m2)[ANA].carrito[0].cantidad).toBe(50);
  });
  it('NEGADO: el modelo no puede decir un total ni un importe inventado: el texto cae al fijo', () => {
    const m = crear({ modeloDice: modelo('Son Bs 1 en total, un precio especial.', { lineas: [{ id: BIL, cantidad: 1 }] }) });
    const t = hablar(m, ANA, mTexto('una billetera'));
    expect(textos(t).join(' ')).not.toMatch(/Bs 1 en total|precio especial/);
    expect(textos(t)[0]).toMatch(/Cuéntame un poco más/);
  });
  it('el modelo puede citar el precio de una pieza tal como figura en el catálogo', () => {
    const m = crear({ modeloDice: modelo('La billetera de cuero cuesta Bs 450. ¿Cuántas te gustaría?') });
    expect(textos(hablar(m, ANA, mTexto('¿cuánto cuesta la billetera?'))).join(' ')).toMatch(/cuesta Bs 450/);
  });
});

describe('del pedido al QR', () => {
  const confirmar = (m: ReturnType<typeof crear>, tel = ANA) => {
    hablar(m, tel, mTexto('quiero una billetera'));
    return hablar(m, tel, mTexto('quiero pagar'));
  };
  it('con el pedido y los datos de entrega, la confirmación emite el resumen y el QR del comercio por id de medio, con el monto del carrito', () => {
    const m = crear({ modeloDice: pide([{ id: BIL, cantidad: 2 }], { entrega: ENTREGA }) });
    const t = confirmar(m);
    expect(t.mensajes).toHaveLength(2);
    expect(t.mensajes[0]?.cuerpo).toMatch(/2 × Billetera de cuero — Bs 900/);
    expect(t.mensajes[0]?.cuerpo).toMatch(/Total: Bs 900/);
    expect(t.mensajes[0]?.cuerpo).toMatch(/no incluye el costo de entrega/);
    expect(t.mensajes[1]?.tipo).toBe('image');
    expect((t.mensajes[1]?.payload['image'] as any).id).toBe(MEDIA_QR); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(JSON.stringify(t.mensajes[1]?.payload)).not.toMatch(/"link"/);
    const rep = t.llamadas.ingesta.find((x) => x['evento'] === 'qr_enviado');
    expect(rep).toMatchObject({ evento: 'qr_enviado', reglaCobro: 2, monto: 900 });
    expect(fichas(m)[ANA].qrHastaMs).toBeGreaterThan(m.ahora());
    expect(fichas(m)[ANA].pedidos).toBe(1);
  });
  it('sin la confirmación o sin la entrega completa NO hay QR', () => {
    const sinEntrega = crear({ modeloDice: pide([{ id: BIL, cantidad: 1 }]) });
    const t1 = confirmar(sinEntrega);
    expect(t1.mensajes.every((x) => x.tipo !== 'image')).toBe(true);
    const sinConfirmar = crear({ modeloDice: pide([{ id: BIL, cantidad: 1 }], { entrega: ENTREGA }) });
    const t2 = hablar(sinConfirmar, ANA, mTexto('quiero una billetera'));
    expect(t2.mensajes.every((x) => x.tipo !== 'image')).toBe(true);
  });
  it('NEGADO: el monto del QR sale del carrito, jamás del modelo ni del cliente', () => {
    const m = crear({ modeloDice: pide([{ id: BIL, cantidad: 1, precio: 1 }], { entrega: ENTREGA, monto: 1, total: 1 }) });
    const t = confirmar(m);
    expect(t.llamadas.ingesta.find((x) => x['evento'] === 'qr_enviado')).toMatchObject({ monto: 450 });
    const m2 = crear({ modeloDice: pide([{ id: BIL, cantidad: 1 }], { entrega: ENTREGA }) });
    hablar(m2, ANA, mTexto('quiero una billetera'));
    const t2 = hablar(m2, ANA, mTexto('quiero pagar solo Bs 5'));
    expect(t2.llamadas.ingesta.find((x) => x['evento'] === 'qr_enviado')).toMatchObject({ monto: 450 });
  });
  it('carrito cambiado con un QR abierto: se avisa al servidor (`cobro_cancelado`) y se emite OTRO QR', () => {
    const m = crear({ modeloDice: (ll) => pide([{ id: BIL, cantidad: /mejor dos/.test(ultimo(ll)) ? 2 : 1 }], { entrega: ENTREGA }) });
    hablar(m, ANA, mTexto('una billetera'));
    const primero = hablar(m, ANA, mTexto('quiero pagar'));
    expect(primero.mensajes.some((x) => x.tipo === 'image')).toBe(true);
    // El servidor dice que hay un QR abierto de 450; el cliente cambia a dos y vuelve a confirmar.
    m.dobles['Traer configuración'] = () => panelConQr(450);
    const t = hablar(m, ANA, mTexto('mejor dos, quiero pagar'));
    const cancel = t.llamadas.ingesta.find((x) => x['evento'] === 'cobro_cancelado');
    expect(cancel).toBeTruthy();
    expect(t.mensajes.filter((x) => x.tipo === 'image')).toHaveLength(1);
    expect(t.mensajes[0]?.cuerpo).toMatch(/Actualicé tu pedido/);
    expect(t.llamadas.ingesta.find((x) => x['evento'] === 'qr_enviado')).toMatchObject({ monto: 900 });
    expect(fichas(m)[ANA].pedidos).toBe(2);
  });
  it('NEGADO: si el servidor no pudo cerrar el cobro, NO se emite otro QR: se pasa con recepción con el botón y sin decir que se avisó', () => {
    const m = crear({ cancelar: 'cae', modeloDice: (ll) => pide([{ id: BIL, cantidad: /mejor dos/.test(ultimo(ll)) ? 2 : 1 }], { entrega: ENTREGA }) });
    hablar(m, ANA, mTexto('una billetera'));
    hablar(m, ANA, mTexto('quiero pagar'));
    m.dobles['Traer configuración'] = () => panelConQr(450);
    const t = hablar(m, ANA, mTexto('mejor dos, quiero pagar'));
    expect(t.mensajes.every((x) => x.tipo !== 'image')).toBe(true);
    expect(t.mensajes).toHaveLength(1);
    expect(t.mensajes[0]?.payload['interactive']).toBeTruthy();
    expect(t.mensajes[0]?.cuerpo).toMatch(/no pagues con ese QR/i);
    expect(t.mensajes[0]?.cuerpo).not.toMatch(/ya avis/i);
  });
  it('con el mismo carrito y un QR abierto, un recordatorio sin otro QR', () => {
    const m = crear({ modeloDice: pide([{ id: BIL, cantidad: 1 }], { entrega: ENTREGA }) });
    hablar(m, ANA, mTexto('una billetera'));
    hablar(m, ANA, mTexto('quiero pagar'));
    m.dobles['Traer configuración'] = () => panelConQr(450);
    const t = hablar(m, ANA, mTexto('quiero pagar ya'));
    expect(t.mensajes.every((x) => x.tipo !== 'image')).toBe(true);
    expect(t.mensajes[0]?.cuerpo).toMatch(/Ya tienes un QR abierto por Bs 450/);
  });
  it('dos teléfonos intercalados no comparten carrito', () => {
    const m = crear({ modeloDice: (ll) => (/bufanda/.test(ultimo(ll)) ? pide([{ id: BUF, cantidad: 1 }]) : pide([{ id: BIL, cantidad: 3 }])) });
    hablar(m, ANA, mTexto('tres billeteras'));
    hablar(m, BETO, mTexto('una bufanda'));
    hablar(m, ANA, mTexto('gracias'));
    expect(fichas(m)[ANA].carrito).toEqual([{ id: BIL, cantidad: 3, detalle: '' }]);
    expect(fichas(m)[BETO].carrito).toEqual([{ id: BUF, cantidad: 1, detalle: '' }]);
  });
  it('el catálogo del test es el de prueba (sin precios reales)', () => {
    expect(CATALOGO.some((c) => c.id === BIL)).toBe(true);
  });
});
