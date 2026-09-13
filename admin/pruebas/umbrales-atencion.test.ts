/**
 * Pruebas de los umbrales de corte por uso extendido (`Analisis/27` §5,
 * 13/09/2026): a las 50 respuestas en la ventana la conversación pasa a un
 * operador con un aviso fijo; a las 100 el teléfono deja de recibir respuestas
 * hasta que la ventana se renueve. Los dos son parametrizables por empresa en
 * `cuenta/estado`.
 *
 * NO NECESITAN EMULADOR: `atencion.ts` es puro. Sobre esto se corta el
 * servicio a un cliente final, así que se prueba negando: el teléfono que
 * llegó al umbral NO va al modelo, y el que no llegó SÍ.
 */
import { describe, expect, it } from 'vitest';
import {
  MENSAJE_USO_EXTENDIDO, RESPUESTAS_POR_CONVERSACION, UMBRALES_ATENCION, UMBRAL_MAXIMO,
  avisoDeTransicion, estadoDeAtencion, umbralValido, umbralesDeAtencion,
  type MarcasDeAtencion,
} from '../functions/src/atencion.ts';
import { contadoresDelMensaje, type MarcasDeConteo } from '../functions/src/ingesta.ts';

const HORA = 3_600_000;
const T0 = Date.UTC(2026, 9, 5, 14, 0, 0);
const ts = (ms: number) => ({ toMillis: () => ms });
const ESTANDAR = umbralesDeAtencion(undefined);

const marcas = (enviadas: number, desdeMs = T0, extra: Partial<MarcasDeAtencion> = {}): MarcasDeAtencion =>
  ({ atencionDesde: ts(desdeMs), mensajesVentana: enviadas, ...extra });

describe('Los umbrales de respaldo', () => {
  it('son 50 para el operador y 100 para el bloqueo', () => {
    expect(UMBRALES_ATENCION).toEqual({ operador: 50, bloqueo: 100 });
    expect(ESTANDAR).toEqual({ operador: 50, bloqueo: 100, origen: 'estandar' });
  });

  it('el operador entra al terminar el bloque 2 y el bloqueo al terminar el 4', () => {
    expect(UMBRALES_ATENCION.operador).toBe(2 * RESPUESTAS_POR_CONVERSACION);
    expect(UMBRALES_ATENCION.bloqueo).toBe(4 * RESPUESTAS_POR_CONVERSACION);
  });
});

describe('Umbrales por empresa, leídos de la cuenta', () => {
  it('sin cuenta o sin campos rigen los de respaldo', () => {
    expect(umbralesDeAtencion(undefined).origen).toBe('estandar');
    expect(umbralesDeAtencion({ plan: 'base' })).toEqual(ESTANDAR);
  });

  it('una pareja propia y coherente se acepta', () => {
    expect(umbralesDeAtencion({ umbralOperador: 30, umbralBloqueo: 60 }))
      .toEqual({ operador: 30, bloqueo: 60, origen: 'cuenta' });
  });

  it('un solo umbral propio se combina con el de respaldo del otro', () => {
    expect(umbralesDeAtencion({ umbralOperador: 40 }))
      .toEqual({ operador: 40, bloqueo: 100, origen: 'cuenta' });
    expect(umbralesDeAtencion({ umbralBloqueo: 200 }))
      .toEqual({ operador: 50, bloqueo: 200, origen: 'cuenta' });
  });

  it('un bloqueo que no supera al operador invalida la pareja entera', () => {
    expect(umbralesDeAtencion({ umbralOperador: 80, umbralBloqueo: 60 })).toEqual(ESTANDAR);
    expect(umbralesDeAtencion({ umbralOperador: 50, umbralBloqueo: 50 })).toEqual(ESTANDAR);
    // Un operador propio por encima del bloqueo de respaldo también.
    expect(umbralesDeAtencion({ umbralOperador: 120 })).toEqual(ESTANDAR);
  });

  it('un valor fuera de rango o mal tipado vuelve a los de respaldo', () => {
    expect(umbralesDeAtencion({ umbralOperador: 0, umbralBloqueo: 100 })).toEqual(ESTANDAR);
    expect(umbralesDeAtencion({ umbralOperador: 50, umbralBloqueo: UMBRAL_MAXIMO + 1 })).toEqual(ESTANDAR);
    expect(umbralesDeAtencion({ umbralOperador: '50', umbralBloqueo: 100 })).toEqual(ESTANDAR);
    expect(umbralesDeAtencion({ umbralOperador: 12.5, umbralBloqueo: 100 })).toEqual(ESTANDAR);
    expect(umbralesDeAtencion({ umbralOperador: Number.NaN, umbralBloqueo: 100 })).toEqual(ESTANDAR);
  });

  it('`umbralValido` acepta enteros de 1 al máximo y nada más', () => {
    expect(umbralValido(1)).toBe(true);
    expect(umbralValido(UMBRAL_MAXIMO)).toBe(true);
    expect(umbralValido(0)).toBe(false);
    expect(umbralValido(UMBRAL_MAXIMO + 1)).toBe(false);
    expect(umbralValido(3.3)).toBe(false);
    expect(umbralValido('3')).toBe(false);
    expect(umbralValido(null)).toBe(false);
  });
});

describe('El estado de atención de un teléfono', () => {
  it('sin ventana abierta es normal, con cero respuestas', () => {
    const a = estadoDeAtencion({}, ESTANDAR, T0);
    expect(a).toMatchObject({ estado: 'normal', respuestasEnVentana: 0, bloque: 1, ventanaVenceEn: null });
    expect(a.mensajeFijo).toBeNull();
  });

  it('con 49 respuestas sigue yendo al modelo; con 50 pasa al operador', () => {
    expect(estadoDeAtencion(marcas(49), ESTANDAR, T0 + HORA).estado).toBe('normal');
    const a = estadoDeAtencion(marcas(50), ESTANDAR, T0 + HORA);
    expect(a.estado).toBe('operador');
    expect(a.mensajeFijo).toBe(MENSAJE_USO_EXTENDIDO);
    expect(a.bloque).toBe(3);
  });

  it('con 99 sigue en operador; con 100 se bloquea y no hay mensaje', () => {
    expect(estadoDeAtencion(marcas(99), ESTANDAR, T0 + HORA).estado).toBe('operador');
    const a = estadoDeAtencion(marcas(100), ESTANDAR, T0 + HORA);
    expect(a.estado).toBe('bloqueado');
    expect(a.mensajeFijo).toBeNull();
    expect(a.ventanaVenceEn).toBe(T0 + 24 * HORA);
  });

  it('respeta los umbrales propios de la empresa', () => {
    const propios = umbralesDeAtencion({ umbralOperador: 30, umbralBloqueo: 40 });
    expect(estadoDeAtencion(marcas(29), propios, T0 + HORA).estado).toBe('normal');
    expect(estadoDeAtencion(marcas(30), propios, T0 + HORA).estado).toBe('operador');
    expect(estadoDeAtencion(marcas(40), propios, T0 + HORA).estado).toBe('bloqueado');
    expect(estadoDeAtencion(marcas(40), propios, T0 + HORA).umbrales.origen).toBe('cuenta');
  });

  it('al vencer la ventana el teléfono vuelve a normal, con el conteo en cero', () => {
    const a = estadoDeAtencion(marcas(100), ESTANDAR, T0 + 24 * HORA);
    expect(a).toMatchObject({ estado: 'normal', respuestasEnVentana: 0, bloque: 1, ventanaVenceEn: null });
  });

  it('informa el bloque en curso y cuánto falta para el siguiente', () => {
    expect(estadoDeAtencion(marcas(0), ESTANDAR, T0 + HORA)).toMatchObject({ bloque: 1, restanDelBloque: 25 });
    expect(estadoDeAtencion(marcas(24), ESTANDAR, T0 + HORA)).toMatchObject({ bloque: 1, restanDelBloque: 1 });
    expect(estadoDeAtencion(marcas(25), ESTANDAR, T0 + HORA)).toMatchObject({ bloque: 2, restanDelBloque: 25 });
    expect(estadoDeAtencion(marcas(26), ESTANDAR, T0 + HORA)).toMatchObject({ bloque: 2, restanDelBloque: 24 });
  });

  it('tolera un contador corrupto como cero', () => {
    expect(estadoDeAtencion(marcas(0, T0, { mensajesVentana: 'cien' }), ESTANDAR, T0 + HORA).estado).toBe('normal');
  });
});

describe('El aviso a recepción, una vez por umbral y por ventana', () => {
  it('avisa al entrar en operador y al entrar en bloqueo', () => {
    expect(avisoDeTransicion(undefined, 'operador')).toBe('operador');
    expect(avisoDeTransicion('normal', 'operador')).toBe('operador');
    expect(avisoDeTransicion('operador', 'bloqueado')).toBe('bloqueado');
  });

  it('no repite el aviso mientras el estado no cambia', () => {
    expect(avisoDeTransicion('operador', 'operador')).toBeNull();
    expect(avisoDeTransicion('bloqueado', 'bloqueado')).toBeNull();
  });

  it('volver a normal no se avisa', () => {
    expect(avisoDeTransicion('bloqueado', 'normal')).toBeNull();
    expect(avisoDeTransicion('operador', 'normal')).toBeNull();
  });

  it('una marca desconocida se trata como normal', () => {
    expect(avisoDeTransicion('cualquier cosa', 'operador')).toBe('operador');
  });
});

describe('Los umbrales sobre una conversación real, mensaje por mensaje', () => {
  /** Recorre `n` idas y vueltas como la ingesta y devuelve las marcas finales. */
  function conversar(n: number): MarcasDeConteo & MarcasDeAtencion {
    let m: MarcasDeConteo & MarcasDeAtencion = {};
    const periodo = '2026-10';
    const abre = contadoresDelMensaje(m, periodo, 'entrante', T0, 'hola, quiero pedir');
    m = { ...m, periodoContado: periodo, mensajesVentana: abre.mensajesVentana, atencionDesde: ts(T0) };
    for (let i = 1; i <= n; i++) {
      const t = T0 + i * 60_000;
      const e = contadoresDelMensaje(m, periodo, 'entrante', t, 'y algo más');
      m = { ...m, mensajesVentana: e.mensajesVentana };
      const s = contadoresDelMensaje(m, periodo, 'saliente', t + 30_000);
      m = { ...m, mensajesVentana: s.mensajesVentana };
    }
    return m;
  }

  it('la consulta 51 no va al modelo; la 101 no recibe nada', () => {
    expect(estadoDeAtencion(conversar(50), ESTANDAR, T0 + 2 * HORA).estado).toBe('operador');
    expect(estadoDeAtencion(conversar(100), ESTANDAR, T0 + 2 * HORA).estado).toBe('bloqueado');
  });

  it('las respuestas fijas del operador también cuentan y facturan su bloque', () => {
    // 50 respuestas del modelo y 25 avisos fijos: 75 salientes, tres bloques.
    const m = conversar(75);
    expect(m.mensajesVentana).toBe(75);
    const siguiente = contadoresDelMensaje(m, '2026-10', 'saliente', T0 + 2 * HORA);
    expect(siguiente.bloqueNuevo).toBe(true);
  });

  it('a la mañana siguiente el mismo teléfono vuelve a ser atendido', () => {
    const m = conversar(100);
    const manana = T0 + 25 * HORA;
    expect(estadoDeAtencion(m, ESTANDAR, manana).estado).toBe('normal');
    const abre = contadoresDelMensaje(m, '2026-10', 'entrante', manana, 'buen día, quiero reservar');
    expect(abre.atencion).toBe(true);
    expect(abre.mensajesVentana).toBe(0);
  });
});
