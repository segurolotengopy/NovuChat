import { TextoSeguro } from '../../componentes/TextoSeguro';
import { ContadorCambios } from './ContadorCambios';
import {
  DESCRIPCION_MODALIDAD, DESCRIPCION_TITULARIDAD, ETIQUETA_MODALIDAD, ETIQUETA_TITULARIDAD,
  type EjesDeCuenta,
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
 * TODO VIENE DE `ejesDeCuenta` (el servidor): la modalidad con `modalidadDe`,
 * la titularidad de cada `rutasWhatsApp/{n}` —que el comercio no puede leer
 * directo— y el contador de cambios. La pantalla no deduce nada del plan.
 *
 * NO CALCULA NADA PROPIO. El importe en bolivianos sale de `importeBs` y
 * `tipoCambioVigente`, las mismas funciones con que el servidor emite un
 * cobro; sin tipo de cambio del día no hay cifra, y se dice.
 *
 * `ejes` en `undefined` es «cargando»; en `null`, que el servidor no
 * respondió (el error lo muestra la página): se dice y no se supone nada.
 * Componente puro: se dibuja en una prueba sin Firestore.
 */
export function EjesDeLaCuenta({ ejes, tipoCambio, ahoraMs }: {
  ejes: EjesDeCuenta | null | undefined;
  tipoCambio: unknown;
  ahoraMs: number;
}) {
  if (ejes === undefined) return <p className="text-muted">Leyendo los ejes de la cuenta…</p>;
  if (ejes === null) return <p className="text-muted">No se pudieron leer los ejes de la cuenta.</p>;
  const plan = nombreDePlan(ejes.plan);
  const precioUsd = precioUsdDe(ejes.plan);
  const tc = tipoCambioVigente(tipoCambio, ahoraMs);
  return (
    <table className="ejes-cuenta">
      <tbody>
        <tr>
          <th>Modalidad</th>
          <td>
            <strong>{ETIQUETA_MODALIDAD[ejes.modalidad]}</strong>
            <span className="text-muted"> · {DESCRIPCION_MODALIDAD[ejes.modalidad]}</span>
          </td>
        </tr>
        <tr>
          <th>Plan</th>
          <td>
            {/* El nombre del plan, no el identificador; uno desconocido se
                muestra tal cual, pasado por `TextoSeguro`. */}
            <strong>{plan ?? <TextoSeguro valor={ejes.plan ?? '—'} maxLargo={40} />}</strong>
            {precioUsd !== null && (
              <>
                {' '}· USD {precioUsd} al mes
                {tc
                  ? <span className="text-muted"> · Bs {importeBs(precioUsd, tc.tco)} al tipo de cambio oficial de {tc.tco} del {tc.fecha}</span>
                  : <span className="text-muted"> · sin tipo de cambio del día para decirlo en bolivianos</span>}
              </>
            )}
          </td>
        </tr>
        <tr>
          <th>Titularidad del número</th>
          <td>
            {ejes.numeros.length === 0 && <span className="text-muted">Sin número asignado</span>}
            {ejes.numeros.length > 0 && (
              <ul className="lista-ejes">
                {ejes.numeros.map((n) => (
                  <li key={n.phoneNumberId} title={DESCRIPCION_TITULARIDAD[n.titularidad]}>
                    <strong>{ETIQUETA_TITULARIDAD[n.titularidad]}</strong>
                    {n.flujo && <span className="text-muted"> · flujo <TextoSeguro valor={n.flujo} maxLargo={30} /></span>}
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
        <tr>
          <th>Cambios incluidos</th>
          <td><ContadorCambios cambios={ejes.cambios} /></td>
        </tr>
      </tbody>
    </table>
  );
}
