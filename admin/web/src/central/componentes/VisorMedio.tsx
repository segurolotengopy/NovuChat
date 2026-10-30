import { useEffect, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { funciones } from '../../core/lib/firebase';
import { AVISO_PDF, NOMBRE_DEL_PDF, pedirMedio, type LlamarVerMedio, type MedioDeMensaje, type ResultadoMedio } from '../lib/medios';

/**
 * VER UN MEDIO guardado de la conversación (foto, PDF o audio). Pide los bytes a `verMedio` (auditada, con tope)
 * y los muestra en un diálogo accesible. Solo lectura: no envía nada, y nada se baja al disco salvo el PDF,
 * que el usuario guarda con un botón explícito (la CSP no permite incrustarlo).
 *
 *  - Imagen: `<img>` con `data:` (la CSP lo permite).
 *  - Audio: `<audio controls>` con una URL `blob:`; se revoca al cerrar o desmontar.
 *  - PDF: Blob en memoria; «Guardar PDF» lo baja; se revoca después.
 * Los bytes viven solo en el estado de este componente. El error se muestra por su `code`.
 */
const llamarReal: LlamarVerMedio = (a) => httpsCallable(funciones, 'verMedio')(a) as ReturnType<LlamarVerMedio>;

type Estado =
  | { t: 'reposo' }
  | { t: 'cargando' }
  | { t: 'error'; texto: string }
  | { t: 'listo'; r: Extract<ResultadoMedio, { ok: true }>; url: string | null };

export function VisorMedio({ tenantId, conversacionId, idMeta, medio, llamar = llamarReal }: {
  tenantId: string; conversacionId: string; idMeta: string; medio: MedioDeMensaje; llamar?: LlamarVerMedio;
}) {
  const [estado, setEstado] = useState<Estado>({ t: 'reposo' });
  const vuelta = useRef(0);
  const urlViva = useRef<string | null>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const cerrar = useRef<HTMLButtonElement>(null);

  const soltar = () => {
    if (urlViva.current) { URL.revokeObjectURL(urlViva.current); urlViva.current = null; }
  };
  const cerrarVisor = () => {
    vuelta.current += 1;
    soltar();
    setEstado({ t: 'reposo' });
    boton.current?.focus();
  };

  // Al cambiar de mensaje o desmontar: se invalida la respuesta en camino y se libera el blob.
  useEffect(() => () => { vuelta.current += 1; soltar(); }, [tenantId, conversacionId, idMeta]);
  useEffect(() => { if (estado.t !== 'reposo') cerrar.current?.focus(); }, [estado.t]);

  const ver = async () => {
    const mia = ++vuelta.current;
    setEstado({ t: 'cargando' });
    const r = await pedirMedio(llamar, { tenantId, conversacionId, idMeta, medio, ahora: Date.now() });
    if (mia !== vuelta.current) return;
    if (!r.ok) { setEstado({ t: 'error', texto: r.texto }); return; }
    let url: string | null = null;
    if (r.clase !== 'imagen') {
      url = URL.createObjectURL(new Blob([r.bytes as BlobPart], { type: r.mime }));
      urlViva.current = url;
    }
    setEstado({ t: 'listo', r, url });
  };

  const guardarPdf = (url: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = NOMBRE_DEL_PDF;
    a.click();
  };

  return (
    <span className="cv-medio">
      <button type="button" ref={boton} className="btn btn-secondary btn-chico" onClick={() => void ver()}
              disabled={estado.t === 'cargando'}>
        {estado.t === 'cargando' ? 'Abriendo…' : 'Ver'}
      </button>
      {estado.t !== 'reposo' && (
        <div className="cv-medio-fondo">
          <div role="dialog" aria-modal="true" aria-label="Archivo del mensaje" className="cv-medio-dialogo"
               onKeyDown={(e) => { if (e.key === 'Escape') cerrarVisor(); }}>
            <div role="status">
              {estado.t === 'cargando' ? 'Abriendo el archivo…' : estado.t === 'error' ? estado.texto : ''}
            </div>
            {estado.t === 'listo' && estado.r.clase === 'imagen' && (
              <img src={estado.r.src} alt="Imagen que mandó el cliente"
                   style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain' }} />
            )}
            {estado.t === 'listo' && estado.r.clase === 'audio' && estado.url && (
              <audio controls controlsList="nodownload noplaybackrate" src={estado.url} aria-label="Audio que mandó el cliente" />
            )}
            {estado.t === 'listo' && estado.r.clase === 'pdf' && estado.url && (
              <>
                <p>{AVISO_PDF}</p>
                <button type="button" className="btn btn-secondary btn-chico" onClick={() => guardarPdf(estado.url!)}>
                  Guardar PDF
                </button>
              </>
            )}
            <p><button type="button" ref={cerrar} className="btn btn-secondary btn-chico" onClick={cerrarVisor}>Cerrar</button></p>
          </div>
        </div>
      )}
    </span>
  );
}
