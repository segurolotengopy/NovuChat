/**
 * LO QUE DEVUELVE `catalogoPublico`, escrito como tipo para que el compilador
 * obligue a tratarlo como lo que es: datos que vienen de la red.
 *
 * Todo lo de acá lo escribió un comercio y NUNCA se interpola en HTML: React lo
 * escapa por defecto y este directorio no tiene ninguna vía de escape (el CI lo
 * verifica en cada push, paso «Prohibiciones de renderizado»). Los dos campos
 * que sí pueden hacer daño si se los deja pasar crudos son las URL de imagen
 * —que van a un atributo `src`— y el color de marca —que va a una propiedad
 * personalizada de CSS—. Los dos se validan en `saneo.ts` antes de usarlos,
 * además de estar validados en el servidor.
 */
export interface ItemPublico {
  id: string;
  nombre: string;
  descripcion: string;
  area: string;
  /** `null` significa «a consultar». NO es cero: cero significa gratis. */
  precio: number | null;
  moneda: string;
  imagenUrl: string;
}

export interface NegocioPublico {
  nombre: string;
  descripcion: string;
  direccion: string;
  moneda: string;
  logoUrl: string;
  colorMarca: string;
}

/** Mismos nombres que `/config/venta`: un solo vocabulario de punta a punta. */
export interface EntregaPublica {
  costoDelivery: number | null;
  pedidoMinimo: number | null;
  aceptaDelivery: boolean;
  aceptaRetiroEnLocal: boolean;
}

export interface CatalogoPublico {
  negocio: NegocioPublico;
  entrega: EntregaPublica;
  items: ItemPublico[];
  caducaEn: string;
}

export interface RespuestaCheckout {
  ok: true;
  pedidoId: string;
  total: number;
  moneda: string;
  hayACotizar: boolean;
  descartados: string[];
  /** `respuesta` = el asistente contesta ya; `notificacion` = llega un aviso. */
  siguiente: 'respuesta' | 'notificacion';
}
