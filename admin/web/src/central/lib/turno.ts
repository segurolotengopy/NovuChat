/**
 * =============================================================================
 * TURNO: QUIÉN RESPONDE EN UNA CONVERSACIÓN (H2, «Intervención de una persona»)
 * =============================================================================
 *
 * Todo lo que la pantalla DECIDE sobre tomar, devolver y escribir vive acá, en
 * funciones puras y sin Firebase, para probarlo sin navegador (`pruebas/central/turno-*.test.ts`).
 * La única parte con red es `capaTurnoReal` (las tres callables); la pantalla recibe una `CapaTurno`, así que
 * una prueba la reemplaza por una simulada sin tocar la pantalla.
 *
 * CONTRATO (CONTRATO ÚNICO H2, 16/10/2026, §1, §2, §4, §5; los nombres no se cambian acá):
 *   · `tenants/{t}/conversaciones/{wa_…}.turno = { responde: 'persona'|'asistente', tomadoPor, tomadoEn,
 *     actividadPersonaEn, devueltoEn?, motivoDevolucion? }`. Ausente = responde el asistente. LO ESCRIBE SOLO EL SERVIDOR.
 *   · Callables (us-east1): `tomarConversacion`, `devolverConversacion`, `enviarComoPersona`.
 *   · Mensaje saliente de una persona: `autor: 'persona'`, `autorUid`, `estadoEnvio`:
 *     `pendiente → enviando → aceptado | rechazado | incierto`.
 *
 * LA CONSOLA NO DECIDE LÍMITES NI AVISOS: los muestra. Quién puede tomar, el tope de envíos, el plazo de devolución por
 * inactividad y la ventana de Meta los verifica el SERVIDOR; lo que se calcula acá (la cuenta regresiva, qué botón se
 * ve) es solo para no ofrecer lo que el servidor va a rechazar. Un botón escondido no es un permiso negado.
 *
 * LECTURA TOLERANTE. Un `turno` ausente, de otro tipo o con un valor raro es «responde el asistente»: la pantalla nunca
 * afirma que una persona atiende si el documento no lo dice con exactitud.
 *
 * LOS ERRORES SALEN DE `e.code`, NUNCA DE `e.message`: el mensaje de una Function puede traer detalles internos.
 */
import { httpsCallable, type Functions } from 'firebase/functions';
// La regla del turno es de CORE y la consola usa la MISMA que el servidor (Central → Core, hacia abajo): ni una
// cifra ni una comparación duplicadas. Un turno vencido por inactividad o por la ventana, o con fechas rotas, es «asistente».
import {
  INACTIVIDAD_MS, MARGEN_ENVIO_MS, VENTANA_META_MS, leerTurno, turnoVigente, ventanaDeMetaAbierta, type Turno,
} from '../../../../functions/src/core/conversacion/turno';

export { INACTIVIDAD_MS, MARGEN_ENVIO_MS, VENTANA_META_MS, leerTurno, turnoVigente, ventanaDeMetaAbierta };
export type { Turno };

// ── Constantes (las cifras de límite las pone el servidor; estas son del texto o de la forma) ─────────────

/** Largo máximo del texto de una persona (contrato §2: 1–1.000 caracteres). El servidor vuelve a comprobarlo. */
export const MAX_TEXTO_PERSONA = 1000;
/** Largo de la clave de idempotencia (contrato §2: 16–128 de `[A-Za-z0-9_.:-]`). */
export const CLAVE_MIN = 16;
export const CLAVE_MAX = 128;
/** SOLO PARA EL TEXTO de aviso (minutos), derivado de la constante de Core. */
export const INACTIVIDAD_DEVOLUCION_MIN = INACTIVIDAD_MS / 60_000;
/** Cuánto se espera, tras una respuesta correcta, a que el cambio llegue por el oyente en vivo antes de soltar los botones. */
export const ESPERA_CAMBIO_MS = 4_000;

// ── El turno, leído de la conversación ───────────────────────────────────────

/** La hora del último mensaje del cliente, con la forma que Core espera de una fecha de Firestore. */
const comoMomento = (ms: number | null) => (ms === null ? undefined : { toMillis: () => ms });

/**
 * Quién responde AHORA, con el veredicto del servidor (`turnoVigente`): `Turno` si una persona responde, `null` si
 * responde el asistente por cualquier motivo (sin turno, devuelto, vencido por inactividad o por la ventana, o ilegible).
 * `turnoCrudo` es el campo `turno` tal como vino del documento. Nunca lanza.
 */
export function turnoDeConversacion(turnoCrudo: unknown, ultimoEntranteEn: number | null, ahora: number): Turno | null {
  const v = turnoVigente(turnoCrudo, { ultimoEntranteEn: comoMomento(ultimoEntranteEn) }, ahora);
  if (v.responde !== 'persona') return null;
  const l = leerTurno(turnoCrudo);
  return l.estado === 'ok' ? l.turno : null;
}

export type SituacionTurno = 'asistente' | 'mio' | 'ajeno';

/** Quién responde, visto por quien mira. Sin sesión (`miUid` vacío), una persona siempre es «ajena». */
export function situacionDeTurno(turno: Turno | null, miUid: string | null | undefined): SituacionTurno {
  if (!turno) return 'asistente';
  return miUid && turno.tomadoPor === miUid ? 'mio' : 'ajeno';
}

/** El uid, abreviado: nunca se muestra entero. «usted» si es el de quien mira. */
export function etiquetaUid(uid: string, miUid: string | null | undefined): string {
  if (miUid && uid === miUid) return 'usted';
  const limpio = uid.trim();
  if (!limpio) return 'una persona';
  return (limpio.length > 8 ? limpio.slice(0, 6) : limpio.slice(0, 4)) + '…';
}

/** «Responde una persona (usted)» / «Responde una persona (ab12cd…)» / «Responde el asistente». */
export function textoEstadoTurno(turno: Turno | null, miUid: string | null | undefined): string {
  return turno ? `Responde una persona (${etiquetaUid(turno.tomadoPor, miUid)})` : 'Responde el asistente';
}

/** El aviso que acompaña a «Tomar»: lo que pasa con el asistente al tomar y cuándo vuelve. */
export const AVISO_TOMAR =
  'Al tomar la conversación, el asistente deja de responder a este cliente. '
  + `Si pasan ${INACTIVIDAD_DEVOLUCION_MIN} minutos sin que usted escriba, o se cierra la ventana de 24 h, `
  + 'el asistente retoma con el siguiente mensaje del cliente.';

// ── Quién ve qué ─────────────────────────────────────────────────────────────

export interface EntradaAcciones {
  situacion: SituacionTurno;
  /** admin u oper del negocio, y NO el propietario de NovuChat (`puedeGestionarConversaciones`). */
  puedeGestionar: boolean;
  /** El rol de quien mira es admin (puede devolver la conversación de otra persona). */
  esAdmin: boolean;
  /** El comercio está `activo`: con otro estado el servidor rechaza todo, y los controles se ven deshabilitados. */
  comercioActivo: boolean;
  /** La ventana de 24 h está abierta (el servidor rechaza tomar con la ventana cerrada o sin dato). */
  ventanaAbierta: boolean;
}

export interface Acciones {
  verTomar: boolean;
  sinTomarPorVentana: boolean;
  verDevolver: boolean;
  verEscribir: boolean;
  /** Los controles que se ven, ¿se pueden pulsar? Falso con el comercio no activo. */
  habilitados: boolean;
}

/**
 * Los botones que se ofrecen. El propietario y el soporte solo LEEN: sin `puedeGestionar` no se ve ninguno.
 *  · Tomar: solo cuando responde el asistente y la ventana de 24 h está abierta (si no, el servidor lo rechaza).
 *  · Devolver: quien la tiene, o un admin.
 *  · Escribir: solo quien la tiene (el servidor exige el turno de ESA persona).
 */
export function accionesDeTurno(a: EntradaAcciones): Acciones {
  if (!a.puedeGestionar) return { verTomar: false, sinTomarPorVentana: false, verDevolver: false, verEscribir: false, habilitados: false };
  return {
    verTomar: a.situacion === 'asistente' && a.ventanaAbierta,
    // «Tomar» escondido por la ventana: la pantalla lo explica en vez de callar.
    sinTomarPorVentana: a.situacion === 'asistente' && !a.ventanaAbierta,
    verDevolver: a.situacion === 'mio' || (a.situacion === 'ajeno' && a.esAdmin),
    verEscribir: a.situacion === 'mio',
    habilitados: a.comercioActivo,
  };
}

/**
 * Tras una respuesta correcta del servidor, ¿el oyente en vivo ya trae el cambio? Mientras no, los botones siguen
 * quietos (si se soltaran, un instante se vería «Tomar» en una conversación que ya se tomó).
 */
export function cambioVisible(esperado: 'tomar' | 'devolver', situacion: SituacionTurno): boolean {
  return esperado === 'tomar' ? situacion === 'mio' : situacion === 'asistente';
}

// ── La ventana de Meta y su cuenta regresiva ─────────────────────────────────

export type EstadoVentanaEnvio = 'sin-dato' | 'abierta' | 'cerrada';
export interface VentanaEnvio { estado: EstadoVentanaEnvio; restanteMs: number }

/**
 * La ventana corre desde `ultimoEntranteEn` (el último mensaje del CLIENTE). No hay respaldo con `ventanaVenceEn`: el
 * contrato (§2) dice que el servidor usa `ultimoEntranteEn` y sin dato rechaza; la consola tampoco ofrece enviar.
 * Dentro del margen de 60 s antes de las 24 h tampoco se ofrece. Un valor del futuro a más de 5 min es dato malo y cuenta como cerrada (igual que en el servidor).
 */
export function ventanaDeEnvio(ultimoEntranteEn: number | null, ahora: number): VentanaEnvio {
  if (ultimoEntranteEn === null || !Number.isFinite(ultimoEntranteEn)) return { estado: 'sin-dato', restanteMs: 0 };
  const restante = Math.min(VENTANA_META_MS, ultimoEntranteEn + VENTANA_META_MS - ahora);
  // La misma pregunta que le hace el servidor (Core), con su margen de 60 s: un «último mensaje» del futuro lejano es dato malo = cerrada.
  if (!ventanaDeMetaAbierta(comoMomento(ultimoEntranteEn), ahora, MARGEN_ENVIO_MS)) return { estado: 'cerrada', restanteMs: Math.max(0, restante) };
  return { estado: 'abierta', restanteMs: restante };
}

/** ¿La ventana está abierta para TOMAR? Core sin margen (el margen de 60 s es del envío). Sin dato o dato malo = cerrada. */
export function ventanaAbiertaParaTomar(ultimoEntranteEn: number | null, ahora: number): boolean {
  return ventanaDeMetaAbierta(comoMomento(ultimoEntranteEn), ahora);
}

/** «03:20:15» (horas, minutos y segundos: es una cuenta regresiva). */
export function textoCuentaRegresiva(restanteMs: number): string {
  const total = Math.max(0, Math.floor(restanteMs / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const dos = (n: number) => String(n).padStart(2, '0');
  return `${dos(h)}:${dos(m)}:${dos(s)}`;
}

/** Por qué no se puede escribir según la ventana (o `null` si se puede). */
export function motivoVentana(v: VentanaEnvio): string | null {
  if (v.estado === 'sin-dato') {
    return 'No consta cuándo escribió el cliente por última vez, así que no se puede saber si la ventana de 24 h de WhatsApp sigue abierta. No se puede enviar.';
  }
  if (v.estado === 'cerrada') {
    return 'La ventana de 24 h de WhatsApp está cerrada: solo se puede escribir cuando el cliente vuelva a escribir. (Las plantillas no están disponibles todavía.)';
  }
  return null;
}

// ── El texto que se escribe ──────────────────────────────────────────────────

export interface EstadoTexto {
  /** Largo con el que se cuenta (el del texto tal como está en el campo). */
  largo: number;
  /** Después de quitar espacios y saltos de los extremos, ¿queda algo? */
  hayTexto: boolean;
  /** Se pasó del máximo. */
  excede: boolean;
  /** Lo que se enviaría (sin espacios de los extremos). */
  texto: string;
}

export function estadoDelTexto(crudo: string): EstadoTexto {
  const texto = crudo.trim();
  return { largo: crudo.length, hayTexto: texto.length > 0, excede: crudo.length > MAX_TEXTO_PERSONA, texto };
}

/** 1000 → «1.000» (a mano: el formato regional de 4 cifras cambia de un navegador a otro). */
const miles = (n: number): string => String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** «123 / 1.000». */
export function textoContador(largo: number): string {
  return `${miles(largo)} / ${miles(MAX_TEXTO_PERSONA)}`;
}

// ── La clave de idempotencia: una por envío lógico ───────────────────────────

const CLAVE_VALIDA = /^[A-Za-z0-9_.:-]{16,128}$/;
export const esClaveValida = (c: unknown): c is string => typeof c === 'string' && CLAVE_VALIDA.test(c);

function aleatorios(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/** `env_` y 32 hexadecimales (16 bytes aleatorios): 36 caracteres. `fuente` se reemplaza en las pruebas. */
export function nuevaClave(fuente: (n: number) => Uint8Array = aleatorios): string {
  return 'env_' + [...fuente(16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** El envío en curso: su texto y su clave. */
export interface Borrador { texto: string; clave: string }

/**
 * La clave de ESTE envío. Mientras el texto sea el mismo que el del intento anterior que no llegó a confirmarse, la clave
 * es la misma (reintentar no duplica); con otro texto es otro envío y la clave es nueva. Cada envío nuevo tiene la suya.
 */
export function claveDelEnvio(previo: Borrador | null, texto: string, generar: () => string = nuevaClave): Borrador {
  if (previo && previo.texto === texto && esClaveValida(previo.clave)) return previo;
  return { texto, clave: generar() };
}

// ── Estado del mensaje saliente de una persona ───────────────────────────────

export type EstadoMensajePersona = 'pendiente' | 'aceptado' | 'rechazado' | 'incierto';

/** `enviando` (interno del servidor) se ve como `pendiente`. Ausente o raro = `null`: no se inventa un estado. */
export function estadoDeMensaje(v: unknown): EstadoMensajePersona | null {
  if (v === 'pendiente' || v === 'enviando') return 'pendiente';
  if (v === 'aceptado' || v === 'rechazado' || v === 'incierto') return v;
  return null;
}

/**
 * «Aceptado» es que WhatsApp lo recibió para entregarlo: NO es «entregado» ni «leído», y mucho menos dinero acreditado.
 * «Incierto» no se reenvía solo: lo decide la persona.
 */
export function textoEstadoMensaje(e: EstadoMensajePersona): string {
  switch (e) {
    case 'pendiente': return 'Enviando…';
    case 'aceptado': return 'Enviado a WhatsApp';
    case 'rechazado': return 'WhatsApp no lo aceptó: no se envió';
    case 'incierto': return 'No se pudo confirmar si llegó';
  }
}

/** El rótulo de un mensaje saliente: «Persona (usted)», «Persona (ab12cd…)» o «Asistente»; `''` si no dice quién lo escribió. */
export function rotuloDeAutor(autor: string, autorUid: string, miUid: string | null | undefined): string {
  if (autor === 'persona') return autorUid ? `Persona (${etiquetaUid(autorUid, miUid)})` : 'Persona';
  if (autor === 'asistente') return 'Asistente';
  return '';
}

// ── Errores de las callables, por código ─────────────────────────────────────

export type AccionTurno = 'tomar' | 'devolver' | 'enviar';

/** El código de un error del SDK sin el prefijo `functions/`. Nunca se lee `message`. */
export function codigoDeError(e: unknown): string {
  const c = e && typeof e === 'object' ? (e as { code?: unknown }).code : undefined;
  return typeof c === 'string' ? c.replace(/^functions\//, '') : '';
}

/** Los `details` estructurados del error (no el `message`): objeto o nada. */
export function detallesDeError(e: unknown): Record<string, unknown> {
  const d = e && typeof e === 'object' ? (e as { details?: unknown }).details : undefined;
  return d && typeof d === 'object' && !Array.isArray(d) ? (d as Record<string, unknown>) : {};
}

/** Segundos de espera que manda el servidor: un entero de 1 a 3.600; lo demás no se usa. */
function segundosDe(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 3600 ? v : null;
}

/**
 * ¿Después de este error NO se sabe si el servidor llegó a registrar el envío? Sí cuando no hubo respuesta (red, tiempo
 * agotado, error interno): ahí el envío se queda con su clave y repetirlo es seguro, porque el servidor lo reconoce.
 */
export function resultadoDesconocido(codigo: string): boolean {
  return codigo === '' || ['deadline-exceeded', 'unavailable', 'internal', 'unknown', 'cancelled', 'data-loss', 'aborted'].includes(codigo);
}

export const TEXTO_INCIERTO = 'No se pudo confirmar si llegó';

/** El tope de envíos de una persona que se alcanzó (`details.tope`, contrato §8): cada uno se dice distinto. */
function textoTope(detalles: Record<string, unknown>): string {
  switch (detalles['tope']) {
    case 'minuto': {
      const n = segundosDe(detalles['esperaSegundos']);
      return n === null ? 'Límite de envíos por minuto; intente de nuevo en unos segundos.' : `Límite de envíos por minuto; intente en ${n} s.`;
    }
    case 'conversacion':
      return 'Alcanzó el máximo de mensajes de una persona para esta conversación en esta ventana de 24 h. Esperar unos segundos no lo cambia.';
    case 'dia':
      return 'Alcanzó el máximo de mensajes de personas que el comercio puede enviar por día. Esperar unos segundos no lo cambia.';
    default:
      return 'Alcanzó un límite de envíos. Consulte con su administrador antes de intentar de nuevo.';
  }
}

/** El texto que ve la persona, según la acción y el código del error. Los códigos y textos son fijos. */
export function textoErrorTurno(accion: AccionTurno, codigo: string, detalles: Record<string, unknown> = {}): string {
  if (accion === 'enviar' && resultadoDesconocido(codigo)) {
    return `${TEXTO_INCIERTO}. Revise la conversación. Si vuelve a pulsar «Enviar», se reintenta este mismo envío y no se duplica.`;
  }
  switch (codigo) {
    case 'unauthenticated': return 'Su sesión venció. Vuelva a ingresar.';
    case 'permission-denied':
      return 'No tiene permiso para intervenir en esta conversación, o esta función no está habilitada para su comercio.';
    case 'failed-precondition': {
      const otra = typeof detalles['tomadoPor'] === 'string' && detalles['tomadoPor'] !== ''
        ? ` (${etiquetaUid(detalles['tomadoPor'], null)})` : '';
      return accion === 'tomar'
        ? (otra ? `No se pudo tomar: ya la tiene otra persona${otra}.`
          : 'No se pudo tomar: la tiene otra persona, o la ventana de 24 h de WhatsApp está cerrada. El estado de arriba dice cuál.')
        : accion === 'devolver'
          ? 'No se pudo devolver: solo quien la atiende, o un administrador, puede hacerlo. El estado de arriba muestra quién responde.'
          : 'No se envió: usted ya no tiene esta conversación, la ventana de 24 h de WhatsApp se cerró, o esa clave de envío ya se usó con otro texto. Revise el estado de arriba.';
    }
    case 'invalid-argument':
      return accion === 'enviar' ? `El mensaje debe tener entre 1 y ${miles(MAX_TEXTO_PERSONA)} caracteres.`
        : 'La conversación no es válida.';
    case 'resource-exhausted':
      return accion === 'enviar' ? textoTope(detalles) : 'Alcanzó el tope de cambios de atención por hora o por día.';
    case 'not-found': return 'La conversación ya no existe, o intervenir todavía no está disponible.';
    default:
      return accion === 'tomar' ? 'No se pudo tomar la conversación. Intente de nuevo.'
        : accion === 'devolver' ? 'No se pudo devolver la conversación. Intente de nuevo.'
          : 'No se pudo enviar el mensaje. Intente de nuevo.';
  }
}

/**
 * Por qué WhatsApp (o el relé) no aceptó un mensaje: texto FIJO por código (`codigoEnvio` del mensaje, contrato §8).
 * Un código que no se conoce no se muestra tal cual: se dice «no lo aceptó» sin inventar el motivo. WM-3037 dice
 * «intente en N s» solo si el servidor mandó los segundos.
 */
export function textoRechazoMeta(codigo: unknown, esperaSegundos?: unknown): string {
  switch (typeof codigo === 'string' ? codigo.trim() : '') {
    case '131047': return 'Pasaron más de 24 horas desde el último mensaje del cliente: WhatsApp ya no admite un mensaje libre.';
    case '130429': return 'WhatsApp recibió demasiados mensajes en poco tiempo. Intente de nuevo en unos minutos.';
    case '131026': return 'WhatsApp no pudo entregarlo: ese número no tiene WhatsApp o no acepta mensajes.';
    case '131049': return 'WhatsApp decidió no entregarlo, para cuidar la experiencia del cliente con muchos mensajes de comercios.';
    case '131051': return 'WhatsApp no admite ese tipo de mensaje.';
    case '131052': return 'WhatsApp no pudo descargar el archivo del mensaje.';
    case '131053': return 'WhatsApp no pudo subir el archivo: formato o tamaño no admitido.';
    case 'WM-3037': {
      const n = segundosDe(esperaSegundos);
      return n === null ? 'Límite de envíos; intente de nuevo en unos instantes.' : `Límite de envíos; intente en ${n} s.`;
    }
    default: return 'WhatsApp no aceptó el mensaje.';
  }
}

export type ResultadoEnvio = 'enviado' | 'incierto' | 'fallido';

/**
 * Lo que contestó `enviarComoPersona` (`{ estado, mensajeId? }`). Del documento del envío (§1) vienen `pendiente`
 * (el timbre ya sonó), `enviado`, `incierto` y `fallido`; también se acepta `aceptado`. Una respuesta que no se entiende
 * se trata como `incierto`: no se afirma que llegó lo que no se sabe.
 */
export function interpretarEnvio(respuesta: unknown): ResultadoEnvio {
  const e = respuesta && typeof respuesta === 'object' ? (respuesta as { estado?: unknown }).estado : undefined;
  if (e === 'pendiente' || e === 'enviado' || e === 'aceptado') return 'enviado';
  if (e === 'fallido' || e === 'rechazado') return 'fallido';
  return 'incierto';
}

// ── Un envío completo: clave, llamada y qué hacer con lo que contestó ────────

export type SalidaEnvio =
  | { tipo: 'enviado' }
  | { tipo: 'incierto' }
  | { tipo: 'fallido' }
  | { tipo: 'error'; codigo: string; texto: string; desconocido: boolean };

export interface ResultadoDeEnvio {
  salida: SalidaEnvio;
  /** El envío que queda abierto: con su clave, para reintentarlo sin duplicar. `null` = el envío quedó cerrado. */
  borrador: Borrador | null;
  /** La clave con la que SE LLAMÓ (para comprobar que el reintento usa la misma). */
  clave: string;
}

/**
 * Hace UN intento de envío. La clave es la del borrador previo si el texto no cambió (reintento del mismo envío) o una
 * nueva. Si el servidor contestó (cualquier respuesta, o un error con código que no deja dudas), el envío queda cerrado;
 * si NO hubo respuesta (red, tiempo agotado, error interno), queda abierto con su clave: reintentar es seguro porque
 * el servidor reconoce la clave. NUNCA reintenta por su cuenta, ni siquiera un `incierto`.
 */
export async function ejecutarEnvio(
  capa: CapaTurno, entrada: EntradaTurno & { texto: string }, previo: Borrador | null, generar: () => string = nuevaClave,
): Promise<ResultadoDeEnvio> {
  const b = claveDelEnvio(previo, entrada.texto, generar);
  try {
    const respuesta = await capa.enviar({
      tenantId: entrada.tenantId, conversacionId: entrada.conversacionId, texto: b.texto, claveIdempotencia: b.clave,
    });
    return { salida: { tipo: interpretarEnvio(respuesta) }, borrador: null, clave: b.clave };
  } catch (e) {
    const codigo = codigoDeError(e);
    const desconocido = resultadoDesconocido(codigo);
    return {
      salida: { tipo: 'error', codigo, texto: textoErrorTurno('enviar', codigo, detallesDeError(e)), desconocido },
      borrador: desconocido ? b : null, clave: b.clave,
    };
  }
}

// ── La capa que habla con el servidor (simulable en las pruebas) ─────────────

export interface EntradaTurno { tenantId: string; conversacionId: string }
export interface EntradaEnvio extends EntradaTurno { texto: string; claveIdempotencia: string }

export interface CapaTurno {
  tomar(e: EntradaTurno): Promise<unknown>;
  devolver(e: EntradaTurno): Promise<unknown>;
  enviar(e: EntradaEnvio): Promise<unknown>;
}

/** Las tres callables de Core (región us-east1, la de `funciones`). Cada una recibe solo lo del contrato. */
export function capaTurnoReal(funciones: Functions): CapaTurno {
  return {
    tomar: async (e) => (await httpsCallable<EntradaTurno, unknown>(funciones, 'tomarConversacion')(
      { tenantId: e.tenantId, conversacionId: e.conversacionId })).data,
    devolver: async (e) => (await httpsCallable<EntradaTurno, unknown>(funciones, 'devolverConversacion')(
      { tenantId: e.tenantId, conversacionId: e.conversacionId })).data,
    enviar: async (e) => (await httpsCallable<EntradaEnvio, unknown>(funciones, 'enviarComoPersona')(
      { tenantId: e.tenantId, conversacionId: e.conversacionId, texto: e.texto, claveIdempotencia: e.claveIdempotencia })).data,
  };
}
