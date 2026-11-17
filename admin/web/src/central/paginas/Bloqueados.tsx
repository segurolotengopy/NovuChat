import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { funciones } from '../../core/lib/firebase';
import { PanelBloqueados } from '../componentes/PanelBloqueados';
import { useEstadoComercio } from '../componentes/ConsolaConversaciones';
import { capaBloqueoReal, rotuloBloqueados } from '../lib/bloqueo';
import { useBloqueados } from '../lib/useBloqueados';
import '../estilos/conversaciones.css';

/**
 * TELÉFONOS BLOQUEADOS: la lista de contactos a los que el asistente no responde, con «Desbloquear» por fila.
 * Antes era un botón «Bloqueados (N)» con una línea entera propia sobre Conversaciones; ahora es una opción del menú
 * lateral y esta pantalla (ruta `/negocio/:tenantId/bloqueados`, solo el administrador del negocio, como el menú).
 * Bloquear sigue en la conversación (`BloqueoContacto`); acá solo se ve y se desbloquea. Todo lo decide el servidor.
 */
export function Bloqueados() {
  const { tenantId = '' } = useParams();
  const filas = useBloqueados(tenantId, true);
  const estadoComercio = useEstadoComercio(tenantId);
  const capa = useMemo(() => capaBloqueoReal(funciones), []);
  const n = Array.isArray(filas) ? filas.length : null;
  return (
    <section>
      <h2>{rotuloBloqueados(n)}</h2>
      <p className="text-muted">El asistente no responde a estos teléfonos. Sus mensajes se guardan y se ven en Conversaciones, pero no cuentan para el plan.</p>
      <PanelBloqueados tenantId={tenantId} filas={filas} comercioActivo={estadoComercio === 'activo'} capa={capa} />
    </section>
  );
}
