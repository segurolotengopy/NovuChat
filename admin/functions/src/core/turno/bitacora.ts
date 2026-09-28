/**
 * La bitácora del comercio: `registrar` escribe un evento en
 * `tenants/{id}/bitacora` y `enmascarar` deja el teléfono con el patrón que
 * exige la regla. Es Core: todo tenant registra igual y ningún módulo lo
 * configura. Salió de `ingesta.ts` en el corte C1 de F2 sin cambiar una línea,
 * para que Central y los módulos no importen del coordinador (decisión de la
 * revisora, 28/09). Lo que es de la solicitud (`solicitudTras`,
 * `ETAPAS_PENDIENTES`, `Solicitud`…) sigue en la ingesta hasta F3b.
 */
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

/**
 * Enmascara un teléfono para la bitácora: `59170000001` -> `5917****001`.
 *
 * La regla de Firestore EXIGE el patrón con asteriscos, así que un número
 * completo se rechaza en el servidor. Esta función existe para que el camino
 * correcto sea el fácil, no para ser la única defensa: la diferencia entre
 * «acordarse de enmascarar» y no poder no hacerlo.
 */
export function enmascarar(telefono: unknown): string {
  const t = typeof telefono === 'string' ? telefono.replace(/[^0-9]/g, '') : '';
  if (t.length < 7) return '****';
  return `${t.slice(0, 4)}****${t.slice(-3)}`;
}

type TipoEvento =
  | 'mensaje_entrante' | 'mensaje_saliente' | 'plantilla_enviada'
  | 'cita_agendada' | 'cita_rechazada' | 'cobro_simulado'
  | 'transferencia_humano' | 'config_publicada' | 'suspension'
  | 'reactivacion' | 'error_flujo' | 'entrada_descartada'
  // CATÁLOGO WEB. Dos eventos, y los dos hacen falta para poder contestar la
  // pregunta que un comercio va a hacer tarde o temprano: «mandé el enlace y no
  // me llegó ningún pedido, ¿se rompió?». Con solo uno de los dos no se puede
  // distinguir «nunca se derivó a nadie» de «se derivó y nadie compró».
  | 'catalogo_enlace' | 'carrito_recibido'
  // UMBRALES DE ATENCIÓN (`Analisis/27` §5). Una ventana que pasó al operador
  // por uso extendido, y una que llegó al bloqueo. Quedan en la bitácora del
  // comercio porque son el hecho que explica un reclamo: «el asistente dejó de
  // contestarle a mi cliente».
  | 'derivacion_operador' | 'bloqueo_ventana'
  // AVISO DE CONSUMO (15/09/2026): las conversaciones del mes llegaron al 80 %
  // de las incluidas en el plan. Una vez por mes. No manda ningún WhatsApp.
  | 'aviso_consumo'
  // SEÑA POR QR (bloque 2, 17/09). Llegó un comprobante y el servidor lo
  // cotejó —`codigo` lleva el resultado: cuadra, no_cuadra, ilegible— y una
  // retención que venció sin comprobante, cuya cita el flujo borró. Los
  // escribe `sena.ts`. Son el hecho que explica «mandé el comprobante y me
  // dijeron que no coincidía» y «mi horario desapareció».
  | 'cobro_cotejado' | 'sena_vencida'
  // SEGUIMIENTO DE SOLICITUD PENDIENTE (bloque 4, `Analisis/31` §4): salió el
  // recordatorio único a un paciente que recibió horarios o el QR y no
  // siguió. `codigo` lleva el modo (`texto` en ventana, `plantilla` fuera).
  // Lo escribe `seguimientos.ts`. Explica «me llegó un mensaje que no pedí».
  //
  // NINGÚN PUNTO Y COMA EN ESTOS COMENTARIOS. `pruebas/bitacora-tipos.test.ts`
  // lee esta unión hasta el primero que encuentra, así que uno escrito acá
  // arriba corta la lista y deja tipos fuera del control que compara la
  // ingesta con las reglas y con la consola. Costó una corrida el 17/09.
  | 'seguimiento_enviado'
  // PREPAGO (bloques A-0 y A-2, 20/09, `DISENO.md` §4undecies): el servicio se
  // cortó por falta de pago o de conversaciones (`codigo` lleva el motivo),
  // volvió, y entró un pago. El corte y la reanudación los escribe la ingesta, y
  // el pago lo escriben `cobroPrepago.ts` y el camino manual, con `codigo` = quién
  // confirmó (`banco` o `propietario`). En modo observación no sale `corte_servicio`: el
  // corte observado va a la auditoría, no a la bitácora que lee el comercio.
  | 'corte_servicio' | 'reanudacion_servicio' | 'pago_registrado';

interface Evento {
  tipo: TipoEvento;
  resultado: 'ok' | 'fallo' | 'rechazado' | 'reintento';
  canal?: 'whatsapp' | 'panel' | 'sistema';
  telefono?: string;
  conversacionId?: string;
  codigo?: string;
  detalle?: string;
  tamanoTexto?: number;
  latenciaMs?: number;
}

/**
 * Escribe un evento en la bitácora del comercio.
 *
 * NUNCA EL TEXTO DEL MENSAJE. Solo metadatos. El motivo está en la cabecera de
 * la colección en `firestore.rules`: si la bitácora llevara el contenido, sería
 * una puerta trasera a lo que T-5 impide — el propietario de NovuChat leyendo
 * conversaciones de todos los comercios sin ninguna ventana de soporte.
 * `tamanoTexto` da la magnitud sin dar el contenido.
 *
 * NO FALLA LA OPERACIÓN. Si la bitácora no se puede escribir, se registra en el
 * log y se sigue: perder un renglón de evidencia es malo, pero no atender a un
 * cliente por eso es peor. La bitácora observa el sistema, no lo gobierna.
 */
export async function registrar(tenantId: string, evento: Evento): Promise<void> {
  try {
    await getFirestore().collection(`tenants/${tenantId}/bitacora`).add({
      ts: Timestamp.now(),
      tipo: evento.tipo,
      resultado: evento.resultado,
      canal: evento.canal ?? 'whatsapp',
      ...(evento.telefono ? { destinoEnmascarado: enmascarar(evento.telefono) } : {}),
      ...(evento.conversacionId ? { conversacionId: evento.conversacionId.slice(0, 80) } : {}),
      ...(evento.codigo ? { codigo: String(evento.codigo).slice(0, 24) } : {}),
      ...(evento.detalle ? { detalle: evento.detalle.slice(0, 120) } : {}),
      ...(typeof evento.tamanoTexto === 'number'
        ? { tamanoTexto: Math.max(0, Math.min(100000, Math.trunc(evento.tamanoTexto))) } : {}),
      ...(typeof evento.latenciaMs === 'number'
        ? { latenciaMs: Math.max(0, Math.min(600000, Math.trunc(evento.latenciaMs))) } : {}),
    });
  } catch {
    console.error(`No se pudo registrar en la bitacora de ${tenantId}: ${evento.tipo}`);
  }
}

