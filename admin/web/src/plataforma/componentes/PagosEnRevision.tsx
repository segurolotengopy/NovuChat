import { useState } from 'react';
import { Confirmacion } from './Confirmacion';
import { TextoSeguro } from '../../componentes/TextoSeguro';
import { MOTIVO_CONFIRMACION_MAXIMO, motivoDeConfirmacionValido, type PagoEnRevision } from '../lib/negocios';

/**
 * LOS PAGOS QUE EL BANCO CONFIRMÓ Y NOVUCHAT NO APLICÓ SOLO (revisión de
 * seguridad de #212, tercera vuelta, LOW 1). Un QR de otro plan sin firma, o
 * uno por el que entró menos de lo que dice: la plata está, el comercio
 * espera, y hasta que el propietario lo confirme la cuenta no suma el mes y
 * puede quedar cortada. Acá se ven y se confirman con `confirmarPendiente`.
 *
 * LO QUE ESTA PANTALLA NO HACE: decidir. Pide lo recibido (precargado con lo
 * que informó el banco) y el motivo, que el servidor exige y deja en la
 * auditoría; muestra qué va a pasar con el plan; y recién con «Confirmar»
 * llama. Si el QR es de otro plan, confirmarlo CAMBIA el plan de la cuenta, y
 * la auditoría guarda la copia de límites antes y después.
 *
 * Componente puro: `onConfirmar` lo conecta la página con la callable (y con
 * el reintento de sesión reciente de `operar`).
 */
export function PagosEnRevision({ pagos, planVigente, ocupado, onConfirmar }: {
  pagos: readonly PagoEnRevision[];
  planVigente: unknown;
  ocupado: boolean;
  onConfirmar: (pagoId: string, montoRecibidoBs: number, motivoDiferencia: string) => void;
}) {
  if (pagos.length === 0) return null;
  return (
    <section>
      <h3>Pagos confirmados por el banco, sin registrar</h3>
      <p className="situacion alerta">
        El banco confirmó {pagos.length === 1 ? 'este pago' : 'estos pagos'} y NovuChat no {pagos.length === 1 ? 'lo' : 'los'} aplicó
        solo. Hasta confirmarlo acá, la cuenta no suma el mes y el comercio puede quedar cortado.
      </p>
      {pagos.map((p) => (
        <FilaEnRevision key={p.pagoId} pago={p} planVigente={planVigente} ocupado={ocupado} onConfirmar={onConfirmar} />
      ))}
    </section>
  );
}

function FilaEnRevision({ pago, planVigente, ocupado, onConfirmar }: {
  pago: PagoEnRevision;
  planVigente: unknown;
  ocupado: boolean;
  onConfirmar: (pagoId: string, montoRecibidoBs: number, motivoDiferencia: string) => void;
}) {
  const [recibido, setRecibido] = useState(pago.montoRecibidoBs !== null ? String(pago.montoRecibidoBs) : '');
  const [motivo, setMotivo] = useState('');
  const [preguntando, setPreguntando] = useState(false);
  const monto = Number(recibido);
  // Mayor que cero: el servidor rechaza confirmar 0 Bs (no entró nada que confirmar).
  const montoValido = /^[0-9]{1,7}$/.test(recibido.trim()) && Number.isInteger(monto) && monto > 0;
  const listo = montoValido && motivoDeConfirmacionValido(motivo);
  const idRecibido = `revision-recibido-${pago.pagoId}`;
  const idMotivo = `revision-motivo-${pago.pagoId}`;
  const cambiaElPlan = pago.motivo === 'plan_distinto' && pago.plan !== null && pago.plan !== planVigente;

  return (
    <div className="tarjeta">
      <p>
        <strong><TextoSeguro valor={pago.descripcion} maxLargo={80} /></strong>
        {' '}· QR por Bs {pago.monto ?? '—'}
        {pago.montoRecibidoBs !== null && <> · el banco informó Bs {pago.montoRecibidoBs}</>}
      </p>
      {pago.motivo === 'plan_distinto' && (
        <p className="ayuda">
          El QR es del plan <TextoSeguro valor={pago.plan} maxLargo={30} /> y la cuenta tiene
          {' '}<TextoSeguro valor={planVigente} maxLargo={30} />.
          {cambiaElPlan
            ? ' Confirmarlo cambia el plan de la cuenta al del QR; la auditoría guarda los límites antes y después.'
            : ' La cuenta ya tiene ese plan: confirmarlo solo suma el mes.'}
        </p>
      )}
      {pago.motivo === 'importe_menor' && (
        <p className="ayuda">Entró menos de lo que dice el QR: el motivo explica la diferencia.</p>
      )}
      <label htmlFor={idRecibido}>Lo que entró, en bolivianos</label>
      <input id={idRecibido} type="text" inputMode="numeric" value={recibido} disabled={ocupado || preguntando}
        onChange={(e) => setRecibido(e.target.value)} />
      <label htmlFor={idMotivo}>Motivo (obligatorio, queda en la auditoría)</label>
      <input id={idMotivo} type="text" maxLength={MOTIVO_CONFIRMACION_MAXIMO} value={motivo} disabled={ocupado || preguntando}
        onChange={(e) => setMotivo(e.target.value)} placeholder="Por ejemplo: el comercio pagó el QR emitido antes del cambio de plan" />
      {preguntando
        ? <Confirmacion
            resumen={`Registrar este pago con Bs ${montoValido ? monto : '—'} recibidos`}
            advertencia={cambiaElPlan ? 'Cambia el plan de la cuenta al del QR.' : 'Suma lo que el pago cubre.'}
            ocupado={ocupado}
            onConfirmar={() => { onConfirmar(pago.pagoId, monto, motivo.trim()); setPreguntando(false); }}
            onCancelar={() => setPreguntando(false)} />
        : <button type="button" className="btn btn-primary" disabled={ocupado || !listo}
            onClick={() => setPreguntando(true)}>Registrar el pago</button>}
    </div>
  );
}
