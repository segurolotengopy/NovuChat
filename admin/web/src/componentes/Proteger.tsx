import type { ReactNode } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useSesion } from '../lib/contexto';
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
  requiere?: 'propietario' | 'adminTenant' | 'miembroTenant';
}) {
  const { usuario, permisos, cargando } = useSesion();
  const { tenantId } = useParams();

  if (cargando) return <p>Cargando…</p>;
  if (!usuario) return <Navigate to="/ingresar" replace />;

  if (requiere === 'propietario' && !permisos.propietario) return <SinPermiso />;
  if (requiere === 'adminTenant' && (!tenantId || !esAdmin(permisos, tenantId))) return <SinPermiso />;
  if (requiere === 'miembroTenant' && (!tenantId || rolEn(permisos, tenantId) === null)) return <SinPermiso />;

  return <>{children}</>;
}

const SinPermiso = () => (
  <section>
    <h2>Sin permiso</h2>
    <p>Su cuenta no tiene acceso a esta sección. Consulte con el administrador del negocio.</p>
  </section>
);
