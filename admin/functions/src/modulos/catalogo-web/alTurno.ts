import { enlaceParaElFlujo, sePuedeComprar, type EnlaceEmitido } from './catalogoWeb.js';

/**
 * EL ENLACE DE LA CARTA EN EL TURNO (F3b-2e). Era un trozo de `configuracionFlujo`
 * en `ingesta.ts`, movido SIN cambiar lógica.
 *
 * `catalogoCompleto` (03/10/2026, piloto Q'Taco): un flujo que NECESITA la carta
 * entera aunque el catálogo web esté encendido —«Venta mínima v0»— la pide en el
 * cuerpo con `catalogoCompleto: true`; el coordinador decide esa bandera (booleano
 * estricto y solo en el flujo `venta` de la RUTA) y llama acá solo si la pidió y el
 * catálogo web está encendido. El enlace de ESTA conversación viaja en
 * `catalogoWeb.enlace`: el mismo mientras la ficha sirva, y solo con teléfono, flujo
 * `venta` y al menos un ítem con precio. Cualquier error o límite deja la respuesta
 * sin `enlace` y el turno sigue (el flujo cae a la carta en texto).
 */
export interface EnlaceDelTurno {
  readonly enlace: EnlaceEmitido | null;
  /** Por qué NO hubo enlace, para el registro (un `SITIO_PUBLICO` ausente no puede pasar callado). */
  readonly motivo: string | null;
  /** Solo el código del error (el mensaje puede traer la ruta de un documento); el coordinador lo registra. */
  readonly codigoDeError?: string | number | null;
}

export async function enlaceDeLaCartaDelTurno(o: {
  ruta: { tenantId: string; phoneNumberId: string; flujo: string; estado: string };
  telefono: string | null;
  catalogoWebActivo: boolean;
  /** Los documentos del catálogo activo que el turno YA leyó (cero lecturas nuevas). */
  catalogo: readonly { data(): Record<string, unknown> }[];
}): Promise<EnlaceDelTurno> {
  try {
    const emitido = await enlaceParaElFlujo({
      ruta: o.ruta,
      telefono: o.telefono,
      catalogoWebActivo: o.catalogoWebActivo,
      vendibles: o.catalogo.filter((d) => sePuedeComprar(d.data())).length,
    });
    return 'url' in emitido ? { enlace: emitido, motivo: null } : { enlace: null, motivo: emitido.motivo };
  } catch (error) {
    const codigo = (error as { code?: unknown } | null)?.code;
    return {
      enlace: null, motivo: 'error',
      codigoDeError: typeof codigo === 'string' || typeof codigo === 'number' ? codigo : null,
    };
  }
}
