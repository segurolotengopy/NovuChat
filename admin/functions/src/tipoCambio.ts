/**
 * =============================================================================
 * TIPO DE CAMBIO OFICIAL DEL BCB — la conversión de la lista al cobro
 * =============================================================================
 *
 * La lista de precios se denomina en dólares y se cobra en bolivianos (ver
 * `prepago.ts`, MONEDA_LISTA). Este módulo trae el tipo de cambio con el que se
 * hace esa conversión.
 *
 * TRES REGLAS QUE NO HAY QUE AFLOJAR
 * ----------------------------------
 *
 * 1. NOVUCHAT NO INVENTA UN TIPO DE CAMBIO. El valor sale de
 *    `plataforma/tipoCambio`, que se carga con el Tipo de Cambio Oficial que
 *    publica el Banco Central de Bolivia. Si falta o es inválido, esto LANZA:
 *    no hay valor por defecto y no se cotiza «con lo último que había». Cobrar
 *    con un tipo de cambio supuesto es peor que no poder cobrar, porque el
 *    error se descubre cuando el cliente ya pagó.
 *
 * 2. UN TCO POR MES, FIJO PARA TODO EL MES. Es lo recomendado en `Analisis/17`
 *    §3.0: bajo tipo de cambio flexible el importe en bolivianos se movería mes
 *    a mes, y para una PyME saber de antemano cuánto va a pagar vale más que la
 *    diferencia de unos centavos. Si el documento trae el TCO de un mes
 *    anterior, se usa igual y se avisa en el registro: es mejor cobrar con el
 *    del mes pasado, que es verificable, que no poder cobrar. Lo que nunca se
 *    hace es inventarlo.
 *
 * 3. EL TCO APLICADO SE GUARDA EN CADA PAGO. Sin eso no se puede reconstruir
 *    una factura: seis meses después nadie sabe con qué tipo de cambio se
 *    convirtieron esos bolivianos. Lo hace `cuentas.ts` al registrar el pago.
 *
 * SE CACHEA UNA HORA. Cambia una vez al mes; leerlo en cada turno de una
 * conversación de cobro sería pagar una lectura por un número que no se mueve.
 */
import { getFirestore } from 'firebase-admin/firestore';
import { cacheConTtl } from './cache.js';
import { esTipoCambio, type TipoCambio } from './prepago.js';

/** Un mes se mide en meses; una hora de retraso al cargarlo es irrelevante. */
export const CACHE_TIPO_CAMBIO_MS = 60 * 60 * 1000;

export const RUTA_TIPO_CAMBIO = 'plataforma/tipoCambio';

const cache = cacheConTtl<TipoCambio>(CACHE_TIPO_CAMBIO_MS);

export class SinTipoDeCambio extends Error {
  constructor(motivo: string) {
    super(`No hay tipo de cambio para cotizar: ${motivo}. `
      + `Cárguelo en ${RUTA_TIPO_CAMBIO} con el TCO del BCB `
      + '(admin/scripts/fijar-tipo-cambio.mjs).');
    this.name = 'SinTipoDeCambio';
  }
}

/**
 * El tipo de cambio vigente. LANZA `SinTipoDeCambio` si no hay uno válido.
 *
 * `periodo` es solo para el aviso: si el guardado es de otro mes, se usa igual
 * y se deja constancia en el log. Quien decide dejar de cotizar es la ausencia
 * del dato, no su antigüedad.
 */
export async function tipoCambioVigente(periodo: string): Promise<TipoCambio> {
  const { valor } = await cache.obtener('tco', async () => {
    const doc = await getFirestore().doc(RUTA_TIPO_CAMBIO).get();
    if (!doc.exists) throw new SinTipoDeCambio('el documento no existe');
    const datos = doc.data();
    if (!esTipoCambio(datos)) throw new SinTipoDeCambio('el documento no tiene la forma esperada');
    return datos;
  });

  if (valor.periodo !== periodo) {
    console.warn(`Tipo de cambio del periodo ${valor.periodo} usado en ${periodo}: `
      + 'cargue el del mes en curso.');
  }
  return valor;
}

/** Para las pruebas y para un despliegue nuevo: olvida lo cacheado. */
export function olvidarTipoCambio(): void {
  cache.invalidar();
}
