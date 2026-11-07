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
  constructor(readonly violaciones: Violacion[], readonly idParaBloqueo: string | null, readonly nivelOriginal: Nivel | null, readonly bloqueoSinId = false) {
    super('contrato_invalido');
    this.estado = violaciones.some((v) => REGLAS_DE_CONTENIDO.has(v.regla)) ? 422 : 400;
  }
  get cuerpo(): string { return `contrato_invalido:${this.violaciones.map((v) => `${v.campo}(${v.regla})`).join(',')}`; }
}

// ---------------------------------------------------------------------------
// DETECTORES (ADR-011 §2.1), sobre TODOS los campos de texto
// ---------------------------------------------------------------------------
const PREFIJOS_SECRETO = /(?:\bre_|\bBearer\s|\bgh[pousr]_|\bgithub_pat_|\bAKIA|\bAIza|\bxox|\bEAA|\beyJ|-----BEGIN)/i;
const PALABRA_LARGA_TEXTO = /[A-Za-z0-9+/=_-]{32,}/;
/** Para ids y rutas: 32 o más alfanuméricos SIN guiones (un nombre largo con guiones no es un secreto). */
const PALABRA_LARGA_ESTRICTA = /[A-Za-z0-9]{32,}/;
const DIGITOS_7 = /\p{Nd}{7,}/u;
const OTP_6 = /(?<!\p{Nd})\p{Nd}{6}(?!\p{Nd})/u;
const IPV4 = /(?<!\p{Nd})\p{Nd}{1,3}(?:\.\p{Nd}{1,3}){3}(?!\p{Nd})/u;
/** Dominio sin esquema (un host escrito en el texto). Las URL van solo en `enlace`. */
const DOMINIO_SIN_ESQUEMA = /\b[a-z0-9-]+\.(?:com|net|org|bo|site|website|io|app|dev|test)\b/i;
// Se tapan SOLO una fecha ISO con año plausible y una versión `d.dd.dd` (un solo dígito de versión mayor): lo demás
// con forma de número separado es un teléfono. Antes se tapaba cualquier `dddd-dd-dd` y `dd.ddd.ddd`, y ahí cabía uno.
const FECHA_ISO = /(?:19|20)\p{Nd}{2}-\p{Nd}{2}-\p{Nd}{2}(?:T\p{Nd}{2}:\p{Nd}{2}(?::\p{Nd}{2})?Z?)?/gu;
const VERSION = /(?<![\p{Nd}.])\p{Nd}\.\p{Nd}{1,3}\.\p{Nd}{1,3}(?!\p{Nd}|\.\p{Nd})/gu;
// 7 o más cifras con hasta 3 separadores entre cada par: espacio, NBSP, paréntesis, punto, cualquier guion Unicode
// (\p{Pd}), barra, guion bajo, dos puntos o coma: «7123-45-67», «71.234.567», «7123/4567», «71,23,45,67».
const RACHA_DE_TELEFONO = /\p{Nd}(?:[\s().\p{Pd}/_:,]{0,3}\p{Nd}){6,}/u;
// Formas de fecha y hora que NO son un teléfono: «07/11/2026», «07/11/2026 14:59:03», «07/11 17:00» (la barra solo cuenta como
// fecha si lo que sigue no es otra cifra ni «/cifra»: «71/23/4567» sigue siendo un teléfono) y «10:30:15.123».
const FECHA_BARRA = /(?<![\p{Nd}/])\p{Nd}{2}\/\p{Nd}{2}(?:\/(?:19|20)\p{Nd}{2})?(?: \p{Nd}{2}:\p{Nd}{2}(?::\p{Nd}{2}(?:\.\p{Nd}{3})?)?)?(?!\/?\p{Nd})/gu;
const HORA_MS = /(?<!\p{Nd})\p{Nd}{2}:\p{Nd}{2}:\p{Nd}{2}\.\p{Nd}{3}(?!\p{Nd})/gu;
const sinFechasNiVersiones = (t: string): string => t.replace(FECHA_ISO, '#').replace(FECHA_BARRA, '#').replace(HORA_MS, '#').replace(VERSION, '#');

/**
 * `texto`: campos libres (ADR). `id`: `id_unico` (palabra larga sin guiones). `tipo`: `tipo_error`, una lista cerrada de
 * minúsculas (sin la regla de palabra larga). `ruta`: la ruta decodificada de un enlace (palabra larga por segmento y
 * sin las reglas de URL, porque el host ya está validado).
 */
export type Perfil = 'texto' | 'id' | 'tipo' | 'ruta';

export function detectar(texto: string, denegar: readonly string[] = [], perfil: Perfil = 'texto'): string[] {
  // NFKC: «５９１…» de ancho completo, NBSP y demás formas compatibles pasan a su forma normal antes de mirar.
  const t = texto.normalize('NFKC');
  const reglas: string[] = [];
  const partes = perfil === 'ruta' ? t.split('/') : [t];
  const palabra = perfil === 'texto' ? PALABRA_LARGA_TEXTO : perfil === 'tipo' ? null : PALABRA_LARGA_ESTRICTA;
  if (PREFIJOS_SECRETO.test(t) || (palabra !== null && partes.some((x) => palabra.test(x)))) reglas.push('secreto_posible');
  if (/\+\s?\p{Nd}/u.test(t) || DIGITOS_7.test(t)) reglas.push('telefono_o_identificador');
  else if (RACHA_DE_TELEFONO.test(sinFechasNiVersiones(t))) reglas.push('telefono_con_separadores');
  if (perfil === 'id' && !reglas.includes('telefono_o_identificador') && t.replace(FECHA_ISO, '').replace(/\P{Nd}/gu, '').length >= 7) reglas.push('telefono_o_identificador');
  if (OTP_6.test(t)) reglas.push('codigo_tipo_otp');
  if (t.includes('@')) reglas.push('correo');
  if (perfil !== 'ruta' && (t.includes('://') || /\bwww\./i.test(t) || IPV4.test(t) || /localhost/i.test(t)
    || /\.internal\b/i.test(t) || /\.local\b/i.test(t) || DOMINIO_SIN_ESQUEMA.test(t))) reglas.push('url_en_texto');
  // Lista cargada de `plataforma/alertas.avisosDenegar`: nunca se imprime, ni siquiera en el nombre de la regla.
  const bajo = t.toLowerCase();
  if (denegar.some((d) => d && bajo.includes(d.normalize('NFKC').toLowerCase()))) reglas.push('denegado_por_proyecto');
  return reglas;
}

/**
 * Controles (Cc), formato invisible (Cf: bidi, ancho cero, etiquetas), rellenos de Hangul, separadores de línea Unicode,
 * VS/CGJ y marca de Arabic Letter. Los puntos de código se arman con `fromCodePoint` (sin escapes en el fuente).
 * El salto `\n` solo se admite donde se pide.
 */
const OTROS_INVISIBLES = [0x115f, 0x1160, 0x3164, 0xffa0, 0x180e, 0x034f, 0x061c, 0x2028, 0x2029].map((c) => String.fromCodePoint(c)).join('');
const ETIQUETAS = `${String.fromCodePoint(0xe0000)}-${String.fromCodePoint(0xe007f)}`;
const CONTROL = new RegExp(`[\\p{Cc}\\p{Cf}${OTROS_INVISIBLES}${ETIQUETAS}]`, 'u');
const tieneControl = (t: string, permiteSalto: boolean): boolean => CONTROL.test(permiteSalto ? t.replace(/\n/g, '') : t);

// ---------------------------------------------------------------------------
// ENLACE: https, sin puerto/consulta/fragmento/IP, host EXACTO de la lista; se guarda `href` normalizado
// ---------------------------------------------------------------------------
/**
 * La ruta de una ejecución de Actions de un repositorio de la lista CERRADA `plataforma/alertas.enlaceRepos`
 * (`dueño/repo`), con ids de ejecución y de job de 8 a 12 cifras. Solo esos dos segmentos numéricos se reemplazan por `#`;
 * TODO lo demás (dueño, repo, el resto de la ruta) pasa por los detectores completos. Sin repos configurados (defecto) no
 * hay enlaces de Actions: los ids de 8 a 12 cifras son un «teléfono». Límite inherente: un id de ejecución de 11 cifras no se
 * distingue de un teléfono de 11 cifras; lo cierra la lista de repos, no el detector.
 */
const RUTA_DE_EJECUCION = /^\/([^/]+)\/([^/]+)\/actions\/runs\/\d{8,12}(\/job\/\d{8,12})?$/;

/** `href` normalizado, o la regla que lo rechaza. */
export function analizarEnlace(
  enlace: string, hosts: readonly string[], denegar: readonly string[] = [], repos: readonly string[] = [],
): { href: string } | { regla: string } {
  const no = (regla = 'enlace_no_permitido'): { regla: string } => ({ regla });
  if (enlace.length > LIMITES.enlace || /[\s\\@?#]/.test(enlace) || CONTROL.test(enlace)) return no();
  let u: URL;
  try { u = new URL(enlace); } catch { return no(); }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash) return no();
  const host = u.hostname.toLowerCase();
  if (/^[\d.]+$/.test(host) || host.includes(':') || host.includes('[')) return no();
  const permitidos = hosts.map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (!permitidos.includes(host)) return no();
  // La ruta también es contenido: se decodifica y pasa por los detectores (un secreto o un correo escondidos en el path).
  let ruta: string;
  try { ruta = decodeURIComponent(u.pathname); } catch { return no(); }
  if (CONTROL.test(ruta)) return no('caracter_control');
  const m = RUTA_DE_EJECUCION.exec(ruta);
  const listados = repos.map((r) => r.trim().toLowerCase()).filter(Boolean);
  const aMirar = m && listados.includes(`${m[1]}/${m[2]}`.toLowerCase())
    ? ruta.replace(/\/runs\/\d+/, '/runs/#').replace(/\/job\/\d+/, '/job/#')
    : ruta;
  const malas = detectar(aMirar, denegar, 'ruta');
  if (malas.length > 0) return no(malas[0]);
  return { href: u.href };
}

export function enlaceNormalizado(enlace: string, hosts: readonly string[], denegar: readonly string[] = [], repos: readonly string[] = []): string | null {
  const r = analizarEnlace(enlace, hosts, denegar, repos);
  return 'href' in r ? r.href : null;
}

// ---------------------------------------------------------------------------
// VALIDACIÓN DE LA ENTRADA
// ---------------------------------------------------------------------------
const ID_UNICO = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/;
const TIPO = /^[a-z0-9_.-]{1,60}$/;
const PROYECTO_FORMA = /^[a-z][a-z0-9-]{1,29}$/;
const FECHA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
/** flujo y nodo son nombres: letras, cifras, espacio y la puntuación de un nombre. Lo demás se cambia por «_». */
const PERMITIDOS_NOMBRE = /^[\p{L}\p{N} .,()_\-–—:/·'&¿?]+$/u;
export const VENTANA_FUTURO_MS = 10 * 60_000;
export const VENTANA_PASADO_MS = 30 * 86_400_000;
/** `<id>:bloqueado` nunca pasa de 120: un id de más de 108 no se puede avisar como bloqueado. */
export const MAX_ID_PARA_BLOQUEO = 108;

const recortar = (t: string, max: number): string => [...t].slice(0, max).join('');

export interface ConfigContenido { hosts: readonly string[]; denegar: readonly string[]; ahoraMs: number; repos?: readonly string[] }

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
  // I1: un `id_unico` con forma de dato personal se RECHAZA: es determinista, sale en el `ref` del correo y es la
  // Idempotency-Key `novuchat:<id_unico>`; derivar un hash lo volvería ilegible. Pasa por TODOS los detectores
  // (prefijos de secreto, 32+ alfanuméricos sin guiones, teléfono, número de 6, correo, IP, localhost, dominios,
  // denegados). Una coincidencia deja `idOk = false`: sin aviso `:bloqueado`, solo 4xx.
  // Prefijos y sufijos RESERVADOS del servidor: `resumen-` (el resumen propio), `id-invalido-` (el aviso de un id inválido) y
  // `:bloqueado` (el aviso de contenido bloqueado). Un emisor que los use podría pisar o suplantar esos avisos.
  if (idOk && (s('id_unico').startsWith('resumen-') || s('id_unico').startsWith('id-invalido-') || s('id_unico').endsWith(':bloqueado'))) { idOk = false; mal('id_unico', 'forma'); }
  if (idOk) {
    const r = detectar(s('id_unico'), cfg.denegar, 'id');
    if (r.length > 0) { idOk = false; for (const x of r) mal('id_unico', x); }
  }
  if (idOk && s('id_unico').length > MAX_ID_PARA_BLOQUEO) idOk = false; // sin bloqueo posible; igual se valida el resto
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
    const a = analizarEnlace(s('enlace'), cfg.hosts, cfg.denegar, cfg.repos ?? []);
    if ('href' in a) enlace = a.href; else mal('enlace', a.regla);
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
    const t = s('que_paso').replace(/\r\n/g, '\n').replace(/\t/g, ' ');
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
    for (const r of detectar(s('tipo_error'), cfg.denegar, 'tipo')) mal('tipo_error', r);
  }

  if (v.length > 0) {
    const nivelOk = (NIVELES as readonly string[]).includes(s('nivel')) ? (s('nivel') as Nivel) : null;
    const idBloqueo = proyectoOk && idOk && s('id_unico').length <= MAX_ID_PARA_BLOQUEO ? s('id_unico') : null;
    // Un `id_unico` inválido NO pierde la alerta: sale un aviso bloqueado con un id del SERVIDOR (`id-invalido-<hora UTC>`),
    // sin ningún valor del llamador y, por el id, a lo más uno por hora.
    throw new ErrorContrato(v, idBloqueo, nivelOk, proyectoOk && idBloqueo === null);
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
    id_unico: e.idParaBloqueo !== null ? `${e.idParaBloqueo}:bloqueado` : `id-invalido-${new Date(ahoraMs).toISOString().slice(0, 13)}`,
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
