import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../core/lib/firebase';
import { enlaceMiniCrmParaBoton } from '../../../../functions/src/central/enlace-minicrm';

/**
 * «ABRIR miniCRM» EN EL TABLERO. Lo ve solo el administrador del comercio, con el miniCRM encendido y un enlace
 * válido en `config/crmEnlace` (lo escribe NovuChat desde Plataforma; las reglas solo dejan leerlo al admin de ese
 * comercio). Sin enlace, sin permiso o con un error de lectura: no se pinta nada, sin avisos ni mensajes.
 */
export function BotonMiniCrm({ tenantId, esAdmin }: { tenantId: string; esAdmin: boolean }) {
  const [activo, setActivo] = useState<unknown>(undefined);
  const [enlace, setEnlace] = useState<unknown>(null);

  useEffect(() => {
    setActivo(undefined);
    setEnlace(null);
    if (!tenantId || !esAdmin) return;
    const a = onSnapshot(doc(db, 'tenants', tenantId, 'config', 'crm'),
      (d) => setActivo(d.get('activo')), () => setActivo(false));
    const b = onSnapshot(doc(db, 'tenants', tenantId, 'config', 'crmEnlace'),
      (d) => setEnlace(d.get('enlaceHoja')), () => setEnlace(null));
    return () => { a(); b(); };
  }, [tenantId, esAdmin]);

  const href = enlaceMiniCrmParaBoton({ esAdmin, crmActivo: activo, enlace });
  if (!href) return null;
  return (
    <p>
      <a className="btn btn-secondary" href={href} target="_blank" rel="noopener noreferrer" data-testid="abrir-minicrm">
        Abrir miniCRM
      </a>
    </p>
  );
}
