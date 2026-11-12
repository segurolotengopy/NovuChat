/**
 * =============================================================================
 * ADJUNTOS: ENVIAR UN ARCHIVO O UNA NOTA DE VOZ COMO PERSONA (Medios B4)
 * =============================================================================
 *
 * Lo que la pantalla DECIDE sobre adjuntar vive acá, en funciones puras y sin Firebase, para probarlo sin navegador
 * (`pruebas/central/adjuntos-*.test.ts`). La única parte con red es `capaAdjuntoReal` (una callable); la pantalla recibe
 * una `CapaAdjunto`, así que una prueba la reemplaza por una simulada.
 *
 * Es un archivo APARTE de `turno.ts` a propósito: el camino del texto (`ejecutarEnvio` y las tres callables) no cambia.
 *
 * LA CONSOLA NO DECIDE LÍMITES: los muestra. El servidor (`enviarAdjuntoComoPersona`) revisa el archivo por sus bytes,
 * hace cumplir la bandera, los topes y la ventana; esta lista es para no ofrecer lo que el servidor va a rechazar.
 *
 * NO SE IMPORTA `core/medios/salientes` NI `tipos` (usan `Buffer`, que el navegador no tiene): la lista de abajo es una
 * COPIA AMARRADA por `pruebas/central/adjuntos-paridad.test.ts`. Si cambia allá, esa prueba falla acá.
 *
 * LOS ERRORES SALEN DE `e.code` y de `details` fijos, NUNCA de `e.message`.
 * LAS CLAVES SIN VALOR SE OMITEN del cuerpo: el SDK convierte `undefined` en `null` y el servidor rechaza `null`.
 */
import { httpsCallable, type Functions } from 'firebase/functions';
import { personaPuedeEnviarMediosDeFicha } from '../../../../functions/src/core/conversacion/turno';
import {
  TEXTO_INCIERTO, codigoDeError, detallesDeError, esClaveValida, interpretarEnvio, nuevaClave, puedeIntervenirDeFicha,
  resultadoDesconocido, textoTope, type EstadoVentanaEnvio, type ResultadoEnvio,
} from './turno';
import { TOPE_ORIGINAL, type ImagenDecodificada } from './decodificarImagen';

// ── La lista de la consola (copia amarrada por la prueba de paridad) ─────────

const MIB = 1024 * 1024;
export const TOPE_IMAGEN = 5 * MIB;
export const TOPE_DOCUMENTO = 16 * MIB;
export const TOPE_AUDIO = 16 * MIB;
export const MAX_LADO_IMAGEN = 4096;
export const MAX_LEYENDA = 1000;
/** Tope de una nota de voz: 4 minutos. */
export const TOPE_GRABACION_MS = 240_000;
/** El servidor corta a los 120 s; el SDK, por defecto, a los 70 s. La consola espera un poco más que el servidor. */
export const TIEMPO_DE_ESPERA_ADJUNTO_MS = 130_000;
/** Largo del nombre que se manda (el servidor acepta hasta 1.000; se corta a lo que usa para guardar). */
const MAX_NOMBRE = 240;

export const ENTRADA_IMAGEN: Readonly<Record<string, string>> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
export const DOCUMENTOS: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
};
export const AUDIOS: Readonly<Record<string, string>> = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg' };
export const ACCEPT = [
  '.jpg', '.jpeg', '.png', '.pdf', '.docx', '.xlsx', '.pptx', '.txt', '.mp3', '.m4a', '.aac', '.ogg',
  'image/jpeg', 'image/png', 'application/pdf', 'text/plain', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg',
  DOCUMENTOS['docx'], DOCUMENTOS['xlsx'], DOCUMENTOS['pptx'],
].join(',');

// ── Tipos ────────────────────────────────────────────────────────────────────

export type ClaseDeAdjunto = 'imagen' | 'documento' | 'audio' | 'voz';
export type CodigoLocal = 'vacio' | 'demasiado_grande' | 'tipo_no_admitido' | 'imagen_ilegible';

/** Lo que se envía, ya listo (la vista previa de una imagen se arma al pintar: `data:image/jpeg;base64,` + `base64`): `id` identifica el archivo preparado (para reusar la clave de idempotencia). */
export interface AdjuntoPreparado {
  id: string;
  clase: ClaseDeAdjunto;
  base64: string;
  mime: string;
  /** Solo en documento. */
  nombre?: string;
  tamano: number;
}

export interface FormatoGrabacion { mimeGrabacion: string; mimeDeclarado: 'audio/ogg' | 'audio/webm' }

/** Un fallo local del archivo, antes de llegar al servidor. */
export class ErrorDeAdjunto extends Error {
  readonly codigo: CodigoLocal;
  constructor(codigo: CodigoLocal) {
    super(`Error de adjunto: ${codigo}`);
    this.name = 'ErrorDeAdjunto';
    this.codigo = codigo;
  }
}

// ── Quién ve qué ─────────────────────────────────────────────────────────────

/**
 * ¿Puede una persona de este comercio ENVIAR ARCHIVOS? Todo lo de escribir más la segunda bandera, explícita (`=== true`).
 * Falla cerrada: ficha ausente o con un valor raro es `false`.
 */
export function puedeEnviarMediosDeFicha(
  ficha: { readonly consolaConversaciones?: unknown; readonly personaPuedeEscribir?: unknown; readonly personaPuedeEnviarMedios?: unknown } | null | undefined,
): boolean {
  return puedeIntervenirDeFicha(ficha) && personaPuedeEnviarMediosDeFicha(ficha);
}

/** Los botones de adjuntar existen SOLO si se cumplen las cuatro condiciones. */
export function verAdjuntar(a: { verEscribir: boolean; puedeEnviarMedios: boolean; ventana: EstadoVentanaEnvio; habilitados: boolean }): boolean {
  return a.verEscribir === true && a.puedeEnviarMedios === true && a.ventana === 'abierta' && a.habilitados === true;
}

/**
 * El formato en que se puede grabar una nota de voz que WhatsApp acepta: Ogg/Opus primero, WebM/Opus después, y si no hay,
 * `null` (el botón no se pinta). NUNCA mp4: el servidor no lo acepta como nota de voz.
 */
export function formatoDeGrabacion(e: { hayMediaRecorder: boolean; hayGetUserMedia: boolean; soporta: (m: string) => boolean }): FormatoGrabacion | null {
  if (!e.hayMediaRecorder || !e.hayGetUserMedia) return null;
  if (e.soporta('audio/ogg;codecs=opus')) return { mimeGrabacion: 'audio/ogg;codecs=opus', mimeDeclarado: 'audio/ogg' };
  if (e.soporta('audio/webm;codecs=opus')) return { mimeGrabacion: 'audio/webm;codecs=opus', mimeDeclarado: 'audio/webm' };
  return null;
}

// ── El archivo que se elige ──────────────────────────────────────────────────

export type ClasificacionDeArchivo =
  | { ok: true; clase: 'imagen' | 'documento' | 'audio'; mime: string; ext: string }
  | { ok: false; error: CodigoLocal };

/**
 * Qué es el archivo, por su EXTENSIÓN (la del último punto): `factura.pdf.exe` es `exe` y no se admite. El `mime` sale de
 * la tabla, nunca de `file.type` (lo pone el navegador o el sistema y puede mentir); el servidor revisa los bytes igual.
 * Una imagen se admite hasta 25 MiB porque se recodifica; lo demás, hasta su tope.
 */
export function clasificarArchivo(nombre: string, _tipoDelNavegador: string, tamano: number): ClasificacionDeArchivo {
  const punto = nombre.lastIndexOf('.');
  const ext = punto >= 0 ? nombre.slice(punto + 1).toLowerCase() : '';
  const imagen = ENTRADA_IMAGEN[ext];
  const documento = DOCUMENTOS[ext];
  const audio = AUDIOS[ext];
  const clase = imagen ? 'imagen' : documento ? 'documento' : audio ? 'audio' : null;
  const mime = imagen ?? documento ?? audio;
  if (!clase || !mime) return { ok: false, error: 'tipo_no_admitido' };
  if (tamano <= 0) return { ok: false, error: 'vacio' };
  const tope = clase === 'imagen' ? TOPE_ORIGINAL : clase === 'documento' ? TOPE_DOCUMENTO : TOPE_AUDIO;
  if (tamano > tope) return { ok: false, error: 'demasiado_grande' };
  return { ok: true, clase, mime, ext };
}

/** Las medidas tras acotar el lado mayor a `lado`: proporcionales, redondeadas, nunca menores de 1. */
export function medidasDeRecodificacion(ancho: number, alto: number, lado: number = MAX_LADO_IMAGEN): { ancho: number; alto: number } {
  const mayor = Math.max(ancho, alto);
  const f = mayor > lado ? lado / mayor : 1;
  return { ancho: Math.max(1, Math.round(ancho * f)), alto: Math.max(1, Math.round(alto * f)) };
}

export interface LienzoMinimo {
  getContext(t: '2d'): { fillStyle: string; fillRect(x: number, y: number, w: number, h: number): void; drawImage(i: CanvasImageSource, x: number, y: number, w: number, h: number): void } | null;
  toBlob(cb: (b: Blob | null) => void, tipo: string, calidad: number): void;
}

const CALIDADES = [0.85, 0.75, 0.65, 0.55];

/** `data:<tipo>;base64,<datos>` → los datos; `null` si no cumple la forma o el alfabeto. */
export function base64DeDataUrl(d: string): string | null {
  const m = /^data:[^,]*;base64,/.exec(d);
  if (!m) return null;
  const b = d.slice(m[0].length);
  return b.length > 0 && b.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(b) ? b : null;
}

/**
 * Una imagen se vuelve JPEG: se decodifica sin `blob:`, se acota a 4.096 px, se pinta sobre fondo blanco (un PNG con
 * transparencia no sale negro) y se baja la calidad hasta que quepa en 5 MiB; si no, se reduce el lado al 75 % (hasta 3
 * veces). El lienzo no copia EXIF ni GPS. Siempre libera el bitmap.
 */
export async function recodificarImagen(
  archivo: Blob,
  piezas: {
    decodificar: (b: Blob) => Promise<ImagenDecodificada>;
    crearLienzo: (w: number, h: number) => LienzoMinimo;
    leerComoDataUrl: (b: Blob) => Promise<string>;
  },
): Promise<{ dataUrl: string; base64: string; tamano: number }> {
  let img: ImagenDecodificada;
  try { img = await piezas.decodificar(archivo); } catch { throw new ErrorDeAdjunto('imagen_ilegible'); }
  try {
    let lado = Math.min(MAX_LADO_IMAGEN, Math.max(img.ancho, img.alto));
    for (let ronda = 0; ronda < 4; ronda++) {
      const { ancho, alto } = medidasDeRecodificacion(img.ancho, img.alto, lado);
      const lienzo = piezas.crearLienzo(ancho, alto);
      const ctx = lienzo.getContext('2d');
      if (!ctx) throw new ErrorDeAdjunto('imagen_ilegible');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, ancho, alto);
      ctx.drawImage(img.fuente, 0, 0, ancho, alto);
      for (const q of CALIDADES) {
        const blob = await new Promise<Blob | null>((ok) => lienzo.toBlob(ok, 'image/jpeg', q));
        if (!blob) throw new ErrorDeAdjunto('imagen_ilegible');
        if (blob.size > TOPE_IMAGEN) continue;
        const dataUrl = await piezas.leerComoDataUrl(blob);
        const base64 = base64DeDataUrl(dataUrl);
        if (!base64) throw new ErrorDeAdjunto('imagen_ilegible');
        return { dataUrl, base64, tamano: blob.size };
      }
      lado = Math.max(1, Math.round(lado * 0.75));
    }
    throw new ErrorDeAdjunto('demasiado_grande');
  } finally {
    img.cerrar();
  }
}

// ── La leyenda y el destinatario ─────────────────────────────────────────────

const CONTROLES = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** La leyenda que se manda: nunca en audio ni en voz; vacía = ninguna; más de 1.000 caracteres o con controles = inválida. */
export function leyendaParaEnviar(crudo: string, clase: ClaseDeAdjunto): { ok: true; leyenda?: string } | { ok: false } {
  if (clase === 'audio' || clase === 'voz') return { ok: true };
  const t = crudo.trim();
  if (t.length === 0) return { ok: true };
  if (crudo.length > MAX_LEYENDA || CONTROLES.test(crudo)) return { ok: false };
  return { ok: true, leyenda: t };
}

/** Nombre y últimos 4 dígitos para la confirmación; el número entero no se muestra en ese texto. */
export function destinatarioAbreviado(nombre: string, telefono: string): { nombre: string; ultimos4: string } {
  const digitos = telefono.replace(/\D/g, '');
  return { nombre: nombre.trim() || 'el cliente', ultimos4: digitos.length >= 4 ? digitos.slice(-4) : '' };
}

// ── Textos de error ──────────────────────────────────────────────────────────

export function textoErrorMicrofono(nombreError: string): string {
  switch (nombreError) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'El navegador no dio permiso para usar el micrófono. Permítalo en la configuración del sitio e intente de nuevo.';
    case 'NotFoundError': return 'No se encontró un micrófono.';
    case 'NotReadableError': return 'El micrófono está en uso por otra aplicación.';
    default: return 'No se pudo iniciar la grabación.';
  }
}

/** Los códigos de rechazo del servidor (`CodigoDeRechazo` + `leyenda_en_audio`), con un texto fijo cada uno. */
export const TEXTOS_DE_RECHAZO: Readonly<Record<string, string>> = {
  vacio: 'El archivo está vacío.',
  demasiado_grande: 'El archivo es demasiado grande: imágenes hasta 5 MB; documentos y audios hasta 16 MB.',
  tipo_no_admitido: 'Ese tipo de archivo no se puede enviar. Se admiten imágenes JPG o PNG, PDF, Word, Excel y PowerPoint (sin macros), texto (.txt) y audios mp3, m4a, aac u ogg.',
  tipo_no_coincide: 'El contenido del archivo no coincide con su tipo (por ejemplo, un archivo renombrado). No se envió.',
  poliglota: 'El PDF contiene otro archivo escondido. Por seguridad no se envía.',
  con_macros: 'El documento tiene macros. Por seguridad no se envía; guárdelo sin macros e intente de nuevo.',
  pdf_activo: 'El PDF tiene contenido activo (JavaScript, acciones automáticas o archivos incrustados). Por seguridad no se envía.',
  imagen_invalida: 'La imagen está dañada o incompleta. No se envió.',
  imagen_dimensiones: 'La imagen supera 4.096 píxeles de lado. No se envió.',
  ogg_invalido: 'El audio está dañado o incompleto. No se envió.',
  ogg_sin_opushead: 'El audio Ogg no es Opus: WhatsApp no lo acepta. No se envió.',
  no_mono: 'El audio debe ser de un solo canal (mono). No se envió.',
  webm_invalido: 'La grabación no se pudo convertir para WhatsApp. Intente grabar de nuevo.',
  leyenda_en_audio: 'Los audios no llevan texto. Envíe el audio sin texto y escriba el mensaje aparte.',
};

/** El texto de un fallo local del archivo (antes de llamar al servidor). */
export function textoErrorLocal(codigo: CodigoLocal): string {
  return codigo === 'imagen_ilegible' ? 'No pudimos leer ese archivo como imagen. Use un JPG o PNG.' : TEXTOS_DE_RECHAZO[codigo] ?? 'No se pudo preparar el archivo.';
}

const TEXTO_DIARIO = 'Se renueva a la medianoche de Bolivia.';

/** Lo que ve la persona según el código del error de la callable. Nunca lee `message`; ninguna cifra de límite va en el texto. */
export function textoErrorAdjunto(codigo: string, detalles: Record<string, unknown> = {}): string {
  if (resultadoDesconocido(codigo)) {
    return `${TEXTO_INCIERTO}. Revise la conversación. Si vuelve a pulsar «Reintentar envío», se reintenta este mismo archivo y no se duplica.`;
  }
  switch (codigo) {
    case 'unauthenticated': return 'Su sesión venció. Vuelva a ingresar.';
    case 'permission-denied':
      return 'No se envió: el envío de archivos no está activo para su negocio, o su usuario no tiene permiso para intervenir en esta conversación.';
    case 'failed-precondition': {
      if (detalles['motivo'] === 'espera') {
        const n = detalles['esperaSegundos'];
        const seg = typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 3600 ? n : null;
        return `Espere${seg === null ? ' unos segundos' : ` ${seg} ${seg === 1 ? 'segundo' : 'segundos'}`}: el asistente puede estar respondiendo. Después vuelva a pulsar «Enviar archivo».`;
      }
      return 'No se envió: usted ya no tiene esta conversación, la ventana de 24 h de WhatsApp se cerró, este número todavía no admite archivos, o esa clave de envío ya se usó con otro archivo. Revise el estado de arriba.';
    }
    case 'invalid-argument': {
      const m = detalles['motivo'];
      if (typeof m === 'string' && Object.prototype.hasOwnProperty.call(TEXTOS_DE_RECHAZO, m)) return TEXTOS_DE_RECHAZO[m]!;
      return 'La solicitud no es válida: el texto debe tener entre 1 y 1.000 caracteres y el archivo, un nombre y un tipo válidos.';
    }
    case 'resource-exhausted':
      if (detalles['tope'] === 'adjuntosDia') return `El comercio llegó al máximo de archivos que puede enviar por día. ${TEXTO_DIARIO}`;
      if (detalles['tope'] === 'bytesDia') return `El comercio llegó al volumen máximo de archivos que puede enviar por día. ${TEXTO_DIARIO}`;
      return textoTope(detalles);
    case 'not-found': return 'La conversación ya no existe.';
    default: return 'No se pudo enviar el archivo. Intente de nuevo.';
  }
}

// ── La clave de idempotencia y el envío ──────────────────────────────────────

/** El envío abierto: qué archivo preparado, con qué leyenda y con qué clave. */
export interface BorradorAdjunto { idPreparado: string; leyenda: string; clave: string }

/** Mismo archivo y misma leyenda que el intento que no llegó a confirmarse = misma clave (reintentar no duplica). */
export function claveDelAdjunto(
  previo: BorradorAdjunto | null, idPreparado: string, leyenda: string, generar: () => string = nuevaClave,
): BorradorAdjunto {
  if (previo && previo.idPreparado === idPreparado && previo.leyenda === leyenda && esClaveValida(previo.clave)) return previo;
  return { idPreparado, leyenda, clave: generar() };
}

export interface EntradaAdjunto {
  tenantId: string;
  conversacionId: string;
  clave: string;
  adjunto: { base64: string; mime: string; nombre?: string };
  leyenda?: string;
}

/** El cuerpo exacto de la callable. Las claves sin valor se OMITEN (nunca `undefined`: el SDK lo vuelve `null`). */
export function cuerpoDeAdjunto(e: EntradaAdjunto): Record<string, unknown> {
  const adjunto: Record<string, unknown> = { base64: e.adjunto.base64, mime: e.adjunto.mime };
  if (typeof e.adjunto.nombre === 'string' && e.adjunto.nombre !== '') adjunto['nombre'] = e.adjunto.nombre;
  const cuerpo: Record<string, unknown> = {
    tenantId: e.tenantId, conversacionId: e.conversacionId, clave: e.clave, adjunto,
  };
  if (typeof e.leyenda === 'string' && e.leyenda !== '') cuerpo['leyenda'] = e.leyenda;
  return cuerpo;
}

export interface CapaAdjunto { enviarAdjunto(e: EntradaAdjunto): Promise<unknown> }

/** La callable de Core (us-east1, la de `funciones`), con una espera mayor que la del SDK por defecto. */
export function capaAdjuntoReal(funciones: Functions): CapaAdjunto {
  return {
    enviarAdjunto: async (e) => (await httpsCallable<Record<string, unknown>, unknown>(
      funciones, 'enviarAdjuntoComoPersona', { timeout: TIEMPO_DE_ESPERA_ADJUNTO_MS })(cuerpoDeAdjunto(e))).data,
  };
}

export type SalidaEnvioAdjunto =
  | { tipo: ResultadoEnvio }
  | { tipo: 'error'; codigo: string; texto: string; desconocido: boolean };

export interface ResultadoDeEnvioDeAdjunto {
  salida: SalidaEnvioAdjunto;
  /** El envío que queda abierto (con su clave, para reintentar sin duplicar); `null` = cerrado. */
  borrador: BorradorAdjunto | null;
  /** La clave con la que SE LLAMÓ. */
  clave: string;
}

/**
 * Hace UN intento de envío. Sin respuesta del servidor (red, tiempo agotado) queda abierto con su clave; con cualquier
 * respuesta queda cerrado. NUNCA reintenta solo, ni siquiera un `incierto`. El nombre solo viaja en documento; la leyenda,
 * solo en imagen o documento.
 */
export async function ejecutarEnvioDeAdjunto(
  capa: CapaAdjunto,
  entrada: { tenantId: string; conversacionId: string; preparado: AdjuntoPreparado; leyenda?: string },
  previo: BorradorAdjunto | null,
  generar: () => string = nuevaClave,
): Promise<ResultadoDeEnvioDeAdjunto> {
  const p = entrada.preparado;
  const leyenda = p.clase === 'imagen' || p.clase === 'documento' ? entrada.leyenda : undefined;
  const b = claveDelAdjunto(previo, p.id, leyenda ?? '', generar);
  const adjunto: EntradaAdjunto['adjunto'] = { base64: p.base64, mime: p.mime };
  if (p.clase === 'documento' && p.nombre) adjunto.nombre = p.nombre.slice(0, MAX_NOMBRE);
  const e: EntradaAdjunto = { tenantId: entrada.tenantId, conversacionId: entrada.conversacionId, clave: b.clave, adjunto };
  if (leyenda) e.leyenda = leyenda;
  try {
    const respuesta = await capa.enviarAdjunto(e);
    return { salida: { tipo: interpretarEnvio(respuesta) }, borrador: null, clave: b.clave };
  } catch (err) {
    const codigo = codigoDeError(err);
    const desconocido = resultadoDesconocido(codigo);
    return {
      salida: { tipo: 'error', codigo, texto: textoErrorAdjunto(codigo, detallesDeError(err)), desconocido },
      borrador: desconocido ? b : null, clave: b.clave,
    };
  }
}

// ── La grabación de una nota de voz (con piezas inyectables, para probarla sin navegador) ────────

export interface PistaMinima { stop(): void }
export interface FlujoMinimo { getTracks(): PistaMinima[] }
export interface DestinoMinimo { stream: FlujoMinimo; channelCount: number; channelCountMode: string; channelInterpretation: string }
export interface ContextoMinimo {
  state: string;
  resume(): Promise<void>;
  close(): Promise<void>;
  createMediaStreamSource(f: FlujoMinimo): { connect(d: DestinoMinimo): void };
  createMediaStreamDestination(): DestinoMinimo;
}
export interface GrabadorMinimo {
  state: string;
  start(): void;
  stop(): void;
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
}
export interface EntornoDeGrabacion {
  crearContexto(): ContextoMinimo;
  pedirMicrofono(): Promise<FlujoMinimo>;
  crearGrabador(flujo: FlujoMinimo, mimeType: string): GrabadorMinimo;
}

/** La grabación no pudo empezar (contexto de audio detenido, sin audio): texto fijo, nunca el del navegador. */
export class ErrorDeGrabacion extends Error {
  constructor() { super('Error de grabación'); this.name = 'ErrorDeGrabacion'; }
}

function soltarRecursos(flujo: FlujoMinimo | null, ctx: ContextoMinimo | null): void {
  try { flujo?.getTracks().forEach((t) => t.stop()); } catch { /* ya parado */ }
  try { void ctx?.close().catch(() => undefined); } catch { /* ya cerrado */ }
}

interface GrabacionViva {
  flujo: FlujoMinimo; ctx: ContextoMinimo; rec: GrabadorMinimo;
  reloj: ReturnType<typeof setInterval> | null; tope: ReturnType<typeof setTimeout> | null; descartada: boolean;
}

/**
 * Una grabación a la vez. Garantías: un doble arranque llama UNA vez al micrófono; lo que se abrió (pistas, contexto) se
 * suelta en todo camino (error, descartar, tope, desmontaje); mono a la fuerza; el temporizador del tope detiene SU grabador;
 * un contexto de audio que no está corriendo es un error (no se graba en silencio sin saberlo).
 */
export class Grabadora {
  private arrancando = false;
  private cerrada = false;
  private viva: GrabacionViva | null = null;

  constructor(private readonly entorno: EntornoDeGrabacion, private readonly formato: FormatoGrabacion) {}

  get ocupada(): boolean { return this.arrancando || this.viva !== null; }

  /** `true` si empezó a grabar; `false` si ya había otra o la grabadora se cerró. Lanza si no pudo empezar (ya soltó todo). */
  async iniciar(alTerminar: (f: { trozos: Blob[] }) => void, alTic: (ms: number) => void): Promise<boolean> {
    if (this.ocupada || this.cerrada) return false;
    this.arrancando = true;   // síncrono: antes de cualquier `await`
    let flujo: FlujoMinimo | null = null;
    let ctx: ContextoMinimo | null = null;
    try {
      ctx = this.entorno.crearContexto();                          // dentro del gesto de la persona
      const reanudado = ctx.resume().catch(() => undefined);
      flujo = await this.entorno.pedirMicrofono();
      await reanudado;
      if (this.cerrada) { soltarRecursos(flujo, ctx); return false; }
      if (ctx.state !== 'running') throw new ErrorDeGrabacion();
      const fuente = ctx.createMediaStreamSource(flujo);
      const destino = ctx.createMediaStreamDestination();
      destino.channelCount = 1; destino.channelCountMode = 'explicit'; destino.channelInterpretation = 'speakers';
      fuente.connect(destino);
      const rec = this.entorno.crearGrabador(destino.stream, this.formato.mimeGrabacion);
      const trozos: Blob[] = [];
      const viva: GrabacionViva = { flujo, ctx, rec, reloj: null, tope: null, descartada: false };
      rec.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) trozos.push(ev.data); };
      rec.onstop = () => { const d = viva.descartada; this.liberar(viva); if (!d) alTerminar({ trozos }); };
      rec.start();
      this.viva = viva;
      const inicio = Date.now();
      viva.reloj = setInterval(() => alTic(Math.min(TOPE_GRABACION_MS, Date.now() - inicio)), 250);
      viva.tope = setTimeout(() => { try { if (rec.state !== 'inactive') rec.stop(); } catch { /* ya parado */ } }, TOPE_GRABACION_MS);
      return true;
    } catch (e) {
      soltarRecursos(flujo, ctx);
      throw e;
    } finally {
      this.arrancando = false;
    }
  }

  /** Termina y entrega lo grabado (por `alTerminar`). */
  detener(): void {
    const v = this.viva;
    if (v && v.rec.state !== 'inactive') { try { v.rec.stop(); } catch { /* ya parado */ } }
  }

  /** Corta y tira lo grabado: no entrega nada y suelta el micrófono al instante. */
  descartar(): void {
    const v = this.viva;
    if (!v) return;
    v.descartada = true;
    try { if (v.rec.state !== 'inactive') v.rec.stop(); } catch { /* ya parado */ }
    this.liberar(v);
  }

  /** Al desmontar: nada vuelve a empezar y todo lo abierto se suelta. */
  destruir(): void { this.cerrada = true; this.descartar(); }

  private liberar(v: GrabacionViva): void {
    if (v.reloj) clearInterval(v.reloj);
    if (v.tope) clearTimeout(v.tope);
    v.reloj = null; v.tope = null;
    soltarRecursos(v.flujo, v.ctx);
    if (this.viva === v) this.viva = null;
  }
}
