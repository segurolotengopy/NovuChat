/**
 * =============================================================================
 * EL TURNO DE UNA CONVERSACIÓN — quién responde, la persona o el asistente (CORE)
 * =============================================================================
 *
 * H2 «Intervención de una persona en las conversaciones» (contrato único del
 * 16/10/2026, §1 y §3). Una persona del comercio puede TOMAR una conversación: mientras
 * la tiene, el asistente calla. Este archivo es la regla pura de esa pausa, sin
 * `import` de Firebase, para que la usen tal cual las callables (`tomarConversacion`,
 * `devolverConversacion`), la ingesta y `configuracionFlujo` (H2-3) y las pruebas.
 *
 * EL DATO. `tenants/{t}/conversaciones/{wa_<tel>}.turno`:
 *
 *   { responde: 'persona' | 'asistente', tomadoPor: <uid>, tomadoEn, actividadPersonaEn,
 *     devueltoEn?, motivoDevolucion?: 'manual' | 'inactividad' | 'ventana' }
 *
 * Ausente = responde el asistente. Lo escribe SOLO el servidor (Admin SDK); las
 * reglas de Firestore ya le niegan `turno` a la persona (`soloCampos` de gestión).
 *
 * SIN TEMPORIZADORES. La pausa no vence con un reloj corriendo en la nube: se
 * CALCULA cuando llega el siguiente mensaje, con lo que la transacción de la ingesta
 * ya leyó (el documento de la conversación). Una persona que toma una conversación
 * y se olvida la devuelve sola de dos maneras:
 *
 *   - INACTIVIDAD: pasaron 30 minutos desde su última actividad (`actividadPersonaEn`:
 *     cuando tomó o cuando mandó su último mensaje).
 *   - VENTANA: se cerró la ventana de 24 horas de Meta, contada desde el último
 *     mensaje ENTRANTE (`ultimoEntranteEn` + 24 h), no desde `atencion.ventanaVenceEn`
 *     (esa es la ventana de FACTURACIÓN, otra cosa). Pasada la ventana la persona no
 *     puede escribir (H2 es solo texto dentro de la ventana), así que seguir callando
 *     al asistente dejaría al cliente sin respuesta de nadie.
 *
 * Gana el vencimiento que ocurrió primero; si coinciden, el de la ventana.
 *
 * QUÉ HACE CADA CASO RARO, y por qué (todo falla hacia «responde el asistente»):
 *
 *   - Un `turno` ilegible (forma rara, fechas que no son fechas, un `tomadoPor`
 *     que no es un uid, una actividad o un último entrante del FUTURO a más de 5 min)
 *     responde el asistente con el motivo `ilegible`. Solo el servidor lo escribe, así
 *     que si aparece es un defecto; callar al asistente por un dato corrupto dejaría al
 *     negocio mudo sin que nadie lo sepa, y que responda el asistente es lo que ya
 *     pasaba antes de H2. `tomarConversacion` lo repara; no queda atascado.
 *   - Una persona con turno y sin `ultimoEntranteEn` (la ventana no se puede calcular)
 *     cuenta como ventana cerrada: «sin dato = cerrada», igual que para enviar.
 *   - `devuelto` (responde 'asistente') es un estado válido: lo deja `devolverConversacion`
 *     y lo dejará la ingesta al calcular un vencimiento.
 *
 * Los tiempos son milisegundos desde 1970. Las fechas de Firestore (`Timestamp`) se
 * leen por su método `toMillis` sin importarlas: este archivo no depende de Firebase.
 */

// ---------------------------------------------------------------------------
// CONSTANTES (con nombre: ninguna cifra suelta en el código que las usa)
// ---------------------------------------------------------------------------

/** Plazo de devolución por inactividad: 30 minutos (constante en H2; configurable, después). */
export const INACTIVIDAD_MS = 30 * 60_000;
/** La ventana de atención de Meta: 24 horas desde el último mensaje del cliente. */
export const VENTANA_META_MS = 24 * 3_600_000;
/** Margen con el que `enviarComoPersona` (H2-2) considera cerrada la ventana: 60 s antes. */
export const MARGEN_ENVIO_MS = 60_000;
/**
 * Cuánto se tolera una fecha guardada «en el futuro» antes de tomarla por dato malo (la misma
 * cifra de la ingesta para `ultimoEntranteEn`): un adelanto mayor alargaría la pausa sin límite.
 */
export const MARGEN_RELOJ_MS = 5 * 60_000;

/** Un uid de Firebase Auth. */
export const UID_DE_PERSONA = /^[A-Za-z0-9_-]{1,128}$/;
/** El id de una conversación de WhatsApp: `wa_` y el teléfono con 8 a 15 dígitos. */
export const ID_CONVERSACION = /^wa_[0-9]{8,15}$/;

// ---------------------------------------------------------------------------
// TIPOS
// ---------------------------------------------------------------------------

export type Responde = 'persona' | 'asistente';
export type MotivoDevolucion = 'manual' | 'inactividad' | 'ventana';
export const MOTIVOS_DE_DEVOLUCION: readonly MotivoDevolucion[] = ['manual', 'inactividad', 'ventana'];

/** El turno ya leído y validado, con los tiempos en milisegundos. */
export interface Turno {
  responde: Responde;
  tomadoPor: string;
  tomadoEn: number;
  actividadPersonaEn: number;
  devueltoEn?: number;
  motivoDevolucion?: MotivoDevolucion;
}

/** Lo que se lee del campo `turno` de una conversación. */
export type LecturaDeTurno =
  | { estado: 'ausente' }
  | { estado: 'ilegible' }
  | { estado: 'ok'; turno: Turno };

/** Por qué responde quien responde. */
export type MotivoDeVeredicto =
  | 'sin_turno'   // nunca se tomó: responde el asistente
  | 'tomado'      // la persona lo tiene y no venció: responde la persona
  | 'devuelto'    // ya se devolvió (a mano o por una devolución anterior)
  | 'inactividad' // la persona se quedó 30 minutos sin actividad
  | 'ventana'     // se cerró la ventana de 24 h (o no hay dato de ella)
  | 'ilegible';   // el dato está roto: responde el asistente

export interface Veredicto {
  responde: Responde;
  motivo: MotivoDeVeredicto;
  /**
   * Con `tomado`: el primer vencimiento que viene (ms). Con `inactividad` o `ventana`: cuándo
   * venció. Ausente si no se puede calcular (por ejemplo, ventana sin `ultimoEntranteEn`).
   */
  venceEnMs?: number;
}

/** Lo que de una conversación importa para decidir la pausa. */
export interface ConversacionParaTurno {
  readonly ultimoEntranteEn?: unknown;
}

// ---------------------------------------------------------------------------
// LECTURA (pura)
// ---------------------------------------------------------------------------

/** Los milisegundos de una fecha de Firestore (cualquier objeto con `toMillis`), o `null`. */
export function milisegundosDeMomento(v: unknown): number | null {
  if (typeof v !== 'object' || v === null) return null;
  const f = (v as { toMillis?: unknown }).toMillis;
  if (typeof f !== 'function') return null;
  try {
    const n: unknown = f.call(v);
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

const esObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Lee y valida el campo `turno` tal como está guardado. `undefined` = ausente. Todo lo que no
 * tenga exactamente la forma del contrato (incluido `null`) es `ilegible`: ante la duda no se
 * adivina a quién pertenece la conversación.
 */
export function leerTurno(crudo: unknown): LecturaDeTurno {
  if (crudo === undefined) return { estado: 'ausente' };
  if (!esObjeto(crudo)) return { estado: 'ilegible' };
  const { responde, tomadoPor, motivoDevolucion } = crudo;
  if (responde !== 'persona' && responde !== 'asistente') return { estado: 'ilegible' };
  if (typeof tomadoPor !== 'string' || !UID_DE_PERSONA.test(tomadoPor)) return { estado: 'ilegible' };
  const tomadoEn = milisegundosDeMomento(crudo['tomadoEn']);
  const actividadPersonaEn = milisegundosDeMomento(crudo['actividadPersonaEn']);
  if (tomadoEn === null || actividadPersonaEn === null) return { estado: 'ilegible' };
  const turno: Turno = { responde, tomadoPor, tomadoEn, actividadPersonaEn };
  if (crudo['devueltoEn'] !== undefined) {
    const devueltoEn = milisegundosDeMomento(crudo['devueltoEn']);
    if (devueltoEn === null) return { estado: 'ilegible' };
    turno.devueltoEn = devueltoEn;
  }
  if (motivoDevolucion !== undefined) {
    if (!(MOTIVOS_DE_DEVOLUCION as readonly unknown[]).includes(motivoDevolucion)) return { estado: 'ilegible' };
    turno.motivoDevolucion = motivoDevolucion as MotivoDevolucion;
  }
  return { estado: 'ok', turno };
}

// ---------------------------------------------------------------------------
// LA VENTANA DE META
// ---------------------------------------------------------------------------

/**
 * ¿Sigue abierta la ventana de 24 h de Meta? Cuenta desde el último mensaje ENTRANTE. Sin dato,
 * con un dato que no es fecha o con una fecha del futuro a más de 5 min: cerrada. Abierta mientras
 * `ahora < ultimoEntrante + 24 h - margen`; con el margen en 0, el instante exacto del cierre ya
 * es cerrado.
 */
export function ventanaDeMetaAbierta(ultimoEntranteEn: unknown, ahoraMs: number, margenMs = 0): boolean {
  if (!Number.isFinite(ahoraMs)) return false;
  const ultimo = milisegundosDeMomento(ultimoEntranteEn);
  if (ultimo === null || ultimo > ahoraMs + MARGEN_RELOJ_MS) return false;
  return ahoraMs < ultimo + VENTANA_META_MS - margenMs;
}

// ---------------------------------------------------------------------------
// EL VEREDICTO
// ---------------------------------------------------------------------------

/**
 * ¿Responde la persona o el asistente, y por qué? Pura: el reloj entra como argumento.
 *
 * @param turno         el campo `turno` tal como está guardado (`conversacion.get('turno')`).
 * @param conversacion  de la conversación, solo `ultimoEntranteEn` (el de ANTES del mensaje que
 *                      llega, que es el que la transacción de la ingesta tiene leído).
 */
export function turnoVigente(turno: unknown, conversacion: ConversacionParaTurno | null | undefined, ahoraMs: number): Veredicto {
  const lectura = leerTurno(turno);
  if (lectura.estado === 'ausente') return { responde: 'asistente', motivo: 'sin_turno' };
  if (lectura.estado === 'ilegible' || !Number.isFinite(ahoraMs)) return { responde: 'asistente', motivo: 'ilegible' };
  const t = lectura.turno;
  if (t.responde === 'asistente') return { responde: 'asistente', motivo: 'devuelto' };

  // Una actividad o un toma del futuro lejano no es una persona activa: es un dato malo.
  if (t.actividadPersonaEn > ahoraMs + MARGEN_RELOJ_MS || t.tomadoEn > ahoraMs + MARGEN_RELOJ_MS) {
    return { responde: 'asistente', motivo: 'ilegible' };
  }
  const venceInactividad = t.actividadPersonaEn + INACTIVIDAD_MS;

  const ultimo = milisegundosDeMomento(conversacion?.ultimoEntranteEn);
  if (ultimo === null) return { responde: 'asistente', motivo: 'ventana' }; // sin dato = cerrada
  if (ultimo > ahoraMs + MARGEN_RELOJ_MS) return { responde: 'asistente', motivo: 'ilegible' };
  const venceVentana = ultimo + VENTANA_META_MS;

  const ventanaVencida = ahoraMs >= venceVentana;
  const inactividadVencida = ahoraMs >= venceInactividad;
  if (ventanaVencida && (!inactividadVencida || venceVentana <= venceInactividad)) {
    return { responde: 'asistente', motivo: 'ventana', venceEnMs: venceVentana };
  }
  if (inactividadVencida) return { responde: 'asistente', motivo: 'inactividad', venceEnMs: venceInactividad };
  return { responde: 'persona', motivo: 'tomado', venceEnMs: Math.min(venceInactividad, venceVentana) };
}

/**
 * El turno como realmente está AHORA: lo guardado, con la devolución por vencimiento ya aplicada
 * (`responde:'asistente'`, `devueltoEn` = cuándo venció, `motivoDevolucion`). Es lo que la ingesta
 * escribirá al calcular el vencimiento y lo que las callables devuelven al navegador. `null` si no
 * hay turno o está ilegible.
 */
export function turnoEfectivo(
  turno: unknown, conversacion: ConversacionParaTurno | null | undefined, ahoraMs: number,
): { veredicto: Veredicto; turno: Turno | null } {
  const veredicto = turnoVigente(turno, conversacion, ahoraMs);
  const lectura = leerTurno(turno);
  if (lectura.estado !== 'ok') return { veredicto, turno: null };
  if (veredicto.motivo === 'inactividad' || veredicto.motivo === 'ventana') {
    return {
      veredicto,
      turno: { ...lectura.turno, responde: 'asistente', devueltoEn: veredicto.venceEnMs ?? ahoraMs, motivoDevolucion: veredicto.motivo },
    };
  }
  if (veredicto.motivo === 'ilegible') return { veredicto, turno: null };
  return { veredicto, turno: lectura.turno };
}

// ---------------------------------------------------------------------------
// ERRORES: códigos y mensajes fijos, sin detalle
// ---------------------------------------------------------------------------

/**
 * La lista cerrada de lo que una callable de turno le dice a quien llama. Datos y no
 * `HttpsError`, a propósito: este archivo no importa Firebase. Los códigos son los de
 * `firebase-functions/v2/https`. Ningún mensaje lleva un id, un teléfono ni el texto de un error.
 */
export const ErroresDeTurno = {
  sinSesion: { code: 'unauthenticated', message: 'Inicie sesión.' },
  sinPermiso: { code: 'permission-denied', message: 'No tiene permiso para atender esta conversación.' },
  noHabilitado: { code: 'permission-denied', message: 'Esta función no está habilitada para su comercio.' },
  solicitudInvalida: { code: 'invalid-argument', message: 'Solicitud inválida.' },
  noExiste: { code: 'not-found', message: 'La conversación no existe.' },
  ocupada: { code: 'failed-precondition', message: 'Esta conversación la atiende otra persona.' },
  noEsSuya: { code: 'failed-precondition', message: 'Solo quien atiende la conversación, o un administrador, puede devolverla.' },
  ventanaCerrada: { code: 'failed-precondition', message: 'La ventana de 24 horas de esta conversación está cerrada.' },
  tope: { code: 'resource-exhausted', message: 'Alcanzó el tope de cambios de atención por hora o por día.' },
  noDisponible: { code: 'unavailable', message: 'No se pudo completar la operación. Intente de nuevo.' },
} as const;

export type ClaveDeError = keyof typeof ErroresDeTurno;
