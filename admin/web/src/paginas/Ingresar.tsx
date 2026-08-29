import { useState } from 'react';
import {
  GoogleAuthProvider, sendEmailVerification, sendPasswordResetEmail,
  signInWithEmailAndPassword, signInWithPopup,
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

  const conGoogle = async () => {
    setError(null); setAviso(null); setOcupado(true);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch {
      setError('No se pudo iniciar sesión. Intente de nuevo.');
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
      <h1>NovuChat</h1>
      <p>Panel administrativo</p>

      <nav className="pestanas">
        <button type="button" aria-pressed={modo === 'comercio'}
                onClick={() => { setModo('comercio'); setError(null); setAviso(null); }}>
          Soy un comercio
        </button>
        <button type="button" aria-pressed={modo === 'novuchat'}
                onClick={() => { setModo('novuchat'); setError(null); setAviso(null); }}>
          Soy de NovuChat
        </button>
      </nav>

      {modo === 'comercio' ? (
        <form onSubmit={conClave}>
          <label>Correo
            <input type="email" required autoComplete="username" maxLength={254}
                   value={correo} onChange={(e) => setCorreo(e.target.value)} />
          </label>
          <label>Contraseña
            <input type="password" required autoComplete="current-password"
                   minLength={12} value={clave} onChange={(e) => setClave(e.target.value)} />
          </label>
          <button type="submit" disabled={ocupado}>Ingresar</button>
          <button type="button" className="enlace" onClick={recuperar}>
            Olvidé mi contraseña
          </button>
          <p className="ayuda">
            Mínimo 12 caracteres. Verifique su correo antes del primer ingreso.
          </p>
        </form>
      ) : (
        <>
          <button onClick={conGoogle} disabled={ocupado}>Ingresar con Google</button>
          <p className="ayuda">
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
