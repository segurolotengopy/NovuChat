import { useEffect, useState } from 'react';
import {
  GoogleAuthProvider, getRedirectResult, sendEmailVerification, sendPasswordResetEmail,
  signInWithEmailAndPassword, signInWithPopup, signInWithRedirect,
} from 'firebase/auth';
import { auth } from '../lib/firebase';

/**
 * INGRESO CON AUTENTICACIÓN MIXTA POR ROL.
 *
 *   Superadministradores de NovuChat  ->  SOLO cuenta de Google
 *   Administradores de comercio       ->  SOLO usuario y contraseña
 *
 * Las dos puertas están acá, pero ESTA PANTALLA NO DECIDE NADA. Quien impone el
 * vínculo es `firestore.rules`, comparando `firebase.sign_in_provider` del ID
 * token contra el rol del claim, y la Cloud Function que emite los claims, que
 * se niega a otorgar un rol sobre una identidad del proveedor equivocado. Si
 * alguien entra por la puerta que no le toca, inicia sesión y no ve nada.
 *
 * Mensajes de error DELIBERADAMENTE GENÉRICOS: no se distingue "no existe esa
 * cuenta" de "la contraseña está mal". Decirlo confirma qué correos están
 * registrados y regala la mitad del trabajo de un ataque de credenciales.
 */
export function Ingresar() {
  const [modo, setModo] = useState<'comercio' | 'novuchat'>('comercio');
  const [correo, setCorreo] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // Si la vuelta fue por redirección (ver abajo), el error llega por acá.
  useEffect(() => {
    getRedirectResult(auth).catch(() => {
      setError('No se pudo iniciar sesión con Google. Intente de nuevo.');
    });
  }, []);

  const conGoogle = async () => {
    setError(null); setAviso(null); setOcupado(true);
    const proveedor = new GoogleAuthProvider();

    // SIEMPRE preguntar con qué cuenta. Sin esto, Google reusa en silencio la
    // única sesión abierta en el navegador y ni muestra el selector. El caso que
    // lo vuelve necesario es el de «Salir y entrar con otra cuenta»: la persona
    // sale porque se equivocó de cuenta, y al volver a entrar el navegador la
    // mete en la MISMA, con lo cual el botón no sirve para nada y el sistema
    // parece ignorarla. También cubre a quien tiene la personal y la del trabajo
    // abiertas a la vez, que en este proyecto son Andres y Silvana.
    proveedor.setCustomParameters({ prompt: 'select_account' });

    try {
      await signInWithPopup(auth, proveedor);
    } catch (error) {
      const codigo = (error as { code?: string }).code ?? '';

      // RESPALDO POR REDIRECCIÓN. Los bloqueadores de ventanas emergentes son
      // comunes, y para el superadministrador de NovuChat esta es la ÚNICA
      // puerta: su rol exige cuenta de Google, así que un bloqueador lo dejaría
      // sin ninguna forma de entrar. La redirección no necesita abrir ventana.
      //
      // Se encontró probando a mano contra el emulador, donde la ventana quedó
      // bloqueada y el flujo moría con «Auth Emulator Internal Error: No
      // matching frame» — el handler intentaba responderle a un opener que no
      // existía.
      if (codigo === 'auth/popup-blocked'
          || codigo === 'auth/cancelled-popup-request'
          || codigo === 'auth/operation-not-supported-in-this-environment') {
        await signInWithRedirect(auth, proveedor);
        return;
      }
      // Cerrar la ventana a propósito no es un error que haya que mostrar.
      if (codigo !== 'auth/popup-closed-by-user') {
        setError('No se pudo iniciar sesión. Intente de nuevo.');
      }
    } finally {
      setOcupado(false);
    }
  };

  const conClave = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setError(null); setAviso(null); setOcupado(true);
    try {
      const credencial = await signInWithEmailAndPassword(auth, correo, clave);
      // El correo verificado es un REQUISITO DEL SERVIDOR: sin él las reglas
      // niegan todo. Se avisa acá para que la persona entienda por qué entró y
      // no ve nada, en vez de creer que el panel está roto.
      if (!credencial.user.emailVerified) {
        await sendEmailVerification(credencial.user);
        setAviso(
          'Su correo todavía no está verificado. Le enviamos el enlace de nuevo: ' +
          'ábralo y vuelva a ingresar. Hasta entonces el panel no le mostrará datos.',
        );
      }
    } catch {
      setError('No se pudo iniciar sesión. Revise su correo y su contraseña.');
    } finally {
      setOcupado(false);
    }
  };

  const recuperar = async () => {
    setError(null);
    if (!correo) { setError('Escriba su correo para enviarle el enlace.'); return; }
    try {
      await sendPasswordResetEmail(auth, correo);
    } catch {
      // Se ignora el error a propósito.
    }
    // Mismo mensaje exista o no la cuenta: no se confirma quién está registrado.
    setAviso('Si ese correo tiene una cuenta, le enviamos un enlace para cambiar la contraseña.');
  };

  return (
    <main className="centrado">
      <h1 className="nav-brand" style={{ fontSize: 34 }}>NovuChat</h1>
      <p className="text-muted">Panel administrativo</p>

      {/* Control segmentado del sistema de diseño. Sigue siendo un par de
          botones con `aria-pressed`, no radios: la elección no se envía con el
          formulario, cambia qué formulario se muestra. */}
      <nav className="seg">
        <button type="button" className="seg-opt" aria-pressed={modo === 'comercio'}
                onClick={() => { setModo('comercio'); setError(null); setAviso(null); }}>
          Soy un comercio
        </button>
        <button type="button" className="seg-opt" aria-pressed={modo === 'novuchat'}
                onClick={() => { setModo('novuchat'); setError(null); setAviso(null); }}>
          Soy de NovuChat
        </button>
      </nav>

      {modo === 'comercio' ? (
        <form onSubmit={conClave}>
          <label className="field">Correo
            <input className="input" type="email" required autoComplete="username" maxLength={254}
                   value={correo} onChange={(e) => setCorreo(e.target.value)} />
          </label>
          <label className="field">Contraseña
            <input className="input" type="password" required autoComplete="current-password"
                   minLength={12} value={clave} onChange={(e) => setClave(e.target.value)} />
          </label>
          <button type="submit" className="btn btn-primary" disabled={ocupado}>Ingresar</button>
          <button type="button" className="btn btn-ghost" onClick={recuperar}>
            Olvidé mi contraseña
          </button>
          <p className="text-muted">
            Mínimo 12 caracteres. Verifique su correo antes del primer ingreso.
          </p>
        </form>
      ) : (
        <>
          <button type="button" className="btn btn-primary" onClick={conGoogle} disabled={ocupado}>Ingresar con Google</button>
          <p className="text-muted">
            El personal de NovuChat entra únicamente con su cuenta de Google, con
            el segundo factor activo. No hay contraseña que robar.
          </p>
        </>
      )}

      {error && <p role="alert">{error}</p>}
      {aviso && <p role="status">{aviso}</p>}
    </main>
  );
}
