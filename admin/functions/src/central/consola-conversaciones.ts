/**
 * CONSOLA DE CONVERSACIONES — qué pantalla de Conversaciones ve UN comercio
 * (`tenants/{id}.consolaConversaciones`). Archivo puro y sin `import`: lo leen la
 * consola (`useConsolaConversaciones`), el script de plataforma que lo escribe
 * (`aplicar-consola-conversaciones.mjs`) y las pruebas, igual que
 * `consola-oculta.ts`.
 *
 * LA NUEVA ES LA POR DEFECTO (Andres, 24/10/2026). La pantalla nueva (lista y hilo al
 * estilo de WhatsApp Web, con búsqueda y filtros) es la de todos los comercios; «el
 * otro formato lo olvidamos». La bandera sobrevive solo como VÁLVULA DE EMERGENCIA:
 *
 *   'clasica'  la pantalla de siempre (`ConversacionesClasica.tsx`), SOLO si se
 *              escribe explícitamente (script de plataforma).
 *   'nueva'    la pantalla nueva.
 *
 * SIN BANDERA = NUEVA. Ausente, desconocida, de otro tipo, ficha ausente o lectura
 * fallida: 'nueva'. Una sola constante (`PANTALLA_POR_DEFECTO`) la define y la usan
 * el servidor, la consola y el script; no hay dos defaults.
 *
 * ESTA FUNCIÓN SOLO PINTA. Tomar y escribir como persona (`accesoPersona.ts`)
 * siguen exigiendo `consolaConversaciones === 'nueva'` EXPLÍCITO (y no Bellido):
 * un comercio sin bandera ve la pantalla nueva en lectura, pero no puede tomar
 * ni escribir. Nunca se usa para decidir permisos.
 *
 * ES SOLO PRESENTACIÓN. La bandera elige qué se pinta; lo que el servidor
 * permite o rechaza no cambia. La escribe NovuChat, nunca el comercio:
 * `firestore.rules` no deja a ningún navegador escribir `tenants/{id}`; el único
 * camino es `scripts/plataforma/aplicar-consola-conversaciones.mjs`.
 */

/** Las pantallas posibles. Agregar una es un cambio de código, con su prueba. */
export const PANTALLAS_CONVERSACIONES = ['clasica', 'nueva'] as const;
export type PantallaConversaciones = (typeof PANTALLAS_CONVERSACIONES)[number];

/** La pantalla que ve un comercio sin un 'clasica' explícito. Única fuente del default. */
export const PANTALLA_POR_DEFECTO: PantallaConversaciones = 'nueva';

export const esPantallaConversaciones = (v: unknown): v is PantallaConversaciones =>
  typeof v === 'string' && (PANTALLAS_CONVERSACIONES as readonly string[]).includes(v);

/** Lo que de una ficha de `tenants/{id}` importa para elegir la pantalla. */
export interface FichaConConsolaConversaciones {
  readonly consolaConversaciones?: unknown;
}

/**
 * La pantalla de una ficha. Solo un 'clasica' explícito da la clásica; todo lo
 * demás (ausente, desconocido, de otro tipo, `null`, una ficha ausente) es la
 * de por defecto, 'nueva'.
 */
export function pantallaConversacionesDeFicha(
  ficha: FichaConConsolaConversaciones | null | undefined,
): PantallaConversaciones {
  if (!ficha || !Object.prototype.hasOwnProperty.call(ficha, 'consolaConversaciones')) return PANTALLA_POR_DEFECTO;
  return ficha.consolaConversaciones === 'clasica' ? 'clasica' : PANTALLA_POR_DEFECTO;
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
