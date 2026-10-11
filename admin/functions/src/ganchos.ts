import { crearRegistrarCierre, type GanchosDelCierre } from './core/turno/cierres.js';
import { SOLICITUD_AL_CIERRE } from './modulos/agenda/alCierre.js';
import { COBRO_AL_CIERRE } from './modulos/cobros/alCierre.js';

/**
 * =============================================================================
 * LOS GANCHOS DEL CIERRE: el único archivo que une Core con los módulos
 * =============================================================================
 *
 * `core/turno/cierres.ts` (Core) no importa nada de un módulo: define el contrato
 * (`GanchosDelCierre`) y el recorrido, y recibe los ganchos ya armados. Quien los
 * arma es este archivo, que es coordinador (la zona que puede conocer a todas,
 * junto con `ingesta.ts`): importa el gancho de Cobros y el de Agenda y se los
 * entrega a `crearRegistrarCierre`.
 *
 * ES UNA LISTA CERRADA DE DOS PUERTOS, no un registro global al que cada módulo
 * se apunta. Un registro mutable tiene un fallo silencioso: si un módulo no se
 * importa (alguien lo saca del índice, o cambia el orden de los imports), el
 * cierre sigue funcionando y deja de cerrar la solicitud, y el barrido de
 * seguimientos le escribe a quien ya agendó. Aquí olvidar un puerto no compila
 * (`satisfies GanchosDelCierre`), y si llegara vacío en ejecución,
 * `crearRegistrarCierre` lanza al cargar. Que el endpoint recorra los módulos
 * ENCENDIDOS del tenant en el orden del registro es F3b-2, y exige
 * `tenants.modulos`.
 *
 * F3b-1b (05/10/2026): hasta aquí `cierres.ts` importaba `solicitudTras` y
 * `cierreDeVentaLoHaceElCotejo` de `ingesta.ts`, el último cruce de la deuda de
 * `fronteras.test.ts`.
 */
export const GANCHOS_DEL_CIERRE = {
  cobro: COBRO_AL_CIERRE,
  solicitud: SOLICITUD_AL_CIERRE,
} satisfies GanchosDelCierre;

/** El endpoint de los cierres: el nombre, las opciones y los secretos de siempre, con los ganchos de los módulos. */
export const registrarCierre = crearRegistrarCierre(GANCHOS_DEL_CIERRE);
