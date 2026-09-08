/**
 * LO QUE CUESTA ATENDER — la factura de Meta, antes de que llegue.
 *
 * Desde el 1 de octubre de 2026 Meta cobra cada respuesta del asistente y es el
 * 94 % de lo que cuesta el servicio. Estas pruebas cubren las dos cuentas que
 * lo vigilan, ambas puras:
 *
 *   a) la proyección del mes: mensajes enviados contra los 1.000 gratis del
 *      número, cuántos se pagan y cuánto;
 *   b) la distribución de mensajes por conversación, que es lo que
 *      `Analisis/16` pide medir y nadie tenía. El promedio esconde la cola, y
 *      la cola es lo que se paga.
 *
 * Y el eslabón que las alimenta: que la ingesta sepa cuántas respuestas tuvo
 * una conversación en el momento exacto en que se cierra su ventana.
 */
import { describe, expect, it } from 'vitest';
import {
  DESDE, FRANQUICIA_MENSUAL, TRAMOS, USD_POR_MENSAJE_MARKETING, USD_POR_MENSAJE_SERVICIO,
  distribucionDe, proyectar, seCobra, tramoDe,
} from '../functions/src/costos.ts';
import { contadoresDelMensaje, type MarcasDeConteo } from '../functions/src/ingesta.ts';

const OCTUBRE = '2026-10';
const SEPTIEMBRE = '2026-09';

describe('Cuándo empieza a cobrar Meta', () => {
  it('septiembre es gratis; octubre en adelante se cobra', () => {
    expect(DESDE).toBe('2026-10-01');
    expect(seCobra('2026-09')).toBe(false);
    expect(seCobra('2026-10')).toBe(true);
    expect(seCobra('2027-01')).toBe(true);
  });

  it('antes del 1 de octubre no se factura nada, por muchos mensajes que haya', () => {
    const p = proyectar({ salientes: 5000, conversaciones: 400 }, SEPTIEMBRE);
    expect(p.facturables).toBe(0);
    expect(p.costoUsd).toBe(0);
  });
});

describe('La proyección del mes contra la franquicia', () => {
  it('por debajo de los 1.000 mensajes no se paga nada', () => {
    const p = proyectar({ salientes: 900, conversaciones: 120 }, OCTUBRE);
    expect(p.facturables).toBe(0);
    expect(p.costoUsd).toBe(0);
    expect(p.franquiciaRestante).toBe(100);
    expect(p.porcentajeFranquicia).toBe(90);
  });

  it('en el mensaje 1.001 empieza a costar', () => {
    expect(proyectar({ salientes: 1000, conversaciones: 100 }, OCTUBRE).facturables).toBe(0);
    const p = proyectar({ salientes: 1001, conversaciones: 100 }, OCTUBRE);
    expect(p.facturables).toBe(1);
    expect(p.costoUsd).toBe(USD_POR_MENSAJE_SERVICIO);
    expect(p.franquiciaRestante).toBe(0);
  });

  it('un mes cargado: 3.000 mensajes son 2.000 facturables', () => {
    const p = proyectar({ salientes: 3000, conversaciones: 300 }, OCTUBRE);
    expect(p.facturables).toBe(2000);
    expect(p.costoUsd).toBeCloseTo(22.6, 4);
    expect(p.mensajesPorConversacion).toBe(10);
  });

  it('los mensajes por conversación son la palanca: a 6, el mismo volumen entra gratis', () => {
    // 120 conversaciones de 10 respuestas son 1.200 mensajes: 200 se pagan.
    expect(proyectar({ salientes: 1200, conversaciones: 120 }, OCTUBRE).facturables).toBe(200);
    // Las mismas 120 conversaciones resueltas en 6 son 720: no se paga nada.
    expect(proyectar({ salientes: 720, conversaciones: 120 }, OCTUBRE).facturables).toBe(0);
  });

  it('sin conversaciones no inventa un promedio', () => {
    expect(proyectar({ salientes: 0, conversaciones: 0 }, OCTUBRE).mensajesPorConversacion).toBeNull();
  });

  it('tolera contadores ausentes o con basura', () => {
    const p = proyectar({ salientes: -5, conversaciones: 1.7 }, OCTUBRE);
    expect(p.salientes).toBe(0);
    expect(p.conversaciones).toBe(1);
  });

  it('la franquicia y las tarifas son las de la hoja de Meta', () => {
    expect(FRANQUICIA_MENSUAL).toBe(1000);
    expect(USD_POR_MENSAJE_SERVICIO).toBe(0.0113);
    // Una difusión a 1.000 contactos cuesta más que cualquier plan: 74 USD.
    expect(USD_POR_MENSAJE_MARKETING * 1000).toBeCloseTo(74, 4);
  });
});

describe('La distribución de mensajes por conversación', () => {
  it('cada cantidad cae en su tramo, y el tope tiene el suyo', () => {
    expect(tramoDe(1)).toBe('t1_2');
    expect(tramoDe(2)).toBe('t1_2');
    expect(tramoDe(3)).toBe('t3_5');
    expect(tramoDe(10)).toBe('t6_10');
    expect(tramoDe(11)).toBe('t11_15');
    expect(tramoDe(25)).toBe('t21_25');
    expect(tramoDe(26)).toBe('t26_mas');
    expect(tramoDe(500)).toBe('t26_mas');
  });

  it('una conversación sin respuestas no es un tramo', () => {
    expect(tramoDe(0)).toBeNull();
    expect(tramoDe(-3)).toBeNull();
    expect(tramoDe(Number.NaN)).toBeNull();
  });

  it('los tramos cubren todo sin superponerse', () => {
    for (let n = 1; n <= 60; n += 1) {
      const encontrados = TRAMOS.filter((t) => n >= t.desde && n <= t.hasta);
      expect(encontrados, `${n} mensajes`).toHaveLength(1);
    }
  });

  it('resume la cola, que es lo que decide el costo', () => {
    // 100 conversaciones cortas y 10 largas: el promedio no lo mostraría.
    const d = distribucionDe({ t1_2: 40, t3_5: 60, t11_15: 6, t26_mas: 4 });
    expect(d.total).toBe(110);
    expect(d.cola).toBe(10);
    expect(d.porcentajeCola).toBeCloseTo(9.1, 1);
    expect(d.tramos.find((t) => t.clave === 't3_5')?.porcentaje).toBeCloseTo(54.5, 1);
  });

  it('sin datos no divide por cero', () => {
    const d = distribucionDe(undefined);
    expect(d.total).toBe(0);
    expect(d.porcentajeCola).toBe(0);
    expect(d.tramos).toHaveLength(TRAMOS.length);
  });

  it('ignora basura en los contadores guardados', () => {
    const d = distribucionDe({ t1_2: 'tres', t3_5: -4, t6_10: 2.9, otro: 100 });
    expect(d.total).toBe(2);
  });
});

describe('La ingesta sabe cuántas respuestas tuvo la conversación que se cierra', () => {
  const ancla = (ms: number) => ({ toMillis: () => ms });
  const T0 = Date.parse('2026-10-05T14:00:00Z');
  const DIA = 24 * 60 * 60 * 1000;

  it('al abrir una ventana nueva informa el largo de la anterior', () => {
    const marcas: MarcasDeConteo = { atencionDesde: ancla(T0), mensajesVentana: 7 };
    const c = contadoresDelMensaje(marcas, OCTUBRE, 'entrante', T0 + DIA + 1000, 'hola de nuevo');
    expect(c.atencion).toBe(true);
    expect(c.ventanaCerrada).toBe(7);
    expect(c.mensajesVentana).toBe(0);
    expect(tramoDe(c.ventanaCerrada!)).toBe('t6_10');
  });

  it('un mensaje que NO abre ventana no cierra ninguna', () => {
    const marcas: MarcasDeConteo = { atencionDesde: ancla(T0), mensajesVentana: 3 };
    expect(contadoresDelMensaje(marcas, OCTUBRE, 'saliente', T0 + 60000).ventanaCerrada).toBeNull();
    expect(contadoresDelMensaje(marcas, OCTUBRE, 'entrante', T0 + 60000).ventanaCerrada).toBeNull();
  });

  it('la primera conversación de un teléfono no cierra nada', () => {
    const c = contadoresDelMensaje({}, OCTUBRE, 'entrante', T0, 'hola');
    expect(c.atencion).toBe(true);
    expect(c.ventanaCerrada).toBeNull();
  });

  it('una ventana que no llegó a tener respuestas no suma a la distribución', () => {
    // El cliente escribió y nadie contestó: no es una conversación de largo 0,
    // es una conversación que no ocurrió. Contarla hundiría la distribución.
    const marcas: MarcasDeConteo = { atencionDesde: ancla(T0), mensajesVentana: 0 };
    expect(contadoresDelMensaje(marcas, OCTUBRE, 'entrante', T0 + DIA + 1000).ventanaCerrada).toBeNull();
  });
});
