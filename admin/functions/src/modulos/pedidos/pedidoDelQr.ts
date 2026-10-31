/**
 * EL PEDIDO TOMADO POR WHATSAPP LLEGA A «PEDIDOS» (PR-4, diseño del 28/10/2026).
 *
 * Cuando el flujo reporta que envió el QR (`qr_enviado`) con las líneas del
 * carrito, el servidor crea `tenants/{t}/pedidos/wa_<referencia saneada>`
 * RECALCULANDO los precios desde `tenants/{t}/catalogo`. Lo que el flujo diga de
 * precios o de total se ignora: del flujo salen solo identificadores,
 * cantidades y un detalle de texto. Es la misma garantía del checkout web.
 *
 * Dos piezas:
 *  - `armarPedidoWa`: PURA. Recibe los documentos del catálogo ya leídos.
 *  - `crearPedidoWa`: la escritura (`create()` con id determinista) y el cierre
 *    del pedido anterior (`reemplazado` / `cancelado`).
 *
 * LO QUE NO HACE, a propósito:
 *  - No suma el delivery: el total del flujo no lo incluye y el cotejo del pago
 *    sigue usando el monto del QR. El pedido guarda las dos cifras.
 *  - No frena el pago si los totales difieren: marca `totalDistinto`.
 *  - No descuenta stock (decisión del diseño).
 *  - No deja el NIT/CI en ningún otro lugar: `facturacion` vive solo dentro del
 *    pedido y nunca pasa por `registrar`, `logger` ni auditoría.
 *
 * El `tenantId` lo da quien llama (sale de la ruta autenticada de la ingesta),
 * jamás del cuerpo. Los ids de ítem son un solo segmento y se leen solo en
 * `tenants/${tenantId}/catalogo`.
 */
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { enmascarar, registrar } from '../../core/turno/bitacora.js';
import { tieneModulo, type FichaConCapacidades } from '../../registro.js';
import { idDeItemValido, lineaLimpia, sePuedeComprar, ubicacionDeEntrega } from './comprable.js';

const db = () => getFirestore();

export const MAX_LINEAS_WA = 30;
export const MAX_UNIDADES_WA = 50;
export const MAX_DETALLE_WA = 120;
const MAX_NOMBRE = 80;
const MAX_DIRECCION = 200;
const MAX_NOMBRE_FACTURA = 80;
const MAX_DOCUMENTO = 20;
const MAX_ID_REFERENCIA = 60;
const TENANT_VALIDO = /^[a-z0-9][a-z0-9-]{2,59}$/;

export interface EntregaWa {
  tipo?: unknown; direccion?: unknown; ubicacion?: unknown;
}
export type DocsCatalogo = Record<string, Record<string, unknown> | undefined>;

export type MotivoSinPedido = 'sin_lineas' | 'monedas_mezcladas';

export interface PedidoWa {
  origen: 'whatsapp';
  conversacionId: string;
  telefonoEnmascarado: string;
  items: Array<Record<string, unknown>>;
  total: number;
  moneda: 'BOB' | 'USD';
  costoEnvio: 0;
  entrega: 'envio' | 'retiro';
  direccion?: string;
  ubicacion?: { lat: number; lng: number };
  referenciaQr: string;
  descartados?: string[];
  totalServidorCentavos: number;
  montoQrCentavos: number | null;
  totalDistinto: boolean;
  facturacion?: { nombre: string; documento: string };
  estado: 'recibido';
}

export interface ResultadoArmado {
  pedido: PedidoWa | null;
  descartados: string[];
  motivo?: MotivoSinPedido;
}

const centavos = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null;

/** NIT/CI: solo letras, dígitos y guion, hasta 20. Vacío = no hay facturación. */
function facturacionLimpia(v: unknown): { nombre: string; documento: string } | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const f = v as Record<string, unknown>;
  const documento = typeof f['documento'] === 'string'
    ? f['documento'].replace(/[^A-Za-z0-9-]/g, '').slice(0, MAX_DOCUMENTO) : '';
  if (documento === '') return null;
  return { nombre: lineaLimpia(f['nombre'], MAX_NOMBRE_FACTURA), documento };
}

/** El id del pedido: `wa_` + la referencia saneada a [A-Za-z0-9_-]{1,60}. null si no queda nada. */
export function idDePedidoWa(referencia: unknown): string | null {
  if (typeof referencia !== 'string') return null;
  const t = referencia.trim();
  // Si al sanear cambia algo, dos referencias distintas podrían chocar en un mismo id: se rechaza.
  if (t === '' || t.length > MAX_ID_REFERENCIA || !/^[A-Za-z0-9_-]+$/.test(t) || /^_+$/.test(t)) return null;
  return `wa_${t}`;
}

/** Los ids de ítem que vale la pena leer del catálogo (válidos, sin repetir, hasta el tope). */
export function idsDeLineas(lineas: unknown): string[] {
  const vistos = new Set<string>();
  if (!Array.isArray(lineas)) return [];
  for (const l of lineas.slice(0, MAX_LINEAS_WA)) {
    const id = (l as Record<string, unknown> | null)?.['id'];
    if (typeof id === 'string' && idDeItemValido(id)) vistos.add(id);
  }
  return [...vistos];
}

/**
 * Arma el pedido, PURA. `docsCatalogo` es lo leído de `tenants/{t}/catalogo`
 * por id: ausente o `undefined` = no existe; `activo` debe ser `true`.
 */
export function armarPedidoWa(
  lineas: unknown,
  entrega: unknown,
  facturacion: unknown,
  docsCatalogo: DocsCatalogo,
  referencia: unknown,
  telefono: unknown,
  montoQr: unknown,
): ResultadoArmado {
  const crudas = Array.isArray(lineas) ? lineas.slice(0, MAX_LINEAS_WA) : [];
  const items: Array<Record<string, unknown>> = [];
  const descartados: string[] = [];
  const vistas = new Set<string>();
  let moneda: 'BOB' | 'USD' | '' = '';
  let totalCent = 0;

  for (const cruda of crudas) {
    if (typeof cruda !== 'object' || cruda === null) continue;
    const c = cruda as Record<string, unknown>;
    const id = c['id'];
    if (typeof id !== 'string' || !idDeItemValido(id)) continue;
    if (vistas.has(id)) continue;
    vistas.add(id);
    const cantidad = typeof c['cantidad'] === 'number' ? Math.trunc(c['cantidad']) : NaN;
    if (!Number.isFinite(cantidad) || cantidad < 1 || cantidad > MAX_UNIDADES_WA) {
      descartados.push(id); continue;
    }
    const d = Object.prototype.hasOwnProperty.call(docsCatalogo, id) ? docsCatalogo[id] : undefined;
    if (!d || d['activo'] !== true || !sePuedeComprar(d)) { descartados.push(id); continue; }
    const precio = d['precio'] as number;
    const m: 'BOB' | 'USD' = d['moneda'] === 'USD' ? 'USD' : 'BOB';
    if (moneda === '') moneda = m;
    else if (moneda !== m) return { pedido: null, descartados, motivo: 'monedas_mezcladas' };
    const subtotalCent = Math.round(precio * 100) * cantidad;
    totalCent += subtotalCent;
    const detalle = lineaLimpia(c['detalle'], MAX_DETALLE_WA);
    items.push({
      id,
      nombre: lineaLimpia(d['nombre'], MAX_NOMBRE),
      cantidad,
      precio,
      moneda: m,
      subtotal: subtotalCent / 100,
      ...(detalle ? { detalle } : {}),
    });
  }

  if (items.length === 0) return { pedido: null, descartados, motivo: 'sin_lineas' };

  const e = (typeof entrega === 'object' && entrega !== null ? entrega : { tipo: entrega }) as EntregaWa;
  const tipo: 'envio' | 'retiro' = e.tipo === 'envio' ? 'envio' : 'retiro';
  const direccion = tipo === 'envio' ? lineaLimpia(e.direccion, MAX_DIRECCION) : '';
  const ubicacion = ubicacionDeEntrega(e.ubicacion, tipo);
  const factura = facturacionLimpia(facturacion);
  const montoQrCent = centavos(montoQr);
  const digitos = typeof telefono === 'string' ? telefono.replace(/[^0-9]/g, '') : '';

  return {
    pedido: {
      origen: 'whatsapp',
      conversacionId: `wa_${digitos}`,
      telefonoEnmascarado: enmascarar(telefono),
      items,
      total: totalCent / 100,
      moneda: moneda as 'BOB' | 'USD',
      costoEnvio: 0,
      entrega: tipo,
      ...(direccion ? { direccion } : {}),
      ...(ubicacion ? { ubicacion } : {}),
      referenciaQr: typeof referencia === 'string' ? lineaLimpia(referencia, 150) : '',
      ...(descartados.length ? { descartados } : {}),
      totalServidorCentavos: totalCent,
      montoQrCentavos: montoQrCent,
      // Sin monto del QR no hay con qué comparar: queda marcado para revisar.
      totalDistinto: montoQrCent === null || montoQrCent !== totalCent,
      ...(factura ? { facturacion: factura } : {}),
      estado: 'recibido',
    },
    descartados,
  };
}

export type ResultadoEscritura =
  | { resultado: 'creado'; id: string }
  | { resultado: 'repetido'; id: string }
  | { resultado: 'sin_pedido'; motivo: MotivoSinPedido | 'modulo_apagado' | 'referencia_del_checkout' | 'referencia_invalida' | 'tenant_invalido' }
  | { resultado: 'error' };

export interface EntradaPedidoWa {
  tenantId: string;
  /** La ficha del tenant, que la ingesta ya tiene leída: sin lecturas extra. */
  ficha: FichaConCapacidades | null | undefined;
  referencia: unknown;
  telefono: unknown;
  montoQr: unknown;
  lineas: unknown;
  entrega: unknown;
  facturacion?: unknown;
  /** La referencia del QR abierto antes de este, si cambió el carrito. */
  referenciaAnterior?: unknown;
}

const alreadyExists = (e: unknown): boolean => {
  const c = (e as { code?: unknown } | null)?.code;
  return c === 6 || c === 'already-exists' || c === 'ALREADY_EXISTS';
};

/** Pasa un pedido `wa_` de `recibido` a `reemplazado` o `cancelado`. Solo si sigue en `recibido`. */
export async function cerrarPedidoWa(
  tenantId: string, referencia: unknown, nuevo: 'reemplazado' | 'cancelado',
): Promise<boolean> {
  if (!TENANT_VALIDO.test(tenantId)) return false;
  const id = idDePedidoWa(referencia);
  if (!id) return false;
  const ref = db().doc(`tenants/${tenantId}/pedidos/${id}`);
  return db().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists || s.get('origen') !== 'whatsapp' || s.get('estado') !== 'recibido') return false;
    tx.update(ref, { estado: nuevo, [`${nuevo}En`]: Timestamp.now() });
    return true;
  });
}

/**
 * Crea el pedido. Nunca lanza: si falla, deja un `error_flujo` SIN datos del
 * pedido (ni documento de facturación) y devuelve `error`; el cobro sigue.
 */
export async function crearPedidoWa(e: EntradaPedidoWa): Promise<ResultadoEscritura> {
  if (!TENANT_VALIDO.test(e.tenantId)) return { resultado: 'sin_pedido', motivo: 'tenant_invalido' };
  if (!tieneModulo(e.ficha, 'pedidos')) return { resultado: 'sin_pedido', motivo: 'modulo_apagado' };
  const ref = typeof e.referencia === 'string' ? e.referencia.trim() : '';
  if (ref.startsWith('cat_')) return { resultado: 'sin_pedido', motivo: 'referencia_del_checkout' };
  const id = idDePedidoWa(ref);
  if (!id) return { resultado: 'sin_pedido', motivo: 'referencia_invalida' };
  try {
    const ids = idsDeLineas(e.lineas);
    const docs: DocsCatalogo = {};
    if (ids.length > 0) {
      const leidos = await db().getAll(...ids.map((i) => db().doc(`tenants/${e.tenantId}/catalogo/${i}`)));
      leidos.forEach((d, i) => { docs[ids[i] as string] = d.exists ? (d.data() as Record<string, unknown>) : undefined; });
    }
    const { pedido, motivo } = armarPedidoWa(
      e.lineas, e.entrega, e.facturacion, docs, ref, e.telefono, e.montoQr,
    );
    if (!pedido) return { resultado: 'sin_pedido', motivo: motivo as MotivoSinPedido };
    try {
      await db().doc(`tenants/${e.tenantId}/pedidos/${id}`).create({ ...pedido, creadoEn: Timestamp.now() });
    } catch (err) {
      if (alreadyExists(err)) return { resultado: 'repetido', id };
      throw err;
    }
    const anterior = typeof e.referenciaAnterior === 'string' ? e.referenciaAnterior.trim() : '';
    if (anterior !== '' && anterior !== ref) {
      // El pedido nuevo ya existe: un fallo al cerrar el anterior no lo deshace.
      try { await cerrarPedidoWa(e.tenantId, anterior, 'reemplazado'); } catch { /* queda en recibido; se revisa a mano */ }
    }
    return { resultado: 'creado', id };
  } catch {
    try {
      await registrar(e.tenantId, { tipo: 'error_flujo', resultado: 'fallo', codigo: 'pedido_wa', detalle: 'no se pudo crear el pedido de WhatsApp' });
    } catch { /* nunca lanza */ }
    return { resultado: 'error' };
  }
}
