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
  /**
   * SIEMPRE VIENE CON PRECIO. El servidor no publica los ítems «a consultar»:
   * `Analisis/19` §5 —«publicar en el catálogo web algo que no se puede comprar
   * es la forma más cara de generar una conversación»—. El tipo admite `null`
   * igual, porque el navegador no puede dar por sentado lo que promete un
   * servidor que puede estar desplegado a otra versión, y `precioTexto` lo
   * resuelve mostrando «A consultar» en vez de romper la página.
   */
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
  descartados: string[];
  /** `respuesta` = el asistente contesta ya; `notificacion` = llega un aviso. */
  siguiente: 'respuesta' | 'notificacion';
}
