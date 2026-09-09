import { useState } from 'react';
import { sendPasswordResetEmail, updatePassword } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { useSesion } from '../lib/contexto';

/**
 * MI CUENTA — cambiar la contraseña desde adentro.
 *
 * POR QUÉ EXISTE. Hasta ahora la única forma de cambiarla era salir, tocar
 * «Olvidé mi contraseña» y esperar el correo. Funciona, pero obliga a fingir
 * que uno la olvidó para cambiarla a propósito, y eso hace que nadie la cambie
 * nunca. Una contraseña que no se rota es la que sigue viva cuando alguien deja
 * el negocio.
 *
 * EL CASO QUE HAY QUE TRATAR BIEN. Firebase exige haber iniciado sesión hace
 * poco para aceptar un cambio de contraseña: si la sesión es vieja devuelve
 * `auth/requires-recent-login`. Es una protección real —impide que alguien que
 * encuentra un navegador abierto se apropie de la cuenta cambiándole la clave—
 * así que NO se elude. Se explica y se ofrece la salida buena: un enlace por
 * correo, que prueba que quien pide el cambio tiene la casilla.
 *
 * NO APLICA AL EQUIPO DE NOVUCHAT. Esas cuentas entran con Google y no tienen
 * contraseña en este sistema; la administra Google, con su segundo factor. La
 * pantalla lo dice en vez de mostrar un formulario que iba a fallar.
 */
const MINIMO = 12;

export function MiCuenta() {
  const { usuario } = useSesion();
  const [nueva, setNueva] = useState('');
  const [repetida, setRepetida] = useState('');
  const [estado, setEstado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const conGoogle = usuario?.providerData.some((p) => p.providerId === 'google.com') ?? false;
  const correo = usuario?.email ?? '';

  const enviarEnlace = async () => {
    if (!correo) return;
    setError(null);
    try {
      await sendPasswordResetEmail(auth, correo);
    } catch {
      // Se responde igual que en el caso bueno: decir «ese correo no existe»
      // le confirmaría a un desconocido qué cuentas hay.
    }
    setEstado(`Te enviamos un enlace a ${correo}. Ábrelo y elige tu contraseña nueva.`);
  };

  const cambiar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setError(null); setEstado(null);

    if (nueva.length < MINIMO) {
      setError(`La contraseña necesita al menos ${MINIMO} caracteres.`); return;
    }
    if (nueva !== repetida) {
      setError('Las dos contraseñas no son iguales. Revísalas.'); return;
    }
    if (!usuario) { setError('Tu sesión se cerró. Vuelve a entrar.'); return; }

    setOcupado(true);
    try {
      await updatePassword(usuario, nueva);
      setNueva(''); setRepetida('');
      setEstado('Listo, tu contraseña quedó cambiada. La próxima vez entra con la nueva.');
    } catch (e) {
      const codigo = (e as { code?: string }).code ?? '';
      if (codigo === 'auth/requires-recent-login') {
        // No es un error del usuario y no conviene que lo parezca.
        setError('Por seguridad, para cambiar la contraseña hace falta haber entrado '
               + 'hace poco. Te mandamos un enlace por correo y lo resuelves desde ahí.');
        await enviarEnlace();
      } else if (codigo === 'auth/weak-password') {
        setError('Esa contraseña es demasiado fácil de adivinar. Prueba con una más larga.');
      } else {
        setError('No se pudo cambiar la contraseña. Prueba de nuevo en unos minutos.');
      }
    } finally {
      setOcupado(false);
    }
  };

  return (
    <section>
      <h2>Mi cuenta</h2>
      <p className="text-muted">Entraste como <strong>{correo}</strong>.</p>

      {conGoogle ? (
        <div className="card elev-sm" style={{ maxWidth: '34rem' }}>
          <h3 className="card-kicker">Contraseña</h3>
          <p className="card-body">
            Tu cuenta entra con Google, así que no tiene una contraseña en este
            panel: la administra Google, junto con tu segundo factor. Para
            cambiarla, hazlo desde tu cuenta de Google.
          </p>
        </div>
      ) : (
        <form onSubmit={cambiar} style={{ maxWidth: '28rem' }}>
          <h3>Cambiar mi contraseña</h3>
          <label className="field">Contraseña nueva
            <input className="input" type="password" required minLength={MINIMO}
                   autoComplete="new-password"
                   value={nueva} onChange={(e) => setNueva(e.target.value)} />
          </label>
          <label className="field">Repetirla
            <input className="input" type="password" required minLength={MINIMO}
                   autoComplete="new-password"
                   value={repetida} onChange={(e) => setRepetida(e.target.value)} />
          </label>
          <p className="text-muted">
            Al menos {MINIMO} caracteres. Una frase que recuerdes —tres o cuatro
            palabras juntas— es más segura y más fácil que una palabra con
            símbolos raros.
          </p>
          {/* Los dos botones van juntos en una fila. Sueltos, la cuadrícula
              del formulario los manda a dos celdas distintas y en un monitor
              ancho quedan separados por media pantalla. */}
          <div className="acciones">
            <button type="submit" className="btn btn-primary" disabled={ocupado}>
              Cambiar contraseña
            </button>
            <button type="button" className="btn btn-ghost" onClick={enviarEnlace}>
              Prefiero recibir un enlace por correo
            </button>
          </div>
        </form>
      )}

      {error && <p role="alert">{error}</p>}
      {estado && <p role="status">{estado}</p>}
    </section>
  );
}
