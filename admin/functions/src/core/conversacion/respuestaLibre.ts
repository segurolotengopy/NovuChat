/**
 * LA RESPUESTA LIBRE COMO DATO DEL TENANT (12/11/2026, «respuesta coherente», PR B / P2).
 *
 * Documento `tenants/{t}/config/respuestaLibre`, escrito SOLO por el servidor (`scripts/plataforma/respuesta-libre.mjs`).
 * `configuracionFlujo` lo entrega al flujo como `respuestaLibre: {...}`, y únicamente si `activo === true`; en cualquier
 * otro caso (sin documento, `activo` false, ausente o de otro tipo) devuelve `{}` y la respuesta de la Function queda
 * IDÉNTICA a la de antes, byte a byte.
 *
 * Se sanea aquí, en el servidor, y no en la pantalla: el documento llega de un script, pero el flujo nunca debe confiar en
 * lo que hay guardado. Textos recortados, tipos que no son los esperados se omiten, y las frases prohibidas se acotan.
 * Sin identificadores, teléfonos ni textos de un cliente: esto es código común del core.
 *
 * Este archivo lo importa también un script de Plataforma (`.mjs`) directamente: solo anotaciones de tipo, nada de
 * sintaxis de TypeScript que Node no pueda quitar (enumeraciones, propiedades de parámetro).
 */

export const TOPES_RESPUESTA_LIBRE = {
  acuse: 300,
  textoSeguimiento: 300,
  textoRechazo: 200,
  tono: 300,
  reglas: 800,
  prohibidosCantidad: 30,
  prohibidoLargo: 60,
} as const;

export interface RespuestaLibreSaneada {
  readonly activo: true;
  readonly acuse?: string;
  readonly textoSeguimiento?: string;
  readonly textoRechazo?: string;
  readonly tono?: string;
  readonly reglas?: string;
  readonly prohibidos: readonly string[];
}

const CAMPOS_DE_TEXTO = ['acuse', 'textoSeguimiento', 'textoRechazo', 'tono', 'reglas'] as const;

/** Recorta por caracteres reales (no parte un par sustituto por la mitad). */
const recortar = (texto: string, tope: number): string => Array.from(texto).slice(0, tope).join('');

const textoSaneado = (v: unknown, tope: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = recortar(v.trim(), tope).trim();
  return t.length > 0 ? t : undefined;
};

/**
 * Lo saneado de un documento, o `null` si no está activo (`activo` distinto de `true` exacto). Con `activo: true`,
 * un campo con tipo basura se omite; `prohibidos` siempre es una lista (vacía si no era una).
 */
export const sanearRespuestaLibre = (datos: unknown): RespuestaLibreSaneada | null => {
  if (datos === null || datos === undefined || typeof datos !== 'object' || Array.isArray(datos)) return null;
  const d = datos as Record<string, unknown>;
  if (d['activo'] !== true) return null;
  const salida: { -readonly [K in keyof RespuestaLibreSaneada]?: RespuestaLibreSaneada[K] } & Record<string, unknown> = { activo: true };
  for (const campo of CAMPOS_DE_TEXTO) {
    const t = textoSaneado(d[campo], TOPES_RESPUESTA_LIBRE[campo]);
    if (t !== undefined) salida[campo] = t;
  }
  const prohibidos: string[] = [];
  if (Array.isArray(d['prohibidos'])) {
    for (const p of d['prohibidos']) {
      if (prohibidos.length >= TOPES_RESPUESTA_LIBRE.prohibidosCantidad) break;
      const t = textoSaneado(p, TOPES_RESPUESTA_LIBRE.prohibidoLargo);
      if (t !== undefined) prohibidos.push(t);
    }
  }
  salida['prohibidos'] = prohibidos;
  return salida as unknown as RespuestaLibreSaneada;
};

/** Lo que `configuracionFlujo` agrega a su respuesta: `{}` salvo que el documento esté activo. */
export const respuestaLibreParaElFlujo = (
  datos: Readonly<Record<string, unknown>> | null | undefined,
): { respuestaLibre?: RespuestaLibreSaneada } => {
  const s = sanearRespuestaLibre(datos);
  return s === null ? {} : { respuestaLibre: s };
};
