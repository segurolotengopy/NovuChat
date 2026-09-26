import { useState } from 'react';
import { Confirmacion } from './Confirmacion';
import { TextoSeguro } from '../../componentes/TextoSeguro';
import { ContadorCambios } from '../../central/componentes/ContadorCambios';
import {
  BOLSA_PRUEBA_MAXIMA, DESCRIPCION_MODALIDAD, DESCRIPCION_TITULARIDAD, ETIQUETA_MODALIDAD, ETIQUETA_MODELO,
  ETIQUETA_TITULARIDAD, LIMITE_MAXIMO, MAXIMO_PRECIO_POR_CONTRATO_USD, MODALIDADES, MODELOS, TITULARIDADES,
  bolsaPruebaValida, conversacionesValidas, mesEnCurso, modalidadDe, origenDeCambiosIncluidos, origenPorContrato,
  periodoPruebaAceptable, precioMensualDe, precioPorContratoDe, precioPorContratoValido, pruebaDeCuenta,
  type CambiosVista, type EjesDeCuenta, type Modalidad, type Modelo, type NumeroDeCuenta, type Titularidad,
} from '../../lib/ejes';
import { MAXIMO_CAMBIOS_INCLUIDOS, PLANES, esPlanVendible, nombreDePlan, type IdPlanVendible } from '../../lib/planes';
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
 * DE DÓNDE SALE CADA DATO. Plan, modalidad y umbrales, de `cuenta/estado` en
 * vivo (lo que escribe `actualizarEstadoCuenta`); titularidad por número,
 * modelo y cambios del mes, de `ejesDeCuenta` (lo que escribe `asignarEjes` y
 * cuenta `registrarCambioOperado`), que la página vuelve a pedir después de
 * cada cambio confirmado.
 *
 * NO ESCRIBE NADA: cada confirmación llama al `on…` que la página conecta con
 * la callable, y el error del servidor lo muestra la página tal cual. Este
 * componente es puro y se dibuja en una prueba con `renderToStaticMarkup`.
 */
export interface PanelEjesProps {
  cuenta: Record<string, unknown> | null | undefined;
  /** La respuesta de `ejesDeCuenta`; `undefined` cargando, `null` si falló. */
  ejes: EjesDeCuenta | null | undefined;
  tipoCambio: unknown;
  ahoraMs: number;
  ocupado: boolean;
  onPlan: (plan: IdPlanVendible) => void;
  onModalidad: (modalidad: Modalidad) => void;
  onTitularidad: (phoneNumberId: string, titularidad: Titularidad) => void;
  onModelo: (modelo: Modelo) => void;
  /** `null` borra los propios y vuelven a regir los de respaldo. */
  onUmbrales: (umbrales: { operador: number; bloqueo: number } | null) => void;
  /** Registra un cambio operado por NovuChat (`registrarCambioOperado`); `forzar` pasa el tope, con constancia. */
  onCambio: (descripcion: string, forzar: boolean) => void;
  /**
   * Fija POR CONTRATO los cambios incluidos al mes (`actualizarEstadoCuenta`
   * con `cambiosIncluidos`); `null` quita el contrato y vuelve a regir el del plan.
   */
  onCambiosIncluidos: (cambios: number | null) => void;
  /**
   * F1b. Fija POR CONTRATO las conversaciones incluidas al mes
   * (`actualizarEstadoCuenta` con `conversaciones`); `null` vuelve a las del plan.
   * Opcional para no romper una página que todavía no lo conecta: sin él, la
   * fila solo muestra.
   */
  onConversaciones?: (conversaciones: number | null) => void;
  /** F1b. Fija la mensualidad POR CONTRATO en USD (`precioPorContrato`); `null` vuelve a la del plan. */
  onPrecio?: (precioUsd: number | null) => void;
  /** F1b. Fija o extiende el último mes de la prueba y/o su bolsa (`periodoPrueba`, `bolsaPrueba`). */
  onPrueba?: (prueba: { periodoPrueba?: string; bolsaPrueba?: number }) => void;
}

const PLANES_VENDIBLES = Object.keys(PLANES) as IdPlanVendible[];

export function PanelEjes(p: PanelEjesProps) {
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
          {/* La clave lleva el precio por contrato: al confirmarse, la fila vuelve a nacer con el del servidor. */}
          <SeccionPrecio key={`precio:${precioPorContratoDe(p.cuenta) ?? 'plan'}:${String(p.cuenta?.['plan'] ?? '')}`} {...p} />
          <SeccionModalidad {...p} />
          <SeccionPrueba key={`prueba:${String(p.cuenta?.['periodoPrueba'] ?? '')}:${String(p.cuenta?.['bolsaPrueba'] ?? '')}`} {...p} />
          <SeccionTitularidad {...p} />
          {p.ejes ? <SeccionModelo {...p} modeloActual={p.ejes.modelo} /> : (
            <tr><th>Modelo de IA</th><td className="text-muted">{p.ejes === undefined ? 'Leyendo…' : 'No se pudo leer.'}</td></tr>
          )}
          <SeccionUmbrales {...p} />
          <tr>
            <th>Conversaciones incluidas</th>
            <td>
              {p.ejes
                ? <ConversacionesPorContrato key={`${p.ejes.limites.conversaciones}:${origenPorContrato(p.ejes, 'conversaciones') ?? '?'}`}
                    ejes={p.ejes} ocupado={p.ocupado} onConversaciones={p.onConversaciones} />
                : <span className="text-muted">{p.ejes === undefined ? 'Leyendo…' : 'No se pudo leer.'}</span>}
            </td>
          </tr>
          <tr>
            <th>Cambios incluidos</th>
            <td>
              {p.ejes ? <ContadorCambios cambios={p.ejes.cambios} />
                : <span className="text-muted">{p.ejes === undefined ? 'Leyendo…' : 'No se pudo leer.'}</span>}
              {p.ejes && (
                // La clave lleva el valor y el origen: al confirmarse un
                // cambio, el formulario vuelve a nacer con lo que dice el servidor.
                <CambiosPorContrato key={`${p.ejes.limites.cambiosIncluidos}:${origenDeCambiosIncluidos(p.ejes) ?? '?'}`}
                  ejes={p.ejes} ocupado={p.ocupado} onCambiosIncluidos={p.onCambiosIncluidos} />
              )}
              {p.ejes && <RegistrarCambio cambios={p.ejes.cambios} ocupado={p.ocupado} onCambio={p.onCambio} />}
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
            {/* Con precio por contrato, el del plan es solo la lista: la mensualidad es la de la fila «Precio». */}
            {precioPorContratoDe(p.cuenta) !== null && <span className="text-muted"> de lista</span>}
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
              advertencia="Cambia la copia de límites de la cuenta y la mensualidad derivada; no cambia la modalidad. Lo que va por contrato se conserva."
              onConfirmar={() => { p.onPlan(elegido); setPendiente(false); }}
              onCancelar={() => setPendiente(false)} />
          : <button type="button" className="btn btn-secondary btn-chico" disabled={p.ocupado || resumen === null}
              onClick={() => setPendiente(true)}>Cambiar el plan</button>}
        <p className="ayuda">
          Una demostración es una modalidad, con cualquier plan: no hay plan de
          demostración.
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
        {p.ejes === undefined && <p className="text-muted">Leyendo los números de este comercio…</p>}
        {p.ejes === null && <p className="text-muted">No se pudieron leer los números de este comercio.</p>}
        {p.ejes && p.ejes.numeros.length === 0 && (
          <p className="text-muted">Sin número asignado. Se asigna con <code>asignar-numero.mjs</code>: incluye un secreto y no pasa por la consola.</p>
        )}
        {p.ejes && p.ejes.numeros.map((n) => (
          // La clave lleva la titularidad: al confirmarse un cambio, la fila
          // vuelve a nacer con el valor nuevo elegido.
          <FilaTitularidad key={`${n.phoneNumberId}:${n.titularidad}`} numero={n} ocupado={p.ocupado} onTitularidad={p.onTitularidad} />
        ))}
        <p className="ayuda">
          Es por número, no por plan: la franquicia de 1.000 mensajes de Meta es por
          número, y un comercio puede tener uno propio y otro provisto.
        </p>
      </td>
    </tr>
  );
}

function FilaTitularidad({ numero, ocupado, onTitularidad }: {
  numero: NumeroDeCuenta; ocupado: boolean; onTitularidad: PanelEjesProps['onTitularidad'];
}) {
  const ruta = numero;
  const actual = numero.titularidad;
  const [elegida, setElegida] = useState<Titularidad>(actual);
  const [pendiente, setPendiente] = useState(false);
  const resumen = resumenDeCambio('Titularidad', ETIQUETA_TITULARIDAD[actual], ETIQUETA_TITULARIDAD[elegida]);
  const id = `eje-titularidad-${ruta.phoneNumberId}`;
  return (
    <p className="fila-titularidad">
      <strong>{ETIQUETA_TITULARIDAD[actual]}</strong>
      {ruta.flujo && <span className="text-muted"> · flujo <TextoSeguro valor={ruta.flujo} maxLargo={30} /></span>}
      <span className="text-muted"> · número <TextoSeguro valor={ruta.phoneNumberId} maxLargo={25} /></span>
      {!numero.titularidadExplicita && <span className="text-muted"> · sin asignar: rige la de respaldo</span>}
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

function SeccionModelo(p: PanelEjesProps & { modeloActual: Modelo }) {
  const actual = p.modeloActual;
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
              advertencia="El tope de BYOC se fijó contra Gemini: con Haiku el equilibrio cae a 1.542 conversaciones y con Sonnet a 771. No se cambia sin rehacer esa cuenta."
              onConfirmar={() => { p.onModelo(elegido); setPendiente(false); }}
              onCancelar={() => setPendiente(false)} />
          : <button type="button" className="btn btn-secondary btn-chico" disabled={p.ocupado || resumen === null}
              onClick={() => setPendiente(true)}>Cambiar el modelo</button>}
        <p className="ayuda">Lo decide NovuChat por comercio. En F1 el flujo todavía no lo consume: queda registrado contra qué modelo se fijó el plan.</p>
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

/**
 * LOS CAMBIOS INCLUIDOS, CON SU ORIGEN: los del plan o los del contrato.
 *
 * Un contrato a medida puede incluir más (o menos) cambios operados al mes que
 * el plan. Se fijan acá POR CONTRATO y un cambio de plan posterior los
 * CONSERVA: el servidor lo decide (`copiaDeLimites`, `planes.ts`) y esta
 * pantalla solo lo dice. Volver a los del plan es una acción explícita, con su
 * confirmación. El tope del campo es el mismo del servidor
 * (`MAXIMO_CAMBIOS_INCLUIDOS`), que igual valida y rechaza.
 */
function CambiosPorContrato({ ejes, ocupado, onCambiosIncluidos }: {
  ejes: EjesDeCuenta; ocupado: boolean; onCambiosIncluidos: PanelEjesProps['onCambiosIncluidos'];
}) {
  const actual = ejes.limites.cambiosIncluidos;
  const origen = origenDeCambiosIncluidos(ejes);
  const delPlan = ejes.limites.cambiosIncluidosDelPlan;
  const [valor, setValor] = useState(String(actual));
  const [pendiente, setPendiente] = useState<'fijar' | 'plan' | null>(null);
  const n = Number(valor);
  const valido = /^[0-9]+$/.test(valor.trim()) && Number.isInteger(n) && n >= 0 && n <= MAXIMO_CAMBIOS_INCLUIDOS;
  const cambia = valido && (n !== actual || origen !== 'contrato');
  return (
    <div className="cambios-por-contrato">
      <p>
        <strong>{actual}</strong> {actual === 1 ? 'cambio incluido' : 'cambios incluidos'} al mes
        {origen === 'contrato' && <span className="text-muted"> · por contrato{delPlan !== undefined && <> (el plan trae {delPlan})</>}</span>}
        {origen === 'plan' && <span className="text-muted"> · los del plan</span>}
      </p>
      <label htmlFor="eje-cambios-incluidos">Por contrato</label>{' '}
      <input id="eje-cambios-incluidos" type="number" min={0} max={MAXIMO_CAMBIOS_INCLUIDOS} value={valor}
        disabled={ocupado || pendiente !== null} onChange={(e) => setValor(e.target.value)} style={{ width: '6em' }} />{' '}
      {pendiente === 'fijar' && (
        <Confirmacion ocupado={ocupado}
          resumen={`Cambios incluidos: ${actual}${origen === 'contrato' ? ' por contrato' : ' del plan'} → ${n} por contrato`}
          advertencia="Queda por contrato: un cambio de plan posterior lo conserva. Queda en la auditoría del comercio."
          onConfirmar={() => { onCambiosIncluidos(n); setPendiente(null); }}
          onCancelar={() => setPendiente(null)} />
      )}
      {pendiente === 'plan' && (
        <Confirmacion ocupado={ocupado}
          resumen={`Cambios incluidos: ${actual} por contrato → los del plan${delPlan !== undefined ? ` (${delPlan})` : ''}`}
          advertencia="Se quita el contrato: desde ahora rigen los del plan, y siguen al plan si cambia."
          onConfirmar={() => { onCambiosIncluidos(null); setPendiente(null); }}
          onCancelar={() => setPendiente(null)} />
      )}
      {pendiente === null && (
        <>
          <button type="button" className="btn btn-secondary btn-chico" disabled={ocupado || !cambia}
            onClick={() => setPendiente('fijar')}>Fijar por contrato</button>{' '}
          <button type="button" className="btn btn-ghost btn-chico" disabled={ocupado || origen !== 'contrato'}
            onClick={() => setPendiente('plan')}>Volver a los del plan</button>
        </>
      )}
      {!valido && <p className="field-error">Un entero de 0 a {MAXIMO_CAMBIOS_INCLUIDOS}.</p>}
    </div>
  );
}

/**
 * LAS CONVERSACIONES INCLUIDAS, CON SU ORIGEN (F1b): las del plan o las del
 * contrato. Mismo patrón que los cambios incluidos: se fijan acá POR
 * CONTRATO, un cambio de plan posterior las CONSERVA (`copiaDeLimites`), y
 * volver a las del plan es explícito. El tope es el del servidor
 * (`LIMITE_MAXIMO`, `conversacionesValidas`). Como cambian lo que cuesta
 * atender al comercio, la confirmación lo recuerda: van con un precio decidido.
 * Los botones llevan su propio nombre para no confundirse con los de los
 * cambios incluidos.
 */
function ConversacionesPorContrato({ ejes, ocupado, onConversaciones }: {
  ejes: EjesDeCuenta; ocupado: boolean; onConversaciones: PanelEjesProps['onConversaciones'];
}) {
  const actual = ejes.limites.conversaciones;
  const origen = origenPorContrato(ejes, 'conversaciones');
  const delPlan = ejes.limites.conversacionesDelPlan;
  const [valor, setValor] = useState(String(actual));
  const [pendiente, setPendiente] = useState<'fijar' | 'plan' | null>(null);
  const n = Number(valor);
  const valido = /^[0-9]+$/.test(valor.trim()) && conversacionesValidas(n);
  const cambia = valido && (n !== actual || origen !== 'contrato');
  const sinAccion = !onConversaciones;
  return (
    <div className="conversaciones-por-contrato">
      <p>
        <strong>{actual}</strong> {actual === 1 ? 'conversación incluida' : 'conversaciones incluidas'} al mes
        {origen === 'contrato' && <span className="text-muted"> · por contrato{delPlan !== undefined && <> (el plan trae {delPlan})</>}</span>}
        {origen === 'plan' && <span className="text-muted"> · las del plan</span>}
      </p>
      <label htmlFor="eje-conversaciones">Por contrato</label>{' '}
      <input id="eje-conversaciones" type="number" min={1} max={LIMITE_MAXIMO} value={valor}
        disabled={ocupado || pendiente !== null || sinAccion} onChange={(e) => setValor(e.target.value)} style={{ width: '7em' }} />{' '}
      {pendiente === 'fijar' && onConversaciones && (
        <Confirmacion ocupado={ocupado}
          resumen={`Conversaciones incluidas: ${actual}${origen === 'contrato' ? ' por contrato' : ' del plan'} → ${n} por contrato`}
          advertencia="Cambia lo que cuesta atender a este comercio: va con un precio decidido. Un cambio de plan posterior lo conserva. Queda en la auditoría."
          onConfirmar={() => { onConversaciones(n); setPendiente(null); }}
          onCancelar={() => setPendiente(null)} />
      )}
      {pendiente === 'plan' && onConversaciones && (
        <Confirmacion ocupado={ocupado}
          resumen={`Conversaciones incluidas: ${actual} por contrato → las del plan${delPlan !== undefined ? ` (${delPlan})` : ''}`}
          advertencia="Se quita el contrato: desde ahora rigen las del plan, y siguen al plan si cambia."
          onConfirmar={() => { onConversaciones(null); setPendiente(null); }}
          onCancelar={() => setPendiente(null)} />
      )}
      {pendiente === null && (
        <>
          <button type="button" className="btn btn-secondary btn-chico" disabled={ocupado || !cambia || sinAccion}
            onClick={() => setPendiente('fijar')}>Fijar las conversaciones por contrato</button>{' '}
          <button type="button" className="btn btn-ghost btn-chico" disabled={ocupado || origen !== 'contrato' || sinAccion}
            onClick={() => setPendiente('plan')}>Volver a las del plan</button>
        </>
      )}
      {!valido && <p className="field-error">Un entero de 1 a {LIMITE_MAXIMO}.</p>}
    </div>
  );
}

/**
 * EL PRECIO, CON SU ORIGEN (F1b): la mensualidad del contrato o la del plan.
 * Se lee de la cuenta en vivo con `precioMensualDe` y `precioPorContratoDe`,
 * las mismas funciones con que el servidor emite el QR y deriva
 * `montoMensual`. El campo valida con `precioPorContratoValido` (más de 0,
 * hasta `MAXIMO_PRECIO_POR_CONTRATO_USD`, dos decimales como mucho), que es lo
 * mismo que rechaza el servidor. Un cambio de plan no toca el precio por
 * contrato; los meses ya pagados no se re-tarifan.
 */
function SeccionPrecio(p: PanelEjesProps) {
  const contrato = precioPorContratoDe(p.cuenta);
  const mensual = precioMensualDe(p.cuenta);
  const delPlan = precioMensualDe({ plan: p.cuenta?.['plan'] });
  const tc = tipoCambioVigente(p.tipoCambio, p.ahoraMs);
  const [valor, setValor] = useState(String(mensual));
  const [pendiente, setPendiente] = useState<'fijar' | 'plan' | null>(null);
  const n = Number(valor);
  const valido = /^[0-9]{1,4}(\.[0-9]{1,2})?$/.test(valor.trim()) && precioPorContratoValido(n);
  const cambia = valido && (n !== mensual || contrato === null);
  const sinAccion = !p.onPrecio;
  return (
    <tr>
      <th>Precio</th>
      <td>
        <p>
          <strong>USD {mensual}</strong> al mes
          {contrato !== null
            ? <span className="text-muted"> · por contrato (el plan cuesta USD {delPlan})</span>
            : <span className="text-muted"> · el del plan</span>}
          {tc && <span className="text-muted"> · Bs {importeBs(mensual, tc.tco)} al {tc.tco} del {tc.fecha}</span>}
        </p>
        <label htmlFor="eje-precio">USD al mes por contrato</label>{' '}
        <input id="eje-precio" type="number" min={0.01} step={0.01} max={MAXIMO_PRECIO_POR_CONTRATO_USD} value={valor}
          disabled={p.ocupado || pendiente !== null || sinAccion} onChange={(e) => setValor(e.target.value)} style={{ width: '7em' }} />{' '}
        {pendiente === 'fijar' && p.onPrecio && (
          <Confirmacion ocupado={p.ocupado}
            resumen={`Precio: USD ${mensual}${contrato !== null ? ' por contrato' : ' del plan'} → USD ${n} por contrato`}
            advertencia="Rige para los próximos cobros (QR, pago manual y recordatorios); los meses ya pagados no cambian. Un cambio de plan lo conserva. Si hay un cobro pendiente que quedaría fuera de contrato, el servidor lo rechaza."
            onConfirmar={() => { p.onPrecio?.(n); setPendiente(null); }}
            onCancelar={() => setPendiente(null)} />
        )}
        {pendiente === 'plan' && p.onPrecio && (
          <Confirmacion ocupado={p.ocupado}
            resumen={`Precio: USD ${mensual} por contrato → el del plan (USD ${delPlan})`}
            advertencia="Se quita el contrato: desde el próximo cobro rige el precio del plan, y sigue al plan si cambia."
            onConfirmar={() => { p.onPrecio?.(null); setPendiente(null); }}
            onCancelar={() => setPendiente(null)} />
        )}
        {pendiente === null && (
          <>
            <button type="button" className="btn btn-secondary btn-chico" disabled={p.ocupado || !cambia || sinAccion}
              onClick={() => setPendiente('fijar')}>Fijar el precio por contrato</button>{' '}
            <button type="button" className="btn btn-ghost btn-chico" disabled={p.ocupado || contrato === null || sinAccion}
              onClick={() => setPendiente('plan')}>Volver al precio del plan</button>
          </>
        )}
        {!valido && <p className="field-error">Un monto en dólares mayor que 0 y de hasta {MAXIMO_PRECIO_POR_CONTRATO_USD}, con dos decimales como mucho.</p>}
      </td>
    </tr>
  );
}

/**
 * LA PRUEBA POR CONTRATO (F1b): su último mes y su bolsa. Solo tiene sentido
 * en modalidad prueba —el servidor rechaza fijarla en otra (`pruebaNueva`)—,
 * así que fuera de ella la fila lo dice y no ofrece nada. Extender la prueba
 * cubre sin huecos desde su primer mes; la bolsa NO se reinicia sola: si hace
 * falta, se fija en el mismo paso. El mes no puede ser pasado (el campo nace
 * con el mínimo del mes en curso, y el servidor igual lo valida).
 */
function SeccionPrueba(p: PanelEjesProps) {
  const enPrueba = modalidadDe(p.cuenta) === 'prueba';
  const prueba = pruebaDeCuenta(p.cuenta);
  const minimo = mesEnCurso(p.ahoraMs);
  const [hasta, setHasta] = useState(prueba?.hasta ?? minimo);
  const [bolsa, setBolsa] = useState(prueba?.bolsa !== null && prueba?.bolsa !== undefined ? String(prueba.bolsa) : '');
  const [pendiente, setPendiente] = useState(false);
  const periodoOk = periodoPruebaAceptable(hasta, p.ahoraMs);
  const nBolsa = Number(bolsa);
  const bolsaOk = bolsa.trim() === '' || (/^[0-9]+$/.test(bolsa.trim()) && bolsaPruebaValida(nBolsa));
  const pedido: { periodoPrueba?: string; bolsaPrueba?: number } = {
    ...(periodoOk && hasta !== prueba?.hasta ? { periodoPrueba: hasta } : {}),
    ...(bolsa.trim() !== '' && bolsaOk && nBolsa !== prueba?.bolsa ? { bolsaPrueba: nBolsa } : {}),
  };
  const cambia = periodoOk && bolsaOk && Object.keys(pedido).length > 0;
  if (!enPrueba) {
    return (
      <tr>
        <th>Prueba</th>
        <td className="text-muted">
          Solo en modalidad prueba: primero se cambia la modalidad, y después se fijan acá su último mes y su bolsa.
        </td>
      </tr>
    );
  }
  return (
    <tr>
      <th>Prueba</th>
      <td>
        <p>
          {prueba
            ? <>De <strong>{prueba.desde}</strong> a <strong>{prueba.hasta}</strong>
                {prueba.bolsa !== null && <> · quedan <strong>{prueba.bolsa}</strong> conversaciones de prueba</>}</>
            : <span className="text-muted">Sin período de prueba.</span>}
        </p>
        <label htmlFor="eje-periodo-prueba">Último mes</label>{' '}
        <input id="eje-periodo-prueba" type="month" min={minimo} value={hasta}
          disabled={p.ocupado || pendiente || !p.onPrueba} onChange={(e) => setHasta(e.target.value)} />{' '}
        <label htmlFor="eje-bolsa-prueba">Bolsa de prueba</label>{' '}
        <input id="eje-bolsa-prueba" type="number" min={1} max={BOLSA_PRUEBA_MAXIMA} value={bolsa}
          disabled={p.ocupado || pendiente || !p.onPrueba} onChange={(e) => setBolsa(e.target.value)} style={{ width: '6em' }} />{' '}
        {pendiente && p.onPrueba
          ? <Confirmacion ocupado={p.ocupado}
              resumen={`Prueba: ${prueba ? `hasta ${prueba.hasta}` : 'sin período'}${pedido.periodoPrueba ? ` → hasta ${pedido.periodoPrueba}` : ''}`
                + `${pedido.bolsaPrueba !== undefined ? ` · bolsa ${prueba?.bolsa ?? '—'} → ${pedido.bolsaPrueba}` : ''}`}
              advertencia="Cubre sin huecos desde el primer mes de la prueba. La bolsa no se reinicia sola al extender. Queda en la auditoría."
              onConfirmar={() => { p.onPrueba?.(pedido); setPendiente(false); }}
              onCancelar={() => setPendiente(false)} />
          : <button type="button" className="btn btn-secondary btn-chico" disabled={p.ocupado || !cambia || !p.onPrueba}
              onClick={() => setPendiente(true)}>Fijar la prueba</button>}
        {!periodoOk && <p className="field-error">El último mes es aaaa-mm y no puede ser anterior a {minimo}.</p>}
        {!bolsaOk && <p className="field-error">La bolsa es un entero de 1 a {BOLSA_PRUEBA_MAXIMA}.</p>}
      </td>
    </tr>
  );
}

/**
 * REGISTRAR UN CAMBIO OPERADO POR NOVUCHAT. Cada cambio de configuración que
 * NovuChat hace a mano por el comercio se anota acá, al hacerlo, con qué se
 * cambió (10 a 300 caracteres). El servidor cuenta contra los incluidos del
 * plan y NIEGA pasado el tope; «forzar» lo registra igual, con constancia en
 * la auditoría (es un cambio que se cotiza aparte). Sin cuenta, o sobre un
 * comercio dado de baja, el servidor lo rechaza y la página lo muestra tal cual.
 */
function RegistrarCambio({ cambios, ocupado, onCambio }: {
  cambios: CambiosVista; ocupado: boolean; onCambio: PanelEjesProps['onCambio'];
}) {
  const [descripcion, setDescripcion] = useState('');
  const [forzar, setForzar] = useState(false);
  const [pendiente, setPendiente] = useState(false);
  const agotados = !cambios.ilimitado && cambios.incluidos !== null && cambios.usados >= cambios.incluidos;
  const largo = descripcion.trim().length;
  const listo = largo >= 10 && largo <= 300 && (!agotados || forzar);
  return (
    <div className="registrar-cambio">
      <label htmlFor="cambio-descripcion">Registrar un cambio operado (qué se cambió)</label>
      <input id="cambio-descripcion" type="text" maxLength={300} value={descripcion} disabled={ocupado || pendiente}
        onChange={(e) => setDescripcion(e.target.value)} placeholder="al menos 10 caracteres" />
      {agotados && (
        <label>
          <input type="checkbox" checked={forzar} disabled={ocupado || pendiente} onChange={(e) => setForzar(e.target.checked)} />{' '}
          Ya usó los incluidos: registrarlo igual (se cotiza aparte)
        </label>
      )}{' '}
      {pendiente
        ? <Confirmacion ocupado={ocupado}
            resumen={`Registrar un cambio operado${forzar ? ' por encima de los incluidos' : ''}`}
            advertencia="Queda en el contador del mes y en la auditoría del comercio."
            onConfirmar={() => { onCambio(descripcion.trim(), agotados && forzar); setPendiente(false); setDescripcion(''); setForzar(false); }}
            onCancelar={() => setPendiente(false)} />
        : <button type="button" className="btn btn-secondary btn-chico" disabled={ocupado || !listo}
            onClick={() => setPendiente(true)}>Registrar el cambio</button>}
    </div>
  );
}
