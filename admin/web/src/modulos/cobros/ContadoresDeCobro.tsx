import { useEffect, useMemo, useState } from 'react';
import { collection, documentId, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../core/lib/firebase';
import { lineasDeCobros, ultimosMesesDeCobro } from './contadoresDeCobro';

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
  const meses = useMemo(() => ultimosMesesDeCobro(6), []);

  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(
      query(collection(db, 'tenants', tenantId, 'metricas'), where(documentId(), 'in', meses)),
      (s) => setPeriodos(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setPeriodos([]),
    );
  }, [tenantId, meses]);

  const lineas = lineasDeCobros(periodos);
  if (lineas.length === 0) return null;

  return (
    <article className="tarjeta" aria-label="Comprobantes por mes">
      <h3>Comprobantes por mes</h3>
      <table className="table">
        <thead>
          <tr>
            <th>Mes</th><th>QR enviados</th><th>Datos coinciden</th>
            <th>Por confirmar</th><th>No coinciden</th><th>Cancelados</th><th>Tardíos</th>
          </tr>
        </thead>
        <tbody>
          {lineas.map((l) => (
            <tr key={l.periodo}>
              <td>{l.periodo}</td>
              <td>{l.qrEnviados}</td>
              <td>{l.validos}</td>
              <td>
                {l.porConfirmar > 0
                  ? <span className="tag tag-aviso">{l.porConfirmar}</span>
                  : 0}
                {l.porConfirmar > 0 && (
                  <span className="ayuda"> ({l.aproximados} aproximados, {l.enRevision} en revisión)</span>
                )}
              </td>
              <td>{l.invalidos}</td>
              <td>{l.cancelados}</td>
              <td>{l.tardios}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="ayuda tarjeta-pie">
        Los comprobantes «aproximados» y «en revisión» los confirma una persona
        del negocio mirando su cuenta. Que los datos coincidan no confirma que el
        dinero entró: eso lo dice su banco.
      </p>
    </article>
  );
}
