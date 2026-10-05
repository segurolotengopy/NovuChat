import { useEffect, useMemo, useState } from 'react';
import { collection, doc, documentId, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../core/lib/firebase';
import { COLUMNAS, cobroRealActivo, lineasDeCobros, mesLegible, ultimosMesesDeCobro } from './contadoresDeCobro';

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

  // Lectura única, no en vivo: el documento del mes en curso cambia con cada
  // mensaje y los contadores no necesitan estar al segundo.
  const [real, setReal] = useState<boolean | null>(null);
  useEffect(() => {
    if (!tenantId) return;
    let vivo = true;
    void (async () => {
      try {
        const [m, v] = await Promise.all([
          getDocs(query(collection(db, 'tenants', tenantId, 'metricas'), where(documentId(), 'in', meses))),
          getDoc(doc(db, 'tenants', tenantId, 'config', 'venta')),
        ]);
        if (!vivo) return;
        setPeriodos(m.docs.map((d) => ({ id: d.id, ...d.data() })));
        setReal(cobroRealActivo(v.data()));
        setFallo(false);
      } catch {
        if (vivo) { setPeriodos([]); setFallo(true); }
      }
    })();
    return () => { vivo = false; };
  }, [tenantId, meses]);

  const lineas = lineasDeCobros(periodos);
  if (fallo) return <p role="alert">No se pudieron leer los contadores de comprobantes.</p>;
  if (lineas.length === 0 || real === null) return null;
  if (!real) {
    return <p className="ayuda">Cobro simulado: los comprobantes no se cotejan.</p>;
  }
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
        <p><span className="tag tag-aviso">Este mes hubo comprobantes aproximados o en revisión</span></p>
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
