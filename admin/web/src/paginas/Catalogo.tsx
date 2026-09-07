import { useEffect, useState } from 'react';
import {
  collection, deleteField, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc,
} from 'firebase/firestore';
import { useParams } from 'react-router-dom';
import { auth, db } from '../lib/firebase';
import { TextoSeguro } from '../componentes/TextoSeguro';
import { etiquetaCatalogo, useFlujos } from '../lib/flujos';

/**
 * CATÁLOGO — servicios o productos con precio. Común a todos los flujos.
 *
 * Es el dato del que el asistente saca «qué ofrece este negocio y a cuánto»,
 * y hasta hoy solo entraba por script. Sin esta pantalla, la consola le decía
 * al negocio cuántos servicios tenía (el tablero los cuenta) sin dejarle tocar
 * ninguno.
 *
 * LO MISMO QUE VALIDAN LAS REGLAS, repetido acá como cortesía: nombre hasta 80,
 * precio entre 0 y 1.000.000, moneda BOB o USD, duración entre 1 y 1440
 * minutos. Quien manda es el servidor.
 *
 * SE PUEDE EDITAR, NO BORRAR. Cambiar un precio o una duración es lo que un
 * negocio hace todas las semanas, y hasta hoy solo se podía dar de baja y
 * volver a cargar — que además cambiaba el identificador del ítem y rompía la
 * referencia que los funcionarios tienen en su lista de servicios. La edición
 * es en la propia fila: se toca «Editar», se corrige, se guarda.
 *
 * EL NOMBRE NO SE EDITA. El identificador del documento se deriva de él, y los
 * funcionarios guardan ese identificador en `servicios`. Cambiar el nombre
 * dejaría a los profesionales apuntando a un servicio que ya no existe, y el
 * asistente diría que nadie lo atiende. Para cambiar el nombre hay que dar de
 * baja y cargar de nuevo, que es lo correcto: es otro servicio.
 *
 * BAJA LÓGICA, NO BORRADO. Las reglas permiten borrar, pero un servicio con
 * citas pasadas o un producto con pedidos ya hechos conviene que siga
 * existiendo, inactivo: el asistente deja de ofrecerlo (`configuracionFlujo`
 * solo trae `activo == true`) y el historial no queda apuntando a nada.
 */
interface Item {
  id: string; nombre?: unknown; descripcion?: unknown; area?: unknown;
  precio?: unknown; moneda?: unknown; duracionMin?: unknown; activo?: unknown;
}

const NUEVO = { nombre: '', descripcion: '', area: '', precio: '', moneda: 'BOB', duracionMin: '30' };

/**
 * Duraciones posibles: múltiplos de 15 minutos, hasta cuatro horas.
 *
 * Es una lista cerrada y no un campo libre a propósito. Una agenda se ofrece de
 * a cuartos de hora: con un servicio de 50 minutos quedan huecos de 10 que no
 * se pueden vender, y el asistente termina proponiendo horarios como «14:50».
 * Las reglas lo exigen igual; esto evita que alguien lo descubra por un error.
 */
const DURACIONES = Array.from({ length: 16 }, (_, i) => (i + 1) * 15);

/** Duraciones a ofrecer, incluyendo la que ya tenga el ítem aunque sea rara. */
function opcionesDuracion(actual?: number): number[] {
  const base = [...DURACIONES];
  if (typeof actual === 'number' && actual > 0 && !base.includes(actual)) base.push(actual);
  return base.sort((a, b) => a - b);
}

export function Catalogo() {
  const { tenantId = '' } = useParams();
  const flujos = useFlujos(tenantId) ?? [];
  const conAgenda = flujos.includes('agendamiento');
  const [items, setItems] = useState<Item[] | null>(null);
  const [nuevo, setNuevo] = useState(NUEVO);
  const [estado, setEstado] = useState<string | null>(null);
  /** Identificador del ítem que se está editando en su fila, o `null`. */
  const [editando, setEditando] = useState<string | null>(null);
  const [borrador, setBorrador] = useState({ area: '', precio: '', moneda: 'BOB', duracionMin: '30', descripcion: '' });

  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(query(collection(db, 'tenants', tenantId, 'catalogo'), orderBy('nombre')),
      (i) => setItems(i.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setEstado('No se pudo leer el catálogo.'));
  }, [tenantId]);

  const sello = () => ({ actualizadoPor: auth.currentUser?.uid ?? '', actualizadoEn: serverTimestamp() });

  const agregar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setEstado(null);
    const sinPrecio = nuevo.precio.trim() === '';
    const precio = Number(nuevo.precio);
    const duracionMin = Number(nuevo.duracionMin);
    if (!nuevo.nombre.trim()) { setEstado('El nombre es obligatorio.'); return; }
    if (!sinPrecio && (!Number.isFinite(precio) || precio < 0)) {
      setEstado('El precio tiene que ser un número de cero para arriba, o quedar vacío.'); return;
    }
    if (conAgenda && (!Number.isInteger(duracionMin) || duracionMin <= 0 || duracionMin % 15 !== 0)) {
      setEstado('La duración va en múltiplos de 15 minutos.'); return;
    }
    try {
      // Identificador legible y estable a partir del nombre: es lo que el
      // flujo muestra y lo que un funcionario referencia en `servicios`.
      const id = nuevo.nombre.trim().toLowerCase().normalize('NFD')
        .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        .slice(0, 60) || `item-${Date.now()}`;
      await setDoc(doc(db, 'tenants', tenantId, 'catalogo', id), {
        nombre: nuevo.nombre.trim(),
        ...(nuevo.descripcion.trim() ? { descripcion: nuevo.descripcion.trim() } : {}),
        ...(nuevo.area.trim() ? { area: nuevo.area.trim().toLowerCase() } : {}),
        // Sin precio se guarda SIN el campo, no con un cero. Un cero dice
        // «gratis», que es una promesa distinta de «te lo cotizamos».
        ...(sinPrecio ? {} : { precio, moneda: nuevo.moneda }),
        ...(conAgenda ? { duracionMin } : {}),
        activo: true, ...sello(),
      });
      setNuevo(NUEVO);
      setEstado('Agregado. El asistente lo ofrece desde ahora.');
    } catch {
      setEstado('El servidor rechazó los datos. Revisa el precio y la duración.');
    }
  };

  const empezarAEditar = (it: Item) => {
    setEstado(null);
    setEditando(it.id);
    setBorrador({
      area: String(it.area ?? ''),
      descripcion: String(it.descripcion ?? ''),
      precio: typeof it.precio === 'number' ? String(it.precio) : '',
      moneda: String(it.moneda ?? 'BOB'),
      duracionMin: typeof it.duracionMin === 'number' ? String(it.duracionMin) : '30',
    });
  };

  const guardarEdicion = async (it: Item) => {
    setEstado(null);
    const sinPrecio = borrador.precio.trim() === '';
    const precio = Number(borrador.precio);
    if (!sinPrecio && (!Number.isFinite(precio) || precio < 0)) {
      setEstado('El precio tiene que ser un número de cero para arriba, o quedar vacío.'); return;
    }
    try {
      await updateDoc(doc(db, 'tenants', tenantId, 'catalogo', it.id), {
        ...(borrador.area.trim() ? { area: borrador.area.trim().toLowerCase() } : { area: deleteField() }),
        ...(borrador.descripcion.trim() ? { descripcion: borrador.descripcion.trim() } : { descripcion: deleteField() }),
        // Quitar el precio se hace BORRANDO el campo, no poniendo cero: cero
        // dice gratis y ausente dice «se cotiza». Son promesas distintas.
        ...(sinPrecio
          ? { precio: deleteField(), moneda: deleteField() }
          : { precio, moneda: borrador.moneda }),
        ...(conAgenda ? { duracionMin: Number(borrador.duracionMin) } : {}),
        ...sello(),
      });
      setEditando(null);
      setEstado('Guardado. El asistente lo dice así desde el próximo mensaje.');
    } catch {
      setEstado('El servidor rechazó el cambio. Revisa el precio y la duración.');
    }
  };

  const alternar = async (item: Item) => {
    try {
      await updateDoc(doc(db, 'tenants', tenantId, 'catalogo', item.id),
        { activo: item.activo !== true, ...sello() });
    } catch { setEstado('No se pudo cambiar el estado.'); }
  };

  const titulo = etiquetaCatalogo(flujos);

  return (
    <section>
      <h2>{titulo}</h2>
      <p className="ayuda">
        Lo que el asistente puede ofrecer y a qué precio. <strong>Si no está acá,
        el asistente dice que no lo tiene</strong>: no inventa ni precios ni
        {conAgenda ? ' servicios' : ' productos'}. Dar de baja un ítem lo saca
        de la oferta sin borrar su historial.
      </p>

      {items === null ? <p>Cargando…</p> : items.length === 0 ? (
        <p className="vacio">Todavía no hay nada cargado. Sin esto el asistente conversa, pero no ofrece nada concreto.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Nombre</th><th>Área</th><th>Precio</th>
              {conAgenda && <th>Duración</th>}
              <th>Estado</th><th />
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (editando === it.id ? (
              <tr key={it.id} className="fila-editando">
                <td><strong><TextoSeguro valor={it.nombre} maxLargo={80} /></strong>
                  <div className="text-muted">El nombre no se edita: cámbialo dando de baja y cargando de nuevo.</div>
                  <input className="input" maxLength={300} placeholder="Descripción (opcional)"
                         value={borrador.descripcion}
                         onChange={(e) => setBorrador({ ...borrador, descripcion: e.target.value })} />
                </td>
                <td>
                  <input className="input" maxLength={40} value={borrador.area}
                         onChange={(e) => setBorrador({ ...borrador, area: e.target.value })} />
                </td>
                <td>
                  <input className="input" type="number" min={0} max={1000000} step="0.01"
                         placeholder="vacío = a consultar" value={borrador.precio}
                         onChange={(e) => setBorrador({ ...borrador, precio: e.target.value })} />
                </td>
                {conAgenda && (
                  <td>
                    <select className="input" value={borrador.duracionMin}
                            onChange={(e) => setBorrador({ ...borrador, duracionMin: e.target.value })}>
                      {opcionesDuracion(typeof it.duracionMin === 'number' ? it.duracionMin : undefined)
                        .map((m) => <option key={m} value={m}>{m} min</option>)}
                    </select>
                  </td>
                )}
                <td>{it.activo === true ? 'Se ofrece' : 'Dado de baja'}</td>
                <td>
                  <button type="button" className="btn btn-primary" onClick={() => void guardarEdicion(it)}>Guardar</button>
                  <button type="button" className="btn btn-ghost" onClick={() => setEditando(null)}>Cancelar</button>
                </td>
              </tr>
            ) : (
              <tr key={it.id} className={it.activo === true ? '' : 'alerta'}>
                <td>
                  <TextoSeguro valor={it.nombre} maxLargo={80} />
                  {typeof it.descripcion === 'string' && it.descripcion !== '' && (
                    <div className="text-muted"><TextoSeguro valor={it.descripcion} maxLargo={300} /></div>
                  )}
                </td>
                <td><TextoSeguro valor={it.area ?? ''} maxLargo={40} /></td>
                <td>
                  {typeof it.precio === 'number'
                    ? <>{it.precio} <TextoSeguro valor={it.moneda ?? ''} maxLargo={3} /></>
                    : <span className="text-muted">A consultar</span>}
                </td>
                {conAgenda && <td>{typeof it.duracionMin === 'number' ? `${it.duracionMin} min` : '—'}</td>}
                <td>{it.activo === true ? 'Se ofrece' : 'Dado de baja'}</td>
                <td>
                  <button type="button" className="btn btn-ghost" onClick={() => empezarAEditar(it)}>Editar</button>
                  <button type="button" className="btn btn-ghost" onClick={() => void alternar(it)}>
                    {it.activo === true ? 'Dar de baja' : 'Volver a ofrecer'}
                  </button>
                </td>
              </tr>
            )))}
          </tbody>
        </table>
      )}

      <h3>Agregar</h3>
      <form onSubmit={agregar} style={{ maxWidth: '34rem' }}>
        <label className="field">Nombre
          <input className="input" required maxLength={80} value={nuevo.nombre}
                 onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
        </label>
        <label className="field">Descripción (opcional)
          <input className="input" maxLength={300} value={nuevo.descripcion}
                 onChange={(e) => setNuevo({ ...nuevo, descripcion: e.target.value })} />
        </label>
        <label className="field">Área o categoría (opcional)
          <input className="input" maxLength={40} value={nuevo.area} placeholder="belleza, gastronomia, retail…"
                 onChange={(e) => setNuevo({ ...nuevo, area: e.target.value })} />
        </label>
        <label className="field">Precio (déjalo vacío si se cotiza)
          <input className="input" type="number" min={0} max={1000000} step="0.01" value={nuevo.precio}
                 onChange={(e) => setNuevo({ ...nuevo, precio: e.target.value })} />
        </label>
        <p className="ayuda">
          Si lo dejas vacío, el asistente dice que el precio depende de una
          evaluación y ofrece agendar. Es lo correcto para tratamientos que no
          tienen un precio fijo. <strong>No pongas cero</strong>: cero significa
          gratis, y es una promesa distinta.
        </p>
        <label className="field">Moneda
          <select className="input" value={nuevo.moneda}
                  onChange={(e) => setNuevo({ ...nuevo, moneda: e.target.value })}>
            <option value="BOB">Bs (BOB)</option>
            <option value="USD">USD</option>
          </select>
        </label>
        {conAgenda && (
          <>
            <label className="field">Duración
              <select className="input" value={nuevo.duracionMin}
                      onChange={(e) => setNuevo({ ...nuevo, duracionMin: e.target.value })}>
                {DURACIONES.map((m) => <option key={m} value={m}>{m} min</option>)}
              </select>
            </label>
            <p className="ayuda">
              Va en bloques de 15 minutos porque la agenda se ofrece así. Con un
              servicio de 50 minutos quedan huecos de 10 que no se pueden vender.
            </p>
          </>
        )}
        <p className="ayuda">
          El precio es lo que el asistente le va a decir al cliente. Un precio
          equivocado acá es una promesa que el negocio no quiso hacer.
        </p>
        <button type="submit" className="btn btn-primary">Agregar</button>
      </form>
      {estado && <p role="status">{estado}</p>}
    </section>
  );
}
