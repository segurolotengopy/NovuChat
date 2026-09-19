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
  /**
   * `monto` es un `decimal` que además se ve como plata: moneda adentro.
   * `montoEntero` es plata SIN centavos: la seña de una reserva se dice en
   * bolivianos redondos («50 Bs», no «50,00»), y la regla del servidor la exige
   * entera (`configAgendamientoValida()`), así que el campo no deja escribir
   * decimales en vez de rechazarlos al guardar.
   */
  tipo: 'entero' | 'decimal' | 'monto' | 'montoEntero' | 'booleano';
  ayuda?: string;
  /** Tope inferior y superior del número, los mismos que aplica la regla. */
  min?: number;
  max?: number;
  /**
   * Lo que se guarda cuando el campo numérico está vacío. Sin esto se guarda
   * 0, y hay campos en los que 0 no es válido: los minutos de retención de la
   * seña van de 5 a 180, y un 0 los rechazaría el servidor con un mensaje que
   * no dice cuál campo fue.
   */
  valorPorDefecto?: number;
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
    // SEÑA PARA RESERVAR (DISENO.md §4duodecies, 17/09). Es un parámetro del
    // flujo de reservas y por eso vive acá y no en `/config/negocio`: un
    // restaurante no retiene horarios. Se dibuja al pie de «Configuración de
    // QR» porque sin QR propio no hay seña que cobrar; los dos números los
    // valida la regla `configAgendamientoValida()` con los mismos topes.
    titulo: 'Seña para reservar',
    nota: 'Cuando la seña está activa, el asistente manda tu QR con el resumen '
      + 'de la cita y retiene el horario los minutos que digas acá, a la espera '
      + 'del comprobante. El comprobante lo coteja el servidor: revisa que el '
      + 'monto, la cuenta y la hora coincidan. La verificación del dinero la '
      + 'haces tú en tu banco; el asistente nunca le dice al cliente que el '
      + 'pago entró.',
    campos: [
      { clave: 'senaImporte', etiqueta: 'Importe de la seña', tipo: 'montoEntero',
        min: 0, max: 10000, valorPorDefecto: 0,
        ayuda: 'En bolivianos redondos. Con 0 no se pide seña: el asistente agenda '
          + 'la cita directamente, como hasta ahora.' },
      { clave: 'senaMinutosRetencion', etiqueta: 'Minutos que se retiene el horario',
        tipo: 'entero', min: 5, max: 180, valorPorDefecto: 30,
        ayuda: 'Entre 5 y 180. Pasado ese tiempo sin comprobante, la cita retenida '
          + 'se libera sola y el horario vuelve a estar disponible.' },
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

const esEntero = (c: Campo): boolean => c.tipo === 'entero' || c.tipo === 'montoEntero';

/**
 * Lo que se guarda de un campo numérico. Vacío → su defecto (o 0). Los enteros
 * se redondean: el campo ya no deja escribir decimales (`step` 1), pero un
 * valor pegado con coma o un `1e1` pasan el control del navegador, y la regla
 * del servidor exige `is int` sin decir en cuál campo falló.
 */
function valorNumero(campo: Campo, valor: unknown): number {
  const crudo = valor === '' || valor === undefined || valor === null
    ? (campo.valorPorDefecto ?? 0)
    : Number(valor);
  const n = Number.isFinite(crudo) ? crudo : (campo.valorPorDefecto ?? 0);
  return esEntero(campo) ? Math.round(n) : n;
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
        cambios[c.clave] = c.tipo === 'booleano' ? valorCasilla(c, v) : valorNumero(c, v);
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
            ) : c.tipo === 'monto' || c.tipo === 'montoEntero' ? (
              // El costo de envío, el recargo y la seña son PLATA, y se ven como
              // plata: la moneda adentro del campo y el número a la derecha.
              // `step` 1 en la seña: el navegador no deja guardar centavos.
              <CampoMonto value={String(datos[c.clave] ?? '')}
                          placeholder={esEntero(c) ? '0' : '0.00'}
                          step={esEntero(c) ? 1 : 0.01}
                          min={c.min ?? 0} max={c.max}
                          onChange={(e) => setDatos({ ...datos, [c.clave]: e.target.value })} />
            ) : (
              <input type="number" min={c.min ?? 0} max={c.max}
                     step={esEntero(c) ? 1 : 0.01}
                     placeholder={c.valorPorDefecto !== undefined ? String(c.valorPorDefecto)
                       : esEntero(c) ? '0' : '0.00'}
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
