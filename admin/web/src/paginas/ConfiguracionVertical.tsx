import { useEffect, useState } from 'react';
import { doc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';

/**
 * Configuración ESPECÍFICA DEL VERTICAL.
 *
 * Un comercio de gastronomía no ve campos de calendario y uno de belleza no ve
 * el recargo de flota. **Eso no se logra escondiendo campos**: cada vertical
 * tiene su propio documento (`/config/agendamiento`, `/config/venta`) y las
 * reglas de Firestore rechazan que un comercio escriba el que no le toca.
 * Esta pantalla solo evita ofrecer una puerta que el servidor va a cerrar.
 *
 * ⚠️ SE GUARDA CON `updateDoc`, NO CON `setDoc`. En el documento de venta hay
 * campos que escribe NovuChat y el comercio no puede tocar —`mediaIdQr` sobre
 * todo—. Un `setDoc` reemplaza el documento entero y los BORRARÍA; la regla lo
 * rechaza, porque borrar también es afectar. Es deliberado: el camino más
 * natural del programador desarmaría el control que sostiene la prohibición 3.
 */

type Campo = {
  clave: string;
  etiqueta: string;
  tipo: 'entero' | 'decimal' | 'booleano';
  ayuda?: string;
};

const CAMPOS: Record<string, { titulo: string; campos: Campo[]; nota?: string }> = {
  agendamiento: {
    titulo: 'Agenda y citas',
    campos: [
      { clave: 'duracionPorDefectoMin', etiqueta: 'Duración por defecto (minutos)', tipo: 'entero' },
      { clave: 'anticipacionMinimaMin', etiqueta: 'Anticipación mínima (minutos)', tipo: 'entero',
        ayuda: 'Evita que alguien reserve para dentro de dos minutos y usted se entere cuando ya está en la puerta.' },
      { clave: 'anticipacionMaximaDias', etiqueta: 'Se puede reservar hasta (días)', tipo: 'entero' },
      { clave: 'horasRecordatorio', etiqueta: 'Recordatorio (horas antes)', tipo: 'entero' },
      { clave: 'permitirCancelacion', etiqueta: 'Permitir cancelar desde WhatsApp', tipo: 'booleano' },
    ],
  },
  venta: {
    titulo: 'Venta, entrega y cobro',
    nota: 'Los rótulos del cobro simulado y la imagen del QR los administra NovuChat: '
        + 'son los que garantizan que un cobro de demostración nunca se presente como real.',
    campos: [
      { clave: 'costoDelivery', etiqueta: 'Costo de envío', tipo: 'decimal' },
      { clave: 'recargoFlota', etiqueta: 'Recargo de flota', tipo: 'decimal' },
      { clave: 'pedidoMinimo', etiqueta: 'Pedido mínimo', tipo: 'decimal' },
      { clave: 'radioEntregaKm', etiqueta: 'Radio de entrega (km)', tipo: 'decimal' },
      { clave: 'tiempoCocinaMin', etiqueta: 'Tiempo de preparación (minutos)', tipo: 'entero' },
      { clave: 'tiempoDespachoMin', etiqueta: 'Tiempo de despacho (minutos)', tipo: 'entero' },
      { clave: 'aceptaDelivery', etiqueta: 'Acepta envíos', tipo: 'booleano' },
      { clave: 'aceptaRetiroEnLocal', etiqueta: 'Acepta retiro en el local', tipo: 'booleano' },
    ],
  },
};

export function ConfiguracionVertical({ tenantId, vertical }: { tenantId: string; vertical: string }) {
  const definicion = CAMPOS[vertical];
  const [datos, setDatos] = useState<Record<string, unknown>>({});
  const [estado, setEstado] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId || !definicion) return;
    return onSnapshot(doc(db, 'tenants', tenantId, 'config', vertical),
      (d) => setDatos(d.data() ?? {}),
      () => setEstado('No se pudo leer la configuración del rubro.'));
  }, [tenantId, vertical, definicion]);

  if (!definicion) return null;   // vertical sin configuración propia

  const guardar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setEstado(null);
    try {
      // Solo los campos que esta pantalla ofrece. Nada de volcar `datos`
      // entero: traería de vuelta los campos de NovuChat y la regla lo negaría.
      const cambios: Record<string, unknown> = {
        actualizadoPor: auth.currentUser?.uid ?? '',
        actualizadoEn: serverTimestamp(),
      };
      for (const c of definicion.campos) {
        const v = datos[c.clave];
        cambios[c.clave] = c.tipo === 'booleano' ? v === true : Number(v ?? 0);
      }
      await updateDoc(doc(db, 'tenants', tenantId, 'config', vertical), cambios);
      setEstado('Guardado.');
    } catch {
      setEstado('El servidor rechazó el cambio. Revise los valores.');
    }
  };

  return (
    <section>
      <h3>{definicion.titulo}</h3>
      {definicion.nota && <p className="ayuda">{definicion.nota}</p>}
      <form onSubmit={guardar}>
        {definicion.campos.map((c) => (
          <label key={c.clave}>
            {c.etiqueta}
            {c.tipo === 'booleano' ? (
              <input type="checkbox" checked={datos[c.clave] === true}
                     onChange={(e) => setDatos({ ...datos, [c.clave]: e.target.checked })} />
            ) : (
              <input type="number" min={0}
                     step={c.tipo === 'entero' ? 1 : 0.01}
                     value={String(datos[c.clave] ?? '')}
                     onChange={(e) => setDatos({ ...datos, [c.clave]: e.target.value })} />
            )}
            {c.ayuda && <span className="ayuda">{c.ayuda}</span>}
          </label>
        ))}
        <button type="submit">Guardar {definicion.titulo.toLowerCase()}</button>
      </form>
      {estado && <p role="status">{estado}</p>}
    </section>
  );
}
