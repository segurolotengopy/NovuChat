/**
 * LÍNEA DE BASE DE LAS PRUEBAS CON MOTOR (axe-core) DE LA CONSOLA (13/11/2026): SOLO PUEDE BAJAR.
 *
 * Lista CERRADA de lo que axe-core encontró al darla de alta en las ocho pantallas de `paginas.ts`. Clave:
 * `<id de página>#<regla de axe>` (violaciones) o `<id de página>#<regla de axe>:incompleta` (axe no pudo decidir: cuenta igual);
 * valor: cuántos nodos. El CI falla ante algo NUEVO y también cuando la base sobra (se arregló y no se bajó). Cómo:
 * docs/arquitectura/accesibilidad-consola.md.
 *
 * ATENCIÓN: subir `ALTA_MOTOR`, `TOPE_MOTOR` o una cuenta exige pasar por el agente `seguridad` y una decisión escrita de Andres
 * (ver `tope-fijado.ts`).
 */
export const ALTA_MOTOR = '2026-11-13';

export const LINEA_DE_BASE_MOTOR: Readonly<Record<string, number>> = {
  'cobros#aria-prohibited-attr:incompleta': 1,
  'configuracion#aria-prohibited-attr:incompleta': 1,
  'consumo#aria-prohibited-attr:incompleta': 1,
  'conversaciones#aria-prohibited-attr:incompleta': 1,
  'conversaciones#bypass:incompleta': 1,
  'pagar#aria-prohibited-attr:incompleta': 1,
  'tablero#aria-prohibited-attr:incompleta': 1,
};

/** Total de nodos admitidos. Solo baja. */
export const TOPE_MOTOR = 7;

/** Desglose por regla (suma `TOPE_MOTOR`). Solo baja. */
export const TOPE_MOTOR_POR_REGLA: Readonly<Record<string, number>> = {
  'aria-prohibited-attr:incompleta': 6,
  'bypass:incompleta': 1,
};
