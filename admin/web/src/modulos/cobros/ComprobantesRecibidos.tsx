import { TextoSeguro } from '../../central/componentes/TextoSeguro';
import { VisorComprobante } from './VisorComprobante';
import { AVISO_COMPROBANTES, TEXTO_FOTO_VENCIDA, TEXTO_SIN_COMPROBANTES, type ComprobanteRecibido } from './comprobantesRecibidos';

/**
 * COMPROBANTES RECIBIDOS — lo que mandaron los clientes, también lo que no coincidió.
 *
 * Un comprobante inválido no crea cobro, así que sin esta lista el comercio vería
 * solo un contador. Cada fila dice cuándo llegó, de quién, qué se pidió, qué se leyó
 * y en palabras simples cómo salió el cotejo; con «Ver foto» abre la imagen por la
 * callable auditada (`VisorComprobante`, forma por conversación).
 *
 * «Comprobado» NO aparece acá: es la marca de una persona y solo existe en un cobro
 * (cierre). Y ningún texto sugiere que el dinero entró (prohibición 3): el aviso
 * fijo lo dice. Recibe filas ya normalizadas; de dónde salen no le importa.
 */
export function ComprobantesRecibidos({ tenantId, filas, error }: {
  tenantId: string;
  /** `null` mientras carga. */
  filas: ComprobanteRecibido[] | null;
  error: boolean;
}) {
  return (
    <article className="tarjeta" aria-labelledby="titulo-comprobantes-recibidos">
      <h3 id="titulo-comprobantes-recibidos">Comprobantes recibidos</h3>
      <p className="ayuda">{AVISO_COMPROBANTES}</p>
      {error && <p role="alert">No se pudieron leer los comprobantes recibidos.</p>}
      {!error && filas === null && <p>Cargando…</p>}
      {!error && filas !== null && filas.length === 0 && <p className="vacio">{TEXTO_SIN_COMPROBANTES}</p>}
      {!error && filas !== null && filas.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Fecha y hora</th><th>Cliente</th><th>Monto pedido</th><th>Monto leído</th><th>Estado</th>
                <th><span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>Foto</span></th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={`${f.conversacionId}:${f.idMeta}`}>
                  <td>{f.fecha}</td>
                  <td><TextoSeguro valor={f.cliente} maxLargo={60} /></td>
                  <td>{f.montoPedido === null ? '—' : <>{f.montoPedido} <TextoSeguro valor={f.moneda} maxLargo={3} /></>}</td>
                  <td>{f.montoLeido === null ? '—' : <>{f.montoLeido} <TextoSeguro valor={f.moneda} maxLargo={3} /></>}</td>
                  <td>{f.estadoPalabras}</td>
                  <td>
                    {f.tieneFoto && (
                      <VisorComprobante tenantId={tenantId} etiqueta="Ver foto"
                                        origen={{ conversacionId: f.conversacionId, idMeta: f.idMeta }} />
                    )}
                    {f.fotoVencida && <span className="ayuda">{TEXTO_FOTO_VENCIDA}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}
