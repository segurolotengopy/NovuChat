import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useParams } from 'react-router-dom';
import { app, db } from '../lib/firebase';
import { TextoSeguro } from '../componentes/TextoSeguro';

interface Miembro { id: string; correo?: unknown; rol?: unknown; estado?: unknown }

/**
 * Usuarios del negocio. La lista sale del ESPEJO /tenants/{t}/miembros, que es
 * de solo lectura: sirve para pintar la tabla, no para autorizar. El permiso
 * verdadero vive en los custom claims.
 *
 * Invitar y cambiar rol son Cloud Functions: son las únicas que pueden tocar
 * claims, y de paso auditan el cambio. Si esto se hiciera escribiendo Firestore
 * desde el navegador, un administrador comprometido podría ascender a cualquiera
 * sin dejar rastro.
 */
export function Usuarios() {
  const { tenantId = '' } = useParams();
  const [miembros, setMiembros] = useState<Miembro[]>([]);
  const [correo, setCorreo] = useState('');
  const [rol, setRol] = useState<'admin' | 'oper'>('oper');
  const [estado, setEstado] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(collection(db, 'tenants', tenantId, 'miembros'),
      (i) => setMiembros(i.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setEstado('No se pudo leer la lista de usuarios.'));
  }, [tenantId]);

  const invitar = async (e: React.FormEvent) => {
    e.preventDefault();
    setEstado(null);
    try {
      const invitar = httpsCallable(getFunctions(app, 'southamerica-east1'), 'invitarUsuario');
      await invitar({ tenantId, correo, rol });
      setEstado('Invitación enviada.');
      setCorreo('');
    } catch {
      setEstado('No se pudo enviar la invitación.');
    }
  };

  return (
    <section>
      <h2>Usuarios del negocio</h2>
      <table>
        <thead><tr><th>Correo</th><th>Rol</th><th>Estado</th></tr></thead>
        <tbody>
          {miembros.map((m) => (
            <tr key={m.id}>
              <td><TextoSeguro valor={m.correo} maxLargo={254} /></td>
              <td><TextoSeguro valor={m.rol} maxLargo={20} /></td>
              <td><TextoSeguro valor={m.estado} maxLargo={20} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      <form onSubmit={invitar}>
        <h3>Invitar</h3>
        <label>Correo
          <input type="email" required value={correo} maxLength={254}
                 onChange={(e) => setCorreo(e.target.value)} />
        </label>
        <label>Rol
          <select value={rol} onChange={(e) => setRol(e.target.value === 'admin' ? 'admin' : 'oper')}>
            <option value="oper">Operador — solo lee conversaciones</option>
            <option value="admin">Administrador — además edita la configuración</option>
          </select>
        </label>
        <button type="submit">Enviar invitación</button>
      </form>
      {estado && <p role="status">{estado}</p>}
    </section>
  );
}
