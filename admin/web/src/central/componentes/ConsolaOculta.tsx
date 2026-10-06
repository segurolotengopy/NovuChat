import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../core/lib/firebase';
import { useSesion } from '../../core/lib/contexto';
import { consolaOcultaDeFicha, esVisible, ocultosParaVisitante } from '../../../../functions/src/central/consola-oculta';
import type { IdConsolaOculta } from '../../../../functions/src/central/consola-oculta';

/**
 * Lo que la consola de ESTE comercio no pinta (`tenants/{id}.consolaOculta`,
 * ver `functions/src/central/consola-oculta.ts` y `docs/arquitectura/consola-oculta.md`).
 *
 * `null` MIENTRAS CARGA: quien pregunta no pinta lo ocultable hasta saberlo, para
 * que un control que NovuChat decidió no ofrecer no aparezca medio segundo y
 * desaparezca (con un clic en medio). Si la lectura falla, la lista queda vacía:
 * sin lista, la consola es la de siempre.
 *
 * EL PROPIETARIO DE NOVUCHAT IGNORA LA LISTA (devuelve `[]`): ve y opera todo en
 * cualquier comercio. Como el menú, las páginas y las rutas pasan por este hook,
 * el criterio vale para todos los ids.
 *
 * ES SOLO PRESENTACIÓN: lo que el servidor permite no cambia con esto.
 */
export function useConsolaOculta(tenantId: string | undefined): readonly IdConsolaOculta[] | null {
  const { permisos } = useSesion();
  const [lista, setLista] = useState<readonly IdConsolaOculta[] | null>(null);
  useEffect(() => {
    if (!tenantId) { setLista(null); return; }
    setLista(null);
    return onSnapshot(doc(db, 'tenants', tenantId),
      (d) => setLista(consolaOcultaDeFicha(d.data())),
      () => setLista([]));
  }, [tenantId]);
  return ocultosParaVisitante(lista, permisos.propietario);
}

/**
 * Guarda de ruta: la página oculta no se abre escribiendo la dirección. Mientras
 * carga, no pinta nada; oculta, redirige al tablero; si no, la página.
 */
export function PuertaOculta({ ocultos, id, children }:
  { ocultos: readonly IdConsolaOculta[] | null; id: IdConsolaOculta; children: ReactNode }) {
  if (ocultos === null) return <p>Cargando…</p>;
  if (!esVisible(ocultos, id)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function SiNoOculta({ id, children }: { id: IdConsolaOculta; children: ReactNode }) {
  const { tenantId } = useParams();
  return <PuertaOculta ocultos={useConsolaOculta(tenantId)} id={id}>{children}</PuertaOculta>;
}
