import { useCallback, useEffect, useState } from 'react';
import { funciones } from '../../core/lib/firebase';
import {
  capaEdicionReal, clientIdGoogle, leerMiEdicion, textoErrorEdicion, textoResultadoQuitar, vistaDeEdicion, type MiEdicion,
} from '../lib/edicionCrm';
import { BotonGoogle } from './BotonGoogle';

const CAPA = capaEdicionReal(funciones);

/**
 * «EDICIÓN DEL miniCRM» EN EL TABLERO (admin y operador). Cada persona habilita SU propia edición con la cuenta de Google que elija
 * (el servidor verifica el ID token; la cuenta no se vincula al usuario de la app). Sin `VITE_GOOGLE_OAUTH_CLIENT_ID` no se pinta nada,
 * ni un aviso. El tope de editores y los permisos los decide el servidor; aquí solo se muestra su respuesta.
 */
export function EdicionMiniCrm({ tenantId, esAdmin }: { tenantId: string; esAdmin: boolean }) {
  const clientId = clientIdGoogle(import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID);
  const [mi, setMi] = useState<MiEdicion | null>(null);
  const [eligiendo, setEligiendo] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [mensaje, setMensaje] = useState<{ texto: string; error: boolean } | null>(null);

  // Si la lectura falla se conserva lo que ya se mostraba (no se esconde el bloque) y se avisa con un error.
  const recargar = useCallback(async (): Promise<boolean> => {
    try { setMi(leerMiEdicion(await CAPA.consultar(tenantId))); return true; } catch { return false; }
  }, [tenantId]);
  const releer = async () => {
    if (!(await recargar())) setMensaje({ texto: 'No se pudo actualizar el estado de la edición. Recargue la página.', error: true });
  };

  useEffect(() => {
    setMi(null); setMensaje(null); setEligiendo(false);
    if (clientId && tenantId) void recargar();
  }, [clientId, tenantId, recargar]);

  const vista = vistaDeEdicion({ clientId, esAdmin, esOper: !esAdmin, miEdicion: mi });
  if (!vista.visible || !mi) return null;

  const habilitar = async (idToken: string) => {
    setEligiendo(false); setOcupado(true); setMensaje(null);
    try {
      await CAPA.registrar(tenantId, idToken);
      setMensaje({ texto: 'Edición habilitada.', error: false });
    } catch (e) {
      setMensaje({ texto: textoErrorEdicion(e, 'habilitar'), error: true });
    }
    await releer();
    setOcupado(false);
  };
  const quitar = async () => {
    setOcupado(true); setMensaje(null);
    try { setMensaje({ texto: textoResultadoQuitar(await CAPA.quitar(tenantId)), error: false }); }
    catch (e) { setMensaje({ texto: textoErrorEdicion(e, 'quitar'), error: true }); }
    await releer();
    setOcupado(false);
  };

  return (
    <section className="edicion-crm" aria-label="Edición del miniCRM" data-testid="edicion-minicrm">
      {mi.estado === 'activo' && <p>Edición habilitada{mi.correo !== '' && <> con <strong>{mi.correo}</strong></>}</p>}
      {vista.verEnlace && mi.enlaceHoja && (
        <p><a className="btn btn-secondary" href={mi.enlaceHoja} target="_blank" rel="noopener noreferrer" data-testid="abrir-hoja">Abrir hoja</a></p>
      )}
      {vista.aviso === 'pendiente' && <p role="status">Su baja quedó pendiente: Google aún no la confirmó. Pulse «Quitar mi edición» para reintentar.</p>}
      {vista.puedeHabilitar && !eligiendo && (
        <p><button type="button" className="btn btn-secondary" disabled={ocupado} onClick={() => { setMensaje(null); setEligiendo(true); }}>Habilitar mi edición</button></p>
      )}
      {vista.puedeHabilitar && eligiendo && clientId && (
        <BotonGoogle clientId={clientId} alElegir={(t) => { void habilitar(t); }} alCancelar={() => setEligiendo(false)} />
      )}
      {vista.puedeQuitar && (
        <p><button type="button" className="btn btn-secondary" disabled={ocupado} onClick={() => { void quitar(); }}>Quitar mi edición</button></p>
      )}
      {mensaje && <p role={mensaje.error ? 'alert' : 'status'}>{mensaje.texto}</p>}
    </section>
  );
}
