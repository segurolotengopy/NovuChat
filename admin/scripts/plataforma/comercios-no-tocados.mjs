/**
 * 21/11/2026, orden de Andres: «Quita la restricción de no se toca de Bellido». Bellido es un comercio más y sale de esta lista.
 * LA ÚNICA LISTA de comercios que los scripts de Plataforma no tocan sin una orden expresa de Andres
 * (regla del proyecto). Antes `fijar-flujos.mjs` y `cambiar-correo-logica.mjs` llevaban cada uno su copia.
 * Cada script conserva su forma de comparar (prefijo o «contiene»), que no cambia.
 * `aplicar-consola-conversaciones.mjs` tiene su propia lista (`TENANTS_EXCLUIDOS`, hoy vacía; el
 * mecanismo y la variable `NOVUCHAT_TENANTS_EXCLUIDOS` se conservan) y no se unifica aquí.
 */
export const COMERCIOS_NO_TOCADOS = Object.freeze(['platinum']);
