import { useEffect, useMemo, useRef, useState } from 'react';
import {
  collection, deleteDoc, deleteField, doc, documentId, getDocs, increment, onSnapshot, orderBy,
  query, serverTimestamp, setDoc, updateDoc, where, writeBatch,
} from 'firebase/firestore';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { limiteDeProductos, nombreDePlan, planSiguiente } from '../lib/planes';
import { auth, db, funciones } from '../lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { TextoSeguro } from '../componentes/TextoSeguro';
import { etiquetaCatalogo, useFlujos } from '../lib/flujos';
import { mensajeDeFalla, prepararFoto } from '../lib/foto';
import {
  aCsv, idDeNombre, partirCsv, validarFilas, type FilaCatalogo, type FilaConProblemas,
} from '../lib/csv';
import { leerXlsxConAviso } from '../lib/xlsx';

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
 *
 * ELIMINAR, SOLO LO QUE YA ESTÁ DADO DE BAJA. Desde el 15/09 el plan fija
 * cuántos ítems caben (20 / 100 / 500) y el servidor cuenta TODOS los
 * documentos, activos o no: sin una forma de borrar, un comercio en el tope no
 * tendría cómo hacer lugar. Se borra en dos pasos —primero de baja, después
 * eliminar— para que nadie pierda un ítem con un clic.
 *
 * EL ALTA Y LA BAJA VAN EN UN LOTE CON EL CONTADOR (`contadores/catalogo`), y
 * es la única forma que la regla acepta: el ítem y `items: increment(±1)` se
 * escriben juntos o no se escribe ninguno. Es lo que deja al servidor contar
 * sin leer la colección entera en cada alta.
 *
 * HASTA 500 ÍTEMS SE FILTRAN EN EL NAVEGADOR. Quinientos documentos chicos son
 * menos de un mega y ya están en memoria por el `onSnapshot`; buscar y ordenar
 * sobre eso es instantáneo y no pide ningún índice de Firestore. Lo que NO se
 * trae entero son las fotos subidas (hasta 150 KB cada una): se piden las de
 * la página que se ve. Ver `useFotos`.
 */
interface Item {
  id: string; nombre?: unknown; descripcion?: unknown; area?: unknown;
  precio?: unknown; moneda?: unknown; duracionMin?: unknown; activo?: unknown;
  imagenUrl?: unknown; actualizadoEn?: unknown;
  /** Ausente = no lleva control de existencias. Ver `functions/src/inventario.ts`. */
  stock?: unknown;
}

/** Qué pasó con una fila al importar. */
interface Resultado {
  /** `parcial`: el ítem entró pero su cantidad no se pudo fijar. */
  estado: 'importada' | 'parcial' | 'omitida' | 'rechazada';
  /** Por qué no entró, o qué quedó a medias. Vacío cuando entró entero. */
  motivo?: string;
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
/**
 * Una dirección de foto que el navegador puede pintar y la CSP admite.
 *
 * DOS FORMAS, y las dos hacen falta: `https://` para la foto POR REFERENCIA que
 * el comercio ya tiene publicada, y `data:image/...` para la que SUBIÓ, que se
 * guarda incrustada en `fotosCatalogo`.
 *
 * Faltaba la segunda, y por eso una foto recién subida no se veía en NINGÚN
 * lado aunque estuviera guardada: el botón pasaba a decir «Cambiar foto» —o
 * sea, el documento existía— y la miniatura devolvía `null` sin decir por qué.
 * Un dato guardado que no se muestra es peor que uno que falla: no hay nada que
 * mirar para entender qué pasó. Lo vio Andres el 09/09.
 *
 * `http://` sigue fuera a propósito: el navegador del cliente lo bloquea por
 * contenido mixto y la foto no se vería igual, pero sin ningún aviso.
 */
const imagenValida = (url: string) => url === ''
  || /^https:\/\/[^ '"<>]+$/.test(url)
  || /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(url);

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

/* =============================================================================
   BUSCAR, FILTRAR, ORDENAR Y PAGINAR
   =============================================================================

   TODO VIVE EN LA URL (`?q=pizza&estado=activo&orden=precio&p=2`). Un comercio
   con 300 productos busca «pizza», edita una, se va a Pedidos y vuelve: sin la
   URL encontraría la lista entera otra vez y tendría que buscar de nuevo. Y
   una dirección se puede mandar por WhatsApp a quien carga el catálogo:
   «revisá estos», con el filtro puesto.

   La búsqueda NO distingue tildes ni mayúsculas: «jamon» encuentra «Jamón». Es
   como escribe la gente en el teléfono, y una búsqueda que exige la tilde
   parece rota. */

/** Filas por página. 50 se recorren sin perderse y no traban un teléfono. */
const POR_PAGINA = 50;

const ORDENES = [
  ['nombre', 'Nombre (A–Z)'],
  ['precio', 'Precio: de menor a mayor'],
  ['-precio', 'Precio: de mayor a menor'],
  ['stock', 'Existencias: lo que menos queda primero'],
  ['recientes', 'Recién modificados'],
] as const;
type Orden = typeof ORDENES[number][0];

interface Filtro {
  q: string;
  /** Área exacta; `-` = sin área; vacío = todas. */
  area: string;
  estado: '' | 'activo' | 'inactivo';
  foto: '' | 'con' | 'sin';
  stock: '' | 'agotado' | 'con' | 'sin-control';
  pmin: number | null;
  pmax: number | null;
  orden: Orden;
  pagina: number;
}

/** Lee el filtro de la URL. Un valor que no se conoce se ignora, no rompe. */
function leerFiltro(p: URLSearchParams): Filtro {
  const uno = <T extends string>(clave: string, validos: readonly T[]): T | '' => {
    const v = p.get(clave) ?? '';
    return (validos as readonly string[]).includes(v) ? v as T : '';
  };
  const numero = (clave: string): number | null => {
    const v = (p.get(clave) ?? '').trim();
    const n = Number(v);
    return v !== '' && Number.isFinite(n) && n >= 0 ? n : null;
  };
  const pagina = Number.parseInt(p.get('p') ?? '1', 10);
  return {
    q: (p.get('q') ?? '').slice(0, 80),
    area: (p.get('area') ?? '').slice(0, 40),
    estado: uno('estado', ['activo', 'inactivo'] as const),
    foto: uno('foto', ['con', 'sin'] as const),
    stock: uno('stock', ['agotado', 'con', 'sin-control'] as const),
    pmin: numero('pmin'),
    pmax: numero('pmax'),
    orden: uno('orden', ORDENES.map(([o]) => o)) || 'nombre',
    pagina: Number.isInteger(pagina) && pagina > 0 ? pagina : 1,
  };
}

/** Sin tildes y en minúscula, para comparar como compara una persona. */
const normalizar = (s: unknown) => String(s ?? '').normalize('NFD')
  .replace(/[̀-ͯ]/g, '').toLowerCase();

const milis = (v: unknown): number => (typeof v === 'object' && v !== null
  && typeof (v as { toMillis?: unknown }).toMillis === 'function'
  ? (v as { toMillis: () => number }).toMillis() : 0);

const numeroO = (v: unknown): number | null => (typeof v === 'number' ? v : null);

/** Lo que no tiene el dato va al final, en los dos sentidos: no es «cero». */
function compararNumeros(a: number | null, b: number | null, sentido: 1 | -1): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a - b) * sentido;
}

/**
 * Filtra y ordena. `fotosSubidas` solo hace falta para el filtro de foto: una
 * foto subida no está en el ítem sino en `fotosCatalogo`.
 */
function filtrarYOrdenar(
  items: Item[], f: Filtro, fotosSubidas: Record<string, string>, conStock: boolean,
): Item[] {
  const palabras = normalizar(f.q).split(/\s+/).filter(Boolean);
  const salida = items.filter((it) => {
    if (palabras.length > 0) {
      // El código es el identificador del documento: es lo que el comercio ve
      // en la exportación y lo que un funcionario tiene en su lista.
      const pajar = normalizar(`${it.nombre ?? ''} ${it.descripcion ?? ''} ${it.area ?? ''} ${it.id}`);
      if (!palabras.every((p) => pajar.includes(p))) return false;
    }
    const area = typeof it.area === 'string' ? it.area : '';
    if (f.area === '-' && area !== '') return false;
    if (f.area !== '' && f.area !== '-' && normalizar(area) !== normalizar(f.area)) return false;
    if (f.estado === 'activo' && it.activo !== true) return false;
    if (f.estado === 'inactivo' && it.activo === true) return false;
    if (f.foto !== '') {
      const tiene = Boolean(fotosSubidas[it.id])
        || (typeof it.imagenUrl === 'string' && it.imagenUrl !== '');
      if ((f.foto === 'con') !== tiene) return false;
    }
    // El filtro de existencias solo cuenta si el catálogo lleva stock: si no,
    // no hay control en pantalla para sacarlo y dejaría la lista vacía sin
    // explicación.
    if (conStock && f.stock !== '') {
      const s = numeroO(it.stock);
      if (f.stock === 'sin-control' && s !== null) return false;
      if (f.stock === 'agotado' && (s === null || s > 0)) return false;
      if (f.stock === 'con' && (s === null || s <= 0)) return false;
    }
    if (f.pmin !== null || f.pmax !== null) {
      // Con un rango puesto, «a consultar» no entra: no tiene precio que comparar.
      const precio = numeroO(it.precio);
      if (precio === null) return false;
      if (f.pmin !== null && precio < f.pmin) return false;
      if (f.pmax !== null && precio > f.pmax) return false;
    }
    return true;
  });
  const porNombre = (a: Item, b: Item) => String(a.nombre ?? '')
    .localeCompare(String(b.nombre ?? ''), 'es', { sensitivity: 'base', numeric: true });
  const criterio: Record<Orden, (a: Item, b: Item) => number> = {
    nombre: porNombre,
    precio: (a, b) => compararNumeros(numeroO(a.precio), numeroO(b.precio), 1),
    '-precio': (a, b) => compararNumeros(numeroO(a.precio), numeroO(b.precio), -1),
    stock: (a, b) => compararNumeros(numeroO(a.stock), numeroO(b.stock), 1),
    recientes: (a, b) => milis(b.actualizadoEn) - milis(a.actualizadoEn),
  };
  return salida.sort((a, b) => criterio[f.orden](a, b) || porNombre(a, b));
}

/**
 * Las fotos SUBIDAS, que viven en `fotosCatalogo` y no dentro del ítem: el ítem
 * lo lee también `configuracionFlujo`, en la ruta de CADA mensaje de WhatsApp,
 * y con la foto adentro un catálogo de 40 ítems mandaría varios megas.
 *
 * SOLO LAS DE LA PÁGINA QUE SE VE. Antes se escuchaba la colección entera, que
 * con 20 ítems da igual y con 500 son hasta 75 MB bajando al teléfono para
 * mostrar 50 miniaturas. Ahora se piden por identificador, de a 30 (el tope de
 * `in` en Firestore). `'todas'` se usa solo para el filtro de foto, que
 * necesita saber de cada ítem si tiene una; `null`, para no pedir nada.
 */
function useFotos(tenantId: string, ids: string[] | 'todas' | null): Record<string, string> {
  const [fotos, setFotos] = useState<Record<string, string>>({});
  const clave = ids === null ? '' : ids === 'todas' ? '*' : JSON.stringify(ids);
  useEffect(() => {
    if (!tenantId || clave === '') return;
    const coleccion = collection(db, 'tenants', tenantId, 'fotosCatalogo');
    const dato = (d: { data: () => unknown }) =>
      String((d.data() as { datos?: unknown }).datos ?? '');
    if (clave === '*') {
      return onSnapshot(coleccion,
        (s) => setFotos(Object.fromEntries(s.docs.map((d) => [d.id, dato(d)]))), () => {});
    }
    const lista = JSON.parse(clave) as string[];
    const bajas: (() => void)[] = [];
    for (let i = 0; i < lista.length; i += 30) {
      const trozo = lista.slice(i, i + 30);
      bajas.push(onSnapshot(query(coleccion, where(documentId(), 'in', trozo)), (s) => {
        setFotos((previas) => {
          // Se borran primero las del trozo: una foto que se quitó no vuelve
          // en la instantánea, y sin esto seguiría pintada.
          const n = { ...previas };
          for (const id of trozo) delete n[id];
          for (const d of s.docs) n[d.id] = dato(d);
          return n;
        });
      }, () => {}));
    }
    return () => bajas.forEach((b) => b());
  }, [tenantId, clave]);
  return fotos;
}

function Paginador({ pagina, paginas, onIr }: {
  pagina: number; paginas: number; onIr: (p: number) => void;
}) {
  if (paginas <= 1) return null;
  return (
    <nav className="paginador" aria-label="Páginas del catálogo">
      <button type="button" className="btn btn-ghost btn-chico" disabled={pagina <= 1}
              onClick={() => onIr(pagina - 1)}>← Anterior</button>
      <span>Página {pagina} de {paginas}</span>
      <button type="button" className="btn btn-ghost btn-chico" disabled={pagina >= paginas}
              onClick={() => onIr(pagina + 1)}>Siguiente →</button>
    </nav>
  );
}

/** El código de error de Firebase, sin suponer la forma del objeto. */
function codigoDe(e: unknown): string {
  return typeof e === 'object' && e !== null && typeof (e as { code?: unknown }).code === 'string'
    ? (e as { code: string }).code : '';
}

/**
 * El contador que la regla exige tocar junto con cada alta y cada baja. Si no
 * existe, el lote falla con `not-found`: es un problema de la cuenta, no de lo
 * que escribió el comercio, y se dice así.
 */
const contadorDe = (tenantId: string) => doc(db, 'tenants', tenantId, 'contadores', 'catalogo');

const SIN_CONTADOR = 'Falta el contador que lleva la cuenta de tu catálogo. No es un '
  + 'problema de tus datos: avísanos desde Reclamos y lo arreglamos.';

/* =============================================================================
   USO DEL PLAN
   =============================================================================

   «37 de 100 productos (plan Crecimiento)». La cifra es la del CONTADOR del
   servidor, que es contra la que decide la regla; si todavía no hay contador,
   la cantidad de ítems cargados.

   TRES ESTADOS, y el del medio es el que importa: al 90 % se avisa ANTES de
   que el comercio descubra el tope con un botón que no anda. En el tope, el
   botón se deshabilita con el porqué al lado y la salida: hacer lugar o pasar
   de plan. Deshabilitarlo no protege nada —la que manda es la regla—; existe
   para que nadie choque contra un error. */
function UsoDelPlan({ usados, limite, plan, unidad, tenantId }: {
  usados: number; limite: number; plan: unknown; unidad: string; tenantId: string;
}) {
  const nombre = nombreDePlan(plan);
  const siguiente = planSiguiente(plan);
  const lleno = usados >= limite;
  const cerca = !lleno && usados >= Math.ceil(limite * 0.9);
  const ancho = limite > 0 ? Math.min(100, Math.round((usados * 100) / limite)) : 100;
  const quedan = limite - usados;
  return (
    <div className={`uso-plan${lleno ? ' uso-plan-lleno' : cerca ? ' uso-plan-cerca' : ''}`}>
      <p className="uso-plan-cifra">
        <strong>{usados} de {limite} {unidad}</strong>
        {nombre && <> (plan {nombre})</>}
      </p>
      <div className="uso-plan-barra" role="progressbar" aria-label={`${unidad} del plan en uso`}
           aria-valuemin={0} aria-valuemax={limite} aria-valuenow={Math.min(usados, limite)}>
        <span style={{ width: `${ancho}%` }} />
      </div>
      {lleno && (
        <p className="ayuda">
          <strong>Llegaste al tope de tu plan</strong>: no se pueden agregar {unidad} nuevos.
          Editar los que ya tienes sigue funcionando. Para hacer lugar, elimina los
          que ya diste de baja
          {siguiente && <>, o pasa al plan {siguiente.nombre}, que admite hasta {siguiente.productos}</>}.
        </p>
      )}
      {cerca && (
        <p className="ayuda">
          Te {quedan === 1 ? 'queda 1 lugar' : `quedan ${quedan} lugares`}.
          {siguiente && <> Si vas a necesitar más, el plan {siguiente.nombre} admite
            hasta {siguiente.productos} {unidad}.</>}
        </p>
      )}
      {(lleno || cerca) && siguiente && (
        <p className="ayuda">
          Para cambiar de plan, escríbenos desde{' '}
          <Link to={`/negocio/${encodeURIComponent(tenantId)}/reclamos`}>Reclamos</Link> con la
          categoría <em>Facturación</em>.
        </p>
      )}
    </div>
  );
}

export function Catalogo() {
  const { tenantId = '' } = useParams();
  const flujos = useFlujos(tenantId) ?? [];
  const conAgenda = flujos.includes('agendamiento');
  const conVenta = flujos.includes('venta');
  const [items, setItems] = useState<Item[] | null>(null);
  const [veredictos, setVeredictos] = useState<Record<string, Veredicto>>({});
  const [nuevo, setNuevo] = useState(NUEVO);
  /** Lo que pasó con una acción sobre la tabla. Se pinta ARRIBA de la tabla. */
  const [estado, setEstado] = useState<string | null>(null);
  /** Lo que pasó con el alta. Se pinta al lado del botón «Agregar». */
  const [estadoAlta, setEstadoAlta] = useState<string | null>(null);
  /** Identificador del ítem que se está editando en su fila, o `null`. */
  const [editando, setEditando] = useState<string | null>(null);
  /** Ítem dado de baja cuya eliminación se está confirmando, o `null`. */
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [borrador, setBorrador] = useState({
    area: '', precio: '', moneda: 'BOB', duracionMin: '30', descripcion: '', imagenUrl: '',
  });
  const [cuenta, setCuenta] = useState<Record<string, unknown> | null>(null);
  const [contador, setContador] = useState<number | null>(null);
  const [params, setParams] = useSearchParams();
  const filtro = leerFiltro(params);

  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(query(collection(db, 'tenants', tenantId, 'catalogo'), orderBy('nombre')),
      // `estimate`: un ítem recién guardado trae su hora al instante y no
      // salta al final de «recién modificados» hasta que confirme el servidor.
      (i) => setItems(i.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))),
      () => setEstado('No se pudo leer el catálogo.'));
  }, [tenantId]);

  // El plan y sus límites. Si no se puede leer, rige el respaldo más chico:
  // la pantalla avisa de menos antes que prometer de más.
  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(doc(db, 'tenants', tenantId, 'cuenta', 'estado'),
      (d) => setCuenta(d.data() ?? {}), () => setCuenta(null));
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(contadorDe(tenantId), (d) => {
      const n = d.get('items');
      setContador(typeof n === 'number' ? n : null);
    }, () => setContador(null));
  }, [tenantId]);

  const todos = useMemo(() => items ?? [], [items]);
  const conStock = useMemo(() => todos.some((i) => typeof i.stock === 'number'), [todos]);
  const areas = useMemo(() => [...new Set(todos
    .map((i) => (typeof i.area === 'string' ? i.area.slice(0, 40) : ''))
    .filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')), [todos]);
  const haySinArea = todos.some((i) => typeof i.area !== 'string' || i.area === '');

  // Dos pedidos de fotos que no se pisan: todas, solo si hay filtro de foto;
  // las de la página, en cualquier otro caso.
  const fotosTodas = useFotos(tenantId, filtro.foto !== '' ? 'todas' : null);
  const filtrados = useMemo(
    () => filtrarYOrdenar(todos, filtro, fotosTodas, conStock),
    // `filtro` se reconstruye en cada render: la dependencia real es la URL.
    [todos, params, fotosTodas, conStock]);
  const paginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));
  const pagina = Math.min(filtro.pagina, paginas);
  const desde = (pagina - 1) * POR_PAGINA;
  const visibles = filtrados.slice(desde, desde + POR_PAGINA);
  const fotosPagina = useFotos(tenantId, filtro.foto !== '' ? null : visibles.map((i) => i.id));
  const fotos = filtro.foto !== '' ? fotosTodas : fotosPagina;

  const hayFiltros = filtro.q !== '' || filtro.area !== '' || filtro.estado !== ''
    || filtro.foto !== '' || (conStock && filtro.stock !== '')
    || filtro.pmin !== null || filtro.pmax !== null;

  /**
   * Cambia parámetros de la URL. Cualquier cambio de filtro vuelve a la página
   * 1: quedarse en la 4 de un resultado que ahora tiene una sola es una
   * pantalla vacía sin razón. Lo que se escribe en la búsqueda REEMPLAZA la
   * entrada del historial: si no, «atrás» desharía letra por letra.
   */
  const cambiar = (cambios: Record<string, string>, reemplazar = false) => {
    setParams((previos) => {
      const p = new URLSearchParams(previos);
      for (const [k, v] of Object.entries(cambios)) {
        if (v === '' || (k === 'orden' && v === 'nombre') || (k === 'p' && v === '1')) p.delete(k);
        else p.set(k, v);
      }
      if (!('p' in cambios)) p.delete('p');
      return p;
    }, { replace: reemplazar });
  };
  const limpiar = () => cambiar({
    q: '', area: '', estado: '', foto: '', stock: '', pmin: '', pmax: '',
  });

  const titulo = etiquetaCatalogo(flujos);
  const unidad = titulo === 'Servicios' ? 'servicios' : 'productos';
  const usados = Math.max(0, contador ?? todos.length);
  const limite = limiteDeProductos(cuenta);
  const lleno = usados >= limite;

  // Los veredictos de las fotos, en una colección aparte que el comercio lee y
  // no escribe. Su error NO se muestra: es información adicional, y una consola
  // que grita porque no pudo leer un adorno distrae de lo que sí importa.
  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(collection(db, 'tenants', tenantId, 'comprobacionesImagen'),
      (s) => setVeredictos(Object.fromEntries(s.docs.map((d) => [d.id, d.data() as Veredicto]))),
      () => {});
  }, [tenantId]);

  /**
   * Volver a comprobar una foto. Existe porque la primera comprobación puede
   * fallar por algo pasajero —el servidor de la foto caído un minuto— y sin
   * esto el único modo de reintentar sería borrar la dirección y reescribirla.
   */
  const revisarFoto = async (itemId: string) => {
    setEstado(null);
    try {
      await httpsCallable(funciones, 'recomprobarImagen')({ tenantId, itemId });
    } catch {
      setEstado('No se pudo volver a comprobar la foto. Intente en un momento.');
    }
  };

  const sello = () => ({ actualizadoPor: auth.currentUser?.uid ?? '', actualizadoEn: serverTimestamp() });

  const agregar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setEstadoAlta(null);
    const sinPrecio = nuevo.precio.trim() === '';
    const precio = Number(nuevo.precio);
    const duracionMin = Number(nuevo.duracionMin);
    if (lleno) {
      setEstadoAlta(`Tu plan admite ${limite} ${unidad} y ya tienes ${usados}. `
        + 'Arriba de la tabla está cómo hacer lugar.'); return;
    }
    if (!nuevo.nombre.trim()) { setEstadoAlta('El nombre es obligatorio.'); return; }
    if (!sinPrecio && (!Number.isFinite(precio) || precio < 0)) {
      setEstadoAlta('El precio tiene que ser un número de cero para arriba, o quedar vacío.'); return;
    }
    if (conAgenda && (!Number.isInteger(duracionMin) || duracionMin <= 0 || duracionMin % 15 !== 0)) {
      setEstadoAlta('La duración va en múltiplos de 15 minutos.'); return;
    }
    if (!imagenValida(nuevo.imagenUrl.trim())) {
      setEstadoAlta('La foto tiene que ser una dirección https. Una http la bloquea '
        + 'el navegador del cliente y no se ve nada.'); return;
    }
    // Identificador legible y estable a partir del nombre: es lo que el flujo
    // muestra y lo que un funcionario referencia en `servicios`. La MISMA
    // función que usa la importación, para que un ítem cargado a mano y el
    // mismo ítem en una planilla sean el mismo documento.
    const id = idDeNombre(nuevo.nombre) || `item-${Date.now()}`;
    // ANTES ESTO PISABA SIN AVISAR: `setDoc` sobre un nombre que ya existía
    // reemplazaba el ítem entero, precio y foto incluidos. Ahora, además, el
    // lote sumaría uno al contador por algo que no es nuevo.
    if (todos.some((i) => i.id === id)) {
      setEstadoAlta('Ya hay un ítem con ese nombre (o con uno que se escribe casi igual). '
        + 'Para cambiarlo, usa «Editar» en su fila.'); return;
    }
    try {
      const lote = writeBatch(db);
      lote.set(doc(db, 'tenants', tenantId, 'catalogo', id), {
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
      lote.update(contadorDe(tenantId), {
        items: increment(1), ultimoItem: id, actualizadoEn: serverTimestamp(),
      });
      await lote.commit();
      setNuevo(NUEVO);
      setEstadoAlta('Agregado. El asistente lo ofrece desde ahora.');
    } catch (e) {
      const codigo = codigoDe(e);
      // `permission-denied` no dice CUÁL condición falló —Firestore no manda el
      // motivo al navegador—, así que se nombran las dos que pueden ser, sin
      // inventar cuál fue.
      setEstadoAlta(codigo === 'not-found' ? SIN_CONTADOR
        : codigo === 'permission-denied'
          ? 'El servidor no aceptó el alta. Revisa el precio, la duración y la foto. '
            + `Si están bien, puede que el catálogo haya llegado al tope de tu plan (${limite} `
            + `${unidad}) desde otra pestaña o persona: recarga la página para ver la cuenta al día.`
          : codigo === 'unavailable'
            ? 'No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.'
            : 'No se pudo agregar. Inténtalo de nuevo en un momento.');
    }
  };

  /**
   * Eliminar del todo un ítem dado de baja: libera un lugar del plan.
   *
   * El ítem y el contador van en el MISMO lote: si el contador no bajara, el
   * lugar no se liberaría nunca y el comercio quedaría en el tope con menos
   * ítems de los que dice la pantalla. La foto subida se borra después y aparte:
   * si eso fallara, queda un documento huérfano que no se ve ni se cuenta.
   */
  const eliminar = async (it: Item) => {
    setEstado(null);
    setConfirmando(null);
    try {
      const lote = writeBatch(db);
      lote.delete(doc(db, 'tenants', tenantId, 'catalogo', it.id));
      lote.update(contadorDe(tenantId), {
        items: increment(-1), ultimoItem: it.id, actualizadoEn: serverTimestamp(),
      });
      await lote.commit();
      void deleteDoc(doc(db, 'tenants', tenantId, 'fotosCatalogo', it.id)).catch(() => {});
      setEstado(`Eliminado. Se liberó un lugar de tu plan.`);
    } catch (e) {
      setEstado(codigoDe(e) === 'not-found' ? SIN_CONTADOR
        : 'No se pudo eliminar. Inténtalo de nuevo en un momento.');
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

  return (
    <section>
      <h2>{titulo}</h2>
      <p className="ayuda">
        Lo que el asistente puede ofrecer y a qué precio. <strong>Si no está acá,
        el asistente dice que no lo tiene</strong>: no inventa ni precios ni
        {conAgenda ? ' servicios' : ' productos'}. Dar de baja un ítem lo saca
        de la oferta sin borrar su historial.
      </p>

      <VistaPrevia tenantId={tenantId} conVenta={conVenta} />

      {items !== null && (
        <UsoDelPlan usados={usados} limite={limite} plan={cuenta?.['plan']}
                    unidad={unidad} tenantId={tenantId} />
      )}

      {items === null ? <p>Cargando…</p> : items.length === 0 ? (
        <p className="vacio">Todavía no hay nada cargado. Sin esto el asistente conversa, pero no ofrece nada concreto.</p>
      ) : (
        <>
        <div className="filtros filtros-catalogo" role="search">
          <label>Buscar
            <input className="input" type="search" maxLength={80} value={filtro.q}
                   placeholder="nombre, descripción, código o área"
                   onChange={(e) => cambiar({ q: e.target.value }, true)} />
          </label>
          {(areas.length > 0) && (
            <label>Área
              <select className="input" value={filtro.area}
                      onChange={(e) => cambiar({ area: e.target.value })}>
                <option value="">Todas</option>
                {areas.map((a) => <option key={a} value={a}>{a}</option>)}
                {haySinArea && <option value="-">Sin área</option>}
              </select>
            </label>
          )}
          <label>Estado
            <select className="input" value={filtro.estado}
                    onChange={(e) => cambiar({ estado: e.target.value })}>
              <option value="">Todos</option>
              <option value="activo">Se ofrece</option>
              <option value="inactivo">Dado de baja</option>
            </select>
          </label>
          <label>Foto
            <select className="input" value={filtro.foto}
                    onChange={(e) => cambiar({ foto: e.target.value })}>
              <option value="">Con y sin foto</option>
              <option value="con">Con foto</option>
              <option value="sin">Sin foto</option>
            </select>
          </label>
          {conStock && (
            <label>Existencias
              <select className="input" value={filtro.stock}
                      onChange={(e) => cambiar({ stock: e.target.value })}>
                <option value="">Todas</option>
                <option value="agotado">Agotado</option>
                <option value="con">Con stock</option>
                <option value="sin-control">Sin control de stock</option>
              </select>
            </label>
          )}
          <label>Precio desde
            <input className="input" type="number" min={0} step="0.01"
                   value={params.get('pmin') ?? ''}
                   onChange={(e) => cambiar({ pmin: e.target.value }, true)} />
          </label>
          <label>hasta
            <input className="input" type="number" min={0} step="0.01"
                   value={params.get('pmax') ?? ''}
                   onChange={(e) => cambiar({ pmax: e.target.value }, true)} />
          </label>
          <label>Ordenar por
            <select className="input" value={filtro.orden}
                    onChange={(e) => cambiar({ orden: e.target.value })}>
              {ORDENES.map(([o, t]) => <option key={o} value={o}>{t}</option>)}
            </select>
          </label>
          {hayFiltros && (
            <button type="button" className="btn btn-ghost" onClick={limpiar}>Limpiar filtros</button>
          )}
        </div>

        <div className="catalogo-barra">
          <p className="catalogo-contador" aria-live="polite">
            {filtrados.length === 0
              ? 'Nada coincide con la búsqueda.'
              : `Mostrando ${desde + 1}–${desde + visibles.length} de ${filtrados.length}`}
            {hayFiltros && ` (hay ${todos.length} en total)`}
          </p>
          <Paginador pagina={pagina} paginas={paginas}
                     onIr={(p) => cambiar({ p: String(p) })} />
        </div>

        {estado && <p role="status" className="ayuda aviso-datos">{estado}</p>}

        {filtrados.length === 0 ? (
          <p className="vacio">
            Ningún ítem coincide con lo que buscas.{' '}
            <button type="button" className="enlace" onClick={limpiar}>Limpiar filtros</button>
          </p>
        ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Nombre</th><th>Área</th><th>Precio</th>
              {conAgenda && <th>Duración</th>}
              {conStock && <th>Existencias</th>}
              <th>Estado</th><th />
            </tr>
          </thead>
          <tbody>
            {visibles.map((it) => (editando === it.id ? (
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
                {conStock && <td><Existencias stock={it.stock} /></td>}
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
                    <Miniatura url={fotos[it.id] || it.imagenUrl} />
                    <div>
                      <TextoSeguro valor={it.nombre} maxLargo={80} />
                      {typeof it.descripcion === 'string' && it.descripcion !== '' && (
                        <div className="text-muted"><TextoSeguro valor={it.descripcion} maxLargo={300} /></div>
                      )}
                      <EstadoFoto v={veredictos[it.id]} onRevisar={() => void revisarFoto(it.id)} />
                      <SubirFoto tenantId={tenantId} itemId={it.id}
                                 tieneFoto={Boolean(fotos[it.id])} onEstado={setEstado} />
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
                {conStock && <td><Existencias stock={it.stock} /></td>}
                <td>{it.activo === true ? 'Se ofrece' : 'Dado de baja'}</td>
                <td>
                  <button type="button" className="btn btn-ghost" onClick={() => empezarAEditar(it)}>Editar</button>
                  <button type="button" className="btn btn-ghost" onClick={() => void alternar(it)}>
                    {it.activo === true ? 'Dar de baja' : 'Volver a ofrecer'}
                  </button>
                  {/* ELIMINAR SOLO APARECE EN LO DADO DE BAJA, y pide
                      confirmación en la misma fila. Es lo único de esta
                      pantalla que no se deshace. */}
                  {it.activo !== true && (confirmando === it.id ? (
                    <span className="confirmar-baja">
                      ¿Eliminar del todo? No se puede deshacer.{' '}
                      <button type="button" className="btn btn-ghost btn-chico"
                              onClick={() => void eliminar(it)}>Sí, eliminar</button>
                      <button type="button" className="btn btn-ghost btn-chico"
                              onClick={() => setConfirmando(null)}>No</button>
                    </span>
                  ) : (
                    <button type="button" className="btn btn-ghost" title="Libera un lugar de tu plan"
                            onClick={() => setConfirmando(it.id)}>Eliminar</button>
                  ))}
                </td>
              </tr>
            )))}
          </tbody>
        </table>
        )}
        <Paginador pagina={pagina} paginas={paginas} onIr={(p) => cambiar({ p: String(p) })} />
        </>
      )}

      <ImportarCatalogo tenantId={tenantId} conAgenda={conAgenda} items={todos}
                        usados={usados} limite={limite} unidad={unidad} />

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
          la muestra desde donde está. Si la borras de allá, deja de verse acá.
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
          Ojo si tienes el <strong>catálogo web</strong> encendido: lo que quede
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
        {/* Deshabilitado EN EL TOPE, con el porqué al lado: un botón gris sin
            explicación se lee como que la consola se colgó. */}
        <button type="submit" className="btn btn-primary" disabled={lleno}>Agregar</button>
        {lleno && (
          <p className="ayuda">
            No se puede agregar: tu plan admite {limite} {unidad} y ya tienes {usados}.
            Arriba de la tabla está cómo hacer lugar o cambiar de plan.
          </p>
        )}
        {estadoAlta && <p role="status" className="ayuda aviso-datos">{estadoAlta}</p>}
      </form>
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
/**
 * =============================================================================
 * EL VEREDICTO DE LA FOTO
 * =============================================================================
 *
 * Lo escribe el servidor en `comprobacionesImagen` y acá SOLO SE LEE: el
 * comercio no puede escribirlo (`firestore.rules`), porque un sello de
 * verificación que puede firmar el verificado no vale nada.
 *
 * DOS AVISOS QUE NO SON LO MISMO, y se dicen distinto a propósito:
 *
 *  - «No se ve la foto» es un HECHO. La dirección no responde, o no devuelve
 *    una imagen. Se dice sin vueltas, porque el cliente vería un cuadro roto.
 *  - «No parece corresponder» es una OPINIÓN de un modelo. Se dice como
 *    opinión, con su motivo, y NO impide guardar. Un falso negativo —una foto
 *    legítima de silpancho que el modelo no reconoce— no puede dejar a un
 *    comercio sin publicar algo que está bien. Es la misma regla que con el
 *    comprobante de pago: el OCR coteja, no acredita.
 *
 * Cuando todo está bien no se dice NADA. Una fila de tildes verdes en doscientos
 * productos no informa: solo enseña a no mirar.
 */
const FALLAS: Record<string, string> = {
  no_es_https: 'la dirección tiene que empezar con https://',
  destino_privado: 'esa dirección no es pública',
  no_responde: 'la dirección no responde',
  no_es_imagen: 'lo que hay ahí no es una imagen',
  demasiado_grande: 'la imagen pesa más de 4 MB',
  demasiados_saltos: 'la dirección rebota demasiadas veces',
};

interface Veredicto {
  cargable?: unknown; falla?: unknown;
  parecido?: { coincide?: unknown; motivo?: unknown } | undefined;
}

function EstadoFoto({ v, onRevisar }: { v: Veredicto | undefined; onRevisar: () => void }) {
  if (!v) return null;
  if (v.cargable !== true) {
    const motivo = FALLAS[String(v.falla ?? '')] ?? 'no se pudo comprobar';
    return (
      <p className="ayuda foto-mal">
        <strong>No se ve la foto</strong>: {motivo}.{' '}
        <button type="button" className="enlace" onClick={onRevisar}>Volver a comprobar</button>
      </p>
    );
  }
  if (v.parecido && v.parecido.coincide === false) {
    return (
      <p className="ayuda foto-dudosa">
        <strong>Esta foto no parece corresponder</strong>
        {typeof v.parecido.motivo === 'string' && v.parecido.motivo !== ''
          ? <>: <TextoSeguro valor={v.parecido.motivo} maxLargo={200} /></>
          : '.'}{' '}
        Revísala; si es la correcta, déjala como está.{' '}
        <button type="button" className="enlace" onClick={onRevisar}>Volver a comprobar</button>
      </p>
    );
  }
  return null;
}

/**
 * =============================================================================
 * SUBIR UNA FOTO
 * =============================================================================
 *
 * Conviven dos caminos y no es indecisión: el ENLACE sirve al comercio que ya
 * tiene sus fotos publicadas —una tienda con su web, un restaurante con su
 * Instagram— y no quiere una segunda copia que después se le desactualice. La
 * SUBIDA sirve al que saca la foto con el teléfono en ese momento, que es la
 * mayoría. Obligar a los segundos a publicar la foto en algún lado primero era
 * pedirles que no usaran el producto.
 *
 * LA FOTO SE ENCOGE EN EL NAVEGADOR ANTES DE SUBIR (`lib/foto.ts`): el archivo
 * original nunca sale del teléfono, no se gastan los datos móviles del comercio
 * en subir ocho megas para tirarlos, y lo que se guarda entra en un documento
 * de Firestore con aire de sobra.
 *
 * SI HAY LAS DOS, MANDA LA SUBIDA. Es la que el comercio eligió último y la que
 * no puede romperse sola: una dirección ajena deja de responder el día que el
 * comercio reordena su sitio, y nadie se entera hasta que un cliente ve el
 * cuadro roto.
 */
function SubirFoto({ tenantId, itemId, tieneFoto, onEstado }: {
  tenantId: string; itemId: string; tieneFoto: boolean; onEstado: (m: string | null) => void;
}) {
  const [trabajando, setTrabajando] = useState(false);
  const [problema, setProblema] = useState<string | null>(null);

  const elegir = async (archivo: File | undefined) => {
    if (!archivo) return;
    onEstado(null);
    setProblema(null);
    setTrabajando(true);
    try {
      const r = await prepararFoto(archivo);
      if (!r.ok) { setProblema(mensajeDeFalla(r.falla)); return; }
      await setDoc(doc(db, 'tenants', tenantId, 'fotosCatalogo', itemId), {
        datos: r.foto.datos, ancho: r.foto.ancho, alto: r.foto.alto,
        bytes: r.foto.bytes, tipo: r.foto.tipo,
        actualizadoPor: auth.currentUser?.uid ?? '', actualizadoEn: serverTimestamp(),
      });
      onEstado(`Foto guardada (${Math.round(r.foto.bytes / 1024)} KB, `
        + `${r.foto.ancho}×${r.foto.alto}).`);
    } catch {
      setProblema('El servidor rechazó la foto. Intente con otra.');
    } finally {
      setTrabajando(false);
    }
  };

  return (
    <span className="subir-foto">
      <label className="btn btn-secondary btn-chico">
        {trabajando ? 'Preparando…' : tieneFoto ? 'Cambiar foto' : 'Subir foto'}
        <input type="file" accept="image/*" disabled={trabajando} hidden
               onChange={(e) => { void elegir(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
      {/* EL ERROR SE DICE ACÁ, al lado del botón que se apretó. Antes iba al
          `estado` de la pantalla, que se pinta al final de una tabla de veinte
          filas: se elegía una foto, fallaba, y no pasaba nada visible. Un
          mensaje que hay que ir a buscar es un mensaje que no existe. */}
      {problema && <span className="foto-mal">{problema}</span>}
      {tieneFoto && (
        <button type="button" className="btn btn-ghost btn-chico" onClick={() => {
          void deleteDoc(doc(db, 'tenants', tenantId, 'fotosCatalogo', itemId));
        }}>Quitar</button>
      )}
    </span>
  );
}

/**
 * Existencias de un ítem, de solo lectura: la cantidad se mueve desde
 * Inventario (`ajustarStock`), nunca desde esta tabla.
 */
function Existencias({ stock }: { stock: unknown }) {
  if (typeof stock !== 'number') return <span className="text-muted">No lleva</span>;
  if (stock <= 0) return <span className="alerta-texto">Agotado</span>;
  return <>{stock}</>;
}

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
function ImportarCatalogo({ tenantId, conAgenda, items, usados, limite, unidad }: {
  tenantId: string; conAgenda: boolean; items: Item[];
  /** Cuenta del plan, para avisar ANTES de importar si no entra todo. */
  usados: number; limite: number; unidad: string;
}) {
  /** Lo que ya existe se EDITA; lo que no, es un ALTA y cuenta contra el plan. */
  const existentes = useMemo(() => new Set(items.map((i) => i.id)), [items]);
  /**
   * LA MONEDA SALE DE LA CONFIGURACIÓN DEL NEGOCIO, no del archivo.
   *
   * Es un parámetro del comercio —una panadería no vende el pan en bolivianos y
   * la torta en dólares—, así que pedirla por fila es pedir un dato que ya se
   * tiene, y cada dato que se pide de más es una columna que alguien llena mal.
   */
  const [moneda, setMoneda] = useState<'BOB' | 'USD'>('BOB');
  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(doc(db, 'tenants', tenantId, 'config', 'negocio'),
      (d) => setMoneda(d.data()?.['moneda'] === 'USD' ? 'USD' : 'BOB'),
      () => setMoneda('BOB'));
  }, [tenantId]);

  const [texto, setTexto] = useState('');
  const [previa, setPrevia] = useState<{
    filas: FilaConProblemas[]; columnas: string[]; error: string | null;
  } | null>(null);
  const [estado, setEstado] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);
  /**
   * Qué pasó con cada fila, DESPUÉS de importar. `null` mientras no se importó.
   *
   * Antes esto no existía: al terminar solo se decía «listo, N ítems», y si el
   * servidor rechazaba algo, «puede haber quedado a medias». El comercio se
   * quedaba sin saber QUÉ fila corregir, que es lo único que necesita saber.
   */
  const [resultados, setResultados] = useState<Map<number, Resultado> | null>(null);
  /**
   * Las fotos pegadas en el Excel, por número de línea de la vista previa.
   *
   * Se guardan en memoria entre leer el archivo e importar: recortarlas y
   * subirlas al leer sería trabajo tirado si el comercio mira la vista previa y
   * decide no importar.
   */
  const [fotosDelArchivo, setFotosDelArchivo] =
    useState<Map<number, { tipo: string; bytes: Uint8Array }>>(new Map());
  const archivo = useRef<HTMLInputElement>(null);

  const analizar = (contenido: string) => {
    setEstado(null);
    setResultados(null);
    setFotosDelArchivo(new Map());
    setTexto(contenido);
    const r = validarFilas(partirCsv(contenido), conAgenda, moneda);
    setPrevia(r);
    avisarSiTraeMoneda(r.columnas);
  };

  /**
   * Si el archivo trae una columna de moneda, se ignora Y SE DICE.
   *
   * Ignorarla en silencio sería peor que no aceptarla: alguien que puso «USD»
   * en veinte filas tiene que enterarse de que no sirvió, no descubrirlo por el
   * precio que le dice el asistente a un cliente.
   */
  const avisarSiTraeMoneda = (columnas: string[]) => {
    if (!columnas.includes('moneda')) return;
    setEstado(`Tu archivo trae una columna de moneda: se ignoró. La moneda es de `
      + `todo el negocio y hoy es ${moneda === 'USD' ? 'dólares' : 'bolivianos'}; `
      + 'se cambia en Configuración, no producto por producto.');
  };

  const alElegirArchivo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setEstado(null);
    setResultados(null);
    // Tope de tamaño. Un catálogo de quinientos ítems no llega a 200 KB en CSV;
    // en Excel pesa más por el formato, y MUCHO más si trae fotos pegadas
    // adentro — que es justo el caso frecuente. Cinco megas dejan pasar eso sin
    // que el navegador de un teléfono se cuelgue leyendo un archivo enorme.
    if (f.size > 5_000_000) {
      setEstado('Ese archivo es demasiado grande para ser un catálogo. ¿Seguro que es el correcto?');
      return;
    }

    // SE MIRA EL CONTENIDO, NO LA EXTENSIÓN. Un `.xlsx` empieza con `PK`
    // —es un ZIP— y eso es cierto aunque alguien lo haya renombrado a `.csv`,
    // que pasa más de lo que uno cree cuando la gente «guarda como».
    const cabecera = new Uint8Array(await f.slice(0, 2).arrayBuffer());
    const esZip = cabecera[0] === 0x50 && cabecera[1] === 0x4b;

    if (!esZip) { analizar(await f.text()); return; }

    try {
      const { filas, imagenes, fotos } = await leerXlsxConAviso(
        new Uint8Array(await f.arrayBuffer()));
      setTexto('');
      const r = validarFilas(filas, conAgenda, moneda);
      setPrevia(r);
      // El índice de la fila leída es `linea - 1`. La traducción se hace acá,
      // una vez, y no en cada uso: equivocarse pone la foto en el producto de
      // al lado, que es un error que nadie revisa fila por fila.
      setFotosDelArchivo(new Map([...fotos].map(([i, foto]) => [i + 1, foto])));
      avisarSiTraeMoneda(r.columnas);
      if (imagenes > 0) {
        // Se dice ANTES de importar, no después. Ver el comentario de
        // `imagenesIncrustadas` en `lib/xlsx.ts`.
        const atadas = fotos.size;
        setEstado(`Ese archivo trae ${imagenes} ${imagenes === 1 ? 'foto pegada' : 'fotos pegadas'} adentro`
          + (atadas === imagenes
            ? `. Se ${atadas === 1 ? 'va a importar con su producto' : 'van a importar con sus productos'}.`
            : `, y ${atadas} ${atadas === 1 ? 'quedó atada a un producto' : 'quedaron atadas a un producto'}. `
              + 'Las demás están sobre filas vacías o sobre el encabezado, así que '
              + 'no se sabe de qué producto son y no se importan.'));
      }
    } catch (error) {
      setEstado(error instanceof Error ? error.message
        : 'No pudimos leer ese archivo de Excel.');
    }
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

    // Las que ni se intentan, con el motivo que ya calculó la vista previa.
    const salida = new Map<number, Resultado>();
    for (const f of previa.filas) {
      if (f.problemas.length > 0) {
        salida.set(f.linea, { estado: 'omitida', motivo: f.problemas.join('; ') });
      }
    }

    const documento = (fila: FilaCatalogo) => ({
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
    });

    const escribir = (fila: FilaCatalogo) => setDoc(
      doc(db, 'tenants', tenantId, 'catalogo', idDeNombre(fila.nombre)),
      documento(fila), { merge: true });

    /**
     * =====================================================================
     * LA CANTIDAD NO SE ESCRIBE: SE PIDE.
     * =====================================================================
     *
     * `firestore.rules` le prohíbe a la consola tocar el campo `stock`, y tiene
     * razón: si el navegador pudiera fijarlo, el saldo y su historial de
     * movimientos discreparían y el reporte de inventario dejaría de servir. La
     * única puerta es `ajustarStock`, que mueve el número y anota el movimiento
     * en la misma transacción.
     *
     * Va DESPUÉS de escribir el ítem, y no puede ser al revés: un ítem nuevo se
     * crea sin `stock` —la regla rechaza un alta que lo traiga— y recién
     * entonces se le fija la cantidad.
     *
     * SOLO SE LLAMA SI CAMBIA. Importar cien filas cuya cantidad ya coincide no
     * tiene por qué costar cien llamadas ni ensuciar el historial con cien
     * movimientos de cero.
     */
    /**
     * =====================================================================
     * LA FOTO PEGADA EN EL EXCEL, GUARDADA COMO SI LA HUBIERAN SUBIDO
     * =====================================================================
     *
     * Pasa por `prepararFoto`, el MISMO camino que la carga de a una: se
     * encoge a 900 px, se pasa a WebP —o JPEG si el navegador no sabe— y se
     * corta en 150 KB. No es un atajo: si la importación guardara los bytes
     * crudos del Excel, un catálogo de cuarenta fotos de teléfono serían
     * ciento sesenta megas, y el ítem quedaría con una foto que la carga
     * manual jamás habría aceptado.
     *
     * VA DESPUÉS del ítem porque `fotosCatalogo/{itemId}` se ata a un ítem que
     * tiene que existir. Y si falla, el ítem igual quedó: se dice que la foto
     * no entró, no que la fila se rechazó.
     */
    const subirFoto = async (fila: FilaCatalogo, linea: number) => {
      const cruda = fotosDelArchivo.get(linea);
      if (!cruda) return;
      const itemId = idDeNombre(fila.nombre);
      const archivo = new File([cruda.bytes as BlobPart],
        `${itemId}.${cruda.tipo.split('/')[1] ?? 'png'}`, { type: cruda.tipo });
      const r = await prepararFoto(archivo);
      if (!r.ok) throw new Error(mensajeDeFalla(r.falla));
      await setDoc(doc(db, 'tenants', tenantId, 'fotosCatalogo', itemId), {
        datos: r.foto.datos, ancho: r.foto.ancho, alto: r.foto.alto,
        bytes: r.foto.bytes, tipo: r.foto.tipo,
        actualizadoPor: auth.currentUser?.uid ?? '', actualizadoEn: serverTimestamp(),
      });
    };

    const ajustar = httpsCallable(funciones, 'ajustarStock');
    const dejarDeControlar = httpsCallable(funciones, 'dejarDeControlarStock');
    /**
     * Lo que va DESPUÉS de que el ítem ya está guardado: su cantidad y su foto.
     *
     * Las dos pueden fallar por su cuenta sin que el ítem deje de existir, así
     * que el resultado es `parcial` y no `rechazada`. Decir «rechazada» llevaría
     * al comercio a volver a subir todo el archivo para arreglar una foto.
     */
    const terminarFila = async (f: FilaConProblemas): Promise<Resultado> => {
      const pendientes: string[] = [];
      try { await conciliarCantidad(f.fila); } catch {
        pendientes.push('no se pudo fijar la cantidad');
      }
      try { await subirFoto(f.fila, f.linea); } catch (e) {
        pendientes.push(e instanceof Error && e.message
          ? `la foto no entró: ${e.message.toLowerCase()}`
          : 'la foto no se pudo guardar');
      }
      return pendientes.length === 0
        ? { estado: 'importada' }
        : { estado: 'parcial', motivo: `${pendientes.join('; ')}. Se puede corregir desde la tabla de arriba.` };
    };

    const stockActual = new Map(items.map((i) =>
      [i.id, typeof i.stock === 'number' ? i.stock : null]));

    const conciliarCantidad = async (fila: FilaCatalogo) => {
      if (!tiene('cantidad')) return;
      const itemId = idDeNombre(fila.nombre);
      const antes = stockActual.get(itemId) ?? null;
      if (fila.cantidad === antes) return;

      if (fila.cantidad === null) {
        // La celda vacía significa «no aplica»: se deja de controlar. Solo hace
        // falta pedirlo si el ítem HOY lleva la cuenta.
        if (antes !== null) await dejarDeControlar({ tenantId, itemId });
        return;
      }
      await ajustar({ tenantId, itemId, fijarEn: fila.cantidad, motivo: 'inicial' });
    };

    /**
     * =====================================================================
     * LO NUEVO SE PIDE AL SERVIDOR: `importarCatalogo`.
     * =====================================================================
     *
     * Un alta desde el navegador tiene que ir en lote con el contador, de a
     * una, y la regla no puede validar un lote de cien altas contra el tope
     * del plan. Así que las altas en masa las hace la Function, que cuenta,
     * crea hasta donde el plan admite y devuelve `motivo: 'limite_plan'` si
     * cortó. Lo que YA EXISTE sigue por el lote de edición de abajo: editar no
     * ocupa lugar.
     *
     * NO SE LE CREE A LA RESPUESTA PARA SABER QUÉ FILA ENTRÓ: se mira. Después
     * de cada tanda se consulta qué identificadores existen, y eso decide
     * fila por fila. Así el resultado es cierto aunque la Function devuelva
     * solo totales, y aunque se corte a la mitad.
     */
    const paraAlta = (fila: FilaCatalogo) => ({
      // El MISMO identificador que usa la consola: si el servidor derivara
      // otro, el ítem importado no se reconocería como existente la próxima vez.
      id: idDeNombre(fila.nombre),
      nombre: fila.nombre,
      ...(fila.descripcion ? { descripcion: fila.descripcion } : {}),
      ...(fila.area ? { area: fila.area } : {}),
      ...(tiene('precio') && fila.precio !== null ? { precio: fila.precio, moneda: fila.moneda } : {}),
      ...(conAgenda ? { duracionMin: fila.duracionMin } : {}),
      ...(fila.imagenUrl ? { imagenUrl: fila.imagenUrl } : {}),
      activo: fila.activo,
    });
    const importarFn = httpsCallable<
      { tenantId: string; items: ReturnType<typeof paraAlta>[] },
      { creados?: unknown; rechazados?: unknown; motivo?: unknown }>(funciones, 'importarCatalogo');

    const existen = async (ids: string[]): Promise<Set<string>> => {
      const hay = new Set<string>();
      for (let i = 0; i < ids.length; i += 30) {
        const s = await getDocs(query(collection(db, 'tenants', tenantId, 'catalogo'),
          where(documentId(), 'in', ids.slice(i, i + 30))));
        s.docs.forEach((d) => hay.add(d.id));
      }
      return hay;
    };

    const rechazoPorPlan: Resultado = {
      estado: 'rechazada',
      motivo: `el catálogo llegó al tope de tu plan (${limite} ${unidad}). Elimina lo que ya `
        + 'diste de baja o pasa a un plan más grande, y vuelve a subir el archivo.',
    };

    /** Crea las filas nuevas por la Function. Devuelve cuántas cortó el plan. */
    const crearNuevas = async (altas: FilaConProblemas[]): Promise<number> => {
      let porPlan = 0;
      let tope = false;
      for (let i = 0; i < altas.length; i += 100) {
        const trozo = altas.slice(i, i + 100);
        // Si una tanda ya chocó con el tope, las siguientes ni se mandan.
        if (tope) {
          for (const f of trozo) salida.set(f.linea, rechazoPorPlan);
          porPlan += trozo.length;
          continue;
        }
        let motivo: '' | 'limite_plan' | 'sin_respuesta' = '';
        try {
          const r = await importarFn({ tenantId, items: trozo.map((f) => paraAlta(f.fila)) });
          if (r.data?.motivo === 'limite_plan') motivo = 'limite_plan';
        } catch (e) {
          const detalles = (e as { details?: { motivo?: unknown } } | null)?.details;
          motivo = detalles?.motivo === 'limite_plan' || codigoDe(e) === 'functions/resource-exhausted'
            ? 'limite_plan' : 'sin_respuesta';
        }
        const creadas = await existen(trozo.map((f) => idDeNombre(f.fila.nombre)));
        for (const f of trozo) {
          if (creadas.has(idDeNombre(f.fila.nombre))) {
            salida.set(f.linea, await terminarFila(f));
          } else if (motivo === 'limite_plan') {
            salida.set(f.linea, rechazoPorPlan);
            porPlan += 1;
          } else {
            salida.set(f.linea, {
              estado: 'rechazada',
              motivo: motivo === 'sin_respuesta'
                ? 'el servidor no respondió a la importación. Inténtalo de nuevo en un '
                  + 'momento; si sigue, avísanos desde Reclamos.'
                : 'el servidor no aceptó esta fila. Revisa el precio, la duración y la '
                  + 'dirección de la foto.',
            });
          }
        }
        if (motivo === 'limite_plan') tope = true;
      }
      return porPlan;
    };

    try {
      const edicion = buenas.filter((f) => existentes.has(idDeNombre(f.fila.nombre)));
      const altas = buenas.filter((f) => !existentes.has(idDeNombre(f.fila.nombre)));
      // ---------------------------------------------------------------------
      // LO QUE YA EXISTE: PRIMERO EN LOTE, Y SI FALLA, UNA POR UNA.
      //
      // El lote es lo correcto para el camino feliz: una sola ida al servidor
      // en vez de quinientas, y es lo que hace que importar un catálogo grande
      // no tarde un minuto. Pero un lote es todo o nada, y cuando lo rechazan
      // no dice cuál fila lo rompió — que es justo el único dato que el comercio
      // necesita para arreglarlo.
      //
      // Así que el lote se intenta igual, y solo si falla se reescribe ESE lote
      // fila por fila para averiguar quién fue. El costo extra lo paga
      // únicamente la importación que ya venía mal.
      // ---------------------------------------------------------------------
      for (let i = 0; i < edicion.length; i += 400) {
        const trozo = edicion.slice(i, i + 400);
        try {
          const lote = writeBatch(db);
          for (const { fila } of trozo) {
            lote.set(doc(db, 'tenants', tenantId, 'catalogo', idDeNombre(fila.nombre)),
              documento(fila), { merge: true });
          }
          await lote.commit();
          for (const f of trozo) {
            salida.set(f.linea, await terminarFila(f));
          }
        } catch {
          for (const f of trozo) {
            try {
              await escribir(f.fila);
              salida.set(f.linea, await terminarFila(f));
            } catch {
              // El motivo real del servidor no viaja al navegador —Firestore
              // devuelve «permission-denied» y nada más— así que se dice lo que
              // sí se sabe con certeza, sin inventar una causa.
              salida.set(f.linea, {
                estado: 'rechazada',
                motivo: 'el servidor rechazó esta fila. Revisa el precio, la '
                  + 'duración y la dirección de la foto.',
              });
            }
          }
        }
      }

      const porPlan = await crearNuevas(altas);

      const ok = [...salida.values()]
        .filter((r) => r.estado === 'importada' || r.estado === 'parcial').length;
      const mal = salida.size - ok;
      setResultados(salida);
      setEstado(mal === 0
        ? `Listo: ${ok} ${ok === 1 ? 'ítem' : 'ítems'} en el catálogo. `
          + 'El asistente los ofrece desde el próximo mensaje.'
        : `${ok} ${ok === 1 ? 'ítem importado' : 'ítems importados'} y ${mal} sin importar. `
          + (porPlan > 0
            ? `${porPlan} no ${porPlan === 1 ? 'entró' : 'entraron'} porque el catálogo llegó al `
              + `tope de tu plan (${limite} ${unidad}). `
            : '')
          + 'Abajo está el motivo de cada uno: corrige esas filas en tu archivo y '
          + 'vuelve a subirlo — las que ya entraron se actualizan, no se duplican.');
      setTexto('');
      if (archivo.current) archivo.current.value = '';
    } catch {
      setEstado('No se pudo completar la importación. Revisa tu conexión e inténtalo de nuevo.');
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
      // Ausente = no lleva control. Se exporta vacío, no cero: un cero al
      // reimportar dejaría el catálogo entero marcado como agotado.
      cantidad: typeof i.stock === 'number' ? i.stock : null,
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
  const nuevas = previa?.filas.filter((f) => f.problemas.length === 0
    && !existentes.has(idDeNombre(f.fila.nombre))).length ?? 0;
  const libres = Math.max(0, limite - usados);

  return (
    <details className="importador">
      <summary>Importar o exportar en lote (Excel, CSV o Sheets)</summary>

      <p className="ayuda">
        Sube <strong>el archivo de Excel que ya tienes</strong> —no hace falta
        convertirlo a nada— o un CSV. La única columna obligatoria es
        <strong> nombre</strong>; también se entienden <em>descripcion, area,
        precio{conAgenda ? ', duracionMin' : ''}, imagenUrl, cantidad</em> y
        <em> activo</em>. <strong>Las fotos pegadas dentro del Excel se importan</strong>:
        cada una va al producto de la fila donde está pegada. En <em>cantidad</em>, <strong>dejar la celda vacía
        significa que ese ítem no lleva stock</strong> y se puede vender siempre;
        un cero significa agotado, que es distinto. <strong>Lo que el archivo no traiga, no se toca</strong>:
        un archivo sin columna de precios actualiza el resto y deja los precios
        como están.
      </p>
      {/* ACÁ SE ANUNCIABA UNA COLUMNA QUE NO EXISTE —«no lleva columna de
          moneda»— Y SE EXPLICABA POR QUÉ NO EXISTE. Las dos cosas están mal.
          Nombrar lo que no hay le planta al comercio la idea de que debería
          haberlo, y el porqué de una decisión de diseño es una conversación
          entre nosotros: no algo que el negocio tenga que leer para cargar su
          catálogo. La lista de columnas de arriba ya dice cuáles se entienden, y
          quien traiga una de moneda recibe el aviso puntual al importar. */}

      <div className="filtros">
        <label>Archivo
          <input ref={archivo} className="input" type="file"
                 accept=".csv,.tsv,.txt,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                 onChange={(e) => void alElegirArchivo(e)} />
        </label>
        <button type="button" className="btn btn-secondary" onClick={exportar}
                disabled={items.length === 0}>
          Descargar el catálogo actual
        </button>
      </div>

      <label className="field">…o pega aquí las celdas copiadas de tu planilla
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
            {buenas > 0 && <> ({nuevas} {nuevas === 1 ? 'nueva' : 'nuevas'} y {buenas - nuevas} que
              actualizan {buenas - nuevas === 1 ? 'uno existente' : 'existentes'})</>}
          </p>
          {/* SE DICE ANTES DE IMPORTAR. Que el servidor corte a la mitad es
              correcto; que el comercio se entere recién en la tabla de
              resultados, no. */}
          {nuevas > libres && (
            <p className="ayuda aviso-datos">
              Tu archivo trae <strong>{nuevas} {unidad} nuevos</strong> y a tu plan le
              {libres === 1 ? ' queda 1 lugar' : ` quedan ${libres} lugares`} ({usados} de {limite}).
              Van a entrar {libres === 0 ? 'ninguno' : `hasta ${libres}`}; los demás quedan
              marcados como no importados. Las filas que actualizan algo que ya existe
              entran todas: editar no ocupa lugar.
            </p>
          )}
          <table className="table">
            <thead>
              <tr>
                <th>Línea</th><th>Nombre</th><th>Precio</th><th>Cantidad</th><th>Foto</th>
                <th>{resultados ? 'Resultado' : 'Estado'}</th>
              </tr>
            </thead>
            <tbody>
              {previa.filas.slice(0, 200).map((f) => {
                const r = resultados?.get(f.linea);
                const mal = r ? r.estado !== 'importada' : f.problemas.length > 0;
                return (
                  <tr key={f.linea} className={mal ? 'alerta' : ''}>
                    <td>{f.linea}</td>
                    <td><TextoSeguro valor={f.fila.nombre} maxLargo={80} /></td>
                    <td>{f.fila.precio === null
                      ? <span className="text-muted">A consultar</span>
                      : `${f.fila.precio} ${f.fila.moneda}`}</td>
                    <td>{f.fila.cantidad === null
                      ? <span className="text-muted">No aplica</span>
                      : f.fila.cantidad}</td>
                    <td>
                      {/* Si la fila trae una foto pegada en el Excel se dice,
                          porque la columna `imagenUrl` está vacía y sin esto
                          parecería que ese producto se va a quedar sin foto. */}
                      {fotosDelArchivo.has(f.linea)
                        ? <span className="ok-texto">Del Excel</span>
                        : <Miniatura url={f.fila.imagenUrl} />}
                    </td>
                    <td>
                      {/* DESPUÉS de importar manda el resultado real; ANTES, lo
                          que la validación anticipa. Son dos cosas distintas y
                          mezclarlas haría que una fila «lista» que el servidor
                          rechazó siguiera diciendo «lista». */}
                      {r
                        ? (r.estado === 'importada'
                          ? <span className="ok-texto">✓ Importada</span>
                          : r.estado === 'parcial'
                            ? <span className="text-muted">✓ Importada · {r.motivo}</span>
                            : <span className="alerta-texto">
                                {r.estado === 'omitida' ? 'No se importó: ' : 'Rechazada: '}
                                {r.motivo}
                              </span>)
                        : f.problemas.length > 0
                          ? <span className="alerta-texto">{f.problemas.join('; ')}</span>
                          : f.advertencias.length > 0
                            ? <span className="text-muted">{f.advertencias.join('; ')}</span>
                            : existentes.has(idDeNombre(f.fila.nombre))
                              ? 'Lista · actualiza la existente'
                              : 'Lista · nueva'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {previa.filas.length > 200 && (
            <p className="ayuda">Se muestran las primeras 200 filas; se importan todas.</p>
          )}
          {/* Después de importar el botón desaparece: volver a tocarlo
              reescribiría lo mismo y haría dudar de si algo quedó a medias. Para
              reintentar se sube el archivo corregido. */}
          {!resultados && (
            <button type="button" className="btn btn-primary"
                    disabled={buenas === 0 || importando} onClick={() => void importar()}>
              {importando ? 'Importando…' : `Importar ${buenas} ${buenas === 1 ? 'ítem' : 'ítems'}`}
            </button>
          )}
        </>
      )}

      {estado && <p role="status">{estado}</p>}
    </details>
  );
}

/**
 * =============================================================================
 * VISTA PREVIA — el comercio mira su propia página antes de que la vea nadie
 * =============================================================================
 *
 * REEMPLAZA UN ANDAMIO. Acá había un enlace que salía de una variable de
 * entorno y que solo existía en la máquina donde se hacía una demostración.
 * Servía para demostrar, no para que un comercio revisara su catálogo — y nadie
 * publica una lista de precios sin mirar antes cómo quedó.
 *
 * ES LA PÁGINA DE VERDAD, no una imitación. Se abre la misma dirección que
 * abriría un cliente, servida por el mismo endpoint, con los mismos filtros:
 * sin precio no se publica, agotado no se publica. Una vista previa dibujada
 * aparte con los datos de la consola mostraría cosas que el cliente no ve, y
 * una vista previa que miente es peor que no tenerla.
 *
 * LO ÚNICO QUE CAMBIA es que la ficha va marcada como previa: dura quince
 * minutos, no cuenta como conversación —mirar el catálogo propio no se cobra— y
 * el checkout la rechaza, así que probando no se puede generar un pedido falso.
 *
 * Va en un marco del ancho de un teléfono porque es donde lo va a abrir el
 * cliente: mostrarlo a 1.200 píxeles da una impresión que después no se cumple.
 */
function VistaPrevia({ tenantId, conVenta }: { tenantId: string; conVenta: boolean }) {
  const [catalogoWebActivo, setCatalogoWebActivo] = useState<boolean | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pidiendo, setPidiendo] = useState(false);

  useEffect(() => {
    if (!tenantId || !conVenta) return;
    return onSnapshot(doc(db, 'tenants', tenantId, 'config', 'negocio'),
      (d) => setCatalogoWebActivo(d.get('catalogoWebActivo') === true),
      () => setCatalogoWebActivo(null));
  }, [tenantId, conVenta]);

  if (!conVenta) return null;

  const abrir = async () => {
    setError(null);
    setPidiendo(true);
    try {
      const r = await httpsCallable<{ tenantId: string }, { url: string }>(
        funciones, 'vistaPreviaCatalogo')({ tenantId });
      setUrl(r.data.url);
    } catch {
      setError('No se pudo abrir la vista previa. Intente en un momento.');
    } finally {
      setPidiendo(false);
    }
  };

  return (
    <div className="vista-previa">
      <h3>Cómo lo ve su cliente</h3>
      <p className="ayuda">
        Es la página de verdad, con los mismos filtros: <strong>lo que no tiene
        precio y lo que está agotado no se publica</strong>. Desde acá no se
        pueden hacer pedidos — es solo para mirar.
      </p>
      {/* AVISO ANTES DE ABRIR, y no una vista previa que se explica sola. Si el
          catálogo está apagado, el marco muestra el mensaje que vería un
          CLIENTE —«este negocio todavía no publicó su catálogo»—, que al
          comercio no le dice qué hacer. Acá sí. */}
      {catalogoWebActivo === false && (
        <p className="ayuda aviso-datos">
          Tu catálogo web está <strong>apagado</strong>: nadie puede abrirlo
          todavía, ni siquiera tú desde aquí. Se enciende en{' '}
          <Link to={`/negocio/${encodeURIComponent(tenantId)}/configuracion`}>Configuración</Link>.
        </p>
      )}
      {url === null ? (
        <button type="button" className="btn btn-secondary" disabled={pidiendo} onClick={() => void abrir()}>
          {pidiendo ? 'Abriendo…' : 'Ver mi catálogo'}
        </button>
      ) : (
        <>
          <iframe className="marco-catalogo" src={url} title="Vista previa del catálogo"
                  sandbox="allow-scripts allow-same-origin" />
          <p className="ayuda">
            {/* `noreferrer` además de `noopener`: la página del catálogo no tiene
                por qué enterarse de desde qué dirección de la consola se la abrió. */}
            <a href={url} target="_blank" rel="noopener noreferrer">Abrirla en otra pestaña ↗</a>
            {' · '}
            <button type="button" className="enlace" onClick={() => void abrir()}>Recargar</button>
            {' · '}vence en 15 minutos
          </p>
        </>
      )}
      {error && <p role="alert" className="ayuda">{error}</p>}
    </div>
  );
}
