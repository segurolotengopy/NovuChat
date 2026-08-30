import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { useParams } from 'react-router-dom';
import { auth, db } from '../lib/firebase';
import { TextoSeguro } from '../componentes/TextoSeguro';

interface Funcionario {
  id: string;
  nombre?: unknown;
  especialidad?: unknown;
  calendarioId?: unknown;
  servicios?: unknown;
  activo?: unknown;
}
interface Servicio { id: string; nombre?: unknown }

/**
 * MISMA validación que `firestore.rules`, repetida acá a propósito.
 *
 * El ID de calendario es el dato que más caro salió en este proyecto: uno con un
 * carácter de menos hizo que Google devolviera 404, que el agente confirmara
 * igual y que la lectura de disponibilidad fallara en silencio — el agente pasó
 * a INVENTAR los horarios.
 *
 * DOS TRAMPAS que hay que respetar:
 *  1. EXACTAMENTE 64 hexadecimales, no «32 o más».
 *  2. EL ORDEN: un ID de calendario tiene forma de correo, así que primero se
 *     decide por el sufijo. Lo que termina en `@group.calendar.google.com` se
 *     juzga solo con la regla estricta, sin red de rescate.
 *
 * Lo de acá es cortesía para que el usuario vea el error antes de guardar. Quien
 * manda es el servidor.
 */
const SUFIJO_GRUPO = '@group.calendar.google.com';
const SECUNDARIO = /^[0-9a-fA-F]{64}@group\.calendar\.google\.com$/;
const PRIMARIO = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}$/;

export function calendarioInvalido(id: string): string | null {
  if (id === '') return null;                       // vacío = sin agenda propia
  if (id.endsWith(SUFIJO_GRUPO)) {
    if (SECUNDARIO.test(id)) return null;
    const hex = id.slice(0, -SUFIJO_GRUPO.length);
    return `La parte hexadecimal tiene ${hex.length} caracteres y deben ser 64.`;
  }
  if (PRIMARIO.test(id)) return null;
  return 'No tiene forma de ID de calendario: 64 hexadecimales + el sufijo de Google, o un correo.';
}

/**
 * Alta, baja y edición de funcionarios.
 *
 * POR QUÉ EXISTE. Con un solo calendario por comercio, una cita de manicure a
 * las 11:30 bloqueaba una de ortodoncia a las 11:30, que atiende otra persona.
 *
 * NO HACE FALTA CARGAR NINGUNO. Un comercio de una sola persona deja esta lista
 * vacía y todo funciona con el calendario del negocio.
 *
 * El teléfono y el correo del funcionario NO se editan acá: son datos personales
 * de un tercero y viven en un documento aparte que solo ve el administrador
 * (`/funcionarios/{id}/privado/datos`).
 */
export function Funcionarios() {
  const { tenantId = '' } = useParams();
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([]);
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [nuevo, setNuevo] = useState({
    nombre: '', especialidad: '', calendarioId: '', servicios: [] as string[],
  });
  const [estado, setEstado] = useState<string | null>(null);
  const errorCalendario = calendarioInvalido(nuevo.calendarioId);

  useEffect(() => {
    if (!tenantId) return;
    const a = onSnapshot(collection(db, 'tenants', tenantId, 'funcionarios'),
      (i) => setFuncionarios(i.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setEstado('No se pudo leer la lista de funcionarios.'));
    const b = onSnapshot(collection(db, 'tenants', tenantId, 'catalogo'),
      (i) => setServicios(i.docs.map((d) => ({ id: d.id, ...d.data() }))));
    return () => { a(); b(); };
  }, [tenantId]);

  const guardar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    if (errorCalendario) { setEstado(errorCalendario); return; }
    setEstado(null);
    try {
      await setDoc(doc(db, 'tenants', tenantId, 'funcionarios', `f${Date.now()}`), {
        ...nuevo, horarioTrabajo: {}, activo: true,
        actualizadoPor: auth.currentUser?.uid ?? '',
        actualizadoEn: serverTimestamp(),
      });
      setNuevo({ nombre: '', especialidad: '', calendarioId: '', servicios: [] });
      setEstado('Funcionario agregado.');
    } catch {
      setEstado('El servidor rechazó los datos. Revise el ID de calendario.');
    }
  };

  const alternarActivo = async (f: Funcionario) => {
    // Baja LÓGICA: un funcionario borrado dejaría citas apuntando a un
    // identificador inexistente. Por eso las reglas no admiten `delete`.
    try {
      await setDoc(doc(db, 'tenants', tenantId, 'funcionarios', f.id), {
        nombre: String(f.nombre ?? ''),
        especialidad: String(f.especialidad ?? ''),
        calendarioId: String(f.calendarioId ?? ''),
        horarioTrabajo: {},
        servicios: Array.isArray(f.servicios) ? f.servicios : [],
        activo: f.activo !== true,
        actualizadoPor: auth.currentUser?.uid ?? '',
        actualizadoEn: serverTimestamp(),
      });
    } catch { setEstado('No se pudo cambiar el estado.'); }
  };

  return (
    <section>
      <h2>Funcionarios</h2>
      <p className="ayuda">
        Quién atiende qué, y con qué agenda. <strong>Si su negocio es una sola
        persona no hace falta cargar ninguno</strong>: se usa el calendario del
        comercio y todo funciona igual. Cargarlos sirve cuando hay varias
        personas atendiendo, para que una cita de una no bloquee la de otra.
      </p>

      <table>
        <thead>
          <tr><th>Nombre</th><th>Especialidad</th><th>Servicios</th><th>Agenda</th><th>Estado</th><th /></tr>
        </thead>
        <tbody>
          {funcionarios.map((f) => (
            <tr key={f.id} className={f.activo === true ? '' : 'alerta'}>
              <td><TextoSeguro valor={f.nombre} maxLargo={120} /></td>
              <td><TextoSeguro valor={f.especialidad} maxLargo={80} /></td>
              <td>{Array.isArray(f.servicios) ? f.servicios.length : 0}</td>
              <td>{String(f.calendarioId ?? '') === '' ? 'la del comercio' : 'propia'}</td>
              <td>{f.activo === true ? 'Activo' : 'Inactivo'}</td>
              <td>
                <button onClick={() => void alternarActivo(f)}>
                  {f.activo === true ? 'Dar de baja' : 'Reactivar'}
                </button>
              </td>
            </tr>
          ))}
          {funcionarios.length === 0 && (
            <tr><td colSpan={6}>Sin funcionarios: se usa el calendario del comercio.</td></tr>
          )}
        </tbody>
      </table>

      <form onSubmit={guardar}>
        <h3>Agregar</h3>
        <label>Nombre
          <input required maxLength={120} value={nuevo.nombre}
                 onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
        </label>
        <label>Especialidad
          <input maxLength={80} value={nuevo.especialidad}
                 onChange={(e) => setNuevo({ ...nuevo, especialidad: e.target.value })} />
        </label>
        <label>ID del calendario de Google (opcional)
          <input maxLength={140} value={nuevo.calendarioId}
                 aria-invalid={errorCalendario !== null}
                 onChange={(e) => setNuevo({ ...nuevo, calendarioId: e.target.value.trim() })} />
        </label>
        {errorCalendario && <p role="alert" className="ayuda aviso-datos">{errorCalendario}</p>}
        <p className="ayuda">
          Péguelo tal cual desde Google Calendar, sin recortar. Un carácter de
          menos hace que la agenda falle <strong>en silencio</strong> y que el
          asistente termine inventando horarios. Si lo deja vacío, esta persona
          usa el calendario del comercio.
        </p>
        <label>Servicios que atiende
          <select multiple size={5} value={nuevo.servicios}
                  onChange={(e) => setNuevo({ ...nuevo,
                    servicios: [...e.target.selectedOptions].map((o) => o.value) })}>
            {servicios.map((s) => (
              <option key={s.id} value={s.id}>{String(s.nombre ?? s.id)}</option>
            ))}
          </select>
        </label>
        <p className="ayuda">Sin selección, se entiende que atiende todo el catálogo.</p>
        <button type="submit">Agregar funcionario</button>
      </form>
      {estado && <p role="status">{estado}</p>}
    </section>
  );
}
