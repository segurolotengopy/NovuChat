import { fechaCorta, type Corte, type EstadoServicio } from '../lib/prepago';
import { mesEscrito } from '../lib/pagar';

/**
 * LA PRODUCCIÓN, COMO LA VE EL COMERCIO («prepago» en el código; «Producción»
 * en la consola, `Analisis/41` §6.1 punto 6): hasta cuándo está cubierto, cuántas
 * conversaciones le quedan y, si el corte se aplicó, a cuántos de sus clientes
 * dejó sin atender. Recibe el estado ya calculado por el módulo del servidor
 * (`estadoDeServicio`) y no calcula nada: es una vista, y se puede dibujar en
 * una prueba sin Firestore ni enrutador.
 *
 * EL CORTE SOLO SE MUESTRA SI SE APLICÓ. Mientras el corte corre en modo
 * observación (`plataforma/prepago.corteActivo` apagado, `DISENO.md`
 * §4undecies.4) el servidor anota cortes con `aplicado: false` para medir qué
 * pasaría. Ese corte NO existe para el comercio: decirle «su servicio está
 * cortado» cuando su asistente está respondiendo con normalidad es informar
 * mal, y genera un reclamo por algo que no ocurrió. El propietario sí lo ve,
 * en la cartera, y en gris.
 *
 * `perdidas` son TELÉFONOS DISTINTOS que escribieron durante el corte y no
 * fueron atendidos. Es el número que mueve a pagar —son clientes suyos, no una
 * deuda nuestra— y por eso va acá y en los recordatorios.
 */
export function ResumenPrepago({ servicio, corte }: {
  servicio: EstadoServicio;
  corte: Corte | null;
}) {
  const corteVisible = corte && corte.aplicado ? corte : null;
  return (
    <>
      <h3>Su servicio en producción</h3>
      <table>
        <tbody>
          <tr>
            <th>Cobertura</th>
            <td>
              {servicio.fase === 'cubierto' && (servicio.cubiertoHasta
                ? <>Cubierto hasta el fin de {mesEscrito(servicio.cubiertoHasta)}
                    {servicio.enPrueba && <> <span className="tag">mes de prueba</span></>}</>
                : <>Cubierto este mes</>)}
              {servicio.fase === 'gracia' && (
                <span className="situacion alerta">
                  Su mes venció. Tiene servicio por cortesía hasta el{' '}
                  {servicio.graciaHasta ? fechaCorta(servicio.graciaHasta) : '—'}.
                </span>
              )}
              {servicio.fase === 'cortado' && (corteVisible
                ? <span className="situacion alerta">Servicio cortado desde el {fechaCorta(corteVisible.desdeMs)}.</span>
                : <span className="situacion alerta">Su mes venció y la cortesía terminó.</span>)}
            </td>
          </tr>
          <tr>
            <th>Conversaciones del mes</th>
            <td>
              {servicio.consumidas} de {servicio.incluidas} incluidas
              {servicio.bolsa > 0 && <>, más {servicio.bolsa} en bolsas</>}
              {servicio.bolsaPrueba > 0 && <>, más {servicio.bolsaPrueba} de prueba</>}
              {Number.isFinite(servicio.disponibles) && <> · quedan <strong>{servicio.disponibles}</strong></>}
            </td>
          </tr>
          {corteVisible && corteVisible.perdidas > 0 && (
            <tr>
              <th>Clientes sin atender</th>
              <td className="situacion alerta">
                {corteVisible.perdidas === 1
                  ? '1 persona escribió'
                  : `${corteVisible.perdidas} personas distintas escribieron`}{' '}
                a su WhatsApp durante el corte y recibieron un mensaje de cortesía en
                lugar de su asistente.
              </td>
            </tr>
          )}
          {servicio.incoherente && (
            <tr>
              <th>Revisión pendiente</th>
              <td>
                Hay un dato de su cuenta que NovuChat tiene que corregir. Mientras tanto
                su servicio sigue funcionando: no se corta nada por esto.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
