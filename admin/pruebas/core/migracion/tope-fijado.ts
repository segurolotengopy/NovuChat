/**
 * EL TECHO DE LAS EXCEPCIONES DE LA MIGRACIÓN, fijado aparte para que un tope no suba en silencio: subir `TOPE` en `excepciones.ts` obliga
 * a tocar TAMBIÉN este archivo (la prueba exige `TOPE <= TOPE_MAXIMO` y `ALTA === ALTA_FIJADA`). Constantes LITERALES, a propósito.
 *
 * ATENCIÓN: cambiar cualquiera de las dos constantes exige pasar por el agente `seguridad` y una decisión escrita de Andres.
 * Bajar `TOPE_MAXIMO` cuando baje el tope real es lo esperado.
 */
export const ALTA_FIJADA = '2026-11-12';
export const TOPE_MAXIMO = 98;
