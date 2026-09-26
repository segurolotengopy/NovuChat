/**
 * PREPAGO EN LA CONSOLA — el MISMO módulo que usa el servidor.
 *
 * La cobertura del mes, la gracia de 48 horas, el saldo de conversaciones y
 * el corte se leen de `functions/src/prepago.ts`, importado directamente,
 * igual que `planes.ts` y `atencion.ts`. No hay una copia para el navegador:
 * si la hubiera, la pantalla podría decir «cubierto hasta el 30» mientras el
 * servidor corta el 3, y sobre esa diferencia se discute un reclamo. La
 * consola importa `estadoDeServicio` y `corteDe` y NO CALCULA NADA
 * (`DISENO.md` §4undecies.4).
 *
 * Qué pinta cada pantalla, para los bloques A-1 y A-3:
 *   - El comercio (`EstadoCuenta.tsx`) ve el corte SOLO si `aplicado === true`:
 *     un corte observado no existe para él.
 *   - El propietario (`Tenants.tsx`) ve modalidad, fase y, si hay corte,
 *     «cortaría por sin_pago desde el dd/mm · N clientes» en gris si
 *     `aplicado: false` y en rojo si `true`.
 *
 * El módulo es puro (no importa Firebase), así que entra en el bundle sin
 * arrastrar nada del servidor.
 */
export {
  BOLSA, DIAS_AVISO_CONVERSION, DIAS_AVISO_CORTE, DIAS_AVISO_RENOVACION, GRACIA_MS, INSTALACION_USD,
  MENSAJE_CORTESIA, MESES_MAXIMO, BOLSAS_MAXIMO, MODALIDADES, MONEDA_COBRO, MONEDA_LISTA, PLANES,
  PLANTILLAS, PRUEBA, TCO_DIAS_VIGENCIA, TCO_MAXIMO, TCO_MINIMO,
  aplicarPago, camposDerivados, consumidasDe, consumoDeConversacion, corteAplicable, corteDe,
  descripcionDe, diaDelMes, diasDelPeriodo, esFecha, esModalidad, esPago, esPeriodo, esTipoCambio,
  estadoDeServicio, fechaCorta, fechaEscrita, fechaFinDelPeriodo, finDelPeriodoMs, importeBs,
  inicioDelPeriodoMs, mensajeCortesia, mesBolivia, modalidadDe, montoUsdDe, periodoAnterior,
  periodoSiguiente, recordatoriosDebidos, resumenDeCuenta, sumarMeses, tipoCambioVigente,
} from '../../../functions/src/prepago';
export type {
  CamposDerivados, ContextoRecordatorio, Corte, CuentaCruda, CuentaTrasPago, EstadoPago,
  EstadoServicio, Fase, Modalidad, MotivoCorte, Pago, PlataformaPrepago, Recordatorio,
  TipoCambio, TipoRecordatorio,
} from '../../../functions/src/prepago';
