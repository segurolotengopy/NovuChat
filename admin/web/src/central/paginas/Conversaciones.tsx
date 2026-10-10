import { useParams } from 'react-router-dom';
import { useConsolaConversaciones } from '../componentes/ConsolaConversaciones';
import { Conversaciones as ConversacionesClasica } from './ConversacionesClasica';
import { ConversacionesNueva } from './ConversacionesNueva';

/**
 * CONVERSACIONES — EL SELECTOR (H1, 09/10/2026).
 *
 * La importación de `App.tsx` no cambia: esta pantalla sigue llamándose
 * `Conversaciones`, pero ahora solo ELIGE cuál de las dos pintar según la bandera
 * `tenants/{id}.consolaConversaciones`:
 *
 *   'nueva'    `ConversacionesNueva`   (lista y hilo, búsqueda, filtros, no leídas)
 *   cualquier otra cosa, o error de lectura → `ConversacionesClasica`, que es la
 *   pantalla de siempre, sin tocar (idéntica a la de antes de H1).
 *
 * Mientras la bandera carga no se pinta ninguna: así no parpadea la equivocada.
 * `key`: al cambiar de negocio con la ruta montada, la elección empieza de cero.
 */
export function Conversaciones() {
  const { tenantId = '' } = useParams();
  return <ConversacionesSegunBandera key={tenantId} tenantId={tenantId} />;
}

function ConversacionesSegunBandera({ tenantId }: { tenantId: string }) {
  const pantalla = useConsolaConversaciones(tenantId);
  if (pantalla === null) return <p>Cargando…</p>;
  return pantalla === 'nueva' ? <ConversacionesNueva /> : <ConversacionesClasica />;
}
