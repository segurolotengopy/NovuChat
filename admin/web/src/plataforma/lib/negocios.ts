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
  MESES_MAXIMO, TCO_MAXIMO, TCO_MINIMO, aplicarPago, descripcionDe, esFecha, esPago, importeBs, montoUsdDe,
  type CuentaCruda, type Pago,
} from '../../lib/prepago';

/**
 * La MISMA forma que `ID_TENANT` de `functions/src/pagos.ts` e `index.ts`
 * (`pruebas/negocios-consola.test.ts` lo compara con la fuente). Importa para
 * `fijarCortePrepago`: con `tenantId` vacío la callable toca la COMPUERTA
 * GLOBAL (`index.ts`), así que la página de un comercio nunca llama a nada con
 * un identificador que el servidor no aceptaría.
 */
export const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
export const esIdTenant = (v: unknown): v is string => typeof v === 'string' && ID_TENANT.test(v);

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

/**
 * Días hacia atrás que `registrarPagoManual` acepta para `tcoFecha`
 * (`TCO_MANUAL_DIAS_MAXIMO` de `functions/src/pagos.ts`, que no se importa
 * porque ese módulo arrastra el SDK Admin; la prueba lo compara con la fuente).
 */
export const TCO_MANUAL_DIAS_MAXIMO = 31;

/**
 * LO QUE EL SERVIDOR RECHAZA ANTES DE MIRAR LA EVIDENCIA, replicado ANTES de
 * subirla (revisión de seguridad de #203, LOW 1). `registrarPagoManual`
 * valida referencia, TCO, fuente, fecha e importe recibido y recién después
 * comprueba el objeto en Storage: si la consola subiera el comprobante y el
 * servidor rechazara el resto, quedaría una evidencia huérfana bajo un
 * `pagoId` sin pago. Los topes son los del módulo compartido (`TCO_MINIMO`,
 * `TCO_MAXIMO`, `esFecha`); no hay números propios. Devuelve el motivo, en
 * las mismas palabras del servidor, o `null` si todo es aceptable.
 */
export function motivoDeRechazoPrevio(pedido: {
  referencia: string; tcoAplicado: number; tcoFuente: string; tcoFecha: string; montoRecibidoBs: number;
}, ahoraMs: number): string | null {
  if (!pedido.referencia.trim()) return 'referencia es obligatoria: el número de operación, o «recibido por <nombre>» en efectivo.';
  const tco = pedido.tcoAplicado;
  if (typeof tco !== 'number' || !Number.isFinite(tco) || tco < TCO_MINIMO || tco > TCO_MAXIMO) {
    return `tcoAplicado tiene que ser un número entre ${TCO_MINIMO} y ${TCO_MAXIMO}.`;
  }
  if (!pedido.tcoFuente.trim()) return 'tcoFuente es obligatoria (por ejemplo, BCB).';
  const f = pedido.tcoFecha;
  if (!esFecha(f) || !Number.isFinite(Date.parse(`${f}T12:00:00Z`)) || Date.parse(`${f}T00:00:00Z`) > ahoraMs + 86_400_000) {
    return 'tcoFecha tiene que ser aaaa-mm-dd y no puede ser futura.';
  }
  if (ahoraMs - Date.parse(`${f}T00:00:00Z`) > (TCO_MANUAL_DIAS_MAXIMO + 1) * 86_400_000) {
    return `tcoFecha no puede tener más de ${TCO_MANUAL_DIAS_MAXIMO} días.`;
  }
  const recibido = pedido.montoRecibidoBs;
  if (!Number.isInteger(recibido) || recibido < 0) return 'montoRecibidoBs tiene que ser un entero en bolivianos.';
  return null;
}

/** El día de hoy en Bolivia (UTC−4), `aaaa-mm-dd`: así fecha el BCB su tipo de cambio. */
export const diaBolivia = (ms: number): string => new Date(ms - 4 * 3_600_000).toISOString().slice(0, 10);

// -----------------------------------------------------------------------------
// EL ERROR DEL SERVIDOR, TAL CUAL
// -----------------------------------------------------------------------------

/** El error del servidor, tal cual (`lib/errores.ts`, compartido con Central). */
export { mensajeDeError } from '../../lib/errores';

/** `registrarPagoManual` exige una sesión de hace menos de media hora: con este código la pantalla ofrece volver a entrar. */
export const pideSesionReciente = (e: unknown): boolean =>
  (e as { code?: unknown } | undefined)?.code === 'functions/unauthenticated';

// -----------------------------------------------------------------------------
// LOS PAGOS EN REVISIÓN: el banco confirmó y NovuChat no lo aplicó solo
// -----------------------------------------------------------------------------

/**
 * POR QUÉ EXISTE (revisión de seguridad de #212, tercera vuelta, LOW 1). El
 * cliente del cobrador deja un pago `pendiente` con `cobro.estado:
 * 'CONFIRMADO'` cuando la plata entró pero no se puede aplicar sola: entró
 * menos de lo que dice el QR, o el QR era de OTRO plan sin la firma del
 * propietario (`revision: 'plan_distinto'`). Hasta este bloque solo se
 * resolvía armando la petición a mano, y mientras tanto el comercio que pagó
 * podía quedar cortado. Negocios los lista y ofrece `confirmarPendiente`.
 */
export type MotivoDeRevision = 'plan_distinto' | 'importe_menor' | 'otro';

export interface PagoEnRevision {
  pagoId: string;
  descripcion: unknown;
  /** Lo que dice el QR, en bolivianos. */
  monto: number | null;
  /** Lo que el banco informó que entró; con eso se precarga el formulario. */
  montoRecibidoBs: number | null;
  /** El plan del QR, si es una mensualidad. */
  plan: string | null;
  motivo: MotivoDeRevision;
}

const numeroFinito = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * De los pagos leídos, los que esperan al propietario: `pendiente` y con el
 * cobro que el banco ya confirmó. Con la MISMA condición que exige el servidor
 * para `confirmarPendiente` (`pagos.ts`, `confirmarQrConfirmado`): lo que se
 * lista, se puede confirmar; lo que no, el servidor lo rechaza igual.
 */
export function pagosEnRevision(filas: ReadonlyArray<{ id: string } & Record<string, unknown>>): PagoEnRevision[] {
  const salida: PagoEnRevision[] = [];
  for (const f of filas) {
    const cobro = typeof f['cobro'] === 'object' && f['cobro'] !== null ? f['cobro'] as Record<string, unknown> : null;
    if (f['estado'] !== 'pendiente' || cobro?.['estado'] !== 'CONFIRMADO' || !ID_PAGO.test(f.id)) continue;
    const monto = numeroFinito(f['monto']);
    const recibido = numeroFinito(f['montoRecibidoBs']);
    const motivo: MotivoDeRevision = f['revision'] === 'plan_distinto' ? 'plan_distinto'
      : monto !== null && recibido !== null && recibido < monto ? 'importe_menor' : 'otro';
    salida.push({
      pagoId: f.id, descripcion: f['descripcion'], monto, montoRecibidoBs: recibido,
      plan: f['tipo'] === 'mensualidad' && typeof f['plan'] === 'string' ? f['plan'] : null, motivo,
    });
  }
  return salida;
}

/** El motivo que el servidor exige para confirmar a mano (`motivoDiferencia`, hasta 300). */
export const MOTIVO_CONFIRMACION_MAXIMO = 300;
export const motivoDeConfirmacionValido = (motivo: string): boolean => {
  const t = motivo.trim();
  return t.length >= 3 && t.length <= MOTIVO_CONFIRMACION_MAXIMO;
};

// -----------------------------------------------------------------------------
// TEXTOS DE CONFIRMACIÓN: lo que se le muestra al propietario antes de escribir
// -----------------------------------------------------------------------------

/** «Impulso → Pro». Un valor igual al actual no es un cambio. */
export function resumenDeCambio(rotulo: string, antes: string, despues: string): string | null {
  return antes === despues ? null : `${rotulo}: ${antes} → ${despues}`;
}
