/**
 * Los pagos del prepago (A-1, `pagos.ts`) con el cobrador (A-2) enchufado.
 *
 * La carga manual y la anulación anulan el QR vivo EN EL COBRADOR antes de tocar
 * nada, y la consulta de la consola le pregunta al cobrador por la referencia.
 * Vive aparte de `pagos.ts` para que `pagos.ts` no dependa de `cobroPrepago.ts`
 * (que ya depende de él), y aparte de `index.ts` para poder probarlo sin
 * inicializar Firebase dos veces.
 *
 * Sin cobrador configurado —así queda el despliegue hasta los pasos de nube—
 * se usa la anulación local de A-1, que NO anula ningún pago que haya pasado por
 * el cobrador (aunque le falte el id), y no se consulta.
 */
import { crearRegistrarPagoManual, crearAnularPagoPendiente, crearConsultarPagoPendiente, anularPendienteLocal, type Deps } from './pagos.js';
import { anularCobroVivo, consultarYAplicar } from './cobroPrepago.js';
import { COBRADOR_TOKEN, cobradorDisponible } from './cobrador.js';

export const conCobrador: Deps = {
  anular: async (tenantId, pagoId, motivo) =>
    (await cobradorDisponible())
      ? anularCobroVivo(tenantId, pagoId, motivo)
      : anularPendienteLocal(tenantId, pagoId, motivo),
  consultar: async (tenantId, pagoId) =>
    (await cobradorDisponible()) ? consultarYAplicar(tenantId, pagoId, { via: 'consulta' }) : null,
};

// El secreto se declara acá y no en pagos.ts: sin declararlo, `COBRADOR_TOKEN.value()`
// llega vacío en producción y estas tres Functions fallarían con el cobrador ya
// configurado (revisión de seguridad, 22/09).
const conSecreto = { secrets: [COBRADOR_TOKEN] };
export const registrarPagoManual = crearRegistrarPagoManual(conCobrador, conSecreto);
export const anularPagoPendiente = crearAnularPagoPendiente(conCobrador, conSecreto);
export const consultarPagoPendiente = crearConsultarPagoPendiente(conCobrador, conSecreto);
