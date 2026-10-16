/**
 * =============================================================================
 * DEVOLVER UNA CONVERSACIÓN AL ASISTENTE — `devolverConversacion` (CORE)
 * =============================================================================
 *
 * H2 (contrato único del 16/10/2026, §2). La persona que tiene la conversación (o un administrador
 * del comercio) la devuelve: desde ese momento vuelve a responder el asistente.
 *
 * ENTRADA   `{tenantId, conversacionId}`. SALIDA `{turno}` como en `tomarConversacion`, o
 *           `{turno: null}` si la conversación nunca tuvo un turno legible.
 *
 * LO QUE GARANTIZA, cada línea con una prueba que la niega (`pruebas/core/turno-conversacion.test.ts`):
 *
 *  - Quién llama y la habilitación: las mismas que para tomar (`accesoPersona.ts`).
 *  - Solo QUIEN LA TIENE o un ADMINISTRADOR del comercio. Un operador que no es quien la tiene
 *    recibe `failed-precondition` con el uid de quien sí en `details.tomadoPor`. El administrador que
 *    la devuelve por otro deja su propio uid en la auditoría y el de quien la tenía en `tomadoPor`.
 *  - IDEMPOTENTE: devolver lo que nadie tiene (sin turno, ya devuelto, ilegible) o lo que ya venció
 *    por inactividad o por la ventana devuelve el estado de HOY sin escribir ni auditar. Un
 *    vencimiento no lo persiste esta callable: lo calcula `turnoVigente` cada vez que hace falta y
 *    lo escribirá la ingesta al llegar el siguiente mensaje (H2-3); quien lea el documento a mano
 *    debe aplicar la misma regla, no fiarse de `turno.responde` solo.
 *  - Una transacción escribe el turno (`responde:'asistente'`, `devueltoEn`, `motivoDevolucion:
 *    'manual'`, conservando quién la tomó y cuándo) y la auditoría `conversacion_devuelta`, o
 *    ninguna (falla cerrada). Dos devoluciones a la vez: una escribe, la otra encuentra lo hecho.
 *
 * Mismo tope por usuario que tomar (60 por hora y 300 por día). Cero mensajes por conversación.
 */
import { onCall, type CallableRequest } from 'firebase-functions/v2/https';
import {
  atenderTurno, auditarEnTransaccion, errorDeTurno, opcionesDeTurno, turnoAFirestore,
  type ContextoDeTurno, type SalidaDeTurno,
} from './turnoServidor.js';
import { turnoEfectivo, type Turno } from './turno.js';

/** La transacción de la devolución (exportada para las pruebas). */
export async function devolver(c: ContextoDeTurno): Promise<SalidaDeTurno> {
  return c.db.runTransaction(async (tx) => {
    const snap = await tx.get(c.ref);
    if (!snap.exists) throw errorDeTurno('noExiste');
    const { veredicto, turno } = turnoEfectivo(snap.get('turno'), { ultimoEntranteEn: snap.get('ultimoEntranteEn') }, c.ahoraMs);

    // Nadie la tiene ahora (nunca se tomó, ya se devolvió, venció, o el dato está roto): nada que hacer.
    if (veredicto.motivo !== 'tomado' || turno === null) return { turno };

    if (turno.tomadoPor !== c.uid && c.rol !== 'admin') throw errorDeTurno('noEsSuya', { tomadoPor: turno.tomadoPor });

    const nuevo: Turno = { ...turno, responde: 'asistente', devueltoEn: c.ahoraMs, motivoDevolucion: 'manual' };
    tx.update(c.ref, { turno: turnoAFirestore(nuevo) });
    auditarEnTransaccion(tx, c, 'conversacion_devuelta', { tomadoPor: turno.tomadoPor });
    return { turno: nuevo };
  });
}

export const devolverConversacion = onCall(opcionesDeTurno(process.env), (p: CallableRequest) =>
  atenderTurno('devolverConversacion', p, devolver));
