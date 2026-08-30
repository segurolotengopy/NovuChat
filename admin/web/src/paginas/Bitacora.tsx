import { useCallback, useEffect, useState } from 'react';
import { getDocs, type QueryDocumentSnapshot } from 'firebase/firestore';
import { useParams } from 'react-router-dom';
import { db } from '../lib/firebase';
import { useSesion } from '../lib/contexto';
import { TextoSeguro } from '../componentes/TextoSeguro';
import {
  construirConsulta, POR_PAGINA, RESULTADOS, TIPOS, tenantDe,
  type Filtros, type Resultado, type Tipo,
} from '../lib/bitacora';

interface Fila {
  id: string;
  tenant: string;
  ts?: { toDate(): Date };
  tipo?: unknown;
  resultado?: unknown;
  destinoEnmascarado?: unknown;
  codigo?: unknown;
  detalle?: unknown;
  latenciaMs?: unknown;
  tamanoTexto?: unknown;
}

/**
 * Bitácora: qué se envió, a quién, cuándo y con qué resultado.
 *
 * ES EVIDENCIA, no una tabla informativa. Tres propiedades sostienen eso y
 * ninguna está en esta pantalla: es inmutable (nadie la edita ni la borra, ni
 * siquiera el propietario de NovuChat), la escribe solo la ruta de ingesta, y
 * **no guarda el texto de los mensajes**.
 *
 * POR QUÉ NO HAY UNA COLUMNA CON EL TEXTO. Ya está decidido que el propietario
 * de NovuChat no lee conversaciones sin una ventana de soporte que le otorgue el
 * comercio. Si esta pantalla mostrara el contenido, sería exactamente esa puerta
 * trasera, y peor: consultable entre todos los comercios a la vez. Lo que hay es
 * `conversacionId`, para saltar al hilo cuando corresponda y con el permiso que
 * corresponde.
 *
 * PAGINACIÓN POR CURSOR. Una bitácora crece sin techo: nunca se trae entera. Se
 * usa `startAfter` y no un desplazamiento numérico, que en Firestore obligaría a
 * leer —y pagar— todos los documentos salteados.
 */
export function Bitacora() {
  const { tenantId: tenantDeLaRuta } = useParams();
  const { permisos } = useSesion();
  const esVistaPlataforma = !tenantDeLaRuta && permisos.propietario;

  const [tipo, setTipo] = useState<Tipo | ''>('');
  const [resultado, setResultado] = useState<Resultado | ''>('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');

  const [filas, setFilas] = useState<Fila[]>([]);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot | null>(null);
  const [hayMas, setHayMas] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtros: Filtros = {
    tenantId: esVistaPlataforma ? null : (tenantDeLaRuta ?? null),
    tipo: tipo || null,
    resultado: resultado || null,
    desde: desde ? new Date(`${desde}T00:00:00`) : null,
    hasta: hasta ? new Date(`${hasta}T23:59:59`) : null,
  };

  const traer = useCallback(async (siguiente: boolean) => {
    setCargando(true); setError(null);
    try {
      const instantanea = await getDocs(
        construirConsulta(db, filtros, siguiente ? cursor : null));
      const nuevas = instantanea.docs.map((d) => ({
        id: d.id, tenant: tenantDe(d), ...d.data(),
      })) as Fila[];
      setFilas(siguiente ? [...filas, ...nuevas] : nuevas);
      setCursor(instantanea.docs[instantanea.docs.length - 1] ?? null);
      setHayMas(instantanea.docs.length === POR_PAGINA);
    } catch {
      // El error más probable en producción es un índice que falta. En el
      // emulador no aparece nunca, porque el emulador no los exige.
      setError('No se pudo leer la bitácora. Si el filtro es nuevo, puede faltar un índice.');
    } finally {
      setCargando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo, resultado, desde, hasta, cursor, filas, esVistaPlataforma, tenantDeLaRuta]);

  useEffect(() => {
    setCursor(null);
    void traer(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo, resultado, desde, hasta, esVistaPlataforma, tenantDeLaRuta]);

  return (
    <section>
      <h2>Bitácora</h2>
      <p className="ayuda">
        Qué se envió, a quién, cuándo y con qué resultado. Es un registro
        <strong> inmutable</strong>: no se puede editar ni borrar.
        No guarda el texto de los mensajes.
      </p>

      <form className="filtros" onSubmit={(e) => e.preventDefault()}>
        <label>Tipo
          <select value={tipo} onChange={(e) => setTipo(e.target.value as Tipo | '')}>
            <option value="">Todos</option>
            {TIPOS.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
        <label>Resultado
          <select value={resultado} onChange={(e) => setResultado(e.target.value as Resultado | '')}>
            <option value="">Todos</option>
            {RESULTADOS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label>Desde
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </label>
        <label>Hasta
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </label>
      </form>

      {error && <p role="alert">{error}</p>}

      <table>
        <thead>
          <tr>
            <th>Fecha y hora</th>
            {esVistaPlataforma && <th>Comercio</th>}
            <th>Tipo</th>
            <th>Resultado</th>
            <th>Destino</th>
            <th>Código</th>
            <th>Detalle</th>
            <th>Latencia</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={`${f.tenant}/${f.id}`} className={f.resultado === 'ok' ? '' : 'alerta'}>
              <td>{f.ts?.toDate ? f.ts.toDate().toLocaleString('es-BO') : '—'}</td>
              {esVistaPlataforma && <td><TextoSeguro valor={f.tenant} maxLargo={60} /></td>}
              <td><TextoSeguro valor={String(f.tipo ?? '').replace(/_/g, ' ')} maxLargo={40} /></td>
              <td><TextoSeguro valor={f.resultado} maxLargo={20} /></td>
              {/* Enmascarado en origen: la regla de Firestore rechaza un número completo. */}
              <td><TextoSeguro valor={f.destinoEnmascarado} maxLargo={20} /></td>
              <td><TextoSeguro valor={f.codigo} maxLargo={24} /></td>
              <td><TextoSeguro valor={f.detalle} maxLargo={120} /></td>
              <td>{typeof f.latenciaMs === 'number' ? `${(f.latenciaMs / 1000).toFixed(1)} s` : '—'}</td>
            </tr>
          ))}
          {filas.length === 0 && !cargando && (
            <tr><td colSpan={esVistaPlataforma ? 8 : 7}>Sin eventos para esos filtros.</td></tr>
          )}
        </tbody>
      </table>

      <p>
        {cargando && <span>Cargando…</span>}
        {hayMas && !cargando &&
          <button onClick={() => void traer(true)}>Traer {POR_PAGINA} más</button>}
      </p>
    </section>
  );
}
