/**
 * HORARIO DE UN DÍA CON VARIOS TRAMOS (turno partido) — contrato y validación.
 *
 * CONTRATO (23/10/2026, decisión de Andres). `tenants/{t}/config/negocio.horarios`
 * sigue siendo un mapa `lun … dom` de TEXTOS. El valor de un día es:
 *   - `cerrado`;
 *   - un tramo, `HH:MM-HH:MM` (el formato de siempre; sigue válido tal cual); o
 *   - de dos a tres tramos separados por coma SIN espacios,
 *     `09:00-12:00,14:00-18:00`.
 * Cada tramo abre antes de cerrar; los tramos van ordenados y NO se solapan ni se
 * tocan (el cierre de uno es anterior a la apertura del siguiente); todo dentro
 * del día (`00:00`–`23:59`, sin cruzar la medianoche). Hora de La Paz (UTC-4).
 *
 * Se conserva el texto (y no una lista) a propósito: los lectores del flujo
 * (`agTramos`, `tramosDelDia`, el horario de funcionarios) ya parten por coma, y
 * un documento de un solo rango no cambia ni un byte.
 *
 * QUIÉN VALIDA QUÉ. La regla de Firestore (`horarioDiaValido`) exige la FORMA
 * (hasta tres tramos con horas reales) y que el primer tramo abra antes de cerrar:
 * es todo lo que cabe en el presupuesto de 1.000 expresiones de `config/negocio`
 * (cada comparación de más, por siete días, la deja sin margen). El orden y el
 * solape lo exige la consola al guardar y, aquí, el servidor al LEER: un día con
 * varios tramos mal ordenados o solapados NO llega al asistente ni a los flujos
 * (se omite, como un día sin datos). Falla cerrado: no se anuncia un horario que
 * no se pudo verificar.
 */

export interface Tramo { abre: string; cierra: string }

/** Tope de tramos por día. */
export const MAX_TRAMOS = 3;

const UN_TRAMO = '([01]\\d|2[0-3]):[0-5]\\d-([01]\\d|2[0-3]):[0-5]\\d';
/** Un día con DOS o más tramos separados por coma (forma, no validez). */
const FORMA_VARIOS = new RegExp(`^${UN_TRAMO}(,${UN_TRAMO})+$`);
const TRAMO = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/;

/** ¿El valor tiene forma de varios tramos? Un solo rango o `cerrado` no. */
export function esVariosTramos(valor: unknown): valor is string {
  return typeof valor === 'string' && FORMA_VARIOS.test(valor.trim());
}

/**
 * Los tramos de un valor de día con varios tramos, o `null` si no cumple el
 * contrato (más de tres, desordenados, solapados o tocándose, cierre <= apertura).
 * Las horas son `HH:MM` de largo fijo, así que comparar texto es comparar horas.
 */
export function tramosValidos(valor: unknown): Tramo[] | null {
  if (!esVariosTramos(valor)) return null;
  const partes = valor.trim().split(',');
  if (partes.length > MAX_TRAMOS) return null;
  const tramos: Tramo[] = [];
  for (const parte of partes) {
    const m = TRAMO.exec(parte);
    if (!m) return null;
    const abre = m[1] as string;
    const cierra = m[2] as string;
    if (abre >= cierra) return null;
    const previo = tramos[tramos.length - 1];
    if (previo && previo.cierra >= abre) return null;
    tramos.push({ abre, cierra });
  }
  return tramos;
}

/**
 * Los horarios tal como deben verlos el asistente y los flujos: los días con
 * varios tramos inválidos se quitan. Todo lo demás pasa SIN cambios (un rango,
 * `cerrado`, y también los valores heredados que no son varios tramos), para no
 * alterar el comportamiento del formato viejo.
 */
export function horariosSaneados(horarios: unknown): Record<string, unknown> {
  if (typeof horarios !== 'object' || horarios === null) return {};
  const salida: Record<string, unknown> = {};
  for (const [dia, valor] of Object.entries(horarios as Record<string, unknown>)) {
    if (esVariosTramos(valor) && tramosValidos(valor) === null) continue;
    salida[dia] = valor;
  }
  return salida;
}

/** `09:00-12:00,14:00-18:00` → `de 09:00 a 12:00 y de 14:00 a 18:00`. */
export function tramosEnPalabras(tramos: Tramo[]): string {
  return tramos.map((t) => `de ${t.abre} a ${t.cierra}`).join(' y ');
}
