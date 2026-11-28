/**
 * LA LÓGICA PURA DE LA CAMPAÑA SALIENTE DEL CHAT (módulo `campanas` v2, PR-C, 26/11/2026).
 *
 * Sin Firestore, sin red, sin reloj propio (la hora entra por parámetro): lo que decide a quién se le escribe, cuándo se detiene la
 * campaña y cómo se parte el envío. `campana-saliente.mjs` solo la usa; cada regla de aquí tiene su prueba negativa en
 * `pruebas/modulos/campanas/salientes.test.ts`.
 *
 * LA LISTA sale del miniCRM del chat (filas con teléfono, fecha de registro y etapa del funnel, columna G). Un teléfono puede estar en varias filas
 * (una por conversación de 24 h): se decide POR TELÉFONO y sale UNA sola vez. Cada teléfono excluido cae en UN motivo, el primero de
 * `MOTIVOS` que le toca, así los conteos suman exactamente los teléfonos distintos y nunca se muestra un teléfono.
 */

/** El teléfono de Bolivia sin espacios: 591, un 6 o un 7 y siete dígitos. Lo demás no se escribe. */
export const TELEFONO_VALIDO = /^591[67][0-9]{7}$/;
/** Quien escribió en las últimas 24 h tiene la ventana de Meta abierta: no es para una plantilla. */
export const HORAS_DE_VENTANA = 24;
// Ninguna cifra de topes vive aquí: porTanda, porDia, porReclamo, ventanaDias y los porcentajes se leen de `tenants/{t}/config/campanaSaliente`.

/** Los motivos de exclusión, en el orden en que se aplican (el primero que le toca a un teléfono es el suyo). */
export const MOTIVOS = Object.freeze([
  'invalido', 'cerrada', 'fechaIlegible', 'prueba', 'baja', 'bloqueada', 'noContactar', 'riesgo', 'fueraDeVentana', 'sinConversacion',
  'otraLinea', 'reciente',
]);

/** La clave de un contacto: la MISMA para su conversación, su baja y su destinatario (`wa_<dígitos>`). */
export const claveDeContacto = (telefono) => `wa_${telefono}`;

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

/** ¿La etapa (columna G, «Etapa Funnel», y solo ella) es «Ganado» o «Perdido»? Sin tildes, sin mayúsculas, sin el número inicial («5. Ganado»). */
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

/** Cuántos teléfonos admite la lista `telefonosDePrueba` de la configuración (copia de `MAXIMO_TELEFONOS_DE_PRUEBA` del servidor). */
export const MAXIMO_TELEFONOS_DE_PRUEBA = 5;

/**
 * La lista `telefonosDePrueba` del documento `config/campanaSaliente`, o `[]` si falta, está vacía o no es exactamente lo esperado
 * (más de 5, algo que no sea una cadena de 8 a 15 dígitos, o repetidos). Copia de `leerTelefonosDePrueba` de `salidaCampana.ts`
 * (hay una prueba de paridad): el script y el servidor leen la misma lista de la misma manera.
 */
export function leerTelefonosDePrueba(d) {
  if (typeof d !== 'object' || d === null || Array.isArray(d)) return [];
  const v = d.telefonosDePrueba;
  if (!Array.isArray(v) || v.length < 1 || v.length > MAXIMO_TELEFONOS_DE_PRUEBA) return [];
  if (!v.every((t) => typeof t === 'string' && /^[0-9]{8,15}$/.test(t))) return [];
  if (new Set(v).size !== v.length) return [];
  return [...v];
}

/** Un `Timestamp` de Firestore, una fecha o milisegundos, como milisegundos; `null` si no se puede leer. */
export function milisegundosDe(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v instanceof Date) return v.getTime();
  if (v && typeof v.toMillis === 'function') return v.toMillis();
  return null;
}

/** Como `marcado` del servidor (`salidaCampana.ts`): cualquier valor distinto de ausente o `false` frena. */
const marcada = (v) => v !== undefined && v !== false;

/**
 * LA LISTA. Devuelve `{ destinatarios, conteos }`; nunca teléfonos en los conteos.
 *
 *   filas          [{ telefono, fecha, etapa }] tal como las lee el miniCRM (texto).
 *   conversaciones Map<claveDeContacto, { ultimoEntranteEn, bloqueada, noContactar, riesgoEn, phoneNumberId }> de las conversaciones que EXISTEN.
 *   bajas          Set<claveDeContacto> de `tenants/{t}/bajas` (M2: la misma clave `wa_<dígitos>`).
 *   telefonosDePrueba  Set<teléfono> que nunca reciben la campaña.
 *   ahoraMs        la hora de la corrida.
 *   ventanaDias    OBLIGATORIO: sale de `config/campanaSaliente`; sin él no hay lista.
 *   numero         el phoneNumberId de la campaña: una conversación de otra línea es `otraLinea`.
 *   excepcionPrueba  `true` SOLO para `crear --solo-prueba` (campaña `prueba: true`, un teléfono que ya está en la lista de la configuración):
 *                  levanta `prueba`, `fueraDeVentana`, `sinConversacion` y `reciente`, igual que el servidor al materializar. Siguen
 *                  rigiendo `invalido`, `cerrada`, `fechaIlegible`, `baja`, `bloqueada`, `noContactar`, `riesgo` y `otraLinea`.
 *
 * Excluye, con su conteo: teléfono inválido; Ganado o Perdido (columna G) en CUALQUIER fila del teléfono; fecha ilegible en alguna fila;
 * teléfono de prueba; baja; conversación bloqueada; `noContactar`; `riesgoEn` con valor; fuera de la ventana (por la fecha MÁXIMA de sus
 * filas); sin conversación (o sin un entrante legible); conversación de otra línea; y entrante en las últimas 24 h. Los duplicados salen
 * como UN envío (`filasRepetidas` cuenta las filas de más).
 */
export function armarLista({ filas, conversaciones, bajas, telefonosDePrueba, ahoraMs, ventanaDias, numero, excepcionPrueba = false }) {
  if (!Number.isInteger(ventanaDias) || ventanaDias < 1) throw new RangeError('ventanaDias es obligatorio (entero de 1 en adelante)');
  const conteos = Object.fromEntries(MOTIVOS.map((m) => [m, 0]));
  conteos.filas = Array.isArray(filas) ? filas.length : 0;
  conteos.telefonos = 0;
  conteos.filasRepetidas = 0;
  conteos.destinatarios = 0;
  // SOLO VISIBILIDAD (no excluye a nadie): destinatarios cuya conversación existe pero no trae `phoneNumberId`; el servidor y esta lista los cuentan como de la línea.
  conteos.sinPhoneNumberId = 0;
  /** @type {Map<string, { valido: string|null, cerrada: boolean, ilegible: boolean, max: number|null }>} */
  const porTelefono = new Map();
  for (const f of filas ?? []) {
    const crudo = f?.telefono === undefined || f?.telefono === null ? '' : String(f.telefono).trim();
    const valido = telefonoValido(crudo);
    const clave = valido ?? `\u0000${crudo}`; // los inválidos también se cuentan UNA vez por valor
    let t = porTelefono.get(clave);
    if (!t) { t = { valido, cerrada: false, ilegible: false, max: null }; porTelefono.set(clave, t); } else conteos.filasRepetidas += 1;
    if (etapaCerrada(f?.etapa)) t.cerrada = true; // solo la columna G; el estado comercial (M) no decide
    const fecha = fechaDeFila(f?.fecha);
    if (fecha === null) t.ilegible = true;
    else if (t.max === null || fecha > t.max) t.max = fecha;
  }
  conteos.telefonos = porTelefono.size;

  const destinatarios = [];
  for (const t of porTelefono.values()) {
    let motivo = null;
    const clave = t.valido === null ? null : claveDeContacto(t.valido);
    const conv = clave === null ? null : conversaciones?.get?.(clave) ?? null;
    if (t.valido === null) motivo = 'invalido';
    else if (t.cerrada) motivo = 'cerrada';
    else if (t.ilegible || t.max === null || diasDesde(t.max, ahoraMs) < 0) motivo = 'fechaIlegible';
    else if (!excepcionPrueba && telefonosDePrueba?.has?.(t.valido)) motivo = 'prueba';
    else if (bajas?.has?.(clave)) motivo = 'baja';
    else if (marcada(conv?.bloqueada)) motivo = 'bloqueada';
    else if (marcada(conv?.noContactar)) motivo = 'noContactar';
    else if (marcada(conv?.riesgoEn)) motivo = 'riesgo';
    else if (!excepcionPrueba && diasDesde(t.max, ahoraMs) > ventanaDias) motivo = 'fueraDeVentana';
    else if (!excepcionPrueba && (conv === null || milisegundosDe(conv.ultimoEntranteEn) === null)) motivo = 'sinConversacion';
    else if (conv?.phoneNumberId !== undefined && conv.phoneNumberId !== numero) motivo = 'otraLinea';
    else if (!excepcionPrueba && ahoraMs - milisegundosDe(conv.ultimoEntranteEn) < HORAS_DE_VENTANA * HORA_MS) motivo = 'reciente';
    if (motivo !== null) { conteos[motivo] += 1; continue; }
    if (conv !== null && conv.phoneNumberId === undefined) conteos.sinPhoneNumberId += 1;
    destinatarios.push({ telefono: t.valido, fechaMaxMs: t.max });
  }
  conteos.destinatarios = destinatarios.length;
  return { destinatarios, conteos };
}

/**
 * Parte `n` envíos en tandas de `porTanda` (de `config/campanaSaliente`); la última lleva lo que sobre. Devuelve los tamaños: `[45, 45, 12]`.
 * Un `porTanda` que no sea entero positivo o un `n` negativo no se parte (error).
 */
export function partirEnTandas(n, porTanda) {
  if (!Number.isInteger(n) || n < 0) throw new RangeError('n tiene que ser un entero de 0 en adelante');
  if (!Number.isInteger(porTanda) || porTanda < 1) throw new RangeError('porTanda tiene que ser un entero positivo');
  const tandas = [];
  for (let resto = n; resto > 0; resto -= porTanda) tandas.push(Math.min(porTanda, resto));
  return tandas;
}

/** Parte una lista en lotes de `tamano` (por ejemplo, de 400 escrituras). */
export function partirEnLotes(lista, tamano) {
  if (!Number.isInteger(tamano) || tamano < 1) throw new RangeError('el tamaño del lote tiene que ser un entero positivo');
  const lotes = [];
  for (let i = 0; i < lista.length; i += tamano) lotes.push(lista.slice(i, i + tamano));
  return lotes;
}

/**
 * ¿La proporción de «No» supera `pausaNoPct`? Estrictamente por ENCIMA (exactamente el porcentaje no supera): aritmética entera.
 * Datos ilegibles (negativos, no enteros, `no > enviados`, porcentaje fuera de 1..100) cuentan como «supera»: ante la duda no se autoriza.
 * La pausa por ERRORES vive en el servidor (`confirmarSalida`); esta solo la revisa el script antes de autorizar la tanda siguiente.
 */
export function superaNo({ no, enviados, pausaNoPct }) {
  for (const v of [no, enviados]) if (!Number.isInteger(v) || v < 0) return true;
  if (!Number.isInteger(pausaNoPct) || pausaNoPct < 1 || pausaNoPct > 100) return true;
  if (no > enviados) return true;
  return enviados > 0 && no * 100 > pausaNoPct * enviados;
}
