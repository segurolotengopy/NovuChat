import { useEffect, useState } from 'react';
import { doc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';
import { useParams } from 'react-router-dom';
import { auth, db } from '../lib/firebase';

/**
 * Edición de la configuración del negocio: lo que hoy vive a mano en el nodo
 * `Config del negocio` de los flujos de n8n.
 *
 * Los mismos topes que valida `firestore.rules` se repiten acá como `maxLength`.
 * La validación del navegador es cortesía para el usuario; la que manda es la
 * del servidor. Nunca al revés.
 */
const TOPES = { nombreNegocio: 80, descripcion: 400, calendarioId: 120, instruccionesExtra: 1500 };

export function Configuracion() {
  const { tenantId = '' } = useParams();
  const [datos, setDatos] = useState<Record<string, string>>({});
  const [estado, setEstado] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(doc(db, 'tenants', tenantId, 'config', 'negocio'), (d) => {
      const v = d.data() ?? {};
      setDatos({
        nombreNegocio: String(v['nombreNegocio'] ?? ''),
        descripcion: String(v['descripcion'] ?? ''),
        telefonoRecepcion: String(v['telefonoRecepcion'] ?? ''),
        calendarioId: String(v['calendarioId'] ?? ''),
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

  const campo = (clave: keyof typeof TOPES | 'telefonoRecepcion', etiqueta: string, multilinea = false) => (
    <label>
      {etiqueta}
      {multilinea
        ? <textarea
            value={datos[clave] ?? ''}
            maxLength={TOPES[clave as keyof typeof TOPES] ?? 200}
            onChange={(e) => setDatos({ ...datos, [clave]: e.target.value })} />
        : <input
            value={datos[clave] ?? ''}
            maxLength={TOPES[clave as keyof typeof TOPES] ?? 200}
            onChange={(e) => setDatos({ ...datos, [clave]: e.target.value })} />}
    </label>
  );

  return (
    <section>
      <h2>Configuración del negocio</h2>
      <form onSubmit={guardar}>
        {campo('nombreNegocio', 'Nombre del negocio')}
        {campo('descripcion', 'Descripción', true)}
        {campo('telefonoRecepcion', 'Teléfono de recepción (sin +)')}
        {campo('calendarioId', 'ID del calendario de Google')}
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
    </section>
  );
}
