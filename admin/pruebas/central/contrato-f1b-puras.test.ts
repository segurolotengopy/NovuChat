/**
 * F1b — LA COPIA, EL PRECIO Y LA PRUEBA POR CONTRATO, SIN EMULADOR.
 *
 * Lo que decide un cobro y un corte vive en dos módulos puros (`planes.ts`,
 * `prepago.ts`) que usan el servidor, el script y la consola. Acá se prueba
 * esa aritmética negando (`CLAUDE.md`, Base comercial: un límite se lee del
 * plan o del contrato, nunca del código, y la prueba se escribe negando):
 *
 *  - la copia manda sobre el plan también para las CONVERSACIONES, y un
 *    cambio de plan las conserva;
 *  - el PRECIO por contrato manda sobre el del plan en todo lo que cobra
 *    (mensualidad derivada, importe del QR, cobranza) y fuera de rango no
 *    cuenta;
 *  - `estadoDeServicio` usa la BOLSA DE PRUEBA tal cual está escrita;
 *  - `pruebaNueva` rechaza un mes pasado y una prueba sin modalidad prueba, y
 *    EXTENDER no deja huecos de cobertura ni adelanta el aviso de fin.
 *
 * Los instantes se pasan como argumento (nada lee el reloj): estas pruebas no
 * caducan. Tenants ficticios; ningún nombre de cliente.
 */
import { describe, expect, it } from 'vitest';
import {
  CLAVES_POR_CONTRATO, LIMITE_MAXIMO, MAXIMO_PRECIO_POR_CONTRATO_USD, PLANES, aCentavos, copiaDeLimites, limitesDe,
  limitesDeCuenta, porContratoDe, precioMensualDe, precioPorContratoDe, precioPorContratoValido,
} from '../../functions/src/planes.ts';
import {
  BOLSA_PRUEBA_MAXIMA, PRUEBA, PruebaInvalida, camposDerivados, estadoDeServicio, inicioDePrueba, montoFueraDeContrato,
  montoUsdDe, periodosIncoherentes, pruebaNueva, recordatoriosDebidos,
} from '../../functions/src/prepago.ts';

/** 26/09/2026 a las 12:00 de Bolivia (16:00 UTC): quedan cinco días de septiembre. */
const SEP_26 = Date.UTC(2026, 8, 26, 16, 0, 0);
/** 27/10/2026 a las 12:00 de Bolivia. */
const OCT_27 = Date.UTC(2026, 9, 27, 16, 0, 0);
/** 01/11/2026 a las 12:00 de Bolivia. */
const NOV_01 = Date.UTC(2026, 10, 1, 16, 0, 0);

const PRO_CON_CONTRATO = {
  plan: 'pro', modalidad: 'prepago', periodoPagado: '2099-12',
  limites: { ...limitesDe('pro'), conversaciones: 800 }, limitesPorContrato: ['conversaciones'],
  precioPorContrato: 120,
};

// ===========================================================================
describe('la lista cerrada se abrió a las conversaciones (decisión de Andres del 26/09)', () => {
  it('son exactamente dos claves: cambiosIncluidos y conversaciones; productos y agendas siguen afuera', () => {
    expect([...CLAVES_POR_CONTRATO]).toEqual(['cambiosIncluidos', 'conversaciones']);
    expect(porContratoDe({ limites: { productos: 900, agendas: 20 }, limitesPorContrato: ['productos', 'agendas'] })).toEqual([]);
  });

  it('un marcador sobre conversaciones fuera de rango NO es contrato: rige el del plan', () => {
    for (const malo of [0, -1, 2.5, LIMITE_MAXIMO + 1, '800', null]) {
      const c = { plan: 'pro', limites: { ...limitesDe('pro'), conversaciones: malo }, limitesPorContrato: ['conversaciones'] };
      expect(porContratoDe(c), String(malo)).toEqual([]);
      expect(limitesDeCuenta(c).conversaciones).toBe(limitesDe('pro').conversaciones);
    }
  });

  it('LA COPIA MANDA SOBRE EL PLAN: un cambio de plan conserva las conversaciones por contrato, y lo informa', () => {
    const r = copiaDeLimites(PRO_CON_CONTRATO, { plan: 'impulso' });
    expect(r.limites).toEqual({ ...limitesDe('impulso'), conversaciones: 800 });
    expect(r.porContrato).toEqual(['conversaciones']);
    expect(r.conservados).toEqual({ conversaciones: 800 });
    expect(limitesDeCuenta({ plan: 'impulso', limites: r.limites }).conversaciones).toBe(800);
  });

  it('las dos claves a la vez: se fijan juntas, se conservan juntas, y se quitan de a una', () => {
    const fija = copiaDeLimites({ plan: 'pro', limites: limitesDe('pro') }, { conversaciones: 650, cambiosIncluidos: 4 });
    expect(fija.limites).toEqual({ ...limitesDe('pro'), conversaciones: 650, cambiosIncluidos: 4 });
    expect(fija.porContrato).toEqual(['cambiosIncluidos', 'conversaciones']);
    const cuenta = { plan: 'pro', limites: fija.limites, limitesPorContrato: fija.porContrato };
    const baja = copiaDeLimites(cuenta, { plan: 'crecimiento' });
    expect(baja.conservados).toEqual({ cambiosIncluidos: 4, conversaciones: 650 });
    const quita = copiaDeLimites(cuenta, { conversaciones: null });
    expect(quita.limites).toEqual({ ...limitesDe('pro'), cambiosIncluidos: 4 });
    expect(quita.porContrato).toEqual(['cambiosIncluidos']);
  });

  it('un valor de conversaciones fuera de rango NO se convierte en contrato: lanza', () => {
    for (const malo of [0, -1, 1.5, LIMITE_MAXIMO + 1, Number.NaN]) {
      expect(() => copiaDeLimites({ plan: 'pro' }, { conversaciones: malo }), String(malo)).toThrow(RangeError);
    }
  });
});

// ===========================================================================
describe('el precio por contrato: qué es válido y quién lo usa', () => {
  it('positivo, hasta el tope y con dos decimales como mucho; lo demás no es un precio', () => {
    for (const bueno of [0.01, 1, 37.5, 99.99, 120, MAXIMO_PRECIO_POR_CONTRATO_USD]) {
      expect(precioPorContratoValido(bueno), String(bueno)).toBe(true);
    }
    for (const malo of [0, -1, 12.345, MAXIMO_PRECIO_POR_CONTRATO_USD + 0.01, Number.NaN, Number.POSITIVE_INFINITY, '120', null, true]) {
      expect(precioPorContratoValido(malo), String(malo)).toBe(false);
    }
  });

  it('EL CONTRATO MANDA SOBRE CUALQUIER PLAN; uno roto se ignora y rige el del plan', () => {
    expect(precioMensualDe(PRO_CON_CONTRATO)).toBe(120);
    expect(precioMensualDe(PRO_CON_CONTRATO, 'impulso')).toBe(120);
    expect(precioMensualDe({ plan: 'pro' })).toBe(PLANES.pro.precioUsd);
    expect(precioMensualDe({ plan: 'pro' }, 'crecimiento')).toBe(PLANES.crecimiento.precioUsd);
    for (const roto of [0, -5, 12.345, '120', 5000]) {
      expect(precioPorContratoDe({ plan: 'pro', precioPorContrato: roto }), String(roto)).toBeNull();
      expect(precioMensualDe({ plan: 'pro', precioPorContrato: roto }), String(roto)).toBe(PLANES.pro.precioUsd);
    }
  });

  it('la MENSUALIDAD DERIVADA (`montoMensual`) es la del contrato, en producción', () => {
    const e = estadoDeServicio(PRO_CON_CONTRATO, 0, SEP_26);
    expect(e.mensualidadUsd).toBe(120);
    expect(e.incluidas).toBe(800);
    expect(camposDerivados(e, PRO_CON_CONTRATO).montoMensual).toBe(120);
    // Sin contrato, la del plan, como siempre.
    const { precioPorContrato: _p, ...sin } = PRO_CON_CONTRATO;
    expect(camposDerivados(estadoDeServicio(sin, 0, SEP_26), sin).montoMensual).toBe(PLANES.pro.precioUsd);
    // En demostración, cero aunque haya contrato: el cobro lo decide la modalidad.
    const demo = { ...PRO_CON_CONTRATO, modalidad: 'demostracion' };
    expect(camposDerivados(estadoDeServicio(demo, 0, SEP_26), demo).montoMensual).toBe(0);
  });

  it('el IMPORTE DE UNA MENSUALIDAD con la cuenta es el del contrato por los meses, en centavos exactos', () => {
    expect(montoUsdDe({ tipo: 'mensualidad', plan: 'pro', meses: 3 }, PRO_CON_CONTRATO)).toBe(360);
    expect(montoUsdDe({ tipo: 'mensualidad', plan: 'pro', meses: 3 }, { ...PRO_CON_CONTRATO, precioPorContrato: 33.33 })).toBe(99.99);
    expect(aCentavos(33.33 * 3)).toBe(99.99);
    // Sin la cuenta, la lista; y la bolsa y la instalación siempre son de lista.
    expect(montoUsdDe({ tipo: 'mensualidad', plan: 'pro', meses: 3 })).toBe(270);
    expect(montoUsdDe({ tipo: 'bolsa', cantidad: 2 }, PRO_CON_CONTRATO)).toBe(20);
    expect(montoUsdDe({ tipo: 'instalacion' }, PRO_CON_CONTRATO)).toBe(65);
  });

  it('UN PRECIO FUERA DE CONTRATO se reconoce: un QR de mensualidad a otro importe que el de la cuenta', () => {
    const qrDeLista = { tipo: 'mensualidad', plan: 'pro', meses: 1, montoUsd: 90 };
    const qrDelContrato = { tipo: 'mensualidad', plan: 'pro', meses: 2, montoUsd: 240 };
    expect(montoFueraDeContrato(qrDeLista, PRO_CON_CONTRATO)).toBe(true);
    expect(montoFueraDeContrato(qrDelContrato, PRO_CON_CONTRATO)).toBe(false);
    // Y al revés: un QR del contrato cuando el contrato ya se quitó.
    expect(montoFueraDeContrato(qrDelContrato, { plan: 'pro' })).toBe(true);
    expect(montoFueraDeContrato(qrDeLista, { plan: 'pro' })).toBe(false);
    // Una bolsa, una instalación o un pago sin importe guardado no se juzgan.
    expect(montoFueraDeContrato({ tipo: 'bolsa', cantidad: 1, montoUsd: 10 }, PRO_CON_CONTRATO)).toBe(false);
    expect(montoFueraDeContrato({ tipo: 'mensualidad', plan: 'pro', meses: 1 }, PRO_CON_CONTRATO)).toBe(false);
  });

  it('la COBRANZA dice el importe del contrato, no el de la lista', () => {
    // Cubierta hasta septiembre, a cinco días del vencimiento: sale el aviso de renovación.
    const cuenta = { ...PRO_CON_CONTRATO, periodoPagado: '2026-09' };
    const [r] = recordatoriosDebidos(cuenta, estadoDeServicio(cuenta, 0, SEP_26), SEP_26, { tco: 10, numeroRecepcion: '' });
    expect(r?.tipo).toBe('vencePronto');
    expect(r?.parametros[1]).toBe('1200');
  });
});

// ===========================================================================
describe('la bolsa de prueba se usa tal cual', () => {
  const enPrueba = (extra: Record<string, unknown> = {}) => ({
    plan: 'pro', limites: limitesDe('pro'), modalidad: 'prueba', periodoPrueba: '2026-09', bolsaPrueba: 40, ...extra,
  });

  it('estadoDeServicio usa la bolsa escrita (40), no la de lista (20): disponibles, consumo y corte', () => {
    const e = estadoDeServicio(enPrueba(), 0, SEP_26);
    expect(e).toMatchObject({ enPrueba: true, cubierto: true, operativo: true, bolsaPrueba: 40, disponibles: 40, incluidas: 0 });
    expect(e.bolsaPrueba).not.toBe(PRUEBA.conversaciones);
    const agotada = estadoDeServicio(enPrueba({ bolsaPrueba: 0 }), 0, SEP_26);
    expect(agotada).toMatchObject({ operativo: false, motivo: 'sin_conversaciones' });
  });
});

// ===========================================================================
describe('pruebaNueva: fijar o extender la prueba, con las reglas del servidor', () => {
  const enPrueba = { plan: 'pro', modalidad: 'prueba', periodoPrueba: '2026-09', bolsaPrueba: 7 };

  it('un MES PASADO se rechaza, aunque la cuenta esté en prueba', () => {
    expect(() => pruebaNueva(enPrueba, { periodoPrueba: '2026-08' }, SEP_26)).toThrow(PruebaInvalida);
    expect(() => pruebaNueva(enPrueba, { periodoPrueba: '2026-08' }, SEP_26)).toThrow(/mes pasado/);
  });

  it('SIN MODALIDAD PRUEBA se rechaza (el período y la bolsa); con `modalidad: prueba` en la misma operación, no', () => {
    const produccion = { plan: 'pro', modalidad: 'prepago', periodoPagado: '2026-09' };
    expect(() => pruebaNueva(produccion, { periodoPrueba: '2026-10' }, SEP_26)).toThrow(/solo vale con modalidad prueba/);
    expect(() => pruebaNueva(produccion, { bolsaPrueba: 40 }, SEP_26)).toThrow(/solo vale con modalidad prueba/);
    expect(() => pruebaNueva({}, { periodoPrueba: '2026-10' }, SEP_26)).toThrow(PruebaInvalida);
    expect(pruebaNueva(produccion, { modalidad: 'prueba', periodoPrueba: '2026-10', bolsaPrueba: 40 }, SEP_26))
      .toEqual({ periodoPrueba: '2026-10', pruebaDesde: '2026-09', bolsaPrueba: 40 });
  });

  it('la bolsa fuera de rango se rechaza', () => {
    for (const malo of [0, -1, 2.5, BOLSA_PRUEBA_MAXIMA + 1, Number.NaN]) {
      expect(() => pruebaNueva(enPrueba, { bolsaPrueba: malo }, SEP_26), String(malo)).toThrow(/entero de 1 a/);
    }
  });

  it('EXTENDER de septiembre a octubre el 26/09 NO DEJA HUECO: sigue cubierta y en prueba hasta el 31/10', () => {
    const cambios = pruebaNueva(enPrueba, { periodoPrueba: '2026-10' }, SEP_26);
    // La bolsa no se reinicia sola.
    expect(cambios).toEqual({ periodoPrueba: '2026-10', pruebaDesde: '2026-09' });
    const cuenta = { ...enPrueba, ...cambios };
    expect(inicioDePrueba(cuenta)).toBe('2026-09');
    expect(periodosIncoherentes(cuenta)).toEqual([]);
    for (const instante of [SEP_26, OCT_27]) {
      expect(estadoDeServicio(cuenta, 0, instante), new Date(instante).toISOString())
        .toMatchObject({ cubierto: true, enPrueba: true, operativo: true, fase: 'cubierto', mensualidadUsd: 0, bolsaPrueba: 7 });
    }
    // Pasado octubre y su gracia, sin plan pagado, deja de estar cubierta.
    expect(estadoDeServicio(cuenta, 0, NOV_01 + 3 * 86_400_000)).toMatchObject({ cubierto: false, motivo: 'sin_pago' });
  });

  it('SIN pruebaDesde la misma extensión dejaba el hueco (la razón del campo): el 26/09 no estaba cubierta', () => {
    const sinDesde = { ...enPrueba, periodoPrueba: '2026-10' };
    expect(estadoDeServicio(sinDesde, 0, SEP_26)).toMatchObject({ cubierto: false });
  });

  it('EL AVISO DE FIN NO SE ADELANTA: el 26/09, con la prueba extendida a octubre, no sale; el 27/10 sí', () => {
    const cuenta = { ...enPrueba, ...pruebaNueva(enPrueba, { periodoPrueba: '2026-10' }, SEP_26) };
    const contexto = { tco: 10, numeroRecepcion: '' };
    expect(recordatoriosDebidos(cuenta, estadoDeServicio(cuenta, 0, SEP_26), SEP_26, contexto)).toEqual([]);
    const [r] = recordatoriosDebidos(cuenta, estadoDeServicio(cuenta, 0, OCT_27), OCT_27, contexto);
    expect(r).toMatchObject({ tipo: 'conversion', clave: 'conversion_2026-10' });
    // Una prueba de un solo mes, como siempre: sale a cinco días del fin.
    const [s] = recordatoriosDebidos(enPrueba, estadoDeServicio(enPrueba, 0, SEP_26), SEP_26, contexto);
    expect(s).toMatchObject({ tipo: 'conversion', clave: 'conversion_2026-09' });
  });

  it('extender otra vez conserva el primer mes; fijar el mes en curso borra pruebaDesde', () => {
    const extendida = { ...enPrueba, periodoPrueba: '2026-10', pruebaDesde: '2026-09' };
    expect(pruebaNueva(extendida, { periodoPrueba: '2026-11' }, SEP_26)).toEqual({ periodoPrueba: '2026-11' });
    expect(pruebaNueva(extendida, { periodoPrueba: '2026-09' }, SEP_26)).toEqual({ periodoPrueba: '2026-09', pruebaDesde: null });
  });

  it('pasar a prueba sin período: el mes en curso con la bolsa de lista (o la pedida); si ya tenía, no se toca', () => {
    expect(pruebaNueva({ plan: 'pro' }, { modalidad: 'prueba' }, SEP_26)).toEqual({ periodoPrueba: '2026-09', bolsaPrueba: PRUEBA.conversaciones });
    expect(pruebaNueva({ plan: 'pro' }, { modalidad: 'prueba', bolsaPrueba: 50 }, SEP_26)).toEqual({ periodoPrueba: '2026-09', bolsaPrueba: 50 });
    expect(pruebaNueva(enPrueba, { modalidad: 'prueba' }, SEP_26)).toEqual({});
  });

  it('borrar el período de una cuenta que QUEDA en prueba se rechaza; al salir de prueba, se borra con su primer mes', () => {
    expect(() => pruebaNueva(enPrueba, { periodoPrueba: null }, SEP_26)).toThrow(/necesita su periodoPrueba/);
    const extendida = { ...enPrueba, periodoPrueba: '2026-10', pruebaDesde: '2026-09' };
    expect(pruebaNueva(extendida, { modalidad: 'prepago', periodoPrueba: null }, SEP_26)).toEqual({ periodoPrueba: null, pruebaDesde: null });
  });

  it('un pruebaDesde roto es INCOHERENCIA (se atiende y se anota), nunca un corte', () => {
    for (const roto of ['2026-9', '2026-11', 7, null]) {
      const cuenta = { ...enPrueba, periodoPrueba: '2026-10', pruebaDesde: roto };
      expect(periodosIncoherentes(cuenta), String(roto)).toEqual(['pruebaDesde']);
      expect(estadoDeServicio(cuenta, 0, SEP_26)).toMatchObject({ operativo: true, incoherente: true });
    }
  });
});
