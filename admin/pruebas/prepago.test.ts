/**
 * EL MÓDULO PURO DEL PREPAGO (`functions/src/prepago.ts`), sin emulador.
 *
 * Sobre esto se le corta el servicio a un comercio que paga y se le escribe
 * para cobrarle, así que se prueba mes por mes y HORA POR HORA en los bordes:
 * la gracia de 48 horas (D0 = día 1 a las 00:00 de Bolivia, corte a las 00:00
 * del día 3), la cobertura por instantes, el saldo con bolsas, el pago de 1 a
 * 6 meses (y el 7 que no entra), el calendario de cobranza D-5 / D-1 / D0 /
 * D+2 / D+4 con sus claves idempotentes, y los textos: el de cortesía nunca
 * dice «pago» ni «mantenimiento», y las plantillas no vosean.
 *
 * Y LAS NEGATIVAS, que son la condición de fusión del bloque A-0: una cuenta
 * sin modalidad, en demostración o con plan de demostración NO se corta, con
 * la bandera encendida o apagada; y PRUEBA no recibe cobranza.
 */
import { describe, expect, it } from 'vitest';
import {
  BOLSA, DIAS_AVISO_CORTE, DIAS_AVISO_RENOVACION, GRACIA_MS, MENSAJE_CORTESIA, MESES_MAXIMO,
  PLANTILLAS, PRUEBA, VOSEO, aplicarPago, camposDerivados, consumoDeConversacion, corteAplicable,
  corteDe, descripcionDe, diasDelPeriodo, esPago, esTipoCambio, estadoDeServicio, fechaEscrita,
  fechaFinDelPeriodo, finDelPeriodoMs, importeBs, inicioDelPeriodoMs, mensajeCortesia, mesBolivia,
  modalidadDe, montoUsdDe, periodoAnterior, periodoSiguiente, periodosIncoherentes, rechazoPorPrepago,
  recordatoriosDebidos,
  resumenDeCuenta, sumarMeses, tipoCambioVigente, type ContextoRecordatorio, type CuentaCruda,
} from '../functions/src/prepago.ts';
import { PLANES, limitesDe } from '../functions/src/planes.ts';

const HORA = 3_600_000;
/** Un instante en hora de Bolivia (UTC−4), en milisegundos. */
const bo = (y: number, m: number, d: number, h = 0, mi = 0, s = 0) =>
  Date.UTC(y, m - 1, d, h, mi, s) + 4 * HORA;
const ts = (ms: number) => ({ toMillis: () => ms });
const TCO = 12.6;
const SIN_TCO = { tco: null, numeroRecepcion: '' };
const CON_TCO = { tco: TCO, numeroRecepcion: '70000001' };

/** Una cuenta prepago con Crecimiento y su copia de límites. */
const prepago = (extra: Partial<CuentaCruda> = {}): CuentaCruda => ({
  modalidad: 'prepago', plan: 'crecimiento', limites: limitesDe('crecimiento'), ...extra,
});

describe('Períodos en hora de Bolivia', () => {
  it('el mes de Bolivia no es el mes UTC en las cuatro horas de desfase', () => {
    // 30/09 23:59 de Bolivia es 01/10 03:59 UTC.
    expect(mesBolivia(bo(2026, 9, 30, 23, 59))).toBe('2026-09');
    expect(new Date(bo(2026, 9, 30, 23, 59)).toISOString().slice(0, 7)).toBe('2026-10');
    expect(mesBolivia(bo(2026, 10, 1, 0, 0))).toBe('2026-10');
  });

  it('suma meses cruzando el año, y conoce los días de cada mes', () => {
    expect(sumarMeses('2026-11', 3)).toBe('2027-02');
    expect(periodoSiguiente('2026-12')).toBe('2027-01');
    expect(periodoAnterior('2026-01')).toBe('2025-12');
    expect(diasDelPeriodo('2026-02')).toBe(28);
    expect(diasDelPeriodo('2028-02')).toBe(29);
    expect(diasDelPeriodo('2026-10')).toBe(31);
  });

  it('el fin de un mes es el instante anterior al inicio del siguiente', () => {
    expect(finDelPeriodoMs('2026-10')).toBe(inicioDelPeriodoMs('2026-11') - 1);
    expect(inicioDelPeriodoMs('2026-11')).toBe(bo(2026, 11, 1));
    expect(fechaFinDelPeriodo('2026-10')).toBe('31/10/2026');
    expect(fechaEscrita(bo(2026, 11, 1))).toBe('1 de noviembre de 2026');
  });
});

describe('La modalidad que rige, y la salvaguarda de los demos', () => {
  it('sin modalidad es demostración; con basura, también', () => {
    expect(modalidadDe(undefined)).toBe('demostracion');
    expect(modalidadDe({})).toBe('demostracion');
    expect(modalidadDe({ modalidad: 'gratis' })).toBe('demostracion');
    expect(modalidadDe({ modalidad: 'prepago' })).toBe('prepago');
  });

  it('el plan NO opina sobre la modalidad (F1): un plan viejo «demostracion» con modalidad prepago es prepago', () => {
    // Hasta el 25/09 el plan mandaba («doble salvaguarda»). Desde F1 la
    // modalidad es el único eje que decide si se cobra (`Analisis/41` §4).
    expect(modalidadDe({ plan: 'demostracion', modalidad: 'prepago' })).toBe('prepago');
    expect(modalidadDe({ plan: 'pro', modalidad: 'demostracion' })).toBe('demostracion');
  });

  it('una demostración es operativa siempre, con cualquier consumo y sin pago', () => {
    for (const cuenta of [{}, { modalidad: 'demostracion' }, { plan: 'pro', modalidad: 'demostracion', periodoPagado: '2025-01' }]) {
      const e = estadoDeServicio(cuenta, 99_999, bo(2026, 10, 15));
      expect(e).toMatchObject({ operativo: true, motivo: null, fase: 'cubierto', modalidad: 'demostracion' });
      expect(e.disponibles).toBe(Number.POSITIVE_INFINITY);
      expect(rechazoPorPrepago(e.motivo, true)).toBeNull();
    }
  });
});

describe('Cobertura por instantes y la gracia de 48 horas', () => {
  const cuenta = prepago({ periodoPagado: '2026-09' });

  it('el último instante del mes pagado sigue cubierto', () => {
    const e = estadoDeServicio(cuenta, 0, bo(2026, 9, 30, 23, 59, 59));
    expect(e).toMatchObject({ operativo: true, fase: 'cubierto', cubierto: true, graciaHasta: null });
  });

  it('desde las 00:00 del día 1 hay gracia, hasta las 00:00 del día 3', () => {
    const d0 = bo(2026, 10, 1);
    for (const ms of [d0, d0 + HORA, bo(2026, 10, 2, 23, 59, 59)]) {
      const e = estadoDeServicio(cuenta, 0, ms);
      expect(e).toMatchObject({ operativo: true, fase: 'gracia', cubierto: false, motivo: null });
      expect(e.graciaHasta).toBe(bo(2026, 10, 3));
      expect(e.graciaHasta).toBe(d0 + GRACIA_MS);
    }
  });

  it('a las 00:00 del día 3 se corta por falta de pago, y «desde» es ese instante', () => {
    for (const ms of [bo(2026, 10, 3), bo(2026, 10, 3, 0, 1), bo(2026, 10, 20)]) {
      const e = estadoDeServicio(cuenta, 0, ms);
      expect(e).toMatchObject({ operativo: false, fase: 'cortado', motivo: 'sin_pago', disponibles: 0 });
      expect(e.corteDesdeMs).toBe(bo(2026, 10, 3));
      expect(rechazoPorPrepago(e.motivo, false)).toBe('sin_pago');
    }
  });

  it('la gracia solo es del primer mes sin cobertura: dos meses después no hay gracia', () => {
    expect(estadoDeServicio(cuenta, 0, bo(2026, 11, 1, 12)).fase).toBe('cortado');
  });

  it('un período PRESENTE y mal formado no es un impago: se atiende, y queda marcado como incoherente', () => {
    // Revisión de seguridad de A-0: `'2026-9'`, un Timestamp o `null` son un
    // dato corrupto o a medio migrar, no un comercio que no pagó.
    for (const periodoPagado of ['2026-9', ts(1), null, 202609, '']) {
      const e = estadoDeServicio(prepago({ periodoPagado }), 500, bo(2026, 10, 15));
      expect(e).toMatchObject({ operativo: true, fase: 'cubierto', motivo: null, incoherente: true });
      expect(rechazoPorPrepago(e.motivo, true)).toBeNull();
      expect(consumoDeConversacion(e)).toEqual({ campoBolsa: null, cortaDespues: false });
      expect(periodosIncoherentes(prepago({ periodoPagado }))).toEqual(['periodoPagado']);
    }
    const prueba = { modalidad: 'prueba', periodoPrueba: null, bolsaPrueba: 0 };
    expect(estadoDeServicio(prueba, 0, bo(2026, 10, 15))).toMatchObject({ operativo: true, incoherente: true });
    expect(periodosIncoherentes(prueba)).toEqual(['periodoPrueba']);
    // Ausente no es incoherente: es «nunca pagó», y se juzga como tal.
    expect(periodosIncoherentes(prepago())).toEqual([]);
    expect(estadoDeServicio(prepago(), 0, bo(2026, 10, 15)).incoherente).toBe(false);
    // Una demostración con basura sigue siendo demostración, sin marca.
    expect(periodosIncoherentes({ periodoPagado: 'x' })).toEqual([]);
    expect(estadoDeServicio({ periodoPagado: 'x' }, 0, bo(2026, 10, 15)).incoherente).toBe(false);
    // Y no recibe cobranza.
    expect(recordatoriosDebidos(prepago({ periodoPagado: null }), estadoDeServicio(prepago({ periodoPagado: null }), 0, bo(2026, 10, 30)), bo(2026, 10, 30), CON_TCO)).toEqual([]);
  });

  it('una cuenta prepago que nunca pagó está cortada, sin gracia ni fecha de corte', () => {
    const e = estadoDeServicio(prepago(), 0, bo(2026, 10, 1, 0, 30));
    expect(e).toMatchObject({ operativo: false, motivo: 'sin_pago', fase: 'cortado', corteDesdeMs: null, cubiertoHasta: '' });
  });

  it('en gracia siguen valiendo las conversaciones del plan y las bolsas', () => {
    const e = estadoDeServicio(prepago({ periodoPagado: '2026-09', bolsa: 4 }), 10, bo(2026, 10, 1, 12));
    expect(e).toMatchObject({ fase: 'gracia', incluidas: 220, restanteDelPlan: 210, disponibles: 214 });
  });
});

describe('El saldo de conversaciones', () => {
  const cubierta = prepago({ periodoPagado: '2026-10' });
  const AHORA = bo(2026, 10, 15, 12);

  it('las incluidas salen de la copia de límites, no del catálogo', () => {
    const e = estadoDeServicio(prepago({ periodoPagado: '2026-10', limites: { conversaciones: 7, productos: 1, agendas: 1 } }), 2, AHORA);
    expect(e).toMatchObject({ incluidas: 7, restanteDelPlan: 5, disponibles: 5, operativo: true });
  });

  it('con las incluidas agotadas y sin bolsa, corta por conversaciones', () => {
    const e = estadoDeServicio(cubierta, 220, AHORA);
    expect(e).toMatchObject({ operativo: false, motivo: 'sin_conversaciones', fase: 'cortado', disponibles: 0 });
    // Rechaza solo lo que abriría una conversación: la ventana abierta sigue.
    expect(rechazoPorPrepago(e.motivo, true)).toBe('sin_conversaciones');
    expect(rechazoPorPrepago(e.motivo, false)).toBeNull();
  });

  it('BYOC corta a las 2.000: el comercio NO puede pasar su tope (`Analisis/39`)', () => {
    // Escrita negando, como pide `CLAUDE.md` §7.3. El tope de BYOC es cuatro
    // veces el de Pro, así que lo que hay que probar es que EXISTE: un plan
    // grande sin corte es la forma más fácil de perder plata sin enterarse.
    const byoc = prepago({ periodoPagado: '2026-10', plan: 'byoc', limites: limitesDe('byoc') });

    const ultima = estadoDeServicio(byoc, 1999, AHORA);
    expect(ultima).toMatchObject({ incluidas: 2000, disponibles: 1, operativo: true });

    const agotado = estadoDeServicio(byoc, 2000, AHORA);
    expect(agotado).toMatchObject({ operativo: false, motivo: 'sin_conversaciones', disponibles: 0 });
    expect(rechazoPorPrepago(agotado.motivo, true)).toBe('sin_conversaciones');

    // Y no hereda el tope de Pro por recorrer la escalera publicada.
    expect(estadoDeServicio(byoc, PLANES.pro.conversaciones, AHORA)).toMatchObject({ operativo: true });
  });

  it('las bolsas sostienen el servicio cuando las incluidas se acabaron', () => {
    const e = estadoDeServicio(prepago({ periodoPagado: '2026-10', bolsa: 3 }), 220, AHORA);
    expect(e).toMatchObject({ operativo: true, disponibles: 3, restanteDelPlan: 0 });
    expect(consumoDeConversacion(e)).toEqual({ campoBolsa: 'bolsa', cortaDespues: false });
    const ultima = estadoDeServicio(prepago({ periodoPagado: '2026-10', bolsa: 1 }), 220, AHORA);
    expect(consumoDeConversacion(ultima)).toEqual({ campoBolsa: 'bolsa', cortaDespues: true });
  });

  it('mientras queden incluidas no se toca la bolsa', () => {
    expect(consumoDeConversacion(estadoDeServicio(prepago({ periodoPagado: '2026-10', bolsa: 3 }), 219, AHORA)))
      .toEqual({ campoBolsa: null, cortaDespues: false });
  });

  it('en prueba se descuenta la bolsa de prueba y las incluidas son cero', () => {
    const e = estadoDeServicio({ modalidad: 'prueba', periodoPrueba: '2026-10', bolsaPrueba: PRUEBA.conversaciones }, 0, AHORA);
    expect(e).toMatchObject({ enPrueba: true, incluidas: 0, disponibles: 20, mensualidadUsd: 0, operativo: true });
    expect(consumoDeConversacion(e)).toEqual({ campoBolsa: 'bolsaPrueba', cortaDespues: false });
    const agotada = estadoDeServicio({ modalidad: 'prueba', periodoPrueba: '2026-10', bolsaPrueba: 0 }, 0, AHORA);
    expect(agotada).toMatchObject({ operativo: false, motivo: 'sin_conversaciones' });
  });

  it('la prueba termina con el mes: gracia y después corte por falta de pago', () => {
    const c = { modalidad: 'prueba', periodoPrueba: '2026-10', bolsaPrueba: 15 };
    expect(estadoDeServicio(c, 0, bo(2026, 11, 2, 23))).toMatchObject({ fase: 'gracia', operativo: true, enPrueba: true });
    expect(estadoDeServicio(c, 0, bo(2026, 11, 3))).toMatchObject({ fase: 'cortado', motivo: 'sin_pago', operativo: false });
  });

  it('el mes de prueba no cubre a una cuenta que ya es prepago', () => {
    expect(estadoDeServicio({ modalidad: 'prepago', periodoPrueba: '2026-10' }, 0, AHORA).motivo).toBe('sin_pago');
  });

  it('una demostración no consume ninguna bolsa', () => {
    expect(consumoDeConversacion(estadoDeServicio({}, 500, AHORA))).toEqual({ campoBolsa: null, cortaDespues: false });
  });
});

describe('La bandera de modo observación (`corteAplicable`)', () => {
  const encendida = { corteActivo: true };
  it('nunca se aplica a una demostración, ni con la bandera encendida', () => {
    expect(corteAplicable({}, encendida)).toBe(false);
    expect(corteAplicable({ modalidad: 'demostracion', corteActivo: true }, encendida)).toBe(false);
    expect(corteAplicable({ plan: 'pro', modalidad: 'demostracion', corteActivo: true }, encendida)).toBe(false);
    // Y un plan viejo «demostracion» ya no exime: la modalidad decide (F1).
    expect(corteAplicable({ plan: 'demostracion', modalidad: 'prepago', corteActivo: true }, encendida)).toBe(true);
  });

  it('con modalidad, se aplica solo si la global o la del tenant están encendidas', () => {
    expect(corteAplicable(prepago(), undefined)).toBe(false);
    expect(corteAplicable(prepago(), {})).toBe(false);
    expect(corteAplicable(prepago(), { corteActivo: 'true' })).toBe(false);
    expect(corteAplicable(prepago(), encendida)).toBe(true);
    expect(corteAplicable(prepago({ corteActivo: true }), {})).toBe(true);
    expect(corteAplicable({ modalidad: 'prueba', corteActivo: true }, {})).toBe(true);
  });

  it('un `corteActivo: false` por tenant NO exime: la exención es la modalidad', () => {
    expect(corteAplicable(prepago({ corteActivo: false }), encendida)).toBe(true);
  });
});

describe('El corte guardado', () => {
  it('se lee con sus cinco campos, tolerando un Timestamp en `desde`', () => {
    expect(corteDe({ corte: { motivo: 'sin_pago', desde: ts(123), perdidas: 3, mensajesPerdidos: 9, aplicado: true } }))
      .toEqual({ motivo: 'sin_pago', desdeMs: 123, perdidas: 3, mensajesPerdidos: 9, aplicado: true });
    expect(corteDe({ corte: { motivo: 'sin_conversaciones' } }))
      .toEqual({ motivo: 'sin_conversaciones', desdeMs: 0, perdidas: 0, mensajesPerdidos: 0, aplicado: false });
  });

  it('un motivo desconocido no es un corte', () => {
    expect(corteDe({ corte: { motivo: 'mantenimiento' } })).toBeNull();
    expect(corteDe({})).toBeNull();
    expect(corteDe(undefined)).toBeNull();
  });
});

describe('Los campos derivados de la situación de pago', () => {
  const AHORA = bo(2026, 10, 15, 12);
  it('demostración: sin cargo, sin vencimiento, monto cero', () => {
    expect(camposDerivados(estadoDeServicio({}, 0, AHORA), {}))
      .toEqual({ estadoPago: 'sin_cargo', proximoVencimientoMs: null, montoMensual: 0, moneda: 'USD' });
  });

  it('cubierto: al día, vence al fin del mes pagado, con el precio del plan', () => {
    const c = prepago({ periodoPagado: '2026-11' });
    expect(camposDerivados(estadoDeServicio(c, 0, AHORA), c))
      .toEqual({ estadoPago: 'al_dia', proximoVencimientoMs: finDelPeriodoMs('2026-11'), montoMensual: 50, moneda: 'USD' });
  });

  it('en gracia o con un cobro pendiente es `pendiente`; sin pago es `vencido`', () => {
    const c = prepago({ periodoPagado: '2026-09' });
    expect(camposDerivados(estadoDeServicio(c, 0, bo(2026, 10, 2)), c).estadoPago).toBe('pendiente');
    expect(camposDerivados(estadoDeServicio(c, 0, bo(2026, 10, 5)), c).estadoPago).toBe('vencido');
    const conCobro = prepago({ periodoPagado: '2026-10', pagoPendienteId: 'abc' });
    expect(camposDerivados(estadoDeServicio(conCobro, 0, AHORA), conCobro).estadoPago).toBe('pendiente');
  });

  it('sin conversaciones el pago está al día: es otro corte', () => {
    const c = prepago({ periodoPagado: '2026-10' });
    expect(camposDerivados(estadoDeServicio(c, 220, AHORA), c).estadoPago).toBe('al_dia');
  });
});

describe('Aplicar un pago, mes por mes', () => {
  const AHORA = bo(2026, 10, 15, 12);

  it('una demostración que paga su primer mes pasa a prepago cubriendo el mes en curso', () => {
    expect(aplicarPago({ plan: 'impulso' }, { tipo: 'mensualidad', plan: 'impulso', meses: 1 }, AHORA))
      .toEqual({ plan: 'impulso', modalidad: 'prepago', periodoPagado: '2026-10', bolsa: 0, cubiertoHasta: '2026-10' });
  });

  it('con el mes cubierto, el pago cubre el siguiente; tres meses, tres siguientes', () => {
    const c = prepago({ periodoPagado: '2026-10' });
    expect(aplicarPago(c, { tipo: 'mensualidad', plan: 'crecimiento', meses: 1 }, AHORA).periodoPagado).toBe('2026-11');
    expect(aplicarPago(c, { tipo: 'mensualidad', plan: 'crecimiento', meses: 3 }, AHORA).periodoPagado).toBe('2027-01');
  });

  it('en gracia o cortado, el pago cubre el mes en curso: nunca se cobra un mes pasado', () => {
    expect(aplicarPago(prepago({ periodoPagado: '2026-09' }), { tipo: 'mensualidad', plan: 'crecimiento', meses: 1 }, bo(2026, 10, 2)).periodoPagado).toBe('2026-10');
    expect(aplicarPago(prepago({ periodoPagado: '2026-07' }), { tipo: 'mensualidad', plan: 'crecimiento', meses: 2 }, AHORA).periodoPagado).toBe('2026-11');
  });

  it('cambiar de plan es pagar el plan nuevo', () => {
    expect(aplicarPago(prepago({ periodoPagado: '2026-10' }), { tipo: 'mensualidad', plan: 'pro', meses: 1 }, AHORA).plan).toBe('pro');
  });

  it('al pagar 6 meses se regala una bolsa; con 5 no; con 7 no se aplica', () => {
    const c = prepago({ periodoPagado: '2026-10', bolsa: 2 });
    const seis = aplicarPago(c, { tipo: 'mensualidad', plan: 'crecimiento', meses: MESES_MAXIMO }, AHORA);
    expect(seis).toMatchObject({ periodoPagado: '2027-04', bolsa: 2 + BOLSA.conversaciones });
    expect(aplicarPago(c, { tipo: 'mensualidad', plan: 'crecimiento', meses: 5 }, AHORA).bolsa).toBe(2);
    for (const meses of [0, 7, 12, 1.5, -1]) {
      expect(() => aplicarPago(c, { tipo: 'mensualidad', plan: 'crecimiento', meses }, AHORA)).toThrow();
    }
    expect(() => aplicarPago(c, { tipo: 'mensualidad', plan: 'demostracion' as never, meses: 1 }, AHORA)).toThrow();
  });

  it('una bolsa suma 30 por unidad y no mueve el período; la prueba que compra pasa a prepago', () => {
    const c = prepago({ periodoPagado: '2026-10', bolsa: 1 });
    expect(aplicarPago(c, { tipo: 'bolsa', cantidad: 2 }, AHORA)).toMatchObject({ bolsa: 61, periodoPagado: '2026-10', modalidad: 'prepago' });
    expect(aplicarPago({ modalidad: 'prueba', periodoPrueba: '2026-10' }, { tipo: 'bolsa', cantidad: 1 }, AHORA).modalidad).toBe('prueba');
    expect(() => aplicarPago(c, { tipo: 'bolsa', cantidad: 13 }, AHORA)).toThrow();
  });

  it('la prueba vigente cuenta como cubierta: el pago cubre el mes siguiente', () => {
    const r = aplicarPago({ modalidad: 'prueba', periodoPrueba: '2026-10' }, { tipo: 'mensualidad', plan: 'impulso', meses: 1 }, AHORA);
    expect(r).toMatchObject({ modalidad: 'prepago', periodoPagado: '2026-11', plan: 'impulso' });
  });

  it('la instalación no cambia nada de la cuenta', () => {
    const c = prepago({ periodoPagado: '2026-10', bolsa: 1 });
    expect(aplicarPago(c, { tipo: 'instalacion' }, AHORA)).toEqual({ plan: 'crecimiento', modalidad: 'prepago', periodoPagado: '2026-10', bolsa: 1, cubiertoHasta: '2026-10' });
    expect(montoUsdDe({ tipo: 'instalacion' })).toBe(65);
  });

  it('importe y descripción, en dólares y del catálogo', () => {
    expect(montoUsdDe({ tipo: 'mensualidad', plan: 'pro', meses: 3 })).toBe(270);
    expect(montoUsdDe({ tipo: 'bolsa', cantidad: 2 })).toBe(20);
    expect(descripcionDe({ tipo: 'mensualidad', plan: 'crecimiento', meses: 3 })).toBe('Crecimiento · 3 meses');
    expect(descripcionDe({ tipo: 'mensualidad', plan: 'impulso', meses: 1 })).toBe('Impulso · 1 mes');
    expect(descripcionDe({ tipo: 'bolsa', cantidad: 1 })).toBe('Bolsa de 30 conversaciones');
    expect(esPago({ tipo: 'mensualidad', plan: 'impulso', meses: 6 })).toBe(true);
    expect(esPago({ tipo: 'mensualidad', plan: 'impulso', meses: 7 })).toBe(false);
    expect(esPago({ tipo: 'regalo' })).toBe(false);
  });
});

describe('El tipo de cambio y el importe en bolivianos', () => {
  it('redondea al boliviano y lanza sin un TCO válido', () => {
    expect(importeBs(50, TCO)).toBe(630);
    expect(importeBs(25, 6.96)).toBe(174);
    expect(() => importeBs(50, 0)).toThrow();
    expect(() => importeBs(50, 400)).toThrow();
    expect(() => importeBs(-1, TCO)).toThrow();
  });

  it('un TCO vale por fecha del día, hasta cuatro días; sin fuente o con un cero de más no vale', () => {
    const bueno = { tco: TCO, fecha: '2026-10-24', fuente: 'BCB' };
    expect(esTipoCambio(bueno)).toBe(true);
    expect(esTipoCambio({ tco: 126, fecha: '2026-10-24', fuente: 'BCB' })).toBe(false);
    expect(esTipoCambio({ tco: TCO, periodo: '2026-10', fuente: 'BCB' })).toBe(false);
    expect(esTipoCambio({ tco: TCO, fecha: '2026-10-24', fuente: '' })).toBe(false);
    expect(tipoCambioVigente(bueno, bo(2026, 10, 28, 23))).toEqual(bueno);
    expect(tipoCambioVigente(bueno, bo(2026, 10, 29, 1))).toBeNull();
    expect(tipoCambioVigente(bueno, bo(2026, 10, 22))).toBeNull();
    expect(tipoCambioVigente(undefined, bo(2026, 10, 24))).toBeNull();
  });
});

describe('El mensaje al cliente final', () => {
  const PROHIBIDO = /pago|deuda|mantenimiento|suspend|moros/i;
  it('sin teléfono es el texto de siempre; con teléfono lo suma', () => {
    expect(mensajeCortesia(undefined)).toBe(MENSAJE_CORTESIA);
    expect(mensajeCortesia('')).toBe(MENSAJE_CORTESIA);
    expect(mensajeCortesia('70000001')).toBe(`${MENSAJE_CORTESIA} Puede comunicarse al 70000001.`);
    expect(mensajeCortesia(' +591 7000-0001 ')).toContain('Puede comunicarse al +591 7000-0001.');
  });

  it('un teléfono con basura no se dice', () => {
    expect(mensajeCortesia('llamar al 7000')).toBe(MENSAJE_CORTESIA);
    expect(mensajeCortesia('<script>')).toBe(MENSAJE_CORTESIA);
    expect(mensajeCortesia(70000001)).toBe(MENSAJE_CORTESIA);
  });

  it('nunca dice «pago», «deuda» ni «mantenimiento», y no vosea', () => {
    for (const t of [mensajeCortesia(undefined), mensajeCortesia('70000001')]) {
      expect(t).not.toMatch(PROHIBIDO);
      expect(t).not.toMatch(VOSEO);
    }
  });
});

describe('Las plantillas de cobranza (docs/plantillas-cobranza.md)', () => {
  it('tienen los ocho nombres del documento', () => {
    expect(Object.values(PLANTILLAS).map((p) => p.nombre)).toEqual([
      'mensualidad_vence_pronto', 'mensualidad_vence_manana', 'mensualidad_vencida_gracia',
      'asistente_sin_atender', 'asistente_sin_atender_perdidas', 'conversaciones_agotadas',
      'prueba_termina', 'pago_confirmado',
    ]);
  });

  it('cada cuerpo usa exactamente sus variables, en orden y sin empezar ni terminar con una', () => {
    for (const p of Object.values(PLANTILLAS)) {
      const usadas = [...p.cuerpo.matchAll(/\{\{(\d)\}\}/g)].map((m) => Number(m[1]));
      expect(usadas).toEqual(p.variables.map((_, i) => i + 1));
      expect(p.cuerpo).not.toMatch(/^\{\{/);
      expect(p.cuerpo).not.toMatch(/\}\}$/);
      expect(p.cuerpo).not.toMatch(/\}\}[,.:;]? ?\{\{/);
      expect(p.cuerpo).not.toContain('\n');
      expect(p.cuerpo).toContain('NovuChat');
    }
  });

  it('ninguna vosea ni vende', () => {
    for (const p of Object.values(PLANTILLAS)) {
      expect(p.cuerpo).not.toMatch(VOSEO);
      expect(p.cuerpo).not.toMatch(/aprovech|promoci|oferta|descuento/i);
    }
  });
});

describe('El calendario de cobranza (`recordatoriosDebidos`)', () => {
  // Octubre tiene 31 días: D0 = 1 de noviembre.
  const cuenta = prepago({ periodoPagado: '2026-10' });
  const debidos = (c: CuentaCruda, ms: number, ctx: ContextoRecordatorio = CON_TCO) =>
    recordatoriosDebidos(c, estadoDeServicio(c, 0, ms), ms, ctx);
  const claves = (c: CuentaCruda, ms: number, ctx: ContextoRecordatorio = CON_TCO) =>
    debidos(c, ms, ctx).map((r) => r.clave);

  it('D-5: seis días antes nada; cinco días antes, «vence pronto» con importe en Bs', () => {
    expect(claves(cuenta, bo(2026, 10, 26, 10))).toEqual([]);
    const [r] = debidos(cuenta, bo(2026, 10, 27, 10));
    expect(r).toMatchObject({ tipo: 'vencePronto', clave: 'vence_pronto_2026-11', plantilla: 'mensualidad_vence_pronto', conImporte: true });
    expect(r!.parametros).toEqual(['1 de noviembre de 2026', '630', 'Crecimiento', '1 mes']);
    expect(DIAS_AVISO_RENOVACION).toEqual({ primero: 5, ultimo: 1 });
  });

  it('sigue debido hasta que se marca; marcado, no vuelve', () => {
    expect(claves(cuenta, bo(2026, 10, 30, 10))).toEqual(['vence_pronto_2026-11']);
    expect(claves({ ...cuenta, recordatorios: { 'vence_pronto_2026-11': 1 } }, bo(2026, 10, 30, 10))).toEqual([]);
  });

  it('D-1: el último día del mes sale solo «vence mañana», aunque el D-5 no haya salido', () => {
    const lista = debidos(cuenta, bo(2026, 10, 31, 18));
    expect(lista.map((r) => r.tipo)).toEqual(['venceManana']);
    expect(lista[0]!.parametros[0]).toBe('1 de noviembre de 2026');
  });

  it('con el mes que viene ya pagado no hay renovación que avisar', () => {
    expect(claves(prepago({ periodoPagado: '2026-11' }), bo(2026, 10, 31, 10))).toEqual([]);
  });

  it('D0: en gracia sale «vencida», y ninguna renovación', () => {
    const lista = debidos(cuenta, bo(2026, 11, 1, 12));
    expect(lista.map((r) => r.tipo)).toEqual(['vencida']);
    expect(lista[0]).toMatchObject({ clave: 'vencida_2026-11', plantilla: 'mensualidad_vencida_gracia' });
    expect(lista[0]!.parametros).toEqual(['1 de noviembre de 2026', '630', 'Crecimiento', '1 mes']);
    expect(claves(cuenta, bo(2026, 11, 2, 23))).toEqual(['vencida_2026-11']);
  });

  it('D+2: cortado, con el teléfono de recepción; D+4: el segundo aviso con las pérdidas', () => {
    expect(DIAS_AVISO_CORTE).toEqual({ primero: 2, segundo: 4 });
    const dia3 = debidos(cuenta, bo(2026, 11, 3, 10));
    expect(dia3.map((r) => r.tipo)).toEqual(['cortePago']);
    expect(dia3[0]!.parametros).toEqual(['1 de noviembre de 2026', '70000001', '630', 'Crecimiento', '1 mes']);
    expect(claves(cuenta, bo(2026, 11, 4, 10))).toEqual(['corte_2026-11']);
    const cortada = { ...cuenta, corte: { motivo: 'sin_pago', desde: ts(bo(2026, 11, 3)), perdidas: 12, aplicado: true } };
    const dia5 = debidos(cortada, bo(2026, 11, 5, 10));
    expect(dia5.map((r) => r.tipo)).toEqual(['cortePago2']);
    expect(dia5[0]).toMatchObject({ clave: 'corte2_2026-11', plantilla: 'asistente_sin_atender_perdidas' });
    expect(dia5[0]!.parametros).toEqual(['12', '1 de noviembre de 2026', '630', 'Crecimiento', '1 mes']);
    expect(claves(cortada, bo(2026, 11, 30, 10))).toEqual(['corte2_2026-11']);
  });

  it('sin teléfono de recepción, la variable dice «no indicado» (nunca vacía)', () => {
    expect(debidos(cuenta, bo(2026, 11, 3, 10), { tco: TCO, numeroRecepcion: '' })[0]!.parametros[1]).toBe('no indicado');
  });

  it('pasado el primer mes sin pago no sale nada más por WhatsApp (D+30 va por correo)', () => {
    expect(claves(cuenta, bo(2026, 12, 5, 10))).toEqual([]);
  });

  it('sin TCO vigente no sale ningún recordatorio con importe', () => {
    expect(claves(cuenta, bo(2026, 10, 27, 10), SIN_TCO)).toEqual([]);
    expect(claves(cuenta, bo(2026, 11, 3, 10), SIN_TCO)).toEqual([]);
  });

  it('sin conversaciones: un aviso por mes, con las incluidas y el precio de la bolsa', () => {
    const agotada = prepago({ periodoPagado: '2026-10', corte: { motivo: 'sin_conversaciones', desde: ts(bo(2026, 10, 20)) } });
    const lista = recordatoriosDebidos(agotada, estadoDeServicio(agotada, 220, bo(2026, 10, 20, 10)), bo(2026, 10, 20, 10), CON_TCO);
    expect(lista.map((r) => r.clave)).toEqual(['agotadas_2026-10']);
    expect(lista[0]!.parametros).toEqual(['220', 'Crecimiento', String(importeBs(BOLSA.precioUsd, TCO))]);
  });

  it('PRUEBA: solo el aviso de conversión, cinco días antes; nada en gracia ni cortada', () => {
    const p: CuentaCruda = { modalidad: 'prueba', periodoPrueba: '2026-10', bolsaPrueba: 5, plan: 'impulso' };
    expect(claves(p, bo(2026, 10, 20, 10))).toEqual([]);
    const lista = debidos(p, bo(2026, 10, 27, 10));
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ tipo: 'conversion', clave: 'conversion_2026-10', plantilla: 'prueba_termina', conImporte: false });
    expect(lista[0]!.parametros).toEqual(['31 de octubre de 2026']);
    expect(claves(p, bo(2026, 10, 31, 10), SIN_TCO)).toEqual(['conversion_2026-10']);
    expect(claves(p, bo(2026, 11, 1, 12))).toEqual([]);
    expect(claves(p, bo(2026, 11, 5, 12))).toEqual([]);
    const agotada: CuentaCruda = { ...p, bolsaPrueba: 0, corte: { motivo: 'sin_conversaciones', desde: ts(1) } };
    expect(claves(agotada, bo(2026, 10, 20, 10))).toEqual([]);
  });

  it('DEMOSTRACIÓN: nada, nunca', () => {
    for (const c of [{}, { modalidad: 'demostracion' }, { plan: 'pro', modalidad: 'demostracion', periodoPagado: '2026-08' }]) {
      expect(claves(c, bo(2026, 10, 27, 10))).toEqual([]);
      expect(claves(c, bo(2026, 11, 5, 10))).toEqual([]);
    }
  });
});

describe('El resumen de la cuenta', () => {
  it('no vosea y dice lo que corresponde a cada fase', () => {
    const c = prepago({ periodoPagado: '2026-10', bolsa: 2 });
    for (const ms of [bo(2026, 10, 15), bo(2026, 11, 1, 12), bo(2026, 11, 5)]) {
      const t = resumenDeCuenta(estadoDeServicio(c, 10, ms), 'Salón Rosa');
      expect(t).not.toMatch(VOSEO);
      expect(t).toContain('Salón Rosa');
    }
    expect(resumenDeCuenta(estadoDeServicio(c, 10, bo(2026, 10, 15)), 'Salón')).toContain('pagado hasta el 31/10/2026');
    expect(resumenDeCuenta(estadoDeServicio(c, 10, bo(2026, 11, 1, 12)), 'Salón')).toContain('sigue atendiendo hasta el 03/11/2026');
    expect(resumenDeCuenta(estadoDeServicio(c, 10, bo(2026, 11, 5)), 'Salón')).toContain('detenido');
    expect(resumenDeCuenta(estadoDeServicio({}, 0, bo(2026, 11, 5)), 'Demo')).toContain('demostración');
    expect(PLANES.crecimiento.precioUsd).toBe(50);
  });
});
