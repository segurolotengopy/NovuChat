import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Timestamp, collection, doc, documentId, getCountFromServer, getDoc, getDocs, limit, onSnapshot, orderBy, query, startAfter,
  updateDoc, where, type DocumentSnapshot, type Query, type QueryConstraint,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, funciones } from '../../core/lib/firebase';
import { useSesion } from '../../core/lib/contexto';
import { useEstadoComercio } from '../componentes/ConsolaConversaciones';
import { rolEn } from '../../core/lib/sesion';
import { ListaConversaciones, type Renglon } from '../componentes/ListaConversaciones';
import { DetalleConversacion } from '../componentes/DetalleConversacion';
import {
  CAMPOS_FECHA, CONTADORES_CADA_MS, CONTADORES_MINIMO_MS, CONTADORES_VACIOS, PAGINA_LISTA, PAGINACION_INICIAL,
  REBOTE_MARCA_LEIDA_MS, RESUSCRIBIR_FILTROS_MS, alAceptarPagina, alSnapshot, alSuscribir, aplicarFiltro, buscarPorNombre,
  buscarPorTelefono, clasificarConsulta, consultaDeFiltro, consultaDeIds, consultaDeNombre, consultasDeTelefono,
  cursorInvalidado, debeMarcarLeida, esIdConversacion, esIdMensaje, fichaDeDocumento, filtroConReloj, mensajeContiene, mezclarLista,
  marcaBloqueada, palabraParaIndice, prefijosValidos, puedeGestionarConversaciones, respuestaVigente, rutaConversaciones,
  textoErrorBusqueda, unirFichas, vecina, PREFIJOS_PAIS_DEFECTO, MAX_DIGITOS_TELEFONO,
  type Consulta, type ConsultaPlana, type Contadores, type Ficha, type Filtro, type Paginacion,
} from '../lib/conversaciones';
import '../estilos/conversaciones.css';

/**
 * =============================================================================
 * CONVERSACIONES — LA PANTALLA NUEVA, ESTILO WHATSAPP WEB (H1, 09/10/2026)
 * =============================================================================
 *
 * Una lista a la izquierda y UN detalle a la derecha, cada uno con su scroll. En un
 * celular son dos vistas: la lista, o el chat. La conversación abierta está en la
 * dirección (`/negocio/:t/conversaciones/:c`, con `?m=<mensaje>` si viene de una
 * búsqueda), así que se puede copiar, volver con «atrás» y compartir.
 *
 * SE MUESTRA SOLO CON LA BANDERA `tenants/{id}.consolaConversaciones = 'nueva'`
 * (ver `Conversaciones.tsx`, el selector). La pantalla de siempre queda intacta.
 *
 * QUÉ ESCRIBE: dos cosas, y nada más. «No contactar» (en el detalle) y la marca de
 * leída: `{ noLeidos: 0, sinLeer: false }`, que las reglas solo aceptan hacia cero
 * y solo de una persona del negocio (admin u oper). No tiene «Tomar», «Devolver» ni
 * campo para escribir: eso llega en H2. La única Function que llama es
 * `buscarConversaciones`. Ningún `fetch`, ningún almacenamiento del navegador.
 *
 * QUÉ LEE (todo bajo `/tenants/{t}`, la ruta decide qué se puede leer; no hay un
 * `where('tenantId', …)` que un usuario pudiera cambiar para mirar otro negocio):
 *
 *   · la lista: la primera página (50) EN VIVO y las siguientes con «Cargar más»
 *     (sin vivo). Si en vivo entra una conversación nueva a la primera página,
 *     las páginas siguientes se descartan (empujó a otra hacia afuera y quedaría
 *     un hueco): se vuelven a pedir con «Cargar más».
 *   · los contadores de los filtros, con `getCountFromServer` (una lectura por
 *     cada mil documentos, no una por documento).
 *   · el teléfono y el nombre, con consultas directas (índices `telefonoTrozos` y
 *     `nombrePalabras`); la PALABRA, con la callable `buscarConversaciones`, que
 *     lee los mensajes en el servidor. Nunca se leen los mensajes de todas las
 *     conversaciones desde el navegador.
 *   · el hilo: se suscribe a su propio documento, así que un enlace profundo
 *     funciona aunque la conversación no esté en las 50 primeras.
 *
 * Todo texto que viene de un cliente pasa por <TextoSeguro>.
 */

function useAhora(cadaMs: number): number {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), cadaMs);
    return () => clearInterval(t);
  }, [cadaMs]);
  return ahora;
}

function useDebounce<T>(valor: T, espera: number): T {
  const [v, setV] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setV(valor), espera);
    return () => clearTimeout(t);
  }, [valor, espera]);
  return v;
}

function usePestanaVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible');
  useEffect(() => {
    const alCambiar = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', alCambiar);
    return () => document.removeEventListener('visibilitychange', alCambiar);
  }, []);
  return visible;
}

// ── De la consulta descrita como datos a la consulta de Firestore ────────────

function restriccionesDe(c: ConsultaPlana): QueryConstraint[] {
  const salida: QueryConstraint[] = [];
  for (const r of c.restricciones) {
    const valor = typeof r.valor === 'number' && CAMPOS_FECHA.includes(r.campo) ? Timestamp.fromMillis(r.valor) : r.valor;
    salida.push(where(r.campo === '__name__' ? documentId() : r.campo, r.op, valor));
  }
  for (const o of c.orden) salida.push(orderBy(o.campo, o.dir));
  return salida;
}

/** Siempre bajo `/tenants/{t}/conversaciones`. `despues` va tras el orden y antes del límite (el SDK lo exige). */
function consultaFirestore(tenantId: string, c: ConsultaPlana, despues: QueryConstraint[] = []): Query {
  return query(
    collection(db, 'tenants', tenantId, 'conversaciones'),
    ...restriccionesDe(c), ...despues, ...(c.limite !== undefined ? [limit(c.limite)] : []),
  );
}

// ── La lista: primera página en vivo, el resto a pedido ──────────────────────

interface EstadoLista {
  /** La primera página, en vivo. */
  enVivo: Ficha[];
  /** Las páginas de «Cargar más»: una foto de cuando se pidieron. */
  anteriores: Ficha[];
  /** Las dos juntas, ordenadas (para buscar entre lo que ya se ve). */
  fichas: Ficha[];
  cargando: boolean;
  error: string | null;
  hayMas: boolean;
  cargandoMas: boolean;
  cargarMas: () => void;
  /** Cuenta los cambios que llegan en vivo (para refrescar los contadores). */
  cambios: number;
}

function useLista(tenantId: string, filtro: Filtro, ciclo: number): EstadoLista {
  const [enVivo, setEnVivo] = useState<Ficha[]>([]);
  const [anteriores, setAnteriores] = useState<Ficha[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hayMas, setHayMas] = useState(false);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [cambios, setCambios] = useState(0);
  const cursor = useRef<DocumentSnapshot | null>(null);
  const ahoraDeLaSuscripcion = useRef(Date.now());
  /**
   * La ÉPOCA de la paginación (`lib/conversaciones.ts`, `Paginacion`): cambia cuando entra una conversación a la primera
   * página, cuando el oyente se vuelve a suscribir y cuando cambia el filtro o el negocio. Una respuesta de «Cargar más»
   * que salió en otra época se descarta: si se aceptara, abriría un hueco entre la primera página y la nueva.
   */
  const paginacion = useRef<Paginacion>(PAGINACION_INICIAL);
  const claveVista = useRef('');
  // Los filtros con reloj se vuelven a pedir cada 5 minutos; los demás no dependen del ciclo.
  const cicloEfectivo = filtroConReloj(filtro) ? ciclo : 0;

  useEffect(() => {
    if (!tenantId) return;
    const clave = `${tenantId}|${filtro}`;
    if (claveVista.current !== clave) {
      claveVista.current = clave;
      setEnVivo([]); setCargando(true); setError(null); setHayMas(false);
    }
    paginacion.current = alSuscribir(paginacion.current);
    setAnteriores([]); cursor.current = null; setCargandoMas(false);
    ahoraDeLaSuscripcion.current = Date.now();
    let primera = true;
    let activa = true;
    const baja = onSnapshot(
      consultaFirestore(tenantId, consultaDeFiltro(filtro, ahoraDeLaSuscripcion.current, PAGINA_LISTA)),
      (snap) => {
        if (!activa) return;
        // Entró una conversación a la primera página: otra salió. Lo cargado de «Cargar más» tendría un hueco y lo que
        // esté volando se descarta (cambia la época).
        const entro = !primera && snap.docChanges().some((c) => c.type === 'added');
        const antes = paginacion.current;
        paginacion.current = alSnapshot(paginacion.current, entro);
        if (entro) { setAnteriores([]); setCargandoMas(false); }
        if (entro || !antes.hayAnteriores) {
          cursor.current = snap.docs[snap.docs.length - 1] ?? null;
          setHayMas(snap.size >= PAGINA_LISTA);
        }
        if (!primera && snap.docChanges().length > 0) setCambios((n) => n + 1);
        primera = false;
        setEnVivo(snap.docs.map((d) => fichaDeDocumento(d.id, d.data())));
        setError(null);
        setCargando(false);
      },
      () => {
        if (!activa) return;
        setError('No se pudieron leer las conversaciones.');
        setCargando(false);
      },
    );
    return () => { activa = false; paginacion.current = alSuscribir(paginacion.current); baja(); };
  }, [tenantId, filtro, cicloEfectivo]);

  const cargarMas = useCallback(() => {
    const desde = cursor.current;
    if (!desde || !tenantId) return;
    const epoca = paginacion.current.epoca;
    setCargandoMas(true);
    void getDocs(consultaFirestore(
      tenantId, consultaDeFiltro(filtro, ahoraDeLaSuscripcion.current, PAGINA_LISTA), [startAfter(desde)],
    )).then((snap) => {
      // Otra época (entró una conversación, se re-suscribió el oyente, cambió el filtro): esta página no empalma.
      if (!respuestaVigente(paginacion.current, epoca)) return;
      paginacion.current = alAceptarPagina(paginacion.current);
      cursor.current = snap.docs[snap.docs.length - 1] ?? desde;
      setHayMas(snap.size >= PAGINA_LISTA);
      setAnteriores((previas) => unirFichas(previas, snap.docs.map((d) => fichaDeDocumento(d.id, d.data()))));
      setCargandoMas(false);
    }, () => {
      if (!respuestaVigente(paginacion.current, epoca)) return;
      setError('No se pudieron cargar más conversaciones.');
      setCargandoMas(false);
    });
  }, [tenantId, filtro]);

  const fichas = useMemo(() => mezclarLista(filtro, enVivo, anteriores), [filtro, enVivo, anteriores]);
  return { enVivo, anteriores, fichas, cargando, error, hayMas, cargandoMas, cargarMas, cambios };
}

// ── Los contadores de los chips ──────────────────────────────────────────────

const FILTROS_A_CONTAR: readonly Filtro[] = ['todas', 'humano', 'noLeidas', 'vencer'];

/**
 * Al montar; cada 60 s con la pestaña visible; y tras un
 * cambio en vivo, pero nunca más de uno cada 15 s. Un contador que falla queda con
 * el último valor que se supo (o sin número): no se inventa un cero.
 */
function useContadores(tenantId: string, cambios: number, visible: boolean): Contadores {
  const [contadores, setContadores] = useState<Contadores>(CONTADORES_VACIOS);
  const ultimaVez = useRef(0);
  const pendiente = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vivo = useRef(true);

  const contar = useCallback(async () => {
    ultimaVez.current = Date.now();
    const ahora = Date.now();
    const cuentas = await Promise.all(FILTROS_A_CONTAR.map(async (f): Promise<number | null> => {
      try {
        return (await getCountFromServer(consultaFirestore(tenantId, consultaDeFiltro(f, ahora)))).data().count;
      } catch { return null; }
    }));
    if (!vivo.current) return;
    setContadores((previos) => {
      const nuevos = { ...previos };
      FILTROS_A_CONTAR.forEach((f, i) => { const n = cuentas[i]; if (n !== undefined && n !== null) nuevos[f] = n; });
      return nuevos;
    });
  }, [tenantId]);

  /** Pide un recuento sin pasar de uno cada 15 s: si es pronto, se deja uno para cuando se cumpla el plazo. */
  const pedirAcotado = useCallback(() => {
    if (pendiente.current !== null) return;
    const falta = ultimaVez.current + CONTADORES_MINIMO_MS - Date.now();
    if (falta <= 0) { void contar(); return; }
    pendiente.current = setTimeout(() => { pendiente.current = null; void contar(); }, falta);
  }, [contar]);

  useEffect(() => {
    vivo.current = true;
    return () => { vivo.current = false; if (pendiente.current !== null) { clearTimeout(pendiente.current); pendiente.current = null; } };
  }, []);

  // Al montar (y al cambiar de negocio, que remonta la pantalla): enseguida. Los conteos no dependen del filtro elegido,
  // así que cambiar de filtro NO los vuelve a pedir.
  useEffect(() => { void contar(); }, [contar]);
  // Cada 60 s, solo con la pestaña visible.
  useEffect(() => {
    if (!visible) return;
    const t = setInterval(pedirAcotado, CONTADORES_CADA_MS);
    return () => clearInterval(t);
  }, [visible, pedirAcotado]);
  // Tras un cambio en vivo.
  useEffect(() => { if (cambios > 0 && visible) pedirAcotado(); }, [cambios, visible, pedirAcotado]);

  return contadores;
}

// ── La conversación abierta: su propio documento ─────────────────────────────

type Abierta =
  | { estado: 'cargando' }
  | { estado: 'ok'; ficha: Ficha }
  | { estado: 'no-existe' }
  | { estado: 'error' };

function useConversacionAbierta(tenantId: string, conversacionId: string | undefined): Abierta | null {
  const [abierta, setAbierta] = useState<Abierta | null>(null);
  useEffect(() => {
    if (!tenantId || !conversacionId) { setAbierta(null); return; }
    // Un id que no tiene la forma de una conversación (p. ej. «wa_1%2F…» en la dirección) arma una ruta de Firestore de
    // otro nivel y `doc()` lanza: tumbaría la consola. Se trata como «no existe» sin tocar Firestore.
    if (!esIdConversacion(conversacionId)) { setAbierta({ estado: 'no-existe' }); return; }
    setAbierta({ estado: 'cargando' });
    return onSnapshot(
      doc(db, 'tenants', tenantId, 'conversaciones', conversacionId),
      (d) => setAbierta(d.exists() ? { estado: 'ok', ficha: fichaDeDocumento(d.id, d.data()) } : { estado: 'no-existe' }),
      () => setAbierta({ estado: 'error' }),
    );
  }, [tenantId, conversacionId]);
  return abierta;
}

// ── Búsqueda ─────────────────────────────────────────────────────────────────

interface Hallazgo { ficha: Ficha; mensajeId: string; fragmento: string; ts: number }

interface EntradaBusqueda { tenantId: string; texto: string; cursor?: string | null }
interface SalidaBusqueda {
  palabras: string[];
  resultados: { conversacionId: string; telefono: string; mensajeId: string; ts: unknown; direccion: string; fragmento: string }[];
  cursor: string | null;
}

/** `ts` puede llegar como ms, texto ISO o `{seconds}`/`{_seconds}`; lo que no se entiende es 0. */
function aMs(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isFinite(t) ? t : 0; }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const s = typeof o['seconds'] === 'number' ? o['seconds'] : typeof o['_seconds'] === 'number' ? o['_seconds'] : null;
    if (s !== null) return s * 1000;
  }
  return 0;
}

const codigoDe = (e: unknown): unknown => (e && typeof e === 'object' ? (e as { code?: unknown }).code : undefined);

export function ConversacionesNueva() {
  const { tenantId = '' } = useParams();
  // `key`: al cambiar de negocio todo el estado (búsqueda, filtros, lista) empieza de cero.
  return <ConversacionesDe key={tenantId} tenantId={tenantId} />;
}

function ConversacionesDe({ tenantId }: { tenantId: string }) {
  const { conversacionId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { permisos } = useSesion();
  const rol = rolEn(permisos, tenantId);
  const visible = usePestanaVisible();

  // `?m=` viene de la dirección: un id con «/» arma una ruta de otro nivel. Si no sirve, es como no haberlo puesto.
  const mensajeCrudo = params.get('m');
  const mensajeId = esIdMensaje(mensajeCrudo) ? mensajeCrudo : null;

  const ahora = useAhora(20_000);
  const ciclo = useAhora(RESUSCRIBIR_FILTROS_MS);
  const [consulta, setConsulta] = useState('');
  const consultaEstable = useDebounce(consulta, 350);
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [fijadas, setFijadas] = useState<ReadonlyMap<string, Ficha>>(new Map());
  const buscadorRef = useRef<HTMLInputElement | null>(null);
  const raizRef = useRef<HTMLElement | null>(null);

  // ── Datos ──────────────────────────────────────────────────────────────────
  const lista = useLista(tenantId, filtro, ciclo);
  const conteos = useContadores(tenantId, lista.cambios, visible);
  const abierta = useConversacionAbierta(tenantId, conversacionId);
  // Solo la de la dirección: al pasar de una conversación a otra hay un instante con la ficha de la anterior.
  const fichaAbierta = abierta?.estado === 'ok' && abierta.ficha.id === conversacionId ? abierta.ficha : null;

  // La abierta se «fija» en la lista filtrada: abrirla puede dejarla sin cumplir el filtro (una «no leída» deja de serlo
  // al leerla) y la lista no debe saltar bajo los dedos, ni «siguiente» saltearse conversaciones.
  useEffect(() => {
    if (!fichaAbierta) return;
    setFijadas((previas) => new Map(previas).set(fichaAbierta.id, fichaAbierta));
  }, [fichaAbierta]);
  function elegirFiltro(f: Filtro) { setFiltro(f); setFijadas(new Map()); }

  // ── Marcar leída ───────────────────────────────────────────────────────────
  // Con 1 s de rebote (pasar de largo por una conversación no la marca), solo si quien mira es admin u oper del negocio
  // (el propietario de NovuChat NUNCA marca), con la pestaña visible y algo que marcar. Un error se ignora: marcar
  // leída es comodidad, no dato; si no se pudo (comercio suspendido, red), la conversación sigue sin leer.
  //
  // NO SE REINTENTA EN BUCLE. El comercio tiene que estar `activo` (suspendido, las reglas niegan toda escritura de una
  // persona) y, si una marca FALLA (rol revocado, red), `fallidas` recuerda el `noLeidos` de entonces y no se vuelve a
  // intentar hasta que crezca: es decir, hasta que haya algo nuevo que marcar.
  const estadoComercio = useEstadoComercio(tenantId);
  const fallidas = useRef<Map<string, number>>(new Map());
  const marcar = fichaAbierta !== null && debeMarcarLeida({
    rol, propietario: permisos.propietario, comercioActivo: estadoComercio === 'activo', visible,
    noLeidos: fichaAbierta.noLeidos, sinLeer: fichaAbierta.sinLeer, fallo: fallidas.current.get(fichaAbierta.id),
  });
  const idAMarcar = fichaAbierta?.id ?? null;
  const noLeidosAbierta = fichaAbierta?.noLeidos ?? 0;
  useEffect(() => {
    if (!marcar || !idAMarcar) return;
    const t = setTimeout(() => {
      // Última comprobación antes de escribir: si mientras tanto quedó registrada una marca fallida con este mismo valor, no.
      if (marcaBloqueada(fallidas.current.get(idAMarcar), noLeidosAbierta)) return;
      updateDoc(doc(db, 'tenants', tenantId, 'conversaciones', idAMarcar), { noLeidos: 0, sinLeer: false })
        .catch(() => { fallidas.current.set(idAMarcar, noLeidosAbierta); });
    }, REBOTE_MARCA_LEIDA_MS);
    return () => clearTimeout(t);
  }, [marcar, idAMarcar, noLeidosAbierta, tenantId]);
  const puedeGestionar = puedeGestionarConversaciones(rol, permisos.propietario);

  // ── Búsqueda ───────────────────────────────────────────────────────────────
  const cons: Consulta = useMemo(() => clasificarConsulta(consultaEstable), [consultaEstable]);
  const claveTelefono = cons.tipo === 'telefono' ? cons.digitos : '';
  const claveTexto = cons.tipo === 'texto' ? cons.texto : '';
  const palabras = cons.tipo === 'texto' ? cons.palabras : [];
  const clavePalabras = palabras.join(' ');

  const prefijosEnCache = useRef<string[] | null>(null);
  const prefijosDelComercio = useCallback(async (): Promise<string[]> => {
    if (prefijosEnCache.current) return prefijosEnCache.current;
    let p: string[] = [...PREFIJOS_PAIS_DEFECTO];
    try {
      const d = await getDoc(doc(db, 'tenants', tenantId, 'config', 'negocio'));
      p = prefijosValidos(d.data()?.['prefijosPermitidos']);
    } catch { /* sin config legible: el prefijo por defecto */ }
    prefijosEnCache.current = p;
    return p;
  }, [tenantId]);
  const [prefijos, setPrefijos] = useState<string[]>([...PREFIJOS_PAIS_DEFECTO]);

  // Teléfono: los «trozos» (finales) y los rangos por prefijo, todo directo a Firestore, 20 por consulta.
  const [resTelefono, setResTelefono] = useState<Ficha[]>([]);
  const [buscandoTelefono, setBuscandoTelefono] = useState(false);
  const [errorTelefono, setErrorTelefono] = useState<string | null>(null);
  useEffect(() => {
    setErrorTelefono(null);
    if (!claveTelefono) { setResTelefono([]); setBuscandoTelefono(false); return; }
    let vigente = true;
    setBuscandoTelefono(true);
    void (async () => {
      const ps = await prefijosDelComercio();
      if (!vigente) return;
      setPrefijos(ps);
      const respuestas = await Promise.allSettled(
        consultasDeTelefono(claveTelefono, ps).map((c) => getDocs(consultaFirestore(tenantId, c))));
      if (!vigente) return;
      const bien = respuestas.flatMap((r) => (r.status === 'fulfilled' ? r.value.docs : []));
      setResTelefono(unirFichas(bien.map((d) => fichaDeDocumento(d.id, d.data()))));
      if (respuestas.every((r) => r.status === 'rejected')) setErrorTelefono('No se pudo buscar por teléfono. Intente de nuevo.');
      setBuscandoTelefono(false);
    })();
    return () => { vigente = false; };
  }, [claveTelefono, tenantId, prefijosDelComercio]);

  // Nombre: `nombrePalabras` (las raíces de las palabras del nombre), directo a Firestore.
  const [resNombre, setResNombre] = useState<Ficha[]>([]);
  const [buscandoNombre, setBuscandoNombre] = useState(false);
  useEffect(() => {
    const palabra = palabraParaIndice(palabras);
    if (!claveTexto || !palabra) { setResNombre([]); setBuscandoNombre(false); return; }
    let vigente = true;
    setBuscandoNombre(true);
    void getDocs(consultaFirestore(tenantId, consultaDeNombre(palabra))).then(
      (snap) => { if (vigente) { setResNombre(snap.docs.map((d) => fichaDeDocumento(d.id, d.data()))); setBuscandoNombre(false); } },
      () => { if (vigente) { setResNombre([]); setBuscandoNombre(false); } },
    );
    return () => { vigente = false; };
    // `palabras` entra por su texto: un render nuevo con las mismas palabras no relanza la búsqueda.
  }, [claveTexto, clavePalabras, tenantId]);

  // Palabra: la callable `buscarConversaciones` (lee los mensajes en el servidor; máx. 20 por página).
  const [resPalabra, setResPalabra] = useState<Hallazgo[]>([]);
  const [cursorPalabra, setCursorPalabra] = useState<string | null>(null);
  const [buscandoPalabra, setBuscandoPalabra] = useState(false);
  const [errorPalabra, setErrorPalabra] = useState<string | null>(null);
  const cargadas = useRef<Map<string, Ficha>>(new Map());
  // Lo que se ve en vivo gana sobre lo que trajo una consulta de una sola vez.
  cargadas.current = new Map(unirFichas(resTelefono, resNombre, lista.fichas).map((f) => [f.id, f]));

  const buscarPalabra = useCallback(async (texto: string, cursor: string | null, vigente: () => boolean, agregar: boolean) => {
    setBuscandoPalabra(true);
    setErrorPalabra(null);
    try {
      const buscar = httpsCallable<EntradaBusqueda, SalidaBusqueda>(funciones, 'buscarConversaciones');
      const salida = (await buscar({ tenantId, texto, ...(cursor ? { cursor } : {}) })).data;
      const crudos = Array.isArray(salida?.resultados) ? salida.resultados : [];
      const validos = crudos.filter((r) => r && typeof r.conversacionId === 'string' && esIdConversacion(r.conversacionId)
        && esIdMensaje(r.mensajeId));
      // La ficha de cada resultado: la que ya se tiene o, si no, su documento (el servidor devuelve el mensaje, no el contacto).
      // Una sola consulta (`documentId() in […]`, hasta 30) en vez de una lectura por resultado.
      if (!vigente()) return;
      const faltan = [...new Set(validos.map((r) => r.conversacionId))].filter((id) => !cargadas.current.has(id));
      const consultaIds = consultaDeIds(faltan);
      let traidas: Ficha[] = [];
      if (consultaIds) {
        try { traidas = (await getDocs(consultaFirestore(tenantId, consultaIds))).docs.map((d) => fichaDeDocumento(d.id, d.data())); } catch { /* sin ficha: se muestra con el teléfono */ }
      }
      if (!vigente()) return;
      const fichas = new Map(cargadas.current);
      for (const f of traidas) fichas.set(f.id, f);
      const nuevos: Hallazgo[] = [];
      for (const r of validos) {
        const ficha = fichas.get(r.conversacionId) ?? fichaDeDocumento(r.conversacionId, { telefono: typeof r.telefono === 'string' ? r.telefono : '' });
        nuevos.push({ ficha, mensajeId: r.mensajeId, fragmento: typeof r.fragmento === 'string' ? r.fragmento : '', ts: aMs(r.ts) });
      }
      setResPalabra((previos) => (agregar ? [...previos, ...nuevos] : nuevos));
      setCursorPalabra(typeof salida?.cursor === 'string' ? salida.cursor : null);
    } catch (e) {
      if (!vigente()) return;
      // El texto sale del CÓDIGO del error, nunca de su mensaje. Los resultados por teléfono y por nombre siguen a la vista.
      if (!agregar) { setResPalabra([]); setCursorPalabra(null); }
      // Un cursor que el servidor ya no acepta no se reintenta: «Más resultados» se quita.
      if (cursorInvalidado(codigoDe(e), cursor !== null)) setCursorPalabra(null);
      setErrorPalabra(textoErrorBusqueda(codigoDe(e), cursor !== null));
    } finally {
      if (vigente()) setBuscandoPalabra(false);
    }
  }, [tenantId]);

  // Al servidor va lo que la persona escribió (hasta 100 letras), NO las raíces: él las calcula con la misma regla, y una
  // raíz vuelta a pasar por la regla puede cambiar («class» → «clas» → «cla»). La clave de la búsqueda son las palabras.
  const textoCrudo = useRef('');
  textoCrudo.current = consultaEstable.trim().slice(0, 100);
  const hayPalabras = palabras.length > 0;
  const textoDeLaBusqueda = useRef('');
  /** Cambia con cada búsqueda nueva: lo que salió de una búsqueda anterior ya no vale, ni siquiera con el mismo texto. */
  const busquedaId = useRef(0);
  useEffect(() => {
    setResPalabra([]); setCursorPalabra(null); setErrorPalabra(null);
    const id = ++busquedaId.current;
    if (!hayPalabras) { textoDeLaBusqueda.current = ''; setBuscandoPalabra(false); return; }
    let vigente = true;
    textoDeLaBusqueda.current = textoCrudo.current;
    void buscarPalabra(textoDeLaBusqueda.current, null, () => vigente && busquedaId.current === id, false);
    return () => { vigente = false; };
  }, [hayPalabras, clavePalabras, buscarPalabra]);

  const masPalabra = useCallback(() => {
    const t = textoDeLaBusqueda.current;
    if (!cursorPalabra || !t) return;
    const id = busquedaId.current;
    // «Más resultados» solo vale mientras siga siendo ESA búsqueda: si se escribió otra cosa, su respuesta se descarta.
    void buscarPalabra(t, cursorPalabra, () => busquedaId.current === id && textoDeLaBusqueda.current === t, true);
  }, [cursorPalabra, buscarPalabra]);

  const enBusqueda = cons.tipo === 'telefono' || cons.tipo === 'texto';
  const buscando = buscandoTelefono || buscandoNombre || buscandoPalabra;

  // ── Los renglones ──────────────────────────────────────────────────────────
  const { renglones, estadoBusqueda } = useMemo(() => {
    const aRenglon = (f: Ficha, extra?: Partial<Renglon>): Renglon => ({
      clave: f.id, ficha: f, href: rutaConversaciones(tenantId, f.id), ...extra,
    });
    if (cons.tipo === 'telefono') {
      // Lo que trajo el servidor más lo que ya está en pantalla (un documento sin `telefonoTrozos` se halla igual por el final).
      const r = buscarPorTelefono(unirFichas(resTelefono, lista.fichas), cons.digitos, prefijos);
      return {
        renglones: r.map((x) => aRenglon(x.ficha, { motivo: x.tipo === 'completo' ? 'Número completo' : x.tipo === 'final' ? 'Termina en …' + cons.digitos.slice(-4) : 'Empieza igual' })),
        estadoBusqueda: buscandoTelefono ? 'Buscando…' : r.length === 0 ? 'Ningún teléfono coincide.'
          : `${r.length} ${r.length === 1 ? 'conversación' : 'conversaciones'} con ese número.`,
      };
    }
    if (cons.tipo === 'texto') {
      const delServidor = resNombre.filter((f) => mensajeContiene(f.nombrePalabras, f.nombre, cons.palabras));
      const porNombre = unirFichas(delServidor, buscarPorNombre(lista.fichas, cons.texto))
        .sort((a, b) => (b.ultimoEn ?? 0) - (a.ultimoEn ?? 0))
        .map((f) => aRenglon(f, { motivo: 'Nombre' }));
      const porPalabra: Renglon[] = resPalabra.map((h) => {
        const f = lista.fichas.find((x) => x.id === h.ficha.id) ?? h.ficha;
        return {
          clave: `${f.id}#${h.mensajeId}`, ficha: f, href: rutaConversaciones(tenantId, f.id, h.mensajeId),
          coincidencia: { fragmento: h.fragmento, ts: h.ts, palabras: cons.palabras },
        };
      });
      const todos = [...porNombre, ...porPalabra];
      let estado: string;
      if (!cons.palabras.length && !porNombre.length) estado = 'Escriba al menos 3 letras de una palabra.';
      else if (buscando) estado = `Buscando «${cons.texto}»…`;
      else if (todos.length === 0) {
        // Con cursor: el servidor no halló nada en lo reciente pero se puede buscar más atrás (no es «nada coincide»).
        estado = errorPalabra ? '' : cursorPalabra !== null ? `Sin resultados recientes con «${cons.texto}»; puede buscar más atrás.`
          : `Nada con «${cons.texto}». Solo se buscan mensajes guardados desde que se activó la búsqueda por palabra.`;
      }
      else estado = `${porPalabra.length} ${porPalabra.length === 1 ? 'mensaje' : 'mensajes'}${porNombre.length ? ` y ${porNombre.length} por nombre` : ''}.`;
      return { renglones: todos, estadoBusqueda: estado };
    }
    const pines = new Set([...fijadas.keys(), ...(conversacionId ? [conversacionId] : [])]);
    const visibles = aplicarFiltro(mezclarLista(filtro, lista.enVivo, lista.anteriores, fijadas), filtro, ahora, pines);
    return {
      renglones: visibles.map((f) => aRenglon(f)),
      estadoBusqueda: cons.tipo === 'corta' ? 'Escriba al menos 4 dígitos para buscar por teléfono.'
        : cons.tipo === 'larga' ? `Un teléfono tiene como máximo ${MAX_DIGITOS_TELEFONO} dígitos.` : '',
    };
  }, [cons, lista.fichas, lista.enVivo, lista.anteriores, resTelefono, resNombre, resPalabra, prefijos, buscando, buscandoTelefono, errorPalabra, cursorPalabra, filtro, fijadas, ahora, tenantId, conversacionId]);

  // ── Anterior / siguiente ───────────────────────────────────────────────────
  const claves = renglones.map((r) => r.clave);
  const claveActiva = useMemo(() => {
    if (!conversacionId) return null;
    const exacta = mensajeId ? `${conversacionId}#${mensajeId}` : conversacionId;
    if (claves.includes(exacta)) return exacta;
    return claves.find((k) => k === conversacionId || k.startsWith(`${conversacionId}#`)) ?? null;
  }, [conversacionId, mensajeId, claves.join('|')]);

  const irA = useCallback((direccion: 1 | -1) => {
    const destino = vecina(claves, claveActiva, direccion);
    const r = destino === null ? null : renglones.find((x) => x.clave === destino);
    // `replace`: recorrer con el teclado no llena el historial; «atrás» vuelve a la lista.
    if (r) navigate(r.href, { replace: true });
  }, [claves.join('|'), claveActiva, renglones, navigate]);

  // ── Teclado: Alt+↑/↓ cambia de conversación · «/» busca · Esc vuelve ────────
  const manejador = useRef<(e: KeyboardEvent) => void>(() => {});
  manejador.current = (e) => {
    const destino = e.target as HTMLElement | null;
    const escribiendo = !!destino && (destino.tagName === 'INPUT' || destino.tagName === 'TEXTAREA' || destino.isContentEditable);
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      irA(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (e.key === '/' && !escribiendo && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      buscadorRef.current?.focus();
      buscadorRef.current?.select();
      return;
    }
    if (e.key === 'Escape') {
      // Con el foco en otro control (la casilla «No contactar», un campo) Escape es de ese control: no cierra la conversación.
      if (escribiendo && destino !== buscadorRef.current) return;
      if (document.activeElement === buscadorRef.current) {
        if (consulta) setConsulta(''); else buscadorRef.current?.blur();
        return;
      }
      if (conversacionId) navigate(rutaConversaciones(tenantId));
    }
  };
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => manejador.current(e);
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, []);

  // ── Altura: la pantalla ocupa lo que queda debajo de la cabecera ───────────
  useLayoutEffect(() => {
    const cab = document.querySelector('.cabecera');
    const aplicar = () => {
      const alto = cab ? Math.ceil(cab.getBoundingClientRect().height) : 0;
      raizRef.current?.style.setProperty('--cv-tope', `${alto + 8}px`);
    };
    aplicar();
    window.addEventListener('resize', aplicar);
    const obs = cab && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(aplicar) : null;
    if (cab && obs) obs.observe(cab);
    return () => { window.removeEventListener('resize', aplicar); obs?.disconnect(); };
  }, []);

  const indice = claveActiva ? claves.indexOf(claveActiva) : -1;
  const posicion = indice >= 0 ? `${indice + 1} de ${claves.length}` : `${claves.length}`;
  const hrefLista = rutaConversaciones(tenantId);
  const hrefUltimo = conversacionId ? rutaConversaciones(tenantId, conversacionId) : hrefLista;
  const errorBusqueda = errorTelefono ?? errorPalabra;

  return (
    <section className={`cv${conversacionId ? ' cv--chat' : ''}`} ref={raizRef}>
      {lista.error && <p role="alert" className="cv-error">{lista.error}</p>}
      <div className="cv-cuerpo">
        <ListaConversaciones
          consulta={consulta} onConsulta={setConsulta} buscadorRef={buscadorRef}
          filtro={filtro} onFiltro={elegirFiltro} conteos={conteos}
          renglones={renglones} claveActiva={claveActiva} ahora={ahora}
          estadoBusqueda={estadoBusqueda} errorBusqueda={errorBusqueda} buscando={buscando} enBusqueda={enBusqueda}
          cargando={lista.cargando && !enBusqueda}
          hayMas={lista.hayMas} cargandoMas={lista.cargandoMas} onMas={lista.cargarMas}
          hayMasPalabra={cursorPalabra !== null} onMasPalabra={masPalabra}
        />
        {fichaAbierta ? (
          <DetalleConversacion
            key={fichaAbierta.id}
            tenantId={tenantId} ficha={fichaAbierta} mensajeId={mensajeId} ahora={ahora}
            hrefLista={hrefLista} hrefUltimo={hrefUltimo}
            onAnterior={vecina(claves, claveActiva, -1) ? () => irA(-1) : null}
            onSiguiente={vecina(claves, claveActiva, 1) ? () => irA(1) : null}
            posicion={posicion} puedeGestionar={puedeGestionar} comercioActivo={estadoComercio === 'activo'}
          />
        ) : (
          <div className="cv-detalle cv-detalle--vacio">
            <p>
              {abierta?.estado === 'cargando' ? 'Abriendo la conversación…'
                : abierta?.estado === 'no-existe' || abierta?.estado === 'error' ? 'No se encontró esa conversación.'
                : 'Elija una conversación de la lista para ver sus mensajes.'}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
