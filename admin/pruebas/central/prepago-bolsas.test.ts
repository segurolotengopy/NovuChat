/**
 * LAS BOLSAS EN EL MÓDULO PURO DEL PREPAGO (Bloque 1, PR-2), sin emulador.
 *
 * Se prueba negando: qué bolsa NO puede comprar cada tarifa, que la de
 * seguimiento sigue apagada, que una cantidad mal formada no es un pago, y que
 * una cuenta como la de Bellido (Impulso, copia 100, sin `tarifa`) queda
 * idéntica. Cada negativa tiene su control positivo al lado.
 */
import { describe, expect, it } from 'vitest';
import {
  BOLSAS_MAXIMO, MESES_MAXIMO, MENSAJE_BOLSA_NO_PERMITIDA, VENTA_BOLSA_SALIENTES, VOSEO, aplicarPago, bolsaPermitida,
  descripcionDe, esPago, estadoDeServicio, montoUsdDe, recordatoriosDebidos, type CuentaCruda,
} from '../../functions/src/central/cuenta/prepago.ts';
import { limitesDe, REGALO_SEIS_MESES_CONVERSACIONES } from '../../functions/src/central/cuenta/planes.ts';

const HORA = 3_600_000;
const bo = (y: number, m: number, d: number, h = 0) => Date.UTC(y, m - 1, d, h) + 4 * HORA;
const ts = (ms: number) => ({ toMillis: () => ms });
const AHORA = bo(2026, 10, 20, 10);
const CTX = { tco: 12.6, numeroRecepcion: '70000001' };

const estandar = (extra: Partial<CuentaCruda> = {}): CuentaCruda =>
  ({ modalidad: 'prepago', plan: 'crecimiento', tarifa: 'estandar', limites: limitesDe('crecimiento', 'estandar'), periodoPagado: '2026-10', ...extra }) as CuentaCruda;
const metaIncluido = (extra: Partial<CuentaCruda> = {}): CuentaCruda =>
  ({ modalidad: 'prepago', plan: 'crecimiento', tarifa: 'meta_incluido', limites: limitesDe('crecimiento', 'meta_incluido'), periodoPagado: '2026-10', ...extra }) as CuentaCruda;
/** La cuenta tipo Bellido: Impulso, copia 100, sin campo `tarifa`. */
const bellido = (extra: Partial<CuentaCruda> = {}): CuentaCruda =>
  ({ modalidad: 'prepago', plan: 'impulso', limites: { conversaciones: 100, productos: 25, agendas: 1 }, periodoPagado: '2026-10', ...extra }) as CuentaCruda;

describe('bolsaPermitida: cada tarifa compra su bolsa y no la otra', () => {
  it('estandar: la de 300 por USD 15 sí; la de 30 por USD 10 NO', () => {
    expect(bolsaPermitida(estandar(), { tipo: 'bolsaConversaciones' }, [])).toBeNull();
    expect(bolsaPermitida(estandar(), { tipo: 'bolsa' }, [])).toBe('tarifa');
  });

  it('meta_incluido: la de 30 por USD 10 sí; la de 300 NO', () => {
    expect(bolsaPermitida(metaIncluido(), { tipo: 'bolsa' }, [])).toBeNull();
    expect(bolsaPermitida(metaIncluido(), { tipo: 'bolsaConversaciones' }, [])).toBe('tarifa');
  });

  it('sin campo tarifa se trata como meta_incluido (la cuenta de Bellido)', () => {
    expect(bolsaPermitida(bellido(), { tipo: 'bolsa' }, [])).toBeNull();
    expect(bolsaPermitida(bellido(), { tipo: 'bolsaConversaciones' }, [])).toBe('tarifa');
    expect(bolsaPermitida({}, { tipo: 'bolsaConversaciones' }, [])).toBe('tarifa');
    expect(bolsaPermitida(null, { tipo: 'bolsaConversaciones' }, [])).toBe('tarifa');
    expect(bolsaPermitida(estandar({ tarifa: 'otra' } as never), { tipo: 'bolsaConversaciones' }, [])).toBe('tarifa');
  });

  it('la bolsa de seguimiento está APAGADA: nadie la compra, ni estandar con titularidad comercio', () => {
    expect(VENTA_BOLSA_SALIENTES).toBe(false);
    expect(bolsaPermitida(estandar(), { tipo: 'bolsaSalientes' }, ['comercio'])).toBe('no_habilitada');
    expect(bolsaPermitida(metaIncluido(), { tipo: 'bolsaSalientes' }, ['comercio'])).toBe('no_habilitada');
    expect(bolsaPermitida(bellido(), { tipo: 'bolsaSalientes' }, [])).toBe('no_habilitada');
  });

  it('con la venta encendida (variante interna): estandar solo con titularidad comercio', () => {
    expect(bolsaPermitida(estandar(), { tipo: 'bolsaSalientes' }, ['comercio'], true)).toBeNull();
    expect(bolsaPermitida(estandar(), { tipo: 'bolsaSalientes' }, [], true)).toBe('titularidad');
    expect(bolsaPermitida(estandar(), { tipo: 'bolsaSalientes' }, ['novuchat'], true)).toBe('titularidad');
    expect(bolsaPermitida(metaIncluido(), { tipo: 'bolsaSalientes' }, ['comercio'], true)).toBe('tarifa');
    expect(bolsaPermitida(bellido(), { tipo: 'bolsaSalientes' }, ['comercio'], true)).toBe('tarifa');
  });

  it('un pago que no es bolsa no se juzga', () => {
    expect(bolsaPermitida(estandar(), { tipo: 'mensualidad' }, [])).toBeNull();
    expect(bolsaPermitida(estandar(), { tipo: 'instalacion' }, [])).toBeNull();
  });

  it('los rechazos tienen texto fijo, sin voseo', () => {
    for (const k of ['tarifa', 'titularidad', 'no_habilitada'] as const) {
      expect(MENSAJE_BOLSA_NO_PERMITIDA[k].length).toBeGreaterThan(10);
      expect(MENSAJE_BOLSA_NO_PERMITIDA[k]).not.toMatch(VOSEO);
    }
  });
});

describe('esPago: las cantidades de las tres bolsas', () => {
  it.each(['bolsa', 'bolsaConversaciones', 'bolsaSalientes'] as const)('%s: 1 y el máximo entran; 0, máximo+1, 1,5, negativas y texto no', (tipo) => {
    expect(BOLSAS_MAXIMO).toBe(12);
    expect(esPago({ tipo, cantidad: 1 })).toBe(true);
    expect(esPago({ tipo, cantidad: BOLSAS_MAXIMO })).toBe(true);
    for (const cantidad of [0, 13, 1.5, -1, '2', null, undefined, NaN]) {
      expect(esPago({ tipo, cantidad })).toBe(false);
    }
    expect(() => montoUsdDe({ tipo, cantidad: 0 })).toThrow();
  });
});

describe('importe, descripción y acreditación', () => {
  it('montoUsdDe y descripcionDe, en singular y plural', () => {
    expect(montoUsdDe({ tipo: 'bolsa', cantidad: 2 })).toBe(20);
    expect(montoUsdDe({ tipo: 'bolsaConversaciones', cantidad: 1 })).toBe(15);
    expect(montoUsdDe({ tipo: 'bolsaConversaciones', cantidad: 3 })).toBe(45);
    expect(montoUsdDe({ tipo: 'bolsaSalientes', cantidad: 2 })).toBe(20);
    expect(descripcionDe({ tipo: 'bolsa', cantidad: 1 })).toBe('Bolsa de 30 conversaciones');
    expect(descripcionDe({ tipo: 'bolsaConversaciones', cantidad: 1 })).toBe('Bolsa de 300 conversaciones');
    expect(descripcionDe({ tipo: 'bolsaConversaciones', cantidad: 2 })).toBe('2 bolsas de 300 conversaciones');
    expect(descripcionDe({ tipo: 'bolsaSalientes', cantidad: 1 })).toBe('Bolsa de 300 mensajes de seguimiento');
    expect(descripcionDe({ tipo: 'bolsaSalientes', cantidad: 3 })).toBe('3 bolsas de 300 mensajes de seguimiento');
  });

  it('se acredita lo PAGADO, sin importar la tarifa de hoy', () => {
    // Una bolsa de 30 pagada antes de pasar a estandar sigue valiendo 30.
    expect(aplicarPago(estandar({ bolsa: 5 }), { tipo: 'bolsa', cantidad: 2 }, AHORA).bolsa).toBe(65);
    expect(aplicarPago(estandar({ bolsa: 5 }), { tipo: 'bolsaConversaciones', cantidad: 2 }, AHORA).bolsa).toBe(605);
    expect(aplicarPago(metaIncluido({ bolsa: 0 }), { tipo: 'bolsaConversaciones', cantidad: 1 }, AHORA).bolsa).toBe(300);
  });

  it('la bolsa de seguimiento no suma a las conversaciones', () => {
    expect(aplicarPago(estandar({ bolsa: 7 }), { tipo: 'bolsaSalientes', cantidad: 4 }, AHORA).bolsa).toBe(7);
  });

  it('el regalo de 6 meses es 30 con cualquier tarifa; con 5 meses no hay regalo', () => {
    expect(REGALO_SEIS_MESES_CONVERSACIONES).toBe(30);
    for (const c of [estandar(), metaIncluido(), bellido()]) {
      expect(aplicarPago(c, { tipo: 'mensualidad', plan: 'impulso', meses: MESES_MAXIMO }, AHORA).bolsa).toBe(30);
      expect(aplicarPago(c, { tipo: 'mensualidad', plan: 'impulso', meses: 5 }, AHORA).bolsa).toBe(0);
    }
  });
});

describe('la cuenta tipo Bellido queda idéntica', () => {
  it('estadoDeServicio campo por campo: la bolsa de 30 sigue siendo la de siempre', () => {
    const c = bellido({ bolsa: 12 });
    const e = estadoDeServicio(c, 40, AHORA);
    expect(e).toMatchObject({ plan: 'impulso', modalidad: 'prepago', incluidas: 100, bolsa: 12, restanteDelPlan: 60, disponibles: 72, operativo: true, motivo: null });
    // Un pago de 30 por USD 10 se calcula y se acredita igual que antes.
    expect(bolsaPermitida(c, { tipo: 'bolsa' }, [])).toBeNull();
    expect(montoUsdDe({ tipo: 'bolsa', cantidad: 1 })).toBe(10);
    expect(aplicarPago(c, { tipo: 'bolsa', cantidad: 1 }, AHORA).bolsa).toBe(42);
  });
});

describe('conversaciones_agotadas: no se le emite a una cuenta estandar', () => {
  const agotada = (c: CuentaCruda): CuentaCruda =>
    ({ ...c, corte: { motivo: 'sin_conversaciones', desde: ts(bo(2026, 10, 20)) } }) as CuentaCruda;
  const claves = (c: CuentaCruda, usadas: number) =>
    recordatoriosDebidos(c, estadoDeServicio(c, usadas, AHORA), AHORA, CTX).map((r) => r.clave);

  it('estandar agotada: sin sinConversaciones (control: el estado sí está cortado por conversaciones)', () => {
    const c = agotada(estandar());
    expect(estadoDeServicio(c, 500, AHORA).motivo).toBe('sin_conversaciones');
    expect(claves(c, 500)).toEqual([]);
  });

  it('meta_incluido agotada: sigue saliendo', () => {
    expect(claves(agotada(metaIncluido()), 220)).toEqual(['agotadas_2026-10']);
  });

  it('sin campo tarifa (Bellido) agotada: sigue saliendo', () => {
    expect(claves(agotada(bellido()), 100)).toEqual(['agotadas_2026-10']);
  });
});
