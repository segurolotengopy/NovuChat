/**
 * EL TECHO DE LA LÍNEA DE BASE DE ACCESIBILIDAD, fijado aparte para que un tope no suba en silencio: subir `TOPE` en `linea-de-base.ts`
 * obliga a tocar TAMBIÉN este archivo (la prueba exige `TOPE <= TOPE_MAXIMO` y `ALTA === ALTA_FIJADA`). Constantes LITERALES, a propósito.
 *
 * ATENCIÓN: cambiar cualquiera de las dos constantes exige pasar por el agente `seguridad` y una decisión escrita de Andres.
 * Bajar `TOPE_MAXIMO` cuando baje el tope real es lo esperado.
 */
export const ALTA_FIJADA = '2026-11-13';
export const TOPE_MAXIMO = 16;

/** Lo mismo para la línea de base del MOTOR (`linea-de-base-motor.ts`, pruebas con axe-core). */
export const ALTA_MOTOR_FIJADA = '2026-11-13';
export const TOPE_MOTOR_MAXIMO = 7;
