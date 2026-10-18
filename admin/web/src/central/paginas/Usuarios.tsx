import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useParams } from 'react-router-dom';
import { db, funciones } from '../../core/lib/firebase';
import { TextoSeguro } from '../componentes/TextoSeguro';
import { useConsolaOculta } from '../componentes/ConsolaOculta';
import { esVisible } from '../../../../functions/src/central/consola-oculta';

interface Miembro { id: string; correo?: unknown; rol?: unknown; estado?: unknown }
interface Invitacion { id: string; correo?: unknown; rol?: unknown; estado?: unknown; venceEn?: unknown }

/** Mensaje del servidor si lo hay (los rechazos de invitar traen el motivo exacto). */
const mensajeDe = (e: unknown, defecto: string): string => {
  const m = (e as { message?: unknown })?.message;
  const codigo = String((e as { code?: unknown })?.code ?? '');
  // Un error `internal` del servidor llega sin texto útil: se usa el mensaje en español por defecto.
  if (typeof m !== 'string' || m === '' || m.toLowerCase() === 'internal' || codigo.endsWith('/internal')) return defecto;
  return m;
};

/** Milisegundos de un Timestamp de Firestore (o NaN). */
const msDe = (v: unknown): number =>
  typeof (v as { toMillis?: unknown })?.toMillis === 'function' ? (v as { toMillis: () => number }).toMillis() : Number.NaN;

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
  const [invitaciones, setInvitaciones] = useState<Invitacion[]>([]);
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

  // Las invitaciones las lee el administrador (las reglas se lo dejan solo a él): para un
  // operador la lectura se niega y la sección simplemente no aparece.
  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(collection(db, 'tenants', tenantId, 'invitaciones'),
      (i) => setInvitaciones(i.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setInvitaciones([]));
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
      const r = await invitar({ tenantId, correo, rol });
      setEstado((r.data as { mensaje?: string } | null)?.mensaje ?? 'Invitación registrada.');
      setCorreo('');
    } catch (err) {
      setEstado(mensajeDe(err, 'No se pudo enviar la invitación.'));
    }
  };

  const reenviar = async (i: Invitacion) => {
    setEstado(null);
    try {
      const r = await httpsCallable(funciones, 'invitarUsuario')({ tenantId, correo: i.correo, rol: i.rol === 'admin' ? 'admin' : 'oper' });
      setEstado((r.data as { mensaje?: string } | null)?.mensaje ?? 'Invitación reenviada.');
    } catch (err) {
      setEstado(mensajeDe(err, 'No se pudo reenviar la invitación.'));
    }
  };

  const cancelar = async (i: Invitacion) => {
    setEstado(null);
    try {
      // Depende del PR-I0: `cancelarInvitacion` aún no se exporta en index.ts.
      const r = await httpsCallable(funciones, 'cancelarInvitacion')({ tenantId, invitacionId: i.id });
      setEstado((r.data as { mensaje?: string } | null)?.mensaje ?? 'Invitación cancelada.');
    } catch (err) {
      setEstado(mensajeDe(err, 'No se pudo cancelar la invitación.'));
    }
  };

  // Solo las que esperan respuesta: las aceptadas ya son usuarias y las canceladas o
  // rechazadas no se listan. «Vencida» se calcula con el plazo aunque el documento diga pendiente.
  const ahora = Date.now();
  const abiertas = invitaciones.filter((i) => i.estado === 'pendiente' || i.estado === 'vencida');
  const vencida = (i: Invitacion) => i.estado === 'vencida' || !(msDe(i.venceEn) > ahora);

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

      {abiertas.length > 0 && <>
        <h3>Invitaciones</h3>
        <table>
          <thead><tr><th>Correo</th><th>Rol</th><th>Vigencia</th><th>Acción</th></tr></thead>
          <tbody>
            {abiertas.map((i) => (
              <tr key={i.id}>
                <td><TextoSeguro valor={i.correo} maxLargo={254} /></td>
                <td><TextoSeguro valor={i.rol} maxLargo={20} /></td>
                <td>{vencida(i) ? 'Vencida' : `Vence el ${new Date(msDe(i.venceEn)).toLocaleDateString('es-BO')}`}</td>
                <td>
                  {puedeInvitar && <button type="button" onClick={() => void reenviar(i)}>Reenviar</button>}
                  <button type="button" onClick={() => void cancelar(i)}>Cancelar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </>}

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
