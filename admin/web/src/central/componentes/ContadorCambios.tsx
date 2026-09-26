import { mesEscrito } from '../../lib/pagar';
import type { CambiosDelMes } from '../../lib/ejes';

/**
 * LOS CAMBIOS DE CONFIGURACIÓN INCLUIDOS EN EL MES: usados / incluidos.
 *
 * Es el límite que `Analisis/40` encontró ya vendido y que nadie contaba
 * (`Analisis/41` §4, consecuencia 4): los cambios que NovuChat hace por el
 * comercio. Los dos números los escribe el servidor (`registrarCambioOperado`
 * y la copia `limites.cambiosIncluidos`); acá se dibujan y nada más. Sin tope
 * conocido se dice cuántos van y no se inventa un límite: un límite que la
 * pantalla se inventa no existe (`CLAUDE.md` §7).
 *
 * Componente puro: se dibuja en una prueba con `renderToStaticMarkup`.
 */
export function ContadorCambios({ cambios }: { cambios: CambiosDelMes }) {
  const { usados, incluidos, agotados } = cambios;
  return (
    <span className={agotados ? 'situacion alerta' : undefined} title={`Cambios operados por NovuChat en ${mesEscrito(cambios.mes)}`}>
      {incluidos === null
        ? <>{usados} {usados === 1 ? 'cambio' : 'cambios'} este mes</>
        : <>{usados} de {incluidos} {incluidos === 1 ? 'incluido' : 'incluidos'} este mes</>}
      {agotados && <> · <strong>los siguientes se cotizan aparte</strong></>}
    </span>
  );
}
