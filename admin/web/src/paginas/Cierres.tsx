import { useEffect, useMemo, useState } from 'react';
import {
  collection, documentId, limit, onSnapshot, orderBy, query, where,
} from 'firebase/firestore';
import { useParams } from 'react-router-dom';
import { db } from '../lib/firebase';
import { useSesion } from '../lib/contexto';
import { TextoSeguro } from '../componentes/TextoSeguro';

/**
 * CIERRES — la pantalla de la oferta comercial.
 *
 * =============================================================================
 * LAS TRES CIFRAS, con su definición exacta. Acá se factura, así que ninguna
 * puede quedar librada a interpretación.
 * =============================================================================
 *
 *   CIERRE       Una atención de WhatsApp que TERMINÓ BIEN y quedó registrada
 *                en algo verificable: una cita en el calendario, una venta con
 *                su comprobante recibido, una fila escrita en la planilla.
 *
 *                NO son cierres, y esto importa más que la definición positiva
 *                porque es lo que evita cobrar de más:
 *                  · mandar información y que el cliente no confirme nada;
 *                  · mandar el QR y que el cliente no pague;
 *                  · una conversación que quedó a medias, con datos incompletos.
 *                La regla práctica: si no hay un registro externo que lo pruebe,
 *                no es un cierre. Por eso cada cierre guarda su `referencia`, y
 *                las reglas rechazan uno que llegue sin ella.
 *
 *   ATENCIÓN     Una conversación iniciada con un cliente. Cuenta el arranque,
 *                haya terminado bien o no.
 *
 *   INTERACCIÓN  Una conversación en la que el cliente recibió MÁS DE UNA
 *                respuesta. Mide las que pasaron de un saludo suelto a un ida y
 *                vuelta de verdad.
 *
 * Las tres se leen de un agregado por período que escribe la ruta de ingesta.
 * NADIE las escribe desde el navegador, ni el comercio ni NovuChat: la cifra
 * que se factura no la toca ninguna de las dos partes interesadas.
 *
 * La relación entre las tres es la que cuenta la historia comercial: de cada
 * cien atenciones, cuántas llegaron a ida y vuelta, y cuántas terminaron en algo.
 */

interface Periodo {
  id: string;
  cierres?: number;
  atenciones?: number;
  interacciones?: number;
  personasAtendidas?: number;
}

interface Cierre {
  id: string;
  tipo?: unknown;
  ocurridoEn?: { toDate?: () => Date };
  referencia?: unknown;
  telefonoEnmascarado?: unknown;
  monto?: unknown;
  moneda?: unknown;
}

const NOMBRE_TIPO: Record<string, string> = {
  cita: 'Cita agendada',
  venta: 'Venta con comprobante',
  registro: 'Registro en planilla',
};

function ultimosMeses(cantidad: number): string[] {
  const hoy = new Date();
  return Array.from({ length: cantidad }, (_, i) => {
    const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

/** Porcentaje entero, o null si el denominador es cero. Nunca «NaN%». */
function porcentaje(parte: number, total: number): number | null {
  return total > 0 ? Math.round((parte / total) * 100) : null;
}

/**
 * Detalle de los cierres del período.
 *
 * LO ABRE TAMBIÉN NOVUCHAT, y por eso lo que se muestra acá es deliberadamente
 * pobre: tipo, fecha, referencia externa, teléfono enmascarado y monto. Nada
 * del contenido de la conversación ni el número completo. El detalle que
 * identifica a la persona vive en `/cierres/{id}/privado`, que solo abre el
 * administrador del negocio y esta pantalla ni siquiera pide.
 *
 * Existe porque sobre esto se factura: un número que nadie puede desglosar no
 * se puede discutir con un cliente que reclama.
 */
function DetalleCierres({ tenantId, cerrar }: { tenantId: string; cerrar: () => void }) {
  const [cierres, setCierres] = useState<Cierre[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => onSnapshot(
    query(collection(db, 'tenants', tenantId, 'cierres'), orderBy('ocurridoEn', 'desc'), limit(50)),
    (i) => setCierres(i.docs.map((d) => ({ id: d.id, ...d.data() } as Cierre))),
    () => setError('No se pudieron leer los cierres.'),
  ), [tenantId]);

  // Escape cierra el diálogo: es lo que espera cualquiera que lo abrió sin querer.
  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar(); };
    document.addEventListener('keydown', alPulsar);
    return () => document.removeEventListener('keydown', alPulsar);
  }, [cerrar]);

  return (
    <div className="dialog-backdrop" onClick={cerrar}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Detalle de cierres"
           onClick={(e) => e.stopPropagation()}>
        <h3 className="dialog-title">Cierres registrados</h3>
        <div className="dialog-body">
          {error && <p role="alert">{error}</p>}
          {cierres === null && <p>Cargando…</p>}
          {cierres?.length === 0 && (
            <p className="vacio">
              Todavía no hay ningún cierre registrado para este negocio.
            </p>
          )}
          {cierres && cierres.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr><th>Cuándo</th><th>Tipo</th><th>Cliente</th><th>Referencia</th><th>Monto</th></tr>
                </thead>
                <tbody>
                  {cierres.map((c) => (
                    <tr key={c.id}>
                      <td>{c.ocurridoEn?.toDate?.().toLocaleDateString('es-BO') ?? '—'}</td>
                      <td>{NOMBRE_TIPO[String(c.tipo)] ?? <TextoSeguro valor={c.tipo} maxLargo={20} />}</td>
                      <td><TextoSeguro valor={c.telefonoEnmascarado} maxLargo={20} /></td>
                      <td><TextoSeguro valor={c.referencia} maxLargo={40} /></td>
                      <td>
                        {typeof c.monto === 'number'
                          ? `${c.monto} ${typeof c.moneda === 'string' ? c.moneda : ''}`.trim()
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-muted">
            El teléfono va enmascarado y no se muestra nada de la conversación.
            Este detalle existe para poder explicar una factura, no para mirar
            la actividad del negocio.
          </p>
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-primary" onClick={cerrar}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

export function Cierres() {
  const { tenantId = '' } = useParams();
  const { permisos } = useSesion();
  const [periodos, setPeriodos] = useState<Periodo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [verDetalle, setVerDetalle] = useState(false);
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
      () => setError('No se pudo leer la actividad.'),
    );
  }, [tenantId, meses]);

  const actual = periodos[0];
  const cierres = actual?.cierres ?? 0;
  const atenciones = actual?.atenciones ?? 0;
  const interacciones = actual?.interacciones ?? 0;
  const tasa = porcentaje(cierres, atenciones);

  return (
    <section>
      <h2>Cierres</h2>
      {error && <p role="alert">{error}</p>}

      <div className="cuadricula">
        <article className="card elev-sm">
          <h3 className="card-kicker">Este mes</h3>
          <div className="datos">
            <div className="dato"><strong>{cierres}</strong><span>cierres</span></div>
            <div className="dato"><strong>{atenciones}</strong><span>atenciones</span></div>
            <div className="dato"><strong>{interacciones}</strong><span>interacciones</span></div>
          </div>
          {tasa !== null && (
            <p className="text-muted">
              De cada 100 conversaciones, {tasa} terminaron en un cierre.
            </p>
          )}
          <div className="tarjeta-pie">
            <button type="button" className="btn btn-secondary" onClick={() => setVerDetalle(true)}>
              Ver el detalle
            </button>
          </div>
        </article>

        <article className="card elev-sm">
          <h3 className="card-kicker">Qué cuenta cada número</h3>
          <div className="card-body">
            <p>
              <strong>Cierre:</strong> una conversación que terminó en algo concreto
              y verificable — una cita en el calendario, una venta con su
              comprobante, un registro en la planilla. Es lo que se factura.
            </p>
            <p>
              <strong>No cuentan como cierre</strong> mandar información que nadie
              confirmó, mandar el QR sin que el cliente pague, ni una conversación
              que quedó a medias. Si no hay un registro que lo pruebe, no se cobra.
            </p>
            <p>
              <strong>Atención:</strong> una conversación iniciada.{' '}
              <strong>Interacción:</strong> una conversación en la que el cliente
              recibió más de una respuesta.
            </p>
          </div>
        </article>
      </div>

      <h3>Por mes</h3>
      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Mes</th><th>Cierres</th><th>Atenciones</th>
              <th>Interacciones</th><th>Personas distintas</th>
            </tr>
          </thead>
          <tbody>
            {periodos.map((p) => (
              <tr key={p.id}>
                <td>{p.id}</td>
                <td><strong>{p.cierres ?? 0}</strong></td>
                <td>{p.atenciones ?? 0}</td>
                <td>{p.interacciones ?? 0}</td>
                <td>{p.personasAtendidas ?? 0}</td>
              </tr>
            ))}
            {periodos.length === 0 && (
              <tr>
                <td colSpan={5}>
                  Todavía no hay actividad registrada. Los números aparecen cuando
                  el asistente empieza a atender por WhatsApp.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {permisos.propietario && (
        <p className="text-muted">
          Como cuenta de NovuChat ves el conteo y el detalle de los cierres para
          poder explicar una factura. No ves las conversaciones ni los datos de
          los clientes de este negocio.
        </p>
      )}

      {verDetalle && <DetalleCierres tenantId={tenantId} cerrar={() => setVerDetalle(false)} />}
    </section>
  );
}
