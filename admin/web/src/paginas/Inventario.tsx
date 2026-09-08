import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useParams } from 'react-router-dom';
import { db, funciones } from '../lib/firebase';
import { TextoSeguro } from '../componentes/TextoSeguro';

/**
 * =============================================================================
 * INVENTARIO — cuántos quedan, y quién se los llevó
 * =============================================================================
 *
 * No es un sistema de stock. Es lo mínimo para que el asistente no venda lo que
 * ya no hay: el comercio dice cuántos tiene, cada venta descuenta, y esta
 * pantalla muestra el saldo y el historial que lo explica.
 *
 * DOS COSAS QUE ESTA PANTALLA NO HACE, Y NO ES UN OLVIDO:
 *
 *  - NO deja escribir el saldo en una casilla. Todo pasa por «contar» o
 *    «reponer», y cada uno deja su movimiento. Un número editable a mano
 *    convertiría el historial en decoración: diría «se vendieron 8» mientras el
 *    saldo dice otra cosa, y a partir de ahí nadie volvería a mirar el reporte.
 *    Las reglas lo impiden además del lado del servidor.
 *  - NO controla nada por defecto. Un ítem sin existencias cargadas se vende
 *    siempre, porque **no saber cuántos hay no es saber que hay cero**. Si
 *    fuera al revés, el día que esto se despliegue todos los catálogos que ya
 *    existen quedarían agotados y el asistente diría que no tiene nada.
 *
 * CONTAR Y REPONER SON DOS BOTONES DISTINTOS a propósito. «Contar» fija el
 * número que hay —se contó el depósito— y «reponer» suma lo que entró. Con una
 * sola operación, el comercio que recibe diez termina dejando diez donde tenía
 * cuarenta, y lo descubre cuando el asistente le rechaza una venta.
 */

interface Item { id: string; nombre?: unknown; stock?: unknown; activo?: unknown }
interface Movimiento {
  id: string; itemId?: unknown; nombre?: unknown; delta?: unknown; motivo?: unknown;
  referencia?: unknown; saldo?: unknown; faltaron?: unknown; fecha?: { toDate(): Date };
}

const MOTIVOS: Record<string, string> = {
  venta: 'Venta', reposicion: 'Reposición', ajuste: 'Ajuste',
  merma: 'Merma', inicial: 'Carga inicial',
};

/** Debajo de esto el comercio tiene que enterarse antes de quedarse sin nada. */
const POCO = 3;

export function Inventario() {
  const { tenantId = '' } = useParams();
  const [items, setItems] = useState<Item[] | null>(null);
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [estado, setEstado] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(query(collection(db, 'tenants', tenantId, 'catalogo'), orderBy('nombre')),
      (s) => setItems(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setEstado('No se pudo leer el catálogo.'));
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    // Los últimos 200 movimientos. Un historial completo se pagina, pero lo que
    // el comercio mira es «qué pasó hoy»; para lo demás está la exportación.
    return onSnapshot(
      query(collection(db, 'tenants', tenantId, 'movimientosStock'),
        orderBy('fecha', 'desc'), limit(200)),
      (s) => setMovimientos(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => {});
  }, [tenantId]);

  const mover = async (itemId: string, campo: 'fijarEn' | 'sumar', valor: number) => {
    setEstado(null);
    setOcupado(true);
    try {
      await httpsCallable(funciones, 'ajustarStock')({
        tenantId, itemId, [campo]: valor,
        motivo: campo === 'sumar' ? 'reposicion' : 'ajuste',
      });
    } catch {
      setEstado('El servidor rechazó el movimiento. Revise el número.');
    } finally {
      setOcupado(false);
    }
  };

  const dejarDeControlar = async (itemId: string) => {
    setEstado(null);
    try {
      await httpsCallable(funciones, 'dejarDeControlarStock')({ tenantId, itemId });
    } catch {
      setEstado('No se pudo dejar de controlar ese ítem.');
    }
  };

  if (items === null) return <section><h2>Inventario</h2><p>Cargando…</p></section>;

  const controlados = items.filter((i) => typeof i.stock === 'number');
  const sinControl = items.filter((i) => typeof i.stock !== 'number');
  const agotados = controlados.filter((i) => (i.stock as number) <= 0);
  const pocos = controlados.filter((i) => (i.stock as number) > 0 && (i.stock as number) <= POCO);

  return (
    <section>
      <h2>Inventario</h2>
      <p className="ayuda">
        Lo que el asistente descuenta cuando vende. <strong>Un producto sin
        existencias cargadas se ofrece siempre</strong>: mientras no cargue un
        número, nada cambia. Cuando llega a cero, el asistente deja de ofrecerlo
        y dice que se acabó — no que no lo tiene.
      </p>

      {controlados.length > 0 && (
        <div className="cuadricula">
          <article className="tarjeta">
            <h3>Con control</h3>
            <div className="datos">
              <div className="dato"><strong>{controlados.length}</strong><span>productos</span></div>
              <div className="dato"><strong>{sinControl.length}</strong><span>sin control</span></div>
            </div>
          </article>
          <article className="tarjeta">
            <h3>Agotados</h3>
            <div className="datos">
              <div className="dato"><strong>{agotados.length}</strong><span>en cero</span></div>
              <div className="dato"><strong>{pocos.length}</strong><span>quedan {POCO} o menos</span></div>
            </div>
            {agotados.length > 0 && (
              <p className="ayuda tarjeta-pie">
                El asistente ya no los ofrece: <TextoSeguro
                  valor={agotados.slice(0, 5).map((i) => String(i.nombre ?? i.id)).join(', ')}
                  maxLargo={200} />
              </p>
            )}
          </article>
        </div>
      )}

      <h3>Existencias</h3>
      <table className="table">
        <thead>
          <tr><th>Producto</th><th>Quedan</th><th>Contar</th><th>Reponer</th><th /></tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <FilaStock key={i.id} item={i} ocupado={ocupado}
                       onMover={mover} onDejar={dejarDeControlar} />
          ))}
          {items.length === 0 && (
            <tr><td colSpan={5}>
              Todavía no hay productos. Cárguelos en la pestaña de productos.
            </td></tr>
          )}
        </tbody>
      </table>

      <h3>Movimientos</h3>
      {movimientos.length === 0 ? (
        <p className="vacio">
          Sin movimientos todavía. Acá va a aparecer cada venta que descuente
          existencias, y cada conteo o reposición que usted haga.
        </p>
      ) : (
        <table className="table">
          <thead>
            <tr><th>Cuándo</th><th>Producto</th><th>Movimiento</th><th>Motivo</th><th>Quedaron</th></tr>
          </thead>
          <tbody>
            {movimientos.map((m) => {
              const delta = typeof m.delta === 'number' ? m.delta : 0;
              return (
                <tr key={m.id} className={typeof m.faltaron === 'number' ? 'alerta' : ''}>
                  <td>{m.fecha ? m.fecha.toDate().toLocaleString('es-BO') : '—'}</td>
                  <td><TextoSeguro valor={m.nombre ?? m.itemId ?? ''} maxLargo={80} /></td>
                  <td>{delta > 0 ? `+${delta}` : delta}</td>
                  <td>
                    {MOTIVOS[String(m.motivo ?? '')] ?? '—'}
                    {typeof m.faltaron === 'number' && (
                      <> · <strong>faltaron {m.faltaron}</strong></>
                    )}
                  </td>
                  <td>{typeof m.saldo === 'number' ? m.saldo : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {estado && <p role="status">{estado}</p>}
    </section>
  );
}

/**
 * Una fila. El número se escribe en su casilla y se confirma con su botón: no
 * se guarda al perder el foco. Un guardado automático sobre un campo que
 * descuenta mercadería convierte cualquier tecla suelta en un movimiento.
 */
function FilaStock({ item, ocupado, onMover, onDejar }: {
  item: Item; ocupado: boolean;
  onMover: (id: string, campo: 'fijarEn' | 'sumar', valor: number) => Promise<void>;
  onDejar: (id: string) => Promise<void>;
}) {
  const [contar, setContar] = useState('');
  const [reponer, setReponer] = useState('');
  const controla = typeof item.stock === 'number';
  const quedan = controla ? Math.max(0, Math.trunc(item.stock as number)) : null;

  const enviar = async (campo: 'fijarEn' | 'sumar', bruto: string, limpiar: () => void) => {
    const n = Number(bruto);
    if (bruto.trim() === '' || !Number.isFinite(n)) return;
    await onMover(item.id, campo, Math.trunc(n));
    limpiar();
  };

  return (
    <tr className={quedan === 0 ? 'alerta' : ''}>
      <td>
        <TextoSeguro valor={item.nombre ?? item.id} maxLargo={80} />
        {item.activo !== true && <> · <span className="tag tag-neutral">dado de baja</span></>}
      </td>
      <td>
        {quedan === null
          ? <span className="text-muted">sin control</span>
          : quedan === 0
            ? <strong>agotado</strong>
            : quedan}
      </td>
      <td>
        <input inputMode="numeric" placeholder="hay…" value={contar} disabled={ocupado}
               onChange={(e) => setContar(e.target.value)} />
        <button type="button" className="btn btn-secondary btn-chico" disabled={ocupado}
                onClick={() => void enviar('fijarEn', contar, () => setContar(''))}>
          Contar
        </button>
      </td>
      <td>
        <input inputMode="numeric" placeholder="entraron…" value={reponer}
               disabled={ocupado || !controla}
               onChange={(e) => setReponer(e.target.value)} />
        <button type="button" className="btn btn-secondary btn-chico" disabled={ocupado || !controla}
                onClick={() => void enviar('sumar', reponer, () => setReponer(''))}>
          Reponer
        </button>
      </td>
      <td>
        {controla && (
          <button type="button" className="btn btn-ghost btn-chico"
                  onClick={() => void onDejar(item.id)}>
            Dejar de controlar
          </button>
        )}
      </td>
    </tr>
  );
}
