import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { configExternaDe } from '../pedidos/pedidoDelQr.js';
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
  /** Solo para pruebas: sustituye la lectura de `config/pedidos` (devuelve los datos del documento). */
  leerConfigPedidos?: () => Promise<Record<string, unknown> | undefined>;
}): Promise<EnlaceDelTurno> {
  try {
    // FUENTE EXTERNA (B3): un comercio con `config/pedidos.catalogoExterno` no tiene ítems en Firestore que contar,
    // y el enlace NO llama a la fuente (este es el camino caliente de cada turno): una lectura de un documento, y
    // el enlace sale. Si ESA lectura falla, el comercio se trata como de catálogo interno (el comportamiento de
    // antes): la lectura nueva no puede quitarle el enlace a quien no la necesita. Solo se registra el código.
    let externo = false;
    if (o.catalogoWebActivo) {
      try {
        const doc = o.leerConfigPedidos
          ? await o.leerConfigPedidos()
          : (await getFirestore().doc(`tenants/${o.ruta.tenantId}/config/pedidos`).get()).data();
        externo = configExternaDe(doc) !== null;
      } catch (e) {
        const c = (e as { code?: unknown } | null)?.code;
        logger.warn('catalogoWeb: no se pudo leer config/pedidos; se usa el catálogo interno',
          { codigo: typeof c === 'string' || typeof c === 'number' ? c : null });
      }
    }
    const emitido = await enlaceParaElFlujo({
      ruta: o.ruta,
      telefono: o.telefono,
      catalogoWebActivo: o.catalogoWebActivo,
      vendibles: externo ? 0 : o.catalogo.filter((d) => sePuedeComprar(d.data())).length,
      ...(externo ? { catalogoExterno: true } : {}),
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
