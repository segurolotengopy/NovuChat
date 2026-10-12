import { useEffect, useMemo, useState } from 'react';
import { collection, doc, documentId, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../core/lib/firebase';
import {
  COLUMNAS, decidirPintado, leerContadores, lineasDeCobros, mesLegible, ultimosMesesDeCobro,
  type LecturaDeContadores,
} from './contadoresDeCobro';

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
  const meses = useMemo(() => ultimosMesesDeCobro(6), []);

  // Lectura única, no en vivo: el documento del mes en curso cambia con cada
  // mensaje y los contadores no necesitan estar al segundo.
  // `metricas` y `config/venta` se leen por separado (`leerContadores`): el
  // propietario de NovuChat lee `metricas` pero no `config/venta`, y esa
  // denegación no debe tumbar los contadores.
  const [lectura, setLectura] = useState<LecturaDeContadores | null>(null);
  useEffect(() => {
    if (!tenantId) return;
    let vivo = true;
    void leerContadores(
      async () => (await getDocs(query(collection(db, 'tenants', tenantId, 'metricas'), where(documentId(), 'in', meses))))
        .docs.map((d) => ({ id: d.id, ...d.data() })),
      async () => (await getDoc(doc(db, 'tenants', tenantId, 'config', 'venta'))).data(),
    ).then((l) => { if (vivo) setLectura(l); });
    return () => { vivo = false; };
  }, [tenantId, meses]);

  if (!lectura) return null;
  const lineas = lineasDeCobros(lectura.periodos);
  const pintado = decidirPintado(lectura.metricas, lectura.config, lectura.real, lineas.length > 0);
  if (pintado === 'error') return <p role="alert">No se pudieron leer los contadores de comprobantes.</p>;
  if (pintado === 'nada') return null;
  if (pintado === 'simulado') {
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
