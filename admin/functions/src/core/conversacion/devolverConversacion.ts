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
 *  - IDEMPOTENTE: devolver lo que nadie tiene (sin turno, ya devuelto, ilegible) devuelve el estado
 *    de HOY sin escribir ni auditar.
 *  - Si el turno YA VENCIÓ (inactividad o ventana) y el documento sigue en «persona», se PERSISTE
 *    devuelto (`responde:'asistente'`, `devueltoEn` = cuándo venció, `motivoDevolucion`) y se audita
 *    `conversacion_devuelta` con ese `motivo`, en la misma transacción, para que la consola no se
 *    quede en «Responde una persona». Cualquiera de las dos personas del comercio puede dispararlo.
 *  - La auditoría guarda `tomadoPor` (uid opaco de una persona del MISMO comercio, necesario para
 *    saber a quién se la quitó un administrador) y NUNCA el id de conversación entero: solo
 *    `telefono4`, los últimos 4 dígitos.
 *  - Una transacción escribe el turno (`responde:'asistente'`, `devueltoEn`, `motivoDevolucion:
 *    'manual'`, conservando quién la tomó y cuándo) y la auditoría `conversacion_devuelta`, o
 *    ninguna (falla cerrada). Dos devoluciones a la vez: una escribe, la otra encuentra lo hecho.
 *
 * Mismo tope por usuario que tomar (60 por hora y 300 por día). Cero mensajes por conversación.
 */
import { onCall, type CallableRequest } from 'firebase-functions/v2/https';
import {
  atenderTurno, auditarEnTransaccion, errorDeTurno, opcionesDeTurno, persistirVencimiento, turnoAFirestore,
  type ContextoDeTurno, type SalidaDeTurno,
} from './turnoServidor.js';
import { turnoEfectivo, type Turno } from './turno.js';

/** La transacción de la devolución (exportada para las pruebas). */
export async function devolver(c: ContextoDeTurno): Promise<SalidaDeTurno> {
  return c.db.runTransaction(async (tx) => {
    const snap = await tx.get(c.ref);
    if (!snap.exists) throw errorDeTurno('noExiste');
    const { veredicto, turno } = turnoEfectivo(snap.get('turno'), { ultimoEntranteEn: snap.get('ultimoEntranteEn') }, c.ahoraMs);

    // Venció por inactividad o ventana y el documento sigue diciendo «persona»: se PERSISTE devuelto
    // (y se audita con el motivo) para que el oyente de la consola vea el cambio.
    persistirVencimiento(tx, c, veredicto, turno, snap.get('turno'));
    // Nadie la tiene ahora (nunca se tomó, ya se devolvió, venció —y arriba se persistió— o el dato está roto).
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
