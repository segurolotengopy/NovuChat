import { useEffect, useRef, useState } from 'react';
import {
  collection, deleteField, doc, onSnapshot, orderBy, query, serverTimestamp,
  setDoc, updateDoc, writeBatch,
} from 'firebase/firestore';
import { useParams } from 'react-router-dom';
import { auth, db } from '../lib/firebase';
import { TextoSeguro } from '../componentes/TextoSeguro';
import { etiquetaCatalogo, useFlujos } from '../lib/flujos';
import {
  aCsv, idDeNombre, validarCsv, type FilaCatalogo, type FilaConProblemas,
} from '../lib/csv';

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
  imagenUrl?: unknown;
}

const NUEVO = {
  nombre: '', descripcion: '', area: '', precio: '', moneda: 'BOB',
  duracionMin: '30', imagenUrl: '',
};

/**
 * MISMA VALIDACIÓN QUE LAS REGLAS, repetida acá como cortesía. Quien decide es
 * el servidor; esto existe para que el error se vea al escribir y no después de
 * un rechazo genérico. Ver `urlImagenValida` en `firestore.rules`.
 */
const imagenValida = (url: string) => url === '' || /^https:\/\/[^ '"<>]+$/.test(url);

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
  const conVenta = flujos.includes('venta');
  const [items, setItems] = useState<Item[] | null>(null);
  const [nuevo, setNuevo] = useState(NUEVO);
  const [estado, setEstado] = useState<string | null>(null);
  /** Identificador del ítem que se está editando en su fila, o `null`. */
  const [editando, setEditando] = useState<string | null>(null);
  const [borrador, setBorrador] = useState({
    area: '', precio: '', moneda: 'BOB', duracionMin: '30', descripcion: '', imagenUrl: '',
  });

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
    if (!imagenValida(nuevo.imagenUrl.trim())) {
      setEstado('La foto tiene que ser una dirección https. Una http la bloquea '
        + 'el navegador del cliente y no se ve nada.'); return;
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
        ...(nuevo.imagenUrl.trim() ? { imagenUrl: nuevo.imagenUrl.trim() } : {}),
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
      imagenUrl: String(it.imagenUrl ?? ''),
    });
  };

  const guardarEdicion = async (it: Item) => {
    setEstado(null);
    const sinPrecio = borrador.precio.trim() === '';
    const precio = Number(borrador.precio);
    if (!sinPrecio && (!Number.isFinite(precio) || precio < 0)) {
      setEstado('El precio tiene que ser un número de cero para arriba, o quedar vacío.'); return;
    }
    if (!imagenValida(borrador.imagenUrl.trim())) {
      setEstado('La foto tiene que ser una dirección https.'); return;
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
        ...(borrador.imagenUrl.trim()
          ? { imagenUrl: borrador.imagenUrl.trim() }
          : { imagenUrl: deleteField() }),
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

      <EnlaceAlCatalogoWeb conVenta={conVenta} />

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
                  <input className="input" maxLength={500} placeholder="https://… foto (opcional)"
                         value={borrador.imagenUrl}
                         onChange={(e) => setBorrador({ ...borrador, imagenUrl: e.target.value })} />
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
                  <div className="fila-con-foto">
                    <Miniatura url={it.imagenUrl} />
                    <div>
                      <TextoSeguro valor={it.nombre} maxLargo={80} />
                      {typeof it.descripcion === 'string' && it.descripcion !== '' && (
                        <div className="text-muted"><TextoSeguro valor={it.descripcion} maxLargo={300} /></div>
                      )}
                    </div>
                  </div>
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

      <ImportarCatalogo tenantId={tenantId} conAgenda={conAgenda} items={items ?? []} />

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
        <label className="field">Foto (opcional)
          <input className="input" maxLength={500} placeholder="https://…"
                 value={nuevo.imagenUrl}
                 onChange={(e) => setNuevo({ ...nuevo, imagenUrl: e.target.value })} />
        </label>
        <p className="ayuda">
          La dirección de una foto que ya tengas publicada —tu web, tu Drive con
          enlace público, tu Instagram—. <strong>NovuChat no guarda la imagen</strong>:
          la muestra desde donde está. Si la borrás de allá, deja de verse acá.
          Tiene que empezar con <code>https://</code>.
        </p>
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
        <p className="ayuda">
          Ojo si tenés el <strong>catálogo web</strong> encendido: lo que quede
          sin precio <strong>no se publica en la página</strong>. Se sigue
          ofreciendo por chat, donde el asistente puede cotizarlo.
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

/**
 * Miniatura de la foto del ítem.
 *
 * DOS COSAS QUE NO SON OBVIAS. La primera: `onError` deja la casilla vacía en
 * vez de dejar el ícono de imagen rota. Una foto que no carga es exactamente lo
 * que el comercio tiene que ver —significa que la URL dejó de servir y sus
 * clientes tampoco la ven—, pero el ícono roto del navegador se confunde con un
 * error de la consola. La casilla vacía con su rótulo dice de quién es el
 * problema. La segunda: `referrerPolicy="no-referrer"`, para que el servidor
 * ajeno que aloja la foto no reciba la dirección de la consola de un cliente.
 */
function Miniatura({ url }: { url: unknown }) {
  const [rota, setRota] = useState(false);
  const valor = typeof url === 'string' ? url : '';
  if (valor === '' || !imagenValida(valor)) return null;
  if (rota) {
    return <span className="miniatura miniatura-rota" title="Esta foto no carga">sin foto</span>;
  }
  return (
    <img className="miniatura" src={valor} alt="" loading="lazy"
         referrerPolicy="no-referrer" onError={() => setRota(true)} />
  );
}

/**
 * =============================================================================
 * IMPORTAR EL CATÁLOGO DESDE UN CSV O UN SHEETS
 * =============================================================================
 *
 * EL SHEETS ES UN FORMATO DE ENTRADA, NO LA FUENTE DE VERDAD. La corrección
 * §3.1 de `Analisis/11-catalogo-web-propio.md`: si el catálogo viviera en el
 * Sheets, habría dos —el del Sheets y el que la consola le pasa al asistente— y
 * se desincronizarían el primer martes que alguien corrija un precio en el lugar
 * equivocado. Acá el archivo entra una vez, y desde ese momento manda la consola.
 *
 * SE MUESTRA ANTES DE ESCRIBIR. Una importación que escribe primero y avisa
 * después obliga a deshacer a mano doscientas filas, y no hay ningún «deshacer».
 * La vista previa es la mitad de esta pantalla por eso.
 *
 * NO BORRA NADA QUE NO ESTÉ EN EL ARCHIVO. Un ítem que existía y no viene en el
 * CSV se queda como está. Es lo contrario de lo que hace un «sincronizar», y es
 * deliberado: la mayoría de los archivos que va a subir un comercio son
 * PARCIALES —«los precios nuevos de las pizzas»— y una importación que borra lo
 * que no menciona sería una trampa. Para sacar algo del catálogo está «Dar de
 * baja», que además conserva el historial.
 */
function ImportarCatalogo({ tenantId, conAgenda, items }: {
  tenantId: string; conAgenda: boolean; items: Item[];
}) {
  const [texto, setTexto] = useState('');
  const [previa, setPrevia] = useState<{
    filas: FilaConProblemas[]; columnas: string[]; error: string | null;
  } | null>(null);
  const [estado, setEstado] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);
  const archivo = useRef<HTMLInputElement>(null);

  const analizar = (contenido: string) => {
    setEstado(null);
    setTexto(contenido);
    setPrevia(validarCsv(contenido, conAgenda));
  };

  const alElegirArchivo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    // Tope de tamaño: un catálogo de quinientos ítems no llega a 200 KB. Un
    // archivo de diez megas es un error de dedo, y leerlo entero en el
    // navegador de un teléfono lo cuelga sin decir por qué.
    if (f.size > 2_000_000) {
      setEstado('Ese archivo es demasiado grande para ser un catálogo. ¿Seguro que es el correcto?');
      return;
    }
    void f.text().then(analizar);
  };

  const importar = async () => {
    if (!previa) return;
    const buenas = previa.filas.filter((f) => f.problemas.length === 0);
    if (buenas.length === 0) return;
    setImportando(true);
    setEstado(null);

    const tiene = (columna: string) => previa.columnas.includes(columna);
    const sello = {
      actualizadoPor: auth.currentUser?.uid ?? '', actualizadoEn: serverTimestamp(),
    };

    try {
      // De a 400. El tope duro de un lote de Firestore es 500 operaciones, y
      // pasarse devuelve un error que no dice cuál fue la fila culpable.
      for (let i = 0; i < buenas.length; i += 400) {
        const lote = writeBatch(db);
        for (const { fila } of buenas.slice(i, i + 400)) {
          const ref = doc(db, 'tenants', tenantId, 'catalogo', idDeNombre(fila.nombre));
          lote.set(ref, {
            nombre: fila.nombre,
            ...(tiene('descripcion')
              ? { descripcion: fila.descripcion || deleteField() } : {}),
            ...(tiene('area') ? { area: fila.area || deleteField() } : {}),
            // El precio solo se toca si el archivo trae la columna. Ver el
            // comentario de `validarCsv` sobre por qué esto importa tanto.
            ...(tiene('precio')
              ? (fila.precio === null
                ? { precio: deleteField(), moneda: deleteField() }
                : { precio: fila.precio, moneda: fila.moneda })
              : {}),
            ...(conAgenda && tiene('duracionmin') ? { duracionMin: fila.duracionMin } : {}),
            ...(tiene('imagenurl') ? { imagenUrl: fila.imagenUrl || deleteField() } : {}),
            ...(tiene('activo') ? { activo: fila.activo } : {}),
            ...sello,
          }, { merge: true });
        }
        await lote.commit();
      }
      setEstado(`Listo: ${buenas.length} ${buenas.length === 1 ? 'ítem' : 'ítems'} `
        + 'en el catálogo. El asistente los ofrece desde el próximo mensaje.');
      setPrevia(null);
      setTexto('');
      if (archivo.current) archivo.current.value = '';
    } catch {
      // El fallo típico es una fila que las reglas rechazan. Se dice con
      // franqueza que la importación quedó a medias: fingir lo contrario haría
      // que el comercio no revise.
      setEstado('El servidor rechazó parte de la importación. Puede haber quedado '
        + 'a medias: revisá la lista de arriba antes de volver a intentar.');
    } finally {
      setImportando(false);
    }
  };

  const exportar = () => {
    const filas: FilaCatalogo[] = items.map((i) => ({
      nombre: String(i.nombre ?? ''),
      descripcion: String(i.descripcion ?? ''),
      area: String(i.area ?? ''),
      precio: typeof i.precio === 'number' ? i.precio : null,
      moneda: i.moneda === 'USD' ? 'USD' : 'BOB',
      duracionMin: typeof i.duracionMin === 'number' ? i.duracionMin : 30,
      imagenUrl: String(i.imagenUrl ?? ''),
      activo: i.activo === true,
    }));
    const url = URL.createObjectURL(new Blob([aCsv(filas)], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `catalogo-${tenantId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const buenas = previa?.filas.filter((f) => f.problemas.length === 0).length ?? 0;
  const malas = (previa?.filas.length ?? 0) - buenas;

  return (
    <details className="importador">
      <summary>Importar o exportar en lote (CSV, Excel o Sheets)</summary>

      <p className="ayuda">
        Subí la lista que ya tenés. La única columna obligatoria es
        <strong> nombre</strong>; también se entienden <em>descripcion, area,
        precio, moneda{conAgenda ? ', duracionMin' : ''}, imagenUrl</em> y
        <em> activo</em>. <strong>Lo que el archivo no traiga, no se toca</strong>:
        un archivo sin columna de precios actualiza el resto y deja los precios
        como están.
      </p>

      <div className="filtros">
        <label>Archivo
          <input ref={archivo} className="input" type="file" accept=".csv,.tsv,.txt,text/csv"
                 onChange={alElegirArchivo} />
        </label>
        <button type="button" className="btn btn-secondary" onClick={exportar}
                disabled={items.length === 0}>
          Descargar el catálogo actual
        </button>
      </div>

      <label className="field">…o pegá acá las celdas copiadas de tu planilla
        <textarea className="input" rows={4} value={texto}
                  placeholder="nombre,precio,imagenUrl&#10;Pizza muzzarella,45,https://…"
                  onChange={(e) => analizar(e.target.value)} />
      </label>

      {previa?.error && <p className="alerta-importar" role="alert">{previa.error}</p>}

      {previa && !previa.error && (
        <>
          <p>
            <strong>{buenas}</strong> {buenas === 1 ? 'fila lista' : 'filas listas'} para importar
            {malas > 0 && <> · <strong>{malas}</strong> con problemas, que no se van a cargar</>}
          </p>
          <table className="table">
            <thead>
              <tr><th>Línea</th><th>Nombre</th><th>Precio</th><th>Foto</th><th>Estado</th></tr>
            </thead>
            <tbody>
              {previa.filas.slice(0, 200).map((f) => (
                <tr key={f.linea} className={f.problemas.length > 0 ? 'alerta' : ''}>
                  <td>{f.linea}</td>
                  <td><TextoSeguro valor={f.fila.nombre} maxLargo={80} /></td>
                  <td>{f.fila.precio === null
                    ? <span className="text-muted">A consultar</span>
                    : `${f.fila.precio} ${f.fila.moneda}`}</td>
                  <td><Miniatura url={f.fila.imagenUrl} /></td>
                  <td>
                    {f.problemas.length > 0
                      ? <span className="alerta-texto">{f.problemas.join('; ')}</span>
                      : f.advertencias.length > 0
                        ? <span className="text-muted">{f.advertencias.join('; ')}</span>
                        : 'Lista'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {previa.filas.length > 200 && (
            <p className="ayuda">Se muestran las primeras 200 filas; se importan todas.</p>
          )}
          <button type="button" className="btn btn-primary"
                  disabled={buenas === 0 || importando} onClick={() => void importar()}>
            {importando ? 'Importando…' : `Importar ${buenas} ${buenas === 1 ? 'ítem' : 'ítems'}`}
          </button>
        </>
      )}

      {estado && <p role="status">{estado}</p>}
    </details>
  );
}

/**
 * =============================================================================
 * «VER EL CATÁLOGO WEB» — ANDAMIO DE DEMOSTRACIÓN, NO UNA FUNCIÓN TERMINADA
 * =============================================================================
 *
 * PARA QUÉ EXISTE. En una demostración, la secuencia que vende es: se muestra la
 * lista de productos en la consola y, sin cambiar de tema, se abre la página que
 * ve el cliente. Hasta ahora eso obligaba a pegar una dirección a mano delante
 * del prospecto, que es exactamente el momento en que uno no quiere estar
 * buscando una URL.
 *
 * POR QUÉ NO ES LA VERSIÓN DEFINITIVA, dicho acá para que nadie lo confunda con
 * una función del producto. El catálogo público **exige una ficha por
 * conversación** (`catalogoWeb.ts`): sin una conversación de WhatsApp detrás no
 * hay ficha que emitir, y emitir una desde la consola le daría al comercio una
 * llave a una página que en producción solo debería abrir un cliente derivado
 * por el asistente. Lo correcto es un endpoint de VISTA PREVIA autenticado como
 * el administrador —que no cuente como conversación ni gaste una ficha— y eso
 * todavía no existe. Está anotado en `CATALOGO-WEB.md`.
 *
 * MIENTRAS TANTO, EL ENLACE SALE DE UNA VARIABLE DE ENTORNO Y NO DE UN CÁLCULO.
 * Sin `VITE_CATALOGO_DEMO_URL` no se pinta nada, así que la consola de un
 * cliente real no muestra ningún enlace por accidente: hay que ponerlo a
 * propósito, en la máquina donde se hace la demostración. Es la diferencia entre
 * un andamio que se ve y uno que se olvida puesto.
 *
 * Y SOLO CON EL FLUJO DE VENTA, como todo el catálogo web (DISENO.md
 * §4octies.0bis).
 */
function EnlaceAlCatalogoWeb({ conVenta }: { conVenta: boolean }) {
  const url = import.meta.env['VITE_CATALOGO_DEMO_URL'];
  if (!conVenta || typeof url !== 'string' || !url.startsWith('http')) return null;
  return (
    <p>
      {/* `noreferrer` además de `noopener`: la página del catálogo no tiene por
          qué enterarse de desde qué dirección de la consola se la abrió. */}
      <a href={url} target="_blank" rel="noopener noreferrer">
        Ver el catálogo web como lo ve un cliente ↗
      </a>
    </p>
  );
}
