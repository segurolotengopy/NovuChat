/**
 * =============================================================================
 * CONVERSACIONES: LA LÓGICA DE LA PANTALLA, SIN REACT Y SIN FIREBASE
 * =============================================================================
 *
 * PROTOTIPO (09/10/2026). Todo lo que la pantalla DECIDE vive acá, en funciones
 * puras, por dos razones:
 *
 *  1. Se prueba sin navegador ni emulador (`pruebas/central/conversaciones-*.test.ts`):
 *     la búsqueda por teléfono y por palabra, los filtros y el «anterior /
 *     siguiente» son lo que Andres va a poner a prueba, y lo que se rompe en
 *     silencio si se toca la pantalla.
 *  2. La normalización es UNA sola. La siembra del prototipo importa estas mismas
 *     funciones para escribir `telefonoTrozos[]` y `palabras[]`, y la pantalla las
 *     usa para buscar. Cuando el servidor las escriba de verdad (la ingesta, en
 *     H1-servidor), tiene que usar esta misma regla o la búsqueda deja de
 *     encontrar lo que ya está guardado. Por eso este archivo no importa nada:
 *     se puede copiar tal cual a Core.
 *
 * Sin `import`s a propósito: la siembra lo carga con Node (que quita los tipos)
 * y no hay un empaquetador de por medio.
 *
 * LA UNIDAD ES LA CONVERSACIÓN, NO LA «ATENCIÓN» (CLAUDE.md, vocabulario).
 */

// ── Constantes de producto (Analisis plan 09/10) ─────────────────────────────

/** Ventana de servicio de Meta: se responde libremente hasta 24 h después del último mensaje del cliente. */
export const VENTANA_HORAS = 24;
/** «Ventana por vencer»: le quedan menos de estas horas. Decisión del prototipo; se ajusta con Andres. */
export const POR_VENCER_HORAS = 6;
/** Prefijo de país por defecto. En el servidor sale de `prefijosPermitidos` del tenant. */
export const PREFIJOS_PAIS_DEFECTO: readonly string[] = ['591'];
/** Mínimo de dígitos para buscar por teléfono: con menos, casi todo coincide con casi todo. */
export const MINIMO_DIGITOS = 4;
/** Tope de palabras indexadas por mensaje (decisión D4). */
export const MAX_PALABRAS_POR_MENSAJE = 30;

const HORA_MS = 3_600_000;

// ── Modelo que la pantalla usa (no el documento de Firestore) ────────────────

export type Responde = 'asistente' | 'persona';

export interface Ficha {
  id: string;
  telefono: string;
  nombre: string;
  ultimoMensaje: string;
  /** ms desde 1970; null si el documento no lo trae. */
  ultimoEn: number | null;
  /** Hora del último mensaje DEL CLIENTE: de ahí corre la ventana de 24 h. */
  ultimoEntranteEn: number | null;
  noLeidos: number;
  necesitaHumano: boolean;
  responde: Responde;
  tomadoPor: string;
  noContactar: boolean;
  telefonoTrozos: string[];
}

export type Filtro = 'todas' | 'humano' | 'asistente' | 'noLeidas' | 'vencer';

export const FILTROS: readonly { id: Filtro; rotulo: string }[] = [
  { id: 'todas', rotulo: 'Todas' },
  { id: 'humano', rotulo: 'Necesita humano' },
  { id: 'asistente', rotulo: 'El asistente atiende' },
  { id: 'noLeidas', rotulo: 'No leídas' },
  { id: 'vencer', rotulo: 'Ventana por vencer' },
];

// ── Normalización ────────────────────────────────────────────────────────────

export function soloDigitos(s: unknown): string {
  return typeof s === 'string' ? s.replace(/\D+/g, '') : '';
}

/** Minúsculas y sin tildes ni eñes: «Salteñas» y «saltenas» son la misma palabra. */
export function normalizarTexto(s: unknown): string {
  if (typeof s !== 'string') return '';
  return s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

/**
 * La raíz de una palabra, con la regla más barata que sirve al español: quitar
 * la «s» o la «es» del plural. Sin esto, quien escribe «alfajor» no encuentra
 * «alfajores» y la búsqueda parece rota. No es un lematizador: es lo mínimo
 * que se puede repetir idéntico en el servidor.
 */
export function raizDe(palabra: string): string {
  if (palabra.length > 5 && palabra.endsWith('es')) return palabra.slice(0, -2);
  if (palabra.length > 3 && palabra.endsWith('s')) return palabra.slice(0, -1);
  return palabra;
}

/**
 * Las palabras a indexar de un texto: normalizadas, de 3 letras o más, con su
 * raíz, sin repetir y como mucho 30 (decisión D4). El orden es el de aparición.
 */
export function palabrasDe(texto: unknown, max = MAX_PALABRAS_POR_MENSAJE): string[] {
  const salida: string[] = [];
  const vistas = new Set<string>();
  for (const t of normalizarTexto(texto).split(/[^a-z0-9]+/)) {
    if (t.length < 3) continue;
    const r = raizDe(t);
    if (vistas.has(r)) continue;
    vistas.add(r);
    salida.push(r);
    if (salida.length >= max) break;
  }
  return salida;
}

/**
 * Los «trozos» de un teléfono: todos sus finales de 4 dígitos o más. Con un
 * `array-contains` sobre esta lista se halla un número por los últimos 4, por
 * los últimos 8 («sin prefijo») o completo, sin que Firestore sepa buscar
 * dentro de una cadena.
 */
export function trozosDeTelefono(telefono: unknown): string[] {
  const d = soloDigitos(telefono);
  const trozos: string[] = [];
  for (let i = 0; i + MINIMO_DIGITOS <= d.length; i++) trozos.push(d.slice(i));
  return trozos;
}

// ── Qué es lo que la persona escribió en el buscador ─────────────────────────

export type Consulta =
  | { tipo: 'vacia' }
  | { tipo: 'corta'; digitos: string }
  | { tipo: 'telefono'; digitos: string }
  | { tipo: 'texto'; texto: string; palabras: string[] };

/**
 * Un buscador, dos búsquedas. Si lo escrito son solo cifras (con +, espacios,
 * guiones o paréntesis, como se pega un número) es un teléfono; si no, es texto.
 */
export function clasificarConsulta(crudo: string): Consulta {
  const q = crudo.trim();
  if (!q) return { tipo: 'vacia' };
  if (/^[\d\s+\-().]+$/.test(q)) {
    const digitos = soloDigitos(q);
    if (!digitos) return { tipo: 'vacia' };
    return digitos.length < MINIMO_DIGITOS ? { tipo: 'corta', digitos } : { tipo: 'telefono', digitos };
  }
  return { tipo: 'texto', texto: normalizarTexto(q).trim(), palabras: palabrasDe(q, 6) };
}

/**
 * ¿El teléfono coincide con lo escrito? Devuelve el MEJOR tipo de coincidencia
 * (para ordenar) o null.
 *
 *   completo   el número entero, con o sin el prefijo del país
 *   final      lo escrito es el final del número (últimos 4, últimos 8…)
 *   inicio     lo escrito es el comienzo del número, con prefijo
 *   sin-prefijo  lo escrito es el comienzo del número SIN el prefijo del país
 *              (se completa con el prefijo del tenant)
 */
export type TipoCoincidenciaTelefono = 'completo' | 'final' | 'inicio' | 'sin-prefijo';

export function coincidenciaTelefono(
  telefono: string, trozos: readonly string[] | undefined, digitos: string,
  prefijos: readonly string[] = PREFIJOS_PAIS_DEFECTO,
): TipoCoincidenciaTelefono | null {
  if (digitos.length < MINIMO_DIGITOS) return null;
  const tel = soloDigitos(telefono);
  if (!tel) return null;
  if (tel === digitos) return 'completo';
  for (const p of prefijos) if (tel === p + digitos) return 'completo';
  const finales = trozos && trozos.length ? trozos : trozosDeTelefono(tel);
  if (finales.includes(digitos)) return 'final';
  if (tel.startsWith(digitos)) return 'inicio';
  for (const p of prefijos) if (tel.startsWith(p + digitos)) return 'sin-prefijo';
  return null;
}

const PESO_TELEFONO: Record<TipoCoincidenciaTelefono, number> = {
  completo: 0, final: 1, 'sin-prefijo': 2, inicio: 3,
};

export interface ResultadoTelefono { ficha: Ficha; tipo: TipoCoincidenciaTelefono }

export function buscarPorTelefono(
  fichas: readonly Ficha[], digitos: string, prefijos: readonly string[] = PREFIJOS_PAIS_DEFECTO,
): ResultadoTelefono[] {
  const salida: ResultadoTelefono[] = [];
  for (const ficha of fichas) {
    const tipo = coincidenciaTelefono(ficha.telefono, ficha.telefonoTrozos, digitos, prefijos);
    if (tipo) salida.push({ ficha, tipo });
  }
  // Más específico primero; a igualdad, el más reciente (el orden de entrada).
  return salida.sort((a, b) => PESO_TELEFONO[a.tipo] - PESO_TELEFONO[b.tipo]);
}

/** Por nombre del contacto: todas las palabras escritas tienen que estar en el nombre. */
export function buscarPorNombre(fichas: readonly Ficha[], texto: string): Ficha[] {
  const partes = normalizarTexto(texto).split(/\s+/).filter(Boolean);
  if (!partes.length) return [];
  return fichas.filter((f) => {
    const n = normalizarTexto(f.nombre);
    return partes.every((p) => n.includes(p));
  });
}

/**
 * ¿El mensaje contiene TODAS las palabras buscadas? `palabras` es lo que la
 * consulta ya normalizó con `palabrasDe`. Es la segunda pasada de una búsqueda de
 * varias palabras: el índice (`array-contains`) solo puede preguntar por una.
 */
export function mensajeContiene(mensajePalabras: readonly string[] | undefined, texto: unknown, buscadas: readonly string[]): boolean {
  if (!buscadas.length) return false;
  const tiene = new Set(mensajePalabras && mensajePalabras.length ? mensajePalabras : palabrasDe(texto));
  return buscadas.every((p) => tiene.has(p));
}

/** La palabra por la que preguntarle al índice: la más larga, que es la más selectiva. */
export function palabraParaIndice(palabras: readonly string[]): string | null {
  let mejor: string | null = null;
  for (const p of palabras) if (mejor === null || p.length > mejor.length) mejor = p;
  return mejor;
}

/** Un fragmento del texto alrededor de la primera palabra encontrada, para mostrar en el resultado. */
export function fragmento(texto: string, buscadas: readonly string[], ancho = 70): string {
  const limpio = texto.replace(/\s+/g, ' ').trim();
  if (limpio.length <= ancho) return limpio;
  const plano = normalizarTexto(limpio);
  let pos = -1;
  for (const p of buscadas) {
    const i = plano.indexOf(p);
    if (i >= 0 && (pos < 0 || i < pos)) pos = i;
  }
  if (pos < 0) return limpio.slice(0, ancho) + '…';
  const desde = Math.max(0, Math.min(pos - Math.floor(ancho / 3), limpio.length - ancho));
  return (desde > 0 ? '…' : '') + limpio.slice(desde, desde + ancho) + (desde + ancho < limpio.length ? '…' : '');
}

// ── Ventana de 24 h ──────────────────────────────────────────────────────────

export type EstadoVentana = 'sin-mensaje' | 'abierta' | 'por-vencer' | 'cerrada';

export interface Ventana { estado: EstadoVentana; restanteMs: number }

/**
 * La ventana corre desde el ÚLTIMO MENSAJE DEL CLIENTE (`ultimoEntranteEn`), no
 * desde el último mensaje de la conversación: un mensaje del asistente o de una
 * persona no la abre ni la prolonga.
 */
export function ventanaDe(ultimoEntranteEn: number | null, ahora: number): Ventana {
  if (ultimoEntranteEn === null) return { estado: 'sin-mensaje', restanteMs: 0 };
  const restanteMs = ultimoEntranteEn + VENTANA_HORAS * HORA_MS - ahora;
  if (restanteMs <= 0) return { estado: 'cerrada', restanteMs: 0 };
  return { estado: restanteMs < POR_VENCER_HORAS * HORA_MS ? 'por-vencer' : 'abierta', restanteMs };
}

/** «3 h 20 min», «45 min», «menos de 1 min». */
export function textoRestante(ms: number): string {
  if (ms <= 0) return 'cerrada';
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'menos de 1 min';
  const h = Math.floor(min / 60);
  return h > 0 ? `${h} h ${String(min % 60).padStart(2, '0')} min` : `${min} min`;
}

// ── Filtros ──────────────────────────────────────────────────────────────────

/**
 * Qué filtros cumple una conversación. «Necesita humano» deja de ser verdad
 * cuando una persona ya la tomó: la bandera avisa que alguien tiene que
 * intervenir, y alguien ya lo hizo.
 */
export function cumpleFiltro(f: Ficha, filtro: Filtro, ahora: number): boolean {
  switch (filtro) {
    case 'todas': return true;
    case 'humano': return f.necesitaHumano && f.responde !== 'persona';
    case 'asistente': return f.responde !== 'persona';
    case 'noLeidas': return f.noLeidos > 0;
    case 'vencer': return ventanaDe(f.ultimoEntranteEn, ahora).estado === 'por-vencer';
  }
}

/**
 * Aplica el filtro. `fijadas` son las conversaciones que la persona abrió con
 * el filtro puesto: se quedan en la lista aunque al abrirlas dejen de cumplirlo
 * (una «no leída» deja de serlo al leerla). Sin esto la lista salta bajo los
 * dedos, y «siguiente» saltearía conversaciones: el que recorre las no leídas
 * con el teclado perdería su lugar.
 */
export function aplicarFiltro(
  fichas: readonly Ficha[], filtro: Filtro, ahora: number, fijadas: ReadonlySet<string> = new Set(),
): Ficha[] {
  return fichas.filter((f) => fijadas.has(f.id) || cumpleFiltro(f, filtro, ahora));
}

export function contarFiltros(fichas: readonly Ficha[], ahora: number): Record<Filtro, number> {
  const cuenta: Record<Filtro, number> = { todas: 0, humano: 0, asistente: 0, noLeidas: 0, vencer: 0 };
  for (const f of fichas) for (const k of Object.keys(cuenta) as Filtro[]) if (cumpleFiltro(f, k, ahora)) cuenta[k]++;
  return cuenta;
}

/** Más reciente arriba, como WhatsApp. */
export function ordenarPorReciente(fichas: readonly Ficha[]): Ficha[] {
  return [...fichas].sort((a, b) => (b.ultimoEn ?? 0) - (a.ultimoEn ?? 0));
}

// ── Anterior / siguiente ─────────────────────────────────────────────────────

/**
 * La conversación vecina en la lista que se está viendo. No da la vuelta: en el
 * borde se queda donde está (devuelve null), porque saltar de la última a la
 * primera desorienta a quien recorre una lista larga. Si la actual no está en
 * la lista (se filtró, o no hay ninguna abierta), «siguiente» va a la primera y
 * «anterior» a la última.
 */
export function vecina(ids: readonly string[], actual: string | null, direccion: 1 | -1): string | null {
  if (!ids.length) return null;
  const i = actual === null ? -1 : ids.indexOf(actual);
  if (i < 0) return direccion === 1 ? (ids[0] ?? null) : (ids[ids.length - 1] ?? null);
  const j = i + direccion;
  return j < 0 || j >= ids.length ? null : (ids[j] ?? null);
}

// ── Rutas ────────────────────────────────────────────────────────────────────

/**
 * La dirección de una conversación. La ruta del plan es
 * `/negocio/:t/conversaciones/:c?m=<id>`; hoy `App.tsx` (fuera de la zona
 * Central) solo declara `/negocio/:t/conversaciones`, así que el prototipo lleva
 * la conversación en `?c=`. Cuando App.tsx admita `/:c`, se cambia
 * `CONVERSACION_EN_LA_RUTA` y NADA más: la pantalla lee las dos formas.
 */
export const CONVERSACION_EN_LA_RUTA = false;

export function rutaConversaciones(tenantId: string, conversacionId?: string | null, mensajeId?: string | null): string {
  const base = `/negocio/${encodeURIComponent(tenantId)}/conversaciones`;
  if (!conversacionId) return base;
  if (CONVERSACION_EN_LA_RUTA) {
    return `${base}/${encodeURIComponent(conversacionId)}${mensajeId ? `?m=${encodeURIComponent(mensajeId)}` : ''}`;
  }
  const p = new URLSearchParams({ c: conversacionId });
  if (mensajeId) p.set('m', mensajeId);
  return `${base}?${p.toString()}`;
}

// ── Etiquetas de hora (siempre en hora de Bolivia, UTC-4 fijo) ───────────────

const BO_MS = -4 * HORA_MS;
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function enBolivia(ms: number) {
  const d = new Date(ms + BO_MS);
  return {
    dia: Math.floor((ms + BO_MS) / 86_400_000),
    h: d.getUTCHours(), min: d.getUTCMinutes(), sem: d.getUTCDay(),
    d: d.getUTCDate(), m: d.getUTCMonth() + 1, a: d.getUTCFullYear(),
  };
}
const dos = (n: number) => String(n).padStart(2, '0');

export function horaCorta(ms: number): string {
  const b = enBolivia(ms);
  return `${dos(b.h)}:${dos(b.min)}`;
}

/** La hora de la ficha: hoy «14:05», ayer «Ayer», esta semana el día, antes la fecha. */
export function etiquetaFicha(ms: number | null, ahora: number): string {
  if (ms === null) return '';
  const b = enBolivia(ms);
  const dif = enBolivia(ahora).dia - b.dia;
  if (dif <= 0) return horaCorta(ms);
  if (dif === 1) return 'Ayer';
  if (dif < 7) return DIAS[b.sem] ?? '';
  return `${dos(b.d)}/${dos(b.m)}/${String(b.a).slice(2)}`;
}

/** El separador de día dentro del hilo. */
export function etiquetaDia(ms: number, ahora: number): string {
  const b = enBolivia(ms);
  const dif = enBolivia(ahora).dia - b.dia;
  if (dif === 0) return 'Hoy';
  if (dif === 1) return 'Ayer';
  return `${dos(b.d)}/${dos(b.m)}/${b.a}`;
}

export function mismoDia(a: number, b: number): boolean {
  return enBolivia(a).dia === enBolivia(b).dia;
}
