/**
 * =============================================================================
 * LO QUE LA PÁGINA «NEGOCIOS» DE PLATAFORMA NECESITA SABER, SIN CALCULAR NADA
 * PROPIO (`Analisis/41` §1.2, §4 y §7 fila F1: absorbe A-3b del prepago)
 * =============================================================================
 *
 * Plataforma es la zona de NovuChat operando sobre sus comercios: asignar los
 * tres ejes, suspender y reactivar, cargar un pago a mano con comprobante y
 * encender el corte. Todo eso lo hace el SERVIDOR por callables; acá vive lo
 * puro que la pantalla necesita para pedirlo bien y contarlo bien:
 *
 *  - el `pagoId` que la consola genera UNA vez por formulario y reusa en los
 *    reintentos (`registrarPagoManual` lo exige: es la clave de idempotencia,
 *    revisión de seguridad de A-1, MEDIUM 1);
 *  - la ruta y el nombre del comprobante en Storage, con la forma que
 *    `storage.rules` acepta (`evidencia.jpg|png|pdf` bajo el `pagoId`);
 *  - la vista previa de un pago manual con el TCO que declara el propietario
 *    (que puede ser de otro día: hasta 31 atrás), calculada con `importeBs` y
 *    `aplicarPago`, las mismas funciones que aplica el servidor;
 *  - cómo leer el error del servidor tal cual (la pantalla acompaña, el
 *    servidor manda: `CLAUDE.md` §7).
 *
 * Módulo puro: no importa Firebase y se prueba sin emulador.
 */
import { FORMATOS, extensionDe, type ExtensionPlanes } from '../../lib/archivoPlanes';
import {
  MESES_MAXIMO, aplicarPago, descripcionDe, esPago, importeBs, montoUsdDe,
  type CuentaCruda, type Pago,
} from '../../lib/prepago';

// -----------------------------------------------------------------------------
// EL IDENTIFICADOR DEL PAGO
// -----------------------------------------------------------------------------

/** La misma forma que `ID_PAGO` de `functions/src/pagos.ts` y que exige `storage.rules`. */
export const ID_PAGO = /^[A-Za-z0-9_-]{22}$/;

/**
 * 16 bytes al azar en base64url: 22 caracteres, como `nuevoPagoId()` del
 * servidor. Se genera con `crypto.getRandomValues` (navegador y Node 20+).
 */
export function nuevoPagoId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let binario = '';
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// -----------------------------------------------------------------------------
// EL COMPROBANTE
// -----------------------------------------------------------------------------

export type ExtensionComprobante = ExtensionPlanes;

/** `tenants/{t}/pagos/{pagoId}/evidencia.{ext}`: lo que `storage.rules` deja subir al propietario antes de registrar. */
export const nombreEvidencia = (ext: ExtensionComprobante) => `evidencia.${ext}` as const;
export const rutaEvidencia = (tenantId: string, pagoId: string, ext: ExtensionComprobante) =>
  `tenants/${tenantId}/pagos/${pagoId}/${nombreEvidencia(ext)}`;

export const ACEPTA_COMPROBANTE = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';

export type ComprobanteValidado =
  | { ok: true; ext: ExtensionComprobante; contentType: string }
  | { ok: false; motivo: string };

const megas = (bytes: number) => (bytes / (1024 * 1024)).toLocaleString('es-BO', { maximumFractionDigits: 1 });

/**
 * Valida el comprobante en el navegador antes de subirlo, con los MISMOS
 * topes de `storage.rules` (PDF 10 MB, imagen 5 MB, tipo atado a la
 * extensión) y la firma de los primeros bytes de `archivoPlanes.ts`. No es
 * la defensa —la regla y el servidor lo son— sino el aviso en castellano.
 */
export async function validarComprobante(archivo: File): Promise<ComprobanteValidado> {
  const ext = extensionDe(archivo.name);
  if (!ext) return { ok: false, motivo: 'El comprobante tiene que ser un PDF, un JPG o un PNG.' };
  const formato = FORMATOS[ext];
  if (archivo.size === 0) return { ok: false, motivo: 'El archivo está vacío.' };
  if (archivo.size > formato.tope) {
    return { ok: false, motivo: `El archivo pesa ${megas(archivo.size)} MB y el tope es ${megas(formato.tope)} MB.` };
  }
  let cabeza: Uint8Array;
  try {
    cabeza = new Uint8Array(await archivo.slice(0, 8).arrayBuffer());
  } catch {
    return { ok: false, motivo: 'No se pudo leer el archivo. Pruebe de nuevo.' };
  }
  if (!formato.firma.every((b, i) => cabeza[i] === b)) {
    return { ok: false, motivo: `El archivo no es un ${formato.rotulo} de verdad, aunque se llame así.` };
  }
  return { ok: true, ext, contentType: formato.contentType };
}

// -----------------------------------------------------------------------------
// LA VISTA PREVIA DE UN PAGO MANUAL
// -----------------------------------------------------------------------------

export const MEDIOS_MANUALES = ['efectivo', 'transferencia'] as const;
export type MedioManual = (typeof MEDIOS_MANUALES)[number];
export const esMedioManual = (v: unknown): v is MedioManual =>
  v === 'efectivo' || v === 'transferencia';

export interface VistaDelPagoManual {
  descripcion: string;
  montoUsd: number;
  /** El importe de la lista al TCO declarado: lo que el servidor va a comparar con lo recibido. */
  montoBs: number;
  cubiertoHasta: string;
  bolsa: number;
  conRegalo: boolean;
}

/**
 * El TCO manual NO pasa por `tipoCambioVigente`: el propietario declara el del
 * día en que el comercio pagó, que puede tener hasta 31 días (el servidor
 * también lo acepta, `TCO_MANUAL_DIAS_MAXIMO`). Lo que sí es del servidor es
 * `importeBs`, y `aplicarPago` para decir hasta cuándo quedaría cubierto.
 */
export function vistaDelPagoManual(
  cuenta: CuentaCruda | null | undefined, pedido: Pago, tco: number, ahoraMs: number,
): VistaDelPagoManual | null {
  if (!esPago(pedido) || !Number.isFinite(tco) || tco <= 0) return null;
  const montoUsd = montoUsdDe(pedido);
  const tras = aplicarPago(cuenta, pedido, ahoraMs);
  return {
    descripcion: descripcionDe(pedido),
    montoUsd,
    montoBs: importeBs(montoUsd, tco),
    cubiertoHasta: tras.cubiertoHasta,
    bolsa: tras.bolsa,
    conRegalo: pedido.tipo === 'mensualidad' && pedido.meses === MESES_MAXIMO,
  };
}

/** El día de hoy en Bolivia (UTC−4), `aaaa-mm-dd`: así fecha el BCB su tipo de cambio. */
export const diaBolivia = (ms: number): string => new Date(ms - 4 * 3_600_000).toISOString().slice(0, 10);

// -----------------------------------------------------------------------------
// EL ERROR DEL SERVIDOR, TAL CUAL
// -----------------------------------------------------------------------------

/**
 * Las Functions de Plataforma escriben mensajes para la persona que opera
 * («El umbral de bloqueo tiene que ser mayor que el de operador», «Ese QR ya
 * se pagó»). Se muestran tal cual y no se tapan con «ocurrió un error», que
 * obligaría a mirar el registro del servidor para saber qué pasó.
 */
export function mensajeDeError(e: unknown, respaldo: string): string {
  const mensaje = (e as { message?: unknown } | undefined)?.message;
  return typeof mensaje === 'string' && mensaje.trim() !== '' && !/^internal$/i.test(mensaje)
    ? mensaje : respaldo;
}

/** `registrarPagoManual` exige una sesión de hace menos de media hora: con este código la pantalla ofrece volver a entrar. */
export const pideSesionReciente = (e: unknown): boolean =>
  (e as { code?: unknown } | undefined)?.code === 'functions/unauthenticated';

// -----------------------------------------------------------------------------
// TEXTOS DE CONFIRMACIÓN: lo que se le muestra al propietario antes de escribir
// -----------------------------------------------------------------------------

/** «Impulso → Pro». Un valor igual al actual no es un cambio. */
export function resumenDeCambio(rotulo: string, antes: string, despues: string): string | null {
  return antes === despues ? null : `${rotulo}: ${antes} → ${despues}`;
}
