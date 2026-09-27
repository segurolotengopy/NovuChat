/**
 * REGIÓN DE TODAS LAS FUNCIONES.
 *
 * Tiene que ser LA MISMA que la de la base de Firestore. No es una preferencia:
 * un disparador `onDocumentWritten` en otra región no llega a desplegarse,
 * porque el evento lo entrega Eventarc desde donde vive la base.
 *
 * `us-east1` es la región estándar de Andres, y la base se creó ahí. La latencia
 * contra Bolivia no decide esto: a Firestore no lo consulta el teléfono del
 * cliente sino esta función, así que lo que pesa es que la función y la base
 * estén juntas, no dónde están las dos respecto de La Paz.
 *
 * Vive en su propio módulo, y no en `index.ts`, para no crear un ciclo de
 * importación: `index.ts` importa la ingesta y los reclamos, así que si la
 * constante viviera ahí, ellos tendrían que importar a su propio importador. En
 * ESM eso puede resolverse en un orden en el que la constante todavía no está
 * inicializada, y falla en tiempo de ejecución, no de compilación.
 */
export const REGION = 'us-east1';
