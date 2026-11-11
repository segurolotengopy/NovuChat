import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../core/lib/firebase';
import { manualesParaBoton } from '../../../../functions/src/central/enlace-minicrm';

/**
 * «MANUAL DE USO» EN EL TABLERO (10/11/2026). El operador ve solo el manual del operador; el administrador ve los
 * dos. La barrera real está en las reglas del servidor (`enlaces/manual-admin` solo lo lee `esAdmin`): aquí ni
 * siquiera se suscribe a lo que su rol no puede leer. Sin enlace válido, sin permiso o con un error: no se pinta nada.
 */
export function BotonesManual({ tenantId, esAdmin }: { tenantId: string; esAdmin: boolean }) {
  const [operador, setOperador] = useState<unknown>(null);
  const [admin, setAdmin] = useState<unknown>(null);
  const rol = esAdmin ? 'admin' : 'oper';

  useEffect(() => {
    setOperador(null);
    setAdmin(null);
    if (!tenantId) return;
    const bajas = [onSnapshot(doc(db, 'tenants', tenantId, 'enlaces', 'manual-operador'),
      (d) => setOperador(d.get('enlace')), () => setOperador(null))];
    if (esAdmin) {
      bajas.push(onSnapshot(doc(db, 'tenants', tenantId, 'enlaces', 'manual-admin'),
        (d) => setAdmin(d.get('enlace')), () => setAdmin(null)));
    }
    return () => { for (const b of bajas) b(); };
  }, [tenantId, esAdmin]);

  const m = manualesParaBoton({ rol, operador, admin });
  if (!m.operador && !m.admin) return null;
  return (
    <p>
      {m.operador && (
        <a className="btn btn-secondary" href={m.operador} target="_blank" rel="noopener noreferrer" data-testid="abrir-manual-operador">
          Manual del operador
        </a>
      )}
      {m.operador && m.admin && ' '}
      {m.admin && (
        <a className="btn btn-secondary" href={m.admin} target="_blank" rel="noopener noreferrer" data-testid="abrir-manual-admin">
          Manual del administrador
        </a>
      )}
    </p>
  );
}
