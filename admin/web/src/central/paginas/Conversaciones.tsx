import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  collection, doc, getDocs, limit, onSnapshot, orderBy, query, where,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../../core/lib/firebase';
import { useSesion } from '../../core/lib/contexto';
import { ListaConversaciones, type Renglon } from '../componentes/ListaConversaciones';
import { DetalleConversacion } from '../componentes/DetalleConversacion';
import {
  aplicarFiltro, buscarPorNombre, buscarPorTelefono, clasificarConsulta, contarFiltros, fragmento, mensajeContiene,
  ordenarPorReciente, palabraParaIndice, rutaConversaciones, vecina, type Ficha, type Filtro,
} from '../lib/conversaciones';
import {
  SIMULACION_VACIA, conSimulacion, devolver, enviar, leerSimulacion, marcarLeida, tomar, type Simulacion,
} from '../lib/conversacionesSimulacion';
import '../estilos/conversaciones.css';

/**
 * =============================================================================
 * CONVERSACIONES — PROTOTIPO ESTILO WHATSAPP WEB (09/10/2026)
 * =============================================================================
 *
 * Una lista a la izquierda y UN detalle a la derecha, cada uno con su scroll. En
 * un celular son dos vistas: la lista, o el chat. La conversación abierta está
 * en la dirección (`?c=<id>&m=<mensaje>`; ver `rutaConversaciones`), así que se
 * puede copiar, volver con «atrás» y compartir.
 *
 * ES UN PROTOTIPO. «Tomar», «Devolver» y el campo de escritura son una
 * SIMULACIÓN: no envían nada, no llaman a ninguna Function y no escriben en
 * Firestore (ver `conversacionesSimulacion.ts`). La única escritura real que
 * queda es «No contactar», que ya existía y que las reglas ya permiten.
 *
 * Todo texto que viene de un cliente pasa por <TextoSeguro>.
 *
 * La consulta está anclada bajo /tenants/{tenantId}: es la ruta la que decide qué
 * se puede leer; no hay ningún `where('tenantId', …)` que un usuario pudiera
 * cambiar para mirar a otro negocio.
 */

/** Cuántas conversaciones se cargan. El plan pide búsqueda en el servidor; el prototipo carga y filtra acá. */
const MAX_CONVERSACIONES = 200;
/** Tope de resultados por palabra (plan: «máx. 20 resultados»). */
const MAX_RESULTADOS = 20;

/**
 * La simulación solo existe contra los emuladores. En una compilación de verdad
 * (VITE_USAR_EMULADORES distinto de «true») la pantalla no ofrece tomar ni
 * escribir, ni siquiera simulado: un botón que no hace nada, frente a un cliente
 * real, es peor que no tenerlo.
 */
const SIMULACION_ACTIVA = import.meta.env.VITE_USAR_EMULADORES === 'true';

const CLAVE_ALMACEN = (tenantId: string) => `novuchat-prototipo-conversaciones:${tenantId}`;

function ms(v: unknown): number | null {
  const t = v as { toMillis?: () => number } | null | undefined;
  return t && typeof t.toMillis === 'function' ? t.toMillis() : null;
}

function aFicha(d: QueryDocumentSnapshot): Ficha {
  const x = d.data();
  const turno = (x['turno'] ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    id: d.id,
    telefono: str(x['telefono']) || d.id.replace(/^wa_/, ''),
    nombre: str(x['nombreContacto']),
    ultimoMensaje: str(x['ultimoMensaje']),
    ultimoEn: ms(x['ultimoEn']),
    ultimoEntranteEn: ms(x['ultimoEntranteEn']),
    noLeidos: typeof x['noLeidos'] === 'number' ? Math.max(0, Math.floor(x['noLeidos'])) : 0,
    necesitaHumano: x['necesitaHumano'] === true,
    responde: turno['responde'] === 'persona' ? 'persona' : 'asistente',
    tomadoPor: str(turno['tomadoPor']),
    noContactar: x['noContactar'] === true,
    telefonoTrozos: Array.isArray(x['telefonoTrozos'])
      ? (x['telefonoTrozos'] as unknown[]).filter((t): t is string => typeof t === 'string') : [],
  };
}

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

interface Hallazgo { ficha: Ficha; mensajeId: string; texto: string; ts: number }

export function Conversaciones() {
  const { tenantId = '' } = useParams();
  // `key`: al cambiar de negocio todo el estado (búsqueda, filtros, simulación) empieza de cero.
  return <ConversacionesDe key={tenantId} tenantId={tenantId} />;
}

function ConversacionesDe({ tenantId }: { tenantId: string }) {
  const { conversacionId: deLaRuta } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { usuario } = useSesion();

  const conversacionId = deLaRuta ?? params.get('c');
  const mensajeId = params.get('m');
  const quienSoy = usuario?.displayName || usuario?.email?.split('@')[0] || 'Una persona';

  const ahora = useAhora(20_000);
  const [fichas, setFichas] = useState<Ficha[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [consulta, setConsulta] = useState('');
  const consultaEstable = useDebounce(consulta, 250);
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [fijadas, setFijadas] = useState<Set<string>>(new Set());
  const [hallazgos, setHallazgos] = useState<Hallazgo[]>([]);
  const [buscando, setBuscando] = useState(false);
  const buscadorRef = useRef<HTMLInputElement | null>(null);
  const raizRef = useRef<HTMLElement | null>(null);

  // ── Datos ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(
      query(collection(db, 'tenants', tenantId, 'conversaciones'), orderBy('ultimoEn', 'desc'), limit(MAX_CONVERSACIONES)),
      (i) => { setFichas(i.docs.map(aFicha)); setCargando(false); },
      () => { setError('No se pudieron leer las conversaciones.'); setCargando(false); },
    );
  }, [tenantId]);

  // ── Simulación (local; ver conversacionesSimulacion.ts) ────────────────────
  const [sim, setSim] = useState<Simulacion | null>(null);
  useEffect(() => {
    if (!tenantId) return;
    // La marca de la siembra vive en el documento del negocio: si se vuelve a
    // sembrar, lo guardado en el navegador de antes se descarta solo.
    return onSnapshot(doc(db, 'tenants', tenantId), (d) => {
      const semilla = typeof d.data()?.['prototipoSemilla'] === 'string' ? (d.data()?.['prototipoSemilla'] as string) : 'sin-semilla';
      setSim((previa) => (previa && previa.semilla === semilla
        ? previa : leerSimulacion(localStorage.getItem(CLAVE_ALMACEN(tenantId)), semilla)));
    }, () => setSim((previa) => previa ?? SIMULACION_VACIA('sin-semilla')));
  }, [tenantId]);
  useEffect(() => {
    if (sim) localStorage.setItem(CLAVE_ALMACEN(tenantId), JSON.stringify(sim));
  }, [sim, tenantId]);
  const cambiarSim = useCallback((f: (s: Simulacion) => Simulacion) => {
    setSim((s) => f(s ?? SIMULACION_VACIA('sin-semilla')));
  }, []);

  const fichasSim = useMemo(() => {
    const s = sim ?? SIMULACION_VACIA('sin-semilla');
    return ordenarPorReciente(fichas.map((f) => conSimulacion(f, s)));
  }, [fichas, sim]);
  const fichaAbierta = conversacionId ? fichasSim.find((f) => f.id === conversacionId) ?? null : null;

  // Abrir una conversación la marca como leída (en simulación) y la «fija» en la
  // lista filtrada para que «siguiente» no pierda el lugar.
  useEffect(() => {
    if (!conversacionId) return;
    setFijadas((previas) => (previas.has(conversacionId) ? previas : new Set(previas).add(conversacionId)));
  }, [conversacionId]);
  useEffect(() => {
    if (fichaAbierta && fichaAbierta.noLeidos > 0) cambiarSim((s) => marcarLeida(s, fichaAbierta.id, Date.now()));
  }, [fichaAbierta, cambiarSim]);
  function elegirFiltro(f: Filtro) { setFiltro(f); setFijadas(new Set()); }

  // ── Búsqueda ───────────────────────────────────────────────────────────────
  const cons = useMemo(() => clasificarConsulta(consultaEstable), [consultaEstable]);
  const hayPalabras = cons.tipo === 'texto' && cons.palabras.length > 0;

  // Por palabra: se le pregunta al índice (`palabras[]`) de cada conversación, que
  // es lo que en el servidor hará un `collectionGroup`. Máx. 20 resultados.
  const idsParaBuscar = useMemo(() => fichas.map((f) => f.id).join('|'), [fichas]);
  useEffect(() => {
    if (cons.tipo !== 'texto' || !cons.palabras.length) { setHallazgos([]); setBuscando(false); return; }
    const palabra = palabraParaIndice(cons.palabras);
    if (!palabra) return;
    let vigente = true;
    setBuscando(true);
    void (async () => {
      const salida: Hallazgo[] = [];
      await Promise.all(fichas.map(async (ficha) => {
        try {
          const r = await getDocs(query(
            collection(db, 'tenants', tenantId, 'conversaciones', ficha.id, 'mensajes'),
            where('palabras', 'array-contains', palabra), limit(5)));
          for (const d of r.docs) {
            const x = d.data();
            const texto = typeof x['texto'] === 'string' ? x['texto'] : '';
            if (!mensajeContiene(Array.isArray(x['palabras']) ? (x['palabras'] as string[]) : undefined, texto, cons.palabras)) continue;
            salida.push({ ficha, mensajeId: d.id, texto, ts: ms(x['ts']) ?? 0 });
          }
        } catch { /* una conversación que no se pudo leer no tumba la búsqueda */ }
      }));
      if (!vigente) return;
      salida.sort((a, b) => b.ts - a.ts);
      setHallazgos(salida.slice(0, MAX_RESULTADOS));
      setBuscando(false);
    })();
    return () => { vigente = false; };
    // `fichas` entra por su lista de ids: un mensaje nuevo no relanza la búsqueda.
  }, [cons, tenantId, idsParaBuscar]);

  const enBusqueda = cons.tipo === 'telefono' || cons.tipo === 'texto';

  const { renglones, estadoBusqueda } = useMemo(() => {
    const aRenglon = (f: Ficha, extra?: Partial<Renglon>): Renglon => ({
      clave: f.id, ficha: f, href: rutaConversaciones(tenantId, f.id), ...extra,
    });
    if (cons.tipo === 'telefono') {
      const r = buscarPorTelefono(fichasSim, cons.digitos);
      return {
        renglones: r.map((x) => aRenglon(x.ficha, { motivo: x.tipo === 'completo' ? 'Número completo' : x.tipo === 'final' ? 'Termina en …' + cons.digitos.slice(-4) : 'Empieza igual' })),
        estadoBusqueda: r.length === 0 ? 'Ningún teléfono coincide.'
          : `${r.length} ${r.length === 1 ? 'conversación' : 'conversaciones'} con ese número.`,
      };
    }
    if (cons.tipo === 'texto') {
      const porNombre = buscarPorNombre(fichasSim, cons.texto).map((f) => aRenglon(f, { motivo: 'Nombre' }));
      const porPalabra: Renglon[] = hallazgos.map((h) => {
        const f = fichasSim.find((x) => x.id === h.ficha.id) ?? h.ficha;
        return {
          clave: `${f.id}#${h.mensajeId}`, ficha: f, href: rutaConversaciones(tenantId, f.id, h.mensajeId),
          coincidencia: { fragmento: fragmento(h.texto, cons.palabras), ts: h.ts },
        };
      });
      const todos = [...porNombre, ...porPalabra];
      let estado: string;
      if (!cons.palabras.length && !porNombre.length) estado = 'Escriba al menos 3 letras de una palabra.';
      else if (buscando) estado = `Buscando «${cons.texto}»…`;
      else estado = todos.length === 0 ? `Nada con «${cons.texto}». Solo se buscan mensajes recibidos desde que existe el índice de palabras.`
        : `${porPalabra.length} ${porPalabra.length === 1 ? 'mensaje' : 'mensajes'}${porNombre.length ? ` y ${porNombre.length} por nombre` : ''}.`;
      return { renglones: todos, estadoBusqueda: estado };
    }
    const visibles = aplicarFiltro(fichasSim, filtro, ahora, new Set([...fijadas, ...(conversacionId ? [conversacionId] : [])]));
    return {
      renglones: visibles.map((f) => aRenglon(f)),
      estadoBusqueda: cons.tipo === 'corta' ? 'Escriba al menos 4 dígitos para buscar por teléfono.' : '',
    };
  }, [cons, fichasSim, hallazgos, buscando, filtro, fijadas, ahora, tenantId, conversacionId]);

  const conteos = useMemo(() => contarFiltros(fichasSim, ahora), [fichasSim, ahora]);

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
      if (document.activeElement === buscadorRef.current) {
        if (consulta) setConsulta(''); else buscadorRef.current?.blur();
        return;
      }
      if (destino && destino.tagName === 'TEXTAREA') { destino.blur(); return; }
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

  return (
    <section className={`cv${conversacionId ? ' cv--chat' : ''}`} ref={raizRef}>
      <div className="cv-prototipo" role="note">
        <strong>PROTOTIPO, datos ficticios.</strong>{' '}
        <span className="cv-prototipo-detalle">
          {SIMULACION_ACTIVA
            ? 'Tomar, Devolver y escribir son una simulación: no se envía nada ni se escribe en la base.'
            : 'Tomar y escribir no están disponibles en este prototipo fuera de los emuladores.'}
        </span>
        <span className="cv-atajos"> Alt+↑/↓ cambia de conversación · / busca · Esc vuelve.</span>
        {SIMULACION_ACTIVA && (
          <button type="button" className="btn btn-ghost cv-reiniciar"
            onClick={() => { cambiarSim((s) => SIMULACION_VACIA(s.semilla)); }}>
            Reiniciar simulación
          </button>
        )}
      </div>
      {error && <p role="alert" className="cv-error">{error}</p>}
      <div className="cv-cuerpo">
        <ListaConversaciones
          consulta={consulta} onConsulta={setConsulta} buscadorRef={buscadorRef}
          filtro={filtro} onFiltro={elegirFiltro} conteos={conteos}
          renglones={renglones} claveActiva={claveActiva} ahora={ahora}
          estadoBusqueda={estadoBusqueda} buscando={buscando && hayPalabras} enBusqueda={enBusqueda}
          totalConversaciones={fichas.length} cargando={cargando}
        />
        {fichaAbierta ? (
          <DetalleConversacion
            key={fichaAbierta.id}
            tenantId={tenantId} ficha={fichaAbierta} mensajeId={mensajeId} ahora={ahora} quienSoy={quienSoy}
            enviados={sim?.enviados[fichaAbierta.id] ?? []}
            hrefLista={hrefLista} hrefUltimo={hrefUltimo}
            onTomar={() => cambiarSim((s) => tomar(s, fichaAbierta.id, quienSoy, Date.now()))}
            onDevolver={() => cambiarSim((s) => devolver(s, fichaAbierta.id, Date.now()))}
            onEnviar={(t) => cambiarSim((s) => enviar(s, fichaAbierta.id, t, Date.now()))}
            onAnterior={vecina(claves, claveActiva, -1) ? () => irA(-1) : null}
            onSiguiente={vecina(claves, claveActiva, 1) ? () => irA(1) : null}
            posicion={posicion}
            simulacion={SIMULACION_ACTIVA}
          />
        ) : (
          <div className="cv-detalle cv-detalle--vacio">
            <p>
              {conversacionId && !cargando
                ? 'No se encontró esa conversación.'
                : 'Elija una conversación de la lista para ver sus mensajes.'}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
