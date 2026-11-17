import { useMemo } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useSesion } from '../../core/lib/contexto';
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
  const { permisos } = useSesion();
  // Solo el administrador del negocio, NO el propietario de NovuChat (aunque tenga rol de admin ahí): igual que la opción del menú.
  const permitido = !permisos.propietario;
  const filas = useBloqueados(tenantId, permitido);
  const estadoComercio = useEstadoComercio(tenantId);
  const capa = useMemo(() => capaBloqueoReal(funciones), []);
  if (!permitido) return <Navigate to="/" replace />;
  const n = Array.isArray(filas) ? filas.length : null;
  return (
    <section>
      <h2>{rotuloBloqueados(n)}</h2>
      <p className="text-muted">El asistente no responde a estos teléfonos. Sus mensajes se guardan y se ven en Conversaciones, pero no cuentan para el plan.</p>
      <PanelBloqueados tenantId={tenantId} filas={filas} comercioActivo={estadoComercio === 'activo'} capa={capa} />
    </section>
  );
}
