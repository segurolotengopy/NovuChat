/**
 * CONSOLA DE CONVERSACIONES — qué pantalla de Conversaciones ve UN comercio
 * (`tenants/{id}.consolaConversaciones`). Archivo puro y sin `import`: lo leen la
 * consola (`useConsolaConversaciones`), el script de plataforma que lo escribe
 * (`aplicar-consola-conversaciones.mjs`) y las pruebas, igual que
 * `consola-oculta.ts`.
 *
 * POR QUÉ UNA BANDERA. La pantalla nueva (lista y hilo al estilo de WhatsApp Web,
 * con búsqueda y filtros) reemplaza a la de siempre, y un reemplazo de pantalla
 * entera no se enciende para todos a la vez: se enciende por comercio, se mira
 * con un mensaje real y se apaga con un solo comando si algo falla. La pantalla de
 * siempre queda intacta detrás de la bandera (`ConversacionesClasica.tsx`).
 *
 *   'clasica'  la pantalla de siempre.
 *   'nueva'    la pantalla nueva.
 *
 * SIN BANDERA = COMPORTAMIENTO DE SIEMPRE. Ausente, desconocida, de otro tipo o
 * con la lectura fallida, la respuesta es 'clasica': ante la duda se muestra lo
 * que ya funcionaba, nunca lo que todavía no se probó.
 *
 * ES SOLO PRESENTACIÓN. La bandera elige qué se pinta; lo que el servidor
 * permite o rechaza no cambia. La escribe NovuChat, nunca el comercio:
 * `firestore.rules` no deja a ningún navegador escribir `tenants/{id}`; el único
 * camino es `scripts/plataforma/aplicar-consola-conversaciones.mjs`.
 */

/** Las pantallas posibles. Agregar una es un cambio de código, con su prueba. */
export const PANTALLAS_CONVERSACIONES = ['clasica', 'nueva'] as const;
export type PantallaConversaciones = (typeof PANTALLAS_CONVERSACIONES)[number];

export const esPantallaConversaciones = (v: unknown): v is PantallaConversaciones =>
  typeof v === 'string' && (PANTALLAS_CONVERSACIONES as readonly string[]).includes(v);

/** Lo que de una ficha de `tenants/{id}` importa para elegir la pantalla. */
export interface FichaConConsolaConversaciones {
  readonly consolaConversaciones?: unknown;
}

/**
 * La pantalla de una ficha. Todo lo que no sea exactamente 'nueva' (ausente,
 * desconocido, de otro tipo, `null`, una ficha ausente) es 'clasica'.
 */
export function pantallaConversacionesDeFicha(
  ficha: FichaConConsolaConversaciones | null | undefined,
): PantallaConversaciones {
  if (!ficha || !Object.prototype.hasOwnProperty.call(ficha, 'consolaConversaciones')) return 'clasica';
  return ficha.consolaConversaciones === 'nueva' ? 'nueva' : 'clasica';
}

/**
 * Valida el texto que recibe el script (`--pantalla nueva|clasica`). A diferencia
 * de la lectura, AQUÍ un valor desconocido se rechaza: quien escribe tiene que
 * saber lo que escribe.
 */
export function validarPantallaConversaciones(texto: unknown):
  { ok: true; pantalla: PantallaConversaciones } | { ok: false; problemas: string[] } {
  if (typeof texto !== 'string' || texto === '') return { ok: false, problemas: ['--pantalla vacío'] };
  if (!esPantallaConversaciones(texto)) {
    return {
      ok: false,
      problemas: [`--pantalla: valor desconocido (${texto.slice(0, 40)}); los valores son ${PANTALLAS_CONVERSACIONES.join(', ')}`],
    };
  }
  return { ok: true, pantalla: texto };
}
