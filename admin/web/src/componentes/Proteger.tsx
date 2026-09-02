import type { ReactNode } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useSesion } from '../lib/contexto';
import { SinSalida } from './SinSalida';
import { esAdmin, rolEn } from '../lib/sesion';

/**
 * Guardia de rutas. Es CONVENIENCIA, no seguridad: evita pintar pantallas vacías
 * y errores de "permiso denegado". Quien autoriza de verdad es Firestore con
 * `admin/firestore.rules`. Si alguien parchea el navegador para saltarse este
 * guardia, ve el cascarón de la pantalla y ningún dato.
 */
export function Proteger({
  children,
  requiere,
}: {
  children: ReactNode;
  requiere?: 'propietario' | 'adminTenant' | 'miembroTenant' | 'miembroOPropietario';
}) {
  const { usuario, permisos, cargando } = useSesion();
  const { tenantId } = useParams();

  if (cargando) return <p>Cargando…</p>;
  if (!usuario) return <Navigate to="/ingresar" replace />;

  if (requiere === 'propietario' && !permisos.propietario) return <SinPermiso />;
  if (requiere === 'adminTenant' && (!tenantId || !esAdmin(permisos, tenantId))) return <SinPermiso />;
  if (requiere === 'miembroTenant' && (!tenantId || rolEn(permisos, tenantId) === null)) return <SinPermiso />;
  // Cierres: lo abre el negocio Y NovuChat. La regla de Firestore ya lo permite
  // (`esMiembro(t) || esPropietario()`), y sin este caso el guardia sería más
  // estricto que la regla — que es como se termina con una pantalla que el
  // permiso habilita y la interfaz niega.
  if (requiere === 'miembroOPropietario'
      && !(permisos.propietario || (tenantId && rolEn(permisos, tenantId) !== null))) return <SinPermiso />;

  return <>{children}</>;
}

const SinPermiso = () => (
  <SinSalida titulo="Sin permiso">
    <p>
      Tu cuenta no tiene acceso a esta sección. Consulta con el administrador
      del negocio, o prueba con la cuenta que te asignaron.
    </p>
  </SinSalida>
);
