import { useEffect, useRef, useState } from 'react';
import { TextoSeguro } from './TextoSeguro';
import {
  ordenarBloqueadas, rotuloBloqueados, textoErrorBloqueo, textoFechaBloqueo, type CapaBloqueo, type FilaBloqueada,
} from '../lib/bloqueo';
import { ESPERA_CAMBIO_MS, codigoDeError } from '../lib/turno';

/**
 * «BLOQUEADOS (N)»: la lista de contactos bloqueados, con su teléfono, la fecha del bloqueo y «Desbloquear» por fila.
 * Solo la ve el administrador. Las filas llegan ya leídas (la pantalla suscribe `bloqueada == true`, sin orden ni índice
 * nuevo) y acá se ordenan en el cliente. Una fila desbloqueada queda quieta hasta que el oyente la saca (o pasa la espera).
 */
export interface PropsPanelBloqueados {
  tenantId: string;
  filas: readonly FilaBloqueada[] | 'error' | null;
  comercioActivo: boolean;
  capa: CapaBloqueo;
}

export function PanelBloqueados(p: PropsPanelBloqueados) {
  const [abierto, setAbierto] = useState(false);
  const [quitando, setQuitando] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const vivo = useRef(true);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);

  const hayError = p.filas === 'error';
  const filas = Array.isArray(p.filas) ? ordenarBloqueadas(p.filas) : [];

  // Las que ya salieron de la lista (el oyente las sacó) dejan de estar «en proceso».
  useEffect(() => {
    setQuitando((prev) => {
      const vigentes = new Set([...prev].filter((id) => filas.some((f) => f.id === id)));
      return vigentes.size === prev.size ? prev : vigentes;
    });
  }, [p.filas]); // eslint-disable-line react-hooks/exhaustive-deps

  async function desbloquear(id: string) {
    if (!p.comercioActivo || quitando.has(id)) return;
    setQuitando((prev) => new Set(prev).add(id));
    setError(null);
    try {
      await p.capa.desbloquear({ tenantId: p.tenantId, conversacionId: id });
      setTimeout(() => {
        if (vivo.current) setQuitando((prev) => { const n = new Set(prev); n.delete(id); return n; });
      }, ESPERA_CAMBIO_MS);
    } catch (e) {
      if (vivo.current) {
        setError(textoErrorBloqueo('desbloquear', codigoDeError(e)));
        setQuitando((prev) => { const n = new Set(prev); n.delete(id); return n; });
      }
    }
  }

  return (
    <div className="cv-bloqueados" data-testid="panel-bloqueados">
      <button type="button" className="btn btn-secondary" aria-expanded={abierto} aria-controls="cv-bloqueados-lista"
        onClick={() => setAbierto((v) => !v)}>
        {rotuloBloqueados(p.filas === null || hayError ? null : filas.length)}
      </button>
      {abierto && (
        <div id="cv-bloqueados-lista">
          {error && <p role="alert" className="cv-error">{error}</p>}
          {filas.length === 0 ? (
            <p className="cv-vacio">{hayError ? 'No se pudo leer la lista de bloqueados. Recargue la página.' : p.filas === null ? 'Cargando…' : 'No hay contactos bloqueados.'}</p>
          ) : (
            <ul className="cv-bloqueados-filas">
              {filas.map((f) => (
                <li key={f.id} data-testid="fila-bloqueada">
                  <span>
                    +<TextoSeguro valor={f.telefono} maxLargo={15} />
                    {f.nombre && <> (<TextoSeguro valor={f.nombre} maxLargo={60} />)</>}
                  </span>
                  <span className="text-muted"> Bloqueado el {textoFechaBloqueo(f.bloqueadaEn)}</span>
                  <button type="button" className="btn btn-secondary" onClick={() => void desbloquear(f.id)}
                    disabled={!p.comercioActivo || quitando.has(f.id)}>
                    {quitando.has(f.id) ? 'Desbloqueando…' : 'Desbloquear'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
