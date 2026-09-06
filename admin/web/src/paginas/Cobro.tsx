import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { Link, useParams } from 'react-router-dom';
import { db } from '../lib/firebase';
import { ConfiguracionVertical } from './ConfiguracionVertical';

/**
 * PEDIDOS Y COBRO — la pestaña propia del flujo de venta.
 *
 * Dos cosas viven acá y no en «Configuración»: lo que el negocio decide de la
 * entrega (costos), y el estado del QR con el que cobra. Antes eran dos
 * casillas al pie de la configuración general, y un negocio de reservas veía
 * el mismo formulario que uno de pedidos. La política del 2026-09-06 (DISENO.md
 * §4sexies) dice que cada flujo trae su pestaña, y esta es la de venta.
 *
 * EL QR NO LO SUBE EL NEGOCIO, y no es una limitación temporal de la pantalla:
 * es la prohibición 3 de CLAUDE.md. Mientras el cobro sea simulado, la imagen
 * lleva el rótulo impreso, y quien pudiera cambiar la imagen podría sacar el
 * rótulo sin tocar un solo texto. Por eso `mediaIdQr` lo escribe NovuChat, y
 * acá solo se muestra si está o no. Cuando exista cobro real —con acreditación
 * bancaria por webhook— el QR será del negocio y esta pantalla lo recibirá.
 */
export function Cobro() {
  const { tenantId = '' } = useParams();
  const [hayQr, setHayQr] = useState<boolean | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(doc(db, 'tenants', tenantId, 'config', 'venta'),
      (d) => setHayQr(String(d.get('mediaIdQr') ?? '') !== ''),
      () => setHayQr(null));
  }, [tenantId]);

  return (
    <section>
      <h2>Pedidos y cobro</h2>
      <p className="ayuda">
        El asistente toma el pedido de tu catálogo de <Link to={`/negocio/${encodeURIComponent(tenantId)}/catalogo`}>productos</Link>,
        suma la entrega, confirma el total y envía el QR. Después del QR no da el
        pedido por confirmado hasta que el cliente manda su comprobante.
      </p>

      <div className="card elev-sm" style={{ maxWidth: '34rem' }}>
        <h3 className="card-kicker">QR de cobro</h3>
        {hayQr === null ? <p className="card-body">Cargando…</p> : hayQr ? (
          <p className="card-body">
            <span className="tag tag-accent">Cargado</span>{' '}
            El asistente lo envía cuando el pedido está completo.
          </p>
        ) : (
          <p className="card-body">
            <span className="tag tag-neutral">Sin QR</span>{' '}
            Hasta que NovuChat lo cargue, el asistente toma el pedido pero
            <strong> no envía ningún QR</strong>. Es a propósito: mejor no mandar
            nada que mandar una imagen sin rotular.
          </p>
        )}
        <p className="text-muted">
          Mientras el cobro sea de demostración, el QR y sus rótulos los
          administra NovuChat: es lo que garantiza que un cobro simulado nunca
          se presente como real. Con cobro real, el QR será el tuyo.
        </p>
      </div>

      <ConfiguracionVertical tenantId={tenantId} vertical="venta" />
    </section>
  );
}
