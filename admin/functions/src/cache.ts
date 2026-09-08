/**
 * =============================================================================
 * CACHÉ EN MEMORIA CON VENCIMIENTO, PARA LA CONFIGURACIÓN QUE LEE n8n
 * =============================================================================
 *
 * EL PROBLEMA. Al conectar la consola, cada turno de conversación pasó a leer
 * de Firestore la ficha del comercio, su configuración, el catálogo entero, los
 * funcionarios, el documento del vertical y los rótulos: las lecturas por
 * conversación subieron de 45 a 295 (medido el 07/09/2026). Nada de eso cambia
 * entre un turno y el siguiente —un precio se edita una vez por semana, no una
 * vez por mensaje—, así que se estaba pagando la misma lectura veinte veces.
 *
 * DÓNDE SE CACHEA, Y POR QUÉ ACÁ Y NO EN n8n. Las lecturas ocurren en la Cloud
 * Function, así que es acá donde ahorrarlas cuenta. n8n no tiene un caché HTTP
 * propio; lo que tiene (`$getWorkflowStaticData`) se persiste al final de cada
 * ejecución, pierde escrituras entre ejecuciones simultáneas y engorda la fila
 * del flujo en la base con cada refresco. Y hay una razón de fondo: desde el
 * tope por ventana (ver `planes.ts`) la respuesta lleva un dato POR CLIENTE
 * que no puede tener 60 segundos de retraso; si n8n cacheara la respuesta
 * entera, cachearía también el contador. Acá se cachea lo del comercio y se
 * lee fresco lo del cliente.
 *
 * EL CONTRATO DE 60 SEGUNDOS. `ingesta.ts` lo dice desde el primer día: la
 * configuración no se cachea más de 60 s porque la suspensión de un comercio
 * es una palanca comercial y tiene que surtir efecto ya. Este caché lo cumple
 * por construcción: el vencimiento es el único mecanismo, y no hay
 * invalidación remota porque cada instancia de la función tiene su propia
 * memoria. Además, `configuracionFlujo` lee el ESTADO del comercio fresco en
 * cada llamada —una lectura— y cachea el resto: la suspensión corta al
 * instante, y el caché solo difiere lo que puede esperar un minuto.
 *
 * ES POR INSTANCIA. Cloud Functions v2 mantiene la instancia viva entre
 * peticiones y atiende varias a la vez, así que con el tráfico de estas
 * demos casi todo cae en una o dos instancias calientes. Con mucho tráfico
 * habría más instancias y más fallos de caché; el peor caso es exactamente el
 * de hoy, nunca peor.
 *
 * UNA SOLA CARGA EN VUELO POR CLAVE. Si dos turnos del mismo comercio llegan
 * juntos con el caché vencido, el segundo espera la carga del primero en vez
 * de disparar otra. Un error NO se cachea: la próxima llamada vuelve a
 * intentar.
 */

export interface Entrada<T> {
  valor: T;
  /** De dónde salió: la memoria de la instancia o el origen (Firestore). */
  origen: 'memoria' | 'origen';
  /** Antigüedad del valor en milisegundos. 0 si se acaba de cargar. */
  edadMs: number;
}

interface Guardado<T> { valor: T; cargadoEn: number }

export interface CacheConTtl<T> {
  obtener(clave: string, cargar: () => Promise<T>): Promise<Entrada<T>>;
  invalidar(clave?: string): void;
  readonly tamano: number;
}

/**
 * @param ttlMs      cuánto vale un valor una vez cargado.
 * @param maximo     cota de entradas: se descarta la más vieja al superarla.
 *                   Un número acotado de comercios por instancia; el tope es
 *                   un seguro, no un dimensionamiento.
 * @param ahora      reloj inyectable, para las pruebas.
 */
export function cacheConTtl<T>(
  ttlMs: number,
  maximo = 500,
  ahora: () => number = () => Date.now(),
): CacheConTtl<T> {
  const guardados = new Map<string, Guardado<T>>();
  const enVuelo = new Map<string, Promise<T>>();

  return {
    async obtener(clave, cargar) {
      const t = ahora();
      const g = guardados.get(clave);
      if (g && t - g.cargadoEn < ttlMs) {
        return { valor: g.valor, origen: 'memoria', edadMs: t - g.cargadoEn };
      }

      let carga = enVuelo.get(clave);
      if (!carga) {
        carga = cargar().then((valor) => {
          // Se descarta la entrada más vieja (la primera insertada) al superar
          // el tope. Un Map conserva el orden de inserción.
          if (!guardados.has(clave) && guardados.size >= maximo) {
            const primera = guardados.keys().next().value;
            if (primera !== undefined) guardados.delete(primera);
          }
          guardados.delete(clave);
          guardados.set(clave, { valor, cargadoEn: ahora() });
          return valor;
        }).finally(() => { enVuelo.delete(clave); });
        enVuelo.set(clave, carga);
      }
      const valor = await carga;
      return { valor, origen: 'origen', edadMs: 0 };
    },

    invalidar(clave) {
      if (clave === undefined) guardados.clear();
      else guardados.delete(clave);
    },

    get tamano() { return guardados.size; },
  };
}
