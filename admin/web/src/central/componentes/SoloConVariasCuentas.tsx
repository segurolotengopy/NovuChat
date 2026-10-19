import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useSesion } from '../../core/lib/contexto';
import { cuentasDe } from '../../core/lib/cuentaActiva';

/**
 * El selector: solo para quien tiene sesión y más de una cuenta de persona. El
 * propietario conserva «Negocios»; con 0 o 1 cuenta, al inicio (que decide).
 */
export function SoloConVariasCuentas({ children }: { children: ReactNode }) {
  const { permisos } = useSesion();
  if (permisos.propietario || cuentasDe(permisos).length < 2) return <Navigate to="/" replace />;
  return <>{children}</>;
}
