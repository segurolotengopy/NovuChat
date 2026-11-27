/**
 * EL MENSAJE PEGADO DEL SITIO con el formato NUEVO (matriz de verificación, R36 y R47; 25/11/2026): «Hola, quiero comprar estos productos: N x Nombre (cód. id): Bs <precio> c/u, subtotal Bs <x> / Total referencial: Bs <t>» (y en pesos, «ARS …»).
 * Los códigos y las cantidades se leen; los montos del mensaje NUNCA se cobran: el precio y el total son los del catálogo vivo (cantidad × precio, sin redondear ni recalcular). Si el mensaje trae montos distintos se avisa en el mismo mensaje y el resumen muestra el total real.
 * Se prueba NEGANDO, con el flujo armado.
 */
import { describe, expect, it } from 'vitest';
import { ANA, ARGENTINO, CATALOGO, catalogoOk, crear, hablar, modelo, mTexto, textos } from './mundo';

const J = (x: unknown): string => JSON.stringify(x);
const LEYENDA = ' El precio final y el envío se confirman por WhatsApp';
const AVISO = /no coinciden con los del catálogo de hoy/;
const mensaje = (cant: number, precio: string, subtotal: string, total: string, moneda = 'Bs', codigo = 'billetera-cuero'): string => `Hola, quiero comprar estos productos: ${cant} x Billetera de cuero (cód. ${codigo}): ${moneda} ${precio} c/u, subtotal ${moneda} ${subtotal} Total referencial: ${moneda} ${total}${LEYENDA}`;
const fichaDe = (m: ReturnType<typeof crear>, tel: string): { carrito: { id: string; cantidad: number }[] } => (m.sd['casabermejo'] as Record<string, { carrito: { id: string; cantidad: number }[] }>)[tel]!;

describe('Bolivia: formato nuevo, montos coincidentes', () => {
  it('«2 x Billetera de cuero … Bs 450 c/u, subtotal Bs 900 … Total referencial: Bs 900»: el pedido queda con 2 unidades, el resumen trae Bs 900, sin aviso de precios, 1 mensaje y sin modelo para armar las líneas', () => {
    const m = crear({ modeloDice: modelo('Con gusto.', { lineas: [] }) });
    const t = hablar(m, ANA, mTexto(mensaje(2, '450', '900', '900')));
    expect(t.mensajes).toHaveLength(1);
    expect(fichaDe(m, ANA).carrito).toEqual([{ id: 'billetera-cuero', cantidad: 2, detalle: '' }]);
    expect(textos(t).join(' ')).toContain('2 × Billetera de cuero');
    expect(textos(t).join(' ')).toContain('Total: Bs 900');
    expect(textos(t).join(' ')).not.toMatch(AVISO);
  });
  it('el pedido del sitio llega hasta el QR por el total del catálogo: dos unidades = dos veces el precio (Bs 900)', () => {
    const m = crear({ entregaPrevia: { modo: 'Retiro en tienda', nombre: 'Ana Pérez' }, modeloDice: modelo('Con gusto.', { lineas: [] }) });
    hablar(m, ANA, mTexto(mensaje(2, '450', '900', '900')));
    const t = hablar(m, ANA, mTexto('quiero pagar'));
    expect((t.llamadas.ingesta.find((x) => x['evento'] === 'qr_enviado') as { monto?: number } | undefined)?.monto).toBe(900);
  });
});

describe('Bolivia: formato nuevo, montos DISTINTOS: se cobra el del catálogo y se avisa', () => {
  for (const [que, texto] of [['el precio por unidad', mensaje(2, '100', '200', '200')], ['el subtotal', mensaje(2, '450', '10', '900')], ['el total', mensaje(2, '450', '900', '1')]] as const) {
    it(`distinto ${que}: 1 mensaje con el aviso y el total real (Bs 900), nunca el del mensaje; el QR sale por 900`, () => {
      const m = crear({ entregaPrevia: { modo: 'Retiro en tienda', nombre: 'Ana Pérez' }, modeloDice: modelo('Con gusto.', { lineas: [] }) });
      const t = hablar(m, ANA, mTexto(texto));
      expect(t.mensajes).toHaveLength(1);
      expect(textos(t).join(' ')).toMatch(AVISO);
      expect(textos(t).join(' ')).toContain('Total: Bs 900');
      expect(textos(t).join(' ')).not.toMatch(/Total: Bs (200|10|1)\b/);
      const q = hablar(m, ANA, mTexto('quiero pagar'));
      expect((q.llamadas.ingesta.find((x) => x['evento'] === 'qr_enviado') as { monto?: number } | undefined)?.monto).toBe(900);
    });
  }
  it('un código inexistente no entra al pedido ni al cobro; si es lo único, el mensaje no se toma como pedido del sitio', () => {
    const m = crear({ modeloDice: modelo('Con gusto, ¿qué pieza le interesa?', { lineas: [] }) });
    const t = hablar(m, ANA, mTexto(mensaje(3, '10', '30', '30', 'Bs', 'inventado')));
    expect(fichaDe(m, ANA).carrito).toEqual([]);
    expect(J(t.mensajes)).not.toMatch(/Total: Bs 30\b/);
  });
});

describe('Argentina (ARS): formato nuevo', () => {
  const itemAr = { ...CATALOGO[1], moneda: 'ARS', precio: 450000, precioCentavos: 45000000, stock: 10, disponible: true };
  const cat = () => catalogoOk({ mercado: 'AR', moneda: 'ARS' }, [itemAr] as never);
  it('«ARS 450.000 c/u … Total referencial: ARS 900.000»: dos unidades = ARS 900.000, sin aviso', () => {
    const m = crear({ catalogo: cat(), modeloDice: modelo('Con gusto.', { lineas: [] }) });
    const t = hablar(m, ARGENTINO, mTexto(mensaje(2, '450.000', '900.000', '900.000', 'ARS')));
    expect(textos(t).join(' ')).toContain('Total: ARS 900.000');
    expect(textos(t).join(' ')).not.toMatch(AVISO);
    expect(fichaDe(m, ARGENTINO).carrito[0]?.cantidad).toBe(2);
  });
  it('NEGADO: con otro monto en el mensaje se avisa y vale el total del catálogo (ARS 900.000)', () => {
    const m = crear({ catalogo: cat(), modeloDice: modelo('Con gusto.', { lineas: [] }) });
    const t = hablar(m, ARGENTINO, mTexto(mensaje(2, '400.000', '800.000', '800.000', 'ARS')));
    expect(textos(t).join(' ')).toMatch(AVISO);
    expect(textos(t).join(' ')).toContain('Total: ARS 900.000');
    expect(textos(t).join(' ')).not.toContain('800.000');
  });
});
