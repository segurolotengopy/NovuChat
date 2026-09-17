import { useEffect, useState } from 'react';
import {
  GoogleAuthProvider, getRedirectResult, sendEmailVerification, sendPasswordResetEmail,
  signInWithEmailAndPassword, signInWithPopup, signInWithRedirect,
} from 'firebase/auth';
import { auth } from '../lib/firebase';
import { MINIMO_CONTRASENA } from '../lib/contrasena';
import { Isotipo } from '../componentes/Marca';

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
          'ábrelo y vuelve a ingresar. Hasta entonces el panel no te mostrará datos.',
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
      <h1 className="nav-brand marca-ingreso"><Isotipo tamano={44} />NovuChat</h1>
      <p className="text-muted">Panel administrativo</p>

      {/*
        EL COMERCIO NO ELIGE NADA. Antes había dos pestañas del mismo tamaño
        —«Soy un comercio» y «Soy de NovuChat»— y eso estaba mal por dos razones.
        La primera es de uso: el 99 % de quienes entran acá son comercios, y
        obligarlos a declarar quiénes son antes de ver el formulario es un paso
        que no le sirve a nadie. La segunda es de imagen: un botón grande que
        dice «Soy de NovuChat» le cuenta al cliente que hay una puerta interna,
        del mismo tamaño que la suya.

        Ahora el formulario de correo y contraseña ES la pantalla, y el acceso
        del equipo es un enlace discreto al pie. No está oculto —esconder una
        puerta no la protege, y quien la busque la encuentra igual— pero deja de
        competir con lo que la mayoría vino a hacer.
      */}
      <form onSubmit={conClave}>
        <label className="field">Correo
          <input className="input" type="email" required autoComplete="username" maxLength={254}
                 value={correo} onChange={(e) => setCorreo(e.target.value)} />
        </label>
        {/*
          ESTE CAMPO NO EXIGE UN LARGO MÍNIMO, A PROPÓSITO. Una longitud mínima
          es una regla del momento de ELEGIR la contraseña, no del momento de
          USARLA: acá la contraseña ya existe, y pedirle doce caracteres no le
          agrega ninguna dificultad a quien intenta adivinarla —no la escribe
          más corta— pero sí deja afuera a quien la tiene bien.

          No es hipotético. El 16/09/2026 el administrador de un cliente nuevo
          puso once caracteres en la pantalla de restablecimiento que sirve
          Firebase, que los aceptó (su política admite desde seis), y después
          ESTA pantalla no lo dejó entrar. Peor todavía: el bloqueo lo hacía el
          navegador con su globo genérico, sin decir qué faltaba, así que la
          persona no tenía forma de entender que su contraseña era correcta y el
          formulario el que sobraba. Hubo que rotarle la clave y emitir otro
          enlace.

          El mínimo se exige donde corresponde —`MiCuenta.tsx`, al cambiarla— y
          acá solo se informa, abajo. Quien tenga una contraseña más corta que
          la política de hoy entra igual y la cambia desde adentro.
        */}
        <label className="field">Contraseña
          <input className="input" type="password" required autoComplete="current-password"
                 value={clave} onChange={(e) => setClave(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-primary" disabled={ocupado}>Ingresar</button>
        <button type="button" className="btn btn-ghost" onClick={recuperar}>
          Olvidé mi contraseña
        </button>
        <p className="text-muted">
          Las contraseñas tienen al menos {MINIMO_CONTRASENA} caracteres. Verifica
          tu correo antes del primer ingreso.
        </p>
      </form>

      {modo === 'novuchat' ? (
        <section className="interno">
          <p className="text-muted">Acceso del equipo de NovuChat.</p>
          <button type="button" className="btn btn-secondary" onClick={conGoogle} disabled={ocupado}>
            Continuar con Google
          </button>
        </section>
      ) : (
        <button type="button" className="enlace-interno"
                onClick={() => { setModo('novuchat'); setError(null); setAviso(null); }}>
          Ingreso interno
        </button>
      )}

      {error && <p role="alert">{error}</p>}
      {aviso && <p role="status">{aviso}</p>}
    </main>
  );
}
