import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query, limit } from 'firebase/firestore';
import { useParams } from 'react-router-dom';
import { db } from '../lib/firebase';

interface Periodo { id: string; conversaciones?: number; mensajes?: number; citasAgendadas?: number }

/**
 * Métricas de uso. Se leen AGREGADOS precalculados por la ruta de ingesta, no se
 * cuentan conversaciones en el navegador. Dos motivos: no cuesta miles de
 * lecturas, y permite que un rol vea el volumen sin tener permiso de lectura
 * sobre el contenido de los mensajes.
 */
export function Metricas() {
  const { tenantId = '' } = useParams();
  const [periodos, setPeriodos] = useState<Periodo[]>([]);

  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(
      query(collection(db, 'tenants', tenantId, 'metricas'), orderBy('__name__', 'desc'), limit(12)),
      (i) => setPeriodos(i.docs.map((d) => ({ id: d.id, ...d.data() } as Periodo))),
    );
  }, [tenantId]);

  return (
    <section>
      <h2>Uso</h2>
      <table>
        <thead><tr><th>Mes</th><th>Conversaciones</th><th>Mensajes</th><th>Citas</th></tr></thead>
        <tbody>
          {periodos.map((p) => (
            <tr key={p.id}>
              <td>{p.id}</td>
              <td>{p.conversaciones ?? 0}</td>
              <td>{p.mensajes ?? 0}</td>
              <td>{p.citasAgendadas ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
