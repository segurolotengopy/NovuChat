/**
 * =============================================================================
 * TOMAR UNA CONVERSACIÓN — `tomarConversacion` (CORE)
 * =============================================================================
 *
 * H2 (contrato único del 16/10/2026, §2). Una persona del comercio toma una conversación: desde
 * ese momento el asistente calla (la pausa la decide el servidor, §3 del contrato, con
 * `turnoVigente`) hasta que ella la devuelve, pasan 30 minutos sin actividad suya, o se cierra la
 * ventana de 24 horas de Meta.
 *
 * ENTRADA   `{tenantId, conversacionId}` (`conversacionId` = `wa_<teléfono>`). El servidor ignora
 *           cualquier otra clave y NUNCA recibe una ruta: la arma bajo el comercio pedido.
 * SALIDA    `{turno}`: `{responde, tomadoPor, tomadoEn, actividadPersonaEn, devueltoEn?,
 *           motivoDevolucion?}` con los tiempos en milisegundos desde 1970.
 *
 * LO QUE GARANTIZA, cada línea con una prueba que la niega (`pruebas/core/turno-conversacion.test.ts`):
 *
 *  - Quién llama: administrador u operador de ESE comercio, comercio activo, habilitado en el
 *    servidor (bandera `nueva`, no Bellido). El soporte no. Ver `accesoPersona.ts`.
 *  - UNA transacción lee la conversación, decide y escribe el turno y la auditoría `conversacion_tomada`
 *    (falla cerrada y atómica: ver `turnoServidor.ts`). Dos personas que toman a la vez: gana una; la
 *    otra recibe `failed-precondition` y, en `details.tomadoPor`, el uid de quien la tiene.
 *  - IDEMPOTENTE para la misma persona: tomar lo que ya se tiene (vigente) devuelve el turno sin
 *    escribir ni auditar.
 *  - Un turno VENCIDO (inactividad o ventana) o devuelto no estorba: otra persona, o la misma, puede
 *    tomarla. El turno ilegible se repara (se sobrescribe), no queda atascado.
 *  - Se necesita la ventana de 24 h ABIERTA (`ultimoEntranteEn`, sin dato = cerrada): H2 es texto
 *    dentro de la ventana, y un turno que nace vencido sería una toma que no hace nada. Fuera de la
 *    ventana: `failed-precondition`. Cuando H3 traiga la plantilla fuera de ventana, esta comprobación
 *    se revisa.
 *  - Tope por usuario: 60 por hora y 300 por día (`turnoServidor.ts`).
 *
 * NO HACE: no escribe `necesitaHumano` (es del evento `transferido`, en otro PR), no marca la
 * conversación como leída, no toca `atencionEstado`, el conteo de 25, `mensajesVentana` ni los
 * umbrales. Cero mensajes por conversación.
 *
 * TOMAR DOS VECES NO RENUEVA `actividadPersonaEn`: la repetición idempotente no escribe nada. Lo
 * renueva enviar un mensaje (H2-2); quien quiera más de 30 minutos escribe.
 * Un turno ajeno VENCIDO que se encuentra al tomar se reemplaza por el nuevo (auditoría con `previo`);
 * si la ventana está cerrada y no se puede tomar, el vencido se persiste devuelto antes de rechazar.
 *
 * COSTO por toma efectiva: lecturas de la ficha, del tope y de la conversación; escrituras del tope,
 * de la conversación (`turno`) y de la auditoría. Una repetición idempotente: solo el tope.
 */
import { onCall, type CallableRequest } from 'firebase-functions/v2/https';
import {
  atenderTurno, auditarEnTransaccion, errorDeTurno, opcionesDeTurno, persistirVencimiento, turnoAFirestore,
  type ContextoDeTurno, type SalidaDeTurno,
} from './turnoServidor.js';
import { turnoEfectivo, ventanaDeMetaAbierta, type Turno } from './turno.js';

/** La transacción de la toma (exportada para las pruebas). */
export async function tomar(c: ContextoDeTurno): Promise<SalidaDeTurno> {
  const r = await c.db.runTransaction<SalidaDeTurno & { cerrada?: true }>(async (tx) => {
    const snap = await tx.get(c.ref);
    if (!snap.exists) throw errorDeTurno('noExiste');
    const ultimoEntranteEn: unknown = snap.get('ultimoEntranteEn');
    const { veredicto, turno } = turnoEfectivo(snap.get('turno'), { ultimoEntranteEn }, c.ahoraMs);

    if (veredicto.motivo === 'tomado' && turno !== null) {
      if (turno.tomadoPor === c.uid) return { turno }; // idempotente: ya es suya
      throw errorDeTurno('ocupada', { tomadoPor: turno.tomadoPor });
    }
    if (!ventanaDeMetaAbierta(ultimoEntranteEn, c.ahoraMs)) {
      // Con la ventana cerrada no se toma, pero un turno ajeno ya vencido se deja devuelto: el error
      // se lanza DESPUÉS de confirmar (lanzar adentro deshace la escritura).
      persistirVencimiento(tx, c, veredicto, turno, snap.get('turno'));
      return { turno: null, cerrada: true };
    }

    const nuevo: Turno = { responde: 'persona', tomadoPor: c.uid, tomadoEn: c.ahoraMs, actividadPersonaEn: c.ahoraMs };
    tx.update(c.ref, { turno: turnoAFirestore(nuevo) });
    auditarEnTransaccion(tx, c, 'conversacion_tomada', { previo: veredicto.motivo });
    return { turno: nuevo };
  });
  if (r.cerrada) throw errorDeTurno('ventanaCerrada');
  return { turno: r.turno };
}

export const tomarConversacion = onCall(opcionesDeTurno(process.env), (p: CallableRequest) =>
  atenderTurno('tomarConversacion', p, tomar));
