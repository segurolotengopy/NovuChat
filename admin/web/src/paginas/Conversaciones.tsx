import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { useParams } from 'react-router-dom';
import { db } from '../lib/firebase';
import { TextoSeguro } from '../componentes/TextoSeguro';

interface Mensaje { id: string; direccion?: unknown; texto?: unknown; ts?: { toDate(): Date } }
interface Conversacion { id: string; telefono?: unknown; ultimoMensaje?: unknown }

/**
 * Visor de conversaciones. Todo lo que se pinta acá lo escribió un desconocido:
 * pasa SIEMPRE por <TextoSeguro>, nunca por interpolación directa en HTML.
 *
 * La consulta está anclada bajo /tenants/{tenantId}: es la ruta la que decide
 * qué se puede leer. No hay ningún `where('tenantId', '==', ...)` que un usuario
 * pudiera cambiar en el navegador para mirar a otro negocio.
 */
export function Conversaciones() {
  const { tenantId = '' } = useParams();
  const [conversaciones, setConversaciones] = useState<Conversacion[]>([]);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(
      query(collection(db, 'tenants', tenantId, 'conversaciones'), orderBy('ultimoEn', 'desc'), limit(50)),
      (i) => setConversaciones(i.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setError('No se pudieron leer las conversaciones.'),
    );
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId || !abierta) { setMensajes([]); return; }
    return onSnapshot(
      query(
        collection(db, 'tenants', tenantId, 'conversaciones', abierta, 'mensajes'),
        orderBy('ts', 'asc'), limit(300),
      ),
      (i) => setMensajes(i.docs.map((d) => ({ id: d.id, ...d.data() } as Mensaje))),
      () => setError('No se pudieron leer los mensajes.'),
    );
  }, [tenantId, abierta]);

  return (
    <section className="dos-columnas">
      {error && <p role="alert">{error}</p>}
      <ul className="lista-hilos">
        {conversaciones.map((c) => (
          <li key={c.id}>
            <button onClick={() => setAbierta(c.id)} aria-current={abierta === c.id}>
              <strong><TextoSeguro valor={c.telefono} maxLargo={15} /></strong>
              <TextoSeguro valor={c.ultimoMensaje} maxLargo={80} />
            </button>
          </li>
        ))}
      </ul>

      <ol className="hilo">
        {mensajes.map((m) => (
          <li key={m.id} className={m.direccion === 'entrante' ? 'entrante' : 'saliente'}>
            <TextoSeguro valor={m.texto} />
            <time>{m.ts?.toDate ? m.ts.toDate().toLocaleString('es-BO') : ''}</time>
          </li>
        ))}
      </ol>
    </section>
  );
}
