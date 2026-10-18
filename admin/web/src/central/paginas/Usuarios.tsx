import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useParams } from 'react-router-dom';
import { db, funciones } from '../../core/lib/firebase';
import { TextoSeguro } from '../componentes/TextoSeguro';
import { useConsolaOculta } from '../componentes/ConsolaOculta';
import { esVisible } from '../../../../functions/src/central/consola-oculta';

interface Miembro { id: string; correo?: unknown; rol?: unknown; estado?: unknown }

/**
 * ESPEJO de `titularDeFicha` (módulo titular del servidor): la web no puede importar del
 * servidor (arrastraría el SDK Admin). Mismo criterio, con `trim()` idéntico; una prueba de
 * fuente (`usuarios-titular-pantalla.test.ts`) compara ambos con los mismos casos.
 */
function titularDeFicha(ficha: Record<string, unknown> | undefined): string | null {
  const valor = ficha?.['titularCuentaUid'];
  if (typeof valor !== 'string') return null;
  const recortado = valor.trim();
  return recortado !== '' ? recortado : null;
}

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
  // Titular de la cuenta: se lee de la ficha (las reglas dejan el get a los miembros).
  // Solo presentación: quien impide quitarlo o degradarlo es el servidor.
  const [titular, setTitular] = useState<string | null>(null);
  const [estado, setEstado] = useState<string | null>(null);
  // «Invitar» no se pinta si NovuChat lo ocultó para este comercio (las altas las
  // hace NovuChat). Mientras carga la lista tampoco. Solo presentación: la
  // callable `invitarUsuario` sigue exigiendo administrador.
  const ocultos = useConsolaOculta(tenantId);
  const puedeInvitar = esVisible(ocultos, 'invitar');

  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(collection(db, 'tenants', tenantId, 'miembros'),
      (i) => setMiembros(i.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setEstado('No se pudo leer la lista de usuarios.'));
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(doc(db, 'tenants', tenantId),
      (f) => setTitular(titularDeFicha(f.data())),
      () => setTitular(null));
  }, [tenantId]);

  const correoTitular = miembros.find((m) => m.id === titular)?.correo;
  const pideDegradarTitular = titular !== null && rol === 'oper' && typeof correoTitular === 'string'
    && correo.trim().toLowerCase() === correoTitular.toLowerCase();

  const invitar = async (e: React.FormEvent) => {
    e.preventDefault();
    setEstado(null);
    try {
      const invitar = httpsCallable(funciones, 'invitarUsuario');
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
              <td><TextoSeguro valor={m.correo} maxLargo={254} />{m.id === titular && <strong> Titular</strong>}</td>
              <td><TextoSeguro valor={m.rol} maxLargo={20} /></td>
              <td><TextoSeguro valor={m.estado} maxLargo={20} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      {puedeInvitar && <form onSubmit={invitar}>
        <h3>Invitar</h3>
        <label>Correo
          <input type="email" required placeholder="persona@ejemplo.com" value={correo} maxLength={254}
                 onChange={(e) => setCorreo(e.target.value)} />
        </label>
        <label>Rol
          <select value={rol} onChange={(e) => setRol(e.target.value === 'admin' ? 'admin' : 'oper')}>
            <option value="oper">Operador — solo lee conversaciones</option>
            <option value="admin">Administrador — además edita la configuración</option>
          </select>
        </label>
        {pideDegradarTitular && <p role="alert">Esa persona es la titular de la cuenta: no se la puede pasar a Operador. Lo cambia NovuChat.</p>}
        <button type="submit">Enviar invitación</button>
      </form>}
      {estado && <p role="status">{estado}</p>}
    </section>
  );
}
