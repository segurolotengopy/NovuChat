/**
 * PREPAGO — el saldo, el corte y los recordatorios, mes por mes.
 *
 * NO NECESITA EMULADOR: `functions/src/prepago.ts` es puro. Sobre lo que decide
 * se corta el servicio de un cliente y se le cobra; un error acá es cortarle a
 * quien pagó o atender gratis a quien no. Las dos cosas se descubren tarde y con
 * un cliente enojado, así que se prueban antes.
 *
 * Todas las fechas van en hora de Bolivia (UTC−4, sin horario de verano).
 */
import { describe, expect, it } from 'vitest';
import {
  BOLSA, DIAS_AVISO_RENOVACION, MENSAJE_CORTESIA, PLANES, PLANTILLAS, PRUEBA, VOSEO,
  aplicarPago, consumoDeConversacion, corteDe, diasDelPeriodo, estadoDeServicio,
  fechaFinDelPeriodo, finDelPeriodoMs, importeBs, montoUsdDe, periodoAnterior, periodoDe,
  periodoSiguiente, recordatoriosDebidos, resumenDeCuenta, sumarMeses,
  MONEDA_COBRO, MONEDA_LISTA, TCO_MAXIMO, TCO_MINIMO, esTipoCambio,
} from '../functions/src/prepago.ts';

/** Un instante de Bolivia: `bo('2026-09-07 15:00')`. */
const bo = (texto: string): number => new Date(`${texto.replace(' ', 'T')}:00-04:00`).getTime();

describe('Períodos en hora de Bolivia', () => {
  it('el mes se decide en La Paz, no en UTC', () => {
    // 30 de septiembre a las 22:00 de Bolivia son las 02:00 UTC del 1 de octubre.
    expect(periodoDe(bo('2026-09-30 22:00'))).toBe('2026-09');
    expect(periodoDe(bo('2026-10-01 00:00'))).toBe('2026-10');
  });

  it('suma y resta meses cruzando el año', () => {
    expect(periodoSiguiente('2026-12')).toBe('2027-01');
    expect(periodoAnterior('2026-01')).toBe('2025-12');
    expect(sumarMeses('2026-09', 3)).toBe('2026-12');
    expect(sumarMeses('2026-11', 3)).toBe('2027-02');
  });

  it('sabe cuántos días tiene cada mes, bisiesto incluido', () => {
    expect(diasDelPeriodo('2026-02')).toBe(28);
    expect(diasDelPeriodo('2028-02')).toBe(29);
    expect(diasDelPeriodo('2026-09')).toBe(30);
    expect(fechaFinDelPeriodo('2026-09')).toBe('30/09/2026');
  });

  it('el fin del mes es el último segundo de Bolivia', () => {
    expect(periodoDe(finDelPeriodoMs('2026-09'))).toBe('2026-09');
    expect(periodoDe(finDelPeriodoMs('2026-09') + 1000)).toBe('2026-10');
  });
});

/** TCO del BCB del 08/09/2026. Las pruebas que cotizan un importe lo usan. */
const TCO = 12.60;

describe('Los planes son los de la presentación comercial', () => {
  it('tres planes, con las cifras de la diapositiva', () => {
    // Los volúmenes se corrigieron el 08/09 con el modelo de costos: los
    // viejos (300/1000/2500) daban pérdida con la tarifa de Meta del 1 de
    // octubre, y la bolsa vieja (150 por 50 Bs) perdía 176 Bs cada venta.
    expect(PLANES.base).toMatchObject({ precioUsd: 20, conversaciones: 120 });
    expect(PLANES.crecimiento).toMatchObject({ precioUsd: 40, conversaciones: 200 });
    expect(PLANES.corporativo).toMatchObject({ precioUsd: 70, conversaciones: 300 });
    expect(BOLSA).toEqual({ conversaciones: 25, precioUsd: 10 });
    expect(PRUEBA.conversaciones).toBe(20);
  });

  it('el monto de un pago sale de la tabla, nunca del cliente', () => {
    expect(montoUsdDe({ tipo: 'mensualidad', plan: 'crecimiento', meses: 1 })).toBe(40);
    expect(montoUsdDe({ tipo: 'mensualidad', plan: 'base', meses: 3 })).toBe(60);
    expect(montoUsdDe({ tipo: 'bolsa', cantidad: 2 })).toBe(20);
    // Cero o negativo se toma como uno: nunca un pago gratis.
    expect(montoUsdDe({ tipo: 'bolsa', cantidad: 0 })).toBe(10);
  });
});

describe('Precios en dólares, cobro en bolivianos', () => {
  it('convierte al boliviano redondeado: el importe termina en un QR', () => {
    // Con el TCO del BCB del 08/09/2026, la lista queda en 252 / 504 / 882 Bs.
    expect(importeBs(20, TCO)).toBe(252);
    expect(importeBs(40, TCO)).toBe(504);
    expect(importeBs(70, TCO)).toBe(882);
    expect(importeBs(10, TCO)).toBe(126);
    // Los centavos en una transferencia son diferencias que hay que conciliar
    // a mano: se redondea al boliviano.
    expect(importeBs(20, 12.57)).toBe(251);
    expect(importeBs(0, TCO)).toBe(0);
  });

  it('NUNCA inventa un tipo de cambio: sin uno válido, lanza', () => {
    // Cobrar con un tipo de cambio supuesto es peor que no poder cobrar: el
    // error se descubre cuando el cliente ya pagó.
    for (const malo of [0, -1, Number.NaN, TCO_MINIMO - 0.01, TCO_MAXIMO + 1]) {
      expect(() => importeBs(20, malo), String(malo)).toThrow(/tipo de cambio invalido/);
    }
    expect(() => importeBs(-1, TCO)).toThrow(/importe invalido/);
  });

  it('valida el documento del tipo de cambio antes de cotizar con él', () => {
    expect(esTipoCambio({ tco: 12.6, periodo: '2026-09', fuente: 'BCB' })).toBe(true);
    // Un cero de más multiplicaría por diez lo que se le cobra a un cliente.
    expect(esTipoCambio({ tco: 126, periodo: '2026-09', fuente: 'BCB' })).toBe(false);
    expect(esTipoCambio({ tco: 1.26, periodo: '2026-09', fuente: 'BCB' })).toBe(false);
    expect(esTipoCambio({ tco: 12.6, periodo: 'septiembre', fuente: 'BCB' })).toBe(false);
    expect(esTipoCambio({ tco: '12.6', periodo: '2026-09', fuente: 'BCB' })).toBe(false);
    expect(esTipoCambio({ tco: 12.6, periodo: '2026-09' })).toBe(false);
    expect(esTipoCambio(null)).toBe(false);
  });

  it('la lista está en dólares y el cobro en bolivianos, y son campos distintos', () => {
    expect(MONEDA_LISTA).toBe('USD');
    expect(MONEDA_COBRO).toBe('BOB');
  });
});

describe('Estado del servicio · lo que NO está en prepago se atiende siempre', () => {
  it('una cuenta sin modalidad es demostración: nunca se corta', () => {
    // Es la salvaguarda de los dos demos del 9 y 10 de septiembre.
    for (const cuenta of [{}, { plan: 'basico' }, { modalidad: 'demostracion' }, { modalidad: 'x' }]) {
      const e = estadoDeServicio(cuenta, 99_999, '2026-09');
      expect(e.operativo).toBe(true);
      expect(e.motivo).toBeNull();
      expect(e.disponibles).toBe(Number.POSITIVE_INFINITY);
    }
  });
});

describe('Estado del servicio · prepago', () => {
  const pagado = { modalidad: 'prepago', plan: 'base', periodoPagado: '2026-09' };

  it('con el mes pagado y conversaciones, opera', () => {
    const e = estadoDeServicio(pagado, 10, '2026-09');
    expect(e).toMatchObject({ operativo: true, motivo: null, cubierto: true, incluidas: 120,
      consumidas: 10, restanteDelPlan: 110, disponibles: 110, mensualidadUsd: 20 });
  });

  it('el 1 del mes siguiente sin pagar, se corta por falta de pago', () => {
    const e = estadoDeServicio(pagado, 0, '2026-10');
    expect(e).toMatchObject({ operativo: false, motivo: 'sin_pago', cubierto: false, disponibles: 0 });
  });

  it('un pago adelantado cubre también los meses intermedios', () => {
    const e = estadoDeServicio({ ...pagado, periodoPagado: '2026-12' }, 0, '2026-10');
    expect(e.operativo).toBe(true);
    expect(e.cubiertoHasta).toBe('2026-12');
  });

  it('al agotar las incluidas se corta, salvo que haya bolsa', () => {
    expect(estadoDeServicio(pagado, 120, '2026-09'))
      .toMatchObject({ operativo: false, motivo: 'sin_conversaciones', disponibles: 0 });
    expect(estadoDeServicio({ ...pagado, bolsa: 25 }, 120, '2026-09'))
      .toMatchObject({ operativo: true, restanteDelPlan: 0, disponibles: 25 });
    expect(estadoDeServicio({ ...pagado, bolsa: 25 }, 200, '2026-09'))
      .toMatchObject({ operativo: true, disponibles: 25 });
  });

  it('las bolsas NO sostienen el servicio si el mes no está pagado', () => {
    // «Sin mensualidad no hay servicio». La bolsa se conserva para cuando pague.
    const e = estadoDeServicio({ ...pagado, bolsa: 120 }, 0, '2026-10');
    expect(e.operativo).toBe(false);
    expect(e.motivo).toBe('sin_pago');
    expect(e.bolsa).toBe(120);
  });

  it('un plan desconocido cae al plan base, nunca a ilimitado', () => {
    const e = estadoDeServicio({ ...pagado, plan: 'oro' }, 0, '2026-09');
    expect(e.plan).toBe('base');
    expect(e.incluidas).toBe(120);
  });

  it('valores basura en los saldos cuentan como cero', () => {
    const e = estadoDeServicio({ ...pagado, bolsa: 'muchas', bolsaPrueba: -5 }, 120, '2026-09');
    expect(e.bolsa).toBe(0);
    expect(e.operativo).toBe(false);
  });
});

describe('Estado del servicio · mes de prueba', () => {
  const prueba = { modalidad: 'prueba', periodoPrueba: '2026-09', bolsaPrueba: 20 };

  it('durante el mes de prueba: sin mensualidad y con la bolsa de 20', () => {
    const e = estadoDeServicio(prueba, 0, '2026-09');
    expect(e).toMatchObject({ operativo: true, enPrueba: true, cubierto: true, incluidas: 0,
      disponibles: 20, mensualidadUsd: 0 });
  });

  it('las 20 se descuentan de la bolsa de prueba, y al agotarlas se corta', () => {
    const e = estadoDeServicio({ ...prueba, bolsaPrueba: 0 }, 20, '2026-09');
    expect(e).toMatchObject({ operativo: false, motivo: 'sin_conversaciones' });
  });

  it('terminado el mes de prueba sin elegir plan, se corta por falta de pago', () => {
    const e = estadoDeServicio(prueba, 0, '2026-10');
    expect(e).toMatchObject({ operativo: false, motivo: 'sin_pago', enPrueba: false, mensualidadUsd: 0 });
  });

  it('la bolsa de prueba no vale fuera del mes de prueba', () => {
    // Con el mes siguiente pagado, lo que queda de la prueba ya no cuenta.
    const e = estadoDeServicio({ ...prueba, periodoPagado: '2026-10', plan: 'base' }, 0, '2026-10');
    expect(e.enPrueba).toBe(false);
    expect(e.disponibles).toBe(120);
  });
});

describe('Consumo de una conversación nueva', () => {
  const pagado = { modalidad: 'prepago', plan: 'base', periodoPagado: '2026-09' };

  it('mientras el plan tiene conversaciones, no toca ninguna bolsa', () => {
    const c = consumoDeConversacion(estadoDeServicio({ ...pagado, bolsa: 25 }, 10, '2026-09'));
    expect(c).toEqual({ campoBolsa: null, cortaDespues: false });
  });

  it('agotado el plan, descuenta de la bolsa comprada', () => {
    const c = consumoDeConversacion(estadoDeServicio({ ...pagado, bolsa: 25 }, 120, '2026-09'));
    expect(c).toEqual({ campoBolsa: 'bolsa', cortaDespues: false });
  });

  it('la última disponible avisa que después de ella se corta', () => {
    expect(consumoDeConversacion(estadoDeServicio({ ...pagado, bolsa: 1 }, 120, '2026-09')))
      .toEqual({ campoBolsa: 'bolsa', cortaDespues: true });
    expect(consumoDeConversacion(estadoDeServicio(pagado, 299, '2026-09')))
      .toEqual({ campoBolsa: null, cortaDespues: true });
  });

  it('en el mes de prueba descuenta de la bolsa de prueba antes que de la comprada', () => {
    const e = estadoDeServicio({ modalidad: 'prueba', periodoPrueba: '2026-09',
      bolsaPrueba: 3, bolsa: 25 }, 0, '2026-09');
    expect(consumoDeConversacion(e)).toEqual({ campoBolsa: 'bolsaPrueba', cortaDespues: false });
  });

  it('en demostración no descuenta ni corta nunca', () => {
    expect(consumoDeConversacion(estadoDeServicio({}, 5000, '2026-09')))
      .toEqual({ campoBolsa: null, cortaDespues: false });
  });
});

describe('Aplicar un pago', () => {
  it('una mensualidad con el mes en curso sin cubrir, cubre el mes en curso', () => {
    // Cliente cortado el 3 de octubre que paga: queda cubierto para octubre.
    const r = aplicarPago({ modalidad: 'prepago', plan: 'base', periodoPagado: '2026-09' },
      { tipo: 'mensualidad', plan: 'base', meses: 1 }, '2026-10');
    expect(r).toMatchObject({ periodoPagado: '2026-10', modalidad: 'prepago', plan: 'base' });
  });

  it('una mensualidad con el mes en curso ya pagado, cubre el siguiente', () => {
    const r = aplicarPago({ modalidad: 'prepago', plan: 'base', periodoPagado: '2026-09' },
      { tipo: 'mensualidad', plan: 'base', meses: 1 }, '2026-09');
    expect(r.periodoPagado).toBe('2026-10');
  });

  it('en el mes de prueba, pagar cubre el mes siguiente y termina la prueba', () => {
    const r = aplicarPago({ modalidad: 'prueba', periodoPrueba: '2026-09', bolsaPrueba: 7 },
      { tipo: 'mensualidad', plan: 'crecimiento', meses: 1 }, '2026-09');
    expect(r).toMatchObject({ periodoPagado: '2026-10', modalidad: 'prepago', plan: 'crecimiento' });
  });

  it('un cliente nuevo sin nada cubierto que paga, cubre el mes en curso', () => {
    const r = aplicarPago({ modalidad: 'prepago', plan: 'base' },
      { tipo: 'mensualidad', plan: 'base', meses: 1 }, '2026-09');
    expect(r.periodoPagado).toBe('2026-09');
  });

  it('varios meses se suman de corrido', () => {
    const r = aplicarPago({ modalidad: 'prepago', plan: 'base', periodoPagado: '2026-09' },
      { tipo: 'mensualidad', plan: 'base', meses: 3 }, '2026-09');
    expect(r.periodoPagado).toBe('2026-12');
  });

  it('cambiar de plan ES pagar el plan nuevo', () => {
    const r = aplicarPago({ modalidad: 'prepago', plan: 'base', periodoPagado: '2026-09' },
      { tipo: 'mensualidad', plan: 'corporativo', meses: 1 }, '2026-09');
    expect(r.plan).toBe('corporativo');
  });

  it('una bolsa suma sus conversaciones y no toca el período pagado ni el plan', () => {
    const r = aplicarPago({ modalidad: 'prepago', plan: 'base', periodoPagado: '2026-09', bolsa: 20 },
      { tipo: 'bolsa', cantidad: 2 }, '2026-09');
    expect(r).toMatchObject({ bolsa: 70, periodoPagado: '2026-09', plan: 'base' });
  });

  it('un pago nunca deja un período cubierto MENOR que el que había', () => {
    const r = aplicarPago({ modalidad: 'prepago', plan: 'base', periodoPagado: '2026-12' },
      { tipo: 'mensualidad', plan: 'base', meses: 1 }, '2026-09');
    expect(r.periodoPagado).toBe('2027-01');
  });
});

describe('Recordatorios', () => {
  const pagado = { modalidad: 'prepago', plan: 'base', periodoPagado: '2026-09' };
  const estadoEl = (cuenta: object, consumidas: number, periodo: string) =>
    estadoDeServicio(cuenta, consumidas, periodo);

  it('en demostración no se manda nada', () => {
    expect(recordatoriosDebidos({}, estadoEl({}, 0, '2026-09'), 'Demo', bo('2026-09-29 09:00'), TCO)).toEqual([]);
  });

  it('a mitad de mes, con el mes pagado, no se manda nada', () => {
    const r = recordatoriosDebidos(pagado, estadoEl(pagado, 0, '2026-09'), 'Salón Rosa', bo('2026-09-15 09:00'), TCO);
    expect(r).toEqual([]);
  });

  it('el primer aviso de renovación sale a 7 días del fin de mes; el segundo, a 2', () => {
    const a7 = recordatoriosDebidos(pagado, estadoEl(pagado, 0, '2026-09'), 'Salón Rosa', bo('2026-09-23 09:00'), TCO);
    expect(a7.map((r) => r.clave)).toEqual(['renovacion_2026-10_1']);
    expect(a7[0]).toMatchObject({ plantilla: PLANTILLAS.renovacion.nombre,
      // El importe en bolivianos, con el TCO del BCB: USD 20 × 12,60.
      parametros: ['Salón Rosa', 'Plan Base', '30/09/2026', 'Bs 252'] });

    const a2 = recordatoriosDebidos(pagado, estadoEl(pagado, 0, '2026-09'), 'Salón Rosa', bo('2026-09-28 17:00'), TCO);
    expect(a2.map((r) => r.clave)).toEqual(['renovacion_2026-10_1', 'renovacion_2026-10_2']);
    expect(DIAS_AVISO_RENOVACION).toEqual([7, 2]);
  });

  it('un aviso ya enviado no se repite, aunque el flujo corra dos veces por día', () => {
    const cuenta = { ...pagado, recordatorios: { 'renovacion_2026-10_1': { en: 1 } } };
    const r = recordatoriosDebidos(cuenta, estadoEl(cuenta, 0, '2026-09'), 'Salón Rosa', bo('2026-09-24 17:00'), TCO);
    expect(r).toEqual([]);
  });

  it('si el mes siguiente ya está pagado, no hay aviso de renovación', () => {
    const cuenta = { ...pagado, periodoPagado: '2026-10' };
    const r = recordatoriosDebidos(cuenta, estadoEl(cuenta, 0, '2026-09'), 'Salón Rosa', bo('2026-09-29 09:00'), TCO);
    expect(r).toEqual([]);
  });

  it('el mes de prueba también avisa que hay que elegir plan', () => {
    const cuenta = { modalidad: 'prueba', periodoPrueba: '2026-09', bolsaPrueba: 20 };
    const r = recordatoriosDebidos(cuenta, estadoEl(cuenta, 0, '2026-09'), 'Salón Rosa', bo('2026-09-24 09:00'), TCO);
    expect(r).toHaveLength(1);
    expect(r[0]?.parametros[1]).toBe('mes de prueba');
  });

  it('cortado por falta de pago: UN aviso, con los mensajes perdidos', () => {
    const cuenta = { ...pagado, corte: { motivo: 'sin_pago', desde: bo('2026-10-01 00:00'), perdidas: 4 } };
    const r = recordatoriosDebidos(cuenta, estadoEl(cuenta, 0, '2026-10'), 'Salón Rosa', bo('2026-10-01 09:00'), TCO);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ clave: 'corte_pago_2026-10', plantilla: PLANTILLAS.cortePago.nombre,
      parametros: ['Salón Rosa', '01/10/2026', '4'] });
    // Dos días después, ya enviado: nada más.
    const enviado = { ...cuenta, recordatorios: { 'corte_pago_2026-10': { en: 1 } } };
    expect(recordatoriosDebidos(enviado, estadoEl(enviado, 0, '2026-10'), 'Salón Rosa', bo('2026-10-03 09:00'), TCO)).toEqual([]);
  });

  it('cortado por conversaciones: uno al cortar y otro a los dos días', () => {
    const desde = bo('2026-09-20 15:30');
    const cuenta = { ...pagado, corte: { motivo: 'sin_conversaciones', desde, perdidas: 9 } };
    const estado = estadoEl(cuenta, 120, '2026-09');
    expect(estado.motivo).toBe('sin_conversaciones');

    const hoy = recordatoriosDebidos(cuenta, estado, 'Salón Rosa', bo('2026-09-20 17:00'), TCO);
    expect(hoy.map((r) => r.clave)).toEqual([`corte_conversaciones_${desde}_1`]);
    // El importe va en bolivianos, convertido con el TCO del BCB: 10 × 12,60.
    expect(hoy[0]?.parametros).toEqual(['Salón Rosa', 'Plan Base', '9', 'Bs 126']);

    const enDos = recordatoriosDebidos(cuenta, estado, 'Salón Rosa', bo('2026-09-22 17:00'), TCO);
    expect(enDos.map((r) => r.clave))
      .toEqual([`corte_conversaciones_${desde}_1`, `corte_conversaciones_${desde}_2`]);
  });

  it('un segundo corte en el mismo mes tiene claves nuevas: se avisa otra vez', () => {
    const cuenta = { ...pagado, bolsa: 0,
      corte: { motivo: 'sin_conversaciones', desde: bo('2026-09-25 10:00'), perdidas: 0 },
      recordatorios: { [`corte_conversaciones_${bo('2026-09-20 15:30')}_1`]: { en: 1 } } };
    const r = recordatoriosDebidos(cuenta, estadoEl(cuenta, 120, '2026-09'), 'Salón Rosa', bo('2026-09-25 17:00'), TCO);
    expect(r.some((x) => x.tipo === 'corteConversaciones')).toBe(true);
  });

  it('un corte va antes que una renovación, y el corte por pago no repite el de renovación', () => {
    const cuenta = { ...pagado, corte: { motivo: 'sin_pago', desde: bo('2026-10-01 00:00'), perdidas: 0 } };
    const r = recordatoriosDebidos(cuenta, estadoEl(cuenta, 0, '2026-10'), 'Salón Rosa', bo('2026-10-01 09:00'), TCO);
    expect(r[0]?.tipo).toBe('cortePago');
    expect(r.filter((x) => x.tipo === 'renovacion')).toEqual([]);
  });
});

describe('Los textos que lee el negocio', () => {
  it('las plantillas dicen que los clientes están sin atención, y sin voseo', () => {
    for (const p of Object.values(PLANTILLAS)) {
      expect(p.cuerpo).toMatch(/clientes/);
      expect(p.cuerpo).toMatch(/sin (recibir )?atenci/);
      expect(VOSEO.test(p.cuerpo)).toBe(false);
      // Las variables van numeradas de corrido, como exige Meta.
      p.variables.forEach((_, i) => expect(p.cuerpo).toContain(`{{${i + 1}}}`));
    }
  });

  it('el mensaje al cliente final es fijo, cordial y no menciona pagos', () => {
    expect(MENSAJE_CORTESIA.toLowerCase()).not.toMatch(/deuda|deb[eo]|pago|suspend|mora|impago|conversacion/);
    expect(MENSAJE_CORTESIA).toMatch(/Gracias/);
  });

  it('el resumen de cuenta dice lo que corresponde a cada estado', () => {
    const pagado = { modalidad: 'prepago', plan: 'base', periodoPagado: '2026-09', bolsa: 25 };
    expect(resumenDeCuenta(estadoDeServicio(pagado, 10, '2026-09'), 'Salón Rosa', TCO))
      .toMatch(/Plan Base, pagado hasta el 30\/09\/2026\. Te quedan 135 conversaciones/);
    expect(resumenDeCuenta(estadoDeServicio(pagado, 0, '2026-10'), 'Salón Rosa', TCO)).toMatch(/DETENIDO.*no está pagado/);
    expect(resumenDeCuenta(estadoDeServicio({ ...pagado, bolsa: 0 }, 300, '2026-09'), 'Salón Rosa', TCO))
      .toMatch(/DETENIDO.*agotaron/);
    expect(resumenDeCuenta(estadoDeServicio({}, 0, '2026-09'), 'Demo', TCO)).toMatch(/demostración/);
    for (const texto of [
      resumenDeCuenta(estadoDeServicio(pagado, 10, '2026-09'), 'X', TCO),
      resumenDeCuenta(estadoDeServicio(pagado, 0, '2026-10'), 'X', TCO),
    ]) expect(VOSEO.test(texto)).toBe(false);
  });

  it('corteDe descarta un corte mal formado', () => {
    expect(corteDe({ corte: { motivo: 'otro' } })).toBeNull();
    expect(corteDe({ corte: 'sin_pago' })).toBeNull();
    expect(corteDe({ corte: { motivo: 'sin_pago', desde: { seconds: 10 }, perdidas: 'x' } }))
      .toEqual({ motivo: 'sin_pago', desdeMs: 10_000, perdidas: 0 });
  });
});
