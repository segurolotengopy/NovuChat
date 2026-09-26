import { useState } from 'react';
import { Confirmacion } from './Confirmacion';
import { fechaCorta } from '../../lib/prepago';

/**
 * LA COMPUERTA DEL CORTE (`DISENO.md` §4undecies.4): global en
 * `plataforma/prepago.corteActivo`, o de UN comercio en
 * `cuenta/estado.corteActivo`. Apagada, el servidor calcula los cortes, los
 * anota con `aplicado: false` y atiende igual (modo observación); encendida,
 * `configuracionFlujo` responde 409 y el asistente deja de atender al
 * comercio que no tiene el mes cubierto.
 *
 * ES UNA DECISIÓN, NO UNA OPERACIÓN: por eso pide un motivo (el servidor lo
 * exige, al menos 10 caracteres, y lo guarda con quién y cuándo en
 * `plataforma/prepago/historial`), muestra lo que va a pasar y confirma.
 * En la consola la modalidad se llama «producción»; el corte solo alcanza a
 * los comercios en producción: una demostración no se corta nunca.
 *
 * Componente puro: `onFijar` lo conecta la página con `fijarCortePrepago`.
 */
export function CortePrepago({ plataforma, alcance, ocupado, onFijar }: {
  /** `plataforma/prepago` (global) o `cuenta/estado` (de un comercio); `undefined` mientras carga. */
  plataforma: Record<string, unknown> | null | undefined;
  alcance: 'global' | 'comercio';
  ocupado: boolean;
  onFijar: (corteActivo: boolean, motivo: string) => void;
}) {
  const activo = plataforma?.['corteActivo'] === true;
  const [motivo, setMotivo] = useState('');
  const [pendiente, setPendiente] = useState(false);
  const desde = plataforma?.['actualizadoEn'] as { toMillis?: () => number } | undefined;
  const desdeMs = typeof desde?.toMillis === 'function' ? desde.toMillis() : null;
  const quien = alcance === 'global' ? 'todos los comercios en producción' : 'este comercio';

  return (
    <div className={`aviso-datos corte-prepago ${activo ? 'corte-activo' : ''}`} role="status">
      {plataforma === undefined && <p>Leyendo el estado del corte…</p>}
      {plataforma !== undefined && (
        <p>
          {activo
            ? <><strong>Corte activo</strong> para {quien}{alcance === 'global' && desdeMs !== null && <> desde el {fechaCorta(desdeMs)}</>}: un
                mes sin cubrir deja al asistente sin responder.</>
            : <><strong>Corte en modo observación</strong> para {quien}: los cortes se calculan y
                se anotan, pero no se aplican. El asistente atiende igual.</>}
        </p>
      )}
      <label htmlFor={`corte-motivo-${alcance}`}>Motivo (queda en el historial, con quién y cuándo)</label>
      <input id={`corte-motivo-${alcance}`} type="text" maxLength={300} value={motivo} disabled={ocupado || pendiente}
        onChange={(e) => setMotivo(e.target.value)} placeholder="al menos 10 caracteres" />
      {pendiente
        ? <Confirmacion ocupado={ocupado}
            resumen={activo ? `Apagar el corte para ${quien}` : `Encender el corte para ${quien}`}
            advertencia={activo
              ? 'Vuelve el modo observación: nadie se queda sin atender por falta de pago.'
              : 'Desde el próximo mensaje, un comercio en producción con el mes sin cubrir recibe 409 y su cliente, un mensaje de cortesía.'}
            onConfirmar={() => { onFijar(!activo, motivo.trim()); setPendiente(false); setMotivo(''); }}
            onCancelar={() => setPendiente(false)} />
        : <button type="button" className={activo ? 'btn btn-secondary btn-chico' : 'btn btn-peligro btn-chico'}
            disabled={ocupado || plataforma === undefined || motivo.trim().length < 10} onClick={() => setPendiente(true)}>
            {activo ? 'Apagar el corte' : 'Encender el corte'}
          </button>}
    </div>
  );
}
