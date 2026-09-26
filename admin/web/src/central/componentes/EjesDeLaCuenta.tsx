import { TextoSeguro } from '../../componentes/TextoSeguro';
import { ContadorCambios } from './ContadorCambios';
import {
  DESCRIPCION_MODALIDAD, DESCRIPCION_TITULARIDAD, ETIQUETA_TITULARIDAD, cambiosDelMes, etiquetaModalidad,
  modalidadDe, titularidadDe, type RutaWhatsApp,
} from '../../lib/ejes';
import { nombreDePlan, precioUsdDe } from '../../lib/planes';
import { importeBs, tipoCambioVigente } from '../../lib/prepago';

/**
 * LOS TRES EJES DE LA CUENTA, POR SEPARADO, como los ve el comercio en
 * «Cuenta» y en «Pagar» (`Analisis/41` §4, consecuencia 3): el PLAN (qué
 * contrató, con su precio en dólares y el importe en bolivianos del día), la
 * MODALIDAD (demostración, prueba o producción) y la TITULARIDAD de cada
 * número (de NovuChat o propio del comercio). Más el contador de cambios
 * incluidos del mes, que es un límite de Central y no de ningún módulo.
 *
 * SON TRES DATOS INDEPENDIENTES Y SE MUESTRAN COMO TRES. Antes la pantalla
 * deducía la modalidad del plan («demostracion») y quién paga Meta del plan
 * («byoc»): un comercio con número propio y plan Impulso no tenía forma de
 * verse bien. Acá cada eje sale de su fuente: la modalidad de `modalidadDe`
 * (el módulo del servidor), la titularidad de cada `rutasWhatsApp/{n}`, y el
 * plan de `cuenta/estado.plan`.
 *
 * NO CALCULA NADA PROPIO. El importe en bolivianos sale de `importeBs` y
 * `tipoCambioVigente`, las mismas funciones con que el servidor emite un
 * cobro; sin tipo de cambio del día no hay cifra, y se dice.
 *
 * `rutas` en `null` significa que NO se pudo leer (hoy las reglas abren
 * `rutasWhatsApp` solo al propietario): se dice «sin información» y no se
 * supone nada. Componente puro: se dibuja en una prueba sin Firestore.
 */
export function EjesDeLaCuenta({ cuenta, rutas, tipoCambio, ahoraMs }: {
  cuenta: Record<string, unknown> | null | undefined;
  rutas: readonly RutaWhatsApp[] | null;
  tipoCambio: unknown;
  ahoraMs: number;
}) {
  const modalidad = modalidadDe(cuenta);
  const plan = nombreDePlan(cuenta?.['plan']);
  const precioUsd = precioUsdDe(cuenta?.['plan']);
  const tc = tipoCambioVigente(tipoCambio, ahoraMs);
  const cambios = cambiosDelMes(cuenta, ahoraMs);
  return (
    <table className="ejes-cuenta">
      <tbody>
        <tr>
          <th>Modalidad</th>
          <td>
            <strong>{etiquetaModalidad(cuenta)}</strong>
            <span className="text-muted"> · {DESCRIPCION_MODALIDAD[modalidad]}</span>
          </td>
        </tr>
        <tr>
          <th>Plan</th>
          <td>
            {/* El nombre del plan, no el identificador; uno desconocido se
                muestra tal cual, pasado por `TextoSeguro`. */}
            <strong>{plan ?? <TextoSeguro valor={cuenta?.['plan']} maxLargo={40} />}</strong>
            {precioUsd !== null && (
              <>
                {' '}· USD {precioUsd} al mes
                {precioUsd > 0 && (tc
                  ? <span className="text-muted"> · Bs {importeBs(precioUsd, tc.tco)} al tipo de cambio oficial de {tc.tco} del {tc.fecha}</span>
                  : <span className="text-muted"> · sin tipo de cambio del día para decirlo en bolivianos</span>)}
              </>
            )}
          </td>
        </tr>
        <tr>
          <th>Titularidad del número</th>
          <td>
            {rutas === null && <span className="text-muted">Sin información</span>}
            {rutas !== null && rutas.length === 0 && <span className="text-muted">Sin número asignado</span>}
            {rutas !== null && rutas.length > 0 && (
              <ul className="lista-ejes">
                {rutas.map((r) => {
                  const t = titularidadDe(r);
                  return (
                    <li key={r.phoneNumberId} title={DESCRIPCION_TITULARIDAD[t]}>
                      <strong>{ETIQUETA_TITULARIDAD[t]}</strong>
                      {typeof r.flujo === 'string' && <span className="text-muted"> · flujo <TextoSeguro valor={r.flujo} maxLargo={30} /></span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </td>
        </tr>
        <tr>
          <th>Cambios incluidos</th>
          <td><ContadorCambios cambios={cambios} /></td>
        </tr>
      </tbody>
    </table>
  );
}
