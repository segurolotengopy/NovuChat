/**
 * F3b-1a — EQUIVALENCIA ANTES/DESPUÉS de mover `Solicitud`, `solicitudTras`
 * (y sus predicados de cobro), `reactivaTras`, las constantes de la solicitud y
 * `milisegundosDe`.
 *
 * El PR movió esas piezas de `ingesta.ts` a `modulos/agenda/solicitud.ts` y a
 * `core/turno/tiempo.ts` SIN cambiar una línea de lógica. Esta suite lo prueba
 * de la única forma que vale: `solicitud-equivalencia-f3b1a.golden.json` se generó con el
 * código ANTES de moverlo (misma entrada, salida guardada), y acá se vuelve a
 * correr la misma rejilla y se exige igualdad exacta. Si un movimiento futuro
 * cambia el resultado de un solo caso, falla con el caso nombrado.
 *
 * La rejilla cubre `solicitudTras` en TODOS sus eventos contra TODAS las etapas
 * previas (y contra la previa ausente, no objeto y vacía), con y sin cobro de
 * regla 2, con y sin `cobroReal`; los dos predicados de cobro; `reactivaTras`;
 * y `milisegundosDe` con Timestamp, Date, número, `null` y formas parecidas.
 *
 * Es pura: no toca Firestore (el `Timestamp` es el de la biblioteca, sin red).
 * Regenerar el golden solo es legítimo si se cambia la lógica A PROPÓSITO, en
 * otro PR y diciéndolo: `GENERAR_GOLDEN=1 vitest run pruebas/modulos/agenda/solicitud-equivalencia-f3b1a.test.ts`.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { milisegundosDe } from '../../../functions/src/core/turno/tiempo.ts';
import { MINUTOS_RETENCION_POR_DEFECTO } from '../../../functions/src/modulos/agenda/retencion.ts';
import {
  DIAS_ADELANTO_A_FAVOR, ETAPAS_PENDIENTES, HORAS_ANTICIPACION_PARA_CANCELAR,
  cierreBloqueadoPorCobro, cierreDeVentaLoHaceElCotejo, reactivaTras, solicitudTras,
} from '../../../functions/src/modulos/agenda/solicitud.ts';

const GOLDEN = new URL('./solicitud-equivalencia-f3b1a.golden.json', import.meta.url);
const H = 3_600_000;
const AHORA = Date.UTC(2026, 9, 5, 15, 0, 0);

/** Un valor con sus `Timestamp` como desplazamiento respecto de AHORA, para que el golden no lleve fechas largas. */
function plano(v: unknown): unknown {
  if (v instanceof Timestamp) return { __ts: v.toMillis() - AHORA };
  if (Array.isArray(v)) return v.map(plano);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plano(x)]));
  return v === undefined ? '__undefined' : v;
}

const ts = (desplazamiento: number) => Timestamp.fromMillis(AHORA + desplazamiento);

/** Una solicitud previa de una etapa, con marcas relativas a AHORA (`hace` en horas). */
const previa = (etapa: string, extra: Record<string, unknown> = {}, haceHoras = 1) => ({
  etapa, desde: ts(-haceHoras * H), qrEnviadoEn: null, evento: { id: 'e1', calendario: 'cal-1' },
  cotejos: 0, seguimientos: 0, seguimientoEn: null, reactivadaEn: null, aFavorHasta: null, aFavorDe: null,
  monto: null, ...extra,
});

const regla2 = (etapa: string, venceEnHoras: number, extra: Record<string, unknown> = {}) =>
  previa(etapa, { reglaCobro: 2, venceEn: ts(venceEnHoras * H), prorrogaHasta: null, ...extra });

const ETAPAS = ['horarios', 'qr_enviado', 'agendada', 'vencida', 'a_favor', 'en_revision', 'cancelada', 'desconocida'];

const PREVIAS: Record<string, unknown> = {
  ausente: undefined,
  nula: null,
  no_objeto: 'texto',
  vacia: {},
  sin_etapa_con_desde: { desde: ts(-H) },
};
for (const e of ETAPAS) {
  PREVIAS[`${e}_reciente`] = previa(e);
  PREVIAS[`${e}_vieja_30h`] = previa(e, {}, 30);
  PREVIAS[`${e}_exacta_24h`] = previa(e, {}, 24);
  PREVIAS[`${e}_sin_desde`] = previa(e, { desde: null });
  PREVIAS[`${e}_con_cotejo`] = previa(e, { cotejos: 1 });
  PREVIAS[`${e}_cotejo_otra_cita`] = previa(e, { cotejos: 2, evento: { id: 'otra', calendario: 'cal-1' } });
  PREVIAS[`${e}_sin_evento`] = previa(e, { cotejos: 1, evento: null });
  PREVIAS[`${e}_regla2_a_tiempo`] = regla2(e, 2);
  PREVIAS[`${e}_regla2_vencida_5h`] = regla2(e, -5);
  PREVIAS[`${e}_regla2_vencida_30h`] = regla2(e, -30);
  PREVIAS[`${e}_regla2_prorrogada`] = regla2(e, -5, { prorrogaHasta: ts(3 * H) });
  PREVIAS[`${e}_regla1_marcada`] = previa(e, { reglaCobro: 1, venceEn: ts(2 * H) });
  PREVIAS[`${e}_regla2_sin_vence`] = previa(e, { reglaCobro: 2 });
}
PREVIAS['a_favor_vigente'] = previa('a_favor', { aFavorHasta: ts(3 * 24 * H), aFavorDe: { id: 'e1', calendario: 'cal-1' } });
PREVIAS['a_favor_vencido'] = previa('a_favor', { aFavorHasta: ts(-H), aFavorDe: { id: 'e1', calendario: 'cal-1' } });
PREVIAS['a_favor_justo'] = previa('a_favor', { aFavorHasta: ts(0) });
PREVIAS['con_seguimiento'] = previa('horarios', { seguimientos: 1, seguimientoEn: ts(-2 * H) });
PREVIAS['con_reactivada'] = previa('horarios', { seguimientos: 1, seguimientoEn: ts(-2 * H), reactivadaEn: ts(-H) });
PREVIAS['con_marcas_segundos'] = previa('horarios', { seguimientoEn: { seconds: Math.floor((AHORA - 2 * H) / 1000) } });

const EVENTOS: (string | undefined)[] = [
  'qr_enviado', 'horarios_ofrecidos', 'cita_cancelada', 'reprogramada', 'adelanto_aplicado', 'cita_agendada',
  'cita_pagada', 'no_contactar', 'otro_evento', '', undefined,
];

const DATOS: Record<string, Record<string, unknown>> = {
  vacios: {},
  con_referencia: { referencia: 'e1', calendario: 'cal-1' },
  referencia_con_espacios: { referencia: '  e1  ', calendario: '  cal-1  ' },
  referencia_otra: { referencia: 'otra', calendario: 'cal-1' },
  cancelacion_con_anticipacion: { referencia: 'e1', calendario: 'cal-1', inicio: new Date(AHORA + 5 * H).toISOString() },
  cancelacion_sin_anticipacion: { referencia: 'e1', calendario: 'cal-1', inicio: new Date(AHORA + H).toISOString() },
  cancelacion_justo_2h: { referencia: 'e1', calendario: 'cal-1', inicio: new Date(AHORA + 2 * H).toISOString() },
  cancelacion_inicio_roto: { referencia: 'e1', calendario: 'cal-1', inicio: 'no es una fecha' },
  reprogramada_con_nueva: { referencia: 'e1', calendario: 'cal-1', nueva: 'e2', inicio: new Date(AHORA + 5 * H).toISOString() },
  reprogramada_nueva_vacia: { referencia: 'e1', calendario: 'cal-1', nueva: '   ', inicio: new Date(AHORA + 5 * H).toISOString() },
  adelanto_con_nueva_cita: { referencia: 'e9', calendario: 'cal-2' },
  venta_con_monto: { referencia: 'cat_1', monto: 150.456 },
  venta_monto_invalido: { referencia: 'cat_1', monto: -3 },
  venta_monto_texto: { referencia: 'cat_1', monto: 'mucho' },
  cobro_real: { cobroReal: true },
  cobro_real_con_referencia: { referencia: 'e1', calendario: 'cal-1', cobroReal: true },
  cobro_simulado: { cobroReal: false },
};

const RELOJES: Record<string, number> = { ahora: AHORA, dentro_de_3h: AHORA + 3 * H, dentro_de_40h: AHORA + 40 * H };

/** La huella de una lista de resultados: si cambia un solo caso del bloque, cambia la huella. */
const huella = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);

function rejilla(): Record<string, unknown> {
  const salida: Record<string, unknown> = {};
  const resultados: Record<string, unknown[]> = {};
  const anotar = (bloque: string, valor: unknown) => { (resultados[bloque] ??= []).push(valor); };
  // solicitudTras: evento x previa, y dentro de cada bloque todos los datos y relojes (en orden fijo).
  // El golden guarda una huella por bloque (4 MB de casos enteros no caben en el repositorio); un
  // bloque que falla dice evento y previa, y ahí se reproduce el caso.
  for (const [nombreEv, ev] of EVENTOS.map((e) => [String(e), e] as const)) {
    for (const [nombreP, p] of Object.entries(PREVIAS)) {
      for (const [nombreD, d] of Object.entries(DATOS)) {
        for (const [nombreR, ms] of Object.entries(RELOJES)) {
          if (nombreR !== 'ahora' && !['vacios', 'con_referencia', 'cobro_real_con_referencia'].includes(nombreD)) continue;
          anotar(`solicitudTras|${nombreEv}|${nombreP}`, plano(solicitudTras(p, ev, ms, d)));
        }
      }
    }
  }
  for (const [nombreP, p] of Object.entries(PREVIAS)) {
    for (const [nombreR, ms] of Object.entries(RELOJES)) {
      anotar(`cierreBloqueadoPorCobro|${nombreP}`, cierreBloqueadoPorCobro(p, ms));
      anotar(`cierreDeVentaLoHaceElCotejo|${nombreP}`, cierreDeVentaLoHaceElCotejo(p, ms));
      for (const dir of ['entrante', 'saliente'] as const) anotar(`reactivaTras|${nombreP}|${dir}`, reactivaTras(p, dir, ms));
    }
  }
  for (const [bloque, lista] of Object.entries(resultados)) salida[bloque] = huella(lista);
  // Para la prueba de cobertura: cuántos resultados no nulos / verdaderos hubo.
  salida['__cobertura'] = {
    solicitudesCreadas: Object.entries(resultados).filter(([k]) => k.startsWith('solicitudTras|')).reduce((t, [, l]) => t + l.filter((x) => x !== null).length, 0),
    solicitudesNulas: Object.entries(resultados).filter(([k]) => k.startsWith('solicitudTras|')).reduce((t, [, l]) => t + l.filter((x) => x === null).length, 0),
    etapas: [...new Set(Object.entries(resultados).filter(([k]) => k.startsWith('solicitudTras|')).flatMap(([, l]) => l).filter((x) => x !== null).map((x) => (x as { etapa: string }).etapa))].sort(),
    bloqueadoVerdadero: Object.entries(resultados).some(([k, l]) => k.startsWith('cierreBloqueadoPorCobro|') && l.includes(true)),
    cotejoVerdadero: Object.entries(resultados).some(([k, l]) => k.startsWith('cierreDeVentaLoHaceElCotejo|') && l.includes(true)),
    reactivaVerdadero: Object.entries(resultados).some(([k, l]) => k.startsWith('reactivaTras|') && l.includes(true)),
  };
  const MARCAS: Record<string, unknown> = {
    timestamp: Timestamp.fromMillis(AHORA),
    timestamp_cero: Timestamp.fromMillis(0),
    date: new Date(AHORA),
    numero: AHORA,
    numero_cero: 0,
    nulo: null,
    indefinido: undefined,
    texto: '2026-10-05T15:00:00Z',
    seconds_numero: { seconds: 1234 },
    seconds_texto: { seconds: '1234' },
    toMillis_falso: { toMillis: () => 777 },
    toMillis_no_funcion: { toMillis: 5 },
    objeto_vacio: {},
    booleano: true,
  };
  for (const [n, v] of Object.entries(MARCAS)) {
    // Las marcas que valen AHORA se guardan como desplazamiento (0), el resto tal cual.
    const r = milisegundosDe(v);
    salida[`milisegundosDe|${n}`] = r === AHORA ? 'AHORA' : r;
  }
  salida['constantes'] = {
    DIAS_ADELANTO_A_FAVOR, HORAS_ANTICIPACION_PARA_CANCELAR, MINUTOS_RETENCION_POR_DEFECTO,
    ETAPAS_PENDIENTES: [...ETAPAS_PENDIENTES].sort(),
  };
  return salida;
}

describe('F3b-1a: lo movido da exactamente lo mismo que antes', () => {
  const hoy = rejilla();

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
});
