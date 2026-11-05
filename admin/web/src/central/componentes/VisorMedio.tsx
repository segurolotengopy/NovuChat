import { useEffect, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { funciones } from '../../core/lib/firebase';
import {
  AVISO_DESCARGA, MIME_DE_DESCARGA, avisoExtraDe, descargadorUnico, modoDeMedio, pedirMedio,
  type LlamarVerMedio, type MedioDeMensaje,
} from '../lib/medios';

/**
 * VER O DESCARGAR un medio guardado de la conversación. Pide los bytes a `verMedio` (auditada, con tope) con
 * `accion: 'ver'` (imagen y audio de lista segura) o `accion: 'descargar'` (todo lo demás). Solo lectura.
 *
 *  - Imagen: `<img>` con `data:`. Audio: `<audio controls>` con URL `blob:`, revocada al cerrar o desmontar.
 *  - Documento o video: nunca se abre. Tras una alerta obligatoria se baja un Blob `application/octet-stream`
 *    con nombre generado por la consola (`descargadorUnico`: una sola vez, ancla fuera del DOM, revoca a los 4 s).
 * No se guardan los bytes en el estado: solo el Blob (o la URL) y lo mínimo. Error por `code`, nunca por mensaje.
 * La UI es la misma para todos los roles; el servidor decide el permiso.
 */
const llamarReal: LlamarVerMedio = (a) => httpsCallable(funciones, 'verMedio')(a) as ReturnType<LlamarVerMedio>;

type Estado =
  | { t: 'reposo' }
  | { t: 'cargando' }
  | { t: 'error'; texto: string }
  | { t: 'imagen'; src: string }
  | { t: 'audio'; url: string }
  | { t: 'descarga'; blob: Blob; extension: string };

export function VisorMedio({ tenantId, conversacionId, idMeta, medio, llamar = llamarReal }: {
  tenantId: string; conversacionId: string; idMeta: string; medio: MedioDeMensaje; llamar?: LlamarVerMedio;
}) {
  const modo = modoDeMedio(medio.mime);
  const [estado, setEstado] = useState<Estado>({ t: 'reposo' });
  const vuelta = useRef(0);
  const urlViva = useRef<string | null>(null);
  const bajar = useRef<ReturnType<typeof descargadorUnico> | null>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const cerrar = useRef<HTMLButtonElement>(null);
  const dialogo = useRef<HTMLDivElement>(null);

  const soltar = () => {
    if (urlViva.current) { URL.revokeObjectURL(urlViva.current); urlViva.current = null; }
  };
  const cerrarVisor = () => {
    vuelta.current += 1;
    soltar();
    setEstado({ t: 'reposo' });
    boton.current?.focus();
  };

  // Cambia de tenant, conversación o mensaje (o se desmonta): se invalida lo que venga en camino, se libera y se limpia.
  useEffect(() => {
    setEstado({ t: 'reposo' });
    return () => { vuelta.current += 1; soltar(); };
  }, [tenantId, conversacionId, idMeta]);
  useEffect(() => { if (estado.t !== 'reposo') cerrar.current?.focus(); }, [estado.t]);

  const pedir = async () => {
    if (estado.t !== 'reposo' && estado.t !== 'error') return;
    soltar();
    bajar.current = null;
    const mia = ++vuelta.current;
    setEstado({ t: 'cargando' });
    const r = await pedirMedio(llamar, { tenantId, conversacionId, idMeta, accion: modo, medio, ahora: Date.now() });
    if (mia !== vuelta.current) return;
    if (!r.ok) { setEstado({ t: 'error', texto: r.texto }); return; }
    if (r.clase === 'imagen') { setEstado({ t: 'imagen', src: r.src }); return; }
    if (r.clase === 'audio') {
      const url = URL.createObjectURL(new Blob([r.bytes as BlobPart], { type: r.mime }));
      urlViva.current = url;
      setEstado({ t: 'audio', url });
      return;
    }
    // Descarga: el tipo del Blob es siempre octet-stream, nunca el del archivo.
    bajar.current = descargadorUnico({
      crearUrl: (b) => URL.createObjectURL(b),
      revocar: (u) => URL.revokeObjectURL(u),
      ancla: () => document.createElement('a'), // nunca se inserta en el DOM
      esperar: (f, ms) => setTimeout(f, ms),
    });
    setEstado({ t: 'descarga', blob: new Blob([r.bytes as BlobPart], { type: MIME_DE_DESCARGA }), extension: r.extension });
  };

  // Atrapa el foco dentro del diálogo mientras está abierto.
  const teclas = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { cerrarVisor(); return; }
    if (e.key !== 'Tab') return;
    const f = dialogo.current?.querySelectorAll<HTMLElement>('button:not([disabled]), audio[controls]');
    if (!f || f.length === 0) return;
    const primero = f[0]!, ultimo = f[f.length - 1]!;
    if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
  };

  return (
    <span className="cv-medio">
      <button type="button" ref={boton} className="btn btn-secondary btn-chico" onClick={() => void pedir()}
              disabled={estado.t !== 'reposo'}>
        {estado.t === 'cargando' ? 'Abriendo…' : modo === 'ver' ? 'Ver' : 'Descargar'}
      </button>
      {estado.t !== 'reposo' && (
        <div className="cv-medio-fondo">
          <div role="dialog" aria-modal="true" aria-label="Archivo del mensaje" className="cv-medio-dialogo"
               ref={dialogo} onKeyDown={teclas}>
            <div role="status">
              {estado.t === 'cargando' ? 'Abriendo el archivo…' : estado.t === 'error' ? estado.texto : ''}
            </div>
            {estado.t === 'imagen' && (
              <img src={estado.src} alt="Imagen que mandó el cliente"
                   style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain' }} />
            )}
            {estado.t === 'audio' && (
              <audio controls controlsList="nodownload noplaybackrate" src={estado.url} aria-label="Audio que mandó el cliente" />
            )}
            {estado.t === 'descarga' && (
              <div role="alertdialog" aria-label="Confirmar descarga">
                <p><strong>{AVISO_DESCARGA}</strong></p>
                {avisoExtraDe(estado.extension) && <p><strong>{avisoExtraDe(estado.extension)}</strong></p>}
                <button type="button" className="btn btn-secondary btn-chico" onClick={cerrarVisor}>Cancelar</button>{' '}
                <button type="button" className="btn btn-secondary btn-chico"
                        onClick={() => { if (bajar.current?.(estado.blob, estado.extension, Date.now())) cerrarVisor(); }}>
                  Descargar de todos modos
                </button>
              </div>
            )}
            <p><button type="button" ref={cerrar} className="btn btn-secondary btn-chico" onClick={cerrarVisor}>Cerrar</button></p>
          </div>
        </div>
      )}
    </span>
  );
}
