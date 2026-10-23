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
 * (cada comparación de más, por siete días, la deja sin margen). La AUTORIDAD del
 * orden y del solape es la NORMALIZACIÓN AL LEER (`horariosSaneados`): ordena los
 * tramos, descarta los de cierre <= apertura y fusiona los que se solapan o se
 * tocan, y si no queda ninguno devuelve `cerrado`. Es la misma unión que calculan
 * los flujos (`tramosDelDia` de `comprobar-reserva.js`, `agTramos`), así que el
 * asistente anuncia lo que el candado hace cumplir. FALLA CERRADO: un día partido
 * sin ningún tramo válido es `cerrado`, nunca un día «sin datos» (los flujos
 * toman un día ausente como «no se puede juzgar» y dejarían pasar la cita).
 * La consola y el cargador validan además al guardar.
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
 * La unión normalizada de un día con varios tramos: sin los de cierre <= apertura,
 * ordenados y con los solapados o contiguos fusionados. Lista vacía = ninguno
 * válido. Sin tope de cantidad: debe coincidir con la unión que calculan los flujos.
 * `null` si el valor no tiene forma de varios tramos.
 */
export function tramosNormalizados(valor: unknown): Tramo[] | null {
  if (!esVariosTramos(valor)) return null;
  const validos: Tramo[] = [];
  for (const parte of valor.trim().split(',')) {
    const m = TRAMO.exec(parte);
    if (m && (m[1] as string) < (m[2] as string)) validos.push({ abre: m[1] as string, cierra: m[2] as string });
  }
  validos.sort((a, b) => (a.abre < b.abre ? -1 : a.abre > b.abre ? 1 : 0));
  const unidos: Tramo[] = [];
  for (const t of validos) {
    const ultimo = unidos[unidos.length - 1];
    if (ultimo && t.abre <= ultimo.cierra) {
      if (t.cierra > ultimo.cierra) ultimo.cierra = t.cierra;
    } else {
      unidos.push({ ...t });
    }
  }
  return unidos;
}

/**
 * Los horarios tal como deben verlos el asistente y los flujos. Un día con forma
 * de varios tramos se NORMALIZA (ver arriba) y se devuelve como texto: `cerrado`
 * si no quedó ningún tramo válido. Todo lo demás (un rango, `cerrado`, valores
 * heredados que no son varios tramos) pasa SIN cambios, para no alterar el
 * comportamiento del formato viejo.
 */
export function horariosSaneados(horarios: unknown): Record<string, unknown> {
  if (typeof horarios !== 'object' || horarios === null) return {};
  const salida: Record<string, unknown> = {};
  for (const [dia, valor] of Object.entries(horarios as Record<string, unknown>)) {
    // `__proto__` como clave propia (un JSON lo permite) cambiaría el prototipo de
    // `salida` en vez de crear una clave: se descarta, no es un día.
    if (dia === '__proto__') continue;
    const tramos = tramosNormalizados(valor);
    if (tramos === null) { salida[dia] = valor; continue; }
    salida[dia] = tramos.length === 0 ? 'cerrado' : tramos.map((t) => `${t.abre}-${t.cierra}`).join(',');
  }
  return salida;
}

/** `09:00-12:00,14:00-18:00` → `de 09:00 a 12:00 y de 14:00 a 18:00`. */
export function tramosEnPalabras(tramos: Tramo[]): string {
  return tramos.map((t) => `de ${t.abre} a ${t.cierra}`).join(' y ');
}

const DIAS_FLUJO = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'] as const;
/**
 * Un tramo tal como lo LEE el candado de los flujos (`tramosDelDia` de
 * `comprobar-reserva.js`): horas de uno o dos dígitos, separador `-`, `–` o `a`,
 * con espacios opcionales. Lo que el flujo acepta aquí se conserva (normalizado a
 * `HH:MM`) para no cerrarle la agenda a quien hoy funciona.
 */
const TRAMO_FLEXIBLE = /^(\d{1,2}):(\d{2})\s*[-\u2013a]\s*(\d{1,2}):(\d{2})$/;
const aMin = (h: string, m: string): number | null => {
  const hh = Number(h); const mm = Number(m);
  return hh <= 24 && mm < 60 && (hh < 24 || mm === 0) ? hh * 60 + mm : null;
};
const hhmm = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/**
 * El horario de un funcionario tal como debe llegar a los FLUJOS: FALLA CERRADO.
 *
 * POR QUÉ. El candado de horario (`fueraDeHorario`) toma un día ilegible como
 * «no se puede juzgar» y deja pasar la cita (falla abierta a propósito para no
 * deshacer citas buenas por una configuración incompleta). Pero la regla de
 * Firestore solo exige que `horarioTrabajo` sea un mapa: un día con texto ilegible
 * («x», «9 a 5», «09:00-») llegaba intacto y se podía agendar fuera de horario.
 * Aquí, para lo que va a los flujos, todo día NO vacío que no sea `cerrado`, un
 * rango legible o varios tramos legibles pasa a `cerrado`. Un día vacío o ausente
 * se deja vacío (sin dato: el comportamiento de siempre). Solo recorre `lun…dom`.
 *
 * NO se usa para `horarioAtencion` (el texto que lee el cliente): ahí «solo con
 * cita previa» es un texto legítimo.
 */
export function horarioParaFlujos(horarios: unknown): Record<string, unknown> {
  const base = horariosSaneados(horarios);
  const salida: Record<string, unknown> = {};
  for (const dia of DIAS_FLUJO) {
    if (!Object.prototype.hasOwnProperty.call(base, dia)) continue;
    const valor = base[dia];
    if (valor === undefined || valor === null) continue;
    if (typeof valor !== 'string') { salida[dia] = 'cerrado'; continue; }
    const t = valor.trim();
    if (t === '') { salida[dia] = valor; continue; }
    if (/^cerrad[oa]s?$/i.test(t)) { salida[dia] = 'cerrado'; continue; }
    const validos: Tramo[] = [];
    for (const parte of t.split(/[,;]/)) {
      const m = TRAMO_FLEXIBLE.exec(parte.trim());
      if (!m) continue;
      const i = aMin(m[1] as string, m[2] as string);
      const f = aMin(m[3] as string, m[4] as string);
      if (i !== null && f !== null && f > i) validos.push({ abre: hhmm(i), cierra: hhmm(f) });
    }
    validos.sort((a, b) => (a.abre < b.abre ? -1 : a.abre > b.abre ? 1 : 0));
    const unidos: Tramo[] = [];
    for (const x of validos) {
      const u = unidos[unidos.length - 1];
      if (u && x.abre <= u.cierra) { if (x.cierra > u.cierra) u.cierra = x.cierra; } else unidos.push({ ...x });
    }
    salida[dia] = unidos.length === 0 ? 'cerrado' : unidos.map((x) => `${x.abre}-${x.cierra}`).join(',');
  }
  return salida;
}
