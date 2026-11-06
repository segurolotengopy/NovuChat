import { useEffect, useRef, useState } from 'react';
import {
  AVISO_BLOQUEAR, CONFIRMAR_BLOQUEO, MOTIVO_BLOQUEADO, MOTIVO_TURNO_VIGENTE, TEXTO_BLOQUEADO, textoErrorBloqueo,
  type AccionBloqueo, type AccionesBloqueo, type CapaBloqueo,
} from '../lib/bloqueo';
import { ESPERA_CAMBIO_MS, codigoDeError } from '../lib/turno';

/**
 * «BLOQUEAR CONTACTO» / «DESBLOQUEAR» EN LA CONVERSACIÓN ABIERTA.
 *
 *  · Solo el administrador ve los botones (`accionesDeBloqueo`); el servidor lo vuelve a exigir.
 *  · «Bloquear» pide confirmación antes de llamar; un botón pulsado no reaparece: queda quieto hasta que el cambio llega por el
 *    oyente en vivo (`bloqueada`), o pasa `ESPERA_CAMBIO_MS`.
 *  · Con el contacto bloqueado se ve el marcador y el motivo por el que no se puede tomar ni escribir.
 *  · Los errores salen del código (`e.code`), nunca del `message`.
 */
export interface PropsBloqueoContacto {
  tenantId: string;
  conversacionId: string;
  bloqueada: boolean;
  acciones: AccionesBloqueo;
  capa: CapaBloqueo;
}

export function BloqueoContacto(p: PropsBloqueoContacto) {
  const { tenantId, conversacionId, acciones, bloqueada } = p;
  const [confirmando, setConfirmando] = useState(false);
  const [trabajando, setTrabajando] = useState<AccionBloqueo | null>(null);
  const [esperando, setEsperando] = useState<AccionBloqueo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const enCurso = useRef(false);
  const vivo = useRef(true);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);

  useEffect(() => {
    if (esperando && (esperando === 'bloquear') === bloqueada) setEsperando(null);
  }, [esperando, bloqueada]);
  useEffect(() => {
    if (!esperando) return;
    const t = setTimeout(() => setEsperando(null), ESPERA_CAMBIO_MS);
    return () => clearTimeout(t);
  }, [esperando]);
  useEffect(() => { setError(null); setConfirmando(false); }, [bloqueada]);

  const ocupado = trabajando !== null || esperando !== null;

  async function ejecutar(accion: AccionBloqueo) {
    if (enCurso.current || !acciones.habilitados) return;
    enCurso.current = true;
    setTrabajando(accion);
    setError(null);
    setConfirmando(false);
    try {
      const entrada = { tenantId, conversacionId };
      if (accion === 'bloquear') await p.capa.bloquear(entrada); else await p.capa.desbloquear(entrada);
      if (vivo.current) setEsperando(accion);
    } catch (e) {
      if (vivo.current) setError(textoErrorBloqueo(accion, codigoDeError(e)));
    } finally {
      enCurso.current = false;
      if (vivo.current) setTrabajando(null);
    }
  }

  if (!bloqueada && !acciones.verBloquear && !acciones.avisoTurnoVigente) return null;

  return (
    <div className="cv-turno cv-bloqueo" role="group" aria-label="Bloquear contacto">
      {bloqueada && (
        <>
          <p role="status" data-testid="marca-bloqueado" className="cv-etiqueta cv-etiqueta--humano">{TEXTO_BLOQUEADO}</p>
          <p className="cv-turno-aviso" data-testid="motivo-bloqueado">{MOTIVO_BLOQUEADO}</p>
        </>
      )}

      {acciones.verDesbloquear && (
        <button type="button" className="btn btn-secondary" onClick={() => void ejecutar('desbloquear')}
          disabled={!acciones.habilitados || ocupado}
          title={acciones.habilitados ? undefined : 'El comercio no está activo: no se puede desbloquear.'}>
          {trabajando === 'desbloquear' ? 'Desbloqueando…' : 'Desbloquear contacto'}
        </button>
      )}

      {acciones.verBloquear && !confirmando && (
        <button type="button" className="btn btn-secondary" onClick={() => setConfirmando(true)}
          disabled={!acciones.habilitados || ocupado}
          title={acciones.habilitados ? undefined : 'El comercio no está activo: no se puede bloquear.'}>
          {trabajando === 'bloquear' ? 'Bloqueando…' : 'Bloquear contacto'}
        </button>
      )}

      {acciones.verBloquear && confirmando && (
        <>
          <p className="cv-turno-aviso" role="alertdialog" aria-label="Confirmar el bloqueo" data-testid="confirmar-bloqueo">
            {CONFIRMAR_BLOQUEO} {AVISO_BLOQUEAR}
          </p>
          <button type="button" className="btn btn-primary" onClick={() => void ejecutar('bloquear')} disabled={ocupado || !acciones.habilitados}>
            Sí, bloquear
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setConfirmando(false)} disabled={ocupado}>Cancelar</button>
        </>
      )}

      {acciones.avisoTurnoVigente && (
        <p className="cv-turno-aviso" data-testid="aviso-turno-vigente">{MOTIVO_TURNO_VIGENTE}</p>
      )}

      {error && <p role="alert" className="cv-error cv-turno-error">{error}</p>}
    </div>
  );
}
