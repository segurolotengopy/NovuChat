import { crearRegistrarCierre, type GanchosDelCierre } from './core/turno/cierres.js';
import { SOLICITUD_AL_CIERRE } from './modulos/agenda/alCierre.js';
import { COBRO_AL_CIERRE } from './modulos/cobros/alCierre.js';
import { nombreDeProductoApto } from './modulos/productos/nombreSeguro.js';
import { crearAprobarTerminoProducto } from './plataforma/aprobarTerminoProducto.js';
import { crearQuitarUsuario } from './central/usuarios.js';
import { crearBajaTenant, crearSuspenderTenant } from './plataforma/tenants.js';
import { revocarEditorAlQuitarUsuario, revocarEditoresAlCerrarTenant } from './modulos/crm/editoresCrm.js';

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

/**
 * TÉRMINOS DE PRODUCTO REGISTRADOS (PR 3): la decisión del propietario valida el nombre del ítem con el
 * predicado de Productos. Plataforma no importa de módulos (`plataforma/aprobarTerminoProducto.ts` recibe
 * el predicado), así que lo une este archivo, el único que conoce a las dos zonas. Un puerto: no hay registro.
 */
export const aprobarTerminoProducto = crearAprobarTerminoProducto(nombreDeProductoApto);

/**
 * QUITAR USUARIO + EDICIÓN DEL miniCRM (03/11/2026): al quitar a una persona se revoca su permiso de edición de la
 * hoja. Central no importa módulos (`central/usuarios.ts` recibe el gancho), así que lo une este archivo.
 */
export const quitarUsuario = crearQuitarUsuario(revocarEditorAlQuitarUsuario());

/**
 * BAJA Y SUSPENSIÓN + EDICIÓN DEL miniCRM (03/11/2026): al dar de baja o suspender un negocio se revoca a TODOS sus
 * editores de la hoja. Plataforma no importa módulos (`plataforma/tenants.ts` recibe el gancho), así que lo une este archivo.
 */
export const bajaTenant = crearBajaTenant(revocarEditoresAlCerrarTenant());
export const suspenderTenant = crearSuspenderTenant(revocarEditoresAlCerrarTenant());
