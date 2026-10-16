/**
 * =============================================================================
 * LA PAUSA DEL ASISTENTE, DECIDIDA POR EL SERVIDOR (CORE, H2-2)
 * =============================================================================
 *
 * Contrato único de H2 (16/10/2026), §3. Cuando una persona del comercio tomó una conversación
 * (`turno.responde === 'persona'`, vigente), el asistente calla. La decisión la toman DOS
 * Functions con la misma regla (`turnoVigente`, de `turno.ts`): la `ingesta` (que reporta el
 * mensaje entrante y le contesta a n8n) y `configuracionFlujo` (que n8n llama al empezar el
 * turno). Los flujos ya callan con `bloqueado` y aviso vacío: no hace falta volver a publicarlos.
 *
 * QUÉ SE DEVUELVE CON PAUSA: `estado: 'bloqueado'`, `avisarRecepcion: ''` y `pausadoPorPersona:
 * true` (junto a `avisarRecepcion`). NO se escribe `bloqueado` en `atencionEstado`: ese campo es
 * de los umbrales 50/100, alimenta el filtro «Necesita humano» y el índice; la pausa es otra
 * cosa y se calcula en cada mensaje.
 *
 * FALLA HACIA RESPONDER. Un turno ilegible, con fechas rotas o del futuro, sin `ultimoEntranteEn`
 * o ya vencido, NO pausa: responde el asistente («ante la duda, normal», como en `turno.ts`).
 * De esos, solo se PERSISTE (devolución y auditoría) un vencimiento real, con `venceEnMs`
 * calculable (inactividad o ventana). Un turno ilegible, o sin `ultimoEntranteEn` (dato anómalo,
 * la ventana no se puede calcular), responde el asistente y NO escribe nada.
 * Durante la pausa el aviso de transición de umbral a recepción se anula (`avisarRecepcion: ''`)
 * y al devolver la conversación no se reenvía (aceptado).
 * El riesgo residual (una ventana de 5 a 20 s entre que se lee el estado y el modelo contesta,
 * en la que la persona puede tomar la conversación) lo cubre `enviarComoPersona` (H2-3) con un
 * bloqueo de envío tras un entrante sin responder; no se resuelve acá.
 *
 * EL VENCIMIENTO SE PERSISTE, SIN LECTURAS EXTRA. Si el turno vigente cae en `inactividad` o
 * `ventana`, la ingesta lo deja escrito como devuelto (`turnoEfectivo`) dentro de la transacción
 * que ya tiene, y lo audita (mismo criterio que `persistirVencimiento` de H2-1: acción
 * `conversacion_devuelta`, solo `telefono4`, nunca el teléfono ni el id de la conversación).
 * La conversación ya se leyó; esto no agrega ninguna lectura ni ningún mensaje.
 */
import { type DocumentReference, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { leerTurno, turnoEfectivo, type Turno, type Veredicto } from './turno.js';
import { escribirDevolucion } from './turnoServidor.js';

export interface DecisionDePausa {
  /** `true` si responde una persona y el turno sigue vigente: el asistente calla. */
  pausada: boolean;
  veredicto: Veredicto;
  /** El turno ya devuelto por vencimiento, solo si hay que PERSISTIRLO; si no, `null`. */
  porPersistir: Turno | null;
}

/** Decide la pausa con el campo `turno` y el `ultimoEntranteEn` de ANTES del mensaje que llega. */
export function decidirPausa(turno: unknown, ultimoEntranteEn: unknown, ahoraMs: number): DecisionDePausa {
  const { veredicto, turno: efectivo } = turnoEfectivo(turno, { ultimoEntranteEn }, ahoraMs);
  const lectura = leerTurno(turno);
  const vencio = veredicto.motivo === 'inactividad' || veredicto.motivo === 'ventana';
  // Sin `venceEnMs` (turno sin `ultimoEntranteEn`: dato anómalo) no se persiste nada.
  const porPersistir = vencio && veredicto.venceEnMs !== undefined && efectivo !== null && lectura.estado === 'ok' && lectura.turno.responde === 'persona'
    ? efectivo : null;
  return { pausada: veredicto.responde === 'persona', veredicto, porPersistir };
}

/**
 * Escribe, dentro de la transacción de la ingesta, el turno devuelto por vencimiento y su
 * auditoría. Va DESPUÉS de todas las lecturas de la transacción (Firestore exige las lecturas
 * primero). Sin nada por persistir, no hace nada.
 */
export function persistirVencimientoDeIngesta(
  tx: Transaction, db: Firestore, tenantId: string, refConversacion: DocumentReference, idConversacion: string,
  decision: DecisionDePausa, ahoraMs: number,
): void {
  const efectivo = decision.porPersistir;
  if (efectivo === null) return;
  escribirDevolucion(tx, {
    db, tenantId, ref: refConversacion, conversacionId: idConversacion,
    actor: { uid: 'ingesta', rol: 'ingesta' }, ahoraMs,
  }, efectivo, decision.veredicto.motivo);
}

/**
 * El estado de atención mostrado: `bloqueado` si lo pide la pausa o ya lo era por umbral. Con
 * pausa, el aviso fijo del estado `operador` (`mensajeFijo`) también se anula: nadie lo manda.
 */
export function conPausa<T extends { estado: string }>(atencion: T, pausada: boolean): T {
  if (!pausada) return atencion;
  return { ...atencion, estado: 'bloqueado', ...('mensajeFijo' in atencion ? { mensajeFijo: null } : {}) };
}
