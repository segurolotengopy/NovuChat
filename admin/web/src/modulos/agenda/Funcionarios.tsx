import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, serverTimestamp, writeBatch } from 'firebase/firestore';
import { useParams } from 'react-router-dom';
import { auth, db } from '../../core/lib/firebase';
import { TextoSeguro } from '../../central/componentes/TextoSeguro';
import { limitesDeCuenta } from '../../central/lib/planes';
import {
  claveAgenda, moverAgenda, superaElTope, type ContadorAgendas,
} from '../../../../functions/src/modulos/agenda/agendasContadas';

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
  // El plan manda: el tope sale de `cuenta/estado.limites.agendas` y el conteo del
  // contador `contadores/agendas`. Si no se pueden leer, rige el tope más chico
  // y no se deja cambiar un calendario (el servidor igual lo negaría).
  const [cuenta, setCuenta] = useState<Record<string, unknown> | null>(null);
  const [contador, setContador] = useState<ContadorAgendas | null>(null);
  const limite = limitesDeCuenta(cuenta).agendas;
  const errorCalendario = calendarioInvalido(nuevo.calendarioId);

  useEffect(() => {
    if (!tenantId) return;
    const a = onSnapshot(collection(db, 'tenants', tenantId, 'funcionarios'),
      (i) => setFuncionarios(i.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setEstado('No se pudo leer la lista de funcionarios.'));
    const b = onSnapshot(collection(db, 'tenants', tenantId, 'catalogo'),
      (i) => setServicios(i.docs.map((d) => ({ id: d.id, ...d.data() }))));
    const c = onSnapshot(doc(db, 'tenants', tenantId, 'cuenta', 'estado'),
      (d) => setCuenta(d.data() ?? {}), () => setCuenta(null));
    const e = onSnapshot(doc(db, 'tenants', tenantId, 'contadores', 'agendas'), (d) => {
      const n = d.get('calendarios');
      const refs = d.get('refs');
      setContador(d.exists() && typeof n === 'number' && refs && typeof refs === 'object'
        ? { calendarios: n, refs: refs as Record<string, number> } : null);
    }, () => setContador(null));
    return () => { a(); b(); c(); e(); };
  }, [tenantId]);

  /**
   * Escribe el funcionario y, si CAMBIA el calendario que aporta a la cuenta,
   * mueve `contadores/agendas` en el MISMO lote (las reglas lo exigen). El
   * tope se comprueba acá por cortesía; quien manda es el servidor.
   */
  const escribir = async (id: string, datos: Record<string, unknown>, antes: string, despues: string) => {
    const lote = writeBatch(db);
    lote.set(doc(db, 'tenants', tenantId, 'funcionarios', id), datos);
    if (antes !== despues) {
      if (!contador) throw new Error('sin-contador');
      const nuevo = moverAgenda(contador, antes, despues);
      lote.update(doc(db, 'tenants', tenantId, 'contadores', 'agendas'), {
        calendarios: nuevo.calendarios, refs: nuevo.refs, ultimoFuncionario: id,
        actualizadoEn: serverTimestamp(),
      });
    }
    await lote.commit();
  };

  const mensajeDeTope = (antes: string, despues: string): string | null => {
    if (antes === despues) return null;
    if (!contador) return 'No se pudo leer el conteo de agendas de su plan. Inténtelo de nuevo en un momento.';
    if (superaElTope(contador, antes, despues, limite)) {
      return `Su plan incluye ${limite} agenda${limite === 1 ? '' : 's'} (calendarios distintos) y ya usa ${contador.calendarios}. `
        + 'Use un calendario que ya tenga cargado, déjelo vacío, o suba de plan.';
    }
    return null;
  };

  const guardar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    if (errorCalendario) { setEstado(errorCalendario); return; }
    const despues = claveAgenda({ activo: true, calendarioId: nuevo.calendarioId });
    const tope = mensajeDeTope('', despues);
    if (tope) { setEstado(tope); return; }
    setEstado(null);
    try {
      await escribir(`f${Date.now()}`, {
        ...nuevo, horarioTrabajo: {}, activo: true,
        actualizadoPor: auth.currentUser?.uid ?? '',
        actualizadoEn: serverTimestamp(),
      }, '', despues);
      setNuevo({ nombre: '', especialidad: '', calendarioId: '', servicios: [] });
      setEstado('Funcionario agregado.');
    } catch {
      setEstado('El servidor rechazó los datos. Revise el ID de calendario.');
    }
  };

  const alternarActivo = async (f: Funcionario) => {
    // Baja LÓGICA: un funcionario borrado dejaría citas apuntando a un
    // identificador inexistente. Por eso las reglas no admiten `delete`.
    const antes = claveAgenda(f);
    const despues = claveAgenda({ activo: f.activo !== true, calendarioId: f.calendarioId });
    const tope = mensajeDeTope(antes, despues);
    if (tope) { setEstado(tope); return; }
    try {
      await escribir(f.id, {
        nombre: String(f.nombre ?? ''),
        especialidad: String(f.especialidad ?? ''),
        calendarioId: String(f.calendarioId ?? ''),
        horarioTrabajo: {},
        servicios: Array.isArray(f.servicios) ? f.servicios : [],
        activo: f.activo !== true,
        actualizadoPor: auth.currentUser?.uid ?? '',
        actualizadoEn: serverTimestamp(),
      }, antes, despues);
    } catch { setEstado('No se pudo cambiar el estado.'); }
  };

  return (
    <section>
      <h2>Agenda</h2>
      <p className="ayuda">
        Quién atiende qué, y con qué agenda. <strong>Si tu negocio es una sola
        persona no hace falta cargar a nadie</strong>: se usa el calendario del
        negocio y todo funciona igual. Cargar a las personas sirve cuando
        atienden varias, para que una cita de una no bloquee la de otra.
      </p>
      <p className="ayuda aviso-datos">
        Todos los calendarios de un negocio tienen que ser de <strong>la misma
        cuenta de Google</strong>. Un calendario de otra cuenta no falla al
        cargarlo: falla al crear la cita, y el asistente la confirma igual.
      </p>

      <p className="ayuda" role="status">
        Agendas de su plan: <strong>{contador ? contador.calendarios : '—'} de {limite}</strong>.
        Cuentan los calendarios distintos de las personas activas; quien usa el
        calendario del comercio no cuenta.
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
          <input required maxLength={120} placeholder="Rosa Mamani" value={nuevo.nombre}
                 onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
        </label>
        <label>Especialidad
          <input maxLength={80} placeholder="Colorimetría" value={nuevo.especialidad}
                 onChange={(e) => setNuevo({ ...nuevo, especialidad: e.target.value })} />
        </label>
        {/* El campo, su error y su ayuda son UNA pieza. El formulario se
            acomoda en columnas, y sueltos el aviso del calendario aterrizaba
            debajo de «Servicios que atiende». */}
        <div className="grupo">
          <label>ID del calendario de Google (opcional)
            <input maxLength={140} placeholder="algo@group.calendar.google.com"
                   value={nuevo.calendarioId}
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
        </div>
        <div className="grupo">
          {/* CASILLAS, NO UN `select multiple`.
              El desplegable múltiple es de los peores controles que hay: hay
              que adivinar que se elige con Ctrl, un clic sin Ctrl BORRA todo lo
              elegido sin avisar, en el celular abre una lista del sistema que
              no se parece en nada, y con más de cinco servicios queda una
              cajita con barra de desplazamiento donde no se ve qué está
              marcado. Se veía en la captura del 09/09: seis servicios en una
              ventanita de cinco líneas.
              Las casillas no tienen ninguno de esos problemas y muestran TODO
              lo elegido a la vez, que es la pregunta que uno le hace a esta
              pantalla. */}
          <fieldset className="casillero">
            <legend>Servicios que atiende</legend>
            {servicios.length === 0 && (
              <p className="ayuda">
                Todavía no hay servicios cargados. Cárguelos en su pestaña y
                vuelva: sin catálogo no hay nada que asignar.
              </p>
            )}
            {servicios.map((s) => {
              const id = String(s.id);
              const marcado = nuevo.servicios.includes(id);
              return (
                <label key={id} className="campo-casilla">
                  <input type="checkbox" checked={marcado}
                         onChange={(e) => setNuevo({ ...nuevo,
                           servicios: e.target.checked
                             ? [...nuevo.servicios, id]
                             : nuevo.servicios.filter((x) => x !== id) })} />
                  <span>{String(s.nombre ?? s.id)}</span>
                </label>
              );
            })}
          </fieldset>
          <p className="ayuda">Sin ninguna marcada, se entiende que atiende todo el catálogo.</p>
        </div>
        <button type="submit">Agregar funcionario</button>
      </form>
      {estado && <p role="status">{estado}</p>}
    </section>
  );
}
