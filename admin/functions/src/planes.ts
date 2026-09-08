/**
 * =============================================================================
 * TOPE DE MENSAJES DEL ASISTENTE POR VENTANA DE 24 HORAS
 * =============================================================================
 *
 * POR QUÉ EXISTE. Desde el 1 de octubre de 2026 Meta cobra CADA respuesta del
 * asistente (0,1356 Bs en «Resto de Latinoamérica», que es donde cae Bolivia),
 * agotada la franquicia mensual de 1.000 mensajes de servicio por número. Con
 * eso, el costo de una conversación deja de depender del modelo y pasa a
 * depender de CUÁNTOS MENSAJES MANDA EL ASISTENTE: una conversación de 10
 * turnos cuesta 1,6 Bs, una de 20 cuesta 3,1 Bs, y una que no termina nunca
 * cuesta lo que quiera el cliente final. Ver el modelo de costos del 8 de
 * septiembre de 2026 (artefacto «Costo por Conversación»).
 *
 * El tope acota el peor caso. No es un seguro contra el abuso: es control de
 * costo directo, y es ÚNICO para los tres planes (ver `TOPE_MENSAJES_24H`).
 * La ventana es la misma de 24 horas con la que Meta
 * factura y con la que este sistema cuenta las conversaciones
 * (`HORAS_VENTANA_ATENCION`). Que las tres cosas —lo que cobra Meta, lo que
 * cobra NovuChat y lo que se limita— midan sobre la misma ventana es lo que
 * permite comparar la factura recibida con la emitida renglón por renglón.
 *
 * QUÉ SE LIMITA, EXACTAMENTE. Las RESPUESTAS DEL ASISTENTE (mensajes
 * salientes) dentro de la ventana vigente de una conversación. Los mensajes
 * del cliente no se limitan: no cuestan. Al alcanzar el tope, el flujo manda
 * UN aviso de cierre —que también cuenta— y después guarda silencio hasta que
 * la ventana se renueve. Un aviso por ventana, nunca uno por mensaje: si se
 * avisara cada vez, el tope pagaría exactamente lo que quiere evitar.
 *
 * DÓNDE VIVE CADA VALOR (de más específico a más general):
 *
 *   1. `tenants/{t}/cuenta/estado.topeMensajes24h`  ajuste POR COMERCIO, lo
 *      escribe NovuChat con `actualizarEstadoCuenta` y queda auditado.
 *   2. `TOPE_MENSAJES_24H`                            el estándar, 25.
 *
 * ESTE MÓDULO ES PURO. No toca Firestore ni la red: recibe lo que hay guardado
 * y devuelve una decisión, para poder probarlo mensaje por mensaje sin
 * emulador. Quien lo llama aplica lo decidido.
 *
 * ES UN VALOR COMERCIAL. Subirlo cuesta plata en Meta; bajarlo corta
 * conversaciones. Se cambia con Andres y con Silvana, no en una revisión de
 * código, porque además está dicho en la oferta.
 */

/**
 * Separación entre una atención y la siguiente, en horas. Es la ventana de
 * atención al cliente de WhatsApp, la misma con la que Meta factura. Antes
 * vivía en `ingesta.ts`; se movió acá porque es un valor comercial y porque el
 * tope mide sobre la misma ventana. `ingesta.ts` la reexporta.
 */
export const HORAS_VENTANA_ATENCION = 24;

export const MS_VENTANA_ATENCION = HORAS_VENTANA_ATENCION * 60 * 60 * 1000;

/**
 * EL TOPE ES ÚNICO PARA LOS TRES PLANES, y eso fue una decisión, no un descuido.
 *
 * La primera versión de este módulo lo escalonaba por plan (8 / 12 / 16). El
 * análisis de sensibilidad del 08/09/2026 (`Analisis/16`) mostró que estaba al
 * revés por dos motivos, uno económico y otro comercial:
 *
 *  - ECONÓMICO. Subir el tope de 20 a 30 cuesta 0,8 % del precio en el plan
 *    chico y 6,4 % en el mediano. **El plan barato es el que más barato tiene
 *    ser generoso**, porque su volumen entra casi entero en la franquicia de
 *    1.000 mensajes gratis del número. Escalonar hacia arriba cobra el tope
 *    justo donde más caro sale darlo.
 *  - COMERCIAL. Un plan caro con un tope menor que el barato es invendible:
 *    «pagás más y te cortan antes» no se explica en una reunión.
 *
 * Por eso el tope **no se usa como diferenciador de plan**: lo que diferencia a
 * un plan de otro es cuántas conversaciones incluye. El tope se fija por
 * CALIDAD DE SERVICIO. Veinticinco respuestas del asistente en 24 horas es
 * mucho más de lo que necesita una reserva o un pedido normal; una conversación
 * que pasa de ahí no es un cliente exigente, **es una conversación que se
 * atascó**, y lo correcto es que la tome una persona del negocio.
 *
 * HAY QUE DECIRLO EN LA OFERTA. La página dice hoy que una conversación son
 * todos los mensajes «sin importar cuántos sean», y con este tope deja de ser
 * cierto. Presentado como característica es una característica; descubierto por
 * el cliente, es un reclamo.
 *
 * DÓNDE VIVEN LOS PLANES. Acá NO: los planes, su precio y las conversaciones
 * incluidas son de `prepago.ts` (rama `claude/novuchat-prepago-clientes`), que
 * es el módulo de la relación comercial. Este archivo solo decide el tope de
 * mensajes por conversación, que ya no depende del plan. Cuando los dos se
 * fusionen, esto entra ahí y no hay dos tablas que sincronizar.
 */
export const TOPE_MENSAJES_24H = 25;

/**
 * Cota superior de cualquier ajuste por comercio. No es un valor comercial:
 * es un seguro contra un dedo de más en el panel («250» por «25»). Por encima
 * de esto el tope dejaría de acotar nada.
 */
export const TOPE_MAXIMO = 60;

export interface TopeResuelto {
  tope: number;
  origen: 'cuenta' | 'estandar';
}

/**
 * El tope que rige para un comercio.
 *
 * `ajusteCuenta` es `cuenta/estado.topeMensajes24h`, que escribe NovuChat y
 * queda auditado. Es la única excepción prevista: un negocio cuyas
 * conversaciones son legítimamente largas, o uno al que hay que acotar más.
 * Sin ajuste, rige el estándar.
 */
export function topeMensajes24h(ajusteCuenta: unknown): TopeResuelto {
  if (typeof ajusteCuenta === 'number' && Number.isFinite(ajusteCuenta)) {
    const ajuste = Math.trunc(ajusteCuenta);
    if (ajuste >= 1 && ajuste <= TOPE_MAXIMO) return { tope: ajuste, origen: 'cuenta' };
    // Un ajuste fuera de rango se ignora con el estándar como red: nunca «sin
    // tope» por un dato mal cargado.
  }
  return { tope: TOPE_MENSAJES_24H, origen: 'estandar' };
}

/** Lo que hay guardado en la conversación y que el tope necesita leer. */
export interface MarcasDeTope {
  /** Cuándo empezó la atención vigente (ancla de la ventana). */
  atencionDesde?: { toMillis?: () => number } | unknown;
  /** Respuestas del asistente enviadas dentro de la ventana vigente. */
  mensajesVentana?: unknown;
}

export interface EstadoDelTope {
  tope: number;
  /** Respuestas ya enviadas en la ventana vigente. 0 si la ventana venció. */
  enviados: number;
  /**
   * `tope - enviados`. Positivo: el asistente puede responder. Cero: se alcanzó
   * el tope y corresponde el ÚNICO aviso de cierre. Negativo: el aviso ya se
   * mandó; silencio hasta que la ventana se renueve.
   */
  restantes: number;
  /** Cuándo vence la ventana vigente, en milisegundos. `null` si no hay una abierta. */
  ventanaVenceEn: number | null;
  /** Atajo: `restantes <= 0`. */
  alcanzado: boolean;
}

/** Milisegundos del ancla, o `null` si no hay. Tolera Timestamp y objetos sueltos. */
export function anclaMs(marcas: MarcasDeTope): number | null {
  const ancla = marcas.atencionDesde as { toMillis?: () => number } | undefined;
  return typeof ancla?.toMillis === 'function' ? ancla.toMillis() : null;
}

/** ¿La ventana vigente ya venció (o nunca hubo una)? */
export function ventanaVencida(marcas: MarcasDeTope, ahoraMs: number): boolean {
  const ms = anclaMs(marcas);
  return ms === null || ahoraMs - ms >= MS_VENTANA_ATENCION;
}

/**
 * Dónde está la conversación respecto del tope, a partir de lo guardado.
 *
 * Una ventana vencida cuenta como nueva: el próximo mensaje del cliente la
 * abre con el contador en cero (lo escribe la ingesta), así que acá ya se
 * informa el tope entero. Si se informara el contador viejo, un cliente que
 * vuelve al día siguiente arrancaría castigado por la conversación de ayer.
 */
export function estadoDelTope(marcas: MarcasDeTope, tope: number, ahoraMs: number): EstadoDelTope {
  const vencida = ventanaVencida(marcas, ahoraMs);
  const guardado = marcas.mensajesVentana;
  const enviados = !vencida && typeof guardado === 'number' && Number.isFinite(guardado)
    ? Math.max(0, Math.trunc(guardado))
    : 0;
  const restantes = tope - enviados;
  const ancla = anclaMs(marcas);
  return {
    tope,
    enviados,
    restantes,
    ventanaVenceEn: vencida || ancla === null ? null : ancla + MS_VENTANA_ATENCION,
    alcanzado: restantes <= 0,
  };
}
