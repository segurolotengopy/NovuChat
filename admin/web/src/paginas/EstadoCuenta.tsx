import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { useParams } from 'react-router-dom';
import { db } from '../lib/firebase';
import { TextoSeguro } from '../componentes/TextoSeguro';

interface Cuenta {
  plan?: unknown;
  estadoPago?: unknown;
  montoMensual?: unknown;
  moneda?: unknown;
  proximoVencimiento?: { toDate(): Date };
  motivoVisible?: unknown;
}

const ETIQUETA: Record<string, string> = {
  al_dia: 'Al día',
  pendiente: 'Pago pendiente',
  vencido: 'Vencido',
};

/**
 * Estado de cuenta, visible para el administrador del comercio.
 *
 * SOLO LECTURA. Cambiarlo es de NovuChat, por Cloud Function y con auditoría.
 * Si el comercio pudiera escribirlo se pondría "al día" y el estado de cuenta
 * dejaría de significar nada.
 *
 * Se lee con `tenantLegible`, así que **un comercio suspendido sigue viendo esta
 * pantalla**. Es deliberado y es la coherencia con la suspensión: si el comercio
 * conserva la vista de sus datos, tiene que ver también por qué se le cortó el
 * servicio. Un corte sin explicación visible es una llamada de reclamo
 * garantizada.
 *
 * `motivoVisible` es para EL COMERCIO. El cliente final de WhatsApp recibe un
 * mensaje de cortesía neutro que nunca menciona pagos (ver SEGURIDAD.md, T-18).
 */
export function EstadoCuenta() {
  const { tenantId = '' } = useParams();
  const [cuenta, setCuenta] = useState<Cuenta | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(doc(db, 'tenants', tenantId, 'cuenta', 'estado'),
      (d) => setCuenta(d.data() ?? {}),
      () => setError('No se pudo leer el estado de cuenta.'));
  }, [tenantId]);

  if (error) return <section><p role="alert">{error}</p></section>;
  if (!cuenta) return <section><p>Cargando…</p></section>;

  const situacion = ETIQUETA[String(cuenta.estadoPago)] ?? 'Sin información';
  const alDia = cuenta.estadoPago === 'al_dia';

  return (
    <section>
      <h2>Estado de cuenta</h2>

      <p className={alDia ? 'situacion ok' : 'situacion alerta'}>
        <strong>{situacion}</strong>
      </p>

      <table>
        <tbody>
          <tr>
            <th>Plan</th>
            <td><TextoSeguro valor={cuenta.plan} maxLargo={40} /></td>
          </tr>
          <tr>
            <th>Mensualidad</th>
            <td>
              {typeof cuenta.montoMensual === 'number' ? cuenta.montoMensual : '—'}{' '}
              <TextoSeguro valor={cuenta.moneda} maxLargo={3} />
            </td>
          </tr>
          <tr>
            <th>Próximo vencimiento</th>
            <td>
              {cuenta.proximoVencimiento?.toDate
                ? cuenta.proximoVencimiento.toDate().toLocaleDateString('es-BO')
                : '—'}
            </td>
          </tr>
        </tbody>
      </table>

      {typeof cuenta.motivoVisible === 'string' && cuenta.motivoVisible.length > 0 && (
        <p className="ayuda" role="status">
          <TextoSeguro valor={cuenta.motivoVisible} maxLargo={300} />
        </p>
      )}

      <p className="ayuda">
        Para consultas sobre su facturación, use la pantalla de Reclamos con la
        categoría <em>Facturación</em>.
      </p>
    </section>
  );
}
