/**
 * LA LÓGICA PURA DE LA CAMPAÑA SALIENTE DEL CHAT (módulo `campanas` v2, PR-C, 26/11/2026).
 *
 * Sin Firestore, sin red, sin reloj propio (la hora entra por parámetro): lo que decide a quién se le escribe, cuándo se detiene la
 * campaña y cómo se parte el envío. `campana-saliente.mjs` solo la usa; cada regla de aquí tiene su prueba negativa en
 * `pruebas/modulos/campanas/salientes.test.ts`.
 *
 * LA LISTA sale del miniCRM del chat (filas con teléfono, fecha de registro, etapa y estado). Un teléfono puede estar en varias filas
 * (una por conversación de 24 h): se decide POR TELÉFONO y sale UNA sola vez. Cada teléfono excluido cae en UN motivo, el primero de
 * `MOTIVOS` que le toca, así los conteos suman exactamente los teléfonos distintos y nunca se muestra un teléfono.
 */

/** El teléfono de Bolivia sin espacios: 591, un 6 o un 7 y siete dígitos. Lo demás no se escribe. */
export const TELEFONO_VALIDO = /^591[67][0-9]{7}$/;
/** Cuántos días hacia atrás cuenta una fila (por la fecha MÁXIMA de las filas del teléfono). */
export const VENTANA_DIAS = 60;
/** Quien escribió en las últimas 24 h tiene la ventana de Meta abierta: no es para una plantilla. */
export const HORAS_DE_VENTANA = 24;
/** El tope duro de mensajes de campaña por día de La Paz (el contador `topesDeEnvio/c_{tenant}`). */
export const TOPE_DIARIO = 200;
/** El tamaño de una tanda (cada una con su botón de Andres) y su rango permitido. */
export const TANDA_MINIMA = 40;
export const TANDA_MAXIMA = 50;
/** El sub-lote: igual que `MAXIMO_POR_RECLAMO` de Core, para que ningún mensaje caduque esperando su reclamo. */
export const TAMANO_DE_SUBLOTE = 10;
/** Pausa: errores por encima del 10 % (con al menos 10 enviados) o «No» por encima del 25 %. */
export const MINIMO_PARA_JUZGAR_ERRORES = 10;

/** Los motivos de exclusión, en el orden en que se aplican (el primero que le toca a un teléfono es el suyo). */
export const MOTIVOS = Object.freeze([
  'invalido', 'cerrada', 'fechaIlegible', 'prueba', 'baja', 'bloqueada', 'noContactar', 'fueraDeVentana', 'sinConversacion', 'reciente',
]);

const DIA_MS = 86_400_000;
const HORA_MS = 3_600_000;
/** La Paz es UTC-4 fijo, sin horario de verano. */
const DESFASE_LA_PAZ_MS = 4 * HORA_MS;

/** El teléfono tal como está en la hoja, o `null` si no es uno válido (un `+` inicial se tolera; espacios o guiones, no). */
export function telefonoValido(valor) {
  if (typeof valor !== 'string' && typeof valor !== 'number') return null;
  const t = String(valor).startsWith('+') ? String(valor).slice(1) : String(valor);
  return TELEFONO_VALIDO.test(t) ? t : null;
}

/** ¿La etapa o el estado de la fila es «Ganado» o «Perdido»? Sin tildes, sin mayúsculas, sin el número inicial («5. Ganado»). */
export function etapaCerrada(texto) {
  if (typeof texto !== 'string') return false;
  const t = texto.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().trim().replace(/^\d+\.\s*/, '');
  return /\b(ganado|perdido)\b/.test(t);
}

/**
 * La fecha de una fila, en milisegundos UTC, o `null` si es ilegible. Acepta AAAA-MM-DD, AAAA-MM-DD HH:MM y DD/MM/AAAA, en hora
 * de La Paz (sin hora, 00:00). Una fecha que no existe en el calendario (30/02) es ilegible, igual que cualquier otro formato.
 */
export function fechaDeFila(valor) {
  if (typeof valor !== 'string') return null;
  const t = valor.trim();
  let a; let m; let d; let h = 0; let mi = 0;
  let r = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/.exec(t);
  if (r) { a = Number(r[1]); m = Number(r[2]); d = Number(r[3]); if (r[4] !== undefined) { h = Number(r[4]); mi = Number(r[5]); } }
  else {
    r = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
    if (!r) return null;
    d = Number(r[1]); m = Number(r[2]); a = Number(r[3]);
  }
  if (m < 1 || m > 12 || d < 1 || h > 23 || mi > 59) return null;
  const utc = Date.UTC(a, m - 1, d, h, mi);
  const f = new Date(utc);
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return null;
  return utc + DESFASE_LA_PAZ_MS;
}

/** El día de La Paz (como número de días desde 1970) de un instante. */
const diaDeLaPaz = (ms) => Math.floor((ms - DESFASE_LA_PAZ_MS) / DIA_MS);

/** Cuántos días de La Paz pasaron entre la fecha de la fila y ahora (0 = hoy). */
export const diasDesde = (fechaMs, ahoraMs) => diaDeLaPaz(ahoraMs) - diaDeLaPaz(fechaMs);

/** Un `Timestamp` de Firestore, una fecha o milisegundos, como milisegundos; `null` si no se puede leer. */
export function milisegundosDe(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v instanceof Date) return v.getTime();
  if (v && typeof v.toMillis === 'function') return v.toMillis();
  return null;
}

/**
 * LA LISTA. Devuelve `{ destinatarios, conteos }`; nunca teléfonos en los conteos.
 *
 *   filas          [{ telefono, fecha, etapa, estado }] tal como las lee el miniCRM (texto).
 *   conversaciones Map<teléfono, { ultimoEntranteEn, bloqueada, noContactar }> de las conversaciones que EXISTEN en Firestore.
 *   bajas          Set<teléfono> de `tenants/{t}/bajas`.
 *   telefonosDePrueba  Set<teléfono> que nunca reciben la campaña.
 *   ahoraMs        la hora de la corrida.
 *
 * Excluye, con su conteo: teléfono inválido; Ganado o Perdido en CUALQUIER fila del teléfono; fecha ilegible en alguna fila; teléfono de
 * prueba; baja; conversación bloqueada; `noContactar`; fuera de los 60 días (por la fecha MÁXIMA de sus filas); sin conversación (o sin
 * un entrante legible); y entrante en las últimas 24 h. Los duplicados salen como UN envío (`filasRepetidas` cuenta las filas de más).
 */
export function armarLista({ filas, conversaciones, bajas, telefonosDePrueba, ahoraMs, ventanaDias = VENTANA_DIAS }) {
  const conteos = Object.fromEntries(MOTIVOS.map((m) => [m, 0]));
  conteos.filas = Array.isArray(filas) ? filas.length : 0;
  conteos.telefonos = 0;
  conteos.filasRepetidas = 0;
  conteos.destinatarios = 0;
  /** @type {Map<string, { valido: string|null, cerrada: boolean, ilegible: boolean, max: number|null }>} */
  const porTelefono = new Map();
  for (const f of filas ?? []) {
    const crudo = f?.telefono === undefined || f?.telefono === null ? '' : String(f.telefono).trim();
    const valido = telefonoValido(crudo);
    const clave = valido ?? `\u0000${crudo}`; // los inválidos también se cuentan UNA vez por valor
    let t = porTelefono.get(clave);
    if (!t) { t = { valido, cerrada: false, ilegible: false, max: null }; porTelefono.set(clave, t); } else conteos.filasRepetidas += 1;
    if (etapaCerrada(f?.etapa) || etapaCerrada(f?.estado)) t.cerrada = true;
    const fecha = fechaDeFila(f?.fecha);
    if (fecha === null) t.ilegible = true;
    else if (t.max === null || fecha > t.max) t.max = fecha;
  }
  conteos.telefonos = porTelefono.size;

  const destinatarios = [];
  for (const t of porTelefono.values()) {
    let motivo = null;
    const conv = t.valido === null ? null : conversaciones?.get?.(t.valido) ?? null;
    if (t.valido === null) motivo = 'invalido';
    else if (t.cerrada) motivo = 'cerrada';
    else if (t.ilegible || t.max === null || diasDesde(t.max, ahoraMs) < 0) motivo = 'fechaIlegible';
    else if (telefonosDePrueba?.has?.(t.valido)) motivo = 'prueba';
    else if (bajas?.has?.(t.valido)) motivo = 'baja';
    else if (conv?.bloqueada === true) motivo = 'bloqueada';
    else if (conv?.noContactar === true) motivo = 'noContactar';
    else if (diasDesde(t.max, ahoraMs) > ventanaDias) motivo = 'fueraDeVentana';
    else if (conv === null || milisegundosDe(conv.ultimoEntranteEn) === null) motivo = 'sinConversacion';
    else if (ahoraMs - milisegundosDe(conv.ultimoEntranteEn) < HORAS_DE_VENTANA * HORA_MS) motivo = 'reciente';
    if (motivo !== null) { conteos[motivo] += 1; continue; }
    destinatarios.push({ telefono: t.valido, fechaMaxMs: t.max });
  }
  conteos.destinatarios = destinatarios.length;
  return { destinatarios, conteos };
}

/**
 * Parte `n` envíos en tandas de `tamano` (de 40 a 50); la última lleva lo que sobre. Devuelve los tamaños: `[50, 50, 12]`.
 * Un tamaño fuera de 40..50 o un `n` negativo no se parte (error): una tanda de 200 no existe.
 */
export function partirEnTandas(n, tamano = TANDA_MAXIMA) {
  if (!Number.isInteger(n) || n < 0) throw new RangeError('n tiene que ser un entero de 0 en adelante');
  if (!Number.isInteger(tamano) || tamano < TANDA_MINIMA || tamano > TANDA_MAXIMA) {
    throw new RangeError(`el tamaño de la tanda va de ${TANDA_MINIMA} a ${TANDA_MAXIMA}`);
  }
  const tandas = [];
  for (let resto = n; resto > 0; resto -= tamano) tandas.push(Math.min(tamano, resto));
  return tandas;
}

/** Parte una lista en sub-lotes (de 10 por omisión). */
export function partirEnLotes(lista, tamano = TAMANO_DE_SUBLOTE) {
  if (!Number.isInteger(tamano) || tamano < 1) throw new RangeError('el tamaño del lote tiene que ser un entero positivo');
  const lotes = [];
  for (let i = 0; i < lista.length; i += tamano) lotes.push(lista.slice(i, i + tamano));
  return lotes;
}

/**
 * ¿Se pausa la campaña? `enviados` = mensajes que se intentaron, `errores` = rechazados, `no` = respuestas «No».
 * Errores por ENCIMA del 10 % con al menos 10 enviados, o «No» por ENCIMA del 25 %. Exactamente 10 % (o 25 %) no pausa: aritmética
 * entera, sin decimales.
 */
export function evaluarPausa({ enviados, errores, no = 0 }) {
  for (const v of [enviados, errores, no]) if (!Number.isInteger(v) || v < 0) return { pausar: true, motivo: 'datos' };
  if (errores > enviados || no > enviados) return { pausar: true, motivo: 'datos' };
  if (enviados >= MINIMO_PARA_JUZGAR_ERRORES && errores * 10 > enviados) return { pausar: true, motivo: 'errores' };
  if (enviados > 0 && no * 4 > enviados) return { pausar: true, motivo: 'no' };
  return { pausar: false, motivo: null };
}
