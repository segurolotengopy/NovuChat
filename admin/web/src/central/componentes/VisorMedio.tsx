import { useEffect, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { funciones } from '../../core/lib/firebase';
import {
  AVISO_DESCARGA, MIME_DE_DESCARGA, avisoExtraDe, modoDeMedio, nombreDeDescarga, pedirMedio,
  type LlamarVerMedio, type MedioDeMensaje, type ResultadoMedio,
} from '../lib/medios';

/**
 * VER O DESCARGAR un medio guardado de la conversación. Pide los bytes a `verMedio` (auditada, con tope) con
 * `accion: 'ver'` (imagen y audio de lista segura) o `accion: 'descargar'` (todo lo demás: documentos, video).
 * Solo lectura: no envía nada.
 *
 *  - Imagen: `<img>` con `data:`. Audio: `<audio controls>` con URL `blob:`, revocada al cerrar o desmontar.
 *  - Documento o video: nunca se abre. Tras una alerta obligatoria («Descargar de todos modos») se arma un Blob
 *    `application/octet-stream`, un ancla que NUNCA entra al DOM, se hace `click()` y el blob se revoca de inmediato.
 *    El nombre lo genera la consola con la extensión validada de la respuesta.
 * Los bytes viven solo en el estado de este componente. El error se muestra por su `code`.
 * Soporte de NovuChat: no se ofrece «Descargar» (el servidor decide igual).
 */
const llamarReal: LlamarVerMedio = (a) => httpsCallable(funciones, 'verMedio')(a) as ReturnType<LlamarVerMedio>;

type Listo = Extract<ResultadoMedio, { ok: true }>;
type Estado =
  | { t: 'reposo' }
  | { t: 'cargando' }
  | { t: 'error'; texto: string }
  | { t: 'listo'; r: Listo; url: string | null };

export function VisorMedio({ tenantId, conversacionId, idMeta, medio, esSoporte = false, llamar = llamarReal }: {
  tenantId: string; conversacionId: string; idMeta: string; medio: MedioDeMensaje; esSoporte?: boolean; llamar?: LlamarVerMedio;
}) {
  const modo = modoDeMedio(medio.mime, esSoporte);
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

  useEffect(() => () => { vuelta.current += 1; soltar(); }, [tenantId, conversacionId, idMeta]);
  useEffect(() => { if (estado.t !== 'reposo') cerrar.current?.focus(); }, [estado.t]);

  if (modo === 'ninguno') return null;

  const pedir = async () => {
    const mia = ++vuelta.current;
    setEstado({ t: 'cargando' });
    const r = await pedirMedio(llamar, { tenantId, conversacionId, idMeta, accion: modo, medio, ahora: Date.now() });
    if (mia !== vuelta.current) return;
    if (!r.ok) { setEstado({ t: 'error', texto: r.texto }); return; }
    let url: string | null = null;
    if (r.clase === 'audio') {
      url = URL.createObjectURL(new Blob([r.bytes as BlobPart], { type: r.mime }));
      urlViva.current = url;
    }
    setEstado({ t: 'listo', r, url });
  };

  const descargar = (r: Extract<Listo, { clase: 'descarga' }>) => {
    const url = URL.createObjectURL(new Blob([r.bytes as BlobPart], { type: MIME_DE_DESCARGA }));
    const a = document.createElement('a'); // nunca se inserta en el DOM
    a.href = url;
    a.download = nombreDeDescarga(r.extension, Date.now());
    a.click();
    URL.revokeObjectURL(url);
    cerrarVisor();
  };

  return (
    <span className="cv-medio">
      <button type="button" ref={boton} className="btn btn-secondary btn-chico" onClick={() => void pedir()}
              disabled={estado.t === 'cargando'}>
        {estado.t === 'cargando' ? 'Abriendo…' : modo === 'ver' ? 'Ver' : 'Descargar'}
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
            {estado.t === 'listo' && estado.r.clase === 'descarga' && (
              <div role="alertdialog" aria-label="Confirmar descarga">
                <p><strong>{AVISO_DESCARGA}</strong></p>
                {avisoExtraDe(estado.r.extension) && <p><strong>{avisoExtraDe(estado.r.extension)}</strong></p>}
                <button type="button" className="btn btn-secondary btn-chico" onClick={cerrarVisor}>Cancelar</button>{' '}
                <button type="button" className="btn btn-secondary btn-chico"
                        onClick={() => descargar(estado.r as Extract<Listo, { clase: 'descarga' }>)}>Descargar de todos modos</button>
              </div>
            )}
            <p><button type="button" ref={cerrar} className="btn btn-secondary btn-chico" onClick={cerrarVisor}>Cerrar</button></p>
          </div>
        </div>
      )}
    </span>
  );
}
