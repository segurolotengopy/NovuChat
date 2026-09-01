import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { db } from '../lib/firebase';
import { TextoSeguro } from '../componentes/TextoSeguro';

interface Tenant { id: string; nombre?: unknown; estado?: unknown; plan?: unknown }

/**
 * Cartera de clientes. Solo la ve el propietario de NovuChat: la regla
 * `allow list: if esPropietario()` sobre /tenants es lo que impide que un
 * cliente enumere a los demás clientes.
 *
 * El alta y la baja NO se hacen escribiendo Firestore desde acá: se llaman
 * Cloud Functions (`altaTenant`, `bajaTenant`), que son las que emiten los
 * custom claims y escriben la auditoría. Ver admin/DISENO.md §Alta en 48 horas.
 */
export function Tenants() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => onSnapshot(
    query(collection(db, 'tenants'), orderBy('nombre')),
    (instantanea) => setTenants(instantanea.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => setError('No se pudo leer la cartera de clientes.'),
  ), []);

  return (
    <section>
      <h2>Negocios</h2>
      {error && <p role="alert">{error}</p>}
      <table className="table">
        <thead><tr><th>Negocio</th><th>Estado</th><th>Plan</th><th /></tr></thead>
        <tbody>
          {tenants.map((t) => (
            <tr key={t.id}>
              <td><TextoSeguro valor={t.nombre} maxLargo={80} /></td>
              <td><TextoSeguro valor={t.estado} maxLargo={20} /></td>
              <td><TextoSeguro valor={t.plan} maxLargo={20} /></td>
              <td><Link to={`/negocio/${encodeURIComponent(t.id)}/configuracion`}>Abrir</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
