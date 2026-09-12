import { useEffect, useMemo, useState } from 'react';
import {
  collection, documentId, limit, onSnapshot, orderBy, query, where,
} from 'firebase/firestore';
import { useParams } from 'react-router-dom';
import { db } from '../lib/firebase';
import { TextoSeguro } from '../componentes/TextoSeguro';
import { descargarCsv } from '../lib/exportar';

/**
 * CONSUMO — lo que se factura, con el mismo vocabulario que la página de precios.
 *
 * =============================================================================
 * LAS TRES CIFRAS, con su definición exacta. Acá se factura, así que ninguna
 * puede quedar librada a interpretación.
 * =============================================================================
 *
 *   CONVERSACIÓN Todos los mensajes con un mismo cliente durante 24 horas
 *                continuas, sin importar cuántos sean. ES LA UNIDAD QUE SE
 *                FACTURA, y es la misma que usa Meta para cobrarnos a nosotros.
 *
 *   ATENCIÓN     Una persona distinta atendida en el período. Si el mismo
 *                cliente vuelve tres veces en el mes, son TRES conversaciones y
 *                UNA atención. En el código se llama `personasAtendidas`.
 *
 *   CIERRE       Una cita agendada o un pedido confirmado, con algo verificable
 *                que lo pruebe. YA NO SE FACTURA: mide si el asistente está
 *                vendiendo o solo respondiendo.
 *
 *                No cuentan como cierre mandar información que nadie confirmó,
 *                mandar el QR sin que el cliente pague, ni una conversación que
 *                quedó a medias. Cada cierre guarda su `referencia`, y las
 *                reglas rechazan uno que llegue sin ella.
 *
 *   INTERACCIÓN  Una conversación en la que el cliente recibió MÁS DE UNA
 *                respuesta. No está en la página de precios: es un indicador
 *                interno para ver si la gente escribe y se va.
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
  conversaciones?: number;
  /** Nombre viejo del mismo número. Se lee para no perder los meses ya escritos. */
  atenciones?: number;
  cierres?: number;
  interacciones?: number;
  personasAtendidas?: number;
}

/** Conversaciones del período, tolerando el nombre anterior. */
function conversacionesDe(p: Periodo | undefined): number {
  return p?.conversaciones ?? p?.atenciones ?? 0;
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
      {/* `dialog-ancho`: el diálogo del sistema mide 440px, que alcanza para una
          confirmación y no para una tabla de cinco columnas. Lo que se veía el
          09/09 era la referencia de Meta partida en seis renglones y el botón
          de cerrar empujado fuera de la pantalla. */}
      <div className="dialog dialog-ancho" role="dialog" aria-modal="true"
           aria-label="Detalle de cierres" onClick={(e) => e.stopPropagation()}>
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
          {/* Se quitó «este detalle existe para poder explicar una factura, no
              para mirar la actividad del negocio»: es la justificación de una
              decisión nuestra, y el comercio no la pidió. Lo que sí le sirve
              saber —que el teléfono va enmascarado— se queda. */}
          <p className="text-muted">
            El teléfono va enmascarado y no se muestra el contenido de las
            conversaciones.
          </p>
        </div>
        <div className="dialog-actions">
          {cierres && cierres.length > 0 && (
            <button type="button" className="btn btn-secondary" onClick={() => descargarCsv(
              'cierres',
              ['Cuándo', 'Tipo', 'Cliente', 'Referencia', 'Monto', 'Moneda'],
              cierres.map((c) => [
                c.ocurridoEn?.toDate?.().toLocaleString('es-BO') ?? '',
                NOMBRE_TIPO[String(c.tipo)] ?? c.tipo,
                c.telefonoEnmascarado, c.referencia,
                typeof c.monto === 'number' ? c.monto : '',
                typeof c.moneda === 'string' ? c.moneda : '',
              ]),
            )}>Exportar</button>
          )}
          <button type="button" className="btn btn-primary" onClick={cerrar}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

export function Consumo() {
  const { tenantId = '' } = useParams();
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
  const conversaciones = conversacionesDe(actual);
  const atenciones = actual?.personasAtendidas ?? 0;
  const cierres = actual?.cierres ?? 0;
  const tasa = porcentaje(cierres, conversaciones);

  return (
    <section>
      <h2>Consumo</h2>
      {error && <p role="alert">{error}</p>}

      <div className="cuadricula">
        <article className="card elev-sm">
          <h3 className="card-kicker">Este mes</h3>
          <div className="datos">
            <div className="dato">
              <strong>{conversaciones}</strong><span>conversaciones</span>
            </div>
            <div className="dato"><strong>{atenciones}</strong><span>atenciones</span></div>
            <div className="dato"><strong>{cierres}</strong><span>cierres</span></div>
          </div>
          {/* ACÁ HABÍA DOS FRASES COMERCIALES y las dos se van.
              «Es el número que se factura, y es el mismo que ves acá y en tu
              plan» es argumento de venta, no información de una pantalla de
              consumo: quien la abre ya compró.
              Y la otra estaba directamente MAL: «de cada 100 conversaciones,
              267 terminaron en un cierre» —lo que se veía el 09/09— porque la
              tasa divide cierres entre conversaciones sin ningún tope, y un
              mismo cliente puede cerrar varias veces dentro de la misma
              ventana de 24 h. Un número imposible en la primera tarjeta hace
              dudar de todos los demás. La relación cierres/conversaciones
              sigue estando, sin disfrazarla de porcentaje. */}
          {tasa !== null && (
            <p className="text-muted">
              {cierres} {cierres === 1 ? 'cierre' : 'cierres'} sobre {conversaciones}{' '}
              {conversaciones === 1 ? 'conversación' : 'conversaciones'}.
            </p>
          )}
          <div className="tarjeta-pie">
            <button type="button" className="btn btn-secondary" onClick={() => setVerDetalle(true)}>
              Ver el detalle
            </button>
          </div>
        </article>

        {/* La tarjeta de definiciones se queda: es un GLOSARIO y no una venta.
            Un comercio que ve tres números sin saber qué mide cada uno no puede
            revisar su factura. Lo que se sacó de acá fueron las frases que
            argumentan; las que definen quedan. */}
        <article className="card elev-sm">
          <h3 className="card-kicker">Qué cuenta cada número</h3>
          <div className="card-body">
            <p>
              <strong>Conversación:</strong> todos los mensajes con un mismo
              cliente durante 24 horas continuas, sin importar cuántos sean.
              <strong> Es lo que se factura.</strong> Si alguien escribe a la
              mañana y cierra su pedido a la tarde, es una sola.
            </p>
            <p>
              <strong>Atención:</strong> personas distintas del mes. El mismo
              cliente que vuelve tres veces son tres conversaciones y una
              atención.
            </p>
            <p>
              <strong>Cierre:</strong> una cita agendada o un pedido confirmado.
              No se factura: sirve para ver si el asistente está vendiendo o solo
              respondiendo.
            </p>
          </div>
        </article>
      </div>

      <h3>Por mes</h3>
      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Mes</th><th>Conversaciones</th><th>Atenciones</th>
              <th>Cierres</th><th>Interacciones</th>
            </tr>
          </thead>
          <tbody>
            {periodos.map((p) => (
              <tr key={p.id}>
                <td>{p.id}</td>
                <td><strong>{conversacionesDe(p)}</strong></td>
                <td>{p.personasAtendidas ?? 0}</td>
                <td>{p.cierres ?? 0}</td>
                <td>{p.interacciones ?? 0}</td>
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

      {/* Se quitó la aclaración de que desde esta cuenta «no se ven las
          conversaciones». Ver el comentario de `Tablero.tsx`: es una promesa
          que el soporte contradice el día que el comercio nos pide entrar con
          su usuario, y una garantía desmentida enseña a no creer en las demás. */}

      {verDetalle && <DetalleCierres tenantId={tenantId} cerrar={() => setVerDetalle(false)} />}
    </section>
  );
}
