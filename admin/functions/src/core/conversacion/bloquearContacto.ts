/**
 * =============================================================================
 * BLOQUEAR UN CONTACTO — `bloquearContacto` y `desbloquearContacto` (CORE)
 * =============================================================================
 *
 * Pedido de Andres (31/10/2026), opción A: el asistente deja de responderle del todo a un contacto,
 * y se puede revertir. El dato es `bloqueada: true` en la conversación (más `bloqueadaPor`, el uid de
 * quien lo decidió, y `bloqueadaEn`). Lo escribe SOLO el servidor, desde acá: las reglas de Firestore
 * le niegan el campo a la persona del negocio y al token de ingesta.
 *
 * ENTRADA   `{tenantId, conversacionId}` (`conversacionId` = `wa_<teléfono>`), como tomar y devolver.
 * SALIDA    `{bloqueada: boolean}`: cómo quedó la conversación.
 *
 * LAS MISMAS GUARDAS QUE TOMAR (`atenderTurno`): sesión, rol del token en ESE comercio, forma del id,
 * comercio activo y habilitado (`consolaConversaciones === 'nueva'`, no Bellido) y el tope por usuario.
 * Dos diferencias, a propósito:
 *  - NO exige `personaPuedeEscribir`: bloquear no envía nada por el número, así que no depende de que
 *    la salida de persona esté publicada.
 *  - SOLO el administrador. Bloquear le quita la respuesta a un cliente de verdad; es decisión de quien
 *    administra el comercio, no de una operadora. (Si Andres quiere ampliarlo a `oper`, es quitar la
 *    comparación `c.rol !== 'admin'` de `exigirAdministrador`.)
 *
 * QUÉ HACE EL BLOQUEO (la compuerta está en `ingesta.ts` y `configuracionFlujo`, no acá):
 *  - SILENCIO TOTAL: el asistente no responde y NO se avisa a recepción ni al contacto. Se devuelve
 *    `atencion.estado = 'bloqueado'` con aviso vacío, que es lo que los flujos ya obedecen (igual que
 *    con la pausa de una persona).
 *  - UN MENSAJE DE UN CONTACTO BLOQUEADO NO CUENTA para el plan: no abre conversación, no suma al
 *    bloque de 25, no toca `mensajesVentana`, métricas, umbrales, bolsa ni corte. Se guarda el mensaje y
 *    lo mínimo para listarlo (que la persona del comercio vea que escribió). Alcance exacto en
 *    `docs/arquitectura/conversaciones.md`.
 *
 * COMPATIBILIDAD CON TOMAR: `tomarConversacion` y `enviarComoPersona` rechazan una conversación bloqueada
 * (`failed-precondition`, sin escribir) y `bloquear` rechaza si hay un turno de persona vigente. Devolver sigue permitido.
 *
 * UNA TRANSACCIÓN lee la conversación, decide y escribe el campo y la auditoría `bloquear_contacto` /
 * `desbloquear_contacto` (falla cerrada y atómica, `turnoServidor.ts`; solo `telefono4`, nunca el id
 * entero). IDEMPOTENTES: bloquear lo ya bloqueado (o desbloquear lo que no lo está) devuelve el estado
 * sin escribir ni auditar. NO toca `turno`, `atencionEstado`, `noContactar` ni el conteo.
 *
 * LO QUE NO HACE, y queda dicho: no apaga seguimientos ni campañas (eso lo hace `noContactar`; si se
 * quiere que bloquear lo encienda, es otro cambio) y no cierra la conversación a la consola: sigue
 * apareciendo en la lista.
 *
 * COSTO por cambio efectivo: lecturas de la ficha, del tope y de la conversación; escrituras del tope,
 * de la conversación y de la auditoría. Cero mensajes por conversación (los quita).
 */
import { onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  atenderTurno, auditarEnTransaccion, errorDeTurno, opcionesDeTurno, type ContextoDeTurno,
} from './turnoServidor.js';
import { estaBloqueada } from './pausa.js';
import { turnoEfectivo } from './turno.js';

export interface SalidaDeBloqueo { bloqueada: boolean }

function exigirAdministrador(c: ContextoDeTurno): void {
  if (c.rol !== 'admin') throw errorDeTurno('sinPermiso');
}

/** La transacción de bloquear (exportada para las pruebas). */
export async function bloquear(c: ContextoDeTurno): Promise<SalidaDeBloqueo> {
  exigirAdministrador(c);
  return c.db.runTransaction(async (tx) => {
    const snap = await tx.get(c.ref);
    if (!snap.exists) throw errorDeTurno('noExiste');
    if (estaBloqueada(snap.get('bloqueada'))) return { bloqueada: true };
    // Con el turno de una persona VIGENTE no se bloquea (ella estaría escribiéndole a un contacto bloqueado):
    // primero se devuelve la conversación. Devolver sigue permitido en todo caso.
    const { veredicto } = turnoEfectivo(snap.get('turno'), { ultimoEntranteEn: snap.get('ultimoEntranteEn') }, c.ahoraMs);
    if (veredicto.motivo === 'tomado') throw errorDeTurno('turnoVigente');
    tx.update(c.ref, { bloqueada: true, bloqueadaPor: c.uid, bloqueadaEn: Timestamp.fromMillis(c.ahoraMs) });
    auditarEnTransaccion(tx, c, 'bloquear_contacto');
    return { bloqueada: true };
  });
}

/** La transacción de desbloquear (exportada para las pruebas). */
export async function desbloquear(c: ContextoDeTurno): Promise<SalidaDeBloqueo> {
  exigirAdministrador(c);
  return c.db.runTransaction(async (tx) => {
    const snap = await tx.get(c.ref);
    if (!snap.exists) throw errorDeTurno('noExiste');
    if (!estaBloqueada(snap.get('bloqueada'))) return { bloqueada: false };
    tx.update(c.ref, { bloqueada: FieldValue.delete(), bloqueadaPor: FieldValue.delete(), bloqueadaEn: FieldValue.delete() });
    auditarEnTransaccion(tx, c, 'desbloquear_contacto');
    return { bloqueada: false };
  });
}

export const bloquearContacto = onCall(opcionesDeTurno(process.env), (p: CallableRequest) =>
  atenderTurno('bloquearContacto', p, bloquear));
export const desbloquearContacto = onCall(opcionesDeTurno(process.env), (p: CallableRequest) =>
  atenderTurno('desbloquearContacto', p, desbloquear));
