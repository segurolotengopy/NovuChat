import { useState } from 'react';
import { Confirmacion } from './Confirmacion';
import { TextoSeguro } from '../../componentes/TextoSeguro';
import { ContadorCambios } from '../../central/componentes/ContadorCambios';
import {
  DESCRIPCION_MODALIDAD, DESCRIPCION_TITULARIDAD, ETIQUETA_MODALIDAD, ETIQUETA_MODELO, ETIQUETA_TITULARIDAD,
  MODALIDADES, MODELOS, TITULARIDADES, cambiosDelMes, modalidadDe, modeloDe, titularidadDe,
  type Modalidad, type Modelo, type RutaWhatsApp, type Titularidad,
} from '../../lib/ejes';
import { PLANES, esPlanVendible, nombreDePlan, type IdPlanVendible } from '../../lib/planes';
import { importeBs, tipoCambioVigente } from '../../lib/prepago';
import { UMBRALES_ATENCION, UMBRAL_MAXIMO, umbralesDeAtencion } from '../../lib/atencion';
import { resumenDeCambio } from '../lib/negocios';

/**
 * LOS TRES EJES DE LA CUENTA, EL MODELO Y LOS UMBRALES, COMO LOS ASIGNA
 * NOVUCHAT (`Analisis/41` §4, consecuencia 3: Negocios es el ÚNICO lugar donde
 * se asignan; Cuenta y Pagar solo los muestran).
 *
 * CADA EJE ES UNA DECISIÓN SEPARADA, con su confirmación. Antes cambiar el
 * plan a «demostracion» cambiaba la modalidad, y asignar BYOC cambiaba quién
 * paga Meta: acá el plan es el plan, la modalidad es la modalidad y la
 * titularidad es de cada número. El modelo es una decisión de NovuChat por
 * tenant (`tenants/{t}.modelo`), y va acá porque cambiarlo en un comercio con
 * número propio sin rehacer la cuenta lo pone a perder plata (`Analisis/39`).
 *
 * NO ESCRIBE NADA: cada confirmación llama al `on…` que la página conecta con
 * la callable, y el error del servidor lo muestra la página tal cual. Este
 * componente es puro y se dibuja en una prueba con `renderToStaticMarkup`.
 */
export interface PanelEjesProps {
  ficha: Record<string, unknown> | null | undefined;
  cuenta: Record<string, unknown> | null | undefined;
  rutas: readonly RutaWhatsApp[] | null;
  tipoCambio: unknown;
  ahoraMs: number;
  ocupado: boolean;
  onPlan: (plan: IdPlanVendible) => void;
  onModalidad: (modalidad: Modalidad) => void;
  onTitularidad: (phoneNumberId: string, titularidad: Titularidad) => void;
  onModelo: (modelo: Modelo) => void;
  /** `null` borra los propios y vuelven a regir los de respaldo. */
  onUmbrales: (umbrales: { operador: number; bloqueo: number } | null) => void;
}

const PLANES_VENDIBLES = Object.keys(PLANES) as IdPlanVendible[];

export function PanelEjes(p: PanelEjesProps) {
  const cambios = cambiosDelMes(p.cuenta, p.ahoraMs);
  return (
    <section className="ejes-panel">
      <h3>Los ejes de la cuenta</h3>
      <p className="ayuda">
        Plan, modalidad y titularidad son tres decisiones independientes. Cada una se
        confirma por separado y la escribe el servidor, que puede rechazarla.
      </p>
      <table>
        <tbody>
          <SeccionPlan {...p} />
          <SeccionModalidad {...p} />
          <SeccionTitularidad {...p} />
          <SeccionModelo {...p} />
          <SeccionUmbrales {...p} />
          <tr>
            <th>Cambios incluidos</th>
            <td>
              <ContadorCambios cambios={cambios} />
              <p className="ayuda">
                Los cambios de configuración que NovuChat opera por el comercio se registran
                con <code>registrarCambioOperado</code> al hacerlos; acá se ven contra los
                que incluye su plan.
              </p>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function SeccionPlan(p: PanelEjesProps) {
  const actual = p.cuenta?.['plan'];
  const [elegido, setElegido] = useState<IdPlanVendible>(esPlanVendible(actual) ? actual : PLANES_VENDIBLES[0]!);
  const [pendiente, setPendiente] = useState(false);
  const tc = tipoCambioVigente(p.tipoCambio, p.ahoraMs);
  const nombre = nombreDePlan(actual);
  const resumen = resumenDeCambio('Plan', nombre ?? String(actual ?? '—'), PLANES[elegido].nombre);
  return (
    <tr>
      <th>Plan</th>
      <td>
        <p>
          <strong>{nombre ?? <TextoSeguro valor={actual} maxLargo={40} />}</strong>
          {esPlanVendible(actual) && <> · USD {PLANES[actual].precioUsd} al mes
            {tc && <span className="text-muted"> · Bs {importeBs(PLANES[actual].precioUsd, tc.tco)} al {tc.tco} del {tc.fecha}</span>}</>}
        </p>
        <label htmlFor="eje-plan">Cambiar a</label>{' '}
        <select id="eje-plan" value={elegido} disabled={p.ocupado || pendiente}
          onChange={(e) => setElegido(e.target.value as IdPlanVendible)}>
          {PLANES_VENDIBLES.map((id) => (
            <option key={id} value={id}>
              {PLANES[id].nombre} · USD {PLANES[id].precioUsd} · {PLANES[id].conversaciones} conversaciones
              {tc ? ` · Bs ${importeBs(PLANES[id].precioUsd, tc.tco)}` : ''}
            </option>
          ))}
        </select>{' '}
        {pendiente && resumen
          ? <Confirmacion resumen={resumen} ocupado={p.ocupado}
              advertencia="Cambia la copia de límites de la cuenta y la mensualidad derivada; no cambia la modalidad."
              onConfirmar={() => { p.onPlan(elegido); setPendiente(false); }}
              onCancelar={() => setPendiente(false)} />
          : <button type="button" className="btn btn-secondary btn-chico" disabled={p.ocupado || resumen === null}
              onClick={() => setPendiente(true)}>Cambiar el plan</button>}
        <p className="ayuda">
          El plan interno de demostración ya no se asigna: una demostración es una
          modalidad, con cualquier plan.
        </p>
      </td>
    </tr>
  );
}

function SeccionModalidad(p: PanelEjesProps) {
  const actual = modalidadDe(p.cuenta);
  const [elegida, setElegida] = useState<Modalidad>(actual);
  const [pendiente, setPendiente] = useState(false);
  const resumen = resumenDeCambio('Modalidad', ETIQUETA_MODALIDAD[actual], ETIQUETA_MODALIDAD[elegida]);
  return (
    <tr>
      <th>Modalidad</th>
      <td>
        <p><strong>{ETIQUETA_MODALIDAD[actual]}</strong> <span className="text-muted">· {DESCRIPCION_MODALIDAD[actual]}</span></p>
        <label htmlFor="eje-modalidad">Cambiar a</label>{' '}
        <select id="eje-modalidad" value={elegida} disabled={p.ocupado || pendiente}
          onChange={(e) => setElegida(e.target.value as Modalidad)}>
          {MODALIDADES.map((m) => <option key={m} value={m}>{ETIQUETA_MODALIDAD[m]}</option>)}
        </select>{' '}
        {pendiente && resumen
          ? <Confirmacion resumen={resumen} ocupado={p.ocupado}
              advertencia={elegida === 'prepago'
                ? 'En producción el servicio se corta si el mes no está cubierto (cuando el corte esté encendido).'
                : DESCRIPCION_MODALIDAD[elegida]}
              onConfirmar={() => { p.onModalidad(elegida); setPendiente(false); }}
              onCancelar={() => setPendiente(false)} />
          : <button type="button" className="btn btn-secondary btn-chico" disabled={p.ocupado || resumen === null}
              onClick={() => setPendiente(true)}>Cambiar la modalidad</button>}
      </td>
    </tr>
  );
}

function SeccionTitularidad(p: PanelEjesProps) {
  return (
    <tr>
      <th>Titularidad</th>
      <td>
        {p.rutas === null && <p className="text-muted">No se pudieron leer los números de este comercio.</p>}
        {p.rutas !== null && p.rutas.length === 0 && (
          <p className="text-muted">Sin número asignado. Se asigna con <code>asignar-numero.mjs</code>: incluye un secreto y no pasa por la consola.</p>
        )}
        {p.rutas !== null && p.rutas.map((r) => (
          <FilaTitularidad key={r.phoneNumberId} ruta={r} ocupado={p.ocupado} onTitularidad={p.onTitularidad} />
        ))}
        <p className="ayuda">
          Es por número, no por plan: la franquicia de 1.000 mensajes de Meta es por
          número, y un comercio puede tener uno propio y otro provisto.
        </p>
      </td>
    </tr>
  );
}

function FilaTitularidad({ ruta, ocupado, onTitularidad }: {
  ruta: RutaWhatsApp; ocupado: boolean; onTitularidad: PanelEjesProps['onTitularidad'];
}) {
  const actual = titularidadDe(ruta);
  const [elegida, setElegida] = useState<Titularidad>(actual);
  const [pendiente, setPendiente] = useState(false);
  const resumen = resumenDeCambio('Titularidad', ETIQUETA_TITULARIDAD[actual], ETIQUETA_TITULARIDAD[elegida]);
  const id = `eje-titularidad-${ruta.phoneNumberId}`;
  return (
    <p className="fila-titularidad">
      <strong>{ETIQUETA_TITULARIDAD[actual]}</strong>
      {typeof ruta.flujo === 'string' && <span className="text-muted"> · flujo <TextoSeguro valor={ruta.flujo} maxLargo={30} /></span>}
      <span className="text-muted"> · número <TextoSeguro valor={ruta.phoneNumberId} maxLargo={25} /></span>
      <br />
      <label htmlFor={id}>Cambiar a</label>{' '}
      <select id={id} value={elegida} disabled={ocupado || pendiente}
        onChange={(e) => setElegida(e.target.value as Titularidad)}>
        {TITULARIDADES.map((t) => <option key={t} value={t}>{ETIQUETA_TITULARIDAD[t]}</option>)}
      </select>{' '}
      {pendiente && resumen
        ? <Confirmacion resumen={resumen} ocupado={ocupado} advertencia={DESCRIPCION_TITULARIDAD[elegida]}
            onConfirmar={() => { onTitularidad(ruta.phoneNumberId, elegida); setPendiente(false); }}
            onCancelar={() => setPendiente(false)} />
        : <button type="button" className="btn btn-secondary btn-chico" disabled={ocupado || resumen === null}
            onClick={() => setPendiente(true)}>Cambiar la titularidad</button>}
    </p>
  );
}

function SeccionModelo(p: PanelEjesProps) {
  const actual = modeloDe(p.ficha);
  const [elegido, setElegido] = useState<Modelo>(actual);
  const [pendiente, setPendiente] = useState(false);
  const resumen = resumenDeCambio('Modelo', ETIQUETA_MODELO[actual], ETIQUETA_MODELO[elegido]);
  return (
    <tr>
      <th>Modelo de IA</th>
      <td>
        <p><strong>{ETIQUETA_MODELO[actual]}</strong></p>
        <label htmlFor="eje-modelo">Cambiar a</label>{' '}
        <select id="eje-modelo" value={elegido} disabled={p.ocupado || pendiente}
          onChange={(e) => setElegido(e.target.value as Modelo)}>
          {MODELOS.map((m) => <option key={m} value={m}>{ETIQUETA_MODELO[m]}</option>)}
        </select>{' '}
        {pendiente && resumen
          ? <Confirmacion resumen={resumen} ocupado={p.ocupado}
              advertencia="Con número propio del comercio, el tope de conversaciones se fijó contra Gemini: cambiar el modelo sin rehacer esa cuenta lo pone a perder plata."
              onConfirmar={() => { p.onModelo(elegido); setPendiente(false); }}
              onCancelar={() => setPendiente(false)} />
          : <button type="button" className="btn btn-secondary btn-chico" disabled={p.ocupado || resumen === null}
              onClick={() => setPendiente(true)}>Cambiar el modelo</button>}
        <p className="ayuda">Lo decide NovuChat por comercio; el flujo lo recibe en el contexto de turno.</p>
      </td>
    </tr>
  );
}

function SeccionUmbrales(p: PanelEjesProps) {
  const actual = umbralesDeAtencion(p.cuenta ?? undefined);
  const [operador, setOperador] = useState(String(actual.operador));
  const [bloqueo, setBloqueo] = useState(String(actual.bloqueo));
  const [pendiente, setPendiente] = useState<'fijar' | 'restaurar' | null>(null);
  const op = Number(operador); const bl = Number(bloqueo);
  const coherentes = Number.isInteger(op) && Number.isInteger(bl) && op >= 1 && bl > op && bl <= UMBRAL_MAXIMO;
  const cambia = coherentes && (op !== actual.operador || bl !== actual.bloqueo);
  return (
    <tr>
      <th>Umbrales de atención</th>
      <td>
        <p>
          A las <strong>{actual.operador}</strong> respuestas en 24 h pasa a una persona; a las{' '}
          <strong>{actual.bloqueo}</strong> deja de responder.
          {actual.origen === 'cuenta'
            ? <span className="text-muted"> · propios de esta cuenta</span>
            : <span className="text-muted"> · los de respaldo ({UMBRALES_ATENCION.operador} / {UMBRALES_ATENCION.bloqueo})</span>}
        </p>
        <label htmlFor="eje-operador">Operador</label>{' '}
        <input id="eje-operador" type="number" min={1} max={UMBRAL_MAXIMO} value={operador} disabled={p.ocupado || pendiente !== null}
          onChange={(e) => setOperador(e.target.value)} style={{ width: '6em' }} />{' '}
        <label htmlFor="eje-bloqueo">Bloqueo</label>{' '}
        <input id="eje-bloqueo" type="number" min={2} max={UMBRAL_MAXIMO} value={bloqueo} disabled={p.ocupado || pendiente !== null}
          onChange={(e) => setBloqueo(e.target.value)} style={{ width: '6em' }} />{' '}
        {pendiente === 'fijar' && (
          <Confirmacion resumen={`Umbrales: ${actual.operador} / ${actual.bloqueo} → ${op} / ${bl}`} ocupado={p.ocupado}
            advertencia="Rige para TODOS los teléfonos del comercio desde el próximo mensaje."
            onConfirmar={() => { p.onUmbrales({ operador: op, bloqueo: bl }); setPendiente(null); }}
            onCancelar={() => setPendiente(null)} />
        )}
        {pendiente === 'restaurar' && (
          <Confirmacion resumen={`Umbrales: volver a los de respaldo (${UMBRALES_ATENCION.operador} / ${UMBRALES_ATENCION.bloqueo})`}
            ocupado={p.ocupado}
            onConfirmar={() => { p.onUmbrales(null); setPendiente(null); }}
            onCancelar={() => setPendiente(null)} />
        )}
        {pendiente === null && (
          <>
            <button type="button" className="btn btn-secondary btn-chico" disabled={p.ocupado || !cambia}
              onClick={() => setPendiente('fijar')}>Fijar los umbrales</button>{' '}
            <button type="button" className="btn btn-ghost btn-chico" disabled={p.ocupado || actual.origen !== 'cuenta'}
              onClick={() => setPendiente('restaurar')}>Volver a los de respaldo</button>
          </>
        )}
        {!coherentes && <p className="field-error">El bloqueo tiene que ser mayor que el operador, y los dos enteros entre 1 y {UMBRAL_MAXIMO}.</p>}
      </td>
    </tr>
  );
}
