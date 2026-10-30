/**
 * VISOR DE MEDIOS DE CONVERSACIONES (M3b) — la parte pura, sin React.
 *
 * Los medios (foto, PDF, audio) que mandó el cliente los guarda el servidor 90 días y SOLO los entrega
 * la callable `verMedio` (auditada y con tope por usuario): `{tipo, mime, tamano, base64}`. Contrato:
 * `NOVUCHAT_contrato-visor-medios-M3` §1 y §2. La consola nunca manda una ruta: manda `{tenantId,
 * conversacionId, idMeta}`.
 *
 * COPIA DECLARADA de `modulos/cobros/visorComprobante.ts` (`MIMES_DE_IMAGEN`, `BASE64`, `srcDeImagen`,
 * `bytesDeBase64`): Central no puede importar de un módulo (fronteras.test.ts). Si cambia la lista
 * cerrada de imágenes, cambia en los dos sitios.
 *
 * Los errores se muestran por `code` (y `details` solo para `anotado`/`pendiente`), jamás por `message`.
 */

export const MIMES_DE_IMAGEN = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MIME_DE_PDF = 'application/pdf';
/** Los de `MIMES_ACEPTADOS` del servidor (core/medios/tipos.ts) para audio. */
export const MIMES_DE_AUDIO = [
  'audio/ogg', 'application/ogg', 'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac',
  'audio/mpeg', 'audio/mp3', 'audio/amr', 'audio/3gpp',
] as const;

export const TEXTO_VENCIDO = 'El archivo ya no está disponible (se guarda 90 días).';
export const AVISO_WA_ME =
  'Lo que escribas por aquí queda FUERA del sistema (no aparece en la conversación ni cuenta como conversación del asistente) y no reemplaza a «Tomar».';
export const AVISO_PDF = 'Archivo enviado por el cliente; ábralo con un lector actualizado.';
export const NOMBRE_DEL_PDF = 'documento.pdf';

export interface MedioDeMensaje {
  estado: 'guardado' | 'anotado' | 'pendiente' | 'otro';
  mime: string;
  tamano: number | null;
  /** Hasta cuándo se guarda (ms); `null` si no consta. */
  vence: number | null;
}

/** Lee el campo `medio` de un mensaje, tolerante; `null` si no hay (el mensaje se queda como hoy). */
export function medioDeDatos(x: unknown): MedioDeMensaje | null {
  if (typeof x !== 'object' || x === null) return null;
  const m = x as Record<string, unknown>;
  const estado = m['estado'] === 'guardado' || m['estado'] === 'anotado' || m['estado'] === 'pendiente' ? m['estado'] : 'otro';
  const v = m['vence'] as { toMillis?: unknown } | number | null | undefined;
  const vence = typeof v === 'number' ? v
    : v && typeof v === 'object' && typeof v.toMillis === 'function' ? (v.toMillis as () => number)() : null;
  return {
    estado,
    mime: typeof m['mime'] === 'string' ? m['mime'].slice(0, 100) : '',
    tamano: typeof m['tamano'] === 'number' ? m['tamano'] : null,
    vence,
  };
}

export type AccionDeMedio = 'ninguna' | 'ver' | 'vencido' | 'anotado';

/** Qué dibuja la burbuja: sin `medio`, nada; `guardado` vigente, botón; `guardado` vencido, texto; `anotado`, texto. */
export function accionDeMedio(medio: MedioDeMensaje | null, ahora: number): AccionDeMedio {
  if (!medio) return 'ninguna';
  if (medio.estado === 'anotado') return 'anotado';
  if (medio.estado !== 'guardado') return 'ninguna';
  if (medio.vence !== null && medio.vence <= ahora) return 'vencido';
  return 'ver';
}

/** «Archivo recibido (Word); no se guarda». */
export function textoAnotado(mime: string): string {
  const m = mime.toLowerCase();
  const tipo = m.includes('wordprocessingml') ? 'Word (docx)'
    : m.includes('spreadsheetml') ? 'Excel (xlsx)' : 'documento';
  return `Archivo recibido (${tipo}); no se guarda`;
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function srcDeImagen(mime: unknown, base64: unknown): string | null {
  if (typeof mime !== 'string' || typeof base64 !== 'string') return null;
  if (!(MIMES_DE_IMAGEN as readonly string[]).includes(mime)) return null;
  return BASE64.test(base64) ? `data:${mime};base64,${base64}` : null;
}

export function bytesDeBase64(base64: unknown): Uint8Array | null {
  if (typeof base64 !== 'string' || !BASE64.test(base64)) return null;
  try {
    const bin = atob(base64);
    const b = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return b;
  } catch { return null; }
}

/** `tipo` y `mime` tienen que ir de acuerdo y estar en la lista cerrada; si no, el visor no dibuja nada. */
export function claseDeMedio(tipo: unknown, mime: unknown): 'imagen' | 'pdf' | 'audio' | 'invalida' {
  if (typeof mime !== 'string') return 'invalida';
  if (tipo === 'image' && (MIMES_DE_IMAGEN as readonly string[]).includes(mime)) return 'imagen';
  if (tipo === 'document' && mime === MIME_DE_PDF) return 'pdf';
  if (tipo === 'audio' && (MIMES_DE_AUDIO as readonly string[]).includes(mime)) return 'audio';
  return 'invalida';
}

const GENERICO = 'No se pudo abrir el archivo. Intente de nuevo en unos minutos.';

/** Texto fijo por `code` (y `details` para failed-precondition). Nunca el mensaje del servidor. */
export function textoDeErrorMedio(code: unknown, details?: unknown): string {
  switch (code) {
    case 'functions/unauthenticated':
      return 'No se pudo comprobar su sesión. Recargue la página e inicie sesión de nuevo.';
    case 'functions/permission-denied':
      return 'No tiene permiso para ver este archivo.';
    case 'functions/not-found':
      return 'No hay un archivo guardado para este mensaje. Se conserva hasta 90 días desde que llegó.';
    case 'functions/failed-precondition':
      if (details === 'anotado') return 'Este archivo solo se anotó: no se guardó y no se puede mostrar.';
      if (details === 'pendiente') return 'El archivo todavía se está guardando. Intente de nuevo en unos minutos.';
      return 'Este archivo no se puede mostrar desde la consola.';
    case 'functions/invalid-argument':
      return 'Este archivo no se puede mostrar desde la consola.';
    case 'functions/resource-exhausted':
      return 'Alcanzó el máximo de archivos que se pueden ver por ahora. Vuelva a intentar más tarde.';
    case 'functions/unavailable':
      return 'El archivo no está disponible en este momento. Intente de nuevo en unos minutos.';
    default:
      return GENERICO;
  }
}

export type RespuestaVerMedio = { tipo?: unknown; mime?: unknown; tamano?: unknown; base64?: unknown };
/** La callable, inyectada: la pantalla pasa `httpsCallable(funciones, 'verMedio')`; las pruebas, una simulada. */
export type LlamarVerMedio = (a: { tenantId: string; conversacionId: string; idMeta: string }) => Promise<{ data: RespuestaVerMedio }>;

export type ResultadoMedio =
  | { ok: true; clase: 'imagen'; src: string }
  | { ok: true; clase: 'audio' | 'pdf'; bytes: Uint8Array; mime: string }
  | { ok: false; texto: string };

/**
 * Pide el medio y lo deja listo para dibujar. Un medio `anotado` o vencido NO llama a la callable.
 * Un tipo o mime fuera de la lista, o un base64 roto, es el error genérico de «no se puede mostrar».
 */
export async function pedirMedio(
  llamar: LlamarVerMedio,
  a: { tenantId: string; conversacionId: string; idMeta: string; medio: MedioDeMensaje | null; ahora: number },
): Promise<ResultadoMedio> {
  const accion = accionDeMedio(a.medio, a.ahora);
  if (accion === 'vencido') return { ok: false, texto: TEXTO_VENCIDO };
  if (accion !== 'ver') return { ok: false, texto: textoDeErrorMedio('functions/failed-precondition', 'anotado') };
  try {
    const r = (await llamar({ tenantId: a.tenantId, conversacionId: a.conversacionId, idMeta: a.idMeta })).data;
    const clase = claseDeMedio(r.tipo, r.mime);
    const mal = { ok: false as const, texto: textoDeErrorMedio('functions/failed-precondition') };
    if (clase === 'invalida') return mal;
    if (clase === 'imagen') {
      const src = srcDeImagen(r.mime, r.base64);
      return src ? { ok: true, clase, src } : mal;
    }
    const bytes = bytesDeBase64(r.base64);
    return bytes ? { ok: true, clase, bytes, mime: r.mime as string } : mal;
  } catch (e) {
    const x = e as { code?: unknown; details?: unknown } | null;
    return { ok: false, texto: textoDeErrorMedio(x?.code, x?.details) };
  }
}

/**
 * Enlace `wa.me` del teléfono de la conversación. Solo con 8 a 15 dígitos y solo para quien ve
 * conversaciones; si no cumple, `null` y no se pinta nada. No envía ni registra nada.
 */
export function enlaceWaMe(telefono: unknown, puedeVer = true): string | null {
  if (!puedeVer || typeof telefono !== 'string') return null;
  const d = telefono.replace(/^\+/, '');
  return /^[0-9]{8,15}$/.test(d) ? `https://wa.me/${d}` : null;
}
