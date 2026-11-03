import { useEffect, useRef, useState } from 'react';
import { montarBotonGoogle } from '../lib/googleIdentidad';

/**
 * El botón de Google que entrega un ID token a `alElegir` (Google abre su propio selector de cuenta). No guarda el token. Si Google no
 * carga (bloqueador, sin red) lo dice con un texto corto y deja cancelar.
 */
export function BotonGoogle({ clientId, alElegir, alCancelar }: { clientId: string; alElegir: (idToken: string) => void; alCancelar: () => void }) {
  const caja = useRef<HTMLDivElement>(null);
  const [fallo, setFallo] = useState(false);
  useEffect(() => {
    let vivo = true;
    if (caja.current) montarBotonGoogle(caja.current, clientId, (t) => { if (vivo) alElegir(t); }).catch(() => { if (vivo) setFallo(true); });
    return () => { vivo = false; window.google?.accounts?.id?.cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);
  return (
    <div className="edicion-crm-google">
      <p className="ayuda">Elija la cuenta de Google con la que se editará la hoja.</p>
      <div ref={caja} aria-label="Elegir cuenta de Google" />
      {fallo && <p role="alert">No se pudo cargar Google. Revise su conexión o el bloqueador de contenido.</p>}
      <button type="button" className="btn btn-secondary" onClick={alCancelar}>Cancelar</button>
    </div>
  );
}
