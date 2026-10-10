import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  collection, doc, getDoc, getDocs, limit, limitToLast, onSnapshot, orderBy, query, startAfter, startAt, updateDoc,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../../core/lib/firebase';
import { TextoSeguro } from './TextoSeguro';
import {
  etiquetaDia, horaCorta, iniciales, mismoDia, necesitaHumanoDe, textoRestante, ventanaDeFicha, type Ficha,
} from '../lib/conversaciones';

/**
 * EL DETALLE DE UNA CONVERSACIÓN: un solo hilo, con su propio scroll.
 *
 * Tres cosas que la pantalla de antes hacía mal y esta hace distinto:
 *
 *  1. Traía los 300 mensajes MÁS VIEJOS (`orderBy('ts','asc'), limit(300)`): en
 *     una conversación larga lo último —lo que el cliente acaba de escribir—
 *     no aparecía. Acá se piden los ÚLTIMOS (`limitToLast`) y los anteriores se
 *     cargan a pedido.
 *  2. Al cambiar de conversación quedaban los mensajes de la anterior hasta que
 *     llegaban los nuevos. Acá el hilo se vacía al cambiar la clave.
 *  3. Lista e hilo compartían el scroll de la página. Acá el hilo tiene el suyo.
 *
 * Todo texto que viene de un cliente pasa por <TextoSeguro>, nunca por HTML.
 */

const PAGINA = 50;
const ANTES = 20;
const DESPUES = 40;

interface Msg {
  id: string;
  texto: string;
  tipo: string;
  direccion: 'entrante' | 'saliente';
  autor: string;
  ts: number;
  /** El documento, para pedir los anteriores `startAfter` de él sin una lectura de más y sin perder los empatados. */
  snap: QueryDocumentSnapshot;
}

/**
 * LO QUE LLEGÓ Y NO ERA TEXTO. El comprobante de pago es lo más importante de
 * una conversación de venta; la imagen no se muestra (NovuChat no la guarda,
 * vive en Meta), pero el mensaje se marca como adjunto para que se encuentre.
 * Mostrar la imagen son tres cosas más (guardar el `media id`, una función que
 * la sirva, el permiso): prometerla con una miniatura rota sería peor.
 */
const ADJUNTOS: Record<string, string> = {
  image: '🧾 Imagen — puede ser el comprobante',
  document: '📄 Documento — puede ser el comprobante',
  audio: '🎤 Audio',
  location: '📍 Ubicación',
  order: '🛒 Pedido del catálogo',
  interactive: '👆 Respuesta a una lista o botón',
};

function aMensaje(d: QueryDocumentSnapshot): Msg {
  const x = d.data();
  const ts = x['ts'] as { toMillis?: () => number } | undefined;
  return {
    id: d.id,
    texto: typeof x['texto'] === 'string' ? x['texto'] : '',
    tipo: typeof x['tipo'] === 'string' ? x['tipo'] : 'text',
    direccion: x['direccion'] === 'entrante' ? 'entrante' : 'saliente',
    autor: typeof x['autor'] === 'string' ? x['autor'] : '',
    ts: ts?.toMillis ? ts.toMillis() : 0,
    snap: d,
  };
}

const porTs = (a: Msg, b: Msg) => a.ts - b.ts || a.id.localeCompare(b.id);

function unir(a: readonly Msg[], b: readonly Msg[]): Msg[] {
  const m = new Map<string, Msg>();
  for (const x of [...a, ...b]) m.set(x.id, x);
  return [...m.values()].sort(porTs);
}

function useMensajes(tenantId: string, conversacionId: string, mensajeId: string | null) {
  const [mensajes, setMensajes] = useState<Msg[]>([]);
  const [hayAntes, setHayAntes] = useState(false);
  const [cargandoAntes, setCargandoAntes] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saltoFallido, setSaltoFallido] = useState(false);
  // Para qué clave son los mensajes que hay en pantalla: tras un cambio hay un
  // instante en que siguen siendo los de la anterior, y no se debe colocar el scroll con ellos.
  const [cargadaPara, setCargadaPara] = useState('');
  const clave = `${tenantId}/${conversacionId}/${mensajeId ?? ''}`;
  const claveVista = useRef('');
  const mensajesRef = useRef<Msg[]>([]);
  mensajesRef.current = mensajes;
  const cargoAnteriores = useRef(false);
  const cargandoAntesRef = useRef(false);

  // Cambió la conversación o el mensaje buscado: empieza de cero (nada de los
  // mensajes de la anterior).
  useEffect(() => {
    setMensajes([]); setHayAntes(false); setCargando(true); setError(null); setSaltoFallido(false); setCargadaPara('');
    setCargandoAntes(false);
    cargoAnteriores.current = false; cargandoAntesRef.current = false;
    claveVista.current = clave;
  }, [clave]);

  const modoSalto = mensajeId !== null && !saltoFallido;
  const colMensajes = () => collection(db, 'tenants', tenantId, 'conversaciones', conversacionId, 'mensajes');

  // Modo normal: el oyente en vivo mira SOLO los últimos 50. Lo que se va corriendo fuera de esa ventana (llegan
  // mensajes nuevos) no desaparece de la pantalla: lo que se vio se acumula (`unir`). Los anteriores vienen con `getDocs`.
  useEffect(() => {
    if (!tenantId || !conversacionId || modoSalto) return;
    return onSnapshot(
      query(colMensajes(), orderBy('ts', 'asc'), limitToLast(PAGINA)),
      (i) => {
        setMensajes((previos) => unir(previos, i.docs.map(aMensaje)));
        if (!cargoAnteriores.current) setHayAntes(i.size >= PAGINA);
        setCargadaPara(clave);
        setCargando(false);
      },
      () => { setError('No se pudieron leer los mensajes.'); setCargando(false); },
    );
  }, [tenantId, conversacionId, modoSalto]);

  // Modo salto: una ventana ALREDEDOR del mensaje que se buscó (una lectura,
  // no en vivo; «Ir a lo último» vuelve al modo normal).
  useEffect(() => {
    if (!tenantId || !conversacionId || !modoSalto || !mensajeId) return;
    let vigente = true;
    void (async () => {
      try {
        const col = colMensajes();
        const alvo = await getDoc(doc(col, mensajeId));
        const ts = alvo.data()?.['ts'];
        if (!alvo.exists() || !ts) { if (vigente) setSaltoFallido(true); return; }
        const [despues, antes] = await Promise.all([
          getDocs(query(col, orderBy('ts', 'asc'), startAt(ts), limit(DESPUES + 1))),
          getDocs(query(col, orderBy('ts', 'desc'), startAfter(ts), limit(ANTES))),
        ]);
        if (!vigente) return;
        setMensajes(unir(antes.docs.map(aMensaje), despues.docs.map(aMensaje)));
        setHayAntes(antes.size >= ANTES);
        setCargadaPara(clave);
        setCargando(false);
      } catch {
        if (vigente) { setError('No se pudo abrir el mensaje.'); setCargando(false); }
      }
    })();
    return () => { vigente = false; };
  }, [tenantId, conversacionId, modoSalto, mensajeId]);

  // Los anteriores al primero que se ve, con `getDocs` (en los dos modos). La respuesta de otra conversación se descarta.
  const cargarAnteriores = useCallback(async () => {
    const primero = mensajesRef.current[0];
    if (!primero || cargandoAntesRef.current) return;
    const miClave = claveVista.current;
    cargandoAntesRef.current = true;
    setCargandoAntes(true);
    try {
      const antes = await getDocs(query(colMensajes(), orderBy('ts', 'desc'), startAfter(primero.snap), limit(PAGINA)));
      if (claveVista.current !== miClave) return;
      cargoAnteriores.current = true;
      setMensajes((actuales) => unir(antes.docs.map(aMensaje), actuales));
      setHayAntes(antes.size >= PAGINA);
    } catch {
      if (claveVista.current === miClave) setError('No se pudieron cargar los mensajes anteriores.');
    } finally {
      if (claveVista.current === miClave) { cargandoAntesRef.current = false; setCargandoAntes(false); }
    }
  }, [tenantId, conversacionId]);

  return { clave, cargadaPara, mensajes, hayAntes, cargandoAntes, cargando, error, modoSalto, saltoFallido, cargarAnteriores };
}

export interface PropsDetalle {
  tenantId: string;
  ficha: Ficha;
  mensajeId: string | null;
  ahora: number;
  hrefLista: string;
  hrefUltimo: string;
  onAnterior: (() => void) | null;
  onSiguiente: (() => void) | null;
  posicion: string;
  /** Quien mira puede cambiar «No contactar» (admin u oper del negocio); el propietario de NovuChat solo mira. */
  puedeGestionar: boolean;
}

export function DetalleConversacion(p: PropsDetalle) {
  const { tenantId, ficha, mensajeId } = p;
  const m = useMensajes(tenantId, ficha.id, mensajeId);
  const hiloRef = useRef<HTMLDivElement | null>(null);
  const contenidoRef = useRef<HTMLDivElement | null>(null);
  const pegado = useRef(true);
  const restaurar = useRef<{ alto: number; top: number } | null>(null);
  const ultimoVisto = useRef('');
  const [errorNoContactar, setErrorNoContactar] = useState<string | null>(null);

  const visibles = m.mensajes;
  const claveHilo = `${ficha.id}/${mensajeId ?? ''}`;

  // Otra conversación: el error de «No contactar» era de la anterior.
  useEffect(() => { setErrorNoContactar(null); }, [ficha.id]);

  // Posición del scroll: al fondo al abrir y cuando llega algo estando al fondo;
  // en el mensaje buscado cuando se llegó por una búsqueda; sin saltos cuando se
  // cargan mensajes anteriores.
  useLayoutEffect(() => {
    const el = hiloRef.current;
    if (!el || m.cargando || m.cargadaPara !== m.clave) return;
    if (restaurar.current) {
      el.scrollTop = el.scrollHeight - restaurar.current.alto + restaurar.current.top;
      restaurar.current = null;
      return;
    }
    const primera = ultimoVisto.current !== claveHilo;
    if (primera) {
      ultimoVisto.current = claveHilo;
      if (mensajeId && m.modoSalto) {
        el.querySelector(`[data-mid="${CSS.escape(mensajeId)}"]`)?.scrollIntoView({ block: 'center' });
      } else {
        el.scrollTop = el.scrollHeight;
      }
      pegado.current = !mensajeId;
      return;
    }
    if (pegado.current) el.scrollTop = el.scrollHeight;
  }, [visibles.length, m.cargando, m.cargadaPara, m.clave, claveHilo, mensajeId, m.modoSalto]);

  // Si el contenido cambia de alto estando al fondo (llega un mensaje, aparece o
  // desaparece un botón, se acomoda una lectura de la caché), se sigue al fondo.
  useEffect(() => {
    const el = hiloRef.current;
    const contenido = contenidoRef.current;
    if (!el || !contenido || typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver(() => { if (pegado.current) el.scrollTop = el.scrollHeight; });
    obs.observe(contenido);
    return () => obs.disconnect();
  }, []);

  function alScroll() {
    const el = hiloRef.current;
    if (el) pegado.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  function masAntiguos() {
    const el = hiloRef.current;
    if (el) restaurar.current = { alto: el.scrollHeight, top: el.scrollTop };
    void m.cargarAnteriores();
  }

  async function cambiarNoContactar(valor: boolean) {
    setErrorNoContactar(null);
    try {
      await updateDoc(doc(db, 'tenants', tenantId, 'conversaciones', ficha.id), { noContactar: valor });
    } catch {
      setErrorNoContactar('No se pudo cambiar «No contactar». Vuelva a intentarlo.');
    }
  }

  const v = ventanaDeFicha(ficha, p.ahora);

  let diaPrevio = 0;
  return (
    <div className="cv-detalle" data-testid="detalle">
      <header className="cv-det-cab">
        <Link to={p.hrefLista} className="btn btn-ghost cv-volver" aria-label="Volver a la lista de conversaciones">
          ← <span>Conversaciones</span>
        </Link>
        <div className="cv-avatar" aria-hidden="true">{iniciales(ficha.nombre)}</div>
        <div className="cv-det-titulo">
          <strong><TextoSeguro valor={ficha.nombre || ficha.telefono} maxLargo={60} /></strong>
          <span className="text-muted">
            +<TextoSeguro valor={ficha.telefono} maxLargo={15} />
          </span>
        </div>
        {/* Sin dato (una conversación de antes de H1): no se pinta pastilla, porque «cerrada» sería falso. */}
        {v.estado !== 'sin-dato' && (
          <span className={`cv-pastilla cv-pastilla--${v.estado}`} title="Ventana de 24 h de WhatsApp: desde el último mensaje del cliente">
            {v.estado === 'cerrada' ? 'Ventana cerrada' : `Ventana: ${textoRestante(v.restanteMs)}`}
          </span>
        )}
        <div className="cv-det-acciones">
          <button type="button" className="btn btn-secondary btn-icon" onClick={p.onAnterior ?? undefined}
            disabled={!p.onAnterior} aria-label="Conversación anterior (Alt+↑)" title="Anterior (Alt+↑)">↑</button>
          <button type="button" className="btn btn-secondary btn-icon" onClick={p.onSiguiente ?? undefined}
            disabled={!p.onSiguiente} aria-label="Conversación siguiente (Alt+↓)" title="Siguiente (Alt+↓)">↓</button>
          <span className="text-muted cv-pos">{p.posicion}</span>
        </div>
      </header>

      <div className="cv-det-sub">
        {necesitaHumanoDe(ficha, p.ahora) && (
          <span className="cv-etiqueta cv-etiqueta--humano">Necesita que intervenga una persona</span>
        )}
        {p.puedeGestionar ? (
          <label className="cv-nocontactar">
            <input type="checkbox" checked={ficha.noContactar}
              onChange={(e) => void cambiarNoContactar(e.target.checked)} />
            {' '}No contactar
          </label>
        ) : (
          // El propietario de NovuChat mira con una ventana de soporte y no escribe: el control no se ofrece.
          ficha.noContactar && <span className="cv-etiqueta">No contactar</span>
        )}
        {errorNoContactar && <span role="alert" className="cv-error">{errorNoContactar}</span>}
      </div>

      {m.saltoFallido && (
        <p className="cv-aviso-linea" role="status">
          El mensaje buscado ya no está en esta conversación. Se muestran los últimos.
        </p>
      )}
      {m.error && <p role="alert" className="cv-error cv-aviso-linea">{m.error}</p>}

      <div className="cv-hilo" ref={hiloRef} onScroll={alScroll} tabIndex={0} aria-label="Mensajes de la conversación">
        <div ref={contenidoRef}>
        {m.hayAntes && (
          <div className="cv-mas">
            <button type="button" className="btn btn-secondary" disabled={m.cargandoAntes} onClick={masAntiguos}>
              {m.cargandoAntes ? 'Cargando…' : 'Cargar mensajes anteriores'}
            </button>
          </div>
        )}
        {m.cargando && <p className="cv-vacio">Cargando mensajes…</p>}
        {!m.cargando && visibles.length === 0 && (
          <p className="cv-vacio">Esta conversación todavía no tiene mensajes guardados.</p>
        )}
        <ol className="cv-mensajes">
          {visibles.map((x) => {
            const nuevoDia = !mismoDia(x.ts, diaPrevio);
            diaPrevio = x.ts;
            // Solo se rotula cuando el mensaje dice quién lo escribió (los de hoy no lo dicen: no se inventa).
            const rotuloAutor = x.direccion === 'saliente'
              ? (x.autor === 'persona' ? 'Persona del negocio' : x.autor === 'asistente' ? 'Asistente' : '') : '';
            return (
              <li key={x.id} className="cv-fila">
                {nuevoDia && x.ts > 0 && <div className="cv-dia"><span>{etiquetaDia(x.ts, p.ahora)}</span></div>}
                <div data-mid={x.id}
                  className={`cv-burbuja cv-burbuja--${x.direccion}${x.id === mensajeId && m.modoSalto ? ' cv-burbuja--buscada' : ''}`}>
                  {rotuloAutor && <span className="cv-autor">{rotuloAutor}</span>}
                  {ADJUNTOS[x.tipo] && <span className="adjunto">{ADJUNTOS[x.tipo]}</span>}
                  <TextoSeguro valor={x.texto} />
                  <time dateTime={x.ts ? new Date(x.ts).toISOString() : undefined}>{x.ts ? horaCorta(x.ts) : ''}</time>
                </div>
              </li>
            );
          })}
        </ol>
        {m.modoSalto && (
          <div className="cv-mas">
            <Link to={p.hrefUltimo} className="btn btn-cta">Ir a los últimos mensajes ↓</Link>
          </div>
        )}
        </div>
      </div>

    </div>
  );
}
