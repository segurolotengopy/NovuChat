import { useEffect, useMemo, useState } from 'react';
import { collection, documentId, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../core/lib/firebase';
import { COLUMNAS, lineasDeCobros, mesLegible, ultimosMesesDeCobro } from './contadoresDeCobro';

/**
 * CONTADORES DE COBRO — solo números, una línea por mes.
 *
 * Lee `metricas/{aaaa-mm}` con la regla que ya existe (lectura del miembro).
 * No muestra listas, imágenes ni datos del comprobante. Sin ningún contador de
 * la regla nueva en ningún mes, no pinta nada.
 *
 * Prohibición 3: el cotejo lee datos de una imagen, que se edita. «Válido»
 * quiere decir que los datos coincidieron; quien confirma que la plata entró
 * es el banco y el negocio. Por eso los textos hablan de comprobantes y datos,
 * nunca de pagos acreditados o verificados.
 */
export function ContadoresDeCobro({ tenantId }: { tenantId: string }) {
  const [periodos, setPeriodos] = useState<{ id: string; [k: string]: unknown }[]>([]);
  const [fallo, setFallo] = useState(false);
  const meses = useMemo(() => ultimosMesesDeCobro(6), []);

  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(
      query(collection(db, 'tenants', tenantId, 'metricas'), where(documentId(), 'in', meses)),
      (s) => { setFallo(false); setPeriodos(s.docs.map((d) => ({ id: d.id, ...d.data() }))); },
      () => { setPeriodos([]); setFallo(true); },
    );
  }, [tenantId, meses]);

  const lineas = lineasDeCobros(periodos);
  if (fallo) return <p role="alert">No se pudieron leer los contadores de comprobantes.</p>;
  if (lineas.length === 0) return null;
  const mesEnCurso = ultimosMesesDeCobro(1)[0];

  return (
    <article className="tarjeta" aria-label="Comprobantes por mes">
      <h3>Comprobantes por mes (últimos 6 meses)</h3>
      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr><th>Mes</th>{COLUMNAS.map((c) => <th key={c.titulo}>{c.titulo}</th>)}</tr>
          </thead>
          <tbody>
            {lineas.map((l) => (
              <tr key={l.periodo}>
                <td>{mesLegible(l.periodo)}</td>
                {COLUMNAS.map((c) => <td key={c.titulo}>{c.valor(l)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {lineas.some((l) => l.periodo === mesEnCurso && l.porConfirmar > 0) && (
        <p><span className="tag tag-aviso">Este mes hay comprobantes aproximados o en revisión</span></p>
      )}
      <p className="ayuda tarjeta-pie">
        Cifras del mes: cada comprobante rechazado se cuenta, y un cobro puede
        tener hasta tres. Los comprobantes «aproximados» y «en revisión» los
        confirma una persona del negocio mirando su cuenta. Que los datos
        coincidan no confirma que el dinero entró: eso lo dice su banco.
      </p>
    </article>
  );
}
