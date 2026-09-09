import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { useParams } from 'react-router-dom';
import { db } from '../lib/firebase';
import { TextoSeguro } from '../componentes/TextoSeguro';
import { descargarCsv } from '../lib/exportar';

/**
 * =============================================================================
 * PEDIDOS — la pantalla del cocinero y del repartidor
 * =============================================================================
 *
 * ES LA ÚNICA PANTALLA DE LA CONSOLA QUE SE MIRA CON LAS MANOS OCUPADAS, y eso
 * manda sobre todo lo demás. Quien la abre no está analizando su negocio: está
 * por cocinar o por salir a repartir. De ahí las tres decisiones que la
 * separan del resto de la consola:
 *
 *  1. TODO DESPLEGADO, NADA EN UN MODAL. En «Cobros» el detalle de un pedido se
 *     abre a pedido, porque ahí lo que se recorre son montos. Acá el detalle ES
 *     el trabajo: obligar a abrir una ventana por pedido para saber que va sin
 *     cebolla es obligar a hacer un clic con las manos sucias.
 *  2. EL DETALLE DEL CLIENTE, GRANDE. «Sin cebolla», «talla L». Es lo que más se
 *     equivoca y lo más caro de equivocar: un plato que vuelve cuesta el plato,
 *     el tiempo y el cliente.
 *  3. LA MODALIDAD DE ENTREGA ANTES QUE EL MONTO. Al que prepara le importa si
 *     sale a la calle o se queda en el mostrador; cuánto se cobró es de la otra
 *     pantalla.
 *
 * LA VE EL OPERADOR, y es la primera pestaña de flujo que lo hace. Dejarla solo
 * para el administrador obligaría al dueño a leerle los pedidos a su cocinero,
 * que es justo el trabajo que este producto viene a sacar del medio.
 */

interface ItemPedido {
  id?: unknown; nombre?: unknown; cantidad?: unknown; precio?: unknown;
  subtotal?: unknown; nota?: unknown; detalle?: unknown; variante?: unknown;
}
interface Pedido {
  id: string;
  creadoEn?: { toDate(): Date };
  telefonoEnmascarado?: unknown;
  items?: unknown;
  total?: unknown;
  moneda?: unknown;
  costoEnvio?: unknown;
  entrega?: unknown;
  direccion?: unknown;
  nota?: unknown;
  estado?: unknown;
  origen?: unknown;
}

const ENTREGA: Record<string, string> = {
  delivery: '🛵 Enviar a domicilio',
  retiro: '🏪 Retira en el local',
  local: '🏪 Retira en el local',
};

/** Lo que el cliente pidió distinto: sale del ítem, del campo que venga. */
function detalleDelItem(i: ItemPedido): string {
  for (const campo of [i.detalle, i.nota, i.variante]) {
    if (typeof campo === 'string' && campo.trim() !== '') return campo;
  }
  return '';
}

export function Pedidos() {
  const { tenantId = '' } = useParams();
  const [pedidos, setPedidos] = useState<Pedido[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(
      query(collection(db, 'tenants', tenantId, 'pedidos'), orderBy('creadoEn', 'desc'), limit(100)),
      (s) => setPedidos(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setError('No se pudieron leer los pedidos.'));
  }, [tenantId]);

  if (error) return <section><h2>Pedidos</h2><p role="alert">{error}</p></section>;

  return (
    <section>
      <h2>Pedidos</h2>
      <p className="ayuda">
        Lo que hay que preparar y entregar, del más nuevo al más viejo.
      </p>

      {/* LO QUE ESTA PANTALLA TODAVÍA NO MUESTRA, DICHO ACÁ Y NO ESCONDIDO.
          Un pedido tomado conversando por WhatsApp no se guarda como pedido:
          registra un cierre, que es un número para facturar y no lleva ítems.
          Hasta que el flujo escriba el pedido, acá solo aparecen los del
          catálogo web. Una pantalla vacía sin explicación se lee como rota, y
          el cocinero dejaría de mirarla el segundo día. Ver `DISENO.md`
          §4nonies.3. */}
      <p className="ayuda aviso-datos">
        Por ahora aparecen los pedidos hechos desde el <strong>catálogo web</strong>.
        Los que el asistente toma conversando todavía no se guardan con su
        detalle, así que no se listan acá: están en «Conversaciones».
      </p>

      {pedidos === null && <p>Cargando…</p>}
      {pedidos?.length === 0 && (
        <p className="vacio">
          Todavía no hay pedidos. Cuando entre el primero por el catálogo web,
          aparece acá sin que haya que recargar.
        </p>
      )}

      {pedidos && pedidos.length > 0 && (
        <>
          <div className="acciones">
            <button type="button" className="btn btn-secondary" onClick={() => descargarCsv(
              'pedidos',
              ['Cuándo', 'Cliente', 'Entrega', 'Dirección', 'Ítems', 'Nota', 'Total', 'Moneda', 'Estado'],
              pedidos.map((p) => [
                p.creadoEn?.toDate?.().toLocaleString('es-BO') ?? '',
                p.telefonoEnmascarado,
                ENTREGA[String(p.entrega ?? '')] ?? p.entrega,
                p.direccion,
                (Array.isArray(p.items) ? p.items as ItemPedido[] : [])
                  .map((i) => `${String(i.cantidad ?? 1)}× ${String(i.nombre ?? '')}`
                    + (detalleDelItem(i) ? ` (${detalleDelItem(i)})` : '')).join(' · '),
                p.nota, p.total, p.moneda, p.estado,
              ]),
            )}>Exportar ({pedidos.length})</button>
          </div>

          <ul className="pedidos">
            {pedidos.map((p) => {
              const items = Array.isArray(p.items) ? p.items as ItemPedido[] : [];
              const entrega = ENTREGA[String(p.entrega ?? '')] ?? null;
              return (
                <li key={p.id} className="tarjeta pedido">
                  <div className="pedido-cabecera">
                    <strong>{p.creadoEn?.toDate?.().toLocaleString('es-BO') ?? '—'}</strong>
                    <span className="text-muted">
                      <TextoSeguro valor={p.telefonoEnmascarado} maxLargo={20} />
                    </span>
                    {typeof p.total === 'number' && (
                      <span className="pedido-total">
                        {p.total} <TextoSeguro valor={p.moneda ?? ''} maxLargo={3} />
                      </span>
                    )}
                  </div>

                  {entrega && <p className="pedido-entrega">{entrega}</p>}
                  {typeof p.direccion === 'string' && p.direccion !== '' && (
                    <p className="pedido-direccion"><TextoSeguro valor={p.direccion} maxLargo={200} /></p>
                  )}

                  <ul className="pedido-items">
                    {items.map((i, n) => (
                      <li key={`${p.id}-${n}`}>
                        <span className="pedido-cantidad">{String(i.cantidad ?? 1)}×</span>
                        <span><TextoSeguro valor={i.nombre} maxLargo={80} /></span>
                        {detalleDelItem(i) !== '' && (
                          <em className="pedido-detalle">
                            <TextoSeguro valor={detalleDelItem(i)} maxLargo={140} />
                          </em>
                        )}
                      </li>
                    ))}
                    {items.length === 0 && <li className="text-muted">Sin detalle de ítems.</li>}
                  </ul>

                  {typeof p.nota === 'string' && p.nota !== '' && (
                    <p className="pedido-nota"><TextoSeguro valor={p.nota} maxLargo={300} /></p>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
