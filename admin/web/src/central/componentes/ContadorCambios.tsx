import { mesEscrito } from '../../lib/pagar';
import type { CambiosVista } from '../../lib/ejes';

/**
 * LOS CAMBIOS DE CONFIGURACIÓN INCLUIDOS EN EL MES: usados / incluidos.
 *
 * Es el límite que `Analisis/40` encontró ya vendido y que nadie contaba
 * (`Analisis/41` §4, consecuencia 4): los cambios que NovuChat hace por el
 * comercio. Los números vienen de `ejesDeCuenta` (el servidor los calcula con
 * `cambiosDelMes` de `central/ejes.ts`, el mismo que aplica
 * `registrarCambioOperado`); acá se dibujan y nada más. En demostración son
 * ilimitados: se cuentan, no se niegan. Sin tope conocido se dice cuántos van
 * y no se inventa un límite (`CLAUDE.md` §7).
 *
 * Componente puro: se dibuja en una prueba con `renderToStaticMarkup`.
 */
export function ContadorCambios({ cambios }: { cambios: CambiosVista }) {
  const { usados, incluidos, ilimitado } = cambios;
  const agotados = !ilimitado && incluidos !== null && usados >= incluidos;
  return (
    <span className={agotados ? 'situacion alerta' : undefined} title={`Cambios operados por NovuChat en ${mesEscrito(cambios.mes)}`}>
      {ilimitado || incluidos === null
        ? <>{usados} {usados === 1 ? 'cambio' : 'cambios'} este mes{ilimitado && ' · sin tope en demostración'}</>
        : <>{usados} de {incluidos} {incluidos === 1 ? 'incluido' : 'incluidos'} este mes</>}
      {agotados && <> · <strong>los siguientes se cotizan aparte</strong></>}
    </span>
  );
}
