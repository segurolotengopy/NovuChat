import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../core/lib/firebase';
import {
  pantallaConversacionesDeFicha, type PantallaConversaciones,
} from '../../../../functions/src/central/consola-conversaciones';

/**
 * Qué pantalla de Conversaciones ve ESTE comercio (`tenants/{id}.consolaConversaciones`;
 * ver `functions/src/central/consola-conversaciones.ts`).
 *
 * `null` MIENTRAS CARGA: el selector no pinta ninguna de las dos hasta saberlo,
 * para que no aparezca medio segundo la pantalla equivocada y se cambie por la
 * otra (con el estado de una montado y desmontado en medio).
 *
 * ERROR DE LECTURA = 'clasica': si la ficha no se puede leer (permisos, red), se
 * muestra la pantalla de siempre. La nueva solo se enciende con un 'nueva' leído.
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
      () => setPantalla('clasica'));
  }, [tenantId]);
  return pantalla;
}
