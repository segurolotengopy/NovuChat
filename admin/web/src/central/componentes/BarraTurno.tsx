import { useEffect, useRef, useState } from 'react';
import { TextoSeguro } from './TextoSeguro';
import {
  AVISO_TOMAR, ESPERA_CAMBIO_MS, cambioVisible, codigoDeError, detallesDeError, textoErrorTurno, textoEstadoTurno,
  type Acciones, type CapaTurno, type SituacionTurno, type Turno,
} from '../lib/turno';

/**
 * QUIÉN RESPONDE, Y LOS BOTONES PARA TOMAR Y DEVOLVER (H2, contrato §2 y §5).
 *
 *  · El estado sale del campo `turno` de la conversación EN VIVO (lo escribe el servidor): «Responde una persona (…)» o
 *    «Responde el asistente». Ausente o raro = el asistente (`lib/turno.ts`).
 *  · «Tomar» y «Devolver» llaman a `tomarConversacion` y `devolverConversacion`. La pantalla NO cambia el estado por su
 *    cuenta: espera a que el cambio llegue por el oyente en vivo, y mientras tanto deja los botones quietos.
 *  · Solo admin u oper ven los botones (`accionesDeTurno`): el propietario y el soporte solo leen.
 *  · Un error se muestra junto a los botones, con el texto que corresponde a su CÓDIGO (`e.code`), nunca su `message`.
 *  · Todo texto que no es nuestro (el uid abreviado de la persona) pasa por <TextoSeguro>.
 */

export interface PropsBarraTurno {
  tenantId: string;
  conversacionId: string;
  turno: Turno | null;
  situacion: SituacionTurno;
  acciones: Acciones;
  miUid: string | null;
  capa: CapaTurno;
}

export function BarraTurno(p: PropsBarraTurno) {
  const { tenantId, conversacionId, acciones, situacion } = p;
  const [trabajando, setTrabajando] = useState<'tomar' | 'devolver' | null>(null);
  const [esperando, setEsperando] = useState<'tomar' | 'devolver' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const enCurso = useRef(false);
  const vivo = useRef(true);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);

  // El cambio llegó por el oyente en vivo: se sueltan los botones. Si no llega, también (pasado un rato), para no dejarlos trabados.
  useEffect(() => {
    if (esperando && cambioVisible(esperando, situacion)) setEsperando(null);
  }, [esperando, situacion]);
  useEffect(() => {
    if (!esperando) return;
    const t = setTimeout(() => setEsperando(null), ESPERA_CAMBIO_MS);
    return () => clearTimeout(t);
  }, [esperando]);
  // Si quien responde cambió (lo tomó otra persona, se devolvió), el error de antes ya no describe lo que se ve.
  useEffect(() => { setError(null); }, [situacion]);

  const ocupado = trabajando !== null || esperando !== null;

  async function ejecutar(accion: 'tomar' | 'devolver') {
    if (enCurso.current || !acciones.habilitados) return;   // el `ref` frena el doble clic antes de que React repinte
    enCurso.current = true;
    setTrabajando(accion);
    setError(null);
    try {
      const entrada = { tenantId, conversacionId };
      if (accion === 'tomar') await p.capa.tomar(entrada); else await p.capa.devolver(entrada);
      if (vivo.current) setEsperando(accion);
    } catch (e) {
      if (vivo.current) setError(textoErrorTurno(accion, codigoDeError(e), detallesDeError(e)));
    } finally {
      enCurso.current = false;
      if (vivo.current) setTrabajando(null);
    }
  }

  const idError = 'cv-turno-error';
  const describe = error ? idError : undefined;

  return (
    <div className="cv-turno" role="group" aria-label="Quién responde esta conversación">
      <p role="status" data-testid="estado-turno"
        className={`cv-etiqueta ${p.turno ? 'cv-etiqueta--persona' : ''}`}>
        <TextoSeguro valor={textoEstadoTurno(p.turno, p.miUid)} maxLargo={80} />
      </p>

      {acciones.verTomar && (
        <>
          <button type="button" className="btn btn-primary" onClick={() => void ejecutar('tomar')}
            disabled={!acciones.habilitados || ocupado} aria-describedby={`cv-turno-aviso${describe ? ` ${idError}` : ''}`}
            title={acciones.habilitados ? undefined : 'El comercio no está activo: no se puede tomar.'}>
            {trabajando === 'tomar' ? 'Tomando…' : 'Tomar conversación'}
          </button>
          <p id="cv-turno-aviso" className="cv-turno-aviso">{AVISO_TOMAR}</p>
        </>
      )}

      {acciones.sinTomarPorVentana && (
        <p className="cv-turno-aviso" id="cv-turno-sin-ventana">
          No se puede tomar: la ventana de 24 h de WhatsApp está cerrada o no consta cuándo escribió el cliente. Podrá hacerlo cuando el cliente vuelva a escribir.
        </p>
      )}

      {acciones.verDevolver && (
        <button type="button" className="btn btn-secondary" onClick={() => void ejecutar('devolver')}
          disabled={!acciones.habilitados || ocupado} aria-describedby={describe}
          title={acciones.habilitados ? undefined : 'El comercio no está activo: no se puede devolver.'}>
          {trabajando === 'devolver' ? 'Devolviendo…' : 'Devolver al asistente'}
        </button>
      )}

      {error && <p id={idError} role="alert" className="cv-error cv-turno-error">{error}</p>}
    </div>
  );
}
