/**
 * CAMPAÑAS (Andres, 24/09/2026): los anuncios de Meta del comercio.
 *
 * Cada campaña es el TEXTO EXACTO que el anuncio deja escrito en WhatsApp, con
 * una fecha de inicio y una de fin. Cuando alguien llega con ese texto, el
 * asistente se salta el menú y le responde a lo que vino a buscar.
 *
 * LA PANTALLA ACOMPAÑA, NO DECIDE (CLAUDE.md, base comercial §7):
 *   - el tope del plan lo hace cumplir la regla de `config/campanas`;
 *   - fechas, duplicados, emergencia y contenido los revisa `verificarCampanas`
 *     antes de aplicar, y el flujo recibe SOLO lo aprobado.
 * Acá se avisa antes de guardar, con las mismas cifras, y se muestra en qué
 * quedó cada campaña. Se escribe con `updateDoc` y solo `lista` más el sello:
 * `revision` y `vigentes` son del servidor y la regla rechaza tocarlos.
 */
import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { Link, useParams } from 'react-router-dom';
import { auth, db } from '../lib/firebase';
import { TextoSeguro } from '../componentes/TextoSeguro';
import { PLANES, PLANES_PUBLICADOS, esPlanPublicado, esPlanVendible, limiteDeCampanas, nombreDePlan } from '../lib/planes';
import {
  TOPE_TEXTO_CAMPANA, diaBolivia, estadoVisible, fechaLegible, hashListaEnNavegador, idNuevo,
  leerCampanas, problemaEnPantalla, sumarDias,
  type Campana, type RevisionDeCampana,
} from '../lib/campanas';

const VACIA = (hoy: string): Campana => ({ id: '', texto: '', inicio: hoy, fin: sumarDias(hoy, 30) });

/** El plan publicado siguiente que admite más campañas que el tope de hoy, si existe. */
function planConMasCampanas(plan: unknown, limite: number): { nombre: string; campanas: number } | null {
  // Un plan del catálogo que no se publica (BYOC, el interno de demostración)
  // no tiene escalera: se decide por el catálogo, no por el nombre.
  if (esPlanVendible(plan) && !esPlanPublicado(plan)) return null;
  const orden = PLANES_PUBLICADOS as readonly (keyof typeof PLANES)[];
  const desde = esPlanVendible(plan) ? orden.indexOf(plan) : -1;
  for (const p of orden.slice(desde + 1)) {
    if (PLANES[p].campanas > limite) return { nombre: PLANES[p].nombre, campanas: PLANES[p].campanas };
  }
  return null;
}

function leerRevisiones(valor: unknown): { hash: string; porCampana: Record<string, RevisionDeCampana> } {
  if (typeof valor !== 'object' || valor === null) return { hash: '', porCampana: {} };
  const v = valor as Record<string, unknown>;
  const por = typeof v['porCampana'] === 'object' && v['porCampana'] !== null
    ? v['porCampana'] as Record<string, RevisionDeCampana> : {};
  return { hash: typeof v['hash'] === 'string' ? v['hash'] : '', porCampana: por };
}

export function Campanas() {
  const { tenantId = '' } = useParams();
  const hoy = diaBolivia();
  const [existe, setExiste] = useState(false);
  const [lista, setLista] = useState<Campana[]>([]);
  const [revision, setRevision] = useState<{ hash: string; porCampana: Record<string, RevisionDeCampana> }>({ hash: '', porCampana: {} });
  const [cuenta, setCuenta] = useState<Record<string, unknown> | null>(null);
  const [hashActual, setHashActual] = useState<string | null>(null);
  const [edicion, setEdicion] = useState<Campana>(VACIA(hoy));
  const [original, setOriginal] = useState<Campana | null>(null);
  const [estado, setEstado] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    const a = onSnapshot(doc(db, 'tenants', tenantId, 'config', 'campanas'), (d) => {
      setExiste(d.exists());
      setLista(leerCampanas(d.get('lista')));
      setRevision(leerRevisiones(d.get('revision')));
    }, () => setEstado('No se pudieron leer las campañas.'));
    const b = onSnapshot(doc(db, 'tenants', tenantId, 'cuenta', 'estado'),
      (d) => setCuenta(d.exists() ? d.data() : null), () => setCuenta(null));
    return () => { a(); b(); };
  }, [tenantId]);

  useEffect(() => { void hashListaEnNavegador(lista).then(setHashActual); }, [lista]);
  // Sin hash en el navegador se confía en el servidor, como en Configuración.
  const fresca = hashActual === null || (revision.hash !== '' && revision.hash === hashActual);

  const limite = limiteDeCampanas(cuenta);
  const plan = cuenta?.['plan'];
  const siguiente = planConMasCampanas(plan, limite);
  const editando = original !== null;
  const lleno = !editando && lista.length >= limite;
  const problema = useMemo(() => problemaEnPantalla(edicion, lista, original, hoy), [edicion, lista, original, hoy]);

  const escribir = async (nueva: Campana[]) => {
    const datos = { lista: nueva, actualizadoPor: auth.currentUser?.uid ?? '', actualizadoEn: serverTimestamp() };
    const ref = doc(db, 'tenants', tenantId, 'config', 'campanas');
    await (existe ? updateDoc(ref, datos) : setDoc(ref, datos));
  };

  const guardar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    if (problema) { setEstado(problema.texto); return; }
    const c: Campana = { ...edicion, id: edicion.id || idNuevo(), texto: edicion.texto.trim() };
    const nueva = editando ? lista.map((x) => (x.id === c.id ? c : x)) : [...lista, c];
    setGuardando(true); setEstado(null);
    try {
      await escribir(nueva);
      setEdicion(VACIA(hoy)); setOriginal(null);
      setEstado('Guardada. La revisamos antes de aplicarla: en unos segundos ves el resultado en la lista.');
    } catch {
      setEstado(lleno
        ? 'Tu plan no admite más campañas.'
        : 'El servidor rechazó la campaña. Revisa el texto y las fechas.');
    } finally { setGuardando(false); }
  };

  const eliminar = async (c: Campana) => {
    if (!window.confirm('¿Eliminar esta campaña? Deja de aplicarse enseguida.')) return;
    try {
      await escribir(lista.filter((x) => x.id !== c.id));
      if (original?.id === c.id) { setEdicion(VACIA(hoy)); setOriginal(null); }
      setEstado('Campaña eliminada.');
    } catch { setEstado('No se pudo eliminar la campaña.'); }
  };

  return (
    <section>
      <h2>Campañas</h2>
      <p className="ayuda">
        Cuando creas un anuncio de Meta que lleva a WhatsApp, eliges el mensaje que le queda
        escrito a la persona. <strong>Pega aquí ese mismo texto</strong>, con las fechas de la
        campaña. Cuando alguien llegue con ese mensaje, el asistente no le muestra el menú: le
        responde directo a lo que vino a buscar.
      </p>
      <p className="ayuda">
        No importan las mayúsculas, las tildes, los signos ni los emojis; una palabra de más o de
        menos, sí. Si el texto es igual a una opción de tu menú, la persona entra directo a esa
        opción. Antes de aplicarla revisamos que las fechas tengan sentido y que el texto sea de lo
        que tu negocio ofrece.
      </p>

      <div className={`uso-plan${lista.length > limite ? ' uso-plan-lleno' : ''}`}>
        <p className="uso-plan-cifra">
          <strong>{lista.length} de {limite} campañas</strong>
          {nombreDePlan(plan) && <> (plan {nombreDePlan(plan)})</>}
        </p>
        {limite === 0 && (
          <p className="ayuda"><strong>Tu plan no incluye campañas.</strong>
            {siguiente && <> El plan {siguiente.nombre} admite hasta {siguiente.campanas} a la vez.</>}</p>
        )}
        {limite > 0 && lista.length >= limite && (
          <p className="ayuda"><strong>Llegaste al tope de tu plan.</strong> Puedes editar o eliminar las
            que tienes.{siguiente && <> El plan {siguiente.nombre} admite hasta {siguiente.campanas}.</>}</p>
        )}
        {lista.length > limite && limite > 0 && (
          <p className="ayuda">Tienes más campañas cargadas de las que admite tu plan: las que sobran no se aplican.</p>
        )}
        {siguiente && (limite === 0 || lista.length >= limite) && (
          <p className="ayuda">Para cambiar de plan, escríbenos desde{' '}
            <Link to={`/negocio/${encodeURIComponent(tenantId)}/reclamos`}>Reclamos</Link> con la
            categoría <em>Facturación</em>.</p>
        )}
      </div>

      {lista.length > 0 && (
        <table>
          <thead><tr><th>Texto del anuncio</th><th>Desde</th><th>Hasta</th><th>Estado</th><th /></tr></thead>
          <tbody>
            {lista.map((c) => {
              const v = estadoVisible(c, revision.porCampana[c.id], fresca, hoy);
              return (
                <tr key={c.id} className={v.clase === 'mal' ? 'alerta' : ''}>
                  <td><TextoSeguro valor={c.texto} maxLargo={TOPE_TEXTO_CAMPANA} /></td>
                  <td>{fechaLegible(c.inicio)}</td>
                  <td>{fechaLegible(c.fin)}</td>
                  <td>
                    <strong>{v.etiqueta}</strong>
                    {v.motivo && <><br /><span className="ayuda"><TextoSeguro valor={v.motivo} maxLargo={300} /></span></>}
                  </td>
                  <td>
                    <button type="button" onClick={() => { setEdicion(c); setOriginal(c); setEstado(null); }}>Editar</button>{' '}
                    <button type="button" onClick={() => void eliminar(c)}>Eliminar</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {(editando || limite > lista.length) && (
        <form onSubmit={(e) => void guardar(e)}>
          <h3>{editando ? 'Editar campaña' : 'Nueva campaña'}</h3>
          <label>
            Texto exacto que deja el anuncio
            <textarea value={edicion.texto} maxLength={TOPE_TEXTO_CAMPANA} rows={3}
              aria-invalid={problema?.campo === 'texto'}
              onChange={(e) => setEdicion({ ...edicion, texto: e.target.value })} />
          </label>
          <label>
            Desde
            <input type="date" value={edicion.inicio} min={editando && original ? (original.inicio < hoy ? original.inicio : hoy) : hoy}
              aria-invalid={problema?.campo === 'inicio'}
              onChange={(e) => setEdicion({ ...edicion, inicio: e.target.value })} />
          </label>
          <label>
            Hasta (incluido)
            <input type="date" value={edicion.fin} min={edicion.inicio || hoy}
              aria-invalid={problema?.campo === 'fin'}
              onChange={(e) => setEdicion({ ...edicion, fin: e.target.value })} />
          </label>
          {problema && edicion.texto.trim() !== '' && <p className="ayuda alerta">{problema.texto}</p>}
          <button type="submit" disabled={guardando || problema !== null}>
            {editando ? 'Guardar cambios' : 'Agregar campaña'}
          </button>
          {editando && (
            <button type="button" onClick={() => { setEdicion(VACIA(hoy)); setOriginal(null); }}>Cancelar</button>
          )}
        </form>
      )}

      {estado && <p className="ayuda">{estado}</p>}
    </section>
  );
}
