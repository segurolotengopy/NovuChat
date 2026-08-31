import { useEffect, useState } from 'react';
import { doc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';
import { useParams } from 'react-router-dom';
import { auth, db } from '../lib/firebase';
import { ConfiguracionVertical } from './ConfiguracionVertical';

/**
 * Edición de la configuración del negocio: lo que hoy vive a mano en el nodo
 * `Config del negocio` de los flujos de n8n.
 *
 * Los mismos topes que valida `firestore.rules` se repiten acá como `maxLength`.
 * La validación del navegador es cortesía para el usuario; la que manda es la
 * del servidor. Nunca al revés.
 */
const TOPES: Record<string, number> = {
  nombreNegocio: 80, descripcion: 400, direccion: 200, numeroRecepcion: 15,
  calendarioId: 120, politicaCancelacion: 600, instruccionesExtra: 1500,
  mensajeCierre: 300, mensajeErrorTemporal: 300,
  mensajeReservaNoConfirmada: 300, mensajeComercioSuspendido: 300,
};

export function Configuracion() {
  const { tenantId = '' } = useParams();
  // El vertical sale de la ficha del comercio, que el comercio no escribe.
  const [vertical, setVertical] = useState('');
  const [datos, setDatos] = useState<Record<string, string>>({});
  const [estado, setEstado] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(doc(db, 'tenants', tenantId),
      (d) => setVertical(String(d.get('vertical') ?? '')));
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(doc(db, 'tenants', tenantId, 'config', 'negocio'), (d) => {
      const v = d.data() ?? {};
      setDatos({
        nombreNegocio: String(v['nombreNegocio'] ?? ''),
        descripcion: String(v['descripcion'] ?? ''),
        direccion: String(v['direccion'] ?? ''),
        numeroRecepcion: String(v['numeroRecepcion'] ?? ''),
        calendarioId: String(v['calendarioId'] ?? ''),
        politicaCancelacion: String(v['politicaCancelacion'] ?? ''),
        tratamiento: String(v['tratamiento'] ?? 'usted'),
        estiloEmojis: String(v['estiloEmojis'] ?? 'pocos'),
        mensajeCierre: String(v['mensajeCierre'] ?? ''),
        mensajeErrorTemporal: String(v['mensajeErrorTemporal'] ?? ''),
        mensajeReservaNoConfirmada: String(v['mensajeReservaNoConfirmada'] ?? ''),
        mensajeComercioSuspendido: String(v['mensajeComercioSuspendido'] ?? ''),
        instruccionesExtra: String(v['instruccionesExtra'] ?? ''),
      });
    }, () => setEstado('No se pudo leer la configuración.'));
  }, [tenantId]);

  const guardar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setEstado(null);
    try {
      await updateDoc(doc(db, 'tenants', tenantId, 'config', 'negocio'), {
        ...datos,
        zonaHoraria: 'America/La_Paz',
        moneda: 'BOB',
        // El sello lo verifica la regla: `actualizadoPor == request.auth.uid` y
        // `actualizadoEn == request.time`. No se puede falsear desde el cliente.
        actualizadoPor: auth.currentUser?.uid ?? '',
        actualizadoEn: serverTimestamp(),
      });
      setEstado('Guardado.');
    } catch {
      setEstado('El servidor rechazó el cambio. Revise los datos.');
    }
  };

  const opcion = (clave: string, etiqueta: string, opciones: [string, string][]) => (
    <label>
      {etiqueta}
      <select value={datos[clave] ?? ''}
              onChange={(e) => setDatos({ ...datos, [clave]: e.target.value })}>
        {opciones.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
    </label>
  );

  const campo = (clave: string, etiqueta: string, multilinea = false) => (
    <label>
      {etiqueta}
      {multilinea
        ? <textarea
            value={datos[clave] ?? ''}
            maxLength={TOPES[clave] ?? 200}
            onChange={(e) => setDatos({ ...datos, [clave]: e.target.value })} />
        : <input
            value={datos[clave] ?? ''}
            maxLength={TOPES[clave] ?? 200}
            onChange={(e) => setDatos({ ...datos, [clave]: e.target.value })} />}
    </label>
  );

  return (
    <section>
      <h2>Configuración del negocio</h2>
      <form onSubmit={guardar}>
        {campo('nombreNegocio', 'Nombre del negocio')}
        {campo('descripcion', 'Descripción', true)}

        {campo('direccion', 'Dirección del local')}
        <p className="ayuda aviso-datos">
          Si deja este campo vacío, el asistente <strong>va a decir que no tiene
          el dato y que lo consulta con recepción</strong>. Es lo correcto: el
          28 de agosto, sin este campo, el asistente inventó una dirección. Un
          dato equivocado acá hace que un cliente se presente donde no debe.
        </p>

        {campo('numeroRecepcion', 'Número de recepción (sin +, solo dígitos)')}
        {campo('calendarioId', 'ID del calendario de Google')}
        {campo('politicaCancelacion', 'Política de cancelación', true)}

        <h3>Voz del asistente</h3>
        {opcion('tratamiento', 'Cómo trata al cliente', [
          ['usted', 'De usted'], ['tu', 'De tú'], ['neutro', 'Impersonal'],
        ])}
        {opcion('estiloEmojis', 'Emojis', [
          ['ninguno', 'Ninguno'], ['pocos', 'Pocos'], ['muchos', 'Varios'],
        ])}
        <p className="ayuda">
          Son opciones cerradas y no campos de texto a propósito: lo que se elige
          acá entra en las instrucciones del asistente, y una lista cerrada no se
          puede usar para darle órdenes.
        </p>

        <h3>Mensajes fijos</h3>
        {campo('mensajeCierre', 'Al cerrar la conversación', true)}
        {campo('mensajeErrorTemporal', 'Si algo falla temporalmente', true)}
        {campo('mensajeReservaNoConfirmada', 'Si no se pudo confirmar una reserva', true)}
        {campo('mensajeComercioSuspendido', 'Si el servicio está suspendido', true)}
        <p className="ayuda">
          El mensaje de suspensión solo se puede escribir mientras el servicio
          está activo. Conviene dejarlo preparado.
        </p>

        <h3>Indicaciones</h3>
        {campo('instruccionesExtra', 'Indicaciones para el asistente', true)}
        <p className="ayuda">
          Las indicaciones se le entregan al asistente como <strong>dato</strong>,
          dentro de una sección rotulada del prompt. No reemplazan sus reglas de
          comportamiento ni pueden cambiar su identidad: el asistente siempre
          dice que es un asistente virtual si se lo preguntan.
        </p>
        <button type="submit">Guardar</button>
      </form>
      {estado && <p role="status">{estado}</p>}

      {/* Solo lo del rubro de ESTE comercio. La pantalla no ofrece la puerta,
          y las reglas además la cierran: un comercio de gastronomía no puede
          escribir configuración de agenda ni aunque construya la petición. */}
      <ConfiguracionVertical tenantId={tenantId} vertical={vertical} />
    </section>
  );
}
