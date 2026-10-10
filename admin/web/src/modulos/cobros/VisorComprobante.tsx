import { useEffect, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { funciones } from '../../core/lib/firebase';
import {
  AVISO_PDF, MIME_DE_PDF, NOMBRE_DEL_PDF, bytesDeBase64, claseDeRespuesta, srcDeImagen, textoDeError,
} from './visorComprobante';

/**
 * =============================================================================
 * VER EL COMPROBANTE de un cobro
 * =============================================================================
 *
 * Pide los bytes a la callable `verComprobante` (auditada y con tope: cada vista
 * deja un asiento y cuenta contra 30 por hora y 100 por día) y los muestra:
 *
 *  - Imagen: `<img>` con `data:` y MIME de la lista cerrada (ver `srcDeImagen`).
 *  - PDF: se BAJA como archivo; nunca se abre en una pestaña, un marco ni un
 *    objeto incrustado. Se suelta la URL del Blob apenas empieza la descarga.
 *
 * Los bytes viven SOLO en el estado de este componente: nada en el
 * almacenamiento del navegador, y se descartan al ocultar o al cerrar el detalle.
 * El error se muestra por su `code`, nunca por su mensaje.
 */

type Estado =
  | { tipo: 'reposo' }
  | { tipo: 'cargando' }
  | { tipo: 'imagen'; src: string }
  | { tipo: 'pdf' }
  | { tipo: 'error'; texto: string };

export function VisorComprobante({ tenantId, cierreId }: { tenantId: string; cierreId: string }) {
  const [estado, setEstado] = useState<Estado>({ tipo: 'reposo' });
  // Un cambio de cobro, o cerrar el detalle, invalida la respuesta que venga en camino.
  const vuelta = useRef(0);
  // Accesibilidad: el aviso es una región `status` SIEMPRE montada (un lector de pantalla solo anuncia
  // los cambios de una región que ya existía), y el foco vuelve a un elemento que sigue en pantalla
  // cuando la consulta termina o falla, porque el botón se desmonta al empezar.
  const aviso = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const hubo = useRef(false);

  useEffect(() => {
    vuelta.current += 1;
    setEstado({ tipo: 'reposo' });
    return () => {
      vuelta.current += 1;
      setEstado({ tipo: 'reposo' });
    };
  }, [tenantId, cierreId]);

  useEffect(() => {
    if (estado.tipo === 'imagen' || estado.tipo === 'pdf' || estado.tipo === 'error') aviso.current?.focus();
    else if (estado.tipo === 'reposo' && hubo.current) boton.current?.focus();
    hubo.current = estado.tipo !== 'reposo';
  }, [estado]);

  const ver = async () => {
    const mia = ++vuelta.current;
    setEstado({ tipo: 'cargando' });
    try {
      const r = await httpsCallable<{ tenantId: string; cierreId: string }, { mime: string; base64: string }>(
        funciones, 'verComprobante')({ tenantId, cierreId });
      if (mia !== vuelta.current) return;
      const { mime, base64 } = r.data;
      const clase = claseDeRespuesta(mime);
      if (clase === 'imagen') {
        const src = srcDeImagen(mime, base64);
        setEstado(src
          ? { tipo: 'imagen', src }
          : { tipo: 'error', texto: textoDeError('functions/failed-precondition') });
        return;
      }
      if (clase === 'pdf') {
        const bytes = bytesDeBase64(base64);
        if (!bytes) {
          setEstado({ tipo: 'error', texto: textoDeError('functions/failed-precondition') });
          return;
        }
        const blob = new Blob([bytes as BlobPart], { type: MIME_DE_PDF });
        const url = URL.createObjectURL(blob);
        const enlace = document.createElement('a');
        enlace.href = url;
        enlace.download = NOMBRE_DEL_PDF;
        enlace.click();
        // 5 s y no 0: Firefox y Safari pueden cancelar la descarga si la URL se suelta antes de que
        // el navegador la tome. Los bytes ya están en memoria; el Blob se libera igual.
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        setEstado({ tipo: 'pdf' });
        return;
      }
      setEstado({ tipo: 'error', texto: textoDeError('functions/failed-precondition') });
    } catch (e) {
      if (mia !== vuelta.current) return;
      // Solo el code: el mensaje de una librería puede traer rutas o datos.
      setEstado({ tipo: 'error', texto: textoDeError((e as { code?: unknown } | null)?.code) });
    }
  };

  const mensaje = estado.tipo === 'cargando' ? 'Abriendo el comprobante…'
    : estado.tipo === 'error' ? estado.texto
    : estado.tipo === 'imagen' ? 'Comprobante abierto.'
    : estado.tipo === 'pdf' ? AVISO_PDF
    : '';

  return (
    <div className="visor-comprobante">
      <div role="status" ref={aviso} tabIndex={-1}>{mensaje}</div>
      {(estado.tipo === 'reposo' || estado.tipo === 'error') && (
        <button type="button" ref={boton} className="btn btn-secondary btn-chico" onClick={() => void ver()}>
          Ver comprobante
        </button>
      )}
      {estado.tipo === 'imagen' && (
        <>
          <img src={estado.src} alt="Comprobante que mandó el cliente"
               style={{ maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain' }} />
          <p>
            <button type="button" className="btn btn-secondary btn-chico"
                    onClick={() => setEstado({ tipo: 'reposo' })}>Ocultar comprobante</button>
          </p>
        </>
      )}
      {estado.tipo === 'pdf' && (
        <p>
          <button type="button" className="btn btn-secondary btn-chico"
                  onClick={() => setEstado({ tipo: 'reposo' })}>Entendido</button>
        </p>
      )}
    </div>
  );
}
