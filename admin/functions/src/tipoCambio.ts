/**
 * =============================================================================
 * EL TIPO DE CAMBIO DEL DÍA — `plataforma/tipoCambio { tco, fecha, fuente }`
 * =============================================================================
 *
 * NovuChat NO publica un tipo de cambio propio (`CLAUDE.md`, base comercial
 * §3): cobra en bolivianos al Tipo de Cambio Oficial que publica el BCB, y el
 * que rige es EL DEL DÍA EN QUE SE EMITE EL COBRO (decisión 3 del frente,
 * `DISENO.md` §4undecies.8 fila 2). Se guarda en cada pago con su fecha y su
 * fuente, o la factura no se reconstruye.
 *
 * DÓNDE VIVE: un solo documento, `plataforma/tipoCambio`, que escribe el
 * script `scripts/fijar-tipo-cambio.mjs` (seco por defecto, `--aplicar` con
 * el OK de Andres) y que ninguna pantalla puede tocar (`match /plataforma`:
 * solo lectura del propietario). Con historial en
 * `plataforma/tipoCambio/historial`.
 *
 * SIN TCO NO SE COBRA. Si el documento falta, está mal formado, tiene fecha
 * futura o tiene más de `TCO_DIAS_VIGENCIA` días (el BCB no publica los fines
 * de semana ni feriados: el del viernes vale hasta el martes), esto LANZA
 * `SinTipoDeCambio`, y quien iba a emitir un cobro responde
 * `failed-precondition`. Cobrar con un tipo de cambio supuesto es peor que no
 * poder cobrar, porque el error se descubre cuando el cliente ya pagó.
 *
 * La validación es la de `prepago.ts` (`tipoCambioVigente`), que también usa
 * la cobranza: un solo criterio de «este TCO sirve hoy».
 */
import { getFirestore } from 'firebase-admin/firestore';
import { TCO_DIAS_VIGENCIA, TCO_MAXIMO, TCO_MINIMO, esFecha, esTipoCambio, tipoCambioVigente, type TipoCambio } from './prepago.js';

export type { TipoCambio } from './prepago.js';

export class SinTipoDeCambio extends Error {
  constructor(readonly motivo: string) {
    super(`sin tipo de cambio del día: ${motivo}`);
    this.name = 'SinTipoDeCambio';
  }
}

/** La ruta del documento, para quien lo lea dentro de su propia transacción. */
export const RUTA_TIPO_CAMBIO = 'plataforma/tipoCambio';

/**
 * Valida un documento de tipo de cambio YA LEÍDO (puro). Lanza
 * `SinTipoDeCambio` con el motivo, para que el error de la callable diga por
 * qué no se pudo emitir y el propietario sepa qué cargar.
 */
export function tipoCambioDe(datos: unknown, ahoraMs: number): TipoCambio {
  if (typeof datos !== 'object' || datos === null) throw new SinTipoDeCambio('no hay tipo de cambio cargado');
  const d = datos as Record<string, unknown>;
  const tco = d['tco'];
  if (typeof tco !== 'number' || !Number.isFinite(tco)) throw new SinTipoDeCambio('tco ausente');
  if (tco < TCO_MINIMO || tco > TCO_MAXIMO) throw new SinTipoDeCambio(`tco fuera de rango (${TCO_MINIMO}..${TCO_MAXIMO})`);
  if (!esFecha(d['fecha'])) throw new SinTipoDeCambio('fecha ausente o mal formada (aaaa-mm-dd)');
  if (typeof d['fuente'] !== 'string' || d['fuente'].trim() === '') throw new SinTipoDeCambio('fuente ausente');
  if (!esTipoCambio(d)) throw new SinTipoDeCambio('documento mal formado');
  const vigente = tipoCambioVigente(d, ahoraMs);
  if (!vigente) throw new SinTipoDeCambio(`fecha futura o de más de ${TCO_DIAS_VIGENCIA} días`);
  // Solo los tres campos: lo demás del documento (quién lo cargó, cuándo) no
  // viaja a ningún pago.
  return { tco: vigente.tco, fecha: vigente.fecha, fuente: vigente.fuente };
}

/**
 * Lee `plataforma/tipoCambio` y devuelve el TCO que rige hoy, o lanza
 * `SinTipoDeCambio`. Es UNA lectura fuera de transacción: el TCO no compite
 * con nadie, y leerlo antes de abrir la transacción del pago deja a esa
 * transacción solo con lo que sí puede chocar (la cuenta y el pago).
 */
export async function tipoCambioDelDia(ahoraMs: number = Date.now()): Promise<TipoCambio> {
  const doc = await getFirestore().doc(RUTA_TIPO_CAMBIO).get();
  return tipoCambioDe(doc.data(), ahoraMs);
}
