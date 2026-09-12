import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';

/**
 * =============================================================================
 * REGISTRO DE FLUJOS — la tabla que decide qué pestañas tiene cada negocio
 * =============================================================================
 *
 * POLÍTICA (DISENO.md §4sexies, registrada el 2026-09-06). El producto tiene
 * tres capas: FLUJOS (lo que corre en n8n), CONSOLA (donde el negocio carga sus
 * datos) y USUARIOS (los negocios, con su gente). Cada flujo puede necesitar
 * parámetros PROPIOS —reservas necesita agendas por persona; pedidos necesita
 * costos de entrega y un QR— y esos parámetros son excluyentes entre sí. Lo que
 * es común a cualquier negocio (identidad, horarios, voz del asistente, usuarios,
 * contraseña, consumo) no depende del flujo.
 *
 * Un negocio tiene UNO O MÁS flujos (`tenants/{id}.flujos`), y la consola le
 * habilita una pestaña por cada uno. Esta tabla es la única lista de pestañas
 * por flujo del navegador. Sus espejos son `tieneAgenda`/`tieneCobro` en
 * `firestore.rules` y `VERTICALES_CONOCIDOS` en `functions/src/prompt.ts`:
 * agregar un flujo es tocar los tres, y si se toca uno solo, se nota.
 *
 * ESTO ES COSMÉTICO. Quien autoriza es `firestore.rules`: un negocio de venta
 * no puede escribir funcionarios ni construyendo la petición a mano. Lo que
 * esta tabla evita es ofrecer una puerta que el servidor va a cerrar.
 */
export type FlujoId = 'agendamiento' | 'venta';

export interface Pestana {
  ruta: string;
  etiqueta: string;
  /**
   * Quién la ve. Ausente significa SOLO ADMINISTRADOR, que era lo único que
   * había hasta el 09/09: toda pestaña de flujo se daba por administrativa.
   *
   * «Pedidos» rompe esa regla y por eso el campo existe. La mira el cocinero o
   * el repartidor —gente con rol `oper`— y es la única pantalla de la consola
   * que se usa con las manos ocupadas. Dejarla solo para el admin obligaría al
   * dueño a leerle los pedidos a su cocinero, que es exactamente el trabajo que
   * este producto viene a sacar del medio.
   */
  roles?: ('admin' | 'oper')[];
}

export interface DefinicionFlujo {
  /** Nombre comercial del flujo, como lo ve el negocio. */
  nombre: string;
  /** Pestañas que el flujo agrega a la consola de ese negocio. */
  pestanas: Pestana[];
  /** Cómo llama este flujo a los ítems del catálogo. */
  catalogo: string;
  /** Documento propio bajo `/config`, si el flujo tiene parámetros propios. */
  documento: string;
}

export const FLUJOS: Record<FlujoId, DefinicionFlujo> = {
  agendamiento: {
    nombre: 'Reservas y citas',
    pestanas: [{ ruta: 'agenda', etiqueta: 'Agenda' }],
    catalogo: 'Servicios',
    documento: 'agendamiento',
  },
  venta: {
    nombre: 'Pedidos y cobro',
    // «Inventario» es de VENTA y de nadie más: un salón no descuenta cortes
    // de pelo de un depósito. Es la política de capas de DISENO.md §4sexies.
    //
    // PENDIENTE (09/09): «Pedidos y cobro» se parte en TRES —Pedidos, Cobros y
    // Configuración de QR— y «Pedidos» va a ser la primera pestaña de flujo que
    // también vea el OPERADOR, lo que obliga a tocar la compuerta de roles de
    // la cabecera, que hoy da por sentado que pestaña de flujo = administrador.
    // La especificación está en `admin/DISENO.md` §4nonies, y antes hay que
    // guardar dos datos que todavía no existen: el `media id` del comprobante y
    // el pedido tomado por WhatsApp. No se empieza por la pantalla.
    pestanas: [
      // TRES PANTALLAS Y NO UNA (`DISENO.md` §4nonies). «Pedidos y cobro» era un
      // nombre que prometía dos cosas que no estaban: la pantalla configuraba el
      // QR y no listaba ni un pedido ni un cobro.
      //
      // El orden es el de la jornada de un comercio: primero lo que hay que
      // preparar, después la plata, y al final lo que se toca una vez y no se
      // vuelve a mirar.
      { ruta: 'pedidos', etiqueta: 'Pedidos', roles: ['admin', 'oper'] },
      { ruta: 'cobros', etiqueta: 'Cobros' },
      { ruta: 'inventario', etiqueta: 'Inventario' },
      { ruta: 'cobro', etiqueta: 'Configuración de QR' },
    ],
    catalogo: 'Productos',
    documento: 'venta',
    // PENDIENTE, y solo acá: publicar este catálogo como catálogo NATIVO de
    // WhatsApp, con carrito. Decidido el 2026-09-07 que es una capacidad de
    // venta y no de agendamiento: allá el catálogo es referencial —de qué habla
    // el asistente— y además Meta exige precio en cada producto, así que los
    // servicios «a consultar» no se podrían listar. Ver DISENO.md §4sexies.3bis.
  },
};

export const esFlujo = (v: unknown): v is FlujoId =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(FLUJOS, v);

/**
 * Los flujos de una ficha. La lista manda; una ficha anterior a la lista se
 * lee por `vertical`, igual que hacen las reglas. Así nada de lo ya cargado
 * cambia de comportamiento.
 */
export function flujosDe(ficha: { flujos?: unknown; vertical?: unknown } | undefined): FlujoId[] {
  if (!ficha) return [];
  if (Array.isArray(ficha.flujos)) return ficha.flujos.filter(esFlujo);
  return esFlujo(ficha.vertical) ? [ficha.vertical] : [];
}

/** Etiqueta de la pestaña de catálogo según los flujos: «Servicios», «Productos» o «Catálogo». */
export function etiquetaCatalogo(flujos: FlujoId[]): string {
  const nombres = new Set(flujos.map((f) => FLUJOS[f].catalogo));
  return nombres.size === 1 ? [...nombres][0] as string : 'Catálogo';
}

/**
 * Flujos del negocio, en vivo. `null` mientras carga: la cabecera no pinta
 * pestañas de flujo hasta saber cuáles son, para no mostrar una que después
 * desaparece.
 */
export function useFlujos(tenantId: string | undefined): FlujoId[] | null {
  const [flujos, setFlujos] = useState<FlujoId[] | null>(null);
  useEffect(() => {
    if (!tenantId) { setFlujos(null); return; }
    return onSnapshot(doc(db, 'tenants', tenantId),
      (d) => setFlujos(flujosDe(d.data())),
      () => setFlujos([]));
  }, [tenantId]);
  return flujos;
}
