import { useEffect, useState } from 'react';
import {
  collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc,
} from 'firebase/firestore';
import { useParams } from 'react-router-dom';
import { auth, db } from '../lib/firebase';
import { TextoSeguro } from '../componentes/TextoSeguro';

interface Contacto {
  id: string;
  nombre?: unknown;
  rolNegocio?: unknown;
  telefono?: unknown;
  correo?: unknown;
  esContactoComercial?: unknown;
}

const ROLES: Record<string, string> = {
  dueno: 'Dueño o dueña',
  recepcion: 'Recepción',
  facturacion: 'Facturación',
  tecnico: 'Técnico',
  otro: 'Otro',
};

/**
 * Personas de referencia del comercio.
 *
 * NO son usuarios del panel (ésos están en Usuarios): son las personas de
 * contacto del negocio, que en general no tienen acceso acá y muchas veces ni
 * saben que están anotadas. Son DATOS PERSONALES DE TERCEROS.
 *
 * Consecuencias visibles en esta pantalla:
 *  - Solo la ve el administrador del negocio. El operador no tiene acceso, y no
 *    porque se le esconda el menú sino porque las reglas se lo niegan.
 *  - `esContactoComercial` marca a quién puede ver NovuChat para asuntos de
 *    facturación. Es el ÚNICO contacto que el proveedor ve sin un permiso de
 *    soporte, y la casilla lo dice con todas las letras.
 *  - El campo de notas tiene un tope corto a propósito: no es una ficha ni un
 *    historial. Cuanto menos dato de terceros se acumule, menor el daño de
 *    cualquier fuga.
 */
export function Contactos() {
  const { tenantId = '' } = useParams();
  const [contactos, setContactos] = useState<Contacto[]>([]);
  const [nuevo, setNuevo] = useState({
    nombre: '', rolNegocio: 'dueno', telefono: '', correo: '', esContactoComercial: false,
  });
  const [estado, setEstado] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(collection(db, 'tenants', tenantId, 'contactos'),
      (i) => setContactos(i.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setEstado('No se pudo leer la lista de contactos.'));
  }, [tenantId]);

  const guardar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setEstado(null);
    try {
      const id = `k${Date.now()}`;
      await setDoc(doc(db, 'tenants', tenantId, 'contactos', id), {
        ...nuevo,
        actualizadoPor: auth.currentUser?.uid ?? '',
        actualizadoEn: serverTimestamp(),
      });
      setNuevo({ nombre: '', rolNegocio: 'dueno', telefono: '', correo: '', esContactoComercial: false });
      setEstado('Contacto guardado.');
    } catch {
      setEstado('El servidor rechazó el contacto. Revise el teléfono y el rol.');
    }
  };

  const borrar = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'tenants', tenantId, 'contactos', id));
    } catch {
      setEstado('No se pudo borrar.');
    }
  };

  return (
    <section>
      <h2>Personas de referencia</h2>
      <p className="ayuda">
        Son las personas de contacto del negocio. No necesitan acceso al panel.
        El operador no ve esta lista.
      </p>

      <table>
        <thead>
          <tr><th>Nombre</th><th>Rol</th><th>Teléfono</th><th>Correo</th><th>NovuChat</th><th /></tr>
        </thead>
        <tbody>
          {contactos.map((c) => (
            <tr key={c.id}>
              <td><TextoSeguro valor={c.nombre} maxLargo={120} /></td>
              <td>{ROLES[String(c.rolNegocio)] ?? 'Otro'}</td>
              <td><TextoSeguro valor={c.telefono} maxLargo={15} /></td>
              <td><TextoSeguro valor={c.correo} maxLargo={254} /></td>
              <td>{c.esContactoComercial === true ? 'Sí' : 'No'}</td>
              <td><button onClick={() => borrar(c.id)}>Quitar</button></td>
            </tr>
          ))}
        </tbody>
      </table>

      <form onSubmit={guardar}>
        <h3>Agregar</h3>
        <label>Nombre
          <input required maxLength={120} value={nuevo.nombre}
                 onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
        </label>
        <label>Rol en el negocio
          <select value={nuevo.rolNegocio}
                  onChange={(e) => setNuevo({ ...nuevo, rolNegocio: e.target.value })}>
            {Object.entries(ROLES).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </label>
        <label>Teléfono (sin +, solo dígitos)
          <input required maxLength={15} pattern="[0-9]{8,15}" value={nuevo.telefono}
                 onChange={(e) => setNuevo({ ...nuevo, telefono: e.target.value })} />
        </label>
        <label>Correo (opcional)
          <input type="email" maxLength={254} value={nuevo.correo}
                 onChange={(e) => setNuevo({ ...nuevo, correo: e.target.value })} />
        </label>
        <label>
          <input type="checkbox" checked={nuevo.esContactoComercial}
                 onChange={(e) => setNuevo({ ...nuevo, esContactoComercial: e.target.checked })} />
          {' '}Es el contacto comercial
        </label>
        <p className="ayuda">
          Marcando esta casilla, <strong>NovuChat podrá ver el nombre, el teléfono
          y el correo de esta persona</strong> para asuntos de facturación. Es el
          único contacto que vemos sin que usted nos habilite un acceso de
          soporte. Los demás quedan solo para su negocio.
        </p>
        <button type="submit">Guardar contacto</button>
      </form>
      {estado && <p role="status">{estado}</p>}
    </section>
  );
}
