import { useEffect, useState } from 'react';
import { doc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { CampoMonto } from '../componentes/CampoMonto';

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
  /** `monto` es un `decimal` que además se ve como plata: moneda adentro. */
  tipo: 'entero' | 'decimal' | 'monto' | 'booleano';
  ayuda?: string;
  /**
   * Qué vale una casilla cuando el campo NO está en la base.
   *
   * NO es un detalle de presentación. Sin esto, un campo ausente se dibujaba
   * SIEMPRE sin marcar, aunque el comportamiento real fuera «encendido»: la
   * pantalla decía una cosa y el asistente hacía otra. Peor todavía, guardar el
   * formulario escribía `false` sin que nadie lo tocara, así que corregir el
   * costo de envío apagaba la lista de productos de paso.
   *
   * Lo encontró Andres el 2026-09-07 probando el interruptor de la lista: la
   * veía apagada y la lista seguía apareciendo.
   */
  porDefecto?: boolean;
};

const CAMPOS: Record<string, { titulo: string; campos: Campo[]; nota?: string }> = {
  agendamiento: {
    titulo: 'Agenda y citas',
    campos: [
    ],
  },
  venta: {
    titulo: 'Venta, entrega y cobro',
      // SIN NOTA. Decía que «los rótulos del cobro simulado y la imagen del QR
      // los administra NovuChat: son los que garantizan que un cobro de
      // demostración nunca se presente como real». Es una decisión NUESTRA
      // explicada al comercio, y sobre cosas que él no puede tocar: no le dice
      // qué hacer con esta pantalla, solo por qué la hicimos así.
    campos: [
      { clave: 'costoDelivery', etiqueta: 'Costo de envío', tipo: 'monto',
        ayuda: 'Lo que se suma al pedido cuando el cliente pide envío.' },
      { clave: 'recargoFlota', etiqueta: 'Recargo de flota', tipo: 'monto',
        ayuda: 'Se suma al costo de envío en las zonas que lo necesitan.' },
    ],
  },
};


/** Lo que vale una casilla: lo guardado si es booleano, y si no, su defecto. */
function valorCasilla(campo: Campo, valor: unknown): boolean {
  return typeof valor === 'boolean' ? valor : (campo.porDefecto ?? false);
}

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

  // Sin campos que mostrar no se dibuja nada. Un titulo con un boton «Guardar»
  // y ninguna casilla debajo parece una pantalla rota.
  if (!definicion || definicion.campos.length === 0) return null;

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
        cambios[c.clave] = c.tipo === 'booleano' ? valorCasilla(c, v) : Number(v ?? 0);
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
              <input type="checkbox" checked={valorCasilla(c, datos[c.clave])}
                     onChange={(e) => setDatos({ ...datos, [c.clave]: e.target.checked })} />
            ) : c.tipo === 'monto' ? (
              // El costo de envío y el recargo son PLATA, y se ven como plata:
              // la moneda adentro del campo y el número a la derecha.
              <CampoMonto value={String(datos[c.clave] ?? '')}
                          placeholder="0.00"
                          onChange={(e) => setDatos({ ...datos, [c.clave]: e.target.value })} />
            ) : (
              <input type="number" min={0}
                     step={c.tipo === 'entero' ? 1 : 0.01}
                     placeholder={c.tipo === 'entero' ? '0' : '0.00'}
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
