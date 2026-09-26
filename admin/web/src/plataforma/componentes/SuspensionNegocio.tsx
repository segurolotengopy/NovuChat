import { useState } from 'react';
import { Confirmacion } from './Confirmacion';
import { TextoSeguro } from '../../componentes/TextoSeguro';

const MOTIVO_VISIBLE_POR_DEFECTO = 'Servicio suspendido. Comuníquese con NovuChat para regularizar su cuenta.';

/**
 * SUSPENDER Y REACTIVAR, con la fricción que cada una merece (`Analisis/29`
 * §4.2): suspender pide el motivo (interno, para la auditoría) y muestra el
 * texto que va a leer el comercio en su estado de cuenta; reactivar es la
 * acción que no puede esperar y se confirma con un clic.
 *
 * LO QUE NO HACE NINGUNA DE LAS DOS: afirmar nada sobre el pago. Suspender
 * corta el SERVICIO; `estadoPago` se deriva de los pagos (`DISENO.md`
 * §4undecies.2). Y el cliente final de WhatsApp recibe un mensaje neutro que
 * nunca menciona deudas (SEGURIDAD.md, T-18): el motivo queda entre NovuChat y
 * el comercio.
 *
 * Componente puro: los `on…` los conecta la página con las callables.
 */
export function SuspensionNegocio({ ficha, ocupado, onSuspender, onReactivar }: {
  ficha: Record<string, unknown> | null | undefined;
  ocupado: boolean;
  onSuspender: (motivo: string, motivoVisible: string) => void;
  onReactivar: () => void;
}) {
  const estado = ficha?.['estado'];
  const [motivo, setMotivo] = useState('');
  const [motivoVisible, setMotivoVisible] = useState(MOTIVO_VISIBLE_POR_DEFECTO);
  const [pendiente, setPendiente] = useState<'suspender' | 'reactivar' | null>(null);

  if (estado === 'dado_de_baja') {
    return (
      <section>
        <h3>Servicio</h3>
        <p className="situacion alerta">Dado de baja. No se reactiva desde acá: es un alta nueva.</p>
      </section>
    );
  }

  if (estado === 'suspendido') {
    return (
      <section>
        <h3>Servicio</h3>
        <p className="situacion alerta">
          <strong>Suspendido.</strong>
          {typeof ficha?.['motivoSuspension'] === 'string' && (
            <> Motivo interno: <TextoSeguro valor={ficha['motivoSuspension']} maxLargo={300} /></>
          )}
        </p>
        {pendiente === 'reactivar'
          ? <Confirmacion resumen="Reactivar el servicio ahora" ocupado={ocupado}
              advertencia="El asistente vuelve a responder de inmediato. No afirma nada sobre el pago."
              onConfirmar={() => { onReactivar(); setPendiente(null); }}
              onCancelar={() => setPendiente(null)} />
          : <button type="button" className="btn btn-primary" disabled={ocupado}
              onClick={() => setPendiente('reactivar')}>Reactivar</button>}
      </section>
    );
  }

  const listo = motivo.trim().length >= 3 && motivoVisible.trim().length > 0;
  return (
    <section>
      <h3>Servicio</h3>
      <p className="situacion ok"><strong>Activo.</strong></p>
      <label htmlFor="suspension-motivo">Motivo (interno, queda en la auditoría)</label>
      <input id="suspension-motivo" type="text" maxLength={300} value={motivo} disabled={ocupado || pendiente !== null}
        onChange={(e) => setMotivo(e.target.value)} placeholder="Por ejemplo: dos meses sin pago" />
      <label htmlFor="suspension-visible">Lo que va a leer el comercio en su estado de cuenta</label>
      <textarea id="suspension-visible" maxLength={300} rows={2} value={motivoVisible} disabled={ocupado || pendiente !== null}
        onChange={(e) => setMotivoVisible(e.target.value)} />
      <p className="ayuda">
        El cliente final que escriba al WhatsApp recibe un mensaje de cortesía neutro, sin
        mención a pagos. Este texto lo ve solo el comercio.
      </p>
      {pendiente === 'suspender'
        ? <Confirmacion resumen="Suspender el servicio de este comercio" ocupado={ocupado}
            advertencia="El asistente deja de responder de inmediato y el comercio sigue viendo sus datos."
            onConfirmar={() => { onSuspender(motivo.trim(), motivoVisible.trim()); setPendiente(null); }}
            onCancelar={() => setPendiente(null)} />
        : <button type="button" className="btn btn-peligro" disabled={ocupado || !listo}
            onClick={() => setPendiente('suspender')}>Suspender</button>}
    </section>
  );
}
