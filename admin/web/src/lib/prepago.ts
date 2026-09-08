import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import {
  consumidasDe, estadoDeServicio, periodoDe,
  type CuentaCruda, type EstadoServicio, type Modalidad, type MotivoCorte,
} from '../../../functions/src/prepago';

/**
 * =============================================================================
 * PREPAGO EN LA CONSOLA — el MISMO módulo que usa el servidor
 * =============================================================================
 *
 * Los planes, el saldo y el corte se calculan con `functions/src/prepago.ts`,
 * importado directamente. No hay una copia para el navegador: si la hubiera,
 * la pantalla podría decir «te quedan 40» mientras el servidor corta en 0, y
 * sobre esa diferencia se discute una factura. Una sola función, dos lectores.
 *
 * El módulo es puro (no importa Firebase), así que entra en el bundle sin
 * arrastrar nada del servidor.
 */
export {
  BOLSA, MODALIDADES, PLANES, PRUEBA, consumidasDe, corteDe, esModalidad, esPlan,
  estadoDeServicio, fechaCorta, fechaFinDelPeriodo, periodoDe, periodoSiguiente,
} from '../../../functions/src/prepago';
export type { CuentaCruda, EstadoServicio, Modalidad, MotivoCorte, PlanId } from '../../../functions/src/prepago';

/** El documento completo: lo que el módulo entiende, más lo que la pantalla muestra (`motivoVisible`). */
export type Cuenta = CuentaCruda & Record<string, unknown>;

/** Etiqueta del servicio, para el negocio y para NovuChat. */
export function etiquetaServicio(estado: EstadoServicio | null): { texto: string; ok: boolean } {
  if (!estado) return { texto: 'Cargando…', ok: true };
  if (estado.modalidad === 'demostracion') return { texto: 'Demostración', ok: true };
  if (estado.operativo) return { texto: 'Operativo', ok: true };
  return { texto: `Detenido: ${MOTIVO[estado.motivo ?? 'sin_pago']}`, ok: false };
}

export const MOTIVO: Record<MotivoCorte, string> = {
  sin_pago: 'mes sin pagar',
  sin_conversaciones: 'sin conversaciones',
};

export const ETIQUETA_MODALIDAD: Record<Modalidad, string> = {
  demostracion: 'Demostración',
  prueba: 'Mes de prueba',
  prepago: 'Prepago',
};

/**
 * La cuenta y el estado del servicio de un negocio, en vivo.
 *
 * Lee `/cuenta/estado` y el agregado del mes en curso: lo que exige el cálculo
 * y nada más. Un documento ausente cuenta como vacío, que el módulo interpreta
 * como demostración: es lo que son los dos negocios de los demos.
 */
export function useEstadoServicio(tenantId: string | undefined): {
  cuenta: Cuenta | null;
  estado: EstadoServicio | null;
  periodo: string;
  error: string | null;
} {
  const periodo = useMemo(() => periodoDe(Date.now()), []);
  const [cuenta, setCuenta] = useState<Cuenta | null>(null);
  const [metricas, setMetricas] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    const soltarCuenta = onSnapshot(doc(db, 'tenants', tenantId, 'cuenta', 'estado'),
      (d) => setCuenta((d.data() ?? {}) as Cuenta),
      () => setError('No se pudo leer la cuenta.'));
    const soltarMetricas = onSnapshot(doc(db, 'tenants', tenantId, 'metricas', periodo),
      (d) => setMetricas(d.data() ?? {}),
      () => setError('No se pudo leer el consumo del mes.'));
    return () => { soltarCuenta(); soltarMetricas(); };
  }, [tenantId, periodo]);

  const estado = useMemo(
    () => (cuenta && metricas ? estadoDeServicio(cuenta, consumidasDe(metricas), periodo) : null),
    [cuenta, metricas, periodo],
  );
  return { cuenta, estado, periodo, error };
}

/** `Infinity` no se muestra: en demostración no hay tope. */
export const numero = (n: number): string => (Number.isFinite(n) ? String(n) : 'sin tope');
