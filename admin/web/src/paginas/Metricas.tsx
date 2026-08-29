import { useEffect, useMemo, useState } from 'react';
import { collection, documentId, onSnapshot, query, where } from 'firebase/firestore';
import { useParams } from 'react-router-dom';
import { db } from '../lib/firebase';

interface Periodo {
  id: string;
  personasAtendidas?: number;
  conversaciones?: number;
  mensajes?: number;
  entrantes?: number;
  citasAgendadas?: number;
}

/**
 * Uso del asistente, visible para el comercio.
 *
 * PERSONAS ATENDIDAS es el número que sostiene la facturación por uso, y es un
 * conteo de ÚNICOS: una persona que escribió treinta veces en el mes cuenta una.
 * Se lee de un agregado precalculado por la ruta de ingesta (ver DISENO.md
 * §4bis.2), no se cuenta acá: así esta pantalla no necesita permiso de lectura
 * sobre el contenido de los mensajes, y no cuesta miles de lecturas.
 *
 * Nadie puede escribir /metricas desde el navegador —ni el comercio ni
 * NovuChat—: la métrica que se factura no la toca ninguna de las dos partes
 * interesadas.
 *
 * SOBRE LA CONSULTA: los documentos se llaman 'aaaa-mm'. Firestore **no admite
 * `orderBy('__name__', 'desc')`** ("does not support descending key scans"), así
 * que se pide la lista explícita de los últimos doce períodos con
 * `where(documentId(), 'in', [...])` —el tope de `in` es 30— y se ordena acá.
 * Una sola ida y vuelta, sin índice compuesto.
 */
function ultimosMeses(cantidad: number): string[] {
  const hoy = new Date();
  return Array.from({ length: cantidad }, (_, i) => {
    const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

export function Metricas() {
  const { tenantId = '' } = useParams();
  const [periodos, setPeriodos] = useState<Periodo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const meses = useMemo(() => ultimosMeses(12), []);

  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(
      query(collection(db, 'tenants', tenantId, 'metricas'), where(documentId(), 'in', meses)),
      (i) => setPeriodos(
        i.docs
          .map((d) => ({ id: d.id, ...d.data() } as Periodo))
          .sort((a, b) => b.id.localeCompare(a.id)),
      ),
      () => setError('No se pudo leer el uso.'),
    );
  }, [tenantId, meses]);

  return (
    <section>
      <h2>Uso del asistente</h2>
      {error && <p role="alert">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>Mes</th>
            <th>Personas atendidas</th>
            <th>Mensajes</th>
            <th>Recibidos</th>
            <th>Citas</th>
          </tr>
        </thead>
        <tbody>
          {periodos.map((p) => (
            <tr key={p.id}>
              <td>{p.id}</td>
              <td><strong>{p.personasAtendidas ?? 0}</strong></td>
              <td>{p.mensajes ?? 0}</td>
              <td>{p.entrantes ?? 0}</td>
              <td>{p.citasAgendadas ?? 0}</td>
            </tr>
          ))}
          {periodos.length === 0 && (
            <tr><td colSpan={5}>Todavía no hay actividad registrada.</td></tr>
          )}
        </tbody>
      </table>
      <p className="ayuda">
        <strong>Personas atendidas</strong> cuenta personas distintas, no mensajes:
        alguien que escribió varias veces en el mes cuenta una sola vez. Es el
        número sobre el que se calcula su plan.
      </p>
    </section>
  );
}
