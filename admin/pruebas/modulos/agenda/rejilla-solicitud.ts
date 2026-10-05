/**
 * LA REJILLA de la equivalencia de `solicitudTras` y de los predicados de cobro
 * (F3b-1a, ampliada en F3b-1b).
 *
 * Es solo DATOS Y UNA FUNCIÓN: NO importa nada de `functions/src` (solo el
 * `Timestamp` de la biblioteca), y recibe las funciones a probar por parámetro.
 * Así la misma rejilla corre contra el código de antes de mudarlo (cuando se
 * generó el golden, con el código de `9e0f247b`) y contra el de después (en la
 * prueba), sin que la rejilla dependa de dónde viva cada pieza. Eso es lo que
 * permite que F3b-1b mueva los predicados de Agenda a Cobros sin tocar la
 * rejilla ni el golden.
 *
 * F3b-1b agrega los bordes que pidió seguridad y que el golden de F3b-1a no
 * tenía: el cobro de regla 2 vencido hace EXACTAMENTE 24 h (`regla2(e, -24)`) y
 * con el límite igual a ahora (`regla2(e, 0)`), el seguimiento enviado
 * «ahora», y relojes de ±1 ms y de 24 h menos 1 ms y 24 h justas. La ventana de
 * 24 h se decide con `<=` en un lado y con `>` en el otro: un `<` por un `<=`
 * es el error que estos bordes atrapan.
 */
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';

export const H = 3_600_000;
export const AHORA = Date.UTC(2026, 9, 5, 15, 0, 0);

/** Lo que la rejilla le pide al código a probar; la prueba lo arma con las funciones de cada lugar. */
export interface FuncionesDeLaRejilla {
  solicitudTras(previa: unknown, evento: string | undefined, ahoraMs: number, datos: Record<string, unknown>): unknown;
  cierreBloqueadoPorCobro(previa: unknown, ahoraMs: number): boolean;
  cierreDeVentaLoHaceElCotejo(previa: unknown, ahoraMs: number): boolean;
  reactivaTras(previa: unknown, direccion: 'entrante' | 'saliente', ahoraMs: number): boolean;
  milisegundosDe(v: unknown): number | null;
  /** Las constantes exportadas, ya listas para comparar (los conjuntos, como listas ordenadas). */
  constantes: Record<string, unknown>;
}

/** Un valor con sus `Timestamp` como desplazamiento respecto de AHORA, para que el golden no lleve fechas largas. */
export function plano(v: unknown): unknown {
  if (v instanceof Timestamp) return { __ts: v.toMillis() - AHORA };
  if (Array.isArray(v)) return v.map(plano);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plano(x)]));
  return v === undefined ? '__undefined' : v;
}

export const ts = (desplazamiento: number) => Timestamp.fromMillis(AHORA + desplazamiento);

/** Una solicitud previa de una etapa, con marcas relativas a AHORA (`hace` en horas). */
export const previa = (etapa: string, extra: Record<string, unknown> = {}, haceHoras = 1) => ({
  etapa, desde: ts(-haceHoras * H), qrEnviadoEn: null, evento: { id: 'e1', calendario: 'cal-1' },
  cotejos: 0, seguimientos: 0, seguimientoEn: null, reactivadaEn: null, aFavorHasta: null, aFavorDe: null,
  monto: null, ...extra,
});

/** Una solicitud de cobro de regla 2; `venceEnHoras` es relativo a AHORA (negativo = ya venció). */
export const regla2 = (etapa: string, venceEnHoras: number, extra: Record<string, unknown> = {}) =>
  previa(etapa, { reglaCobro: 2, venceEn: ts(venceEnHoras * H), prorrogaHasta: null, ...extra });

export const ETAPAS = ['horarios', 'qr_enviado', 'agendada', 'vencida', 'a_favor', 'en_revision', 'cancelada', 'desconocida'];

export const PREVIAS: Record<string, unknown> = {
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
  // F3b-1b: los bordes de la ventana de 24 h y del límite efectivo.
  PREVIAS[`${e}_regla2_vencida_24h`] = regla2(e, -24);
  PREVIAS[`${e}_regla2_vence_ahora`] = regla2(e, 0);
}
PREVIAS['a_favor_vigente'] = previa('a_favor', { aFavorHasta: ts(3 * 24 * H), aFavorDe: { id: 'e1', calendario: 'cal-1' } });
PREVIAS['a_favor_vencido'] = previa('a_favor', { aFavorHasta: ts(-H), aFavorDe: { id: 'e1', calendario: 'cal-1' } });
PREVIAS['a_favor_justo'] = previa('a_favor', { aFavorHasta: ts(0) });
PREVIAS['con_seguimiento'] = previa('horarios', { seguimientos: 1, seguimientoEn: ts(-2 * H) });
PREVIAS['con_reactivada'] = previa('horarios', { seguimientos: 1, seguimientoEn: ts(-2 * H), reactivadaEn: ts(-H) });
PREVIAS['con_marcas_segundos'] = previa('horarios', { seguimientoEn: { seconds: Math.floor((AHORA - 2 * H) / 1000) } });
PREVIAS['seguimiento_ahora'] = previa('horarios', { seguimientos: 1, seguimientoEn: ts(0) });

export const EVENTOS: (string | undefined)[] = [
  'qr_enviado', 'horarios_ofrecidos', 'cita_cancelada', 'reprogramada', 'adelanto_aplicado', 'cita_agendada',
  'cita_pagada', 'no_contactar', 'otro_evento', '', undefined,
];

export const DATOS: Record<string, Record<string, unknown>> = {
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

/** Los relojes de la rejilla; los de F3b-1b son los bordes de ±1 ms y de la ventana de 24 h. */
export const RELOJES: Record<string, number> = {
  ahora: AHORA, dentro_de_3h: AHORA + 3 * H, dentro_de_40h: AHORA + 40 * H,
  ahora_menos_1ms: AHORA - 1, ahora_mas_1ms: AHORA + 1,
  mas_24h_menos_1ms: AHORA + 24 * H - 1, mas_24h: AHORA + 24 * H,
};

/** Los datos con los que se prueban los relojes que no son `ahora` (la rejilla completa por cada reloj no cabe). */
const DATOS_CON_TODOS_LOS_RELOJES = ['vacios', 'con_referencia', 'cobro_real_con_referencia'];

/** La huella de una lista de resultados: si cambia un solo caso del bloque, cambia la huella. */
const huella = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);

export const MARCAS: Record<string, unknown> = {
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

/** Corre toda la rejilla contra las funciones dadas y devuelve el objeto que se guarda como golden (huellas por bloque). */
export function rejilla(f: FuncionesDeLaRejilla): Record<string, unknown> {
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
          if (nombreR !== 'ahora' && !DATOS_CON_TODOS_LOS_RELOJES.includes(nombreD)) continue;
          anotar(`solicitudTras|${nombreEv}|${nombreP}`, plano(f.solicitudTras(p, ev, ms, d)));
        }
      }
    }
  }
  for (const [nombreP, p] of Object.entries(PREVIAS)) {
    for (const ms of Object.values(RELOJES)) {
      anotar(`cierreBloqueadoPorCobro|${nombreP}`, f.cierreBloqueadoPorCobro(p, ms));
      anotar(`cierreDeVentaLoHaceElCotejo|${nombreP}`, f.cierreDeVentaLoHaceElCotejo(p, ms));
      for (const dir of ['entrante', 'saliente'] as const) anotar(`reactivaTras|${nombreP}|${dir}`, f.reactivaTras(p, dir, ms));
    }
  }
  for (const [bloque, lista] of Object.entries(resultados)) salida[bloque] = huella(lista);
  // Para la prueba de cobertura: cuántos resultados no nulos / verdaderos hubo.
  const deSolicitud = Object.entries(resultados).filter(([k]) => k.startsWith('solicitudTras|'));
  salida['__cobertura'] = {
    solicitudesCreadas: deSolicitud.reduce((t, [, l]) => t + l.filter((x) => x !== null).length, 0),
    solicitudesNulas: deSolicitud.reduce((t, [, l]) => t + l.filter((x) => x === null).length, 0),
    etapas: [...new Set(deSolicitud.flatMap(([, l]) => l).filter((x) => x !== null).map((x) => (x as { etapa: string }).etapa))].sort(),
    bloqueadoVerdadero: Object.entries(resultados).some(([k, l]) => k.startsWith('cierreBloqueadoPorCobro|') && l.includes(true)),
    cotejoVerdadero: Object.entries(resultados).some(([k, l]) => k.startsWith('cierreDeVentaLoHaceElCotejo|') && l.includes(true)),
    reactivaVerdadero: Object.entries(resultados).some(([k, l]) => k.startsWith('reactivaTras|') && l.includes(true)),
  };
  for (const [n, v] of Object.entries(MARCAS)) {
    // Las marcas que valen AHORA se guardan como un rótulo, el resto tal cual.
    const r = f.milisegundosDe(v);
    salida[`milisegundosDe|${n}`] = r === AHORA ? 'AHORA' : r;
  }
  salida['constantes'] = f.constantes;
  return salida;
}
