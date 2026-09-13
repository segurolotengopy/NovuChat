/**
 * =============================================================================
 * ATENCIÓN — la ventana de 24 h, el bloque de 25 y los dos umbrales de corte
 * =============================================================================
 *
 * ESTE MÓDULO ES PURO A PROPÓSITO: no importa Firebase ni lee la red. Lo usan
 * la ingesta y `configuracionFlujo` en el servidor, y lo importa TAMBIÉN la
 * consola (`web/src/lib/atencion.ts`), para que la pantalla y el servidor no
 * puedan decir dos cosas distintas sobre el mismo número. Sobre lo que decide
 * acá se factura y se corta el servicio a un cliente final, así que cada
 * función se prueba mensaje por mensaje sin emulador.
 *
 * LAS CUATRO REGLAS, decididas por Andres el 13/09/2026 (`Analisis/27`):
 *
 *  1. VENTANA de 24 horas por teléfono, fija desde la primera consulta que no
 *     es cortesía. A las 24 h la ventana se renueva y todo conteo vuelve a cero.
 *  2. CONVERSACIÓN = bloque de hasta 25 respuestas del asistente dentro de la
 *     ventana. La respuesta 26 abre un bloque nuevo y factura OTRA conversación.
 *  3. UMBRAL DE OPERADOR (50 por defecto): a partir de ahí el asistente no
 *     vuelve a llamar al modelo; responde con un aviso fijo de uso extendido y
 *     avisa a recepción para que una persona tome la conversación.
 *  4. UMBRAL DE BLOQUEO (100 por defecto): a partir de ahí no se envía nada
 *     más a ese teléfono hasta que la ventana se renueve.
 *
 * Los umbrales son PARAMETRIZABLES POR EMPRESA en `cuenta/estado`
 * (`umbralOperador`, `umbralBloqueo`), que escribe NovuChat y el comercio solo
 * lee. Los valores de acá son los de respaldo: el límite se lee de la cuenta,
 * no se escribe en el código (`CLAUDE.md` §7.4).
 *
 * QUIÉN HACE CUMPLIR QUÉ. El servidor decide y anota; el flujo de n8n obedece
 * lo que `configuracionFlujo` le devuelve en `atencion.estado` ANTES de llamar
 * al modelo. Un saliente ya enviado no se puede rechazar, así que el corte se
 * decide sobre el entrante que lo provocaría.
 */

// -----------------------------------------------------------------------------
// VALORES COMERCIALES. Se cambian con Andres y Silvana, junto con la «Base
// comercial» de `CLAUDE.md` y con `novuchat.site/precios`, que publica el bloque.
// -----------------------------------------------------------------------------

/**
 * SEPARACIÓN ENTRE UNA ATENCIÓN Y LA SIGUIENTE: veinticuatro horas desde la
 * primera consulta, decidido por Andres. No es un número arbitrario: es
 * exactamente la ventana de atención al cliente de WhatsApp, la misma con la
 * que Meta factura. Que nuestra unidad coincida con la suya hace que la factura
 * que recibimos y la que emitimos se puedan comparar renglón por renglón.
 *
 * Subirlo cobra menos y bajarlo cobra más.
 */
export const HORAS_VENTANA_ATENCION = 24;
export const MS_VENTANA_ATENCION = HORAS_VENTANA_ATENCION * 60 * 60 * 1000;

/**
 * Cuántas respuestas del asistente entran en una conversación facturada. La
 * respuesta 26 abre otra. Un bloque lleno cuesta lo mismo que costaba una
 * conversación en el tope anterior (0,3051 USD), así que el precio mínimo de la
 * bolsa de `Analisis/23` no cambia.
 */
export const RESPUESTAS_POR_CONVERSACION = 25;

/**
 * Los dos umbrales de corte por defecto, en respuestas del asistente dentro de
 * la ventana. En bloques: el operador entra al terminar el segundo, el bloqueo
 * al terminar el cuarto.
 */
export const UMBRALES_ATENCION = { operador: 50, bloqueo: 100 } as const;

/**
 * Cota de cordura de un umbral cargado a mano. No es una opinión comercial: es
 * un seguro contra un cero de más, que dejaría a un teléfono sin techo.
 */
export const UMBRAL_MAXIMO = 500;

/**
 * EL AVISO DE USO EXTENDIDO, lo que recibe el cliente final cuando la
 * conversación pasa al operador. Fijo, cordial y NEUTRO: no habla de límites,
 * de mensajes ni de dinero, porque quien escribe es un tercero ajeno a la
 * relación comercial (`DISENO.md` §4bis.3). El flujo puede reemplazarlo por el
 * texto del negocio; este es el de respaldo.
 */
export const MENSAJE_USO_EXTENDIDO =
  'Gracias por su paciencia. Para atenderle mejor, una persona del equipo va a ' +
  'continuar esta conversación en breve.';

// -----------------------------------------------------------------------------
// LA VENTANA
// -----------------------------------------------------------------------------

/** Lo que hay guardado en la conversación y que este módulo necesita leer. */
export interface MarcasDeAtencion {
  /** Cuándo empezó la atención vigente (ancla de la ventana). Timestamp o similar. */
  atencionDesde?: { toMillis?: () => number } | unknown;
  /** Respuestas del asistente enviadas dentro de la ventana vigente. */
  mensajesVentana?: unknown;
  /** Último estado de atención anotado por la ingesta (`normal`, `operador`, `bloqueado`). */
  atencionEstado?: unknown;
}

/** Milisegundos del ancla, o `null` si no hay. Tolera Timestamp y objetos sueltos. */
export function anclaMs(marcas: MarcasDeAtencion): number | null {
  const ancla = marcas.atencionDesde as { toMillis?: () => number; seconds?: unknown } | undefined;
  if (typeof ancla?.toMillis === 'function') return ancla.toMillis();
  if (typeof ancla?.seconds === 'number') return ancla.seconds * 1000;
  return null;
}

/** ¿La ventana vigente ya venció (o nunca hubo una)? */
export function ventanaVencida(marcas: MarcasDeAtencion, ahoraMs: number): boolean {
  const ms = anclaMs(marcas);
  return ms === null || ahoraMs - ms >= MS_VENTANA_ATENCION;
}

const enteroONulo = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : null;

/** Respuestas del asistente en la ventana vigente. Cero si la ventana venció. */
export function respuestasEnVentana(marcas: MarcasDeAtencion, ahoraMs: number): number {
  if (ventanaVencida(marcas, ahoraMs)) return 0;
  return enteroONulo(marcas.mensajesVentana) ?? 0;
}

// -----------------------------------------------------------------------------
// LOS UMBRALES, LEÍDOS DE LA CUENTA
// -----------------------------------------------------------------------------

export interface Umbrales {
  operador: number;
  bloqueo: number;
  /** De dónde salieron: de la cuenta del comercio o de los valores de respaldo. */
  origen: 'cuenta' | 'estandar';
}

/** ¿Es un umbral que se puede aceptar tal cual? Entero entre 1 y el máximo. */
export function umbralValido(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v)
    && v >= 1 && v <= UMBRAL_MAXIMO;
}

/**
 * Los umbrales que rigen para una cuenta.
 *
 * LOS DOS SE ACEPTAN JUNTOS O NINGUNO. Un `umbralBloqueo` menor o igual que el
 * `umbralOperador` no describe nada —el teléfono se bloquearía antes de pasar
 * al operador—, y un umbral fuera de rango es casi seguro un error de carga.
 * En cualquiera de los dos casos rigen los de respaldo, que son coherentes, en
 * vez de una mezcla que nadie decidió. Un solo umbral cargado se combina con el
 * de respaldo del otro, siempre que la pareja resultante sea coherente.
 */
export function umbralesDeAtencion(cuenta: Record<string, unknown> | undefined): Umbrales {
  const op = cuenta?.['umbralOperador'];
  const bl = cuenta?.['umbralBloqueo'];
  const operador = op === undefined || op === null ? UMBRALES_ATENCION.operador : op;
  const bloqueo = bl === undefined || bl === null ? UMBRALES_ATENCION.bloqueo : bl;
  const estandar: Umbrales = { ...UMBRALES_ATENCION, origen: 'estandar' };
  if (!umbralValido(operador) || !umbralValido(bloqueo)) return estandar;
  if (bloqueo <= operador) return estandar;
  const deCuenta = (op !== undefined && op !== null) || (bl !== undefined && bl !== null);
  return { operador, bloqueo, origen: deCuenta ? 'cuenta' : 'estandar' };
}

// -----------------------------------------------------------------------------
// EL ESTADO DE ATENCIÓN DE UN TELÉFONO
// -----------------------------------------------------------------------------

export type EstadoAtencion = 'normal' | 'operador' | 'bloqueado';

export const esEstadoAtencion = (v: unknown): v is EstadoAtencion =>
  v === 'normal' || v === 'operador' || v === 'bloqueado';

export interface Atencion {
  /** Qué hace el flujo con el PRÓXIMO mensaje del cliente. */
  estado: EstadoAtencion;
  /** Respuestas del asistente en la ventana vigente. 0 si venció. */
  respuestasEnVentana: number;
  /** Bloque en curso (1 = las primeras 25). El siguiente saliente puede abrir otro. */
  bloque: number;
  /** Cuántas respuestas faltan para que empiece un bloque nuevo. */
  restanDelBloque: number;
  /** Cuándo vence la ventana vigente, en milisegundos. `null` si no hay una abierta. */
  ventanaVenceEn: number | null;
  umbrales: { operador: number; bloqueo: number; origen: 'cuenta' | 'estandar' };
  /** El aviso fijo que manda el flujo en estado `operador`. `null` en los demás. */
  mensajeFijo: string | null;
}

/**
 * Decide el estado de atención de un teléfono a partir de lo guardado.
 *
 * SE MIRA LO QUE YA SE ENVIÓ, no lo que este turno va a enviar: el umbral de
 * 50 significa «después de 50 respuestas», así que la consulta que llega con
 * 50 enviadas ya no va al modelo. La respuesta fija que reemplaza al modelo
 * también se reporta como saliente y también cuenta, por eso el estado
 * `operador` avanza solo hacia `bloqueado` si el cliente sigue escribiendo:
 * entre los dos umbrales cada consulta cuesta un mensaje fijo, y a partir del
 * bloqueo no cuesta nada.
 */
export function estadoDeAtencion(
  marcas: MarcasDeAtencion, umbrales: Umbrales, ahoraMs: number,
): Atencion {
  const enviadas = respuestasEnVentana(marcas, ahoraMs);
  const ancla = anclaMs(marcas);
  const vencida = ventanaVencida(marcas, ahoraMs);
  const estado: EstadoAtencion = enviadas >= umbrales.bloqueo ? 'bloqueado'
    : enviadas >= umbrales.operador ? 'operador'
    : 'normal';
  const bloque = Math.floor(enviadas / RESPUESTAS_POR_CONVERSACION) + 1;
  return {
    estado,
    respuestasEnVentana: enviadas,
    bloque,
    restanDelBloque: bloque * RESPUESTAS_POR_CONVERSACION - enviadas,
    ventanaVenceEn: vencida || ancla === null ? null : ancla + MS_VENTANA_ATENCION,
    umbrales: { operador: umbrales.operador, bloqueo: umbrales.bloqueo, origen: umbrales.origen },
    mensajeFijo: estado === 'operador' ? MENSAJE_USO_EXTENDIDO : null,
  };
}

/**
 * ¿Este estado es una TRANSICIÓN que hay que avisar a recepción?
 *
 * Se avisa una vez por ventana y por umbral: al pasar a `operador` y al pasar
 * a `bloqueado`. Volver a `normal` (la ventana se renovó) no se avisa. La marca
 * es el estado que la ingesta dejó anotado en la conversación con el mensaje
 * anterior; si no hay marca, cualquier estado distinto de `normal` se avisa.
 */
export function avisoDeTransicion(
  guardado: unknown, calculado: EstadoAtencion,
): 'operador' | 'bloqueado' | null {
  if (calculado === 'normal') return null;
  const previo = esEstadoAtencion(guardado) ? guardado : 'normal';
  return previo === calculado ? null : calculado;
}
