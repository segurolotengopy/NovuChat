import { useState } from 'react';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth } from '../lib/firebase';

/**
 * Ingreso con cuenta de Google.
 *
 * Se eligió proveedor federado y NO usuario/contraseña: así NovuChat no
 * custodia ninguna contraseña de sus clientes, el segundo factor lo administra
 * Google y no hay superficie de "olvidé mi contraseña" que atacar.
 *
 * El alta la hace una invitación: iniciar sesión no otorga permisos por sí solo.
 * Un usuario sin claims entra y no ve absolutamente nada (lo verifica la prueba
 * "un usuario autenticado sin claims no accede a ningún tenant").
 */
export function Ingresar() {
  const [error, setError] = useState<string | null>(null);

  const entrar = async () => {
    setError(null);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch {
      // Mensaje genérico a propósito: no se filtra si la cuenta existe.
      setError('No se pudo iniciar sesión. Intente de nuevo.');
    }
  };

  return (
    <main className="centrado">
      <h1>NovuChat</h1>
      <p>Panel administrativo</p>
      <button onClick={entrar}>Ingresar con Google</button>
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
