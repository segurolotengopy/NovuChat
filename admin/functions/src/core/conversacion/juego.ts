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
 *  10. Retomar con plantilla            -> `personaPuedeRetomar === true`        (turno.ts, personaPuedeRetomarDeFicha; la escribe
 *      `aplicar-persona-puede-retomar.mjs` solo con C1 válido en las rutas y la salida con plantillas; sin plantilla queda pendiente)
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
  personaPuedeRetomar: true,
} as const);

/**
 * Predicados EXACTOS que usa el servidor (`accesoPersona.ts` y `medios/guardarMedio.ts` los importan): la prueba y el
 * servidor comparten la misma función, así que no pueden divergir. `personaPuedeEscribirDeFicha` y
 * `personaPuedeEnviarMediosDeFicha` ya viven en `turno.ts` (pura y sin import) y la prueba los usa directamente.
 */
export function consolaNuevaEncendida(ficha: { readonly consolaConversaciones?: unknown } | null | undefined): boolean {
  return !!ficha && ficha.consolaConversaciones === JUEGO_DE_FICHA.consolaConversaciones;
}

export function guardadoEncendido(ficha: { readonly guardarMedios?: unknown } | null | undefined): boolean {
  return !!ficha && ficha.guardarMedios === JUEGO_DE_FICHA.guardarMedios;
}

/**
 * Claves del juego que faltan o no tienen el valor exacto en la ficha. Vacío = juego completo. *
 * OJO con Bellido: `habilitadoParaPersona` (accesoPersona.ts) también excluye comercios por nombre o id
 * (`TENANTS_EXCLUIDOS`, hoy vacía desde el 08/11/2026). Un tenant excluido puede tener el juego completo y seguir
 * sin habilitación; y al revés, aparece como incompleto aquí aunque su exclusión funcione. `faltanDelJuego` mide
 * las banderas de la ficha, no la exclusión.
 */
export function faltanDelJuego(ficha: Readonly<Record<string, unknown>> | null | undefined): string[] {
  const esperado: Readonly<Record<string, unknown>> = { ...JUEGO_DE_FICHA, ...JUEGO_CON_INFRA };
  return Object.keys(esperado).filter((clave) => !ficha || ficha[clave] !== esperado[clave]);
}
