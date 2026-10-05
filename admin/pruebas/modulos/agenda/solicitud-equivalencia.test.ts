/**
 * EQUIVALENCIA ANTES/DESPUÉS de mover `Solicitud`, `solicitudTras` (y sus
 * predicados de cobro), `reactivaTras`, las constantes de la solicitud y
 * `milisegundosDe` (F3b-1a y F3b-1b).
 *
 * F3b-1a movió esas piezas de `ingesta.ts` a `modulos/agenda/solicitud.ts` y a
 * `core/turno/tiempo.ts`; F3b-1b movió los dos predicados de cobro a
 * `modulos/cobros/alCierre.ts`. Las dos veces SIN cambiar una línea de lógica, y
 * esta suite lo prueba de la única forma que vale: `solicitud-equivalencia.golden.json`
 * se generó con el código de ANTES de mover nada (el de `9e0f247b`, previo a
 * F3b-1a: misma entrada, salida guardada), y acá se vuelve a correr la misma
 * rejilla (`rejilla-solicitud.ts`, que no importa nada de `functions/src`) y se
 * exige igualdad exacta. Si un movimiento futuro cambia el resultado de un solo
 * caso, falla con el caso nombrado.
 *
 * La rejilla cubre `solicitudTras` en TODOS sus eventos contra TODAS las etapas
 * previas (y contra la previa ausente, no objeto y vacía), con y sin cobro de
 * regla 2, con y sin `cobroReal`; los dos predicados de cobro; `reactivaTras`;
 * y `milisegundosDe` con Timestamp, Date, número, `null` y formas parecidas. En
 * F3b-1b se amplió con los bordes de la ventana de 24 h, del límite efectivo y
 * del seguimiento, y con relojes de ±1 ms y de 24 h menos 1 ms.
 *
 * Además del golden hay un `describe` de VALORES LITERALES: el golden dice «igual
 * que antes», no «correcto»; estos dicen qué es lo correcto en los bordes que
 * pidió seguridad, escritos a mano. Si uno falla contra el código viejo, el
 * código viejo era el que estaba mal y se discute: no se ajusta la expectativa.
 *
 * Es pura: no toca Firestore (el `Timestamp` es el de la biblioteca, sin red).
 * Regenerar el golden solo es legítimo si se cambia la lógica A PROPÓSITO, en
 * otro PR y diciéndolo: `GENERAR_GOLDEN=1 vitest run pruebas/modulos/agenda/solicitud-equivalencia.test.ts`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { milisegundosDe } from '../../../functions/src/core/turno/tiempo.ts';
import { MINUTOS_RETENCION_POR_DEFECTO } from '../../../functions/src/modulos/agenda/retencion.ts';
import {
  DIAS_ADELANTO_A_FAVOR, ETAPAS_PENDIENTES, HORAS_ANTICIPACION_PARA_CANCELAR,
  cierreBloqueadoPorCobro, cierreDeVentaLoHaceElCotejo, reactivaTras, solicitudTras,
} from '../../../functions/src/modulos/agenda/solicitud.ts';
import { AHORA, H, PREVIAS, previa, regla2, rejilla, ts } from './rejilla-solicitud.ts';

const GOLDEN = new URL('./solicitud-equivalencia.golden.json', import.meta.url);

function hoyConElCodigoActual(): Record<string, unknown> {
  return rejilla({
    solicitudTras: (p, ev, ms, d) => solicitudTras(p, ev, ms, d),
    cierreBloqueadoPorCobro, cierreDeVentaLoHaceElCotejo, reactivaTras, milisegundosDe,
    constantes: {
      DIAS_ADELANTO_A_FAVOR, HORAS_ANTICIPACION_PARA_CANCELAR, MINUTOS_RETENCION_POR_DEFECTO,
      ETAPAS_PENDIENTES: [...ETAPAS_PENDIENTES].sort(),
    },
  });
}

describe('F3b-1: lo movido da exactamente lo mismo que antes', () => {
  const hoy = hoyConElCodigoActual();

  if (process.env['GENERAR_GOLDEN'] === '1') {
    it('genera el golden (solo a propósito)', () => {
      writeFileSync(GOLDEN, `${JSON.stringify(hoy, null, 1)}\n`);
    });
    return;
  }

  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Record<string, unknown>;

  it('la rejilla tiene las mismas claves que el golden (ningún caso se pierde ni se agrega)', () => {
    expect(Object.keys(hoy).sort()).toEqual(Object.keys(golden).sort());
    expect(Object.keys(golden).length).toBeGreaterThan(1_000);
  });

  it('cada bloque da la huella guardada antes de mover el código', () => {
    // Se compara por bloque para que un fallo diga cuál, y no un diff enorme.
    const distintos = Object.keys(golden).filter((k) => JSON.stringify(hoy[k]) !== JSON.stringify(golden[k]));
    expect(distintos.slice(0, 10)).toEqual([]);
  });

  it('la rejilla ejercita las ramas que importan (no es una igualdad de nulos)', () => {
    const c = golden['__cobertura'] as {
      solicitudesCreadas: number; solicitudesNulas: number; etapas: string[];
      bloqueadoVerdadero: boolean; cotejoVerdadero: boolean; reactivaVerdadero: boolean;
    };
    expect(c.solicitudesCreadas).toBeGreaterThan(1000);
    expect(c.solicitudesNulas).toBeGreaterThan(1000);
    expect(c.etapas).toEqual(['a_favor', 'agendada', 'horarios', 'qr_enviado']);
    expect(c.bloqueadoVerdadero && c.cotejoVerdadero && c.reactivaVerdadero).toBe(true);
  });

  it('la rejilla incluye los bordes de F3b-1b (24 h exactas, límite = ahora, seguimiento = ahora)', () => {
    for (const e of ['qr_enviado', 'vencida', 'cancelada', 'en_revision']) {
      expect(PREVIAS[`${e}_regla2_vencida_24h`]).toBeDefined();
      expect(PREVIAS[`${e}_regla2_vence_ahora`]).toBeDefined();
    }
    expect(PREVIAS['seguimiento_ahora']).toBeDefined();
  });
});

describe('Valores literales en los bordes (escritos a mano, no salidos del golden)', () => {
  it('cierreBloqueadoPorCobro: a las 24 h EXACTAS del límite todavía bloquea; con 1 ms más, no', () => {
    for (const e of ['vencida', 'cancelada', 'qr_enviado']) {
      expect(cierreBloqueadoPorCobro(regla2(e, -24), AHORA), `${e} en 24 h`).toBe(true);
      expect(cierreBloqueadoPorCobro(regla2(e, -24), AHORA + 1), `${e} en 24 h + 1 ms`).toBe(false);
    }
  });

  it('cierreBloqueadoPorCobro: en_revision bloquea siempre, sin importar el reloj', () => {
    expect(cierreBloqueadoPorCobro(regla2('en_revision', -24), AHORA)).toBe(true);
    expect(cierreBloqueadoPorCobro(regla2('en_revision', -24), AHORA + 1)).toBe(true);
    expect(cierreBloqueadoPorCobro(regla2('en_revision', -300), AHORA + 40 * H)).toBe(true);
  });

  it('un cobro de regla 2 a tiempo en qr_enviado: con el límite = ahora ya está vencido y bloquea; un ms antes, no, y lo cierra el cotejo', () => {
    const p = regla2('qr_enviado', 0);
    expect(cierreBloqueadoPorCobro(p, AHORA)).toBe(true);
    expect(cierreBloqueadoPorCobro(p, AHORA - 1)).toBe(false);
    expect(cierreDeVentaLoHaceElCotejo(p, AHORA)).toBe(true);
    expect(cierreDeVentaLoHaceElCotejo(p, AHORA - 1)).toBe(true);
    // 24 h + 1 ms después del límite ya es otra conversación: nada la bloquea ni la cierra el cotejo.
    expect(cierreDeVentaLoHaceElCotejo(p, AHORA + 24 * H), 'en 24 h exactas').toBe(true);
    expect(cierreDeVentaLoHaceElCotejo(p, AHORA + 24 * H + 1), 'en 24 h + 1 ms').toBe(false);
  });

  it('con regla 1 (o sin reglaCobro) ninguno de los dos predicados bloquea', () => {
    expect(cierreBloqueadoPorCobro(previa('vencida'), AHORA)).toBe(false);
    expect(cierreDeVentaLoHaceElCotejo(previa('qr_enviado', { reglaCobro: 1, venceEn: ts(-2 * H) }), AHORA)).toBe(false);
    expect(cierreDeVentaLoHaceElCotejo(undefined, AHORA)).toBe(false);
  });

  it('reactivaTras: el seguimiento «ahora» reactiva en el mismo instante y hasta 24 h menos 1 ms; ni un ms antes ni a las 24 h', () => {
    const p = PREVIAS['seguimiento_ahora'];
    expect(reactivaTras(p, 'entrante', AHORA)).toBe(true);
    expect(reactivaTras(p, 'entrante', AHORA - 1)).toBe(false);
    expect(reactivaTras(p, 'entrante', AHORA + 24 * H - 1)).toBe(true);
    expect(reactivaTras(p, 'entrante', AHORA + 24 * H)).toBe(false);
    expect(reactivaTras(p, 'saliente', AHORA)).toBe(false);
  });

  it('solicitudTras cita_agendada sobre un cobro vencido hace 24 h exactas: no mueve nada; con 1 ms más, crea la solicitud agendada', () => {
    const p = regla2('vencida', -24);
    expect(solicitudTras(p, 'cita_agendada', AHORA, {})).toBeNull();
    const despues = solicitudTras(p, 'cita_agendada', AHORA + 1, {});
    expect(despues).not.toBeNull();
    expect(despues?.etapa).toBe('agendada');
  });
});
