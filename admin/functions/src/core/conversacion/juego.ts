/**
 * EL JUEGO DE FUNCIONES DE CONVERSACIÓN (plan 21/11/2026): lo que el alta de un comercio enciende de una vez.
 *
 * Por qué vive en core: es lo que todo comercio corre igual, sin excepción y sin venderse en un plan. Reclamo de Andres
 * del 21/11: un comercio dado de alta debe tener TODO el juego, no uno a uno. Este archivo es la única definición de
 * los nombres y valores exactos que el servidor exige; el alta (PR2) los escribe y la prueba
 * `pruebas/core/juego-de-conversacion.test.ts` los cruza contra cada `Flujos/clientes/<t>/PROPIO.md`.
 *
 * Las 9 funciones y dónde se cumple cada una:
 *   1. texto              \
 *   2. aviso con botón     |  NÚCLEO COMÚN del flujo (se incluye desde core, no se copia): lo cubre
 *   3. baja                |  `pruebas/core/nucleo-comun.test.ts`. No tienen bandera en la ficha.
 *   4. uso extendido       |
 *   5. medios entrantes   /
 *   6. consola nueva de conversaciones   -> `consolaConversaciones === 'nueva'`   (accesoPersona.ts, habilitación)
 *   7. Tomar / salida de persona         -> `personaPuedeEscribir === true`       (turno.ts, personaPuedeEscribirDeFicha)
 *   8. adjuntos de la persona            -> `personaPuedeEnviarMedios === true`   (turno.ts, personaPuedeEnviarMediosDeFicha)
 *   9. guardado de medios                -> `guardarMedios === true`              (medios/guardarMedio.ts)
 *
 * Dos grupos, por orden de escritura:
 *  - JUEGO_DE_FICHA: se escribe en `tenants/{id}` al dar de alta; no depende de nada externo.
 *  - JUEGO_CON_INFRA: «flujo antes que bandera»: certifican que la infraestructura del número (flujo de salida
 *    publicado, alias en el secreto) ya funciona; se encienden SOLO después de verificarla.
 *
 * Todas las comparaciones son exactas (`===`): `'true'` como texto, `1` o ausente = falta.
 * Sin `import`: core no depende de nada (`Analisis/41` §1.4). Que `'nueva'` sea una pantalla válida de la consola
 * (definida en central) lo verifica la prueba desde `pruebas/`, no este archivo.
 */

export const JUEGO_DE_FICHA = Object.freeze({
  consolaConversaciones: 'nueva',
  guardarMedios: true,
} as const);

export const JUEGO_CON_INFRA = Object.freeze({
  personaPuedeEscribir: true,
  personaPuedeEnviarMedios: true,
} as const);

/** Claves del juego que faltan o no tienen el valor exacto en la ficha. Vacío = juego completo. */
export function faltanDelJuego(ficha: Readonly<Record<string, unknown>> | null | undefined): string[] {
  const esperado: Readonly<Record<string, unknown>> = { ...JUEGO_DE_FICHA, ...JUEGO_CON_INFRA };
  return Object.keys(esperado).filter((clave) => !ficha || ficha[clave] !== esperado[clave]);
}
