import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../core/lib/firebase';
import {
  pantallaConversacionesDeFicha, PANTALLA_POR_DEFECTO, type PantallaConversaciones,
} from '../../../../functions/src/central/consola-conversaciones';
import { puedeIntervenirDeFicha } from '../lib/turno';

/**
 * Qué pantalla de Conversaciones ve ESTE comercio (`tenants/{id}.consolaConversaciones`;
 * ver `functions/src/central/consola-conversaciones.ts`).
 *
 * `null` MIENTRAS CARGA: el selector no pinta ninguna de las dos hasta saberlo,
 * para que no aparezca medio segundo la pantalla equivocada y se cambie por la
 * otra (con el estado de una montado y desmontado en medio).
 *
 * ERROR DE LECTURA = la de por defecto ('nueva', 24/10/2026): si la ficha no se puede
 * leer (permisos, red), se usa el mismo default del servidor (`PANTALLA_POR_DEFECTO`),
 * no un valor propio.
 *
 * ES SOLO PRESENTACIÓN: la bandera la escribe NovuChat con un script (ningún
 * navegador escribe `tenants/{id}`) y lo que el servidor permite no cambia con ella.
 */
export function useConsolaConversaciones(tenantId: string | undefined): PantallaConversaciones | null {
  const [pantalla, setPantalla] = useState<PantallaConversaciones | null>(null);
  useEffect(() => {
    setPantalla(null);
    if (!tenantId) return;
    return onSnapshot(doc(db, 'tenants', tenantId),
      (d) => setPantalla(pantallaConversacionesDeFicha(d.data())),
      () => setPantalla(PANTALLA_POR_DEFECTO));
  }, [tenantId]);
  return pantalla;
}

/**
 * El estado del comercio (`tenants/{id}.estado`: `activo`, `suspendido`…), o `null` mientras se lee o si no se puede leer.
 * La pantalla nueva lo usa para NO intentar escribir (marcar leída) en un comercio que no está activo: las reglas niegan
 * toda escritura de una persona con el comercio suspendido, y reintentarla en cada cambio sería un bucle de escrituras
 * negadas. `null` cuenta como «no activo»: ante la duda, no se escribe.
 */
export function useEstadoComercio(tenantId: string | undefined): string | null {
  const [estado, setEstado] = useState<string | null>(null);
  useEffect(() => {
    setEstado(null);
    if (!tenantId) return;
    return onSnapshot(doc(db, 'tenants', tenantId),
      (d) => { const e = d.data()?.['estado']; setEstado(typeof e === 'string' ? e : null); },
      () => setEstado(null));
  }, [tenantId]);
  return estado;
}

/**
 * Lo que la pantalla usa para ofrecer «Tomar» y el cuadro de escribir. FALLA CERRADA: mientras carga, si la ficha no se
 * puede leer o no existe, es `false` (sin Tomar). La enciende NovuChat comercio por comercio cuando la salida del número
 * está publicada; sin ella, tomar silenciaría al asistente y lo escrito caducaría. El servidor lo vuelve a comprobar.
 */
export function usePersonaPuedeIntervenir(tenantId: string | undefined): boolean {
  const [puede, setPuede] = useState(false);
  useEffect(() => {
    setPuede(false);
    if (!tenantId) return;
    return onSnapshot(doc(db, 'tenants', tenantId),
      (d) => setPuede(puedeIntervenirDeFicha(d.data())),
      () => setPuede(false));
  }, [tenantId]);
  return puede;
}
