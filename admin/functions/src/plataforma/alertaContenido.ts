/**
 * =============================================================================
 * CONTENIDO DE LA ALERTA OPERATIVA: contrato v1, detectores, enlace y plantilla
 * =============================================================================
 *
 * UN SOLO MÓDULO para todo lo que depende del contrato `avisos-correo/v1` de WAM (ADR-011): si el contrato
 * cambia (hosts permitidos, prohibiciones, plantilla), se edita ESTE archivo y su prueba; la firma, el tope
 * y el envío (`alertaOperativa.ts`) no se tocan.
 *
 * DOS FORMAS, SEPARADAS A PROPÓSITO:
 *   - ENTRADA INTERNA (n8n -> esta Function): el aviso más `tipo_error`, `flujo` y `nodo`, que sirven para
 *     agrupar («1 por hora por tipo») y salen en el resumen. NO lleva `contrato`.
 *   - AVISO v1 (lo que se guarda y se envía): exactamente los 9 campos del ADR, con
 *     `contrato: "avisos-correo/v1"`. La Function lo arma a partir de la entrada.
 *
 * CONTENIDO PROHIBIDO: se RECHAZA ENTERO, nunca se redacta (redactar a medias da falsa seguridad). Si el
 * `proyecto` y el `id_unico` son válidos, el llamador envía un aviso de texto fijo `<id_unico>:bloqueado` con
 * SOLO el nombre del campo y de la regla, nunca el valor. Los detectores son heurísticos: no prueban la
 * ausencia de datos personales; el emisor arma el texto con constantes y códigos.
 */

export const CONTRATO = 'avisos-correo/v1';
export const PROYECTO = 'novuchat';
export const NIVELES = ['urgente', 'aviso', 'informativo'] as const;
export type Nivel = (typeof NIVELES)[number];

/** Límites del ADR (puntos de código). El exceso se RECORTA y se marca `saneado`; la alerta no se pierde. */
export const LIMITES = {
  asunto: 100, que_paso: 1500, primera_linea: 110, lineas: 30, que_se_espera_de_andres: 180,
  enlace: 300, flujo: 80, nodo: 80,
} as const;

const ENTRADA = [
  'nivel', 'proyecto', 'asunto', 'que_paso', 'que_se_espera_de_andres', 'enlace', 'ocurrido_en', 'id_unico',
  'tipo_error', 'flujo', 'nodo',
] as const;
const OBLIGATORIOS = ['nivel', 'proyecto', 'asunto', 'que_paso', 'que_se_espera_de_andres', 'ocurrido_en', 'id_unico', 'tipo_error'] as const;

export interface AvisoV1 {
  contrato: typeof CONTRATO;
  nivel: Nivel;
  proyecto: typeof PROYECTO;
  asunto: string;
  que_paso: string;
  que_se_espera_de_andres: string;
  enlace: string | null;
  ocurrido_en: string;
  id_unico: string;
}
export interface EventoValidado { aviso: AvisoV1; tipo_error: string; flujo: string; nodo: string; saneado: boolean }

export interface Violacion { campo: string; regla: string }
/** Reglas que son de CONTENIDO (422); el resto son de forma (400). */
const REGLAS_DE_CONTENIDO = new Set([
  'secreto_posible', 'telefono_o_identificador', 'telefono_con_separadores', 'codigo_tipo_otp', 'correo',
  'url_en_texto', 'denegado_por_proyecto', 'caracter_control',
]);

export class ErrorAlerta extends Error {
  constructor(readonly codigo: string, readonly estado: number) { super(codigo); }
}
/** El aviso no cumple el contrato. Lleva solo nombres de campo y de regla, nunca valores. */
export class ErrorContrato extends Error {
  readonly estado: number;
  /** `id_unico` ya validado (forma y detectores) si se puede enviar el aviso `:bloqueado`; si no, `null`. */
  constructor(readonly violaciones: Violacion[], readonly idParaBloqueo: string | null, readonly nivelOriginal: Nivel | null) {
    super('contrato_invalido');
    this.estado = violaciones.some((v) => REGLAS_DE_CONTENIDO.has(v.regla)) ? 422 : 400;
  }
  get cuerpo(): string { return `contrato_invalido:${this.violaciones.map((v) => `${v.campo}(${v.regla})`).join(',')}`; }
}

// ---------------------------------------------------------------------------
// DETECTORES (ADR-011 §2.1), sobre TODOS los campos de texto
// ---------------------------------------------------------------------------
const PREFIJOS_SECRETO = /(?:\bre_|\bBearer\s|\bgh[pousr]_|\bgithub_pat_|\bAKIA|\bAIza|\bxox|\bEAA|\beyJ|-----BEGIN)/i;
const PALABRA_LARGA = /[A-Za-z0-9+/=_-]{32,}/;
// Dos grupos de cifras separados por espacio, punto o guion (712-34567, 7123 4567, 591 712 34567): un teléfono
// escrito con separadores. Una fecha (2026-11-07) y una versión (2.36.5) no entran: sus grupos son de 1 a 2 cifras.
const TELEFONO_SEPARADO = /(?<!\d)\d{3,4}[ .-]\d{3,5}(?!\d)|(?<!\d)\d{2,3}[ .-]\d{3}[ .-]\d{3,5}(?!\d)/;
const IPV4 = /(?<!\d)\d{1,3}(?:\.\d{1,3}){3}(?!\d)/;

export function detectar(texto: string, denegar: readonly string[] = []): string[] {
  const reglas: string[] = [];
  if (PREFIJOS_SECRETO.test(texto) || PALABRA_LARGA.test(texto)) reglas.push('secreto_posible');
  if (/\+\s?\d/.test(texto) || /\d{7,}/.test(texto)) reglas.push('telefono_o_identificador');
  else if (TELEFONO_SEPARADO.test(texto)) reglas.push('telefono_con_separadores');
  if (/(?<!\d)\d{6}(?!\d)/.test(texto)) reglas.push('codigo_tipo_otp');
  if (texto.includes('@')) reglas.push('correo');
  if (texto.includes('://') || /\bwww\./i.test(texto) || IPV4.test(texto) || /localhost/i.test(texto)
    || /\.internal\b/i.test(texto) || /\.local\b/i.test(texto)) reglas.push('url_en_texto');
  // Lista cargada de `plataforma/alertas.avisosDenegar`: nunca se imprime, ni siquiera en el nombre de la regla.
  const bajo = texto.toLowerCase();
  if (denegar.some((d) => d && bajo.includes(d.toLowerCase()))) reglas.push('denegado_por_proyecto');
  return reglas;
}

/** Controles C0/C1, bidi, ancho cero y separadores de línea Unicode. El salto `\n` solo se admite donde se pide. */
const CONTROL = new RegExp('[\\u0000-\\u0009\\u000B-\\u001F\\u007F-\\u009F\\u00AD\\u200B-\\u200F\\u2028\\u2029\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u2069\\uFEFF]');
const tieneControl = (t: string, permiteSalto: boolean): boolean => CONTROL.test(t) || (!permiteSalto && t.includes('\n'));

// ---------------------------------------------------------------------------
// ENLACE: https, sin puerto/consulta/fragmento/IP, host EXACTO de la lista; se guarda `href` normalizado
// ---------------------------------------------------------------------------
export function enlaceNormalizado(enlace: string, hosts: readonly string[]): string | null {
  if (enlace.length > LIMITES.enlace || /[\s\\@?#]/.test(enlace) || CONTROL.test(enlace)) return null;
  let u: URL;
  try { u = new URL(enlace); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash) return null;
  const host = u.hostname.toLowerCase();
  if (/^[\d.]+$/.test(host) || host.includes(':') || host.includes('[')) return null;
  const permitidos = hosts.map((h) => h.trim().toLowerCase()).filter(Boolean);
  return permitidos.includes(host) ? u.href : null;
}

// ---------------------------------------------------------------------------
// VALIDACIÓN DE LA ENTRADA
// ---------------------------------------------------------------------------
const ID_UNICO = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/;
const TIPO = /^[a-z0-9_.-]{1,60}$/;
const PROYECTO_FORMA = /^[a-z][a-z0-9-]{1,29}$/;
const FECHA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
/** flujo y nodo son nombres: letras, cifras, espacio y la puntuación de un nombre. Lo demás se cambia por «_». */
const PERMITIDOS_NOMBRE = /^[\p{L}\p{N} .,()_\-–—:/·'&]+$/u;
export const VENTANA_FUTURO_MS = 10 * 60_000;
export const VENTANA_PASADO_MS = 30 * 86_400_000;

const recortar = (t: string, max: number): string => [...t].slice(0, max).join('');

export interface ConfigContenido { hosts: readonly string[]; denegar: readonly string[]; ahoraMs: number }

export function validarEntrada(cuerpo: unknown, cfg: ConfigContenido): EventoValidado {
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) throw new ErrorAlerta('cuerpo_invalido', 400);
  const d = cuerpo as Record<string, unknown>;
  const v: Violacion[] = [];
  const mal = (campo: string, regla: string): void => { v.push({ campo, regla }); };
  const esCampo = (k: string): boolean => (ENTRADA as readonly string[]).includes(k);
  for (const k of Object.keys(d)) if (!esCampo(k)) mal('desconocido', 'campo_no_permitido');
  for (const k of OBLIGATORIOS) if (typeof d[k] !== 'string' || !(d[k] as string).trim()) mal(k, 'campo_faltante');
  for (const k of ['flujo', 'nodo', 'enlace'] as const) if (d[k] !== undefined && d[k] !== null && typeof d[k] !== 'string') mal(k, 'forma');
  const s = (k: string): string => (typeof d[k] === 'string' ? (d[k] as string).trim() : '');
  const sinTrim = (k: string): string => (typeof d[k] === 'string' ? (d[k] as string) : '');
  let saneado = false;

  // Identidad: lo que decide si se puede avisar del bloqueo.
  const proyectoOk = s('proyecto') === PROYECTO && PROYECTO_FORMA.test(s('proyecto'));
  if (typeof d['proyecto'] === 'string' && !proyectoOk) mal('proyecto', 'proyecto_invalido');
  let idOk = ID_UNICO.test(s('id_unico'));
  if (typeof d['id_unico'] === 'string' && !idOk) mal('id_unico', 'forma');
  // I1: un `id_unico` con forma de teléfono o de id de ejecución (7+ cifras, `+cifra`, número de 6) se RECHAZA. Es
  // determinista y sale en el `ref` del correo; derivar un hash lo volvería ilegible y rompería la
  // Idempotency-Key `novuchat:<id_unico>` del ADR. El emisor usa un id tipo `envio-<flujo>-<hash corto>`.
  if (idOk) {
    const r = detectar(s('id_unico')).filter((x) => x === 'telefono_o_identificador' || x === 'codigo_tipo_otp');
    if (r.length > 0) { idOk = false; mal('id_unico', 'forma_de_dato_personal'); }
  }
  if (typeof d['nivel'] === 'string' && !(NIVELES as readonly string[]).includes(s('nivel'))) mal('nivel', 'nivel_invalido');
  if (typeof d['tipo_error'] === 'string' && !TIPO.test(s('tipo_error'))) mal('tipo_error', 'forma');

  // ocurrido_en: UTC con Z, sin fracciones; entre -30 días y +10 min.
  const ms = FECHA.test(s('ocurrido_en')) ? Date.parse(s('ocurrido_en')) : NaN;
  if (typeof d['ocurrido_en'] === 'string') {
    if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 19) + 'Z' !== s('ocurrido_en')) mal('ocurrido_en', 'forma');
    else if (ms - cfg.ahoraMs > VENTANA_FUTURO_MS) mal('ocurrido_en', 'en_el_futuro');
    else if (cfg.ahoraMs - ms > VENTANA_PASADO_MS) mal('ocurrido_en', 'muy_antiguo');
  }

  // Enlace.
  let enlace: string | null = null;
  if (typeof d['enlace'] === 'string' && s('enlace')) {
    enlace = enlaceNormalizado(s('enlace'), cfg.hosts);
    if (enlace === null) mal('enlace', 'enlace_no_permitido');
  }

  // Textos libres: controles (422), detectores (422), exceso (se recorta).
  const unaLinea = (campo: 'asunto' | 'que_se_espera_de_andres', minimo: number): string => {
    const t = sinTrim(campo).trim();
    if (typeof d[campo] !== 'string' || !t) return '';
    if (tieneControl(t, false)) { mal(campo, 'caracter_control'); return ''; }
    for (const r of detectar(t, cfg.denegar)) mal(campo, r);
    if ([...t].length < minimo) { mal(campo, 'forma'); return ''; }
    if ([...t].length > LIMITES[campo]) { saneado = true; return recortar(t, LIMITES[campo]); }
    return t;
  };
  const asunto = unaLinea('asunto', 3);
  const expectativa = unaLinea('que_se_espera_de_andres', 1);

  let paso = '';
  if (typeof d['que_paso'] === 'string' && s('que_paso')) {
    const t = s('que_paso');
    if (tieneControl(t, true)) mal('que_paso', 'caracter_control');
    else {
      for (const r of detectar(t, cfg.denegar)) mal('que_paso', r);
      let lineas = t.split('\n').map((l) => l.trim());
      if (lineas.length > LIMITES.lineas) { lineas = lineas.slice(0, LIMITES.lineas); saneado = true; }
      if ([...(lineas[0] ?? '')].length > LIMITES.primera_linea) { lineas[0] = recortar(lineas[0]!, LIMITES.primera_linea); saneado = true; }
      paso = lineas.join('\n');
      if ([...paso].length > LIMITES.que_paso) { paso = recortar(paso, LIMITES.que_paso); saneado = true; }
    }
  }

  // Nombres (flujo, nodo): lista de caracteres permitidos y largo 80. Un dato personal se RECHAZA (ADR); un
  // nombre largo o con un símbolo raro se ajusta, para no perder la alerta (B2).
  const nombre = (campo: 'flujo' | 'nodo'): string => {
    let t = s(campo);
    if (!t) return '';
    if (tieneControl(t, false)) { mal(campo, 'caracter_control'); return ''; }
    for (const r of detectar(t, cfg.denegar)) mal(campo, r);
    if (!PERMITIDOS_NOMBRE.test(t)) { t = [...t].map((c) => (PERMITIDOS_NOMBRE.test(c) ? c : '_')).join(''); saneado = true; }
    if ([...t].length > LIMITES[campo]) { t = recortar(t, LIMITES[campo]); saneado = true; }
    return t;
  };
  const flujo = nombre('flujo');
  const nodo = nombre('nodo');
  // `tipo_error` ya pasó su forma de minúsculas; también se mira que no sea un dato personal.
  if (typeof d['tipo_error'] === 'string' && TIPO.test(s('tipo_error'))) {
    for (const r of detectar(s('tipo_error'), cfg.denegar)) mal('tipo_error', r);
  }

  if (v.length > 0) {
    const nivelOk = (NIVELES as readonly string[]).includes(s('nivel')) ? (s('nivel') as Nivel) : null;
    throw new ErrorContrato(v, proyectoOk && idOk ? s('id_unico') : null, nivelOk);
  }
  return {
    aviso: {
      contrato: CONTRATO, nivel: s('nivel') as Nivel, proyecto: PROYECTO, asunto, que_paso: paso,
      que_se_espera_de_andres: expectativa, enlace, ocurrido_en: s('ocurrido_en'), id_unico: s('id_unico'),
    },
    tipo_error: s('tipo_error'), flujo, nodo, saneado,
  };
}

/** El aviso de texto fijo que sustituye a uno rechazado: solo campos y reglas, nunca el valor. */
export function avisoBloqueado(e: ErrorContrato, ahoraMs: number): AvisoV1 {
  const lista = [...new Set(e.violaciones.map((x) => `${x.campo} (${x.regla})`))].slice(0, 8).join(', ');
  return {
    contrato: CONTRATO, nivel: e.nivelOriginal === 'urgente' ? 'urgente' : 'aviso', proyecto: PROYECTO,
    asunto: 'Aviso bloqueado por el contrato v1',
    que_paso: `Un aviso de ${PROYECTO} no cumplió el contrato v1.\nFalló en: ${lista}.\nSu contenido no se envió.`,
    que_se_espera_de_andres: `nada; la sesión de ${PROYECTO} corrige el emisor`,
    enlace: null, ocurrido_en: new Date(ahoraMs).toISOString().slice(0, 19) + 'Z',
    id_unico: `${e.idParaBloqueo}:bloqueado`,
  };
}

// ---------------------------------------------------------------------------
// PLANTILLA (ADR-011 §2.2)
// ---------------------------------------------------------------------------
export interface Envio { asunto: string; texto: string; html: string; idempotencia: string; nombreVisible: string }

const escaparHtml = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const NOMBRE_VISIBLE = `AAB1 avisos · ${PROYECTO}`;

export function armarCorreo(a: AvisoV1): Envio {
  const etiqueta = a.id_unico.startsWith('resumen-') ? 'RESUMEN' : a.nivel.toUpperCase();
  const [titular = '', ...resto] = a.que_paso.split('\n');
  const texto = [
    `${etiqueta} · ${a.proyecto} · ${a.ocurrido_en}`,
    `Qué se espera de Andres: ${a.que_se_espera_de_andres}`,
    `Qué pasó: ${titular}`,
    ...resto,
    ...(a.enlace ? [`Enlace: ${a.enlace}`] : []),
    '',
    `ref ${a.proyecto}:${a.id_unico} · contrato ${CONTRATO}`,
    'Aviso automático; responder a este correo no llega a nadie.',
    'Las acciones las ejecuta Claude con la autorización de Andres.',
  ].join('\n');
  return {
    asunto: recortar(`[AAB1 ${etiqueta}] ${a.proyecto} · ${a.asunto}`, 150),
    texto, html: `<pre>${escaparHtml(texto)}</pre>`,
    idempotencia: `${a.proyecto}:${a.id_unico}`, nombreVisible: NOMBRE_VISIBLE,
  };
}
