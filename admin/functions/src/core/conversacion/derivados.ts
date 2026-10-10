/**
 * =============================================================================
 * CONVERSACIONES: LOS CAMPOS DERIVADOS QUE ESCRIBE LA INGESTA (CORE)
 * =============================================================================
 *
 * La pantalla de Conversaciones busca y filtra sin leer todo: necesita campos
 * ya calculados en el documento. Los calcula la ingesta, en los dos `tx.set` de
 * conversación que ya existen (el normal y el de corte), con estas dos
 * funciones. NO agregan lecturas ni escrituras: son más campos en escrituras
 * que ya ocurren (decisión D2 del plan H1). La ingesta los usa como `...spread`.
 *
 *   `camposDeConversacionPorMensaje`  va en el documento de la conversación.
 *   `camposDeMensajeIndexado`         va en el documento del mensaje.
 *
 * LA REGLA DE LA VENTANA (D8). `ultimoEntranteEn` y `ventanaVenceEn` los mueve
 * SOLO un mensaje entrante: lo que el negocio escribe no renueva la ventana de
 * 24 h de Meta. Los dos nacen del MISMO `ahoraMs`, así la consola nunca ve una
 * ventana que no cuadra con su ancla.
 *
 * LA REGLA DEL LEÍDO (D7). `noLeidos` (increment) y `sinLeer` los sube SOLO un
 * entrante; la persona del negocio solo puede bajarlos a 0 y a false (lo hacen
 * cumplir las reglas). Un saliente jamás los toca: contestar no es «leer».
 *
 * Los campos son inertes para el flujo del cliente y se escriben para todos los
 * comercios (Core igual para todos). Cero mensajes, cero lecturas extra.
 *
 * Solo importa `firebase-admin/firestore` (FieldValue y Timestamp) y la
 * normalización de este mismo directorio: Core no depende de nada de arriba.
 */
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  MAX_PALABRAS_CONSULTA, MAX_PALABRAS_POR_MENSAJE, VENTANA_HORAS, palabrasDe, trozosDeTelefono,
} from './normalizacion.js';

const HORA_MS = 3_600_000;

/** Lo que la ingesta sabe del mensaje que está guardando. */
export interface MensajeParaDerivar {
  telefono: string;
  direccion: 'entrante' | 'saliente';
  nombreContacto?: string;
}

/**
 * Los campos derivados del documento de la conversación.
 *
 *  - Siempre: `telefonoTrozos` (para hallar el número por sus últimos dígitos) y,
 *    si el nombre del contacto tiene palabras, `nombrePalabras` (hasta 6).
 *  - Solo un ENTRANTE: `ultimoEntranteEn`, `ventanaVenceEn` (+24 h), `noLeidos`
 *    (`increment(1)`) y `sinLeer: true`.
 *
 * Si `ahoraMs` no es un número finito, un entrante omite los dos campos de
 * ventana (la consola los lee como «sin dato») y conserva el resto: un reloj
 * roto jamás debe tirar abajo la ingesta de un mensaje del cliente.
 */
export function camposDeConversacionPorMensaje(
  m: MensajeParaDerivar, ahoraMs: number,
): Record<string, unknown> {
  const campos: Record<string, unknown> = { telefonoTrozos: trozosDeTelefono(m.telefono) };
  const nombrePalabras = palabrasDe(m.nombreContacto, MAX_PALABRAS_CONSULTA);
  if (nombrePalabras.length) campos['nombrePalabras'] = nombrePalabras;

  if (m.direccion === 'entrante') {
    if (typeof ahoraMs === 'number' && Number.isFinite(ahoraMs)) {
      campos['ultimoEntranteEn'] = Timestamp.fromMillis(ahoraMs);
      campos['ventanaVenceEn'] = Timestamp.fromMillis(ahoraMs + VENTANA_HORAS * HORA_MS);
    }
    campos['noLeidos'] = FieldValue.increment(1);
    campos['sinLeer'] = true;
  }
  return campos;
}

/**
 * Los campos derivados del documento del mensaje: `tenantId` (siempre, igual al
 * de la ruta; es lo que acota la búsqueda por palabra entre comercios) y
 * `palabras` (hasta 30; se omite si el texto no deja ninguna). El relleno NO
 * toca los mensajes ya guardados: se indexa desde ahora (D9).
 */
export function camposDeMensajeIndexado(
  texto: unknown, tenantId: string,
): { tenantId: string; palabras?: string[] } {
  const palabras = palabrasDe(texto, MAX_PALABRAS_POR_MENSAJE);
  return palabras.length ? { tenantId, palabras } : { tenantId };
}
