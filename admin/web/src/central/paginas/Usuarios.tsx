import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useParams } from 'react-router-dom';
import { db, funciones } from '../../core/lib/firebase';
import { TextoSeguro } from '../componentes/TextoSeguro';
import { useConsolaOculta } from '../componentes/ConsolaOculta';
import { esVisible } from '../../../../functions/src/central/consola-oculta';
import { BotonGoogle } from '../componentes/BotonGoogle';
import {
  abreviarCorreoVista, accionesDeMiembro, capaEdicionReal, clientIdGoogle, ROTULO_ESTADO, textoErrorEdicion, textoResultadoQuitar,
  type EstadoEdicion,
} from '../lib/edicionCrm';

const CAPA_EDICION = capaEdicionReal(funciones);
const estadoDeEdicion = (v: unknown): EstadoEdicion => v === 'activo' || v === 'revocado' || v === 'revocado_pendiente' ? v : 'ninguno';

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
  // Edición del miniCRM por persona: solo el estado y el correo ABREVIADO (el completo no se guarda). Lo lee el admin (reglas).
  const clientId = clientIdGoogle(import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID);
  const [ediciones, setEdiciones] = useState<Record<string, { estado: EstadoEdicion; correo: string }>>({});
  const [errorEdiciones, setErrorEdiciones] = useState(false);
  const [eligiendoUid, setEligiendoUid] = useState<string | null>(null);
  const [ocupadoUid, setOcupadoUid] = useState<string | null>(null);
  const [avisoEdicion, setAvisoEdicion] = useState<{ texto: string; error: boolean } | null>(null);
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
    if (!tenantId || !clientId) return;
    setErrorEdiciones(false);
    return onSnapshot(collection(db, 'tenants', tenantId, 'editoresCrm'),
      (i) => { setErrorEdiciones(false); setEdiciones(Object.fromEntries(i.docs.map((d) => [d.id, {
        estado: estadoDeEdicion(d.get('estado')), correo: abreviarCorreoVista(d.get('correoGoogle')),
      }]))); },
      () => setErrorEdiciones(true));
  }, [tenantId, clientId]);

  const habilitarA = async (uid: string, idToken: string) => {
    setEligiendoUid(null); setOcupadoUid(uid); setAvisoEdicion(null);
    try { await CAPA_EDICION.registrar(tenantId, idToken, uid); setAvisoEdicion({ texto: 'Edición habilitada.', error: false }); }
    catch (e) { setAvisoEdicion({ texto: textoErrorEdicion(e, 'habilitar'), error: true }); }
    setOcupadoUid(null);
  };
  const quitarA = async (uid: string) => {
    setOcupadoUid(uid); setAvisoEdicion(null);
    try { setAvisoEdicion({ texto: textoResultadoQuitar(await CAPA_EDICION.quitar(tenantId, uid)), error: false }); }
    catch (e) { setAvisoEdicion({ texto: textoErrorEdicion(e, 'quitar'), error: true }); }
    setOcupadoUid(null);
  };

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
        <thead><tr><th>Correo</th><th>Rol</th><th>Estado</th>{clientId && <th>Edición del miniCRM</th>}</tr></thead>
        <tbody>
          {miembros.map((m) => (
            <tr key={m.id}>
              <td><TextoSeguro valor={m.correo} maxLargo={254} />{m.id === titular && <strong> Titular</strong>}</td>
              <td><TextoSeguro valor={m.rol} maxLargo={20} /></td>
              <td><TextoSeguro valor={m.estado} maxLargo={20} /></td>
              {clientId && (() => {
                if (errorEdiciones) return <td>No se pudo leer</td>;
                const e = ediciones[m.id] ?? { estado: 'ninguno' as EstadoEdicion, correo: '' };
                const a = accionesDeMiembro({ clientId, esAdmin: true, estado: e.estado, miembroActivo: m.estado === 'activo' });
                return (
                  <td>
                    {ROTULO_ESTADO[e.estado]}{e.estado === 'activo' && e.correo !== '' && <> con {e.correo}</>}
                    {a.habilitar && eligiendoUid !== m.id && (
                      <button type="button" className="btn btn-secondary" disabled={ocupadoUid !== null}
                              onClick={() => { setAvisoEdicion(null); setEligiendoUid(m.id); }}>Habilitar edición</button>
                    )}
                    {eligiendoUid === m.id && (
                      <BotonGoogle clientId={clientId} alElegir={(t) => { void habilitarA(m.id, t); }} alCancelar={() => setEligiendoUid(null)} />
                    )}
                    {a.quitar && (
                      <button type="button" className="btn btn-secondary" disabled={ocupadoUid !== null}
                              onClick={() => { void quitarA(m.id); }}>Quitar edición</button>
                    )}
                  </td>
                );
              })()}
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
      {avisoEdicion && <p role={avisoEdicion.error ? 'alert' : 'status'}>{avisoEdicion.texto}</p>}
    </section>
  );
}
