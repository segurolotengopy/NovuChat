import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { db } from '../lib/firebase';
import { TextoSeguro } from '../componentes/TextoSeguro';
import { ETIQUETA_MODALIDAD, PLANES, etiquetaServicio, numero, useEstadoServicio } from '../lib/prepago';

interface Tenant { id: string; nombre?: unknown; estado?: unknown; plan?: unknown }

/**
 * Cartera de clientes. Solo la ve el propietario de NovuChat: la regla
 * `allow list: if esPropietario()` sobre /tenants es lo que impide que un
 * cliente enumere a los demás clientes.
 *
 * El alta y la baja NO se hacen escribiendo Firestore desde acá: se llaman
 * Cloud Functions (`altaTenant`, `bajaTenant`), que son las que emiten los
 * custom claims y escriben la auditoría. Ver admin/DISENO.md §Alta en 48 horas.
 *
 * La columna «Servicio» sale del MISMO cálculo con el que el servidor corta:
 * si acá dice «detenido», el asistente de ese negocio está contestando el
 * aviso de cortesía ahora mismo.
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
      <p><Link to="/negocios/alta" className="btn btn-primary">Dar de alta un negocio</Link></p>
      {error && <p role="alert">{error}</p>}
      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr><th>Negocio</th><th>Estado</th><th>Modalidad · plan</th><th>Servicio</th><th>Disponibles</th><th /></tr>
          </thead>
          <tbody>
            {tenants.map((t) => <Fila key={t.id} tenant={t} />)}
            {tenants.length === 0 && <tr><td colSpan={6}>Todavía no hay ningún negocio dado de alta.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Fila({ tenant }: { tenant: Tenant }) {
  const { estado } = useEstadoServicio(tenant.id);
  const servicio = etiquetaServicio(estado);
  return (
    <tr>
      <td><TextoSeguro valor={tenant.nombre} maxLargo={80} /></td>
      <td><TextoSeguro valor={tenant.estado} maxLargo={20} /></td>
      <td>{estado ? `${ETIQUETA_MODALIDAD[estado.modalidad]} · ${PLANES[estado.plan].nombre}` : '…'}</td>
      <td><span className={`tag ${servicio.ok ? 'tag-accent' : 'tag-neutral'}`}>{servicio.texto}</span></td>
      <td>{estado ? numero(estado.disponibles) : '…'}</td>
      <td>
        <Link to={`/negocios/${encodeURIComponent(tenant.id)}/cuenta`}>Cuenta</Link>{' · '}
        <Link to={`/negocio/${encodeURIComponent(tenant.id)}/consumo`}>Consumo</Link>
      </td>
    </tr>
  );
}
