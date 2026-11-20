/**
 * LA ÚNICA LISTA de comercios que los scripts de Plataforma no tocan sin una orden expresa de Andres
 * (regla del proyecto). Antes `fijar-flujos.mjs` y `cambiar-correo-logica.mjs` llevaban cada uno su copia.
 * Cada script conserva su forma de comparar (prefijo o «contiene»), que no cambia.
 * `aplicar-consola-conversaciones.mjs` tiene su propia lista (`TENANTS_EXCLUIDOS`, solo Bellido, con su
 * historia en el encabezado) y no se unifica aquí: es una decisión distinta y cambiarla cambiaría su conducta.
 */
export const COMERCIOS_NO_TOCADOS = Object.freeze(['bellido', 'platinum']);
