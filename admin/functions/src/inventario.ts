/**
 * =============================================================================
 * MINI INVENTARIO — cuántos quedan, y quién se los llevó
 * =============================================================================
 *
 * No es un sistema de stock: es lo mínimo para que el asistente no venda lo que
 * ya no hay. Un comercio con depósito, lotes y vencimientos usa otra cosa; este
 * producto le sirve al que tiene doce tortas y quiere que a la treceava el
 * asistente diga «se acabaron» en vez de tomar el pedido.
 *
 * TRES DECISIONES QUE SOSTIENEN TODO LO DEMÁS:
 *
 * 1. EL NÚMERO Y SU HISTORIA NO PUEDEN DISCREPAR. Por eso el comercio NO puede
 *    escribir `stock` desde la consola: `firestore.rules` se lo prohíbe y tiene
 *    que pasar por `ajustarStock`, que mueve el número y anota el movimiento en
 *    la MISMA transacción. Si se pudiera escribir a mano, el reporte diría «se
 *    vendieron 8» y el saldo diría otra cosa, y a partir de ahí el reporte no
 *    sirve para nada. Es la misma razón por la que el veredicto de las fotos
 *    vive donde el comercio no escribe.
 *
 * 2. CONTROLAR O NO CONTROLAR ES UN CAMPO AUSENTE, no un booleano. Un ítem con
 *    `stock` numérico se controla; sin el campo, no. Con un `controlarStock`
 *    aparte habría cuatro combinaciones —incluidas «controla pero no tiene
 *    número» y «no controla pero tiene 5»— y dos de ellas no significan nada.
 *
 * 3. DESCONTAR ES IDEMPOTENTE. El identificador del movimiento se arma con el
 *    pedido y el ítem (`{pedidoId}__{itemId}`), y se crea con `create`. Si la
 *    misma venta se procesa dos veces —un reintento, un webhook repetido— el
 *    segundo intento choca y no descuenta de nuevo. Sin esto, cualquier
 *    reintento se come el stock de verdad.
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, type Transaction } from 'firebase-admin/firestore';
import { REGION } from './region.js';

const db = () => getFirestore();
const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;

export type MotivoMovimiento = 'venta' | 'reposicion' | 'ajuste' | 'merma' | 'inicial';

/** ¿Este ítem lleva control de existencias? */
export const controlaStock = (item: Record<string, unknown> | undefined): boolean =>
  typeof item?.['stock'] === 'number' && Number.isFinite(item['stock'] as number);

/** Lo que queda, o `null` si el ítem no se controla. */
export const existencias = (item: Record<string, unknown> | undefined): number | null =>
  controlaStock(item) ? Math.max(0, Math.trunc(item?.['stock'] as number)) : null;

/**
 * ¿Se puede ofrecer? Un ítem SIN control siempre se puede: no saber cuántos hay
 * no es lo mismo que saber que hay cero. Confundir las dos cosas dejaría a todo
 * el catálogo actual —que no tiene stock cargado— marcado como agotado el día
 * que esto se despliegue.
 */
export function hayParaVender(item: Record<string, unknown> | undefined, cantidad = 1): boolean {
  const q = existencias(item);
  return q === null || q >= cantidad;
}

/** Un identificador de movimiento que se repite si la venta se repite. */
export const idMovimiento = (referencia: string, itemId: string): string =>
  `${referencia}__${itemId}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 200);

export interface Movimiento {
  itemId: string;
  nombre: string;
  /** Negativo descuenta, positivo repone. */
  delta: number;
  motivo: MotivoMovimiento;
  /** Con qué se relaciona: un pedido, un cierre, o vacío para un ajuste a mano. */
  referencia: string;
  /** Lo que quedó DESPUÉS del movimiento. Se guarda para no recalcular el reporte. */
  saldo: number;
  por: string;
}

/**
 * Mueve el stock de un ítem y anota el movimiento, en una sola transacción.
 *
 * NUNCA DEJA EL SALDO EN NEGATIVO. Si se piden 5 y hay 3, descuenta 3 y lo dice
 * en `faltaron`. Rechazar la venta entera sería peor: el pedido ya se hizo y el
 * cliente ya pagó o está por pagar; lo que el comercio necesita es enterarse,
 * no que el sistema le esconda una venta.
 */
export async function moverStock(
  tenantId: string, itemId: string, delta: number,
  motivo: MotivoMovimiento, referencia: string, por: string,
): Promise<{ aplicado: number; saldo: number; faltaron: number } | null> {
  const refItem = db().doc(`tenants/${tenantId}/catalogo/${itemId}`);
  const idMov = referencia === '' ? db().collection('x').doc().id : idMovimiento(referencia, itemId);
  const refMov = db().doc(`tenants/${tenantId}/movimientosStock/${idMov}`);

  return db().runTransaction(async (tx: Transaction) => {
    const item = await tx.get(refItem);
    if (!item.exists) return null;
    const datos = item.data() ?? {};
    if (!controlaStock(datos)) return null;          // este ítem no lleva stock

    // Idempotencia: si el movimiento ya existe, esta venta ya se descontó.
    if (referencia !== '') {
      const previo = await tx.get(refMov);
      if (previo.exists) {
        return { aplicado: 0, saldo: existencias(datos) ?? 0, faltaron: 0 };
      }
    }

    const antes = existencias(datos) ?? 0;
    const pedido = Math.trunc(delta);
    const aplicado = pedido < 0 ? -Math.min(antes, -pedido) : pedido;
    const faltaron = pedido < 0 ? (-pedido) - (-aplicado) : 0;
    const saldo = Math.max(0, antes + aplicado);

    tx.update(refItem, { stock: saldo });
    tx.create(refMov, {
      itemId,
      nombre: String(datos['nombre'] ?? ''),
      delta: aplicado,
      motivo,
      referencia,
      saldo,
      por,
      fecha: FieldValue.serverTimestamp(),
      ...(faltaron > 0 ? { faltaron } : {}),
    } satisfies Partial<Movimiento> & Record<string, unknown>);
    return { aplicado, saldo, faltaron };
  }).catch(() => null);
}

/**
 * Descuenta todos los ítems de un pedido.
 *
 * Se llama DESPUÉS de que el pedido quedó escrito, y a propósito: si fallara el
 * descuento, lo que queda es un pedido real sin su movimiento —visible en el
 * reporte— y no un stock descontado por un pedido que nunca existió. De los dos
 * desajustes posibles, este es el que se puede arreglar mirando.
 */
export async function descontarPedido(
  tenantId: string, pedidoId: string,
  items: Array<{ id?: unknown; cantidad?: unknown }>, por: string,
): Promise<{ itemId: string; faltaron: number }[]> {
  const faltantes: { itemId: string; faltaron: number }[] = [];
  for (const it of items) {
    const id = typeof it.id === 'string' ? it.id : '';
    const cantidad = typeof it.cantidad === 'number' && it.cantidad > 0 ? Math.trunc(it.cantidad) : 0;
    if (id === '' || cantidad === 0) continue;
    const r = await moverStock(tenantId, id, -cantidad, 'venta', pedidoId, por);
    if (r && r.faltaron > 0) faltantes.push({ itemId: id, faltaron: r.faltaron });
  }
  return faltantes;
}

// ---------------------------------------------------------------------------
// AJUSTE A MANO, desde la consola
// ---------------------------------------------------------------------------

export const ajustarStock = onCall({ region: REGION }, async (peticion: CallableRequest) => {
  const uid = peticion.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Hay que iniciar sesión.');
  const d = (peticion.data ?? {}) as Record<string, unknown>;
  const tenantId = typeof d['tenantId'] === 'string' ? d['tenantId'] : '';
  const itemId = typeof d['itemId'] === 'string' ? d['itemId'].slice(0, 80) : '';
  if (!ID_TENANT.test(tenantId) || itemId === '') {
    throw new HttpsError('invalid-argument', 'Identificador inválido.');
  }
  // El stock decide qué puede vender el negocio: lo toca su administrador.
  const nc = (peticion.auth?.token?.['nc'] ?? {}) as { t?: Record<string, string> };
  if ((nc.t ?? {})[tenantId] !== 'admin') {
    throw new HttpsError('permission-denied', 'Solo el administrador del negocio.');
  }

  const motivo = ['reposicion', 'ajuste', 'merma', 'inicial'].includes(String(d['motivo']))
    ? d['motivo'] as MotivoMovimiento : 'ajuste';

  // Dos operaciones distintas y explícitas: FIJAR el número que hay (contar el
  // depósito) o SUMAR lo que entró. Con una sola, el comercio que repone diez
  // termina dejando diez donde tenía cuarenta.
  const fijarEn = d['fijarEn'];
  const sumar = d['sumar'];

  if (typeof fijarEn === 'number' && Number.isFinite(fijarEn)) {
    const objetivo = Math.max(0, Math.trunc(fijarEn));
    const refItem = db().doc(`tenants/${tenantId}/catalogo/${itemId}`);
    const r = await db().runTransaction(async (tx) => {
      const item = await tx.get(refItem);
      if (!item.exists) throw new HttpsError('not-found', 'Ese ítem no existe.');
      const antes = existencias(item.data() ?? {});
      const delta = objetivo - (antes ?? 0);
      tx.update(refItem, { stock: objetivo });
      tx.create(db().doc(`tenants/${tenantId}/movimientosStock/${db().collection('x').doc().id}`), {
        itemId, nombre: String(item.get('nombre') ?? ''), delta,
        motivo: antes === null ? 'inicial' : motivo,
        referencia: '', saldo: objetivo, por: uid, fecha: FieldValue.serverTimestamp(),
      });
      return { saldo: objetivo, delta };
    });
    return r;
  }

  if (typeof sumar === 'number' && Number.isFinite(sumar) && Math.trunc(sumar) !== 0) {
    const r = await moverStock(tenantId, itemId, Math.trunc(sumar), motivo, '', uid);
    if (!r) throw new HttpsError('failed-precondition', 'Ese ítem no lleva control de existencias.');
    return r;
  }

  throw new HttpsError('invalid-argument', 'Hay que decir `fijarEn` o `sumar`.');
});

/** Dejar de controlar un ítem: borra el número y lo anota. */
export const dejarDeControlarStock = onCall({ region: REGION }, async (peticion: CallableRequest) => {
  const uid = peticion.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Hay que iniciar sesión.');
  const d = (peticion.data ?? {}) as Record<string, unknown>;
  const tenantId = typeof d['tenantId'] === 'string' ? d['tenantId'] : '';
  const itemId = typeof d['itemId'] === 'string' ? d['itemId'].slice(0, 80) : '';
  if (!ID_TENANT.test(tenantId) || itemId === '') {
    throw new HttpsError('invalid-argument', 'Identificador inválido.');
  }
  const nc = (peticion.auth?.token?.['nc'] ?? {}) as { t?: Record<string, string> };
  if ((nc.t ?? {})[tenantId] !== 'admin') {
    throw new HttpsError('permission-denied', 'Solo el administrador del negocio.');
  }
  await db().doc(`tenants/${tenantId}/catalogo/${itemId}`)
    .update({ stock: FieldValue.delete() });
  return { ok: true };
});
