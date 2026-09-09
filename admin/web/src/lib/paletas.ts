/**
 * =============================================================================
 * LAS CINCO PALETAS DEL CATÁLOGO WEB
 * =============================================================================
 *
 * POR QUÉ UNA LISTA CERRADA Y NO UN SELECTOR DE COLOR. Antes esto era un
 * `colorMarca` libre en `#rrggbb`, y hasta con esa validación era el único dato
 * del comercio que terminaba dentro de una propiedad de CSS. Un enumerado
 * elimina el problema en vez de validarlo, que es el mismo criterio con el que
 * la voz del asistente es una lista cerrada y no texto libre.
 *
 * Y hay una razón de diseño que pesa más que la de seguridad: **un comercio que
 * elige un color elige uno solo, y después la página necesita tres.** El botón,
 * su estado presionado y el fondo de los chips de área tienen que combinar y
 * tener contraste entre sí. Pedirle eso a alguien con un selector de color
 * termina en una página con texto blanco sobre amarillo. Acá cada paleta trae
 * las tres, calculadas juntas.
 *
 * CONTRASTE VERIFICADO, no elegido a ojo. Las cinco cumplen WCAG AA en las tres
 * relaciones que importan (medido, no supuesto):
 *
 *   paleta      blanco/base   texto/suave   base/suave
 *   terracota      5,18         14,49          4,52
 *   bosque         5,02         15,12          4,57
 *   indigo         7,90         13,47          6,41
 *   vino           8,02         13,83          6,68
 *   oceano         5,47         14,73          4,86
 *
 * Si alguien agrega una paleta, tiene que volver a medirlas: hay una prueba que
 * lo hace y falla si una nueva no llega al umbral.
 */
export type PaletaId = 'terracota' | 'bosque' | 'indigo' | 'vino' | 'oceano';

export interface Paleta {
  /** Cómo se le ofrece al comercio, en su idioma y no en jerga de diseño. */
  nombre: string;
  /** Para quién suele funcionar. Ayuda a elegir sin saber de color. */
  sugerencia: string;
  /** Botones, precios, la línea de la cabecera. */
  base: string;
  /** El mismo color presionado o con el cursor encima. */
  oscuro: string;
  /** Fondo de los chips de área y de las zonas suaves. */
  suave: string;
}

export const PALETAS: Record<PaletaId, Paleta> = {
  terracota: {
    nombre: 'Terracota',
    sugerencia: 'Comida, panaderías, parrillas',
    base: '#C2410C', oscuro: '#9A3412', suave: '#FFEDD5',
  },
  bosque: {
    nombre: 'Bosque',
    sugerencia: 'Naturales, farmacias, veterinarias',
    base: '#15803D', oscuro: '#166534', suave: '#DCFCE7',
  },
  indigo: {
    nombre: 'Índigo',
    sugerencia: 'Tecnología, servicios, tiendas',
    base: '#4338CA', oscuro: '#3730A3', suave: '#E0E7FF',
  },
  vino: {
    nombre: 'Vino',
    sugerencia: 'Boutiques, repostería, estética',
    base: '#9F1239', oscuro: '#881337', suave: '#FFE4E6',
  },
  oceano: {
    nombre: 'Océano',
    sugerencia: 'Salud, consultorios, spa',
    base: '#0F766E', oscuro: '#115E59', suave: '#CCFBF1',
  },
};

/** La que se usa si el comercio no eligió ninguna. */
export const PALETA_POR_DEFECTO: PaletaId = 'indigo';

export const esPaleta = (v: unknown): v is PaletaId =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(PALETAS, v);

/** La paleta pedida, o la de por defecto. Nunca devuelve `undefined`. */
export function paletaDe(valor: unknown): Paleta {
  return PALETAS[esPaleta(valor) ? valor : PALETA_POR_DEFECTO];
}

/**
 * Las variables de CSS que consume `catalogo.css`.
 *
 * Se arman acá y no en la hoja de estilos porque la hoja no puede elegir: la
 * paleta la decide el comercio y llega en la respuesta del servidor. Los valores
 * salen SIEMPRE de esta tabla, nunca de la respuesta, así que aunque el servidor
 * mandara basura no hay nada que inyectar.
 */
export function variablesDe(valor: unknown): Record<string, string> {
  const p = paletaDe(valor);
  return {
    '--marca': p.base,
    '--marca-oscura': p.oscuro,
    '--marca-suave': p.suave,
  };
}
