// HORARIO DE ATENCIÓN — lectura, validación y escritura del formulario de la
// consola (funciones puras, sin React, para poder probarlas). Contrato y
// motivos: ver el bloque «HORARIO DE ATENCIÓN» de `paginas/Configuracion.tsx`
// y `functions/src/core/prompt/horario-tramos.ts`.
export const DIAS_SEMANA = [
  ['lun', 'Lunes'], ['mar', 'Martes'], ['mie', 'Miércoles'], ['jue', 'Jueves'],
  ['vie', 'Viernes'], ['sab', 'Sábado'], ['dom', 'Domingo'],
] as const;

export type TramoHorario = { desde: string; hasta: string };

export type DiaHorario = {
  cerrado: boolean;
  /** Siempre al menos uno; hasta `MAX_TRAMOS`. Un tramo vacío (sin horas) es «sin datos». */
  tramos: TramoHorario[];
  /** Lo que había guardado y no se pudo leer, para decírselo al comercio. */
  ilegible?: string;
};

/** Tope de turnos por día: el mismo que el servidor (`horario-tramos.ts`). */
export const MAX_TRAMOS = 3;
const RANGO_HORARIO = /^(([01]\d|2[0-3]):[0-5]\d)-(([01]\d|2[0-3]):[0-5]\d)$/;
export const TRAMO_VACIO: TramoHorario = { desde: '', hasta: '' };
export const DIA_VACIO: DiaHorario = { cerrado: false, tramos: [TRAMO_VACIO] };

export function leerHorarios(valor: unknown): Record<string, DiaHorario> {
  const crudo = (typeof valor === 'object' && valor !== null)
    ? valor as Record<string, unknown> : {};
  const salida: Record<string, DiaHorario> = {};
  for (const [clave] of DIAS_SEMANA) {
    const v = crudo[clave];
    if (v === undefined) { salida[clave] = DIA_VACIO; continue; }
    if (v === 'cerrado') { salida[clave] = { ...DIA_VACIO, cerrado: true }; continue; }
    // Un rango («09:00-18:00») o hasta tres separados por coma.
    const partes = typeof v === 'string' ? v.split(',') : [];
    const tramos = partes.map((p) => RANGO_HORARIO.exec(p));
    salida[clave] = partes.length >= 1 && partes.length <= MAX_TRAMOS && tramos.every((m) => m !== null)
      ? { cerrado: false, tramos: tramos.map((m) => ({ desde: m![1]!, hasta: m![3]! })) }
      // Un valor viejo con otro formato (cargado por script, antes de que la
      // regla lo cerrara) se muestra vacío y se avisa: guardarlo tal cual haría
      // que el servidor rechazara TODO el formulario sin decir por qué.
      : { ...DIA_VACIO, ilegible: String(v).slice(0, 40) };
  }
  return salida;
}

/** `null` si el día está bien (o sin datos). Si no, qué corregir. */
export function errorDelDia(d: DiaHorario): string | null {
  if (d.cerrado) return null;
  const unico = d.tramos.length === 1;
  for (let i = 0; i < d.tramos.length; i++) {
    const t = d.tramos[i] ?? TRAMO_VACIO;
    const turno = unico ? '' : ` del turno ${i + 1}`;
    if (t.desde === '' && t.hasta === '') {
      // Un solo tramo vacío es un día sin datos; un turno agregado y vacío, no.
      if (unico) return null;
      return `Completa el turno ${i + 1} o quítalo.`;
    }
    if (t.desde === '') return `Falta la hora de apertura${turno}.`;
    if (t.hasta === '') return `Falta la hora de cierre${turno}.`;
    // Se compara como texto: con «HH:MM» de largo fijo da el mismo orden que
    // las horas. Es la misma comparación que hace la regla.
    if (t.desde >= t.hasta) return `La hora de apertura${turno} tiene que ser anterior a la de cierre.`;
    const previo = d.tramos[i - 1];
    if (previo && previo.hasta >= t.desde) {
      return `El turno ${i + 1} tiene que empezar después de que termina el turno ${i}.`;
    }
  }
  return null;
}

export function escribirHorarios(h: Record<string, DiaHorario>): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const [clave] of DIAS_SEMANA) {
    const d = h[clave] ?? DIA_VACIO;
    if (d.cerrado) { salida[clave] = 'cerrado'; continue; }
    const completos = d.tramos.filter((t) => t.desde !== '' && t.hasta !== '');
    if (completos.length > 0) salida[clave] = completos.map((t) => `${t.desde}-${t.hasta}`).join(',');
  }
  return salida;
}
