import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { Link, useParams } from 'react-router-dom';
import { db } from '../lib/firebase';
import { TextoSeguro } from '../componentes/TextoSeguro';
import { etiquetaDePago, pagoAlDia } from '../lib/cuenta';
import { RESPUESTAS_POR_CONVERSACION, umbralesDeAtencion } from '../lib/atencion';
import { avisoConsumoVigente, limiteDeProductos, periodoDe } from '../lib/planes';
import { AvisoConsumo } from '../componentes/AvisoConsumo';
import { consumidasDe, corteDe, estadoDeServicio } from '../lib/prepago';
import { ResumenPrepago } from '../componentes/ResumenPrepago';
import { EjesDeLaCuenta } from '../central/componentes/EjesDeLaCuenta';
import { useRutasDelComercio, useTipoCambio } from '../central/lib/lecturas';
import { useSesion } from '../lib/contexto';

interface Cuenta {
  plan?: unknown;
  estadoPago?: unknown;
  montoMensual?: unknown;
  moneda?: unknown;
  proximoVencimiento?: { toDate(): Date };
  motivoVisible?: unknown;
  /** Umbrales de atención propios del comercio. Ausentes = rigen los de respaldo. */
  umbralOperador?: unknown;
  umbralBloqueo?: unknown;
}

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
  const [consumidas, setConsumidas] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // LOS TRES EJES POR SEPARADO (`Analisis/41` §4): la titularidad es de cada
  // número y el importe en bolivianos, del tipo de cambio del día.
  // Los números solo los puede listar el propietario (regla de hoy): el
  // administrador no intenta la lectura y ve «sin información».
  const { permisos } = useSesion();
  const rutas = useRutasDelComercio(tenantId, permisos.propietario);
  const tipoCambio = useTipoCambio();

  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(doc(db, 'tenants', tenantId, 'cuenta', 'estado'),
      (d) => setCuenta(d.data() ?? {}),
      () => setError('No se pudo leer el estado de cuenta.'));
  }, [tenantId]);

  // LAS CONVERSACIONES DEL MES, del MISMO agregado que lee la ingesta
  // (`metricas/{periodoDe()}`, mes UTC) y con la misma funcion (`consumidasDe`,
  // que tolera el nombre viejo `atenciones`). Si falla la lectura queda en 0:
  // el saldo se vera mas alto de lo que es, y eso no corta a nadie ni le
  // cobra de mas. Lo contrario --suponer consumo-- si diria que no le queda
  // servicio a quien si lo tiene.
  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(doc(db, 'tenants', tenantId, 'metricas', periodoDe()),
      (d) => setConsumidas(consumidasDe(d.data())),
      () => setConsumidas(0));
  }, [tenantId]);

  if (error) return <section><p role="alert">{error}</p></section>;
  if (!cuenta) return <section><p>Cargando…</p></section>;

  const situacion = etiquetaDePago(cuenta.estadoPago);
  const alDia = pagoAlDia(cuenta.estadoPago);
  // Los mismos que aplica el servidor, con la misma función: si el documento
  // trae una pareja incoherente, acá también se ven los de respaldo.
  const umbrales = umbralesDeAtencion(cuenta as Record<string, unknown>);
  const aviso = avisoConsumoVigente(cuenta as Record<string, unknown>);
  // El MISMO modulo que decide el corte en el servidor. La consola no calcula
  // cobertura ni gracia: si lo hiciera, la pantalla podria decir «cubierto» el
  // dia en que la ingesta corta, y sobre esa diferencia se discute un reclamo.
  const servicio = estadoDeServicio(cuenta as Record<string, unknown>, consumidas, Date.now());
  const corte = corteDe(cuenta as Record<string, unknown>);

  return (
    <section>
      <h2>Estado de cuenta</h2>

      <p className={alDia ? 'situacion ok' : 'situacion alerta'}>
        <strong>{situacion}</strong>
      </p>

      {aviso && <AvisoConsumo aviso={aviso} />}

      <h3>Su cuenta</h3>
      <EjesDeLaCuenta cuenta={cuenta as Record<string, unknown>} rutas={rutas ?? null}
        tipoCambio={tipoCambio} ahoraMs={Date.now()} />

      {/* Una demostración no paga nada: mostrarle «su producción» a un demo
          es confundir al que hace la presentación. Se pregunta por la
          MODALIDAD que decidió el servidor, nunca por el plan. */}
      {servicio.modalidad !== 'demostracion' && (
        <>
          <ResumenPrepago servicio={servicio} corte={corte} />
          <p>
            <Link className="btn btn-primary" to={`/negocio/${encodeURIComponent(tenantId)}/pagar`}>
              Pagar
            </Link>
          </p>
        </>
      )}

      <table>
        <tbody>
          {/* El plan con su precio ya está arriba, en los ejes: acá queda lo
              que el plan incluye y lo que se deriva de los pagos. */}
          <tr>
            <th>Productos del catálogo</th>
            <td>Hasta {limiteDeProductos(cuenta as Record<string, unknown>)}</td>
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
          {/* Los límites que rigen para ESTE comercio, en las mismas palabras
              que la página de precios. Se muestran siempre, sean propios o de
              respaldo: un comercio tiene que poder saber a cuántas respuestas
              su cliente pasa a una persona sin llamar a nadie. */}
          <tr>
            <th>Límites de atención</th>
            <td>
              Una conversación son hasta {RESPUESTAS_POR_CONVERSACION} respuestas del
              asistente a un mismo cliente en 24 horas. A las {umbrales.operador} respuestas
              en el día la conversación pasa a una persona de su equipo; a las{' '}
              {umbrales.bloqueo} el asistente deja de responder a ese cliente hasta el día
              siguiente.
              {umbrales.origen === 'cuenta' && ' Estos límites son propios de su cuenta.'}
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

