import type { GanchoDeSolicitudAlCierre } from '../../core/turno/cierres.js';
import { solicitudTras } from './solicitud.js';

/**
 * =============================================================================
 * LO QUE AGENDA APORTA AL CIERRE (`registrarCierre`)
 * =============================================================================
 *
 * Un cierre tipo `cita` o `venta` con teléfono marca la `solicitud` de esa
 * conversación como `agendada` (es lo que saca a ese paciente del barrido de
 * seguimientos: «nunca a quien ya agendó»). La decisión de QUÉ solicitud queda es
 * `solicitudTras(previa, 'cita_agendada', ahoraMs, { cobroReal })`: pura, de
 * Agenda, y la única forma en que este módulo toca el cierre. Core la llama
 * dentro de su transacción, con la solicitud previa, y ESCRIBE lo que devuelva
 * (`null` = no se toca): el gancho no ve ni la `Transaction` ni `db`.
 *
 * F3b-1b (05/10/2026): antes `cierres.ts` importaba `solicitudTras` de
 * `ingesta.ts`; ahora lo recibe inyectado desde `ganchos.ts`. Si este gancho
 * faltara, un cierre dejaría de cerrar la solicitud en silencio y el barrido de
 * seguimientos le escribiría a quien ya agendó: por eso el contrato lo exige
 * (no compila sin él y lanza al cargar).
 */
export const SOLICITUD_AL_CIERRE: GanchoDeSolicitudAlCierre = {
  solicitudTrasElCierre(previa, ahoraMs, datos) {
    return solicitudTras(previa, 'cita_agendada', ahoraMs, { cobroReal: datos.cobroReal });
  },
};
