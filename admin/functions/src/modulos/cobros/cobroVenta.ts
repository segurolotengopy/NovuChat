/**
 * =============================================================================
 * COBRO REAL DE UNA VENTA — lo propio de vender, frente a lo propio de agendar
 * =============================================================================
 *
 * POR QUÉ ESTE MÓDULO EXISTE. La maquinaria del cobro por QR se construyó para
 * la SEÑA de una reserva (`sena.ts`, `Analisis/30` §4): un importe FIJO que
 * vive en la configuración del comercio, un horario que se retiene y un reloj
 * que lo libera. Una venta no tiene nada de eso. Tiene un pedido, y el pedido
 * tiene un total distinto cada vez.
 *
 * LA DIFERENCIA QUE ORDENA TODO LO DEMÁS, y es una sola:
 *
 *   En una reserva, el importe esperado se LEE de la configuración.
 *   En una venta, el importe esperado se FIJA cuando sale el QR.
 *
 * De ahí sale la regla de este archivo: **el importe contra el que se coteja es
 * el que se cotizó en el momento de mandar el QR, no el que alguien repita
 * después**. El flujo lo reporta junto con el QR (`evento: 'qr_enviado'`,
 * campo `monto`), la ingesta lo guarda en `solicitud.monto` dentro de la misma
 * transacción que cuenta ese mensaje, y el cotejo lo lee de ahí. Es «por hecho,
 * no por dicho» aplicado al dinero: si el modelo escribiera después «son 200»,
 * no cambia nada, porque el número ya está guardado.
 *
 * Y CUANDO EL PEDIDO VINO DEL CARRITO WEB, el importe es todavía mejor:
 * `pedidos/{id}.total` lo calculó el servidor (`catalogoWeb.ts`, incluido el
 * costo de envío, «también del servidor, nunca del navegador»). Si la solicitud
 * trae un pedido, ese total gana sobre lo que mande el flujo.
 *
 * LO QUE NO SE PORTA DE LA SEÑA, y conviene decir por qué:
 *
 *  - **La retención del horario.** No hay horario que liberar. Lo que sí hay es
 *    un QR pendiente que tiene que CADUCAR, para que la foto de un pago de
 *    anteayer no se coteje contra el pedido de hoy (ver `MINUTOS_QR_VENTA`).
 *  - **El adelanto a favor.** Lo contrario de una cita cancelada con seña es
 *    una devolución de dinero, y eso no lo decide un asistente.
 *
 * LA PROHIBICIÓN 3 NO CAMBIA NI UNA LETRA. Con cobro real el asistente nunca
 * dice «pago acreditado», «pago verificado» ni «recibimos tu pago»: dice que el
 * comprobante llegó y que los datos coinciden. Quien confirma que entró la
 * plata es el negocio, en su banco. Ninguna frase de este archivo afirma un
 * pago, y `pruebas/cobro-venta.test.ts` lo comprueba con una expresión regular
 * sobre cada texto que sale de acá.
 */

import { Timestamp } from 'firebase-admin/firestore';
import type { Esperado, ResultadoCotejo } from './cotejo.js';

/**
 * CUÁNTO VIVE UN QR DE VENTA SIN PAGAR, en minutos.
 *
 * En una reserva el plazo es corto y tiene un motivo duro: hay un horario
 * bloqueado que otro paciente quiere. En una venta no hay nada bloqueado, así
 * que apretar el plazo solo sirve para castigar al cliente que fue al banco y
 * volvió media hora después.
 *
 * VEINTICUATRO HORAS, que es la ventana de la conversación (`Analisis/27`).
 * Dentro de ella el pedido sigue siendo el mismo asunto y el pago le
 * corresponde; fuera, es otra conversación y el comprobante lo mira una
 * persona. El plazo se ata a una unidad que ya existe en el sistema, en vez de
 * inventar un número nuevo que nadie pueda defender.
 */
export const MINUTOS_QR_VENTA = 24 * 60;

/** Techo del total de un pedido que se acepta para cotejar. Un número fuera de rango no coteja. */
export const TOTAL_VENTA_MAXIMO = 1_000_000;

/**
 * El identificador del cierre de una venta cotejada.
 *
 * ES LA MISMA CUENTA que `idDesdeReferencia` de `cierres.ts` —tipo, guion bajo,
 * referencia saneada a `[a-zA-Z0-9_-]` y recortada— y tiene que seguir
 * siéndolo: el cierre que crea el cotejo y el que crearía `registrarCierre`
 * para la misma venta tienen que caer en el MISMO documento, o la venta se
 * contaría dos veces. `pruebas/cobro-venta.test.ts` compara las dos.
 */
export function idDeCierreDeVenta(referencia: string): string {
  return `venta_${referencia.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120)}`;
}

/**
 * Lo que se ESPERA del comprobante de una venta.
 *
 * Igual que `esperadoDeLaSena`, pero el importe entra por parámetro en vez de
 * leerse de la configuración. Pura, para poder probar que el total que se
 * coteja es el del pedido y que la ventana de fechas va desde el envío del QR
 * hasta la llegada del comprobante.
 */
export function esperadoDeLaVenta(
  total: number,
  cobroReal: Record<string, unknown> | undefined,
  qrEnviadoEnMs: number,
  ahoraMs: number,
  toleranciaMin: number,
): Esperado {
  const cuentas = Array.isArray(cobroReal?.['cuentas'])
    ? (cobroReal['cuentas'] as unknown[]).slice(0, 5).map(String) : [];
  return {
    monto: total,
    nombreCuenta: String(cobroReal?.['nombreCuenta'] ?? ''),
    cuentas,
    qrEnviadoEn: qrEnviadoEnMs,
    comprobanteRecibidoEn: ahoraMs,
    toleranciaMin,
  };
}

/**
 * ¿Es un total de pedido utilizable para cotejar?
 *
 * Un total que no se puede usar NO se convierte en cero: con cero, el cotejo
 * diría «el comprobante dice 350 y el pedido es de 0» y mandaría a una persona
 * con un motivo falso. Sin total no se coteja nada y se lo dice tal cual.
 */
export function totalUtilizable(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (v <= 0 || v > TOTAL_VENTA_MAXIMO) return null;
  return Math.round(v * 100) / 100;
}

/** La frase del detalle privado del cierre, por resultado. Sin «acreditado». */
export function detalleDeLaVenta(total: number, moneda: string, resultado: ResultadoCotejo): string {
  const palabra = resultado === 'cuadra' ? 'los datos coinciden'
    : resultado === 'no_cuadra' ? 'con una diferencia' : 'ilegible';
  return `Pedido de ${total} ${moneda === 'BOB' ? 'Bs' : moneda}, comprobante ${palabra}`;
}

/**
 * ===========================================================================
 * EL COBRO, COMO LO RECIBE EL FLUJO DE VENTA (`configuracionFlujo.cobro`)
 * ===========================================================================
 *
 * Es el gemelo de `SenaParaElFlujo`, y existe por una razón que no es de
 * simetría: **sin esto, el flujo no sabe si hay un QR pendiente**, y sin eso
 * una foto cualquiera se toma por comprobante. Es lo que el Demo B hacía hasta
 * hoy —`esComprobante = true` para toda imagen— y es la puerta por la que se
 * colaba un cierre de venta que nadie pagó.
 *
 * SALE EN LOS DOS MODOS, real y simulado, y esto es deliberado: la compuerta
 * del comprobante tiene que funcionar también en la demostración, o el camino
 * que se prueba delante de un prospecto no es el que corre en producción.
 * `activo` distingue uno de otro; `pendiente` es del teléfono que escribió.
 *
 * QUÉ NO VIAJA: la carga útil del QR. Viaja su dirección pública, que el flujo
 * pone tal cual en el `link` del mensaje de imagen de WhatsApp.
 */
export interface CobroParaElFlujo {
  /** Cobro REAL encendido. `false` = el comercio está en cobro simulado. */
  activo: boolean;
  moneda: string;
  /** Importe grabado en el QR, si se pudo leer. En una venta, tenerlo es un defecto. */
  montoFijo: number | null;
  qr: { url: string; nombreCuenta: string; banco: string } | null;
  /** Hay un QR enviado y sin comprobante que cuadre: el próximo archivo se lee como comprobante. */
  pendiente: boolean;
  /** El total que se cotizó al mandar el QR. `null` si el flujo no lo mandó. */
  monto: number | null;
  /** El pedido al que corresponde el QR pendiente (`cat_…` si vino del carrito), o `null`. */
  pedido: string | null;
  qrEnviadoEn: string | null;
  /**
   * MINUTOS DESDE QUE EL QR PENDIENTE CADUCÓ, o `null`. Es el caso del cliente
   * que paga tarde: el comprobante llega, el pedido ya no está en curso, y el
   * asistente tiene que decir la verdad —llegó el comprobante, lo revisa una
   * persona— en vez de preguntarle «¿a qué corresponde?» a alguien que acaba de
   * pagar lo que se le pidió.
   */
  vencidoHaceMin: number | null;
  // --- Regla 2 (`reglaCobro: 2`, 03/10/2026; `cobros.md` §4duodecies.6) ------
  // En regla 1 salen con estos valores neutros y los campos de arriba no
  // cambian ni una letra.
  /** 1 = la de 24 h de siempre; 2 = 15 min, prórroga única y 3 intentos. */
  regla: 1 | 2;
  /** Cuándo vence el plazo base (ISO), solo en regla 2. */
  venceEn: string | null;
  /** Hasta cuándo llega la prórroga única (ISO), solo si ya se fijó. */
  prorrogaHasta: string | null;
  /** Comprobantes inválidos recibidos, solo en regla 2. */
  intentosInvalidos: number | null;
  /** Intentos que quedan antes de pasar a una persona, solo en regla 2. */
  intentosRestantes: number | null;
  /** El cobro está con una persona (tercer intento inválido): no vence por reloj. */
  enRevision: boolean;
  /**
   * El pedido que se anuló por falta de comprobante y que el cliente todavía no
   * sabe (anulación perezosa): solo si la etapa es `vencida`, sin aviso previo
   * y a lo sumo 24 h después del límite. `null` en cualquier otro caso.
   */
  anulado: { pedido: string | null; haceMin: number } | null;
}

/** La ventana en la que un pago tardío sigue siendo ESTE caso y no otra conversación. */
const MINUTOS_DE_UN_DIA = 24 * 60;

/** Milisegundos de un Timestamp de Firestore, de un ISO o de un número. */
function ms(v: unknown): number | null {
  const t = v as { toMillis?: () => number; seconds?: unknown } | null | undefined;
  if (typeof t?.toMillis === 'function') return t.toMillis();
  if (typeof t?.seconds === 'number') return t.seconds * 1000;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') { const p = Date.parse(v); return Number.isFinite(p) ? p : null; }
  return null;
}

/**
 * ¿El QR de venta pendiente ya caducó por reloj?
 *
 * Misma forma que `senaVencidaPorTiempo` y misma razón de fondo: un pendiente
 * que no caduca nunca convierte cualquier imagen en un pago. Acá no hay
 * calendario que lo cierre por el otro lado, así que el reloj es lo único que
 * hay, y por eso esta función es la que manda.
 */
export function qrDeVentaVencido(
  solicitud: { etapa?: unknown; qrEnviadoEn?: unknown } | null | undefined,
  ahoraMs: number,
  minutos: number = MINUTOS_QR_VENTA,
): { vencido: boolean; venceMs: number | null } {
  if (!solicitud || solicitud.etapa !== 'qr_enviado') return { vencido: false, venceMs: null };
  const enviado = ms(solicitud.qrEnviadoEn);
  if (enviado === null) return { vencido: false, venceMs: null };
  const venceMs = enviado + minutos * 60 * 1000;
  return { vencido: ahoraMs >= venceMs, venceMs };
}

export function cobroParaElFlujo(
  venta: Record<string, unknown> | undefined,
  cobroRealActivo: boolean,
  moneda: string,
  urlDelQr: (ficha: string) => string,
  solicitud: unknown,
  ahoraMs: number = Date.now(),
): CobroParaElFlujo {
  const cobroReal = (venta?.['cobroReal'] ?? {}) as Record<string, unknown>;
  const s = (typeof solicitud === 'object' && solicitud !== null ? solicitud : {}) as Record<string, unknown>;
  const enviado = s['qrEnviadoEn'];
  const regla2 = esReglaDos(s);
  const porReloj = qrDeVentaVencido(s, ahoraMs);
  const ev = s['evento'] as Record<string, unknown> | null | undefined;
  const limite = regla2 ? limiteDe(s) : null;
  // Regla 2: vencida es la etapa guardada o el reloj sobre un pendiente
  // (vencimiento perezoso: nadie lo escribió todavía, pero ya venció).
  const vencidaPorReloj = regla2 && s['etapa'] === 'qr_enviado' && limite !== null && ahoraMs >= limite;
  const vencida2 = regla2 && (s['etapa'] === 'vencida' || vencidaPorReloj);
  const haceMin2 = (): number | null => {
    if (!vencida2 || limite === null) return null;
    const min = Math.floor((ahoraMs - limite) / 60000);
    return min >= 0 && min <= MINUTOS_DE_UN_DIA ? min : null;
  };
  const intentos = regla2 ? numeroEntero(s['intentosInvalidos']) : null;
  const iso = (v: unknown): string | null => (ms(v) !== null ? new Date(ms(v) as number).toISOString() : null);

  return {
    activo: cobroRealActivo,
    moneda,
    montoFijo: typeof cobroReal['montoFijo'] === 'number' ? cobroReal['montoFijo'] : null,
    qr: cobroRealActivo
      ? {
          url: urlDelQr(String(cobroReal['ficha'] ?? '')),
          nombreCuenta: String(cobroReal['nombreCuenta'] ?? ''),
          banco: String(cobroReal['banco'] ?? ''),
        }
      : null,
    // PENDIENTE ES POR ETAPA Y POR RELOJ, igual que la seña: un QR cuyo plazo
    // pasó ya no está pendiente, y la próxima imagen vuelve a ser una imagen.
    // En regla 2 el reloj es el límite efectivo (plazo base o prórroga).
    pendiente: regla2
      ? s['etapa'] === 'qr_enviado' && !vencidaPorReloj
      : s['etapa'] === 'qr_enviado' && !porReloj.vencido,
    monto: totalUtilizable(s['monto']),
    pedido: ev && typeof ev['id'] === 'string' && ev['id'] !== '' ? ev['id'] : null,
    qrEnviadoEn: ms(enviado) !== null ? new Date(ms(enviado) as number).toISOString() : null,
    vencidoHaceMin: regla2 ? haceMin2() : (() => {
      if (!porReloj.vencido || porReloj.venceMs === null) return null;
      const min = Math.floor((ahoraMs - porReloj.venceMs) / 60000);
      return min >= 0 && min <= MINUTOS_DE_UN_DIA ? min : null;
    })(),
    regla: regla2 ? 2 : 1,
    venceEn: regla2 ? iso(s['venceEn']) : null,
    prorrogaHasta: regla2 ? iso(s['prorrogaHasta']) : null,
    intentosInvalidos: intentos,
    intentosRestantes: intentos === null ? null : Math.max(0, MAX_INTENTOS_INVALIDOS - intentos),
    enRevision: regla2 && s['etapa'] === 'en_revision',
    anulado: vencida2 && ms(s['anulacionAvisadaEn']) === null && haceMin2() !== null
      ? { pedido: ev && typeof ev['id'] === 'string' && ev['id'] !== '' ? ev['id'] : null, haceMin: haceMin2() as number }
      : null,
  };
}

/**
 * ===========================================================================
 * LA REGLA 2 DEL COBRO DE VENTA (Andres, 03/10/2026; `cobros.md` §4duodecies.6)
 * ===========================================================================
 *
 * QUÉ ES. Un plazo corto y un número de intentos, en vez de las 24 h de la
 * regla 1: el QR vive 15 minutos; el primer comprobante a tiempo concede UNA
 * prórroga de 10 minutos para corregir; el tercer comprobante inválido pasa el
 * cobro a una persona (`en_revision`, que no vence por reloj).
 *
 * LA ELIGE EL FLUJO, NO EL DESPLIEGUE (D1). El flujo manda `reglaCobro: 2` con
 * `qr_enviado`; sin ese campo, todo sigue como hoy. Desplegar esto no cambia
 * ningún flujo publicado.
 *
 * TODO ESTE BLOQUE ES PURO: recibe la solicitud previa y el evento, y devuelve
 * qué mezclar sobre `solicitud`, qué contadores sumar y qué pasó. Quien escribe
 * (la ingesta para los eventos del flujo, `cotejoVenta.ts` para el comprobante)
 * lo hace dentro de SU transacción: cero escrituras extra.
 */

/** Plazo base del QR de venta con regla 2. */
export const MINUTOS_QR_VENTA_REGLA_2 = 15;
/** Prórroga única, desde el primer comprobante recibido a tiempo. */
export const MINUTOS_PRORROGA = 10;
/** Comprobantes inválidos que se aceptan antes de pasar a una persona. */
export const MAX_INTENTOS_INVALIDOS = 3;
/** Cuántos comprobantes se anotan por solicitud (los siguientes no se anotan). */
export const MAX_COMPROBANTES = 6;

export type EstadoDeComprobante = 'valido' | 'aproximado' | 'invalido' | 'en_revision' | 'tardio';

export interface ComprobanteAnotado {
  idMeta: string;
  estado: EstadoDeComprobante;
  motivo: string;
  en: Timestamp;
  ruta: string | null;
}

function numeroEntero(v: unknown): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0;
}

/** ¿La solicitud corre con la regla 2? Pide `reglaCobro: 2` Y un `venceEn` legible. */
export function esReglaDos(s: Record<string, unknown> | null | undefined): boolean {
  return !!s && s['reglaCobro'] === 2 && ms(s['venceEn']) !== null;
}

/** El límite efectivo: lo mayor entre el plazo base y la prórroga. `null` sin regla 2. */
export function limiteDe(s: Record<string, unknown> | null | undefined): number | null {
  if (!s || !esReglaDos(s)) return null;
  return Math.max(ms(s['venceEn']) as number, ms(s['prorrogaHasta']) ?? 0);
}

/**
 * Los campos de la regla 2 en nulo. Se mezclan cuando una solicitud NUEVA de
 * regla 1 reemplaza a una de regla 2: la ingesta escribe con `merge`, que
 * conserva los campos que la nueva no nombra, y un `reglaCobro: 2` que
 * sobreviviera convertiría un QR de regla 1 en uno de regla 2.
 */
export const CAMPOS_REGLA_2_EN_NULO = {
  reglaCobro: null, venceEn: null, prorrogaHasta: null, intentosInvalidos: null,
  comprobantes: null, anulacionAvisadaEn: null,
} as const;

export type EventoDeCobro =
  | { tipo: 'qr_enviado'; reglaCobro?: unknown; idMeta?: string }
  | { tipo: 'cobro_cancelado' }
  | { tipo: 'anulacion_avisada' }
  /** Una lectura: solo materializa el vencimiento perezoso. */
  | { tipo: 'lectura' }
  | {
      tipo: 'comprobante';
      /** Lo que calificó `calificarComprobante` (con ilegible y no-comprobante como `invalido`). */
      estado: 'valido' | 'aproximado' | 'invalido';
      motivo: string;
      idMeta: string;
      ruta: string | null;
    };

export type EfectoDeCobro =
  | 'abierto' | 'reenvio' | 'regla_1' | 'sin_id_meta'
  | 'cancelado' | 'anulacion_registrada' | 'vencido' | 'ignorado'
  | 'cerrado' | 'reintentar' | 'en_revision' | 'tardio' | 'ya_resuelto'
  | 'repetido' | 'sin_cobro' | 'cobro_cancelado';

export interface TransicionDeCobro {
  /** Qué mezclar sobre `solicitud` (con `merge`). `null` = no tocar. */
  cambios: Record<string, unknown> | null;
  efecto: EfectoDeCobro;
  /** Incrementos del mes (`metricas/{aaaa-mm}`). */
  metricas: Record<string, number>;
  intentosInvalidos: number;
  intentosRestantes: number;
  /** El comercio debe enterarse ahora (tercer intento, tardío, valido o aproximado). */
  avisarComercio: boolean;
  /** El resultado guardado de un comprobante repetido (mismo `idMeta`), si lo hubo. */
  previo?: ComprobanteAnotado;
}

const sinCambios = (efecto: EfectoDeCobro, s: Record<string, unknown> | null): TransicionDeCobro => {
  const n = numeroEntero(s?.['intentosInvalidos']);
  return {
    cambios: null, efecto, metricas: {}, intentosInvalidos: n,
    intentosRestantes: Math.max(0, MAX_INTENTOS_INVALIDOS - n), avisarComercio: false,
  };
};

const comprobantesDe = (s: Record<string, unknown>): ComprobanteAnotado[] =>
  Array.isArray(s['comprobantes']) ? (s['comprobantes'] as ComprobanteAnotado[]) : [];

/**
 * LA MÁQUINA DE ESTADOS DEL COBRO CON REGLA 2. Pura.
 *
 * Etapas: `qr_enviado` (esperando) → `agendada` (comprobante válido o
 * aproximado) | `en_revision` (tercer inválido; no vence) | `vencida` (pasó el
 * límite efectivo) | `cancelada` (el cliente canceló).
 */
export function solicitudDeCobroTras(
  previa: unknown,
  evento: EventoDeCobro,
  ahoraMs: number,
): TransicionDeCobro {
  const s = (typeof previa === 'object' && previa !== null ? previa : null) as Record<string, unknown> | null;
  const ahora = Timestamp.fromMillis(ahoraMs);
  const regla2 = esReglaDos(s);
  const limite = limiteDe(s);
  const etapa = s ? String(s['etapa'] ?? '') : '';
  const vencidaPorReloj = regla2 && etapa === 'qr_enviado' && limite !== null && ahoraMs >= limite;
  const vencimiento = (): Record<string, unknown> => ({
    etapa: 'vencida', desde: Timestamp.fromMillis(limite as number),
  });

  // --- Un QR nuevo -----------------------------------------------------------
  if (evento.tipo === 'qr_enviado') {
    if (evento.reglaCobro !== 2) {
      // Regla 1: nada cambia, salvo borrar los restos de una regla 2 anterior.
      const resto = s && s['reglaCobro'] === 2;
      return { ...sinCambios('regla_1', s), cambios: resto ? { ...CAMPOS_REGLA_2_EN_NULO } : null };
    }
    // Sin el id de Meta del mensaje del QR no hay prueba de que el QR salió:
    // no se abre cobro.
    if (typeof evento.idMeta !== 'string' || evento.idMeta.trim() === '') {
      return sinCambios('sin_id_meta', s);
    }
    // EL REENVÍO DEL QR NO ESTIRA EL PLAZO: mientras el cobro sigue abierto, el
    // reloj, los intentos y los comprobantes son los de la solicitud en curso.
    if (regla2 && etapa === 'qr_enviado' && !vencidaPorReloj) {
      return {
        ...sinCambios('reenvio', s),
        cambios: {
          reglaCobro: 2,
          qrEnviadoEn: s?.['qrEnviadoEn'] ?? ahora,
          venceEn: s?.['venceEn'], prorrogaHasta: s?.['prorrogaHasta'] ?? null,
          intentosInvalidos: numeroEntero(s?.['intentosInvalidos']),
          comprobantes: comprobantesDe(s as Record<string, unknown>),
          cotejos: numeroEntero(s?.['cotejos']),
          anulacionAvisadaEn: null,
        },
      };
    }
    return {
      cambios: {
        reglaCobro: 2,
        venceEn: Timestamp.fromMillis(ahoraMs + MINUTOS_QR_VENTA_REGLA_2 * 60_000),
        prorrogaHasta: null, intentosInvalidos: 0, comprobantes: [], anulacionAvisadaEn: null,
      },
      efecto: 'abierto',
      // Un QR anterior que venció sin que nadie lo cerrara se cuenta ahora, una vez.
      metricas: { cobrosQrEnviados: 1, ...(vencidaPorReloj ? { cobrosVencidos: 1 } : {}) },
      intentosInvalidos: 0, intentosRestantes: MAX_INTENTOS_INVALIDOS, avisarComercio: false,
    };
  }

  // Todo lo demás exige una solicitud de regla 2.
  if (!s) return sinCambios(evento.tipo === 'comprobante' ? 'sin_cobro' : 'ignorado', s);
  if (!regla2) return sinCambios(evento.tipo === 'comprobante' ? 'regla_1' : 'ignorado', s);

  if (evento.tipo === 'lectura') {
    if (!vencidaPorReloj) return sinCambios('ignorado', s);
    return { ...sinCambios('vencido', s), cambios: vencimiento(), metricas: { cobrosVencidos: 1 } };
  }

  if (evento.tipo === 'cobro_cancelado') {
    // Cancelar un cobro que ya venció por reloj es solo materializar el vencimiento.
    if (vencidaPorReloj) {
      return { ...sinCambios('vencido', s), cambios: vencimiento(), metricas: { cobrosVencidos: 1 } };
    }
    if (etapa !== 'qr_enviado') return sinCambios('ignorado', s);
    return {
      ...sinCambios('cancelado', s),
      cambios: { etapa: 'cancelada', desde: ahora },
      metricas: { cobrosCancelados: 1 },
    };
  }

  if (evento.tipo === 'anulacion_avisada') {
    if (vencidaPorReloj) {
      return {
        ...sinCambios('anulacion_registrada', s),
        cambios: { ...vencimiento(), anulacionAvisadaEn: ahora },
        metricas: { cobrosVencidos: 1 },
      };
    }
    if (etapa !== 'vencida' || ms(s['anulacionAvisadaEn']) !== null) return sinCambios('ignorado', s);
    return { ...sinCambios('anulacion_registrada', s), cambios: { anulacionAvisadaEn: ahora } };
  }

  // --- Un comprobante --------------------------------------------------------
  const lista = comprobantesDe(s);
  const repetido = lista.find((c) => c.idMeta === evento.idMeta);
  if (repetido) return { ...sinCambios('repetido', s), previo: repetido };

  const anotar = (estado: EstadoDeComprobante, motivo: string): ComprobanteAnotado[] =>
    lista.length >= MAX_COMPROBANTES ? lista
      : [...lista, { idMeta: evento.idMeta, estado, motivo, en: ahora, ruta: evento.ruta }];
  const cotejos = numeroEntero(s['cotejos']) + 1;

  if (etapa === 'cancelada') return sinCambios('cobro_cancelado', s);
  if (etapa === 'agendada') return sinCambios('ya_resuelto', s);

  if (etapa === 'en_revision') {
    // Ya está con una persona: el comprobante se anota y no se avisa de nuevo.
    return { ...sinCambios('en_revision', s), cambios: { comprobantes: anotar('en_revision', evento.motivo), cotejos } };
  }

  // Vencida (guardada o por reloj): el comprobante llega tarde.
  if (etapa === 'vencida' || vencidaPorReloj) {
    const venc = limite as number;
    // Pasadas 24 h del límite es otra conversación: no hay cobro que atender.
    if (ahoraMs - venc > MINUTOS_DE_UN_DIA * 60_000) {
      return vencidaPorReloj
        ? { ...sinCambios('sin_cobro', s), cambios: vencimiento(), metricas: { cobrosVencidos: 1 } }
        : sinCambios('sin_cobro', s);
    }
    const primero = !lista.some((c) => c.estado === 'tardio');
    return {
      ...sinCambios('tardio', s),
      cambios: { ...(vencidaPorReloj ? vencimiento() : {}), comprobantes: anotar('tardio', evento.motivo), cotejos },
      metricas: { ...(vencidaPorReloj ? { cobrosVencidos: 1 } : {}), ...(primero ? { cobrosTardios: 1 } : {}) },
      avisarComercio: primero,
    };
  }

  if (etapa !== 'qr_enviado') return sinCambios('sin_cobro', s);

  // A tiempo. El primero a tiempo fija la prórroga, una sola vez.
  const prorroga = ms(s['prorrogaHasta']) !== null
    ? s['prorrogaHasta'] : Timestamp.fromMillis(ahoraMs + MINUTOS_PRORROGA * 60_000);

  if (evento.estado === 'valido' || evento.estado === 'aproximado') {
    return {
      ...sinCambios('cerrado', s),
      cambios: {
        etapa: 'agendada', desde: ahora, cotejos, prorrogaHasta: prorroga,
        comprobantes: anotar(evento.estado, evento.motivo),
      },
      metricas: {
        cobrosCotejados: 1, ...(evento.estado === 'valido' ? { cobrosValidos: 1 } : { cobrosAproximados: 1 }),
      },
      avisarComercio: true,
    };
  }

  const intentos = numeroEntero(s['intentosInvalidos']) + 1;
  const base = {
    cotejos, prorrogaHasta: prorroga, intentosInvalidos: intentos,
    comprobantes: anotar('invalido', evento.motivo),
  };
  if (intentos >= MAX_INTENTOS_INVALIDOS) {
    return {
      cambios: { ...base, etapa: 'en_revision', desde: ahora },
      efecto: 'en_revision',
      metricas: { cobrosCotejados: 1, cobrosInvalidos: 1, cobrosEnRevision: 1 },
      intentosInvalidos: intentos, intentosRestantes: 0, avisarComercio: true,
    };
  }
  return {
    cambios: base, efecto: 'reintentar',
    metricas: { cobrosCotejados: 1, cobrosInvalidos: 1 },
    intentosInvalidos: intentos, intentosRestantes: MAX_INTENTOS_INVALIDOS - intentos, avisarComercio: false,
  };
}

/** El detalle privado del cierre de una venta calificada. Sin «acreditado» ni «verificado». */
export function detalleDeLaVentaCalificada(
  total: number, moneda: string, estado: 'valido' | 'aproximado', motivo: string,
): string {
  const resto = estado === 'valido' ? 'los datos coinciden' : `datos aproximados (${motivo})`;
  return `Pedido de ${total} ${moneda === 'BOB' ? 'Bs' : moneda}, comprobante: ${resto}`;
}
