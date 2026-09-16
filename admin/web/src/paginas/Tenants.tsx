import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { db } from '../lib/firebase';
import { TextoSeguro } from '../componentes/TextoSeguro';
import { avisoConsumoVigente, nombreDePlan, type AvisoConsumoVista } from '../lib/planes';

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
 * LA MARCA DEL 80 %. Un comercio que pasa del 70-80 % de su plan es una
 * conversación comercial pendiente («Base comercial» §3), y es de NovuChat, no
 * del comercio: por eso se marca acá, en la cartera, además de avisarle a él.
 */
export function Tenants() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [avisos, setAvisos] = useState<Record<string, AvisoConsumoVista | null>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => onSnapshot(
    query(collection(db, 'tenants'), orderBy('nombre')),
    (instantanea) => setTenants(instantanea.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => setError('No se pudo leer la cartera de clientes.'),
  ), []);

  // Un documento por comercio: `cuenta/estado` vive debajo de cada uno y la
  // regla lo abre al propietario de a uno (no hay consulta de grupo). La
  // cartera es de decenas, no de miles, y cada lectura es un documento chico.
  // Un error de lectura deja la casilla vacía: la marca es un recordatorio, y
  // su ausencia no puede tapar la lista entera.
  const ids = tenants.map((t) => t.id).join('|');
  useEffect(() => {
    if (!ids) return;
    const bajas = ids.split('|').map((id) => onSnapshot(doc(db, 'tenants', id, 'cuenta', 'estado'),
      (d) => setAvisos((a) => ({ ...a, [id]: avisoConsumoVigente(d.data()) })),
      () => setAvisos((a) => ({ ...a, [id]: null }))));
    return () => bajas.forEach((baja) => baja());
  }, [ids]);

  const conAviso = tenants.filter((t) => avisos[t.id]).length;

  return (
    <section>
      <h2>Negocios</h2>
      {error && <p role="alert">{error}</p>}
      {conAviso > 0 && (
        <p className="ayuda aviso-datos">
          {conAviso === 1 ? 'Un negocio pasó' : `${conAviso} negocios pasaron`} el
          80 % de las conversaciones de su plan este mes. Es el momento de
          ofrecerles una bolsa o un plan más grande, antes de que se pasen.
        </p>
      )}
      <table className="table">
        <thead><tr><th>Negocio</th><th>Estado</th><th>Plan</th><th>Consumo del mes</th><th /></tr></thead>
        <tbody>
          {tenants.map((t) => {
            const aviso = avisos[t.id];
            return (
              <tr key={t.id}>
                <td><TextoSeguro valor={t.nombre} maxLargo={80} /></td>
                <td><TextoSeguro valor={t.estado} maxLargo={20} /></td>
                <td>{nombreDePlan(t.plan) ?? <TextoSeguro valor={t.plan} maxLargo={20} />}</td>
                <td>
                  {aviso
                    ? <span className="tag tag-aviso" title="El servidor marcó el aviso de consumo este mes">
                        {aviso.porcentaje} %: {aviso.conversaciones} de {aviso.limite}
                      </span>
                    : <span className="text-muted">—</span>}
                </td>
                <td><Link to={`/negocio/${encodeURIComponent(t.id)}/consumo`}>Ver consumo</Link></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
